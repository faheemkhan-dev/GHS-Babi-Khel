import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  full_name: string | null;
  role: string;
  class: string | null;
  roll_number: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /**
   * True when a signed-in session was already present in localStorage before
   * the async getSession() round trip finished. Route guards use this to
   * avoid showing a blocking "please wait" spinner to someone who is
   * demonstrably still signed in — see AdminProtectedRoute.
   */
  hasCachedSession: boolean;
  /**
   * True only while getSession() timed out on a slow link AND a signed-in
   * session is sitting in localStorage — i.e. "we do not know yet", which is
   * NOT the same as "signed out". Route guards must keep waiting (or keep
   * what is already on screen) instead of redirecting. Cleared by the first
   * auth event, which delivers the real answer.
   */
  sessionPending: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// How long before any single Supabase call is abandoned.
//
// ── AUTH_INIT_TIMEOUT_MS ──────────────────────────────────────────────────
// This used to be 8000ms, then 3000ms (to avoid a long spinner on slow
// connections), paired with a `signOut()` call on timeout. That combination
// was the actual bug behind two reported issues:
//   1. Refreshing the page while genuinely signed in would sometimes log
//      the user back out — `getSession()` is a local read, but it can
//      still take >3s on a slow/throttled mobile connection or briefly
//      stall on a Web Locks race, and the timeout handler treated that as
//      "stale session" and called signOut(), destroying a perfectly valid
//      session.
//   2. Because of (1), navigating Dashboard → Home could leave the user
//      looking signed-out (Dashboard/Admin buttons gone) until they signed
//      in again — the session really had been deleted, not just slow to
//      load.
//
// Fix: the timeout no longer calls signOut() (see the catch block below) —
// it just stops blocking the UI and lets `onAuthStateChange`'s
// INITIAL_SESSION event deliver the real session shortly after. Bumped to
// 5000ms as a bit more headroom for slow connections; this is now just
// "how long to show a spinner," not "how long until we delete your login."
const PROFILE_FETCH_TIMEOUT_MS = 6000;
const AUTH_INIT_TIMEOUT_MS = 5000;

// Wraps a promise with a hard timeout — rejects if the promise doesn't settle in time
function withTimeout<T>(promise: PromiseLike<T>, ms: number, label = "timeout"): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms)
    ),
  ]);
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Profile cache ───────────────────────────────────────────────────────
// Persists the last-known profile (role, name, etc.) in localStorage so it's
// available SYNCHRONOUSLY on first render — before the async getSession() /
// fetchProfile() round trip resolves. Without this, every fresh mount of
// AuthProvider (page refresh, or navigating back to "/") starts with
// profile=null, so isAdmin is false for a few seconds and the Admin Panel
// link disappears from the Navbar until the fetch finishes.
const PROFILE_CACHE_KEY = "ghsbk_profile_cache";

function readCachedProfile(userId: string | null): Profile | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { userId: string; profile: Profile };
    return cached.userId === userId ? cached.profile : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(userId: string, profile: Profile | null) {
  try {
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ userId, profile }));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch {
    // ignore (e.g. private browsing / storage full)
  }
}

// Reads whatever Supabase session is already sitting in localStorage,
// synchronously, so we can seed `profile` from cache on the very first
// render — before getSession() (which is async) has a chance to resolve.
function getCachedUserId(): string | null {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const uid = parsed?.user?.id || parsed?.currentSession?.user?.id;
      if (uid) return uid;
    }
  } catch {
    // ignore
  }
  return null;
}

