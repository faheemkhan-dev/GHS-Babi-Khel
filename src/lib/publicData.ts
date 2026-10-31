// src/lib/publicData.ts — browser client for /api/public-data (Phase 5)
// ═══════════════════════════════════════════════════════════════════════════
// ONE fetch helper every public-read hook uses:
//
//   const data = await cachedOrDirect("notices", { limit: 8 }, () =>
//     supabase.from("notices").select(...)...   // the exact old query, kept
//   );                                          // as the fallback
//
// • Served by Vercel's CDN (`s-maxage` set per kind in api/public-data.js)
//   → 150 students share a handful of DB reads instead of 150 each.
// • Falls back to the ORIGINAL direct-Supabase query whenever the function
//   is unreachable, unconfigured (503), or errors (502/timeout). That makes
//   this layer an optimization that can never take the site down — local
//   `vite dev` (no Vercel functions) behaves exactly like before.
// • Hard 12 s client timeout: a hanging function must never freeze a page
//   that can answer from Supabase directly.
//
// PUBLISH-BUST (results-day exactness, shared key)
//   When a scheduled result flips to published, autoPublish.applyPublishedToCaches
//   calls markPublishBust(). For the next 75 s, "results family" kinds append a
//   `_=<ms>` param — a fresh CDN cache key — so every student's post-publish
//   refetch reads the just-published rows instead of a cached pre-publish copy.
// ═══════════════════════════════════════════════════════════════════════════

// 8 s hard client timeout. The API answers in well under a second when the
// CDN is warm, and Vercel itself kills a hobby function at ~10 s — so a
// request still pending at 8 s is effectively dead. The old 12 s window
// made every degraded-API fallback (the direct Supabase path) wait four
// extra seconds for nothing, which students experienced as the search
// "hanging". 8 s still gives a cold function start generous headroom.
const TIMEOUT_MS = 8000;

/** Kinds whose staleness is visible the second a scheduled publish lands. */
const RESULTS_FAMILY = new Set([
  "result-rank",
  "class-average",
  "has-results",
  "latest-exam",
  "result-search-meta",
  "result-schedule",
  "result-years",
  "merit-lists",
  "merit-entries",
  "notices",
  "notice",
  "ticker",
]);

let bustUntil = 0;
/** Called by autoPublish the moment a scheduled publish is confirmed. */
export function markPublishBust(): void {
  bustUntil = Date.now() + 75_000;
}

export class PublicDataError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicDataError";
    this.status = status;
  }
}

function buildUrl(kind: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  q.set("kind", kind);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  if (bustUntil > Date.now() && RESULTS_FAMILY.has(kind)) {
    // New cache key ⇒ guaranteed origin read, so the just-published rows are
    // never served from a pre-publish copy. The key is a 10-second BUCKET shared by
    // every visitor (not a per-request timestamp): the first student's request
    // fills the edge cache and the other ~150 share it, so the burst costs a
    // few database reads per kind instead of one per student. No added delay.
    q.set("_", String(Math.floor(Date.now() / 10_000)));
  }
  return `/api/public-data?${q.toString()}`;
}

/**
 * Fetch a public-data kind from the cached API. Throws PublicDataError on
 * any failure — callers fall back to their direct Supabase query.
 */
export async function publicData<T>(
  kind: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T> {
  const res = await fetch(buildUrl(kind, params), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Browser cache: the CDN response already carries max-age=0 for itself;
    // revalidation semantics come from the edge, keep the fetch plain.
    cache: "default",
  });
  if (!res.ok) throw new PublicDataError(`public-data ${kind} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

/**
 * Cached-first with the hook's ORIGINAL query as the fallback.
 * Use inside React Query `queryFn`s; rethrows the fallback's error so
 * retry/error UI behaves exactly as before.
 */
export async function cachedOrDirect<T>(
  kind: string,
  params: Record<string, string | number | boolean | undefined | null>,
  direct: () => Promise<T>,
): Promise<T> {
  try {
    return await publicData<T>(kind, params);
  } catch {
    // API unreachable/unconfigured/broken → the old code path, unchanged.
    return direct();
  }
}
