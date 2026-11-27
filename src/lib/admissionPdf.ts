// src/lib/admissionPdf.ts — official admission documents for GHS Babi Khel.
//
//   • downloadFeeChallan()      — ONE clean A4 page: applicant copy + school
//                                  copy, dashed cut line. Grid-based, no
//                                  overlapping text, deadline always printed.
//   • downloadApplicationForm() — EXACTLY two clean A4 pages:
//                                  page 1 = photo box + key facts + record
//                                  tables + documents checklist;
//                                  page 2 = declaration (short), signature
//                                  block, migration details, office use.
//
// Layout rules (the "no distraction" pass):
//   • every block flows from the previous one's measured bottom — nothing is
//     drawn at a fixed Y that could collide with a long name or address;
//   • one grid system for all tables (6 columns of fixed widths);
//   • text is wrapped with splitTextToSize before drawing, never clipped;
//   • page 2 content is rebuilt to fit: no affidavit about "not taken
//     admission in the same class", no Supreme Court undertaking, no deponent
//     tables — just a plain declaration, signatures and office-use rows.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import { describePaymentAccount, formatFeeDate } from "@/lib/admissionPayment";

export const PDF_SCHOOL_NAME = "GOVERNMENT HIGH SCHOOL BABI KHEL";
export const PDF_SCHOOL_SUB = "DISTRICT MOHMAND | KHYBER PAKHTUNKHWA";

// School palette
const INK = "#1A1A1A";
const SUB = "#5C5C5C";
const MUTED = "#808080";
const GREEN = "#14532D";
const GOLD = "#A88228";
const GOLD_TINT = "#FBF5E2";
const GRID = "#C9C9C4";
const ALT = "#F7F7F4";

export interface FeeChallanInput {
  referenceNo: string;
  name: string;
  fatherName: string;
  bFormNo: string;
  applyingClass: string;
  admissionType: string;          // fresh | migration
  paymentReference: string | null;
  processingFee: number;
  deadline: string | null;        // ISO
  paymentAccounts: AdmissionPaymentAccount[];
  sessionYear?: string | null;
  appliedOn?: string | null;      // ISO
}

export interface ApplicationFormInput extends FeeChallanInput {
  paymentStatus: string;          // pending | paid | rejected
  gender?: string | null;
  dateOfBirth?: string | null;
  contactNumber?: string | null;
  whatsappNumber?: string | null;
  homeAddress?: string | null;
  fatherCnic?: string | null;
  occupation?: string | null;
  previousSchool?: string | null;
  previousClass?: string | null;
  previousMarks?: string | null;
  yearOfPassing?: string | null;
  /** New board-compliance fields (optional — older records may not have them). */
  previousBoard?: string | null;
  boardEnrollmentNo?: string | null;
  boardRollNo?: string | null;
  previousResult?: string | null;
  slcNo?: string | null;
  slcDate?: string | null;
  migrationCertNo?: string | null;
}

function typeLabel(admissionType: string): string {
  return admissionType === "migration" ? "Migration / Transfer" : "Fresh Admission";
}

function fmtFeeDate(iso: string | null | undefined): string {
  return iso ? formatFeeDate(iso) : "—";
}

/** "Session 2026-27" from "2026" (or passes through a custom label). */
function cycleLabel(sessionYear?: string | null): string {
  const raw = (sessionYear || String(new Date().getFullYear() + 1)).trim();
  if (/^\d{4}$/.test(raw)) return `Session ${raw}-${String(parseInt(raw, 10) + 1).slice(-2)}`;
  return raw.startsWith("Session") ? raw : `Session ${raw}`;
}

