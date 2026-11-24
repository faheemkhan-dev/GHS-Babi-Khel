// src/pages/admin/tabs/AdminAdmissions.tsx — Admin → Admissions
// (GHSS Ghallanai layout, GHS Babi Khel High School model: classes with
// seats, no programs, no quotas).
//
// Three sub-tabs — Applications · Classes & Seats · Merit Lists — under the
// Ghallanai "paper rule". The Applications tab has:
//   • stat tiles (Applied / Pending / Paid / Session — the first three filter)
//   • search + status chips + class / type filters
//   • centred table (desktop) / top-barred cards (mobile) with  View · Fee ·
//     Delete  per application
//   • Settings dialog (window, fee, school payment accounts)
//   • Delete All (typed confirmation + Excel backup) · Export Excel · Walk-in
//
// FIXED in this version: the old tab computed its counters, search and stat
// filters from only the first 20 applications and listed ONLY "pending"
// applications. Everything now reads the full register (useAdminAdmissionsAll).
// "View & Manage" is now simply "View" and opens the redesigned
// AdminAdmissionView dialog.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ClipboardList, GraduationCap, Eye, Settings2, Users, Loader2, Search,
  AlertTriangle, Trash2, Wallet, Plus, BadgeCheck, Armchair, Trophy,
  UserPlus, FileSpreadsheet, Download, ChevronLeft, ChevronRight, X,
  CheckCircle2, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import {
  useAdmissionSettings, useSetAdmissionPayment, useAdmissionResetAll,
  useDeleteAdmission, type Admission, type AdmissionSettings,
} from "@/hooks/useAdmission";
import { useAdminAdmissionsAll } from "@/hooks/useAdminAdmissionsAll";
import {
  paymentMethodLabel, formatDeadline,
  type AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import { STATUS_CONFIG, FILTER_CHIPS, initials } from "@/lib/admissionAdminStatus";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const AdminAdmissionClasses = lazy(() => import("./AdminAdmissionClasses"));
const AdminAdmissionMeritLists = lazy(() => import("./AdminAdmissionMeritLists"));
const AdminWalkinDialog = lazy(() => import("./AdminWalkinDialog"));
const AdminAdmissionView = lazy(() => import("./AdminAdmissionView"));

const PAGE_SIZE = 25;

const PAYMENT_METHOD_CHOICES: [string, string][] = [
  ["bank", "Bank"], ["easypaisa", "EasyPaisa"], ["jazzcash", "JazzCash"],
  ["cash", "Cash at School"], ["other", "Other"],
];

/* ── Small shared pieces ────────────────────────────────────────────────── */

/** Workflow status only (the Fee badge reads payment only — never the same fact twice). */
const StatusPill = ({ status }: { status: Admission["status"] }) => (
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_CONFIG[status]?.badge ?? ""}`}>
    {STATUS_CONFIG[status]?.label ?? status}
  </span>
);

const FeeStatusPill = ({ app }: { app: Admission }) => {
  const s = app.payment_status || "pending";
  const cls =
    s === "paid"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900"
      : s === "rejected"
        ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"
        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900";
  const label = s === "paid" ? "Paid" : s === "rejected" ? "Rejected" : "Pending";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {label}{s === "paid" && app.payment_method ? ` · ${paymentMethodLabel(app.payment_method)}` : ""}
    </span>
  );
};

/* ══ Processing Fee dialog — the ONLY place the processing fee is recorded ═══ */
function FeeDialog({ app, onClose }: { app: Admission; onClose: () => void }) {
  const paymentMut = useSetAdmissionPayment();
  const [method, setMethod] = useState<string>(app.payment_method || "cash");
  const [receipt, setReceipt] = useState(app.payment_receipt || "");
  const paid = app.payment_status === "paid";

  const run = async (status: "paid" | "rejected" | "pending") => {
    try {
      const res: any = await paymentMut.mutateAsync({ id: app.id, status, receipt, method });
      if (res?.unchanged) toast("Nothing changed — the fee is already recorded that way.", { icon: "ℹ️" });
      else if (status === "paid") toast.success(`Fee recorded — Rs ${app.processing_fee} via ${paymentMethodLabel(method)}.`);
      else if (status === "rejected") toast.success("Payment marked rejected.");
      else toast.success("Fee reset to pending.");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Could not update the fee.");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 to-transparent px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2.5 text-left text-base">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Wallet className="h-4 w-4" /></span>
            Processing Fee
          </DialogTitle>
          <DialogDescription className="sr-only">Record the processing fee for {app.full_name}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Summary card */}
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/30">
            <div className="px-4 py-3 text-center">
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-0.5 font-mono text-[11.5px] font-bold tracking-wider text-primary">{app.reference_no}</span>
              <p className="mt-1.5 text-sm font-bold">{app.full_name}</p>
              <p className="text-[11px] text-muted-foreground">Class {app.applying_class}</p>
            </div>
            <dl className="divide-y divide-border/60 border-t border-border/60 text-xs">
              {([
                ["Amount", `Rs ${Number(app.processing_fee).toLocaleString("en-PK")}`],
                ["Payment Ref.", app.payment_reference || "not generated"],
                ["Deadline", app.fee_deadline ? formatDeadline(app.fee_deadline) : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-4 py-2">
                  <dt className="font-semibold text-muted-foreground">{k}</dt>
                  <dd className={`text-right font-bold ${k === "Payment Ref." ? "font-mono" : ""}`}>{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="font-semibold text-muted-foreground">Fee status</dt>
                <dd><FeeStatusPill app={app} /></dd>
              </div>
            </dl>
          </div>

          {paid ? (
            <div className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              Fee received. This application is final.
            </div>
          ) : (
            <>
              <div>
                <Label className="mb-1.5 block text-xs font-bold">Paid by</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENT_METHOD_CHOICES.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMethod(value)}
                      className={`rounded-full border px-2 py-2 text-[11px] font-bold transition-colors ${
                        method === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-bold">Receipt / transaction no. (optional)</Label>
                <Input
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  placeholder="Bank or wallet receipt number"
                  className="h-10 rounded-xl text-sm"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => run("paid")}
                  disabled={paymentMut.isPending}
                  className="h-11 w-full gap-1.5 rounded-full bg-green-600 text-xs font-bold text-white shadow-none hover:bg-green-700"
                >
                  {paymentMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Mark Fee Paid (Rs {app.processing_fee})
                </Button>
                {app.payment_status === "rejected" ? (
                  <Button variant="ghost" onClick={() => run("pending")} disabled={paymentMut.isPending}
                    className="h-9 w-full rounded-full text-xs font-semibold">Reset to Fee Pending</Button>
                ) : (
                  app.payment_status === "pending" && app.payment_reference && (
                    <Button variant="outline" onClick={() => run("rejected")} disabled={paymentMut.isPending}
                      className="h-9 w-full rounded-full border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10">
                      Reject Payment
                    </Button>
                  )
                )}
              </div>
            </>
          )}

          <p className="border-t border-border/60 pt-3 text-center text-[10.5px] leading-relaxed text-muted-foreground">
            Fee is recorded here only. Review and merit are automatic: use the <b>Merit Lists</b> tab.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══ Delete All — reset for the next session ═════════════════════════════ */
