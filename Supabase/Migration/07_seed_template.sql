-- ═══════════════════════════════════════════════════════════════════════
-- SEED TEMPLATE — Minimal starter data for a fresh school deployment
-- ═══════════════════════════════════════════════════════════════════════
-- Run AFTER files 00-06 (the schema must exist first).
--
-- This file seeds ONE row in `school_settings` with neutral placeholder
-- values so the website can boot and render its first page immediately
-- (the React app reads school_settings before any admin has logged in).
--
-- Every placeholder is in [SQUARE BRACKETS] — search for "[" in this file
-- and replace with your school's real values BEFORE running. Failure to
-- replace them means the site will show literal "[Your School Name]" in the
-- header until an admin edits it via the dashboard.
--
-- Re-runnable: uses ON CONFLICT DO NOTHING, so this is safe to apply to a
-- database that already has school_settings populated.
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.school_settings (
    id, school_name, tagline, description, logo_url, banner_url,
    emis_code, address, phone, email, established_year,
    total_students, total_teachers, pass_percentage,
    about_text, location_lat, location_lng,
    principal_name, principal_message, principal_photo_url, board_results
) VALUES (
    1,
    '[Your School Name]',                                                -- school_name
    'Excellence in Education',                                          -- tagline
    '[Your School Name] is committed to providing quality education and nurturing the future leaders of Pakistan.',  -- description
    NULL,                                                                -- logo_url    (admin uploads via dashboard)
    NULL,                                                                -- banner_url (admin uploads via dashboard)
    '[YOUR_EMIS_CODE]',                                                  -- emis_code
    '[Your School Address, District, Province, Country]',                -- address
    '[+92-XXX-XXXXXXX]',                                                 -- phone
    '[your-email@example.com]',                                          -- email
    [ESTABLISHMENT_YEAR],                                                -- established_year  e.g. 2018
    0,                                                                   -- total_students   (admin will update)
    0,                                                                   -- total_teachers   (admin will update)
    0,                                                                   -- pass_percentage  (admin will update)
    '[Your School Name], established in [YEAR], is committed to providing quality education and building strong character among students. The school aims to promote learning, discipline, and a bright future for the youth of the area.',  -- about_text
    [LATITUDE],                                                          -- location_lat   e.g. 34.3254495
    [LONGITUDE],                                                         -- location_lng   e.g. 71.3795099
    '[Your Principal Name]',                                             -- principal_name
    'Principal''s Message\n\nWelcome to our school. We are dedicated to providing quality education, fostering good character, and inspiring lifelong learning. Together, we strive to help every student achieve success and reach their full potential.\n\nPrincipal\n[Your School Name]',  -- principal_message
    NULL,                                                                -- principal_photo_url (admin uploads)
    'A+'                                                                 -- board_results
)
ON CONFLICT (id) DO NOTHING;

-- ─── Sample pastoral houses (optional — remove if your school doesn't use them) ───
INSERT INTO public.houses (id, name, color, description) VALUES
  (1, '[House 1 Name]', '#dc2626', '[House 1 description]'),
  (2, '[House 2 Name]', '#2563eb', '[House 2 description]'),
  (3, '[House 3 Name]', '#16a34a', '[House 3 description]'),
  (4, '[House 4 Name]', '#ca8a04', '[House 4 description]')
ON CONFLICT (id) DO NOTHING;

-- ─── First admin user (created via Supabase Auth → then linked here) ───
-- The auth.users row is created when the school owner signs up via the
-- website. After they confirm their email, run the following from the
-- Supabase SQL editor to grant them admin privileges (replace the UUID
-- with their actual user ID, found in Auth → Users in the dashboard):
--
--   INSERT INTO public.profiles (id, role, full_name, email)
--   VALUES (
--     '00000000-0000-0000-0000-000000000000'  -- ← replace with real user id
--     'admin',
--     '[School Owner Full Name]',
--     '[your-email@example.com]'
--   )
--   ON CONFLICT (id) DO UPDATE SET role = 'admin';
