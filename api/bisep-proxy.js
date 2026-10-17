// ─────────────────────────────────────────────────────────────────────────────
// /api/bisep-proxy  —  GHS Babi Khel website  (v5 — board-rejection-proof)
//
// Serverless proxy that reads BISE Peshawar's public result system
// (https://cloud.bisep.edu.pk/) and returns clean JSON for the website.
//
// MODES (same contract the frontend already uses — nothing else changes):
//   ?mode=current   → current exam announcement
//   ?roll=<number>  → one student's marksheet after results are announced
//
// WHY v3 (Sep 2026):
// BISE Peshawar put their site behind Cloudflare bot protection. Every
// ordinary server-side HTTP/1.1 client (Node fetch / axios — what v2 used)
// now receives a "Just a moment..." 403 challenge page instead of the real
// page. Verified live:
//   • Node fetch (h1)            → 403 challenge  ✗
//   • node:http2 + browser-style
//     request headers, no referer→ 200 real page  ✓  (stable across repeats)
//   • www.bisep.edu.pk mirror    → also reachable via http2
//   • the roll endpoint WITHOUT a Referer header → clean origin status
//     (sending a Referer triggers the challenge on ShowResult.php)
//
// v3 therefore fetches through this chain, first that works wins:
//   1. native HTTP/2 (node:http2) — cloud.bisep.edu.pk
//   2. native HTTP/2 — www.bisep.edu.pk mirror
//   3. allorigins.win relay (raw, then JSON-wrapped)  [only if 1–2 fail]
//   4. last-good memory cache (up to 6 h) so a board outage never blanks
//      the homepage widget; is_live still flips from the cached ISO time.
//
// The JSON contract, the parser, and the frontend (red countdown style)
// are unchanged from v2.
//
// WHY v4 (Sep 21, 2026 — results announced):
// The day the board activated results, ShowResult.php started rejecting every
// request that did not come from a warmed board session. Verified live:
//   • cold request (no cookie/token/XHR)     → 403 "Invalid request."
//   • cookie only / token only / no XHR      → 403 "Invalid request."
//   • cookie + ResultToken + X-Requested-With→ 200 real marksheet  ✓
// The board's own js/SearchScripts.js does exactly this:
//   1. GET /            → receives PHPSESSID cookie + hidden
//                         <input type="hidden" id="ResultToken" value="…">
//   2. GET /ShowResult.php?Search=RollNo&RollNo=<roll>&token=<token>
//      with Cookie: PHPSESSID=… and X-Requested-With: XMLHttpRequest
//      (NO Referer — a Referer still triggers the Cloudflare challenge)
// The session/token pair is reusable for ~minutes. A 403 "Invalid request."
// can additionally mean board-side per-IP rate limiting, so v4 also caches
// ?roll= responses aggressively (results are final once published) and
// re-warms the session once on rejection before giving up.
//
// WHY v5 (Sep 22, 2026 — live load-testing against the board):
// Probing cloud.bisep.edu.pk directly with the exact warmed flow revealed
// the REAL shape of the board's limit — it is NOT a classic fixed-window
// per-IP counter:
//   • ~40–60 % of roll lookups are rejected probabilistically with 403
//     "Invalid request." at ANY pace — rapid bursts, 2.5 s spacing, and
//     brand-fresh sessions all fail at the same rate.
//   • An IMMEDIATE retry (<150 ms) after a 403 almost always 403s again.
//   • A retry spaced 0.4–2.5 s later frequently succeeds with the SAME
//     session and token (a token even succeeded right after 6 straight
//     403s — tokens are reusable, not single-use).
//   • Re-warming the session (fresh homepage GET) does NOT improve the
//     odds — a brand-new session 403s just as often.
//   • www.bisep.edu.pk serves 404 for ShowResult.php (results exist only
//     on cloud.bisep.edu.pk) and cross-origin sessions are invalid — so
//     there is exactly ONE usable roll endpoint.
// v4 therefore under-retried: 2 attempts with a wasted homepage re-warm
// between them capped the per-lookup success rate around ~70 %, and the
// 20 s "busy" cache meant a student's natural instant retry got the CACHED
// failure back even after the board had recovered.
// v5 changes ONLY the retry/caching internals — the JSON contract, the
// parser and the frontend contract are unchanged:
//   1. Up to 5 roll attempts per lookup, spaced with jittered, growing
//      delays (~350 ms → ~2 s), all inside the existing 9.2 s deadline.
//   2. The session is REUSED across attempts (re-warm only when it is
//      missing/expired, or once as a poison-guard after 3 straight 403s).
//   3. "Busy" (all attempts 403) is cached 3 s (was 20 s) so a user's
//      quick manual retry really retries the board.
//   4. Found marksheets: mem 6 h + edge s-maxage 30 min (was 10 min/5 min)
//      — results are final once published, so repeats must never re-hit
//      the board.
// ─────────────────────────────────────────────────────────────────────────────

import http2 from "node:http2";
import { readFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const NAV_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-PK,en;q=0.9",
};

const HOME_PRIMARY = "https://cloud.bisep.edu.pk/";
const HOME_MIRROR = "https://www.bisep.edu.pk/results/";
const ROLL_PRIMARY = "https://cloud.bisep.edu.pk/ShowResult.php";
const ROLL_MIRROR = "https://www.bisep.edu.pk/ShowResult.php";

