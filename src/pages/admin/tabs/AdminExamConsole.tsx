/**
 * AdminExamConsole.tsx
 * Live Exam Hall Operations Console — a wall-screen dashboard for exam day.
 *
 * Features:
 *  • Plan picker — lists all generated/published plans.
 *  • Countdown to paper-start and paper-end (updates every second).
 *  • Live present / absent / late / leave tally as invigilators scan QR 
 *    codes. Uses Supabase realtime on exam_attendance for instant updates.
 *  • Auto-red-flag when absent count crosses a configurable threshold
 *    (default 20%, adjustable 5–50% via a slider).
 *  • Per-room breakdown with per-room progress bars.
 *  • One-click absentee PDF for re-exam approvals — lists every absent
 *    student grouped by room, with seat label, exam roll, class, invigilator.
 *  • Paper-times editor — set/update paper_start_at and paper_end_at from
 *    the console itself (in case they weren't set at plan-creation time).
 *  • Realtime connection indicator (green pulse = connected).
 *  • MCQ Timer — admin starts a N-minute countdown (e.g. 15 min for an MCQ
 *    paper). The remaining time is shown on the console as a large
 *    minute:second display. The same timer is mirrored LIVE inside the 3D
 *    Hall screen (Hall3DView + Hall_3D.html). When it reaches zero, the 3D
 *    Hall screen fires a red siren overlay for 15 seconds. The timer state
 *    is persisted in localStorage so it survives refreshes and is shared
 *    across tabs (Console tab + 3D Hall tab, if both are open).
 *
 * Navigation: Admin → STUDENTS → 🖥️ Live Exam Console
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Monitor, MonitorPlay, ArrowLeft, Loader2, Clock, Users, CheckCircle2, XCircle, Palmtree,
  Timer, AlertTriangle, Download, RefreshCw, Building2, CalendarDays, BookOpen,
  Play, Square, RotateCcw, ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  useAllSeatingPlans, useSeatingPlan, useLiveAttendance,
  listPlanPaperTimes, resolveClassPaperTime,
  type SeatingPlanFull,
} from "@/hooks/useExamSeating";
import { useAllExamSchedule } from "@/hooks/useNewFeatures";
import { useExamSessions } from "@/hooks/useExamAttendance";
import { useQueryClient } from "@tanstack/react-query";

// ── Live Date Sheet helpers (bug fix — see comments near their call sites) ──
const todayLocalDateStr = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Same loose ordinal-aware matching AdminExamSeating.tsx uses, so a session's
// exam_term ("1st Semester 2026") correctly matches Date Sheet exam_type
// values like "Annual-I" for classes 9/10.
const examTermMatchesConsole = (examType: string, term: string): boolean => {
  const termOrdinal = (s: string): number | null => {
    if (/1st|first|annual-i\b/i.test(s)) return 1;
    if (/2nd|second|annual-ii\b/i.test(s)) return 2;
    return null;
  };
  const a = (examType || "").trim().toLowerCase();
  const b = (term || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b || b.includes(a) || a.includes(b)) return true;
  const oa = termOrdinal(a);
  const ob = termOrdinal(b);
  return oa !== null && oa === ob;
};

// ── Color helper ──
const colorFor = (cls: string) => {
  const m: Record<string, { bg: string; text: string }> = {
    "6":  { bg: "bg-blue-100 dark:bg-blue-900/40",       text: "text-blue-700 dark:text-blue-300" },
    "7":  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
    "8":  { bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-300" },
    "9":  { bg: "bg-rose-100 dark:bg-rose-900/40",       text: "text-rose-700 dark:text-rose-300" },
    "10": { bg: "bg-violet-100 dark:bg-violet-900/40",   text: "text-violet-700 dark:text-violet-300" },
  };
  return m[cls] ?? { bg: "bg-slate-100 dark:bg-slate-900/40", text: "text-slate-700 dark:text-slate-300" };
};

// ────────────────────────────────────────────────────────────────────────────
// MCQ Timer — shared state via localStorage
// ────────────────────────────────────────────────────────────────────────────
// The admin starts an N-minute MCQ timer from this console. The same timer
// is mirrored LIVE inside the 3D Hall screen (Hall3DView + Hall_3D.html).
// When it reaches zero, the 3D Hall screen fires a red siren overlay for
// 15 seconds (great for signalling the end of an MCQ paper).
//
// State is stored in localStorage under MCQ_TIMER_KEY so it survives
// refreshes and is shared across tabs. The browser fires a `storage` event
// in OTHER tabs whenever the key changes, so both Console and 3D Hall
// (which may be open in separate tabs) stay in sync without any server
// round-trip. The 1-second `now` tick re-derives the remaining time on
// every render, so the countdown is always smooth even in the tab that
// started the timer (no storage event fires in the same tab that wrote).
const MCQ_TIMER_KEY = "ghs-exam-mcq-timer";

interface McqTimerState {
  // Wall-clock epoch ms when the timer is supposed to hit zero.
  endTime: number;
  // Total duration the admin originally picked (ms) — used to show
  // "x / y min" progress and to clamp remaining to 0.
  totalMs: number;
  // "running" | "stopped" | "finished"
  //   running  → counting down from endTime
  //   stopped  → admin hit Stop before it finished (no siren fires)
  //   finished → reached zero naturally (siren fires in 3D Hall)
  status: "running" | "stopped" | "finished";
  // Wall-clock epoch ms when the timer finished (for siren window calc).
  finishedAt?: number;
}

function readMcqTimer(): McqTimerState | null {
  try {
    const raw = localStorage.getItem(MCQ_TIMER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.endTime !== "number") return null;
    if (typeof parsed.totalMs !== "number") return null;
    if (typeof parsed.status !== "string") return null;
    return parsed as McqTimerState;
  } catch {
    return null;
  }
}

function writeMcqTimer(state: McqTimerState | null): void {
  try {
    if (state === null) {
      localStorage.removeItem(MCQ_TIMER_KEY);
    } else {
      localStorage.setItem(MCQ_TIMER_KEY, JSON.stringify(state));
    }
  } catch { /* ignore quota / private-mode errors */ }
}

