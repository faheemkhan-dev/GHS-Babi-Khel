import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDown, Loader2, Layers } from "lucide-react";
import type { ResultWithStudent } from "@/hooks/useResultsEnhanced";
import type jsPDF from "jspdf";

// jsPDF is fetched only when the admin actually exports a PDF.
let jsPDFCtor: typeof import("jspdf").default | null = null;
const ensureJsPDF = async () => {
  if (!jsPDFCtor) jsPDFCtor = (await import("jspdf")).default;
  return jsPDFCtor;
};

// ─── Subject lists per class group ───────────────────────────────────────────
const SUBJECTS_6_TO_8 = [
  "English",
  "Urdu",
  "Islamiyat",
  "M.Quran",
  "Arabic",
  "Geography",
  "Pashto",
  "Maths",
  "History",
  "G.Science",
  "Computer Science",
];

const SUBJECTS_9_TO_10 = [
  "English",
  "Urdu",
  "Pak-study",
  "Chemistry",
  "Physics",
  "Computer Science",
  "Biology",
  "Islamiyat",
  "M.Quran",
  "Mathematics",
];

function getSubjects(cls: string): string[] {
  return ["9", "10"].includes(cls) ? SUBJECTS_9_TO_10 : SUBJECTS_6_TO_8;
}

// ─── PDF color palette (matches Merit List / DMC PDF theme) ────────────────
const PDF = {
  ink:    [26, 26, 26]    as [number, number, number],
  sub:    [90, 90, 90]    as [number, number, number],
  muted:  [120, 120, 120] as [number, number, number],
  rule:   [180, 180, 180] as [number, number, number],
  white:  [255, 255, 255] as [number, number, number],
  gold:   [180, 140, 40]  as [number, number, number],
  pass:   [15, 129, 74]   as [number, number, number],
  fail:   [178, 34, 34]   as [number, number, number],
  panel:  [247, 247, 249] as [number, number, number],
  navy:   [24, 42, 74]    as [number, number, number],
};

const PDF_SUBJECT_COLORS: [number, number, number][] = [
  [99, 102, 241], [139, 92, 246], [236, 72, 153], [244, 63, 94],
  [249, 115, 22], [234, 179, 8], [34, 197, 94], [20, 184, 166],
  [6, 182, 212], [59, 130, 246],
];

// Per-class accent colors for the combined view (5 distinct colors)
const CLASS_COLORS: [number, number, number][] = [
  [99, 102, 241],   // indigo  – Class 6
  [16, 185, 129],   // emerald – Class 7
  [249, 115, 22],   // orange  – Class 8
  [236, 72, 153],   // pink    – Class 9
  [59, 130, 246],   // blue    – Class 10
];

interface AnalyticsPdfInput {
  cls: string;
  year: number;
  subjects: string[];
  results: ResultWithStudent[];
}

function computeAnalyticsPdfData({ cls, year, subjects, results }: AnalyticsPdfInput) {
  const total = results.length;
  const passCount = results.filter((r) => r.is_pass).length;
  const failCount = total - passCount;
  const passRate = total > 0 ? Math.round((passCount / total) * 1000) / 10 : 0;
  const avgPct =
    total > 0
      ? Math.round((results.reduce((s, r) => s + (r.percentage || 0), 0) / total) * 10) / 10
      : 0;
  const highest = total > 0 ? Math.max(...results.map((r) => r.percentage || 0)) : 0;
  const lowest = total > 0 ? Math.min(...results.map((r) => r.percentage || 0)) : 0;

  const gradeBuckets = [
    { label: "A+/A (80-100)", min: 80, max: 100.001, color: PDF.pass },
    { label: "B (60-79)", min: 60, max: 80, color: [59, 130, 246] as [number, number, number] },
    { label: "C (40-59)", min: 40, max: 60, color: [234, 179, 8] as [number, number, number] },
    { label: "Below 40", min: 0, max: 40, color: PDF.fail },
  ].map((b) => ({
    ...b,
    count: results.filter((r) => (r.percentage || 0) >= b.min && (r.percentage || 0) < b.max).length,
  }));

  // Only include subjects that were actually used when adding results for
  // this class/year — a subject nobody entered marks for (count === 0)
  // isn't part of this exam, so it's dropped entirely rather than shown
  // as a misleading "0%" bar/spoke (e.g. Arabic when it wasn't examined).
  const subjectAverages = subjects
    .map((subject) => {
      let totalPct = 0;
      let count = 0;
      for (const r of results) {
        const sm = r.subject_marks?.[subject];
        if (sm && sm.total > 0) {
          totalPct += (sm.obtained / sm.total) * 100;
          count++;
        }
      }
      return {
        subject,
        average: count > 0 ? Math.round((totalPct / count) * 10) / 10 : 0,
        hasData: count > 0,
      };
    })
    .filter((s) => s.hasData)
    .map((s, idx) => ({
      ...s,
      color: PDF_SUBJECT_COLORS[idx % PDF_SUBJECT_COLORS.length],
    }));

  const topStudents = [...results]
    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
    .slice(0, 5)
    .map((r, i) => ({
      rank: i + 1,
      name: r.students?.full_name ?? "—",
      roll: r.students?.roll_number ?? "—",
      pct: r.percentage || 0,
    }));

  const strongestSubject = subjectAverages.reduce(
    (best, s) => (s.average > (best?.average ?? -1) ? s : best),
    null as (typeof subjectAverages)[number] | null
  );
  const weakestSubject = subjectAverages.reduce(
    (worst, s) => (s.average < (worst?.average ?? 101) ? s : worst),
    null as (typeof subjectAverages)[number] | null
  );

  return {
    cls, year, total, passCount, failCount, passRate, avgPct, highest, lowest,
    gradeBuckets, subjectAverages, topStudents, strongestSubject, weakestSubject,
  };
}

