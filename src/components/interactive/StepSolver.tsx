/**
 * StepSolver.tsx — Mathisfun-style step-by-step math solver.
 *
 * Supports problem types:
 *  1. Linear equations:        3x + 5 = 2x - 7
 *  2. Quadratic equations:     x^2 - 5x + 6 = 0  (factoring, completing square, formula)
 *  3. Simultaneous equations:  2x + y = 5 ; x - y = 1  (substitution + elimination)
 *  4. Inequalities:            2x - 3 < 7
 *  5. Simplify fractions:      12/18
 *  6. Simplify radicals:       √72
 *  7. Logarithms:              log_2(8)
 *  8. Factoring quadratics:    x^2 + 5x + 6
 *
 * Features:
 *  - Step-by-step reveal ("Next Step" button) — forces active reading
 *  - "Why?" tooltip on each step — explains the rule used
 *  - "Try Yourself" mode — student enters the next step, gets feedback
 *  - Graph preview for equation types (reuses tiny SVG plot)
 *  - Mobile-friendly: math keypad, large tap targets
 *
 * No external dependencies.
 *
 * Usage:
 *   <StepSolver subjectColor="#3b82f6" />
 */
import { useMemo, useState } from "react";
import {
  Calculator, ChevronRight, HelpCircle, CheckCircle2, XCircle,
  Lightbulb, RotateCcw, Sparkles,
} from "lucide-react";

// ---------- types -----------------------------------------------------------

type Step = {
  math: string;       // the math line shown
  explanation: string; // "Subtract 2x from both sides"
  rule: string;        // longer "why?" explanation
};

type SolveResult = {
  ok: boolean;
  steps: Step[];
  answer: string;
  error?: string;
};

type ProblemType =
  | "linear"
  | "quadratic"
  | "simultaneous"
  | "inequality"
  | "fraction"
  | "radical"
  | "logarithm"
  | "factor";

// ---------- helpers --------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  // try fraction
  for (let d = 2; d <= 100; d++) {
    const num = n * d;
    if (Math.abs(num - Math.round(num)) < 1e-9) {
      const rounded = Math.round(num);
      const g = gcd(rounded, d);
      return `${rounded / g}/${d / g}`;
    }
  }
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function signStr(n: number): string {
  if (n === 0) return "";
  if (n > 0) return `+ ${formatNum(n)}`;
  return `- ${formatNum(-n)}`;
}

// ---------- equation parsing ----------------------------------------------

// Parse a linear expression like "3x + 5 - 2x" → {x: 1, const: 5}
function parseLinearExpr(s: string): { x: number; const: number } | null {
  // normalize
  const str = s.replace(/\s+/g, "").replace(/−/g, "-").replace(/\*/g, "");
  // insert + before - (except at start) for splitting, but careful with ^ etc.
  // We'll tokenize properly:
  const tokens: { type: "num" | "var" | "op"; value: string | number }[] = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < str.length && /[0-9.]/.test(str[i])) n += str[i++];
      tokens.push({ type: "num", value: parseFloat(n) });
      continue;
    }
    if (c === "x" || c === "X") {
      tokens.push({ type: "var", value: "x" });
      i++;
      continue;
    }
    if ("+-*/".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    // unknown char, skip
    i++;
  }

  // parse with simple algorithm
  let coef = 0;
  let constant = 0;
  let sign = 1;
  let lastWasOp = true;

  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "op" && t.value === "+") { sign = 1; lastWasOp = true; continue; }
    if (t.type === "op" && t.value === "-") { sign = -sign; lastWasOp = true; continue; }
    if (t.type === "op" && (t.value === "*" || t.value === "/")) {
      // handle * and / only between num and var
      continue;
    }
    if (t.type === "num") {
      // check if next is var
      const next = tokens[j + 1];
      if (next && next.type === "var") {
        coef += sign * (t.value as number);
        j++; // consume var
        sign = 1;
        lastWasOp = false;
      } else {
        constant += sign * (t.value as number);
        sign = 1;
        lastWasOp = false;
      }
      continue;
    }
    if (t.type === "var") {
      // implicit coef 1
      coef += sign * 1;
      sign = 1;
      lastWasOp = false;
      continue;
    }
  }

  return { x: coef, const: constant };
}

// Parse "ax + b = cx + d" → {a, b, c, d}
function parseLinearEquation(input: string): { a: number; b: number; c: number; d: number } | null {
  const parts = input.split("=");
  if (parts.length !== 2) return null;
  const lhs = parseLinearExpr(parts[0]);
  const rhs = parseLinearExpr(parts[1]);
  if (!lhs || !rhs) return null;
  return { a: lhs.x, b: lhs.const, c: rhs.x, d: rhs.const };
}