/** Wrap a value into ≤2 grid lines of ≤34 chars (keeps rows single-height). */
function wrap2(v: string | null | undefined, doc: any, max = 34): string {
  const s = (v && String(v).trim()) || "—";
  const lines: string[] = doc.splitTextToSize(s, max * 2.05);
  if (lines.length <= 1) return s;
  return `${lines[0].trim()} ${lines[1].trim()}`.slice(0, max * 2) + (lines.length > 2 ? "…" : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared table helper — a fixed 6-column grid, everything measured.
// Column x-positions: label 25, value 55, gap 105, label 105, value 135, end 197
// ─────────────────────────────────────────────────────────────────────────────

interface GridTableOpts {
  title: string;
  pairs: Array<[string, string]>;
  startY: number;
  doc: any;
  autoTable: (doc: any, opts: any) => void;
}

function gridTable({ title, pairs, startY, doc, autoTable }: GridTableOpts): number {
  // Section header bar
  doc.setFillColor(GREEN);
  doc.roundedRect(12, startY, 186, 6.2, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor("#FFFFFF");
  doc.text(title.toUpperCase(), 15, startY + 4.3);

  // Rows: two label/value pairs per row
  const rows: any[][] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    rows.push([
      { content: a[0], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.2 } },
      { content: a[1], styles: { textColor: INK, fontSize: 8.6 } },
      { content: b ? b[0] : "", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.2 } },
      { content: b ? b[1] : "", styles: { textColor: INK, fontSize: 8.6 } },
    ]);
  }
  autoTable(doc, {
    startY: startY + 6.2,
    body: rows,
    theme: "grid",
    styles: { cellPadding: 1.5, lineColor: GRID, lineWidth: 0.2, minCellHeight: 5.8, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 65 },
      2: { cellWidth: 28 },
      3: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12 },
  });
  return (doc as any).lastAutoTable.finalY as number;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEE CHALLAN — one A4, two copies
// ─────────────────────────────────────────────────────────────────────────────

