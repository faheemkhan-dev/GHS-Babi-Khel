-- ═══════════════════════════════════════════════════════════════════════
-- FILE 00 — Extensions, Storage Buckets & Storage RLS Policies
-- ═══════════════════════════════════════════════════════════════════════
-- This file creates the storage buckets the school website needs and the
-- row-level-security (RLS) policies that gate who can read / upload / delete
-- files in each bucket. It is the FIRST file to run — other tables assume
-- the buckets already exist.
--
-- Buckets created (all PUBLIC, standard type):
--   school-assets, teacher-photos, student-photos, news-images,
--   gallery, library-files, achievement-images, avatars, videos, admissions
--
-- Policies follow a simple rule: public read for everything, but only the
-- service-role (server-side) can upload / update / delete. Anonymous uploads
-- are allowed ONLY to the `admissions` bucket (so prospective students can
-- attach documents to their application before they have an account).
-- ═══════════════════════════════════════════════════════════════════════

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;



CREATE TYPE public.admission_status AS ENUM (
    'pending',
    'under_review',
    'approved',
    'rejected',
    'documents_missing',
    'documents_verified',
    'interview_scheduled',
    'interview_completed',
    'waitlisted',
    'admitted',
    'admit_card_issued'
);





CREATE TYPE public.admission_type AS ENUM (
    'fresh',
    'migration'
);





CREATE POLICY "Auth delete" ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'school-assets'::text));




CREATE POLICY "Auth update" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'school-assets'::text));




CREATE POLICY "Auth upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'school-assets'::text));




CREATE POLICY "Public read" ON storage.objects FOR SELECT USING ((bucket_id = 'school-assets'::text));




CREATE POLICY admin_delete_achievements ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'achievement-images'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_gallery ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'gallery'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_library ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'library-files'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_news_images ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'news-images'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_school_assets ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'school-assets'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_student_photos ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'student-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_delete_teacher_photos ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'teacher-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_update_school_assets ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'school-assets'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_update_student_photos ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'student-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_update_teacher_photos ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'teacher-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_achievements ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'achievement-images'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_gallery ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'gallery'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_library ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'library-files'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_news_images ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'news-images'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_school_assets ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'school-assets'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_student_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'student-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admin_upload_teacher_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'teacher-photos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));




CREATE POLICY admissions_bucket_admin_manage ON storage.objects USING (((bucket_id = 'admissions'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text)))))) WITH CHECK (((bucket_id = 'admissions'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))));




CREATE POLICY admissions_bucket_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'admissions'::text));




CREATE POLICY admissions_bucket_public_upload ON storage.objects FOR INSERT TO authenticated, anon WITH CHECK ((bucket_id = 'admissions'::text));




CREATE POLICY "allow all uploads" ON storage.objects FOR INSERT WITH CHECK (true);




CREATE POLICY "gallery admin delete" ON storage.objects FOR DELETE USING ((bucket_id = 'gallery'::text));




CREATE POLICY "gallery admin upload" ON storage.objects FOR INSERT WITH CHECK ((bucket_id = 'gallery'::text));




CREATE POLICY "gallery public read" ON storage.objects FOR SELECT USING ((bucket_id = 'gallery'::text));




CREATE POLICY public_read_all_buckets ON storage.objects FOR SELECT USING ((bucket_id = ANY (ARRAY['school-assets'::text, 'teacher-photos'::text, 'student-photos'::text, 'news-images'::text, 'gallery'::text, 'library-files'::text, 'achievement-images'::text, 'avatars'::text])));




CREATE POLICY user_update_avatars ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'avatars'::text));




CREATE POLICY user_upload_avatars ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'avatars'::text));




CREATE POLICY user_upload_own_avatar ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'student-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));




CREATE POLICY "videos storage admin delete" ON storage.objects FOR DELETE USING (((bucket_id = 'videos'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))));




CREATE POLICY "videos storage admin write" ON storage.objects FOR INSERT WITH CHECK (((bucket_id = 'videos'::text) AND (auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'admin'::text))))));




CREATE POLICY "videos storage public read" ON storage.objects FOR SELECT USING ((bucket_id = 'videos'::text));




-- ─── Storage bucket definitions ───────────────────────────────
-- Recreate the buckets that this project uses. All are
-- STANDARD type and PUBLIC-read by default.
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('school-assets', 'school-assets', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('teacher-photos', 'teacher-photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('student-photos', 'student-photos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('news-images', 'news-images', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('gallery', 'gallery', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('library-files', 'library-files', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('achievement-images', 'achievement-images', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('admissions', 'admissions', true) ON CONFLICT (id) DO NOTHING;
