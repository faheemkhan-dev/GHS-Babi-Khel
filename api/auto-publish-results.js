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
    const atRaw = req.query && req.query.at ? Date.parse(String(req.query.at)) : NaN;
    if (Number.isFinite(atRaw)) {
      const wait = Math.min(Math.max(atRaw - Date.now(), 0), 4000);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait + 15));
    }
    const nowIso = new Date().toISOString();

    // Flip is_published -> true AND clear publish_at -> null for every row
    // whose scheduled time has passed and that isn't published yet.
    //
    // Clearing publish_at in the SAME PATCH is the fix for the
    // auto-republish loop: once a schedule has fired, the row's publish_at
    // is consumed (set to null), so this cron won't pick it up again on the
    // next minute tick — even if admin later manually unpublishes the row.
    // PostgREST PATCH with `select` returns the updated rows so we can
    // report how many were published.
    const url =
      `${supabaseUrl}/rest/v1/results?is_published=eq.false&publish_at=not.is.null&publish_at=lte.${encodeURIComponent(nowIso)}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      // is_published=true flips the row to visible; publish_at=null
      // "consumes" the schedule so this row can never be auto-published
      // again by this cron or by the in-browser ResultCountdownTimer.
      body: JSON.stringify({ is_published: true, publish_at: null }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ error: "Supabase update failed", detail: text });
      return;
    }

    const updated = await response.json();

    // Web Push: announce the freshly published results to every subscriber
    // at the exact moment they go live. Best-effort — never blocks or fails
    // the publish itself.
    let push = null;
    if (Array.isArray(updated) && updated.length > 0) {
      const job = (async () => {
        const { dispatchChanges } = await import("./_lib/push-core.js");
        return dispatchChanges({ minGapMs: 0 });
      })().catch((e) => ({ error: String(e).slice(0, 120) }));
      // Never let push delivery delay the response (the page is waiting on
      // it to show the result) — give it at most 2.5 s.
      push = await Promise.race([job, new Promise((r) => setTimeout(() => r({ pending: true }), 2500))]);
    }

    res.status(200).json({
      push,
      ok: true,
      published_count: Array.isArray(updated) ? updated.length : 0,
      checked_at: nowIso,
    });
  } catch (err) {
    res.status(500).json({ error: "Auto-publish failed", detail: String(err) });
  }
}
