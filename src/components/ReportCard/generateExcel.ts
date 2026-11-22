// src/components/ReportCard/generateExcel.ts
// Premium, light & modern Excel workbook (.xlsx) built with ExcelJS.
//
//   Sheet 1 "Summary" — header · KPI strip · top scorer · subject-wise pass rate
//   Sheet 2 "Results" — header · ranked table: Pos · Roll No · Name · Father ·
//                       every subject's marks (practical only where it exists) ·
//                       Total (of class max) · % · Status   (frozen panes)
//
// Design: white sheet, no gridlines, airy horizontal hairlines only, a LIGHT
// table header with a gold underline. Deep green + gold are thin accents —
// never big solid fills. Pass / fail use soft tinted cells.
//
// Print/A4 accuracy: both sheets are set to A4, horizontally centred, fit to
// one page wide, header row repeated on every printed page, "Page x of y" in
// the footer.
//
// ExcelJS (~270 KB compressed) is imported dynamically so it only downloads
// when the Excel button is clicked.
import type { Borders, Fill } from "exceljs";
import type { ExamSelection, NormalizedResult, ResultStats } from "./types";
import { classDisplayName, CLASS_MAX_MARKS } from "./classMaxMarks";
import { rankResults, safeFilePart } from "./pdfTheme";

// ARGB palette (matches the PDFs)
const GREEN_DEEP = "FF0E4632";
const GREEN = "FF166548";
const GOLD = "FFD4AF37";
const GOLD_DARK = "FFA87A0A";
const GOLD_SOFT = "FFFDF7E3";
const INK = "FF111827";
const MUTED = "FF6B7280";
const BORDER = "FFE5E9E7";
const HEAD = "FFF1F5F2";
const STRIPE = "FFFAFBFA";
const WHITE = "FFFFFFFF";
const PASS = "FF15803D";
const PASS_BG = "FFE8F7ED";
const FAIL = "FFB91C1C";
const FAIL_BG = "FFFDEDED";

const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const hair = { style: "thin" as const, color: { argb: BORDER } };
const rowLine: Partial<Borders> = { bottom: hair };
const CENTER = { horizontal: "center" as const, vertical: "middle" as const, wrapText: true };
const LEFT = { horizontal: "left" as const, vertical: "middle" as const, wrapText: true, indent: 1 };

export function excelFileName(sel: ExamSelection): string {
  const schoolSlug = safeFilePart(sel.schoolName || "GHS_BabiKhel").replace(/_+/g, "_");
  return `${schoolSlug}_${safeFilePart(sel.className)}_${safeFilePart(sel.examType)}_${safeFilePart(sel.year)}.xlsx`;
}

function buildSubjectColumns(results: NormalizedResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) for (const s of r.subjects) if (s.name) set.add(s.name);
  return Array.from(set); // keep the board's own paper order (E-I, U-I, …)
}

/** A subject has a practical component only if at least one student has a
 *  non-null practical mark for it (BISE leaves it blank otherwise). */
function subjectsWithPractical(results: NormalizedResult[]): Set<string> {
  const set = new Set<string>();
  for (const r of results)
    for (const s of r.subjects)
      if (s.name && s.practical !== null && s.practical !== undefined) set.add(s.name);
  return set;
}

