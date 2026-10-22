// src/components/ReportCard/generateExcel.ts
// Premium green & gold Excel workbook (.xlsx) built with ExcelJS.
//
//   Sheet 1 "Summary" — banner · KPI table · subject-wise pass rate
//   Sheet 2 "Results" — banner · ranked table: Pos · Roll No · Name · every
//                       subject's marks (practical only where it exists) · Total
//
// Print/A4 accuracy: both sheets are set to A4, horizontally centred on the
// page, fit-to-one-page-wide, with the header row repeated on every printed
// page and "Page x of y" in the footer. EVERY cell is centred horizontally and
// vertically; long names wrap inside their cell (never cut off).
//
// ExcelJS (~270 KB compressed) is imported dynamically so it only downloads
// when the Excel button is clicked.
import type { Borders, Fill } from "exceljs";
import type { ExamSelection, NormalizedResult, ResultStats } from "./types";
import { classDisplayName } from "./classMaxMarks";
import { rankResults, safeFilePart } from "./pdfTheme";

// ARGB palette (matches the PDFs)
const GREEN_DEEP = "FF0C3A28";
const GREEN = "FF166548";
const GREEN_SOFT = "FFECF6F0";
const GOLD = "FFD4AF37";
const GOLD_DARK = "FFB8860B";
const GOLD_SOFT = "FFFBF3D6";
const INK = "FF0F172A";
const MUTED = "FF64748B";
const BORDER = "FFD6E0DA";
const STRIPE = "FFF6FAF7";
const WHITE = "FFFFFFFF";
const PASS = "FF15803D";
const PASS_BG = "FFDCFCE7";
const FAIL = "FFB91C1C";
const FAIL_BG = "FFFEE2E2";

const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const line = { style: "thin" as const, color: { argb: BORDER } };
const box: Partial<Borders> = { top: line, left: line, bottom: line, right: line };
const CENTER = { horizontal: "center" as const, vertical: "middle" as const, wrapText: true };

export function excelFileName(sel: ExamSelection): string {
  const schoolSlug = safeFilePart(sel.schoolName || "GHS_BabiKhel").replace(/_+/g, "_");
  return `${schoolSlug}_${safeFilePart(sel.className)}_${safeFilePart(sel.examType)}_${safeFilePart(sel.year)}.xlsx`;
}

