// routePrefetch.ts — makes navbar navigation feel instant, even on slow
// internet, via two complementary layers:
//
// 1. INTENT PREFETCH (the big win):
//    The moment a finger TOUCHES or a cursor HOVERS any navbar link, the
//    target route's JS chunk starts downloading — a full tap takes 100-300ms
//    and a chunk is usually only 20-80KB, so by the time React Router
//    actually navigates, the chunk is already in the browser's module cache
//    and the page renders immediately. One delegated listener on the navbar
//    root covers every link inside it (mega-menu, mobile drawer, Roll No.
//    Slip countdown chips, admission CTA — even links added later).
//
// 2. BACKGROUND PREFETCH (idle warm-up): 
//    After the homepage fully loads (window load + browser idle), the main
//    public routes are warmed ONE AT A TIME, in priority order (the pages
//    visitors tap most: Merit List and Roll No. Slip first).
//    Sequential downloading never competes with the homepage's own data —
//    that's what made the old all-at-once prefetch sluggish on slow links.
//
// Both layers respect Data Saver and 2G: on metered connections we don't
// prefetch anything in the background (intent prefetch still runs — the
// user explicitly aims at that page, so it's never wasted data).

type Loader = () => Promise<unknown>;

/** Route path → the exact same dynamic import App.tsx lazy-loads. */
export const ROUTE_LOADERS: Record<string, Loader> = {
  // Top visitor targets (user-reported slow pages first)
  "/merit-list":     () => import("@/pages/MeritList"),
  "/roll-no-slip":   () => import("@/pages/ExamRollNumbers"),
  // Results family
  "/results":        () => import("@/pages/Results"),
  "/result-card":    () => import("@/pages/ResultCard"),
  // School info
  "/about":          () => import("@/pages/About"),
  "/gallery":        () => import("@/pages/Gallery"),
  "/contact":        () => import("@/pages/Contact"),
  "/faq":            () => import("@/pages/FAQ"),
  "/teachers":       () => import("@/pages/Teachers"),
  // News & dates
  "/news":           () => import("@/pages/News"),
  "/notices":        () => import("@/pages/Notices"),
  "/calendar":       () => import("@/pages/Calendar"),
  // Academics
  "/notes":          () => import("@/pages/notes/NotesPage"),
  "/library":        () => import("@/pages/Library"),
  "/duty":           () => import("@/pages/Duty"),
  // Actions
  "/admission":      () => import("@/pages/Admission"),
  "/search":         () => import("@/pages/Search"),
};

/** Background order — most-tapped pages first (see module docstring). */
/* Light pages first, heavy pages last.
   The first four used to lead the queue; they pull the biggest dependency
   graphs in the app (recharts, xlsx, jspdf, exceljs). Loading them first
   made the browser parse nearly a megabyte of libraries right after the
   homepage painted — exactly when a phone's CPU is busiest — which showed
   up in Lighthouse as long main-thread tasks and a delayed TTI. Taps are
   covered instantly by the INTENT layer anyway, so the background order
   only affects the idle warm-up: light chunks now warm the cache quickly,
   and the heavy ones follow once the browser has spare capacity. */
const BACKGROUND_ORDER = [
  // light (a few KB each)
  "/about", "/contact", "/faq", "/notices", "/news", "/calendar",
  "/teachers", "/duty", "/library", "/gallery", "/search", "/admission",
  "/notes",
  // heavy (charts / pdf / excel dependency graphs) — warmed last
  "/merit-list", "/results", "/roll-no-slip", "/result-card",
];

const done = new Set<string>();

/** Trigger a route chunk download once. Idempotent, failure-tolerant. */
export function prefetchRoute(pathname: string): void {
  const loader = ROUTE_LOADERS[pathname];
  if (!loader || done.has(pathname)) return;
  done.add(pathname);
  loader().catch(() => done.delete(pathname)); // allow retry on next intent
}

/** True once this route's chunk is already fetched this session. */
export const isRoutePrefetched = (pathname: string) => done.has(pathname);

/**
 * Connection-aware gate for BACKGROUND prefetching only.
 *
 * The original version only refused to prefetch on "2g"/"slow-2g", which is
 * far too permissive for the networks this site's users actually have. A
 * mobile browser happily reports "4g" while the connection is congested and
 * moving at a few dozen KB/s — the Network Information API's effectiveType is
 * a coarse bucket, not a measurement. On such a link this queue happily
 * started downloading 16+ route chunks in the background, one every 400 ms,
 * while the user was trying to open ONE page. The result is that the page
 * they actually wanted crawls, the full-screen loading fallback sits there
 * for many seconds, and the whole thing reads as "the site reloaded itself".
 *
 * So the gate now also defers on:
 *   • save-data (already honoured) and any metered connection,
 *   • a measured round-trip time high enough to mean "don't waste my bytes",
 *   • a downlink the browser itself rates as slow,
 *   • the user actively typing (see the interaction guard below).
 */
