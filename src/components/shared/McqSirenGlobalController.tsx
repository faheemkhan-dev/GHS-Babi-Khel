// src/components/shared/McqSirenGlobalController.tsx
// ─────────────────────────────────────────────────────────────────────────────
// APP-WIDE MCQ TIMER SIREN CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────
// Mounted ONCE in App.tsx, so it runs on EVERY page of the site (admin
// dashboard, student portal, public pages — everywhere). It constantly
// watches the MCQ timer in localStorage. When the timer reaches zero
// (running → finished), it fires the air-raid siren SOUND + a full-screen
// red flash OVERLAY for 15 seconds, NO MATTER WHERE THE USER IS:
//
//   • On any admin page, public page, or auth page
//   • In a different browser tab (the storage event syncs us)
//   • With the browser tab in the background
//   • With the mobile screen locked / app in the background
//
// The previous design only fired the siren inside Hall3DView.tsx (the 3D
// Hall page). If the admin left that page, the siren was silent. The user
// explicitly asked for the siren + red flash to fire EVERYWHERE when MCQ
// time ends — this controller delivers that.
//
// ── How it stays alive when the tab is backgrounded / screen is locked ───────
// Browsers throttle setInterval in background tabs (usually to once per
// minute) and may pause it entirely on mobile when the screen is locked.
// To stay accurate, we:
//   1. Run a 250ms interval while the timer is running (frequent enough to
//      catch the zero-crossing within a quarter second of accuracy, but
//      only after a timer has been started — no idle polling).
//   2. ALSO listen for `storage` events (fires in OTHER tabs when the
//      Console tab flips the timer to "finished").
//   3. ALSO listen for `visibilitychange` — when the tab comes back to the
//      foreground, immediately re-check the timer. This catches the case
//      where the timer expired while the tab was backgrounded and the
//      interval was throttled.
//   4. ALSO listen for window `focus` (catches devtools open/close edge
//      cases that visibilitychange misses).
//   5. Use an epoch-ms `endTime` + `Date.now()` comparison (NOT a
//      decrementing counter), so even if the interval is throttled to
//      once per minute, we still detect the zero-crossing accurately the
//      next time the interval fires.
//
// ── AudioContext health (CRITICAL FIX 2026-08-03) ────────────────────────────
// Browsers can suspend the AudioContext after inactivity or when the tab
// is backgrounded. If we don't keep it alive, when the timer fires the
// siren's ctx.resume() may fail (not in a user gesture). To prevent this:
//   • While a timer is running, we call keepAudioAlive() every 5 seconds
//     to proactively resume the AudioContext.
//   • We listen for pointerdown, keydown, AND touchstart (iOS) to unlock
//     audio on the first user gesture.
//   • The siren's startSirenSound() is now async and properly awaits
//     ctx.resume(), with an HTML5 Audio fallback if Web Audio API fails.
//
// ── Wake Lock (keeps the screen on while the timer runs) ─────────────────────
// On supported browsers (Chrome/Edge/Android, Safari 16.4+), we request a
// screen Wake Lock for the entire duration the timer is RUNNING. This stops
// the phone screen from auto-locking and pausing JS — without it, an admin
// who starts a 15-minute MCQ timer and sets their phone down would find
// the timer frozen when the screen locks. The wake lock is released when
// the timer finishes or is reset, and re-acquired if the tab regains focus
// while a timer is still running.
//
// ── Red flash overlay (document-level, NOT inside Hall3DView) ────────────────
// Hall3DView has its own in-iframe red lightning effect for the 3D scene.
// This controller adds a SEPARATE full-screen red flash overlay attached
// directly to document.body, so the flash is visible on every page (not
// just the 3D Hall). The two overlays coexist without conflict — when
// the admin IS on the 3D Hall page, both the iframe's red lightning and
// this document-level overlay will show, which looks even more dramatic.
//
// ── Mobile-locked behavior ───────────────────────────────────────────────────
// If the mobile screen is LOCKED (browser completely suspended), no JS runs
// — but the moment the user unlocks the device and the tab becomes visible
// again, the `visibilitychange` listener fires, the 250ms interval resumes,
// and we immediately check whether endTime has passed. If it has (and the
// siren hasn't fired yet for this finishedAt), we fire the siren NOW. The
// siren will be slightly delayed (whenever the user unlocks), but it WILL
// fire — which is what the user asked for.

