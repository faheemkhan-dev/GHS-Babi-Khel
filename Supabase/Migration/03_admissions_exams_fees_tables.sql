-- ═══════════════════════════════════════════════════════════════════════
-- FILE 03 — Admissions, Exams & Fees Tables
-- ═══════════════════════════════════════════════════════════════════════
-- Tables for the admissions funnel, board-exam management and the fee
-- billing cycle:
--   admissions + admission_documents + admission_otp_codes
--   admission_settings + admission_status_timeline
--   interview_slots + interview_bookings
--   exam_attendance + exam_roll_numbers + exam_roll_sessions
--   exam_schedule + exam_seating_plans + exam_seating_rooms
--   exam_seating_assignments
--   merit_lists
--   fee_types + fee_structures + fee_payments + fee_vouchers
--   payments + payment_items + receipts + student_charges
--   generated_id_cards
--
-- Run AFTER files 01 & 02.
-- ═══════════════════════════════════════════════════════════════════════


CREATE TABLE public.admissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reference_no text DEFAULT ((('GHS-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.admissions_ref_seq'::regclass))::text, 5, '0'::text)) NOT NULL,
    full_name text NOT NULL,
    father_name text NOT NULL,
    date_of_birth date,
    b_form_no text NOT NULL,
    contact_number text NOT NULL,
    whatsapp_number text,
    home_address text,
    gender text,
    applying_class text NOT NULL,
    admission_type public.admission_type DEFAULT 'fresh'::public.admission_type NOT NULL,
    previous_school text,
    previous_class text,
    previous_marks text,
    year_of_passing text,
    status public.admission_status DEFAULT 'pending'::public.admission_status NOT NULL,
    admin_note text,
    rejection_reason text,
    admission_roll_no text,
    migration_step integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    father_cnic text,
    occupation text,
    CONSTRAINT admissions_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text]))),
    CONSTRAINT admissions_migration_step_check CHECK (((migration_step >= 1) AND (migration_step <= 8)))
);





CREATE TABLE public.admission_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admission_id uuid NOT NULL,
    doc_type text NOT NULL,
    file_path text NOT NULL,
    file_name text,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.admission_otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_number text NOT NULL,
    otp_code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admission_otp_codes_attempts_check CHECK ((attempts <= 5))
);





CREATE TABLE public.admission_settings (
    id integer DEFAULT 1 NOT NULL,
    is_open boolean DEFAULT false NOT NULL,
    session_year text DEFAULT '2026'::text NOT NULL,
    open_date date,
    last_date date,
    banner_message text,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admission_settings_id_check CHECK ((id = 1))
);





CREATE TABLE public.admission_status_timeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admission_id uuid NOT NULL,
    from_status public.admission_status,
    to_status public.admission_status NOT NULL,
    note text,
    actor text DEFAULT 'system'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.exam_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    student_id uuid NOT NULL,
    student_name text NOT NULL,
    class text NOT NULL,
    class_roll_no text NOT NULL,
    exam_roll_no text NOT NULL,
    subject text NOT NULL,
    exam_date date NOT NULL,
    status text DEFAULT 'absent'::text NOT NULL,
    scanned_at timestamp with time zone,
    scanned_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    seat_id text,
    room_id text,
    seat_label text,
    paper_start_time time without time zone,
    paper_end_time time without time zone,
    CONSTRAINT exam_attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'leave'::text])))
);





CREATE TABLE public.exam_roll_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    student_id uuid,
    student_name text NOT NULL,
    father_name text,
    class text NOT NULL,
    class_roll_no text NOT NULL,
    exam_roll_no text NOT NULL,
    serial_number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.exam_roll_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    exam_year integer NOT NULL,
    exam_term text NOT NULL,
    classes text[] NOT NULL,
    class_order text[] NOT NULL,
    starting_number integer DEFAULT 100000 NOT NULL,
    is_published boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    publish_at timestamp with time zone,
    countdown_label text DEFAULT 'Exam Roll Numbers will be published in'::text
);





CREATE TABLE public.exam_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class text NOT NULL,
    exam_type text NOT NULL,
    year integer NOT NULL,
    subject text NOT NULL,
    exam_date date NOT NULL,
    start_time text,
    end_time text,
    hall text,
    notes text,
    is_published boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    paper_name text,
    paper_code text
);





