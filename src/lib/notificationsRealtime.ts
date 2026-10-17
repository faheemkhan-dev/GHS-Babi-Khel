// src/lib/notificationsRealtime.ts
// ─────────────────────────────────────────────────────────────────────────────
// ONE shared, ref-counted Supabase Realtime channel for the notifications
// table. Every component that needs live notification events (the desktop
// NotificationBell, the mobile bottom-dock NotificationBell, and the
// NotificationsPanel) registers a handler here instead of creating its own
// channel.
//
// WHY THIS EXISTS (root cause of the "This page couldn't load" crash):
//   Navbar mounts TWO NotificationBell instances (desktop header + mobile
//   dock). Both ran `supabase.channel("live-notifications").on(...).subscribe()`.
//   supabase-js returns the ALREADY-REGISTERED channel for a repeated topic
//   name, and calling .on("postgres_changes") on a channel that has already
//   been subscribed throws synchronously:
//
//     "cannot add `postgres_changes` callbacks for realtime:live-notifications
//      after `subscribe()`"
//
//   The second bell's throw propagated up into React's render → the whole
//   route was torn down into RouteErrorBoundary ("This page couldn't load").
//   It happened ONLY for signed-in visitors (the subscription effect is
//   auth-gated) and only AFTER the auth session resolved a couple of seconds
//   after load — which is why the crash looked like a random "2–3 seconds
//   after opening" failure, while anonymous testing always passed.
//
// SAFETY PROPERTY: .on() callbacks are attached ONLY to a brand-new channel
// that has never been subscribed. Additional consumers reuse the existing
// subscription and never touch .on() again, so this failure mode is now
// structurally impossible — no matter how many bells mount, unmount, or
// re-render.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";

export type NotificationRealtimeEvent = { kind: "insert" | "update" };

type Handler = (event: NotificationRealtimeEvent) => void;

const handlers = new Set<Handler>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let refs = 0;

function dispatch(kind: "insert" | "update") {
  handlers.forEach((handler) => {
    try {
      handler({ kind });
    } catch {
      /* one broken listener must never affect the others */
    }
  });
}

/**
 * Register a live-event handler for the notifications table. Returns an
 * unsubscribe function (idempotent — safe to call twice, safe in React
 * StrictMode double-effect cycles).
 */
export function subscribeNotificationsRealtime(handler: Handler): () => void {
  handlers.add(handler);
  refs += 1;

  // Lazily create the shared channel ONCE. .on() is only ever called here,
  // on a channel that has not been subscribed yet.
  if (!channel) {
    channel = supabase
      .channel("live-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => dispatch("insert")
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        () => dispatch("update")
      )
      .subscribe();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    handlers.delete(handler);
    refs = Math.max(0, refs - 1);
    // Last consumer gone — tear the channel down. The NEXT subscriber gets
    // a brand-new channel, so .on() before .subscribe() stays valid.
    if (refs === 0 && channel) {
      const ch = channel;
      channel = null;
      supabase.removeChannel(ch);
    }
  };
}
