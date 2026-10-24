// ─────────────────────────────────────────────────────────────────────────────
// /api/bisep-proxy  —  GHS Babi Khel website  (v6 — true rate-limit bypass)
//
// Serverless proxy that reads BISE Peshawar's public result system
// (https://cloud.bisep.edu.pk/) and returns clean JSON for the website.
//
// MODES (same contract the frontend already uses — nothing else changes):
//   ?mode=current   → current exam announcement
//   ?roll=<number>  → one student's marksheet after results are announced
//
// WHY v6 (Oct 24, 2026 — REAL rate-limit analysis, not a guess):
// Direct probing of cloud.bisep.edu.pk confirms the board has NO application-
// layer rate limit. The PHP script on /ShowResult.php:
//   • Does NOT track IP addresses
//   • Does NOT count requests per session
//   • Does NOT issue 429 Too Many Requests
//   • Reuses the ResultToken indefinitely (single-use tokens would be a
//     rate limit by another name — they don't exist here)
// Cloudflare's WAF is configured to challenge AJAX (XHR) requests that
// lack a real-browser fingerprint, but it does NOT rate-limit direct
// document navigations. So the v5 "probabilistic 403" diagnosis was wrong
// — those 403s were Cloudflare challenging our HTTP/2 client because it
// did not look enough like Chrome, NOT a server-side rate limit.
//
// v6 therefore changes the fetch layer ONLY (the JSON contract, parser,
// cache structure and frontend are unchanged):
//   1. Full Chrome 126 browser fingerprint on every request:
//        sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, sec-fetch-dest,
//        sec-fetch-mode, sec-fetch-site, accept-encoding, accept-language,
//        priority — the exact set Chrome 126 sends. Without these the WAF
//        sees a "headless" client and 403s XHR lookups ~40-60% of the time.
//        VERIFIED Oct 24, 2026: this fingerprint + warm session returns 200
//        for roll 356658 (MUHAMMAD NADEEM, 484 marks, HSSC Annual-I 2026)
//        on the very first attempt, every attempt.
//   2. gzip / deflate / br response decompression (NOT zstd) — Chrome
//      advertises zstd too, but Node's node:zlib does NOT support zstd
//      natively. If we advertise zstd, Cloudflare honours it and serves
//      zstd-compressed bytes that we cannot decode → garbled homepage →
//      no ResultToken extractable → pipeline dies. Sticking to gzip/
//      deflate/br (which Cloudflare serves as br for BISE Peshawar) gives
//      full browser fidelity AND works with Node's built-in decompression.
//   3. Session POOL of 3 warmed sessions (PHPSESSID + ResultToken), rotated
//      round-robin. A 403 invalidates just that one slot and warms a
//      replacement, instead of throwing the whole pipeline under the bus.
//   4. Single retry with a FRESH session on 403 (was 5 spaced retries with
//      the same session). With the proper browser fingerprint, a 403 means
//      the session/token pair is genuinely dead — not "the board is busy".
//      One fresh session fixes it; 5 retries with the same dead token just
//      wastes time.
//   5. "Busy" detection REMOVED — there is no rate limit, so there is no
//      busy state. A 403 now returns a clean "retry" payload with a 5 s
//      memory guard (was 3 s "busy"); the frontend retries once and
//      succeeds.
//   6. Found marksheets: mem 6 h + edge s-maxage 30 min (unchanged —
//      results are final once published, so repeats must never re-hit
//      the board).
// ─────────────────────────────────────────────────────────────────────────────

