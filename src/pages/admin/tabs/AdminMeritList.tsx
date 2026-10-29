// src/pages/admin/tabs/AdminMeritList.tsx
// ──────────────────────────────────────────────────────────────────────────────
// ADVANCED Merit List Manager — v2 (snapshot-based, decoupled from `results`)
//
// KEY FIX vs v1:
//   Published merit lists are now STORED AS SNAPSHOTS in the `merit_lists.entries`
//   JSONB column at publish time. The student dashboard reads the snapshot — NOT
//   the live `results` table. So when an admin deletes a result in
//   "Manage Result", the published Merit List is UNAFFECTED (it keeps its
//   original ranking data forever, until the admin explicitly deletes it here).
//
// Flow:
//   1. Admin picks scope (Whole School combined, or BISE 9th/10th), exam
//      type and year. (The per-class "Class Merit" tab was removed on
//      request — a single class is viewable via the School tab's
//      "Single Class" view mode, and class-scoped published rows made by
//      older versions still render correctly everywhere.)
//   2. Admin clicks "Generate" → preview the merit list from `results`.
//   3. Admin optionally sets:
//        - Title (e.g. "Annual-I 2026 Toppers")
//        - Notes (shown to students)
//        - Theme color (new — visual accent for the student view)
//        - Publish mode: "Publish now" OR "Schedule for later" (countdown)
//   4. Admin clicks "Publish" → SNAPSHOT of current entries is written into
//      `merit_lists.entries` JSONB. The dashboard reads from this snapshot.
//   5. Students see the merit list ONLY when publish_at <= now().
//   6. Admin can download a professional PDF (minimal colors, clean type).
//
// UI UPGRADES (v2):
//   - Hero header with gradient + animated trophy
//   - Top-3 podium visualization with medals, avatars, and confetti accents
//   - Modern stat cards (4-up grid with icons + colored accents)
//   - Inline search/filter for entries
//   - Glassmorphic publish dialog with live countdown preview
//   - Beautiful "Published" tab cards with status pills + actions
// ──────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getGradeFromPercentage } from "@/hooks/useResults";
import { bulkFetchResults } from "@/components/ReportCard/bulkFetch";
import { biseResultsToMeritEntries, type BiseMeritEntry } from "@/components/ReportCard/toMeritEntries";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Trophy, Download, Send, School, BookOpen, Clock, Plus, Trash2,
  Calendar, EyeOff, Eye, CheckCircle2, Loader2, Search, Users, Award,
  TrendingUp, Target, Sparkles, Crown, Medal, ShieldCheck, ListFilter, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, formatDistanceToNow, isAfter } from "date-fns";
import { examTypeLabel } from "@/utils/examTypeLabel";

// ─── Constants ────────────────────────────────────────────────────────────────
const medalLabel = (pos: number) =>
  pos === 1 ? "1st" : pos === 2 ? "2nd" : pos === 3 ? "3rd" : `${pos}th`;

