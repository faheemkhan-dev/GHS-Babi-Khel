-- ═══════════════════════════════════════════════════════════════════════
-- FILE 18 — Fast, exact Rank + Position for the homepage Result Card
-- Safe to run more than once. Read-only function; changes no data.
--
-- WHY: the Result Card used to download every result row of the year (all
-- classes) into the browser to work out Rank/Position. That was slow, and
-- Supabase silently caps a response at 1000 rows, so some students fell off
-- the end of the list and saw "—". This does the ranking inside Postgres
-- and returns ONE tiny row per result.
--
--   Position = standing inside the student's own class (class + exam + year)
--   Rank     = standing across ALL uploaded (published) classes of the year
--
-- A class/exam/year group counts as "uploaded" once it has >= 1 published
-- row. Held-back toppers (unpublished rows of such a group) still count, so
-- hiding the top 3 never shifts anyone's rank. One row per student (their
-- highest percentage); equal percentages share the same number.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_results_year_class_exam
  ON public.results (year, class, exam_type);

CREATE OR REPLACE FUNCTION public.get_result_ranks(p_result_ids uuid[])
RETURNS TABLE (
  result_id      uuid,
  class_position integer,
  class_total    integer,
  school_rank    integer,
  school_total   integer
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  WITH targets AS (
    SELECT r.id, r.class, r.exam_type, r.year,
           COALESCE(r.student_id::text, r.id::text) AS sid
      FROM public.results r
     WHERE r.id = ANY (p_result_ids) AND r.is_published = true
     LIMIT 20
  ),
  live_groups AS (
    SELECT DISTINCT r.class, r.exam_type, r.year
      FROM public.results r
     WHERE r.is_published = true
       AND r.year IN (SELECT year FROM targets)
  ),
  pool AS (
    SELECT r.class, r.exam_type, r.year,
           COALESCE(r.student_id::text, r.id::text) AS sid,
           r.percentage, r.created_at
      FROM public.results r
      JOIN live_groups g USING (class, exam_type, year)
     WHERE r.percentage IS NOT NULL
  ),
  cbest AS (
    SELECT DISTINCT ON (class, exam_type, year, sid) *
      FROM pool
     ORDER BY class, exam_type, year, sid, percentage DESC, created_at DESC
  ),
  cranked AS (
    SELECT class, exam_type, year, sid,
           (rank() OVER (PARTITION BY class, exam_type, year ORDER BY percentage DESC))::int AS pos,
           (count(*) OVER (PARTITION BY class, exam_type, year))::int AS tot
      FROM cbest
  ),
  sbest AS (
    SELECT DISTINCT ON (year, sid) *
      FROM pool
     ORDER BY year, sid, percentage DESC, created_at DESC
  ),
  sranked AS (
    SELECT year, sid,
           (rank() OVER (PARTITION BY year ORDER BY percentage DESC))::int AS rk,
           (count(*) OVER (PARTITION BY year))::int AS tot
      FROM sbest
  )
  SELECT t.id, c.pos, c.tot, s.rk, s.tot
    FROM targets t
    LEFT JOIN cranked c
           ON c.class = t.class AND c.exam_type = t.exam_type
          AND c.year = t.year AND c.sid = t.sid
    LEFT JOIN sranked s
           ON s.year = t.year AND s.sid = t.sid;
$$;

GRANT EXECUTE ON FUNCTION public.get_result_ranks(uuid[]) TO anon, authenticated;

-- rollback: drop function if exists public.get_result_ranks(uuid[]);
--           drop index if exists public.idx_results_year_class_exam;