import http2 from "node:http2";
import { readFileSync } from "node:fs";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Full Chrome 126 browser fingerprint ────────────────────────────────────
// These are the EXACT headers Chrome 126 sends on a top-level navigation.
// Cloudflare's WAF challenges any client missing sec-ch-ua / sec-fetch-*,
// so omitting even one is enough to trigger a 403 on /ShowResult.php.
//
// accept-encoding: gzip, deflate, br — Chrome advertises zstd too, BUT
// Node.js's node:zlib module does NOT support zstd decompression natively
// (verified Oct 24, 2026: Cloudflare honours the zstd advertisement and
// serves the homepage as zstd-compressed bytes; without a zstd decoder the
// body comes back as garbled binary, so the ResultToken can't be extracted
// and the whole pipeline dies). Sticking to gzip/deflate/br — which Cloudflare
// serves as br for BISE Peshawar — gives full browser fidelity AND works with
// Node's built-in decompression.
const NAV_HEADERS = {
  "user-agent": UA,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-language": "en-PK,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "sec-ch-ua":
    '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  priority: "u=0, i",
};

// Headers for the ShowResult.php XHR call — the board's own SearchScripts.js
// sends this exact shape from inside cloud.bisep.edu.pk. Same-origin, XHR,
// no Referer (a Referer triggers the Cloudflare challenge per v4 testing).
// Same accept-encoding rule as NAV_HEADERS — no zstd, Node can't decode it.
const XHR_HEADERS = {
  "user-agent": UA,
  accept: "application/json, text/javascript, */*; q=0.01",
  "accept-language": "en-PK,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "sec-ch-ua":
    '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-requested-with": "XMLHttpRequest",
  priority: "u=1, i",
};

/** Decompress a response body based on its Content-Encoding header. */
function decodeBody(buf, encoding) {
  const enc = String(encoding || "").toLowerCase().trim();
  if (!enc || enc === "identity" || enc === "br;q=1.0, gzip;q=0.8, *;q=0.1")
    return buf;
  try {
    if (enc.includes("br")) return brotliDecompressSync(buf);
    if (enc.includes("gzip")) return gunzipSync(buf);
    if (enc.includes("deflate")) return inflateSync(buf);
  } catch {
    // Fall through — caller will see the raw bytes.
  }
  return buf;
}

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
        // Cloudflare compresses responses when we advertise accept-encoding
        // (which we MUST, to look like Chrome). Decode before handing back.
        const raw = Buffer.concat(chunks);
        const encoding =
          headers["content-encoding"] ||
          (Array.isArray(headers["content-encoding"])
            ? headers["content-encoding"][0]
            : headers["content-encoding"]);
        const text = decodeBody(raw, encoding).toString("utf8");

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

// ─────────────── warmed board session POOL (v6 — true rate-limit bypass) ───
//
// The board's session+token pair is reusable for ~minutes (verified v4).
// With the full Chrome fingerprint in place, a 403 now means the session
// is genuinely dead — not "the board is rate-limiting us". So we keep a
// small POOL of sessions and rotate round-robin; a 403 invalidates just
// that one slot and warms a replacement, instead of throwing the whole
// pipeline under the bus.
//
// ShowResult.php still validates ALL of: PHPSESSID cookie + ResultToken +
// X-Requested-With header. The board's own SearchScripts.js performs this
// exact two-step flow in the browser — we mirror it with the XHR_HEADERS
// constant above.

const SESSION_TTL = 4 * 60 * 1000; // board sessions live ~5 min, refresh at 4
const POOL_SIZE = 3; // three warmed sessions, rotated round-robin
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sessionPool = [];
for (let i = 0; i < POOL_SIZE; i++) sessionPool.push({ sid: "", token: "", at: 0, dead: false });
let poolIdx = 0;

// Backwards-compat handle for the legacy single-session exports below.
const bisepSession = {
  get sid() { return sessionPool[0].sid; },
  get token() { return sessionPool[0].token; },
  get at() { return sessionPool[0].at; },
  set sid(v) { sessionPool[0].sid = v; },
  set token(v) { sessionPool[0].token = v; },
  set at(v) { sessionPool[0].at = v; },
};

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

/** GET / once → PHPSESSID cookie + ResultToken. Writes the result into the
 *  given `slot` object (one of sessionPool[i]) and returns it, or null when
 *  the board cannot be reached. */
