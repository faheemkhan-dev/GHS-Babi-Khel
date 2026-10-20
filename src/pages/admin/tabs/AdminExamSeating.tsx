/**
 * AdminExamSeating.tsx
 * Exam Seating Plan Engine — admin tab.
 *
 * Capabilities:
 *  1. Create a seating plan tied to an existing exam session. Every plan
 *     covers ALL papers of the session's exam term (start → end of the
 *     Exam Date Sheet) — there is no single-day mode.
 *  2. Define rooms (name, rows × cols grid, blocked cells, invigilators).
 *  3. Auto-generate seating — anti-cheat class mixing (no two same-class
 *     students sit orthogonally adjacent), respects capacity, snake-fill
 *     desk order.
 *  4. View per-room desk-layout grid (color-coded by class).
 *  5. Print desk-layout map (PDF) per room — for pasting on the hall wall.
 *  6. Print per-desk sticker sheet (PDF) — one sticker per desk.
 *  7. Print the exam-staff duties PDF.
 *
 * There is no student-facing publishing step: the student portal no longer
 * shows seating, so plans are managed and printed from the admin panel only.
 *
 * Integrates with the existing exam_roll_sessions table (no schema change
 * to existing tables — only adds the three new seating_* tables).
 */
import { useState, useMemo, useEffect, lazy, Suspense, memo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  LayoutGrid, Plus, Trash2, Loader2, Printer, Wand2, ArrowLeft,
  Building2, Users, AlertTriangle, Grid3x3, Tag, FileText, Monitor,
  CalendarDays, ChevronRight, Check, Sparkles, Info, Layers,
} from "lucide-react";
import toast from "react-hot-toast";
// PERF (chunk size): jspdf is loaded ONLY inside the three PDF buttons'
// click handlers (dynamic import) — the old static import shipped ~142 KB
// compressed of PDF library to every admin who opened this tab. The dead
// `autoTable` import (never called in this file) is deleted outright.
// AdminExamConsole is lazy: it is a whole live-console subsystem (its own
// jspdf usage, a 1 s clock ticker and realtime attendance machinery) that
// only matters when the "Live Console" pill is selected.
const AdminExamConsole = lazy(() => import("./AdminExamConsole"));
import {
  useExamSessions,
} from "@/hooks/useExamAttendance";
import { useAllExamSchedule, type ExamScheduleEntry } from "@/hooks/useNewFeatures";
import {
  useSeatingPlans, useSeatingPlan,
  useCreateSeatingPlan, useDeleteSeatingPlan, useUpsertRoom, useDeleteRoom,
  useGenerateSeating, useUpdateSeatingPlanStaff,
  autoSplitColDuties, resolveColDuties,
  resolveClassPaperTime, listPlanPaperTimes,
  SUPERINTENDENT_DUTY, DEPUTY_SUPERINTENDENT_DUTY, INVIGILATOR_DUTY,
  type SeatingRoom, type RoomWithAssignments, type SeatingPlanFull, type ClassPaperTime,
} from "@/hooks/useExamSeating";

