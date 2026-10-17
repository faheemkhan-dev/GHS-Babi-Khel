// src/hooks/usePlausible.ts
//
// Plausible Analytics integration for GHS Babi Khel.
//
// SETUP (one-time):
//   1. Go to https://plausible.io → "Add a website" → enter ghsbabikhel.dpdns.org
//   2. Copy your domain (e.g. "ghsbabikhel.dpdns.org") into VITE_PLAUSIBLE_DOMAIN
//   3. If self-hosting Plausible, set VITE_PLAUSIBLE_SRC to your instance URL
//      e.g. https://plausible.yourserver.com/js/script.js
//      Leave blank to use the default Plausible cloud.
//
// ENV VARS (in .env / Vercel dashboard):
//   VITE_PLAUSIBLE_DOMAIN=ghsbabikhel.dpdns.org
//   VITE_PLAUSIBLE_SRC=          ← optional, leave blank for cloud
//
// USAGE:
//   const { trackEvent } = usePlausible();
//   trackEvent("Result Viewed", { props: { class: "10" } });
//   trackEvent("Admission Form Opened");

import { useEffect, useCallback } from "react";

// Extend Window so TypeScript knows about the plausible global
declare global {
  interface Window {
    plausible?: (
      event: string,
      opts?: { props?: Record<string, string | number | boolean>; callback?: () => void }
    ) => void;
  }
}

const PLAUSIBLE_DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
const PLAUSIBLE_SRC    = (import.meta.env.VITE_PLAUSIBLE_SRC as string | undefined)
  || "https://plausible.io/js/script.js";

/** Returns true only when the env var is set and non-empty */
export function isPlausibleEnabled(): boolean {
  return Boolean(PLAUSIBLE_DOMAIN && PLAUSIBLE_DOMAIN.trim().length > 0);
}

/**
 * Injects the Plausible <script> tag once (idempotent).
 * Must be called inside a React component or hook (uses useEffect).
 */
export function usePlausible() {
  useEffect(() => {
    if (!isPlausibleEnabled()) return;

    // Already injected?
    if (document.getElementById("plausible-script")) return;

    const script = document.createElement("script");
    script.id            = "plausible-script";
    script.defer         = true;
    script.setAttribute("data-domain", PLAUSIBLE_DOMAIN!.trim());
    script.src           = PLAUSIBLE_SRC;

    // Plausible needs this shim so trackEvent() calls queued before
    // the script loads are replayed once it does.
    window.plausible =
      window.plausible ||
      function (...args) {
        (window.plausible as any).q = (window.plausible as any).q || [];
        (window.plausible as any).q.push(args);
      };

    document.head.appendChild(script);
  }, []);

  /**
   * Track a custom Plausible event.
   * No-ops gracefully if Plausible is not configured.
   *
   * @param eventName   e.g. "Result Viewed", "Admission Form Opened"
   * @param props       Optional key-value props (string | number | boolean values)
   *
   * @example
   *   trackEvent("Notice Downloaded", { props: { title: "Annual Result 2025" } });
   */
  const trackEvent = useCallback(
    (
      eventName: string,
      opts?: { props?: Record<string, string | number | boolean>; callback?: () => void }
    ) => {
      if (!isPlausibleEnabled()) return;
      try {
        window.plausible?.(eventName, opts);
      } catch {
        // Never let analytics crash the app
      }
    },
    []
  );

  return { trackEvent, enabled: isPlausibleEnabled() };
}