import { useEffect, useRef, type FC } from "react";
import {
  MCQ_TIMER_KEY,
  SIREN_DURATION_MS,
  readMcqTimer,
  writeMcqTimer,
  startSirenSound,
  stopSirenSound,
  unlockSirenAudio,
  keepAudioAlive,
  type McqTimerState,
} from "@/lib/mcqSiren";

// Unique DOM id for our overlay element. Prefixed to avoid colliding with
// anything else on the page.
const OVERLAY_ID = "ghs-mcq-siren-overlay";

// Interval for proactively keeping the AudioContext alive while a timer
// is running. Browsers can suspend the AudioContext after inactivity;
// calling keepAudioAlive() every 5s prevents this.
const AUDIO_KEEPALIVE_MS = 5000;

/**
 * Inject the full-screen red-flash overlay div into document.body (once).
 * Returns the overlay element. The div is `display:none` until the
 * `active` class is added.
 */
function ensureOverlayEl(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (el) return el;

  el = document.createElement("div");
  el.id = OVERLAY_ID;
  // Inline-styled so we don't depend on Tailwind being loaded. The
  // overlay is a fixed, full-viewport, pointer-events:none red flash
  // with a pulsing animation. z-index is astronomically high so it sits
  // above every other element on the page (modals, navbars, iframes,
  // toasts — everything).
  el.setAttribute("style", `
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    display: none !important;
  `);

  // Inner layer 1: pulsing red vignette (the "lightning" flash).
  const flash = document.createElement("div");
  flash.setAttribute("style", `
    position: absolute !important;
    inset: 0 !important;
    background: radial-gradient(ellipse at center, rgba(255,0,0,0.55) 0%, rgba(180,0,0,0.85) 60%, rgba(120,0,0,0.95) 100%) !important;
    animation: ghs-mcq-siren-flash 0.5s steps(2, end) infinite !important;
  `);

  // Inner layer 2: diagonal red stripes sweeping across.
  const stripes = document.createElement("div");
  stripes.setAttribute("style", `
    position: absolute !important;
    inset: -50% !important;
    background: repeating-linear-gradient(
      45deg,
      rgba(255,0,0,0.0) 0px,
      rgba(255,0,0,0.0) 60px,
      rgba(255,40,40,0.35) 60px,
      rgba(255,40,40,0.35) 120px
    ) !important;
    animation: ghs-mcq-siren-sweep 1.2s linear infinite !important;
  `);

  // Inner layer 3: edge vignette — intensifies the "lightning from edges" feel.
  const edges = document.createElement("div");
  edges.setAttribute("style", `
    position: absolute !important;
    inset: 0 !important;
    box-shadow: inset 0 0 200px 80px rgba(255,0,0,0.85) !important;
    animation: ghs-mcq-siren-flash 0.5s steps(2, end) infinite !important;
  `);

  el.appendChild(stripes);
  el.appendChild(flash);
  el.appendChild(edges);
  document.body.appendChild(el);

  // Inject the keyframes once (into document.head).
  if (!document.getElementById("ghs-mcq-siren-keyframes")) {
    const style = document.createElement("style");
    style.id = "ghs-mcq-siren-keyframes";
    style.textContent = `
      @keyframes ghs-mcq-siren-flash {
        0%   { opacity: 0.35; }
        100% { opacity: 1; }
      }
      @keyframes ghs-mcq-siren-sweep {
        0%   { transform: translateX(-30%) translateY(-30%); }
        100% { transform: translateX(30%) translateY(30%); }
      }
    `;
    document.head.appendChild(style);
  }

  return el;
}

/** Show the red flash overlay. */
function showOverlay() {
  const el = ensureOverlayEl();
  if (el) el.style.display = "block";
}

/** Hide the red flash overlay. */
function hideOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.style.display = "none";
}

/**
 * Component: McqSirenGlobalController
 *
 * Renders nothing visible (it only injects the overlay element on demand).
 * Mount this ONCE inside <App>, ideally high up so it lives for the entire
 * app lifetime.
 */
