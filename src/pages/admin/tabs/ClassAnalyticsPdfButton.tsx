import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDown, Loader2, Layers } from "lucide-react";
import { termSlot, examTypeVariants } from "@/utils/examTerm";
import type { ResultWithStudent } from "@/hooks/useResultsEnhanced";
import type jsPDF from "jspdf";

// jsPDF is fetched only when the admin actually exports a PDF.
let jsPDFCtor: typeof import("jspdf").default | null = null;
let autoTable: typeof import("jspdf-autotable").default;
const ensureJsPDF = async () => {
  if (!jsPDFCtor) {
    jsPDFCtor = (await import("jspdf")).default;
    autoTable = (await import("jspdf-autotable")).default;
  }
  return jsPDFCtor;
};

// ─── Subject lists per class group ───────────────────────────────────────────
const SUBJECTS_6_TO_8 = [
  "English",
  "Urdu",
  "Islamiyat",
  "M.Quran",
  "Arabic",
  "Geography",
  "Pashto",
  "Maths",
  "History",
  "G.Science",
  "Computer Science",
];

const SUBJECTS_9_TO_10 = [
  "English",
  "Urdu",
  "Pak-study",
  "Chemistry",
  "Physics",
  "Computer Science",
  "Biology",
  "Islamiyat",
  "M.Quran",
  "Mathematics",
];

function getSubjects(cls: string): string[] {
  return ["9", "10"].includes(cls) ? SUBJECTS_9_TO_10 : SUBJECTS_6_TO_8;
}

// ─── Palette: soft, light, professional (no deep fills) ─────────────────────
type RGB = [number, number, number];
const P = {
  ink:     [44, 44, 44]    as RGB,
  sub:     [100, 100, 100] as RGB,
  muted:   [138, 138, 138] as RGB,
  line:    [226, 226, 220] as RGB,
  white:   [255, 255, 255] as RGB,
  accent:  [92, 134, 108]  as RGB,   // soft sage
  tint:    [239, 245, 241] as RGB,   // pale sage panel
  gold:    [184, 150, 80]  as RGB,
  goldTint:[250, 245, 230] as RGB,
  alt:     [250, 250, 247] as RGB,
  pass:    [70, 135, 96]   as RGB,
  fail:    [186, 90, 90]   as RGB,
  track:   [235, 235, 230] as RGB,
};
const fillC = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const drawC = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);
const textC = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);

interface AnalyticsPdfInput { cls: string; year: number; subjects: string[]; results: ResultWithStudent[]; }

