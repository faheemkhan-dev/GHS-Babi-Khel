// src/components/ReportCard/ReportCardModal.tsx
// Full-screen modal containing the Report Card bulk-result feature.
//
// Flow:
//   1. Password gate (password: zahir000) — kept in sessionStorage so the
//      user doesn't re-enter it on every open during a single session.
//   2. Exam selection: class (9th/10th/1st Year/2nd Year) + exam type (Annual-I/II) + year
//   3. Roll number input area — paste/type roll numbers, persisted to
//      localStorage so they survive page reloads until explicitly deleted.
//   4. Search button — bulk-fetches all rolls via /api/bisep-proxy with
//      bounded concurrency + progress bar.
//   5. Results summary + two download buttons: PDF (totals) and Excel
//      (every paper's marks).
//
// Mobile-friendly: full-screen on small viewports, scrollable, touch-
// friendly button sizes, responsive grids.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Lock, Search, FileText, FileSpreadsheet, Trash2, Plus,
  Loader2, AlertCircle, CheckCircle2, XCircle, Download, ArrowLeft,
  Layers, RefreshCw, Trophy, Check, Landmark, Hash,
} from "lucide-react";
// NOTE: `X` is still imported above because it is used for the per-roll
// remove buttons inside the saved-rolls list. The top-right CLOSE X in
// the modal header has been removed (per mobile-Chrome request) so the
// only way to leave the modal is the small back button on the left.
import type { ClassName, ExamSelection, NormalizedResult, RollEntry } from "./types";
import { bulkFetchResults, isMissingResult, retryMissingResults } from "./bulkFetch";
import { classDisplayName, combinedPairFor, CLASS_MAX_MARKS } from "./classMaxMarks";
import { computeStats } from "./normalize";
import { generateResultPDF } from "./generatePDF";
import { generateResultExcel } from "./generateExcel";
import { generateCombinedReportPDF } from "./generateCombinedPDF";

const PASSWORD = "babikhel#123";
const SESSION_KEY = "rc_auth_ok";
const LS_ROLLS_KEY = "rc_roll_entries";
const LS_SELECTION_KEY = "rc_exam_selection";
const CLASS_OPTIONS: ClassName[] = ["9th", "10th", "1st Year", "2nd Year"];
const DEFAULT_SCHOOL = "GHS Babi Khel, District Mohmand";

