// src/lib/admissionRules.ts — single source of truth for admission rules
// shared by the public apply form, the eligibility checker, the admin walk-in
// dialog and the tests.
//
// BOARD FACTS encoded here (BISE Peshawar, 2026 notifications):
//   • 9th-class enrollment age: above 12 years — DOB cut-off 31-03-2014 for
//     the 2026 enrollment (notification 70/Gen/Enrol/BISEP, 20-08-2026).
//   • 9th-class UPPER age limit: 20 years; above 20 only with Chairman's
//     relaxation (notification "Upper Age Limit", 10-06-2025).
//   • Migration (school-to-school on the BISEP portal) applies to Class 9 and
//     Class 10 only; the RECEIVING school applies online. Class 6–8 transfers
//     are school-to-school directly, outside the board.
//   • 9th enrollment fee 2026: Rs 1300 normal by 30-09-2026 (late 1800 by
//     15-10, double 2300 by 30-10, then Rs 10/day until 30-11-2026).
//
// The board publishes no age rules for classes 6–8 — those stay at the
// school's own policy (previous class ± 1 year), so the checker warns instead
// of blocking for them.
// ═══════════════════════════════════════════════════════════════════════════

export const CLASSES = ["6", "7", "8", "9", "10"] as const;
export type AdmissionClass = (typeof CLASSES)[number];

export const BOARD_CLASSES: AdmissionClass[] = ["9", "10"];
export const MIGRATION_CLASSES: AdmissionClass[] = ["9", "10"];

/** BISEP 9th-enrollment DOB cut-off for the 2026 session (age above 12). */
export const CLASS9_MIN_DOB = "2014-03-31";
/** BISEP 9th-class upper age limit (notification of 10-06-2025). */
export const CLASS9_MAX_AGE = 20;
/** BISEP 9th enrollment fee, normal rate (2026). */
export const BISEP_CLASS9_FEE = 1300;

/** Age in completed years on a given date (no floating-point division). */
export function ageOn(dob: string, on: Date = new Date()): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return NaN;
  let age = on.getFullYear() - d.getFullYear();
  const beforeBirthday =
    on.getMonth() < d.getMonth() ||
    (on.getMonth() === d.getMonth() && on.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export interface AgeCheck {
  ok: boolean;
  /** Warnings do not block (school-level / relaxable); errors do (board rule). */
  level: "ok" | "warn" | "error";
  message: string;
}

/**
 * Age rule per class.
 *  Class 9: board rules — DOB on/before 31-03-2014 (age above 12 at the 2026
 *           enrollment) and at most 20 years old. Both are board rules, so a
 *           violation is an error, not a warning.
 *  Class 10: school guidance — previous class (9) passed, expected ~14–17.
 *  Class 6–8: school policy — previous class ± 1 year (warn only).
 */
export function checkAgeForClass(dob: string | null | undefined, cls: string, on: Date = new Date()): AgeCheck {
  if (!dob) return { ok: false, level: "error", message: "Date of birth is required." };
  const age = ageOn(dob, on);
  if (Number.isNaN(age)) return { ok: false, level: "error", message: "Enter a valid date of birth." };

  if (cls === "9") {
    if (dob > CLASS9_MIN_DOB) {
      return {
        ok: false,
        level: "error",
        message: `BISE Peshawar requires Class 9 students to be above 12 years (date of birth on or before ${formatDob(CLASS9_MIN_DOB)} for this session). Recorded date of birth: ${formatDob(dob)}.`,
      };
    }
    if (age > CLASS9_MAX_AGE) {
      return {
        ok: false,
        level: "error",
        message: `BISE Peshawar's upper age limit for Class 9 is ${CLASS9_MAX_AGE} years. Recorded age is ${age} years — only the Chairman of the Board can relax it.`,
      };
    }
    return { ok: true, level: "ok", message: `Age ${age} — within the BISE Peshawar limits for Class 9.` };
  }

  // School-level guidance for the other classes (the board sets no age rule).
  const guidance: Record<string, { min: number; max: number }> = {
    "6": { min: 9, max: 12 },
    "7": { min: 10, max: 13 },
    "8": { min: 11, max: 14 },
    "10": { min: 14, max: 17 },
  };
  const g = guidance[cls];
  if (!g) return { ok: true, level: "ok", message: "" };
  if (age < g.min || age > g.max) {
    return {
      ok: false,
      level: "warn",
      message: `Class ${cls} students are usually ${g.min}–${g.max} years old. Recorded age is ${age} years — you can still apply; the school office reviews such cases individually.`,
    };
  }
  return { ok: true, level: "ok", message: "" };
}

/** Migration on the BISEP portal exists for Class 9 and Class 10 only. */
export function migrationAllowedForClass(cls: string): boolean {
  return MIGRATION_CLASSES.includes(cls as AdmissionClass);
}

/** B-Form / CNIC / phone helpers — digits-only comparisons everywhere. */
export function digitsOnly(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

export function isValidBForm(v: string | null | undefined): boolean {
  return digitsOnly(v).length === 13;
}

export function isValidCnic(v: string | null | undefined): boolean {
  return digitsOnly(v).length === 13;
}

export function isValidPkMobile(v: string | null | undefined): boolean {
  const d = digitsOnly(v);
  return d.length === 11 && d.startsWith("03");
}

/** Marks formats accepted (same as the SQL admission_marks_pct): 450/600, 82%, 82, A+ */
export const MARKS_RE = /^(\d{1,4}\s*\/\s*\d{2,4}|\d{1,3}(\.\d{1,2})?\s*%?|[A-F][+-]?)$/i;

/**
 * Percentage used for merit ranking (mirrors SQL admission_marks_pct).
 * '450/600' → 75, '82%' / '82' → 82, 'A+' → null (letter grades rank last).
 */
export function marksPct(marks: string | null | undefined): number | null {
  const v = (marks || "").trim();
  const frac = v.match(/^(\d{1,4})\s*\/\s*(\d{2,4})$/);
  if (frac) {
    const denom = Number(frac[2]);
    return denom > 0 ? Math.round((Number(frac[1]) / denom) * 10000) / 100 : null;
  }
  const pct = v.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*%?$/);
  if (pct) return Math.round(Number(pct[1]) * 100) / 100;
  return null;
}

/** Class label, e.g. classToLabel("9") → "Class 9". */
export function classToLabel(cls: string | null | undefined): string {
  return `Class ${cls ?? ""}`.trim();
}

/** Migration steps shown to applicants (BISEP: the RECEIVING school applies). */
export const MIGRATION_STEPS = [
  "Online application submitted to our school",
  "Merit list published — merit-listed students bring documents (incl. School Leaving Certificate)",
  "Our school (receiving school) applies for the migration on the BISE Peshawar portal",
  "Previous school / board completes the migration (portal transfer or Migration Certificate)",
  "BISE Peshawar fee / challan, if applicable, is paid",
  "Admission & enrollment confirmed at our school",
] as const;

/** Board schedule lines for the public page (kept as data so the admin note can extend them). */
export const BISEP_SCHEDULE = [
  { label: "Class 9 enrollment (BISE Peshawar portal)", fee: "Rs 1,300", due: "30 Sep 2026" },
  { label: "Class 9 enrollment — late", fee: "Rs 1,800", due: "15 Oct 2026" },
  { label: "Class 9 enrollment — double late", fee: "Rs 2,300", due: "30 Oct 2026" },
  { label: "School-to-school migration window", fee: "—", due: "until 31 Dec 2026" },
] as const;

function formatDob(dob: string): string {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return dob;
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}
