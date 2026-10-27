import { useState, useRef, useMemo } from "react";
// PERF (chunk size — the two heaviest libraries in the app): xlsx (332 kB)
// and exceljs (937 kB) were BOTH statically imported here, so merely opening
// the Student Records tab downloaded ~1.3 MB of spreadsheet libraries before
// it could paint. They now load only when an import/export actually runs.
import type * as XLSXTypes from "xlsx";
import type ExcelJSTypes from "exceljs";
import {
  useStudentRecords, useCreateStudentRecord, useUpdateStudentRecord,
  useDeleteStudentRecord, useBulkImportStudentRecords, useDeleteAllStudentRecords,
  fetchAllStudentRecordsForExport,
  StudentRecord, StudentRecordPayload, RecordStatus,
} from "@/hooks/useStudentRecords";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Search, Plus, Pencil, Trash2, FileDown, FileUp, FileSpreadsheet,
  ChevronLeft, ChevronRight, AlertTriangle, X, Loader2, ShieldAlert, FolderOpen,
} from "lucide-react";
import toast from "react-hot-toast";

const CLASS_OPTIONS = ["5", "6", "7", "8", "9", "10"];

const emptyForm: Partial<StudentRecordPayload> = {
  admission_date: "", serial_no: undefined, student_name: "", date_of_birth: "",
  father_name: "", caste: "", profession: "", address: "", admitted_class: "",
  fee: undefined, left_class: "", left_date: "", remarks: "",
};

// ═══════════════════════ Excel column mapping ═══════════════════════════
// Matches the school's existing "Withdrawal Register" file exactly, so the
// old register can be dropped in as-is.
const IMPORT_HEADERS: Record<string, keyof StudentRecordPayload> = {
  "date of admission": "admission_date",
  "s.no": "serial_no",
  "sno": "serial_no",
  "name of student": "student_name",
  "date of birth": "date_of_birth",
  "father name": "father_name",
  "nation/cast": "caste",
  "profession": "profession",
  "place of living": "address",
  "in which class admitted": "admitted_class",
  "fee": "fee",
  "in which class left the school": "left_class",
  "from which date left the school": "left_date",
  "remarks": "remarks",
  // Short names written by older exports — accepted so those files re-import
  // with class / left-date intact (otherwise withdrawn students became "enrolled").
  "class admitted": "admitted_class",
  "class left": "left_class",
  "date left": "left_date",
};

// Collapse any run of whitespace (including double-spaces, tabs, trailing
// spaces) to a single space and lowercase, so header matching survives the
// inconsistent spacing found in real-world school registers — e.g. the
// source file has "from which  date left the school" (double space).
function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim().toLowerCase();
}

// The register writes classes as "5TH", "6TH", "8TH" etc. Storing that
// suffix verbatim breaks the admin edit dropdown, which only offers plain
// numbers ("5", "6", "7"...) — a stored "8TH" matches none of its options,
// so the field renders blank even though the data is actually there. Strip
// the ordinal suffix at import time so stored values always match the
// dropdown, while keeping the original text as a fallback if it doesn't
// look like a class number.
function normalizeClassValue(raw: string): string {
  const s = raw.trim();
  const match = s.match(/^(\d+)/); // "8TH" -> "8", "10TH" -> "10"
  return match ? match[1] : s;
}

// The register's dates are entered by hand and are inconsistent: some
// cells are real Excel date values, others are typed text with different
// separators ("13-04-11", "18/07/11", "09-8-09-02", "01--10-03",
// "01-092005"). Cross-checking many rows against their neighboring real
// date cells confirms the school consistently writes day-month-year
// (never month-day), with either 2- or 4-digit years. This parser commits
// to that single order rather than guessing per-cell, exactly as verified
// against the source file.
//
// Returns null (not undefined) specifically when the text LOOKS like a
// date but doesn't resolve to a real calendar day (e.g. "31-09-90" — day
// 31 in a 30-day month, a genuine typo in the original register). That
// case must never be silently dropped or silently "corrected" by
// guessing; the caller preserves the original raw text in Remarks instead
// so a human can decide, and nothing from the source file disappears.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb=29, leap-safe upper bound

