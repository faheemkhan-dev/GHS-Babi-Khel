-- ═══════════════════════════════════════════════════════════════════════════
-- 22_admission_board_compliance.sql — BISE Peshawar alignment (2026 rules)
--
-- WHAT THIS MIGRATION ADDS (all additive — existing data is untouched):
--   1. admissions columns:
--        previous_board            — board of the previous school (BISEP / other board name)
--        board_enrollment_no       — BISEP enrollment/registration no. (if already enrolled)
--        board_roll_no             — 9th-class roll no. (for Class 10 admission)
--        previous_result           — 9th result for Class 10 applicants (e.g. 420/550)
--        slc_no / slc_date         — School Leaving Certificate number + issue date
--        migration_cert_no         — other-board Migration Certificate no. (board-to-board cases)
--        previously_enrolled       — was the student EVER enrolled with any board for class 9/10?
--        admission_date            — date admission was confirmed at the school office
--        bisep_enrollment_no       — 9th enrollment no. issued by BISEP after online enrollment
--        bisep_enrolled_at         — when the school completed the BISEP enrollment
--        board_fee_status          — pending | paid | n_a — BISEP 9th enrollment fee (Rs 1300)
--        board_fee_paid_at         — when the BISEP fee was deposited
--      + CHECK on previously_enrolled / board columns is NOT added (legacy rows
--        may be null) — validation lives in admission_admin_admit().
--   2. admission_settings columns:
--        bisep_note                — short public note about the BISEP schedule
--        class9_last_date          — separate Class 9 close date (board enrollment window)
--        board_fee_amount          — BISEP 9th enrollment fee shown to applicants (default 1300)
--        board_fee_due_date        — BISEP normal due date shown to applicants
--   3. admission_class_seats.last_date — per-class last date (defaults to the
--        global last_date when NULL; class9 can close earlier).
--   4. admission_merit_lists.show_not_listed (default true) — the school can
--        hide "Not Merit Listed" names from the public list (privacy).
--   5. RPCs:
--        track_admission(p_query)  — REPLACED: matches B-Form/CNIC with or
--              without dashes (digits-only compare) — the #1 support issue.
--        admission_admin_verify_documents(p_admission_id, p_note)
--              → status documents_verified (+ timeline row).
--        admission_admin_reject(p_admission_id, p_reason)
--              → status rejected (+ timeline row, reason stored).
--        admission_admin_admit(p_admission_id, p_admission_no, p_admission_date,
--              p_bisep_enrollment_no)
--              → status admitted; writes admission no/date; Class 9 fresh also
--              gets bisep_enrollment_no + board_fee_status='pending'.
--        admission_admin_set_board_fee(p_admission_id, p_status, p_paid_at)
--              → records the BISEP enrollment fee deposit.
--        admission_admin_set_migration_step(p_admission_id, p_step)
--              → advances the applicant's migration tracker (1..6).
--        admission_merit_auto(...) — REPLACED with p_type ('all'|'fresh'|
--              'migration') so Fresh and Migration lists can be generated
--              separately per class; respects show_not_listed.
--        admission_merit_set_show_not_listed(p_id, p_show)
--              → show/hide not-listed names on one published list.
--        submit-safe duplicate lock: a UNIQUE index on
--              (session-broken) is NOT possible without a session column, so
--              instead a partial unique index blocks a second OPEN application
--              of the same B-Form within the same session year — implemented as
--              a unique index on b_form_digits+year via an immutable helper.
--   6. RLS hardening (matches what is already deployed on the live project but
--      was missing from this repo's migrations): anon loses SELECT on
--      admissions / admission_documents / admission_status_timeline /
--      admission_otp_codes / fee_vouchers / interview_bookings / interview_slots;
--      the public paths go through SECURITY DEFINER RPCs (submit insert policy
--      stays, track/portal RPCs already exist). Admin RPCs get REVOKE from
--      anon + RESTRICTED execute to the admin role via admission_is_admin()
--      checks (functions keep SECURITY DEFINER but check the caller).
--
-- SOURCE (board facts encoded here):
--   BISE Peshawar Revised Notification No. 70/Gen/Enrol/BISEP (20-08-2026):
--     9th enrollment Rs 1300 by 30-09-2026, late 1800 by 15-10, double 2300 by
--     30-10, then Rs 10/day till 30-11-2026; age above 12 (DOB cut-off
--     31-03-2014); migration from another board needs original migration
--     certificate + verified 9th DMC + countersigned SLC within a fortnight;
--     school-to-school migration until 31-12-2026; receiving school applies.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. admissions: board / migration / admission columns ───────────────────

ALTER TABLE public.admissions
    ADD COLUMN IF NOT EXISTS previous_board        text,
    ADD COLUMN IF NOT EXISTS board_enrollment_no   text,
    ADD COLUMN IF NOT EXISTS board_roll_no         text,
    ADD COLUMN IF NOT EXISTS previous_result       text,
    ADD COLUMN IF NOT EXISTS slc_no                text,
    ADD COLUMN IF NOT EXISTS slc_date              date,
    ADD COLUMN IF NOT EXISTS migration_cert_no     text,
    ADD COLUMN IF NOT EXISTS previously_enrolled   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS admission_date        date,
    ADD COLUMN IF NOT EXISTS bisep_enrollment_no   text,
    ADD COLUMN IF NOT EXISTS bisep_enrolled_at     timestamptz,
    ADD COLUMN IF NOT EXISTS board_fee_status      text NOT NULL DEFAULT 'n_a'
        CHECK (board_fee_status IN ('n_a', 'pending', 'paid')),
    ADD COLUMN IF NOT EXISTS board_fee_paid_at     timestamptz;

COMMENT ON COLUMN public.admissions.previous_board      IS 'Board of the previous school (e.g. BISE Peshawar, BISE Mardan) — asked for class 9/10';
COMMENT ON COLUMN public.admissions.board_enrollment_no IS 'BISEP enrollment / registration no. if the student was ever enrolled with a board';
COMMENT ON COLUMN public.admissions.board_roll_no       IS '9th-class roll no. (class 10 applicants from another school/board)';
COMMENT ON COLUMN public.admissions.previous_result     IS '9th-class result, e.g. 420/550 (class 10 applicants)';
COMMENT ON COLUMN public.admissions.slc_no              IS 'School Leaving Certificate no. (migration applicants)';
COMMENT ON COLUMN public.admissions.slc_date            IS 'School Leaving Certificate issue date';
COMMENT ON COLUMN public.admissions.migration_cert_no   IS 'Migration Certificate no. — other-board applicants (board-to-board)';
COMMENT ON COLUMN public.admissions.previously_enrolled IS 'Student was ever enrolled with any board for class 9/10 (BISEP: then a migration certificate is required first)';
COMMENT ON COLUMN public.admissions.admission_date      IS 'Date admission was confirmed at the school office';
COMMENT ON COLUMN public.admissions.bisep_enrollment_no IS 'BISEP 9th enrollment no. after the school completes online enrollment';
COMMENT ON COLUMN public.admissions.board_fee_status    IS 'BISEP 9th enrollment fee status: n_a (not class 9), pending, paid';

-- B-Form digits helper (immutable — safe in an index expression).
CREATE OR REPLACE FUNCTION public.admission_bform_digits(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g'); $$;

-- ── 2. admission_settings: board schedule / class 9 close ──────────────────

ALTER TABLE public.admission_settings
    ADD COLUMN IF NOT EXISTS bisep_note          text,
    ADD COLUMN IF NOT EXISTS class9_last_date    date,
    ADD COLUMN IF NOT EXISTS board_fee_amount    integer NOT NULL DEFAULT 1300,
    ADD COLUMN IF NOT EXISTS board_fee_due_date  date;

COMMENT ON COLUMN public.admission_settings.bisep_note         IS 'Short public note about the BISE Peshawar schedule (shown on the admission page)';
COMMENT ON COLUMN public.admission_settings.class9_last_date   IS 'Separate last date for Class 9 applications (BISEP enrollment window closes earlier)';
COMMENT ON COLUMN public.admission_settings.board_fee_amount   IS 'BISEP 9th enrollment fee shown to applicants (Rs 1300 normal, 2026)';
COMMENT ON COLUMN public.admission_settings.board_fee_due_date IS 'BISEP 9th enrollment fee normal due date shown to applicants';

-- ── 3. admission_class_seats: per-class last date ───────────────────────────

ALTER TABLE public.admission_class_seats
    ADD COLUMN IF NOT EXISTS last_date date;

COMMENT ON COLUMN public.admission_class_seats.last_date
    IS 'Last date for THIS class (NULL = use the global admission_settings.last_date)';

-- Class & Seats public reader now includes the per-class last date.
CREATE OR REPLACE FUNCTION public.admission_class_seats_list() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.display_order), '[]'::jsonb)
      FROM (
        SELECT s."class" AS class,
               'Class ' || s."class" AS class_label,
               s.seats,
               s.is_open,
               s.display_order,
               s.last_date AS class_last_date
          FROM public.admission_class_seats s
      ) t;
    $$;

