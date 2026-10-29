/**
 * AdminExamRollNumbers.tsx
 * Combined Admin tab — Exam Roll Numbers + Exam Attendance (merged).
 * Generates roll numbers with real QR codes, manages exam attendance with scan support.
 * Mobile-friendly: cards on mobile, table on desktop.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Hash, Plus, Trash2, Eye, EyeOff, Loader2, ChevronUp, ChevronDown, RefreshCw,
  ArrowLeft, Timer, Clock, QrCode, ClipboardCheck, Search, Camera, Check, X, Palmtree,
  CalendarDays, BookOpen, Users, FileSpreadsheet, ScanLine, CheckCircle2, AlertCircle,
  Keyboard, History, FileText, Lock, XCircle, FileUp, Download,
} from "lucide-react";
import toast from "react-hot-toast";
// PERF (chunk size): jspdf / jspdf-autotable / qrcode / canvas-confetti are
// loaded ONLY inside their click handlers via dynamic import(). The old
// static imports dragged ~300+ KB of PDF/QR/canvas libraries into this
// tab's chunk even for admins who never export anything — this single tab
// chunk was 443 kB. html5-qrcode (never used in this file at all — the
// scanner component imports its own) is deleted outright.
import {
  useExamSessions as useAttExamSessions,
  useExamRollNumbers as useAttExamRollNumbers,
  useExamAttendance, useExamAttendanceOverview,
  useInitExamAttendance, encodeExamQRData,
  useUpdateExamAttendance,
  useDeleteExamAttendance, useDeleteClassExamAttendance, EXAM_SUBJECTS,
  ExamAttStatus, ExamAttendanceRecord, type ExamAttDisplayStatus, displayAttStatus, isUnmarkedRow,
  getPaperWindowStatus, canMarkExamAttendance, paperWindowMessage, type PaperWindowStatus,
  usePaperTimesFromSeatingPlan, formatLocalDate,
  type DateSheetLookup,
} from "@/hooks/useExamAttendance";
import { useAllExamSchedule, ExamScheduleEntry } from "@/hooks/useNewFeatures";
import { format as formatDateFns } from "date-fns";
import { examTypeLabel } from "@/utils/examTypeLabel";
import { termMatches, termForClass, sessionTermLabel } from "@/utils/examTerm";
import QRScanner from "./exam-rolls/QRScanner";
import ScanConfirmSheet, { type ScanPreview } from "./exam-rolls/ScanConfirmSheet";
import SyncStatusBar from "./exam-rolls/SyncStatusBar";
import { parseExamQr } from "@/lib/examQrSecurity";
import {
  outbox, enqueueAttendance, makeAttendanceKey, getScannerId,
  getCachedSeatAssignments, getSeatAssignments,
} from "@/lib/examAttendanceOutbox";
import { useOutboxSnapshot, useSessionRoster, useRefreshOnOutboxSynced } from "@/hooks/useAttendanceOutbox";
import CountdownTimer from "./exam-rolls/CountdownTimer";
import {
  sortByRollNumber, interleaveByClassOrder,
  type ExamSession, type ExamRollEntry, type Student,
} from "./exam-rolls/examRollHelpers";
import { readRosterFile, downloadRosterTemplateXlsx } from "./exam-rolls/rosterCsv";
import {
  PDF_INK, PDF_ACCENT, PDF_MUTED, PDF_LINE, type RGB,
  safeFile, pdfBrandHeader, pdfSummaryTiles, pdfFooters, pdfSignatures,
} from "./exam-rolls/pdfHelpers";

/**
 * Roll-number session status, countdown-aware:
 *   • "draft"     → is_published=false (invisible to students)
 *   • "scheduled" → published with publish_at still in the future.
 *       Setting a countdown now publishes the session IMMEDIATELY
 *       (data fully prepared, students see a live countdown), so the
 *       moment publish_at passes, students' devices flip to the slips
 *       instantly — no "Publishing now..." step, nothing to wait for.
 *   • "live"      → published and visible right now.
 */
type RollSessionStatus = "draft" | "scheduled" | "live";
function rollSessionStatus(s: { is_published: boolean; publish_at: string | null }): RollSessionStatus {
  if (!s.is_published) return "draft";
  const t = s.publish_at ? new Date(s.publish_at).getTime() : null;
  return t !== null && t > Date.now() ? "scheduled" : "live";
}

// ── Premium form tokens (thin, mobile-first, never clip text) ──
const FIELD_LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground";
const FIELD_CONTROL = "h-10 w-full min-w-0 appearance-none truncate rounded-full border border-border/60 bg-card pl-4 pr-9 text-[13px] font-medium text-foreground shadow-none outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";
const ALL_CLASSES = ["6", "7", "8", "9", "10"];
const TERMS = ["1st Semester", "2nd Semester"];   // one session covers every class (all classes 6-10)

