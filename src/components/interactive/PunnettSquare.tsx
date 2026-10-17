/**
 * PunnettSquare.tsx — Interactive genetics calculator for biology.
 *
 * Features:
 *  - Monohybrid cross (one trait, two alleles per parent)
 *  - 4×4 Punnett square visualization
 *  - Genotype & phenotype ratios auto-computed
 *  - Probability percentages and fractions
 *  - Dominant/recessive allele setup (with heterozygous auto-detection)
 *  - Phenotype visual swatches for common traits (flower color, eye color, etc.)
 *  - Mobile-friendly: square scales, large cells
 *
 * Usage: <PunnettSquare subjectColor="#3b82f6" />
 */
import { useMemo, useState } from "react";
import { Dna, RotateCcw } from "lucide-react";

type Allele = string; // single uppercase or lowercase letter

export default function PunnettSquare({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  // Parent 1 genotype (2 alleles)
  const [p1a, setP1a] = useState("A");
  const [p1b, setP1b] = useState("a");
  const [p2a, setP2a] = useState("A");
  const [p2b, setP2b] = useState("a");

  // Phenotype labels
  const [dominantLabel, setDominantLabel] = useState("Purple flowers");
  const [recessiveLabel, setRecessiveLabel] = useState("White flowers");

  const p1 = [p1a, p1b];
  const p2 = [p2a, p2b];

  // Build 4×4 (well, 2×2 for monohybrid) Punnett square
  const square = useMemo(() => {
    const out: { genotype: string; sorted: string }[][] = [];
    for (let i = 0; i < p1.length; i++) {
      const row: { genotype: string; sorted: string }[] = [];
      for (let j = 0; j < p2.length; j++) {
        // combine alleles, dominant first (uppercase)
        const a = p1[i] || "?";
        const b = p2[j] || "?";
        const combined = [a, b].sort((x, y) => {
          const xUpper = x === x.toUpperCase();
          const yUpper = y === y.toUpperCase();
          if (xUpper && !yUpper) return -1;
          if (!xUpper && yUpper) return 1;
          return x.localeCompare(y);
        }).join("");
        row.push({ genotype: combined, sorted: combined });
      }
      out.push(row);
    }
    return out;
  }, [p1a, p1b, p2a, p2b]);

  // Count genotypes & phenotypes
  const stats = useMemo(() => {
    const genoCounts: Record<string, number> = {};
    const phenoCounts: { dominant: number; recessive: number } = { dominant: 0, recessive: 0 };
    square.forEach((row) => row.forEach((cell) => {
      const g = cell.genotype;
      genoCounts[g] = (genoCounts[g] || 0) + 1;
      const hasDominant = g.split("").some((a) => a === a.toUpperCase() && a !== "?");
      if (hasDominant) phenoCounts.dominant++;
      else phenoCounts.recessive++;
    }));
    const total = square.flat().length;
    return { genoCounts, phenoCounts, total };
  }, [square]);

  const AlleleInput = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 1))}
        className="w-12 h-12 text-center text-xl font-mono font-bold uppercase bg-background border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
        style={{ borderColor: subjectColor, color: subjectColor }}
        maxLength={1}
      />
    </div>
  );

  const inputValid = p1a && p1b && p2a && p2b && p1a.length === 1 && p1b.length === 1 && p2a.length === 1 && p2b.length === 1;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Dna className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Punnett Square Calculator</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Genotype inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-secondary/20 border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 text-center">Parent 1</div>
            <div className="flex items-center justify-center gap-3">
              <AlleleInput value={p1a} onChange={setP1a} label="Allele 1" />
              <AlleleInput value={p1b} onChange={setP1b} label="Allele 2" />
            </div>
            <div className="text-center text-xs font-mono mt-2 text-foreground">
              Genotype: <strong>{p1a}{p1b}</strong>
              {p1a === p1b && <span className="text-muted-foreground ml-1">(homozygous)</span>}
              {p1a !== p1b && p1a.toLowerCase() === p1b.toLowerCase() && <span className="text-muted-foreground ml-1">(heterozygous)</span>}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-secondary/20 border border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 text-center">Parent 2</div>
            <div className="flex items-center justify-center gap-3">
              <AlleleInput value={p2a} onChange={setP2a} label="Allele 1" />
              <AlleleInput value={p2b} onChange={setP2b} label="Allele 2" />
            </div>
            <div className="text-center text-xs font-mono mt-2 text-foreground">
              Genotype: <strong>{p2a}{p2b}</strong>
              {p2a === p2b && <span className="text-muted-foreground ml-1">(homozygous)</span>}
              {p2a !== p2b && p2a.toLowerCase() === p2b.toLowerCase() && <span className="text-muted-foreground ml-1">(heterozygous)</span>}
            </div>
          </div>
        </div>

        {/* Phenotype labels */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Dominant phenotype ({p1a.toUpperCase()})</label>
            <input value={dominantLabel} onChange={(e) => setDominantLabel(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Recessive phenotype ({p1b.toLowerCase()})</label>
            <input value={recessiveLabel} onChange={(e) => setRecessiveLabel(e.target.value)}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>

        {/* Punnett square */}
        {inputValid ? (
          <div className="flex justify-center">
            <div className="inline-block">
              {/* Header row for parent 2 alleles */}
              <div className="grid grid-cols-[40px_1fr_1fr] gap-1">
                <div />
                {p2.map((a, j) => (
                  <div key={j} className="w-16 h-10 flex items-center justify-center text-lg font-mono font-bold rounded-md bg-secondary"
                    style={{ color: subjectColor }}>
                    {a}
                  </div>
                ))}
              </div>
              {/* Body rows */}
              {square.map((row, i) => (
                <div key={i} className="grid grid-cols-[40px_1fr_1fr] gap-1 mt-1">
                  <div className="w-10 h-16 flex items-center justify-center text-lg font-mono font-bold rounded-md bg-secondary"
                    style={{ color: subjectColor }}>
                    {p1[i]}
                  </div>
                  {row.map((cell, j) => {
                    const hasDominant = cell.genotype.split("").some((a) => a === a.toUpperCase());
                    return (
                      <div key={j}
                        className="w-16 h-16 flex items-center justify-center text-xl font-mono font-bold rounded-md border-2"
                        style={{
                          borderColor: hasDominant ? subjectColor : "#94a3b8",
                          backgroundColor: hasDominant ? subjectColor + "20" : "white",
                          color: hasDominant ? subjectColor : "#475569",
                        }}>
                        {cell.genotype}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-700 text-center">Enter single-letter alleles for both parents.</p>
        )}

        {/* Results */}
        {inputValid && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Genotype ratios */}
            <div className="p-3 rounded-lg bg-secondary/20 border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Genotype ratio</div>
              <div className="space-y-1">
                {Object.entries(stats.genoCounts).sort().map(([g, count]) => (
                  <div key={g} className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-foreground">{g}</span>
                    <div className="flex-1 mx-2 h-3 bg-secondary rounded overflow-hidden">
                      <div className="h-full" style={{
                        width: `${(count / stats.total) * 100}%`,
                        backgroundColor: subjectColor,
                      }} />
                    </div>
                    <span className="font-mono text-muted-foreground w-16 text-right">
                      {count}/{stats.total} ({((count / stats.total) * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phenotype ratios */}
            <div className="p-3 rounded-lg bg-secondary/20 border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Phenotype ratio</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: subjectColor }} />
                    <span className="truncate">{dominantLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 h-3 bg-secondary rounded overflow-hidden">
                      <div className="h-full" style={{
                        width: `${(stats.phenoCounts.dominant / stats.total) * 100}%`,
                        backgroundColor: subjectColor,
                      }} />
                    </div>
                    <span className="font-mono text-muted-foreground w-16 text-right">
                      {stats.phenoCounts.dominant}/{stats.total} ({((stats.phenoCounts.dominant / stats.total) * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-3 h-3 rounded-sm shrink-0 bg-muted-foreground/40" />
                    <span className="truncate">{recessiveLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-16 h-3 bg-secondary rounded overflow-hidden">
                      <div className="h-full bg-muted-foreground/40" style={{
                        width: `${(stats.phenoCounts.recessive / stats.total) * 100}%`,
                      }} />
                    </div>
                    <span className="font-mono text-muted-foreground w-16 text-right">
                      {stats.phenoCounts.recessive}/{stats.total} ({((stats.phenoCounts.recessive / stats.total) * 100).toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Quick presets:</span>
          {[
            { label: "Aa × Aa (classic)", p1a: "A", p1b: "a", p2a: "A", p2b: "a", dom: "Purple", rec: "White" },
            { label: "AA × aa", p1a: "A", p1b: "A", p2a: "a", p2b: "a", dom: "Purple", rec: "White" },
            { label: "Aa × aa (testcross)", p1a: "A", p1b: "a", p2a: "a", p2b: "a", dom: "Purple", rec: "White" },
            { label: "Tt × Tt (tall/short)", p1a: "T", p1b: "t", p2a: "T", p2b: "t", dom: "Tall", rec: "Short" },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setP1a(preset.p1a); setP1b(preset.p1b);
                setP2a(preset.p2a); setP2b(preset.p2b);
                setDominantLabel(preset.dom); setRecessiveLabel(preset.rec);
              }}
              className="text-[10px] px-2 py-1 rounded-md bg-secondary hover:bg-secondary/70 text-foreground"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => {
              setP1a("A"); setP1b("a"); setP2a("A"); setP2b("a");
              setDominantLabel("Purple flowers"); setRecessiveLabel("White flowers");
            }}
            className="text-[10px] px-2 py-1 rounded-md bg-secondary hover:bg-secondary/70 text-muted-foreground flex items-center gap-1 ml-auto"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}