type Stage = "password" | "form" | "fetching" | "results";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ReportCardModal({ open, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("password");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  // Track client mount so we can render into a portal (escapes any parent
  // CSS `transform` / `filter` / `will-change` that would otherwise trap
  // `position: fixed` inside an ancestor — the classic bug where a modal
  // inside a framer-motion <motion.div> stops covering the screen).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Exam selection — persisted across sessions
  const [selection, setSelection] = useState<ExamSelection>(() => {
    try {
      const saved = localStorage.getItem(LS_SELECTION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Backfill schoolName for selections saved before this field existed,
        // and guard against an unknown saved class.
        const merged = { schoolName: DEFAULT_SCHOOL, ...parsed };
        if (!CLASS_OPTIONS.includes(merged.className)) merged.className = "10th";
        return merged;
      }
    } catch { /* intentional */ }
    return {
      schoolName: "GHS Babi Khel, District Mohmand",
      className: "10th",
      examType: "Annual-I",
      year: String(new Date().getFullYear()),
    };
  });

  // Roll entries — persisted PER exam selection (class + exam type + year),
  // so switching from e.g. 9th → 10th no longer shows the previous class's
  // saved roll numbers. All entries live under one localStorage key as a
  // map of "className|examType|year" → RollEntry[].
  const [rollsBySelection, setRollsBySelection] = useState<Record<string, RollEntry[]>>(() => {
    try {
      const saved = localStorage.getItem(LS_ROLLS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate the old flat-array format (single shared list, pre-fix)
        // into the new per-selection map under the default selection so
        // existing saved rolls aren't silently lost.
        if (Array.isArray(parsed)) {
          const migratedKey = `10th|Annual-I|${new Date().getFullYear()}`;
          return { [migratedKey]: parsed };
        }
        return parsed ?? {};
      }
    } catch { /* intentional */ }
    return {};
  });

  // New roll input (textarea — user can paste many at once)
  const [rollInput, setRollInput] = useState("");

  // ── Key for the currently selected exam, and derived roll list ──
  const selectionKey = `${selection.className}|${selection.examType}|${selection.year}`;
  const rollEntries = rollsBySelection[selectionKey] ?? [];
  const setRollEntries = (
    updater: RollEntry[] | ((prev: RollEntry[]) => RollEntry[])
  ) => {
    setRollsBySelection((prevMap) => {
      const prevList = prevMap[selectionKey] ?? [];
      const nextList = typeof updater === "function" ? (updater as (p: RollEntry[]) => RollEntry[])(prevList) : updater;
      return { ...prevMap, [selectionKey]: nextList };
    });
  };

  // Fetching state
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState<NormalizedResult[] | null>(null);
  const [fetchError, setFetchError] = useState("");
  // Retry-missing state (results screen)
  const [retrying, setRetrying] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ done: 0, total: 0 });
  const [retryNote, setRetryNote] = useState("");
  // Fetch mode: "single" = current class, "combined" = 9th + 10th in parallel
  const [fetchMode, setFetchMode] = useState<"single" | "combined">("single");
  // Per-class combined fetch progress, so the UI can show
  // "9th: 12/30 · 10th: 18/25" instead of a single combined counter.
  const [combinedProgress, setCombinedProgress] = useState<{
    aDone: number; aTotal: number;
    bDone: number; bTotal: number;
  }>({ aDone: 0, aTotal: 0, bDone: 0, bTotal: 0 });

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(LS_ROLLS_KEY, JSON.stringify(rollsBySelection));
    } catch {
      // localStorage unavailable (privacy mode / blocked storage) — ignore.
    }
  }, [rollsBySelection]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_SELECTION_KEY, JSON.stringify(selection));
    } catch {
      // localStorage unavailable (privacy mode / blocked storage) — ignore.
    }
  }, [selection]);

  // Reset to password stage when modal re-opens, unless already authed this session
  useEffect(() => {
    if (open) {
      let authed = false;
      try {
        authed = sessionStorage.getItem(SESSION_KEY) === "1";
      } catch {
        // sessionStorage unavailable (privacy mode / blocked storage) — treat as not authed.
      }
      setStage(authed ? "form" : "password");
      setPasswordInput("");
      setPasswordError("");
      setFetchError("");
    }
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // ── Stats for results view ──
  // MUST be called before the `if (!open) return null;` early return below —
  // React requires every hook to run in the same order on every render.
  // Previously this useMemo sat AFTER the early return, so when `open` went
  // from false → true, React saw one more hook than the prior render and
  // threw "Rendered more hooks than during the previous render" (React
  // error #310), which the ErrorBoundary caught and showed as
  // "Something went wrong" the instant the button was clicked.
  const stats = useMemo(
    () => (results ? computeStats(results) : null),
    [results]
  );

  if (!open || !mounted) return null;

  // ── Password submit ──
  const submitPassword = () => {
    if (passwordInput.trim() === PASSWORD) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // sessionStorage unavailable (privacy mode / blocked storage) — ignore.
      }
      setStage("form");
      setPasswordError("");
    } else {
      setPasswordError("Incorrect password. Try again.");
    }
  };

  // ── Parse the textarea into clean roll strings ──
  const parseRollInput = (text: string): string[] => {
    return text
      .split(/[\s,\n\r\t;|]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{4,10}$/.test(s));
  };

  // ── Add rolls from textarea ──
  const addRolls = () => {
    const parsed = parseRollInput(rollInput);
    if (parsed.length === 0) return;
    const existing = new Set(rollEntries.map((e) => e.roll));
    const fresh = parsed.filter((r) => !existing.has(r));
    if (fresh.length === 0) {
      setRollInput("");
      return;
    }
    const newEntries: RollEntry[] = fresh.map((roll, i) => ({
      roll,
      addedAt: Date.now() + i,
    }));
    setRollEntries((prev) => [...prev, ...newEntries]);
    setRollInput("");
  };

  // ── Remove a single roll ──
  const removeRoll = (roll: string) => {
    setRollEntries((prev) => prev.filter((e) => e.roll !== roll));
  };

  // ── Clear all rolls ──
  const clearAllRolls = () => {
    if (rollEntries.length === 0) return;
    if (confirm(`Delete all ${rollEntries.length} roll numbers? This cannot be undone.`)) {
      setRollEntries([]);
      setResults(null);
    }
  };

  // ── Start the bulk fetch (single class) ──
  const startSearch = async () => {
    if (rollEntries.length === 0) return;
    setStage("fetching");
    setFetchMode("single");
    setFetchError("");
    setResults(null);
    setRetryNote("");
    setProgress({ done: 0, total: rollEntries.length, current: "" });
    try {
      const rolls = rollEntries.map((e) => e.roll);
      // examKey namespaces the on-device marksheet cache per exam+class
      // (same identity as the saved-rolls localStorage keys), so re-running
      // a class for the SAME exam costs zero board requests, while a new
      // exam can never serve stale marksheets for the same roll numbers.
      const res = await bulkFetchResults(
        rolls,
        selection.className,
        (done, total, current) => {
          setProgress({ done, total, current });
        },
        `${selection.className}|${selection.examType}|${selection.year}`
      );
      setResults(res);
      setStage("results");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch results.");
      setStage("form");
    }
  };

  // ── Combined fetch: 9th + 10th in parallel, then generate combined PDF ──
  //
  // Reads saved roll numbers for BOTH 9th and 10th (for the currently
  // selected exam type + year) from localStorage, fetches both classes
  // concurrently via two `bulkFetchResults` pools (each with its own
  // bounded concurrency), and then immediately generates the combined PDF
  // — no separate "results" stage. The single-class flow above is left
  // untouched.
  //
  // Why two parallel pools (rather than one combined pool): keeping 9th
  // and 10th fetch pools separate means the per-class progress counters
  // stay accurate (the UI shows "9th: 12/30 · 10th: 18/25"), and either
  // class can finish independently without waiting for the other.
  const startCombinedSearch = async () => {
    // Pair depends on the selected class: 9th+10th for school results,
    // 1st Year+2nd Year for college results.
    const [pa, pb] = combinedPairFor(selection.className);
    const keyA = `${pa}|${selection.examType}|${selection.year}`;
    const keyB = `${pb}|${selection.examType}|${selection.year}`;
    const rollsA = (rollsBySelection[keyA] ?? []).map((e) => e.roll);
    const rollsB = (rollsBySelection[keyB] ?? []).map((e) => e.roll);
    if (rollsA.length === 0 || rollsB.length === 0) {
      setFetchError(
        `Add roll numbers for both ${classDisplayName(pa)} and ${classDisplayName(pb)} (same exam type & year) to generate a combined report.`
      );
      return;
    }
    setStage("fetching");
    setFetchMode("combined");
    setFetchError("");
    setResults(null);
    setCombinedProgress({
      aDone: 0, aTotal: rollsA.length,
      bDone: 0, bTotal: rollsB.length,
    });
    try {
      // Yield once so the fetching UI paints before blocking on fetches.
      await new Promise<void>((r) => setTimeout(r, 50));
      const [resultsA, resultsB] = await Promise.all([
        bulkFetchResults(
          rollsA,
          pa,
          (done) => {
            setCombinedProgress((prev) => ({ ...prev, aDone: done }));
          },
          keyA
        ),
        bulkFetchResults(
          rollsB,
          pb,
          (done) => {
            setCombinedProgress((prev) => ({ ...prev, bDone: done }));
          },
          keyB
        ),
      ]);
      const statsA = computeStats(resultsA);
      const statsB = computeStats(resultsB);
      await generateCombinedReportPDF({
        schoolName: selection.schoolName,
        examType: selection.examType,
        year: selection.year,
        pair: [pa, pb],
        classes: {
          [pa]: { className: pa, results: resultsA, stats: statsA },
          [pb]: { className: pb, results: resultsB, stats: statsB },
        },
      });
      // Return to form stage after the PDF has been generated & downloaded.
      setStage("form");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch combined results.");
      setStage("form");
    } finally {
      setFetchMode("single");
    }
  };

  // ── Retry ONLY the missing results (results screen) ──
  // Rolls that already have a marksheet are never sent again; only the ones
  // that came back empty (board busy / unreachable / network) are retried,
  // gently one at a time, and merged into the table in place.
  const missingCount = results ? results.filter((r) => isMissingResult(r)).length : 0;
  const retryMissing = async () => {
    if (!results || retrying || missingCount === 0) return;
    setRetrying(true);
    setRetryNote("");
    setRetryProgress({ done: 0, total: missingCount });
    try {
      const before = missingCount;
      const next = await retryMissingResults(
        results,
        selection.className,
        (done, total) => setRetryProgress({ done, total }),
        `${selection.className}|${selection.examType}|${selection.year}`
      );
      setResults(next);
      const after = next.filter((r) => isMissingResult(r)).length;
      const got = before - after;
      setRetryNote(
        after === 0
          ? `Recovered all ${got} missing result${got === 1 ? "" : "s"}.`
          : got > 0
            ? `Recovered ${got}. ${after} still missing — BISE is busy or unreachable, try again in a bit.`
            : `Could not recover any yet — BISE is busy or unreachable. Try again in a bit.`
      );
    } catch (err) {
      setRetryNote(err instanceof Error ? err.message : "Retry failed. Please try again.");
    } finally {
      setRetrying(false);
    }
  };

  // ── Download handlers ──
  const downloadPDF = async () => {
    if (!results) return;
    const stats = computeStats(results);
    await generateResultPDF(results, stats, selection);
  };
  const downloadExcel = async () => {
    if (!results) return;
    const stats = computeStats(results);
    await generateResultExcel(results, stats, selection);
  };

  // Classes paired by the Combined report (follows the selected class).
  const [pairA, pairB] = combinedPairFor(selection.className);

  // ── Derived values for the redesigned UI (no logic changes) ──
  const keyA = `${pairA}|${selection.examType}|${selection.year}`;
  const keyB = `${pairB}|${selection.examType}|${selection.year}`;
  const countA = (rollsBySelection[keyA] ?? []).length;
  const countB = (rollsBySelection[keyB] ?? []).length;
  const canCombine = countA > 0 && countB > 0;
  const busy = stage === "fetching";
  const stepIndex = stage === "password" ? 0 : stage === "results" ? 2 : 1;

  // ── Shared class strings — thin, premium, mobile-first controls ──
  const inputCls =
    "w-full h-9 px-3 rounded-xl border border-border bg-background text-foreground text-[13px] " +
    "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 " +
    "focus:border-primary/60 transition disabled:opacity-50";
  const labelCls = "block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1";
  const primaryBtn =
    "w-full h-9 px-4 rounded-full text-[13px] font-semibold text-white flex items-center justify-center gap-2 " +
    "bg-gradient-to-r from-primary-dark to-primary ring-1 ring-gold/40 shadow-[0_8px_18px_-10px_hsl(var(--primary)/0.8)] transition " +
    "hover:brightness-110 active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none";

  // Progress % for the fetching card (single or combined)
  const fetchPct = (() => {
    const done = fetchMode === "combined" ? combinedProgress.aDone + combinedProgress.bDone : progress.done;
    const total = fetchMode === "combined" ? combinedProgress.aTotal + combinedProgress.bTotal : progress.total;
    return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  })();
  const passPct = stats ? Math.max(0, Math.min(100, Number(stats.passPercentage) || 0)) : 0;
  const classMax = CLASS_MAX_MARKS[selection.className];
  const STEPS = ["Unlock", "Details", "Results"];

  // Render into document.body via a portal so the modal escapes any
  // ancestor CSS `transform` (framer-motion <motion.div> parents set
  // `transform` on the page banner wrapper that contains the trigger
  // button, which would otherwise trap `position: fixed` and turn the
  // modal into inline content sitting on the page).
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center bg-black/65 backdrop-blur-md p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] sm:rounded-3xl shadow-2xl border border-border/70 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ══ Header — compact, dark green, gold hairline ══ */}
        <div
          className="relative shrink-0 overflow-hidden text-white pt-[max(env(safe-area-inset-top),8px)] sm:pt-0"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gold/20 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3 px-3 py-2.5 sm:px-5 sm:py-3">
            <button
              onClick={onClose}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-white/20 bg-white/10 pl-1.5 pr-2.5 text-[11px] font-semibold transition hover:bg-white/20 active:scale-95"
              aria-label="Back to results"
              title="Back to results"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>

            {/* Step indicator — numbered nodes joined by a line */}
            <ol className="flex min-w-0 flex-1 items-center" aria-label="Progress">
              {STEPS.map((label, i) => (
                <li key={label} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                        i < stepIndex
                          ? "bg-gold text-[#0B2E19]"
                          : i === stepIndex
                            ? "bg-white text-primary-dark ring-2 ring-gold/70"
                            : "bg-white/15 text-white/60"
                      }`}
                    >
                      {i < stepIndex ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={`whitespace-nowrap text-[10.5px] font-semibold ${i <= stepIndex ? "text-white" : "text-white/50"}`}>{label}</span>
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className={`mx-2 h-px flex-1 ${i < stepIndex ? "bg-gold/80" : "bg-white/20"}`} aria-hidden />
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        </div>

        {/* ══ Body ══ */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-secondary/50 to-background px-3 py-3 sm:p-5">
          {/* ── Stage 1: Password ── */}
          {stage === "password" && (
            <div className="mx-auto w-full max-w-sm py-6 sm:py-10">
              <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-xl">
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gold/15 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-primary/15 blur-2xl" />
                <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
                <div className="relative flex flex-col items-center text-center">
                  <div className="mb-3 rounded-full bg-gradient-to-br from-gold to-primary p-[2px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-card">
                      <Lock className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                  <h3 className="font-heading text-[17px] font-bold text-foreground">Restricted Access</h3>
                  <p className="mb-4 mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    Enter the staff password to generate bulk result reports.
                  </p>
                  <div className="w-full space-y-2.5 text-left">
                    <input
                      type="password"
                      value={passwordInput}
                      autoFocus
                      autoComplete="off"
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        setPasswordError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitPassword();
                      }}
                      placeholder="Enter password"
                      aria-label="Password"
                      className={`${inputCls} text-center tracking-wider ${passwordError ? "border-destructive focus:ring-destructive/30" : ""}`}
                    />
                    {passwordError && (
                      <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {passwordError}
                      </p>
                    )}
                    <button onClick={submitPassword} className={primaryBtn}>
                      <Lock className="h-3.5 w-3.5" />
                      Unlock
                    </button>
                  </div>
                  <p className="mt-3.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Authorised school staff only</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Stage 2 & 3: Form + Fetching ── */}
          {(stage === "form" || stage === "fetching") && (
            <div className="space-y-3">
              {/* 1 · Exam details */}
              <SectionCard step={1} title="Exam Details" hint="Choose the class and exam">
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>School / College Name</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted-foreground"><Landmark className="h-3.5 w-3.5" /></span>
                      <input
                        type="text"
                        value={selection.schoolName}
                        disabled={busy}
                        onChange={(e) => setSelection((s) => ({ ...s, schoolName: e.target.value }))}
                        placeholder="Shown on PDF, Excel & Combined report"
                        className={`${inputCls} pl-8`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Class</label>
                    <Segmented
                      options={CLASS_OPTIONS}
                      value={selection.className}
                      disabled={busy}
                      onChange={(c) => setSelection((s) => ({ ...s, className: c }))}
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_5.25rem] gap-2.5">
                    <div>
                      <label className={labelCls}>Exam Type</label>
                      <Segmented
                        options={["Annual-I", "Annual-II"] as const}
                        value={selection.examType}
                        disabled={busy}
                        onChange={(t) => setSelection((s) => ({ ...s, examType: t }))}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Year</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={selection.year}
                        disabled={busy}
                        onChange={(e) => setSelection((s) => ({ ...s, year: e.target.value }))}
                        placeholder="2026"
                        className={`${inputCls} h-9 px-2.5 text-center font-semibold tabular-nums`}
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 2 · Roll numbers */}
              <SectionCard
                step={2}
                title="Roll Numbers"
                hint={rollEntries.length > 0 ? `${rollEntries.length} saved · ${classDisplayName(selection.className)}` : "Paste or type, then add"}
                right={
                  rollEntries.length > 0 ? (
                    <button
                      onClick={clearAllRolls}
                      disabled={busy}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-destructive/30 px-2.5 text-[11px] font-semibold text-destructive transition hover:bg-destructive/10 active:scale-95 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear
                    </button>
                  ) : undefined
                }
              >
                <textarea
                  value={rollInput}
                  disabled={busy}
                  onChange={(e) => setRollInput(e.target.value)}
                  placeholder={"Paste roll numbers — separated by spaces, commas or new lines.\ne.g. 703900, 703902 704001"}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground transition placeholder:font-sans placeholder:text-[12px] placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-1 text-[11px] leading-snug text-muted-foreground">
                    <Hash className="h-3 w-3 shrink-0" />
                    <span className="truncate">Only 4–10 digit numbers</span>
                  </p>
                  <button
                    onClick={addRolls}
                    disabled={busy || !rollInput.trim()}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-primary-dark to-primary px-4 text-xs font-semibold text-white shadow-sm ring-1 ring-gold/40 transition hover:brightness-110 active:scale-95 disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>

                {rollEntries.length === 0 ? (
                  <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-4 text-center">
                    <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border">
                      <Hash className="h-4 w-4" />
                    </span>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">No roll numbers saved yet.</p>
                  </div>
                ) : (
                  <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border bg-secondary/40 p-2">
                    {rollEntries.map((entry) => (
                      <span
                        key={entry.roll}
                        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-0.5 font-mono text-[11.5px] shadow-sm"
                      >
                        {entry.roll}
                        <button
                          onClick={() => removeRoll(entry.roll)}
                          disabled={busy}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label={`Remove ${entry.roll}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Fetching progress */}
              {busy && (
                <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-3.5 shadow-sm">
                  <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
                  <div className="mb-2.5 flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold leading-snug text-foreground">
                        {fetchMode === "combined"
                          ? `Fetching ${pairA} + ${pairB} from BISE Peshawar…`
                          : "Fetching from BISE Peshawar…"}
                      </p>
                      {fetchMode === "combined" ? (
                        <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                          {classDisplayName(pairA)}: {combinedProgress.aDone}/{combinedProgress.aTotal}
                          {"  ·  "}
                          {classDisplayName(pairB)}: {combinedProgress.bDone}/{combinedProgress.bTotal}
                        </p>
                      ) : (
                        <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                          {progress.done}/{progress.total}
                          {progress.current && `  ·  current: ${progress.current}`}
                        </p>
                      )}
                    </div>
                    <span className="font-heading text-lg font-bold tabular-nums text-primary">{fetchPct}%</span>
                  </div>
                  {fetchMode === "combined" ? (
                    <div className="space-y-1.5">
                      {[
                        { name: classDisplayName(pairA), done: combinedProgress.aDone, total: combinedProgress.aTotal },
                        { name: classDisplayName(pairB), done: combinedProgress.bDone, total: combinedProgress.bTotal },
                      ].map((b) => (
                        <div key={b.name} className="flex items-center gap-2">
                          <p className="w-14 shrink-0 text-[10px] font-semibold text-muted-foreground">{b.name}</p>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary-dark to-gold transition-all duration-200 ease-out"
                              style={{ width: `${b.total > 0 ? (b.done / b.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary-dark via-primary to-gold transition-all duration-200 ease-out"
                        style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Combined report — both classes of the pair */}
              {stage === "form" && (
                <div className="relative overflow-hidden rounded-2xl border border-gold/40 bg-card p-3.5 shadow-sm">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gold/15 blur-2xl" />
                  <div className="relative">
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-strong text-white shadow-sm">
                        <Layers className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-heading text-[13.5px] font-bold leading-tight text-foreground">Combined Report Card</h4>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                          {classDisplayName(pairA)} + {classDisplayName(pairB)} in one combined PDF.
                        </p>
                      </div>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      {[
                        { name: classDisplayName(pairA), n: countA },
                        { name: classDisplayName(pairB), n: countB },
                      ].map((c) => (
                        <div
                          key={c.name}
                          className={`flex items-center justify-between rounded-xl border px-3 py-1.5 ${c.n > 0 ? "border-emerald-300/60 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/20" : "border-border bg-secondary/40"}`}
                        >
                          <p className="text-[11px] font-semibold text-muted-foreground">{c.name}</p>
                          <p className={`text-[13px] font-bold tabular-nums ${c.n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                            {c.n}<span className="ml-0.5 text-[10px] font-semibold opacity-70">roll{c.n === 1 ? "" : "s"}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={startCombinedSearch}
                      disabled={!canCombine}
                      className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-gold-strong to-[hsl(41_90%_24%)] px-4 text-[13px] font-semibold text-white shadow-[0_8px_18px_-10px_hsl(var(--gold)/0.9)] ring-1 ring-white/20 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none dark:from-gold dark:to-gold-strong dark:text-gold-ink"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Download Combined ({countA + countB} rolls)
                    </button>
                    {!canCombine && (
                      <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
                        Save rolls for both {classDisplayName(pairA)} and {classDisplayName(pairB)} (same exam &amp; year) to enable this.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {fetchError && (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-snug text-destructive" role="alert">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{fetchError}</span>
                </p>
              )}
            </div>
          )}

          {/* ── Stage 4: Results ── */}
          {stage === "results" && results && stats && (
            <div className="space-y-3">
              {/* title row */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-heading text-[15px] font-bold leading-tight text-foreground">Results Summary</h3>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-primary">
                    {classDisplayName(selection.className)} · {selection.examType} {selection.year}
                  </p>
                </div>
                <button
                  onClick={() => setStage("form")}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 text-[11px] font-semibold text-primary shadow-sm transition hover:bg-secondary active:scale-95"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Edit
                </button>
              </div>

              {/* hero — pass-rate ring + headline numbers */}
              <div
                className="relative overflow-hidden rounded-2xl p-3.5 text-white shadow-[0_14px_28px_-16px_hsl(var(--primary)/0.8)]"
                style={{ background: "var(--gradient-hero)" }}
              >
                <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gold/20 blur-2xl" aria-hidden />
                <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
                <div className="relative flex items-center gap-3.5">
                  <div
                    className="h-[74px] w-[74px] shrink-0 rounded-full p-[5px]"
                    style={{ background: `conic-gradient(#E3B341 ${passPct * 3.6}deg, rgba(255,255,255,0.18) 0deg)` }}
                    role="img"
                    aria-label={`Pass rate ${stats.passPercentage}%`}
                  >
                    <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-primary-dark">
                      <span className="font-heading text-[17px] font-bold leading-none tabular-nums">{stats.passPercentage}%</span>
                      <span className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.16em] text-white/60">Pass</span>
                    </div>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 text-center">
                    {[
                      { l: "Total", v: stats.totalStudents, c: "text-white" },
                      { l: "Passed", v: stats.passCount, c: "text-emerald-300" },
                      { l: "Failed", v: stats.failCount, c: "text-red-300" },
                    ].map((t) => (
                      <div key={t.l} className="rounded-xl bg-white/10 px-1 py-2 ring-1 ring-white/10">
                        <p className={`font-heading text-xl font-bold leading-none tabular-nums ${t.c}`}>{t.v}</p>
                        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/65">{t.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="relative mt-3 grid grid-cols-4 gap-1.5 border-t border-white/15 pt-3 text-center">
                  {[
                    { l: "Found", v: stats.foundCount },
                    { l: "Not found", v: stats.notFoundCount },
                    { l: "Errors", v: stats.errorCount },
                    { l: "Average", v: stats.averageMarks },
                  ].map((t) => (
                    <div key={t.l}>
                      <p className="text-[13px] font-bold leading-none tabular-nums">{t.v}</p>
                      <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/60">{t.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* top scorer */}
              {stats.topScorerName && (
                <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-gold/50 bg-gradient-to-r from-gold-soft/80 to-card p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-strong text-white shadow-md ring-2 ring-white/50">
                    <Trophy className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gold-strong">Top scorer</p>
                    <p className="break-words font-heading text-[14px] font-bold leading-snug text-foreground">{stats.topScorerName}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">Roll {stats.topScorerRoll}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-heading text-xl font-bold leading-none tabular-nums text-foreground">{stats.highestMarks}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">/ {classMax}</p>
                  </div>
                </div>
              )}

              {(missingCount > 0 || retryNote) && (
                <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <p className="flex-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                      {missingCount > 0
                        ? `${missingCount} result${missingCount === 1 ? " is" : "s are"} missing (BISE was busy or unreachable). Retry fetches only those — results already loaded are kept.`
                        : "No missing results."}
                    </p>
                    {missingCount > 0 && (
                      <button
                        onClick={retryMissing}
                        disabled={retrying}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-amber-600 px-4 text-xs font-semibold text-white transition hover:bg-amber-700 active:scale-95 disabled:opacity-60"
                      >
                        {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {retrying ? `Retrying ${retryProgress.done}/${retryProgress.total}…` : `Retry ${missingCount} missing`}
                      </button>
                    )}
                  </div>
                  {retryNote && (
                    <p className="mt-2 text-xs font-medium leading-snug text-amber-900 dark:text-amber-200">{retryNote}</p>
                  )}
                </div>
              )}

              {/* student list */}
              <SectionCard step={null} title={`Student Results (${results.length})`} hint={`Marks out of ${classMax}`}>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
                  {results.map((r, i) => (
                    <li
                      key={r.roll}
                      className={`flex items-center gap-2.5 border-l-[3px] px-2.5 py-2 ${
                        !r.found ? "border-l-transparent opacity-80" : r.isFail ? "border-l-red-400" : "border-l-emerald-500"
                      }`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[13px] font-semibold leading-snug text-foreground">
                          {r.found ? (r.name || "—") : (
                            <span className="font-normal italic text-muted-foreground">{r.error || "Not found"}</span>
                          )}
                        </p>
                        <p className="mt-px font-mono text-[10.5px] text-muted-foreground">Roll {r.roll}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-bold leading-snug tabular-nums text-foreground">
                          {r.found && r.totalMarks > 0 ? r.totalMarks : "—"}
                          {r.found && r.totalMarks > 0 ? (
                            <span className="text-[10px] font-semibold text-muted-foreground">/{classMax}</span>
                          ) : null}
                          {r.found && (r.grade || r.isFail) ? (
                            <span className="ml-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {r.grade || "F"}
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-0.5 flex justify-end">
                          {!r.found ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : r.isFail ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-px text-[9.5px] font-bold text-red-600 dark:bg-red-950/30 dark:text-red-400">
                              <XCircle className="h-3 w-3" />
                              FAIL
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[9.5px] font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              PASS
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          )}
        </div>

        {/* ══ Sticky footer actions (thin pill buttons) ══ */}
        {(stage === "form" || stage === "fetching") && (
          <div className="shrink-0 border-t border-border bg-card/95 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:px-5">
            <button onClick={startSearch} disabled={busy || rollEntries.length === 0} className={primaryBtn}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {busy ? "Fetching results…" : `Search ${rollEntries.length} Roll Number${rollEntries.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
        {stage === "results" && results && stats && (
          <div className="shrink-0 border-t border-border bg-card/95 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:px-5">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={downloadPDF}
                className="group flex h-8 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary-dark to-primary pl-1.5 pr-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_14px_-8px_hsl(var(--primary)/0.9)] ring-1 ring-gold/50 transition hover:brightness-110 active:scale-[0.98]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <FileText className="h-3 w-3 text-gold" />
                </span>
                <span className="tracking-wide">PDF</span>
                <Download className="h-3 w-3 text-white/70" />
              </button>
              <button
                onClick={downloadExcel}
                className="group flex h-8 items-center justify-center gap-2 rounded-full border border-emerald-600/40 bg-card pl-1.5 pr-3.5 text-[12.5px] font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50 active:scale-[0.98] dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600/10 ring-1 ring-emerald-600/25">
                  <FileSpreadsheet className="h-3 w-3" />
                </span>
                <span className="tracking-wide">Excel</span>
                <Download className="h-3 w-3 opacity-60" />
              </button>
            </div>
            <p className="mt-1.5 flex items-center justify-center gap-1 text-[10.5px] leading-snug text-muted-foreground">
              <Download className="h-3 w-3 shrink-0" />
              PDF: totals &amp; summary · Excel: every paper's marks
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Segmented control — one slim track, active option is a raised green pill ──
function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className="grid gap-1 rounded-xl border border-border/70 bg-secondary/70 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o)}
            className={`h-7 whitespace-nowrap rounded-lg px-1 text-[12px] font-semibold leading-none transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? "bg-primary-dark text-white shadow-sm ring-1 ring-gold/50"
                : "text-foreground/70 hover:text-foreground"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

// ── Titled card with an optional numbered step badge ──
function SectionCard({
  step,
  title,
  hint,
  right,
  children,
}: {
  step: number | null;
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_22px_-16px_hsl(var(--primary)/0.35)]">
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div className="p-3.5 sm:p-4">
        <div className="mb-3 flex items-center gap-2.5">
          {step !== null && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-dark to-primary text-[11px] font-bold text-white ring-2 ring-gold/50">
              {step}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-[14px] font-bold leading-tight text-foreground">{title}</h3>
            {hint && <p className="mt-0.5 truncate text-[11px] font-medium leading-tight text-muted-foreground">{hint}</p>}
          </div>
          {right}
        </div>
        {children}
      </div>
    </section>
  );
}
