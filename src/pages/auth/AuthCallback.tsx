import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Clock, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

/**
 * Lands here right after Google redirects back from the OAuth consent screen.
 * Supabase's client already exchanged the code for a session (detectSessionInUrl
 * is on for the default `supabase` client) — we just need to check approval
 * status, same as the password sign-in flow, and route accordingly.
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "pending" | "rejected" | "error">("checking");

  useEffect(() => {
    let mounted = true;

    const finishLogin = async () => {
      try {
        // Give Supabase a brief moment to finish parsing the URL hash/code
        // into a session if it hasn't already.
        const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 10000);
        const user = sessionData.session?.user;

        if (!user) {
          if (mounted) setStatus("error");
          return;
        }

        // Fetch profile (the DB trigger guarantees this row exists by now,
        // created the moment Supabase inserted the auth.users row).
        let profile: { role?: string; status?: string } | null = null;

        try {
          const { data: rpcData, error: rpcError } = await withTimeout(
            supabase.rpc("get_my_profile"),
            6000
          );
          if (!rpcError && rpcData) {
            profile = rpcData;
          } else {
            const { data: directData } = await withTimeout(
              supabase.from("profiles").select("role, status").eq("id", user.id).single(),
              6000
            );
            profile = directData ?? null;
          }
        } catch {
          if (mounted) setStatus("error");
          return;
        }

        const profileStatus = profile?.status ?? "pending";
        const role = profile?.role;

        if (!mounted) return;

        if (profileStatus === "pending") {
          setStatus("pending");
          return;
        }
        if (profileStatus === "rejected") {
          setStatus("rejected");
          return;
        }

        // Approved — go to the right place
        if (role === "admin") {
          navigate("/admin", { replace: true });
        } else {
          // User Dashboard was removed — non-admin accounts have no
          // dashboard to land on, so send them home.
          navigate("/", { replace: true });
        }
      } catch {
        if (mounted) setStatus("error");
      }
    };

    finishLogin();
    return () => { mounted = false; };
  }, [navigate]);

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-elevated p-8 text-center">
          <Clock className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h1 className="text-xl font-heading font-bold text-foreground">Account Under Review</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your Google account has been registered and is <strong className="text-blue-700">pending admin approval</strong>.
            You'll be able to sign in once an administrator approves your account.
          </p>
          <Link to="/" className="inline-block mt-6 text-sm font-medium text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-elevated p-8 text-center">
          <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-heading font-bold text-foreground">Account Rejected</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your account request was rejected. Please contact the school administration for assistance.
          </p>
          <Link to="/" className="inline-block mt-6 text-sm font-medium text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-2xl shadow-elevated p-8 text-center">
        <XCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h1 className="text-xl font-heading font-bold text-foreground">Sign-in Failed</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Something went wrong finishing your Google sign-in. Please try again.
        </p>
        <Link to="/auth/signin" className="inline-block mt-6 text-sm font-medium text-primary hover:underline">
          Back to Sign In
        </Link>
      </div>
    </div>
  );
};

export default AuthCallback;
