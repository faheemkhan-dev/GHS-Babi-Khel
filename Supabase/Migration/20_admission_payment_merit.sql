-- ═══════════════════════════════════════════════════════════════════════
-- FILE 20 — Admission Processing-Fee Payment, Classes & Seats, Merit Lists
-- ═══════════════════════════════════════════════════════════════════════
-- Ports the GHSS Ghallanai online-admission payment + merit-list feature to
-- the GHS Babi Khel High School flow (Classes 6–10, fresh/migration):
--
--   1. PROCESSING FEE + PAYMENT REFERENCE on every application
--        • admissions gets payment_status / payment_reference / method /
--          receipt / provider / safepay fields / fee_deadline / paid_at
--        • a BEFORE INSERT trigger snapshots the fee + deadline from
--          admission_settings, so the EXISTING direct-insert apply path
--          (Admission.tsx) and submit_admission_public keep working
--          unchanged
--   2. ONLINE PAYMENT (Safepay) + MANUAL TRANSFER
--        • admission_proceed_payment (public, idempotent challan reference)
--        • admission_payment_context + admission_safepay_apply (service
--          role only — called by api/safepay.js)
--        • admission_payment_events ledger (replay / duplicate protection)
--   3. CLASSES & SEATS (High School model)
--        • admission_class_seats: EVERY class has a number of seats
--          directly. No programs (Pre-Medical / Pre-Engineering / ICS) and
--          NO quotas (Open Merit / Local Quota etc.) — this is a High
--          School, not a college.
--   4. MERIT LISTS
--        • admission_merit_lists + admission_merit_list_entries
--        • one-click auto merit per class: ranks every processing-fee-PAID
--          application by previous class marks / percentage, top N =
--          seats − seats already taken by earlier published lists
--   5. Settings: processing_fee, payment_accounts, online_payment_enabled,
--      contact_whatsapp (+ the walk-in / reset-all admin RPCs)
--
-- Idempotent: safe to re-run. Run AFTER files 00–19.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- 0. New workflow status: merit_listed
-- ─────────────────────────────────────────────────────────────────────────
-- Purely ADDITIVE: every existing status keeps its exact meaning; the
-- existing apply/review/approve flow is untouched. merit_listed simply
-- means "selected in a published merit list for this class" (the sweep only
-- moves applicants in pending / under_review / waitlisted into it — the
-- office's own advanced statuses are never overwritten).
--
-- NOTE: if your SQL runner wraps this whole file in one transaction and
-- complains about the new value, run this single ALTER TYPE statement on
-- its own first, then run the rest of the file (everything below is
-- idempotent and safe to re-run).

ALTER TYPE public.admission_status ADD VALUE IF NOT EXISTS 'merit_listed' AFTER 'waitlisted';


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Processing-fee columns on admissions
-- ─────────────────────────────────────────────────────────────────────────

-- payment_status as TEXT + CHECK (not an enum type) so this migration can
-- add and immediately use the values inside one transaction.
ALTER TABLE public.admissions
    ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending' NOT NULL
        CONSTRAINT admissions_payment_status_check CHECK (payment_status IN ('pending', 'paid', 'rejected')),
    ADD COLUMN IF NOT EXISTS payment_reference text,
    ADD COLUMN IF NOT EXISTS payment_method text,
    ADD COLUMN IF NOT EXISTS payment_receipt text,
    ADD COLUMN IF NOT EXISTS payment_provider text,        -- 'safepay' | 'manual'
    ADD COLUMN IF NOT EXISTS safepay_tracker text,
    ADD COLUMN IF NOT EXISTS safepay_transaction_id text,
    ADD COLUMN IF NOT EXISTS processing_fee integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS fee_deadline timestamptz,
    ADD COLUMN IF NOT EXISTS paid_at timestamptz,
    ADD COLUMN IF NOT EXISTS payment_requested_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admissions_payment_reference
    ON public.admissions (payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admissions_payment_status
    ON public.admissions (payment_status);
CREATE INDEX IF NOT EXISTS idx_admissions_fee_deadline
    ON public.admissions (fee_deadline);

-- Payment-reference numbering: YYMMDD + 7-digit zero-padded sequence
-- starting at 100001 (e.g. 2611170100001) — the format printed on the
-- fee challan, exactly like the GHSS Ghallanai reference.
CREATE SEQUENCE IF NOT EXISTS public.admission_payment_ref_seq START 100001;


-- Snapshot the fee + deadline from settings on first insert, so the existing
-- public apply flow (direct insert, no RPC change) gets the fee for free.
CREATE OR REPLACE FUNCTION public.admission_fee_defaults() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_fee integer;
    v_last_date date;
BEGIN
    SELECT processing_fee, last_date INTO v_fee, v_last_date
      FROM public.admission_settings WHERE id = 1;

    IF NEW.processing_fee IS NULL OR NEW.processing_fee = 0 THEN
        NEW.processing_fee := COALESCE(v_fee, 0);
    END IF;

    IF NEW.fee_deadline IS NULL THEN
        -- 23:59:59 of the admission last date (Asia/Karachi); if the school has
        -- not set a last date, give the applicant 4 days.
        IF v_last_date IS NOT NULL THEN
            NEW.fee_deadline := timezone('Asia/Karachi', v_last_date + time '23:59:59');
        ELSE
            NEW.fee_deadline := timezone('Asia/Karachi', current_date + 4 + time '23:59:59');
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admissions_fee_defaults ON public.admissions;
CREATE TRIGGER trg_admissions_fee_defaults
    BEFORE INSERT ON public.admissions
    FOR EACH ROW EXECUTE FUNCTION public.admission_fee_defaults();


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Settings: fee, payment accounts, online payment, WhatsApp
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.admission_settings
    ADD COLUMN IF NOT EXISTS processing_fee integer DEFAULT 100,
    ADD COLUMN IF NOT EXISTS payment_accounts jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS online_payment_enabled boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS contact_whatsapp text;

-- Ensure the single settings row exists (id = 1 is enforced by CHECK).
INSERT INTO public.admission_settings (id, is_open, session_year)
VALUES (1, false, extract(year FROM now())::text)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. Classes & Seats (High School — seats directly on every class)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admission_class_seats (
    "class"      text PRIMARY KEY,           -- '6' .. '10'
    seats        integer NOT NULL DEFAULT 0,
    is_open      boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admission_class_seats_seats_check CHECK (seats >= 0 AND seats <= 10000)
);

INSERT INTO public.admission_class_seats ("class", seats, is_open, display_order)
VALUES ('6', 40, true, 6), ('7', 40, true, 7), ('8', 40, true, 8),
       ('9', 40, true, 9), ('10', 40, true, 10)
ON CONFLICT ("class") DO NOTHING;

ALTER TABLE public.admission_class_seats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_seats_read_public ON public.admission_class_seats;
CREATE POLICY class_seats_read_public ON public.admission_class_seats
    FOR SELECT USING (true);

DROP POLICY IF EXISTS class_seats_admin_all ON public.admission_class_seats;
CREATE POLICY class_seats_admin_all ON public.admission_class_seats
    USING (EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin'));


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Merit lists (per class — no quotas, no programs)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admission_merit_lists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "class" text NOT NULL,                       -- '6' .. '10'
    list_no integer NOT NULL DEFAULT 1,
    title text NOT NULL,
    session_year text,
    admission_start_date date,
    admission_last_date date,
    instructions text,
    is_published boolean NOT NULL DEFAULT false,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admission_merit_list_no_check CHECK (list_no >= 1 AND list_no <= 50)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_merit_class_listno
    ON public.admission_merit_lists ("class", list_no);
CREATE INDEX IF NOT EXISTS idx_admission_merit_lists_published
    ON public.admission_merit_lists (is_published, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admission_merit_list_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merit_list_id uuid NOT NULL REFERENCES public.admission_merit_lists(id) ON DELETE CASCADE,
    admission_id uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    position integer NOT NULL,
    reference_no text NOT NULL,
    name text NOT NULL,
    father_name text,
    previous_marks text,
    marks_pct numeric,
    remarks text,
    is_listed boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admission_merit_entries_list
    ON public.admission_merit_list_entries (merit_list_id, position);
CREATE INDEX IF NOT EXISTS idx_admission_merit_entries_admission
    ON public.admission_merit_list_entries (admission_id);

ALTER TABLE public.admission_merit_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_merit_list_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_merit_read_public ON public.admission_merit_lists;
CREATE POLICY admission_merit_read_public ON public.admission_merit_lists
    FOR SELECT USING (is_published = true);

DROP POLICY IF EXISTS admission_merit_admin_all ON public.admission_merit_lists;
CREATE POLICY admission_merit_admin_all ON public.admission_merit_lists
    USING (EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS admission_merit_entries_read_public ON public.admission_merit_list_entries;
CREATE POLICY admission_merit_entries_read_public ON public.admission_merit_list_entries
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.admission_merit_lists m
                              WHERE m.id = merit_list_id AND m.is_published = true));

DROP POLICY IF EXISTS admission_merit_entries_admin_all ON public.admission_merit_list_entries;
CREATE POLICY admission_merit_entries_admin_all ON public.admission_merit_list_entries
    USING (EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin'));


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Payment events ledger (Safepay audit + replay protection)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admission_payment_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider text NOT NULL DEFAULT 'safepay',
    kind text NOT NULL,                 -- 'checkout_created' | 'webhook'
    tracking_id text,                   -- the admission reference_no
    tracker text,                       -- the Safepay beacon/token
    state text,
    event_key text,                     -- '{tracker}:{state}' — duplicate guard
    amount numeric,
    currency text,
    outcome text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_payment_events_key
    ON public.admission_payment_events (provider, event_key)
    WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admission_payment_events_tracking
    ON public.admission_payment_events (tracking_id, created_at DESC);

ALTER TABLE public.admission_payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_payment_events_admin_read ON public.admission_payment_events;
CREATE POLICY admission_payment_events_admin_read ON public.admission_payment_events
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p
                   WHERE p.id = auth.uid() AND p.role = 'admin'));
-- No anon/public policy: writes happen through SECURITY DEFINER RPCs with
-- the service role; reads are admin-only.


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Public timeline read (the applicant tracker shows the timeline card —
--    GHSS Ghallanai shows it publicly too; anon previously had no SELECT
--    policy here so the public tracker's timeline list always came back
--    empty). Notes are written by the office knowing applicants see them.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS timeline_read_public ON public.admission_status_timeline;
CREATE POLICY timeline_read_public ON public.admission_status_timeline
    FOR SELECT TO anon USING (true);


-- ═══════════════════════════════════════════════════════════════════════
-- 7. RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════

-- ── Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.id = auth.uid() AND p.role = 'admin'); $$;

-- Previous-marks → percentage. Accepts the formats the apply form allows:
--   '450/600' → 75.00   '82%' / '82' → 82.00   'A+' → NULL (ranked last)
CREATE OR REPLACE FUNCTION public.admission_marks_pct(p_marks text) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE
        WHEN p_marks ~ '^\s*[0-9]{1,4}\s*/\s*[0-9]{1,4}' THEN
            round((substring(p_marks from '^\s*([0-9]{1,4})')::numeric
                 / NULLIF(substring(p_marks from '^\s*[0-9]{1,4}\s*/\s*([0-9]{1,4})')::numeric, 0)) * 100, 2)
        WHEN p_marks ~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*%?$' THEN
            round(substring(p_marks from '^\s*([0-9]{1,3}(\.[0-9]+)?)')::numeric, 2)
        ELSE NULL
    END;
    $$;

CREATE OR REPLACE FUNCTION public.admission_fee_deadline() RETURNS timestamptz
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$ SELECT COALESCE(
        timezone('Asia/Karachi', s.last_date + time '23:59:59'),
        timezone('Asia/Karachi', current_date + 4 + time '23:59:59'))
    FROM public.admission_settings s WHERE s.id = 1; $$;


-- ── Public: generate the payment reference (idempotent) ──────────────────
-- The applicant proves ownership with the reference number + B-Form pair
-- printed on their challan — sequential reference numbers alone are not
-- enough to touch someone else's application.

CREATE OR REPLACE FUNCTION public.admission_proceed_payment(
    p_reference_no text,
    p_b_form_no text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_ref_key text := upper(trim(p_reference_no));
    v_bform_key text := regexp_replace(trim(p_b_form_no), '[^0-9]', '', 'g');
    v_row public.admissions%ROWTYPE;
BEGIN
    IF v_ref_key = '' OR v_bform_key = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Reference number and B-Form number are required.');
    END IF;

    SELECT * INTO v_row FROM public.admissions a
     WHERE upper(a.reference_no) = v_ref_key
       AND regexp_replace(coalesce(a.b_form_no, ''), '[^0-9]', '', 'g') = v_bform_key
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'No application found for this reference and B-Form number.');
    END IF;

    IF v_row.payment_status = 'paid' THEN
        RETURN jsonb_build_object('ok', true, 'already_paid', true,
            'reference_no', v_row.reference_no,
            'payment_reference', v_row.payment_reference,
            'processing_fee', v_row.processing_fee,
            'fee_deadline', v_row.fee_deadline,
            'payment_status', v_row.payment_status);
    END IF;

    IF v_row.payment_reference IS NULL THEN
        UPDATE public.admissions
           SET payment_reference = to_char(now(), 'YYMMDD') || lpad(nextval('public.admission_payment_ref_seq')::text, 7, '0'),
               payment_requested_at = now(),
               fee_deadline = COALESCE(fee_deadline, public.admission_fee_deadline()),
               updated_at = now()
         WHERE id = v_row.id
         RETURNING * INTO v_row;

        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Payment Reference Generated — Payment reference ' || v_row.payment_reference ||
                ' generated. Pay Rs. ' || v_row.processing_fee ||
                ' to the school account on the challan on or before ' ||
                to_char(v_row.fee_deadline, 'DD Mon YYYY') || '.', 'system');
    END IF;

    RETURN jsonb_build_object('ok', true,
        'reference_no', v_row.reference_no,
        'payment_reference', v_row.payment_reference,
        'processing_fee', v_row.processing_fee,
        'fee_deadline', v_row.fee_deadline,
        'payment_status', v_row.payment_status);
