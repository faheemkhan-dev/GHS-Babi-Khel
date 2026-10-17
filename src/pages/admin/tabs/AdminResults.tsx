import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Plus, Pencil, Trash2, Loader2, Upload, Search, Download, Hash, Timer, FileDown, FileSpreadsheet, EyeOff, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { triggerConfetti } from "@/lib/confetti";
import { getGradeFromPercentage, getGradeColor, getPassThreshold, useGradingSchemes } from "@/hooks/useResultsEnhanced";
// XLSX import removed — was only used by the deleted per-class exportResultsExcel().
// exceljs (~900 KB) is loaded on demand inside the export handler only.
import ClassAnalyticsPdfButton from "./ClassAnalyticsPdfButton";
import AdminDMCs from "./AdminDMCs";
import { examTypeLabel } from "@/utils/examTypeLabel";

// ── CSV row parser (RFC 4180-ish) ────────────────────────────────────────────
// Handles: quoted fields, commas inside quotes, escaped "" quotes, and both
// \n and \r\n line endings. Used by the Import CSV feature so that a field
// like `"Good, keep it up"` in the remarks column doesn't shift every column
// after it and corrupt the import (the bug the old naive split(",") had).
function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  // Push the final field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank trailing rows.
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

const classes = ["6", "7", "8", "9", "10"];
const getExamTypes = (cls: string) =>
  ["9", "10"].includes(cls)
    ? ["Annual-I", "Annual-II"]
    : ["1st Semester", "2nd Semester"];

interface Student { id: string; full_name: string; roll_number: string; photo_url: string | null; }
interface ExamRollEntry {
  id: string; student_id: string; exam_roll_no: string; student_name: string; class: string;
  session_id: string;
  exam_roll_sessions?: { exam_year: number; exam_term: string; created_at: string; is_published: boolean } | null;
}

interface Result {
  id: string; student_id: string; class: string; exam_type: string; year: number;
  total_marks: number; obtained_marks: number; percentage: number; grade: string | null;
  position: number | null; is_pass: boolean; remarks: string | null;
  exam_roll_no: string | null; manual_pass_fail: boolean | null; created_at: string;
  is_published: boolean; publish_at: string | null;
  students?: { full_name: string; roll_number: string; photo_url: string | null } | null;
}

// ─── Subject lists per class group ───────────────────────────────────────────
const SUBJECTS_6_TO_8 = [
  "English", "Urdu", "Islamiyat", "M.Quran", "Arabic", "Geography",
  "Pashto", "Maths", "History", "G.Science", "Computer Science",
];
const SUBJECTS_9_TO_10 = [
  "English", "Urdu", "Pak-study", "Chemistry", "Physics",
  "Computer Science", "Biology", "Islamiyat", "M.Quran", "Mathematics",
];
const getSubjects = (cls: string) =>
  ["9", "10"].includes(cls) ? SUBJECTS_9_TO_10 : SUBJECTS_6_TO_8;
const DEFAULT_SUBJECT_MAX = 75;


// ── Paper-import helpers ─────────────────────────────────────────────────────
interface ImportRow {
  line: number; rollNo: string; name: string; paperName: string;
  student: { id: string; full_name: string; roll_number: string; photo_url: string | null } | null;
  examRoll: string | null;
  subjectMarks: Record<string, { obtained: number; total: number }> | null;
  total: number; obtained: number; percentage: number;
  isPass: boolean; manualStatus: boolean | null; remarks: string | null;
  errors: string[]; warnings: string[]; canForce: boolean; forced: boolean;
}

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const normRoll = (r: string) => r.trim().toLowerCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const normName = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

const SUBJECT_ALIASES: Record<string, string[]> = {
  "English": ["english", "eng"], "Urdu": ["urdu"],
  "Islamiyat": ["islamiyat", "islamiat", "islamiyyat", "islamic"],
  "M.Quran": ["mquran", "quran", "nazra", "mquranmajeed"], "Arabic": ["arabic"],
  "Geography": ["geography", "geo"], "Pashto": ["pashto"],
  "Maths": ["maths", "math", "mathematics"], "Mathematics": ["mathematics", "maths", "math"],
  "History": ["history"], "G.Science": ["gscience", "generalscience", "science", "gsc"],
  "Computer Science": ["computerscience", "computer", "cs", "comp"],
  "Pak-study": ["pakstudy", "pakstudies", "pakistanstudies", "pakstd"],
  "Chemistry": ["chemistry", "chem"], "Physics": ["physics", "phy"], "Biology": ["biology", "bio"],
};
const matchSubject = (normalizedHeader: string, subjects: string[]): string | null => {
  for (const s of subjects) {
    const aliases = [normHeader(s), ...(SUBJECT_ALIASES[s] || [])];
    if (aliases.includes(normalizedHeader)) return s;
  }
  return null;
};

const tokenClose = (a: string, b: string) =>
  a === b ||
  (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) ||
  (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1 &&
    [...a].filter((c, i) => c !== b[i]).length <= 1);

/** 0..1 — how alike two names are (tolerates spelling slips & word order). */
function nameSimilarity(a: string, b: string): number {
  const ta = normName(a).split(" ").filter(Boolean);
  const tb = normName(b).split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 1; // nothing to compare
  const used = new Set<number>();
  let hit = 0;
  for (const x of ta) {
    const j = tb.findIndex((y, idx) => !used.has(idx) && tokenClose(x, y));
    if (j !== -1) { used.add(j); hit++; }
  }
  return hit / Math.max(ta.length, tb.length);
}

const currentYear = new Date().getFullYear();

// ── Auto-publish countdown for results ───────────────────────────────────────
//
// THREE bugs this component must avoid:
//
//   1. "Trickle publish" — when admin schedules "All Classes At Once", every
//      class row gets the SAME `publish_at` timestamp. The old code only
//      published the CURRENT class+exam+year when the timer fired, so class 6
//      published at T+0, then class 7 waited for the next Vercel cron tick
//      (up to 1 minute later), then class 8, etc. Fix: publish by
//      `publish_at` value so all classes sharing that timestamp flip in one
//      PATCH.
//
//   2. "Auto-republish after unpublish" — when admin clicks "Unpublish
//      Results", is_published flips to false BUT publish_at stays set to
//      the old (past) timestamp. The render condition
//      `results[0]?.publish_at && !results.every(r => r.is_published)`
//      becomes true again, the timer mounts, sees diff <= 0 (publish_at is
//      in the past), and IMMEDIATELY re-publishes the same rows. Fix: clear
//      `publish_at` to null in the same PATCH that flips is_published=true,
//      so the timer never re-renders for this schedule again.
//
//   3. "Defensive guard" — even with #2, if anything ever leaves a stale
//      past `publish_at` on a row (e.g. a partial DB write, or a row that
//      was unpublished via direct SQL), we must NOT mount the timer for a
//      past date. Fix: only render <ResultCountdownTimer/> when publish_at
//      is strictly in the future.
function ResultCountdownTimer({ targetDate, cls, examType, year, onPublished }: {
  targetDate: string; cls: string; examType: string; year: number; onPublished: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const calc = async () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        if (!done) {
          setDone(true); setTimeLeft("");
          // Publish EVERY row whose publish_at matches this timestamp AND
          // is still unpublished — not just the current class. This handles
          // "All Classes At Once" scheduling where all classes share the
          // same publish_at value.
          //
          // CRITICAL: also clear `publish_at` to null in the SAME update.
          // Without this, the render condition
          // `results[0]?.publish_at && !results.every(r => r.is_published)`
          // stays true after the timer fires, AND stays true if admin later
          // clicks "Unpublish Results" — causing the timer to re-mount and
          // re-fire instantly, re-publishing the rows admin just unpublished.
          // Clearing publish_at breaks that loop permanently: once published,
          // the schedule is "consumed" and can never auto-fire again.
          await supabase.from("results")
            .update({ is_published: true, publish_at: null })
            .eq("publish_at", targetDate)
            .eq("is_published", false);
          onPublished();
        }
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(d > 0 ? `${d}d ${h}h ${m}m ${s}s` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [targetDate, cls, examType, year, done, onPublished]);
  if (done || !timeLeft) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 dark:border-blue-500/30 dark:bg-blue-950/20">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white"><Timer className="h-4 w-4 animate-pulse" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-800 dark:text-blue-400">Auto-publishes in</p>
        <p className="break-words font-mono text-sm font-bold leading-tight tabular-nums text-blue-900 dark:text-blue-300">{timeLeft}</p>
      </div>
    </div>
  );
}