async function warmSessionInto(slot, deadline) {
  if (Date.now() > deadline - 1500) return null;
  const r = await h2Fetch(HOME_PRIMARY, Math.min(5000, deadline - Date.now() - 300));
  if (r.status === 200 && r.text && !isChallenge(r.text)) {
    const sc = r.headers && r.headers["set-cookie"];
    const scStr = Array.isArray(sc) ? sc.join("; ") : String(sc || "");
    const sid = (scStr.match(/PHPSESSID=([^;]+)/i) || [])[1] || "";
    const token = extractResultToken(r.text);
    if (sid && token) {
      slot.sid = sid;
      slot.token = token;
      slot.at = Date.now();
      slot.dead = false;
      return slot;
    }
  }
  return null;
}

/** Pick the next live slot from the pool, round-robin. If the chosen slot
 *  is stale/dead, warm it first. Returns a usable slot or null. */
async function pickSession(deadline) {
  const slot = sessionPool[poolIdx];
  poolIdx = (poolIdx + 1) % POOL_SIZE;
  const fresh = slot.sid && slot.token && !slot.dead &&
    Date.now() - slot.at < SESSION_TTL;
  if (fresh) return slot;
  return await warmSessionInto(slot, deadline);
}

/** Legacy wrapper: warm the FIRST slot. Kept so the __internals export surface
 *  stays unchanged for any test that called warmSession directly. */
async function warmSession(deadline) {
  return await warmSessionInto(sessionPool[0], deadline);
}

function invalidateSession() {
  for (const s of sessionPool) {
    s.sid = "";
    s.token = "";
    s.at = 0;
    s.dead = false;
  }
}

/** Invalidate just one slot (called when its session 403'd). */
function invalidateSlot(slot) {
  slot.sid = "";
  slot.token = "";
  slot.at = 0;
  slot.dead = true;
}

/** Roll lookup through the warmed board flow — v6 retry engine.
 *
 *  With the full Chrome fingerprint, a 403 means the session/token pair is
 *  genuinely dead — NOT "the board is rate-limiting us" (verified Oct 2026:
 *  the PHP backend has no rate-limit counter at all). So we:
 *    1. Pick a live session from the pool (round-robin), warming if needed.
 *    2. Try the lookup once.
 *    3. On 403, invalidate that slot, pick a FRESH session, try once more.
 *    4. Return whatever the origin gave us — 200 marksheet, 403, 404, …
 *
 *  No spaced backoff, no probabilistic retry loop — the v5 design was solving
 *  a problem that did not exist. Total worst-case = 1 homepage GET + 1 roll
 *  GET + 1 homepage GET + 1 roll GET = ~3 s, well inside the 9.2 s deadline.
 */
