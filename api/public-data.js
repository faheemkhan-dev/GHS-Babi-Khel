// api/public-data.js — cached public reads (Supabase Optimization Plan · Phase 5)
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//   The React app talks to Supabase REST directly from every visitor's
//   browser. 150 students = 150 separate DB round trips for the SAME public
//   rows (notices, ticker, date sheet, merit lists, roll sessions, class
//   rank pools…). On results day that multiplies into thousands of queries
//   and is exactly what drains the free-plan Disk IO budget.
//
//   This ONE Vercel function is a read-through CDN cache for everything
//   public and read-only. The browser asks /api/public-data?kind=… ;
//   Vercel's edge serves the response to everyone for `s-maxage` seconds,
//   so the database is asked at most ONCE per kind per interval — no matter
//   how many students are online. Personal data (fees, attendance,
//   profiles, notifications) is NEVER served here (Plan 5.2): those keep
//   going straight to Supabase behind auth.
//
// FUNCTION BUDGET NOTE
//   Vercel Hobby allows 12 serverless functions per deployment; this repo
//   had 9 → this is #10. That is why it is ONE consolidated function with a
//   `kind` dispatcher (same pattern as api/render.js and api/seo.js), not
//   one file per table.
//
// SECURITY MODEL
//   • GET only, kind allow-list, strict per-kind param validation. Anything
//     unexpected → 400 (never a proxy for arbitrary queries).
//   • Reads with the SERVICE ROLE key server-side (RLS bypass = cheapest
//     possible query: no per-row policy evaluation at all) but every kind
//     hard-codes the SAME public filters the browser used before
//     (is_published = true, …), so the bytes returned are identical to what
//     anon users could already read. Unpublished/personal rows are never
//     RETURNED — except `result-schedule` (class/exam/year/publish_at only)
//     and `result-rank`, which reads held-back rows of a partially published
//     class so ranks stay true, but returns only id/student_id/percentage.
//   • No secrets, no personal data, nothing user-specific in any response.
//   • Hard 10 s timeout on every Supabase call (a stuck fetch must never
//     hold the function open — that burned IO on the old dispatcher).
//
// CACHE DISCIPLINE (per kind)
//   • 30 s  — things that flip on a countdown or right after an admin
//             publish (notices, ticker, has-results, roll sessions,
//             result rank pools, class averages, result schedule).
//   • 60 s  — latest-exam meta.
//   • 120 s — date sheet, merit entries, roll rosters, library listing.
//   • 300 s — school settings, result years (change a few times a year).
//   Every response also carries `stale-while-revalidate`, so even an expired
//   entry is served instantly and refreshed in the background.
//
// FRESHNESS AT THE EXACT PUBLISH SECOND
//   The client (src/lib/publicData.ts) appends a `_` timestamp to results
//   family kinds for ~75 s after a scheduled publish is confirmed
//   (markPublishBust in autoPublish.ts). A timestamped URL is a NEW cache
//   key, so those few requests always reach origin and every student's
//   refetch sees the just-published rows immediately. Cost: a handful of
//   uncached reads once per publish event — negligible, and it is exactly
//   the burst this whole file exists to survive.
//
// FALLBACK CONTRACT
//   If this function is missing/broken, every hook falls back to the
//   previous direct-Supabase queryFn (src/lib/publicData.ts). The site
//   keeps working unchanged — this layer is an optimization, never a
//   dependency.
// ═══════════════════════════════════════════════════════════════════════════

const SB_TIMEOUT_MS = 10000;

// kind → { s: s-maxage seconds, swr: stale-while-revalidate seconds }
const CACHE = {
  notices:          { s: 30,  swr: 120 },
  notice:           { s: 30,  swr: 120 },
  ticker:           { s: 10,  swr: 20 },   // lists published results → near-live
  settings:         { s: 300, swr: 600 },
  "merit-lists":    { s: 30,  swr: 120 },
  "merit-entries":  { s: 120, swr: 300 },
  "roll-sessions":  { s: 3,   swr: 3 },   // Go Live / Unpublish must reach students within seconds
  "roll-roster":    { s: 120, swr: 300 },
  "exam-schedule":  { s: 120, swr: 300 },
  "all-exam-schedule": { s: 120, swr: 300 },
  library:          { s: 120, swr: 300 },
  "result-years":   { s: 300, swr: 600 },
  "has-results":    { s: 5,   swr: 5 },    // Unpublish must show within seconds
  "latest-exam":    { s: 10,  swr: 10 },
  "result-search-meta": { s: 20, swr: 20 }, // class list + exam-roll shape of one exam
  "result-schedule":{ s: 5,   swr: 10 },
  "result-rank":    { s: 30,  swr: 120 },
  "class-average":  { s: 30,  swr: 120 },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Free text that may reach a filter. Anything else (e.g. Urdu titles, exotic
// punctuation) is REJECTED with 400 → the browser falls back to its direct
// Supabase query — the cache serves the common case, never wrong data.
const SAFE_TEXT_RE = /^[A-Za-z0-9 _\-./]{0,60}$/;

class BadRequest extends Error {}
// Returns the param when it is safe to embed, "" when absent, and throws
// BadRequest when it is present but not cache-safe (caller falls back).
function safeText(q, name) {
  const v = q.get(name);
  if (v === null || v === "") return "";
  if (!SAFE_TEXT_RE.test(v)) throw new BadRequest(`unsafe ${name}`);
  return v;
}

function cfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, ok: !!(url && key) };
}

