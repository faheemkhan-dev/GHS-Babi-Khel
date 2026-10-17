// src/components/admin/SiteAnalytics.tsx
//
// Site Analytics — premium admin analytics dashboard.
// Layout: dark-green hero (total views + sparkline + quick insights),
// KPI tiles, traffic trend, device donut, hourly activity, ranked top
// pages / referrers, and a period-comparison strip. Mobile-first: every
// grid collapses to one or two columns and charts keep a fixed, thumb-
// friendly height. Error handling keeps the parent dashboard alive.

import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { useSiteAnalytics, type AnalyticsPeriod } from "@/hooks/useSiteAnalytics";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  Eye, Users, Monitor, Smartphone, Tablet, TrendingUp,
  ArrowUpRight, ArrowDownRight, Clock, Globe, RefreshCw, Minus,
  MousePointerClick, Layers, Activity, AlertCircle, Repeat2,
  CalendarDays, Zap, BarChart3,
} from "lucide-react";

// ─── Palette (brand tokens, so light + dark both stay on-theme) ─────────────
const GREEN = "hsl(var(--primary))";
const GOLD = "hsl(var(--gold))";

const DEVICE_COLORS: Record<string, string> = {
  desktop: "hsl(var(--primary))",
  mobile: "hsl(var(--gold))",
  tablet: "hsl(199, 70%, 48%)",
  unknown: "hsl(220, 9%, 52%)",
};
const REFERRER_COLORS = [GOLD, GREEN, "hsl(199, 70%, 48%)", "hsl(262, 60%, 58%)", "hsl(346, 70%, 55%)", "hsl(173, 65%, 40%)"];

const trendConfig: ChartConfig = {
  visits: { label: "Page Views", color: GREEN },
  uniqueVisitors: { label: "Unique Visitors", color: GOLD },
};
const hourlyConfig: ChartConfig = { visits: { label: "Visits", color: GREEN } };
const deviceConfig: ChartConfig = {
  desktop: { label: "Desktop", color: DEVICE_COLORS.desktop },
  mobile: { label: "Mobile", color: DEVICE_COLORS.mobile },
  tablet: { label: "Tablet", color: DEVICE_COLORS.tablet },
  unknown: { label: "Unknown", color: DEVICE_COLORS.unknown },
};

const periods: { value: AnalyticsPeriod; label: string }[] = [
  { value: 1, label: "Today" },
  { value: 7, label: "7D" },
  { value: 15, label: "15D" },
  { value: 30, label: "30D" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}
const compact = (n: number) =>
  n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString();

/** Smoothly counts to `value`; honours prefers-reduced-motion. */
function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(value); fromRef.current = value; return; }
    const from = fromRef.current;
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const out = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toLocaleString();
  return <>{out}{suffix}</>;
}