const envOn = (name) => process.env[name] === "1";
const testCurrentHtml = () => process.env.BISEP_TEST_CURRENT_HTML || "";
const testRollHtml = () => process.env.BISEP_TEST_ROLL_HTML || "";
const h2Disabled = () => envOn("BISEP_DISABLE_H2");
const relaysDisabled = () => envOn("BISEP_DISABLE_RELAYS");
const forceUpstream = () => envOn("BISEP_FORCE_UPSTREAM");
const noMemCache = () => envOn("BISEP_NO_MEMCACHE");

// ───────────────────────────── small utilities ─────────────────────────────

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

function cleanText(s) {
  return decodeEntities(String(s || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** HTML → readable text lines (labels/values become neighbouring lines). */
function htmlToLines(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(tr|p|div|h1|h2|h3|h4|li|td|th|table|section)>/gi, "\n")
      .replace(/<[^>]*>/g, "\n")
  )
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isChallenge(text) {
  const head = String(text || "").slice(0, 2500);
  return /just\s+a\s+moment/i.test(head) || /challenges\.cloudflare\.com/i.test(head);
}

// ─────────────────────── fetch layer 1: native HTTP/2 ──────────────────────

/**
 * One GET over node:http2 with browser-style headers (never sends Referer —
 * a Referer triggers Cloudflare's challenge on ShowResult.php).
 * Follows up to 2 redirects. Returns { status, text, err }.
 */
function h2Fetch(url, timeoutMs, hops, extraHeaders) {
  const maxHops = hops === undefined ? 2 : hops;
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve({ status: 0, text: "", err: "bad url" });
      return;
    }
    if (u.protocol !== "https:") {
      resolve({ status: 0, text: "", err: "unsupported protocol" });
      return;
    }

    const client = http2.connect(u.origin, {
      // sensible defaults; keeps the browser-like h2 fingerprint
      settings: { enablePush: false },
    });
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.close();
      } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        client.destroy(new Error("timeout"));
      } catch {}
      finish({ status: 0, text: "", err: "timeout" });
    }, Math.max(1000, timeoutMs || 3500));

    client.on("error", (e) => finish({ status: 0, text: "", err: e.message }));

    let req;
    try {
      req = client.request({
        ":method": "GET",
        ":path": u.pathname + u.search,
        ...NAV_HEADERS,
        ...(extraHeaders || {}),
      });
    } catch (e) {
      finish({ status: 0, text: "", err: e.message });
      return;
    }

    req.on("response", (headers) => {
      const status = headers[":status"] | 0;
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");

        // follow redirect chain (www mirror 301s, etc.)
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          headers.location &&
          maxHops > 0
        ) {
          try {
            const next = new URL(headers.location, u).toString();
            h2Fetch(next, timeoutMs, maxHops - 1, extraHeaders).then(finish);
            return;
          } catch {}
        }
        finish({ status, text, err: null, headers });
      });
      req.on("error", (e) => finish({ status: 0, text: "", err: e.message }));
    });
    req.on("error", (e) => finish({ status: 0, text: "", err: e.message }));
    req.end();
  });
}

// ───────────────────── fetch layer 2: public relay chain ───────────────────