END;
$$;


-- ── Service role: payment context for the Safepay checkout ──────────────
-- Called only by api/safepay.js with the service key. Amounts ALWAYS come
-- from the database, never from the browser.

CREATE OR REPLACE FUNCTION public.admission_payment_context(
    p_reference_no text,
    p_b_form_no text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_ref_key text := upper(trim(p_reference_no));
    v_bform_key text := regexp_replace(trim(p_b_form_no), '[^0-9]', '', 'g');
    v_row public.admissions%ROWTYPE;
    v_online boolean;
BEGIN
    SELECT * INTO v_row FROM public.admissions a
     WHERE upper(a.reference_no) = v_ref_key
       AND regexp_replace(coalesce(a.b_form_no, ''), '[^0-9]', '', 'g') = v_bform_key
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    SELECT COALESCE(online_payment_enabled, false) INTO v_online
      FROM public.admission_settings WHERE id = 1;

    IF NOT v_online THEN
        RETURN jsonb_build_object('ok', false, 'error', 'online_disabled');
    END IF;
    IF v_row.payment_status = 'paid' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
    END IF;
    IF v_row.status IN ('rejected', 'admitted', 'admit_card_issued') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
    END IF;
    IF v_row.fee_deadline IS NOT NULL AND now() > v_row.fee_deadline THEN
        RETURN jsonb_build_object('ok', false, 'error', 'deadline_passed');
    END IF;

    RETURN jsonb_build_object('ok', true,
        'admission_id', v_row.id,
        'tracking_id', v_row.reference_no,
        'processing_fee', v_row.processing_fee,
        'payment_status', v_row.payment_status,
        'status', v_row.status);
END;
$$;


-- ── Service role: apply a verified Safepay webhook ───────────────────────

CREATE OR REPLACE FUNCTION public.admission_safepay_apply(
    p_reference_no text,
    p_tracker text,
    p_state text,
    p_txn_id text DEFAULT NULL,
    p_amount numeric DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_method text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_row public.admissions%ROWTYPE;
    v_checkout record;
BEGIN
    SELECT * INTO v_row FROM public.admissions a
     WHERE upper(a.reference_no) = upper(trim(p_reference_no)) LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    -- The tracker must match the checkout we created for THIS application.
    SELECT amount, currency INTO v_checkout
      FROM public.admission_payment_events
     WHERE provider = 'safepay' AND kind = 'checkout_created'
       AND tracker = p_tracker AND tracking_id = v_row.reference_no
     ORDER BY created_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tracker_mismatch');
    END IF;
    IF p_amount IS NOT NULL AND v_checkout.amount IS NOT NULL AND p_amount <> v_checkout.amount THEN
        RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch');
    END IF;
    IF p_currency IS NOT NULL AND v_checkout.currency IS NOT NULL AND upper(p_currency) <> upper(v_checkout.currency) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch');
    END IF;

    -- Idempotency: same transaction already applied?
    IF v_row.payment_status = 'paid' AND v_row.payment_method = 'safepay'
       AND v_row.safepay_transaction_id IS NOT NULL
       AND v_row.safepay_transaction_id = p_txn_id THEN
        RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;

    IF p_state = 'paid' THEN
        UPDATE public.admissions
           SET payment_status = 'paid',
               payment_method = 'safepay',
               payment_provider = 'safepay',
               payment_receipt = COALESCE(NULLIF(trim(p_txn_id), ''), payment_receipt),
               safepay_tracker = p_tracker,
               safepay_transaction_id = p_txn_id,
               paid_at = now(),
               updated_at = now()
         WHERE id = v_row.id
         RETURNING * INTO v_row;

        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Processing Fee Received — Rs. ' || v_row.processing_fee ||
                ' paid online via Safepay (Ref: ' || COALESCE(p_txn_id, p_tracker) || ').', 'system');
        RETURN jsonb_build_object('ok', true, 'payment_status', 'paid');

    ELSIF p_state = 'failed' THEN
        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Online Payment Not Completed — the Safepay payment did not go through. You can try again or pay by manual transfer.', 'system');
        RETURN jsonb_build_object('ok', true, 'payment_status', 'failed');
    END IF;

    RETURN jsonb_build_object('ok', true, 'ignored', true);
END;
$$;


-- ── Public: classes & seats ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_class_seats_list() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'class', s."class",
               'class_label', 'Class ' || s."class",
               'seats', s.seats,
               'is_open', s.is_open
           ) ORDER BY s.display_order), '[]'::jsonb)
      FROM public.admission_class_seats s;
    $$;


