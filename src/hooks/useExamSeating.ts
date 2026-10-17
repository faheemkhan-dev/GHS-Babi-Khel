// src/hooks/useExamSeating.ts
// Exam Seating Plan Engine — auto-generate room-wise seating with anti-cheat
// class mixing. Each seat gets its own QR token so an invigilator scanning a
// desk marks attendance against that exact seat.
//
// Tables (see supabase/migrations/20260703000001_014_exam_seating_plan.sql):
//   exam_seating_plans        — one plan per (session + optional paper/date)
//   exam_seating_rooms        — physical room (capacity, rows × cols, blocked cells)
//   exam_seating_assignments  — one row per seat assignment
//
// QR format (this hook is the single source of truth):
//   {"t":"seat","pid":planId,"rid":roomId,"sl":seatLabel,"stid":studentId,"rn":examRollNo}

import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, supabasePublic } from "@/lib/supabase";
import toast from "react-hot-toast";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ClassPaperTime {
  subject: string;
  exam_date: string;   // "YYYY-MM-DD"
  start_time: string;  // "HH:MM"
  end_time: string;    // "HH:MM"
}

export interface SeatingPlan {
  id: string;
  session_id: string;
  title: string;
  paper_subject: string | null;
  exam_date: string | null;
  classes: string[];
  status: "draft" | "generated" | "published" | "archived";
  total_students: number;
  total_seated: number;
  generated_at: string | null;
  published_at: string | null;
  // Countdown-driven publish (added by migration 015):
  publish_at: string | null;
  countdown_label: string | null;
  // Paper timing for the Live Exam Console (added by migration 017):
  paper_start_at: string | null;
  paper_end_at: string | null;
  // ── PER-CLASS PAPER TIMES (added by migration 014_seating_per_class) ──
  // Multiple classes can share this plan's rooms but sit DIFFERENT papers
  // at DIFFERENT times on the same day (e.g. Class 6 Urdu 9-12 vs Class 10
  // Mutalia Quran 9-11). This map carries each class's own subject/date/
  // start/end, sourced from the Exam Date Sheet. paper_start_at/end_at
  // above remain as a plan-wide fallback for classes with no entry here,
  // and for plans created before this migration.
  class_paper_times: Record<string, ClassPaperTime>;
  // Recurring "All Papers" plan — reused across every paper via the Update
  // button instead of creating a fresh plan each time (added by migration 018):
  is_recurring: boolean;
  // ── RECURRING DATE RANGE (added by migration 019 — Problem 2 fix) ──
  // When both are set, the plan's paper times (paper_start_at /
  // paper_end_at TIME-OF-DAY portions) apply to EVERY day in the inclusive
  // range [exam_date_from, exam_date_to]. This lets the admin set up a
  // multi-day exam schedule once (e.g. "July 7 to July 14, 9 AM–12 PM
  // every day") and the Live Console + Exam Attendance automatically
  // treat each day in the range as a paper day — no manual daily update.
  // If either is null, the plan falls back to the single-day exam_date
  // behavior (legacy).
  exam_date_from: string | null;
  exam_date_to: string | null;
  // ── PLAN-WIDE EXAM STAFF (added by migration 020) ──
  // Overall roles for the whole seating plan (not tied to a single room).
  superintendent: string | null;
  deputy_superintendent: string | null;
  // ── DUTY TEXT for Superintendent / Deputy (added by migration 021) ──
  // Free-text description of what each role is responsible for, so the
  // printed staff sheet / desk maps show real duties, not just a name.
  // Defaults are applied client-side (see SUPERINTENDENT_DUTY /
  // DEPUTY_SUPERINTENDENT_DUTY below) when these are null, so nothing
  // breaks on a DB that hasn't run migration 021 yet.
  superintendent_duty: string | null;
  deputy_superintendent_duty: string | null;
  created_at: string;
}

export interface SeatingRoom {
  id: string;
  plan_id: string;
  name: string;
  capacity: number;
  rows: number;
  cols: number;
  block_layout: number[][]; // [[row,col],...]
  invigilator: string | null;
  // Full list of invigilators for this room (added by migration 020).
  // `invigilator` above is kept in sync as invigilators[0] for backward
  // compatibility with anything still reading the singular column.
  invigilators: string[];
  // ── PER-INVIGILATOR COLUMN DUTY (converted from row-based) ──
  // Splits the room's COLUMNS across invigilators[] so each one is
  // responsible for a specific, non-overlapping band of columns (1-indexed,
  // inclusive). Column-based duty is more accurate for exam halls because
  // invigilators walk down aisles (columns), not across rows.
  // Index-aligned with `invigilators` — duties[i] is invigilators[i]'s
  // column range. Empty/missing array (pre-migration DB, or a room that
  // hasn't been re-saved yet) means "not yet split" and the UI falls
  // back to auto-splitting columns evenly for display purposes only.
  invigilator_duties: { col_start: number; col_end: number }[];
  notes: string | null;
}

export interface SeatingAssignment {
  id: string;
  plan_id: string;
  room_id: string;
  student_id: string;
  student_name: string;
  class: string;
  class_roll_no: string;
  exam_roll_no: string;
  row_idx: number;
  col_idx: number;
  seat_label: string;
  qr_token: string;
  assigned_at: string;
}

export interface RoomWithAssignments extends SeatingRoom {
  assignments: SeatingAssignment[];
}

export interface SeatingPlanFull extends SeatingPlan {
  rooms: RoomWithAssignments[];
}

// ─── DUTY HELPERS ───────────────────────────────────────────────────────────

/**
 * Splits a room's COLUMNS (1..totalCols) as evenly as possible across N
 * invigilators, in order. Used both as the default when duties haven't been
 * explicitly set, and to re-flow ranges when the number of invigilators or
 * columns changes (e.g. adding a 2nd invigilator to an existing room).
 * Returns [] if there are no invigilators to split across.
 */
export function autoSplitColDuties(
  totalCols: number,
  invigilatorCount: number
): { col_start: number; col_end: number }[] {
  if (invigilatorCount <= 0 || totalCols <= 0) return [];
  const base = Math.floor(totalCols / invigilatorCount);
  const extra = totalCols % invigilatorCount; // first `extra` invigilators get one more column
  const out: { col_start: number; col_end: number }[] = [];
  let cursor = 1;
  for (let i = 0; i < invigilatorCount; i++) {
    const span = base + (i < extra ? 1 : 0);
    if (span <= 0) { out.push({ col_start: cursor, col_end: cursor - 1 }); continue; } // empty range (more invigilators than columns)
    out.push({ col_start: cursor, col_end: cursor + span - 1 });
    cursor += span;
  }
  return out;
}

/**
 * Resolves the effective column duty ranges for a room: uses explicitly-saved
 * `invigilator_duties` (col_start/col_end format) if present and the right
 * length, otherwise falls back to an even auto-split — so the UI always has
 * something sensible to show even before the admin has customized anything.
 * Old data with row_start/row_end is ignored (treated as needing auto-split).
 */
export function resolveColDuties(room: Pick<SeatingRoom, "cols" | "invigilators" | "invigilator_duties">) {
  const n = room.invigilators?.length ?? 0;
  if (room.invigilator_duties?.length === n && n > 0 && (room.invigilator_duties[0] as any)?.col_start != null) {
    return room.invigilator_duties as { col_start: number; col_end: number }[];
  }
  return autoSplitColDuties(room.cols, n);
}

// ─── DEFAULT DUTY DESCRIPTIONS ──────────────────────────────────────────────
// Standard responsibilities for each plan-wide role. Used as a fallback
// whenever superintendent_duty / deputy_superintendent_duty are null (i.e.
// the admin hasn't customized them, or the DB hasn't run migration 021 yet)
// so the printed staff sheet always shows meaningful duties, not a blank.
export const SUPERINTENDENT_DUTY =
  "Overall in-charge of the examination centre. Ensures exams are conducted fairly and smoothly. " +
  "Keeps question papers and answer books secure. Reports cheating cases to the Board.";
export const DEPUTY_SUPERINTENDENT_DUTY =
  "Assists the Superintendent in all exam arrangements. Supervises invigilators and exam rooms. " +
  "Helps maintain discipline and handles administrative work. Acts as Superintendent when required.";
export const INVIGILATOR_DUTY =
  "Supervises students inside the exam hall. Checks attendance and roll numbers. " +
  "Prevents cheating and maintains silence. Distributes and collects papers and answer books.";

// ─── QR CODE FORMAT ───────────────────────────────────────────────────────────

export interface SeatingQRData {
  planId: string;
  roomId: string;
  seatLabel: string;
  studentId: string;
  examRollNo: string;
}

export function encodeSeatingQRData(d: SeatingQRData): string {
  // Compact JSON keeps the QR small (faster scan, lower error-correction needs).
  return JSON.stringify({
    t: "seat",
    pid: d.planId,
    rid: d.roomId,
    sl: d.seatLabel,
    stid: d.studentId,
    rn: d.examRollNo,
  });
}

