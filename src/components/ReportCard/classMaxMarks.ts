// src/components/ReportCard/classMaxMarks.ts
// Fixed total marks per class for BISE Peshawar results — confirmed and used
// everywhere in this school's reporting (Annual-I and Annual-II alike):
//   SSC : Class 9th  = 600 (9 papers),   Class 10th    = 1200 (9 + 9 = 18 papers)
//   HSSC: 1st Year   = 600 (7 papers),   2nd Year      = 1200 (7 + 7 = 14 papers)
// The 10th / 2nd Year marksheet carries BOTH the Part-I and the Part-II
// papers, which is why its total is double. These are NOT configurable in the
// UI on purpose: they don't vary by year or admin, so a settings field would
// only add a place to get it wrong. If the board ever changes these totals,
// update this one constant — every percentage calculation across the
// Report Card and Merit List features reads from here.
import type { ClassName } from "./types";

export const CLASS_MAX_MARKS: Record<ClassName, number> = {
  "9th": 600,
  "10th": 1200,
  "1st Year": 600,
  "2nd Year": 1200,
};

/** Human label for titles: "Class 9th" for school classes, "1st Year" for
 *  college classes (so it never reads "Class 1st Year"). */
export function classDisplayName(c: ClassName): string {
  return c === "9th" || c === "10th" ? `Class ${c}` : c;
}

/** True for HSSC (college) classes. */
export function isCollegeClass(c: ClassName): boolean {
  return c === "1st Year" || c === "2nd Year";
}

/** The two classes a "Combined" report pairs up for a given selection:
 *  9th+10th for school classes, 1st Year+2nd Year for college classes. */
export function combinedPairFor(c: ClassName): [ClassName, ClassName] {
  return isCollegeClass(c) ? ["1st Year", "2nd Year"] : ["9th", "10th"];
}

/** Percentage = obtained / class total × 100, rounded to 1 decimal.
 *  This is the ONLY correct way to compare a 9th student's marks against a
 *  10th student's marks — raw totals are not comparable across classes with
 *  different maximums (e.g. 507/600 = 84.5% outranks 900/1200 = 75%, even
 *  though 900 is the bigger raw number). Every merit-list ranking that
 *  mixes 9th and 10th MUST sort by this percentage, never by raw marks. */
export function biseTotalPercentage(totalMarks: number, className: ClassName): number {
  const max = CLASS_MAX_MARKS[className];
  if (!max) return 0;
  return Math.round((totalMarks / max) * 1000) / 10;
}
