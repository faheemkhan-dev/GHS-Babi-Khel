import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, ArrowRight, Loader2, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import { useSchoolSettings, safeMediaUrl } from "@/hooks/useSchoolSettings";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const { data: settings } = useSchoolSettings();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-card rounded-2xl shadow-elevated p-8 text-center">
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
          {sent ? (
            <>
              <h1 className="text-2xl font-heading font-bold text-foreground">Check Your Email</h1>
              <p className="text-sm text-muted-foreground mt-2">
                We've sent a password reset link to <strong>{email}</strong>.
              </p>
              <Link to="/auth/signin" className="inline-flex items-center gap-2 mt-6 text-sm font-medium text-primary hover:underline">
                Back to Sign In <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-heading font-bold text-foreground">Forgot Password</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your email to reset your password</p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4 text-left">
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
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full gradient-accent text-primary-foreground font-semibold py-3 rounded-xl shadow-card hover:shadow-elevated transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Reset Link"}
                </button>
              </form>
              <Link to="/auth/signin" className="inline-block mt-4 text-sm text-muted-foreground hover:text-foreground">
                ← Back to Sign In
              </Link>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ForgotPassword;