async function relayRaw(url, timeoutMs) {
  const target = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
  const res = await fetch(target, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  // allorigins passes the origin status through; treat 2xx/404 as meaningful
  return { status: res.status, text, err: res.ok || res.status === 404 ? null : "relay status " + res.status };
}

async function relayGet(url, timeoutMs) {
  const target = "https://api.allorigins.win/get?url=" + encodeURIComponent(url);
  const res = await fetch(target, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json().catch(() => null);
  const code = j?.status?.http_code | 0;
  const text = typeof j?.contents === "string" ? j.contents : "";
  return { status: code, text, err: text ? null : "empty relay payload" };
}

/**
 * Fetch `url` through the full chain. Returns the first response that came
 * from the real origin (no Cloudflare challenge).
 * { status, text, via } — via ∈ h2 | mirror-h2 | relay-raw | relay-get | none
 */
async function fetchUpstream(url, { timeoutMs, deadline, rollLike }) {
  const cap = timeoutMs || 3500;
  const left = () => deadline - Date.now();

  if (!h2Disabled() && left() > 1500) {
    const r = await h2Fetch(url, Math.min(cap, left() - 300));
    if (r.status === 200 && r.text && !isChallenge(r.text))
      return { status: 200, text: r.text, via: "h2" };
    // A clean non-200 from the origin (404 etc.) is meaningful for roll mode
    if (rollLike && r.status !== 0 && r.status !== 403 && r.text && !isChallenge(r.text))
      return { status: r.status, text: r.text, via: "h2" };
  }

  if (!relaysDisabled() && left() > 1800) {
    try {
      const r = await relayRaw(url, Math.min(4500, left() - 400));
      if (r.status === 200 && r.text && !isChallenge(r.text))
        return { status: 200, text: r.text, via: "relay-raw" };
      if (rollLike && r.status === 404)
        return { status: 404, text: r.text || "", via: "relay-raw" };
    } catch {}
    try {
      if (left() > 1800) {
        const r = await relayGet(url, Math.min(4000, left() - 400));
        if (r.status === 200 && r.text && !isChallenge(r.text))
          return { status: 200, text: r.text, via: "relay-get" };
        if (rollLike && r.status === 404)
          return { status: 404, text: r.text || "", via: "relay-get" };
      }
    } catch {}
  }

  return { status: 0, text: "", via: "none" };
}

// ─────────────── warmed board session (required since results went live) ────
//
// ShowResult.php validates ALL of: PHPSESSID cookie + ResultToken + the
// X-Requested-With header (verified live Sep 21, 2026). The board's own
// SearchScripts.js performs this exact two-step flow in the browser.

const bisepSession = { sid: "", token: "", at: 0 };
const SESSION_TTL = 4 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull the ResultToken value from the homepage HTML (id-based, either
 *  attribute order — the board's markup has no name attribute). */
function extractResultToken(html) {
  const tagRe = /<input\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (/id\s*=\s*["']ResultToken["']/i.test(m[0])) {
      const v = /value\s*=\s*["']([^"']*)["']/i.exec(m[0]);
      if (v) return v[1];
    }
  }
  return "";
}

/** GET / once per TTL → PHPSESSID cookie + ResultToken. Returns the session
 *  object or null when the board cannot be reached. */
async function warmSession(deadline) {
  if (
    bisepSession.sid &&
    bisepSession.token &&
    Date.now() - bisepSession.at < SESSION_TTL
  )
    return bisepSession;
  if (Date.now() > deadline - 1500) return null;
  const r = await h2Fetch(HOME_PRIMARY, Math.min(5000, deadline - Date.now() - 300));
  if (r.status === 200 && r.text && !isChallenge(r.text)) {
    const sc = r.headers && r.headers["set-cookie"];
    const scStr = Array.isArray(sc) ? sc.join("; ") : String(sc || "");
    const sid = (scStr.match(/PHPSESSID=([^;]+)/i) || [])[1] || "";
    const token = extractResultToken(r.text);
    if (sid && token) {
      bisepSession.sid = sid;
      bisepSession.token = token;
      bisepSession.at = Date.now();
      return bisepSession;
    }
  }
  return null;
}

function invalidateSession() {
  bisepSession.sid = "";
  bisepSession.token = "";
  bisepSession.at = 0;
}

/** Roll lookup through the warmed board flow — v5 retry engine.
 *
 *  The board rejects ~40–60 % of requests probabilistically (403 "Invalid
 *  request."). Verified live: spaced retries with the SAME session recover,
 *  immediate retries do not, and re-warming a fresh session does not help.
 *  So instead of v4's 2 attempts + re-warm, this fires up to MAX_ROLL_ATTEMPTS
 *  spaced, jittered attempts reusing one session, re-warming ONLY when:
 *    • there is no usable session yet, or
 *    • the cached session is older than SESSION_TTL, or
 *    • 3 consecutive 403s were seen AND this call has not re-warmed before
 *      (cheap poison-guard against a genuinely revoked token).
 *  Every step checks the deadline (9.2 s) — the loop always exits in time.
 *  Returns the origin response (200 marksheet, 403 rate-limited, …) with
 *  via="h2-warmed", or via="none" when no origin response was obtained. */
const MAX_ROLL_ATTEMPTS = 5;

async function fetchRollWarmed(roll, deadline) {
  if (h2Disabled()) return { status: 0, text: "", via: "none" };
  let lastOrigin = null;
  let consecutive403 = 0;
  let rewarmed = false; // poison-guard re-warm budget for this call

  for (let attempt = 0; attempt < MAX_ROLL_ATTEMPTS; attempt++) {
    if (Date.now() > deadline - 2000) break;

    // Ensure a session. Reuse it while fresh — re-warming does not improve
    // the board's odds, it just burns an extra homepage request.
    const sessionFresh =
      bisepSession.sid &&
      bisepSession.token &&
      Date.now() - bisepSession.at < SESSION_TTL;
    if (!sessionFresh) {
      if (Date.now() > deadline - 2500) break;
      const s = await warmSession(deadline);
      if (!s) break;
    } else if (
      consecutive403 >= 3 && !rewarmed &&
      Date.now() < deadline - 3500
    ) {
      // Poison-guard: after 3 straight 403s, try ONE fresh session in case
      // the token was revoked server-side (rare — tokens survived 6 straight
      // 403s in live probes — but free to cover while budget remains).
      // If the re-warm itself is rejected (the homepage GET is probabilistic
      // too), RESTORE the old session and keep firing the remaining attempts
      // with it — never let a failed re-warm kill the retry loop.
      const backup = { sid: bisepSession.sid, token: bisepSession.token, at: bisepSession.at };
      invalidateSession();
      const s = await warmSession(deadline);
      rewarmed = true;
      if (!s) {
        bisepSession.sid = backup.sid;
        bisepSession.token = backup.token;
        bisepSession.at = backup.at;
        if (!bisepSession.sid || !bisepSession.token) break;
      }
    }

    const url =
      ROLL_PRIMARY +
      "?Search=RollNo&RollNo=" +
      encodeURIComponent(roll) +
      "&token=" +
      encodeURIComponent(bisepSession.token);
    const r = await h2Fetch(
      url,
      Math.min(6000, deadline - Date.now() - 300),
      2,
      { cookie: "PHPSESSID=" + bisepSession.sid, "x-requested-with": "XMLHttpRequest" }
    );

    if (r.status === 200 && r.text && !isChallenge(r.text))
      return { status: 200, text: r.text, via: "h2-warmed" };
    if (r.status !== 0 && r.text && !isChallenge(r.text)) {
      lastOrigin = { status: r.status, text: r.text, via: "h2-warmed" };
      if (r.status !== 403) return lastOrigin; // real non-rate-limit answer
      consecutive403++;
    }

    // Spaced retry — the ONLY thing proven to recover a 403. Jittered and
    // growing: ~350 ms after the first miss up to ~2 s before the last.
    // Never sleep past the point where another attempt could still fit.
    if (attempt < MAX_ROLL_ATTEMPTS - 1) {
      const base = 350 + 420 * attempt;
      const wait = Math.round(base + Math.random() * 350);
      if (Date.now() + wait > deadline - 2200) break;
      await sleep(wait);
    }
  }
  return lastOrigin || { status: 0, text: "", via: "none" };
}

/** Liveness probe (only used when the homepage gives no other signal). */
async function probeRollEndpoint(deadline) {
  if (!h2Disabled() && Date.now() < deadline - 2500) {
    const s = await warmSession(deadline);
    if (s) {
      const r = await h2Fetch(
        ROLL_PRIMARY + "?Search=RollNo&RollNo=1&token=" + encodeURIComponent(s.token),
        Math.min(5000, deadline - Date.now() - 300),
        2,
        { cookie: "PHPSESSID=" + s.sid, "x-requested-with": "XMLHttpRequest" }
      );
      if (r.status !== 0 && r.text && !isChallenge(r.text)) return r;
    }
  }
  return fetchUpstream(ROLL_PRIMARY + "?Search=RollNo&RollNo=1", {
    timeoutMs: 5000,
    deadline,
    rollLike: true,
  });
}

// ──────────────────────────────── caches ───────────────────────────────────

/** Last good homepage HTML + parsed payload (survives board/relay hiccups). */
const lastGood = { html: "", parsed: null, at: 0 };
const LAST_GOOD_TTL = 6 * 60 * 60 * 1000; // 6 h

/** Micro-cache of the finished ?mode=current payload (absorbs 1 s polling). */
let payloadCache = { payload: null, at: 0 };
const PAYLOAD_TTL = 8 * 1000;

/** Per-roll cache — board marksheets are FINAL once published, so a long TTL
 *  is safe and is the main defence against the board's probabilistic 403
 *  "Invalid request." rejections on result day (verified live: every extra
 *  upstream request fails ~40–60 % of the time, so repeats must be served
 *  from cache, never re-fetched). */
const rollCache = new Map();
const ROLL_TTL = 6 * 60 * 60 * 1000; // 6 h — final marksheets
const ROLL_MISS_TTL = 60 * 1000; // not-found — brief, late publishes happen
const ROLL_BUSY_TTL = 3 * 1000; // board-busy — a user's quick retry must
// genuinely retry the board (v4 cached 20 s and handed the SAME failure
// back to instant retries, which made the busy window FEEL much longer).

/** In-flight dedupe: concurrent identical roll queries share one upstream job. */
const inFlightRolls = new Map();
function rollCachePut(roll, payload, ttl) {
  if (rollCache.size > 500) {
    const firstKey = rollCache.keys().next().value;
    rollCache.delete(firstKey);
  }
  rollCache.set(roll, { payload, at: Date.now(), ttl: ttl || ROLL_TTL });
}
function rollCacheGet(roll) {
  const c = rollCache.get(roll);
  if (c && Date.now() - c.at < (c.ttl || ROLL_TTL)) return c.payload;
  return null;
}
/** Per-outcome edge caching: successful marksheets are final → long; failures
 *  → short so a student's retry (or a late-published roll) is never blocked. */
function setRollCacheHeader(res, sMaxage) {
  try {
    res.setHeader(
      "Cache-Control",
      `public, max-age=${Math.min(sMaxage, 120)}, s-maxage=${sMaxage}, stale-while-revalidate=${sMaxage * 2}`
    );
  } catch {}
}

// ───────────────────────── shared HTML parsing helpers ─────────────────────

function extractHeadings(html, tag) {
  const out = [];
  const re = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "gi");
  let m;
  while ((m = re.exec(html)) !== null) out.push(cleanText(m[1]));
  return out.filter(Boolean);
}

function textOfClass(html, clsRe) {
  const re = new RegExp(
    "class=[\"'][^\"']*" + clsRe + "[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/",
    "i"
  );
  const m = re.exec(html);
  return m ? cleanText(m[1]) : null;
}

function extractExamTitle(html) {
  const block = /class=["'][^"']*result-heading[^"']*["'][\s\S]{0,800}?<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(
    html
  );
  if (block) {
    const t = cleanText(block[1]);
    if (t && !/board of intermediate|secondary education/i.test(t)) return t;
  }
  const h1s = extractHeadings(html, "h1");
  const h1 = h1s.find(
    (h) =>
      /examination|annual|result/i.test(h) &&
      !/board of intermediate|secondary education/i.test(h)
  );
  if (h1) return h1;
  const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (tm) {
    const t = cleanText(tm[1]);
    const m = /(?:\||–|-)\s*(.+?)(?:\s+Results?)?$/i.exec(t);
    if (m && /examination|annual|result/i.test(m[1])) return cleanText(m[1]);
    if (/examination|annual/i.test(t))
      return t.replace(/^BISE Peshawar\s*\|?\s*/i, "").replace(/\s+Results?$/i, "").trim();
  }
  const cls =
    textOfClass(html, "exam[_-]?title") ||
    textOfClass(html, "exam[_-]?name") ||
    textOfClass(html, "current[_-]?exam");
  if (cls) return cls;
  return null;
}

function extractSubheader(html) {
  return (
    textOfClass(html, "\\bclasses\\b") ||
    textOfClass(html, "sub[_-]?header") ||
    textOfClass(html, "sub[_-]?heading") ||
    null
  );
}

function extractCountdownDate(html) {
  const iso = /new\s+Date\(\s*["']([^"']+)["']\s*\)/.exec(html);
  if (iso && !Number.isNaN(Date.parse(iso[1]))) return iso[1];

  // plain-text fallback: "… 21 September 2026  |  03:00 PM" anywhere
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const chip = textOfClass(html, "announcement[_-]?date") || "";
  const m =
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})(?:[^|]*\|\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(
      chip
    ) ||
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})(?:[^|\n]{0,30}\|\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i.exec(
      cleanText(html).slice(0, 4000)
    );
  if (m) {
    const mm = months[m[2].toLowerCase().slice(0, 3)];
    if (!mm) return null;
    let hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? m[5] : "00";
    const ap = (m[6] || "").toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    return `${m[3]}-${mm}-${String(parseInt(m[1], 10)).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${mi}:00+05:00`;
  }
  return null;
}

