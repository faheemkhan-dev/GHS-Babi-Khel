-- ═══════════════════════════════════════════════════════════════════════
-- FILE 04 — Content & Communications Tables
-- ═══════════════════════════════════════════════════════════════════════
-- Public-facing content and messaging:
--   news + notices
--   notifications + notification_dismissals + dismissed_notifications
--   gallery_albums + gallery_photos
--   library_books + library_files
--   videos + online_classes
--   achievements
--   sms_outbox + user_messages
--   poll_votes + revision_reminders + lab_content_cache
--
-- Run AFTER files 01-03.
-- ═══════════════════════════════════════════════════════════════════════


CREATE TABLE public.achievements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    student_name text,
    class text,
    year integer,
    image_url text,
    category text DEFAULT 'Academic'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT achievements_category_check CHECK ((category = ANY (ARRAY['Academic'::text, 'Sports'::text, 'Art'::text, 'Science'::text, 'Other'::text])))
);





CREATE TABLE public.dismissed_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.gallery_albums (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    cover_url text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.gallery_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    album_id uuid,
    photo_url text NOT NULL,
    caption text,
    created_at timestamp with time zone DEFAULT now(),
    media_type text DEFAULT 'image'::text NOT NULL,
    CONSTRAINT gallery_photos_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])))
);





CREATE TABLE public.lab_content_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject text NOT NULL,
    chapter_key text NOT NULL,
    chapter_title text NOT NULL,
    content jsonb NOT NULL,
    model text DEFAULT 'glm-4.5-flash'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.library_books (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    author text,
    subject text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.library_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    category text,
    class text,
    subject text,
    file_url text NOT NULL,
    file_type text,
    file_size text,
    download_count integer DEFAULT 0,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    cover_url text,
    CONSTRAINT library_files_category_check CHECK ((category = ANY (ARRAY['Past Papers'::text, 'Books'::text, 'Notes'::text, 'Assignments'::text, 'Other'::text]))),
    CONSTRAINT library_files_class_check CHECK ((class = ANY (ARRAY['6'::text, '7'::text, '8'::text, '9'::text, '10'::text, 'All'::text])))
);





CREATE TABLE public.news (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    image_url text,
    is_published boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    is_pinned boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.news REPLICA IDENTITY FULL;





CREATE TABLE public.notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    category text DEFAULT 'General'::text,
    is_urgent boolean DEFAULT false,
    is_published boolean DEFAULT true,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    is_pinned boolean DEFAULT false NOT NULL,
    is_poll boolean DEFAULT false NOT NULL,
    poll_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    poll_closes_at timestamp with time zone
);

ALTER TABLE ONLY public.notices REPLICA IDENTITY FULL;





CREATE TABLE public.notification_dismissals (
    user_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    dismissed_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience text DEFAULT 'all'::text NOT NULL,
    type text DEFAULT 'default'::text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    is_read boolean DEFAULT false NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.online_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    subject text,
    class_name text,
    class text,
    start_time text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.poll_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notice_id uuid NOT NULL,
    option_id text NOT NULL,
    voter_token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.revision_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    chapter_id uuid,
    remind_at timestamp with time zone NOT NULL,
    times_reminded integer DEFAULT 0
);





CREATE TABLE public.sms_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    to_phone text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);





CREATE TABLE public.user_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    is_admin_reply boolean DEFAULT false NOT NULL,
    sender_name text,
    created_at timestamp with time zone DEFAULT now()
);





CREATE TABLE public.videos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    description text,
    video_url text NOT NULL,
    thumbnail_url text,
    category text DEFAULT 'Lecture'::text NOT NULL,
    class text DEFAULT 'All'::text,
    subject text,
    is_published boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT videos_category_check CHECK ((category = ANY (ARRAY['Lecture'::text, 'Event'::text, 'Program'::text, 'Announcement'::text, 'Other'::text])))
);





ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.dismissed_notifications
    ADD CONSTRAINT dismissed_notifications_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.dismissed_notifications
    ADD CONSTRAINT dismissed_notifications_user_id_notification_id_key UNIQUE (user_id, notification_id);




