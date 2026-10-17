-- ═══════════════════════════════════════════════════════════════════════
-- FILE 02 — Academic Tables (Attendance, Timetable, Notes, Quizzes)
-- ═══════════════════════════════════════════════════════════════════════
-- Everything related to teaching & learning:
--   attendance + attendance_daily_stats + attendance_thresholds
--   timetables + timetable_overrides
--   homework + homework_completions
--   tests + test_questions + test_attempts
--   note_subjects + note_chapters + note_annotations + annotation_upvotes
--   note_flashcards + note_flashcard_progress + note_highlights
--   note_progress + note_questions + note_quizzes + note_quiz_results
--   note_ratings + note_wrong_answers
--   chapter_questions + chapter_answers + chapter_connections
--   chapter_reading_times
--   daily_quizzes + daily_quiz_attempts
--   daily_challenge + daily_challenge_answers
--   discussion_messages + mistake_reports + srs_reviews
--   student_gamification + study_groups + study_group_members
--
-- Run AFTER file 01 (depends on students / teachers / profiles).
-- ═══════════════════════════════════════════════════════════════════════


CREATE TABLE public.annotation_upvotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    annotation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid,
    class text NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'present'::text,
    marked_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT attendance_class_check CHECK ((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text]))),
    CONSTRAINT attendance_status_valid CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text, 'leave'::text, 'halfday'::text])))
);





CREATE TABLE public.attendance_daily_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class text NOT NULL,
    date date NOT NULL,
    total_students integer DEFAULT 0 NOT NULL,
    present_count integer DEFAULT 0 NOT NULL,
    absent_count integer DEFAULT 0 NOT NULL,
    late_count integer DEFAULT 0 NOT NULL,
    leave_count integer DEFAULT 0 NOT NULL,
    halfday_count integer DEFAULT 0 NOT NULL,
    attendance_rate numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.attendance_thresholds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    minimum_percentage numeric(5,2) DEFAULT 75.00 NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    warning_threshold numeric(5,2) DEFAULT 80.00 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.chapter_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid,
    user_id uuid,
    answer text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.chapter_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid,
    related_chapter_id uuid
);





CREATE TABLE public.chapter_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid,
    user_id uuid,
    question text NOT NULL,
    upvotes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.chapter_reading_times (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    chapter_id uuid,
    minutes integer NOT NULL,
    recorded_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.daily_challenge (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_date date NOT NULL,
    question_id uuid,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.daily_challenge_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_date date NOT NULL,
    given_answer text NOT NULL,
    is_correct boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.daily_quiz_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quiz_date date NOT NULL,
    student_name text NOT NULL,
    student_class text,
    roll_number text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    score integer NOT NULL,
    total_questions integer NOT NULL,
    percentage numeric(5,2) NOT NULL,
    time_taken integer,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.daily_quizzes (
    quiz_date date NOT NULL,
    category text NOT NULL,
    category_id integer NOT NULL,
    difficulty text NOT NULL,
    questions jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.discussion_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    sender_name text,
    sender_role text DEFAULT 'user'::text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.homework (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    class text NOT NULL,
    subject text NOT NULL,
    due_date date NOT NULL,
    posted_by uuid,
    teacher_name text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.homework REPLICA IDENTITY FULL;





CREATE TABLE public.homework_completions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    homework_id uuid NOT NULL,
    student_id uuid NOT NULL,
    completed_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.mistake_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid,
    user_id uuid,
    report text NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT mistake_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'fixed'::text])))
);





CREATE TABLE public.note_annotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    highlighted_text text NOT NULL,
    comment text,
    position_data jsonb DEFAULT '{}'::jsonb,
    visibility text DEFAULT 'private'::text NOT NULL,
    color text DEFAULT 'yellow'::text,
    upvotes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT note_annotations_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'shared'::text, 'public'::text])))
);





CREATE TABLE public.note_chapters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_id uuid NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    description text,
    content text,
    animation_code text,
    graph_config jsonb,
    pdf_url text,
    read_time_mins integer DEFAULT 5,
    difficulty text DEFAULT 'medium'::text,
    chapter_number text DEFAULT '1'::text,
    is_published boolean DEFAULT false,
    view_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    audio_enabled boolean DEFAULT true,
    bise_important boolean DEFAULT false,
    bise_years integer DEFAULT 0,
    prerequisite_chapter_id uuid,
    audio_url text,
    audio_duration integer DEFAULT 0,
    CONSTRAINT note_chapters_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text])))
);





CREATE TABLE public.note_flashcard_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    flashcard_id uuid,
    known boolean DEFAULT false,
    next_review date,
    correct_count integer DEFAULT 0
);