type Status = ExamAttStatus;
const statusConfig: Record<ExamAttDisplayStatus, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  // "pending" = initialized but not marked yet (paper not finished) — NOT absent.
  pending: { icon: <Clock className="w-4 h-4" />, label: "Pending", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700/50" },
  present: { icon: <Check className="w-4 h-4" />, label: "Present", color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700/50" },
  absent:  { icon: <X className="w-4 h-4" />, label: "Absent",  color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700/50" },
  leave:   { icon: <Palmtree className="w-4 h-4" />, label: "Leave",  color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700/50" },
};

// Date-sheet subject names differ from the attendance subject list (e.g. "Maths" vs "Mathematics").
const SUBJECT_ALIASES: Record<string, string> = {
  maths: "Mathematics", math: "Mathematics", gscience: "General Science", science: "General Science",
  mquran: "Mutalia Quran", mutalia: "Mutalia Quran", pakstudy: "Pakistan Studies", pakstudies: "Pakistan Studies",
};
function canonicalSubject(raw: string): string {
  const key = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (SUBJECT_ALIASES[key]) return SUBJECT_ALIASES[key];
  const hit = EXAM_SUBJECTS.find(x => x.toLowerCase().replace(/[^a-z]/g, "") === key);
  return hit ?? String(raw || "").trim();
}

/* PERF: the manual-attendance list used to build BOTH the mobile card tree
   (sm:hidden) and the desktop table tree (hidden sm:block) on every render —
   double reconciliation for hundreds of students on every scan / 15 s tick.
   This matchMedia hook renders only the variant the device actually shows
   (same sm breakpoint, same markup — the `hidden` classes are kept as a
   harmless belt-and-braces while the JS-driven choice does the real work). */
function useIsMobileLayout(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

// ── Main Component ────────────────────────────────────────────────────────────
const AdminExamRollNumbers = () => {
  const qc = useQueryClient();
  // Exam date sheet (built by admin in "Exam Date Sheet") — pulled in so
  // Roll No Slips can print each student's actual paper-by-paper schedule.
  const { data: allExamSchedule = [] } = useAllExamSchedule();
  // Main tab: "rolls" or "attendance"
  const [mainTab, setMainTab] = useState<"rolls" | "attendance">("rolls");
  // Roll numbers sub-views
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [selectedSession, setSelectedSession] = useState<ExamSession | null>(null);

  // Create form
  const [formTitle, setFormTitle] = useState("");
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formTerm, setFormTerm] = useState("1st Semester");
  const [selectedClasses, setSelectedClasses] = useState<string[]>(["6", "7", "8"]);
  const [classOrder, setClassOrder] = useState<string[]>(["6", "7", "8"]);
  const [startingNumber, setStartingNumber] = useState(100000);
  const [generating, setGenerating] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  // Class roster imported from CSV (Class No, Full Name, Father Name, Class).
  // This is the ONLY source of students for new sessions — the school
  // students table is no longer read here.
  const [csvRoster, setCsvRoster] = useState<Student[]>([]);
  const [rosterInfo, setRosterInfo] = useState<{ file: string; skipped: number } | null>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);

  // Countdown form
  const [countdownDate, setCountdownDate] = useState("");
  const [countdownTime, setCountdownTime] = useState("08:00");
  const [countdownLabel, setCountdownLabel] = useState("Exam Roll Numbers will be published in");
  const [savingCountdown, setSavingCountdown] = useState(false);

  const [detailSearch, setDetailSearch] = useState("");

  // ── ATTENDANCE STATE ────────────────────────────────────────────────────
  const [attSession, setAttSession] = useState<string>("");
  const [attClass, setAttClass] = useState<string>("");  // "" | "6".."10" | "all"
  const [attSubject, setAttSubject] = useState<string>("");
  // All-Classes mode: per-class subject map. Key = class, value = subject.
  // Each class has its OWN paper (e.g. Class 8 takes Mathematics while
  // Class 7 takes English at the same time), so the admin picks a subject
  // for each class in one screen, then scans/enters attendance for any
  // student from any class — the saved row uses the student's actual
  // class + that class's selected subject.
  const [allClassSubjects, setAllClassSubjects] = useState<Record<string, string>>({});
  const [attDate, setAttDate] = useState<string>(formatLocalDate(new Date()));
  const [attTab, setAttTab] = useState<"scan" | "overview">("scan");
  const [attSearch, setAttSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── SAME-PAPER-DIFFERENT-DATE SAFEGUARD ─────────────────────────────────
  // Fetches every DISTINCT (class, subject, exam_date) already recorded for
  // this session, regardless of attDate. Used to warn the admin BEFORE they
  // init/mark attendance if the class+subject they're about to use already
  // has attendance on a DIFFERENT date — which almost always means the date
  // picker is on the wrong day (e.g. still on "today" when the intended
  // paper was actually initialized a few days ago), and proceeding would
  // silently create a brand-new column instead of updating the existing
  // paper's attendance, exactly the "Mathematics appears 3 times" bug.
  const { data: existingPaperDates = [] } = useQuery<Array<{ class: string; subject: string; exam_date: string }>>({
    queryKey: ["exam-attendance-paper-dates", attSession],
    queryFn: async () => {
      if (!attSession) return [];
      const { data, error } = await supabase
        .from("exam_attendance")
        .select("class, subject, exam_date")
        .eq("session_id", attSession)
        // Init only works for TODAY, so only rows on OTHER dates can conflict.
        // Excluding today keeps this payload tiny on slow connections.
        .neq("exam_date", formatLocalDate(new Date()));
      if (error) throw error;
      const seen = new Set<string>();
      const out: Array<{ class: string; subject: string; exam_date: string }> = [];
      for (const r of data ?? []) {
        const normDate = String(r.exam_date).slice(0, 10);
        const key = `${r.class}__${r.subject}__${normDate}`;
        if (!seen.has(key)) { seen.add(key); out.push({ class: r.class, subject: r.subject, exam_date: normDate }); }
      }
      return out;
    },
    enabled: !!attSession,
    staleTime: 60 * 1000,
  });

  /**
   * Returns the OTHER date(s) this class+subject already has attendance on
   * (excluding attDate itself), or an empty array if none / all dates match.
   */
  const findConflictingDates = (cls: string, subject: string): string[] => {
    return existingPaperDates
      .filter(r => r.class === cls && r.subject === subject && r.exam_date !== attDate)
      .map(r => r.exam_date);
  };

  // Scan state
  const [manualRoll, setManualRoll] = useState<string>("");
  const [qrInput, setQrInput] = useState<string>("");
  const [scanLog, setScanLog] = useState<{ name: string; roll: string; time: string; status: string }[]>([]);

  // ── INSTANT SCAN PREVIEW (board-system style confirm) ─────────────────
  // The moment a QR decodes, look the student up CLIENT-SIDE (no network
  // round-trip — attRollNumbers is already loaded) and show a big
  // name/class/roll confirm card INSTANTLY. The admin can visually verify
  // against the actual student, then tap Confirm (or it auto-confirms
  // shortly after) — only THEN does the network mutation fire. This makes
  // scanning feel instant even though the server-side mark (with its
  // multi-strategy stale-QR fallback lookups) still takes a moment.
  //
  // ── FIX: Student interface now STAYS VISIBLE when scanning different QR codes ──
  // Previously, scanning a new QR code would sometimes hide the student card
  // due to race conditions between timer callbacks and state updates. Now:
  //   1. A scanId ref tracks which QR is currently being previewed
  //   2. Timer callback checks if it's STILL the current scan before clearing
  //   3. Interface stays visible until explicitly confirmed or cancelled
  //   4. Auto-confirm time increased to 3 seconds for better UX
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null);
  // ── SCAN LOCK (sticky confirm card) ─────────────────────────────────
  // While a student's confirm card is open (or a lookup is in flight) the
  // scanner is LOCKED: further decodes are ignored, so a shaky hand or a
  // second QR in view can never replace, reset or dismiss the card. The card
  // closes ONLY when the admin taps Confirm or ✕ — there is no auto-confirm.
  // After closing, the SAME code is ignored for a short window so the QR that
  // is still under the camera doesn't instantly re-open the card.
  const scanLockRef = useRef(false);
  const lastClosedRef = useRef<{ qr: string; t: number } | null>(null);
  const SAME_CODE_LOCKOUT_MS = 1800;
  const releaseScanLock = (qr: string) => {
    lastClosedRef.current = { qr, t: Date.now() };
    scanLockRef.current = false;
  };
  const [showScanner, setShowScanner] = useState(false);
  // Manual attendance list is hidden by default after Initialize — the
  // student list only appears once the admin explicitly taps "Manual
  // Attendance", so QR scanning (the common path) isn't buried under a
  // long list of names right after initializing. Purely a display toggle;
  // nothing about attendance records or scanning logic changes.
  const [showManualList, setShowManualList] = useState(false);

  const isAllClassesMode = attClass === "all";

  // ── DATA QUERIES ────────────────────────────────────────────────────────
  const { data: sessions = [], isLoading: loadingSessions } = useQuery<ExamSession[]>({
    queryKey: ["exam-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("exam_roll_sessions").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rollNumbers = [], isLoading: loadingRolls } = useQuery<ExamRollEntry[]>({
    queryKey: ["exam-rolls", selectedSession?.id],
    queryFn: async () => {
      if (!selectedSession) return [];
      const { data, error } = await supabase.from("exam_roll_numbers").select("*").eq("session_id", selectedSession.id).order("serial_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedSession,
  });

  // Attendance data
  const { data: attSessions = [] } = useAttExamSessions();
  const availableClasses = useMemo(() => {
    const s = attSessions.find((s: any) => s.id === attSession);
    return s?.classes ?? [];
  }, [attSessions, attSession]);

  // ── ALL-CLASSES MODE: fetch ALL roll numbers for the session (no class filter).
  // Used when attClass === "all" so the admin sees students from every class
  // in one list. Each student's `class` field is preserved so attendance is
  // saved to the right sheet.
  const { data: allRollNumbers = [], isLoading: loadingAllRolls } = useQuery<ExamRollEntry[]>({
    queryKey: ["exam-rolls-all-classes", attSession],
    queryFn: async () => {
      if (!attSession) return [];
      const { data, error } = await supabase
        .from("exam_roll_numbers")
        .select("*")
        .eq("session_id", attSession)
        .order("class", { ascending: true })
        .order("serial_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAllClassesMode && !!attSession,
    staleTime: 2 * 60 * 1000,
  });

  // Single-class roll numbers (used when attClass is a real class).
  // Always called (Rules of Hooks), but only enabled when not in All-Classes mode.
  const singleClassRollsQuery = useAttExamRollNumbers(
    !isAllClassesMode ? attSession : undefined,
    !isAllClassesMode ? attClass : undefined
  );

  // In All-Classes mode, use the full session list. Otherwise use the
  // class-filtered list.
  const attRollNumbers = isAllClassesMode ? allRollNumbers : (singleClassRollsQuery.data ?? []);
  const loadingRollsForAtt = isAllClassesMode ? loadingAllRolls : singleClassRollsQuery.isLoading;

  // ── ALL-CLASSES MODE: fetch attendance for ALL classes + ALL selected subjects.
  // In All-Classes mode, we don't have a single subject — each class has its
  // own. We fetch ALL attendance rows for the session+date and filter
  // client-side by the per-class subjects. This is one query (not N) so it's
  // fast even for big sessions.
  const { data: allClassesAttendance = [], isLoading: loadingAllClassesAtt } = useQuery<ExamAttendanceRecord[]>({
    queryKey: ["exam-attendance-all-classes", attSession, attDate],
    queryFn: async () => {
      if (!attSession || !attDate) return [];
      const { data, error } = await supabase
        .from("exam_attendance")
        .select("*")
        .eq("session_id", attSession)
        .eq("exam_date", attDate)
        .order("class_roll_no", { ascending: true });
      if (error) throw error;
      // DEDUPE: collapse any duplicate rows so stats aren't inflated.
      return data ?? [];
    },
    enabled: isAllClassesMode && !!attSession && !!attDate,
    staleTime: 30 * 1000,
  });

  // In All-Classes mode, the "attendance" we display is filtered to only
  // the rows whose subject matches the per-class selected subject. In
  // single-class mode, we use the regular useExamAttendance hook.
  const { data: singleClassAttendance = [], isLoading: loadingSingleClassAtt } = useExamAttendance(
    !isAllClassesMode ? attSession : undefined,
    !isAllClassesMode ? attClass : undefined,
    !isAllClassesMode ? attSubject : undefined,
    !isAllClassesMode ? attDate : undefined
  );

  // Offline-first helpers: cached roster + live outbox state.
  const roster = useSessionRoster(attSession);
  const outboxSnap = useOutboxSnapshot();
  useRefreshOnOutboxSynced();

  const attendanceFromServer: ExamAttendanceRecord[] = useMemo(() => {
    if (isAllClassesMode) {
      // Filter to only rows whose (class, subject) matches a selected
      // per-class subject. This shows the admin exactly the attendance
      // they're managing right now.
      return allClassesAttendance.filter(r => {
        const subj = allClassSubjects[r.class];
        return subj && r.subject === subj;
      });
    }
    return singleClassAttendance;
  }, [isAllClassesMode, allClassesAttendance, allClassSubjects, singleClassAttendance]);

  // Scans still waiting in the outbox are shown as Present IMMEDIATELY
  // (optimistic) so the sheet, counters and PDF never lag behind the camera.
  const attendance: ExamAttendanceRecord[] = useMemo(() => {
    if (!outboxSnap.items.length) return attendanceFromServer;
    const queued = new Map(outboxSnap.items.map(i => [i.key, i]));
    return attendanceFromServer.map(r => {
      if (r.status === "present") return r;
      const q = queued.get(makeAttendanceKey(r.session_id, r.student_id, r.subject, String(r.exam_date).slice(0, 10)));
      return q ? { ...r, status: "present" as ExamAttStatus, scanned_at: q.scannedAt, scanned_by: q.scannedBy } : r;
    });
  }, [attendanceFromServer, outboxSnap.items]);

  const loadingAtt = isAllClassesMode ? loadingAllClassesAtt : loadingSingleClassAtt;

  const { data: overviewServerData = [], isLoading: loadingOverview } = useExamAttendanceOverview(attTab === "overview" ? attSession : undefined, attTab === "overview" ? (isAllClassesMode ? "all" : attClass) : undefined);
  // Class Overview must show scans that are still waiting to sync as Present
  // too — otherwise it looks like "everyone is Absent" until the network catches up.
  const overviewData: ExamAttendanceRecord[] = useMemo(() => {
    if (!outboxSnap.items.length) return overviewServerData;
    const queued = new Map(outboxSnap.items.map(i => [i.key, i]));
    return overviewServerData.map(r => {
      if (r.status === "present") return r;
      const q = queued.get(makeAttendanceKey(r.session_id, r.student_id, r.subject, String(r.exam_date).slice(0, 10)));
      return q ? { ...r, status: "present" as ExamAttStatus, scanned_at: q.scannedAt, scanned_by: q.scannedBy } : r;
    });
  }, [overviewServerData, outboxSnap.items]);

  const initAttendance = useInitExamAttendance();
  // All-Classes init runs several mutations in parallel on ONE mutation hook,
  // whose isPending only reflects the latest call — track the whole batch here
  // so the button stays disabled (no accidental double-init) until all finish.
  const [initBusy, setInitBusy] = useState(false);
  const updateAttendance = useUpdateExamAttendance();
  const deleteAttendance = useDeleteExamAttendance();
  // New (Problem 1 fix): wipes ALL attendance for a class — every subject,
  // every date. Used by the "Delete All Class Attendance" button in the
  // All-Classes Class Overview.
  const deleteClassAttendance = useDeleteClassExamAttendance();

  // ── ROLL NUMBER HANDLERS ────────────────────────────────────────────────
  const toggleClass = useCallback((cls: string) => {
    setSelectedClasses(prev => {
      const next = prev.includes(cls) ? prev.filter(c => c !== cls) : [...prev, cls];
      setClassOrder(ord => {
        const filtered = ord.filter(c => next.includes(c));
        const added = next.filter(c => !filtered.includes(c));
        return [...filtered, ...added];
      });
      return next;
    });
  }, []);

  const moveClass = useCallback((cls: string, dir: "up" | "down") => {
    setClassOrder(prev => {
      const idx = prev.indexOf(cls);
      if (idx === -1) return prev;
      const next = [...prev];
      const swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  // ── CSV roster import ───────────────────────────────────────────────────
  const rosterCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const st of csvRoster) m[st.class] = (m[st.class] ?? 0) + 1;
    return m;
  }, [csvRoster]);

  const handleRosterFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await readRosterFile(file);
      if (res.error) { toast.error(res.error); return; }
      setCsvRoster(res.students);
      const skipped = res.skippedNoName + res.skippedBadClass + res.skippedDuplicate;
      setRosterInfo({ file: file.name, skipped });
      toast.success(`${res.students.length} students imported${skipped ? ` · ${skipped} skipped` : ""}`);
    } catch {
      toast.error("Could not read that file");
    } finally {
      if (rosterInputRef.current) rosterInputRef.current.value = "";
    }
  };

  const downloadRosterTemplate = async () => {
    try { await downloadRosterTemplateXlsx(); }
    catch { toast.error("Could not create the sample file"); }
  };

  const handleGenerate = async () => {
    if (!formTitle.trim()) { toast.error("Enter a session title"); return; }
    if (selectedClasses.length === 0) { toast.error("Select at least one class"); return; }
    if (startingNumber < 100000 || startingNumber > 999999) { toast.error("Starting number must be 6 digits"); return; }
    if (csvRoster.length === 0) { toast.error("Import the students CSV first"); return; }
    const wantedClasses = classOrder.filter(c => selectedClasses.includes(c));
    const missing = wantedClasses.filter(c => !rosterCounts[c]);
    if (missing.length > 0) {
      toast.error(`No students in the CSV for Class ${missing.join(", ")}. Add them or deselect the class.`);
      return;
    }
    setGenerating(true);
    try {
      // Same rules as before: each class sorted by class number, then the
      // classes are interleaved round-robin in the chosen class order.
      const studentsPerClass: Record<string, Student[]> = {};
      for (const st of csvRoster) {
        if (wantedClasses.includes(st.class)) (studentsPerClass[st.class] ||= []).push(st);
      }
      for (const cls of wantedClasses) studentsPerClass[cls] = sortByRollNumber(studentsPerClass[cls] ?? []);
      const orderedStudents: Student[] = interleaveByClassOrder(wantedClasses, studentsPerClass);
      if (orderedStudents.length === 0) { toast.error("No students found for the selected classes"); setGenerating(false); return; }

      const { data: sessionData, error: sessionError } = await supabase.from("exam_roll_sessions").insert({
        title: formTitle.trim(), exam_year: formYear, exam_term: formTerm,
        classes: selectedClasses, class_order: wantedClasses,
        starting_number: startingNumber, is_published: false,
      }).select().single();
      if (sessionError) throw sessionError;

      const rows = orderedStudents.map((s, idx) => ({
        session_id: sessionData.id, student_id: s.id, student_name: s.full_name,
        father_name: s.father_name, class: s.class, class_roll_no: s.roll_number,
        exam_roll_no: String(startingNumber + idx), serial_number: idx + 1,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("exam_roll_numbers").insert(rows.slice(i, i + 100));
        if (error) {
          // Don't leave an empty session behind if the numbers could not be saved.
          await supabase.from("exam_roll_sessions").delete().eq("id", sessionData.id);
          throw error;
        }
      }
      toast.success(`Generated ${rows.length} exam roll numbers!`);
      import("@/lib/confetti").then((m) => m.triggerConfetti("burst")).catch(() => {});
      qc.invalidateQueries({ queryKey: ["exam-sessions"] });
      setSelectedSession(sessionData);
      setView("detail");
    } catch (err) {
      const e = err as { message?: string; code?: string };
      toast.error(
        e.code === "23503"
          ? "Database still links roll numbers to the old students table — run Supabase/Migration/12_exam_roll_csv_roster.sql once, then try again."
          : `Failed: ${e.message ?? "unknown error"}`,
      );
    }
    setGenerating(false);
  };

  const togglePublish = async (session: ExamSession) => {
    // Going live manually → publish NOW and clear any scheduled countdown
    // ("Publish Now" must be instant — no leftover publish_at to gate it).
    // Unpublishing → full reset: hide the slips AND remove the countdown so
    // students never see a timer for something that is taken offline.
    const goingLive = !session.is_published;
    const payload = goingLive
      ? { is_published: true, publish_at: null as string | null }
      : { is_published: false, publish_at: null as string | null, countdown_label: null as string | null };
    const { error } = await supabase.from("exam_roll_sessions").update(payload).eq("id", session.id);
    if (error) { toast.error("Failed"); return; }
    toast.success(goingLive ? "Published — slips are live now!" : "Unpublished");
    if (goingLive) import("@/lib/confetti").then((m) => m.triggerConfetti("burst")).catch(() => {});
    qc.invalidateQueries({ queryKey: ["exam-sessions"] });
    if (selectedSession?.id === session.id) {
      setSelectedSession({
        ...session,
        is_published: goingLive,
        publish_at: null,
        countdown_label: goingLive ? session.countdown_label : null,
      });
    }
  };

  const saveCountdown = async (session: ExamSession) => {
    if (!countdownDate) { toast.error("Pick a date for countdown"); return; }
    setSavingCountdown(true);
    const publishAt = new Date(`${countdownDate}T${countdownTime}:00`).toISOString();
    // THE FIX for the stuck "Publishing now...": publish the session in the
    // SAME update that starts the countdown. The roll-number data is fully
    // prepared and readable the moment the countdown starts, and students'
    // devices flip to the slips instantly when it reaches zero — no waiting,
    // no publish step at countdown end, nothing that can get stuck.
    const { error } = await supabase.from("exam_roll_sessions").update({
      publish_at: publishAt, countdown_label: countdownLabel, is_published: true,
    }).eq("id", session.id);
    setSavingCountdown(false);
    if (error) { toast.error("Failed to save countdown"); return; }
    toast.success("Countdown set — slips go live automatically when it ends");
    qc.invalidateQueries({ queryKey: ["exam-sessions"] });
    if (selectedSession?.id === session.id) {
      setSelectedSession({ ...session, publish_at: publishAt, countdown_label: countdownLabel, is_published: true });
    }
  };

  const clearCountdown = async (session: ExamSession) => {
    // Removing a countdown also unpublishes ONLY the schedule gate — the
    // session stays published (is_published=true) and goes live instantly,
    // since the data was already prepared when the countdown was set.
    const { error } = await supabase.from("exam_roll_sessions").update({ publish_at: null }).eq("id", session.id);
    if (error) { toast.error("Failed"); return; }
    toast.success("Countdown removed — session is live now");
    qc.invalidateQueries({ queryKey: ["exam-sessions"] });
    if (selectedSession?.id === session.id) setSelectedSession({ ...session, publish_at: null });
  };

  const deleteSession = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_roll_sessions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["exam-sessions"] }); if (view === "detail") setView("list"); },
    onError: () => toast.error("Delete failed"),
  });



  // ── Roll No Slips PDF (2 per A4, landscape) ─────────────────────────────
  // Each slip = school header, student info (left) + QR (right), then the
  // student's own class's Exam Date Sheet (pulled from what admin built in
  // "Exam Date Sheet"), then a Deputy Controller signature line + instructions.
  // A4 landscape page is split in half — one slip on the left half, one on
  // the right half — separated by a light cut/fold guide line.
  const downloadPrint = async () => {
    if (!selectedSession || rollNumbers.length === 0) return;

    const genToast = toast.loading("Generating Roll No Slips with date sheet & QR codes...");

    // PERF: the PDF libraries load ONLY now — this click is the first time
    // they are needed (see the import block comment at the top of the file).
    const [{ default: jsPDF }, { default: autoTable }, { default: QRCode }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
      import("qrcode"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = 297;
    const pageH = 210;
    const margin = 6;
    const midGap = 3; // gap either side of the center cut line

    const halfW = (pageW - margin * 2 - midGap * 2) / 2;
    const slipH = pageH - margin * 2;
    const leftX0 = margin;
    const rightX0 = margin + halfW + midGap * 2;

    // Sort by class order (same order as everywhere else in this session)
    const ordered: ExamRollEntry[] = [];
    for (const cls of selectedSession.class_order) {
      const group = rollNumbers.filter(r => r.class === cls).sort((a, b) => a.serial_number - b.serial_number);
      ordered.push(...group);
    }

    // Pre-generate all QR code images — 8 at a time instead of one-by-one.
    // A 300-student print previously waited on 300 SERIAL canvas renders
    // before drawing a single page; small bounded batches keep the UI
    // responsive and cut wall-clock time several-fold.
    const qrImages = new Map<string, string>();
    const QR_BATCH = 8;
    for (let i = 0; i < ordered.length; i += QR_BATCH) {
      const batch = ordered.slice(i, i + QR_BATCH);
      const urls = await Promise.all(batch.map(slip =>
        QRCode.toDataURL(
          encodeExamQRData(selectedSession.id, slip.student_id, slip.exam_roll_no),
          { width: 300, margin: 1, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#FFFFFF" } }
        ).catch(() => "")
      ));
      batch.forEach((slip, k) => { if (urls[k]) qrImages.set(slip.id, urls[k]); });
    }

    // Build each class's paper-by-paper date sheet from the admin-authored
    // Exam Date Sheet (exam_schedule table). Classes 9 & 10 use "Annual-I" /
    // "Annual-II" exam types while 6-8 use "1st/2nd Semester" — these don't
    // match the roll session's single exam_term string, so first try an exact
    // match, and if a class has none, fall back to whatever exam_type that
    // class actually has scheduled for this year.
    const scheduleByClass = new Map<string, ExamScheduleEntry[]>();
    for (const cls of selectedSession.class_order) {
      let rows = allExamSchedule
        .filter(e => e.class === cls && termMatches(e.exam_type, selectedSession.exam_term) && e.year === selectedSession.exam_year)
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      if (rows.length === 0) {
        rows = allExamSchedule
          .filter(e => e.class === cls && e.year === selectedSession.exam_year)
          .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      }
      scheduleByClass.set(cls, rows);
    }

    const drawSlip = (slip: ExamRollEntry, x: number, y: number) => {
      const w = halfW;
      const h = slipH;
      const schedule = scheduleByClass.get(slip.class) || [];
      const padX = 8;
      const cx = x + w / 2;

      // ── Frame: outer + hairline inner border ──
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.6);
      doc.rect(x, y, w, h, "S");
      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.2);
      doc.rect(x + 1.6, y + 1.6, w - 3.2, h - 3.2, "S");

      // ── HEADER ──
      doc.setTextColor(20, 20, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("GOVT. HIGH SCHOOL BABI KHEL", cx, y + 12, { align: "center" });

      doc.setFontSize(10.5);
      doc.setTextColor(60, 60, 60);
      const classExamType = schedule[0]?.exam_type || termForClass(slip.class, selectedSession.exam_term);
      doc.text(`${examTypeLabel(classExamType).toUpperCase()} ${selectedSession.exam_year}`, cx, y + 18.5, { align: "center" });

      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(110, 110, 110);
      doc.text("EXAM  ROLL  NUMBER  SLIP", cx, y + 23.5, { align: "center", charSpace: 0.6 } as any);

      doc.setDrawColor(60, 60, 60);
      doc.setLineWidth(0.7);
      doc.line(x + padX, y + 27, x + w - padX, y + 27);
      doc.setLineWidth(0.2);
      doc.line(x + padX, y + 28.3, x + w - padX, y + 28.3);

      // ── STUDENT INFO (left) + QR (right) ──
      const qrSize = 32;
      const qrBoxX = x + w - padX - qrSize - 2;
      const qrBoxY = y + 33;
      const qrImg = qrImages.get(slip.id);
      const leftX = x + padX;
      const valX = leftX + 30;
      const maxValW = qrBoxX - valX - 4;

      const drawRow = (label: string, value: string, yy: number, big = false) => {
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(115, 115, 115);
        doc.text(label, leftX, yy);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 20, 20);
        doc.setFontSize(big ? 13 : 10.5);
        let v = value;
        while (v.length > 4 && doc.getTextWidth(v) > maxValW) v = v.slice(0, -2);
        if (v !== value) v = v.replace(/\s+$/, "") + "…";
        doc.text(v, valX, yy);
      };
      let rowY = y + 41;
      const rowGap = 8;
      drawRow("Student Name:", slip.student_name, rowY); rowY += rowGap;
      drawRow("Father Name:", slip.father_name || "—", rowY); rowY += rowGap;
      drawRow("Exam Roll No:", slip.exam_roll_no, rowY, true); rowY += rowGap;
      drawRow("Class:", `Class ${slip.class}`, rowY);

      if (qrImg) {
        doc.setDrawColor(150, 150, 150);
        doc.setLineWidth(0.35);
        doc.roundedRect(qrBoxX - 1.5, qrBoxY - 1.5, qrSize + 3, qrSize + 3, 1.5, 1.5, "S");
        doc.addImage(qrImg, "PNG", qrBoxX, qrBoxY, qrSize, qrSize);
      }

      // ── LAYOUT BUDGET ──
      // The slip is 198 mm tall. We size the date-sheet rows from the room that is
      // actually available so the page is filled evenly (no empty block in the middle)
      // whatever number of papers the class has.
      const tableStartY = y + 72;
      const sigY = y + h - 12;
      const instrLines = 6;
      const instrLineH = 5.2;
      const instrH = 7 + instrLines * instrLineH;
      const sigTop = sigY - 9;
      const tableAvail = sigTop - instrH - 6 - tableStartY;
      const nRows = Math.max(schedule.length, 1) + 1;
      const rowMm = Math.min(8.2, Math.max(5, tableAvail / nRows));
      const fontPt = rowMm >= 6.6 ? 8.5 : rowMm >= 5.8 ? 7.8 : 7;
      const cellPad = Math.max(1, (rowMm - fontPt * 0.352 * 1.15) / 2);

      if (schedule.length > 0) {
        autoTable(doc, {
          startY: tableStartY,
          margin: { left: x + padX, right: pageW - (x + w) + padX, bottom: pageH - sigTop },
          tableWidth: w - padX * 2,
          head: [["Paper Date", "Day", "Subject", "From", "To"]],
          body: schedule.map(e => [
            formatDateFns(new Date(e.exam_date), "dd-MM-yyyy"),
            formatDateFns(new Date(e.exam_date), "EEEE"),
            e.subject,
            e.start_time || "—",
            e.end_time || "—",
          ]),
          columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 26 }, 3: { cellWidth: 15 }, 4: { cellWidth: 15 } },
          styles: { fontSize: fontPt, cellPadding: cellPad, textColor: [30, 30, 30], lineColor: [150, 150, 150], lineWidth: 0.2, halign: "center", valign: "middle" },
          headStyles: { fillColor: [228, 228, 228], textColor: [20, 20, 20], fontStyle: "bold", fontSize: fontPt, halign: "center", valign: "middle" },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          theme: "grid",
        });
      } else {
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(150, 150, 150);
        doc.text("Date sheet not yet published for this class.", cx, tableStartY + 12, { align: "center" });
      }

      // ── INSTRUCTIONS — sits under the table, never closer than 6 mm, pushed down
      // when the table is short so the lower half of the slip is balanced. ──
      const tableEndY = (doc as any).lastAutoTable?.finalY ?? (tableStartY + 30);
      const instrStartY = Math.max(tableEndY + 7, sigTop - instrH - 1);
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.25);
      doc.line(x + padX, instrStartY, x + w - padX, instrStartY);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      doc.text("Instructions:", x + padX, instrStartY + 5.5);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(70, 70, 70);
      const instructions = [
        "1. Bring this Roll No Slip to the exam center for every paper.",
        "2. No slip, no entry to the examination hall.",
        "3. Do not bring mobile phones, smart watches, or any electronic device to the exam hall.",
        "4. Do not fold, scratch, or damage the QR code — it must scan cleanly for attendance.",
        "5. Report any errors or omissions on this slip before the exam begins.",
        "6. Reach the exam center at least 30 minutes before the paper starts.",
      ];
      const maxInstrW = w - padX * 2;
      instructions.forEach((line, i) => {
        let t = line;
        while (t.length > 8 && doc.getTextWidth(t) > maxInstrW) t = t.slice(0, -2);
        if (t !== line) t = t.replace(/\s+$/, "") + "…";
        doc.text(t, x + padX, instrStartY + 11 + i * instrLineH);
      });

      // ── SIGNATURE (anchored bottom-right) ──
      doc.setDrawColor(90, 90, 90);
      doc.setLineWidth(0.35);
      doc.line(x + w - padX - 52, sigY, x + w - padX, sigY);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      doc.text("Deputy Controller of Exams", x + w - padX - 26, sigY + 4.2, { align: "center" });
    };

    let slipIdx = 0;
    for (const slip of ordered) {
      const posOnPage = slipIdx % 2;
      if (posOnPage === 0 && slipIdx > 0) doc.addPage("a4", "landscape");
      const sx = posOnPage === 0 ? leftX0 : rightX0;
      drawSlip(slip, sx, margin);

      // Cut/fold guide line down the center of the page
      if (posOnPage === 1) {
        doc.setDrawColor(200, 200, 200);
        // setLineDash exists on jsPDF at runtime but is missing from its .d.ts.
        const dashDoc = doc as unknown as { setLineDash: (dashArray: number[], dashPhase?: number) => void };
        dashDoc.setLineDash([2, 2], 0);
        doc.setLineWidth(0.2);
        doc.line(pageW / 2, margin, pageW / 2, pageH - margin);
        dashDoc.setLineDash([], 0);
      }
      slipIdx++;
    }

    doc.save(`RollNoSlips-${selectedSession.title}-${selectedSession.exam_year}.pdf`);
    toast.dismiss(genToast);
    toast.success(`${ordered.length} Roll No Slips downloaded!`);
  };

  const filteredRolls = useMemo(() => {
    if (!detailSearch) return rollNumbers;
    const q = detailSearch.toLowerCase();
    return rollNumbers.filter(r => r.student_name.toLowerCase().includes(q) || r.exam_roll_no.includes(detailSearch) || r.class_roll_no.includes(detailSearch) || r.class.includes(detailSearch));
  }, [rollNumbers, detailSearch]);

  // ── ATTENDANCE COMPUTED ────────────────────────────────────────────────
  const isInitialized = attendance.length > 0;
  const firstAttRecord = attendance[0];

  // Paper times: in single-class mode, fetch for the one selected subject —
  // and CRITICALLY filter by attClass, so this only ever matches a seating
  // plan that actually covers this class. Without this, two plans running
  // the same day with different end times (e.g. 6th/7th ending 1:35 PM,
  // 8th/9th/10th ending 2 PM) can be mismatched — a class-6 lookup could
  // accidentally pick up the 8/9/10 plan's times (or find no match at all
  // if the subject differs), locking a class whose paper is actually running.
  // In All-Classes mode, fetch for EACH class's selected subject and merge —
  // the window is OPEN if ANY class's paper is in progress.
  const singleClassPaperTimesQuery = usePaperTimesFromSeatingPlan(
    !isAllClassesMode ? attSession : undefined,
    !isAllClassesMode ? attSubject : undefined,
    !isAllClassesMode ? attDate : undefined,
    !isAllClassesMode ? attClass : undefined
  );

  // All-Classes mode: one query per possible class (Rules of Hooks forbid
  // calling hooks in a loop with a dynamic count, so we always call 5 — one
  // per class 6..10). Each query is enabled only if (a) we're in
  // All-Classes mode AND (b) a subject is selected for that class. Unused
  // queries are no-ops. Each is also class-filtered to its own class, same
  // reasoning as above.
  const ALL_POSSIBLE_CLASSES = ["6", "7", "8", "9", "10"];
  // Rules of Hooks: hooks may not be called inside .map()/loops, even with a
  // fixed-length array (the linter cannot prove the call count is stable).
  // Unrolled to five explicit, unconditional calls — byte-for-byte the same
  // runtime behaviour, but statically valid.
  const paperTimesQ6 = usePaperTimesFromSeatingPlan(
    isAllClassesMode && allClassSubjects["6"] ? attSession : undefined,
    isAllClassesMode ? (allClassSubjects["6"] || undefined) : undefined,
    isAllClassesMode ? attDate : undefined,
    isAllClassesMode ? "6" : undefined
  );
  const paperTimesQ7 = usePaperTimesFromSeatingPlan(
    isAllClassesMode && allClassSubjects["7"] ? attSession : undefined,
    isAllClassesMode ? (allClassSubjects["7"] || undefined) : undefined,
    isAllClassesMode ? attDate : undefined,
    isAllClassesMode ? "7" : undefined
  );
  const paperTimesQ8 = usePaperTimesFromSeatingPlan(
    isAllClassesMode && allClassSubjects["8"] ? attSession : undefined,
    isAllClassesMode ? (allClassSubjects["8"] || undefined) : undefined,
    isAllClassesMode ? attDate : undefined,
    isAllClassesMode ? "8" : undefined
  );
  const paperTimesQ9 = usePaperTimesFromSeatingPlan(
    isAllClassesMode && allClassSubjects["9"] ? attSession : undefined,
    isAllClassesMode ? (allClassSubjects["9"] || undefined) : undefined,
    isAllClassesMode ? attDate : undefined,
    isAllClassesMode ? "9" : undefined
  );
  const paperTimesQ10 = usePaperTimesFromSeatingPlan(
    isAllClassesMode && allClassSubjects["10"] ? attSession : undefined,
    isAllClassesMode ? (allClassSubjects["10"] || undefined) : undefined,
    isAllClassesMode ? attDate : undefined,
    isAllClassesMode ? "10" : undefined
  );
  const classPaperTimesQueries = [paperTimesQ6, paperTimesQ7, paperTimesQ8, paperTimesQ9, paperTimesQ10];

  // Index the queries by class for easy lookup.
  const classPaperTimesByClass = useMemo(() => {
    const map: Record<string, { start: string; end: string; planId: string } | null> = {};
    ALL_POSSIBLE_CLASSES.forEach((cls, i) => {
      map[cls] = classPaperTimesQueries[i].data ?? null;
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperTimesQ6.data, paperTimesQ7.data, paperTimesQ8.data, paperTimesQ9.data, paperTimesQ10.data]);

  // Merge: in All-Classes mode, the window is OPEN if ANY class's paper is
  // in progress. We also need paper times for display.
  const seatingPaperTimes = useMemo(() => {
    if (isAllClassesMode) {
      // Find ANY class with paper times set. For display, show the earliest
      // start and latest end across all classes (so the admin sees the full
      // window span).
      const allTimes = Object.values(classPaperTimesByClass)
        .filter((t): t is { start: string; end: string; planId: string } => !!t);
      if (allTimes.length === 0) return null;
      const start = allTimes.reduce((min, t) => t.start < min ? t.start : min, allTimes[0].start);
      const end   = allTimes.reduce((max, t) => t.end   > max ? t.end   : max, allTimes[0].end);
      return { start, end, planId: allTimes[0].planId };
    }
    return singleClassPaperTimesQuery.data ?? null;
  }, [isAllClassesMode, classPaperTimesByClass, singleClassPaperTimesQuery.data]);

  const [attNowTick, setAttNowTick] = useState(() => Date.now());
  const isMobileLayout = useIsMobileLayout();
  useEffect(() => {
    const id = setInterval(() => setAttNowTick(Date.now()), 15 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── DATE-SHEET CROSS-CHECK (lock guard) ──────────────────────────────
  // The Exam Date Sheet is the AUTHORITATIVE source of when a paper is
  // scheduled. A stale or wrongly-created seating plan used to let the
  // admin mark attendance on days when no paper is actually scheduled
  // (e.g. a seating plan with a 12:00-21:00 window for today even
  // though the real paper is tomorrow). We build a per-(class, subject)
  // lookup of the date-sheet rows for the active session's term + year,
  // then feed it into getPaperWindowStatus so the panel is forced
  // "not_today" when no date-sheet row exists for the selection.
  //
  // In single-class mode we look up the (class, subject, date) directly.
  // In All-Classes mode we look up each class's selected subject — the
  // window is OPEN if ANY class has a matching date-sheet row, since the
  // admin can scan students from any class in that mode.
  const attSelectedSession = useMemo(
    () => attSessions.find((s: any) => s.id === attSession) ?? null,
    [attSessions, attSession]
  );

  // ── LOCKED CLASSES (All-Classes mode) ──────────────────────────────
  // The Date Sheet says which classes actually have a paper on the exam date.
  // Classes with none are locked; a class with exactly one paper is auto-selected.
  const todayPapersByClass = useMemo(() => {
    const sess = attSelectedSession as any;
    const out: Record<string, string[]> = {};
    for (const cls of availableClasses) {
      const forClass = allExamSchedule.filter(e => e.class === cls && (!sess || e.year === sess.exam_year));
      const termRows = sess ? forClass.filter(e => termMatches(e.exam_type, sess.exam_term)) : forClass;
      const rows = termRows.length ? termRows : forClass;
      out[cls] = Array.from(new Set(rows.filter(e => String(e.exam_date).slice(0, 10) === attDate).map(e => canonicalSubject(e.subject))));
    }
    return out;
  }, [allExamSchedule, availableClasses, attSelectedSession, attDate]);

  useEffect(() => {
    if (!isAllClassesMode) return;
    setAllClassSubjects(prev => {
      const next: Record<string, string> = {};
      for (const cls of availableClasses) {
        const subs = todayPapersByClass[cls] || [];
        if (subs.length === 1) next[cls] = subs[0];
        else if (subs.length > 1 && subs.includes(prev[cls])) next[cls] = prev[cls];
      }
      const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every(k => prev[k] === next[k]);
      return same ? prev : next;
    });
  }, [isAllClassesMode, todayPapersByClass, availableClasses]);

  // (previous dateSheetLookup computation removed — see note above; the
  // constant `dateSheetLookup = null` above is now the single definition)

  // ── DATE SHEET DISCONNECTED (per request) ────────────────────────────
  // Attendance no longer looks at the Exam Date Sheet at all. It relies
  // solely on the Seating Plan's live paper times (seatingPaperTimes,
  // fetched below) — the same source AdminExamConsole/3D Hall key off —
  // so Attendance can never disagree with what Console shows as live.
  const dateSheetLookup: DateSheetLookup | null = null;

  // ── PER-CLASS PAPER WINDOWS ───────────────────────────────────────────
  // Each class has its OWN paper time today (e.g. Class 6 & 7 09:00–12:00,
  // Class 8 12:00–00:00). Attendance for a student is allowed ONLY inside THEIR
  // class's window. The old code merged all classes into one window
  // (earliest start → latest end), so Class 8 could be scanned at 10:30 while
  // its paper starts at 12:00.
  //
  // PERF: the offline fallback ("first attendance row that carries this
  // class's saved paper times") used to be a linear .find() INSIDE
  // classTimesFor — and classTimesFor runs per student per render, making
  // every 15 s tick O(students × attendance rows). The map below is built
  // once per attendance change instead.
  const offlineClassTimes = useMemo(() => {
    const m = new Map<string, { start: string; end: string }>();
    for (const r of attendanceFromServer) {
      if (r.paper_start_time && r.paper_end_time && !m.has(r.class)) {
        m.set(r.class, { start: r.paper_start_time, end: r.paper_end_time });
      }
    }
    return m;
  }, [attendanceFromServer]);

  const classTimesFor = (cls: string): { start: string; end: string } | null => {
    const plan = isAllClassesMode
      ? classPaperTimesByClass[cls]
      : (cls === attClass ? seatingPaperTimes : classPaperTimesByClass[cls]);
    if (plan) return { start: plan.start, end: plan.end };
    // Offline / not loaded yet → snapshot saved on that class's attendance rows.
    return offlineClassTimes.get(cls) ?? null;
  };
  const getClassWindow = (cls: string): { status: PaperWindowStatus; start: string | null; end: string | null } => {
    const t = classTimesFor(cls);
    return {
      status: getPaperWindowStatus(attDate, t?.start, t?.end, null, new Date(attNowTick), null),
      start: t?.start ? t.start.slice(0, 5) : null,
      end: t?.end ? t.end.slice(0, 5) : null,
    };
  };
  const classWindowBlockMessage = (cls: string): string | null => {
    const w = getClassWindow(cls);
    return canMarkExamAttendance(w.status) ? null : `Class ${cls}: ${paperWindowMessage(w.status, w.start, w.end)}`;
  };

  // Panel-level status: in All-Classes mode it is OPEN when ANY selected class is live.
  const attWindowStatus: PaperWindowStatus = (() => {
    if (isAllClassesMode) {
      const sts = availableClasses.filter((c: string) => !!allClassSubjects[c]).map((c: string) => getClassWindow(c).status);
      for (const want of ["in_progress", "not_started", "ended", "no_paper_times"] as PaperWindowStatus[]) {
        if (sts.includes(want)) return want;
      }
      return "not_today";
    }
    return getPaperWindowStatus(
      attDate, firstAttRecord?.paper_start_time, firstAttRecord?.paper_end_time,
      seatingPaperTimes, new Date(attNowTick), dateSheetLookup
    );
  })();
  const canMarkAtt = canMarkExamAttendance(attWindowStatus);
  // Display priority: row-snapshot times > seating plan times (Date Sheet
  // is no longer consulted here).
  const attDisplayPaperStart = firstAttRecord?.paper_start_time || seatingPaperTimes?.start || null;
  const attDisplayPaperEnd = firstAttRecord?.paper_end_time || seatingPaperTimes?.end || null;

  // ── PENDING vs ABSENT ────────────────────────────────────────────────
  // Initialize stores every student as "absent" in the DB, but that must NOT be
  // SHOWN as Absent while the paper is still running — nobody has been marked
  // yet. A row nobody touched (status absent + scanned_at null) is "Pending"
  // until the paper window ends, then it becomes a real Absent automatically
  // (re-evaluated every 15 s by attNowTick). Display-only: no DB change.
  const isRowFinal = (r: { exam_date: string; class: string; paper_start_time?: string | null; paper_end_time?: string | null }): boolean => {
    const d = String(r.exam_date).slice(0, 10);
    const today = formatLocalDate(new Date(attNowTick));
    if (d < today) return true;
    if (d > today) return false;
    const t = (d === attDate ? classTimesFor(r.class) : null)
      ?? (r.paper_start_time && r.paper_end_time ? { start: r.paper_start_time, end: r.paper_end_time } : null);
    if (!t) return false;
    return getPaperWindowStatus(d, t.start, t.end, null, new Date(attNowTick), null) === "ended";
  };
  const displayStatusOf = (r: ExamAttendanceRecord | null | undefined, fallbackClass?: string): ExamAttDisplayStatus => {
    if (!r) {
      // No row at all: never "absent" while the class paper is still running.
      const cls = fallbackClass || attClass;
      const w = cls && cls !== "all" ? getClassWindow(cls) : null;
      const finished = !!w && (w.status === "ended" || (w.status === "not_today" && attDate < formatLocalDate(new Date(attNowTick))));
      return finished ? "absent" : "pending";
    }
    return displayAttStatus(r, isRowFinal(r));
  };

  const attMap = useMemo(() => {
    const map = new Map<string, ExamAttendanceRecord>();
    attendance.forEach(r => map.set(r.student_id, r));
    return map;
  }, [attendance]);

  const mergedList = useMemo(() => {
    return attRollNumbers.map(r => {
      const rec = attMap.get(r.student_id) || null;
      return {
        ...r,
        attRecord: rec,
        status: displayStatusOf(rec, r.class),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attRollNumbers, attMap, attNowTick, attDate, attClass, seatingPaperTimes, classPaperTimesByClass]);

  // PERF: memoised search filter — previously re-filtered the whole roster on
  // EVERY keystroke AND every 15 s tick even when the search box was untouched.
  const attFiltered = useMemo(() => {
    if (!attSearch) return mergedList;
    const q = attSearch.toLowerCase();
    return mergedList.filter(s => s.student_name.toLowerCase().includes(q) || s.exam_roll_no.includes(attSearch) || s.class_roll_no.includes(attSearch));
  }, [mergedList, attSearch]);

  const attStats = useMemo(() => {
    let present = 0, absent = 0, leave = 0, pending = 0;
    for (const r of attendance) {
      const st = displayAttStatus(r, isRowFinal(r));
      if (st === "present") present++;
      else if (st === "leave") leave++;
      else if (st === "pending") pending++;
      else absent++;
    }
    return { present, absent, leave, pending, total: attendance.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendance, attNowTick, attDate, seatingPaperTimes, classPaperTimesByClass]);

  const overviewPivot = useMemo(() => {
    if (!overviewData.length) return { students: [], columns: [] as { key: string; subject: string; date: string }[], grid: {} as Record<string, Record<string, Status>> };
    // ── SUBJECT-ONLY GROUPING (rev. 12 — Problem 2 fix) ─────────────────────
    // Previously columns were keyed by `${subject}__${normalizedDate}`, which
    // meant re-initializing the same subject on a different date created a
    // SECOND column ("Mathematics 2026-07-05" + "Mathematics 2026-07-06").
    // The screenshot showed "Mathematics" appearing twice in Class 6's
    // overview — exactly this bug.
    //
    // Fix: key columns by SUBJECT ONLY. For each (student, subject), keep
    // the row with the LATEST timestamp (scanned_at || created_at) so the
    // displayed status reflects the most recent attendance taken. The
    // column header shows the subject name + the LATEST date any student
    // has for that subject, so the admin can still see "this paper was
    // last taken on date X".
    //
    // Combined with useInitExamAttendance now REPLACING (not appending)
    // rows for the same subject, this guarantees one column per subject
    // forever — no more "Mathematics twice".
    const normalizeDate = (raw: string | null | undefined): string => {
      if (!raw) return "—";
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.slice(0, 10);
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
      return s;
    };

    // Column key = SUBJECT ONLY (no date). One column per subject.
    // Track the latest date per subject for display in the header.
    const subjectLatestDate = new Map<string, string>(); // subject -> latest normalized date
    overviewData.forEach(r => {
      const normDate = normalizeDate(r.exam_date);
      const prev = subjectLatestDate.get(r.subject);
      if (!prev || normDate > prev) subjectLatestDate.set(r.subject, normDate);
    });
    const columnMap = new Map<string, { key: string; subject: string; date: string }>();
    overviewData.forEach(r => {
      if (!columnMap.has(r.subject)) {
        columnMap.set(r.subject, {
          key: r.subject,
          subject: r.subject,
          date: subjectLatestDate.get(r.subject) ?? "—",
        });
      }
    });
    const columns = Array.from(columnMap.values()).sort((a, b) => a.subject.localeCompare(b.subject));

    const studentMap = new Map<string, { name: string; rollNo: string; examRoll: string; cls: string }>();
    overviewData.forEach(r => {
      if (!studentMap.has(r.student_id)) {
        studentMap.set(r.student_id, { name: r.student_name, rollNo: r.class_roll_no, examRoll: r.exam_roll_no, cls: r.class });
      }
    });
    const students = Array.from(studentMap.entries()).map(([id, info]) => ({ id, ...info }));

    // GRID: for each (student, subject) keep the row with the LATEST
    // timestamp (scanned_at || created_at). This collapses any duplicate
    // rows for the same student+subject (whether from pre-migration
    // duplicates, different exam_date string formats, or different real
    // dates) into ONE cell showing the most recent status.
    const cellKeep = new Map<string, { status: Status; scanned_at: string | null; created_at?: string; examDate: string; pending: boolean }>();
    overviewData.forEach(r => {
      const key = `${r.student_id}__${r.subject}`;
      const prev = cellKeep.get(key);
      // Untouched init row of a paper that has not finished yet = Pending, not Absent.
      const cur = { status: r.status, scanned_at: r.scanned_at, created_at: r.created_at, examDate: r.exam_date, pending: isUnmarkedRow(r) && !isRowFinal(r) };
      if (!prev) { cellKeep.set(key, cur); return; }
      const aTs = cur.scanned_at || cur.created_at || "";
      const bTs = prev.scanned_at || prev.created_at || "";
      const keep = aTs >= bTs ? cur : prev;
      cellKeep.set(key, keep);
    });
    const grid: Record<string, Record<string, Status>> = {};
    cellKeep.forEach((val, key) => {
      const parts = key.split("__");
      const studentId = parts[0];
      const subject = parts.slice(1).join("__"); // safe even if subject has __
      if (!grid[studentId]) grid[studentId] = {};
      if (val.pending) return; // shown as "—" until the paper ends
      grid[studentId][subject] = val.status;
    });
    return { students, columns, grid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewData, attNowTick, attDate, seatingPaperTimes, classPaperTimesByClass]);

  // In All-Classes mode, break the flat pivot into one section per class so
  // each class gets its own table + its own downloadable PDF (papers differ
  // per class, so a single shared table across classes wouldn't make sense).
  const overviewByClass = useMemo(() => {
    if (!isAllClassesMode) return [];
    const classes = Array.from(new Set(overviewPivot.students.map(s => s.cls))).sort();
    return classes.map(cls => {
      const students = overviewPivot.students.filter(s => s.cls === cls);
      const studentIds = new Set(students.map(s => s.id));
      const columns = overviewPivot.columns.filter(col =>
        students.some(s => overviewPivot.grid[s.id]?.[col.key] !== undefined)
      );
      const grid: Record<string, Record<string, Status>> = {};
      studentIds.forEach(id => { grid[id] = overviewPivot.grid[id] || {}; });
      return { cls, students, columns, grid };
    });
  }, [isAllClassesMode, overviewPivot]);

  // ── ATTENDANCE HANDLERS ────────────────────────────────────────────────
  // Helper: get the subject for a given student's class. In single-class
  // mode, it's just attSubject. In All-Classes mode, it's looked up from
  // the allClassSubjects map. Returns null if no subject is selected for
  // the student's class (the caller should error out in that case).
  const getSubjectForClass = (cls: string): string | null => {
    if (isAllClassesMode) {
      return allClassSubjects[cls] || null;
    }
    return attSubject || null;
  };

  const handleInitSheet = () => {
    if (!attSession || !attDate) {
      toast.error("Select session and date first"); return;
    }
    if (attRollNumbers.length === 0) { toast.error("No students found"); return; }
    if (!canMarkAtt) {
      toast.error(paperWindowMessage(attWindowStatus, attDisplayPaperStart, attDisplayPaperEnd));
      return;
    }
    if (isAllClassesMode) {
      // In All-Classes mode, init attendance for EACH class that has a
      // subject selected. We group students by class and call init once
      // per class with that class's selected subject.
      //
      // IMPORTANT: these run sequentially (awaited) rather than fired in
      // parallel via .mutate(). Firing them all at once meant only the
      // last mutation's completion was reliably reflected before the
      // screen re-rendered, so classes initialized earlier in the loop
      // could still show "No Attendance Sheet Yet" / 0-0-0 even though
      // their rows were actually inserted.
      const byClass: Record<string, typeof attRollNumbers> = {};
      attRollNumbers.forEach(r => {
        if (!byClass[r.class]) byClass[r.class] = [];
        byClass[r.class].push(r);
      });
      const classesToInit = Object.keys(byClass).filter(cls => allClassSubjects[cls]);
      if (classesToInit.length === 0) {
        toast.error("Select a subject for at least one class first");
        return;
      }
      // Safeguard: warn if any class+subject about to be initialized
      // already has attendance recorded on a DIFFERENT date. With the new
      // useInitExamAttendance behavior (rev. 12), re-initializing REPLACES
      // the old attendance (deletes old-date rows, inserts today's rows)
      // so the Class Overview never shows duplicate subject columns. This
      // warning is now informational — it tells the admin "your old
      // attendance on date X will be replaced with today's fresh sheet".
      const conflicts = classesToInit
        .map(cls => ({ cls, subject: allClassSubjects[cls], dates: findConflictingDates(cls, allClassSubjects[cls]) }))
        .filter(c => c.dates.length > 0);
      if (conflicts.length > 0) {
        const lines = conflicts.map(c => `Class ${c.cls} · ${c.subject}: existing attendance on ${c.dates.join(", ")} will be REPLACED with today's fresh sheet`).join("\n");
        const ok = window.confirm(
          `Re-initializing will REPLACE the existing attendance for these papers with a fresh "all absent" sheet dated ${attDate}:\n\n${lines}\n\n` +
          `Old attendance statuses (present/absent/leave) will be LOST. Continue?`
        );
        if (!ok) return;
      }
      setInitBusy(true);
      (async () => {
        try {
        // PARALLEL init — each class's init is an independent DB write with
        // no ordering dependency on the others, so firing them all at once
        // (Promise.allSettled) is safe and turns an N-class × ~1s sequential
        // wait into a single ~1s parallel wait. The earlier sequential
        // approach was working around stale re-renders, not a correctness
        // requirement — allSettled resolves all of them together before we
        // touch the UI at all, so there's no "class A shows done, class B
        // still pending" flicker either.
        const results = await Promise.allSettled(
          classesToInit.map(cls => {
            const subj = allClassSubjects[cls];
            const students = byClass[cls];
            const pt = classPaperTimesByClass[cls];
            return initAttendance.mutateAsync({
              sessionId: attSession, cls, subject: subj, examDate: attDate,
              planTimes: pt ? { start: pt.start, end: pt.end } : null,
              silent: true,
              students: students.map(r => ({
                student_id: r.student_id, student_name: r.student_name,
                class_roll_no: r.class_roll_no, exam_roll_no: r.exam_roll_no,
              })),
            }).then(() => ({ cls, count: students.length }));
          })
        );
        let initedCount = 0;
        const failed: string[] = [];
        results.forEach((r, i) => {
          if (r.status === "fulfilled") initedCount += r.value.count;
          else failed.push(`Class ${classesToInit[i]}`);
        });
        if (initedCount === 0 && failed.length === classesToInit.length) {
          toast.error("Attendance could not be initialized for any class");
        } else if (failed.length > 0) {
          toast.error(`Initialized, but failed for: ${failed.join(", ")}`);
        } else {
          toast.success(`Attendance initialized for ${classesToInit.length} class${classesToInit.length > 1 ? "es" : ""}`);
        }
        } finally {
          setInitBusy(false);
        }
      })();
      return;
    }
    // Single-class mode
    if (!attClass || !attSubject) {
      toast.error("Select session, class, subject, and date first"); return;
    }
    {
      const conflictDates = findConflictingDates(attClass, attSubject);
      if (conflictDates.length > 0) {
        const ok = window.confirm(
          `Class ${attClass} · ${attSubject} already has attendance on ${conflictDates.join(", ")}. ` +
          `Re-initializing will REPLACE that attendance with a fresh "all absent" sheet dated ${attDate}. ` +
          `Old attendance statuses will be LOST. Continue?`
        );
        if (!ok) return;
      }
    }
    initAttendance.mutate({
      sessionId: attSession, cls: attClass, subject: attSubject, examDate: attDate,
      planTimes: seatingPaperTimes ? { start: seatingPaperTimes.start, end: seatingPaperTimes.end } : null,
      students: attRollNumbers.map(r => ({
        student_id: r.student_id, student_name: r.student_name,
        class_roll_no: r.class_roll_no, exam_roll_no: r.exam_roll_no,
      })),
    });
  };

  const handleStatusChange = (record: ExamAttendanceRecord, newStatus: Status) => {
    const blockedMsg = classWindowBlockMessage(record.class);
    if (blockedMsg) { toast.error(blockedMsg); return; }
    // Use the record's OWN subject (not the dropdown subject) — this is
    // critical in All-Classes mode where each class has a different subject,
    // and also correct in single-class mode (record.subject === attSubject).
    updateAttendance.mutate({
      id: record.id!, status: newStatus,
      sessionId: attSession, cls: record.class, subject: record.subject, examDate: attDate,
      planTimes: classTimesFor(record.class),
    });
  };

  const handleDeleteSheet = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    if (isAllClassesMode) {
      // Delete attendance for ALL classes + their selected subjects
      for (const cls of availableClasses) {
        const subj = allClassSubjects[cls];
        if (!subj) continue;
        deleteAttendance.mutate({
          sessionId: attSession, cls, subject: subj, examDate: attDate,
        });
      }
      setConfirmDelete(false);
      return;
    }
    if (!attClass || !attSubject) return;
    deleteAttendance.mutate({
      sessionId: attSession, cls: attClass, subject: attSubject, examDate: attDate,
    }, { onSettled: () => setConfirmDelete(false) });
  };

  // Scan handlers
  const rollMap = useMemo(() => {
    const map = new Map<string, typeof attRollNumbers[0]>();
    attRollNumbers.forEach(r => map.set(r.exam_roll_no, r));
    return map;
  }, [attRollNumbers]);

  // ── CROSS-CLASS SCAN HANDLERS (rev. 11) ───────────────────────────────
  // Works in BOTH single-class mode and All-Classes mode. The key insight:
  //   - In single-class mode: the subject comes from the attSubject dropdown.
  //   - In All-Classes mode: the subject comes from the student's class —
  //     looked up in allClassSubjects. So a class-7 student scanned in
  //     All-Classes mode gets attendance saved with class-7's selected
  //     subject (e.g. "English"), while a class-8 student scanned in the
  //     same session gets attendance saved with class-8's selected subject
  //     (e.g. "Mathematics").
  //
  // Two QR formats are supported:
  //   {t:"exam", sid, stid, rn}          — legacy admit-card QR (no seat)
  //   {t:"seat", pid, rid, sl, stid, rn} — desk QR (carries seat/room)

  // ═══════════════════════════════════════════════════════════════════════
  //  OFFLINE-FIRST SCAN PIPELINE
  //  scan → validate QR → resolve student from the cached roster (0 network)
  //       → instant confirm card → Confirm writes ONE durable outbox record
  //       → background worker batches it to Supabase (retry / back-off).
  //  Works on slow 2G/3G and with no internet at all. See
  //  lib/examAttendanceOutbox.ts for the engine.
  // ═══════════════════════════════════════════════════════════════════════
  const scannerIdRef = useRef<string | null>(null);
  useEffect(() => { void getScannerId().then(id => { scannerIdRef.current = id; }); }, []);

  const handleQRScan = async (qrData: string) => {
    if (scanLockRef.current) return; // card open / lookup running — ignore
    const lc = lastClosedRef.current;
    if (lc && lc.qr === qrData && Date.now() - lc.t < SAME_CODE_LOCKOUT_MS) return;
    scanLockRef.current = true;
    let keepLock = false;
    try {
      keepLock = !!(await resolveScanPreview(qrData));
    } finally {
      // The lock stays ONLY while the confirm card is showing.
      if (!keepLock) releaseScanLock(qrData);
    }
  };

  const subjectMissingMessage = (cls: string) =>
    isAllClassesMode && (todayPapersByClass[cls]?.length ?? 0) === 0
      ? `Class ${cls} has no paper on ${attDate} (Date Sheet) — locked.`
      : `No subject selected for Class ${cls}. Pick a subject in the ${isAllClassesMode ? "All-Classes" : "subject"} panel first.`;

  const studentNotFoundMessage = () =>
    roster.ready || attRollNumbers.length > 0
      ? "Student not found in this exam session"
      : "Student list isn't downloaded yet — connect to the internet once, then scan again.";

  /** Opens the confirm card. Returns true when the card is showing. */
  const resolveScanPreview = async (qrData: string): Promise<boolean | void> => {
    // 1. Strict QR validation (format + size). Identity is NEVER read from the QR.
    const parsedQr = parseExamQr(qrData);
    if (!parsedQr.ok || !parsedQr.qr) { toast.error(parsedQr.reason ?? "Invalid QR code"); return; }
    const qr = parsedQr.qr;

    let wantStudentId = qr.studentId;
    let warning: string | null = null;
    let seatId: string | null = null;

    if (qr.kind === "seat") {
      // Stale-sticker rule: the student CURRENTLY assigned to that desk wins
      // over the id printed on an old sticker. Desk assignments are cached;
      // only the first desk scan of a plan may touch the network (capped 2.5 s).
      let seats = getCachedSeatAssignments(qr.planId!);
      if (!seats) {
        try {
          seats = await Promise.race([
            getSeatAssignments(qr.planId!),
            new Promise<null>(res => setTimeout(() => res(null), 2500)),
          ]);
        } catch { seats = null; }
      }
      if (seats) {
        const hit = seats.find(x => x.room_id === qr.roomId && x.seat_label === qr.seatLabel);
        if (hit) {
          seatId = hit.id;
          if (hit.student_id !== qr.studentId) {
            wantStudentId = hit.student_id;
            warning = "This desk sticker is old — showing the student currently seated here.";
          }
        } else {
          warning = "This desk isn't in the seating plan — verify the student carefully.";
        }
      }
    } else if (qr.sessionId && attSession && qr.sessionId !== attSession) {
      warning = "This QR was printed for a different exam session — verify the student carefully.";
    }

    // 2. Resolve from the cached roster (memory) — zero network.
    const student =
      roster.byStudentId.get(wantStudentId)
      ?? roster.byExamRoll.get(qr.examRollNo)
      ?? attRollNumbers.find(r => r.student_id === wantStudentId)
      ?? attRollNumbers.find(r => r.exam_roll_no === qr.examRollNo);
    if (!student) { toast.error(studentNotFoundMessage()); return; }

    const subj = getSubjectForClass(student.class);
    if (!subj) { toast.error(subjectMissingMessage(student.class)); return; }
    // This student's OWN class window must be open (not the merged panel window).
    const blocked = classWindowBlockMessage(student.class);
    if (blocked) { toast.error(blocked); return; }
    if (!isAllClassesMode && student.class !== attClass) {
      toast(`Cross-class scan: student is in Class ${student.class}, not Class ${attClass}. Saving to Class ${student.class}.`, { icon: "ℹ️" });
    }

    const alreadyPresent =
      attMap.get(student.student_id)?.status === "present"
      || outbox.has(makeAttendanceKey(attSession, student.student_id, subj, attDate));

    setScanPreview({
      studentId: student.student_id,
      studentName: student.student_name,
      class: student.class,
      classRollNo: String(student.class_roll_no),
      examRollNo: student.exam_roll_no,
      subject: subj,
      seatLabel: qr.kind === "seat" ? qr.seatLabel : null,
      planId: qr.kind === "seat" ? qr.planId : null,
      roomId: qr.kind === "seat" ? qr.roomId : null,
      seatId,
      alreadyPresent,
      warning,
      qrData,
      scanId: `${qrData.slice(0, 20)}_${Date.now()}`,
    });
    return true; // sticky card: lock kept until Confirm / ✕
  };

  /** The ONLY place attendance is recorded. Local, synchronous, durable. */
  const markPresentLocal = async (
    student: { student_id: string; student_name: string; class_roll_no: string | number; exam_roll_no: string; class: string },
    subject: string,
    seat?: { planId?: string | null; roomId?: string | null; seatLabel?: string | null; seatId?: string | null },
  ): Promise<"queued" | "already" | "blocked"> => {
    // Re-check at the moment of saving (the card may have been open a while).
    const blockedMsg = classWindowBlockMessage(student.class);
    if (blockedMsg) { toast.error(blockedMsg); return "blocked"; }
    const key = makeAttendanceKey(attSession, student.student_id, subject, attDate);
    if (outbox.has(key) || attMap.get(student.student_id)?.status === "present") {
      toast(`${student.student_name} already marked Present`, { icon: "ℹ️" });
      return "already";
    }
    const scannedBy = scannerIdRef.current ?? (await getScannerId());
    // Paper times: only stamped when unambiguous (single-class view of the
    // selected class). Rows created by "Initialize" already carry them and an
    // upsert never overwrites columns it doesn't send.
    const stampTimes = !isAllClassesMode && student.class === attClass
      && /^\d{2}:\d{2}/.test(attDisplayPaperStart ?? "") && /^\d{2}:\d{2}/.test(attDisplayPaperEnd ?? "");
    enqueueAttendance({
      sessionId: attSession,
      studentId: student.student_id,
      studentName: student.student_name,
      class: student.class,
      classRollNo: String(student.class_roll_no),
      examRollNo: student.exam_roll_no,
      subject,
      examDate: attDate,
      scannedAt: new Date().toISOString(),
      scannedBy,
      planId: seat?.planId ?? null,
      roomId: seat?.roomId ?? null,
      seatLabel: seat?.seatLabel ?? null,
      seatId: seat?.seatId ?? null,
      paperStart: stampTimes ? attDisplayPaperStart!.slice(0, 5) : null,
      paperEnd: stampTimes ? attDisplayPaperEnd!.slice(0, 5) : null,
    });
    toast.success(`${student.student_name} · Class ${student.class} · ${subject} marked Present${navigator.onLine ? "" : " (saved on this device)"}`);
    setScanLog(prev => [
      { name: student.student_name, roll: student.exam_roll_no, time: new Date().toLocaleTimeString(), status: "present" },
      ...prev,
    ]);
    return "queued";
  };

  const confirmScanNow = () => {
    if (!scanPreview) return;
    const p = scanPreview;
    setScanPreview(null);
    releaseScanLock(p.qrData);
    void markPresentLocal(
      { student_id: p.studentId, student_name: p.studentName, class_roll_no: p.classRollNo, exam_roll_no: p.examRollNo, class: p.class },
      p.subject!,
      { planId: p.planId, roomId: p.roomId, seatLabel: p.seatLabel, seatId: p.seatId },
    );
  };

  const cancelScanPreview = () => {
    if (!scanPreview) return;
    const { qrData } = scanPreview;
    setScanPreview(null);
    releaseScanLock(qrData);
  };

  const handleManualRoll = async () => {
    const roll = manualRoll.trim();
    if (!roll) return;
    const student = roster.byExamRoll.get(roll) ?? rollMap.get(roll);
    if (!student) {
      toast.error(roster.ready || attRollNumbers.length > 0
        ? `Roll number ${roll} not found in this exam session`
        : "Student list isn't downloaded yet — connect to the internet once, then try again.");
      return;
    }
    const subj = getSubjectForClass(student.class);
    if (!subj) { toast.error(subjectMissingMessage(student.class)); return; }
    if (!isAllClassesMode && student.class !== attClass) {
      toast(`Cross-class entry: student is in Class ${student.class}, not Class ${attClass}. Saving to Class ${student.class}.`, { icon: "ℹ️" });
    }
    const outcome = await markPresentLocal(student, subj);
    if (outcome !== "blocked") setManualRoll("");
  };


  // ── EXPORT ATTENDANCE PDF ───────────────────────────────────────────────
  const exportAttendancePDF = async () => {
    if (!attendance.length) { toast.error("No data to export"); return; }
    let jsPDF: typeof import("jspdf")["default"], autoTable: typeof import("jspdf-autotable")["default"];
    try {
      ([{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]));
    } catch { toast.error("Could not load the PDF library — check your connection"); return; }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const w = doc.internal.pageSize.getWidth();
    const sessionTitle = (attSelectedSession as any)?.title || "";
    let y = pdfBrandHeader(doc, "EXAM ATTENDANCE REPORT", sessionTitle);

    const total = attStats.total || attendance.length;
    const pct = total ? Math.round((attStats.present / total) * 100) : 0;
    // Class / Subject / Date strip
    doc.setDrawColor(...PDF_LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(12, y, w - 24, 14, 2, 2, "S");
    const meta: [string, string][] = [["CLASS", `Class ${attClass}`], ["SUBJECT", attSubject], ["DATE", attDate]];
    const mw = (w - 24) / meta.length;
    meta.forEach(([k, v], i) => {
      const cx = 12 + i * mw + mw / 2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(...PDF_MUTED);
      doc.text(k, cx, y + 5, { align: "center", charSpace: 0.3 } as any);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...PDF_INK);
      doc.text(v || "—", cx, y + 10.8, { align: "center" });
    });
    y += 14 + 4;

    y = pdfSummaryTiles(doc, y, [
      { label: "Total", value: String(total) },
      { label: "Present", value: String(attStats.present) },
      { label: "Absent", value: String(attStats.absent) },
      ...(attStats.pending > 0 ? [{ label: "Pending", value: String(attStats.pending) }] : []),
      { label: "Leave", value: String(attStats.leave) },
      { label: "Attendance", value: `${pct}%` },
    ]);

    const tableBody = attendance.map((r, idx) => [
      String(idx + 1), r.class_roll_no, r.exam_roll_no, r.student_name,
      (() => {
        const st = displayAttStatus(r, isRowFinal(r));
        return st === "present" ? "Present" : st === "absent" ? "Absent" : st === "pending" ? "Pending" : "Leave";
      })(),
      r.scanned_at ? formatDateFns(new Date(r.scanned_at), "hh:mm a") : "Manual",
    ]);

    autoTable(doc, {
      startY: y,
      head: [["#", "Class Roll", "Exam Roll", "Student Name", "Status", "Marked At"]],
      body: tableBody,
      theme: "grid",
      styles: { fontSize: 9.5, cellPadding: 2.8, valign: "middle", textColor: PDF_INK, lineColor: PDF_LINE, lineWidth: 0.25, overflow: "linebreak" },
      headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8.5, halign: "center", cellPadding: 3.2 },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: 24, halign: "center" },
        2: { cellWidth: 28, halign: "center", fontStyle: "bold" },
        3: { halign: "left" },
        4: { cellWidth: 24, halign: "center", fontStyle: "bold" },
        5: { cellWidth: 26, halign: "center", textColor: [90, 90, 90] },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: 12, right: 12, top: 14, bottom: 18 },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 4) {
          const v = String(d.cell.raw);
          if (v === "Absent") d.cell.styles.fontStyle = "bold";
          else if (v === "Leave") d.cell.styles.fontStyle = "italic";
        }
      },
    });

    pdfSignatures(doc, (doc as any).lastAutoTable?.finalY ?? y, ["Class Teacher", "Exam Controller", "Principal"]);
    pdfFooters(doc, "Exam Attendance Report");
    doc.save(`ExamAttendance-Class${attClass}-${safeFile(attSubject)}-${attDate}.pdf`);
    toast.success("Attendance PDF exported!");
  };

  // ── EXPORT CLASS OVERVIEW PDF ───────────────────────────────────────────
  // Subject x student grid for one class. Papers are ordered by exam date,
  // every cell is colour-coded (P / A / L), and each student gets a
  // Present / Absent / Attendance-% summary so the report is usable as-is.
  const exportOverviewPDF = async (
    scopedClass?: string,
    scopedPivot?: { students: typeof overviewPivot.students; columns: typeof overviewPivot.columns; grid: typeof overviewPivot.grid }
  ) => {
    const pivot = scopedPivot ?? overviewPivot;
    const clsLabel = typeof scopedClass === "string" ? scopedClass : attClass;
    if (!pivot.students.length) { toast.error("No data to export"); return; }
    let jsPDF: typeof import("jspdf")["default"], autoTable: typeof import("jspdf-autotable")["default"];
    try {
      ([{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]));
    } catch { toast.error("Could not load the PDF library — check your connection"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const w = doc.internal.pageSize.getWidth();
    const sessionTitle = (attSelectedSession as any)?.title || "";
    const termLabel = (attSelectedSession as any)?.exam_term
      ? `${sessionTermLabel((attSelectedSession as any).exam_term)} ${(attSelectedSession as any).exam_year ?? ""}`.trim()
      : "";
    let y = pdfBrandHeader(doc, `CLASS ${clsLabel} — EXAM ATTENDANCE OVERVIEW`, [sessionTitle, termLabel].filter(Boolean).join("  ·  "));

    // Order papers by date (then name) — the grid reads like the date sheet.
    const columns = [...pivot.columns].sort((a, b) => (a.date === b.date ? a.subject.localeCompare(b.subject) : a.date.localeCompare(b.date)));
    const fmtShort = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDateFns(new Date(d + "T00:00:00"), "dd MMM") : d);

    const rows = pivot.students.map((st, idx) => {
      const sts = pivot.grid[st.id] || {};
      const present = columns.filter(c => sts[c.key] === "present").length;
      const absent = columns.filter(c => sts[c.key] === "absent").length;
      const leave = columns.filter(c => sts[c.key] === "leave").length;
      const marked = present + absent + leave;
      const pct = marked ? Math.round((present / marked) * 100) : 0;
      return { idx, st, sts, present, absent, leave, pct, marked };
    });
    const totalPresent = rows.reduce((a, r) => a + r.present, 0);
    const totalAbsent = rows.reduce((a, r) => a + r.absent, 0);
    const totalMarked = rows.reduce((a, r) => a + r.marked, 0);
    const avg = totalMarked ? Math.round((totalPresent / totalMarked) * 100) : 0;

    y = pdfSummaryTiles(doc, y, [
      { label: "Students", value: String(rows.length) },
      { label: "Papers", value: String(columns.length) },
      { label: "Present marks", value: String(totalPresent) },
      { label: "Absent marks", value: String(totalAbsent) },
      { label: "Avg attendance", value: `${avg}%` },
    ]);

    const head = [["#", "Exam Roll", "Student Name", ...columns.map(c => `${c.subject}\n${fmtShort(c.date)}`), "P", "A", "Att %"]];
    const body = rows.map(r => [
      String(r.idx + 1), r.st.examRoll, r.st.name,
      ...columns.map(c => { const v = r.sts[c.key]; return v === "present" ? "P" : v === "absent" ? "A" : v === "leave" ? "L" : "–"; }),
      String(r.present), String(r.absent), r.marked ? `${r.pct}%` : "–",
    ]);
    const nCols = head[0].length;
    const firstSub = 3;
    const lastSub = 3 + columns.length - 1;

    // Fit the grid to the page: fixed columns get fixed widths, subject columns share the rest.
    const usable = w - 20;
    const fixed = 9 + 20 + 46 + 11 + 11 + 15;
    const subW = columns.length ? Math.max(14, Math.min(26, (usable - fixed) / columns.length)) : 20;

    const tableW = fixed + subW * columns.length;
    const mLeft = Math.max(6, (w - tableW) / 2);   // centre the table on the page
    autoTable(doc, {
      startY: y,
      head,
      body,
      theme: "grid",
      tableWidth: tableW,
      styles: { fontSize: 8.5, cellPadding: 2.2, valign: "middle", halign: "center", textColor: [0, 0, 0], lineColor: [150, 150, 150], lineWidth: 0.25, overflow: "linebreak" },
      headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 7.2, halign: "center", valign: "middle", cellPadding: 2.4 },
      columnStyles: {
        0: { cellWidth: 9 },
        1: { cellWidth: 20, fontStyle: "bold" },
        2: { cellWidth: 46, halign: "center", fontStyle: "bold" },
        ...Object.fromEntries(columns.map((_, i) => [firstSub + i, { cellWidth: subW }])),
        [nCols - 3]: { cellWidth: 11, fontStyle: "bold" },
        [nCols - 2]: { cellWidth: 11, fontStyle: "bold" },
        [nCols - 1]: { cellWidth: 15, fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: mLeft, right: mLeft, top: 14, bottom: 18 },
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const c = d.column.index;
        const v = String(d.cell.raw);
        // Black & white only: A is bold, P is regular, L/– are muted grey. No fills.
        if (c >= firstSub && c <= lastSub) {
          if (v === "A") d.cell.styles.fontStyle = "bold";
          else if (v === "P") d.cell.styles.fontStyle = "normal";
          else d.cell.styles.textColor = [120, 120, 120];
        }
      },
    });

    // Legend + signatures
    const endY = (doc as any).lastAutoTable?.finalY ?? y;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...PDF_MUTED);
    doc.text("P = Present     A = Absent     L = Leave     – = Not marked", mLeft, endY + 6);
    pdfSignatures(doc, endY + 2, ["Class Teacher", "Exam Controller", "Principal"]);
    pdfFooters(doc, `Class ${clsLabel} Attendance Overview`);

    doc.save(`ClassOverview-Class${clsLabel}-${safeFile(sessionTitle || "Exam")}.pdf`);
    toast.success("Class Overview PDF exported!");
  };

  // ── EXPORT WHOLE-SCHOOL OVERVIEW PDF ─────────────────────────────────────
  // Every class that has attendance, packed onto as few landscape pages as
  // possible (one page when it fits, otherwise two). Classes sit in two
  // columns; row height is chosen automatically so the whole school fits.
  // Black & white only — an absent mark is bold on a light-grey cell.
  const exportSchoolOverviewPDF = async () => {
    const sections = overviewByClass.filter(sec => sec.students.length > 0 && sec.columns.length > 0);
    if (!sections.length) { toast.error("No attendance data to export"); return; }

    let jsPDF: typeof import("jspdf")["default"], autoTable: typeof import("jspdf-autotable")["default"];
    try {
      ([{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]));
    } catch { toast.error("Could not load the PDF library — check your connection"); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const sessionTitle = (attSelectedSession as any)?.title || "";
    const termLabel = (attSelectedSession as any)?.exam_term
      ? `${sessionTermLabel((attSelectedSession as any).exam_term)} ${(attSelectedSession as any).exam_year ?? ""}`.trim() : "";

    const SHORT: Record<string, string> = {
      "Mathematics": "Maths", "General Science": "G.Science", "Mutalia Quran": "M.Quran", "Pakistan Studies": "Pak.Study",
      "Computer Science": "Comp.Sci", "General Knowledge": "Gen.Know",
    };
    const fmtShort = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDateFns(new Date(d + "T00:00:00"), "dd/MM") : d);

    // ── prepare per-class data ──
    const prep = [...sections].sort((a, b) => Number(a.cls) - Number(b.cls)).map(sec => {
      const cols = [...sec.columns].sort((a, b) => (a.date === b.date ? a.subject.localeCompare(b.subject) : a.date.localeCompare(b.date)));
      const students = [...sec.students].sort((a, b) => String(a.examRoll).localeCompare(String(b.examRoll), undefined, { numeric: true }));
      const rows = students.map(st => {
        const g = sec.grid[st.id] || {};
        const marks = cols.map(c => g[c.key] as string | undefined);
        return {
          name: st.name, roll: String(st.examRoll), marks,
          p: marks.filter(m => m === "present").length,
          a: marks.filter(m => m === "absent").length,
          marked: marks.filter(m => !!m).length,
        };
      });
      const present = rows.reduce((x, r) => x + r.p, 0);
      const marked = rows.reduce((x, r) => x + r.marked, 0);
      return { cls: sec.cls, cols, rows, present, marked, pct: marked ? Math.round((present / marked) * 100) : 0 };
    });
    const totStudents = prep.reduce((x, c) => x + c.rows.length, 0);
    const totPapers = prep.reduce((x, c) => x + c.cols.length, 0);
    const totPresent = prep.reduce((x, c) => x + c.present, 0);
    const totMarked = prep.reduce((x, c) => x + c.marked, 0);
    const avg = totMarked ? Math.round((totPresent / totMarked) * 100) : 0;

    // ── page geometry ──
    const M = 8, GAP = 6;
    const colW = (W - M * 2 - GAP) / 2;
    const TOP1 = 54, TOPN = 17;
    const BOTTOM = H - 24;
    const TITLE_H = 6.5, HEAD_H = 8.6, BLOCK_GAP = 4;
    const topOf = (page: number) => (page === 0 ? TOP1 : TOPN);

    type Place = { page: number; col: number; ci: number; from: number; to: number };
    const pack = (rowH: number) => {
      const placed: Place[] = [];
      let page = 0, col = 0, y = topOf(0);
      for (let ci = 0; ci < prep.length; ci++) {
        const n = prep[ci].rows.length;
        let from = 0;
        while (from < n) {
          const fit = Math.floor((BOTTOM - y - TITLE_H - HEAD_H) / rowH);
          const need = Math.min(3, n - from);
          // Keep a class in one piece whenever it fits in a fresh column.
          const freshTop = col === 0 ? topOf(page) : topOf(page + 1);
          const fitFresh = Math.floor((BOTTOM - freshTop - TITLE_H - HEAD_H) / rowH);
          const wouldSplit = from === 0 && fit < n && n <= fitFresh;
          if ((fit < need || wouldSplit) && y > topOf(page) + 0.1) {
            if (col === 0) { col = 1; } else { page++; col = 0; }
            y = topOf(page);
            continue;
          }
          const take = Math.max(1, Math.min(fit, n - from));
          placed.push({ page, col, ci, from, to: from + take });
          y += TITLE_H + HEAD_H + take * rowH + BLOCK_GAP;
          from += take;
        }
      }
      return { placed, pages: page + 1 };
    };

    // Largest row height that keeps everything on 1 page, else on 2 pages, else the minimum.
    let rowH = 3.3, layout = pack(3.3);
    search: for (const target of [1, 2]) {
      for (let rh = 5.2; rh >= 3.3; rh -= 0.1) {
        const l = pack(rh);
        if (l.pages <= target) { rowH = rh; layout = l; break search; }
      }
    }
    const fontPt = rowH >= 4.4 ? 7 : rowH >= 3.8 ? 6.4 : 5.8;

    // ── page 1 letterhead + summary strip ──
    pdfBrandHeader(doc, "SCHOOL ATTENDANCE OVERVIEW — ALL CLASSES", [sessionTitle, termLabel].filter(Boolean).join("  ·  "));
    const stripY = 43;
    doc.setDrawColor(...PDF_LINE); doc.setLineWidth(0.3);
    doc.roundedRect(M, stripY, W - M * 2, 8.5, 1.5, 1.5, "S");
    const stats: [string, string][] = [
      ["CLASSES", String(prep.length)], ["STUDENTS", String(totStudents)], ["PAPERS", String(totPapers)],
      ["PRESENT MARKS", String(totPresent)], ["AVG ATTENDANCE", `${avg}%`],
    ];
    const sw = (W - M * 2) / stats.length;
    stats.forEach(([k, v], i) => {
      const cx = M + i * sw + sw / 2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.8); doc.setTextColor(...PDF_MUTED);
      doc.text(k, cx, stripY + 3.3, { align: "center", charSpace: 0.25 } as any);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      doc.text(v, cx, stripY + 7.2, { align: "center" });
    });

    for (let pg = 1; pg < layout.pages; pg++) doc.addPage();
    for (let pg = 1; pg < layout.pages; pg++) {
      doc.setPage(pg + 1);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0, 0, 0);
      doc.text("GOVT. HIGH SCHOOL BABI KHEL — School Attendance Overview", M, 9);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...PDF_MUTED);
      doc.text(`${sessionTitle}${termLabel ? "  ·  " + termLabel : ""}`, W - M, 9, { align: "right" });
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.line(M, 11.5, W - M, 11.5);
    }

    // ── draw blocks ──
    // Pages that use only ONE column get a single wide block centred on the page
    // (otherwise it would sit on the left with an empty right half).
    const colsOnPage: Record<number, Set<number>> = {};
    layout.placed.forEach(pl => { (colsOnPage[pl.page] ||= new Set()).add(pl.col); });
    // Optically centred text: baseline = centre + 0.36 × font height (Helvetica cap-height centre).
    const ctext = (txt: string, cx: number, cy: number, pt: number, align: "center" | "left" | "right" = "center") => {
      doc.setFontSize(pt);
      doc.text(txt, cx, cy + pt * 0.3528 * 0.36, { align });
    };
    const cursor: Record<string, number> = {};
    for (const pl of layout.placed) {
      doc.setPage(pl.page + 1);
      const key = `${pl.page}-${pl.col}`;
      const single = colsOnPage[pl.page].size === 1;
      const bw = single ? Math.min(W - M * 2, 215) : colW;
      const x = single ? (W - bw) / 2 : M + pl.col * (colW + GAP);
      let y = cursor[key] ?? topOf(pl.page);
      const c = prep[pl.ci];
      const nP = c.cols.length;
      const rollW = 15, sumW = 12;
      const nameW = nP > 8 ? 27 : 33;
      const paperW = (bw - rollW - nameW - sumW) / nP;
      const rows = c.rows.slice(pl.from, pl.to);
      const bodyH = rows.length * rowH;
      const sumX = x + rollW + nameW + nP * paperW;
      const blockTop = y;

      // title row (no fill — black text, rule underneath)
      doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
      ctext(`CLASS ${c.cls}${pl.from > 0 ? "  (cont.)" : ""}`, x + 2, y + TITLE_H / 2, 8.5, "left");
      doc.setFont("helvetica", "normal"); doc.setTextColor(60, 60, 60);
      ctext(`${c.rows.length} students  ·  ${nP} papers  ·  ${c.pct}% attendance`, x + bw - 2, y + TITLE_H / 2, 6.3, "right");
      y += TITLE_H;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.line(x, y, x + bw, y);

      // header row
      const hMid = y + HEAD_H / 2;
      doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold");
      ctext("Roll", x + rollW / 2, hMid, 6);
      ctext("Student", x + rollW + nameW / 2, hMid, 6);
      c.cols.forEach((col, i) => {
        const cx = x + rollW + nameW + i * paperW + paperW / 2;
        const label = SHORT[col.subject] || col.subject;
        let fs = 5.6; doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
        while (doc.getTextWidth(label) > paperW - 0.7 && fs > 3.4) { fs -= 0.2; doc.setFontSize(fs); }
        doc.setTextColor(0, 0, 0);
        ctext(label, cx, y + 2.9, fs);
        doc.setFont("helvetica", "normal"); doc.setTextColor(80, 80, 80);
        ctext(fmtShort(col.date), cx, y + HEAD_H - 2, 4.8);
      });
      doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
      ctext("P", sumX + sumW / 4, hMid, 6);
      ctext("A", sumX + (sumW * 3) / 4, hMid, 6);
      y += HEAD_H;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3); doc.line(x, y, x + bw, y);

      // body — every value centred in its cell, no background fills
      rows.forEach((r, ri) => {
        const ry = y + ri * rowH;
        const my = ry + rowH / 2;
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.1);
        if (ri < rows.length - 1) doc.line(x, ry + rowH, x + bw, ry + rowH);
        doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
        ctext(r.roll, x + rollW / 2, my, fontPt);
        let nm = r.name;
        doc.setFontSize(fontPt);
        while (nm.length > 4 && doc.getTextWidth(nm) > nameW - 2.4) nm = nm.slice(0, -2);
        if (nm !== r.name) nm = nm.replace(/\s+$/, "") + "…";
        ctext(nm, x + rollW + nameW / 2, my, fontPt);
        r.marks.forEach((m, i) => {
          const cx = x + rollW + nameW + i * paperW + paperW / 2;
          const ch = m === "present" ? "P" : m === "absent" ? "A" : m === "leave" ? "L" : "–";
          if (m === "absent") {
            // absent = bold letter inside a thin black box (readable in plain B/W, no shading)
            doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25);
            doc.rect(cx - paperW / 2 + 0.7, ry + 0.45, paperW - 1.4, rowH - 0.9, "S");
            doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
          } else {
            doc.setFont("helvetica", "normal");
            doc.setTextColor(m ? 0 : 140, m ? 0 : 140, m ? 0 : 140);
          }
          ctext(ch, cx, my, fontPt);
        });
        doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
        ctext(String(r.p), sumX + sumW / 4, my, fontPt);
        ctext(String(r.a), sumX + (sumW * 3) / 4, my, fontPt);
      });

      // vertical rules + outer border
      doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.1);
      const vx = [rollW, rollW + nameW, ...c.cols.map((_, i) => rollW + nameW + (i + 1) * paperW), rollW + nameW + nP * paperW + sumW / 2];
      vx.forEach(v => doc.line(x + v, blockTop + TITLE_H, x + v, y + bodyH));
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.35);
      doc.rect(x, blockTop, bw, TITLE_H + HEAD_H + bodyH, "S");

      cursor[key] = y + bodyH + BLOCK_GAP;
    }

    // ── legend + signatures on the last page ──
    doc.setPage(layout.pages);
    const sy = H - 19;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...PDF_MUTED);
    doc.text("P = Present    A = Absent (boxed)    L = Leave    – = Not marked", M, sy + 3.5);
    [["Exam Controller", W - M - 100], ["Principal", W - M - 40]].forEach(([label, x0]) => {
      doc.setDrawColor(90, 90, 90); doc.setLineWidth(0.35);
      doc.line(x0 as number, sy, (x0 as number) + 34, sy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(0, 0, 0);
      doc.text(label as string, (x0 as number) + 17, sy + 4, { align: "center" });
    });

    pdfFooters(doc, "School Attendance Overview");
    doc.save(`School-Attendance-Overview-${safeFile(sessionTitle || "Exam")}.pdf`);
    toast.success(`School overview PDF exported (${layout.pages} page${layout.pages > 1 ? "s" : ""})!`);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-28 sm:space-y-5 sm:pb-6" style={{ contain: "layout style" }}>
      {/* Main Tab Toggle */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <Hash className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Exam Roll Numbers</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Roll numbers, attendance &amp; QR scanning</p>
          </div>
        </div>
        <div className="relative mt-3 border-t border-border/60 pt-3">
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
            {([
              ["rolls", "Roll Numbers", Hash],
              ["attendance", "Attendance", ClipboardCheck],
            ] as const).map(([key, label, Icon]) => {
              const active = mainTab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMainTab(key as any)}
                  className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold leading-none whitespace-nowrap transition-all ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ROLL NUMBERS TAB */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {mainTab === "rolls" && (
        <>
          {/* ── LIST VIEW ── */}
          {view === "list" && (
            <>
              <div className="flex items-center justify-end">
                <Button onClick={() => setView("create")} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none"><Plus className="w-3.5 h-3.5" /> Generate New</Button>
              </div>
              {loadingSessions ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
              ) : sessions.length === 0 ? (
                <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm"><CardContent className="py-16 text-center"><Hash className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" /><p className="font-heading font-semibold">No sessions yet</p></CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {sessions.map(s => (
                    <Card key={s.id} className="overflow-hidden rounded-2xl border-border/60 shadow-sm transition-shadow hover:shadow-md">
                      <CardContent className="p-3.5 sm:p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            <Hash className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-heading font-semibold text-foreground text-[15px] leading-snug break-words">{s.title}</h3>
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              {(() => {
                                const termLabel = `${sessionTermLabel(s.exam_term)} ${s.exam_year}`;
                                // Don't repeat the exact same text the title already shows.
                                if (s.title.trim().toLowerCase().includes(termLabel.trim().toLowerCase())) return null;
                                return <Badge variant="secondary" className="border-border bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground">{termLabel}</Badge>;
                              })()}
                              {(() => {
                                const st = rollSessionStatus(s);
                                if (st === "live") return <Badge className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">Published</Badge>;
                                if (st === "scheduled") return <Badge className="gap-1 border-amber-200 bg-amber-50 px-2 py-0 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"><Timer className="w-3 h-3" /> Scheduled</Badge>;
                                return <Badge variant="secondary" className="border-border bg-muted px-2 py-0 text-[11px] font-medium text-muted-foreground">Draft</Badge>;
                              })()}
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground leading-snug">
                              Classes: {s.class_order.join(" → ")}
                              <span className="mx-1.5 text-border">|</span>
                              Starting: {s.starting_number}
                            </p>
                            {(() => {
                              const st = rollSessionStatus(s);
                              if (st === "scheduled") {
                                return <CountdownTimer targetDate={s.publish_at!} label={s.countdown_label || "Publishes in"} onExpire={() => qc.invalidateQueries({ queryKey: ["exam-sessions"] })} />;
                              }
                              // Legacy stuck state from the old bug: a DRAFT with an
                              // already-expired countdown. Tell the admin exactly why.
                              if (st === "draft" && s.publish_at && new Date(s.publish_at).getTime() <= Date.now()) {
                                return (
                                  <p className="text-xs text-amber-600 flex items-center gap-1.5 mt-1">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Countdown ended — tap Publish to take it live
                                  </p>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
                          <Button variant="outline" size="sm" onClick={() => { setSelectedSession(s); setView("detail"); }} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-4 text-xs font-semibold shadow-none sm:flex-none"><Eye className="w-3.5 h-3.5" /> View</Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button variant="ghost" size="sm" aria-label="Delete session" className="h-9 w-9 shrink-0 rounded-full p-0 text-destructive shadow-none hover:bg-destructive/10"><Trash2 className="w-4 h-4" /></Button></AlertDialogTrigger>
                            <AlertDialogContent className="rounded-2xl">
                              <AlertDialogHeader><AlertDialogTitle>Delete "{s.title}"?</AlertDialogTitle><AlertDialogDescription>This will permanently delete all roll numbers.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter className="flex-row gap-2 sm:space-x-0"><AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteSession.mutate(s.id)} className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── CREATE VIEW ── */}
          {view === "create" && (
            <div className="space-y-5 max-w-2xl">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setView("list")} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"><ArrowLeft className="w-3.5 h-3.5" /> Back</Button>
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Generate Exam Roll Numbers</h2>
              </div>
              <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm"><CardHeader><CardTitle className="text-base">Session Details</CardTitle></CardHeader>
                <CardContent className="grid gap-4">
                  <div><Label>Session Title *</Label><Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="e.g. First Semester Examination 2025" /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Exam Year *</Label><Input type="number" value={formYear} onChange={e => setFormYear(Number(e.target.value))} /></div>
                    <div><Label>Exam Term *</Label><select value={formTerm} onChange={e => setFormTerm(e.target.value)} className="h-10 w-full min-w-0 rounded-full border border-border/60 bg-card px-4 text-sm shadow-none outline-none focus:ring-2 focus:ring-primary/20">{TERMS.map(t => <option key={t} value={t}>{sessionTermLabel(t)}</option>)}</select></div>
                  </div>
                  <div><Label>Starting Roll Number (6 digits) *</Label><Input type="number" value={startingNumber} onChange={e => setStartingNumber(Number(e.target.value))} min={100000} max={999999} /></div>
                </CardContent>
              </Card>
              <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm"><CardHeader><CardTitle className="text-base">Select Classes & Order</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {ALL_CLASSES.map(cls => (
                      <button key={cls} onClick={() => toggleClass(cls)} className={`h-9 shrink-0 rounded-full border px-4 text-xs font-semibold whitespace-nowrap transition-all ${selectedClasses.includes(cls) ? "bg-primary text-primary-foreground border-primary shadow-sm" : "border-border/60 bg-card text-muted-foreground hover:bg-background hover:text-foreground"}`}>Class {cls}</button>
                    ))}
                  </div>
                  {/* ── Import students (CSV) ── */}
                  <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
                    <input
                      ref={rosterInputRef}
                      type="file"
                      className="hidden"
                      onChange={e => handleRosterFile(e.target.files?.[0])}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => rosterInputRef.current?.click()} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                        <FileUp className="h-3.5 w-3.5" /> {csvRoster.length > 0 ? "Replace CSV" : "Import CSV"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={downloadRosterTemplate} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold text-muted-foreground shadow-none">
                        <Download className="h-3.5 w-3.5" /> Sample
                      </Button>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Columns: Class No, Full Name, Father Name, Class (6–10). CSV or Excel.
                    </p>
                    {csvRoster.length > 0 && (
                      <div className="space-y-1">
                        <p className="break-words text-xs font-medium text-foreground">
                          {csvRoster.length} students{rosterInfo?.file ? ` · ${rosterInfo.file}` : ""}{rosterInfo && rosterInfo.skipped > 0 ? ` · ${rosterInfo.skipped} skipped` : ""}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_CLASSES.filter(c => selectedClasses.includes(c)).map(c => (
                            <span key={c} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${rosterCounts[c] ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
                              Class {c}: {rosterCounts[c] ?? 0}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {classOrder.filter(c => selectedClasses.includes(c)).length > 1 && (
                    <div className="space-y-2">
                      {classOrder.filter(c => selectedClasses.includes(c)).map((cls, idx, arr) => (
                        <div key={cls} className="flex items-center gap-3 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5">
                          <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">{idx + 1}</span>
                          <span className="flex-1 font-medium">Class {cls}</span>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" disabled={idx === 0} onClick={() => moveClass(cls, "up")}><ChevronUp className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" disabled={idx === arr.length - 1} onClick={() => moveClass(cls, "down")}><ChevronDown className="w-4 h-4" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Button onClick={handleGenerate} disabled={generating || selectedClasses.length === 0 || !formTitle.trim() || csvRoster.length === 0} className="w-full gap-1.5 whitespace-nowrap rounded-full px-5 text-sm font-semibold shadow-none" size="lg">
                {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><RefreshCw className="w-4 h-4" /> Generate Roll Numbers</>}
              </Button>
            </div>
          )}

          {/* ── DETAIL VIEW ── */}
          {view === "detail" && selectedSession && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
                <div className="flex items-center gap-2.5">
                  <Button variant="outline" size="icon" aria-label="Back" onClick={() => { setView("list"); setDetailSearch(""); setShowCountdown(false); }} className="h-9 w-9 shrink-0 rounded-full border-border/60 shadow-none"><ArrowLeft className="h-4 w-4" /></Button>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-heading font-bold leading-tight sm:text-xl">{selectedSession.title}</h2>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">{sessionTermLabel(selectedSession.exam_term)} {selectedSession.exam_year} · {rollNumbers.length} students</p>
                  </div>
                  {(() => {
                    const st = rollSessionStatus(selectedSession);
                    if (st === "live") return <Badge className="shrink-0 bg-emerald-100 px-2 text-[10px] text-emerald-700 hover:bg-emerald-100">Published</Badge>;
                    if (st === "scheduled") return <Badge className="shrink-0 gap-1 bg-amber-100 px-2 text-[10px] text-amber-800 hover:bg-amber-100"><Timer className="h-3 w-3" />Scheduled</Badge>;
                    return <Badge variant="secondary" className="shrink-0 bg-muted px-2 text-[10px] text-muted-foreground">Draft</Badge>;
                  })()}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={downloadPrint} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"><QrCode className="h-3.5 w-3.5" /><span className="truncate">Slips</span></Button>
                  <Button onClick={() => togglePublish(selectedSession)} className={`h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none text-white ${rollSessionStatus(selectedSession) === "live" ? "bg-slate-700 hover:bg-slate-800" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                    {rollSessionStatus(selectedSession) === "live" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    <span className="truncate">{rollSessionStatus(selectedSession) === "live" ? "Unpublish" : rollSessionStatus(selectedSession) === "scheduled" ? "Go Live" : "Publish"}</span>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowCountdown(v => !v)}
                  aria-expanded={showCountdown}
                  className="mt-2 h-9 w-full min-w-0 gap-1.5 whitespace-nowrap rounded-full border-indigo-300 px-3 text-xs font-semibold text-indigo-700 shadow-none hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                >
                  <Timer className="h-3.5 w-3.5" />
                  <span className="truncate">Countdown{rollSessionStatus(selectedSession) === "scheduled" ? " · Running" : ""}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCountdown ? "rotate-180" : ""}`} />
                </Button>
              </div>

              {/* Countdown setter — opens from the "Countdown" button above */}
              {showCountdown && (
              <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                <CardContent className="space-y-3 p-3 sm:p-4">
                  <p className="text-[11px] text-muted-foreground">Slips go live automatically at zero.</p>
                  {(() => {
                    const st = rollSessionStatus(selectedSession);
                    if (st === "scheduled") {
                      return (
                        <CountdownTimer
                          targetDate={selectedSession.publish_at!}
                          label={selectedSession.countdown_label || "Roll numbers publish in"}
                          onExpire={() => qc.invalidateQueries({ queryKey: ["exam-sessions"] })}
                        />
                      );
                    }
                    if (st === "draft" && selectedSession.publish_at && new Date(selectedSession.publish_at).getTime() <= Date.now()) {
                      return (
                        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Countdown already ended — set it again or tap Publish.
                        </p>
                      );
                    }
                    return null;
                  })()}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0 space-y-1"><Label className="text-[11px] font-semibold text-muted-foreground">Date</Label><Input type="date" className="h-9 rounded-full border-border/60 bg-card px-3 text-sm shadow-none" value={countdownDate} onChange={e => setCountdownDate(e.target.value)} min={new Date().toISOString().split("T")[0]} /></div>
                    <div className="min-w-0 space-y-1"><Label className="text-[11px] font-semibold text-muted-foreground">Time</Label><Input type="time" className="h-9 rounded-full border-border/60 bg-card px-3 text-sm shadow-none" value={countdownTime} onChange={e => setCountdownTime(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1"><Label className="text-[11px] font-semibold text-muted-foreground">Message</Label><Input className="h-9 rounded-full border-border/60 bg-card px-3 text-sm shadow-none" value={countdownLabel} onChange={e => setCountdownLabel(e.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button onClick={() => saveCountdown(selectedSession)} disabled={savingCountdown} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full bg-indigo-600 px-4 text-xs font-semibold shadow-none text-white hover:bg-indigo-700">
                      {savingCountdown ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Timer className="h-3.5 w-3.5" />} Set
                    </Button>
                    {selectedSession.publish_at && <Button variant="outline" onClick={() => clearCountdown(selectedSession)} className="h-9 min-w-0 whitespace-nowrap rounded-full border-destructive/40 px-4 text-xs font-semibold shadow-none text-destructive hover:bg-destructive/10">Remove</Button>}
                  </div>
                </CardContent>
              </Card>
              )}

              <div className="relative max-w-sm"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search name, roll no, class..." value={detailSearch} onChange={e => setDetailSearch(e.target.value)} className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" /></div>

              {loadingRolls ? (
                <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
              ) : (
                <div className="space-y-6">
                  {selectedSession.class_order.map(cls => {
                    const students = (filteredRolls as any).filter ? filteredRolls.filter(r => r.class === cls) : [];
                    if (!students?.length) return null;
                    return (
                      <Card key={cls} className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">{cls}</span>
                          Class {cls} <Badge variant="secondary">{students.length} students</Badge>
                        </CardTitle></CardHeader>
                        <CardContent className="p-0">
                          <div className="overflow-x-auto">
                            <Table><TableHeader><TableRow><TableHead className="w-12 bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</TableHead><TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exam Roll No</TableHead><TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Student Name</TableHead><TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Father Name</TableHead><TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Class Roll No</TableHead></TableRow></TableHeader>
                              <TableBody>{students.map((r: ExamRollEntry) => (
                                <TableRow key={r.id} className="border-border/50 hover:bg-primary/5"><TableCell className="text-muted-foreground text-sm">{r.serial_number}</TableCell>
                                  <TableCell><span className="font-mono font-bold text-primary text-base">{r.exam_roll_no}</span></TableCell>
                                  <TableCell className="font-medium">{r.student_name}</TableCell>
                                  <TableCell className="text-muted-foreground">{r.father_name || "—"}</TableCell>
                                  <TableCell className="text-muted-foreground">{r.class_roll_no}</TableCell>
                                </TableRow>
                              ))}</TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ATTENDANCE TAB */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {mainTab === "attendance" && (
        <>
          {/* Session/Class/Subject/Date selectors */}
          <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
            <CardContent className="space-y-3.5 p-3.5 sm:p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className={FIELD_LABEL}>Exam Session</label>
                  {loadingSessions ? <Skeleton className="h-10 rounded-xl" /> : (
                    <div className="relative">
                      <select value={attSession} onChange={e => { setAttSession(e.target.value); setAttClass(""); setAttSubject(""); setAllClassSubjects({}); }} className={FIELD_CONTROL}>
                        <option value="">Select Session</option>
                        {attSessions.map((s: any) => <option key={s.id} value={s.id}>{s.title} ({sessionTermLabel(s.exam_term)} {s.exam_year})</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <label className={FIELD_LABEL}>Class</label>
                  <div className="relative">
                    <select value={attClass} onChange={e => { setAttClass(e.target.value); setAttSubject(""); }} disabled={!attSession} className={FIELD_CONTROL}>
                      <option value="">Select Class</option>
                      <option value="all">All Classes</option>
                      {availableClasses.map((c: string) => <option key={c} value={c}>Class {c}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                {/* Single-class subject selector (hidden in All-Classes mode) */}
                {!isAllClassesMode && (
                  <div className="min-w-0">
                    <label className={FIELD_LABEL}>Subject / Paper</label>
                    <div className="relative">
                      <select value={attSubject} onChange={e => setAttSubject(e.target.value)} disabled={!attClass} className={FIELD_CONTROL}>
                        <option value="">Select Subject</option>
                        {EXAM_SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div className="min-w-0">
                  <label className={FIELD_LABEL}>Exam Date</label>
                  <div className="relative">
                    <input type="date" value={attDate} readOnly disabled={!attClass} className={`${FIELD_CONTROL} cursor-not-allowed bg-muted/40`} />
                    <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
              </div>

              {/* ── ALL-CLASSES: PER-CLASS SUBJECT SELECTORS ──
                  Each class has its OWN paper. The saved attendance row uses
                  the student's actual class + that class's selected subject. */}
              {isAllClassesMode && attSession && (
                <div className="space-y-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Subject for Each Class</p>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Classes with no paper on {attDate} in the Date Sheet are locked automatically.
                  </p>
                  {availableClasses.length > 0 && availableClasses.every((c: string) => (todayPapersByClass[c]?.length ?? 0) === 0) && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>No class has a paper today in the Date Sheet.</span>
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {availableClasses.map((cls: string) => {
                      const subs = todayPapersByClass[cls] || [];
                      const locked = subs.length === 0;
                      return (
                        <div key={cls} className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-2 py-1.5 ${locked ? "border-dashed border-border bg-muted/40" : "border-border/70 bg-card"}`}>
                          <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-bold leading-none ${locked ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>Class {cls}</span>
                          {locked ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                              <Lock className="h-3.5 w-3.5 shrink-0" /><span>No paper today · Locked</span>
                            </div>
                          ) : subs.length === 1 ? (
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5 text-xs font-semibold leading-tight text-foreground">
                              <span className="break-words">{subs[0]}</span><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            </div>
                          ) : (
                            <div className="relative min-w-0 flex-1">
                              <select
                                value={allClassSubjects[cls] || ""}
                                onChange={e => setAllClassSubjects(prev => ({ ...prev, [cls]: e.target.value }))}
                                className="h-8 w-full min-w-0 appearance-none truncate rounded-lg border border-border/70 bg-background pl-2 pr-7 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"
                              >
                                <option value="">Select subject</option>
                                {subs.map(x => <option key={x} value={x}>{x}</option>)}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Per-class paper times */}
                  <div className="flex flex-wrap gap-1.5">
                    {availableClasses.map((cls: string) => {
                      const subj = allClassSubjects[cls];
                      const times = classPaperTimesByClass[cls];
                      return (
                        <div key={cls} className={`rounded-md border px-2 py-1 text-[10px] leading-tight ${times ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400" : "border-border bg-muted/30 text-muted-foreground"}`}>
                          <span className="font-bold">Class {cls}</span>{subj ? ` · ${subj}` : ((todayPapersByClass[cls]?.length ?? 0) === 0 ? " · locked" : " · no subject")}
                          {times && (() => {
                            const w = getClassWindow(cls);
                            const label = w.status === "in_progress" ? "● Live"
                              : w.status === "not_started" ? `Opens ${w.start}`
                              : w.status === "ended" ? "Ended" : "";
                            const tone = w.status === "in_progress" ? "bg-emerald-600 text-white"
                              : w.status === "not_started" ? "bg-amber-500 text-white" : "bg-slate-400 text-white";
                            return (
                              <>
                                <span className="ml-1 font-mono">{times.start}–{times.end}</span>
                                {label && <span className={`ml-1 rounded px-1 py-px text-[9px] font-bold ${tone}`}>{label}</span>}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sub-tab toggle — thin pill segmented control */}
              <div className="grid grid-cols-2 gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
                {([
                  ["scan", "Paper Attendance", ScanLine],
                  ["overview", "Class Overview", FileSpreadsheet],
                ] as const).map(([key, label, Icon]) => (
                  <button key={key} onClick={() => setAttTab(key)} className={`flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold leading-none whitespace-nowrap transition-all ${attTab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" /><span className="whitespace-nowrap">{label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── SCAN / PAPER ATTENDANCE TAB ── */}
          {/* In single-class mode: requires attSession + attClass + attSubject + attDate.
              In All-Classes mode: requires attSession + attClass==="all" + attDate.
              (Subject is per-class, checked at scan time.) */}
          {attTab === "scan" && attSession && attClass && attDate && (isAllClassesMode || attSubject) && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                {[
                  { icon: Check, label: "Present", value: attStats.present, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
                  { icon: Clock, label: "Pending", value: attStats.pending, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20" },
                  { icon: X, label: "Absent", value: attStats.absent, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20" },
                  { icon: Palmtree, label: "Leave", value: attStats.leave, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20" },
                ].map(s => (
                  <div key={s.label} className="flex min-w-0 items-center gap-1.5 rounded-2xl border border-border/60 bg-card px-2 py-2.5 shadow-sm sm:gap-2.5 sm:px-3">
                    <s.icon className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${s.color}`} />
                    <div className="min-w-0 text-left leading-none">
                      <p className="text-lg font-bold tabular-nums text-foreground sm:text-2xl">{s.value}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {!isInitialized ? (
                <Card className="rounded-2xl border-2 border-dashed border-border/60 shadow-none">
                  <CardContent className="space-y-3 px-4 py-8 text-center">
                    <CalendarDays className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                    <p className="font-heading font-semibold">No Attendance Sheet Yet</p>
                    <p className="text-xs text-muted-foreground">
                      {isAllClassesMode
                        ? `Initialize for ${attRollNumbers.length} students across all classes`
                        : `Initialize for ${attRollNumbers.length} students of Class ${attClass}`}
                    </p>
                    {!canMarkAtt && (
                      <div className="mx-auto max-w-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 flex items-start gap-2 text-amber-700 dark:text-amber-400">
                        <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                        <span className="text-xs font-semibold text-left">{paperWindowMessage(attWindowStatus, attDisplayPaperStart, attDisplayPaperEnd)}</span>
                      </div>
                    )}
                    <Button onClick={handleInitSheet} disabled={initAttendance.isPending || initBusy || attRollNumbers.length === 0 || !canMarkAtt} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-5 text-xs font-semibold shadow-none">
                      {initAttendance.isPending || initBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />} Initialize
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Locked banner when sheet exists but paper window is closed */}
                  {!canMarkAtt && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 flex items-start gap-2">
                      <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="text-xs">
                        <p className="font-semibold text-amber-700 dark:text-amber-400">Attendance Locked — paper is not in progress.</p>
                        <p className="text-amber-600 dark:text-amber-500 mt-0.5">{paperWindowMessage(attWindowStatus, attDisplayPaperStart, attDisplayPaperEnd)}</p>
                        <p className="text-amber-600/70 dark:text-amber-500/70 mt-1">Scanning and status changes are locked. Extend the paper end-time from the Live Console to re-open editing.</p>
                      </div>
                    </div>
                  )}

                  {/* Action bar */}
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowManualList(v => !v)} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                      {showManualList ? <><ArrowLeft className="h-3.5 w-3.5 shrink-0" /> <span>Back</span></> : <><ClipboardCheck className="h-3.5 w-3.5 shrink-0" /> <span>Manual</span></>}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowScanner(!showScanner)} disabled={!canMarkAtt} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-emerald-600 bg-emerald-600 px-3 text-xs font-semibold shadow-none text-white hover:bg-emerald-700 hover:text-white disabled:opacity-50">
                      <Camera className="h-3.5 w-3.5 shrink-0" /> <span>{showScanner ? "Close" : "Scan QR"}</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDeleteSheet}
                      className={`h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none ${confirmDelete ? "bg-red-500 text-white hover:bg-red-600" : "border-destructive/40 text-destructive hover:bg-destructive/10"}`}>
                      <Trash2 className="h-3.5 w-3.5 shrink-0" /> <span>{confirmDelete ? "Confirm?" : "Delete"}</span>
                    </Button>
                  </div>

                  {/* QR Scanner area - Mobile Optimized */}
                  {showScanner && (
                    <Card className="border-emerald-200 dark:border-emerald-800/50 overflow-hidden">
                      <CardHeader className="p-3 pb-1 sm:p-4 sm:pb-2">
                        <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" aria-label="Back" onClick={() => setShowScanner(false)} className="h-8 shrink-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
                          <span>Scan QR</span>
                          {/* Live indicator */}
                          <span className="flex items-center gap-1 ml-auto">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span className="text-xs text-muted-foreground">Live</span>
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 p-3 sm:p-5">
                        {/* ── Instant scan preview / confirm card ──────────
                            Board-scanner style: appears the INSTANT the QR
                            decodes (client-side match, no network wait), so
                            the admin can compare name/class/roll against the
                            actual student before it's marked. Stays visible
                            until explicitly confirmed or cancelled.
                            
                            MOBILE OPTIMIZED: Larger touch targets, better spacing,
                            sticky positioning to stay visible while scanning */}
                        {scanPreview && (
                          <ScanConfirmSheet preview={scanPreview} onConfirm={confirmScanNow} onCancel={cancelScanPreview} />
                        )}

                        <SyncStatusBar />

                        {/* QR Scanner Component - Responsive sizing */}
                        <QRScanner
                          onScan={handleQRScan}
                          enabled={!!attSession && (isAllClassesMode
                            ? Object.values(allClassSubjects).some(s => !!s)
                            : !!attSubject)}
                        />

                        {/* Recent scans - Compact mobile view */}
                        {scanLog.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <History className="w-3.5 h-3.5" /> 
                              <span>Recent Scans</span>
                              <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                                {scanLog.length}
                              </Badge>
                            </p>
                            <div className="max-h-32 sm:max-h-24 overflow-y-auto space-y-1.5">
                              {scanLog.slice(0, 8).map((log, i) => (
                                <div key={`${i}-${log.time}`} className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2.5 sm:py-2 animate-in slide-in-from-right-2 duration-200">
                                  <CheckCircle2 className={`w-4 h-4 shrink-0 ${log.status === 'present' ? 'text-emerald-500' : log.status === 'absent' ? 'text-red-500' : 'text-amber-500'}`} />
                                  <span className="text-sm font-medium flex-1 truncate">{log.name}</span>
                                  <span className="text-xs text-muted-foreground font-mono shrink-0">{log.roll}</span>
                                  <span className="text-[10px] text-muted-foreground/70 shrink-0 hidden sm:inline">{log.time}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Manual attendance list — hidden behind the "Manual Attendance"
                      button above (see showManualList) so the screen isn't full of
                      every student right after Initialize. QR scanning above works
                      the same either way. */}
                  {showManualList && (
                    <>
                      <div className="relative min-w-0">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input className="h-10 w-full min-w-0 rounded-full border border-border/60 bg-card pl-10 pr-4 text-sm shadow-none placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder="Search student..." value={attSearch} onChange={e => setAttSearch(e.target.value)} />
                      </div>

                      {/* Attendance list — mobile cards / desktop table.
                          PERF: only ONE of the two trees is built (see
                          useIsMobileLayout) — previously BOTH were rendered
                          with one hidden by CSS, doubling reconciliation on
                          every scan / 15 s tick. */}
                      {loadingAtt ? (
                        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
                      ) : attFiltered.length === 0 ? (
                        <Card className="rounded-2xl border-2 border-dashed border-border/60 shadow-none"><CardContent className="py-10 text-center"><p className="text-muted-foreground">No students found</p></CardContent></Card>
                      ) : (
                    <>
                      {/* Mobile cards */}
                      {isMobileLayout && (
                      <div className="sm:hidden space-y-2">
                        {attFiltered.map(s => {
                          const att = s.attRecord;
                          const status: ExamAttDisplayStatus = s.status;
                          const cfg = statusConfig[status];
                          return (
                            <div key={s.student_id} className={`rounded-2xl border p-3 shadow-sm ${cfg.bg}`}>
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">{s.serial_number}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm text-foreground truncate">{s.student_name}</p>
                                  <p className="text-xs text-muted-foreground">Roll: {s.exam_roll_no} · Class: {s.class_roll_no}</p>
                                </div>
                                <Badge className={`${cfg.bg} ${cfg.color} gap-1 shrink-0`}>{cfg.icon}{cfg.label}</Badge>
                              </div>
                              {att && (
                                <div className="flex gap-1.5 mt-2">
                                  {(["present", "absent", "leave"] as Status[]).map(st => {
                                    const c = statusConfig[st];
                                    return <button key={st} onClick={() => handleStatusChange(att, st)}
                                      disabled={!canMarkAtt}
                                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${status === st ? `${c.bg} ${c.color} border-current` : "bg-secondary/50 text-muted-foreground border-transparent hover:border-border"}`}>{c.label}</button>;
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      )}
                      {/* Desktop table */}
                      {!isMobileLayout && (
                      <div className="hidden sm:block">
                        <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm"><CardContent className="p-0 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b border-border/50 bg-muted/60">
                              <th className="text-left p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</th>
                              <th className="text-left p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exam Roll</th>
                              <th className="text-left p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Student Name</th>
                              <th className="text-left p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Class Roll</th>
                              <th className="text-center p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                              <th className="text-center p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Actions</th>
                            </tr></thead>
                            <tbody>
                              {attFiltered.map(s => {
                                const att = s.attRecord;
                                const status: ExamAttDisplayStatus = s.status;
                                const cfg = statusConfig[status];
                                return (
                                  <tr key={s.student_id} className="border-b border-border/50 hover:bg-primary/5">
                                    <td className="p-3 text-muted-foreground">{s.serial_number}</td>
                                    <td className="p-3"><span className="font-mono font-bold text-primary">{s.exam_roll_no}</span></td>
                                    <td className="p-3 font-medium">{s.student_name}</td>
                                    <td className="p-3 text-muted-foreground">{s.class_roll_no}</td>
                                    <td className="p-3 text-center"><Badge className={`${cfg.bg} ${cfg.color} gap-1`}>{cfg.icon}{cfg.label}</Badge></td>
                                    <td className="p-3">{att && (
                                      <div className="flex justify-center gap-1">
                                        {(["present", "absent", "leave"] as Status[]).map(st => {
                                          const c = statusConfig[st];
                                          return <button key={st} onClick={() => handleStatusChange(att, st)}
                                            disabled={!canMarkAtt}
                                            className={`px-2 py-1 rounded text-[10px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${status === st ? `${c.bg} ${c.color} ring-1 ring-current` : "text-muted-foreground hover:text-foreground"}`}>{c.label}</button>;
                                        })}
                                      </div>
                                    )}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </CardContent></Card>
                      </div>
                      )}
                    </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* Empty state for scan tab */}
          {attTab === "scan" && (!attSession || !attClass || !attDate || (!isAllClassesMode && !attSubject)) && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-8 text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60"><ClipboardCheck className="h-6 w-6" /></span>
              <p className="text-sm font-heading font-semibold text-foreground">Select Exam Details Above</p>
              <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">Choose a session, class{isAllClassesMode ? "" : ", subject"} and date to begin.</p>
            </div>
          )}

          {/* ── OVERVIEW TAB ── */}
          {/* In All-Classes mode, the overview shows one section per class,
              each with its own table and its own "Export PDF" button —
              papers differ per class so a single shared table wouldn't
              make sense. Single-class mode keeps the original layout. */}
          {attTab === "overview" && attSession && attClass && isAllClassesMode && (
            <>
              {!loadingOverview && overviewByClass.length > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight">Whole School</p>
                    <p className="truncate text-[11px] text-muted-foreground">{overviewByClass.length} classes · {overviewByClass.reduce((a, s) => a + s.students.length, 0)} students</p>
                  </div>
                  <Button size="sm" onClick={exportSchoolOverviewPDF} className="h-9 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none">
                    <FileText className="h-3.5 w-3.5" /> All Classes PDF
                  </Button>
                </div>
              )}
              {loadingOverview ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
              ) : overviewByClass.length === 0 ? (
                <Card className="overflow-hidden rounded-2xl border-2 border-dashed border-border/60 shadow-none"><CardContent className="py-14 text-center">
                  <FileSpreadsheet className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="font-heading font-semibold">No Attendance Data Yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Initialize attendance sheets for papers to see the overview</p>
                </CardContent></Card>
              ) : (
                overviewByClass.map(section => (
                  <Card key={section.cls} className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                    <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-base">Class {section.cls}</CardTitle>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="secondary">{section.students.length} students · {section.columns.length} papers</Badge>
                        <Button variant="outline" size="sm" onClick={() => exportOverviewPDF(section.cls, section)} disabled={!section.students.length} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none">
                          <FileText className="h-3.5 w-3.5" /> Export PDF
                        </Button>
                        {/* Problem 1 fix: "Delete All Class Attendance" button.
                            Wipes EVERY attendance row for this class in this
                            session — every subject, every date. Useful when the
                            admin selected the wrong class or wants to start
                            the class's exam attendance over from scratch. */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={!section.students.length || deleteClassAttendance.isPending} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-destructive/40 px-3 text-xs font-semibold shadow-none text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-3.5 w-3.5" /> Delete All
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="rounded-2xl">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete ALL attendance for Class {section.cls}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently deletes EVERY attendance record for Class {section.cls} in this session — all {section.columns.length} papers ({section.columns.map(c => c.subject).join(", ")}), all dates, all {section.students.length} students. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                              <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteClassAttendance.mutate({ sessionId: attSession, cls: section.cls })}
                                className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none"
                              >
                                Delete Everything
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <table className="w-full text-sm min-w-[600px]">
                        <thead><tr className="border-b border-border/50 bg-muted/60">
                          <th className="text-left p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 sticky left-0">Student</th>
                          <th className="text-left p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exam Roll</th>
                          {section.columns.map(col => (
                            <th key={col.key} className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                              {col.subject}<br /><span className="font-normal text-[10px] text-muted-foreground/70">{col.date}</span>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button className="block mx-auto mt-1 text-destructive/60 hover:text-destructive" title={`Delete ${col.subject} attendance for Class ${section.cls}`}>
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="rounded-2xl">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete {col.subject} attendance for Class {section.cls}?</AlertDialogTitle>
                                    <AlertDialogDescription>This deletes the entire attendance sheet for {col.subject} (all dates) for all Class {section.cls} students. This cannot be undone.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                                    <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      // No examDate passed → deletes ALL dates for this subject+class (rev. 12).
                                      onClick={() => deleteAttendance.mutate({ sessionId: attSession, cls: section.cls, subject: col.subject })}
                                      className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </th>
                          ))}
                          <th className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Present</th>
                          <th className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Absent</th>
                        </tr></thead>
                        <tbody>
                          {section.students.map(s => {
                            const statuses = section.grid[s.id] || {};
                            const presentCount = section.columns.filter(col => statuses[col.key] === "present").length;
                            const absentCount = section.columns.filter(col => statuses[col.key] === "absent").length;
                            return (
                              <tr key={s.id} className="border-b border-border/50 hover:bg-primary/5">
                                <td className="p-2 font-medium bg-card sticky left-0">{s.name}</td>
                                <td className="p-2 font-mono text-primary font-bold">{s.examRoll}</td>
                                {section.columns.map(col => {
                                  const st = statuses[col.key] || "—";
                                  const cfg = st !== "—" ? statusConfig[st as Status] : null;
                                  return <td key={col.key} className="p-2 text-center">
                                    {cfg ? <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>{st === "present" ? "P" : st === "absent" ? "A" : "L"}</span> : <span className="text-muted-foreground">—</span>}
                                  </td>;
                                })}
                                <td className="p-2 text-center font-bold text-emerald-600">{presentCount}</td>
                                <td className="p-2 text-center font-bold text-red-600">{absentCount}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                ))
              )}
            </>
          )}

          {attTab === "overview" && attSession && attClass && !isAllClassesMode && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => exportOverviewPDF()} disabled={!overviewPivot.students.length} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none"><FileText className="h-3.5 w-3.5" /> Export PDF</Button>
                <Badge variant="secondary">{overviewPivot.students.length} students · {overviewPivot.columns.length} papers</Badge>
                {/* Problem 1 fix: "Delete All Class Attendance" button for single-class mode.
                    Wipes EVERY attendance row for this class in this session. */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!overviewPivot.students.length || deleteClassAttendance.isPending} className="h-8 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-destructive/40 px-3 text-xs font-semibold shadow-none text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" /> Delete All
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete ALL attendance for Class {attClass}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes EVERY attendance record for Class {attClass} in this session — all {overviewPivot.columns.length} papers ({overviewPivot.columns.map(c => c.subject).join(", ")}), all dates, all {overviewPivot.students.length} students. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                      <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteClassAttendance.mutate({ sessionId: attSession, cls: attClass })}
                        className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none"
                      >
                        Delete Everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {loadingOverview ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
              ) : overviewPivot.students.length === 0 ? (
                <Card className="overflow-hidden rounded-2xl border-2 border-dashed border-border/60 shadow-none"><CardContent className="py-14 text-center">
                  <FileSpreadsheet className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="font-heading font-semibold">No Attendance Data Yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Initialize attendance sheets for papers to see the overview</p>
                </CardContent></Card>
              ) : (
                <>
                  {/* Mobile: one card per student, stacked subject rows */}
                  <div className="space-y-2 sm:hidden">
                    {overviewPivot.students.map(s => {
                      const statuses = overviewPivot.grid[s.id] || {};
                      const presentCount = overviewPivot.columns.filter(col => statuses[col.key] === "present").length;
                      const absentCount = overviewPivot.columns.filter(col => statuses[col.key] === "absent").length;
                      return (
                        <Card key={s.id} className="rounded-2xl border-border/60 shadow-sm">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm truncate">{s.name}</p>
                                <p className="text-xs font-mono text-primary font-bold">{s.examRoll}</p>
                              </div>
                              <div className="flex gap-2 text-xs shrink-0">
                                <span className="font-bold text-emerald-600">{presentCount}P</span>
                                <span className="font-bold text-red-600">{absentCount}A</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              {overviewPivot.columns.map(col => {
                                const st = statuses[col.key] || "—";
                                const cfg = st !== "—" ? statusConfig[st as Status] : null;
                                return (
                                  <div key={col.key} className="flex items-center justify-between gap-1 bg-secondary/40 rounded-lg px-2 py-1">
                                    <span className="text-[10px] text-muted-foreground truncate">{col.subject}</span>
                                    {cfg ? <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold shrink-0 ${cfg.bg} ${cfg.color}`}>{st === "present" ? "P" : st === "absent" ? "A" : "L"}</span> : <span className="text-muted-foreground text-[10px]">—</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Desktop / tablet: horizontally scrollable table */}
                  <Card className="hidden overflow-hidden rounded-2xl border-border/60 shadow-sm sm:block"><CardContent className="p-0 overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead><tr className="border-b border-border/50 bg-muted/60">
                        <th className="text-left p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 sticky left-0">Student</th>
                        <th className="text-left p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exam Roll</th>
                        {overviewPivot.columns.map(col => (
                          <th key={col.key} className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                            {col.subject}<br /><span className="font-normal text-[10px] text-muted-foreground/70">{col.date}</span>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <button className="block mx-auto mt-1 text-destructive/60 hover:text-destructive" title={`Delete ${col.subject} attendance`}>
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-2xl">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete {col.subject} attendance?</AlertDialogTitle>
                                  <AlertDialogDescription>This deletes the entire attendance sheet for {col.subject} (all dates) for Class {attClass}. This cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="flex-row gap-2 sm:space-x-0">
                                  <AlertDialogCancel className="mt-0 h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    // No examDate passed → deletes ALL dates for this subject+class (rev. 12).
                                    onClick={() => deleteAttendance.mutate({ sessionId: attSession, cls: attClass, subject: col.subject })}
                                    className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold shadow-none text-destructive-foreground sm:flex-none"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </th>
                        ))}
                        <th className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Present</th>
                        <th className="text-center p-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Absent</th>
                      </tr></thead>
                      <tbody>
                        {overviewPivot.students.map(s => {
                          const statuses = overviewPivot.grid[s.id] || {};
                          const presentCount = overviewPivot.columns.filter(col => statuses[col.key] === "present").length;
                          const absentCount = overviewPivot.columns.filter(col => statuses[col.key] === "absent").length;
                          return (
                            <tr key={s.id} className="border-b border-border/50 hover:bg-primary/5">
                              <td className="p-2 font-medium bg-card sticky left-0">{s.name}</td>
                              <td className="p-2 font-mono text-primary font-bold">{s.examRoll}</td>
                              {overviewPivot.columns.map(col => {
                                const st = statuses[col.key] || "—";
                                const cfg = st !== "—" ? statusConfig[st as Status] : null;
                                return <td key={col.key} className="p-2 text-center">
                                  {cfg ? <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>{st === "present" ? "P" : st === "absent" ? "A" : "L"}</span> : <span className="text-muted-foreground">—</span>}
                                </td>;
                              })}
                              <td className="p-2 text-center font-bold text-emerald-600">{presentCount}</td>
                              <td className="p-2 text-center font-bold text-red-600">{absentCount}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent></Card>
                </>
              )}
            </>
          )}

          {attTab === "overview" && (!attSession || !attClass) && (
            <Card className="overflow-hidden rounded-2xl border-2 border-dashed border-border/60 shadow-none"><CardContent className="py-14 text-center">
              <FileSpreadsheet className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="font-heading font-semibold">Select Session & Class</p>
              <p className="text-xs text-muted-foreground mt-1">Choose a session and class to see attendance overview</p>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
};

export default AdminExamRollNumbers;
