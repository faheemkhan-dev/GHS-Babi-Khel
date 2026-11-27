// src/pages/admin/tabs/AdminAdmissionView.tsx — Admin "Application View".
// Opened by View in Admin → Admissions. Details + the complete action set:
//
//   header    avatar · name · father · reference (tap to copy) · stage / fee badges
//   facts     Class · Type · Applied · Marks
//   details   Application / Applicant / Academic (+ board & migration) / fee tables
//   actions   Verify Documents · Admit (admission no + date + BISEP enrollment
//             no.) · Reject (reason) · Migration step (1–6) · Board fee —
//             every action goes through its migration-22 RPC, so the timeline
//             row is written and the applicant's tracker updates.
//   history   status timeline (what the applicant sees in their portal)
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Copy, Check, CalendarDays, GraduationCap, Percent, Repeat2, X, BadgeCheck,
  Ban, ShieldCheck, Loader2, RefreshCw, Landmark, ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import {
  type Admission, useAdmissionVerifyDocuments, useAdmissionReject, useAdmissionAdmit,
  useAdmissionSetBoardFee, useAdmissionSetMigrationStep,
} from "@/hooks/useAdmission";
import { paymentMethodLabel, formatDeadline, formatFeeDate } from "@/lib/admissionPayment";
import { STATUS_CONFIG, initials } from "@/lib/admissionAdminStatus";
import { MIGRATION_STEPS } from "@/lib/admissionRules";
import AdmissionReviewTable from "@/components/admissions/AdmissionReviewTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const maybe = (v: string | null | undefined): string | null => (v && String(v).trim() ? String(v).trim() : null);
const pretty = (v: string | null | undefined): string | null =>
  v ? v.charAt(0).toUpperCase() + v.slice(1) : null;

/** A pill that reads the application's status (workflow) only. */
function StageBadge({ status }: { status: Admission["status"] }) {
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

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card px-1.5 py-2 text-center">
      <p className="flex items-center justify-center gap-1 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 text-[hsl(var(--gold))]" /> {label}
      </p>
      <p className="mt-1 truncate text-[12px] font-semibold leading-tight text-foreground">{value}</p>
    </div>
  );
}

