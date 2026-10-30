import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import type { FeeVoucher } from "@/hooks/useFees";

export const CLASSES = ["6", "7", "8", "9", "10"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const rs = (n: number | string) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

// ── Thin pill buttons (house style) ──────────────────────────────
export const pillBtn = "h-8 min-w-0 gap-1.5 rounded-full px-3.5 text-xs font-semibold shadow-none";
export const pillPrimary = `${pillBtn} bg-primary text-primary-foreground hover:bg-primary/90`;
export const pillOutline = `${pillBtn} border-border/70 bg-card text-foreground hover:bg-muted`;
export const fieldCls = "h-9 rounded-xl border-border/60 bg-card text-sm shadow-none";

// ── Voucher status (overdue is derived from the due date) ────────
export type ViewStatus = "paid" | "partial" | "unpaid" | "overdue" | "waived";
export function voucherView(v: FeeVoucher) {
  const total = Number(v.total_amount) + Number(v.late_fee || 0);
  const paid = Number(v.paid_amount || 0);
  const balance = Math.max(0, total - paid);
  let status: ViewStatus = v.status as ViewStatus;
  if (v.status !== "waived") {
    if (balance <= 0 && total > 0) status = "paid";
    else if (v.due_date && new Date(`${v.due_date}T23:59:59`) < new Date()) status = "overdue";
    else status = paid > 0 ? "partial" : "unpaid";
  }
  return { total, paid, balance, status };
}

const STATUS_STYLE: Record<ViewStatus, string> = {
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  partial: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  unpaid: "border-border bg-muted/60 text-muted-foreground",
  overdue: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
  waived: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300",
};
export const STATUS_LABEL: Record<ViewStatus, string> = { paid: "Paid", partial: "Partial", unpaid: "Unpaid", overdue: "Overdue", waived: "Waived" };

export function StatusChip({ status }: { status: ViewStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Small layout pieces ──────────────────────────────────────────
export function ClassTabs({ value, onChange, all }: { value: string; onChange: (c: string) => void; all?: boolean }) {
  const items = all ? ["all", ...CLASSES] : CLASSES;
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="inline-flex gap-1.5">
        {items.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`h-8 shrink-0 rounded-full border px-4 text-xs font-semibold transition-colors ${
              value === c ? "border-primary bg-primary text-primary-foreground" : "border-border/70 bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {c === "all" ? "All classes" : `Class ${c}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <Label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-foreground";
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card px-3 py-3 text-center shadow-sm">
      <p className={`break-words text-lg font-bold leading-tight tabular-nums sm:text-xl ${color}`}>{value}</p>
      <p className="mt-1 text-[11px] font-medium leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {text && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Avatar({ name }: { name?: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
);
