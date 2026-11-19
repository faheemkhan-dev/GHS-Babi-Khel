// src/pages/admin/tabs/AdminAdmissionView.tsx — the redesigned ADMIN
// "Application View" dialog (opened by the View button in Admin → Admissions).
//
// Replaces the old single long "View & Manage" form with a GHSS-Ghallanai
// style record view:
//
//   header   avatar · name · father · reference (tap to copy) · stage / fee /
//            type badges · quick Fee action
//   facts    Class · Type · Applied · Marks (4 tiles)
//   tabs     Details   — Application / Applicant / Academic / Fee review tables
//            Documents — uploaded files with Download
//            Status    — migration step · status picker · notes · admission no.
//                        · Save · danger zone (delete)
//            Timeline  — the same Application Timeline card the applicant sees
//
// Every behaviour of the old dialog is preserved: the status change goes
// through the update_admission_status RPC (timeline row + SMS + waitlist
// promotion), other fields use a direct update, choosing Eligible auto-creates
// the fee challan, and delete removes the record with its documents.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Download, Loader2, Trash2, AlertTriangle, Wallet, Copy, Check,
  ClipboardList, FolderOpen, ShieldCheck, History, RefreshCw, BadgeCheck,
  CalendarDays, GraduationCap, Percent, Repeat2, Save, Info,
} from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import {
  useAdmissionDocuments, useUpdateAdmission, useUpdateAdmissionStatus,
  useDeleteAdmission, type Admission, type AdmissionStatus,
} from "@/hooks/useAdmission";
import { paymentMethodLabel, formatDeadline, formatFeeDate } from "@/lib/admissionPayment";
import { createChallanForEligibleApplicant, downloadFile, MIGRATION_STEPS } from "@/lib/admissionChallan";
import { STATUS_CONFIG, STATUS_GROUPS, initials } from "@/lib/admissionAdminStatus";
import AdmissionReviewTable from "@/components/admissions/AdmissionReviewTable";
import ApplicationTracker from "@/components/admissions/ApplicationTracker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type TabKey = "details" | "documents" | "status" | "timeline";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "details",   label: "Details",   icon: ClipboardList },
  { key: "documents", label: "Documents", icon: FolderOpen },
  { key: "status",    label: "Status",    icon: ShieldCheck },
  { key: "timeline",  label: "Timeline",  icon: History },
];

const maybe = (v: string | null | undefined): string | null => (v && String(v).trim() ? String(v).trim() : null);
const pretty = (v: string | null | undefined): string | null =>
  v ? v.charAt(0).toUpperCase() + v.slice(1) : null;

/** A pill that reads the application's status (workflow) only. */
function StageBadge({ status }: { status: AdmissionStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${STATUS_CONFIG[status].badge}`}>
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
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${tone}`}>
      {label}{s === "paid" && app.payment_method ? ` · ${paymentMethodLabel(app.payment_method)}` : ""}
    </span>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-card px-2 py-2.5 text-center shadow-sm">
      <p className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0 text-primary" /> {label}
      </p>
      <p className="mt-1 truncate text-[12.5px] font-bold leading-tight">{value}</p>
    </div>
  );
}

