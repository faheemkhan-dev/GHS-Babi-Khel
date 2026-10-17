import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { isAfter, format } from "date-fns";
import {
  Trophy, Crown, Sparkles, Search, Users, Target,
  TrendingUp, CheckCircle2, School, BookOpen, ArrowRight, Award,
  CalendarDays, ShieldCheck, Share2, Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { examTypeLabel } from "@/utils/examTypeLabel";
import { shareTop3Card, toastShareOutcome, type Top3ShareEntry } from "@/utils/shareResultCard";
import { Skeleton } from "@/components/ui/skeleton";
import PageLayout from "@/components/layout/PageLayout";
import toast from "react-hot-toast";

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC MERIT LIST PAGE  (/merit-list)
   The official examination rankings — previously locked inside the student
   dashboard, now a first-class public page linked from the Navbar.

   Data source: the admin-managed `merit_lists` table (snapshot v2).
     • is_published + publish_at in the past  → LIVE (rankings visible)
     • is_published + publish_at in the future → COMING SOON (live countdown)
   Legacy rows without a snapshot fall back to a live `results` query.

   Design notes:
   • GPU-safe only — no backdrop-filter, no hover:scale, no infinite CSS
     animations (Android Chrome compositing fixes in index.css).
   • 100% theme-token based → looks right in BOTH System and Dark themes.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Types ───────────────────────────────────────────────────────────────────
interface MeritStudentEntry {
  student_id: string; full_name: string; roll_number: string;
  class: string; exam_type?: string; photo_url: string | null;
  obtained_marks: number; total_marks: number; percentage: number;
  grade: string; position: number;
  /** True for an ANONYMOUS reserved row — a student the school withheld
   *  ("Hide top 3" / "Hide top 3 of each class"). Such rows carry NO
   *  personal data and are rendered as an all-dash table row at their
   *  official position. */
  hidden?: boolean;
}

interface PublishedMeritList {
  id: string;
  scope: string;            // 'class' | 'school' | 'school-bise'
  class: string;            // '6'-'10', 'school', or 'school-bise'
  exam_type: string | null;
  year: number;
  is_published: boolean;
  publish_at: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  entries?: MeritStudentEntry[] | null;
  total_students?: number;
  passing_count?: number;
  highest_percentage?: number;
  average_percentage?: number;
  theme?: string | null;
}

// Visual theme presets — match the admin's publish-time pick
const ML_THEME_PRESETS: Record<string, { from: string; to: string; softBg: string; accentText: string }> = {
  gold:    { from: "from-amber-600",  to: "to-amber-600",    softBg: "bg-amber-600/10",  accentText: "text-amber-700 dark:text-amber-300"  },
  royal:   { from: "from-blue-600",    to: "to-indigo-700",   softBg: "bg-blue-500/10",    accentText: "text-blue-600 dark:text-blue-300"     },
  emerald: { from: "from-teal-500",    to: "to-teal-700",     softBg: "bg-teal-500/10",    accentText: "text-teal-600 dark:text-teal-300"      },
  rose:    { from: "from-rose-500",    to: "to-pink-700",     softBg: "bg-rose-500/10",    accentText: "text-rose-600 dark:text-rose-300"     },
  violet:  { from: "from-violet-500",  to: "to-purple-700",   softBg: "bg-violet-500/10",  accentText: "text-violet-600 dark:text-violet-300" },
};
function getMlTheme(id?: string | null) {
  return ML_THEME_PRESETS[id || "gold"] || ML_THEME_PRESETS.gold;
}

// ─── Data hooks (same contract as the admin/ dashboard views) ────────────────
function usePublishedMeritLists() {
  return useQuery<PublishedMeritList[]>({
    queryKey: ["published-merit-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merit_lists")
        .select(`
          id, scope, class, exam_type, year, is_published, publish_at,
          title, notes, created_at,
          entries, total_students, passing_count,
          highest_percentage, average_percentage, theme
        `)
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("[MeritListPage] fetch error:", error.message);
        return [];
      }
      return (data ?? []) as PublishedMeritList[];
    },
    staleTime: 30_000,
    // Refetch when the tab regains focus. A visitor (or the admin double-
    // checking their own publish) often keeps this page open in one tab while
    // publishing from the admin panel in another; without this the page kept
    // rendering the PRE-publish list forever (real topper names, pre-mask
    // stats) even though the server row had already been replaced — exactly
    // the "I clicked hide top 3 but the homepage still shows toppers" report.
    // The 30s staleTime keeps this cheap; the focus switch is also the natural
    // moment the user checks the result of their publish.
    refetchOnWindowFocus: true,
    // ALWAYS refetch when the page mounts. Two reasons this is not optional:
    // 1) A list published seconds ago must be visible the moment a visitor
    //    opens the page (the publish→check flow).
    // 2) The IndexedDB offline snapshot (queryPersist.ts) restores older
    //    data via setQueryData, which stamps it with a FRESH timestamp —
    //    without "always" that stale copy would look new enough to skip
    //    the refetch for a while and could paint a pre-publish list.
    refetchOnMount: "always",
  });
}

