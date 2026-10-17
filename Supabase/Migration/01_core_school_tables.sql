-- ═══════════════════════════════════════════════════════════════════════
-- FILE 01 — Core School Tables (Identity, Operations, Settings)
-- ═══════════════════════════════════════════════════════════════════════
-- Tables that define the school's identity and run its day-to-day
-- operations:
--   school_settings       — single-row config (name, address, logo, etc.)
--   profiles              — supabase auth user -> app role/class mapping
--   students / teachers   — school rosters
--   student_records       — full academic history per student
--   houses / house_members— pastoral house system
--   school_events         — calendar of events
--   contact_messages      — public contact-form inbox
--   site_visits           — lightweight analytics
--   honor_roll            — published merit announcements
--   duty_board            — staff duty roster
--   daily_quotes          — "thought of the day" pool
--   rooms                 — physical room inventory (for seating plans)
--
-- Run AFTER file 00 (storage buckets). Tables here are referenced by every
-- other table via foreign keys, so this file MUST come before files 02-04.
-- ═══════════════════════════════════════════════════════════════════════


CREATE TABLE public.contact_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    subject text,
    message text NOT NULL,
    user_id uuid,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.daily_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    author text,
    category text DEFAULT 'motivational'::text,
    fixed_date date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    is_pinned boolean DEFAULT false NOT NULL,
    source text
);





CREATE TABLE public.duty_board (
    id integer DEFAULT 1 NOT NULL,
    classes jsonb DEFAULT '{}'::jsonb NOT NULL,
    chief_proctor text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT single_row CHECK ((id = 1))
);





CREATE TABLE public.honor_roll (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_name text NOT NULL,
    class text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    reason text,
    photo_url text,
    is_published boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    is_featured boolean DEFAULT false NOT NULL
);





CREATE TABLE public.house_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    house_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.houses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    emoji text DEFAULT ''::text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    description text,
    total_points integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    role text DEFAULT 'user'::text,
    class text,
    roll_number text,
    phone text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending'::text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_class_check CHECK (((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text])) OR (class IS NULL))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'teacher'::text, 'student'::text, 'parent'::text, 'user'::text]))),
    CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);





CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    capacity integer DEFAULT 40,
    room_type text DEFAULT 'classroom'::text NOT NULL,
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.school_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    event_type text DEFAULT 'general'::text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    is_published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.school_settings (
    id integer DEFAULT 1 NOT NULL,
    school_name text DEFAULT 'GHS Your Locality'::text,
    tagline text DEFAULT 'Excellence in Education'::text,
    description text DEFAULT 'Government High School Your Locality is committed to providing quality education and nurturing the future leaders of Pakistan.'::text,
    logo_url text,
    banner_url text,
    emis_code text DEFAULT 'YOUR_EMIS_CODE'::text,
    address text DEFAULT 'Your Locality, Your District, KPK, Pakistan'::text,
    phone text,
    email text DEFAULT 'your-email@example.com'::text,
    established_year integer DEFAULT 2018,
    total_students integer DEFAULT 500,
    total_teachers integer DEFAULT 25,
    pass_percentage numeric DEFAULT 98,
    about_text text,
    location_lat double precision,
    location_lng double precision,
    principal_name text,
    principal_message text,
    principal_photo_url text,
    board_results text DEFAULT 'A+'::text
);





CREATE TABLE public.site_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page text DEFAULT '/'::text NOT NULL,
    referrer text,
    user_agent text,
    device_type text DEFAULT 'unknown'::text NOT NULL,
    session_id text NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.student_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admission_date date,
    serial_no integer,
    student_name text NOT NULL,
    date_of_birth date,
    father_name text,
    caste text,
    profession text,
    address text,
    admitted_class text,
    fee numeric,
    left_class text,
    left_date date,
    remarks text,
    status text DEFAULT 'enrolled'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_records_status_check CHECK ((status = ANY (ARRAY['enrolled'::text, 'withdrawn'::text])))
);





CREATE TABLE public.students (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    roll_number text NOT NULL,
    class text NOT NULL,
    father_name text,
    photo_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    father_cnic text,
    contact_number text,
    CONSTRAINT students_class_check CHECK ((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text])))
);





CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    subject text,
    qualification text,
    experience text,
    phone text,
    email text,
    photo_url text,
    bio text,
    is_active boolean DEFAULT true,
    display_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);





ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.daily_quotes
    ADD CONSTRAINT daily_quotes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.duty_board
    ADD CONSTRAINT duty_board_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.honor_roll
    ADD CONSTRAINT honor_roll_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.house_members
    ADD CONSTRAINT house_members_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.house_members
    ADD CONSTRAINT house_members_user_id_key UNIQUE (user_id);




ALTER TABLE ONLY public.houses
    ADD CONSTRAINT houses_name_key UNIQUE (name);




ALTER TABLE ONLY public.houses
    ADD CONSTRAINT houses_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.school_events
    ADD CONSTRAINT school_events_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.school_settings
    ADD CONSTRAINT school_settings_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.site_visits
    ADD CONSTRAINT site_visits_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.student_records
    ADD CONSTRAINT student_records_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_roll_number_class_key UNIQUE (roll_number, class);




ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_roll_number_class_unique UNIQUE (roll_number, class);




ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);




CREATE UNIQUE INDEX house_members_user_id_unique ON public.house_members USING btree (user_id);




CREATE INDEX idx_contact_messages_created_at ON public.contact_messages USING btree (created_at DESC);




CREATE INDEX idx_contact_messages_is_read ON public.contact_messages USING btree (is_read);




CREATE INDEX idx_daily_quotes_active ON public.daily_quotes USING btree (is_active);




CREATE INDEX idx_daily_quotes_category ON public.daily_quotes USING btree (category);




CREATE INDEX idx_daily_quotes_fixed_date ON public.daily_quotes USING btree (fixed_date);




CREATE INDEX idx_daily_quotes_pinned ON public.daily_quotes USING btree (is_pinned);




CREATE INDEX idx_honor_roll_class ON public.honor_roll USING btree (class);




CREATE INDEX idx_honor_roll_featured ON public.honor_roll USING btree (is_featured) WHERE (is_featured = true);




CREATE INDEX idx_honor_roll_month ON public.honor_roll USING btree (year, month);




CREATE INDEX idx_honor_roll_published ON public.honor_roll USING btree (is_published, created_at DESC);




CREATE INDEX idx_honor_roll_year_month ON public.honor_roll USING btree (year, month);




CREATE INDEX idx_house_members_house_id ON public.house_members USING btree (house_id);




CREATE INDEX idx_house_members_user_id ON public.house_members USING btree (user_id);




CREATE INDEX idx_quotes_date ON public.daily_quotes USING btree (fixed_date);




CREATE INDEX idx_school_events_start_date ON public.school_events USING btree (start_date);




CREATE INDEX idx_school_events_type ON public.school_events USING btree (event_type);




CREATE INDEX idx_site_visits_created_at ON public.site_visits USING btree (created_at DESC);




CREATE INDEX idx_site_visits_device_type ON public.site_visits USING btree (device_type);




CREATE INDEX idx_site_visits_page ON public.site_visits USING btree (page);




CREATE INDEX idx_site_visits_session_id ON public.site_visits USING btree (session_id);




CREATE INDEX idx_site_visits_user_id ON public.site_visits USING btree (user_id) WHERE (user_id IS NOT NULL);




CREATE INDEX idx_student_records_admitted_class ON public.student_records USING btree (admitted_class);




CREATE INDEX idx_student_records_father_name ON public.student_records USING gin (father_name public.gin_trgm_ops);




CREATE INDEX idx_student_records_name ON public.student_records USING gin (student_name public.gin_trgm_ops);




CREATE INDEX idx_student_records_status ON public.student_records USING btree (status);




CREATE INDEX idx_students_class ON public.students USING btree (class);




CREATE INDEX idx_students_is_active ON public.students USING btree (is_active);




CREATE INDEX idx_students_roll_number ON public.students USING btree (roll_number);




CREATE INDEX idx_students_user_id ON public.students USING btree (user_id);




CREATE INDEX idx_teachers_display_order ON public.teachers USING btree (display_order);




CREATE UNIQUE INDEX idx_teachers_user_id ON public.teachers USING btree (user_id);




ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;




ALTER TABLE ONLY public.house_members
    ADD CONSTRAINT house_members_house_id_fkey FOREIGN KEY (house_id) REFERENCES public.houses(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.house_members
    ADD CONSTRAINT house_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.site_visits
    ADD CONSTRAINT site_visits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;




ALTER TABLE ONLY public.student_records
    ADD CONSTRAINT student_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);




ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;




ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.daily_quotes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.duty_board ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.honor_roll ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.house_members ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.houses ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.school_events ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.student_records ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
