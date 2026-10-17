import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { hasUnsavedWork } from "./unsavedWork";

// ─────────────────────────────────────────────────────────────────────────────
// lazyWithRetry — crash-proof React.lazy().
//
// Shared by the route table (src/App.tsx) AND the admin dashboard's tab
// loader, so a chunk that fails to download can never take a whole page down.
//
// WHY A FAILED import() CANNOT SIMPLY BE RETRIED
// The browser caches a FAILED module fetch for the lifetime of the document:
// re-running the same import() rejects instantly even after the network is
// back. So recovery = probe the file with fetch(), then import it under a
// cache-busting query (a brand-new module-map entry). Until that works the
// returned promise stays PENDING, so <Suspense> keeps the current screen.
//
// WHAT CHANGED vs. THE VERSION THAT LIVED IN App.tsx (verified defects):
//  1. "Stale chunk" detection relied on a 404. vercel.json rewrites every
//     non-/api path to /index.html, so a chunk deleted by a new deploy
//     answers 200 + text/html — never 404. Detection never fired; the
//     retry loop spun for 10 minutes and ended in "This page couldn't load".
//     probeUrl() now treats an HTML answer for a .js URL as stale.
//  2. A failed import can name a SHARED dependency chunk, not the route's
//     own file. The old code imported that dependency and handed it to
//     React.lazy as if it were the page (no `default` export → crash).
//     The result is now validated; a poisoned dependency graph needs a
//     fresh document, which is handled as a stale chunk.
//  3. Genuine bugs (a page that throws while evaluating) were retried for
//     10 minutes as if they were network errors. Only network-shaped errors
//     are retried now; real errors surface immediately.
//  4. Every document-reload step now WAITS while the person is typing
//     (hasUnsavedWork) instead of reloading or throwing to the error panel —
//     both of which destroyed the edit. The current page simply stays on
//     screen with the progress bar running.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_LOAD_STATUS_EVENT = "ghs-route-load-status";
const ROUTE_CHUNK_EVENT = "ghs-route-chunk";
const MAX_RECOVERY_MS = 10 * 60 * 1000;

type RouteLoadStatus = "offline-wait" | "slow-retry" | "retrying";

function emitChunkPhase(phase: "start" | "end") {
  try {
    window.dispatchEvent(new CustomEvent(ROUTE_CHUNK_EVENT, { detail: { phase } }));
  } catch {
    /* cosmetic only */
  }
}

function emitRouteLoadStatus(status: RouteLoadStatus) {
  try {
    window.dispatchEvent(new CustomEvent(ROUTE_LOAD_STATUS_EVENT, { detail: { status } }));
  } catch {
    /* cosmetic only */
  }
}

const isOfflineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Errors that mean "the file could not be fetched / is not JavaScript" — the
// only ones worth retrying. Anything else is a real bug in the page's code.
function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .* failed|MIME type|not a valid JavaScript/i.test(
    msg
  );
}

function extractChunkUrl(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/https?:\/\/[^\s'"]+\.js/i);
  return m ? m[0] : null;
}

const looksLikeModule = (mod: unknown): boolean =>
  !!mod && typeof mod === "object" && "default" in (mod as Record<string, unknown>);

// HEAD bypasses the module map and the service worker (which ignores
// non-GET), so it tests the REAL network.
//   "ok"          reachable and really JavaScript
//   "stale"       gone (404/410) OR answered with an HTML page (SPA rewrite)
//   "unreachable" offline / server or CDN still failing
async function probeUrl(url: string): Promise<"ok" | "stale" | "unreachable"> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.status === 404 || res.status === 410) return "stale";
    if (!res.ok) return "unreachable";
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type.includes("text/html")) return "stale";
    return "ok";
  } catch {
    return "unreachable";
  }
}

