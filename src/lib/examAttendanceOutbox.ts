/**
 * examAttendanceOutbox.ts
 * ---------------------------------------------------------------------------
 * LOCAL-FIRST exam attendance for slow / unreliable internet.
 *
 * THE PROBLEM
 * Marking one student used to cost 5–6 SEQUENTIAL network round trips
 * (existing-row read, plan-times read, roster read, plan-times again, upsert…).
 * On a weak 2G/3G link in the exam hall each trip can take seconds, and a
 * dropped connection meant the scan was simply lost.
 *
 * THE DESIGN
 *   1. The student is resolved from a roster cached ON THE DEVICE
 *      (memory + localStorage), so the confirm card appears with zero network.
 *   2. Confirming a scan writes ONE record to a durable OUTBOX (localStorage)
 *      synchronously — the UI updates instantly and the scan can never be lost
 *      (survives tab close, reload, battery swap).
 *   3. A background sync worker sends the outbox to Supabase in BATCHED
 *      upserts (one request for many scans) with timeout + exponential
 *      back-off, and re-tries automatically when the connection returns.
 *   4. Sync is IDEMPOTENT: it upserts on the table's unique key
 *      (session_id, student_id, subject, exam_date), so a retry after a
 *      half-failed request can never create a duplicate row.
 *
 * Nothing here touches React; see hooks/useAttendanceOutbox.ts for bindings.
 */
import { supabase } from "@/lib/supabase";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface OutboxItem {
  /** `${sessionId}|${studentId}|${subject}|${examDate}` — also the dedupe key */
  key: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  class: string;
  classRollNo: string;
  examRollNo: string;
  subject: string;
  examDate: string;
  status: "present";
  /** ISO time of the physical scan on the device (NOT the sync time). */
  scannedAt: string;
  /** auth.users id of the teacher/admin who scanned (exam_attendance.scanned_by is uuid). */
  scannedBy: string | null;
  planId?: string | null;
  roomId?: string | null;
  seatLabel?: string | null;
  seatId?: string | null;
  paperStart?: string | null;
  paperEnd?: string | null;
  attempts: number;
  /** Last permanent (non-network) error, if the server rejected this row. */
  lastError?: string | null;
}

export interface RosterRow {
  student_id: string;
  student_name: string;
  class_roll_no: string;
  exam_roll_no: string;
  class: string;
}

export interface SeatAssignmentLite {
  id: string;
  room_id: string;
  seat_label: string;
  student_id: string;
  class: string;
}

export interface OutboxSnapshot {
  items: OutboxItem[];
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncAt: number | null;
  nextRetryAt: number | null;
  /** Human-readable reason the last send attempt did NOT succeed (null when OK). */
  lastError: string | null;
  lastAttemptAt: number | null;
}

export const makeAttendanceKey = (sessionId: string, studentId: string, subject: string, examDate: string) =>
  `${sessionId}|${studentId}|${subject}|${examDate}`;

// ─── TUNING ─────────────────────────────────────────────────────────────────

const LS_OUTBOX = "ghs.examAtt.outbox.v1";
const LS_ROSTER = "ghs.examAtt.roster.v1:";
const LS_SEATS = "ghs.examAtt.seats.v1:";
const BATCH_SIZE = 40;               // rows per request
const REQUEST_TIMEOUT_MS = 25_000;   // slow-network friendly (2G can take >10 s)
const FLUSH_DEBOUNCE_MS = 250;       // coalesce a burst of scans into one request
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const POLL_MS = 15_000;              // safety-net retry while anything is pending
const MAX_OUTBOX_AGE_MS = 3 * 24 * 3600 * 1000; // never keep forever (stale exam days)

// ─── SAFE localStorage ──────────────────────────────────────────────────────

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}
function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

// ─── STORE ──────────────────────────────────────────────────────────────────