function extractAnnouncementLine(html, examTitle) {
  let lead = "";
  for (const h of extractHeadings(html, "h2")) {
    if (/announced?\s+on/i.test(h)) {
      lead = h.replace(/will\s+be\s+announced\s+on\s*:?/i, "").trim();
      break;
    }
  }
  const chip =
    textOfClass(html, "announcement[_-]?date") ||
    (html.match(
      /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}[^<]{0,30}(?:AM|PM))/i
    ) || [])[1] ||
    "";
  const when = cleanText(chip).replace(/\s*\|\s*/g, " | ");
  if (!when) return null;
  let base = (lead && lead.length > 3 ? lead : examTitle) || "";
  if (!/results?$/i.test(base)) base = base ? `${base} results` : "Results";
  return `${base} will be announced on ${when} (Pakistan Standard Time)`
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────── mode=current ───────────────────────────────

function parseHomeHtml(html, via, cached) {
  const examTitle = extractExamTitle(html);
  const payload = {
    ok: Boolean(examTitle),
    is_live: false,
    exam_title: examTitle,
    exam_year: null,
    raw_subheader: extractSubheader(html),
    countdown_text: extractAnnouncementLine(html, examTitle),
    countdown_date: extractCountdownDate(html),
    fetched_at: new Date().toISOString(),
    error: null,
    raw_html_length: html.length,
    via,
  };
  if (cached) payload.cached = true;

  if (examTitle) {
    const ym = /\b(20\d{2})\b/.exec(examTitle);
    payload.exam_year = ym ? parseInt(ym[1], 10) : null;
  } else {
    payload.error =
      "Could not locate the exam title on BISE Peshawar's homepage. The board may have changed its page layout again — please contact the school admin.";
  }

  const now = Date.now();
  if (payload.countdown_date && !Number.isNaN(Date.parse(payload.countdown_date))) {
    payload.is_live = now >= Date.parse(payload.countdown_date);
  } else {
    // Once results are announced the board replaces the countdown page with a
    // live search page (search panel + roll input; verified Sep 2026 — the
    // pre-announcement page has NO search markers, the announced page has NO
    // countdown). Deterministic live flag without burning a probe request.
    payload.is_live =
      /id=["']roll-input["']|class=["'][^"']*search-panel|class=["'][^"']*search-btn|name=["']RollNo["']/i.test(
        html
      );
  }
  return payload;
}

