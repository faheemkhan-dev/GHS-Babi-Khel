// src/components/ReportCard/bulkFetch.ts
// Fetches BISE Peshawar results for a list of roll numbers via the existing
// /api/bisep-proxy endpoint.
//
// v6 — rewritten now that the v5 "rate-limit" diagnosis has been debunked.
// Direct probing of cloud.bisep.edu.pk confirms the PHP backend has NO
// rate-limit counter (no IP tracking, no request counting, no 429s, and the
// ResultToken is reusable indefinitely). The 403s v5 called "board busy"
// were actually Cloudflare challenging our HTTP/2 client for missing browser
// fingerprint headers — fixed at the proxy layer in api/bisep-proxy.js v6.
//
// What this layer adds on top of the proxy:
//   • Concurrency 8 (was 3) — the board has no rate limit, so the only
//     ceiling is Vercel's serverless timeout. 8-way fetches bring a 54-roll
//     class PDF from ~25 s down to ~8 s.
//   • No "busy" retries — `busy` is no longer returned by the proxy. A 403
//     now arrives as { retry: true } and is treated as a one-shot retry
//     at this layer too. Clean "no record for this roll" answers are still
//     FINAL (retrying those just wastes the board's CPU).
//   • Read-through localStorage cache keyed by exam — a roll fetched once
//     (by search, comparison, or a previous bulk run) never touches the
//     board again for 24 h. A 54-roll class run re-run after a hiccup
//     costs ~0 board requests for the rolls already saved.

import type { BisepResult, ClassName, NormalizedResult, ProgressCallback } from "./types";
import { normalizeResult } from "./normalize";

const PROXY_URL = "/api/bisep-proxy";
const CONCURRENCY = 8; // was 3 — no rate limit means we can run wide
const MAX_RETRIES = 3; // network / 5xx / malformed payloads only
const RETRY_DELAY_MS = 600;
const RETRY_RETRIES = 1; // a clean { retry: true } from the proxy (was 3 busy retries)
const RETRY_DELAY = 1500; // single spaced retry — the proxy already warmed fresh
/** Board marksheets are final — cached a full day per exam on this device. */
const LS_TTL = 24 * 60 * 60 * 1000;
const LS_PREFIX = "ghs-bisep-result:";

/** Sleep helper. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A { retry: true } payload from the proxy — the session was dead, the proxy
 *  already tried with a fresh session and STILL 403'd. One spaced retry here
 *  lets the proxy's NEXT pickSession get a brand-new session. */
const isRetrySignal = (msg?: string) =>
  /session expired|tap search again|retry: true/i.test(String(msg || ""));

// ── per-exam device cache (survives reloads; guarded against quirks) ────────
function lsKey(examKey: string, roll: string): string {
  const exam = String(examKey || "unknown").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60);
  return `${LS_PREFIX}${exam}:${roll}`;
}
function lsGet(examKey: string, roll: string): BisepResult | null {
  try {
    const raw = localStorage.getItem(lsKey(examKey, roll));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; r?: BisepResult } | null;
    if (!parsed || typeof parsed !== "object" || !parsed.r || typeof parsed.t !== "number") {
      localStorage.removeItem(lsKey(examKey, roll));
      return null;
    }
    if (Date.now() - parsed.t > LS_TTL) {
      localStorage.removeItem(lsKey(examKey, roll));
      return null;
    }
    if (parsed.r.found !== true || !Array.isArray(parsed.r.subjects)) {
      localStorage.removeItem(lsKey(examKey, roll));
      return null;
    }
    return parsed.r;
  } catch {
    return null;
  }
}
function lsSet(examKey: string, roll: string, result: BisepResult): void {
  try {
    localStorage.setItem(lsKey(examKey, roll), JSON.stringify({ t: Date.now(), r: result }));
  } catch {
    // Quota / private mode — cache is best-effort, never fatal.
  }
}

/** Fetch a single roll number with retries. Returns the raw proxy response.
 *  • { retry: true } (proxy says session expired) → ONE spaced retry
 *  • clean not-found ("No result found for this roll number") → FINAL, no retry
 *  • network / 5xx / malformed → short retries (Vercel cold starts etc.) */
async function fetchOne(roll: string, examKey: string): Promise<BisepResult> {
  // Device cache first — zero board requests for repeats.
  const cached = lsGet(examKey, roll);
  if (cached) return cached;

  let lastError: Error | null = null;
  let lastRetrySignal: BisepResult | null = null;

  // Outer loop: at most 1 retry-signal retry. Inner loop: network-level
  // retries. This keeps total attempts bounded and well inside the
  // serverless deadline.
  for (let retryAttempt = 0; retryAttempt <= RETRY_RETRIES; retryAttempt++) {
    let networkRetries = 0;
    for (;;) {
      try {
        const r = await fetch(`${PROXY_URL}?roll=${encodeURIComponent(roll)}`, {
          headers: { Accept: "application/json" },
        });
        // Vercel may return an HTML error page if the function crashes —
        // guard the JSON parse.
        let body: unknown = null;
        try {
          body = await r.json();
        } catch {
          body = null;
        }
        if (!body || typeof body !== "object") {
          throw new Error(`Invalid response (HTTP ${r.status})`);
        }
        const out = body as BisepResult;

        if (out.found === true) {
          lsSet(examKey, roll, out);
          return out;
        }

        // Clean not-found — the board itself answered "no record for this
        // roll". FINAL: retrying it only wastes the shared board budget.
        if (!isRetrySignal(out.message) && !isRetrySignal(out.error)) {
          return out;
        }

        // Proxy says "session expired, please retry". One spaced retry.
        lastRetrySignal = out;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Network errors / 5xx / malformed payloads: short fast retries.
        if (networkRetries < MAX_RETRIES) {
          networkRetries++;
          await sleep(RETRY_DELAY_MS * networkRetries);
          continue;
        }
        break;
      }
    }
    if (retryAttempt < RETRY_RETRIES) await sleep(RETRY_DELAY);
  }

  // If the proxy's last answer was a retry signal, surface that to the
  // caller — the proxy genuinely tried twice with fresh sessions and the
  // board still 403'd. Treat as a transient miss so the second sweep can
  // pick it up.
  if (lastRetrySignal) return lastRetrySignal;

  return {
    found: false,
    error: lastError?.message ?? "Could not reach BISE Peshawar — please try again in a moment",
  };
}

