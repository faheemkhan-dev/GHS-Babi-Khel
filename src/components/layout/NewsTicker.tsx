import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useNotices } from "@/hooks/useNotices";
import { supabase } from "@/lib/supabase";
import { useRollSlipCountdown } from "@/hooks/useRollSlipCountdown";
import { useAdmissionSettings } from "@/hooks/useAdmission";
import { examTypeLabel } from "@/utils/examTypeLabel";

/* ═══════════════════════════════════════════════════════════════════════════
   NewsTicker — slim green headline strip under the school name.

   • Shows ONLY titles: latest notices, latest result, admission, roll no.
     slip, merit list. No extra wording.
   • Moves RIGHT → LEFT, forever, at a constant speed (pixels per second),
     so the pace is identical on phone and desktop no matter how many
     titles there are.
   • Smooth: one compositor-driven transform animation (Web Animations API,
     translate3d, linear). No setInterval / requestAnimationFrame / state
     updates while moving → no jumping, no jank.
   • When the data refreshes the animation keeps its position (no restart).
   • Hover (desktop) pauses it so a title can be read and clicked.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Pixels per second — a little faster than a relaxed reading pace. */
const SPEED_PX_PER_SEC = 75;

type TickerItem = { key: string; label: string; to: string; urgent?: boolean };

/* ── Data ─────────────────────────────────────────────────────────────────── */

type ResultRow = { exam_type: string; year: number };
type MeritRow = {
  id: string; scope: string; class: string; year: number;
  title: string | null; publish_at: string | null; created_at: string;
};

const meritTitle = (m: MeritRow) =>
  m.title?.trim() ||
  (m.scope === "school" ? `School Merit List ${m.year}`
    : m.scope === "school-bise" ? `BISE Merit List ${m.year}`
    : `Class ${m.class} Merit List ${m.year}`);

/* Every source is its OWN query: one slow or failing table can never hide the
   others. Errors are logged (never swallowed silently) so a blocked table is
   visible in the browser console as "[ticker] <source> failed: …". */
