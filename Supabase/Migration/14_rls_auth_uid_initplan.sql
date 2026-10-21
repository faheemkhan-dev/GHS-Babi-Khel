-- ═══════════════════════════════════════════════════════════════════════
-- FILE 14 — RLS performance: wrap auth.uid()/auth.role()/auth.jwt()      (Plan: Phase 6)
-- ═══════════════════════════════════════════════════════════════════════
-- WHY: the audit found 186 policies whose quals call auth.uid() directly.
--      PostgreSQL re-evaluates that STABLE function ONCE PER ROW during
--      policy checks (it cannot inline it into an InitPlan). Wrapping it as
--      (select auth.uid()) turns the call into a sub-select that the planner
--      hoists into a one-shot InitPlan → evaluated ONCE PER QUERY. On tables
--      like results / notices / fee_vouchers that is the difference between
--      a policy filter costing O(rows) and O(1).
--
-- HOW (safe, generic, idempotent):
--      A DO block walks pg_policy for the public schema, takes the EXACT
--      expression text of each qual / with_check, rewrites every un-wrapped
--      auth.uid() / auth.role() / auth.jwt() into the (select …) form, and
--      recreates only the policies that actually changed — with the same
--      name, same roles, same command, same permissive/restrictive flag.
--      Already-wrapped calls (any keyword casing produced by pg_get_expr)
--      are protected with a placeholder first and left as they are, so
--      re-running this file is a no-op.
--
--      Policies that reference no auth function are not touched at all.
--      DROP + CREATE for each policy happen inside this single DO block =
--      one transaction, so the swap is atomic and a failure aborts cleanly.
--
-- NOTES:
--   • RLS protection is NOT weakened: (select auth.uid()) returns exactly
--     what auth.uid() returns — this is purely an evaluation-frequency fix.
--   • Storage-schema policies are out of scope; the public schema is where
--     the per-request cost lives.
--
-- SAFE TO RE-RUN: yes (second run rewrites nothing).
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r            record;
  v_new_qual   text;
  v_new_check  text;
  v_roles      text;
  v_cmd        text;
  v_kind       text;
