import { useState, useEffect, type ReactNode } from "react";

/* ── Deferred — mount children on browser idle, not at first paint ───────────
   The app shell mounts a handful of always-on widgets (command palette,
   push opt-in, siren controller, toasts, offline banner, route progress…).
   None of them are part of what the visitor sees at first paint — the
   prerendered HTML already carries the visible page — yet mounting them
   inside the hydration pass made that pass one giant long task, which
   blocked the first paint and dominated Lighthouse TBT on mobile.

   Wrapping them here moves their mount to the browser's first idle moment
   (a frame or two after paint). Nothing changes for the user — they were
   invisible during load anyway — but the critical path gets the whole CPU
   to itself. Falls back to a short setTimeout where requestIdleCallback is
   unavailable, and renders children synchronously during SSR/prerender
   (isChildrenPending is a no-op on the server) so build-time prerenders
   keep producing the exact same markup as before. */
export default function Deferred({
  children,
  fallback = null,
  timeout = 2000,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  timeout?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    let cancel: () => void = () => {};
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setReady(true), { timeout });
      cancel = () => w.cancelIdleCallback?.(id);
    } else {
      const t = window.setTimeout(() => setReady(true), 80);
      cancel = () => window.clearTimeout(t);
    }
    return cancel;
  }, [timeout]);

  return <>{ready ? children : fallback}</>;
}