-- ── Admin: set seats / open-close a class ────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_admin_set_class_seats(
    p_class text,
    p_seats integer DEFAULT NULL,
    p_is_open boolean DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.admission_class_seats WHERE "class" = p_class) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Unknown class.');
    END IF;
    IF p_seats IS NOT NULL AND (p_seats < 0 OR p_seats > 10000) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Seats must be between 0 and 10000.');
    END IF;

    UPDATE public.admission_class_seats
       SET seats = COALESCE(p_seats, seats),
           is_open = COALESCE(p_is_open, is_open),
           updated_at = now()
     WHERE "class" = p_class;

    RETURN jsonb_build_object('ok', true);
END;
$$;


-- ── Public: published merit lists ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_merit_lists_public() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', m.id,
               'class', m."class",
               'class_label', 'Class ' || m."class",
               'list_no', m.list_no,
               'title', m.title,
               'session_year', m.session_year,
               'admission_start_date', m.admission_start_date,
               'admission_last_date', m.admission_last_date,
               'published_at', m.published_at,
               'listed_count', (SELECT count(*) FROM public.admission_merit_list_entries e
                                 WHERE e.merit_list_id = m.id AND e.is_listed),
               'not_listed_count', (SELECT count(*) FROM public.admission_merit_list_entries e
                                     WHERE e.merit_list_id = m.id AND NOT e.is_listed)
           ) ORDER BY m."class", m.list_no DESC), '[]'::jsonb)
      FROM public.admission_merit_lists m
     WHERE m.is_published;
    $$;