function computeAnalyticsPdfData({ cls, year, subjects, results }: AnalyticsPdfInput) {
  const total = results.length;
  const passCount = results.filter((r) => r.is_pass).length;
  const failCount = total - passCount;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const passRate = total > 0 ? round1((passCount / total) * 100) : 0;
  const avgPct = total > 0 ? round1(results.reduce((s, r) => s + (r.percentage || 0), 0) / total) : 0;
  const highest = total > 0 ? round1(Math.max(...results.map((r) => r.percentage || 0))) : 0;
  const lowest = total > 0 ? round1(Math.min(...results.map((r) => r.percentage || 0))) : 0;

  const gradeBuckets = [
    { label: "80% and above", min: 80, max: 100.001 },
    { label: "60% – 79%", min: 60, max: 80 },
    { label: "40% – 59%", min: 40, max: 60 },
    { label: "Below 40%", min: 0, max: 40 },
  ].map((b) => ({ ...b, count: results.filter((r) => (r.percentage || 0) >= b.min && (r.percentage || 0) < b.max).length }));

  // Only subjects somebody actually has marks in (an unexamined subject is dropped).
  const subjectAverages = subjects
    .map((subject) => {
      const pcts: number[] = [];
      for (const r of results) {
        const sm = r.subject_marks?.[subject];
        if (sm && sm.total > 0) pcts.push((sm.obtained / sm.total) * 100);
      }
      return {
        subject,
        appeared: pcts.length,
        average: pcts.length ? round1(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0,
        highest: pcts.length ? round1(Math.max(...pcts)) : 0,
        lowest: pcts.length ? round1(Math.min(...pcts)) : 0,
        hasData: pcts.length > 0,
      };
    })
    .filter((s) => s.hasData);

  const topStudents = [...results]
    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
    .slice(0, 5)
    .map((r, i) => ({ rank: i + 1, name: r.students?.full_name ?? "—", roll: r.students?.roll_number ?? "—", pct: round1(r.percentage || 0) }));

  const strongestSubject = subjectAverages.reduce((b, s) => (s.average > (b?.average ?? -1) ? s : b), null as (typeof subjectAverages)[number] | null);
  const weakestSubject = subjectAverages.reduce((w, s) => (s.average < (w?.average ?? 101) ? s : w), null as (typeof subjectAverages)[number] | null);

  return { cls, year, total, passCount, failCount, passRate, avgPct, highest, lowest, gradeBuckets, subjectAverages, topStudents, strongestSubject, weakestSubject };
}
type AnalyticsData = ReturnType<typeof computeAnalyticsPdfData>;

// ─── Shared drawing helpers ─────────────────────────────────────────────────
const PAGE_W = 210, PAGE_H = 297, MX = 14;

function drawHeader(doc: jsPDF, title: string, subtitle: string): number {
  fillC(doc, P.tint);
  doc.rect(0, 0, PAGE_W, 34, "F");
  fillC(doc, P.gold);
  doc.rect(0, 34, PAGE_W, 0.8, "F");
  textC(doc, P.ink);
  doc.setFont("times", "bold"); doc.setFontSize(18);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", PAGE_W / 2, 16, { align: "center" });
  textC(doc, P.sub);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text("DISTRICT MOHMAND   ·   KHYBER PAKHTUNKHWA", PAGE_W / 2, 24, { align: "center" });

  textC(doc, P.ink);
  doc.setFont("times", "bold"); doc.setFontSize(17);
  doc.text(title, PAGE_W / 2, 49, { align: "center", maxWidth: PAGE_W - 28 });
  drawC(doc, P.gold); doc.setLineWidth(0.5);
  doc.line(PAGE_W / 2 - 13, 53.5, PAGE_W / 2 + 13, 53.5);
  textC(doc, P.sub);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(subtitle, PAGE_W / 2, 59.5, { align: "center", maxWidth: PAGE_W - 28 });
  return 67;
}

function drawRunningHeader(doc: jsPDF, title: string) {
  fillC(doc, P.tint); doc.rect(0, 0, PAGE_W, 10, "F");
  fillC(doc, P.gold); doc.rect(0, 10, PAGE_W, 0.5, "F");
  textC(doc, P.ink); doc.setFont("times", "bold"); doc.setFontSize(9);
  doc.text(`GHS BABI KHEL  ·  ${title}`, PAGE_W / 2, 6.6, { align: "center", maxWidth: PAGE_W - 28 });
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  textC(doc, P.ink); doc.setFont("times", "bold"); doc.setFontSize(11.5);
  doc.text(text, PAGE_W / 2, y, { align: "center" });
  drawC(doc, P.line); doc.setLineWidth(0.25);
  const half = doc.getTextWidth(text) / 2;
  doc.line(MX, y - 1.4, PAGE_W / 2 - half - 4, y - 1.4);
  doc.line(PAGE_W / 2 + half + 4, y - 1.4, PAGE_W - MX, y - 1.4);
  return y + 3;
}

function ensureSpace(doc: jsPDF, y: number, need: number, title: string): number {
  if (y + need <= PAGE_H - 20) return y;
  doc.addPage(); drawRunningHeader(doc, title);
  return 18;
}

function kpiRow(doc: jsPDF, y: number, items: [string, string][]): number {
  const gap = 4, ch = 17;
  const cw = (PAGE_W - MX * 2 - gap * (items.length - 1)) / items.length;
  items.forEach(([label, value], i) => {
    const x = MX + i * (cw + gap);
    fillC(doc, P.alt); drawC(doc, P.line); doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cw, ch, 2, 2, "FD");
    textC(doc, P.accent); doc.setFont("times", "bold"); doc.setFontSize(14.5);
    doc.text(value, x + cw / 2, y + 9.2, { align: "center", maxWidth: cw - 3 });
    textC(doc, P.muted); doc.setFont("helvetica", "bold"); doc.setFontSize(6.3);
    doc.text(label.toUpperCase(), x + cw / 2, y + 14, { align: "center" });
  });
  return y + ch + 6;
}

const finalY = (doc: jsPDF) => ((doc as any).lastAutoTable?.finalY ?? 0) as number;

