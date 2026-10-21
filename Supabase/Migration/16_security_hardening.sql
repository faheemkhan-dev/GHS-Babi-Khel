-- ═══════════════════════════════════════════════════════════════════════
-- FILE 16 — Security hardening                                            (Plan: Phase 8)
-- ═══════════════════════════════════════════════════════════════════════
-- WHY: the audit found 55 SECURITY DEFINER functions executable by `anon`
--      plus ~50 functions with a mutable search_path, and a
--      security-definer view. A PUBLIC-executable SECURITY DEFINER function
--      runs with the OWNER's privileges for ANYONE — including anonymous
--      internet visitors — so every function that is not deliberately
--      public is an attack surface on a free-plan project with no WAF.
--
-- WHAT THIS FILE DOES (nothing is dropped, no data is touched):
--   1. DEFAULT-DENY: revoke EXECUTE on EVERY function in the public schema
--      from PUBLIC and anon.
--   2. Re-grant to `authenticated` (students, staff, admin) on everything
--      EXCEPT a small server-only list (push internals) — logged-in flows
--      keep working unchanged.
--   3. Re-grant to `anon` ONLY the verified-public whitelist — the ten RPCs
--      the site calls from pages that have no login (each verified by grep
--      of src/, all SECURITY DEFINER, all safe to expose).
--   4. Pin `search_path = public, extensions` on every function that does
--      not already pin one (search_path hijack protection for SECURITY
--      DEFINER functions).
--   5. Make v_student_seating a security_invoker view (it currently runs
--      as its owner and silently bypasses RLS of the tables it reads).
--
-- WHY NOTHING BREAKS (verified, not assumed):
--   • Trigger functions (trg_fn_*, push_ping_trigger, handle_new_user):
--     PostgreSQL checks EXECUTE at CREATE TRIGGER time, never at fire time;
--     they are SECURITY DEFINER anyway and run as their owner.
--   • push_ping / push_auto_publish / push_tick / push_signature /
--     push_configure are called by pg_cron (runs as the cron owner) and by
--     push_ping_trigger (SECURITY DEFINER, owner context) — neither needs
--     an anon/authenticated grant. They were already REVOKEd in files 09
--     and 12; this file re-asserts it.
--   • Inner function calls inside SECURITY DEFINER functions run as the
--     owner (postgres) and bypass EXECUTE checks.
--   • All ten anon-whitelist functions are SECURITY DEFINER with pinned or
--     to-be-pinned search_path, so granting anon EXECUTE is deliberate and
--     contained.
--
-- SAFE TO RE-RUN: yes.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1 + 2. Default-deny for anon, keep authenticated working ──────────────
-- service_role is granted EXECUTE on everything as well: the Vercel
-- functions (push dispatcher, /api/public-data cache) call RPCs with that
-- key, and after REVOKE … FROM PUBLIC it no longer inherits EXECUTE.
DO $$
DECLARE
  r record;
  v_server_only text[] := ARRAY[
    'push_ping', 'push_auto_publish', 'push_tick', 'push_signature',
    'push_configure', 'push_ping_trigger'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name,
           pg_get_function_identity_arguments(p.oid) AS fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- Never touch extension-owned objects (pg_trgm etc. if ever installed
      -- into public): ALTERing them is forbidden and they manage their own ACLs.
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    -- Close the door for everyone anonymous (covers direct grants too).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.schema_name, r.fn_name, r.fn_args);
    -- Server-only internals stay closed to authenticated as well.
    IF r.fn_name = ANY (v_server_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM authenticated',
                     r.schema_name, r.fn_name, r.fn_args);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
                     r.schema_name, r.fn_name, r.fn_args);
    END IF;
    -- Server-side (Vercel functions) always keeps access.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                   r.schema_name, r.fn_name, r.fn_args);
  END LOOP;
END $$;

-- ── 3. Verified-public whitelist for anon ──────────────────────────────────
-- Each entry: called from a page that works WITHOUT login (grep of src/):
--   submit_admission_public  Admission form submit        (useAdmission.ts)
--   track_admission          Admission status tracker     (useAdmission.ts)
--   book_interview_slot      Applicant interview booking  (InterviewSlotBooking.tsx)
--   cancel_interview_booking Applicant booking cancel     (InterviewSlotBooking.tsx)
--   increment_download_count Library download counter     (useLibrary.ts)
--   increment_chapter_views  Notes chapter view counter    (useNotes.ts)
--   cast_poll_vote           Public notice polls          (useNotices.ts)
--   get_my_poll_vote         Public notice polls          (useNotices.ts)
--   notify_admin_contact     Contact form                 (Contact.tsx)
--   get_class_exam_average   Results page class average   (Results.tsx)
-- Missing names are skipped silently (e.g. increment_chapter_views was
-- created outside the migration files — the grant applies if it exists).
DO $$
DECLARE
  r record;
  v_anon_ok text[] := ARRAY[
    'submit_admission_public', 'track_admission',
    'book_interview_slot', 'cancel_interview_booking',
    'increment_download_count', 'increment_chapter_views',
    'cast_poll_vote', 'get_my_poll_vote',
    'notify_admin_contact', 'get_class_exam_average'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name,
           pg_get_function_identity_arguments(p.oid) AS fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (v_anon_ok)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO anon',
                   r.schema_name, r.fn_name, r.fn_args);
    RAISE NOTICE 'anon EXECUTE kept: % (%)', r.fn_name, r.fn_args;
  END LOOP;