CREATE OR REPLACE FUNCTION public.admission_merit_list_view(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_list public.admission_merit_lists%ROWTYPE;
    v_entries jsonb;
BEGIN
    SELECT * INTO v_list FROM public.admission_merit_lists WHERE id = p_id LIMIT 1;
    IF NOT FOUND OR NOT v_list.is_published THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Merit list not found.');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'position', e.position, 'reference_no', e.reference_no, 'name', e.name,
               'father_name', e.father_name, 'previous_marks', e.previous_marks,
               'marks_pct', e.marks_pct, 'remarks', e.remarks, 'is_listed', e.is_listed
           ) ORDER BY e.position), '[]'::jsonb)
      INTO v_entries
      FROM public.admission_merit_list_entries e
     WHERE e.merit_list_id = v_list.id;

    RETURN jsonb_build_object('ok', true,
        'list', jsonb_build_object(
            'id', v_list.id, 'class', v_list."class", 'class_label', 'Class ' || v_list."class",
            'list_no', v_list.list_no, 'title', v_list.title, 'session_year', v_list.session_year,
            'admission_start_date', v_list.admission_start_date,
            'admission_last_date', v_list.admission_last_date,
            'instructions', v_list.instructions,
            'published_at', v_list.published_at),
        'entries', v_entries,
        'listed_count', (SELECT count(*) FROM public.admission_merit_list_entries e
                          WHERE e.merit_list_id = v_list.id AND e.is_listed),
        'not_listed_count', (SELECT count(*) FROM public.admission_merit_list_entries e
                              WHERE e.merit_list_id = v_list.id AND NOT e.is_listed));
