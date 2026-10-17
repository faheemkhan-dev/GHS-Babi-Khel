/**
 * StatisticsPlayground.tsx — Interactive probability & statistics lab.
 *
 * Tools:
 *  1. Dice roller (1-10 dice, sum histogram grows in real-time)
 *  2. Coin flipper (1000 flips, ratio converges to 0.5 — demos Law of Large Numbers)
 *  3. Spinner (customizable sectors, spin, track frequency)
 *  4. Box plot builder (enter data → min/Q1/median/Q3/max)
 *  5. Histogram builder (slider for bin width)
 *  6. Normal distribution explorer (sliders for μ, σ)
 *
 * Mobile-friendly, no external deps.
 *
 * Usage: <StatisticsPlayground subjectColor="#3b82f6" />
 */
import { useMemo, useState } from "react";
import {
  BarChart3, Dices, CircleDollarSign, Disc3, Box, Bell, RotateCcw,
} from "lucide-react";

type Tool = "dice" | "coin" | "spinner" | "boxplot" | "histogram" | "normal";

export default function StatisticsPlayground({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  const [tool, setTool] = useState<Tool>("dice");

  const TOOLS: { id: Tool; label: string; icon: typeof Dices }[] = [
    { id: "dice", label: "Dice", icon: Dices },
    { id: "coin", label: "Coin", icon: CircleDollarSign },
    { id: "spinner", label: "Spinner", icon: Disc3 },
    { id: "boxplot", label: "Box Plot", icon: Box },
    { id: "histogram", label: "Histogram", icon: BarChart3 },
    { id: "normal", label: "Normal Dist", icon: Bell },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <BarChart3 className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Statistics Lab</span>
      </div>

      {/* Tool tabs */}
      <div className="p-2 border-b border-border flex gap-1.5 overflow-x-auto">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                active ? "text-white" : "bg-secondary hover:bg-secondary/70 text-foreground"
              }`}
              style={active ? { backgroundColor: subjectColor } : {}}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {tool === "dice" && <DiceTool subjectColor={subjectColor} />}
        {tool === "coin" && <CoinTool subjectColor={subjectColor} />}
        {tool === "spinner" && <SpinnerTool subjectColor={subjectColor} />}
        {tool === "boxplot" && <BoxPlotTool subjectColor={subjectColor} />}
        {tool === "histogram" && <HistogramTool subjectColor={subjectColor} />}
        {tool === "normal" && <NormalDistTool subjectColor={subjectColor} />}
      </div>
    </div>
  );
}

// ---------- Dice tool ------------------------------------------------------

function DiceTool({ subjectColor }: { subjectColor: string }) {
  const [numDice, setNumDice] = useState(2);
  const [rolls, setRolls] = useState<number[]>([]); // sums
  const [lastRoll, setLastRoll] = useState<number[]>([]);

  const roll = () => {
    const vals = Array.from({ length: numDice }, () => 1 + Math.floor(Math.random() * 6));
    setLastRoll(vals);
    setRolls((r) => [...r, vals.reduce((a, b) => a + b, 0)]);
  };

  const reset = () => { setRolls([]); setLastRoll([]); };

  // histogram: sum → count, sums range from numDice to 6*numDice
  const minSum = numDice, maxSum = numDice * 6;
  const histogram = useMemo(() => {
    const h: Record<number, number> = {};
    for (let i = minSum; i <= maxSum; i++) h[i] = 0;
    rolls.forEach((r) => { h[r] = (h[r] || 0) + 1; });
    return h;
  }, [rolls, minSum, maxSum]);

  const maxCount = Math.max(1, ...Object.values(histogram));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground">Number of dice:</label>
        <input
          type="range" min={1} max={10} value={numDice}
          onChange={(e) => { setNumDice(parseInt(e.target.value)); reset(); }}
          className="flex-1"
        />
        <span className="text-sm font-bold w-6 text-right">{numDice}</span>
      </div>

      <button onClick={roll}
        className="w-full py-2.5 rounded-lg text-white font-semibold text-sm"
        style={{ backgroundColor: subjectColor }}>
        Roll dice
      </button>

      {lastRoll.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-2">
          {lastRoll.map((v, i) => (
            <div key={i} className="w-12 h-12 rounded-lg bg-white border-2 flex items-center justify-center text-2xl font-bold shadow-sm"
              style={{ borderColor: subjectColor, color: subjectColor }}>
              {v}
            </div>
          ))}
          <span className="ml-2 text-lg font-bold text-foreground">
            Sum: {lastRoll.reduce((a, b) => a + b, 0)}
          </span>
        </div>
      )}

      {rolls.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{rolls.length} rolls</span>
            <span className="text-muted-foreground">Mean: {(rolls.reduce((a, b) => a + b, 0) / rolls.length).toFixed(2)}</span>
            <button onClick={reset} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          {/* Histogram */}
          <div className="flex items-end gap-1 h-40 p-2 bg-secondary/20 rounded-lg">
            {Object.entries(histogram).map(([sum, count]) => (
              <div key={sum} className="flex-1 flex flex-col items-center justify-end gap-1">
                <span className="text-[9px] font-mono text-muted-foreground">{count || ""}</span>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${(count / maxCount) * 100}%`,
                    minHeight: count > 0 ? "4px" : "0",
                    backgroundColor: subjectColor,
                  }}
                />
                <span className="text-[9px] font-mono text-muted-foreground">{sum}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Watch the histogram converge to a bell shape as you roll more — that's the Central Limit Theorem!
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Coin tool ------------------------------------------------------