/** REST call with the service role key + hard timeout. Returns parsed JSON. */
async function sb(path) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} → ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** HEAD/count request (Prefer: count=exact) — returns the total row count. */
async function sbCount(path) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "HEAD",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HEAD ${path.split("?")[0]} → ${res.status}`);
  const range = res.headers.get("content-range") || ""; // "0-11/248"
  const total = range.split("/")[1];
  return Number.parseInt(total, 10) || 0;
}

const enc = encodeURIComponent;
const num = (v, min, max, dflt) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

// ── Per-kind fetchers ───────────────────────────────────────────────────────
// Column lists mirror the exact selects the frontend used before, so the
// JSON shape reaching React never changes (types in the hooks stay valid).

const FETCHERS = {
  // Public notices list (same order as useNotices: pinned first, then recency).
  async notices(q) {
    const limit = num(q.get("limit"), 1, 500, 200);
    const rows = await sb(
      `notices?select=id,title,content,category,is_urgent,is_published,is_pinned,created_at,expires_at,is_poll,poll_options,poll_closes_at` +
      `&is_published=eq.true&order=is_pinned.desc,created_at.desc&limit=${limit}`,
    );
    return rows ?? [];
  },

  // Single notice by id (NOTICE_COLUMNS; same lookup useNoticeItem did — the
  // existing public policy allows reading any single notice by id).
  async notice(q) {
    const id = q.get("id") || "";
    if (!UUID_RE.test(id)) return null;
    const rows = await sb(
      `notices?select=id,title,content,category,is_urgent,is_published,is_pinned,created_at,expires_at,is_poll,poll_options,poll_closes_at` +
      `&id=eq.${id}&limit=1`,
    );
    return rows?.[0] ?? null;
  },

  // News ticker sources in ONE response (was two queries per visitor per 60 s).
  async ticker() {
    const [results, merits] = await Promise.all([
      sb(`results?select=exam_type,year,created_at&is_published=eq.true&order=created_at.desc&limit=80`),
      sb(`merit_lists?select=id,scope,class,exam_type,year,is_published,publish_at,title,notes,created_at` +
         `&is_published=eq.true&order=created_at.desc&limit=6`),
    ]);
    return { results: results ?? [], merits: merits ?? [] };
  },

  // School settings row (id=1). Same column list as useSchoolSettings.
  async settings() {
    const rows = await sb(
      `school_settings?select=id,school_name,tagline,description,about_text,logo_url,banner_url,emis_code,address,phone,email,established_year,total_students,total_teachers,pass_percentage,board_results,location_lat,location_lng,principal_name,principal_message,principal_photo_url` +
      `&id=eq.1&limit=1`,
    );
    return rows?.[0] ?? null;
  },

  // Published merit lists, light columns (no `entries` blob).
  async "merit-lists"() {
    const rows = await sb(
      `merit_lists?select=id,scope,class,exam_type,year,is_published,publish_at,title,notes,created_at,total_students,passing_count,highest_percentage,average_percentage,theme` +
      `&is_published=eq.true&order=created_at.desc&limit=200`,
    );
    return rows ?? [];
  },

  // One merit list's entry blob (big, rarely changes → cached longer).
  async "merit-entries"(q) {
    const id = q.get("id") || "";
    if (!UUID_RE.test(id)) return null;
    const rows = await sb(`merit_lists?select=entries&id=eq.${id}&limit=1`);
    return rows?.[0] ?? null;
  },

  // Roll slip sessions (published or scheduled) — the countdown source.
  async "roll-sessions"() {
    const rows = await sb(
      `exam_roll_sessions?select=*&or=(is_published.eq.true,publish_at.not.is.null)&order=created_at.desc&limit=200`,
    );
    return rows ?? [];
  },

  // One session's roster (public roll slip lookup).
  async "roll-roster"(q) {
    const id = q.get("session") || "";
    if (!UUID_RE.test(id)) return [];
    const rows = await sb(
      `exam_roll_numbers?select=id,student_id,student_name,father_name,class,class_roll_no,exam_roll_no,serial_number` +
      `&session_id=eq.${id}&order=serial_number.asc&limit=2000`,
    );
    return rows ?? [];
  },

  // Date sheet for one class/exam/year (all filters optional, as the hook did).
  async "exam-schedule"(q) {
    let p = `exam_schedule?select=*&is_published=eq.true&order=exam_date.asc&limit=3000`;
    const cls = safeText(q, "class");
    const exam = safeText(q, "exam");
    const year = num(q.get("year"), 1990, 2100, 0);
    if (cls) p += `&class=eq.${enc(cls)}`;
    if (exam) p += `&exam_type=eq.${enc(exam)}`;
    if (year) p += `&year=eq.${year}`;
    const rows = await sb(p);
    return rows ?? [];
  },

  // Whole published date sheet.
  async "all-exam-schedule"() {
    const rows = await sb(`exam_schedule?select=*&is_published=eq.true&order=exam_date.asc&limit=3000`);
    return rows ?? [];
  },

  // Library listing with pagination + optional filters (same shape the hook
  // returned: { data, count }). `count=exact` runs once per cache window.
  // A search/category/class that is not cache-safe → BadRequest → the
  // browser's direct query takes over (correct results, just uncached).
  async library(q) {
    const page = num(q.get("page"), 1, 500, 1);
    const perPage = num(q.get("perPage"), 1, 60, 12);
    const category = safeText(q, "category");
    const cls = safeText(q, "class");
    const search = safeText(q, "search");
    let p = `library_files?select=id,title,category,class,subject,file_url,file_type,file_size,cover_url,download_count,created_at` +
      `&order=created_at.desc&limit=${perPage}&offset=${(page - 1) * perPage}`;
    if (category && category !== "All") p += `&category=eq.${enc(category)}`;
    if (cls && cls !== "All") p += `&class=eq.${enc(cls)}`;
    if (search) p += `&title=ilike.*${enc(search.replace(/[\\%_]/g, (c) => "\\" + c))}*`;
    const [rows, count] = await Promise.all([
      sb(p),
      sbCount(p.replace(/&limit=[^&]*/, "").replace(/&offset=[^&]*/, "")),
    ]);
    return { data: rows ?? [], count };
  },

  // Distinct result years (dedup happens client-side, as before).
  async "result-years"() {
    const rows = await sb(`results?select=year&order=year.desc&limit=5000`);
    return rows ?? [];
  },

  // "Any published result at all?" — one row, no counting.
  async "has-results"() {
    const rows = await sb(`results?select=id&is_published=eq.true&limit=1`);
    return (rows?.length ?? 0) > 0;
  },

  // Latest published exam meta.
  async "latest-exam"() {
    const rows = await sb(
      `results?select=exam_type,year,created_at&is_published=eq.true&order=year.desc,created_at.desc&limit=1`,
    );
    return rows?.[0] ?? null;
  },

  // Search shape of ONE published exam: which classes exist and whether rows
  // carry an Exam Roll No. Aggregated here, so no student data leaves the DB
  // and the browser downloads ~100 bytes instead of every row.
  async "result-search-meta"(q) {
    const exam = safeText(q, "exam");
    const year = num(q.get("year"), 1990, 2100, 0);
    if (!exam || !year) return { mode: "both", classes: [] };
    // Classes 6-8 store "1st/2nd Semester", 9-10 store "Annual-I/II" for the same
    // exam slot — match BOTH or one group of classes vanishes from the picker.
    const lo = exam.trim().toLowerCase();
    const variants = /1st|first|annual-i$/.test(lo) ? ["1st Semester", "Annual-I"]
      : /2nd|second|annual-ii$/.test(lo) ? ["2nd Semester", "Annual-II"] : [exam];
    const typeFilter = `exam_type=in.(${variants.map(v => `"${v}"`).map(enc).join(",")})`;
    const rows = await sb(
      `results?select=class,exam_roll_no&is_published=eq.true&${typeFilter}&year=eq.${year}&limit=2000`,
    );
    const list = rows ?? [];
    const withRoll = list.filter(r => r.exam_roll_no && String(r.exam_roll_no).trim()).length;
    const classes = Array.from(new Set(list.map(r => String(r.class ?? "").trim()).filter(Boolean)))
      .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
    const mode = list.length === 0 ? "both" : withRoll === list.length ? "exam" : withRoll === 0 ? "class" : "both";
    return { mode, classes };
  },

  // Upcoming scheduled publishes (public by design today — powers every
  // countdown; contains no student-level data).
  async "result-schedule"() {
    const rows = await sb(
      `results?select=class,exam_type,year,publish_at&is_published=eq.false&publish_at=not.is.null&publish_at=gt.${new Date().toISOString()}` +
      `&order=publish_at.asc&limit=500`,
    );
    return rows ?? [];
  },

  // Rank pools for the results page. `scope=class` needs class+exam+year;
  // `scope=school` needs year only.
  //
  // RANK ACCURACY WITH "HIDE TOP 3": when the admin holds back a class's
  // toppers, those rows stay unpublished. A pool made of published rows only
  // would promote student #4 to "Position 1". So the pool is every row of each
  // class+exam+year GROUP THAT HAS AT LEAST ONE PUBLISHED ROW (a partially
  // published class = held-back toppers; a class not published at all stays
  // out, exactly as before). Only {id, student_id, percentage, created_at} is
  // returned — no names, marks or publish flags.
  async "result-rank"(q) {
    const scope = q.get("scope") === "school" ? "school" : "class";
    let p = `results?select=id,student_id,percentage,created_at,is_published,class,exam_type,year&limit=5000`;
    if (scope === "class") {
      const cls = safeText(q, "class");
      const exam = safeText(q, "exam");
      const year = num(q.get("year"), 1990, 2100, 0);
      if (!cls || !exam || !year) throw new BadRequest("class, exam and year required");
      p += `&class=eq.${enc(cls)}&exam_type=eq.${enc(exam)}&year=eq.${year}`;
    } else {
      const year = num(q.get("year"), 1990, 2100, 0);
      if (!year) throw new BadRequest("year required");
      // Mirrors Results.tsx RC_ALL_CLASSES — the school-wide rank pool is
      // capped to the classes that publish together (see the comment there).
      p += `&year=eq.${year}&class=in.("6","7","8","9","10")`;
    }
    const rows = (await sb(p)) ?? [];
    const live = new Set();
    for (const r of rows) if (r.is_published) live.add(`${r.class}|${r.exam_type}|${r.year}`);
    return rows
      .filter((r) => live.has(`${r.class}|${r.exam_type}|${r.year}`))
      .map((r) => ({ id: r.id, student_id: r.student_id, percentage: r.percentage, created_at: r.created_at }));
  },

  // Class average via the existing RPC (same call Results.tsx made).
  async "class-average"(q) {
    const cls = safeText(q, "class");
    const exam = safeText(q, "exam");
    const year = num(q.get("year"), 1990, 2100, 0);
    if (!cls || !exam || !year) throw new BadRequest("class, exam and year required");
    const { url, key } = cfg();
    const res = await fetch(`${url}/rest/v1/rpc/get_class_exam_average`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_class: cls, p_exam_type: exam, p_year: year }),
      signal: AbortSignal.timeout(SB_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`rpc get_class_exam_average → ${res.status}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  },
};