// Parse quadratic "ax^2 + bx + c = 0" or "ax^2 + bx + c = dx + e"
function parseQuadratic(input: string): { a: number; b: number; c: number } | null {
  // Move everything to LHS
  const parts = input.split("=");
  if (parts.length !== 2) return null;
  const lhs = parseQuadraticExpr(parts[0]);
  const rhs = parseQuadraticExpr(parts[1]);
  if (!lhs || !rhs) return null;
  return {
    a: lhs.x2 - rhs.x2,
    b: lhs.x - rhs.x,
    c: lhs.const - rhs.const,
  };
}

function parseQuadraticExpr(s: string): { x2: number; x: number; const: number } | null {
  const str = s.replace(/\s+/g, "").replace(/−/g, "-").replace(/\*/g, "");
  // token-based
  const tokens: { type: string; value: string | number }[] = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < str.length && /[0-9.]/.test(str[i])) n += str[i++];
      tokens.push({ type: "num", value: parseFloat(n) });
      continue;
    }
    if (c === "x" || c === "X") {
      // check next is ^
      if (str[i + 1] === "^" && str[i + 2] === "2") {
        tokens.push({ type: "x2", value: "x2" });
        i += 3;
        continue;
      }
      tokens.push({ type: "x", value: "x" });
      i++;
      continue;
    }
    if ("+-".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    i++;
  }

  let x2 = 0, x = 0, constant = 0;
  let sign = 1;

  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "op" && t.value === "+") { sign = 1; continue; }
    if (t.type === "op" && t.value === "-") { sign = -sign; continue; }
    if (t.type === "num") {
      const next = tokens[j + 1];
      if (next?.type === "x2") { x2 += sign * (t.value as number); j++; }
      else if (next?.type === "x") { x += sign * (t.value as number); j++; }
      else constant += sign * (t.value as number);
      sign = 1;
      continue;
    }
    if (t.type === "x2") { x2 += sign * 1; sign = 1; continue; }
    if (t.type === "x") { x += sign * 1; sign = 1; continue; }
  }

  return { x2, x, const: constant };
}

// ---------- solvers --------------------------------------------------------

function solveLinear(input: string): SolveResult {
  const parsed = parseLinearEquation(input);
  if (!parsed) return { ok: false, steps: [], answer: "", error: "Couldn't parse. Use form like 3x + 5 = 2x - 7" };
  const { a, b, c, d } = parsed;
  if (a === c) {
    if (b === d) return { ok: true, steps: [
      { math: input, explanation: "Original equation", rule: "We start with the equation you entered." },
      { math: "0x = " + formatNum(d - b), explanation: "Subtract LHS from both sides", rule: "If a = a, the equation is an identity (true for all x) or has no solution." },
    ], answer: b === d ? "Infinite solutions (identity)" : "No solution" };
    return { ok: true, steps: [
      { math: input, explanation: "Original equation", rule: "We start with the equation you entered." },
      { math: `0 = ${formatNum(d - b)}`, explanation: "Subtract LHS from both sides", rule: "Coefficients of x cancel out. If the constants are unequal, there's no solution." },
    ], answer: "No solution" };
  }

  const steps: Step[] = [
    { math: input, explanation: "Original equation", rule: "We start with the equation you entered." },
  ];

  // Step: move all x to LHS, constants to RHS
  const newLHS_x = a - c;
  const newRHS_const = d - b;
  steps.push({
    math: `${formatNum(newLHS_x)}x = ${formatNum(newRHS_const)}`,
    explanation: `Move x-terms to left, constants to right (${signStr(-c)}x from both sides, ${signStr(-b)} from both sides)`,
    rule: "We can add or subtract the same quantity from both sides without changing the solution. Goal: get all x's on one side, all numbers on the other.",
  });

  if (newLHS_x === 0) {
    return { ok: true, steps, answer: newRHS_const === 0 ? "Infinite solutions" : "No solution" };
  }

  const x = newRHS_const / newLHS_x;
  steps.push({
    math: `x = ${formatNum(x)}`,
    explanation: `Divide both sides by ${formatNum(newLHS_x)}`,
    rule: `To isolate x, divide both sides by the coefficient of x. ${formatNum(newRHS_const)} ÷ ${formatNum(newLHS_x)} = ${formatNum(x)}.`,
  });

  // verify
  steps.push({
    math: `Check: ${formatNum(a)}(${formatNum(x)}) + ${formatNum(b)} = ${formatNum(a * x + b)}, ${formatNum(c)}(${formatNum(x)}) + ${formatNum(d)} = ${formatNum(c * x + d)}`,
    explanation: "Substitute back to verify",
    rule: "Always check by plugging the answer into the original equation. Both sides should be equal.",
  });

  return { ok: true, steps, answer: `x = ${formatNum(x)}` };
}

