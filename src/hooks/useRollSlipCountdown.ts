/**
 * useRollSlipCountdown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared live-countdown state for Exam Roll No. Slips.
 *
 * Used by BOTH the site Navbar (compact countdown chip / strip on the
 * "Roll No. Slip" link) and the public /roll-no-slip page, so every corner
 * of the site shows the exact same scheduled session and the same remaining
 * time, ticking every second.
 *
 * HOW PUBLISHING WORKS NOW (see AdminExamRollNumbers.saveCountdown):
 *   Setting a countdown writes is_published=true + publish_at=<future> in a
 *   SINGLE update. The roll-number data is therefore fully prepared and
 *   readable the moment the countdown starts — so when it reaches zero the
 *   student's UI flips instantly (pure client-side state change, zero
 *   network round-trip, no "Publishing now..." limbo, nothing to wait for).
 *
 * This hook only reports WHICH session is scheduled; consumers decide how
 * to render it (chip, strip, badge, big countdown panel...).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface RollSlipSession {
  id: string;
  title: string;
  exam_year: number;
  exam_term: string;
  class_order: string[] | null;
  is_published: boolean;
  publish_at: string | null;
  countdown_label: string | null;
}

/** Live 1-second "now" ticker (starts immediately, cleans itself up). */
export function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Returns the NEXT scheduled roll-slip session (the one with the earliest
 * publish_at still in the future), or null when nothing is being counted
 * down. Also refetches periodically so admin-side changes (cancel / set a
 * new countdown) propagate to every open tab within ~30s.
 */
export function useRollSlipCountdown() {
  const { data: sessions = [] } = useQuery<RollSlipSession[]>({
    queryKey: ["roll-slip-countdown"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_roll_sessions")
        .select("id, title, exam_year, exam_term, class_order, is_published, publish_at, countdown_label")
        .or("is_published.eq.true,publish_at.not.is.null")
        .order("publish_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const now = useNowTick();

  let scheduled: RollSlipSession | null = null;
  for (const s of sessions) {
    if (!s.publish_at) continue;
    const t = new Date(s.publish_at).getTime();
    if (t > now) { scheduled = s; break; } // rows are ordered by publish_at asc
  }

  return { scheduled, sessions, now };
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

/** Compact chip/strip text: "2d 05h 09m" or "02:05:09" under a day. */
export function compactCountdown(diffMs: number): string {
  const { d, h, m, s } = splitCountdown(diffMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