function useMeritListData(ml: PublishedMeritList | null) {
  return useQuery<MeritStudentEntry[]>({
    queryKey: ["merit-list-data", ml?.id],
    queryFn: async () => {
      if (!ml) return [];
      // Path 1: snapshot (v2/v3) — decoupled from the results table.
      // Rows keep their OFFICIAL positions: withheld students sit in the
      // snapshot as anonymous placeholders (hidden: true, no personal
      // data) so the table can list ALL students (e.g. 54) with the
      // hidden ones as dash rows at the exact ranks they earned.
      if (Array.isArray(ml.entries) && ml.entries.length > 0) {
        const sorted = [...ml.entries].sort((a, b) => {
          const pa = Number(a.position) || 0;
          const pb = Number(b.position) || 0;
          if (pa > 0 && pb > 0) return pa - pb;              // official ranking order
          return (Number(b.percentage) || 0) - (Number(a.percentage) || 0); // legacy fallback
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
        if (!best.has(key) || r.percentage > best.get(key).percentage) {
          best.set(key, r);
        }
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
    // Same cross-tab rationale as the lists query above: a re-published list
    // (same row id, upserted snapshot) must never be answered from a restored
    // offline copy — or from the memory of a tab that was open pre-publish.
    refetchOnWindowFocus: true,
    // Same as the lists query: a re-published list (same row id, upserted
    // snapshot) must never be answered from a restored offline copy.
    refetchOnMount: "always",
    enabled: !!ml,
  });
}

// 1-second ticker for the live countdown
function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ─── Shared motion variants (one-shot, GPU-safe) ─────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

// "school" and "school-bise" both mean "multiple classes combined" (as
// opposed to a single "class" scope) — used everywhere the UI previously
// checked `scope === "school"` to decide whether to show a Class column,
// combined styling, etc.
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

// ─── Avatar with graceful fallback ───────────────────────────────────────────
function MeritAvatar({ photoUrl, fullName, size = "w-9 h-9" }: { photoUrl: string | null; fullName: string; size?: string }) {
  const [imgError, setImgError] = useState(false);
  return photoUrl && !imgError ? (
    <img src={photoUrl} alt={`${fullName}'s photo`} className={`${size} rounded-full object-cover shrink-0 ring-2 ring-border`} onError={() => setImgError(true)} loading="lazy" decoding="async" />
  ) : (
    <div className={`${size} rounded-full bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0 ring-2 ring-border`}>
      {(fullName || "?")[0]}
    </div>
  );
}

// ─── Realistic countdown clock icon (layered SVG, not a flat glyph) ────────
function RealisticClockIcon({ className = "w-8 h-8", hours = 0, minutes = 0, seconds = 0 }: { className?: string; hours?: number; minutes?: number; seconds?: number }) {
  const secAngle = (seconds % 60) * 6;
  const minAngle = (minutes % 60) * 6 + (seconds % 60) * 0.1;
  const hourAngle = (hours % 12) * 30 + (minutes % 60) * 0.5;
  const hand = (angleDeg: number, len: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x2: 32 + Math.sin(rad) * len, y2: 34 - Math.cos(rad) * len };
  };
  const hourHand = hand(hourAngle, 8.5);
  const minHand = hand(minAngle, 12);
  const secHand = hand(secAngle, 13.5);
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="clockFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFDF5" />
          <stop offset="100%" stopColor="#F3E9C7" />
        </linearGradient>
        <linearGradient id="clockRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4C550" />
          <stop offset="100%" stopColor="#C6912A" />
        </linearGradient>
      </defs>
      {/* Bells */}
      <circle cx="16" cy="10" r="5.5" fill="url(#clockRim)" />
      <circle cx="48" cy="10" r="5.5" fill="url(#clockRim)" />
      {/* Legs */}
      <rect x="22" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      <rect x="37.5" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      {/* Outer rim */}
      <circle cx="32" cy="34" r="24" fill="url(#clockRim)" />
      {/* Face */}
      <circle cx="32" cy="34" r="19.5" fill="url(#clockFace)" stroke="#C6912A" strokeWidth="1.5" />
      {/* Tick marks */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = 32 + Math.sin(angle) * 16.5;
        const y1 = 34 - Math.cos(angle) * 16.5;
        const x2 = 32 + Math.sin(angle) * 14;
        const y2 = 34 - Math.cos(angle) * 14;
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#B08628" strokeWidth={i % 3 === 0 ? 1.4 : 0.8} strokeLinecap="round" />
        );
      })}
      {/* Hands — rotate live with the actual countdown remaining */}
      <line x1="32" y1="34" x2={hourHand.x2} y2={hourHand.y2} stroke="#3F2E10" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="32" y1="34" x2={minHand.x2} y2={minHand.y2} stroke="#3F2E10" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="32" y1="34" x2={secHand.x2} y2={secHand.y2} stroke="#D64545" strokeWidth="1.3" strokeLinecap="round" />
      {/* Center pin */}
      <circle cx="32" cy="34" r="2.2" fill="#3F2E10" />
    </svg>
  );
}