let items: OutboxItem[] = loadOutbox();
let syncing = false;
let lastSyncAt: number | null = null;
let nextRetryAt: number | null = null;
let lastAttemptError: string | null = null;
let lastAttemptAt: number | null = null;
let failureStreak = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let snapshot: OutboxSnapshot = buildSnapshot();
const listeners = new Set<() => void>();
const syncedListeners = new Set<(rows: OutboxItem[]) => void>();

function loadOutbox(): OutboxItem[] {
  const saved = lsGet<OutboxItem[]>(LS_OUTBOX) ?? [];
  const cutoff = Date.now() - MAX_OUTBOX_AGE_MS;
  return saved.filter(i => i && i.key && new Date(i.scannedAt).getTime() > cutoff);
}
function buildSnapshot(): OutboxSnapshot {
  const failed = items.filter(i => !!i.lastError).length;
  return { items, pending: items.length - failed, failed, syncing, lastSyncAt, nextRetryAt, lastError: lastAttemptError, lastAttemptAt };
}
function commit(): void {
  lsSet(LS_OUTBOX, items);
  snapshot = buildSnapshot();
  listeners.forEach(l => l());
}

export const outbox = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot(): OutboxSnapshot { return snapshot; },
  /** Fired after rows were durably saved on the server. */
  onSynced(l: (rows: OutboxItem[]) => void) { syncedListeners.add(l); return () => { syncedListeners.delete(l); }; },
  has(key: string): boolean { return items.some(i => i.key === key); },
  get(key: string): OutboxItem | undefined { return items.find(i => i.key === key); },
};

// Cross-tab: two tabs (or an installed PWA + browser) share ONE outbox.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== LS_OUTBOX) return;
    items = loadOutbox();
    snapshot = buildSnapshot();
    listeners.forEach(l => l());
  });
}

// ─── ENQUEUE ────────────────────────────────────────────────────────────────

/** Durable, synchronous. Returns false when the same scan is already queued. */
export function enqueueAttendance(input: Omit<OutboxItem, "key" | "attempts" | "lastError" | "status">): boolean {
  const key = makeAttendanceKey(input.sessionId, input.studentId, input.subject, input.examDate);
  if (items.some(i => i.key === key)) return false;
  items = [...items, { ...input, key, status: "present", attempts: 0, lastError: null }];
  commit();
  scheduleFlush(FLUSH_DEBOUNCE_MS);
  return true;
}

/** Drop a permanently-rejected row the admin chose to discard. */
export function discardOutboxItem(key: string): void {
  items = items.filter(i => i.key !== key);
  commit();
}

/** Give permanently-failed rows another chance (e.g. after fixing RLS). */
export function retryFailedItems(): void {
  items = items.map(i => (i.lastError ? { ...i, lastError: null, attempts: 0 } : i));
  commit();
  syncNow();
}

// ─── SYNC WORKER ────────────────────────────────────────────────────────────

function scheduleFlush(delay: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flush(); }, delay);
}

/** Manual trigger (button / online event / tab focus). */
export function syncNow(): Promise<void> {
  failureStreak = 0;
  nextRetryAt = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  return flush(true);
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function toRow(i: OutboxItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    session_id: i.sessionId,
    student_id: i.studentId,
    student_name: i.studentName,
    class: i.class,
    class_roll_no: i.classRollNo,
    exam_roll_no: i.examRollNo,
    subject: i.subject,
    exam_date: i.examDate,
    status: "present",
    scanned_at: i.scannedAt,
    scanned_by: i.scannedBy,
  };
  // Optional columns are only included when known, so a plain (non-desk)
  // scan can never overwrite seat info saved earlier by a desk scan.
  if (i.seatId) row.seat_id = i.seatId;
  if (i.roomId) row.room_id = i.roomId;
  if (i.seatLabel) row.seat_label = i.seatLabel;
  if (i.paperStart) row.paper_start_time = i.paperStart;
  if (i.paperEnd) row.paper_end_time = i.paperEnd;
  return row;
}

