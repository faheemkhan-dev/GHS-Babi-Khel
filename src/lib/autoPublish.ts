// src/lib/autoPublish.ts
// ─────────────────────────────────────────────────────────────────────────────
// Precision auto-publish for scheduled school results.
//
// Problem this solves: when a countdown hit zero the page sat on
// "Publishing Now…" for 6-8 seconds, because the browser only STARTED the
// publish after noticing zero (cold-started serverless function, DB write,
// then a cache refetch) and a visitor whose phone clock ran fast could fire
// it before the server considered the result due (→ 0 rows published).
//
// How it works now:
//   1. SERVER CLOCK SYNC — GET /api/auto-publish-results?mode=time returns
//      the server's time; serverNow() = Date.now() + measured offset, so
//      every countdown on the site ends at the same real instant.
//   2. PRE-WARM — that same ping warms the serverless function ahead of time.
//   3. EXACT-MOMENT PUBLISH — ~2.5 s before zero the browser calls
//      POST /api/auto-publish-results?at=<publish_at>; the server waits for
//      the exact instant and flips is_published right at 00:00:00.
//   4. SAFETY NET — fast retries (+ direct DB update for admins) until the
//      rows are confirmed published, never a dead-end.
//   5. INSTANT UI — on success the React Query caches are updated
//      optimistically, so the countdown card / strip vanish and the search
//      box appears immediately, without waiting for a refetch.
// ─────────────────────────────────────────────────────────────────────────────
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const ENDPOINT = "/api/auto-publish-results";

// ── Server clock ────────────────────────────────────────────────────────────
let clockOffset = 0; // serverTime - clientTime (ms)
let lastSync = 0;
let syncing: Promise<void> | null = null;

/** Current time on the SERVER's clock (ms since epoch). */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

/** Measure the server clock offset (RTT-compensated). Cheap; throttled. */
export function syncServerClock(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!force && Date.now() - lastSync < 60_000) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const t0 = Date.now();
      const r = await fetch(`${ENDPOINT}?mode=time&_=${t0}`, { cache: "no-store" });
      const t1 = Date.now();
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (j && typeof j.now === "number") {
        clockOffset = j.now + (t1 - t0) / 2 - t1;
        lastSync = Date.now();
      }
    } catch { /* keep previous offset */ }
  })().finally(() => { syncing = null; });
  return syncing;
}

// ── Publishing ──────────────────────────────────────────────────────────────
async function callEndpoint(atIso?: string): Promise<number> {
  try {
    const url = atIso ? `${ENDPOINT}?at=${encodeURIComponent(atIso)}` : ENDPOINT;
    const r = await fetch(url, { method: "POST" });
    if (!r.ok) return 0;
    const j = await r.json().catch(() => null);
    return j?.ok ? (j.published_count ?? 0) : 0;
  } catch { return 0; }
}

// Direct browser UPDATE — only succeeds for an authenticated admin (RLS);
// a harmless no-op for everyone else. Same narrow filter as the endpoint.
async function directPublish(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("results")
      .update({ is_published: true, publish_at: null })
      .eq("is_published", false)
      .not("publish_at", "is", null)
      .lte("publish_at", new Date(serverNow()).toISOString())
      .select("id");
    return !error && Array.isArray(data) ? data.length : 0;
  } catch { return 0; }
}

// How many rows are still scheduled-but-due (i.e. not yet published)?
async function pendingDueCount(): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("is_published", false)
      .not("publish_at", "is", null)
      .lte("publish_at", new Date(serverNow() + 250).toISOString());
    return error ? null : (count ?? 0);
  } catch { return null; }
}

// Once ANY publish has been confirmed in this browser session, school mode is
// locked in. Results.tsx reads this so a late/stale "no published results"
// response can never flip the page back to the BISE board view.
let publishConfirmed = false;
export function isPublishConfirmed(): boolean { return publishConfirmed; }

