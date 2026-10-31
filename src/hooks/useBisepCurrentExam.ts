// src/hooks/useBisepCurrentExam.ts
// Polls /api/bisep-proxy?mode=current to fetch the live BISE Peshawar exam
// title + any pre-announcement countdown text.
//
// Replaces the old build-time VITE_BISEP_EXAM_TITLE env var pattern, which
// was always out of date vs. what BISEP was actually serving. Now the GHS
// homepage + /results page reflect BISEP's live state within seconds.
//
// Server-side: api/bisep-proxy.js (same function as the roll-number lookup —
// keeps the Vercel function count at 12, NOT 13). v7 proxy: good payloads are
// edge-cached 30 s, failures are never cached (no-store), so a transient
// board hiccup can no longer pin a "disconnected" answer to the CDN.
//
// v2 (Oct 28, 2026 — permanent-connection UI fix):
//   The hook now remembers the LAST KNOWN GOOD board state (module var +
//   sessionStorage). When a poll fails or the board is briefly unreachable,
//   the hook keeps serving that last known state (flagged `degraded`) instead
//   of dropping `exam_title` to null — which used to fall through to the
//   stale hardcoded FALLBACK_TITLE ("SSC Annual-I 2026") and made the page
//   LOOK disconnected even while the board was fine moments earlier. The
//   moment a fresh poll succeeds, live data takes over again. If the merged
//   countdown has already elapsed, the state flips to live (results are
//   announced when the countdown ends — deterministic, no guessing).
//
// Fallback chain:
//   1. Live data from /api/bisep-proxy?mode=current
//   2. Last known good board state from this hook (this page, this device)
//   3. VITE_BISEP_EXAM_TITLE env var / hardcoded default (first-ever visit
//      while the board is fully unreachable)

import { useQuery } from "@tanstack/react-query";

export interface BisepCurrentExam {
  ok: boolean;
  is_live: boolean;
  exam_title: string | null;
  exam_year: number | null;
  raw_subheader: string | null;
  countdown_text: string | null;
  countdown_date: string | null; // ISO date string, or null
  fetched_at: string;
  error?: string;
  /** v2 — true when the payload was merged from the last known good state
   *  because the live poll failed. The UI can ignore this; it exists so a
   *  degraded-but-connected state is visible in devtools and tests. */
  degraded?: boolean;
}

// Build-time fallback — kept for resilience. Update this when BISEP
// announces a new exam, but the live proxy should usually override it
// within an hour of BISEP's homepage changing.
const FALLBACK_TITLE =
  (import.meta.env.VITE_BISEP_EXAM_TITLE as string | undefined)?.trim() ||
  "SSC Annual-I 2026";

// ── Last known good board state (survives refetches AND reloads) ───────────
// Only the display fields are remembered — never ok/error/timestamps.
const LAST_GOOD_KEY = "ghs-bisep-last-good-exam-v1";
let memoryLastGood: Partial<BisepCurrentExam> | null = null;

function readLastGood(): Partial<BisepCurrentExam> | null {
  if (memoryLastGood) return memoryLastGood;
  try {
    const raw = sessionStorage.getItem(LAST_GOOD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BisepCurrentExam> | null;
      if (parsed && typeof parsed === "object" && parsed.exam_title) {
        memoryLastGood = parsed;
        return memoryLastGood;
      }
    }
  } catch {
    // Private-mode Safari / quota / corrupted JSON — cache is best-effort.
  }
  return null;
}

function writeLastGood(d: BisepCurrentExam): void {
  memoryLastGood = {
    exam_title: d.exam_title,
    exam_year: d.exam_year,
    raw_subheader: d.raw_subheader,
    is_live: d.is_live,
    countdown_text: d.countdown_text,
    countdown_date: d.countdown_date,
  };
  try {
    sessionStorage.setItem(LAST_GOOD_KEY, JSON.stringify(memoryLastGood));
  } catch {
    // Best-effort only — never fatal.
  }
}

