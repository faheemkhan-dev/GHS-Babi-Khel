import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Loader2, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";

type PageState = "loading" | "ready" | "invalid";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageState, setPageState] = useState<PageState>("loading");
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase supports two flows for password reset:
    //
    // 1. Legacy implicit flow: redirects to the page with a URL hash
    //    containing #access_token=...&type=recovery
    //
    // 2. PKCE flow (default in newer Supabase): redirects to the page
    //    with ?code=... as a query param. The Supabase client automatically
    //    exchanges the code for a session and fires a PASSWORD_RECOVERY
    //    auth event via onAuthStateChange.
    //
    // We must handle BOTH. Check the hash first (legacy), then fall back
    // to waiting for the PASSWORD_RECOVERY event (PKCE).

    const hash = window.location.hash;

    // Legacy flow: hash contains type=recovery
    if (hash && hash.includes("type=recovery")) {
      setPageState("ready");
      return;
    }

    // PKCE flow: listen for Supabase to fire PASSWORD_RECOVERY after
    // it exchanges the ?code= query param for a session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "PASSWORD_RECOVERY") {
          setPageState("ready");
        }
      }
    );

    // Also check if we already have an active recovery session
    // (e.g. user refreshed the page after the code was exchanged)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // A session exists — we're good to show the form
        setPageState("ready");
      } else if (!window.location.search.includes("code=")) {
        // No session and no code in URL — this is a direct navigation,
        // not a valid reset link. Redirect to sign-in after a brief delay.
        const timer = setTimeout(() => {
          setPageState("invalid");
        }, 2000);
        return () => clearTimeout(timer);
      }
      // If there IS a ?code= in the URL, keep waiting for PASSWORD_RECOVERY event
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated successfully!");
      await supabase.auth.signOut();
      navigate("/auth/signin", { replace: true });
    }
  };

  // Show spinner while waiting for Supabase to exchange the recovery code
  if (pageState === "loading") {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-on-hero mx-auto mb-3" />
          <p className="text-sm text-on-hero-soft">Verifying reset link…</p>
        </div>
      </div>
    );
  }

  // Invalid / expired link
  if (pageState === "invalid") {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="bg-card rounded-2xl shadow-elevated p-8 text-center">
            <div className="w-14 h-14 rounded-2xl gradient-hero mx-auto mb-4 flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-on-hero" />
            </div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Invalid Reset Link</h1>
            <p className="text-sm text-muted-foreground mt-2">
              This password reset link is invalid or has expired. Please request a new one.
            </p>
            <Link
              to="/auth/forgot-password"
              className="inline-block mt-6 text-sm font-medium text-primary hover:underline"
            >
              Request new reset link
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-card rounded-2xl shadow-elevated p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl gradient-hero mx-auto mb-4 flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-on-hero" />
            </div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Reset Password</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter your new password</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">New Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-ring outline-none"
                  required
                  minLength={6}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update Password"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default ResetPassword;
              
