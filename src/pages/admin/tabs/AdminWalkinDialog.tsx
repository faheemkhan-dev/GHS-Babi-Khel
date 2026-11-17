// src/pages/admin/tabs/AdminWalkinDialog.tsx — paper (walk-in) applications
// entered by the office (ported from GHSS Ghallanai, High School columns):
//   • "Add One": quick form → admission_admin_add_walkin RPC; the fee can be
//     marked received right away (only fee-paid students enter the merit list)
//   • "Import Excel": download the template sheet, then upload the filled
//     file → parsed client-side → admission_admin_import_walkins (per-row
//     isolation server-side)
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import {
  Loader2, UserPlus, FileSpreadsheet, Upload, CheckCircle2, XCircle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { useAddAdmissionWalkin, useImportAdmissionWalkins, type AdmissionType } from "@/hooks/useAdmission";
import { downloadWalkinTemplate, parseWalkinImport } from "@/lib/admissionExcel";

const emptyForm = {
  full_name: "", father_name: "", b_form_no: "", contact_number: "",
  applying_class: "", admission_type: "fresh" as AdmissionType,
  previous_school: "", previous_class: "", previous_marks: "", year_of_passing: "",
  home_address: "",
  paid: true, payment_method: "cash", payment_receipt: "",
};

export default function AdminWalkinDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"one" | "import">("one");

  // ── Add One ────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({ ...emptyForm });
  const [moreOpen, setMoreOpen] = useState(false);
  const addMut = useAddAdmissionWalkin();
  const [lastRef, setLastRef] = useState<string | null>(null);

  const addOne = async () => {
    if (!form.full_name.trim() || !form.father_name.trim() || form.b_form_no.replace(/\D/g, "").length !== 13
      || !form.contact_number.trim() || !form.applying_class) {
      toast.error("Name, father name, 13-digit B-Form, mobile and class are required.");
      return;
    }
    try {
      const res = await addMut.mutateAsync({ ...form });
      setLastRef(res.reference_no);
      toast.success(`Saved — Tracking ID ${res.reference_no}`, { icon: "🧾", duration: 6000 });
      // Keep marks + class + fee settings for the next student (fast re-entry).
      setForm((f) => ({
        ...emptyForm,
        applying_class: f.applying_class,
        previous_class: f.previous_class,
        paid: f.paid, payment_method: f.payment_method,
      }));
    } catch (e: any) {
      toast.error(e?.message || "Could not save the walk-in application.");
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const importMut = useImportAdmissionWalkins();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedCount, setParsedCount] = useState(0);
  const [markUnpaidAsPaid, setMarkUnpaidAsPaid] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number; errors: Array<{ row: number; name: string; error: string }> } | null>(null);
  const [parsing, setParsing] = useState(false);

  const onFile = async (file: File | null | undefined) => {
    if (!file) return;
    setParsing(true);
    setResult(null);
    try {
      const parsed = await parseWalkinImport(file);
      if (parsed.error || parsed.rows.length === 0) {
        toast.error(parsed.error || "No data rows found in the file.");
        setFileName(null);
        setParsedCount(0);
        return;
      }
      setFileName(file.name);
      setParsedCount(parsed.rows.length);
      toast.success(`${parsed.rows.length} row(s) ready to import.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not read the file.");
    } finally {
      setParsing(false);
    }
  };

  const doImport = async (file: File) => {
    try {
      const parsed = await parseWalkinImport(file);
      if (parsed.error || parsed.rows.length === 0) {
        toast.error(parsed.error || "No rows to import.");
        return;
      }
      const rows = parsed.rows.map((r) => ({
        ...r,
        paid: r.paid || markUnpaidAsPaid,
        payment_method: r.paid || markUnpaidAsPaid ? r.payment_method : "cash",
      }));
      const res = await importMut.mutateAsync(rows as any);
      setResult({ imported: res.imported, failed: res.failed, errors: res.errors ?? [] });
      if (res.failed === 0) {
        toast.success(`${res.imported} walk-in application(s) imported.`);
        setTimeout(() => { onClose(); resetImport(); }, 1600);
      } else {
        toast(`${res.imported} imported · ${res.failed} failed — see the details below.`, { icon: "⚠️", duration: 7000 });
      }
    } catch (e: any) {
      toast.error(e?.message || "Import failed.");
    }
  };

  const resetImport = () => {
    setFileName(null); setParsedCount(0); setResult(null); setMarkUnpaidAsPaid(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="w-4 h-4" /></span>
            Walk-in Applications
          </DialogTitle>
        </DialogHeader>

        {/* Mode pills */}
        <div className="flex gap-1.5 p-1 bg-muted/50 rounded-full">
          {(["one", "import"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {m === "one" ? "Add One" : "Import Excel"}
            </button>
          ))}
        </div>

        {mode === "one" ? (
          <div className="space-y-3">
            {lastRef && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-3 py-2">
                <p className="text-xs text-green-800 dark:text-green-300">Saved — Tracking ID</p>
                <Badge className="font-mono bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-300">{lastRef}</Badge>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold mb-1 block">Student Name *</Label>
                <Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  placeholder="Full name" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Father Name *</Label>
                <Input value={form.father_name} onChange={(e) => setForm((f) => ({ ...f, father_name: e.target.value }))}
                  placeholder="Father name" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">B-Form No. * (13 digits)</Label>
                <Input value={form.b_form_no} onChange={(e) => setForm((f) => ({ ...f, b_form_no: e.target.value }))}
                  placeholder="31203-1234567-1" className="h-9 text-sm font-mono" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Mobile *</Label>
                <Input value={form.contact_number} onChange={(e) => setForm((f) => ({ ...f, contact_number: e.target.value }))}
                  placeholder="03XX-XXXXXXX" className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Class *</Label>
                <Select value={form.applying_class} onValueChange={(v) => setForm((f) => ({ ...f, applying_class: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {["6", "7", "8", "9", "10"].map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Admission Type</Label>
                <Select value={form.admission_type} onValueChange={(v) => setForm((f) => ({ ...f, admission_type: v as AdmissionType }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fresh">Fresh Admission</SelectItem>
                    <SelectItem value="migration">Migration / Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <button onClick={() => setMoreOpen((v) => !v)}
              className="text-[11px] text-primary hover:underline flex items-center gap-1">
              {moreOpen ? <X className="w-3 h-3" /> : null}{moreOpen ? "Hide details" : "More details (previous school, marks…)"}
            </button>

            {moreOpen && (
              <div className="grid grid-cols-2 gap-3 p-2.5 rounded-xl bg-muted/40 border border-border/60">
                <div className="col-span-2">
                  <Label className="text-xs font-semibold mb-1 block">Previous School</Label>
                  <Input value={form.previous_school} onChange={(e) => setForm((f) => ({ ...f, previous_school: e.target.value }))}
                    placeholder="School name" className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Previous Class</Label>
                  <Input value={form.previous_class} onChange={(e) => setForm((f) => ({ ...f, previous_class: e.target.value }))}
                    placeholder="e.g. 8" className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Marks / Grade</Label>
                  <Input value={form.previous_marks} onChange={(e) => setForm((f) => ({ ...f, previous_marks: e.target.value }))}
                    placeholder="450/600 or 82%" className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Year of Passing</Label>
                  <Input value={form.year_of_passing} onChange={(e) => setForm((f) => ({ ...f, year_of_passing: e.target.value }))}
                    placeholder="2026" className="h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Address</Label>
                  <Input value={form.home_address} onChange={(e) => setForm((f) => ({ ...f, home_address: e.target.value }))}
                    placeholder="Village / Mohalla" className="h-9 text-sm" />
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold">Processing fee received</p>
                  <p className="text-[10.5px] text-muted-foreground">Only fee-paid students enter the merit list.</p>
                </div>
                <Switch checked={form.paid} onCheckedChange={(v) => setForm((f) => ({ ...f, paid: v }))} />
              </div>
              {form.paid && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold mb-1 block">Payment Method</Label>
                    <Select value={form.payment_method} onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash at School</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="easypaisa">EasyPaisa</SelectItem>
                        <SelectItem value="jazzcash">JazzCash</SelectItem>
                        <SelectItem value="safepay">Online Payment</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-semibold mb-1 block">Receipt No. (optional)</Label>
                    <Input value={form.payment_receipt} onChange={(e) => setForm((f) => ({ ...f, payment_receipt: e.target.value }))}
                      placeholder="RC-001" className="h-9 text-sm" />
                  </div>
                </div>
              )}
            </div>

            <Button onClick={addOne} disabled={addMut.isPending} className="h-10 w-full gap-2 rounded-xl text-xs font-bold">
              {addMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><UserPlus className="w-4 h-4" /> Save Walk-in Application</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Button variant="outline" onClick={() => downloadWalkinTemplate().catch((e) => toast.error(e?.message || "Template failed."))}
              className="h-10 w-full gap-2 rounded-xl text-xs font-bold">
              <FileSpreadsheet className="w-4 h-4" /> Download Template (.xlsx)
            </Button>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 p-5 text-center hover:border-primary/40 transition-colors">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])} />
              {parsing ? (
                <><Loader2 className="w-5 h-5 animate-spin text-primary" /><span className="text-xs text-muted-foreground">Reading file…</span></>
              ) : fileName ? (
                <><CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-xs font-semibold">{fileName}</span>
                  <span className="text-[11px] text-muted-foreground">{parsedCount} row(s) detected — header row {`found`}</span></>
              ) : (
                <><Upload className="w-5 h-5 text-primary" />
                  <span className="text-xs font-semibold">Choose the filled template</span>
                  <span className="text-[11px] text-muted-foreground">.xlsx / .csv · up to 500 rows</span></>
              )}
            </label>

            {fileName && !result && (
              <>
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/60 bg-muted/30">
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Mark rows without a "paid" value as Paid (Cash at School)
                  </p>
                  <Switch checked={markUnpaidAsPaid} onCheckedChange={setMarkUnpaidAsPaid} />
                </div>
                <Button onClick={() => {
                  const file = fileRef.current?.files?.[0];
                  if (file) doImport(file);
                }} disabled={importMut.isPending}
                  className="h-10 w-full gap-2 rounded-xl text-xs font-bold">
                  {importMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : <><Upload className="w-4 h-4" /> Import {parsedCount} Row(s)</>}
                </Button>
              </>
            )}

            {result && (
              <div className="space-y-2 rounded-xl border border-border/60 p-3">
                <div className="flex items-center gap-3 text-xs font-bold">
                  <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> {result.imported} imported</span>
                  {result.failed > 0 && <span className="text-red-600 flex items-center gap-1"><XCircle className="w-4 h-4" /> {result.failed} failed</span>}
                </div>
                {result.errors.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.errors.map((er, i) => (
                      <p key={i} className="text-[11px] text-red-600">
                        Row {er.row} ({er.name}): {er.error}
                      </p>
                    ))}
                  </div>
                )}
                <Button size="sm" variant="outline" onClick={resetImport} className="h-8 rounded-full px-3 text-[11px] font-bold">
                  Choose another file
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