/** bulk upsert requires every row in ONE request to have identical columns. */
function groupBySignature(rows: { item: OutboxItem; row: Record<string, unknown> }[]) {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const sig = Object.keys(r.row).sort().join(",");
    (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push(r);
  }
  return [...groups.values()];
}

// ─── TRANSPORT ──────────────────────────────────────────────────────────────
// Direct PostgREST call instead of supabase-js for the WRITE. Reasons:
//   • every failure comes back with its real HTTP status + server message, so
//     the status bar can show EXACTLY why a sync failed (no more silent retry);
//   • it can never get stuck behind supabase-js's internal auth-refresh lock
//     that can freeze requests after the phone was offline for a while — the
//     token is obtained with its own short timeout and a stored-token fallback.
const SB_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SB_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

function storedAccessToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        const tok = v?.access_token ?? v?.currentSession?.access_token;
        if (typeof tok === "string" && tok) return tok;
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function getAccessToken(forceRefresh = false): Promise<string | null> {
  try {
    if (forceRefresh) {
      const r = await withTimeout(supabase.auth.refreshSession(), 12_000);
      const t = r?.data?.session?.access_token;
      if (t) return t;
    } else {
      const r = await withTimeout(supabase.auth.getSession(), 6_000);
      const t = r?.data?.session?.access_token;
      if (t) return t;
    }
  } catch { /* fall through to the stored token */ }
  return storedAccessToken();
}

interface SendResult { ok: boolean; transient: boolean; message: string }