export async function generateResultExcel(
  results: NormalizedResult[],
  stats: ResultStats,
  sel: ExamSelection
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const school = sel.schoolName || "GHS Babi Khel, District Mohmand";
  const examLine = `${classDisplayName(sel.className)}  ·  ${sel.examType}  ·  ${sel.year}`;
  const classMax = CLASS_MAX_MARKS[sel.className];
  wb.creator = school;
  wb.created = new Date();

  /** Light header: thin green + gold strips, left-aligned title block, gold
   *  underline. Occupies rows 1-6 across `cols` columns. */
  const BANNER_ROWS = 6;
  const banner = (ws: import("exceljs").Worksheet, cols: number, tag: string) => {
    // 1 · deep-green hairline strip   2 · gold strip
    for (let k = 1; k <= cols; k++) {
      ws.getCell(1, k).fill = solid(GREEN_DEEP);
      ws.getCell(2, k).fill = solid(GOLD);
    }
    ws.getRow(1).height = 5;
    ws.getRow(2).height = 2;

    const totalWidth = ws.columns.reduce((a, c) => a + (c.width ?? 10), 0);
    const rows: Array<[string, number, string, boolean, number]> = [
      [tag.toUpperCase(), 9, GOLD_DARK, true, 24],
      [school, 18, INK, true, 32],
      [examLine, 10.5, MUTED, false, 20],
    ];
    rows.forEach(([text, size, color, bold, heightIn], i) => {
      const r = i + 3;
      const charW = (size / 11) * (bold ? 1.12 : 1.0);
      const lines = Math.max(1, Math.ceil((text.length * charW) / Math.max(10, totalWidth - 6)));
      const height = lines === 1 ? heightIn : lines * (size * 1.45) + 6;
      ws.mergeCells(r, 1, r, cols);
      const c = ws.getCell(r, 1);
      c.value = text;
      c.font = { name: "Calibri", size, bold, color: { argb: color } };
      c.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 };
      ws.getRow(r).height = height;
    });
    // 6 · gold underline
    ws.getRow(6).height = 5;
    for (let k = 1; k <= cols; k++) {
      ws.getCell(6, k).border = { bottom: { style: "medium", color: { argb: GOLD } } };
    }
  };

  const printSetup = (ws: import("exceljs").Worksheet, landscape: boolean, titleRow?: string) => {
    ws.pageSetup = {
      paperSize: 9, // A4
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.25, footer: 0.3 },
      ...(titleRow ? { printTitlesRow: titleRow } : {}),
    };
    ws.headerFooter = {
      oddFooter: `&L&8${school.replace(/&/g, "&&")}&R&8Page &P of &N`,
    };
  };

  /** Light table-head cell with a gold underline. */
  const th = (cell: import("exceljs").Cell) => {
    cell.font = { name: "Calibri", bold: true, size: 9.5, color: { argb: GREEN_DEEP } };
    cell.fill = solid(HEAD);
    cell.alignment = CENTER;
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
  };

  // ═════════════════════ Sheet 1 — Summary ═════════════════════
  const ws1 = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: GREEN } },
  });
  ws1.columns = [{ width: 28 }, { width: 22 }, { width: 22 }, { width: 22 }];
  banner(ws1, 4, "BISE Peshawar · Result Summary");
  ws1.addRow([]); // spacer (row 7)

  const sec = (text: string) => {
    const r = ws1.addRow([text, "", "", ""]);
    ws1.mergeCells(r.number, 1, r.number, 4);
    const c = r.getCell(1);
    c.font = { name: "Calibri", bold: true, size: 11, color: { argb: GREEN_DEEP } };
    c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    for (let k = 1; k <= 4; k++) r.getCell(k).border = { bottom: { style: "thin", color: { argb: GOLD } } };
    r.height = 24;
  };

  /** One KPI strip: a label row + a value row, 4 tiles across. */
  const kpiStrip = (tiles: Array<{ label: string; value: string | number; color?: string }>) => {
    const lab = ws1.addRow(tiles.map((t) => t.label.toUpperCase()));
    const val = ws1.addRow(tiles.map((t) => t.value));
    lab.height = 20;
    val.height = 34;
    tiles.forEach((t, i) => {
      const c1 = lab.getCell(i + 1);
      c1.font = { name: "Calibri", size: 8.5, bold: true, color: { argb: MUTED } };
      c1.alignment = { horizontal: "center", vertical: "bottom" };
      c1.fill = solid(WHITE);
      c1.border = { top: hair, left: hair, right: hair };
      const c2 = val.getCell(i + 1);
      c2.font = { name: "Calibri", size: 20, bold: true, color: { argb: t.color ?? INK } };
      c2.alignment = { horizontal: "center", vertical: "middle" };
      c2.fill = solid(WHITE);
      c2.border = { bottom: { style: "medium", color: { argb: t.color ?? GOLD } }, left: hair, right: hair };
    });
  };

  sec("KEY STATISTICS");
  ws1.addRow([]).height = 6;
  kpiStrip([
    { label: "Total Students", value: stats.totalStudents },
    { label: "Passed", value: stats.passCount, color: PASS },
    { label: "Failed", value: stats.failCount, color: FAIL },
    { label: "Pass %", value: `${stats.passPercentage}%` },
  ]);
  ws1.addRow([]).height = 8;
  kpiStrip([
    { label: "Average Marks", value: stats.averageMarks },
    { label: "Highest Marks", value: stats.highestMarks, color: GOLD_DARK },
    { label: "Lowest Marks", value: stats.lowestMarks },
    { label: "Out Of", value: classMax },
  ]);
  ws1.addRow([]).height = 8;

  if (stats.topScorerName) {
    const r = ws1.addRow(["TOP SCORER", `${stats.topScorerName}  ·  Roll ${stats.topScorerRoll}`, "", `${stats.highestMarks} / ${classMax}`]);
    ws1.mergeCells(r.number, 2, r.number, 3);
    r.height = 30;
    for (let k = 1; k <= 4; k++) {
      const c = r.getCell(k);
      c.fill = solid(GOLD_SOFT);
      c.border = { top: { style: "thin", color: { argb: GOLD } }, bottom: { style: "thin", color: { argb: GOLD } } };
      c.alignment = CENTER;
    }
    r.getCell(1).font = { name: "Calibri", size: 9, bold: true, color: { argb: GOLD_DARK } };
    r.getCell(2).font = { name: "Calibri", size: 12, bold: true, color: { argb: INK } };
    r.getCell(4).font = { name: "Calibri", size: 13, bold: true, color: { argb: GOLD_DARK } };
  }

  ws1.addRow([]).height = 10;
  sec("SUBJECT-WISE PASS RATE");
  ws1.addRow([]).height = 6;
  const sh = ws1.addRow(["Subject", "Passed", "Failed", "Pass %"]);
  sh.height = 22;
  [1, 2, 3, 4].forEach((k) => th(sh.getCell(k)));
  Object.entries(stats.subjectPassRates).forEach(([name, c], i) => {
    const r = ws1.addRow([name, c.pass, c.fail, c.rate / 100]);
    r.height = 21;
    r.eachCell((cell, col) => {
      cell.alignment = CENTER;
      cell.border = rowLine;
      cell.fill = solid(i % 2 === 1 ? STRIPE : WHITE);
      cell.font = { name: "Calibri", size: 10.5, color: { argb: INK }, bold: col === 1 };
    });
    r.getCell(2).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: PASS } };
    r.getCell(3).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: c.fail > 0 ? FAIL : MUTED } };
    const pc = r.getCell(4);
    pc.numFmt = "0%";
    pc.font = {
      name: "Calibri", size: 10.5, bold: true,
      color: { argb: c.rate >= 80 ? PASS : c.rate < 50 ? FAIL : GOLD_DARK },
    };
    pc.fill = solid(c.rate >= 80 ? PASS_BG : c.rate < 50 ? FAIL_BG : GOLD_SOFT);
  });
  printSetup(ws1, false);

  // ═════════════════════ Sheet 2 — Results ═════════════════════
  const subjectCols = buildSubjectColumns(results);
  const practical = subjectsWithPractical(results);
  const header: string[] = ["Pos", "Roll No", "Name", "Father Name"];
  for (const s of subjectCols) {
    header.push(s);
    if (practical.has(s)) header.push(`${s} (Practical)`);
  }
  header.push(`Total (of ${classMax})`, "%", "Status");
  const ncols = header.length;
  const HEADER_ROW = BANNER_ROWS + 2; // banner · spacer · header

  const ws2 = wb.addWorksheet("Results", {
    views: [{ state: "frozen", xSplit: 3, ySplit: HEADER_ROW, showGridLines: false }],
    properties: { tabColor: { argb: GOLD } },
  });
  const longestName = Math.max(10, ...results.map((r) => (r.found ? (r.name || "").length : 0)));
  const longestFather = Math.max(10, ...results.map((r) => (r.found ? (r.fatherName || "").length : 0)));
  ws2.columns = header.map((h, i) => {
    if (i === 0) return { width: 6 };
    if (i === 1) return { width: 11 };
    if (i === 2) return { width: Math.min(34, Math.max(22, longestName + 3)) };
    if (i === 3) return { width: Math.min(30, Math.max(18, longestFather + 3)) };
    if (i === ncols - 3) return { width: 13 }; // Total
    if (i === ncols - 2) return { width: 9 };  // %
    if (i === ncols - 1) return { width: 10 }; // Status
    // Wide enough for the LONGEST WORD of the header (so "Mathematics" never
    // breaks mid-word); multi-word headers wrap between words.
    const longestWord = Math.max(...h.split(/\s+/).map((w) => w.length));
    return { width: Math.min(18, Math.max(10, Math.ceil(longestWord * 1.2) + 2)) };
  });
  banner(ws2, ncols, "BISE Peshawar · Student Results");
  ws2.addRow([]); // spacer row
  const hr = ws2.addRow(header);
  hr.height = 36;
  hr.eachCell((c) => th(c));

  const colTotal = ncols - 2, colPct = ncols - 1, colStatus = ncols;
  const ranked = rankResults(results);
  ranked.forEach(({ r, pos }, idx) => {
    const vals: Array<string | number> = [pos ?? "—", r.roll, r.found ? r.name || "—" : r.error || "Not found", r.found ? r.fatherName || "—" : "—"];
    const failCells: number[] = [];
    for (const subj of subjectCols) {
      const s = r.subjects.find((x) => x.name === subj);
      if (!r.found) {
        vals.push("—");
        if (practical.has(subj)) vals.push("—");
        continue;
      }
      const t = s?.theory ?? "—";
      vals.push(s?.theoryFail ? `${t} (F)` : t);
      if (s?.theoryFail) failCells.push(vals.length);
      if (practical.has(subj)) {
        const p = s?.practical ?? "—";
        vals.push(s?.practicalFail ? `${p} (F)` : p);
        if (s?.practicalFail) failCells.push(vals.length);
      }
    }
    const hasMarks = r.found && r.totalMarks > 0;
    vals.push(hasMarks ? r.totalMarks : "—");
    vals.push(hasMarks ? r.percentage / 100 : "—");
    vals.push(!r.found ? "N/A" : r.isFail ? "FAIL" : "PASS");

    const row = ws2.addRow(vals);
    row.height = 23;
    const podium = pos !== null && pos <= 3;
    row.eachCell((cell, col) => {
      cell.alignment = col === 3 || col === 4 ? LEFT : CENTER;
      cell.border = rowLine;
      cell.font = { name: "Calibri", size: 10, color: { argb: INK }, bold: col === 3 || col === colTotal };
      cell.fill = solid(podium ? GOLD_SOFT : idx % 2 === 1 ? STRIPE : WHITE);
    });
    row.getCell(4).font = { name: "Calibri", size: 10, color: { argb: MUTED } };
    if (podium) row.getCell(1).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: GOLD_DARK } };
    for (const col of failCells) {
      const c = row.getCell(col);
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: FAIL } };
      c.fill = solid(FAIL_BG);
    }
    if (hasMarks) {
      row.getCell(colTotal).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: r.isFail ? FAIL : PASS } };
      row.getCell(colPct).numFmt = "0.0%";
      row.getCell(colPct).font = { name: "Calibri", size: 10, color: { argb: INK } };
    }
    const st = row.getCell(colStatus);
    st.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: !r.found ? MUTED : r.isFail ? FAIL : PASS } };
    if (r.found) st.fill = solid(r.isFail ? FAIL_BG : PASS_BG);
  });

  printSetup(ws2, true, `${HEADER_ROW}:${HEADER_ROW}`);

  // ═════════════════════ Save ═════════════════════
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = excelFileName(sel);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
