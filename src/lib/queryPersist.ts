// ─────────────────────────────────────────────────────────────────────────────
// Offline data cache — Homepage, About, Contact, News, Notices, Calendar,
// Results, Admission, Notes, Merit List, Roll No. Slip
// ─────────────────────────────────────────────────────────────────────────────
// Persists the React Query cache for these public pages' data (notices,
// news, teachers, achievements, school settings, school events, results,
// the homepage's "School Rank #1" toppers section, the homepage's
// admission-banner settings, and the Notes subject + chapter lists)
// into IndexedDB, so that when a page loads with no internet, it can paint
// instantly from the last-seen data instead of showing empty/loading
// states. When the network is back, React Query's normal background
// refetch (staleTime) updates it silently — the user never notices a
// "sync" happening.
//
// About and Contact only need school-settings (already covered below).
// News/Notices list pages use the "news"/"notices" keys. Individual
// news/notice detail pages ("news-item"/"notice-item") are intentionally
// NOT persisted yet — out of scope so far.
//
// Calendar uses "school-events" (a specific month range) and
// "school-events-upcoming". Results uses "results" (filtered by class/
// exam/year/search) and "result-years". Both are persisted like everything
// else, EXCEPT one-off text searches on Results — see shouldPersist below
// — since a search term is rarely repeated and would just fill up storage
// with entries nobody will hit from cache again.
//
// The homepage's "Hall of Fame" toppers section uses the
// "home-school-toppers" key — persisted so the #1-per-class cards render
// offline. The homepage's admission CTA uses "admission-settings" —
// persisted so the "Admissions Open/Closed" banner shows the correct
// state offline. Notes uses "note-subjects" (the subject grid on /notes)
// and "note-chapters" (the chapter list inside a subject); both are
// persisted so students can browse notes offline after their first visit.
//
// Deliberately scoped to a small allow-list of query keys (not the whole
// app) so this cannot interfere with admin/dashboard data, which must
// always be fresh and is out of scope.
//
// No new dependency added — uses the browser's built-in IndexedDB directly
// so this stays a pure file-drop change.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueryClient } from "@tanstack/react-query";

const DB_NAME = "ghs-homepage-cache";
const DB_VERSION = 1;
const STORE_NAME = "queries";
const STORAGE_KEY = "homepage-query-cache";

// Only these top-level query key prefixes are persisted. Anything else
// (admin data, auth, dashboards) is left entirely alone.
const PERSISTED_KEY_PREFIXES = [
  "notices",
  "news",
  "teachers",
  "achievements",
  "school-settings",
  "school-events",
  "school-events-upcoming",
  "results",
  "result-years",
  // Homepage → "Hall of Fame" toppers section (#1 per class, latest exam).
  // Lets the cards render from cache on a cold offline load instead of
  // disappearing (the query has placeholderData: [] so without this it
  // would just be empty when offline).
  "home-school-toppers",
  // Homepage → admission CTA banner ("Admissions Open/Closed"). Lets the
  // banner paint with the correct open/closed state offline instead of
  // falling through to the closed-CTA fallback.
  "admission-settings",
  // Notes → subject grid on /notes + chapter list inside a subject.
  // Lets students browse the subject list and any previously-visited
  // subject's chapter list offline. Chapter content text comes from
  // Supabase in the same query, so it travels with the cache too; PDF /
  // audio files are served from Cloudinary and are cached separately by
  // the service worker (see public/sw.js).
  "note-subjects",
  "note-chapters",
  // Gallery → album grid on /gallery + photos inside an album.
  // Lets students view previously-visited gallery albums and photos offline.
  "gallery-albums",
  "gallery-photos",
  // Result Card → "which exam is currently available" heading shown before
  // any search (Results.tsx useLatestPublishedExam). Small, cheap, and lets
  // the page paint its title instantly instead of a blank heading while
  // offline or on a slow first load.
  "latest-published-exam",
  // Merit List (public /merit-list page) — the list of published merit
  // lists + each one's ranked student entries. These snapshot the exact
  // published data at publish time (see AdminMeritList.tsx), so caching
  // them is safe: a cached copy can never show something the admin hasn't
  // actually published. Lets the Merit List page render fully offline
  // after a first visit, and paint instantly on a slow connection instead
  // of a blank/loading state.
  "published-merit-lists",
  "merit-list-data",
  // Roll No. Slip finder (public /exam-roll-numbers page) — published/
  // scheduled exam sessions and the roll number list for whichever session
  // is selected. Lets a student reopen their already-fetched roll slip
  // offline (e.g. to show it at the exam center with no signal) instead of
  // hitting a blank "loading" screen.
  "public-roll-slip-sessions",
  "public-exam-rolls",
  // Roll No. Slip finder also shows the exam date sheet on the slip itself
  // (see useAllExamSchedule in src/hooks/useNewFeatures.ts) — persisted so
  // the paper-by-paper schedule still renders on a cached/offline slip.
  "all-exam-schedule",
];