// ─── Draw a filled donut/ring chart (pure vector, no external libs) ─────────
function drawDonut(
  doc: jsPDF,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  segments: { value: number; color: [number, number, number] }[]
) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let startAngle = -90;
  const steps = 60; // resolution per full circle
  for (const seg of segments) {
    const sweep = (seg.value / total) * 360;
    if (sweep <= 0) continue;
    const segSteps = Math.max(2, Math.round((sweep / 360) * steps));
    doc.setFillColor(seg.color[0], seg.color[1], seg.color[2]);
    for (let i = 0; i < segSteps; i++) {
      const a0 = ((startAngle + (sweep * i) / segSteps) * Math.PI) / 180;
      const a1 = ((startAngle + (sweep * (i + 1)) / segSteps) * Math.PI) / 180;
      const x0o = cx + rOuter * Math.cos(a0), y0o = cy + rOuter * Math.sin(a0);
      const x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
      const x1i = cx + rInner * Math.cos(a1), y1i = cy + rInner * Math.sin(a1);
      const x0i = cx + rInner * Math.cos(a0), y0i = cy + rInner * Math.sin(a0);
      doc.triangle(x0o, y0o, x1o, y1o, x1i, y1i, "F");
      doc.triangle(x0o, y0o, x1i, y1i, x0i, y0i, "F");
    }
    startAngle += sweep;
  }
}

// ─── Draw a radar/spider polygon for one subject-average series ────────────
function drawRadarSeries(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  values: number[], // 0-100
  color: [number, number, number],
  fillOpacityHex: string | null
) {
  const n = values.length;
  const pts = values.map((v, i) => {
    const angle = -90 + (i * 360) / n;
    const rad = (angle * Math.PI) / 180;
    const dist = (Math.max(0, Math.min(100, v)) / 100) * r;
    return [cx + dist * Math.cos(rad), cy + dist * Math.sin(rad)];
  });
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(0.6);
  if (fillOpacityHex) {
    doc.setFillColor(color[0], color[1], color[2]);
    (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.18 }));
  }
  const lines: any[] = [];
  for (let i = 1; i < pts.length; i++) lines.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  lines.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]]);
  doc.lines(lines, pts[0][0], pts[0][1], [1, 1], fillOpacityHex ? "FD" : "D", true);
  if (fillOpacityHex) (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));
  doc.setFillColor(color[0], color[1], color[2]);
  for (const [x, y] of pts) doc.circle(x, y, 0.7, "F");
}