const LIVE = {
  staleTime: 30 * 1000,
  refetchInterval: 60 * 1000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

function useLatestResults() {
  return useQuery<ResultRow[]>({
    queryKey: ["ticker-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("results")
        .select("exam_type, year, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) { console.warn("[ticker] results failed:", error.message); return []; }
      const seen = new Set<string>();
      const out: ResultRow[] = [];
      for (const r of (data ?? []) as ResultRow[]) {
        const k = `${r.exam_type}|${r.year}`;
        if (!r.exam_type || seen.has(k)) continue;
        seen.add(k);
        out.push({ exam_type: r.exam_type, year: r.year });
      }
      return out;
    },
    ...LIVE,
  });
}

function useLatestMeritLists() {
  return useQuery<MeritRow[]>({
    queryKey: ["ticker-merit"],
    queryFn: async () => {
      // Same select the public /merit-list page uses.
      const { data, error } = await supabase
        .from("merit_lists")
        .select("id, scope, class, exam_type, year, is_published, publish_at, title, notes, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) { console.warn("[ticker] merit lists failed:", error.message); return []; }
      return (data ?? []) as unknown as MeritRow[];
    },
    ...LIVE,
  });
}

function useTickerItems() {
  const { data: notices, isLoading: nLoading } = useNotices(8); // same query as the Notices page
  const { data: results } = useLatestResults();
  const { data: merits } = useLatestMeritLists();
  const { sessions, now } = useRollSlipCountdown(); // shared cache with the Navbar
  const { data: admission } = useAdmissionSettings(); // shared cache with Home

  const items = useMemo<TickerItem[]>(() => {
    const out: TickerItem[] = [];
    const nowIso = new Date(now).toISOString();

    // 1. Latest notices
    (notices ?? [])
      .filter((n) => n.title?.trim() && (!n.expires_at || n.expires_at > nowIso))
      .slice(0, 5)
      .forEach((n) => out.push({ key: `n-${n.id}`, label: n.title.trim(), to: `/notices/${n.id}`, urgent: n.is_urgent }));

    // 2. Latest results (newest exam first, max 2)
    (results ?? []).slice(0, 2).forEach((r) =>
      out.push({ key: `r-${r.exam_type}-${r.year}`, label: `${examTypeLabel(r.exam_type)} ${r.year} Result`, to: "/results" }),
    );

    // 3. Admission
    if (admission?.is_open) {
      out.push({ key: "adm", label: `Admissions Open ${admission.session_year}`, to: "/admission" });
    }

    // 4. Roll No. Slip — newest published session that is not still counting down
    const live = sessions.find(
      (s) => s.is_published && (!s.publish_at || new Date(s.publish_at).getTime() <= now),
    );
    if (live) {
      const t = live.title.trim();
      out.push({ key: `rs-${live.id}`, label: /roll|slip/i.test(t) ? t : `${t} Roll No Slip`, to: "/roll-no-slip" });
    }

    // 5. Merit list (newest, max 2; skip ones still scheduled)
    (merits ?? [])
      .filter((m) => !m.publish_at || m.publish_at <= nowIso)
      .slice(0, 2)
      .forEach((m) => out.push({ key: `m-${m.id}`, label: meritTitle(m), to: "/merit-list" }));

    return out;
  }, [notices, results, merits, admission, sessions, now]);

  return { items, isLoading: nLoading && items.length === 0 };
}

/* ── View ─────────────────────────────────────────────────────────────────── */

function TickerRow({ items }: { items: TickerItem[] }) {
  return (
    <>
      {items.map((it) => (
        <Link
          key={it.key}
          to={it.to}
          tabIndex={-1}
          className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap px-5 text-[13px] font-medium leading-none text-white no-underline hover:text-white hover:underline sm:text-sm"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.urgent ? "bg-amber-300" : "bg-white/80"}`}
          />
          {it.label}
        </Link>
      ))}
    </>
  );
}

function TickerMarquee({ items }: { items: TickerItem[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null); // hidden single copy, used only to measure
  const groupRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  const pausedRef = useRef(false);

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const [metrics, setMetrics] = useState({ vw: 0, w: 0 });
  const itemsKey = items.map((i) => `${i.key}:${i.label}`).join("|");

  // 1) Measure viewport + one copy of the titles. Re-measure on resize / font load.
  useEffect(() => {
    const vp = viewportRef.current;
    const base = baseRef.current;
    if (!vp || !base) return;
    const measure = () => {
      const vw = vp.clientWidth;
      const w = base.getBoundingClientRect().width;
      setMetrics((m) => (Math.abs(m.vw - vw) < 1 && Math.abs(m.w - w) < 1 ? m : { vw, w }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(base);
    return () => ro.disconnect();
  }, [itemsKey]);

  // How many copies make ONE group at least as wide as the screen (so there is never a gap).
  const copies = metrics.w > 0 ? Math.max(1, Math.ceil(metrics.vw / metrics.w)) : 1;

  // 2) (Re)build the animation. Keeps the current position so refreshes never jump.
  useEffect(() => {
    const track = trackRef.current;
    const group = groupRef.current;
    if (!track || !group || reduceMotion || typeof track.animate !== "function") return;

    const groupWidth = group.getBoundingClientRect().width;
    if (groupWidth < 1) return;

    const duration = (groupWidth / SPEED_PX_PER_SEC) * 1000;
    const prev = animRef.current;
    const progress = prev ? (prev.effect?.getComputedTiming().progress ?? 0) : 0;
    prev?.cancel();

    const anim = track.animate(
      [{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${-groupWidth}px,0,0)` }],
      { duration, iterations: Infinity, easing: "linear" },
    );
    anim.currentTime = (Number(progress) || 0) * duration;
    if (pausedRef.current) anim.pause();
    animRef.current = anim;
  }, [copies, metrics.w, itemsKey, reduceMotion]);

  useEffect(() => () => { animRef.current?.cancel(); animRef.current = null; }, []);

  const setPaused = (p: boolean) => {
    pausedRef.current = p;
    if (p) animRef.current?.pause();
    else animRef.current?.play();
  };

  const group = Array.from({ length: copies }, (_, i) => <TickerRow key={i} items={items} />);

  return (
    <div
      ref={viewportRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`relative h-full w-full ${reduceMotion ? "overflow-x-auto" : "overflow-hidden"}`}
      style={{
        WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)",
        maskImage: "linear-gradient(90deg, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)",
      }}
    >
      {/* invisible single copy — measuring only */}
      <div
        ref={baseRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center"
      >
        <TickerRow items={items} />
      </div>

      <div
        ref={trackRef}
        className="flex h-full w-max items-center will-change-transform"
        style={{ backfaceVisibility: "hidden" }}
      >
        <div ref={groupRef} className="flex shrink-0 items-center">{group}</div>
        {!reduceMotion && (
          <div aria-hidden="true" className="flex shrink-0 items-center">{group}</div>
        )}
      </div>
    </div>
  );
}

export default function NewsTicker() {
  const { items, isLoading } = useTickerItems();

  // Loaded and nothing to announce → no strip at all.
  if (!isLoading && items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Latest updates"
      className="relative h-8 overflow-hidden border-t border-white/10 sm:h-9"
      style={{ background: "linear-gradient(90deg, #14532d 0%, #1f8a55 50%, #14532d 100%)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-gold to-transparent"
      />
      {items.length > 0 && <TickerMarquee items={items} />}
    </div>
  );
}