END $$;

-- ── 4. Pin search_path on functions that have none ─────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname AS fn_name,
           pg_get_function_identity_arguments(p.oid) AS fn_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
      AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS c
            WHERE c LIKE 'search_path=%')
  LOOP
    -- public, extensions covers every schema these bodies use (tables in
    -- public, pg_net in extensions; auth.uid()/net.http_post are qualified).
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions',
                   r.schema_name, r.fn_name, r.fn_args);
    RAISE NOTICE 'search_path pinned: %', r.fn_name;
  END LOOP;
END $$;

-- ── 5. v_student_seating: stop bypassing RLS as its owner ─────────────────
-- All three underlying tables (exam_seating_assignments / _plans / _rooms)
-- have public-read policies (SELECT USING (true)), so making the view
-- security_invoker changes NOTHING for the public Exam Seating page — it
-- only means the view can no longer silently leak future non-public rows
-- if those policies are ever tightened. Requires PostgreSQL 15+ (all
-- current Supabase projects qualify); guarded anyway.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000
     AND EXISTS (SELECT 1 FROM pg_views
                 WHERE schemaname = 'public' AND viewname = 'v_student_seating') THEN
    EXECUTE 'ALTER VIEW public.v_student_seating SET (security_invoker = true)';
    RAISE NOTICE 'v_student_seating is now security_invoker';
  ELSE
    RAISE NOTICE 'v_student_seating: skipped (missing view or PG < 15)';
  END IF;
END $$;

-- ── 6. Documented decisions (no action) ────────────────────────────────────
--   push_state, push_subscriptions: RLS enabled with NO policies on purpose
--     (server-only via service role). Do NOT add anon policies. (Plan 8.5)
--   library_books, online_classes: RLS enabled, no policies, and NOT
--     referenced anywhere in src/ (verified by grep) → already fully locked
--     for anon and authenticated; left in place untouched (no data deletion
--     per plan rules). If they are ever needed, add explicit policies then.
--   pg_trgm / pg_net in the public schema: left as-is (moving pg_net breaks
--     existing calls; plan 8.6 marks it low priority).
--   Storage-schema policies (35, migration 00): out of scope here — file 14
--     covers the public schema, which is where per-request cost lives.

-- ═══════════════════════════════════════════════════════════════════════
-- CHECK (run after):
--   1) SECURITY DEFINER functions still executable by anon (expect ONLY the
--      ten whitelist names):
--      select p.proname, p.prosecdef
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and has_function_privilege('anon', p.oid, 'EXECUTE')
--      order by 1;
--
--   2) Functions with mutable search_path (expect 0):
--      select p.proname
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prokind = 'f'
--        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c
--                        where c like 'search_path=%');
--
--   3) View flags:
--      select reloptions from pg_class c
--      join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname='public' and c.relname = 'v_student_seating';
--
--   4) SMOKE TEST after deploy: as a logged-out browser —
--      Admission form submit + status tracker, Notices poll vote,
--      Library download, Notes chapter open, Contact form, Results page
--      (class average), Exam Seating page. As admin — publish a notice
--      (push trigger must still fire), schedule + publish results.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════ ROLLBACK (run only if needed) ═════════════════
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT n.nspname s, p.proname f,
--                   pg_get_function_identity_arguments(p.oid) a
--            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--            WHERE n.nspname = 'public' LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO PUBLIC', r.s, r.f, r.a);
--   END LOOP;
-- END $$;
-- -- (re-assert the file 09/12 REVOKEs for push_* afterwards if you do this)
-- alter view public.v_student_seating reset (security_invoker);   -- PG15+
-- DO $$  -- unpin search_path (only if truly needed)
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT n.nspname s, p.proname f,
--                   pg_get_function_identity_arguments(p.oid) a
--            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--            WHERE n.nspname='public' LOOP
--     EXECUTE format('ALTER FUNCTION %I.%I(%s) RESET search_path', r.s, r.f, r.a);
--   END LOOP;
-- END $$;