export function decodeSeatingQRData(qrString: string): SeatingQRData | null {
  try {
    const obj = JSON.parse(qrString);
    if (obj.t === "seat" && obj.pid && obj.rid && obj.sl && obj.stid && obj.rn) {
      return {
        planId: obj.pid,
        roomId: obj.rid,
        seatLabel: obj.sl,
        studentId: obj.stid,
        examRollNo: obj.rn,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── RECURRING DATE-RANGE HELPERS (Problem 2 fix) ────────────────────────────
// A plan can now have exam_date_from / exam_date_to (both date strings). When
// both are set, EVERY day in the inclusive range [from, to] is a paper day —
// the plan's paper_start_at / paper_end_at TIME-OF-DAY portions apply to each
// day. This lets the admin set up a multi-day exam schedule once and the Live
// Console + Exam Attendance automatically treat each day in the range as a
// paper day without manual daily updates.

/** Normalize any date-like string to "YYYY-MM-DD" (local). Returns "" if null. */
function normalizeDateStr(raw: string | null | undefined): string {
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
 * Derive the EFFECTIVE exam date for a plan, for use by the Live Console and
 * the Exam Attendance tab.
 *
 * Priority:
 *   1. If the plan has a date range [exam_date_from, exam_date_to] AND today
 *      falls within that range (inclusive), return TODAY. This is the
 *      recurring-multi-day case — every day in the range is a paper day.
 *   2. If the plan is recurring (is_recurring) AND paper_start_at is set,
 *      return the date portion of paper_start_at. (Legacy recurring behavior
 *      — paper_start_at is the live source of truth for "which day is the
 *      paper on".)
 *   3. Otherwise, return exam_date (single-day plan). May be null.
 *
 * This is the single function the Live Console should use to decide which
 * date's attendance to show. The Exam Attendance tab uses today's date
 * directly (the date picker is locked to today) and relies on
 * fetchPaperTimesFromSeatingPlan's date filter to match the plan.
 */
export function getEffectiveExamDate(plan: {
  exam_date?: string | null;
  paper_start_at?: string | null;
  is_recurring?: boolean;
  exam_date_from?: string | null;
  exam_date_to?: string | null;
}): string | null {
  const today = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  const from = normalizeDateStr(plan.exam_date_from);
  const to   = normalizeDateStr(plan.exam_date_to);
  if (from && to && today >= from && today <= to) {
    return today; // (1) recurring range — today is a paper day
  }
  if (plan.is_recurring && plan.paper_start_at) {
    return normalizeDateStr(plan.paper_start_at) || null; // (2) legacy recurring
  }
  return normalizeDateStr(plan.exam_date) || null; // (3) single-day
}

/**
 * Does this plan have an active recurring date range that includes today?
 * Used by the Live Console to decide whether to show "paper in progress"
 * countdowns using today's date.
 */
export function isPlanActiveToday(plan: {
  exam_date_from?: string | null;
  exam_date_to?: string | null;
  paper_start_at?: string | null;
  exam_date?: string | null;
}): boolean {
  const today = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const from = normalizeDateStr(plan.exam_date_from);
  const to   = normalizeDateStr(plan.exam_date_to);
  if (from && to && today >= from && today <= to) return true;
  if (normalizeDateStr(plan.paper_start_at) === today) return true;
  if (normalizeDateStr(plan.exam_date) === today) return true;
  return false;
}

// ─── PER-CLASS PAPER TIMING RESOLUTION ──────────────────────────────────────

/**
 * Resolve the EFFECTIVE paper timing for one specific class within a plan
 * that may mix multiple classes with different papers/times on the same day
 * (e.g. Class 6 Urdu 9:00–12:00 vs Class 10 Mutalia Quran 9:00–11:00, same
 * rooms, same day).
 *
 * Priority:
 *   1. `class_paper_times[cls]` — the per-class entry sourced from the Exam
 *      Date Sheet at plan creation. This is the accurate, per-class answer.
 *   2. Plan-wide `paper_subject` / `exam_date` / `paper_start_at` /
 *      `paper_end_at` — fallback for plans created before per-class timing
 *      existed, or if a class was added without a matching date-sheet entry.
 *
 * Returns null start/end if neither source has usable timing for this class.
 */
export function resolveClassPaperTime(
  plan: {
    class_paper_times?: Record<string, ClassPaperTime> | null;
    paper_subject?: string | null;
    exam_date?: string | null;
    paper_start_at?: string | null;
    paper_end_at?: string | null;
  },
  cls: string
): { subject: string | null; examDate: string | null; startTime: string | null; endTime: string | null } {
  const perClass = plan.class_paper_times?.[cls];
  if (perClass && perClass.start_time && perClass.end_time) {
    return {
      subject: perClass.subject || null,
      examDate: perClass.exam_date || null,
      startTime: perClass.start_time,
      endTime: perClass.end_time,
    };
  }
  // Fallback: plan-wide timing (legacy plans / classes with no date-sheet entry).
  if (plan.paper_start_at && plan.paper_end_at) {
    const startD = new Date(plan.paper_start_at);
    const endD = new Date(plan.paper_end_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      subject: plan.paper_subject || null,
      examDate: normalizeDateStr(plan.paper_start_at) || normalizeDateStr(plan.exam_date) || null,
      startTime: `${pad(startD.getHours())}:${pad(startD.getMinutes())}`,
      endTime: `${pad(endD.getHours())}:${pad(endD.getMinutes())}`,
    };
  }
  return { subject: plan.paper_subject || null, examDate: normalizeDateStr(plan.exam_date) || null, startTime: null, endTime: null };
}

/**
 * List every distinct paper time in a plan (one entry per class that has
 * its own timing, deduplicated by identical subject+start+end so classes
 * sharing the same paper show once). Used to render a per-class timing
 * strip on the Live Console / 3D Hall instead of a single shared clock.
 */
export function listPlanPaperTimes(
  plan: {
    classes: string[];
    class_paper_times?: Record<string, ClassPaperTime> | null;
    paper_subject?: string | null;
    exam_date?: string | null;
    paper_start_at?: string | null;
    paper_end_at?: string | null;
  }
): { classes: string[]; subject: string | null; startTime: string | null; endTime: string | null }[] {
  const groups = new Map<string, { classes: string[]; subject: string | null; startTime: string | null; endTime: string | null }>();
  for (const cls of plan.classes || []) {
    const t = resolveClassPaperTime(plan, cls);
    const key = `${t.subject || ""}|${t.startTime || ""}|${t.endTime || ""}`;
    const existing = groups.get(key);
    if (existing) existing.classes.push(cls);
    else groups.set(key, { classes: [cls], subject: t.subject, startTime: t.startTime, endTime: t.endTime });
  }
  return Array.from(groups.values());
}

// ─── LIVE DATE-SHEET RESOLUTION (Console/3D-Hall accuracy fix) ──────────────
// PROBLEM this section fixes:
//   `class_paper_times` on a seating plan is a ONE-TIME SNAPSHOT copied from
//   the Exam Date Sheet at plan-creation time (see AdminExamSeating.tsx's
//   handleCreate). It never gets refreshed afterwards. So once the admin
//   edits the Date Sheet later — e.g. adds tomorrow's papers, or a class's
//   date sheet entry changes — the seating plan (and everything reading its
//   class_paper_times: the Live Console, the 3D Hall, and Exam Attendance)
//   keeps showing the OLD frozen subject/date/time forever, and can even
//   claim a paper is "in progress today" when the Date Sheet has no paper
//   for that class on that date at all.
//
// FIX: this resolver re-reads the LIVE Exam Date Sheet (`dateSheetEntries`,
// from useAllExamSchedule()) every time it runs, matched by class + year +
// exam term — exactly the same matching AdminExamSeating.tsx already uses
// to build the snapshot in the first place. It returns, per class, the
// Date Sheet's entry for TODAY if one exists, else null (no fabricated
// "still running" state). The frozen class_paper_times / paper_start_at /
// paper_end_at on the plan are used ONLY as a last-resort fallback, for
// classes that have no matching Date Sheet data at all (e.g. legacy plans
// created before the Date Sheet existed) — never to override live data.

export interface LiveClassPaperTime {
  subject: string | null;
  examDate: string | null;   // "YYYY-MM-DD" — the ACTUAL date this paper is on
  startTime: string | null;  // "HH:MM"
  endTime: string | null;
  /** True only when this came from a live, matching Date Sheet row for TODAY. */
  isToday: boolean;
  /** True when there is genuinely no paper for this class today (free day). */
  noExamToday: boolean;
}

type MinimalDateSheetEntry = {
  class: string;
  exam_type: string;
  year: number;
  subject: string;
  exam_date: string;         // "YYYY-MM-DD"
  start_time: string | null;
  end_time: string | null;
};

type MinimalSession = { exam_year: number; exam_term: string } | null | undefined;

/** Same loose ordinal-aware matching AdminExamSeating.tsx uses ("1st Semester" ~ "Annual-I" etc. by position). */
function examTermMatchesLive(examType: string, term: string): boolean {
  const termOrdinal = (s: string): number | null => {
    if (/1st|first|annual-i\b/i.test(s)) return 1;
    if (/2nd|second|annual-ii\b/i.test(s)) return 2;
    return null;
  };
  const a = (examType || "").trim().toLowerCase();
  const b = (term || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const oa = termOrdinal(a);
  const ob = termOrdinal(b);
  return oa !== null && oa === ob;
}

function todayDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the LIVE, current-as-of-right-now paper timing for one class,
 * reading directly from the Exam Date Sheet instead of the plan's frozen
 * snapshot. This is the function the Live Console / 3D Hall should call
 * instead of resolveClassPaperTime for anything date/countdown related.
 */
export function resolveLiveClassPaperTime(
  cls: string,
  session: MinimalSession,
  dateSheetEntries: MinimalDateSheetEntry[],
  plan?: {
    class_paper_times?: Record<string, ClassPaperTime> | null;
    paper_subject?: string | null;
    exam_date?: string | null;
    paper_start_at?: string | null;
    paper_end_at?: string | null;
  }
): LiveClassPaperTime {
  const today = todayDateStr();

  if (session) {
    const entriesForClass = dateSheetEntries.filter(
      e => e.class === cls && e.year === session.exam_year && examTermMatchesLive(e.exam_type, session.exam_term)
    );
    if (entriesForClass.length > 0) {
      const todayEntry = entriesForClass.find(e => e.exam_date === today);
      if (todayEntry) {
        return {
          subject: todayEntry.subject,
          examDate: todayEntry.exam_date,
          startTime: todayEntry.start_time,
          endTime: todayEntry.end_time,
          isToday: true,
          noExamToday: false,
        };
      }
      // The Date Sheet HAS entries for this class/term — so it is the
      // authoritative source — but none of them is dated today. That means
      // today is genuinely a free/off day for this class. Do NOT fall back
      // to the stale plan snapshot in this case; that was the bug.
      return { subject: null, examDate: null, startTime: null, endTime: null, isToday: false, noExamToday: true };
    }
  }

  // No live Date Sheet data at all for this class/term (legacy plan, or
  // Date Sheet not filled in yet) — fall back to the plan's own snapshot
  // so old plans don't break.
  if (plan) {
    const fallback = resolveClassPaperTime(plan, cls);
    const fallbackIsToday = fallback.examDate === today;
    return {
      subject: fallback.subject,
      examDate: fallback.examDate,
      startTime: fallback.startTime,
      endTime: fallback.endTime,
      isToday: fallbackIsToday,
      noExamToday: false,
    };
  }

  return { subject: null, examDate: null, startTime: null, endTime: null, isToday: false, noExamToday: true };
}

/**
 * List every distinct LIVE paper time for TODAY across a plan's classes,
 * reading straight from the Date Sheet (see resolveLiveClassPaperTime).
 * Classes with no paper today are simply excluded — they don't produce a
 * phantom "in progress" entry. Replaces listPlanPaperTimes for anything
 * that needs to reflect the current real-world Date Sheet state (Console,
 * 3D Hall). Grouped by identical subject+start+end so classes sharing the
 * same paper show once.
 */
export function listLivePlanPaperTimesToday(
  plan: {
    classes: string[];
    class_paper_times?: Record<string, ClassPaperTime> | null;
    paper_subject?: string | null;
    exam_date?: string | null;
    paper_start_at?: string | null;
    paper_end_at?: string | null;
  },
  session: MinimalSession,
  dateSheetEntries: MinimalDateSheetEntry[]
): { classes: string[]; subject: string | null; startTime: string | null; endTime: string | null }[] {
  const groups = new Map<string, { classes: string[]; subject: string | null; startTime: string | null; endTime: string | null }>();
  for (const cls of plan.classes || []) {
    const t = resolveLiveClassPaperTime(cls, session, dateSheetEntries, plan);
    if (!t.isToday || !t.startTime || !t.endTime) continue; // no paper today for this class — skip, don't fabricate
    const key = `${t.subject || ""}|${t.startTime || ""}|${t.endTime || ""}`;
    const existing = groups.get(key);
    if (existing) existing.classes.push(cls);
    else groups.set(key, { classes: [cls], subject: t.subject, startTime: t.startTime, endTime: t.endTime });
  }
  return Array.from(groups.values());
}

/**
 * Does this plan have ANY class with a real Date Sheet paper today? This is
 * the correct replacement for isPlanActiveToday's date-range check, which
 * only asked "is today inside [exam_date_from, exam_date_to]" — true even
 * on days the Date Sheet has no actual paper (e.g. gaps between exams).
 */
export function planHasLivePaperToday(
  plan: { classes: string[] },
  session: MinimalSession,
  dateSheetEntries: MinimalDateSheetEntry[]
): boolean {
  return listLivePlanPaperTimesToday(plan, session, dateSheetEntries).length > 0;
}


// Goal: place students into rooms such that:
//   1. Students are seated in the same round-robin CLASS SEQUENCE that was
//      used when exam roll numbers were generated (e.g. class 10 → class 9
//      → class 8 → class 7 → class 6 → class 10 → ...). This sequence is
//      derived directly from the roll numbers themselves (whichever class's
//      student got the lowest roll number goes first, etc.), so it always
//      matches Exam Roll Numbers exactly.
//   2. No two students of the same class are orthogonally adjacent
//      (front/back/left/right). Diagonal adjacency is OK.
//      → After placing in sequence order, if a same-class adjacency WOULD
//        occur, the algorithm swaps forward to the next eligible student of
//        a different class. This is the anti-cheat layer.
//   3. "Update Seating" shuffles WHICH student from each class sits in that
//      class's turn (like Update on Exam Roll Numbers), while "Auto-Generate"
//      (first time) keeps each class's students in their existing roll-no
//      order. Either way, the class SEQUENCE itself (10th, 9th, 8th, 7th,
//      6th, ...) never changes — only the individual student per class-turn
//      can change.
//
// Strategy:
//  1. Sort ALL students by exam_roll_no once, and record the order in which
//     each class first appears — that's the round-robin class sequence.
//  2. Group students by class. In Update mode, shuffle each class's group
//     randomly; in canonical mode, leave each class's group in roll-no order.
//  3. Re-interleave round-robin, following the class sequence from step 1 —
//     this is what keeps "10th, 9th, 8th, 7th, 6th, ..." intact either way.
//  4. Build a flat list of seatable desk positions across all rooms, in snake
//     (boustrophedon) row-major order.
//  5. Walk the desk list, placing one student at a time from the interleaved
//     list. After each placement, if the just-placed student would create a
//     same-class adjacency with an already-filled neighbour, swap forward to
//     the next eligible student of a different class.
//  6. If we run out of swap candidates (rare — e.g. one class hugely
//     outnumbers the others), place anyway and flag the seat as
//     "adjacency_conflict" so the admin UI can warn the user.
//
// The function returns assignments keyed by room, ready to bulk-insert.

export interface DeskPosition {
  roomId: string;
  roomName: string;
  row: number;
  col: number;
  seatLabel: string;
}

export interface SeatingResult {
  assignments: Array<{
    desk: DeskPosition;
    student_id: string;
    student_name: string;
    class: string;
    class_roll_no: string;
    exam_roll_no: string;
    qr_token: string;
    adjacency_conflict: boolean;
  }>;
  conflicts: number;
  unassigned: Array<{ student_id: string; student_name: string; class: string }>;
}

/** Options for generateSeating. */
export interface GenerateSeatingOptions {
  /**
   * If true, randomly shuffle students WITHIN each class before
   * interleaving — used by "Update Seating" so a different student from
   * each class lands in that class's turn each time, while the class
   * SEQUENCE (which class goes 1st/2nd/3rd/...) stays exactly the same.
   * false (default) = canonical order (first Auto-Generate): each class's
   * students appear in their existing exam-roll-no order.
   */
  shuffleWithinClass?: boolean;
}

/**
 * Compute seatable desk positions for a list of rooms (respecting block_layout).
 * Desks are ordered room-by-room, in snake (boustrophedon) row-major order:
 * row 0 left→right, row 1 right→left, etc. This matches how exam halls are
 * physically walked and ensures "adjacent" in the array = physically adjacent
 * along the same row.
 */
export function computeSeatableDesks(rooms: SeatingRoom[]): DeskPosition[] {
  const desks: DeskPosition[] = [];
  for (const room of rooms) {
    const blocked = new Set(
      (room.block_layout || []).map(([r, c]) => `${r}:${c}`)
    );
    for (let r = 0; r < room.rows; r++) {
      const cols = [];
      for (let c = 0; c < room.cols; c++) {
        if (!blocked.has(`${r}:${c}`)) cols.push(c);
      }
      // snake: even rows L→R, odd rows R→L
      if (r % 2 === 1) cols.reverse();
      for (const c of cols) {
        desks.push({
          roomId: room.id,
          roomName: room.name,
          row: r,
          col: c,
          seatLabel: `${room.name}-R${r + 1}-S${c + 1}`,
        });
      }
    }
  }
  return desks;
}

/**
 * Run the full seating algorithm.
 *
 * @param students   flat list of students to seat (must already be filtered to
 *                   the plan's classes + exam session).
 * @param rooms      rooms with grid + block_layout already configured.
 * @param options    optional: shuffleWithinClass for Update Seating mode.
 *
 * rev. 3 (class-sequence fix):
 *   - The round-robin class SEQUENCE (10th, 9th, 8th, 7th, 6th, ...) is
 *     derived from the exam roll numbers themselves and is always
 *     preserved, both on first Auto-Generate and on every Update.
 *   - The anti-cheat swap-forward logic is PRESERVED — same-class orthogonal
 *     adjacency is still prevented by swapping to the next eligible student.
 *   - shuffleWithinClass lets "Update Seating" swap WHICH student from each
 *     class sits in that class's turn, without disturbing the sequence.
 */
export function generateSeating(
  students: Array<{ student_id: string; student_name: string; class: string; class_roll_no: string; exam_roll_no: string }>,
  rooms: SeatingRoom[],
  options?: GenerateSeatingOptions
): SeatingResult {
  const desks = computeSeatableDesks(rooms);

  // ── STEP 1: Determine class sequence + group students by class ───────
  // The "sequence" (which class's turn comes 1st/2nd/3rd/...) is derived
  // from the ORIGINAL exam-roll-number order the admin already set when
  // generating roll numbers (e.g. class 10 → 434728, class 9 → 434729,
  // class 8 → 434730, class 7 → 434731, class 6 → 434732, then back to
  // class 10 → 434733, ...). We recover that per-class turn order by
  // sorting all students by exam_roll_no once, then recording the order
  // in which each class FIRST appears — that's the round-robin sequence.
  const allSortedByRoll = [...students].sort((a, b) => {
    const na = parseInt(a.exam_roll_no, 10) || 0;
    const nb = parseInt(b.exam_roll_no, 10) || 0;
    if (na !== nb) return na - nb;
    return a.exam_roll_no.localeCompare(b.exam_roll_no);
  });
  const classSequence: string[] = [];
  const seenClasses = new Set<string>();
  for (const s of allSortedByRoll) {
    if (!seenClasses.has(s.class)) { seenClasses.add(s.class); classSequence.push(s.class); }
  }
  const studentsByClass = new Map<string, typeof students>();
  for (const cls of classSequence) {
    studentsByClass.set(cls, allSortedByRoll.filter(s => s.class === cls));
  }

  // ── STEP 2: Shuffle mode (Update Seating) vs canonical mode (Auto-Generate) ──
  // Auto-Generate (first time): each class's students stay in their
  // existing roll-no order (which is itself class-roll-no order, since
  // that's how exam roll numbers were assigned).
  // Update Seating: each class's student LIST is randomly shuffled —
  // students trade seats within their own class — while the class
  // SEQUENCE (10th's turn, then 9th's turn, then 8th's, ...) never changes.
  // This mirrors the same "shuffle within class, keep sequence" behaviour
  // used for Update on the Exam Roll Numbers page.
  const shuffle = options?.shuffleWithinClass ?? false;
  if (shuffle) {
    for (const cls of classSequence) {
      const list = studentsByClass.get(cls)!;
      const shuffled = [...list];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      studentsByClass.set(cls, shuffled);
    }
  }

  // ── STEP 3: Re-interleave round-robin, following classSequence ────────
  // One student per class per round, in classSequence order — this is what
  // preserves "10th, 9th, 8th, 7th, 6th, 10th, 9th, ..." regardless of
  // whether we're in canonical or shuffled mode.
  const orderedStudents: typeof students = [];
  const maxLen = Math.max(0, ...classSequence.map(cls => studentsByClass.get(cls)!.length));
  for (let round = 0; round < maxLen; round++) {
    for (const cls of classSequence) {
      const student = studentsByClass.get(cls)![round];
      if (student) orderedStudents.push(student);
    }
  }

  // Build a 2D neighbour-lookup so we can detect same-class adjacency.
  // Key: `${roomId}:${row}:${col}` → assignment.
  const placedMap = new Map<string, SeatingResult["assignments"][number]>();
  const assignments: SeatingResult["assignments"] = [];
  const unassigned: SeatingResult["unassigned"] = [];

  // Helper: orthogonal neighbours of a desk position (in the SAME room).
  const neighbours = (d: DeskPosition): Array<SeatingResult["assignments"][number] | null> => {
    const key = (r: number, c: number) => `${d.roomId}:${r}:${c}`;
    return [
      placedMap.get(key(d.row - 1, d.col)) ?? null,
      placedMap.get(key(d.row + 1, d.col)) ?? null,
      placedMap.get(key(d.row, d.col - 1)) ?? null,
      placedMap.get(key(d.row, d.col + 1)) ?? null,
    ];
  };

  // We use a working list of remaining students so we can swap forward.
  const remaining = [...orderedStudents];
  let conflicts = 0;

  // ── STEP 3b: Interleave desks ACROSS rooms (round-robin) ──────────────
  // computeSeatableDesks() returns desks grouped room-by-room (all of room
  // 1's desks, then all of room 2's, ...). If we walked that flat order
  // directly, room 1 would fill up completely before room 2 ever got a
  // student. Instead, take one desk from each room in turn (in each
  // room's own internal snake order) so students spread evenly across
  // however many rooms exist — e.g. 9 students / 3 rooms → 3 each.
  const desksByRoom = new Map<string, DeskPosition[]>();
  for (const d of desks) {
    if (!desksByRoom.has(d.roomId)) desksByRoom.set(d.roomId, []);
    desksByRoom.get(d.roomId)!.push(d);
  }
  const roomIdsInOrder = [...new Set(desks.map(d => d.roomId))];
  const roomCursor = new Map<string, number>(roomIdsInOrder.map(id => [id, 0]));
  const interleavedDesks: DeskPosition[] = [];
  let anyLeft = true;
  while (anyLeft) {
    anyLeft = false;
    for (const roomId of roomIdsInOrder) {
      const list = desksByRoom.get(roomId)!;
      const idx = roomCursor.get(roomId)!;
      if (idx < list.length) {
        interleavedDesks.push(list[idx]);
        roomCursor.set(roomId, idx + 1);
        if (idx + 1 < list.length) anyLeft = true;
      }
    }
  }

  for (const desk of interleavedDesks) {
    if (remaining.length === 0) break;

    // Try to find a student whose class doesn't collide with any neighbour.
    // Start from the head of the list (preserves roll-no order as much as
    // possible) and scan forward for the first non-conflicting student.
    let pickedIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const adj = neighbours(desk);
      const collides = adj.some(a => a && a.class === candidate.class);
      if (!collides) { pickedIdx = i; break; }
    }
    // If none found, take the head anyway and flag a conflict.
    let conflict = false;
    if (pickedIdx === -1) {
      pickedIdx = 0;
      conflict = true;
      conflicts++;
    }
    const student = remaining.splice(pickedIdx, 1)[0];
    const assignment = {
      desk,
      student_id: student.student_id,
      student_name: student.student_name,
      class: student.class,
      class_roll_no: student.class_roll_no,
      exam_roll_no: student.exam_roll_no,
      qr_token: makeQrToken(),
      adjacency_conflict: conflict,
    };
    assignments.push(assignment);
    placedMap.set(`${desk.roomId}:${desk.row}:${desk.col}`, assignment);
  }

  // Anyone we couldn't fit (capacity < students) goes into unassigned.
  for (const s of remaining) {
    unassigned.push({ student_id: s.student_id, student_name: s.student_name, class: s.class });
  }

  // ── STEP 4: Auto-repair pass ───────────────────────────────────────────
  // The placement loop above can still leave a small number of flagged
  // conflicts (typically near the end of a room, when every remaining
  // candidate happens to share a class with an already-seated neighbour).
  // Rather than leaving those for the admin to fix by hand, try to swap
  // each conflicting student with ANOTHER already-seated student (any
  // class) elsewhere in the grid, but only if the swap doesn't introduce
  // a NEW conflict at either seat. This never changes anyone's class or
  // the 10th/9th/8th/... sequence — it only repositions who sits where.
  const deskKey = (roomId: string, row: number, col: number) => `${roomId}:${row}:${col}`;
  const neighboursOf = (a: SeatingResult["assignments"][number]) => {
    const { roomId, row, col } = a.desk;
    return [
      placedMap.get(deskKey(roomId, row - 1, col)) ?? null,
      placedMap.get(deskKey(roomId, row + 1, col)) ?? null,
      placedMap.get(deskKey(roomId, row, col - 1)) ?? null,
      placedMap.get(deskKey(roomId, row, col + 1)) ?? null,
    ];
  };

  let stillConflicted = assignments.filter(a => a.adjacency_conflict);
  let guard = 0;
  while (stillConflicted.length > 0 && guard < assignments.length * 2) {
    guard++;
    const a = stillConflicted[0];
    let swapped = false;

    for (const b of assignments) {
      if (b === a || b.class === a.class) continue;

      const aDesk = a.desk; // a's current desk (before swap)
      const bDesk = b.desk; // b's current desk (before swap)

      // Actually perform the swap on both the map AND the .desk fields
      // first, so neighbour look-ups reflect the NEW positions correctly.
      placedMap.set(deskKey(aDesk.roomId, aDesk.row, aDesk.col), b);
      placedMap.set(deskKey(bDesk.roomId, bDesk.row, bDesk.col), a);
      a.desk = bDesk;
      b.desk = aDesk;

      // Now check: does EITHER student conflict with their NEW neighbours?
      const aWouldConflict = neighboursOf(a).some(n => n && n !== a && n.class === a.class);
      const bWouldConflict = neighboursOf(b).some(n => n && n !== b && n.class === b.class);

      if (!aWouldConflict && !bWouldConflict) {
        // Keep the swap — it resolves a's conflict without creating a new one.
        a.adjacency_conflict = false;
        b.adjacency_conflict = false;
        conflicts--;
        swapped = true;
        break;
      }

      // Revert: put both back to their original desks.
      a.desk = aDesk;
      b.desk = bDesk;
      placedMap.set(deskKey(aDesk.roomId, aDesk.row, aDesk.col), a);
      placedMap.set(deskKey(bDesk.roomId, bDesk.row, bDesk.col), b);
    }

    if (!swapped) {
      // Couldn't resolve this one automatically (rare edge case) —
      // leave it flagged for the admin to review manually.
      stillConflicted.shift();
    } else {
      stillConflicted = assignments.filter(a2 => a2.adjacency_conflict);
    }
  }

  return { assignments, conflicts, unassigned };
}

// Cryptographically-acceptable URL-safe token (no external dep).
function makeQrToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── HOOKS ────────────────────────────────────────────────────────────────────

/** All seating plans for a session. */
export function useSeatingPlans(sessionId: string | undefined) {
  return useQuery<SeatingPlan[]>({
    queryKey: ["seating-plans", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase
        .from("exam_seating_plans")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sessionId,
    staleTime: 60 * 1000,
  });
}

/** One full plan (with rooms + assignments). */
export function useSeatingPlan(planId: string | undefined) {
  return useQuery<SeatingPlanFull | null>({
    queryKey: ["seating-plan", planId],
    queryFn: async () => {
      if (!planId) return null;

      // These three queries don't depend on each other's results — only on
      // planId, which we already have — so fetch them in parallel instead of
      // one-after-another. Same data, same error handling, just faster.
      const [planRes, roomsRes, assignsRes] = await Promise.all([
        supabase.from("exam_seating_plans").select("*").eq("id", planId).single(),
        supabase.from("exam_seating_rooms").select("*").eq("plan_id", planId).order("created_at", { ascending: true }),
        supabase.from("exam_seating_assignments").select("*").eq("plan_id", planId).order("seat_label", { ascending: true }),
      ]);

      const { data: plan, error: e1 } = planRes;
      if (e1) throw e1;
      if (!plan) return null;

      const { data: rooms, error: e2 } = roomsRes;
      if (e2) throw e2;

      const { data: assigns, error: e3 } = assignsRes;
      if (e3) throw e3;

      const roomsWithAssigns: RoomWithAssignments[] = (rooms ?? []).map(r => {
        const invigilators = Array.isArray((r as any).invigilators) && (r as any).invigilators.length > 0
          ? (r as any).invigilators
          : (r.invigilator ? [r.invigilator] : []);
        // Normalize `invigilator_duties`: use saved col_start/col_end ranges
        // if present and matching the invigilator count, otherwise fall back
        // to an even auto-split of columns. Old data with row_start/row_end
        // is auto-split (treated as needing conversion).
        const savedDuties = (r as any).invigilator_duties;
        const hasColShape = Array.isArray(savedDuties) && savedDuties.length > 0 && (savedDuties[0] as any)?.col_start != null;
        const invigilator_duties = hasColShape && savedDuties.length === invigilators.length
          ? savedDuties
          : autoSplitColDuties(r.cols, invigilators.length);
        return {
          ...r,
          invigilators,
          invigilator_duties,
          assignments: (assigns ?? []).filter(a => a.room_id === r.id),
        };
      });

      return { ...plan, rooms: roomsWithAssigns } as SeatingPlanFull;
    },
    enabled: !!planId,
    staleTime: 30 * 1000,
  });
}

/** Create a new (empty) seating plan tied to an exam session. */
export function useCreateSeatingPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      title: string;
      classes: string[];
      paperSubject?: string | null;
      examDate?: string | null;
      paperStartAt?: string | null;
      paperEndAt?: string | null;
      isRecurring?: boolean;
      // New (Problem 2 fix): optional recurring date range.
      examDateFrom?: string | null;
      examDateTo?: string | null;
      // New (per-class paper times): each selected class's own
      // subject/date/start/end, sourced from the Exam Date Sheet. Lets
      // classes mixed into the same rooms sit different papers at
      // different times on the same day.
      classPaperTimes?: Record<string, ClassPaperTime>;
    }) => {
      const insertPayload: Record<string, unknown> = {
        session_id: params.sessionId,
        title: params.title,
        classes: params.classes,
        paper_subject: params.paperSubject ?? null,
        exam_date: params.examDate ?? null,
        paper_start_at: params.paperStartAt ?? null,
        paper_end_at: params.paperEndAt ?? null,
        is_recurring: params.isRecurring ?? false,
        status: "draft",
      };
      // Only include the new columns if the caller provided values — this
      // keeps the insert backward-compatible with DBs that don't have the
      // columns yet (PostgREST rejects unknown columns in inserts too).
      if (params.examDateFrom !== undefined) insertPayload.exam_date_from = params.examDateFrom ?? null;
      if (params.examDateTo !== undefined)   insertPayload.exam_date_to   = params.examDateTo ?? null;
      if (params.classPaperTimes !== undefined) insertPayload.class_paper_times = params.classPaperTimes ?? {};

      let { data, error } = await supabase
        .from("exam_seating_plans")
        .insert(insertPayload)
        .select()
        .single();
      // Fallback for DBs that haven't run migration 014_seating_per_class
      // yet — retry without class_paper_times so plan creation still works.
      if (error && /class_paper_times|Could not find|column/i.test(error.message || "") && "class_paper_times" in insertPayload) {
        delete insertPayload.class_paper_times;
        const retry = await supabase
          .from("exam_seating_plans")
          .insert(insertPayload)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;
      return data as SeatingPlan;
    },
    onSuccess: (_d, vars) => {
      toast.success("Seating plan created — add rooms next");
      qc.invalidateQueries({ queryKey: ["seating-plans", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["seating-plans-all"] });
    },
  });
}

/**
 * Set the plan-wide Superintendent / Deputy Superintendent (added by
 * migration 020). These are overall exam-seating roles for the whole plan,
 * separate from per-room invigilators. Falls back gracefully — like
 * useUpdatePaperTimes — if the DB hasn't run migration 020 yet, so the rest
 * of the seating flow (rooms, generation, publishing) is never blocked by
 * this being unavailable.
 */
export function useUpdateSeatingPlanStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      planId: string;
      sessionId: string;
      superintendent: string | null;
      deputySuperintendent: string | null;
      superintendentDuty?: string | null;
      deputySuperintendentDuty?: string | null;
    }) => {
      const basePayload = {
        superintendent: params.superintendent || null,
        deputy_superintendent: params.deputySuperintendent || null,
      };
      const payloadWithDuties = {
        ...basePayload,
        superintendent_duty: params.superintendentDuty || null,
        deputy_superintendent_duty: params.deputySuperintendentDuty || null,
      };

      let { error } = await supabase.from("exam_seating_plans").update(payloadWithDuties).eq("id", params.planId);
      if (error && /duty|Could not find|column/i.test(error.message || "")) {
        // DB hasn't run migration 021 yet — retry without the duty columns
        // so the name fields (which do exist) still save correctly.
        console.warn("[useUpdateSeatingPlanStaff] superintendent_duty/deputy_superintendent_duty columns missing — run migration 021 to enable custom duty text (defaults are still shown in the UI).");
        ({ error } = await supabase.from("exam_seating_plans").update(basePayload).eq("id", params.planId));
      }
      if (error) {
        if (/superintendent|Could not find|column/i.test(error.message || "")) {
          console.warn("[useUpdateSeatingPlanStaff] superintendent/deputy_superintendent columns missing — run migration 020 to enable this.");
          throw new Error("This feature needs a database update. Run migration 020 to enable Superintendent / Deputy Superintendent.");
        }
        throw error;
      }
    },
    onSuccess: (_d, vars) => {
      toast.success("Exam staff updated");
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
      qc.invalidateQueries({ queryKey: ["seating-plans", vars.sessionId] });
    },
    onError: (e: any) => {
      toast.error(e?.message || "Failed to update exam staff");
    },
  });
}