// ─── Countdown unit tile (Time-Remaining style: bold colour-coded digits) ───
function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-0.5">
      <span className="text-4xl md:text-5xl font-black tabular-nums text-red-600 dark:text-red-400 leading-none">
        {String(Math.max(0, value)).padStart(2, "0")}
      </span>
      <span className="text-base md:text-lg font-bold text-red-600/70 dark:text-red-400/70 lowercase">
        {label}
      </span>
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function MeritStatCard({ icon: Icon, label, value, sub, tile }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number; sub?: string; tile: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className={`absolute -right-5 -top-5 w-20 h-20 rounded-full ${tile.split(" ")[0]} opacity-20`} />
      <div className="relative">
        <div className={`w-10 h-10 rounded-xl ${tile} flex items-center justify-center mb-3 shadow-sm`}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-2xl font-black tabular-nums leading-none text-foreground">{value}</p>
        <p className="text-[11px] font-semibold text-muted-foreground mt-1.5">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Top-3 podium — the showpiece ────────────────────────────────────────────
const PODIUM_STYLES = [
  { // 2nd — silver
    ring: "from-slate-300 to-slate-500 dark:from-slate-400 dark:to-slate-600",
    column: "from-slate-300 to-slate-400 dark:from-slate-500 dark:to-slate-700",
    nameColor: "text-foreground",
    pctColor: "text-slate-600 dark:text-slate-300",
    badge: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
  },
  { // 1st — gold
    ring: "from-amber-400 to-yellow-600 dark:from-amber-400 dark:to-yellow-500",
    column: "from-amber-400 to-yellow-500 dark:from-amber-500 dark:to-yellow-600",
    nameColor: "text-amber-700 dark:text-amber-300",
    pctColor: "text-amber-600 dark:text-amber-300",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200",
  },
  { // 3rd — bronze
    ring: "from-amber-500 to-amber-700 dark:from-amber-600 dark:to-amber-700",
    column: "from-amber-500 to-amber-600 dark:from-amber-700 dark:to-amber-800",
    nameColor: "text-foreground",
    pctColor: "text-amber-700 dark:text-amber-300",
    badge: "bg-gold-soft text-amber-800 dark:bg-amber-600/20 dark:text-amber-200",
  },
];

function PodiumItem({ entry, rank, style, heightClass, showClass, delay }: {
  entry: MeritStudentEntry;
  rank: number;
  style: typeof PODIUM_STYLES[number];
  heightClass: string;
  showClass: boolean;
  delay: number;
}) {
  const [imgError, setImgError] = useState(false);
  const isFirst = rank === 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="flex flex-col items-center text-center w-full min-w-0 flex-1"
    >
      {/* Avatar with medal ring */}
      <div className="relative mb-2 sm:mb-3 mt-3 sm:mt-4">
        {isFirst && (
          <Crown className="absolute -top-4 sm:-top-6 left-1/2 -translate-x-1/2 w-3.5 h-3.5 sm:w-6 sm:h-6 text-gold" fill="currentColor" />
        )}
        <div className={`relative ${isFirst ? "w-14 h-14 sm:w-24 sm:h-24" : "w-11 h-11 sm:w-20 sm:h-20"} rounded-full p-[2px] sm:p-[3px] bg-gradient-to-br ${style.ring} shadow-elevated`}>
          {entry.photo_url && !imgError ? (
            <img src={entry.photo_url} alt={`${entry.full_name}'s photo`} className="w-full h-full rounded-full object-cover border-2 border-card" onError={() => setImgError(true)} loading="lazy" decoding="async" />
          ) : (
            <div className="w-full h-full rounded-full bg-card flex items-center justify-center font-black text-sm sm:text-xl text-foreground border-2 border-card">
              {(entry.full_name || "?")[0]}
            </div>
          )}
        </div>
        <span className={`absolute -bottom-1 -right-0.5 text-xs sm:text-xl ${isFirst ? "sm:text-2xl" : ""}`} aria-hidden>
          {rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}
        </span>
      </div>

      {/* Name + class — full name, wraps instead of truncating */}
      <p className={`text-[9.5px] sm:text-sm font-bold leading-tight w-full px-0.5 break-words ${style.nameColor}`}>{entry.full_name}</p>
      <div className="flex items-center justify-center gap-1 mt-0.5 sm:mt-1 flex-wrap">
        {showClass && (
          <span className="text-[8px] sm:text-[10px] font-bold bg-primary/10 text-primary px-1.5 sm:px-2 py-0.5 rounded-full">Cls {entry.class}</span>
        )}
        <span className={`text-[8px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full ${style.badge}`}>{entry.grade}</span>
      </div>

      {/* Percentage */}
      <p className={`text-sm sm:text-xl font-black tabular-nums mt-1 sm:mt-1.5 ${style.pctColor}`}>
        {Number(entry.percentage).toFixed(1)}%
      </p>
      <p className="text-[9px] sm:text-[10px] text-muted-foreground font-mono">Roll {entry.roll_number}</p>

      {/* Podium column */}
      <div className={`mt-2 sm:mt-3 w-full ${heightClass} rounded-t-2xl bg-gradient-to-b ${style.column} flex items-start justify-center pt-1.5 sm:pt-2 shadow-card`}>
        <span className="text-white font-black text-base sm:text-3xl leading-none drop-shadow-sm">{rank}</span>
      </div>
    </motion.div>
  );
}