/** Optimistically flip every cache that depends on the publish state. */
export async function applyPublishedToCaches(qc: QueryClient) {
  publishConfirmed = true;
  const keys = [
    "scheduled-result-publishes", "scheduled-result-publishes-raw",
    "results-countdown-strip", "has-published-school-results",
    "latest-published-exam", "navbar-latest-school-result",
    "admin-results", "home-school-toppers",
  ];
  // ROOT-CAUSE FIX: a refetch that STARTED before the publish (e.g. the
  // 30 s poll or a focus refetch, answered with "0 published rows") used to
  // finish AFTER setQueryData(true) and overwrite it with false — which made
  // the page flip from the school result to BISE Peshawar 2-3 s later.
  // Cancelling in-flight fetches first means stale answers can't land.
  await Promise.all(keys.map((k) => qc.cancelQueries({ queryKey: [k] })));
  qc.setQueryData(["scheduled-result-publishes"], []);
  qc.setQueryData(["scheduled-result-publishes-raw"], []);
  qc.setQueryData(["results-countdown-strip"], []);
  qc.setQueryData(["has-published-school-results"], true);
  // Revalidate later, not instantly, so the DB write is certainly visible.
  window.setTimeout(() => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }, 4000);
}

// ── Catch-up publish ────────────────────────────────────────────────────────
// If nobody had the site open when the countdown hit zero (and no cron is
// configured), the rows stay "scheduled but overdue" and every later visitor
// would see the BISE fallback. This asks the server — once per page load — to
// publish anything that is already due. Safe: the endpoint only flips rows
// whose publish_at has passed; otherwise it is a no-op.
let catchUpDone = false;
export async function catchUpDuePublishes(qc: QueryClient): Promise<void> {
  if (catchUpDone || typeof window === "undefined") return;
  catchUpDone = true;
  const published = await callEndpoint();
  if (published > 0) await applyPublishedToCaches(qc);
}

const handled = new Set<string>();

async function publishAt(publishAtIso: string, qc: QueryClient) {
  // 1) Server waits for the exact moment, then publishes.
  let published = await callEndpoint(publishAtIso);
  // 2) Safety net: quick retries until confirmed.
  for (let i = 0; i < 24 && published === 0; i++) {
    const pending = await pendingDueCount();
    if (pending === 0) { published = 1; break; }       // someone else already did it
    published = await callEndpoint();
    if (published === 0) published = await directPublish();
    if (published === 0) await new Promise((r) => setTimeout(r, 400));
  }
  if (published > 0) await applyPublishedToCaches(qc);
  else handled.delete(publishAtIso); // allow a later re-arm to try again
}

/**
 * Arms exact-moment publishing for the given schedules. Safe to call from
 * several components at once — each publish_at is only handled once.
 * Returns a cleanup function.
 */
export function armAutoPublish(publishAts: string[], qc: QueryClient): () => void {
  const timers = new Set<number>();
  let cancelled = false;
  syncServerClock();

  const arm = (iso: string) => {
    const target = Date.parse(iso);
    if (!Number.isFinite(target) || handled.has(iso)) return;
    let warmed = false;

    // Re-evaluates against the (re-synced) server clock at every hop, so
    // long waits never overflow setTimeout and clock drift can't accumulate.
    const step = () => {
      if (cancelled || handled.has(iso)) return;
      const left = target - serverNow() - 2500; // call the server ~2.5 s early; it waits
      if (left <= 0) {
        handled.add(iso);
        void publishAt(iso, qc);
        return;
      }
      if (!warmed && left <= 25_000) { warmed = true; void syncServerClock(true); }
      const hop = left > 25_000 ? Math.min(left - 24_000, 3_600_000) : Math.min(left, 1_000);
      const id = window.setTimeout(() => { timers.delete(id); step(); }, hop);
      timers.add(id);
    };
    step();
  };

  publishAts.forEach(arm);
  return () => { cancelled = true; timers.forEach((t) => clearTimeout(t)); timers.clear(); };
}
