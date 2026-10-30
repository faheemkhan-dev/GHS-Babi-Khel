/**
 * feePdf.ts — every Fee Management PDF (vouchers + reports) in one place.
 * Premium, centred layout: deep-green accent, a little gold, serif headings.
 * jsPDF is loaded on demand so it never weighs down the admin bundle.
 */
import { format } from "date-fns";
import type { FeeVoucher } from "@/hooks/useFees";

type RGB = [number, number, number];
const C = {
  ink: [26, 26, 26] as RGB,
  sub: [92, 92, 92] as RGB,
  muted: [128, 128, 128] as RGB,
  green: [20, 83, 45] as RGB,
  gold: [168, 130, 40] as RGB,
  goldTint: [251, 245, 226] as RGB,
  alt: [248, 248, 246] as RGB,
  grid: [220, 220, 216] as RGB,
  red: [150, 30, 30] as RGB,
  white: [255, 255, 255] as RGB,
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const rs = (n: number) => `Rs. ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

async function lib() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { jsPDF, autoTable };
}
type Doc = InstanceType<Awaited<ReturnType<typeof lib>>["jsPDF"]>;
const fill = (d: Doc, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const draw = (d: Doc, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const ink = (d: Doc, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

// ───────────────────────── Vouchers ─────────────────────────
function paymentLine(v: FeeVoucher): string {
  const b = v.bank_details || {};
  const methods = Array.isArray(b.payment_methods) ? b.payment_methods : [];
  const parts: string[] = [];
  if (b.bank_name) {
    parts.push([`${b.bank_name}`, b.account_title && `Title: ${b.account_title}`, b.account_number && `A/C: ${b.account_number}`, b.iban && `IBAN: ${b.iban}`].filter(Boolean).join("   |   "));
  }
  methods.forEach((m) => {
    if (m.type === "bank") parts.push([m.bank_name, m.account_title && `Title: ${m.account_title}`, m.account_number && `A/C: ${m.account_number}`, m.iban && `IBAN: ${m.iban}`].filter(Boolean).join("   |   "));
    else if (m.type === "easypaisa" || m.type === "jazzcash") parts.push(`${m.type === "easypaisa" ? "EasyPaisa" : "JazzCash"}: ${[m.account_name, m.phone].filter(Boolean).join("  ")}`);
    else if (m.type === "other") parts.push([m.label, m.instructions].filter(Boolean).join(": "));
  });
  return parts.filter(Boolean).join("     ") || "Pay at the school office during working hours.";
}

function drawVoucherCopy(doc: Doc, autoTable: any, v: FeeVoucher, y0: number, copy: string) {
  const w = 210;
  const m = 12;
  const inner = w - m * 2;
  const name = v.students?.full_name || "—";
  const total = Number(v.total_amount) + Number(v.late_fee || 0);
  const paid = Number(v.paid_amount || 0);
  const balance = Math.max(0, total - paid);

  // Frame + header
  draw(doc, C.grid); doc.setLineWidth(0.4);
  doc.roundedRect(m, y0, inner, 124, 2, 2, "S");
  fill(doc, C.green);
  doc.roundedRect(m, y0, inner, 15, 2, 2, "F");
  doc.rect(m, y0 + 8, inner, 7, "F");
  ink(doc, C.white);
  doc.setFont("times", "bold"); doc.setFontSize(14);
  doc.text("GHS BABI KHEL", w / 2, y0 + 7.5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
  doc.text("GOVERNMENT HIGH SCHOOL  ·  DISTRICT MOHMAND  ·  KHYBER PAKHTUNKHWA", w / 2, y0 + 12, { align: "center" });
  fill(doc, C.gold); doc.rect(m, y0 + 15, inner, 0.8, "F");

  // Title + copy label
  ink(doc, C.ink); doc.setFont("times", "bold"); doc.setFontSize(15);
  doc.text("FEE VOUCHER", w / 2, y0 + 24, { align: "center" });
  ink(doc, C.gold); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  doc.text(copy.toUpperCase(), w - m - 4, y0 + 22, { align: "right" });
  ink(doc, C.muted); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text(`No. ${v.voucher_number}`, w / 2, y0 + 29, { align: "center" });

  // Info grid (centred cells)
  const cells: [string, string][] = [
    ["STUDENT", name],
    ["FATHER", v.students?.father_name || "—"],
    ["CLASS", v.class],
    ["ROLL NO", v.students?.roll_number || "—"],
    ["FEE MONTH", v.fee_period === "one_off" ? "One-off charge" : `${MONTHS[(v.month || 1) - 1]} ${v.year}`],
    ["DUE DATE", v.due_date ? format(new Date(v.due_date), "dd MMM yyyy") : "—"],
  ];
  const cw = inner / 3, gy = y0 + 33, ch = 12;
  cells.forEach(([label, value], i) => {
    const cx = m + (i % 3) * cw, cy = gy + Math.floor(i / 3) * ch;
    fill(doc, i % 2 === 0 ? C.alt : C.white); draw(doc, C.grid); doc.setLineWidth(0.2);
    doc.rect(cx, cy, cw, ch, "FD");
    ink(doc, C.muted); doc.setFont("helvetica", "bold"); doc.setFontSize(6);
    doc.text(label, cx + cw / 2, cy + 4.2, { align: "center" });
    ink(doc, C.ink); doc.setFont("times", "bold"); doc.setFontSize(10);
    doc.text(String(value), cx + cw / 2, cy + 9.2, { align: "center", maxWidth: cw - 4 });
  });

  // Items
  const items = (v.fee_items || []).map((f, i) => [String(i + 1), f.label, rs(f.amount)]);
  if (Number(v.late_fee) > 0) items.push([String(items.length + 1), "Late fee", rs(Number(v.late_fee))]);
  autoTable(doc, {
    startY: gy + ch * 2 + 4,
    margin: { left: m, right: m },
    tableWidth: inner,
    theme: "grid",
    head: [["#", "Description", "Amount"]],
    body: items.length ? items : [["—", "No items", "—"]],
    styles: { font: "helvetica", fontSize: 8.5, halign: "center", valign: "middle", cellPadding: 1.8, lineColor: C.grid, lineWidth: 0.15, textColor: C.ink },
    headStyles: { fillColor: C.green, textColor: C.white, fontStyle: "bold", fontSize: 8, lineColor: C.green },
    alternateRowStyles: { fillColor: C.alt },
    columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: "auto" }, 2: { cellWidth: 40 } },
  });
  let y = ((doc as any).lastAutoTable?.finalY ?? y0 + 80) + 3;

  // Total strip
  fill(doc, C.goldTint); draw(doc, C.gold); doc.setLineWidth(0.3);
  doc.roundedRect(m, y, inner, 10, 1.5, 1.5, "FD");
  ink(doc, C.ink); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("TOTAL PAYABLE", m + inner * 0.2, y + 6.3, { align: "center" });
  doc.setFont("times", "bold"); doc.setFontSize(12.5); ink(doc, C.green);
  doc.text(rs(total), m + inner * 0.5, y + 6.6, { align: "center" });
  if (paid > 0) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); ink(doc, C.sub);
    doc.text(`Paid ${rs(paid)}   |   Balance ${rs(balance)}`, m + inner * 0.8, y + 6.2, { align: "center" });
  }
  y += 14;

  // Payment instructions
  ink(doc, C.sub); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
  const lines = doc.splitTextToSize(`Payment: ${paymentLine(v)}`, inner - 8);
  doc.text(lines.slice(0, 2), w / 2, y, { align: "center" });

  // Signatures
  const sy = y0 + 124 - 7;
  draw(doc, C.sub); doc.setLineWidth(0.25);
  doc.line(m + 10, sy, m + 55, sy); doc.line(w - m - 55, sy, w - m - 10, sy);
  ink(doc, C.muted); doc.setFont("times", "italic"); doc.setFontSize(8);
  doc.text(copy === "School Copy" ? "Received by" : "Cashier", m + 32.5, sy + 4, { align: "center" });
  doc.text("Principal", w - m - 32.5, sy + 4, { align: "center" });
}

/** One A4 page per voucher: Student copy on top, School copy below. */
export async function downloadVouchersPDF(vouchers: FeeVoucher[], fileName: string) {
  if (!vouchers.length) return;
  const { jsPDF, autoTable } = await lib();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  vouchers.forEach((v, i) => {
    if (i > 0) doc.addPage();
    drawVoucherCopy(doc, autoTable, v, 6, "Student Copy");
    draw(doc, C.muted); doc.setLineWidth(0.2);
    (doc as any).setLineDashPattern([2, 2], 0);
    doc.line(8, 148.5, 202, 148.5);
    (doc as any).setLineDashPattern([], 0);
    drawVoucherCopy(doc, autoTable, v, 153, "School Copy");
  });
  doc.save(fileName);
}

// ───────────────────────── Reports ─────────────────────────
export interface ReportPdfOptions {
  title: string;
  subtitle: string;
  stats?: [string, string][];
  head: string[];
  body: (string | number)[][];
  widths?: number[];          // mm per column (must fit 182mm portrait)
  fileName: string;
  /** zero-based column index to colour red/green when it reads "Unpaid"… */
  statusCol?: number;
}

export async function downloadReportPDF(o: ReportPdfOptions) {
  const { jsPDF, autoTable } = await lib();
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // Brand band
  fill(doc, C.green); doc.rect(0, 0, w, 32, "F");
  fill(doc, C.gold); doc.rect(0, 32, w, 1.1, "F");
  ink(doc, C.white); doc.setFont("times", "bold"); doc.setFontSize(18);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 15, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); ink(doc, [208, 228, 216]);
  doc.text("DISTRICT MOHMAND   ·   KHYBER PAKHTUNKHWA   ·   FEE MANAGEMENT", w / 2, 23, { align: "center" });

  // Title
  ink(doc, C.ink); doc.setFont("times", "bold"); doc.setFontSize(19);
  doc.text(o.title.toUpperCase(), w / 2, 46, { align: "center", maxWidth: w - 28 });
  draw(doc, C.gold); doc.setLineWidth(0.6); doc.line(w / 2 - 14, 50, w / 2 + 14, 50);
  ink(doc, C.sub); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(o.subtitle, w / 2, 56, { align: "center", maxWidth: w - 28 });

  let startY = 62;
  if (o.stats?.length) {
    const gap = 4, m = 14, top = 62, ch = 15;
    const cw = (w - m * 2 - gap * (o.stats.length - 1)) / o.stats.length;
    o.stats.forEach(([label, value], i) => {
      const x = m + i * (cw + gap);
      fill(doc, C.alt); draw(doc, C.grid); doc.setLineWidth(0.2);
      doc.roundedRect(x, top, cw, ch, 1.5, 1.5, "FD");
      ink(doc, C.muted); doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
      doc.text(label.toUpperCase(), x + cw / 2, top + 5.2, { align: "center" });
      ink(doc, C.green); doc.setFont("times", "bold"); doc.setFontSize(12.5);
      doc.text(value, x + cw / 2, top + 11.6, { align: "center", maxWidth: cw - 3 });
    });
    startY = top + ch + 7;
  }

  const columnStyles: Record<number, any> = {};
  (o.widths ?? []).forEach((cw, i) => { columnStyles[i] = { cellWidth: cw }; });

  autoTable(doc, {
    startY,
    theme: "grid",
    head: [o.head],
    body: o.body.length ? o.body : [o.head.map((_, i) => (i === 0 ? "No records" : ""))],
    styles: { font: "helvetica", fontSize: 8.5, halign: "center", valign: "middle", cellPadding: { top: 2.5, bottom: 2.5, left: 1.5, right: 1.5 }, lineColor: C.grid, lineWidth: 0.15, textColor: C.ink },
    headStyles: { fillColor: C.green, textColor: C.white, fontStyle: "bold", fontSize: 8, lineColor: C.green },
    alternateRowStyles: { fillColor: C.alt },
    columnStyles,
    margin: { top: 16, left: 14, right: 14, bottom: 18 },
    didParseCell: (d: any) => {
      if (d.section !== "body") return;
      if (d.column.index === 0 && o.head[0] === "#") { d.cell.styles.fontStyle = "bold"; }
      if (o.statusCol === d.column.index) {
        const t = String(d.cell.raw).toLowerCase();
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.textColor = t === "paid" ? C.green : t === "overdue" || t === "unpaid" ? C.red : C.gold;
      }
    },
    didDrawPage: (d: any) => {
      if (d.pageNumber > 1) {
        fill(doc, C.green); doc.rect(0, 0, w, 10, "F");
        fill(doc, C.gold); doc.rect(0, 10, w, 0.6, "F");
        ink(doc, C.white); doc.setFont("times", "bold"); doc.setFontSize(9.5);
        doc.text(`GHS BABI KHEL  ·  ${o.title.toUpperCase()}`, w / 2, 6.6, { align: "center", maxWidth: w - 28 });
      }
    },
  });

  const pages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    draw(doc, C.grid); doc.setLineWidth(0.25); doc.line(14, h - 13, w - 14, h - 13);
    ink(doc, C.muted); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text("GHS Babi Khel  ·  Fee Management", 14, h - 8);
    doc.text(`Page ${p} of ${pages}`, w / 2, h - 8, { align: "center" });
    doc.text(format(new Date(), "dd MMM yyyy"), w - 14, h - 8, { align: "right" });
  }
  doc.save(o.fileName);
}