function generateClassAnalyticsPdf(data: ReturnType<typeof computeAnalyticsPdfData>) {
  const doc = new jsPDFCtor!({ orientation: "portrait", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const margin = 12;

  // ── Outer frame ──────────────────────────────────────────────────────────
  doc.setDrawColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.setLineWidth(0.8);
  doc.rect(6, 6, w - 12, h - 12);

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setDrawColor(PDF.gold[0], PDF.gold[1], PDF.gold[2]);
  doc.setLineWidth(1.1);
  doc.line(margin, 13, w - margin, 13);

  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 20, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
  doc.text("District Mohmand, Khyber Pakhtunkhwa  |  Established 2018", w / 2, 25.5, { align: "center" });

  doc.setFillColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
  doc.roundedRect(w / 2 - 46, 28.5, 92, 8.5, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(`CLASS ${data.cls} — RESULT ANALYTICS`, w / 2, 34.2, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
  doc.text(`Academic Year ${data.year}  |  Diagrammatic Performance Overview  |  ${data.total} Students`, w / 2, 40.5, { align: "center" });

  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.25);
  doc.line(margin, 43, w - margin, 43);

  let y = 47;

  // ── Row 1: 4 KPI stat cards ─────────────────────────────────────────────
  const cardW = (w - margin * 2 - 3 * 3) / 4;
  const cardH = 18;
  const kpis: { label: string; value: string; color: [number, number, number] }[] = [
    { label: "Class Average", value: `${data.avgPct}%`, color: PDF.navy },
    { label: "Pass Rate", value: `${data.passRate}%`, color: PDF.pass },
    { label: "Highest Score", value: `${data.highest}%`, color: PDF.gold },
    { label: "Lowest Score", value: `${data.lowest}%`, color: PDF.fail },
  ];
  kpis.forEach((k, i) => {
    const x = margin + i * (cardW + 3);
    doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
    doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, "FD");
    doc.setFillColor(k.color[0], k.color[1], k.color[2]);
    doc.rect(x, y, 1.6, cardH, "F");
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(k.value, x + cardW / 2, y + 10.5, { align: "center" });
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.text(k.label.toUpperCase(), x + cardW / 2, y + 15, { align: "center" });
  });
  y += cardH + 6;

  // ── Row 2: Pass/Fail Donut + Grade Distribution Bars ─────────────────────
  const rowTop = y;
  const colW = (w - margin * 2 - 4) / 2;

  // Left: donut
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("PASS / FAIL BREAKDOWN", margin, rowTop);
  const donutCy = rowTop + 20;
  const donutCx = margin + colW * 0.32;
  drawDonut(doc, donutCx, donutCy, 15, 8, [
    { value: data.passCount, color: PDF.pass },
    { value: data.failCount, color: PDF.fail },
  ]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text(`${data.passRate}%`, donutCx, donutCy + 1.5, { align: "center" });
  doc.setFontSize(5.2);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
  doc.text("PASSED", donutCx, donutCy + 5, { align: "center" });

  const legendX = donutCx + 22;
  doc.setFillColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
  doc.rect(legendX, donutCy - 8, 3, 3, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text(`Passed: ${data.passCount}`, legendX + 4.5, donutCy - 5.7);
  doc.setFillColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
  doc.rect(legendX, donutCy - 2, 3, 3, "F");
  doc.text(`Failed: ${data.failCount}`, legendX + 4.5, donutCy + 0.3);
  doc.setFillColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
  doc.rect(legendX, donutCy + 4, 3, 3, "F");
  doc.text(`Total: ${data.total}`, legendX + 4.5, donutCy + 6.3);

  // Right: grade distribution horizontal bars
  const rightX = margin + colW + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("GRADE DISTRIBUTION", rightX, rowTop);
  const maxCount = Math.max(1, ...data.gradeBuckets.map((b) => b.count));
  const barMaxW = colW - 34;
  data.gradeBuckets.forEach((b, i) => {
    const by = rowTop + 6 + i * 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(b.label, rightX, by + 3.2);
    const bw = (b.count / maxCount) * barMaxW;
    doc.setFillColor(230, 230, 232);
    doc.roundedRect(rightX + 30, by, barMaxW, 4.2, 0.8, 0.8, "F");
    if (bw > 0.5) {
      doc.setFillColor(b.color[0], b.color[1], b.color[2]);
      doc.roundedRect(rightX + 30, by, Math.max(bw, 2), 4.2, 0.8, 0.8, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.text(String(b.count), rightX + 30 + barMaxW + 2.5, by + 3.2);
  });

  y = rowTop + 42;
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(margin, y, w - margin, y);
  y += 5;

  // ── Row 3: Subject Averages Bar Chart (vertical) ─────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("SUBJECT-WISE CLASS AVERAGE", margin, y);
  y += 4;
  const chartH = 30;
  const chartBaseY = y + chartH;
  const chartX0 = margin + 6;
  const chartW = w - margin * 2 - 8;
  const nSubj = data.subjectAverages.length || 1;
  const gap = 2;
  const barW = (chartW - gap * (nSubj - 1)) / nSubj;

  // gridlines
  doc.setDrawColor(235, 235, 235);
  doc.setLineWidth(0.15);
  [0, 25, 50, 75, 100].forEach((v) => {
    const gy = chartBaseY - (v / 100) * chartH;
    doc.line(chartX0, gy, chartX0 + chartW, gy);
    doc.setFontSize(4.8);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text(`${v}`, chartX0 - 2, gy + 1, { align: "right" });
  });

  data.subjectAverages.forEach((s, i) => {
    const bx = chartX0 + i * (barW + gap);
    const bh = (s.average / 100) * chartH;
    doc.setFillColor(s.color[0], s.color[1], s.color[2]);
    doc.roundedRect(bx, chartBaseY - bh, barW, Math.max(bh, 0.5), 0.6, 0.6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5);
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.text(`${s.average}`, bx + barW / 2, chartBaseY - bh - 1.2, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.3);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(s.subject, bx + barW / 2 - 0.5, chartBaseY + 3, { angle: -60 });
  });

  y = chartBaseY + 22;
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(margin, y, w - margin, y);
  y += 5;

  // ── Row 4: Radar (strongest/weakest visual) + Top 5 table ───────────────
  const row4Top = y;
  const radarColW = (w - margin * 2) * 0.42;
  const tableColX = margin + radarColW + 6;
  const tableColW = w - margin - tableColX;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("SUBJECT PROFILE (RADAR)", margin, row4Top);
  const radarCx = margin + radarColW / 2;
  const radarCy = row4Top + 26;
  const radarR = 20;

  // radar grid rings
  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.15);
  [0.25, 0.5, 0.75, 1].forEach((f) => doc.circle(radarCx, radarCy, radarR * f, "D"));
  const subjLabels = data.subjectAverages.map((s) => s.subject);
  const n = subjLabels.length || 1;
  // Numbered spokes instead of full subject names
  subjLabels.forEach((_, i) => {
    const angle = -90 + (i * 360) / n;
    const rad = (angle * Math.PI) / 180;
    const ex = radarCx + radarR * Math.cos(rad);
    const ey = radarCy + radarR * Math.sin(rad);
    doc.line(radarCx, radarCy, ex, ey);
    const lx = radarCx + (radarR + 3.2) * Math.cos(rad);
    const ly = radarCy + (radarR + 3.2) * Math.sin(rad);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.2);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text(String(i + 1), lx, ly, { align: "center" });
  });
  drawRadarSeries(
    doc, radarCx, radarCy, radarR,
    data.subjectAverages.map((s) => s.average),
    PDF.navy, "fill"
  );

  // Numbered legend
  const legendTop = radarCy + radarR + 8;
  const legendColW = radarColW / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.6);
  subjLabels.forEach((label, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = margin + col * legendColW;
    const ly = legendTop + row * 3.6;
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text(`${i + 1}.`, lx, ly);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(label, lx + 4, ly);
  });
  const legendRows = Math.ceil(n / 2);

  if (data.strongestSubject || data.weakestSubject) {
    const infoY = legendTop + legendRows * 3.6 + 4;
    if (data.strongestSubject) {
      doc.setFillColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
      doc.circle(margin + 2, infoY - 1, 1.2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
      doc.text(`Strongest: ${data.strongestSubject.subject} (${data.strongestSubject.average}%)`, margin + 5, infoY);
    }
    if (data.weakestSubject) {
      doc.setFillColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
      doc.circle(margin + 2, infoY + 4.5, 1.2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
      doc.text(`Focus Area: ${data.weakestSubject.subject} (${data.weakestSubject.average}%)`, margin + 5, infoY + 5.5);
    }
  }

  // Right: Top 5 performers table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("TOP 5 PERFORMERS", tableColX, row4Top);

  doc.setFillColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
  doc.rect(tableColX, row4Top + 3, tableColW, 5.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.text("#", tableColX + 3, row4Top + 6.7);
  doc.text("Roll", tableColX + 10, row4Top + 6.7);
  doc.text("Name", tableColX + 26, row4Top + 6.7);
  doc.text("%", tableColX + tableColW - 6, row4Top + 6.7, { align: "right" });

  const rowH = 7.5;
  data.topStudents.forEach((s, i) => {
    const ry = row4Top + 8.5 + i * rowH;
    const midY = ry + rowH / 2 + 1.5;
    if (i % 2 === 0) {
      doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
      doc.rect(tableColX, ry, tableColW, rowH, "F");
    }

    const badgeCx = tableColX + 3.2;
    const badgeCy = midY - 1;
    if (s.rank <= 3) {
      const medalColor: [number, number, number] =
        s.rank === 1 ? [212, 175, 55] : s.rank === 2 ? [176, 176, 180] : [176, 116, 62];
      const ribbonColor: [number, number, number] =
        s.rank === 1 ? [180, 30, 40] : s.rank === 2 ? [40, 70, 150] : [40, 120, 70];
      doc.setFillColor(ribbonColor[0], ribbonColor[1], ribbonColor[2]);
      doc.triangle(badgeCx - 1.6, badgeCy - 1.2, badgeCx - 0.2, badgeCy - 1.2, badgeCx - 1.6, badgeCy - 4.2, "F");
      doc.triangle(badgeCx + 1.6, badgeCy - 1.2, badgeCx + 0.2, badgeCy - 1.2, badgeCx + 1.6, badgeCy - 4.2, "F");
      doc.setFillColor(Math.round(medalColor[0] * 0.8), Math.round(medalColor[1] * 0.8), Math.round(medalColor[2] * 0.8));
      doc.circle(badgeCx, badgeCy, 2.6, "F");
      doc.setFillColor(medalColor[0], medalColor[1], medalColor[2]);
      doc.circle(badgeCx, badgeCy, 2.2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.text(String(s.rank), badgeCx, badgeCy + 0.9, { align: "center" });
    } else {
      doc.setFillColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
      doc.circle(badgeCx, badgeCy, 2.3, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      doc.text(String(s.rank), badgeCx, badgeCy + 0.9, { align: "center" });
    }

    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.text(s.roll, tableColX + 10, midY);

    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.setFont("helvetica", "bold");
    const nameShort = s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name;
    doc.text(nameShort, tableColX + 26, midY);

    doc.setTextColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
    doc.text(`${s.pct}%`, tableColX + tableColW - 6, midY, { align: "right" });
  });

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.25);
  doc.line(margin, h - 12, w - margin, h - 12);
  doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text("GHS Babi Khel — Official Class Result Analytics", margin, h - 7);
  doc.text(
    `Generated: ${new Date().toLocaleDateString("en-GB")}`,
    w / 2, h - 7, { align: "center" }
  );
  doc.text("Page 1 / 1", w - margin, h - 7, { align: "right" });

  doc.save(`ClassAnalytics_Class${data.cls}_${data.year}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ALL CLASSES COMBINED ANALYTICS — Single-page Landscape PDF
// ═══════════════════════════════════════════════════════════════════════════

function generateAllClassesCombinedPdf(
  year: number,
  classData: Map<string, ReturnType<typeof computeAnalyticsPdfData>>
) {
  const doc = new jsPDFCtor!({ orientation: "landscape", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();   // 297
  const h = doc.internal.pageSize.getHeight();  // 210
  const mx = 10; // horizontal margin
  const my = 8;  // vertical margin

  // ── Class ordering ──────────────────────────────────────────────────────
  const CLASS_ORDER = ["6", "7", "8", "9", "10"];
  const presentClasses = CLASS_ORDER.filter((c) => classData.has(c));
  if (presentClasses.length === 0) return;

  // ── Overall aggregates ──────────────────────────────────────────────────
  let overallTotal = 0, overallPass = 0, overallFail = 0, overallPctSum = 0;
  for (const c of presentClasses) {
    const d = classData.get(c)!;
    overallTotal += d.total;
    overallPass += d.passCount;
    overallFail += d.failCount;
    overallPctSum += d.avgPct * d.total;
  }
  const overallPassRate = overallTotal > 0 ? Math.round((overallPass / overallTotal) * 1000) / 10 : 0;
  const overallAvg = overallTotal > 0 ? Math.round((overallPctSum / overallTotal) * 10) / 10 : 0;
  const overallHighest = Math.max(...presentClasses.map((c) => classData.get(c)!.highest));
  const overallLowest = Math.min(...presentClasses.map((c) => classData.get(c)!.lowest || 100));

  // ══ Outer frame ═════════════════════════════════════════════════════════
  doc.setDrawColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.setLineWidth(0.8);
  doc.rect(5, 5, w - 10, h - 10);

  // ══ Header ═════════════════════════════════════════════════════════════
  doc.setDrawColor(PDF.gold[0], PDF.gold[1], PDF.gold[2]);
  doc.setLineWidth(1);
  doc.line(mx, 11, w - mx, 11);

  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 17, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
  doc.text("District Mohmand, Khyber Pakhtunkhwa  |  Established 2018", w / 2, 22, { align: "center" });

  doc.setFillColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
  doc.roundedRect(w / 2 - 62, 24.5, 124, 7.5, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("ALL CLASSES COMBINED RESULT ANALYTICS (6th \u2013 10th)", w / 2, 29.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
  doc.text(
    `Academic Year ${year}  |  ${presentClasses.map((c) => `Class ${c}`).join(", ")}  |  ${overallTotal} Students Total`,
    w / 2, 34.5, { align: "center" }
  );

  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, 36.5, w - mx, 36.5);

  let y = 38;

  // ══ Row 1: Overall KPI Strip (4 cards) ═════════════════════════════════
  const kpiW = (w - mx * 2 - 3 * 4) / 4;
  const kpiH = 14;
  const kpis: { label: string; value: string; sub: string; color: [number, number, number] }[] = [
    { label: "Overall Average", value: `${overallAvg}%`, sub: "Across all classes", color: PDF.navy },
    { label: "Overall Pass Rate", value: `${overallPassRate}%`, sub: `${overallPass} passed / ${overallFail} failed`, color: PDF.pass },
    { label: "Highest Score", value: `${overallHighest}%`, sub: "Best in school", color: PDF.gold },
    { label: "Lowest Score", value: `${overallLowest}%`, sub: "Needs attention", color: PDF.fail },
  ];
  kpis.forEach((k, i) => {
    const x = mx + i * (kpiW + 4);
    doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
    doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, kpiW, kpiH, 1.2, 1.2, "FD");
    doc.setFillColor(k.color[0], k.color[1], k.color[2]);
    doc.rect(x, y, 1.4, kpiH, "F");
    doc.setTextColor(k.color[0], k.color[1], k.color[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(k.value, x + kpiW / 2, y + 7.5, { align: "center" });
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5);
    doc.text(k.label.toUpperCase(), x + kpiW / 2, y + 10.5, { align: "center" });
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.setFontSize(4.5);
    doc.text(k.sub, x + kpiW / 2, y + 12.8, { align: "center" });
  });
  y += kpiH + 4;

  // ══ Row 2: Per-Class Summary Cards (5 compact cards side by side) ══════
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, y - 1, w - mx, y - 1);
  y += 1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("CLASS-WISE PERFORMANCE SNAPSHOT", mx, y + 3);
  y += 5;

  const clsCardW = (w - mx * 2 - 4 * 3) / 5;
  const clsCardH = 26;
  presentClasses.forEach((c, idx) => {
    const d = classData.get(c)!;
    const x = mx + idx * (clsCardW + 3);
    const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];

    // Card background
    doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
    doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
    doc.setLineWidth(0.15);
    doc.roundedRect(x, y, clsCardW, clsCardH, 1, 1, "FD");

    // Colored top strip
    doc.setFillColor(clr[0], clr[1], clr[2]);
    doc.roundedRect(x, y, clsCardW, 5.5, 1, 1, "F");
    doc.rect(x, y + 3, clsCardW, 2.5, "F");

    // Class title
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`CLASS ${c}`, x + clsCardW / 2, y + 3.8, { align: "center" });

    // Stats inside card
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`${d.avgPct}%`, x + clsCardW / 2, y + 11, { align: "center" });
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.8);
    doc.text("AVG", x + clsCardW / 2, y + 13.5, { align: "center" });

    // Mini row: Pass Rate | Students
    doc.setFontSize(5.5);
    doc.setTextColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
    doc.setFont("helvetica", "bold");
    doc.text(`${d.passRate}%`, x + clsCardW * 0.28, y + 17.5, { align: "center" });
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.2);
    doc.text("PASS", x + clsCardW * 0.28, y + 19.5, { align: "center" });

    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.text(`${d.total}`, x + clsCardW * 0.72, y + 17.5, { align: "center" });
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.2);
    doc.text("STUDENTS", x + clsCardW * 0.72, y + 19.5, { align: "center" });

    // Highest / Lowest mini
    doc.setFontSize(4.2);
    doc.setTextColor(PDF.gold[0], PDF.gold[1], PDF.gold[2]);
    doc.text(`H:${d.highest}%`, x + 4, y + 23.5);
    doc.setTextColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
    doc.text(`L:${d.lowest}%`, x + clsCardW - 4, y + 23.5, { align: "right" });
  });
  y += clsCardH + 4;

  // ══ Row 3: Two columns — Pass/Fail Donut + Class Comparison Bars ══════
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, y - 1, w - mx, y - 1);

  const row3Top = y + 1;
  const halfW = (w - mx * 2 - 6) / 2;

  // LEFT: Overall Pass/Fail Donut
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("OVERALL PASS / FAIL", mx, row3Top + 3);

  const donutCx = mx + halfW * 0.28;
  const donutCy = row3Top + 20;
  drawDonut(doc, donutCx, donutCy, 14, 7, [
    { value: overallPass, color: PDF.pass },
    { value: overallFail, color: PDF.fail },
  ]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text(`${overallPassRate}%`, donutCx, donutCy + 1, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4.5);
  doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
  doc.text("PASSED", donutCx, donutCy + 4.5, { align: "center" });

  // Donut legend
  const dlegX = donutCx + 20;
  doc.setFillColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
  doc.rect(dlegX, donutCy - 6, 2.5, 2.5, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text(`Passed: ${overallPass}`, dlegX + 4, donutCy - 4);
  doc.setFillColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
  doc.rect(dlegX, donutCy - 1, 2.5, 2.5, "F");
  doc.text(`Failed: ${overallFail}`, dlegX + 4, donutCy + 1);
  doc.setFillColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
  doc.rect(dlegX, donutCy + 4, 2.5, 2.5, "F");
  doc.text(`Total: ${overallTotal}`, dlegX + 4, donutCy + 6);

  // Per-class pass rate mini bars below donut
  const miniBarY = donutCy + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("CLASS PASS RATES", mx, miniBarY);
  const miniBarMaxW = halfW * 0.6;
  presentClasses.forEach((c, i) => {
    const d = classData.get(c)!;
    const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
    const by = miniBarY + 3 + i * 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.5);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(`${c}`, mx + 2, by + 2);
    // background bar
    doc.setFillColor(230, 230, 232);
    doc.roundedRect(mx + 6, by, miniBarMaxW, 2.5, 0.5, 0.5, "F");
    // fill bar
    const bw = (d.passRate / 100) * miniBarMaxW;
    if (bw > 0.5) {
      doc.setFillColor(clr[0], clr[1], clr[2]);
      doc.roundedRect(mx + 6, by, Math.max(bw, 1), 2.5, 0.5, 0.5, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.5);
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.text(`${d.passRate}%`, mx + 6 + miniBarMaxW + 2, by + 2);
  });

  // RIGHT: Class Comparison — Average & Pass Rate grouped vertical bars
  const rightX = mx + halfW + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("CLASS AVERAGE COMPARISON", rightX, row3Top + 3);

  const barChartX = rightX + 5;
  const barChartW = halfW - 10;
  const barChartH = 32;
  const barChartBaseY = row3Top + 6 + barChartH;

  // Grid lines
  doc.setDrawColor(235, 235, 235);
  doc.setLineWidth(0.12);
  [0, 25, 50, 75, 100].forEach((v) => {
    const gy = barChartBaseY - (v / 100) * barChartH;
    doc.line(barChartX, gy, barChartX + barChartW, gy);
    doc.setFontSize(4);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.text(`${v}`, barChartX - 2, gy + 0.8, { align: "right" });
  });

  // Vertical bars — one per class
  const vGap = 4;
  const vBarW = (barChartW - vGap * (presentClasses.length - 1)) / presentClasses.length;
  presentClasses.forEach((c, i) => {
    const d = classData.get(c)!;
    const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
    const bx = barChartX + i * (vBarW + vGap);
    const bh = (d.avgPct / 100) * barChartH;
    doc.setFillColor(clr[0], clr[1], clr[2]);
    doc.roundedRect(bx, barChartBaseY - bh, vBarW, Math.max(bh, 0.5), 0.6, 0.6, "F");
    // Value label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5);
    doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.text(`${d.avgPct}%`, bx + vBarW / 2, barChartBaseY - bh - 1.2, { align: "center" });
    // Class label
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.5);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(`Class ${c}`, bx + vBarW / 2, barChartBaseY + 3, { align: "center" });
  });

  // Below bar chart: Grade distribution grouped mini-bars
  const gradeSectionY = barChartBaseY + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("GRADE DISTRIBUTION (ALL CLASSES)", rightX, gradeSectionY);

  const gradeLabels = ["A+/A", "B", "C", "<40"];
  const gradeColors: [number, number, number][] = [PDF.pass, [59, 130, 246], [234, 179, 8], PDF.fail];
  const gradeMinWidth = halfW - 10;
  const gradeRowH = 3.5;
  gradeLabels.forEach((label, gi) => {
    const gy = gradeSectionY + 3 + gi * (gradeRowH + 1);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.2);
    doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
    doc.text(label, rightX, gy + 2);

    // Grouped mini-bars for each class
    const miniBarStartX = rightX + 12;
    const miniBarTotalW = gradeMinWidth - 12;
    const miniW = (miniBarTotalW - 1 * (presentClasses.length - 1)) / presentClasses.length;

    // Find max for this grade across classes for scaling
    const maxInGrade = Math.max(1, ...presentClasses.map((c) => {
      const d = classData.get(c)!;
      return d.gradeBuckets[gi]?.count ?? 0;
    }));

    presentClasses.forEach((c, ci) => {
      const d = classData.get(c)!;
      const count = d.gradeBuckets[gi]?.count ?? 0;
      const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
      const bx = miniBarStartX + ci * (miniW + 1);
      const bw = (count / maxInGrade) * miniW;
      doc.setFillColor(230, 230, 232);
      doc.roundedRect(bx, gy, miniW, gradeRowH, 0.4, 0.4, "F");
      if (bw > 0.3) {
        doc.setFillColor(clr[0], clr[1], clr[2]);
        doc.roundedRect(bx, gy, Math.max(bw, 0.5), gradeRowH, 0.4, 0.4, "F");
      }
      // Count on top
      doc.setFont("helvetica", "bold");
      doc.setFontSize(3.5);
      doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
      if (count > 0) doc.text(String(count), bx + miniW / 2, gy - 0.3, { align: "center" });
    });
  });

  y = Math.max(donutCy + 14 + 3 + presentClasses.length * 4 + 2, gradeSectionY + 3 + 4 * (gradeRowH + 1) + 3);
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, y, w - mx, y);
  y += 2;

  // ══ Row 4: Subject Averages — Two sections (6-8 and 9-10) ═════════════
  // If there isn't enough room left on this page for the subject-averages
  // block (it can run long with 10-11 subjects per group), start a fresh
  // page instead of letting it run off the bottom of the page.
  const subjHalfW = (w - mx * 2 - 6) / 2;
  const classes68 = presentClasses.filter((c) => ["6", "7", "8"].includes(c));
  const classes910 = presentClasses.filter((c) => ["9", "10"].includes(c));

  // Collect all unique subjects from present classes in each group
  const subjects68: string[] = [];
  const subjects910: string[] = [];
  for (const c of classes68) {
    for (const s of classData.get(c)!.subjectAverages) {
      if (!subjects68.includes(s.subject)) subjects68.push(s.subject);
    }
  }
  for (const c of classes910) {
    for (const s of classData.get(c)!.subjectAverages) {
      if (!subjects910.includes(s.subject)) subjects910.push(s.subject);
    }
  }

  // Estimate the height this section will actually need so we can decide
  // up front whether it fits on the current page.
  const maxSubjRowsEstimate = Math.max(subjects68.length, subjects910.length, 1);
  const subjRowHEstimate = Math.min(3.5, 38 / maxSubjRowsEstimate);
  const subjectSectionHeight = 6 /* title */ + maxSubjRowsEstimate * (subjRowHEstimate + 1) + 6 /* legend row */;
  const footerReserve = 14; // keep clear of the footer rule/text at page bottom

  if (y + subjectSectionHeight > h - footerReserve) {
    doc.addPage();
    doc.setDrawColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.setLineWidth(0.8);
    doc.rect(5, 5, w - 10, h - 10);
    y = my + 4;
    // Gold accent divider so the new page doesn't start completely bare
    doc.setDrawColor(PDF.gold[0], PDF.gold[1], PDF.gold[2]);
    doc.setLineWidth(0.8);
    doc.line(mx, y, w - mx, y);
    y += 6;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("SUBJECT-WISE CLASS AVERAGES", mx, y + 2);
  y += 4;

  // Helper: draw horizontal grouped bars for a subject group
  const drawSubjectGroup = (
    startX: number,
    startY: number,
    width: number,
    subjects: string[],
    classes: string[],
    title: string
  ) => {
    if (subjects.length === 0 || classes.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5);
      doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
      doc.text("No data available", startX + width / 2, startY + 10, { align: "center" });
      return;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(PDF.navy[0], PDF.navy[1], PDF.navy[2]);
    doc.text(title, startX, startY);

    const barAreaTop = startY + 3;
    const labelW = 22; // space for subject name on the left
    const barAreaW = width - labelW - 8; // leave room for value label
    const rowH = Math.min(3.5, 38 / subjects.length);
    const subBarH = rowH * 0.7;
    const subBarGap = 0.3;
    const classBarH = (subBarH - (classes.length - 1) * subBarGap) / classes.length;

    subjects.forEach((subj, si) => {
      const ry = barAreaTop + si * (rowH + 1);

      // Subject label
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4);
      doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
      const subjShort = subj.length > 12 ? subj.slice(0, 11) + "." : subj;
      doc.text(subjShort, startX, ry + rowH / 2 + 0.5);

      // Grouped bars per class
      classes.forEach((c, ci) => {
        const d = classData.get(c)!;
        const subjData = d.subjectAverages.find((s) => s.subject === subj);
        const avg = subjData?.average ?? 0;
        const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];

        const bx = startX + labelW;
        const bw = (avg / 100) * barAreaW;
        const by = ry + ci * (classBarH + subBarGap);

        // Background track
        doc.setFillColor(238, 238, 240);
        doc.roundedRect(bx, by, barAreaW, classBarH, 0.3, 0.3, "F");
        // Fill
        if (bw > 0.3) {
          doc.setFillColor(clr[0], clr[1], clr[2]);
          doc.roundedRect(bx, by, Math.max(bw, 0.5), classBarH, 0.3, 0.3, "F");
        }
      });

      // Show average of all classes for this subject at the end
      const allAvgs = classes.map((c) => {
        const d = classData.get(c)!;
        return d.subjectAverages.find((s) => s.subject === subj)?.average ?? 0;
      });
      const avgOfAvgs = allAvgs.length > 0 ? Math.round((allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length) * 10) / 10 : 0;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(3.8);
      doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
      doc.text(`${avgOfAvgs}%`, startX + labelW + barAreaW + 1.5, ry + rowH / 2 + 0.5);
    });

    // Class color legend
    const legY = barAreaTop + subjects.length * (rowH + 1) + 1;
    classes.forEach((c, ci) => {
      const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
      const lx = startX + ci * 22;
      doc.setFillColor(clr[0], clr[1], clr[2]);
      doc.roundedRect(lx, legY, 2.5, 2, 0.3, 0.3, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(3.8);
      doc.setTextColor(PDF.sub[0], PDF.sub[1], PDF.sub[2]);
      doc.text(`Class ${c}`, lx + 3.5, legY + 1.5);
    });
  };

  drawSubjectGroup(mx, y, subjHalfW, subjects68, classes68, "CLASSES 6 \u2013 8");
  drawSubjectGroup(mx + subjHalfW + 6, y, subjHalfW, subjects910, classes910, "CLASSES 9 \u2013 10");

  // Calculate how much vertical space the subject rows took
  const maxSubjRows = Math.max(subjects68.length, subjects910.length);
  y += 4 + maxSubjRows * (Math.min(3.5, 38 / Math.max(maxSubjRows, 1)) + 1) + 6;

  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, y, w - mx, y);
  y += 2;

  // If Row 5 (Top performers) and Row 6 (insights) won't fit either,
  // start those on a fresh page too rather than letting them spill over.
  const row5And6Height = 4 + 8 + 3 * 4.5 + 2 + 2 + 4 + 8 + 6;
  if (y + row5And6Height > h - footerReserve) {
    doc.addPage();
    doc.setDrawColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
    doc.setLineWidth(0.8);
    doc.rect(5, 5, w - 10, h - 10);
    y = my + 4;
    doc.setDrawColor(PDF.gold[0], PDF.gold[1], PDF.gold[2]);
    doc.setLineWidth(0.8);
    doc.line(mx, y, w - mx, y);
    y += 6;
  }

  // ══ Row 5: Top 3 Performers per Class (compact table) ═════════════════
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("TOP 3 PERFORMERS PER CLASS", mx, y + 2);
  y += 4;

  const topN = 3;
  const topColW = (w - mx * 2 - 4 * 3) / 5;
  presentClasses.forEach((c, idx) => {
    const d = classData.get(c)!;
    const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
    const x = mx + idx * (topColW + 3);

    // Column header
    doc.setFillColor(clr[0], clr[1], clr[2]);
    doc.roundedRect(x, y, topColW, 4.5, 0.8, 0.8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.text(`CLASS ${c}`, x + topColW / 2, y + 3, { align: "center" });

    // Sub-header
    doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
    doc.rect(x, y + 4.5, topColW, 3.5, "F");
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(3.8);
    doc.text("#", x + 3, y + 7);
    doc.text("Name", x + 8, y + 7);
    doc.text("%", x + topColW - 3, y + 7, { align: "right" });

    // Rows
    const top = d.topStudents.slice(0, topN);
    top.forEach((s, i) => {
      const ry = y + 8 + i * 4.5;
      if (i % 2 === 0) {
        doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
        doc.rect(x, ry, topColW, 4.5, "F");
      }

      // Medal badge
      const badgeCx = x + 3;
      const badgeCy = ry + 2;
      if (i === 0) {
        // Gold medal
        doc.setFillColor(212, 175, 55);
        doc.circle(badgeCx, badgeCy, 1.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(3.5);
        doc.text("1", badgeCx, badgeCy + 0.5, { align: "center" });
      } else if (i === 1) {
        doc.setFillColor(176, 176, 180);
        doc.circle(badgeCx, badgeCy, 1.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(3.5);
        doc.text("2", badgeCx, badgeCy + 0.5, { align: "center" });
      } else {
        doc.setFillColor(176, 116, 62);
        doc.circle(badgeCx, badgeCy, 1.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(3.5);
        doc.text("3", badgeCx, badgeCy + 0.5, { align: "center" });
      }

      // Name
      doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.2);
      const nameShort = s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name;
      doc.text(nameShort, x + 8, ry + 2.5);

      // Percentage
      doc.setTextColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
      doc.setFont("helvetica", "bold");
      doc.text(`${s.pct}%`, x + topColW - 3, ry + 2.5, { align: "right" });
    });

    // If less than 3 students, fill empty rows
    for (let i = top.length; i < topN; i++) {
      const ry = y + 8 + i * 4.5;
      doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4);
      doc.text("—", x + topColW / 2, ry + 2.5, { align: "center" });
    }
  });

  // ══ Row 6: Strongest / Weakest Subject Summary ════════════════════════
  y += 8 + topN * 4.5 + 2;
  doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
  doc.setLineWidth(0.2);
  doc.line(mx, y, w - mx, y);
  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(PDF.ink[0], PDF.ink[1], PDF.ink[2]);
  doc.text("SUBJECT INSIGHTS PER CLASS", mx, y + 2);
  y += 4;

  const insightColW = (w - mx * 2 - 4 * 3) / 5;
  presentClasses.forEach((c, idx) => {
    const d = classData.get(c)!;
    const clr = CLASS_COLORS[CLASS_ORDER.indexOf(c) % CLASS_COLORS.length];
    const x = mx + idx * (insightColW + 3);

    // Mini card
    doc.setFillColor(PDF.panel[0], PDF.panel[1], PDF.panel[2]);
    doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
    doc.setLineWidth(0.1);
    doc.roundedRect(x, y, insightColW, 8, 0.6, 0.6, "FD");
    doc.setFillColor(clr[0], clr[1], clr[2]);
    doc.rect(x, y, 1, 8, "F");

    if (d.strongestSubject) {
      doc.setFillColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
      doc.circle(x + 3, y + 2.5, 0.8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(3.8);
      doc.setTextColor(PDF.pass[0], PDF.pass[1], PDF.pass[2]);
      doc.text(`Strong: ${d.strongestSubject.subject} (${d.strongestSubject.average}%)`, x + 5, y + 3);
    }
    if (d.weakestSubject) {
      doc.setFillColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
      doc.circle(x + 3, y + 5.5, 0.8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(3.8);
      doc.setTextColor(PDF.fail[0], PDF.fail[1], PDF.fail[2]);
      doc.text(`Focus: ${d.weakestSubject.subject} (${d.weakestSubject.average}%)`, x + 5, y + 6);
    }
  });

  // ══ Footer (drawn on every page) ═══════════════════════════════════════
  // Kept clear of the outer frame's bottom edge (frame bottom = h - 5), so
  // the rule line and text both sit fully inside the border instead of
  // overlapping it.
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(PDF.rule[0], PDF.rule[1], PDF.rule[2]);
    doc.setLineWidth(0.25);
    doc.line(mx, h - 10, w - mx, h - 10);
    doc.setTextColor(PDF.muted[0], PDF.muted[1], PDF.muted[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text("GHS Babi Khel \u2014 Official All Classes Combined Result Analytics", mx, h - 7);
    doc.text(
      `Generated: ${new Date().toLocaleDateString("en-GB")}`,
      w / 2, h - 7, { align: "center" }
    );
    doc.text(`Page ${p} / ${pageCount}`, w - mx, h - 7, { align: "right" });
  }

  doc.save(`AllClasses_Analytics_${year}.pdf`);
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface ClassAnalyticsPdfButtonProps {
  year: number;
}

const ALL_CLASSES = ["6", "7", "8", "9", "10"];
const ALL_CLASSES_KEY = "all";

/**
 * Mobile-friendly analytics export (used inside the DMCs sub-tab). Lets the
 * admin pick one or more classes from a checkbox grid — same pattern as the
 * Schedule Publish / Bulk Delete pickers elsewhere in Manage Results — then
 * downloads a single-page vector Class Analytics PDF for each selected
 * class in turn. Each class's results are fetched fresh at click time
 * (not the currently-open class tab), so multiple classes can be exported
 * in one go regardless of which class tab is active.
 *
 * Also provides an "All Classes" button that downloads a SINGLE combined
 * analytics PDF covering classes 6-10 on ONE beautifully designed page
 * (landscape A4) with: overall KPIs, per-class summary cards, pass/fail
 * donut, class comparison bars, grade distribution, subject-wise grouped
 * bars, top 3 performers per class, and subject insights.
 */
export default function ClassAnalyticsPdfButton({ year }: ClassAnalyticsPdfButtonProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchClassResults = async (cls: string): Promise<ResultWithStudent[]> => {
    const { data, error } = await supabase
      .from("results")
      .select(
        "id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, is_pass, subject_marks, students(full_name, roll_number)"
      )
      .eq("class", cls)
      .eq("year", year);
    if (error) throw error;
    return (data ?? []) as unknown as ResultWithStudent[];
  };

  const handleExport = async () => {
    if (selectedClasses.length === 0) return;

    // "All Classes" selected — generate the single combined landscape PDF
    // instead of per-class PDFs. If it's mixed with individual classes in
    // selectedClasses, "All Classes" takes priority since it already
    // covers every class.
    if (selectedClasses.includes(ALL_CLASSES_KEY)) {
      setIsExporting(true);
      try {
        await ensureJsPDF();
        const classDataMap = new Map<string, ReturnType<typeof computeAnalyticsPdfData>>();
        for (const cls of ALL_CLASSES) {
          const subjects = getSubjects(cls);
          const results = await fetchClassResults(cls);
          if (results.length > 0) {
            const pdfData = computeAnalyticsPdfData({ cls, year, subjects, results });
            classDataMap.set(cls, pdfData);
          }
        }
        if (classDataMap.size > 0) {
          generateAllClassesCombinedPdf(year, classDataMap);
        }
        setShowPicker(false);
      } finally {
        setIsExporting(false);
        setProgress(null);
      }
      return;
    }

    setIsExporting(true);
    setProgress({ done: 0, total: selectedClasses.length });
    try {
      await ensureJsPDF();
      for (let i = 0; i < selectedClasses.length; i++) {
        const cls = selectedClasses[i];
        const subjects = getSubjects(cls);
        const results = await fetchClassResults(cls);
        if (results.length > 0) {
          const pdfData = computeAnalyticsPdfData({ cls, year, subjects, results });
          generateClassAnalyticsPdf(pdfData);
          // Small delay between downloads so the browser doesn't drop or
          // block back-to-back file saves when multiple classes are picked.
          await new Promise((r) => setTimeout(r, 350));
        }
        setProgress({ done: i + 1, total: selectedClasses.length });
      }
      setShowPicker(false);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => { setSelectedClasses([]); setShowPicker(true); }}
          className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm"
          size="sm"
        >
          <FileDown className="w-4 h-4" />
          Download Analytics Report (PDF)
        </Button>
      </div>

      <Dialog open={showPicker} onOpenChange={(open) => { if (!isExporting) setShowPicker(open); }}>
        <DialogContent className="max-w-sm w-[92vw] sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileDown className="w-4 h-4 text-primary" /> Class Analytics — {year}
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground -mt-2">
            Pick one or more classes, or choose "All Classes" for a single
            combined report covering every class on one page.
          </p>

          <div>
            <label className="text-xs font-semibold text-foreground">Classes</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1.5">
              {ALL_CLASSES.map((c) => {
                const checked = selectedClasses.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={isExporting}
                    onClick={() =>
                      setSelectedClasses((prev) =>
                        checked ? prev.filter((x) => x !== c) : [...prev.filter((x) => x !== ALL_CLASSES_KEY), c]
                      )
                    }
                    className={`rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      checked
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-background border-input text-foreground"
                    }`}
                  >
                    Class {c}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  setSelectedClasses((prev) =>
                    prev.includes(ALL_CLASSES_KEY) ? [] : [ALL_CLASSES_KEY]
                  )
                }
                className={`col-span-3 sm:col-span-5 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  selectedClasses.includes(ALL_CLASSES_KEY)
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-input text-foreground"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                All Classes (6–10, combined report)
              </button>
            </div>
            <div className="flex gap-3 mt-2">
              <button type="button" disabled={isExporting} className="text-xs text-primary font-medium disabled:opacity-50" onClick={() => setSelectedClasses(ALL_CLASSES)}>Select All</button>
              <button type="button" disabled={isExporting} className="text-xs text-muted-foreground font-medium disabled:opacity-50" onClick={() => setSelectedClasses([])}>Clear</button>
            </div>
          </div>

          <Button
            disabled={selectedClasses.length === 0 || isExporting}
            onClick={handleExport}
            className="w-full justify-center gap-2 mt-1"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {selectedClasses.includes(ALL_CLASSES_KEY)
                  ? "Generating combined report..."
                  : progress ? `Generating ${progress.done}/${progress.total}...` : "Generating..."}
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                {selectedClasses.includes(ALL_CLASSES_KEY)
                  ? "Download Combined Report"
                  : `Download${selectedClasses.length > 1 ? ` (${selectedClasses.length} classes)` : ""}`}
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
