// src/components/admissions/TrackPanel.tsx — inline "Track Application" card
// for the admission home (sits right below "How to Apply"). Same search /
// result behaviour as the standalone track view, but no page change: the
// result cards open directly underneath the search pill.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, memo } from "react";
import { Search, ArrowRight, Loader2, AlertCircle } from "lucide-react";

const TrackResult = lazy(() => import("@/components/admissions/TrackResult"));

export interface TrackPanelProps {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  /** true once the person pressed Track for the current query */
  searched: boolean;
  results: any[] | null | undefined;
}

function TrackPanel({ query, onQueryChange, onSubmit, loading, searched, results }: TrackPanelProps) {
  const canSearch = query.trim().length >= 5 && !loading;

  return (
    <section id="track-application" className="scroll-mt-24">
      {/* double-ring card */}
      <div className="rounded-[28px] border border-gold/40 bg-card/70 p-1.5 shadow-card">
        <div className="rounded-[22px] border border-border/60 bg-gradient-to-b from-card to-secondary/40 px-4 pb-4 pt-5 text-center">
          <span className="mx-auto mb-2.5 flex h-12 w-12 items-center justify-center rounded-full border border-gold/50 bg-gold/10 text-gold-strong">
            <Search className="h-5 w-5" strokeWidth={1.6} />
          </span>
          <h2
            className="text-[1.45rem] font-bold leading-tight text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Track Application
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-snug text-muted-foreground">
            Search with your Reference No., B-Form or contact number.
          </p>

          <div className="mt-4 flex h-12 items-center gap-2 rounded-full border border-border/80 bg-card pl-3.5 pr-1 shadow-sm transition-colors focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/20">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              id="track-input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSearch && onSubmit()}
              placeholder="Reference, B-Form or Phone"
              autoComplete="off"
              enterKeyHint="search"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-semibold tracking-wide outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSearch}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-dark px-4 text-[12.5px] font-bold text-white shadow-sm ring-1 ring-gold/30 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Track
            </button>
          </div>
        </div>
      </div>

      {/* results — inline, right under the card */}
      {loading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
          Searching…
        </div>
      )}
      {searched && !loading && results && results.length === 0 && (
        <div className="py-8 text-center">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No application found for this query.</p>
          <p className="mt-1 text-xs text-muted-foreground">Check your B-Form, reference, or contact number and try again.</p>
        </div>
      )}
      {!loading && results && results.length > 0 && (
        <div className="mt-4 space-y-4">
          {results.map((r, i) => (
            <Suspense key={i} fallback={<div className="h-40 rounded-2xl bg-muted" aria-label="Loading result" />}>
              <TrackResult result={r} />
            </Suspense>
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(TrackPanel);
