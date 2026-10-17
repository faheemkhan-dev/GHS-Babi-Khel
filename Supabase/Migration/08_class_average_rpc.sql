-- ═══════════════════════════════════════════════════════════════════════
-- 08 · Class average for the public Results → Compare feature
--
-- Returns ONLY aggregates (student count, average %, pass rate and
-- per-subject averages) for one class + exam_type + year.
--
-- • It counts EVERY student's result in that class/exam — including the
--   "top 3 hidden" rows that are still is_published = false — so hiding
--   toppers in Admin → Manage Results never changes the average.
-- • No individual marks, names or highest/lowest scores are returned,
--   so hidden toppers stay hidden.
-- • Returns NULL until at least one result of that class/exam is
--   published, and when fewer than 3 students exist (too small to be an
--   anonymous aggregate).
-- Run once in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_class_exam_average(
  p_class     text,
  p_exam_type text,
  p_year      integer
) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Never expose an exam that has not been published at all.
  IF NOT EXISTS (
    SELECT 1 FROM public.results
     WHERE class = p_class AND exam_type = p_exam_type
       AND year = p_year AND is_published = true
  ) THEN
    RETURN NULL;
  END IF;

  WITH best AS (
    -- One row per student (highest percentage), same rule the rank code uses.
    SELECT DISTINCT ON (COALESCE(student_id::text, id::text))
           percentage, is_pass, subject_marks
      FROM public.results
     WHERE class = p_class AND exam_type = p_exam_type
       AND year = p_year AND percentage IS NOT NULL
     ORDER BY COALESCE(student_id::text, id::text), percentage DESC
  ),
  subj AS (
    SELECT lower(btrim(e.k)) AS key,
           min(e.k)          AS name,
           round(avg((e.v->>'obtained')::numeric), 2) AS ob,
           round(avg((e.v->>'total')::numeric), 2)    AS max
      FROM best b
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(b.subject_marks) = 'object'
             THEN b.subject_marks ELSE '{}'::jsonb END
      ) AS e(k, v)
     WHERE jsonb_typeof(e.v) = 'object'
       AND (e.v->>'obtained') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (e.v->>'total')    ~ '^[0-9]+(\.[0-9]+)?$'
       AND NOT ((e.v->>'obtained')::numeric = 0 AND (e.v->>'total')::numeric = 0)
     GROUP BY lower(btrim(e.k))
  ),
  agg AS (
    SELECT count(*)                                   AS n,
           round(avg(percentage), 2)                  AS pct,
           round(100.0 * count(*) FILTER (WHERE is_pass IS TRUE) / NULLIF(count(*), 0), 1) AS pass_rate
      FROM best
  )
  SELECT CASE WHEN agg.n < 3 THEN NULL ELSE jsonb_build_object(
           'n', agg.n,
           'pct', agg.pct,
           'pass_rate', agg.pass_rate,
           'subjects', COALESCE(
             (SELECT jsonb_object_agg(s.key, jsonb_build_object('name', s.name, 'ob', s.ob, 'max', s.max)) FROM subj s),
             '{}'::jsonb)
         ) END
    INTO v_out
    FROM agg;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_class_exam_average(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_class_exam_average(text, text, integer) TO anon, authenticated;
