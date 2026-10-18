import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, QrCode, XCircle, AlertTriangle } from "lucide-react";

/** What the confirm card shows. Everything here comes from the trusted
 *  roster — never from the text inside the QR. */
export interface ScanPreview {
  studentId: string;
  studentName: string;
  class: string;
  classRollNo: string;
  examRollNo: string;
  subject: string | null;
  seatLabel?: string | null;
  planId?: string | null;
  roomId?: string | null;
  seatId?: string | null;
  /** Already marked present (server row or still waiting in the outbox). */
  alreadyPresent: boolean;
  /** e.g. "QR was printed for a different exam session" */
  warning?: string | null;
  /** raw scanned string — used only to apply the same-code lockout */
  qrData: string;
  scanId: string;
}

interface Props {
  preview: ScanPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Sticky bottom-sheet confirm card. Fixed to the viewport so the camera view
 * never moves/resizes when it opens (an inline card pushed the camera down and
 * made the phone shake). It stays until Confirm or ✕ — no timers.
 */
export default function ScanConfirmSheet({ preview, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); if (preview.alreadyPresent) onCancel(); else onConfirm(); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview.alreadyPresent, onConfirm, onCancel]);

  return (
    <div
      role="dialog"
      aria-live="assertive"
      aria-label="Confirm student attendance"
      className="fixed inset-x-0 bottom-0 z-[100] px-3 pt-2 animate-in slide-in-from-bottom-4 fade-in duration-200"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-emerald-400/60 bg-white/95 shadow-[0_18px_50px_-10px_rgba(5,60,35,0.55)] backdrop-blur dark:bg-gray-900/95">
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-amber-300 to-emerald-500" />
        <div className="relative p-4">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Dismiss — not this student"
            className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:bg-red-50 hover:text-red-600 active:scale-90"
          >
            <XCircle className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow ${preview.alreadyPresent ? "bg-amber-500" : "bg-emerald-500"}`}>
              {preview.alreadyPresent ? <CheckCircle2 className="h-6 w-6" /> : <QrCode className="h-6 w-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight text-foreground">{preview.studentName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Class {preview.class}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">Roll #{preview.classRollNo}</span>
                {preview.seatLabel ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Seat {preview.seatLabel}</span>
                ) : null}
              </div>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Exam Roll <span className="font-mono font-bold text-foreground">{preview.examRollNo}</span>
            {preview.subject ? <> · <span className="font-medium text-foreground">{preview.subject}</span></> : null}
          </p>

          {preview.warning ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{preview.warning}</span>
            </div>
          ) : null}

          {preview.alreadyPresent ? (
            <Button
              size="lg"
              autoFocus
              variant="outline"
              className="mt-3 h-12 w-full gap-2 rounded-xl border-amber-400 text-base font-bold text-amber-700"
              onClick={onCancel}
            >
              <CheckCircle2 className="h-5 w-5" />
              Already marked Present — Close
            </Button>
          ) : (
            <Button
              size="lg"
              autoFocus
              className="mt-3 h-12 w-full gap-2 rounded-xl bg-emerald-500 text-base font-bold text-white shadow-md transition-transform hover:bg-emerald-600 active:scale-[0.98]"
              onClick={onConfirm}
            >
              <CheckCircle2 className="h-5 w-5" />
              Confirm Present
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
