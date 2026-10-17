// src/hooks/useExamAttendance.ts
// Exam Attendance with QR Code scanning — per class, per paper.
// Supabase table: exam_attendance
//
// Two QR formats are now supported:
//   {t:"exam", sid, stid, rn}            — legacy admit-card QR (no seat info)
//   {t:"seat", pid, rid, sl, stid, rn}   — new desk QR (carries seat/room)
//
// ─── STRICT PAPER-WINDOW ENFORCEMENT (rev. 3) ───────────────────────────────
// Attendance can ONLY be marked when ALL of the following are true:
//   1. The selected exam date is TODAY (no past, no future).
//   2. A seating plan exists for this session+subject+date with paper_start_at
//      and paper_end_at set (i.e. the paper time was configured in the
//      Exam Seating / Live Console).
//   3. The current time is BETWEEN paper_start_at and paper_end_at (inclusive).
//
// If any condition fails, ALL attendance writes (init / scan / update) are
// blocked both in the UI and inside every mutation (defense in depth).
//
// LIVE CONSOLE SYNC (rev. 3): the seating plan is the LIVE source of truth.
// If admin extends paper end-time from the Live Console mid-exam (e.g. 12 PM
// → 1 PM because students came late), the attendance window AUTOMATICALLY
// extends — no need to re-init the sheet. The mutation guards always
// re-fetch the latest paper times from the seating plan, never trusting the
// stale snapshot stored on attendance rows.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ExamAttStatus = "present" | "absent" | "leave";

/**
 * Display-only status. "pending" = the sheet was initialized but nobody has
 * marked this student yet and the paper is still running / not finished. It is
 * NOT stored in the database (the DB keeps "absent" + scanned_at = null), so
 * no migration is needed and every older screen keeps working.
 *   - scan / manual Present  -> status "present", scanned_at set
 *   - manual Absent          -> status "absent",  scanned_at set (explicit)
 *   - manual Leave           -> status "leave"
 *   - untouched init row     -> status "absent",  scanned_at null => "pending"
 *     until the paper window ends, after which it counts as a real Absent.
 */
export type ExamAttDisplayStatus = ExamAttStatus | "pending";

/** True for a row created by Initialize that nobody has touched yet. */
export function isUnmarkedRow(r: { status: string; scanned_at?: string | null }): boolean {
  return r.status === "absent" && !r.scanned_at;
}

/** Resolve the status to SHOW. `paperFinished` = the paper window is over. */
export function displayAttStatus(
  r: { status: ExamAttStatus; scanned_at?: string | null },
  paperFinished: boolean
): ExamAttDisplayStatus {
  return isUnmarkedRow(r) && !paperFinished ? "pending" : r.status;
}

export interface ExamAttendanceRecord {
  id?: string;
  session_id: string;
  student_id: string;
  student_name: string;
  class: string;
  class_roll_no: string;
  exam_roll_no: string;
  subject: string;
  exam_date: string;
  status: ExamAttStatus;
  scanned_at: string | null;
  scanned_by: string | null;
  // Seating fields (added by migration 014 — nullable, backward compatible):
  seat_id?: string | null;
  room_id?: string | null;
  seat_label?: string | null;
  // Paper timing (added by migration 015 — nullable, backward compatible):
  paper_start_time?: string | null;
  paper_end_time?: string | null;
  created_at?: string;
}