function shouldPersist(queryKey: readonly unknown[]): boolean {
  const prefix = queryKey[0];
  if (typeof prefix !== "string" || !PERSISTED_KEY_PREFIXES.includes(prefix)) return false;

  // Results query key shape: ["results", classFilter, examType, year, search]
  // Skip persisting a specific search-text result — search terms are rarely
  // repeated, so caching them offline has little value and would otherwise
  // grow storage with one-off entries indefinitely.
  if (prefix === "results") {
    const search = queryKey[4];
    if (typeof search === "string" && search.trim().length > 0) return false;
  }

  return true;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_e) {
      resolve(null);
    }
  });
}

async function idbGet(): Promise<unknown | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(STORAGE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch (_e) {
      resolve(null);
    }
  });
}

async function idbSet(value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (_e) {
      resolve();
    }
  });
}

/**
 * Call after an admin mutation (add/update/delete) changes data for a
 * persisted key prefix (e.g. "achievements"). Removes that prefix's
 * entries from the IndexedDB snapshot so a stale offline copy can never
 * be re-injected into the query cache on a future cold/offline load.
 * Without this, restoreHomepageCache() would keep resurrecting deleted
 * or outdated rows from a visitor's last offline snapshot indefinitely,
 * since the snapshot itself never got told about the change.
 */
export async function purgePersistedKey(prefix: string): Promise<void> {
  const saved = await idbGet();
  if (!saved || typeof saved !== "object") return;
  const entries = (saved as { entries?: Array<{ queryKey: unknown[]; data: unknown; dataUpdatedAt: number }> }).entries;
  if (!Array.isArray(entries)) return;

  const filtered = entries.filter((entry) => !(entry && Array.isArray(entry.queryKey) && entry.queryKey[0] === prefix));
  if (filtered.length !== entries.length) {
    await idbSet({ entries: filtered, savedAt: Date.now() });
  }
}

/**
 * Call once on app start. Restores any cached homepage data into the
 * QueryClient immediately (synchronously-ish — as soon as IndexedDB
 * responds, before the first network request would normally resolve),
 * so the homepage can paint from cache on a cold, offline load.
 */
export async function restoreHomepageCache(queryClient: QueryClient): Promise<void> {
  const saved = await idbGet();
  if (!saved || typeof saved !== "object") return;
  const entries = (saved as { entries?: Array<{ queryKey: unknown[]; data: unknown; dataUpdatedAt: number }> }).entries;
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.queryKey)) continue;
    // Don't clobber data that's already fresher in memory (e.g. a fast
    // network beat IndexedDB to it).
    const existing = queryClient.getQueryState(entry.queryKey);
    if (existing && existing.dataUpdatedAt >= entry.dataUpdatedAt) continue;
    queryClient.setQueryData(entry.queryKey, entry.data);
  }
}

/**
 * Call once on app start. Subscribes to the QueryClient's cache and writes
 * homepage-relevant query data to IndexedDB whenever it changes, debounced
 * so we're not hammering IndexedDB on every render.
 */
export function persistHomepageCache(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const cache = queryClient.getQueryCache();
    const entries = cache
      .getAll()
      .filter((q) => shouldPersist(q.queryKey) && q.state.data !== undefined)
      .map((q) => ({
        queryKey: q.queryKey as unknown[],
        data: q.state.data,
        dataUpdatedAt: q.state.dataUpdatedAt,
      }));
    if (entries.length > 0) {
      void idbSet({ entries, savedAt: Date.now() });
    }
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (!event?.query || !shouldPersist(event.query.queryKey)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}
