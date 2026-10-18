/**
 * examQrSecurity.ts
 * ---------------------------------------------------------------------------
 * Strict, defensive parsing of exam QR codes scanned by invigilators.
 *
 * WHY THIS EXISTS
 * Anything a phone camera can see — a poster, a WhatsApp forward, a random
 * product barcode — can reach the attendance scanner. The old code ran
 * JSON.parse on it and trusted whatever fields came out. This module is the
 * single gate every scanned string must pass BEFORE it is used:
 *
 *   • size-capped (a QR carrying a novel is not an exam QR)
 *   • must be JSON of exactly our two shapes ("exam" slip QR / "seat" desk QR)
 *   • identifiers must have the right FORMAT (UUIDs for student / session /
 *     plan ids, short safe strings for roll no / room / seat)
 *
 * IDENTITY IS NEVER TAKEN FROM THE QR. The QR only carries a *pointer*
 * (student id / roll no). The student's name, class and roll are always
 * resolved from the trusted exam roster and shown to the invigilator, who
 * confirms them against the physical student. A forged or edited QR therefore
 * cannot make the app display or save a name of the attacker's choosing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLL_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/. ]{0,23}$/;
const SHORT_RE = /^[A-Za-z0-9][A-Za-z0-9\-_:. ]{0,47}$/;
const MAX_QR_LENGTH = 600;

export interface ParsedExamQr {
  kind: "exam" | "seat";
  studentId: string;
  examRollNo: string;
  /** exam_roll_sessions.id (slip QR only) */
  sessionId?: string;
  /** desk QR only */
  planId?: string;
  roomId?: string;
  seatLabel?: string;
}

// Plain shape (not a discriminated union) so it narrows correctly even when
// the project compiles without `strict` / `strictNullChecks`.
export interface QrParseResult {
  ok: boolean;
  qr?: ParsedExamQr;
  reason?: string;
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : null;

export function parseExamQr(raw: unknown): QrParseResult {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "Empty QR code" };
  if (raw.length > MAX_QR_LENGTH) return { ok: false, reason: "Not an exam QR code" };

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Not an exam QR code" };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, reason: "Not an exam QR code" };
  }

  const studentId = str(obj.stid);
  const examRollNo = str(obj.rn);
  if (!studentId || !UUID_RE.test(studentId)) return { ok: false, reason: "Corrupted QR code (bad student id)" };
  if (!examRollNo || !ROLL_RE.test(examRollNo)) return { ok: false, reason: "Corrupted QR code (bad roll number)" };

  if (obj.t === "exam") {
    const sessionId = str(obj.sid);
    if (!sessionId || !UUID_RE.test(sessionId)) return { ok: false, reason: "Corrupted QR code (bad session id)" };
    return { ok: true, qr: { kind: "exam", studentId, examRollNo, sessionId } };
  }

  if (obj.t === "seat") {
    const planId = str(obj.pid);
    const roomId = str(obj.rid);
    const seatLabel = str(obj.sl);
    if (!planId || !UUID_RE.test(planId)) return { ok: false, reason: "Corrupted desk QR (bad plan id)" };
    if (!roomId || !SHORT_RE.test(roomId)) return { ok: false, reason: "Corrupted desk QR (bad room)" };
    if (!seatLabel || !SHORT_RE.test(seatLabel)) return { ok: false, reason: "Corrupted desk QR (bad seat)" };
    return { ok: true, qr: { kind: "seat", studentId, examRollNo, planId, roomId, seatLabel } };
  }

  return { ok: false, reason: "Not an exam QR code" };
}
