import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  useAdminAdmissions, useAdmissionDocuments, useUpdateAdmission,
  useUpdateAdmissionStatus,
  useDeleteAdmission,
  useUpdateAdmissionSettings, useAdmissionSettings,
  Admission, AdmissionStatus
} from "@/hooks/useAdmission";
import { type PaymentMethod } from "@/hooks/useFees";
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
  Wallet, Calendar, MapPin, Plus
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";

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
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `${feeName} fee for Class ${app.applying_class} is set to Rs 0 — set an amount in Fee Management → Structures, then save this applicant again`, feeType: targetFeeType };
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
          qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
          qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
          qc.invalidateQueries({ queryKey: ["fee-defaulters"] });
          qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
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

/* ── Settings Panel ─────────────────────────────────────────────────────── */
function AdmissionSettingsPanel() {
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
  });
  const [synced, setSynced] = useState(false);

  if (settings && !synced) {
    setForm({
      is_open:        settings.is_open,
      session_year:   settings.session_year,
      open_date:      settings.open_date ?? "",
      last_date:      settings.last_date ?? "",
      banner_message: settings.banner_message ?? "",
      notes:          settings.notes ?? "",
    });
    setSynced(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateMut.mutateAsync({
        is_open:        form.is_open,
        session_year:   form.session_year,
        open_date:      form.open_date   || null,
        last_date:      form.last_date   || null,
        banner_message: form.banner_message || null,
        notes:          form.notes || null,
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
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <PanelHeader icon={Settings2} title="Admission Settings" desc="Control the public admission window and banner" />
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
            <Label className="text-xs font-semibold mb-1 block">Open Date</Label>
            <Input type="date" value={form.open_date ?? ""}
              onChange={e => setForm(f => ({ ...f, open_date: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1 block">Last Date</Label>
            <Input type="date" value={form.last_date ?? ""}
              onChange={e => setForm(f => ({ ...f, last_date: e.target.value }))} className="h-9 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs font-semibold mb-1 block">Banner Message</Label>
            <Input value={form.banner_message ?? ""}
              onChange={e => setForm(f => ({ ...f, banner_message: e.target.value }))}
              placeholder="Admissions Open for Session 2026 — Apply Online Today"
              className="h-9 text-sm" />
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="mt-4 h-9 w-full gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:w-auto">
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</> : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Interview Slots Panel ──────────────────────────────────────────────── *
 * Applicants can only book a slot from InterviewSlotBooking.tsx if a row
 * exists in `interview_slots`. Previously there was no admin UI to create
 * these, so "Book Interview Slot" always showed "No slots available" even
 * after an admin marked an applicant as interview_scheduled. This panel
 * lets the admin open slots (date, time, capacity, location) that then
 * appear live in every applicant's portal.
 */
interface InterviewSlotRow {
  id: string;
  slot_date: string;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  current_bookings: number;
  location: string | null;
  notes: string | null;
  is_active: boolean;
}

function InterviewSlotsPanel() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    slot_date: "",
    start_time: "",
    duration_minutes: 15,
    capacity: 10,
    location: "",
    notes: "",
  });

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["admin-interview-slots"],
    queryFn: async () => {
      // Note: the `slots_read_public` RLS policy only allows reading rows
      // where is_active = true, for both anon AND authenticated roles. That
      // means an admin toggling a slot to "Inactive" would make it vanish
      // from this list entirely instead of showing as inactive. If that
      // happens, add a staff-only RLS policy on interview_slots granting
      // authenticated admins SELECT on all rows regardless of is_active.
      const { data, error } = await supabase
        .from("interview_slots")
        .select("*")
        .order("slot_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return (data ?? []) as InterviewSlotRow[];
    },
  });

  const createSlot = async () => {
    if (!form.slot_date || !form.start_time) {
      toast.error("Date and time are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("interview_slots").insert({
        slot_date:         form.slot_date,
        start_time:        form.start_time,
        duration_minutes:  form.duration_minutes,
        capacity:          form.capacity,
        location:          form.location || null,
        notes:             form.notes || null,
        is_active:         true,
      });
      if (error) throw error;
      toast.success("Interview slot created");
      setForm({ slot_date: "", start_time: "", duration_minutes: 15, capacity: 10, location: "", notes: "" });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["admin-interview-slots"] });
    } catch (e) {
      toast.error(e?.message || "Failed to create slot");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (slot: InterviewSlotRow) => {
    try {
      const { error } = await supabase
        .from("interview_slots")
        .update({ is_active: !slot.is_active })
        .eq("id", slot.id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["admin-interview-slots"] });
    } catch {
      toast.error("Failed to update slot");
    }
  };

  const deleteSlot = async (slot: InterviewSlotRow) => {
    try {
      const { error } = await supabase.from("interview_slots").delete().eq("id", slot.id);
      if (error) throw error;
      toast.success("Slot deleted");
      qc.invalidateQueries({ queryKey: ["admin-interview-slots"] });
    } catch (e) {
      toast.error(e?.message || "Failed to delete slot (it may already have bookings)");
    }
  };

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <PanelHeader
          icon={Calendar}
          title="Interview Slots"
          desc="Open slots applicants can book from their portal"
          action={
            <Button size="sm" variant="outline" className="h-8 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none" onClick={() => setShowForm(v => !v)}>
              {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {showForm ? "Cancel" : "Add Slot"}
            </Button>
          }
        />

        {showForm && (
          <div className="grid sm:grid-cols-2 gap-3 mb-4 p-3 bg-muted/40 border border-border/60 rounded-xl">
            <div>
              <Label className="text-xs font-semibold mb-1 block">Date</Label>
              <Input type="date" value={form.slot_date}
                onChange={e => setForm(f => ({ ...f, slot_date: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Time</Label>
              <Input type="time" value={form.start_time}
                onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Duration (min)</Label>
              <Input type="number" min={5} max={120} value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Capacity</Label>
              <Input type="number" min={1} max={100} value={form.capacity}
                onChange={e => setForm(f => ({ ...f, capacity: Number(e.target.value) }))} className="h-9 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold mb-1 block">Location</Label>
              <Input value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="Principal's Office / School Hall" className="h-9 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold mb-1 block">Notes (shown to applicant)</Label>
              <Textarea value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Bring original documents and B-Form." className="text-sm" rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={createSlot} disabled={saving} className="h-9 w-full gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:w-auto">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create Slot
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : slots.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No interview slots yet. Applicants won't be able to book until you add at least one.
          </p>
        ) : (
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {slots.map(slot => (
              <div key={slot.id}
                className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border bg-card p-3 ${slot.is_active ? "border-border/60" : "border-border/60 opacity-55"}`}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {format(new Date(slot.slot_date + "T00:00:00"), "dd MMM yyyy")} · {slot.start_time.slice(0, 5)}
                  </p>
                  <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <Users className="w-3 h-3" /> {slot.current_bookings}/{slot.capacity}
                    {slot.location && <><MapPin className="w-3 h-3 ml-1" /> {slot.location}</>}
                    {!slot.is_active && <span className="text-red-500 font-semibold">· Inactive</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" className="h-8 min-w-0 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"
                    onClick={() => toggleActive(slot)}>
                    {slot.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 rounded-full p-0 text-red-500 shadow-none hover:bg-red-500/10 hover:text-red-700"
                    onClick={() => deleteSlot(slot)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
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
function ApplicationsList({ apps, onView, onDelete, deleting }: {
  apps: Admission[]; onView: (a: Admission) => void; onDelete: (id: string) => void; deleting?: boolean;
}) {
  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left">
              {["Applicant", "Class", "Type", "Status", "Applied", ""].map((h, i) => (
                <th key={i} className={`whitespace-nowrap px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i === 5 ? "text-right" : ""}`}>{h}</th>
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
                <td className="px-4 py-3"><StatusPill status={app.status} /></td>
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(new Date(app.created_at), "dd MMM yy")}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => onView(app)} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
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
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onView(app)} className="h-8 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                <Eye className="w-3.5 h-3.5" /> View &amp; Manage
              </Button>
              <DeleteApplicationButton app={app} disabled={deleting} onConfirm={onDelete} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const AdminAdmissions = () => {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [classFilter,  setClassFilter]  = useState("all");
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [page,         setPage]         = useState(0);
  const [selected,     setSelected]     = useState<Admission | null>(null);
  const [search,       setSearch]       = useState("");
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);
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
  };

  // Filtered list based on active stat card click
  const statFilteredAdmissions = activeStatFilter
    ? all.filter(a => {
        if (activeStatFilter === "total") return true;
        if (activeStatFilter === "pending") return a.status === "pending";
        if (activeStatFilter === "approved") return a.status === "approved";
        if (activeStatFilter === "rejected") return a.status === "rejected";
        if (activeStatFilter === "migration") return a.admission_type === "migration";
        return true;
      })
    : null;

  // Client-side search on loaded page
  const filtered = search.trim()
    ? admissions.filter(a =>
        a.full_name.toLowerCase().includes(search.toLowerCase()) ||
        a.b_form_no.includes(search) ||
        a.reference_no.toLowerCase().includes(search.toLowerCase())
      )
    : admissions;

  // Handle stat card click — show filtered modal-like list
  const handleStatClick = (statKey: string) => {
    setActiveStatFilter(prev => prev === statKey ? null : statKey);
  };

  // Handle delete from stat-filtered view
  const handleDeleteAdmission = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id);
      toast.success("Admission deleted successfully");
    } catch {
      toast.error("Failed to delete admission");
    }
  };

  // Remove a processed admission from the list immediately
  const handleAdmissionSaved = (_id: string) => {
    qc.invalidateQueries({ queryKey: ["admin-admissions"] });
  };

  const handleAdmissionDeleted = (_id: string) => {
    qc.invalidateQueries({ queryKey: ["admin-admissions"] });
  };

  return (
    <div className="space-y-5 pb-20 sm:space-y-6 md:pb-0">
      {/* ── Premium header ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <ClipboardList className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Admissions Management</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              <span className="font-semibold text-foreground">{stats.total}</span> applications · review &amp; manage sessions
            </p>
          </div>
        </div>
      </div>

      {/* Stats — CLICKABLE cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5 [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1">
        {[
          { key: "total",     label: "Total",     value: stats.total,     icon: Users,        color: "text-primary",    dot: "bg-primary",    activeBg: "border-primary bg-primary/10" },
          { key: "pending",   label: "Pending",   value: stats.pending,   icon: Clock,        color: "text-blue-600",   dot: "bg-blue-500",   activeBg: "border-blue-400 bg-blue-500/10" },
          { key: "approved",  label: "Approved",  value: stats.approved,  icon: CheckCircle2, color: "text-green-600",  dot: "bg-emerald-500", activeBg: "border-green-400 bg-green-500/10" },
          { key: "rejected",  label: "Rejected",  value: stats.rejected,  icon: XCircle,      color: "text-red-500",    dot: "bg-red-500",    activeBg: "border-red-400 bg-red-500/10" },
          { key: "migration", label: "Migration", value: stats.migration, icon: RefreshCw,    color: "text-purple-600", dot: "bg-purple-500", activeBg: "border-purple-400 bg-purple-500/10" },
        ].map(s => (
          <Card
            key={s.key}
            className={`cursor-pointer rounded-2xl border px-3 py-2.5 shadow-sm transition-all duration-200 active:scale-[0.98] ${
              activeStatFilter === s.key ? s.activeBg : "border-border/60 bg-card hover:border-primary/30"
            }`}
            onClick={() => handleStatClick(s.key)}
          >
            <CardContent className="flex items-center gap-3 p-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-bold leading-none tabular-nums sm:text-2xl">{s.value}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />{s.label}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
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
              {activeStatFilter === "total" ? "All" : activeStatFilter.charAt(0).toUpperCase() + activeStatFilter.slice(1)} Admissions
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
              <ApplicationsList apps={statFilteredAdmissions} onView={setSelected} onDelete={handleDeleteAdmission} deleting={deleteMut.isPending} />
            )}
          </div>
        </Card>
      )}

      {/* Settings */}
      <AdmissionSettingsPanel />

      {/* Interview Slots */}
      <InterviewSlotsPanel />

      {/* Filters */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
        <div className="relative col-span-3 sm:min-w-[220px] sm:flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name / B-Form / ref..."
            className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-full rounded-full border-border/60 text-xs shadow-none sm:w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {(Object.keys(statusConfig) as AdmissionStatus[]).map(s => (
              <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={classFilter} onValueChange={v => { setClassFilter(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-full rounded-full border-border/60 text-xs shadow-none sm:w-28"><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {["6","7","8","9","10"].map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="h-10 w-full rounded-full border-border/60 text-xs shadow-none sm:w-32"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="fresh">Fresh</SelectItem>
            <SelectItem value="migration">Migration</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
            <ApplicationsList apps={filtered} onView={setSelected} onDelete={handleDeleteAdmission} deleting={deleteMut.isPending} />
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
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

      {/* Detail Dialog */}
      {selected && (
        <AdmissionDetail
          app={selected}
          onClose={() => setSelected(null)}
          onSaved={handleAdmissionSaved}
          onDelete={handleAdmissionDeleted}
        />
      )}
    </div>
  );
};

export default AdminAdmissions;