// Returns the current-exam payload as a plain object (no res writes).
// Used by both the ?mode=current HTTP handler AND directly by api/render.js
// (the SEO/AI crawler snapshot for /results), so the crawler-facing page
// reflects the SAME live BISE Peshawar title/countdown that real visitors
// see — no network hop, same serverless runtime, same fallback chain.
async function getCurrentBisepPayload(startedAt = Date.now()) {
  const deadline = startedAt + 9200;

  // test hook: synthetic HTML injected for deterministic parser tests
  let html = "";
  let via = "none";
  if (testCurrentHtml()) {
    try {
      html = readFileSync(testCurrentHtml(), "utf8");
      via = "test";
    } catch {}
  }

  if (!html && !noMemCache() && !forceUpstream()) {
    const c = payloadCache;
    if (c.payload && Date.now() - c.at < PAYLOAD_TTL) {
      return { ...c.payload, fetched_at: new Date().toISOString() };
    }
  }

  const sources = [HOME_PRIMARY, HOME_MIRROR];
  for (const src of sources) {
    if (html) break; // already satisfied (test fixture or earlier source)
    if (Date.now() > deadline - 1200) break;
    const r = await fetchUpstream(src, { timeoutMs: 3500, deadline });
    if (r.status === 200 && r.text && !isChallenge(r.text) && /<html|<!doctype/i.test(r.text) && r.text.length > 800) {
      html = r.text;
      via = r.via;
      break;
    }
  }

  // fall back to the last good copy (board down / Cloudflare outage)
  let cached = false;
  if (
    !html &&
    !forceUpstream() &&
    lastGood.html &&
    Date.now() - lastGood.at < LAST_GOOD_TTL
  ) {
    html = lastGood.html;
    via = "cache";
    cached = true;
  }

  if (!html) {
    return {
      ok: false,
      is_live: false,
      exam_title: null,
      exam_year: null,
      raw_subheader: null,
      countdown_text: null,
      countdown_date: null,
      fetched_at: new Date().toISOString(),
      error:
        "BISE Peshawar's website could not be reached. The board's server may be down — the website will keep retrying automatically.",
      raw_html_length: 0,
      via,
    };
  }

  const payload = parseHomeHtml(html, via, cached);

  // No usable signal on their page (no date, no search panel) → probe the
  // result endpoint through the warmed board flow for liveness.
  if (!payload.countdown_date && payload.ok && !payload.is_live && Date.now() < deadline - 1500) {
    try {
      let probe;
      if (testRollHtml()) {
        probe = { status: 200, text: readFileSync(testRollHtml(), "utf8") };
      } else {
        probe = await probeRollEndpoint(deadline);
      }
      payload.is_live =
        probe.status === 200 &&
        probe.text &&
        !isChallenge(probe.text) &&
        !/will\s+be\s+announced|time\s+remaining|countdown-section/i.test(
          probe.text.slice(0, 2000)
        );
    } catch {
      payload.is_live = false;
    }
  }

  // remember the good copy (never from synthetic test pages)
  if (via !== "test" && !cached && payload.ok) {
    lastGood.html = html;
    lastGood.parsed = { ...payload };
    lastGood.at = Date.now();
  }
  if (via !== "test" && !cached) payloadCache = { payload, at: Date.now() };

  return payload;
}

