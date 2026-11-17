// api/_lib/bisep-draw-core.js — BISE Peshawar Supervisory Draw lookup
// ═══════════════════════════════════════════════════════════════════════════
// NOT a Vercel function (underscore folder = helper only). It is served by
// api/public-data.js via `?kind=draw` and exposed as /api/bisep-draw through a
// vercel.json rewrite, so the project STAYS AT 11 FUNCTIONS (Hobby max = 12).
//
//   /api/bisep-draw?mode=sources                      → draw sessions list
//   /api/bisep-draw?mode=preview&source=theory        → first drawn staff (masked)
//   /api/bisep-draw?source=theory&by=cnic&value=…     → personal lookup
//
// Board: POST https://bisep.edu.pk/<DrawDir>/SearchDraw.php  Search=…&by=3|2
// The board sits behind Cloudflare (TLS-fingerprint scoring), so every call
// uses a transport ladder (fetch → http2 → https), paced retries with jitter,
// and failures are never cached.
//
// ── AUTO-DISCOVERY (v2 — permanent-connection, never-stale) ────────────────
// The board publishes FOUR supervisory draws per year (SSC A-I, HSSC A-I,
// SSC A-II, HSSC A-II) at predictable dir names:
//     Draw{SSC|HSSC}{YYYY}A{1|2}        → theory
//     Draw{SSC|HSSC}{YYYY}A{1|2}Pract   → practical
// Old dirs are taken offline (404) once the cycle closes. The PREVIOUS version
// of this file hardcoded `DrawSSC2026A2` as the only source, so the day BISEP
// published HSSC Annual-II 2026 at `DrawHSSC2026A2` the website kept showing
// the old SSC draw. This version DISCOVERS the live draw at runtime:
//
//   1. Admin override   — BISEP_DRAW_SOURCES_JSON env var (manual pin, rarely
//                         needed; kept for emergencies + backward compat).
//   2. LKG cache        — last-known-good sources from this warm lambda,
//                         refreshed every 10 min. Survives brief board hiccups
//                         so the site never shows a stale hardcoded title.
//   3. Homepage scan    — fetch https://bisep.edu.pk/ and read the anchor the
//                         board itself advertises as "Supervisory Staff Draw -
//                         {SSC|HSSC} Annual-{I|II} Exam {YYYY}". This is the
//                         board's own signal of "the current draw".
//   4. Probe ladder     — if the homepage is unreachable, GET each candidate
//                         dir in cycle-recency order (HSSC A2 → SSC A2 → HSSC
//                         A1 → SSC A1, current year then previous year) and
//                         accept the first that returns a "Staff Draw" page.
//   5. Legacy fallback  — only when the board is fully unreachable AND there
//                         is no LKG cache. Uses a neutral session label
//                         ("BISE Peshawar") so the page never lies about which
//                         exam is current; the live title returns the moment
//                         the board is reachable again.
//
// Practical source: derived as `${theoryDir}Pract` and probed once. If the
// board hasn't published the practical draw yet (typical: practicals come a
// few days after theory), the practical source is OMITTED and the Duties page
// shows only the Theory tab — when the practical draw is published, the next
// 10-minute discovery cycle adds it back automatically.
// ═══════════════════════════════════════════════════════════════════════════
import http2 from "node:http2";
import https from "node:https";

const HOST = "https://bisep.edu.pk";

// Legacy fallback — ONLY used when the board is fully unreachable AND no LKG
// cache exists. The session label is deliberately neutral so the page never
// lies about which exam is current; the dir still points at the most recent
// known draw so a lookup attempt degrades gracefully ("board did not respond")
// instead of crashing.
const LEGACY_FALLBACK = {
  theory:    { label: "Theory Duties",    session: "BISE Peshawar", dir: "DrawSSC2026A2" },
  practical: { label: "Practical Duties", session: "BISE Peshawar", dir: "DrawSSC2026A2Pract" },
};

