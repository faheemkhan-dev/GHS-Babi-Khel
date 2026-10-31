// ── Client-side auto-publish trigger ────────────────────────────────────────
// Fires the INSTANT any visitor's countdown reaches zero — instead of waiting
// for the Vercel Cron's next scheduled tick. Safe to call from any browser:
// it can only flip rows whose `publish_at` has ALREADY passed, so calling it
// early, repeatedly, or from an unauthenticated client does nothing harmful.
//
// TWO-PATH PUBLISH (fixes "Publishing now… then nothing happens"):
//   1. Serverless endpoint — POST /api/auto-publish-results. Uses the
//      Supabase service role key if SUPABASE_SERVICE_ROLE_KEY is set on
//      Vercel, which bypasses RLS and works for anonymous visitors. If that
//      env var is NOT set, the endpoint falls back to the anon key, which
//      RLS blocks from UPDATE-ing `results` — so it returns
//      published_count=0 and publishes nothing.
//   2. Direct supabase UPDATE from the browser — runs whenever path #1
//      published 0 rows. Uses the current visitor's supabase session, so it
//      works for any authenticated admin (RLS allows admin UPDATE on
//      results). For anonymous visitors it silently updates 0 rows (no
//      harm). This is the path that actually publishes the result when an
//      admin has the /results page open — even if the serverless function
//      isn't configured with a service role key.
let autoPublishInFlight = false;
async function triggerAutoPublish(): Promise<boolean> {
  if (autoPublishInFlight) return false;
  autoPublishInFlight = true;
  try {
    // ── Path 1: serverless endpoint ──
    let publishedCount = 0;
    try {
      const r = await fetch("/api/auto-publish-results", { method: "POST" });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (data?.ok) publishedCount = data.published_count ?? 0;
      }
    } catch { /* network error — fall through to direct update */ }

    // ── Path 2: direct browser UPDATE (fallback when #1 published 0) ──
    // Same narrow filter as the serverless endpoint: only rows whose
    // publish_at is in the past AND is_published is still false get
    // flipped. Safe to run from any browser.
    if (publishedCount === 0) {
      const nowIso = new Date().toISOString();
      const { data: updated, error } = await supabase
        .from("results")
        .update({ is_published: true, publish_at: null })
        .eq("is_published", false)
        .not("publish_at", "is", null)
        .lte("publish_at", nowIso)
        .select("id");
      if (!error && Array.isArray(updated)) {
        publishedCount = updated.length;
      }
    }

    return publishedCount > 0;
  } catch {
    return false;
  } finally {
    autoPublishInFlight = false;
  }
}

// ── Hook: fetch upcoming scheduled result publish times ────────────────────────
//
// IMPORTANT: when admin clicks "All Classes At Once" in AdminResults.tsx, the
// SAME `publish_at` timestamp is written to every class's results row for
// that exam_type+year. Previously this hook deduplicated by
// `class-exam_type-year`, so a single "All Classes" schedule produced 5
// separate countdown cards (Class 6, 7, 8, 9, 10) all showing the exact same
// ticking time — looking like 5 different schedules. We now dedupe by
// `publish_at` value itself, and aggregate every class that shares that
// publish_at into ONE card. The card then reads
// "All Classes (6, 7, 8, 9, 10) — <exam_type> <year>" instead of repeating
// the countdown 5 times.
function useScheduledPublishes() {
  return useQuery({
    queryKey: ["scheduled-result-publishes"],
    queryFn: async () => {
      // Phase 5: cached public read (s-maxage 30 s) — the schedule query that
      // used to run per visitor now costs one DB read per half-minute for the
      // whole school. After a publish, markPublishBust forces a fresh read.
      const data = await cachedOrDirect<
        { class: string; exam_type: string; year: number; publish_at: string }[]
      >("result-schedule", {}, async () => {
        const now = new Date().toISOString();
        const { data } = await supabase
          .from("results")
          .select("class, exam_type, year, publish_at")
          .eq("is_published", false)
          .not("publish_at", "is", null)
          .gt("publish_at", now)
          .order("publish_at", { ascending: true });
        return (data ?? []) as { class: string; exam_type: string; year: number; publish_at: string }[];
      });

      // Group rows by `publish_at` value — every row that shares the same
      // scheduled timestamp belongs to one countdown card. Within each group,
      // collect the unique (exam_type, year) and the sorted list of classes.
      type Group = {
        publish_at: string;
        exam_type: string;
        year: number;
        classes: string[];
      };
      const byPublishAt = new Map<string, Group>();
      for (const r of (data ?? [])) {
        const key = r.publish_at;
        if (!byPublishAt.has(key)) {
          byPublishAt.set(key, {
            publish_at: r.publish_at,
            exam_type: r.exam_type,
            year: r.year,
            classes: [r.class],
          });
        } else {
          const g = byPublishAt.get(key)!;
          // Keep the first row's exam_type/year as the label (they should
          // all match since scheduling is always scoped to one exam_type+year).
          if (!g.classes.includes(r.class)) g.classes.push(r.class);
        }
      }

      // Sort each group's classes numerically (on a COPY — never mutate the
      // array in place with .sort(), which corrupts React Query's cached
      // data and can cause subtle re-render bugs) and return groups in
      // publish_at ascending order so the soonest-publishing card appears
      // first.
      return Array.from(byPublishAt.values())
        .map(g => ({
          ...g,
          classes: [...g.classes].sort((a, b) => Number(a) - Number(b)),
        }))
        .sort((a, b) => a.publish_at.localeCompare(b.publish_at));
    },
    // Belt-and-braces fallback in case the countdown-triggered publish (below) doesn't fire
    // (throttled tab, etc.). ADAPTIVE: while a publish is actually pending → every 60 s;
    // when nothing is scheduled → every 5 min (was a blind 30 s poll, all day, for every visitor).
    // Hidden tabs never poll; focus/navigation still refetches.
    refetchInterval: (query) => ((query.state.data as unknown[] | undefined)?.length ? 60 * 1000 : 5 * 60 * 1000),
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
  });
}

// ── Hook: watches every active schedule and fires the publish trigger the
// moment ANY of them reaches zero. Mounted once near the top of the Results
// page (and separately on the homepage) so publishing happens as soon as
// possible regardless of which page a visitor happens to be on.
//
// OPTIMIZED: Uses adaptive interval - checks every 500ms when within 10 seconds
// of publish time for near-instant response, otherwise every 2 seconds.
function useAutoPublishWatcher() {
  const { data: scheduled = [] } = useScheduledPublishes();
  const qc = useQueryClient();
  // Precision publish (see src/lib/autoPublish.ts): syncs to the server
  // clock, pre-warms the function, and has the server publish at exactly
  // 00:00:00 — then flips the caches instantly instead of waiting a refetch.
  const key = scheduled.map(x => x.publish_at).join("|");
  useEffect(() => {
    if (!key) return;
    return armAutoPublish(key.split("|"), qc);
  }, [key, qc]);
}

// ── Realistic countdown clock icon (layered SVG, not a flat glyph) ───────
// Same design used on the Merit List countdown for visual consistency.
// IMPORTANT: hours/minutes/seconds here must be the REAL wall-clock time
// the hands should point at (e.g. the actual target announcement time,
// like 3:00:00 PM) — NOT the remaining countdown duration. A duration
// like "17h 38m" is not a valid clock reading (there's no 17 o'clock);
// passing it in made the hands land on nonsense positions. Callers pass
// real hour-of-day / minute / second values instead.
function RealisticClockIcon({ className = "w-8 h-8", hours = 0, minutes = 0, seconds = 0 }: { className?: string; hours?: number; minutes?: number; seconds?: number }) {
  // Standard analog clock hand geometry, driven by real time-of-day.
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
        <linearGradient id="resultClockFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFDF5" />
          <stop offset="100%" stopColor="#F3E9C7" />
        </linearGradient>
        <linearGradient id="resultClockRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4C550" />
          <stop offset="100%" stopColor="#C6912A" />
        </linearGradient>
      </defs>
      {/* Bells */}
      <circle cx="16" cy="10" r="5.5" fill="url(#resultClockRim)" />
      <circle cx="48" cy="10" r="5.5" fill="url(#resultClockRim)" />
      {/* Legs */}
      <rect x="22" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      <rect x="37.5" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      {/* Outer rim */}
      <circle cx="32" cy="34" r="24" fill="url(#resultClockRim)" />
      {/* Face */}
      <circle cx="32" cy="34" r="19.5" fill="url(#resultClockFace)" stroke="#C6912A" strokeWidth="1.5" />
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

// ── Countdown timer for a single scheduled publish ─────────────────────────────
// REDESIGNED: Big, bold RED countdown matching reference design.
// Shows large HHh MMm SSs format with "TIME REMAINING" label.
function CountdownCard({ item }: { item: { publish_at: string; exam_type: string; year: number; classes: string[] } }) {
  const [timeLeft, setTimeLeft] = useState<{ h: number; m: number; s: number; d: number; isDue: boolean }>({ h: 0, m: 0, s: 0, d: 0, isDue: false });
  // Live "now" tick — used to derive the REAL current time-of-day for the
  // analog clock hands, separate from timeLeft (which is the remaining
  // duration used for the digital HHh MMm SSs readout). The clock face
  // must show what a real clock reads right now, ticking normally toward
  // the target time (e.g. 3:00:00 PM) — not the countdown duration.
  const [now, setNow] = useState(() => new Date());

  // PERF: parse the target ONCE per schedule (memoised) instead of on every
  // tick — `new Date(item.publish_at)` used to run twice per 250 ms tick,
  // and the formatted announcement date was rebuilt on every render.
  const targetTs = useMemo(() => {
    const t = new Date(item.publish_at).getTime();
    return Number.isFinite(t) ? t : null;
  }, [item.publish_at]);
  const formattedDate = useMemo(() => {
    if (targetTs == null) return String(item.publish_at ?? "");
    return new Date(targetTs).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [targetTs, item.publish_at]);

  useEffect(() => {
    if (targetTs == null) { setTimeLeft({ h: 0, m: 0, s: 0, d: 0, isDue: true }); return; }
    const calc = () => {
      const diff = targetTs - serverNow();
      setNow(new Date(serverNow()));
      if (diff <= 0) { setTimeLeft(prev => ({ ...prev, isDue: true })); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ d, h, m, s, isDue: false });
    };
    calc();
    void syncServerClock().then(calc);
    // PERF (2026-10 CPU fix): this used to tick every 250 ms — 4 re-renders
    // per second per countdown card (each re-parsing the target date and
    // re-rendering the whole card + the infinite breathing animation below).
    // The readout shows WHOLE SECONDS and the analog second hand moves once
    // per second, so 1 Hz is pixel-identical to what a human can perceive
    // while cutting this card's render work by 75%.
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [targetTs]);

  // If only one class is scheduled, show "Class N — exam year".
  // If multiple classes share the same publish_at, show
  // "All Classes (6, 7, 8, 9, 10) — exam year" so it's clear this is ONE
  // schedule, not five separate ones.
  const classLabel = item.classes.length > 1
    ? `All Classes (${item.classes.join(", ")})`
    : `Class ${item.classes[0]}`;

  const PAD = (n: number) => String(n).padStart(2, '0');

  // Slow, cinematic breathing zoom for the entire countdown — subtle in/out
  // scale, not a hard blink — active any time a countdown is running.
  const isRunning = !timeLeft.isDue;

  // When due, show publishing state
  if (timeLeft.isDue) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-6 sm:p-8 text-center border border-gray-200 dark:border-gray-700">
        <div className="mb-3">
          <p className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-1">
            {classLabel} — {resultTermLabel(item.exam_type)} {item.year}
          </p>
        </div>
        <div className="animate-pulse">
          <p className="text-2xl sm:text-3xl font-black text-green-600 dark:text-green-400">
            🎉 Publishing Now...
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Results will appear in seconds!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-xl p-8 sm:p-12 text-center border border-gray-200 dark:border-gray-700 overflow-hidden relative">
      {/* Realistic clock icon */}
      <div className="flex justify-center mb-4">
        <RealisticClockIcon className="w-16 h-16 sm:w-20 sm:h-20" hours={now.getHours()} minutes={now.getMinutes()} seconds={now.getSeconds()} />
      </div>

      {/* Result Title */}
      <h3 className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400 mb-4">
        Result {resultTermLabel(item.exam_type)} {item.year}
      </h3>
      
      {/* TIME REMAINING Label */}
      <p className="text-base sm:text-lg font-bold text-green-600 dark:text-green-400 tracking-wide uppercase mb-4">
        Time Remaining
      </p>
      
      {/* BIG RED COUNTDOWN NUMBERS — slow cinematic breathing zoom for the
          whole countdown; a calm, professional pulse, not a jarring blink. */}
      <motion.div
        className="flex items-center justify-center gap-3 sm:gap-4 mb-5"
        animate={isRunning ? { scale: [1, 1.055, 1] } : { scale: 1 }}
        transition={isRunning ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        {timeLeft.d > 0 && (
          <div className="flex flex-col items-center">
            <span className="text-4xl sm:text-6xl md:text-7xl font-black text-red-600 dark:text-red-500 tabular-nums">
              {PAD(timeLeft.d)}<span className="text-xl sm:text-3xl md:text-4xl">d</span>
            </span>
          </div>
        )}
        <div className="flex flex-col items-center">
          <span className="text-4xl sm:text-6xl md:text-7xl font-black text-red-600 dark:text-red-500 tabular-nums">
            {PAD(timeLeft.h)}<span className="text-xl sm:text-3xl md:text-4xl">h</span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-4xl sm:text-6xl md:text-7xl font-black text-red-600 dark:text-red-500 tabular-nums">
            {PAD(timeLeft.m)}<span className="text-xl sm:text-3xl md:text-4xl">m</span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-4xl sm:text-6xl md:text-7xl font-black text-red-600 dark:text-red-500 tabular-nums">
            {PAD(timeLeft.s)}<span className="text-xl sm:text-3xl md:text-4xl">s</span>
          </span>
        </div>
      </motion.div>
      
      {/* Announcement Date */}
      <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400">
        Announced on {formattedDate}
      </p>
    </div>
  );
}

// ── Banner shown above results when some are pending publish ──────────────────
// REDESIGNED: Clean layout without extra header - just shows the countdown card
function ScheduledResultsBanner() {
  const { data: scheduled = [] } = useScheduledPublishes();
  if (!scheduled.length) return null;
  return (
    <div className="mb-6 space-y-4">
      {scheduled.map((item, i) => (
        <CountdownCard key={`${item.publish_at}-${i}`} item={item} />
      ))}
    </div>
  );
}

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { Search, Trophy, ExternalLink, AlertCircle, Share2, Hash, RotateCcw, ShieldCheck, Zap, Lock } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { supabase } from "@/lib/supabase";
import { useTypingPresence } from "@/hooks/useTypingPresence";
import { cachedOrDirect } from "@/lib/publicData";
import { withRetry } from "@/lib/retrySupabase";
import { armAutoPublish, serverNow, syncServerClock, isPublishConfirmed, catchUpDuePublishes } from "@/lib/autoPublish";

// ── fetch() retry for the BISE Peshawar proxy call ──────────────────────────
// A raw fetch() to /api/bisep-proxy has no retry of its own — on a slow or
// flaky mobile connection, a single dropped packet or gateway hiccup used to
// fall straight through to the catch block, showing "No Result Found" even
// though the student genuinely has a result. This gives it 2 short retries
// (fast — this is a foreground search a student is actively waiting on)
// before giving up for real.
async function fetchWithRetryFn(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      // Treat gateway/server errors as retryable too — not just network
      // failures — since Vercel cold-starts can surface as a 502/504.
      if (resp.ok || (resp.status < 500 && resp.status !== 429)) return resp;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Loader2, FileText } from "lucide-react";
// Report Card bulk-result generator (password-gated, opens modal)
import ReportCardButton from "@/components/ReportCard";
import toast from "react-hot-toast";
// AI Summary card removed from the results UI per site-owner request.
// SEO content section — visible on-page FAQ + keyword-rich body copy.
// Renders BELOW the result search box, so the existing UX is untouched.
// Mirrors the JSON-LD stack defined in RouteSEOInjector.tsx for /results.
import ResultsSeoContent from "@/components/seo/ResultsSeoContent";
// Live BISEP exam title + countdown — replaces the old build-time
// VITE_BISEP_EXAM_TITLE env var. Polls /api/bisep-proxy?mode=current hourly.
import { useBisepCurrentExam, FALLBACK_TITLE } from "@/hooks/useBisepCurrentExam";
import { examTypeLabel } from "@/utils/examTypeLabel";
import { resultTermLabel, examTypeVariants } from "@/utils/examTerm";
// ── Beautiful shareable marks-card generator ────────────────────────────
// Turns any displayed result (school or BISE Peshawar) into a professional,
// school-branded PNG. Share hands it to the OS share sheet (WhatsApp etc.)
// with the homepage Results link in the caption; Save downloads the same
// PNG straight to the device.
import {
  shareSchoolResultCard,
  shareBiseResultCard,
  saveSchoolResultCard,
  saveBiseResultCard,
  saveResultCardNode,
  shareResultCardNode,
  shareComparisonCard,
  biseShareText,
  schoolShareText,
  toastShareOutcome,
} from "@/utils/shareResultCard";
// ── Result Reveal — cinematic confetti + sound moment on a fresh search ────
// Both school and BISE Peshawar results now go straight to the real full
// result card (no intermediate popup), so only the lightweight celebration
// pieces (confetti canvas + chime) are imported — see fireCelebration().
import {
  CelebrationCanvas,
  useRevealAudio,
  prefersReducedMotion,
  type CelebrationMode,
} from "@/components/results/ResultReveal";
import { Sparkles, Download, GitCompare, X, Users, TrendingUp, TrendingDown } from "lucide-react";

// ── BISE Peshawar live title (replaces the old static constant) ─────────────
// Previously: `const BISEP_EXAM_TITLE = import.meta.env.VITE_BISEP_EXAM_TITLE || "..."`
// — a build-time value that was always out of date vs. what BISEP was actually
// serving on cloud.bisep.edu.pk.
//
// Now: the `BiseResultSearch` component (below) calls `useBisepExamTitle()`
// to get the live title from BISEP's homepage, polled hourly. The
// `BISEP_PORTAL_URL` constant is unchanged.
//
// The old `BISEP_EXAM_TITLE` constant is kept as a thin alias to
// `FALLBACK_TITLE` so any other code that imported it still compiles,
// but the live UI uses the hook output.
const BISEP_EXAM_TITLE = FALLBACK_TITLE;
/* ═══ PREMIUM SEARCH UI (shared by BISE + School result search) ═══════════ */
function ResultHeading({ title, live, resultLine = false }: { title: string; live?: boolean; resultLine?: boolean }) {
  return (
    <div className="text-center mb-4 sm:mb-8">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.22em] text-gold-strong dark:text-gold">
        <Trophy className="w-3 h-3" /> Official Result
      </span>
      <h2 className={`mt-3 font-heading font-bold leading-[1.2] tracking-tight text-foreground ${resultLine ? "text-[clamp(1.3rem,6.2vw,2.4rem)]" : "text-[1.6rem] sm:text-4xl"}`}>
        {!resultLine && <span className="sr-only">Result - </span>}
        <span className="block bg-gradient-to-r from-primary via-primary-light to-gold bg-clip-text text-transparent">
          {(() => {
            const words = title.trim().split(/\s+/);
            if (resultLine) {
              // School results: "Result - 2nd Semester 2026" on ONE line sized
              // to fit the phone; if it still can't fit, only the year drops
              // to the second line (term never splits: "2nd Semester" stays whole).
              const m = /^(.*?)\s+(\d{4})$/.exec(title.trim());
              const term = m ? m[1] : title.trim();
              return (
                <>
                  <span className="whitespace-nowrap">Result - {term}</span>
                  {m && <>{" "}<span className="whitespace-nowrap">{m[2]}</span></>}
                </>
              );
            }
            // BISE: line 1 = first two words, line 2 = the rest.
            const lines = words.length >= 3
              ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")]
              : [words.join(" ")];
            return lines.map((l, i) => <span key={i} className="block">{l}</span>);
          })()}
        </span>
      </h2>
      <div className="mt-4 flex items-center justify-center gap-2">
        <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/70" />
        <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
        <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/70" />
      </div>
      {live && (
        <div className="mt-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-200 pl-2.5 pr-3.5 py-1.5 text-xs sm:text-sm font-semibold shadow-sm">
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
              <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </span>
            BISE Peshawar result is LIVE
          </span>
        </div>
      )}
    </div>
  );
}

function PremiumSearchCard({
  value, onChange, onSearch, onReset, searching, hint, placeholder, autoFocus = false,
  mode, onModeChange, cls, onClsChange, hideModeTabs = false, modePending = false, classes,
}: {
  // Optional: when mode/onModeChange are passed (school results) the card
  // lets students search by Exam Roll No OR by Class + Class Roll No.
  mode?: "exam" | "class";
  onModeChange?: (m: "exam" | "class") => void;
  cls?: string;
  onClsChange?: (c: string) => void;
  hideModeTabs?: boolean;
  /** Classes that actually have published results (centered, only these shown). */
  classes?: string[];
  /** Mode (tabs vs exam-roll-only) not known yet → reserve space, paint nothing wrong. */
  modePending?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  onReset: () => void;
  searching: boolean;
  hint?: string | null;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const typing = useTypingPresence();
  // Exam Roll No (school or BISE Peshawar) = exactly 6 digits; Class Roll No = max 2 digits.
  const maxLen = mode === "class" ? 2 : 6;
  useEffect(() => { if (value.length > maxLen || /\D/.test(value)) onChange(value.replace(/\D/g, "").slice(0, maxLen)); }, [maxLen, value, onChange]);
  return (
    <div className="relative mb-8 mx-auto max-w-md rounded-2xl p-px bg-gradient-to-br from-gold/60 via-border to-primary/40 shadow-card">
      <div className="relative overflow-hidden rounded-[15px] bg-card px-4 py-4 sm:px-5 sm:py-5">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        {modePending && (
          <div className="h-[46px] mb-3 rounded-xl bg-muted/60 border border-border animate-pulse" aria-hidden="true" />
        )}

        {mode && onModeChange && !hideModeTabs && !modePending && (
          <div className="grid grid-cols-2 gap-1 p-1 mb-3 rounded-xl bg-muted/60 border border-border" role="tablist" aria-label="Search by">
            {([["exam", "Exam Roll No"], ["class", "Class + Roll No"]] as const).map(([m, label]) => (
              <button
                key={m} type="button" role="tab" aria-selected={mode === m}
                onClick={() => onModeChange(m)}
                className={`h-9 rounded-lg text-[13px] font-semibold transition-all ${
                  mode === m ? "bg-card text-foreground shadow-sm border border-gold/40" : "text-muted-foreground"}`}
              >{label}</button>
            ))}
          </div>
        )}

        {mode === "class" && onClsChange && !modePending && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-foreground mb-1.5 text-center">Your Class</p>
            <div className="flex justify-center gap-2">
              {(classes && classes.length ? classes : ["6", "7", "8", "9", "10"]).map(c => (
                <button
                  key={c} type="button" onClick={() => onClsChange(c)} aria-pressed={cls === c}
                  className={`h-9 w-9 shrink-0 rounded-md border text-sm font-semibold transition-all active:scale-[0.97] ${
                    cls === c ? "gradient-hero text-white border-gold/50 shadow-sm" : "bg-background text-foreground border-border"}`}
                >{c}</button>
              ))}
            </div>
          </div>
        )}

        <label htmlFor="result-roll-input" className="flex items-center gap-2 text-sm font-semibold text-foreground mb-2">
          <Hash className="w-3.5 h-3.5 text-gold-strong dark:text-gold" />
          {mode === "class" ? "Class Roll No" : mode === "exam" ? "Exam Roll No" : "Roll No"}
        </label>

        <input
          id="result-roll-input"
          value={value}
          onChange={e => { onChange(e.target.value.replace(/\D/g, "").slice(0, maxLen)); typing.engage(); }}
          onFocus={typing.engage}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder={placeholder}
          inputMode="numeric"
          pattern="\d*"
          maxLength={maxLen}
          autoComplete="off"
          autoFocus={autoFocus}
          className="block w-full h-10 px-3.5 rounded-lg border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/60 text-[15px] leading-none font-mono font-medium tracking-[0.12em] focus:outline-none focus:border-gold focus:bg-background focus:ring-2 focus:ring-gold/25 transition-all"
        />

        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button
            onClick={onReset}
            className="h-9 px-4 rounded-lg border border-border bg-background text-foreground text-[13px] font-medium inline-flex items-center justify-center gap-1.5 hover:border-gold/60 active:scale-[0.97] transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            onClick={onSearch}
            disabled={searching}
            className="h-9 min-w-0 rounded-lg gradient-hero text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 border border-gold/40 shadow-sm active:scale-[0.98] transition-all disabled:opacity-70"
          >
            {searching ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /><span className="truncate">{hint || "Searching..."}</span></>
            ) : (
              <><Search className="w-3.5 h-3.5 text-gold" />Search Result</>
            )}
          </button>
        </div>

        {/* Live "people are typing…" (Facebook style) — reserves its height so the card never jumps */}
        <div className="mt-3 flex h-5 items-center justify-center" aria-live="polite">
          {typing.engaged && typing.count > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <span>{typing.count >= 99 ? "99+" : typing.count} {typing.count === 1 ? "person is" : "people are"} typing</span>
              <span className="inline-flex items-end gap-[3px] pb-[1px]" aria-hidden="true">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="h-1 w-1 rounded-full bg-gold-strong dark:bg-gold animate-bounce"
                    style={{ animationDelay: `${i * 150}ms`, animationDuration: "1s" }}
                  />
                ))}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