CREATE TABLE public.exam_seating_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    room_id uuid NOT NULL,
    student_id text NOT NULL,
    student_name text NOT NULL,
    class text NOT NULL,
    class_roll_no text NOT NULL,
    exam_roll_no text NOT NULL,
    row_idx integer NOT NULL,
    col_idx integer NOT NULL,
    seat_label text NOT NULL,
    qr_token text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.exam_seating_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    title text NOT NULL,
    paper_subject text,
    exam_date date,
    classes text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_students integer DEFAULT 0 NOT NULL,
    total_seated integer DEFAULT 0 NOT NULL,
    generated_at timestamp with time zone,
    published_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    publish_at timestamp with time zone,
    countdown_label text,
    paper_start_at timestamp with time zone,
    paper_end_at timestamp with time zone,
    is_recurring boolean DEFAULT false NOT NULL,
    exam_date_from date,
    exam_date_to date,
    superintendent text,
    deputy_superintendent text,
    superintendent_duty text,
    deputy_superintendent_duty text,
    class_paper_times jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT exam_seating_plans_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'generated'::text, 'published'::text, 'archived'::text])))
);





CREATE TABLE public.exam_seating_rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    name text NOT NULL,
    capacity integer DEFAULT 0 NOT NULL,
    rows integer DEFAULT 6 NOT NULL,
    cols integer DEFAULT 5 NOT NULL,
    block_layout jsonb DEFAULT '[]'::jsonb NOT NULL,
    invigilator text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    invigilators text[] DEFAULT '{}'::text[] NOT NULL,
    invigilator_duties jsonb DEFAULT '[]'::jsonb NOT NULL
);





CREATE TABLE public.fee_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_id uuid NOT NULL,
    student_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method text DEFAULT 'cash'::text NOT NULL,
    receipt_number text,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    received_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.fee_structures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class text NOT NULL,
    fee_type text NOT NULL,
    label text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    is_optional boolean DEFAULT false NOT NULL,
    is_recurring boolean DEFAULT true NOT NULL,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_methods jsonb DEFAULT '[]'::jsonb
);





CREATE TABLE public.fee_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    name text NOT NULL,
    category text NOT NULL,
    default_amount numeric(12,2) DEFAULT 0 NOT NULL,
    is_recurring boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fee_types_category_check CHECK ((category = ANY (ARRAY['fee'::text, 'fine'::text, 'other'::text])))
);





CREATE TABLE public.fee_vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_number text NOT NULL,
    student_id uuid NOT NULL,
    class text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    fee_period text DEFAULT 'monthly'::text NOT NULL,
    fee_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    due_date date NOT NULL,
    bank_details jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'unpaid'::text NOT NULL,
    late_fee numeric(12,2) DEFAULT 0 NOT NULL,
    paid_amount numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.generated_id_cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    full_name text NOT NULL,
    roll_number text NOT NULL,
    class text NOT NULL,
    father_name text,
    photo_url text,
    is_active boolean DEFAULT true NOT NULL,
    session text,
    serial_no text,
    emis_code text DEFAULT 'YOUR_EMIS_CODE'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.interview_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admission_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    booked_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.interview_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slot_date date NOT NULL,
    start_time time without time zone NOT NULL,
    duration_minutes integer DEFAULT 15 NOT NULL,
    capacity integer DEFAULT 10 NOT NULL,
    current_bookings integer DEFAULT 0 NOT NULL,
    location text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT interview_slots_capacity_check CHECK (((capacity >= 1) AND (capacity <= 100))),
    CONSTRAINT interview_slots_current_bookings_check CHECK ((current_bookings >= 0)),
    CONSTRAINT interview_slots_duration_minutes_check CHECK (((duration_minutes >= 5) AND (duration_minutes <= 120)))
);





CREATE TABLE public.merit_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class text NOT NULL,
    exam_type text,
    year integer NOT NULL,
    is_published boolean DEFAULT false,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    title text,
    scope text DEFAULT 'class'::text NOT NULL,
    publish_at timestamp with time zone,
    notes text,
    created_by uuid,
    entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_students integer DEFAULT 0 NOT NULL,
    passing_count integer DEFAULT 0 NOT NULL,
    highest_percentage numeric DEFAULT 0 NOT NULL,
    average_percentage numeric DEFAULT 0 NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    theme text DEFAULT 'gold'::text,
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.payment_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    charge_id uuid NOT NULL,
    amount_paid numeric(12,2) NOT NULL,
    CONSTRAINT payment_items_amount_paid_check CHECK ((amount_paid > (0)::numeric))
);





CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    student_id uuid NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    payment_method text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reference_number text,
    screenshot_url text,
    paid_at timestamp with time zone DEFAULT now(),
    received_by uuid,
    verified_by uuid,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'jazzcash'::text, 'easypaisa'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'rejected'::text]))),
    CONSTRAINT payments_total_amount_check CHECK ((total_amount > (0)::numeric))
);





CREATE TABLE public.receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    receipt_number text NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    class text NOT NULL,
    exam_type text NOT NULL,
    year integer NOT NULL,
    total_marks integer NOT NULL,
    obtained_marks integer NOT NULL,
    percentage numeric,
    grade text,
    "position" integer,
    is_pass boolean,
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    exam_roll_no text,
    manual_pass_fail boolean,
    subject_marks jsonb,
    is_published boolean DEFAULT false NOT NULL,
    publish_at timestamp with time zone,
    CONSTRAINT results_class_check CHECK ((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text])))
);

ALTER TABLE ONLY public.results REPLICA IDENTITY FULL;





CREATE TABLE public.student_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid,
    student_id uuid NOT NULL,
    fee_type_id uuid,
    title text NOT NULL,
    amount numeric(12,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT student_charges_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT student_charges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text])))
);





ALTER TABLE ONLY public.admission_documents
    ADD CONSTRAINT admission_documents_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.admission_otp_codes
    ADD CONSTRAINT admission_otp_codes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.admission_settings
    ADD CONSTRAINT admission_settings_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.admission_status_timeline
    ADD CONSTRAINT admission_status_timeline_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_reference_no_key UNIQUE (reference_no);




ALTER TABLE ONLY public.exam_attendance
    ADD CONSTRAINT exam_attendance_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_attendance
    ADD CONSTRAINT exam_attendance_session_id_student_id_subject_exam_date_key UNIQUE (session_id, student_id, subject, exam_date);




ALTER TABLE ONLY public.exam_attendance
    ADD CONSTRAINT exam_attendance_session_student_subject_date_key UNIQUE (session_id, student_id, subject, exam_date);




ALTER TABLE ONLY public.exam_roll_numbers
    ADD CONSTRAINT exam_roll_numbers_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_roll_numbers
    ADD CONSTRAINT exam_roll_numbers_session_id_exam_roll_no_key UNIQUE (session_id, exam_roll_no);




ALTER TABLE ONLY public.exam_roll_numbers
    ADD CONSTRAINT exam_roll_numbers_session_id_student_id_key UNIQUE (session_id, student_id);




ALTER TABLE ONLY public.exam_roll_sessions
    ADD CONSTRAINT exam_roll_sessions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_schedule
    ADD CONSTRAINT exam_schedule_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_seating_assignments
    ADD CONSTRAINT exam_seating_assignments_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_seating_assignments
    ADD CONSTRAINT exam_seating_assignments_plan_id_room_id_row_idx_col_idx_key UNIQUE (plan_id, room_id, row_idx, col_idx);




ALTER TABLE ONLY public.exam_seating_assignments
    ADD CONSTRAINT exam_seating_assignments_plan_id_student_id_key UNIQUE (plan_id, student_id);




ALTER TABLE ONLY public.exam_seating_plans
    ADD CONSTRAINT exam_seating_plans_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.exam_seating_rooms
    ADD CONSTRAINT exam_seating_rooms_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_class_fee_type_key UNIQUE (class, fee_type);




ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.fee_types
    ADD CONSTRAINT fee_types_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.fee_vouchers
    ADD CONSTRAINT fee_vouchers_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.fee_vouchers
    ADD CONSTRAINT fee_vouchers_student_id_month_year_fee_period_key UNIQUE (student_id, month, year, fee_period);




ALTER TABLE ONLY public.fee_vouchers
    ADD CONSTRAINT fee_vouchers_voucher_number_key UNIQUE (voucher_number);




ALTER TABLE ONLY public.generated_id_cards
    ADD CONSTRAINT generated_id_cards_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.interview_bookings
    ADD CONSTRAINT interview_bookings_admission_id_key UNIQUE (admission_id);




ALTER TABLE ONLY public.interview_bookings
    ADD CONSTRAINT interview_bookings_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.interview_slots
    ADD CONSTRAINT interview_slots_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.merit_lists
    ADD CONSTRAINT merit_lists_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.merit_lists
    ADD CONSTRAINT merit_lists_scope_class_exam_type_year_key UNIQUE (scope, class, exam_type, year);




ALTER TABLE ONLY public.merit_lists
    ADD CONSTRAINT merit_lists_scope_class_exam_year_key UNIQUE (scope, class, exam_type, year);