function CoinTool({ subjectColor }: { subjectColor: string }) {
  const [flips, setFlips] = useState(0);
  const [heads, setHeads] = useState(0);

  const flipOnce = () => {
    const h = Math.random() < 0.5;
    setFlips((f) => f + 1);
    if (h) setHeads((h) => h + 1);
  };
  const flip100 = () => {
    let h = 0;
    for (let i = 0; i < 100; i++) if (Math.random() < 0.5) h++;
    setFlips((f) => f + 100);
    setHeads((prev) => prev + h);
  };
  const flip1000 = () => {
    let h = 0;
    for (let i = 0; i < 1000; i++) if (Math.random() < 0.5) h++;
    setFlips((f) => f + 1000);
    setHeads((prev) => prev + h);
  };
  const reset = () => { setFlips(0); setHeads(0); };

  const ratio = flips > 0 ? heads / flips : 0;
  const tails = flips - heads;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={flipOnce} className="px-3 py-1.5 rounded-md text-xs font-semibold text-white"
          style={{ backgroundColor: subjectColor }}>Flip 1</button>
        <button onClick={flip100} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-secondary hover:bg-secondary/70">Flip 100</button>
        <button onClick={flip1000} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-secondary hover:bg-secondary/70">Flip 1000</button>
        <button onClick={reset} className="px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/70 flex items-center gap-1">
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Big ratio display */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-center">
          <div className="text-[10px] text-amber-700 uppercase tracking-wide">Heads</div>
          <div className="text-3xl font-bold text-amber-700">{heads}</div>
        </div>
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-center">
          <div className="text-[10px] text-slate-700 uppercase tracking-wide">Tails</div>
          <div className="text-3xl font-bold text-slate-700">{tails}</div>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-secondary/20 border border-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Total flips: <strong className="text-foreground">{flips}</strong></span>
          <span className="text-xs text-muted-foreground">Heads ratio: <strong className="text-foreground">{ratio.toFixed(4)}</strong></span>
        </div>
        {/* ratio bar */}
        <div className="h-4 rounded-full overflow-hidden bg-slate-200 flex">
          <div className="bg-amber-500" style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Theoretical: 0.5000 — watch your ratio converge as you flip more. This is the <strong>Law of Large Numbers</strong>.
        </p>
      </div>
    </div>
  );
}

// ---------- Spinner tool ---------------------------------------------------

