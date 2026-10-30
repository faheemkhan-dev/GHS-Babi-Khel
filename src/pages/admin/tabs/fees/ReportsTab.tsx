import { useState } from "react";
import { Download, BarChart3 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeeCollectionReport, useClassCollectionSummary, useFeeDefaulters } from "@/hooks/useFees";
import { MONTHS, rs, pillOutline, fieldCls, ClassTabs, Stat, EmptyState } from "./shared";
import { downloadReportPDF } from "./feePdf";

type View = "months" | "classes" | "defaulters";
const VIEWS: { v: View; l: string }[] = [{ v: "months", l: "By month" }, { v: "classes", l: "By class" }, { v: "defaulters", l: "Defaulters" }];

const th = "px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
const td = "px-2 py-2.5 text-center text-xs tabular-nums";
const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm">
    <table className="w-full min-w-[20rem] border-collapse">
      <thead className="bg-muted/60"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-border/50">{children}</tbody>
    </table>
  </div>
);

export default function ReportsTab() {
  const [view, setView] = useState<View>("months");
  const [year, setYear] = useState(new Date().getFullYear());
  const [cls, setCls] = useState("all");
  const monthly = useFeeCollectionReport(year, { enabled: view === "months" });
  const classes = useClassCollectionSummary(year, { enabled: view === "classes" });
  const defaulters = useFeeDefaulters(cls === "all" ? undefined : cls, { enabled: view === "defaulters" });

  const run = async (fn: () => Promise<void>) => { try { await fn(); } catch { toast.error("Could not create the PDF"); } };

  const exportMonths = () => run(async () => {
    const rows = (monthly.data ?? []).filter((r) => r.total_vouchers > 0);
    const billed = rows.reduce((s, r) => s + r.total_amount, 0), got = rows.reduce((s, r) => s + r.collected, 0);
    await downloadReportPDF({ title: "Collection by Month", subtitle: `Year ${year}`,
      stats: [["Billed", rs(billed)], ["Collected", rs(got)], ["Outstanding", rs(billed - got)], ["Rate", `${billed ? Math.round((got / billed) * 100) : 0}%`]],
      head: ["Month", "Vouchers", "Billed", "Collected", "Outstanding", "Rate"],
      body: rows.map((r) => [MONTHS[r.month - 1], r.total_vouchers, rs(r.total_amount), rs(r.collected), rs(r.outstanding), `${r.collection_rate}%`]),
      widths: [32, 24, 32, 32, 34, 28], fileName: `Fee_Collection_${year}.pdf` });
  });
  const exportClasses = () => run(async () => {
    const rows = classes.data ?? [];
    await downloadReportPDF({ title: "Collection by Class", subtitle: `Year ${year}`,
      head: ["Class", "Students", "Billed", "Collected", "Outstanding", "Rate", "Defaulters"],
      body: rows.map((r) => [`Class ${r.class}`, r.total_students, rs(r.total_billed), rs(r.total_collected), rs(r.total_outstanding), `${r.collection_rate}%`, r.defaulters_count]),
      widths: [22, 22, 30, 30, 32, 20, 26], fileName: `Fee_By_Class_${year}.pdf` });
  });
  const exportDefaulters = () => run(async () => {
    const rows = defaulters.data ?? [];
    const total = rows.reduce((s, r) => s + r.outstanding, 0);
    await downloadReportPDF({ title: "Fee Defaulters", subtitle: cls === "all" ? "All classes" : `Class ${cls}`,
      stats: [["Students", String(rows.length)], ["Outstanding", rs(total)]],
      head: ["#", "Student", "Class", "Roll", "Vouchers", "Outstanding"],
      body: rows.map((r, i) => [i + 1, r.full_name || "—", r.class, r.roll_number || "—", r.total_vouchers, rs(r.outstanding)]),
      widths: [10, 62, 18, 18, 26, 48], fileName: `Fee_Defaulters_${cls === "all" ? "All" : "Class" + cls}.pdf` });
  });

  const exportCurrent = view === "months" ? exportMonths : view === "classes" ? exportClasses : exportDefaulters;
  const loading = view === "months" ? monthly.isLoading : view === "classes" ? classes.isLoading : defaulters.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
          {VIEWS.map((x) => (
            <button key={x.v} type="button" onClick={() => setView(x.v)}
              className={`h-7 rounded-full px-3.5 text-xs font-semibold transition-all ${view === x.v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{x.l}</button>
          ))}
        </div>
        {view !== "defaulters" && <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${fieldCls} w-24 rounded-full`} />}
        <Button variant="outline" className={`${pillOutline} ml-auto`} onClick={exportCurrent}><Download className="h-3.5 w-3.5" /> PDF</Button>
      </div>
      {view === "defaulters" && <ClassTabs all value={cls} onChange={setCls} />}

      {loading ? <Skeleton className="h-48 rounded-2xl" /> : view === "months" ? (
        (() => {
          const rows = (monthly.data ?? []).filter((r) => r.total_vouchers > 0);
          if (!rows.length) return <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No data" text={`No vouchers were generated in ${year}.`} />;
          return <Table head={["Month", "Vouchers", "Billed", "Collected", "Rate"]}>
            {rows.map((r) => (<tr key={r.month}><td className={`${td} font-semibold`}>{MONTHS[r.month - 1]}</td><td className={td}>{r.total_vouchers}</td><td className={td}>{rs(r.total_amount)}</td><td className={`${td} text-emerald-600 dark:text-emerald-400`}>{rs(r.collected)}</td><td className={`${td} font-semibold`}>{r.collection_rate}%</td></tr>))}
          </Table>;
        })()
      ) : view === "classes" ? (
        (classes.data ?? []).length === 0 ? <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No data" text={`No vouchers were generated in ${year}.`} /> :
        <Table head={["Class", "Students", "Billed", "Collected", "Due", "Rate"]}>
          {(classes.data ?? []).map((r) => (<tr key={r.class}><td className={`${td} font-semibold`}>Class {r.class}</td><td className={td}>{r.total_students}</td><td className={td}>{rs(r.total_billed)}</td><td className={`${td} text-emerald-600 dark:text-emerald-400`}>{rs(r.total_collected)}</td><td className={`${td} text-red-600 dark:text-red-400`}>{rs(r.total_outstanding)}</td><td className={`${td} font-semibold`}>{r.collection_rate}%</td></tr>))}
        </Table>
      ) : (defaulters.data ?? []).length === 0 ? (
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No defaulters" text="Everyone with a voucher has paid in full." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Students owing" value={(defaulters.data ?? []).length} tone="warn" />
            <Stat label="Total outstanding" value={rs((defaulters.data ?? []).reduce((s, r) => s + r.outstanding, 0))} tone="bad" />
          </div>
          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            {(defaulters.data ?? []).map((d) => (
              <div key={d.student_id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">{d.full_name || "Student"}</p>
                  <p className="text-[11px] text-muted-foreground">Class {d.class} · Roll {d.roll_number || "—"} · {d.total_vouchers} voucher{d.total_vouchers === 1 ? "" : "s"}</p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{rs(d.outstanding)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