// ── Env override (manual admin pin) ─────────────────────────────────────────
function readEnvSources() {
  try {
    const raw = process.env.BISEP_DRAW_SOURCES_JSON;
    if (!raw) return null;
    const j = JSON.parse(raw);
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (/^[a-z0-9_-]{1,24}$/i.test(k) && v && /^[A-Za-z0-9_]{3,40}$/.test(v.dir || "")) {
        out[k] = { label: String(v.label || k).slice(0, 40), session: String(v.session || "").slice(0, 60), dir: v.dir };
      }
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

// ── Homepage scan ───────────────────────────────────────────────────────────
// The board advertises the current draw on its homepage as:
//   <a href="https://bisep.edu.pk/DrawHSSC2026A2/" ...><h3>Supervisory Staff
//   Draw - HSSC Annual-II Exam 2026</h3></a>
// This regex finds every such anchor and returns the parsed draw descriptors
// in document order.
const HOME_ANCHOR_RE = /<a\b[^>]*?href=["'](?:https?:\/\/(?:www\.)?bisep\.edu\.pk)?\/(Draw(?:SSC|HSSC)\d{4}A[12])\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
const HOME_TITLE_RE = /Supervisory\s+Staff\s+Draw\s*[-\u2013\u2014]\s*(SSC|HSSC)\s+Annual-(I{1,2})\s+Exam(?:ination)?\s+(\d{4})/i;
function parseHomeDrawLinks(html) {
  const out = [];
  let m;
  while ((m = HOME_ANCHOR_RE.exec(html))) {
    const dir = m[1];
    const innerText = m[2].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/gi, " ").replace(/\s+/g, " ").trim();
    const tm = innerText.match(HOME_TITLE_RE);
    if (!tm) continue;
    const exam = tm[1].toUpperCase();
    const attempt = tm[2].toUpperCase() === "II" ? "A2" : "A1";
    const year = parseInt(tm[3], 10);
    out.push({
      dir,
      exam,
      attempt,
      year,
      sessionLabel: `${exam} Annual-${tm[2].toUpperCase()} Examination ${year}`,
    });
  }
  // De-duplicate by dir (the homepage sometimes repeats the same link in
  // multiple sidebars); keep first occurrence's document order.
  const seen = new Set();
  return out.filter((d) => (seen.has(d.dir) ? false : (seen.add(d.dir), true)));
}

// Pick the latest draw by (year, attempt, exam-preference, document-order).
// Higher year wins; within same year, A2 > A1; within same year+attempt,
// HSSC > SSC (HSSC is published slightly later in the fall cycle); on full
// ties, the LAST match in document order wins (homepage typically prepends
// newer items, so last = most recently added).
function pickLatestDraw(draws) {
  if (!draws.length) return null;
  const rank = (d, idx) =>
    d.year * 1_000_000 +
    (d.attempt === "A2" ? 20_000 : 10_000) +
    (d.exam === "HSSC" ? 1_000 : 0) +
    idx;
  return draws.reduce((best, d, i) => (best && rank(best, i - 1) >= rank(d, i) ? best : d), null);
}

// ── Probe ladder (fallback when the homepage is unreachable) ────────────────
function probeCandidates() {
  const now = new Date();
  // Use UTC year so the lambda's clock timezone doesn't shift the candidate
  // set near midnight on Dec 31 / Jan 1.
  const years = [now.getUTCFullYear(), now.getUTCFullYear() - 1];
  // Cycle recency within a year: HSSC A2 (fall) → SSC A2 (fall) → HSSC A1
  // (spring/summer) → SSC A1 (spring). Matches the board's typical publishing
  // order, so the first hit is the most likely "current" draw.
  const exams = [
    { exam: "HSSC", attempt: "A2" },
    { exam: "SSC",  attempt: "A2" },
    { exam: "HSSC", attempt: "A1" },
    { exam: "SSC",  attempt: "A1" },
  ];
  const out = [];
  for (const y of years) for (const e of exams) out.push({ exam: e.exam, attempt: e.attempt, year: y, dir: `Draw${e.exam}${y}${e.attempt}` });
  return out;
}

// ── Source discovery (with LKG cache + in-flight de-dupe + sticky fallback) ──
// Permanent-connection design (mirrors the v2 pattern in useBisepCurrentExam):
//   • Fresh LKG (within TTL)      → serve instantly, no network.
//   • LKG stale, discovery OK     → refresh LKG, serve fresh.
//   • LKG stale, discovery FAILS  → serve STICKY LKG (the last draw the board
//     actually published) + retry every FAIL_BACKOFF seconds. The page keeps
//     showing the real draw title throughout a board outage instead of
//     dropping to the neutral "BISE Peshawar" label. The moment the board is
//     reachable again — or publishes a NEW draw — the next retry picks it up.
//   • No LKG at all (first-ever visit while board unreachable) → legacy
//     fallback with neutral label. Retry every FAIL_BACKOFF seconds.
const SOURCES_TTL = 10 * 60 * 1000;   // 10 min — board publishes a few draws per year
const FAIL_BACKOFF = 30 * 1000;       // 30 s between retries after a failed discovery
let LKG_SOURCES = null;               // { sources, at } — warm-lambda memory
let SOURCES_PROMISE = null;           // in-flight de-dupe
let LAST_FAIL_AT = 0;                 // ms timestamp of last failed discovery

// Probe a candidate dir. Returns { dir, session } if it's a real "Staff Draw"
// page, else null. (boardFetch + findSession are defined further down in this
// file; module scoping makes them available at runtime.)
async function probeDrawDir(dir) {
  const r = await boardFetch(`${HOST}/${dir}/`, { method: "GET", attempts: 2, perTry: 2600, minLen: 200 });
  if (r.fail) return null;
  const html = r.buf.toString("utf8");
  if (!/Staff\s+Draw/i.test(html)) return null; // 404 pages can still 200 with a generic body
  const session = findSession(html);
  if (!session) return null;
  return { dir, session, html };
}

// Derive practical source from a theory dir: `${theoryDir}Pract`. Probes once;
// returns { dir, session } or null when the practical draw isn't published yet.
async function probePracticalFor(theoryDir, fallbackSession) {
  const practDir = `${theoryDir}Pract`;
  const probe = await probeDrawDir(practDir);
  if (!probe) return null;
  return { dir: practDir, session: probe.session || fallbackSession };
}

async function discoverSourcesFromHomepage() {
  const r = await boardFetch(`${HOST}/`, { method: "GET", attempts: 2, perTry: 3000, minLen: 2000 });
  if (r.fail) return null;
  const draws = parseHomeDrawLinks(r.buf.toString("utf8"));
  return pickLatestDraw(draws);
}

async function discoverSources() {
  // 1. Admin override wins over everything (manual pin).
  const env = readEnvSources();
  if (env) return env;

  // 2. Fresh LKG cache (within TTL) → serve instantly, no network.
  if (LKG_SOURCES && Date.now() - LKG_SOURCES.at < SOURCES_TTL) {
    return LKG_SOURCES.sources;
  }

  // 2b. Backoff — if the last discovery failed recently, serve sticky LKG (or
  // legacy fallback) without re-attempting. Prevents hammering the board
  // during an outage while keeping recovery fast (30 s).
  if (Date.now() - LAST_FAIL_AT < FAIL_BACKOFF) {
    return LKG_SOURCES ? LKG_SOURCES.sources : { ...LEGACY_FALLBACK };
  }

  // De-dupe concurrent discovery runs.
  if (SOURCES_PROMISE) return SOURCES_PROMISE;
  SOURCES_PROMISE = (async () => {
    try {
      let theory = null;
      let practical = null;

      // 3. Homepage scan — the board's own "current draw" signal.
      const hp = await discoverSourcesFromHomepage();
      if (hp) {
        theory = { label: "Theory Duties", session: hp.sessionLabel, dir: hp.dir };
        practical = await probePracticalFor(hp.dir, hp.sessionLabel);
      }

      // 4. Probe ladder — only if the homepage scan found nothing.
      if (!theory) {
        for (const c of probeCandidates()) {
          const probe = await probeDrawDir(c.dir);
          if (!probe) continue;
          theory = { label: "Theory Duties", session: probe.session, dir: c.dir };
          practical = await probePracticalFor(c.dir, probe.session);
          break; // first hit = most likely "current" draw
        }
      }

      let sources;
      if (theory) {
        // Fresh discovery succeeded — update LKG, clear fail state.
        sources = practical ? { theory, practical } : { theory };
        LKG_SOURCES = { sources, at: Date.now() };
        LAST_FAIL_AT = 0;
      } else if (LKG_SOURCES) {
        // 5. STICKY LKG — discovery failed but we have a known-good dir from a
        // previous successful run. Keep serving it (the real draw title stays
        // on the page) and back off for 30 s before the next retry. The board's
        // actual lookup endpoint is still tried on each user search — if the
        // board is reachable for lookups but not for the homepage scan, the
        // user still gets their result; if the board is fully down, the lookup
        // fails gracefully with "board did not respond".
        LAST_FAIL_AT = Date.now();
        sources = LKG_SOURCES.sources;
      } else {
        // 6. True legacy fallback — first-ever visit while the board is fully
        // unreachable AND no LKG cache exists. Neutral session label so the
        // page never lies about which exam is current.
        LAST_FAIL_AT = Date.now();
        sources = { ...LEGACY_FALLBACK };
      }
      return sources;
    } finally {
      SOURCES_PROMISE = null;
    }
  })();
  return SOURCES_PROMISE;
}

async function getSources() {
  return await discoverSources();
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => a + Math.floor(Math.random() * (b - a));

// ── Input normalisation ─────────────────────────────────────────────────────
export function normaliseQuery(by, value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (by === "cnic") {
    if (digits.length !== 13) return { error: "Enter a valid 13-digit CNIC (e.g. 17301-9088542-1)." };
    return { by: "3", search: digits };
  }
  if (by === "mobile") {
    let d = digits;
    if (d.startsWith("92") && d.length === 12) d = d.slice(2);
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length !== 10 || d[0] !== "3") return { error: "Enter a valid mobile number (e.g. 0301 2345678)." };
    return { by: "2", search: d };
  }
  return { error: "Choose CNIC or Mobile." };
}

/** Board returns 3459162160 (no leading 0) → 0345 9162160 */
export function fmtMobile(m) {
  let d = String(m || "").replace(/\D/g, "");
  if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d[0] === "3") d = "0" + d;
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4)}` : String(m || "").trim();
}

export function maskMobile(m) {
  const d = fmtMobile(m).replace(/\D/g, "");
  if (d.length < 8) return "••••";
  return d.slice(0, 4) + " •••• " + d.slice(-3);
}

// ── HTML helpers ────────────────────────────────────────────────────────────
const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022", middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", laquo: "\u00ab", raquo: "\u00bb" };
const decodeOnce = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] ?? m));
const decode = (s) => decodeOnce(decodeOnce(s)); // twice: the board sometimes double-encodes (&amp;ldquo;)
const text = (h) => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const FIELD_MAP = [
  [/center\s*no/i, "centerNo"],
  [/^name/i, "name"],
  [/designation/i, "designation"],
  [/address|institute/i, "institute"],
  [/mobile/i, "mobile"],
  [/appointed/i, "appointedAs"],
];
const mapField = (label) => { for (const [re, k] of FIELD_MAP) if (re.test(label)) return k; return null; };

function findLetters(html) {
  const out = [];
  const re = /href=["']([^"']*PrintLetter(?:Sup|DSup|Invg)\.php\?ID=\d+&(?:amp;)?key=[0-9a-f]{40})["']/gi;
  let m;
  while ((m = re.exec(html))) out.push(decode(m[1]));
  return out;
}
const absLetter = (dir, href) => {
  if (/^https?:/i.test(href)) return href;
  return `${HOST}/${dir}/${href.replace(/^\.?\//, "")}`;
};

// Orientation / instruction notes shown on the board's form page.
function findNotes(html) {
  const out = [];
  const re = /<(?:li|p)[^>]*>([\s\S]*?)<\/(?:li|p)>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 6) {
    const t = text(m[1]);
    if (t.length > 25 && t.length < 400 && /orientation|workshop|training|report|venue/i.test(t)) out.push(t);
  }
  return out;
}

