// src/components/ReportCard/generatePDF.ts
// Premium A4 result gazette for ONE class — light, airy, modern design:
// white page, hairline rules, a compact header (deep green + gold used only as
// thin accents), KPI cards, top-scorer card, subject pass-rate table with
// mini bars, ranked student table and a failed-papers breakdown.
//
//   • A4 portrait, identical left/right margins, every table is exactly
//     CONTENT_W wide → the whole page is centred.
//   • Every table cell is centred horizontally AND vertically; long names wrap
//     inside their cell (never cut off).
//   • Header band · KPI tiles · top-scorer card · subject pass-rate table ·
//     ranked student table (position / roll / name / father / total / % /
//     grade / status) · failed-papers breakdown · footer with page numbers.
//
// jspdf + jspdf-autotable are imported dynamically so they only download when
// a user actually clicks a PDF button.
import type { ExamSelection, NormalizedResult, ResultStats } from "./types";
import { classDisplayName, CLASS_MAX_MARKS } from "./classMaxMarks";
import {
  A4_W, CONTENT_W, MARGIN, SAFE_BOTTOM, SLIM_H, T,
  drawBand, drawFooters, fill, fitLeftText, ink, kpiTiles, rankResults,
  safeFilePart, sectionTitle, stroke, tableBase,
} from "./pdfTheme";

const DEFAULT_SCHOOL = "GHS Babi Khel, District Mohmand";

/** "STAT-T-I (Theory + Practical)" style label for a failed subject. */
function failedSubjectLabel(s: NormalizedResult["subjects"][number]): string {
  const parts: string[] = [];
  if (s.theoryFail) parts.push("Theory");
  if (s.practicalFail) parts.push("Practical");
  return parts.length ? `${s.name} (${parts.join(" + ")})` : s.name;
}

/** Build the file name. */
export function pdfFileName(sel: ExamSelection): string {
  const schoolSlug = safeFilePart(sel.schoolName || "GHS_BabiKhel").replace(/_+/g, "_");
  return `${schoolSlug}_${safeFilePart(sel.className)}_${safeFilePart(sel.examType)}_${safeFilePart(sel.year)}.pdf`;
}