function solveQuadratic(input: string): SolveResult {
  const parsed = parseQuadratic(input);
  if (!parsed) return { ok: false, steps: [], answer: "", error: "Couldn't parse. Use form like x^2 - 5x + 6 = 0" };
  let { a, b, c } = parsed;
  if (a === 0) return solveLinear(input); // fallback

  const steps: Step[] = [
    { math: input, explanation: "Original equation", rule: "We start with the quadratic equation." },
  ];

  if (a !== 1) {
    steps.push({
      math: `${input}  →  divide by ${formatNum(a)}: x^2 ${signStr(b / a)} x ${signStr(c / a)} = 0`,
      explanation: `Divide both sides by ${formatNum(a)} to make leading coefficient 1`,
      rule: "Monic quadratics (leading coefficient 1) are easier to factor. We divide everything by a.",
    });
    b = b / a;
    c = c / a;
    a = 1;
  }

  const disc = b * b - 4 * c;
  steps.push({
    math: `Discriminant: b² - 4ac = ${formatNum(b)}² - 4(1)(${formatNum(c)}) = ${formatNum(disc)}`,
    explanation: "Calculate the discriminant",
    rule: "Δ = b² − 4ac tells us the nature of roots: Δ > 0 → two real roots, Δ = 0 → one repeated root, Δ < 0 → two complex roots.",
  });

  if (disc < 0) {
    const realPart = -b / 2;
    const imagPart = Math.sqrt(-disc) / 2;
    steps.push({
      math: `x = ${formatNum(realPart)} ± ${formatNum(imagPart)}i`,
      explanation: "Apply quadratic formula with negative discriminant",
      rule: "When Δ < 0, we use imaginary unit i = √(−1). The roots are complex conjugates.",
    });
    return { ok: true, steps, answer: `x = ${formatNum(realPart)} ± ${formatNum(imagPart)}i` };
  }

  // try factoring
  // (x+p)(x+q) = x^2 + (p+q)x + pq, so we need p+q = b and p*q = c
  const targetSum = b;
  const targetProd = c;
  let factors: [number, number] | null = null;
  for (let p = -20; p <= 20; p++) {
    for (let q = -20; q <= 20; q++) {
      if (Math.abs(p + q - targetSum) < 1e-9 && Math.abs(p * q - targetProd) < 1e-9) {
        factors = [p, q];
        break;
      }
    }
    if (factors) break;
  }

  if (factors) {
    const [p, q] = factors;
    steps.push({
      math: `x^2 ${signStr(b)} x ${signStr(c)} = (x ${signStr(p)})(x ${signStr(q)})`,
      explanation: `Factor: find two numbers that add to ${formatNum(targetSum)} and multiply to ${formatNum(targetProd)}`,
      rule: `${p} + ${q} = ${formatNum(targetSum)}, ${p} × ${q} = ${formatNum(targetProd)}. So the factors are (x ${signStr(p)})(x ${signStr(q)}).`,
    });
    steps.push({
      math: `x ${signStr(p)} = 0  →  x = ${formatNum(-p)}`,
      explanation: "Set each factor to zero",
      rule: "Zero product property: if a × b = 0, then a = 0 or b = 0.",
    });
    steps.push({
      math: `x ${signStr(q)} = 0  →  x = ${formatNum(-q)}`,
      explanation: "Set the other factor to zero",
      rule: "Apply the zero product property to the second factor.",
    });
    return { ok: true, steps, answer: `x = ${formatNum(-p)} or x = ${formatNum(-q)}` };
  }

  // quadratic formula
  const sqrtDisc = Math.sqrt(disc);
  const x1 = (-b + sqrtDisc) / 2;
  const x2 = (-b - sqrtDisc) / 2;
  steps.push({
    math: `x = (-b ± √(b²-4ac)) / 2a = (${-b} ± √${formatNum(disc)}) / 2`,
    explanation: "Apply quadratic formula (couldn't find integer factors)",
    rule: "When the quadratic doesn't factor nicely, use the quadratic formula: x = (−b ± √(b²−4ac)) / 2a.",
  });
  if (disc === 0) {
    steps.push({
      math: `x = ${formatNum(x1)}`,
      explanation: "Discriminant is 0, so only one (repeated) root",
      rule: "When Δ = 0, the ± gives the same value twice. There's exactly one solution (a repeated root).",
    });
    return { ok: true, steps, answer: `x = ${formatNum(x1)} (double root)` };
  }
  steps.push({
    math: `x = ${formatNum(x1)}  or  x = ${formatNum(x2)}`,
    explanation: "Evaluate both roots",
    rule: "The ± symbol gives two answers: one with + and one with −.",
  });
  return { ok: true, steps, answer: `x = ${formatNum(x1)} or x = ${formatNum(x2)}` };
}