/**
 * Returns the live MCQ timer state, re-evaluating every second so the
 * countdown is smooth. Also listens for `storage` events so changes from
 * other tabs (e.g. the admin clicked Stop in the 3D Hall tab) are
 * reflected immediately.
 *
 * When the timer hits zero while running, it auto-flips to "finished"
 * status and records finishedAt — this is what triggers the siren in the
 * 3D Hall. The auto-flip is written to localStorage so the other tab
 * picks it up too.
 */
function useMcqTimer(now: number) {
  const [state, setState] = useState<McqTimerState | null>(() => readMcqTimer());

  // Re-read on every tick (1s) so the derived remaining time updates
  // smoothly. We don't setState unless something actually changed, to
  // avoid re-rendering the whole console twice per second.
  useEffect(() => {
    const fresh = readMcqTimer();
    if (!fresh) { setState(null); return; }
    // Auto-flip running → finished when endTime is reached.
    if (fresh.status === "running" && now >= fresh.endTime) {
      const finished: McqTimerState = { ...fresh, status: "finished", finishedAt: fresh.endTime };
      writeMcqTimer(finished);
      setState(finished);
      return;
    }
    // Only update if status/endTime/totalMs changed (shallow compare).
    setState(prev => {
      if (!prev) return fresh;
      if (prev.status !== fresh.status || prev.endTime !== fresh.endTime || prev.totalMs !== fresh.totalMs) return fresh;
      return prev;
    });
  }, [now]);

  // ── AUTO-RESET after the siren finishes (Bug 3 fix) ───────────────────────
  // When the timer becomes "finished", arm a 16-second timeout (15s siren +
  // 1s buffer) to DELETE the timer from localStorage. This ensures:
  //   • Reopening the 3D Hall does NOT re-trigger the siren (no "finished"
  //     timer left in localStorage to read).
  //   • The Console's timer card disappears after the siren finishes.
  //   • The admin must start a NEW timer to get another siren.
  //
  // This runs in BOTH the Console tab AND the 3D Hall tab (whichever is
  // open). If both are open, both arm the same timeout — the first one to
  // fire deletes the timer, the second one's removeItem is a no-op. Safe.
  useEffect(() => {
    if (!state || state.status !== "finished") return;
    const finishedAt = state.finishedAt ?? state.endTime;
    const msSinceFinish = Date.now() - finishedAt;
    const SIREN_DURATION_MS = 15 * 1000;
    const RESET_DELAY = SIREN_DURATION_MS + 1000; // 16s total
    // If we're already past the reset delay (e.g. tab was backgrounded),
    // reset immediately.
    if (msSinceFinish >= RESET_DELAY) {
      writeMcqTimer(null);
      setState(null);
      return;
    }
    const remaining = RESET_DELAY - msSinceFinish;
    const t = setTimeout(() => {
      // Double-check the timer hasn't been restarted by the user in the
      // meantime. Only delete if it's still the SAME finished timer.
      const cur = readMcqTimer();
      if (cur && cur.status === "finished" && (cur.finishedAt ?? cur.endTime) === finishedAt) {
        writeMcqTimer(null);
        setState(null);
      }
    }, remaining);
    return () => clearTimeout(t);
  }, [state]);

  // Cross-tab sync: when another tab changes the timer, the browser fires
  // a `storage` event HERE. Re-read immediately so this tab reflects the
  // change without waiting for the next 1s tick.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MCQ_TIMER_KEY) setState(readMcqTimer());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Derived remaining milliseconds (clamped to ≥ 0).
  const remainingMs = useMemo(() => {
    if (!state) return 0;
    if (state.status === "stopped") return Math.max(0, state.endTime - Date.now());
    if (state.status === "finished") return 0;
    // running
    return Math.max(0, state.endTime - Date.now());
  }, [state, now]);

  const start = useCallback((minutes: number) => {
    const totalMs = Math.max(1, Math.floor(minutes)) * 60 * 1000;
    const next: McqTimerState = {
      endTime: Date.now() + totalMs,
      totalMs,
      status: "running",
    };
    writeMcqTimer(next);
    setState(next);
  }, []);

  const stop = useCallback(() => {
    const cur = readMcqTimer();
    if (!cur) return;
    // Stop keeps the remaining time visible — we just freeze status.
    // To preserve "remaining time" on reload, store endTime as
    // (Date.now() + remainingMs) so when status is "stopped" the derived
    // remaining = endTime - Date.now() = remainingMs (assuming the user
    // reopens soon). This is approximate (drifts over time if left
    // stopped), but a stopped timer is meant to be reset, not left.
    const remaining = Math.max(0, cur.endTime - Date.now());
    const stopped: McqTimerState = {
      ...cur,
      endTime: Date.now() + remaining,
      status: "stopped",
    };
    writeMcqTimer(stopped);
    setState(stopped);
  }, []);

  const reset = useCallback(() => {
    writeMcqTimer(null);
    setState(null);
  }, []);

  return { state, remainingMs, start, stop, reset };
}

/** Format ms as M:SS or MM:SS — used by both the console display and the
 *  value sent to the 3D Hall. */
function formatMcqTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Types ──
interface LiveAttRow {
  id: string;
  student_id: string;
  student_name: string;
  class: string;
  class_roll_no: string;
  exam_roll_no: string;
  subject: string;
  exam_date: string;
  status: "present" | "absent" | "leave";
  scanned_at: string | null;
  seat_id: string | null;
  room_id: string | null;
  seat_label: string | null;
}

// ── Main component ──
const AdminExamConsole = () => {
  const [searchParams] = useSearchParams();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    searchParams.get("plan") ?? null
  );

  if (selectedPlanId) {
    return <ConsoleView planId={selectedPlanId} onBack={() => setSelectedPlanId(null)} />;
  }
  return <PlansPicker onOpenPlan={setSelectedPlanId} />;
};

