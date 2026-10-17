// src/components/ReportCard/generatePDF.ts
// Premium A4 result gazette for ONE class (green & gold design).
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
import { classDisplayName } from "./classMaxMarks";
import {
  A4_W, CONTENT_W, MARGIN, SAFE_BOTTOM, SLIM_H, T,
  drawBand, drawFooters, fill, fitCenteredText, ink, kpiTiles, rankResults,
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
  if (stats.topScorerName) {
    const h = 46;
    fill(doc, T.goldSoft);
    stroke(doc, T.goldLine, 0.9);
    doc.roundedRect(MARGIN, y, CONTENT_W, h, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    ink(doc, T.gold);
    doc.setCharSpace(1.4);
    doc.text("TOP SCORER", A4_W / 2, y + 14, { align: "center" });
    doc.setCharSpace(0);
    ink(doc, T.ink);
    fitCenteredText(doc, stats.topScorerName, A4_W / 2, y + 28, CONTENT_W - 30, 12.5, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    ink(doc, T.text);
    doc.text(`Roll ${stats.topScorerRoll}  ·  ${stats.highestMarks} marks`, A4_W / 2, y + 40, { align: "center" });
    y += h + 16;
  }

  // ── Subject-wise pass rate ──
  const subjectEntries = Object.entries(stats.subjectPassRates);
  if (subjectEntries.length > 0) {
    y = sectionTitle(doc, "SUBJECT-WISE PASS RATE", y);
    autoTable(doc, {
      ...tableBase(doc, { slimLabel }),
      startY: y,
      head: [["Subject", "Passed", "Failed", "Pass %"]],
      body: subjectEntries.map(([name, c]) => [name, String(c.pass), String(c.fail), `${c.rate}%`]),
      columnStyles: {
        0: { cellWidth: CONTENT_W - 300, fontStyle: "bold" },
        1: { cellWidth: 100 },
        2: { cellWidth: 100 },
        3: { cellWidth: 100 },
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
    });
    y = lastY() + 20;
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
      r.totalMarks > 0 ? String(r.totalMarks) : "—",
      r.totalMarks > 0 ? `${r.percentage}%` : "—",
      r.grade || (r.isFail ? "F" : "—"),
      status,
    ];
  });
  // 32+56+118+118+46+44+40+73 = 527 = CONTENT_W (rounded) — last col absorbs the remainder
  const fixed = 32 + 56 + 118 + 118 + 46 + 44 + 40;
  autoTable(doc, {
    ...tableBase(doc, { slimLabel }),
    startY: y,
    head: [["Pos", "Roll No", "Name", "Father Name", "Total", "%", "Grade", "Status"]],
    body,
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 56 },
      2: { cellWidth: 118, fontStyle: "bold" },
      3: { cellWidth: 118 },
      4: { cellWidth: 46, fontStyle: "bold" },
      5: { cellWidth: 44 },
      6: { cellWidth: 40 },
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
        if (txt.startsWith("FAIL")) data.cell.styles.textColor = T.fail;
        else if (txt === "PASS") data.cell.styles.textColor = T.pass;
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
      headStyles: { ...tableBase(doc).headStyles, fillColor: T.fail, lineColor: T.fail },
      alternateRowStyles: { fillColor: [254, 242, 242] },
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
