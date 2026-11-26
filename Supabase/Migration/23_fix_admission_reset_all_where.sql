-- 23_fix_admission_reset_all_where.sql
-- Fixes "DELETE requires a WHERE clause" when the admin presses
-- Admission Applications → Delete All.
--
-- Supabase enables the pg_safeupdate guard, which rejects any DELETE/UPDATE
-- that has no WHERE clause. admission_admin_reset_all() used bare
-- "DELETE FROM ..." statements, so it always failed. Same logic, with an
-- explicit WHERE on every delete. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.admission_admin_reset_all(p_confirm text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_count integer;
    v_merit integer;
    v_events integer;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF COALESCE(p_confirm, '') <> 'DELETE ALL' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Type DELETE ALL to confirm.');
    END IF;

    SELECT count(*) INTO v_merit FROM public.admission_merit_lists;
    DELETE FROM public.admission_merit_lists WHERE id IS NOT NULL;   -- entries cascade

    DELETE FROM public.admission_payment_events
     WHERE tracking_id IN (SELECT reference_no FROM public.admissions);
    GET DIAGNOSTICS v_events = ROW_COUNT;

    SELECT count(*) INTO v_count FROM public.admissions;
    DELETE FROM public.admissions WHERE id IS NOT NULL;              -- documents / timeline / bookings cascade

    RETURN jsonb_build_object('ok', true, 'admissions', v_count,
                              'merit_lists', v_merit, 'payment_events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION public.admission_admin_reset_all(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_admin_reset_all(text) TO authenticated, service_role;