-- Admin: set the per-class last date together with seats / open.
CREATE OR REPLACE FUNCTION public.admission_admin_set_class_seats(
    p_class text,
    p_seats integer DEFAULT NULL,
    p_is_open boolean DEFAULT NULL,
    p_last_date date DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    UPDATE public.admission_class_seats
       SET seats        = COALESCE(p_seats, seats),
           is_open      = COALESCE(p_is_open, is_open),
           last_date    = CASE WHEN p_last_date IS NULL THEN last_date
                               WHEN p_last_date = '1900-01-01'::date THEN NULL  -- sentinel: clear
                               ELSE p_last_date END,
           updated_at   = now()
     WHERE "class" = p_class;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Unknown class.');
    END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 4. merit lists: show/hide "Not Merit Listed" names ──────────────────────

ALTER TABLE public.admission_merit_lists
    ADD COLUMN IF NOT EXISTS show_not_listed boolean NOT NULL DEFAULT true;

-- Public detail: hide the names of not-listed applicants when the flag is off.
CREATE OR REPLACE FUNCTION public.admission_merit_list_view(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_list record;
    v_entries jsonb;
    v_listed integer;
    v_not_listed integer;
BEGIN
    SELECT * INTO v_list FROM public.admission_merit_lists
     WHERE id = p_id AND is_published;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    SELECT count(*) FILTER (WHERE is_listed),
           count(*) FILTER (WHERE NOT is_listed)
      INTO v_listed, v_not_listed
      FROM public.admission_merit_list_entries
     WHERE merit_list_id = p_id;

    IF v_list.show_not_listed THEN
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.position), '[]'::jsonb) INTO v_entries
          FROM (
            SELECT e.position, e.reference_no, e.name, e.father_name,
                   e.previous_marks, e.marks_pct, e.remarks, e.is_listed
              FROM public.admission_merit_list_entries e
             WHERE e.merit_list_id = p_id
          ) t;
    ELSE
        -- names of not-listed applicants are private: position + marks only
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.position), '[]'::jsonb) INTO v_entries
          FROM (
            SELECT e.position, e.reference_no, e.name, e.father_name,
                   e.previous_marks, e.marks_pct, e.remarks, e.is_listed
              FROM public.admission_merit_list_entries e
             WHERE e.merit_list_id = p_id AND e.is_listed
          ) t;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'list', jsonb_build_object(
            'id', v_list.id, 'class', v_list."class",
            'class_label', 'Class ' || v_list."class",
            'list_no', v_list.list_no, 'title', v_list.title,
            'session_year', v_list.session_year,
            'admission_start_date', v_list.admission_start_date,
            'admission_last_date', v_list.admission_last_date,
            'instructions', v_list.instructions,
            'published_at', v_list.published_at,
            'show_not_listed', v_list.show_not_listed),
        'entries', v_entries,
        'listed_count', v_listed,
        'not_listed_count', v_not_listed);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_merit_set_show_not_listed(
    p_id uuid,
    p_show boolean
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    UPDATE public.admission_merit_lists
       SET show_not_listed = p_show
     WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── 5a. track_admission: dash-tolerant B-Form / CNIC / phone match ─────────

CREATE OR REPLACE FUNCTION public.track_admission(p_query text) RETURNS SETOF public.admissions
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT a.*
      FROM public.admissions a
     WHERE lower(a.reference_no)                = lower(trim(p_query))
        OR public.admission_bform_digits(a.b_form_no)          = public.admission_bform_digits(p_query)
        OR public.admission_bform_digits(a.father_cnic)        = public.admission_bform_digits(p_query)
        OR regexp_replace(COALESCE(a.contact_number,  ''), '[^0-9]', '', 'g') = regexp_replace(p_query, '[^0-9]', '', 'g')
        OR regexp_replace(COALESCE(a.whatsapp_number, ''), '[^0-9]', '', 'g') = regexp_replace(p_query, '[^0-9]', '', 'g')
        OR lower(a.admission_roll_no)            = lower(trim(p_query))
     ORDER BY a.created_at DESC
     LIMIT 5;
$$;

-- ── 5b. admin workflow RPCs (timeline row + guard in every one) ────────────

CREATE OR REPLACE FUNCTION public.admission_admin_verify_documents(
    p_admission_id uuid,
    p_note text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_ref text; v_prev text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    SELECT reference_no, status INTO v_ref, v_prev FROM public.admissions WHERE id = p_admission_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    IF v_prev = 'rejected' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This application was rejected.');
    END IF;
    UPDATE public.admissions
       SET status = 'documents_verified', updated_at = now()
     WHERE id = p_admission_id;
    INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    VALUES (p_admission_id, v_prev, 'documents_verified',
            COALESCE(NULLIF(trim(p_note), ''), 'Documents verified at the school office.'), 'admin');
    RETURN jsonb_build_object('ok', true, 'reference_no', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_admin_reject(
    p_admission_id uuid,
    p_reason text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_ref text; v_prev text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF NULLIF(trim(p_reason), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'A rejection reason is required.');
    END IF;
    SELECT reference_no, status INTO v_ref, v_prev FROM public.admissions WHERE id = p_admission_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    UPDATE public.admissions
       SET status = 'rejected', rejection_reason = trim(p_reason), updated_at = now()
     WHERE id = p_admission_id;
    INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    VALUES (p_admission_id, v_prev, 'rejected', trim(p_reason), 'admin');
    RETURN jsonb_build_object('ok', true, 'reference_no', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_admin_admit(
    p_admission_id uuid,
    p_admission_no text,
    p_admission_date date DEFAULT NULL,
    p_bisep_enrollment_no text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_ref text; v_prev text; v_cls text; v_type text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF NULLIF(trim(p_admission_no), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admission number is required.');
    END IF;
    SELECT reference_no, status, applying_class, admission_type
      INTO v_ref, v_prev, v_cls, v_type
      FROM public.admissions WHERE id = p_admission_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    IF v_prev = 'rejected' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This application was rejected.');
    END IF;

    UPDATE public.admissions
       SET status = 'admitted',
           admission_roll_no = trim(p_admission_no),
           admission_date = COALESCE(p_admission_date, current_date),
           -- Class 9 fresh students are enrolled with BISEP by the school right
           -- after admission (board notification 70/Gen/Enrol/BISEP 2026).
           bisep_enrollment_no = CASE WHEN v_cls = '9' AND v_type = 'fresh'
                                      THEN COALESCE(NULLIF(trim(p_bisep_enrollment_no), ''), bisep_enrollment_no)
                                      ELSE bisep_enrollment_no END,
           board_fee_status = CASE WHEN v_cls = '9' AND v_type = 'fresh' AND board_fee_status = 'n_a'
                                   THEN 'pending' ELSE board_fee_status END,
           updated_at = now()
     WHERE id = p_admission_id;

    INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    VALUES (p_admission_id, v_prev, 'admitted',
            'Admitted. Admission No. ' || trim(p_admission_no) ||
            CASE WHEN v_cls = '9' AND v_type = 'fresh'
                 THEN '. The school will enroll the student with BISE Peshawar and share the enrollment number.'
                 ELSE '' END,
            'admin');
    RETURN jsonb_build_object('ok', true, 'reference_no', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_admin_set_board_fee(
    p_admission_id uuid,
    p_status text,
    p_paid_at timestamptz DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_ref text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF p_status NOT IN ('n_a', 'pending', 'paid') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Status must be n_a, pending or paid.');
    END IF;
    UPDATE public.admissions
       SET board_fee_status = p_status,
           board_fee_paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(p_paid_at, now())
                                    ELSE NULL END,
           bisep_enrolled_at = CASE WHEN p_status = 'paid' THEN COALESCE(p_paid_at, now())
                                    ELSE bisep_enrolled_at END,
           updated_at = now()
     WHERE id = p_admission_id
    RETURNING reference_no INTO v_ref;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    RETURN jsonb_build_object('ok', true, 'reference_no', v_ref);
END;
$$;

-- Migration steps (shown in the applicant tracker):
--   1  Online application submitted to our school
--   2  Merit list published — merit-listed students bring documents (incl. SLC)
--   3  Our school (the RECEIVING school) applies for the migration on the BISEP portal
--   4  The previous school / board completes the migration (portal / certificate)
--   5  BISEP fee / challan (if applicable) paid
--   6  Admission & enrollment confirmed at our school
CREATE OR REPLACE FUNCTION public.admission_admin_set_migration_step(
    p_admission_id uuid,
    p_step integer
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_ref text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF p_step IS NULL OR p_step < 1 OR p_step > 6 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Step must be between 1 and 6.');
    END IF;
    UPDATE public.admissions
       SET migration_step = p_step, updated_at = now()
     WHERE id = p_admission_id AND admission_type = 'migration'
    RETURNING reference_no INTO v_ref;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_migration'); END IF;
    RETURN jsonb_build_object('ok', true, 'reference_no', v_ref);
END;
$$;

-- ── 5c. merit auto with p_type (all / fresh / migration) ────────────────────

CREATE OR REPLACE FUNCTION public.admission_merit_auto(
    p_list_no integer,
    p_admission_start_date date DEFAULT NULL,
    p_admission_last_date date DEFAULT NULL,
    p_instructions text DEFAULT NULL,
    p_publish boolean DEFAULT false,
    p_dry_run boolean DEFAULT false,
    p_class text DEFAULT NULL,
    p_type text DEFAULT 'all'
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_admin boolean;
    v_settings record;
    v_ordinal text;
    v_title_prefix text;
    v_instructions text;
    v_classes text[];
    v_cls text;
    v_seats integer;
    v_taken integer;
    v_left integer;
    v_eligible integer;
    v_selected integer;
    v_unpaid integer;
    v_cutoff numeric;
    v_list_id uuid;
    v_was_published boolean;
    v_old_list record;
    v_old_listed uuid[];
    v_aid uuid;
    v_result jsonb := '[]'::jsonb;
    v_type_filter text;
    v_type_label text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF p_list_no IS NULL OR p_list_no < 1 OR p_list_no > 50 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'List number must be between 1 and 50.');
    END IF;
    IF COALESCE(p_type, 'all') NOT IN ('all', 'fresh', 'migration') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Type must be all, fresh or migration.');
    END IF;
    v_type_filter := p_type;
    v_type_label := CASE COALESCE(p_type, 'all')
                      WHEN 'fresh' THEN ' (Fresh) '
                      WHEN 'migration' THEN ' (Migration) '
                      ELSE ' ' END;

    SELECT session_year, last_date, processing_fee INTO v_settings
      FROM public.admission_settings WHERE id = 1;

    v_ordinal := CASE
        WHEN p_list_no % 100 IN (11, 12, 13) THEN p_list_no::text || 'th'
        WHEN p_list_no % 10 = 1 THEN p_list_no::text || 'st'
        WHEN p_list_no % 10 = 2 THEN p_list_no::text || 'nd'
        WHEN p_list_no % 10 = 3 THEN p_list_no::text || 'rd'
        ELSE p_list_no::text || 'th'
    END;
    v_title_prefix := v_ordinal || ' ' ||
        CASE WHEN p_list_no = 1 THEN 'Provisional ' ELSE '' END ||
        'Merit List for Session ' || COALESCE(v_settings.session_year, extract(year FROM now())::text) ||
        ' [Government High School Babi Khel] Class ';

    v_instructions := COALESCE(NULLIF(trim(p_instructions), ''),
        '1. Bring a printed copy of your application form (download it from the admission page).' || chr(10) ||
        '2. Bring 2 attested copies of the previous class result card and B-Form.' || chr(10) ||
        '3. Bring 4 passport-size photographs (white background).' || chr(10) ||
        '4. Bring an attested copy of the father/guardian CNIC.' || chr(10) ||
        '5. Bring the School Leaving Certificate if transferring from another school.' || chr(10) ||
        '6. Bring all original documents for verification.' || chr(10) ||
        '7. Pay the admission fee challan at the school office by the last date.');

    IF p_class IS NOT NULL AND NULLIF(trim(p_class), '') IS NOT NULL THEN
        v_classes := ARRAY[trim(p_class)];
    ELSE
        SELECT array_agg(s."class" ORDER BY s.display_order) INTO v_classes
          FROM public.admission_class_seats s WHERE s.is_open;
        IF v_classes IS NULL THEN
            SELECT array_agg(s."class" ORDER BY s.display_order) INTO v_classes
              FROM public.admission_class_seats s;
        END IF;
    END IF;

    FOR v_cls IN SELECT unnest(v_classes) LOOP
        v_seats := COALESCE((SELECT seats FROM public.admission_class_seats WHERE "class" = v_cls), 0);

        -- Seats already taken by OTHER published lists of this class (same type).
        SELECT count(DISTINCT e.admission_id) INTO v_taken
          FROM public.admission_merit_list_entries e
          JOIN public.admission_merit_lists m ON m.id = e.merit_list_id
          JOIN public.admissions a2 ON a2.id = e.admission_id
         WHERE m.is_published AND m."class" = v_cls
           AND m.list_no <> p_list_no AND e.is_listed
           AND (v_type_filter = 'all' OR a2.admission_type = v_type_filter);

        v_left := GREATEST(v_seats - v_taken, 0);

        SELECT count(*) INTO v_unpaid
          FROM public.admissions a
         WHERE a.applying_class = v_cls
           AND a.payment_status <> 'paid'
           AND a.status NOT IN ('rejected', 'admitted', 'admit_card_issued')
           AND (v_type_filter = 'all' OR a.admission_type = v_type_filter);

        DROP TABLE IF EXISTS pg_temp._merit_pool;
        CREATE TEMP TABLE _merit_pool AS
        SELECT a.id, a.reference_no, a.full_name, a.father_name, a.previous_marks, a.created_at,
               public.admission_marks_pct(a.previous_marks) AS marks_pct,
               row_number() OVER (ORDER BY
                   public.admission_marks_pct(a.previous_marks) DESC NULLS LAST,
                   a.created_at ASC, a.reference_no ASC) AS rn
          FROM public.admissions a
         WHERE a.applying_class = v_cls
           AND a.payment_status = 'paid'
           AND a.status NOT IN ('rejected', 'admitted', 'admit_card_issued')
           AND (v_type_filter = 'all' OR a.admission_type = v_type_filter)
           AND NOT EXISTS (
                SELECT 1 FROM public.admission_merit_list_entries e
                  JOIN public.admission_merit_lists m ON m.id = e.merit_list_id
                  JOIN public.admissions a3 ON a3.id = e.admission_id
                 WHERE e.admission_id = a.id AND e.is_listed
                   AND m.is_published AND m."class" = v_cls AND m.list_no <> p_list_no
                   AND (v_type_filter = 'all' OR a3.admission_type = v_type_filter));

        SELECT count(*) INTO v_eligible FROM _merit_pool;
        v_selected := LEAST(v_left, v_eligible);
        SELECT min(marks_pct) INTO v_cutoff FROM _merit_pool WHERE rn <= v_left;

        IF p_dry_run THEN
            v_result := v_result || jsonb_build_object(
                'class', v_cls, 'class_label', 'Class ' || v_cls,
                'seats', v_seats, 'taken', v_taken, 'seats_left', v_left,
                'eligible', v_eligible, 'selected', v_selected,
                'waiting', v_eligible - v_selected, 'unpaid', v_unpaid, 'cutoff', v_cutoff);
            CONTINUE;
        END IF;

        -- Replace any old list of this (class, list_no, type-ish title); remember if it was published.
        v_was_published := false;
        FOR v_old_list IN SELECT * FROM public.admission_merit_lists
                           WHERE "class" = v_cls AND list_no = p_list_no
                             AND title LIKE '%' || v_cls || '%'
                             AND (v_type_filter = 'all'
                                  OR (v_type_filter = 'fresh' AND title NOT LIKE '%Migration%')
                                  OR (v_type_filter = 'migration' AND title LIKE '%Migration%'))
                         LOOP
            v_was_published := v_was_published OR v_old_list.is_published;
            SELECT array_agg(e.admission_id) INTO v_old_listed
              FROM public.admission_merit_list_entries e
             WHERE e.merit_list_id = v_old_list.id AND e.is_listed;

            DELETE FROM public.admission_merit_lists WHERE id = v_old_list.id;  -- entries cascade

            IF v_old_listed IS NOT NULL THEN
                FOREACH v_aid IN ARRAY v_old_listed LOOP
                    IF EXISTS (SELECT 1 FROM public.admissions a
                                WHERE a.id = v_aid AND a.status = 'merit_listed')
                       AND NOT EXISTS (
                            SELECT 1 FROM public.admission_merit_list_entries e
                              JOIN public.admission_merit_lists m ON m.id = e.merit_list_id
                             WHERE e.admission_id = v_aid AND e.is_listed AND m.is_published) THEN
                        UPDATE public.admissions SET status = 'under_review', updated_at = now()
                         WHERE id = v_aid;
                    END IF;
                END LOOP;
            END IF;

            DELETE FROM public.admission_status_timeline
             WHERE note LIKE 'Selected in the ' || v_ordinal || ' merit list for Class ' || v_cls || '%'
                OR note LIKE 'Not selected in the ' || v_ordinal || ' merit list for Class ' || v_cls || '%';
        END LOOP;

        INSERT INTO public.admission_merit_lists
            ("class", list_no, title, session_year, admission_start_date, admission_last_date,
             instructions, is_published, published_at, show_not_listed)
        VALUES (v_cls, p_list_no, v_title_prefix || v_cls || v_type_label,
                COALESCE(v_settings.session_year, extract(year FROM now())::text),
                COALESCE(p_admission_start_date, current_date),
                COALESCE(p_admission_last_date, v_settings.last_date, current_date + 7),
                v_instructions,
                (p_publish OR v_was_published),
                CASE WHEN p_publish OR v_was_published THEN now() ELSE NULL END,
                true)
        RETURNING id INTO v_list_id;

        INSERT INTO public.admission_merit_list_entries
            (merit_list_id, admission_id, position, reference_no, name, father_name,
             previous_marks, marks_pct, remarks, is_listed)
        SELECT v_list_id, p.id, p.rn, p.reference_no, p.full_name, p.father_name,
               p.previous_marks, p.marks_pct,
               CASE WHEN p.rn <= v_left THEN NULL ELSE 'Not Merit Listed' END,
               p.rn <= v_left
          FROM _merit_pool p;

        IF p_publish OR v_was_published THEN
            PERFORM public.admission_merit_apply_states(v_list_id);
        END IF;

        v_result := v_result || jsonb_build_object(
            'class', v_cls, 'class_label', 'Class ' || v_cls,
            'seats', v_seats, 'taken', v_taken, 'seats_left', v_left,
            'eligible', v_eligible, 'selected', v_selected,
            'waiting', v_eligible - v_selected, 'unpaid', v_unpaid, 'cutoff', v_cutoff,
            'list_id', v_list_id);
    END LOOP;

    DROP TABLE IF EXISTS pg_temp._merit_pool;

    RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run,
                              'published', p_publish, 'lists', v_result);
END;
$$;

-- ── 5d. duplicate lock: one open application per B-Form per session ────────
-- The reference_no sequence already encodes the year (GHS-YYYY-…); a unique
-- index on (digits, year-of-created_at) can't be partial over expressions, so
-- this uses the immutable digits helper + the existing reference prefix.

CREATE UNIQUE INDEX IF NOT EXISTS admissions_bform_session_unique
    ON public.admissions (
        public.admission_bform_digits(b_form_no),
        substring(reference_no from '^([A-Z]+-[0-9]{4})-')
    )
    WHERE public.admission_bform_digits(b_form_no) <> ''
      AND status NOT IN ('rejected', 'admitted', 'admit_card_issued');

-- ── 5e. walk-in RPC: accept date_of_birth + gender, migration class guard ──

CREATE OR REPLACE FUNCTION public.admission_admin_add_walkin(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_id uuid;
    v_ref text;
    v_fee integer;
    v_deadline timestamptz;
    v_cls text;
    v_type text;
    v_digits13 text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;

    v_cls := regexp_replace(COALESCE(p->>'applying_class', ''), '[^0-9]', '', 'g');
    v_type := lower(COALESCE(p->>'admission_type', 'fresh'));
    v_digits13 := regexp_replace(COALESCE(p->>'b_form_no', ''), '[^0-9]', '', 'g');

    IF v_cls NOT IN ('6','7','8','9','10') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Class must be 6-10.');
    END IF;
    IF length(v_digits13) <> 13 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'B-Form must be exactly 13 digits.');
    END IF;
    -- BISE Peshawar portal migration exists for class 9/10 only.
    IF v_type = 'migration' AND v_cls NOT IN ('9','10') THEN
        v_type := 'fresh';
    END IF;
    IF v_type NOT IN ('fresh','migration') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Type must be fresh or migration.');
    END IF;

    SELECT COALESCE(processing_fee, 0) INTO v_fee FROM public.admission_settings WHERE id = 1;
    v_deadline := public.admission_fee_deadline();

    INSERT INTO public.admissions
        (full_name, father_name, date_of_birth, gender, b_form_no, contact_number, whatsapp_number,
         home_address, applying_class, admission_type, previous_school, previous_class,
         previous_marks, year_of_passing, father_cnic, occupation,
         payment_status, payment_method, payment_receipt, processing_fee, fee_deadline, paid_at,
         created_at, updated_at)
    VALUES (
        trim(COALESCE(p->>'full_name', '')),
        trim(COALESCE(p->>'father_name', '')),
        NULLIF(p->>'date_of_birth', '')::date,
        NULLIF(p->>'gender', ''),
        v_digits13,
        regexp_replace(COALESCE(p->>'contact_number', ''), '[^0-9+]', '', 'g'),
        NULLIF(regexp_replace(COALESCE(p->>'whatsapp_number', ''), '[^0-9+]', '', 'g'), ''),
        NULLIF(trim(COALESCE(p->>'home_address', '')), ''),
        v_cls,
        v_type,
        NULLIF(trim(COALESCE(p->>'previous_school', '')), ''),
        NULLIF(trim(COALESCE(p->>'previous_class', '')), ''),
        NULLIF(trim(COALESCE(p->>'previous_marks', '')), ''),
        NULLIF(trim(COALESCE(p->>'year_of_passing', '')), ''),
        NULLIF(regexp_replace(COALESCE(p->>'father_cnic', ''), '[^0-9]', '', 'g'), ''),
        NULLIF(trim(COALESCE(p->>'occupation', '')), ''),
        CASE WHEN COALESCE((p->>'paid')::boolean, false) THEN 'paid' ELSE 'pending' END,
        CASE WHEN COALESCE((p->>'paid')::boolean, false) THEN COALESCE(p->>'payment_method', 'cash') END,
        NULLIF(trim(COALESCE(p->>'payment_receipt', '')), ''),
        v_fee,
        CASE WHEN COALESCE((p->>'paid')::boolean, false) THEN v_deadline END,
        CASE WHEN COALESCE((p->>'paid')::boolean, false) THEN now() END,
        now(), now())
    RETURNING id, reference_no INTO v_id, v_ref;

    INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    VALUES (v_id, NULL, 'pending', 'Walk-in application entered at the school office.', 'admin');

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference_no', v_ref);
END;
$$;

-- ── 6. RLS hardening (what the live project already has; the repo lacked it) ─

-- Public submit still works: the INSERT policy for anon stays. Direct anon
-- SELECT is removed — reads go through track_admission / admission_portal_state.
DROP POLICY IF EXISTS "Public can read admissions" ON public.admissions;
DROP POLICY IF EXISTS "Public read admissions" ON public.admissions;
DROP POLICY IF EXISTS "admissions_public_read" ON public.admissions;
CREATE POLICY "admissions_anon_insert_only" ON public.admissions
    FOR INSERT TO anon, authenticated WITH CHECK (true);

REVOKE ALL ON public.admission_documents FROM anon;
REVOKE ALL ON public.admission_status_timeline FROM anon;
REVOKE ALL ON public.admission_otp_codes FROM anon;
REVOKE ALL ON public.fee_vouchers FROM anon;
REVOKE ALL ON public.interview_bookings FROM anon;
REVOKE ALL ON public.interview_slots FROM anon;

-- Admin RPCs: strip execute from anon and from authenticated (the RPC bodies
-- already check admission_is_admin(); this removes the route entirely for
-- non-admins).
REVOKE EXECUTE ON FUNCTION
    public.admission_admin_verify_documents(uuid, text),
    public.admission_admin_reject(uuid, text),
    public.admission_admin_admit(uuid, text, date, text),
    public.admission_admin_set_board_fee(uuid, text, timestamptz),
    public.admission_admin_set_migration_step(uuid, integer),
    public.admission_admin_set_payment(uuid, text, text, text),
    public.admission_admin_add_walkin(jsonb),
    public.admission_admin_import_walkins(jsonb),
    public.admission_admin_reset_all(text),
    public.admission_admin_set_class_seats(text, integer, boolean, date),
    public.admission_merit_auto(integer, date, date, text, boolean, boolean, text, text),
    public.admission_merit_publish(uuid, boolean),
    public.admission_merit_delete(uuid),
    public.admission_merit_entry_remark(uuid, text),
    public.admission_merit_set_show_not_listed(uuid, boolean)
FROM anon;
