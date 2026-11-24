// src/lib/admissionPdf.ts — GHSS-Ghallanai-style PDF documents for the GHS
// Babi Khel admission flow (lazy-loaded: jsPDF + autotable only download on
// the first tap, exactly like every other PDF in this codebase).
//
//   • downloadFeeChallan()     — ONE A4 sheet, TWO copies (Applicant Copy +
//                                School Copy, dashed cut line), payment
//                                reference + PAY TO accounts
//   • downloadApplicationForm() — EXACTLY two A4 pages: form + records on
//                                page 1, AFFIDAVIT · UNDERTAKING ·
//                                ENDORSEMENT + deponent/witness/office-use
//                                tables on page 2
//
// Adapted from the college version to the High School model: CLASS instead
// of program, Admission Type instead of quota/category, B-Form instead of
// CNIC/Form-B.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import { describePaymentAccount, formatFeeDate } from "@/lib/admissionPayment";

export const PDF_SCHOOL_NAME = "GOVERNMENT HIGH SCHOOL BABI KHEL";
export const PDF_SCHOOL_SUB = "DISTRICT MOHMAND | KHYBER PAKHTUNKHWA";

// GHSS Ghallanai palette (kept 1:1 so both schools' documents look like
// the same family of official forms).
const INK = "#1A1A1A";
const SUB = "#5C5C5C";
const MUTED = "#808080";
const GREEN = "#14532D";
const GOLD = "#A88228";
const GOLD_TINT = "#FBF5E2";
const ALT = "#F8F8F6";
const GRID = "#DCDCD8";

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
}

function typeLabel(admissionType: string): string {
  return admissionType === "migration" ? "Migration / Transfer" : "Fresh Admission";
}

function fmtFeeDate(iso: string | null | undefined): string {
  return iso ? formatFeeDate(iso) : "—";
}

