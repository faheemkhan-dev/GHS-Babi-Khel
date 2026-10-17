// src/hooks/usePageTracker.ts
//
// Dual-layer page tracking:
//   1. Plausible Analytics  — proper pageview (geography, bounce rate, session depth)
//      Fires automatically when VITE_PLAUSIBLE_DOMAIN is set.
//   2. Supabase site_visits — school-specific metrics (logged-in user, device type,
//      session id) that Plausible's privacy model intentionally omits.
//
// Uses supabasePublic for INSERT to avoid auth refresh loops that can
// cause the main supabase client to hang for anonymous visitors.
//
// SAFE: all errors are swallowed — tracking never breaks the page.

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase, supabasePublic } from "@/lib/supabase";
import { usePlausible } from "./usePlausible";

/** Detect device type from user agent string */
function getDeviceType(): "mobile" | "tablet" | "desktop" {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  return "desktop";
}

/** Get or create a session id stored in sessionStorage */
function getSessionId(): string {
  try {
    const key = "ghs_sid";
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(key, sid);
    }
    return sid;
  } catch {
    return "unknown";
  }
}

export function usePageTracker() {
  const location    = useLocation();
  const lastTracked = useRef<string>("");
  // usePlausible injects the <script> tag and returns trackEvent
  const { trackEvent } = usePlausible();

  useEffect(() => {
    const path = location.pathname;

    // Don't double-track the same path in the same render cycle
    if (lastTracked.current === path) return;
    lastTracked.current = path;

    // Skip admin panel — no need to track admin's own visits
    if (path.startsWith("/admin")) return;

    // ── Layer 1: Plausible pageview ──────────────────────────────────────
    // Plausible auto-tracks "pageview" on its own script load, but for SPA
    // route changes we fire a named event so it registers every navigation.
    trackEvent("pageview");

    // ── Layer 2: Supabase site_visits (school-specific) ──────────────────
    // Use supabasePublic for inserts — avoids auth refresh loops that can
    // hang the main supabase client for anonymous visitors.
    //
    // PERF: this used to fire the auth.getUser() round-trip + the INSERT
    // IMMEDIATELY on mount, where it competed for the browser's limited
    // per-host connection slots with the ~10 content queries the page
    // itself needs (on this site's Supabase each call costs well over a
    // second, so the extra traffic visibly delayed the content the visitor
    // actually came for). Tracking is pure analytics — it is now deferred
    // until the browser is idle (or a short timeout), so content always
    // wins the network. Errors are still swallowed either way.
    const track = async () => {
      try {
        // Try to get user from the authenticated client (non-blocking)
        let userId: string | null = null;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          userId = user?.id ?? null;
        } catch {
          // If auth fails, just track without user_id
        }

        // Use supabasePublic for the INSERT — it never gets stuck in auth
        // refresh loops and works reliably for all visitors (logged-in or not)
        await supabasePublic.from("site_visits").insert({
          page:        path,
          referrer:    document.referrer || null,
          user_agent:  navigator.userAgent,
          device_type: getDeviceType(),
          session_id:  getSessionId(),
          user_id:     userId,
        });
      } catch {
        // Silently ignore — tracking must never break the site
      }
    };

    // Defer until BOTH the browser is idle AND a minimum 2.5 s has passed —
    // on a slow link the content queries easily run 2 s+, and analytics
    // must never land inside that window. (Idle alone fires immediately on
    // a fast desktop; the floor keeps it polite there too.)
    const MIN_DELAY_MS = 2500;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const fireWhenIdle = () => {
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(() => { void track(); }, { timeout: 5000 });
      } else {
        void track();
      }
    };
    const t = setTimeout(fireWhenIdle, MIN_DELAY_MS);
    // If the user leaves before the timer fires, skip silently.
    return () => clearTimeout(t);
  }, [location.pathname, trackEvent]);
}