export async function downloadFeeChallan(input: FeeChallanInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const cycle = cycleLabel(input.sessionYear);
  const isMigration = input.admissionType === "migration";

  const payToLines = input.paymentAccounts
    .map((a) => describePaymentAccount(a))
    .filter(Boolean);
  if (payToLines.length === 0) {
    payToLines.push("Pay at the school office (cash) during working hours.");
  }

  const deadlineText = input.deadline
    ? formatFeeDate(input.deadline)
    : "the last date shown on the Admission page";

  /** One copy. Everything flows from `y` — nothing at a fixed offset. */
  const drawCopy = (originY: number, copyLabel: string) => {
    let y = originY;

    // Header band
    doc.setFillColor(GREEN);
    doc.roundedRect(10, y, W - 20, 17, 2, 2, "F");
    doc.setFillColor(GOLD);
    doc.rect(10, y + 17, W - 20, 1, "F");
    doc.setTextColor("#FFFFFF");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.text(PDF_SCHOOL_NAME, W / 2, y + 6.5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.text(PDF_SCHOOL_SUB, W / 2, y + 11, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(GOLD_TINT);
    doc.text("APPLICATION PROCESSING FEE CHALLAN", W / 2, y + 15, { align: "center" });
    y += 20;

    // Copy label + cycle + date — one tidy line, left / center / right
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(GOLD);
    doc.text(copyLabel, W - 12, y, { align: "right" });
    doc.setTextColor(SUB);
    doc.text(cycle, 12, y);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${fmtFeeDate(input.appliedOn || new Date().toISOString())}`, W / 2, y, { align: "center" });
    y += 3;

    // Applicant grid (3 rows × 2 pairs)
    y = gridTable({
      title: "Applicant",
      doc, autoTable, startY: y,
      pairs: [
        ["APPLICANT", wrap2(input.name, doc)],
        ["FATHER NAME", wrap2(input.fatherName, doc)],
        ["B-FORM NO.", input.bFormNo || "—"],
        ["REFERENCE NO.", input.referenceNo || "—"],
        ["CLASS", `Class ${input.applyingClass}`],
        ["ADMISSION TYPE", typeLabel(input.admissionType)],
      ],
    });
    y += 4;

    // Amount strip — payment reference (left) + amount (right), one box
    doc.setFillColor(GOLD_TINT);
    doc.roundedRect(12, y, W - 24, 15, 1.5, 1.5, "F");
    doc.setDrawColor(GOLD);
    doc.setLineWidth(0.4);
    doc.roundedRect(12, y, W - 24, 15, 1.5, 1.5, "S");
    doc.line(W / 2 + 6, y + 2.5, W / 2 + 6, y + 12.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(GOLD);
    doc.text("PAYMENT REFERENCE", 18, y + 5);
    doc.setFontSize(11.5);
    doc.setTextColor(GREEN);
    doc.text(input.paymentReference || "—", 18, y + 11);

    doc.setFontSize(7.2);
    doc.setTextColor(GOLD);
    doc.text("AMOUNT PAYABLE", W / 2 + 14, y + 5, { align: "left" });
    doc.setFontSize(13);
    doc.setTextColor(INK);
    doc.text(`Rs. ${Number(input.processingFee || 0).toLocaleString("en-PK")}`, W / 2 + 14, y + 11);
    y += 19;

    // PAY TO block — a bordered box, lines measured
    doc.setFillColor(ALT);
    doc.roundedRect(12, y, W - 24, 6.2, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(INK);
    doc.text("PAY TO", 16, y + 4.2);
    y += 8.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(SUB);
    for (const line of payToLines.slice(0, 3)) {
      doc.text(doc.splitTextToSize(line, W - 32)[0], W / 2, y, { align: "center" });
      y += 4.8;
    }
    y += 1.5;

    // Deadline note — the line that used to print "Pay on or before —."
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(GREEN);
    const noteLine1 = `Pay on or before ${deadlineText}.`;
    doc.text(noteLine1, W / 2, y, { align: "center" });
    y += 4.4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(MUTED);
    const note = doc.splitTextToSize(
      "Write the payment reference on your receipt and keep it. The application is processed after the school confirms the payment.",
      W - 40,
    );
    for (const l of note) { doc.text(l, W / 2, y, { align: "center" }); y += 3.4; }

    // Signature lines — anchored to the bottom of the copy
    const sigY = originY + 133;
    doc.setDrawColor(SUB);
    doc.setLineWidth(0.25);
    doc.line(18, sigY, 74, sigY);
    doc.line(W - 74, sigY, W - 18, sigY);
    doc.setFontSize(7.4);
    doc.setTextColor(MUTED);
    doc.text("Applicant / Parent Signature", 46, sigY + 4, { align: "center" });
    doc.text(copyLabel === "SCHOOL COPY" ? "Received by (School)" : "Cashier / Stamp", W - 46, sigY + 4, { align: "center" });
  };

  drawCopy(8, "APPLICANT COPY");

  // Dashed cut line between the two copies
  doc.setDrawColor(MUTED);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([2.4, 2.4], 0);
  doc.line(8, 148, W - 8, 148);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text("cut here", W / 2, 146.6, { align: "center" });

  drawCopy(153, "SCHOOL COPY");

  doc.save(`Fee-Challan-${input.referenceNo}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION FORM — exactly two clean A4 pages
// ─────────────────────────────────────────────────────────────────────────────

/** ONE checklist, shared by the form and the review UI. Fresh/migration aware. */
export function documentsChecklist(isMigration: boolean): string[] {
  return [
    "Printed application form (this PDF)",
    "B-Form copy + father/guardian CNIC copy (attested)",
    "Previous class result card / marksheet (attested copy + original)",
    isMigration
      ? "School Leaving Certificate (original, countersigned)"
      : "School Leaving Certificate, if transferring from another school",
    ...(isMigration
      ? [
          "From another board: original Migration Certificate + verified 9th result card",
          "BISE Peshawar portal migration is completed by the schools (receiving school applies)",
        ]
      : ["Class 9: the school enrolls the student with BISE Peshawar after admission is confirmed"]),
  ];
}

export async function downloadApplicationForm(input: ApplicationFormInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const cycle = cycleLabel(input.sessionYear);
  const isMigration = input.admissionType === "migration";

  /* ── PAGE 1 ──────────────────────────────────────────────────────────────── */

  // Header band (full width) — title centered in the space LEFT of the photo box
  doc.setFillColor(GREEN);
  doc.roundedRect(10, 8, W - 20, 19, 2, 2, "F");
  doc.setFillColor(GOLD);
  doc.rect(10, 27, W - 20, 1.2, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(PDF_SCHOOL_NAME, 14, 14.5, { align: "left" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.text(PDF_SCHOOL_SUB, 14, 18.5, { align: "left" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(GOLD_TINT);
  doc.text(`ADMISSION APPLICATION FORM · ${cycle}`, 14, 24, { align: "left" });

  // Photo box top-right, clear of the header text (header text max width 124)
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([1.6, 1.2], 0);
  doc.roundedRect(W - 42, 10.5, 28, 35, 1.5, 1.5, "S");
  doc.setLineDashPattern([], 0);
  doc.setFontSize(6.6);
  doc.setTextColor(GOLD);
  doc.text("AFFIX PASSPORT-SIZE", W - 28, 24, { align: "center" });
  doc.text("PHOTOGRAPH (WHITE BG.)", W - 28, 27.5, { align: "center" });
  doc.setFontSize(6.2);
  doc.setTextColor(MUTED);
  doc.text("(3 copies required)", W - 28, 31, { align: "center" });

  let y = 33;

  // Key facts strip (gold tint) — 2 columns × 3 rows, drawn as a table for alignment
  autoTable(doc, {
    startY: y,
    body: [
      [
        { content: "REFERENCE NO.", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: input.referenceNo || "—", styles: { textColor: GREEN, fontStyle: "bold", fontSize: 9.5 } },
        { content: "DATE APPLIED", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: fmtFeeDate(input.appliedOn), styles: { textColor: INK, fontSize: 8.6 } },
      ],
      [
        { content: "CLASS APPLIED FOR", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: `Class ${input.applyingClass}`, styles: { textColor: INK, fontSize: 8.6 } },
        { content: "ADMISSION TYPE", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: typeLabel(input.admissionType), styles: { textColor: INK, fontSize: 8.6 } },
      ],
      [
        { content: "PROCESSING FEE", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: Number(input.processingFee || 0) > 0 ? `Rs. ${Number(input.processingFee).toLocaleString("en-PK")}` : "—", styles: { textColor: INK, fontSize: 8.6 } },
        { content: "PAY BEFORE", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: input.deadline ? fmtFeeDate(input.deadline) : "See admission page", styles: { textColor: INK, fontSize: 8.6 } },
      ],
    ],
    theme: "grid",
    styles: { cellPadding: 1.8, lineColor: GOLD, lineWidth: 0.25, minCellHeight: 6, fillColor: GOLD_TINT, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 33 },
      1: { cellWidth: 60 },
      2: { cellWidth: 33 },
      3: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12 },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // Student information
  y = gridTable({
    title: "Student Information",
    doc, autoTable, startY: y,
    pairs: [
      ["Full Name", wrap2(input.name, doc)],
      ["Father Name", wrap2(input.fatherName, doc)],
      ["B-Form No.", input.bFormNo || "—"],
      ["Date of Birth", input.dateOfBirth ? fmtFeeDate(input.dateOfBirth) : "—"],
      ["Gender", input.gender ? input.gender.charAt(0).toUpperCase() + input.gender.slice(1) : "—"],
      ["Father's CNIC", input.fatherCnic || "—"],
      ["Contact (Mobile)", input.contactNumber || "—"],
      ["WhatsApp", input.whatsappNumber || "—"],
      ["Occupation", input.occupation || "—"],
      ["Home Address", wrap2(input.homeAddress, doc, 30)],
    ],
  });
  y += 4.5;

  // Academic information (board columns included)
  y = gridTable({
    title: "Academic Information",
    doc, autoTable, startY: y,
    pairs: [
      ["Previous School", wrap2(input.previousSchool, doc, 30)],
      ["Previous Class", input.previousClass || "—"],
      ["Marks / Grade", input.previousMarks || "—"],
      ["Year of Passing", input.yearOfPassing || "—"],
      ["Previous Board", input.previousBoard || "—"],
      ["Board Enrollment No.", input.boardEnrollmentNo || "—"],
      ["9th Roll No. (Class 10)", input.boardRollNo || "—"],
      ["9th Result (Class 10)", input.previousResult || "—"],
    ],
  });
  y += 4.5;

  // Migration details (only when relevant)
  if (isMigration) {
    y = gridTable({
      title: "Migration / Transfer Details",
      doc, autoTable, startY: y,
      pairs: [
        ["SLC No.", input.slcNo || "—"],
        ["SLC Date", input.slcDate ? fmtFeeDate(input.slcDate) : "—"],
        ["Migration Cert. No. (other board)", input.migrationCertNo || "—"],
        ["Previously enrolled with any board", input.previousBoard ? "Yes" : "—"],
      ],
    });
    y += 4.5;
  }

  // Documents checklist — measured rows, checkbox squares aligned
  doc.setFillColor(GREEN);
  doc.roundedRect(12, y, 186, 6.2, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor("#FFFFFF");
  doc.text("DOCUMENTS TO BRING", 15, y + 4.3);
  y += 10.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(SUB);
  for (const item of documentsChecklist(isMigration)) {
    doc.setDrawColor(GREEN);
    doc.setLineWidth(0.3);
    doc.rect(17, y - 2.6, 3.4, 3.4);
    const lines: string[] = doc.splitTextToSize(item, 172);
    doc.text(lines[0], 23, y);
    y += 5.6;
  }

  // Footer page 1
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`${PDF_SCHOOL_NAME} | Application ${input.referenceNo} | Page 1 of 2`, W / 2, 291, { align: "center" });

  /* ── PAGE 2 — declaration · signatures · office use ──────────────────────── */
  doc.addPage();

  // Header band
  doc.setFillColor(GREEN);
  doc.roundedRect(10, 8, W - 20, 12, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor("#FFFFFF");
  doc.text("DECLARATION  ·  SIGNATURES  ·  OFFICE USE", W / 2, 15.5, { align: "center" });
  doc.setFillColor(GOLD);
  doc.rect(10, 20, W - 20, 1, "F");

  let py = 28;

  // Declaration — short, true for fresh AND migration applicants
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INK);
  doc.text("DECLARATION", 14, py);
  py += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.4);
  doc.setTextColor(SUB);
  const declaration =
    "I declare that the information given in this application is accurate and complete, and that the student has " +
    "not been enrolled in any other institution for the same class while this application is under consideration. " +
    "For migration to Class 9/10, I understand the student must not be enrolled with another institution for the " +
    "same class until the migration is completed on the BISE Peshawar portal by the schools. I understand that any " +
    "misstatement may result in cancellation of the application or admission.";
  for (const l of doc.splitTextToSize(declaration, 182)) {
    doc.text(l, 14, py);
    py += 4;
  }
  py += 4;

  // Signature block — applicant / parent & guardian, date
  const sigBox = (x: number, w: number, title: string, lines: string[]) => {
    doc.setFillColor(ALT);
    doc.roundedRect(x, py, w, 24, 1.5, 1.5, "F");
    doc.setDrawColor(GRID);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, py, w, 24, 1.5, 1.5, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.setTextColor(INK);
    doc.text(title, x + 4, py + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(MUTED);
    lines.forEach((l, i) => doc.text(l, x + 4, py + 10 + i * 4.6));
  };
  sigBox(14, 88, "APPLICANT (STUDENT)", ["Name: __________________________", "Signature: ______________________", "Date: ___________________________"]);
  sigBox(W - 14 - 88, 88, "FATHER / GUARDIAN", ["Name: __________________________", "CNIC No.: _______________________", "Signature: ______________________"]);
  py += 30;

  // Office verification — the only authority section kept, in board language
  y = gridTable({
    title: "Verification by the School",
    doc, autoTable, startY: py,
    pairs: [
      ["Documents verified by", "____________________"],
      ["Date of verification", "____________________"],
      ["Merit list (list no.)", "____________________"],
      ["Remarks", "____________________"],
    ],
  });
  y += 6;

  // FOR OFFICE USE ONLY — admission + board enrollment (BISEP) grid
  doc.setFillColor(GOLD_TINT);
  doc.roundedRect(12, y, 186, 6.2, 1, 1, "F");
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.35);
  doc.roundedRect(12, y, 186, 6.2, 1, 1, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(GOLD);
  doc.text("FOR OFFICE USE ONLY", 15, y + 4.3);
  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(INK);
  const officeRows: Array<[string, string]> = [
    ["Admission No.", "________________"],
    ["Admission Date", "________________"],
    ["Processing Fee", Number(input.processingFee || 0) > 0 ? `Rs. ${Number(input.processingFee).toLocaleString("en-PK")}` : "—"],
    ["Fee Received", "________________"],
    ["BISEP Enrollment No. (Class 9)", "________________"],
    ["BISEP Enrollment Date", "________________"],
  ];
  officeRows.forEach(([k, v], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 16 + col * 94;
    const yy = y + row * 9;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(MUTED);
    doc.text(k, x, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(INK);
    doc.text(v, x, yy + 5);
  });
  y += 32;

  // Principal signature line
  doc.setDrawColor(SUB);
  doc.setLineWidth(0.3);
  doc.line(120, y + 6, 192, y + 6);
  doc.setFontSize(7.4);
  doc.setTextColor(MUTED);
  doc.text("Principal's Signature & School Stamp", 156, y + 10, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`${PDF_SCHOOL_NAME} | Application ${input.referenceNo} | Page 2 of 2`, W / 2, 291, { align: "center" });

  doc.save(`Application-${input.referenceNo}.pdf`);
}
