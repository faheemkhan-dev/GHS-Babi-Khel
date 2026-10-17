/**
 * AdminDMCs.tsx — GHS Babi Khel
 *
 * Replaces the old AdminReportCards.tsx.
 *
 * ─ Generates official DMCs (Detail Marks Certificates) as real A4 PDFs,
 *   drawn with jsPDF in an "Editorial Academic Modern" style modelled on the
 *   school's approved reference DMC: Times serif typography, warm paper
 *   neutrals with ONE deep academic green accent, hairline rules, a purely
 *   typographic masthead (NO logos, NO watermark, NO photo boxes), every
 *   cell's data centred, per-subject performance bars, a full-width result
 *   band, and a GRADE COUNTER table mapping percentage bands to marks and
 *   grades (bands mirror gradeFromPct exactly, so the certificate can never
 *   contradict itself).
 * ─ No attendance section, no teacher remarks section — DMC only.
 * ─ Single student, single class (batch), or WHOLE SCHOOL (all classes)
 *   scopes. Batch/whole-school downloads as ONE combined multi-page PDF
 *   (one DMC per page, ordered by class then DMC No./position) instead of
 *   a ZIP of separate files.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type jsPDF from "jspdf";

// jsPDF (~350 KB) is fetched only when a DMC is actually generated, so the
// Manage Results screen opens fast on very slow connections.
let jsPDFCtor: typeof import("jspdf").default | null = null;
const ensureJsPDF = async () => {
  if (!jsPDFCtor) jsPDFCtor = (await import("jspdf")).default;
  return jsPDFCtor;
};
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDown, Loader2, Users, User, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { examTypeLabel, examTypeLabelInText } from "@/utils/examTypeLabel";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface SubjectMark { obtained: number; total: number; }

interface ResultRecord {
  id: string;
  student_id: string;
  class: string;
  exam_type: string;
  year: number;
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  grade: string | null;
  position: number | null;
  is_pass: boolean;
  remarks: string | null;
  subject_marks: Record<string, SubjectMark> | null;
  exam_roll_no: string | null;
  students: {
    full_name: string;
    roll_number: string;
    photo_url: string | null;
    father_name: string | null;
  } | null;
}

interface SchoolInfo {
  school_name: string;
  address: string;
  emis_code: string;
  phone: string | null;
}

interface AdminDMCsProps {
  cls: string;
  examType: string;
  year: number;
}

const ALL_CLASSES = ["6", "7", "8", "9", "10"];

// Classes 6-8 record results under "1st/2nd Semester"; classes 9-10 record
// under "Annual-I/Annual-II". These are DIFFERENT label sets — using one
// shared exam_type string across all classes (as this screen used to) meant
// Whole School and By Class only ever found results for the class group
// matching whichever label happened to be selected, leaving the other
// group's classes empty even though results existed for them.
const getExamTypesForClass = (cls: string) =>
  ["9", "10"].includes(cls) ? ["Annual-I", "Annual-II"] : ["1st Semester", "2nd Semester"];

// "Term" here means "1st" or "2nd" — index 0 or 1 into the pair above.
// This lets Whole School resolve the correct label PER class group instead
// of using one exam_type for every class.
type Term = 0 | 1;
const examTypeForClassAndTerm = (cls: string, term: Term) => getExamTypesForClass(cls)[term];

// ─── Helpers ────────────────────────────────────────────────────────────────────

const gradeFromPct = (pct: number) => {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 60) return "B";
  if (pct >= 45) return "C";
  if (pct >= 33) return "D";
  return "Fail";
};

// <DMC-PDF-ENGINE>
// ─── DMC design system — "Editorial Academic Modern" ───────────────────────────
// Palette lifted from the school's approved reference DMC: warm paper
// neutrals, one deep academic green accent, near-black ink. No blues, no
// dark navy, no rainbow grade colours — restraint IS the style. Red appears
// ONLY on a genuine FAIL so it keeps its meaning.

const INK: [number, number, number] = [29, 27, 22];           // #1D1B16 — headings, heavy rules
const BODY: [number, number, number] = [58, 54, 46];          // #3A362E — values
const MUTED: [number, number, number] = [111, 106, 97];       // #6F6A61 — labels
const GREEN: [number, number, number] = [15, 92, 70];         // #0F5C46 — academic green accent
const GREEN_TINT: [number, number, number] = [237, 242, 239]; // #EDF2EF — light green fill
const HAIR: [number, number, number] = [231, 226, 213];       // #E7E2D5 — light hairline
const HAIR2: [number, number, number] = [216, 210, 196];      // #D8D2C4 — stronger hairline
const FAIL_RED: [number, number, number] = [155, 44, 44];     // #9B2C2C — FAIL only
const FAIL_TINT: [number, number, number] = [247, 236, 236];  // #F7ECEC — FAIL band fill

const gradeLetter = (g: string | null): string =>
  !g ? "—" : g === "Fail" || g === "F" ? "F" : g;

const isFailGrade = (g: string | null): boolean => g === "Fail" || g === "F";

const ordinalSuffix = (n: number | string): string => {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const rem100 = num % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
  switch (num % 10) {
    case 1: return `${num}st`;
    case 2: return `${num}nd`;
    case 3: return `${num}rd`;
    default: return `${num}th`;
  }
};

// Short exam code used inside the DMC number (raw exam_type → code).
const examCode = (examType: string): string => {
  const map: Record<string, string> = {
    "1st Semester": "1S",
    "2nd Semester": "2S",
    "Annual-I": "A1",
    "Annual-II": "A2",
  };
  if (map[examType]) return map[examType];
  return (examType.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "EX").toUpperCase();
};

// Deterministic, meaningful DMC number: GHS-BK/<year>/<exam><class>-<position>
// e.g. GHS-BK/2026/1S10-01 = 1st Semester, Class 10, 1st position.
const buildDMCNo = (r: ResultRecord): string =>
  `GHS-BK/${r.year}/${examCode(r.exam_type)}${r.class}-${String(r.position ?? 0).padStart(2, "0")}`;

// The masthead carries the school's FULL formal name — "GHS Babi Khel" in
// settings is expanded to "Government High School Babi Khel" on the PDF.
const expandSchoolName = (name: string): string =>
  name.replace(/^\s*G\.?\s*H\.?\s*S\.?\b/i, "Government High School").replace(/\s+/g, " ").trim();

// Shrink the font until `text` fits `maxWidth` (charSpace-aware). Keeps every
// cell overflow-proof for long names / DMC numbers.
const fitFont = (
  doc: jsPDF,
  text: string,
  style: "normal" | "bold" | "italic",
  size: number,
  maxWidth: number,
  charSpace = 0,
): number => {
  doc.setFont("times", style);
  let s = size;
  while (s > 4.5) {
    doc.setFontSize(s);
    const w = doc.getTextWidth(text) + Math.max(0, text.length - 1) * charSpace;
    if (w <= maxWidth) return s;
    s -= 0.25;
  }
  return s;
};

// Baseline offset below a box's vertical centre for a given pt size.
const baseOffset = (size: number): number => size * 0.125;

// True-center text draw when `charSpace` (letter-spacing) is used. jsPDF's
// built-in `align: "center"` centers using the text's un-spaced width, so
// any text drawn with a non-zero charSpace visibly drifts to the right —
// this was the cause of every "not centered" line on the DMC (address,
// EMIS/phone, title, exam line, DMC No., RESULT band, PRINCIPAL). Passing
// charSpace >0 through this helper (instead of doc.text directly) computes
// the real spaced width and starts the text far enough left to land
// perfectly centered on `cx`.
const drawCentered = (
  doc: jsPDF,
  text: string,
  cx: number,
  cy: number,
  charSpace = 0,
): void => {
  if (charSpace > 0) {
    const spacedWidth = doc.getTextWidth(text) + Math.max(0, text.length - 1) * charSpace;
    doc.text(text, cx - spacedWidth / 2, cy, { charSpace });
  } else {
    doc.text(text, cx, cy, { align: "center" });
  }
};

// GRADE COUNTER bands — these mirror gradeFromPct EXACTLY (half-open [lo, hi)
// so any percentage with 2 decimals falls in exactly one band):
// A+ ≥90 · A 80–90 · B 60–80 · C 45–60 · D 33–45 · F below 33.
const GRADE_BANDS: Array<{ grade: string; label: string; lo: number | null; hi: number | null }> = [
  { grade: "A+", label: "90 – 100", lo: 90, hi: null },
  { grade: "A", label: "80 – 90", lo: 80, hi: 90 },
  { grade: "B", label: "60 – 80", lo: 60, hi: 80 },
  { grade: "C", label: "45 – 60", lo: 45, hi: 60 },
  { grade: "D", label: "33 – 45", lo: 33, hi: 45 },
  { grade: "F", label: "Below 33", lo: null, hi: 33 },
];

// Marks range for a percentage band at a given per-subject max, e.g.
// max 55 → A+ 50–55, A 44–49, B 33–43, C 25–32, D 19–24, F 0–18.
// ceil() guarantees every mark in the range really maps to that grade.
const marksRange = (lo: number | null, hi: number | null, max: number): string => {
  if (lo === null) {
    const bottom = Math.max(0, Math.ceil(((hi ?? 33) / 100) * max) - 1);
    return bottom === 0 ? "0" : `0 – ${bottom}`;
  }
  const loM = Math.ceil((lo / 100) * max);
  const hiM = hi === null ? max : Math.ceil((hi / 100) * max) - 1;
  return loM >= hiM ? String(loM) : `${loM} – ${hiM}`;
};

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");

// ─── Draw one DMC page (Editorial Academic Modern, exact A4) ───────────────────

function drawDMC(
  doc: jsPDF,
  r: ResultRecord,
  school: SchoolInfo,
  schoolRank: number | null,
): void {
  const W = doc.internal.pageSize.getWidth();   // 210 mm on A4
  const H = doc.internal.pageSize.getHeight();  // 297 mm on A4
  const MX = 14;            // content side margin
  const CW = W - MX * 2;    // 182 mm content width
  const FRAME = 7.5;        // outer hairline frame inset

  const studentName = (r.students?.full_name || "—").toUpperCase();
  const fatherName = (r.students?.father_name || "—").toUpperCase();
  const classRollNo = r.students?.roll_number || "—";
  const examRollNo = r.exam_roll_no || "—";
  const dmcNo = buildDMCNo(r);
  const overallPct = `${Number(r.percentage ?? 0).toFixed(2)}%`;
  const overallGrade = gradeLetter(r.grade || gradeFromPct(r.percentage ?? 0));
  const fail = isFailGrade(r.grade || (r.is_pass ? null : "Fail")) || !r.is_pass;

  // Subjects with real marks (both 0/0 = not entered → hidden)
  const subjects = r.subject_marks
    ? Object.entries(r.subject_marks).filter(([, m]) => !(m.obtained === 0 && m.total === 0))
    : [];

  // Per-subject max used by the grade counter's marks column — only shown
  // when every subject shares the same max, so the counter stays accurate.
  const totals = subjects.map(([, m]) => m.total);
  const uniformMax = totals.length > 0 && totals.every((t) => t === totals[0]) ? totals[0] : null;

  const nRows = subjects.length;

  // ── Overflow-proof layout metrics ────────────────────────────────────────
  // The certificate is ONE A4 sheet and the signature block is anchored near
  // the page foot — so the section stack above it must PROVABLY fit. Every
  // section height is known up-front, so we compute the full stack here and
  // compress gracefully (gaps → remark box → summary boxes → row height)
  // ONLY when a class really has many subjects. A normal 6–9-subject DMC
  // always keeps the full, airy spacing.
  const LABEL_H = 5.2;
  const bottomLimit = H - 24 - 5; // remarks must end ≥5 mm above the Principal signature line

  let rowH = nRows === 0 ? 6.1 : nRows <= 9 ? 6.1 : nRows <= 12 ? 5.7 : 5.0;
  let gPostTable = 4.2, gSumBand = 2.8, gBandCnt = 4.2, gCntRem = 4.6;
  let remarkBoxH = 13, remarkCap = 3, sumH = 16, bandH = 8.8;

  // Conservative stack height: page top → bottom of the remark box.
  // (73.3 mm conservatively covers masthead + title banner + exam/DMC lines
  // + particulars grid + labels — banner shrunk to title-only.)
  const stackBottom = () =>
    17 + 73.3
    + (nRows === 0 ? 13 : 6.4 + nRows * rowH + 0.6)
    + gPostTable + LABEL_H + sumH + gSumBand + bandH + gBandCnt
    + LABEL_H + 21.5 + gCntRem + LABEL_H + remarkBoxH;

  if (stackBottom() > bottomLimit) { gPostTable = 3.0; gSumBand = 2.2; gBandCnt = 3.4; gCntRem = 3.6; }
  if (stackBottom() > bottomLimit) { remarkCap = 2; remarkBoxH = 10.5; }
  if (stackBottom() > bottomLimit) { sumH = 14.5; bandH = 8.2; }
  while (stackBottom() > bottomLimit && rowH > 3.9) { rowH -= 0.2; }

  // ── Outer hairline frame (editorial certificate feel) ────────────────────
  doc.setDrawColor(...HAIR2);
  doc.setLineWidth(0.35);
  doc.rect(FRAME, FRAME, W - FRAME * 2, H - FRAME * 2, "S");

  let y = 17;

  // ── Masthead — purely typographic, centred ───────────────────────────────
  // Full formal school name ("Government High School Babi Khel") + address
  // line with any segment the name already carries (the village "Babi Khel")
  // filtered out, so no place name is ever printed twice.
  const fullName = expandSchoolName(school.school_name);
  doc.setFont("times", "bold");
  const nameSize = fitFont(doc, fullName, "bold", 14, CW - 8);
  doc.setFontSize(nameSize);
  doc.setTextColor(...INK);
  doc.text(fullName, W / 2, y, { align: "center" });
  y += nameSize * 0.42 + 1.6;

  const nameLc = fullName.toLowerCase();
  const addressLine = school.address
    .split(",").map((s) => s.trim()).filter(Boolean)
    .filter((seg) => !nameLc.includes(seg.toLowerCase()))
    .join("  ·  ").toUpperCase();
  if (addressLine) {
    doc.setFont("times", "normal");
    const addrSize = fitFont(doc, addressLine, "normal", 6.9, CW - 12, 0.55);
    doc.setFontSize(addrSize);
    doc.setTextColor(...MUTED);
    drawCentered(doc, addressLine, W / 2, y, 0.55);
  }
  y += 3.6;

  const emisLine = `EMIS: ${school.emis_code}${school.phone ? `   ·   Ph: ${school.phone}` : ""}`;
  doc.setFont("times", "normal");
  doc.setFontSize(6.4);
  doc.setTextColor(...MUTED);
  drawCentered(doc, emisLine, W / 2, y, 0.3);
  y += 3.1;

  // Refined double rule closing the masthead — whisper-thin paired strokes
  // (classic editorial Oxford rule, deliberately quiet, never heavy)
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.35);
  doc.line(MX, y, MX + CW, y);
  doc.setLineWidth(0.16);
  doc.line(MX, y + 1.25, MX + CW, y + 1.25);
  // Extra breathing room before the title banner — the previous 5.8mm gap
  // put the title baseline almost flush against the double rule.
  y += 4.5;

  // ── Title banner — bordered single row (table-header style), holding
  // ONLY the certificate title. Exam line and DMC No. stay outside the
  // banner as plain centered text beneath it, not enclosed in the box.
  doc.setFont("times", "bold");
  const titleSize = fitFont(doc, "DETAILED MARKS CERTIFICATE", "bold", 13.5, CW - 8, 1.4);
  const examLine =
    `${examTypeLabel(r.exam_type)} EXAMINATION ${r.year} — CLASS ${ordinalSuffix(r.class)}`.toUpperCase();
  const examSize = fitFont(doc, examLine, "bold", 8, CW - 10, 0.9);

  const titleBannerH = 9.6;
  doc.setFillColor(...GREEN_TINT);
  doc.rect(MX, y, CW, titleBannerH, "F");
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.55);
  doc.rect(MX, y, CW, titleBannerH, "S");

  doc.setFont("times", "bold");
  doc.setFontSize(titleSize);
  doc.setTextColor(...INK);
  drawCentered(doc, "DETAILED MARKS CERTIFICATE", W / 2, y + titleBannerH / 2 + baseOffset(titleSize), 1.4);
  y += titleBannerH + 4.4;

  doc.setFont("times", "bold");
  doc.setFontSize(examSize);
  doc.setTextColor(...GREEN);
  drawCentered(doc, examLine, W / 2, y, 0.9);
  y += 4.4;

  doc.setFont("times", "normal");
  doc.setFontSize(6.9);
  doc.setTextColor(...MUTED);
  drawCentered(doc, `DMC NO. ${dmcNo}`, W / 2, y, 0.45);
  y += 5.4;

  // ── Section label helper (small caps + hairline rule to the right) ───────
  const sectionLabel = (title: string): void => {
    doc.setFont("times", "bold");
    doc.setFontSize(6.9);
    doc.setTextColor(...MUTED);
    doc.text(title, MX, y, { charSpace: 1.15 });
    const lw = doc.getTextWidth(title) + (title.length - 1) * 1.15;
    doc.setDrawColor(...HAIR2);
    doc.setLineWidth(0.3);
    doc.line(MX + lw + 2.6, y - 1.15, MX + CW, y - 1.15);
    y += 5.2;
  };

  // ── STUDENT PARTICULARS — 4×2 grid, everything centred (no section
  // caption: the grid speaks for itself right under the title block) ────────
  y += 2.4;
  const gridCols = 4;
  const gridRows = 2;
  const cellW = CW / gridCols;
  const cellH = 11;
  const gridTop = y;

  // outer box + inner rules
  doc.setDrawColor(...HAIR2);
  doc.setLineWidth(0.35);
  doc.rect(MX, gridTop, CW, cellH * gridRows, "S");
  doc.setDrawColor(...HAIR);
  doc.setLineWidth(0.25);
  for (let c = 1; c < gridCols; c++) {
    doc.line(MX + cellW * c, gridTop, MX + cellW * c, gridTop + cellH * gridRows);
  }
  doc.line(MX, gridTop + cellH, MX + CW, gridTop + cellH);

  const particulars: Array<[string, string, [number, number, number] | null]> = [
    ["STUDENT'S NAME", studentName, null],
    ["FATHER'S NAME", fatherName, null],
    ["ROLL NO.", classRollNo, null],
    ["EXAM ROLL NO.", examRollNo, null],
    ["CLASS", ordinalSuffix(r.class), null],
    ["EXAM SESSION", String(r.year), null],
    ["RESULT", r.is_pass ? "PASS" : "FAIL", r.is_pass ? GREEN : FAIL_RED],
    ["DMC NO.", dmcNo, null],
  ];
  particulars.forEach(([label, value, color], i) => {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const cx = MX + cellW * col + cellW / 2;
    const cy = gridTop + row * cellH;
    doc.setFont("times", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...MUTED);
    drawCentered(doc, label, cx, cy + 3.7, 0.6);
    doc.setFont("times", "bold");
    const vs = fitFont(doc, value, "bold", label === "DMC NO." ? 7.2 : 8.4, cellW - 3.4);
    doc.setFontSize(vs);
    doc.setTextColor(...(color ?? BODY));
    doc.text(value, cx, cy + 8.3, { align: "center" });
  });
  y = gridTop + cellH * gridRows + 4.2;

  // ── ACADEMIC RECORD — 7-column table, all data centred ───────────────────
  sectionLabel("ACADEMIC RECORD");
  const colFr = [0.05, 0.35, 0.09, 0.11, 0.18, 0.13, 0.09]; // SR SUBJ MAX OBT PERF PCT GRADE
  const colW = colFr.map((f) => f * CW);
  const colX = (i: number) => MX + colW.slice(0, i).reduce((a, b) => a + b, 0);
  const colCx = (i: number) => colX(i) + colW[i] / 2;

  const headH = 6.4;

  if (nRows === 0) {
    doc.setDrawColor(...HAIR2);
    doc.setLineWidth(0.3);
    doc.rect(MX, y, CW, 13, "S");
    doc.setFont("times", "italic");
    doc.setFontSize(7.6);
    doc.setTextColor(...MUTED);
    doc.text("Subject-wise marks not entered — see result summary below.", W / 2, y + 7.2, { align: "center" });
    y += 13;
  } else {
    // Header row: light green fill, ink small caps, strong top rule
    doc.setFillColor(...GREEN_TINT);
    doc.rect(MX, y, CW, headH, "F");
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.55);
    doc.line(MX, y, MX + CW, y);
    doc.setDrawColor(...HAIR2);
    doc.setLineWidth(0.3);
    doc.line(MX, y + headH, MX + CW, y + headH);
    const headers = ["SR", "SUBJECT", "MAX", "OBTAINED", "PERFORMANCE", "PERCENTAGE", "GRADE"];
    doc.setFont("times", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(...INK);
    headers.forEach((hd, i) => {
      drawCentered(doc, hd, colCx(i), y + headH / 2 + baseOffset(6.2), 0.35);
    });
    y += headH;

    // Data rows
    subjects.forEach(([name, m], idx) => {
      const pct = m.total > 0 ? (m.obtained / m.total) * 100 : 0;
      const grade = gradeFromPct(pct);

      if (idx > 0) {
        doc.setDrawColor(...HAIR);
        doc.setLineWidth(0.2);
        doc.line(MX, y, MX + CW, y);
      }
      const rowCy = y + rowH / 2;
      const bOff = baseOffset(7.8);

      // SR — zero-padded
      doc.setFont("times", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(String(idx + 1).padStart(2, "0"), colCx(0), rowCy + bOff, { align: "center" });
      // SUBJECT
      doc.setFont("times", "normal");
      doc.setFontSize(7.9);
      doc.setTextColor(...BODY);
      const subjSize = fitFont(doc, name, "normal", 7.9, colW[1] - 3);
      doc.setFontSize(subjSize);
      doc.text(name, colCx(1), rowCy + baseOffset(subjSize), { align: "center" });
      // MAX
      doc.setFontSize(7.8);
      doc.setTextColor(...BODY);
      doc.text(String(m.total), colCx(2), rowCy + bOff, { align: "center" });
      // OBTAINED — bold green
      doc.setFont("times", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...GREEN);
      doc.text(String(m.obtained), colCx(3), rowCy + baseOffset(8.2), { align: "center" });
      // PERFORMANCE — hairline-slim progress bar (green when passed, red when failed)
      const barW = colW[4] - 10;
      const barH = 1.4;
      const barX = colCx(4) - barW / 2;
      const barY = rowCy - barH / 2;
      doc.setFillColor(...HAIR);
      doc.roundedRect(barX, barY, barW, barH, 0.7, 0.7, "F");
      const fillPct = Math.min(100, Math.max(0, pct));
      if (fillPct > 0) {
        // Failed paper → RED bar; passed paper → GREEN bar.
        doc.setFillColor(...(isFailGrade(grade) ? FAIL_RED : GREEN));
        doc.roundedRect(barX, barY, Math.max(barH, (barW * fillPct) / 100), barH, 0.7, 0.7, "F");
      }
      // PERCENTAGE — 2 decimals like the reference (e.g. 80.00)
      doc.setFont("times", "normal");
      doc.setFontSize(7.8);
      doc.setTextColor(...BODY);
      doc.text(pct.toFixed(2), colCx(5), rowCy + bOff, { align: "center" });
      // GRADE
      doc.setFont("times", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(...(isFailGrade(grade) ? FAIL_RED : GREEN));
      doc.text(gradeLetter(grade), colCx(6), rowCy + baseOffset(8.2), { align: "center" });

      y += rowH;
    });

    // Table closes on a strong bottom rule balancing the header rule
    // (totals live in RESULT SUMMARY below — the table stays subject-pure)
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.55);
    doc.line(MX, y, MX + CW, y);
  }
  y += gPostTable;

  // ── RESULT SUMMARY — 4 centred stat cells + full-width result band ───────
  sectionLabel("RESULT SUMMARY");
  const sumGap = 3;
  const sumW = (CW - sumGap * 3) / 4;
  const summary: Array<[string, string, [number, number, number]]> = [
    ["MARKS OBTAINED", `${r.obtained_marks} / ${r.total_marks}`, INK],
    ["PERCENTAGE", overallPct, INK],
    ["OVERALL GRADE", overallGrade, fail ? FAIL_RED : GREEN],
    ["CLASS POSITION", r.position ? ordinalSuffix(r.position) : "—", fail ? FAIL_RED : GREEN],
  ];
  summary.forEach(([label, value, color], i) => {
    const bx = MX + (sumW + sumGap) * i;
    doc.setDrawColor(...HAIR2);
    doc.setLineWidth(0.35);
    doc.rect(bx, y, sumW, sumH, "S");
    doc.setFont("times", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...MUTED);
    drawCentered(doc, label, bx + sumW / 2, y + sumH * 0.294, 0.55);
    doc.setFont("times", "bold");
    const vs = fitFont(doc, value, "bold", 12.5, sumW - 3);
    doc.setFontSize(vs);
    doc.setTextColor(...color);
    doc.text(value, bx + sumW / 2, y + sumH * 0.725, { align: "center" });
  });
  y += sumH + gSumBand;

  // Full-width RESULT band
  doc.setFillColor(...(fail ? FAIL_TINT : GREEN_TINT));
  doc.rect(MX, y, CW, bandH, "F");
  doc.setDrawColor(...(fail ? FAIL_RED : GREEN));
  doc.setLineWidth(0.65);
  doc.rect(MX, y, CW, bandH, "S");
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...(fail ? FAIL_RED : GREEN));
  drawCentered(doc, `RESULT — ${r.is_pass ? "PASS" : "FAIL"}`, W / 2, y + bandH / 2 + baseOffset(10.5), 2.2);
  y += bandH + gBandCnt;

  // ── GRADE COUNTER — two side-by-side 3-row tables ────────────────────────
  sectionLabel("GRADE COUNTER");
  const gcGap = 4;
  const gcW = (CW - gcGap) / 2;
  const gcCols = uniformMax !== null ? [0.38, 0.37, 0.25] : [0.62, 0.38];
  const gcColW = gcCols.map((f) => f * gcW);
  const gcColX = (gx: number, i: number) => gx + gcColW.slice(0, i).reduce((a, b) => a + b, 0);
  const gcColCx = (gx: number, i: number) => gcColX(gx, i) + gcColW[i] / 2;
  const gcHeadH = 5;
  const gcRowH = 5.5;
  const leftBands = GRADE_BANDS.slice(0, 3);
  const rightBands = GRADE_BANDS.slice(3);

  const drawGcHeader = (gx: number): void => {
    doc.setFont("times", "bold");
    doc.setFontSize(5.6);
    doc.setTextColor(...MUTED);
    const marksLabel = uniformMax !== null ? `MARKS (OUT OF ${uniformMax})` : "MARKS";
    const headLabels = uniformMax !== null ? ["PERCENTAGE", marksLabel, "GRADE"] : ["PERCENTAGE", "GRADE"];
    headLabels.forEach((hd, i) => {
      const hs = fitFont(doc, hd, "bold", 5.6, gcColW[i] - 1.5, 0.3);
      doc.setFontSize(hs);
      drawCentered(doc, hd, gcColCx(gx, i), y + gcHeadH / 2 + baseOffset(5.6), 0.3);
    });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.35);
    doc.line(gx, y + gcHeadH, gx + gcW, y + gcHeadH);
  };

  const drawGcRows = (gx: number, bands: typeof leftBands): void => {
    bands.forEach((band, idx) => {
      const ry = y + gcHeadH + gcRowH * idx;
      if (idx > 0) {
        doc.setDrawColor(...HAIR);
        doc.setLineWidth(0.2);
        doc.line(gx, ry, gx + gcW, ry);
      }
      const rcy = ry + gcRowH / 2;
      doc.setFont("times", "normal");
      doc.setFontSize(7.4);
      doc.setTextColor(...BODY);
      doc.text(band.label, gcColCx(gx, 0), rcy + baseOffset(7.4), { align: "center" });
      if (uniformMax !== null) {
        doc.text(marksRange(band.lo, band.hi, uniformMax), gcColCx(gx, 1), rcy + baseOffset(7.4), { align: "center" });
      }
      doc.setFont("times", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...(band.grade === "F" ? FAIL_RED : GREEN));
      doc.text(band.grade, gcColCx(gx, gcCols.length - 1), rcy + baseOffset(8), { align: "center" });
    });
  };

  // frame both halves
  const gcTableH = gcHeadH + gcRowH * 3;
  doc.setDrawColor(...HAIR2);
  doc.setLineWidth(0.3);
  doc.rect(MX, y, gcW, gcTableH, "S");
  doc.rect(MX + gcW + gcGap, y, gcW, gcTableH, "S");
  drawGcHeader(MX);
  drawGcHeader(MX + gcW + gcGap);
  drawGcRows(MX, leftBands);
  drawGcRows(MX + gcW + gcGap, rightBands);
  y += gcTableH + gCntRem;

  // ── REMARKS — italic serif, centred (real remark, or composed from real
  // result facts — never invented) ──────────────────────────────────────────
  sectionLabel("REMARKS");
  doc.setDrawColor(...HAIR2);
  doc.setLineWidth(0.3);
  doc.rect(MX, y, CW, remarkBoxH, "S");
  const autoRemark = r.position
    ? `${studentName} secured ${ordinalSuffix(r.position)} position in Class ${r.class} with ${overallPct} in ${examTypeLabel(r.exam_type)} Examination ${r.year} — Result ${r.is_pass ? "PASS" : "FAIL"}.`
    : `${studentName} obtained ${overallPct} in ${examTypeLabel(r.exam_type)} Examination ${r.year} — Result ${r.is_pass ? "PASS" : "FAIL"}.`;
  const remarkText = (r.remarks || "").trim() || autoRemark;
  doc.setFont("times", "italic");
  doc.setFontSize(7.9);
  // Wrap FIRST at full size, then clamp to the line budget — lines fit by
  // construction, so long remarks stay readable instead of shrinking into
  // one microscopic line.
  const remarkLines = (doc.splitTextToSize(remarkText, CW - 10) as string[]).slice(0, remarkCap);
  const widestLine = Math.max(...remarkLines.map((l) => doc.getTextWidth(l)));
  let remarkFs = 7.9;
  if (widestLine > CW - 10) {
    // single unbreakably-long word — scale down just enough to fit
    remarkFs = Math.max(5.5, (7.9 * (CW - 10)) / widestLine);
    doc.setFontSize(remarkFs);
  }
  const remarkStart = y + remarkBoxH / 2 - ((remarkLines.length - 1) * 3.4) / 2 + baseOffset(remarkFs);
  doc.setTextColor(...BODY);
  remarkLines.forEach((line: string, i: number) => {
    doc.text(line, W / 2, remarkStart + i * 3.4, { align: "center" });
  });
  y += remarkBoxH;

  // ── Signature — PRINCIPAL, right-aligned (professional right-center
  // placement, matching how signatures sit on real certificates — not
  // dead-center of the page) ────────────────────────────────────────────
  const sigY = H - 24;
  const sigLineW = 46;
  // Right-center: pushed further right per feedback — 85% across content
  // width, closer to the right margin while keeping the sig line clear of it.
  const sigCx = MX + CW * 0.85;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(sigCx - sigLineW / 2, sigY, sigCx + sigLineW / 2, sigY);
  doc.setFont("times", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...INK);
  drawCentered(doc, "PRINCIPAL", sigCx, sigY + 3.8, 0.9);
  doc.setFont("times", "italic");
  doc.setFontSize(5.7);
  doc.setTextColor(...MUTED);
  doc.text("Signature & School Stamp", sigCx, sigY + 6.9, { align: "center" });

  // schoolRank is honoured in the CLASS POSITION stat; kept in the signature
  // for API compatibility (no extra badge — the editorial layout stays clean).
  void schoolRank;
}
// </DMC-PDF-ENGINE>

async function generateDMCPDF(
  r: ResultRecord,
  school: SchoolInfo,
  schoolRank: number | null,
): Promise<jsPDF> {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  drawDMC(doc, r, school, schoolRank);
  return doc;
}

// ─── Main Component ─────────────────────────────────────────────────────────────

function AdminDMCs({ cls, examType, year }: AdminDMCsProps) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>("all");
  const [scope, setScope] = useState<"class" | "school">("class");
  // The class to use when scope is "class" — defaults to whatever class tab
  // was open in Manage Results, but the admin can change it here without
  // having to leave this screen and switch tabs.
  const [selectedClass, setSelectedClass] = useState<string>(cls);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  // ── Term (1st/2nd) — replaces the old fixed `examType` prop ─────────────
  // FIX: classes 6-8 use "1st/2nd Semester" while 9-10 use "Annual-I/II".
  // Passing one shared examType string to every class's query meant Whole
  // School (and switching class under By Class) silently found zero
  // results for whichever class group didn't match that label. Instead we
  // track a term INDEX (0 = first, 1 = second) and resolve the correct
  // label per class at query time.
  const initialTerm: Term = getExamTypesForClass(cls).indexOf(examType) === 1 ? 1 : 0;
  const [term, setTerm] = useState<Term>(initialTerm);

  // The exam_type actually used for "By Class" scope — always matches
  // whichever class is selected, so switching class never leaves a stale
  // label from a different class group behind.
  const classExamType = examTypeForClassAndTerm(selectedClass, term);
  const termLabelPair = getExamTypesForClass(selectedClass);

  const { data: settings } = useSchoolSettings();
  const school: SchoolInfo = {
    school_name: settings?.school_name || "GHS Babi Khel",
    address: settings?.address || "Babi Khel, District Mohmand, KPK, Pakistan",
    emis_code: settings?.emis_code || "—",
    phone: settings?.phone || null,
  };

  // ── Fetch results (single class, or every class for whole-school) ──────────
  // FIX: Whole School now issues ONE query per class group (6-8 semester
  // label, 9-10 annual label) instead of a single .eq("exam_type", ...)
  // across all 5 classes — previously that only ever matched one group,
  // leaving the other group's classes empty.
  const { data: results = [], isLoading, error: fetchError } = useQuery<ResultRecord[]>({
    queryKey: ["admin-dmcs", scope, selectedClass, classExamType, term, year],
    queryFn: async () => {
      const baseSelect = "id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, subject_marks, exam_roll_no, students(full_name, roll_number, photo_url, father_name)";

      let rows: ResultRecord[];
      if (scope === "school") {
        // Group classes by which label set they use, and query each group
        // with its own correct exam_type for the selected term.
        const groups = new Map<string, string[]>(); // exam_type -> classes
        for (const c of ALL_CLASSES) {
          const et = examTypeForClassAndTerm(c, term);
          if (!groups.has(et)) groups.set(et, []);
          groups.get(et)!.push(c);
        }
        const chunks = await Promise.all(
          Array.from(groups.entries()).map(async ([et, classesInGroup]) => {
            const { data, error } = await supabase
              .from("results")
              .select(baseSelect)
              .eq("exam_type", et)
              .eq("year", year)
              .in("class", classesInGroup)
              .order("class", { ascending: true })
              .order("percentage", { ascending: false });
            if (error) throw error;
            return (data ?? []) as unknown as ResultRecord[];
          })
        );
        rows = chunks.flat();
      } else {
        const { data, error } = await supabase
          .from("results")
          .select(baseSelect)
          .eq("exam_type", classExamType)
          .eq("year", year)
          .eq("class", selectedClass)
          .order("percentage", { ascending: false });
        if (error) throw error;
        rows = (data ?? []) as unknown as ResultRecord[];
      }

      // ── Fallback: fill in missing exam_roll_no from the exam_roll_numbers
      // table (the "Exam Roll Numbers" feature) for any student whose
      // result row never had one manually entered. Previously a student
      // with a real, published exam roll number could still show "—" on
      // their DMC just because it wasn't copied onto their result row.
      const missingIds = Array.from(new Set(rows.filter(r => !r.exam_roll_no).map(r => r.student_id)));
      if (missingIds.length) {
        const { data: rollRows } = await supabase
          .from("exam_roll_numbers")
          .select("student_id, exam_roll_no, created_at")
          .in("student_id", missingIds)
          .order("created_at", { ascending: false });
        const latestByStudent = new Map<string, string>();
        for (const rr of rollRows ?? []) {
          if (!latestByStudent.has(rr.student_id)) latestByStudent.set(rr.student_id, rr.exam_roll_no);
        }
        rows = rows.map(r =>
          !r.exam_roll_no && latestByStudent.has(r.student_id)
            ? { ...r, exam_roll_no: latestByStudent.get(r.student_id)! }
            : r
        );
      }

      return rows;
    },
    enabled: !!year && (scope === "school" || !!selectedClass),
    staleTime: 10 * 60 * 1000,
  });

  // ── Whole-school results, ALWAYS fetched regardless of scope ────────────────
  // Used purely to compute each student's rank across the entire school (not
  // just within their own class), so a single-class DMC can still show
  // "Rank #X in whole school" alongside "Position #Y in Class". Same
  // per-class-group fix applies here.
  const { data: schoolWideResults = [] } = useQuery<ResultRecord[]>({
    queryKey: ["admin-dmcs-schoolwide-rank", term, year],
    queryFn: async () => {
      const groups = new Map<string, string[]>();
      for (const c of ALL_CLASSES) {
        const et = examTypeForClassAndTerm(c, term);
        if (!groups.has(et)) groups.set(et, []);
        groups.get(et)!.push(c);
      }
      const chunks = await Promise.all(
        Array.from(groups.entries()).map(async ([et, classesInGroup]) => {
          const { data, error } = await supabase
            .from("results")
            .select("id, student_id, class, percentage")
            .eq("exam_type", et)
            .eq("year", year)
            .in("class", classesInGroup);
          if (error) throw error;
          return (data ?? []) as unknown as ResultRecord[];
        })
      );
      return chunks.flat();
    },
    enabled: !!year,
    staleTime: 10 * 60 * 1000,
  });

  // Map of student_id -> rank across the whole school (highest percentage
  // per student, deduplicated, sorted descending).
  const schoolRankMap = (() => {
    const seen = new Map<string, number>();
    for (const r of schoolWideResults) {
      const existing = seen.get(r.student_id);
      if (existing === undefined || r.percentage > existing) {
        seen.set(r.student_id, r.percentage);
      }
    }
    const sorted = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
    const map = new Map<string, number>();
    sorted.forEach(([studentId], i) => map.set(studentId, i + 1));
    return map;
  })();

  // ── Deduplicated & ranked results (ranked WITHIN each class, never mixed) ──
  const rankedResults = (() => {
    const seen = new Map<string, ResultRecord>();
    for (const r of results) {
      if (!seen.has(r.student_id) || r.percentage > seen.get(r.student_id)!.percentage) {
        seen.set(r.student_id, r);
      }
    }
    const deduped = Array.from(seen.values());
    const byClass = new Map<string, ResultRecord[]>();
    for (const r of deduped) {
      if (!byClass.has(r.class)) byClass.set(r.class, []);
      byClass.get(r.class)!.push(r);
    }
    const out: ResultRecord[] = [];
    for (const [, group] of Array.from(byClass.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      const ranked = group.sort((a, b) => b.percentage - a.percentage)
        .map((r, i) => ({ ...r, position: r.position ?? i + 1 }));
      out.push(...ranked);
    }
    return out;
  })();

  // Which classes actually turned up results, vs which are missing — shown
  // in whole-school scope so it's clear when a class is absent because it
  // simply has no results entered yet (not because of a bug).
  const classesWithData = Array.from(new Set(rankedResults.map(r => r.class))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const classesMissing = scope === "school" ? ALL_CLASSES.filter(c => !classesWithData.includes(c)) : [];

  // ── Generate single DMC ──────────────────────────────────────────────────
  const handleGenerateSingle = async () => {
    const target = selectedStudentId === "all"
      ? rankedResults[0]
      : rankedResults.find(r => r.student_id === selectedStudentId);

    if (!target) {
      toast.error("No student selected or no results found");
      return;
    }

    setGenerating(true);
    setProgressLabel("Generating DMC...");
    setProgress(40);

    try {
      const doc = await generateDMCPDF(target, school, schoolRankMap.get(target.student_id) ?? null);
      setProgress(90);

      const fileName = `DMC_Class${target.class}_${sanitizeFileName(target.students?.full_name || "Student")}_${examTypeLabel(target.exam_type).replace(/\s/g, "")}_${year}.pdf`;
      doc.save(fileName);

      setProgress(100);
      toast.success("DMC PDF generated!");
    } catch (err) {
      toast.error(err?.message || "Failed to generate DMC");
    } finally {
      setTimeout(() => {
        setGenerating(false);
        setProgress(0);
        setProgressLabel("");
      }, 800);
    }
  };

  // ── Generate batch as ONE combined PDF (single class, or whole school) ────
  // Every student's DMC is drawn as its own page, in the SAME order as the
  // on-screen ranked list — i.e. by class, then by DMC number / position —
  // so page order always matches DMC No. order. Previously this produced a
  // ZIP of one-PDF-per-student; a single multi-page PDF is easier to print
  // and browse as a batch.
  const handleGenerateBatch = async () => {
    if (rankedResults.length === 0) {
      toast.error("No results found for this selection");
      return;
    }

    setGenerating(true);
    setProgress(0);
    setProgressLabel("Initializing...");

    try {
      const zipLabel = scope === "school" ? "WholeSchool" : `Class${selectedClass}`;
      const termLabel = term === 0 ? "Term1" : "Term2";

      const JsPDF = await ensureJsPDF();
      const doc = new JsPDF({ unit: "mm", format: "a4" });

      for (let i = 0; i < rankedResults.length; i++) {
        const r = rankedResults[i];
        const studentName = r.students?.full_name || "Unknown";
        setProgressLabel(`Generating: ${studentName} (Class ${r.class}) — ${i + 1}/${rankedResults.length}`);
        setProgress(Math.round(((i + 0.3) / rankedResults.length) * 90));

        if (i > 0) doc.addPage();
        drawDMC(doc, r, school, schoolRankMap.get(r.student_id) ?? null);

        setProgress(Math.round(((i + 1) / rankedResults.length) * 90));
      }

      setProgressLabel("Finalizing PDF...");
      setProgress(95);

      doc.save(`DMCs_${zipLabel}_${termLabel}_${year}.pdf`);

      setProgress(100);
      toast.success(`${rankedResults.length} DMCs combined into one PDF!`);
    } catch (err) {
      toast.error(err?.message || "Batch generation failed");
    } finally {
      setTimeout(() => {
        setGenerating(false);
        setProgress(0);
        setProgressLabel("");
      }, 800);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <FileDown className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">DMC Generation</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              Generate official Detail Marks Certificates (DMCs) &middot; {scope === "class" ? examTypeLabel(classExamType) : (term === 0 ? "1st Term" : "2nd Term")} {year}
            </p>
          </div>
          {rankedResults.length > 0 && (
            <Badge variant="secondary" className="h-6 shrink-0 gap-1 rounded-full px-2.5 text-[11px] font-semibold">
              <Users className="w-3.5 h-3.5" />
              {rankedResults.length} student{rankedResults.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* Controls */}
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Scope: single class vs whole school */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
              Scope
            </label>
            <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="inline-flex h-10 min-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:min-w-0">
                <button
                  type="button"
                  onClick={() => { setScope("class"); setSelectedStudentId("all"); }}
                  className={`h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${
                    scope === "class"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  }`}
                >
                  By Class
                </button>
                <button
                  type="button"
                  onClick={() => { setScope("school"); setSelectedStudentId("all"); }}
                  className={`h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${
                    scope === "school"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  }`}
                >
                  Whole School (Classes {ALL_CLASSES[0]}–{ALL_CLASSES[ALL_CLASSES.length - 1]})
                </button>
              </div>
            </div>

            {/* Term selector — replaces the old fixed examType label.
                Classes 6-8 use "1st/2nd Semester"; 9-10 use "Annual-I/II".
                This picks the right label automatically per class/group. */}
            <div className="mt-3">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                Term
              </label>
              <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="inline-flex h-10 min-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:min-w-0">
                  <button
                    type="button"
                    onClick={() => setTerm(0)}
                    className={`h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${
                      term === 0
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                    }`}
                  >
                    {scope === "class" ? examTypeLabel(termLabelPair[0]) : "1st Term (Semester I / Mid-Term)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTerm(1)}
                    className={`h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${
                      term === 1
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background hover:text-foreground"
                    }`}
                  >
                    {scope === "class" ? examTypeLabel(termLabelPair[1]) : "2nd Term (Semester II / Final-Term)"}
                  </button>
                </div>
              </div>
            </div>

            {/* Class picker — only shown/relevant when scope is "By Class".
                This lets the admin pick ANY class here, instead of being
                stuck with whatever class tab happened to be open in Manage
                Results when they clicked into DMCs. */}
            {scope === "class" && (
              <div className="mt-3">
                <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                  Which Class
                </label>
                <Select value={selectedClass} onValueChange={(v) => { setSelectedClass(v); setSelectedStudentId("all"); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose class..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_CLASSES.map(c => (
                      <SelectItem key={c} value={c}>Class {c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scope === "school" && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Generates DMCs for every class ({ALL_CLASSES.join(", ")}) &middot; {year}. Classes 6–8 use the matching Semester, classes 9–10 use the matching Mid-Term/Final-Term exam. The ZIP will contain one subfolder per class — 6, 7, 8, 9, and 10 (any class with no results for this term/year will simply be empty).
              </p>
            )}
            {scope === "school" && classesMissing.length > 0 && (
              <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1 font-medium">
                No results found yet for Class {classesMissing.join(", ")} — those classes won't have DMCs until results are added in Manage Results.
              </p>
            )}
          </div>

          {/* Student selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                Select Student
              </label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose student..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Students (Batch)</SelectItem>
                  {rankedResults.map(r => (
                    <SelectItem key={r.student_id} value={r.student_id}>
                      {scope === "school" ? `Class ${r.class} — ` : ""}{r.students?.full_name || "Unknown"} &middot; Roll: {r.students?.roll_number || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Single-DMC button only appears once a specific student is
                picked — previously it defaulted to "Generate First
                Student's DMC" when "All Students" was selected, which was
                confusing since it silently generated a DMC for whichever
                student happened to be first in the ranked list. */}
            {selectedStudentId !== "all" && (
              <Button
                onClick={handleGenerateSingle}
                disabled={generating || rankedResults.length === 0}
                className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
                Generate DMC
              </Button>
            )}

            <Button
              onClick={handleGenerateBatch}
              disabled={generating || rankedResults.length === 0}
              variant="outline"
              className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 hover:bg-primary/5"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              {scope === "school"
                ? `Generate Whole School PDF (${rankedResults.length})`
                : `Generate All PDF (${rankedResults.length})`}
            </Button>
          </div>

          {/* Progress bar */}
          {generating && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2.5" />
              <p className="text-xs text-muted-foreground text-center animate-pulse">
                {progressLabel} &middot; {progress}%
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* Error state */}
      {fetchError && (
        <Card className="rounded-2xl border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="p-5 text-center">
            <ShieldAlert className="w-10 h-10 text-destructive/50 mx-auto mb-2" />
            <p className="font-semibold text-foreground">Could not load results</p>
            <p className="text-sm text-muted-foreground mt-1">{(fetchError as any)?.message || "Database error — please check your connection and try again."}</p>
          </CardContent>
        </Card>
      )}

      {/* Student preview list */}
      {!isLoading && rankedResults.length > 0 && (
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-border/60 bg-primary/5">
              <p className="truncate text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {scope === "school" ? "All students in school" : "Students in this class"} &middot; {scope === "class" ? examTypeLabel(classExamType) : (term === 0 ? "1st Term" : "2nd Term")} {year}
              </p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {rankedResults.map((r, idx) => {
                const gradeColor = r.is_pass
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300";
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 hover:bg-primary/5 transition-colors"
                  >
                    <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {r.students?.full_name || "Unknown"}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {scope === "school" && `Class ${r.class} \u00B7 `}
                        Roll: {r.students?.roll_number || "—"}
                        {r.students?.father_name && ` \u00B7 Father: ${r.students.father_name}`}
                        {r.exam_roll_no && ` \u00B7 Exam Roll: ${r.exam_roll_no}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <span className="text-sm font-bold text-primary">{r.percentage}%</span>
                      <Badge className={`text-[10px] px-1.5 py-0.5 ${gradeColor}`}>
                        {r.is_pass ? "Pass" : "Fail"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && rankedResults.length === 0 && (
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardContent className="p-10 text-center">
            <FileDown className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="font-semibold text-foreground">No Results Found</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
              No results are available for {scope === "school" ? "any class in the school" : `Class ${selectedClass}`} &middot; {scope === "class" ? examTypeLabel(classExamType) : (term === 0 ? "1st Term" : "2nd Term")} &middot; {year}.
              Please add results in the Manage Results tab first.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default AdminDMCs;
