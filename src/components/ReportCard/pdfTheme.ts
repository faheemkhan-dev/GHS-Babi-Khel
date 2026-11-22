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
  // Deep green is an ACCENT only (thin top bar, headings, emblem) — never a big fill.
  greenDeep: [14, 70, 50] as RGB,
  green: [22, 101, 72] as RGB,
  greenSoft: [247, 249, 248] as RGB,
  gold: [168, 122, 10] as RGB,
  goldLine: [212, 175, 55] as RGB,
  goldSoft: [253, 247, 227] as RGB,
  ink: [17, 24, 39] as RGB,
  text: [30, 41, 59] as RGB,
  muted: [107, 114, 128] as RGB,
  border: [229, 233, 231] as RGB,
  stripe: [250, 251, 250] as RGB,
  head: [241, 245, 242] as RGB,
  track: [233, 237, 235] as RGB,
  white: [255, 255, 255] as RGB,
  pass: [21, 128, 61] as RGB,
  passSoft: [232, 247, 237] as RGB,
  fail: [185, 28, 28] as RGB,
  failSoft: [253, 237, 237] as RGB,
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

/** Left-aligned text that shrinks (down to minSize) to fit maxW; wraps if it
 *  still does not fit. Returns the y of the line after the last one drawn. */
export function fitLeftText(
  d: jsPDF, text: string, x: number, y: number, maxW: number,
  startSize: number, minSize: number, lineGap = 1.15
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
    d.text(ln, x, yy);
    yy += size * lineGap;
  }
  return yy;
}

const todayLabel = () =>
  new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Compact, light header: hairline accent bar, small emblem, left-aligned
 *  title block and the generation date on the right. Returns the y where
 *  content may start. (Deliberately NOT a big solid-green block.) */
export function drawBand(
  d: jsPDF,
  o: { eyebrow: string; title: string; subtitle: string }
): number {
  const H = 76;
  // thin top accent: deep green + gold hairline
  fill(d, T.greenDeep);
  d.rect(0, 0, A4_W, 4, "F");
  fill(d, T.goldLine);
  d.rect(0, 4, A4_W, 1.2, "F");

  // emblem
  const ex = MARGIN, ey = 20, es = 34;
  fill(d, T.greenDeep);
  d.roundedRect(ex, ey, es, es, 8, 8, "F");
  stroke(d, T.goldLine, 0.9);
  d.circle(ex + es / 2, ey + es / 2, 11, "S");
  d.setFont("helvetica", "bold");
  d.setFontSize(6.6);
  ink(d, T.white);
  d.text("GHS", ex + es / 2, ey + es / 2 + 2.3, { align: "center" });

  const tx = MARGIN + es + 12;
  d.setFont("helvetica", "bold");
  d.setFontSize(7);
  ink(d, T.gold);
  d.setCharSpace(1.5);
  d.text(o.eyebrow.toUpperCase(), tx, 27);
  d.setCharSpace(0);

  d.setFont("helvetica", "bold");
  ink(d, T.ink);
  const after = fitLeftText(d, o.title, tx, 44, CONTENT_W - es - 12 - 100, 15.5, 11);

  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  ink(d, T.muted);
  d.text(o.subtitle, tx, Math.min(after + 3, H - 8));

  // generated date (right)
  d.setFont("helvetica", "normal");
  d.setFontSize(7);
  ink(d, T.muted);
  d.text(`Generated ${todayLabel()}`, A4_W - MARGIN, 27, { align: "right" });

  // base hairline + short gold segment
  stroke(d, T.border, 0.7);
  d.line(MARGIN, H, A4_W - MARGIN, H);
  fill(d, T.goldLine);
  d.roundedRect(MARGIN, H - 1.1, 64, 2.2, 1.1, 1.1, "F");
  return H + 20;
}

