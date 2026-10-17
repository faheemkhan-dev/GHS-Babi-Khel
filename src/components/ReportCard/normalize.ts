// src/components/ReportCard/normalize.ts
// Turns a raw /api/bisep-proxy response into a NormalizedResult with:
//   • numeric theory/practical marks (parsed from strings)
//   • a computed total when BISE omitted one (failed students)
//   • a single isFail flag (any subject's theory OR practical failed)
//
// BISE Peshawar's behavior on failed students:
//   • The "Marks" row is empty (no total shown)
//   • Each failed paper's theory/practical cell is styled red
//   • The /api/bisep-proxy already captures this via theory_fail / practical_fail
//
// Our job here:
//   1. Parse the string marks to numbers (null if blank / non-numeric)
//   2. For each subject: isFail = theoryFail OR practicalFail
//   3. Student isFail = any subject's isFail
//   4. totalMarks: prefer BISE's "marks" field; if empty, sum all subject
//      theory + practical numeric values (failed papers counted at their
//      actual numeric value, which is what BISE would have shown)
//
// This means a student who failed one paper still gets a computed total —
// the PDF can show "Total: 387 (1 subject failed)" instead of an empty cell.

import type {
  BisepResult,
  NormalizedResult,
  ParsedSubject,
  SubjectMark,
  ResultStats,
  ClassName,
} from "./types";
import { biseTotalPercentage } from "./classMaxMarks";

/** Parse a string like "83" or "" or "AB" into a number, or null. */
function parseMark(raw: string): number | null {
  const s = (raw || "").trim();
  if (!s) return null;
  // Some boards use "AB" for absent — treat as 0 but flagged separately
  if (/^ab$/i.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeResult(
  raw: BisepResult,
  roll: string,
  className: ClassName
): NormalizedResult {
  if (!raw.found) {
    return {
      roll,
      found: false,
      name: "",
      fatherName: "",
      rawMarks: "",
      grade: "",
      remarks: "",
      subjects: [],
      totalMarks: 0,
      percentage: 0,
      isFail: true, // not found → treat as fail for stats
      failedSubjectCount: 0,
      error: raw.error || raw.message || "Record not found",
    };
  }

  const rawSubjects: SubjectMark[] = raw.subjects ?? [];
  const subjects: ParsedSubject[] = rawSubjects.map((s) => {
    const theory = parseMark(s.theory);
    const practical = parseMark(s.practical);
    const isFail = s.theory_fail || s.practical_fail;
    return {
      name: (s.subject || "").trim(),
      theory,
      practical,
      theoryFail: s.theory_fail,
      practicalFail: s.practical_fail,
      isFail,
    };
  });

  // Student is failed if any subject has a failed paper.
  const failedSubjectCount = subjects.filter((s) => s.isFail).length;
  const isFail = failedSubjectCount > 0;

  // Total marks: prefer BISE's "marks" field; if empty, sum subject marks.
  let totalMarks: number;
  const biseMarks = parseMark(raw.marks ?? "");
  if (biseMarks !== null && biseMarks > 0) {
    totalMarks = biseMarks;
  } else {
    // Compute from subjects — failed papers counted at their numeric value.
    totalMarks = subjects.reduce((sum, s) => {
      const t = s.theory ?? 0;
      const p = s.practical ?? 0;
      return sum + t + p;
    }, 0);
  }

  return {
    roll,
    found: true,
    name: (raw.name ?? "").trim(),
    fatherName: (raw.father_name ?? "").trim(),
    rawMarks: (raw.marks ?? "").trim(),
    grade: (raw.grade ?? "").trim(),
    remarks: (raw.remarks ?? "").trim(),
    subjects,
    totalMarks,
    percentage: biseTotalPercentage(totalMarks, className),
    isFail,
    failedSubjectCount,
  };
}

/** Compute aggregate statistics over a list of normalized results.
 *  Used by the PDF generator for the summary section. */
export function computeStats(results: NormalizedResult[]): ResultStats {
  const totalStudents = results.length;
  const found = results.filter((r) => r.found);
  const notFound = results.filter((r) => !r.found && r.error && /not found/i.test(r.error));
  const errors = results.filter((r) => !r.found && r.error && !/not found/i.test(r.error));

  const passed = found.filter((r) => !r.isFail);
  const failed = found.filter((r) => r.isFail);

  // Average Marks must reflect the WHOLE class (passed + failed), not just
  // passing students — excluding failed students silently inflates the
  // average and gives a wrong "class average". Use every found student's
  // total instead.
  const marks = found.map((r) => r.totalMarks).filter((m) => m > 0);
  const averageMarks = marks.length
    ? Math.round(marks.reduce((a, b) => a + b, 0) / marks.length)
    : 0;
  const passOnlyMarks = passed.map((r) => r.totalMarks).filter((m) => m > 0);
  const highestMarks = passOnlyMarks.length ? Math.max(...passOnlyMarks) : 0;
  // Lowest Marks must reflect the WHOLE class (passed + failed), not just
  // passing students — otherwise the cell just shows the lowest *passing*
  // total and silently hides any student who failed the exam. Use every
  // found student's total (same pool as `marks` / `averageMarks` above).
  const lowestMarks = marks.length ? Math.min(...marks) : 0;

  // Top scorer — highest total among ALL found (including failed, in case
  // a failed student has the highest numeric total). Prefer non-failed.
  const ranked = [...found].sort((a, b) => b.totalMarks - a.totalMarks);
  const topScorer = ranked[0];

  // Subject-wise pass rate
  const subjectMap: Record<string, { pass: number; fail: number }> = {};
  for (const r of found) {
    for (const s of r.subjects) {
      if (!s.name) continue;
      if (!subjectMap[s.name]) subjectMap[s.name] = { pass: 0, fail: 0 };
      if (s.isFail) subjectMap[s.name].fail += 1;
      else subjectMap[s.name].pass += 1;
    }
  }
  const subjectPassRates: ResultStats["subjectPassRates"] = {};
  for (const [name, counts] of Object.entries(subjectMap)) {
    const total = counts.pass + counts.fail;
    subjectPassRates[name] = {
      ...counts,
      rate: total > 0 ? Math.round((counts.pass / total) * 100) : 0,
    };
  }

  const passPercentage = found.length > 0
    ? Math.round((passed.length / found.length) * 100)
    : 0;

  return {
    totalStudents,
    foundCount: found.length,
    notFoundCount: notFound.length,
    errorCount: errors.length,
    passCount: passed.length,
    failCount: failed.length,
    passPercentage,
    averageMarks,
    highestMarks,
    lowestMarks,
    topScorerName: topScorer?.name ?? "",
    topScorerRoll: topScorer?.roll ?? "",
    subjectPassRates,
  };
}
