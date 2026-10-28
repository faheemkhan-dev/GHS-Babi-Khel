import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Live "X people are typing…" counter for the Results search box.
 *
 * Free-plan friendly:
 *  • LAZY — no Realtime connection exists until a visitor first focuses the
 *    roll number field. Visitors who never touch the field cost nothing.
 *  • Presence only: zero database queries, zero tables.
 *  • ONE shared channel per browser tab (module singleton), however many
 *    search boxes are mounted.
 *  • Once engaged, a visitor stays counted while they search and read their
 *    result card, until they leave the page / close the tab. If the tab is
 *    hidden the connection is dropped, and restored when they come back.
 *  • Fails silently: on any Realtime error the line just hides.
 */
const CHANNEL = "results-typing-presence";
const MAX_SHOWN = 99;
const PEER_KEY = `v-${Math.random().toString(36).slice(2, 10)}`;

let channel: RealtimeChannel | null = null;
let ready = false;
let remote = 0;                    // distinct visitors currently counted
const engaged = new Set<symbol>(); // search boxes in this tab that were focused
const listeners = new Set<() => void>();
let syncTimer: number | undefined;

const emit = () => listeners.forEach(l => l());

function open() {
  if (channel || document.hidden) return;
  try {
    const ch = supabase.channel(CHANNEL, { config: { presence: { key: PEER_KEY } } });
    channel = ch;
    ch.on("presence", { event: "sync" }, () => {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        const state = ch.presenceState() as Record<string, { typing?: boolean }[]>;
        remote = Math.min(Object.values(state).filter(l => l.some(p => p.typing)).length, MAX_SHOWN);
        emit();
      }, 80);
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ready = true;
        if (engaged.size) void ch.track({ typing: true });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        ready = false; remote = 0; emit();
      }
    });
  } catch { channel = null; }
}

function close() {
  window.clearTimeout(syncTimer);
  const ch = channel;
  channel = null; ready = false; remote = 0;
  emit();
  if (ch) { try { void supabase.removeChannel(ch); } catch { /* ignore */ } }
}

function onVisibility() {
  if (document.hidden) close();
  else if (engaged.size) open();
}
let visBound = false;

export function useTypingPresence() {
  const id = useRef(Symbol("typing")).current;

  const count = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => remote,
    () => 0,
  );

  /** Call when the roll number field is focused / used. */
  const engage = useCallback(() => {
    if (!visBound) { document.addEventListener("visibilitychange", onVisibility); visBound = true; }
    if (!engaged.has(id)) { engaged.add(id); emit(); }
    open();
    if (ready && channel) { try { void channel.track({ typing: true }); } catch { /* ignore */ } }
  }, [id]);

  // Leaving the page (unmount) releases this visitor.
  useEffect(() => () => {
    engaged.delete(id);
    if (engaged.size === 0) close();
  }, [id]);

  const isEngaged = engaged.has(id);
  // Optimistic: the visitor sees themselves counted instantly on focus,
  // before the first Presence sync arrives.
  const shown = isEngaged ? Math.max(count, 1) : count;
  return { count: shown, engaged: isEngaged, engage };
}