function Top3Podium({ entries, showClass, onShareTop3, sharingTop3, hiddenState }: {
  entries: MeritStudentEntry[];
  showClass: boolean;
  onShareTop3?: () => void;
  sharingTop3?: boolean;
  /** True when the admin withheld students ("Hide top 3" / "Hide top 3 of each
   *  class"). The visible list's best scores are then NOT the real toppers, so
   *  the podium must show dash placeholders instead of crowning the wrong
   *  students — mirroring the "Highest %" stat card's dash. */
  hiddenState?: boolean;
}) {
  if (!hiddenState && entries.length < 1) return null;
  const top3 = entries.slice(0, 3);
  const order = [
    { entry: top3[1], rank: 2, height: "h-12 sm:h-24", delay: 0.15 },
    { entry: top3[0], rank: 1, height: "h-16 sm:h-32", delay: 0 },
    { entry: top3[2], rank: 3, height: "h-10 sm:h-20", delay: 0.3 },
  ].filter((o) => Boolean(o.entry));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-gold/30 bg-gradient-to-br from-gold/10 via-card to-gold/5 p-3 sm:p-7 shadow-elevated">
      <div className="orb orb-gold w-56 h-56 -top-24 -right-16 opacity-60" />
      <div className="relative flex items-center gap-2 mb-4 sm:mb-6">
        <span className="icon-tile w-7 h-7 sm:w-9 sm:h-9"><Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading font-bold text-foreground leading-none text-sm sm:text-base">Top 3 Achievers</h3>
          <p className="text-[9px] sm:text-[11px] text-muted-foreground mt-1">
            {hiddenState ? "Hidden for now — toppers revealed at the official announcement" : "Hall of fame — this exam's champions"}
          </p>
        </div>
        {onShareTop3 && !hiddenState && (
          <button
            type="button"
            onClick={onShareTop3}
            disabled={sharingTop3}
            aria-label="Share the Top 3 Achievers"
            title="Share Top 3 Achievers — beautiful card + website link"
            className="shrink-0 inline-flex items-center gap-1 sm:gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 sm:px-3.5 py-1.5 text-[10px] sm:text-[12px] font-bold text-amber-700 dark:text-amber-300 hover:bg-gold/20 active:scale-95 transition-all disabled:opacity-60 cursor-pointer"
          >
            {sharingTop3 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
            <span className="hidden xs:inline sm:inline">Share</span>
          </button>
        )}
      </div>
      {hiddenState ? (
        /* Toppers withheld — same 2nd–1st–3rd podium frame, but every podium
           spot is a dash placeholder. Never show the visible list's best
           scores as "Top 3" — they are not the real achievers. */
        <>
          <div className="relative flex items-end justify-center gap-2 sm:gap-8">
            {[
              { rank: 2, height: "h-12 sm:h-24", size: "w-11 h-11 sm:w-20 sm:h-20" },
              { rank: 1, height: "h-16 sm:h-32", size: "w-14 h-14 sm:w-24 sm:h-24" },
              { rank: 3, height: "h-10 sm:h-20", size: "w-11 h-11 sm:w-16 sm:h-16" },
            ].map((o) => (
              <div key={`hidden-${o.rank}`} className="flex flex-col items-center text-center w-full min-w-0 flex-1">
                <div className={`mb-2 sm:mb-3 mt-3 sm:mt-4 ${o.size} rounded-full border-2 border-dashed border-gold/50 bg-gold/5 flex items-center justify-center`}>
                  <span className="text-lg sm:text-2xl font-black text-muted-foreground/60 leading-none">—</span>
                </div>
                <p className="text-[9.5px] sm:text-sm font-bold text-muted-foreground/70 leading-tight">—</p>
                <p className="text-[9px] sm:text-[10px] text-muted-foreground/50 font-mono mt-0.5">—</p>
                <div className={`mt-2 sm:mt-3 w-full ${o.height} rounded-t-2xl bg-gradient-to-b ${PODIUM_STYLES[o.rank - 1].column} opacity-70 flex items-start justify-center pt-1.5 sm:pt-2 shadow-card`}>
                  <span className="text-white font-black text-base sm:text-3xl leading-none drop-shadow-sm">{o.rank}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="relative text-center text-[9px] sm:text-[11px] text-muted-foreground mt-3 sm:mt-4">
            Top 3 achievers are hidden right now — they will appear here at the official reveal.
          </p>
        </>
      ) : (
        /* Always the classic horizontal podium row (2nd–1st–3rd), sized down on mobile. */
        <div className="relative flex items-end justify-center gap-2 sm:gap-8">
          {order.map((o) => (
            <PodiumItem
              key={`${o.entry.student_id}-${o.rank}`}
              entry={o.entry}
              rank={o.rank}
              style={PODIUM_STYLES[o.rank - 1]}
              heightClass={o.height}
              showClass={showClass}
              delay={o.delay}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
const MeritListPage = () => {
  const now = useNowTick(1000);
  const { data: publishedLists = [], isLoading: listsLoading } = usePublishedMeritLists();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const liveLists = publishedLists.filter(
    (ml) => ml.is_published && (!ml.publish_at || !isAfter(new Date(ml.publish_at), now))
  );
  const scheduledLists = publishedLists.filter(
    (ml) => ml.is_published && ml.publish_at && isAfter(new Date(ml.publish_at), now)
  );

  // Default selection = most recent live list, else the next scheduled one
  useEffect(() => {
    const stillExists = selectedId && publishedLists.some((l) => l.id === selectedId);
    if (stillExists) return;
    const firstLive = liveLists[0];
    const firstScheduled = scheduledLists[0];
    setSelectedId(firstLive?.id || firstScheduled?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedLists]);

  const selectedList = publishedLists.find((l) => l.id === selectedId) || null;
  const isSelectedLive =
    selectedList && (!selectedList.publish_at || !isAfter(new Date(selectedList.publish_at), now));

  const { data: entries = [], isLoading: entriesLoading } = useMeritListData(
    isSelectedLive ? selectedList : null
  );

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase().trim();
    return entries.filter(
      (e) =>
        (e.full_name || "").toLowerCase().includes(q) ||
        (e.roll_number || "").toLowerCase().includes(q) ||
        String(e.class || "").includes(q)
    );
  }, [entries, search]);

  const stats = useMemo(() => {
    // total_students always reflects EVERYONE (including students hidden for
    // a stage reveal). Withheld students appear in the snapshot as anonymous
    // placeholder rows (hidden: true); older published rows instead stored
    // fewer entries than total_students. Either signal means the visible
    // list's best score is NOT the real topper, so "Highest %" can't be
    // trusted from the visible rows alone.
    const visibleEntries = entries.filter((e) => !e.hidden);
    const total = selectedList?.total_students ?? entries.length;
    // Masked-highest invariant: the stored "Highest %" is computed over the
    // FULL pool (incl. hidden students) at publish time, so an honest publish
    // always satisfies storedHighest >= max visible %. If the visible rows
    // BEAT the stored highest, the stored value was masked ("0 while toppers
    // withheld") — that happens on legacy snapshots written before withheld
    // students became anonymous placeholder rows, or on a stale cached copy
    // of such a row. Either way the withheld state MUST be honoured: the
    // podium and the top of the table would otherwise crown the wrong
    // students with real names (exactly the bug this guards against).
    const storedHighest = selectedList?.highest_percentage != null
      ? Number(selectedList.highest_percentage)
      : null;
    const maxVisible = visibleEntries.length
      ? Math.max(...visibleEntries.map((e) => e.percentage))
      : 0;
    const hasHidden =
      entries.some((e) => e.hidden) ||
      total > visibleEntries.length ||
      (storedHighest != null && maxVisible > storedHighest);
    const passing =
      selectedList?.passing_count ?? visibleEntries.filter((e) => e.percentage >= 33).length;
    // "Highest %" displays the STORED publish-time value as-is. While toppers
    // are withheld, useSaveMeritList deliberately stores 0 as a "withheld"
    // marker, so the card shows 0.0% — the school's chosen "not revealed yet"
    // signal. We never substitute the best VISIBLE score here (that would
    // crown the wrong student), and the dash fallback only applies when the
    // row stores no value at all.
    const highest = storedHighest != null
      ? storedHighest
      : hasHidden
        ? null
        : visibleEntries.length ? maxVisible : 0;
    const avg =
      selectedList?.average_percentage != null
        ? Number(selectedList.average_percentage)
        : visibleEntries.length ? Math.round(visibleEntries.reduce((s, e) => s + e.percentage, 0) / visibleEntries.length) : 0;
    const passRate = total ? Math.round((passing / total) * 100) : 0;
    return { total, passing, highest, avg, passRate, hasHidden };
  }, [selectedList, entries]);

  const theme = getMlTheme(selectedList?.theme);
  // Does the snapshot contain anonymous placeholder rows (new format) — or
  // is this a LEGACY row (real names/marks stored, hiding only detectable
  // via the masked-highest invariant in `stats`)? The table needs the
  // distinction to decide which rows to render as dashes.
  const hasPlaceholderRows = entries.some((e) => e.hidden);

  // LEGACY rows (published before withheld students became anonymous
  // placeholder rows) still carry the REAL names/marks of the students the
  // school hid; the only signals are the masked "Highest %" (0) and/or
  // total_students exceeding the visible rows. Both publish-dialog quick
  // actions target class toppers — "Hide top 3 students" hides the overall
  // top 3 (each of whom is necessarily inside their own class's top 3) and
  // "Hide top 3 of each class" hides each class's top 3 — so masking the
  // top 3 OF EVERY CLASS covers both modes without ever exposing a real
  // withheld topper. Re-publishing replaces this best-effort mask with the
  // exact per-student placeholders of the current snapshot format.
  const legacyHiddenIdx = useMemo(() => {
    const masked = new Set<number>();
    if (!stats.hasHidden || hasPlaceholderRows || entries.length === 0) return masked;
    if (isMultiClassScope(selectedList?.scope || "")) {
      const byClass = new Map<string, MeritStudentEntry[]>();
      for (const e of entries) {
        const key = String(e.class ?? "");
        const arr = byClass.get(key);
        if (arr) arr.push(e); else byClass.set(key, [e]);
      }
      for (const arr of byClass.values()) {
        [...arr]
          .sort((a, b) => b.percentage - a.percentage)
          .slice(0, 3)
          .forEach((e) => masked.add(entries.indexOf(e)));
      }
    } else {
      entries.slice(0, 3).forEach((_, i) => masked.add(i));
    }
    return masked;
  }, [entries, stats.hasHidden, hasPlaceholderRows, selectedList]);

  /* ── Share the Top 3 Achievers as one beautiful podium-style card image,
        via the Web Share API (WhatsApp etc). Fallbacks: text share →
        download + clipboard (same chain as the Results page). ── */
  const [sharingTop3, setSharingTop3] = useState(false);
  const handleShareTop3 = async () => {
    // While toppers are withheld, entries.slice(0,3) would share the WRONG
    // students (the visible list's best) as achievers — never share then.
    if (!selectedList || sharingTop3 || entries.length === 0 || stats.hasHidden) return;
    setSharingTop3(true);
    try {
      const top3Entries: Top3ShareEntry[] = entries.slice(0, 3).map((e) => ({
        studentName: e.full_name,
        rollNo: e.roll_number,
        className: e.class,
        percentage: Number(e.percentage).toFixed(1),
        grade: e.grade,
        photoUrl: e.photo_url,
      }));
      const outcome = await shareTop3Card({
        examLabel: listMeta(selectedList),
        entries: top3Entries,
      });
      toastShareOutcome(outcome);
    } catch {
      toast.error("Could not prepare the share card — please try again");
    }
    setSharingTop3(false);
  };

  return (
    <PageLayout>
    <div className="min-h-screen bg-background">
      {/* ══════════ PREMIUM HERO ══════════ */}
      <section className="relative overflow-hidden gradient-hero">
        <div className="orb orb-gold w-[420px] h-[420px] -top-40 -right-24 opacity-70" />
        <div className="orb orb-light w-[300px] h-[300px] -bottom-28 -left-16" />
        <div className="absolute inset-0 dot-grid opacity-[0.12]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="container mx-auto px-4 relative z-10 pt-9 pb-10 md:py-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-white/10 backdrop-blur-sm px-3.5 py-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-[0.2em] text-gold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
          >
            <Trophy className="w-3 h-3" />
            Official Rankings
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.55 }}
            className="mt-3 text-[2rem] md:text-5xl font-display font-semibold leading-[1.08] text-on-hero"
          >
            The <span className="italic text-gold">Merit List.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.55 }}
            className="mt-2.5 text-on-hero-soft text-xs sm:text-sm max-w-xl mx-auto leading-relaxed"
          >
            Celebrating our highest achievers — official examination rankings,
            published straight from the school office.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.55 }}
            className="mt-4 flex flex-wrap items-center justify-center gap-2"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-on-hero">
              <ShieldCheck className="w-3 h-3 text-gold" /> Official Verified
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-on-hero">
              <CalendarDays className="w-3 h-3 text-gold" />
              {liveLists.length} live · {scheduledLists.length} upcoming
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-[11px] sm:text-xs font-medium text-on-hero">
              <Award className="w-3 h-3 text-gold" /> Est. 2018
            </span>
          </motion.div>
        </div>
      </section>

      <section className="py-8 md:py-12 relative">
        <div className="container mx-auto px-3 sm:px-4 max-w-5xl">
          {listsLoading ? (
            /* ── Loading skeleton ── */
            <div className="space-y-4">
              <Skeleton className="h-10 w-64 rounded-xl" />
              <Skeleton className="h-72 rounded-3xl" />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
              </div>
            </div>
          ) : publishedLists.length === 0 ? (
            /* ── Empty state ── */
            <motion.div variants={fadeUp} initial="hidden" animate="visible"
              className="relative overflow-hidden bg-card rounded-3xl border border-border p-12 text-center shadow-card">
              <div className="orb orb-gold w-48 h-48 -top-16 -right-12 opacity-50" />
              <div className="relative">
                <span className="icon-tile w-16 h-16 !rounded-2xl mx-auto mb-5"><Trophy className="w-8 h-8" /></span>
                <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground">No merit list published yet</h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto leading-relaxed">
                  When the school office publishes the next merit list, it will appear
                  here instantly — ranked, verified and ready to celebrate.
                </p>
                <Link
                  to="/results"
                  className="sheen mt-6 inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold px-6 py-3 shadow-elevated hover:opacity-95 transition-opacity"
                >
                  Check Exam Results <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-6">
              {/* ── List picker — scannable pills ── */}
              {liveLists.length > 1 && (
                <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.16em] flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Live Now — choose a list
                  </p>
                  <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
                    {liveLists.map((ml) => {
                      const mlTheme = getMlTheme(ml.theme);
                      const isSelected = selectedId === ml.id;
                      return (
                        <button
                          key={ml.id}
                          onClick={() => setSelectedId(ml.id)}
                          className={`shrink-0 inline-flex items-center gap-2.5 rounded-full border-2 pl-1.5 pr-4 py-1.5 transition-all active:scale-95 ${
                            isSelected
                              ? "border-gold bg-gold/15 shadow-[0_8px_20px_-8px_hsl(var(--gold)/0.6)]"
                              : "border-border bg-card hover:border-gold/40 shadow-sm"
                          }`}
                        >
                          <span className={`w-8 h-8 rounded-full bg-gradient-to-br ${mlTheme.from} ${mlTheme.to} text-white flex items-center justify-center shrink-0`}>
                            {ml.scope === "school" ? <School className="w-4 h-4" /> : ml.scope === "school-bise" ? <Trophy className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
                          </span>
                          <span className="text-xs font-bold text-foreground whitespace-nowrap">
                            {ml.scope === "school" ? "School" : ml.scope === "school-bise" ? "BISE" : `Class ${ml.class}`}
                            <span className="text-muted-foreground font-medium"> · {ml.year}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Selected list ── */}
              {selectedList && (
                isSelectedLive ? (
                  <div className="space-y-6">
                    {/* Header band in the list's own theme */}
                    <motion.div
                      key={selectedList.id}
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45 }}
                      className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${theme.from} ${theme.to} px-4 py-4 sm:px-6 sm:py-7 text-white shadow-elevated`}
                    >
                      <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/10 -translate-y-14 translate-x-14" />
                      <div className="absolute bottom-0 left-0 w-28 h-28 rounded-full bg-white/5 translate-y-8 -translate-x-8" />
                      <div className="relative flex items-start gap-2.5 sm:gap-4 flex-wrap">
                        <span className="w-9 h-9 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-white/20 flex items-center justify-center shrink-0 shadow-card">
                          <Trophy className="w-4 h-4 sm:w-7 sm:h-7" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h2 className="text-sm sm:text-2xl font-heading font-black leading-tight">{listTitle(selectedList)}</h2>
                          <p className="text-[11px] sm:text-sm text-white/85 mt-0.5 sm:mt-1">
                            {listMeta(selectedList)} · {stats.total} students
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[9px] sm:text-[11px] font-bold bg-white/20 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                        </span>
                      </div>
                    </motion.div>

                    {/* Stats */}
                    {entries.length > 0 && (
                      <motion.div variants={fadeUp} initial="hidden" animate="visible"
                        className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <MeritStatCard icon={Users} label="Total Students" value={stats.total}
                          tile="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300" />
                        <MeritStatCard icon={CheckCircle2} label="Pass Rate" value={`${stats.passRate}%`}
                          sub={`${stats.passing} passed`}
                          tile="bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300" />
                        <MeritStatCard icon={TrendingUp} label="Highest %" value={stats.highest != null ? `${stats.highest.toFixed(1)}%` : "—"}
                          tile="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300" />
                        <MeritStatCard icon={Target} label="Average %" value={`${stats.avg}%`}
                          tile="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300" />
                      </motion.div>
                    )}

                    {/* Podium — dash placeholders while toppers are withheld */}
                    {(entries.length > 0 || stats.hasHidden) && (
                      <Top3Podium
                        entries={entries}
                        showClass={isMultiClassScope(selectedList.scope)}
                        onShareTop3={stats.hasHidden ? undefined : handleShareTop3}
                        sharingTop3={sharingTop3}
                        hiddenState={stats.hasHidden}
                      />
                    )}

                    {entriesLoading ? (
                      <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
                    ) : entries.length === 0 ? (
                      <div className="bg-card rounded-2xl p-12 text-center border border-border">
                        <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-sm font-medium text-foreground">No results data found</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This merit list is published but no matching results exist yet.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Search */}
                        <div className="relative group">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-gold-strong transition-colors" />
                          <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={`Search by name, roll no${isMultiClassScope(selectedList.scope) ? ", or class" : ""}…`}
                            className="w-full h-14 pl-12 pr-20 text-[15px] rounded-2xl border-2 border-border bg-card text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-gold focus:ring-4 focus:ring-gold/20 shadow-card transition-all"
                          />
                          {search && (
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-gold-strong dark:text-gold font-bold bg-gold/10 rounded-full px-2.5 py-1">
                              {filteredEntries.length}/{stats.total}
                            </span>
                          )}
                        </div>

                        {/* Ranked table */}
                        <div className="bg-card rounded-3xl border border-border overflow-hidden shadow-elevated">
                          <div className={`relative overflow-hidden bg-gradient-to-r ${theme.from} ${theme.to} text-white px-5 py-4 flex items-center justify-between gap-3`}>
                            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                            <div className="min-w-0">
                              <h3 className="font-bold text-sm leading-snug break-words">{listTitle(selectedList)}</h3>
                              <p className="text-xs text-white/80 mt-0.5">Official rankings · {stats.total} students</p>
                            </div>
                            <Sparkles className="w-5 h-5 shrink-0" />
                          </div>
                          {/* Mobile ranking cards (no sideways scrolling) */}
                          <div className="md:hidden divide-y divide-border/60">
                            {filteredEntries.map((e) => {
                              const idx = entries.indexOf(e);
                              const dashRow = e.hidden || legacyHiddenIdx.has(idx);
                              if (dashRow) {
                                return (
                                  <div key={`m-hidden-${e.position ?? idx}`} className="flex items-center gap-3 px-4 py-3.5 opacity-60">
                                    <span className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-black shrink-0">—</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold text-muted-foreground">Hidden until announcement</p>
                                      <p className="text-[11px] text-muted-foreground/80">Revealed at the official ceremony</p>
                                    </div>
                                  </div>
                                );
                              }
                              const isTop3 = idx < 3 && !stats.hasHidden;
                              const pct = Math.max(0, Math.min(100, Number(e.percentage) || 0));
                              return (
                                <div
                                  key={`m-${e.student_id}-${idx}`}
                                  className={`px-4 py-3.5 ${
                                    isTop3
                                      ? idx === 0 ? "bg-gradient-to-r from-amber-100/80 to-transparent dark:from-amber-500/15"
                                      : idx === 1 ? "bg-gradient-to-r from-slate-100 to-transparent dark:from-slate-500/15"
                                      : "bg-gradient-to-r from-orange-100/70 to-transparent dark:from-amber-700/15"
                                      : ""
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <span
                                      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0 shadow-sm ${
                                        isTop3
                                          ? idx === 0 ? "bg-gradient-to-br from-amber-400 to-yellow-500 text-white"
                                          : idx === 1 ? "bg-gradient-to-br from-slate-300 to-slate-500 text-white"
                                          : "bg-gradient-to-br from-amber-500 to-amber-700 text-white"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {isTop3 ? ["🥇", "🥈", "🥉"][idx] : e.position || idx + 1}
                                    </span>
                                    <MeritAvatar photoUrl={e.photo_url} fullName={e.full_name} size="w-10 h-10" />
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[13px] font-bold text-foreground leading-snug break-words">{e.full_name}</p>
                                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                        Roll {e.roll_number}
                                        {isMultiClassScope(selectedList.scope) && <span className="font-sans"> · Class {e.class}</span>}
                                      </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-base font-black tabular-nums text-foreground leading-none">{Number(e.percentage).toFixed(1)}%</p>
                                      <span className="mt-1 inline-block text-[10px] font-bold bg-gold/15 text-gold-strong dark:text-gold px-2 py-0.5 rounded-full border border-gold/30">{e.grade}</span>
                                    </div>
                                  </div>
                                  <div className="mt-2.5 flex items-center gap-2.5">
                                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-gold" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground tabular-nums">{e.obtained_marks}/{e.total_marks}</span>
                                  </div>
                                </div>
                              );
                            })}
                            {filteredEntries.length === 0 && (
                              <p className="p-8 text-center text-sm text-muted-foreground">No students match "{search}".</p>
                            )}
                          </div>
                          <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-muted/50 border-b border-border">
                                  <th className="p-3 text-center font-bold text-xs uppercase tracking-wide text-muted-foreground">Rank</th>
                                  {isMultiClassScope(selectedList.scope) && (
                                    <th className="p-3 text-center font-bold text-xs uppercase tracking-wide text-muted-foreground">Class</th>
                                  )}
                                  <th className="p-3 text-left font-bold text-xs uppercase tracking-wide text-muted-foreground">Roll No</th>
                                  <th className="p-3 text-left font-bold text-xs uppercase tracking-wide text-muted-foreground">Student</th>
                                  <th className="p-3 text-center font-bold text-xs uppercase tracking-wide text-muted-foreground">Marks</th>
                                  <th className="p-3 text-center font-bold text-xs uppercase tracking-wide text-muted-foreground">%</th>
                                  <th className="p-3 text-center font-bold text-xs uppercase tracking-wide text-muted-foreground">Grade</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredEntries.map((e) => {
                                  const idx = entries.indexOf(e);
                                  // Withheld students sit in the snapshot as anonymous
                                  // placeholder rows — render them as an all-dash row at
                                  // their official rank. LEGACY rows (published before
                                  // placeholders existed) carry the real names/marks of
                                  // the withheld students; for those, legacyHiddenIdx
                                  // above marks the top 3 of every class (which covers
                                  // BOTH "Hide top 3" quick actions), and those rows
                                  // render as full dash rows — NOT with a dash badge
                                  // over a real name. Re-publishing the list scrubs
                                  // their data. Medals only when nobody is hidden.
                                  const dashRow =
                                    e.hidden || legacyHiddenIdx.has(idx);
                                  if (dashRow) {
                                    return (
                                      <tr
                                        key={`hidden-${e.position ?? idx}`}
                                        className="border-b border-border/50"
                                        title="Hidden by the school — revealed at the official announcement"
                                      >
                                        <td className="p-3 text-center">
                                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-black bg-muted text-muted-foreground/60">—</span>
                                        </td>
                                        {isMultiClassScope(selectedList.scope) && (
                                          <td className="p-3 text-center text-xs text-muted-foreground/60">—</td>
                                        )}
                                        <td className="p-3 font-mono text-xs text-muted-foreground/60">—</td>
                                        <td className="p-3">
                                          <div className="flex items-center gap-2.5 min-w-[140px]">
                                            <span className="w-8 h-8 rounded-full border-2 border-dashed border-border bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground/60 shrink-0">—</span>
                                            <span className="text-sm font-semibold text-muted-foreground/60">—</span>
                                          </div>
                                        </td>
                                        <td className="p-3 text-center text-xs text-muted-foreground/60 tabular-nums">—</td>
                                        <td className="p-3 text-center font-black text-sm tabular-nums text-muted-foreground/60">—</td>
                                        <td className="p-3 text-center">
                                          <span className="text-[10px] font-bold bg-muted text-muted-foreground/60 px-2.5 py-1 rounded-full border border-border">—</span>
                                        </td>
                                      </tr>
                                    );
                                  }
                                  const isTop3 = idx < 3 && !stats.hasHidden;
                                  return (
                                    <tr
                                      key={`${e.student_id}-${idx}`}
                                      className={`border-b border-border/50 transition-colors ${
                                        isTop3
                                          ? idx === 0 ? "bg-amber-50/70 dark:bg-amber-500/10"
                                          : idx === 1 ? "bg-slate-50 dark:bg-slate-500/10"
                                          : "bg-amber-50/70 dark:bg-amber-600/10"
                                          : "hover:bg-muted/30"
                                      }`}
                                    >
                                      <td className="p-3 text-center">
                                        <span
                                          className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-black shadow-sm ${
                                            isTop3
                                              ? idx === 0 ? "bg-gradient-to-br from-amber-400 to-yellow-500 text-white"
                                              : idx === 1 ? "bg-gradient-to-br from-slate-300 to-slate-500 text-white"
                                              : "bg-gradient-to-br from-amber-500 to-amber-600 text-white"
                                              : "bg-muted text-muted-foreground font-bold"
                                          }`}
                                        >
                                          {isTop3 ? ["🥇", "🥈", "🥉"][idx] : e.position || idx + 1}
                                        </span>
                                      </td>
                                      {isMultiClassScope(selectedList.scope) && (
                                        <td className="p-3 text-center">
                                          <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-1 rounded-full">{e.class}</span>
                                        </td>
                                      )}
                                      <td className="p-3 font-mono text-xs text-muted-foreground">{e.roll_number}</td>
                                      <td className="p-3">
                                        <div className="flex items-center gap-2.5 min-w-[140px]">
                                          <MeritAvatar photoUrl={e.photo_url} fullName={e.full_name} size="w-8 h-8" />
                                          <span className="text-sm font-semibold text-foreground">{e.full_name}</span>
                                        </div>
                                      </td>
                                      <td className="p-3 text-center text-xs text-muted-foreground tabular-nums">{e.obtained_marks}/{e.total_marks}</td>
                                      <td className="p-3 text-center font-black text-sm tabular-nums text-foreground">
                                        {Number(e.percentage).toFixed(1)}%
                                      </td>
                                      <td className="p-3 text-center">
                                        <span className="text-[10px] font-bold bg-secondary text-secondary-foreground px-2.5 py-1 rounded-full border border-border">
                                          {e.grade}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {filteredEntries.length === 0 && (
                                  <tr>
                                    <td colSpan={isMultiClassScope(selectedList.scope) ? 7 : 6} className="p-8 text-center text-sm text-muted-foreground">
                                      No students match "{search}".
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  /* ── Selected list is still scheduled — big countdown panel ── */
                  selectedList.publish_at && (
                    <motion.div
                      variants={fadeUp}
                      initial="hidden"
                      animate="visible"
                      className="relative overflow-hidden rounded-3xl border-2 border-gold/40 bg-gradient-to-br from-gold/10 via-card to-gold/5 p-8 text-center shadow-elevated"
                    >
                      <div className="orb orb-gold w-56 h-56 -top-20 left-1/2 -translate-x-1/2 opacity-60" />
                      <div className="relative">
                        {(() => {
                          const target = new Date(selectedList.publish_at!);
                          const diff = target.getTime() - now.getTime();
                          const days = Math.floor(diff / 86400000);
                          const hours = Math.floor((diff % 86400000) / 3600000);
                          const mins = Math.floor((diff % 3600000) / 60000);
                          const secs = Math.floor((diff % 60000) / 1000);
                          return (
                            <>
                              {/* Clock hands show the REAL current time-of-day,
                                  ticking normally toward the target time — not
                                  the remaining countdown duration (which isn't
                                  a valid clock reading, e.g. there's no "17
                                  o'clock"). The digits below still show the
                                  remaining duration. */}
                              <span className="w-16 h-16 mx-auto mb-5 flex items-center justify-center"><RealisticClockIcon className="w-14 h-14" hours={now.getHours()} minutes={now.getMinutes()} seconds={now.getSeconds()} /></span>
                              <p className="text-xs md:text-sm font-black uppercase tracking-[0.2em] text-amber-700 dark:text-amber-500 mb-2">
                                Time Remaining
                              </p>
                              <div className="flex justify-center items-baseline gap-3 flex-wrap mb-3">
                                {days > 0 && <CountdownUnit value={days} label="d" />}
                                <CountdownUnit value={hours} label="h" />
                                <CountdownUnit value={mins} label="m" />
                                <CountdownUnit value={secs} label="s" />
                              </div>
                            </>
                          );
                        })()}
                        <h2 className="text-lg md:text-xl font-heading font-bold text-foreground mt-4">{listTitle(selectedList)}</h2>
                        <p className="text-xs text-muted-foreground mt-1">{listMeta(selectedList)}</p>
                        <p className="text-xs text-muted-foreground mt-4 mb-1 font-medium">
                          Goes live {format(new Date(selectedList.publish_at), "EEEE, dd MMMM yyyy 'at' h:mm a")}
                        </p>
                        {selectedList.notes && (
                          <p className="text-xs text-muted-foreground mt-6 italic max-w-md mx-auto">"{selectedList.notes}"</p>
                        )}
                      </div>
                    </motion.div>
                  )
                )
              )}
            </div>
          )}
        </div>
      </section>
    </div>
    </PageLayout>
  );
};

export default MeritListPage;

