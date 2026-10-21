-- ═══════════════════════════════════════════════════════════════════════
-- FILE 12 — Stop the every-minute cron loop + push hygiene   (Plan: Phase 1 + 3.1)
-- ═══════════════════════════════════════════════════════════════════════
-- WHY: migration 09 scheduled TWO jobs every minute (push_ping + push_auto_publish). Each one
--      woke a Vercel function that read 6 tables and wrote push_state, 1,440x/day each,
--      even when nothing had changed. That loop (cron history, pg_net responses, push_state
--      WAL scanned by Realtime) is what drains the Disk IO budget.
--
-- WHAT THIS FILE DOES (nothing is deleted, no data touched):
--   1. push_signature()  — tiny RPC: hash of everything the dispatcher watches. The Vercel code
--                          (api/_lib/push-core.js) uses it to exit early when nothing changed.
--   2. push_tick()       — ONE job instead of two. Pure SQL: sends the auto-publish HTTP call
--                          ONLY when a scheduled result is really due; sends the push safety-net
--                          ping only about every 15 minutes.
--   3. Schedules: 'ghs-tick' every 5 min (staggered, minutes 2,7,12…), 'ghs-cron-cleanup' daily.
--   4. Removes the two old every-minute jobs.
--   5. push_state fillfactor (room for in-place updates).
--
-- UNCHANGED ON PURPOSE: the push_ping_ins / push_ping_upd triggers (instant push on any change),
-- the 'ghs-net-cleanup' job, push_configure(), the browser trigger for exact-second publishing.
--
-- RUN ORDER: 1) run this whole file  2) deploy the code  3) run the VACUUM line at the bottom
-- (VACUUM cannot run inside the same transaction, so run it as its own statement).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Change signature (read by api/_lib/push-core.js) ────────────────
CREATE OR REPLACE FUNCTION public.push_signature()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cur', md5(concat_ws('|',
      -- notices (same set the dispatcher reads: published, newest 200)
      (SELECT md5(coalesce(string_agg(x.id::text, ',' ORDER BY x.created_at DESC, x.id), ''))
         FROM (SELECT id, created_at FROM public.notices WHERE is_published IS TRUE
               ORDER BY created_at DESC, id LIMIT 200) x),
      -- merit lists (published, up to 500)
      (SELECT md5(coalesce(string_agg(x.id::text, ',' ORDER BY x.id), ''))
         FROM (SELECT id FROM public.merit_lists WHERE is_published IS TRUE
               ORDER BY id LIMIT 500) x),
      -- roll number slip sessions (published, newest 200)
      (SELECT md5(coalesce(string_agg(x.id::text, ',' ORDER BY x.created_at DESC, x.id), ''))
         FROM (SELECT id, created_at FROM public.exam_roll_sessions WHERE is_published IS TRUE
               ORDER BY created_at DESC, id LIMIT 200) x),
      -- results: one entry per published class|exam|year
      (SELECT md5(coalesce(string_agg(x.k, ',' ORDER BY x.k), ''))
         FROM (SELECT DISTINCT (class || '|' || exam_type || '|' || year::text) AS k
               FROM public.results WHERE is_published IS TRUE) x),
      -- date sheet rows
      (SELECT md5(coalesce(string_agg(x.id::text, ',' ORDER BY x.id), ''))
         FROM (SELECT id FROM public.exam_schedule ORDER BY id LIMIT 3000) x),
      -- admission status of every applicant that has a push subscription
      (SELECT md5(coalesce(string_agg(a.reference_no || ':' || a.status::text, ',' ORDER BY a.reference_no), ''))
         FROM public.admissions a
        WHERE a.reference_no IN (SELECT s.admission_ref FROM public.push_subscriptions s
                                  WHERE s.admission_ref IS NOT NULL))
    )),
    'prev',  (SELECT value->>'_sig' FROM public.push_state WHERE key = 'seen'),
    'retry', coalesce((SELECT coalesce(value->'_tries', '{}'::jsonb) <> '{}'::jsonb
                         FROM public.push_state WHERE key = 'seen'), false)
  );
$$;
-- Server-only: the Vercel function calls it with the service-role key.
REVOKE ALL ON FUNCTION public.push_signature() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_signature() TO service_role;

-- ── 2. Small partial index so the "is a result due?" check is instant ──
-- Only rows that are scheduled-but-unpublished are in it (usually zero rows).
CREATE INDEX IF NOT EXISTS idx_results_scheduled_due
  ON public.results (publish_at)
  WHERE is_published = false AND publish_at IS NOT NULL;

-- ── 3. The single gated tick ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.results
              WHERE is_published = false AND publish_at IS NOT NULL AND publish_at <= now()) THEN
    -- A scheduled result is due and nobody's browser has published it yet.
    -- (The endpoint also runs the push dispatcher right after publishing.)
    PERFORM public.push_auto_publish();
  ELSIF (extract(minute FROM now())::int % 15) < 5 THEN
    -- Safety net, about every 15 minutes (ticks run at :02 :07 :12 … → fires at :02 :17 :32 :47).
    -- DB triggers already push instantly on every change; this only catches a missed call.
    PERFORM public.push_ping();
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;  -- a cron tick must never raise
END $$;
REVOKE ALL ON FUNCTION public.push_tick() FROM PUBLIC, anon, authenticated;

-- ── 4. Replace the two every-minute jobs ───────────────────────────────
-- (unschedule by name via the jobs table so a missing job never raises)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('ghs-push-dispatch', 'ghs-auto-publish');

-- Staggered: minutes 2,7,12,…,57 → never starts at :00 where other jobs and Supabase internals start.
SELECT cron.schedule('ghs-tick', '2-59/5 * * * *', $$select public.push_tick();$$);

-- cron's own run history: keep 2 days only (it used to grow by ~2,900 rows/day).
SELECT cron.schedule('ghs-cron-cleanup', '23 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '2 days';$$);
-- 'ghs-net-cleanup' (from file 09) stays as it is.

-- ── 5. push_state: leave free space in each page so updates stay in place (HOT) ──
ALTER TABLE public.push_state SET (fillfactor = 70);

-- ═══════════════════════════════════════════════════════════════════════
-- RUN AS A SEPARATE STATEMENT AFTER THE ABOVE (VACUUM cannot run in a transaction block):
--   vacuum (analyze) public.push_state;
--
-- CHECK:
--   select jobname, schedule, active from cron.job order by 1;
--   (expect: ghs-tick, ghs-cron-cleanup, ghs-net-cleanup — and NO ghs-push-dispatch / ghs-auto-publish)
--   select public.push_signature();          -- run in SQL editor as postgres; returns {cur, prev, retry}
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════ ROLLBACK (run only if needed) ═════════════
-- select cron.unschedule(jobid) from cron.job where jobname in ('ghs-tick','ghs-cron-cleanup');
-- select cron.schedule('ghs-push-dispatch', '* * * * *', $$select public.push_ping();$$);
-- select cron.schedule('ghs-auto-publish',  '* * * * *', $$select public.push_auto_publish();$$);
-- drop function if exists public.push_tick();
-- drop function if exists public.push_signature();   -- (old code ignores it; new code falls back to full runs)
-- drop index if exists public.idx_results_scheduled_due;
-- alter table public.push_state reset (fillfactor);
