// src/pages/admin/tabs/AdminAdmissionView.tsx — Admin "Application View".
// Details-only record view (opened by View in Admin → Admissions):
//   header  avatar · name · father · reference (tap to copy) · stage / fee badges
//   facts   Class · Type · Applied · Marks
//   details Application / Applicant / Academic / Processing-fee tables
// Fee actions live on the card's own Fee button (no duplicate here);
// Documents / Status / Timeline tabs were intentionally removed.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Copy, Check, CalendarDays, GraduationCap, Percent, Repeat2, X, type LucideIcon } from "lucide-react";
import toast from "react-hot-toast";
import { type Admission, type AdmissionStatus } from "@/hooks/useAdmission";
import { paymentMethodLabel, formatDeadline, formatFeeDate } from "@/lib/admissionPayment";
import { STATUS_CONFIG, initials } from "@/lib/admissionAdminStatus";
import AdmissionReviewTable from "@/components/admissions/AdmissionReviewTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const maybe = (v: string | null | undefined): string | null => (v && String(v).trim() ? String(v).trim() : null);
const pretty = (v: string | null | undefined): string | null =>
  v ? v.charAt(0).toUpperCase() + v.slice(1) : null;

/** A pill that reads the application's status (workflow) only. */
function StageBadge({ status }: { status: AdmissionStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-[2px] text-[10px] font-semibold ${STATUS_CONFIG[status].badge}`}>
      {STATUS_CONFIG[status].label}
    </span>
  );
}

/** A pill that reads the processing fee (money) only. */
function FeeBadge({ app }: { app: Admission }) {
  const s = app.payment_status || "pending";
  const tone =
    s === "paid"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
      : s === "rejected"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";
  const label = s === "paid" ? "Fee Paid" : s === "rejected" ? "Fee Rejected" : "Fee Pending";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-[2px] text-[10px] font-semibold ${tone}`}>
      {label}{s === "paid" && app.payment_method ? ` · ${paymentMethodLabel(app.payment_method)}` : ""}
    </span>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card px-1.5 py-2 text-center">
      <p className="flex items-center justify-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 text-[hsl(var(--gold))]" /> {label}
      </p>
      <p className="mt-1 truncate text-[12px] font-semibold leading-tight text-foreground">{value}</p>
    </div>
  );
}

