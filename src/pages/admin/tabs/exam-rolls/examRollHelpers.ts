/**
 * examRollHelpers.ts — pure helpers + shared types for the Exam Roll Numbers tab
 * (extracted from AdminExamRollNumbers.tsx; no behaviour change).
 */
import QRCode from "qrcode";
import { encodeExamQRData } from "@/hooks/useExamAttendance";

// ── Real QR Code generation using `qrcode` npm package ─────────────────────────
const qrCache = new Map<string, string>();
export async function getQRDataURL(sessionId: string, studentId: string, examRollNo: string): Promise<string> {
  const key = `${sessionId}-${studentId}-${examRollNo}`;
  if (qrCache.has(key)) return qrCache.get(key)!;
  const data = encodeExamQRData(sessionId, studentId, examRollNo);
  const url = await QRCode.toDataURL(data, {
    width: 200, margin: 1, errorCorrectionLevel: "M",
    color: { dark: "#333333", light: "#FFFFFF" },
  });
  qrCache.set(key, url);
  return url;
}

// Single QR for attendance scan
export async function generateSingleQR(data: string): Promise<string> {
  return QRCode.toDataURL(data, { width: 200, margin: 1, errorCorrectionLevel: "M" });
}

export interface ExamSession {
  id: string; title: string; exam_year: number; exam_term: string;
  classes: string[]; class_order: string[]; starting_number: number;
  is_published: boolean; publish_at: string | null;
  countdown_label: string | null; created_at: string;
}
export interface ExamRollEntry {
  id: string; session_id: string; student_id: string; student_name: string;
  father_name: string | null; class: string; class_roll_no: string;
  exam_roll_no: string; serial_number: number;
}
export interface Student {
  id: string; full_name: string; roll_number: string; class: string; father_name: string | null;
}

/**
 * Sorts students by roll_number the way a human expects: numerically
 * ("2" before "10"), not lexicographically like a plain string sort or a
 * DB ORDER BY on a text column (which would put "10" before "2"). This
 * keeps a class's student order stable across Generate/Update regardless
 * of whether roll numbers are zero-padded ("01") or not ("1").
 */
export function sortByRollNumber(students: Student[]): Student[] {
  return [...students].sort((a, b) => {
    const na = parseInt(a.roll_number, 10);
    const nb = parseInt(b.roll_number, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true });
  });
}

/**
 * Interleaves students round-robin across classes, following classOrder.
 * E.g. classOrder ["10","9","8","7","6"] with 2 students each produces:
 * 10th-1, 9th-1, 8th-1, 7th-1, 6th-1, 10th-2, 9th-2, 8th-2, 7th-2, 6th-2.
 * A class with fewer students is simply skipped once it's exhausted —
 * the remaining classes keep cycling.
 */
export function interleaveByClassOrder(classOrder: string[], studentsPerClass: Record<string, Student[]>): Student[] {
  const result: Student[] = [];
  const maxLen = Math.max(0, ...classOrder.map(cls => studentsPerClass[cls]?.length ?? 0));
  for (let round = 0; round < maxLen; round++) {
    for (const cls of classOrder) {
      const student = studentsPerClass[cls]?.[round];
      if (student) result.push(student);
    }
  }
  return result;
}

/** Fisher-Yates shuffle — returns a new array, doesn't mutate the input. */
export function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