/** Delete an entire plan (rooms + assignments cascade). */
export function useDeleteSeatingPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { planId: string; sessionId: string }) => {
      const { error } = await supabase
        .from("exam_seating_plans")
        .delete()
        .eq("id", params.planId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success("Seating plan deleted");
      qc.invalidateQueries({ queryKey: ["seating-plans", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
    },
  });
}

/** Add a room to a plan. */
export function useUpsertRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      planId: string;
      room?: Partial<SeatingRoom> & { id?: string };
    }) => {
      // Recompute effective capacity = rows × cols − blocked.
      const rows = params.room?.rows ?? 6;
      const cols = params.room?.cols ?? 5;
      const blocked = params.room?.block_layout ?? [];
      const capacity = Math.max(0, rows * cols - blocked.length);

      // Multiple invigilators (added by migration 020): the caller passes
      // the full list in `invigilators`. We keep the legacy singular
      // `invigilator` column in sync as invigilators[0] so anything that
      // still reads only that column (old exports, old queries) keeps
      // working correctly.
      const invigilatorsList = (params.room?.invigilators ?? [])
        .map(s => (s ?? "").trim())
        .filter(Boolean);
      const legacyInvigilator = invigilatorsList[0] ?? (params.room?.invigilator ?? null);

      // Per-invigilator column duty: if the caller didn't pass explicit
      // ranges, or passed a mismatched count (e.g. an invigilator was just
      // added/removed), or passed old row_start format, auto-split evenly
      // so the saved data always stays in sync with the current invigilator list.
      const explicitDuties = params.room?.invigilator_duties ?? [];
      const hasColShape = explicitDuties.length > 0 && (explicitDuties[0] as any)?.col_start != null;
      const invigilatorDuties = hasColShape && explicitDuties.length === invigilatorsList.length && invigilatorsList.length > 0
        ? explicitDuties
        : autoSplitColDuties(cols, invigilatorsList.length);

      const basePayload = {
        plan_id: params.planId,
        name: params.room?.name ?? "New Room",
        rows,
        cols,
        capacity,
        block_layout: blocked,
        invigilator: legacyInvigilator || null,
        notes: params.room?.notes ?? null,
      };
      const payloadWithList = { ...basePayload, invigilators: invigilatorsList };
      const payloadWithDuties = { ...payloadWithList, invigilator_duties: invigilatorDuties };

      // Try with `invigilators` + `invigilator_duties` first; fall back one
      // column at a time if the DB hasn't run the relevant migration yet,
      // so room create/edit keeps working at whatever level the schema
      // currently supports.
      const runUpsert = async (payload: Record<string, unknown>) => {
        if (params.room?.id) {
          return supabase.from("exam_seating_rooms").update(payload).eq("id", params.room!.id).select().single();
        }
        return supabase.from("exam_seating_rooms").insert(payload).select().single();
      };

      let res = await runUpsert(payloadWithDuties);
      if (res.error && /invigilator_duties|Could not find|column/i.test(res.error.message || "")) {
        console.warn("[useUpsertRoom] `invigilator_duties` column missing — retrying without row-duty split. Run migration 021 to enable per-invigilator row assignment.");
        res = await runUpsert(payloadWithList);
      }
      if (res.error && /invigilators|Could not find|column/i.test(res.error.message || "")) {
        console.warn("[useUpsertRoom] `invigilators` column missing — retrying with legacy `invigilator` only. Run migration 020 to enable multiple invigilators per room.");
        res = await runUpsert(basePayload);
      }
      if (res.error) throw res.error;
      // Normalize the returned row so the UI always has `invigilators` and
      // `invigilator_duties` arrays to render, even on a pre-migration DB
      // that only returned the legacy singular column.
      const row = res.data as any;
      if (!Array.isArray(row.invigilators)) {
        row.invigilators = row.invigilator ? [row.invigilator] : [];
      }
      if (!Array.isArray(row.invigilator_duties) || (row.invigilator_duties[0] as any)?.col_start == null) {
        row.invigilator_duties = autoSplitColDuties(row.cols, row.invigilators.length);
      }
      return row as SeatingRoom;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.room?.id ? "Room updated" : "Room added");
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
    },
  });
}