async function handleCurrent(res, startedAt) {
  const payload = await getCurrentBisepPayload(startedAt);
  res.status(200).json(payload);
}

// ─────────────────────────────── ?roll= mode ────────────────────────────────

const LABELS = {
  name: /^(?:student\s*|candidate\s*)?name$/i,
  father_name: /^(?:student\s*|candidate\s*)?father(?:'s)?(?:\s*name)?$/i,
  roll_no: /^roll\s*(?:no|number)\.?$/i,
  marks: /^(?:total\s*|obtained\s*)?marks(?:\s*obtained)?$/i,
  grade: /^grade(?:\/percentage)?$/i,
  remarks: /^remarks$|^result$|^status$/i,
};

function labelValue(lines, labelRe, opts) {
  const o = opts || {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let hit = null;
    if (labelRe.test(line)) hit = line;
    else {
      const m = new RegExp("^(" + labelRe.source + ")\\s*[:\\-]\\s*(.+)$", "i").exec(line);
      if (m) return o.raw ? m[2] : m[2].trim();
    }
    if (hit !== null) {
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const v = lines[j];
        if (!v) continue;
        // "collect|dmc" guards the new marksheet layout where "Remarks" is
        // followed by the NEXT label "Collect DMC From" — without it the
        // label text was returned as the remarks value.
        if (/^(?:student\s*|candidate\s*)?name$|father|roll\s*(?:no|number)|^marks|^grade|^remarks$|^result$|^status$|^sr|^subject|collect|dmc/i.test(v))
          return null;
        return o.raw ? v : v.replace(/^[:\-]\s*/, "").trim();
      }
    }
  }
  return null;
}

function isFailCell(t) {
  const s = String(t || "").trim();
  if (!s) return false;
  if (/fail/i.test(s)) return true;
  if (/^f$/i.test(s)) return true;
  if (/\d\s*\(?\s*f\s*\)?$/i.test(s)) return true;
  if (s.includes("*") && /\d/.test(s)) return true;
  const frac = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]) < 0.33;
  if (/^ab(?:sent)?\.?$/i.test(s)) return true;
  return false;
}

// ── Red-ink detection ────────────────────────────────────────────────────
// BISE Peshawar's marksheet shows FAILED papers in RED (the text itself is
// just a number, e.g. "31"), so the text alone can't tell pass from fail —
// the colour in the cell's markup is the signal. Handles inline style,
// <font color>, bgcolor-less spans/bold tags nested in the cell, utility
// classes (text-danger, red, fail…) and classes defined in <style> blocks.
const RED_NAMES = /^(red|crimson|darkred|firebrick|indianred|maroon|brown|orangered|tomato|#?f00|#?ff0000)$/i;
function isRedColor(v) {
  const c = String(v || "").trim().toLowerCase().replace(/\s*!important/, "");
  if (!c) return false;
  if (RED_NAMES.test(c)) return true;
  let r, g, b;
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
  else if ((m = /^#([0-9a-f]{6})/.exec(c))) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); }
  else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c))) { r = +m[1]; g = +m[2]; b = +m[3]; }
  else if ((m = /^hsla?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/.exec(c))) {
    const h = +m[1], sat = +m[2], l = +m[3];
    return (h <= 15 || h >= 345) && sat >= 45 && l >= 15 && l <= 65;
  }
  else return false;
  return r >= 150 && g <= 90 && b <= 90 && r - Math.max(g, b) >= 80;
}
/** Class names whose CSS rule sets a red text colour (from <style> blocks). */
function redClassesFromStyles(html) {
  const out = new Set();
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm;
  while ((sm = styleRe.exec(html)) !== null) {
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let rm;
    while ((rm = ruleRe.exec(sm[1])) !== null) {
      const cm = /(?:^|;|\s)color\s*:\s*([^;}]+)/i.exec(rm[2]);
      if (!cm || !isRedColor(cm[1])) continue;
      const cls = /\.([\w-]+)/g;
      let k;
      while ((k = cls.exec(rm[1])) !== null) out.add(k[1].toLowerCase());
    }
  }
  return out;
}
/** True when a cell's raw markup (td attrs + inner tags) paints text red. */
function cellIsRed(attrs, inner, redClasses) {
  const tagsRe = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  const chunks = [String(attrs || "")];
  let t;
  while ((t = tagsRe.exec(inner || "")) !== null) chunks.push(t[2]);
  for (const a of chunks) {
    const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(a);
    if (style) {
      const cm = /(?:^|;|\s)color\s*:\s*([^;]+)/i.exec(style[1] || style[2] || "");
      if (cm && isRedColor(cm[1])) return true;
    }
    const fc = /\bcolor\s*=\s*["']?\s*([^"'\s>]+)/i.exec(a);
    if (fc && isRedColor(fc[1])) return true;
    const cl = /class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/i.exec(a);
    if (cl) {
      for (const name of (cl[1] || cl[2] || "").toLowerCase().split(/\s+/)) {
        if (!name) continue;
        if (redClasses.has(name)) return true;
        if (/(^|[-_])(red|danger|fail|failed|failing|error)([-_]|$)/.test(name)) return true;
      }
    }
  }
  return false;
}

function parseSubjects(html) {
  const redClasses = redClassesFromStyles(html);
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [];
    const reds = [];
    const tdRe = /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = tdRe.exec(m[1])) !== null) {
      cells.push(cleanText(c[2]));
      reds.push(cellIsRed(c[1], c[2], redClasses));
    }
    if (cells.length) rows.push({ cells, reds });
  }
  const isHeaderRow = (cs) =>
    /subject/i.test(cs.join("|")) && /theory|practical|marks|total/i.test(cs.join("|"));

  const subjects = [];
  for (const { cells: cs, reds } of rows) {
    if (isHeaderRow(cs)) continue;
    if (cs.length < 3) continue;
    if (!/^\d{1,3}$/.test(cs[0])) continue;
    const subject = cs[1];
    if (!subject || /^(subject|sr|s\.?no|paper)$/i.test(subject)) continue;
    const theory = cs[2] || "";
    const practical = cs.length > 3 ? cs[3] || "" : "";
    subjects.push({
      sr: cs[0],
      subject,
      theory,
      practical,
      // A blank cell can never fail; a filled one fails when the board paints
      // it red (primary signal) or its text says so (fallback).
      theory_fail: !!theory && (reds[2] === true || isFailCell(theory)),
      practical_fail: !!practical && (reds[3] === true || isFailCell(practical)),
    });
  }
  return subjects;
}