export default async function handler(req, res) {
  // GET only — this is a public read cache, nothing more.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "method not allowed" });
  }

  const url = new URL(req.url, "https://x.invalid");
  const kind = url.searchParams.get("kind") || "";
  const cacheCfg = CACHE[kind];
  const fetcher = FETCHERS[kind];

  if (!cacheCfg || !fetcher) return res.status(400).json({ error: "unknown kind" });
  if (!cfg().ok) return res.status(503).json({ error: "not configured" }); // clients fall back to direct Supabase

  // Cache headers. `Vary` keeps any future auth-ish variant out of the shared
  // cache; the `_` param (publish bust) makes each such URL a unique key and
  // is additionally marked no-store so a one-off fresh read can never be
  // re-served stale to a later student.
  const busted = url.searchParams.has("_");
  res.setHeader(
    "Cache-Control",
    busted
      ? "public, max-age=0, s-maxage=0, must-revalidate"
      : `public, max-age=0, s-maxage=${cacheCfg.s}, stale-while-revalidate=${cacheCfg.swr}`,
  );
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("X-Content-Type-Options", "nosniff");

  try {
    const data = await fetcher(url.searchParams);
    return res.status(200).json(data);
  } catch (e) {
    if (e instanceof BadRequest) return res.status(400).json({ error: String(e.message) });
    // 502 → the browser falls back to its direct Supabase query; the CDN
    // must not cache the failure (max-age=0 above already guarantees it).
    return res.status(502).json({ error: "upstream" });
  }
}
