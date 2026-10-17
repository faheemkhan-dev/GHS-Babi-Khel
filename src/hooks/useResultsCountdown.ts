/**
 * useResultsCountdown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared live-countdown state for scheduled Result publishes (school / BISE
 * Peshawar results).
 *
 * Mirrors useRollSlipCountdown.ts so the Navbar can show a "Results in
 * HH:MM:SS" strip above the announcements ticker, exactly the way the
 * Roll No. Slip countdown already works — same polling cadence, same
 * "flip to LIVE for a short grace period, then hide" behavior.
 *
 * Reads from the same `results` table / publish_at schedule the homepage's
 * auto-publish watcher already uses, just grouped down to "what's the very 
 * next publish moment" for display purposes.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ResultsSchedule {
  publish_at: string;
  exam_type: string | null;
  year: number | null;
  classes: string[];
}

/** Live 1-second "now" ticker (starts immediately, cleans itself up). */
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Returns the NEXT scheduled results publish (earliest publish_at still in
 * the future), or null when nothing is being counted down.
 */
export function useResultsCountdown() {
  const { data: schedules = [] } = useQuery<ResultsSchedule[]>({
    queryKey: ["results-countdown-strip"],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("results")
        .select("class, exam_type, year, publish_at")
        .eq("is_published", false)
        .not("publish_at", "is", null)
        .gt("publish_at", now)
        .order("publish_at", { ascending: true });
      if (error) throw error;
      if (!data || data.length === 0) return [];
      const byPublishAt = new Map<string, ResultsSchedule>();
      for (const r of data) {
        const key = r.publish_at as string;
        if (!byPublishAt.has(key)) {
          byPublishAt.set(key, { publish_at: key, exam_type: r.exam_type, year: r.year, classes: [r.class] });
        } else {
          byPublishAt.get(key)!.classes.push(r.class);
        }
      }
      return Array.from(byPublishAt.values()).sort((a, b) => a.publish_at.localeCompare(b.publish_at));
    },
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const now = useNowTick();
  const scheduled = schedules.length > 0 ? schedules[0] : null;

  return { scheduled, schedules, now };
}

/** Split a millisecond diff into zero-padded d / h / m / s parts. */
export function splitCountdown(diffMs: number) {
  const clamped = Math.max(0, diffMs);
  return {
    d: Math.floor(clamped / 86400000),
    h: Math.floor((clamped % 86400000) / 3600000),
    m: Math.floor((clamped % 3600000) / 60000),
    s: Math.floor((clamped % 60000) / 1000),
  };
}

/** Compact strip text: "2d 05h 09m" or "02:05:09" under a day. */
export function compactCountdown(diffMs: number): string {
  const { d, h, m, s } = splitCountdown(diffMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
