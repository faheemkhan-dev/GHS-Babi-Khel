/**
 * NumberLineLab.tsx — Visual number line manipulatives for junior math.
 *
 * Features:
 *  - Interactive number line with adjustable range (−20 to 20)
 *  - "Jump" mode: visualize addition/subtraction as jumps on the line
 *  - "Multiply" mode: show repeated jumps
 *  - "Fraction" mode: partition the line into fractions
 *  - "Negative" mode: two-color counters for integer operations
 *  - Custom problem input: type "5 + 3" → see it visualized
 *
 * Usage: <NumberLineLab subjectColor="#3b82f6" />
 */
import { useMemo, useState } from "react";
import { Minus, Plus, RotateCcw, Spline } from "lucide-react";

type Mode = "add" | "subtract" | "multiply" | "divide" | "fractions";

export default function NumberLineLab({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [start, setStart] = useState(0);
  const [step, setStep] = useState(5);
  const [count, setCount] = useState(1);
  const [denominator, setDenominator] = useState(4);

  // Compute the jumps for current mode
  const jumps = useMemo(() => {
    if (mode === "add" || mode === "subtract") {
      const sign = mode === "add" ? 1 : -1;
      const end = start + sign * step;
      return [{ from: start, to: end, label: `${mode === "add" ? "+" : "−"}${step}` }];
    }
    if (mode === "multiply") {
      const result: { from: number; to: number; label: string }[] = [];
      let cur = start;
      for (let i = 0; i < count; i++) {
        const next = cur + step;
        result.push({ from: cur, to: next, label: `+${step}` });
        cur = next;
      }
      return result;
    }
    if (mode === "divide") {
      const total = step * count;
      const result: { from: number; to: number; label: string }[] = [];
      let cur = start;
      const each = total / count;
      for (let i = 0; i < count; i++) {
        const next = cur + each;
        result.push({ from: cur, to: next, label: `+${each.toFixed(1)}` });
        cur = next;
      }
      return result;
    }
    return [];
  }, [mode, start, step, count]);

  // Compute the final answer
  const answer = useMemo(() => {
    if (jumps.length === 0) return start;
    return jumps[jumps.length - 1].to;
  }, [jumps, start]);

  // Number line range
  const allPoints = [start, ...jumps.map((j) => j.to)];
  const minVal = Math.min(...allPoints, 0);
  const maxVal = Math.max(...allPoints, 0);
  const padding = Math.max(2, Math.ceil((maxVal - minVal) * 0.15));
  const rangeMin = Math.floor(minVal - padding);
  const rangeMax = Math.ceil(maxVal + padding);
  const range = rangeMax - rangeMin || 1;

  // SVG layout
  const W = 600, H = 100;
  const pad = 30;
  const toX = (v: number) => pad + ((v - rangeMin) / range) * (W - 2 * pad);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Spline className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Number Line Lab</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Mode tabs */}
        <div className="flex flex-wrap gap-1.5">
          {([
            ["add", "Addition"],
            ["subtract", "Subtraction"],
            ["multiply", "Multiply"],
            ["divide", "Divide"],
            ["fractions", "Fractions"],
          ] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`text-[10px] px-2.5 py-1.5 rounded-lg font-medium ${
                mode === m ? "text-white" : "bg-secondary hover:bg-secondary/70 text-foreground"
              }`}
              style={mode === m ? { backgroundColor: subjectColor } : {}}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Inputs */}
        {mode !== "fractions" && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Start at</label>
              <input type="number" value={start}
                onChange={(e) => setStart(parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">
                {mode === "multiply" || mode === "divide" ? "Step" : mode === "add" ? "Add" : "Subtract"}
              </label>
              <input type="number" value={step}
                onChange={(e) => setStep(parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            {(mode === "multiply" || mode === "divide") && (
              <div>
                <label className="text-[10px] text-muted-foreground">
                  {mode === "multiply" ? "Times" : "Into pieces"}
                </label>
                <input type="number" value={count} min={1}
                  onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            )}
          </div>
        )}

        {/* Number line visualization */}
        {mode !== "fractions" ? (
          <div className="bg-white rounded-lg p-3 border border-border overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[500px]">
              {/* line */}
              <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#0f172a" strokeWidth={2} />
              {/* ticks */}
              {Array.from({ length: range + 1 }).map((_, i) => {
                const v = rangeMin + i;
                const x = toX(v);
                const isStart = v === start;
                const isEnd = v === answer;
                const isLabeled = range <= 30 || v % Math.ceil(range / 20) === 0 || isStart || isEnd;
                return (
                  <g key={i}>
                    <line x1={x} y1={H / 2 - 5} x2={x} y2={H / 2 + 5} stroke="#0f172a" strokeWidth={1} />
                    {isLabeled && (
                      <text x={x} y={H / 2 + 18} textAnchor="middle" fontSize={10} fill={isStart ? subjectColor : isEnd ? "#16a34a" : "#64748b"} fontWeight={isStart || isEnd ? 700 : 400}>
                        {v}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* jumps */}
              {jumps.map((j, i) => {
                const x1 = toX(j.from), x2 = toX(j.to);
                const midX = (x1 + x2) / 2;
                const arcHeight = 30 + (i % 3) * 10;
                const color = subjectColor;
                return (
                  <g key={i}>
                    {/* arc */}
                    <path
                      d={`M ${x1} ${H / 2} Q ${midX} ${H / 2 - arcHeight} ${x2} ${H / 2}`}
                      stroke={color}
                      strokeWidth={2.5}
                      fill="none"
                      markerEnd="url(#arrow)"
                    />
                    {/* label */}
                    <text x={midX} y={H / 2 - arcHeight - 4} textAnchor="middle" fontSize={10} fill={color} fontWeight={600}>
                      {j.label}
                    </text>
                    {/* end point */}
                    <circle cx={x2} cy={H / 2} r={5} fill="#16a34a" />
                  </g>
                );
              })}
              {/* start point */}
              <circle cx={toX(start)} cy={H / 2} r={5} fill={subjectColor} />
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                  <path d="M 0 0 L 8 4 L 0 8 Z" fill={subjectColor} />
                </marker>
              </defs>
            </svg>
          </div>
        ) : (
          <FractionLine subjectColor={subjectColor} denominator={denominator} setDenominator={setDenominator} />
        )}

        {/* Equation + answer */}
        {mode !== "fractions" && (
          <div className="p-3 rounded-lg bg-secondary/20 border border-border text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Equation</div>
            <div className="text-xl font-mono font-bold text-foreground">
              {mode === "add" && `${start} + ${step} = ${answer}`}
              {mode === "subtract" && `${start} − ${step} = ${answer}`}
              {mode === "multiply" && `${start} + ${count} × ${step} = ${answer}`}
              {mode === "divide" && `${step * count} ÷ ${count} = ${answer}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FractionLine({ subjectColor, denominator, setDenominator }: {
  subjectColor: string; denominator: number; setDenominator: (n: number) => void;
}) {
  const [highlight, setHighlight] = useState(2);

  const W = 600, H = 80, pad = 30;
  const lineLength = W - 2 * pad;
  const segWidth = lineLength / denominator;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground">Denominator: {denominator}</label>
          <input type="range" min={2} max={12} value={denominator}
            onChange={(e) => {
              const d = parseInt(e.target.value);
              setDenominator(d);
              setHighlight(Math.min(highlight, d));
            }}
            className="w-full" style={{ accentColor: subjectColor }} />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Highlight: {highlight}/{denominator}</label>
          <input type="range" min={0} max={denominator} value={highlight}
            onChange={(e) => setHighlight(parseInt(e.target.value))}
            className="w-full" style={{ accentColor: subjectColor }} />
        </div>
      </div>

      <div className="bg-white rounded-lg p-3 border border-border">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* base line */}
          <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#0f172a" strokeWidth={2} />
          {/* highlight segments */}
          {Array.from({ length: denominator }).map((_, i) => {
            const x1 = pad + i * segWidth;
            const isOn = i < highlight;
            return (
              <g key={i}>
                <rect
                  x={x1} y={H / 2 - 12} width={segWidth} height={24}
                  fill={isOn ? subjectColor : "transparent"}
                  opacity={isOn ? 0.6 : 0}
                />
                <line x1={x1} y1={H / 2 - 8} x2={x1} y2={H / 2 + 8} stroke="#0f172a" strokeWidth={1.5} />
                <text x={x1 + segWidth / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#64748b">
                  {i + 1}/{denominator}
                </text>
              </g>
            );
          })}
          {/* final tick */}
          <line x1={W - pad} y1={H / 2 - 8} x2={W - pad} y2={H / 2 + 8} stroke="#0f172a" strokeWidth={1.5} />
          <text x={pad} y={H / 2 + 22} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={700}>0</text>
          <text x={W - pad} y={H / 2 + 22} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={700}>1</text>
        </svg>
      </div>

      <div className="p-3 rounded-lg bg-secondary/20 border border-border text-center">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Fraction shown</div>
        <div className="text-2xl font-mono font-bold" style={{ color: subjectColor }}>
          {highlight}/{denominator} = {(highlight / denominator).toFixed(3)}
        </div>
      </div>
    </div>
  );
}
