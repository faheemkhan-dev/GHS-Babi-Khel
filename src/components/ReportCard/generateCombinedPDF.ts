// src/components/ReportCard/generateCombinedPDF.ts
// Combined two-class BISE Peshawar report — A4 portrait, 2 pages, green & gold.
// (9th + 10th for school results, 1st Year + 2nd Year for college results.)
//
// Page 1 — Overview & position holders
//   header band · 5 combined KPI tiles · two class cards (stats + top-3 holders)
//   · top-6 scorers across both classes (ranked by PERCENTAGE, because the
//   classes have different maximum marks — raw totals are not comparable).
// Page 2 — Comparison
//   pass/fail distribution bars · subject-wise pass-% comparison · head-to-head
//   metrics · key insights · verdict.
//
// Everything is mathematically centred on A4 (equal margins, explicit table
// widths) and every table cell is centred horizontally and vertically.
import type { jsPDF } from "jspdf";
import type { ClassName, ExamSelection, NormalizedResult, ResultStats } from "./types";
import { classDisplayName, isCollegeClass } from "./classMaxMarks";
import {
  A4_W, CONTENT_W, MARGIN, SAFE_BOTTOM, SLIM_H, T,
  drawBand, drawFooters, drawSlimBand, fill, fitCenteredText, ink, kpiTiles,
  safeFilePart, sectionTitle, stroke, tableBase, type RGB,
} from "./pdfTheme";

type ClassKey = ClassName;

interface ClassData {
  className: ClassKey;
  results: NormalizedResult[];
  stats: ResultStats;
}

export interface CombinedPDFOpts {
  schoolName: string;
  examType: ExamSelection["examType"];
  year: string;
  /** Which two classes are compared. Defaults to ["9th", "10th"]. */
  pair?: [ClassKey, ClassKey];
  classes: Partial<Record<ClassKey, ClassData>>;
}

// Class colours: A = emerald, B = deep gold — on-brand and clearly distinct in print.
const COL_A: RGB = [14, 124, 90];
const COL_A_SOFT: RGB = [232, 246, 240];
const COL_B: RGB = [168, 112, 14];
const COL_B_SOFT: RGB = [252, 244, 224];

const cls = (k: ClassKey): string => classDisplayName(k);

/** Found students that actually have marks. */
const scored = (rs: NormalizedResult[]) => rs.filter((r) => r.found && r.totalMarks > 0);

function avgPct(rs: NormalizedResult[]): number {
  const s = scored(rs);
  if (!s.length) return 0;
  return Math.round((s.reduce((a, r) => a + r.percentage, 0) / s.length) * 10) / 10;
}
function maxPct(rs: NormalizedResult[]): number {
  const s = scored(rs);
  return s.length ? Math.max(...s.map((r) => r.percentage)) : 0;
}

function combinedStats(a: ResultStats, b: ResultStats) {
  const found = a.foundCount + b.foundCount;
  const passed = a.passCount + b.passCount;
  const failed = a.failCount + b.failCount;
  const avg = found > 0 ? Math.round((a.foundCount * a.averageMarks + b.foundCount * b.averageMarks) / found) : 0;
  return {
    total: a.totalStudents + b.totalStudents,
    passed,
    failed,
    passPct: found > 0 ? Math.round((passed / found) * 100) : 0,
    avg,
  };
}

interface Insight { text: string; color: RGB }

