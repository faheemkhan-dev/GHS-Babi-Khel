// src/lib/admissionSession.ts — the Applicant Dashboard session (GHSS
// Ghallanai "no accounts, no login" model, adapted for GHS Babi Khel).
//
// GHSS Ghallanai keeps a private session token in localStorage after the
// atomic submit; the Applicant Dashboard (/admission/portal) resolves it.
// GHS Babi Khel's accurate High School flow submits anonymously and proves
// ownership with the reference-no + B-Form pair printed on the applicant's
// own challan — so the "session" is exactly that pair, kept on the
// applicant's own device:
//
//   • After a successful submit the pair is saved (setSession) and the
//     homepage CTA becomes "My Application".
//   • The dashboard loads itself with admission_portal_state(ref, bform) —
//     one server call that verifies BOTH keys before returning anything.
//   • "Exit" clears the pair (clearSession) — same UX as GHSS inter_logout.
//   • Nothing else changes: tracking by ref / B-Form / phone still works and
//     the draft flow is untouched.
// ═══════════════════════════════════════════════════════════════════════════

export interface AdmissionSession {
  /** OHS-YYYY-XXXXXX — printed on the challan, typed by the applicant. */
  reference_no: string;
  /** 13-digit B-Form number (digits only) — the ownership proof. */
  b_form_no: string;
  /** Application UUID — used for the /admission/application/:id route. */
  application_id: string;
  saved_at: number;
}

const SESSION_KEY = "ghs_admission_session";

/** Window event fired whenever the session is set or cleared (cross-tab + cross-component sync). */
export const ADMISSION_SESSION_EVENT = "ghs:admission-session";

function safeParse(raw: string | null): AdmissionSession | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d && typeof d.reference_no === "string" && typeof d.b_form_no === "string" && d.b_form_no) {
      return {
        reference_no: d.reference_no,
        b_form_no: String(d.b_form_no).replace(/[^0-9]/g, ""),
        application_id: typeof d.application_id === "string" ? d.application_id : "",
        saved_at: Number(d.saved_at) || Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getAdmissionSession(): AdmissionSession | null {
  try {
    return safeParse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function setAdmissionSession(s: Omit<AdmissionSession, "saved_at">): void {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...s, b_form_no: s.b_form_no.replace(/[^0-9]/g, ""), saved_at: Date.now() } satisfies AdmissionSession),
    );
  } catch { /* private mode / quota — the site still works without the session */ }
  try { window.dispatchEvent(new Event(ADMISSION_SESSION_EVENT)); } catch { /* non-DOM */ }
}

export function clearAdmissionSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* intentional */ }
  try { window.dispatchEvent(new Event(ADMISSION_SESSION_EVENT)); } catch { /* non-DOM */ }
}

export function hasAdmissionSession(): boolean {
  return getAdmissionSession() !== null;
}

// ── PII masking (GHSS masking.ts, adapted: B-Form instead of CNIC) ─────────

/** `61101-*******-2` — keeps first 5 and last digit visible. */
export function maskBForm(bForm: string | null | undefined): string {
  const d = (bForm || "").replace(/\D/g, "");
  if (d.length !== 13) return (bForm || "").slice(0, 3) + "••••••";
  return `${d.slice(0, 5)}-${"*".repeat(7)}-${d.slice(12)}`;
}

/** `0301-******-67` — keeps first 4 and last 2 digits visible. */
export function maskMobile(mobile: string | null | undefined): string {
  const d = (mobile || "").replace(/\D/g, "");
  if (d.length !== 11) return (mobile || "").slice(0, 3) + "•••••";
  return `${d.slice(0, 4)}-${"*".repeat(6)}-${d.slice(9)}`;
}
