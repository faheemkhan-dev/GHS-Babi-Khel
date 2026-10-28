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
//   3. EXACT-MOMENT PUBLISH — ~1.5 s before zero the browser calls
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
import { markPublishBust } from "@/lib/publicData";

const ENDPOINT = "/api/auto-publish-results";
// How long before zero the browser calls the (waiting) endpoint. Covers a
// warm function start + network; the server sleeps the rest of the way.
const EARLY_CALL_MS = 1500;

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
export interface PublishMeta {
  latest: { exam_type: string; year: number; created_at: string };
  examRollOnly: boolean;
}
interface PublishReply { count: number; meta: PublishMeta | null }

async function callEndpoint(atIso?: string): Promise<PublishReply> {
  try {
    const url = atIso ? `${ENDPOINT}?at=${encodeURIComponent(atIso)}` : ENDPOINT;
    const r = await fetch(url, { method: "POST", cache: "no-store" });
    if (!r.ok) return { count: 0, meta: null };
    const j = await r.json().catch(() => null);
    return j?.ok ? { count: j.published_count ?? 0, meta: (j.meta as PublishMeta | null) ?? null } : { count: 0, meta: null };
  } catch { return { count: 0, meta: null }; }
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

/**
 * Optimistically flip every cache that depends on the publish state.
 * `meta` (from the server, computed while it waited for the exact instant)
 * lets the search box paint in its FINAL shape on the first frame: heading
 * and the exam-roll-only flag are seeded here, so there is no "tabs first,
 * then they vanish 2 s later" flash.
 */
export function applyPublishedToCaches(qc: QueryClient, meta?: PublishMeta | null): void {
  publishConfirmed = true;
  // For the next ~75 s, results-family reads from /api/public-data carry a
  // cache-busting param so refetches see the JUST-published rows.
  markPublishBust();
  const keys = [
    "scheduled-result-publishes", "scheduled-result-publishes-raw",
    "results-countdown-strip", "has-published-school-results",
    "latest-published-exam", "navbar-latest-school-result",
    "admin-results", "home-school-toppers",
    "result-search-meta",
  ];
  // Cancel in-flight fetches so a stale "0 published rows" answer that
  // started before the flip can't land after it and undo it. cancelQueries
  // reverts state synchronously, so the setQueryData calls below can run in
  // the same tick — no awaiting, no extra frame.
  keys.forEach((k) => { void qc.cancelQueries({ queryKey: [k] }); });
  qc.setQueryData(["scheduled-result-publishes"], []);
  qc.setQueryData(["scheduled-result-publishes-raw"], []);
  qc.setQueryData(["results-countdown-strip"], []);
  qc.setQueryData(["has-published-school-results"], true);
  // Search shape (Exam Roll vs Class tabs + which classes exist) must never be
  // served from an older cache: wipe it and refetch right now, so the box is
  // correct the instant the countdown ends — no waiting for a cache to expire.
  void qc.resetQueries({ queryKey: ["result-search-meta"] });
  if (meta?.latest) {
    qc.setQueryData(["latest-published-exam"], meta.latest);
    qc.setQueryData(["exam-roll-only", meta.latest.exam_type, meta.latest.year], meta.examRollOnly);
  }
  // Silent revalidation later (identical data → no visible change).
  window.setTimeout(() => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }, 6000);
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
  const { count, meta } = await callEndpoint();
  if (count > 0) applyPublishedToCaches(qc, meta);
}

const handled = new Set<string>();

async function publishAt(publishAtIso: string, qc: QueryClient) {
  // 1) Server waits for the exact moment, then publishes (one round-trip).
  const first = await callEndpoint(publishAtIso);
  let published = first.count;
  let meta = first.meta;
  // 2) Safety net: quick retries until confirmed.
  for (let i = 0; i < 24 && published === 0; i++) {
    const pending = await pendingDueCount();
    if (pending === 0) { published = 1; break; }       // someone else already did it
    const again = await callEndpoint();
    published = again.count;
    if (published > 0) meta = again.meta;
    if (published === 0) published = await directPublish();
    if (published === 0) await new Promise((r) => setTimeout(r, 300));
  }
  if (published > 0) applyPublishedToCaches(qc, meta);
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
      const left = target - serverNow() - EARLY_CALL_MS; // call the server a little early; it waits for the exact instant
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