// Distinct, accessible colors for up to 8 classes. Beyond 8, fall back to a hash.
const CLASS_COLORS: Record<string, { bg: string; text: string; pdfRgb: [number, number, number] }> = {
  "6":  { bg: "bg-blue-100 dark:bg-blue-900/40",       text: "text-blue-700 dark:text-blue-300",       pdfRgb: [219, 234, 254] },
  "7":  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", pdfRgb: [209, 250, 229] },
  "8":  { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-300",     pdfRgb: [254, 243, 199] },
  "9":  { bg: "bg-rose-100 dark:bg-rose-900/40",       text: "text-rose-700 dark:text-rose-300",       pdfRgb: [254, 205, 211] },
  "10": { bg: "bg-violet-100 dark:bg-violet-900/40",   text: "text-violet-700 dark:text-violet-300",   pdfRgb: [237, 233, 254] },
};
const colorFor = (cls: string) =>
  CLASS_COLORS[cls] ?? { bg: "bg-slate-100 dark:bg-slate-900/40", text: "text-slate-700 dark:text-slate-300", pdfRgb: [226, 232, 240] };

// ── Shared mobile-safe styles ────────────────────────────────────────────────
// 16px font on mobile prevents iOS focus-zoom; thin 32px buttons; no truncation.
const fieldCls = "h-9 w-full min-w-0 rounded-lg px-2.5 text-base sm:text-sm";
const thinBtn = "h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none [&_svg]:size-3.5";
const adContent = "w-[calc(100vw-1.5rem)] max-w-md rounded-2xl p-4 sm:p-6";
const adFooter = "flex-row gap-2 sm:space-x-0";
const adBtn = "mt-0 h-9 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none";
const chip = "inline-flex h-6 min-w-0 items-center whitespace-nowrap rounded-full border border-border/60 bg-muted/50 px-2.5 text-[11px] font-medium text-muted-foreground";

/** Parse "yyyy-MM-dd" as a LOCAL date (avoids off-by-one in negative UTC offsets). */
const fmtD = (s?: string | null, pattern = "dd MMM yyyy") => {
  if (!s) return "";
  try {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
    return format(d, pattern);
  } catch { return String(s); }
};

/** Premium gradient banner shared by the list and editor views. */
const Banner = ({ icon, title, subtitle, children, leading }: {
  icon?: React.ReactNode; title: string; subtitle?: string; children?: React.ReactNode; leading?: React.ReactNode;
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
    <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
    <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
    <div className="relative flex min-w-0 items-center gap-3">
      {leading}
      {icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground sm:text-sm">{subtitle}</p>}
      </div>
    </div>
    {children && <div className="relative mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">{children}</div>}
  </div>
);

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────
const AdminExamSeating = () => {
  const [topTab, setTopTab] = useState<"seating" | "console">("seating");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);

  return (
    <div className="min-w-0 space-y-4 pb-20 md:pb-0">
      {/* Thin pill toggle */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex h-10 w-full min-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:w-auto sm:min-w-0">
          <button
            type="button"
            onClick={() => setTopTab("seating")}
            className={`flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all sm:flex-none ${
              topTab === "seating" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Seating Plans
          </button>
          <button
            type="button"
            onClick={() => setTopTab("console")}
            className={`flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all sm:flex-none ${
              topTab === "console" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
            }`}
          >
            <Monitor className="h-3.5 w-3.5" /> Live Console
          </button>
        </div>
      </div>

      {topTab === "console" ? (
        <Suspense fallback={<div className="flex items-center justify-center py-24 text-sm text-muted-foreground">Loading Live Console…</div>}>
          <AdminExamConsole />
        </Suspense>
      ) : selectedPlanId ? (
        <PlanEditor planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} />
      ) : (
        <PlansList selectedSessionId={selectedSessionId} setSelectedSessionId={setSelectedSessionId} onOpenPlan={setSelectedPlanId} />
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 1. PLANS LIST
// ────────────────────────────────────────────────────────────────────────────
const PlansList = ({
  selectedSessionId, setSelectedSessionId, onOpenPlan,
}: {
  selectedSessionId: string | undefined;
  setSelectedSessionId: (id: string | undefined) => void;
  onOpenPlan: (id: string) => void;
}) => {
  const { data: sessions = [], isLoading: loadingSessions } = useExamSessions();
  const { data: plans = [], isLoading: loadingPlans } = useSeatingPlans(selectedSessionId);

  // Pick the most recent session by default.
  const effectiveSessionId = selectedSessionId ?? sessions[0]?.id;
  const { data: plansForDefault = [] } = useSeatingPlans(effectiveSessionId);

  const plansToShow = selectedSessionId ? plans : plansForDefault;
  const activeSession = sessions.find(s => s.id === effectiveSessionId);

  return (
    <div className="min-w-0 space-y-4">
      <Banner
        icon={<LayoutGrid className="h-[18px] w-[18px]" />}
        title="Exam Seating"
        subtitle="Room-wise seating with anti-cheat class mixing for every paper."
      >
        <span className={chip}>{plansToShow.length} {plansToShow.length === 1 ? "plan" : "plans"}</span>
        {activeSession && <span className={chip}>{activeSession.exam_term} {activeSession.exam_year}</span>}
        {activeSession && <span className={chip}>{activeSession.classes.length} classes</span>}
      </Banner>

      {/* Session picker + create-new */}
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="space-y-3.5 p-3.5 sm:p-4">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Exam Session</Label>
            <select
              value={effectiveSessionId ?? ""}
              onChange={e => setSelectedSessionId(e.target.value || undefined)}
              className={`${fieldCls} border border-input bg-card text-foreground`}
            >
              <option value="">— Select a session —</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.exam_term} {s.exam_year}) · {s.classes.length} classes
                </option>
              ))}
            </select>
          </div>
          {effectiveSessionId && <CreatePlanForm sessionId={effectiveSessionId} onCreated={onOpenPlan} />}
        </CardContent>
      </Card>

      {/* Existing plans */}
      <div className="space-y-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Building2 className="h-4 w-4 text-primary" /> Existing Plans
        </h3>

        {loadingPlans || loadingSessions ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : plansToShow.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">No seating plans yet</p>
            <p className="max-w-xs text-xs leading-snug text-muted-foreground">Create one above to get started.</p>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {plansToShow.map(p => {
              const from = (p as any).exam_date_from as string | null | undefined;
              const to = (p as any).exam_date_to as string | null | undefined;
              const dateText = from && to ? `${fmtD(from, "dd MMM")} → ${fmtD(to, "dd MMM yyyy")}` : fmtD(p.exam_date);
              const pct = p.total_students > 0 ? Math.min(100, Math.round((p.total_seated / p.total_students) * 100)) : 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenPlan(p.id)}
                  className="group w-full min-w-0 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
                      <Grid3x3 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-snug text-foreground">{p.title}</p>
                      {dateText && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarDays className="h-3 w-3 shrink-0" /> <span className="break-words">{dateText}</span>
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={p.status} />
                    {p.classes.map(c => (
                      <span key={c} className={`inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold ${colorFor(c).bg} ${colorFor(c).text}`}>
                        Class {c}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Seated</span>
                      <span className="font-mono font-semibold text-foreground">{p.total_seated}/{p.total_students}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// "published" is a legacy status from when students could look up seats; it is
// shown as plain "Generated" now that there is no student-facing publishing.
const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft:     { label: "Draft",     cls: "bg-muted text-muted-foreground border-border" },
    generated: { label: "Generated", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800" },
    published: { label: "Generated", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800" },
    archived:  { label: "Archived",  cls: "bg-muted text-muted-foreground border-border" },
  };
  const v = map[status] ?? map.draft;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v.label}</span>;
};

// ────────────────────────────────────────────────────────────────────────────
// 2. CREATE PLAN FORM
// ────────────────────────────────────────────────────────────────────────────
const CreatePlanForm = ({ sessionId, onCreated }: { sessionId: string; onCreated: (id: string) => void }) => {
  const { data: sessions = [] } = useExamSessions();
  const session = sessions.find(s => s.id === sessionId);
  // Plan title comes from the Exam Session itself — no duplicate title field.
  const planTitle = session?.title?.trim() || (session ? `${session.exam_term} ${session.exam_year}` : "");

  // ── FULLY AUTOMATIC TIMING — no manual Exam Type / Year / Paper pickers.
  // The admin just picks classes to mix. For each class, we auto-match the
  // Exam Date Sheet using this session's own exam_term + exam_year (already
  // set up in Exam Roll Numbers). Every plan covers ALL papers — every
  // date-sheet paper for that class under this exam term/year, spanning
  // start to finish.
  const { data: dateSheetEntries = [] } = useAllExamSchedule();

  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const createMut = useCreateSeatingPlan();

  const toggleClass = (c: string) => {
    setSelectedClasses(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  };

  // ── TERM-AWARE MATCHING ───────────────────────────────────────────────
  // Different classes use DIFFERENT exam-type vocabularies in the Date
  // Sheet: classes 6-8 use "1st Semester" / "2nd Semester", while classes
  // 9-10 use "Annual-I" / "Annual-II" for the exact same school-year
  // period (see AdminExamSchedule.tsx's getExamTypes). A session's
  // exam_term like "1st Semester 2026" only literally matches classes
  // 6-8's vocabulary — for Class 9/10 we need to translate "1st" → "Annual-I"
  // and "2nd" → "Annual-II" (and vice versa) so the SAME exam period is
  // found regardless of which class's own naming convention was used to
  // create the Exam Roll Numbers session.
  //
  // We detect the ordinal (1st vs 2nd) from the session's exam_term text,
  // then accept ANY date-sheet exam_type for that class whose ordinal
  // matches — "1st Semester", "Semester 1", "Annual-I", "Annual I" all
  // count as ordinal 1; "2nd Semester", "Annual-II" etc. count as ordinal 2.
  const termOrdinal = (text: string): 1 | 2 | null => {
    const t = text.trim().toLowerCase();
    const isTwo = /\b2nd\b|\bsecond\b|annual[\s-]*ii\b|\bii\b|\btwo\b|semester\s*2\b/.test(t);
    if (isTwo) return 2;
    const isOne = /\b1st\b|\bfirst\b|annual[\s-]*i\b(?!i)|\bone\b|semester\s*1\b/.test(t);
    if (isOne) return 1;
    return null;
  };

  // Loose match between the session's exam_term (e.g. "1st Semester 2026")
  // and the date sheet's exam_type (e.g. "1st Semester" or "Annual-I") —
  // matches on literal text OR on ordinal (so vocabulary differences
  // between classes don't block the automatic match).
  const examTermMatches = (examType: string, term: string) => {
    const a = examType.trim().toLowerCase();
    const b = term.trim().toLowerCase();
    if (!a || !b) return false;
    if (a === b || b.includes(a) || a.includes(b)) return true;
    const oa = termOrdinal(a);
    const ob = termOrdinal(b);
    return oa !== null && oa === ob;
  };

  // All date-sheet entries for a class that belong to THIS session's exam
  // term + year — the automatic source of truth, no picking required.
  const entriesFor = (cls: string): ExamScheduleEntry[] => {
    if (!session) return [];
    return dateSheetEntries.filter(
      e => e.class === cls && e.year === session.exam_year && examTermMatches(e.exam_type, session.exam_term)
    );
  };

  const allSelectedReady = selectedClasses.length > 0 && selectedClasses.every(cls => entriesFor(cls).length > 0);

  const handleCreate = async () => {
    if (!planTitle) { toast.error("Select an exam session first"); return; }
    if (selectedClasses.length < 2) { toast.error("Select at least 2 classes — anti-cheat mixing needs multiple classes"); return; }
    if (!allSelectedReady) { toast.error("The Exam Date Sheet has no matching papers for one or more selected classes — add them there first"); return; }

    const toIso = (date: string, time: string | null): string | null => {
      if (!date || !time) return null;
      return new Date(`${date}T${time}:00`).toISOString();
    };

    // Build the per-class timing map automatically from the Date Sheet.
    const classPaperTimes: Record<string, ClassPaperTime> = {};
    let overallFirstEntry: ExamScheduleEntry | null = null;
    let overallLastEntry: ExamScheduleEntry | null = null;

    for (const cls of selectedClasses) {
      const sorted = [...entriesFor(cls)].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (first?.start_time && first?.end_time) {
        classPaperTimes[cls] = {
          subject: first.subject,
          exam_date: first.exam_date,
          start_time: first.start_time,
          end_time: first.end_time,
        };
      }
      if (!overallFirstEntry || first.exam_date < overallFirstEntry.exam_date) overallFirstEntry = first;
      if (!overallLastEntry || last.exam_date > overallLastEntry.exam_date) overallLastEntry = last;
    }

    try {
      const plan = await createMut.mutateAsync({
        sessionId,
        title: planTitle,
        classes: selectedClasses,
        paperSubject: overallFirstEntry?.subject ?? null,
        examDate: null,
        paperStartAt: overallFirstEntry ? toIso(overallFirstEntry.exam_date, overallFirstEntry.start_time) : null,
        paperEndAt: overallFirstEntry ? toIso(overallFirstEntry.exam_date, overallFirstEntry.end_time) : null,
        isRecurring: true,
        examDateFrom: overallFirstEntry?.exam_date ?? null,
        examDateTo:   overallLastEntry?.exam_date ?? null,
        classPaperTimes,
      });
      onCreated(plan.id);
    } catch { /* toast handled in hook */ }
  };

  return (
    <div className="space-y-3.5 border-t border-border/60 pt-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gold-soft text-gold-strong">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-semibold text-foreground">New Seating Plan</p>
      </div>

      {/* ── CLASSES ── */}
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Classes to mix — select at least 2 for anti-cheat</Label>
        <div className="flex flex-wrap gap-1.5">
          {(session?.classes ?? ["6", "7", "8", "9", "10"]).map(c => {
            const on = selectedClasses.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggleClass(c)}
                className={`inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${
                  on
                    ? `${colorFor(c).bg} ${colorFor(c).text} border-current`
                    : "border-border/60 bg-card text-muted-foreground hover:border-primary/40"
                }`}
              >
                {on && <Check className="h-3 w-3" />}
                Class {c}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── AUTO-DETECTED PAPERS — nothing to select. Each selected class is
          matched automatically from the Exam Date Sheet using THIS session's
          own exam term + year. ── */}
      {selectedClasses.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-border/60 bg-secondary/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-primary" /> Papers from Exam Date Sheet
          </p>
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            <span>
              Matched automatically for <strong className="text-foreground">{session?.exam_term ?? "this session"} {session?.exam_year ?? ""}</strong>.
              Set the date sheet first if a class shows no match.
            </span>
          </p>
          <div className="space-y-1.5">
            {selectedClasses.map(cls => {
              const entries = [...entriesFor(cls)].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
              const ok = entries.length > 0;
              return (
                <div
                  key={cls}
                  className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs ${
                    ok
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-900/20"
                      : "border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20"
                  }`}
                >
                  <span className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-bold ${colorFor(cls).bg} ${colorFor(cls).text}`}>
                    Class {cls}
                  </span>
                  {ok ? (
                    <span className="flex min-w-0 flex-1 items-start gap-1 break-words leading-snug text-emerald-700 dark:text-emerald-400">
                      <Check className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>{entries.length} {entries.length === 1 ? "paper" : "papers"} · {fmtD(entries[0].exam_date, "dd MMM")} → {fmtD(entries[entries.length - 1].exam_date, "dd MMM yyyy")}</span>
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-start gap-1 break-words leading-snug text-red-600 dark:text-red-400">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>No papers found in the Exam Date Sheet</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Button onClick={handleCreate} disabled={createMut.isPending} className={`${thinBtn} w-full sm:w-auto`}>
        {createMut.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
        Create Plan
      </Button>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 3. PLAN EDITOR (rooms + generate + outputs)
// ────────────────────────────────────────────────────────────────────────────
const PlanEditor = ({ planId, onBack }: { planId: string; onBack: () => void }) => {
  const { data: plan, isLoading } = useSeatingPlan(planId);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  if (isLoading || !plan) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className={thinBtn}><ArrowLeft /> Back</Button>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const activeRoom = plan.rooms.find(r => r.id === activeRoomId) ?? plan.rooms[0] ?? null;
  const from = (plan as any).exam_date_from as string | null | undefined;
  const to = (plan as any).exam_date_to as string | null | undefined;
  const totalCapacity = plan.rooms.reduce((s, r) => s + r.capacity, 0);

  return (
    <div className="min-w-0 space-y-4">
      {/* Header banner — title wraps fully, nothing is truncated */}
      <Banner
        leading={
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to plans"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-foreground shadow-none transition-colors hover:bg-muted active:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        }
        title={plan.title}
        subtitle={plan.classes.map(c => `Class ${c}`).join(" · ")}
      >
        {from && to ? (
          <span className={chip}>{fmtD(from, "dd MMM")} → {fmtD(to, "dd MMM yyyy")}</span>
        ) : plan.exam_date ? (
          <span className={chip}>{fmtD(plan.exam_date)}</span>
        ) : null}
        <span className={chip}>{plan.status === "draft" ? "Draft" : plan.status === "archived" ? "Archived" : "Generated"}</span>
      </Banner>

      {/* Overview numbers */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Rooms" value={plan.rooms.length} />
        <StatCard label="Students" value={plan.total_students} />
        <StatCard label="Seated" value={plan.total_seated} />
        <StatCard label="Capacity" value={totalCapacity} />
      </div>

      {/* 1 · Exam staff (plan-wide) */}
      <Section step={1} icon={<Users />} title="Exam Staff" hint="Overall in-charge for the whole exam">
        <PlanStaffEditor plan={plan} />
      </Section>

      {/* 2 · Rooms (list, add, seating) */}
      <Section step={2} icon={<Building2 />} title="Rooms" hint="Add halls, then pick one to edit its desks and invigilators">
        <RoomSidebar plan={plan} activeRoomId={activeRoom?.id ?? null} onSelect={setActiveRoomId} />
        {plan.total_seated === 0 && plan.rooms.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3">
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">Rooms are ready. Generate seating to fill the desks.</p>
            <GenerateSeatingButton plan={plan} />
          </div>
        )}
      </Section>

      {/* 3 · Selected room workspace */}
      <Section step={3} icon={<Grid3x3 />} title="Room Details" hint={activeRoom ? "Desk map and invigilators of the selected room" : undefined}>
        {activeRoom ? (
          <RoomDeskMap key={activeRoom.id} room={activeRoom} plan={plan} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">No rooms yet</p>
            <p className="max-w-xs text-xs leading-snug text-muted-foreground">Add a room in step 2 to build its desk layout.</p>
          </div>
        )}
      </Section>

      {/* 4 · Print & manage */}
      <Section step={4} icon={<FileText />} title="Print & Manage">
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardContent className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <QrStickerSheetButton plan={plan} />
              <DutiesPdfButton plan={plan} />
            </div>
            <div className="border-t border-border/60 pt-3">
              <DeletePlanButton planId={plan.id} sessionId={plan.session_id} onDeleted={onBack} />
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
};

/**
 * Plan-wide exam staff: Superintendent and Deputy Superintendent — these are
 * overall roles for the whole seating plan (distinct from per-room
 * invigilators, which are assigned inside each room). Saves on blur, same
 * pattern as the room notes/invigilator fields.
 */
const PlanStaffEditor = ({ plan }: { plan: SeatingPlanFull }) => {
  const updateStaff = useUpdateSeatingPlanStaff();
  const [superintendent, setSuperintendent] = useState((plan as any).superintendent ?? "");
  const [deputy, setDeputy] = useState((plan as any).deputy_superintendent ?? "");
  // Duty text defaults to the standard responsibilities (see hook) whenever
  // the plan doesn't have a custom override saved — admin can edit it if a
  // particular exam needs different instructions.
  const [superintendentDuty, setSuperintendentDuty] = useState(
    (plan as any).superintendent_duty ?? SUPERINTENDENT_DUTY
  );
  const [deputyDuty, setDeputyDuty] = useState(
    (plan as any).deputy_superintendent_duty ?? DEPUTY_SUPERINTENDENT_DUTY
  );
  const [showDuties, setShowDuties] = useState(false);
  useEffect(() => {
    setSuperintendent((plan as any).superintendent ?? "");
    setDeputy((plan as any).deputy_superintendent ?? "");
    setSuperintendentDuty((plan as any).superintendent_duty ?? SUPERINTENDENT_DUTY);
    setDeputyDuty((plan as any).deputy_superintendent_duty ?? DEPUTY_SUPERINTENDENT_DUTY);
  }, [plan.id]);

  const save = async (next: {
    superintendent?: string; deputy?: string;
    superintendentDuty?: string; deputyDuty?: string;
  }) => {
    const s  = next.superintendent ?? superintendent;
    const d  = next.deputy ?? deputy;
    const sd = next.superintendentDuty ?? superintendentDuty;
    const dd = next.deputyDuty ?? deputyDuty;
    const unchanged =
      s === ((plan as any).superintendent ?? "") &&
      d === ((plan as any).deputy_superintendent ?? "") &&
      sd === ((plan as any).superintendent_duty ?? SUPERINTENDENT_DUTY) &&
      dd === ((plan as any).deputy_superintendent_duty ?? DEPUTY_SUPERINTENDENT_DUTY);
    if (unchanged) return;
    await updateStaff.mutateAsync({
      planId: plan.id,
      sessionId: plan.session_id,
      superintendent: s || null,
      deputySuperintendent: d || null,
      // Only save duty text if it differs from the standard default, so we
      // don't clutter the DB with the default text on every plan — null
      // means "use the standard default", which the UI already handles.
      superintendentDuty: sd !== SUPERINTENDENT_DUTY ? sd : null,
      deputySuperintendentDuty: dd !== DEPUTY_SUPERINTENDENT_DUTY ? dd : null,
    });
  };

  return (
    <Card className="rounded-2xl border-border/60 shadow-sm">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button" size="sm" variant="ghost"
            className="h-8 min-w-0 shrink-0 whitespace-nowrap rounded-full px-3 text-[11px] font-semibold shadow-none text-primary"
            onClick={() => setShowDuties(s => !s)}
          >
            {showDuties ? "Hide duties" : "Edit duties"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label className="text-[11px] text-muted-foreground">Superintendent</Label>
            <Input
              value={superintendent}
              onChange={e => setSuperintendent(e.target.value)}
              onBlur={() => save({ superintendent })}
              placeholder="e.g. Mr. Principal Khan"
              className={fieldCls}
            />
            {showDuties && (
              <textarea
                value={superintendentDuty}
                onChange={e => setSuperintendentDuty(e.target.value)}
                onBlur={() => save({ superintendentDuty })}
                rows={3}
                className="mt-1.5 w-full min-w-0 resize-y rounded-lg border border-input bg-card px-2.5 py-1.5 text-base leading-snug text-muted-foreground sm:text-xs"
                placeholder="Duty description"
              />
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <Label className="text-[11px] text-muted-foreground">Deputy Superintendent</Label>
            <Input
              value={deputy}
              onChange={e => setDeputy(e.target.value)}
              onBlur={() => save({ deputy })}
              placeholder="e.g. Mr. Vice Principal"
              className={fieldCls}
            />
            {showDuties && (
              <textarea
                value={deputyDuty}
                onChange={e => setDeputyDuty(e.target.value)}
                onBlur={() => save({ deputyDuty })}
                rows={3}
                className="mt-1.5 w-full min-w-0 resize-y rounded-lg border border-input bg-card px-2.5 py-1.5 text-base leading-snug text-muted-foreground sm:text-xs"
                placeholder="Duty description"
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const StatCard = ({ label, value }: { icon?: React.ReactNode; label: string; value: number }) => (
  <div className="min-w-0 rounded-xl border border-border/60 bg-card px-2 py-2 text-center shadow-sm">
    <p className="text-base font-bold leading-none tabular-nums text-foreground sm:text-xl">{value}</p>
    <p className="mt-1 whitespace-nowrap text-[10px] font-medium leading-tight text-muted-foreground sm:text-[11px]">{label}</p>
  </div>
);

/** Numbered, titled section wrapper so every control has one obvious home. */
const Section = ({ step, icon, title, hint, right, children }: {
  step: number; icon: React.ReactNode; title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode;
}) => (
  <section className="min-w-0 space-y-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{step}</span>
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-foreground">
            <span className="text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>{title}
          </h3>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
);

// ────────────────────────────────────────────────────────────────────────────
// 4. ROOM SIDEBAR
// ────────────────────────────────────────────────────────────────────────────
const RoomSidebar = ({ plan, activeRoomId, onSelect }: {
  plan: SeatingPlanFull;
  activeRoomId: string | null;
  onSelect: (id: string) => void;
}) => {
  const upsert = useUpsertRoom();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(5);
  // Multiple invigilators per room: an array of names, one input per entry.
  // Starts with a single empty field; "+ Add Invigilator" appends another.
  const [invigilators, setInvigilators] = useState<string[]>([""]);

  const handleAdd = async () => {
    if (!name.trim()) { toast.error("Room name required"); return; }
    try {
      const cleanInvigilators = invigilators.map(s => s.trim()).filter(Boolean);
      const created: any = await upsert.mutateAsync({ planId: plan.id, room: { name: name.trim(), rows, cols, invigilators: cleanInvigilators } });
      if (created?.id) onSelect(created.id);
      setName(""); setRows(6); setCols(5); setInvigilators([""]);
      setShowForm(false);
    } catch { /* handled */ }
  };

  return (
    <div className="min-w-0 space-y-2.5">
      <Button size="sm" variant={showForm ? "ghost" : "outline"} onClick={() => setShowForm(s => !s)} className={`${thinBtn} w-full`}>
        {showForm ? <ArrowLeft /> : <Plus />}
        {showForm ? "Close" : "Add Room"}
      </Button>

      {showForm && (
        <Card className="rounded-2xl border-border/60 shadow-sm">
          <CardContent className="space-y-3 p-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Room name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hall A" className={fieldCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Rows</Label>
                <Input type="number" inputMode="numeric" min={1} max={30} value={rows} onChange={e => setRows(Math.max(1, +e.target.value || 1))} className={fieldCls} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-[11px] text-muted-foreground">Cols</Label>
                <Input type="number" inputMode="numeric" min={1} max={30} value={cols} onChange={e => setCols(Math.max(1, +e.target.value || 1))} className={fieldCls} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Invigilator(s) (optional)</Label>
              {invigilators.map((val, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Input
                    value={val}
                    onChange={e => setInvigilators(list => list.map((v, i) => i === idx ? e.target.value : v))}
                    placeholder={idx === 0 ? "e.g. Mr. Ahmad" : `Invigilator ${idx + 1}`}
                    className={fieldCls}
                  />
                  {invigilators.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Remove invigilator"
                      className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                      onClick={() => setInvigilators(list => list.filter((_, i) => i !== idx))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`${thinBtn} w-full`}
                onClick={() => setInvigilators(list => [...list, ""])}
              >
                <Plus /> Add Invigilator
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Capacity: <strong className="text-foreground">{rows * cols}</strong> desks</p>
            <Button size="sm" onClick={handleAdd} disabled={upsert.isPending} className={`${thinBtn} w-full`}>
              {upsert.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add Room
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {plan.rooms.length === 0 && !showForm && (
          <p className="col-span-full rounded-2xl border border-dashed border-border py-5 text-center text-xs text-muted-foreground">
            Tap “Add Room” to define your first room
          </p>
        )}
        {plan.rooms.map(r => {
          const active = activeRoomId === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className={`w-full min-w-0 rounded-2xl border p-2.5 text-left transition-all ${
                active ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30" : "border-border/60 bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{r.name}</span>
                <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-secondary px-2 text-[10px] font-semibold text-foreground">
                  {r.assignments.length}/{r.capacity}
                </span>
              </div>
              <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                {r.rows}×{r.cols} grid{(r.block_layout?.length ?? 0) > 0 ? ` · ${r.block_layout.length} blocked` : ""}
                {r.invigilators?.length ? ` · ${r.invigilators.join(", ")}` : ""}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 5. ROOM DESK MAP (visual grid editor + viewer)
// ────────────────────────────────────────────────────────────────────────────

/* PERF: the desk grid can be up to 30×30 = 900 cells, and the invigilator /
   duty / notes inputs live in the SAME component — every keystroke used to
   re-render every cell, each cell re-scanning the whole block_layout array
   and re-running a findIndex over duties. The cell is now a memoised
   component fed by precomputed Set/lookup props, so typing in the side
   inputs re-renders nothing but the input itself. */
const DUTY_BAND_COLORS = [
  "border-t-4 border-t-blue-400", "border-t-4 border-t-emerald-400",
  "border-t-4 border-t-amber-400", "border-t-4 border-t-rose-400",
  "border-t-4 border-t-violet-400", "border-t-4 border-t-cyan-400",
];

interface DeskCellProps {
  idx: number;
  r: number;
  c: number;
  isBlocked: boolean;
  assign: RoomWithAssignments["assignments"][number] | undefined;
  bandClass: string;
  onToggle: (r: number, c: number) => void;
}

const DeskCell = memo(({ idx, r, c, isBlocked, assign, bandClass, onToggle }: DeskCellProps) => {
  if (isBlocked) {
    return (
      <div
        key={idx}
        onClick={() => onToggle(r, c)}
        className={`flex min-h-[58px] cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-foreground/10 text-[11px] text-muted-foreground dark:bg-foreground/20 ${bandClass}`}
        title="Blocked — tap to unblock"
      >
        ✕
      </div>
    );
  }
  if (assign) {
    const cc = colorFor(assign.class);
    return (
      <div
        key={idx}
        className={`flex min-h-[58px] flex-col justify-between gap-0.5 rounded-lg border p-1.5 text-[10px] leading-tight shadow-sm ${cc.bg} ${cc.text} ${bandClass}`}
        title={`${assign.student_name} · Class ${assign.class} · ${assign.seat_label}`}
      >
        <span className="font-bold">R{r + 1}·S{c + 1}</span>
        <span className="line-clamp-2 break-words font-semibold">{assign.student_name}</span>
        <span className="font-mono opacity-70">{assign.exam_roll_no}</span>
      </div>
    );
  }
  return (
    <div
      key={idx}
      onClick={() => onToggle(r, c)}
      className={`flex min-h-[58px] cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-[10px] text-muted-foreground hover:bg-secondary ${bandClass}`}
      title={`Empty desk R${r + 1}·S${c + 1} — tap to block`}
    >
      R{r + 1}·S{c + 1}
    </div>
  );
});
DeskCell.displayName = "DeskCell";

const RoomDeskMap = ({ room, plan }: { room: RoomWithAssignments; plan: SeatingPlanFull }) => {
  const upsert = useUpsertRoom();
  const delRoom = useDeleteRoom();
  // Destructured so the memoised cell toggle below can depend on the STABLE
  // mutateAsync (the `upsert` result object itself gets a new identity every
  // render, which would defeat the DeskCell memo).
  const { mutateAsync: upsertRoomAsync } = upsert;

  // Controlled local copies of invigilators/notes, re-synced whenever the
  // active room changes (by id) — this fixes a bug where switching rooms
  // without a remount left the previous room's invigilator name showing in
  // the input (defaultValue only applies once, on mount).
  const [invigilatorsInput, setInvigilatorsInput] = useState<string[]>(
    room.invigilators?.length ? room.invigilators : [""]
  );
  const [notesInput, setNotesInput] = useState(room.notes ?? "");
  const [view, setView] = useState<"map" | "staff">("map");
  // Column duty range per invigilator (index-aligned with invigilatorsInput).
  // Starts from the saved value if present, otherwise an even auto-split —
  // same fallback the hook itself uses, kept in sync here for editing.
  const [dutiesInput, setDutiesInput] = useState<{ col_start: number; col_end: number }[]>(
    resolveColDuties(room)
  );
  useEffect(() => {
    setInvigilatorsInput(room.invigilators?.length ? room.invigilators : [""]);
    setNotesInput(room.notes ?? "");
    setDutiesInput(resolveColDuties(room));
  }, [room.id]);

  const saveInvigilators = async (next: string[]) => {
    try {
      const cleanNext = next.map(s => s.trim()).filter(Boolean);
      // Re-flow duty ranges to match the new invigilator count so a newly
      // added/removed invigilator immediately gets a sensible column range
      // instead of an empty one.
      const nextDuties = autoSplitColDuties(room.cols, cleanNext.length);
      setDutiesInput(nextDuties);
      await upsert.mutateAsync({
        planId: plan.id,
        room: { id: room.id, name: room.name, rows: room.rows, cols: room.cols, block_layout: room.block_layout, invigilators: cleanNext, invigilator_duties: nextDuties, notes: room.notes },
      });
    } catch { /* handled */ }
  };

  const saveDuties = async (next: { col_start: number; col_end: number }[]) => {
    try {
      await upsert.mutateAsync({
        planId: plan.id,
        room: { id: room.id, name: room.name, rows: room.rows, cols: room.cols, block_layout: room.block_layout, invigilators: room.invigilators, invigilator_duties: next, notes: room.notes },
      });
    } catch { /* handled */ }
  };

  const toggleBlocked = useCallback(async (r: number, c: number) => {
    const cur = room.block_layout ?? [];
    const exists = cur.some(([rr, cc]) => rr === r && cc === c);
    const next = exists ? cur.filter(([rr, cc]) => !(rr === r && cc === c)) : [...cur, [r, c]];
    try {
      await upsertRoomAsync({
        planId: plan.id,
        room: { id: room.id, name: room.name, rows: room.rows, cols: room.cols, block_layout: next, invigilators: room.invigilators, invigilator_duties: room.invigilator_duties, notes: room.notes },
      });
    } catch { /* handled */ }
  }, [upsertRoomAsync, plan.id, room]);

  // Build a 2D lookup: assignments[(row,col)] = student
  const grid = useMemo(() => {
    const m = new Map<string, typeof room.assignments[number]>();
    for (const a of room.assignments) m.set(`${a.row_idx}:${a.col_idx}`, a);
    return m;
  }, [room.assignments]);

  // PERF: O(1) lookups for the memoised DeskCell — previously every cell
  // re-scanned block_layout (Array.some) and re-ran a duties findIndex on
  // every render.
  const blockedSet = useMemo(
    () => new Set((room.block_layout ?? []).map(([rr, cc]) => `${rr}:${cc}`)),
    [room.block_layout]
  );
  const bandByCol = useMemo(() => {
    const multi = invigilatorsInput.filter(Boolean).length > 1;
    const out: string[] = [];
    for (let c = 0; c < room.cols; c++) {
      const colNum = c + 1; // duties are 1-indexed
      const idx = dutiesInput.findIndex(d => colNum >= d.col_start && colNum <= d.col_end);
      out.push(multi && idx >= 0 ? DUTY_BAND_COLORS[idx % DUTY_BAND_COLORS.length] : "");
    }
    return out;
  }, [invigilatorsInput, dutiesInput, room.cols]);



  return (
    <div className="min-w-0 space-y-4">
      <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
        {/* Room header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
              <Grid3x3 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-snug text-foreground">{room.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {room.rows}×{room.cols} grid · <span className="font-semibold text-foreground">{room.assignments.length}/{room.capacity}</span> seated
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <PrintDeskMapButton room={room} plan={plan} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Delete room" className="h-8 w-8 rounded-full p-0 text-muted-foreground shadow-none hover:text-destructive [&_svg]:size-3.5">
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className={adContent}>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-base">Delete room “{room.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All {room.assignments.length} seat assignments in this room will be removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className={adFooter}>
                  <AlertDialogCancel className={adBtn}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => { await delRoom.mutateAsync({ planId: plan.id, roomId: room.id }); }}
                    className={`${adBtn} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 border-b border-border/60 bg-muted/30 p-1.5">
          {([["map", "Desk Map"], ["staff", "Invigilators & Notes"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={`h-8 whitespace-nowrap rounded-full px-2 text-xs font-semibold transition-all ${
                view === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <CardContent className="space-y-3 p-3.5">
         {view === "map" && (<>
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            <span>Tap a desk to block it (aisle / pillar / broken). Tap again to unblock.</span>
          </p>

          {/* Class legend */}
          <div className="flex flex-wrap items-center gap-1.5">
            {plan.classes.map(c => (
              <span key={c} className={`inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-[10px] font-semibold ${colorFor(c).bg} ${colorFor(c).text}`}>
                Class {c}
              </span>
            ))}
          </div>

          {invigilatorsInput.filter(Boolean).length > 1 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Duty areas:</span>
              {invigilatorsInput.map((name, i) => name.trim() && (
                <span key={i} className="flex items-center gap-1 break-words">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${DUTY_BAND_COLORS[i % DUTY_BAND_COLORS.length].replace("border-t-4 border-t-", "bg-")}`} />
                  {name.trim()} (Cols {dutiesInput[i]?.col_start ?? "—"}–{dutiesInput[i]?.col_end ?? "—"})
                </span>
              ))}
            </div>
          )}

          {/* Desk grid — scrolls inside its own container, page never scrolls sideways */}
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-secondary/20 p-2">
            <div
              className="inline-grid min-w-full gap-1.5"
              style={{ gridTemplateColumns: `repeat(${room.cols}, minmax(78px, 1fr))` }}
            >
              {Array.from({ length: room.rows * room.cols }).map((_, idx) => {
                const r = Math.floor(idx / room.cols);
                const c = idx % room.cols;
                return (
                  <DeskCell
                    key={idx}
                    idx={idx}
                    r={r}
                    c={c}
                    isBlocked={blockedSet.has(`${r}:${c}`)}
                    assign={grid.get(`${r}:${c}`)}
                    bandClass={r === 0 ? bandByCol[c] : ""}
                    onToggle={toggleBlocked}
                  />
                );
              })}
            </div>
          </div>

         </>)}

          {/* Invigilator editor — supports multiple invigilators per room,
              each with a column-duty range when there's more than one. */}
          {view === "staff" && (
          <div className="grid gap-4">
            <div className="min-w-0 space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Invigilator(s)</Label>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {INVIGILATOR_DUTY} With more than one, each is assigned a column range.
              </p>
              {invigilatorsInput.map((val, idx) => (
                <div key={idx} className="space-y-1.5 rounded-xl border border-border/60 bg-secondary/20 p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={val}
                      onChange={e => setInvigilatorsInput(list => list.map((v, i) => i === idx ? e.target.value : v))}
                      onBlur={() => {
                        const current = room.invigilators ?? [];
                        const next = invigilatorsInput.map(s => s.trim()).filter(Boolean);
                        if (JSON.stringify(next) !== JSON.stringify(current)) saveInvigilators(invigilatorsInput);
                      }}
                      placeholder={idx === 0 ? "Assigned invigilator name" : `Invigilator ${idx + 1}`}
                      className={fieldCls}
                    />
                    {invigilatorsInput.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label="Remove invigilator"
                        className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
                        onClick={() => {
                          const next = invigilatorsInput.filter((_, i) => i !== idx);
                          setInvigilatorsInput(next);
                          saveInvigilators(next);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  {invigilatorsInput.filter(Boolean).length > 1 && dutiesInput[idx] && (
                    <div className="flex items-center gap-2" title="Columns this invigilator is responsible for">
                      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Columns</span>
                      <Input
                        type="number" inputMode="numeric" min={1} max={room.cols}
                        value={dutiesInput[idx].col_start === 0 ? "" : dutiesInput[idx].col_start}
                        onChange={e => {
                          const raw = e.target.value;
                          const v = raw === "" ? 0 : Math.max(0, Math.min(room.cols, +raw));
                          setDutiesInput(list => list.map((d, i) => i === idx ? { ...d, col_start: v } : d));
                        }}
                        onBlur={() => {
                          const clamped = Math.max(1, Math.min(room.cols, dutiesInput[idx].col_start || 1));
                          const next = dutiesInput.map((d, i) => i === idx ? { ...d, col_start: clamped } : d);
                          setDutiesInput(next);
                          saveDuties(next);
                        }}
                        className="h-9 w-16 min-w-0 rounded-lg px-1 text-center text-base sm:text-sm"
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="number" inputMode="numeric" min={1} max={room.cols}
                        value={dutiesInput[idx].col_end === 0 ? "" : dutiesInput[idx].col_end}
                        onChange={e => {
                          const raw = e.target.value;
                          const v = raw === "" ? 0 : Math.max(0, Math.min(room.cols, +raw));
                          setDutiesInput(list => list.map((d, i) => i === idx ? { ...d, col_end: v } : d));
                        }}
                        onBlur={() => {
                          const clamped = Math.max(1, Math.min(room.cols, dutiesInput[idx].col_end || 1));
                          const next = dutiesInput.map((d, i) => i === idx ? { ...d, col_end: clamped } : d);
                          setDutiesInput(next);
                          saveDuties(next);
                        }}
                        className="h-9 w-16 min-w-0 rounded-lg px-1 text-center text-base sm:text-sm"
                      />
                    </div>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`${thinBtn} w-full`}
                onClick={() => setInvigilatorsInput(list => [...list, ""])}
              >
                <Plus /> Add Invigilator
              </Button>
            </div>
            <div className="min-w-0 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Room notes</Label>
              <Input
                value={notesInput}
                onChange={e => setNotesInput(e.target.value)}
                onBlur={async (e) => {
                  if (e.target.value !== (room.notes ?? "")) {
                    await upsert.mutateAsync({
                      planId: plan.id,
                      room: { id: room.id, name: room.name, rows: room.rows, cols: room.cols, block_layout: room.block_layout, invigilators: room.invigilators, invigilator_duties: room.invigilator_duties, notes: e.target.value || null },
                    });
                  }
                }}
                placeholder="e.g. Near staff room, no AC"
                className={fieldCls}
              />
            </div>
          </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 6. ACTION BUTTONS
// ────────────────────────────────────────────────────────────────────────────

/** Pull all exam_roll_numbers for the plan's classes+session, run algorithm, persist. */
const GenerateSeatingButton = ({ plan }: { plan: SeatingPlanFull }) => {
  const genMut = useGenerateSeating();
  const qc = useQueryClient();
  // isUpdate = true when the plan ALREADY has seated students (regardless of
  // recurring vs single-day). In that case the button says "Update Seating"
  // and the algorithm applies a random rotation so the new arrangement is
  // visibly different from the previous one.
  const isUpdate = plan.total_seated > 0;

  const handleGenerate = async () => {
    if (plan.rooms.length === 0) { toast.error("Add at least one room first"); return; }
    const totalCapacity = plan.rooms.reduce((s, r) => s + r.capacity, 0);

    // Pull every roll number for this session that belongs to one of the plan's classes.
    const { data: rolls, error } = await supabase
      .from("exam_roll_numbers")
      .select("student_id, student_name, class, class_roll_no, exam_roll_no")
      .eq("session_id", plan.session_id)
      .in("class", plan.classes)
      .order("class", { ascending: true })
      .order("class_roll_no", { ascending: true });
    if (error) { toast.error(error.message); return; }
    if (!rolls || rolls.length === 0) { toast.error("No students found in this session for the selected classes"); return; }

    if (rolls.length > totalCapacity) {
      const ok = window.confirm(
        `${rolls.length} students but only ${totalCapacity} seatable desks. ` +
        `${rolls.length - totalCapacity} students will be unassigned. Generate anyway?`
      );
      if (!ok) return;
    }

    if (isUpdate) {
      const ok = window.confirm(
        "This will re-shuffle seating for the next paper (new anti-cheat arrangement). " +
        "Existing seat QR codes will be replaced. Continue?"
      );
      if (!ok) return;
    }

    try {
      const result = await genMut.mutateAsync({
        planId: plan.id,
        sessionId: plan.session_id,
        students: rolls,
        rooms: plan.rooms,
        // Pass isUpdate so the seating algorithm applies a random rotation
        // — producing a DIFFERENT desk arrangement than last time.
        // For first Auto-Generate (isUpdate=false), the canonical roll-no
        // order is used.
        isUpdate,
      });
      // Show conflict detail if any.
      if (result.conflicts > 0) {
        toast(`⚠️ ${result.conflicts} seat(s) have same-class adjacency — review the grid`, { duration: 6000 });
      }
      qc.invalidateQueries({ queryKey: ["seating-plan", plan.id] });
    } catch { /* handled */ }
  };

  // Re-generation (Update Seating) is always allowed — the admin may need to
  // update seating if something changed (e.g. a student was added/removed,
  // or the arrangement needs to be shuffled for anti-cheat).
  const disabled = genMut.isPending;
  // "Update Seating" is intentionally gone — the button only shows while the
  // plan has no seating yet (first generation).
  if (isUpdate) return null;

  return (
    <Button size="sm" onClick={handleGenerate} disabled={disabled} className={`${thinBtn} w-full sm:w-auto`}>
      {genMut.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
      Generate Seating
    </Button>
  );
};

const DeletePlanButton = ({ planId, sessionId, onDeleted }: { planId: string; sessionId: string; onDeleted: () => void }) => {
  const delMut = useDeleteSeatingPlan();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className={`${thinBtn} w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive`}>
          <Trash2 /> Delete Plan
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className={adContent}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">Delete this seating plan?</AlertDialogTitle>
          <AlertDialogDescription>
            All rooms and seat assignments will be permanently deleted. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={adFooter}>
          <AlertDialogCancel className={adBtn}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => { await delMut.mutateAsync({ planId, sessionId }); onDeleted(); }}
            className={`${adBtn} bg-destructive text-destructive-foreground hover:bg-destructive/90`}
          >
            Delete Plan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 7. PDF / CSV EXPORTS
// ────────────────────────────────────────────────────────────────────────────

/** Printable desk-layout map for ONE room — for pasting on the hall wall. */
const PrintDeskMapButton = ({ room, plan }: { room: RoomWithAssignments; plan: SeatingPlanFull }) => {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      // PERF: use the assignments already in the room object (fetched once by
      // useSeatingPlan) instead of a redundant extra round trip + select("*").
      const assigns = room.assignments;
      const aMap = new Map<string, typeof assigns[number]>();
      for (const a of assigns ?? []) aMap.set(`${a.row_idx}:${a.col_idx}`, a);

      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: room.cols > 6 ? "landscape" : "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 10;
      // Header — centered
      doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 30, 30);
      doc.text(plan.title, pageW / 2, 14, { align: "center" });
      doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
      doc.text(`${room.name}  ·  ${room.rows}×${room.cols} grid  ·  ${room.assignments.length} seated`, pageW / 2, 20, { align: "center" });
      let headerBottom = 22.5;
      const invigilatorList: string[] = (room as any).invigilators?.length ? (room as any).invigilators : (room.invigilator ? [room.invigilator] : []);
      if (invigilatorList.length) {
        const duties = resolveColDuties(room as any);
        const label = invigilatorList.length > 1 ? "Invigilators" : "Invigilator";
        const text = invigilatorList.length > 1
          ? invigilatorList.map((name, i) => duties[i] ? `${name} (Cols ${duties[i].col_start}–${duties[i].col_end})` : name).join(", ")
          : invigilatorList[0];
        doc.setFontSize(9); doc.setTextColor(110);
        doc.text(`${label}: ${text}`, pageW / 2, 25.5, { align: "center" });
        headerBottom = 28;
      }
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3);
      doc.line(margin, headerBottom, pageW - margin, headerBottom);

      // Grid
      const gridTop = headerBottom + 6;
      const gridW = pageW - margin * 2;
      const cellW = gridW / room.cols;
      const cellH = Math.min(22, (doc.internal.pageSize.getHeight() - gridTop - 16) / room.rows);

      for (let r = 0; r < room.rows; r++) {
        for (let c = 0; c < room.cols; c++) {
          const x = margin + c * cellW;
          const y = gridTop + r * cellH;
          const isBlocked = (room.block_layout ?? []).some(([rr, cc]) => rr === r && cc === c);
          const a = aMap.get(`${r}:${c}`);

          if (isBlocked) {
            doc.setFillColor(255, 255, 255);
            doc.rect(x, y, cellW - 1, cellH - 1, "F");
            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2);
            doc.rect(x, y, cellW - 1, cellH - 1, "S");
            doc.setFontSize(7); doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold");
            doc.text("BLOCKED", x + cellW / 2, y + cellH / 2, { align: "center" });
          } else if (a) {
            doc.setFillColor(255, 255, 255);
            doc.rect(x, y, cellW - 1, cellH - 1, "F");
            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
            doc.rect(x, y, cellW - 1, cellH - 1, "S");
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
            doc.text(`R${r + 1}·S${c + 1}`, x + cellW / 2, y + 4, { align: "center" });
            doc.setFont("helvetica", "normal"); doc.setFontSize(7);
            const nm = a.student_name.length > 18 ? a.student_name.slice(0, 17) + "…" : a.student_name;
            doc.text(nm, x + cellW / 2, y + 9, { align: "center" });
            doc.setFont("helvetica", "bold"); doc.setFontSize(9);
            doc.text(a.exam_roll_no, x + cellW / 2, y + 14.5, { align: "center" });
            doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60);
            doc.text(`Class ${a.class}`, x + cellW / 2, y + 18.5, { align: "center" });
          }
          // Unassigned (empty) cells are intentionally skipped —
          // Print Desk Map should only show filled cells (plus blocked cells),
          // so empty seats disappear from the downloaded PDF.
        }
      }

      // Footer
      doc.setFontSize(6); doc.setTextColor(140); doc.setFont("helvetica", "normal");
      doc.text("Generated by GHS Babi Khel · Exam Seating Plan Engine", pageW / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" });

      doc.save(`DeskMap-${room.name.replace(/\s+/g, "_")}.pdf`);
      toast.success("Desk-layout map PDF downloaded");
    } catch (e) {
      toast.error("Failed to generate desk map: " + (e?.message ?? ""));
    }
    setBusy(false);
  };
  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={busy} className={`${thinBtn} border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-950/30`}>
      {busy ? <Loader2 className="animate-spin" /> : <Printer />}
      Print Desk Map
    </Button>
  );
};

/** Per-desk sticker sheet — simple rectangle stickers, 3 per row, as many
 *  rows as fit per A4 page. Each sticker just shows the student name, class
 *  and exam roll number, with a thin black border (no QR code). */
const QrStickerSheetButton = ({ plan }: { plan: SeatingPlanFull }) => {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      // Flatten assignments across all rooms.
      const all = plan.rooms.flatMap(r => r.assignments.map(a => ({ ...a, room_name: r.name })));
      if (all.length === 0) { toast.error("No assignments yet — generate seating first"); return; }

      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 8;
      const cols = 3;                       // exactly 3 stickers per row
      const stickerH = 18;                  // thin rectangle, rows flow as many as fit
      const gap = 4;                        // small gap between stickers
      const stickerW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
      const rowsPerPage = Math.max(1, Math.floor((pageH - margin * 2 + gap) / (stickerH + gap)));

      // Style: thin black border, simple black text, two centered lines.
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2);  // thin black border
      doc.setTextColor(0, 0, 0);

      const drawSticker = (a: typeof all[number], x: number, y: number) => {
        // Thin black rectangle border
        doc.rect(x, y, stickerW, stickerH, "S");

        // Centered text block — name on top, class+roll on the line below
        const cx = x + stickerW / 2;
        // Name (bold, slightly larger)
        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        let nm = a.student_name ?? "";
        if (doc.getTextWidth(nm) > stickerW - 4) {
          while (nm.length > 1 && doc.getTextWidth(nm + "…") > stickerW - 4) nm = nm.slice(0, -1);
          nm = nm + "…";
        }
        doc.text(nm, cx, y + 7.5, { align: "center" });

        // Class · Exam Roll No (normal weight)
        doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.text(`Class ${a.class}    ${a.exam_roll_no}`, cx, y + 13.5, { align: "center" });
      };

      let i = 0;
      for (const a of all) {
        if (i > 0 && i % (cols * rowsPerPage) === 0) doc.addPage();
        const idxOnPage = i % (cols * rowsPerPage);
        const r = Math.floor(idxOnPage / cols);
        const c = idxOnPage % cols;
        const x = margin + c * (stickerW + gap);
        const y = margin + r * (stickerH + gap);
        drawSticker(a, x, y);
        i++;
      }

      doc.save(`Desk-Stickers-${plan.title.replace(/\s+/g, "_")}.pdf`);
      toast.success(`Desk sticker sheet (${all.length} stickers) downloaded`);
    } catch (e) {
      toast.error("Failed: " + (e?.message ?? ""));
    }
    setBusy(false);
  };
  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={busy} className={`${thinBtn} w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-950/30`}>
      {busy ? <Loader2 className="animate-spin" /> : <Tag />}
      Desk Sticker
    </Button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DUTIES PDF — beautiful professional single-page (or multi-page if needed)
// download of all exam staff duties: Superintendent, Deputy Superintendent,
// and all Invigilators (per room, with column-duty ranges). Includes a
// Principal signature line at the bottom.
//
// Design goals (per the user's request):
//   • "beautiful advance stylish professional one single page pdf"
//   • Shows ALL teachers' duties in one place
//   • Has an empty space at the end for the Principal's signature
//   • Mobile-friendly: the button is the same size as the other export
//     buttons; the PDF itself is A4 portrait which prints/reads well on
//     any device.
// ─────────────────────────────────────────────────────────────────────────────
const DutiesPdfButton = ({ plan }: { plan: SeatingPlanFull }) => {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();   // 210
      const H = doc.internal.pageSize.getHeight();  // 297
      const M = 14;
      const CW = W - M * 2;
      const NAVY: [number, number, number] = [15, 60, 52];   // deep green, matches site
      const GOLD: [number, number, number] = [180, 140, 40];
      const INK: [number, number, number] = [30, 30, 30];
      const MUTED: [number, number, number] = [105, 105, 105];
      const LINE: [number, number, number] = [210, 214, 210];
      const SIG_H = 38;            // space permanently reserved for the signature block
      const BOTTOM = H - 14;       // footer zone starts here
      let y = 0;

      const setC = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
      const wrap = (t: string, w: number) => doc.splitTextToSize(t, w) as string[];

      const drawHeader = (first: boolean) => {
        if (first) {
          doc.setFillColor(...NAVY); doc.rect(0, 0, W, 34, "F");
          doc.setFillColor(...GOLD); doc.rect(0, 34, W, 1.4, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold"); doc.setFontSize(17);
          doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", W / 2, 13, { align: "center" });
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
          doc.text("District Mohmand, KPK", W / 2, 19.5, { align: "center" });
          doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
          doc.text("EXAMINATION DUTY ASSIGNMENT SHEET", W / 2, 28.5, { align: "center" });
          y = 44;
        } else {
          doc.setFillColor(...NAVY); doc.rect(0, 0, W, 10, "F");
          doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
          doc.text("GHS BABI KHEL  ·  Examination Duty Assignment Sheet", M, 6.5);
          y = 18;
        }
      };
      const ensure = (h: number) => {
        // Never let content run into the signature zone on the last page.
        if (y + h > BOTTOM - SIG_H) { doc.addPage(); drawHeader(false); }
      };
      const sectionTitle = (t: string) => {
        ensure(14);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); setC(NAVY);
        doc.text(t, M, y);
        doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, y + 1.8, M + 22, y + 1.8);
        doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(M + 22, y + 1.8, W - M, y + 1.8);
        y += 7;
      };

      drawHeader(true);

      // ── Plan summary ──
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); setC(INK);
      const titleLines = wrap(plan.title, CW);
      doc.text(titleLines, M, y); y += titleLines.length * 5.6;

      const from = (plan as any).exam_date_from as string | null | undefined;
      const to = (plan as any).exam_date_to as string | null | undefined;
      const dates = from && to ? `${fmtD(from, "dd MMM")} – ${fmtD(to, "dd MMM yyyy")}` : plan.exam_date ? fmtD(plan.exam_date) : "—";
      const summary: [string, string][] = [
        ["Classes", plan.classes.map(c => `Class ${c}`).join(", ")],
        ["Exam Dates", dates],
        ["Rooms", String(plan.rooms.length)],
        ["Students Seated", `${plan.total_seated} of ${plan.total_students}`],
      ];
      y += 1;
      doc.setFillColor(246, 248, 246); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
      const colW = CW / 2;
      const rowsN = Math.ceil(summary.length / 2);
      doc.roundedRect(M, y, CW, rowsN * 8 + 4, 1.5, 1.5, "FD");
      summary.forEach(([k, v], i) => {
        const cx = M + 4 + (i % 2) * colW;
        const cy = y + 7 + Math.floor(i / 2) * 8;
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); setC(MUTED); doc.text(k.toUpperCase(), cx, cy - 2.2);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); setC(INK);
        doc.text(wrap(v, colW - 8)[0] ?? "", cx, cy + 1.6);
      });
      y += rowsN * 8 + 10;

      // ── Exam staff table ──
      sectionTitle("EXAM STAFF");
      const staff = [
        { role: "Superintendent", name: (plan as any).superintendent || "—", duty: (plan as any).superintendent_duty || SUPERINTENDENT_DUTY },
        { role: "Deputy Superintendent", name: (plan as any).deputy_superintendent || "—", duty: (plan as any).deputy_superintendent_duty || DEPUTY_SUPERINTENDENT_DUTY },
      ];
      staff.forEach(st => {
        const dl = wrap(st.duty, CW - 8);
        const h = 13 + dl.length * 4.2;
        ensure(h + 3);
        doc.setFillColor(255, 255, 255); doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
        doc.roundedRect(M, y, CW, h, 1.5, 1.5, "FD");
        doc.setFillColor(...NAVY); doc.rect(M, y, 2.2, h, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); setC(GOLD);
        doc.text(st.role.toUpperCase(), M + 6, y + 5);
        doc.setFontSize(11); setC(INK);
        doc.text(st.name, M + 6, y + 10.5);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); setC(MUTED);
        doc.text(dl, M + 6, y + 15.5);
        y += h + 3;
      });

      // ── Invigilators per room ──
      y += 2;
      sectionTitle("INVIGILATORS");
      const rowH = 7;
      const cName = M + 4, cDuty = M + CW * 0.62;
      let anyRoom = false;
      plan.rooms.forEach((room, idx) => {
        const list = room.invigilators?.length ? room.invigilators : (room.invigilator ? [room.invigilator] : []);
        if (!list.length) return;
        anyRoom = true;
        const duties = resolveColDuties(room);
        const noteLines = room.notes ? wrap(`Note: ${room.notes}`, CW - 8) : [];
        ensure(9 + rowH * list.length + noteLines.length * 4 + 4);
        // room bar
        doc.setFillColor(233, 240, 236); doc.rect(M, y, CW, 7, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); setC(NAVY);
        doc.text(`Room ${idx + 1} · ${room.name}`, cName, y + 4.8);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); setC(MUTED);
        doc.text(`${room.rows}×${room.cols} grid · ${room.assignments.length}/${room.capacity} seated`, W - M - 3, y + 4.8, { align: "right" });
        y += 7;
        list.forEach((name, i) => {
          const d = duties[i];
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); setC(INK);
          doc.text(`${i + 1}.  ${name || `Invigilator ${i + 1}`}`, cName, y + 4.8);
          setC(MUTED); doc.setFontSize(9);
          doc.text(list.length > 1 && d ? `Columns ${d.col_start} – ${d.col_end}` : "Entire room", cDuty, y + 4.8);
          doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y + rowH, W - M, y + rowH);
          y += rowH;
        });
        if (noteLines.length) {
          doc.setFont("helvetica", "italic"); doc.setFontSize(8); setC(MUTED);
          doc.text(noteLines, cName, y + 4); y += noteLines.length * 4 + 1;
        }
        y += 4;
      });
      if (!anyRoom) {
        doc.setFont("helvetica", "italic"); doc.setFontSize(9); setC(MUTED);
        doc.text("No invigilators assigned yet.", M, y + 3); y += 9;
      }

      // ── General duty note ──
      const noteL = wrap(INVIGILATOR_DUTY, CW - 8);
      const noteH = 9 + noteL.length * 4;
      ensure(noteH + 2);
      doc.setFillColor(253, 248, 235); doc.setDrawColor(230, 200, 120); doc.setLineWidth(0.3);
      doc.roundedRect(M, y, CW, noteH, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); setC([150, 100, 10]);
      doc.text("DUTY OF ALL INVIGILATORS", M + 4, y + 5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); setC([90, 60, 10]);
      doc.text(noteL, M + 4, y + 10);
      y += noteH + 4;

      // ── Signature block: always pinned to the bottom of the LAST page,
      //    with the printed title sitting BELOW the signature line. ──
      const sigLineY = BOTTOM - 16;
      doc.setDrawColor(...INK); doc.setLineWidth(0.4);
      doc.line(M, sigLineY, M + 55, sigLineY);
      doc.line(W - M - 65, sigLineY, W - M, sigLineY);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); setC(INK);
      doc.text("Date", M, sigLineY + 5);
      doc.text("Principal", W - M - 65, sigLineY + 5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); setC(MUTED);
      doc.text("Government High School Babi Khel", W - M - 65, sigLineY + 9.5);

      // ── Footer + page numbers on every page ──
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...LINE); doc.setLineWidth(0.25); doc.line(M, H - 9, W - M, H - 9);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); setC([140, 140, 140]);
        doc.text(`Generated ${format(new Date(), "dd MMM yyyy")} · GHS Babi Khel Exam Seating System`, M, H - 5);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 5, { align: "right" });
      }

      doc.save(`Exam-Duties-${plan.title.replace(/\s+/g, "_")}.pdf`);
      toast.success("Duties PDF downloaded");
    } catch (e: any) {
      toast.error("Failed: " + (e?.message ?? ""));
    }
    setBusy(false);
  };

  return (
    <Button size="sm" variant="outline" onClick={handle} disabled={busy} className={`${thinBtn} w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-950/30`}>
      {busy ? <Loader2 className="animate-spin" /> : <FileText />}
      Duties PDF
    </Button>
  );
};

export default AdminExamSeating;
