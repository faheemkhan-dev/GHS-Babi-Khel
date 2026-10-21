-- ═══════════════════════════════════════════════════════════════════════
-- FILE 15 — Index tuning (drop proven duplicates, add proven hot paths)  (Plan: Phase 7)
-- ═══════════════════════════════════════════════════════════════════════
-- RULE FOLLOWED (plan 7.1): nothing is dropped without STRUCTURAL proof
-- (an identical or leading-column-compatible index already exists), and
-- nothing is added without a CODE path that queries it. Every decision's
-- evidence is written next to it. Unused-but-unique indexes (merit_lists
-- scope/year/publish_at, fee_vouchers month_year/due_date, …) are NOT
-- dropped here: that needs a live pg_stat_user_indexes check first — the
-- verification query is at the bottom.
--
-- The database is 33 MB, so plain CREATE INDEX is instant; CONCURRENTLY is
-- unnecessary and would break inside a transaction.
--
-- SAFE TO RE-RUN: yes (IF EXISTS / IF NOT EXISTS everywhere).
-- No row data is touched by any statement in this file.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. DROPS — exact duplicates / structurally subsumed ───────────────────

-- merit_lists: THREE indexes on is_published existed:
--   idx_merit_lists_is_published, idx_merit_lists_published (identical!) and
--   idx_merit_lists_published_live (is_published, publish_at). A btree can
--   serve any is_published-only predicate from its leading column, so the
--   two single-column copies are dead weight on every merit_lists write
--   (AdminMeritList publishes/upserts regularly).
DROP INDEX IF EXISTS public.idx_merit_lists_is_published;
DROP INDEX IF EXISTS public.idx_merit_lists_published;

-- notices: idx_notices_published btree(is_published) is structurally
--   dominated by notices_pinned_recent_idx (is_pinned DESC, created_at DESC)
--   WHERE is_published = true — every query the boolean index could serve
--   (all of them filter is_published = true, see useNotices / push_signature
--   in migration 12) is served better by the partial index; lookups by id
--   use the primary key.
DROP INDEX IF EXISTS public.idx_notices_published;

-- exam_attendance: idx_exam_att_session_class and
--   exam_attendance_session_class_idx are IDENTICAL (session_id, class), and
--   both are subsumed by idx_exam_att_session_class_subject_date
--   (session_id, class, subject, exam_date) via leading columns. The Live
--   Console queries by session+class(+subject+date) — kept covered.
DROP INDEX IF EXISTS public.idx_exam_att_session_class;
DROP INDEX IF EXISTS public.exam_attendance_session_class_idx;

-- fee_vouchers: idx_fee_vouchers_student and idx_fee_vouchers_student_id
--   are IDENTICAL (student_id) — one copy is pure write overhead on the
--   busiest fee table (get_all_vouchers / record_fee_payment paths).
DROP INDEX IF EXISTS public.idx_fee_vouchers_student;

-- ── 2. ADDS — proven hot query paths + FK cascades ─────────────────────────

-- exam_roll_numbers: had NO index beyond the PK (verified in migration 03).
--   (a) PUBLIC ROLL SLIP ROSTER — the most-run public query on exam days:
--       "WHERE session_id = ? ORDER BY serial_number" (useRollSlipCountdown.
--       fetchPublicRolls, also hover-prefetched from the Navbar) was a full
--       scan + sort on every slip view.
--   (b) FK exam_roll_numbers_session_id_fkey is ON DELETE CASCADE — deleting
--       a session re-scans the whole table without it.
CREATE INDEX IF NOT EXISTS idx_exam_roll_numbers_session_serial
  ON public.exam_roll_numbers (session_id, serial_number);

-- gallery_photos: no index at all; album_id FK is ON DELETE CASCADE and the
--   public Gallery page lists photos per album.
CREATE INDEX IF NOT EXISTS idx_gallery_photos_album
  ON public.gallery_photos (album_id);

-- notification_dismissals: no index at all. (user_id, notification_id) is
--   the exact lookup dismiss_notification / dismiss_all_notifications run
--   (EXISTS … WHERE d.notification_id = n.id AND d.user_id = auth.uid()),
--   and both FKs are ON DELETE CASCADE.
CREATE INDEX IF NOT EXISTS idx_notification_dismissals_user_notif
  ON public.notification_dismissals (user_id, notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_dismissals_notif
  ON public.notification_dismissals (notification_id);

-- library_files: category/class are indexed but the listing ORDER BY
--   created_at DESC + LIMIT (useLibraryFiles, every Library page view and
--   every /api/public-data?kind=library cache refresh) had no supporting
--   index → top-N sort each time.
CREATE INDEX IF NOT EXISTS idx_library_files_created
  ON public.library_files (created_at DESC);

-- ── 3. EXPLICITLY KEPT (checked, do NOT drop) ──────────────────────────────
--   • student_records(admitted_class, status, GIN student_name/father_name):
--     all four are used by the admin Student Records screen
--     (src/hooks/useStudentRecords.ts filters .eq("status"), .eq
--     ("admitted_class") and trigram-or search on both names).
--   • students(roll_number): the Results class-mode search joins on it.
--   • results(class, exam_type, year): the class rank-pool query (and the
--     new cached /api/public-data?kind=result-rank) filters exactly on it.
--   • exam_attendance(student_id) & (student_id, subject, exam_date):
--     per-student attendance lookups on exam days.
--   • merit_lists(scope / scope_class / year / publish_at) and
--     fee_vouchers(month_year / due_date / status / year): unique indexes
--     with no duplicate — candidates ONLY after a live
--     pg_stat_user_indexes scan shows zero idx_scan over a long enough
--     window (see CHECK below). Do not drop blind.

-- ═══════════════════════════════════════════════════════════════════════
-- CHECK (run a few days after deploying, then decide on the "kept" list):
--   select relname, indexrelname, idx_scan, idx_tup_read,
--          pg_size_pretty(pg_relation_size(indexrelid)) as size
--   from pg_stat_user_indexes
--   where schemaname = 'public' and idx_scan = 0
--   order by pg_relation_size(indexrelid) desc;
--   (interpret together with: select stats_reset from pg_stat_database
--    where datname = current_database(); — stats must be old enough)
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════ ROLLBACK (run only if needed) ═════════════════
-- create index if not exists idx_merit_lists_is_published on public.merit_lists (is_published);
-- create index if not exists idx_merit_lists_published      on public.merit_lists (is_published);
-- create index if not exists idx_notices_published          on public.notices (is_published);
-- create index if not exists idx_exam_att_session_class     on public.exam_attendance (session_id, class);
-- create index if not exists exam_attendance_session_class_idx on public.exam_attendance (session_id, class);
-- create index if not exists idx_fee_vouchers_student       on public.fee_vouchers (student_id);
-- drop index if exists public.idx_exam_roll_numbers_session_serial;
-- drop index if exists public.idx_gallery_photos_album;
-- drop index if exists public.idx_notification_dismissals_user_notif;
-- drop index if exists public.idx_notification_dismissals_notif;
-- drop index if exists public.idx_library_files_created;
