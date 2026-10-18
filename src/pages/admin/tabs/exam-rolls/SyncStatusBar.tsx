import { useState } from "react";
import { CloudOff, CloudUpload, CheckCircle2, Loader2, RefreshCw, AlertTriangle, Trash2 } from "lucide-react";
import { useOutboxSnapshot, useOnlineStatus } from "@/hooks/useAttendanceOutbox";
import { syncNow, retryFailedItems, discardOutboxItem } from "@/lib/examAttendanceOutbox";

/**
 * Always-visible connection / sync indicator for invigilators.
 * Teaches one rule: "if it says saved on this device, the scan is safe".
 */
export default function SyncStatusBar() {
  const { items, pending, failed, syncing, lastSyncAt, lastError } = useOutboxSnapshot();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);

  let tone = "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200";
  let icon = <CheckCircle2 className="h-4 w-4 shrink-0" />;
  let text = lastSyncAt ? `All scans saved · ${new Date(lastSyncAt).toLocaleTimeString()}` : "Online · all scans saved";

  if (failed > 0) {
    tone = "border-red-300/70 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200";
    icon = <AlertTriangle className="h-4 w-4 shrink-0" />;
    text = `${failed} scan${failed > 1 ? "s" : ""} rejected by the server`;
  } else if (!online) {
    tone = "border-slate-300/70 bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-100";
    icon = <CloudOff className="h-4 w-4 shrink-0" />;
    text = pending > 0
      ? `Offline · ${pending} scan${pending > 1 ? "s" : ""} saved on this device`
      : "Offline · scanning still works, scans are kept on this device";
  } else if (pending > 0) {
    tone = "border-amber-300/70 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
    icon = syncing ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <CloudUpload className="h-4 w-4 shrink-0" />;
    text = syncing ? `Sending ${pending} scan${pending > 1 ? "s" : ""}…` : `${pending} scan${pending > 1 ? "s" : ""} waiting — slow connection`;
  }

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${tone}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {icon}
        <span className="min-w-0 flex-1 basis-40 break-words font-medium leading-snug">{text}</span>
        {(pending > 0 || failed > 0) && (
          <button
            type="button"
            onClick={() => (failed > 0 ? retryFailedItems() : void syncNow())}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 font-semibold shadow-sm transition active:scale-95 dark:bg-black/30"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            {failed > 0 ? "Retry" : "Sync now"}
          </button>
        )}
        {(failed > 0 || pending > 0) && (
          <button type="button" onClick={() => setOpen(o => !o)} className="shrink-0 rounded-full px-2 py-1 font-semibold underline">
            {open ? "Hide" : "Details"}
          </button>
        )}
      </div>
      {pending > 0 && lastError && !syncing && (
        <p className="mt-1.5 break-words rounded-lg bg-white/60 px-2 py-1 text-[11px] leading-snug dark:bg-black/20">
          Last try failed: {lastError}
        </p>
      )}
      {open && items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map(i => (
            <li key={i.key} className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 dark:bg-black/20">
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold leading-snug">{i.studentName} · Class {i.class} · {i.subject}</p>
                <p className="break-words text-[10px] leading-snug opacity-80">
                  {i.lastError ? i.lastError : `Scanned ${new Date(i.scannedAt).toLocaleTimeString()} · waiting to send`}
                </p>
              </div>
              <button type="button" aria-label="Discard this scan" onClick={() => discardOutboxItem(i.key)} className="shrink-0 rounded-full p-1.5 hover:bg-red-100 active:scale-90">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