function parseHandwrittenDateString(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // ISO text "1993-04-11" (what exports used to write): year-first. Without
  // this it was read day-first as day 1993 → "unparsed" → dumped in Remarks.
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }

  const digitGroups = s.match(/\d+/g);
  if (!digitGroups) return undefined;

  let day: number, month: number, year: number;

  if (digitGroups.length === 3) {
    [day, month, year] = digitGroups.map(Number);
  } else if (digitGroups.length === 2) {
    const [first, second] = digitGroups;
    if (second.length >= 5) {
      day = Number(first);
      month = Number(second.slice(0, second.length - 4));
      year = Number(second.slice(-4));
    } else {
      return null; // e.g. "0-09-2004" — not enough info to safely reconstruct
    }
  } else if (digitGroups.length === 4) {
    day = Number(digitGroups[0]);
    month = Number(digitGroups[1]);
    year = Number(digitGroups[digitGroups.length - 1]);
  } else {
    return null;
  }

  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null; // e.g. day 31 in September

  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Returns { iso, rawIfUnparsed }: iso is the parsed date (or undefined if
// there was nothing to parse), rawIfUnparsed is set only when the cell had
// real content that could not be safely converted — so the caller can
// keep the original text instead of losing it.
function excelDateToISO(val: unknown, XLSX: typeof XLSXTypes): { iso?: string; rawIfUnparsed?: string } {
  if (val == null || val === "") return {};
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return { rawIfUnparsed: String(val) };
    return { iso: `${d.y.toString().padStart(4, "0")}-${d.m.toString().padStart(2, "0")}-${d.d.toString().padStart(2, "0")}` };
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return { rawIfUnparsed: String(val) };
    return { iso: val.toISOString().slice(0, 10) };
  }
  if (typeof val === "string") {
    const result = parseHandwrittenDateString(val);
    if (result === null) return { rawIfUnparsed: val.trim() };
    if (result === undefined) return {};
    return { iso: result };
  }
  return { rawIfUnparsed: String(val) };
}

async function parseImportedWorkbook(file: ArrayBuffer): Promise<Partial<StudentRecordPayload>[]> {
  // PERF: xlsx loads HERE — the first time an import file is actually picked.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(file, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Find the header row — the row containing "Date of Admission"
  const headerRowIdx = raw.findIndex((row) =>
    row.some((cell) => typeof cell === "string" && normalizeHeader(cell).includes("date of admission"))
  );
  if (headerRowIdx === -1) {
    throw new Error(
      'Could not find the header row (looking for a column named "Date of Admission"). Please check the file matches the register format.'
    );
  }

  const headerRow = raw[headerRowIdx].map((c) => (typeof c === "string" ? normalizeHeader(c) : ""));
  const colMap: Record<number, keyof StudentRecordPayload> = {};
  headerRow.forEach((h, i) => {
    if (IMPORT_HEADERS[h]) colMap[i] = IMPORT_HEADERS[h];
  });

  const rows: Partial<StudentRecordPayload>[] = [];
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r];
    if (!row || row.every((c) => c == null || c === "")) continue; // skip blank spacer rows

    const record: Partial<StudentRecordPayload> = {};
    Object.entries(colMap).forEach(([idxStr, field]) => {
      const idx = Number(idxStr);
      const val = row[idx];
      if (val == null || val === "") return;

      if (field === "admission_date" || field === "date_of_birth" || field === "left_date") {
        const { iso, rawIfUnparsed } = excelDateToISO(val, XLSX);
        if (iso) {
          (record as any)[field] = iso;
        } else if (rawIfUnparsed) {
          // Never silently drop a date the register actually had — keep
          // the exact original text so nothing is lost, just unparsed.
          const label = field === "admission_date" ? "Admission date (unparsed)"
                      : field === "date_of_birth" ? "DOB (unparsed)"
                      : "Left date (unparsed)";
          record.remarks = record.remarks
            ? `${record.remarks}; ${label}: ${rawIfUnparsed}`
            : `${label}: ${rawIfUnparsed}`;
        }
      } else if (field === "serial_no") {
        // The register mostly uses plain integers, but a handful of rows
        // use suffixed values like "242B" / "248A" (siblings sharing one
        // register line-number, lettered to disambiguate). Number("242B")
        // is NaN, so a bare Number() cast silently drops these — instead,
        // keep the numeric part for the sortable serial_no column and
        // preserve the full original value (with its letter) in remarks
        // so nothing about the source record is lost.
        const strVal = String(val).trim();
        const numMatch = strVal.match(/^\d+/);
        if (numMatch) {
          record.serial_no = Number(numMatch[0]);
          if (strVal !== numMatch[0]) {
            record.remarks = record.remarks
              ? `${record.remarks}; Register S.No: ${strVal}`
              : `Register S.No: ${strVal}`;
          }
        }
      } else if (field === "fee") {
        record.fee = Number(val) || undefined;
      } else if (field === "admitted_class" || field === "left_class") {
        (record as any)[field] = normalizeClassValue(String(val));
      } else {
        (record as any)[field] = String(val).trim();
      }
    });

    // Excel headers can end up empty (bad spacing, merged cells, stray
    // values) even when the underlying register clearly shows a withdrawal
    // — e.g. left_class filled in but left_date blank. Import shouldn't
    // silently drop that signal, so status derivation downstream treats
    // either field being present as "withdrawn" (see deriveStatus below).
    if (record.student_name) rows.push(record);
  }
  return rows;
}

