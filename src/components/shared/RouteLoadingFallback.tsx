import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// RouteLoadingFallback — the <Suspense> fallback shown while any lazy-loaded
// page chunk is being fetched.
//
// Replaces the old bare "Loading…" skeleton. Because route chunks travel
// over the network, this is the screen a user stares at on a slow
// connection — or while offline, when importWithRecovery (src/App.tsx)
// deliberately holds the page open until the connection returns so the app
// never crashes. So instead of a silent spinner it explains what is
// happening and that recovery is automatic:
//   • first seconds:   "Loading…"
//   • taking longer:   "Slow connection — still trying to load this page…"
//   • device offline:  "You're offline — this page will load automatically
//                       once your connection is back." (+ a way back Home)
//
// It listens BOTH to browser online/offline events AND to the status events
// broadcast by importWithRecovery ("ghs-route-load-status"), so the message
// always matches what the import machinery is actually doing.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_LOAD_STATUS_EVENT = "ghs-route-load-status";

type FallbackState = "loading" | "slow" | "offline";

export default function RouteLoadingFallback() {
  const navigate = useNavigate();
  const [state, setState] = useState<FallbackState>(() =>
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "loading"
  );

  useEffect(() => {
    const startedAt = Date.now();

    // Promote "Loading…" to "slow connection…" after a few seconds of
    // waiting, so a slow fetch never looks like a frozen app.
    const slowCheck = window.setInterval(() => {
      if (Date.now() - startedAt > 5000) {
        setState((prev) => (prev === "loading" ? "slow" : prev));
      }
    }, 1000);

    const goOffline = () => setState("offline");
    const goOnline = () => setState((prev) => (prev === "offline" ? "loading" : prev));

    const onRouteLoadStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status === "offline-wait") {
        setState("offline");
      } else if (status === "retrying") {
        setState((prev) => (prev === "offline" ? "loading" : prev));
      } else if (status === "slow-retry") {
        setState((prev) => (prev === "loading" ? "slow" : prev));
      }
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener(ROUTE_LOAD_STATUS_EVENT, onRouteLoadStatus);
    return () => {
      window.clearInterval(slowCheck);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener(ROUTE_LOAD_STATUS_EVENT, onRouteLoadStatus);
    };
  }, []);

  const message =
    state === "offline"
      ? "You're offline — this page will load automatically once your connection is back."
      : state === "slow"
        ? "Slow connection — still trying to load this page…"
        : "Loading…";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        {/* Brand identity — this fallback now ONLY appears on a genuine first
            document load (typed URL / PWA launch / hard refresh). In-app
            navigation never unmounts the app anymore (v7_startTransition in
            App.tsx keeps the current page visible behind RouteProgressBar),
            so this screen can never be mistaken for a "page reload". */}
        <img
          src="/icon-96.png"
          alt=""
          className="w-12 h-12 rounded-xl ring-1 ring-border object-cover"
          aria-hidden
        />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
          GHS Babi Khel
        </p>
        <div className="relative">
          <div className="w-12 h-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          {state === "offline" && (
            <WifiOff className="w-5 h-5 text-destructive absolute inset-0 m-auto" />
          )}
        </div>
        <p className="text-sm text-muted-foreground font-medium leading-relaxed">{message}</p>
        {state === "offline" && (
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm font-semibold hover:bg-muted transition-all"
          >
            Back to Homepage (works offline)
          </button>
        )}
      </div>
    </div>
  );
}
