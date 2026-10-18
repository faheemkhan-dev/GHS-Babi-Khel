// src/components/ReportCard/pdfTheme.ts
// Shared A4 design system for every Report Card PDF (single-class + combined).
//
// One place for: page geometry, the green & gold palette, the header band,
// KPI tiles, section titles, the footer, and the table defaults — so both PDFs
// always look like the same product and stay mathematically centred on A4.
//
// Geometry: A4 portrait = 595.28 × 841.89 pt. Left and right margins are
// IDENTICAL (MARGIN) and every table is given an explicit tableWidth equal to
// CONTENT_W, so all content sits exactly centred on the page.
//
// jsPDF is imported as a TYPE only here; the library itself is lazy-loaded by
// the generators at download time (keeps the Results route chunk small).
import type { jsPDF } from "jspdf";
import type { NormalizedResult } from "./types";

export type RGB = [number, number, number];

export const A4_W = 595.28;
export const A4_H = 841.89;
export const MARGIN = 34;
export const CONTENT_W = A4_W - MARGIN * 2; // 527.28
export const FOOTER_Y = A4_H - 22;
/** Lowest y that content may reach before a new page is needed. */
export const SAFE_BOTTOM = A4_H - 44;
/** Height of the slim continuation band drawn on pages 2+. */
export const SLIM_H = 30;

export const T = {
  greenDeep: [12, 58, 40] as RGB,
  green: [22, 101, 72] as RGB,
  greenSoft: [236, 246, 240] as RGB,
  gold: [184, 134, 11] as RGB,
  goldLine: [212, 175, 55] as RGB,
  goldSoft: [251, 243, 214] as RGB,
  ink: [15, 23, 42] as RGB,
  text: [30, 41, 59] as RGB,
  muted: [100, 116, 139] as RGB,
  border: [214, 224, 218] as RGB,
  stripe: [246, 250, 247] as RGB,
  white: [255, 255, 255] as RGB,
  pass: [21, 128, 61] as RGB,
  passSoft: [220, 252, 231] as RGB,
  fail: [185, 28, 28] as RGB,
  failSoft: [254, 226, 226] as RGB,
};

export const fill = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
export const stroke = (d: jsPDF, c: RGB, w = 0.5) => {
  d.setDrawColor(c[0], c[1], c[2]);
  d.setLineWidth(w);
};
export const ink = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

/** Draws centred text that is shrunk (down to minSize) so it NEVER overflows
 *  maxW; if it still does not fit it wraps onto extra lines. Returns the y of
 *  the line after the last one drawn. */
export function fitCenteredText(
  d: jsPDF,
  text: string,
  cx: number,
  y: number,
  maxW: number,
  startSize: number,
  minSize: number,
  lineGap = 1.15
): number {
  let size = startSize;
  d.setFontSize(size);
  while (size > minSize && d.getTextWidth(text) > maxW) {
    size -= 0.5;
    d.setFontSize(size);
  }
  const lines: string[] = d.getTextWidth(text) > maxW ? d.splitTextToSize(text, maxW) : [text];
  let yy = y;
  for (const ln of lines) {
    d.text(ln, cx, yy, { align: "center" });
    yy += size * lineGap;
  }
  return yy;
}

/** Full-width premium header band. Returns the y where content may start. */
export function drawBand(
  d: jsPDF,
  o: { eyebrow: string; title: string; subtitle: string }
): number {
  const H = 108;
  fill(d, T.greenDeep);
  d.rect(0, 0, A4_W, H, "F");
  // soft decorative gold arcs (pure vectors, print-friendly)
  // Both circles stay fully INSIDE the band (a circle spilling below it would
  // show through behind the tiles / labels that follow).
  fill(d, [18, 78, 54]);
  d.circle(A4_W - 14, 0, 62, "F");
  d.circle(10, 0, 44, "F");
  // gold rule
  fill(d, T.goldLine);
  d.rect(0, H, A4_W, 3, "F");

  const cx = A4_W / 2;
  d.setFont("helvetica", "bold");
  d.setFontSize(7.5);
  ink(d, T.goldLine);
  d.setCharSpace(1.6);
  d.text(o.eyebrow.toUpperCase(), cx, 26, { align: "center" });
  d.setCharSpace(0);

  d.setFont("helvetica", "bold");
  ink(d, T.white);
  const after = fitCenteredText(d, o.title, cx, 54, CONTENT_W - 30, 19, 12);

  d.setFont("helvetica", "normal");
  d.setFontSize(10);
  ink(d, [226, 236, 229]);
  d.text(o.subtitle, cx, Math.min(after + 6, H - 14), { align: "center" });
  return H + 3 + 16;
}

/** Slim continuation band for pages 2+. */
export function drawSlimBand(d: jsPDF, label: string): void {
  fill(d, T.greenDeep);
  d.rect(0, 0, A4_W, SLIM_H, "F");
  fill(d, T.goldLine);
  d.rect(0, SLIM_H, A4_W, 1.6, "F");
  d.setFont("helvetica", "bold");
  d.setFontSize(8.5);
  ink(d, T.white);
  d.text(label, A4_W / 2, 19, { align: "center", maxWidth: CONTENT_W });
}

