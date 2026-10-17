// src/pages/admin/tabs/AdminExamSchedule.tsx
// Advanced Exam Date Sheet manager — Auto Fill generates and saves the schedule
// directly (no manual row grid), per-class clear/delete, and a combined
// multi-class PDF export.

import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Minus, Check, Info, Sparkles, CalendarDays, Trash2, Loader2, Wand2, Calendar, Clock, Shuffle, Download, X } from "lucide-react";
import { format, addDays, isSunday } from "date-fns";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { examTypeLabel } from "@/utils/examTypeLabel";
import {
  useAllExamSchedule, useUpsertExamSchedule, useDeleteExamEntry, useDeleteExamScheduleBatch,
} from "@/hooks/useNewFeatures";

const classes = ["6", "7", "8", "9", "10"];
const getExamTypes = (cls: string) => ["9", "10"].includes(cls) ? ["Annual-I", "Annual-II"] : ["1st Semester", "2nd Semester"];
const SUBJECTS_6_8 = ["English", "Urdu", "Islamiyat", "M.Quran", "Arabic", "Geography", "Pashto", "Maths", "History", "G.Science", "Computer Science"];
const SUBJECTS_9_10 = ["English", "Urdu", "Pak-study", "Chemistry", "Physics", "Computer Science", "Biology", "Islamiyat", "M.Quran", "Mathematics"];
const getSubjects = (cls: string) => ["9", "10"].includes(cls) ? SUBJECTS_9_10 : SUBJECTS_6_8;

const currentYear = new Date().getFullYear();

/** Parse "yyyy-MM-dd" as a LOCAL date (new Date("yyyy-MM-dd") is UTC and can shift the day). */
const parseD = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s));

/** "13:05" / "13:05:00" → "1:05 PM". Falls back to "-" when empty. */
const fmt12 = (t?: string | null) => {
  if (!t) return "-";
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return t;
  const h = parseInt(m[1], 10);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
};
const timeRange = (start?: string | null, end?: string | null) => `${fmt12(start)} – ${fmt12(end)}`;

// Shared mobile-safe field + thin-button styles (16px font on mobile prevents iOS focus-zoom)
const fieldCls = "h-9 w-full min-w-0 rounded-full border-border/60 bg-card px-3.5 text-base shadow-none sm:text-sm [&::-webkit-date-and-time-value]:text-left";
const thinBtn = "h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold shadow-none [&_svg]:size-3.5";