function SpinnerTool({ subjectColor }: { subjectColor: string }) {
  const [sectors, setSectors] = useState([
    { label: "A", color: "#ef4444", count: 0 },
    { label: "B", color: "#3b82f6", count: 0 },
    { label: "C", color: "#10b981", count: 0 },
    { label: "D", color: "#f59e0b", count: 0 },
  ]);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    const target = Math.random() * 360;
    const totalSpins = 5 + Math.random() * 3;
    const finalAngle = angle + totalSpins * 360 + target;
    setAngle(finalAngle);

    setTimeout(() => {
      // determine which sector the pointer landed on (pointer at top, 0deg)
      const normalized = ((360 - (finalAngle % 360)) % 360);
      const sectorSize = 360 / sectors.length;
      const idx = Math.floor(normalized / sectorSize) % sectors.length;
      setSectors((prev) => prev.map((s, i) => i === idx ? { ...s, count: s.count + 1 } : s));
      setSpinning(false);
    }, 4000);
  };

  const total = sectors.reduce((a, s) => a + s.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row items-center gap-4">
        {/* SVG spinner */}
        <div className="relative w-48 h-48 shrink-0">
          <svg viewBox="0 0 200 200" className="w-full h-full transition-transform"
            style={{ transform: `rotate(${angle}deg)`, transitionDuration: spinning ? "4s cubic-bezier(0.17, 0.67, 0.21, 1)" : "0s" }}>
            {sectors.map((s, i) => {
              const start = (i / sectors.length) * 2 * Math.PI - Math.PI / 2;
              const end = ((i + 1) / sectors.length) * 2 * Math.PI - Math.PI / 2;
              const x1 = 100 + 90 * Math.cos(start);
              const y1 = 100 + 90 * Math.sin(start);
              const x2 = 100 + 90 * Math.cos(end);
              const y2 = 100 + 90 * Math.sin(end);
              const largeArc = (end - start) > Math.PI ? 1 : 0;
              const midAngle = (start + end) / 2;
              const lx = 100 + 50 * Math.cos(midAngle);
              const ly = 100 + 50 * Math.sin(midAngle);
              return (
                <g key={i}>
                  <path d={`M 100 100 L ${x1} ${y1} A 90 90 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={s.color} stroke="white" strokeWidth={2} />
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight="bold" fill="white">
                    {s.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {/* Pointer */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-0 h-0 border-l-8 border-r-8 border-t-[16px] border-l-transparent border-r-transparent border-t-foreground" />
        </div>

        <div className="flex-1 space-y-2 w-full">
          <button onClick={spin} disabled={spinning}
            className="w-full py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
            style={{ backgroundColor: subjectColor }}>
            {spinning ? "Spinning…" : "Spin!"}
          </button>
          <button onClick={() => setSectors(sectors.map((s) => ({ ...s, count: 0 })))}
            className="w-full py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/70 flex items-center justify-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset counts
          </button>

          {/* Results */}
          <div className="space-y-1">
            {sectors.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="font-medium w-6">{s.label}</span>
                <div className="flex-1 h-4 rounded bg-secondary overflow-hidden">
                  <div className="h-full" style={{
                    width: total > 0 ? `${(s.count / total) * 100}%` : "0%",
                    backgroundColor: s.color,
                  }} />
                </div>
                <span className="text-muted-foreground font-mono w-12 text-right">
                  {s.count} ({total > 0 ? ((s.count / total) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Total spins: {total}. Each sector has equal probability (1/{sectors.length}).
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- Box plot tool --------------------------------------------------

function BoxPlotTool({ subjectColor }: { subjectColor: string }) {
  const [input, setInput] = useState("3, 7, 8, 5, 12, 14, 18, 21, 22, 9, 11");

  const data = useMemo(() => {
    const nums = input.split(/[,\s]+/).map((s) => parseFloat(s)).filter((n) => !isNaN(n));
    if (nums.length < 4) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const q = (p: number) => {
      const idx = p * (sorted.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    const min = sorted[0], max = sorted[sorted.length - 1];
    const q1 = q(0.25), median = q(0.5), q3 = q(0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);
    const whiskerLow = Math.min(...sorted.filter((v) => v >= lowerFence));
    const whiskerHigh = Math.max(...sorted.filter((v) => v <= upperFence));
    return { sorted, min, max, q1, median, q3, iqr, outliers, whiskerLow, whiskerHigh };
  }, [input]);

  if (!data) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Enter at least 4 numbers separated by commas:</p>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          className="w-full p-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          rows={3} />
        <p className="text-xs text-red-500">Need at least 4 valid numbers.</p>
      </div>
    );
  }

  const { min, max, q1, median, q3, iqr, outliers, whiskerLow, whiskerHigh } = data;
  const range = max - min || 1;
  const scale = (v: number) => ((v - min) / range) * 100;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Enter numbers separated by commas:</p>
      <textarea value={input} onChange={(e) => setInput(e.target.value)}
        className="w-full p-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
        rows={3} />

      {/* Box plot visualization */}
      <div className="p-4 bg-secondary/20 rounded-lg">
        <div className="relative h-32">
          {/* number line at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          {/* ticks */}
          {[min, q1, median, q3, max].map((v, i) => (
            <div key={i} className="absolute bottom-0 flex flex-col items-center" style={{ left: `${scale(v)}%`, transform: "translateX(-50%)" }}>
              <div className="w-px h-2 bg-border" />
              <span className="text-[9px] font-mono text-muted-foreground mt-1">{v.toFixed(1)}</span>
            </div>
          ))}
          {/* box */}
          <div className="absolute top-6 border-2 rounded-sm"
            style={{
              left: `${scale(q1)}%`,
              width: `${scale(q3) - scale(q1)}%`,
              height: 50,
              borderColor: subjectColor,
              backgroundColor: subjectColor + "30",
            }}>
            {/* median line */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-foreground"
              style={{ left: `${((median - q1) / (q3 - q1 || 1)) * 100}%` }} />
          </div>
          {/* whiskers */}
          <div className="absolute top-[31px] h-px bg-foreground"
            style={{ left: `${scale(whiskerLow)}%`, width: `${scale(q1) - scale(whiskerLow)}%` }} />
          <div className="absolute top-[31px] h-px bg-foreground"
            style={{ left: `${scale(q3)}%`, width: `${scale(whiskerHigh) - scale(q3)}%` }} />
          {/* whisker caps */}
          <div className="absolute top-6 h-4 w-px bg-foreground" style={{ left: `${scale(whiskerLow)}%` }} />
          <div className="absolute top-6 h-4 w-px bg-foreground" style={{ left: `${scale(whiskerHigh)}%` }} />
          {/* outliers */}
          {outliers.map((o, i) => (
            <div key={i} className="absolute w-2 h-2 rounded-full bg-red-500"
              style={{ left: `${scale(o)}%`, top: 30, transform: "translate(-50%, -50%)" }} />
          ))}
          {/* labels */}
          <div className="absolute top-0 text-[9px] font-mono text-muted-foreground"
            style={{ left: `${scale(q1)}%`, transform: "translateX(-50%)" }}>Q1</div>
          <div className="absolute top-0 text-[9px] font-mono text-muted-foreground"
            style={{ left: `${scale(median)}%`, transform: "translateX(-50%)" }}>Median</div>
          <div className="absolute top-0 text-[9px] font-mono text-muted-foreground"
            style={{ left: `${scale(q3)}%`, transform: "translateX(-50%)" }}>Q3</div>
        </div>
      </div>

      {/* Summary table */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
        <Stat label="Min" value={min.toFixed(2)} />
        <Stat label="Q1" value={q1.toFixed(2)} />
        <Stat label="Median" value={median.toFixed(2)} />
        <Stat label="Q3" value={q3.toFixed(2)} />
        <Stat label="Max" value={max.toFixed(2)} />
        <Stat label="IQR" value={iqr.toFixed(2)} />
      </div>

      {outliers.length > 0 && (
        <p className="text-[10px] text-amber-700">
          ⚠ Outliers detected: {outliers.map((o) => o.toFixed(1)).join(", ")} (beyond 1.5×IQR)
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-md bg-secondary/20 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-semibold text-foreground">{value}</div>
    </div>
  );
}

// ---------- Histogram tool -------------------------------------------------

function HistogramTool({ subjectColor }: { subjectColor: string }) {
  const [input, setInput] = useState("12, 15, 18, 22, 25, 28, 30, 32, 35, 38, 41, 45, 48, 52, 55, 58, 62, 65, 68, 72");
  const [binWidth, setBinWidth] = useState(10);

  const data = useMemo(() => {
    const nums = input.split(/[,\s]+/).map((s) => parseFloat(s)).filter((n) => !isNaN(n));
    if (nums.length === 0) return null;
    const min = Math.min(...nums), max = Math.max(...nums);
    const numBins = Math.max(1, Math.ceil((max - min) / binWidth));
    const bins = Array(numBins).fill(0);
    nums.forEach((n) => {
      let idx = Math.floor((n - min) / binWidth);
      if (idx >= numBins) idx = numBins - 1;
      bins[idx]++;
    });
    return { nums, min, max, bins, numBins };
  }, [input, binWidth]);

  if (!data) return <p className="text-xs text-muted-foreground">Enter some numbers.</p>;

  const maxBin = Math.max(...data.bins);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Enter numbers separated by commas:</p>
      <textarea value={input} onChange={(e) => setInput(e.target.value)}
        className="w-full p-2 rounded-md border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
        rows={3} />

      <div>
        <label className="text-xs text-muted-foreground">Bin width: {binWidth}</label>
        <input type="range" min={1} max={20} value={binWidth}
          onChange={(e) => setBinWidth(parseInt(e.target.value))}
          className="w-full"
          style={{ accentColor: subjectColor }}
        />
      </div>

      <div className="flex items-end gap-1 h-40 p-2 bg-secondary/20 rounded-lg">
        {data.bins.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
            <span className="text-[9px] font-mono text-muted-foreground">{count || ""}</span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${(count / maxBin) * 100}%`,
                minHeight: count > 0 ? "4px" : "0",
                backgroundColor: subjectColor,
              }}
            />
            <span className="text-[9px] font-mono text-muted-foreground">
              {(data.min + i * binWidth).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        {data.nums.length} data points · {data.numBins} bins · range [{data.min.toFixed(1)}, {data.max.toFixed(1)}]
      </p>
    </div>
  );
}

// ---------- Normal distribution -------------------------------------------

function NormalDistTool({ subjectColor }: { subjectColor: string }) {
  const [mu, setMu] = useState(0);
  const [sigma, setSigma] = useState(1);
  const [shadeLow, setShadeLow] = useState(-1);
  const [shadeHigh, setShadeHigh] = useState(1);

  const pdf = (x: number) => Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2)) / (sigma * Math.sqrt(2 * Math.PI));

  const W = 320, H = 180, pad = 20;
  const xMin = mu - 4 * sigma, xMax = mu + 4 * sigma;
  const yMax = pdf(mu);
  const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (W - 2 * pad);
  const toY = (y: number) => H - pad - (y / yMax) * (H - 2 * pad);

  // build curve points
  const points: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = xMin + (i / 100) * (xMax - xMin);
    points.push(`${toX(x)},${toY(pdf(x))}`);
  }

  // shade area
  const shadePoints: string[] = [];
  for (let i = 0; i <= 50; i++) {
    const x = shadeLow + (i / 50) * (shadeHigh - shadeLow);
    shadePoints.push(`${toX(x)},${toY(pdf(x))}`);
  }
  const shadePath = `M ${toX(shadeLow)},${toY(0)} L ${shadePoints.join(" L ")} L ${toX(shadeHigh)},${toY(0)} Z`;

  // probability = Φ((high-μ)/σ) − Φ((low-μ)/σ)
  const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
  const prob = phi((shadeHigh - mu) / sigma) - phi((shadeLow - mu) / sigma);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Mean (μ): {mu.toFixed(1)}</label>
          <input type="range" min={-5} max={5} step={0.1} value={mu}
            onChange={(e) => setMu(parseFloat(e.target.value))}
            className="w-full" style={{ accentColor: subjectColor }} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Std dev (σ): {sigma.toFixed(1)}</label>
          <input type="range" min={0.5} max={3} step={0.1} value={sigma}
            onChange={(e) => setSigma(parseFloat(e.target.value))}
            className="w-full" style={{ accentColor: subjectColor }} />
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* axes */}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#cbd5e1" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#cbd5e1" />
        {/* shaded area */}
        <path d={shadePath} fill={subjectColor} opacity={0.3} />
        {/* curve */}
        <polyline points={points.join(" ")} fill="none" stroke={subjectColor} strokeWidth={2} />
        {/* x-axis labels */}
        <text x={toX(mu)} y={H - pad + 12} textAnchor="middle" fontSize={9} fill="#64748b">{mu.toFixed(1)}</text>
        <text x={toX(mu - sigma)} y={H - pad + 12} textAnchor="middle" fontSize={8} fill="#94a3b8">μ-σ</text>
        <text x={toX(mu + sigma)} y={H - pad + 12} textAnchor="middle" fontSize={8} fill="#94a3b8">μ+σ</text>
      </svg>

      <div>
        <label className="text-xs text-muted-foreground">Shade region: [{shadeLow.toFixed(1)}, {shadeHigh.toFixed(1)}]</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <input type="range" min={mu - 4 * sigma} max={mu} step={0.1} value={shadeLow}
            onChange={(e) => setShadeLow(parseFloat(e.target.value))}
            className="w-full" style={{ accentColor: subjectColor }} />
          <input type="range" min={mu} max={mu + 4 * sigma} step={0.1} value={shadeHigh}
            onChange={(e) => setShadeHigh(parseFloat(e.target.value))}
            className="w-full" style={{ accentColor: subjectColor }} />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-secondary/20 border border-border">
        <div className="text-[10px] text-muted-foreground">P({shadeLow.toFixed(1)} ≤ X ≤ {shadeHigh.toFixed(1)})</div>
        <div className="text-2xl font-mono font-bold" style={{ color: subjectColor }}>
          {(prob * 100).toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

// Abramowitz and Stegun erf approximation
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