// Visual theme presets — admin picks one at publish time, student view inherits
const THEME_PRESETS = [
  { id: "gold",    label: "Royal Gold",    from: "from-amber-500",  to: "to-yellow-600",  accent: "text-amber-600",  ring: "ring-amber-400/40"  },
  { id: "royal",   label: "Royal Blue",    from: "from-blue-600",   to: "to-indigo-700",  accent: "text-blue-600",   ring: "ring-blue-400/40"   },
  { id: "emerald", label: "Emerald Pride", from: "from-emerald-500",to: "to-teal-700",    accent: "text-emerald-600",ring: "ring-emerald-400/40"},
  { id: "rose",    label: "Rose Honour",   from: "from-rose-500",   to: "to-pink-700",    accent: "text-rose-600",   ring: "ring-rose-400/40"   },
  { id: "violet",  label: "Violet Crest",  from: "from-violet-500", to: "to-purple-700",  accent: "text-violet-600", ring: "ring-violet-400/40" },
] as const;
type ThemeId = typeof THEME_PRESETS[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────
interface MeritEntry {
  id: string;
  student_id: string;
  full_name: string;
  roll_number: string;
  class: string;
  exam_type: string;
  photo_url: string | null;
  obtained_marks: number;
  total_marks: number;
  percentage: number;
  grade: string;
  is_pass: boolean;
  position: number;
  /** True for an ANONYMOUS reserved row: a student the admin withheld
   *  ("Hide top 3" / "Hide top 3 of each class") is snapshotted as a
   *  blank dash placeholder at their official position — NO name, roll
   *  number, class, marks or photo ever leaves the browser. The public
   *  page renders these rows as "—" so the table still lists ALL N
   *  students (e.g. 54) with the hidden ones empty. */
  hidden?: boolean;
}

interface MeritListRow {
  id: string;
  scope: string;
  class: string;
  exam_type: string | null;
  year: number;
  is_published: boolean;
  publish_at: string | null;
  title: string | null;
  notes: string | null;
  created_at: string;
  // ── NEW snapshot columns (v2) ──
  entries?: MeritEntry[] | null;
  total_students?: number;
  passing_count?: number;
  highest_percentage?: number;
  average_percentage?: number;
  theme?: string | null;
}

// ─── BISE Peshawar merit data for Class 9th/10th ─────────────────────────
// The Report Card feature (password-gated, /results page) lets an admin
// save BISE roll numbers per class + exam type + year in localStorage
// ("rc_roll_entries", keyed "9th|Annual-I|2026" etc — see ReportCardModal.tsx).
// This hook reads those SAME saved rolls for the given exam type + year,
// fetches live results for both 9th and 10th via the existing bulk-fetch
// pipeline, and converts them into MeritEntry rows using percentage-based
// ranking (600 total for 9th, 1200 for 10th — see classMaxMarks.ts) so they
// can be merged into the combined School Merit List correctly.
//
// Returns entries already split by class ("9" / "10"), matching the shape
// useAllClassesMerit returns for school-administered results.
interface BiseMeritMeta {
  savedRolls: number;
  resolvedRolls: number;
  missingRolls: { roll: string; className: "9th" | "10th" }[];
}

interface BiseMeritResult {
  byClass: Record<string, BiseMeritEntry[]>;
  meta: BiseMeritMeta;
}

function useBiseClassMerit(year: number, examType: string) {
  const queryClient = useQueryClient();
  const queryKey = ["bise-class-merit", year, examType];
  const query = useQuery<BiseMeritResult>({
    queryKey,
    queryFn: async () => {
      const empty: BiseMeritResult = { byClass: {}, meta: { savedRolls: 0, resolvedRolls: 0, missingRolls: [] } };
      if (!year || year < 2000 || !examType) return empty;
      let rollsBySelection: Record<string, { roll: string }[]> = {};
      try {
        const saved = localStorage.getItem("rc_roll_entries");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!Array.isArray(parsed)) rollsBySelection = parsed ?? {};
        }
      } catch {
        // localStorage unavailable / corrupted — treat as no saved rolls.
        rollsBySelection = {};
      }

      const rolls9 = (rollsBySelection[`9th|${examType}|${year}`] ?? []).map(e => e.roll);
      const rolls10 = (rollsBySelection[`10th|${examType}|${year}`] ?? []).map(e => e.roll);

      const [results9, results10] = await Promise.all([
        rolls9.length ? bulkFetchResults(rolls9, "9th") : Promise.resolve([]),
        rolls10.length ? bulkFetchResults(rolls10, "10th") : Promise.resolve([]),
      ]);

      const byClass: Record<string, BiseMeritEntry[]> = {};
      const entries9 = biseResultsToMeritEntries(results9, { className: "9th", examType, year });
      const entries10 = biseResultsToMeritEntries(results10, { className: "10th", examType, year });
      if (entries9.length) byClass["9"] = entries9;
      if (entries10.length) byClass["10"] = entries10;

      // Track saved-vs-resolved counts + which specific rolls didn't come
      // back, so the UI can show an accurate "X of Y fetched" and let the
      // admin explicitly retry just the missing ones instead of silently
      // showing an undercounted list. Kept as a SEPARATE field from
      // byClass (not smuggled into it) — byClass is consumed elsewhere
      // (PDF export, PublishDialog) as a pure Record<string, MeritEntry[]>
      // that gets spread/iterated as arrays; mixing in a non-array value
      // there crashed those consumers (byClass[c] spread threw "is not
      // iterable" when c === "__meta").
      const savedRolls = rolls9.length + rolls10.length;
      const resolvedRolls = entries9.length + entries10.length;
      const foundSet9 = new Set(entries9.map(e => e.roll_number));
      const foundSet10 = new Set(entries10.map(e => e.roll_number));
      const missingRolls = [
        ...rolls9.filter(r => !foundSet9.has(r)).map(r => ({ roll: r, className: "9th" as const })),
        ...rolls10.filter(r => !foundSet10.has(r)).map(r => ({ roll: r, className: "10th" as const })),
      ];

      return { byClass, meta: { savedRolls, resolvedRolls, missingRolls } };
    },
    enabled: year >= 2000 && !!examType,
    // BISE lookups are cached 24h at the proxy edge already for found
    // results, but a live curl still runs on cache miss — don't re-trigger
    // this on every focus/mount; only when the admin explicitly changes
    // year or exam type, or refetches manually.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Re-fetch ONLY the rolls that are still missing and merge the newly
  // found ones into the cached result, instead of re-running the entire
  // batch. A plain refetch() re-issues all 54 lookups every time, which
  // just re-hits the same BISE load/rate-limit wall that caused the
  // shortfall in the first place — retrying is expensive and barely
  // moves the needle. Retrying only the missing subset (with the same
  // bulkFetchResults retry pipeline) actually converges to 54/54 instead
  // of getting stuck near the original count.
  const retryMissing = async () => {
    const current = queryClient.getQueryData<BiseMeritResult>(queryKey);
    if (!current || current.meta.missingRolls.length === 0) return;

    const missing9 = current.meta.missingRolls.filter(m => m.className === "9th").map(m => m.roll);
    const missing10 = current.meta.missingRolls.filter(m => m.className === "10th").map(m => m.roll);

    const [recovered9, recovered10] = await Promise.all([
      missing9.length ? bulkFetchResults(missing9, "9th") : Promise.resolve([]),
      missing10.length ? bulkFetchResults(missing10, "10th") : Promise.resolve([]),
    ]);

    const newEntries9 = biseResultsToMeritEntries(recovered9, { className: "9th", examType, year });
    const newEntries10 = biseResultsToMeritEntries(recovered10, { className: "10th", examType, year });

    if (newEntries9.length === 0 && newEntries10.length === 0) return; // nothing new — leave state as-is

    const byClass: Record<string, BiseMeritEntry[]> = { ...current.byClass };
    if (newEntries9.length) byClass["9"] = [...(byClass["9"] ?? []), ...newEntries9];
    if (newEntries10.length) byClass["10"] = [...(byClass["10"] ?? []), ...newEntries10];

    const stillFoundSet9 = new Set(newEntries9.map(e => e.roll_number));
    const stillFoundSet10 = new Set(newEntries10.map(e => e.roll_number));
    const missingRolls = current.meta.missingRolls.filter(m =>
      m.className === "9th" ? !stillFoundSet9.has(m.roll) : !stillFoundSet10.has(m.roll)
    );

    queryClient.setQueryData<BiseMeritResult>(queryKey, {
      byClass,
      meta: {
        savedRolls: current.meta.savedRolls,
        resolvedRolls: current.meta.resolvedRolls + newEntries9.length + newEntries10.length,
        missingRolls,
      },
    });
  };

  return { ...query, retryMissing };
}


function useAllClassesMerit(year: number) {
  return useQuery<Record<string, MeritEntry[]>>({
    queryKey: ["merit-all-classes", year],
    queryFn: async () => {
      if (!year || year < 2000) return {};
      const { data, error } = await supabase
        .from("results")
        .select("id, student_id, obtained_marks, total_marks, percentage, grade, class, exam_type, is_pass, students(full_name, roll_number, photo_url)")
        .eq("year", year)
        .order("percentage", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const byClass: Record<string, Map<string, any>> = {};
      for (const r of rows) {
        const cls = r.class;
        if (!byClass[cls]) byClass[cls] = new Map();
        const map = byClass[cls];
        if (!map.has(r.student_id) || r.percentage > map.get(r.student_id).percentage) {
          map.set(r.student_id, r);
        }
      }
      const result: Record<string, MeritEntry[]> = {};
      for (const cls of Object.keys(byClass)) {
        result[cls] = Array.from(byClass[cls].values())
          .sort((a, b) => b.percentage - a.percentage)
          .map((r: any, i: number) => ({
            id: r.id, student_id: r.student_id,
            full_name: r.students?.full_name || "Unknown",
            roll_number: r.students?.roll_number || "-",
            class: r.class, exam_type: r.exam_type,
            photo_url: r.students?.photo_url || null,
            obtained_marks: r.obtained_marks, total_marks: r.total_marks,
            percentage: Number(r.percentage) || 0,
            grade: r.grade || getGradeFromPercentage(r.percentage),
            is_pass: r.is_pass, position: i + 1,
          }));
      }
      return result;
    },
    enabled: year >= 2000,
  });
}

// ─── Fetch all published/scheduled merit lists (admin view) ──────────────────
function useMeritListRecords() {
  return useQuery<MeritListRow[]>({
    queryKey: ["merit-list-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merit_lists")
        .select(`
          id, scope, class, exam_type, year, is_published, publish_at,
          title, notes, created_at,
          entries, total_students, passing_count,
          highest_percentage, average_percentage, theme
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MeritListRow[];
    },
  });
}

// ─── Save (publish or schedule) a merit list — now with SNAPSHOT ─────────────
function useSaveMeritList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      scope: "class" | "school" | "school-bise";
      cls: string;
      examType: string | null;
      year: number;
      title: string;
      notes: string | null;
      publishAt: string | null;
      theme: ThemeId;
      entries: MeritEntry[];          // ← SNAPSHOT to persist (hidden students removed)
      statsPool: MeritEntry[];        // ← FULL pool incl. hidden students, for accurate stats
    }) => {
      // Trust is_pass as-is: it already encodes manual_pass_fail override
      // when set (see AdminResults.tsx save logic). Do NOT re-check
      // percentage here — that was silently turning a manually-marked
      // "Fail" back into "Pass" whenever marks happened to be >= 33%.
      //
      // IMPORTANT: total_students / passing_count / average_percentage must
      // reflect EVERYONE (including students hidden via "Hide top 3" etc.),
      // not just the visible rows — hiding a topper for a stage reveal
      // should not shrink the published pass rate or average.
      //
      // GUARD — total_students must never exceed entries.length unless
      // someone is genuinely hidden. The public page infers "someone is
      // hidden" from total_students > (visible entries in the saved
      // snapshot); if statsPool and entries were ever computed from
      // different moments in time (e.g. a fetch still in flight when
      // Publish was clicked), that comparison would wrongly hide the
      // Top 3 / Highest % for a fully-visible publish even though nobody
      // was ever hidden. Since entries (the snapshot actually written) is
      // the one array the public page reads back, it — not statsPool — is
      // the ground truth for total_students whenever there are no hidden
      // rows in it.
      const noneHidden = params.entries.every(e => !e.hidden);
      const pool = noneHidden
        ? params.entries
        : (params.statsPool.length ? params.statsPool : params.entries);
      const visibleEntries = params.entries.filter(e => !e.hidden);
      const hiddenCount = Math.max(
        params.entries.filter(e => e.hidden).length,
        pool.length - visibleEntries.length,
        0
      );
      const passingCount = pool.filter(e => e.is_pass).length;
      const highest = hiddenCount > 0
        ? 0
        : pool.length ? Math.max(...pool.map(e => e.percentage)) : 0;
      const avg = pool.length
        ? Math.round(pool.reduce((s, e) => s + e.percentage, 0) / pool.length * 10) / 10
        : 0;

      const payload = {
        scope: params.scope,
        class: params.cls,
        exam_type: params.examType,
        year: params.year,
        title: params.title || null,
        notes: params.notes || null,
        is_published: true,
        publish_at: params.publishAt,
        published_at: new Date().toISOString(),
        theme: params.theme,
        // ── SNAPSHOT fields (the actual fix) ────────────────────────────────
        entries: params.entries as unknown as any,        // JSONB — visible rows + anonymous hidden placeholders
        total_students: pool.length,                      // ← counts hidden students too
        passing_count: passingCount,                       // ← counts hidden students too
        highest_percentage: highest,                       // 0 = withheld (dash) when anyone is hidden
        average_percentage: avg,                            // ← counts hidden students too
        schema_version: 2,
      };
      const { error } = await supabase
        .from("merit_lists")
        .upsert(payload, { onConflict: "scope,class,exam_type,year" })
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merit-list-records"] });
      qc.invalidateQueries({ queryKey: ["merit-lists"] });
      // The PUBLIC page's caches (React Query memory + the IndexedDB offline
      // snapshot in queryPersist.ts) must NEVER resurrect the previous state
      // of this list after a publish. invalidateQueries alone only MARKS the
      // old data stale — it stays renderable (and gets re-persisted to
      // IndexedDB), so a slow/offline refetch would keep showing the
      // pre-publish list (e.g. the pre-hide rankings). REMOVE the queries
      // instead: memory drops the stale rows, the persist layer writes the
      // merit keys out of the snapshot, and the public page fetches fresh
      // data on its next mount.
      qc.removeQueries({ queryKey: ["published-merit-lists"] });
      qc.removeQueries({ queryKey: ["merit-list-data"] });
    },
  });
}

// ─── Delete a merit list ─────────────────────────────────────────────────────
function useDeleteMeritList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("merit_lists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["merit-list-records"] });
      qc.invalidateQueries({ queryKey: ["merit-lists"] });
      // Same rule as publish: drop the public page's memory + IndexedDB
      // copies so a deleted list can't linger as a "live" ghost.
      qc.removeQueries({ queryKey: ["published-merit-lists"] });
      qc.removeQueries({ queryKey: ["merit-list-data"] });
    },
  });
}

// ─── Professional PDF helpers (unchanged minimal palette) ────────────────────
const PDF_COLOR = {
  ink:    [10, 10, 10] as [number, number, number],
  head:   [31, 31, 31] as [number, number, number],
  sub:    [82, 82, 82] as [number, number, number],
  muted:  [120, 120, 120] as [number, number, number],
  altRow: [246, 247, 248] as [number, number, number],
  pass:   [15, 81, 50] as [number, number, number],
  fail:   [139, 0, 0] as [number, number, number],
  white:  [255, 255, 255] as [number, number, number],
  rule:   [180, 180, 180] as [number, number, number],
};

function drawPDFHeader(doc: jsPDF, title: string, subtitle: string, w: number) {
  doc.setDrawColor(PDF_COLOR.ink[0], PDF_COLOR.ink[1], PDF_COLOR.ink[2]);
  doc.setLineWidth(1.0);
  doc.line(14, 10, w - 14, 10);
  doc.setTextColor(PDF_COLOR.ink[0], PDF_COLOR.ink[1], PDF_COLOR.ink[2]);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 17, { align: "center" });
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(PDF_COLOR.sub[0], PDF_COLOR.sub[1], PDF_COLOR.sub[2]);
  doc.text("District Mohmand, Khyber Pakhtunkhwa  |  Established 2018", w / 2, 22, { align: "center" });
  doc.setDrawColor(PDF_COLOR.rule[0], PDF_COLOR.rule[1], PDF_COLOR.rule[2]);
  doc.setLineWidth(0.25);
  doc.line(14, 25, w - 14, 25);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(PDF_COLOR.ink[0], PDF_COLOR.ink[1], PDF_COLOR.ink[2]);
  doc.text(title, w / 2, 31, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(PDF_COLOR.sub[0], PDF_COLOR.sub[1], PDF_COLOR.sub[2]);
  doc.text(subtitle, w / 2, 36, { align: "center" });
  doc.setDrawColor(PDF_COLOR.ink[0], PDF_COLOR.ink[1], PDF_COLOR.ink[2]);
  doc.setLineWidth(1.0);
  doc.line(14, 39, w - 14, 39);
}

function drawPDFStats(doc: jsPDF, entries: MeritEntry[], y: number, w: number) {
  // Trust is_pass as-is — it already reflects manual_pass_fail overrides.
  const passing = entries.filter(e => e.is_pass);
  const avg = Math.round(entries.reduce((s, e) => s + e.percentage, 0) / entries.length);
  const highest = Math.max(...entries.map(e => e.percentage));
  const passRate = entries.length ? Math.round((passing.length / entries.length) * 100) : 0;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(PDF_COLOR.sub[0], PDF_COLOR.sub[1], PDF_COLOR.sub[2]);
  doc.text(
    `Total: ${entries.length}    Passed: ${passing.length}    Failed: ${entries.length - passing.length}    Highest: ${highest.toFixed(1)}%    Average: ${avg}%    Pass Rate: ${passRate}%`,
    w / 2, y, { align: "center" }
  );
}

function drawPDFFooter(doc: jsPDF, w: number, h: number, pageNum: number, totalPages: number) {
  doc.setDrawColor(PDF_COLOR.rule[0], PDF_COLOR.rule[1], PDF_COLOR.rule[2]);
  doc.setLineWidth(0.25);
  doc.line(14, h - 12, w - 14, h - 12);
  doc.setTextColor(PDF_COLOR.muted[0], PDF_COLOR.muted[1], PDF_COLOR.muted[2]);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.text("GHS Babi Khel  —  Official Merit List", 14, h - 7);
  doc.text(`Generated: ${format(new Date(), "dd/MM/yyyy")}`, w / 2, h - 7, { align: "center" });
  doc.text(`Page ${pageNum} / ${totalPages}`, w - 14, h - 7, { align: "right" });
}

function generateAllClassesPDF(byClass: Record<string, MeritEntry[]>, year: number, title?: string | null) {
  const sortedClasses = Object.keys(byClass).sort();
  if (!sortedClasses.length) { toast.error("No data to export"); return; }
  const allStudents: MeritEntry[] = [];
  for (const cls of sortedClasses) allStudents.push(...(byClass[cls] || []));
  allStudents.sort((a, b) => b.percentage - a.percentage);
  if (!allStudents.length) { toast.error("No data to export"); return; }
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  drawPDFHeader(doc, title || "WHOLE SCHOOL MERIT LIST", `Year ${year}  |  All Classes Combined  |  ${allStudents.length} Students`, w);
  drawPDFStats(doc, allStudents, 44, w);
  autoTable(doc, {
    startY: 49,
    head: [["Rank", "Class", "Roll No", "Student Name", "Marks", "%", "Grade", "Status"]],
    body: allStudents.map((e, i) => [
      medalLabel(i + 1), `Cls ${e.class}`, e.roll_number, e.full_name,
      `${e.obtained_marks} / ${e.total_marks}`,
      `${Number(e.percentage).toFixed(1)}%`, e.grade,
      e.is_pass ? "Pass" : "Fail", // trust is_pass — respects manual override
    ]),
    headStyles: { fillColor: PDF_COLOR.head, textColor: PDF_COLOR.white, fontStyle: "bold", fontSize: 8, halign: "center", valign: "middle", cellPadding: 3 },
    bodyStyles: { fontSize: 8, cellPadding: 2.8, textColor: PDF_COLOR.ink, valign: "middle", fontStyle: "normal" },
    alternateRowStyles: { fillColor: PDF_COLOR.altRow },
    columnStyles: {
      0: { halign: "center", cellWidth: 13 },
      1: { halign: "center", cellWidth: 16 },
      2: { halign: "center", cellWidth: 20 },
      3: { halign: "center", cellWidth: 58, overflow: "linebreak" },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "center", cellWidth: 18 },
      6: { halign: "center", cellWidth: 14 },
      7: { halign: "center", cellWidth: 14 },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        if (data.column.index === 0 && data.row.index < 3) data.cell.styles.fontStyle = "bold";
        if (data.column.index === 7) {
          const val = String(data.cell.raw);
          data.cell.styles.textColor = val === "Pass" ? PDF_COLOR.pass : PDF_COLOR.fail;
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
    margin: { left: 14, right: 14, bottom: 18 },
    didDrawPage: (data) => {
      const pc = (doc as any).internal.getNumberOfPages();
      drawPDFFooter(doc, w, h, data.pageNumber, pc);
    },
  });
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawPDFFooter(doc, w, h, p, totalPages); }
  doc.save(`School_MeritList_${year}.pdf`);
}

// ─── Countdown helper ────────────────────────────────────────────────────────
function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function CountdownBadge({ publishAt }: { publishAt: string }) {
  const now = useNowTick(1000);
  const target = new Date(publishAt);
  if (!isAfter(target, now)) {
    return <Badge className="bg-emerald-100 text-emerald-700 gap-1"><CheckCircle2 className="w-3 h-3" /> Published</Badge>;
  }
  const diff = target.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const label = days > 0
    ? `${days}d ${hours}h ${mins}m`
    : hours > 0
      ? `${hours}h ${mins}m ${secs}s`
      : `${mins}m ${secs}s`;
  return (
    <Badge className="bg-amber-100 text-amber-800 gap-1 animate-pulse">
      <Clock className="w-3 h-3" /> {label}
    </Badge>
  );
}

// ─── Stats Card (compact, premium) ───────────────────────────────────────────
function StatCard({ icon: Icon, label, value, accent, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number; accent: string; sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm flex items-center gap-3 min-w-0">
      <div className={`w-10 h-10 rounded-xl ${accent} flex items-center justify-center shrink-0`}>
        <Icon className="w-[18px] h-[18px]" />
      </div>
      <div className="min-w-0">
        <p className="text-lg sm:text-2xl font-bold tabular-nums leading-none text-foreground">{value}</p>
        <p className="text-[11px] font-medium text-muted-foreground mt-1 leading-tight truncate">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 leading-tight">{sub}</p>}
      </div>
    </div>
  );
}

function StatsRow({ entries }: { entries: MeritEntry[] }) {
  if (!entries.length) return null;
  // Trust is_pass as-is — it already reflects manual_pass_fail overrides.
  const passing = entries.filter(e => e.is_pass);
  const avg = Math.round(entries.reduce((s, e) => s + e.percentage, 0) / entries.length);
  const highest = Math.max(...entries.map(e => e.percentage));
  const passRate = Math.round((passing.length / entries.length) * 100);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      <StatCard icon={Users}        label="Total Students" value={entries.length}           accent="bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300" />
      <StatCard icon={CheckCircle2} label="Pass Rate"      value={`${passRate}%`} sub={`${passing.length} passed`} accent="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300" />
      <StatCard icon={TrendingUp}   label="Highest %"      value={`${highest.toFixed(1)}%`} accent="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300" />
      <StatCard icon={Target}       label="Average %"      value={`${avg}%`}                accent="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300" />
    </div>
  );
}

// ─── Top-3 Podium (advanced visual) ──────────────────────────────────────────
function Top3Podium({ entries, showClass = false }: { entries: MeritEntry[]; showClass?: boolean }) {
  if (entries.length < 1) return null;
  const top3 = entries.slice(0, 3);
  // Display order: 2nd, 1st, 3rd
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const heights = ["h-14 sm:h-24", "h-20 sm:h-32", "h-11 sm:h-20"]; // 2nd, 1st, 3rd — shorter on mobile so the card doesn't overflow
  const medalColors = [
    "from-gray-300 to-gray-400",   // 2nd - silver
    "from-amber-400 to-yellow-500", // 1st - gold
    "from-orange-400 to-amber-600", // 3rd - bronze
  ];
  const medalEmojis = ["🥈", "🥇", "🥉"];
  const podiumRanks = [2, 1, 3];

  return (
    <div className="rounded-2xl border border-amber-200/70 dark:border-amber-800/40 bg-gradient-to-br from-amber-50/70 via-card to-yellow-50/40 dark:from-amber-950/20 dark:to-yellow-950/10 p-3.5 sm:p-5 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Crown className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-bold">Top 3 Achievers</h3>
        <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
      </div>
      <div className="flex items-end justify-center gap-1.5 sm:gap-6">
        {order.map((entry, idx) => {
          const rank = podiumRanks[idx];
          const isFirst = rank === 1;
          return (
            <div key={`${entry.student_id}-${rank}`} className="flex flex-col items-center text-center flex-1 basis-0 min-w-0 max-w-[150px]">
              {/* Avatar */}
              <div className="relative mb-2">
                <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${medalColors[idx]} blur-md opacity-50`} />
                <div className={`relative w-12 h-12 sm:w-16 sm:h-16 rounded-full p-0.5 bg-gradient-to-br ${medalColors[idx]}`}>
                  {entry.photo_url
                    ? <img src={entry.photo_url} alt="" className="w-full h-full rounded-full object-cover" />
                    : <div className="w-full h-full rounded-full bg-card flex items-center justify-center font-bold text-base sm:text-lg">
                        {(entry.full_name || "?")[0]}
                      </div>}
                </div>
                <span className={`absolute -bottom-1 -right-1 text-base sm:text-xl ${isFirst ? "scale-125" : ""}`}>
                  {medalEmojis[idx]}
                </span>
              </div>
              {/* Name & details */}
              <p className={`text-[11px] sm:text-sm font-bold leading-tight line-clamp-2 break-words w-full px-0.5 ${isFirst ? "text-amber-700 dark:text-amber-300" : ""}`}>
                {entry.full_name}
              </p>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap justify-center">
                {showClass && <span className="text-[9px] sm:text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded whitespace-nowrap">Cls {entry.class}</span>}
                <span className="text-[9px] sm:text-[10px] text-muted-foreground font-mono truncate">{entry.roll_number}</span>
              </div>
              <p className={`text-xs sm:text-base font-black tabular-nums mt-1 ${isFirst ? "text-amber-600" : "text-foreground"}`}>
                {Number(entry.percentage).toFixed(1)}%
              </p>
              {/* Podium pillar */}
              <div className={`mt-2 w-full min-w-[44px] sm:min-w-[56px] ${heights[idx]} rounded-t-lg bg-gradient-to-br ${medalColors[idx]} flex items-start justify-center pt-1`}>
                <span className="text-white font-black text-sm sm:text-lg drop-shadow">{rank}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Merit Table UI (mobile ranking cards + desktop table) ───────────────────
const rankStyle = (i: number) =>
  i === 0 ? "bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950"
  : i === 1 ? "bg-gradient-to-br from-gray-200 to-gray-400 text-gray-800"
  : i === 2 ? "bg-gradient-to-br from-orange-300 to-amber-500 text-orange-950"
  : "bg-secondary text-muted-foreground";

function PassPill({ pass }: { pass: boolean }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
      pass
        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
        : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800"
    }`}>{pass ? "Pass" : "Fail"}</span>
  );
}

function MeritAvatar({ e, size = "w-10 h-10" }: { e: MeritEntry; size?: string }) {
  return e.photo_url
    ? <img src={e.photo_url} alt="" className={`${size} rounded-full object-cover ring-1 ring-border shrink-0`} />
    : <div className={`${size} rounded-full bg-primary/10 text-primary ring-1 ring-border flex items-center justify-center text-sm font-semibold shrink-0`}>{(e.full_name || "?")[0]}</div>;
}

function MeritTable({ entries, showClass = false }: { entries: MeritEntry[]; showClass?: boolean }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase().trim();
    return entries.filter(e =>
      e.full_name.toLowerCase().includes(q) ||
      e.roll_number.toLowerCase().includes(q) ||
      String(e.class).includes(q)
    );
  }, [entries, search]);

  if (!entries.length) return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <Trophy className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-muted-foreground text-sm">No results found for this selection.</p>
      <p className="text-xs text-muted-foreground mt-1">Make sure results are entered in Manage Results tab.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Medal className="w-4 h-4 text-amber-500" /> Ranking
          <span className="text-[11px] font-normal text-muted-foreground">({entries.length})</span>
        </h3>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search name, roll no${showClass ? " or class" : ""}`}
          className="pl-10 h-10 text-sm rounded-full border-border/60 bg-card shadow-none"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {filtered.length}/{entries.length}
          </span>
        )}
      </div>

      {/* Mobile: ranking cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((e, i) => {
          const idx = entries.indexOf(e);
          return (
            <div key={`${e.student_id}-${i}`} className={`rounded-2xl border bg-card p-3 shadow-sm ${idx < 3 ? "border-amber-300/60" : "border-border/60"}`}>
              <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${rankStyle(idx)}`}>{idx + 1}</span>
                <MeritAvatar e={e} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground leading-snug break-words">{e.full_name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
                    {showClass && <span className="font-semibold text-primary">Class {e.class}</span>}
                    <span className="font-mono">Roll {e.roll_number}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold tabular-nums text-foreground leading-none">{Number(e.percentage).toFixed(1)}%</p>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">{e.obtained_marks}/{e.total_marks}</p>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full ${e.is_pass ? "bg-emerald-500" : "bg-red-400"}`} style={{ width: `${Math.max(0, Math.min(100, Number(e.percentage)))}%` }} />
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border/60 bg-muted/60 text-foreground">{e.grade}</span>
                <PassPill pass={e.is_pass} />
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">No students match "{search}".</div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-center font-bold w-14">Rank</th>
                {showClass && <th className="px-3 py-2.5 text-left font-bold">Class</th>}
                <th className="px-3 py-2.5 text-left font-bold">Roll No</th>
                <th className="px-3 py-2.5 text-left font-bold">Student</th>
                <th className="px-3 py-2.5 text-center font-bold">Marks</th>
                <th className="px-3 py-2.5 text-center font-bold">%</th>
                <th className="px-3 py-2.5 text-center font-bold">Grade</th>
                <th className="px-3 py-2.5 text-center font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const idx = entries.indexOf(e);
                return (
                  <tr key={`${e.student_id}-${i}`} className={`border-t border-border/50 transition-colors ${idx < 3 ? "bg-amber-50/50 dark:bg-amber-900/10" : "hover:bg-primary/5"}`}>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${rankStyle(idx)}`}>{idx + 1}</span>
                    </td>
                    {showClass && <td className="px-3 py-2"><span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">Class {e.class}</span></td>}
                    <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{e.roll_number}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <MeritAvatar e={e} size="w-8 h-8" />
                        <span className={`text-foreground ${idx < 3 ? "font-semibold" : "font-medium"}`}>{e.full_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-mono text-muted-foreground whitespace-nowrap">{e.obtained_marks}/{e.total_marks}</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums">{Number(e.percentage).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border/60 bg-muted/60">{e.grade}</span></td>
                    <td className="px-3 py-2 text-center"><PassPill pass={e.is_pass} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={showClass ? 8 : 7} className="p-6 text-center text-sm text-muted-foreground">No students match "{search}".</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Publish Dialog (advanced, with theme picker + countdown preview) ────────
function PublishDialog({
  open, onClose, scope, cls, examType, year, entries, byClass,
}: {
  open: boolean;
  onClose: () => void;
  scope: "class" | "school" | "school-bise";
  cls: string;
  examType: string;
  year: number;
  entries: MeritEntry[];
  byClass?: Record<string, MeritEntry[]>;
}) {
  const saveMut = useSaveMeritList();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [publishMode, setPublishMode] = useState<"now" | "schedule">("now");
  const [theme, setTheme] = useState<ThemeId>("gold");
  const [scheduleAt, setScheduleAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // ── Student visibility ──────────────────────────────────────────────────
  // A student excluded here is replaced in the SNAPSHOT by an ANONYMOUS
  // placeholder row at their official position — their name, roll number,
  // class, marks and photo never leave the browser. This is what lets an
  // admin publish a merit list before a program without revealing who the
  // toppers are, while the public table still lists ALL students (e.g. 54)
  // with the hidden ones rendered as dash rows. Re-publish later with
  // everyone checked to reveal the full ranking.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [visSearch, setVisSearch] = useState("");

  // "school" and "school-bise" both mean "multiple classes combined into
  // one ranked pool" — as opposed to "class" (a single class). Everywhere
  // below that used to check `scope === "school"` for that meaning now
  // uses this instead, so BISE gets identical multi-class behavior
  // (combined ranking, per-class Top-N, class column shown, etc) without
  // being merged into the school scope's data or its published row.
  const isMultiClass = scope === "school" || scope === "school-bise";
  const scopeNoun = scope === "school-bise" ? "BISE" : "School";

  useEffect(() => {
    if (open) {
      setTitle(isMultiClass
        ? `${scopeNoun} Merit List ${year}`
        : `Class ${cls} Merit List — ${examTypeLabel(examType)} ${year}`);
      setNotes("");
      setPublishMode("now");
      setTheme("gold");
      setHiddenIds(new Set());
      setVisSearch("");
    }
  }, [open, scope, cls, examType, year]);

  const totalStudents = isMultiClass
    ? Object.values(byClass || {}).reduce((s, arr) => s + arr.length, 0)
    : entries.length;

  // For multi-class scopes, the full pool is ALL classes combined, ranked together.
  const fullPool: MeritEntry[] = useMemo(() => {
    if (isMultiClass) {
      const all: MeritEntry[] = [];
      for (const c of Object.keys(byClass || {})) all.push(...(byClass?.[c] || []));
      return all.sort((a, b) => b.percentage - a.percentage).map((e, i) => ({ ...e, position: i + 1 }));
    }
    return entries;
  }, [scope, entries, byClass]);

  // What actually gets snapshotted — hidden students become ANONYMOUS
  // dash placeholder rows that KEEP their official position (so the
  // published ranking still runs 1..N with reserved gaps), while visible
  // students keep their true official rank. No renumbering: a student at
  // combined rank 7 stays rank 7 even when ranks 1-6 are withheld.
  const snapshotEntries: MeritEntry[] = useMemo(() => {
    return fullPool
      .map((e): MeritEntry =>
        hiddenIds.has(e.student_id)
          ? { ...e, hidden: true, student_id: "", full_name: "", roll_number: "",
              class: "", photo_url: null, obtained_marks: 0, total_marks: 0,
              percentage: 0, grade: "", is_pass: false }
          : { ...e }
      )
      .sort((a, b) => (a.position || 0) - (b.position || 0));
  }, [fullPool, hiddenIds]);

  const visibleCount = fullPool.length - hiddenIds.size;

  const filteredForVisibility = useMemo(() => {
    if (!visSearch.trim()) return fullPool;
    const q = visSearch.toLowerCase().trim();
    return fullPool.filter(e =>
      e.full_name.toLowerCase().includes(q) ||
      e.roll_number.toLowerCase().includes(q) ||
      String(e.class).includes(q)
    );
  }, [fullPool, visSearch]);

  const toggleOne = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const showAll = () => setHiddenIds(new Set());

  // "Hide Top N overall" — hide just the top N across the whole combined
  // pool, leave everyone else visible. "Hide Top N per class" — hide the
  // top N WITHIN EACH class separately (so a school-wide 4th place in one
  // class doesn't get swept up just because they're outside the overall
  // top 3), leave everyone else visible. This is the exact program-day
  // scenario described: keep the list published and browsable, but hide
  // just the toppers who'll be revealed on stage.
  const hideTopNOverall = (n: number) => {
    const hideIds = new Set(fullPool.slice(0, n).map(e => e.student_id));
    setHiddenIds(hideIds);
  };

  const hideTopNPerClass = (n: number) => {
    if (!isMultiClass || !byClass) { hideTopNOverall(n); return; }
    const hideIds = new Set<string>();
    for (const c of Object.keys(byClass)) {
      const sorted = [...(byClass[c] || [])].sort((a, b) => b.percentage - a.percentage);
      for (const e of sorted.slice(0, n)) hideIds.add(e.student_id);
    }
    setHiddenIds(hideIds);
  };

  const handleSave = async () => {
    if (!totalStudents) { toast.error("No students to publish"); return; }
    if (visibleCount < 1) { toast.error("Everyone is hidden — at least one student must be visible to publish"); return; }
    let publishAt: string | null = null;
    if (publishMode === "schedule") {
      if (!scheduleAt) { toast.error("Pick a date and time for the countdown"); return; }
      const d = new Date(scheduleAt);
      if (isNaN(d.getTime())) { toast.error("Invalid date"); return; }
      if (d.getTime() <= Date.now()) { toast.error("Schedule time must be in the future"); return; }
      publishAt = d.toISOString();
    }
    try {
      await saveMut.mutateAsync({
        scope,
        cls: isMultiClass ? scope : cls,           // "school" or "school-bise" as the row's class key too
        examType: scope === "school" ? "ALL" : examType,  // BISE keeps its real Annual-I/II exam type
        year,
        title,
        notes: notes || null,
        publishAt,
        theme,
        entries: snapshotEntries,        // ← SNAPSHOT (hidden students already removed)
        statsPool: fullPool,             // ← everyone, for accurate total/pass-rate/average
      });
      toast.success(
        publishMode === "now"
          ? "Merit list published — students can see it now!"
          : `Merit list scheduled — goes live ${format(new Date(publishAt!), "dd MMM, h:mm a")}`
      );
      onClose();
    } catch (err) {
      toast.error(err?.message || "Failed to publish");
    }
  };

  if (!open) return null;

  const selectedTheme = THEME_PRESETS.find(t => t.id === theme) || THEME_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-foreground/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border/60 rounded-2xl shadow-elevated max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient accent */}
        <div className={`p-6 sm:p-8 border-b border-border bg-gradient-to-br ${selectedTheme.from} ${selectedTheme.to} text-white shrink-0`}>
          <h3 className="font-heading font-bold text-xl sm:text-2xl flex items-center gap-3">
            <span className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0">
              <Send className="w-5 h-5" />
            </span>
            {isMultiClass ? `Publish ${scopeNoun} Merit List` : `Publish Class ${cls} Merit List`}
          </h3>
          <p className="text-sm sm:text-base text-white/85 mt-2.5 leading-relaxed">
            {visibleCount} of {totalStudents} students will be visible to the public.
            {" "}{isMultiClass ? "All classes combined." : `${examTypeLabel(examType)} · ${year}`}
            {hiddenIds.size > 0 && (
              <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-white/20 text-xs font-semibold align-middle">
                <EyeOff className="w-3 h-3" /> {hiddenIds.size} hidden
              </span>
            )}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="p-6 sm:p-8 space-y-7 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Title (shown to students)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 1st Semester 2026 Toppers"
              className="text-sm h-11"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Notes (optional, shown to students)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Congratulations to all toppers!"
              className="text-sm min-h-[72px]"
            />
          </div>

          {/* Theme picker */}
          <div>
            <Label className="text-sm font-semibold mb-2.5 block">Visual theme</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
              {THEME_PRESETS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                    theme === t.id
                      ? "border-foreground bg-foreground/5"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${t.from} ${t.to} shadow-sm`} />
                  <span className="text-[10px] font-medium text-muted-foreground leading-tight text-center">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Student Visibility — premium panel ────────────────────────── */}
          {/* Not applicable to BISE Peshawar merit: those results are the
              board's own official public merit list, so hiding toppers or
              individual students has no place here — only School Merit
              (class or whole-school) gets this panel. */}
          {scope !== "school-bise" && (
          <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800/60 bg-gradient-to-br from-amber-50/70 via-card to-yellow-50/40 dark:from-amber-950/20 dark:via-card dark:to-yellow-950/10 overflow-hidden">
            <div className="p-4 sm:p-5 pb-3 sm:pb-4 border-b border-amber-200/70 dark:border-amber-800/40">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center shrink-0 shadow-sm">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </span>
                <div>
                  <Label className="text-sm font-bold block leading-tight">Student Visibility</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Uncheck anyone you don't want revealed yet — e.g. keep toppers a surprise for the program.
                  </p>
                </div>
              </div>

              {/* Quick actions — only two, as requested. Each HIDES the
                  toppers described (everyone else stays visible), rather
                  than showing only the toppers. */}
              <div className="flex flex-wrap gap-1.5 mt-3.5">
                <button
                  onClick={() => hideTopNOverall(3)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:brightness-105 transition-all"
                >
                  <Crown className="w-3.5 h-3.5" /> Hide top 3 students
                </button>
                {isMultiClass && (
                  <button
                    onClick={() => hideTopNPerClass(3)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:brightness-105 transition-all"
                  >
                    <ListFilter className="w-3.5 h-3.5" /> Hide top 3 of each class
                  </button>
                )}
                {hiddenIds.size > 0 && (
                  <button
                    onClick={showAll}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-border bg-secondary text-muted-foreground hover:brightness-95 transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" /> Reveal all
                  </button>
                )}
              </div>

              {/* Search */}
              <div className="relative mt-3">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={visSearch}
                  onChange={(e) => setVisSearch(e.target.value)}
                  placeholder="Search by name, roll no, or class..."
                  className="h-9 pl-8 text-xs rounded-full border-border/60 bg-card shadow-none"
                />
              </div>
            </div>

            {/* Student list — scrollable, checkbox per row */}
            <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
              {filteredForVisibility.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No students match that search.</p>
              ) : filteredForVisibility.map(e => {
                const isHidden = hiddenIds.has(e.student_id);
                return (
                  <label
                    key={e.student_id}
                    className={`flex items-center gap-3 px-4 sm:px-5 py-2.5 cursor-pointer transition-colors ${
                      isHidden ? "bg-muted/40 opacity-60" : "hover:bg-amber-50/50 dark:hover:bg-amber-950/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleOne(e.student_id)}
                      className="w-4 h-4 rounded accent-amber-500 shrink-0 cursor-pointer"
                    />
                    <span className={`text-xs font-bold tabular-nums w-7 shrink-0 text-center ${
                      e.position <= 3 ? "text-amber-600" : "text-muted-foreground"
                    }`}>
                      #{e.position}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{e.full_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isMultiClass && <>Cls {e.class} · </>}Roll {e.roll_number} · {Number(e.percentage).toFixed(1)}%
                      </p>
                    </div>
                    {isHidden ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground shrink-0">
                        <EyeOff className="w-3 h-3" /> Hidden
                      </span>
                    ) : e.position <= 3 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 shrink-0">
                        <Crown className="w-3 h-3" /> Topper
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
          )}

          {/* Publish mode */}
          <div>
            <Label className="text-sm font-semibold mb-2.5 block">When should it go live?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                onClick={() => setPublishMode("now")}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  publishMode === "now"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                <Send className="w-4 h-4 shrink-0" /> Publish now
              </button>
              <button
                onClick={() => setPublishMode("schedule")}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  publishMode === "schedule"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                <Clock className="w-4 h-4 shrink-0" /> Schedule with countdown
              </button>
            </div>
          </div>

          {/* Schedule datetime picker */}
          {publishMode === "schedule" && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-4">
              <Label className="text-sm font-semibold mb-2 block text-amber-800 dark:text-amber-300">Publish at (date & time)</Label>
              <Input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="text-sm h-11 bg-card"
              />
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                Students will see a live countdown on their dashboard until this moment.
              </p>
            </div>
          )}

          {/* Snapshot notice */}
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4">
            <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                <strong>Permanent snapshot:</strong> Once published, this merit list
                is decoupled from the results table. Deleting results in
                "Manage Result" will <strong>not</strong> affect this merit list.
                {hiddenIds.size > 0 && (
                  <> Hidden students appear only as blank dash rows at their official
                  positions — their names, roll numbers and marks are <strong>not</strong> sent
                  to the server. Publish an updated list later with everyone visible to
                  reveal them.</>
                )}
              </span>
            </p>
          </div>
        </div>

        <div className="border-t border-border/60 p-4 sm:p-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end shrink-0">
          <Button variant="outline" onClick={onClose} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none w-full sm:w-auto">Cancel</Button>
          <Button onClick={handleSave} disabled={saveMut.isPending} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none w-full sm:w-auto">
            {saveMut.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {publishMode === "now" ? "Publish Now" : "Schedule Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}


// ─── Published merit lists list (admin view, upgraded cards) ─────────────────
function PublishedList({ records }: { records: MeritListRow[] }) {
  const deleteMut = useDeleteMeritList();
  if (!records.length) return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <Trophy className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-muted-foreground text-sm">No merit lists published yet.</p>
      <p className="text-xs text-muted-foreground mt-1">
        Use the School or BISE tab above to generate and publish one.
      </p>
    </div>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {records.map((r) => {
        const now = new Date();
        const isScheduled = r.publish_at && isAfter(new Date(r.publish_at), now);
        const isLive = r.is_published && (!r.publish_at || !isScheduled);
        const entryRows = Array.isArray(r.entries) ? r.entries : [];
        const visibleRows = entryRows.filter(e => !e.hidden);
        // Hidden students = anonymous placeholder rows in the snapshot, or
        // (legacy rows) the gap between total_students and the visible rows.
        const hiddenCount = Math.max(
          entryRows.filter(e => e.hidden).length,
          (r.total_students ?? 0) - visibleRows.length,
          0
        );
        const hasHiddenStudents = hiddenCount > 0;
        const studentCount = r.total_students ?? entryRows.length;
        const passCount = r.passing_count ?? 0;
        const theme = THEME_PRESETS.find(t => t.id === r.theme) || THEME_PRESETS[0];
        return (
          <div
            key={r.id}
            className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-all hover:shadow-md`}
          >
            {/* Top accent bar */}
            <div className={`h-1.5 bg-gradient-to-r ${theme.from} ${theme.to}`} />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${theme.from} ${theme.to} text-white flex items-center justify-center shrink-0 shadow-sm`}>
                  {r.scope === "school" ? <School className="w-5 h-5" /> : r.scope === "school-bise" ? <Trophy className="w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground leading-snug break-words">
                    {r.title || (
                      r.scope === "school" ? `School Merit List ${r.year}`
                      : r.scope === "school-bise" ? `BISE Merit List — ${r.exam_type || "Exam"} ${r.year}`
                      : `Class ${r.class} — ${r.exam_type ? examTypeLabel(r.exam_type) : "Exam"} ${r.year}`
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.scope === "school" ? "School" : r.scope === "school-bise" ? "BISE (Class 9th & 10th)" : `Class ${r.class}`}
                    {r.exam_type && ` · ${r.scope === "school-bise" ? r.exam_type : examTypeLabel(r.exam_type)}`}
                    {` · Year ${r.year}`}
                  </p>
                  {r.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">"{r.notes}"</p>
                  )}
                  {/* Stats line — same rule as the public page: while students
                      are withheld, Highest % shows a dash (the best visible
                      score is not the real topper) and a hidden pill explains why. */}
                  {studentCount > 0 && (
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {studentCount}</span>
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {passCount} passed</span>
                      {hasHiddenStudents ? (
                        <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> —</span>
                      ) : (
                        r.highest_percentage != null && Number(r.highest_percentage) > 0 && (
                          <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {Number(r.highest_percentage).toFixed(1)}%</span>
                        )
                      )}
                      {hasHiddenStudents && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-semibold">
                          <EyeOff className="w-3 h-3" /> {hiddenCount} hidden
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                    Created {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={async () => {
                    if (!confirm("Delete this merit list? Students will no longer see it.")) return;
                    try {
                      await deleteMut.mutateAsync(r.id);
                      toast.success("Merit list deleted");
                    } catch (err) {
                      toast.error(err?.message || "Delete failed");
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {isLive && (
                  <Badge className="bg-emerald-100 text-emerald-700 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Live
                  </Badge>
                )}
                {isScheduled && r.publish_at && (
                  <CountdownBadge publishAt={r.publish_at} />
                )}
                {!r.is_published && (
                  <Badge variant="secondary" className="gap-1">
                    <EyeOff className="w-3 h-3" /> Hidden
                  </Badge>
                )}
                {/* Snapshot badge — counts the VISIBLE rows; withheld students
                    sit in the snapshot as anonymous dash placeholders */}
                {entryRows.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-[10px] border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                    <Award className="w-3 h-3" /> Snapshot ({visibleRows.length})
                  </Badge>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Hero Banner ──────────────────────────────────────────────────────────────
function HeroBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
          <Trophy className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">{title}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Whole School Merit Tab ────────────────────────────────────────────────────
function SchoolMeritTab() {
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));
  const [viewMode, setViewMode] = useState<"combined"|"class">("combined");
  const [selectedClass, setSelectedClass] = useState("6");
  const [publishOpen, setPublishOpen] = useState(false);
  const year = parseInt(yearInput, 10);
  const validYear = !isNaN(year) && year >= 2000 && year <= 2099;

  const { data: byClass = {}, isLoading } = useAllClassesMerit(validYear ? year : 0);
  const { data: records = [] } = useMeritListRecords();

  const sortedClasses = Object.keys(byClass).sort();

  const allEntries = useMemo(() => {
    const all: MeritEntry[] = [];
    for (const cls of sortedClasses) { all.push(...(byClass[cls] || [])); }
    return all.sort((a, b) => b.percentage - a.percentage).map((e, i) => ({ ...e, position: i + 1 }));
  }, [byClass, sortedClasses]);

  const totalStudents = allEntries.length;
  // Trust is_pass as-is — it already reflects manual_pass_fail overrides.
  const passing = allEntries.filter(e => e.is_pass);

  const displayEntries = useMemo(() => {
    if (viewMode === "combined") return allEntries;
    return (byClass[selectedClass] || []);
  }, [viewMode, selectedClass, allEntries, byClass]);

  const existing = records.find(
    r => r.scope === "school" && r.class === "school" && r.year === year
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">Year</Label>
            <Input type="number" value={yearInput} onChange={e => setYearInput(e.target.value)}
              placeholder="2025" min={2000} max={2099}
              className={`h-9 text-sm rounded-xl ${!validYear && yearInput.length > 0 ? "border-destructive" : ""}`} />
          </div>
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">View Mode</Label>
            <Select value={viewMode} onValueChange={v => setViewMode(v as any)}>
              <SelectTrigger className="h-9 text-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="combined">All Combined</SelectItem>
                <SelectItem value="class">Single Class</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {viewMode === "class" && (
            <div className="col-span-2">
              <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">Class</Label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger className="h-9 text-sm rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortedClasses.map(c => <SelectItem key={c} value={c}>Class {c} ({byClass[c]?.length || 0} students)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {!isLoading && totalStudents > 0 && (
        <div className="space-y-2.5">
          <div className="flex gap-2 flex-wrap items-center">
            <Button onClick={() => generateAllClassesPDF(byClass, year, existing?.title)} variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-950/30">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </Button>
            <Button onClick={() => setPublishOpen(true)} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none">
              <Plus className="w-3.5 h-3.5" />
              {existing ? "Update Merit List" : "Publish Merit List"}
            </Button>
            {existing && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3" />
                {existing.publish_at && isAfter(new Date(existing.publish_at), new Date()) ? "Scheduled" : "Published"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{sortedClasses.length} class{sortedClasses.length === 1 ? "" : "es"}</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{totalStudents} students</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{passing.length} passed</span>
          </div>
        </div>
      )}

      {/* Stats */}
      {!isLoading && displayEntries.length > 0 && <StatsRow entries={displayEntries} />}

      {/* Top-3 podium (only in combined view to keep class view focused on its own top-3) */}
      {!isLoading && viewMode === "combined" && allEntries.length > 0 && <Top3Podium entries={allEntries} showClass />}

      {/* Table */}
      {!validYear ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Enter a valid year to view school merit list.</div>
      ) : isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : totalStudents === 0 ? (
        <Card><CardContent className="p-10 text-center">
          <School className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No results found for year {year}.</p>
          <p className="text-xs text-muted-foreground mt-1">Go to Manage Results and add results for this year.</p>
        </CardContent></Card>
      ) : (
        <MeritTable entries={displayEntries} showClass={viewMode === "combined"} />
      )}

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        scope="school"
        cls="school"
        examType=""
        year={year}
        entries={allEntries}
        byClass={byClass}
      />
    </div>
  );
}

// ─── BISE Merit Tab — completely separate from School Merit ─────────────────
// Class 9th/10th BISE Peshawar board results (Annual-I / Annual-II), ranked
// by percentage (600 total for 9th, 1200 for 10th). This is its own
// scope ("school-bise") with its own publish button and its own row in
// merit_lists — publishing this NEVER touches or republishes the School
// Merit List, and vice versa. The two are unrelated result sources that
// happen to also cover classes 9/10, and admins need to be able to reveal
// one without the other (e.g. share the board merit list ahead of a
// program while school mid-term results stay untouched).
const biseExamTypeLabel = (examType: string) => examType;

function BiseMeritTab() {
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear()));
  const [examType, setExamType] = useState("Annual-I");
  const [publishOpen, setPublishOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"combined" | "class">("combined");
  const [selectedClass, setSelectedClass] = useState("9");
  const year = parseInt(yearInput, 10);
  const validYear = !isNaN(year) && year >= 2000 && year <= 2099;

  const { data, isLoading, isFetching, retryMissing } =
    useBiseClassMerit(validYear ? year : 0, examType);
  const [isRetryingMissing, setIsRetryingMissing] = useState(false);
  const biseByClass = data?.byClass ?? {};
  const meta = data?.meta;
  const { data: records = [] } = useMeritListRecords();

  const sortedClasses = Object.keys(biseByClass).sort();

  const allEntries = useMemo(() => {
    const all: MeritEntry[] = [];
    for (const cls of sortedClasses) all.push(...(biseByClass[cls] || []));
    return all.sort((a, b) => b.percentage - a.percentage).map((e, i) => ({ ...e, position: i + 1 }));
  }, [biseByClass, sortedClasses]);

  const totalStudents = allEntries.length;
  const passing = allEntries.filter(e => e.is_pass);

  const displayEntries = useMemo(() => {
    if (viewMode === "combined") return allEntries;
    return biseByClass[selectedClass] || [];
  }, [viewMode, selectedClass, allEntries, biseByClass]);

  // Separate scope so this NEVER collides with, or gets bundled into, the
  // school scope's single row.
  const existing = records.find(
    r => r.scope === "school-bise" && r.class === "school-bise" && r.exam_type === examType && r.year === year
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm">
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">Year</Label>
            <Input type="number" value={yearInput} onChange={e => setYearInput(e.target.value)}
              placeholder="2025" min={2000} max={2099}
              className={`h-9 text-sm rounded-xl ${!validYear && yearInput.length > 0 ? "border-destructive" : ""}`} />
          </div>
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">BISE Exam Type</Label>
            <Select value={examType} onValueChange={setExamType}>
              <SelectTrigger className="h-9 text-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Annual-I">{biseExamTypeLabel("Annual-I")}</SelectItem>
                <SelectItem value="Annual-II">{biseExamTypeLabel("Annual-II")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">View Mode</Label>
            <Select value={viewMode} onValueChange={v => setViewMode(v as any)}>
              <SelectTrigger className="h-9 text-sm rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="combined">9th + 10th Combined</SelectItem>
                <SelectItem value="class">Single Class</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {viewMode === "class" && (
            <div className="col-span-2">
              <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">Class</Label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger className="h-9 text-sm rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sortedClasses.map(c => <SelectItem key={c} value={c}>Class {c} ({biseByClass[c]?.length || 0} students)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        {(isLoading || isFetching) && (
          <p className="text-xs text-muted-foreground mt-2.5 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Fetching Class 9th/10th BISE Peshawar results...
          </p>
        )}
        {!isLoading && !isFetching && totalStudents > 0 && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2.5 flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3" />
            {totalStudents} BISE Peshawar result{totalStudents === 1 ? "" : "s"} (Class 9th: 600 total, Class 10th: 1200 total — ranked by percentage, never raw marks).
          </p>
        )}
        {!isLoading && !isFetching && meta && meta.missingRolls.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs text-amber-800 flex-1 min-w-[200px]">
              ⚠️ {meta.resolvedRolls} of {meta.savedRolls} saved roll numbers fetched. {meta.missingRolls.length} still missing
              ({meta.missingRolls.map(m => m.roll).join(", ")}) — this is usually a temporary BISE server hiccup, not a real gap.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-950/30 shrink-0"
              onClick={async () => {
                setIsRetryingMissing(true);
                try {
                  await retryMissing();
                } finally {
                  setIsRetryingMissing(false);
                }
              }}
              disabled={isRetryingMissing}
            >
              {isRetryingMissing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Retry missing
            </Button>
          </div>
        )}
        {!isLoading && !isFetching && totalStudents === 0 && (
          <p className="text-xs text-muted-foreground mt-2.5">
            No saved roll numbers for {biseExamTypeLabel(examType)} {year}. Save roll numbers first via
            the Report Card feature on the public Results page (Class 9th/10th).
          </p>
        )}
      </div>

      {/* Actions */}
      {!isLoading && totalStudents > 0 && (
        <div className="space-y-2.5">
          <div className="flex gap-2 flex-wrap items-center">
            <Button onClick={() => setPublishOpen(true)} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none">
              <Plus className="w-3.5 h-3.5" />
              {existing ? "Update BISE Merit List" : "Publish BISE Merit List"}
            </Button>
            {existing && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800">
                <CheckCircle2 className="w-3 h-3" />
                {existing.publish_at && isAfter(new Date(existing.publish_at), new Date()) ? "Scheduled" : "Published"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{sortedClasses.length} class{sortedClasses.length === 1 ? "" : "es"}</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{totalStudents} students</span>
            <span className="px-2 py-0.5 rounded-full bg-muted/50 border border-border/60">{passing.length} passed</span>
          </div>
        </div>
      )}

      {/* Stats */}
      {!isLoading && displayEntries.length > 0 && <StatsRow entries={displayEntries} />}

      {/* Top-3 podium */}
      {!isLoading && viewMode === "combined" && allEntries.length > 0 && <Top3Podium entries={allEntries} showClass />}

      {/* Table */}
      {!validYear ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Enter a valid year to view BISE merit list.</div>
      ) : isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : totalStudents === 0 ? (
        <Card><CardContent className="p-10 text-center">
          <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No BISE results found for {biseExamTypeLabel(examType)} {year}.</p>
          <p className="text-xs text-muted-foreground mt-1">Save Class 9th/10th roll numbers via the Report Card feature first.</p>
        </CardContent></Card>
      ) : (
        <MeritTable entries={displayEntries} showClass={viewMode === "combined"} />
      )}

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        scope="school-bise"
        cls="school-bise"
        examType={examType}
        year={year}
        entries={allEntries}
        byClass={biseByClass}
      />
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
const AdminMeritList = () => {
  const { data: records = [] } = useMeritListRecords();
  const tabCls = "h-8 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";
  return (
    <div className="min-w-0 space-y-4 pb-20 md:pb-0">
      <HeroBanner
        title="Merit List Manager"
        subtitle="Generate, snapshot and publish ranked merit lists with countdowns and PDFs."
      />

      <Tabs defaultValue="school">
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="grid h-10 w-full grid-cols-3 gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:inline-flex sm:w-auto">
            <TabsTrigger value="school" className={tabCls}><School className="w-3.5 h-3.5 shrink-0" /> School</TabsTrigger>
            <TabsTrigger value="bise" className={tabCls}><Trophy className="w-3.5 h-3.5 shrink-0" /> BISE</TabsTrigger>
            <TabsTrigger value="published" className={tabCls}><Calendar className="w-3.5 h-3.5 shrink-0" /> Published ({records.length})</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="school" className="mt-4"><SchoolMeritTab /></TabsContent>
        <TabsContent value="bise" className="mt-4"><BiseMeritTab /></TabsContent>
        <TabsContent value="published" className="mt-4">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed rounded-2xl bg-secondary/40 border border-border/60 px-3 py-2.5">
              Live lists are visible to students now; scheduled ones show a countdown until the publish time.
              Each published list is a <strong>permanent snapshot</strong> — deleting results in Manage Results won't affect it.
            </p>
            <PublishedList records={records} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminMeritList;