/** Delete a room (its assignments are cascade-deleted). */
export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { planId: string; roomId: string }) => {
      const { error } = await supabase
        .from("exam_seating_rooms")
        .delete()
        .eq("id", params.roomId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success("Room deleted");
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
    },
  });
}

/**
 * Run the seating algorithm and persist assignments.
 * Caller passes the full student list (already filtered to the plan's classes)
 * and the current rooms. We compute locally, then bulk-insert.
 *
 * ── isUpdate parameter ────────────────────────────────────────────────────
 * When `isUpdate` is true (Update Seating button on an already-seated plan),
 * students are randomly shuffled WITHIN each class before interleaving, so a
 * different student from each class occupies that class's turn — while the
 * class SEQUENCE (10th, 9th, 8th, 7th, 6th, ...) stays exactly the same.
 * When `isUpdate` is false (first Auto-Generate), each class's students stay
 * in their existing roll-no order (the canonical arrangement).
 */
export function useGenerateSeating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      planId: string;
      sessionId: string;
      students: Array<{ student_id: string; student_name: string; class: string; class_roll_no: string; exam_roll_no: string }>;
      rooms: SeatingRoom[];
      /** If true, apply a random rotation so the arrangement differs from last time. */
      isUpdate?: boolean;
    }) => {
      // shuffleWithinClass: false for first Auto-Generate (canonical
      // roll-no order), true for Update Seating — this randomly shuffles
      // students WITHIN each class while the class sequence (10th, 9th,
      // 8th, 7th, 6th, ...) stays exactly the same every time.
      const result = generateSeating(params.students, params.rooms, { shuffleWithinClass: !!params.isUpdate });

      // Wipe old assignments for this plan, then insert new ones in one shot.
      const { error: delErr } = await supabase
        .from("exam_seating_assignments")
        .delete()
        .eq("plan_id", params.planId);
      if (delErr) throw delErr;

      if (result.assignments.length > 0) {
        const rows = result.assignments.map(a => ({
          plan_id: params.planId,
          room_id: a.desk.roomId,
          student_id: a.student_id,
          student_name: a.student_name,
          class: a.class,
          class_roll_no: a.class_roll_no,
          exam_roll_no: a.exam_roll_no,
          row_idx: a.desk.row,
          col_idx: a.desk.col,
          seat_label: a.desk.seatLabel,
          qr_token: a.qr_token,
        }));
        const { error: insErr } = await supabase
          .from("exam_seating_assignments")
          .insert(rows);
        if (insErr) throw insErr;
      }

      // Update plan totals + status.
      const { error: updErr } = await supabase
        .from("exam_seating_plans")
        .update({
          total_students: params.students.length,
          total_seated: result.assignments.length,
          generated_at: new Date().toISOString(),
          status: "generated",
        })
        .eq("id", params.planId);
      if (updErr) throw updErr;

      return result;
    },
    onSuccess: (result, vars) => {
      const action = vars.isUpdate ? "updated" : "generated";
      const msg =
        result.unassigned.length === 0
          ? `Seating ${action} · ${result.assignments.length} seats · ${result.conflicts} adjacency conflict${result.conflicts === 1 ? "" : "s"}`
          : `Seating ${action} · ${result.assignments.length} seated, ${result.unassigned.length} could not fit (capacity)`;
      if (result.conflicts > 0) toast(msg, { icon: "⚠️" });
      else toast.success(msg);
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
      qc.invalidateQueries({ queryKey: ["seating-plans", vars.sessionId] });
    },
  });
}