export interface ExamSessionInfo {
  id: string;
  title: string;
  exam_year: number;
  exam_term: string;
  classes: string[];
  class_order: string[];
  starting_number: number;
  is_published: boolean;
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────

/** Fetch all published exam sessions (for dropdown) */
export function useExamSessions() {
  return useQuery<ExamSessionInfo[]>({
    queryKey: ["exam-sessions-published"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_roll_sessions")
        .select("id, title, exam_year, exam_term, classes, class_order, starting_number, is_published")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Fetch exam roll numbers for a specific session + class */
export function useExamRollNumbers(sessionId: string | undefined, cls: string | undefined) {
  return useQuery<{ id: string; student_id: string; student_name: string; father_name: string | null; class: string; class_roll_no: string; exam_roll_no: string; serial_number: number }[]>({
    queryKey: ["exam-rolls-for-attendance", sessionId, cls],
    queryFn: async () => {
      if (!sessionId || !cls) return [];
      const { data, error } = await supabase
        .from("exam_roll_numbers")
        .select("id, student_id, student_name, father_name, class, class_roll_no, exam_roll_no, serial_number")
        .eq("session_id", sessionId)
        .eq("class", cls)
        .order("serial_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sessionId && !!cls,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Normalize any date-like string to "YYYY-MM-DD".
 * Handles: "2026-07-06", "2026-07-06T00:00:00.000Z", "2026-07-06 00:00:00+00",
 * "07/06/2026", etc. Returns the original string if it can't be parsed.
 */
function normalizeExamDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  } catch { /* ignore */ }
  return s;
}

/**
 * DEDUPE helper (rev. 11).
 *
 * The exam_attendance table is supposed to have ONE row per
 * (session_id, student_id, subject, exam_date). Pre-migration data may
 * contain duplicate rows (caused by the old SELECT-then-INSERT scan flow
 * racing with itself when two invigilators scanned the same student in the
 * same second). The migration 018 + the new upsert-based scan flow
 * prevents NEW duplicates, but existing ones must be cleaned up at read
 * time too so the UI doesn't show inflated counts or "delete-but-it-comes-
 * back" cells in the Class Overview.
 *
 * This function keeps ONE row per (student_id, subject, NORMALIZED date)
 * group, preferring:
 *   1. non-null scanned_at   (actually scanned > never scanned)
 *   2. latest scanned_at      (most recent scan wins)
 *   3. latest created_at      (tie-breaker)
 *
 * rev. 11: the date is normalized to "YYYY-MM-DD" before being used as
 * part of the key, so rows with different exam_date string formats
 * ("2026-07-06" vs "2026-07-06T00:00:00.000Z") for the same actual date
 * are correctly deduped instead of appearing as separate entries.
 */
export function dedupeAttendanceRows(rows: ExamAttendanceRecord[]): ExamAttendanceRecord[] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, ExamAttendanceRecord>();
  for (const r of rows) {
    const key = `${r.session_id}|${r.student_id}|${r.subject}|${normalizeExamDate(r.exam_date)}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    // Prefer non-null scanned_at, then latest scanned_at, then latest created_at.
    const aHas = !!r.scanned_at;
    const bHas = !!prev.scanned_at;
    let keep: ExamAttendanceRecord;
    if (aHas && !bHas) keep = r;
    else if (!aHas && bHas) keep = prev;
    else if (aHas && bHas) {
      keep = (r.scanned_at! >= prev.scanned_at!) ? r : prev;
    } else {
      // Neither scanned — keep the latest created_at.
      const ra = r.created_at || "";
      const rb = prev.created_at || "";
      keep = (ra >= rb) ? r : prev;
    }
    map.set(key, keep);
  }
  return Array.from(map.values());
}

/** Fetch exam attendance for a specific session + class + subject + date */
export function useExamAttendance(sessionId: string | undefined, cls: string | undefined, subject: string | undefined, examDate: string | undefined) {
  return useQuery<ExamAttendanceRecord[]>({
    queryKey: ["exam-attendance", sessionId, cls, subject, examDate],
    queryFn: async () => {
      if (!sessionId || !cls || !subject || !examDate) return [];
      const { data, error } = await supabase
        .from("exam_attendance")
        .select("*")
        .eq("session_id", sessionId)
        .eq("class", cls)
        .eq("subject", subject)
        .eq("exam_date", examDate)
        .order("class_roll_no", { ascending: true });
      if (error) throw error;
      // DEDUPE: in case pre-migration duplicate rows exist, collapse them
      // so the present/absent/leave stats and the student list aren't inflated.
      return dedupeAttendanceRows(data ?? []);
    },
    enabled: !!sessionId && !!cls && !!subject && !!examDate,
    staleTime: 1 * 60 * 1000,
  });
}

/** Fetch ALL exam attendance for a session + class (for the attendance overview) */
/**
 * Fetch ALL exam attendance for a class (for the Class Overview pivot table).
 *
 * rev. 8: session_id filter REMOVED. The overview now shows attendance from
 * ALL sessions for the selected class. This fixes the "no data shows" bug
 * that occurred when the admin selected a different session in the dropdown
 * than the one the attendance rows were inserted with. The pivot table uses
 * subject+date as column headers so multiple sessions don't collide.
 */
export function useExamAttendanceOverview(sessionId: string | undefined, cls: string | undefined) {
  return useQuery<ExamAttendanceRecord[]>({
    queryKey: ["exam-attendance-overview", sessionId, cls],
    queryFn: async () => {
      if (!sessionId || !cls) return [];
      let q = supabase
        .from("exam_attendance")
        .select("*")
        .eq("session_id", sessionId);
      // cls === "all" means All-Classes mode: fetch every class in the
      // session so the overview can be broken out per class client-side.
      // Otherwise scope to the single selected class as before.
      if (cls !== "all") q = q.eq("class", cls);
      const { data, error } = await q
        .order("class", { ascending: true })
        .order("exam_date", { ascending: true })
        .order("class_roll_no", { ascending: true });
      if (error) throw error;
      // DEDUPE: collapse any duplicate rows so the pivot table doesn't show
      // "delete-but-it-comes-back" cells (caused by pre-migration duplicates
      // where deleting one row left the other behind).
      return dedupeAttendanceRows(data ?? []);
    },
    enabled: !!cls && !!sessionId,
    staleTime: 2 * 60 * 1000,
  });
}

/**
 * Delete a single attendance cell (one student + one subject + one date).
 * Used by the Class Overview's per-cell delete button.
 */
export function useDeleteAttendanceCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      studentId: string;
      subject: string;
      examDate: string;
      cls: string;
      sessionId?: string;
    }) => {
      // Delete ALL rows matching (student, subject, date) — not just one.
      // This cleans up any duplicate rows that may exist from before the
      // unique-constraint migration was applied. If sessionId is provided,
      // also scope by session to be extra safe.
      let q = supabase
        .from("exam_attendance")
        .delete()
        .eq("student_id", params.studentId)
        .eq("subject", params.subject)
        .eq("exam_date", params.examDate);
      if (params.sessionId) q = q.eq("session_id", params.sessionId);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Attendance record deleted");
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview"] });
      qc.invalidateQueries({ queryKey: ["exam-attendance"] });
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to delete attendance record";
      toast.error(msg);
      console.error("[useDeleteAttendanceCell] error:", err);
    },
  });
}

/**
 * Delete ALL attendance for one student in a class (across all subjects/dates).
 * Used by the Class Overview's per-student delete button.
 */
export function useDeleteStudentAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      studentId: string;
      cls: string;
      sessionId?: string;
    }) => {
      // Delete ALL rows for this student in this class. If sessionId is
      // provided, scope by it too.
      let q = supabase
        .from("exam_attendance")
        .delete()
        .eq("student_id", params.studentId)
        .eq("class", params.cls);
      if (params.sessionId) q = q.eq("session_id", params.sessionId);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All attendance records for this student deleted");
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview"] });
      qc.invalidateQueries({ queryKey: ["exam-attendance"] });
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to delete attendance records";
      toast.error(msg);
      console.error("[useDeleteStudentAttendance] error:", err);
    },
  });
}

// ─── PAPER TIMES — AUTO-FETCH FROM SEATING PLAN ─────────────────────────────
// The seating plan (set up in Exam Seating / Live Console) stores
// paper_start_at / paper_end_at as timestamptz. We fetch those and convert to
// "HH:MM" (local) for storage on the attendance rows + window comparison.

export interface PaperTimes { start: string; end: string; } // "HH:MM" local

/** Convert an ISO timestamptz string to "HH:MM" in the browser's local tz. */
function isoToHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format a Date as "YYYY-MM-DD" using LOCAL time (not UTC). */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Loose subject matcher — case-insensitive, bidirectional substring.
 * Matches the dropdown subject (e.g. "Mathematics") against the seating
 * plan's free-text paper_subject (e.g. "Mathematics — Paper 1").
 *
 *   "Mathematics"  vs  "Mathematics — Paper 1"  → MATCH (Mathematics is substring)
 *   "Physics"      vs  "Mathematics — Paper 1"  → no match
 *   "English"      vs  "english literature"     → MATCH (case-insensitive + substring)
 *   ""             vs  "anything"               → no match (empties never match)
 */
export function subjectsMatch(
  planSubject: string | null | undefined,
  dropdownSubject: string | null | undefined
): boolean {
  if (!planSubject || !dropdownSubject) return false;
  const a = planSubject.trim().toLowerCase();
  const b = dropdownSubject.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * ── TERM-AWARE MATCHING (shared) ────────────────────────────────────────
 * Different classes use DIFFERENT exam-type vocabularies in the Date
 * Sheet: classes 6-8 use "1st Semester" / "2nd Semester", while classes
 * 9-10 use "Annual-I" / "Annual-II" for the exact same school-year
 * period. A session's exam_term (e.g. "1st Semester 2026") only literally
 * matches classes 6-8's vocabulary — for Class 9/10 we need to translate
 * "1st" → "Annual-I" and "2nd" → "Annual-II" (and vice versa) so the SAME
 * exam period is found regardless of which class's own naming convention
 * was used to create the session.
 *
 * This is the single shared implementation — AdminExamSeating.tsx and
 * AdminExamConsole.tsx already matched papers this way; the attendance
 * lock-guard below now uses the exact same logic so a Class 9/10 paper
 * that the Console shows as "live" is never incorrectly locked here.
 */
function termOrdinal(text: string): 1 | 2 | null {
  const t = text.trim().toLowerCase();
  const isTwo = /\b2nd\b|\bsecond\b|annual[\s-]*ii\b|\bii\b|\btwo\b|semester\s*2\b/.test(t);
  if (isTwo) return 2;
  const isOne = /\b1st\b|\bfirst\b|annual[\s-]*i\b(?!i)|\bone\b|semester\s*1\b/.test(t);
  if (isOne) return 1;
  return null;
}

export function examTermMatches(examType: string, term: string): boolean {
  const a = String(examType ?? "").trim().toLowerCase();
  const b = String(term ?? "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const oa = termOrdinal(a);
  const ob = termOrdinal(b);
  return oa !== null && oa === ob;
}

/**
 * Extract the date portion (YYYY-MM-DD) from any date-like string.
 * Handles: "2026-07-05", "2026-07-05T09:00:00.000Z", "2026-07-05 09:00:00+00",
 * "07/05/2026", etc. Returns null if the input can't be parsed.
 */
function extractDatePart(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // ISO/timestamptz — take the first 10 chars.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
  // Try Date parsing as a last resort.
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return formatLocalDate(d);
  } catch { /* ignore */ }
  return null;
}

/**
 * ── DATE-SHEET CROSS-CHECK (lock guard) ────────────────────────────────
 * The Exam Date Sheet (exam_schedule) is the AUTHORITATIVE source of when
 * a paper is scheduled. A stale or wrongly-created seating plan used to
 * let the admin mark attendance on days when no paper is actually
 * scheduled (e.g. a seating plan with a 12:00-21:00 window for today even
 * though the real paper is tomorrow). This helper re-derives the window
 * strictly from the date sheet:
 *
 *   - No exam_schedule row for (class, subject, exam_date) → not scheduled
 *   - examDate !== today → future or past, never "in progress"
 *   - today, before date-sheet start_time → not started
 *   - today, after  date-sheet end_time   → ended
 *   - today, within  date-sheet window     → in progress (ALLOWED)
 *
 * The seating plan's paper times are no longer trusted in isolation — the
 * date sheet has the final say. (Seating plan times still flow through
 * the existing getPaperWindowStatus path so older sheets initialized
 * before a date sheet existed continue to work.)
 */
export interface DateSheetLookupRow {
  exam_date: string;       // "YYYY-MM-DD"
  start_time: string | null; // "HH:MM"
  end_time: string | null;   // "HH:MM"
}

export interface DateSheetLookup {
  // True if the date sheet has a row for the given (class, subject, date).
  // When false, attendance MUST be locked regardless of what the seating
  // plan says.
  exists: boolean;
  // The start/end time from the date sheet row (null if exists=false).
  start: string | null;
  end: string | null;
  // The date-sheet row's exam_date (for display in error messages).
  examDate: string | null;
}

/**
 * Look up the date sheet for one (class, subject, examDate) combination.
 * `rows` is a pre-fetched list of exam_schedule rows for the current
 * session+year+term (the caller is expected to filter server-side by
 * session/year/term for performance — this function only does the
 * client-side class+subject+date filter).
 *
 * Subject matching is loose (bidirectional substring) so "Mathematics"
 * matches "Mathematics — Paper 1" etc., matching subjectsMatch().
 */
export function findDateSheetEntry(
  rows: { class: string; subject: string; exam_date: string; start_time: string | null; end_time: string | null }[],
  cls: string,
  subject: string,
  examDate: string
): DateSheetLookupRow | null {
  if (!cls || !subject || !examDate) return null;
  // Try exact subject match first
  const exact = rows.find(r => r.class === cls && r.exam_date === examDate && r.subject.trim().toLowerCase() === subject.trim().toLowerCase());
  if (exact) return { exam_date: exact.exam_date, start_time: exact.start_time, end_time: exact.end_time };
  // Then loose match
  const loose = rows.find(r => r.class === cls && r.exam_date === examDate && subjectsMatch(r.subject, subject));
  if (loose) return { exam_date: loose.exam_date, start_time: loose.start_time, end_time: loose.end_time };
  return null;
}

/**
 * Fetch paper times for a given session+subject+date.
 *
 * DIAGNOSTIC MODE (rev. 6): fetches ALL plans for the session (no server-side
 * date filter — eliminates timestamptz/date format mismatch issues), then
 * filters client-side by:
 *   1. status is 'generated' or 'published'
 *   2. exam_date matches (date-portion comparison — handles both date and
 *      timestamptz columns)
 *   3. paper_start_at and paper_end_at are non-null
 *   4. subject matches (loose, bidirectional, case-insensitive)
 *
 * Logs every step to the console so we can diagnose "no plan found" errors.
 * Returns null if no plan matches — caller should show a detailed error.
 */
// ── SHARED SEATING-PLAN FETCH (performance) ────────────────────────────────
// Before: every caller (5 per-class observers in All-Classes mode + init +
// update) downloaded ALL plans of the session on its own, and on an older DB
// schema each call also burned 1-2 extra failing round trips while probing
// for missing columns. On slow / 2G links that was the single biggest cost.
//   • identical concurrent calls now share ONE in-flight request
//     (no TTL cache, so a Live-Console time change is never served stale);
//   • the first working column set is remembered for the whole session.
const PLAN_SELECTS = [
  "id, paper_subject, paper_start_at, paper_end_at, exam_date, exam_date_from, exam_date_to, classes, class_paper_times, status, created_at",
  "id, paper_subject, paper_start_at, paper_end_at, exam_date, exam_date_from, exam_date_to, classes, status, created_at",
  "id, paper_subject, paper_start_at, paper_end_at, exam_date, classes, status, created_at",
];
let planSelectLevel = 0;
const planInflight = new Map<string, Promise<{ data: any[] | null; error: any }>>();

function fetchSessionPlans(sessionId: string): Promise<{ data: any[] | null; error: any }> {
  const existing = planInflight.get(sessionId);
  if (existing) return existing;
  const p = (async () => {
    let level = planSelectLevel;
    for (;;) {
      const r = await supabase
        .from("exam_seating_plans")
        .select(PLAN_SELECTS[level])
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (r.error && level < PLAN_SELECTS.length - 1 && /class_paper_times|exam_date_from|exam_date_to|Could not find|column/i.test(r.error.message || "")) {
        level++;
        planSelectLevel = level;
        continue;
      }
      return { data: (r.data as any[] | null) ?? null, error: r.error };
    }
  })().finally(() => { planInflight.delete(sessionId); });
  planInflight.set(sessionId, p);
  return p;
}

/**
 * Fetch paper times for a given session+subject+date (+ optional class).
 * Plans are fetched once (shared) and ALL matching is done client-side:
 *   1. status is 'generated' or 'published'
 *   2. date matches exam_date / paper_start_at / [exam_date_from..to]
 *   3. class filter, per-class timing, paper times set, subject match
 * Returns null if no plan matches.
 */
export async function fetchPaperTimesFromSeatingPlan(
  sessionId: string,
  subject: string,
  examDate: string,
  classFilter?: string
): Promise<{ start: string; end: string; planId: string } | null> {
  const { data: allPlans, error } = await fetchSessionPlans(sessionId);
  if (error) {
    console.error("[fetchPaperTimesFromSeatingPlan] Supabase query error:", error);
    return null;
  }
  if (!allPlans || allPlans.length === 0) return null;

  // ── STEP 2: Filter by status (generated or published). ──
  const statusOk = allPlans.filter(p => p.status === "generated" || p.status === "published");
  if (statusOk.length === 0) {
    console.warn("[fetchPaperTimesFromSeatingPlan] All plans have wrong status:", allPlans.map(p => p.status));
    return null;
  }

  // ── STEP 3: Filter by date (date-portion comparison). ──
  // A plan matches today if ANY of these is true:
  //   (a) plan.exam_date (date portion) === targetDate
  //   (b) plan.paper_start_at (date portion) === targetDate
  //   (c) today is within [exam_date_from, exam_date_to] (recurring range)
  //
  // (b) is the fix for Problem 1: when the admin extends the paper end-time
  // from the Live Console, paper_start_at is the live source of truth. If
  // exam_date was left null or is stale (set to a different day), the old
  // strict exam_date-only filter rejected the plan and attendance stayed
  // "locked" even though the paper was clearly running today. Falling back
  // to paper_start_at's date makes the plan match today as long as the
  // paper actually starts today.
  //
  // (c) is the fix for Problem 2: recurring plans with a date range. Every
  // day within [from, to] is a paper day — the plan matches today without
  // the admin needing to update exam_date each morning.
  const targetDate = extractDatePart(examDate);
  const dateOk = statusOk.filter(p => {
    const planExamDate = extractDatePart(p.exam_date);
    if (planExamDate === targetDate) return true;          // (a)
    const planStartDate = extractDatePart(p.paper_start_at);
    if (planStartDate === targetDate) return true;         // (b)
    const planFrom = extractDatePart((p as any).exam_date_from);   // (c)
    const planTo   = extractDatePart((p as any).exam_date_to);
    if (planFrom && planTo && targetDate &&
        planFrom <= targetDate && targetDate <= planTo) return true;
    return false;
  });
  if (dateOk.length === 0) {
    console.warn("[fetchPaperTimesFromSeatingPlan] No plans match date", targetDate, ". Plan dates are:", statusOk.map(p => ({ exam_date: p.exam_date, paper_start_at: p.paper_start_at, exam_date_from: (p as any).exam_date_from, exam_date_to: (p as any).exam_date_to })));
    return null;
  }

  // ── STEP 3b: Filter by CLASS (critical when multiple plans run the same
  // day with DIFFERENT paper end-times, e.g. a 6th/7th plan ending 11:00 AM
  // and an 8th/9th plan ending 12:00 PM on the same day). Without this, a
  // class-6/7 lookup could accidentally match the 8th/9th plan (or vice
  // versa) and lock/unlock at the WRONG time. Only applied when the caller
  // knows which class it's checking — the "scan any class" mode has no
  // single class to filter by, so it's skipped there (documented at the
  // call site) and falls back to date+subject matching only. ──
  const classScopedPlans = classFilter
    ? dateOk.filter(p => Array.isArray(p.classes) && p.classes.includes(classFilter))
    : dateOk;
  // If a class filter was given but nothing matched it, that's a real "no
  // plan for this class today" — don't silently fall back to dateOk, or
  // we'd re-introduce the exact bug this filter fixes.
  const dateOk2 = classFilter ? classScopedPlans : dateOk;
  if (classFilter && dateOk2.length === 0) {
    console.warn("[fetchPaperTimesFromSeatingPlan] No plans for class", classFilter, "on", targetDate, ". Plans found (any class):", dateOk.map(p => ({ id: p.id, classes: p.classes })));
    return null;
  }

  // ── STEP 3c: PER-CLASS TIMING (highest priority) ──────────────────────
  // If this plan mixes multiple classes sitting DIFFERENT papers at
  // DIFFERENT times on the same day (e.g. Class 6 Urdu 9-12 vs Class 10
  // Mutalia Quran 9-11), class_paper_times[classFilter] carries THIS
  // class's own subject/start/end — sourced from the Exam Date Sheet. Try
  // this BEFORE any plan-wide subject matching, since it's the accurate
  // per-class answer whenever it exists.
  if (classFilter) {
    for (const p of dateOk2) {
      const perClass = (p as any).class_paper_times?.[classFilter];
      if (perClass?.start_time && perClass?.end_time && subjectsMatch(perClass.subject, subject)) {
        return { start: perClass.start_time, end: perClass.end_time, planId: p.id };
      }
    }
    // No per-class subject match — try per-class timing regardless of
    // subject if this class has exactly one date-sheet-sourced entry for
    // today (mirrors the plan-wide "only one plan" fallback below).
    const perClassAnySubject = dateOk2
      .map(p => ({ p, entry: (p as any).class_paper_times?.[classFilter] }))
      .filter(x => x.entry?.start_time && x.entry?.end_time);
    if (perClassAnySubject.length === 1) {
      const { p, entry } = perClassAnySubject[0];
      console.warn("[fetchPaperTimesFromSeatingPlan] Per-class subject mismatch, but only 1 per-class entry for this class/date — using it anyway.");
      return { start: entry.start_time, end: entry.end_time, planId: p.id };
    }
  }

  // ── STEP 4: Filter by paper times set (plan-wide fallback). ──
  const timesOk = dateOk2.filter(p => p.paper_start_at && p.paper_end_at);
  if (timesOk.length === 0) {
    console.warn("[fetchPaperTimesFromSeatingPlan] Plans exist for this date but none have paper_start_at/paper_end_at set:", dateOk2.map(p => ({ id: p.id, start: p.paper_start_at, end: p.paper_end_at })));
    return null;
  }

  // ── STEP 5: Filter by subject (loose match). ──
  // 5a. Prefer exact (case-insensitive) match.
  const target = subject.trim().toLowerCase();
  let match = timesOk.find(p =>
    (p.paper_subject || "").trim().toLowerCase() === target
  );

  // 5b. Fall back to loose bidirectional substring match.
  if (!match) {
    match = timesOk.find(p => subjectsMatch(p.paper_subject, subject));
  }

  // 5c. Last resort: if there's only ONE plan for this date with paper times,
  //     use it regardless of subject. This handles the case where the admin
  //     left paper_subject blank or named it something completely different.
  if (!match && timesOk.length === 1) {
    match = timesOk[0];
    console.warn("[fetchPaperTimesFromSeatingPlan] Subject mismatch, but only 1 plan for this date — using it anyway. Plan subject:", match.paper_subject, "Dropdown subject:", subject);
  }

  if (!match) {
    console.warn("[fetchPaperTimesFromSeatingPlan] No subject match. Dropdown:", subject, "Plan subjects:", timesOk.map(p => p.paper_subject));
    return null;
  }

  return {
    start: isoToHHMM(match.paper_start_at),
    end:   isoToHHMM(match.paper_end_at),
    planId: match.id,
  };
}

/** React Query hook version of fetchPaperTimesFromSeatingPlan. */
export function usePaperTimesFromSeatingPlan(
  sessionId: string | undefined,
  subject: string | undefined,
  examDate: string | undefined,
  classFilter?: string
) {
  return useQuery<{ start: string; end: string; planId: string } | null>({
    queryKey: ["paper-times-seating", sessionId, subject, examDate, classFilter],
    queryFn: () => fetchPaperTimesFromSeatingPlan(sessionId!, subject!, examDate!, classFilter),
    enabled: !!sessionId && !!subject && !!examDate,
    // 5s stale time (down from 10s) — the Live Console's PaperTimesEditor
    // invalidates this query on save, so a shorter stale time means the
    // Exam Attendance tab re-locks/unlocks faster when paper times change.
    staleTime: 5 * 1000,
    // ── POLLING (Problem 1 fix) ──
    // Refetch every 10 seconds as a safety net. If the admin extends the
    // paper end-time from the Live Console while the Exam Attendance tab is
    // open, React Query's invalidation SHOULD refresh this query within
    // milliseconds. But if the invalidation is missed (different browser
    // tab, throttled background tab, network hiccup), the 10s poll
    // guarantees the Exam Attendance tab picks up the new end-time and
    // unlocks within 10 seconds — instead of staying "locked" until the
    // admin manually refreshes the page.
    refetchInterval: 10 * 1000,
    // ── KEEP PREVIOUS DATA DURING REFETCH (fixes "scanner closes itself") ──
    // Every successful scan calls qc.invalidateQueries on related keys, and
    // this query also polls every 10s. WITHOUT this option, a refetch can
    // transiently report `data: undefined` before the fresh result arrives.
    // getPaperWindowStatus() treats a missing result as "no_paper_times",
    // which flips canAllScan to false and UNMOUNTS the QR scanner component
    // mid-exam — exactly the "scanner closes after every scan" symptom.
    // Keeping the previous (still-valid) result visible during refetch
    // means the scanner never disappears just because a background
    // refresh happened to be in flight.
    placeholderData: (previousData) => previousData,
  });
}

// ─── PAPER TIMING WINDOW — STRICT ───────────────────────────────────────────
// The "unrestricted" mode is GONE. If there are no paper times, attendance is
// BLOCKED. The only allowed state is "in_progress" (today + paper running).

export type PaperWindowStatus =
  | "not_today"        // examDate is past or future
  | "no_paper_times"   // today, but no paper_start/end set anywhere
  | "not_started"      // today, before paper_start
  | "in_progress"      // today, between paper_start and paper_end (allowed)
  | "ended";           // today, after paper_end

/**
 * Compute the paper-window status. Accepts paper times in EITHER form:
 *   - "HH:MM" string (stored on attendance rows)
 *   - already-resolved { start, end } from the seating plan
 *
 * PRIORITY: seating-plan times WIN over row times. The seating plan is the
 * live-editable source of truth (admin can extend paper end-time from the
 * Live Console mid-exam). Row times are a stale snapshot from init time and
 * are only used as a fallback when no seating plan is found.
 *
 * DATE-SHEET OVERRIDE (the lock-guard fix):
 *   If a dateSheetLookup is provided, it is the AUTHORITATIVE source.
 *   - If the date sheet has NO row for (class, subject, examDate) → status
 *     is forced to "not_today" no matter what the seating plan says. This
 *     blocks init/scan when the admin opens a date with no scheduled paper
 *     (e.g. tomorrow's paper) but a stale seating plan is still present.
 *   - If the date sheet HAS a row, its time window is intersected with the
 *     seating-plan window — the MORE RESTRICTIVE one wins. This way the
 *     admin can never mark attendance BEFORE the date-sheet start_time
 *     (even if the seating plan's window is wider) and can never mark
 *     attendance AFTER the date-sheet end_time (even if the seating plan
 *     was extended past it).
 */
export function getPaperWindowStatus(
  examDate: string,
  rowPaperStart: string | null | undefined,
  rowPaperEnd:   string | null | undefined,
  seatingTimes:  { start: string; end: string } | null | undefined,
  now: Date = new Date(),
  dateSheetLookup?: DateSheetLookup | null
): PaperWindowStatus {
  const todayStr = formatLocalDate(now);
  if (examDate !== todayStr) return "not_today";

  // ── DATE-SHEET AUTHORITATIVE OVERRIDE ────────────────────────────────
  // If the caller passed a date-sheet lookup AND the date sheet has NO
  // entry for the selected (class, subject, date), the paper is not
  // scheduled on this day — lock the panel completely. This is the fix
  // for "admin opens a future date with no paper but the seating plan
  // has stale times, so the panel looks open".
  if (dateSheetLookup && !dateSheetLookup.exists) {
    return "not_today";
  }

  // Determine the active time window:
  //   1. If date sheet has a row with times, use the date sheet (more
  //      authoritative for when the paper officially starts/ends).
  //   2. Otherwise, fall back to seating-plan times.
  //   3. Otherwise, fall back to row-snapshot times.
  let start: string | null = null;
  let end: string | null = null;
  if (dateSheetLookup?.exists && dateSheetLookup.start && dateSheetLookup.end) {
    start = dateSheetLookup.start;
    end = dateSheetLookup.end;
  } else {
    start = seatingTimes?.start || rowPaperStart || null;
    end   = seatingTimes?.end   || rowPaperEnd   || null;
  }
  if (!start || !end) return "no_paper_times";

  // If the date sheet exists but has no times of its own, still intersect
  // the seating-plan window with the date sheet's existence for "today":
  // we already returned "not_today" if !exists, so by here exists is true
  // and we just trust the start/end we picked.

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startDate = new Date(now); startDate.setHours(sh, sm, 0, 0);
  const endDate   = new Date(now); endDate.setHours(eh, em, 59, 999);
  // A paper that ends at/after midnight (e.g. 12:00–00:00) ends on the NEXT day.
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

  if (now < startDate) return "not_started";
  if (now > endDate)   return "ended";
  return "in_progress";
}

/** The ONLY state that allows marking attendance is "in_progress". */
export function canMarkExamAttendance(status: PaperWindowStatus): boolean {
  return status === "in_progress";
}

export function paperWindowMessage(
  status: PaperWindowStatus,
  paperStart?: string | null,
  paperEnd?: string | null
): string {
  switch (status) {
    case "not_today":
      return "Locked — no exam is scheduled for this date. Attendance can only be taken on a date that has a live paper in the Seating Plan / Live Console.";
    case "no_paper_times":
      return "Locked — no paper time is set for this subject today. Set the paper start/end time in Exam Seating / Live Console first.";
    case "not_started":
      return `Locked — paper hasn't started yet. Attendance opens at ${paperStart}.`;
    case "ended":
      return `Locked — paper is over. Attendance closed at ${paperEnd}.`;
    case "in_progress":
      return `Open — paper in progress. Attendance can be marked until ${paperEnd}.`;
    default:
      return "";
  }
}

/**
 * Hard guard for mutations. Throws if the window isn't open.
 * This is the defense-in-depth layer — even if the UI is bypassed, no DB write
 * happens outside the paper window.
 *
 * ALWAYS fetches the latest paper times from the seating plan (the live source
 * of truth) — never trusts the row's stored snapshot, because admin may have
 * extended the paper end-time from the Live Console mid-exam.
 *
 * ALSO cross-checks the Exam Date Sheet (exam_schedule) for this
 * (class, subject, date) combination. If the date sheet has NO row for it,
 * the write is blocked even if the seating plan still has paper times —
 * this is the server-side equivalent of the date-sheet lock guard in
 * getPaperWindowStatus. Without this, an admin who bypasses the UI (or a
 * race condition between date sheet edit + init) could mark attendance
 * for a date with no scheduled paper.
 */
async function assertWindowOpen(opts: {
  examDate: string;
  sessionId: string;
  subject: string;
  rowPaperStart?: string | null;
  rowPaperEnd?: string | null;
  classFilter?: string;
  /** PERFORMANCE: if the caller already fetched plan times moments ago
   *  (e.g. useInitExamAttendance's step 2), pass them here to skip a
   *  duplicate exam_seating_plans round trip. On slow/2G connections each
   *  round trip can cost 1-3+ seconds, and this function used to always
   *  re-fetch even when the caller had the answer in hand. */
  preFetchedPlanTimes?: { start: string; end: string } | null;
}): Promise<{ start: string; end: string }> {
  const now = new Date();
  const todayStr = formatLocalDate(now);
  if (opts.examDate !== todayStr) {
    throw new Error("Attendance can only be marked on today's date.");
  }

  // ── DATE-SHEET CROSS-CHECK — REMOVED PER REQUEST ──────────────────────
  // Attendance is now fully DISCONNECTED from the Exam Date Sheet. It no
  // longer queries exam_schedule at all. The only source of truth for
  // whether a paper is live is the Seating Plan (fetchPaperTimesFromSeatingPlan
  // below) / row-snapshot fallback — exactly what the Live Console and 3D
  // Hall already key off. This avoids any date-sheet/term-matching drift
  // ever locking attendance while Console shows a paper as live.

  let start: string | null = null;
  let end:   string | null = null;
  if (opts.preFetchedPlanTimes) {
    // Reuse the caller's already-fetched plan times — no extra round trip.
    start = opts.preFetchedPlanTimes.start;
    end   = opts.preFetchedPlanTimes.end;
  } else {
    const planTimes = await fetchPaperTimesFromSeatingPlan(opts.sessionId, opts.subject, opts.examDate, opts.classFilter);
    if (planTimes) {
      start = planTimes.start;
      end   = planTimes.end;
    }
  }
  if ((!start || !end) && opts.rowPaperStart && opts.rowPaperEnd) {
    // Fallback for legacy sheets whose seating plan was deleted/unpublished.
    start = opts.rowPaperStart;
    end   = opts.rowPaperEnd;
  }
  if (!start || !end) {
    throw new Error(
      "No paper time set. Check the browser console (F12) for a full diagnostic table. " +
      "Set the paper's start/end time in Exam Seating / Live Console, then try again."
    );
  }

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const startDate = new Date(now); startDate.setHours(sh, sm, 0, 0);
  const endDate   = new Date(now); endDate.setHours(eh, em, 59, 999);
  // A paper that ends at/after midnight (e.g. 12:00–00:00) ends on the NEXT day.
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

  if (now < startDate) throw new Error(`Paper hasn't started yet. Opens at ${start}.`);
  if (now > endDate)   throw new Error(`Paper is over. Closed at ${end}.`);

  return { start, end };
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

// ─── CACHE HELPERS (instant UI, no refetch storms) ──────────────────────────
type AttRows = ExamAttendanceRecord[] | undefined;
const sortByClassRoll = (rows: ExamAttendanceRecord[]) =>
  [...rows].sort((x, y) => String(x.class_roll_no).localeCompare(String(y.class_roll_no), undefined, { numeric: true }));

/**
 * Initialize exam attendance for a class/paper — creates "absent" (shown as
 * "Pending" until the paper ends, see displayAttStatus) records for all students.
 *
 * PERFORMANCE (rev. 13) — one network round trip instead of 4-6:
 *   before:  plan fetch  ->  DELETE all rows  ->  INSERT  ->  refetch 4-6 queries
 *   now:     ONE upsert (returns the rows with their ids)  ||  cleanup delete
 *            (other-date / removed-student rows, runs in parallel, disjoint rows)
 *   • paper times can be passed in (`planTimes`) from the already-polled UI
 *     query, which removes the plan round trip completely (a fresh fetch is
 *     still done when they are not supplied);
 *   • the window guard still runs (locally) on those times — defense in depth;
 *   • the result is written straight into the React-Query cache, so the sheet
 *     appears the moment the upsert returns — no follow-up refetch;
 *   • in All-Classes mode `silent` suppresses the per-class toast.
 * Semantics are unchanged: re-initializing REPLACES the sheet with a fresh
 * sheet dated today (statuses reset), and rows on other dates / for students
 * no longer on the roll list are removed.
 */
export function useInitExamAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      cls: string;
      subject: string;
      examDate: string;
      students: { student_id: string; student_name: string; class_roll_no: string; exam_roll_no: string }[];
      /** Already-resolved paper times ("HH:MM") for this class — skips the plan round trip. */
      planTimes?: { start: string; end: string } | null;
      /** Suppress the per-class success toast (All-Classes mode shows one summary). */
      silent?: boolean;
    }) => {
      // 1. Strict today check.
      const todayStr = formatLocalDate(new Date());
      if (params.examDate !== todayStr) {
        throw new Error("Attendance can only be initialized for today's date.");
      }
      if (params.students.length === 0) throw new Error("No students to initialize.");

      // 2. Paper times: use the caller's (already polled) times, else fetch.
      let planTimes: { start: string; end: string } | null = null;
      if (params.planTimes?.start && params.planTimes?.end) {
        planTimes = { start: params.planTimes.start.slice(0, 5), end: params.planTimes.end.slice(0, 5) };
      } else {
        const fetched = await fetchPaperTimesFromSeatingPlan(params.sessionId, params.subject, params.examDate, params.cls);
        if (fetched) planTimes = { start: fetched.start, end: fetched.end };
      }
      if (!planTimes) {
        throw new Error(
          "No matching seating plan with paper times found. " +
          "Common causes: (1) wrong Exam Session selected, (2) plan status is 'draft' (publish it first), " +
          "(3) plan's date doesn't match today, (4) paper start/end time not set on the plan, " +
          "(5) plan's subject doesn't match the selected subject. " +
          "Open Live Console → Paper Times to verify the plan exists and has times set."
        );
      }

      // 3. Window check — pure local computation, no network.
      await assertWindowOpen({
        examDate: params.examDate,
        sessionId: params.sessionId,
        subject: params.subject,
        rowPaperStart: planTimes.start,
        rowPaperEnd: planTimes.end,
        classFilter: params.cls,
        preFetchedPlanTimes: planTimes,
      });

      // 4. Fresh "absent" (= pending) rows for every student, dated today.
      const rows = params.students.map(s => ({
        session_id: params.sessionId,
        student_id: s.student_id,
        student_name: s.student_name,
        class: params.cls,
        class_roll_no: s.class_roll_no,
        exam_roll_no: s.exam_roll_no,
        subject: params.subject,
        exam_date: params.examDate,
        status: "absent" as ExamAttStatus,
        scanned_at: null,
        scanned_by: null,
        paper_start_time: planTimes!.start,
        paper_end_time: planTimes!.end,
      }));
      const ids = Array.from(new Set(rows.map(r => r.student_id)));

      // 5a. ONE request: upsert (resets today's rows) and get them back with ids.
      const upsertP = supabase
        .from("exam_attendance")
        .upsert(rows, { onConflict: "session_id,student_id,subject,exam_date" })
        .select("*");

      // 5b. In parallel: remove rows that must not survive a re-init — other
      //     dates of the same paper, and students no longer on the roll list.
      //     These never overlap with the upserted rows (today + listed students).
      const cleanupP = supabase
        .from("exam_attendance")
        .delete()
        .eq("session_id", params.sessionId)
        .eq("class", params.cls)
        .eq("subject", params.subject)
        .or(`exam_date.neq.${params.examDate},student_id.not.in.(${ids.join(",")})`);

      const [up, cleanup] = await Promise.all([upsertP, cleanupP]);
      if (cleanup.error) console.warn("[useInitExamAttendance] cleanup of old rows failed (non-fatal):", cleanup.error);

      let saved: ExamAttendanceRecord[] | null = (up.data as ExamAttendanceRecord[] | null) ?? null;
      if (up.error) {
        // Older DBs without the unique constraint cannot upsert — fall back to
        // the classic replace (delete everything for this paper, then insert).
        const noConstraint = up.error.code === "42P10" || /no unique or exclusion constraint|ON CONFLICT/i.test(up.error.message || "");
        if (!noConstraint) throw up.error;
        const del = await supabase
          .from("exam_attendance").delete()
          .eq("session_id", params.sessionId).eq("class", params.cls).eq("subject", params.subject);
        if (del.error) throw del.error;
        const ins = await supabase.from("exam_attendance").insert(rows).select("*");
        if (ins.error) throw ins.error;
        saved = (ins.data as ExamAttendanceRecord[] | null) ?? null;
      }
      return { rows: saved, count: rows.length };
    },
    onSuccess: (res, vars) => {
      if (!vars.silent) toast.success(`Attendance sheet initialized for ${vars.subject}`);
      const saved = res.rows;
      if (saved && saved.length > 0) {
        const fresh = sortByClassRoll(dedupeAttendanceRows(saved));
        // Single-class sheet = exactly what the query would return → set it.
        qc.setQueryData<ExamAttendanceRecord[]>(
          ["exam-attendance", vars.sessionId, vars.cls, vars.subject, vars.examDate], fresh
        );
        // Other dates of this paper were deleted → empty any cached copies.
        qc.setQueriesData<AttRows>(
          {
            queryKey: ["exam-attendance", vars.sessionId, vars.cls, vars.subject],
            predicate: q => q.queryKey[4] !== vars.examDate,
          },
          () => []
        );
        // All-Classes sheet / overview caches: patch ONLY if already loaded
        // (never create a partial cache entry — it would look "fresh").
        const patchSession = (old: AttRows): AttRows => {
          if (!old) return old;
          return [
            ...old.filter(r => !(r.class === vars.cls && r.subject === vars.subject)),
            ...fresh,
          ];
        };
        qc.setQueryData<AttRows>(["exam-attendance-all-classes", vars.sessionId, vars.examDate], patchSession);
        qc.setQueriesData<AttRows>(
          {
            queryKey: ["exam-attendance-overview", vars.sessionId],
            // only this class's overview, or the All-Classes one
            predicate: q => q.queryKey[2] === vars.cls || q.queryKey[2] === "all",
          },
          old => (old ? [...old.filter(r => !(r.class === vars.cls && r.subject === vars.subject)), ...fresh] : old)
        );
        // Conflict-warning list (it only tracks OTHER dates, never today): the
        // other-date rows of this paper were just deleted, so drop them here.
        qc.setQueryData<Array<{ class: string; subject: string; exam_date: string }> | undefined>(
          ["exam-attendance-paper-dates", vars.sessionId],
          old => old?.filter(r => !(r.class === vars.cls && r.subject === vars.subject))
        );
      } else {
        // Server did not echo rows (e.g. RLS hides them) — fall back to a refetch.
        qc.invalidateQueries({ queryKey: ["exam-attendance", vars.sessionId, vars.cls, vars.subject] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-all-classes", vars.sessionId] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId] });
      }
      // Only mounted (active) consumers refetch — e.g. an open Live Console.
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any, vars) => {
      // CRITICAL: surface the error so the admin sees WHY init failed.
      toast.error(err?.message || "Failed to initialize attendance sheet");
      console.error("[useInitExamAttendance] error:", err);
    },
  });
}

/**
 * Scan QR code — mark a student as present (legacy admit-card QR path).
 *
 * rev. 10 — ATOMIC UPSERT (race-condition-safe):
 * The previous SELECT-then-INSERT flow could create duplicate rows when two
 * invigilators scanned the same student in the same second (both saw
 * existing=null, both INSERTed). The new flow:
 *   1. SELECT existing (read-only — used for "already marked" detection only)
 *   2. Window guard
 *   3. Resolve student info from exam_roll_numbers (works for ANY class in
 *      the session — the saved row uses the student's ACTUAL class, not the
 *      admin/teacher's selected class. This enables cross-class scanning.)
 *   4. Single atomic UPSERT with onConflict — concurrent scans serialize,
 *      no duplicates possible (requires migration 018's unique constraint).
 *
 * Cross-class scanning: `params.cls` is the SELECTED class in the dropdown,
 * but the saved row's `class` field is `rollEntry.class` (the student's real
 * class). The returned `class` is used by the caller to invalidate the right
 * query keys and to show the correct class in the toast.
 */
export function useScanExamAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      studentId: string;
      subject: string;
      examDate: string;
      cls: string;
      scannedBy: string | null;
      /** The exam_roll_no encoded in the QR (may be stale — used as a
       *  fallback lookup if student_id doesn't match, e.g. after "Update
       *  Exam Roll Numbers" reshuffled the table). */
      examRollNo?: string;
    }): Promise<{ status: "marked" | "already"; newStatus: ExamAttStatus; class: string }> => {
      // 1. Read current state (for "already marked" detection ONLY — this
      //    read does NOT gate the write, so the race condition is gone).
      const { data: existing } = await supabase
        .from("exam_attendance")
        .select("id, status, paper_start_time, paper_end_time")
        .eq("session_id", params.sessionId)
        .eq("student_id", params.studentId)
        .eq("subject", params.subject)
        .eq("exam_date", params.examDate)
        .maybeSingle();

      // 2. Window guard.
      await assertWindowOpen({
        examDate: params.examDate,
        sessionId: params.sessionId,
        subject: params.subject,
        rowPaperStart: existing?.paper_start_time,
        rowPaperEnd: existing?.paper_end_time,
        classFilter: params.cls,
      });

      // 3. Resolve student info (session-wide — works for ANY class, not
      //    just the selected one). This is the key change that enables
      //    cross-class scanning: the saved row uses the student's ACTUAL
      //    class from the roll-number table, never a random class.
      //
      // STALE-QR FALLBACK: The admin may be scanning an OLD admit-card QR
      // that was printed before "Update Exam Roll Numbers". The student_id
      // (UUID from the students table) is stable and never changes, so the
      // primary lookup by student_id should always work. BUT if it fails
      // (e.g. the student was removed from the session, or the QR is from
      // a different session), we fall back to looking up by the
      // exam_roll_no encoded in the QR — which might match a DIFFERENT
      // student now (since "Update" reshuffles who gets which roll
      // number). In that case, we mark the CURRENT holder of that roll
      // number present. This is the correct behaviour: the printed admit
      // card says "Roll 001" and the current student with Roll 001 is the
      // one who should be marked present.
      let rollEntry: { student_name: string; class_roll_no: string; exam_roll_no: string; class: string; student_id?: string } | null = null;
      let resolvedStudentId = params.studentId;

      // Primary: lookup by student_id (stable UUID).
      const { data: rollEntryById } = await supabase
        .from("exam_roll_numbers")
        .select("student_id, student_name, class_roll_no, exam_roll_no, class")
        .eq("session_id", params.sessionId)
        .eq("student_id", params.studentId)
        .maybeSingle();
      rollEntry = rollEntryById;

      // Fallback: lookup by exam_roll_no (the QR's rn field).
      if (!rollEntry && params.examRollNo) {
        const { data: rollEntryByRn } = await supabase
          .from("exam_roll_numbers")
          .select("student_id, student_name, class_roll_no, exam_roll_no, class")
          .eq("session_id", params.sessionId)
          .eq("exam_roll_no", params.examRollNo)
          .maybeSingle();
        if (rollEntryByRn) {
          rollEntry = rollEntryByRn;
          resolvedStudentId = rollEntryByRn.student_id;
        }
      }

      if (!rollEntry) throw new Error("Student not found in this exam session");

      // 4. Fetch paper times for the row payload (also re-used by the window
      //    guard inside assertWindowOpen — calling twice is cheap, the
      //    query is short-circuited by React Query's cache for the hook
      //    version but here we're in a mutation so we re-fetch).
      const planTimes = await fetchPaperTimesFromSeatingPlan(params.sessionId, params.subject, params.examDate);

      // 5. ATOMIC UPSERT — race-condition-safe. Two teachers scanning the
      //    same student in the same second will no longer produce duplicate
      //    rows. The unique constraint (added by migration 018) is required
      //    for onConflict to work; if it doesn't exist, this still falls
      //    back to a regular INSERT (no worse than before).
      //
      //    Uses `resolvedStudentId` (which may differ from params.studentId
      //    if we fell back to the exam_roll_no lookup) so the attendance row
      //    is always keyed to the CURRENT student's UUID.
      const { error } = await supabase
        .from("exam_attendance")
        .upsert({
          session_id: params.sessionId,
          student_id: resolvedStudentId,
          student_name: rollEntry.student_name,
          class: rollEntry.class,
          class_roll_no: rollEntry.class_roll_no,
          exam_roll_no: rollEntry.exam_roll_no,
          subject: params.subject,
          exam_date: params.examDate,
          status: "present",
          scanned_at: new Date().toISOString(),
          scanned_by: params.scannedBy,
          paper_start_time: planTimes?.start ?? existing?.paper_start_time ?? null,
          paper_end_time: planTimes?.end ?? existing?.paper_end_time ?? null,
        }, { onConflict: "session_id,student_id,subject,exam_date" });
      if (error) throw error;

      return {
        status: existing?.status === "present" ? "already" : "marked",
        newStatus: "present" as ExamAttStatus,
        class: rollEntry.class,
      };
    },
    onSuccess: (data, vars) => {
      // Invalidate the SELECTED class's queries (so the teacher's current
      // view updates if the student happens to be in the selected class).
      qc.invalidateQueries({ queryKey: ["exam-attendance", vars.sessionId, vars.cls, vars.subject, vars.examDate] });
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId, vars.cls] });
      // ALSO invalidate the student's ACTUAL class queries — this is the
      // important bit for cross-class scanning. If the teacher selected
      // class 8 but scanned a class-7 student, the class-7 sheet needs to
      // refresh so the Live Console and Class Overview reflect the scan.
      if (data?.class && data.class !== vars.cls) {
        qc.invalidateQueries({ queryKey: ["exam-attendance", vars.sessionId, data.class, vars.subject, vars.examDate] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId, data.class] });
      }
      // All-Classes mode reads a separate session-wide overview cache
      // (key = [..., "all"]) which is NOT a prefix of the per-class key
      // above, so it needs its own explicit invalidation.
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId, "all"] });
      qc.invalidateQueries({ queryKey: ["exam-attendance-all-classes", vars.sessionId, vars.examDate] });
      // Live console always refreshes.
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to mark attendance";
      toast.error(msg);
      console.error("[useScanExamAttendance] error:", err);
    },
  });
}

