-- ═══════════════════════════════════════════════════════════════════════════
-- 21_admission_portal.sql — Applicant Dashboard portal support (ADDITIVE).
--
-- Ports the GHSS Ghallanai "Applicant Dashboard / My Application" experience
-- to GHS Babi Khel WITHOUT touching any existing table, trigger, policy or
-- function (the High School 6–10 flow, migration steps and payment model stay
-- exactly as they are — this file only ADDS the portal read RPC).
--
-- What it adds:
--   • public.admission_portal_state(p_reference_no, p_b_form_no)
--       — the ONE call the Applicant Dashboard (/admission/portal) and the
--         Application View page (/admission/application/:id) use to paint
--         themselves. Ownership is proven with the SAME reference-no +
--         B-Form pair already printed on the applicant's challan (identical
--         matching rule to admission_proceed_payment), so nothing new is
--         trusted and nothing else is exposed.
--       — returns {ok, application:{all applicant-visible fields incl. the
--         payment fields}, timeline:[admission_status_timeline rows, newest
--         first]} in a single round trip.
--
-- Run AFTER 20_admission_payment_merit.sql. Safe to re-run (OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Public: full application + timeline for the Applicant Dashboard ────────
CREATE OR REPLACE FUNCTION public.admission_portal_state(
    p_reference_no text,
    p_b_form_no text
) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_ref_key  text := upper(trim(p_reference_no));
    v_bform_key text := regexp_replace(trim(p_b_form_no), '[^0-9]', '', 'g');
    v_row public.admissions%ROWTYPE;
BEGIN
    IF v_ref_key = '' OR v_bform_key = '' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Reference number and B-Form number are required.');
    END IF;

    SELECT * INTO v_row FROM public.admissions a
     WHERE upper(a.reference_no) = v_ref_key
       AND regexp_replace(coalesce(a.b_form_no, ''), '[^0-9]', '', 'g') = v_bform_key
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'No application found for this reference and B-Form number.');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'application', jsonb_build_object(
            'id',                    v_row.id,
            'reference_no',          v_row.reference_no,
            'full_name',             v_row.full_name,
            'father_name',           v_row.father_name,
            'date_of_birth',         v_row.date_of_birth,
            'b_form_no',             v_row.b_form_no,
            'contact_number',        v_row.contact_number,
            'whatsapp_number',       v_row.whatsapp_number,
            'home_address',          v_row.home_address,
            'gender',                v_row.gender,
            'applying_class',        v_row.applying_class,
            'admission_type',        v_row.admission_type,
            'previous_school',       v_row.previous_school,
            'previous_class',        v_row.previous_class,
            'previous_marks',        v_row.previous_marks,
            'year_of_passing',       v_row.year_of_passing,
            'status',                v_row.status,
            'admin_note',            v_row.admin_note,
            'rejection_reason',      v_row.rejection_reason,
            'admission_roll_no',     v_row.admission_roll_no,
            'migration_step',        v_row.migration_step,
            'payment_status',        v_row.payment_status,
            'payment_reference',     v_row.payment_reference,
            'payment_method',        v_row.payment_method,
            'payment_receipt',       v_row.payment_receipt,
            'processing_fee',        v_row.processing_fee,
            'fee_deadline',          v_row.fee_deadline,
            'paid_at',               v_row.paid_at,
            'father_cnic',           v_row.father_cnic,
            'occupation',            v_row.occupation,
            'created_at',            v_row.created_at,
            'updated_at',            v_row.updated_at
        ),
        'timeline', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id',          t.id,
                       'from_status', t.from_status,
                       'to_status',   t.to_status,
                       'note',        t.note,
                       'actor',       t.actor,
                       'created_at',  t.created_at
                   ) ORDER BY t.created_at DESC)
              FROM public.admission_status_timeline t
             WHERE t.admission_id = v_row.id
        ), '[]'::jsonb)
    );
END;
$$;


-- ── Grants (same pattern as file 20: public pair-proved reader) ────────────
REVOKE EXECUTE ON FUNCTION public.admission_portal_state(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admission_portal_state(text, text) TO anon, authenticated;
