import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, Download, Trash2, Loader2, FileText, Wallet, PlusCircle, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import CustomFeeModal from "@/components/admin/fees/CustomFeeModal";
import {
  useFeeVouchers, useFeeStructures, useGenerateVouchers, useRecordPayment, useDeleteVoucher, useClassRoster,
  type FeeVoucher,
} from "@/hooks/useFees";
import {
  MONTHS, rs, pillPrimary, pillOutline, fieldCls, ClassTabs, Field, Stat, StatusChip, EmptyState, Avatar, voucherView, STATUS_LABEL,
  type ViewStatus,
} from "./shared";
import { downloadVouchersPDF } from "./feePdf";

const METHODS = [{ v: "cash", l: "Cash" }, { v: "bank", l: "Bank" }, { v: "online", l: "Online" }, { v: "cheque", l: "Cheque" }] as const;

export default function VouchersTab() {
  const now = new Date();
  const [cls, setCls] = useState("6");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [status, setStatus] = useState<"all" | ViewStatus>("all");
  const [search, setSearch] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [payFor, setPayFor] = useState<FeeVoucher | null>(null);

  const { data: vouchers = [], isLoading } = useFeeVouchers({ classLevel: cls, month, year });
  const { data: roster = [] } = useClassRoster(cls);
  const del = useDeleteVoucher();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vouchers
      .filter((v) => (status === "all" ? true : voucherView(v).status === status))
      .filter((v) => !q || (v.students?.full_name || "").toLowerCase().includes(q) || (v.students?.roll_number || "").toLowerCase().includes(q) || v.voucher_number.toLowerCase().includes(q))
      .sort((a, b) => (a.students?.roll_number || "").localeCompare(b.students?.roll_number || "", undefined, { numeric: true }));
  }, [vouchers, status, search]);

  const sum = useMemo(() => {
    let billed = 0, paid = 0;
    rows.forEach((v) => { const x = voucherView(v); billed += x.total; paid += x.paid; });
    return { billed, paid, due: billed - paid };
  }, [rows]);

  const download = async (list: FeeVoucher[], name: string) => {
    if (!list.length) { toast.error("No vouchers to download"); return; }
    const t = toast.loading("Preparing PDF…");
    try { await downloadVouchersPDF(list, name); toast.success("PDF downloaded", { id: t }); }
    catch { toast.error("Could not create the PDF", { id: t }); }
  };
  const remove = async (v: FeeVoucher) => {
    if (!confirm(`Delete voucher ${v.voucher_number} for ${v.students?.full_name || "this student"}? Its payments are removed too.`)) return;
    try { await del.mutateAsync(v.id); toast.success("Voucher deleted"); } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };

  return (
    <div className="space-y-4">
      <ClassTabs value={cls} onChange={setCls} />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className={`${fieldCls} w-32 rounded-full`}><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${fieldCls} w-24 rounded-full`} />
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className={`${fieldCls} w-32 rounded-full`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {(Object.keys(STATUS_LABEL) as ViewStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, roll or voucher no." className={`${fieldCls} rounded-full pl-9`} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className={pillPrimary} onClick={() => setGenOpen(true)}><Plus className="h-3.5 w-3.5" /> Generate</Button>
        <Button variant="outline" className={pillOutline} onClick={() => setChargeOpen(true)}><PlusCircle className="h-3.5 w-3.5" /> Extra charge</Button>
        <Button variant="outline" className={pillOutline} onClick={() => download(rows, `Vouchers_Class${cls}_${MONTHS[month - 1]}_${year}.pdf`)}><Download className="h-3.5 w-3.5" /> All PDF</Button>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="Billed" value={rs(sum.billed)} />
        <Stat label="Collected" value={rs(sum.paid)} tone="good" />
        <Stat label="Due" value={rs(sum.due)} tone="bad" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileText className="h-5 w-5" />}
          title={vouchers.length ? "No vouchers match" : `No vouchers for ${MONTHS[month - 1]} ${year}`}
          text={vouchers.length ? "Try a different filter or search." : roster.length ? `${roster.length} students are on the Class ${cls} list. Generate their vouchers in one tap.` : "Upload your student list in the Students tab first."}
          action={!vouchers.length && roster.length > 0 ? <Button className={pillPrimary} onClick={() => setGenOpen(true)}><Plus className="h-3.5 w-3.5" /> Generate vouchers</Button> : undefined} />
      ) : (
        <div className="space-y-2.5">
          {rows.map((v) => {
            const x = voucherView(v);
            return (
              <div key={v.id} className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
                <div className="flex items-start gap-3">
                  <Avatar name={v.students?.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold leading-snug">{v.students?.full_name || "Student"}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">Roll {v.students?.roll_number || "—"} · Due {v.due_date ? format(new Date(v.due_date), "dd MMM") : "—"}</p>
                    <p className="mt-0.5 break-all text-[10px] text-muted-foreground/80">{v.voucher_number}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusChip status={x.status} />
                    <p className="text-sm font-bold tabular-nums">{rs(x.total)}</p>
                  </div>
                </div>
                {(v.fee_items?.length ?? 0) > 0 && (
                  <p className="mt-2 break-words text-[11px] leading-snug text-muted-foreground">
                    {v.fee_items.map((f) => `${f.label} ${Math.round(Number(f.amount)).toLocaleString("en-US")}`).join("  ·  ")}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                  {x.balance > 0 && x.status !== "waived" && (
                    <Button className={pillPrimary} onClick={() => setPayFor(v)}><Wallet className="h-3.5 w-3.5" /> Receive {rs(x.balance)}</Button>
                  )}
                  {x.paid > 0 && x.balance > 0 && <span className="text-[11px] text-muted-foreground">Paid {rs(x.paid)}</span>}
                  <div className="ml-auto flex gap-1">
                    <Button variant="outline" className={pillOutline} onClick={() => download([v], `Voucher_${v.voucher_number}.pdf`)}><Download className="h-3.5 w-3.5" /> PDF</Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-destructive shadow-none hover:bg-destructive/10" onClick={() => remove(v)} aria-label="Delete voucher"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GenerateDialog open={genOpen} onClose={() => setGenOpen(false)} cls={cls} month={month} year={year} />
      <PayDialog voucher={payFor} onClose={() => setPayFor(null)} />
      <CustomFeeModal open={chargeOpen} onClose={() => setChargeOpen(false)} defaultClass={cls} />
    </div>
  );
}

// ───────────────────────── Generate ─────────────────────────
function GenerateDialog({ open, onClose, cls, month, year }: { open: boolean; onClose: () => void; cls: string; month: number; year: number }) {
  const { data: roster = [] } = useClassRoster(cls);
  const { data: structures = [] } = useFeeStructures(cls);
  const gen = useGenerateVouchers();
  const [period, setPeriod] = useState<"monthly" | "quarterly">("monthly");
  const [due, setDue] = useState("");
  const [late, setLate] = useState(0);
  const [optional, setOptional] = useState<string[]>([]);
  const [bank, setBank] = useState({ bank_name: "", account_title: "", account_number: "", iban: "" });

  // default due date = 20th of the selected month, each time the dialog opens
  const [lastKey, setLastKey] = useState("");
  const key = `${open}-${month}-${year}`;
  if (open && key !== lastKey) { setLastKey(key); setDue(format(new Date(year, month - 1, 20), "yyyy-MM-dd")); setOptional([]); }

  const items = structures.filter((s) => {
    if (s.frequency === "one_time" || s.frequency === "annual") return false;
    return period === "monthly" ? s.frequency === "monthly" : s.frequency === "monthly" || s.frequency === "quarterly";
  });
  const mult = period === "quarterly" ? 3 : 1;
  const perStudent = items.reduce((t, s) => {
    if (s.is_optional && !optional.includes(s.fee_type)) return t;
    return t + Number(s.amount) * (s.frequency === "monthly" ? mult : 1);
  }, 0);

  const submit = async () => {
    if (!due) { toast.error("Choose a due date"); return; }
    try {
      const r = await gen.mutateAsync({
        classLevel: cls, month, year, feePeriod: period, dueDate: due, lateFee: late, optionalFees: optional,
        bankDetails: Object.fromEntries(Object.entries(bank).filter(([, v]) => v.trim())) as any,
      });
      toast.success(r.skipped > 0 ? `${r.created} created · ${r.skipped} already existed` : `${r.created} vouchers created for Class ${cls}`);
      onClose();
    } catch (e: any) { toast.error(e?.message || "Could not generate"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-base">Generate vouchers · Class {cls}</DialogTitle></DialogHeader>
        {roster.length === 0 ? (
          <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>There are no students in Class {cls}. Upload the student list in the Students tab, then come back.</span>
          </div>
        ) : (
          <>
            <p className="text-center text-sm text-muted-foreground">
              <strong className="text-foreground">{roster.length} students</strong> · {MONTHS[month - 1]} {year}
            </p>
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Period">
                  <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                    <SelectTrigger className={fieldCls}><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Due date"><Input className={fieldCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              </div>
              <Field label="Late fee (Rs.)" hint="Added to every voucher. Leave 0 for none."><Input className={fieldCls} type="number" min={0} value={late} onChange={(e) => setLate(Number(e.target.value))} /></Field>

              <div className="rounded-xl border border-border/60 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fees on each voucher</p>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No fees are set for this class yet. Add them in Fee Setup.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-xs">
                        {s.is_optional ? (
                          <input type="checkbox" className="rounded accent-primary" checked={optional.includes(s.fee_type)}
                            onChange={(e) => setOptional((p) => e.target.checked ? [...p, s.fee_type] : p.filter((x) => x !== s.fee_type))} />
                        ) : <span className="w-3.5" />}
                        <span className="min-w-0 flex-1 break-words">{s.label}{s.is_optional ? " (optional)" : ""}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{rs(Number(s.amount) * (s.frequency === "monthly" ? mult : 1))}</span>
                      </label>
                    ))}
                    <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-bold">
                      <span>Per student</span><span className="tabular-nums text-primary">{rs(perStudent)}</span>
                    </div>
                  </div>
                )}
              </div>

              <details className="rounded-xl border border-border/60">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Bank details for the voucher <span className="text-xs font-normal text-muted-foreground">(optional)</span></summary>
                <div className="grid grid-cols-2 gap-2 border-t border-border/60 p-3">
                  <Input className="h-8 text-xs" placeholder="Bank" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="Account title" value={bank.account_title} onChange={(e) => setBank({ ...bank, account_title: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="Account no." value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} />
                  <Input className="h-8 text-xs" placeholder="IBAN" value={bank.iban} onChange={(e) => setBank({ ...bank, iban: e.target.value })} />
                </div>
              </details>
              <p className="text-center text-[11px] text-muted-foreground">Students who already have a voucher for this month are skipped — their payments stay safe.</p>
            </div>
          </>
        )}
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" className={`${pillOutline} flex-1 sm:flex-none`} onClick={onClose}>Cancel</Button>
          {roster.length > 0 && (
            <Button className={`${pillPrimary} flex-1 sm:flex-none`} onClick={submit} disabled={gen.isPending || perStudent <= 0}>
              {gen.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Generate {roster.length}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Receive payment ─────────────────────────
function PayDialog({ voucher, onClose }: { voucher: FeeVoucher | null; onClose: () => void }) {
  const rec = useRecordPayment();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<"cash" | "bank" | "online" | "cheque">("cash");
  const [receipt, setReceipt] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);

  const x = voucher ? voucherView(voucher) : null;
  if (voucher && x && voucher.id !== lastId) { setLastId(voucher.id); setAmount(x.balance); setMethod("cash"); setReceipt(""); setNotes(""); setDate(format(new Date(), "yyyy-MM-dd")); }
  if (!voucher && lastId) setLastId(null);

  const submit = async () => {
    if (!voucher || !x) return;
    if (!(amount > 0)) { toast.error("Enter an amount"); return; }
    if (amount > x.balance) { toast.error(`The balance is only ${rs(x.balance)}`); return; }
    try {
      await rec.mutateAsync({ voucherId: voucher.id, studentId: voucher.student_id, amount, paymentMethod: method, receiptNumber: receipt || undefined, paymentDate: date, notes: notes || undefined });
      toast.success("Payment recorded");
      onClose();
    } catch (e: any) { toast.error(e?.message || "Payment failed"); }
  };

  return (
    <Dialog open={!!voucher} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-base">Receive payment</DialogTitle></DialogHeader>
        {voucher && x && (
          <div className="space-y-3.5">
            <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-center">
              <p className="break-words text-sm font-semibold">{voucher.students?.full_name}</p>
              <p className="text-[11px] text-muted-foreground">Roll {voucher.students?.roll_number} · Balance {rs(x.balance)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (Rs.)"><Input className={fieldCls} type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
              <Field label="Date"><Input className={fieldCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            <Field label="Method">
              <div className="grid grid-cols-4 gap-1.5">
                {METHODS.map((m) => (
                  <button key={m.v} type="button" onClick={() => setMethod(m.v)}
                    className={`h-8 rounded-full border text-xs font-semibold transition-colors ${method === m.v ? "border-primary bg-primary text-primary-foreground" : "border-border/70 text-muted-foreground hover:bg-muted"}`}>{m.l}</button>
                ))}
              </div>
            </Field>
            <Field label="Receipt no." hint="Leave empty to create one automatically."><Input className={fieldCls} value={receipt} onChange={(e) => setReceipt(e.target.value)} /></Field>
            <Field label="Note (optional)"><Textarea className="min-h-[56px] rounded-xl text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        )}
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" className={`${pillOutline} flex-1 sm:flex-none`} onClick={onClose}>Cancel</Button>
          <Button className={`${pillPrimary} flex-1 sm:flex-none`} onClick={submit} disabled={rec.isPending}>{rec.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