ALTER TABLE ONLY public.payment_items
    ADD CONSTRAINT payment_items_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_receipt_number_key UNIQUE (receipt_number);




ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_student_class_exam_year_unique UNIQUE (student_id, class, exam_type, year);




ALTER TABLE ONLY public.student_charges
    ADD CONSTRAINT student_charges_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.merit_lists
    ADD CONSTRAINT unique_merit_list UNIQUE (class, exam_type, year);




ALTER TABLE ONLY public.generated_id_cards
    ADD CONSTRAINT unique_student_card UNIQUE (student_id);




CREATE INDEX exam_attendance_session_class_idx ON public.exam_attendance USING btree (session_id, class);




CREATE INDEX exam_attendance_student_subject_date_idx ON public.exam_attendance USING btree (student_id, subject, exam_date);




CREATE INDEX idx_admission_docs_admission ON public.admission_documents USING btree (admission_id);




CREATE INDEX idx_admission_otp_phone ON public.admission_otp_codes USING btree (contact_number, created_at DESC);




CREATE INDEX idx_admission_timeline_admission ON public.admission_status_timeline USING btree (admission_id, created_at DESC);




CREATE INDEX idx_admissions_bform ON public.admissions USING btree (b_form_no);




CREATE INDEX idx_admissions_class ON public.admissions USING btree (applying_class);




CREATE INDEX idx_admissions_created ON public.admissions USING btree (created_at DESC);




CREATE INDEX idx_admissions_status ON public.admissions USING btree (status);




CREATE INDEX idx_admissions_type ON public.admissions USING btree (admission_type);




CREATE INDEX idx_charges_status ON public.student_charges USING btree (status);




CREATE INDEX idx_charges_student ON public.student_charges USING btree (student_id);




CREATE INDEX idx_exam_att_session_class ON public.exam_attendance USING btree (session_id, class);




CREATE INDEX idx_exam_att_session_class_subject_date ON public.exam_attendance USING btree (session_id, class, subject, exam_date);




CREATE INDEX idx_exam_att_student ON public.exam_attendance USING btree (student_id);




CREATE INDEX idx_exam_schedule_class ON public.exam_schedule USING btree (class, exam_type, year);




CREATE INDEX idx_exam_schedule_date ON public.exam_schedule USING btree (exam_date) WHERE (is_published = true);




CREATE INDEX idx_fee_payments_date ON public.fee_payments USING btree (payment_date);




CREATE INDEX idx_fee_payments_student ON public.fee_payments USING btree (student_id);




CREATE INDEX idx_fee_payments_voucher ON public.fee_payments USING btree (voucher_id);




CREATE INDEX idx_fee_structures_active ON public.fee_structures USING btree (is_active);




CREATE INDEX idx_fee_structures_class ON public.fee_structures USING btree (class);




CREATE INDEX idx_fee_vouchers_class ON public.fee_vouchers USING btree (class);




CREATE INDEX idx_fee_vouchers_due_date ON public.fee_vouchers USING btree (due_date);




CREATE INDEX idx_fee_vouchers_month_year ON public.fee_vouchers USING btree (month, year);




CREATE INDEX idx_fee_vouchers_status ON public.fee_vouchers USING btree (status);




CREATE INDEX idx_fee_vouchers_student ON public.fee_vouchers USING btree (student_id);




CREATE INDEX idx_generated_id_cards_class ON public.generated_id_cards USING btree (class);




CREATE INDEX idx_generated_id_cards_student_id ON public.generated_id_cards USING btree (student_id);




CREATE INDEX idx_interview_bookings_admission ON public.interview_bookings USING btree (admission_id);




CREATE INDEX idx_interview_bookings_slot ON public.interview_bookings USING btree (slot_id) WHERE (cancelled_at IS NULL);




CREATE INDEX idx_interview_slots_date ON public.interview_slots USING btree (slot_date, start_time);




CREATE INDEX idx_items_charge ON public.payment_items USING btree (charge_id);




CREATE INDEX idx_items_payment ON public.payment_items USING btree (payment_id);




CREATE INDEX idx_merit_lists_class ON public.merit_lists USING btree (class, exam_type, year);




CREATE INDEX idx_merit_lists_is_published ON public.merit_lists USING btree (is_published);




CREATE INDEX idx_merit_lists_publish_at ON public.merit_lists USING btree (publish_at);




CREATE INDEX idx_merit_lists_published ON public.merit_lists USING btree (is_published);




