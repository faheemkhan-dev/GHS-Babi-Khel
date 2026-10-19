import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { format } from "date-fns";
import { encodeExamQRData } from "@/hooks/useExamAttendance";
import { examTypeLabel } from "@/utils/examTypeLabel";
import type { ExamScheduleEntry } from "@/hooks/useNewFeatures";
import { SLIP_INSTRUCTIONS, type ExamSession, type RollEntry } from "@/lib/rollSlipTypes";

/* Loaded on demand (dynamic import) the first time a student taps Download —
   jsPDF + autotable + qrcode are ~300 KB that the page does not need to open. */
/* ═══ SLIP PDF — EXACT replica of the admin dashboard "Roll No Slips" sheet ═
   Full-page A4 PORTRAIT single slip (admin prints 2-up landscape) — same
   header, info rows, QR, class date-sheet table, 9 instructions and Deputy
   Controller signature — so the student's download is 1:1 identical to the
   office copy. The single slip is simply centred on the sheet.            */
export async function downloadSlipPdf(session: ExamSession, r: RollEntry, schedule: ExamScheduleEntry[]) {
  // Student copy: ONE slip on a full A4 PORTRAIT page (the admin sheet is a
  // 2-up landscape print; students get a full-size single page instead).
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;

  const x = margin;
  const y = margin;
  const w = pageW - margin * 2;
  const h = pageH - margin * 2;

  // Same QR payload + settings as the admin sheet
  const qrData = encodeExamQRData(session.id, r.student_id, r.exam_roll_no);
  const qrImg = await QRCode.toDataURL(qrData, { width: 300, margin: 1, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#FFFFFF" } });

  // ── Same layout as the admin sheet (see AdminExamRollNumbers.downloadPrint) ──
  const padX = 12;
  const cx = x + w / 2;

  // ── Frame: outer + hairline inner border ──
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h, "S");
  doc.setDrawColor(190, 190, 190);
  doc.setLineWidth(0.2);
  doc.rect(x + 1.6, y + 1.6, w - 3.2, h - 3.2, "S");

  // ── HEADER ──
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("GOVT. HIGH SCHOOL BABI KHEL", cx, y + 16, { align: "center" });

  doc.setFontSize(13);
  doc.setTextColor(60, 60, 60);
  const classExamType = schedule[0]?.exam_type || session.exam_term;
  doc.text(`${examTypeLabel(classExamType).toUpperCase()} ${session.exam_year}`, cx, y + 24, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 110);
  doc.text("EXAM  ROLL  NUMBER  SLIP", cx, y + 30, { align: "center", charSpace: 0.6 } as any);

  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.7);
  doc.line(x + padX, y + 34, x + w - padX, y + 34);
  doc.setLineWidth(0.2);
  doc.line(x + padX, y + 35.3, x + w - padX, y + 35.3);

  // ── STUDENT INFO (left) + QR (right) ──
  const qrSize = 42;
  const qrBoxX = x + w - padX - qrSize - 2;
  const qrBoxY = y + 42;
  const leftX = x + padX;
  const valX = leftX + 36;
  const maxValW = qrBoxX - valX - 4;

  const drawRow = (label: string, value: string, yy: number, big = false) => {
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(115, 115, 115);
    doc.text(label, leftX, yy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(big ? 15 : 12);
    let v = value;
    while (v.length > 4 && doc.getTextWidth(v) > maxValW) v = v.slice(0, -2);
    if (v !== value) v = v.replace(/\s+$/, "") + "…";
    doc.text(v, valX, yy);
  };
  let rowY = y + 52;
  const rowGap = 11;
  drawRow("Student Name:", r.student_name, rowY); rowY += rowGap;
  drawRow("Father Name:", r.father_name || "—", rowY); rowY += rowGap;
  drawRow("Exam Roll No:", r.exam_roll_no, rowY, true); rowY += rowGap;
  drawRow("Class:", `Class ${r.class}`, rowY);

  if (qrImg) {
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.35);
    doc.roundedRect(qrBoxX - 1.5, qrBoxY - 1.5, qrSize + 3, qrSize + 3, 1.5, 1.5, "S");
    doc.addImage(qrImg, "PNG", qrBoxX, qrBoxY, qrSize, qrSize);
  }

  // ── LAYOUT BUDGET ──
  // The slip is 198 mm tall. We size the date-sheet rows from the room that is
  // actually available so the page is filled evenly (no empty block in the middle)
  // whatever number of papers the class has.
  const tableStartY = y + 94;
  const sigY = y + h - 14;
  const instrLines = SLIP_INSTRUCTIONS.length;
  const instrLineH = 6;
  const instrH = 9 + instrLines * instrLineH;
  const sigTop = sigY - 9;
  const tableAvail = sigTop - instrH - 6 - tableStartY;
  const nRows = Math.max(schedule.length, 1) + 1;
  const rowMm = Math.min(10, Math.max(5, tableAvail / nRows));
  const fontPt = rowMm >= 8 ? 10 : rowMm >= 6.6 ? 9 : rowMm >= 5.8 ? 7.8 : 7;
  const cellPad = Math.max(1, (rowMm - fontPt * 0.352 * 1.15) / 2);

  if (schedule.length > 0) {
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: x + padX, right: pageW - (x + w) + padX, bottom: pageH - sigTop },
      tableWidth: w - padX * 2,
      head: [["Paper Date", "Day", "Subject", "From", "To"]],
      body: schedule.map(e => [
        format(new Date(e.exam_date), "dd-MM-yyyy"),
        format(new Date(e.exam_date), "EEEE"),
        e.subject,
        e.start_time || "—",
        e.end_time || "—",
      ]),
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 32 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 } },
      styles: { fontSize: fontPt, cellPadding: cellPad, textColor: [30, 30, 30], lineColor: [150, 150, 150], lineWidth: 0.2, halign: "center", valign: "middle" },
      headStyles: { fillColor: [228, 228, 228], textColor: [20, 20, 20], fontStyle: "bold", fontSize: fontPt, halign: "center", valign: "middle" },
      alternateRowStyles: { fillColor: [248, 248, 248] },
      theme: "grid",
    });
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(150, 150, 150);
    doc.text("Date sheet not yet published for this class.", cx, tableStartY + 12, { align: "center" });
  }

  // ── INSTRUCTIONS — sits under the table, never closer than 6 mm, pushed down
  // when the table is short so the lower half of the slip is balanced. ──
  const tableEndY = (doc as any).lastAutoTable?.finalY ?? (tableStartY + 30);
  const instrStartY = Math.max(tableEndY + 7, sigTop - instrH - 1);
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.25);
  doc.line(x + padX, instrStartY, x + w - padX, instrStartY);
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Instructions:", x + padX, instrStartY + 6);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(85, 85, 85);
  const instructions = SLIP_INSTRUCTIONS;
  const maxInstrW = w - padX * 2;
  instructions.forEach((line, i) => {
    let t = line;
    while (t.length > 8 && doc.getTextWidth(t) > maxInstrW) t = t.slice(0, -2);
    if (t !== line) t = t.replace(/\s+$/, "") + "…";
    doc.text(t, x + padX, instrStartY + 12.5 + i * instrLineH);
  });

  // ── SIGNATURE (anchored bottom-right) ──
  doc.setDrawColor(90, 90, 90);
  doc.setLineWidth(0.35);
  doc.line(x + w - padX - 60, sigY, x + w - padX, sigY);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Deputy Controller of Exams", x + w - padX - 30, sigY + 5, { align: "center" });

  doc.save(`RollNoSlip-${r.exam_roll_no}-${r.student_name.replace(/\s+/g, "_")}.pdf`);
}