/** Shared table look: centred, soft sage header, light grid. */
function table(doc: jsPDF, opts: {
  startY: number; head: string[]; body: (string | number)[][];
  widths?: number[]; title: string; bars?: { col: number; pcts: number[]; color?: RGB };
  boldCols?: number[]; nameCols?: number[]; highlightTop?: number;
}) {
  const columnStyles: Record<number, any> = {};
  (opts.widths ?? []).forEach((w, i) => { columnStyles[i] = { cellWidth: w }; });
  autoTable(doc, {
    startY: opts.startY,
    theme: "grid",
    head: [opts.head],
    body: opts.body,
    styles: { font: "helvetica", fontSize: 8.6, halign: "center", valign: "middle", textColor: P.ink, lineColor: P.line, lineWidth: 0.2, cellPadding: { top: 1.9, bottom: 1.9, left: 1.5, right: 1.5 } },
    headStyles: { fillColor: P.accent, textColor: P.white, fontStyle: "bold", fontSize: 8, lineColor: P.accent },
    alternateRowStyles: { fillColor: P.alt },
    columnStyles,
    margin: { top: 16, left: MX, right: MX, bottom: 18 },
    didParseCell: (c: any) => {
      if (c.section !== "body") return;
      if (opts.highlightTop && c.row.index < opts.highlightTop) c.cell.styles.fillColor = P.goldTint;
      if (opts.boldCols?.includes(c.column.index)) c.cell.styles.fontStyle = "bold";
      if (opts.nameCols?.includes(c.column.index)) { c.cell.styles.font = "times"; c.cell.styles.fontSize = 10; }
      if (opts.bars && c.column.index === opts.bars.col) c.cell.text = [""];
    },
    didDrawCell: (c: any) => {
      if (c.section !== "body" || !opts.bars || c.column.index !== opts.bars.col) return;
      const pct = Math.max(0, Math.min(100, opts.bars.pcts[c.row.index] ?? 0));
      const bw = c.cell.width - 8, bh = 2.6;
      const bx = c.cell.x + 4, by = c.cell.y + c.cell.height / 2 - bh / 2;
      fillC(doc, P.track); doc.roundedRect(bx, by, bw, bh, 1.3, 1.3, "F");
      if (pct > 0) { fillC(doc, opts.bars.color ?? P.accent); doc.roundedRect(bx, by, Math.max(2.6, (bw * pct) / 100), bh, 1.3, 1.3, "F"); }
    },
    didDrawPage: (d: any) => { if (d.pageNumber > 1) drawRunningHeader(doc, opts.title); },
  });
}

function addFooters(doc: jsPDF) {
  const pages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawC(doc, P.line); doc.setLineWidth(0.25);
    doc.line(MX, PAGE_H - 13, PAGE_W - MX, PAGE_H - 13);
    textC(doc, P.muted); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text("GHS Babi Khel  ·  Result Analysis", MX, PAGE_H - 8);
    doc.text(`Page ${p} of ${pages}`, PAGE_W - MX, PAGE_H - 8, { align: "right" });
  }
}

