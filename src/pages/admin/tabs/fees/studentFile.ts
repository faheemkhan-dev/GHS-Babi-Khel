/**
 * studentFile.ts — reads the student list uploaded in Fee Management (separate from Exam Roll Numbers).
 *
 * Expected columns (any order if a header row is present; otherwise this order):
 *   Class No  |  Full Name  |  Father Name  |  Class
 *   1         |  Ahmad Khan |  Gul Khan     |  6
 *
 * Headers are matched loosely ("Class No", "Roll No", "Student Name", "Father",
 * "Class Title", "Class"...). "Class" may be written 6, 6th, Class 6, Six, VI.
 */
interface Student { id: string; full_name: string; roll_number: string; class: string; father_name: string | null }

export const ROSTER_CLASSES = ["6", "7", "8", "9", "10"];

export interface RosterParseResult {
  students: Student[];
  total: number;                 // data rows read (blank lines excluded)
  skippedNoName: number;
  skippedBadClass: number;
  skippedDuplicate: number;
  headerFound: boolean;
  error?: string;
}

const WORD_TO_CLASS: Record<string, string> = {
  six: "6", sixth: "6", vi: "6",
  seven: "7", seventh: "7", vii: "7",
  eight: "8", eighth: "8", viii: "8",
  nine: "9", ninth: "9", ix: "9",
  ten: "10", tenth: "10", x: "10",
};

export function normalizeClass(raw: string): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  const digits = v.match(/\d+/);
  if (digits) {
    const n = String(parseInt(digits[0], 10));
    return ROSTER_CLASSES.includes(n) ? n : null;
  }
  const word = v.replace(/^class\s*/, "").replace(/[^a-z]/g, "");
  return WORD_TO_CLASS[word] ?? null;
}

function cleanRoll(raw: string): string {
  const v = String(raw ?? "").trim();
  return /^\d+(\.0+)?$/.test(v) ? String(parseInt(v, 10)) : v;
}

const cleanText = (raw: string) => String(raw ?? "").replace(/\s+/g, " ").trim();

/** Small RFC-4180 style parser: quotes, escaped quotes, CRLF, BOM, , ; or tab. */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = (Object.keys(counts) as string[]).sort((a, b) => counts[b] - counts[a])[0];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

interface Cols { roll: number; name: number; father: number; cls: number }

function detectHeader(first: string[]): Cols | null {
  const h = first.map((c) => c.toLowerCase().replace(/[^a-z0-9# ]/g, " ").replace(/\s+/g, " ").trim());
  const cols: Cols = { roll: -1, name: -1, father: -1, cls: -1 };
  h.forEach((c, i) => {
    if (!c) return;
    if (/father|guardian|wali/.test(c)) { if (cols.father < 0) cols.father = i; return; }
    // "Class No" / "Roll No" = the student's number inside the class
    if (/roll|serial|\bsr\b|#|\bno\b|number/.test(c)) { if (cols.roll < 0) cols.roll = i; return; }
    if (/class|grade/.test(c)) { if (cols.cls < 0) cols.cls = i; return; }
    if (/name|student/.test(c)) { if (cols.name < 0) cols.name = i; }
  });
  const idx = [cols.roll, cols.name, cols.cls];
  return idx.every((i) => i >= 0) && new Set(idx).size === 3 ? cols : null;
}

export function parseRosterCsv(text: string): RosterParseResult {
  return parseRosterRows(parseCsvText(text));
}

/** Shared by CSV and Excel: rows of plain strings (a title row above the header is fine). */
export function parseRosterRows(rows: string[][]): RosterParseResult {
  const empty: RosterParseResult = {
    students: [], total: 0, skippedNoName: 0, skippedBadClass: 0, skippedDuplicate: 0, headerFound: false,
  };
  if (rows.length === 0) return { ...empty, error: "The file is empty." };

  let header: Cols | null = null;
  let headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const h = detectHeader(rows[i]);
    if (h) { header = h; headerAt = i; break; }
  }
  const cols: Cols = header ?? { roll: 0, name: 1, father: 2, cls: 3 };
  const dataRows = (header ? rows.slice(headerAt + 1) : rows).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  const out: RosterParseResult = { ...empty, headerFound: !!header, total: dataRows.length };
  const seen = new Set<string>();

  for (const r of dataRows) {
    const name = cleanText(r[cols.name] ?? "");
    if (!name) { out.skippedNoName++; continue; }
    const cls = normalizeClass(r[cols.cls] ?? "");
    if (!cls) { out.skippedBadClass++; continue; }
    const roll = cleanRoll(r[cols.roll] ?? "");
    const father = cols.father >= 0 ? cleanText(r[cols.father] ?? "") : "";
    const key = `${cls}|${roll}|${name.toLowerCase()}`;
    if (seen.has(key)) { out.skippedDuplicate++; continue; }
    seen.add(key);
    out.students.push({
      id: crypto.randomUUID(),
      full_name: name,
      roll_number: roll,
      class: cls,
      father_name: father || null,
    });
  }

  if (out.students.length === 0) {
    out.error = "No valid students found. Columns needed: Class No, Full Name, Father Name, Class.";
  }
  return out;
}

/**
 * Reads ANY roster file the phone hands us — .xlsx, old .xls or .csv — by its
 * real content (not its name or MIME type, which Android often gets wrong).
 */
export async function readRosterFile(file: File): Promise<RosterParseResult> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;                                  // .xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // .xls
  if (isZip || isOle) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { students: [], total: 0, skippedNoName: 0, skippedBadClass: 0, skippedDuplicate: 0, headerFound: false, error: "The file has no sheet." };
    const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][])
      .map((r) => r.map((c) => String(c ?? "").trim()));
    return parseRosterRows(rows);
  }
  return parseRosterCsv(new TextDecoder("utf-8").decode(buf));
}