// ────────────────────────────────────────────────────────────────────────────
// 1. PLANS PICKER
// ────────────────────────────────────────────────────────────────────────────
const PlansPicker = ({ onOpenPlan }: { onOpenPlan: (id: string) => void }) => {
  const { data: plans = [], isLoading } = useAllSeatingPlans();

  return (
    <div className="min-w-0 space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <MonitorPlay className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Live Exam Console</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Live attendance dashboard for exam day</p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" /> Select a plan to monitor
        </p>
        {isLoading ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-9 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60"><Monitor className="h-6 w-6" /></span>
            <p className="text-sm font-semibold text-foreground">No plans available</p>
            <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">Generate and publish a seating plan first to monitor it live.</p>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map(p => (
              <button
                key={p.id}
                onClick={() => onOpenPlan(p.id)}
                className="group min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{p.title}</h3>
                  <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${p.status === "published" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                    {p.status === "published" ? "Published" : "Generated"}
                  </span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {p.paper_subject && <p className="flex items-start gap-1.5"><BookOpen className="mt-0.5 h-3 w-3 shrink-0" /> <span className="break-words">{p.paper_subject}</span></p>}
                  {p.exam_date && <p className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3 shrink-0" /> {new Date(p.exam_date).toLocaleDateString()}</p>}
                  <p className="flex items-center gap-1.5"><Users className="h-3 w-3 shrink-0" /> {p.total_seated} students seated</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {listPlanPaperTimes(p).map((t, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[10px] leading-tight">
                        <span className="font-semibold">{t.classes.map(c => `Cls ${c}`).join(", ")}</span>
                        {t.subject && <span>· {t.subject}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// 2. CONSOLE VIEW — Date-Sheet-driven, per-paper, per-class live console
// ────────────────────────────────────────────────────────────────────────────
// How this view works (rev. 6 — full rewrite of the timing + attendance flow):
//
//  • TIMING comes ONLY from the live Exam Date Sheet (re-read every minute and
//    on every edit). Every class in the plan gets its own paper for TODAY
//    (subject + start + end). Classes sharing the same subject/time are merged
//    into one card. Each card has its OWN countdown:
//        before start → "Starts in 1h 2m 1s"
//        in progress  → "Ends in 2h 2m 4s"   (a 9–11 paper and a 9–12 paper
//                                              each show their own time left)
//        finished     → "Finished 5m ago"
//  • When every paper of today is finished (or today has no paper), the console
//    switches to the NEXT exam day found in the Date Sheet and lists that day's
//    classes + papers, each with a "Starts in …" countdown.
//  • ATTENDANCE is scoped to TODAY's local date + each class's own paper
//    subject. Only classes that actually have a paper today are counted, so
//    on a free day / right after midnight every counter is 0 automatically
//    (nothing is cached or carried over from yesterday).
//  • End times are exact (HH:MM:00) — the old code ended papers at HH:MM:59.999
//    which made every countdown run up to a minute long.

const pad2 = (n: number) => String(n).padStart(2, "0");
const dateStrOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** "09:00" / "09:00:00" → minutes since midnight (null when unparsable). */
const parseHM = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Epoch ms of local `dateStr` at `hm` (seconds forced to :00 — exact). */
const msOnDate = (dateStr: string, hm: string): number | null => {
  const mins = parseHM(hm);
  if (mins === null) return null;
  const [y, mo, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, mo - 1, d, Math.floor(mins / 60), mins % 60, 0, 0).getTime();
};

const fmt12 = (hm: string | null | undefined): string => {
  const mins = parseHM(hm);
  if (mins === null) return "—";
  const h = Math.floor(mins / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(mins % 60)} ${h >= 12 ? "PM" : "AM"}`;
};

const fmtDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

const sortClasses = (a: string, b: string) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b);
const classLabel = (classes: string[]) => (classes.length === 1 ? `Class ${classes[0]}` : `Classes ${classes.join(", ")}`);

const subjectsMatch = (a?: string | null, b?: string | null): boolean => {
  const x = (a || "").trim().toLowerCase();
  const y = (b || "").trim().toLowerCase();
  if (!x || !y) return true;
  return x === y || x.includes(y) || y.includes(x);
};

interface PaperGroup {
  key: string;
  classes: string[];
  subject: string | null;
  dateStr: string;
  startHM: string;
  endHM: string | null;
  startMs: number;
  endMs: number | null;
}
type Phase = "upcoming" | "live" | "done";
const phaseOf = (g: PaperGroup, now: number): Phase =>
  now < g.startMs ? "upcoming" : g.endMs !== null && now >= g.endMs ? "done" : "live";

type DateSheetRow = {
  class: string; exam_type: string; year: number; subject: string;
  exam_date: string; start_time: string | null; end_time: string | null;
};

/** One class's papers on one date, straight from the Date Sheet. Falls back
 *  to the plan's own snapshot ONLY when the Date Sheet has nothing at all for
 *  that class/term (legacy plans). */
function classPapersOnDate(
  plan: SeatingPlanFull, cls: string,
  session: { exam_year: number; exam_term: string } | null,
  entries: DateSheetRow[], dateStr: string
): { subject: string | null; startHM: string; endHM: string | null }[] {
  const mine = session
    ? entries.filter(e => e.class === cls && e.year === session.exam_year && examTermMatchesConsole(e.exam_type, session.exam_term))
    : [];
  if (mine.length > 0) {
    return mine
      .filter(e => String(e.exam_date).slice(0, 10) === dateStr && parseHM(e.start_time) !== null)
      .map(e => ({ subject: e.subject || null, startHM: e.start_time as string, endHM: parseHM(e.end_time) !== null ? (e.end_time as string) : null }));
  }
  const r = resolveClassPaperTime(plan, cls);
  if (r.examDate && r.examDate.slice(0, 10) === dateStr && r.startTime) {
    return [{ subject: r.subject, startHM: r.startTime, endHM: r.endTime }];
  }
  return [];
}

function buildGroups(
  plan: SeatingPlanFull, session: { exam_year: number; exam_term: string } | null,
  entries: DateSheetRow[], dateStr: string
): PaperGroup[] {
  const map = new Map<string, PaperGroup>();
  for (const cls of plan.classes || []) {
    for (const p of classPapersOnDate(plan, cls, session, entries, dateStr)) {
      const startMs = msOnDate(dateStr, p.startHM);
      if (startMs === null) continue;
      const endMs = p.endHM ? msOnDate(dateStr, p.endHM) : null;
      const key = `${(p.subject || "").trim().toLowerCase()}|${p.startHM.slice(0, 5)}|${p.endHM ? p.endHM.slice(0, 5) : ""}`;
      const ex = map.get(key);
      if (ex) { if (!ex.classes.includes(cls)) ex.classes.push(cls); }
      else map.set(key, { key, classes: [cls], subject: p.subject, dateStr, startHM: p.startHM, endHM: p.endHM, startMs, endMs });
    }
  }
  const out = Array.from(map.values());
  out.forEach(g => g.classes.sort(sortClasses));
  out.sort((a, b) => a.startMs - b.startMs || (a.endMs ?? 9e15) - (b.endMs ?? 9e15) || sortClasses(a.classes[0], b.classes[0]));
  return out;
}

/** Nearest date strictly after `today` on which any class of the plan has a paper. */
function findNextPaperDate(
  plan: SeatingPlanFull, session: { exam_year: number; exam_term: string } | null,
  entries: DateSheetRow[], today: string
): string | null {
  let best: string | null = null;
  for (const cls of plan.classes || []) {
    const mine = session
      ? entries.filter(e => e.class === cls && e.year === session.exam_year && examTermMatchesConsole(e.exam_type, session.exam_term))
      : [];
    let dates: string[];
    if (mine.length > 0) {
      dates = mine.filter(e => parseHM(e.start_time) !== null).map(e => String(e.exam_date).slice(0, 10));
    } else {
      const r = resolveClassPaperTime(plan, cls);
      dates = r.examDate && r.startTime ? [r.examDate.slice(0, 10)] : [];
    }
    for (const d of dates) if (d > today && (!best || d < best)) best = d;
  }
  return best;
}

type AssignRow = SeatingPlanFull["rooms"][number]["assignments"][number];
interface StudentStat {
  assign: AssignRow;
  roomName: string;
  invigilator: string | null;
  status: "present" | "absent" | "leave" | "not-marked";
}
interface ClassStat {
  key: string; cls: string; group: PaperGroup;
  present: number; absent: number; leave: number; notMarked: number; total: number;
  students: StudentStat[];
}

const ConsoleView = ({ planId, onBack }: { planId: string; onBack: () => void }) => {
  const queryClient = useQueryClient();
  const { data: plan, isLoading: loadingPlan } = useSeatingPlan(planId);
  const [threshold, setThreshold] = useState(20);
  const [now, setNow] = useState(Date.now());
  const [openAbsent, setOpenAbsent] = useState<Record<string, boolean>>({});

  // Tick every second for countdowns.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep the Date Sheet fresh (edits made in another tab/device show up
  // within a minute without a manual refresh).
  useEffect(() => {
    const t = setInterval(() => queryClient.invalidateQueries({ queryKey: ["all-exam-schedule"] }), 60_000);
    return () => clearInterval(t);
  }, [queryClient]);

  // MCQ Timer (shared with 3D Hall via localStorage) — unchanged.
  const mcqTimer = useMcqTimer(now);

  // TODAY, derived from the ticking clock → the moment the local date flips
  // at midnight, every query/memo below re-keys and all counters read 0.
  const todayStr = dateStrOf(new Date(now));

  const { data: dateSheetEntries = [] } = useAllExamSchedule();
  const { data: examSessions = [] } = useExamSessions();
  const examSession = useMemo(
    () => examSessions.find(s => s.id === plan?.session_id) ?? null,
    [examSessions, plan?.session_id]
  );

  // All attendance rows for TODAY only (no subject filter here — the per-class
  // subject filter is applied below, so two papers on one day never mix).
  const { data: attendance = [], isLoading: loadingAtt } = useLiveAttendance(todayStr, plan?.session_id, null);

  // ── Today's papers (live from Date Sheet) ──
  const todayGroups = useMemo(
    () => (plan ? buildGroups(plan, examSession, dateSheetEntries as DateSheetRow[], todayStr) : []),
    [plan, examSession, dateSheetEntries, todayStr]
  );

  // ── Next exam day (live from Date Sheet) ──
  const nextDate = useMemo(
    () => (plan ? findNextPaperDate(plan, examSession, dateSheetEntries as DateSheetRow[], todayStr) : null),
    [plan, examSession, dateSheetEntries, todayStr]
  );
  const nextGroups = useMemo(
    () => (plan && nextDate ? buildGroups(plan, examSession, dateSheetEntries as DateSheetRow[], nextDate) : []),
    [plan, examSession, dateSheetEntries, nextDate]
  );

  // Changes only when a paper flips to "done" → recompute the tally then
  // (without re-running it every second from the ticking clock).
  const doneSig = todayGroups.map(g => (phaseOf(g, now) === "done" ? "1" : "0")).join("");

  // ── Per class + paper attendance (today only, own subject only) ──
  const classStats = useMemo<ClassStat[]>(() => {
    if (!plan) return [];
    const ts = (r: LiveAttRow) => r.scanned_at || (r as any).created_at || "";
    const stats: ClassStat[] = [];
    for (const g of todayGroups) {
      // Latest row per student for THIS paper's subject (a corrected re-mark wins).
      const latest = new Map<string, LiveAttRow>();
      for (const r of attendance as LiveAttRow[]) {
        if (!subjectsMatch(r.subject, g.subject)) continue;
        const prev = latest.get(r.student_id);
        if (!prev || ts(r) >= ts(prev)) latest.set(r.student_id, r);
      }
      // Initialize stores everyone as "absent". While the paper is still running
      // (or hasn't started) such an untouched row is NOT an absence — it is
      // "not marked yet". It becomes a real Absent only once the paper is done
      // (or when someone explicitly marked it Absent — that sets scanned_at).
      const paperDone = phaseOf(g, Date.now()) === "done";
      for (const cls of g.classes) {
        const st: ClassStat = { key: `${g.key}|${cls}`, cls, group: g, present: 0, absent: 0, leave: 0, notMarked: 0, total: 0, students: [] };
        for (const room of plan.rooms) {
          for (const a of room.assignments) {
            if (a.class !== cls) continue;
            const row = latest.get(a.student_id);
            const status: StudentStat["status"] =
              row?.status === "present" ? "present"
              : row?.status === "absent" ? (row.scanned_at || paperDone ? "absent" : "not-marked")
              : row?.status === "leave" ? "leave" : "not-marked";
            if (status === "present") st.present++;
            else if (status === "absent") st.absent++;
            else if (status === "leave") st.leave++;
            else st.notMarked++;
            st.total++;
            st.students.push({
              assign: a, roomName: room.name, status,
              invigilator: room.invigilators?.length ? room.invigilators.join(", ") : room.invigilator,
            });
          }
        }
        st.students.sort((x, y) => x.roomName.localeCompare(y.roomName) || x.assign.seat_label.localeCompare(y.assign.seat_label, undefined, { numeric: true }));
        stats.push(st);
      }
    }
    return stats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, todayGroups, attendance, doneSig]);

  const tally = useMemo(() => {
    const t = { present: 0, absent: 0, leave: 0, notMarked: 0, total: 0 };
    for (const s of classStats) { t.present += s.present; t.absent += s.absent; t.leave += s.leave; t.notMarked += s.notMarked; t.total += s.total; }
    return t;
  }, [classStats]);

  // Per-room tally (only students whose class has a paper today).
  const rooms = useMemo(() => {
    const map = new Map<string, { roomName: string; invigilator: string | null; present: number; absent: number; leave: number; notMarked: number; total: number }>();
    for (const s of classStats) {
      for (const stu of s.students) {
        const cur = map.get(stu.roomName) ?? { roomName: stu.roomName, invigilator: stu.invigilator, present: 0, absent: 0, leave: 0, notMarked: 0, total: 0 };
        if (stu.status === "present") cur.present++;
        else if (stu.status === "absent") cur.absent++;
        else if (stu.status === "leave") cur.leave++;
        else cur.notMarked++;
        cur.total++;
        map.set(stu.roomName, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { numeric: true }));
  }, [classStats]);

  // Rows for the absentee PDF: absent + leave always; "not scanned" only for
  // papers that have already started (a student can't be "missing" before start).
  const exportRows = useMemo(() => {
    const rows: ExportRow[] = [];
    for (const s of classStats) {
      const started = phaseOf(s.group, now) !== "upcoming";
      for (const stu of s.students) {
        if (stu.status === "present") continue;
        if (stu.status === "not-marked" && !started) continue;
        rows.push({
          room_name: stu.roomName, invigilator: stu.invigilator, seat_label: stu.assign.seat_label,
          student_name: stu.assign.student_name, exam_roll_no: stu.assign.exam_roll_no,
          class: stu.assign.class, class_roll_no: stu.assign.class_roll_no, subject: s.group.subject || "",
          status: stu.status === "not-marked" ? "not-scanned" : stu.status,
        });
      }
    }
    return rows;
  }, [classStats, now]);

  if (loadingPlan || !plan) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none"><ArrowLeft className="w-4 h-4" /> Back</Button>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const phases = todayGroups.map(g => phaseOf(g, now));
  const anyLive = phases.includes("live");
  const anyUpcoming = phases.includes("upcoming");
  const allDone = todayGroups.length > 0 && phases.every(p => p === "done");
  const showNext = todayGroups.length === 0 || allDone;
  const started = classStats.some(s => phaseOf(s.group, now) !== "upcoming");

  const absentPct = tally.total > 0 ? Math.round((tally.absent / tally.total) * 100) : 0;
  const thresholdBreached = started && tally.total > 0 && absentPct > threshold;

  const badge = anyLive
    ? { text: "LIVE", live: true }
    : anyUpcoming ? { text: "UPCOMING", live: false }
    : allDone ? { text: "DONE", live: false }
    : { text: "NO PAPER", live: false };

  return (
    <div className="min-w-0 space-y-4">
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-2.5">
          <Button variant="outline" size="icon" aria-label="Back" onClick={onBack} className="h-9 w-9 shrink-0 rounded-full shadow-none">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <MonitorPlay className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[15px] font-heading font-bold leading-snug tracking-tight text-foreground sm:text-xl">{plan.title}</h2>
          </div>
          {badge.live ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold leading-none text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
              </span>
              LIVE
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-1 text-[10px] font-bold leading-none text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
              {badge.text}
            </span>
          )}
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 shrink-0" /> {fmtDay(todayStr)}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3 w-3 shrink-0" /> {plan.rooms.length} rooms</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3 shrink-0" /> {tally.total} students today</span>
        </div>

        <div className="relative mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <McqTimerButton timer={mcqTimer} />
        </div>
      </div>

      {/* ── Today's papers ── */}
      <section className="space-y-2">
        <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" /> Today's Papers
        </p>
        {todayGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-5 text-center">
            <p className="text-sm font-semibold text-foreground">No paper scheduled today</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Attendance counters stay at 0 until a paper starts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {todayGroups.map(g => <PaperCard key={g.key} g={g} now={now} />)}
          </div>
        )}
      </section>

      {/* ── Next exam day (after today's papers finish, or on a free day) ── */}
      {showNext && (
        <section className="space-y-2">
          <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Next Papers{nextDate ? ` · ${fmtDay(nextDate)}` : ""}
          </p>
          {nextGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-5 text-center">
              <p className="text-sm font-semibold text-foreground">No upcoming papers in the Date Sheet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {nextGroups.map(g => <PaperCard key={g.key} g={g} now={now} />)}
            </div>
          )}
        </section>
      )}

      {/* ── Threshold alert ── */}
      {thresholdBreached && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-300 bg-red-50 p-3.5 dark:border-red-700/50 dark:bg-red-900/20">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-red-800 dark:text-red-300">HIGH ABSENCE ALERT</p>
            <p className="break-words text-xs text-red-700 dark:text-red-400">
              {tally.absent} of {tally.total} students absent ({absentPct}%) — threshold is {threshold}%
            </p>
          </div>
        </div>
      )}

      {/* ── Today's attendance tally ── */}
      <section className="space-y-2">
        <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Today's Attendance
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1">
          <TallyCard icon={<CheckCircle2 className="w-5 h-5" />} label="Present" value={tally.present} total={tally.total} color="text-emerald-600" bg="bg-emerald-500/10" />
          <TallyCard icon={<XCircle className="w-5 h-5" />} label="Absent" value={tally.absent} total={tally.total} color="text-red-600" bg="bg-red-500/10" highlight={thresholdBreached} />
          <TallyCard icon={<Palmtree className="w-5 h-5" />} label="Leave" value={tally.leave} total={tally.total} color="text-blue-600" bg="bg-blue-500/10" />
          <TallyCard icon={<AlertTriangle className="w-5 h-5" />} label="Not Marked" value={tally.notMarked} total={tally.total} color="text-amber-600" bg="bg-amber-500/10" highlight={started && tally.notMarked > 0} />
          <TallyCard icon={<Users className="w-5 h-5" />} label="Total" value={tally.total} total={tally.total} color="text-foreground" bg="bg-secondary" />
        </div>
        <p className="px-1 text-[10px] leading-snug text-muted-foreground">Counts reset to 0 automatically at 12:00 AM for the new day.</p>
      </section>

      {/* ── Class-wise attendance + absent students ── */}
      {classStats.length > 0 && (
        <section className="space-y-2">
          <p className="flex items-center gap-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <XCircle className="h-3.5 w-3.5" /> Class-wise Attendance &amp; Absent Students
          </p>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {classStats.map(s => {
              const ph = phaseOf(s.group, now);
              const open = !!openAbsent[s.key];
              const pctPresent = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0;
              const absentList = s.students.filter(x => x.status === "absent");
              const notMarkedList = ph === "upcoming" ? [] : s.students.filter(x => x.status === "not-marked");
              return (
                <Card key={s.key} className="min-w-0 rounded-2xl border-border/60 shadow-sm">
                  <CardContent className="space-y-2.5 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold leading-tight ${colorFor(s.cls).bg} ${colorFor(s.cls).text}`}>Class {s.cls}</span>
                        <p className="mt-1 break-words text-xs font-medium leading-snug text-muted-foreground">{s.group.subject || "Paper"} · {fmt12(s.group.startHM)}{s.group.endHM ? ` – ${fmt12(s.group.endHM)}` : ""}</p>
                      </div>
                      <PhaseChip phase={ph} />
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      <MiniStat label="Present" value={s.present} tone="text-emerald-600 dark:text-emerald-400" />
                      <MiniStat label="Absent" value={s.absent} tone="text-red-600 dark:text-red-400" />
                      <MiniStat label="Leave" value={s.leave} tone="text-blue-600 dark:text-blue-400" />
                      <MiniStat label="Pending" value={s.notMarked} tone="text-amber-600 dark:text-amber-400" />
                    </div>

                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="bg-emerald-500" style={{ width: `${s.total ? (s.present / s.total) * 100 : 0}%` }} />
                      <div className="bg-red-500" style={{ width: `${s.total ? (s.absent / s.total) * 100 : 0}%` }} />
                      <div className="bg-blue-500" style={{ width: `${s.total ? (s.leave / s.total) * 100 : 0}%` }} />
                      <div className="bg-amber-500" style={{ width: `${s.total ? (s.notMarked / s.total) * 100 : 0}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">{pctPresent}% present · {s.total} students</p>

                    <button
                      type="button"
                      onClick={() => setOpenAbsent(p => ({ ...p, [s.key]: !p[s.key] }))}
                      className="flex h-8 w-full items-center justify-between gap-2 rounded-full border border-border/60 bg-muted/40 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                      aria-expanded={open}
                    >
                      <span className="flex min-w-0 items-center gap-1.5"><XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" /> Absent students ({absentList.length})</span>
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>

                    {open && (
                      <div className="space-y-1.5">
                        {absentList.length === 0 && notMarkedList.length === 0 && (
                          <p className="py-2 text-center text-xs text-muted-foreground">No absent students 🎉</p>
                        )}
                        {absentList.map(x => <StudentLine key={x.assign.student_id} stu={x} tone="red" />)}
                        {notMarkedList.length > 0 && (
                          <>
                            <p className="pt-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Not marked yet ({notMarkedList.length})</p>
                            {notMarkedList.map(x => <StudentLine key={x.assign.student_id} stu={x} tone="amber" />)}
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Threshold slider ── */}
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="space-y-2.5 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Absent Threshold</Label>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-bold leading-none tabular-nums text-primary">{threshold}%</span>
          </div>
          <input type="range" min={5} max={50} step={5} value={threshold} onChange={e => setThreshold(+e.target.value)} className="w-full accent-primary" />
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>5%</span><span>20%</span><span>50%</span></div>
          <p className="text-[11px] leading-snug text-muted-foreground">Alert triggers when absent % exceeds this threshold.</p>
        </CardContent>
      </Card>

      {/* ── Per-room breakdown ── */}
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardHeader className="p-3.5 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-heading font-bold">
            <Building2 className="h-4 w-4 text-primary" /> Per-Room Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-1">
          {rooms.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No students seated for today's papers</p>
          ) : (
            <div className="space-y-2">
              {rooms.map(r => {
                const roomPct = r.total > 0 ? Math.round((r.present / r.total) * 100) : 0;
                const roomAbsentPct = r.total > 0 ? Math.round((r.absent / r.total) * 100) : 0;
                const roomBreached = started && roomAbsentPct > threshold && r.total > 0;
                return (
                  <div key={r.roomName} className={`rounded-2xl border p-3 ${roomBreached ? "border-red-300 bg-red-50/50 dark:border-red-700/50 dark:bg-red-900/10" : "border-border/60"}`}>
                    <div className="mb-2 flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words text-sm font-semibold">{r.roomName}</span>
                        {r.invigilator && <Badge variant="outline" className="h-auto max-w-full whitespace-normal break-words px-2 py-0.5 text-[10px] font-medium leading-tight">{r.invigilator}</Badge>}
                        {roomBreached && <Badge variant="destructive" className="h-5 px-2 text-[10px]">⚠ {roomAbsentPct}% absent</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">P: {r.present}</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">A: {r.absent}</span>
                        <span className="font-semibold text-blue-600 dark:text-blue-400">Lv: {r.leave}</span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">NM: {r.notMarked}</span>
                        <span className="font-semibold text-muted-foreground">T: {r.total}</span>
                      </div>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="bg-emerald-500" style={{ width: `${(r.present / r.total) * 100}%` }} />
                      <div className="bg-red-500" style={{ width: `${(r.absent / r.total) * 100}%` }} />
                      <div className="bg-blue-500" style={{ width: `${(r.leave / r.total) * 100}%` }} />
                      <div className="bg-amber-500" style={{ width: `${(r.notMarked / r.total) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">{roomPct}% present</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Actions ── */}
      <div className="grid grid-cols-2 gap-2">
        <AbsenteePdfButton plan={plan} rows={exportRows} tally={tally} papers={todayGroups} />
        <Button
          variant="outline"
          size="sm"
          className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"
          onClick={() => {
            const keys = [["seating-plan"], ["seating-plans"], ["live-attendance"], ["exam-attendance"], ["exam-sessions"], ["exam-sessions-published"], ["all-exam-schedule"]];
            Promise.allSettled(keys.map(queryKey => queryClient.invalidateQueries({ queryKey }))).then(() => {
              toast.success("Data refreshed", { duration: 2000, icon: "✓" });
            });
          }}
          disabled={loadingPlan || loadingAtt}
        >
          <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${loadingPlan || loadingAtt ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </Button>
      </div>
    </div>
  );
};

// ── Paper card: class names + subject + time range + its OWN countdown ──
const PaperCard = ({ g, now }: { g: PaperGroup; now: number }) => {
  const phase = phaseOf(g, now);
  let label = "";
  let value = "";
  let tone = "text-muted-foreground";
  if (phase === "upcoming") {
    label = "Starts in"; value = formatDuration(g.startMs - now); tone = "text-blue-600 dark:text-blue-400";
  } else if (phase === "live") {
    tone = "text-emerald-600 dark:text-emerald-400";
    if (g.endMs !== null) { label = "Ends in"; value = formatDuration(g.endMs - now); }
    else { label = "In progress"; value = "No end time"; }
  } else {
    label = "Finished"; value = `${formatDuration(now - (g.endMs as number))} ago`;
  }
  const progress = phase === "live" && g.endMs !== null
    ? Math.min(100, Math.max(0, ((now - g.startMs) / (g.endMs - g.startMs)) * 100))
    : phase === "done" ? 100 : 0;
  const ring = phase === "live" ? "ring-2 ring-emerald-500/50" : phase === "upcoming" ? "ring-1 ring-blue-500/30" : "opacity-80";

  return (
    <div className={`min-w-0 rounded-2xl border border-border/60 bg-card p-3 shadow-sm ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] font-bold leading-snug text-foreground">{classLabel(g.classes)}</p>
          <p className="mt-0.5 flex items-start gap-1 break-words text-xs font-medium leading-snug text-muted-foreground">
            <BookOpen className="mt-0.5 h-3 w-3 shrink-0" /> <span className="min-w-0 break-words">{g.subject || "Paper"}</span>
          </p>
        </div>
        <PhaseChip phase={phase} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] tabular-nums text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" /> {fmt12(g.startHM)} – {g.endHM ? fmt12(g.endHM) : "—"}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-border/60 pt-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className={`font-mono text-lg font-bold leading-tight tabular-nums sm:text-xl ${tone}`}>{value}</span>
      </div>
      {phase === "live" && g.endMs !== null && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-emerald-500 transition-[width] duration-1000" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
};

const PhaseChip = ({ phase }: { phase: Phase }) => {
  const map = {
    live: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
    upcoming: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400",
    done: "border-border bg-muted/60 text-muted-foreground",
  } as const;
  const text = phase === "live" ? "Live" : phase === "upcoming" ? "Upcoming" : "Finished";
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none ${map[phase]}`}>{text}</span>
  );
};

const MiniStat = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div className="min-w-0 rounded-xl bg-muted/40 px-1 py-1.5">
    <p className={`text-base font-bold leading-none tabular-nums ${tone}`}>{value}</p>
    <p className="mt-1 text-[9px] font-medium leading-tight text-muted-foreground">{label}</p>
  </div>
);

const StudentLine = ({ stu, tone }: { stu: StudentStat; tone: "red" | "amber" }) => (
  <div className={`min-w-0 rounded-xl border px-2.5 py-1.5 ${tone === "red" ? "border-red-200 bg-red-50/60 dark:border-red-800/40 dark:bg-red-900/10" : "border-amber-200 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-900/10"}`}>
    <p className="break-words text-xs font-semibold leading-snug text-foreground">{stu.assign.student_name}</p>
    <p className="break-words text-[10px] leading-snug text-muted-foreground">
      Exam Roll {stu.assign.exam_roll_no} · Class Roll {stu.assign.class_roll_no} · {stu.roomName} · Seat {stu.assign.seat_label}
    </p>
  </div>
);

// ── Tally card ──
const TallyCard = ({ icon, label, value, total, color, bg, highlight }: {
  icon: React.ReactNode; label: string; value: number; total: number;
  color: string; bg: string; highlight?: boolean;
}) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card className={`rounded-2xl shadow-sm ${highlight ? "ring-2 ring-red-500" : ""}`}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${bg} ${color} [&>svg]:h-4 [&>svg]:w-4`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1 leading-none">
          <p className="text-lg font-bold tabular-nums text-foreground sm:text-2xl">{value}</p>
          <p className="mt-1 break-words text-[11px] leading-tight text-muted-foreground">{label} · {pct}%</p>
        </div>
      </CardContent>
    </Card>
  );
};

// ── Absentee PDF button ──
interface ExportRow {
  room_name: string; invigilator: string | null; seat_label: string;
  student_name: string; exam_roll_no: string; class: string; class_roll_no: string; subject: string;
  status: "absent" | "leave" | "not-scanned";
}

const AbsenteePdfButton = ({ plan, rows, tally, papers }: {
  plan: SeatingPlanFull;
  rows: ExportRow[];
  tally: { present: number; absent: number; leave: number; notMarked: number; total: number };
  papers: PaperGroup[];
}) => {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      if (rows.length === 0) {
        toast.success("No absentees today — everyone is present! 🎉");
        setBusy(false);
        return;
      }
      const absentees = [...rows].sort(
        (a, b) => sortClasses(a.class, b.class) || a.room_name.localeCompare(b.room_name, undefined, { numeric: true }) || a.seat_label.localeCompare(b.seat_label, undefined, { numeric: true })
      );

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();

      doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.setTextColor(30);
      doc.text("Absentee List — Re-Exam Approval", pageW / 2, 16, { align: "center" });
      doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(80);
      doc.text(plan.title, pageW / 2, 22, { align: "center" });
      const subjects = Array.from(new Set(papers.map(p => p.subject).filter(Boolean))).join(", ");
      const subtitle = `${subjects ? subjects + " · " : ""}${fmtDay(dateStrOf(new Date()))}`;
      doc.text(doc.splitTextToSize(subtitle, pageW - 28), pageW / 2, 27, { align: "center" });

      doc.setFillColor(245, 245, 245);
      doc.roundedRect(14, 32, pageW - 28, 16, 1.5, 1.5, "F");
      doc.setFontSize(8); doc.setTextColor(80); doc.setFont("helvetica", "normal");
      const absentPct = tally.total > 0 ? Math.round((tally.absent / tally.total) * 100) : 0;
      doc.text(
        `Total: ${tally.total}  ·  Present: ${tally.present}  ·  Absent: ${tally.absent} (${absentPct}%)  ·  Leave: ${tally.leave}  ·  Not Marked: ${tally.notMarked}`,
        pageW / 2, 41, { align: "center" }
      );

      autoTable(doc, {
        startY: 52,
        head: [["Class", "Subject", "Room", "Seat", "Exam Roll", "Student Name", "Class Roll", "Invigilator", "Status"]],
        body: absentees.map(a => [
          `Class ${a.class}`, a.subject || "—", a.room_name, a.seat_label, a.exam_roll_no, a.student_name, a.class_roll_no, a.invigilator ?? "—",
          a.status === "leave" ? "Leave" : a.status === "absent" ? "Absent" : "Not Marked",
        ]),
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [180, 40, 40], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [252, 245, 245] },
        didDrawPage: (data) => {
          doc.setFontSize(6); doc.setTextColor(140);
          doc.text(
            `Generated ${new Date().toLocaleString()}  ·  GHS Babi Khel Exam Seating Engine  ·  Page ${data.pageNumber}`,
            pageW / 2, doc.internal.pageSize.getHeight() - 6, { align: "center" }
          );
        },
      });

      const lastY = (doc as any).lastAutoTable?.finalY ?? 60;
      const sigY = Math.min(lastY + 20, doc.internal.pageSize.getHeight() - 30);
      doc.setDrawColor(120); doc.setLineWidth(0.3);
      doc.line(20, sigY, 80, sigY);
      doc.line(pageW - 80, sigY, pageW - 20, sigY);
      doc.setFontSize(7); doc.setTextColor(80); doc.setFont("helvetica", "normal");
      doc.text("Invigilator Signature", 50, sigY + 5, { align: "center" });
      doc.text("Principal Signature", pageW - 50, sigY + 5, { align: "center" });

      doc.save(`Absentees-${plan.title.replace(/\s+/g, "_")}-${dateStrOf(new Date())}.pdf`);
      toast.success(`Absentee PDF downloaded — ${absentees.length} student${absentees.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error("Failed: " + (e?.message ?? ""));
    }
    setBusy(false);
  };

  return (
    <Button onClick={handle} disabled={busy} variant="default" size="sm" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none">
      {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0" />}
      <span>Absentee PDF</span>
    </Button>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// MCQ Timer — Start button (opens minutes dialog) + Stop/Reset quick actions
// ────────────────────────────────────────────────────────────────────────────
// Lives in the console's Actions row. When the timer is running/stopped, the
// button shows the live MM:SS countdown inline + a Stop action. When idle,
// it shows "MCQ Timer" and opens a small dialog where the admin types the
// number of minutes (e.g. 15) and hits Start. The dialog also offers common
// quick-pick chips (5 / 10 / 15 / 20 / 30 / 60) so on mobile the admin
// doesn't have to type at all — one tap and Start.
type McqTimerApi = ReturnType<typeof useMcqTimer>;

const QUICK_MINUTES = [5, 10, 15, 20, 30, 45, 60];

function McqTimerButton({ timer }: { timer: McqTimerApi }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("15");

  const { state, remainingMs, start, stop, reset } = timer;
  const isLive = state && (state.status === "running" || state.status === "stopped");
  const isFinished = state?.status === "finished";

  const handleStart = () => {
    const m = parseInt(minutes, 10);
    if (!Number.isFinite(m) || m < 1 || m > 600) {
      toast.error("Enter minutes between 1 and 600");
      return;
    }
    start(m);
    toast.success(`MCQs timer started — ${m} min`);
    setOpen(false);
  };

  // ── Idle state: show "MCQ Timer" button that opens the dialog ──
  if (!state) {
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60">
            <Timer className="h-3.5 w-3.5 shrink-0" /> <span>MCQs Timer</span>
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" /> Start MCQs Timer
            </AlertDialogTitle>
            <AlertDialogDescription>
              Set a countdown for an MCQ paper. The remaining time shows on this console
              AND inside the 3D Hall screen. When it reaches zero, the 3D Hall screen
              fires a red siren overlay for 15 seconds.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            {/* Minutes input */}
            <div>
              <Label className="text-xs">Minutes</Label>
              <Input
                type="number"
                min={1}
                max={600}
                value={minutes}
                onChange={e => setMinutes(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleStart(); }}
                className="mt-1 h-10 text-lg font-bold text-center"
                autoFocus
              />
            </div>

            {/* Quick-pick chips */}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1.5">Quick pick:</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MINUTES.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMinutes(String(m))}
                    className={`h-8 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold border transition-colors ${
                      minutes === String(m)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border/60 hover:bg-muted"
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          </div>

          <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-9 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStart} className="mt-0 h-9 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">
              <Play className="w-4 h-4 mr-1" /> Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // ── Live/finished state: show countdown + Stop/Reset inline ──
  // Mobile: text is "MM:SS" only (label hidden). Desktop: "MCQ MM:SS".
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-0.5">
      <div className={`px-2.5 py-1.5 text-sm font-mono font-bold flex items-center gap-1.5 rounded-full ${
        isFinished
          ? "text-red-600 dark:text-red-400 animate-pulse"
          : state.status === "running"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-amber-600 dark:text-amber-400"
      }`}>
        <Timer className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">MCQ</span>
        <span>{isFinished ? "00:00" : formatMcqTime(remainingMs)}</span>
      </div>
      {state.status === "running" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-full p-0 text-xs shadow-none"
          onClick={() => { stop(); toast("MCQs timer stopped"); }}
          title="Stop timer"
        >
          <Square className="w-3 h-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 rounded-full p-0 text-xs"
        onClick={() => { reset(); toast.success("MCQs timer reset"); }}
        title="Reset timer"
      >
        <RotateCcw className="w-3 h-3" />
      </Button>
    </div>
  );
}

// ── Helpers ──
function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default AdminExamConsole;
