// src/components/admissions/AdmissionStepper.tsx — the gold progress stepper
// (GHSS Ghallanai AdmissionStepper + the public status resolver, ported 1:1
// and mapped onto the GHS Babi Khel High School status model).
//
//   TRACK_STEPS = Applied → Fee Paid → Review → Merit → Admitted
//
// resolveAdmissionStage(status, payment_status, processingFee) is the single
// source of truth used by BOTH the public Track Application result and the
// Application View page — same badge, same note, same "Next:" line everywhere.
// ═══════════════════════════════════════════════════════════════════════════

import { Check } from "lucide-react";

export const TRACK_STEPS = ["Applied", "Fee Paid", "Review", "Merit", "Admitted"] as const;

// ── Status label + badge tone (GHS statuses, GHSS badge styling) ────────────
const STATUS_BADGES: Record<string, { label: string; tone: string }> = {
  pending:             { label: "Applied",             tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  under_review:        { label: "Under Review",        tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  documents_missing:   { label: "Docs Missing",        tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  documents_verified:  { label: "Docs Verified",       tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  interview_scheduled: { label: "Interview Scheduled", tone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
  interview_completed: { label: "Interview Done",      tone: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  waitlisted:          { label: "Waitlisted",          tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  approved:            { label: "Eligible",            tone: "bg-green-600/15 text-green-700 dark:text-green-400" },
  merit_listed:        { label: "Merit Listed",        tone: "bg-primary/10 text-primary" },
  admitted:            { label: "Admitted",            tone: "bg-green-600 text-white" },
  admit_card_issued:   { label: "Admit Card Issued",   tone: "bg-green-600 text-white" },
  rejected:            { label: "Rejected",            tone: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

const REVIEW_STATUSES = [
  "under_review", "documents_missing", "documents_verified", "interview_scheduled",
  "interview_completed", "waitlisted", "approved", "merit_listed", "admitted", "admit_card_issued",
];
const MERIT_STATUSES = ["merit_listed", "admitted", "admit_card_issued"];
const ADMITTED_STATUSES = ["admitted", "admit_card_issued"];

export interface ResolvedAdmissionStage {
  status: string;
  label: string;
  tone: string;
  note: string;
  next: string;
  /** 1-based index into TRACK_STEPS; 0 when the application is closed. */
  step: number;
  complete: boolean;
  closed: boolean;
  paid: boolean;
  feeDue: boolean;
  /** Amber warning text when the workflow moved past Applied but the fee is still unpaid. */
  warning: string | null;
}

export function resolveAdmissionStage(
  status: string,
  paymentStatus: string | null | undefined,
  processingFee?: number | null,
): ResolvedAdmissionStage {
  const paid = paymentStatus === "paid";
  const feeOff = !processingFee || Number(processingFee) <= 0; // school switched the processing fee off
  const feeOk = paid || feeOff;
  const closed = status === "rejected";

  const appliedDone = !closed;
  const feeDone = appliedDone && feeOk;
  const reviewDone = REVIEW_STATUSES.includes(status);
  const meritDone = MERIT_STATUSES.includes(status);
  const admittedDone = ADMITTED_STATUSES.includes(status);

  const steps = [appliedDone, feeDone, reviewDone, meritDone, admittedDone];
  let step = 0;
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i]) { step = i + 1; break; }
  }
  if (steps.every(Boolean)) step = TRACK_STEPS.length;

  const badge = STATUS_BADGES[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };

  // note + next per state (GHSS voice, GHS flow)
  let note = "";
  let next = "";
  switch (status) {
    case "rejected":
      note = "Your application was not accepted. Please contact the school office for details.";
      next = "Contact the school office with your Reference No. for details.";
      break;
    case "admitted":
    case "admit_card_issued":
      note = "Congratulations — you have been admitted. Bring your original documents to the school office.";
      next = "Bring your original documents and the fee challan to the school office to complete the admission formalities.";
      break;
    case "merit_listed":
      note = "You are on the published merit list for your class.";
      next = "Check the published merit list on the Admission page, then visit the school office before the last date to confirm your seat.";
      break;
    case "approved":
      note = "You are eligible — the school has approved your application.";
      next = "Visit the school office with your original documents to complete the admission.";
      break;
    case "waitlisted":
      note = "All seats are currently filled. You are on the waiting list.";
      next = "If a seat opens up, your status is updated automatically and the school office will contact you.";
      break;
    case "interview_scheduled":
      note = "Your interview is scheduled.";
      next = "Bring your original documents to the interview on the booked date.";
      break;
    case "interview_completed":
      note = "Your interview is completed.";
      next = "Wait for the merit list — your status updates automatically.";
      break;
    case "documents_verified":
      note = "Your documents are verified by the school office.";
      next = "Watch for the merit list or an interview call — the status here updates automatically.";
      break;
    case "documents_missing":
      note = "Some documents are missing from your application.";
      next = "Bring the missing documents to the school office as soon as possible.";
      break;
    case "under_review":
      note = "Your application is under review by the school office.";
      next = "The status here changes as the office verifies your details.";
      break;
    default: // pending
      if (paid) {
        note = "Payment confirmed. Your application is in the queue for review.";
        next = "The school office verifies your details next. The status here changes to Under Review once that check starts.";
      } else {
        note = "Your application is received. Pay the processing fee to continue.";
        next = "Pay the processing fee online, or by manual transfer using the payment reference on your challan. The application moves to review as soon as the fee is received.";
      }
  }

  const warning =
    !closed && REVIEW_STATUSES.includes(status) && !paid && !feeOff
      ? "The processing fee for this application is still pending. Please complete the payment at the school office."
      : null;

  return {
    status,
    label: badge.label,
    tone: badge.tone,
    note,
    next,
    step,
    complete: steps.every(Boolean),
    closed,
    paid,
    feeDue: !paid && !feeOff,
    warning,
  };
}

/** The stepper itself — equal-width dots on a rail (GHSS layout). */
export default function AdmissionStepper({
  steps = TRACK_STEPS,
  current,
  complete,
}: {
  steps?: readonly string[];
  /** 1-based step the application is ON (0 = closed / nothing done). */
  current: number;
  complete?: boolean;
}) {
  const n = steps.length;
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = complete || idx < current;
        const active = !complete && idx === current;
        return (
          <div key={label} className="relative flex flex-col items-center">
            {/* connecting rail */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[13px] right-1/2 h-[2px] w-full ${done || active ? "bg-gold/80" : "bg-border"}`}
              />
            )}
            {/* dot */}
            <span
              className={`relative z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
                done
                  ? "border-gold bg-gold text-white"
                  : active
                    ? "border-gold bg-card text-primary ring-4 ring-gold/15"
                    : "border-border bg-card text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : idx}
            </span>
            <span
              className={`mt-1.5 text-center text-[10px] font-semibold leading-tight ${
                done ? "text-primary" : active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
