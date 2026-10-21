import { memo, useState, useMemo, useEffect, useDeferredValue } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAfter, format } from "date-fns";
import {
  Trophy, Crown, Search, Users, Target, TrendingUp, CheckCircle2,
  School, BookOpen, ArrowRight, ShieldCheck, Share2, Loader2, ChevronDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cachedOrDirect } from "@/lib/publicData";
import { examTypeLabel } from "@/utils/examTypeLabel";
import { shareTop3Card, toastShareOutcome, type Top3ShareEntry } from "@/utils/shareResultCard";
import { Skeleton } from "@/components/ui/skeleton";
import PageLayout from "@/components/layout/PageLayout";
import { optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";
import toast from "react-hot-toast";

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC MERIT LIST PAGE  (/merit-list)

   Data source: admin-managed `merit_lists` table (snapshot v2/v3).
     • is_published + publish_at in the past   → LIVE
     • is_published + publish_at in the future → COMING SOON (countdown)

   SLOW-INTERNET / SPEED DESIGN
   • The list-picker query is LIGHT (no `entries` blob). The heavy ranked
     entries are fetched only for the ONE list being viewed.
   • Only the first 25 rows are rendered; "Show more" reveals the rest.
     Off-screen rows use content-visibility so scrolling stays smooth.
   • A single responsive row markup (no duplicated mobile + desktop DOM).
   • Rows are memoised; the 1-second countdown ticker lives ONLY inside the
     countdown panel, so the table never re-renders every second.
   • Avatars are tiny (80px) Cloudinary thumbnails, lazy + async decoded.
   • No backdrop-filter, no infinite CSS animations, no hover scaling.
   • Cached by react-query + IndexedDB (queryPersist) → instant on repeat.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Types ───────────────────────────────────────────────────────────────────
interface MeritStudentEntry {
  student_id: string; full_name: string; roll_number: string;
  class: string; exam_type?: string; photo_url: string | null;
  obtained_marks: number; total_marks: number; percentage: number;
  grade: string; position: number;
  /** Anonymous reserved row — a student the school withheld. No personal data. */
  hidden?: boolean;
}

interface PublishedMeritList {
  id: string;
  scope: string;            // 'class' | 'school' | 'school-bise'
  class: string;
  exam_type: string | null;
  year: number;
  is_published: boolean;
  publish_at: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  total_students?: number;
  passing_count?: number;
  highest_percentage?: number;
  average_percentage?: number;
  theme?: string | null;
}

const ML_THEME_PRESETS: Record<string, { from: string; to: string }> = {
  gold:    { from: "from-amber-600",  to: "to-amber-700"  },
  royal:   { from: "from-blue-600",   to: "to-indigo-700" },
  emerald: { from: "from-teal-600",   to: "to-teal-800"   },
  rose:    { from: "from-rose-500",   to: "to-pink-700"   },
  violet:  { from: "from-violet-500", to: "to-purple-700" },
};
const getMlTheme = (id?: string | null) => ML_THEME_PRESETS[id || "gold"] || ML_THEME_PRESETS.gold;

// ─── Data hooks ──────────────────────────────────────────────────────────────
function usePublishedMeritLists() {
  return useQuery<PublishedMeritList[]>({
    queryKey: ["published-merit-lists"],
    queryFn: async () =>
      // Phase 5: cached public read (CDN s-maxage 30 s) — one DB read per
      // half-minute for every merit-list visitor, with the exact old direct
      // query (light columns, no entries blob) as the automatic fallback.
      cachedOrDirect<PublishedMeritList[]>("merit-lists", {}, async () => {
        // LIGHT query — no `entries` blob (can be 100s of KB on slow networks).
        const { data, error } = await supabase
          .from("merit_lists")
          .select(`
          id, scope, class, exam_type, year, is_published, publish_at,
          title, notes, created_at,
          total_students, passing_count,
          highest_percentage, average_percentage, theme
        `)
          .eq("is_published", true)
          .order("created_at", { ascending: false });
        if (error) {
          console.warn("[MeritListPage] fetch error:", error.message);
          return [];
        }
        return (data ?? []) as PublishedMeritList[];
      }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Always refetch on mount: a just-published (or re-published) list must
    // never be answered from the restored offline copy.
    refetchOnMount: "always",
  });
}

function useMeritListData(ml: PublishedMeritList | null) {
  return useQuery<MeritStudentEntry[]>({
    queryKey: ["merit-list-data", ml?.id],
    queryFn: async () => {
      if (!ml) return [];
      // Path 1: snapshot — fetch ONLY this list's entries.
      // Phase 5: the entries blob is fetched through the edge cache
      // (s-maxage 120 s) — it is immutable once published and the largest
      // response on this page, so every visitor after the first shares it.
      const row = await cachedOrDirect<{ entries?: any[] | null } | null>(
        "merit-entries",
        { id: ml.id },
        async () => {
          const { data: row } = await supabase
            .from("merit_lists")
            .select("entries")
            .eq("id", ml.id)
            .maybeSingle();
          return (row as { entries?: any[] | null } | null) ?? null;
        },
      );
      const raw = row?.entries;
      if (Array.isArray(raw) && raw.length > 0) {
        const sorted = [...raw].sort((a, b) => {
          const pa = Number(a.position) || 0;
          const pb = Number(b.position) || 0;
          if (pa > 0 && pb > 0) return pa - pb;
          return (Number(b.percentage) || 0) - (Number(a.percentage) || 0);
        });
        return sorted.map((e: any, i: number) => ({
          student_id: e.student_id,
          full_name: e.full_name || "Unknown",
          roll_number: e.roll_number || "-",
          class: e.class,
          exam_type: e.exam_type,
          photo_url: e.photo_url || null,
          obtained_marks: Number(e.obtained_marks) || 0,
          total_marks: Number(e.total_marks) || 0,
          percentage: Number(e.percentage) || 0,
          grade: e.grade || "—",
          position: Number(e.position) || i + 1,
          hidden: Boolean(e.hidden),
        }));
      }
      // Path 2: legacy fallback (live results query for pre-snapshot rows)
      let q = supabase
        .from("results")
        .select("student_id,obtained_marks,total_marks,percentage,grade,position,class,exam_type,is_published,students(full_name,roll_number,photo_url)")
        .eq("year", ml.year)
        .eq("is_published", true)
        .order("percentage", { ascending: false });
      if (ml.scope === "class") {
        q = q.eq("class", ml.class);
        if (ml.exam_type) q = q.eq("exam_type", ml.exam_type);
      }
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      const best = new Map<string, any>();
      for (const r of (data ?? [])) {
        const key = r.student_id + "_" + r.class;
        if (!best.has(key) || r.percentage > best.get(key).percentage) best.set(key, r);
      }
      return Array.from(best.values())
        .sort((a, b) => b.percentage - a.percentage)
        .map((r: any, i: number) => ({
          student_id: r.student_id,
          full_name: r.students?.full_name || "Unknown",
          roll_number: r.students?.roll_number || "-",
          class: r.class,
          exam_type: r.exam_type,
          photo_url: r.students?.photo_url || null,
          obtained_marks: r.obtained_marks,
          total_marks: r.total_marks,
          percentage: Number(r.percentage) || 0,
          grade: r.grade || "—",
          position: i + 1,
        }));
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    enabled: !!ml,
  });
}

function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const isMultiClassScope = (scope: string) => scope === "school" || scope === "school-bise";

const listTitle = (ml: PublishedMeritList) =>
  ml.title || (
    ml.scope === "school" ? `School Merit List ${ml.year}`
    : ml.scope === "school-bise" ? `BISE Merit List ${ml.year}`
    : `Class ${ml.class} Merit List ${ml.year}`
  );

const listMeta = (ml: PublishedMeritList) =>
  `${ml.scope === "school" ? "School" : ml.scope === "school-bise" ? "BISE (Class 9th & 10th)" : `Class ${ml.class}`}` +
  `${ml.exam_type ? ` · ${examTypeLabel(ml.exam_type)}` : ""} · Year ${ml.year}`;

// ─── Avatar: tiny optimised thumbnail, graceful fallback ────────────────────
const MeritAvatar = memo(function MeritAvatar({ photoUrl, fullName, size = "w-8 h-8" }: { photoUrl: string | null; fullName: string; size?: string }) {
  const [imgError, setImgError] = useState(false);
  const src = photoUrl ? optimizedCloudinaryUrl(photoUrl, { width: 80 }) : null;
  return src && !imgError ? (
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      className={`${size} rounded-full object-cover shrink-0 ring-1 ring-border bg-muted`}
      onError={() => setImgError(true)}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center text-primary-foreground text-[11px] font-bold shrink-0 ring-1 ring-border`}>
      {(fullName || "?")[0]}
    </div>
  );
});

// ─── Compact clock (static face + live hands) ───────────────────────────────
function MiniClock({ className = "w-10 h-10", hours = 0, minutes = 0, seconds = 0 }: { className?: string; hours?: number; minutes?: number; seconds?: number }) {
  const hand = (deg: number, len: number) => {
    const r = (deg * Math.PI) / 180;
    return { x2: 32 + Math.sin(r) * len, y2: 32 - Math.cos(r) * len };
  };
  const h = hand((hours % 12) * 30 + (minutes % 60) * 0.5, 11);
  const m = hand((minutes % 60) * 6 + (seconds % 60) * 0.1, 16);
  const s = hand((seconds % 60) * 6, 18);
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden>
      <circle cx="32" cy="32" r="29" fill="#FFFDF5" stroke="#C6912A" strokeWidth="3" />
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return <line key={i} x1={32 + Math.sin(a) * 24} y1={32 - Math.cos(a) * 24} x2={32 + Math.sin(a) * 21} y2={32 - Math.cos(a) * 21} stroke="#B08628" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" />;
      })}
      <line x1="32" y1="32" x2={h.x2} y2={h.y2} stroke="#3F2E10" strokeWidth="3" strokeLinecap="round" />
      <line x1="32" y1="32" x2={m.x2} y2={m.y2} stroke="#3F2E10" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="32" y1="32" x2={s.x2} y2={s.y2} stroke="#D64545" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="32" cy="32" r="2.4" fill="#3F2E10" />
    </svg>
  );
}

// ─── Countdown panel — owns the 1s ticker so nothing else re-renders ────────
function CountdownPanel({ list }: { list: PublishedMeritList }) {
  const now = useNowTick(1000);
  const target = new Date(list.publish_at!);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const units: [number, string][] = [...(days > 0 ? [[days, "Days"] as [number, string]] : []), [hours, "Hrs"], [mins, "Min"], [secs, "Sec"]];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/10 via-card to-gold/5 p-4 sm:p-6 text-center shadow-card">
      <MiniClock className="w-11 h-11 mx-auto mb-2" hours={now.getHours()} minutes={now.getMinutes()} seconds={now.getSeconds()} />
      <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-400">Goes live in</p>
      <div className="mt-2 flex justify-center gap-2">
        {units.map(([v, l]) => (
          <div key={l} className="min-w-[52px] rounded-xl border border-border bg-card px-2 py-1.5 shadow-sm">
            <p className="text-2xl font-black tabular-nums leading-none text-foreground">{String(v).padStart(2, "0")}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mt-1">{l}</p>
          </div>
        ))}
      </div>
      <h2 className="text-sm sm:text-base font-heading font-bold text-foreground mt-3">{listTitle(list)}</h2>
      <p className="text-[11px] text-muted-foreground mt-0.5">{listMeta(list)}</p>
      <p className="text-[11px] text-muted-foreground mt-2 font-medium">
        {format(target, "EEEE, dd MMMM yyyy 'at' h:mm a")}
      </p>
      {list.notes && <p className="text-[11px] text-muted-foreground mt-3 italic max-w-md mx-auto">“{list.notes}”</p>}
    </div>
  );
}

// ─── Top 3 podium (compact) ──────────────────────────────────────────────────
const PODIUM = [
  { medal: "🥈", ring: "from-slate-300 to-slate-500", pct: "text-slate-600 dark:text-slate-300", offset: "mt-4" },
  { medal: "🥇", ring: "from-amber-300 to-yellow-600", pct: "text-amber-600 dark:text-amber-300", offset: "mt-0" },
  { medal: "🥉", ring: "from-amber-500 to-amber-800", pct: "text-amber-700 dark:text-amber-300", offset: "mt-6" },
];

const PodiumTile = memo(function PodiumTile({ entry, slot, showClass }: { entry: MeritStudentEntry | null; slot: 0 | 1 | 2; showClass: boolean }) {
  const p = PODIUM[slot];
  const first = slot === 1;
  return (
    <div className={`${p.offset} min-w-0 flex flex-col items-center text-center rounded-xl border bg-card px-1.5 py-2.5 sm:py-3 shadow-sm ${first ? "border-gold/60 shadow-card" : "border-border"}`}>
      <div className="relative mb-1.5">
        {first && <Crown className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-4 h-4 text-gold" fill="currentColor" />}
        <div className={`rounded-full p-[2px] bg-gradient-to-br ${p.ring} ${first ? "w-14 h-14 sm:w-16 sm:h-16" : "w-11 h-11 sm:w-14 sm:h-14"}`}>
          {entry ? (
            <div className="w-full h-full rounded-full overflow-hidden border-2 border-card">
              <MeritAvatar photoUrl={entry.photo_url} fullName={entry.full_name} size="w-full h-full" />
            </div>
          ) : (
            <div className="w-full h-full rounded-full bg-card border-2 border-card flex items-center justify-center text-muted-foreground/60 font-black">—</div>
          )}
        </div>
        <span className="absolute -bottom-1 -right-1 text-sm leading-none" aria-hidden>{p.medal}</span>
      </div>
      <p className="text-[11px] sm:text-sm font-bold leading-tight text-foreground w-full break-words line-clamp-2 min-h-[2.1em]">
        {entry ? entry.full_name : "—"}
      </p>
      <p className={`text-sm sm:text-lg font-black tabular-nums mt-0.5 ${p.pct}`}>
        {entry ? `${Number(entry.percentage).toFixed(1)}%` : "—"}
      </p>
      <p className="text-[9px] sm:text-[10px] text-muted-foreground font-mono">
        {entry ? <>Roll {entry.roll_number}{showClass ? ` · C${entry.class}` : ""}</> : "—"}
      </p>
    </div>
  );
});

function Top3Podium({ entries, showClass, onShare, sharing, hiddenState }: {
  entries: MeritStudentEntry[]; showClass: boolean;
  onShare?: () => void; sharing?: boolean; hiddenState?: boolean;
}) {
  if (!hiddenState && entries.length < 1) return null;
  const top = entries.slice(0, 3);
  // Visual order: 2nd · 1st · 3rd. While toppers are withheld, show dashes —
  // never crown the best VISIBLE students.
  const slots: (MeritStudentEntry | null)[] = hiddenState ? [null, null, null] : [top[1] ?? null, top[0] ?? null, top[2] ?? null];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 via-card to-gold/5 p-2.5 sm:p-4 shadow-card">
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <span className="w-6 h-6 rounded-lg bg-gold/20 text-amber-700 dark:text-amber-300 flex items-center justify-center"><Crown className="w-3.5 h-3.5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-bold text-[13px] sm:text-sm text-foreground leading-none">Top 3 Achievers</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {hiddenState ? "Revealed at the official announcement" : "This exam’s champions"}
          </p>
        </div>
        {onShare && !hiddenState && (
          <button
            type="button" onClick={onShare} disabled={sharing}
            aria-label="Share the Top 3 Achievers"
            className="shrink-0 inline-flex items-center gap-1 h-7 rounded-full border border-gold/40 bg-gold/10 px-2.5 text-[11px] font-bold text-amber-700 dark:text-amber-300 active:scale-95 transition disabled:opacity-60"
          >
            {sharing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} Share
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3 items-start">
        {slots.map((e, i) => (
          <PodiumTile key={i} entry={e} slot={i as 0 | 1 | 2} showClass={showClass} />
        ))}
      </div>
    </div>
  );
}

// ─── One ranked row (memoised; same markup for mobile + desktop) ─────────────
const MEDAL_BG = [
  "bg-gradient-to-br from-amber-400 to-yellow-600 text-white",
  "bg-gradient-to-br from-slate-300 to-slate-500 text-white",
  "bg-gradient-to-br from-amber-500 to-amber-800 text-white",
];
const ROW_TINT = [
  "bg-gradient-to-r from-amber-100/70 to-transparent dark:from-amber-500/15",
  "bg-gradient-to-r from-slate-100 to-transparent dark:from-slate-500/15",
  "bg-gradient-to-r from-orange-100/60 to-transparent dark:from-amber-700/15",
];
const ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "0 62px" } as const;

const RankRow = memo(function RankRow({ e, idx, dash, top3, multi }: {
  e: MeritStudentEntry; idx: number; dash: boolean; top3: boolean; multi: boolean;
}) {
  if (dash) {
    return (
      <li style={ROW_STYLE} className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5 opacity-60" title="Hidden until the official announcement">
        <span className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-black shrink-0">—</span>
        <span className="w-8 h-8 rounded-full border border-dashed border-border bg-muted/30 shrink-0" />
        <p className="text-[13px] font-semibold text-muted-foreground flex-1 min-w-0">Hidden until announcement</p>
        <span className="text-sm font-black text-muted-foreground/60 w-14 text-right">—</span>
      </li>
    );
  }
  const pct = Math.max(0, Math.min(100, Number(e.percentage) || 0));
  return (
    <li style={ROW_STYLE} className={`flex items-center gap-2.5 px-3 sm:px-4 py-2.5 ${top3 ? ROW_TINT[idx] : "hover:bg-muted/30"}`}>
      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${top3 ? MEDAL_BG[idx] + " shadow-sm" : "bg-muted text-muted-foreground"}`}>
        {top3 ? ["🥇", "🥈", "🥉"][idx] : e.position || idx + 1}
      </span>
      <MeritAvatar photoUrl={e.photo_url} fullName={e.full_name} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] sm:text-sm font-semibold text-foreground leading-snug break-words">{e.full_name}</p>
        <p className="text-[10.5px] text-muted-foreground font-mono leading-tight mt-0.5">
          Roll {e.roll_number}{multi && <span className="font-sans"> · Class {e.class}</span>}
          <span className="sm:hidden font-sans"> · {e.obtained_marks}/{e.total_marks}</span>
        </p>
        <div className="mt-1.5 h-[3px] rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-gold" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="hidden sm:block text-xs text-muted-foreground tabular-nums w-20 text-right">{e.obtained_marks}/{e.total_marks}</span>
      <div className="text-right shrink-0 w-14 sm:w-16">
        <p className="text-sm sm:text-base font-black tabular-nums text-foreground leading-none">{Number(e.percentage).toFixed(1)}%</p>
        <span className="mt-1 inline-block text-[10px] font-bold leading-none bg-gold/15 text-gold-strong dark:text-gold px-1.5 py-[3px] rounded-full border border-gold/30">{e.grade}</span>
      </div>
    </li>
  );
});

const PAGE_SIZE = 25;

// ─── Main page ───────────────────────────────────────────────────────────────
const MeritListPage = () => {
  const now = useNowTick(10_000); // cheap: rows are memoised
  const { data: publishedLists = [], isLoading: listsLoading } = usePublishedMeritLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);

  const liveLists = publishedLists.filter(
    (ml) => ml.is_published && (!ml.publish_at || !isAfter(new Date(ml.publish_at), now))
  );
  const scheduledLists = publishedLists.filter(
    (ml) => ml.is_published && ml.publish_at && isAfter(new Date(ml.publish_at), now)
  );

  useEffect(() => {
    const stillExists = selectedId && publishedLists.some((l) => l.id === selectedId);
    if (stillExists) return;
    setSelectedId(liveLists[0]?.id || scheduledLists[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedLists]);

  // Reset filters/paging when switching list
  useEffect(() => { setSearch(""); setClassFilter("all"); setVisible(PAGE_SIZE); }, [selectedId]);
  useEffect(() => { setVisible(PAGE_SIZE); }, [deferredSearch, classFilter]);

  const selectedList = publishedLists.find((l) => l.id === selectedId) || null;
  const isSelectedLive =
    !!selectedList && (!selectedList.publish_at || !isAfter(new Date(selectedList.publish_at), now));

  const { data: entries = [], isLoading: entriesLoading } = useMeritListData(isSelectedLive ? selectedList : null);

  const multi = isMultiClassScope(selectedList?.scope || "");

  const classOptions = useMemo(() => {
    if (!multi) return [] as string[];
    return Array.from(new Set(entries.filter((e) => !e.hidden).map((e) => String(e.class ?? "")).filter(Boolean)))
      .sort((a, b) => Number(a) - Number(b));
  }, [entries, multi]);

  const stats = useMemo(() => {
    const visibleEntries = entries.filter((e) => !e.hidden);
    const total = selectedList?.total_students ?? entries.length;
    const storedHighest = selectedList?.highest_percentage != null ? Number(selectedList.highest_percentage) : null;
    const maxVisible = visibleEntries.length ? Math.max(...visibleEntries.map((e) => e.percentage)) : 0;
    const hasHidden =
      entries.some((e) => e.hidden) ||
      total > visibleEntries.length ||
      (storedHighest != null && maxVisible > storedHighest);
    const passing = selectedList?.passing_count ?? visibleEntries.filter((e) => e.percentage >= 33).length;
    const highest = storedHighest != null ? storedHighest : hasHidden ? null : visibleEntries.length ? maxVisible : 0;
    const avg = selectedList?.average_percentage != null
      ? Number(selectedList.average_percentage)
      : visibleEntries.length ? Math.round(visibleEntries.reduce((s, e) => s + e.percentage, 0) / visibleEntries.length) : 0;
    const passRate = total ? Math.round((passing / total) * 100) : 0;
    return { total, passing, highest, avg, passRate, hasHidden };
  }, [selectedList, entries]);

  const theme = getMlTheme(selectedList?.theme);
  const hasPlaceholderRows = entries.some((e) => e.hidden);

  // LEGACY snapshots (pre-placeholder) still hold real names of withheld
  // students: mask the top 3 of every class so no withheld topper is exposed.
  const legacyHiddenIdx = useMemo(() => {
    const masked = new Set<number>();
    if (!stats.hasHidden || hasPlaceholderRows || entries.length === 0) return masked;
    if (multi) {
      const byClass = new Map<string, number[]>();
      entries.forEach((e, i) => {
        const k = String(e.class ?? "");
        const arr = byClass.get(k);
        if (arr) arr.push(i); else byClass.set(k, [i]);
      });
      for (const arr of byClass.values()) {
        [...arr].sort((a, b) => entries[b].percentage - entries[a].percentage).slice(0, 3).forEach((i) => masked.add(i));
      }
    } else {
      entries.slice(0, 3).forEach((_, i) => masked.add(i));
    }
    return masked;
  }, [entries, stats.hasHidden, hasPlaceholderRows, multi]);

  // Index-carrying filtered rows (avoids O(n²) indexOf)
  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    const out: { e: MeritStudentEntry; i: number }[] = [];
    entries.forEach((e, i) => {
      if (classFilter !== "all" && String(e.class) !== classFilter) return;
      const dash = e.hidden || legacyHiddenIdx.has(i);
      if (q) {
        if (dash) return;
        const hit = (e.full_name || "").toLowerCase().includes(q) ||
          (e.roll_number || "").toLowerCase().includes(q) ||
          String(e.class || "").includes(q);
        if (!hit) return;
      }
      out.push({ e, i });
    });
    return out;
  }, [entries, deferredSearch, classFilter, legacyHiddenIdx]);

  const shown = filtered.slice(0, visible);

  const [sharing, setSharing] = useState(false);
  const handleShareTop3 = async () => {
    if (!selectedList || sharing || entries.length === 0 || stats.hasHidden) return;
    setSharing(true);
    try {
      const top3: Top3ShareEntry[] = entries.slice(0, 3).map((e) => ({
        studentName: e.full_name, rollNo: e.roll_number, className: e.class,
        percentage: Number(e.percentage).toFixed(1), grade: e.grade, photoUrl: e.photo_url,
      }));
      toastShareOutcome(await shareTop3Card({ examLabel: listMeta(selectedList), entries: top3 }));
    } catch {
      toast.error("Could not prepare the share card — please try again");
    }
    setSharing(false);
  };

  const statItems = [
    { icon: Users, label: "Students", value: String(stats.total), tint: "text-blue-600 dark:text-blue-300" },
    { icon: CheckCircle2, label: `Pass · ${stats.passing}`, value: `${stats.passRate}%`, tint: "text-teal-600 dark:text-teal-300" },
    { icon: TrendingUp, label: "Highest", value: stats.highest != null ? `${stats.highest.toFixed(1)}%` : "—", tint: "text-amber-600 dark:text-amber-300" },
    { icon: Target, label: "Average", value: `${stats.avg}%`, tint: "text-violet-600 dark:text-violet-300" },
  ];

  return (
    <PageLayout>
      <div className="min-h-screen bg-background">
        {/* ══════════ SMALL BANNER ══════════ */}
        <section className="relative overflow-hidden gradient-hero">
          <div className="absolute inset-0 dot-grid opacity-[0.1]" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <div className="container mx-auto px-4 relative z-10 py-6 md:py-9 flex items-center gap-3.5 max-w-5xl">
            <span className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/10 border border-gold/40 text-gold flex items-center justify-center shrink-0">
              <Trophy className="w-6 h-6 md:w-7 md:h-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[1.7rem] md:text-4xl font-display font-semibold leading-tight text-on-hero">
                The <span className="italic text-gold">Merit List</span>
              </h1>
              <p className="text-xs md:text-sm text-on-hero-soft leading-snug mt-1">Official examination rankings from the school office</p>
            </div>
            <span className="hidden xs:inline-flex sm:inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/15 px-2.5 py-1 text-[10px] font-semibold text-on-hero shrink-0">
              <ShieldCheck className="w-3 h-3 text-gold" /> Verified
            </span>
          </div>
        </section>

        <section className="py-4 md:py-8">
          <div className="container mx-auto px-3 sm:px-4 max-w-5xl">
            {listsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-56 rounded-full" />
                <Skeleton className="h-14 rounded-2xl" />
                <Skeleton className="h-40 rounded-2xl" />
              </div>
            ) : publishedLists.length === 0 ? (
              <div className="bg-card rounded-2xl border border-border p-8 text-center shadow-card">
                <span className="w-12 h-12 rounded-2xl bg-gold/15 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto mb-3"><Trophy className="w-6 h-6" /></span>
                <h2 className="text-base md:text-lg font-heading font-bold text-foreground">No merit list published yet</h2>
                <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                  When the school office publishes the next merit list, it will appear here instantly.
                </p>
                <Link to="/results" className="mt-4 inline-flex items-center gap-1.5 h-9 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-5 shadow-card">
                  Check Exam Results <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {/* ── List picker — thin pills ── */}
                {publishedLists.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5">
                    {[...liveLists, ...scheduledLists].map((ml) => {
                      const sel = selectedId === ml.id;
                      const soon = scheduledLists.includes(ml);
                      return (
                        <button
                          key={ml.id} type="button" onClick={() => setSelectedId(ml.id)}
                          className={`shrink-0 inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-[11px] font-bold whitespace-nowrap transition active:scale-95 ${
                            sel ? "border-gold bg-gold/15 text-foreground shadow-sm" : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          {ml.scope === "school" ? <School className="w-3 h-3" /> : ml.scope === "school-bise" ? <Trophy className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
                          {ml.scope === "school" ? "School" : ml.scope === "school-bise" ? "BISE" : `Class ${ml.class}`}
                          <span className="font-medium opacity-70">· {ml.year}</span>
                          {soon && <span className="text-[9px] font-extrabold text-amber-600 dark:text-amber-400">SOON</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedList && (isSelectedLive ? (
                  <div className="space-y-3">
                    {/* Header strip in the list's theme */}
                    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${theme.from} ${theme.to} px-3.5 py-3 text-white shadow-card`}>
                      <div className="absolute -top-10 -right-8 w-28 h-28 rounded-full bg-white/10" />
                      <div className="relative flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0"><Trophy className="w-4 h-4" /></span>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-[13px] sm:text-lg font-heading font-extrabold leading-tight break-words">{listTitle(selectedList)}</h2>
                          <p className="text-[10.5px] sm:text-xs text-white/85 mt-0.5">{listMeta(selectedList)}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[9px] font-extrabold bg-white/20 px-2 py-1 rounded-full shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
                        </span>
                      </div>
                    </div>

                    {/* Stats — one compact strip */}
                    {entries.length > 0 && (
                      <div className="grid grid-cols-4 divide-x divide-border rounded-2xl border border-border bg-card shadow-card">
                        {statItems.map(({ icon: Icon, label, value, tint }) => (
                          <div key={label} className="px-1.5 py-2.5 text-center min-w-0">
                            <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${tint}`} />
                            <p className="text-[15px] sm:text-xl font-black tabular-nums leading-none text-foreground">{value}</p>
                            <p className="text-[9.5px] sm:text-[11px] font-semibold text-muted-foreground mt-1 truncate">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {(entries.length > 0 || stats.hasHidden) && (
                      <Top3Podium
                        entries={entries}
                        showClass={multi}
                        onShare={stats.hasHidden ? undefined : handleShareTop3}
                        sharing={sharing}
                        hiddenState={stats.hasHidden}
                      />
                    )}

                    {entriesLoading ? (
                      <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                    ) : entries.length === 0 ? (
                      <div className="bg-card rounded-2xl p-8 text-center border border-border">
                        <Trophy className="w-9 h-9 text-muted-foreground mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">No results data found</p>
                        <p className="text-xs text-muted-foreground mt-1">This merit list is published but no matching results exist yet.</p>
                      </div>
                    ) : (
                      <>
                        {/* Search */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <input
                            type="search" inputMode="search" value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search name, roll no${multi ? " or class" : ""}…`}
                            className="w-full h-10 pl-9 pr-16 text-sm rounded-full border border-border bg-card text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 shadow-sm transition"
                          />
                          {deferredSearch.trim() && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gold-strong dark:text-gold font-bold bg-gold/10 rounded-full px-2 py-0.5">
                              {filtered.length}
                            </span>
                          )}
                        </div>

                        {/* Class chips (school / BISE lists) */}
                        {multi && classOptions.length > 1 && (
                          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                            {["all", ...classOptions].map((c) => (
                              <button
                                key={c} type="button" onClick={() => setClassFilter(c)}
                                className={`shrink-0 h-7 rounded-full border px-3 text-[11px] font-bold transition active:scale-95 ${
                                  classFilter === c ? "border-gold bg-gold/15 text-foreground" : "border-border bg-card text-muted-foreground"
                                }`}
                              >
                                {c === "all" ? "All classes" : `Class ${c}`}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Ranked list */}
                        <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-card">
                          <div className="flex items-center justify-between px-3.5 py-2 bg-muted/50 border-b border-border">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">Official ranking</p>
                            <p className="text-[10px] font-semibold text-muted-foreground tabular-nums">{filtered.length} of {stats.total}</p>
                          </div>
                          <ul className="divide-y divide-border/60">
                            {shown.map(({ e, i }) => (
                              <RankRow
                                key={`${e.student_id}-${i}`}
                                e={e} idx={i}
                                dash={Boolean(e.hidden || legacyHiddenIdx.has(i))}
                                top3={i < 3 && !stats.hasHidden}
                                multi={multi}
                              />
                            ))}
                          </ul>
                          {filtered.length === 0 && (
                            <p className="p-6 text-center text-sm text-muted-foreground">No students match your search.</p>
                          )}
                          {filtered.length > visible && (
                            <div className="flex items-center justify-center gap-2 p-3 border-t border-border/60">
                              <button
                                type="button" onClick={() => setVisible((v) => v + 50)}
                                className="inline-flex items-center gap-1 h-8 rounded-full border border-gold/40 bg-gold/10 px-4 text-xs font-bold text-amber-700 dark:text-amber-300 active:scale-95 transition"
                              >
                                <ChevronDown className="w-3.5 h-3.5" /> Show more ({filtered.length - visible})
                              </button>
                              <button
                                type="button" onClick={() => setVisible(filtered.length)}
                                className="h-8 rounded-full border border-border px-3 text-xs font-semibold text-muted-foreground active:scale-95 transition"
                              >
                                Show all
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  selectedList.publish_at && <CountdownPanel list={selectedList} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </PageLayout>
  );
};

export default MeritListPage;