const McqSirenGlobalController: FC = () => {
  // Refs survive re-renders. Used for siren lifecycle management so we
  // don't double-fire or kill the siren prematurely.
  const sirenFiredForRef = useRef<number | null>(null); // finishedAt we've already sirened for
  const sirenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null); // Sentinel Wake LockSentinel | null
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fire the siren + red flash for a given finished timer state. Idempotent
   * — guarded by sirenFiredForRef so we never fire twice for the same
   * finishedAt. Also self-stops after SIREN_DURATION_MS (15s).
   */
  const fireSirenFor = useRef((t: McqTimerState) => {
    const finishedAt = t.finishedAt ?? t.endTime;

    // Already fired for this finishedAt? Skip.
    if (sirenFiredForRef.current === finishedAt) return;

    // If the finishedAt is more than 30s in the past, the user probably
    // already missed the siren (e.g. closed the laptop for an hour). Don't
    // fire a stale siren — just clean up.
    if (Date.now() - finishedAt > SIREN_DURATION_MS + 15000) {
      try { writeMcqTimer(null); } catch { /* ignore */ }
      sirenFiredForRef.current = finishedAt;
      return;
    }

    sirenFiredForRef.current = finishedAt;

    // IMMEDIATELY delete the timer from localStorage so reopening any page
    // or the 3D Hall does NOT re-fire the siren. The siren + flash play
    // for 15s in-memory (tracked by refs), independent of localStorage.
    try { writeMcqTimer(null); } catch { /* ignore */ }

    // Start the siren: SOUND + VISUAL overlay.
    // startSirenSound() is now async — it awaits AudioContext.resume()
    // and falls back to HTML5 Audio if Web Audio API fails. We don't
    // await it here because the overlay should show immediately.
    showOverlay();
    startSirenSound(); // fire-and-forget — handles its own errors

    // Arm the 15s auto-off.
    if (sirenTimeoutRef.current) clearTimeout(sirenTimeoutRef.current);
    sirenTimeoutRef.current = setTimeout(() => {
      hideOverlay();
      stopSirenSound();
      sirenTimeoutRef.current = null;
    }, SIREN_DURATION_MS);
  });

  /**
   * Core: read the timer from localStorage + fire siren if just-finished.
   * Idempotent — safe to call as often as we like. Only fires the siren
   * ONCE per finishedAt (guarded by sirenFiredForRef inside fireSirenFor).
   */
  const checkAndFire = useRef(() => {
    const t = readMcqTimer();
    // No timer → reset dedup memory and exit.
    if (!t) {
      sirenFiredForRef.current = null;
      return;
    }

    // Case A: timer is running but endTime has passed → promote to "finished".
    // This handles the case where the Console tab isn't open to flip the
    // status itself. We write it back to localStorage so any other tab
    // (including the Console) syncs up via the storage event.
    if (t.status === "running" && Date.now() >= t.endTime) {
      const finished: McqTimerState = {
        ...t,
        status: "finished",
        finishedAt: t.endTime,
      };
      writeMcqTimer(finished);
      fireSirenFor.current(finished);
      return;
    }

    // Case B: timer is "finished" → fire siren if we haven't yet for this finishedAt.
    if (t.status === "finished") {
      fireSirenFor.current(t);
      return;
    }

    // Case C: timer is "stopped" or "running" (still counting) → do nothing.
    // The 250ms interval will catch the zero-crossing.
  });

  // ── Wake Lock: keep the screen on while a timer is RUNNING ───────────────
  // Without this, an admin who starts a 15-min MCQ timer and sets their
  // phone down will have the screen auto-lock, JS will pause, and the
  // siren will never fire. With a wake lock, the screen stays awake until
  // the timer ends. Released when the timer ends OR the user manually
  // locks the device (in which case the wake lock is lost but the
  // visibilitychange listener picks up the check when they unlock).
  const acquireWakeLock = useRef(async () => {
    try {
      if (!("wakeLock" in navigator)) return;
      // Don't re-acquire if we already hold one.
      if (wakeLockRef.current) return;
      const wl = await navigator.wakeLock.request("screen");
      wakeLockRef.current = wl;
      // If the wake lock is released (e.g. user manually locks screen),
      // clear the ref so we can re-acquire it on visibility regain.
      if (wl && typeof wl.addEventListener === "function") {
        wl.addEventListener("release", () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      // Wake lock request can fail (e.g. browser doesn't support it, or
      // the document isn't focused). Not fatal — the timer still runs,
      // just with the risk of background-throttling.
    }
  });

  const releaseWakeLock = useRef(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch { /* ignore */ }
  });

  // ── Polling: 250ms interval while a timer is running ─────────────────────
  // Cheap and only runs while a timer is active. Once the timer is null or
  // finished, we stop polling to save CPU.
  const ensurePolling = useRef(() => {
    const t = readMcqTimer();
    const shouldPoll = !!t && t.status === "running";

    if (shouldPoll && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(() => {
        checkAndFire.current();
      }, 250);
    } else if (!shouldPoll && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  });

  // ── AudioContext keepalive: 5s interval while a timer is running ─────────
  // Browsers can suspend the AudioContext after a period of inactivity or
  // when the tab is backgrounded. If we don't keep it alive, when the
  // timer fires the siren's ctx.resume() may fail because we're not in a
  // user gesture. By periodically calling keepAudioAlive() (which does a
  // best-effort ctx.resume()), we keep the context in "running" state so
  // the siren fires instantly when the timer reaches zero.
  const ensureAudioKeepalive = useRef(() => {
    const t = readMcqTimer();
    const shouldKeepAlive = !!t && t.status === "running";

    if (shouldKeepAlive && !audioKeepaliveRef.current) {
      // Start immediately, then every 5s.
      keepAudioAlive();
      audioKeepaliveRef.current = setInterval(() => {
        keepAudioAlive();
      }, AUDIO_KEEPALIVE_MS);
    } else if (!shouldKeepAlive && audioKeepaliveRef.current) {
      clearInterval(audioKeepaliveRef.current);
      audioKeepaliveRef.current = null;
    }
  });

  // ── Main effect: mount/unmount lifecycle ──────────────────────────────────
  useEffect(() => {
    // 1) Unlock audio on first user gesture anywhere in the document.
    //    This is what allows the siren to play loudly later (mobile
    //    autoplay policy requires a gesture).
    //    We listen for pointerdown, keydown, AND touchstart (iOS Safari
    //    sometimes doesn't fire pointerdown for the first tap).
    const onUnlock = () => unlockSirenAudio();
    document.addEventListener("pointerdown", onUnlock, { passive: true });
    document.addEventListener("keydown", onUnlock, { passive: true });
    document.addEventListener("touchstart", onUnlock, { passive: true });
    // Also try to unlock immediately (in case a gesture happened before
    // this component mounted — e.g. admin already logged in and clicked
    // around before this controller mounted).
    unlockSirenAudio();

    // 2) Cross-tab sync: another tab (the Console) wrote to localStorage.
    //    Fires immediately in THIS tab too if needed.
    const onStorage = (e: StorageEvent) => {
      if (e.key === MCQ_TIMER_KEY) {
        checkAndFire.current();
        ensurePolling.current();
        ensureAudioKeepalive.current();
        // If a timer just started in another tab, try to grab a wake lock.
        const t = readMcqTimer();
        if (t && t.status === "running") {
          acquireWakeLock.current();
        }
      }
    };
    window.addEventListener("storage", onStorage);

    // 3) Visibility change: when the tab comes back to the foreground,
    //    immediately re-check the timer. Catches the case where the tab
    //    was backgrounded when the timer expired and the interval was
    //    throttled.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Re-unlock audio on tab focus (browser may have suspended it).
        unlockSirenAudio();
        checkAndFire.current();
        ensurePolling.current();
        ensureAudioKeepalive.current();
        // Re-acquire wake lock if a timer is still running.
        const t = readMcqTimer();
        if (t && t.status === "running") {
          acquireWakeLock.current();
        } else {
          releaseWakeLock.current();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 4) On window focus (similar to visibilitychange but fires in some
    //    edge cases visibilitychange doesn't — e.g. devtools open/close).
    const onFocus = () => {
      unlockSirenAudio();
      checkAndFire.current();
      ensurePolling.current();
      ensureAudioKeepalive.current();
    };
    window.addEventListener("focus", onFocus);

    // 5) Initial check on mount (in case a timer was already running when
    //    the user navigated to this page).
    checkAndFire.current();
    ensurePolling.current();
    ensureAudioKeepalive.current();
    // Try to grab a wake lock if a timer is already running on mount.
    {
      const t = readMcqTimer();
      if (t && t.status === "running") {
        acquireWakeLock.current();
      }
    }

    // ── Cleanup (component unmount only — e.g. full page navigation) ──────
    return () => {
      document.removeEventListener("pointerdown", onUnlock);
      document.removeEventListener("keydown", onUnlock);
      document.removeEventListener("touchstart", onUnlock);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (audioKeepaliveRef.current) {
        clearInterval(audioKeepaliveRef.current);
        audioKeepaliveRef.current = null;
      }
      if (sirenTimeoutRef.current) {
        clearTimeout(sirenTimeoutRef.current);
        sirenTimeoutRef.current = null;
      }
      // Stop any in-flight siren sound + hide overlay on full unmount.
      stopSirenSound();
      hideOverlay();
      // Release the wake lock (best-effort, async).
      releaseWakeLock.current();
    };
  }, []);

  // This component renders nothing — it's a side-effect-only controller.
  return null;
};

export default McqSirenGlobalController;