/**
 * Professional sample sheet: title banner, dark-green header, centred cells,
 * black borders, light green banding, class dropdown, 40 ready rows.
 */
export async function downloadRosterTemplateXlsx(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GHS Babi Khel";
  const ws = wb.addWorksheet("Students", {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.columns = [{ width: 12 }, { width: 32 }, { width: 32 }, { width: 12 }];

  const BLACK = { argb: "FF000000" };
  const border = {
    top: { style: "thin" as const, color: BLACK }, left: { style: "thin" as const, color: BLACK },
    bottom: { style: "thin" as const, color: BLACK }, right: { style: "thin" as const, color: BLACK },
  };
  const center = { horizontal: "center" as const, vertical: "middle" as const, wrapText: true };
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  // 1 · title banner
  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = "GHS Babi Khel — Class Students List";
  title.font = { name: "Calibri", size: 15, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = fill("FF14532D");
  title.alignment = center;
  ws.getRow(1).height = 30;

  // 2 · instruction
  ws.mergeCells("A2:D2");
  const note = ws.getCell("A2");
  note.value = "Replace the sample rows with your students · Class must be 6, 7, 8, 9 or 10";
  note.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF78350F" } };
  note.fill = fill("FFFEF3C7");
  note.alignment = center;
  ws.getRow(2).height = 22;

  // 3 · header
  const headers = ["Class No", "Full Name", "Father Name", "Class"];
  const hr = ws.getRow(3);
  hr.height = 24;
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill("FF1F7A4A");
    c.alignment = center;
  });

  // 4+ · rows (3 samples, rest empty but formatted)
  const samples: (string | number)[][] = [
    [1, "Ahmad Khan", "Gul Khan", 6],
    [2, "Bilal Shah", "Noor Shah", 6],
    [1, "Zainab Bibi", "Rahim Khan", 7],
  ];
  const TOTAL = 40;
  for (let i = 0; i < TOTAL; i++) {
    const row = ws.getRow(4 + i);
    row.height = 20;
    const vals = samples[i] ?? [];
    for (let c = 0; c < 4; c++) {
      const cell = row.getCell(c + 1);
      if (vals[c] !== undefined) cell.value = vals[c];
      cell.font = { name: "Calibri", size: 11, bold: c === 1 && !!vals[c] };
      cell.alignment = center;
      if (i % 2 === 1) cell.fill = fill("FFF0FDF4");
    }
    row.getCell(4).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"6,7,8,9,10"'],
      showErrorMessage: true, errorStyle: "warning", errorTitle: "Class", error: "Use 6, 7, 8, 9 or 10",
    };
  }

  // black borders on every cell of the table
  for (let r = 1; r <= 3 + TOTAL; r++) {
    for (let c = 1; c <= 4; c++) ws.getRow(r).getCell(c).border = border;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "class-students-template.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

