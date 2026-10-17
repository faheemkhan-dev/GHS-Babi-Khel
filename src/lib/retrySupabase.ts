// src/lib/retrySupabase.ts
// ─────────────────────────────────────────────────────────────────────────────
// Retry-with-backoff wrapper for one-off Supabase calls that are NOT routed
// through React Query (React Query already retries its own queries by
// default). Public pages like the Result Card search and Roll No. Slip
// finder fire raw `await supabase.from(...)` calls directly inside a click
// handler — on a slow/flaky mobile connection a single dropped packet or
// momentary DNS hiccup fails the whole lookup with a generic error, even
// though a second attempt a moment later would have succeeded fine.
//
// This wraps any async Supabase call with a few short retries and a small
// backoff, so transient failures self-heal invisibly instead of surfacing
// as "Search failed. Try again." to a student on a weak signal.
//
// Deliberately generic — works with any Supabase query builder result
// (`.select(...)` etc. all return a thenable `{ data, error }` promise).
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Total attempts including the first — default 3. */
  attempts?: number;
  /** Base delay in ms before the first retry; doubles each subsequent retry. */
  baseDelayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` and retries on failure with exponential backoff.
 *
 * `fn` may return a real Promise OR a Supabase query builder (which is a
 * Promise-like thenable — it has .then() but is not a Promise instance).
 * Awaiting either shape unwraps to the same resolved `{ data, error }`
 * value, so both are accepted here without changing any call site.
 *
 * Two failure shapes are handled:
 *  1. `fn` throws / rejects (network error, DNS failure, etc.) — retried.
 *  2. `fn` resolves with a Supabase-style `{ error }` object where `error`
 *     is a transient-looking failure (network/timeout, not a real query
 *     error like a bad column name) — retried; anything else is returned
 *     immediately so real errors (RLS denial, malformed query) don't waste
 *     time retrying something that will never succeed.
 *
 * On exhausting all attempts, returns whatever the last attempt produced
 * (either the resolved value or a thrown error), so callers can keep their
 * existing `if (error) throw error` / try-catch handling unchanged.
 */
export async function withRetry<T>(
  fn: () => T | PromiseLike<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastResult: T | undefined;
  let lastError: unknown;
  let hasResult = false;

  for (let i = 0; i < attempts; i++) {
    try {
      const result = await fn();
      hasResult = true;
      lastResult = result;

      // Supabase query builders resolve (never reject) with { data, error }.
      // Only retry if the error LOOKS transient — anything else (a real
      // query/permissions error) is returned immediately.
      const maybeError = (result as unknown as { error?: { message?: string } } | null)?.error;
      if (!maybeError) return result;

      if (isTransientMessage(maybeError.message) && i < attempts - 1) {
        await sleep(baseDelay * Math.pow(2, i));
        continue;
      }
      return result;
    } catch (err) {
      lastError = err;
      hasResult = false;
      if (i < attempts - 1) {
        await sleep(baseDelay * Math.pow(2, i));
        continue;
      }
    }
  }

  if (hasResult) return lastResult as T;
  throw lastError;
}

function isTransientMessage(message?: string): boolean {
  if (!message) return true; // no message at all — treat conservatively as transient
  const m = message.toLowerCase();
  return (
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("fetch") ||
    m.includes("failed to fetch") ||
    m.includes("connection") ||
    m.includes("econn") ||
    m.includes("gateway") ||
    m.includes("503") ||
    m.includes("502") ||
    m.includes("504")
  );
}
