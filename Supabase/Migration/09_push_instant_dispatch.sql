-- ═══════════════════════════════════════════════════════════════════════
-- FILE 09 — Instant + guaranteed Web Push dispatch (pg_net + pg_cron)
-- ═══════════════════════════════════════════════════════════════════════
-- WHY: /api/push?action=dispatch used to run ONLY when a visitor opened the
-- site (throttled) or an admin had the panel open, and vercel.json has no
-- cron. So pushes were late or never sent. This file makes the DATABASE call
-- the dispatcher:
--   • instantly, the moment a notice / news / merit list / roll slip /
--     result / date sheet row / admission status is written (statement-level
--     triggers, one call per statement even for bulk imports), and
--   • every minute as a safety net (pg_cron) — this also runs the scheduled
--     result auto-publisher, so countdown results go live on time and push.
--
-- SETUP (once):
--   1. Vercel → Settings → Environment Variables → add CRON_SECRET = any long
--      random string → Redeploy.
--   2. Run this whole file in the Supabase SQL editor.
--   3. Run (use YOUR secret and site URL):
--        select public.push_configure('https://ghsbabikhel.dpdns.org', 'PASTE_THE_SAME_CRON_SECRET');
--   4. Check:  select public.push_ping();   then
--        select status_code, content from net._http_response order by created desc limit 3;
--      (status_code 200 = working)
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Config lives in push_state (RLS on, no policies → invisible to anon/authenticated).
CREATE OR REPLACE FUNCTION public.push_configure(p_site text, p_secret text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(p_site,'') !~ '^https://' OR coalesce(p_secret,'') = '' THEN
    RAISE EXCEPTION 'Usage: select public.push_configure(''https://your-site'', ''CRON_SECRET'')';
  END IF;
  INSERT INTO public.push_state(key, value, updated_at)
  VALUES ('cfg', jsonb_build_object('site', rtrim(p_site,'/'), 'secret', p_secret), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN 'push dispatcher configured for ' || rtrim(p_site,'/');
END $$;
REVOKE ALL ON FUNCTION public.push_configure(text,text) FROM PUBLIC, anon, authenticated;

-- Fire-and-forget call to the dispatcher. NEVER raises: a push problem must not block a publish.
CREATE OR REPLACE FUNCTION public.push_ping()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v jsonb; req bigint;
BEGIN
  SELECT value INTO v FROM public.push_state WHERE key = 'cfg';
  IF v IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := (v->>'site') || '/api/push?action=dispatch&src=db',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (v->>'secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO req;
  RETURN req;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.push_ping() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_auto_publish()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v jsonb; req bigint;
BEGIN
  SELECT value INTO v FROM public.push_state WHERE key = 'cfg';
  IF v IS NULL THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := (v->>'site') || '/api/auto-publish-results',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (v->>'secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO req;
  RETURN req;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.push_auto_publish() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_ping_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.push_ping();
  RETURN NULL;
END $$;

-- Statement-level: ONE ping per INSERT/UPDATE statement (bulk imports don't flood the API).
-- pg_net sends the request only after the transaction commits, so the dispatcher always sees the new data.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notices','news','merit_lists','exam_roll_sessions','results','exam_schedule'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS push_ping_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS push_ping_upd ON public.%I', t);
    EXECUTE format('CREATE TRIGGER push_ping_ins AFTER INSERT ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.push_ping_trigger()', t);
    EXECUTE format('CREATE TRIGGER push_ping_upd AFTER UPDATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.push_ping_trigger()', t);
  END LOOP;
  -- Admissions: only status changes matter (new applications are not announced).
  DROP TRIGGER IF EXISTS push_ping_upd ON public.admissions;
  CREATE TRIGGER push_ping_upd AFTER UPDATE ON public.admissions FOR EACH STATEMENT EXECUTE FUNCTION public.push_ping_trigger();
END $$;

-- Safety net + scheduled-results publisher: every minute. (cron.schedule with the same name replaces the job.)
SELECT cron.schedule('ghs-push-dispatch', '* * * * *', $$select public.push_ping();$$);
SELECT cron.schedule('ghs-auto-publish',  '* * * * *', $$select public.push_auto_publish();$$);

-- Keep pg_net's response log from growing forever.
SELECT cron.schedule('ghs-net-cleanup', '17 3 * * *', $$delete from net._http_response where created < now() - interval '2 days';$$);