/**
 * Publish a plan — either immediately or scheduled with a countdown.
 *
 * - Immediate:  { mode: "now" }
 *     sets status='published', published_at=now(), publish_at=null
 * - Scheduled:  { mode: "schedule", publishAt, countdownLabel }
 *     sets publish_at=<future ISO>, countdown_label=<text>, status stays 'generated'
 *     The student-side tab watches publish_at and flips status to 'published'
 *     via useAutoPublishSeatingPlan() when the countdown reaches zero.
 */
export function usePublishSeatingPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      planId: string;
      sessionId: string;
      mode: "now" | "schedule";
      publishAt?: string;        // ISO — required when mode="schedule"
      countdownLabel?: string;   // optional custom label
    }) => {
      if (params.mode === "schedule" && !params.publishAt) {
        throw new Error("publishAt is required when mode='schedule'");
      }
      const payload = params.mode === "now"
        ? { status: "published" as const, published_at: new Date().toISOString(), publish_at: null, countdown_label: null }
        : { publish_at: params.publishAt, countdown_label: params.countdownLabel ?? null };
      const { error } = await supabase
        .from("exam_seating_plans")
        .update(payload)
        .eq("id", params.planId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.mode === "now"
          ? "Seating plan published — students can now see their seats"
          : "Seating plan scheduled — students will see a countdown"
      );
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
      qc.invalidateQueries({ queryKey: ["seating-plans", vars.sessionId] });
      qc.invalidateQueries({ queryKey: ["published-seating-plans"] });
    },
  });
}