// ─── Single-class report ────────────────────────────────────────────────────
function generateClassAnalyticsPdf(data: AnalyticsData, termLabel: string) {
  const doc = new jsPDFCtor!({ orientation: "portrait", unit: "mm", format: "a4" });
  const title = `CLASS ${data.cls} — RESULT ANALYSIS`;
  let y = drawHeader(doc, title, `${termLabel} ${data.year}   ·   ${data.total} Students`);

  y = kpiRow(doc, y, [["Students", String(data.total)], ["Passed", String(data.passCount)], ["Failed", String(data.failCount)], ["Pass Rate", `${data.passRate}%`]]);
  y = kpiRow(doc, y, [["Class Average", `${data.avgPct}%`], ["Highest", `${data.highest}%`], ["Lowest", `${data.lowest}%`]]);

  y = sectionTitle(doc, "Performance Bands", y + 2);
  table(doc, {
    startY: y, title, head: ["Band", "Students", "Share", "Distribution"],
    body: data.gradeBuckets.map((b) => [b.label, b.count, `${data.total ? Math.round((b.count / data.total) * 100) : 0}%`, ""]),
    widths: [50, 30, 30, 72],
    bars: { col: 3, pcts: data.gradeBuckets.map((b) => (data.total ? (b.count / data.total) * 100 : 0)) },
    boldCols: [1],
  });

  if (data.subjectAverages.length) {
    y = ensureSpace(doc, finalY(doc) + 10, 40, title);
    y = sectionTitle(doc, "Subject-wise Performance", y);
    table(doc, {
      startY: y, title, head: ["Subject", "Appeared", "Average", "Highest", "Lowest", "Average Bar"],
      body: data.subjectAverages.map((s) => [s.subject, s.appeared, `${s.average}%`, `${s.highest}%`, `${s.lowest}%`, ""]),
      widths: [38, 24, 24, 24, 24, 48],
      bars: { col: 5, pcts: data.subjectAverages.map((s) => s.average) }, boldCols: [2],
    });
  }

  y = ensureSpace(doc, finalY(doc) + 10, 50, title);
  y = sectionTitle(doc, "Top Performers", y);
  table(doc, {
    startY: y, title, head: ["Position", "Roll No", "Student Name", "Percentage"],
    body: data.topStudents.map((t) => [t.rank, t.roll, t.name, `${t.pct}%`]),
    widths: [28, 30, 82, 42], boldCols: [0, 3], nameCols: [2], highlightTop: 3,
  });

  if (data.strongestSubject && data.weakestSubject && data.subjectAverages.length > 1) {
    y = ensureSpace(doc, finalY(doc) + 10, 40, title);
    y = sectionTitle(doc, "Subject Insight", y);
    table(doc, {
      startY: y, title, head: ["", "Subject", "Average"],
      body: [["Strongest", data.strongestSubject.subject, `${data.strongestSubject.average}%`], ["Needs attention", data.weakestSubject.subject, `${data.weakestSubject.average}%`]],
      widths: [50, 80, 52], boldCols: [0, 2],
    });
  }

  addFooters(doc);
  doc.save(`ClassAnalytics_Class${data.cls}_${termLabel.replace(/\s+/g, "")}_${data.year}.pdf`);
}

