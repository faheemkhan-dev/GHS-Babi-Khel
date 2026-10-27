import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * "X people are typing…" counter for the Results search box (Facebook style).
 *
 * Built to be nearly free on the Supabase free plan:
 *  • LAZY — no Realtime connection exists until a visitor focuses the roll
 *    number field. Page views that never touch the field cost nothing.
 *  • Uses Realtime Presence only: zero database queries, zero tables.
 *  • A visitor counts as "typing" only while focused / recently active; after
 *    IDLE_MS without a keystroke they are untracked, and after LEAVE_MS of
 *    being idle or blurred the channel is fully closed again.
 *  • Closes when the tab is hidden, and fails silently (count stays 0 and the
 *    UI shows nothing) — the results search never depends on this.
 */
const CHANNEL = "results-typing-presence";
const IDLE_MS = 8_000;    // no keystroke for this long → stop counting me
const LEAVE_MS = 20_000;  // idle/blurred this long → close the connection
const MAX_SHOWN = 99;

export function useTypingPresence() {
  const [count, setCount] = useState(0);
  const chRef = useRef<RealtimeChannel | null>(null);
  const readyRef = useRef(false);
  const typingRef = useRef(false);
  const keyRef = useRef(`v-${Math.random().toString(36).slice(2, 10)}`);
  const idleT = useRef<number>();
  const leaveT = useRef<number>();
  const syncT = useRef<number>();

  const track = useCallback((typing: boolean) => {
    const ch = chRef.current;
    if (!ch || !readyRef.current || typingRef.current === typing) return;
    typingRef.current = typing;
    try {
      if (typing) void ch.track({ typing: true });
      else void ch.untrack();
    } catch { /* ignore */ }
  }, []);

  const close = useCallback(() => {
    window.clearTimeout(idleT.current);
    window.clearTimeout(leaveT.current);
    window.clearTimeout(syncT.current);
    const ch = chRef.current;
    chRef.current = null;
    readyRef.current = false;
    typingRef.current = false;
    setCount(0);
    if (ch) { try { void supabase.removeChannel(ch); } catch { /* ignore */ } }
  }, []);

  const open = useCallback(() => {
    if (chRef.current) return;
    try {
      const ch = supabase.channel(CHANNEL, { config: { presence: { key: keyRef.current } } });
      chRef.current = ch;
      ch.on("presence", { event: "sync" }, () => {
        // Coalesce bursts of sync events into one state update.
        window.clearTimeout(syncT.current);
        syncT.current = window.setTimeout(() => {
          const state = ch.presenceState() as Record<string, { typing?: boolean }[]>;
          const n = Object.values(state).filter(list => list.some(p => p.typing)).length;
          setCount(Math.min(n, MAX_SHOWN));
        }, 250);
      }).subscribe((status) => {
        if (status === "SUBSCRIBED") {
          readyRef.current = true;
          if (document.activeElement?.id === "result-roll-input") { typingRef.current = false; track(true); }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          readyRef.current = false;
          setCount(0);
        }
      });
    } catch { chRef.current = null; }
  }, [track]);

  const armTimers = useCallback(() => {
    window.clearTimeout(idleT.current);
    window.clearTimeout(leaveT.current);
    idleT.current = window.setTimeout(() => track(false), IDLE_MS);
    leaveT.current = window.setTimeout(close, LEAVE_MS);
  }, [track, close]);

  /** Call on input focus. */
  const onFocus = useCallback(() => { open(); track(true); armTimers(); }, [open, track, armTimers]);
  /** Call on every keystroke / change. */
  const onType = useCallback(() => { open(); track(true); armTimers(); }, [open, track, armTimers]);
  /** Call on input blur — stop counting right away, close shortly after. */
  const onBlur = useCallback(() => {
    track(false);
    window.clearTimeout(idleT.current);
    window.clearTimeout(leaveT.current);
    leaveT.current = window.setTimeout(close, 5_000);
  }, [track, close]);

  useEffect(() => {
    const onVis = () => { if (document.hidden) close(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); close(); };
  }, [close]);

  return { count, onFocus, onType, onBlur };
}