ALTER TABLE ONLY public.gallery_albums
    ADD CONSTRAINT gallery_albums_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.gallery_photos
    ADD CONSTRAINT gallery_photos_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.lab_content_cache
    ADD CONSTRAINT lab_content_cache_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.lab_content_cache
    ADD CONSTRAINT lab_content_cache_subject_chapter_key_key UNIQUE (subject, chapter_key);




ALTER TABLE ONLY public.library_books
    ADD CONSTRAINT library_books_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.library_files
    ADD CONSTRAINT library_files_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.news
    ADD CONSTRAINT news_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.notices
    ADD CONSTRAINT notices_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_pkey PRIMARY KEY (user_id, notification_id);




ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.online_classes
    ADD CONSTRAINT online_classes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_notice_id_voter_token_key UNIQUE (notice_id, voter_token);




ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.revision_reminders
    ADD CONSTRAINT revision_reminders_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.revision_reminders
    ADD CONSTRAINT revision_reminders_user_id_chapter_id_key UNIQUE (user_id, chapter_id);




ALTER TABLE ONLY public.sms_outbox
    ADD CONSTRAINT sms_outbox_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.user_messages
    ADD CONSTRAINT user_messages_pkey PRIMARY KEY (id);




ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_pkey PRIMARY KEY (id);




CREATE INDEX idx_achievements_category ON public.achievements USING btree (category, created_at DESC);




CREATE INDEX idx_achievements_class ON public.achievements USING btree (class) WHERE (class IS NOT NULL);




CREATE INDEX idx_achievements_year ON public.achievements USING btree (year) WHERE (year IS NOT NULL);




CREATE INDEX idx_dismissed_notifications_user ON public.dismissed_notifications USING btree (user_id);




CREATE INDEX idx_lab_content_cache_lookup ON public.lab_content_cache USING btree (subject, chapter_key);




CREATE INDEX idx_library_category ON public.library_files USING btree (category);




CREATE INDEX idx_library_class ON public.library_files USING btree (class);




CREATE INDEX idx_news_published ON public.news USING btree (is_published);




CREATE INDEX idx_notices_published ON public.notices USING btree (is_published);




CREATE INDEX idx_notifications_audience ON public.notifications USING btree (audience);




CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);




CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);




CREATE INDEX idx_poll_votes_notice ON public.poll_votes USING btree (notice_id);




CREATE INDEX idx_revision_reminders_user_id ON public.revision_reminders USING btree (user_id);




CREATE INDEX news_pinned_recent_idx ON public.news USING btree (is_pinned DESC, created_at DESC) WHERE (is_published = true);




CREATE INDEX notices_pinned_recent_idx ON public.notices USING btree (is_pinned DESC, created_at DESC) WHERE (is_published = true);




ALTER TABLE ONLY public.dismissed_notifications
    ADD CONSTRAINT dismissed_notifications_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.dismissed_notifications
    ADD CONSTRAINT dismissed_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.gallery_photos
    ADD CONSTRAINT gallery_photos_album_id_fkey FOREIGN KEY (album_id) REFERENCES public.gallery_albums(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.library_files
    ADD CONSTRAINT library_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;




ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.notification_dismissals
    ADD CONSTRAINT notification_dismissals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.poll_votes
    ADD CONSTRAINT poll_votes_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES public.notices(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.revision_reminders
    ADD CONSTRAINT revision_reminders_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.note_chapters(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.revision_reminders
    ADD CONSTRAINT revision_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE ONLY public.user_messages
    ADD CONSTRAINT user_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;




ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.dismissed_notifications ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.gallery_albums ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.lab_content_cache ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.library_books ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.library_files ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.notification_dismissals ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.online_classes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.revision_reminders ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.sms_outbox ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.user_messages ENABLE ROW LEVEL SECURITY;



ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
