// src/hooks/useBisepCurrentExam.ts
// Polls /api/bisep-proxy?mode=current every 15 seconds to fetch the live
// BISE Peshawar exam title + any pre-announcement countdown text.
//
// Replaces the old build-time VITE_BISEP_EXAM_TITLE env var pattern, which
// was always out of date vs. what BISEP was actually serving. Now the GHS
// homepage + /results page reflect BISEP's live state within seconds.
//
// Server-side: api/bisep-proxy.js (same function as the roll-number lookup —
// keeps the Vercel function count at 12, NOT 13). Caching has been removed
// server-side (Cache-Control: no-store), so every poll fetches BISEP's
// homepage fresh — there is no CDN layer masking a change.
//
// Fallback chain:
//   1. Live data from /api/bisep-proxy?mode=current (no caching, live fetch)
//   2. VITE_BISEP_EXAM_TITLE env var (build-time fallback, still useful if
//      the proxy is down or BISEP's homepage structure changes)
//   3. Hardcoded "HSSC Annual-II 2025" (last resort)

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
}

// Build-time fallback — kept for resilience. Update this when BISEP
// announces a new exam, but the live proxy should usually override it
// within an hour of BISEP's homepage changing.
const FALLBACK_TITLE =
  (import.meta.env.VITE_BISEP_EXAM_TITLE as string | undefined)?.trim() ||
  "SSC Annual-I 2026";

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
      return data;
    },
    // Data is considered stale immediately — the server no longer caches
    // this response (Cache-Control: no-store), so every fetch is live.
    staleTime: 0,
    // Adaptive polling: normally poll every 15s, but once the countdown is
    // within 60 seconds of finishing, switch to polling every 1 SECOND so
    // the new title/live-result state is picked up as close to instantly
    // as an HTTP poll allows the moment BISEP's countdown hits zero.
    refetchInterval: (query) => {
      const data = query.state.data as BisepCurrentExam | undefined;
      if (data?.countdown_date) {
        const msLeft = new Date(data.countdown_date).getTime() - Date.now();
        if (msLeft <= 60 * 1000) {
          return 1000; // final minute: poll every second
        }
      }
      return 15 * 1000; // default cadence
    },
    // Keep polling even when the tab isn't focused, so a countdown/title
    // change is picked up the moment the user comes back to the tab.
    refetchIntervalInBackground: true,
    // Keep showing the previous data while refetching so the UI never
    // flickers to "loading" mid-session.
    placeholderData: (prev) => prev,
    retry: 1,
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