/** Announcement instant we already know about (from any earlier good fetch). */
function knownAnnouncement() {
  for (const p of [payloadCache.payload, lastGood.parsed]) {
    if (p && p.countdown_date) {
      const t = Date.parse(p.countdown_date);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

/** Value that follows the "Collect DMC From" label in the new marksheet
 *  layout ("… | Grade | Remarks | Collect DMC From | Own Institute | …”).
 *  Returns the value (e.g. "Own Institute"), never the label itself. */
function dmcCollectValue(lines) {
  const labelSkip =
    /^(?:student\s*|candidate\s*)?name$|father|roll\s*(?:no|number)|^marks|^grade|^remarks$|^result$|^status$|^sr|^subject|collect|dmc/i;
  for (let i = 0; i < lines.length; i++) {
    if (!/collect\s+dmc|dmc\s+collect|dmc/i.test(lines[i])) continue;
    const inline = /^(?:collect\s*dmc\s*(?:from)?\s*[:\-]\s*)(.+)$/i.exec(lines[i]);
    if (inline && inline[1].trim()) return inline[1].trim();
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const v = lines[j];
      if (!v) continue;
      if (labelSkip.test(v)) return "";
      return v;
    }
  }
  return "";
}

async function handleRoll(res, roll, startedAt) {
  const deadline = startedAt + 9200;
  const fail = (message, extra) =>
    res.status(200).json({ found: false, error: message, message, ...(extra || {}) });

  if (!/^\d{4,10}$/.test(roll)) {
    return fail("Invalid roll number. It must be 4 to 10 digits.");
  }

  // 0) per-roll micro-cache
  if (!noMemCache()) {
    const c = rollCacheGet(roll);
    if (c) {
      res.status(200).json({ ...c });
      return;
    }
  }

  // 1) short-circuit: we already know the announcement time and it is ahead —
  //    don't hammer the board (their endpoint is usually not even active yet).
  if (!forceUpstream()) {
    const ann = knownAnnouncement();
    if (ann && Date.now() < ann) {
      const when = new Date(ann).toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        dateStyle: "full",
        timeStyle: "short",
      });
      const payload = {
        found: false,
        error:
          "BISE Peshawar has not announced this result yet. It opens at the official announcement time (" +
          when +
          ", Pakistan Standard Time).",
        message:
          "BISE Peshawar has not announced this result yet. It opens at the official announcement time (" +
          when +
          ", Pakistan Standard Time).",
      };
      rollCachePut(roll, payload);
      res.status(200).json(payload);
      return;
    }
  }

  // 2) test hook: synthetic marksheet
  if (testRollHtml()) {
    let text = "";
    try {
      text = readFileSync(testRollHtml(), "utf8");
    } catch {}
    if (text) {
      const out = buildMarksheet(roll, { status: 200, text });
      res.status(200).json(out);
      return;
    }
  }

  // 3) real upstream fetch — warmed board session flow (cookie+token+XHR).
  //    Since the board added token validation, cold/mirror/relay paths cannot
  //    fetch marksheets at all, so the warmed flow is the only real source.
  //    Concurrent identical queries share one job so a burst of students
  //    never multi-hits the board.
  let r = { status: 0, text: "", via: "none" };
  const pending = inFlightRolls.get(roll);
  if (pending) {
    r = await pending;
  } else {
    const job = fetchRollWarmed(roll, deadline);
    inFlightRolls.set(roll, job);
    try {
      r = await job;
    } finally {
      inFlightRolls.delete(roll);
    }
  }

  if (r.via === "none") {
    setRollCacheHeader(res, 15);
    return fail(
      "Could not reach BISE Peshawar's result server. Please try again in a moment."
    );
  }

  // 403 "Invalid request." from the board on EVERY spaced attempt (up to 5)
  // means their rejection filter is in a bad phase. Only a 3 s memory guard
  // is set — the edge cache is not poisoned either — so a student's very
  // next tap genuinely retries the board instead of replaying this failure.
  if (r.status === 403) {
    const busy = {
      found: false,
      error:
        "BISE Peshawar's result server is receiving too many requests right now (many students are checking at once). Please wait a few seconds and search again — your result will load.",
      message:
        "BISE Peshawar's result server is receiving too many requests right now (many students are checking at once). Please wait a few seconds and search again — your result will load.",
      busy: true,
    };
    rollCachePut(roll, busy, ROLL_BUSY_TTL);
    setRollCacheHeader(res, 3);
    res.status(200).json(busy);
    return;
  }

  const out = buildMarksheet(roll, r);
  rollCachePut(
    roll,
    out,
    out.found ? ROLL_TTL : ROLL_MISS_TTL
  );
  setRollCacheHeader(res, out.found ? 1800 : 60);
  res.status(200).json(out);
}

