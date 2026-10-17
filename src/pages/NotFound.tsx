import { useLocation, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Home, GraduationCap } from "lucide-react";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import SEO from "@/components/seo/SEO";
import FlyingKite from "@/components/four04/FlyingKite";

/**
 * 404 — A Guddi You Can Fly.
 *
 * A broken link becomes a pale Peshawar dawn with a black kite drifting in
 * it. The string is attached to the visitor's hand (cursor or finger) and
 * the kite answers with real spring physics — see FlyingKite. Everything
 * the old page did is preserved: soft-404 noindex, the console breadcrumb,
 * the school logo fallback, and the Go Home button.
 */
const NotFound = () => {
  const location = useLocation();
  const { data: settings } = useSchoolSettings();
  const [logoFailed, setLogoFailed] = useState(false);

  // Reset logo failed state when URL changes
  useEffect(() => { setLogoFailed(false); }, [settings?.logo_url]);

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="sky-dawn relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* SOFT-404 FIX: the SPA serves HTTP 200 for every unknown URL, so
          Google indexes garbage URLs unless we explicitly noindex them.
          This tells crawlers to drop unknown URLs from the index. */}
      <SEO
        title="Page Not Found"
        description="The page you are looking for does not exist on the GHS Babi Khel website."
        path={location.pathname}
        noIndex
      />

      {/* soft clouds — pure radial gradients, no blur filters (GPU-safe) */}
      <div aria-hidden="true" className="sky-cloud pointer-events-none absolute left-[8%] top-[16%] h-16 w-56" />
      <div aria-hidden="true" className="sky-cloud pointer-events-none absolute right-[10%] top-[30%] h-12 w-44" />
      <div aria-hidden="true" className="sky-cloud pointer-events-none absolute bottom-[24%] left-[22%] h-10 w-36" />

      {/* the guddi — canvas + physics + the 30-second way-home whisper */}
      <FlyingKite />

      {/* rooftops of Babi Khel on the horizon */}
      <svg
        aria-hidden="true"
        viewBox="0 0 430 90"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-20 w-full text-foreground opacity-[0.08] dark:opacity-[0.14]"
      >
        <path
          fill="currentColor"
          d="M0 90 L0 64 L34 64 L34 58 L60 58 L60 64 L88 64 L88 40
             Q88 30 98 30 Q108 30 108 40 L108 64 L128 64 L128 52
             L136 44 L144 52 L144 64 L172 64 L172 36
             Q186 22 200 36 L200 64 L232 64 L232 46 L240 38 L248 46
             L248 64 L272 64 Q272 50 284 50 Q296 50 296 64 L330 64
             L330 58 L356 58 L356 40 L362 32 L368 40 L368 58 L398 58
             L398 64 L430 64 L430 90 Z"
        />
      </svg>

      <div className="relative z-10 w-full max-w-md rounded-3xl border border-border/70 bg-card/80 px-8 py-10 text-center shadow-elevated">
        {settings?.logo_url && !logoFailed ? (
          <img src={settings.logo_url} alt="Logo" className="w-16 h-16 rounded-xl object-cover mx-auto mb-6" onError={() => setLogoFailed(true)} />
        ) : (
          <div className="w-16 h-16 rounded-xl gradient-hero flex items-center justify-center mx-auto mb-6">
            <GraduationCap className="w-8 h-8 text-on-hero" />
          </div>
        )}
        <h1 className="text-7xl font-heading font-extrabold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent mb-4">
          404
        </h1>
        <h2 className="text-xl font-heading font-bold text-foreground mb-2">Page Not Found</h2>
        <p className="text-muted-foreground mb-2">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <p className="text-xs text-muted-foreground/80 mb-8">
          Meanwhile — the sky above is yours. Pull the string.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl gradient-accent text-primary-foreground font-semibold shadow-card hover:shadow-elevated transition-all"
        >
          <Home className="w-4 h-4" />
          Go Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