/** Slim continuation band for pages 2+ (light). */
export function drawSlimBand(d: jsPDF, label: string): void {
  fill(d, T.greenDeep);
  d.rect(0, 0, A4_W, 3, "F");
  fill(d, T.goldLine);
  d.rect(0, 3, A4_W, 1, "F");
  d.setFont("helvetica", "bold");
  d.setFontSize(8);
  ink(d, T.muted);
  d.text(label, MARGIN, 19, { maxWidth: CONTENT_W });
  stroke(d, T.border, 0.6);
  d.line(MARGIN, SLIM_H - 3, A4_W - MARGIN, SLIM_H - 3);
}

/** Section title: gold marker + bold heading, hairline running to the right
 *  margin. Returns next y. */
export function sectionTitle(d: jsPDF, text: string, y: number): number {
  fill(d, T.goldLine);
  d.roundedRect(MARGIN, y - 9, 3, 11.5, 1.5, 1.5, "F");
  d.setFont("helvetica", "bold");
  d.setFontSize(9.5);
  ink(d, T.greenDeep);
  d.setCharSpace(0.5);
  d.text(text, MARGIN + 10, y);
  d.setCharSpace(0);
  const w = d.getTextWidth(text) + text.length * 0.5;
  stroke(d, T.border, 0.7);
  d.line(MARGIN + 10 + w + 8, y - 3.2, A4_W - MARGIN, y - 3.2);
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
    fill(d, T.white);
    stroke(d, T.border, 0.8);
    d.roundedRect(x, y, w, h, 6, 6, "FD");
    d.setFont("helvetica", "bold");
    d.setFontSize(6.4);
    ink(d, T.muted);
    d.setCharSpace(0.6);
    d.text(t.label.toUpperCase(), x + w / 2, y + 16, { align: "center", maxWidth: w - 6 });
    d.setCharSpace(0);
    d.setFont("helvetica", "bold");
    ink(d, t.color ?? T.ink);
    fitCenteredText(d, t.value, x + w / 2, y + 34, w - 8, 15.5, 9);
    // tiny accent underline
    fill(d, t.color ?? T.goldLine);
    d.roundedRect(x + w / 2 - 8, y + h - 8, 16, 1.8, 0.9, 0.9, "F");
  });
  return y + h + 14;
}

/** Footer on every page: hairline, school/title left, page x of y right. */
export function drawFooters(d: jsPDF, leftText: string): void {
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    stroke(d, T.border, 0.7);
    d.line(MARGIN, FOOTER_Y - 10, A4_W - MARGIN, FOOTER_Y - 10);
    fill(d, T.goldLine);
    d.roundedRect(MARGIN, FOOTER_Y - 11.1, 40, 2.2, 1.1, 1.1, "F");
    d.setFont("helvetica", "normal");
    d.setFontSize(7.5);
    ink(d, T.muted);
    d.text(leftText, MARGIN, FOOTER_Y, { maxWidth: CONTENT_W - 70 });
    d.text(`Page ${i} of ${n}`, A4_W - MARGIN, FOOTER_Y, { align: "right" });
  }
}

/** Shared autoTable options: airy horizontal-rules-only tables, a LIGHT header
 *  with a gold underline, everything centred, explicit full width, identical
 *  left/right margins, wrapped text. */
export function tableBase(d: jsPDF, opts: { slimLabel?: string; marginTop?: number } = {}) {
  const top = opts.marginTop ?? SLIM_H + 14;
  return {
    theme: "plain" as const,
    tableWidth: CONTENT_W,
    margin: { left: MARGIN, right: MARGIN, top, bottom: 40 },
    showHead: "everyPage" as const,
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 5.2, bottom: 5.2, left: 3, right: 3 },
      halign: "center" as const,
      valign: "middle" as const,
      lineColor: T.border,
      lineWidth: { top: 0, right: 0, bottom: 0.6, left: 0 },
      textColor: T.ink,
      overflow: "linebreak" as const,
    },
    headStyles: {
      fillColor: T.head,
      textColor: T.greenDeep,
      fontStyle: "bold" as const,
      fontSize: 7.6,
      halign: "center" as const,
      valign: "middle" as const,
      lineColor: T.goldLine,
      lineWidth: { top: 0, right: 0, bottom: 1.4, left: 0 },
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
