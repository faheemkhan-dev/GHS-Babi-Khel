import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Receipt, X, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFeeStructures, useMutateFeeStructure, type FeeStructure, type PaymentMethod } from "@/hooks/useFees";
import { rs, pillBtn, pillPrimary, pillOutline, fieldCls, ClassTabs, Field, EmptyState } from "./shared";

const FEE_TYPES = [
  { value: "tuition", label: "Tuition Fee" }, { value: "lab", label: "Lab Fee" }, { value: "library", label: "Library Fee" },
  { value: "transport", label: "Transport Fee" }, { value: "exam", label: "Exam Fee" }, { value: "admission", label: "Admission Fee" },
  { value: "migration", label: "Migration Fee" }, { value: "bise", label: "BISE Registration" }, { value: "other", label: "Other Fee" },
];
const FREQ = [
  { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" }, { value: "one_time", label: "One time" },
];
const PM_TYPES = [
  { value: "bank", label: "Bank" }, { value: "easypaisa", label: "EasyPaisa" }, { value: "jazzcash", label: "JazzCash" },
  { value: "cash", label: "Cash (office)" }, { value: "other", label: "Other" },
];
const blank = (cls: string) => ({
  class: cls, fee_type: "tuition", label: "Tuition Fee", amount: 0,
  is_optional: false, frequency: "monthly" as string, payment_methods: [] as PaymentMethod[],
});

export default function SetupTab() {
  const [cls, setCls] = useState("6");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FeeStructure | null>(null);
  const [form, setForm] = useState(blank("6"));
  const [showPay, setShowPay] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: structures = [], isLoading } = useFeeStructures(cls);
  const { upsert, remove } = useMutateFeeStructure();

  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));
  const openAdd = () => { setEditing(null); setForm(blank(cls)); setShowPay(false); setOpen(true); };
  const openEdit = (s: FeeStructure) => {
    setEditing(s);
    const pm = Array.isArray(s.payment_methods) ? s.payment_methods : [];
    setForm({ class: s.class, fee_type: s.fee_type, label: s.label, amount: Number(s.amount), is_optional: s.is_optional, frequency: s.frequency, payment_methods: pm });
    setShowPay(pm.length > 0);
    setOpen(true);
  };
  const updatePm = (i: number, k: string, v: string) => set("payment_methods", form.payment_methods.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  const save = async () => {
    if (!form.label.trim()) { toast.error("Enter a name for this fee"); return; }
    if (!(form.amount >= 0)) { toast.error("Enter a valid amount"); return; }
    setSaving(true);
    try {
      const payload: Partial<FeeStructure> & { id?: string } = {
        ...(editing ? { id: editing.id } : {}),
        class: form.class, fee_type: form.fee_type, label: form.label.trim(), amount: form.amount,
        is_optional: form.is_optional, is_recurring: form.frequency !== "one_time",
        frequency: form.frequency as FeeStructure["frequency"], is_active: true,
      };
      if (form.payment_methods.length > 0) payload.payment_methods = form.payment_methods;
      await upsert.mutateAsync(payload);
      toast.success(editing ? "Fee updated" : "Fee added");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
    setSaving(false);
  };
  const del = async (s: FeeStructure) => {
    if (!confirm(`Remove "${s.label}" from Class ${s.class}? Existing vouchers are not changed.`)) return;
    try { await remove.mutateAsync(s.id); toast.success("Removed"); } catch (e: any) { toast.error(e?.message || "Could not remove"); }
  };

  const monthly = structures.filter((s) => s.frequency === "monthly" && !s.is_optional).reduce((t, s) => t + Number(s.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ClassTabs value={cls} onChange={setCls} />
        <Button className={pillPrimary} onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add fee</Button>
      </div>

      {structures.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-center shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Monthly fee per student · Class {cls}</p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-primary">{rs(monthly)}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : structures.length === 0 ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title={`No fees set for Class ${cls}`} text="Add the monthly tuition and any other fees. Vouchers are built from these."
          action={<Button className={pillPrimary} onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add fee</Button>} />
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          {structures.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold leading-snug">{s.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {FREQ.find((f) => f.value === s.frequency)?.label}{s.is_optional ? " · Optional" : ""}
                </p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums">{rs(s.amount)}</p>
              <div className="flex shrink-0 gap-0.5">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none" onClick={() => openEdit(s)} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-destructive shadow-none hover:bg-destructive/10" onClick={() => del(s)} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader><DialogTitle className="text-base">{editing ? "Edit fee" : "Add fee"} · Class {form.class}</DialogTitle></DialogHeader>
          <div className="space-y-3.5">
            <Field label="Type">
              <Select value={form.fee_type} onValueChange={(v) => { set("fee_type", v); if (!editing || form.label === FEE_TYPES.find((f) => f.value === form.fee_type)?.label) set("label", FEE_TYPES.find((f) => f.value === v)?.label ?? ""); }}>
                <SelectTrigger className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent>{FEE_TYPES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Name shown on voucher"><Input className={fieldCls} value={form.label} onChange={(e) => set("label", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (Rs.)"><Input className={fieldCls} type="number" min={0} value={form.amount} onChange={(e) => set("amount", Number(e.target.value))} /></Field>
              <Field label="Charged">
                <Select value={form.frequency} onValueChange={(v) => set("frequency", v)}>
                  <SelectTrigger className={fieldCls}><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQ.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2.5">
              <span className="min-w-0 text-sm leading-snug">Optional<span className="block text-[11px] text-muted-foreground">Added to vouchers only when you tick it</span></span>
              <Switch checked={form.is_optional} onCheckedChange={(v) => set("is_optional", v)} />
            </label>

            <div className="rounded-xl border border-border/60">
              <button type="button" onClick={() => setShowPay((s) => !s)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium">
                <span>Payment accounts <span className="text-xs font-normal text-muted-foreground">(optional, for challans)</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showPay ? "rotate-180" : ""}`} />
              </button>
              {showPay && (
                <div className="space-y-2.5 border-t border-border/60 p-3">
                  {form.payment_methods.map((m, i) => (
                    <div key={i} className="space-y-2 rounded-lg bg-muted/30 p-2.5">
                      <div className="flex items-center gap-2">
                        <Select value={m.type} onValueChange={(v) => updatePm(i, "type", v)}>
                          <SelectTrigger className="h-8 flex-1 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{PM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <button type="button" aria-label="Remove" onClick={() => set("payment_methods", form.payment_methods.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                      </div>
                      {m.type === "bank" && (
                        <div className="grid grid-cols-2 gap-2">
                          <Input className="h-8 text-xs" placeholder="Bank" value={m.bank_name || ""} onChange={(e) => updatePm(i, "bank_name", e.target.value)} />
                          <Input className="h-8 text-xs" placeholder="Account title" value={m.account_title || ""} onChange={(e) => updatePm(i, "account_title", e.target.value)} />
                          <Input className="h-8 text-xs" placeholder="Account no." value={m.account_number || ""} onChange={(e) => updatePm(i, "account_number", e.target.value)} />
                          <Input className="h-8 text-xs" placeholder="IBAN" value={m.iban || ""} onChange={(e) => updatePm(i, "iban", e.target.value)} />
                        </div>
                      )}
                      {(m.type === "easypaisa" || m.type === "jazzcash") && (
                        <div className="grid grid-cols-2 gap-2">
                          <Input className="h-8 text-xs" placeholder="Account name" value={m.account_name || ""} onChange={(e) => updatePm(i, "account_name", e.target.value)} />
                          <Input className="h-8 text-xs" placeholder="Phone" value={m.phone || ""} onChange={(e) => updatePm(i, "phone", e.target.value)} />
                        </div>
                      )}
                      {m.type === "other" && (
                        <div className="space-y-2">
                          <Input className="h-8 text-xs" placeholder="Name" value={m.label || ""} onChange={(e) => updatePm(i, "label", e.target.value)} />
                          <Textarea className="min-h-[48px] text-xs" placeholder="Instructions" value={m.instructions || ""} onChange={(e) => updatePm(i, "instructions", e.target.value)} />
                        </div>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="outline" className={pillOutline} onClick={() => set("payment_methods", [...form.payment_methods, { type: "bank" }])}>
                    <Plus className="h-3.5 w-3.5" /> Add account
                  </Button>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" className={`${pillOutline} flex-1 sm:flex-none`} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className={`${pillPrimary} flex-1 sm:flex-none`} onClick={save} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
