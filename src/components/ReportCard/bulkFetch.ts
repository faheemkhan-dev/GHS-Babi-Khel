// src/components/ReportCard/bulkFetch.ts
// Fetches BISE Peshawar results for a list of roll numbers via the existing
// /api/bisep-proxy endpoint.
//
// v5 — rewritten around what live probing of the board actually showed
// (Sep 22, 2026, cloud.bisep.edu.pk with the exact warmed-session flow):
//   • The board rejects ~40–60 % of ALL requests probabilistically with
//     403 "Invalid request." — bursts, 2.5 s spacing and fresh sessions
//     all fail at the same rate. There is no "safe pace" that avoids it.
//   • An IMMEDIATE retry (<150 ms) after a 403 almost always 403s again;
//     a retry spaced ~0.5–2.5 s later usually succeeds.
//   • Results are FINAL once published, so every fetched marksheet can be
//     cached on the device and re-served forever (within the exam).
// The proxy now already retries up to 5 times server-side; this layer adds:
//   • Concurrency 3 (was 6) — parallel lookups share one proxy IP, and the
//     rejection rate made 6-way bursts mostly throw each other under the
//     bus. 3-way with the proxy's internal retries gets every roll through
//     with fewer wasted board requests.
//   • BUSY-aware retries — the old fetchOne only retried network/5xx errors.
//     The busy response arrives as HTTP 200 { found:false, message:"…too
//     many requests…" } and was treated as FINAL, then blindly re-queried
//     by the second sweep together with genuinely-invalid rolls. Now busy
//     outcomes get dedicated spaced retries (1.2 s→2.4 s, jittered) while a
//     clean "no record for this roll" is accepted as final immediately —
//     no more board requests wasted on rolls that genuinely have no result.
//   • Read-through localStorage cache keyed by exam — a roll fetched once
//     (by search, comparison, or a previous bulk run) never touches the
//     board again for 24 h. A 54-roll class run re-run after a hiccup
//     costs ~0 board requests for the rolls already saved.
//   • The second sweep now only retries rolls whose failure is transient
//     (busy / network / proxy error) — never clean not-founds.

import type { BisepResult, ClassName, NormalizedResult, ProgressCallback } from "./types";
import { normalizeResult } from "./normalize";

const PROXY_URL = "/api/bisep-proxy";
const CONCURRENCY = 3;
const MAX_RETRIES = 4; // network / 5xx / malformed payloads
const RETRY_DELAY_MS = 800;
const BUSY_RETRIES = 3; // board-busy outcomes (proxy already tried 5×)
const BUSY_DELAY_MS = 1200;
/** Board marksheets are final — cached a full day per exam on this device. */
const LS_TTL = 24 * 60 * 60 * 1000;
const LS_PREFIX = "ghs-bisep-result:";

/** Sleep helper. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Jittered spaced delay — immediate retries after a board 403 fail again;
 *  spaced ones recover. */
const spacedDelay = (base: number, attempt: number) =>
  base + attempt * 600 + Math.floor(Math.random() * 350);

const busyMessage = (msg?: string) => /too many requests|wait a few seconds/i.test(String(msg || ""));

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
 *  • busy (HTTP 200, found:false, "too many requests") → spaced retries
 *  • clean not-found ("No result found for this roll number") → FINAL, no retry
 *  • network / 5xx / malformed → short retries (Vercel cold starts etc.) */
async function fetchOne(roll: string, examKey: string): Promise<BisepResult> {
  // Device cache first — zero board requests for repeats.
  const cached = lsGet(examKey, roll);
  if (cached) return cached;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
    let networkRetries = 0;
    // ── one busy-cycle attempt: up to MAX_RETRIES network-level retries ──
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
        if (!busyMessage(out.message) && !out.error?.match?.(/too many requests|wait a few seconds/i)) {
          return out;
        }

        // Busy — break to the spaced busy-retry loop below.
        lastError = new Error(out.message || out.error || "Board busy");
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
    if (attempt < BUSY_RETRIES) await sleep(spacedDelay(BUSY_DELAY_MS, attempt));
  }

  return {
    found: false,
    error: lastError?.message ?? "Board busy — please try again in a few seconds",
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
 *  Internally: pass 1 fetches every roll at bounded concurrency (busy-aware
 *  retries included). Pass 2 re-tries only rolls whose failure was
 *  TRANSIENT (busy/network/proxy) at lower concurrency. Rolls the board
 *  cleanly reported as "no record" are final and never re-queried. */
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
  // A clean "no record for this roll number" is the board's final answer
  // and must NOT be re-queried (the old sweep re-hit those, burning the
  // shared budget and slowing every class PDF for nothing). Busy/network
  // outcomes get one more dedicated pass at lower concurrency.
  const transientIdx = raw
    .map((r, i) => {
      if (r.found) return -1;
      const msg = `${r.message || ""} ${r.error || ""}`;
      return busyMessage(msg) || /network|timeout|invalid response|http 5/i.test(msg) ? i : -1;
    })
    .filter((i) => i !== -1);

  if (transientIdx.length > 0) {
    const retryRolls = transientIdx.map((i) => rolls[i]);
    const retried = await pool(
      retryRolls,
      (roll) => fetchOne(roll, exam),
      2
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
 *  `includeNotFound` is set. Everything else — board busy, could not reach
 *  the board, network / proxy errors — is missing and worth another try. */
export function isMissingResult(r: NormalizedResult, includeNotFound = false): boolean {
  if (r.found) return false;
  const msg = r.error || "";
  const cleanNotFound = /no result found for this roll|record not found/i.test(msg);
  return includeNotFound ? true : !cleanNotFound;
}

/** Retry ONLY the rolls whose result is missing and merge what comes back
 *  into the existing list (same order, same length). Rolls that already
 *  have a result are never re-requested — they are not even passed to the
 *  fetcher. Runs gently (concurrency 1, spaced) because the board rejects
 *  bursts; every recovered marksheet is also saved in the device cache by
 *  fetchOne so a later Search / Combined run reuses it for free. */
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

  // Concurrency 1 + a short jittered gap between lookups: gentlest possible
  // pattern for a board that rejects bursts (each lookup already retries
  // internally with spaced back-off).
  const raw = await pool(
    rolls,
    async (roll) => {
      const r = await fetchOne(roll, exam);
      done += 1;
      onProgress?.(done, total, roll);
      if (done < total) await sleep(300 + Math.floor(Math.random() * 400));
      return r;
    },
    1
  );

  const next = current.slice();
  missingIdx.forEach((idx, j) => {
    // Found → real marksheet. Still missing → keeps the freshest failure
    // reason so the table explains what happened.
    next[idx] = normalizeResult(raw[j], current[idx].roll, className);
  });
  return next;
}