function connectionAllowsBackgroundPrefetch(): boolean {
  const conn =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!conn) return true; // unknown connection — behave as before

  if (conn.saveData) return false; // user asked to save data — respect it
  if (conn.type && /cellular/i.test(String(conn.type)) && conn.effectiveType === "3g") {
    return false; // metered 3G — a background prefetch is a real cost
  }

  const t = String(conn.effectiveType || "").toLowerCase();
  if (t === "slow-2g" || t === "2g") return false;

  // effectiveType sits at its most optimistic on exactly the congested links
  // that hurt most, so cross-check it against the raw numbers.
  const rtt = Number(conn.rtt);
  if (Number.isFinite(rtt) && rtt >= 500) return false; // ~500ms+ round trip
  const downlink = Number(conn.downlink);
  if (Number.isFinite(downlink) && downlink > 0 && downlink < 2) return false;

  return true;
}

/**
 * Background prefetch must never compete with a human. Any typing, tap or
 * scroll suspends the queue until things go quiet again.
 */
let interactingUntil = 0;
function markInteraction(): void {
  interactingUntil = Date.now() + 15_000;
}
function userIsBusy(): boolean {
  return Date.now() < interactingUntil;
}

function installInteractionGuard(): void {
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("keydown", markInteraction, opts);
  window.addEventListener("input", markInteraction, opts);
  window.addEventListener("pointerdown", markInteraction, opts);
  window.addEventListener("scroll", markInteraction, opts);
}

/**
 * Warm all public route chunks after the page has fully loaded and the
 * browser is idle — one chunk at a time (never saturates a slow link).
 * Safe to call multiple times; runs at most once per page load.
 *
 * The queue re-checks the connection AND whether the user is interacting
 * before every single chunk, so a burst of activity (someone typing, a run of
 * taps) suspends background warming entirely instead of competing with it.
 */
let backgroundStarted = false;
export function startBackgroundRoutePrefetch(): void {
  if (backgroundStarted || typeof window === "undefined") return;
  backgroundStarted = true;
  installInteractionGuard();

  // PERF: give the just-loaded page a quiet window first. The homepage's
  // own hydration, data queries and first paint own the CPU and the network
  // in the seconds after load; starting the warm-up queue in that same
  // window added main-thread long tasks (parse/compile of route chunks)
  // precisely while the visitor's phone was at its busiest. Waiting a few
  // seconds costs a real user nothing (intent prefetch still covers taps
  // instantly) but keeps the warm-up out of the critical loading path.
  window.setTimeout(() => {
    requestIdleCallback
      ? requestIdleCallback(runQueue, { timeout: 20_000 })
      : runQueue();
  }, 6_000);

  const runQueue = () => {
    const queue = BACKGROUND_ORDER.filter((p) => !done.has(p));
    let i = 0;
    const step = () => {
      if (i >= queue.length) return;

      // Yield to the network and to the human, in that order. An idle
      // callback only fires when the browser has nothing better to do, and
      // the timeout bounds the wait so warming resumes on its own later.
      const proceed = () => {
        if (i >= queue.length) return;
        if (!connectionAllowsBackgroundPrefetch()) return; // link got worse — stop
        if (userIsBusy()) {
          // Come back once the user has been still for a moment.
          setTimeout(step, 3000);
          return;
        }
        prefetchRoute(queue[i++]);
        // Gap between chunks: keeps real navigation traffic responsive.
        setTimeout(step, 1200);
      };

      if (typeof (window as any).requestIdleCallback === "function") {
        (window as any).requestIdleCallback(proceed, { timeout: 5000 });
      } else {
        setTimeout(proceed, 500);
      }
    };
    step();
  };

  const kickOff = () => {
    const w = window as any;
    if (typeof w.requestIdleCallback === "function")
      w.requestIdleCallback(runQueue, { timeout: 6000 });
    else setTimeout(runQueue, 2500);
  };

  if (document.readyState === "complete") kickOff();
  else window.addEventListener("load", kickOff, { once: true });
}

/**
 * Delegated intent-prefetch handlers — spread these onto a container that
 * holds links (navbar root, footer, etc.). On pointer hover, keyboard focus
 * or the START of a touch, the link target's route chunk begins downloading
 * immediately, so the subsequent navigation is instant.
 */
export function intentPrefetchHandlers() {
  // NOTE: the anchor selector was previously the invalid string "aref]" — a typo
  // for "a[href]". An invalid selector makes closest() THROW, so every
  // hover/tap over the navbar raised an uncaught DOMException and the
  // intent prefetch never prefetched anything (slower nav on mobile).
  const handle = (e: { target: EventTarget | null }) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    try {
      const path = new URL(anchor.href, location.href).pathname.replace(/\/+$/, "") || "/";
      prefetchRoute(path);
    } catch { /* ignore malformed hrefs */ }
  };
  return {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => handle(e), // mouse hover / stylus
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => handle(e),     // mobile tap — fires ~100-300ms before click
    onFocus: (e: React.FocusEvent<HTMLElement>) => handle(e),          // keyboard / AT navigation
  };
}