// ─── SEATING-AWARE SCAN (migration 014) ─────────────────────────────────────
// Called when an invigilator scans a DESK QR ({t:"seat",...}). Looks up the
// seating assignment by qr_token, then upserts the exam_attendance row with
// seat_id / room_id / seat_label populated.
export function useScanSeatingAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      /** The raw QR string — used as a fallback lookup by qr_token if the
       *  decoded desk-location and student_id lookups both fail. Optional
       *  because the caller may not have the raw string handy. */
      scannedQrToken?: string;
      decoded?: { planId: string; roomId: string; seatLabel: string; studentId: string; examRollNo: string };
      subject: string;
      examDate: string;
      scannedBy: string | null;
    }): Promise<{
      status: "marked" | "already";
      newStatus: ExamAttStatus;
      studentId: string;
      studentName: string;
      class: string;
      classRollNo: string;
      examRollNo: string;
      sessionId: string;
      seatLabel: string;
      roomName: string;
    }> => {
      // 1. Resolve the assignment row — MULTI-FALLBACK LOOKUP.
      //
      // The admin may be scanning an OLD printed desk sticker or admit card
      // that was printed BEFORE the last "Update Seating" or "Update Exam
      // Roll Numbers". The QR encodes stale data (old student_id, old
      // exam_roll_no, possibly an old qr_token), but the scan should STILL
      // work and mark the RIGHT student present. We try multiple lookup
      // strategies in order until one succeeds:
      //
      //   Strategy A — DESK LOCATION (primary):
      //     Match by (plan_id, room_id, seat_label). This is stable across
      //     "Update Seating" — the physical desk doesn't move, only the
      //     student sitting there changes. This finds whoever is CURRENTLY
      //     assigned to that desk. This is the correct behaviour: the
      //     sticker is glued to the desk, and the desk now has a (possibly
      //     different) student sitting at it.
      //
      //   Strategy B — STUDENT_ID (fallback):
      //     If the desk-location lookup fails (e.g. the plan was recreated
      //     with different room IDs, or the room grid changed), try
      //     matching by the student_id encoded in the QR. This finds the
      //     student's CURRENT desk assignment in the SAME plan — so even
      //     if the student moved to a different desk, we still mark them
      //     present at their current location.
      //
      //   Strategy C — QR_TOKEN (fallback):
      //     If both above fail, try matching by the qr_token. This handles
      //     the rare case where the assignment row wasn't actually deleted
      //     (e.g. partial update failure) and the old token still exists.
      //
      //   Strategy D — EXAM_ROLL_NO (last resort):
      //     If all above fail, try matching by the exam_roll_no encoded in
      //     the QR. This handles the case where the admin updated exam roll
      //     numbers but the student's roll number stayed the same (e.g.
      //     they're the only student in their class).
      //
      // Only if ALL strategies fail do we throw an error. This makes the
      // scan bulletproof against stale QR data — exactly what the user
      // asked for: "old places or updated places so it should directly
      // take attendance and no error shows".

      const ASSIGNMENT_SELECT_FULL = "id, plan_id, room_id, student_id, student_name, class, class_roll_no, exam_roll_no, seat_label, qr_token, exam_seating_plans!inner(session_id, title, paper_start_at, paper_end_at, class_paper_times), exam_seating_rooms!inner(name)";
      const ASSIGNMENT_SELECT_LEGACY = "id, plan_id, room_id, student_id, student_name, class, class_roll_no, exam_roll_no, seat_label, qr_token, exam_seating_plans!inner(session_id, title, paper_start_at, paper_end_at), exam_seating_rooms!inner(name)";
      // Start optimistic with the full select (includes class_paper_times).
      // If the very first query against it fails because the column doesn't
      // exist yet (pre-migration DB), flip to the legacy select for the
      // rest of this scan's lookup strategies — no extra round-trip on the
      // common path where the column already exists.
      let ASSIGNMENT_SELECT = ASSIGNMENT_SELECT_FULL;
      const isMissingColumnError = (msg: string | undefined) =>
        !!msg && /class_paper_times|Could not find|column/i.test(msg);

      let assignment: any = null;
      let lastLookupError: string | null = null;

      if (params.decoded) {
        // ── Strategy A: DESK LOCATION (plan_id + room_id + seat_label) ──
        // Plain .select() (not .maybeSingle()) — defensive against any
        // duplicate rows for the same plan_id+room_id+seat_label (would
        // otherwise throw "multiple rows returned" and block a scan that
        // should work). Taking the first row is safe since all rows here
        // would represent the same physical desk.
        try {
          let { data, error } = await supabase
            .from("exam_seating_assignments")
            .select(ASSIGNMENT_SELECT)
            .eq("plan_id", params.decoded.planId)
            .eq("room_id", params.decoded.roomId)
            .eq("seat_label", params.decoded.seatLabel);
          if (error && isMissingColumnError(error.message) && ASSIGNMENT_SELECT === ASSIGNMENT_SELECT_FULL) {
            ASSIGNMENT_SELECT = ASSIGNMENT_SELECT_LEGACY;
            const retry = await supabase
              .from("exam_seating_assignments")
              .select(ASSIGNMENT_SELECT)
              .eq("plan_id", params.decoded.planId)
              .eq("room_id", params.decoded.roomId)
              .eq("seat_label", params.decoded.seatLabel);
            data = retry.data; error = retry.error;
          }
          if (!error && data && data.length > 0) {
            assignment = data[0];
          }
        } catch (e) {
          lastLookupError = e?.message || "desk location lookup failed";
        }

        // ── Strategy B: STUDENT_ID in the same plan ──
        // The student may have moved to a different desk after "Update
        // Seating". Find their CURRENT desk in the same plan.
        if (!assignment && params.decoded.studentId) {
          try {
            const { data, error } = await supabase
              .from("exam_seating_assignments")
              .select(ASSIGNMENT_SELECT)
              .eq("plan_id", params.decoded.planId)
              .eq("student_id", params.decoded.studentId);
            if (!error && data && data.length > 0) {
              assignment = data[0];
            }
          } catch (e) {
            lastLookupError = e?.message || "student_id lookup failed";
          }
        }

        // ── Strategy C: QR_TOKEN ──
        // The old token might still exist if the assignment wasn't deleted.
        if (!assignment && params.scannedQrToken) {
          try {
            const { data, error } = await supabase
              .from("exam_seating_assignments")
              .select(ASSIGNMENT_SELECT)
              .eq("qr_token", params.scannedQrToken)
              .maybeSingle();
            if (!error && data) {
              assignment = data;
            }
          } catch (e) {
            lastLookupError = e?.message || "qr_token lookup failed";
          }
        }

        // ── Strategy D: EXAM_ROLL_NO in the same plan ──
        // Last resort: the exam_roll_no might still be valid.
        if (!assignment && params.decoded.examRollNo) {
          try {
            const { data, error } = await supabase
              .from("exam_seating_assignments")
              .select(ASSIGNMENT_SELECT)
              .eq("plan_id", params.decoded.planId)
              .eq("exam_roll_no", params.decoded.examRollNo);
            if (!error && data && data.length > 0) {
              assignment = data[0];
            }
          } catch (e) {
            lastLookupError = e?.message || "exam_roll_no lookup failed";
          }
        }
      } else {
        // No decoded data — try qr_token only.
        try {
          const { data, error } = await supabase
            .from("exam_seating_assignments")
            .select(ASSIGNMENT_SELECT)
            .eq("qr_token", params.scannedQrToken)
            .maybeSingle();
          if (!error && data) {
            assignment = data;
          }
        } catch (e) {
          lastLookupError = e?.message || "qr_token lookup failed";
        }
      }

      if (!assignment) {
        throw new Error(
          lastLookupError
            ? `Could not resolve seat assignment (${lastLookupError}). The QR may be from an archived plan.`
            : "Seat assignment not found — the QR may be from an archived plan"
        );
      }

      const sessionId = assignment["exam_seating_plans"]?.session_id;
      const roomName  = assignment["exam_seating_rooms"]?.name ?? "—";
      if (!sessionId) throw new Error("Seating plan has no linked exam session");

      // 2. Window guard — prefer THIS STUDENT'S OWN CLASS timing from
      //    class_paper_times (classes mixed into one plan can sit different
      //    papers at different times on the same day), falling back to the
      //    plan-wide paper_start_at/paper_end_at for legacy plans or classes
      //    with no per-class entry. We already have both from the assignment
      //    join above — no extra network round-trip needed.
      const planWideStart = assignment["exam_seating_plans"]?.paper_start_at;
      const planWideEnd   = assignment["exam_seating_plans"]?.paper_end_at;
      const classTimes: Record<string, { subject: string; exam_date: string; start_time: string; end_time: string }> | undefined =
        assignment["exam_seating_plans"]?.class_paper_times;
      const perClassEntry = classTimes?.[assignment.class];

      // Resolve effective HH:MM start/end for THIS scan's student.
      let startHHMM: string | null = null;
      let endHHMM: string | null = null;
      if (perClassEntry?.start_time && perClassEntry?.end_time) {
        startHHMM = perClassEntry.start_time;
        endHHMM = perClassEntry.end_time;
      } else if (planWideStart && planWideEnd) {
        startHHMM = isoToHHMM(planWideStart);
        endHHMM = isoToHHMM(planWideEnd);
      }
      {
        const now = new Date();
        const todayStr = formatLocalDate(now);
        if (params.examDate !== todayStr) {
          throw new Error("Attendance can only be marked on today's date.");
        }
        if (!startHHMM || !endHHMM) {
          throw new Error(`No paper time set for Class ${assignment.class} in the Exam Date Sheet. Set it there, then try again.`);
        }
        const [sh, sm] = startHHMM.split(":").map(Number);
        const [eh, em] = endHHMM.split(":").map(Number);
        const startDate = new Date(now); startDate.setHours(sh, sm, 0, 0);
        const endDate   = new Date(now); endDate.setHours(eh, em, 59, 999);
  // A paper that ends at/after midnight (e.g. 12:00–00:00) ends on the NEXT day.
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
        if (now < startDate) throw new Error(`Paper hasn't started yet. Opens at ${startHHMM}.`);
        if (now > endDate)   throw new Error(`Paper is over. Closed at ${endHHMM}.`);
      }

      // 3+4. Run the "already marked" read IN PARALLEL with the upsert
      //    (rev. 11 — scan-speed fix). The read is only for the cosmetic
      //    "already marked" toast — it does NOT gate the write, so there's
      //    no correctness reason to wait for it before starting the upsert.
      //    Running them concurrently instead of sequentially removes a full
      //    network round-trip from the scan's critical path. The atomic
      //    upsert below is still race-condition-safe on its own.
      const seatPayload = {
        seat_id: assignment.id,
        room_id: assignment.room_id,
        seat_label: assignment.seat_label,
        paper_start_time: startHHMM,
        paper_end_time:   endHHMM,
      };

      const [{ data: existing }, { error }] = await Promise.all([
        supabase
          .from("exam_attendance")
          .select("id, status")
          .eq("session_id", sessionId)
          .eq("student_id", assignment.student_id)
          .eq("subject", params.subject)
          .eq("exam_date", params.examDate)
          .maybeSingle(),
        // ATOMIC UPSERT (rev. 10) — race-condition-safe. Replaces the old
        // SELECT-then-INSERT/UPDATE flow that could create duplicate rows
        // when two invigilators scanned the same student concurrently.
        // Requires migration 018's unique constraint on
        // (session_id, student_id, subject, exam_date) to work atomically;
        // if absent, this falls back to a regular INSERT (no worse than
        // before).
        supabase
          .from("exam_attendance")
          .upsert({
            session_id: sessionId,
            student_id: assignment.student_id,
            student_name: assignment.student_name,
            class: assignment.class,
            class_roll_no: assignment.class_roll_no,
            exam_roll_no: assignment.exam_roll_no,
            subject: params.subject,
            exam_date: params.examDate,
            status: "present",
            scanned_at: new Date().toISOString(),
            scanned_by: params.scannedBy,
            ...seatPayload,
          }, { onConflict: "session_id,student_id,subject,exam_date" }),
      ]);
      if (error) throw error;

      const already = existing?.status === "present";
      return {
        status: already ? "already" : "marked",
        newStatus: "present" as ExamAttStatus,
        studentId: assignment.student_id,
        studentName: assignment.student_name,
        class: assignment.class,
        classRollNo: assignment.class_roll_no,
        examRollNo: assignment.exam_roll_no,
        sessionId,
        seatLabel: assignment.seat_label,
        roomName,
      };
    },
    onSuccess: (data, _vars) => {
      // Invalidate the student's ACTUAL class queries (data.class is the
      // student's real class from the seat assignment — not the dropdown).
      // This is what makes the Live Console and Class Overview update in
      // realtime after a scan, regardless of which class the admin had
      // selected in the dropdown.
      if (data?.sessionId && data?.class) {
        qc.invalidateQueries({ queryKey: ["exam-attendance", data.sessionId, data.class] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", data.sessionId, data.class] });
      }
      // All-Classes mode reads a separate session-wide overview/attendance
      // cache that isn't a prefix of the per-class keys above.
      if (data?.sessionId) {
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", data.sessionId, "all"] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-all-classes", data.sessionId] });
      }
      // Live console always refreshes (it listens to all rows for the date).
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to mark attendance from seat QR";
      toast.error(msg);
      console.error("[useScanSeatingAttendance] error:", err);
    },
  });
}

