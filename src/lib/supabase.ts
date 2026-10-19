import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── PERF: preconnect to the Supabase origin as early as possible ───────────
// The REST API lives on a DIFFERENT origin (…supabase.co), and every data
// query is a CORS request: before the first one can fly, the browser must
// do DNS + TCP + TLS to that origin, and (for each new URL shape) a CORS
// preflight. On the slow mobile networks this school's visitors use, that
// cold connection setup alone costs 300–900 ms — AFTER the app JS has
// already downloaded and parsed, right when the visitor is staring at
// skeletons waiting for content.
//
// This module is the first place the Supabase URL is known, and it is
// imported by the entry chunk — so opening the connection HERE (before
// React even mounts, before any query fires) means the first query wave
// departs over an already-warm TLS session. `<link rel=preconnect>` is
// purely a hint; it never blocks or breaks anything, and if the URL is
// missing/invalid we simply skip it.
if (typeof document !== "undefined" && supabaseUrl && /^https?:\/\//.test(supabaseUrl)) {
  try {
    const origin = new URL(supabaseUrl).origin;
    const existing = document.querySelector<HTMLLinkElement>(`link[rel="preconnect"][href="${origin}"]`);
    if (!existing) {
      const link = document.createElement("link");
      // crossorigin matches the CORS-mode fetches supabase-js makes
      // (Authorization header), so the warmed connection is actually reused.
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  } catch {
    /* never let a perf hint break the app */
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENT ADMIN SESSION — "sign in once, stay signed in"
// ═══════════════════════════════════════════════════════════════════════════
// Why admins were being signed out "after some time", and what fixes each:
//
//  1. signOut() defaults to scope "global": it REVOKES EVERY SESSION of the
//     account on EVERY device. One sign-out (or one failed sign-in attempt in
//     SignIn.tsx) on a laptop silently killed the phone's session too.
//     → signOutSafely() below always uses scope "local" (this device only).
//
//  2. Session lived only in localStorage. Mobile browsers (Safari ITP, low
//     storage, "clear site data", app-switching) evict it without warning.
//     → resilientStorage mirrors the session into IndexedDB and restores it
//       into localStorage when it goes missing, and we ask the browser to
//       mark this site's storage as persistent.
//
//  3. When a token refresh was interrupted (phone locked / tab frozen mid-
//     request) or storage vanished, supabase-js emitted SIGNED_OUT and the
//     app obeyed. → We keep a separate, always-latest backup of the session
//     and, on any SIGNED_OUT the user did not ask for, silently restore it
//     (see recoverSessionIfUnintended). A genuinely revoked/expired refresh
//     token still ends in a normal sign-out — we never loop or resurrect it.
//
//  4. Refresh timers are throttled in background tabs, so a token could
//     expire while the tab slept. → authKeepAlive.ts re-validates the
//     session when the tab regains focus / network returns / every few min.

const IDB_NAME = "ghsbk-auth";
const IDB_STORE = "kv";
const IDB_TIMEOUT_MS = 1500;
const BACKUP_KEY = "ghsbk_session_backup";

function raceTimeout<T>(p: Promise<T>, fallback: T, ms = IDB_TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

let idbPromise: Promise<IDBDatabase | null> | null = null;
function idbOpen(): Promise<IDBDatabase | null> {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

async function idbGet(key: string): Promise<string | null> {
  return raceTimeout(
    (async () => {
      const db = await idbOpen();
      if (!db) return null;
      return new Promise<string | null>((resolve) => {
        try {
          const r = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
          r.onsuccess = () => resolve(typeof r.result === "string" ? r.result : null);
          r.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    })(),
    null,
  );
}

async function idbSet(key: string, value: string): Promise<void> {
  await raceTimeout(
    (async () => {
      const db = await idbOpen();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    })(),
    undefined,
  );
}

async function idbDel(key: string): Promise<void> {
  await raceTimeout(
    (async () => {
      const db = await idbOpen();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    })(),
    undefined,
  );
}

const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage full / private mode */ } };
const lsDel = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

/** localStorage (fast, synchronous-friendly) + IndexedDB mirror (survives eviction). */
const resilientStorage = {
  async getItem(key: string): Promise<string | null> {
    const fast = lsGet(key);
    if (fast !== null) return fast;
    const mirrored = await idbGet(key);
    if (mirrored !== null) lsSet(key, mirrored); // self-heal localStorage
    return mirrored;
  },
  async setItem(key: string, value: string): Promise<void> {
    lsSet(key, value);
    await idbSet(key, value);
  },
  async removeItem(key: string): Promise<void> {
    lsDel(key);
    await idbDel(key);
  },
};

// Standard client — used for authenticated features (admin, profiles, etc.)
// storageKey is intentionally left at the library default so sessions that
// already exist in people's browsers keep working after this deploy.
const authOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: resilientStorage,
  },
};

export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey, authOptions)
  : createClient("https://placeholder.supabase.co", "placeholder", authOptions);

// ── Session backup + unintended-sign-out recovery ─────────────────────────
let signingOut = false;
let lastRecoveryAt = 0;

async function readBackup(): Promise<{ access_token: string; refresh_token: string } | null> {
  const raw = lsGet(BACKUP_KEY) ?? (await idbGet(BACKUP_KEY));
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    return b?.access_token && b?.refresh_token ? b : null;
  } catch {
    return null;
  }
}

async function clearBackup(): Promise<void> {
  lsDel(BACKUP_KEY);
  await idbDel(BACKUP_KEY);
}

if (typeof window !== "undefined") {
  // Always keep the LATEST tokens (refresh tokens rotate on every refresh).
  supabase.auth.onAuthStateChange((event, session) => {
    if (signingOut) return;
    if (session?.access_token && session?.refresh_token && event !== "SIGNED_OUT") {
      const value = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      lsSet(BACKUP_KEY, value);
      void idbSet(BACKUP_KEY, value);
    }
  });

  // Ask the browser not to evict this site's storage under pressure.
  try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
}

export type RecoveryResult = "recovered" | "failed" | "unknown";

/**
 * Called when the library reports SIGNED_OUT (or finds no session at startup).
 * If the person did NOT click Sign out, restore the last good session.
 *   "recovered" → session is back, keep the UI as it is
 *   "unknown"   → network problem; we could not tell — do NOT sign the UI out
 *   "failed"    → no backup / token really revoked → treat as signed out
 */
export async function recoverSessionIfUnintended(): Promise<RecoveryResult> {
  if (signingOut) return "failed";
  const backup = await readBackup();
  if (!backup) return "failed";
  const now = Date.now();
  if (now - lastRecoveryAt < 15_000) return "unknown"; // no tight loops
  lastRecoveryAt = now;
  try {
    const { data, error } = await supabase.auth.setSession(backup);
    if (!error && data.session) return "recovered";
    const status = (error as { status?: number } | null)?.status;
    const retryable =
      error?.name === "AuthRetryableFetchError" || status === 0 || (typeof status === "number" && status >= 500);
    if (retryable) return "unknown";
    await clearBackup(); // token genuinely dead — stop trying
    return "failed";
  } catch {
    return "unknown";
  }
}

/**
 * The ONLY way the app should sign someone out. Scope "local" ends this
 * device's session without revoking the admin's sessions on other devices.
 */
export async function signOutSafely(scope: "local" | "global" = "local"): Promise<void> {
  signingOut = true;
  try {
    await clearBackup();
    await supabase.auth.signOut({ scope });
  } finally {
    await clearBackup();
    signingOut = false;
  }
}

// Public client — used for admission form and any public-facing inserts.
// Auth is completely disabled so a broken/expired refresh token cannot
// block or hang public requests. This is the root cause of the admission
// submit hanging: the main client gets stuck in an auth refresh loop.
// storageKey is unique so both clients don't share the same localStorage
// key — fixes the "Multiple GoTrueClient instances detected" warning.
export const supabasePublic = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession:       false,
        autoRefreshToken:     false,
        detectSessionInUrl: false,
        storageKey:           "ghs-public-auth",
      },
    })
  : createClient("https://placeholder.supabase.co", "placeholder", {
      auth: {
        persistSession:       false,
        autoRefreshToken:     false,
        detectSessionInUrl: false,
        storageKey:           "ghs-public-auth",
      },
    });
