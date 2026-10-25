// api/auto-publish-results.js
// Vercel Cron Job target — runs server-side on a schedule (see vercel.json
// "crons") and does NOT depend on any admin/user having a browser tab open.
//
// WHY THIS FILE EXISTS:
//   The "Schedule Publish" feature in AdminResults.tsx sets `publish_at` on
//   `results` rows, but the ONLY code that ever checked whether that time had
//   passed was `ResultCountdownTimer`, a React component that runs its check
//   inside a `useEffect` in the admin's own browser. If the admin (or anyone)
//   didn't have that exact panel open in a tab when the countdown hit zero,
//   `is_published` never flipped to `true` — so the Home page kept showing
//   the BISE Peshawar fallback forever, even though the countdown said 0s.
//
//   This endpoint fixes that by doing the actual publish flip on the server,
//   on a schedule, independent of any browser being open.
//
// CRITICAL BUG FIX (auto-republish loop):
//   The previous version of this endpoint only flipped `is_published` to
//   true and NEVER cleared `publish_at`. That meant:
//     1. Admin schedules a publish with publish_at = X
//     2. Timer fires / this cron runs → is_published = true (good)
//     3. Admin later clicks "Unpublish Results" → is_published = false
//        BUT publish_at = X is STILL SET (and X is now in the past)
//     4. This cron runs again next minute → sees publish_at <= now AND
//        is_published = false → RE-PUBLISHES the rows admin just unpublished
//     5. Infinite loop: admin can never unpublish results that ever had
//        a schedule set on them
//
//   The fix: in the SAME PATCH that flips is_published=true, also set
//   `publish_at = null`. This "consumes" the schedule — once published, the
//   row no longer has a publish_at, so the cron will never touch it again
//   even if admin later unpublishes it manually.
//
// SECURITY:
//   Protected by CRON_SECRET so randoms can't hit this URL and mass-publish
//   results early. Vercel automatically sends this header for Cron-triggered
//   invocations when CRON_SECRET is set as an env var (see vercel.json).
//
// SETUP REQUIRED (one-time):
//   1. In Vercel project settings → Environment Variables, add:
//        CRON_SECRET = <any long random string>
//   2. vercel.json now has a "crons" entry hitting this route every minute.
//   3. Redeploy.

// NOTE: push-core is imported lazily inside the handler (see below) so a
// missing/broken push module can NEVER stop results from being published.