// ─── All classes combined ───────────────────────────────────────────────────
function generateAllClassesCombinedPdf(year: number, termLabel: string, classDataMap: Map<string, AnalyticsData>) {
  const doc = new jsPDFCtor!({ orientation: "portrait", unit: "mm", format: "a4" });
  const title = "WHOLE SCHOOL — RESULT ANALYSIS";
  const classes = ALL_CLASSES.filter((c) => classDataMap.has(c));
  const ds = classes.map((c) => classDataMap.get(c)!);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const total = ds.reduce((s, d) => s + d.total, 0);
  const passed = ds.reduce((s, d) => s + d.passCount, 0);
  const avg = total ? round1(ds.reduce((s, d) => s + d.avgPct * d.total, 0) / total) : 0;
  const top = ds.length ? Math.max(...ds.map((d) => d.highest)) : 0;

  let y = drawHeader(doc, title, `${termLabel} ${year}   ·   ${total} Students   ·   ${classes.length} Classes`);
  y = kpiRow(doc, y, [["Students", String(total)], ["Passed", String(passed)], ["Pass Rate", `${total ? round1((passed / total) * 100) : 0}%`], ["School Average", `${avg}%`]]);

  y = sectionTitle(doc, "Class-wise Summary", y + 2);
  table(doc, {
    startY: y, title, head: ["Class", "Students", "Passed", "Failed", "Pass Rate", "Average", "Highest"],
    body: [
      ...ds.map((d) => [`Class ${d.cls}`, d.total, d.passCount, d.failCount, `${d.passRate}%`, `${d.avgPct}%`, `${d.highest}%`]),
      ["School", total, passed, total - passed, `${total ? round1((passed / total) * 100) : 0}%`, `${avg}%`, `${top}%`],
    ],
    widths: [28, 27, 26, 26, 26, 25, 24], boldCols: [0, 4],
  });

  y = ensureSpace(doc, finalY(doc) + 10, 50, title);
  y = sectionTitle(doc, "Performance Bands", y);
  table(doc, {
    startY: y, title, head: ["Class", ...ds[0].gradeBuckets.map((b) => b.label)],
    body: ds.map((d) => [`Class ${d.cls}`, ...d.gradeBuckets.map((b) => b.count)]),
    widths: [30, 38, 38, 38, 38], boldCols: [0],
  });

  const groups: [string, string[]][] = [["Subject Averages — Classes 6 to 8", ["6", "7", "8"]], ["Subject Averages — Classes 9 and 10", ["9", "10"]]];
  for (const [label, cs] of groups) {
    const present = cs.filter((c) => classDataMap.has(c));
    if (!present.length) continue;
    const subjects: string[] = [];
    present.forEach((c) => classDataMap.get(c)!.subjectAverages.forEach((s) => { if (!subjects.includes(s.subject)) subjects.push(s.subject); }));
    if (!subjects.length) continue;
    y = ensureSpace(doc, finalY(doc) + 10, 40, title);
    y = sectionTitle(doc, label, y);
    table(doc, {
      startY: y, title, head: ["Subject", ...present.map((c) => `Class ${c}`)],
      body: subjects.map((sub) => [sub, ...present.map((c) => {
        const s = classDataMap.get(c)!.subjectAverages.find((x) => x.subject === sub);
        return s ? `${s.average}%` : "—";
      })]),
      boldCols: [0],
    });
  }

  y = ensureSpace(doc, finalY(doc) + 10, 60, title);
  y = sectionTitle(doc, "Top 3 of Each Class", y);
  const topRows: (string | number)[][] = [];
  ds.forEach((d) => d.topStudents.slice(0, 3).forEach((t) => topRows.push([`Class ${d.cls}`, t.rank, t.roll, t.name, `${t.pct}%`])));
  table(doc, { startY: y, title, head: ["Class", "Position", "Roll No", "Student Name", "Percentage"], body: topRows, widths: [28, 24, 28, 68, 34], boldCols: [0, 4], nameCols: [3] });

  y = ensureSpace(doc, finalY(doc) + 10, 40, title);
  y = sectionTitle(doc, "Subject Insight", y);
  table(doc, {
    startY: y, title, head: ["Class", "Strongest Subject", "Needs Attention"],
    body: ds.map((d) => [`Class ${d.cls}`, d.strongestSubject ? `${d.strongestSubject.subject} (${d.strongestSubject.average}%)` : "—", d.weakestSubject ? `${d.weakestSubject.subject} (${d.weakestSubject.average}%)` : "—"]),
    widths: [30, 76, 76], boldCols: [0],
  });

  addFooters(doc);
  doc.save(`AllClasses_Analytics_${termLabel.replace(/\s+/g, "")}_${year}.pdf`);
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface ClassAnalyticsPdfButtonProps {
  year: number;
  /** The exam currently open in Manage Results — used to pre-select the term. */
  examType?: string;
}

const ALL_CLASSES = ["6", "7", "8", "9", "10"];
const ALL_CLASSES_KEY = "all";

/**
 * Mobile-friendly analytics export (used inside the DMCs sub-tab). Lets the
 * admin pick one or more classes from a checkbox grid — same pattern as the
 * Schedule Publish / Bulk Delete pickers elsewhere in Manage Results — then
 * downloads a single-page vector Class Analytics PDF for each selected
 * class in turn. Each class's results are fetched fresh at click time
 * (not the currently-open class tab), so multiple classes can be exported
 * in one go regardless of which class tab is active.
 *
 * Also provides an "All Classes" button that downloads a SINGLE combined
 * analytics PDF covering classes 6-10 on ONE beautifully designed page
 * (landscape A4) with: overall KPIs, per-class summary cards, pass/fail
 * donut, class comparison bars, grade distribution, subject-wise grouped
 * bars, top 3 performers per class, and subject insights.
 */
export default function ClassAnalyticsPdfButton({ year, examType }: ClassAnalyticsPdfButtonProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [slot, setSlot] = useState<1 | 2>(termSlot(examType || "") === 2 ? 2 : 1);
  const termLabel = slot === 1 ? "1st Semester" : "2nd Semester";
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchClassResults = async (cls: string): Promise<ResultWithStudent[]> => {
    const { data, error } = await supabase
      .from("results")
      .select(
        "id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, is_pass, subject_marks, students(full_name, roll_number)"
      )
      .eq("class", cls)
      .in("exam_type", examTypeVariants(termLabel))
      .eq("year", year);
    if (error) throw error;
    return (data ?? []) as unknown as ResultWithStudent[];
  };

  const handleExport = async () => {
    if (selectedClasses.length === 0) return;

    // "All Classes" selected — generate the single combined landscape PDF
    // instead of per-class PDFs. If it's mixed with individual classes in
    // selectedClasses, "All Classes" takes priority since it already
    // covers every class.
    if (selectedClasses.includes(ALL_CLASSES_KEY)) {
      setIsExporting(true);
      try {
        await ensureJsPDF();
        const classDataMap = new Map<string, ReturnType<typeof computeAnalyticsPdfData>>();
        for (const cls of ALL_CLASSES) {
          const subjects = getSubjects(cls);
          const results = await fetchClassResults(cls);
          if (results.length > 0) {
            const pdfData = computeAnalyticsPdfData({ cls, year, subjects, results });
            classDataMap.set(cls, pdfData);
          }
        }
        if (classDataMap.size > 0) {
          generateAllClassesCombinedPdf(year, termLabel, classDataMap);
        }
        setShowPicker(false);
      } finally {
        setIsExporting(false);
        setProgress(null);
      }
      return;
    }

    setIsExporting(true);
    setProgress({ done: 0, total: selectedClasses.length });
    try {
      await ensureJsPDF();
      for (let i = 0; i < selectedClasses.length; i++) {
        const cls = selectedClasses[i];
        const subjects = getSubjects(cls);
        const results = await fetchClassResults(cls);
        if (results.length > 0) {
          const pdfData = computeAnalyticsPdfData({ cls, year, subjects, results });
          generateClassAnalyticsPdf(pdfData, termLabel);
          // Small delay between downloads so the browser doesn't drop or
          // block back-to-back file saves when multiple classes are picked.
          await new Promise((r) => setTimeout(r, 350));
        }
        setProgress({ done: i + 1, total: selectedClasses.length });
      }
      setShowPicker(false);
    } finally {
      setIsExporting(false);
      setProgress(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => { setSelectedClasses([]); setSlot(termSlot(examType || "") === 2 ? 2 : 1); setShowPicker(true); }}
          className="h-8 gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
          size="sm"
        >
          <FileDown className="w-4 h-4" />
          Download Analytics Report (PDF)
        </Button>
      </div>

      <Dialog open={showPicker} onOpenChange={(open) => { if (!isExporting) setShowPicker(open); }}>
        <DialogContent className="max-w-sm w-[92vw] sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileDown className="w-4 h-4 text-primary" /> Result Analytics — {year}
            </DialogTitle>
          </DialogHeader>

          <div>
            <label className="text-xs font-semibold text-foreground">Exam</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/40 p-1">
              {([[1, "1st Semester"], [2, "2nd Semester"]] as const).map(([n, l]) => (
                <button key={n} type="button" disabled={isExporting} onClick={() => setSlot(n)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-all ${slot === n ? "bg-card text-foreground shadow-sm ring-1 ring-border/70" : "text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground">Classes</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1.5">
              {ALL_CLASSES.map((c) => {
                const checked = selectedClasses.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={isExporting}
                    onClick={() =>
                      setSelectedClasses((prev) =>
                        checked ? prev.filter((x) => x !== c) : [...prev.filter((x) => x !== ALL_CLASSES_KEY), c]
                      )
                    }
                    className={`rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      checked
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-background border-input text-foreground"
                    }`}
                  >
                    Class {c}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  setSelectedClasses((prev) =>
                    prev.includes(ALL_CLASSES_KEY) ? [] : [ALL_CLASSES_KEY]
                  )
                }
                className={`col-span-3 sm:col-span-5 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                  selectedClasses.includes(ALL_CLASSES_KEY)
                    ? "bg-primary border-primary text-primary-foreground"
                    : "bg-background border-input text-foreground"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                All Classes — combined report
              </button>
            </div>
            <div className="flex gap-3 mt-2">
              <button type="button" disabled={isExporting} className="text-xs text-primary font-medium disabled:opacity-50" onClick={() => setSelectedClasses(ALL_CLASSES)}>Select All</button>
              <button type="button" disabled={isExporting} className="text-xs text-muted-foreground font-medium disabled:opacity-50" onClick={() => setSelectedClasses([])}>Clear</button>
            </div>
          </div>

          <Button
            disabled={selectedClasses.length === 0 || isExporting}
            onClick={handleExport}
            className="w-full justify-center gap-2 mt-1"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {selectedClasses.includes(ALL_CLASSES_KEY)
                  ? "Generating combined report..."
                  : progress ? `Generating ${progress.done}/${progress.total}...` : "Generating..."}
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" />
                {selectedClasses.includes(ALL_CLASSES_KEY)
                  ? "Download Combined Report"
                  : `Download${selectedClasses.length > 1 ? ` (${selectedClasses.length} classes)` : ""}`}
              </>
            )}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
