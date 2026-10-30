import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, Search, Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFeePayments } from "@/hooks/useFees";
import { MONTHS, rs, pillOutline, fieldCls, Stat, EmptyState, Avatar } from "./shared";
import { downloadReportPDF } from "./feePdf";

const METHOD: Record<string, string> = { cash: "Cash", bank: "Bank", online: "Online", cheque: "Cheque" };
const safeDate = (s?: string | null) => { try { const d = s ? new Date(s) : null; return d && !isNaN(d.getTime()) ? format(d, "dd MMM yyyy") : "—"; } catch { return "—"; } };

export default function PaymentsTab() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");
  const { data: payments = [], isLoading, error } = useFeePayments({ month, year });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = Array.isArray(payments) ? payments : [];
    if (!q) return list;
    return list.filter((p) =>
      (p.students?.full_name || "").toLowerCase().includes(q) ||
      (p.students?.roll_number || "").toLowerCase().includes(q) ||
      (p.receipt_number || "").toLowerCase().includes(q));
  }, [payments, search]);
  const total = rows.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const exportPdf = async () => {
    if (!rows.length) { toast.error("No payments to export"); return; }
    try {
      await downloadReportPDF({
        title: "Payments Received",
        subtitle: `${MONTHS[month - 1]} ${year}  |  ${rows.length} payments  |  ${rs(total)}`,
        stats: [["Payments", String(rows.length)], ["Total received", rs(total)]],
        head: ["#", "Student", "Class", "Roll", "Date", "Method", "Amount"],
        body: rows.map((p, i) => [i + 1, p.students?.full_name || "—", p.students?.class || "—", p.students?.roll_number || "—", safeDate(p.payment_date), METHOD[p.payment_method] || p.payment_method, rs(p.amount)]),
        widths: [10, 52, 16, 16, 30, 24, 34],
        fileName: `Payments_${MONTHS[month - 1]}_${year}.pdf`,
      });
    } catch { toast.error("Could not create the PDF"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className={`${fieldCls} w-32 rounded-full`}><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${fieldCls} w-24 rounded-full`} />
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, roll or receipt" className={`${fieldCls} rounded-full pl-9`} />
        </div>
        <Button variant="outline" className={pillOutline} onClick={exportPdf}><Download className="h-3.5 w-3.5" /> PDF</Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Payments" value={rows.length} />
        <Stat label="Received" value={rs(total)} tone="good" />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : error ? (
        <EmptyState icon={<Wallet className="h-5 w-5" />} title="Could not load payments" text="Check your connection and try again." />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Wallet className="h-5 w-5" />} title="No payments" text={`Nothing recorded for ${MONTHS[month - 1]} ${year}.`} />
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={p.students?.full_name} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold leading-snug">{p.students?.full_name || "Unknown student"}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Class {p.students?.class || "—"} · Roll {p.students?.roll_number || "—"} · {METHOD[p.payment_method] || p.payment_method} · {safeDate(p.payment_date)}
                </p>
                {p.receipt_number && <p className="break-all text-[10px] text-muted-foreground/80">{p.receipt_number}</p>}
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{rs(p.amount)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
