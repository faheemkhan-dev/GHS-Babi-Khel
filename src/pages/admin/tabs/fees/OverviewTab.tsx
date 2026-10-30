import { CircleDollarSign, Users, UserX, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeeDashboard, useFeeDefaulters, useClassRoster } from "@/hooks/useFees";
import { CLASSES, rs, Stat, SectionTitle, EmptyState } from "./shared";

function ClassCard({ cls, billed, collected, outstanding }: { cls: string; billed: number; collected: number; outstanding: number }) {
  const { data: roster = [] } = useClassRoster(cls);
  const pct = billed > 0 ? Math.min(100, Math.round((collected / billed) * 100)) : 0;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">Class {cls}</p>
        <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {roster.length} students
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1 text-center">
        <div><p className="text-xs font-bold tabular-nums">{rs(billed)}</p><p className="text-[10px] text-muted-foreground">Billed</p></div>
        <div><p className="text-xs font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{rs(collected)}</p><p className="text-[10px] text-muted-foreground">Collected</p></div>
        <div><p className="text-xs font-bold tabular-nums text-red-600 dark:text-red-400">{rs(outstanding)}</p><p className="text-[10px] text-muted-foreground">Due</p></div>
      </div>
      {roster.length === 0 && (
        <p className="mt-2.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-center text-[11px] leading-snug text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          No students yet — upload them in the Students tab.
        </p>
      )}
    </div>
  );
}

export default function OverviewTab() {
  const { data: dash, isLoading } = useFeeDashboard();
  const { data: defaulters = [] } = useFeeDefaulters();

  if (isLoading) {
    return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(152_48%_14%)] to-[hsl(152_42%_21%)] p-5 text-center text-white shadow-sm">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(43_80%_60%)]/70 to-transparent" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Total collected</p>
        <p className="mt-1 text-3xl font-bold leading-none tabular-nums">{rs(dash?.totalCollected ?? 0)}</p>
        <div className="mx-auto mt-4 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-[hsl(43_85%_60%)]" style={{ width: `${Math.min(100, dash?.collectionRate ?? 0)}%` }} />
        </div>
        <p className="mt-2 text-xs text-white/75">{dash?.collectionRate ?? 0}% of {rs(dash?.totalBilled ?? 0)} billed</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Billed" value={rs(dash?.totalBilled ?? 0)} />
        <Stat label="Outstanding" value={rs(dash?.totalOutstanding ?? 0)} tone="bad" />
        <Stat label="Paid vouchers" value={dash?.paidVouchers ?? 0} tone="good" />
        <Stat label="Pending vouchers" value={(dash?.unpaidVouchers ?? 0) + (dash?.partialVouchers ?? 0) + (dash?.overdueVouchers ?? 0)} tone="warn" />
      </div>

      <div>
        <SectionTitle>Classes</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CLASSES.map((c) => {
            const d = dash?.classBreakdown?.[c];
            return <ClassCard key={c} cls={c} billed={d?.billed ?? 0} collected={d?.collected ?? 0} outstanding={d?.outstanding ?? 0} />;
          })}
        </div>
      </div>

      <div>
        <SectionTitle>Highest outstanding</SectionTitle>
        {defaulters.length === 0 ? (
          <EmptyState icon={dash?.totalVouchers ? <Users className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            title={dash?.totalVouchers ? "Nobody owes anything" : "No vouchers yet"}
            text={dash?.totalVouchers ? "All generated vouchers are fully paid." : "Set up fees, then generate vouchers from the Vouchers tab."} />
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            {defaulters.slice(0, 8).map((d) => (
              <div key={d.student_id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"><UserX className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">{d.full_name || "Student"}</p>
                  <p className="text-[11px] text-muted-foreground">Class {d.class} · Roll {d.roll_number || "—"} · {d.total_vouchers} voucher{d.total_vouchers === 1 ? "" : "s"}</p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{rs(d.outstanding)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
