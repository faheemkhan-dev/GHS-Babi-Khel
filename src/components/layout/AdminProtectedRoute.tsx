import { ReactNode, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const AdminProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, profile, loading, hasCachedSession, sessionPending } = useAuth();

  // ── ROOT CAUSE OF "the whole page refreshed while I was editing" ────────
  // This guard used to decide what to render from the CURRENT auth snapshot
  // on every render. Any moment where that snapshot looked incomplete —
  // `profile` briefly null after a timed-out profile refetch (supabase-js
  // fires SIGNED_IN on every tab refocus, and on a slow link the refetch
  // fails), or `user` null while a slow getSession() was still answering —
  // made it return a bare full-screen spinner INSTEAD of {children}.
  // Returning a different element type at that position unmounts the entire
  // admin dashboard, so every open form, draft and scroll position was
  // destroyed, and the spinner stayed until the retry landed.
  //
  // THE RULE NOW: once this guard has let the dashboard in, it never takes
  // it away because auth is merely SLOW or INCOMPLETE. It only removes it on
  // two definite answers:
  //   1. the person is genuinely signed out, or
  //   2. a profile was successfully loaded and it says "not an admin".
  // Everything else (loading, pending, null profile) keeps the page mounted.
  const admitted = useRef(false);

  const definitelySignedOut = !user && !loading && !sessionPending;
  const definitelyNotAdmin = !!profile && profile.role !== "admin";

  if (admitted.current) {
    if (definitelySignedOut) return <Navigate to="/auth/signin" replace />;
    if (definitelyNotAdmin) return <Navigate to="/" replace />;
    return <>{children}</>;
  }

  // ── First entry (nothing on screen to protect yet) ──────────────────────
  // A signed-in token in localStorage is synchronous and authoritative
  // enough to draw the shell while the network round trip finishes.
  if ((loading || sessionPending) && hasCachedSession) {
    if (profile && profile.role !== "admin") return <Navigate to="/" replace />;
    admitted.current = true;
    return <>{children}</>;
  }

  if (loading) return <Spinner />;

  if (!user) {
    // getSession() timed out but a session exists locally: the answer is
    // still coming. Wait — do NOT bounce a valid admin to the sign-in page.
    if (sessionPending) return <Spinner />;
    return <Navigate to="/auth/signin" replace />;
  }

  // Signed in; profile still on its way (AuthContext keeps retrying).
  if (!profile) return <Spinner />;

  if (profile.role !== "admin") return <Navigate to="/" replace />;

  admitted.current = true;
  return <>{children}</>;
};

export default AdminProtectedRoute;
