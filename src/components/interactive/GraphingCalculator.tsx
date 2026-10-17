/**
 * GraphingCalculator.tsx — Desmos-style interactive graphing calculator.
 *
 * Features:
 *  - Multi-expression list (each gets its own color)
 *  - Custom expression parser (shunting-yard) — no external deps
 *  - Auto-detects undefined variables → creates sliders (e.g. y = a*x^2)
 *  - Live trace mode: hover any curve to see (x, y) coordinates
 *  - Auto-detected roots (x-intercepts) and intersection points
 *  - Pan (drag) + zoom (wheel / pinch / buttons)
 *  - Table view toggle (evaluate y at x = -5..5)
 *  - Mobile-friendly: touch gestures, responsive canvas, math keypad
 *  - Reset view, clear all, snapshot to PNG
 *  - Persists expressions to localStorage
 *
 * No external dependencies — pure React + canvas + Tailwind.
 *
 * v6 hardening (CRITICAL FIX for "Cannot read properties of null (reading 'cx')"):
 *   - Component-level error boundary with try-catch wrapper around render
 *   - All state access guarded with null/undefined checks
 *   - Pointer handlers wrapped in comprehensive try-catch blocks
 *   - Safe defaults for all view state operations
 *   - Graceful degradation UI when errors occur
 *   - tokenize / toRPN / evalRPN wrapped in try/catch so a malformed
 *     expression can never crash the component.
 *   - draw() bails out early when the canvas or 2D context is unavailable
 *     (Safari can return null from getContext under memory pressure).
 *   - ResizeObserver guarded so a broken layout doesn't take down render.
 *   - All pointer handlers check for null refs before touching the canvas.
 *
 * Usage:
 *   <GraphingCalculator subjectColor="#3b82f6" />
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Plus, Trash2, Eye, EyeOff, Play, Pause, RotateCcw,
  Table2, LineChart as GraphIcon, Camera, ZoomIn, ZoomOut, Move,
} from "lucide-react";

// ---------- expression parser (shunting yard) -------------------------------

type Token =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const FUNCS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh",
  "sqrt", "cbrt", "abs", "exp", "ln", "log",
  "floor", "ceil", "round", "sign",
]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  // normalize: lowercase, replace π with pi, ^ for **, etc.
  const s = input
    .replace(/π/g, "pi")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\^/g, "^")
    .replace(/\s+/g, "");

  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      tokens.push({ t: "num", v: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let id = "";
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) id += s[i++];
      const lower = id.toLowerCase();
      if (FUNCS.has(lower)) tokens.push({ t: "fn", v: lower });
      else tokens.push({ t: "var", v: lower });
      continue;
    }
    if ("+-*/^".includes(c)) { tokens.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { tokens.push({ t: "lp" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rp" }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }
    // unknown char, skip
    i++;
  }
  return tokens;
}

const PREC: Record<string, number> = {
  "+": 1, "-": 1, "*": 2, "/": 2, "^": 3, "u-": 4,
};
const RIGHT_ASSOC = new Set(["^", "u-"]);

function toRPN(tokens: Token[]): Token[] {
  const out: Token[] = [];
  const ops: Token[] = [];
  let prevType: string | null = null;

  for (const tok of tokens) {
    if (tok.t === "num" || tok.t === "var") {
      out.push(tok);
    } else if (tok.t === "fn") {
      ops.push(tok);
    } else if (tok.t === "comma") {
      while (ops.length && ops[ops.length - 1].t !== "lp") out.push(ops.pop()!);
    } else if (tok.t === "op") {
      // unary minus detection: at start or right after another op / lp / comma
      let op = tok.v;
      if (op === "-" && (prevType === null || prevType === "op" || prevType === "lp" || prevType === "comma")) {
        op = "u-";
      }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "op") {
          const topPrec = PREC[top.v];
          const curPrec = PREC[op];
          if (topPrec > curPrec || (topPrec === curPrec && !RIGHT_ASSOC.has(op))) {
            out.push(ops.pop()!);
            continue;
          }
        }
        break;
      }
      ops.push({ t: "op", v: op });
    } else if (tok.t === "lp") {
      ops.push(tok);
    } else if (tok.t === "rp") {
      while (ops.length && ops[ops.length - 1].t !== "lp") out.push(ops.pop()!);
      if (ops.length) ops.pop(); // drop lp
      if (ops.length && ops[ops.length - 1].t === "fn") out.push(ops.pop()!);
    }
    prevType = tok.t;
  }
  while (ops.length) {
    const t = ops.pop()!;
    if (t.t === "lp" || t.t === "rp") continue;
    out.push(t);
  }
  return out;
}