// ═══════════════ Excel files: shared layout for Export + Sample ═══════════════
// ONE column definition drives both files, and its headers are exactly the
// ones the importer (IMPORT_HEADERS) reads — so the Sample, an Export and the
// original register all import identically.
type ColKind = "date" | "int" | "num" | "text";
interface SheetCol { header: string; key: string; width: number; kind: ColKind; group?: "core" | "left" }
const SHEET_COLUMNS: SheetCol[] = [
  { header: "Date of Admission", key: "admission_date", width: 17, kind: "date" },
  { header: "S.No", key: "serial_no", width: 8, kind: "int" },
  { header: "Name of Student", key: "student_name", width: 26, kind: "text", group: "core" },
  { header: "Date of Birth", key: "date_of_birth", width: 15, kind: "date" },
  { header: "Father Name", key: "father_name", width: 24, kind: "text" },
  { header: "Nation/Cast", key: "caste", width: 16, kind: "text" },
  { header: "Profession", key: "profession", width: 16, kind: "text" },
  { header: "Place of Living", key: "address", width: 20, kind: "text" },
  { header: "In which class admitted", key: "admitted_class", width: 15, kind: "text" },
  { header: "Fee", key: "fee", width: 9, kind: "num" },
  { header: "In which class left the school", key: "left_class", width: 17, kind: "text", group: "left" },
  { header: "From which date left the school", key: "left_date", width: 18, kind: "date", group: "left" },
  { header: "Remarks", key: "remarks", width: 26, kind: "text" },
];
const DATE_FMT = "yyyy-mm-dd";
const HEADER_GREEN = "FF1F6F4A";   // school green
const HEADER_DARK = "FF14532D";    // Name column (required)
const HEADER_ORANGE = "FFC2410C";  // "left the school" columns (fill only if withdrawn)
const BORDER_COLOR = { argb: "FFB0B0B0" };

// DB date "1993-04-11" → a REAL Excel date (UTC midnight, no time-zone shift).
const isoToDate = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

function styleSheet(ws: ExcelJSTypes.Worksheet, lastRow: number, opts: { status?: boolean } = {}) {
  const border: Partial<ExcelJSTypes.Borders> = {
    top: { style: "thin", color: BORDER_COLOR }, left: { style: "thin", color: BORDER_COLOR },
    bottom: { style: "thin", color: BORDER_COLOR }, right: { style: "thin", color: BORDER_COLOR },
  };
  const colCount = SHEET_COLUMNS.length + (opts.status ? 1 : 0);

  // Header: bold white on colour, centered, wrapped (no filter drop-down arrows)
  const head = ws.getRow(1);
  head.height = 38;
  for (let c = 1; c <= colCount; c++) {
    const cell = head.getCell(c);
    const def = SHEET_COLUMNS[c - 1];
    const argb = !def ? HEADER_GREEN : def.group === "core" ? HEADER_DARK : def.group === "left" ? HEADER_ORANGE : HEADER_GREEN;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  }

  // Body: EVERY cell bordered + centered (names, remarks, all), zebra stripes
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    row.height = 21;
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      const def = SHEET_COLUMNS[c - 1];
      cell.border = border;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.font = { size: 11 };
      if (def?.kind === "date") cell.numFmt = DATE_FMT;
      else if (def?.kind === "int") cell.numFmt = "0";
      else if (def?.kind === "num") cell.numFmt = "#,##0";
      else if (def) cell.numFmt = "@";                       // text stays text ("5", "8TH")
      if (r % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F5" } };
    }
  }
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];   // header + first 3 columns stay visible
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