CREATE TABLE public.note_flashcards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid,
    front text NOT NULL,
    back text NOT NULL,
    display_order integer DEFAULT 0
);





CREATE TABLE public.note_highlights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    chapter_id uuid,
    selected_text text NOT NULL,
    color text DEFAULT 'yellow'::text,
    personal_note text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.note_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    started boolean DEFAULT false,
    completed boolean DEFAULT false,
    bookmarked boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.note_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_id uuid NOT NULL,
    question text NOT NULL,
    option_a text NOT NULL,
    option_b text NOT NULL,
    option_c text NOT NULL,
    option_d text NOT NULL,
    correct text NOT NULL,
    explanation text,
    display_order integer DEFAULT 0,
    difficulty text DEFAULT 'medium'::text,
    is_past_paper boolean DEFAULT false,
    paper_year integer,
    question_type text DEFAULT 'mcq'::text,
    CONSTRAINT note_questions_correct_check CHECK ((correct = ANY (ARRAY['a'::text, 'b'::text, 'c'::text, 'd'::text]))),
    CONSTRAINT note_questions_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))),
    CONSTRAINT note_questions_question_type_check CHECK ((question_type = ANY (ARRAY['mcq'::text, 'fill'::text])))
);





CREATE TABLE public.note_quiz_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quiz_id uuid NOT NULL,
    score integer NOT NULL,
    total integer NOT NULL,
    passed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.note_quizzes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chapter_id uuid NOT NULL,
    title text NOT NULL,
    pass_score integer DEFAULT 60,
    time_limit_secs integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.note_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    chapter_id uuid,
    rating integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT note_ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);





CREATE TABLE public.note_subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    emoji text DEFAULT '📚'::text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    description text,
    class_level text DEFAULT 'all'::text,
    display_order integer DEFAULT 0,
    is_visible boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    podcast_mode_enabled boolean DEFAULT false
);





CREATE TABLE public.note_wrong_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    question_id uuid,
    given_answer text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.srs_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    question_id uuid NOT NULL,
    ease_factor numeric DEFAULT 2.5 NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    repetitions integer DEFAULT 0 NOT NULL,
    next_review_date date NOT NULL,
    last_reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT srs_ease_factor_min CHECK ((ease_factor >= 1.3)),
    CONSTRAINT srs_interval_positive CHECK (("interval" >= 1)),
    CONSTRAINT srs_repetitions_nonneg CHECK ((repetitions >= 0))
);





CREATE TABLE public.student_gamification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    total_points integer DEFAULT 0,
    streak_days integer DEFAULT 0,
    last_activity_date date,
    badges jsonb DEFAULT '[]'::jsonb,
    completed_subjects jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    freeze_count integer DEFAULT 0,
    weekly_points integer DEFAULT 0,
    house_points integer DEFAULT 0,
    weekly_reset_date date,
    left_house_points jsonb DEFAULT '{}'::jsonb NOT NULL
);





CREATE TABLE public.study_group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid,
    user_id uuid,
    joined_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.study_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.test_attempts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    test_id uuid NOT NULL,
    user_id uuid NOT NULL,
    student_name text NOT NULL,
    student_class text,
    roll_number text,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    total_questions integer DEFAULT 0 NOT NULL,
    percentage numeric(5,2) DEFAULT 0 NOT NULL,
    time_taken integer,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.test_questions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    test_id uuid NOT NULL,
    question_text text NOT NULL,
    option_a text NOT NULL,
    option_b text NOT NULL,
    option_c text NOT NULL,
    option_d text NOT NULL,
    correct_option text NOT NULL,
    order_number integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_questions_correct_option_check CHECK ((correct_option = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))
);





CREATE TABLE public.tests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    subject text NOT NULL,
    type text NOT NULL,
    description text,
    time_per_question integer DEFAULT 15 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tests_type_check CHECK ((type = ANY (ARRAY['weekly'::text, 'monthly'::text])))
);