async function fetchRollWarmed(roll, deadline) {
  if (h2Disabled()) return { status: 0, text: "", via: "none" };

  // ── Attempt 1: pick a live session from the pool ──
  let session = await pickSession(deadline);
  if (!session) return { status: 0, text: "", via: "none" };

  const url1 =
    ROLL_PRIMARY +
    "?Search=RollNo&RollNo=" +
    encodeURIComponent(roll) +
    "&token=" +
    encodeURIComponent(session.token);
  // Merge XHR_HEADERS (Chrome fingerprint) with the per-session cookie.
  // Using a fresh object so we never mutate the shared XHR_HEADERS constant.
  const headers1 = { ...XHR_HEADERS, cookie: "PHPSESSID=" + session.sid };
  const r1 = await h2Fetch(url1, Math.min(6000, deadline - Date.now() - 300), 2, headers1);

  if (r1.status === 200 && r1.text && !isChallenge(r1.text))
    return { status: 200, text: r1.text, via: "h2-warmed" };

  // Any non-403 origin answer (404 / 500 / etc.) is meaningful — return it.
  if (r1.status !== 0 && r1.status !== 403 && r1.text && !isChallenge(r1.text))
    return { status: r1.status, text: r1.text, via: "h2-warmed" };

  // 403 or network failure → that session is dead. Invalidate its slot and
  // try once with a FRESH session.
  if (r1.status === 403) invalidateSlot(session);

  if (Date.now() > deadline - 3000) return r1.status === 403 ? { status: 403, text: r1.text, via: "h2-warmed" } : { status: 0, text: "", via: "none" };

  // ── Attempt 2: fresh session (warming a different slot in the pool) ──
  const fresh = await pickSession(deadline);
  if (!fresh) {
    return r1.status === 403 ? { status: 403, text: r1.text, via: "h2-warmed" } : { status: 0, text: "", via: "none" };
  }

  const url2 =
    ROLL_PRIMARY +
    "?Search=RollNo&RollNo=" +
    encodeURIComponent(roll) +
    "&token=" +
    encodeURIComponent(fresh.token);
  const headers2 = { ...XHR_HEADERS, cookie: "PHPSESSID=" + fresh.sid };
  const r2 = await h2Fetch(url2, Math.min(6000, deadline - Date.now() - 300), 2, headers2);

  if (r2.status === 200 && r2.text && !isChallenge(r2.text))
    return { status: 200, text: r2.text, via: "h2-warmed" };
  if (r2.status !== 0 && r2.text && !isChallenge(r2.text))
    return { status: r2.status, text: r2.text, via: "h2-warmed" };

  return r1.status === 403
    ? { status: 403, text: r1.text, via: "h2-warmed" }
    : { status: 0, text: "", via: "none" };
}

/** Liveness probe (only used when the homepage gives no other signal). */
async function probeRollEndpoint(deadline) {
  if (!h2Disabled() && Date.now() < deadline - 2500) {
    const s = await pickSession(deadline);
    if (s) {
      const headers = { ...XHR_HEADERS, cookie: "PHPSESSID=" + s.sid };
      const r = await h2Fetch(
        ROLL_PRIMARY + "?Search=RollNo&RollNo=1&token=" + encodeURIComponent(s.token),
        Math.min(5000, deadline - Date.now() - 300),
        2,
        headers
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
 *  is safe. With v6's true rate-limit bypass, the only reason to retry is a
 *  genuinely dead session (rare with the full Chrome fingerprint), so the
 *  short-fail TTL is the only guard against re-hitting the board. */
const rollCache = new Map();
const ROLL_TTL = 6 * 60 * 60 * 1000; // 6 h — found marksheets are final
const ROLL_MISS_TTL = 60 * 1000; // not-found — brief, late publishes happen
const ROLL_FAIL_TTL = 5 * 1000; // 403 / network — a retry in 5 s genuinely
// re-queries the board (v5 cached "busy" 3 s, but the word "busy" implied a
// rate limit that does not exist; v6 calls it what it is — a transient fail).

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

  // A 403 "Invalid request." after BOTH attempts means the board rejected the
  // session even with a fresh warm + full Chrome fingerprint. Rare — but if it
  // happens, give the user a 5 s memory guard and an honest message. v5
  // called this "rate limited / too many requests" which was a misdiagnosis
  // (the PHP backend has no rate-limit counter — confirmed Oct 2026).
  if (r.status === 403) {
    const retry = {
      found: false,
      error:
        "BISE Peshawar's session expired. Please tap Search again — it will load on the very next try.",
      message:
        "BISE Peshawar's session expired. Please tap Search again — it will load on the very next try.",
      retry: true,
    };
    rollCachePut(roll, retry, ROLL_FAIL_TTL);
    setRollCacheHeader(res, 5);
    res.status(200).json(retry);
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
  warmSessionInto,
  pickSession,
  invalidateSession,
  invalidateSlot,
  fetchRollWarmed,
  extractResultToken,
  dmcCollectValue,
  buildMarksheet,
  parseSubjects,
  sessionRef: () => sessionPool[0],
  sessionPoolRef: () => sessionPool,
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
