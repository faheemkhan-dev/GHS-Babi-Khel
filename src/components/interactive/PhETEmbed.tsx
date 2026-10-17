/**
 * PhETEmbed.tsx
 * Embed PhET interactive simulations by simulation ID.
 * Free, 150+ sims covering physics, chemistry, biology, math, earth science.
 *
 * v3 improvements:
 * - Loads sims directly from phet.colorado.edu (no broken proxy).
 * - Autocomplete search backed by ALL 119 valid PhET sim IDs (phetSims.ts).
 *   No more "phet.colorado.edu refused to connect" — invalid IDs are caught
 *   BEFORE the iframe is created.
 * - Real native fullscreen button (uses Fullscreen API on the iframe wrapper).
 *   Works on desktop (F11-style), tablet, and mobile (Chrome/Safari).
 *
 * Usage: <PhETEmbed subjectColor="#3b82f6" defaultSim="wave-on-a-string" />
 * Browse all sims at https://phet.colorado.edu/en/simulations
 */
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  Atom,
  ExternalLink,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Maximize2,
  Minimize2,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { PHET_SIMS, PHET_SIM_IDS, type PhETSim } from "./phetSims";

// PhET sims are 3-8 MB JS bundles served cross-origin; allow up to 30s on slow
// mobile connections before falling back to the "Open in new tab" CTA.
const SIM_LOAD_TIMEOUT_MS = 30000;

// Curated "popular" subset shown as quick-pick chips.
const POPULAR_SIM_IDS = [
  "wave-on-a-string",
  "circuit-construction-kit-dc-virtual-lab",
  "bending-light",
  "charges-and-fields",
  "ohms-law",
  "balancing-act",
  "projectile-motion",
  "build-an-atom",
  "molecule-shapes",
  "ph-scale",
  "states-of-matter-basics",
  "acid-base-solutions",
];
const POPULAR_SIMS: PhETSim[] = POPULAR_SIM_IDS
  .map((id) => PHET_SIMS.find((s) => s.id === id))
  .filter((s): s is PhETSim => Boolean(s));