export default async function handler(req, res) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  // Two ways this endpoint is called:
  //   1. Vercel Cron (scheduled, server-to-server) — sends `Authorization:
  //      Bearer <CRON_SECRET>`.
  //   2. Any visitor's browser, the instant their local countdown hits zero
  //      (see useAutoPublishTrigger() in Home.tsx / Results.tsx). This call
  //      has NO secret attached.
  //
  // We allow #2 without a secret because this endpoint is narrowly safe to
  // expose publicly: it can ONLY flip `is_published=true` on rows whose
  // `publish_at` has ALREADY passed (see the `publish_at=lte.<now>` filter
  // below). Nobody can use it to publish early, alter marks, or do anything
  // except "reveal a result that was already due to be revealed" — which is
  // exactly what would happen anyway once the cron next ticks. Calling it
  // early or repeatedly is a harmless no-op (0 rows match once already
  // published, since publish_at is cleared in the same update).
  //
  // If a secret IS configured and IS sent, it must match — this keeps the
  // Vercel Cron call authenticated as before. A request with no secret at
  // all is allowed through as the safe public trigger case.
  // ── Precision-publish helpers (added) ────────────────────────────────────
  // GET ?mode=time   → { now } — a no-DB ping that does two jobs:
  //     1. warms this serverless function (no cold start at publish time)
  //     2. lets browsers measure the SERVER clock, so every visitor's
  //        countdown ends at the same real instant even if their own phone
  //        clock is minutes off (a fast phone clock used to fire the publish
  //        early → 0 rows published → the page sat on "Publishing Now…").
  // ?at=<publish_at ISO> → if that moment is only a few seconds away, this
  //     invocation WAITS (max 4 s) until it, then publishes — so the flip
  //     happens at exactly 00:00:00 server time instead of "client noticed,
  //     then called, then cold-started, then queried".
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.query && req.query.mode === "time") {
    res.status(200).json({ ok: true, now: Date.now() });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader && authHeader !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || // preferred if available
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Supabase env vars not configured" });
    return;
  }

  try {
    // ── Timing ─────────────────────────────────────────────────────────────
    // ?at=<publish_at> → this invocation sleeps until ~LEAD_MS before that
    // instant, then fires the PATCH so the row commit lands at 00:00:00
    // (the Supabase round-trip itself eats the lead). The cutoff is clamped
    // to the target, so nothing can ever be published more than ~120 ms early
    // and never anything scheduled later than `at`.
    const LEAD_MS = 80;
    const atRaw = req.query && req.query.at ? Date.parse(String(req.query.at)) : NaN;
    const timed = Number.isFinite(atRaw) && atRaw > Date.now();
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    };

    // Meta for the client (which exam goes live, is it exam-roll-only?) is
    // prepared WHILE we wait for the exact instant, so it adds zero latency.
    // The client uses it to paint the final search box on the very first
    // frame (no tabs → no tabs-disappear flash). Best-effort: null on error.
    const metaPromise = timed ? loadPublishMeta(supabaseUrl, headers, atRaw).catch(() => null) : Promise.resolve(null);

    let cutoff = Date.now();
    if (timed) {
      const wait = Math.min(atRaw - cutoff - LEAD_MS, 4000);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      cutoff = Math.min(atRaw, Date.now() + LEAD_MS + 40);
    }
    const nowIso = new Date(cutoff).toISOString();

    // Flip is_published -> true AND clear publish_at -> null for every row
    // whose scheduled time has passed and that isn't published yet.
    // Clearing publish_at in the SAME PATCH "consumes" the schedule so an
    // admin's later manual Unpublish can never be undone by a stale
    // publish_at (the old auto-republish loop).
    //
    // `select=id` is the speed fix: the old call asked PostgREST to return
    // the FULL updated rows (every column incl. the big subject_marks JSON of
    // every student) just to count them. Only ids come back now.
    const url =
      `${supabaseUrl}/rest/v1/results?select=id&is_published=eq.false&publish_at=not.is.null&publish_at=lte.${encodeURIComponent(nowIso)}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ is_published: true, publish_at: null }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ error: "Supabase update failed", detail: text });
      return;
    }

    const updated = await response.json();
    const count = Array.isArray(updated) ? updated.length : 0;
    const meta = count > 0 ? await metaPromise : null;

    // Web Push: announce the freshly published results to every subscriber.
    // It runs AFTER the response is sent (waitUntil keeps the function alive
    // until it finishes) — the page used to sit on "Publishing Now…" for up
    // to 2.5 s waiting on this. The DB-side push trigger (migration 09) also
    // covers it, so this is purely a belt-and-braces call.
    if (count > 0) {
      const job = (async () => {
        const { dispatchChanges } = await import("./_lib/push-core.js");
        return dispatchChanges({ minGapMs: 0 });
      })().catch(() => null);
      try {
        const { waitUntil } = await import("@vercel/functions");
        waitUntil(job);
      } catch { /* not on Vercel runtime: job still runs, just not awaited */ }
    }

    res.status(200).json({
      ok: true,
      published_count: count,
      meta,
      checked_at: nowIso,
    });
  } catch (err) {
    res.status(500).json({ error: "Auto-publish failed", detail: String(err) });
  }
}

// What the page needs to render the search box correctly at first paint:
//   latest      → the exam heading ("Result - 1st Semester 2026")
//   examRollOnly→ true when EVERY published row of that exam has an exam roll
//                 no. (mirrors useExamRollOnly in Results.tsx)
async function loadPublishMeta(supabaseUrl, headers, atMs) {
  const base = `${supabaseUrl}/rest/v1/results`;
  const atIso = encodeURIComponent(new Date(atMs).toISOString());
  const get = async (q) => {
    const r = await fetch(`${base}?${q}`, { headers, signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  };
  const [due, published] = await Promise.all([
    get(`select=exam_type,year,created_at&is_published=eq.false&publish_at=not.is.null&publish_at=lte.${atIso}&order=year.desc,created_at.desc&limit=1`),
    get(`select=exam_type,year,created_at&is_published=eq.true&order=year.desc,created_at.desc&limit=1`),
  ]);
  const a = due?.[0] ?? null;
  const b = published?.[0] ?? null;
  const newer = (x, y) => (x.year !== y.year ? x.year > y.year : String(x.created_at) >= String(y.created_at));
  const latest = a && b ? (newer(a, b) ? a : b) : (a || b);
  if (!latest) return null;

  const exam = `exam_type=eq.${encodeURIComponent(latest.exam_type)}&year=eq.${Number(latest.year)}`;
  const count = async (q) => {
    const r = await fetch(`${base}?select=id&${q}`, {
      method: "HEAD",
      headers: { ...headers, Prefer: "count=exact" },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const m = /\/(\d+)$/.exec(r.headers.get("content-range") || "");
    return m ? Number(m[1]) : 0;
  };
  // After the flip, the published set = already published + the due rows.
  const [missingPub, missingDue, totalDue, totalPub] = await Promise.all([
    count(`${exam}&is_published=eq.true&exam_roll_no=is.null`),
    count(`${exam}&is_published=eq.false&publish_at=not.is.null&publish_at=lte.${atIso}&exam_roll_no=is.null`),
    count(`${exam}&is_published=eq.false&publish_at=not.is.null&publish_at=lte.${atIso}`),
    count(`${exam}&is_published=eq.true`),
  ]);
  return {
    latest: { exam_type: latest.exam_type, year: Number(latest.year), created_at: latest.created_at },
    examRollOnly: totalDue + totalPub > 0 && missingPub + missingDue === 0,
  };
}