/** Tiny axis-less area chart used inside the hero and KPI tiles. */
function Sparkline({ data, dataKey, color, id, height = 44 }: { data: any[]; dataKey: string; color: string; id: string; height?: number }) {
  if (!data || data.length < 2) return <div style={{ height }} />;
  return (
    <div style={{ height }} className="w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Change pill. `onDark` swaps to translucent colours for the hero. */
const Delta = ({ value, invert = false, onDark = false }: { value: number; invert?: boolean; onDark?: boolean }) => {
  const good = invert ? value < 0 : value > 0;
  if (value === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${onDark ? "bg-white/15 text-white/80" : "border border-border bg-muted text-muted-foreground"}`}>
        <Minus className="w-3 h-3" />0%
      </span>
    );
  }
  const tone = onDark
    ? good ? "bg-emerald-400/20 text-emerald-200" : "bg-red-400/25 text-red-200"
    : good
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
      : "border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${tone}`}>
      {value > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(value)}%
    </span>
  );
};

/** Shared card shell with a gold hairline on top. */
const Panel = ({ title, icon: Icon, hint, children, className = "" }: {
  title: string; icon: React.ElementType; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) => (
  <section className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-sm ${className}`}>
    <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" aria-hidden="true" />
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" />
        </span>
        <h3 className="font-heading font-bold text-[15px] text-foreground truncate">{title}</h3>
      </div>
      {hint && <div className="shrink-0 text-[11px] font-semibold text-muted-foreground bg-secondary/80 rounded-full px-2.5 py-1">{hint}</div>}
    </header>
    {children}
  </section>
);

const rise = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.4, ease: "easeOut" as const } }),
};

// ─── Main component ─────────────────────────────────────────────────────────
const SiteAnalytics = () => {
  const [period, setPeriod] = useState<AnalyticsPeriod>(7);
  const { data, isLoading, error, refetch, isFetching } = useSiteAnalytics(period);

  if (error) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h4 className="font-heading font-bold text-foreground mb-1">Unable to load analytics</h4>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
          The site_visits table might not exist yet or access is denied. Make sure the SQL migration has been run in Supabase.
        </p>
        <p className="text-[10px] text-muted-foreground/70 font-mono break-all mb-5">{error?.message || "Unknown error"}</p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex h-9 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Retry
        </button>
      </div>
    );
  }

  const s = data?.summary;
  const cmp = data?.comparison;
  const trend = data?.dailyTrend ?? [];
  const devices = data?.deviceBreakdown ?? [];
  const deviceTotal = devices.reduce((n, d) => n + d.count, 0);
  const peakHour = s?.peakHour ?? null;
  const periodLabel = period === 1 ? "today" : `last ${period} days`;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ══ HERO ══ */}
      <m.section
        custom={0} variants={rise} initial="hidden" animate="show"
        className="relative overflow-hidden rounded-2xl gradient-hero text-white p-5 sm:p-7 shadow-elevated"
      >
        <div className="orb orb-gold w-64 h-64 -top-24 -right-16 opacity-80" aria-hidden="true" />
        <div className="absolute inset-0 dot-grid opacity-[0.08]" aria-hidden="true" />
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" aria-hidden="true" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-300 animate-ping opacity-70" />
                <span className="relative w-2 h-2 rounded-full bg-emerald-300" />
              </span>
              Live traffic · {periodLabel}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh analytics"
            className="shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Period segmented control — full width on phones */}
        <div className="relative mt-4 grid grid-cols-4 gap-1 rounded-full bg-black/25 border border-white/10 p-1" role="tablist" aria-label="Time period">
          {periods.map((p) => (
            <button
              key={p.value}
              role="tab"
              aria-selected={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={`h-9 rounded-full text-xs font-bold transition-all ${
                period === p.value
                  ? "bg-gradient-to-r from-gold to-gold-strong text-white shadow-md"
                  : "text-white/70 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Headline number + sparkline */}
        <div className="relative mt-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/70">Total page views</p>
            {isLoading ? (
              <Skeleton className="mt-2 h-11 w-36 bg-white/15" />
            ) : (
              <p className="mt-1 font-heading font-extrabold text-[2.6rem] sm:text-5xl leading-none tabular-nums">
                <CountUp value={s?.totalVisits ?? 0} />
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              {cmp && <Delta value={cmp.visitsChange} onDark />}
              <span className="text-[11px] text-white/60">vs previous {period === 1 ? "day" : `${period} days`}</span>
            </div>
          </div>
          <div className="w-[42%] max-w-[220px] shrink-0">
            {!isLoading && <Sparkline data={trend} dataKey="visits" color="hsl(var(--gold))" id="heroSpark" height={64} />}
          </div>
        </div>

        {/* Quick insights */}
        <div className="relative mt-5 grid grid-cols-3 divide-x divide-white/15 rounded-2xl bg-black/20 border border-white/10">
          {[
            { icon: Zap, label: "Avg / day", value: isLoading ? "—" : compact(s?.avgDailyVisits ?? 0) },
            { icon: CalendarDays, label: "Peak day", value: isLoading || !s?.peakDay ? "—" : formatShortDate(s.peakDay.date) },
            { icon: Clock, label: "Peak hour", value: isLoading || peakHour === null ? "—" : formatHour(peakHour) },
          ].map((it) => (
            <div key={it.label} className="px-2 py-3 text-center min-w-0">
              <it.icon className="w-3.5 h-3.5 mx-auto text-gold mb-1" />
              <p className="text-sm font-bold tabular-nums truncate">{it.value}</p>
              <p className="text-[10px] text-white/60">{it.label}</p>
            </div>
          ))}
        </div>
      </m.section>

      {/* ══ KPI TILES ══ */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Unique visitors", icon: Users, tint: "bg-primary/10 text-primary", value: s?.uniqueVisitors ?? 0, change: cmp?.uniqueChange, spark: "uniqueVisitors", sub: `${(s?.returningVisitors ?? 0).toLocaleString()} returning` },
          { label: "Bounce rate", icon: Activity, tint: "bg-amber-500/12 text-amber-600 dark:text-amber-400", value: s?.bounceRate ?? 0, suffix: "%", change: cmp?.bounceChange, invert: true, sub: "lower is better" },
          { label: "Pages / session", icon: Layers, tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400", value: s?.avgPagesPerSession ?? 0, decimals: 1, sub: `${(s?.uniqueUsers ?? 0).toLocaleString()} signed-in users` },
          { label: "Returning", icon: Repeat2, tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400", value: s?.returningVisitors ?? 0, sub: "multi-page sessions" },
        ].map((k, i) => (
          <m.div
            key={k.label} custom={i + 1} variants={rise} initial="hidden" animate="show"
            className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 sm:p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${k.tint}`}><k.icon className="w-4 h-4" /></span>
              {k.change !== undefined && <Delta value={k.change} invert={k.invert} />}
            </div>
            {isLoading ? (
              <Skeleton className="mt-3 h-7 w-20" />
            ) : (
              <p className="mt-3 font-heading font-extrabold text-2xl text-foreground tabular-nums leading-none">
                <CountUp value={k.value as number} decimals={k.decimals ?? 0} suffix={k.suffix ?? ""} />
              </p>
            )}
            <p className="mt-1.5 text-xs font-semibold text-foreground/80">{k.label}</p>
            <p className="text-[10.5px] text-muted-foreground">{k.sub}</p>
          </m.div>
        ))}
      </div>

      {/* ══ TRAFFIC TREND ══ */}
      <Panel
        title="Traffic trend" icon={TrendingUp}
        hint={s?.peakDay ? `Peak ${formatShortDate(s.peakDay.date)} · ${s.peakDay.visits.toLocaleString()}` : undefined}
      >
        {isLoading ? (
          <Skeleton className="h-[220px] w-full rounded-2xl" />
        ) : trend.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-12">No traffic recorded for this period yet</p>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-2 text-[11px] font-semibold text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: GREEN }} />Page views</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: GOLD }} />Unique visitors</span>
            </div>
            <ChartContainer config={trendConfig} className="h-[220px] w-full">
              <AreaChart data={trend} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillVisits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-visits)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-visits)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillUnique" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-uniqueVisitors)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-uniqueVisitors)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 6" vertical={false} className="stroke-border" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} className="text-[10px]"
                  interval={period > 7 ? Math.floor((period - 1) / 5) : 0} />
                <YAxis tickLine={false} axisLine={false} tickMargin={6} className="text-[10px]" allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <Area type="monotone" dataKey="visits" stroke="var(--color-visits)" strokeWidth={2.5} fill="url(#fillVisits)"
                  dot={period <= 7 ? { r: 3, strokeWidth: 2 } : false} activeDot={{ r: 5, strokeWidth: 2 }} />
                <Area type="monotone" dataKey="uniqueVisitors" stroke="var(--color-uniqueVisitors)" strokeWidth={2.5} fill="url(#fillUnique)"
                  dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
              </AreaChart>
            </ChartContainer>
          </>
        )}
      </Panel>

      {/* ══ DEVICES + HOURLY ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Panel title="Devices" icon={Monitor} hint={deviceTotal ? `${deviceTotal.toLocaleString()} visits` : undefined}>
          {isLoading ? (
            <div className="flex justify-center"><Skeleton className="h-[170px] w-[170px] rounded-full" /></div>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">No device data yet</p>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="relative w-[170px] h-[170px] shrink-0">
                <ChartContainer config={deviceConfig} className="w-full h-full">
                  <PieChart>
                    <Pie data={devices} cx="50%" cy="50%" innerRadius={54} outerRadius={78} paddingAngle={3} cornerRadius={6}
                      dataKey="count" nameKey="device" stroke="transparent">
                      {devices.map((d, i) => <Cell key={d.device} fill={DEVICE_COLORS[d.device] || REFERRER_COLORS[i % REFERRER_COLORS.length]} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="device" hideLabel />} />
                  </PieChart>
                </ChartContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-heading font-extrabold text-xl text-foreground tabular-nums leading-none">{compact(deviceTotal)}</span>
                  <span className="text-[10px] text-muted-foreground mt-1">total</span>
                </div>
              </div>
              <ul className="flex-1 w-full space-y-3">
                {devices.map((d, i) => {
                  const Icon = ({ desktop: Monitor, mobile: Smartphone, tablet: Tablet } as Record<string, React.ElementType>)[d.device] || Globe;
                  const color = DEVICE_COLORS[d.device] || REFERRER_COLORS[i % REFERRER_COLORS.length];
                  return (
                    <li key={d.device} className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground capitalize">{d.device}</span>
                          <span className="text-xs font-bold text-foreground tabular-nums">{d.percentage}%</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${d.percentage}%`, background: color }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Hourly activity" icon={Clock} hint={peakHour !== null ? `Peak ${formatHour(peakHour)}` : undefined}>
          {isLoading ? (
            <Skeleton className="h-[190px] w-full rounded-2xl" />
          ) : (
            <ChartContainer config={hourlyConfig} className="h-[190px] w-full">
              <BarChart data={data?.hourlyDistribution ?? []} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 6" vertical={false} className="stroke-border" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} className="text-[9px]" interval={3} />
                <YAxis tickLine={false} axisLine={false} tickMargin={4} className="text-[10px]" allowDecimals={false} />
                <ChartTooltip cursor={{ fill: "hsl(var(--secondary))", opacity: 0.5 }} content={<ChartTooltipContent indicator="dot" />} />
                <Bar dataKey="visits" radius={[6, 6, 2, 2]} maxBarSize={14}>
                  {(data?.hourlyDistribution ?? []).map((h) => (
                    <Cell key={h.hour} fill={h.hour === peakHour ? GOLD : GREEN} fillOpacity={h.hour === peakHour ? 1 : 0.45} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {/* ══ TOP PAGES + REFERRERS ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        <Panel title="Top pages" icon={MousePointerClick}>
          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : !data?.topPages.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">No page data yet</p>
          ) : (
            <ol className="space-y-3.5">
              {data.topPages.map((p, i) => {
                const max = data.topPages[0]?.visits || 1;
                return (
                  <li key={p.page + i} className="flex items-center gap-3">
                    <span className={`w-7 h-7 shrink-0 rounded-full text-[11px] font-extrabold flex items-center justify-center ${
                      i < 3 ? "bg-gradient-to-br from-gold to-gold-strong text-white" : "bg-secondary text-muted-foreground"
                    }`}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground truncate">{p.page}</span>
                        <span className="text-[13px] font-bold text-foreground tabular-nums">{p.visits.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-all duration-700" style={{ width: `${Math.round((p.visits / max) * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{p.uniqueVisitors} unique</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel title="Top referrers" icon={Globe}>
          {isLoading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : !data?.topReferrers.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">No referrer data yet</p>
          ) : (
            <ol className="space-y-3.5">
              {data.topReferrers.map((r, i) => {
                const max = data.topReferrers[0]?.visits || 1;
                const color = REFERRER_COLORS[i % REFERRER_COLORS.length];
                return (
                  <li key={r.referrer + i} className="flex items-center gap-3">
                    <span className="w-7 h-7 shrink-0 rounded-full text-[11px] font-extrabold flex items-center justify-center text-white" style={{ background: color }}>{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground truncate">{r.referrer}</span>
                        <span className="text-[13px] font-bold text-foreground tabular-nums">{r.visits.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.round((r.visits / max) * 100)}%`, background: color }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>

      {/* ══ PERIOD COMPARISON ══ */}
      <Panel title="Period comparison" icon={BarChart3} hint={`vs previous ${period === 1 ? "day" : `${period} days`}`}>
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {[
              { label: "Page views", icon: Eye, v: cmp?.visitsChange ?? 0 },
              { label: "Visitors", icon: Users, v: cmp?.uniqueChange ?? 0 },
              { label: "Bounce", icon: Activity, v: cmp?.bounceChange ?? 0, invert: true },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl bg-secondary/60 border border-border/60 px-2 py-3.5 text-center">
                <c.icon className="w-4 h-4 mx-auto text-muted-foreground mb-2" />
                <Delta value={c.v} invert={c.invert} />
                <p className="mt-2 text-[11px] font-semibold text-foreground/80">{c.label}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};

export default SiteAnalytics;
