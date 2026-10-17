/* ─────────────────────────────────────────────────────────────────────────────
   PREMIUM ADMIN UI KIT
   ─────────────────────────────────────────────────────────────────────────────
   Shared design system for the entire admin panel, extracted from the
   "Manage Teachers" + "Manage Results" gold-standard pages.

   Design language (Green & Gold institutional):
   • Icon tiles: 40×40 rounded-xl, gradient from-primary to-primary/80
   • Cards:     rounded-2xl border-border/60 bg-card shadow-sm
   • Buttons:   THIN PILLS — h-9 rounded-full px-3 text-xs font-semibold
                shadow-none whitespace-nowrap min-w-0 (never cut off)
   • Tabs:      rounded-full pill triggers, bg-muted/50 track
   • Header:    soft blurred glow (absolute circle bg-primary/10 blur-2xl)
   • Mobile-first: toolbars collapse to grid-cols-2, tables become cards.
   ────────────────────────────────────────────────────────────────────────── */
import type { ReactNode, ElementType, InputHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ── Tone palette (matches icon tiles across the panel) ──────────────────── */
export type AdminTone =
  | "primary" | "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan" | "teal";

const TONE_TILE: Record<AdminTone, string> = {
  primary:  "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20",
  blue:     "bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-md shadow-blue-600/20",
  emerald:  "bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-600/20",
  violet:   "bg-gradient-to-br from-violet-600 to-violet-500 text-white shadow-md shadow-violet-600/20",
  amber:    "bg-gradient-to-br from-amber-500 to-amber-400 text-amber-950 shadow-md shadow-amber-500/25",
  rose:     "bg-gradient-to-br from-rose-600 to-rose-500 text-white shadow-md shadow-rose-600/20",
  cyan:     "bg-gradient-to-br from-cyan-600 to-cyan-500 text-white shadow-md shadow-cyan-600/20",
  teal:     "bg-gradient-to-br from-teal-600 to-teal-500 text-white shadow-md shadow-teal-600/20",
};

/* ── Premium page header ─────────────────────────────────────────────────────
   Usage:
     <AdminPageHeader icon={CalendarDays} title="Timetables" subtitle="…">
       <ThinBtn …/> <ThinBtn …/>
     </AdminPageHeader>

   • tone picks the gradient of the icon tile.
   • back = optional back-action (renders a thin round outline button first).
   • toolbar children are laid out grid-cols-2 on phones, sm:flex wrap after. */
export function AdminPageHeader({
  icon: Icon, title, subtitle, tone = "primary", toolbar, back, onBack, backLabel,
  compact, className,
}: {
  icon: ElementType;
  title: string;
  subtitle?: ReactNode;
  tone?: AdminTone;
  toolbar?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  backLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm",
      compact ? "p-3" : "p-3.5 sm:p-4",
      className,
    )}>
      {/* soft glow decoration */}
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(var(--gold,43_89%_38%))]/10 blur-2xl" />

      <div className="relative flex items-center gap-3">
        {back && onBack && (
          <Button variant="outline" size="icon" aria-label={backLabel || "Back"} onClick={onBack}
            className="h-9 w-9 shrink-0 rounded-full shadow-none">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
          </Button>
        )}
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONE_TILE[tone])}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">{title}</h2>
          {subtitle != null && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground sm:text-sm">{subtitle}</p>
          )}
        </div>
        {/* right-side inline action (e.g. Add button) */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">{toolbar}</div>
      </div>

      {/* Mobile toolbar: wraps under the title; desktop: hidden if inline shown */}
      {toolbar && (
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:hidden">{toolbar}</div>
      )}
    </div>
  );
}

/* ── Thin pill buttons — THE signature admin button ──────────────────────────
   h-9 rounded-full, no shadow, semibold xs text, icons shrink to fit.
   Variants keep the heritage palette: primary (deep green), outline,
   danger (destructive), success (emerald), blue, gold. */
type ThinBtnVariant = "primary" | "outline" | "danger" | "success" | "blue" | "gold" | "ghost";

const THIN_VARIANTS: Record<ThinBtnVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-input bg-card text-foreground hover:bg-secondary",
  danger:  "border border-destructive/40 bg-card text-destructive hover:bg-destructive/10",
  success: "border border-emerald-300 bg-card text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
  blue:    "border border-blue-300 bg-card text-blue-700 dark:border-blue-500/40 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30",
  gold:    "border border-[hsl(43_60%_60%)] bg-card text-[hsl(35_80%_35%)] hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-950/30",
  ghost:   "text-foreground hover:bg-secondary",
};

