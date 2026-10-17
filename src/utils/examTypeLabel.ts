// src/utils/examTypeLabel.ts
//
// Classes 9 & 10 store their internal exam_type in the database as
// "Annual-I" / "Annual-II". These values are intentionally translated only
// at school-result display boundaries. Queries, localStorage keys, and writes
// must continue using the raw values.
//
// Classes 6-8 ("1st Semester" / "2nd Semester") pass through unchanged.

const DISPLAY_LABELS: Record<string, string> = {
  "Annual-I": "Mid-Term",
  "Annual-II": "Final-Term",
};

/** Converts an internal school exam_type value to its user-facing label. */
export function examTypeLabel(examType: string): string {
  return DISPLAY_LABELS[examType] ?? examType;
}

/** Converts Annual-I/II occurrences inside a longer school-result label. */
export function examTypeLabelInText(text: string): string {
  return text
    .replace(/\bAnnual-I\b/g, "Mid-Term")
    .replace(/\bAnnual-II\b/g, "Final-Term");
}