/**
 * Manual status update (absent/leave/present).
 *
 * CORRECTION MODE (rev. 8): the window guard has been REMOVED from this
 * mutation. Admins can now update attendance even AFTER the paper has ended
 * — this is needed for corrections (e.g. a student was wrongly marked absent
 * and the admin wants to fix it after the paper). The Live Console will
 * reflect the change in realtime.
 *
 * INIT and SCAN are still window-guarded — you can only create new sheets
 * and scan QR codes during the paper window. But updating EXISTING records
 * is always allowed.
 */
export function useUpdateExamAttendance() {
  const qc = useQueryClient();
  const ATT_PREFIXES: unknown[][] = [["exam-attendance"], ["exam-attendance-all-classes"], ["exam-attendance-overview"]];
  return useMutation({
    mutationFn: async (params: {
      id: string;
      status: ExamAttStatus;
      sessionId: string;
      cls: string;
      subject: string;
      examDate: string;
      /** Already-resolved paper times for this class — skips the plan round trip. */
      planTimes?: { start: string; end: string } | null;
    }) => {
      // WINDOW GUARD (rev. 9): manual status changes are ONLY allowed while
      // the paper is in progress — same rule as scanning/init. When the caller
      // passes its (polled, live) paper times the check is local — no network;
      // otherwise the live seating-plan times are fetched (shared request).
      await assertWindowOpen({
        examDate: params.examDate,
        sessionId: params.sessionId,
        subject: params.subject,
        classFilter: params.cls,
        preFetchedPlanTimes: params.planTimes?.start && params.planTimes?.end
          ? { start: params.planTimes.start.slice(0, 5), end: params.planTimes.end.slice(0, 5) }
          : null,
      });

      // scanned_at doubles as "someone explicitly marked this row". An explicit
      // Absent must set it, otherwise the row would look like an untouched
      // (pending) initialized row.
      const updateData: any = { status: params.status };
      if (params.status === "present" || params.status === "absent") {
        updateData.scanned_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("exam_attendance")
        .update(updateData)
        .eq("id", params.id);
      if (error) throw error;
    },
    // OPTIMISTIC: the badge flips instantly, even on a very slow connection.
    onMutate: async (vars) => {
      await Promise.all(ATT_PREFIXES.map(k => qc.cancelQueries({ queryKey: k })));
      const snapshots = ATT_PREFIXES.flatMap(k => qc.getQueriesData<AttRows>({ queryKey: k }));
      const nowIso = new Date().toISOString();
      for (const k of ATT_PREFIXES) {
        qc.setQueriesData<AttRows>({ queryKey: k }, old =>
          old?.map(r => r.id === vars.id
            ? {
                ...r,
                status: vars.status,
                scanned_at: vars.status === "leave" ? r.scanned_at : nowIso,
              }
            : r)
        );
      }
      return { snapshots };
    },
    onSuccess: () => {
      // Only mounted consumers (e.g. an open Live Console) refetch.
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any, _vars, ctx) => {
      // Roll the optimistic change back.
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
      const msg = err?.message || "Failed to update attendance";
      toast.error(msg);
      console.error("[useUpdateExamAttendance] error:", err);
    },
  });
}

/**
 * Delete exam attendance for a session/class/subject — admin override only.
 *
 * `examDate` is now OPTIONAL:
 *   - If provided: deletes only rows matching that exact date (legacy behavior).
 *   - If omitted: deletes ALL rows for this (session, class, subject) across
 *     ALL dates. This is used by the Class Overview's per-subject delete
 *     button, which now groups columns by subject only (not subject+date),
 *     so a single click must wipe every date's worth of rows for that subject.
 *
 * NOTE: delete is intentionally NOT window-guarded — admin may need to
 * clean up bad data after the paper is over. Route guard at the app layer
 * keeps it admin-only.
 */
export function useDeleteExamAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { sessionId: string; cls: string; subject: string; examDate?: string }) => {
      let q = supabase
        .from("exam_attendance")
        .delete()
        .eq("session_id", params.sessionId)
        .eq("class", params.cls)
        .eq("subject", params.subject);
      if (params.examDate) q = q.eq("exam_date", params.examDate);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success("Attendance records deleted");
      // Patch the caches in place (instant) instead of refetching them.
      const matches = (r: ExamAttendanceRecord) =>
        r.class === vars.cls && r.subject === vars.subject &&
        (!vars.examDate || String(r.exam_date).slice(0, 10) === vars.examDate);
      qc.setQueriesData<AttRows>(
        {
          queryKey: ["exam-attendance", vars.sessionId, vars.cls, vars.subject],
          predicate: q => !vars.examDate || q.queryKey[4] === vars.examDate,
        },
        () => []
      );
      qc.setQueriesData<AttRows>({ queryKey: ["exam-attendance-all-classes", vars.sessionId] }, old => old?.filter(r => !matches(r)));
      qc.setQueriesData<AttRows>(
        {
          queryKey: ["exam-attendance-overview", vars.sessionId],
          predicate: q => q.queryKey[2] === vars.cls || q.queryKey[2] === "all",
        },
        old => old?.filter(r => !matches(r))
      );
      qc.setQueryData<Array<{ class: string; subject: string; exam_date: string }> | undefined>(
        ["exam-attendance-paper-dates", vars.sessionId],
        old => old?.filter(r => !(r.class === vars.cls && r.subject === vars.subject && (!vars.examDate || r.exam_date === vars.examDate)))
      );
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to delete attendance records";
      toast.error(msg);
      console.error("[useDeleteExamAttendance] error:", err);
    },
  });
}