/** Centred section title flanked by thin gold rules. Returns next y. */
export function sectionTitle(d: jsPDF, text: string, y: number): number {
  const cx = A4_W / 2;
  d.setFont("helvetica", "bold");
  d.setFontSize(10.5);
  const w = d.getTextWidth(text);
  ink(d, T.greenDeep);
  d.text(text, cx, y, { align: "center" });
  stroke(d, T.goldLine, 0.9);
  const gap = 10;
  const half = w / 2 + gap;
  d.line(MARGIN, y - 3.5, cx - half, y - 3.5);
  d.line(cx + half, y - 3.5, A4_W - MARGIN, y - 3.5);
  return y + 10;
}

export interface Tile {
  label: string;
  value: string;
  color?: RGB;
}

/** Equal-width KPI tiles spanning exactly CONTENT_W. Returns next y. */
export function kpiTiles(d: jsPDF, y: number, tiles: Tile[], h = 50): number {
  const gap = 6;
  const w = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = MARGIN + i * (w + gap);
    fill(d, T.greenSoft);
    stroke(d, T.border, 0.6);
    d.roundedRect(x, y, w, h, 5, 5, "FD");
    fill(d, T.goldLine);
    d.roundedRect(x + w / 2 - 11, y, 22, 2.6, 1.3, 1.3, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(6.8);
    ink(d, T.muted);
    d.text(t.label.toUpperCase(), x + w / 2, y + 19, { align: "center", maxWidth: w - 6 });
    d.setFont("helvetica", "bold");
    ink(d, t.color ?? T.ink);
    fitCenteredText(d, t.value, x + w / 2, y + 38, w - 8, 15, 9);
  });
  return y + h + 14;
}

/** Footer on every page: gold rule, school/title left, page x of y right. */
export function drawFooters(d: jsPDF, leftText: string): void {
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    stroke(d, T.goldLine, 0.8);
    d.line(MARGIN, FOOTER_Y - 10, A4_W - MARGIN, FOOTER_Y - 10);
    d.setFont("helvetica", "normal");
    d.setFontSize(7.5);
    ink(d, T.muted);
    d.text(leftText, MARGIN, FOOTER_Y, { maxWidth: CONTENT_W - 70 });
    d.text(`Page ${i} of ${n}`, A4_W - MARGIN, FOOTER_Y, { align: "right" });
  }
}

/** Shared autoTable options: everything centred (horizontally + vertically),
 *  explicit full-width table, identical left/right margins, wrapped text. */
export function tableBase(d: jsPDF, opts: { slimLabel?: string; marginTop?: number } = {}) {
  const top = opts.marginTop ?? SLIM_H + 14;
  return {
    theme: "grid" as const,
    tableWidth: CONTENT_W,
    margin: { left: MARGIN, right: MARGIN, top, bottom: 40 },
    showHead: "everyPage" as const,
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 4.6, bottom: 4.6, left: 3, right: 3 },
      halign: "center" as const,
      valign: "middle" as const,
      lineColor: T.border,
      lineWidth: 0.4,
      textColor: T.ink,
      overflow: "linebreak" as const,
    },
    headStyles: {
      fillColor: T.greenDeep,
      textColor: T.white,
      fontStyle: "bold" as const,
      fontSize: 8,
      halign: "center" as const,
      valign: "middle" as const,
      lineColor: T.greenDeep,
    },
    alternateRowStyles: { fillColor: T.stripe },
    // Called by autoTable after it finishes each page. The slim band lives in
    // the reserved top margin, so it can never overlap a table row.
    didDrawPage: (data: { pageNumber: number }) => {
      if (opts.slimLabel && data.pageNumber > 1) drawSlimBand(d, opts.slimLabel);
    },
  };
}

/** Competition ranking by total marks (ties share a position). Rows that are
 *  not found / have no marks get pos = null and are listed last. */
export function rankResults(
  results: NormalizedResult[]
): Array<{ r: NormalizedResult; pos: number | null }> {
  const sorted = [...results].sort((a, b) => {
    const as = a.found && a.totalMarks > 0 ? a.totalMarks : -1;
    const bs = b.found && b.totalMarks > 0 ? b.totalMarks : -1;
    return bs - as;
  });
  let lastScore: number | null = null;
  let lastPos = 0;
  return sorted.map((r, i) => {
    if (!(r.found && r.totalMarks > 0)) return { r, pos: null };
    if (lastScore === null || r.totalMarks !== lastScore) {
      lastPos = i + 1;
      lastScore = r.totalMarks;
    }
    return { r, pos: lastPos };
  });
}

export function safeFilePart(s: string): string {
  return s.replace(/[^a-z0-9-]/gi, "_");
}
