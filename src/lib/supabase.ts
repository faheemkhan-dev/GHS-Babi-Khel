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

// Standard client — used for authenticated features (admin, profiles, etc.)
export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient("https://placeholder.supabase.co", "placeholder");

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