CREATE INDEX idx_merit_lists_published_live ON public.merit_lists USING btree (is_published, publish_at);




CREATE INDEX idx_merit_lists_scope ON public.merit_lists USING btree (scope);




CREATE INDEX idx_merit_lists_scope_class ON public.merit_lists USING btree (scope, class);




CREATE INDEX idx_merit_lists_year ON public.merit_lists USING btree (year);




CREATE INDEX idx_payments_status ON public.payments USING btree (status);




CREATE INDEX idx_payments_student ON public.payments USING btree (student_id);




CREATE INDEX idx_results_class_exam_year ON public.results USING btree (class, exam_type, year);




CREATE INDEX idx_results_exam_roll_no ON public.results USING btree (exam_roll_no);




CREATE INDEX idx_results_student_id ON public.results USING btree (student_id);




CREATE INDEX idx_seating_assign_plan ON public.exam_seating_assignments USING btree (plan_id);




CREATE INDEX idx_seating_assign_qr ON public.exam_seating_assignments USING btree (qr_token);




CREATE INDEX idx_seating_assign_room ON public.exam_seating_assignments USING btree (room_id);




CREATE INDEX idx_seating_assign_stud ON public.exam_seating_assignments USING btree (student_id);




CREATE INDEX idx_seating_plans_date_range ON public.exam_seating_plans USING btree (exam_date_from, exam_date_to) WHERE ((exam_date_from IS NOT NULL) AND (exam_date_to IS NOT NULL));




CREATE INDEX idx_seating_plans_publish_at ON public.exam_seating_plans USING btree (publish_at) WHERE (publish_at IS NOT NULL);




CREATE INDEX idx_seating_plans_session ON public.exam_seating_plans USING btree (session_id);




CREATE INDEX idx_seating_plans_status ON public.exam_seating_plans USING btree (status);




CREATE INDEX idx_seating_rooms_plan ON public.exam_seating_rooms USING btree (plan_id);




CREATE UNIQUE INDEX uniq_interview_slot ON public.interview_slots USING btree (slot_date, start_time) WHERE is_active;




ALTER TABLE ONLY public.admission_documents
    ADD CONSTRAINT admission_documents_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.admission_status_timeline
    ADD CONSTRAINT admission_status_timeline_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_attendance
    ADD CONSTRAINT exam_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_roll_sessions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_roll_numbers
    ADD CONSTRAINT exam_roll_numbers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_roll_sessions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_roll_numbers
    ADD CONSTRAINT exam_roll_numbers_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_roll_sessions
    ADD CONSTRAINT exam_roll_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);




ALTER TABLE ONLY public.exam_seating_assignments
    ADD CONSTRAINT exam_seating_assignments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.exam_seating_plans(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_seating_assignments
    ADD CONSTRAINT exam_seating_assignments_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.exam_seating_rooms(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_seating_plans
    ADD CONSTRAINT exam_seating_plans_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_roll_sessions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.exam_seating_rooms
    ADD CONSTRAINT exam_seating_rooms_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.exam_seating_plans(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.fee_payments
    ADD CONSTRAINT fee_payments_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.fee_vouchers(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.fee_vouchers
    ADD CONSTRAINT fee_vouchers_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.interview_bookings
    ADD CONSTRAINT interview_bookings_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.interview_bookings
    ADD CONSTRAINT interview_bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.interview_slots(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.payment_items
    ADD CONSTRAINT payment_items_charge_id_fkey FOREIGN KEY (charge_id) REFERENCES public.student_charges(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.payment_items
    ADD CONSTRAINT payment_items_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_received_by_fkey FOREIGN KEY (received_by) REFERENCES auth.users(id);




ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id);




ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.student_charges
    ADD CONSTRAINT student_charges_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);




ALTER TABLE ONLY public.student_charges
    ADD CONSTRAINT student_charges_fee_type_id_fkey FOREIGN KEY (fee_type_id) REFERENCES public.fee_types(id) ON DELETE SET NULL;




ALTER TABLE ONLY public.student_charges
    ADD CONSTRAINT student_charges_student_id_fkey FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE public.admission_documents ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.admission_otp_codes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.admission_settings ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.admission_status_timeline ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.admissions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_attendance ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_roll_numbers ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_roll_sessions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_schedule ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_seating_assignments ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_seating_plans ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.exam_seating_rooms ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.fee_types ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.fee_vouchers ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.generated_id_cards ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.interview_bookings ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.interview_slots ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.merit_lists ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.student_charges ENABLE ROW LEVEL SECURITY;