/** fee label, e.g. "Session 2026-27" or just the stored session year. */
function cycleLabel(sessionYear?: string | null): string {
  const raw = (sessionYear || String(new Date().getFullYear() + 1)).trim();
  if (/^\d{4}$/.test(raw)) return `Session ${raw}-${String(parseInt(raw, 10) + 1).slice(-2)}`;
  return raw.startsWith("Session") ? raw : `Session ${raw}`;
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

  const payToLines = input.paymentAccounts
    .map((a) => describePaymentAccount(a))
    .filter(Boolean);
  if (payToLines.length === 0) {
    payToLines.push("Payment account details are available at the school office.");
  }

  const drawCopy = (originY: number, copyLabel: string) => {
    // Header band
    doc.setFillColor(GREEN);
    doc.roundedRect(10, originY, W - 20, 20, 2, 2, "F");
    doc.setFillColor(GOLD);
    doc.rect(10, originY + 20, W - 20, 1.2, "F");
    doc.setTextColor("#FFFFFF");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(PDF_SCHOOL_NAME, W / 2, originY + 8, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(PDF_SCHOOL_SUB, W / 2, originY + 13.5, { align: "center" });
    doc.setFontSize(9);
    doc.setTextColor(GOLD_TINT);
    doc.text("APPLICATION FEE CHALLAN", W / 2, originY + 18, { align: "center" });

    // Copy label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(GOLD);
    doc.text(copyLabel, W - 12, originY + 26, { align: "right" });

    // Cycle + date row
    doc.setFontSize(9);
    doc.setTextColor(SUB);
    doc.text(cycle, 12, originY + 26);
    doc.text(`Date: ${fmtFeeDate(input.appliedOn || new Date().toISOString())}`, 12, originY + 31);

    // Info grid 3×2
    const info: Array<[string, string]> = [
      ["APPLICANT", input.name || "—"],
      ["FATHER NAME", input.fatherName || "—"],
      ["B-FORM NO.", input.bFormNo || "—"],
      ["REFERENCE NO.", input.referenceNo || "—"],
      ["CLASS", `Class ${input.applyingClass}`],
      ["ADMISSION TYPE", typeLabel(input.admissionType)],
    ];
    autoTable(doc, {
      startY: originY + 34,
      body: [
        [info[0][0], info[0][1], info[1][0], info[1][1]],
        [info[2][0], info[2][1], info[3][0], info[3][1]],
        [info[4][0], info[4][1], info[5][0], info[5][1]],
      ].map((row) => [
        { content: row[0], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.5 } },
        { content: row[1], styles: { textColor: INK, fontSize: 9 } },
        { content: row[2], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.5 } },
        { content: row[3], styles: { textColor: INK, fontSize: 9 } },
      ]),
      theme: "grid",
      styles: { cellPadding: 2.2, lineColor: GRID, lineWidth: 0.2, minCellHeight: 7 },
      columnStyles: {
        0: { cellWidth: 32 },
        1: { cellWidth: 63 },
        2: { cellWidth: 32 },
        3: { cellWidth: "auto" },
      },
      margin: { left: 12, right: 12 },
    });
    const gridBottom = (doc as any).lastAutoTable.finalY as number;

    // Gold strip: payment reference + amount
    const stripY = gridBottom + 3;
    doc.setFillColor(GOLD_TINT);
    doc.roundedRect(12, stripY, W - 24, 17, 1.5, 1.5, "F");
    doc.setDrawColor(GOLD);
    doc.setLineWidth(0.4);
    doc.roundedRect(12, stripY, W - 24, 17, 1.5, 1.5, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(GOLD);
    doc.text("PAYMENT REFERENCE", 18, stripY + 5);
    doc.setFontSize(12.5);
    doc.setTextColor(GREEN);
    doc.text(input.paymentReference || "Generate from the admission page", 18, stripY + 12);
    doc.setFontSize(7.5);
    doc.setTextColor(GOLD);
    doc.text("AMOUNT PAYABLE", W / 2 + 14, stripY + 5, { align: "center" });
    doc.setFontSize(13);
    doc.setTextColor(INK);
    doc.text(`Rs. ${Number(input.processingFee || 0).toLocaleString("en-PK")}`, W / 2 + 14, stripY + 12, { align: "center" });
    doc.setDrawColor(GOLD);
    doc.setLineWidth(0.3);
    doc.line(W / 2 + 4, stripY + 3, W / 2 + 4, stripY + 14);

    // PAY TO
    let y = stripY + 23;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INK);
    doc.text("PAY TO", 12, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(SUB);
    y += 5;
    for (const line of payToLines.slice(0, 4)) {
      const wrapped = doc.splitTextToSize(line, W - 26);
      for (const w of wrapped.slice(0, 2)) {
        doc.text(w, W / 2, y, { align: "center" });
        y += 4.6;
      }
    }

    // Note
    doc.setFontSize(7.6);
    doc.setTextColor(MUTED);
    const note =
      `Pay on or before ${fmtFeeDate(input.deadline)}. Write the payment reference on your receipt and keep it for record. ` +
      "Your application is processed after the school confirms the payment.";
    const noteLines = doc.splitTextToSize(note, W - 26);
    let ny = y + 2;
    for (const l of noteLines) {
      doc.text(l, 12, ny);
      ny += 3.6;
    }

    // Signature lines
    const sigY = originY + 124;
    doc.setDrawColor(SUB);
    doc.setLineWidth(0.25);
    doc.line(16, sigY, 72, sigY);
    doc.line(W - 72, sigY, W - 16, sigY);
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    doc.text("Applicant Signature", 44, sigY + 4, { align: "center" });
    doc.text(copyLabel === "SCHOOL COPY" ? "Received by" : "Cashier", W - 44, sigY + 4, { align: "center" });
  };

  drawCopy(8, "APPLICANT COPY");

  // Dashed cut line
  doc.setDrawColor(MUTED);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([2.4, 2.4], 0);
  doc.line(8, 154, W - 8, 154);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text("✂", W / 2, 152.6, { align: "center" });

  drawCopy(159, "SCHOOL COPY");

  doc.save(`Fee-Challan-${input.referenceNo}.pdf`);
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION FORM — exactly two A4 pages
// ─────────────────────────────────────────────────────────────────────────────

const CHECKLIST_ITEMS = [
  "Printed application form + fee challan receipt (if the fee was paid)",
  "All original documents for verification (B-Form, result card, School Leaving Certificate)",
  "Three recent passport-size photographs (white background) — one pasted in the box above",
  "Attested copies of the previous class result card",
  "Attested copy of the applicant B-Form and father/guardian CNIC",
  "School Leaving Certificate (for migration / transfer applicants)",
];

function recordTable(
  doc: any,
  autoTable: (doc: any, opts: any) => void,
  title: string,
  pairs: Array<[string, string]>,
  startY: number,
): number {
  doc.setFillColor(GREEN);
  doc.roundedRect(12, startY, 186, 6.4, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor("#FFFFFF");
  doc.text(title.toUpperCase(), 15, startY + 4.5);
  const rows: any[][] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    rows.push([
      { content: pairs[i][0], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.4 } },
      { content: pairs[i][1] || "—", styles: { textColor: INK, fontSize: 8.4 } },
      pairs[i + 1]
        ? { content: pairs[i + 1][0], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.4 } }
        : { content: "", styles: {} },
      pairs[i + 1] ? { content: pairs[i + 1][1] || "—", styles: { textColor: INK, fontSize: 8.4 } } : { content: "", styles: {} },
    ]);
  }
  autoTable(doc, {
    startY: startY + 6.4,
    body: rows,
    theme: "grid",
    styles: { cellPadding: 1.6, lineColor: GRID, lineWidth: 0.2, minCellHeight: 6, halign: "center", valign: "middle" },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 63 },
      2: { cellWidth: 30 },
      3: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12 },
  });
  return (doc as any).lastAutoTable.finalY as number;
}

