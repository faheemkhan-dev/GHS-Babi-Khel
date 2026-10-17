// src/components/ReportCard/toMeritEntries.ts
//
// Converts BISE Peshawar bulk-fetch results (NormalizedResult[]) into the
// same MeritEntry shape the school's own Merit List feature uses
// (AdminMeritList.tsx), so Class 9th/10th BISE board results can be
// ranked together with school-administered results in one combined
// School Merit List.
//
// CRITICAL — why this exists at all:
//   Class 9th papers total 600 marks. Class 10th papers total 1200 marks.
//   A 9th student's 507/600 (84.5%) and a 10th student's 900/1200 (75%)
//   are NOT comparable by raw marks — 900 > 507 numerically, but 84.5% is
//   the actually-better result. Every field this file produces is built
//   from `percentage` (see classMaxMarks.ts), never from raw totalMarks,
//   so downstream sorting is always correct regardless of which class a
//   student is in.
//
// student_id is synthetic (BISE students have no row in the school's
// `students` table) — built deterministically from roll+class+examType+year
// so re-converting the same roll later (e.g. re-publishing after a
// correction) produces the SAME id instead of a new one each time.

import type { NormalizedResult } from "./types";
import { getGradeFromPercentage } from "@/hooks/useResults";

/** Minimal shape matching AdminMeritList.tsx's MeritEntry interface.
 *  Duplicated here (rather than imported) because MeritEntry is a local
 *  type inside AdminMeritList.tsx, not exported — this shape must be kept
 *  in sync with it by hand if that interface ever changes. */
export interface BiseMeritEntry {
  id: string;
  student_id: string;
  full_name: string;
  roll_number: string;
  class: string;
  exam_type: string;
  photo_url: string | null;
  obtained_marks: number;
  total_marks: number;
  percentage: number;
  grade: string;
  is_pass: boolean;
  position: number;
}

/**
 * Converts one class's worth of BISE results into MeritEntry rows, ready
 * to merge with school-side entries and sort by percentage.
 *
 * - Skips any roll that wasn't found / errored — there's no data to rank.
 * - `position` is left as a placeholder (0); the caller must re-sort the
 *   COMBINED list (school + BISE) by percentage and reassign sequential
 *   positions — this file only converts, it doesn't rank.
 */
export function biseResultsToMeritEntries(
  results: NormalizedResult[],
  opts: { className: "9th" | "10th"; examType: string; year: number }
): BiseMeritEntry[] {
  const classLabel = opts.className === "9th" ? "9" : "10";
  return results
    .filter((r) => r.found && r.name)
    .map((r) => {
      const percentage = r.percentage;
      const grade = r.grade || getGradeFromPercentage(percentage);
      return {
        id: `bise-${opts.className}-${r.roll}-${opts.examType}-${opts.year}`,
        student_id: `bise-${opts.className}-${r.roll}-${opts.examType}-${opts.year}`,
        full_name: r.name,
        roll_number: r.roll,
        class: classLabel,
        exam_type: opts.examType,
        photo_url: null,
        obtained_marks: r.totalMarks,
        total_marks: opts.className === "9th" ? 600 : 1200,
        percentage,
        grade,
        is_pass: !r.isFail,
        position: 0, // reassigned by the caller after merging + sorting
      };
    });
}