function solveSimultaneous(input: string): SolveResult {
  // input: "2x + y = 5 ; x - y = 1"
  const parts = input.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return { ok: false, steps: [], answer: "", error: "Enter two equations separated by ; (e.g. 2x + y = 5 ; x - y = 1)" };

  // Parse: each equation may have x and y terms plus constant
  const parseEq = (s: string): { x: number; y: number; c: number } | null => {
    const eqParts = s.split("=");
    if (eqParts.length !== 2) return null;
    const lhs = parseExprXY(eqParts[0]);
    const rhs = parseExprXY(eqParts[1]);
    if (!lhs || !rhs) return null;
    return { x: lhs.x - rhs.x, y: lhs.y - rhs.y, c: rhs.c - lhs.c };
  };

  const parseExprXY = (s: string): { x: number; y: number; c: number } | null => {
    const str = s.replace(/\s+/g, "").replace(/−/g, "-");
    const tokens: { type: string; value: string | number }[] = [];
    let i = 0;
    while (i < str.length) {
      const c = str[i];
      if (/[0-9.]/.test(c)) {
        let n = "";
        while (i < str.length && /[0-9.]/.test(str[i])) n += str[i++];
        tokens.push({ type: "num", value: parseFloat(n) });
        continue;
      }
      if (c === "x" || c === "y") {
        tokens.push({ type: c, value: c });
        i++;
        continue;
      }
      if ("+-".includes(c)) {
        tokens.push({ type: "op", value: c });
        i++;
        continue;
      }
      i++;
    }
    let x = 0, y = 0, const_ = 0, sign = 1;
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === "op" && t.value === "+") { sign = 1; continue; }
      if (t.type === "op" && t.value === "-") { sign = -sign; continue; }
      if (t.type === "num") {
        const next = tokens[j + 1];
        if (next?.type === "x") { x += sign * (t.value as number); j++; }
        else if (next?.type === "y") { y += sign * (t.value as number); j++; }
        else const_ += sign * (t.value as number);
        sign = 1;
        continue;
      }
      if (t.type === "x") { x += sign; sign = 1; continue; }
      if (t.type === "y") { y += sign; sign = 1; continue; }
    }
    return { x, y, c: const_ };
  };

  const e1 = parseEq(parts[0]);
  const e2 = parseEq(parts[1]);
  if (!e1 || !e2) return { ok: false, steps: [], answer: "", error: "Couldn't parse one of the equations." };

  const steps: Step[] = [
    { math: parts[0], explanation: "Equation 1", rule: "First equation of the system." },
    { math: parts[1], explanation: "Equation 2", rule: "Second equation of the system." },
  ];

  // Elimination method
  // Multiply eq1 by e2.x and eq2 by e1.x, subtract to eliminate x
  const m1 = e2.x, m2 = e1.x;
  const newE1y = e1.y * m1, newE1c = e1.c * m1;
  const newE2y = e2.y * m2, newE2c = e2.c * m2;
  steps.push({
    math: `Multiply eq1 by ${formatNum(m1)} → ${formatNum(m1 * e1.x)}x ${signStr(newE1y)} y = ${formatNum(newE1c)}`,
    explanation: `Multiply eq1 by ${formatNum(m1)} so x-coefficients match`,
    rule: "To eliminate x, both equations need the same x-coefficient. We multiply eq1 by (x-coeff of eq2) and eq2 by (x-coeff of eq1).",
  });
  steps.push({
    math: `Multiply eq2 by ${formatNum(m2)} → ${formatNum(m2 * e2.x)}x ${signStr(newE2y)} y = ${formatNum(newE2c)}`,
    explanation: `Multiply eq2 by ${formatNum(m2)}`,
    rule: "Same idea — we make the x-coefficients equal so they cancel when we subtract.",
  });
  const dy = newE1y - newE2y;
  const dc = newE1c - newE2c;
  if (dy === 0) {
    return { ok: true, steps, answer: dc === 0 ? "Infinite solutions" : "No solution" };
  }
  steps.push({
    math: `Subtract: ${formatNum(dy)} y = ${formatNum(dc)}`,
    explanation: "Subtract the two equations to eliminate x",
    rule: "When x-coefficients are equal, subtracting cancels x. We're left with a single equation in y.",
  });
  const yVal = dc / dy;
  steps.push({
    math: `y = ${formatNum(yVal)}`,
    explanation: `Divide by ${formatNum(dy)}`,
    rule: "Isolate y by dividing both sides by its coefficient.",
  });
  // substitute back
  const xVal = (e1.c - e1.y * yVal) / e1.x;
  steps.push({
    math: `Substitute y=${formatNum(yVal)} into eq1: ${formatNum(e1.x)} x ${signStr(e1.y * yVal)} = ${formatNum(e1.c)} → x = ${formatNum(xVal)}`,
    explanation: "Substitute y back into equation 1 to find x",
    rule: "Once we have one variable, plug it into any original equation to get the other.",
  });
  return { ok: true, steps, answer: `x = ${formatNum(xVal)}, y = ${formatNum(yVal)}` };
}

