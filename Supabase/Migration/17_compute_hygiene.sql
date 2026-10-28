-- ═══════════════════════════════════════════════════════════════════════
-- FILE 17 — Compute hygiene for the Nano instance
-- Safe to run more than once. Deletes only log/queue rows, never school data.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Remove the OLD every-minute jobs if they are still scheduled
--    (file 12 replaced them with the single 5-minute 'ghs-tick').
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, jobname FROM cron.job
           WHERE jobname IN ('ghs-push-dispatch', 'ghs-auto-publish')
  LOOP
    PERFORM cron.unschedule(j.jobid);
    RAISE NOTICE 'Unscheduled old job %', j.jobname;
  END LOOP;
END $$;

-- 2. Keep the two biggest junk tables small: cron run history and pg_net
--    responses (together ~8 MB, more than all student records).
--    Runs daily at 03:23 server time; keeps 1 day.
SELECT cron.schedule(
  'ghs-log-trim', '23 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 day';
    delete from net._http_response    where created  < now() - interval '1 day';$$
);

-- 3. One-time cleanup now.
DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day';
DELETE FROM net._http_response    WHERE created  < now() - interval '1 day';

-- 4. CHECK ONLY (read-only): which tables Realtime scans for changes.
--    Anything in this list that does NOT need live updates should be dropped:
--      alter publication supabase_realtime drop table public.<table_name>;
--    Tables the app really subscribes to: profiles, fee_vouchers,
--    fee_structures, fee_payments, exam_attendance.
SELECT schemaname, tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' ORDER BY tablename;

-- 5. CHECK ONLY: the cron jobs that should remain.
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