// Session title read LIVE off the board's own draw page, e.g.
//   "Supervisory Staff Draw - SSC Annual-II Examination 2026"  (theory)
//   "Practical Staff Draw - SSC Annual-II Examination 2026"     (practical)
// → returns "SSC Annual-II Examination 2026". The board switches wording between
// theory/practical pages, so both prefixes are matched.
const TITLE_RE = /(?:Supervisory|Practical)\s+Staff\s+Draw\s*[-\u2013\u2014]\s*([^<]{5,90})/i;
export function findSession(html) {
  const m = String(html || "").match(TITLE_RE);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** Personal lookup response → { selected, details, letter?, notes } */
export function parseDrawHtml(html, dir) {
  const plain = text(html);
  if (/not selected by the computer/i.test(plain)) return { selected: false, details: {}, notes: findNotes(html) };
  const details = {};
  const rowRe = /<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const k = mapField(text(m[1]).replace(/:$/, ""));
    const v = text(m[2]);
    if (k && v && !details[k]) details[k] = k === "mobile" ? fmtMobile(v) : v;
  }
  const letters = findLetters(html);
  const selected = Object.keys(details).length >= 3;
  return {
    selected,
    details,
    letter: selected && letters[0] ? absLetter(dir, letters[0]) : null,
    notes: findNotes(html),
  };
}