const BISEP_PORTAL_URL = "https://cloud.bisep.edu.pk/";



// ── Inline Result Card Search ──────────────────────────────────────────────────
// This mirrors `ResultCardTab.tsx` (the User Dashboard → Results → Result Card
// tab) exactly, so the homepage Result Card behaves the same way:
//   • Subject-wise marks with progress bars
//   • Fallback exam_roll_no lookup via exam_roll_sessions + exam_roll_numbers
//   • Client-side class position (#N) — admin never persists the column
//   • Client-side whole-school rank (Trophy badge) — scoped per exam_type
// Previously this homepage variant showed only the totals row, never the
// per-subject breakdown, and never computed rank/position — so the two
// "Result Card" surfaces disagreed. They now match.
interface SubjectMark { obtained: number; total: number; }
interface RCResult {
  id: string;
  student_id: string;
  class: string;
  exam_type: string;
  year: number;
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  grade: string | null;
  is_pass: boolean;
  remarks: string | null;
  exam_roll_no: string | null;
  position: number | null;
  subject_marks: Record<string, SubjectMark> | null;
  students: { full_name: string; roll_number: string; father_name: string | null; photo_url: string | null; class: string; } | null;
  total_students?: number | null;
  // Whole-school rank for the same exam_type + year (not just class rank).
  // Computed client-side because admin never persists this column.
  school_rank?: number | null;
  // Number of ranked students in the whole-school pool (the "/50" in #2/50).
  school_total?: number | null;
}

// Whole-school rank pools ALL published classes together for a given
// exam_type + year — e.g. if admin publishes classes 6,7,8,9,10 at once,
// rank #1 is the single best percentage across all of them, not split into
// a separate 6-8 pool and a separate 9-10 pool. (Previously split via
// RC_CLASSES_BY_EXAM_TYPE, causing rank to look "wrong" when all classes
// were published together — fixed per request.)
const RC_ALL_CLASSES = ["6", "7", "8", "9", "10"];

const gradeFromPct = (pct: number) => {
  if (pct >= 90) return "A+"; if (pct >= 80) return "A";
  if (pct >= 60) return "B"; if (pct >= 45) return "C";
  if (pct >= 33) return "D"; return "Fail";
};

// NOTE: buildDMC() and the "Download DMC as PDF" button were removed from
// ResultCardSearch — the public Result Card is view-only (non-downloadable).
// The standalone /result-card page was removed from the site.

