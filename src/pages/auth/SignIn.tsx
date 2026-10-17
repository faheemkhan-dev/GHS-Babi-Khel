import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, GraduationCap, ArrowRight, Loader2, Clock, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { useSchoolSettings, safeMediaUrl } from "@/hooks/useSchoolSettings";

// Hard timeout wrapper — rejects if promise doesn't settle in time
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

const SignIn = () => {
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [loading, setLoading]         = useState(false);
  const [logoFailed, setLogoFailed]   = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"pending" | "rejected" | null>(null);
  const navigate = useNavigate();

  const { data: settings } = useSchoolSettings();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPendingStatus(null);

    try {
      // ── 1. Authenticate with hard 10s timeout ─────────────────────────────
      const { data: authData, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        10000
      );

      if (authError || !authData.user) {
        // Supabase intentionally returns the same generic error for both
        // "no account with this email" and "wrong password" (this is a
        // security best practice — it stops attackers from using the
        // login form to discover which emails are registered). We surface
        // a slightly friendlier version of that same generic message
        // rather than guessing which case it is.
        toast.error(
          authError?.message?.includes("Invalid login credentials")
            ? "No account found with this email/password, or you haven't signed up yet."
            : (authError?.message || "Login failed.")
        );
        setLoading(false);
        return;
      }

      // ── 2. Fetch profile to check approval status (6s timeout each) ───────
      let profile: { role?: string; status?: string } | null = null;

      try {
        // Try RPC first
        const { data: rpcData, error: rpcError } = await withTimeout(
          supabase.rpc("get_my_profile"),
          6000
        );

        if (!rpcError && rpcData) {
          profile = rpcData;
        } else {
          // Fallback to direct table query
          const { data: directData } = await withTimeout(
            supabase
              .from("profiles")
              .select("role, status")
              .eq("id", authData.user.id)
              .maybeSingle(),
            6000
          );
          profile = directData ?? null;
        }
      } catch {
        // Both profile fetches timed out — sign out and tell the user
        await supabase.auth.signOut();
        toast.error("Server is slow. Please try again in a moment.");
        setLoading(false);
        return;
      }

      // ── 2b. Profile row missing for an existing auth account. ──────────
      // Previously this silently recreated the profile as "pending" on
      // EVERY sign-in attempt, which is indistinguishable from a brand
      // new signup landing in the admin's queue every time someone with
      // a broken/incomplete account tried to log in — that's the "why do
      // I keep getting a new pending request" bug you hit. Instead we
      // tell the user plainly to sign up (or contact admin if they believe
      // they already have an account), and do NOT touch the profiles table
      // from the sign-in path at all. Recovering a genuinely admin-deleted
      // profile is an admin action, not something a failed login should
      // do on the user's behalf.
      if (!profile) {
        await supabase.auth.signOut();
        toast.error("No account found for this email. Please sign up first.");
        setLoading(false);
        return;
      }

      const status = profile?.status ?? "pending";
      const role   = profile?.role;

      // ── 3. Block pending / rejected accounts ──────────────────────────────
      if (status === "pending") {
        await supabase.auth.signOut();
        setPendingStatus("pending");
        setLoading(false);
        return;
      }

      if (status === "rejected") {
        await supabase.auth.signOut();
        setPendingStatus("rejected");
        setLoading(false);
        return;
      }

      // ── 4. Success — clear spinner THEN navigate ───────────────────────────
      // We reset loading before navigate so the button never stays stuck
      // if the component somehow stays mounted during the route transition.
      toast.success("Signed in successfully!");
      setLoading(false);

      if (role === "admin") {
        navigate("/admin", { replace: true });
      } else {
        // User Dashboard was removed — non-admin accounts have no
        // dashboard to land on, so send them home.
        navigate("/", { replace: true });
      }

    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "Request timed out";
      toast.error(
        isTimeout
          ? "Sign in is taking too long. Check your connection and try again."
          : "An unexpected error occurred. Please try again."
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-20 -left-20 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-card rounded-2xl shadow-elevated p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl gradient-hero mx-auto mb-4 flex items-center justify-center overflow-hidden">
              {settings?.logo_url && !logoFailed ? (
                <img
                  src={safeMediaUrl(settings.logo_url)!}
                  alt={`${settings?.school_name || "GHS Babi Khel"} logo`}
                  className="w-full h-full object-cover"
                  onError={() => setLogoFailed(true)}
                />
              ) : (
                <GraduationCap className="w-8 h-8 text-on-hero" />
              )}
            </div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Welcome Back</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to your {settings?.school_name || "GHS Babi Khel"} account
            </p>
          </div>

          {pendingStatus === "pending" && (
            <div className="mb-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-center">
              <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-400">Waiting for Admin Approval</p>
              <p className="text-xs text-blue-700 dark:text-blue-400/80 mt-1">
                Your account is under review. You'll be able to login once an administrator approves your account.
              </p>
            </div>
          )}

          {pendingStatus === "rejected" && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-center">
              <XCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">Account Rejected</p>
              <p className="text-xs text-red-600 dark:text-red-400/80 mt-1">
                Your account request was rejected by the administrator. Please contact the school for more information.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-ring outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground">Password</label>
                <Link to="/auth/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-ring outline-none"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full gradient-accent text-primary-foreground font-semibold py-3 rounded-xl shadow-card hover:shadow-elevated transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

        </div>
      </motion.div>
    </div>
  );
};

export default SignIn;