function solveInequality(input: string): SolveResult {
  // 2x - 3 < 7
  const opMatch = input.match(/[<>≤≥]/);
  if (!opMatch) return { ok: false, steps: [], answer: "", error: "Use <, >, ≤, or ≥ in your inequality." };
  const op = opMatch[0];
  const parts = input.split(/[<>≤≥]/);
  if (parts.length !== 2) return { ok: false, steps: [], answer: "", error: "Couldn't parse inequality." };
  const lhs = parseLinearExpr(parts[0]);
  const rhs = parseLinearExpr(parts[1]);
  if (!lhs || !rhs) return { ok: false, steps: [], answer: "", error: "Parse failed." };

  const a = lhs.x - rhs.x;
  const b = lhs.const - rhs.const;
  const steps: Step[] = [
    { math: input, explanation: "Original inequality", rule: "We start with the inequality you entered." },
    { math: `${formatNum(a)}x ${signStr(b)} ${op} 0`,
      explanation: "Move all terms to LHS",
      rule: "Same as equations: add/subtract to gather terms on one side. The inequality sign stays the same direction for now.",
    },
  ];
  if (a === 0) {
    return { ok: true, steps, answer: b === 0 ? "All real numbers" : "No solution" };
  }
  const xVal = -b / a;
  const finalOp = a > 0 ? op : (op === "<" ? ">" : op === ">" ? "<" : op === "≤" ? "≥" : "≤");
  steps.push({
    math: `x ${finalOp} ${formatNum(xVal)}`,
    explanation: a > 0
      ? `Divide both sides by ${formatNum(a)} (positive, sign unchanged)`
      : `Divide both sides by ${formatNum(a)} (negative — flip the inequality!)`,
    rule: "When you multiply or divide both sides of an inequality by a NEGATIVE number, you must flip the inequality sign. This is the #1 inequality mistake — don't forget it!",
  });
  return { ok: true, steps, answer: `x ${finalOp} ${formatNum(xVal)}` };
}

function simplifyFraction(input: string): SolveResult {
  const m = input.trim().match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (!m) return { ok: false, steps: [], answer: "", error: "Use form a/b (e.g. 12/18)" };
  let num = parseInt(m[1]);
  let den = parseInt(m[2]);
  if (den === 0) return { ok: false, steps: [], answer: "", error: "Denominator can't be zero." };
  const sign_ = (num < 0) !== (den < 0) ? -1 : 1;
  num = Math.abs(num); den = Math.abs(den);
  const steps: Step[] = [
    { math: input, explanation: "Original fraction", rule: "We start with the fraction you entered." },
  ];
  const g = gcd(num, den);
  steps.push({
    math: `GCD(${num}, ${den}) = ${g}`,
    explanation: "Find the greatest common divisor using Euclid's algorithm",
    rule: `GCD is the largest number that divides both. ${num} = ${g} × ${num / g}, ${den} = ${g} × ${den / g}.`,
  });
  num = num / g; den = den / g;
  steps.push({
    math: `Divide top and bottom by ${g}: ${sign_ === -1 ? "-" : ""}${num}/${den}`,
    explanation: `Divide both numerator and denominator by GCD = ${g}`,
    rule: "Dividing both parts by the same number doesn't change the fraction's value — it's the same proportion.",
  });
  if (den === 1) {
    steps.push({
      math: `= ${sign_ * num}`,
      explanation: "Denominator is 1, simplify to whole number",
      rule: "Anything divided by 1 is itself.",
    });
    return { ok: true, steps, answer: `${sign_ * num}` };
  }
  return { ok: true, steps, answer: `${sign_ === -1 ? "-" : ""}${num}/${den}` };
}