async function saveWorkbook(wb: ExcelJSTypes.Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function newWorkbook() {
  // PERF: exceljs (937 kB) loads only when Export / Sample is clicked.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook() as ExcelJSTypes.Workbook;
  wb.creator = "GHS Babi Khel";
  return wb;
}

// Export: every record, oldest admission first (blank-date rows placed by S.No).
async function exportToExcel(rows: StudentRecord[]) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Student Records");
  ws.columns = [
    ...SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width })),
    { header: "Status", key: "status", width: 13 },
  ];
  rows.forEach((r) => {
    ws.addRow({
      admission_date: isoToDate(r.admission_date) ?? "",
      serial_no: r.serial_no ?? "",
      student_name: r.student_name,
      date_of_birth: isoToDate(r.date_of_birth) ?? "",
      father_name: r.father_name || "",
      caste: r.caste || "",
      profession: r.profession || "",
      address: r.address || "",
      admitted_class: r.admitted_class || "",
      fee: r.fee ?? "",
      left_class: r.left_class || "",
      left_date: isoToDate(r.left_date) ?? "",
      remarks: r.remarks || "",
      status: r.status === "enrolled" ? "Enrolled" : "Withdrawn",
    });
  });
  styleSheet(ws, rows.length + 1, { status: true });

  // Status chip colours (ignored by import — status is derived from the "left" columns)
  const statusCol = SHEET_COLUMNS.length + 1;
  for (let r = 2; r <= rows.length + 1; r++) {
    const cell = ws.getRow(r).getCell(statusCol);
    const withdrawn = cell.value === "Withdrawn";
    cell.font = { bold: true, color: { argb: withdrawn ? "FF9A3412" : "FF166534" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: withdrawn ? "FFFED7AA" : "FFDCFCE7" } };
  }
  await saveWorkbook(wb, `Student-Records-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Sample: an EMPTY, ready-to-fill register in exactly the layout the importer
// reads, plus a "How to fill" sheet. (The importer only reads the FIRST sheet,
// so the guide and its examples can never be imported by accident.)
async function downloadSampleTemplate() {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Student Records");
  ws.columns = SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const BLANK_ROWS = 300;                       // pre-formatted, empty rows ready to type in
  styleSheet(ws, BLANK_ROWS + 1);

  const guide = wb.addWorksheet("How to fill");
  guide.columns = [{ width: 30 }, { width: 62 }];
  const lines: [string, string][] = [
    ["HOW TO FILL", "Fill the first sheet \"Student Records\", save, then use Import in the admin panel."],
    ["Name of Student", "REQUIRED. A row without a name is skipped."],
    ["Date of Admission / Birth / Left", "Type a real date (e.g. 11-04-1993) or text as DAY-MONTH-YEAR (13-04-11, 18/07/11). 2009-06-01 also works."],
    ["S.No", "Register serial number (1, 2, 3 …). A value like 242B keeps the number 242 and the full text in Remarks."],
    ["In which class admitted", "5, 6, 7, 8, 9 or 10 (5TH / 8TH also accepted)."],
    ["Fee", "Number only."],
    ["Left the school columns (orange)", "Fill ONLY for withdrawn students. Class OR date filled → Withdrawn. Both empty → Enrolled."],
    ["Empty cells", "Any column may stay empty. Empty rows are ignored."],
    ["Do not change", "Keep the header names in row 1 exactly as they are."],
  ];
  lines.forEach(([a, b]) => guide.addRow([a, b]));
  guide.addRow([]);
  const exHead = guide.addRow(SHEET_COLUMNS.slice(0, 2).map((c) => c.header).concat("Example row (do not copy this sheet)"));
  exHead.font = { bold: true };
  guide.addRow(["11-04-1993", 1, "AMROOD KHAN  ·  Father: ALI RAZA  ·  Class 5  ·  Left 1996-09-08 → Withdrawn"]);
  const thin: Partial<ExcelJSTypes.Borders> = {
    top: { style: "thin", color: BORDER_COLOR }, left: { style: "thin", color: BORDER_COLOR },
    bottom: { style: "thin", color: BORDER_COLOR }, right: { style: "thin", color: BORDER_COLOR },
  };
  for (let r = 1; r <= lines.length; r++) {
    const row = guide.getRow(r);
    row.height = 32;
    for (let c = 1; c <= 2; c++) {
      const cell = row.getCell(c);
      cell.border = thin;
      cell.alignment = { horizontal: c === 1 ? "center" : "left", vertical: "middle", wrapText: true };
      if (r === 1) { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_GREEN } }; }
      else if (c === 1) { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F5" } }; }
    }
  }
  await saveWorkbook(wb, "Student-Records-Sample.xlsx");
}

export default function AdminStudentRecords() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecordStatus | "all">("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useStudentRecords({
    search, status: statusFilter, admittedClass: classFilter, page,
  });
  const rows = data?.rows || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / 25));

  const createMutation = useCreateStudentRecord();
  const updateMutation = useUpdateStudentRecord();
  const deleteMutation = useDeleteStudentRecord();
  const importMutation = useBulkImportStudentRecords();
  const deleteAllMutation = useDeleteAllStudentRecords();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<StudentRecordPayload>>(emptyForm);

  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [exporting, setExporting] = useState(false);

  const [importPreview, setImportPreview] = useState<Partial<StudentRecordPayload>[] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAdd = () => { setEditingId(null); setForm(emptyForm); setFormOpen(true); };
  const openEdit = (r: StudentRecord) => {
    setEditingId(r.id);
    setForm({
      admission_date: r.admission_date || "", serial_no: r.serial_no ?? undefined,
      student_name: r.student_name, date_of_birth: r.date_of_birth || "",
      father_name: r.father_name || "", caste: r.caste || "", profession: r.profession || "",
      // Records imported before the class-normalization fix may still have
      // "8TH"/"5TH" stored with the ordinal suffix. Normalize on read too,
      // so old rows display correctly in the dropdown without needing a
      // separate one-off data migration.
      address: r.address || "", admitted_class: normalizeClassValue(r.admitted_class || ""),
      fee: r.fee ?? undefined, left_class: normalizeClassValue(r.left_class || ""),
      left_date: r.left_date || "", remarks: r.remarks || "",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.student_name?.trim()) {
      toast.error("Student name is required");
      return;
    }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...form });
        toast.success("Record updated");
      } else {
        await createMutation.mutateAsync(form);
        toast.success("Record added");
      }
      setFormOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(`Deleted record for ${deleteTarget.student_name}`);
      setDeleteTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllConfirmText !== "DELETE ALL") return;
    try {
      const count = await deleteAllMutation.mutateAsync();
      toast.success(`Deleted all ${count} record${count === 1 ? "" : "s"}`);
      setDeleteAllOpen(false);
      setDeleteAllConfirmText("");
      setPage(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete all failed");
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = await parseImportedWorkbook(buf);
      if (parsed.length === 0) {
        toast.error("No valid student rows found in this file");
        return;
      }
      setImportPreview(parsed);
      setImportFileName(file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this file");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    try {
      const count = await importMutation.mutateAsync(importPreview);
      toast.success(`Imported ${count} student record${count === 1 ? "" : "s"}`);
      setImportPreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    }
  };

  const handleSample = async () => {
    try {
      await downloadSampleTemplate();
      toast.success("Sample downloaded — fill it, then tap Import");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the sample");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await fetchAllStudentRecordsForExport();
      if (all.length === 0) {
        toast.error("No records to export yet");
        return;
      }
      await exportToExcel(all);
      toast.success(`Exported ${all.length} records`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const StatusPill = ({ status }: { status: string }) => (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
      status === "enrolled"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
        : "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "enrolled" ? "bg-emerald-500" : "bg-orange-500"}`} />
      {status === "enrolled" ? "Enrolled" : "Withdrawn"}
    </span>
  );

  const renderRowActions = (r: StudentRecord) => (
    <div className="flex items-center gap-0.5 shrink-0">
      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground shadow-none hover:text-primary" onClick={() => openEdit(r)} aria-label="Edit">
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground shadow-none hover:text-destructive" onClick={() => setDeleteTarget(r)} aria-label="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* ── Premium header + action toolbar ────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <FolderOpen className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Student Records</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              Admissions &amp; withdrawal register · <span className="font-semibold text-foreground">{totalCount}</span> record{totalCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {/* Action buttons — thin pills. Phone: Add / Delete All share row 1,
            Sample / Import / Export share row 2 (3 equal columns). */}
        <div className="relative mt-3 grid grid-cols-6 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap sm:items-center">
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelected} />
          <Button onClick={openAdd} className="col-span-3 h-8 min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
            <Plus className="w-3.5 h-3.5 shrink-0" /> Add Record
          </Button>
          <Button
            variant="outline"
            className="col-span-3 h-8 min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full border-destructive/40 px-3 text-xs font-semibold text-destructive shadow-none hover:bg-destructive/10 sm:order-last sm:ml-auto"
            onClick={() => setDeleteAllOpen(true)}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> Delete All
          </Button>
          <Button variant="outline" onClick={handleSample} className="col-span-2 h-8 min-w-0 justify-center gap-1 whitespace-nowrap rounded-full border-border/60 px-2 text-xs font-semibold shadow-none">
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-emerald-600" /> Sample
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="col-span-2 h-8 min-w-0 justify-center gap-1 whitespace-nowrap rounded-full border-border/60 px-2 text-xs font-semibold shadow-none">
            <FileUp className="w-3.5 h-3.5 shrink-0" /> Import
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={exporting} className="col-span-2 h-8 min-w-0 justify-center gap-1 whitespace-nowrap rounded-full border-border/60 px-2 text-xs font-semibold shadow-none">
            {exporting ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <FileDown className="w-3.5 h-3.5 shrink-0" />}
            Export
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-border/60 bg-card p-3 shadow-sm md:grid-cols-[1fr_11rem_11rem]">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 w-4 h-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search student or father's name"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(0); }}>
          <SelectTrigger className="h-10 rounded-full border-border/60 text-sm shadow-none"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="enrolled">Enrolled</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
          </SelectContent>
        </Select>
        <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setPage(0); }}>
          <SelectTrigger className="h-10 rounded-full border-border/60 text-sm shadow-none"><SelectValue placeholder="Class" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {CLASS_OPTIONS.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card text-center py-14 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-foreground">No student records yet</p>
          <p className="text-xs mt-1">Add one manually, or import your existing Excel register.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary ring-1 ring-border flex items-center justify-center text-sm font-semibold shrink-0">
                    {(r.student_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground leading-snug break-words">{r.student_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">S/o {r.father_name || "—"}</p>
                  </div>
                  {renderRowActions(r)}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-secondary/40 border border-border/60 p-2.5 text-center">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Admitted</p>
                    <p className="text-xs font-medium text-foreground mt-0.5 break-words">{r.admission_date || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Class</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{r.admitted_class || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Left</p>
                    <p className="text-xs font-medium text-foreground mt-0.5 break-words">{r.left_date || "—"}</p>
                  </div>
                </div>
                <div className="mt-2.5"><StatusPill status={r.status} /></div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-bold">Student</th>
                    <th className="px-3 py-2.5 text-left font-bold">Father</th>
                    <th className="px-3 py-2.5 text-left font-bold">Admitted</th>
                    <th className="px-3 py-2.5 text-left font-bold">Class</th>
                    <th className="px-3 py-2.5 text-left font-bold">Left</th>
                    <th className="px-3 py-2.5 text-left font-bold">Status</th>
                    <th className="w-20 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/50 hover:bg-primary/5 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary ring-1 ring-border flex items-center justify-center text-xs font-semibold shrink-0">
                            {(r.student_name || "?").charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-foreground">{r.student_name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.father_name || "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.admission_date || "—"}</td>
                      <td className="px-3 py-2.5">{r.admitted_class ? <span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">Class {r.admitted_class}</span> : "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{r.left_date || "—"}</td>
                      <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
                      <td className="px-3 py-2.5"><div className="flex justify-end">{renderRowActions(r)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{totalCount} record{totalCount === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full border-border/60 shadow-none" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>Page {page + 1} of {totalPages}</span>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full border-border/60 shadow-none" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════ Add / Edit dialog ═══════════ */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl p-5 gap-3">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Student Record" : "Add Student Record"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Student Name *</Label>
              <Input className="h-9 text-sm mt-1" value={form.student_name || ""} onChange={(e) => setForm({ ...form, student_name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Father's Name</Label>
              <Input className="h-9 text-sm mt-1" value={form.father_name || ""} onChange={(e) => setForm({ ...form, father_name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Date of Admission</Label>
              <Input className="h-9 text-sm mt-1" type="date" value={form.admission_date || ""} onChange={(e) => setForm({ ...form, admission_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Date of Birth</Label>
              <Input className="h-9 text-sm mt-1" type="date" value={form.date_of_birth || ""} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Serial No.</Label>
              <Input className="h-9 text-sm mt-1" type="number" value={form.serial_no ?? ""} onChange={(e) => setForm({ ...form, serial_no: Number(e.target.value) || undefined })} />
            </div>
            <div>
              <Label className="text-xs">Nation / Caste</Label>
              <Input className="h-9 text-sm mt-1" value={form.caste || ""} onChange={(e) => setForm({ ...form, caste: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Father's Profession</Label>
              <Input className="h-9 text-sm mt-1" value={form.profession || ""} onChange={(e) => setForm({ ...form, profession: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input className="h-9 text-sm mt-1" value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Admitted in Class</Label>
              <Select value={form.admitted_class || ""} onValueChange={(v) => setForm({ ...form, admitted_class: v })}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fee</Label>
              <Input className="h-9 text-sm mt-1" type="number" value={form.fee ?? ""} onChange={(e) => setForm({ ...form, fee: Number(e.target.value) || undefined })} />
            </div>
            <div>
              <Label className="text-xs">Left in Class (if withdrawn)</Label>
              <Select value={form.left_class || ""} onValueChange={(v) => setForm({ ...form, left_class: v })}>
                <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date Left</Label>
              <Input className="h-9 text-sm mt-1" type="date" value={form.left_date || ""} onChange={(e) => setForm({ ...form, left_date: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Remarks</Label>
              <Textarea className="text-sm mt-1" rows={2} value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="h-9 flex-1 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-4 text-xs font-semibold shadow-none sm:flex-none" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 flex-1 gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:flex-none">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editingId ? "Save Changes" : "Add Record"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════ Delete confirmation — warning as requested ═══════════ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" /> Delete this record?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the record for{" "}
              <strong>{deleteTarget?.student_name}</strong>. This cannot be undone.
              Consider using Export first if you want a backup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 sm:flex-none" onClick={handleDelete}>
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════════ Delete ALL confirmation — type-to-confirm, since this
           is irreversible and can wipe the entire register in one action ═══════════ */}
      <AlertDialog open={deleteAllOpen} onOpenChange={(open) => { if (!open) { setDeleteAllOpen(false); setDeleteAllConfirmText(""); } }}>
        <AlertDialogContent className="rounded-2xl sm:rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="w-5 h-5" /> Delete ALL student records?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>every</strong> student record in this table —
              all {totalCount} record{totalCount === 1 ? "" : "s"}, including the entire
              imported register. This cannot be undone and there is no recovery.
              <br /><br />
              <strong>Export a backup first</strong> if you haven't already.
              <br /><br />
              To confirm, type <strong>DELETE ALL</strong> below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            className="h-9 text-sm"
            autoFocus
            value={deleteAllConfirmText}
            onChange={(e) => setDeleteAllConfirmText(e.target.value)}
            placeholder="Type DELETE ALL to confirm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none" onClick={() => setDeleteAllConfirmText("")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-semibold shadow-none hover:bg-red-700 disabled:opacity-50 sm:flex-none"
              disabled={deleteAllConfirmText !== "DELETE ALL" || deleteAllMutation.isPending}
              onClick={handleDeleteAll}
            >
              {deleteAllMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Delete Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════════ Import preview / confirm ═══════════ */}
      <Dialog open={!!importPreview} onOpenChange={(open) => !open && setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-5 gap-3">
          <DialogHeader>
            <DialogTitle>Confirm Import — {importFileName}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Found <strong>{importPreview?.length || 0}</strong> student rows. Review a sample below, then confirm to add them all.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60">
                  <th className="p-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="p-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Father</th>
                  <th className="p-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Admitted</th>
                  <th className="p-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Class</th>
                  <th className="p-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Left</th>
                </tr>
              </thead>
              <tbody>
                {(importPreview || []).slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 transition-colors last:border-0 hover:bg-primary/5">
                    <td className="p-2">{r.student_name}</td>
                    <td className="p-2">{r.father_name || "—"}</td>
                    <td className="p-2">{r.admission_date || "—"}</td>
                    <td className="p-2">{r.admitted_class || "—"}</td>
                    <td className="p-2">{r.left_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(importPreview?.length || 0) > 8 && (
            <p className="text-xs text-muted-foreground">
              + {(importPreview!.length - 8)} more rows not shown here
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="h-9 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-4 text-xs font-semibold shadow-none flex-1 sm:flex-none" onClick={() => setImportPreview(null)}>
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
            <Button onClick={confirmImport} disabled={importMutation.isPending} className="h-9 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 flex-1 sm:flex-none">
              {importMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Import {importPreview?.length || 0} Records
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
