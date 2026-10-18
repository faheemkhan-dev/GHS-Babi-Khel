/**
 * pdfHelpers.ts — shared premium PDF building blocks for exam reports
 * (extracted from AdminExamRollNumbers.tsx; no behaviour change).
 */
import jsPDF from "jspdf";
import { format as formatDateFns } from "date-fns";

// ── Shared premium PDF helpers (attendance reports) ──────────────────────────
export type RGB = [number, number, number];
export const PDF_INK: RGB = [0, 0, 0];
export const PDF_ACCENT: RGB = [0, 0, 0];
export const PDF_MUTED: RGB = [95, 95, 95];
export const PDF_LINE: RGB = [165, 165, 165];

export function safeFile(name: string): string {
  return name.replace(/[^\w\-. ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "report";
}

/** Plain black-and-white letterhead. Returns the Y position where content may start. */
export function pdfBrandHeader(doc: jsPDF, reportTitle: string, subtitle: string): number {
  const w = doc.internal.pageSize.getWidth();
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("GOVT. HIGH SCHOOL BABI KHEL", w / 2, 13, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  doc.text("District Mohmand, Khyber Pakhtunkhwa", w / 2, 18.5, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.text(reportTitle, w / 2, 25.5, { align: "center", charSpace: 0.4 } as any);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.line(12, 29, w - 12, 29);
  doc.setLineWidth(0.2);
  doc.line(12, 30.3, w - 12, 30.3);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(subtitle, w / 2, 36.5, { align: "center" });
    return 41;
  }
  return 36;
}

/** A row of rounded KPI tiles. Returns the Y position just below the tiles. */
export function pdfSummaryTiles(doc: jsPDF, y: number, tiles: { label: string; value: string; color?: RGB }[], margin = 12): number {
  const w = doc.internal.pageSize.getWidth();
  const gap = 4;
  const tw = (w - margin * 2 - gap * (tiles.length - 1)) / tiles.length;
  const th = 17;
  tiles.forEach((t, i) => {
    const x = margin + i * (tw + gap);
    doc.setDrawColor(...PDF_LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, tw, th, 2, 2, "S");
    const c: RGB = [0, 0, 0];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(t.label.toUpperCase(), x + tw / 2, y + 6, { align: "center", charSpace: 0.3 } as any);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...c);
    doc.text(t.value, x + tw / 2, y + 13.2, { align: "center" });
  });
  return y + th + 5;
}

/** Footer on every page: rule, school/report label, page x/y, generated stamp. */
export function pdfFooters(doc: jsPDF, label: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const total = (doc as any).internal.getNumberOfPages();
  const stamp = formatDateFns(new Date(), "dd MMM yyyy, hh:mm a");
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...PDF_LINE);
    doc.setLineWidth(0.3);
    doc.line(12, h - 12, w - 12, h - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`GHS Babi Khel  ·  ${label}`, 12, h - 7.5);
    doc.text(`Generated ${stamp}`, w / 2, h - 7.5, { align: "center" });
    doc.text(`Page ${p} of ${total}`, w - 12, h - 7.5, { align: "right" });
  }
}

/** Signature block placed after the table; moves to a new page if there is no room. */
export function pdfSignatures(doc: jsPDF, afterY: number, labels: string[]) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  let y = afterY + 28;
  if (y > h - 24) { doc.addPage(); y = 50; }
  const margin = 18;
  const colW = (w - margin * 2) / labels.length;
  const lineW = Math.min(34, colW - 40);            // short lines, wide gaps between signers
  labels.forEach((l, i) => {
    const x0 = margin + i * colW + (colW - lineW) / 2;
    const x1 = x0 + lineW;
    doc.setDrawColor(90, 98, 115);
    doc.setLineWidth(0.35);
    doc.line(x0, y, x1, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_INK);
    doc.text(l, (x0 + x1) / 2, y + 4.5, { align: "center" });
  });
}

// ── Countdown display component ──────────────────────────────────────────────
