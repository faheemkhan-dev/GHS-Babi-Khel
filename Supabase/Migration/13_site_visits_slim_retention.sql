-- ═══════════════════════════════════════════════════════════════════════
-- FILE 13 — Slim down site_visits (Plan: Phase 4.2)
-- ═══════════════════════════════════════════════════════════════════════
-- WHY: site_visits is the most write-heavy table (one row per page view). It carried 6 indexes
--      and every insert had to update all of them, while the Site Analytics screen only ever
--      filters/sorts on created_at (verified in src/hooks/useSiteAnalytics.ts: .gte/.lt/.order on
--      created_at, nothing else; no other code reads this table).
--
-- WHAT THIS FILE DOES:
--   • Drops 3 indexes nobody scans: device_type, page, session_id.
--   • KEEPS: primary key, idx_site_visits_created_at (used by Site Analytics) and the PARTIAL
--     idx_site_visits_user_id (only logged-in rows; it makes the ON DELETE SET NULL foreign key
--     to auth.users cheap when a user is deleted).
--   • Nightly retention: rows older than 120 days are deleted. The Site Analytics screen only
--     looks back 30 days + 30 days for comparison = 60 days, so nothing visible is lost.
--
-- Safe to re-run. No row is touched by the index drops.
-- ═══════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_site_visits_device_type;
DROP INDEX IF EXISTS public.idx_site_visits_page;
DROP INDEX IF EXISTS public.idx_site_visits_session_id;

-- Runs as the cron owner (bypasses RLS, so the "no one can delete" policy does not block it).
SELECT cron.schedule('ghs-site-visits-retention', '41 3 * * *',
  $$delete from public.site_visits where created_at < now() - interval '120 days';$$);

-- ═══════════════════════════ ROLLBACK (run only if needed) ═════════════
-- select cron.unschedule(jobid) from cron.job where jobname = 'ghs-site-visits-retention';
-- create index if not exists idx_site_visits_device_type ON public.site_visits USING btree (device_type);
-- create index if not exists idx_site_visits_page        ON public.site_visits USING btree (page);
-- create index if not exists idx_site_visits_session_id  ON public.site_visits USING btree (session_id);