// Cheap, synchronous re-check used by route guards while `loading` is still
// true. Reading localStorage is instantaneous, so a guard can know "this
// person is signed in" without waiting on the network.
const hasCachedSession = () => getCachedUserId() !== null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(() => readCachedProfile(getCachedUserId()));
  const [loading, setLoading] = useState(true);
  const [sessionPending, setSessionPending] = useState(false);

  // Mirror of `profile` readable from long-lived callbacks (auth listener,
  // retry timer) without re-subscribing every time the profile changes.
  const profileRef = useRef<Profile | null>(profile);
  profileRef.current = profile;

  // ── applyProfile: a FAILED fetch must never erase a KNOWN profile ───────
  // fetchProfile() returns null for both "the row does not exist" and "the
  // network timed out". Treating both as "no profile" meant: slow connection
  // → profile refetch times out → setProfile(null) → AdminProtectedRoute saw
  // `!profile` and replaced the ENTIRE admin page with a bare spinner,
  // unmounting every open form and destroying all unsaved edits. A role
  // change is still honoured, because a SUCCESSFUL fetch returns the new row.
  const applyProfile = useCallback((userId: string, prof: Profile | null) => {
    if (!prof) return;
    setProfile(prof);
    writeCachedProfile(userId, prof);
  }, []);

  // Prevents a stale onAuthStateChange callback from setting loading=true
  // again after the initial init has already completed and set loading=false.
  const initDone = useRef(false);

  // fetchProfile: always has a hard timeout so it can never hang forever.
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      // Try the RPC first (faster, uses security definer)
      const rpcResult = await withTimeout(
        supabase.rpc("get_my_profile"),
        PROFILE_FETCH_TIMEOUT_MS,
        "get_my_profile RPC"
      );

      if (!rpcResult.error && rpcResult.data) {
        return rpcResult.data as Profile;
      }

      // Fallback: direct table query, also with a timeout
      const directResult = await withTimeout(
        supabase.from("profiles").select("*").eq("id", userId).single(),
        PROFILE_FETCH_TIMEOUT_MS,
        "profiles direct query"
      );

      if (directResult.error) {
        console.warn("Profile fetch error:", directResult.error.message);
        return null;
      }
      return directResult.data as Profile;
    } catch (e) {
      console.warn("Profile fetch failed/timed out:", e);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // ── STEP 1: initial session check ───────────────────────────────────────
    const init = async () => {
      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          AUTH_INIT_TIMEOUT_MS,
          "getSession"
        );

        if (!mounted) return;

        const sess = (sessionResult as { data: { session: Session | null } }).data.session;

        setSession(sess);
        setUser(sess?.user ?? null);

        if (sess?.user) {
          // fetchProfile already has its own internal timeout
          const prof = await fetchProfile(sess.user.id);
          if (mounted) applyProfile(sess.user.id, prof);
          // Subscribe to realtime changes for this user's profile row
          if (mounted) subscribeToProfileChanges(sess.user.id);
        }
      } catch (err) {
        // ── Timeout / failure path ──────────────────────────────────────────
        // `getSession()` either timed out or threw. This used to call
        // `supabase.auth.signOut()` here on the theory that a timeout means
        // a stale/corrupt refresh token. In practice, on slow mobile
        // connections (2G/3G, throttled Wi-Fi) or due to a known
        // supabase-js Web Locks race (multiple tabs / fast remounts),
        // `getSession()` can simply be SLOW or briefly stuck — even though
        // the session in storage is perfectly valid. Signing the user out
        // in that case was actively destroying good sessions: refreshing
        // the page would intermittently log the admin/user out for no
        // reason, and the Dashboard/Admin buttons would vanish until they
        // signed in again.
        //
        // Fix: don't sign out here. Just leave user/profile as null for
        // now and let `onAuthStateChange`'s INITIAL_SESSION event (STEP 2
        // below) deliver the real session shortly after — it reads from
        // the same storage but isn't bound by this timeout, so it recovers
        // a valid session instead of erasing it. We only ever clear state
        // here; we never call signOut(), so a real stale/expired token is
        // simply left for Supabase's own refresh logic to sort out (or for
        // the user to hit a 401 and be redirected, same as any other API
        // failure) rather than being treated as "guaranteed garbage."
        console.warn("Auth init: getSession was slow or failed (will retry via onAuthStateChange):", err);
        // Slow is not signed-out. Tell route guards the answer is still on
        // its way so they do not bounce a valid session to /auth/signin.
        if (mounted && hasCachedSession()) setSessionPending(true);
      } finally {
        // Always unblock the UI — no matter what happened above
        if (mounted) {
          initDone.current = true;
          setLoading(false);
        }
      }
    };

    init();

    // ── STEP 2: listen for subsequent auth events (sign in / sign out) ───────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        if (!mounted) return;

        // Any auth event is the real answer the timed-out getSession() was
        // missing.
        setSessionPending(false);

        if (event === "SIGNED_OUT") {
          setSession(null);
          setUser(null);
          setProfile(null);
          writeCachedProfile("", null);
          // Don't touch loading here — sign-out is instant
          return;
        }

        // Update session/user state immediately so the UI isn't blocked
        setSession(sess);
        setUser(sess?.user ?? null);

        if (sess?.user) {
          // supabase-js emits SIGNED_IN every time the tab regains focus and
          // TOKEN_REFRESHED every ~hour — always with the SAME user. When we
          // already hold this user's profile there is nothing to re-fetch
          // (role changes arrive through the realtime channel below), and on
          // a slow link that refetch is pure risk. Only fetch when we have
          // no profile for this user yet.
          const known = profileRef.current;
          const sameUserKnown = !!known && known.id === sess.user.id;
          if (sameUserKnown && event !== "USER_UPDATED") return;

          // Fetch profile in the background — DO NOT set loading=true.
          // A failed fetch keeps whatever profile we already have (see
          // applyProfile); the retry effect below keeps trying.
          fetchProfile(sess.user.id).then((prof) => {
            if (mounted) applyProfile(sess.user.id, prof);
          });
        } else {
          setProfile(null);
        }
      }
    );

    // ── STEP 3: realtime watch on the current user's profile row ────────────
    // Without this, when an admin approves or rejects a user the profile
    // sitting in memory stays stale — the user never sees the status change
    // until they manually refresh the page.
    // This channel re-fetches the profile whenever the DB row is updated,
    // so ProtectedRoute immediately reflects the new status (approved / rejected).
    let profileChannel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeToProfileChanges = (userId: string) => {
      // Remove any existing channel before creating a new one
      if (profileChannel) supabase.removeChannel(profileChannel);

      profileChannel = supabase
        .channel(`profile-status-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          async () => {
            // Re-fetch from DB so we always get the authoritative value
            if (!mounted) return;
            const fresh = await fetchProfile(userId);
            if (mounted) applyProfile(userId, fresh);
          }
        )
        .subscribe();
    };

    // Also re-subscribe whenever the user signs in/changes
    // CRASH HARDENING: onAuthStateChange fires for EVERY auth event —
    // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED… — all with
    // the SAME user id. Re-running removeChannel() → channel(same-topic)
    // → .on(...).subscribe() while the removal is still in flight made
    // supabase-js hand back the old, already-subscribed channel, and the
    // second .on("postgres_changes") threw "cannot add postgres_changes
    // callbacks after subscribe()" — taking the whole app down. The guard
    // below (re)subscribes only when the user id actually CHANGES.
    let profileChannelUserId: string | null = null;
    const { data: { subscription: authSub2 } } = supabase.auth.onAuthStateChange(
      (_event, sess) => {
        if (!mounted) return;
        if (sess?.user) {
          if (profileChannelUserId === sess.user.id && profileChannel) return;
          profileChannelUserId = sess.user.id;
          subscribeToProfileChanges(sess.user.id);
        } else {
          profileChannelUserId = null;
          if (profileChannel) {
            supabase.removeChannel(profileChannel);
            profileChannel = null;
          }
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
      authSub2.unsubscribe();
      profileChannelUserId = null;
      if (profileChannel) supabase.removeChannel(profileChannel);
    };
  }, [fetchProfile, applyProfile]);

  // ── Keep trying until a profile is known ────────────────────────────────
  // Signed in but no profile yet (first visit on a slow link, cache empty).
  // Previously a single failed fetch left this null forever, so the admin
  // gate sat on its spinner until the person reloaded the page by hand.
  // Retry with a gentle backoff (3s → 20s cap), only while online and only
  // while the tab is visible, until a profile arrives.
  const userId = user?.id ?? null;
  const hasProfile = !!profile;
  useEffect(() => {
    if (!userId || hasProfile) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const online = typeof navigator === "undefined" || navigator.onLine !== false;
      const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
      if (online && visible) {
        const prof = await fetchProfile(userId);
        if (cancelled) return;
        if (prof) {
          applyProfile(userId, prof);
          return;
        }
      }
      attempt += 1;
      timer = setTimeout(tick, Math.min(3000 * 2 ** Math.min(attempt, 3), 20000));
    };

    timer = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, hasProfile, fetchProfile, applyProfile]);

  const signOut = async () => {
    setProfile(null);
    setUser(null);
    setSession(null);
    writeCachedProfile("", null);
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) {
      const prof = await fetchProfile(user.id);
      applyProfile(user.id, prof);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, hasCachedSession: hasCachedSession(), sessionPending, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
                       }