/** Bare GET preview → up to 5 staff with masked mobiles */
export function parseDrawListHtml(html, dir) {
  const letters = findLetters(html);
  // Scan label/value cell PAIRS in document order; every "Center No" label cell
  // starts a new staff record. (The previous version split the HTML right before
  // the text "Center No", which cut that label's own <td> in half — the pair
  // regex then matched nothing and the preview table came back empty.)
  const cells = [...html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => text(m[1]));
  const out = [];
  let rec = null;
  for (let i = 0; i < cells.length; i++) {
    const label = cells[i].replace(/:\s*$/, "").trim();
    if (/^center\s*no$/i.test(label)) {
      rec = {}; out.push(rec);
      const v = (cells[i + 1] || "").trim();
      if (v) { rec.centerNo = v; i += 1; }
      continue;
    }
    if (!rec) continue;
    const k = mapField(label);
    if (!k || rec[k]) continue;
    const v = (cells[i + 1] || "").trim();
    if (!v) continue;
    rec[k] = k === "mobile" ? maskMobile(v) : v;
    i += 1; // the value cell is consumed
  }
  out.forEach((r, idx) => { if (letters[idx]) r.letter = absLetter(dir, letters[idx]); });
  return out.filter((r) => r.centerNo || r.name).slice(0, 5);
}

