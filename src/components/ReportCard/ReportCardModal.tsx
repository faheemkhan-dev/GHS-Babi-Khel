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
  Layers, RefreshCw, Trophy, GraduationCap,
} from "lucide-react";
// NOTE: `X` is still imported above because it is used for the per-roll
// remove buttons inside the saved-rolls list. The top-right CLOSE X in
// the modal header has been removed (per mobile-Chrome request) so the
// only way to leave the modal is the small back button on the left.
import type { ClassName, ExamSelection, NormalizedResult, RollEntry } from "./types";
import { bulkFetchResults, isMissingResult, retryMissingResults } from "./bulkFetch";
import { classDisplayName, combinedPairFor } from "./classMaxMarks";
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

  // Shared class strings — thin, premium, mobile-first controls.
  const inputCls =
    "w-full h-10 px-3 rounded-xl border border-border bg-background text-foreground text-[13px] " +
    "placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 " +
    "focus:border-primary/60 transition disabled:opacity-50";
  const labelCls = "block text-[11px] font-semibold tracking-wide text-muted-foreground mb-1.5";
  const segCls = (active: boolean) =>
    `min-h-9 px-2 py-1.5 rounded-xl text-[13px] font-semibold border text-center leading-tight transition-all active:scale-[0.97] ${
      active
        ? "bg-primary-dark text-white border-primary-dark shadow-sm ring-1 ring-gold/40"
        : "bg-background text-foreground border-border hover:border-primary/40"
    } ${busy ? "opacity-50 cursor-not-allowed" : ""}`;
  const primaryBtn =
    "w-full h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 " +
    "bg-gradient-to-r from-primary-dark to-primary shadow-md shadow-primary/20 transition " +
    "hover:brightness-110 active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none";

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
        className="bg-background w-full max-w-3xl h-full sm:h-auto sm:max-h-[92vh] sm:rounded-3xl shadow-2xl border border-border/70 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="relative shrink-0 text-white pt-[max(env(safe-area-inset-top),10px)] sm:pt-0"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="flex items-center gap-3 px-3 sm:px-5 py-3">
            <button
              onClick={onClose}
              className="shrink-0 inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full bg-white/12 hover:bg-white/20 active:scale-95 border border-white/20 text-xs font-semibold transition"
              aria-label="Back to results"
              title="Back to results"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="font-bold text-[15px] sm:text-lg leading-tight flex items-center gap-1.5">
                <GraduationCap className="w-4 h-4 text-gold shrink-0" />
                Report Card
              </h2>
              <p className="text-[11px] leading-snug text-white/75 break-words">
                {(selection.schoolName || DEFAULT_SCHOOL)} · BISE Peshawar
              </p>
            </div>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 px-4 sm:px-5 pb-3" aria-hidden>
            {["Unlock", "Details & Rolls", "Results"].map((label, i) => (
              <div key={label} className="flex-1 min-w-0">
                <div className={`h-1 rounded-full transition-colors ${i <= stepIndex ? "bg-gold" : "bg-white/20"}`} />
                <p className={`mt-1 text-[10px] leading-tight ${i <= stepIndex ? "text-white" : "text-white/50"}`}>{label}</p>
              </div>
            ))}
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3.5 sm:p-6 bg-muted/20">
          {/* ── Stage 1: Password ── */}
          {stage === "password" && (
            <div className="mx-auto w-full max-w-sm py-6 sm:py-10">
              <div className="relative rounded-3xl border border-border bg-card p-6 shadow-xl overflow-hidden">
                <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-gold/15 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-primary/15 blur-2xl" />
                <div className="relative flex flex-col items-center text-center">
                  <div className="p-[2px] rounded-full bg-gradient-to-br from-gold to-primary mb-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card">
                      <Lock className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-foreground">Restricted Access</h3>
                  <p className="mt-1 mb-5 text-[13px] leading-relaxed text-muted-foreground">
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
                      Unlock
                    </button>
                  </div>
                  <p className="mt-4 text-[11px] text-muted-foreground/80">Authorised school staff only</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Stage 2 & 3: Form + Fetching ── */}
          {(stage === "form" || stage === "fetching") && (
            <div className="space-y-4">
              {/* 1 · Exam details */}
              <SectionCard step={1} title="Exam Details">
                <div className="space-y-3">
                  <div>
                    <label className={labelCls}>School / College Name</label>
                    <input
                      type="text"
                      value={selection.schoolName}
                      disabled={busy}
                      onChange={(e) => setSelection((s) => ({ ...s, schoolName: e.target.value }))}
                      placeholder="Shown on PDF, Excel & Combined report"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Class</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {CLASS_OPTIONS.map((c) => (
                        <button
                          key={c}
                          disabled={busy}
                          onClick={() => setSelection((s) => ({ ...s, className: c }))}
                          className={segCls(selection.className === c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Exam Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["Annual-I", "Annual-II"] as const).map((t) => (
                          <button
                            key={t}
                            disabled={busy}
                            onClick={() => setSelection((s) => ({ ...s, examType: t }))}
                            className={segCls(selection.examType === t)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Year</label>
                      <input
                        type="number"
                        value={selection.year}
                        disabled={busy}
                        onChange={(e) => setSelection((s) => ({ ...s, year: e.target.value }))}
                        placeholder="2026"
                        className={inputCls}
                      />
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 2 · Roll numbers */}
              <SectionCard
                step={2}
                title="Roll Numbers"
                badge={rollEntries.length > 0 ? `${rollEntries.length} saved · ${classDisplayName(selection.className)}` : undefined}
                right={
                  rollEntries.length > 0 ? (
                    <button
                      onClick={clearAllRolls}
                      disabled={busy}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-destructive/30 text-[11px] font-semibold text-destructive hover:bg-destructive/10 active:scale-95 transition disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete all
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
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-[13px] font-mono placeholder:font-sans placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 resize-y transition disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-snug text-muted-foreground min-w-0">Only 4–10 digit numbers are accepted.</p>
                  <button
                    onClick={addRolls}
                    disabled={busy || !rollInput.trim()}
                    className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-primary-dark text-white text-xs font-semibold shadow-sm hover:brightness-110 active:scale-95 transition disabled:opacity-45"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>

                {rollEntries.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      No roll numbers saved yet. Paste some above to get started.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-border bg-muted/30 p-2">
                    {rollEntries.map((entry) => (
                      <span
                        key={entry.roll}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-2.5 pr-1 py-0.5 text-xs font-mono shadow-sm"
                      >
                        {entry.roll}
                        <button
                          onClick={() => removeRoll(entry.roll)}
                          disabled={busy}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition disabled:opacity-50"
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
                <div className="rounded-2xl border border-primary/20 bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3 mb-3">
                    <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold leading-snug text-foreground">
                        {fetchMode === "combined"
                          ? `Fetching combined results from BISE Peshawar (${pairA} + ${pairB})…`
                          : "Fetching results from BISE Peshawar…"}
                      </p>
                      {fetchMode === "combined" ? (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground break-words">
                          {classDisplayName(pairA)}: {combinedProgress.aDone} / {combinedProgress.aTotal}
                          {"  ·  "}
                          {classDisplayName(pairB)}: {combinedProgress.bDone} / {combinedProgress.bTotal}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground break-words">
                          {progress.done} / {progress.total}
                          {progress.current && `  ·  current: ${progress.current}`}
                        </p>
                      )}
                    </div>
                  </div>
                  {fetchMode === "combined" ? (
                    <div className="space-y-2">
                      {[
                        { name: classDisplayName(pairA), done: combinedProgress.aDone, total: combinedProgress.aTotal, bar: "bg-sky-500" },
                        { name: classDisplayName(pairB), done: combinedProgress.bDone, total: combinedProgress.bTotal, bar: "bg-violet-500" },
                      ].map((b) => (
                        <div key={b.name}>
                          <p className="mb-1 text-[10px] font-medium text-muted-foreground">{b.name}</p>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${b.bar} transition-all duration-200 ease-out`}
                              style={{ width: `${b.total > 0 ? (b.done / b.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary-dark to-gold transition-all duration-200 ease-out"
                        style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Search — single class */}
              {stage === "form" && (
                <button onClick={startSearch} disabled={rollEntries.length === 0} className={primaryBtn}>
                  <Search className="h-3.5 w-3.5" />
                  Search {rollEntries.length} Roll Number{rollEntries.length === 1 ? "" : "s"}
                </button>
              )}

              {/* Combined report — both classes of the pair, at the very bottom */}
              {stage === "form" && (
                <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-500/10 blur-2xl" />
                  <div className="relative">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 text-white shadow">
                        <Layers className="h-[18px] w-[18px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold leading-tight text-foreground">Combined Report Card</h4>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          Fetch {classDisplayName(pairA)} and {classDisplayName(pairB)} together and download one combined PDF.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        { name: classDisplayName(pairA), n: countA },
                        { name: classDisplayName(pairB), n: countB },
                      ].map((c) => (
                        <div
                          key={c.name}
                          className={`rounded-xl border px-3 py-2 ${c.n > 0 ? "border-emerald-300/60 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/40" : "border-border bg-muted/40"}`}
                        >
                          <p className="text-[11px] font-semibold leading-tight text-muted-foreground">{c.name}</p>
                          <p className={`text-sm font-bold leading-tight ${c.n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                            {c.n} roll{c.n === 1 ? "" : "s"}
                          </p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={startCombinedSearch}
                      disabled={!canCombine}
                      className="mt-3 w-full h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center justify-center gap-2 shadow-sm transition hover:brightness-110 active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
                      style={{ background: "linear-gradient(90deg, #0284c7 0%, #7c3aed 100%)" }}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Download Combined ({countA + countB} rolls)
                    </button>
                    {!canCombine && (
                      <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
                        Save roll numbers for both {classDisplayName(pairA)} and {classDisplayName(pairB)} (same exam type &amp; year) to enable this.
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
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-foreground">Results Summary</h3>
                <button
                  onClick={() => setStage("form")}
                  className="inline-flex items-center gap-1 h-7 px-3 rounded-full border border-border bg-card text-[11px] font-semibold text-primary hover:bg-muted active:scale-95 transition"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to form
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatTile label="Total" value={stats.totalStudents} />
                <StatTile label="Found" value={stats.foundCount} />
                <StatTile label="Not Found" value={stats.notFoundCount} />
                <StatTile label="Errors" value={stats.errorCount} />
                <StatTile label="Passed" value={stats.passCount} color="text-emerald-600 dark:text-emerald-400" />
                <StatTile label="Failed" value={stats.failCount} color="text-red-600 dark:text-red-400" />
                <StatTile label="Pass %" value={`${stats.passPercentage}%`} />
                <StatTile label="Average" value={stats.averageMarks} />
              </div>

              {stats.topScorerName && (
                <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gradient-to-r from-gold-soft/70 to-card p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-ink">
                    <Trophy className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">Top scorer</p>
                    <p className="text-sm font-bold leading-snug text-foreground break-words">{stats.topScorerName}</p>
                    <p className="text-xs leading-snug text-muted-foreground">Roll {stats.topScorerRoll} · {stats.highestMarks} marks</p>
                  </div>
                </div>
              )}

              {/* Downloads */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={downloadPDF}
                  className="h-8 px-3 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 bg-gradient-to-r from-primary-dark to-primary shadow-sm hover:brightness-110 active:scale-[0.98] transition"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </button>
                <button
                  onClick={downloadExcel}
                  className="h-8 px-3 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 bg-gradient-to-r from-emerald-700 to-emerald-500 shadow-sm hover:brightness-110 active:scale-[0.98] transition"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </button>
              </div>
              <p className="-mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                <Download className="mt-px h-3.5 w-3.5 shrink-0" />
                PDF has totals and a summary. Excel has every paper's marks.
              </p>

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
                        className="shrink-0 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700 active:scale-95 transition disabled:opacity-60"
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

              {/* Student list — wraps names instead of cutting them off */}
              <SectionCard step={null} title={`Student Results (${results.length})`}>
                <div className="max-h-96 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-background">
                  {results.map((r) => (
                    <div key={r.roll} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold leading-snug text-foreground break-words">
                          {r.found ? (r.name || "—") : (
                            <span className="italic font-normal text-muted-foreground">{r.error || "Not found"}</span>
                          )}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">Roll {r.roll}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[13px] font-bold leading-snug text-foreground">
                          {r.found && r.totalMarks > 0 ? r.totalMarks : "—"}
                          {r.found && (r.grade || r.isFail) ? (
                            <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {r.grade || "F"}
                            </span>
                          ) : null}
                        </p>
                        <div className="mt-0.5 flex justify-end">
                          {!r.found ? (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          ) : r.isFail ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-950/30 dark:text-red-400">
                              <XCircle className="h-3 w-3" />
                              FAIL
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              PASS
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Titled card with an optional numbered step badge ──
function SectionCard({
  step,
  title,
  badge,
  right,
  children,
}: {
  step: number | null;
  title: string;
  badge?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-3.5 sm:p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        {step !== null && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-dark text-[11px] font-bold text-white ring-2 ring-gold/40">
            {step}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-tight text-foreground">{title}</h3>
          {badge && (
            <p className="mt-0.5 text-[11px] font-semibold leading-tight text-primary">{badge}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Small stat tile ──
function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-bold leading-tight ${color || "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
