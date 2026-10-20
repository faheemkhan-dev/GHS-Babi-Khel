/**
 * rosterCsv.ts — reads a class-roster CSV for Exam Roll Numbers.
 *
 * Expected columns (any order if a header row is present; otherwise this order):
 *   Class No  |  Full Name  |  Father Name  |  Class
 *   1         |  Ahmad Khan |  Gul Khan     |  6
 *
 * Headers are matched loosely ("Class No", "Roll No", "Student Name", "Father",
 * "Class Title", "Class"...). "Class" may be written 6, 6th, Class 6, Six, VI.
 * Nothing here touches the database — students from the file get a fresh id
 * only so the rest of the roll-number code can treat them like any student.
 */
import type { Student } from "./examRollHelpers";

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
  return cols.name >= 0 && cols.cls >= 0 && cols.roll >= 0 ? cols : null;
}

export function parseRosterCsv(text: string): RosterParseResult {
  const empty: RosterParseResult = {
    students: [], total: 0, skippedNoName: 0, skippedBadClass: 0, skippedDuplicate: 0, headerFound: false,
  };
  const rows = parseCsvText(text);
  if (rows.length === 0) return { ...empty, error: "The file is empty." };

  const header = detectHeader(rows[0]);
  const cols: Cols = header ?? { roll: 0, name: 1, father: 2, cls: 3 };
  const dataRows = header ? rows.slice(1) : rows;

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

export const ROSTER_TEMPLATE_CSV =
  "Class No,Full Name,Father Name,Class\n1,Ahmad Khan,Gul Khan,6\n2,Bilal Shah,Noor Shah,6\n1,Zainab Bibi,Rahim Khan,7\n";