// Normalize user input to a PhET slug:
//   "Simple Pendulum"  → "simple-pendulum"
//   "Wave on a String" → "wave-on-a-string"
//   "OHM's Law"         → "ohms-law"
//   "build_an_atom"    → "build-an-atom"
function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['’_]/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Try to resolve a free-text query to a real PhET slug.
// Returns the slug if found, or "" if not.
//
// Matching strategy (tried in order):
//   1. Exact slug match ("wave-on-a-string")
//   2. Normalized slug match ("Wave on a String" → "wave-on-a-string")
//   3. Exact title match (case-insensitive)
//   4. Word-token match: every word the user typed appears as a token
//      in the sim's id or title. ("simple pendulum" → tokens [simple, pendulum]
//      → matches "pendulum-lab" because "pendulum" is in its id; "simple" is
//      also a common subtitle). To keep this strict enough, we require ALL
//      significant tokens (length >= 4) to be present, OR the longest token
//      to be present.
//   5. Slug contains / is contained by the query
//   6. Title contains the query
function resolveSlug(query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return "";

  // 1) Direct match
  if (PHET_SIM_IDS.has(q)) return q;

  // 2) Normalized slug match
  const slug = toSlug(q);
  if (PHET_SIM_IDS.has(slug)) return slug;

  // 3) Exact title match
  const titleMatch = PHET_SIMS.find(
    (s) => s.title.toLowerCase() === q
  );
  if (titleMatch) return titleMatch.id;

  // 4) Token-based match — split into significant words (len >= 4)
  //    e.g. "simple pendulum" → ["simple", "pendulum"]
  //    Then look for a sim whose id-or-title contains EVERY token,
  //    OR — as a fallback — contains the longest token.
  const tokens = slug
    .split("-")
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);

  if (tokens.length > 0) {
    // Try all-tokens-match first (most specific)
    const allMatch = PHET_SIMS.find((s) => {
      const hay = (s.id + " " + s.title).toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
    if (allMatch) return allMatch.id;

    // Fall back to longest-token match
    const longest = tokens.slice().sort((a, b) => b.length - a.length)[0];
    const longestMatch = PHET_SIMS.find((s) => {
      const hay = (s.id + " " + s.title).toLowerCase();
      return hay.includes(longest);
    });
    if (longestMatch) return longestMatch.id;
  }

  // 5) Slug contains
  const slugContains = PHET_SIMS.find(
    (s) => s.id.includes(slug) || (slug.length > 3 && slug.includes(s.id))
  );
  if (slugContains) return slugContains.id;

  // 6) Title contains
  const titleContains = PHET_SIMS.find((s) =>
    s.title.toLowerCase().includes(q)
  );
  if (titleContains) return titleContains.id;

  return "";
}

export default function PhETEmbed({
  subjectColor = "#3b82f6",
  defaultSim = "",
}: {
  subjectColor?: string;
  defaultSim?: string;
}) {
  const [simId, setSimId] = useState(defaultSim);
  const [inputValue, setInputValue] = useState(defaultSim);
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Autocomplete dropdown state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);

  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeWrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ----- Fullscreen handling -------------------------------------------------
  const enterFullscreen = useCallback(async () => {
    const el = iframeWrapRef.current;
    if (!el) return;
    try {
      // Cross-browser: webkit prefix for iOS Safari, ms for older IE/Edge
      const anyEl = el as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (anyEl.webkitRequestFullscreen) {
        await anyEl.webkitRequestFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen request failed:", err);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void>;
      };
      if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("Exit fullscreen failed:", err);
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      const fsEl =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element })
          .webkitFullscreenElement;
      setIsFullscreen(Boolean(fsEl));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // ----- Load simulation -----------------------------------------------------
  const load = useCallback(
    (rawInput: string) => {
      const resolved = resolveSlug(rawInput);
      if (!resolved) {
        setError(
          `No PhET simulation matches "${rawInput}". Try a different name or pick from the list below.`
        );
        setSimId("");
        setShowSuggestions(false);
        return;
      }
      setError("");
      setSimId(resolved);
      setInputValue(resolved);
      setTimedOut(false);
      setLoading(true);
      setIframeKey((k) => k + 1);
      setShowSuggestions(false);
    },
    []
  );

  // When the iframe mounts, start a timeout. If onLoad doesn't fire in time, show fallback.
  useEffect(() => {
    if (!simId || !loading) return;
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
    }, SIM_LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };
  }, [simId, loading, iframeKey]);

  const onIframeLoad = () => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    setLoading(false);
    setTimedOut(false);
  };

  const retry = () => {
    setTimedOut(false);
    setLoading(true);
    setIframeKey((k) => k + 1);
  };

  // ----- Autocomplete suggestions -------------------------------------------
  const suggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return [];
    // Filter by id OR title containing the query
    const filtered = PHET_SIMS.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q)
    );
    return filtered.slice(0, 8);
  }, [inputValue]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length > 0) {
      e.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestionIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && suggestions.length > 0) {
      e.preventDefault();
      setActiveSuggestionIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestionIdx(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && activeSuggestionIdx >= 0 && suggestions[activeSuggestionIdx]) {
        load(suggestions[activeSuggestionIdx].id);
      } else {
        load(inputValue);
      }
      return;
    }
    setShowSuggestions(true);
    setActiveSuggestionIdx(-1);
  };

  // Load the PhET simulation directly from phet.colorado.edu.
  // PhET's `_en.html` ships with NO `X-Frame-Options`, NO `frame-ancestors`
  // CSP, and `access-control-allow-origin: *` — so it is embeddable cross-origin.
  // The site CSP (vercel.json) already whitelists `https://phet.colorado.edu`
  // under `frame-src`.
  const simUrl = simId
    ? `https://phet.colorado.edu/sims/html/${simId}/latest/${simId}_en.html`
    : "";
  const simDirectUrl = simUrl;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Atom className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">PhET Simulation</span>
        {simId && (
          <a href={simDirectUrl} target="_blank" rel="noreferrer"
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            Open <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Search input with autocomplete */}
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setShowSuggestions(true);
                  setActiveSuggestionIdx(-1);
                  if (error) setError("");
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onKeyDown={onKeyDown}
                placeholder="Search 119 PhET sims (e.g. pendulum, circuits, atoms)"
                className="w-full pl-8 pr-8 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="off"
                spellCheck={false}
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={() => {
                    setInputValue("");
                    setError("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => load(inputValue)}
              disabled={loading}
              className="shrink-0 px-4 py-2 rounded-lg text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: subjectColor }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Load
            </button>
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <ul
              className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
              style={{ scrollbarWidth: "thin" }}
            >
              {suggestions.map((s, idx) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      load(s.id);
                    }}
                    onMouseEnter={() => setActiveSuggestionIdx(idx)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                      idx === activeSuggestionIdx
                        ? "bg-secondary"
                        : "hover:bg-secondary/50"
                    }`}
                  >
                    <span className="font-semibold text-foreground flex-1 min-w-0 truncate">
                      {s.title}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {s.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Validation error */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="text-xs">{error}</p>
          </div>
        )}

        {/* Popular sims */}
        <div>
          <p className="text-[11px] text-muted-foreground mb-2">
            Popular simulations:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SIMS.map((sim) => (
              <button
                key={sim.id}
                onClick={() => load(sim.id)}
                className={`text-[10px] px-2.5 py-1.5 rounded-lg font-medium ${
                  simId === sim.id
                    ? "text-white"
                    : "bg-secondary hover:bg-secondary/70 text-foreground"
                }`}
                style={simId === sim.id ? { backgroundColor: subjectColor } : {}}
                title={`${sim.title} — ${sim.id}`}
              >
                {sim.title}
              </button>
            ))}
          </div>
        </div>

        {/* Iframe area with loading + timeout states */}
        {simId && (
          <>
            <div
              ref={iframeWrapRef}
              className="relative w-full overflow-hidden rounded-xl bg-white border border-border"
              style={{
                aspectRatio: isFullscreen ? "auto" : "4 / 3",
                minHeight: isFullscreen ? "100vh" : "320px",
                height: isFullscreen ? "100vh" : undefined,
              }}
            >
              {/* Top-right control bar (always visible) */}
              <div className="absolute top-2 right-2 z-30 flex gap-1.5">
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  className="px-2.5 py-1.5 rounded-md bg-black/70 hover:bg-black/90 text-white text-[11px] font-semibold flex items-center gap-1.5 backdrop-blur-sm shadow-md"
                >
                  {isFullscreen ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5" />
                      Exit
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5" />
                      Fullscreen
                    </>
                  )}
                </button>
              </div>

              {/* Loading overlay */}
              {loading && !timedOut && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-20 gap-3 p-4">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: subjectColor }} />
                  <p className="text-sm font-semibold text-foreground text-center">
                    Loading PhET simulation…
                  </p>
                  <p className="text-[11px] text-muted-foreground text-center max-w-xs">
                    This usually takes 5-15 seconds. Please keep this tab active.
                  </p>
                </div>
              )}

              {/* Timeout fallback */}
              {timedOut && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-amber-50 z-20 gap-3 p-4">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <p className="text-sm font-bold text-foreground text-center">
                    Simulation is taking too long to load
                  </p>
                  <p className="text-[11px] text-muted-foreground text-center max-w-xs">
                    Your connection may be slow. Try opening it in a new tab, or retry.
                  </p>
                  <div className="flex gap-2 mt-1">
                    <a href={simDirectUrl} target="_blank" rel="noreferrer"
                      className="text-xs px-3 py-2 rounded-lg text-white font-semibold flex items-center gap-1.5"
                      style={{ backgroundColor: subjectColor }}>
                      <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
                    </a>
                    <button onClick={retry}
                      className="text-xs px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-semibold flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Retry
                    </button>
                  </div>
                </div>
              )}

              {/* The iframe itself — key={iframeKey} forces a clean remount on retry */}
              {!timedOut && (
                <iframe
                  key={iframeKey}
                  src={simUrl}
                  className="w-full h-full border-0 block"
                  allowFullScreen
                  title={`PhET: ${simId}`}
                  loading="lazy"
                  onLoad={onIframeLoad}
                  allow="autoplay; fullscreen; accelerometer; gyroscope; gamepad; geolocation; microphone; camera; midi; encrypted-media; picture-in-picture"
                  referrerPolicy="no-referrer-when-downgrade"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads allow-presentation"
                />
              )}
            </div>

            {/* Always-visible fallback link below the iframe */}
            {!isFullscreen && (
              <div className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg bg-secondary/50">
                <p className="text-[11px] text-muted-foreground flex-1 min-w-0">
                  Simulation not loading? Try opening it directly:
                </p>
                <a href={simDirectUrl} target="_blank" rel="noreferrer"
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg text-white font-semibold flex items-center gap-1.5"
                  style={{ backgroundColor: subjectColor }}>
                  <ExternalLink className="w-3.5 h-3.5" /> New Tab
                </a>
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Browse all sims at{" "}
          <a href="https://phet.colorado.edu/en/simulations" target="_blank" rel="noreferrer"
            className="text-primary hover:underline">phet.colorado.edu</a>
        </p>
      </div>
    </div>
  );
}