export async function downloadApplicationForm(input: ApplicationFormInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const cycle = cycleLabel(input.sessionYear);

  // ── PAGE 1 ────────────────────────────────────────────────────────────────
  // Header band
  doc.setFillColor(GREEN);
  doc.roundedRect(10, 8, W - 20, 20, 2, 2, "F");
  doc.setFillColor(GOLD);
  doc.rect(10, 28, W - 20, 1.2, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(PDF_SCHOOL_NAME, W / 2 + 16, 16, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(PDF_SCHOOL_SUB, W / 2 + 16, 21.5, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(GOLD_TINT);
  doc.text("ADMISSION APPLICATION FORM", W / 2 + 16, 26.5, { align: "center" });
  doc.setFontSize(8.6);
  doc.setTextColor("#FFFFFF");
  doc.text(cycle, 14, 16);

  // Photo box (right side of the header)
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([1.6, 1.2], 0);
  doc.roundedRect(W - 46, 32, 28, 36, 1.5, 1.5, "S");
  doc.setLineDashPattern([], 0);
  doc.setFontSize(6.6);
  doc.setTextColor(GOLD);
  doc.text("ATTACH 3 PASSPORT SIZE", W - 32, 46, { align: "center" });
  doc.text("PICS (WHITE BACKGROUND)", W - 32, 49.5, { align: "center" });
  doc.setFontSize(6.2);
  doc.setTextColor(MUTED);
  doc.text("(one pasted here)", W - 32, 53.5, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(INK);
  doc.text("APPLICATION FORM", 14, 37);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(SUB);
  doc.text(cycle, 14, 42);

  // Key strip 2×3 (gold tinted)
  const stripY = 70;
  doc.setFillColor(GOLD_TINT);
  doc.roundedRect(12, stripY, 138, 22, 1.5, 1.5, "F");
  const keyPairs: Array<[string, string]> = [
    ["REFERENCE NO.", input.referenceNo || "—"],
    ["DATE APPLIED", fmtFeeDate(input.appliedOn)],
    ["PAYMENT STATUS", (input.paymentStatus || "pending").toUpperCase()],
    ["PAYMENT REFERENCE", input.paymentReference || "—"],
    ["PROCESSING FEE", `Rs. ${Number(input.processingFee || 0).toLocaleString("en-PK")}`],
    ["PAY BEFORE", fmtFeeDate(input.deadline)],
  ];
  doc.setFontSize(6.8);
  for (let i = 0; i < keyPairs.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 16 + col * 68;
    const y = stripY + 5.5 + row * 6.6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(GOLD);
    doc.text(keyPairs[i][0], x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(i === 0 || i === 3 ? GREEN : INK);
    doc.text(keyPairs[i][1], x, y + 4);
    doc.setFontSize(6.8);
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.4);
  doc.setTextColor(MUTED);
  const feeNote =
    `Pay the processing fee by manual transfer (bank / Easypaisa / JazzCash), quoting your payment reference, on or before ${fmtFeeDate(input.deadline)}. ` +
    "Admission is subject to eligibility and merit.";
  const feeNoteLines = doc.splitTextToSize(feeNote, 186);
  let fy = stripY + 27;
  for (const l of feeNoteLines) {
    doc.text(l, 14, fy);
    fy += 3.4;
  }

  // Record tables
  let y = fy + 3;
  y = recordTable(doc, autoTable, "Application Details", [
    ["School", "Government High School Babi Khel"],
    ["Admission Cycle", cycle],
    ["Class Applied For", `Class ${input.applyingClass}`],
    ["Admission Type", typeLabel(input.admissionType)],
    ["Session", input.sessionYear || cycle],
    ["Shift", "Morning"],
    ["Date", fmtFeeDate(input.appliedOn)],
    ["Reference No.", input.referenceNo],
  ], y);

  y = recordTable(doc, autoTable, "Student Information", [
    ["Full Name", input.name],
    ["Father Name", input.fatherName],
    ["B-Form No.", input.bFormNo],
    ["Father CNIC", input.fatherCnic],
    ["Date of Birth", fmtFeeDate(input.dateOfBirth)],
    ["Gender", input.gender ? input.gender.charAt(0).toUpperCase() + input.gender.slice(1) : "—"],
    ["Contact (Mobile)", input.contactNumber],
    ["WhatsApp", input.whatsappNumber],
    ["Occupation", input.occupation],
    ["Home Address", input.homeAddress],
  ], y + 4);

  y = recordTable(doc, autoTable, "Academic Information", [
    ["Previous School", input.previousSchool],
    ["Previous Class", input.previousClass],
    ["Marks / Grade", input.previousMarks],
    ["Year of Passing", input.yearOfPassing],
  ], y + 4);

  // Documents checklist
  doc.setFillColor(GREEN);
  doc.roundedRect(12, y + 4, 186, 6.4, 1, 1, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor("#FFFFFF");
  doc.text("DOCUMENTS CHECKLIST", 15, y + 8.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(SUB);
  let ly = y + 16;
  for (const item of CHECKLIST_ITEMS) {
    doc.setDrawColor(GREEN);
    doc.setLineWidth(0.3);
    doc.rect(16, ly - 2.8, 3.4, 3.4);
    doc.text(item, 22, ly);
    ly += 5.4;
  }

  // Footer page 1
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`${PDF_SCHOOL_NAME} | Application ${input.referenceNo} | Page 1 of 2`, W / 2, 291, { align: "center" });

  // ── PAGE 2 — AFFIDAVIT · UNDERTAKING · ENDORSEMENT ────────────────────────
  doc.addPage();
  doc.setFillColor(GREEN);
  doc.roundedRect(10, 8, W - 20, 12, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor("#FFFFFF");
  doc.text("AFFIDAVIT  ·  UNDERTAKING  ·  ENDORSEMENT", W / 2, 15.5, { align: "center" });
  doc.setFillColor(GOLD);
  doc.rect(10, 20, W - 20, 1, "F");

  let py = 27;
  const para = (title: string, text: string, extraGap = 4) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(INK);
    doc.text(title, 14, py);
    py += 4.4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(SUB);
    for (const l of doc.splitTextToSize(text, 182)) {
      doc.text(l, 14, py);
      py += 3.8;
    }
    py += extraGap;
  };

  para(
    "DECLARATION",
    "I declare that the information given in support of this application is accurate and complete. " +
      "I understand that any misrepresentation will result in disqualification of my application for admission.",
  );
  // Signature blanks
  doc.setDrawColor(SUB);
  doc.setLineWidth(0.25);
  doc.line(16, py, 80, py);
  doc.line(W - 80, py, W - 16, py);
  doc.setFontSize(7.2);
  doc.setTextColor(MUTED);
  doc.text("Applicant Signature", 48, py + 3.6, { align: "center" });
  doc.text("Parent / Guardian Signature", W - 48, py + 3.6, { align: "center" });
  py += 11;

  para(
    "AFFIDAVIT",
    `Certified that I, ${input.name || "________"}, had not taken admission in the same class in any other ` +
      "institution during the previous year(s), and that I am not under any disciplinary ban by any school or board. " +
      "In case of any misstatement, my right of admission, or even the granted admission, shall stand cancelled.",
  );

  para(
    "UNDERTAKING",
    "I undertake that, once admitted, I shall follow all rules of the school, maintain discipline, and " +
      "shall not indulge in politics. In case I violate this undertaking, I shall be expelled without any further " +
      "notice from the Principal, whose finding in this regard shall be final and shall not be questioned except " +
      "before the Supreme Court of Pakistan.",
  );

  // Deponent tables
  const deponent = (title: string, pairs: Array<[string, string]>) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(INK);
    doc.text(title, 14, py);
    py += 4;
    autoTable(doc, {
      startY: py,
      body: pairs.map((p) => [
        { content: p[0], styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7.2 } },
        { content: p[1] || "", styles: { textColor: INK, fontSize: 8 } },
      ]),
      theme: "grid",
      styles: { cellPadding: 1.6, lineColor: GRID, lineWidth: 0.2, minCellHeight: 6.4 },
      columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: "auto" } },
      margin: { left: 14, right: 14 },
    });
    py = ((doc as any).lastAutoTable.finalY as number) + 6;
  };

  deponent("DEPONENT — STUDENT", [
    ["Student Name", input.name],
    ["B-Form No.", input.bFormNo],
    ["Father's / Guardian's Name", input.fatherName],
    ["Permanent Address", input.homeAddress],
    ["Dated", ""],
    ["Signature", ""],
  ]);

  deponent("DEPONENT — FATHER / GUARDIAN", [
    ["Name", input.fatherName],
    ["CNIC No.", input.fatherCnic],
    ["Relation", "Father / Guardian"],
    ["Contact No.", input.contactNumber],
    ["Dated", ""],
    ["Signature", ""],
  ]);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  doc.setTextColor(SUB);
  for (const l of doc.splitTextToSize(
    "Endorsement by Father / Guardian: I have read the admission rules and the fee schedule of the school. " +
      "I endorse this application and undertake that my child/ward shall abide by the school discipline and pay " +
      "all dues on time.",
    182,
  )) {
    doc.text(l, 14, py);
    py += 3.6;
  }
  py += 5;

  // Witnesses — side-by-side
  const witW = 88;
  const drawWitness = (x: number, label: string) => {
    doc.setFillColor(ALT);
    doc.roundedRect(x, py, witW, 26, 1.5, 1.5, "F");
    doc.setDrawColor(GRID);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, py, witW, 26, 1.5, 1.5, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    doc.setTextColor(INK);
    doc.text(label, x + 4, py + 5.4);
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    const lines = ["Name: ______________________", "CNIC No.: ___________________", "Signature: __________________"];
    lines.forEach((l, i) => doc.text(l, x + 4, py + 10.5 + i * 4.6));
  };
  drawWitness(14, "WITNESS NO. 1");
  drawWitness(W - 14 - witW, "WITNESS NO. 2");
  py += 31;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor(INK);
  doc.text("Attested (Signature & Seal of the Competent Authority)", 14, py + 2);

  // FOR OFFICE USE ONLY
  const officeY = Math.max(py + 8, 258);
  doc.setFillColor(GOLD_TINT);
  doc.roundedRect(12, officeY, 186, 22, 1.5, 1.5, "F");
  doc.setDrawColor(GOLD);
  doc.setLineWidth(0.3);
  doc.roundedRect(12, officeY, 186, 22, 1.5, 1.5, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.4);
  doc.setTextColor(GOLD);
  doc.text("FOR OFFICE USE ONLY", 15, officeY + 5.5);
  doc.setFontSize(8);
  doc.setTextColor(INK);
  doc.text(`Roll No.: ________    Admission No.: ________    Fee Verified: ________`, 15, officeY + 12.5);
  doc.setDrawColor(SUB);
  doc.setLineWidth(0.25);
  doc.line(120, officeY + 19, 152, officeY + 19);
  doc.line(158, officeY + 19, 192, officeY + 19);
  doc.setFontSize(6.8);
  doc.setTextColor(MUTED);
  doc.text("Member 1", 136, officeY + 21.8, { align: "center" });
  doc.text("Chairman / Member 2", 175, officeY + 21.8, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`${PDF_SCHOOL_NAME} | Application ${input.referenceNo} | Page 2 of 2`, W / 2, 291, { align: "center" });

  doc.save(`Application-${input.referenceNo}.pdf`);
}