// One reload per fresh-document need, max 3 per rolling 60 s. Callers have
// already waited out any in-progress typing before calling this.
function guardedReload(reason: string): boolean {
  try {
    const KEY = "ghs-chunk-reloads";
    const now = Date.now();
    const recent: number[] = JSON.parse(sessionStorage.getItem(KEY) || "[]").filter(
      (t: number) => now - t < 60_000
    );
    if (recent.length >= 3) {
      console.warn("[routeChunk] Reload cap reached — handing over to the recovery panel");
      return false;
    }
    recent.push(now);
    sessionStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    /* storage unavailable — proceed */
  }
  console.warn(`[routeChunk] Loading a fresh document to recover (${reason})`);
  window.location.reload();
  return true;
}

// A service worker that survived a deploy can keep pairing a cached shell
// with hashed files that no longer exist; reloads alone never escape that.
// Removes the worker + its ghs-* caches (it re-registers on the next load).
async function hardServiceWorkerRecovery(): Promise<boolean> {
  try {
    if (sessionStorage.getItem("ghs-sw-hard-recovery")) return false;
    sessionStorage.setItem("ghs-sw-hard-recovery", "1");
  } catch {
    /* storage blocked — still attempt once per document */
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("ghs-")).map((k) => caches.delete(k).catch(() => {}))
      );
    }
    return true;
  } catch {
    return false;
  }
}

// Needs a brand-new document (stale or poisoned chunk graph). Never while the
// person is typing: wait (the old page stays visible and interactive) until
// they stop. Returns true if a reload was started.
async function recoverWithFreshDocument(
  reason: string,
  intendedPath: string,
  deadline: number
): Promise<boolean> {
  while (hasUnsavedWork()) {
    if (Date.now() > deadline) return false;
    if (location.pathname !== intendedPath) return false;
    await sleep(3000);
  }
  if (location.pathname !== intendedPath) return false; // person moved on
  if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
    await hardServiceWorkerRecovery();
  }
  return guardedReload(reason);
}

let recoverySeq = 0;

export async function importWithRecovery<T = any>(factory: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const deadline = startedAt + MAX_RECOVERY_MS;
  let lastError: unknown;

  try {
    return await factory();
  } catch (err) {
    lastError = err;
  }

  // A real bug in the page's own code — retrying cannot help. Surface it now.
  if (!isChunkLoadError(lastError)) throw lastError;

  const failedUrl = extractChunkUrl(lastError);
  const intendedPath = typeof location !== "undefined" ? location.pathname : "/";
  let bustedFailures = 0;

  while (Date.now() < deadline) {
    emitRouteLoadStatus(isOfflineNow() ? "offline-wait" : "slow-retry");
    await sleep(3000);
    emitRouteLoadStatus("retrying");

    if (!failedUrl) {
      // Browser did not name the file — best-effort plain retry.
      try {
        return await factory();
      } catch (err) {
        lastError = err;
        if (!isChunkLoadError(err)) throw err;
        continue;
      }
    }

    const state = await probeUrl(failedUrl);

    if (state === "unreachable") continue; // offline / server down — keep waiting

    if (state === "stale") {
      if (await recoverWithFreshDocument("stale chunk", intendedPath, deadline)) {
        await sleep(30_000); // page is reloading; safety net only
        continue;
      }
      throw lastError;
    }

    // state === "ok": the network is healthy — import under a fresh specifier.
    let poisoned = false;
    try {
      const mod = await import(/* @vite-ignore */ `${failedUrl}?ghs-retry=${++recoverySeq}`);
      if (looksLikeModule(mod)) return mod as T;
      // The failed file was a shared dependency, not this page: the graph is
      // poisoned in this document and only a fresh document can fix it.
      poisoned = true;
    } catch (err) {
      lastError = err;
      bustedFailures += 1;
      if (bustedFailures >= 2) poisoned = true;
    }

    if (poisoned) {
      if (await recoverWithFreshDocument("poisoned chunk graph", intendedPath, deadline)) {
        await sleep(30_000);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError;
}

export function lazyWithRetry<P = any>(
  factory: () => Promise<{ default: ComponentType<P> }>
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => {
    emitChunkPhase("start");
    return importWithRecovery(factory).finally(() => emitChunkPhase("end"));
  });
}
