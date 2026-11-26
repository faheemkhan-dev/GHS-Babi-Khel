// src/components/shared/TurnstileWidget.tsx
// Visible, mobile-friendly Cloudflare Turnstile.
//   • appearance "always": the real Turnstile box is ALWAYS shown (the old
//     "interaction-only" mode hid it behind a bare "Protected" label)
//   • size "flexible": the thin 65px-high rectangle that stretches to the full
//     width of its container (Cloudflare minimum 300px) — ideal on phones
//   • the box reserves its height up-front, so the form never jumps
//   • token expiry / errors are handled: the parent is told the token is gone
//     and a fresh one is requested automatically
// Renders nothing when no site key is configured.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { TURNSTILE_SITE_KEY, turnstileEnabled } from "@/lib/turnstile";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    __ghsTurnstileLoad?: Promise<void>;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.__ghsTurnstileLoad) return window.__ghsTurnstileLoad;
  window.__ghsTurnstileLoad = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      window.__ghsTurnstileLoad = undefined; // allow a later retry
      reject(new Error("Turnstile script failed to load"));
    };
    document.head.appendChild(el);
  });
  return window.__ghsTurnstileLoad;
}

export interface TurnstileHandle {
  /** Ask for a fresh token (call after every submit — tokens are single-use). */
  reset: () => void;
}

interface Props {
  /** Called with the token when verified, or null when it expired / failed / was reset. */
  onToken: (token: string | null) => void;
  /** Cloudflare "action" label, e.g. "signin" or "admission". */
  action: string;
  className?: string;
}

const TurnstileWidget = forwardRef<TurnstileHandle, Props>(function TurnstileWidget(
  { onToken, action, className = "" },
  ref
) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [status, setStatus] = useState<"loading" | "checking" | "ok" | "error">("loading");

  const reset = useCallback(() => {
    onTokenRef.current(null);
    setStatus("checking");
    try {
      if (window.turnstile && widgetId.current) window.turnstile.reset(widgetId.current);
    } catch { /* widget already gone */ }
  }, []);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  useEffect(() => {
    if (!turnstileEnabled || !box.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        setStatus("checking");
        widgetId.current = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: "auto",
          size: "flexible",
          appearance: "always",
          retry: "auto",
          "refresh-expired": "auto",
          callback: (token: string) => { setStatus("ok"); onTokenRef.current(token); },
          "expired-callback": () => { setStatus("checking"); onTokenRef.current(null); },
          "timeout-callback": () => { setStatus("checking"); onTokenRef.current(null); },
          "error-callback": () => { setStatus("error"); onTokenRef.current(null); },
        });
      })
      .catch(() => { if (!cancelled) setStatus("error"); });
    return () => {
      cancelled = true;
      try { if (window.turnstile && widgetId.current) window.turnstile.remove(widgetId.current); } catch { /* noop */ }
      widgetId.current = null;
    };
  }, [action]);

  if (!turnstileEnabled) return null;

  return (
    <div className={className}>
      {/* The Turnstile rectangle mounts here (65px tall, full width). */}
      <div className="min-h-[65px] w-full overflow-hidden rounded-md">
        <div ref={box} className="w-full [&>div]:!w-full [&_iframe]:!w-full" />
      </div>
      {status === "error" && (
        <div className="mt-1.5 text-[11px]" role="status" aria-live="polite">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 font-medium text-destructive hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Security check failed — tap to retry
          </button>
        </div>
      )}
    </div>
  );
});

export default TurnstileWidget;
