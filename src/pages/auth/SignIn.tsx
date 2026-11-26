import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, GraduationCap, ArrowRight, Loader2, Clock, XCircle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { supabase, signOutSafely } from "@/lib/supabase";
import toast from "react-hot-toast";
import { useSchoolSettings, safeMediaUrl } from "@/hooks/useSchoolSettings";
import TurnstileWidget, { type TurnstileHandle } from "@/components/shared/TurnstileWidget";
import { turnstileEnabled } from "@/lib/turnstile";

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
  const [showPw, setShowPw]           = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"pending" | "rejected" | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileHandle>(null);
  const navigate = useNavigate();

  const { data: settings } = useSchoolSettings();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (turnstileEnabled && !captchaToken) {
      toast.error("Please wait for the security check to finish.");
      return;
    }
    setLoading(true);
    setPendingStatus(null);

    try {
      // ── 1. Authenticate with hard 10s timeout ─────────────────────────────
      const { data: authData, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
          // Verified by Supabase (Authentication → Attack Protection → CAPTCHA).
          options: turnstileEnabled && captchaToken ? { captchaToken } : undefined,
        }),
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
          /captcha/i.test(authError?.message || "")
            ? "Security check failed. Please try again."
            : authError?.message?.includes("Invalid login credentials")
              ? "No account found with this email/password, or you haven't signed up yet."
              : (authError?.message || "Login failed.")
        );
        captchaRef.current?.reset(); // tokens are single-use
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
        await signOutSafely();
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
        await signOutSafely();
        toast.error("No account found for this email. Please sign up first.");
        setLoading(false);
        return;
      }

      const status = profile?.status ?? "pending";
      const role   = profile?.role;

      // ── 3. Block pending / rejected accounts ──────────────────────────────
      if (status === "pending") {
        await signOutSafely();
        setPendingStatus("pending");
        setLoading(false);
        return;
      }

      if (status === "rejected") {
        await signOutSafely();
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

  const inputCls =
    "block w-full h-11 rounded-xl border border-border/80 bg-background/60 pl-10 pr-3 py-0 leading-none text-[14px] text-foreground placeholder:text-muted-foreground/60 outline-none transition-[border-color,box-shadow] focus:border-[hsl(var(--gold))] focus:ring-2 focus:ring-[hsl(var(--gold)/0.2)]";

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[linear-gradient(160deg,hsl(160_55%_8%)_0%,hsl(158_45%_14%)_55%,hsl(156_40%_20%)_100%)] px-4 py-8">
      {/* decoration */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-32 h-80 w-80 rounded-full" style={{ background: "radial-gradient(circle, hsla(43,80%,62%,0.20), transparent 65%)" }} />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full" style={{ background: "radial-gradient(circle, hsla(160,70%,42%,0.25), transparent 65%)" }} />
        <svg className="absolute -right-16 top-10 h-72 w-72 opacity-[0.10]" viewBox="0 0 200 200" fill="none" stroke="hsl(43,80%,70%)" strokeWidth="0.8">
          <circle cx="100" cy="100" r="30" /><circle cx="100" cy="100" r="55" /><circle cx="100" cy="100" r="80" /><circle cx="100" cy="100" r="105" />
        </svg>
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(#fff 0.6px, transparent 0.6px)", backgroundSize: "18px 18px" }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative z-10 w-full max-w-[380px]"
      >
        {/* gold hairline frame */}
        <div className="rounded-[22px] bg-[linear-gradient(135deg,hsla(43,80%,68%,0.75),hsla(160,40%,30%,0.25)_45%,hsla(43,75%,62%,0.45))] p-px shadow-[0_28px_60px_-28px_rgba(0,0,0,0.7)]">
          <div className="rounded-[21px] bg-card px-6 pb-6 pt-7">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3.5 h-14 w-14 overflow-hidden rounded-2xl bg-primary ring-1 ring-[hsl(var(--gold)/0.5)] ring-offset-2 ring-offset-card">
                {settings?.logo_url && !logoFailed ? (
                  <img
                    src={safeMediaUrl(settings.logo_url)!}
                    alt={`${settings?.school_name || "GHS Babi Khel"} logo`}
                    className="h-full w-full object-cover"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <GraduationCap className="h-7 w-7 text-primary-foreground" />
                  </div>
                )}
              </div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--gold))]">Admin Portal</p>
              <h1 className="mt-1 font-heading text-[26px] font-bold leading-tight tracking-tight text-foreground">Welcome Back</h1>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Sign in to your {settings?.school_name || "GHS Babi Khel"} account
              </p>
            </div>

            {pendingStatus === "pending" && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <div>
                  <p className="text-[12.5px] font-semibold text-blue-800 dark:text-blue-400">Waiting for Admin Approval</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-blue-700 dark:text-blue-400/80">
                    Your account is under review. You'll be able to login once an administrator approves your account.
                  </p>
                </div>
              </div>
            )}

            {pendingStatus === "rejected" && (
              <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-500/20 dark:bg-red-500/10">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-[12.5px] font-semibold text-red-700 dark:text-red-400">Account Rejected</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-red-600 dark:text-red-400/80">
                    Your account request was rejected by the administrator. Please contact the school for more information.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="signin-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Email</label>
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute left-0 top-0 grid h-11 w-10 place-items-center text-muted-foreground"><Mail className="h-4 w-4" /></span>
                  <input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                    required
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="signin-password" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Password</label>
                  <Link to="/auth/forgot-password" className="text-[11.5px] font-medium text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute left-0 top-0 grid h-11 w-10 place-items-center text-muted-foreground"><Lock className="h-4 w-4" /></span>
                  <input
                    id="signin-password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={`${inputCls} pr-11`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <TurnstileWidget ref={captchaRef} action="signin" onToken={setCaptchaToken} className="w-full" />

              <button
                type="submit"
                disabled={loading || (turnstileEnabled && !captchaToken)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,hsl(43_89%_38%),hsl(40_90%_46%))] text-[14px] font-semibold text-white shadow-[0_8px_18px_-10px_hsl(43_89%_38%/0.8)] transition-[filter,transform] hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-border/60 pt-4 text-[10.5px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary/70" />
              Secure, encrypted sign-in
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default SignIn;