// ── Transport ladder ────────────────────────────────────────────────────────
const isChallenge = (status, buf) => {
  const head = buf.subarray(0, 4000).toString("utf8");
  return status === 403 || status === 429 || status === 503 || /enable javascript and cookies|just a moment|cf-chl/i.test(head);
};

async function viaFetch(url, method, body, headers, signal) {
  const r = await fetch(url, { method, headers, body, signal, redirect: "follow" });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
}
function viaHttp2(url, method, body, headers, signal) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const c = http2.connect(u.origin);
    const done = (fn, v) => { try { c.close(); } catch {} fn(v); };
    c.on("error", (e) => done(reject, e));
    const req = c.request({ ":method": method, ":path": u.pathname + u.search, ":authority": u.host, ...headers });
    let status = 0; const chunks = [];
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => done(resolve, { status, buf: Buffer.concat(chunks) }));
    req.on("error", (e) => done(reject, e));
    signal?.addEventListener("abort", () => { try { req.close(); } catch {} done(reject, new Error("timeout")); });
    if (body) req.write(body);
    req.end();
  });
}
function viaHttps(url, method, body, headers, signal) {
  return new Promise((resolve, reject) => {
    const r = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    signal?.addEventListener("abort", () => { r.destroy(); reject(new Error("timeout")); });
    if (body) r.write(body);
    r.end();
  });
}
const LADDER = [viaFetch, viaHttp2, viaHttps];

/** Generic board request → { buf } | { fail }. Binary-safe (letters, signature image). */
async function boardFetch(url, { method = "GET", form, referer, attempts = 3, perTry = 3200, minLen = 200 } = {}) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  let lastDetail = "unreachable";
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await sleep(jitter(400, 750) * attempt);
    const headers = {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: referer || `${HOST}/`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded", origin: HOST } : {}),
    };
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), perTry);
    try {
      const { status, buf } = await LADDER[attempt % LADDER.length](url, method, body, headers, ac.signal);
      if (isChallenge(status, buf)) { lastDetail = "cloudflare-challenge"; continue; }
      if (status >= 200 && status < 300 && buf.length >= minLen) return { buf };
      lastDetail = `http-${status}`;
    } catch (e) {
      lastDetail = String(e?.message || "network").slice(0, 60);
    } finally { clearTimeout(t); }
  }
  return { fail: lastDetail };
}

async function boardRequest(dir, method, form, opts = {}) {
  const r = await boardFetch(`${HOST}/${dir}/SearchDraw.php`, {
    method, form, referer: `${HOST}/${dir}/`,
    ...(opts.attempts ? { attempts: opts.attempts } : {}),
    ...(opts.perTry ? { perTry: opts.perTry } : {}),
  });
  return r.fail ? r : { html: r.buf.toString("utf8") };
}

// ── Official duty letter → structured lines (verbatim text, nothing invented) ──
const LETTER_RE = /^https:\/\/bisep\.edu\.pk\/[A-Za-z0-9_]{3,40}\/PrintLetter(?:Sup|DSup|Invg)\.php\?ID=\d+&key=[0-9a-f]{40}$/;

function classSets(html) {
  const sets = { b: new Set(), u: new Set(), c: new Set() };
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html))) {
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let r;
    while ((r = ruleRe.exec(m[1]))) {
      // only bare ".class" selectors — "table.gridtable td" etc. must NOT style every element with that class
      const cls = r[1].split(",").map((x) => x.trim()).filter((x) => /^\.[A-Za-z0-9_-]+$/.test(x)).map((x) => x.slice(1));
      if (!cls.length) continue;
      const css = r[2];
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) cls.forEach((c) => sets.b.add(c));
      if (/text-decoration[^;]*underline/i.test(css)) cls.forEach((c) => sets.u.add(c));
      if (/text-align\s*:\s*center/i.test(css)) cls.forEach((c) => sets.c.add(c));
    }
  }
  return sets;
}