BEGIN
  FOR r IN
    SELECT n.nspname   AS schema_name,
           c.relname   AS table_name,
           p.polname   AS policy_name,
           p.polcmd,
           p.polpermissive,
           pg_get_expr(p.polqual, p.polrelid)      AS qual_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
           p.polroles
    FROM pg_policy p
    JOIN pg_class c      ON c.oid = p.polrelid
    JOIN pg_namespace n  ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY c.relname, p.polname
  LOOP
    -- Skip policies with no auth-function call at all (e.g. USING (true)).
    IF (r.qual_expr  IS NULL OR r.qual_expr  !~ 'auth\.(uid|role|jwt)\(\)')
       AND (r.check_expr IS NULL OR r.check_expr !~ 'auth\.(uid|role|jwt)\(\)') THEN
      CONTINUE;
    END IF;

    -- Rewrite: 1) protect already-wrapped calls (any casing) with a
    -- placeholder, 2) wrap every remaining bare call, 3) restore.
    v_new_qual := r.qual_expr;
    IF v_new_qual IS NOT NULL THEN
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.uid\(\)\s*\)',  '@@UID@@', 'gi');
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.role\(\)\s*\)', '@@ROLE@@', 'gi');
      v_new_qual := regexp_replace(v_new_qual, '\(\s*select\s+auth\.jwt\(\)\s*\)',  '@@JWT@@', 'gi');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.uid\(\)',  '(select auth.uid())', 'g');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.role\(\)', '(select auth.role())', 'g');
      v_new_qual := regexp_replace(v_new_qual, 'auth\.jwt\(\)',  '(select auth.jwt())', 'g');
      v_new_qual := replace(replace(replace(v_new_qual, '@@UID@@', '(select auth.uid())'),
                                    '@@ROLE@@', '(select auth.role())'),
                                    '@@JWT@@', '(select auth.jwt())');
    END IF;

    v_new_check := r.check_expr;
    IF v_new_check IS NOT NULL THEN
      v_new_check := regexp_replace(v_new_check, '\(\s*select\s+auth\.uid\(\)\s*\)',  '@@UID@@', 'gi');
      v_new_check := regexp_replace(v_new_check, '\(\s*select\s+auth\.role\(\)\s*\)', '@@ROLE@@', 'gi');
      v_new_check := regexp_replace(v_new_check, '\(\s*select\s+auth\.jwt\(\)\s*\)',  '@@JWT@@', 'gi');
      v_new_check := regexp_replace(v_new_check, 'auth\.uid\(\)',  '(select auth.uid())', 'g');
      v_new_check := regexp_replace(v_new_check, 'auth\.role\(\)', '(select auth.role())', 'g');
      v_new_check := regexp_replace(v_new_check, 'auth\.jwt\(\)',  '(select auth.jwt())', 'g');
      v_new_check := replace(replace(replace(v_new_check, '@@UID@@', '(select auth.uid())'),
                                    '@@ROLE@@', '(select auth.role())'),
                                    '@@JWT@@', '(select auth.jwt())');
    END IF;

    IF (v_new_qual IS DISTINCT FROM r.qual_expr) OR (v_new_check IS DISTINCT FROM r.check_expr) THEN
      -- Roles exactly as before. pg_policy stores TO PUBLIC as the oid array
      -- {0}; a non-public list aggregates the actual role names.
      SELECT CASE
               WHEN cardinality(r.polroles) = 0 OR r.polroles = ARRAY[0::oid] THEN 'PUBLIC'
               ELSE coalesce(string_agg(format('%I', rol.rolname), ', '), 'PUBLIC')
             END
        INTO v_roles
        FROM pg_roles rol
       WHERE rol.oid = ANY (r.polroles);

      v_cmd  := CASE r.polcmd
                  WHEN 'r' THEN 'SELECT'   WHEN 'a' THEN 'INSERT'
                  WHEN 'w' THEN 'UPDATE'   WHEN 'd' THEN 'DELETE'
                  ELSE 'ALL'
                END;
      v_kind := CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END;

      EXECUTE format('DROP POLICY %I ON %I.%I', r.policy_name, r.schema_name, r.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
        r.policy_name, r.schema_name, r.table_name, v_kind, v_cmd, v_roles,
        CASE WHEN v_new_qual  IS NULL THEN '' ELSE format(' USING (%s)',  v_new_qual)  END,
        CASE WHEN v_new_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', v_new_check) END
      );

      RAISE NOTICE 'rewrapped: %.% (%)', r.table_name, r.policy_name, v_cmd;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- CHECK (run after):
--   1) Count policies still containing an un-wrapped auth call (expect 0):
--      select count(*) from pg_policies
--      where schemaname = 'public'
--        and ((qual       ~ 'auth\.(uid|role|jwt)\(\)'
--              and qual       !~ '\(\s*select\s+auth\.(uid|role|jwt)\(\)\s*\)')
--          or (with_check ~ 'auth\.(uid|role|jwt)\(\)'
--              and with_check !~ '\(\s*select\s+auth\.(uid|role|jwt)\(\)\s*\)'));
--
--   2) Policy count unchanged (no policy lost — compare with the pre-run number):
--      select count(*) from pg_policies where schemaname = 'public';
--
--   3) Representative plan check (should show "InitPlan" for the auth call):
--      explain (analyze, buffers)
--      select id from public.results where is_published = true and class = '9';
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════ ROLLBACK (run only if needed) ═════════════════
-- This migration rewrites expressions in place; the clean rollback is to
-- re-run the ORIGINAL policy DDL from Supabase/Migration/05 (and 10), which
-- contains every CREATE POLICY statement verbatim. Recommended procedure:
--   1) Export current policies first (BEFORE running this file):
--        select schemaname, tablename, policyname, cmd, roles, qual, with_check
--        from pg_policies where schemaname = 'public';
--      and keep the export as rollback_file14.sql.
--   2) To roll back: for each exported policy, DROP POLICY ... ; CREATE
--      POLICY ... USING (<original qual>) WITH CHECK (<original with_check>).
-- A mechanical unwrap (replace '(select auth.uid())' -> 'auth.uid()') is NOT
-- recommended: it would also unwrap calls that were already wrapped before.