END;
$$;


-- ── Merit sweep helper: status changes + timeline entries for one list ───
-- Listed applicants in a review stage become merit_listed (approved /
-- documents_* / interview_* / admitted stages are NEVER touched — the
-- office already advanced those applicants manually).

CREATE OR REPLACE FUNCTION public.admission_merit_apply_states(p_list_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_list public.admission_merit_lists%ROWTYPE;
    v_ordinal text;
    v_old_status public.admission_status;
    r record;
BEGIN
    SELECT * INTO v_list FROM public.admission_merit_lists WHERE id = p_list_id;
    IF NOT FOUND THEN RETURN; END IF;

    v_ordinal := CASE
        WHEN v_list.list_no % 100 IN (11, 12, 13) THEN v_list.list_no::text || 'th'
        WHEN v_list.list_no % 10 = 1 THEN v_list.list_no::text || 'st'
        WHEN v_list.list_no % 10 = 2 THEN v_list.list_no::text || 'nd'
        WHEN v_list.list_no % 10 = 3 THEN v_list.list_no::text || 'rd'
        ELSE v_list.list_no::text || 'th'
    END;

    -- Status sweep for listed applicants still in a review stage.
    FOR r IN SELECT e.admission_id, a.status
               FROM public.admission_merit_list_entries e
               JOIN public.admissions a ON a.id = e.admission_id
              WHERE e.merit_list_id = p_list_id AND e.is_listed
                AND a.status IN ('pending', 'under_review', 'waitlisted')
    LOOP
        v_old_status := r.status;
        UPDATE public.admissions SET status = 'merit_listed', updated_at = now()
         WHERE id = r.admission_id;
        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (r.admission_id, v_old_status, 'merit_listed',
                'Selected in the ' || v_ordinal || ' merit list for Class ' || v_list."class" || '.', 'system');
    END LOOP;

    -- Timeline note for listed applicants the office had already advanced.
    FOR r IN SELECT e.admission_id, a.status
               FROM public.admission_merit_list_entries e
               JOIN public.admissions a ON a.id = e.admission_id
              WHERE e.merit_list_id = p_list_id AND e.is_listed
                AND a.status NOT IN ('pending', 'under_review', 'waitlisted')
    LOOP
        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (r.admission_id, r.status, r.status,
                'Selected in the ' || v_ordinal || ' merit list for Class ' || v_list."class" || '.', 'system');
    END LOOP;

    -- Timeline note for not-listed applicants (status unchanged).
    FOR r IN SELECT e.admission_id, a.status
               FROM public.admission_merit_list_entries e
               JOIN public.admissions a ON a.id = e.admission_id
              WHERE e.merit_list_id = p_list_id AND NOT e.is_listed
    LOOP
        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (r.admission_id, r.status, r.status,
                'Not selected in the ' || v_ordinal || ' merit list for Class ' || v_list."class" ||
                ' — all seats were filled.', 'system');
    END LOOP;
END;
$$;


-- ── Admin: one-click auto merit list ─────────────────────────────────────
-- Ranks every processing-fee-PAID application of each class by previous
-- class marks / percentage (ties → earlier application), selects the top
-- N where N = class seats − seats taken by earlier published lists.
-- Everyone ranked appears in the list: inside the seats = Merit Listed,
-- the rest = Not Merit Listed. Running the same list number again replaces
-- the old list, so nothing is duplicated.

CREATE OR REPLACE FUNCTION public.admission_merit_auto(
    p_list_no integer,
    p_admission_start_date date DEFAULT NULL,
    p_admission_last_date date DEFAULT NULL,
    p_instructions text DEFAULT NULL,
    p_publish boolean DEFAULT false,
    p_dry_run boolean DEFAULT false,
    p_class text DEFAULT NULL
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
    v_note_selected text;
    v_note_not_selected text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF p_list_no IS NULL OR p_list_no < 1 OR p_list_no > 50 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'List number must be between 1 and 50.');
    END IF;

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

        -- Seats already taken by OTHER published lists of this class.
        SELECT count(DISTINCT e.admission_id) INTO v_taken
          FROM public.admission_merit_list_entries e
          JOIN public.admission_merit_lists m ON m.id = e.merit_list_id
         WHERE m.is_published AND m."class" = v_cls
           AND m.list_no <> p_list_no AND e.is_listed;

        v_left := GREATEST(v_seats - v_taken, 0);

        SELECT count(*) INTO v_unpaid
          FROM public.admissions a
         WHERE a.applying_class = v_cls
           AND a.payment_status <> 'paid'
           AND a.status NOT IN ('rejected', 'admitted', 'admit_card_issued');

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
           AND NOT EXISTS (
                SELECT 1 FROM public.admission_merit_list_entries e
                  JOIN public.admission_merit_lists m ON m.id = e.merit_list_id
                 WHERE e.admission_id = a.id AND e.is_listed
                   AND m.is_published AND m."class" = v_cls AND m.list_no <> p_list_no);

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

        -- Replace any old list of this (class, list_no); remember if it was published.
        v_was_published := false;
        FOR v_old_list IN SELECT * FROM public.admission_merit_lists
                           WHERE "class" = v_cls AND list_no = p_list_no
                         LOOP
            v_was_published := v_was_published OR v_old_list.is_published;
            SELECT array_agg(e.admission_id) INTO v_old_listed
              FROM public.admission_merit_list_entries e
             WHERE e.merit_list_id = v_old_list.id AND e.is_listed;

            DELETE FROM public.admission_merit_lists WHERE id = v_old_list.id;  -- entries cascade

            -- Old listed applicants that are not listed in another published
            -- list go back to under_review.
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
             instructions, is_published, published_at)
        VALUES (v_cls, p_list_no, v_title_prefix || v_cls,
                COALESCE(v_settings.session_year, extract(year FROM now())::text),
                COALESCE(p_admission_start_date, current_date),
                COALESCE(p_admission_last_date, v_settings.last_date, current_date + 7),
                v_instructions,
                (p_publish OR v_was_published),
                CASE WHEN p_publish OR v_was_published THEN now() ELSE NULL END)
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