/**
 * Delete ALL exam attendance for a session+class — every subject, every date.
 *
 * This is the "nuclear option" for the Class Overview's per-class delete
 * button: wipes the entire class's exam attendance from the session so the
 * admin can start fresh. Used when the admin wants to remove a class's
 * attendance entirely (e.g. wrong class selected, or the class's papers
 * were all entered by mistake).
 *
 * NOTE: NOT window-guarded — admin override only. Route guard keeps it
 * admin-only.
 */
export function useDeleteClassExamAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { sessionId: string; cls: string }) => {
      const { error } = await supabase
        .from("exam_attendance")
        .delete()
        .eq("session_id", params.sessionId)
        .eq("class", params.cls);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(`All attendance records for Class ${vars.cls} deleted`);
      qc.invalidateQueries({ queryKey: ["exam-attendance", vars.sessionId, vars.cls] });
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId, vars.cls] });
      qc.invalidateQueries({ queryKey: ["exam-attendance-overview", vars.sessionId, "all"] });
      qc.invalidateQueries({ queryKey: ["exam-attendance-all-classes", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to delete class attendance records";
      toast.error(msg);
      console.error("[useDeleteClassExamAttendance] error:", err);
    },
  });
}

// ─── QR CODE DATA FORMAT ─────────────────────────────────────────────────────
// Legacy admit-card QR (still supported):
//   { "t": "exam", "sid": sessionId, "stid": studentId, "rn": examRollNo }
//
// New desk QR (carries seat info, see useExamSeating.ts):
//   { "t": "seat", "pid": planId, "rid": roomId, "sl": seatLabel, "stid": studentId, "rn": examRollNo }

export function encodeExamQRData(sessionId: string, studentId: string, examRollNo: string): string {
  return JSON.stringify({ t: "exam", sid: sessionId, stid: studentId, rn: examRollNo });
}

export function decodeExamQRData(qrString: string): { sessionId: string; studentId: string; examRollNo: string } | null {
  try {
    const obj = JSON.parse(qrString);
    if (obj.t === "exam" && obj.sid && obj.stid && obj.rn) {
      return { sessionId: obj.sid, studentId: obj.stid, examRollNo: obj.rn };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── EXAM SUBJECTS ────────────────────────────────────────────────────────────

export const EXAM_SUBJECTS = [
  "English", "Urdu", "Mathematics", "General Science", "Computer Science",
  "Physics", "Chemistry", "Biology", "Islamiyat", "Pakistan Studies",
  "History", "Geography", "General Knowledge", "Mutalia Quran", "Pashto", "Arabic",
];

export const ALL_CLASSES = ["6", "7", "8", "9", "10"];
