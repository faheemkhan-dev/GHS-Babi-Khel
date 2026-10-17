// src/pages/admin/tabs/AdminSiteAnalytics.tsx
//
// Standalone "Site Analytics" tab in the Admin Dashboard.
// Wraps the SiteAnalytics component inside an error boundary so a
// missing Supabase table never crashes the rest of the dashboard.

import { Component, type ReactNode } from "react";
import SiteAnalytics from "@/components/admin/SiteAnalytics";
import { BarChart2, RefreshCw, AlertCircle } from "lucide-react";

// ── Error Boundary ───────────────────────────────────────────────────────────
interface EBState { hasError: boolean; error?: Error }

class SiteAnalyticsBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
                <BarChart2 className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-foreground">Site Analytics</h3>
            </div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground"
              title="Retry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <h4 className="text-sm font-bold text-foreground mb-2">Site Analytics failed to load</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Make sure the{" "}
              <code className="font-mono bg-secondary px-1 py-0.5 rounded text-[10px]">site_visits</code>{" "}
              table exists in Supabase and the SQL migration has been run.
            </p>
            <p className="text-[10px] text-muted-foreground/70 font-mono break-all">
              {this.state.error?.message || "Unknown error"}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
const AdminSiteAnalytics = () => (
  <div className="space-y-4 pb-20 md:pb-0">
    {/* Premium page header — matches the Manage Teachers / Manage Results gold standard */}
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
          <BarChart2 className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Site Analytics</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Live traffic &amp; visitor insights for the school website</p>
        </div>
      </div>
    </div>
    <SiteAnalyticsBoundary>
      <SiteAnalytics />
    </SiteAnalyticsBoundary>
  </div>
);

export default AdminSiteAnalytics;
