import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, CalendarPlus, Check, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";
import type { ExamScheduleEntry } from "@/hooks/useNewFeatures";
import {
  DEFAULT_REMINDERS, REMINDER_OPTIONS, buildIcs, buildPapers, downloadIcs,
  googleCalendarUrl, upcomingPapers, type CalendarContext,
} from "@/lib/examCalendar";

/**
 * "Add Date Sheet to Calendar" bottom sheet.
 * Loaded on demand (lazy) — nothing here ships with the Roll No. Slip page
 * until a student taps the button.
 */
const REMINDER_KEY = "ghs_datesheet_reminders";

function loadReminders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(REMINDER_KEY) || "null");
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  } catch { /* ignore */ }
  return DEFAULT_REMINDERS;
}

export interface AddToCalendarSheetProps {
  entries: ExamScheduleEntry[];
  student: { name: string; rollNo: string; className: string };
  examLabel: string;
  onClose: () => void;
}

export default function AddToCalendarSheet({ entries, student, examLabel, onClose }: AddToCalendarSheetProps) {
  const all = useMemo(() => buildPapers(entries), [entries]);
  const papers = useMemo(() => upcomingPapers(all), [all]);
  const hiddenPast = all.length - papers.length;

  const [picked, setPicked] = useState<Set<string>>(() => new Set(papers.map((p) => p.id)));
  const [reminders, setReminders] = useState<string[]>(loadReminders);
  const [done, setDone] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const ctx: CalendarContext = useMemo(() => ({
    studentName: student.name, rollNo: student.rollNo, className: student.className,
    examLabel, siteUrl: typeof window !== "undefined" ? window.location.origin : "",
  }), [student, examLabel]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const toggleReminder = (id: string) =>
    setReminders((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try { localStorage.setItem(REMINDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });

  const togglePaper = (id: string) =>
    setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chosen = papers.filter((p) => picked.has(p.id));
  const anyAllDay = chosen.some((p) => p.allDay);

  const addAll = () => {
    if (chosen.length === 0) return;
    downloadIcs(`GHS-DateSheet-Class-${student.className}.ics`, buildIcs(chosen, reminders, ctx));
    setDone(true);
    toast.success(`Calendar file ready — open it to add ${chosen.length} paper${chosen.length === 1 ? "" : "s"}`);
  };

  const dayParts = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      wd: dt.toLocaleDateString("en-GB", { weekday: "short" }),
      d: String(d),
      mo: dt.toLocaleDateString("en-GB", { month: "short" }),
    };
  };

  // Rendered in a portal on <body>: a `fixed` element inside any transformed
  // ancestor (the slip card has an entrance animation) is positioned relative
  // to THAT ancestor, not the screen — which is what made the sheet look broken.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Add date sheet to calendar">
      <button type="button" aria-label="Close" onClick={onClose} className="rs-backdrop-in absolute inset-0 bg-black/55" />
      <div className="rs-sheet-in relative flex max-h-[88dvh] w-full flex-col rounded-t-3xl border border-gold/30 bg-background shadow-2xl sm:max-w-md sm:rounded-3xl">
        {/* header */}
        <div className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl gradient-hero text-gold">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[15px] font-bold leading-tight text-foreground">Add Date Sheet to Calendar</h2>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Class {student.className} · {examLabel} · {papers.length} upcoming paper{papers.length === 1 ? "" : "s"}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground active:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {papers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">All papers on this date sheet are already over.</p>
          ) : (
            <>
              {/* reminders */}
              <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <BellRing className="h-3.5 w-3.5 text-gold-strong" /> Remind me
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map((r) => {
                  const on = reminders.includes(r.id);
                  return (
                    <button key={r.id} type="button" aria-pressed={on} onClick={() => toggleReminder(r.id)}
                      className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold touch-manipulation transition-colors ${
                        on ? "border-gold bg-gold/15 text-gold-strong dark:text-gold" : "border-border bg-card text-muted-foreground active:bg-muted"
                      }`}>
                      {on && <Check className="h-3 w-3" />} {r.label}
                    </button>
                  );
                })}
              </div>
              {reminders.length === 0 && (
                <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">No reminder selected — papers will be added without alerts.</p>
              )}

              {/* papers */}
              <p className="mb-2 mt-4 text-xs font-bold text-foreground">Papers to add</p>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {papers.map((p) => {
                  const on = picked.has(p.id);
                  const dp = dayParts(p.day);
                  return (
                    <li key={p.id} className="flex items-center gap-2.5 p-2.5">
                      <button type="button" role="checkbox" aria-checked={on} aria-label={`Include ${p.subject}`} onClick={() => togglePaper(p.id)}
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border touch-manipulation ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                        {on && <Check className="h-3.5 w-3.5" />}
                      </button>
                      <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-gold/40 bg-gold/5 py-1 leading-none">
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">{dp.wd}</span>
                        <span className="mt-0.5 text-base font-black text-foreground">{dp.d}</span>
                        <span className="text-[9px] font-semibold uppercase text-muted-foreground">{dp.mo}</span>
                      </div>
                      <button type="button" onClick={() => togglePaper(p.id)} className="min-w-0 flex-1 text-left touch-manipulation">
                        <span className="block text-[13px] font-semibold leading-snug text-foreground">{p.subject}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {p.startLabel ? `${p.startLabel}${p.endLabel ? ` – ${p.endLabel}` : ""}` : "Time not announced yet"}
                          {p.hall ? ` · ${p.hall}` : ""}
                        </span>
                      </button>
                      <a href={googleCalendarUrl(p, ctx)} target="_blank" rel="noopener noreferrer"
                        aria-label={`Add ${p.subject} to Google Calendar`}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[10.5px] font-semibold text-primary active:bg-muted">
                        Google <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  );
                })}
              </ul>

              {anyAllDay && (
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Some papers have no time yet, so they are added as all-day events with the “1 day before” reminder only.
                </p>
              )}
              {hiddenPast > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">{hiddenPast} finished paper{hiddenPast === 1 ? "" : "s"} not shown.</p>
              )}
              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                Your calendar app sends the reminders — they work offline and even when this website is closed.
                If the date sheet changes, tap Add again and the events update.
              </p>
            </>
          )}
        </div>

        {/* footer */}
        {papers.length > 0 && (
          <div className="border-t border-border px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
            <button type="button" onClick={addAll} disabled={chosen.length === 0}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-glow px-3 text-[13px] font-bold text-primary-foreground touch-manipulation transition-opacity active:opacity-85 disabled:opacity-50">
              {done ? <Check className="h-4 w-4 shrink-0" /> : <CalendarPlus className="h-4 w-4 shrink-0" />}
              <span>{done ? "Added — tap to download again" : `Add ${chosen.length} paper${chosen.length === 1 ? "" : "s"} to Calendar`}</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