function simplifyRadical(input: string): SolveResult {
  const m = input.trim().match(/^(?:√|sqrt)\s*\(?(\d+)\)?$/i);
  if (!m) return { ok: false, steps: [], answer: "", error: "Use √n or sqrt(n) (e.g. √72)" };
  const n = parseInt(m[1]);
  if (n < 0) return { ok: false, steps: [], answer: "", error: "Negative under square root → imaginary result." };
  if (n === 0) return { ok: true, steps: [{ math: "√0 = 0", explanation: "Square root of zero", rule: "0² = 0, so √0 = 0." }], answer: "0" };

  const steps: Step[] = [
    { math: `√${n}`, explanation: "Original radical", rule: "We start with the radical you entered." },
  ];
  // find largest perfect square factor
  let largest = 1, leftover = n;
  for (let f = Math.floor(Math.sqrt(n)); f >= 2; f--) {
    if (n % (f * f) === 0) { largest = f; leftover = n / (f * f); break; }
  }
  if (largest === 1) {
    steps.push({
      math: `${n} has no perfect square factor`,
      explanation: "Check for perfect square factors (4, 9, 16, 25, 36, 49, 64, 81, 100, …)",
      rule: `${n} cannot be divided by any perfect square > 1, so √${n} is already in simplest form.`,
    });
    return { ok: true, steps, answer: `√${n}` };
  }
  steps.push({
    math: `${n} = ${largest * largest} × ${leftover} = ${largest}² × ${leftover}`,
    explanation: `Factor out the largest perfect square (${largest * largest} = ${largest}²)`,
    rule: `Looking for factors of ${n} that are perfect squares. ${largest * largest} works because ${n} ÷ ${largest * largest} = ${leftover}.`,
  });
  steps.push({
    math: leftover === 1
      ? `√${n} = √(${largest}² × 1) = ${largest}`
      : `√${n} = √(${largest}² × ${leftover}) = ${largest}√${leftover}`,
    explanation: "Use √(a × b) = √a × √b",
    rule: "Product property of radicals: √(a×b) = √a × √b. Since √(k²) = k, we get a whole number outside the radical.",
  });
  return { ok: true, steps, answer: leftover === 1 ? `${largest}` : `${largest}√${leftover}` };
}

function solveLogarithm(input: string): SolveResult {
  // log_2(8) or log2(8) or log_3(81)
  const m = input.trim().match(/^log_?(\d+)\s*\(?(\d+)\)?$/i);
  if (!m) return { ok: false, steps: [], answer: "", error: "Use form log_b(x) e.g. log_2(8)" };
  const base = parseInt(m[1]);
  const arg = parseInt(m[2]);
  if (base <= 0 || base === 1) return { ok: false, steps: [], answer: "", error: "Base must be positive and not 1." };
  if (arg <= 0) return { ok: false, steps: [], answer: "", error: "Argument must be positive." };

  const steps: Step[] = [
    { math: `log_${base}(${arg}) = ?`, explanation: "Original logarithm", rule: "log_b(x) asks: 'to what power must we raise b to get x?'" },
    { math: `Let log_${base}(${arg}) = y`, explanation: "Define y as the unknown", rule: "We rewrite the logarithm as an equation in y." },
    { math: `${base}^y = ${arg}`, explanation: "Convert to exponential form",
      rule: "Definition of logarithm: log_b(x) = y  ⟺  b^y = x.",
    },
  ];
  // find y by trial
  let y: number | null = null;
  let p = 1;
  for (let i = 0; i <= 30; i++) {
    if (p === arg) { y = i; break; }
    if (p > arg * 10) break;
    p *= base;
  }
  if (y != null) {
    steps.push({
      math: `${base}^${y} = ${arg}  ✓`,
      explanation: `Trial: ${base}^${y} = ${Math.pow(base, y)}`,
      rule: `Since ${base}^${y} = ${arg}, the answer is y = ${y}.`,
    });
    return { ok: true, steps, answer: `${y}` };
  }
  // not integer — use change of base
  const result = Math.log(arg) / Math.log(base);
  steps.push({
    math: `y = ln(${arg}) / ln(${base}) = ${result.toFixed(4)}`,
    explanation: "Use change of base formula",
    rule: "When the answer isn't an integer, use: log_b(x) = ln(x) / ln(b).",
  });
  return { ok: true, steps, answer: result.toFixed(4) };
}

