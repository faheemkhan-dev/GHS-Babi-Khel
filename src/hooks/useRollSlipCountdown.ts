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
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cachedOrDirect } from "@/lib/publicData";
import type { ExamSession, RollEntry } from "@/lib/rollSlipTypes";

/** The full session row (same shape the /roll-no-slip page needs). */
export type RollSlipSession = ExamSession;

/**
 * "now" that only changes when something actually happens: the next time in
 * `times` is reached (or the tab wakes up). Unlike a 1-second ticker it causes
 * ZERO re-renders while nothing is changing — important because this hook runs
 * in the Navbar, which is on every page.
 */
export function useBoundaryNow(times: number[]): number {
  const [now, setNow] = useState(() => Date.now());
  const key = times.join(",");
  useEffect(() => {
    const upcoming = times.filter((t) => t > now);
    if (upcoming.length === 0) return;
    const delay = Math.min(Math.min(...upcoming) - Date.now() + 60, 2_000_000_000);
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, delay));
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, now]);
  useEffect(() => {
    // Timers are throttled while a tab sleeps — re-sync the moment it wakes.
    const wake = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", wake);
    return () => document.removeEventListener("visibilitychange", wake);
  }, []);
  return now;
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
 * Returns the sessions table (published + scheduled) — ONE shared query for
 * the Navbar chip/strip AND the public /roll-no-slip page, so opening the
 * page never re-fetches what the navbar already has in the React Query
 * cache (previously the page kept a SECOND, identical request under a
 * different key — two round trips for the same rows on every visit).
 *
 * Ordering is created_at DESC (newest first — the /roll-no-slip page's
 * semantics for "first live session"); the scheduled pick below is
 * order-independent.
 */
export function useRollSlipCountdown() {
  const { data: sessions = [], isLoading } = useQuery<RollSlipSession[]>({
    queryKey: ["roll-slip-countdown"],
    queryFn: async () =>
      // Cached public read (a few seconds at the edge) — every visitor's
      // Navbar chip shares one DB read.
      cachedOrDirect<RollSlipSession[]>("roll-sessions", {}, async () => {
        const { data, error } = await supabase
          .from("exam_roll_sessions")
          .select("*")
          .or("is_published.eq.true,publish_at.not.is.null")
          .order("created_at", { ascending: false });
        if (error) throw error;
        return data ?? [];
      }),
    // The countdown flips locally at its boundary, but an admin can press
    // "Go Live" early. While a countdown is running, re-check every 5 s so
    // students see the slips seconds after the release (the read is cached
    // for 3 s at the edge, so this costs the database almost nothing).
    staleTime: 15 * 1000,
    refetchInterval: (query) => {
      const rows = (query.state.data as RollSlipSession[] | undefined) ?? [];
      const counting = rows.some((s) => s.publish_at && new Date(s.publish_at).getTime() > Date.now());
      return counting ? 5 * 1000 : 5 * 60 * 1000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const now = useBoundaryNow(sessions.map((s) => (s.publish_at ? new Date(s.publish_at).getTime() : 0)));

  // Earliest still-future publish_at — independent of row order.
  let scheduled: RollSlipSession | null = null;
  let scheduledTs = Infinity;
  for (const s of sessions) {
    if (!s.publish_at) continue;
    const t = new Date(s.publish_at).getTime();
    if (t > now && t < scheduledTs) {
      scheduled = s;
      scheduledTs = t;
    }
  }

  return { scheduled, sessions, now, isLoading };
}

/* ── Shared roll-number fetcher + hover-prefetch ────────────────────────────
   Used by the /roll-no-slip page AND by the Navbar's intent prefetch, so a
   student who hovers/touches the "Roll No. Slip" link starts downloading
   the roster before the tap completes — the slip finder is then ready in
   ONE network round trip (sessions are already cached by the navbar).   */
export async function fetchPublicRolls(sessionId: string): Promise<RollEntry[]> {
  // Phase 5: the roster for a session is public, immutable once published and
  // the single biggest roll-slip response — cached for 120 s at the edge.
  return cachedOrDirect<RollEntry[]>("roll-roster", { session: sessionId }, async () => {
    const { data, error } = await supabase
      .from("exam_roll_numbers")
      .select("id, student_id, student_name, father_name, class, class_roll_no, exam_roll_no, serial_number")
      .eq("session_id", sessionId)
      .order("serial_number", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });
}

/** Warm the roster for a session (idempotent, respects staleTime). */
export function prefetchPublicRolls(qc: QueryClient, sessionId: string | undefined | null) {
  if (!sessionId) return;
  void qc.prefetchQuery({
    queryKey: ["public-exam-rolls", sessionId],
    queryFn: () => fetchPublicRolls(sessionId),
    staleTime: 5 * 60 * 1000,
  });
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
