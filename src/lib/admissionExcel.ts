// src/lib/admissionExcel.ts — styled Excel export + walk-in import sheet
// (ported from the GHSS Ghallanai admission feature, adapted to the High
// School columns). Everything runs on exceljs — already a dependency.
// ═══════════════════════════════════════════════════════════════════════════

import type { Admission } from "@/hooks/useAdmission";
import { paymentMethodLabel } from "@/lib/admissionPayment";

const GREEN = "FF14532D";
const GREEN_TINT = "FFE7F0EA";
const GOLD = "FFA88228";
const GOLD_TINT = "FFFBF5E2";
const GRID = "FFDCDCD8";

const thin = { style: "thin" as const, color: { argb: GRID } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export const WALKIN_TEMPLATE_COLUMNS = [
  { header: "Full Name *", key: "full_name", width: 26 },
  { header: "Father Name *", key: "father_name", width: 24 },
  { header: "B-Form No. * (13 digits)", key: "b_form_no", width: 22 },
  { header: "Mobile * (03XXXXXXXXX)", key: "contact_number", width: 18 },
  { header: "Class * (6-10)", key: "applying_class", width: 12 },
  { header: "Admission Type (fresh/migration)", key: "admission_type", width: 20 },
  { header: "Previous School", key: "previous_school", width: 26 },
  { header: "Previous Class", key: "previous_class", width: 14 },
  { header: "Previous Marks (e.g. 450/600 or 82%)", key: "previous_marks", width: 24 },
  { header: "Year of Passing", key: "year_of_passing", width: 14 },
  { header: "Fee Paid (yes/no)", key: "paid", width: 14 },
  { header: "Payment Method", key: "payment_method", width: 18 },
  { header: "Receipt No", key: "payment_receipt", width: 14 },
  { header: "Home Address", key: "home_address", width: 30 },
] as const;

// ── Applications export (styled workbook) ──────────────────────────────────

export async function exportApplicationsExcel(rows: Admission[], sessionYear?: string | null): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GHS Babi Khel — Admissions";
  const ws = wb.addWorksheet("Applications", { views: [{ state: "frozen", ySplit: 4 }] });

  const cols = [
    { header: "Reference No", key: "reference_no", width: 18 },
    { header: "Applied On", key: "applied_on", width: 12 },
    { header: "Name", key: "full_name", width: 24 },
    { header: "Father Name", key: "father_name", width: 24 },
    { header: "B-Form No", key: "b_form_no", width: 17 },
    { header: "Mobile", key: "contact_number", width: 14 },
    { header: "WhatsApp", key: "whatsapp_number", width: 14 },
    { header: "Gender", key: "gender", width: 9 },
    { header: "Date of Birth", key: "date_of_birth", width: 12 },
    { header: "Class", key: "applying_class", width: 8 },
    { header: "Admission Type", key: "admission_type", width: 14 },
    { header: "Admission No", key: "admission_roll_no", width: 14 },
    { header: "Admission Date", key: "admission_date", width: 13 },
    { header: "Previous School", key: "previous_school", width: 26 },
    { header: "Previous Class", key: "previous_class", width: 13 },
    { header: "Previous Marks", key: "previous_marks", width: 14 },
    { header: "Year of Passing", key: "year_of_passing", width: 13 },
    { header: "Previous Board", key: "previous_board", width: 16 },
    { header: "BISEP Enrollment No", key: "bisep_enrollment_no", width: 18 },
    { header: "Board Enroll Status", key: "board_fee_status", width: 15 },
    { header: "9th Roll No", key: "board_roll_no", width: 12 },
    { header: "9th Result", key: "previous_result", width: 12 },
    { header: "SLC No", key: "slc_no", width: 14 },
    { header: "SLC Date", key: "slc_date", width: 12 },
    { header: "Migration Cert No", key: "migration_cert_no", width: 16 },
    { header: "Father CNIC", key: "father_cnic", width: 17 },
    { header: "Occupation", key: "occupation", width: 16 },
    { header: "Home Address", key: "home_address", width: 28 },
    { header: "Processing Fee", key: "processing_fee", width: 12 },
    { header: "Fee Status", key: "payment_status", width: 11 },
    { header: "Payment Reference", key: "payment_reference", width: 18 },
    { header: "Paid By", key: "payment_method", width: 14 },
    { header: "Receipt No", key: "payment_receipt", width: 14 },
    { header: "Paid On", key: "paid_at", width: 12 },
    { header: "Status", key: "status", width: 16 },
    { header: "Admin Note", key: "admin_note", width: 28 },
  ];
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));

  // Title band
  ws.mergeCells(1, 1, 1, cols.length);
  const title = ws.getCell(1, 1);
  title.value = `GOVERNMENT HIGH SCHOOL BABI KHEL — Admission Applications${sessionYear ? ` (Session ${sessionYear})` : ""}`;
  title.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  title.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, cols.length);
  const sub = ws.getCell(2, 1);
  sub.value = `${rows.length} application(s) · exported ${new Date().toLocaleString("en-PK")} · District Mohmand, Khyber Pakhtunkhwa`;
  sub.font = { bold: true, size: 10, color: { argb: GREEN } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD_TINT } };
  sub.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(3).height = 6;

  // Header row
  const headerRow = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9.5, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.border = border;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  headerRow.height = 22;

  const statusFill = (s: string) =>
    s === "paid"
      ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE3F5E9" } }
      : s === "rejected"
        ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFBE3E3" } }
        : { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: GOLD_TINT } };

  const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("en-PK") : "");

  rows.forEach((r, ri) => {
    const values: Record<string, string | number> = {
      reference_no: r.reference_no,
      applied_on: fmtDate(r.created_at),
      full_name: r.full_name,
      father_name: r.father_name,
      b_form_no: r.b_form_no,
      contact_number: r.contact_number,
      whatsapp_number: r.whatsapp_number || "",
      gender: r.gender || "",
      date_of_birth: fmtDate(r.date_of_birth),
      applying_class: r.applying_class,
      admission_type: r.admission_type,
      admission_roll_no: (r as any).admission_roll_no || "",
      admission_date: fmtDate((r as any).admission_date),
      previous_school: r.previous_school || "",
      previous_class: r.previous_class || "",
      previous_marks: r.previous_marks || "",
      year_of_passing: r.year_of_passing || "",
      previous_board: (r as any).previous_board || "",
      bisep_enrollment_no: (r as any).bisep_enrollment_no || "",
      board_fee_status: (r as any).board_fee_status === "paid"
        ? "Enrolled / fee paid"
        : (r as any).board_fee_status === "pending" ? "Fee pending" : "",
      board_roll_no: (r as any).board_roll_no || "",
      previous_result: (r as any).previous_result || "",
      slc_no: (r as any).slc_no || "",
      slc_date: fmtDate((r as any).slc_date),
      migration_cert_no: (r as any).migration_cert_no || "",
      father_cnic: (r as any).father_cnic || "",
      occupation: (r as any).occupation || "",
      home_address: r.home_address || "",
      processing_fee: r.processing_fee ?? 0,
      payment_status: r.payment_status || "pending",
      payment_reference: r.payment_reference || "",
      payment_method: paymentMethodLabel(r.payment_method),
      payment_receipt: r.payment_receipt || "",
      paid_at: fmtDate(r.paid_at),
      status: r.status,
      admin_note: r.admin_note || "",
    };
    const row = ws.getRow(5 + ri);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = values[c.key] ?? "";
      cell.border = border;
      cell.font = { size: 9 };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F6" } };
      if (c.key === "reference_no" || c.key === "payment_reference") {
        cell.font = { size: 9, bold: true };
      }
      if (c.key === "payment_status" || c.key === "status") {
        cell.fill = statusFill(String(cell.value));
        cell.font = { size: 9, bold: true };
      }
    });
  });

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };

  // Summary sheet
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 30 }, { width: 14 }];
  sum.mergeCells(1, 1, 1, 2);
  const st = sum.getCell(1, 1);
  st.value = "ADMISSION SUMMARY";
  st.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  st.alignment = { horizontal: "center" };
  const total = rows.length;
  const paid = rows.filter((r) => r.payment_status === "paid").length;
  const pending = rows.filter((r) => r.payment_status === "pending").length;
  const rejectedFee = rows.filter((r) => r.payment_status === "rejected").length;
  const feeSum = rows.filter((r) => r.payment_status === "paid").reduce((a, r) => a + (r.processing_fee || 0), 0);
  const admitted = rows.filter((r) => ["admitted", "admit_card_issued"].includes(r.status)).length;
  const lines: Array<[string, number | string]> = [
    ["Total Applications", total],
    ["Processing Fee Paid", paid],
    ["Fee Pending", pending],
    ["Fee Rejected", rejectedFee],
    ["Fee Collected (Rs)", feeSum],
    ["Admitted", admitted],
    ["", ""],
    ["By Class", ""],
    ...["6", "7", "8", "9", "10"].map(
      (c) => [`Class ${c}`, rows.filter((r) => r.applying_class === c).length] as [string, number],
    ),
    ["By Type", ""],
    ["Fresh", rows.filter((r) => r.admission_type === "fresh").length],
    ["Migration", rows.filter((r) => r.admission_type === "migration").length],
  ];
  lines.forEach(([k, v], i) => {
    const row = sum.getRow(3 + i);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    if (k) {
      row.getCell(1).font = { bold: true, size: 10 };
      row.getCell(2).font = { size: 10 };
      row.getCell(1).border = border;
      row.getCell(2).border = border;
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `Admissions-${sessionYear || new Date().getFullYear()}-${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

// ── Walk-in template (download) ────────────────────────────────────────────

export async function downloadWalkinTemplate(): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Walk-in Admissions", { views: [{ state: "frozen", ySplit: 4 }] });

  ws.mergeCells(1, 1, 1, WALKIN_TEMPLATE_COLUMNS.length);
  const t = ws.getCell(1, 1);
  t.value = "GOVERNMENT HIGH SCHOOL BABI KHEL — Walk-in Admission Applications, Import Sheet";
  t.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(2, 1, 2, WALKIN_TEMPLATE_COLUMNS.length);
  const ins = ws.getCell(2, 1);
  ins.value =
    "Fill one student per row from row 5. Required columns are marked *. B-Form must be 13 digits (dashes OK). " +
    "Marks accept 450/600 or 82% — merit ranks on percentage. Fee Paid: yes/no (only fee-paid students enter the merit list).";
  ins.font = { size: 9, color: { argb: GREEN }, italic: true };
  ins.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD_TINT } };
  ins.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getRow(2).height = 30;
  ws.getRow(3).height = 6;

  const header = ws.getRow(4);
  WALKIN_TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GOLD } };
    cell.border = border;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  header.height = 30;
  ws.columns = WALKIN_TEMPLATE_COLUMNS.map((c) => ({ width: c.width }));

  // Zebra + borders + text formats up to row 500; dropdown validations.
  for (let r = 5; r <= 500; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= WALKIN_TEMPLATE_COLUMNS.length; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      if (r % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F8F6" } };
    }
    row.getCell(3).numFmt = "@"; // B-Form as text
    row.getCell(4).numFmt = "@"; // Mobile as text
  }
  ws.getColumn(3).width = 22;

  const lastRow = 500;
  // Dropdown validations — per-cell (works on every exceljs build).
  const dropdown = (colIdx: number, list: string[]) => {
    for (let r = 5; r <= lastRow; r++) {
      ws.getRow(r).getCell(colIdx).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${list.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Not in the list",
        error: "Pick a value from the dropdown (or fix your text before importing).",
      };
    }
  };
  dropdown(5, ["6", "7", "8", "9", "10"]);            // E — Class
  dropdown(6, ["fresh", "migration"]);                  // F — Type
  dropdown(11, ["yes", "no"]);                          // K — Fee Paid
  dropdown(12, ["cash", "bank", "easypaisa", "jazzcash", "safepay", "other"]); // L — Method

  // Help sheet
  const help = wb.addWorksheet("Help");
  help.columns = [{ width: 26 }, { width: 90 }];
  help.getCell(1, 1).value = "RULES";
  help.getCell(1, 1).font = { bold: true, size: 12 };
  const rules = [
    ["Required columns", "Full Name, Father Name, B-Form No (13 digits), Mobile (03…), Class (6-10)."],
    ["Admission Type", "fresh = new admission · migration = transfer (Class 9/10 only, BISE Peshawar)."],
    ["Marks", "450/600 → ranked on 75% · 82% or 82 → ranked on 82 · A+ → ranked after numeric marks."],
    ["Fee Paid", "yes = processing fee already received (pick the method + receipt). Only fee-paid students enter the merit list."],
    ["Duplicates", "Each import row creates a new application with its own Reference No. Check for the student before importing."],
    ["Max rows", "500 per file. Extra rows are ignored."],
    ["Example row", "Ahmad Khan | Ghani Khan | 31203-1234567-1 | 0300-1234567 | 9 | fresh | GPS Babi Khel | 8 | 450/600 | 2026 | yes | cash | RC-001 | Babi Khel"],
  ];
  rules.forEach(([k, v], i) => {
    const row = help.getRow(3 + i);
    row.getCell(1).value = k;
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).value = v;
    row.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    row.getCell(1).border = border;
    row.getCell(2).border = border;
  });

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "GHS-Babi-Khel-Walkin-Import-Template.xlsx",
  );
}

// ── Walk-in import (parse .xlsx / .csv via exceljs) ────────────────────────

const ALIASES: Record<string, string> = {
  fullname: "full_name", name: "full_name", studentname: "full_name",
  fathername: "father_name", father: "father_name",
  bformno: "b_form_no", bform: "b_form_no", formb: "b_form_no", cnicformb: "b_form_no", bformnumber: "b_form_no",
  mobile: "contact_number", contact: "contact_number", phone: "contact_number", contactnumber: "contact_number",
  class: "applying_class", applyingclass: "applying_class", applyingforclass: "applying_class",
  admissiontype: "admission_type", type: "admission_type",
  previousschool: "previous_school", school: "previous_school",
  previousclass: "previous_class", prevclass: "previous_class",
  previousmarks: "previous_marks", marks: "previous_marks", marksgrade: "previous_marks",
  yearofpassing: "year_of_passing", year: "year_of_passing",
  feepaid: "paid", paid: "paid", feepaidyesno: "paid",
  paymentmethod: "payment_method", method: "payment_method", paidby: "payment_method",
  receiptno: "payment_receipt", receipt: "payment_receipt",
  homeaddress: "home_address", address: "home_address", village: "home_address",
};

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ParsedWalkinRow {
  full_name: string;
  father_name: string;
  b_form_no: string;
  contact_number: string;
  applying_class: string;
  admission_type: string;
  previous_school: string;
  previous_class: string;
  previous_marks: string;
  year_of_passing: string;
  paid: boolean;
  payment_method: string;
  payment_receipt: string;
  home_address: string;
}

export interface WalkinParseResult {
  rows: ParsedWalkinRow[];
  detectedHeaderRow: number | null;
  error?: string;
}

export async function parseWalkinImport(file: File): Promise<WalkinParseResult> {
  // SheetJS (xlsx) reads both .xlsx and .csv reliably in the browser — the
  // same library the GHSS Ghallanai import used.
  const XLSX = await import("xlsx");
  let rows2d: string[][];
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { rows: [], detectedHeaderRow: null, error: "The file has no sheets." };
    rows2d = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  } catch (e: any) {
    return { rows: [], detectedHeaderRow: null, error: `Could not read the file: ${e?.message || "unknown error"}` };
  }
  if (!rows2d || rows2d.length === 0) {
    return { rows: [], detectedHeaderRow: null, error: "The file looks empty." };
  }

  // Header auto-detect within the top 15 rows (needs ≥3 known aliases).
  let headerRowIdx: number | null = null;
  let colMap: Record<number, string> = {};
  for (let r = 0; r < Math.min(15, rows2d.length); r++) {
    const map: Record<number, string> = {};
    (rows2d[r] || []).forEach((cell, col) => {
      const key = ALIASES[norm(String(cell ?? ""))];
      if (key && !Object.values(map).includes(key)) map[col] = key;
    });
    if (Object.keys(map).length >= 3) {
      headerRowIdx = r;
      colMap = map;
      break;
    }
  }
  if (headerRowIdx === null) {
    return {
      rows: [],
      detectedHeaderRow: null,
      error: "Could not find the header row — use the Download Template sheet, or make sure the headers (Full Name, B-Form No, Class…) are in the first 15 rows.",
    };
  }

  const rows: ParsedWalkinRow[] = [];
  const maxR = Math.min(rows2d.length - 1, headerRowIdx + 500);
  for (let r = headerRowIdx + 1; r <= maxR; r++) {
    const row = rows2d[r] || [];
    const get = (key: string): string => {
      const col = Number(Object.keys(colMap).find((c) => colMap[Number(c)] === key) ?? 0);
      if (!col) return "";
      return String(row[col] ?? "").trim();
    };
    const name = get("full_name");
    if (!name) continue; // skip blank rows
    const paidRaw = norm(get("paid"));
    const method = norm(get("payment_method"));
    rows.push({
      full_name: name,
      father_name: get("father_name"),
      b_form_no: (get("b_form_no") || "").replace(/[^0-9]/g, ""),
      contact_number: get("contact_number"),
      applying_class: (get("applying_class") || "").replace(/[^0-9]/g, ""),
      admission_type: norm(get("admission_type")) === "migration" ? "migration" : "fresh",
      previous_school: get("previous_school"),
      previous_class: get("previous_class"),
      previous_marks: get("previous_marks"),
      year_of_passing: get("year_of_passing"),
      paid: ["yes", "y", "1", "true", "paid"].includes(paidRaw),
      payment_method: ["bank", "easypaisa", "jazzcash", "cash", "safepay", "other"].includes(method) ? method : "cash",
      payment_receipt: get("payment_receipt"),
      home_address: get("home_address"),
    });
  }

  if (rows.length === 0) {
    return { rows, detectedHeaderRow: headerRowIdx + 1, error: "No data rows found below the header." };
  }
  return { rows, detectedHeaderRow: headerRowIdx + 1 };
}

// ── shared ──────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