CREATE TABLE public.timetable_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    effective_date date NOT NULL,
    class text NOT NULL,
    day text NOT NULL,
    period_number integer NOT NULL,
    subject text NOT NULL,
    original_teacher text,
    substitute_teacher text NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.timetables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class text NOT NULL,
    day text NOT NULL,
    period_number integer NOT NULL,
    subject text NOT NULL,
    teacher text,
    teacher_name text,
    start_time text,
    end_time text,
    room text,
    updated_at timestamp with time zone DEFAULT now(),
    meet_link text,
    CONSTRAINT timetables_class_check CHECK ((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text]))),
    CONSTRAINT timetables_day_check CHECK ((day = ANY (ARRAY['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text]))),
    CONSTRAINT timetables_period_number_check CHECK (((period_number >= 1) AND (period_number <= 9)))
);





ALTER TABLE ONLY public.annotation_upvotes
    ADD CONSTRAINT annotation_upvotes_annotation_id_user_id_key UNIQUE (annotation_id, user_id);




ALTER TABLE ONLY public.annotation_upvotes
    ADD CONSTRAINT annotation_upvotes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.attendance_daily_stats
    ADD CONSTRAINT attendance_daily_stats_class_date_key UNIQUE (class, date);




ALTER TABLE ONLY public.attendance_daily_stats
    ADD CONSTRAINT attendance_daily_stats_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_date_key UNIQUE (student_id, date);




ALTER TABLE ONLY public.attendance_thresholds
    ADD CONSTRAINT attendance_thresholds_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.chapter_answers
    ADD CONSTRAINT chapter_answers_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.chapter_connections
    ADD CONSTRAINT chapter_connections_chapter_id_related_chapter_id_key UNIQUE (chapter_id, related_chapter_id);




ALTER TABLE ONLY public.chapter_connections
    ADD CONSTRAINT chapter_connections_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.chapter_questions
    ADD CONSTRAINT chapter_questions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.chapter_reading_times
    ADD CONSTRAINT chapter_reading_times_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.chapter_reading_times
    ADD CONSTRAINT chapter_reading_times_user_id_chapter_id_key UNIQUE (user_id, chapter_id);




ALTER TABLE ONLY public.daily_challenge_answers
    ADD CONSTRAINT daily_challenge_answers_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.daily_challenge_answers
    ADD CONSTRAINT daily_challenge_answers_user_id_challenge_date_key UNIQUE (user_id, challenge_date);




ALTER TABLE ONLY public.daily_challenge
    ADD CONSTRAINT daily_challenge_challenge_date_key UNIQUE (challenge_date);




ALTER TABLE ONLY public.daily_challenge
    ADD CONSTRAINT daily_challenge_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.daily_quiz_attempts
    ADD CONSTRAINT daily_quiz_attempts_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.daily_quiz_attempts
    ADD CONSTRAINT daily_quiz_attempts_user_id_quiz_date_key UNIQUE (user_id, quiz_date);




ALTER TABLE ONLY public.daily_quizzes
    ADD CONSTRAINT daily_quizzes_pkey PRIMARY KEY (quiz_date);




ALTER TABLE ONLY public.discussion_messages
    ADD CONSTRAINT discussion_messages_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.homework_completions
    ADD CONSTRAINT homework_completions_homework_id_student_id_key UNIQUE (homework_id, student_id);




ALTER TABLE ONLY public.homework_completions
    ADD CONSTRAINT homework_completions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.homework
    ADD CONSTRAINT homework_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.mistake_reports
    ADD CONSTRAINT mistake_reports_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_annotations
    ADD CONSTRAINT note_annotations_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_chapters
    ADD CONSTRAINT note_chapters_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_chapters
    ADD CONSTRAINT note_chapters_subject_id_slug_key UNIQUE (subject_id, slug);




ALTER TABLE ONLY public.note_flashcard_progress
    ADD CONSTRAINT note_flashcard_progress_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_flashcard_progress
    ADD CONSTRAINT note_flashcard_progress_user_id_flashcard_id_key UNIQUE (user_id, flashcard_id);




ALTER TABLE ONLY public.note_flashcards
    ADD CONSTRAINT note_flashcards_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_highlights
    ADD CONSTRAINT note_highlights_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_progress
    ADD CONSTRAINT note_progress_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_progress
    ADD CONSTRAINT note_progress_user_id_chapter_id_key UNIQUE (user_id, chapter_id);




ALTER TABLE ONLY public.note_questions
    ADD CONSTRAINT note_questions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_quiz_results
    ADD CONSTRAINT note_quiz_results_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_quizzes
    ADD CONSTRAINT note_quizzes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_ratings
    ADD CONSTRAINT note_ratings_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_ratings
    ADD CONSTRAINT note_ratings_user_id_chapter_id_key UNIQUE (user_id, chapter_id);




ALTER TABLE ONLY public.note_subjects
    ADD CONSTRAINT note_subjects_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_subjects
    ADD CONSTRAINT note_subjects_slug_key UNIQUE (slug);




ALTER TABLE ONLY public.note_wrong_answers
    ADD CONSTRAINT note_wrong_answers_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.note_wrong_answers
    ADD CONSTRAINT note_wrong_answers_user_id_question_id_key UNIQUE (user_id, question_id);




ALTER TABLE ONLY public.srs_reviews
    ADD CONSTRAINT srs_reviews_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.srs_reviews
    ADD CONSTRAINT srs_reviews_unique_user_question UNIQUE (user_id, question_id);




ALTER TABLE ONLY public.student_gamification
    ADD CONSTRAINT student_gamification_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.student_gamification
    ADD CONSTRAINT student_gamification_user_id_key UNIQUE (user_id);




ALTER TABLE ONLY public.study_group_members
    ADD CONSTRAINT study_group_members_group_id_user_id_key UNIQUE (group_id, user_id);




ALTER TABLE ONLY public.study_group_members
    ADD CONSTRAINT study_group_members_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.study_groups
    ADD CONSTRAINT study_groups_code_key UNIQUE (code);




ALTER TABLE ONLY public.study_groups
    ADD CONSTRAINT study_groups_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_test_id_user_id_key UNIQUE (test_id, user_id);




ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.timetable_overrides
    ADD CONSTRAINT timetable_overrides_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.timetables
    ADD CONSTRAINT timetables_pkey PRIMARY KEY (id);




CREATE INDEX idx_annotation_upvotes_annotation ON public.annotation_upvotes USING btree (annotation_id);




CREATE INDEX idx_annotation_upvotes_annotation_id ON public.annotation_upvotes USING btree (annotation_id);




CREATE INDEX idx_annotation_upvotes_user ON public.annotation_upvotes USING btree (user_id);




CREATE INDEX idx_attendance_class_date ON public.attendance USING btree (class, date DESC);




CREATE INDEX idx_attendance_daily_stats_class_date ON public.attendance_daily_stats USING btree (class, date DESC);




CREATE INDEX idx_attendance_date ON public.attendance USING btree (date);




CREATE INDEX idx_attendance_status ON public.attendance USING btree (status);




CREATE INDEX idx_attendance_student_date ON public.attendance USING btree (student_id, date);




CREATE INDEX idx_chapter_answers_question_id ON public.chapter_answers USING btree (question_id);




CREATE INDEX idx_chapter_questions_chapter_id ON public.chapter_questions USING btree (chapter_id);




CREATE INDEX idx_chapter_questions_created_at ON public.chapter_questions USING btree (created_at DESC);




CREATE INDEX idx_chapter_reading_times_user_id ON public.chapter_reading_times USING btree (user_id);




CREATE INDEX idx_dqa_date ON public.daily_quiz_attempts USING btree (quiz_date);




CREATE INDEX idx_dqa_user ON public.daily_quiz_attempts USING btree (user_id);




CREATE INDEX idx_homework_class ON public.homework USING btree (class);




CREATE INDEX idx_homework_due ON public.homework USING btree (due_date);




CREATE INDEX idx_hw_completions_hw ON public.homework_completions USING btree (homework_id);




CREATE INDEX idx_hw_completions_student ON public.homework_completions USING btree (student_id);




CREATE INDEX idx_mistake_reports_chapter_id ON public.mistake_reports USING btree (chapter_id);




CREATE INDEX idx_mistake_reports_created_at ON public.mistake_reports USING btree (created_at DESC);




CREATE INDEX idx_mistake_reports_status ON public.mistake_reports USING btree (status);




CREATE INDEX idx_note_annotations_chapter ON public.note_annotations USING btree (chapter_id);




CREATE INDEX idx_note_annotations_chapter_id ON public.note_annotations USING btree (chapter_id);




CREATE INDEX idx_note_annotations_user ON public.note_annotations USING btree (user_id);




CREATE INDEX idx_note_annotations_user_id ON public.note_annotations USING btree (user_id);




CREATE INDEX idx_note_annotations_visibility ON public.note_annotations USING btree (visibility);




CREATE INDEX idx_srs_reviews_question ON public.srs_reviews USING btree (question_id);




CREATE INDEX idx_srs_reviews_user_due ON public.srs_reviews USING btree (user_id, next_review_date);




CREATE INDEX idx_timetables_class ON public.timetables USING btree (class);




CREATE INDEX srs_reviews_question ON public.srs_reviews USING btree (question_id);




CREATE INDEX srs_reviews_user_due ON public.srs_reviews USING btree (user_id, next_review_date);




CREATE INDEX timetable_overrides_date_idx ON public.timetable_overrides USING btree (effective_date);




CREATE INDEX timetable_overrides_substitute_idx ON public.timetable_overrides USING btree (effective_date, substitute_teacher);




CREATE UNIQUE INDEX timetable_overrides_unique ON public.timetable_overrides USING btree (effective_date, class, day, period_number);




ALTER TABLE ONLY public.annotation_upvotes
    ADD CONSTRAINT annotation_upvotes_annotation_id_fkey FOREIGN KEY (annotation_id) REFERENCES public.note_annotations(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.annotation_upvotes
    ADD CONSTRAINT annotation_upvotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.profiles(id);




ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_answers
    ADD CONSTRAINT chapter_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.chapter_questions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_answers
    ADD CONSTRAINT chapter_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_connections
    ADD CONSTRAINT chapter_connections_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_connections
    ADD CONSTRAINT chapter_connections_related_chapter_id_fkey FOREIGN KEY (related_chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_questions
    ADD CONSTRAINT chapter_questions_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_questions
    ADD CONSTRAINT chapter_questions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_reading_times
    ADD CONSTRAINT chapter_reading_times_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.chapter_reading_times
    ADD CONSTRAINT chapter_reading_times_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.daily_challenge_answers
    ADD CONSTRAINT daily_challenge_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.daily_challenge
    ADD CONSTRAINT daily_challenge_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.note_questions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.daily_quiz_attempts
    ADD CONSTRAINT daily_quiz_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.discussion_messages
    ADD CONSTRAINT discussion_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.homework_completions
    ADD CONSTRAINT homework_completions_homework_id_fkey FOREIGN KEY (homework_id) REFERENCES public.homework(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.homework_completions
    ADD CONSTRAINT homework_completions_student_id_fkey FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.homework
    ADD CONSTRAINT homework_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES auth.users(id) ON DELETE SET NULL;




ALTER TABLE ONLY public.mistake_reports
    ADD CONSTRAINT mistake_reports_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.mistake_reports
    ADD CONSTRAINT mistake_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_annotations
    ADD CONSTRAINT note_annotations_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_annotations
    ADD CONSTRAINT note_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_annotations
    ADD CONSTRAINT note_annotations_user_id_profiles_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_chapters
    ADD CONSTRAINT note_chapters_prerequisite_chapter_id_fkey FOREIGN KEY (prerequisite_chapter_id) REFERENCES public.note_chapters(id);




ALTER TABLE ONLY public.note_chapters
    ADD CONSTRAINT note_chapters_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.note_subjects(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_flashcard_progress
    ADD CONSTRAINT note_flashcard_progress_flashcard_id_fkey FOREIGN KEY (flashcard_id) REFERENCES public.note_flashcards(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_flashcard_progress
    ADD CONSTRAINT note_flashcard_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_flashcards
    ADD CONSTRAINT note_flashcards_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_highlights
    ADD CONSTRAINT note_highlights_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_highlights
    ADD CONSTRAINT note_highlights_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_progress
    ADD CONSTRAINT note_progress_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_progress
    ADD CONSTRAINT note_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_questions
    ADD CONSTRAINT note_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.note_quizzes(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_quiz_results
    ADD CONSTRAINT note_quiz_results_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.note_quizzes(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_quiz_results
    ADD CONSTRAINT note_quiz_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_quizzes
    ADD CONSTRAINT note_quizzes_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_ratings
    ADD CONSTRAINT note_ratings_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_ratings
    ADD CONSTRAINT note_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_wrong_answers
    ADD CONSTRAINT note_wrong_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.note_questions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.note_wrong_answers
    ADD CONSTRAINT note_wrong_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.srs_reviews
    ADD CONSTRAINT srs_reviews_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.note_questions(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.srs_reviews
    ADD CONSTRAINT srs_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.student_gamification
    ADD CONSTRAINT student_gamification_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.study_group_members
    ADD CONSTRAINT study_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.study_groups(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.study_group_members
    ADD CONSTRAINT study_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.study_groups
    ADD CONSTRAINT study_groups_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.test_attempts
    ADD CONSTRAINT test_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.test_questions
    ADD CONSTRAINT test_questions_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.tests(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.tests
    ADD CONSTRAINT tests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);




ALTER TABLE public.annotation_upvotes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.attendance_daily_stats ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.attendance_thresholds ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.chapter_answers ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.chapter_connections ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.chapter_questions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.chapter_reading_times ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.daily_challenge ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.daily_challenge_answers ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.daily_quiz_attempts ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.daily_quizzes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.discussion_messages ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.homework ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.homework_completions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.mistake_reports ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_annotations ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_chapters ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_flashcard_progress ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_flashcards ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_highlights ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_progress ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_questions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_quiz_results ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_quizzes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_ratings ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_subjects ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.note_wrong_answers ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.srs_reviews ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.student_gamification ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.study_group_members ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.study_groups ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.timetable_overrides ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.timetables ENABLE ROW LEVEL SECURITY;
