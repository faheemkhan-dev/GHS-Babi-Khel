import { supabase, recoverSessionIfUnintended } from "@/lib/supabase";

/**
 * Keeps a signed-in session alive without any user action.
 *
 * supabase-js refreshes tokens on a timer, but browsers throttle or freeze
 * timers in background tabs and sleeping phones, so a token can expire while
 * the admin is away. This re-validates the session at the moments that matter:
 * tab becomes visible, window focus, page restored from bfcache, network
 * returns, and every few minutes while the tab is open.
 *
 * It never signs anyone out. getSession() transparently refreshes an
 * expired/expiring access token; if the session has vanished it asks
 * recoverSessionIfUnintended() to restore the last good one.
 */
const HEARTBEAT_MS = 4 * 60 * 1000;

export function startAuthKeepAlive(): () => void {
  if (typeof window === "undefined") return () => {};

  let busy = false;
  const ensure = async () => {
    if (busy) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    busy = true;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) await recoverSessionIfUnintended();
    } catch {
      /* transient — try again on the next trigger */
    } finally {
      busy = false;
    }
  };

  const onVisible = () => { if (document.visibilityState === "visible") void ensure(); };
  const onPageShow = () => void ensure();

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", ensure);
  window.addEventListener("online", ensure);
  window.addEventListener("pageshow", onPageShow);
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void ensure();
  }, HEARTBEAT_MS);

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", ensure);
    window.removeEventListener("online", ensure);
    window.removeEventListener("pageshow", onPageShow);
    window.clearInterval(timer);
  };
}