/**
 * Auto-publish a plan whose countdown has expired.
 * Called by the student-side SeatingTab's CountdownTimer when publish_at < now.
 * Safe to call repeatedly — only flips rows where status is NOT already 'published'.
 */
export function useAutoPublishSeatingPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { planId: string }) => {
      const { error } = await supabase
        .from("exam_seating_plans")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", params.planId)
        .neq("status", "published");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["published-seating-plans"] });
    },
  });
}

// ─── STUDENT-SIDE: ALL PUBLISHED (OR SCHEDULED) PLANS ────────────────────────
// Used by the renamed "Exam Seating" student tab. Returns every plan the
// school has published (or scheduled with a countdown) along with all rooms
// and assignments — so the student can search for any classmate's seat, not
// just their own. The student's own seat is highlighted in the UI.
//
// ── FIX (2026-07-16): "Seating tab shows empty even though admin assigned" ──
// Previously this hook swallowed errors silently — React Query's default
// `data: []` masked the real failure (RLS denying SELECT on
// exam_seating_plans / _rooms / _assignments for authenticated students).
// The UI then rendered the "No Seating Plans Yet" empty state, which looked
// indistinguishable from a school that genuinely had no plans.
//
// Now we:
//   1. Console-error any Supabase failure with the table name + Postgres
//      error code so the admin can diagnose it from the browser devtools.
//   2. Retry once with `supabasePublic` if the authenticated client fails
//      — this is a graceful fallback for the case where the student's JWT
//      is stale/expired but the data itself is public-readable via RLS.
//   3. Throw the original error up to React Query so the SeatingTab can
//      render a "Couldn't load seating — tap to retry" state instead of the
//      misleading "No Seating Plans Yet" message.