/** Run an array of items through an async worker with bounded concurrency. */
async function pool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/** Fetch results for a list of roll numbers, with progress reporting.
 *  Returns a list of NormalizedResult in the SAME ORDER as the input.
 *  `className` is required — it's what percentage is computed against
 *  (600 for 9th, 1200 for 10th, 550 for 1st/2nd Year; see classMaxMarks.ts).
 *  `examKey` (optional but strongly recommended — ReportCardModal passes
 *  `${examType}-${year}-${className}`) namespaces the device cache so a
 *  different exam never serves stale marksheets for the same roll number.
 *
 *  Internally: pass 1 fetches every roll at bounded concurrency. Pass 2
 *  re-tries only rolls whose failure was TRANSIENT (proxy retry-signal or
 *  network). Rolls the board cleanly reported as "no record" are final and
 *  never re-queried. */
export async function bulkFetchResults(
  rolls: string[],
  className: ClassName,
  onProgress?: ProgressCallback,
  examKey?: string
): Promise<NormalizedResult[]> {
  const exam = examKey || `${className}-unknown-exam`;
  const total = rolls.length;
  let done = 0;

  const raw = await pool(
    rolls,
    async (roll) => {
      const r = await fetchOne(roll, exam);
      done += 1;
      onProgress?.(done, total, roll);
      return r;
    },
    CONCURRENCY
  );

  // ── Second sweep: retry only TRANSIENT failures ─────────────────────
  // A clean "no result found for this roll number" is the board's final answer
  // and must NOT be re-queried. Proxy retry-signals (session expired) and
  // network outcomes get one more pass at lower concurrency.
  const transientIdx = raw
    .map((r, i) => {
      if (r.found) return -1;
      const msg = `${r.message || ""} ${r.error || ""}`;
      return isRetrySignal(msg) || /network|timeout|invalid response|http 5/i.test(msg) ? i : -1;
    })
    .filter((i) => i !== -1);

  if (transientIdx.length > 0) {
    const retryRolls = transientIdx.map((i) => rolls[i]);
    const retried = await pool(
      retryRolls,
      (roll) => fetchOne(roll, exam),
      4 // gentler second sweep — most rolls already succeeded
    );
    transientIdx.forEach((idx, j) => {
      if (retried[j].found) raw[idx] = retried[j];
    });
  }

  return raw.map((r, i) => normalizeResult(r, rolls[i], className));
}

/** A roll counts as "missing" when we have no marksheet for it. A clean
 *  "No result found for this roll number" answer from the board is a real
 *  final answer (wrong roll / not registered), so it is NOT retried unless
 *  `includeNotFound` is set. Everything else — session expired, could not
 *  reach the board, network / proxy errors — is missing and worth another try. */
export function isMissingResult(r: NormalizedResult, includeNotFound = false): boolean {
  if (r.found) return false;
  const msg = r.error || "";
  const cleanNotFound = /no result found for this roll|record not found/i.test(msg);
  return includeNotFound ? true : !cleanNotFound;
}

/** Retry ONLY the rolls whose result is missing and merge what comes back
 *  into the existing list (same order, same length). Rolls that already
 *  have a result are never re-requested — they are not even passed to the
 *  fetcher. Runs gently (concurrency 2, spaced) because every recovered
 *  marksheet is also saved in the device cache by fetchOne so a later
 *  Search / Combined run reuses it for free. */
export async function retryMissingResults(
  current: NormalizedResult[],
  className: ClassName,
  onProgress?: ProgressCallback,
  examKey?: string,
  includeNotFound = false
): Promise<NormalizedResult[]> {
  const exam = examKey || `${className}-unknown-exam`;
  const missingIdx = current
    .map((r, i) => (isMissingResult(r, includeNotFound) ? i : -1))
    .filter((i) => i !== -1);
  if (missingIdx.length === 0) return current;

  const total = missingIdx.length;
  let done = 0;
  const rolls = missingIdx.map((i) => current[i].roll);

  // Concurrency 2 + a short jittered gap between lookups: gentle on the
  // proxy's session pool while still being much faster than v5's serial 1.
  const raw = await pool(
    rolls,
    async (roll) => {
      const r = await fetchOne(roll, exam);
      done += 1;
      onProgress?.(done, total, roll);
      if (done < total) await sleep(200 + Math.floor(Math.random() * 250));
      return r;
    },
    2
  );

  const next = current.slice();
  missingIdx.forEach((idx, j) => {
    // Found → real marksheet. Still missing → keeps the freshest failure
    // reason so the table explains what happened.
    next[idx] = normalizeResult(raw[j], current[idx].roll, className);
  });
  return next;
}
