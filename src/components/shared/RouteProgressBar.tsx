import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// RouteProgressBar — a slim, YouTube-style top loading bar for in-app
// navigation. Pairs with two things in App.tsx:
//
//   1. lazyWithRetry(), which broadcasts "ghs-route-chunk" events
//      (start / end) every time a route's JS chunk begins or finishes
//      downloading, and
//   2. v7_startTransition, which keeps the CURRENT page visible while that
//      chunk downloads (instead of unmounting the whole app into the white
//      RouteLoadingFallback — the "fake full-page reload" on slow internet).
//
// Because the old page now stays on screen, this bar is the visual
// confirmation that a tap actually started a navigation. It never blocks
// input (pointer-events: none), sits above every overlay (z-index 9999),
// and is driven entirely by events — so it works during transitions,
// back/forward (popstate) and first paints alike.
//
// State machine:
//   idle → running (glides to ~85% asymptotically)
//        → (optional) slow after 5 s — amber tint, keeps going
//        → completing (jump to 100 %, fade out, reset) — when every
//          in-flight chunk has finished.
//
// Concurrent loads are ref-counted, so fast double-taps or redirect chains
// can never make the bar "finish" while another chunk is still downloading.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_CHUNK_EVENT = "ghs-route-chunk";
const SLOW_AFTER_MS = 5000;

type Phase = "idle" | "running" | "completing";

interface ChunkEventDetail {
  phase?: "start" | "end";
}

export default function RouteProgressBar() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState(0);
  const [slow, setSlow] = useState(false);

  // Ref-count of in-flight route-chunk downloads.
  const pending = useRef(0);
  // Timers for the glide animation, the slow-state promotion and the
  // completing→idle reset — all cleaned up on unmount.
  const glideTimer = useRef<number | null>(null);
  const slowTimer = useRef<number | null>(null);
  const resetTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const clear = (t: number | null) => {
      if (t !== null) window.clearInterval(t);
    };

    const stopTimers = () => {
      clear(glideTimer.current);
      clear(slowTimer.current);
      glideTimer.current = null;
      slowTimer.current = null;
    };

    const startBar = () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
      setSlow(false);
      setWidth(8);
      setPhase("running");

      // Asymptotic glide: each tick moves ~40 % of the remaining distance
      // toward 85 %, so the bar always looks alive but never "finishes"
      // on its own. Purely visual — real completion comes from events.
      glideTimer.current = window.setInterval(() => {
        setWidth((w) => w + (85 - w) * 0.4);
      }, 250);

      slowTimer.current = window.setTimeout(() => {
        if (mounted.current) setSlow(true);
      }, SLOW_AFTER_MS);
    };

    const finishBar = () => {
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current > 0) return; // another chunk is still in flight

      stopTimers();
      setSlow(false);
      setWidth(100);
      setPhase("completing");
      resetTimer.current = window.setTimeout(() => {
        if (!mounted.current) return;
        setPhase("idle");
        setWidth(0);
        resetTimer.current = null;
      }, 350); // let the 100 % frame paint, then fade + reset
    };

    const onChunkEvent = (event: Event) => {
      const detail = (event as CustomEvent<ChunkEventDetail>).detail;
      if (detail?.phase === "start") {
        pending.current += 1;
        // A fresh start while completing (very fast double navigation):
        // treat the previous run as finished and begin a new bar.
        if (pending.current === 1) startBar();
      } else if (detail?.phase === "end") {
        finishBar();
      }
    };

    window.addEventListener(ROUTE_CHUNK_EVENT, onChunkEvent);
    return () => {
      mounted.current = false;
      window.removeEventListener(ROUTE_CHUNK_EVENT, onChunkEvent);
      stopTimers();
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  const visible = phase !== "idle";

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[9999] pointer-events-none"
      style={{ height: 3 }}
    >
      {/* Track — invisible until the bar runs, so it never draws attention
          when there is nothing loading. */}
      <div
        className="h-full w-full origin-left transition-opacity duration-200"
        style={{
          opacity: visible ? 1 : 0,
          background: "transparent",
        }}
      >
        <div
          className="h-full will-change-transform"
          style={{
            width: `${width}%`,
            transform: `translateX(0)`,
            transition:
              phase === "completing"
                ? "width 200ms ease-out"
                : "width 250ms ease-out",
            background: slow
              ? "linear-gradient(90deg, #B8860B, #E9C46A)"
              : "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--gold)))",
            boxShadow:
              "0 0 8px rgba(184, 134, 11, 0.55), 0 0 2px rgba(184, 134, 11, 0.8)",
            borderRadius: "0 2px 2px 0",
          }}
        />
      </div>
    </div>
  );
}