-- ── Admin: publish / unpublish a merit list ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_merit_publish(
    p_id uuid,
    p_published boolean
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_list public.admission_merit_lists%ROWTYPE;
    v_ordinal text;
    v_aid uuid;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;

    SELECT * INTO v_list FROM public.admission_merit_lists WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Merit list not found.');
    END IF;

    v_ordinal := CASE
        WHEN v_list.list_no % 100 IN (11, 12, 13) THEN v_list.list_no::text || 'th'
        WHEN v_list.list_no % 10 = 1 THEN v_list.list_no::text || 'st'
        WHEN v_list.list_no % 10 = 2 THEN v_list.list_no::text || 'nd'
        WHEN v_list.list_no % 10 = 3 THEN v_list.list_no::text || 'rd'
        ELSE v_list.list_no::text || 'th'
    END;

    IF p_published THEN
        UPDATE public.admission_merit_lists
           SET is_published = true, published_at = now()
         WHERE id = p_id;
        PERFORM public.admission_merit_apply_states(p_id);
    ELSE
        UPDATE public.admission_merit_lists
           SET is_published = false, published_at = NULL
         WHERE id = p_id;

        -- Listed applicants of THIS list that are not listed in another
        -- published list go back to under_review.
        FOR v_aid IN SELECT e.admission_id
                       FROM public.admission_merit_list_entries e
                      WHERE e.merit_list_id = p_id AND e.is_listed
        LOOP
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

        DELETE FROM public.admission_status_timeline
         WHERE note LIKE 'Selected in the ' || v_ordinal || ' merit list for Class ' || v_list."class" || '%'
            OR note LIKE 'Not selected in the ' || v_ordinal || ' merit list for Class ' || v_list."class" || '%';
    END IF;

    RETURN jsonb_build_object('ok', true, 'is_published', p_published);
END;
$$;


-- ── Admin: delete a merit list (drafts only) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_merit_delete(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.admission_merit_lists WHERE id = p_id AND is_published) THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'This merit list is published. Unpublish it first.');
    END IF;
    DELETE FROM public.admission_merit_lists WHERE id = p_id;
    RETURN jsonb_build_object('ok', true);
END;
$$;


