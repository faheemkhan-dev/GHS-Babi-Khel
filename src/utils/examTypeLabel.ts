// src/utils/examTypeLabel.ts
//
// Classes 9 & 10 store their internal exam_type in the database as
// "Annual-I" / "Annual-II". These values are intentionally translated only
// at school-result display boundaries. Queries, localStorage keys, and writes
// must continue using the raw values.
//
// Every class is shown as "1st Semester" / "2nd Semester" (6-8 stored as-is).

const DISPLAY_LABELS: Record<string, string> = {
  "Annual-I": "1st Semester",
  "Annual-II": "2nd Semester",
};

/** Converts an internal school exam_type value to its user-facing label. */
export function examTypeLabel(examType: string): string {
  return DISPLAY_LABELS[examType] ?? examType;
}

/** Converts Annual-I/II occurrences inside a longer school-result label. */
export function examTypeLabelInText(text: string): string {
  return text
    .replace(/\bAnnual-II\b/g, "2nd Semester")
    .replace(/\bAnnual-I\b/g, "1st Semester");
}