export default function AdminAdmissionView({
  app, onClose, onOpenFee,
}: {
  app: Admission;
  onClose: () => void;
  /** Opens the Processing Fee dialog for this application (parent owns it). */
  onOpenFee?: (a: Admission) => void;
}) {
  const qc = useQueryClient();
  const updateMut = useUpdateAdmission();
  const updateStatusMut = useUpdateAdmissionStatus();
  const deleteMut = useDeleteAdmission();
  const { data: docs = [], isLoading: docsLoading } = useAdmissionDocuments(app.id);

  const [tab, setTab] = useState<TabKey>("details");
  const [copied, setCopied] = useState(false);

  // Status-tab form state
  const [status, setStatus] = useState<AdmissionStatus>(app.status);
  const [note, setNote] = useState(app.admin_note ?? "");
  const [reason, setReason] = useState(app.rejection_reason ?? "");
  const [rollNo, setRollNo] = useState(app.admission_roll_no ?? "");
  const [migStep, setMigStep] = useState<number>(app.migration_step ?? 1);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isMigration = app.admission_type === "migration";
  const feePaid = app.payment_status === "paid";
  const feeOn = Number(app.processing_fee ?? 0) > 0;

  // Timeline — only fetched when the tab is opened.
  const timelineQ = useQuery({
    queryKey: ["admin-admission-timeline", app.id],
    enabled: tab === "timeline",
    staleTime: 15 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admission_status_timeline")
        .select("id, from_status, to_status, note, actor, created_at")
        .eq("admission_id", app.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(app.reference_no);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy — select the reference and copy it manually.");
    }
  };

  const dirty =
    status !== app.status ||
    note !== (app.admin_note ?? "") ||
    reason !== (app.rejection_reason ?? "") ||
    rollNo !== (app.admission_roll_no ?? "") ||
    (isMigration && migStep !== (app.migration_step ?? 1));

  const handleSave = async () => {
    setSaving(true);
    try {
      const statusChanged = status !== app.status;

      // 1 · Status change → the RPC (timeline row + SMS + waitlist promotion).
      if (statusChanged) {
        let rpcNote: string | null = note || null;
        if (status === "rejected" && reason) rpcNote = reason;
        if (status === "documents_missing" && note) rpcNote = note;
        await updateStatusMut.mutateAsync({ id: app.id, newStatus: status, note: rpcNote });
      }

      // 2 · Other fields → direct update, only what actually changed.
      const updates: Partial<Admission> = {};
      if (rollNo !== (app.admission_roll_no ?? "")) updates.admission_roll_no = rollNo || null;
      if (isMigration && migStep !== (app.migration_step ?? 1)) updates.migration_step = migStep;
      if (reason !== (app.rejection_reason ?? "")) updates.rejection_reason = reason || null;
      if (!statusChanged && note !== (app.admin_note ?? "")) updates.admin_note = note || null;
      if (Object.keys(updates).length > 0) {
        await updateMut.mutateAsync({ id: app.id, updates });
      }

      toast.success(
        statusChanged
          ? `Status updated to “${STATUS_CONFIG[status].label}” — applicant will be notified by SMS.`
          : "Application updated.",
      );

      // 3 · Eligible → challan is created automatically (own try: never undoes the save).
      if (status === "approved") {
        try {
          const result = await createChallanForEligibleApplicant({
            ...app, admission_roll_no: rollNo || app.admission_roll_no, status,
          });
          qc.invalidateQueries({ queryKey: ["admin-students"] });
          if (result.voucherNumber && result.voucherAmount && !result.alreadyExisted) {
            const feeLabel = result.feeType === "migration" ? "Migration fee" : "Admission fee";
            toast.success(
              `${feeLabel} challan created — Rs ${result.voucherAmount.toLocaleString("en-PK")} · ${result.voucherNumber}`,
              { icon: "🧾", duration: 6000 },
            );
          } else if (result.skippedReason) {
            toast(`Saved, but no challan was created: ${result.skippedReason}`, { icon: "⚠️", duration: 8000 });
          }
        } catch (chErr: any) {
          toast.error(`Saved, but challan creation failed: ${chErr?.message ?? "unknown error"}`, { duration: 8000 });
        }
      }

      qc.invalidateQueries({ queryKey: ["admin-admission-timeline", app.id] });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync(app.id);
      toast.success("Application deleted.");
      setConfirmDelete(false);
      onClose();
    } catch {
      toast.error("Failed to delete the application.");
    }
  };

  const marksLabel = maybe(app.previous_marks) ?? "N/A";

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Application — {app.full_name}</DialogTitle>
            <DialogDescription>View and manage application {app.reference_no}</DialogDescription>
          </DialogHeader>

          {/* ══ Header band ═══════════════════════════════════════════════ */}
          <div className="relative shrink-0 border-b border-border/60 bg-gradient-to-br from-primary/10 via-card to-gold/10 px-4 pb-4 pt-5 sm:px-6">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
            <div className="flex flex-col items-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold/50 bg-card font-heading text-lg font-bold text-primary shadow-sm ring-4 ring-gold/10">
                {initials(app.full_name)}
              </span>
              <h2 className="mt-2.5 font-heading text-lg font-bold leading-tight break-words sm:text-xl">{app.full_name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">S/O {app.father_name}</p>

              <button
                type="button"
                onClick={copyRef}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-[11.5px] font-bold tracking-wider text-primary transition-colors hover:bg-primary/15"
                title="Copy reference number"
              >
                {app.reference_no}
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-70" />}
              </button>

              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                <StageBadge status={app.status} />
                {feeOn && <FeeBadge app={app} />}
              </div>

              {feeOn && onOpenFee && (
                <Button
                  size="sm"
                  variant={feePaid ? "outline" : "default"}
                  onClick={() => onOpenFee(app)}
                  className="mt-3 h-8 gap-1.5 rounded-full px-4 text-[11.5px] font-bold shadow-none"
                >
                  <Wallet className="h-3.5 w-3.5" /> {feePaid ? "View Fee" : "Record Fee"}
                </Button>
              )}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2">
              <Fact icon={GraduationCap} label="Class" value={`Class ${app.applying_class}`} />
              <Fact icon={Repeat2} label="Type" value={isMigration ? "Migration" : "Fresh"} />
              <Fact icon={CalendarDays} label="Applied" value={format(new Date(app.created_at), "dd MMM yy")} />
              <Fact icon={Percent} label="Marks" value={marksLabel} />
            </div>
          </div>

          {/* ══ Tabs ══════════════════════════════════════════════════════ */}
          <div className="shrink-0 border-b border-border/60 bg-muted/30 px-3 py-2 sm:px-5">
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-border/60 bg-card p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10.5px] font-bold transition-colors sm:flex-row sm:gap-1.5 sm:text-xs ${
                    tab === t.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {t.key === "documents" && docs.length > 0 && (
                    <span className={`rounded-full px-1.5 text-[9px] ${tab === t.key ? "bg-white/25" : "bg-primary/10 text-primary"}`}>{docs.length}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ══ Body ══════════════════════════════════════════════════════ */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
            {/* ── Details ─────────────────────────────────────────────── */}
            {tab === "details" && (
              <div className="space-y-3.5">
                <AdmissionReviewTable
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
                        <p className="mb-0.5 font-bold">Admin note (visible to the applicant)</p>
                        <p className="leading-relaxed">{app.admin_note}</p>
                      </div>
                    )}
                    {app.rejection_reason && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                        <p className="mb-0.5 font-bold">Rejection reason</p>
                        <p className="leading-relaxed">{app.rejection_reason}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Documents ───────────────────────────────────────────── */}
            {tab === "documents" && (
              <div>
                {docsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 rounded-xl" />
                    <Skeleton className="h-12 rounded-xl" />
                  </div>
                ) : docs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 py-12 text-center">
                    <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm font-semibold">No documents uploaded</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                      The applicant has not uploaded anything yet. Merit-listed students bring originals to the school office.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {docs.map((doc) => (
                      <li key={doc.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <FileText className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold capitalize">{doc.doc_type.replace(/_/g, " ")}</p>
                          <p className="truncate text-[10.5px] text-muted-foreground">
                            {doc.file_name || "document"} · {format(new Date(doc.uploaded_at), "dd MMM yyyy")}
                          </p>
                        </div>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => downloadFile(doc.file_path, `${doc.doc_type}_${app.full_name}`)}
                          className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px] font-bold shadow-none"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ── Status ──────────────────────────────────────────────── */}
            {tab === "status" && (
              <div className="space-y-4">
                {isMigration && (
                  <section className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm">
                    <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold">
                      <RefreshCw className="h-3.5 w-3.5 text-primary" /> Migration progress
                      <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">Step {migStep} / {MIGRATION_STEPS.length}</span>
                    </p>
                    <ol className="space-y-1">
                      {MIGRATION_STEPS.map((s, i) => {
                        const n = i + 1;
                        const done = n < migStep;
                        const current = n === migStep;
                        return (
                          <li key={s}>
                            <button
                              type="button"
                              onClick={() => setMigStep(n)}
                              className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                                current ? "border-primary/40 bg-primary/10 font-bold text-primary"
                                  : done ? "border-green-200/70 bg-green-50/60 text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-400"
                                  : "border-transparent text-muted-foreground hover:bg-muted/50"
                              }`}
                            >
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                done ? "bg-green-500 text-white" : current ? "bg-primary text-primary-foreground" : "bg-muted"
                              }`}>
                                {done ? <Check className="h-3 w-3" /> : n}
                              </span>
                              <span className="min-w-0 flex-1 leading-snug">{s}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                )}

                <section className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm">
                  <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Application status
                  </p>
                  <div className="space-y-2.5">
                    {STATUS_GROUPS.map((g) => (
                      <div key={g.title}>
                        <p className="mb-1 text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground">{g.title}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {g.items.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setStatus(s)}
                              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                                status === s
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : "border-border/70 bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                              }`}
                            >
                              {STATUS_CONFIG[s].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span><b className="text-foreground">{STATUS_CONFIG[status].label}</b> — {STATUS_CONFIG[status].desc}</span>
                  </p>

                  {status === "approved" && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-300">
                      <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Saving as Eligible creates the {isMigration ? "migration" : "admission"} fee challan automatically.
                    </p>
                  )}
                  {feeOn && !feePaid && ["under_review", "merit_listed", "admitted", "admit_card_issued"].includes(status) && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      The processing fee is not paid yet. Unpaid applications are not ranked in the merit list.
                    </p>
                  )}
                </section>

                {status === "rejected" && (
                  <div>
                    <Label className="mb-1.5 block text-xs font-bold">Rejection reason</Label>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Explain why this application was rejected… (sent to the applicant)"
                      className="min-h-[72px] rounded-xl text-xs"
                    />
                  </div>
                )}

                <div>
                  <Label className="mb-1.5 block text-xs font-bold">Admin note <span className="font-normal text-muted-foreground">(visible to the applicant)</span></Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional message to the applicant… e.g. which document is missing"
                    className="min-h-[72px] rounded-xl text-xs"
                  />
                </div>

                <div>
                  <Label className="mb-1 block text-xs font-bold">Admission No.</Label>
                  <p className="mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    Registration number for this applicant — <b>not</b> the class roll number.
                  </p>
                  <Input
                    value={rollNo}
                    onChange={(e) => setRollNo(e.target.value)}
                    placeholder="e.g. OHS-26-001"
                    className="h-10 rounded-xl text-sm"
                  />
                </div>

                <Button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="h-11 w-full gap-2 rounded-full text-xs font-bold shadow-none"
                >
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Save className="h-4 w-4" /> {dirty ? "Save Changes" : "No changes to save"}</>}
                </Button>

                <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-red-800 dark:text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> Danger Zone
                  </p>
                  <p className="mb-2.5 text-[11px] leading-relaxed text-red-700 dark:text-red-300/90">
                    Permanently delete this application with its documents and timeline. This cannot be undone.
                  </p>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setConfirmDelete(true)}
                    disabled={deleteMut.isPending}
                    className="h-9 w-full gap-1.5 rounded-full border-destructive/40 text-xs font-bold text-destructive shadow-none hover:bg-destructive/10"
                  >
                    {deleteMut.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</> : <><Trash2 className="h-3.5 w-3.5" /> Delete Application</>}
                  </Button>
                </section>
              </div>
            )}

            {/* ── Timeline ────────────────────────────────────────────── */}
            {tab === "timeline" && (
              <div>
                {timelineQ.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                ) : timelineQ.isError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-300">Couldn’t load the timeline</p>
                    <Button size="sm" variant="outline" onClick={() => timelineQ.refetch()} className="mt-3 h-8 gap-1.5 rounded-full px-4 text-xs font-bold">
                      <RefreshCw className="h-3.5 w-3.5" /> Try again
                    </Button>
                  </div>
                ) : (timelineQ.data ?? []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 py-12 text-center">
                    <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm font-semibold">No status changes yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">Every status change appears here and on the applicant’s tracker.</p>
                  </div>
                ) : (
                  <ApplicationTracker timeline={timelineQ.data as any} currentStatus={app.status} />
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Application</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <b>{app.reference_no}</b> of <b>{app.full_name}</b>? Its documents and timeline are removed too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 sm:flex-none">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
