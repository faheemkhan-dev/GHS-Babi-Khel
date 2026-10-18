-- 10_exam_attendance_hardening.sql   (OPTIONAL but recommended)
-- ---------------------------------------------------------------------------
-- Why: the current policies on public.exam_attendance let ANY logged-in user
-- (for example a student or parent account) INSERT / UPDATE / DELETE rows,
-- because they are `TO authenticated ... WITH CHECK (true)`.
-- After this migration only users whose profiles.role = 'admin' can change
-- exam attendance. Teachers who take attendance must therefore have the
-- 'admin' role (that is how your admin panel already works).
--
-- READ ACCESS IS NOT CHANGED.
--
-- BEFORE RUNNING — check that every teacher/invigilator is an admin:
--   select role, count(*) from public.profiles group by role;
--
-- ROLLBACK (restores the old, open policies) is at the bottom.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin and teachers can insert exam attendance" ON public.exam_attendance;
DROP POLICY IF EXISTS "Admin and teachers can update exam attendance" ON public.exam_attendance;
DROP POLICY IF EXISTS "Admin can delete exam attendance"              ON public.exam_attendance;

CREATE POLICY "Admins can insert exam attendance" ON public.exam_attendance
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update exam attendance" ON public.exam_attendance
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete exam attendance" ON public.exam_attendance
  FOR DELETE TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- DROP POLICY IF EXISTS "Admins can insert exam attendance" ON public.exam_attendance;
-- DROP POLICY IF EXISTS "Admins can update exam attendance" ON public.exam_attendance;
-- DROP POLICY IF EXISTS "Admins can delete exam attendance" ON public.exam_attendance;
-- CREATE POLICY "Admin and teachers can insert exam attendance" ON public.exam_attendance FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "Admin and teachers can update exam attendance" ON public.exam_attendance FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- CREATE POLICY "Admin can delete exam attendance" ON public.exam_attendance FOR DELETE TO authenticated USING (true);
