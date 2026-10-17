// src/components/ReportCard/classMaxMarks.ts
// Fixed total marks per class for BISE Peshawar SSC results — confirmed and
// used everywhere in this school's reporting: Class 9th papers total 600,
// Class 10th papers total 1200. These are NOT configurable in the UI on
// purpose: they don't vary by year or admin, so a settings field would only
// add a place to get it wrong. If the board ever changes these totals,
// update this one constant — every percentage calculation across the
// Report Card and Merit List features reads from here.
//
// College (HSSC) classes were added later: 1st Year (Part-I) and 2nd Year
// (Part-II) are 550 marks each for the standard BISE Peshawar groups
// (Pre-Medical / Pre-Engineering / ICS / Humanities). If a group at your
// college has a different total, change the two constants below — nothing
// else needs touching.
import type { ClassName } from "./types";

export const CLASS_MAX_MARKS: Record<ClassName, number> = {
  "9th": 600,
  "10th": 1200,
  "1st Year": 550,
  "2nd Year": 550,
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
