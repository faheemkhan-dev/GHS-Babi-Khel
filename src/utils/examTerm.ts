// src/utils/examTerm.ts
//
// One Exam Roll session covers ALL classes. Its exam_term is stored as
// "1st Semester" / "2nd Semester". Classes 6-8 sit that as a Semester; classes
// 9-10 sit the same slot as Annual-I (Mid-Term) / Annual-II (Final-Term).
// These helpers map between the two so one session works for every class.

/** 1 / 2 for the first / second exam slot, null when unknown (e.g. "Annual"). */
export function termSlot(term: string): 1 | 2 | null {
  const s = (term || "").trim().toLowerCase();
  if (/1st|first|annual-i\b/.test(s)) return 1;
  if (/2nd|second|annual-ii\b/.test(s)) return 2;
  return null;
}

/** True when a date-sheet / result exam_type belongs to the session's term. */
export function termMatches(examType: string, term: string): boolean {
  const a = (examType || "").trim().toLowerCase();
  const b = (term || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = termSlot(a);
  return sa !== null && sa === termSlot(b);
}

/** The exam_type a given class actually uses for the session's term. */
export function termForClass(cls: string, term: string): string {
  const slot = termSlot(term);
  if (slot === null) return term;
  const upper = Number(cls) >= 9;
  return slot === 1 ? (upper ? "Annual-I" : "1st Semester") : (upper ? "Annual-II" : "2nd Semester");
}

/** Label for a whole session, e.g. "1st Semester / Mid-Term". */
export function sessionTermLabel(term: string): string {
  const slot = termSlot(term);
  if (slot === 1) return "1st Semester / Mid-Term";
  if (slot === 2) return "2nd Semester / Final-Term";
  return term;
}

/**
 * Public result title term. Classes 6-8 sit "1st/2nd Semester" and classes 9-10
 * sit "Mid-Term/Final-Term" in the same slot; the website shows ONE title for
 * the whole school: slot 1 → "1st Semester", slot 2 → "2nd Semester".
 * (Display only — database values are unchanged.)
 */
export function resultTermLabel(examType: string): string {
  const slot = termSlot(examType);
  if (slot === 1) return "1st Semester";
  if (slot === 2) return "2nd Semester";
  return examType;
}