function buildInsights(A: ClassData, B: ClassData): Insight[] {
  const a = A.stats, b = B.stats;
  const out: Insight[] = [];
  if (a.passPercentage > b.passPercentage)
    out.push({ text: `${cls(A.className)} leads on pass rate (${a.passPercentage}% vs ${b.passPercentage}%, +${(a.passPercentage - b.passPercentage).toFixed(1).replace(/\.0$/, "")} pts).`, color: COL_A });
  else if (b.passPercentage > a.passPercentage)
    out.push({ text: `${cls(B.className)} leads on pass rate (${b.passPercentage}% vs ${a.passPercentage}%, +${(b.passPercentage - a.passPercentage).toFixed(1).replace(/\.0$/, "")} pts).`, color: COL_B });
  else out.push({ text: `Both classes share the same pass rate of ${a.passPercentage}%.`, color: T.muted });

  const common: Array<{ name: string; a: number; b: number }> = [];
  for (const [name, c] of Object.entries(a.subjectPassRates)) {
    const m = b.subjectPassRates[name];
    if (m) common.push({ name, a: c.rate, b: m.rate });
  }
  if (common.length) {
    const aw = common.filter((s) => s.a > s.b).length;
    const bw = common.filter((s) => s.b > s.a).length;
    out.push({ text: `Across ${common.length} common subject${common.length === 1 ? "" : "s"}: ${cls(A.className)} leads in ${aw}, ${cls(B.className)} in ${bw}, tied in ${common.length - aw - bw}.`, color: T.ink });
    const gaps = common.map((s) => ({ ...s, gap: Math.abs(s.a - s.b) })).filter((s) => s.gap > 0);
    if (gaps.length) {
      const big = gaps.reduce((m, s) => (s.gap > m.gap ? s : m));
      out.push({ text: `Largest subject gap: ${big.name} — ${cls(big.a > big.b ? A.className : B.className)} ahead by ${big.gap} pts.`, color: big.a > big.b ? COL_A : COL_B });
      if (gaps.length > 1) {
        const small = gaps.reduce((m, s) => (s.gap < m.gap ? s : m));
        out.push({ text: `Closest contest: ${small.name} — only ${small.gap} pts apart.`, color: T.muted });
      }
    }
  }
  const pa = avgPct(A.results), pb = avgPct(B.results);
  if (pa || pb) {
    if (pa > pb) out.push({ text: `${cls(A.className)} has the higher average percentage (${pa}% vs ${pb}%).`, color: COL_A });
    else if (pb > pa) out.push({ text: `${cls(B.className)} has the higher average percentage (${pb}% vs ${pa}%).`, color: COL_B });
    else out.push({ text: `Both classes share the same average percentage (${pa}%).`, color: T.muted });
  }
  return out;
}

