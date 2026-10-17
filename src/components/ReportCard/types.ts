// src/components/ReportCard/types.ts
// Shared types for the Report Card bulk-result feature.
//
// The Report Card feature lets an authorized user (password-gated) enter a
// list of BISE Peshawar roll numbers, fetch all their results live via the
// existing /api/bisep-proxy endpoint, and export the aggregated results as
// a styled PDF (totals + statistics) or Excel (every paper's marks).

/** A single roll number entered by the user. Persisted in localStorage
 *  until the user explicitly deletes it. */
export interface RollEntry {
  roll: string;
  addedAt: number; // epoch ms
}

/** One subject row from BISE Peshawar's result HTML, as returned by
 *  /api/bisep-proxy. The proxy already flags failing papers via the
 *  `theory_fail` / `practical_fail` booleans (red text detection). */
export interface SubjectMark {
  sr: string;
  subject: string;
  theory: string;
  practical: string;
  theory_fail: boolean;
  practical_fail: boolean;
}

/** Raw proxy response for a single roll number lookup. */
export interface BisepResult {
  found: boolean;
  roll_no?: string;
  name?: string;
  father_name?: string;
  marks?: string;
  grade?: string;
  remarks?: string;
  collect_dmc_from?: string;
  subjects?: SubjectMark[];
  message?: string; // "Record not Found..." for unknown rolls
  error?: string;   // proxy / network errors
}

/** A result row after we've normalized + enriched it. This is what the
 *  PDF / Excel generators consume. */
export interface NormalizedResult {
  roll: string;
  found: boolean;
  name: string;
  fatherName: string;
  /** BISE's own marks string (may be empty for failed students). */
  rawMarks: string;
  grade: string;
  remarks: string;
  /** Subjects with parsed numeric theory/practical marks. */
  subjects: ParsedSubject[];
  /** Total marks — if BISE didn't show it (failed students), we compute
   *  it by summing all subject theory + practical marks. */
  totalMarks: number;
  /** totalMarks expressed as a percentage of the class's fixed total
   *  (600 for 9th, 1200 for 10th, 550 for 1st/2nd Year) — see classMaxMarks.ts. This is what
   *  Merit List ranking uses; raw totalMarks is never comparable across
   *  9th and 10th since their maximums differ. */
  percentage: number;
  /** Whether any subject has a failed paper. Single fail = student fail. */
  isFail: boolean;
  /** Number of subjects with at least one failed paper. */
  failedSubjectCount: number;
  /** Per-student error message (network / proxy error / not found). */
  error?: string;
}

export interface ParsedSubject {
  name: string;
  theory: number | null;
  practical: number | null;
  theoryFail: boolean;
  practicalFail: boolean;
  /** Whether this subject contributes to the student's fail status. */
  isFail: boolean;
}

/** Classes the Report Card supports: school (SSC) 9th/10th and college
 *  (HSSC) 1st Year/2nd Year. */
export type ClassName = "9th" | "10th" | "1st Year" | "2nd Year";

/** User's selected exam parameters. */
export interface ExamSelection {
  /** School name shown on the PDF/Excel title block. Persisted in
   *  localStorage until the user changes it — defaults to
   *  "GHS Babi Khel, District Mohmand". */
  schoolName: string;
  className: ClassName;
  examType: "Annual-I" | "Annual-II";
  year: string;
}

/** Aggregated statistics for the PDF summary. */
export interface ResultStats {
  totalStudents: number;
  foundCount: number;
  notFoundCount: number;
  errorCount: number;
  passCount: number;
  failCount: number;
  /** Pass percentage among found (non-error, non-not-found) results. */
  passPercentage: number;
  /** Average total marks among found + passed students. */
  averageMarks: number;
  /** Highest total marks among found students. */
  highestMarks: number;
  /** Lowest total marks among ALL found students (passed or failed). */
  lowestMarks: number;
  /** Top scorer name. */
  topScorerName: string;
  /** Top scorer roll number. */
  topScorerRoll: string;
  /** Subject-wise pass rate (0-100 per subject name). */
  subjectPassRates: Record<string, { pass: number; fail: number; rate: number }>;
}

/** Progress callback signature for the bulk fetch. */
export type ProgressCallback = (done: number, total: number, currentRoll: string) => void;