async function postRows(rows: Record<string, unknown>[], token: string): Promise<{ status: number; body: string } | { networkError: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/exam_attendance?on_conflict=session_id,student_id,subject,exam_date`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      signal: ctl.signal,
    });
    const body = res.ok ? "" : await res.text().catch(() => "");
    return { status: res.status, body };
  } catch (e: any) {
    return { networkError: e?.name === "AbortError" ? "Connection too slow (timed out)" : "No connection to the server" };
  } finally {
    clearTimeout(timer);
  }
}

function serverMessage(body: string, status: number): string {
  try {
    const j = JSON.parse(body);
    const m = j?.message ?? j?.msg ?? j?.error_description ?? j?.error;
    if (m) return `${m}${j?.hint ? ` (${j.hint})` : ""}`;
  } catch { /* not JSON */ }
  return body ? body.slice(0, 160) : `Server error ${status}`;
}

async function upsertGroup(group: { item: OutboxItem; row: Record<string, unknown> }[]): Promise<SendResult> {
  if (!SB_URL || !SB_KEY) return { ok: false, transient: false, message: "App is missing its server settings (VITE_SUPABASE_URL / KEY)" };
  const rows = group.map(g => g.row);

  let token = await getAccessToken(false);
  if (!token) return { ok: false, transient: true, message: "Not signed in — open the admin panel and sign in (scans are safe on this device)" };

  let out = await postRows(rows, token);
  // Expired login after a long offline period → refresh once and retry.
  if ("status" in out && (out.status === 401 || out.status === 403 && /jwt/i.test(out.body))) {
    const fresh = await getAccessToken(true);
    if (fresh) { token = fresh; out = await postRows(rows, token); }
  }

  if ("networkError" in out) return { ok: false, transient: true, message: out.networkError };
  if (out.status >= 200 && out.status < 300) return { ok: true, transient: false, message: "" };

  const msg = serverMessage(out.body, out.status);
  if (out.status === 401 || (out.status === 403 && /jwt/i.test(out.body))) {
    return { ok: false, transient: true, message: `Login expired — sign in again (${msg})` };
  }
  if (out.status === 408 || out.status === 425 || out.status === 429 || out.status >= 500) {
    return { ok: false, transient: true, message: `Server busy (${out.status}) — will retry` };
  }
  return { ok: false, transient: false, message: msg };
}

/** Fill in seat_id (assignment id) for desk scans queued while offline. */
async function enrichSeatIds(batch: OutboxItem[]): Promise<void> {
  const need = batch.filter(i => i.planId && i.roomId && i.seatLabel && !i.seatId);
  if (!need.length) return;
  const planIds = [...new Set(need.map(i => i.planId!))];
  for (const pid of planIds) {
    try {
      const seats = await getSeatAssignments(pid, { network: true });
      for (const it of need.filter(n => n.planId === pid)) {
        const hit = seats.find(s => s.room_id === it.roomId && s.seat_label === it.seatLabel);
        if (hit) it.seatId = hit.id;
      }
    } catch { /* seat_id is cosmetic — never block attendance on it */ }
  }
}

let flushing: Promise<void> | null = null;

/**
 * IMPORTANT (bug fix): the "in flight" marker is cleared with `.finally()` on
 * the promise AFTER it has been stored. The previous version cleared it in a
 * `finally {}` INSIDE the async function — when that function finished without
 * ever awaiting (e.g. the first auto-sync ran while the phone was offline) the
 * clear ran BEFORE the assignment, leaving a stale "already syncing" promise
 * stored forever. Every later "Sync now" then returned that dead promise and
 * silently did nothing.
 */
function flush(force = false): Promise<void> {
  if (flushing) return flushing;
  const p: Promise<void> = runFlush(force).catch((e) => {
    // The worker must never throw into the UI.
    lastAttemptError = String((e as any)?.message ?? e ?? "Unexpected sync error");
    console.error("[examAttendanceOutbox] flush crashed:", e);
  }).finally(() => {
    syncing = false;
    if (flushing === p) flushing = null;
    snapshot = buildSnapshot();
    listeners.forEach(l => l());
  });
  flushing = p;
  return p;
}

async function runFlush(force: boolean): Promise<void> {
  while (true) {
    const queue = items.filter(i => !i.lastError);
    if (!queue.length) { failureStreak = 0; nextRetryAt = null; lastAttemptError = null; return; }

    // Automatic attempts skip the network when the browser says offline.
    // A manual "Sync now" ALWAYS tries — navigator.onLine can be wrong on
    // Android (stale after switching Wi-Fi/mobile data).
    if (!force && typeof navigator !== "undefined" && navigator.onLine === false) {
      nextRetryAt = null;
      lastAttemptError = "No internet connection";
      return;
    }

    syncing = true; lastAttemptAt = Date.now();
    snapshot = buildSnapshot(); listeners.forEach(l => l());

    const batch = queue.slice(0, BATCH_SIZE).map(i => ({ ...i }));
    await enrichSeatIds(batch);
    const rows = batch.map(item => ({ item, row: toRow(item) }));

    const saved: OutboxItem[] = [];
    let transientMessage: string | null = null;

    for (const group of groupBySignature(rows)) {
      const res = await upsertGroup(group);
      if (res.ok) { saved.push(...group.map(g => g.item)); continue; }
      if (res.transient) { transientMessage = res.message; continue; }

      // Permanent rejection somewhere in the group → isolate the bad row(s)
      // by sending one-by-one so ONE bad row can't block the rest.
      for (const single of group) {
        const r2 = group.length === 1 ? res : await upsertGroup([single]);
        if (r2.ok) saved.push(single.item);
        else if (r2.transient) transientMessage = r2.message;
        else {
          items = items.map(i => i.key === single.item.key
            ? { ...i, attempts: i.attempts + 1, lastError: r2.message || "Rejected by server" }
            : i);
        }
      }
    }

    if (saved.length) {
      const done = new Set(saved.map(s => s.key));
      items = items.filter(i => !done.has(i.key));
      lastSyncAt = Date.now();
      failureStreak = 0;
      nextRetryAt = null;
      syncedListeners.forEach(l => { try { l(saved); } catch { /* ignore */ } });
    }
    syncing = false;
    lastAttemptError = transientMessage;
    commit();

    if (transientMessage) {
      const wait = BACKOFF_MS[Math.min(failureStreak, BACKOFF_MS.length - 1)];
      failureStreak++;
      nextRetryAt = Date.now() + wait;
      items = items.map(i => (batch.some(b => b.key === i.key) ? { ...i, attempts: i.attempts + 1 } : i));
      commit();
      scheduleFlush(wait);
      return;
    }
    if (!saved.length) return; // nothing progressed (only permanent errors)
  }
}

// Auto-start: reconnect, tab focus and a slow safety-net poll.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void syncNow(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && items.some(i => !i.lastError)) void syncNow();
  });
  setInterval(() => {
    if (items.some(i => !i.lastError) && !flushing && (!nextRetryAt || Date.now() >= nextRetryAt)) void flush();
  }, POLL_MS);
  // Resume anything left over from a previous session.
  if (items.some(i => !i.lastError)) scheduleFlush(1_500);
}

// ─── CACHED ROSTER (zero-network student lookup) ────────────────────────────

const rosterMem = new Map<string, RosterRow[]>();

export function getCachedRoster(sessionId: string): RosterRow[] | null {
  return rosterMem.get(sessionId) ?? lsGet<RosterRow[]>(LS_ROSTER + sessionId);
}

/** One light query (5 columns) for the WHOLE session; cached on the device. */
export async function fetchRoster(sessionId: string): Promise<RosterRow[]> {
  const { data, error } = await withTimeout(
    supabase.from("exam_roll_numbers")
      .select("student_id, student_name, class_roll_no, exam_roll_no, class")
      .eq("session_id", sessionId),
    REQUEST_TIMEOUT_MS
  );
  if (error) throw error;
  const rows = (data ?? []) as RosterRow[];
  rosterMem.set(sessionId, rows);
  lsSet(LS_ROSTER + sessionId, rows);
  return rows;
}

// ─── CACHED DESK ASSIGNMENTS (stale-sticker-safe offline desk scans) ────────

const seatsMem = new Map<string, SeatAssignmentLite[]>();
const seatsInflight = new Map<string, Promise<SeatAssignmentLite[]>>();

export function getCachedSeatAssignments(planId: string): SeatAssignmentLite[] | null {
  return seatsMem.get(planId) ?? lsGet<SeatAssignmentLite[]>(LS_SEATS + planId);
}

export async function getSeatAssignments(planId: string, opts: { network: boolean } = { network: true }): Promise<SeatAssignmentLite[]> {
  const cached = getCachedSeatAssignments(planId);
  if (cached && !opts.network) return cached;
  if (cached && seatsMem.has(planId)) return cached; // fresh this session
  const existing = seatsInflight.get(planId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const { data, error } = await withTimeout(
        supabase.from("exam_seating_assignments")
          .select("id, room_id, seat_label, student_id, class")
          .eq("plan_id", planId),
        REQUEST_TIMEOUT_MS
      );
      if (error) throw error;
      const rows = (data ?? []) as SeatAssignmentLite[];
      seatsMem.set(planId, rows);
      lsSet(LS_SEATS + planId, rows);
      return rows;
    } catch (e) {
      if (cached) return cached; // stale-but-useful beats nothing
      throw e;
    } finally {
      seatsInflight.delete(planId);
    }
  })();
  seatsInflight.set(planId, p);
  return p;
}

// ─── WHO IS SCANNING (audit trail) ──────────────────────────────────────────

let scannerIdCache: string | null | undefined;

/** Reads the local auth session (no network). exam_attendance.scanned_by is a uuid. */
export async function getScannerId(): Promise<string | null> {
  if (scannerIdCache !== undefined) return scannerIdCache;
  try {
    const { data } = await supabase.auth.getSession();
    scannerIdCache = data.session?.user?.id ?? null;
  } catch { scannerIdCache = null; }
  return scannerIdCache;
}