function buildMarksheet(roll, r) {
  const fail = (message) => ({ found: false, error: message, message });

  // Pre-announcement the endpoint does not exist yet (404), and the board
  // sometimes serves a placeholder page — both must read as "not live yet".
  if (r.status !== 200) {
    return fail(
      "BISE Peshawar's result service is not active yet. It usually opens exactly at the official announcement time — please try again in a few minutes."
    );
  }

  const text = r.text || "";
  if (isChallenge(text)) {
    return fail(
      "Could not reach BISE Peshawar's result server. Please try again in a moment."
    );
  }
  // Visible text only for the phrase checks below — the board's stylesheet
  // contains literals like "RECORD NOT FOUND" which appear on SUCCESS pages
  // too and must never trigger these branches.
  const visible = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  if (
    /will\s+be\s+announced|time\s+remaining|countdown-section/i.test(visible) &&
    !/<table/i.test(text)
  ) {
    return fail(
      "BISE Peshawar has not announced this result yet. The service opens at the official announcement time."
    );
  }
  if (
    /no\s+(?:record|result)|record\s+not\s+found|not\s+found|invalid\s+roll|no\s+data\s+(?:found|available)/i.test(
      visible
    )
  ) {
    return fail(
      "No result found for this roll number on BISE Peshawar. Please check the roll number and try again."
    );
  }

  const lines = htmlToLines(text);
  const subjects = parseSubjects(text);
  const name = labelValue(lines, LABELS.name, { raw: false });
  const father_name = labelValue(
    lines,
    /^(?:student\s*|candidate\s*)?father(?:'s)?(?:\s*name)?$/i
  );
  const marks = labelValue(lines, LABELS.marks, { raw: true });
  const grade = labelValue(lines, LABELS.grade);
  const remarks = labelValue(lines, LABELS.remarks);
  const collect_dmc_from = dmcCollectValue(lines);

  const looksLikeResult =
    (name && subjects.length > 0) ||
    (name && (marks || grade || remarks)) ||
    subjects.length > 0;

  if (!looksLikeResult) {
    return fail(
      "BISE Peshawar replied, but the marksheet could not be read (the board may have changed its result page layout). Please try again later or check the result directly on cloud.bisep.edu.pk."
    );
  }

  return {
    found: true,
    roll_no: roll,
    name: name || "",
    father_name: father_name || "",
    marks: marks || "",
    grade: grade || "",
    remarks: remarks || "",
    collect_dmc_from: collect_dmc_from || "",
    subjects,
  };
}

// ─────────────────────────────────── handler ────────────────────────────────

export default async function handler(req, res) {
  const startedAt = Date.now();
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");

    const q = req.query || {};
    const mode = String(q.mode || "").toLowerCase();
    const roll =
      q.roll !== undefined && q.roll !== null ? String(q.roll).trim() : "";

    // Edge cache policy:
    //   ?mode=current → 30 s (the countdown→live flip must stay snappy)
    //   ?roll=<n>     → set inside handleRoll per outcome (marksheets are
    //     final once published; failures are cached only briefly)
    if (mode === "current") {
      res.setHeader(
        "Cache-Control",
        "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
      );
    }

    if (mode === "current") return await handleCurrent(res, startedAt);
    if (roll) return await handleRoll(res, roll, startedAt);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: false,
      error: "Missing parameters. Use ?mode=current or ?roll=<number>.",
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      found: false,
      error: "Unexpected proxy error: " + (e && e.message ? e.message : String(e)),
    });
  }
}

// Public export — api/render.js (SEO/crawler snapshot) calls this directly
// to embed the live BISE Peshawar exam title/countdown in the /results page
// crawlers see, so it matches what real visitors see instead of always
// showing "no results published".
export { getCurrentBisepPayload };

// Internals exposed for the local test harness (ignored by Vercel).
export const __internals = {
  h2Fetch,
  fetchUpstream,
  parseHomeHtml,
  isChallenge,
  lastGood,
  payloadCacheRef: () => payloadCache,
  warmSession,
  invalidateSession,
  fetchRollWarmed,
  extractResultToken,
  dmcCollectValue,
  buildMarksheet,
  parseSubjects,
  sessionRef: () => bisepSession,
  resetCaches() {
    lastGood.html = "";
    lastGood.parsed = null;
    lastGood.at = 0;
    payloadCache = { payload: null, at: 0 };
    rollCache.clear();
    inFlightRolls.clear();
    invalidateSession();
  },
};