const AdminResults = () => {
  const qc = useQueryClient();
  const [cls, setCls] = useState("6");
  const examTypes = getExamTypes(cls);
  const [examType, setExamType] = useState(examTypes[0]);
  const [year, setYear] = useState(currentYear);
  const [subTab, setSubTab] = useState("results");

  // Load active grading scheme
  const { data: gradingSchemes = [] } = useGradingSchemes();
  const activeScheme = gradingSchemes.find((s: any) => s.is_active);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Result | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState(0);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");

  // ── Export-all-classes Excel state ─────────────────────────────────────────
  // True while the "Export Excel" button is fetching results for classes 6–10
  // and building the workbook. Used to disable the button + show a spinner so
  // the admin can't trigger two parallel exports and download a half-built file.
  const [exporting, setExporting] = useState(false);

  // ── Export ALL classes (6–10) to a single multi-sheet .xlsx workbook ───────
  //
  // Why this lives here (and not in a sub-tab): the old "Compare Exams" sub-tab
  // was a per-class chart view. The replacement is a one-click ACTION that
  // exports every class at once, so it's a button in the same row as the
  // Results/Analytics/DMCs sub-tabs — not a sub-tab itself.
  //
  // Output shape:
  //   - One workbook, .xlsx
  //   - First sheet: "Top Performers Summary" — top 3 students of each class
  //     sorted by percentage desc. Lets the admin see the school-wide toppers
  //     at a glance without flipping through 5 sheets.
  //   - Then one sheet per class: "Class 6", "Class 7", ... "Class 10"
  //     Each row = one student, sorted by percentage desc. Columns:
  //       Rank | Position | Roll No | Exam Roll No | Student Name |
  //       <Subject1> (Obt) | <Subject1> (Total) | <Subject2> (Obt) | ... |
  //       Total Obtained | Total Marks | Percentage | Grade | Status | Remarks
  //
  // Notes on subject handling:
  //   - SUBJECTS_6_TO_8 and SUBJECTS_9_TO_10 have different subject sets, so
  //     each class sheet's columns match that class's subjects (not a single
  //     shared superset — that would leave ugly blank columns for the wrong
  //     class group).
  //   - subject_marks is a JSONB column keyed by subject name with
  //     {obtained, total, included}. Rows where subject_marks is null (e.g.
  //     CSV-imported rows that only have aggregate totals) get blank cells
  //     for each subject — the totals columns still carry the real numbers.
  //
  // Notes on exam-type matching:
  //   - Classes 6–8 use exam types ["1st Semester", "2nd Semester"].
  //   - Classes 9–10 use ["Annual-I", "Annual-II"].
  //   - The admin clicks "Export Excel" from whatever class+exam is currently
  //     selected. To give a true "all classes" export we map the currently
  //     selected exam type to its nearest equivalent for each class:
  //       * If the current examType is valid for a class → use it.
  //       * Otherwise fall back to that class's first exam type.
  //     This means: if the admin is on Class 6 → "1st Semester", classes 6–8
  //     get "1st Semester" and classes 9–10 get "Annual-I" (their first slot).
  //
  // Rank vs Position:
  //   - `position` = the student's standing WITHIN their own class, computed
  //     live by sorting that class's (deduplicated) rows by percentage desc.
  //     This is always a clean 1..N number per class, regardless of whatever
  //     may or may not be stored in the DB's `position` column.
  //   - `rank` = the student's standing across the WHOLE SCHOOL — every class
  //     combined — again by percentage desc. Computed once up front (see
  //     schoolWideRankByStudentId below) so every class sheet can look up
  //     the correct whole-school number per student.
  //   Both are freshly computed from live data on every export, so they're
  //   always internally consistent and never rely on a stale/null DB value.
  const handleExportAllClassesExcel = async () => {
    setExporting(true);
    const toastId = toast.loading("Fetching results for all classes (6–10)...");
    try {
      // Pick the matching exam_type for each class based on the currently
      // selected examType. Falls back to the class's first exam type if the
      // current selection isn't valid for that class (e.g. "Annual-I" can't
      // apply to class 6 — class 6 doesn't have Annual-I, so use "1st Semester").
      const examTypePerClass: Record<string, string> = {};
      for (const c of classes) {
        const valid = getExamTypes(c);
        examTypePerClass[c] = valid.includes(examType) ? examType : valid[0];
      }

      // Parallel fetch — one supabase call per class.
      const fetches = classes.map(async (c) => {
        const { data, error } = await supabase
          .from("results")
          .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, exam_roll_no, manual_pass_fail, created_at, subject_marks, students(full_name, roll_number, photo_url)")
          .eq("class", c)
          .eq("exam_type", examTypePerClass[c])
          .eq("year", year)
          .order("percentage", { ascending: false });
        if (error) throw error;
        return (data ?? []) as unknown as Result[];
      });
      const perClassArrays = await Promise.all(fetches);
      const allResults = perClassArrays.flat();

      if (allResults.length === 0) {
        toast.error(`No results found for year ${year} (exam types: ${classes.map(c => `Class ${c}→${examTypeLabel(examTypePerClass[c])}`).join(", ")})`, { id: toastId });
        setExporting(false);
        return;
      }

      // ── Styling palette (used across every sheet) ──────────────────────
      const COLOR = {
        headerBg: "FF1F4E78",     // deep blue banner behind school title
        headerText: "FFFFFFFF",
        subHeaderBg: "FF2E75B6",  // slightly lighter blue for column headers
        subHeaderText: "FFFFFFFF",
        zebra: "FFF2F7FC",        // faint blue for alternating rows
        white: "FFFFFFFF",
        passBg: "FFDFF5E1",       // soft green
        failBg: "FFFCE1E1",       // soft red
        failText: "FFB00020",
        top1Bg: "FFFFE08A",       // gold
        top2Bg: "FFE3E3E3",       // silver
        top3Bg: "FFE9C08A",       // bronze
        border: "FFB9C6D4",
      } as const;

      const thinBorder = {
        top: { style: "thin" as const, color: { argb: COLOR.border } },
        left: { style: "thin" as const, color: { argb: COLOR.border } },
        bottom: { style: "thin" as const, color: { argb: COLOR.border } },
        right: { style: "thin" as const, color: { argb: COLOR.border } },
      };

      const ExcelJSMod: any = await import("exceljs");
      const ExcelJS = ExcelJSMod.default ?? ExcelJSMod;
      const wb = new ExcelJS.Workbook();
      wb.creator = "GHS Babi Khel";
      wb.created = new Date();

      // ── Whole-school ranking ────────────────────────────────────────────
      // "Position" = a student's rank WITHIN their own class (by %).
      // "Rank"     = a student's rank across the WHOLE SCHOOL, all classes
      //              combined (by %). These are two different numbers and
      //              were previously both being filled with the same
      //              per-class value — this pass computes the school-wide
      //              number once, up front, so every class sheet below can
      //              look up the correct whole-school rank per student.
      //
      // Dedup first (same rule as the per-class dedup below: keep the
      // higher-percentage row per student, or the more recent one on a
      // tie), then sort everyone — across every class — by percentage.
      const schoolWideSeen = new Map<string, Result>();
      for (const r of allResults) {
        const existing = schoolWideSeen.get(r.student_id);
        if (!existing) {
          schoolWideSeen.set(r.student_id, r);
        } else if (r.percentage > existing.percentage ||
                   (r.percentage === existing.percentage && r.created_at > existing.created_at)) {
          schoolWideSeen.set(r.student_id, r);
        }
      }
      const schoolWideRanked = Array.from(schoolWideSeen.values())
        .sort((a, b) => b.percentage - a.percentage);
      const schoolWideRankByStudentId = new Map<string, number>();
      schoolWideRanked.forEach((r, i) => {
        schoolWideRankByStudentId.set(r.student_id, i + 1);
      });

      // Collect top 3 of every class for the summary sheet, built after all
      // class sheets exist below.
      const summaryRows: {
        cls: string; rank: number; name: string; roll: string; examRoll: string;
        obtained: number; total: number; percentage: number; grade: string; status: "Pass" | "Fail";
      }[] = [];

      // ── One sheet per class ────────────────────────────────────────────
      for (const c of classes) {
        // Deduplicate same-student rows: keep the one with the higher
        // percentage, or — when tied — the one created later.
        const seen = new Map<string, Result>();
        for (const r of perClassArrays.find(arr => arr.length && arr[0].class === c) ?? []) {
          const existing = seen.get(r.student_id);
          if (!existing) {
            seen.set(r.student_id, r);
          } else if (r.percentage > existing.percentage ||
                     (r.percentage === existing.percentage && r.created_at > existing.created_at)) {
            seen.set(r.student_id, r);
          }
        }
        const ranked = Array.from(seen.values())
          .sort((a, b) => b.percentage - a.percentage)
          .map((r, i) => ({ r, position: i + 1 }));

        if (ranked.length === 0) continue;

        const subjects = getSubjects(c);
        const examLabel = examTypePerClass[c];
        const sheetName = `Class ${c}`.slice(0, 31);
        const ws = wb.addWorksheet(sheetName, {
          views: [{ state: "frozen", xSplit: 5, ySplit: 3 }],
          pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        });

        const headers = [
          "Rank", "Position", "Roll No", "Exam Roll No", "Student Name",
          ...subjects,
          "Total\nObtained", "Total\nMarks", "Percentage", "Grade", "Status", "Remarks",
        ];
        const colCount = headers.length;

        // Row 1: school + class banner, merged across every column.
        ws.mergeCells(1, 1, 1, colCount);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `GHS Babi Khel  —  Class ${c}  —  ${examLabel}  —  Year ${year}`;
        titleCell.font = { bold: true, size: 14, color: { argb: COLOR.headerText } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
        ws.getRow(1).height = 28;

        // Row 2: generated-on subtitle, merged.
        ws.mergeCells(2, 1, 2, colCount);
        const subtitleCell = ws.getCell(2, 1);
        subtitleCell.value = `${ranked.length} student${ranked.length === 1 ? "" : "s"}  •  Generated ${new Date().toLocaleDateString()}`;
        subtitleCell.font = { italic: true, size: 10, color: { argb: "FF555555" } };
        subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(2).height = 18;

        // Row 3: column headers.
        const headerRow = ws.getRow(3);
        headerRow.values = headers;
        headerRow.height = 32;
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, size: 10, color: { argb: COLOR.subHeaderText } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.subHeaderBg } };
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.border = thinBorder;
        });

        // Data rows.
        ranked.forEach(({ r, position }, i) => {
          const sm = (r as any).subject_marks as
            | Record<string, { obtained: number; total: number; included?: boolean }>
            | null;
          // One cell per subject, formatted as "obtained/total" (e.g. "45/75")
          // instead of two separate Obt/Total columns — halves the subject
          // column count and keeps the sheet readable at a glance.
          const subjectCells: string[] = subjects.map((s) => {
            if (sm && sm[s] && typeof sm[s].obtained === "number") {
              return `${sm[s].obtained}/${sm[s].total}`;
            }
            return "";
          });
          const status: "Pass" | "Fail" = r.is_pass ? "Pass" : "Fail";
          // Compute the percentage fresh from obtained/total marks rather
          // than trusting the stored r.percentage field's scale (it's
          // supposed to be a plain 0-100 number, but some rows were showing
          // up as a fraction, which combined with the "/100 for numFmt"
          // step below produced results like "0.4%" instead of "59.3%").
          // Recalculating here guarantees the exported percentage is always
          // correct regardless of how the DB value was stored.
          const pctFraction = r.total_marks > 0 ? r.obtained_marks / r.total_marks : 0;
          // Whole-school rank (all classes combined, by %) — looked up from
          // the map built once above, NOT the per-class "position" number.
          const schoolRank = schoolWideRankByStudentId.get(r.student_id) ?? position;
          const rowValues = [
            schoolRank,
            position,
            r.students?.roll_number || "",
            r.exam_roll_no || "",
            r.students?.full_name || "",
            ...subjectCells,
            r.obtained_marks,
            r.total_marks,
            // "0.0%" numFmt multiplies the underlying fraction by 100 for
            // display, so 0.593 → "59.3%". pctFraction is always a true
            // 0-1 fraction since we compute it directly from marks above.
            pctFraction,
            r.grade || "",
            status,
            r.remarks || "",
          ];
          const excelRow = ws.addRow(rowValues);
          excelRow.height = 20;

          // Medal colors reflect standing WITHIN the class (Position),
          // since that's the number parents/teachers care about on a
          // per-class sheet — a student ranked #1 in their class should be
          // gold here even if their whole-school Rank number is higher.
          const rankBg = position === 1 ? COLOR.top1Bg : position === 2 ? COLOR.top2Bg : position === 3 ? COLOR.top3Bg : null;
          const zebraBg = i % 2 === 1 ? COLOR.zebra : COLOR.white;

          excelRow.eachCell((cell, colNumber) => {
            cell.border = thinBorder;
            cell.alignment = { horizontal: colNumber === 5 ? "left" : "center", vertical: "middle" };
            // Rank/Position columns get medal colors for top 3; everything
            // else gets the plain zebra stripe so the medal highlight reads
            // as a clear "this student placed" cue without recoloring the
            // whole row (which would fight with the pass/fail color).
            if (colNumber <= 2 && rankBg) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rankBg } };
              cell.font = { bold: true };
            } else {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebraBg } };
            }
          });

          // Column layout: 5 fixed leading columns (Rank, Position, Roll No,
          // Exam Roll No, Student Name) + one column per subject + 6 fixed
          // trailing columns (Total Obtained, Total Marks, Percentage,
          // Grade, Status, Remarks). Computing these indices from the actual
          // layout (instead of hardcoded arithmetic) avoids them silently
          // going stale if the column layout changes again later — that
          // exact mismatch (leftover "×2" math from the old two-columns-per
          // -subject layout) was the root cause of the wrong "0.4%" bug.
          const leadingCols = 5;
          const totalObtainedCol = leadingCols + subjects.length + 1;
          const percentageCol = totalObtainedCol + 2;
          const statusCol = totalObtainedCol + 4;

          // Percentage column as a real percent number format.
          const pctCell = excelRow.getCell(percentageCol);
          pctCell.numFmt = "0.0%";

          // Status column: green for Pass, red for Fail.
          const statusCell = excelRow.getCell(statusCol);
          statusCell.font = {
            bold: true,
            color: { argb: status === "Pass" ? "FF1B7A2E" : COLOR.failText },
          };
          statusCell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: status === "Pass" ? COLOR.passBg : COLOR.failBg },
          };
        });

        // Column widths.
        const widths = [
          6, 8, 10, 14, 24,
          ...subjects.map(() => 12),
          12, 10, 11, 8, 8, 26,
        ];
        widths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w; });

        ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };

        // Collect top 3 (by class position) for the summary sheet.
        ranked.slice(0, 3).forEach(({ r, position }) => {
          summaryRows.push({
            cls: `Class ${c}`,
            rank: position,
            name: r.students?.full_name || "",
            roll: r.students?.roll_number || "",
            examRoll: r.exam_roll_no || "",
            obtained: r.obtained_marks,
            total: r.total_marks,
            // True 0-1 fraction, computed directly from marks (see note
            // above about not trusting the stored percentage field's scale).
            percentage: r.total_marks > 0 ? r.obtained_marks / r.total_marks : 0,
            grade: r.grade || "",
            status: r.is_pass ? "Pass" : "Fail",
          });
        });
      }

      // ── Summary sheet, inserted FIRST so it opens as the cover page ────
      if (summaryRows.length > 0) {
        const summaryWs = wb.addWorksheet("Top Performers Summary", {
          views: [{ state: "frozen", xSplit: 0, ySplit: 3 }],
        }, );
        // Move it to index 0 — ExcelJS worksheets are ordered by insertion,
        // so we reorder the underlying array after adding.
        wb.worksheets.splice(wb.worksheets.length - 1, 1);
        wb.worksheets.unshift(summaryWs);

        const headers = ["Class", "Rank", "Student Name", "Roll No", "Exam Roll No", "Obtained", "Total", "Percentage", "Grade", "Status"];
        const colCount = headers.length;

        summaryWs.mergeCells(1, 1, 1, colCount);
        const titleCell = summaryWs.getCell(1, 1);
        titleCell.value = `GHS Babi Khel  —  Top Performers Summary  —  Year ${year}`;
        titleCell.font = { bold: true, size: 14, color: { argb: COLOR.headerText } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.headerBg } };
        summaryWs.getRow(1).height = 28;

        summaryWs.mergeCells(2, 1, 2, colCount);
        const subtitleCell = summaryWs.getCell(2, 1);
        subtitleCell.value = `Top 3 students of every class, ${classes[0]}–${classes[classes.length - 1]}  •  Generated ${new Date().toLocaleDateString()}`;
        subtitleCell.font = { italic: true, size: 10, color: { argb: "FF555555" } };
        subtitleCell.alignment = { horizontal: "center", vertical: "middle" };
        summaryWs.getRow(2).height = 18;

        const headerRow = summaryWs.getRow(3);
        headerRow.values = headers;
        headerRow.height = 24;
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, size: 10, color: { argb: COLOR.subHeaderText } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.subHeaderBg } };
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
          cell.border = thinBorder;
        });

        summaryRows.forEach((row, i) => {
          const excelRow = summaryWs.addRow([
            row.cls, row.rank, row.name, row.roll, row.examRoll,
            row.obtained, row.total, row.percentage, row.grade, row.status,
          ]);
          excelRow.height = 20;
          const rankBg = row.rank === 1 ? COLOR.top1Bg : row.rank === 2 ? COLOR.top2Bg : row.rank === 3 ? COLOR.top3Bg : null;
          const zebraBg = i % 2 === 1 ? COLOR.zebra : COLOR.white;

          excelRow.eachCell((cell, colNumber) => {
            cell.border = thinBorder;
            cell.alignment = { horizontal: colNumber === 3 ? "left" : "center", vertical: "middle" };
            if (colNumber === 2 && rankBg) {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rankBg } };
              cell.font = { bold: true };
            } else {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebraBg } };
            }
          });

          excelRow.getCell(8).numFmt = "0.0%";
          const statusCell = excelRow.getCell(10);
          statusCell.font = { bold: true, color: { argb: row.status === "Pass" ? "FF1B7A2E" : COLOR.failText } };
          statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.status === "Pass" ? COLOR.passBg : COLOR.failBg } };
        });

        [10, 6, 26, 10, 14, 11, 10, 12, 8, 8].forEach((w, idx) => { summaryWs.getColumn(idx + 1).width = w; });
        summaryWs.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: colCount } };
      }

      // Filename: results-all-classes-<year>-<ISO date>.xlsx
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `results-all-classes-${year}-${today}.xlsx`;

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`✅ Exported ${allResults.length} results across ${classes.length} classes → ${fileName}`, { id: toastId });
    } catch (err) {
      console.error("[Export Excel] failed:", err);
      toast.error("Failed to export Excel: " + (err as Error).message, { id: toastId });
    } finally {
      setExporting(false);
    }
  };

  // ── Global Schedule-Publish modal state ─────────────────────────────────────
  // Replaces the old per-class-tab "Schedule Publish" button. Now there is
  // ONE button (next to the DMCs sub-tab) that opens a modal where the admin
  // picks which classes (6–10) to schedule, plus a date & time, for the
  // CURRENT exam type + year. This matches how results are actually
  // published in practice (all classes together) and is far less fiddly on
  // mobile than re-opening a panel on every class tab.
  const [showGlobalSchedule, setShowGlobalSchedule] = useState(false);
  const [gsClasses, setGsClasses] = useState<string[]>(["6", "7", "8", "9", "10"]);

  // ── Bulk delete (delete ALL results for one or more classes, for the
  //    currently selected year) — used when new results are about to
  //    replace old ones and the old class-wide data needs clearing first. ──
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bdClasses, setBdClasses] = useState<string[]>([]);
  const [bdDeleting, setBdDeleting] = useState(false);
  const [gsDate, setGsDate] = useState("");
  const [gsTime, setGsTime] = useState("08:00");
  const [gsSaving, setGsSaving] = useState(false);
  // When checked, the top 3 (by percentage) of EACH selected class are left
  // unpublished — everyone else in that class publishes normally. Toppers
  // can then be revealed later via a separate publish for just those rows.
  const [gsHideTop3, setGsHideTop3] = useState(false);

  // ── Unpublish (from the same Schedule Publish modal) ────────────────────────
  // Lets the admin take ALREADY-PUBLISHED results for the selected classes
  // back offline (is_published -> false) without deleting anything. After an
  // unpublish the rows are unpublished AND have no publish_at, so the admin
  // can freely re-schedule them again via the normal Publish button above.
  const [gsUnpublishing, setGsUnpublishing] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    student_id: "",
    student_name_manual: "",   // ✅ Manual name input
    total_marks: 100,
    obtained_marks: 0,
    remarks: "",
    exam_roll_no: "",          // ✅ Exam roll number field
    manual_pass_fail: null as boolean | null,  // ✅ null = auto, true/false = manual
    use_manual_pass: false,    // toggle for manual pass/fail
  });

  const setF = (k: string, v: any) => setForm(p => ({ ...p, [k]: v }));

  // Holds all exam roll numbers on record for the currently-selected student
  // (across every generated session), so the admin can pick the correct one
  // when more than one exists, instead of it being silently auto-chosen.
  const [availableRollsForStudent, setAvailableRollsForStudent] = useState<ExamRollEntry[]>([]);

  const [subjectMarks, setSubjectMarks] = useState<Record<string, { obtained: number; total: number; included: boolean; touched?: boolean }>>({});

  const initSubjectMarks = (cls: string) => {
    const subjects = getSubjects(cls);
    const init: Record<string, { obtained: number; total: number; included: boolean; touched?: boolean }> = {};
    subjects.forEach(s => { init[s] = { obtained: 0, total: DEFAULT_SUBJECT_MAX, included: true, touched: false }; });
    setSubjectMarks(init);
    // Recompute totals from only-included subjects
    const totalMax = Object.values(init).filter(m => m.included).reduce((s, m) => s + m.total, 0);
    const totalObtained = Object.values(init).filter(m => m.included).reduce((s, m) => s + m.obtained, 0);
    setForm(p => ({ ...p, total_marks: totalMax, obtained_marks: totalObtained }));
  };

  const setSubjectMark = (subject: string, field: "obtained" | "total", value: number) => {
    setSubjectMarks(prev => {
      const updated = { ...prev, [subject]: { ...prev[subject], [field]: value, ...(field === "obtained" ? { touched: true } : {}) } };
      const totalMax = Object.values(updated).filter(m => m.included).reduce((s, m) => s + m.total, 0);
      const totalObtained = Object.values(updated).filter(m => m.included).reduce((s, m) => s + m.obtained, 0);
      setForm(p => ({ ...p, total_marks: totalMax, obtained_marks: totalObtained }));
      return updated;
    });
  };

  // Toggle whether a subject/paper counts toward the total — use this when a
  // paper hasn't been given/skipped yet so it doesn't inflate the grand total.
  const toggleSubjectIncluded = (subject: string, included: boolean) => {
    setSubjectMarks(prev => {
      const updated = { ...prev, [subject]: { ...prev[subject], included } };
      const totalMax = Object.values(updated).filter(m => m.included).reduce((s, m) => s + m.total, 0);
      const totalObtained = Object.values(updated).filter(m => m.included).reduce((s, m) => s + m.obtained, 0);
      setForm(p => ({ ...p, total_marks: totalMax, obtained_marks: totalObtained }));
      return updated;
    });
  };

  const handleClassChange = (c: string) => {
    setCls(c);
    setExamType(getExamTypes(c)[0]);
    initSubjectMarks(c);
  };

  // ── Fetch students of selected class ────────────────────────────────────────
  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ["admin-students-list", cls],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, roll_number, photo_url")
        .eq("class", cls).eq("is_active", true).order("roll_number");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch exam roll numbers for selected class (from all published sessions) ──
  const { data: examRolls = [] } = useQuery<ExamRollEntry[]>({
    queryKey: ["exam-rolls-for-class", cls],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_roll_numbers")
        .select("id, student_id, exam_roll_no, student_name, class, session_id, exam_roll_sessions(exam_year, exam_term, created_at, is_published)")
        .eq("class", cls)
        .order("exam_roll_no", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExamRollEntry[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Sort each student's roll numbers by session recency (latest published
  // session first) so that when a student has multiple exam roll numbers
  // from different "Generate Exam Roll Numbers" runs, we auto-fill the
  // most recent published one — not just whichever sorts first alphabetically.
  const examRollsForStudent = useCallback((studentId: string) => {
    return examRolls
      .filter(r => r.student_id === studentId)
      .sort((a, b) => {
        const aPub = a.exam_roll_sessions?.is_published ? 1 : 0;
        const bPub = b.exam_roll_sessions?.is_published ? 1 : 0;
        if (aPub !== bPub) return bPub - aPub; // published sessions first
        const aTime = a.exam_roll_sessions?.created_at || "";
        const bTime = b.exam_roll_sessions?.created_at || "";
        return bTime.localeCompare(aTime); // newest first
      });
  }, [examRolls]);

  // ── Fetch results ────────────────────────────────────────────────────────────
  const queryKey = ["admin-results", cls, examType, year];
  const { data: results = [], isLoading } = useQuery<Result[]>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("results")
        // ⚠️ `subject_marks` MUST be in this select list. Previously it was
        // missing, so when the admin clicked "Edit" on an existing result,
        // `r.subject_marks` was undefined and openEdit() fell through to
        // initSubjectMarks(r.class) — which initializes every subject to
        // {obtained:0, total:75, included:true, touched:false}. The form's
        // obtained_marks/total_marks are loaded from the saved DB row, so
        // they still showed the real totals (e.g. 325/750), but the
        // per-subject inputs appeared empty. The moment the admin saved
        // (even just to fix remarks), all 10 default 0/75 entries were
        // written back to the DB, wiping the real per-subject data while
        // the totals stayed correct — exactly the "0/75 for every subject"
        // bug seen on the User Dashboard Result Card.
        .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, exam_roll_no, manual_pass_fail, created_at, is_published, publish_at, subject_marks, students(full_name, roll_number, photo_url)")
        .eq("class", cls).eq("exam_type", examType).eq("year", year)
        .order("percentage", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Result[];
    },
    staleTime: 10 * 60 * 1000,
  });

  // ── Ranked + filtered results (deduplicated) ────────────────────────────────
  const rankedResults = useMemo(() => {
    // Deduplicate: if same student appears more than once, keep the latest (highest id)
    const seen = new Map<string, typeof results[0]>();
    for (const r of results) {
      if (!seen.has(r.student_id)) {
        seen.set(r.student_id, r);
      } else {
        // Keep whichever was created later (or has higher percentage)
        const existing = seen.get(r.student_id)!;
        if (r.percentage > existing.percentage || r.created_at > existing.created_at) {
          seen.set(r.student_id, r);
        }
      }
    }
    const deduped = Array.from(seen.values())
      .sort((a, b) => b.percentage - a.percentage);

    const filtered = search
      ? deduped.filter(r =>
          r.students?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.students?.roll_number?.toLowerCase().includes(search.toLowerCase()) ||
          r.exam_roll_no?.includes(search)
        )
      : deduped;
    return filtered.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [results, search]);

  // ── Auto-calc percentage + grade ────────────────────────────────────────────
  const pct = form.total_marks > 0
    ? Math.round((form.obtained_marks / form.total_marks) * 100)
    : 0;
  const autoGrade = getGradeFromPercentage(pct);
  const passThreshold = getPassThreshold();
  const autoPass = pct >= passThreshold;
  // Final pass/fail: manual override wins if toggled ON
  const finalPass = form.use_manual_pass
    ? (form.manual_pass_fail ?? autoPass)
    : autoPass;

  // ── When student selected from dropdown → auto-fill exam roll ──────────────
  const handleStudentSelect = (studentId: string) => {
    setF("student_id", studentId);
    // If this student has multiple exam roll numbers, let the admin choose
    // instead of silently picking one for them.
    const rolls = examRollsForStudent(studentId);
    setAvailableRollsForStudent(rolls);
    if (rolls.length > 0) {
      setF("exam_roll_no", rolls[0].exam_roll_no);
    } else {
      setF("exam_roll_no", "");
    }
    // Auto-fill student name
    const student = students.find(s => s.id === studentId);
    if (student) {
      setF("student_name_manual", student.full_name);
    }
  };

  // ── When exam roll typed manually → auto-fill student ──────────────────────
  const handleExamRollInput = (val: string) => {
    setF("exam_roll_no", val);
    const roll = examRolls.find(r => r.exam_roll_no === val);
    if (roll) {
      setF("student_name_manual", roll.student_name);
      const student = students.find(s => s.id === roll.student_id);
      if (student) setF("student_id", student.id);
    }
  };

  // ── Open modals ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    initSubjectMarks(cls);
    setAvailableRollsForStudent([]);
    setForm({
      student_id: "", student_name_manual: "",
      total_marks: 100, obtained_marks: 0, remarks: "",
      exam_roll_no: "", manual_pass_fail: null, use_manual_pass: false,
    });
    setModalOpen(true);
  };

  const openEdit = (r: Result) => {
    setEditing(r);
    setAvailableRollsForStudent(examRollsForStudent(r.student_id));
    if ((r as any).subject_marks && typeof (r as any).subject_marks === "object") {
      const loaded = (r as any).subject_marks as Record<string, { obtained: number; total: number; included?: boolean }>;
      const withIncluded: Record<string, { obtained: number; total: number; included: boolean; touched?: boolean }> = {};
      Object.entries(loaded).forEach(([k, v]) => {
        withIncluded[k] = { obtained: v.obtained, total: v.total, included: v.included !== false, touched: true };
      });
      setSubjectMarks(withIncluded);
    } else {
      initSubjectMarks(r.class);
    }
    setForm({
      student_id: r.student_id,
      student_name_manual: r.students?.full_name || "",
      total_marks: r.total_marks,
      obtained_marks: r.obtained_marks,
      remarks: r.remarks || "",
      exam_roll_no: r.exam_roll_no || "",
      manual_pass_fail: r.manual_pass_fail ?? null,
      use_manual_pass: r.manual_pass_fail !== null,
    });
    setModalOpen(true);
  };

  // ── Save result ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.student_id && !form.student_name_manual.trim()) {
      toast.error("Select a student or enter a student name");
      return;
    }
    setSaving(true);

    const percentage = form.total_marks > 0
      ? Math.round((form.obtained_marks / form.total_marks) * 100)
      : 0;
    const g = getGradeFromPercentage(percentage);
    const pt = getPassThreshold();
    const isPass = form.use_manual_pass
      ? (form.manual_pass_fail ?? percentage >= pt)
      : percentage >= pt;

    // If no student_id but name given, try to find by name
    let studentId = form.student_id;
    if (!studentId && form.student_name_manual) {
      const match = students.find(s =>
        s.full_name.toLowerCase() === form.student_name_manual.toLowerCase()
      );
      if (match) studentId = match.id;
    }

    if (!studentId) {
      toast.error("Could not find student. Please select from the dropdown.");
      setSaving(false);
      return;
    }

    const payload = {
      student_id: studentId,
      class: cls,
      exam_type: examType,
      year,
      total_marks: form.total_marks,
      obtained_marks: form.obtained_marks,
      percentage,
      grade: g,
      is_pass: isPass,
      remarks: form.remarks || null,
      exam_roll_no: form.exam_roll_no.trim() || null,
      manual_pass_fail: form.use_manual_pass ? (form.manual_pass_fail ?? null) : null,
      subject_marks: (() => {
        // Only save subjects the admin actually touched. This prevents a
        // subtle data-loss bug: when openEdit() loads a result whose
        // subject_marks is null (e.g. CSV-imported rows), initSubjectMarks()
        // seeds every subject with {obtained:0, total:75, touched:false}. If
        // the admin then saves without typing any per-subject marks, the old
        // code wrote all 10 default 0/75 entries to the DB — silently
        // overwriting the real totals with zeros on the public Result Card.
        // Filtering by `touched` means: untouched defaults are dropped, real
        // edits are kept, and existing loaded subject_marks (which openEdit
        // marks as touched:true) are preserved on save even if the admin
        // doesn't re-type them.
        const touched = Object.fromEntries(
          Object.entries(subjectMarks)
            .filter(([, m]) => m.included && m.touched)
            .map(([k, m]) => [k, { obtained: m.obtained, total: m.total }])
        );
        return Object.keys(touched).length > 0 ? touched : null;
      })(),
    };

    let error: any = null;
    if (editing) {
      const res = await supabase.from("results").update(payload).eq("id", editing.id);
      error = res.error;
    } else {
      // Check if result already exists for this student+class+examType+year
      const { data: existing } = await supabase
        .from("results")
        .select("id")
        .eq("student_id", studentId)
        .eq("class", cls)
        .eq("exam_type", examType)
        .eq("year", year)
        .maybeSingle();
      if (existing) {
        toast.error("Result already exists for this student. Use the Edit (✏️) button to update it.");
        setSaving(false);
        return;
      }
      // Use upsert to prevent duplicates — if same student+class+examType+year exists, update it
      const res = await supabase.from("results").upsert(payload, {
        onConflict: "student_id,class,exam_type,year",
        ignoreDuplicates: false,
      });
      error = res.error;
    }

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editing ? "Result updated!" : "Result added! 🎉");
      triggerConfetti("burst");
      qc.invalidateQueries({ queryKey });
      setModalOpen(false);
    }
    setSaving(false);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("results").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey }); },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PAPER-RESULT CSV IMPORT
  // ──────────────────────────────────────────────────────────────────────────
  // The school writes each class result on paper (name, class roll no, marks
  // per subject, total, %, status). That sheet is typed into a CSV and
  // imported here. Three rules make this safe:
  //
  //  1. EXAM TITLE comes from the screen, never from the CSV. The Class tab +
  //     Semester/Annual tab + Year box you have selected IS the exam. The
  //     preview dialog repeats it so you can confirm before saving.
  //  2. STUDENT IDENTITY = Class + Class Roll No. Roll 1 of Class 6 and roll 1
  //     of Class 7 never clash because we only look inside the selected
  //     class. Two students with the same name are told apart by roll no.
  //     Name is only a cross-check (or a fallback when roll no is missing and
  //     the name is unique inside the class).
  //  3. EXAM ROLL NO is optional. If the student has one (exam_roll_numbers)
  //     it is filled automatically; if not, the result is still saved and the
  //     public page finds it by Class + Class Roll No.
  // ══════════════════════════════════════════════════════════════════════════
  const resolveExamRoll = useCallback((studentId: string): string | null => {
    const rolls = examRollsForStudent(studentId);
    const exact = rolls.find(r =>
      r.exam_roll_sessions?.exam_year === year && r.exam_roll_sessions?.exam_term === examType);
    return (exact ?? rolls[0])?.exam_roll_no ?? null;
  }, [examRollsForStudent, year, examType]);

  const downloadCSVTemplate = () => {
    // Pre-filled sheet: every ACTIVE student of the selected class, already
    // sorted by class roll no. The teacher only types marks beside each name.
    const subjects = getSubjects(cls);
    const header = ["class_roll_number", "student_name", ...subjects, "total_marks", "obtained_marks", "percentage", "status", "remarks"];
    const lines = [header];
    const sorted = [...students].sort((a, b) =>
      a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }));
    for (const s of sorted) {
      lines.push([s.roll_number, s.full_name, ...subjects.map(() => ""), "", "", "", "", ""]);
    }
    if (sorted.length === 0) {
      lines.push(["1", "Example Student", ...subjects.map(() => "60"), "", "", "", "Pass", ""]);
    }
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = "\uFEFF" + lines.map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `class-${cls}-${examTypeLabel(examType).replace(/\s+/g, "-")}-${year}-sheet.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Class ${cls} sheet downloaded — fill marks and import`);
  };

  const handleCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const rows = parseCSVRows(text);
      if (rows.length < 2) { toast.error("CSV is empty"); return; }

      const headers = rows[0].map(normHeader);
      const find = (aliases: string[]) => headers.findIndex(h => aliases.includes(h));
      const rollIdx = find(["classrollnumber", "classrollno", "classroll", "rollnumber", "rollno", "roll"]);
      const nameIdx = find(["studentname", "name", "student"]);
      const examRollIdx = find(["examrollnumber", "examrollno", "examroll"]);
      const totalIdx = find(["totalmarks", "total", "grandtotal", "maxmarks"]);
      const obtIdx = find(["obtainedmarks", "obtained", "marksobtained", "totalobtained"]);
      const pctIdx = find(["percentage", "percent", "pct"]);
      const statusIdx = find(["status", "result", "passfail"]);
      const remarksIdx = find(["remarks", "remark", "note", "notes"]);
      const subMaxIdx = find(["subjecttotal", "subjectmax", "submax"]);

      const subjects = getSubjects(cls);
      const subjectCols: { subject: string; idx: number }[] = [];
      headers.forEach((h, idx) => {
        const subject = matchSubject(h, subjects);
        if (subject && !subjectCols.some(c => c.subject === subject)) subjectCols.push({ subject, idx });
      });

      if (rollIdx === -1 && nameIdx === -1) {
        toast.error("CSV needs a class_roll_number column (or student_name)."); return;
      }
      if (subjectCols.length === 0 && (totalIdx === -1 || obtIdx === -1)) {
        toast.error("CSV needs subject columns, or total_marks + obtained_marks."); return;
      }

      const out: ImportRow[] = [];
      const usedStudent = new Map<string, number>();
      const dataRows = rows.slice(1);

      dataRows.forEach((raw, n) => {
        const cols = raw.map(c => c.trim());
        const line = n + 2;
        const rollNo = rollIdx !== -1 ? (cols[rollIdx] || "") : "";
        const name = nameIdx !== -1 ? (cols[nameIdx] || "") : "";
        const errors: string[] = [];
        const warnings: string[] = [];

        // ── 1. Find the student INSIDE the selected class ───────────────
        let student: Student | null = null;
        let nameMismatch = false;
        const byRoll = rollNo ? students.filter(s => normRoll(s.roll_number) === normRoll(rollNo)) : [];
        const nName = normName(name);
        const byName = nName ? students.filter(s => normName(s.full_name) === nName) : [];

        if (byRoll.length === 1) {
          student = byRoll[0];
          if (name && nameSimilarity(name, student.full_name) < 0.34) nameMismatch = true;
        } else if (byRoll.length > 1) {
          const tie = byRoll.filter(s => nameSimilarity(name, s.full_name) >= 0.5);
          if (tie.length === 1) student = tie[0];
          else errors.push(`Roll ${rollNo} is shared by ${byRoll.length} students in Class ${cls}. Fix the roll numbers in Students.`);
        } else if (rollNo && byName.length === 1) {
          student = byName[0];
          warnings.push(`Roll ${rollNo} not found in Class ${cls}; matched by name to roll ${student.roll_number}.`);
        } else if (!rollNo && byName.length === 1) {
          student = byName[0];
          warnings.push("No roll no. in file; matched by unique name.");
        } else if (!rollNo && byName.length > 1) {
          errors.push(`${byName.length} students named "${name}" in Class ${cls}. Add their class_roll_number.`);
        } else {
          const best = nName
            ? students.map(s => ({ s, sim: nameSimilarity(name, s.full_name) })).sort((a, b) => b.sim - a.sim)[0]
            : null;
          errors.push(rollNo
            ? `Roll ${rollNo} not found in Class ${cls}.${best && best.sim >= 0.6 ? ` Did you mean ${best.s.full_name} (roll ${best.s.roll_number})?` : ""}`
            : `Student "${name || "?"}" not found in Class ${cls}.`);
        }

        if (student) {
          const prev = usedStudent.get(student.id);
          if (prev) errors.push(`Same student already on line ${prev}.`);
          else usedStudent.set(student.id, line);
        }

        // ── 2. Marks: per-subject columns win, else totals ──────────────
        const subMax = subMaxIdx !== -1 && Number(cols[subMaxIdx]) > 0 ? Number(cols[subMaxIdx]) : DEFAULT_SUBJECT_MAX;
        let total = 0; let obtained = 0;
        let subjectMarks: Record<string, { obtained: number; total: number }> | null = null;

        if (subjectCols.length > 0) {
          const sm: Record<string, { obtained: number; total: number }> = {};
          for (const { subject, idx } of subjectCols) {
            const cell = (cols[idx] ?? "").trim();
            if (cell === "") continue;                       // not taken
            const isAbsent = /^(a|ab|abs|absent|-|—)$/i.test(cell);
            const val = isAbsent ? 0 : Number(cell);
            if (isNaN(val) || val < 0) { errors.push(`${subject}: "${cell}" is not a number.`); continue; }
            if (val > subMax) { errors.push(`${subject}: ${val} is more than ${subMax}.`); continue; }
            sm[subject] = { obtained: val, total: subMax };
          }
          const keys = Object.keys(sm);
          if (keys.length > 0) {
            subjectMarks = sm;
            obtained = keys.reduce((s, k) => s + sm[k].obtained, 0);
            total = keys.reduce((s, k) => s + sm[k].total, 0);
            const paperObt = obtIdx !== -1 ? Number(cols[obtIdx]) : NaN;
            const paperTot = totalIdx !== -1 ? Number(cols[totalIdx]) : NaN;
            if (!isNaN(paperObt) && cols[obtIdx] !== "" && paperObt !== obtained)
              warnings.push(`Paper total ${paperObt} ≠ sum of subjects ${obtained}. Using the subject sum.`);
            if (!isNaN(paperTot) && cols[totalIdx] !== "" && paperTot > 0 && paperTot !== total)
              warnings.push(`Paper max ${paperTot} ≠ ${total} from subjects.`);
          }
        }
        if (!subjectMarks) {
          total = totalIdx !== -1 ? Number(cols[totalIdx]) : NaN;
          obtained = obtIdx !== -1 ? Number(cols[obtIdx]) : NaN;
          if (isNaN(total) || isNaN(obtained) || cols[totalIdx] === "" || cols[obtIdx] === "") {
            if (!errors.some(x => x.includes("is not a number") || x.includes("more than")))
              errors.push("No marks found for this row.");
          } else if (total <= 0 || obtained < 0 || obtained > total) {
            errors.push(`Marks ${obtained}/${total} are invalid.`);
          }
        }

        const percentage = total > 0 ? Math.round((obtained / total) * 100) : 0;
        if (pctIdx !== -1 && cols[pctIdx] !== "") {
          const paperPct = Number(String(cols[pctIdx]).replace("%", ""));
          if (!isNaN(paperPct) && Math.abs(paperPct - percentage) > 1)
            warnings.push(`Paper says ${paperPct}%, marks give ${percentage}%.`);
        }

        // ── 3. Pass / fail — paper status is respected ──────────────────
        const autoPass = percentage >= getPassThreshold();
        let manualStatus: boolean | null = null;
        const st = statusIdx !== -1 ? (cols[statusIdx] || "").toLowerCase() : "";
        if (/^(p|pass|passed|promoted)$/.test(st)) manualStatus = true;
        else if (/^(f|fail|failed|detained|absent)$/.test(st)) manualStatus = false;
        if (manualStatus !== null && manualStatus === autoPass) manualStatus = null;
        else if (manualStatus !== null)
          warnings.push(`Paper says ${manualStatus ? "Pass" : "Fail"} but marks say ${autoPass ? "Pass" : "Fail"}. Paper status will be saved.`);

        // ── 4. Exam roll no (optional) ──────────────────────────────────
        const csvExamRoll = examRollIdx !== -1 ? (cols[examRollIdx] || "") : "";
        const examRoll = csvExamRoll || (student ? resolveExamRoll(student.id) : null);

        if (nameMismatch && student)
          errors.push(`Roll ${rollNo} is ${student.full_name} but paper says "${name}".`);

        out.push({
          line, rollNo: student?.roll_number || rollNo, name: student?.full_name || name,
          paperName: name, student, examRoll: examRoll || null,
          subjectMarks, total, obtained, percentage,
          isPass: manualStatus !== null ? manualStatus : autoPass,
          manualStatus, remarks: remarksIdx !== -1 ? (cols[remarksIdx] || null) : null,
          errors, warnings, canForce: nameMismatch && errors.length === 1, forced: false,
        });
      });

      setImportRows(out);
      setImportFileName(file.name);
      setImportOpen(true);
    } catch (err) {
      toast.error(`Could not read CSV: ${err?.message || "unknown error"}`);
    } finally {
      if (csvRef.current) csvRef.current.value = "";
    }
  }, [students, cls, resolveExamRoll]);

  const importSummary = useMemo(() => {
    const isOk = (r: ImportRow) => r.errors.length === 0 || r.forced;
    const ok = importRows.filter(isOk);
    const missing = students.filter(s => !ok.some(r => r.student?.id === s.id));
    return {
      ready: ok.length,
      warn: ok.filter(r => r.warnings.length > 0).length,
      bad: importRows.length - ok.length,
      missing,
      isOk,
    };
  }, [importRows, students]);

  const commitImport = async () => {
    const good = importRows.filter(r => importSummary.isOk(r) && r.student);
    if (good.length === 0) { toast.error("Nothing valid to import."); return; }
    setCsvImporting(true); setCsvProgress(0);
    let added = 0; let failed = 0;
    const CHUNK = 40;
    for (let i = 0; i < good.length; i += CHUNK) {
      const slice = good.slice(i, i + CHUNK).map(r => ({
        student_id: r.student!.id, class: cls, exam_type: examType, year,
        total_marks: r.total, obtained_marks: r.obtained, percentage: r.percentage,
        grade: getGradeFromPercentage(r.percentage), is_pass: r.isPass,
        manual_pass_fail: r.manualStatus, remarks: r.remarks,
        exam_roll_no: r.examRoll,
        // null when only totals were typed → never leaves stale 0/75 data behind.
        subject_marks: r.subjectMarks,
      }));
      const { error } = await supabase.from("results")
        .upsert(slice, { onConflict: "student_id,class,exam_type,year" });
      if (error) { failed += slice.length; console.error("[import]", error.message); }
      else added += slice.length;
      setCsvProgress(Math.round(((i + slice.length) / good.length) * 100));
    }
    qc.invalidateQueries({ queryKey });
    setCsvImporting(false); setCsvProgress(0);
    if (failed) toast.error(`${added} imported, ${failed} failed. Try again.`);
    else { toast.success(`${added} results imported`); triggerConfetti("burst"); setImportOpen(false); setImportRows([]); }
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = results.length;
    const passed = results.filter(r => r.is_pass).length;
    const failed = total - passed;
    const avg = total > 0 ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / total) : 0;
    return { total, passed, failed, avg };
  }, [results]);

  // ────────────────────────────────────────────────────────────────────────────
  // If on a sub-tab, render the corresponding component
  if (subTab === "report-cards") return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
        <Button variant="outline" size="icon" aria-label="Back" onClick={() => setSubTab("results")} className="h-8 w-8 shrink-0 rounded-full">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground"><FileDown className="h-4 w-4" /></span>
        <h2 className="min-w-0 text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground">DMCs</h2>
      </div>
      {/* Class analytics PDF export now lives here (moved from the removed
          standalone Analytics tab). Opens a class picker (6-10, single or
          multiple) and downloads a one-page vector PDF per selected class:
          KPI cards, pass/fail donut, grade distribution, subject averages,
          radar profile, and top 5 performers. */}
      <ClassAnalyticsPdfButton year={year} />
      <AdminDMCs cls={cls} examType={examType} year={year} />
    </div>
  );

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <FileSpreadsheet className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Manage Results</h2>
            {activeScheme
              ? <p className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-emerald-600 sm:text-sm"><CheckCircle2 className="h-3 w-3 shrink-0" /><span className="break-words">Grading: {activeScheme.scheme_name}</span></p>
              : <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Enter, import, publish &amp; export results</p>}
          </div>
        </div>

        {/* Action toolbar — thin pills */}
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button
            variant="outline"
            className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-blue-300 px-3 text-xs font-semibold text-blue-700 dark:border-blue-500/40 dark:text-blue-300"
            onClick={() => {
              setGsClasses(["6", "7", "8", "9", "10"]);
              setGsDate("");
              setGsTime("08:00");
              setShowGlobalSchedule(true);
            }}
          >
            <Timer className="h-3.5 w-3.5 shrink-0" /> Schedule Publish
          </Button>
          <Button variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold" onClick={() => setSubTab("report-cards")}>
            <FileDown className="h-3.5 w-3.5 shrink-0" /> DMCs
          </Button>
          <Button
            variant="outline"
            className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-emerald-300 px-3 text-xs font-semibold text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
            onClick={handleExportAllClassesExcel}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />}
            {exporting ? "Exporting…" : "Export Excel"}
          </Button>
          <Button
            variant="outline"
            className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-destructive/40 px-3 text-xs font-semibold text-destructive"
            onClick={() => { setBdClasses([]); setShowBulkDelete(true); }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete
          </Button>
        </div>
      </div>

      {/* Class tabs — horizontally scrollable so "Class 10" is always reachable */}
      <Tabs value={cls} onValueChange={handleClassChange}>
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="grid h-10 w-full min-w-max grid-flow-col auto-cols-fr gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:w-auto">
            {classes.map(c => (
              <TabsTrigger key={c} value={c} className="h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Class {c}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Exam = Class tab + term tab + year. This IS the exam title for imports. */}
      <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
        <Tabs value={examType} onValueChange={setExamType} className="w-full sm:w-auto">
          <TabsList className="grid h-10 w-full grid-cols-2 gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:w-auto">
            {examTypes.map(t => (
              <TabsTrigger key={t} value={t} className="h-8 whitespace-nowrap rounded-full px-3 text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">{examTypeLabel(t)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/70 bg-background/80 pl-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Year</span>
            <input
              type="number" value={year} inputMode="numeric"
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1900 && v <= 2200) setYear(v); }}
              className="h-9 w-[68px] rounded-r-full bg-transparent pr-3 text-sm font-semibold tabular-nums outline-none"
              min="1900" max="2200"
            />
          </div>
          <Button onClick={openAdd} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold sm:flex-none sm:px-6">
            <Plus className="h-3.5 w-3.5 shrink-0" /> Add Result
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold" disabled={csvImporting} onClick={() => csvRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 shrink-0" /> Import CSV
          </Button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSV} />
          <Button variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold" onClick={downloadCSVTemplate}>
            <Download className="h-3.5 w-3.5 shrink-0" /> CSV Template
          </Button>
        </div>
        <p className="rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          Import goes into <b className="text-foreground">Class {cls} · {examTypeLabel(examType)} · {year}</b>. Students are matched by
          class roll number inside this class — exam roll numbers are optional.
        </p>
      </div>

      {/* Live countdown display — this is the small "time remaining" badge
         that shows in Manage Results for the currently-selected class tab
         once a schedule is active (set via the global Schedule Publish
         modal above). It stays visible regardless of whether that modal
         is open or closed.

         DEFENSIVE GUARD: only render if publish_at is STRICTLY IN THE
         FUTURE. If publish_at is in the past (e.g. a stale schedule left
         over from a previous session, or admin manually set is_published
         back to false without clearing publish_at), do NOT mount the
         timer — otherwise it would immediately fire and re-publish rows
         admin didn't want published. The Vercel cron
         (api/auto-publish-results.js) is responsible for cleaning up any
         legitimately-due past schedules; this UI timer is purely for the
         visual countdown while a schedule is pending. */}
      {results.length > 0
        && results[0]?.publish_at
        && new Date(results[0].publish_at).getTime() > Date.now()
        && !results.every(r => r.is_published) && (
        <ResultCountdownTimer
          targetDate={results[0].publish_at}
          cls={cls} examType={examType} year={year}
          onPublished={() => {
            toast.success("🎉 Results auto-published!");
            // Invalidate the current class's query…
            qc.invalidateQueries({ queryKey });
            // …AND every other admin-results query across all class tabs.
            // The publish just flipped is_published=true for ALL classes
            // sharing this publish_at, so cached queries for other class
            // tabs are now stale and need a refetch.
            qc.invalidateQueries({ queryKey: ["admin-results"] });
            // Also invalidate the public/homepage + user-dashboard queries
            // that depend on is_published state, so they refresh too.
            qc.invalidateQueries({ queryKey: ["scheduled-result-publishes"] });
            qc.invalidateQueries({ queryKey: ["latest-published-exam"] });
            qc.invalidateQueries({ queryKey: ["has-published-school-results"] });
            qc.invalidateQueries({ queryKey: ["home-school-toppers"] });
          }}
        />
      )}

      {/* Stats bar */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: "Total Students", value: stats.total, color: "text-primary", dot: "bg-primary" },
            { label: "Passed", value: stats.passed, color: "text-green-600", dot: "bg-green-500" },
            { label: "Failed", value: stats.failed, color: "text-destructive", dot: "bg-red-500" },
            { label: "Class Average", value: `${stats.avg}%`, color: "text-primary", dot: "bg-blue-500" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
              <p className={`text-xl font-bold leading-none tabular-nums sm:text-2xl ${s.color}`}>{s.value}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search name or roll no..."
          className="h-10 rounded-full pl-10 text-sm" value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Results table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (<>
        <Card className="hidden md:block overflow-hidden rounded-2xl shadow-sm"><CardContent className="p-0 overflow-x-auto">
          <Table className="border-collapse">
            <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="w-10 text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">#</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Photo</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Name</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Class Roll</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Exam Roll</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Total</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Obtained</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">%</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Grade</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Status</TableHead>
              <TableHead className="text-center border-b border-border/50 text-muted-foreground font-bold uppercase tracking-wider text-[10px]">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rankedResults.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-10 text-muted-foreground border-b border-border/50">
                    No results yet. Click "Add Result" to begin.
                  </TableCell>
                </TableRow>
              )}
              {rankedResults.map((r, i) => (
                <TableRow key={r.id} className={`hover:bg-primary/5 ${i % 2 === 1 ? "bg-muted/30" : "bg-card"}`}>
                  <TableCell className="font-bold text-primary text-center border-b border-border/50">{r.rank}</TableCell>
                  <TableCell className="text-center border-b border-border/50">
                    <div className="flex justify-center">
                      {r.students?.photo_url
                        ? <img src={r.students.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" loading="lazy" />
                        : <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                            {(r.students?.full_name || "S").charAt(0)}
                          </div>}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium text-center border-b border-border/50">{r.students?.full_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm text-center border-b border-border/50">{r.students?.roll_number || "—"}</TableCell>
                  <TableCell className="text-center border-b border-border/50">
                    {r.exam_roll_no
                      ? <span className="font-mono font-bold text-primary text-sm">{r.exam_roll_no}</span>
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-center border-b border-border/50">{r.total_marks}</TableCell>
                  <TableCell className="text-center border-b border-border/50">{r.obtained_marks}</TableCell>
                  <TableCell className="font-semibold text-center border-b border-border/50">{r.percentage}%</TableCell>
                  <TableCell className="text-center border-b border-border/50"><Badge className={getGradeColor(r.grade || "Fail")}>{r.grade}</Badge></TableCell>
                  <TableCell className="text-center border-b border-border/50">
                    <Badge
                      variant={r.is_pass ? "default" : "destructive"}
                      className={r.is_pass ? "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]" : ""}
                    >
                      {r.is_pass ? "Pass" : "Fail"}
                    </Badge>
                    {r.manual_pass_fail !== null && (
                      <span className="text-[10px] text-muted-foreground ml-1">(manual)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center border-b border-border/50">
                    <div className="flex items-center justify-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this result?</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMut.mutate(r.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
        <div className="space-y-2.5 md:hidden">
          {rankedResults.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-9 text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60"><FileSpreadsheet className="h-6 w-6" /></span>
              <p className="text-sm font-semibold text-foreground">No results yet</p>
              <p className="mx-auto mt-1 max-w-[250px] text-xs leading-relaxed text-muted-foreground">Tap "Add Result" or "Import CSV" to begin.</p>
            </div>
          )}
          {rankedResults.map(r => (
            <div key={r.id} className="rounded-2xl border border-border/70 bg-card p-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold tabular-nums text-primary">{r.rank}</span>
                {r.students?.photo_url
                  ? <img src={r.students.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />
                  : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{(r.students?.full_name || "S").charAt(0)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold leading-snug">{r.students?.full_name || "—"}</p>
                  <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                    Roll {r.students?.roll_number || "—"}
                    {r.exam_roll_no ? <> · Exam <span className="font-mono font-semibold text-primary">{r.exam_roll_no}</span></> : null}
                  </p>
                </div>
                <Badge className={`h-5 shrink-0 px-2 text-[10px] ${getGradeColor(r.grade || "Fail")}`}>{r.grade}</Badge>
              </div>

              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${r.is_pass ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.max(0, Math.min(100, Number(r.percentage) || 0))}%` }} />
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span><span className="font-bold tabular-nums">{r.obtained_marks}</span><span className="text-muted-foreground">/{r.total_marks}</span></span>
                  <span className="font-semibold tabular-nums">{r.percentage}%</span>
                  <Badge
                    variant={r.is_pass ? "default" : "destructive"}
                    className={`h-5 px-2 text-[10px] ${r.is_pass ? "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]" : ""}`}
                  >{r.is_pass ? "Pass" : "Fail"}</Badge>
                  {r.manual_pass_fail !== null && <span className="text-[10px] text-muted-foreground">(manual)</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="icon" variant="outline" aria-label="Edit result" className="h-8 w-8 rounded-full" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="outline" aria-label="Delete result" className="h-8 w-8 rounded-full border-destructive/30 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="w-[calc(100%-1.5rem)] max-w-sm rounded-2xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this result?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="flex-row gap-2">
                        <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full text-xs">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMut.mutate(r.id)} className="h-9 flex-1 rounded-full bg-destructive text-xs text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      </>)}

      {/* ── Paper-result import preview ─────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!csvImporting) setImportOpen(o); }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-lg max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl">
          <div className="px-4 pt-5 pb-3 border-b border-border">
            <DialogTitle className="text-lg font-heading">Review before importing</DialogTitle>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="rounded-full">Class {cls}</Badge>
              <Badge variant="outline" className="rounded-full">{examTypeLabel(examType)}</Badge>
              <Badge variant="outline" className="rounded-full">{year}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{importFileName}</p>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 py-2">
                <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{importSummary.ready}</p>
                <p className="text-[10px] uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">Ready</p>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 py-2">
                <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{importSummary.warn}</p>
                <p className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">Check</p>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-950/30 py-2">
                <p className="text-xl font-bold text-red-700 dark:text-red-300">{importSummary.bad}</p>
                <p className="text-[10px] uppercase tracking-wide text-red-700/80 dark:text-red-300/80">Blocked</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {importRows.map((r, idx) => {
              const blocked = r.errors.length > 0 && !r.forced;
              return (
                <div key={idx} className={`rounded-xl border p-3 text-sm ${
                  blocked ? "border-red-300 bg-red-50/60 dark:bg-red-950/20"
                    : r.warnings.length ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20"
                    : "border-border bg-card"}`}>
                  <div className="flex items-start gap-2">
                    {blocked ? <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                      : r.warnings.length ? <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      : <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{r.name || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        Roll {r.rollNo || "—"}
                        {r.examRoll ? ` · Exam Roll ${r.examRoll}` : " · no exam roll"}
                        {` · line ${r.line}`}
                      </p>
                    </div>
                    {r.student && !blocked && (
                      <div className="text-right shrink-0">
                        <p className="font-bold">{r.obtained}/{r.total}</p>
                        <p className={`text-xs font-semibold ${r.isPass ? "text-emerald-600" : "text-red-600"}`}>
                          {r.percentage}% · {r.isPass ? "Pass" : "Fail"}
                        </p>
                      </div>
                    )}
                  </div>
                  {r.errors.map((m, i) => <p key={`e${i}`} className="text-xs text-red-700 dark:text-red-300 mt-1.5 pl-6">{m}</p>)}
                  {r.warnings.map((m, i) => <p key={`w${i}`} className="text-xs text-amber-800 dark:text-amber-300 mt-1.5 pl-6">{m}</p>)}
                  {r.canForce && (
                    <Button
                      size="sm" variant="outline" className="mt-2 ml-6 h-8 rounded-full text-xs"
                      onClick={() => setImportRows(rows => rows.map((x, i) => i === idx ? { ...x, forced: !x.forced } : x))}
                    >
                      {r.forced ? "Undo — skip this row" : "Roll is correct — use anyway"}
                    </Button>
                  )}
                </div>
              );
            })}
            {importSummary.missing.length > 0 && (
              <div className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground mb-1">{importSummary.missing.length} student(s) of Class {cls} have no row in this file:</p>
                <p className="leading-relaxed">
                  {importSummary.missing.slice(0, 12).map(s => `${s.roll_number}. ${s.full_name}`).join(" · ")}
                  {importSummary.missing.length > 12 ? " …" : ""}
                </p>
              </div>
            )}
          </div>

          {csvImporting && <Progress value={csvProgress} className="h-1.5 rounded-none" />}
          <div className="grid grid-cols-[auto_1fr] gap-2 p-3 border-t border-border bg-background pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" className="h-9 rounded-full px-5 text-xs font-semibold" disabled={csvImporting} onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button className="h-9 min-w-0 rounded-full text-xs font-semibold" disabled={csvImporting || importSummary.ready === 0} onClick={commitImport}>
              {csvImporting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importing {csvProgress}%</> : `Import ${importSummary.ready} result${importSummary.ready === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="break-words pr-6 text-base leading-snug">{editing ? "Edit Result" : "Add Result"} — Class {cls} ({examTypeLabel(examType)} {year})</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">

            {/* Student selector */}
            <div>
              <Label>Select Student from List</Label>
              <Select value={form.student_id} onValueChange={handleStudentSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose student (auto-fills name & exam roll)" />
                </SelectTrigger>
                <SelectContent>
                  {students.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.roll_number} — {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Selecting auto-fills name and exam roll number if generated
              </p>
            </div>

            {/* Student name — manual */}
            <div>
              <Label>Student Name *</Label>
              <Input
                value={form.student_name_manual}
                onChange={e => setF("student_name_manual", e.target.value)}
                placeholder="Type student name manually if needed"
              />
            </div>

            {/* Exam Roll Number */}
            <div>
              <Label className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-primary" />
                Exam Roll Number <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={form.exam_roll_no}
                onChange={e => handleExamRollInput(e.target.value)}
                placeholder="e.g. 100001 (auto-filled from dropdown)"
                className="font-mono"
              />

              {availableRollsForStudent.length > 1 && (
                <div className="mt-2 border border-blue-200 bg-blue-50 dark:bg-blue-950/20 rounded-lg p-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-300">
                    This student has {availableRollsForStudent.length} exam roll numbers — choose which one to use:
                  </p>
                  {availableRollsForStudent.map(roll => {
                    const term = roll.exam_roll_sessions?.exam_term;
                    const yr = roll.exam_roll_sessions?.exam_year;
                    const published = roll.exam_roll_sessions?.is_published;
                    const isSelected = form.exam_roll_no === roll.exam_roll_no;
                    return (
                      <button
                        key={roll.id}
                        type="button"
                        onClick={() => setF("exam_roll_no", roll.exam_roll_no)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                          isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-secondary"
                        }`}
                      >
                        <span className="font-mono font-bold">{roll.exam_roll_no}</span>
                        <span className={`text-xs ${isSelected ? "opacity-90" : "text-muted-foreground"}`}>
                          {term ? `${examTypeLabel(term)} ${yr || ""}` : "session unknown"}{!published && " · unpublished"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {examRolls.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {examRolls.length} exam roll number{examRolls.length > 1 ? "s" : ""} on record for Class {cls} (across all generated sessions).
                </p>
              )}
              {examRolls.length === 0 && (
                <p className="text-xs text-blue-700 mt-1">
                  No exam roll numbers generated for Class {cls} yet. Generate them in Exam Roll Numbers section.
                </p>
              )}
            </div>

            {/* Subject-wise Marks */}
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="bg-primary/10 px-4 py-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Subject-wise Marks</span>
                <span className="text-xs text-muted-foreground">Totals auto-calculate</span>
              </div>
              <p className="text-xs text-muted-foreground px-4 py-1.5 bg-secondary/30 border-b border-border">
                Uncheck a subject if that paper hasn't been given yet — it will be excluded from the Grand Total.
              </p>
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                <div className="grid grid-cols-[auto_2fr_1fr_1fr] gap-2 px-4 py-1.5 bg-secondary/60 text-xs font-bold text-muted-foreground">
                  <span></span><span>Subject</span><span className="text-center">Obtained</span><span className="text-center">Max</span>
                </div>
                {getSubjects(cls).map(subject => {
                  const sm = subjectMarks[subject] || { obtained: 0, total: DEFAULT_SUBJECT_MAX, included: true, touched: false };
                  return (
                    <div key={subject} className={`grid grid-cols-[auto_2fr_1fr_1fr] items-center gap-2 px-4 py-1.5 ${!sm.included ? "opacity-40" : ""}`}>
                      <input
                        type="checkbox"
                        checked={sm.included}
                        onChange={e => toggleSubjectIncluded(subject, e.target.checked)}
                        title="Include this subject's marks in the total"
                        className="w-4 h-4 accent-primary shrink-0"
                      />
                      <span className="text-sm font-medium text-foreground leading-tight break-words">{subject}</span>
                      <Input
                        type="number" min={0} max={sm.total}
                        value={sm.touched ? sm.obtained : ""}
                        placeholder="—"
                        disabled={!sm.included}
                        onChange={e => setSubjectMark(subject, "obtained", e.target.value === "" ? 0 : Number(e.target.value))}
                        className="h-8 text-sm text-center px-1"
                      />
                      <Input
                        type="number" min={1}
                        value={sm.total}
                        disabled={!sm.included}
                        onChange={e => setSubjectMark(subject, "total", Number(e.target.value))}
                        className="h-8 text-sm text-center px-1"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="bg-secondary/50 px-4 py-2 flex justify-between text-sm font-bold border-t border-border">
                <span className="text-foreground">Grand Total</span>
                <span className="text-primary">{form.obtained_marks} / {form.total_marks}</span>
              </div>
            </div>

            {/* Grand total summary — read-only */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Total Marks</Label>
                <Input type="number" value={form.total_marks} readOnly className="bg-muted font-mono" />
              </div>
              <div>
                <Label>Obtained Marks</Label>
                <Input type="number" value={form.obtained_marks} readOnly className="bg-muted font-mono" />
              </div>
            </div>

            {/* Auto-calculated result preview */}
            <div className="bg-secondary/50 rounded-xl p-3 flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Percentage: </span>
                <span className="font-bold text-foreground">{pct}%</span>
              </div>
              <Badge className={getGradeColor(autoGrade)}>{autoGrade}</Badge>
              <Badge
                variant={finalPass ? "default" : "destructive"}
                className={finalPass ? "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]" : ""}
              >
                {finalPass ? "✅ Pass" : "❌ Fail"}
              </Badge>
            </div>

            {/* Manual Pass/Fail override */}
            <div className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">Manual Pass/Fail Override</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Turn ON to manually set pass or fail (overrides auto calculation)
                  </p>
                </div>
                <Switch
                  checked={form.use_manual_pass}
                  onCheckedChange={v => setF("use_manual_pass", v)}
                />
              </div>

              {form.use_manual_pass && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setF("manual_pass_fail", true)}
                    className={`h-9 flex-1 rounded-full text-xs font-bold border transition-all ${
                      form.manual_pass_fail === true
                        ? "bg-green-500 text-white border-green-500"
                        : "border-border text-muted-foreground hover:border-green-400"
                    }`}
                  >
                    ✅ PASS
                  </button>
                  <button
                    onClick={() => setF("manual_pass_fail", false)}
                    className={`h-9 flex-1 rounded-full text-xs font-bold border transition-all ${
                      form.manual_pass_fail === false
                        ? "bg-red-500 text-white border-red-500"
                        : "border-border text-muted-foreground hover:border-red-400"
                    }`}
                  >
                    ❌ FAIL
                  </button>
                </div>
              )}
            </div>

            {/* Remarks */}
            <div>
              <Label>Remarks (Optional)</Label>
              <Textarea
                rows={2}
                value={form.remarks}
                onChange={e => setF("remarks", e.target.value)}
                placeholder="Any notes about this result"
              />
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="h-9 flex-1 rounded-full text-xs font-semibold sm:flex-none sm:px-6">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 flex-1 gap-1.5 whitespace-nowrap rounded-full text-xs font-semibold sm:flex-none sm:px-6">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? "Saving..." : editing ? "Update Result" : "Add Result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Global Schedule-Publish modal ──────────────────────────────────
          One modal, reachable from any class tab via the button next to
          DMCs. Admin picks classes (6–10) + a date/time, and hits Publish.
          As soon as it's saved this modal closes — the small countdown
          badge below the header (see `results[0]?.publish_at` block above,
          unchanged) takes over from there for each class tab, so the admin
          can always see how much time remains without reopening this modal.

          BUG FIX ("only 6,7,8 got scheduled, not 9 & 10"): classes 6-8 use
          exam_type values "1st Semester" / "2nd Semester", while classes
          9-10 use "Annual-I" / "Annual-II" — two DIFFERENT label sets. The
          old code always filtered by whatever `examType` the currently-open
          class TAB happened to have selected (e.g. "1st Semester"), so when
          that update ran with `.eq("exam_type", examType)`, classes 9 and
          10 had ZERO rows matching "1st Semester" and were silently
          skipped — even though they were checked in the modal.
          Fix: schedule EACH selected class using the CORRECT exam_type
          for that specific class (via getExamTypes(cls)), not one shared
          examType value for every class. Classes 6-8 get scheduled under
          BOTH their semester labels; classes 9-10 get scheduled under BOTH
          their annual labels — so picking "all 5 classes" genuinely
          schedules all 5, regardless of which tab was open when the modal
          was opened. */}
      <Dialog open={showGlobalSchedule} onOpenChange={setShowGlobalSchedule}>
        {/* MOBILE FIX: this dialog's content (class picker + date/time + 3
            action buttons) is taller than most phone screens. The shared
            DialogContent caps height at 90vh but has NO overflow scroll, so
            the buttons at the bottom were clipped behind the mobile bottom
            bar — Publish/Unpublish half-visible, Clear Schedule unreachable.
            max-h-[85dvh] + overflow-y-auto makes the whole dialog body
            scrollable (dvh accounts for mobile browser chrome), and tighter
            p-4 padding on phones frees extra room. */}
        <DialogContent className="max-w-sm w-[92vw] sm:max-w-md rounded-2xl overflow-y-auto max-h-[85dvh] p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Timer className="w-4 h-4 text-blue-600" /> Schedule Publish — {year}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Pick which classes to schedule, then a date & time. Each
              class's CURRENT exam result (whichever exam type it has
              unpublished results for) will auto-publish to students at
              that moment.
            </p>

            {/* Class picker — mobile-friendly checkbox grid */}
            <div>
              <label className="text-xs font-semibold text-foreground">Classes</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1.5">
                {classes.map(c => {
                  const checked = gsClasses.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setGsClasses(prev =>
                        checked ? prev.filter(x => x !== c) : [...prev, c]
                      )}
                      className={`h-9 whitespace-nowrap rounded-full border px-2 text-xs font-semibold transition-colors ${
                        checked
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-background border-input text-foreground"
                      }`}
                    >
                      Class {c}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-2">
                <button type="button" className="text-xs text-blue-600 font-medium" onClick={() => setGsClasses(["6","7","8","9","10"])}>Select All</button>
                <button type="button" className="text-xs text-muted-foreground font-medium" onClick={() => setGsClasses([])}>Clear</button>
              </div>
              <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gsHideTop3}
                  onChange={e => setGsHideTop3(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-600 shrink-0"
                />
                <span className="text-xs text-amber-800">
                  <span className="font-semibold">Hide top 3 of each class</span> — the top 3 students
                  (by percentage) in every selected class stay unpublished. Everyone else publishes
                  as scheduled; toppers can be revealed later with their own publish.
                </span>
              </label>
            </div>

            {/* Date & time — stacked full-width on mobile */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">Date</label>
                <input
                  type="date" value={gsDate} onChange={e => setGsDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="block mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Time</label>
                <input
                  type="time" value={gsTime} onChange={e => setGsTime(e.target.value)}
                  className="block mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-ring outline-none"
                />
              </div>
            </div>

            {/* Actions — MOBILE FIX: three full-width stacked buttons made
                the dialog much taller than the screen (they were the reason
                Publish/Unpublish/Clear Schedule looked scattered and got
                clipped). Now: Publish (primary) keeps a full-width row, and
                Unpublish + Clear Schedule share one compact row beneath it —
                half the height, still easy to tap. */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                className="col-span-2 h-9 w-full justify-center gap-1.5 rounded-full bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
                disabled={!gsDate || gsClasses.length === 0 || gsSaving}
                onClick={async () => {
                  if (!gsDate) { toast.error("Pick a date"); return; }
                  if (gsClasses.length === 0) { toast.error("Pick at least one class"); return; }
                  setGsSaving(true);
                  const publishAt = new Date(`${gsDate}T${gsTime}:00`).toISOString();
                  // Schedule EACH class using ITS OWN valid exam_type values
                  // (both semesters for 6-8, both annuals for 9-10) — not
                  // one shared `examType`. This is what makes "all 5
                  // classes" actually schedule all 5.
                  //
                  // "Hide top 3 of each class": when checked, look up that
                  // class's current unpublished rows FIRST, rank by
                  // percentage, and exclude the top 3 ids from the update —
                  // those rows are simply never touched, so they stay
                  // is_published=false / publish_at=null indefinitely until
                  // the admin schedules/publishes them separately later.
                  const results = await Promise.all(
                    gsClasses.map(async (c) => {
                      let query = supabase.from("results")
                        .update({ publish_at: publishAt })
                        .eq("class", c)
                        .in("exam_type", getExamTypes(c))
                        .eq("year", year)
                        .eq("is_published", false);

                      if (gsHideTop3) {
                        const { data: classResults, error: fetchErr } = await supabase
                          .from("results")
                          .select("id, percentage")
                          .eq("class", c)
                          .in("exam_type", getExamTypes(c))
                          .eq("year", year)
                          .eq("is_published", false);
                        if (fetchErr) return { error: fetchErr };
                        const top3Ids = (classResults ?? [])
                          .slice()
                          .sort((a, b) => (b.percentage ?? 0) - (a.percentage ?? 0))
                          .slice(0, 3)
                          .map(r => r.id);
                        if (top3Ids.length) {
                          query = query.not("id", "in", `(${top3Ids.map(id => `"${id}"`).join(",")})`);
                        }
                      }

                      return query;
                    })
                  );
                  setGsSaving(false);
                  const failed = results.find(r => r.error);
                  if (failed) { toast.error("Failed to schedule some classes"); return; }
                  toast.success(
                    gsHideTop3
                      ? `✅ Scheduled Class ${gsClasses.join(", ")} for ${year} (top 3 of each class held back)!`
                      : `✅ Scheduled Class ${gsClasses.join(", ")} for ${year}!`
                  );
                  // Refresh every query that depends on publish_at/is_published
                  // so the small countdown badge shows up immediately on
                  // whichever class tab the admin is looking at, and the
                  // homepage/results-page countdowns update too.
                  qc.invalidateQueries({ queryKey: ["admin-results"] });
                  qc.invalidateQueries({ queryKey: ["scheduled-result-publishes"] });
                  qc.invalidateQueries({ queryKey: ["latest-published-exam"] });
                  qc.invalidateQueries({ queryKey: ["has-published-school-results"] });
                  qc.invalidateQueries({ queryKey: ["home-school-toppers"] });
                  // Interface disappears as requested — modal closes and the
                  // small countdown badge in Manage Results takes over.
                  setShowGlobalSchedule(false);
                  setGsHideTop3(false);
                }}
              >
                {gsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Timer className="w-4 h-4" />}
                Publish
              </Button>
              {/* ── Unpublish ────────────────────────────────────────────────
                  Takes PUBLISHED results (is_published = true) for the
                  selected classes + year back offline, hiding them from
                  students on the Home/Results pages immediately. Nothing is
                  deleted — the admin can re-schedule the same results again
                  with the Publish button right after.
                  CRITICAL: publish_at is set to null in the SAME update.
                  If a stale (past) publish_at were left on the rows, the
                  Vercel cron (api/auto-publish-results.js) and the in-browser
                  countdown timer would instantly RE-PUBLISH them — the
                  auto-republish loop documented at the top of this file.
                  Nulling publish_at here breaks that loop: an unpublished row
                  has no schedule, so no automation can flip it back. */}
              <Button
                variant="outline"
                disabled={gsClasses.length === 0 || gsUnpublishing}
                onClick={() => {
                  if (gsClasses.length === 0) { toast.error("Pick at least one class"); return; }
                  setShowUnpublishConfirm(true);
                }}
                className="h-9 w-full justify-center gap-1.5 whitespace-nowrap rounded-full border-destructive/40 text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {gsUnpublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />}
                Unpublish
              </Button>
              <Button
                variant="outline"
                className="h-9 w-full justify-center whitespace-nowrap rounded-full text-xs font-semibold"
                onClick={async () => {
                  if (gsClasses.length === 0) { toast.error("Pick at least one class"); return; }
                  await Promise.all(
                    gsClasses.map(c =>
                      supabase.from("results")
                        .update({ publish_at: null })
                        .eq("class", c)
                        .in("exam_type", getExamTypes(c))
                        .eq("year", year)
                    )
                  );
                  toast.success("Schedule cleared");
                  qc.invalidateQueries({ queryKey: ["admin-results"] });
                  qc.invalidateQueries({ queryKey: ["scheduled-result-publishes"] });
                  setShowGlobalSchedule(false);
                }}
              >
                Clear Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Unpublish confirmation dialog ─────────────────────────────────
          Deliberate two-step confirm so a stray tap can't hide students'
          results school-wide. States exactly which classes + year will be
          affected and reminds that unpublishing is reversible (results can
          be re-scheduled via Publish). The actual DB work happens in the
          confirm action — see the update block below. */}
      <AlertDialog open={showUnpublishConfirm} onOpenChange={setShowUnpublishConfirm}>
        <AlertDialogContent className="max-w-sm w-[92vw] sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <EyeOff className="w-4 h-4 text-destructive" /> Unpublish results?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Published results for <span className="font-semibold text-foreground">Class {gsClasses.join(", ")}</span> ({year})
              {" "}will be hidden from students immediately. Nothing is deleted —
              you can schedule-publish the same results again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2">
            <AlertDialogCancel disabled={gsUnpublishing} className="mt-0 h-9 flex-1 rounded-full text-xs font-semibold">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 flex-1 gap-1.5 whitespace-nowrap rounded-full text-xs font-semibold"
              disabled={gsUnpublishing}
              onClick={async (e) => {
                e.preventDefault(); // keep the confirm dialog open while working
                if (gsClasses.length === 0) { toast.error("Pick at least one class"); return; }
                setGsUnpublishing(true);
                // Flip is_published true -> false AND clear publish_at in the
                // SAME patch (anti re-publish loop — see button comment above).
                // Same per-class exam_type coverage as scheduling: BOTH exam
                // type labels per class (semesters for 6-8, annuals for 9-10)
                // so selected classes are fully unpublished no matter which
                // exam type tab was open when the modal was opened.
                const res = await Promise.all(
                  gsClasses.map(c =>
                    supabase.from("results")
                      .update({ is_published: false, publish_at: null })
                      .eq("class", c)
                      .in("exam_type", getExamTypes(c))
                      .eq("year", year)
                      .eq("is_published", true)
                  )
                );
                setGsUnpublishing(false);
                const failed = res.find(r => r.error);
                if (failed) { toast.error("Failed to unpublish some classes"); return; }
                toast.success(`⛔ Unpublished Class ${gsClasses.join(", ")} results for ${year}`);
                // Refresh every query that depends on is_published / publish_at
                // so the admin panel AND the public Home/Results pages hide the
                // results right away (same invalidation set as Publish above).
                qc.invalidateQueries({ queryKey: ["admin-results"] });
                qc.invalidateQueries({ queryKey: ["scheduled-result-publishes"] });
                qc.invalidateQueries({ queryKey: ["latest-published-exam"] });
                qc.invalidateQueries({ queryKey: ["has-published-school-results"] });
                qc.invalidateQueries({ queryKey: ["home-school-toppers"] });
                setShowUnpublishConfirm(false);
                setShowGlobalSchedule(false);
              }}
            >
              {gsUnpublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />}
              {gsUnpublishing ? "Unpublishing..." : "Yes, Unpublish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk Delete dialog ────────────────────────────────────────────
          Same class-picker pattern as Schedule Publish above. Deletes EVERY
          result row for each selected class + year, across all of that
          class's exam types (both semesters for 6-8, both annuals for
          9-10) — a full wipe so new results can be entered cleanly. */}
      <AlertDialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <AlertDialogContent className="max-w-sm w-[92vw] sm:max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="w-4 h-4" /> Delete Class Results — {year}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Pick one or more classes. ALL results for those classes in {year}
              {" "}(every exam type/semester) will be permanently deleted. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div>
            <label className="text-xs font-semibold text-foreground">Classes</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1.5">
              {classes.map(c => {
                const checked = bdClasses.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBdClasses(prev =>
                      checked ? prev.filter(x => x !== c) : [...prev, c]
                    )}
                    className={`h-9 whitespace-nowrap rounded-full border px-2 text-xs font-semibold transition-colors ${
                      checked
                        ? "bg-destructive border-destructive text-destructive-foreground"
                        : "bg-background border-input text-foreground"
                    }`}
                  >
                    Class {c}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 mt-2">
              <button type="button" className="text-xs text-destructive font-medium" onClick={() => setBdClasses(["6","7","8","9","10"])}>Select All</button>
              <button type="button" className="text-xs text-muted-foreground font-medium" onClick={() => setBdClasses([])}>Clear</button>
            </div>
          </div>

          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              disabled={bdClasses.length === 0 || bdDeleting}
              onClick={async (e) => {
                // Prevent the default auto-close so we can show the
                // deleting spinner and close manually on success/failure.
                e.preventDefault();
                if (bdClasses.length === 0) { toast.error("Pick at least one class"); return; }
                setBdDeleting(true);
                const results = await Promise.all(
                  bdClasses.map(c =>
                    supabase.from("results")
                      .delete()
                      .eq("class", c)
                      .in("exam_type", getExamTypes(c))
                      .eq("year", year)
                  )
                );
                setBdDeleting(false);
                const failed = results.find(r => r.error);
                if (failed) { toast.error("Failed to delete some classes"); return; }
                toast.success(`✅ Deleted all Class ${bdClasses.join(", ")} results for ${year}`);
                qc.invalidateQueries({ queryKey: ["admin-results"] });
                qc.invalidateQueries({ queryKey: ["subject-analytics"] });
                qc.invalidateQueries({ queryKey: ["scheduled-result-publishes"] });
                qc.invalidateQueries({ queryKey: ["latest-published-exam"] });
                qc.invalidateQueries({ queryKey: ["has-published-school-results"] });
                qc.invalidateQueries({ queryKey: ["home-school-toppers"] });
                setShowBulkDelete(false);
              }}
              className="h-9 w-full justify-center gap-1.5 rounded-full bg-destructive text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
            >
              {bdDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete Selected Class Results
            </AlertDialogAction>
            <AlertDialogCancel className="mt-0 h-9 w-full justify-center rounded-full text-xs font-semibold">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminResults;
