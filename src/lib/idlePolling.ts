// src/lib/idlePolling.ts — "poll only while somebody is actually using the page"
// ═══════════════════════════════════════════════════════════════════════════
// Problem: a tab left open (an admin on Fee Management, Exam Seating, the
// dashboard…) kept refetching every 10 s – 5 min for hours, even though nobody
// was there. On the Nano compute those idle polls add up.
//
// Fix: `idleAware(ms, idleAfterMs)` is a drop-in `refetchInterval`.
//   • tab hidden                          → no polling (as before)
//   • no tap/click/key/scroll/mutation for `idleAfterMs` → polling pauses
//   • the next real interaction           → stale active queries refresh
//     immediately and polling resumes by itself
// Realtime channels and mutations are untouched, so live screens still update
// instantly; only the blind "safety-net" timer goes quiet when nobody is there.
// ═══════════════════════════════════════════════════════════════════════════
import type { QueryClient } from "@tanstack/react-query";

let lastActive = Date.now();
let wasIdle = false;
const RESUME_AFTER_MS = 3 * 60_000; // a gap this long counts as "was away"

export const markActive = () => { lastActive = Date.now(); };

/** Use as `refetchInterval: idleAware(2 * 60_000)`. */
export function idleAware(ms: number, idleAfterMs = 5 * 60_000) {
  return (): number | false => {
    if (typeof document !== "undefined" && document.hidden) return false;
    return Date.now() - lastActive > idleAfterMs ? false : ms;
  };
}

let started = false;
/** Call once at startup (App.tsx). Safe to call twice. */
export function startActivityTracking(qc: QueryClient): void {
  if (started || typeof window === "undefined") return;
  started = true;

  let lastWrite = 0;
  const onActivity = () => {
    const now = Date.now();
    if (now - lastWrite < 1000) return; // throttle: at most 1 write / second
    lastWrite = now;
    const away = now - lastActive > RESUME_AFTER_MS;
    lastActive = now;
    if (away || wasIdle) {
      wasIdle = false;
      // Back after a break: refresh whatever is on screen and stale; this also
      // re-arms the paused refetchInterval timers.
      void qc.refetchQueries({ type: "active", stale: true });
    }
  };
  const opts: AddEventListenerOptions = { passive: true, capture: true };
  ["pointerdown", "keydown", "touchstart", "wheel", "scroll"].forEach(ev =>
    window.addEventListener(ev, onActivity, opts));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) onActivity(); });

  // Any save/scan/upload (mutation) is activity too — e.g. camera attendance
  // scanning produces mutations without touching the screen.
  qc.getMutationCache().subscribe(e => { if (e.type === "added" || e.type === "updated") lastActive = Date.now(); });

  // Remember that polling went quiet, so the next activity refreshes.
  window.setInterval(() => { if (Date.now() - lastActive > 5 * 60_000) wasIdle = true; }, 60_000);
}
