import { useState, type ReactNode, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  useAdminAdmissions, useAdmissionDocuments, useUpdateAdmission,
  useUpdateAdmissionStatus,
  useDeleteAdmission,
  useUpdateAdmissionSettings, useAdmissionSettings,
  useSetAdmissionPayment, useAdmissionResetAll,
  Admission, AdmissionStatus
} from "@/hooks/useAdmission";
import { paymentMethodLabel, type AdmissionPaymentAccount, type PaymentMethod } from "@/lib/admissionPayment";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ClipboardList, GraduationCap, Eye, CheckCircle2, XCircle,
  Clock, FileText, Download, RefreshCw, ChevronLeft,
  ChevronRight, Settings2, Users, Loader2, Search,
  UserCheck, AlertTriangle, Trash2, X,
  Wallet, Calendar, MapPin, Plus, BadgeCheck, Armchair, Trophy, UserPlus
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

const AdminAdmissionClasses = lazy(() => import("./AdminAdmissionClasses"));
const AdminAdmissionMeritLists = lazy(() => import("./AdminAdmissionMeritLists"));
const AdminWalkinDialog = lazy(() => import("./AdminWalkinDialog"));

const PAGE_SIZE = 20;

const statusConfig: Record<AdmissionStatus, { label: string; badge: string; desc: string }> = {
  pending:              { label: "Pending",              badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",         desc: "Eligibility application received — review needed" },
  under_review:         { label: "Under Review",         badge: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800",     desc: "Currently reviewing eligibility" },
  approved:             { label: "Eligible ✅",          badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",       desc: "Eligible for admission — ask student to bring documents" },
  rejected:             { label: "Not Eligible",         badge: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",           desc: "Does not meet eligibility criteria" },
  documents_missing:    { label: "Docs Missing",         badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",     desc: "Student needs to bring missing documents" },
  documents_verified:   { label: "Docs Verified",        badge: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800",         desc: "All documents verified at office" },
  interview_scheduled:  { label: "Interview Scheduled",  badge: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-800",         desc: "Interview slot booked" },
  interview_completed:  { label: "Interview Done",       badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",   desc: "Interview completed successfully" },
  waitlisted:           { label: "Waitlisted",           badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",       desc: "Waiting for a seat to open" },
  merit_listed:         { label: "Merit Listed 🎉",      badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",       desc: "Selected in a published merit list — seat confirmed by merit" },
  admitted:             { label: "Admitted ✅",          badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",       desc: "Fully admitted — enrolled in students register" },
  admit_card_issued:    { label: "Admit Card Issued",    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",       desc: "Admit card generated and issued" },
};

const MIGRATION_STEPS = [
  "Student submitted online application",
  "Migration letter written to current principal",
  "Current principal signed the letter",
  "Our school principal signed the letter",
  "Current school applied migration on BISEP",
  "Our school approved on BISEP",
  "Bank challan generated — fee submitted",
  "Migration completed ✅",
];

// ── Download a Cloudinary file by fetching it as a blob ──────────────────
async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "document";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    // Fallback: open in new tab
    window.open(url, "_blank");
  }
}

// ── Auto-create the admission/migration fee challan when an applicant is marked
// Eligible (status "approved") and the admin clicks Save. There is NO manual
// enroll step any more.
//
// A fee voucher must belong to a row in `students` (fee_vouchers.student_id is
// NOT NULL + FK), so a hidden register entry is created for the applicant:
// is_active=false (keeps it out of attendance / results / fee-generation lists)
// and roll_number = the applicant's reference no. (unique, clearly a placeholder
// — the admin sets the real class roll no. later in Students). Safe to call
// repeatedly: it never creates a second voucher for the same reference no.
export interface EnrollmentResult {
  studentId: string | null;
  voucherNumber: string | null;   // null = skipped
  voucherAmount: number | null;
  skippedReason?: string;
  feeType?: string;
  alreadyExisted?: boolean;       // true = challan was already created earlier
  paymentMethods?: PaymentMethod[];
}

async function createChallanForEligibleApplicant(app: Admission): Promise<EnrollmentResult> {
  const targetFeeType = app.admission_type === "migration" ? "migration" : "admission";
  const feeName = targetFeeType === "migration" ? "Migration" : "Admission";

  // 1. Never create a second challan for the same application.
  const { data: existingV } = await supabase
    .from("fee_vouchers")
    .select("voucher_number, total_amount")
    .ilike("notes", `%${app.reference_no}%`)
    .limit(1);
  if (existingV && existingV.length > 0) {
    return {
      studentId: null,
      voucherNumber: existingV[0].voucher_number,
      voucherAmount: Number(existingV[0].total_amount ?? 0),
      feeType: targetFeeType,
      alreadyExisted: true,
    };
  }

  // 2. Fee structure first — if no amount is configured, create nothing.
  const { data: feeStruct, error: fsErr } = await supabase
    .from("fee_structures")
    .select("id, label, amount, is_optional, payment_methods")
    .eq("class", app.applying_class)
    .eq("fee_type", targetFeeType)
    .eq("is_active", true)
    .maybeSingle();

  if (fsErr) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `Fee lookup failed: ${fsErr.message}`, feeType: targetFeeType };
  }
  if (!feeStruct) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `No "${targetFeeType}" fee structure configured for Class ${app.applying_class}`, feeType: targetFeeType };
  }
  const amount = Number(feeStruct.amount ?? 0);
  if (amount <= 0) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `${feeName} fee for Class ${app.applying_class} is set to Rs 0 — set an amount for this fee, then save this applicant again`, feeType: targetFeeType };
  }

  // 3. Hidden, inactive register entry (required by the voucher's student FK).
  let studentId: string | null = null;
  const { data: existingStu } = await supabase
    .from("students")
    .select("id")
    .eq("roll_number", app.reference_no)
    .eq("class", app.applying_class)
    .maybeSingle();
  if (existingStu?.id) {
    studentId = existingStu.id;
  } else {
    const { data: newStu, error: stuErr } = await supabase
      .from("students")
      .insert({
        full_name:   app.full_name,
        father_name: app.father_name,
        roll_number: app.reference_no,
        class:       app.applying_class,
        is_active:   false,
      })
      .select("id")
      .single();
    if (stuErr) throw new Error(stuErr.message);
    studentId = newStu?.id ?? null;
  }
  if (!studentId) throw new Error("Could not prepare the student record for the challan");

  // 4. Voucher number — ADM-YYYY-MM-DD-HHMMSS-xxxx, due in 14 days.
  const now = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const voucherNumber = `ADM-${ts}-${studentId.slice(-4).toUpperCase()}`;
  const due = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const dueDate = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;

  const { error: vErr } = await supabase.from("fee_vouchers").insert({
    voucher_number: voucherNumber,
    student_id:     studentId,
    class:          app.applying_class,
    month:          now.getMonth() + 1,
    year:           now.getFullYear(),
    fee_period:     "one_off",
    fee_items: [
      {
        fee_type:    targetFeeType,
        label:       feeStruct.label || `${feeName} Fee`,
        amount,
        is_optional: !!feeStruct.is_optional,
      },
    ],
    total_amount: amount,
    due_date:     dueDate,
    bank_details: { payment_methods: feeStruct.payment_methods || [] },
    status:       "unpaid",
    paid_amount:  0,
    late_fee:     0,
    // The applicant tracker finds the challan by this reference no. — keep the wording.
    notes: `Auto-generated on ${app.admission_type === "migration" ? "migration" : "admission"} approval of ${app.reference_no}`,
  });
  if (vErr) {
    return { studentId, voucherNumber: null, voucherAmount: null, skippedReason: `Voucher insert failed: ${vErr.message}`, feeType: targetFeeType };
  }

  return { studentId, voucherNumber, voucherAmount: amount, feeType: targetFeeType, paymentMethods: feeStruct.payment_methods || [] };
}

/* ── Detail Dialog ──────────────────────────────────────────────────────── */
function AdmissionDetail({ app, onClose, onSaved, onDelete }: { app: Admission; onClose: () => void; onSaved?: (id: string) => void; onDelete?: (id: string) => void }) {
  const updateMut       = useUpdateAdmission();
  const updateStatusMut = useUpdateAdmissionStatus();
  const deleteMut       = useDeleteAdmission();
  const qc              = useQueryClient();
  const { data: docs = [], isLoading: docsLoading } = useAdmissionDocuments(app.id);
  const [status,  setStatus]  = useState<AdmissionStatus>(app.status);
  const [note,    setNote]    = useState(app.admin_note ?? "");
  const [reason,  setReason]  = useState(app.rejection_reason ?? "");
  const [rollNo,  setRollNo]  = useState(app.admission_roll_no ?? "");
  const [migStep, setMigStep] = useState<number>(app.migration_step ?? 1);
  const [saving,  setSaving]  = useState(false);

  const isMigration = app.admission_type === "migration";
  const isApproved  = status === "approved";

  const handleSave = async () => {
    setSaving(true);
    try {
      const statusChanged = status !== app.status;

      // ── 1. Status change → call the RPC ────────────────────────────────
      // The RPC atomically: updates status, inserts a timeline entry,
      // sends an SMS to the applicant, and auto-promotes waitlisted
      // applicants when a seat frees up. We must NOT do this via a direct
      // table update or the applicant's portal will never update.
      if (statusChanged) {
        // For 'rejected' we use the rejection_reason as the note so the
        // SMS includes the reason. For 'documents_missing' we use the
        // admin note to explain what's missing. Otherwise just the note.
        let rpcNote: string | null = note || null;
        if (status === "rejected" && reason)        rpcNote = reason;
        if (status === "documents_missing" && note) rpcNote = note;

        await updateStatusMut.mutateAsync({
          id:        app.id,
          newStatus: status,
          note:      rpcNote,
        });
      }

      // ── 2. Other field changes → direct table update ──────────────────
      // (rejection_reason, admission_roll_no, migration_step, admin_note)
      // Only do this if a value actually changed, to avoid clobbering the
      // admin_note the RPC just set when statusChanged === true.
      const otherUpdates: Partial<Admission> = {};
      if (rollNo                    !== (app.admission_roll_no ?? "")) otherUpdates.admission_roll_no = rollNo || null;
      if (isMigration && migStep    !== (app.migration_step    ?? 1))  otherUpdates.migration_step    = migStep;
      if (reason                    !== (app.rejection_reason  ?? "")) otherUpdates.rejection_reason  = reason || null;
      if (!statusChanged && note    !== (app.admin_note        ?? "")) otherUpdates.admin_note        = note || null;

      if (Object.keys(otherUpdates).length > 0) {
        await updateMut.mutateAsync({ id: app.id, updates: otherUpdates });
      }

      toast.success(
        statusChanged
          ? `Status updated to "${statusConfig[status].label}" — applicant will be notified by SMS.`
          : "Application updated"
      );

      // Eligible → challan is created automatically (no enroll step).
      // Failure here must never undo the saved status, so it has its own try.
      if (status === "approved") {
        try {
          const result = await createChallanForEligibleApplicant({ ...app, admission_roll_no: rollNo || app.admission_roll_no, status });
          qc.invalidateQueries({ queryKey: ["admin-students"] });
          if (result.voucherNumber && result.voucherAmount && !result.alreadyExisted) {
            const feeLabel = result.feeType === "migration" ? "Migration fee" : "Admission fee";
            toast.success(`${feeLabel} challan created — Rs ${result.voucherAmount.toLocaleString("en-PK")} · ${result.voucherNumber}`, { icon: "🧾", duration: 6000 });
          } else if (result.skippedReason) {
            toast(`Saved, but no challan was created: ${result.skippedReason}`, { icon: "⚠️", duration: 8000 });
          }
        } catch (chErr: any) {
          toast.error(`Saved, but challan creation failed: ${chErr?.message ?? "unknown error"}`, { duration: 8000 });
        }
      }
      onSaved?.(app.id);
      onClose();
    } catch (err) {
      toast.error(err?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync(app.id);
      toast.success("Admission deleted successfully");
      onDelete?.(app.id);
      onClose();
    } catch {
      toast.error("Failed to delete admission");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{initials(app.full_name)}</span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-tight break-words">{app.full_name}</span>
              <span className="mt-0.5 block text-[11px] font-mono font-normal text-muted-foreground break-all">{app.reference_no}</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pb-2">
          <StatusPill status={app.status} />
          {/* Student info grid */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            {([
              ["Father",      app.father_name],
              ["Class",       `Class ${app.applying_class}`],
              ["Type",        app.admission_type],
              ["B-Form",      app.b_form_no],
              ["Contact",     app.contact_number],
              ["Gender",      app.gender ?? "—"],
              ["Prev School", app.previous_school ?? "—"],
              ["Prev Marks",  app.previous_marks ?? "—"],
              ["Applied",     format(new Date(app.created_at), "dd MMM yyyy")],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="bg-muted/40 border border-border/50 rounded-xl px-3 py-2 min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{k}</p>
                <p className="font-semibold text-xs break-words">{v}</p>
              </div>
            ))}
          </div>

          {/* Documents — with download button */}
          <div>
            <p className="text-xs font-bold mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Uploaded Documents
            </p>
            {docsLoading ? (
              <Skeleton className="h-10 rounded-lg" />
            ) : docs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No documents uploaded</p>
            ) : (
              <div className="space-y-1.5">
                {docs.map(doc => (
                  <div key={doc.id}
                    className="flex items-center gap-2 text-xs bg-muted/40 border border-border rounded-xl px-3 py-2">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="flex-1 min-w-0 break-words capitalize font-medium">
                      {doc.doc_type.replace(/_/g, " ")}
                    </span>
                    {/* Download button — fetches blob so file downloads, not opens */}
                    <button
                      onClick={() => downloadFile(doc.file_path, `${doc.doc_type}_${app.full_name}`)}
                      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border/60 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-none transition-colors hover:bg-primary/5"
                      title="Download">
                      <Download className="w-3 h-3" /> Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Migration step */}
          {isMigration && (
            <div>
              <Label className="text-xs font-bold mb-2 block flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Migration Step ({migStep}/8)
              </Label>
              <Select value={String(migStep)} onValueChange={v => setMigStep(Number(v))}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MIGRATION_STEPS.map((s, i) => (
                    <SelectItem key={i} value={String(i + 1)}>
                      Step {i + 1}: {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Status */}
          <div>
            <Label className="text-xs font-bold mb-1.5 block">Update Status</Label>
            <Select value={status} onValueChange={v => setStatus(v as AdmissionStatus)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(statusConfig) as AdmissionStatus[]).map(s => (
                  <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === "rejected" && (
            <div>
              <Label className="text-xs font-bold mb-1.5 block">Rejection Reason</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Explain why this application was rejected..."
                className="text-xs min-h-[70px]" />
            </div>
          )}

          <div>
            <Label className="text-xs font-bold mb-1.5 block">Admin Note (visible to student)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Optional message to the applicant..."
              className="text-xs min-h-[70px]" />
          </div>

          <div>
            <Label className="text-xs font-bold mb-1.5 block">Assign Admission No.</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Registration/admission number for this applicant. This is <b>not</b> the class roll
              number. Choosing <b>Eligible</b> and saving creates the fee challan automatically.
            </p>
            <Input value={rollNo} onChange={e => setRollNo(e.target.value)}
              placeholder="e.g. OHS-26-001" className="text-xs h-9" />
          </div>

          <Button onClick={handleSave} disabled={saving} className="h-9 w-full gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : "Save Changes"}
          </Button>

          {/* Delete admission */}
          <div className="border border-red-500/30 bg-red-500/10 rounded-xl p-3">
            <p className="text-xs font-bold text-red-800 dark:text-red-300 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Danger Zone
            </p>
            <p className="text-[11px] text-red-700 dark:text-red-300/90 mb-2">
              Permanently delete this admission record and all associated documents. This action cannot be undone.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={deleteMut.isPending}
                  className="h-9 w-full gap-1.5 whitespace-nowrap rounded-full border-destructive/40 px-4 text-xs font-semibold text-destructive shadow-none hover:bg-destructive/10">
                  {deleteMut.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Deleting...</>
                    : <><Trash2 className="w-3.5 h-3.5" /> Delete Admission</>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Admission?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete <strong>{app.full_name}</strong>'s admission ({app.reference_no}) and all uploaded documents. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 sm:flex-none">
                    Yes, Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Processing Fee dialog (the ONLY place the processing fee is recorded) ──
 * Separate from the admission-fee challan that is auto-created on approval —
 * this is the small up-front application fee that qualifies a student for
 * the merit list. */
function FeeDialog({ app, onClose, onSaved }: { app: Admission; onClose: () => void; onSaved?: () => void }) {
  const paymentMut = useSetAdmissionPayment();
  const [method, setMethod] = useState<string>(app.payment_method || "cash");
  const [receipt, setReceipt] = useState(app.payment_receipt || "");

  const run = async (status: "paid" | "rejected" | "pending") => {
    try {
      const res: any = await paymentMut.mutateAsync({ id: app.id, status, receipt, method });
      if (res?.unchanged) toast("No change — the fee was already in this state.", { icon: "ℹ️" });
      else if (status === "paid") toast.success(`Fee recorded — Rs ${app.processing_fee} via ${paymentMethodLabel(method)}.`);
      else if (status === "rejected") toast.success("Payment marked rejected.");
      else toast.success("Fee reset to pending.");
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Could not update the fee.");
    }
  };

  const paid = app.payment_status === "paid";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wallet className="w-4 h-4" /></span>
            Processing Fee
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {([
              ["Applicant", app.full_name],
              ["Reference", app.reference_no],
              ["Fee", `Rs ${app.processing_fee}`],
              ["Payment Ref.", app.payment_reference || "not generated"],
              ["Deadline", app.fee_deadline ? format(new Date(app.fee_deadline), "dd MMM yyyy") : "—"],
              ["Current", `${PAYMENT_STATUS_LABELS[app.payment_status] || app.payment_status}${app.payment_method ? ` · ${paymentMethodLabel(app.payment_method)}` : ""}`],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="bg-muted/40 border border-border/50 rounded-xl px-3 py-2 min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{k}</p>
                <p className="font-semibold text-xs break-words">{v}</p>
              </div>
            ))}
          </div>

          {paid ? (
            <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-3 text-xs text-green-800 dark:text-green-300 font-semibold">
              Fee received. This application is final.
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs font-bold mb-1.5 block">Paid by</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["bank", "Bank"], ["easypaisa", "EasyPaisa"], ["jazzcash", "JazzCash"],
                    ["cash", "Cash at School"], ["safepay", "Online Payment"], ["other", "Other"],
                  ].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setMethod(value)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        method === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:border-primary/40"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs font-bold mb-1.5 block">Receipt / transaction no. (optional)</Label>
                <Input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="e.g. RC-0042" className="h-9 text-sm" />
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={() => run("paid")} disabled={paymentMut.isPending}
                  className="h-10 w-full gap-1.5 rounded-full text-xs font-bold">
                  {paymentMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                  Mark Fee Paid (Rs {app.processing_fee})
                </Button>
                {app.payment_status === "rejected" ? (
                  <Button variant="outline" onClick={() => run("pending")} disabled={paymentMut.isPending}
                    className="h-9 w-full rounded-full text-xs font-semibold">Reset to Fee Pending</Button>
                ) : (
                  app.payment_status === "pending" && app.payment_reference && (
                    <Button variant="outline" onClick={() => run("rejected")} disabled={paymentMut.isPending}
                      className="h-9 w-full rounded-full border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10">Reject Payment</Button>
                  )
                )}
              </div>
            </>
          )}

          <p className="text-[10.5px] text-muted-foreground border-t border-border/60 pt-2.5">
            Fee is recorded here only. Review and merit are automatic: use the <b>Merit Lists</b> tab.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const PAYMENT_STATUS_LABELS: Record<string, string> = { pending: "Pending", paid: "Paid", rejected: "Rejected" };

const FeeStatusPill = ({ app }: { app: Admission }) => {
  const s = app.payment_status || "pending";
  const cls =
    s === "paid"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
      : s === "rejected"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {PAYMENT_STATUS_LABELS[s] || s}
      {app.payment_method && s === "paid" ? ` · ${paymentMethodLabel(app.payment_method)}` : ""}
    </span>
  );
};

/* ── Delete All (reset for the next session) — confirm dialog ─────────── */
function DeleteAllDialog({ count, open, onOpenChange }: { count: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const resetMut = useAdmissionResetAll();
  const [confirmText, setConfirmText] = useState("");

  const doReset = async () => {
    try {
      const res: any = await resetMut.mutateAsync();
      toast.success(`${res?.admissions ?? 0} application(s) deleted. Ready for the next session.`);
      onOpenChange(false);
      setConfirmText("");
    } catch (e: any) {
      toast.error(e?.message || "Reset failed.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmText(""); }}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-left">Delete EVERYTHING for the next session?</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-muted-foreground">
          This permanently deletes <b>{count}</b> application(s), all applicant documents, timelines, every merit
          list and the payment ledger. Classes, seats, settings and the students-register / fee-voucher records
          are kept. Use <b>Export Excel</b> first if you want a backup. This cannot be undone.
        </p>
        <div>
          <Label className="text-xs font-bold mb-1.5 block">Type DELETE ALL to confirm</Label>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE ALL" className="h-9 text-sm font-mono" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); setConfirmText(""); }}
            className="h-9 flex-1 rounded-full text-xs font-bold">Cancel</Button>
          <Button variant="destructive" disabled={confirmText !== "DELETE ALL" || resetMut.isPending} onClick={doReset}
            className="h-9 flex-1 rounded-full text-xs font-bold">
            {resetMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete Everything"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Settings Panel ─────────────────────────────────────────────────────── */
function AdmissionSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const { data: settings, isLoading } = useAdmissionSettings();
  const updateMut = useUpdateAdmissionSettings();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    is_open:        false,
    session_year:   "2026",
    open_date:      "",
    last_date:      "",
    banner_message: "",
    notes:          "",
    processing_fee: "100",
    contact_whatsapp: "",
    online_payment_enabled: false,
  });
  const [accounts, setAccounts] = useState<AdmissionPaymentAccount[]>([]);
  const [synced, setSynced] = useState(false);

  if (settings && !synced) {
    setForm({
      is_open:        settings.is_open,
      session_year:   settings.session_year,
      open_date:      settings.open_date ?? "",
      last_date:      settings.last_date ?? "",
      banner_message: settings.banner_message ?? "",
      notes:          settings.notes ?? "",
      processing_fee: String(settings.processing_fee ?? 100),
      contact_whatsapp: settings.contact_whatsapp ?? "",
      online_payment_enabled: !!settings.online_payment_enabled,
    });
    setAccounts((settings.payment_accounts ?? []) as AdmissionPaymentAccount[]);
    setSynced(true);
  }

  const setAccount = (i: number, patch: Partial<AdmissionPaymentAccount>) =>
    setAccounts((a) => a.map((acc, idx) => (idx === i ? { ...acc, ...patch } : acc)));

  const handleSave = async () => {
    setSaving(true);
    try {
      const feeNum = Number(form.processing_fee);
      await updateMut.mutateAsync({
        is_open:        form.is_open,
        session_year:   form.session_year,
        open_date:      form.open_date   || null,
        last_date:      form.last_date   || null,
        banner_message: form.banner_message || null,
        notes:          form.notes || null,
        processing_fee: Number.isFinite(feeNum) && feeNum >= 0 ? Math.round(feeNum) : 0,
        payment_accounts: accounts,
        online_payment_enabled: form.online_payment_enabled,
        contact_whatsapp: form.contact_whatsapp || null,
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <Card className={embedded ? "border-0 bg-transparent shadow-none" : "rounded-2xl border-border/60 shadow-sm"}>
      <CardContent className={embedded ? "p-0" : "p-4 sm:p-5"}>
        <PanelHeader icon={Settings2} title="Admission Settings" desc="Admission window, processing fee and payment accounts" />
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 border border-border/60 rounded-xl sm:col-span-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm">Admissions Open</p>
              <p className="text-xs text-muted-foreground">Shows banner & apply button on homepage</p>
            </div>
            <Switch checked={form.is_open} onCheckedChange={v => setForm(f => ({ ...f, is_open: v }))} />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1 block">Session Year</Label>
            <Input value={form.session_year}
              onChange={e => setForm(f => ({ ...f, session_year: e.target.value }))}
              placeholder="2026" className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1 block">Processing Fee (Rs)</Label>
            <Input type="number" min={0} value={form.processing_fee}
              onChange={e => setForm(f => ({ ...f, processing_fee: e.target.value }))}
              placeholder="100" className="h-9 text-sm" />
            <p className="text-[10px] text-muted-foreground mt-1">Set 0 to switch the processing fee off entirely.</p>
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1 block">Open Date</Label>
            <Input type="date" value={form.open_date ?? ""}
              onChange={e => setForm(f => ({ ...f, open_date: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1 block">Last Date</Label>
            <Input type="date" value={form.last_date ?? ""}
              onChange={e => setForm(f => ({ ...f, last_date: e.target.value }))} className="h-9 text-sm" />
            <p className="text-[10px] text-muted-foreground mt-1">Admission stays open until the last date; the fee deadline is its 23:59.</p>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold mb-1 block">Banner Message</Label>
            <Input value={form.banner_message ?? ""}
              onChange={e => setForm(f => ({ ...f, banner_message: e.target.value }))}
              placeholder="Admissions Open for Session 2026 — Apply Online Today"
              className="h-9 text-sm" />
          </div>
          {/* Online payment switch */}
          <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 border border-border/60 rounded-xl sm:col-span-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm">Online Payment (Safepay)</p>
              <p className="text-xs text-muted-foreground">Easypaisa / JazzCash / wallet checkout with automatic fee confirmation. Manual transfer always stays available. Also needs the SAFEPAY_* env keys on Vercel.</p>
            </div>
            <Switch checked={form.online_payment_enabled} onCheckedChange={v => setForm(f => ({ ...f, online_payment_enabled: v }))} />
          </div>

          {/* Payment accounts */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <Label className="text-xs font-bold">School Payment Accounts (printed on the fee challan)</Label>
              <Button size="sm" variant="outline" onClick={() => setAccounts(a => [...a, { type: "bank", bank_name: "", account_title: "", account_number: "", iban: "" }])}
                className="h-8 gap-1 rounded-full border-border/60 px-3 text-[11px] font-bold">
                <Plus className="w-3.5 h-3.5" /> Add Account
              </Button>
            </div>
            {accounts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground italic">No account added. Applicants will be told to pay at the school office.</p>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc, i) => (
                  <div key={i} className="p-2.5 rounded-xl border border-border/60 bg-muted/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <Select value={acc.type} onValueChange={v => setAccount(i, { type: v as AdmissionPaymentAccount["type"] })}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bank">Bank</SelectItem>
                          <SelectItem value="easypaisa">EasyPaisa</SelectItem>
                          <SelectItem value="jazzcash">JazzCash</SelectItem>
                          <SelectItem value="cash">Cash at School</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" aria-label="Remove account"
                        onClick={() => setAccounts(a => a.filter((_, idx) => idx !== i))}
                        className="h-8 w-8 rounded-full p-0 text-red-500 hover:bg-red-500/10 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {acc.type === "bank" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={acc.bank_name ?? ""} onChange={e => setAccount(i, { bank_name: e.target.value })} placeholder="Bank name" className="h-8 text-xs" />
                        <Input value={acc.account_title ?? ""} onChange={e => setAccount(i, { account_title: e.target.value })} placeholder="Account title" className="h-8 text-xs" />
                        <Input value={acc.account_number ?? ""} onChange={e => setAccount(i, { account_number: e.target.value })} placeholder="Account number" className="h-8 text-xs" />
                        <Input value={acc.iban ?? ""} onChange={e => setAccount(i, { iban: e.target.value })} placeholder="IBAN" className="h-8 text-xs" />
                      </div>
                    )}
                    {(acc.type === "easypaisa" || acc.type === "jazzcash") && (
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={acc.account_name ?? ""} onChange={e => setAccount(i, { account_name: e.target.value })} placeholder="Account name" className="h-8 text-xs" />
                        <Input value={acc.phone ?? ""} onChange={e => setAccount(i, { phone: e.target.value })} placeholder="03XX-XXXXXXX" className="h-8 text-xs" />
                      </div>
                    )}
                    {acc.type === "cash" && (
                      <Input value={acc.instructions ?? ""} onChange={e => setAccount(i, { instructions: e.target.value })} placeholder="Instructions (optional) — e.g. office hours" className="h-8 text-xs" />
                    )}
                    {acc.type === "other" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={acc.label ?? ""} onChange={e => setAccount(i, { label: e.target.value })} placeholder="Method name" className="h-8 text-xs" />
                        <Input value={acc.instructions ?? ""} onChange={e => setAccount(i, { instructions: e.target.value })} placeholder="Instructions" className="h-8 text-xs" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="mt-4 h-9 w-full gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:w-auto">
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Shared premium UI pieces ───────────────────────────────────────────── */
const StatusPill = ({ status }: { status: AdmissionStatus }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusConfig[status].badge}`}>
    {statusConfig[status].label}
  </span>
);

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");

const PanelHeader = ({ icon: Icon, title, desc, action }: { icon: typeof Users; title: string; desc?: string; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 mb-4">
    <div className="flex items-start gap-3 min-w-0">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{desc}</p>}
      </div>
    </div>
    {action}
  </div>
);

const DeleteApplicationButton = ({ app, disabled, onConfirm }: { app: Admission; disabled?: boolean; onConfirm: (id: string) => void }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Delete ${app.full_name}`}
        className="h-8 w-8 rounded-full p-0 text-red-500 shadow-none hover:bg-red-500/10 hover:text-red-700">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {app.full_name}?</AlertDialogTitle>
        <AlertDialogDescription>
          This will permanently delete this admission record ({app.reference_no}) and all associated documents. This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={() => onConfirm(app.id)} className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 sm:flex-none">
          Yes, Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Applications list — table on ≥md, stacked cards on mobile (nothing cut off). */
function ApplicationsList({ apps, onView, onDelete, onFee, deleting }: {
  apps: Admission[]; onView: (a: Admission) => void; onDelete: (id: string) => void; onFee?: (a: Admission) => void; deleting?: boolean;
}) {
  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              {["Applicant", "Class", "Type", "Fee", "Status", "Applied", ""].map((h, i) => (
                <th key={i} className={`whitespace-nowrap px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i === 6 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {apps.map(app => (
              <tr key={app.id} className="transition-colors hover:bg-primary/5">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{initials(app.full_name)}</span>
                    <div className="min-w-0">
                      <p className="font-medium leading-tight break-words">{app.full_name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{app.reference_no}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">Class {app.applying_class}</td>
                <td className="px-4 py-3 capitalize whitespace-nowrap">{app.admission_type}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex flex-col items-start gap-0.5">
                    <FeeStatusPill app={app} />
                    {app.payment_reference && <span className="text-[10px] text-muted-foreground font-mono">{app.payment_reference}</span>}
                  </div>
                </td>
                <td className="px-4 py-3"><StatusPill status={app.status} /></td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(new Date(app.created_at), "dd MMM yy")}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => onView(app)} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    {onFee && (
                      <Button size="sm" variant="outline" onClick={() => onFee(app)} aria-label="Processing fee"
                        className="h-8 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                        <Wallet className="w-3.5 h-3.5" /> Fee
                      </Button>
                    )}
                    <DeleteApplicationButton app={app} disabled={deleting} onConfirm={onDelete} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="space-y-2 md:hidden">
        {apps.map(app => (
          <li key={app.id} className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(app.full_name)}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm leading-snug break-words">{app.full_name}</p>
                <p className="text-[11px] text-muted-foreground font-mono break-all">{app.reference_no}</p>
              </div>
              <StatusPill status={app.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Class {app.applying_class}</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span className="capitalize">{app.admission_type}</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span>{format(new Date(app.created_at), "dd MMM yyyy")}</span>
            </div>
            <div className="mt-2.5">
              <FeeStatusPill app={app} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onView(app)} className="h-8 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                <Eye className="w-3.5 h-3.5" /> View &amp; Manage
              </Button>
              {onFee && (
                <Button size="sm" variant="outline" onClick={() => onFee(app)} className="h-8 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                  <Wallet className="w-3.5 h-3.5" /> Fee
                </Button>
              )}
              <DeleteApplicationButton app={app} disabled={deleting} onConfirm={onDelete} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ══ MAIN TAB — three sub-tabs (Applications · Classes & Seats · Merit Lists) ══ */
type SubTab = "applications" | "classes" | "merit";

const AdminAdmissions = () => {
  const [subTab, setSubTab] = useState<SubTab>("applications");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [classFilter,  setClassFilter]  = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [page,         setPage]         = useState(0);
  const [selected,     setSelected]     = useState<Admission | null>(null);
  const [feeApp,       setFeeApp]       = useState<Admission | null>(null);
  const [walkinOpen,   setWalkinOpen]   = useState(false);
  const [search,       setSearch]       = useState("");
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const { data: admSettings } = useAdmissionSettings();
  const qc = useQueryClient();
  const deleteMut = useDeleteAdmission();

  const { data, isLoading } = useAdminAdmissions({
    status: statusFilter, classFilter, typeFilter, page,
  });
  const admissions  = data?.admissions ?? [];
  const totalPages  = Math.ceil((data?.count ?? 0) / PAGE_SIZE);

  // Stats — use unfiltered count
  const { data: allData } = useAdminAdmissions({});
  const all = allData?.admissions ?? [];
  const stats = {
    total:     allData?.count ?? 0,
    pending:   all.filter(a => a.status === "pending").length,
    approved:  all.filter(a => a.status === "approved").length,
    rejected:  all.filter(a => a.status === "rejected").length,
    migration: all.filter(a => a.admission_type === "migration").length,
    feePaid:   all.filter(a => a.payment_status === "paid").length,
    feePending: all.filter(a => a.payment_status !== "paid").length,
  };

  // Filtered list based on active stat card click
  const statFilteredAdmissions = activeStatFilter
    ? all.filter(a => {
        if (activeStatFilter === "total") return true;
        if (activeStatFilter === "pending") return a.status === "pending";
        if (activeStatFilter === "approved") return a.status === "approved";
        if (activeStatFilter === "rejected") return a.status === "rejected";
        if (activeStatFilter === "migration") return a.admission_type === "migration";
        if (activeStatFilter === "feePaid") return a.payment_status === "paid";
        if (activeStatFilter === "feePending") return a.payment_status !== "paid";
        return true;
      })
    : null;

  // Search across ALL applications: reference ID, name, CNIC / B-Form, payment ref
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const filtered = q
    ? all.filter(a =>
        (a.reference_no || "").toLowerCase().includes(q) ||
        (a.full_name || "").toLowerCase().includes(q) ||
        (a.father_name || "").toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (
          (a.b_form_no || "").replace(/\D/g, "").includes(qDigits) ||
          (a.father_cnic || "").replace(/\D/g, "").includes(qDigits)
        )) ||
        (a.payment_reference || "").toLowerCase().includes(q)
      )
    : admissions;

  const handleStatClick = (statKey: string) => {
    setActiveStatFilter(prev => prev === statKey ? null : statKey);
  };

  const handleDeleteAdmission = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id);
      toast.success("Admission deleted successfully");
    } catch {
      toast.error("Failed to delete admission");
    }
  };

  const removeProcessed = (_id: string) => {
    qc.invalidateQueries({ queryKey: ["admin-admissions"] });
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { exportApplicationsExcel } = await import("@/lib/admissionExcel");
      const { data: rows, error } = await supabase
        .from("admissions")
        .select("id, reference_no, full_name, father_name, date_of_birth, b_form_no, contact_number, whatsapp_number, home_address, gender, applying_class, admission_type, previous_school, previous_class, previous_marks, year_of_passing, status, admin_note, rejection_reason, admission_roll_no, migration_step, payment_status, payment_reference, payment_method, payment_receipt, processing_fee, fee_deadline, paid_at, father_cnic, occupation, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      await exportApplicationsExcel((rows ?? []) as Admission[], null);
      toast.success(`Exported ${(rows ?? []).length} application(s).`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed.");
    } finally { setExporting(false); }
  };

  // ── Sub-tab dispatch ─────────────────────────────────────────────────────
  if (subTab === "classes") {
    return (
      <div className="space-y-4">
        <SubTabPills subTab={subTab} onTab={setSubTab} />
        <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
          <AdminAdmissionClasses />
        </Suspense>
      </div>
    );
  }
  if (subTab === "merit") {
    return (
      <div className="space-y-4">
        <SubTabPills subTab={subTab} onTab={setSubTab} />
        <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
          <AdminAdmissionMeritLists />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20 sm:space-y-6 md:pb-0">
      {/* ── Sub-tab pills (Applications · Classes & Seats · Merit Lists) ─── */}
      <SubTabPills subTab={subTab} onTab={setSubTab} />

      {/* ── Stats — 4 compact clickable blocks ───────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { key: "total",      label: "Applied", value: stats.total,      icon: ClipboardList, color: "text-primary",     activeBg: "border-primary bg-primary/10", clickable: true },
          { key: "feePending", label: "Pending", value: stats.feePending, icon: Wallet,        color: "text-amber-600",   activeBg: "border-amber-400 bg-amber-500/10", clickable: true },
          { key: "feePaid",    label: "Paid",    value: stats.feePaid,    icon: BadgeCheck,    color: "text-emerald-600", activeBg: "border-emerald-400 bg-emerald-500/10", clickable: true },
          { key: "session",    label: "Session", value: admSettings?.session_year ?? "—", icon: Users, color: "text-primary", activeBg: "", clickable: false },
        ].map(s => (
          <button
            type="button"
            key={s.key}
            disabled={!s.clickable}
            onClick={() => s.clickable && handleStatClick(s.key)}
            className={`flex min-w-0 flex-col items-center justify-center rounded-2xl border px-1 py-2.5 text-center shadow-sm transition-all duration-200 disabled:opacity-100 ${
              s.clickable ? "active:scale-[0.97]" : "cursor-default"
            } ${activeStatFilter === s.key ? s.activeBg : "border-border/60 bg-card"}`}
          >
            <span className="font-heading text-xl font-bold leading-none tabular-nums text-foreground sm:text-2xl">{s.value}</span>
            <span className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-bold uppercase leading-none tracking-wide text-muted-foreground sm:text-[11px]">
              <s.icon className={`h-3 w-3 shrink-0 ${s.color}`} />{s.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── Search ───────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search ID, name or CNIC"
          className="h-11 rounded-full border-border/60 bg-card pl-11 text-sm shadow-none" />
      </div>

      {/* ── Toolbar: Settings · Delete All / Export · Walk-in ─────────── */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}
            className="h-9 gap-1.5 whitespace-nowrap rounded-full border-border/60 bg-card px-4 text-xs font-bold shadow-none">
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDeleteAllOpen(true)} disabled={!stats.total}
            className="h-9 gap-1.5 whitespace-nowrap rounded-full border-red-300/70 bg-card px-4 text-xs font-bold text-red-600 shadow-none hover:bg-red-500/10 hover:text-red-700">
            <Trash2 className="h-3.5 w-3.5" /> Delete All
          </Button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={exportExcel} disabled={exporting || !stats.total}
            className="h-9 gap-1.5 whitespace-nowrap rounded-full bg-emerald-600 px-4 text-xs font-bold text-white shadow-none hover:bg-emerald-700">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export Excel
          </Button>
          <Button size="sm" onClick={() => setWalkinOpen(true)}
            className="h-9 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-none hover:bg-primary/90">
            <UserPlus className="h-3.5 w-3.5" /> Add Walk-in / Import
          </Button>
        </div>
      </div>

      {/* Clickable stat filtered list — shows when a stat card is clicked */}
      {activeStatFilter && statFilteredAdmissions && (
        <Card className="overflow-hidden rounded-2xl border border-primary/30 shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/60 px-4 py-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              {activeStatFilter === "total" && <Users className="w-4 h-4 text-primary" />}
              {activeStatFilter === "pending" && <Clock className="w-4 h-4 text-blue-600" />}
              {activeStatFilter === "approved" && <CheckCircle2 className="w-4 h-4 text-green-600" />}
              {activeStatFilter === "rejected" && <XCircle className="w-4 h-4 text-red-500" />}
              {activeStatFilter === "migration" && <RefreshCw className="w-4 h-4 text-purple-600" />}
              {activeStatFilter === "feePaid" && <BadgeCheck className="w-4 h-4 text-emerald-600" />}
              {activeStatFilter === "feePending" && <Wallet className="w-4 h-4 text-amber-600" />}
              {activeStatFilter === "total" ? "All" : activeStatFilter === "feePaid" ? "Fee Paid" : activeStatFilter === "feePending" ? "Fee Pending" : activeStatFilter.charAt(0).toUpperCase() + activeStatFilter.slice(1)} Admissions
              <Badge variant="secondary" className="text-[10px] h-5">{statFilteredAdmissions.length}</Badge>
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setActiveStatFilter(null)}
              className="h-8 w-8 shrink-0 rounded-full p-0 shadow-none">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {statFilteredAdmissions.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No {activeStatFilter} admissions found
              </div>
            ) : (
              <ApplicationsList apps={statFilteredAdmissions} onView={setSelected} onFee={setFeeApp} onDelete={handleDeleteAdmission} deleting={deleteMut.isPending} />
            )}
          </div>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
        <div>
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              <GraduationCap className="w-8 h-8 mx-auto mb-2 opacity-40" />
              No applications found
            </div>
          ) : (
            <ApplicationsList apps={filtered} onView={setSelected} onFee={setFeeApp} onDelete={handleDeleteAdmission} deleting={deleteMut.isPending} />
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && !q && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} ({data?.count} total)
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="h-8 w-8 rounded-full border-border/60 p-0 shadow-none"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="h-8 w-8 rounded-full border-border/60 p-0 shadow-none"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-5">
          <DialogHeader className="sr-only"><DialogTitle>Admission Settings</DialogTitle></DialogHeader>
          <AdmissionSettingsPanel embedded />
        </DialogContent>
      </Dialog>

      {/* Delete-all confirm dialog */}
      <DeleteAllDialog count={stats.total} open={deleteAllOpen} onOpenChange={setDeleteAllOpen} />

      {/* Detail Dialog */}
      {selected && (
        <AdmissionDetail
          app={selected}
          onClose={() => setSelected(null)}
          onSaved={removeProcessed}
          onDelete={removeProcessed}
        />
      )}

      {/* Processing Fee dialog */}
      {feeApp && (
        <FeeDialog
          app={feeApp}
          onClose={() => setFeeApp(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["admin-admissions"] }); }}
        />
      )}

      {/* Walk-in add / import dialog */}
      {walkinOpen && (
        <Suspense fallback={null}>
          <AdminWalkinDialog open onClose={() => setWalkinOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

/* ── Sub-tab pills ──────────────────────────────────────────────────────── */
function SubTabPills({ subTab, onTab }: { subTab: SubTab; onTab: (t: SubTab) => void }) {
  const pills: Array<{ id: SubTab; label: string; icon: typeof ClipboardList }> = [
    { id: "applications", label: "Applications", icon: ClipboardList },
    { id: "classes", label: "Classes & Seats", icon: Armchair },
    { id: "merit", label: "Merit Lists", icon: Trophy },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border/60 bg-muted/40 p-1">
      {pills.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => onTab(p.id)}
          className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center text-[11px] font-bold leading-tight transition-colors sm:flex-row sm:gap-1.5 sm:text-xs ${
            subTab === p.id
              ? "border border-border/60 bg-card text-primary shadow-sm"
              : "border border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <p.icon className="h-4 w-4 shrink-0" />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}

export default AdminAdmissions;