function Section({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-2.5 rounded-2xl border border-border/60 bg-muted/30 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h4 className="flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{n}</span>
          <span className="break-words">{title}</span>
        </h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function AdminExamSchedule() {
  const { data: allEntries = [], isLoading } = useAllExamSchedule();
  const addEntries = useUpsertExamSchedule();
  const deleteEntry = useDeleteExamEntry();
  const deleteBatch = useDeleteExamScheduleBatch();

  const [filterCls, setFilterCls] = useState("6");
  const [filterExam, setFilterExam] = useState("1st Semester");
  const [bulkCls, setBulkCls] = useState("6");
  const [bulkExam, setBulkExam] = useState("1st Semester");
  const [bulkYearInput, setBulkYearInput] = useState(String(currentYear));
  const [saving, setSaving] = useState(false);
  const [deletingClass, setDeletingClass] = useState(false);

  const bulkYear = parseInt(bulkYearInput, 10);
  const filtered = allEntries.filter(e => e.class === filterCls && e.exam_type === filterExam);

  // ── Auto Fill dialog state ──
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [afSelectedSubjects, setAfSelectedSubjects] = useState<string[]>([]);
  const [afDefaultStart, setAfDefaultStart] = useState("09:00");
  const [afDefaultEnd, setAfDefaultEnd] = useState("12:00");
  const [afOverrides, setAfOverrides] = useState<Record<string, { start: string; end: string }>>({});
  const [afCustomizing, setAfCustomizing] = useState<string>(""); // subject currently being given a custom time, via a small picker
  const [afRangeStart, setAfRangeStart] = useState("");
  const [afRangeEnd, setAfRangeEnd] = useState("");
  const [afGapDays, setAfGapDays] = useState("0");

  const openAutoFill = () => {
    setAfSelectedSubjects(getSubjects(bulkCls));
    setAfOverrides({});
    setAfCustomizing("");
    setAfRangeStart("");
    setAfRangeEnd("");
    setAfGapDays("0");
    setAutoFillOpen(true);
  };

  const toggleAfSubject = (s: string) => setAfSelectedSubjects(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  const setAfOverride = (s: string, field: "start" | "end", val: string) =>
    setAfOverrides(cur => ({ ...cur, [s]: { start: cur[s]?.start ?? afDefaultStart, end: cur[s]?.end ?? afDefaultEnd, [field]: val } }));
  const clearAfOverride = (s: string) => setAfOverrides(cur => { const n = { ...cur }; delete n[s]; return n; });

  // Fisher–Yates shuffle so re-clicking Generate gives a different subject order each time
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const runAutoFill = async () => {
    if (isNaN(bulkYear) || bulkYear < 2000) { toast.error("Enter a valid year"); return; }
    if (!afSelectedSubjects.length) { toast.error("Select at least one subject"); return; }
    if (!afRangeStart || !afRangeEnd) { toast.error("Pick a start and end date for the exam window"); return; }
    const start = new Date(afRangeStart);
    const end = new Date(afRangeEnd);
    if (start > end) { toast.error("Start date must be before end date"); return; }
    const gap = Math.max(0, parseInt(afGapDays, 10) || 0);

    const order = shuffle(afSelectedSubjects);
    const generated: { subject: string; exam_date: string; start_time: string; end_time: string }[] = [];
    let cursor = start;

    for (let i = 0; i < order.length; i++) {
      // Sunday is always a holiday — hop forward until we land on a non-Sunday
      while (isSunday(cursor)) cursor = addDays(cursor, 1);

      if (cursor > end) {
        toast.error(`Only ${i} of ${order.length} subjects fit in the selected date range — widen the range or reduce the gap`);
        return;
      }

      const subj = order[i];
      const ov = afOverrides[subj];
      generated.push({
        subject: subj,
        exam_date: format(cursor, "yyyy-MM-dd"),
        start_time: ov?.start || afDefaultStart,
        end_time: ov?.end || afDefaultEnd,
      });

      // Move to the next paper's date: 1 day plus however many gap/holiday days requested
      cursor = addDays(cursor, 1 + gap);
    }

    if (!generated.length) return;

    setSaving(true);
    try {
      await addEntries.mutateAsync(generated.map(r => ({
        class: bulkCls, exam_type: bulkExam, year: bulkYear,
        subject: r.subject,
        paper_name: null,
        paper_code: null,
        exam_date: r.exam_date,
        start_time: r.start_time,
        end_time: r.end_time,
        hall: null,
        notes: null,
        is_published: true,
      })));
      toast.success(`Generated and saved a schedule for ${generated.length} subjects`);
      setAutoFillOpen(false);
      setFilterCls(bulkCls);
      setFilterExam(bulkExam);
    } catch {
      toast.error("Failed to save the generated schedule");
    }
    setSaving(false);
  };

  const handleDeleteClassSchedule = async () => {
    if (isNaN(bulkYear) || bulkYear < 2000) { toast.error("Enter a valid year first"); return; }
    setDeletingClass(true);
    try {
      await deleteBatch.mutateAsync({ cls: filterCls, examType: filterExam, year: bulkYear });
      toast.success(`Cleared the ${examTypeLabel(filterExam)} schedule for Class ${filterCls}`);
    } catch {
      toast.error("Failed to clear schedule");
    }
    setDeletingClass(false);
  };

  // ── PDF export: single class or all classes combined ──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"single" | "all">("single");
  const [exportCls, setExportCls] = useState("6");
  const [exportExam, setExportExam] = useState("1st Semester");
  const [exportTerm, setExportTerm] = useState<0 | 1>(0); // 0 = 1st Semester / Mid-Term, 1 = 2nd Semester / Final-Term

  // ── Single-class PDF section: # / Subject / Date / Day / Time, all centered ──
  const buildPdfForClass = (doc: jsPDF, cls: string, examType: string) => {
    const entries = allEntries
      .filter(e => e.class === cls && e.exam_type === examType && e.year === bulkYear)
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
    if (!entries.length) return false;

    const w = doc.internal.pageSize.getWidth();

    // ── Header — clean grayscale, double-line accent, matches other school PDFs ──
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.8);
    doc.line(0, 36, w, 36);
    doc.setLineWidth(0.3);
    doc.line(0, 37.5, w, 37.5);

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Government High School Babi Khel", w / 2, 14, { align: "center" });
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("District Mohmand, KPK", w / 2, 21, { align: "center" });

    doc.setTextColor(60, 60, 60);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("EXAM DATE SHEET", w / 2, 30, { align: "center" });

    // ── Info box ──
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(12, 42, w - 24, 16, 2, 2, "F");
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    doc.roundedRect(12, 42, w - 24, 16, 2, 2, "S");

    const infoItems = [
      { label: "CLASS", value: `Class ${cls}` },
      { label: "EXAM", value: examTypeLabel(examType) },
      { label: "YEAR", value: String(bulkYear) },
      { label: "PAPERS", value: String(entries.length) },
    ];
    const infoW = (w - 24) / infoItems.length;
    infoItems.forEach((item, i) => {
      const cx = 12 + i * infoW + infoW / 2;
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.text(item.label, cx, 47.5, { align: "center" });
      doc.setTextColor(40, 40, 40);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(item.value, cx, 54, { align: "center" });
    });

    const tableBody = entries.map((e, idx) => [
      String(idx + 1),
      e.subject,
      format(parseD(e.exam_date), "dd MMM yyyy"),
      format(parseD(e.exam_date), "EEEE"),
      timeRange(e.start_time, e.end_time),
    ]);

    autoTable(doc, {
      startY: 64,
      head: [["#", "Subject", "Date", "Day", "Time"]],
      body: tableBody,
      tableWidth: w - 24,
      styles: {
        fontSize: 9,
        cellPadding: 3,
        valign: "middle",
        halign: "center",
        textColor: [40, 40, 40],
        overflow: "linebreak",
        lineColor: [200, 200, 200],
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [60, 60, 60],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center",
      },
      columnStyles: {
        0: { cellWidth: (w - 24) * 0.07 },
        1: { cellWidth: (w - 24) * 0.27 },
        2: { cellWidth: (w - 24) * 0.22 },
        3: { cellWidth: (w - 24) * 0.17 },
        4: { cellWidth: (w - 24) * 0.27 },
      },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { left: 12, right: 12, bottom: 20 },
    });

    return true;
  };

  // ── All-classes PDF: ONE A4-landscape page, ONE combined table ──
  // Rows = every exam date (sorted); columns = Date · Day · one column per class.
  // Each class cell shows that class's paper (subject + 12-hour time) for the date,
  // or "—" when the class has no paper that day. `termIdx` picks the exam term per
  // class (0 = 1st Semester / Annual-I, 1 = 2nd Semester / Annual-II), so classes 6–8
  // and 9–10 line up on the same exam period despite their different naming.
  // Row height is computed from the number of dates so the table always fills the
  // page without overflowing; every cell is centred horizontally and vertically.
  const buildCombinedPdf = (termIdx: number): jsPDF | null => {
    type Item = { subject: string; time: string };
    const colsMeta: { cls: string; examType: string }[] = [];
    const itemsByClass = new Map<string, Map<string, Item[]>>(); // class → date → papers
    const dateSet = new Set<string>();

    for (const cls of classes) {
      const types = getExamTypes(cls);
      const examType = types[termIdx] ?? types[0];
      const entries = allEntries
        .filter(e => e.class === cls && e.exam_type === examType && e.year === bulkYear)
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date) || (a.start_time || "").localeCompare(b.start_time || ""));
      if (!entries.length) continue;
      colsMeta.push({ cls, examType });
      const perDate = new Map<string, Item[]>();
      for (const e of entries) {
        dateSet.add(e.exam_date);
        const list = perDate.get(e.exam_date) ?? [];
        list.push({ subject: e.subject, time: timeRange(e.start_time, e.end_time) });
        perDate.set(e.exam_date, list);
      }
      itemsByClass.set(cls, perDate);
    }
    if (!colsMeta.length) return null;

    const dates = [...dateSet].sort();
    // A date row is as tall as its busiest class cell (normally 1 paper).
    const rowUnits = dates.map(d => Math.max(1, ...colsMeta.map(c => itemsByClass.get(c.cls)?.get(d)?.length ?? 0)));
    const totalUnits = rowUnits.reduce((a, b) => a + b, 0);

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();   // 297
    const pageH = doc.internal.pageSize.getHeight();  // 210
    const M = 10;
    const startY = 31;
    const bottom = 16;           // room for the footer drawn in finalizeAndSave
    const headH = 11;
    const available = pageH - startY - bottom - headH;
    const unitH = Math.max(8, Math.min(16, available / totalUnits));
    const baseFs = Math.max(6, Math.min(10, unitH * 0.72));

    const dateW = 30;
    const dayW = 24;
    const classW = (pageW - M * 2 - dateW - dayW) / colsMeta.length;

    const drawHeader = () => {
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.7);
      doc.line(0, 25, pageW, 25);
      doc.setLineWidth(0.3);
      doc.line(0, 26.3, pageW, 26.3);
      doc.setTextColor(40, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("Government High School Babi Khel", pageW / 2, 10, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 100, 100);
      doc.text("District Mohmand, KPK", pageW / 2, 15.5, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(60, 60, 60);
      doc.text(`EXAM DATE SHEET — ALL CLASSES · ${bulkYear}`, pageW / 2, 22, { align: "center" });
    };

    const head = [["DATE", "DAY", ...colsMeta.map(c => `Class ${c.cls}`)]];
    const body = dates.map(d => {
      const dt = parseD(d);
      return [
        format(dt, "dd MMM yyyy"),
        format(dt, "EEEE"),
        ...colsMeta.map(c => ((itemsByClass.get(c.cls)?.get(d)?.length ?? 0) > 0 ? "" : "—")),
      ];
    });

    // Draws one paper (bold subject, lighter time) centred in the given box, shrinking
    // the font if a long subject name would wrap beyond the available height.
    const drawItem = (item: Item, cx: number, top: number, h: number, w: number) => {
      let fs = baseFs;
      let lines: string[] = [];
      let l1 = 0;
      let l2 = 0;
      let total = 0;
      for (;;) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(fs);
        lines = doc.splitTextToSize(item.subject, w);
        l1 = fs * 0.3528 * 1.2;
        l2 = (fs - 1.3) * 0.3528 * 1.2;
        total = lines.length * l1 + 0.8 + l2;
        if (total <= h - 0.6 || fs <= 5) break;
        fs -= 0.5;
      }
      const y0 = top + (h - total) / 2;
      doc.setTextColor(30, 30, 30);
      lines.forEach((ln, i) => doc.text(ln, cx, y0 + l1 * (i + 0.5), { align: "center", baseline: "middle" }));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fs - 1.3);
      doc.setTextColor(95, 95, 95);
      doc.text(item.time, cx, y0 + lines.length * l1 + 0.8 + l2 / 2, { align: "center", baseline: "middle" });
    };

    autoTable(doc, {
      startY,
      head,
      body,
      theme: "grid",
      tableWidth: pageW - M * 2,
      margin: { left: M, right: M, top: startY, bottom },
      styles: {
        fontSize: Math.max(7, Math.min(9.5, baseFs)),
        cellPadding: 0.5,
        halign: "center",
        valign: "middle",
        textColor: [40, 40, 40],
        lineColor: [190, 190, 190],
        lineWidth: 0.25,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [238, 238, 238],
        textColor: [50, 50, 50],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center",
        valign: "middle",
        minCellHeight: headH,
      },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { cellWidth: dateW, fontStyle: "bold" },
        1: { cellWidth: dayW },
        ...Object.fromEntries(colsMeta.map((_, i) => [i + 2, { cellWidth: classW }])),
      },
      didParseCell: (data) => {
        if (data.section === "body") {
          data.cell.styles.minCellHeight = unitH * rowUnits[data.row.index];
          if (data.cell.text.join("") === "—") data.cell.styles.textColor = [170, 170, 170];
        } else if (data.section === "head" && data.column.index >= 2) {
          data.cell.text = [""]; // drawn manually below (class + exam type, two lines)
        }
      },
      didDrawCell: (data) => {
        const { cell, column, row, section } = data;
        const cx = cell.x + cell.width / 2;
        if (section === "head" && column.index >= 2) {
          const meta = colsMeta[column.index - 2];
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(40, 40, 40);
          doc.text(`CLASS ${meta.cls}`, cx, cell.y + cell.height / 2 - 1.6, { align: "center", baseline: "middle" });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(100, 100, 100);
          doc.text(examTypeLabel(meta.examType), cx, cell.y + cell.height / 2 + 2.4, { align: "center", baseline: "middle" });
          return;
        }
        if (section === "body" && column.index >= 2) {
          const meta = colsMeta[column.index - 2];
          const items = itemsByClass.get(meta.cls)?.get(dates[row.index]) ?? [];
          if (!items.length) return;
          const slotH = cell.height / items.length;
          items.forEach((it, i) => drawItem(it, cx, cell.y + slotH * i, slotH, cell.width - 3));
        }
      },
      didDrawPage: () => drawHeader(),
    });

    return doc;
  };

  const runExport = () => {
    if (isNaN(bulkYear) || bulkYear < 2000) { toast.error("Enter a valid year first"); return; }

    if (exportScope === "single") {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const wrote = buildPdfForClass(doc, exportCls, exportExam);
      if (!wrote) { toast.error(`No schedule found for Class ${exportCls} · ${exportExam} · ${bulkYear}`); return; }
      finalizeAndSave(doc, `Exam-Date-Sheet-Class-${exportCls}-${exportExam.replace(/\s+/g, "-")}-${bulkYear}.pdf`);
    } else {
      // One A4-landscape page, one combined table for every class
      const doc = buildCombinedPdf(exportTerm);
      if (!doc) { toast.error(`No ${exportTerm === 0 ? "first" : "second"}-term schedule found for ${bulkYear} yet`); return; }
      finalizeAndSave(doc, `Exam-Date-Sheet-All-Classes-${exportTerm === 0 ? "1st" : "2nd"}-Term-${bulkYear}.pdf`);
    }
  };

  const finalizeAndSave = (doc: jsPDF, filename: string) => {
    // ── Footer page numbers, muted ──
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(10, h - 14, w - 10, h - 14);
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 140);
      doc.text(`Page ${p} of ${totalPages}`, w - 10, h - 8, { align: "right" });
      doc.text("Generated by GHS Babi Khel Admin Panel", 10, h - 8);
    }
    doc.save(filename);
    setExportOpen(false);
    toast.success("Exam schedule PDF downloaded");
  };

  // ── Display helpers ──
  const sortedFiltered = [...filtered].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  const firstDate = sortedFiltered[0]?.exam_date;
  const lastDate = sortedFiltered[sortedFiltered.length - 1]?.exam_date;

  // Live "will it fit?" hint for the Auto Fill dialog — mirrors runAutoFill's Sunday/gap walk
  const afFit: number | null = (() => {
    if (!afRangeStart || !afRangeEnd) return null;
    const s = new Date(afRangeStart);
    const e = new Date(afRangeEnd);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return null;
    const gap = Math.max(0, parseInt(afGapDays, 10) || 0);
    let c = s;
    let n = 0;
    for (;;) {
      while (isSunday(c)) c = addDays(c, 1);
      if (c > e) break;
      n++;
      c = addDays(c, 1 + gap);
    }
    return n;
  })();

  const gapNum = Math.max(0, parseInt(afGapDays, 10) || 0);
  const afAvailableToCustomize = afSelectedSubjects.filter(s => !afOverrides[s]);

  return (
    <div className="space-y-4 min-w-0 pb-20 md:pb-0">
      {/* ── Premium header banner ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <CalendarDays className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Exam Date Sheet</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Auto-generate, review and export exam schedules for every class.</p>
          </div>
        </div>
        <div className="relative mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-6 items-center rounded-full border border-border/60 bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground">Class {filterCls}</span>
          <span className="inline-flex h-6 items-center rounded-full border border-border/60 bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground">{examTypeLabel(filterExam)}</span>
          <span className="inline-flex h-6 items-center rounded-full border border-border/60 bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "paper" : "papers"}
          </span>
          {firstDate && lastDate && (
            <span className="inline-flex h-6 items-center rounded-full border border-border/60 bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground">
              {format(parseD(firstDate), "dd MMM")} – {format(parseD(lastDate), "dd MMM")}
            </span>
          )}
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button size="sm" onClick={openAutoFill} className={`${thinBtn} flex-1 bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none`}>
            <Wand2 /> Auto Fill
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setExportCls(bulkCls); setExportExam(bulkExam); setExportTerm(getExamTypes(bulkCls).indexOf(bulkExam) === 1 ? 1 : 0); setExportOpen(true); }} className={`${thinBtn} flex-1 border-border/60 sm:flex-none`}>
            <Download /> Download PDF
          </Button>
        </div>
      </div>

      {/* ── Generator card ── */}
      <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
        <CardContent className="space-y-3 p-3.5 sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm font-semibold text-foreground">Create Schedule</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Class</Label>
              <Select value={bulkCls} onValueChange={v => { setBulkCls(v); setBulkExam(getExamTypes(v)[0]); }}>
                <SelectTrigger className="h-9 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Exam Type</Label>
              <Select value={bulkExam} onValueChange={setBulkExam}>
                <SelectTrigger className="h-9 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
                <SelectContent>{getExamTypes(bulkCls).map(e => <SelectItem key={e} value={e}>{examTypeLabel(e)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
              <Label className="text-[11px] text-muted-foreground">Year</Label>
              <Input type="number" inputMode="numeric" value={bulkYearInput} onChange={e => setBulkYearInput(e.target.value)} className={fieldCls} placeholder="2026" />
            </div>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground">
            Auto Fill generates and saves a shuffled schedule for the selected class — Sundays are skipped automatically.
          </p>
        </CardContent>
      </Card>

      {/* ── Auto Fill dialog ── */}
      <Dialog open={autoFillOpen} onOpenChange={setAutoFillOpen}>
        <DialogContent className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
          <DialogHeader className="space-y-1 border-b border-border/60 bg-gradient-to-b from-secondary/70 to-transparent px-4 pb-3 pt-4 pr-11 text-left">
            <DialogTitle className="flex items-center gap-2 text-base leading-snug">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Wand2 className="h-3.5 w-3.5" />
              </span>
              Auto Fill Schedule
            </DialogTitle>
            <DialogDescription className="text-xs">
              Class {bulkCls} · {examTypeLabel(bulkExam)} · {bulkYearInput || "—"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
            {/* 1 · Subjects */}
            <Section
              n={1}
              title="Subjects"
              aside={
                <div className="flex shrink-0 items-center gap-2.5 text-[11px] font-semibold">
                  <span className="text-muted-foreground">{afSelectedSubjects.length}/{getSubjects(bulkCls).length}</span>
                  <button type="button" onClick={() => setAfSelectedSubjects(getSubjects(bulkCls))} className="text-primary">All</button>
                  <button type="button" onClick={() => setAfSelectedSubjects([])} className="text-muted-foreground">None</button>
                </div>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {getSubjects(bulkCls).map(s => {
                  const on = afSelectedSubjects.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleAfSubject(s)}
                      className={`inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border/60 bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                    >
                      {on && <Check className="h-3 w-3" />}
                      {s}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">Unselected subjects are skipped — no paper is generated for them.</p>
            </Section>

            {/* 2 · Timing */}
            <Section n={2} title="Exam timing">
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 space-y-1">
                  <Label className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Start</Label>
                  <Input type="time" value={afDefaultStart} onChange={e => setAfDefaultStart(e.target.value)} className={fieldCls} />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> End</Label>
                  <Input type="time" value={afDefaultEnd} onChange={e => setAfDefaultEnd(e.target.value)} className={fieldCls} />
                </div>
              </div>

              <div className="space-y-1.5 border-t border-dashed border-border pt-2.5">
                <Label className="text-[11px] text-muted-foreground">Custom time for one paper (optional)</Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Select value={afCustomizing} onValueChange={setAfCustomizing}>
                      <SelectTrigger className="h-9 rounded-full border-border/60 bg-card text-xs shadow-none"><SelectValue placeholder="Choose a subject…" /></SelectTrigger>
                      <SelectContent>
                        {afAvailableToCustomize.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!afCustomizing}
                    aria-label="Add custom time"
                    onClick={() => {
                      if (!afCustomizing) return;
                      const subj = afCustomizing;
                      setAfOverrides(cur => ({ ...cur, [subj]: { start: afDefaultStart, end: afDefaultEnd } }));
                      setAfCustomizing("");
                    }}
                    className="h-9 w-9 shrink-0 rounded-full border-border/60 p-0 shadow-none"
                  >
                    <Plus />
                  </Button>
                </div>

                {Object.keys(afOverrides).length > 0 && (
                  <div className="space-y-1.5 pt-0.5">
                    {Object.entries(afOverrides).map(([s, ov]) => (
                      <div key={s} className="space-y-1.5 rounded-xl border border-border/60 bg-card p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 break-words text-xs font-semibold text-foreground">{s}</span>
                          <button
                            type="button"
                            aria-label={`Remove custom time for ${s}`}
                            onClick={() => { clearAfOverride(s); setAfCustomizing(""); }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input type="time" value={ov.start} onChange={e => setAfOverride(s, "start", e.target.value)} className={fieldCls} />
                          <Input type="time" value={ov.end} onChange={e => setAfOverride(s, "end", e.target.value)} className={fieldCls} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* 3 · Dates */}
            <Section n={3} title="Exam dates">
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0 space-y-1">
                  <Label className="flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" /> From</Label>
                  <Input type="date" value={afRangeStart} onChange={e => setAfRangeStart(e.target.value)} className={fieldCls} />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label className="flex items-center gap-1 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" /> To</Label>
                  <Input type="date" value={afRangeEnd} onChange={e => setAfRangeEnd(e.target.value)} className={fieldCls} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-dashed border-border pt-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">Rest days between papers</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">0 = a paper every day</p>
                </div>
                <div className="inline-flex shrink-0 items-center rounded-full border border-border bg-card">
                  <button
                    type="button"
                    aria-label="Decrease rest days"
                    onClick={() => setAfGapDays(String(Math.max(0, gapNum - 1)))}
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-primary"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Rest days between papers"
                    value={afGapDays}
                    onChange={e => setAfGapDays(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    className="h-8 w-9 bg-transparent text-center text-base font-semibold text-foreground outline-none sm:text-sm"
                  />
                  <button
                    type="button"
                    aria-label="Increase rest days"
                    onClick={() => setAfGapDays(String(Math.min(99, gapNum + 1)))}
                    className="flex h-8 w-8 items-center justify-center text-muted-foreground active:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {afFit !== null && (
                <p className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-snug ${afFit >= afSelectedSubjects.length ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    {afFit >= afSelectedSubjects.length
                      ? `${afSelectedSubjects.length} papers fit — ${afFit} exam days available.`
                      : `Only ${afFit} of ${afSelectedSubjects.length} papers fit — widen the range or reduce the rest days.`}
                  </span>
                </p>
              )}
            </Section>

            <p className="flex items-start gap-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
              <Shuffle className="mt-px h-3 w-3 shrink-0" />
              <span>Subject order is shuffled each time — generate again for a different arrangement.</span>
            </p>
          </div>

          <DialogFooter className="flex-row gap-2 border-t border-border/60 bg-card px-4 py-3 sm:justify-end sm:space-x-0">
            <Button variant="outline" size="sm" onClick={() => setAutoFillOpen(false)} className={`${thinBtn} flex-1 sm:flex-none`}>Cancel</Button>
            <Button size="sm" onClick={runAutoFill} disabled={saving} className={`${thinBtn} flex-1 sm:flex-none`}>
              {saving ? <Loader2 className="animate-spin" /> : <Wand2 />} Generate &amp; Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Export PDF dialog ── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="flex max-h-[88dvh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="space-y-1 border-b border-border/60 bg-gradient-to-b from-secondary/70 to-transparent px-4 pb-3 pt-4 pr-11 text-left">
            <DialogTitle className="flex items-center gap-2 text-base leading-snug">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Download className="h-3.5 w-3.5" />
              </span>
              Download Date Sheet
            </DialogTitle>
            <DialogDescription className="text-xs">PDF for year {bulkYearInput || "—"}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div className="inline-flex h-10 w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setExportScope("single")}
                className={`h-8 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${exportScope === "single" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                Single Class
              </button>
              <button
                type="button"
                onClick={() => setExportScope("all")}
                className={`h-8 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${exportScope === "all" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                All Classes
              </button>
            </div>

            {exportScope === "single" && (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="min-w-0 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Class</Label>
                  <Select value={exportCls} onValueChange={v => { setExportCls(v); setExportExam(getExamTypes(v)[0]); }}>
                    <SelectTrigger className="h-9 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Exam Type</Label>
                  <Select value={exportExam} onValueChange={setExportExam}>
                    <SelectTrigger className="h-9 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>{getExamTypes(exportCls).map(e => <SelectItem key={e} value={e}>{examTypeLabel(e)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {exportScope === "all" && (
              <div className="space-y-2.5">
                <div className="inline-flex h-10 w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
                  {([0, 1] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setExportTerm(t)}
                      className={`h-8 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${exportTerm === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                    >
                      {t === 0 ? "1st Term" : "2nd Term"}
                    </button>
                  ))}
                </div>
                <p className="rounded-xl bg-secondary/40 p-3 text-xs leading-snug text-muted-foreground">
                  One A4 landscape page with <strong className="text-foreground">all classes in a single table</strong> for {bulkYear}.
                  Classes 6–8: {getExamTypes("6")[exportTerm]} · Classes 9–10: {examTypeLabel(getExamTypes("9")[exportTerm])}.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 border-t border-border/60 bg-card px-4 py-3 sm:justify-end sm:space-x-0">
            <Button variant="outline" size="sm" onClick={() => setExportOpen(false)} className={`${thinBtn} flex-1 sm:flex-none`}>Cancel</Button>
            <Button size="sm" onClick={runExport} className={`${thinBtn} flex-1 sm:flex-none`}><Download /> Download</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Class + exam selectors ── */}
      <div className="space-y-2.5">
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
            {classes.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { setFilterCls(c); setFilterExam(getExamTypes(c)[0]); }}
                className={`h-8 shrink-0 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-all ${filterCls === c ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                Class {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
              {getExamTypes(filterCls).map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setFilterExam(e)}
                  className={`h-8 shrink-0 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-all ${filterExam === e ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                >
                  {examTypeLabel(e)}
                </button>
              ))}
            </div>
          </div>

          {filtered.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 /> Delete Schedule
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-base">Delete Class {filterCls} · {examTypeLabel(filterExam)} schedule?</AlertDialogTitle>
                  <AlertDialogDescription>This removes all {filtered.length} exam entries for this class and exam type at once. This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                  <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteClassSchedule} disabled={deletingClass} className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none">
                    {deletingClass && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Delete All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── Schedule list ── */}
      {isLoading ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : sortedFiltered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 bg-secondary/20 px-4 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold text-foreground">No schedule yet</p>
          <p className="max-w-xs text-xs leading-snug text-muted-foreground">
            Class {filterCls} · {examTypeLabel(filterExam)} has no papers. Use Auto Fill to generate one.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedFiltered.map(e => (
            <div key={e.id} className="flex items-stretch gap-3 rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm">
              <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-primary to-primary/80 py-1.5 text-primary-foreground">
                <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">{format(parseD(e.exam_date), "EEE")}</span>
                <span className="text-lg font-black leading-none">{format(parseD(e.exam_date), "dd")}</span>
                <span className="text-[10px] font-semibold uppercase">{format(parseD(e.exam_date), "MMM")}</span>
              </div>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="break-words text-sm font-semibold leading-snug text-foreground">{e.subject}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{format(parseD(e.exam_date), "EEEE, dd MMMM yyyy")}</p>
                {(e.start_time || e.hall) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {e.start_time && (
                      <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">
                        <Clock className="h-3 w-3" />
                        {e.end_time ? timeRange(e.start_time, e.end_time) : fmt12(e.start_time)}
                      </span>
                    )}
                    {e.hall && (
                      <span className="inline-flex h-5 items-center whitespace-nowrap rounded-full bg-gold-soft px-2 text-[11px] font-medium text-gold-strong">
                        Hall: {e.hall}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${e.subject}`} className="h-8 w-8 shrink-0 self-start rounded-full p-0 text-muted-foreground hover:text-destructive [&_svg]:size-3.5">
                    <Trash2 />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-base">Delete this exam entry?</AlertDialogTitle>
                    <AlertDialogDescription>{e.subject} · {format(parseD(e.exam_date), "dd MMM yyyy")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                    <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteEntry.mutateAsync(e.id)} className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