export function usePublishedSeatingPlans() {
  return useQuery<SeatingPlanFull[]>({
    queryKey: ["published-seating-plans"],
    queryFn: async () => {
      // Pick the best client — fall back to the public (anon) client if the
      // authenticated one is missing a session. RLS policies on the seating
      // tables allow authenticated users to SELECT published plans; if we
      // ever loosen that to anon, this fallback will also cover unauthenticated
      // visitors (e.g. parents previewing the page before logging in).
      const fetchPlans = async (client: typeof supabase) => {
        const { data, error } = await client
          .from("exam_seating_plans")
          .select("*")
          .or("status.eq.published,publish_at.not.is.null")
          .order("created_at", { ascending: false });
        return { data, error };
      };

      let plansRes = await fetchPlans(supabase);
      // If the authed client errored AND we have a public client, retry once.
      // Common cause: refresh token expired mid-session, but anon RLS still
      // allows the read.
      if (plansRes.error && supabasePublic !== supabase) {
        console.warn(
          "[usePublishedSeatingPlans] authed client failed, retrying with public client:",
          plansRes.error.message
        );
        plansRes = await fetchPlans(supabasePublic);
      }
      if (plansRes.error) {
        console.error(
          "[usePublishedSeatingPlans] Supabase error on exam_seating_plans:",
          plansRes.error.code,
          plansRes.error.message,
          "\nThis usually means RLS is blocking the SELECT. Run migration",
          "022_exam_seating_student_rls.sql to add the student read policy."
        );
        throw plansRes.error;
      }
      const plans = plansRes.data ?? [];
      if (plans.length === 0) return [];

      const planIds = plans.map(p => p.id);

      const fetchChildren = async (client: typeof supabase) => {
        const [roomsR, assignsR] = await Promise.all([
          client
            .from("exam_seating_rooms")
            .select("*")
            .in("plan_id", planIds)
            .order("created_at", { ascending: true }),
          client
            .from("exam_seating_assignments")
            .select("*")
            .in("plan_id", planIds)
            .order("seat_label", { ascending: true }),
        ]);
        return { roomsR, assignsR };
      };

      let children = await fetchChildren(supabase);
      const childErrored = children.roomsR.error || children.assignsR.error;
      if (childErrored && supabasePublic !== supabase) {
        console.warn(
          "[usePublishedSeatingPlans] authed child fetch failed, retrying with public client."
        );
        children = await fetchChildren(supabasePublic);
      }
      if (children.roomsR.error) {
        console.error(
          "[usePublishedSeatingPlans] Supabase error on exam_seating_rooms:",
          children.roomsR.error.code,
          children.roomsR.error.message
        );
        throw children.roomsR.error;
      }
      if (children.assignsR.error) {
        console.error(
          "[usePublishedSeatingPlans] Supabase error on exam_seating_assignments:",
          children.assignsR.error.code,
          children.assignsR.error.message
        );
        throw children.assignsR.error;
      }

      return plans.map(p => ({
        ...p,
        rooms: (children.roomsR.data ?? [])
          .filter(r => r.plan_id === p.id)
          .map(r => ({
            ...r,
            assignments: (children.assignsR.data ?? []).filter(a => a.plan_id === p.id && a.room_id === r.id),
          })),
      })) as SeatingPlanFull[];
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000, // refresh so countdown + auto-publish propagate
    // Surface the error to the UI so SeatingTab can distinguish "no plans"
    // from "couldn't fetch" instead of always defaulting to [].
    retry: 1,
  });
}

// ─── STUDENT LOOKUP ───────────────────────────────────────────────────────────
// Used by the student dashboard "My Seating" tab.

export interface MySeat {
  plan_id: string;
  plan_title: string;
  session_id: string;
  paper_subject: string | null;
  exam_date: string | null;
  plan_status: string;
  room_id: string;
  room_name: string;
  invigilator: string | null;
  room_notes: string | null;
  row_idx: number;
  col_idx: number;
  seat_label: string;
  qr_token: string;
  exam_roll_no: string;
}

/**
 * Fetch the logged-in student's seating across all published plans.
 * We rely on the v_student_seating view (defined in the migration).
 */
export function useMySeating(studentId: string | undefined, studentClass: string | undefined, classRollNo: string | undefined) {
  return useQuery<MySeat[]>({
    queryKey: ["student-seating", studentId, studentClass, classRollNo],
    queryFn: async () => {
      if (!studentId && !classRollNo) return [];
      // v_student_seating is keyed by student_id; fall back to class+roll_no.
      let q = supabase.from("v_student_seating").select("*");
      if (studentId) {
        q = q.eq("student_id", studentId);
      } else if (classRollNo && studentClass) {
        q = q.eq("class", studentClass).eq("class_roll_no", classRollNo);
      } else {
        return [];
      }
      const { data, error } = await q.order("exam_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as MySeat[];
    },
    enabled: !!(studentId || (classRollNo && studentClass)),
    staleTime: 60 * 1000,
  });
}

// ─── LIVE EXAM CONSOLE HOOKS (migration 017) ────────────────────────────────

/** All plans with status 'generated' or 'published' — for the console picker. */
export function useAllSeatingPlans() {
  return useQuery<SeatingPlan[]>({
    queryKey: ["seating-plans-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_seating_plans")
        .select("*")
        .in("status", ["generated", "published"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Update paper start/end times on a plan (used by the console settings).
 *
 * SIDE EFFECT (rev. 3): also syncs paper_start_time / paper_end_time on every
 * existing exam_attendance row that belongs to this plan's session+subject+
 * exam_date. This keeps the attendance window in lockstep with the Live
 * Console — so when admin extends paper end-time from 12 PM to 1 PM mid-exam,
 * the Exam Attendance tab immediately allows marking during the extra hour
 * (no re-init needed). It also keeps the row-level display accurate.
 *
 * Returns the count of attendance rows synced (for the toast).
 */
export function useUpdatePaperTimes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      planId: string;
      paperStartAt: string | null;
      paperEndAt: string | null;
      // New (Problem 2 fix): optional recurring date range. When both are
      // set, the plan's paper times apply to every day in the inclusive
      // range — the Live Console + Exam Attendance automatically treat
      // each day in the range as a paper day.
      examDateFrom?: string | null;
      examDateTo?: string | null;
    }): Promise<number> => {
      // 1. Update the seating plan itself.
      //    Build the update payload dynamically so we only touch the new
      //    columns when the caller actually provided them (keeps the update
      //    backward-compatible with DBs that don't have the columns yet).
      //    If the update fails because the new columns don't exist, retry
      //    with just the legacy columns (paper_start_at / paper_end_at).
      const updatePayload: Record<string, unknown> = {
        paper_start_at: params.paperStartAt,
        paper_end_at: params.paperEndAt,
      };
      if (params.examDateFrom !== undefined) updatePayload.exam_date_from = params.examDateFrom ?? null;
      if (params.examDateTo !== undefined)   updatePayload.exam_date_to   = params.examDateTo ?? null;
      const upRes = await supabase
        .from("exam_seating_plans")
        .update(updatePayload)
        .eq("id", params.planId);
      let error = upRes.error;
      if (error && /exam_date_from|exam_date_to|Could not find|column/i.test(error.message || "")) {
        // New columns missing — retry with legacy-only payload.
        console.warn("[useUpdatePaperTimes] exam_date_from/to columns missing — retrying with legacy columns only. Run the migration to enable date-range plans.");
        const legacyPayload: Record<string, unknown> = {
          paper_start_at: params.paperStartAt,
          paper_end_at: params.paperEndAt,
        };
        const r2 = await supabase
          .from("exam_seating_plans")
          .update(legacyPayload)
          .eq("id", params.planId);
        error = r2.error;
      }
      if (error) throw error;

      // 2. Fetch the plan's session_id, paper_subject, and exam_date so we
      //    know which attendance rows to sync. Try to fetch the new range
      //    columns too; if they don't exist yet (pre-migration DB), fall
      //    back to the old column set so this mutation keeps working.
      let plan: any = null;
      const selWithRange = "session_id, paper_subject, exam_date, exam_date_from, exam_date_to";
      const selLegacy    = "session_id, paper_subject, exam_date";
      const r1 = await supabase.from("exam_seating_plans").select(selWithRange).eq("id", params.planId).maybeSingle();
      if (r1.error && /exam_date_from|exam_date_to|Could not find|column/i.test(r1.error.message || "")) {
        const r2 = await supabase.from("exam_seating_plans").select(selLegacy).eq("id", params.planId).maybeSingle();
        if (r2.error) throw r2.error;
        plan = r2.data;
      } else {
        if (r1.error) throw r1.error;
        plan = r1.data;
      }

      // 3. Convert ISO paper times to "HH:MM" (local) for storage on rows.
      const toHHMM = (iso: string | null): string | null => {
        if (!iso) return null;
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const startHHMM = toHHMM(params.paperStartAt);
      const endHHMM   = toHHMM(params.paperEndAt);

      // 4. Sync ALL existing attendance rows for this session+subject+date.
      //    If paper times were cleared (set to null), keep the rows unchanged
      //    so we don't accidentally destroy historical data.
      //
      //    LOOSE SUBJECT MATCH: the seating plan's paper_subject is free-text
      //    (e.g. "Mathematics — Paper 1") while attendance rows store the
      //    dropdown subject (e.g. "Mathematics"). Strict equality would miss
      //    the rows. We fetch all rows for this session+date, filter client-
      //    side by bidirectional case-insensitive substring match, and update
      //    only the matching IDs.
      let synced = 0;
      if (plan?.session_id && plan?.paper_subject && plan?.exam_date && startHHMM && endHHMM) {
        // 4a. Fetch candidate rows (session+date only — subject filtered client-side).
        const { data: candidates, error: fetchErr } = await supabase
          .from("exam_attendance")
          .select("id, subject")
          .eq("session_id", plan.session_id)
          .eq("exam_date", plan.exam_date);
        if (fetchErr) throw fetchErr;

        // 4b. Loose subject match (case-insensitive, bidirectional substring).
        const planSubj = plan.paper_subject.trim().toLowerCase();
        const matchingIds = (candidates ?? [])
          .filter(r => {
            const rowSubj = (r.subject || "").trim().toLowerCase();
            if (!rowSubj || !planSubj) return false;
            return rowSubj === planSubj || planSubj.includes(rowSubj) || rowSubj.includes(planSubj);
          })
          .map(r => r.id);

        // 4c. Bulk update the matching rows.
        if (matchingIds.length > 0) {
          const { error: syncErr } = await supabase
            .from("exam_attendance")
            .update({ paper_start_time: startHHMM, paper_end_time: endHHMM })
            .in("id", matchingIds);
          if (syncErr) throw syncErr;
          synced = matchingIds.length;
        }
      }
      return synced;
    },
    onSuccess: (synced, vars) => {
      toast.success(
        synced > 0
          ? `Paper times updated — ${synced} attendance row${synced === 1 ? "" : "s"} synced`
          : "Paper times updated"
      );
      qc.invalidateQueries({ queryKey: ["seating-plan", vars.planId] });
      qc.invalidateQueries({ queryKey: ["seating-plans-all"] });
      // CRITICAL: invalidate the paper-times-seating query so any open
      // Exam Attendance tab (admin or teacher) immediately picks up the
      // new window — without needing a manual refresh.
      qc.invalidateQueries({ queryKey: ["paper-times-seating"] });
      // Also invalidate live-attendance so the console's per-student
      // tally refreshes (paper times display in the Live Console).
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    },
  });
}

/**
 * Live attendance for a specific exam date.
 *
 * FILTERING (rev. 7): the session_id filter has been REMOVED. It was causing
 * a bug where the Live Console showed all students as "Unmarked" even though
 * attendance had been taken — because the attendance rows' session_id didn't
 * match the seating plan's session_id (admin selected a different session in
 * the Exam Attendance dropdown).
 *
 * The tally in AdminExamConsole already matches by student_id — it only
 * counts students who are seated in the plan. So there's no risk of counting
 * students from other sessions. The only filtering we need is:
 *   1. exam_date matches today (server-side)
 *   2. subject matches (client-side, loose, with fallback)
 *
 * Subject matching is loose (bidirectional, case-insensitive substring). If
 * the subject filter returns 0 rows, we fall back to ALL rows for the date
 * (handles the case where paper_subject is blank or uses a completely
 * different naming convention).
 *
 * Subscribes to Supabase realtime on the full exam_attendance table and
 * refetches on any change — so the console updates live as invigilators
 * scan QR codes.
 *
 * ─── rev. 8 — STALE-DATA FIX (Problem 3) ────────────────────────────────────
 * Three changes to fix "Console Live shows old attendance after extending
 * paper time + updating attendance":
 *
 *   1. STABLE queryKey (useMemo): previously queryKey was a new array on
 *      every render, which caused the realtime useEffect to tear down and
 *      rebuild its Supabase channel on EVERY render. Events fired during
 *      the brief teardown window were LOST, so the console never refetched
 *      and stayed on stale data. Memoizing the key keeps the channel
 *      stable across renders (it only re-subscribes when examDate/
 *      sessionId/paperSubject actually change).
 *
 *   2. POLLING FALLBACK (refetchInterval: 5000): even if realtime drops
 *      an event (network hiccup, channel race, etc.), the query
 *      auto-refetches every 5 seconds. This guarantees the console can
 *      never be stuck on stale data for more than 5s.
 *
 *   3. ROW DEDUPLICATION: pre-migration duplicate rows (same student +
 *      subject + date but different exam_date string formats like
 *      "2026-07-06" vs "2026-07-06T00:00:00.000Z") were making the tally
 *      pick the wrong row — the admin would update one duplicate to
 *      "absent", but the OTHER duplicate (still "present") would win the
 *      "latest timestamp" comparison and the console kept showing
 *      "present". Deduping at the query layer collapses these so the
 *      tally always sees exactly ONE row per (student, subject, date).
 */
export function useLiveAttendance(
  examDate: string | null | undefined,
  sessionId?: string | null,
  paperSubject?: string | null
) {
  const qc = useQueryClient();
  // sessionId is kept in the queryKey for cache identity but is NOT used
  // as a server-side filter (see comment above).
  //
  // MEMOIZED so the array reference is STABLE across renders (as long as
  // the primitive elements don't change). This is critical: the realtime
  // useEffect below depends on `queryKey`, and an unstable reference
  // would cause it to re-subscribe on every render, dropping events.
  const queryKey = useMemo(
    () => ["live-attendance", examDate, sessionId ?? null, paperSubject ?? null],
    [examDate, sessionId, paperSubject]
  );

  const query = useQuery<{
    id: string;
    student_id: string;
    student_name: string;
    class: string;
    class_roll_no: string;
    exam_roll_no: string;
    subject: string;
    exam_date: string;
    status: "present" | "absent" | "leave";
    scanned_at: string | null;
    scanned_by: string | null;
    seat_id: string | null;
    room_id: string | null;
    seat_label: string | null;
    created_at?: string;
  }[]>({
    queryKey,
    queryFn: async () => {
      if (!examDate) return [];

      // ── Fetch ALL attendance rows for this date (no session_id filter). ──
      // The tally matches by student_id, so only seated students are counted.
      const { data, error } = await supabase
        .from("exam_attendance")
        .select("*")
        .eq("exam_date", examDate);
      if (error) throw error;
      const allRows = data ?? [];

      // ── DEDUPLICATE (rev. 8) ──
      // Collapse any duplicate rows for the same (student_id, subject,
      // normalized date). Pre-migration duplicates had different exam_date
      // string formats ("2026-07-06" vs "2026-07-06T00:00:00.000Z") for
      // the same actual date; without dedupe the tally's "latest timestamp
      // wins" rule could pick a stale duplicate over the freshly-updated
      // canonical row, making the console show old attendance.
      //
      // Keep rule (mirrors dedupeAttendanceRows in useExamAttendance.ts):
      //   1. prefer non-null scanned_at
      //   2. prefer latest scanned_at
      //   3. prefer latest created_at (tie-breaker)
      const normDate = (raw: string | null | undefined): string => {
        if (!raw) return "";
        const s = String(raw).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        }
        return s;
      };
      const dedupMap = new Map<string, typeof allRows[number]>();
      for (const r of allRows) {
        const key = `${r.student_id}|${r.subject}|${normDate(r.exam_date)}`;
        const prev = dedupMap.get(key);
        if (!prev) { dedupMap.set(key, r); continue; }
        const aHas = !!r.scanned_at, bHas = !!prev.scanned_at;
        let keep: typeof allRows[number];
        if (aHas && !bHas) keep = r;
        else if (!aHas && bHas) keep = prev;
        else if (aHas && bHas) keep = (r.scanned_at! >= prev.scanned_at!) ? r : prev;
        else keep = ((r.created_at || "") >= (prev.created_at || "")) ? r : prev;
        dedupMap.set(key, keep);
      }
      const dedupedRows = Array.from(dedupMap.values());

      console.log("[useLiveAttendance] ── DIAGNOSTIC ──");
      console.log("[useLiveAttendance] examDate:", examDate, "plan sessionId:", sessionId, "plan paperSubject:", paperSubject);
      console.log("[useLiveAttendance] Total rows for this date:", allRows.length, "→ after dedupe:", dedupedRows.length);

      // ── Subject filter (client-side, loose match with fallback). ──
      if (paperSubject) {
        const target = paperSubject.trim().toLowerCase();
        const subjectMatched = dedupedRows.filter(r => {
          const row = (r.subject || "").trim().toLowerCase();
          if (!row || !target) return false;
          return target.includes(row) || row.includes(target);
        });
        console.log("[useLiveAttendance] After subject filter:", subjectMatched.length, "of", dedupedRows.length);

        // FALLBACK: if subject filter returns 0 rows but there ARE rows for
        // this date, use ALL rows. This handles the case where the plan's
        // paper_subject uses a completely different naming convention.
        if (subjectMatched.length === 0 && dedupedRows.length > 0) {
          console.warn("[useLiveAttendance] Subject filter matched 0 rows — falling back to ALL rows for this date.");
          return dedupedRows;
        }
        return subjectMatched;
      }

      // No paperSubject provided — return all deduped rows for the date.
      return dedupedRows;
    },
    enabled: !!examDate,
    staleTime: 5 * 1000,
    // ── POLLING FALLBACK (rev. 8) ──
    // Refetch every 5 seconds as a safety net. Realtime should deliver
    // updates instantly, but if a websocket event is dropped (network
    // blip, channel teardown race, browser tab throttling, etc.) the
    // console would otherwise stay on stale data indefinitely. 5s polling
    // caps the staleness window so the admin never sees "old attendance"
    // for more than 5 seconds after an update.
    refetchInterval: 5 * 1000,
  });

  // Realtime: invalidate on any change to exam_attendance. We can't filter
  // the realtime channel by exam_date, so we listen to all rows and let the
  // query refetch handle the filtering. The invalidation is cheap because
  // the query is already staleTime=5s.
  //
  // queryKey is now MEMOIZED (rev. 8) so this effect only re-runs when
  // examDate/sessionId/paperSubject actually change — NOT on every render.
  // This keeps the Supabase channel stable and prevents event loss.
  useEffect(() => {
    const channel = supabase
      .channel(`live-att-${examDate ?? "none"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exam_attendance" },
        () => qc.invalidateQueries({ queryKey })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [examDate, qc, queryKey]);

  return query;
}