export async function generateResultPDF(
  results: NormalizedResult[],
  stats: ResultStats,
  sel: ExamSelection
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const school = sel.schoolName || DEFAULT_SCHOOL;
  const examLine = `${classDisplayName(sel.className)}  ·  ${sel.examType}  ·  ${sel.year}`;
  const slimLabel = `${school}  ·  ${examLine}`;
  const lastY = () => (doc as any).lastAutoTable.finalY as number;

  // ── Header band ──
  let y = drawBand(doc, { eyebrow: "BISE Peshawar · Result Gazette", title: school, subtitle: examLine });

  // ── KPI tiles ──
  y = kpiTiles(doc, y, [
    { label: "Total Students", value: String(stats.totalStudents) },
    { label: "Passed", value: String(stats.passCount), color: T.pass },
    { label: "Failed", value: String(stats.failCount), color: T.fail },
    { label: "Pass %", value: `${stats.passPercentage}%` },
    { label: "Average", value: String(stats.averageMarks) },
    { label: "Highest", value: String(stats.highestMarks), color: T.gold },
  ]);

  // ── Top scorer card ──
  const classMax = CLASS_MAX_MARKS[sel.className];
  if (stats.topScorerName) {
    const h = 52;
    fill(doc, T.white);
    stroke(doc, T.goldLine, 0.9);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 7, 7, "FD");
    // soft gold wash on the left + medal
    fill(doc, T.goldSoft);
    doc.roundedRect(MARGIN + 0.45, y + 0.45, 62, h - 0.9, 6.5, 6.5, "F");
    fill(doc, T.white);
    doc.rect(MARGIN + 40, y + 0.45, 24, h - 0.9, "F"); // square the inner edge
    fill(doc, T.goldLine);
    doc.circle(MARGIN + 31, y + h / 2, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    ink(doc, T.white);
    doc.text("1", MARGIN + 31, y + h / 2 + 4.6, { align: "center" });

    const tx = MARGIN + 68;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    ink(doc, T.gold);
    doc.setCharSpace(1.4);
    doc.text("TOP SCORER", tx, y + 16);
    doc.setCharSpace(0);
    ink(doc, T.ink);
    doc.setFont("helvetica", "bold");
    fitLeftText(doc, stats.topScorerName, tx, y + 31, CONTENT_W - 68 - 130, 13, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    ink(doc, T.muted);
    doc.text(`Roll ${stats.topScorerRoll}`, tx, y + 43.5);

    // marks on the right: 484 / 600
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const maxTxt = ` / ${classMax}`;
    const maxW = doc.getTextWidth(maxTxt);
    doc.setFontSize(20);
    ink(doc, T.ink);
    const mx = A4_W - MARGIN - 16;
    doc.text(String(stats.highestMarks), mx - maxW, y + 33, { align: "right" });
    doc.setFontSize(8.5);
    ink(doc, T.muted);
    doc.text(maxTxt, mx, y + 33, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.4);
    ink(doc, T.gold);
    doc.setCharSpace(1);
    doc.text("MARKS", mx, y + 43.5, { align: "right" });
    doc.setCharSpace(0);
    y += h + 18;
  }

  // ── Subject-wise pass rate ──
  const subjectEntries = Object.entries(stats.subjectPassRates);
  if (subjectEntries.length > 0) {
    y = sectionTitle(doc, "SUBJECT-WISE PASS RATE", y);
    autoTable(doc, {
      ...tableBase(doc, { slimLabel }),
      startY: y,
      head: [["Subject", "Passed", "Failed", "Pass %", "Pass rate"]],
      body: subjectEntries.map(([name, c]) => [name, String(c.pass), String(c.fail), `${c.rate}%`, ""]),
      columnStyles: {
        0: { cellWidth: 120, fontStyle: "bold" },
        1: { cellWidth: 64 },
        2: { cellWidth: 64 },
        3: { cellWidth: 64 },
        4: { cellWidth: CONTENT_W - 312 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.column.index === 1) data.cell.styles.textColor = T.pass;
        if (data.column.index === 2) data.cell.styles.textColor = T.fail;
        if (data.column.index === 3) {
          const rate = parseFloat(String(data.cell.raw));
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = rate >= 80 ? T.pass : rate < 50 ? T.fail : T.ink;
        }
      },
      // mini progress bar in the last column
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 4) return;
        const entry = subjectEntries[data.row.index];
        if (!entry) return;
        const rate = Math.max(0, Math.min(100, entry[1].rate));
        const bx = data.cell.x + 12, bw = data.cell.width - 24, bh = 4.2;
        const by = data.cell.y + data.cell.height / 2 - bh / 2;
        fill(doc, T.track);
        doc.roundedRect(bx, by, bw, bh, 2.1, 2.1, "F");
        if (rate > 0) {
          fill(doc, rate >= 50 ? T.green : T.fail);
          doc.roundedRect(bx, by, Math.max(bh, (bw * rate) / 100), bh, 2.1, 2.1, "F");
        }
      },
    });
    y = lastY() + 22;
  }

  // ── Student results (ranked) ──
  if (y > SAFE_BOTTOM - 110) {
    doc.addPage();
    y = SLIM_H + 26;
  }
  y = sectionTitle(doc, `STUDENT RESULTS  (${results.length})`, y);
  const ranked = rankResults(results);
  const body = ranked.map(({ r, pos }) => {
    if (!r.found) return ["—", r.roll, r.error || "Not found", "—", "—", "—", "—", "N/A"];
    const status = r.isFail ? `FAIL${r.failedSubjectCount > 0 ? ` (${r.failedSubjectCount})` : ""}` : "PASS";
    return [
      pos ? String(pos) : "—",
      r.roll,
      r.name || "—",
      r.fatherName || "—",
      r.totalMarks > 0 ? `${r.totalMarks} / ${classMax}` : "—",
      r.totalMarks > 0 ? `${r.percentage}%` : "—",
      r.grade || (r.isFail ? "F" : "—"),
      status,
    ];
  });
  // 30+54+118+112+62+42+36 = 454 → last col takes the remainder (CONTENT_W − 454)
  const fixed = 30 + 54 + 118 + 112 + 62 + 42 + 36;
  autoTable(doc, {
    ...tableBase(doc, { slimLabel }),
    startY: y,
    head: [["Pos", "Roll No", "Name", "Father Name", "Total", "%", "Grade", "Status"]],
    body,
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 54 },
      2: { cellWidth: 118, fontStyle: "bold" },
      3: { cellWidth: 112, textColor: T.text },
      4: { cellWidth: 62, fontStyle: "bold" },
      5: { cellWidth: 42 },
      6: { cellWidth: 36 },
      7: { cellWidth: CONTENT_W - fixed },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const rank = ranked[data.row.index];
      // Podium highlight for the top 3 positions
      if (rank?.pos && rank.pos <= 3) {
        data.cell.styles.fillColor = T.goldSoft;
        if (data.column.index === 0) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = T.gold;
        }
      }
      if (data.column.index === 7) {
        const txt = String(data.cell.raw || "");
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 8;
        if (txt.startsWith("FAIL")) { data.cell.styles.textColor = T.fail; data.cell.styles.fillColor = T.failSoft; }
        else if (txt === "PASS") { data.cell.styles.textColor = T.pass; data.cell.styles.fillColor = T.passSoft; }
        else data.cell.styles.textColor = T.muted;
      }
    },
  });
  y = lastY() + 22;

  // ── Failed papers breakdown ──
  const failedStudents = results.filter((r) => r.found && r.isFail);
  if (failedStudents.length > 0) {
    if (y > SAFE_BOTTOM - 90) {
      doc.addPage();
      y = SLIM_H + 26;
    }
    y = sectionTitle(doc, "FAILED PAPERS BREAKDOWN", y);
    autoTable(doc, {
      ...tableBase(doc, { slimLabel }),
      startY: y,
      head: [["Roll No", "Name", "Failed Papers"]],
      body: failedStudents.map((r) => [
        r.roll,
        r.name || "—",
        r.subjects.filter((s) => s.isFail).map(failedSubjectLabel).join(", ") || "—",
      ]),
      headStyles: { ...tableBase(doc).headStyles, fillColor: T.failSoft, textColor: T.fail, lineColor: T.fail },
      alternateRowStyles: { fillColor: [254, 248, 248] },
      columnStyles: {
        0: { cellWidth: 62 },
        1: { cellWidth: 150, fontStyle: "bold" },
        2: { cellWidth: CONTENT_W - 212 },
      },
    });
  }

  drawFooters(doc, `${school}  ·  BISE Peshawar Results`);
  doc.save(pdfFileName(sel));
}