-- ── Admin: edit a remark on one entry ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_merit_entry_remark(
    p_entry_id uuid,
    p_remarks text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    UPDATE public.admission_merit_list_entries
       SET remarks = NULLIF(trim(p_remarks), '')
     WHERE id = p_entry_id;
    RETURN jsonb_build_object('ok', true);
END;
$$;


-- ── Admin: record / reset the processing fee (the ONLY fee write) ────────

CREATE OR REPLACE FUNCTION public.admission_admin_set_payment(
    p_admission_id uuid,
    p_status text,
    p_receipt text DEFAULT NULL,
    p_method text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_row public.admissions%ROWTYPE;
    v_method text;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF p_status NOT IN ('pending', 'paid', 'rejected') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Invalid payment status.');
    END IF;

    SELECT * INTO v_row FROM public.admissions WHERE id = p_admission_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Application not found.');
    END IF;

    -- Never regress an application already on the merit list / admitted.
    IF v_row.payment_status = 'paid'
       AND v_row.status IN ('merit_listed', 'admitted', 'admit_card_issued')
       AND p_status <> 'paid' THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Cannot change the fee for an application already on the merit list.');
    END IF;

    v_method := lower(trim(COALESCE(p_method, '')));
    IF v_method NOT IN ('bank', 'easypaisa', 'jazzcash', 'cash', 'safepay', 'other') THEN
        v_method := 'other';
    END IF;

    -- No-op detection.
    IF p_status = v_row.payment_status
       AND (p_status <> 'paid' OR (v_method = COALESCE(v_row.payment_method, v_method)
                                   AND COALESCE(NULLIF(trim(p_receipt), ''), NULL)
                                       IS NOT DISTINCT FROM v_row.payment_receipt)) THEN
        RETURN jsonb_build_object('ok', true, 'unchanged', true);
    END IF;

    IF p_status = 'paid' THEN
        UPDATE public.admissions
           SET payment_status = 'paid',
               payment_method = v_method,
               payment_provider = CASE WHEN v_method = 'safepay' THEN 'safepay' ELSE 'manual' END,
               payment_receipt = NULLIF(trim(p_receipt), ''),
               paid_at = now(),
               updated_at = now()
         WHERE id = p_admission_id
         RETURNING * INTO v_row;

        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Processing Fee Received — Rs. ' || v_row.processing_fee || ' via ' ||
                CASE v_method
                    WHEN 'bank' THEN 'Bank Transfer'
                    WHEN 'easypaisa' THEN 'EasyPaisa'
                    WHEN 'jazzcash' THEN 'JazzCash'
                    WHEN 'cash' THEN 'Cash at School'
                    WHEN 'safepay' THEN 'Online Payment (Safepay)'
                    ELSE 'Other' END ||
                COALESCE(' (Ref: ' || NULLIF(trim(p_receipt), '') || ')', '') || '.', 'admin');
        RETURN jsonb_build_object('ok', true, 'payment_status', 'paid');

    ELSIF p_status = 'rejected' THEN
        UPDATE public.admissions
           SET payment_status = 'rejected', paid_at = NULL, updated_at = now()
         WHERE id = p_admission_id;

        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Processing Fee Rejected — the payment could not be verified. Please contact the school office.', 'admin');
        RETURN jsonb_build_object('ok', true, 'payment_status', 'rejected');

    ELSE
        UPDATE public.admissions
           SET payment_status = 'pending', payment_method = NULL,
               payment_provider = NULL, payment_receipt = NULL,
               paid_at = NULL, updated_at = now()
         WHERE id = p_admission_id;

        INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
        VALUES (v_row.id, v_row.status, v_row.status,
                'Processing Fee Reset to Pending.', 'admin');
        RETURN jsonb_build_object('ok', true, 'payment_status', 'pending');
    END IF;
END;
$$;


-- ── Admin: walk-in (paper) application entered by the office ─────────────

CREATE OR REPLACE FUNCTION public.admission_admin_add_walkin(p jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_id uuid;
    v_ref text;
    v_fee integer;
    v_paid boolean := COALESCE((p->>'paid')::boolean, false);
    v_method text;
    v_receipt text;
    v_res jsonb;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;
    IF NULLIF(trim(p->>'full_name'), '') IS NULL OR NULLIF(trim(p->>'father_name'), '') IS NULL
       OR length(regexp_replace(COALESCE(p->>'b_form_no', ''), '[^0-9]', '', 'g')) <> 13
       OR NULLIF(trim(p->>'contact_number'), '') IS NULL
       OR NULLIF(trim(p->>'applying_class'), '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Name, father name, 13-digit B-Form, mobile and class are required.');
    END IF;

    SELECT COALESCE(processing_fee, 0) INTO v_fee FROM public.admission_settings WHERE id = 1;

    INSERT INTO public.admissions
        (full_name, father_name, b_form_no, contact_number, whatsapp_number, home_address,
         gender, applying_class, admission_type, previous_school, previous_class,
         previous_marks, year_of_passing, processing_fee)
    VALUES (trim(p->>'full_name'), trim(p->>'father_name'),
            regexp_replace(p->>'b_form_no', '[^0-9]', '', 'g'),
            public.normalize_phone(p->>'contact_number'),
            NULLIF(public.normalize_phone(p->>'whatsapp_number'), ''),
            NULLIF(trim(p->>'home_address'), ''),
            NULLIF(trim(p->>'gender'), ''),
            trim(p->>'applying_class'),
            COALESCE(NULLIF(p->>'admission_type', ''), 'fresh')::public.admission_type,
            NULLIF(trim(p->>'previous_school'), ''),
            NULLIF(trim(p->>'previous_class'), ''),
            NULLIF(trim(p->>'previous_marks'), ''),
            NULLIF(trim(p->>'year_of_passing'), ''),
            v_fee)
    RETURNING id, reference_no INTO v_id, v_ref;

    INSERT INTO public.admission_status_timeline (admission_id, from_status, to_status, note, actor)
    VALUES (v_id, NULL, 'pending', 'Application submitted in person at the school office.', 'admin');

    IF v_paid THEN
        v_method := lower(trim(COALESCE(p->>'payment_method', 'cash')));
        IF v_method NOT IN ('bank', 'easypaisa', 'jazzcash', 'cash', 'safepay', 'other') THEN
            v_method := 'cash';
        END IF;
        v_receipt := NULLIF(trim(COALESCE(p->>'payment_receipt', '')), '');
        v_res := public.admission_admin_set_payment(v_id, 'paid', v_receipt, v_method);
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference_no', v_ref);
END;
$$;


-- ── Admin: bulk walk-in import (per-row isolation — one bad row never
--    stops the whole sheet) ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admission_admin_import_walkins(p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_row jsonb;
    v_res jsonb;
    v_imported integer := 0;
    v_failed integer := 0;
    v_errors jsonb := '[]'::jsonb;
    v_idx integer := 0;
BEGIN
    IF NOT public.admission_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Admin only.');
    END IF;

    FOR v_row IN SELECT jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
        v_idx := v_idx + 1;
        BEGIN
            v_res := public.admission_admin_add_walkin(v_row);
            IF (v_res->>'ok')::boolean THEN
                v_imported := v_imported + 1;
            ELSE
                v_failed := v_failed + 1;
                v_errors := v_errors || jsonb_build_object(
                    'row', v_idx,
                    'name', COALESCE(v_row->>'full_name', '?'),
                    'error', v_res->>'error');
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            v_errors := v_errors || jsonb_build_object(
                'row', v_idx,
                'name', COALESCE(v_row->>'full_name', '?'),
                'error', SQLERRM);
        END;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'imported', v_imported,
                              'failed', v_failed, 'errors', v_errors);
END;
$$;


-- ── Admin: reset all applications for the next session ───────────────────
-- Deletes applications (+ their documents, timeline, interview bookings,
-- merit lists and payment ledger). Keeps: class seats, settings, and the
-- school records created on approval (students register rows, fee
-- vouchers) — those are official records, not admission-cycle data.

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
    DELETE FROM public.admission_merit_lists;   -- entries cascade

    SELECT count(*) INTO v_events FROM public.admission_payment_events;
    DELETE FROM public.admission_payment_events
     WHERE tracking_id IN (SELECT reference_no FROM public.admissions);

    SELECT count(*) INTO v_count FROM public.admissions;
    DELETE FROM public.admissions;              -- documents / timeline / bookings cascade

    RETURN jsonb_build_object('ok', true, 'admissions', v_count,
                              'merit_lists', v_merit, 'payment_events', v_events);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. EXECUTE grants (same default-deny allow-list model as file 16)
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    -- Callable by the PUBLIC SITE (anon + authenticated + service_role).
    v_public_fns text[] := ARRAY[
        'admission_proceed_payment(text,text)',
        'admission_class_seats_list()',
        'admission_merit_lists_public()',
        'admission_merit_list_view(uuid)'
    ];
    -- Admin console (authenticated; the admin role is checked INSIDE each
    -- function via admission_is_admin()) + service_role.
    v_admin_fns text[] := ARRAY[
        'admission_admin_set_class_seats(text,integer,boolean)',
        'admission_merit_auto(integer,date,date,text,boolean,boolean,text)',
        'admission_merit_publish(uuid,boolean)',
        'admission_merit_delete(uuid)',
        'admission_merit_entry_remark(uuid,text)',
        'admission_admin_set_payment(uuid,text,text,text)',
        'admission_admin_add_walkin(jsonb)',
        'admission_admin_import_walkins(jsonb)',
        'admission_admin_reset_all(text)'
    ];
    -- Serverless only (api/safepay.js with the service key). NEVER anon.
    v_service_fns text[] := ARRAY[
        'admission_payment_context(text,text)',
        'admission_safepay_apply(text,text,text,text,numeric,text,text)'
    ];
    f text;
BEGIN
    -- Default deny for every function this file created/replaced.
    FOREACH f IN ARRAY v_public_fns || v_admin_fns || v_service_fns LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    END LOOP;

    FOREACH f IN ARRAY v_public_fns LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated', f);
    END LOOP;

    FOREACH f IN ARRAY v_admin_fns LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;

    -- Service role may call everything (it bypasses nothing else here — the
    -- role checks inside admin RPCs rely on auth.uid(), which is NULL for
    -- the service key, so this grant is only useful for the v_service_fns).
    FOREACH f IN ARRAY v_public_fns || v_admin_fns || v_service_fns LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
END $$;

-- Internal helpers: keep them out of PUBLIC/anon hands as well.
REVOKE EXECUTE ON FUNCTION public.admission_fee_deadline() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admission_marks_pct(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admission_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admission_fee_deadline() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admission_marks_pct(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admission_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admission_merit_apply_states(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admission_merit_apply_states(uuid) FROM PUBLIC, anon;


-- ═══════════════════════════════════════════════════════════════════════
-- Done. Nothing in the existing GHS Babi Khel flow changed shape:
--   • apply form, submit path, statuses, interview slots, migration steps,
--     admit card and the approval-time admission-fee challan are untouched
--   • new payment columns default silently on every insert
--   • every class carries its seats directly (no programs, no quotas)
-- ═══════════════════════════════════════════════════════════════════════