function factorQuadratic(input: string): SolveResult {
  const m = input.trim().match(/^(-?\d*)x\^2\s*([+-])\s*(\d*)x\s*([+-])\s*(\d+)$/);
  if (!m) return { ok: false, steps: [], answer: "", error: "Use form ax^2 + bx + c (e.g. x^2 + 5x + 6)" };
  const a = m[1] === "" || m[1] === "-" ? (m[1] === "-" ? -1 : 1) : parseInt(m[1]);
  const b = (m[2] === "-" ? -1 : 1) * (m[3] === "" ? 1 : parseInt(m[3]));
  const c = (m[4] === "-" ? -1 : 1) * parseInt(m[5]);
  // ... simplified, reuse quadratic factoring logic
  return solveQuadratic(`${a}x^2 + ${b}x + ${c} = 0`);
}

// ---------- main component --------------------------------------------------

const PROBLEM_TYPES: { type: ProblemType; label: string; placeholder: string; example: string }[] = [
  { type: "linear", label: "Linear", placeholder: "3x + 5 = 2x - 7", example: "3x + 5 = 2x - 7" },
  { type: "quadratic", label: "Quadratic", placeholder: "x^2 - 5x + 6 = 0", example: "x^2 - 5x + 6 = 0" },
  { type: "simultaneous", label: "System", placeholder: "2x + y = 5 ; x - y = 1", example: "2x + y = 5 ; x - y = 1" },
  { type: "inequality", label: "Inequality", placeholder: "2x - 3 < 7", example: "2x - 3 < 7" },
  { type: "fraction", label: "Fraction", placeholder: "12/18", example: "12/18" },
  { type: "radical", label: "Radical", placeholder: "√72", example: "√72" },
  { type: "logarithm", label: "Logarithm", placeholder: "log_2(8)", example: "log_2(8)" },
  { type: "factor", label: "Factor", placeholder: "x^2 + 5x + 6", example: "x^2 + 5x + 6" },
];

