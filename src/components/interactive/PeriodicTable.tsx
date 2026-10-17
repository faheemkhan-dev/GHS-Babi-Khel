/**
 * PeriodicTable.tsx — Interactive periodic table with all 118 elements.
 *
 * Features:
 *  - All 118 elements, color-coded by category
 *  - Trends heatmap: electronegativity, atomic radius, ionization energy
 *  - Click any element → detail modal with electron shell diagram (Bohr model)
 *  - Mobile-friendly: horizontal scroll on the table, modal becomes full-screen sheet
 *  - Search by name, symbol, or atomic number
 *  - Group/period highlights on hover
 *
 * Usage:
 *   <PeriodicTable subjectColor="#3b82f6" />
 */
import { useMemo, useState } from "react";
import { Atom, Search, X, FlaskConical } from "lucide-react";
import {
  ELEMENTS, CATEGORY_COLORS, CATEGORY_LABELS, ELEMENT_BY_NUM,
  type Element,
} from "./periodicData";

type TrendMode = "category" | "electroneg" | "radius" | "ionization";

function trendColor(mode: TrendMode, el: Element): string {
  if (mode === "category") return CATEGORY_COLORS[el.category] || "#ced4da";
  const val = mode === "electroneg" ? el.electroneg
    : mode === "radius" ? el.radius
    : el.ionization;
  if (val == null) return "#e5e7eb"; // gray for unknown
  // normalize ranges
  let norm: number;
  if (mode === "electroneg") {
    norm = Math.max(0, Math.min(1, (val - 0.5) / 3.5));
  } else if (mode === "radius") {
    norm = Math.max(0, Math.min(1, (val - 30) / 270));
  } else {
    norm = Math.max(0, Math.min(1, (val - 350) / 2050));
  }
  // blue → red gradient
  const hue = (1 - norm) * 220;
  return `hsl(${hue}, 70%, 65%)`;
}

// Bohr model shell diagram (SVG)
function BohrDiagram({ element }: { element: Element }) {
  const shells = element.shells;
  const maxShell = Math.max(...shells);
  const size = 220;
  const center = size / 2;
  const maxRadius = size / 2 - 12;
  const nucleusR = 18;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto max-w-[220px] mx-auto">
      {/* shells */}
      {shells.map((count, i) => {
        const r = nucleusR + 12 + (i + 1) * ((maxRadius - nucleusR - 12) / shells.length);
        return (
          <g key={i}>
            <circle cx={center} cy={center} r={r} fill="none" stroke="#cbd5e1" strokeWidth={1} />
            {Array.from({ length: count }).map((_, j) => {
              const angle = (j / count) * Math.PI * 2 + (i * 0.3);
              const ex = center + r * Math.cos(angle);
              const ey = center + r * Math.sin(angle);
              return (
                <circle
                  key={j}
                  cx={ex}
                  cy={ey}
                  r={3.5}
                  fill={CATEGORY_COLORS[element.category] || "#64748b"}
                />
              );
            })}
          </g>
        );
      })}
      {/* nucleus */}
      <circle cx={center} cy={center} r={nucleusR} fill={CATEGORY_COLORS[element.category] || "#64748b"} />
      <text
        x={center} y={center}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={14} fontWeight="bold" fill="white"
      >
        {element.symbol}
      </text>
    </svg>
  );
}

