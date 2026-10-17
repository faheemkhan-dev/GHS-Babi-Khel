/**
 * InteractiveLabs.tsx - ENHANCED VERSION
 * Orchestrator: picks relevant interactive blocks based on subject
 * and renders them in a tabbed, mobile-friendly layout.
 *
 * v6 — Enhanced with new subject-specific labs:
 *   - English Lab Widget (vocabulary, grammar, word games)
 *   - Urdu Lab Widget (Lughat, Shaayari, Kehwar, Jumla)
 *   - Enhanced Code Playground (multi-language)
 *
 * All previous features preserved:
 *   - Per-block error boundary
 *   - Retry-aware lazy loading
 *   - Defensive coding
 */

import { useState, lazy, Suspense, useMemo, Component, type ReactNode } from "react";
import { FlaskConical, ChevronDown, AlertTriangle, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ---------- Retry-aware dynamic import --------------------------------------
function retryableImport<T>(importer: () => Promise<{ default: T }>, retries = 4): Promise<{ default: T }> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryImport = () => {
      importer()
        .then(resolve)
        .catch((err) => {
          attempt += 1;
          if (attempt >= retries) {
            reject(err);
          } else {
            const delay = 200 * attempt;
            setTimeout(tryImport, delay);
          }
        });
    };
    tryImport();
  });
}

// Lazy-load each block
const GraphingCalculator = lazy(() => retryableImport(() => import("./GraphingCalculator")));
const StepSolver          = lazy(() => retryableImport(() => import("./StepSolver")));
const PhETEmbed           = lazy(() => retryableImport(() => import("./PhETEmbed")));
const MoleculeViewer      = lazy(() => retryableImport(() => import("./MoleculeViewer")));
const PeriodicTable       = lazy(() => retryableImport(() => import("./PeriodicTable")));
const CodePlayground      = lazy(() => retryableImport(() => import("./CodePlayground"))); // ENHANCED VERSION
const ConceptMap          = lazy(() => retryableImport(() => import("./ConceptMap")));
const StatisticsPlayground = lazy(() => retryableImport(() => import("./StatisticsPlayground")));
const PunnettSquare       = lazy(() => retryableImport(() => import("./PunnettSquare")));
const NumberLineLab       = lazy(() => retryableImport(() => import("./NumberLineLab")));

// NEW: Subject-specific beautiful widgets

// ─── BLOCK TYPES (Extended) ──────────────────────────────────────────────

export type Block =
  | "graph" | "solver" | "phet" | "molecule" | "periodic"
  | "code" | "conceptmap" | "stats" | "punnett" | "numberline";

// ─── BLOCK METADATA (Extended) ─────────────────────────────────────────

const BLOCK_META: Record<Block, { label: string; emoji: string; desc: string }> = {
  graph:      { label: "Graphing",     emoji: "📈", desc: "Plot functions with live sliders, find intersections & roots" },
  solver:     { label: "Solver",       emoji: "🧮", desc: "Step-by-step solver for linear, quadratic, simultaneous, more" },
  phet:       { label: "Simulations",  emoji: "🔬", desc: "PhET physics & chemistry sims" },
  molecule:   { label: "3D Molecules", emoji: "🧪", desc: "Rotate real molecular structures" },
  periodic:   { label: "Periodic Table", emoji: "⚛️", desc: "All 118 elements with trends & Bohr diagrams" },
  code:       { label: "Code Lab",     emoji: "💻", desc: "Live HTML/CSS/JS/Python playground (Enhanced!)" },
  conceptmap: { label: "Concept Map",  emoji: "🗺️", desc: "Auto-generated mind map from chapter content" },
  stats:      { label: "Statistics",   emoji: "📊", desc: "Dice, coins, spinner, box plots, normal distribution" },
  punnett:    { label: "Genetics",     emoji: "🧬", desc: "Punnett square calculator for biology" },
  numberline: { label: "Number Line",  emoji: "➖", desc: "Visualize addition, multiplication, fractions" },
};