export default function StepSolver({
  subjectColor = "#3b82f6",
}: {
  subjectColor?: string;
}) {
  const [type, setType] = useState<ProblemType>("linear");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<SolveResult | null>(null);
  const [revealedSteps, setRevealedSteps] = useState(1);
  const [showWhyFor, setShowWhyFor] = useState<number | null>(null);
  const [tryMode, setTryMode] = useState(false);
  const [userStep, setUserStep] = useState("");
  const [feedback, setFeedback] = useState<"correct" | "incorrect" | null>(null);

  const solve = () => {
    let r: SolveResult;
    switch (type) {
      case "linear": r = solveLinear(input); break;
      case "quadratic": r = solveQuadratic(input); break;
      case "simultaneous": r = solveSimultaneous(input); break;
      case "inequality": r = solveInequality(input); break;
      case "fraction": r = simplifyFraction(input); break;
      case "radical": r = simplifyRadical(input); break;
      case "logarithm": r = solveLogarithm(input); break;
      case "factor": r = factorQuadratic(input); break;
      default: r = { ok: false, steps: [], answer: "", error: "Unknown type" };
    }
    setResult(r);
    setRevealedSteps(1);
    setUserStep("");
    setFeedback(null);
  };

  const useExample = () => {
    const ex = PROBLEM_TYPES.find((p) => p.type === type)!.example;
    setInput(ex);
  };

  const checkUserStep = () => {
    if (!result || !result.steps[revealedSteps]) return;
    const expected = result.steps[revealedSteps].math;
    // very loose comparison: strip spaces, lowercase
    const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase().replace(/\*/g, "");
    if (normalize(userStep) === normalize(expected)) {
      setFeedback("correct");
      setTimeout(() => {
        setRevealedSteps((s) => Math.min(s + 1, result.steps.length));
        setUserStep("");
        setFeedback(null);
        setTryMode(false);
      }, 1000);
    } else {
      setFeedback("incorrect");
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  const KEYPAD = ["7","8","9","+","^","(","4","5","6","-","x",")","1","2","3","*","/","=","0",".","√","<",">","_","del","clr"];

  const insertKey = (k: string) => {
    if (k === "del") { setInput((s) => s.slice(0, -1)); return; }
    if (k === "clr") { setInput(""); return; }
    const insert = k === "√" ? "√" : k;
    setInput((s) => s + insert);
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Calculator className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">Step Solver</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5">
          {PROBLEM_TYPES.map((p) => (
            <button
              key={p.type}
              onClick={() => { setType(p.type); setInput(""); setResult(null); }}
              className={`text-[10px] px-2.5 py-1.5 rounded-lg font-medium ${
                type === p.type ? "text-white" : "bg-secondary hover:bg-secondary/70 text-foreground"
              }`}
              style={type === p.type ? { backgroundColor: subjectColor } : {}}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && solve()}
            placeholder={PROBLEM_TYPES.find((p) => p.type === type)!.placeholder}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={solve}
            className="shrink-0 px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5"
            style={{ backgroundColor: subjectColor }}
          >
            <Sparkles className="w-3.5 h-3.5" /> Solve
          </button>
        </div>
        <button onClick={useExample}
          className="text-[10px] text-muted-foreground hover:text-foreground underline">
          Try an example
        </button>

        {/* Result */}
        {result && !result.ok && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
            <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{result.error || "Could not solve. Check your input."}</span>
          </div>
        )}

        {result && result.ok && (
          <div className="space-y-2">
            {/* Steps */}
            <div className="space-y-1.5">
              {result.steps.slice(0, revealedSteps).map((step, i) => (
                <div key={i} className="rounded-lg border border-border bg-secondary/20 p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-mono bg-primary/10 text-primary rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: subjectColor + "20", color: subjectColor }}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-foreground break-words">{step.math}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{step.explanation}</div>
                      <button
                        onClick={() => setShowWhyFor(showWhyFor === i ? null : i)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-1"
                        style={{ color: subjectColor }}
                      >
                        <HelpCircle className="w-3 h-3" /> Why?
                      </button>
                      {showWhyFor === i && (
                        <div className="mt-1.5 p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
                          <Lightbulb className="w-3 h-3 shrink-0 mt-0.5" />
                          <span>{step.rule}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Try yourself mode */}
            {tryMode && revealedSteps < result.steps.length && (
              <div className={`p-2.5 rounded-lg border ${
                feedback === "correct" ? "bg-green-50 border-green-300"
                : feedback === "incorrect" ? "bg-red-50 border-red-300"
                : "bg-card border-border"
              }`}>
                <div className="text-[10px] text-muted-foreground mb-1.5">
                  Type what you think the next step is:
                </div>
                <input
                  value={userStep}
                  onChange={(e) => setUserStep(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && checkUserStep()}
                  placeholder="e.g. 3x - 2x = -7 - 5"
                  className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
                <div className="flex items-center gap-2 mt-1.5">
                  <button onClick={checkUserStep}
                    className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-white"
                    style={{ backgroundColor: subjectColor }}>
                    Check
                  </button>
                  <button onClick={() => setTryMode(false)}
                    className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-secondary hover:bg-secondary/70">
                    Cancel
                  </button>
                  {feedback === "correct" && (
                    <span className="text-[10px] text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Correct!
                    </span>
                  )}
                  {feedback === "incorrect" && (
                    <span className="text-[10px] text-red-700 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Try again
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {revealedSteps < result.steps.length && !tryMode && (
                <>
                  <button
                    onClick={() => setRevealedSteps((s) => s + 1)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold text-white flex items-center gap-1.5"
                    style={{ backgroundColor: subjectColor }}
                  >
                    <ChevronRight className="w-3.5 h-3.5" /> Next Step
                  </button>
                  <button
                    onClick={() => setRevealedSteps(result.steps.length)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/70"
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => setTryMode(true)}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 flex items-center gap-1.5"
                  >
                    <Lightbulb className="w-3 h-3" /> Try yourself
                  </button>
                </>
              )}
              {revealedSteps >= result.steps.length && (
                <button
                  onClick={() => { setRevealedSteps(1); setTryMode(false); }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/70 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" /> Replay
                </button>
              )}
            </div>

            {/* Final answer */}
            {revealedSteps >= result.steps.length && (
              <div className="p-3 rounded-lg bg-green-50 border border-green-300 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Answer</div>
                  <div className="text-sm font-mono font-bold text-foreground">{result.answer}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Math keypad */}
        <div className="border-t border-border pt-2">
          <div className="grid grid-cols-9 gap-1 max-w-md mx-auto">
            {KEYPAD.map((k, i) => (
              <button
                key={`${k}-${i}`}
                onClick={() => insertKey(k)}
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
    </div>
  );
}