export function useBisepCurrentExam() {
  return useQuery<BisepCurrentExam>({
    queryKey: ["bisep-current-exam"],
    queryFn: async () => {
      const r = await fetch("/api/bisep-proxy?mode=current", {
        headers: { Accept: "application/json" },
      });
      // Defensive JSON parsing — same pattern as the BiseResultSearch
      // component uses for the roll-number lookup. Vercel itself can return
      // an HTML error page if the function crashes, and we must never let
      // that crash the React tree.
      let raw: unknown = null;
      try {
        raw = await r.json();
      } catch {
        raw = null;
      }
      const data: BisepCurrentExam =
        raw && typeof raw === "object"
          ? (raw as BisepCurrentExam)
          : {
              ok: false,
              is_live: false,
              exam_title: null,
              exam_year: null,
              raw_subheader: null,
              countdown_text: null,
              countdown_date: null,
              fetched_at: new Date().toISOString(),
              error: "Invalid response from BISE Peshawar proxy.",
            };

      // ── v2 permanent-connection merge ──────────────────────────────────
      if (data.ok && data.exam_title) {
        // Fresh good data — remember it and hand it straight through.
        writeLastGood(data);
        return data;
      }

      const lastGood = readLastGood();
      if (lastGood && lastGood.exam_title) {
        // Poll failed but we KNOW the board's last real state — keep the
        // page connected to it instead of flashing the stale fallback title.
        const merged: BisepCurrentExam = {
          ...data,
          ...lastGood,
          ok: true,
          degraded: true,
          fetched_at: new Date().toISOString(),
        };
        // Deterministic flip: an elapsed countdown means results are out.
        if (
          merged.countdown_date &&
          !Number.isNaN(Date.parse(merged.countdown_date)) &&
          Date.now() >= Date.parse(merged.countdown_date)
        ) {
          merged.is_live = true;
        }
        return merged;
      }

      return data;
    },
    // PERF (per-navigation refetch storm fix): this hook mounts in the Navbar,
    // and every page renders its own <PageLayout> — so the Navbar (and this
    // query) REMOUNTS on every route change. With staleTime: 0 that meant a
    // fresh /api/bisep-proxy request on every single navigation AND on every
    // tab focus, stacked on top of whatever the destination page was loading
    // — one of the causes of pages "feeling stuck" right after a tap.
    //
    // Freshness is NOT driven by staleTime here: the adaptive refetchInterval
    // below fires on its own cadence regardless of staleness (60 s baseline,
    // 15 s / 1 s near the countdown end), so the exact-moment live flip is
    // completely unchanged. 45 s simply lets a remount inside the quiet window
    // serve the cached answer instead of re-asking the proxy.
    staleTime: 45 * 1000,
    // Adaptive polling (every visitor runs this via the navbar, so the quiet cadence matters):
    //   • more than 10 min before the countdown ends (or no countdown) → once a minute
    //   • last 10 minutes → every 15 s
    //   • last 90 seconds → every second, to catch the exact moment BISEP flips
    refetchInterval: (query) => {
      const data = query.state.data as BisepCurrentExam | undefined;
      if (data?.countdown_date) {
        const msLeft = new Date(data.countdown_date).getTime() - Date.now();
        if (msLeft <= 90 * 1000) return 1000;
        if (msLeft <= 10 * 60 * 1000) return 15 * 1000;
      }
      return 60 * 1000;
    },
    // Never poll a hidden tab. React Query refetches on focus anyway, so a countdown/title change
    // is picked up the moment the visitor comes back to the tab.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Keep showing the previous data while refetching so the UI never
    // flickers to "loading" mid-session.
    placeholderData: (prev) => prev,
    // v2: two quick retries — with the proxy no longer edge-caching failures,
    // a retry is a genuinely fresh upstream attempt, so one extra spaced try
    // converts most transient hiccups into success without any UI change.
    retry: 2,
    retryDelay: (attempt) => Math.min(4000, 600 * (attempt + 1)),
  });
}

/**
 * Convenience hook — returns just the display title, with the fallback chain
 * already applied. Use this in components that only care about the title
 * string (e.g. the <h2> in BiseResultSearch).
 */
export function useBisepExamTitle(): string {
  const { data } = useBisepCurrentExam();
  return data?.exam_title || FALLBACK_TITLE;
}

export { FALLBACK_TITLE };