export async function generateCombinedReportPDF(opts: CombinedPDFOpts): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc: jsPDF = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

  const [keyA, keyB] = opts.pair ?? (["9th", "10th"] as [ClassKey, ClassKey]);
  const A = opts.classes[keyA];
  const B = opts.classes[keyB];
  if (!A || !B) throw new Error(`Both ${keyA} and ${keyB} data are required for combined report.`);

  const school = opts.schoolName || "GHS Babi Khel, District Mohmand";
  const pairTitle = isCollegeClass(keyA) ? `${keyA} & ${keyB}` : `Class ${keyA} & ${keyB}`;
  const examLine = `${pairTitle}  ·  ${opts.examType}  ·  ${opts.year}`;
  const cx = A4_W / 2;
  const lastY = () => (doc as any).lastAutoTable.finalY as number;
  const comb = combinedStats(A.stats, B.stats);

  // ═══════════════════════════ PAGE 1 ═══════════════════════════
  let y = drawBand(doc, { eyebrow: "BISE Peshawar · Combined Report", title: school, subtitle: examLine });

  y = kpiTiles(doc, y, [
    { label: "Total Students", value: String(comb.total) },
    { label: "Passed", value: String(comb.passed), color: T.pass },
    { label: "Failed", value: String(comb.failed), color: T.fail },
    { label: "Pass %", value: `${comb.passPct}%` },
    { label: "Avg Marks", value: String(comb.avg) },
  ]);

  // ── Two class cards ──
  y = sectionTitle(doc, "CLASS-WISE OVERVIEW", y + 2);
  const gap = 12;
  const cardW = (CONTENT_W - gap) / 2;
  const cardTop = y + 2;
  let cardBottom = cardTop;

  const drawCard = (d: ClassData, x: number, col: RGB, soft: RGB) => {
    // header strip
    fill(doc, col);
    doc.roundedRect(x, cardTop, cardW, 26, 5, 5, "F");
    doc.rect(x, cardTop + 18, cardW, 8, "F"); // square off bottom corners of the strip
    doc.setFont("helvetica", "bold");
    ink(doc, T.white);
    fitCenteredText(doc, cls(d.className), x + cardW / 2, cardTop + 17, cardW - 16, 11.5, 8);

    // 3 × 2 stat grid
    const s = d.stats;
    const cells: Array<[string, string, RGB?]> = [
      ["Students", String(s.totalStudents)],
      ["Passed", String(s.passCount), T.pass],
      ["Failed", String(s.failCount), T.fail],
      ["Pass %", `${s.passPercentage}%`],
      ["Average", String(s.averageMarks)],
      ["Highest", String(s.highestMarks), T.gold],
    ];
    const g = 5, bw = (cardW - 16 - g * 2) / 3, bh = 34;
    cells.forEach(([label, value, c], i) => {
      const bx = x + 8 + (i % 3) * (bw + g);
      const by = cardTop + 34 + Math.floor(i / 3) * (bh + g);
      fill(doc, soft);
      stroke(doc, T.border, 0.5);
      doc.roundedRect(bx, by, bw, bh, 4, 4, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.3);
      ink(doc, T.muted);
      doc.text(label.toUpperCase(), bx + bw / 2, by + 12, { align: "center" });
      ink(doc, c ?? T.ink);
      fitCenteredText(doc, value, bx + bw / 2, by + 27, bw - 6, 12, 8);
    });

    // top-3 holders table
    const top = scored(d.results).sort((p, q) => q.totalMarks - p.totalMarks).slice(0, 3);
    const tblY = cardTop + 34 + 2 * (bh + g) + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    ink(doc, col);
    doc.text("POSITION HOLDERS", x + cardW / 2, tblY, { align: "center" });
    autoTable(doc, {
      ...tableBase(doc),
      startY: tblY + 5,
      tableWidth: cardW - 16,
      margin: { left: x + 8, right: A4_W - (x + cardW - 8), top: 40, bottom: 40 },
      head: [["#", "Name", "Marks"]],
      body: top.length ? top.map((r, i) => [String(i + 1), r.name || "—", `${r.totalMarks} (${r.percentage}%)`]) : [["—", "No results", "—"]],
      styles: { ...tableBase(doc).styles, fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 2, right: 2 } },
      headStyles: { ...tableBase(doc).headStyles, fillColor: col, lineColor: col, fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: cardW - 16 - 20 - 78, fontStyle: "bold" }, 2: { cellWidth: 78 } },
    });
    cardBottom = Math.max(cardBottom, lastY());
  };

  drawCard(A, MARGIN, COL_A, COL_A_SOFT);
  drawCard(B, MARGIN + cardW + gap, COL_B, COL_B_SOFT);
  // card outlines (stroke only — drawn after content)
  cardBottom += 8;
  stroke(doc, T.border, 0.8);
  doc.roundedRect(MARGIN, cardTop, cardW, cardBottom - cardTop, 5, 5, "S");
  doc.roundedRect(MARGIN + cardW + gap, cardTop, cardW, cardBottom - cardTop, 5, 5, "S");
  y = cardBottom + 20;

  // ── Top 6 scorers across both classes (by percentage) ──
  y = sectionTitle(doc, "TOP 6 SCORERS — BOTH CLASSES (BY PERCENTAGE)", y);
  const pool = [
    ...scored(A.results).map((r) => ({ r, key: keyA, col: COL_A })),
    ...scored(B.results).map((r) => ({ r, key: keyB, col: COL_B })),
  ].sort((p, q) => q.r.percentage - p.r.percentage).slice(0, 6);

  if (pool.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    ink(doc, T.muted);
    doc.text("No scored results available yet.", cx, y + 12, { align: "center" });
    y += 30;
  } else {
    const labelW = 215, barX = MARGIN + labelW + 8, barMaxW = CONTENT_W - labelW - 8 - 78;
    pool.forEach((p, i) => {
      const rowH = 26;
      const ry = y + i * rowH;
      if (i % 2 === 0) { fill(doc, T.stripe); doc.rect(MARGIN, ry - 2, CONTENT_W, rowH, "F"); }
      // rank bubble
      fill(doc, i === 0 ? T.goldLine : T.greenSoft);
      stroke(doc, i === 0 ? T.gold : T.border, 0.6);
      doc.circle(MARGIN + 13, ry + 10, 8, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      ink(doc, i === 0 ? T.greenDeep : T.text);
      doc.text(String(i + 1), MARGIN + 13, ry + 12.6, { align: "center" });
      // name (+ class tag) — shrinks / wraps, never cut
      doc.setFont("helvetica", "bold");
      ink(doc, T.ink);
      const label = `${p.r.name || "—"}`;
      doc.setFontSize(8.5);
      const lines: string[] = doc.getTextWidth(label) > labelW - 30 ? doc.splitTextToSize(label, labelW - 30) : [label];
      lines.slice(0, 2).forEach((ln, li) => doc.text(ln, MARGIN + 28, ry + (lines.length > 1 ? 8 + li * 9 : 12.6)));
      // class tag
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      ink(doc, p.col);
      doc.text(cls(p.key).toUpperCase(), MARGIN + labelW - 4, ry + 12.2, { align: "right" });
      // bar
      fill(doc, [226, 236, 229]);
      doc.roundedRect(barX, ry + 5, barMaxW, 9, 4.5, 4.5, "F");
      fill(doc, p.col);
      doc.roundedRect(barX, ry + 5, Math.max(8, (Math.min(p.r.percentage, 100) / 100) * barMaxW), 9, 4.5, 4.5, "F");
      // value
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      ink(doc, T.ink);
      doc.text(`${p.r.percentage}%`, MARGIN + CONTENT_W, ry + 12.6, { align: "right" });
    });
    y += pool.length * 26 + 8;
  }

  // ═══════════════════════════ PAGE 2 ═══════════════════════════
  doc.addPage();
  y = drawBand(doc, { eyebrow: "BISE Peshawar · Comparison", title: school, subtitle: examLine });
  const ensure = (h: number) => {
    if (y + h > SAFE_BOTTOM) {
      doc.addPage();
      drawSlimBand(doc, `${school}  ·  ${examLine}`);
      y = SLIM_H + 26;
    }
  };

  // ── Pass / fail distribution ──
  y = sectionTitle(doc, "PASS / FAIL DISTRIBUTION", y + 2);
  for (const [d, col] of [[A, COL_A], [B, COL_B]] as Array<[ClassData, RGB]>) {
    const found = d.stats.passCount + d.stats.failCount;
    const barW = CONTENT_W - 150;
    const bx = MARGIN + 150;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    ink(doc, col);
    doc.text(cls(d.className), MARGIN + 2, y + 11);
    if (found > 0) {
      const pw = (d.stats.passCount / found) * barW;
      fill(doc, T.pass);
      doc.roundedRect(bx, y + 2, Math.max(pw, 0.1), 14, 3, 3, "F");
      if (d.stats.failCount > 0) {
        fill(doc, T.fail);
        doc.roundedRect(bx + pw, y + 2, barW - pw, 14, 3, 3, "F");
      }
    } else {
      fill(doc, [226, 232, 240]);
      doc.roundedRect(bx, y + 2, barW, 14, 3, 3, "F");
    }
    doc.setFontSize(7.5);
    ink(doc, T.muted);
    doc.text(`Passed ${d.stats.passCount}  ·  Failed ${d.stats.failCount}  ·  ${d.stats.passPercentage}%`, bx, y + 28);
    y += 38;
  }
  y += 16;

  // ── Subject-wise comparison ──
  const names = Array.from(new Set([...Object.keys(A.stats.subjectPassRates), ...Object.keys(B.stats.subjectPassRates)])).sort();
  if (names.length) {
    ensure(70);
    y = sectionTitle(doc, "SUBJECT-WISE PASS % COMPARISON", y);
    autoTable(doc, {
      ...tableBase(doc, {}),
      startY: y,
      head: [["Subject", cls(keyA), cls(keyB), "Gap (pts)", "Leader"]],
      body: names.map((n) => {
        const ra = A.stats.subjectPassRates[n]?.rate;
        const rb = B.stats.subjectPassRates[n]?.rate;
        const has = ra !== undefined && rb !== undefined;
        const gapV = has ? Math.abs(ra! - rb!) : null;
        const lead = !has ? "—" : ra! > rb! ? cls(keyA) : rb! > ra! ? cls(keyB) : "Tie";
        return [n, ra !== undefined ? `${ra}%` : "—", rb !== undefined ? `${rb}%` : "—", gapV !== null ? String(gapV) : "—", lead];
      }),
      columnStyles: {
        0: { cellWidth: CONTENT_W - 4 * 80, fontStyle: "bold" },
        1: { cellWidth: 80 }, 2: { cellWidth: 80 }, 3: { cellWidth: 80 }, 4: { cellWidth: 80 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.column.index === 1) data.cell.styles.textColor = COL_A;
        if (data.column.index === 2) data.cell.styles.textColor = COL_B;
        if (data.column.index === 4) {
          const t = String(data.cell.raw);
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = t === cls(keyA) ? COL_A : t === cls(keyB) ? COL_B : T.muted;
        }
      },
    });
    y = lastY() + 20;
  }

  // ── Head-to-head ──
  ensure(150);
  y = sectionTitle(doc, "HEAD-TO-HEAD", y);
  const lead = (x: number, yv: number, lowerBetter = false) =>
    x === yv ? "Tie" : (lowerBetter ? x < yv : x > yv) ? cls(keyA) : cls(keyB);
  const h2h: Array<[string, number, number, boolean, string]> = [
    ["Students", A.stats.totalStudents, B.stats.totalStudents, false, ""],
    ["Passed", A.stats.passCount, B.stats.passCount, false, ""],
    ["Failed", A.stats.failCount, B.stats.failCount, true, ""],
    ["Pass %", A.stats.passPercentage, B.stats.passPercentage, false, "%"],
    ["Average percentage", avgPct(A.results), avgPct(B.results), false, "%"],
    ["Highest percentage", maxPct(A.results), maxPct(B.results), false, "%"],
  ];
  autoTable(doc, {
    ...tableBase(doc, {}),
    startY: y,
    head: [["Metric", cls(keyA), cls(keyB), "Leader"]],
    // Leaders are shown only for RATE metrics (%). Raw counts (students /
    // passed / failed) depend on class size, so "who leads" would mislead.
    body: h2h.map(([m, x, yv, lb, u]) => [m, `${x}${u}`, `${yv}${u}`, u === "%" ? lead(x, yv, lb) : "—"]),
    columnStyles: {
      0: { cellWidth: CONTENT_W - 3 * 100, fontStyle: "bold" },
      1: { cellWidth: 100 }, 2: { cellWidth: 100 }, 3: { cellWidth: 100 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index === 1) data.cell.styles.textColor = COL_A;
      if (data.column.index === 2) data.cell.styles.textColor = COL_B;
      if (data.column.index === 3) {
        const t = String(data.cell.raw);
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = t === cls(keyA) ? COL_A : t === cls(keyB) ? COL_B : T.muted;
      }
    },
  });
  y = lastY() + 20;

  // ── Key insights ──
  const insights = buildInsights(A, B);
  if (insights.length) {
    ensure(40 + insights.length * 22);
    y = sectionTitle(doc, "KEY INSIGHTS", y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const ins of insights) {
      const lines: string[] = doc.splitTextToSize(ins.text, CONTENT_W - 26);
      ensure(lines.length * 12 + 8);
      fill(doc, ins.color);
      doc.circle(MARGIN + 6, y + 1.5, 2.6, "F");
      ink(doc, T.text);
      lines.forEach((ln, i) => doc.text(ln, MARGIN + 18, y + 4.5 + i * 12));
      y += lines.length * 12 + 6;
    }
  }

  drawFooters(doc, `${school}  ·  Combined BISE Peshawar Results`);
  const slug = safeFilePart(school).replace(/_+/g, "_");
  doc.save(`${slug}_Combined_${safeFilePart(keyA)}_${safeFilePart(keyB)}_${safeFilePart(opts.examType)}_${safeFilePart(opts.year)}.pdf`);
}