function DeleteAllDialog({ count, open, onOpenChange, onBackup, backingUp }: {
  count: number; open: boolean; onOpenChange: (o: boolean) => void; onBackup: () => void; backingUp: boolean;
}) {
  const resetMut = useAdmissionResetAll();
  const [confirmText, setConfirmText] = useState("");

  const doReset = async () => {
    try {
      const res: any = await resetMut.mutateAsync();
      toast.success(`${res?.admissions ?? count} application(s) deleted. Ready for the next session.`);
      onOpenChange(false);
      setConfirmText("");
    } catch (e: any) {
      toast.error(e?.message || "Reset failed.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setConfirmText(""); }}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" /> Delete All Applications
          </DialogTitle>
          <DialogDescription className="text-left text-xs leading-relaxed">
            This permanently deletes <b>{count} application(s)</b>, all applicant documents, timelines, every merit list
            and the payment ledger. Classes, seats, settings and the students-register / fee-voucher records are kept.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <Button variant="outline" onClick={onBackup} disabled={backingUp}
          className="h-9 w-full gap-1.5 rounded-full border-green-600/50 text-xs font-bold text-green-700 hover:bg-green-600/10 hover:text-green-800 dark:text-green-400">
          {backingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
          Download Excel backup first
        </Button>
        <div>
          <Label className="mb-1.5 block text-xs font-bold">Type <span className="font-mono text-red-600">DELETE ALL</span> to confirm</Label>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE ALL" className="h-10 rounded-xl text-center font-mono text-sm" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); setConfirmText(""); }}
            className="h-10 flex-1 rounded-full text-xs font-bold">Cancel</Button>
          <Button variant="destructive" disabled={confirmText !== "DELETE ALL" || resetMut.isPending} onClick={doReset}
            className="h-10 flex-1 rounded-full text-xs font-bold">
            {resetMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete All"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══ Admission Settings dialog ═══════════════════════════════════════════ */
function SettingsBody({ settings, onDone }: { settings: AdmissionSettings; onDone: () => void }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    is_open: !!settings.is_open,
    session_year: settings.session_year ?? String(new Date().getFullYear()),
    processing_fee: String(settings.processing_fee ?? 100),
    open_date: settings.open_date ?? "",
    last_date: settings.last_date ?? "",
    banner_message: settings.banner_message ?? "",
    contact_whatsapp: settings.contact_whatsapp ?? "",
  });
  const [accounts, setAccounts] = useState<AdmissionPaymentAccount[]>(
    ((settings.payment_accounts ?? []) as AdmissionPaymentAccount[]).map((a) => ({ ...a })),
  );

  const patchAccount = (i: number, patch: Partial<AdmissionPaymentAccount>) =>
    setAccounts((a) => a.map((acc, idx) => (idx === i ? { ...acc, ...patch } : acc)));

  const save = async () => {
    const year = form.session_year.trim();
    if (!year) return toast.error("Please enter the session year.");
    const feeNum = Number(form.processing_fee);
    if (!Number.isFinite(feeNum) || feeNum < 0) return toast.error("Please enter a valid processing fee.");
    if (form.open_date && form.last_date && form.last_date < form.open_date)
      return toast.error("Last date cannot be before the start date.");
    const wa = form.contact_whatsapp.trim();
    if (wa) {
      const raw = wa.replace(/[^0-9+]/g, "");
      const digits = raw.startsWith("+") ? raw.slice(1) : raw;
      const intl = digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
      if (!/^\d{10,15}$/.test(intl)) return toast.error("WhatsApp number looks wrong. Use e.g. 03001234567.");
    }

    setSaving(true);
    try {
      // upsert (not update): a plain UPDATE silently changes 0 rows if the
      // single settings row is ever missing — upsert always lands, and the
      // returned row proves it was written.
      const { data, error } = await supabase
        .from("admission_settings")
        .upsert({
          id: 1,
          is_open: form.is_open,
          session_year: year,
          processing_fee: Math.round(feeNum),
          open_date: form.open_date || null,
          last_date: form.last_date || null,
          banner_message: form.banner_message.trim() || null,
          contact_whatsapp: wa || null,
          payment_accounts: accounts,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" })
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Settings were not saved. Please check your admin permission.");
      qc.setQueryData(["admission-settings"], data);
      qc.invalidateQueries({ queryKey: ["admission-settings"] });
      toast.success("Admission settings saved.");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const switchCard = (title: string, desc: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );

  return (
    <div className="space-y-4">
      {switchCard("Admissions Open", "When off, applications, tracking and downloads are locked on the public Admission page.", form.is_open, (v) => setForm((f) => ({ ...f, is_open: v })))}

      {/* School Payment Accounts */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label className="text-xs font-bold">School Payment Accounts <span className="font-normal text-muted-foreground">(printed on the fee challan)</span></Label>
          <Button size="sm" variant="outline"
            onClick={() => setAccounts((a) => [...a, { type: "bank", bank_name: "", account_title: "", account_number: "", iban: "" }])}
            className="h-8 gap-1 rounded-full px-3 text-[11px] font-bold shadow-none">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-3 py-3 text-center text-[11px] italic text-muted-foreground">
            No account added. Applicants will be told to pay at the school office.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Select value={acc.type} onValueChange={(v) => patchAccount(i, { type: v as AdmissionPaymentAccount["type"] })}>
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
                    onClick={() => setAccounts((a) => a.filter((_, idx) => idx !== i))}
                    className="h-8 w-8 rounded-full p-0 text-red-500 hover:bg-red-500/10 hover:text-red-700">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {acc.type === "bank" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={acc.bank_name ?? ""} onChange={(e) => patchAccount(i, { bank_name: e.target.value })} placeholder="Bank name" className="h-8 text-xs" />
                    <Input value={acc.account_title ?? ""} onChange={(e) => patchAccount(i, { account_title: e.target.value })} placeholder="Account title" className="h-8 text-xs" />
                    <Input value={acc.account_number ?? ""} onChange={(e) => patchAccount(i, { account_number: e.target.value })} placeholder="Account number" className="h-8 text-xs" />
                    <Input value={acc.iban ?? ""} onChange={(e) => patchAccount(i, { iban: e.target.value })} placeholder="IBAN" className="h-8 text-xs" />
                  </div>
                )}
                {(acc.type === "easypaisa" || acc.type === "jazzcash") && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={acc.account_name ?? ""} onChange={(e) => patchAccount(i, { account_name: e.target.value })} placeholder="Account name" className="h-8 text-xs" />
                    <Input value={acc.phone ?? ""} onChange={(e) => patchAccount(i, { phone: e.target.value })} placeholder="03XX-XXXXXXX" className="h-8 text-xs" />
                  </div>
                )}
                {acc.type === "cash" && (
                  <Input value={acc.instructions ?? ""} onChange={(e) => patchAccount(i, { instructions: e.target.value })} placeholder="Instructions (optional) — e.g. office hours" className="h-8 text-xs" />
                )}
                {acc.type === "other" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={acc.label ?? ""} onChange={(e) => patchAccount(i, { label: e.target.value })} placeholder="Method name" className="h-8 text-xs" />
                    <Input value={acc.instructions ?? ""} onChange={(e) => patchAccount(i, { instructions: e.target.value })} placeholder="Instructions" className="h-8 text-xs" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Window + fee */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="mb-1 block text-xs font-semibold">Session Year</Label>
          <Input value={form.session_year} onChange={(e) => setForm((f) => ({ ...f, session_year: e.target.value }))} placeholder="2026" className="h-10 rounded-xl text-sm" />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Processing Fee (Rs)</Label>
          <Input type="number" min={0} value={form.processing_fee} onChange={(e) => setForm((f) => ({ ...f, processing_fee: e.target.value }))} placeholder="100" className="h-10 rounded-xl text-sm" />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Start Date</Label>
          <Input type="date" value={form.open_date} onChange={(e) => setForm((f) => ({ ...f, open_date: e.target.value }))} className="h-10 rounded-xl text-sm" />
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold">Last Date</Label>
          <Input type="date" value={form.last_date} onChange={(e) => setForm((f) => ({ ...f, last_date: e.target.value }))} className="h-10 rounded-xl text-sm" />
        </div>
        <p className="col-span-2 -mt-1 text-[10.5px] leading-snug text-muted-foreground">
          Admission stays open until the last date; the fee deadline is its 23:59. Set the fee to 0 to switch the processing fee off entirely.
        </p>
      </div>

      <div>
        <Label className="mb-1 block text-xs font-semibold">Banner Message</Label>
        <Input value={form.banner_message} onChange={(e) => setForm((f) => ({ ...f, banner_message: e.target.value }))}
          placeholder="Admissions Open for Session 2026 — Apply Online Today" className="h-10 rounded-xl text-sm" />
      </div>
      <div>
        <Label className="mb-1 block text-xs font-semibold">WhatsApp number for payment proof</Label>
        <Input value={form.contact_whatsapp} onChange={(e) => setForm((f) => ({ ...f, contact_whatsapp: e.target.value }))}
          placeholder="03001234567" inputMode="tel" className="h-10 rounded-xl text-sm" />
        <p className="mt-1 text-[10.5px] text-muted-foreground">Applicants send their manual-payment screenshot here. Leave empty to use the school phone.</p>
      </div>

      <Button onClick={save} disabled={saving} className="h-11 w-full gap-2 rounded-full text-xs font-bold shadow-none">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4" /> Save Settings</>}
      </Button>
    </div>
  );
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: settings, isLoading } = useAdmissionSettings();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl p-4 sm:max-w-lg sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Settings2 className="h-4 w-4" /></span>
            Admission Settings
          </DialogTitle>
          <DialogDescription className="text-left text-xs">Admission window, processing fee and school payment accounts.</DialogDescription>
        </DialogHeader>
        {isLoading || !settings ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : (
          // keyed by updated_at so the form refills after every save
          <SettingsBody key={settings.updated_at} settings={settings} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ══ Applications list ═══════════════════════════════════════════════════ */
function ApplicationsList({ apps, onView, onFee, onDelete }: {
  apps: Admission[]; onView: (a: Admission) => void; onFee: (a: Admission) => void; onDelete: (a: Admission) => void;
}) {
  return (
    <>
      {/* Desktop / tablet — everything centred */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead>
            <tr className="bg-muted/60">
              {["Applicant", "Class", "Type", "Marks", "Fee", "Status", "Applied", "Actions"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 text-center align-middle text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {apps.map((app) => (
              <tr key={app.id} className="text-center transition-colors hover:bg-primary/5">
                <td className="px-3 py-3 align-middle">
                  <p className="font-semibold leading-tight">{app.full_name}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-bold tracking-wide text-primary">{app.reference_no}</p>
                  <p className="font-mono text-[10.5px] text-muted-foreground">{app.contact_number}</p>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-middle font-semibold">Class {app.applying_class}</td>
                <td className="whitespace-nowrap px-3 py-3 align-middle capitalize">{app.admission_type}</td>
                <td className="whitespace-nowrap px-3 py-3 align-middle text-muted-foreground">{app.previous_marks || "N/A"}</td>
                <td className="px-3 py-3 align-middle">
                  <div className="flex flex-col items-center gap-0.5">
                    <FeeStatusPill app={app} />
                    {app.payment_reference && <span className="font-mono text-[10px] text-muted-foreground">{app.payment_reference}</span>}
                  </div>
                </td>
                <td className="px-3 py-3 align-middle"><StatusPill status={app.status} /></td>
                <td className="whitespace-nowrap px-3 py-3 align-middle text-muted-foreground">{format(new Date(app.created_at), "dd MMM yy")}</td>
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center justify-center gap-1.5">
                    <Button size="sm" onClick={() => onView(app)} className="h-8 gap-1.5 rounded-full px-3 text-[11.5px] font-semibold shadow-none">
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                    <Button size="sm" variant={app.payment_status === "paid" ? "outline" : "secondary"} onClick={() => onFee(app)} className="h-8 gap-1.5 rounded-full px-3 text-[11.5px] font-semibold shadow-none">
                      <Wallet className="h-3.5 w-3.5" /> Fee
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDelete(app)} aria-label={`Delete ${app.full_name}`}
                      className="h-8 gap-1.5 rounded-full border-red-300/70 px-3 text-[11.5px] font-semibold text-red-600 shadow-none hover:bg-red-500/10 hover:text-red-700">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile — centred cards with the top accent bar */}
      <ul className="space-y-3 p-3 md:hidden">
        {apps.map((app) => (
          <li key={app.id} className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-muted/30 shadow-sm">
            <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
            <div className="flex flex-col items-center p-3.5 text-center">
              <span className="rounded-full bg-primary/10 px-3 py-0.5 font-mono text-[11.5px] font-bold tracking-wider text-primary">{app.reference_no}</span>
              <p className="mt-1.5 font-heading text-[16px] font-bold leading-snug break-words">{app.full_name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{app.contact_number}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Class {app.applying_class} • <span className="capitalize">{app.admission_type}</span>
                {app.previous_marks ? ` • ${app.previous_marks}` : ""}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                <FeeStatusPill app={app} />
                <StatusPill status={app.status} />
              </div>
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">Applied {format(new Date(app.created_at), "dd MMM yyyy")}</p>
              <div className="mt-3 grid w-full max-w-[300px] grid-cols-3 gap-1.5 border-t border-border/60 pt-3">
                <Button size="sm" onClick={() => onView(app)} className="h-8 gap-1 rounded-full px-2 text-[11.5px] font-semibold shadow-none">
                  <Eye className="h-3.5 w-3.5" /> View
                </Button>
                <Button size="sm" variant={app.payment_status === "paid" ? "outline" : "secondary"} onClick={() => onFee(app)} className="h-8 gap-1 rounded-full px-2 text-[11.5px] font-semibold shadow-none">
                  <Wallet className="h-3.5 w-3.5" /> Fee
                </Button>
                <Button size="sm" variant="outline" onClick={() => onDelete(app)}
                  className="h-8 gap-1 rounded-full border-red-300/70 px-2 text-[11.5px] font-semibold text-red-600 shadow-none hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ══ Sub-tab switcher — Ghallanai pills + paper rule ═════════════════════ */
type SubTab = "applications" | "classes" | "merit";

function SubTabs({ subTab, onTab }: { subTab: SubTab; onTab: (t: SubTab) => void }) {
  const pill = (id: SubTab, label: string, Icon: typeof ClipboardList, cls: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onTab(id)}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition-colors ${cls} ${
        subTab === id
          ? "border-primary bg-primary text-white shadow-sm shadow-primary/25"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
  return (
    <div>
      <div className="flex flex-col items-center gap-2">
        <div className="flex w-full items-center justify-center gap-2">
          {pill("applications", "Applications", ClipboardList, "max-w-[200px] flex-1")}
          {pill("classes", "Classes & Seats", Armchair, "max-w-[200px] flex-1")}
        </div>
        <div className="flex items-center justify-center pt-0.5">
          {pill("merit", "Merit Lists", Trophy, "min-w-[140px]")}
        </div>
      </div>
      {/* paper rule */}
      <div aria-hidden className="mt-3">
        <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <div className="mt-[3px] h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      </div>
    </div>
  );
}

/* ══ MAIN ════════════════════════════════════════════════════════════════ */
const AdminAdmissions = () => {
  const [subTab, setSubTab] = useState<SubTab>("applications");
  const [search, setSearch] = useState("");
  const [statFilter, setStatFilter] = useState<"total" | "feePending" | "feePaid">("total");
  const [chip, setChip] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Admission | null>(null);
  const [feeApp, setFeeApp] = useState<Admission | null>(null);
  const [deleteApp, setDeleteApp] = useState<Admission | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const qc = useQueryClient();
  const { data: admSettings } = useAdmissionSettings();
  const { data: all = [], isLoading, isError, refetch } = useAdminAdmissionsAll();
  const deleteMut = useDeleteAdmission();

  const stats = useMemo(() => ({
    total: all.length,
    feePending: all.filter((a) => a.payment_status !== "paid").length,
    feePaid: all.filter((a) => a.payment_status === "paid").length,
  }), [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const chipDef = FILTER_CHIPS.find((c) => c.key === chip) ?? FILTER_CHIPS[0];
    return all.filter((a) => {
      if (statFilter === "feePending" && a.payment_status === "paid") return false;
      if (statFilter === "feePaid" && a.payment_status !== "paid") return false;
      if (!chipDef.match(a.status)) return false;
      if (classFilter !== "all" && a.applying_class !== classFilter) return false;
      if (typeFilter !== "all" && a.admission_type !== typeFilter) return false;
      if (!q) return true;
      return (
        (a.reference_no || "").toLowerCase().includes(q) ||
        (a.full_name || "").toLowerCase().includes(q) ||
        (a.father_name || "").toLowerCase().includes(q) ||
        (a.payment_reference || "").toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (
          (a.b_form_no || "").replace(/\D/g, "").includes(qDigits) ||
          (a.father_cnic || "").replace(/\D/g, "").includes(qDigits) ||
          (a.contact_number || "").replace(/\D/g, "").includes(qDigits)
        ))
      );
    });
  }, [all, search, statFilter, chip, classFilter, typeFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const filtersActive = !!search.trim() || statFilter !== "total" || chip !== "all" || classFilter !== "all" || typeFilter !== "all";

  const clearFilters = () => {
    setSearch(""); setStatFilter("total"); setChip("all"); setClassFilter("all"); setTypeFilter("all"); setPage(0);
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
      if (!rows || rows.length === 0) { toast.error("There are no applications to export."); return; }
      await exportApplicationsExcel(rows as Admission[], null);
      toast.success(`${rows.length} application(s) exported.`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteApp) return;
    try {
      await deleteMut.mutateAsync(deleteApp.id);
      toast.success("Application deleted.");
      qc.invalidateQueries({ queryKey: ["admin-admission-merit-lists"] });
      setDeleteApp(null);
    } catch {
      toast.error("Failed to delete the application.");
    }
  };

  /* ── Classes & Seats / Merit Lists ──────────────────────────────────── */
  if (subTab === "classes" || subTab === "merit") {
    return (
      <div className="space-y-5">
        <SubTabs subTab={subTab} onTab={setSubTab} />
        <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
          {subTab === "classes" ? <AdminAdmissionClasses /> : <AdminAdmissionMeritLists />}
        </Suspense>
      </div>
    );
  }

  /* ── Applications ───────────────────────────────────────────────────── */
  const tiles: { key: string; label: string; value: string | number; icon: typeof Users; color: string; filter?: "total" | "feePending" | "feePaid"; active: string }[] = [
    { key: "total",      label: "Applied", value: stats.total,      icon: ClipboardList, color: "text-primary",   filter: "total",      active: "border-primary bg-primary/10" },
    { key: "feePending", label: "Pending", value: stats.feePending, icon: Wallet,        color: "text-amber-600", filter: "feePending", active: "border-amber-400 bg-amber-500/10" },
    { key: "feePaid",    label: "Paid",    value: stats.feePaid,    icon: BadgeCheck,    color: "text-green-600", filter: "feePaid",    active: "border-emerald-400 bg-emerald-500/10" },
    { key: "session",    label: "Session", value: admSettings?.session_year ?? "N/A", icon: Users, color: "text-primary", active: "" },
  ];

  return (
    <div className="space-y-5 pb-20 md:pb-0">
      <SubTabs subTab={subTab} onTab={setSubTab} />

      {/* Stat tiles — Applied / Pending / Paid filter the list */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {tiles.map((s) => {
          const clickable = !!s.filter;
          const isActive = clickable && statFilter === s.filter;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!clickable}
              onClick={() => { if (s.filter) { setStatFilter(statFilter === s.filter ? "total" : s.filter); setPage(0); } }}
              className={`flex min-w-0 flex-col items-center justify-center rounded-xl border px-1 py-2 text-center shadow-sm transition-all disabled:opacity-100 ${
                clickable ? "active:scale-[0.97]" : "cursor-default"
              } ${isActive ? s.active : "border-border/60 bg-card"}`}
            >
              <span className="font-heading text-[15px] font-bold leading-none tabular-nums sm:text-xl">{s.value}</span>
              <span className="mt-1.5 flex items-center justify-center gap-1 text-[9px] font-bold uppercase leading-none tracking-wide text-muted-foreground sm:text-[11px]">
                <s.icon className={`h-3 w-3 shrink-0 ${s.color}`} />{s.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col items-center gap-2.5">
        <div className="relative mx-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search ID, name or CNIC"
            className="h-9 rounded-full pl-9 text-[12.5px]"
          />
        </div>
        <div className="flex flex-nowrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}
            className="h-8 gap-1 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold shadow-none">
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </Button>
          {stats.total > 0 && !search.trim() && (
            <Button size="sm" variant="outline" onClick={() => setDeleteAllOpen(true)}
              className="h-8 gap-1 whitespace-nowrap rounded-full border-red-300/70 px-3 text-[11.5px] font-semibold text-red-600 shadow-none hover:bg-red-500/10 hover:text-red-700">
              <Trash2 className="h-3.5 w-3.5" /> Delete All
            </Button>
          )}
        </div>
        <div className="flex flex-nowrap items-center justify-center gap-2">
          <Button size="sm" onClick={exportExcel} disabled={exporting || !stats.total}
            className="h-8 gap-1 whitespace-nowrap rounded-full bg-green-700 px-3 text-[11.5px] font-semibold text-white shadow-none hover:bg-green-800">
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export Excel
          </Button>
          <Button size="sm" onClick={() => setWalkinOpen(true)}
            className="h-8 gap-1 whitespace-nowrap rounded-full px-3 text-[11.5px] font-semibold shadow-none">
            <UserPlus className="h-3.5 w-3.5" /> Add Walk-in / Import
          </Button>
        </div>
      </div>

      {/* List */}
      <Card className="overflow-hidden rounded-2xl border-border/80 p-0 shadow-sm">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        ) : isError ? (
          <div className="py-14 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-400" />
            <p className="text-sm font-semibold">Couldn’t load the applications</p>
            <Button size="sm" variant="outline" onClick={() => refetch()} className="mt-3 h-8 gap-1.5 rounded-full px-4 text-xs font-bold">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <GraduationCap className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
            {filtersActive
              ? "No applications match your filters."
              : "No applications yet, they will appear here as students apply."}
          </div>
        ) : (
          <ApplicationsList apps={pageRows} onView={setSelected} onFee={setFeeApp} onDelete={setDeleteApp} />
        )}

        {!isLoading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
                className="h-8 w-8 rounded-full p-0 shadow-none" aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="text-xs font-semibold tabular-nums">{safePage + 1} / {pages}</span>
              <Button size="sm" variant="outline" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}
                className="h-8 w-8 rounded-full p-0 shadow-none" aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </Card>

      {/* Dialogs */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <DeleteAllDialog count={stats.total} open={deleteAllOpen} onOpenChange={setDeleteAllOpen}
        onBackup={exportExcel} backingUp={exporting} />

      {selected && (
        <Suspense fallback={null}>
          <AdminAdmissionView
            // re-read the row from the live list so Fee / status changes show immediately
            app={all.find((a) => a.id === selected.id) ?? selected}
            onClose={() => setSelected(null)}
            onOpenFee={(a) => setFeeApp(a)}
          />
        </Suspense>
      )}

      {feeApp && <FeeDialog app={all.find((a) => a.id === feeApp.id) ?? feeApp} onClose={() => setFeeApp(null)} />}

      {walkinOpen && (
        <Suspense fallback={null}>
          <AdminWalkinDialog open onClose={() => setWalkinOpen(false)} />
        </Suspense>
      )}

      <AlertDialog open={!!deleteApp} onOpenChange={(o) => { if (!o) setDeleteApp(null); }}>
        <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Application</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <b>{deleteApp?.reference_no}</b> of <b>{deleteApp?.full_name}</b>? Its documents and timeline are removed too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteMut.isPending}
              className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 sm:flex-none">
              {deleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminAdmissions;
