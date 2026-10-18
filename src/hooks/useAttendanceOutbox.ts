// src/hooks/useAttendanceOutbox.ts
// React bindings for lib/examAttendanceOutbox (offline-first exam attendance).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { outbox, fetchRoster, getCachedRoster, type RosterRow, type OutboxItem } from "@/lib/examAttendanceOutbox";

const EMPTY_ROSTER: RosterRow[] = [];

/** Live outbox state (pending / failed / syncing / lastSyncAt). */
export function useOutboxSnapshot() {
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getSnapshot);
}

/** Online/offline indicator that reacts to the browser's connectivity events. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
    },
    () => navigator.onLine,
    () => true
  );
}

/**
 * Whole-session roster, cached on the device. Starts from the cached copy so
 * the scanner works instantly (and fully offline) after the first load.
 */
export function useSessionRoster(sessionId: string | undefined) {
  const cached = sessionId ? getCachedRoster(sessionId) : null;
  const q = useQuery<RosterRow[]>({
    queryKey: ["exam-session-roster", sessionId],
    queryFn: () => fetchRoster(sessionId!),
    enabled: !!sessionId,
    initialData: cached ?? undefined,
    staleTime: 5 * 60 * 1000,
    networkMode: "offlineFirst",
    retry: 2,
  });
  const roster = q.data ?? EMPTY_ROSTER;
  const byStudentId = useMemo(() => new Map(roster.map(r => [r.student_id, r])), [roster]);
  const byExamRoll = useMemo(() => new Map(roster.map(r => [String(r.exam_roll_no), r])), [roster]);
  return { roster, byStudentId, byExamRoll, ready: roster.length > 0, isFetching: q.isFetching };
}

/**
 * After rows are saved on the server, refresh every screen that shows
 * attendance (sheet, class overview, all-classes, Live Console).
 */
export function useRefreshOnOutboxSynced() {
  const qc = useQueryClient();
  useEffect(() => {
    return outbox.onSynced((rows: OutboxItem[]) => {
      const seen = new Set<string>();
      for (const r of rows) {
        const k = `${r.sessionId}|${r.class}|${r.subject}|${r.examDate}`;
        if (seen.has(k)) continue;
        seen.add(k);
        qc.invalidateQueries({ queryKey: ["exam-attendance", r.sessionId, r.class, r.subject, r.examDate] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", r.sessionId, r.class] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-overview", r.sessionId, "all"] });
        qc.invalidateQueries({ queryKey: ["exam-attendance-all-classes", r.sessionId, r.examDate] });
      }
      qc.invalidateQueries({ queryKey: ["live-attendance"] });
    });
  }, [qc]);

  // Warn before closing the tab while scans are still unsent.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (outbox.getSnapshot().pending > 0) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