export default function AdminAdmissionView({
  app, onClose,
}: {
  app: Admission;
  onClose: () => void;
  /** Kept for compatibility with the parent — the Fee action lives on the card. */
  onOpenFee?: (a: Admission) => void;
}) {
  const [copied, setCopied] = useState(false);

  const isMigration = app.admission_type === "migration";
  const feePaid = app.payment_status === "paid";
  const feeOn = Number(app.processing_fee ?? 0) > 0;

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(app.reference_no);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the reference and copy it manually.");
    }
  };

  const marksLabel = maybe(app.previous_marks) ?? "N/A";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Application — {app.full_name}</DialogTitle>
          <DialogDescription>Details of application {app.reference_no}</DialogDescription>
        </DialogHeader>

        {/* ══ Header band ═════════════════════════════════════════════ */}
        <div className="relative shrink-0 border-b border-border/60 bg-gradient-to-br from-primary/10 via-card to-gold/10 px-4 pb-3.5 pt-4">
          <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/50 bg-card font-heading text-base font-bold text-primary ring-4 ring-gold/10">
              {initials(app.full_name)}
            </span>
            <h2 className="mt-2 break-words font-heading text-[17px] font-bold leading-tight">{app.full_name}</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">S/O {app.father_name}</p>

            <button
              type="button"
              onClick={copyRef}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-[3px] font-mono text-[11px] font-semibold tracking-wider text-primary transition-colors hover:bg-primary/15"
              title="Copy reference number"
            >
              {app.reference_no}
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-70" />}
            </button>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <StageBadge status={app.status} />
              {feeOn && <FeeBadge app={app} />}
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-4 gap-1.5">
            <Fact icon={GraduationCap} label="Class" value={`Class ${app.applying_class}`} />
            <Fact icon={Repeat2} label="Type" value={isMigration ? "Migration" : "Fresh"} />
            <Fact icon={CalendarDays} label="Applied" value={format(new Date(app.created_at), "dd MMM yy")} />
            <Fact icon={Percent} label="Marks" value={marksLabel} />
          </div>
        </div>

        {/* ══ Details ═════════════════════════════════════════════════ */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3.5 sm:px-4">
          <div className="space-y-3">
            <AdmissionReviewTable
              compact
              title="Application"
              rows={[
                { label: "Applying for Class", value: `Class ${app.applying_class}` },
                { label: "Admission Type", value: isMigration ? "Migration / Transfer" : "Fresh Admission" },
                { label: "Reference No.", value: <span className="font-mono">{app.reference_no}</span> },
                { label: "Admission No.", value: maybe(app.admission_roll_no) ?? "Not assigned" },
                { label: "Applied On", value: formatFeeDate(app.created_at) },
                { label: "Last Updated", value: formatFeeDate(app.updated_at) },
              ]}
            />
            <AdmissionReviewTable
              compact
              title="Applicant Information"
              rows={[
                { label: "Name", value: app.full_name },
                { label: "Father Name", value: app.father_name },
                { label: "B-Form No.", value: <span className="font-mono">{app.b_form_no}</span> },
                { label: "Date of Birth", value: app.date_of_birth ? formatFeeDate(app.date_of_birth) : null },
                { label: "Gender", value: pretty(app.gender) },
                { label: "Contact", value: <span className="font-mono">{app.contact_number}</span> },
                { label: "WhatsApp", value: app.whatsapp_number ? <span className="font-mono">{app.whatsapp_number}</span> : null },
                { label: "Father's CNIC", value: maybe(app.father_cnic) ? <span className="font-mono">{app.father_cnic}</span> : null },
                { label: "Occupation", value: maybe(app.occupation) },
                { label: "Home Address", value: maybe(app.home_address), wide: true },
              ]}
            />
            <AdmissionReviewTable
              compact
              title="Academic Information"
              rows={[
                { label: "Previous School", value: maybe(app.previous_school), wide: true },
                { label: "Previous Class", value: maybe(app.previous_class) },
                { label: "Marks / Grade", value: maybe(app.previous_marks) },
                { label: "Year of Passing", value: maybe(app.year_of_passing) },
              ]}
            />
            {feeOn && (
              <AdmissionReviewTable
              compact
                title="Processing Fee"
                rows={[
                  { label: "Amount", value: `Rs ${Number(app.processing_fee).toLocaleString("en-PK")}` },
                  { label: "Fee Status", value: <FeeBadge app={app} /> },
                  { label: "Payment Reference", value: app.payment_reference ? <span className="font-mono">{app.payment_reference}</span> : "Not generated" },
                  { label: "Paid Via", value: app.payment_method ? paymentMethodLabel(app.payment_method) : null },
                  { label: "Receipt No.", value: maybe(app.payment_receipt) },
                  { label: feePaid ? "Paid On" : "Fee Deadline", value: feePaid ? (app.paid_at ? formatDeadline(app.paid_at) : null) : (app.fee_deadline ? formatDeadline(app.fee_deadline) : null) },
                ]}
              />
            )}
            {(app.admin_note || app.rejection_reason) && (
              <div className="space-y-2">
                {app.admin_note && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
                    <p className="mb-0.5 font-semibold">Admin note (visible to the applicant)</p>
                    <p className="leading-relaxed">{app.admin_note}</p>
                  </div>
                )}
                {app.rejection_reason && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                    <p className="mb-0.5 font-semibold">Rejection reason</p>
                    <p className="leading-relaxed">{app.rejection_reason}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