/** HTML → [{ row, col, runs:[{t,b?,u?}], center?, img? }] in reading order. */
export function parseLetterHtml(html) {
  const cls = classSets(html);
  const bodyAt = html.search(/<body/i);
  let src = (bodyAt >= 0 ? html.slice(bodyAt) : html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|title|noscript|head)\b[\s\S]*?<\/\1>/gi, "");
  const VOID = new Set(["br", "img", "hr", "input", "meta", "link"]);
  const BLOCK = new Set(["p", "div", "tr", "li", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "center", "hr", "br", "tbody", "thead", "form"]);
  const stack = [];
  const lines = [];
  let rowCounter = 0, rowId = 0, colIdx = 0, inRow = 0;
  let gridOff = 0;      // grid column where the current <td> starts (colspan-aware)
  let cellMeta = null;  // { g, span, w } of the currently open <td>
  let cur = null;
  const olCount = [];
  let pendingList = null;
  let liOpen = 0;
  const tblStack = [];
  let tblCounter = 0;

  const flags = () => ({
    b: stack.some((e) => e.b),
    u: stack.some((e) => e.u),
    // The board's letter table carries align="center", but its paragraphs are
    // align="justify" divs — justify wins over center so prose reads flush-left
    // exactly like the board's own printed letter.
    center: stack.some((e) => e.c) && !stack.some((e) => e.j),
    right: stack.some((e) => e.r) && !stack.some((e) => e.j),
    box: stack.some((e) => e.bx),
    skip: stack.some((e) => e.skip),
  });
  const flush = () => {
    if (cur && cur.runs.length && cur.runs.some((r) => r.t.trim())) {
      // trim edges
      cur.runs[0].t = cur.runs[0].t.replace(/^\s+/, "");
      cur.runs[cur.runs.length - 1].t = cur.runs[cur.runs.length - 1].t.replace(/\s+$/, "");
      lines.push(cur);
    }
    cur = null;
  };
  const start = () => {
    if (cur) return cur;
    if (!inRow) rowId = ++rowCounter;
    const f = flags();
    const meta = inRow ? cellMeta : null;
    cur = {
      row: rowId,
      col: meta ? meta.g : inRow ? colIdx : 0,
      tbl: tblStack.length ? tblStack[tblStack.length - 1] : 0,
      runs: [],
      ...(meta && meta.span > 1 ? { span: meta.span } : {}),
      ...(meta && meta.w ? { w: meta.w } : {}),
      ...(f.center ? { center: 1 } : {}),
      ...(f.right ? { right: 1 } : {}),
      ...(f.box ? { box: 1 } : {}),
    };
    return cur;
  };
  const addText = (raw) => {
    if (flags().skip) return;
    const t = decode(raw).replace(/\s+/g, " ");
    if (!t.trim() && !cur) return;
    if (pendingList) { const l = start(); l.runs.push({ t: pendingList, b: 1 }); pendingList = null; flush(); colIdx++; }
    const l = start();
    const f = flags();
    l.runs.push({ t, ...(f.b ? { b: 1 } : {}), ...(f.u ? { u: 1 } : {}) });
  };

  const tokRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = tokRe.exec(src))) {
    if (m[4] !== undefined) { addText(m[4]); continue; }
    const closing = !!m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3] || "";
    if (closing) {
      if (tag === "td" || tag === "th") { flush(); cellMeta = null; }
      else if (BLOCK.has(tag)) flush();
      if (tag === "tr") { inRow = Math.max(0, inRow - 1); colIdx = 0; gridOff = 0; cellMeta = null; }
      if (tag === "li" && liOpen > 0) { liOpen -= 1; inRow = Math.max(0, inRow - 1); colIdx = 0; }
      if (tag === "ol") olCount.pop();
      if (tag === "table" || tag === "ol") tblStack.pop();
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i >= 0) stack.length = i;
      continue;
    }
    if (BLOCK.has(tag) && tag !== "tr") flush();
    if (tag === "img") {
      flush();
      const sm = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
      if (sm) {
        if (!inRow) rowId = ++rowCounter;
        if (!flags().skip) {
          const meta = inRow ? cellMeta : null;
          const f = flags();
          lines.push({
            row: rowId,
            col: meta ? meta.g : inRow ? colIdx : 0,
            tbl: tblStack.length ? tblStack[tblStack.length - 1] : 0,
            img: decode(sm[1]),
            ...(meta && meta.span > 1 ? { span: meta.span } : {}),
            ...(meta && meta.w ? { w: meta.w } : {}),
            ...(f.center ? { center: 1 } : {}),
            ...(f.right ? { right: 1 } : {}),
            ...(f.box ? { box: 1 } : {}),
          });
        }
      }
      continue;
    }
    if (tag === "br" || tag === "hr") continue;
    if (tag === "tr") { flush(); inRow += 1; rowId = ++rowCounter; colIdx = -1; gridOff = 0; cellMeta = null; }
    if (tag === "td" || tag === "th") {
      flush();
      colIdx += 1; if (colIdx < 0) colIdx = 0;
      // colspan → which grid tracks the cell merges; width="27%" → the board's own
      // column geometry. Both are needed to reproduce the letter's real layout.
      const span = Math.min(12, Math.max(1, parseInt((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || "1", 10) || 1));
      const wm = attrs.match(/width\s*=\s*["']?([\d.]+)\s*%/i);
      cellMeta = { g: gridOff, span, w: wm ? Math.min(100, parseFloat(wm[1]) || 0) : 0 };
      gridOff += span;
    }
    if (tag === "ol") olCount.push(0);
    if (tag === "table" || tag === "ol") tblStack.push(++tblCounter);
    if (tag === "li" && olCount.length) {
      olCount[olCount.length - 1] += 1;
      pendingList = olCount[olCount.length - 1] + ".";
      rowId = ++rowCounter; inRow += 1; colIdx = 0; liOpen += 1;
    }
    if (!VOID.has(tag)) {
      const style = (attrs.match(/style\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      const classes = ((attrs.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || "").split(/\s+/).filter(Boolean);
      stack.push({
        tag,
        b: tag === "b" || tag === "strong" || tag === "th" || /h[1-6]/.test(tag) || /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) || classes.some((c) => cls.b.has(c)),
        u: tag === "u" || /text-decoration[^;]*underline/i.test(style) || classes.some((c) => cls.u.has(c)),
        skip: /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style) || classes.some((c) => /^(report-heading|no-?print|hidden|d-none)$/i.test(c)),
        // align="center" on <table> centers the TABLE itself, not the cells' text —
        // browsers do not let it center every line, so neither do we.
        c: tag !== "table" && (tag === "center" || /align\s*=\s*["']?center/i.test(attrs) || /text-align\s*:\s*center/i.test(style) || classes.some((c) => cls.c.has(c))),
        j: /align\s*=\s*["']?justify/i.test(attrs) || /text-align\s*:\s*justify/i.test(style),
        r: /align\s*=\s*["']?right/i.test(attrs) || /text-align\s*:\s*right/i.test(style),
        bx: /border[^:;]*:\s*(?!none|0\b)["']?[\d.]/i.test(style),
      });
    }
  }
  flush();
  return lines;
}

const sniffImage = (buf) => {
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.length > 3 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
};

/** Fetch + parse the board's own letter. Returns { lines } | { fail, pdf? }. */
async function fetchLetterDoc(url, opts = {}) {
  if (!LETTER_RE.test(url)) return { fail: "bad-letter-url" };
  const r = await boardFetch(url, { referer: url.replace(/PrintLetter.*$/, ""), attempts: opts.attempts ?? 2, perTry: opts.perTry ?? 2600, minLen: 100 });
  if (r.fail) return { fail: r.fail };
  if (r.buf.subarray(0, 4).toString("ascii") === "%PDF") return { fail: "letter-is-pdf" };
  const html = r.buf.toString("utf8");
  const lines = parseLetterHtml(html);
  if (lines.length < 5) return { fail: "letter-unreadable" };
  // inline images (signature) as data URIs — same host only, size-capped
  for (const l of lines) {
    if (!l.img) continue;
    if (/^data:image\//i.test(l.img)) continue;
    try {
      const abs = new URL(l.img, url);
      if (abs.hostname !== "bisep.edu.pk") { delete l.img; continue; }
      const ir = await boardFetch(abs.href, { referer: url, attempts: 2, perTry: 2200, minLen: 50 });
      const mime = ir.buf && sniffImage(ir.buf);
      if (ir.fail || !mime || ir.buf.length > 400_000) { delete l.img; continue; }
      l.img = `data:${mime};base64,${ir.buf.toString("base64")}`;
    } catch { delete l.img; }
  }
  return { lines: lines.filter((l) => l.runs || l.img) };
}

// ── Caches (per warm lambda) + in-flight de-dupe ────────────────────────────
const MEM = new Map();
const INFLIGHT = new Map();
// Last session title the board itself reported, per source (warm-lambda memory
// used when the board is briefly unreachable, so the site never shows a stale
// hardcoded title as long as the lambda has ever seen the real one).
const LAST_TITLE = {};
const memGet = (k) => { const e = MEM.get(k); if (e && e.exp > Date.now()) return e.v; MEM.delete(k); return null; };
const memSet = (k, v, ttl) => { if (MEM.size > 300) MEM.clear(); MEM.set(k, { v, exp: Date.now() + ttl }); };
async function once(key, fn) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = fn().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}


/** Returns { status, cache, body } — the caller (public-data.js) writes headers. */
export async function handleDraw(q) {
  // Source discovery is async (homepage scan + probe ladder). The result is
  // LKG-cached per warm lambda for 10 min, so in steady state this resolves
  // instantly. See discoverSources() above for the full fallback chain.
  const SRC = await getSources();
  const mode = q.get("mode") || "";
  const NO = "no-store";
  const OK = "public, max-age=0, s-maxage=600, stale-while-revalidate=120";

  if (mode === "sources") {
    // Discovery already produced the live session title (read straight off the
    // board's homepage or draw page during discoverSources()). No second fetch
    // needed here — the sources list is edge-cached 5 min so the browser sees
    // the latest draw within ~10 min of the board publishing a new one.
    const list = Object.entries(SRC).map(([id, s]) => ({
      id,
      label: s.label,
      session: s.session,
      official_page: `${HOST}/${s.dir}/`,
    }));
    return {
      status: 200,
      cache: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      body: { ok: true, sources: list },
    };
  }

  const sid = q.get("source") || "theory";
  const src = SRC[sid];
  if (!src) return { status: 400, cache: NO, body: { ok: false, error: "Unknown draw session." } };

  if (mode === "preview") {
    const key = `pv:${sid}`;
    const hit = memGet(key);
    if (hit) return { status: 200, cache: "public, max-age=0, s-maxage=900, stale-while-revalidate=300", body: { ...hit, cached: true } };
    const r = await once(key, () => boardRequest(src.dir, "GET"));
    if (r.fail) return { status: 200, cache: NO, body: { ok: false, error: "The board is busy right now.", detail: r.fail } };
    const title = findSession(r.html);
    if (title) { LAST_TITLE[sid] = title; memSet(`ti:${sid}`, title, 6 * 60 * 60 * 1000); }
    const body = { ok: true, source: sid, entries: parseDrawListHtml(r.html, src.dir), fetched_at: new Date().toISOString() };
    memSet(key, body, 30 * 60 * 1000);
    return { status: 200, cache: "public, max-age=0, s-maxage=900, stale-while-revalidate=300", body };
  }

  if (mode === "letter") {
    const ref = String(q.get("ref") || "");
    const url = `${HOST}/${ref}`;
    const lk = `lt:${ref}`;
    const hit = memGet(lk);
    if (hit) return { status: 200, cache: NO, body: { ok: true, letterDoc: hit } };
    const ld = await fetchLetterDoc(url, { attempts: 3, perTry: 3000 });
    if (!ld.lines) return { status: 200, cache: NO, body: { ok: false, error: "letter-unavailable", detail: ld.fail } };
    memSet(lk, ld.lines, 10 * 60 * 1000);
    return { status: 200, cache: NO, body: { ok: true, letterDoc: ld.lines } };
  }

  const n = normaliseQuery(q.get("by"), q.get("value"));
  if (n.error) return { status: 400, cache: NO, body: { ok: false, error: n.error } };

  const key = `lk:${sid}:${n.by}:${n.search}`;
  const hit = memGet(key);
  if (hit) return { status: 200, cache: OK, body: { ...hit, cached: true } };
  const t0 = Date.now();
  const r = await once(key, () => boardRequest(src.dir, "POST", { Search: n.search, by: n.by }));
  if (r.fail) {
    return { status: 200, cache: NO, body: { ok: false, error: "BISE Peshawar's server did not respond. Please try again in a moment.", detail: r.fail } };
  }
  const parsed = parseDrawHtml(r.html, src.dir);
  const letterUrl = parsed.letter;
  delete parsed.letter;
  const body = { ok: true, source: sid, session: src.session, ...parsed, fetched_at: new Date().toISOString() };
  if (parsed.selected && letterUrl) {
    // Fetch the board's own letter in the same call when there is time left; otherwise hand the
    // browser a reference so it can ask once more (keeps us inside the function time limit).
    if (Date.now() - t0 < 4500) {
      const ld = await fetchLetterDoc(letterUrl);
      if (ld.lines) body.letterDoc = ld.lines; else body.letterRef = letterUrl.replace(`${HOST}/`, "");
    } else body.letterRef = letterUrl.replace(`${HOST}/`, "");
  }
  if (!body.letterRef) memSet(key, body, 10 * 60 * 1000);
  return { status: 200, cache: body.letterRef ? NO : OK, body };
}

export const __internals = { parseLetterHtml, fmtMobile, normaliseQuery, parseDrawHtml, parseDrawListHtml, maskMobile, findSession, parseHomeDrawLinks, pickLatestDraw, probeCandidates, discoverSources };
