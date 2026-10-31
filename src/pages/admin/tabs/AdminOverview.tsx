import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, GraduationCap, Bell, BookOpen, Image as ImageIcon,
  UserCog, ClipboardList, Calendar, CheckCircle, AlertCircle, Activity,
  ArrowUpRight, FileText, BookMarked, MapPin, Landmark, Phone, Mail, Hash,
  Settings, RefreshCw, CalendarDays, Wallet, Trophy, Sparkles,
} from "lucide-react";

/* ─── Data hooks ─────────────────────────────────────────────────
   NOTE: students are intentionally NOT counted or shown on this page. */
const useAdminStats = () =>
  useQuery({
    queryKey: ["admin-stats-v3"],
    queryFn: async () => {
      const head = { count: "exact" as const, head: true };
      const [
        teachers, notices, library, albums, users, results,
        pendingUsers, admissions, pendingAdmissions,
      ] = await Promise.all([
        supabase.from("teachers").select("id", head),
        supabase.from("notices").select("id", head),
        supabase.from("library_files").select("id", head),
        supabase.from("gallery_albums").select("id", head),
        supabase.from("profiles").select("id", head),
        supabase.from("results").select("id", head),
        supabase.from("profiles").select("id", head).eq("status", "pending"),
        supabase.from("admissions").select("id", head),
        supabase.from("admissions").select("id", head).eq("status", "pending"),
      ]);
      return {
        teachers: teachers.count ?? 0,
        notices: notices.count ?? 0,
        library: library.count ?? 0,
        albums: albums.count ?? 0,
        users: users.count ?? 0,
        results: results.count ?? 0,
        pendingUsers: pendingUsers.count ?? 0,
        admissions: admissions.count ?? 0,
        pendingAdmissions: pendingAdmissions.count ?? 0,
      };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

const useRecentActivity = () =>
  useQuery({
    queryKey: ["admin-recent-activity"],
    queryFn: async () => {
      const [notices, admissions, users] = await Promise.all([
        supabase.from("notices").select("id, title, created_at").order("created_at", { ascending: false }).limit(3),
        supabase.from("admissions").select("id, full_name, created_at, status").order("created_at", { ascending: false }).limit(3),
        supabase.from("profiles").select("id, full_name, created_at, status").order("created_at", { ascending: false }).limit(3),
      ]);
      type ActivityItem = { id: string; label: string; time: string; type: string; status?: string };
      const items: ActivityItem[] = [
        ...(notices.data ?? []).map((x: any) => ({ id: x.id, label: x.title || "Untitled notice", time: x.created_at, type: "notice" })),
        ...(admissions.data ?? []).map((a: any) => ({ id: a.id, label: a.full_name || "Unknown applicant", time: a.created_at, type: "admission", status: a.status })),
        ...(users.data ?? []).map((u: any) => ({ id: u.id, label: u.full_name || "Unknown user", time: u.created_at, type: "user", status: u.status })),
      ];
      return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);
    },
    staleTime: 60_000,
  });

/* ─── Helpers ────────────────────────────────────────────────── */
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const n = (v: number | undefined | null) => (v ?? 0).toLocaleString("en-US");

/* ─── Tone system (plain gradients only — no blur, Android-GPU safe) ─ */
interface Tone { chip: string; fg: string; ring: string; hsl: string }

const TONES: Record<string, Tone> = {
  emerald: { chip: "bg-emerald-50 dark:bg-emerald-500/15", fg: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-600/10 dark:ring-emerald-400/25", hsl: "160 72% 40%" },
  violet:  { chip: "bg-violet-50 dark:bg-violet-500/15",   fg: "text-violet-600 dark:text-violet-400",   ring: "ring-violet-600/10 dark:ring-violet-400/25",   hsl: "258 85% 62%" },
  gold:    { chip: "bg-amber-50 dark:bg-amber-500/15",     fg: "text-amber-600 dark:text-amber-400",     ring: "ring-amber-600/10 dark:ring-amber-400/25",     hsl: "40 90% 48%" },
  rose:    { chip: "bg-rose-50 dark:bg-rose-500/15",       fg: "text-rose-600 dark:text-rose-400",       ring: "ring-rose-600/10 dark:ring-rose-400/25",       hsl: "347 77% 50%" },
  amber:   { chip: "bg-orange-50 dark:bg-orange-500/15",   fg: "text-orange-600 dark:text-orange-400",   ring: "ring-orange-600/10 dark:ring-orange-400/25",   hsl: "24 92% 52%" },
  teal:    { chip: "bg-teal-50 dark:bg-teal-500/15",       fg: "text-teal-600 dark:text-teal-400",       ring: "ring-teal-600/10 dark:ring-teal-400/25",       hsl: "173 80% 38%" },
  cyan:    { chip: "bg-cyan-50 dark:bg-cyan-500/15",       fg: "text-cyan-600 dark:text-cyan-400",       ring: "ring-cyan-600/10 dark:ring-cyan-400/25",       hsl: "188 86% 42%" },
  pink:    { chip: "bg-pink-50 dark:bg-pink-500/15",       fg: "text-pink-600 dark:text-pink-400",       ring: "ring-pink-600/10 dark:ring-pink-400/25",       hsl: "330 81% 58%" },
};

/* ─── KPI tile: one number, one tap target to its manager page ─── */
const KpiTile = ({
  to, label, value, icon: Icon, tone, isLoading,
}: {
  to: string; label: string; value: number | undefined;
  icon: React.ElementType; tone: Tone; isLoading: boolean;
}) => (
  <Link
    to={to}
    className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated active:translate-y-0"
  >
    <span
      aria-hidden="true"
      className="absolute inset-x-0 top-0 h-[3px]"
      style={{ background: `linear-gradient(90deg, hsl(${tone.hsl}), hsl(${tone.hsl} / 0.15))` }}
    />
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -right-10 -bottom-12 h-32 w-32 rounded-full opacity-70 transition-opacity duration-300 group-hover:opacity-100"
      style={{ background: `radial-gradient(circle, hsl(${tone.hsl} / 0.16), transparent 70%)` }}
    />
    <div className="relative flex items-start justify-between">
      <span className={`grid h-10 w-10 place-items-center rounded-xl ring-1 ring-inset ${tone.chip} ${tone.ring}`}>
        <Icon className={`h-[18px] w-[18px] ${tone.fg}`} aria-hidden="true" />
      </span>
      <ArrowUpRight
        className="h-4 w-4 text-muted-foreground/40 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden="true"
      />
    </div>
    <div className="relative mt-4">
      {isLoading ? (
        <Skeleton className="h-8 w-16 rounded-md" />
      ) : (
        <p className="text-[30px] font-extrabold leading-none tabular-nums tracking-tight text-foreground">{n(value)}</p>
      )}
      <p className="mt-2 text-[11px] font-semibold uppercase leading-tight tracking-[0.08em] text-muted-foreground">{label}</p>
    </div>
  </Link>
);

/* ─── Section header ─────────────────────────────────────────── */
const SectionHeader = ({
  icon: Icon, title, subtitle,
}: { icon: React.ElementType; title: string; subtitle?: string }) => (
  <div className="mb-3.5 flex items-center gap-2.5 sm:mb-4">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <h3 className="truncate text-[15px] font-bold leading-tight tracking-tight text-foreground">{title}</h3>
      {subtitle && <p className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</p>}
    </div>
    <span aria-hidden="true" className="ml-2 hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block" />
  </div>
);

/* ─── Pass-rate ring ─────────────────────────────────────────── */
const PassRateRing = ({ value }: { value: number }) => {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative h-[5.25rem] w-[5.25rem] shrink-0 sm:h-[6.25rem] sm:w-[6.25rem]">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="ghsPassRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(160,84%,50%)" />
            <stop offset="100%" stopColor="hsl(43,88%,66%)" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius} fill="none" stroke="url(#ghsPassRingGrad)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[19px] font-extrabold tabular-nums leading-none text-white sm:text-[22px]">{pct}%</span>
        <span className="mt-1 text-[8px] font-bold uppercase tracking-[0.2em] text-[hsl(43,80%,72%)]">Pass rate</span>
      </div>
    </div>
  );
};

/* ─── Activity meta ──────────────────────────────────────────── */
const ACTIVITY_META: Record<string, { Icon: React.ElementType; chip: string; kicker: string }> = {
  notice:    { Icon: Bell,          chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",       kicker: "Notice" },
  admission: { Icon: GraduationCap, chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400", kicker: "Admission" },
  user:      { Icon: UserCog,       chip: "bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400",   kicker: "User" },
};
const activityMeta = (type: string) => ACTIVITY_META[type] ?? ACTIVITY_META.user;

/* ─── Main component ─────────────────────────────────────────── */
const AdminOverview = () => {
  const { data: stats, isLoading, isFetching, refetch, dataUpdatedAt } = useAdminStats();
  const { data: activity, isLoading: actLoading } = useRecentActivity();
  const { data: settings } = useSchoolSettings();
  const { profile } = useAuth();

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const firstName = profile?.full_name?.split(" ")[0] || "Admin";

  const urgentCount = (stats?.pendingUsers ?? 0) + (stats?.pendingAdmissions ?? 0);

  /* Every figure appears exactly once on this page. */
  const schoolTiles = [
    { to: "/admin?tab=teachers",   label: "Teachers",         value: stats?.teachers,   icon: Users,         tone: TONES.emerald },
    { to: "/admin?tab=results",    label: "Results",          value: stats?.results,    icon: ClipboardList, tone: TONES.violet },
    { to: "/admin?tab=admissions", label: "Admissions",       value: stats?.admissions, icon: FileText,      tone: TONES.gold },
    { to: "/admin?tab=users",      label: "Registered Users", value: stats?.users,      icon: UserCog,       tone: TONES.rose },
  ];
  const contentTiles = [
    { to: "/admin?tab=announcements", label: "Notices",        value: stats?.notices, icon: Bell,       tone: TONES.amber },
    { to: "/admin?tab=library",       label: "Library Files",  value: stats?.library, icon: BookOpen,   tone: TONES.cyan },
    { to: "/admin?tab=videos",        label: "Gallery Albums", value: stats?.albums,  icon: ImageIcon,  tone: TONES.pink },
  ];

  /* Shortcuts only point at pages that have NO tile above. */
  const shortcuts = [
    { tab: "timetables",      label: "Timetables",  hint: "Classes & substitutes", icon: CalendarDays },
    { tab: "fees",            label: "Fees",        hint: "Collection & dues",     icon: Wallet },
    { tab: "exam-date-sheet", label: "Date Sheet",  hint: "Exam schedule",         icon: Calendar },
    { tab: "merit-list",      label: "Merit List",  hint: "Top performers",        icon: Trophy },
    { tab: "settings",        label: "Settings",    hint: "School profile",        icon: Settings },
  ];

  const identity = [
    { Icon: MapPin,   label: "Address",     value: settings?.address || "District Mohmand, KPK" },
    { Icon: Landmark, label: "Established", value: String(settings?.established_year || 2018) },
    { Icon: Hash,     label: "EMIS Code",   value: settings?.emis_code || "60673" },
    { Icon: Phone,    label: "Phone",       value: settings?.phone || null },
    { Icon: Mail,     label: "Email",       value: settings?.email || null },
  ].filter((row) => !!row.value);

  return (
    <div className="space-y-7 pb-4 sm:space-y-9">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative rounded-[28px] bg-[linear-gradient(135deg,hsla(43,80%,68%,0.8),hsla(160,40%,30%,0.3)_45%,hsla(43,75%,62%,0.5))] p-px shadow-[0_24px_54px_-26px_rgba(0,0,0,0.55)]">
        <div className="relative overflow-hidden rounded-[27px] bg-[linear-gradient(150deg,hsl(160_55%_9%)_0%,hsl(160_48%_14%)_52%,hsl(158_42%_21%)_100%)] p-5 text-white sm:p-7">
          {/* decoration: soft glows + concentric arcs + dot grid */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full" style={{ background: "radial-gradient(circle, hsla(43,80%,62%,0.22), transparent 64%)" }} />
            <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full" style={{ background: "radial-gradient(circle, hsla(160,70%,42%,0.28), transparent 64%)" }} />
            <svg className="absolute -right-10 -top-10 h-56 w-56 opacity-[0.12]" viewBox="0 0 200 200" fill="none" stroke="hsl(43,80%,70%)" strokeWidth="1">
              <circle cx="100" cy="100" r="30" /><circle cx="100" cy="100" r="55" /><circle cx="100" cy="100" r="80" /><circle cx="100" cy="100" r="105" />
            </svg>
            <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#fff 0.6px, transparent 0.6px)", backgroundSize: "16px 16px" }} />
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsla(43,80%,68%,0.35)] bg-[hsla(43,80%,62%,0.1)] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-[hsl(43,85%,72%)]">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {greeting}
                </span>
                <h2 className="mt-3 truncate font-heading text-[28px] font-bold leading-[1.1] tracking-tight text-white sm:text-[36px]">
                  {firstName}
                </h2>
                <p className="mt-1.5 truncate text-[12.5px] text-white/60">
                  {settings?.school_name || "GHS Babi Khel"} · Admin Panel
                </p>
              </div>
              <PassRateRing value={settings?.pass_percentage ?? 98} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-white/10 pt-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-[11.5px] font-medium text-white/75">
                <Calendar className="h-3.5 w-3.5 text-[hsl(43,80%,70%)]" aria-hidden="true" />
                {now.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${
                  urgentCount > 0 ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"
                }`}
              >
                {urgentCount > 0 ? (
                  <><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{urgentCount} need{urgentCount === 1 ? "s" : ""} attention</>
                ) : (
                  <><CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />All caught up</>
                )}
              </span>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                {isFetching ? "Syncing…" : dataUpdatedAt ? timeAgo(new Date(dataUpdatedAt).toISOString()) : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Needs attention ──────────────────────────────────── */}
      {!isLoading && urgentCount > 0 && (
        <section>
          <SectionHeader icon={AlertCircle} title="Needs Attention" subtitle="Waiting on an admin decision" />
          <div className="grid gap-2.5 sm:grid-cols-2 sm:gap-3">
            {(stats?.pendingUsers ?? 0) > 0 && (
              <Link
                to="/admin?tab=users"
                className="group flex items-center gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/70 p-3.5 transition-[box-shadow,border-color] duration-200 hover:border-rose-300 hover:shadow-elevated dark:border-rose-500/25 dark:bg-rose-500/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-300">
                  <UserCog className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight text-rose-700 dark:text-rose-300">
                    {n(stats?.pendingUsers)} User{(stats?.pendingUsers ?? 0) > 1 ? "s" : ""} awaiting approval
                  </p>
                  <p className="mt-0.5 text-xs text-rose-600/75 dark:text-rose-300/70">Open Users → Pending requests</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-rose-500 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
            {(stats?.pendingAdmissions ?? 0) > 0 && (
              <Link
                to="/admin?tab=admissions"
                className="group flex items-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 transition-[box-shadow,border-color] duration-200 hover:border-amber-300 hover:shadow-elevated dark:border-amber-500/25 dark:bg-amber-500/10"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600 ring-1 ring-inset ring-amber-500/20 dark:bg-amber-500/20 dark:text-amber-300">
                  <GraduationCap className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight text-amber-700 dark:text-amber-300">
                    {n(stats?.pendingAdmissions)} Admission{(stats?.pendingAdmissions ?? 0) > 1 ? "s" : ""} pending review
                  </p>
                  <p className="mt-0.5 text-xs text-amber-600/75 dark:text-amber-300/70">Open Admissions to review</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-500 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── School ───────────────────────────────────────────── */}
      <section>
        <SectionHeader icon={Activity} title="School" subtitle="People, results and applications" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {schoolTiles.map((t) => <KpiTile key={t.label} {...t} isLoading={isLoading} />)}
        </div>
      </section>

      {/* ── Content ──────────────────────────────────────────── */}
      <section>
        <SectionHeader icon={BookOpen} title="Content" subtitle="Everything published on the website" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {contentTiles.map((t) => <KpiTile key={t.label} {...t} isLoading={isLoading} />)}
        </div>
      </section>

      {/* ── Shortcuts ────────────────────────────────────────── */}
      <section>
        <SectionHeader icon={Sparkles} title="Shortcuts" subtitle="Jump straight to a tool" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {shortcuts.map((a) => (
            <Link
              key={a.tab}
              to={`/admin?tab=${a.tab}`}
              className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <a.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold leading-tight text-foreground">{a.label}</span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-muted-foreground">{a.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Recent activity ──────────────────────────────────── */}
      <section>
        <SectionHeader icon={Activity} title="Recent Activity" subtitle="Latest notices, admissions and sign-ups" />
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
          {actLoading ? (
            <div className="space-y-3 p-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3.5 w-3/4 rounded-md" />
                    <Skeleton className="h-3 w-1/4 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : !activity?.length ? (
            <div className="p-10 text-center">
              <span className="mx-auto mb-2.5 grid h-11 w-11 place-items-center rounded-full bg-secondary">
                <Activity className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold text-foreground">No recent activity yet</p>
              <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                New notices, admissions and sign-ups will appear here as they come in.
              </p>
            </div>
          ) : (
            <ul className="relative px-4 py-2 sm:px-5">
              <span aria-hidden="true" className="absolute bottom-6 left-[2.4rem] top-6 w-px bg-border sm:left-[2.65rem]" />
              {activity.map((item, i) => {
                const { Icon, chip, kicker } = activityMeta(item.type);
                return (
                  <li key={item.id + i} className="relative flex items-center gap-3 rounded-xl px-1.5 py-2.5 transition-colors hover:bg-secondary/50">
                    <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-card ${chip}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{kicker}</span>
                        {item.status && (
                          <span
                            className={`rounded-full px-1.5 py-[2px] text-[9px] font-bold uppercase leading-none tracking-wide ${
                              item.status === "pending"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                                : item.status === "approved"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {item.status}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{item.label}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{timeAgo(item.time)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ── School identity ──────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
        <div className="flex items-center gap-2.5 border-b border-border/70 bg-secondary/40 px-4 py-3 sm:px-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Landmark className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold leading-tight tracking-tight text-foreground">
              {settings?.school_name || "GHS Babi Khel"}
            </h3>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">Public school record</p>
          </div>
        </div>
        <dl className="grid gap-x-4 gap-y-3.5 p-4 sm:grid-cols-2 sm:p-5">
          {identity.map((row) => (
            <div key={row.label} className="flex min-w-0 items-start gap-2.5">
              <row.Icon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5 break-words text-[13px] font-medium leading-snug text-foreground">{row.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};

export default AdminOverview;