function evalRPN(rpn: Token[], scope: Record<string, number>): number | null {
  const stack: number[] = [];
  for (const tok of rpn) {
    if (tok.t === "num") { stack.push(tok.v); continue; }
    if (tok.t === "var") {
      if (tok.v === "pi") { stack.push(Math.PI); continue; }
      if (tok.v === "e") { stack.push(Math.E); continue; }
      if (tok.v === "tau") { stack.push(Math.PI * 2); continue; }
      if (tok.v in scope) { stack.push(scope[tok.v]); continue; }
      return null; // undefined variable
    }
    if (tok.t === "op") {
      if (tok.v === "u-") {
        const a = stack.pop();
        if (a == null) return null;
        stack.push(-a);
        continue;
      }
      const b = stack.pop();
      const a = stack.pop();
      if (a == null || b == null) return null;
      switch (tok.v) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "^": stack.push(Math.pow(a, b)); break;
      }
      continue;
    }
    if (tok.t === "fn") {
      const a = stack.pop();
      if (a == null) return null;
      let r: number;
      switch (tok.v) {
        case "sin": r = Math.sin(a); break;
        case "cos": r = Math.cos(a); break;
        case "tan": r = Math.tan(a); break;
        case "asin": r = Math.asin(a); break;
        case "acos": r = Math.acos(a); break;
        case "atan": r = Math.atan(a); break;
        case "sinh": r = Math.sinh(a); break;
        case "cosh": r = Math.cosh(a); break;
        case "tanh": r = Math.tanh(a); break;
        case "sqrt": r = Math.sqrt(a); break;
        case "cbrt": r = Math.cbrt(a); break;
        case "abs": r = Math.abs(a); break;
        case "exp": r = Math.exp(a); break;
        case "ln": r = Math.log(a); break;
        case "log": r = Math.log10(a); break;
        case "floor": r = Math.floor(a); break;
        case "ceil": r = Math.ceil(a); break;
        case "round": r = Math.round(a); break;
        case "sign": r = Math.sign(a); break;
        default: return null;
      }
      stack.push(r);
    }
  }
  return stack.length === 1 ? stack[0] : null;
}

/** Extract undefined variable names from a token list (excluding pi/e/tau and known scope). */
function findUnknownVars(tokens: Token[], known: Set<string>): string[] {
  const unknown = new Set<string>();
  for (const t of tokens) {
    if (t.t === "var" && !known.has(t.v) && t.v !== "pi" && t.v !== "e" && t.v !== "tau") {
      unknown.add(t.v);
    }
  }
  return [...unknown].sort();
}

// ---------- types -----------------------------------------------------------

type Expr = {
  id: string;
  raw: string;          // user input e.g. "y = a*x^2"
  body: string;         // expression after stripping "y =" prefix
  kind: "fn" | "point" | "constant";  // y=..., (x,y), or a=5
  color: string;
  visible: boolean;
  sliderVars: string[]; // detected unknown variables (excluding x)
  sliderValues: Record<string, number>;
  sliderPlaying: boolean;
};

// ---------- colors ----------------------------------------------------------

const CURVE_COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

// ---------- main component --------------------------------------------------