/** Slim rectangle action button (thin, mobile-friendly). */
function ActButton({ icon: Icon, label, onClick, tone = "primary", disabled, busy }: {
  icon: LucideIcon; label: string; onClick: () => void;
  tone?: "primary" | "outline" | "danger" | "green"; disabled?: boolean; busy?: boolean;
}) {
  const cls =
    tone === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90"
    : tone === "green" ? "bg-green-700 text-white hover:bg-green-800"
    : tone === "danger" ? "border-red-300/70 text-red-600 hover:bg-red-500/10"
    : "border-border bg-card text-foreground hover:bg-muted/50";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-[11.5px] font-bold transition-colors disabled:opacity-50 ${cls}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

export default function AdminAdmissionView({
  app, onClose, onOpenFee, onChanged,
}: {
  app: Admission;
  onClose: () => void;
  /** Kept for compatibility — the Fee action lives on the card. */
  onOpenFee?: (a: Admission) => void;
  /** Fires after any successful action so the parent list can refetch. */
  onChanged?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [action, setAction] = useState<"admit" | "reject" | null>(null);

  // Action forms
  const [admissionNo, setAdmissionNo] = useState(app.admission_roll_no ?? "");
  const [admissionDate, setAdmissionDate] = useState(
    app.admission_date ?? format(new Date(), "yyyy-MM-dd"),
  );
  const [bisepNo, setBisepNo] = useState(app.bisep_enrollment_no ?? "");
  const [rejectReason, setRejectReason] = useState("");

  const verifyMut = useAdmissionVerifyDocuments();
  const rejectMut = useAdmissionReject();
  const admitMut = useAdmissionAdmit();
  const boardFeeMut = useAdmissionSetBoardFee();
  const migStepMut = useAdmissionSetMigrationStep();

  // Status timeline (read live)
  const timelineQ = useQuery({
    queryKey: ["admin-admission-timeline", app.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admission_status_timeline")
        .select("id, from_status, to_status, note, actor, created_at")
        .eq("admission_id", app.id)
        .order("created_at", { ascending: true })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; from_status: string | null; to_status: string; note: string | null;
        actor: string; created_at: string;
      }>;
    },
  });

  const isMigration = app.admission_type === "migration";
  const feePaid = app.payment_status === "paid";
  const feeOn = Number(app.processing_fee ?? 0) > 0;
  const isBoardClass = ["9", "10"].includes(app.applying_class);
  const isRejected = app.status === "rejected";
  const isAdmitted = ["admitted", "admit_card_issued"].includes(app.status);
  const currentMigStep = app.migration_step ?? 1;

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(app.reference_no);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the reference and copy it manually.");
    }
  };

  const runVerify = async () => {
    try {
      await verifyMut.mutateAsync({ id: app.id });
      toast.success("Documents marked verified — the applicant can see it in their tracker.");
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Could not verify documents."); }
  };

  const runAdmit = async () => {
    if (!admissionNo.trim()) { toast.error("Enter the admission number."); return; }
    try {
      await admitMut.mutateAsync({
        id: app.id,
        admissionNo,
        admissionDate: admissionDate || null,
        bisepEnrollmentNo: bisepNo,
      });
      toast.success(
        app.applying_class === "9" && !isMigration
          ? `Admitted. Enroll ${app.full_name} with BISE Peshawar and record the enrollment no. in Board Fee below.`
          : "Admitted.",
      );
      setAction(null);
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Could not admit."); }
  };

  const runReject = async () => {
    if (!rejectReason.trim()) { toast.error("Enter the reason — it is shown to the applicant."); return; }
    try {
      await rejectMut.mutateAsync({ id: app.id, reason: rejectReason });
      toast.success("Application rejected.");
      setAction(null);
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Could not reject."); }
  };

  const runBoardFee = async (status: "n_a" | "pending" | "paid") => {
    try {
      await boardFeeMut.mutateAsync({ id: app.id, status });
      toast.success(status === "paid" ? "BISE Peshawar enrollment fee marked deposited." : "Board fee status updated.");
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Could not update the board fee."); }
  };

  const runMigStep = async (step: number) => {
    try {
      await migStepMut.mutateAsync({ id: app.id, step });
      toast.success(`Migration progress set to step ${step} of 6.`);
      onChanged?.();
    } catch (e: any) { toast.error(e?.message || "Could not update the migration step."); }
  };

  const marksLabel = maybe(app.previous_marks) ?? "N/A";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Application — {app.full_name}</DialogTitle>
          <DialogDescription>Details and actions for application {app.reference_no}</DialogDescription>
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

        {/* ══ Details + actions ═══════════════════════════════════════ */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3.5 sm:px-4">
          <div className="space-y-3">

            {/* ── ACTIONS — the admin can finally complete an admission ── */}
            {!isRejected && (
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.03] p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-foreground">
                  <ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Actions
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <ActButton
                    icon={ShieldCheck} label="Verify Documents" tone="outline"
                    onClick={runVerify} busy={verifyMut.isPending}
                    disabled={app.status === "documents_verified" || isAdmitted}
                  />
                  <ActButton
                    icon={BadgeCheck} label="Admit" tone="green"
                    onClick={() => setAction("admit")}
                    disabled={isAdmitted}
                  />
                  {isBoardClass && app.status === "admitted" && (
                    <ActButton
                      icon={Landmark}
                      label={app.board_fee_status === "paid" ? "Board Fee: Paid" : "Board Fee Deposited"}
                      tone="outline"
                      onClick={() => runBoardFee(app.board_fee_status === "paid" ? "pending" : "paid")}
                      busy={boardFeeMut.isPending}
                      disabled={app.board_fee_status === "n_a" && app.applying_class !== "9"}
                    />
                  )}
                  <ActButton
                    icon={Ban} label="Reject" tone="danger"
                    onClick={() => setAction("reject")}
                  />
                </div>
                {app.status === "pending" && !feePaid && feeOn && (
                  <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">
                    The processing fee is still pending — record it with the Fee button on the card first;
                    only fee-paid applicants enter the merit list.
                  </p>
                )}
              </div>
            )}

            {/* ── Migration step control ── */}
            {isMigration && !isRejected && (
              <div className="rounded-2xl border border-primary/25 bg-card p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
                  <RefreshCw className="h-3.5 w-3.5 text-primary" /> Migration Progress (BISE Peshawar)
                </p>
                <p className="mb-2 text-[10.5px] leading-snug text-muted-foreground">
                  Our school is the receiving school — it applies for the migration on the board portal.
                  Move the tracker as each step completes; the applicant sees it live.
                </p>
                <Select value={String(currentMigStep)} onValueChange={v => runMigStep(Number(v))}>
                  <SelectTrigger className="h-9 rounded-md text-xs" aria-label="Migration step">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MIGRATION_STEPS.map((s, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{i + 1}. {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <AdmissionReviewTable
              compact
              title="Application"
              rows={[
                { label: "Applying for Class", value: `Class ${app.applying_class}` },
                { label: "Admission Type", value: isMigration ? "Migration / Transfer" : "Fresh Admission" },
                { label: "Reference No.", value: <span className="font-mono">{app.reference_no}</span> },
                { label: "Admission No.", value: maybe(app.admission_roll_no) ?? "Not assigned" },
                { label: "Admission Date", value: app.admission_date ? formatFeeDate(app.admission_date) : null },
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
                ...(maybe(app.previous_board) ? [{ label: "Previous Board", value: app.previous_board }] : []),
                ...(maybe(app.board_enrollment_no) ? [{ label: "Board Enrollment No.", value: <span className="font-mono">{app.board_enrollment_no}</span> }] : []),
                ...(app.previously_enrolled ? [{ label: "Enrolled with a board before", value: "Yes" }] : []),
                ...(maybe(app.board_roll_no) ? [{ label: "9th Roll No.", value: <span className="font-mono">{app.board_roll_no}</span> }] : []),
                ...(maybe(app.previous_result) ? [{ label: "9th Result", value: app.previous_result }] : []),
                ...(maybe(app.slc_no) ? [{ label: "SLC No.", value: <span className="font-mono">{app.slc_no}</span> }] : []),
                ...(app.slc_date ? [{ label: "SLC Date", value: formatFeeDate(app.slc_date) }] : []),
                ...(maybe(app.migration_cert_no) ? [{ label: "Migration Cert. No.", value: <span className="font-mono">{app.migration_cert_no}</span> }] : []),
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
            {app.applying_class === "9" && (
              <AdmissionReviewTable
                compact
                title="BISE Peshawar Enrollment (Class 9)"
                rows={[
                  { label: "BISEP Enrollment No.", value: maybe(app.bisep_enrollment_no) ?? "Not enrolled yet" },
                  { label: "Enrolled On", value: app.bisep_enrolled_at ? formatFeeDate(app.bisep_enrolled_at) : null },
                  { label: "Board Fee Status", value: app.board_fee_status === "paid" ? "Paid" : app.board_fee_status === "pending" ? "Pending" : "N/A" },
                  { label: "Board Fee Paid On", value: app.board_fee_paid_at ? formatFeeDate(app.board_fee_paid_at) : null },
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

            {/* ── Status timeline (what the applicant sees) ── */}
            <div className="rounded-2xl border border-border/60 bg-card p-3">
              <p className="mb-2 text-xs font-bold">History (applicant's timeline)</p>
              {timelineQ.isLoading ? (
                <p className="py-2 text-center text-[11px] text-muted-foreground">Loading…</p>
              ) : (timelineQ.data ?? []).length === 0 ? (
                <p className="py-2 text-center text-[11px] text-muted-foreground">No status changes yet.</p>
              ) : (
                <ol className="space-y-1.5">
                  {(timelineQ.data ?? []).map((t) => (
                    <li key={t.id} className="flex items-start gap-2 text-[11px] leading-snug">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {STATUS_CONFIG[t.to_status as keyof typeof STATUS_CONFIG]?.label ?? t.to_status}
                          {t.from_status && t.from_status !== t.to_status && (
                            <span className="font-normal text-muted-foreground">
                              {" "}← {STATUS_CONFIG[t.from_status as keyof typeof STATUS_CONFIG]?.label ?? t.from_status}
                            </span>
                          )}
                        </p>
                        {t.note && <p className="text-muted-foreground">{t.note}</p>}
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                          {format(new Date(t.created_at), "dd MMM yyyy, h:mm a")} · {t.actor}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        {/* ══ Admit / Reject dialog ═════════════════════════════════════ */}
        {action === "admit" && (
          <Dialog open onOpenChange={(o) => { if (!o) setAction(null); }}>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left text-base">
                  <BadgeCheck className="h-4 w-4 text-green-600" /> Confirm Admission
                </DialogTitle>
                <DialogDescription className="text-left text-xs leading-relaxed">
                  {app.full_name} · Class {app.applying_class} · {app.reference_no}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-xs font-bold">Admission No. <span className="text-red-500">*</span></Label>
                  <Input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)}
                    placeholder="e.g. 2026-118" className="h-9 rounded-md text-sm" />
                  <p className="mt-1 text-[10px] text-muted-foreground">Written into the school's admission register.</p>
                </div>
                <div>
                  <Label className="mb-1 block text-xs font-bold">Admission Date</Label>
                  <Input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)}
                    className="h-9 rounded-md text-sm" />
                </div>
                {app.applying_class === "9" && !isMigration && (
                  <div>
                    <Label className="mb-1 block text-xs font-bold">BISE Peshawar Enrollment No. (optional now)</Label>
                    <Input value={bisepNo} onChange={(e) => setBisepNo(e.target.value)}
                      placeholder="Fill after portal enrollment" className="h-9 rounded-md text-sm" />
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                      The school enrolls the student on portal.bisep.edu.pk after admission (Rs 1,300 by 30 Sep 2026).
                      You can record the number later with the Board Fee button.
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setAction(null)}
                    className="h-9 flex-1 rounded-md text-xs font-bold">Cancel</Button>
                  <Button onClick={runAdmit} disabled={admitMut.isPending}
                    className="h-9 flex-1 rounded-md bg-green-700 text-xs font-bold text-white hover:bg-green-800">
                    {admitMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm Admission"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {action === "reject" && (
          <Dialog open onOpenChange={(o) => { if (!o) setAction(null); }}>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-left text-base text-red-600">
                  <Ban className="h-4 w-4" /> Reject Application
                </DialogTitle>
                <DialogDescription className="text-left text-xs leading-relaxed">
                  {app.full_name} · {app.reference_no}. The reason below is shown to the applicant in their tracker.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="mb-1 block text-xs font-bold">Reason <span className="text-red-500">*</span></Label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="e.g. B-Form number does not match the document produced at the office."
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setAction(null)}
                    className="h-9 flex-1 rounded-md text-xs font-bold">Cancel</Button>
                  <Button variant="destructive" onClick={runReject} disabled={rejectMut.isPending}
                    className="h-9 flex-1 rounded-md text-xs font-bold">
                    {rejectMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reject"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
