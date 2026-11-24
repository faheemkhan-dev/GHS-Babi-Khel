// src/components/shared/TurnstileWidget.tsx
// Slim, mobile-friendly Cloudflare Turnstile.
//   • appearance "interaction-only": the check runs invisibly and the box only
//     appears if Cloudflare actually needs the visitor to interact — so the
//     form stays thin and uncluttered for real people
//   • size "flexible": fills the container width (min 300px on phones is the
//     Cloudflare limit; it shrinks gracefully inside narrow cards)
//   • a one-line status pill (checking / verified / retry) replaces the bulky box
//   • token expiry / errors are handled: the parent is told the token is gone
//     and a fresh one is requested automatically
// Renders nothing when no site key is configured.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, RefreshCw } from "lucide-react";
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
          appearance: "interaction-only",
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
      {/* Cloudflare mounts here; it stays 0-height unless interaction is required. */}
      <div ref={box} className="w-full [&>div]:!w-full [&_iframe]:!w-full" />
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]" role="status" aria-live="polite">
        {status === "ok" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Verified — you're not a robot
          </span>
        ) : status === "error" ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 font-medium text-destructive hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Security check failed — tap to retry
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Security check…
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/60">Protected by Cloudflare</span>
      </div>
    </div>
  );
});

export default TurnstileWidget;