function buildSubjectColumns(results: NormalizedResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) for (const s of r.subjects) if (s.name) set.add(s.name);
  return Array.from(set).sort();
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
  wb.creator = school;
  wb.created = new Date();

  /** Merged banner rows 1-3 across `cols` columns. */
  const banner = (ws: import("exceljs").Worksheet, cols: number, tag: string) => {
    const rows: Array<[string, number, string, boolean, number]> = [
      [tag.toUpperCase(), 9, GOLD, true, 18],
      [school, 17, WHITE, true, 30],
      [examLine, 11, "FFE2ECE5", false, 20],
    ];
    // Total sheet width in Excel character units → estimate how many lines a
    // long school name needs so the banner row is tall enough (no clipping).
    const totalWidth = ws.columns.reduce((a, c) => a + (c.width ?? 10), 0);
    rows.forEach(([text, size, color, bold, heightIn], i) => {
      const r = i + 1;
      const charW = (size / 11) * (bold ? 1.12 : 1.0);
      const lines = Math.max(1, Math.ceil((text.length * charW) / Math.max(10, totalWidth - 4)));
      const height = lines === 1 ? heightIn : lines * (size * 1.45) + 6;
      ws.mergeCells(r, 1, r, cols);
      const c = ws.getCell(r, 1);
      c.value = text;
      c.font = { name: "Calibri", size, bold, color: { argb: color } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      for (let k = 1; k <= cols; k++) ws.getCell(r, k).fill = solid(GREEN_DEEP);
      ws.getRow(r).height = height;
    });
    // gold rule
    ws.getRow(4).height = 4;
    for (let k = 1; k <= cols; k++) ws.getCell(4, k).fill = solid(GOLD);
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

  const th = (cell: import("exceljs").Cell) => {
    cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: WHITE } };
    cell.fill = solid(GREEN);
    cell.alignment = CENTER;
    cell.border = { top: line, left: line, bottom: { style: "medium", color: { argb: GOLD } }, right: line };
  };

  // ═════════════════════ Sheet 1 — Summary ═════════════════════
  const ws1 = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: GREEN } },
  });
  ws1.columns = [{ width: 34 }, { width: 18 }, { width: 18 }, { width: 18 }];
  banner(ws1, 4, "BISE Peshawar · Result Summary");
  ws1.addRow([]);

  const sec = (text: string) => {
    const r = ws1.addRow([text, "", "", ""]);
    ws1.mergeCells(r.number, 1, r.number, 4);
    const c = r.getCell(1);
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: GREEN_DEEP } };
    c.alignment = CENTER;
    c.border = { bottom: { style: "medium", color: { argb: GOLD } } };
    r.height = 24;
  };

  sec("KEY STATISTICS");
  const head = ws1.addRow(["Metric", "Value", "", ""]);
  ws1.mergeCells(head.number, 2, head.number, 4);
  head.height = 22;
  [1, 2, 3, 4].forEach((k) => th(head.getCell(k)));

  const statRows: Array<[string, string | number, string?]> = [
    ["Total Students", stats.totalStudents],
    ["Passed", stats.passCount, PASS],
    ["Failed", stats.failCount, FAIL],
    ["Pass Percentage", `${stats.passPercentage}%`],
    ["Average Marks", stats.averageMarks],
    ["Highest Marks", stats.highestMarks, GOLD_DARK],
    ["Lowest Marks", stats.lowestMarks],
    ["Top Scorer", stats.topScorerName ? `${stats.topScorerName} (Roll ${stats.topScorerRoll})` : "—", GOLD_DARK],
  ];
  statRows.forEach(([label, value, color], i) => {
    const r = ws1.addRow([label, value, "", ""]);
    ws1.mergeCells(r.number, 2, r.number, 4);
    r.height = label === "Top Scorer" ? 30 : 22;
    [1, 2, 3, 4].forEach((k) => {
      const c = r.getCell(k);
      c.alignment = CENTER;
      c.border = box;
      c.fill = solid(i % 2 === 1 ? STRIPE : WHITE);
      c.font = { name: "Calibri", size: 10.5, color: { argb: INK } };
    });
    r.getCell(1).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: GREEN_DEEP } };
    r.getCell(2).font = { name: "Calibri", size: 11, bold: true, color: { argb: color ?? INK } };
  });

  ws1.addRow([]);
  sec("SUBJECT-WISE PASS RATE");
  const sh = ws1.addRow(["Subject", "Passed", "Failed", "Pass %"]);
  sh.height = 22;
  [1, 2, 3, 4].forEach((k) => th(sh.getCell(k)));
  Object.entries(stats.subjectPassRates).forEach(([name, c], i) => {
    const r = ws1.addRow([name, c.pass, c.fail, `${c.rate}%`]);
    r.height = 21;
    r.eachCell((cell, col) => {
      cell.alignment = CENTER;
      cell.border = box;
      cell.fill = solid(i % 2 === 1 ? STRIPE : WHITE);
      cell.font = { name: "Calibri", size: 10.5, color: { argb: INK }, bold: col === 1 };
    });
    r.getCell(2).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: PASS } };
    r.getCell(3).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: FAIL } };
    r.getCell(4).font = {
      name: "Calibri", size: 10.5, bold: true,
      color: { argb: c.rate >= 80 ? PASS : c.rate < 50 ? FAIL : INK },
    };
  });
  printSetup(ws1, false);

  // ═════════════════════ Sheet 2 — Results ═════════════════════
  const subjectCols = buildSubjectColumns(results);
  const practical = subjectsWithPractical(results);
  const header: string[] = ["Pos", "Roll No", "Name"];
  for (const s of subjectCols) {
    header.push(s);
    if (practical.has(s)) header.push(`${s} (Practical)`);
  }
  header.push("Total Marks");
  const ncols = header.length;
  const HEADER_ROW = 6;

  const ws2 = wb.addWorksheet("Results", {
    views: [{ state: "frozen", xSplit: 3, ySplit: HEADER_ROW, showGridLines: false }],
    properties: { tabColor: { argb: GOLD } },
  });
  const longestName = Math.max(10, ...results.map((r) => (r.found ? (r.name || "").length : 0)));
  ws2.columns = header.map((h, i) => {
    if (i === 0) return { width: 6 };
    if (i === 1) return { width: 11 };
    if (i === 2) return { width: Math.min(34, Math.max(22, longestName + 3)) };
    if (i === ncols - 1) return { width: 13 };
    // Wide enough for the LONGEST WORD of the header (so "Mathematics" never
    // breaks mid-word); multi-word headers wrap between words.
    const longestWord = Math.max(...h.split(/\s+/).map((w) => w.length));
    return { width: Math.min(18, Math.max(10, Math.ceil(longestWord * 1.2) + 2)) };
  });
  banner(ws2, ncols, "BISE Peshawar · Student Results");
  ws2.addRow([]); // row 5 spacer
  const hr = ws2.addRow(header);
  hr.height = 36;
  hr.eachCell((c) => th(c));

  const ranked = rankResults(results);
  ranked.forEach(({ r, pos }, idx) => {
    const vals: Array<string | number> = [pos ?? "—", r.roll, r.found ? r.name || "—" : r.error || "Not found"];
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
    vals.push(r.found && r.totalMarks > 0 ? r.totalMarks : "—");

    const row = ws2.addRow(vals);
    row.height = 22;
    const podium = pos !== null && pos <= 3;
    row.eachCell((cell, col) => {
      cell.alignment = CENTER;
      cell.border = box;
      cell.font = { name: "Calibri", size: 10, color: { argb: INK }, bold: col === 3 || col === ncols };
      cell.fill = solid(podium ? GOLD_SOFT : idx % 2 === 1 ? STRIPE : WHITE);
    });
    if (podium) row.getCell(1).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: GOLD_DARK } };
    for (const col of failCells) {
      const c = row.getCell(col);
      c.font = { name: "Calibri", size: 10, bold: true, color: { argb: FAIL } };
      c.fill = solid(FAIL_BG);
    }
    if (r.found && !r.isFail && r.totalMarks > 0) row.getCell(ncols).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: PASS } };
    if (r.found && r.isFail) row.getCell(ncols).font = { name: "Calibri", size: 10.5, bold: true, color: { argb: FAIL } };
  });

  printSetup(ws2, ncols > 7, `${HEADER_ROW}:${HEADER_ROW}`);
  void PASS_BG; void MUTED; void GREEN_SOFT; // palette kept for future use

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
