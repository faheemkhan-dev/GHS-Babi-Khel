-- ═══════════════════════════════════════════════════════════════════════
-- FILE 21 — FAQ entries (optional admin-written FAQ rows)
-- ═══════════════════════════════════════════════════════════════════════
-- Replaces the former file 22. Additive + idempotent. Run AFTER file 20.
-- ═══════════════════════════════════════════════════════════════════════
-- OPTIONAL admin-written FAQ entries (additive, idempotent).
-- The FAQ is generated live from school data; rows here are APPENDED to it
-- (served by /api/faq, /api/ai-data, /llms-full.txt, the /faq page and its JSON-LD).
-- Add rows in Supabase Table Editor. category must be one of:
-- 'Admissions', 'Results & Exams', 'School Information', 'Website & Contact'.
CREATE TABLE IF NOT EXISTS public.faq_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category text NOT NULL DEFAULT 'School Information',
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_published boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.faq_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS faq_entries_read_public ON public.faq_entries;
CREATE POLICY faq_entries_read_public ON public.faq_entries FOR SELECT USING (is_published = true);
DROP POLICY IF EXISTS faq_entries_admin_all ON public.faq_entries;
CREATE POLICY faq_entries_admin_all ON public.faq_entries
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin'));