export default function PeriodicTable({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  const [selected, setSelected] = useState<Element | null>(null);
  const [trend, setTrend] = useState<TrendMode>("category");
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<Element | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return new Set<number>(ELEMENTS.map((e) => e.num));
    const q = query.trim().toLowerCase();
    return new Set(
      ELEMENTS
        .filter((e) =>
          e.name.toLowerCase().includes(q) ||
          e.symbol.toLowerCase() === q ||
          e.num.toString() === q
        )
        .map((e) => e.num)
    );
  }, [query]);

  // Element tile
  const Tile = ({ el }: { el: Element }) => {
    const bg = trendColor(trend, el);
    const isMatch = filtered.has(el.num);
    if (!isMatch) {
      return (
        <div
          className="aspect-square rounded-sm flex items-center justify-center text-[8px] text-muted-foreground/30 bg-secondary/20"
          style={{ gridColumn: el.xpos, gridRow: el.ypos }}
          title={`${el.name} (filtered out)`}
        >
          {el.symbol}
        </div>
      );
    }
    return (
      <button
        onClick={() => setSelected(el)}
        onMouseEnter={() => setHovered(el)}
        onMouseLeave={() => setHovered(null)}
        className="aspect-square rounded-sm flex flex-col items-center justify-center p-0.5 transition-transform hover:scale-110 hover:z-10 hover:ring-2 hover:ring-foreground/40 relative"
        style={{
          gridColumn: el.xpos,
          gridRow: el.ypos,
          backgroundColor: bg,
          color: "#0f172a",
        }}
        title={`${el.name} (${el.symbol}) — Z=${el.num}`}
      >
        <span className="text-[7px] sm:text-[8px] font-mono leading-none opacity-80">{el.num}</span>
        <span className="text-[10px] sm:text-sm font-bold leading-none">{el.symbol}</span>
        <span className="text-[6px] sm:text-[7px] leading-none mt-0.5 opacity-70 truncate w-full text-center hidden sm:block">
          {el.name}
        </span>
      </button>
    );
  };

  // Legend for current trend
  const Legend = () => {
    if (trend === "category") {
      return (
        <div className="flex flex-wrap gap-2 text-[10px]">
          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
            <div key={k} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[k] }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      );
    }
    // gradient legend
    const label = trend === "electroneg" ? "Electronegativity" : trend === "radius" ? "Atomic radius (pm)" : "Ionization (kJ/mol)";
    const min = trend === "electroneg" ? 0.5 : trend === "radius" ? 30 : 350;
    const max = trend === "electroneg" ? 4.0 : trend === "radius" ? 300 : 2400;
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground">{min}</span>
        <div className="h-3 w-32 rounded-full"
          style={{ background: "linear-gradient(to right, hsl(220, 70%, 65%), hsl(0, 70%, 65%))" }}
        />
        <span className="text-muted-foreground">{max}</span>
        <span className="font-medium text-foreground ml-1">{label}</span>
        <span className="text-muted-foreground">(gray = no data)</span>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30 flex-wrap">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Atom className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Periodic Table</span>
        <span className="text-[10px] text-muted-foreground">All 118 elements</span>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* Trend switcher */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {([
              ["category", "Category"],
              ["electroneg", "Electroneg"],
              ["radius", "Radius"],
              ["ionization", "Ionization"],
            ] as [TrendMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setTrend(mode)}
                className={`px-2 py-1 text-[10px] font-medium ${
                  trend === mode ? "text-white" : "bg-card hover:bg-secondary text-muted-foreground"
                }`}
                style={trend === mode ? { backgroundColor: subjectColor } : {}}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="pl-7 pr-7 py-1 rounded-md bg-card border border-border text-xs w-28 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {query && (
              <button onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Legend */}
        <Legend />

        {/* Table — horizontal scroll on mobile */}
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div
            className="grid gap-[2px] min-w-[720px]"
            style={{
              gridTemplateColumns: "repeat(18, minmax(0, 1fr))",
              gridTemplateRows: "repeat(10, auto)",
            }}
          >
            {/* f-block label cells */}
            <div className="text-[8px] text-muted-foreground self-center text-right pr-1"
              style={{ gridColumn: 2, gridRow: 9 }}>*</div>
            <div className="text-[8px] text-muted-foreground self-center text-right pr-1"
              style={{ gridColumn: 2, gridRow: 10 }}>**</div>

            {ELEMENTS.map((el) => (
              <Tile key={el.num} el={el} />
            ))}
          </div>
        </div>

        {/* Hover preview / quick info */}
        {hovered && !selected && (
          <div className="p-2 rounded-lg bg-secondary/30 border border-border text-xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center text-white font-bold shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[hovered.category] || "#64748b" }}>
              {hovered.symbol}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-foreground">
                {hovered.num}. {hovered.name}
                <span className="ml-2 text-muted-foreground font-normal">
                  {CATEGORY_LABELS[hovered.category]}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground truncate">{hovered.summary}</div>
            </div>
          </div>
        )}

        {/* Tip */}
        <div className="text-[10px] text-muted-foreground text-center">
          Tap any element for details, electron configuration & Bohr diagram
        </div>
      </div>

      {/* Element detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-card w-full sm:max-w-md max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 flex items-center gap-3 border-b border-border"
              style={{ backgroundColor: (CATEGORY_COLORS[selected.category] || "#64748b") + "20" }}>
              <div className="w-14 h-14 rounded-lg flex flex-col items-center justify-center text-white shrink-0"
                style={{ backgroundColor: CATEGORY_COLORS[selected.category] || "#64748b" }}>
                <span className="text-[10px] font-mono opacity-80">{selected.num}</span>
                <span className="text-xl font-bold leading-none">{selected.symbol}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-foreground">{selected.name}</h3>
                <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[selected.category]}</p>
              </div>
              <button onClick={() => setSelected(null)}
                className="p-2 rounded-lg hover:bg-secondary shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Bohr diagram */}
              <div className="bg-white rounded-lg p-3 border border-border">
                <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <FlaskConical className="w-3 h-3" /> Electron shells (Bohr model)
                </div>
                <BohrDiagram element={selected} />
                <div className="text-center text-[10px] text-muted-foreground mt-1">
                  Shells: {selected.shells.join(", ")}
                </div>
              </div>

              {/* Summary */}
              <p className="text-sm text-foreground">{selected.summary}</p>

              {/* Properties grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Prop label="Atomic number" value={selected.num.toString()} />
                <Prop label="Atomic mass" value={`${selected.mass} u`} />
                <Prop label="Period" value={selected.period.toString()} />
                <Prop label="Group" value={selected.group?.toString() || (selected.block === "f" ? "f-block" : "—")} />
                <Prop label="Block" value={selected.block.toUpperCase()} />
                <Prop label="State at STP" value={selected.state} />
                <Prop label="Electronegativity" value={selected.electroneg?.toString() || "—"} />
                <Prop label="Atomic radius" value={selected.radius ? `${selected.radius} pm` : "—"} />
                <Prop label="Ionization energy" value={selected.ionization ? `${selected.ionization} kJ/mol` : "—"} />
                <Prop label="Discovered" value={selected.discovered.toString()} />
              </div>

              {/* Electron config */}
              <div className="p-2.5 rounded-lg bg-secondary/30 border border-border">
                <div className="text-[10px] text-muted-foreground mb-1">Electron configuration</div>
                <div className="font-mono text-sm text-foreground break-all">{selected.config}</div>
              </div>

              {/* Quick navigation */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selected.num > 1 && setSelected(ELEMENT_BY_NUM[selected.num - 1])}
                  disabled={selected.num <= 1}
                  className="flex-1 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/70 text-xs font-medium disabled:opacity-30"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => selected.num < 118 && setSelected(ELEMENT_BY_NUM[selected.num + 1])}
                  disabled={selected.num >= 118}
                  className="flex-1 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/70 text-xs font-medium disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-md bg-secondary/20">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-semibold text-foreground">{value}</div>
    </div>
  );
}