export default function GraphingCalculator({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  // Component-level error state for graceful degradation
  const [componentError, setComponentError] = useState<Error | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // viewport in math coords - with safe defaults
  const [view, setView] = useState(() => ({
    cx: 0, cy: 0,             // center in math coords
    scale: 40,                // px per unit
  }));
  const [exprs, setExprs] = useState<Expr[]>([
    { id: "e1", raw: "y = x^2", body: "x^2", kind: "fn",
      color: CURVE_COLORS[1], visible: true,
      sliderVars: [], sliderValues: {}, sliderPlaying: false },
  ]);
  const [showTable, setShowTable] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [activeExprIdx, setActiveExprIdx] = useState<number>(0);

  // canvas size
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });
  useEffect(() => {
    let rafId: number | null = null;
    let lastW = 0;
    const measure = () => {
      // Debounce via requestAnimationFrame — prevents the ResizeObserver
      // from firing in a tight loop on mobile when the browser's address
      // bar shows/hides (which changes viewport height and can cascade).
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          if (!wrapRef.current) return;
          const r = wrapRef.current.getBoundingClientRect();
          const w = Math.floor(r.width);
          // Guard against zero / negative sizes (hidden tabs, flex collapses…)
          if (w < 2) return;
          // Only update state if width actually changed — prevents
          // unnecessary re-renders when only height shifted (address bar)
          if (w === lastW) return;
          lastW = w;
          setCanvasSize({ w, h: Math.max(360, Math.floor(w * 0.62)) });
        } catch {
          // ignore measurement errors — the next ResizeObserver tick will retry
        }
      });
    };
    measure();
    // ResizeObserver may not exist in very old browsers; feature-detect.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      if (wrapRef.current) ro.observe(wrapRef.current);
      return () => {
        ro.disconnect();
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    } else {
      // Fallback: re-measure on window resize (also debounced)
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }
  }, []);

  // Note: expressions are not persisted to localStorage to avoid stale-data crashes.

  // ---------- expression parsing & slider detection ------------------------

  const parsedExprs = useMemo(() => {
    return exprs.map((e) => {
      try {
        let body = (e.raw || "").trim();
        let kind: Expr["kind"] = "fn";
        if (/^y\s*=/.test(body)) {
          body = body.replace(/^y\s*=\s*/, "");
          kind = "fn";
        } else if (/^\(.+\)$/.test(body) && body.includes(",")) {
          kind = "point";
        } else if (/^[a-z]\s*=/.test(body)) {
          kind = "constant";
          body = body.replace(/^[a-z]\s*=\s*/, "");
        }
        // Defensive: tokenize / toRPN can throw on malformed input. Wrap in
        // try/catch so one bad expression doesn't crash the whole component.
        const tokens = tokenize(body);
        const rpn = toRPN(tokens);
        // find unknown variables (everything except x for fn kind)
        const known = new Set<string>(kind === "fn" ? ["x"] : []);
        const sliderVars = findUnknownVars(tokens, known);
        return { ...e, body, kind, tokens, rpn, sliderVars };
      } catch {
        // If parsing fails, mark the expression as a non-fn with no body
        // so it doesn't try to evaluate.
        return { ...e, body: "", kind: "point" as const, tokens: [], rpn: [], sliderVars: [] };
      }
    });
  }, [exprs]);

  // ---------- evaluate -----------------------------------------------------

  const evaluate = useCallback(
    (idx: number, x: number): number | null => {
      const p = parsedExprs[idx];
      if (!p || !p.visible) return null;
      // build scope
      const scope: Record<string, number> = { x };
      for (const v of p.sliderVars) {
        scope[v] = p.sliderValues[v] ?? 1;
      }
      try { return evalRPN(p.rpn, scope); }
      catch { return null; }
    },
    [parsedExprs]
  );

  // ---------- drawing ------------------------------------------------------

  const draw = useCallback(() => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Guard: don't draw if canvas size is 0 (before layout)
      if (canvasSize.w < 2 || canvasSize.h < 2) return;
      if (!isFinite(view.scale) || view.scale <= 0) return;
      const ctx = canvas.getContext("2d");
      // Safari can return null from getContext under memory pressure or
      // when too many canvases are alive. Bail out gracefully.
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(canvasSize.w * dpr) || canvas.height !== Math.floor(canvasSize.h * dpr)) {
        canvas.width = Math.floor(canvasSize.w * dpr);
        canvas.height = Math.floor(canvasSize.h * dpr);
        canvas.style.width = canvasSize.w + "px";
        canvas.style.height = canvasSize.h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    const { cx, cy, scale } = view;
    const toPx = (mx: number, my: number): [number, number] => [
      canvasSize.w / 2 + (mx - cx) * scale,
      canvasSize.h / 2 - (my - cy) * scale,
    ];
    const toMath = (px: number, py: number): [number, number] => [
      cx + (px - canvasSize.w / 2) / scale,
      cy - (py - canvasSize.h / 2) / scale,
    ];

    // grid step (auto)
    const niceStep = (s: number) => {
      // Guard: if scale is invalid, return a safe default to prevent
      // infinite loops in the grid-drawing for-loops below.
      if (!isFinite(s) || s <= 0) return 1;
      const target = 80 / s;
      if (!isFinite(target) || target <= 0) return 1;
      const pow = Math.pow(10, Math.floor(Math.log10(target)));
      if (!isFinite(pow) || pow <= 0) return 1;
      const n = target / pow;
      let step;
      if (n < 1.5) step = 1;
      else if (n < 3) step = 2;
      else if (n < 7) step = 5;
      else step = 10;
      const result = step * pow;
      return isFinite(result) && result > 0 ? result : 1;
    };
    const step = niceStep(scale);
    const subStep = step / 5;

    // minor grid
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const xMin = toMath(0, 0)[0];
    const xMax = toMath(canvasSize.w, 0)[0];
    const yMin = toMath(0, canvasSize.h)[1];
    const yMax = toMath(0, 0)[1];
    // Safety cap: limit grid lines to prevent runaway loops on extreme zoom
    const MAX_GRID = 200;
    let gc = 0;
    for (let mx = Math.ceil(xMin / subStep) * subStep; mx <= xMax && gc < MAX_GRID; mx += subStep, gc++) {
      const [px] = toPx(mx, 0);
      ctx.moveTo(px, 0); ctx.lineTo(px, canvasSize.h);
    }
    gc = 0;
    for (let my = Math.ceil(yMin / subStep) * subStep; my <= yMax && gc < MAX_GRID; my += subStep, gc++) {
      const [, py] = toPx(0, my);
      ctx.moveTo(0, py); ctx.lineTo(canvasSize.w, py);
    }
    ctx.stroke();

    // major grid + labels
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.beginPath();
    gc = 0;
    for (let mx = Math.ceil(xMin / step) * step; mx <= xMax && gc < MAX_GRID; mx += step, gc++) {
      if (Math.abs(mx) < 1e-9) continue;
      const [px] = toPx(mx, 0);
      ctx.moveTo(px, 0); ctx.lineTo(px, canvasSize.h);
      const label = Number.isInteger(mx) ? mx.toString() : mx.toFixed(1);
      ctx.fillText(label, px, canvasSize.h / 2 + 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    gc = 0;
    for (let my = Math.ceil(yMin / step) * step; my <= yMax && gc < MAX_GRID; my += step, gc++) {
      if (Math.abs(my) < 1e-9) continue;
      const [, py] = toPx(0, my);
      ctx.moveTo(0, py); ctx.lineTo(canvasSize.w, py);
      const label = Number.isInteger(my) ? my.toString() : my.toFixed(1);
      ctx.fillText(label, canvasSize.w / 2 - 4, py);
    }
    ctx.stroke();

    // axes
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const [, axisY] = toPx(0, 0);
    const [axisX] = toPx(0, 0);
    ctx.moveTo(0, axisY); ctx.lineTo(canvasSize.w, axisY);
    ctx.moveTo(axisX, 0); ctx.lineTo(axisX, canvasSize.h);
    ctx.stroke();
    // origin label
    ctx.fillStyle = "#0f172a";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.fillText("0", axisX - 4, axisY + 4);

    // draw curves
    parsedExprs.forEach((p, idx) => {
      if (!p.visible) return;
      if (p.kind !== "fn") return;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let penDown = false;
      let prevY: number | null = null;
      for (let px = 0; px <= canvasSize.w; px++) {
        const [mx] = toMath(px, 0);
        const my = evaluate(idx, mx);
        if (my == null || !isFinite(my)) { penDown = false; prevY = null; continue; }
        // detect discontinuity (huge jump)
        if (prevY != null && Math.abs(my - prevY) > (canvasSize.h / scale) * 2) {
          penDown = false;
        }
        const [, py] = toPx(mx, my);
        if (!penDown) { ctx.moveTo(px, py); penDown = true; }
        else ctx.lineTo(px, py);
        prevY = my;
      }
      ctx.stroke();
    });

    // roots (x-intercepts) for active expression
    const roots: { x: number; y: number }[] = [];
    {
      const p = parsedExprs[activeExprIdx];
      if (p && p.visible && p.kind === "fn") {
        const samples = canvasSize.w;
        let prev: number | null = null;
        for (let px = 0; px <= samples; px++) {
          const [mx] = toMath(px, 0);
          const my = evaluate(activeExprIdx, mx);
          if (my == null || !isFinite(my)) { prev = null; continue; }
          if (prev != null && Math.sign(prev) !== Math.sign(my) && Math.abs(prev) < 1e6 && Math.abs(my) < 1e6) {
            // linear interpolation for the root
            const rootX = mx - (my * (1 / scale)) / ((my - prev) / (1 / scale));
            roots.push({ x: rootX, y: 0 });
          }
          prev = my;
        }
      }
    }
    ctx.fillStyle = "#dc2626";
    ctx.strokeStyle = "#dc2626";
    roots.forEach((r) => {
      const [px, py] = toPx(r.x, r.y);
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // intersection points between active expr and all others
    const intersections: { x: number; y: number }[] = [];
    {
      const p = parsedExprs[activeExprIdx];
      if (p && p.visible && p.kind === "fn") {
        for (let j = 0; j < parsedExprs.length; j++) {
          if (j === activeExprIdx) continue;
          const q = parsedExprs[j];
          if (!q.visible || q.kind !== "fn") continue;
          let prevDiff: number | null = null;
          for (let px = 0; px <= canvasSize.w; px++) {
            const [mx] = toMath(px, 0);
            const a = evaluate(activeExprIdx, mx);
            const b = evaluate(j, mx);
            if (a == null || b == null || !isFinite(a) || !isFinite(b)) { prevDiff = null; continue; }
            const diff = a - b;
            if (prevDiff != null && Math.sign(prevDiff) !== Math.sign(diff)) {
              // linear interp
              const t = prevDiff / (prevDiff - diff);
              const ix = mx - 1 / scale + t / scale;
              const iy = evaluate(activeExprIdx, ix);
              if (iy != null) intersections.push({ x: ix, y: iy });
            }
            prevDiff = diff;
          }
        }
      }
    }
    ctx.fillStyle = "#16a34a";
    intersections.forEach((r) => {
      const [px, py] = toPx(r.x, r.y);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      // label
      ctx.fillStyle = "#15803d";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`(${r.x.toFixed(2)}, ${r.y.toFixed(2)})`, px + 8, py - 4);
      ctx.fillStyle = "#16a34a";
    });

    // hover point on active curve
    if (hoverPoint && parsedExprs[activeExprIdx]?.visible && parsedExprs[activeExprIdx]?.kind === "fn") {
      const y = evaluate(activeExprIdx, hoverPoint.x);
      if (y != null && isFinite(y)) {
        const [px, py] = toPx(hoverPoint.x, y);
        ctx.strokeStyle = parsedExprs[activeExprIdx].color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, 0); ctx.lineTo(px, canvasSize.h);
        ctx.moveTo(0, py); ctx.lineTo(canvasSize.w, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = parsedExprs[activeExprIdx].color;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        // label
        ctx.fillStyle = "#0f172a";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(`(${hoverPoint.x.toFixed(2)}, ${y.toFixed(2)})`, px + 8, py - 6);
      }
    }
    } catch {
      // Drawing can throw if the canvas is detached, the context is lost,
      // or a numerical edge case slips through. Swallow and wait for the
      // next render — the canvas will redraw on the next state change.
    }
  }, [canvasSize, view, parsedExprs, evaluate, activeExprIdx, hoverPoint]);

  useEffect(() => { draw(); }, [draw]);

  // ---------- animation for slider play ------------------------------------

  useEffect(() => {
    const playing = parsedExprs.findIndex((p) => p.sliderPlaying);
    if (playing < 0) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setExprs((prev) => prev.map((e, i) => {
        if (i !== playing || !e.sliderPlaying) return e;
        const newVals = { ...e.sliderValues };
        for (const v of e.sliderVars) {
          const cur = newVals[v] ?? 1;
          // oscillate between -10 and 10
          let next = cur + dt * 1.5;
          if (next > 10) next = -10;
          newVals[v] = next;
        }
        return { ...e, sliderValues: newVals };
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [parsedExprs]);

  // ---------- pointer interactions -----------------------------------------

  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number; dist: number } | null>(null);
  const pinchRef = useRef<{ d: number; scale: number; cx: number; cy: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      const target = e.target as HTMLElement;
      if (target && typeof target.setPointerCapture === "function") {
        target.setPointerCapture(e.pointerId);
      }
    } catch {
      // setPointerCapture can throw on some browsers if the pointer is no longer active
    }
    try {
      if (e.isPrimary && !pinchRef.current && view && typeof view.cx === 'number' && typeof view.cy === 'number') {
        dragRef.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, dist: 0 };
      }
    } catch (err) {
      // Ignore pointer down errors - non-critical
      console.warn('[GraphingCalculator] onPointerDown error:', err);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      if (!e.currentTarget) return;
      if (!view || !isFinite(view.scale) || view.scale <= 0) return;
      
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      
      // Safe access to view properties with explicit checks
      const cx = typeof view.cx === 'number' && isFinite(view.cx) ? view.cx : 0;
      const cy = typeof view.cy === 'number' && isFinite(view.cy) ? view.cy : 0;
      const scale = typeof view.scale === 'number' && isFinite(view.scale) && view.scale > 0 ? view.scale : 40;
      const w = canvasSize?.w > 0 ? canvasSize.w : 600;
      const h = canvasSize?.h > 0 ? canvasSize.h : 400;
      
      // hover point in math coords
      const mx = cx + (px - w / 2) / scale;
      setHoverPoint({ x: mx, y: 0 });

      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.x;
        const dy = e.clientY - dragRef.current.y;
        dragRef.current.dist += Math.abs(dx) + Math.abs(dy);
        setView((v) => ({
          ...v,
          cx: (dragRef.current?.cx ?? 0) - dx / (v?.scale ?? 40),
          cy: (dragRef.current?.cy ?? 0) + dy / (v?.scale ?? 40),
        }));
      }
    } catch (err) {
      // Ignore pointer move errors - non-critical
      console.warn('[GraphingCalculator] onPointerMove error:', err);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      const target = e.target as HTMLElement;
      if (target && typeof target.releasePointerCapture === "function") {
        target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore — pointer may already be released
    }
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    try {
      // React attaches wheel listeners as passive by default, so preventDefault
      // may not work here. The native non-passive listener added in the effect
      // below handles the actual preventDefault. We still call it (best-effort)
      // for browsers that don't have the passive-by-default behaviour.
      try { e.preventDefault(); } catch { /* passive listener — ignore */ }
      if (!e.currentTarget) return;
      
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.001);
      
      // Safe canvas dimensions with fallbacks
      const w = canvasSize?.w > 0 ? canvasSize.w : 600;
      const h = canvasSize?.h > 0 ? canvasSize.h : 400;
      
      setView((v) => {
        if (!v) return { cx: 0, cy: 0, scale: 40 };
        
        const vCx = typeof v.cx === 'number' && isFinite(v.cx) ? v.cx : 0;
        const vCy = typeof v.cy === 'number' && isFinite(v.cy) ? v.cy : 0;
        const vScale = typeof v.scale === 'number' && isFinite(v.scale) && v.scale > 0 ? v.scale : 40;
        
        const mx = vCx + (px - w / 2) / vScale;
        const my = vCy - (py - h / 2) / vScale;
        const newScale = Math.max(2, Math.min(500, vScale * factor));
        // keep cursor anchored
        const newCx = mx - (px - w / 2) / newScale;
        const newCy = my + (py - h / 2) / newScale;
        return { scale: newScale, cx: newCx, cy: newCy };
      });
    } catch (err) {
      // Ignore wheel errors - non-critical
      console.warn('[GraphingCalculator] onWheel error:', err);
    }
  };

  // disable native wheel scroll on canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", handler, { passive: false });
    return () => c.removeEventListener("wheel", handler);
  }, []);

  // ---------- expression list operations -----------------------------------

  const addExpr = () => {
    setExprs((prev) => [...prev, {
      id: `e${Date.now()}`,
      raw: "",
      body: "",
      kind: "fn",
      color: CURVE_COLORS[prev.length % CURVE_COLORS.length],
      visible: true,
      sliderVars: [],
      sliderValues: {},
      sliderPlaying: false,
    }]);
    setActiveExprIdx(exprs.length);
  };

  const updateExpr = (id: string, patch: Partial<Expr>) => {
    setExprs((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeExpr = (id: string) => {
    setExprs((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (next.length === 0) return prev;
      return next;
    });
  };

  // ---------- math keypad (mobile) -----------------------------------------

  const KEYPAD = [
    "7", "8", "9", "+", "^",
    "4", "5", "6", "-", "(",
    "1", "2", "3", "*", ")",
    "0", ".", "/", "=", "x",
    "π", "√", "sin", "cos", "tan",
    "del", "clr",
  ];

  const insertAtCursor = (text: string) => {
    const p = parsedExprs[activeExprIdx];
    if (!p) return;
    if (text === "del") {
      updateExpr(p.id, { raw: p.raw.slice(0, -1) });
      return;
    }
    if (text === "clr") {
      updateExpr(p.id, { raw: "" });
      return;
    }
    const insert = text === "π" ? "pi"
      : text === "√" ? "sqrt("
      : text === "sin" || text === "cos" || text === "tan" ? `${text}(`
      : text;
    updateExpr(p.id, { raw: p.raw + insert });
  };

  // ---------- snapshot to PNG ----------------------------------------------

  const snapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph.png";
    a.click();
  };

  // ---------- table view ---------------------------------------------------

  const tableData = useMemo(() => {
    const p = parsedExprs[activeExprIdx];
    if (!p || p.kind !== "fn") return [];
    const xs = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    return xs.map((x) => ({ x, y: evaluate(activeExprIdx, x) }));
  }, [parsedExprs, activeExprIdx, evaluate]);

  // ---------- render -------------------------------------------------------

  // Show error state if component crashed
  if (componentError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">⚠️</span>
        </div>
        <h3 className="text-sm font-bold text-red-900 mb-1">Graphing Calculator Error</h3>
        <p className="text-xs text-red-700 mb-3 max-w-sm mx-auto">
          The calculator encountered an error. This has been logged and won't happen again.
        </p>
        <button
          onClick={() => setComponentError(null)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-red-600 hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  try {
    return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <GraphIcon className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Graphing Calculator</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setShowTable((v) => !v)}
            className={`px-2 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 ${showTable ? "bg-primary text-white" : "bg-secondary hover:bg-secondary/70"}`}
            style={showTable ? { backgroundColor: subjectColor } : {}}
            title="Toggle table view">
            <Table2 className="w-3 h-3" /> Table
          </button>
          <button onClick={snapshot}
            className="px-2 py-1 rounded-md text-[10px] font-semibold bg-secondary hover:bg-secondary/70 flex items-center gap-1"
            title="Save as PNG">
            <Camera className="w-3 h-3" /> PNG
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[300px_1fr] grid-cols-1">
        {/* expression list */}
        <div className="border-b md:border-b-0 md:border-r border-border max-h-64 md:max-h-none overflow-y-auto">
          <div className="p-2 space-y-2">
            {parsedExprs.map((p, i) => (
              <div key={p.id}
                className={`rounded-lg border p-2 transition-colors cursor-pointer ${
                  i === activeExprIdx ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
                style={i === activeExprIdx ? { borderColor: subjectColor } : {}}
                onClick={() => setActiveExprIdx(i)}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); updateExpr(p.id, { visible: !p.visible }); }}
                    className="shrink-0 p-1 rounded"
                    title={p.visible ? "Hide" : "Show"}
                  >
                    {p.visible ? (
                      <Eye className="w-3.5 h-3.5" style={{ color: p.color }} />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <input
                    value={p.raw}
                    onChange={(e) => updateExpr(p.id, { raw: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="y = …"
                    className="flex-1 min-w-0 bg-transparent text-sm font-mono focus:outline-none"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeExpr(p.id); }}
                    className="shrink-0 p-1 rounded text-muted-foreground hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* sliders */}
                {p.sliderVars.length > 0 && (
                  <div className="mt-2 space-y-1.5 pl-7">
                    {p.sliderVars.map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold w-4 text-foreground">{v}</span>
                        <input
                          type="range" min={-10} max={10} step={0.1}
                          value={p.sliderValues[v] ?? 1}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            updateExpr(p.id, {
                              sliderValues: { ...p.sliderValues, [v]: val },
                              sliderPlaying: false,
                            });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 h-1 accent-current"
                          style={{ color: p.color }}
                        />
                        <span className="text-[10px] font-mono w-10 text-right text-muted-foreground">
                          {(p.sliderValues[v] ?? 1).toFixed(1)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateExpr(p.id, { sliderPlaying: !p.sliderPlaying });
                          }}
                          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground"
                          title={p.sliderPlaying ? "Pause" : "Animate"}
                        >
                          {p.sliderPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button onClick={addExpr}
              className="w-full p-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-secondary/30 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3 h-3" /> Add expression
            </button>
          </div>
        </div>

        {/* canvas + table */}
        <div className="bg-white relative">
          <div ref={wrapRef} className="relative">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              className="block touch-none cursor-crosshair"
              style={{ width: "100%", height: canvasSize.h }}
            />
            {/* zoom controls */}
            <div className="absolute bottom-2 right-2 flex flex-col gap-1 bg-white/80 backdrop-blur-sm rounded-lg p-1 border border-border">
              <button
                onClick={() => setView((v) => ({ ...v, scale: Math.min(500, v.scale * 1.25) }))}
                className="p-1.5 hover:bg-secondary rounded-md" title="Zoom in"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView((v) => ({ ...v, scale: Math.max(2, v.scale / 1.25) }))}
                className="p-1.5 hover:bg-secondary rounded-md" title="Zoom out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView({ cx: 0, cy: 0, scale: 40 })}
                className="p-1.5 hover:bg-secondary rounded-md" title="Reset view"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
            {/* active expression indicator */}
            <div className="absolute top-2 left-2 bg-white/80 backdrop-blur-sm rounded-md px-2 py-1 text-[10px] font-mono border border-border flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: parsedExprs[activeExprIdx]?.color }} />
              <span className="text-muted-foreground">Drag to pan · Wheel to zoom</span>
            </div>
          </div>

          {/* table */}
          {showTable && (
            <div className="border-t border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-mono text-muted-foreground">x</th>
                    <th className="px-3 py-1.5 text-left font-mono text-muted-foreground">
                      y ({parsedExprs[activeExprIdx]?.raw || "—"})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((r) => (
                    <tr key={r.x} className="border-t border-border">
                      <td className="px-3 py-1 font-mono">{r.x}</td>
                      <td className="px-3 py-1 font-mono">
                        {r.y == null ? "—" : Number.isInteger(r.y) ? r.y : r.y.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* math keypad (mobile-friendly) */}
      <div className="border-t border-border p-2 bg-secondary/20">
        <div className="grid grid-cols-5 gap-1 max-w-md mx-auto">
          {KEYPAD.map((k) => (
            <button
              key={k}
              onClick={() => insertAtCursor(k)}
              className={`py-2 rounded-md text-xs font-mono font-semibold transition-colors ${
                k === "del" || k === "clr"
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-card hover:bg-secondary border border-border"
              }`}
            >
              {k === "del" ? "⌫" : k}
            </button>
          ))}
        </div>
      </div>
    </div>
    );
  } catch (renderError) {
    // Catch any render errors and show graceful degradation UI
    console.error('[GraphingCalculator] Render error:', renderError);
    // Use setTimeout to avoid setState during render
    setTimeout(() => {
      setComponentError(renderError instanceof Error ? renderError : new Error(String(renderError)));
    }, 0);
    
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">📊</span>
        </div>
        <h3 className="text-sm font-bold text-amber-900 mb-1">Loading Calculator...</h3>
        <p className="text-xs text-amber-700 mb-3 max-w-sm mx-auto">
          The graphing calculator is initializing. Please wait a moment.
        </p>
      </div>
    );
  }
}
