-- FILE 19 — One-call Result Card search (student + marks + Rank + Position).
-- Safe to run more than once. Run AFTER file 18. Read-only; changes no data.
-- Returns only PUBLISHED results, same fields the card already showed.

CREATE INDEX IF NOT EXISTS idx_students_class_roll ON public.students (class, roll_number);

CREATE OR REPLACE FUNCTION public.search_result_card(
  p_mode  text,            -- 'exam' (6-digit exam roll) or 'class'
  p_roll  text,
  p_class text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  WITH hits AS (
    SELECT r.*
      FROM public.results r
      LEFT JOIN public.students s ON s.id = r.student_id
     WHERE r.is_published = true
       AND ( (p_mode = 'exam'  AND r.exam_roll_no = p_roll)
          OR (p_mode = 'class' AND r.class = p_class AND s.roll_number = p_roll) )
     ORDER BY r.year DESC
     LIMIT 10
  ),
  rk AS (
    SELECT * FROM public.get_result_ranks((SELECT array_agg(id) FROM hits))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', h.id, 'student_id', h.student_id, 'class', h.class,
      'exam_type', h.exam_type, 'year', h.year,
      'total_marks', h.total_marks, 'obtained_marks', h.obtained_marks,
      'percentage', h.percentage, 'grade', h.grade, 'is_pass', h.is_pass,
      'remarks', h.remarks, 'subject_marks', h.subject_marks,
      'exam_roll_no', COALESCE(NULLIF(h.exam_roll_no, ''), (
          SELECT n.exam_roll_no
            FROM public.exam_roll_numbers n
            JOIN public.exam_roll_sessions es ON es.id = n.session_id
           WHERE n.student_id = h.student_id
             AND es.exam_year = h.year AND es.exam_term = h.exam_type
           ORDER BY (n.class = h.class) DESC LIMIT 1)),
      'position', rk.class_position, 'total_students', rk.class_total,
      'school_rank', rk.school_rank, 'school_total', rk.school_total,
      'students', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
          'full_name', s.full_name, 'roll_number', s.roll_number,
          'father_name', s.father_name, 'photo_url', s.photo_url, 'class', s.class) END
    ) ORDER BY h.year DESC), '[]'::jsonb)
    FROM hits h
    LEFT JOIN public.students s ON s.id = h.student_id
    LEFT JOIN rk ON rk.result_id = h.id;
$$;

GRANT EXECUTE ON FUNCTION public.search_result_card(text, text, text) TO anon, authenticated;
-- rollback: drop function if exists public.search_result_card(text,text,text);