// ─── SUBJECT-BLOCK MAPPING (Enhanced) ───────────────────────────────────

const SUBJECT_BLOCKS: Record<string, Block[]> = {
  // Mathematics - Graphing, Solver, Number Line, Statistics, Concept Map
  // Now only shows: Graphing Calculator, Step Solver, Number Line, Statistics, Concept Map
  "mathematics": ["graph", "solver", "numberline", "stats", "conceptmap"],
  "math":        ["graph", "solver", "numberline", "stats", "conceptmap"],
  "maths":       ["graph", "solver", "numberline", "stats", "conceptmap"],
  
  // Physics - Simulations + tools
  "physics":     ["graph", "phet", "solver", "conceptmap"],
  
  // Chemistry - Periodic table + molecules
  "chemistry":   ["periodic", "molecule", "phet", "conceptmap"],
  
  // Biology - Genetics + simulations
  "biology":     ["punnett", "phet", "conceptmap"],
  
  // Computer Science - Enhanced Code Lab
  "computer science": ["code", "conceptmap"],
  "computer":    ["code", "conceptmap"],
  "cs":          ["code", "conceptmap"],
  "programming": ["code", "conceptmap"],
  "ict":         ["code", "conceptmap"],
  
  // Statistics
  "statistics":  ["stats", "graph", "conceptmap"],
  
  // English - Concept Map only (English Lab widget removed)
  "english":     ["conceptmap"],
  "eng":         ["conceptmap"],
  
  // Urdu - Concept Map only (اردو لب widget removed)
  "urdu":        ["conceptmap"],
  "اردو":        ["conceptmap"],
  
  // Pakistan Studies / Social Studies
  "pakistan studies": ["conceptmap"],
  "pakistanstudies": ["conceptmap"],
  "social studies":  ["conceptmap"],
  "sst":             ["conceptmap"],
  
  // Islamiyat
  "islamiyat":   ["conceptmap"],
  "islamiat":    ["conceptmap"],
  "islamic":     ["conceptmap"],
  
  // General / Other
  "general":     ["conceptmap", "code"],
  "other":       ["conceptmap"],
};

function pickBlocks(subjectName: string, subjectSlug?: string): Block[] {
  const key1 = (subjectSlug || "").toLowerCase().trim();
  const key2 = (subjectName || "").toLowerCase().trim();
  return SUBJECT_BLOCKS[key1] || SUBJECT_BLOCKS[key2] || ["conceptmap"];
}

// ---------- Per-block error boundary ---------------------------------------

type ErrorBoundaryProps = { children: ReactNode; blockName: string; subjectColor: string };
type ErrorBoundaryState = { hasError: boolean; error: Error | null; retryKey: number };

class BlockErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[InteractiveLabs] "${this.props.blockName}" block crashed:`, error);
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    if (this.state.hasError && !prevState.hasError && this.state.retryKey === 0) {
      this.retryTimer = setTimeout(() => {
        this.setState({ hasError: false, retryKey: 1 });
      }, 300);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  manualRetry = () => {
    this.setState({ hasError: false, error: null, retryKey: this.state.retryKey + 1 });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <h3 className="text-sm font-bold text-amber-900 mb-1">
            {this.props.blockName} couldn't load
          </h3>
          <p className="text-xs text-amber-700 mb-3 max-w-sm mx-auto">
            This interactive block couldn't load. This is usually a temporary network issue.
          </p>
          {this.state.error && (
            <p className="text-[10px] text-amber-600/80 mb-3 max-w-sm mx-auto font-mono break-all">
              {this.state.error.message || String(this.state.error)}
            </p>
          )}
          <button
            onClick={this.manualRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white"
            style={{ backgroundColor: this.props.subjectColor }}
          >
            <RotateCcw className="w-3 h-3" /> Try again
          </button>
        </div>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

const BlockSkeleton = () => (
  <div className="p-3">
    <Skeleton className="h-64 w-full rounded-xl" />
  </div>
);

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────

export default function InteractiveLabs({
  subjectName,
  subjectSlug,
  subjectColor = "#3b82f6",
  chapterTitle = "Chapter",
  chapterContent = "",
  liteMode = false,
}: {
  subjectName: string;
  subjectSlug?: string;
  subjectColor?: string;
  chapterTitle?: string;
  chapterContent?: string;
  liteMode?: boolean;
}) {
  const blocks = useMemo(() => pickBlocks(subjectName, subjectSlug), [subjectName, subjectSlug]);
  const [active, setActive] = useState<Block>(blocks[0] || "conceptmap");
  const [expanded, setExpanded] = useState(true);

  // Reset active block when subject changes
  useMemo(() => { setActive(blocks[0] || "conceptmap"); }, [blocks]);

  if (liteMode) return null;

  // Render the appropriate component based on block type
  const renderBlock = (block: Block) => {
    switch (block) {
      case "graph":      return <GraphingCalculator subjectColor={subjectColor} />;
      case "solver":     return <StepSolver subjectColor={subjectColor} />;
      case "phet":       return <PhETEmbed subjectColor={subjectColor} />;
      case "molecule":   return <MoleculeViewer subjectColor={subjectColor} />;
      case "periodic":   return <PeriodicTable subjectColor={subjectColor} />;
      case "code":       return <CodePlayground subjectColor={subjectColor} />;
      case "conceptmap": return <ConceptMap subjectColor={subjectColor} chapterTitle={chapterTitle} content={chapterContent} />;
      case "stats":      return <StatisticsPlayground subjectColor={subjectColor} />;
      case "punnett":    return <PunnettSquare subjectColor={subjectColor} />;
      case "numberline": return <NumberLineLab subjectColor={subjectColor} />;
    }
  };

  return (
    <section className="mt-8 md:mt-10 mb-4" aria-label="Interactive learning labs">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 mb-3 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: subjectColor + "20" }}>
            <FlaskConical className="w-5 h-5" style={{ color: subjectColor }} />
          </div>
          <div className="text-left">
            <h2 className="text-base md:text-lg font-black text-foreground flex items-center gap-2">
              Interactive Labs
              <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-wide">
                Live
              </span>
              {blocks.length > 4 && (
                <span className="text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 rounded-full uppercase tracking-wide">
                  ✨ Enhanced
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Hands-on tools to explore {subjectName} concepts
            </p>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground transition-transform group-hover:text-foreground ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <>
          {/* Tab Navigation */}
          {blocks.length > 1 && (
            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1"
              style={{ scrollbarWidth: "thin" }}>
              {blocks.map((b) => {
                const meta = BLOCK_META[b];
                const isActive = active === b;
                return (
                  <button
                    key={b}
                    onClick={() => setActive(b)}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                      isActive
                        ? "text-white shadow-md scale-105"
                        : "bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                    }`}
                    style={isActive ? { backgroundColor: subjectColor } : {}}
                  >
                    <span className="text-sm">{meta.emoji}</span>
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Description */}
          <p className="text-[11px] text-muted-foreground mb-2 px-1">
            {BLOCK_META[active].emoji} {BLOCK_META[active].desc}
          </p>

          {/* Content Area with Error Boundary */}
          <BlockErrorBoundary blockName={BLOCK_META[active].label} subjectColor={subjectColor}>
            <Suspense fallback={<BlockSkeleton />}>
              <div className="interactive-block-wrapper">
                {renderBlock(active)}
              </div>
            </Suspense>
          </BlockErrorBoundary>

          {/* Quick Access to Other Tabs */}
          {blocks.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2 justify-center">
              {blocks.filter(b => b !== active).slice(0, 4).map((b) => (
                <button
                  key={b}
                  onClick={() => setActive(b)}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-muted-foreground hover:text-foreground flex items-center gap-1 transition-all hover:scale-105"
                >
                  <span>{BLOCK_META[b].emoji}</span>
                  {BLOCK_META[b].label}
                </button>
              ))}
              {blocks.length > 5 && (
                <span className="text-[10px] px-2 py-1.5 text-muted-foreground">
                  +{blocks.length - 5} more
                </span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