// ── Latest published exam (for the page title before any search) ──────────────
// Mirrors ResultCardTab.tsx: shows which exam's results are currently
// available, e.g. "Result - Final Semester 2026", even before a search.
function useLatestPublishedExam() {
  return useQuery({
    queryKey: ["latest-published-exam"],
    queryFn: async () =>
      // Phase 5: cached (s-maxage 60 s) with the identical direct query as fallback.
      cachedOrDirect<{ exam_type: string; year: number; created_at: string } | null>(
        "latest-exam",
        {},
        async () => {
          const { data, error } = await supabase
            .from("results")
            .select("exam_type, year, created_at")
            .eq("is_published", true)
            .order("year", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(1);
          if (error) throw error;
          return data?.[0] ?? null;
        },
      ),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Exam-roll-only mode ─────────────────────────────────────────────────────
// When EVERY published result of the latest exam carries an Exam Roll No, the
// school is running in exam-roll mode (admin imported with "Use Exam Roll
// Numbers"). The public search then shows only the Exam Roll No option.
function useExamRollOnly(exam: { exam_type: string; year: number } | null | undefined) {
  const { data, isError } = useQuery({
    queryKey: ["exam-roll-only", exam?.exam_type, exam?.year],
    enabled: !!exam,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const base = () => supabase.from("results").select("id", { count: "exact", head: true })
        .eq("is_published", true).in("exam_type", examTypeVariants(exam!.exam_type)).eq("year", exam!.year);
      const [all, missing] = await Promise.all([base(), base().is("exam_roll_no", null)]);
      if (all.error || missing.error) return false;
      return (all.count ?? 0) > 0 && (missing.count ?? 0) === 0;
    },
  });
  // `ready` = the answer is known (seeded by the publish response, restored
  // from cache, or fetched). Until then the search card reserves the tab row
  // as a skeleton instead of painting tabs that may vanish a moment later.
  return { examRollOnly: data === true, examRollReady: data !== undefined || isError };
}

// ── Search shape for the latest published exam ───────────────────────────────
// Decides which search option(s) the public box shows, from the data itself:
//   • every row has an Exam Roll No  → "exam"  (Exam Roll No only)
//   • no row has an Exam Roll No     → "class" (Class + Class Roll No only)
//   • mixed                          → "both"  (tabs)
// `classes` = only the classes that actually have published results.
type SearchMeta = { mode: "exam" | "class" | "both"; classes: string[] };
function useResultSearchMeta(exam: { exam_type: string; year: number } | null | undefined) {
  const { data, isError } = useQuery({
    queryKey: ["result-search-meta", exam?.exam_type, exam?.year],
    enabled: !!exam,
    staleTime: 2 * 60 * 1000,
    queryFn: () => cachedOrDirect<SearchMeta>(
      "result-search-meta", { exam: exam!.exam_type, year: exam!.year },
      async (): Promise<SearchMeta> => {
        const { data, error } = await supabase.from("results").select("class,exam_roll_no")
          .eq("is_published", true).in("exam_type", examTypeVariants(exam!.exam_type)).eq("year", exam!.year).limit(2000);
        if (error) throw error;
        const rows = data ?? [];
        const withRoll = rows.filter(r => r.exam_roll_no && String(r.exam_roll_no).trim()).length;
        const classes = Array.from(new Set(rows.map(r => String(r.class ?? "").trim()).filter(Boolean)))
          .sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
        const mode: SearchMeta["mode"] = rows.length === 0 ? "both" : withRoll === rows.length ? "exam" : withRoll === 0 ? "class" : "both";
        return { mode, classes };
      },
    ),
  });
  return { meta: data, metaReady: data !== undefined || isError };
}

// ── Premium rank / position stat cell ───────────────────────────────────────
// Shows "#2" big with the pool size small beside it ("/50"). Top-3 finishers
// get a gold / silver / bronze tint. Falls back to "—" when not ranked.
function RankStat({ label, icon, value, total }: { label: string; icon?: React.ReactNode; value: number | null | undefined; total?: number | null }) {
  const tone =
    value === 1 ? "text-amber-600 dark:text-amber-400"
    : value === 2 ? "text-slate-600 dark:text-slate-300"
    : value === 3 ? "text-orange-700 dark:text-orange-400"
    : "text-orange-600 dark:text-orange-400";
  return (
    <div className="flex flex-col items-center justify-center px-1.5 py-3 text-center">
      <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground font-semibold flex items-center justify-center gap-1 whitespace-nowrap leading-none">{icon}{label}</p>
      <p className={`mt-1.5 leading-none font-heading lining-nums tabular-nums whitespace-nowrap ${tone}`}>
        {value ? (
          <>
            <span className="text-base font-semibold">#{value}</span>
            {total ? <span className="ml-0.5 text-[10px] sm:text-xs font-bold text-muted-foreground">/{total}</span> : null}
          </>
        ) : (
          <span className="text-base font-extrabold text-muted-foreground/60">—</span>
        )}
      </p>
    </div>
  );
}

// ── Premium Share · Save · Compare action bar (used by School + BISE cards) ──
// Tall tap targets (≈72px) with icon chip above the label — easy on thumbs.
function ResultActionBar({
  onShare, onSave, onCompare, sharing, saving,
}: { onShare: () => void; onSave: () => void; onCompare: () => void; sharing: boolean; saving: boolean }) {
  // Slim 34px pills, one line each, themed to the green & gold result card.
  // No shadows / sheen overlays → cheap to paint on low-end phones.
  const base = "group inline-flex h-[34px] min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 font-heading text-[12px] font-semibold tracking-wide transition-transform duration-150 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50";
  return (
    <div className="grid grid-cols-3 gap-2">
      <button onClick={onShare} disabled={sharing} aria-label="Share result card"
        className={`${base} bg-gradient-to-r from-emerald-800 to-emerald-600 text-white ring-1 ring-inset ring-[#E3B341]/60`}>
        {sharing ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Share2 className="w-3.5 h-3.5 shrink-0 text-[#FDE68A]" />}
        <span>Share</span>
      </button>
      <button onClick={onSave} disabled={saving} aria-label="Save result card as image"
        className={`${base} border border-emerald-600/50 bg-card text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/10`}>
        {saving ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Download className="w-3.5 h-3.5 shrink-0" />}
        <span>Save</span>
      </button>
      <button onClick={onCompare} aria-label="Compare results"
        className={`${base} border border-[#E3B341]/70 bg-[#E3B341]/10 text-[#8a6508] dark:text-[#E3B341] hover:bg-[#E3B341]/20`}>
        <GitCompare className="w-3.5 h-3.5 shrink-0" />
        <span>Compare</span>
      </button>
    </div>
  );
}

// ── Traffic protection (school result search) ─────────────────────────────
// 1) Rank pools are cached 5 min and shared by every search in this tab, so a
//    flood of searches costs ONE rank query per class/year, not one per search.
// 2) Identical in-flight lookups are de-duplicated.
// 3) Per-browser burst limiter (8 searches / 60 s) stops accidental spam loops
//    and naive scripts. Normal users never notice it.
// ── Rank pools must include HELD-BACK toppers ────────────────────────────────
// With "Hide top 3 of each class" the toppers stay unpublished; a pool built
// from published rows only would rank the 4th student as #1. A pool is every
// row of each class+exam+year group that has at least one published row (a
// class that is not published at all stays out). Mirrors the server-side
// `result-rank` kind in api/public-data.js — this is its direct fallback.
type RankPoolRow = { id: string; student_id: string; percentage: number; created_at: string };
function rankPoolFromRows(
  rows: (RankPoolRow & { is_published: boolean; class: string; exam_type: string; year: number })[],
): RankPoolRow[] {
  const live = new Set<string>();
  for (const r of rows) if (r.is_published) live.add(`${r.class}|${r.exam_type}|${r.year}`);
  return rows
    .filter((r) => live.has(`${r.class}|${r.exam_type}|${r.year}`))
    .map(({ id, student_id, percentage, created_at }) => ({ id, student_id, percentage, created_at }));
}
const RANK_TTL_MS = 5 * 60 * 1000;
const rankCache = new Map<string, { t: number; p: Promise<any> }>();
function cachedRankFetch(key: string, fn: () => PromiseLike<any>): Promise<any> {
  const hit = rankCache.get(key);
  if (hit && Date.now() - hit.t < RANK_TTL_MS) return hit.p;
  const p = Promise.resolve(fn()).then(
    (r: any) => { if (r?.error) rankCache.delete(key); return r; },
    (e: unknown) => { rankCache.delete(key); throw e; },
  );
  rankCache.set(key, { t: Date.now(), p });
  return p;
}
const searchStamps: number[] = [];
/** Returns 0 when allowed, otherwise the seconds to wait. */
function searchAllowed(): number {
  const now = Date.now();
  while (searchStamps.length && now - searchStamps[0] > 60_000) searchStamps.shift();
  if (searchStamps.length >= 8) return Math.ceil((60_000 - (now - searchStamps[0])) / 1000);
  searchStamps.push(now);
  return 0;
}

// ── Rank pool fetchers (shared by the search AND the idle prewarm) ────────
// Extracted to module scope so the exact same cachedOrDirect + withRetry
// path serves both callers — a prewarmed pool is byte-identical to the one
// the search would fetch, so the first search hits the 5-minute in-memory
// cache instead of the network.
// Supabase caps every response at 1000 rows, so a big pool fetched in one go
// was silently truncated and some students were missing from it (→ "—").
async function fetchAllPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await withRetry(() => page(from, from + 999));
    if (error) throw error;
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

async function fetchClassRankPool(cls: string, examType: string, year: number): Promise<RankPoolRow[]> {
  return cachedOrDirect<RankPoolRow[]>(
    "result-rank",
    { scope: "class", class: cls, exam: examType, year },
    async () => {
      const rows = await fetchAllPages((from, to) => supabase
        .from("results")
        .select("id,student_id,percentage,created_at,is_published,class,exam_type,year")
        .eq("class", cls)
        .eq("exam_type", examType)
        .eq("year", year)
        .order("id")
        .range(from, to));
      return rankPoolFromRows(rows as Parameters<typeof rankPoolFromRows>[0]);
    },
  );
}

async function fetchSchoolRankPool(year: number): Promise<RankPoolRow[]> {
  return cachedOrDirect<RankPoolRow[]>(
    "result-rank",
    { scope: "school", year },
    async () => {
      const rows = await fetchAllPages((from, to) => supabase
        .from("results")
        .select("id,student_id,percentage,created_at,is_published,class,exam_type,year")
        .eq("year", year)
        .in("class", RC_ALL_CLASSES)
        .order("id")
        .range(from, to));
      return rankPoolFromRows(rows as Parameters<typeof rankPoolFromRows>[0]);
    },
  );
}

// Dedupe by HIGHEST percentage per student, sort desc, assign tie-aware
// ranks. Shared by the class-position pool and the whole-school pool (the
// two used to carry duplicate copies of this exact logic).
function buildRankMap(list: RankPoolRow[]): { rankMap: Map<string, number>; total: number } {
  const seen = new Map<string, RankPoolRow>();
  for (const r of list) {
    // Keep the row with the HIGHEST percentage per student. Ties (same
    // percentage) keep whichever was seen first — doesn't matter for
    // ranking because both get the same sort key.
    const k = r.student_id ?? r.id;
    if (!seen.has(k) || r.percentage > seen.get(k)!.percentage) {
      seen.set(k, { ...r, student_id: k });
    }
  }
  const deduped = Array.from(seen.values()).sort((a, b) => b.percentage - a.percentage);
  const rankMap = new Map<string, number>();
  deduped.forEach((r, i) => rankMap.set(r.student_id, i > 0 && r.percentage === deduped[i - 1].percentage ? (rankMap.get(deduped[i - 1].student_id) as number) : i + 1));
  return { rankMap, total: deduped.length };
}

// ── Rank + Position for the searched rows ───────────────────────────────────
// FAST PATH: one tiny RPC (get_result_ranks, migration 18) ranks inside
// Postgres and returns one row per result. FALLBACK (RPC not installed yet /
// failed): the paginated client-side pools, so a card never regresses.
//   Position = within the student's class · Rank = across all uploaded classes
async function attachRanks(rows: RCResult[]): Promise<RCResult[]> {
  if (rows.length === 0) return rows;
  try {
    const { data, error } = await withRetry(() =>
      supabase.rpc("get_result_ranks", { p_result_ids: rows.map(r => r.id) }), { attempts: 2, baseDelayMs: 300 });
    if (error) throw error;
    const byId = new Map<string, { class_position: number | null; class_total: number | null; school_rank: number | null; school_total: number | null }>();
    for (const x of (data ?? []) as { result_id: string; class_position: number | null; class_total: number | null; school_rank: number | null; school_total: number | null }[]) byId.set(x.result_id, x);
    return rows.map(r => {
      const x = byId.get(r.id);
      return { ...r, position: x?.class_position ?? null, total_students: x?.class_total ?? null, school_rank: x?.school_rank ?? null, school_total: x?.school_total ?? null };
    });
  } catch {
    return attachRanksFallback(rows);
  }
}

async function attachRanksFallback(rows: RCResult[]): Promise<RCResult[]> {
  const groups = Array.from(new Set(rows.map(r => `${r.class}|${r.exam_type}|${r.year}`)));
  const years = Array.from(new Set(rows.map(r => String(r.year))));
  const classMaps: Record<string, { rank: Map<string, number>; total: number }> = {};
  const schoolMaps: Record<string, { rank: Map<string, number>; total: number }> = {};
  await Promise.all([
    ...groups.map(async (g) => {
      const [cls, examType, year] = g.split("|");
      try {
        const pool = await cachedRankFetch(`cls|${g}`, () => fetchClassRankPool(cls, examType, Number(year)));
        const { rankMap, total } = buildRankMap(pool || []);
        classMaps[g] = { rank: rankMap, total };
      } catch { /* leave empty → shows dash only if truly unavailable */ }
    }),
    ...years.map(async (y) => {
      try {
        const pool = await cachedRankFetch(`school|${y}`, () => fetchSchoolRankPool(Number(y)));
        const { rankMap, total } = buildRankMap(pool || []);
        schoolMaps[y] = { rank: rankMap, total };
      } catch { /* same */ }
    }),
  ]);
  return rows.map(r => {
    const c = classMaps[`${r.class}|${r.exam_type}|${r.year}`];
    const s = schoolMaps[String(r.year)];
    const k = r.student_id ?? r.id;
    return { ...r, position: c?.rank.get(k) ?? null, total_students: c?.total ?? null, school_rank: s?.rank.get(k) ?? null, school_total: s?.total ?? null };
  });
}

// Fill a blank exam_roll_no from exam_roll_numbers. Only THIS student's rows
// are fetched (the old code downloaded every roll number of the session).
async function fillMissingExamRolls(rows: RCResult[]): Promise<RCResult[]> {
  const missing = rows.filter(r => !r.exam_roll_no && r.student_id && r.class);
  if (missing.length === 0) return rows;
  try {
    const years = Array.from(new Set(missing.map(r => r.year)));
    const terms = Array.from(new Set(missing.map(r => r.exam_type)));
    const ids = Array.from(new Set(missing.map(r => r.student_id)));
    const [{ data: sessions }, { data: rolls }] = await Promise.all([
      withRetry(() => supabase.from("exam_roll_sessions").select("id, exam_year, exam_term").in("exam_year", years).in("exam_term", terms)),
      withRetry(() => supabase.from("exam_roll_numbers").select("student_id, class, exam_roll_no, session_id").in("student_id", ids)),
    ]);
    if (!sessions?.length || !rolls?.length) return rows;
    const keyOf = new Map(sessions.map(s => [s.id, `${s.exam_year}|${s.exam_term}`]));
    return rows.map(r => {
      if (r.exam_roll_no) return r;
      const key = `${r.year}|${r.exam_type}`;
      const match =
        rolls.find(rl => rl.student_id === r.student_id && rl.class === r.class && keyOf.get(rl.session_id) === key) ??
        rolls.find(rl => rl.student_id === r.student_id && keyOf.get(rl.session_id) === key);
      return match ? { ...r, exam_roll_no: match.exam_roll_no } : r;
    });
  } catch {
    return rows;
  }
}

interface SchoolResultCardProps {
  result: RCResult;
  onShare: (result: RCResult) => void;
  onSave: (result: RCResult) => void;
  onCompare: (result: RCResult) => void;
  sharing: boolean;
  saving: boolean;
}

// PERF (keystroke re-render fix): memoised. The parent re-renders on every
// keystroke in the roll-number field (it owns the input state); without
// memo, each keystroke re-rendered up to 10 full result cards — every
// subject table row, every animated bar — for nothing. With stable
// callbacks from the parent (see useCallback in ResultCardSearch) the
// cards now render exactly once per search.
const SchoolResultCard = React.memo(function SchoolResultCard({ result: r, onShare, onSave, onCompare, sharing, saving }: SchoolResultCardProps) {
  const subjectEntries = Object.entries(r.subject_marks ?? {}).filter(
    ([, mark]) => mark && typeof mark.obtained === "number" && typeof mark.total === "number" && !(mark.obtained === 0 && mark.total === 0)
  );
  const grade = r.grade || gradeFromPct(r.percentage);
  const rollNumber = r.exam_roll_no || r.students?.roll_number || "—";
  return (
    <div id={`school-result-card-${r.id}`} className="w-full bg-card rounded-2xl shadow-elevated overflow-hidden border border-border">
      <div className="result-hero-blue relative overflow-hidden px-4 py-4 text-center text-white">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
        <p className="font-heading text-[9px] font-medium uppercase tracking-[0.3em] text-[#FDE68A]">Official Result</p>
        <h3 className="mt-1 font-heading text-lg font-semibold leading-tight tracking-wide">Student Result Details</h3>
        <div className="mx-auto mt-2 flex items-center justify-center gap-2">
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#E3B341]" />
          <span className="h-1 w-1 rotate-45 bg-[#E3B341]" />
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-[#E3B341]" />
        </div>
        <p className="mt-2">
          <span className="inline-block max-w-full rounded-full border border-white/25 bg-white/15 px-3 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] leading-tight">
            {examTypeLabel(r.exam_type)} {r.year} · GHS Babi Khel
          </span>
        </p>
      </div>
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="h-px w-6 shrink-0 bg-gradient-to-r from-transparent to-[#E3B341]" />
          <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] whitespace-nowrap text-[#B8860B] dark:text-[#E3B341]">Candidate Information</p>
          <span className="h-px w-6 shrink-0 bg-gradient-to-l from-transparent to-[#E3B341]" />
        </div>
        <div className="relative rounded-xl border border-border bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-2.5">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
          <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Student Name:</p>
          <p className="mt-0.5 text-center font-heading text-lg font-semibold leading-snug text-emerald-900 dark:text-emerald-200 break-words">{r.students?.full_name || "—"}</p>
          <div className="my-1.5 h-px bg-gradient-to-r from-transparent via-[#E3B341]/60 to-transparent" />
          <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Father Name:</p>
          <p className="mt-0.5 text-center font-heading text-sm font-medium leading-snug text-foreground break-words">{r.students?.father_name || "—"}</p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { l: "Roll Number", v: String(rollNumber), cls: "text-foreground" },
            { l: "Marks", v: `${r.obtained_marks} / ${r.total_marks}`, cls: "text-orange-600 dark:text-orange-400" },
            { l: "Percentage", v: `${Number(r.percentage ?? 0).toFixed(2)}%`, cls: r.is_pass ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400" },
            { l: "Grade", v: String(grade), cls: "text-[#B8860B] dark:text-[#E3B341]" },
          ].map((t) => (
            <div key={t.l} className="rounded-lg border border-border bg-secondary/30 px-2 py-2 text-center min-w-0">
              <p className="text-[8.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t.l}</p>
              <p className={`mt-0.5 font-heading text-[15px] font-semibold leading-tight lining-nums tabular-nums break-words ${t.cls}`}>{t.v}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg border border-dashed border-[#E3B341]/60 bg-[#E3B341]/10 px-3 py-2">
          <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Remarks:</p>
          <p className="mt-0.5 text-center font-heading text-xs italic font-medium leading-snug text-foreground break-words">{r.remarks || (r.is_pass ? "Passed" : "Needs improvement")}</p>
        </div>
      </div>
      {subjectEntries.length > 0 ? (
        <div className="px-4 py-4">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="h-px w-6 shrink-0 bg-gradient-to-r from-transparent to-[#E3B341]" />
            <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] whitespace-nowrap text-[#B8860B] dark:text-[#E3B341]">Subject Wise Marks</p>
            <span className="h-px w-6 shrink-0 bg-gradient-to-l from-transparent to-[#E3B341]" />
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full table-fixed text-center">
              <colgroup>
                <col style={{ width: "9%" }} />
                <col style={{ width: "33%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "18%" }} />
              </colgroup>
              <thead>
                <tr className="bg-emerald-800 text-white text-[8.5px] uppercase tracking-[0.06em]">
                  <th className="py-2 px-1 font-medium text-center">#</th>
                  <th className="py-2 px-1 font-medium text-center">Subject</th>
                  <th className="py-2 px-1 font-medium text-center">Bar</th>
                  <th className="py-2 px-1 font-medium text-center">Obtained</th>
                  <th className="py-2 px-1 font-medium text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {subjectEntries.map(([subject, mark], i) => {
                  const pct = mark.total > 0 ? Math.min(100, (mark.obtained / mark.total) * 100) : null;
                  const fail = pct !== null && pct < 33;
                  return (
                    <tr key={subject} className={`${i % 2 === 1 ? "bg-secondary/30" : ""} ${i !== 0 ? "border-t border-border" : ""}`}>
                      <td className="py-2 px-1 text-center text-[11px] text-muted-foreground lining-nums tabular-nums">{i + 1}</td>
                      <td className="py-2 px-1 text-center font-heading text-[13px] font-medium leading-tight text-foreground break-words">{subject || "—"}</td>
                      <td className="py-2 px-1 align-middle"><SubjectBar pct={pct} fail={fail} delay={0.04 * i} /></td>
                      <td className="py-2 px-1 text-center">
                        <span className={`inline-block rounded-full px-2 py-px font-heading text-[13px] font-semibold lining-nums tabular-nums ${fail ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{mark.obtained}</span>
                      </td>
                      <td className="py-2 px-1 text-center font-heading text-[13px] text-muted-foreground lining-nums tabular-nums">{mark.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="px-5 py-4 border-b border-border">
          <p className="text-xs text-muted-foreground text-center bg-secondary/40 rounded-lg py-3">Subject-wise marks not available for this result.</p>
        </div>
      )}
      <div className="grid grid-cols-3 items-stretch divide-x divide-border border-t border-b border-border bg-secondary/20">
        <RankStat label="Rank" icon={<Trophy className="w-3 h-3 text-orange-500" />} value={r.school_rank} total={r.school_total} />
        <RankStat label="Position" value={r.position} total={r.total_students} />
        <div className="flex flex-col items-center justify-center px-1.5 py-3 text-center">
          <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground font-semibold whitespace-nowrap leading-none">Result</p>
          <p className={`mt-1.5 leading-none font-heading text-base font-semibold ${r.is_pass ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{r.is_pass ? "PASS" : "FAIL"}</p>
        </div>
      </div>
      <div data-capture-exclude="true" className="border-t border-[#E3B341]/40 bg-secondary/20 px-4 py-3">
        <ResultActionBar onShare={() => onShare(r)} onSave={() => onSave(r)} onCompare={() => onCompare(r)} sharing={sharing} saving={saving} />
      </div>
    </div>
  );
});

// ── Pure share/save helpers (module scope) ─────────────────────────────────
// These depend only on their argument + imports, so they live at module
// scope: the search component's useCallback handlers below can then keep
// stable identities across renders, which is what makes the memoised
// SchoolResultCard actually skip re-renders while the student types.
function buildSchoolShareData(r: RCResult) {
  return {
    studentName: r.students?.full_name || "Student",
    className: String(r.class),
    examLabel: `${examTypeLabel(r.exam_type)} ${r.year}`,
    rollNo: r.exam_roll_no || r.students?.roll_number || "—",
    totalMarks: r.total_marks,
    obtainedMarks: r.obtained_marks,
    percentage: r.percentage,
    grade: r.grade || gradeFromPct(r.percentage),
    isPass: r.is_pass,
    schoolRank: r.school_rank ?? null,
    schoolRankTotal: r.school_total ?? null,
    classPosition: r.position ?? null,
    classPositionTotal: r.total_students ?? null,
    subjects: Object.entries(r.subject_marks ?? {})
      .filter(([, m]) => m && typeof m.obtained === "number" && typeof m.total === "number" && !(m.obtained === 0 && m.total === 0))
      .map(([name, m]) => ({ name, obtained: m.obtained, total: m.total })),
    photoUrl: r.students?.photo_url ?? null,
  };
}
const schoolCardNode = (r: RCResult) => document.getElementById(`school-result-card-${r.id}`);
const schoolFileName = (r: RCResult) =>
  `GHS-Result-${String(r.exam_roll_no || r.students?.roll_number || "Result").replace(/[^a-zA-Z0-9]+/g, "-")}.png`;

const ResultCardSearch = () => {
  // useSchoolSettings / school object removed — they were only used by the
  // DMC download button, which has been removed so the public homepage
  // Result Card is view-only (non-downloadable).
  const [searchRoll, setSearchRoll] = useState("");
  // "exam" = Exam Roll No (school-wide unique). "class" = Class + Class Roll
  // No — works even when no exam roll number was issued, and never mixes up
  // Class 6 roll 1 with Class 7 roll 1 because the class is part of the key.
  const [searchMode, setSearchMode] = useState<"exam" | "class">("exam");
  const [searchClass, setSearchClass] = useState("6");
  const [searched, setSearched]     = useState(false);
  const [searching, setSearching]   = useState(false);
  const [rcResults, setRcResults]   = useState<RCResult[]>([]);
  const { data: latestExam, isLoading: latestLoading } = useLatestPublishedExam();
  const { meta: searchMeta, metaReady } = useResultSearchMeta(latestExam);
  // Effective mode: forced by the data when all/no rows carry an Exam Roll No.
  const effMode: "exam" | "class" = searchMeta?.mode === "exam" ? "exam" : searchMeta?.mode === "class" ? "class" : searchMode;
  const examRollOnly = searchMeta?.mode === "exam";
  const classOptions = searchMeta?.classes ?? [];
  useEffect(() => {
    if (classOptions.length && !classOptions.includes(searchClass)) setSearchClass(classOptions[0]);
  }, [classOptions.join(","), searchClass]);

  // ── Share Result — generates a beautiful school-branded marks-card image
  // and hands it to the OS share sheet (WhatsApp etc.). The caption always
  // carries the website's homepage Results link.
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  // The school result whose card's Compare button was tapped — becomes side A
  // of the comparison (no fetch needed for it).
  const [compareTarget, setCompareTarget] = useState<RCResult | null>(null);
  // After a successful search the student lands directly ON the full result
  // card (the old popup summary was removed).
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  // ── Celebration (school results) — same CPU-cheap single-canvas confetti
  // burst (pass) / calm sparkle drift (fail) + soft chime as BISE Peshawar,
  // fired once over the real card when a fresh result comes back.
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [celebrateMode, setCelebrateMode] = useState<CelebrationMode | null>(null);
  const { play: playCelebration, prime: primeCelebration } = useRevealAudio();
  const fireCelebration = (isPass: boolean) => {
    if (prefersReducedMotion()) return;
    primeCelebration();
    window.setTimeout(() => playCelebration("thump"), 120);
    window.setTimeout(() => {
      playCelebration("tada");
      setCelebrateKey(k => k + 1);
      setCelebrateMode(isPass ? "gold" : "calm");
    }, 260);
  };

  // (buildSchoolShareData / schoolCardNode / schoolFileName now live at
  // module scope — pure functions — so the handlers below can keep stable
  // identities and the memoised SchoolResultCard skips re-renders while
  // the student types.)

  // ── Share Result — screenshot of the REAL on-screen result card (exactly
  // what the student sees, in the new design), same as BISE. Falls back to the
  // hand-drawn canvas card only if the screenshot fails.
  const handleShareResult = useCallback(async (r: RCResult) => {
    setSharingId(r.id);
    const data = buildSchoolShareData(r);
    let outcome = await shareResultCardNode(schoolCardNode(r), {
      fileName: schoolFileName(r),
      title: "Result — GHS Babi Khel",
      text: schoolShareText(data),
    });
    if (outcome === "failed") outcome = await shareSchoolResultCard(data);
    toastShareOutcome(outcome);
    setSharingId(null);
  }, []);

  // ── Save Result — same screenshot, saved straight to the device.
  const handleSaveResult = useCallback(async (r: RCResult) => {
    setSavingId(r.id);
    let outcome = await saveResultCardNode(schoolCardNode(r), schoolFileName(r));
    if (outcome === "failed") outcome = await saveSchoolResultCard(buildSchoolShareData(r));
    toastShareOutcome(outcome);
    setSavingId(null);
  }, []);

  // Stable identity for every card's Compare button (the old inline arrow
  // broke SchoolResultCard's memo on each parent render).
  const openComparison = useCallback((result: RCResult) => {
    setCompareTarget(result);
    setComparisonOpen(true);
  }, []);

  const handleReset = () => {
    setSearchRoll("");
    setSearched(false);
    setRcResults([]);
    setCelebrateMode(null);
  };

  const handleSearch = async () => {
    if (!searchRoll.trim()) { toast.error(effMode === "class" ? "Enter your class roll number" : "Enter your exam roll number"); return; }
    if (searching) return;
    if (effMode === "class" ? !/^\d{1,2}$/.test(searchRoll.trim()) : !/^\d{6}$/.test(searchRoll.trim())) {
      toast.error(effMode === "class" ? "Class roll number must be 1–2 digits" : "Exam roll number must be exactly 6 digits"); return;
    }
    const wait = searchAllowed();
    if (wait > 0) { toast.error(`Too many searches — please wait ${wait}s and try again.`); return; }
    setSearching(true); setSearched(false);

    try {
      const isClassMode = effMode === "class";
      // FAST PATH — the whole search (student + marks + Rank + Position) in ONE
      // database call with a hard 8 s cap, so it can never sit on "Searching…".
      let rows: RCResult[] = [];
      let fastOk = false;
      try {
        const { data: fd, error: fe } = await supabase
          .rpc("search_result_card", { p_mode: isClassMode ? "class" : "exam", p_roll: searchRoll.trim(), p_class: isClassMode ? searchClass : null })
          .abortSignal(AbortSignal.timeout(8000));
        if (!fe && Array.isArray(fd)) { rows = fd as unknown as RCResult[]; fastOk = true; }
      } catch { /* fall through to the classic path */ }
      if (fastOk && isClassMode && rows.length > 1 && new Set(rows.map(r => r.student_id)).size > 1) {
        rows = rows.filter(r => r.student_id === rows[0].student_id);
        toast("More than one student has this roll no. Use your Exam Roll No to be sure.", { icon: "ℹ️" });
      }
      if (!fastOk) {
      const cols = "id,student_id,class,exam_type,year,total_marks,obtained_marks,percentage,grade,is_pass,remarks,exam_roll_no,position,subject_marks";
      const studentCols = "full_name,roll_number,father_name,photo_url,class";
      const base = supabase.from("results")
        .select(isClassMode ? `${cols},students!inner(${studentCols})` : `${cols},students(${studentCols})`)
        .eq("is_published", true);
      const query = (isClassMode
        ? base.eq("class", searchClass).eq("students.roll_number", searchRoll.trim())
        : base.eq("exam_roll_no", searchRoll.trim())
      ).order("year", { ascending: false });

      const { data, error } = await withRetry(() => query.limit(10));
      if (error) throw error;
      rows = (data ?? []) as unknown as RCResult[];

      // Class + Roll mode: if two different students ever share the same
      // class roll no, never show one child's result to another — keep only
      // the newest student's rows and tell them to use the Exam Roll No.
      if (isClassMode && rows.length > 0) {
        const ids = Array.from(new Set(rows.map(r => r.student_id)));
        if (ids.length > 1) {
          rows = rows.filter(r => r.student_id === rows[0].student_id);
          toast("More than one student has this roll no. Use your Exam Roll No to be sure.", { icon: "ℹ️" });
        }
      }

      // Rank/Position and the exam-roll fallback are independent → run them
      // together (one round trip of latency instead of two or three).
      const [rankedRows, rollFilled] = await Promise.all([
        attachRanks(rows),
        fillMissingExamRolls(rows),
      ]);
      rows = rankedRows.map((r, i) => ({ ...r, exam_roll_no: rollFilled[i].exam_roll_no }));

      }

      setRcResults(rows);
      // Straight to the full report card — scroll it into view + celebrate.
      if (rows.length > 0) {
        fireCelebration(!!rows[0].is_pass);
        setTimeout(() => {
          resultsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 250);
      }
    } catch { toast.error("Search failed. Try again."); }

    setSearched(true); setSearching(false);
  };

  return (
    <div>
      <ResultHeading
        resultLine={rcResults.length > 0 || !!latestExam}
        title={
          rcResults.length > 0
            ? `${resultTermLabel(rcResults[0].exam_type)} ${rcResults[0].year}`
            : latestExam
              ? `${resultTermLabel(latestExam.exam_type)} ${latestExam.year}`
              : "Result"
        }
      />

      <PremiumSearchCard
        value={searchRoll}
        onChange={setSearchRoll}
        onSearch={handleSearch}
        onReset={handleReset}
        searching={searching}
        placeholder={effMode === "class" ? "e.g. 12" : "e.g. 123456"}
        mode={effMode}
        hideModeTabs={searchMeta?.mode !== "both"}
        classes={classOptions}
        modePending={latestLoading || (!!latestExam && !metaReady)}
        onModeChange={(m) => { setSearchMode(m); setSearchRoll(""); }}
        cls={searchClass}
        onClsChange={setSearchClass}
      />

      <AnimatePresence>
        {searched && (
          <motion.div ref={resultsAnchorRef} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {rcResults.length === 0 ? (
              <div className="bg-card rounded-2xl p-8 text-center shadow-card border border-border">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-heading font-semibold text-foreground">No Result Found</h3>
                <p className="text-sm text-muted-foreground mt-1">Check your exam roll number. Results must be added by admin.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground font-medium">
                  Found {rcResults.length} result{rcResults.length > 1 ? "s" : ""}
                </p>
                {rcResults.map(r => (
                  <motion.div key={r.id} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                  <SchoolResultCard
                    result={r}
                    onShare={handleShareResult}
                    onSave={handleSaveResult}
                    onCompare={openComparison}
                    sharing={sharingId === r.id}
                    saving={savingId === r.id}
                  />
                  </motion.div>
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confetti / sparkle canvas — reduced-motion aware, auto-clears. */}
      {celebrateMode && <CelebrationCanvas key={celebrateKey} mode={celebrateMode} />}
      <ComparisonModal
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        examTitle={compareTarget ? `${examTypeLabel(compareTarget.exam_type)} ${compareTarget.year}` : BISEP_EXAM_TITLE}
        schoolCurrent={compareTarget}
        currentRoll={compareTarget ? (compareTarget.exam_roll_no || (effMode === "exam" ? searchRoll.trim() : undefined)) : undefined}
      />
    </div>
  );
};

// ── Result Comparison — roll number vs roll number (+ class average) ────────
// Two inputs (Roll No · Vs · Roll No). BISE mode fetches both from the board;
// school mode looks both up in the school's published results and ALSO pulls
// the CLASS AVERAGE (aggregate-only RPC, so hidden top-3 results still count
// toward the average without ever being exposed).
//
// ONE unified view — no duplicate chart + table: headline cards, a verdict,
// then a single per-subject list where each subject shows two progress bars
// (one per student) with a tick marking the class average.
// Normalised view of one side of the duel — built from a BISE marksheet OR a
// school result row, so the same comparison UI + share card serves both.
type CmpSide = {
  name: string;
  grade: string;
  marks: string;
  pct: number | null;
  subjects: { name: string; ob: number | null; max: number | null; fail?: boolean }[];
  cls?: string; // school mode only
  failed?: boolean; // failed overall (any failed paper / is_pass false)
};
type ComparisonSlot = {
  roll: string;
  state: "idle" | "loading" | "found" | "not-found" | "error";
  result: BiseResult | null;
  // School mode: the resolved school result for this side.
  side?: CmpSide | null;
  message: string | null;
};

function schoolToSide(r: RCResult): CmpSide {
  const subjects = Object.entries(r.subject_marks ?? {})
    .filter(([, m]) => m && typeof m === "object" && typeof m.obtained === "number" && typeof m.total === "number" && !(m.obtained === 0 && m.total === 0))
    // School pass mark is 33% — below it a paper is a fail (shown in red).
    .map(([name, m]) => ({ name, ob: m.obtained as number, max: m.total as number, fail: (m.total as number) > 0 && (m.obtained as number) / (m.total as number) < 0.33 }));
  return {
    name: r.students?.full_name || "Student",
    grade: r.grade || gradeFromPct(r.percentage),
    marks: `${r.obtained_marks}/${r.total_marks}`,
    pct: typeof r.percentage === "number" ? Math.round(r.percentage * 10) / 10 : null,
    subjects,
    cls: r.class,
    failed: r.is_pass === false || subjects.some(sj => sj.fail),
  };
}

// ── Class average (aggregate-only) ──────────────────────────────────────────
type ClassAvg = {
  n: number;
  pct: number;
  passRate: number | null;
  subjects: Map<string, { ob: number; max: number }>;
};
const subjKey = (s: string) => s.trim().toLowerCase();
const fmtDelta = (n: number) => `${n > 0.049 ? "+" : n < -0.049 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

// Calls get_class_exam_average (see Supabase/Migration/08_class_average_rpc.sql).
// Shared 5-min cache + in-flight de-dupe via cachedRankFetch, so opening the
// modal repeatedly or comparing many pairs costs one request per class.
// Fails soft: any error / missing function / tiny class → null → the modal
// simply hides the class-average parts.
async function fetchClassAverage(cls: string, exam: { exam_type: string; year: number }): Promise<ClassAvg | null> {
  try {
    // Phase 5: the class-average RPC is cached at the edge (30 s) under the
    // 5-min in-memory cache — a whole class comparing results shares one RPC.
    // The { data, error } shape below is preserved for the existing checks.
    const { data, error } = await cachedRankFetch(`avg|${cls}|${exam.exam_type}|${exam.year}`, async () => {
      try {
        const result = await cachedOrDirect<any>(
          "class-average",
          { class: cls, exam: exam.exam_type, year: exam.year },
          async () => {
            const { data, error } = await withRetry(() => (supabase as any).rpc("get_class_exam_average", { p_class: cls, p_exam_type: exam.exam_type, p_year: exam.year }));
            if (error) throw error;
            return data ?? null;
          },
        );
        return { data: result ?? null, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    });
    if (error || !data || typeof data.pct !== "number" || !(data.n >= 1)) return null;
    const subjects = new Map<string, { ob: number; max: number }>();
    for (const [k, v] of Object.entries((data.subjects ?? {}) as Record<string, any>)) {
      const ob = Number(v?.ob), max = Number(v?.max);
      if (Number.isFinite(ob) && Number.isFinite(max) && max > 0) subjects.set(subjKey(k), { ob, max });
    }
    return { n: Number(data.n), pct: Number(data.pct), passRate: data.pass_rate != null ? Number(data.pass_rate) : null, subjects };
  } catch {
    return null;
  }
}

// Looks up another student's PUBLISHED school result for the SAME exam
// (exam_type + year) by exam roll number. Falls back to the
// exam_roll_numbers table when the result row's own roll column is blank
// (same fallback the main search uses).
async function fetchSchoolSide(
  roll: string,
  exam: { exam_type: string; year: number },
): Promise<{ status: "found"; side: CmpSide } | { status: "not-found" | "error"; message: string }> {
  try {
    const cols = "id,student_id,class,exam_type,year,total_marks,obtained_marks,percentage,grade,is_pass,exam_roll_no,subject_marks,students(full_name,roll_number,class)";
    const { data, error } = await withRetry(() => supabase.from("results").select(cols)
      .eq("is_published", true).eq("exam_roll_no", roll)
      .eq("exam_type", exam.exam_type).eq("year", exam.year).limit(5));
    if (error) throw error;
    let rows = (data ?? []) as unknown as RCResult[];

    if (rows.length === 0) {
      const { data: sessions } = await withRetry(() => supabase.from("exam_roll_sessions")
        .select("id").eq("exam_year", exam.year).eq("exam_term", exam.exam_type));
      if (sessions?.length) {
        const { data: rolls } = await withRetry(() => supabase.from("exam_roll_numbers")
          .select("student_id").eq("exam_roll_no", roll).in("session_id", sessions.map(x => x.id)).limit(1));
        const sid = rolls?.[0]?.student_id;
        if (sid) {
          const { data: byStudent } = await withRetry(() => supabase.from("results").select(cols)
            .eq("is_published", true).eq("student_id", sid)
            .eq("exam_type", exam.exam_type).eq("year", exam.year).limit(5));
          rows = (byStudent ?? []) as unknown as RCResult[];
        }
      }
    }
    if (rows.length === 0) {
      return { status: "not-found", message: "No published result found for this roll number in this exam." };
    }
    const best = rows.reduce((m, r) => (r.percentage > m.percentage ? r : m), rows[0]);
    return { status: "found", side: schoolToSide(best) };
  } catch {
    return { status: "error", message: "Could not fetch this result. Try again." };
  }
}

function biseToSide(res: BiseResult, examTitle: string): CmpSide {
  const level = biseLevel(examTitle, res.subjects);
  return {
    name: res.name,
    grade: res.grade,
    marks: res.marks,
    pct: biseOverallPercent(res, examTitle),
    subjects: res.subjects.map(sj => ({
      name: sj.subject,
      ob: biseSubjectObtained(sj),
      max: biseSubjectMax(sj.subject, level),
      // The proxy flags papers the board prints in red (theory and/or practical).
      fail: sj.theory_fail === true || sj.practical_fail === true,
    })),
    failed: res.subjects.some(sj => sj.theory_fail === true || sj.practical_fail === true) || /fail/i.test(res.remarks || ""),
  };
}

const emptySlot = (): ComparisonSlot => ({ roll: "", state: "idle", result: null, message: null });

// One progress bar line: tag chip · track (fill + class-average tick) · value.
// Pure CSS (no chart library) so it stays light on low-end phones.
const CMP_COLORS = {
  a: { fill: "bg-emerald-700", chip: "bg-emerald-800 text-white" },
  b: { fill: "bg-[#C9962B]", chip: "bg-[#B8860B] text-white" },
} as const;

type CmpLineProps = {
  side: "a" | "b";
  value: number | null;       // obtained (or %, for the overall row)
  max: number | null;         // out of (100 for overall)
  avg: number | null;         // class average on the same scale
  win: boolean;
  fail?: boolean;             // failed paper → red bar + red marks
  suffix?: string;            // "%" for overall row
};
const CmpLine = React.memo(function CmpLine({ side, value, max, avg, win, fail, suffix }: CmpLineProps) {
  const c = CMP_COLORS[side];
  const w = value != null && max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const tick = avg != null && max ? Math.max(0, Math.min(100, (avg / max) * 100)) : null;
  const delta = value != null && avg != null ? value - avg : null;
  return (
    <div className="grid grid-cols-[1.25rem,1fr,auto] items-center gap-2">
      <span className={`w-5 h-5 rounded-md text-[10px] font-semibold flex items-center justify-center ${c.chip}`}>{side.toUpperCase()}</span>
      <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${fail ? "bg-red-500" : c.fill} transition-[width] duration-500 ease-out`} style={{ width: `${w}%` }} />
        {tick != null && <span className="absolute top-0 bottom-0 w-0.5 bg-foreground/70" style={{ left: `calc(${tick}% - 1px)` }} />}
      </div>
      <div className="min-w-[4.6rem] text-right leading-tight">
        <span className={`font-heading text-xs font-semibold lining-nums tabular-nums ${fail ? "text-red-600 dark:text-red-400" : win ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
          {value != null ? (suffix ? `${value}${suffix}` : max != null ? `${value}/${max}` : value) : "—"}
        </span>
        {delta != null && (
          <span className={`ml-1 text-[10px] font-semibold tabular-nums ${delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {fmtDelta(delta)}
          </span>
        )}
      </div>
    </div>
  );
});

type CmpRow = { name: string; obA: number | null; obB: number | null; max: number | null; avgA: number | null; avgB: number | null; failA: boolean; failB: boolean };

const ComparisonModal = ({
  open,
  onClose,
  examTitle,
  currentRoll,
  currentResult,
  schoolCurrent,
}: {
  open: boolean;
  onClose: () => void;
  examTitle: string;
  // v5 — BISE mode passes the result already displayed on the page. The
  // modal pre-fills side A with it, so the classic "compare me vs a
  // friend" flow needs to fetch only ONE roll from the board instead of
  // two (the board probabilistically 403s requests, so every request
  // saved doubles the reliability of the whole feature).
  currentRoll?: string;
  currentResult?: BiseResult | null;
  // School mode — the school result shown on the page. Side A is pre-filled
  // from it and side B is looked up from the school's own published results
  // (same exam), instead of the BISE board.
  schoolCurrent?: RCResult | null;
}) => {
  const isSchool = !!schoolCurrent;
  const [a, setA] = useState<ComparisonSlot>(emptySlot());
  const [b, setB] = useState<ComparisonSlot>(emptySlot());
  // True when slot A was pre-filled from the on-screen result (no fetch
  // needed). Cleared the moment the user edits the pre-filled roll.
  const [aPrefilled, setAPrefilled] = useState(false);
  const [sharingComparison, setSharingComparison] = useState(false);
  // Class averages by class ("8" → ClassAvg | null). `undefined` = loading.
  const [avgs, setAvgs] = useState<Record<string, ClassAvg | null | undefined>>({});

  // Reset to a clean slate every time the modal opens, so a stale
  // comparison from a previous open never lingers. When the page already
  // shows a BISE result, side A starts resolved from it (zero requests).
  useEffect(() => {
    if (!open) return;
    setAvgs({});
    if (schoolCurrent) {
      setA({ roll: (currentRoll || "").trim(), state: "found", result: null, side: schoolToSide(schoolCurrent), message: null });
      setAPrefilled(true);
      setB(emptySlot());
      return;
    }
    if (currentResult && currentRoll) {
      setA({ roll: currentRoll, state: "found", result: currentResult, message: null });
      setAPrefilled(true);
      setB(emptySlot());
    } else {
      setA(emptySlot());
      setB(emptySlot());
      setAPrefilled(false);
    }
  }, [open, currentRoll, currentResult, schoolCurrent]);

  const runComparison = async () => {
    const rollA = a.roll.trim();
    const rollB = b.roll.trim();
    if (!/^\d{4,10}$/.test(rollA) || !/^\d{4,10}$/.test(rollB)) {
      toast.error("Enter both roll numbers (4–10 digits)");
      return;
    }
    if (isSchool && schoolCurrent) {
      const sideA = schoolToSide(schoolCurrent);
      const aIsCurrent = aPrefilled && rollA === (currentRoll || "").trim();
      setB(s => ({ ...s, state: "loading", side: null, message: null }));
      let outA: Awaited<ReturnType<typeof fetchSchoolSide>> = { status: "found", side: sideA };
      // Side A (if edited) and side B are independent school lookups — run
      // them in parallel (school DB, unlike the board, has no rate trouble).
      if (!aIsCurrent) setA(s => ({ ...s, state: "loading", side: null, message: null }));
      const [resA, outB] = await Promise.all([
        aIsCurrent ? Promise.resolve(outA) : fetchSchoolSide(rollA, schoolCurrent),
        fetchSchoolSide(rollB, schoolCurrent),
      ]);
      outA = resA;
      if (!aIsCurrent) setA(s => ({ ...s, state: outA.status, side: outA.status === "found" ? outA.side : null, message: outA.status !== "found" ? outA.message : null }));
      setB(s => ({ ...s, state: outB.status, side: outB.status === "found" ? outB.side : null, message: outB.status !== "found" ? outB.message : null }));
      return;
    }
    const aResolved =
      aPrefilled && a.state === "found" && a.result &&
      rollA === (currentRoll || "").trim();
    if (!aResolved) {
      setA(s => ({ ...s, state: "loading", result: null, message: null }));
    }
    setB(s => ({ ...s, state: "loading", result: null, message: null }));

    // v5: SEQUENTIAL fetches (v4 fired both in parallel). Every lookup
    // counts against the same shared proxy IP, and the board rejects
    // requests probabilistically — fetching one after the other (each
    // with the proxy's spaced retries + device cache) is dramatically
    // more reliable than two simultaneous uncached lookups. Both sides
    // go through fetchBiseResult, so a roll already fetched anywhere on
    // this device is served from the cache instantly.
    let outcomeA: BiseFetchOutcome;
    if (aResolved) {
      outcomeA = { status: "found", result: a.result! };
    } else {
      outcomeA = await fetchBiseResult(rollA, { examKey: examTitle });
      setA(s => ({
        ...s,
        state: outcomeA.status,
        result: outcomeA.status === "found" ? outcomeA.result : null,
        message: outcomeA.status !== "found" ? outcomeA.message : null,
      }));
    }
    const outcomeB = await fetchBiseResult(rollB, { examKey: examTitle });

    setB(s => ({
      ...s,
      state: outcomeB.status,
      result: outcomeB.status === "found" ? outcomeB.result : null,
      message: outcomeB.status !== "found" ? outcomeB.message : null,
    }));
  };

  const busy = a.state === "loading" || b.state === "loading";
  // PERF: `biseToSide(...)` builds a fresh object per call — calling it inline
  // here (as before) gave sideA/sideB a NEW identity on every render, which
  // silently defeated the subjectRows useMemo below and re-ran the whole
  // subject-union computation on every parent render (including every
  // keystroke in the search box, since this modal stays mounted when closed).
  // Memoising on the actual inputs keeps the identities stable.
  const biseSideA = useMemo(
    () => (!isSchool && a.result ? biseToSide(a.result, examTitle) : null),
    [isSchool, a.result, examTitle],
  );
  const biseSideB = useMemo(
    () => (!isSchool && b.result ? biseToSide(b.result, examTitle) : null),
    [isSchool, b.result, examTitle],
  );
  const sideA: CmpSide | null = isSchool ? (a.side ?? null) : biseSideA;
  const sideB: CmpSide | null = isSchool ? (b.side ?? null) : biseSideB;
  const bothFound = a.state === "found" && b.state === "found" && !!sideA && !!sideB;
  const pctA = bothFound ? sideA!.pct : null;
  const pctB = bothFound ? sideB!.pct : null;
  const leader = pctA != null && pctB != null ? (pctA === pctB ? "tie" : pctA > pctB ? "a" : "b") : null;
  const diffPct = pctA != null && pctB != null ? Math.round(Math.abs(pctA - pctB) * 10) / 10 : null;
  const nameA = bothFound ? (sideA!.name || `Roll ${a.roll}`) : "";
  const nameB = bothFound ? (sideB!.name || `Roll ${b.roll}`) : "";

  // ── Class averages — fetched once both students are resolved. The exam
  // (type + year) is the one on screen; each student's own class is used, so
  // comparing students from different classes still works. ───────────────
  const clsA = bothFound ? sideA!.cls : undefined;
  const clsB = bothFound ? sideB!.cls : undefined;
  useEffect(() => {
    if (!isSchool || !schoolCurrent || !bothFound) return;
    const wanted = Array.from(new Set([clsA, clsB].filter(Boolean) as string[]));
    let cancelled = false;
    setAvgs(prev => {
      const next = { ...prev };
      for (const c of wanted) if (!(c in next)) next[c] = undefined;
      return next;
    });
    wanted.forEach(async (c) => {
      const v = await fetchClassAverage(c, schoolCurrent);
      if (!cancelled) setAvgs(prev => ({ ...prev, [c]: v }));
    });
    return () => { cancelled = true; };
  }, [isSchool, schoolCurrent, bothFound, clsA, clsB]);

  const avgA = clsA ? avgs[clsA] ?? null : null;
  const avgB = clsB ? avgs[clsB] ?? null : null;
  const avgLoading = isSchool && bothFound && ((!!clsA && avgs[clsA] === undefined) || (!!clsB && avgs[clsB] === undefined));
  const sameClass = !!clsA && clsA === clsB;

  // Union of subject names across both results, A's order first — every row
  // shows both sides even if one candidate is missing that paper. Class
  // average per subject is looked up by each student's own class.
  const subjectRows: CmpRow[] = useMemo(() => {
    if (!bothFound) return [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const sj of [...sideA!.subjects, ...sideB!.subjects]) {
      const key = subjKey(sj.name);
      if (!seen.has(key)) { seen.add(key); names.push(sj.name); }
    }
    return names.map(name => {
      const key = subjKey(name);
      const sa = sideA!.subjects.find(x => subjKey(x.name) === key);
      const sb = sideB!.subjects.find(x => subjKey(x.name) === key);
      const max = sa?.max ?? sb?.max ?? null;
      // Class average is stored out-of-max-X; rescale if this subject's max differs.
      const scale = (avg: ClassAvg | null, m: number | null) => {
        const v = avg?.subjects.get(key);
        if (!v || !m) return null;
        return Math.round(((v.ob / v.max) * m) * 10) / 10;
      };
      return { name, obA: sa ? sa.ob : null, obB: sb ? sb.ob : null, max, avgA: scale(avgA, sa?.max ?? max), avgB: scale(avgB, sb?.max ?? max), failA: sa?.fail === true, failB: sb?.fail === true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothFound, sideA, sideB, avgA, avgB]);

  // Subject-by-subject win tally.
  const tally = useMemo(() => subjectRows.reduce(
    (acc, row) => {
      if (row.obA != null && row.obB != null) {
        if (row.obA > row.obB) acc.a++;
        else if (row.obB > row.obA) acc.b++;
        else acc.tie++;
      }
      return acc;
    },
    { a: 0, b: 0, tie: 0 }
  ), [subjectRows]);
  const tallyTotal = tally.a + tally.b + tally.tie;

  const handleShareComparison = async () => {
    if (!bothFound) return;
    setSharingComparison(true);
    // v6 — shares a dedicated hand-drawn 1080px comparison card (see
    // buildComparisonCanvas in shareResultCard.ts) instead of a screenshot
    // of this modal.
    const outcome = await shareComparisonCard({
      examTitle,
      nameA,
      rollA: a.roll,
      pctA,
      gradeA: sideA!.grade,
      marksA: sideA!.marks,
      nameB,
      rollB: b.roll,
      pctB,
      gradeB: sideB!.grade,
      marksB: sideB!.marks,
      leadsA: tally.a,
      leadsB: tally.b,
      ties: tally.tie,
      subjects: subjectRows,
      source: isSchool ? "GHS Babi Khel" : "BISE Peshawar",
      failedA: sideA!.failed === true,
      failedB: sideB!.failed === true,
      classAvgA: avgA?.pct ?? null,
      classAvgB: avgB?.pct ?? null,
      classLabelA: clsA ? `Class ${clsA}` : undefined,
      classLabelB: clsB ? `Class ${clsB}` : undefined,
      classCount: avgA?.n ?? avgB?.n ?? null,
    });
    toastShareOutcome(outcome);
    setSharingComparison(false);
  };

  const cards = bothFound
    ? [
        { key: "a" as const, slot: a, side: sideA!, pct: pctA, isLeader: leader === "a", avg: avgA, name: nameA },
        { key: "b" as const, slot: b, side: sideB!, pct: pctB, isLeader: leader === "b", avg: avgB, name: nameB },
      ]
    : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] bg-black/60 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain"
          role="dialog" aria-modal="true" aria-label="Result comparison"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
            className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-lg my-4 sm:my-0 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header — same green & gold identity as the result card */}
            <div className="result-hero-blue relative px-4 py-3.5 text-white">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 shrink-0" aria-hidden="true" />
                <div className="min-w-0 text-center">
                  <p className="font-heading text-[9px] font-medium uppercase tracking-[0.3em] text-[#FDE68A]">Head to Head</p>
                  <h3 className="font-heading text-lg font-semibold leading-tight tracking-wide">Compare Results</h3>
                  <p className="mx-auto mt-1 max-w-full truncate rounded-full border border-white/25 bg-white/15 px-3 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em]">{examTitle} · {isSchool ? "GHS Babi Khel" : "BISE Peshawar"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {bothFound && (
                    <button onClick={handleShareComparison} disabled={sharingComparison} aria-label="Share comparison" title="Share comparison"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25 disabled:opacity-50">
                      {sharingComparison ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 text-[#FDE68A]" />}
                    </button>
                  )}
                  <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/25">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-3.5">
              {/* Roll number inputs — Roll No · Vs · Roll No */}
              <div className="grid grid-cols-[1fr,auto,1fr] items-end gap-2.5">
                <div>
                  <label className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    <span className="w-4 h-4 rounded bg-emerald-800 text-white text-[9px] font-semibold flex items-center justify-center">A</span> Roll No
                  </label>
                  <input
                    type="text" inputMode="numeric" value={a.roll}
                    onChange={e => {
                      setA(s => ({ ...s, roll: e.target.value.replace(/\D/g, "") }));
                      // Editing the pre-filled roll means side A must be
                      // re-fetched — drop the prefill flag.
                      if (aPrefilled) setAPrefilled(false);
                    }}
                    placeholder="e.g. 123456"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-center font-heading text-sm font-medium lining-nums tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
                <span className="mb-2.5 font-heading text-[11px] font-semibold tracking-widest text-[#B8860B] dark:text-[#E3B341]">VS</span>
                <div>
                  <label className="flex items-center gap-1 text-[9px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    <span className="w-4 h-4 rounded bg-[#B8860B] text-white text-[9px] font-semibold flex items-center justify-center">B</span> Roll No
                  </label>
                  <input
                    type="text" inputMode="numeric" value={b.roll}
                    onChange={e => setB(s => ({ ...s, roll: e.target.value.replace(/\D/g, "") }))}
                    placeholder="e.g. 654321"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-center font-heading text-sm font-medium lining-nums tracking-widest focus:outline-none focus:ring-2 focus:ring-[#E3B341]/50"
                  />
                </div>
              </div>

              <button
                onClick={runComparison}
                disabled={busy}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-emerald-800 to-emerald-600 font-heading text-sm font-semibold tracking-wide text-white ring-1 ring-inset ring-[#E3B341]/60 transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Fetching results…</> : <><Search className="w-4 h-4" /> Compare</>}
              </button>

              {/* Per-slot error/not-found messaging */}
              {(a.state === "not-found" || a.state === "error") && (
                <p className="text-xs text-red-600 dark:text-red-400 text-center">Roll {a.roll}: {a.message}</p>
              )}
              {(b.state === "not-found" || b.state === "error") && (
                <p className="text-xs text-red-600 dark:text-red-400 text-center">Roll {b.roll}: {b.message}</p>
              )}

              {/* ── Comparison results — ONE unified view ─────────────── */}
              {bothFound && (
                <div className="space-y-4">
                  {/* Student cards */}
                  <div className="grid grid-cols-2 gap-2.5">
                    {cards.map(c => {
                      const delta = c.pct != null && c.avg ? c.pct - c.avg.pct : null;
                      const failCount = c.side.subjects.filter(sj => sj.fail).length;
                      return (
                        <div key={c.key} className={`relative rounded-xl border px-2.5 py-3 text-center ${c.isLeader ? "border-[#E3B341]/70 bg-[#E3B341]/10" : "border-border bg-secondary/30"}`}>
                          <span className={`absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold ${CMP_COLORS[c.key].chip}`}>{c.key.toUpperCase()}</span>
                          {c.isLeader && <Trophy className="absolute top-2 right-2 h-4 w-4 text-[#B8860B] dark:text-[#E3B341]" aria-label="Leading" />}
                          <p className="mt-4 font-heading text-[15px] font-semibold leading-snug text-foreground break-words line-clamp-2" title={c.name}>{c.name}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground lining-nums">
                            Roll {c.slot.roll}{c.side.cls ? ` · Class ${c.side.cls}` : ""}
                          </p>
                          <div className="mx-auto my-1.5 h-px w-10 bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
                          <p className={`font-heading text-xl font-semibold leading-none lining-nums tabular-nums ${c.side.failed ? "text-red-600 dark:text-red-400" : "text-emerald-800 dark:text-emerald-300"}`}>
                            {c.pct != null ? `${c.pct}%` : c.side.marks || "—"}
                          </p>
                          <p className="mt-1 text-[10.5px] text-muted-foreground lining-nums">{c.side.grade ? `Grade ${c.side.grade}` : ""}{c.side.grade && c.side.marks ? " · " : ""}{c.side.marks}</p>
                          {failCount > 0 && (
                            <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                              <AlertCircle className="h-3 w-3" /> Failed {failCount} paper{failCount === 1 ? "" : "s"}
                            </p>
                          )}
                          {delta != null && (
                            <p className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${delta >= 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-rose-500/15 text-rose-700 dark:text-rose-400"}`}>
                              {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              {fmtDelta(delta)}% vs class
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Verdict + subject split */}
                  <div className="rounded-xl border border-[#E3B341]/50 bg-[#E3B341]/10 p-3 space-y-2">
                    <p className="text-center font-heading text-[13px] font-medium text-foreground">
                      {leader === "tie"
                        ? "Both students are tied overall."
                        : <><span className="font-semibold">{leader === "a" ? nameA : nameB}</span> leads by <span className="font-semibold text-emerald-700 dark:text-emerald-400">{diffPct}%</span> overall</>}
                    </p>
                    {tallyTotal > 0 && (
                      <div>
                        <div className="flex h-2 rounded-full overflow-hidden bg-secondary">
                          <div className="bg-emerald-700 transition-[width] duration-500" style={{ width: `${(tally.a / tallyTotal) * 100}%` }} />
                          <div className="bg-muted-foreground/30" style={{ width: `${(tally.tie / tallyTotal) * 100}%` }} />
                          <div className="bg-[#C9962B] transition-[width] duration-500" style={{ width: `${(tally.b / tallyTotal) * 100}%` }} />
                        </div>
                        <div className="mt-1 flex justify-between text-[10px] font-medium text-muted-foreground">
                          <span>A led {tally.a} subject{tally.a === 1 ? "" : "s"}</span>
                          {tally.tie > 0 && <span>{tally.tie} tied</span>}
                          <span>B led {tally.b} subject{tally.b === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Class average strip (school only) */}
                  {isSchool && avgLoading && (
                    <div className="rounded-xl border border-dashed border-border px-3 py-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating class average…
                    </div>
                  )}
                  {isSchool && !avgLoading && (avgA || avgB) && (
                    <div className="rounded-xl border border-border bg-gradient-to-r from-foreground/[0.03] to-transparent px-3 py-2.5 flex items-start gap-2.5">
                      <Users className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="text-[11px] leading-snug text-muted-foreground">
                        {sameClass && avgA ? (
                          <>
                            <span className="font-bold text-foreground">Class {clsA} average: {avgA.pct}%</span>
                            {" "}· {avgA.n} students{avgA.passRate != null ? ` · ${avgA.passRate}% passed` : ""}
                          </>
                        ) : (
                          <>
                            {avgA && <div><span className="font-bold text-foreground">Class {clsA}: {avgA.pct}%</span> · {avgA.n} students</div>}
                            {avgB && <div><span className="font-bold text-foreground">Class {clsB}: {avgB.pct}%</span> · {avgB.n} students</div>}
                          </>
                        )}
                        <div className="mt-0.5">Includes every student in the class. The tick on each bar marks the class average.</div>
                      </div>
                    </div>
                  )}

                  {/* Single per-subject list: overall row first, then subjects.
                      Each row = two bars (A, B) + class-average tick + deltas. */}
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-700" /> A</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#C9962B]" /> B</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Failed paper</span>
                    {(avgA || avgB) && <span className="flex items-center gap-1"><span className="w-0.5 h-3 bg-foreground/70" /> Class average</span>}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
                    {pctA != null && pctB != null && (
                      <div className="space-y-1.5 bg-emerald-800/10 p-3 dark:bg-emerald-400/10">
                        <p className="text-center font-heading text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-900 dark:text-emerald-300">Overall</p>
                        <CmpLine side="a" value={pctA} max={100} avg={avgA?.pct ?? null} win={leader === "a"} fail={sideA!.failed === true} suffix="%" />
                        <CmpLine side="b" value={pctB} max={100} avg={avgB?.pct ?? null} win={leader === "b"} fail={sideB!.failed === true} suffix="%" />
                      </div>
                    )}
                    {subjectRows.map(row => {
                      const both = row.obA != null && row.obB != null;
                      return (
                        <div key={row.name} className="space-y-1.5 p-3">
                          <p className="text-center font-heading text-[13px] font-medium text-foreground break-words">{row.name}</p>
                          <CmpLine side="a" value={row.obA} max={row.max} avg={row.avgA} win={both && row.obA! > row.obB!} fail={row.failA} />
                          <CmpLine side="b" value={row.obB} max={row.max} avg={row.avgB} win={both && row.obB! > row.obA!} fail={row.failB} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ── Has any school result been published? ───────────────────────────────────
// Single count(*) on published rows. Used by the main Results page to
// decide between SCHOOL mode and BISE Peshawar fallback mode. Cached for
// 60s on the client to avoid re-querying on every render.
function useHasPublishedSchoolResults() {
  return useQuery<boolean>({
    queryKey: ["has-published-school-results"],
    queryFn: async () =>
      // Phase 5: cached existence check (s-maxage 30 s) — one DB read instead
      // of one per visitor per minute on every page (Navbar runs this too).
      cachedOrDirect<boolean>("has-results", {}, async () => {
        // Existence check: fetch ONE row instead of counting every published result row.
        const { data, error } = await supabase
          .from("results")
          .select("id")
          .eq("is_published", true)
          .limit(1);
        if (error) throw error;
        return (data?.length ?? 0) > 0;
      }),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    // While a publish is awaited, poll fast so the page goes live quickly.
    refetchOnWindowFocus: false,
  });
}

// ── BISE Peshawar result search (fallback mode) ─────────────────────────────
// Rendered when NO school result has been published by the admin. Searches
// BISE Peshawar's board result via our /api/bisep-proxy serverless function
// (which in turn calls cloud.bisep.edu.pk with realistic browser headers
// to bypass Cloudflare's challenge, parses the returned HTML, and caches
// the parsed result for 24h on the edge).
// ── Thin blue subject bar (BISE Peshawar) ───────────────────────────────
// BISEP does NOT send a per-subject maximum, so the maximum comes from the
// board's fixed paper scheme (confirmed by the school), decided by exam level
// + subject:
//   HSSC (11th / 12th): Islamiyat, Mutalia Quran & Pak Study = 50, every other subject = 100
//                       (practical included) → 600 per year, 1200 for 12th.
//   SSC  (9th / 10th) : Islamiyat, Mutalia Quran & Pak Study = 50, every other
//                       subject = 75 (practical included) → 600 per year, 1200 for 10th.
// Bar = (theory + practical) / that maximum. Blank / non-numeric marks → no bar.
// If the level can't be determined the bar is left out — never guessed.
type BiseLevel = "HSSC" | "SSC";
function biseLevel(title: string, subjects: { subject: string }[]): BiseLevel | null {
  // The papers themselves are the most reliable signal: only HSSC codes its
  // papers like E-I / U-II / PH-I / MQH-I. (The title can be a stale fallback.)
  if (subjects.some(s => /^(E|U|M|PH|CH|CS|B|BIO|MQH|IE|PS)\s*-\s*I{1,2}$/i.test(String(s.subject).trim()))) return "HSSC";
  const t = String(title || "");
  if (/\bHSSC\b|higher\s+secondary/i.test(t)) return "HSSC";
  if (/\bSSC\b|secondary\s+school/i.test(t)) return "SSC";
  return null;
}
function biseSubjectMax(name: string, level: BiseLevel | null): number | null {
  if (!level) return null;
  const n = String(name || "").trim();
  const isIslamiyat = /^IE(\b|\s*-|$)|islam/i.test(n);
  const isMutaliaQuran = /\bMQH\b|^MQH|mutal|m\.?\s*quran|quran/i.test(n);
  const isPakStudy = /pak(?:istan)?[\s.-]*stud|^PS(\b|\s*-|$)/i.test(n);
  if (level === "HSSC") return isIslamiyat || isMutaliaQuran || isPakStudy ? 50 : 100;
  return isIslamiyat || isMutaliaQuran || isPakStudy ? 50 : 75;
}
function bisePartNumber(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  return Number(t);
}
function biseSubjectObtained(s: { theory: string; practical: string }): number | null {
  const th = bisePartNumber(s.theory);
  const pr = bisePartNumber(s.practical);
  if (th === null && pr === null) return null;
  return (th ?? 0) + (pr ?? 0);
}
// ── On-device marksheet cache (v5) ──────────────────────────────────────
// Board marksheets are FINAL once published, so every `found` result is
// cached in localStorage for 24 h, keyed by exam + roll. This is the single
// biggest defence against the board's probabilistic 403 rejections: a
// student re-opening their result, a friend comparing the same rolls, or
// the whole class opening the topper's card all become ZERO-request hits
// — the board is only ever asked once per roll per device per exam.
// Guarded parse/serialize throughout — private-mode Safari, quota errors
// and JSON corruption must never break a search.
const BISEP_CACHE_PREFIX = "ghs-bisep-result-v3:";
const BISEP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h — final marksheets

function biseCacheKey(examKey: string, roll: string): string {
  const exam = String(examKey || "unknown").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60);
  return `${BISEP_CACHE_PREFIX}${exam}:${roll}`;
}

function biseCacheGet(examKey: string, roll: string): BiseResult | null {
  try {
    const raw = localStorage.getItem(biseCacheKey(examKey, roll));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; r?: BiseResult } | null;
    if (!parsed || typeof parsed !== "object" || !parsed.r || typeof parsed.t !== "number") {
      localStorage.removeItem(biseCacheKey(examKey, roll));
      return null;
    }
    if (Date.now() - parsed.t > BISEP_CACHE_TTL) {
      localStorage.removeItem(biseCacheKey(examKey, roll));
      return null;
    }
    // Structural sanity — a cached entry must at least look like a result.
    // (BiseResult here has no `found` flag — found results are stored as-is.)
    if (!Array.isArray(parsed.r.subjects) || !parsed.r.roll_no) {
      localStorage.removeItem(biseCacheKey(examKey, roll));
      return null;
    }
    return parsed.r;
  } catch {
    return null;
  }
}

function biseCacheSet(examKey: string, roll: string, result: BiseResult): void {
  try {
    localStorage.setItem(
      biseCacheKey(examKey, roll),
      JSON.stringify({ t: Date.now(), r: result })
    );
  } catch {
    // Quota / private mode — cache is best-effort only, never fatal.
  }
}

const BISE_BUSY_RE = /too many requests|wait a few seconds/i;

// ── Shared BISE Peshawar fetch — used by the search box AND the Comparison
// modal, so both go through the exact same defensive parsing (never throws
// on a malformed proxy response) and the same normalized BiseResult shape.
// v5 additions (board probabilistically 403s ~half of all requests):
//   1. Read-through localStorage cache — a final marksheet is served
//      instantly from the device on repeat lookups, no board request.
//   2. Auto-retry on "board busy" — the proxy now answers busy only after
//      5 spaced upstream attempts all failed (rare); this layer adds two
//      more spaced client-side retries so a single search almost never
//      surfaces the busy message to a student.
type BiseFetchOutcome =
  | { status: "found"; result: BiseResult; cached?: boolean }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string };

async function fetchBiseResult(
  roll: string,
  opts?: {
    examKey?: string;
    onBusyRetry?: (attempt: number, total: number) => void;
  }
): Promise<BiseFetchOutcome> {
  const examKey = opts?.examKey || "unknown";

  // 0) Device cache — final results never need the board again.
  const hit = biseCacheGet(examKey, roll);
  if (hit) return { status: "found", result: hit, cached: true };

  const BUSY_RETRY_DELAYS = [1600, 2400];
  let last: { status: "not-found"; message: string } | { status: "error"; message: string } | null = null;

  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS.length; attempt++) {
    try {
      const resp = await fetchWithRetryFn(`/api/bisep-proxy?roll=${encodeURIComponent(roll)}&v=3`);
      let raw: unknown = null;
      try { raw = await resp.json(); } catch { raw = null; }
      const safeRaw: BiseProxyResponse | null = (raw && typeof raw === "object") ? (raw as BiseProxyResponse) : null;
      const data: BiseProxyResponse = safeRaw ?? { found: false, error: "Invalid response from BISE Peshawar proxy." };

      if (data && data.found === true) {
        const safeSubjects = Array.isArray(data.subjects)
          ? data.subjects
              .filter((s): s is BiseSubject => s != null && typeof s === "object")
              .map((s) => ({
                sr:       typeof s.sr       === "string" ? s.sr       : String(s.sr ?? ""),
                subject:  typeof s.subject  === "string" ? s.subject  : String(s.subject  ?? ""),
                theory:   typeof s.theory   === "string" ? s.theory   : String(s.theory   ?? ""),
                practical:typeof s.practical=== "string" ? s.practical: String(s.practical?? ""),
                theory_fail:    s.theory_fail    === true,
                practical_fail: s.practical_fail === true,
              }))
          : [];
        const result: BiseResult = {
          roll_no:          typeof data.roll_no          === "string" ? data.roll_no          : roll,
          name:             typeof data.name             === "string" ? data.name             : "",
          father_name:      typeof data.father_name      === "string" ? data.father_name      : "",
          marks:            typeof data.marks            === "string" ? data.marks            : "",
          grade:            typeof data.grade            === "string" ? data.grade            : "",
          remarks:          typeof data.remarks          === "string" ? data.remarks          : "",
          collect_dmc_from: typeof data.collect_dmc_from === "string" ? data.collect_dmc_from : "",
          subjects:         safeSubjects,
        };
        biseCacheSet(examKey, roll, result);
        return { status: "found", result };
      }

      const message = data && typeof data.message === "string" && data.message
        ? data.message
        : (data && typeof data.error === "string" ? data.error : "");

      // Board busy (proxy already made 5 spaced attempts) — one of the few
      // transient outcomes worth another client-side spaced try.
      if (message && (BISE_BUSY_RE.test(message) || data.busy === true) && attempt < BUSY_RETRY_DELAYS.length) {
        opts?.onBusyRetry?.(attempt + 1, BUSY_RETRY_DELAYS.length);
        await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAYS[attempt]));
        continue;
      }

      if (message) {
        last = { status: "not-found", message };
        // Only busy is retryable — a clean "no record for this roll" is final.
        if (!BISE_BUSY_RE.test(message) && data.busy !== true) break;
        if (attempt >= BUSY_RETRY_DELAYS.length) break;
        continue;
      }
      last = { status: "error", message: "Couldn't reach BISE Peshawar right now. Please try again." };
      if (attempt >= BUSY_RETRY_DELAYS.length) break;
      // Malformed/empty proxy payload — brief spaced retry, same as busy.
      opts?.onBusyRetry?.(attempt + 1, BUSY_RETRY_DELAYS.length);
      await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAYS[attempt]));
    } catch {
      last = { status: "error", message: "Couldn't reach BISE Peshawar right now. Please try again." };
      if (attempt >= BUSY_RETRY_DELAYS.length) break;
      opts?.onBusyRetry?.(attempt + 1, BUSY_RETRY_DELAYS.length);
      await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAYS[attempt]));
    }
  }

  return last ?? { status: "error", message: "Couldn't reach BISE Peshawar right now. Please try again." };
}

// ── Overall percentage for a BISE result — sums obtained/max across every
// subject that has a known fixed maximum (HSSC/SSC), for the Comparison
// modal's headline number and winner badge.
function biseOverallPercent(result: BiseResult, examTitle: string): number | null {
  const level = biseLevel(examTitle, result.subjects);
  if (!level) return null;
  let obtained = 0, max = 0;
  for (const s of result.subjects) {
    const ob = biseSubjectObtained(s);
    const mx = biseSubjectMax(s.subject, level);
    if (ob === null || mx === null) continue;
    obtained += ob; max += mx;
  }
  return max > 0 ? Math.round((obtained / max) * 1000) / 10 : null;
}

function SubjectBar({ pct, fail, delay }: { pct: number | null; fail: boolean; delay: number }) {
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1 w-full rounded-full bg-secondary overflow-hidden" role="presentation">
      {pct !== null && (
        <motion.div
          className={`h-full w-full rounded-full ${fail ? "bg-gradient-to-r from-red-500 to-red-400" : "bg-gradient-to-r from-blue-600 to-sky-400"}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: w / 100 }}
          transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
          style={{ transformOrigin: "left center", willChange: "transform" }}
        />
      )}
    </div>
  );
}
interface BiseSubject { sr: string; subject: string; theory: string; practical: string; theory_fail?: boolean; practical_fail?: boolean; }
interface BiseResult {
  roll_no: string;
  name: string;
  father_name: string;
  marks: string;
  grade: string;
  remarks: string;
  collect_dmc_from: string;
  subjects: BiseSubject[];
}
interface BiseProxyResponse {
  found: boolean;
  message?: string;
  error?: string;
  // v5 proxy flag — true when every spaced upstream attempt got the board's
  // 403 "Invalid request." (their probabilistic rejection filter), so the
  // client knows this specific outcome is transient and retryable.
  busy?: boolean;
  // When found === true, the result fields are spread onto the response:
  roll_no?: string;
  name?: string;
  father_name?: string;
  marks?: string;
  grade?: string;
  remarks?: string;
  collect_dmc_from?: string;
  subjects?: BiseSubject[];
}

// ── Small realistic clock icon + label + big digital countdown ─────────
// Wraps RealisticClockIcon (same small alarm-clock design used on Merit
// List / Roll Slip) together with the "TIME REMAINING" label and the big
// red HH:MM:SS digits, all driven off ONE shared ticking interval so the
// clock hands and the digits always agree.
function BisepClockAndCountdown({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [hms, setHms] = useState({ h: 0, m: 0, s: 0 });
  // Real current time-of-day, for the analog clock face — separate from
  // the remaining-duration digits below it. See note on RealisticClockIcon:
  // the hands must read an actual clock time (e.g. ticking normally toward
  // 3:00:00 PM), not the countdown duration.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const calc = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      setNow(new Date());
      if (diff <= 0) {
        setTimeLeft("00h 00m 00s");
        setIsRunning(false);
        setHms({ h: 0, m: 0, s: 0 });
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      setTimeLeft(d > 0 ? `${d}d ${hh}h ${mm}m ${ss}s` : `${hh}h ${mm}m ${ss}s`);
      setHms({ h, m, s });
      setIsRunning(true);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [targetDate]);

  return (
    <>
      <span className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
        <RealisticClockIcon className="w-14 h-14" hours={now.getHours()} minutes={now.getMinutes()} seconds={now.getSeconds()} />
      </span>
      <p className="text-sm font-bold text-green-600 dark:text-green-400 tracking-wide uppercase mb-3">
        Time Remaining
      </p>
      <motion.p
        className="font-mono font-extrabold text-red-600 dark:text-red-500 text-3xl sm:text-4xl tracking-wider"
        animate={isRunning ? { scale: [1, 1.055, 1] } : { scale: 1 }}
        transition={isRunning ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        {timeLeft}
      </motion.p>
    </>
  );
}



const BiseResultSearch = () => {
  // ── Live BISEP exam title + countdown ───────────────────────────────
  // Polls /api/bisep-proxy?mode=current every 15s (1s near a countdown's
  // end). Falls back to the env var / hardcoded default title if the
  // proxy is down or BISEP's homepage structure changes — so the page
  // always shows SOMETHING sensible.
  const { data: bisepMeta, isLoading: bisepLoading } = useBisepCurrentExam();
  const liveTitle = bisepMeta?.exam_title || BISEP_EXAM_TITLE;
  // FIX: previously this defaulted to `true` while the first fetch was
  // still in flight, which made the page briefly render the Roll No /
  // Search / Reset card (wrong — a countdown was actually active) before
  // flipping to the real countdown card 3-4s later once data arrived.
  // That flip was the "cached page then real page" flash reported by the
  // user — it isn't caching at all, it's a wrong assumption made before
  // we actually know the state. Now `isLive` is only ever `true` or
  // `false` once we KNOW; while loading, neither the search card nor the
  // countdown card renders — a neutral skeleton does instead — so there
  // is nothing wrong to flash.
  const isLive = bisepMeta?.is_live ?? false;
  const countdownDate = bisepMeta?.countdown_date;
  const countdownText = bisepMeta?.countdown_text;

  const [searchRoll, setSearchRoll] = useState("");
  const [searched, setSearched]     = useState(false);
  const [searching, setSearching]   = useState(false);
  // Live status line inside the search button while the board is being
  // retried ("Board busy — retrying (1/2)…") — turns the v4 "one silent
  // failure" moment into visible, honest progress instead of an error.
  const [searchHint, setSearchHint] = useState<string | null>(null);
  const [result, setResult]         = useState<BiseResult | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  // ── Share Result (BISE Peshawar) — board-styled marks-card image via the
  // OS share sheet; the caption carries the GHS Babi Khel homepage link.
  const [sharingBise, setSharingBise] = useState(false);
  const [savingBise, setSavingBise] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  // ── Celebration (BISE Peshawar) — the search now lands the student
  // DIRECTLY on the full result card (no separate summary popup / "View
  // Full Result Card" button). The confetti burst (pass) or calm sparkle
  // drift (fail) + soft thump/ta-da chime fire once, right over the real
  // card, the moment a fresh result comes back — same CPU-cheap
  // canvas/WebAudio celebration as before, just anchored to the actual
  // card instead of a separate overlay. `celebrateKey` remounts the
  // celebration so "Replay" can restart it.
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [celebrateMode, setCelebrateMode] = useState<CelebrationMode | null>(null);
  const { play: playCelebration, prime: primeCelebration } = useRevealAudio();
  const resultsAnchorRef = useRef<HTMLDivElement | null>(null);
  // Real DOM node of the full result card — captured for Save/Share so the
  // downloaded/shared image matches exactly what's on screen.
  const fullCardRef = useRef<HTMLDivElement | null>(null);
  const fireCelebration = (isPass: boolean) => {
    if (prefersReducedMotion()) return;
    primeCelebration();
    window.setTimeout(() => playCelebration("thump"), 120);
    window.setTimeout(() => {
      playCelebration("tada");
      setCelebrateKey(k => k + 1);
      setCelebrateMode(isPass ? "gold" : "calm");
    }, 260);
  };

  // ── Share Result (BISE Peshawar) — captures the ACTUAL on-screen full
  // result card (Candidate Information + Subject Wise Marks table, exactly
  // as displayed) via fullCardRef, instead of a separately hand-drawn
  // summary image. Falls back to the hand-drawn card if the DOM capture
  // fails for any reason (e.g. an unsupported browser).
  const handleShareBiseResult = async () => {
    if (!result) return;
    setSharingBise(true);
    const text = biseShareText({
      examTitle: liveTitle,
      studentName: result.name || "Student",
      fatherName: result.father_name || "—",
      rollNo: result.roll_no,
      marks: result.marks || "",
      grade: result.grade || "",
      remarks: result.remarks || "",
      subjects: [],
    });
    let outcome = await shareResultCardNode(fullCardRef.current, {
      fileName: `BISE-Result-${(result.roll_no || "Result").replace(/[^a-zA-Z0-9]+/g, "-")}-GHS-Babi-Khel.png`,
      title: "BISE Peshawar Result — via GHS Babi Khel",
      text,
    });
    if (outcome === "failed") {
      // Fallback: the original hand-drawn canvas card.
      outcome = await shareBiseResultCard({
        examTitle: liveTitle,
        studentName: result.name || "Student",
        fatherName: result.father_name || "—",
        rollNo: result.roll_no,
        marks: result.marks || "",
        grade: result.grade || "",
        remarks: result.remarks || "",
        subjects: (() => {
          const level = biseLevel(liveTitle, result.subjects);
          return result.subjects.map(s => {
            const ob = biseSubjectObtained(s);
            const mx = biseSubjectMax(s.subject, level);
            return {
              sr: s.sr,
              subject: s.subject,
              theory: s.theory,
              practical: s.practical,
              theoryFail: s.theory_fail === true,
              practicalFail: s.practical_fail === true,
              barPct: ob === null || mx === null ? null : Math.min(100, (ob / mx) * 100),
              maxMarks: mx,
            };
          });
        })(),
      });
    }
    toastShareOutcome(outcome);
    setSharingBise(false);
  };

  // ── Save Result (BISE Peshawar) — same DOM capture as Share, but saves
  // straight to the device instead of opening the OS share sheet.
  const handleSaveBiseResult = async () => {
    if (!result) return;
    setSavingBise(true);
    let outcome = await saveResultCardNode(
      fullCardRef.current,
      `BISE-Result-${(result.roll_no || "Result").replace(/[^a-zA-Z0-9]+/g, "-")}-GHS-Babi-Khel.png`,
    );
    if (outcome === "failed") {
      // Fallback: the original hand-drawn canvas card.
      outcome = await saveBiseResultCard({
        examTitle: liveTitle,
        studentName: result.name || "Student",
        fatherName: result.father_name || "—",
        rollNo: result.roll_no,
        marks: result.marks || "",
        grade: result.grade || "",
        remarks: result.remarks || "",
        subjects: (() => {
          const level = biseLevel(liveTitle, result.subjects);
          return result.subjects.map(s => {
            const ob = biseSubjectObtained(s);
            const mx = biseSubjectMax(s.subject, level);
            return {
              sr: s.sr,
              subject: s.subject,
              theory: s.theory,
              practical: s.practical,
              theoryFail: s.theory_fail === true,
              practicalFail: s.practical_fail === true,
              barPct: ob === null || mx === null ? null : Math.min(100, (ob / mx) * 100),
              maxMarks: mx,
            };
          });
        })(),
      });
    }
    toastShareOutcome(outcome);
    setSavingBise(false);
  };

  const handleReset = () => {
    setSearchRoll("");
    setSearched(false);
    setSearching(false);
    setResult(null);
    setNotFoundMsg(null);
    setErrorMsg(null);
    setSearchHint(null);
    setCelebrateMode(null);
  };

  // v5: the whole fetch now flows through fetchBiseResult — the SAME path
  // the Comparison modal uses — so a search gets the device cache (a roll
  // already looked up on this phone/tablet renders instantly with ZERO
  // board requests) and the automatic spaced retries when the board's
  // probabilistic 403 filter is in a bad phase. UX branches below are
  // unchanged: found → card + celebration; clean not-found → its message;
  // anything else → the calm "No Result Found" card.
  const handleSearch = async () => {
    const roll = searchRoll.trim();
    if (!roll) { toast.error("Enter your BISE roll number"); return; }
    if (!/^\d{6}$/.test(roll)) { toast.error("Roll number must be exactly 6 digits"); return; }

    setSearching(true); setSearched(false);
    setResult(null); setNotFoundMsg(null); setErrorMsg(null); setSearchHint(null);

    const outcome = await fetchBiseResult(roll, {
      examKey: liveTitle,
      onBusyRetry: (attempt, total) =>
        setSearchHint(`Board busy — retrying (${attempt}/${total})…`),
    });
    setSearchHint(null);

    if (outcome.status === "found") {
      setResult(outcome.result);
      // Confetti + chime fire directly over the real full result card —
      // no separate summary popup. Pass/fail is inferred the same way
      // the card's own badge logic works (any failed theory/practical
      // part, or "fail" in the remarks text, means calm/teal not gold).
      const anyPartFailed = outcome.result.subjects.some(s => s.theory_fail || s.practical_fail);
      const isPass = !anyPartFailed && !/fail/i.test(outcome.result.remarks || "");
      fireCelebration(isPass);
    } else if (outcome.status === "not-found") {
      // "Record not Found" or a busy message that survived every retry.
      setNotFoundMsg(outcome.message);
    } else {
      // Proxy error (BISE down, Cloudflare challenge, parse failure, etc.)
      // UX FIX (kept from v4): don't show a scary technical error for what
      // is, from the user's point of view, simply "this roll number has no
      // result yet" (or a transient hiccup while searching). Treat every
      // non-"found" / non-clean-"not found" case the same way the user
      // sees a genuine "not found" — a calm "No Result Found" card.
      setNotFoundMsg(
        "No Result Found. Please check your Roll No and try again, or try again in a moment."
      );
    }

    setSearched(true); setSearching(false);
  };

  // Pass/fail for the current result — used to decide the celebration's
  // color (gold confetti vs calm teal drift) if it needs recomputing
  // (e.g. "Replay" below), same rule the card's own badges use.
  const biseIsPass = result
    ? !result.subjects.some(s => s.theory_fail || s.practical_fail) && !/fail/i.test(result.remarks || "")
    : true;

  return (
    <div>
      <ResultHeading title={liveTitle} live={isLive} />

      {/* ── Loading skeleton (first paint, before we know live/countdown) ──
          FIX for the "shows old card then flips to real card" flash: we no
          longer guess `isLive = true` while data is in flight. Instead,
          for the brief moment before the first /api/bisep-proxy response
          lands, we render a neutral pulsing skeleton — never the actual
          Roll No / Search card, never the countdown card — so there is
          nothing incorrect to visibly swap out once real data arrives.
          On slow connections this skeleton is what's visible instead of a
          wrong page; the instant real data lands, the correct card
          (search OR countdown) renders directly. */}
      {bisepLoading ? (
        <div className="bg-card rounded-2xl shadow-elevated p-8 mb-6 border border-border text-center animate-pulse">
          <div className="h-3 w-32 bg-muted rounded mx-auto mb-4" />
          <div className="h-9 w-48 bg-muted rounded mx-auto mb-3" />
          <div className="h-3 w-40 bg-muted rounded mx-auto" />
        </div>
      ) : !isLive && countdownDate ? (
        /* ── Big BISEP-style countdown (pre-announcement state) ──────────
            While a countdown is active, the Roll No / Search / Reset card
            is HIDDEN — searching is pointless before BISEP has published
            anything, and showing it invites confusing "No Result Found"
            searches. Instead we show a big, board-style countdown display
            mirroring cloud.bisep.edu.pk's own presentation: a green
            "TIME REMAINING" label with a large red HH:MM:SS below it.
            The moment isLive flips true (picked up within ~1s thanks to
            the adaptive 1s poll in useBisepCurrentExam once the countdown
            nears zero), this block disappears and the search card appears
            automatically — no page refresh needed. */
        <div className="bg-card rounded-2xl shadow-elevated p-8 mb-6 border border-border text-center">
          <BisepClockAndCountdown targetDate={countdownDate} />
          {countdownText && (
            <p className="text-xs text-muted-foreground mt-4">{countdownText}</p>
          )}
        </div>
      ) : (
      <PremiumSearchCard
        value={searchRoll}
        onChange={setSearchRoll}
        onSearch={handleSearch}
        onReset={handleReset}
        searching={searching}
        hint={searchHint}
        placeholder="e.g. 703902"
      />
      )}

      <AnimatePresence>
        {searched && (
          <motion.div ref={resultsAnchorRef} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {errorMsg ? (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/40 rounded-2xl p-6 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
                <h3 className="font-heading font-semibold text-amber-900 dark:text-amber-200">Couldn't fetch result</h3>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{errorMsg}</p>
                <a href={`${BISEP_PORTAL_URL}ShowResult.php?Search=RollNo&RollNo=${encodeURIComponent(searchRoll.trim())}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold text-amber-900 dark:text-amber-200 underline">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Try directly on BISE Peshawar
                </a>
              </div>
            ) : notFoundMsg ? (
              <div className="bg-card rounded-2xl p-8 text-center shadow-card border border-border">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="font-heading font-semibold text-foreground">No Result Found</h3>
                <p className="text-sm text-muted-foreground mt-1">{notFoundMsg}</p>
              </div>
            ) : result ? (
              <>
                {/* Replay chip — re-fires the confetti/chime + bar animation
                    directly on this card (no separate popup). */}
                <p className="text-center">
                  <button onClick={() => fireCelebration(biseIsPass)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#B8860B] hover:text-[#8f6a0d] hover:underline underline-offset-4 transition-colors">
                    <Sparkles className="w-3 h-3" /> Replay the reveal
                  </button>
                </p>
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
                <div ref={fullCardRef} className="w-full bg-card rounded-2xl shadow-elevated overflow-hidden border border-border">

                <div className="result-hero-blue relative overflow-hidden px-4 py-4 text-center text-white">
                  <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
                  <p className="font-heading text-[9px] font-medium uppercase tracking-[0.3em] text-[#FDE68A]">Official Result</p>
                  <h3 className="mt-1 font-heading text-lg font-semibold leading-tight tracking-wide">Student Result Details</h3>
                  <div className="mx-auto mt-2 flex items-center justify-center gap-2">
                    <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#E3B341]" />
                    <span className="h-1 w-1 rotate-45 bg-[#E3B341]" />
                    <span className="h-px w-8 bg-gradient-to-l from-transparent to-[#E3B341]" />
                  </div>
                  <p className="mt-2">
                    <span className="inline-block max-w-full rounded-full border border-white/25 bg-white/15 px-3 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.1em] leading-tight">
                      {liveTitle} · BISE Peshawar
                    </span>
                  </p>
                </div>

                {/* ── Candidate Information — same premium compact style as the
                    school result card (no percentage: BISE doesn't supply one). */}
                <div className="px-4 py-4 border-b border-border">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <span className="h-px w-6 shrink-0 bg-gradient-to-r from-transparent to-[#E3B341]" />
                    <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] whitespace-nowrap text-[#B8860B] dark:text-[#E3B341]">Candidate Information</p>
                    <span className="h-px w-6 shrink-0 bg-gradient-to-l from-transparent to-[#E3B341]" />
                  </div>
                  <div className="relative rounded-xl border border-border bg-emerald-50/60 dark:bg-emerald-950/20 px-3 py-2.5">
                    <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#E3B341] to-transparent" />
                    <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Student Name:</p>
                    <p className="mt-0.5 text-center font-heading text-lg font-semibold leading-snug text-emerald-900 dark:text-emerald-200 break-words">{result.name || "—"}</p>
                    <div className="my-1.5 h-px bg-gradient-to-r from-transparent via-[#E3B341]/60 to-transparent" />
                    <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Father Name:</p>
                    <p className="mt-0.5 text-center font-heading text-sm font-medium leading-snug text-foreground break-words">{result.father_name || "—"}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {[
                      { l: "Roll Number", v: result.roll_no || "—", cls: "text-foreground" },
                      { l: "Marks", v: result.marks || "—", cls: "text-orange-600 dark:text-orange-400" },
                      { l: "Grade", v: result.grade || "—", cls: "text-[#B8860B] dark:text-[#E3B341]" },
                    ].map((t) => (
                      <div key={t.l} className="rounded-lg border border-border bg-secondary/30 px-1.5 py-2 text-center min-w-0">
                        <p className="text-[8.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t.l}</p>
                        <p className={`mt-0.5 font-heading text-[15px] font-semibold leading-tight lining-nums tabular-nums break-words ${t.cls}`}>{t.v}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 rounded-lg border border-dashed border-[#E3B341]/60 bg-[#E3B341]/10 px-3 py-2">
                    <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Remarks:</p>
                    <p className="mt-0.5 text-center font-heading text-xs italic font-medium leading-snug text-foreground break-words">{result.remarks || "—"}</p>
                  </div>
                  {result.collect_dmc_from ? (
                    <div className="mt-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                      <p className="text-left text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Collect DMC From:</p>
                      <p className="mt-0.5 text-center font-heading text-xs font-medium leading-snug text-orange-700 dark:text-orange-400 break-words">{result.collect_dmc_from}</p>
                    </div>
                  ) : null}
                </div>

                {result.subjects.length > 0 ? (
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className="h-px w-6 shrink-0 bg-gradient-to-r from-transparent to-[#E3B341]" />
                      <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] whitespace-nowrap text-[#B8860B] dark:text-[#E3B341]">Subject Wise Marks</p>
                      <span className="h-px w-6 shrink-0 bg-gradient-to-l from-transparent to-[#E3B341]" />
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full table-fixed text-center">
                        <colgroup>
                          <col style={{ width: "9%" }} />
                          <col style={{ width: "33%" }} />
                          <col style={{ width: "18%" }} />
                          <col style={{ width: "20%" }} />
                          <col style={{ width: "20%" }} />
                        </colgroup>
                        <thead>
                          <tr className="bg-emerald-800 text-white text-[8.5px] uppercase tracking-[0.06em]">
                            <th className="py-2 px-1 font-medium text-center">#</th>
                            <th className="py-2 px-1 font-medium text-center">Subject</th>
                            <th className="py-2 px-1 font-medium text-center">Bar</th>
                            <th className="py-2 px-1 font-medium text-center">Theory</th>
                            <th className="py-2 px-1 font-medium text-center">Practical</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const level = biseLevel(liveTitle, result.subjects);
                            return result.subjects.map((s, i) => {
                              const ob = biseSubjectObtained(s);
                              const mx = biseSubjectMax(s.subject, level);
                              const pct = ob === null || mx === null ? null : Math.min(100, (ob / mx) * 100);
                              return (
                                <tr key={i} className={`${i % 2 === 1 ? "bg-secondary/30" : ""} ${i !== 0 ? "border-t border-border" : ""}`}>
                                  <td className="py-2 px-1 text-center text-[11px] text-muted-foreground lining-nums tabular-nums">{s.sr}</td>
                                  <td className="py-2 px-1 text-center font-heading text-[13px] font-medium leading-tight text-foreground break-words">{s.subject || "—"}</td>
                                  <td className="py-2 px-1 align-middle"><SubjectBar pct={pct} fail={s.theory_fail === true || s.practical_fail === true} delay={0.04 * i} /></td>
                                  <td className="py-2 px-1 text-center">
                                    <span className={`inline-block rounded-full px-2 py-px font-heading text-[13px] font-semibold lining-nums tabular-nums ${s.theory_fail ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{s.theory || "—"}</span>
                                  </td>
                                  <td className="py-2 px-1 text-center">
                                    <span className={`inline-block rounded-full px-2 py-px font-heading text-[13px] font-semibold lining-nums tabular-nums ${s.practical_fail ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{s.practical || "—"}</span>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-4 border-b border-border">
                    <p className="text-xs text-muted-foreground text-center bg-secondary/40 rounded-lg py-3">
                      Subject-wise marks not available for this result.
                    </p>
                  </div>
                )}

                {/* ── Action row — Share · Save · Comparison ──────────────
                    Three equal-size buttons in one line below the card.
                    data-capture-exclude: stripped out by the Save/Share DOM
                    capture (captureNodeAsPngFile's filter) so buttons never
                    show up baked into the saved/shared image. */}
                <div data-capture-exclude="true" className="border-t border-[#E3B341]/40 bg-secondary/20 px-4 py-3">
                  <ResultActionBar onShare={handleShareBiseResult} onSave={handleSaveBiseResult} onCompare={() => setComparisonOpen(true)} sharing={sharingBise} saving={savingBise} />
                </div>
                </div>
                </motion.div>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Celebration — BISE Peshawar edition ──
          Confetti/sparkle canvas fires directly over the real full result
          card above (fireCelebration), reduced-motion aware. No separate
          popup — nothing to close, nothing blocking the actual card. */}
      {celebrateMode && <CelebrationCanvas key={celebrateKey} mode={celebrateMode} />}
      <ComparisonModal
        open={comparisonOpen}
        onClose={() => setComparisonOpen(false)}
        examTitle={liveTitle}
        currentRoll={result?.roll_no}
        currentResult={result}
      />
    </div>
  );
};

const Results = () => {
  // ── Decide which search mode to render ────────────────────────────────
  //
  //   1. SCHOOL mode  — admin has published at least one result in the
  //                      admin panel (Manage Result), OR has an active
  //                      schedule pending (publish_at set, in the future).
  //                      The page searches school results by exam roll
  //                      number and shows the school's own result title
  //                      (e.g. "Result - 1st Semester 2026").
  //
  //   2. BISE mode    — no school result has been published AND no school
  //                      schedule is pending. The page falls back to BISE
  //                      Peshawar's board result search.
  //
  // BUG FIX: previously `showBiseMode` only checked `hasSchoolResults`, so
  // BISE Peshawar's search stayed visible and usable for the ENTIRE
  // duration of an active school countdown — the school's own schedule had
  // no effect on this toggle at all. Now, a pending schedule also puts the
  // page in SCHOOL mode (matching the countdown banner above it), so BISE
  // Peshawar disappears the moment a school schedule is set, not just once
  // it actually publishes.
  const hasSchoolResults = useHasPublishedSchoolResults();
  const { data: scheduled = [], isLoading: scheduleLoading } = useScheduledPublishes();
  const hasActiveSchedule = scheduled.length > 0;

  // ── STICKY SCHOOL MODE (fixes "school result shows 2-3 s, then jumps to
  // BISE board result") ───────────────────────────────────────────────────
  // Once this visit has seen a published school result, a pending school
  // schedule, or a confirmed publish, we STAY in school mode. A stale or
  // in-flight "0 published rows" answer can no longer flip the page to BISE.
  const schoolLatch = useRef(false);
  if (hasSchoolResults.data === true || hasActiveSchedule || isPublishConfirmed()) {
    schoolLatch.current = true;
  }
  const showBiseMode =
    !schoolLatch.current && hasSchoolResults.data === false && !hasActiveSchedule;

  // Countdown ended, rows are being flipped to published right now: show a
  // calm "publishing" card (and poll) instead of the empty search or BISE.
  const awaitingPublish =
    schoolLatch.current && hasSchoolResults.data === false && !hasActiveSchedule;
  const { refetch: refetchHasSchool } = hasSchoolResults;
  useEffect(() => {
    if (!awaitingPublish) return;
    const t = window.setInterval(() => { void refetchHasSchool(); }, 1000);
    return () => window.clearInterval(t);
  }, [awaitingPublish, refetchHasSchool]);
  // FIX: this is the real source of the "old Roll No / Search Result /
  // Reset card flashes for half a second" bug. `hasSchoolResults.data` is
  // `undefined` while ITS OWN query is still loading, and
  // `undefined === false` evaluates to `false` — so `showBiseMode` was
  // `false` by default on first paint, which rendered `ResultCardSearch`
  // (the SCHOOL result card) immediately, even when the site was actually
  // supposed to be in BISE mode. The instant `hasSchoolResults` finished
  // loading and `showBiseMode` flipped to `true`, React swapped in
  // `BiseResultSearch` — that swap was the visible "old card, then real
  // card" flash. `modeKnown` tracks whether BOTH queries this decision
  // depends on have actually finished, so we render neither card (a
  // neutral skeleton instead) until we truly know which one is correct.
  const modeKnown = !hasSchoolResults.isLoading && !scheduleLoading;

  // Watches every active schedule and fires the publish the instant one
  // reaches zero (see useAutoPublishWatcher above) — this is what actually
  // makes the countdown DO something when it hits 0, instead of just
  // freezing on "Publishing now…" forever.
  useAutoPublishWatcher();

  // Catch-up: results whose time already passed but were never flipped to
  // published (no visitor was online at zero) get published now, instead of
  // leaving the page on the BISE fallback.
  const catchUpQc = useQueryClient();
  const needsCatchUp = modeKnown && hasSchoolResults.data === false && !hasActiveSchedule;
  useEffect(() => {
    if (needsCatchUp) void catchUpDuePublishes(catchUpQc);
  }, [needsCatchUp, catchUpQc]);

  return (
    <PageLayout>
      <PageBanner
        variant="premium"
        eyebrow="GHS Babi Khel"
        title="Exam Results"
        subtitle="Check your examination results by roll number"
      >
        {/* Report Card — small white rectangle button with thin blue border,
            opens the password-gated Report Card modal for bulk result
            generation (PDF + Excel). Rendered inside the green hero banner
            (below the subtitle) so it visually belongs to the "Exam Results"
            header instead of floating below it. */}
        <ReportCardButton />
      </PageBanner>

      {/* Scheduled results countdown — shows when results are pending */}
      <div className="container mx-auto px-4 mt-6 empty:hidden">
        <ScheduledResultsBanner />
      </div>

      <section className="pt-4 pb-10 sm:pt-8 sm:pb-16 relative">
        <div className="container mx-auto px-3 sm:px-4">
          <div className="max-w-2xl mx-auto space-y-4">
            {!modeKnown ? (
              // Neutral skeleton — mirrors the search-card shape without
              // committing to either SCHOOL or BISE mode, so nothing
              // incorrect is ever shown even for a fraction of a second.
              <div className="bg-card rounded-2xl shadow-elevated p-5 border border-border animate-pulse">
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-11 w-full bg-muted rounded-xl mb-3" />
                <div className="h-11 w-full bg-muted rounded-xl mb-3" />
                <div className="h-11 w-full bg-muted rounded-xl" />
              </div>
            ) : showBiseMode ? <BiseResultSearch />
              : hasActiveSchedule ? null
              : awaitingPublish ? (
                <div className="bg-card rounded-2xl shadow-elevated p-8 border border-border text-center">
                  <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin" />
                  <p className="mt-3 text-lg font-bold text-foreground">Publishing results…</p>
                  <p className="text-sm text-muted-foreground mt-1">Your result will appear in a moment.</p>
                </div>
              ) : <ResultCardSearch />}
          </div>
        </div>
      </section>

      {/*
        ── SEO content section ────────────────────────────────────────────────
        Renders BELOW the result search box. Purely additive — does NOT modify
        the search UI, BISEP proxy, school-mode/BISE-mode toggle, or any other
        existing logic. Provides Google-rich on-page content (FAQ, HowTo,
        result-types grid, internal links, authority statement) targeting the
        search queries: BISE Peshawar Result, SSC Result, BISEP Result,
        Peshawar Board Result, BISE Result, 9th/10th/11th/12th class result.
        The matching structured data lives in RouteSEOInjector.tsx.
      ──────────────────────────────────────────────────────────────────────
      */}
      <ResultsSeoContent />
    </PageLayout>
  );
};

export default Results;