export function ThinBtn({
  variant = "outline", icon: Icon, children, className, ...props
}: {
  variant?: ThinBtnVariant;
  icon?: ElementType;
  children?: ReactNode;
} & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none transition-colors",
        "[&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0",
        THIN_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {Icon && <Icon />}
      {children}
    </Button>
  );
}

/* Compact icon-only thin button (row actions in tables/cards) */
export function ThinIconBtn({
  icon: Icon, label, tone = "muted", className, ...props
}: {
  icon: ElementType;
  label: string;
  tone?: "muted" | "primary" | "danger" | "success";
  className?: string;
} & React.ComponentProps<typeof Button>) {
  const tones = {
    muted:   "text-muted-foreground hover:text-foreground hover:bg-secondary",
    primary: "text-muted-foreground hover:text-primary hover:bg-primary/10",
    danger:  "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
    success: "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30",
  } as const;
  return (
    <Button
      variant="ghost" size="icon" aria-label={label} title={label}
      className={cn("h-8 w-8 rounded-full shadow-none", tones[tone], className)}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

/* ── Rounded search input ─────────────────────────────────────────────────── */
export function AdminSearch({ className, icon: Icon = Search, ...props }: {
  icon?: ElementType;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative w-full", className)}>
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" {...props} />
    </div>
  );
}

/* ── Stat tile — the Results-style KPI card ───────────────────────────────── */
export function StatTile({
  label, value, color = "text-primary", dot = "bg-primary", icon: Icon, className,
}: {
  label: string; value: ReactNode; color?: string; dot?: string; icon?: ElementType; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm", className)}>
      <div className="flex items-center gap-2">
        <p className={cn("text-xl font-bold leading-none tabular-nums sm:text-2xl", color)}>{value}</p>
        {Icon && <Icon className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/50" />}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />{label}
      </p>
    </div>
  );
}

/* ── Section card — the standard content container ─────────────────────────── */
export function SectionCard({
  title, icon: Icon, action, children, className, bodyClassName, noPad,
}: {
  title?: ReactNode; icon?: ElementType; action?: ReactNode; children: ReactNode;
  className?: string; bodyClassName?: string; noPad?: boolean;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card shadow-sm", className)}>
      {(title || action) && (
        <div className="flex items-center gap-2.5 border-b border-border/60 px-3.5 py-3 sm:px-4">
          {Icon && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold leading-tight text-foreground">{title}</h3>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </div>
      )}
      <div className={cn(!noPad && "p-3.5 sm:p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

/* ── Pill — status chips ──────────────────────────────────────────────────── */
export function Pill({
  children, tone = "muted", dot, className,
}: {
  children: ReactNode;
  tone?: "muted" | "success" | "danger" | "warning" | "info" | "primary" | "gold";
  dot?: boolean;
  className?: string;
}) {
  const tones = {
    muted:   "bg-muted text-muted-foreground border-border",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
    danger:  "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",
    warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
    info:    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",
    primary: "bg-primary/10 text-primary border-primary/20",
    gold:    "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-700",
  } as const;
  const dots = {
    muted: "bg-muted-foreground/50", success: "bg-emerald-500", danger: "bg-red-500",
    warning: "bg-amber-500", info: "bg-blue-500", primary: "bg-primary", gold: "bg-amber-400",
  } as const;
  return (
    <span className={cn(
      "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4",
      tones[tone], className,
    )}>
      {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dots[tone])} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
export function EmptyState({
  icon: Icon, title, hint, action, className,
}: {
  icon: ElementType; title: string; hint?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-border bg-card/50 px-5 py-10 text-center", className)}>
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60">
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-snug text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ── Pill tabs — Class 6-10 style selector ─────────────────────────────────── */
export function PillTabs<T extends string>({
  value, onChange, options, className, scrollable = true,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
  scrollable?: boolean;
}) {
  const track = (
    <div className="inline-flex h-10 min-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:min-w-0">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all",
            value === o.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!scrollable) return <div className={cn("flex", className)}>{track}</div>;
  return (
    <div className={cn("-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {track}
    </div>
  );
}

/* ── Toolbar — grid of thin buttons under a header ─────────────────────────── */
export function AdminToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap", className)}>
      {children}
    </div>
  );
}

export { TONE_TILE };
