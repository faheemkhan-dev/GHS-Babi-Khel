import { Component, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw, WifiOff } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// RouteErrorBoundary — the LAST-RESORT safety net for route loading, mounted
// directly around the app's <Routes> (just below the root ErrorBoundary).
//
// With importWithRecovery (src/App.tsx) in place, offline and slow-network
// chunk failures are held as PENDING imports and never reach a boundary at
// all. This component exists for the rare cases that still surface:
//   • a route chunk that stayed unloadable for the whole 10-minute recovery
//     window (e.g. a very long offline stretch),
//   • a stale chunk that no longer exists on the server after a deploy,
//   • a genuine render error inside a page.
//
// For all of those it shows a calm, recoverable panel — NOT the app-wide
// crash screen the root boundary used to produce. If the panel appeared
// because the device was offline, it recovers in place the moment the
// connection returns — with a client-side re-render, never a page reload.
// ─────────────────────────────────────────────────────────────────────────────

interface Props { children: ReactNode; }
interface State { hasError: boolean; wasOffline: boolean; }

class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, wasOffline: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      wasOffline: typeof navigator !== "undefined" && navigator.onLine === false,
    };
  }

  componentDidCatch(error: Error) {
    console.error("[RouteErrorBoundary] Route failed to load:", error);
  }

  componentDidMount() {
    window.addEventListener("online", this.handleBackOnline);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.handleBackOnline);
  }

  // If this panel appeared while the user was OFFLINE, the moment the
  // connection returns we now RECOVER WITHOUT RELOADING.
  //
  // This used to call window.location.reload() here, and it was a second
  // independent source of the "my work vanished on a slow connection"
  // reports. That is especially unforgivable here, because on a weak mobile
  // connection navigator.onLine flickers constantly — the browser reports
  // "offline" for a moment during a stalled request and then fires "online"
  // again. So the sequence "connection hitches → any route error → connection
  // recovers" destroyed the whole page, even though the panel was only ever
  // meant to be a friendly, in-place recovery prompt.
  //
  // There is nothing to recover *into* at this point: the route that failed
  // has already been thrown away by the error boundary, so re-rendering it is
  // a navigation, not a re-render. We therefore reset the boundary and push
  // the user back to the route they were on, which is a client-side operation
  // — same document, same React tree, no reload, nothing lost. If the chunk
  // still cannot load, importWithRecovery (src/App.tsx) holds it as a pending
  // import and the normal in-place fallback takes over, exactly as it does for
  // any other slow page.
  handleBackOnline = () => {
    if (!this.state.hasError || !this.state.wasOffline) return;
    const { pathname, search, hash } = window.location;
    this.setState({ hasError: false, wasOffline: false });
    // A tiny delay lets the boundary re-mount its children before we ask the
    // router to re-resolve the route, so the retry is a normal transition.
    window.setTimeout(() => {
      window.history.replaceState(null, "", `${pathname}${search}${hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, 0);
  };

  // ── One-tap SELF-HEAL (used by both buttons below) ────────────────────
  // A route error right after an app update is very often caused by an old
  // service worker still pairing a cached shell with hashed chunks that no
  // longer exist on the server. A plain reload can NEVER escape that state
  // (and clearing the browser's "cached images and files" does not remove
  // a service worker or its Cache Storage) — which is why users see this
  // panel again and again no matter how often they refresh. So before we
  // navigate anywhere, unregister every service worker and delete the
  // app's own ghs-* caches. The fresh page load re-registers the worker
  // (src/main.tsx) and re-precache's the current build, so offline support
  // returns automatically right afterwards. Best-effort throughout: if any
  // step throws, the plain navigation still happens.
  handleSelfHealThenNavigate = (url: string) => {
    (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
        }
        if (typeof caches !== "undefined") {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith("ghs-"))
              .map((k) => caches.delete(k).catch(() => {}))
          );
        }
      } catch {
        /* best-effort — the navigation below is still worth doing */
      }
      if (url === "__reload__") window.location.reload();
      else window.location.href = url;
    })();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            {offline ? (
              <WifiOff className="w-8 h-8 text-destructive" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-destructive" />
            )}
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
            {offline ? "You're offline" : "This page couldn't load"}
          </h1>
          <p className="text-muted-foreground mb-6">
            {offline
              ? "There's no internet connection right now. This page will load automatically once you're back online — nothing is lost."
              : "This page had trouble loading — most likely a slow or interrupted connection, or a recent app update. Your data is safe. Try again, or head back to the homepage."}
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              onClick={() => this.handleSelfHealThenNavigate("__reload__")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl gradient-accent text-primary-foreground font-semibold shadow-card hover:shadow-elevated transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={() => this.handleSelfHealThenNavigate("/")}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-background text-foreground font-semibold hover:bg-muted transition-all"
            >
              <Home className="w-4 h-4" />
              Go to Homepage
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
