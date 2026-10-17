/**
 * ExamRollNumbers.tsx — PUBLIC "Roll No. Slip" page (/roll-no-slip)
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE MODES, driven purely by the session row (no admin "Publish Now"
 * step needed at countdown end — publish happens INSTANTLY client-side):
 *
 *   1. SCHEDULED  (is_published=true + publish_at in the future)
 *        Students see a premium gold countdown panel — the exact style of
 *        the Merit List countdown (alarm-clock icon, "TIME REMAINING",
 *        big red digits) — and the SAME countdown appears in the Navbar
 *        (chip / strip) via useRollSlipCountdown().
 *        Roll numbers are PRE-FETCHED while counting down, so the moment
 *        the timer hits zero the page flips to mode 2 with ZERO loading —
 *        no network call, no "Publishing now...", nothing to wait for.
 *
 *   2. LIVE  (is_published=true and publish_at is null or in the past)
 *        Students do NOT see everyone at once. They get a premium finder:
 *        pick class (6th → 10th) → type full name → Search → only THEIR
 *        slip appears — an exact on-screen replica of the admin dashboard
 *        "Roll No Slips" print (school header, student info + QR, the
 *        class Exam Date Sheet, the 9 instructions and the Deputy
 *        Controller signature). The Download button produces the SAME
 *        artwork as the admin PDF, so what a student sees/downloads is
 *        1:1 identical to the office copy. Plus a small Share button.
 *
 *   3. EMPTY  (nothing published / scheduled)
 *        Friendly empty state.
 *
 * LEGACY SELF-HEAL: sessions stuck by the old bug (is_published=false with
 * an already-expired publish_at) are treated as LIVE here and healed in the
 * DB on a best-effort basis, so previously-stuck countdowns recover.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Hash, Search, Download, Share2, User, Clock3,
  CheckCircle2, AlertCircle, ArrowLeft, Loader2,
  Armchair, DoorOpen, ChevronDown, CalendarDays,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { encodeExamQRData } from "@/hooks/useExamAttendance";
import { useNowTick } from "@/hooks/useRollSlipCountdown";
import { useAllExamSchedule, ExamScheduleEntry } from "@/hooks/useNewFeatures";
import { triggerConfetti } from "@/lib/confetti";
import { examTypeLabel } from "@/utils/examTypeLabel";
import {
  resolveClassPaperTime,
  type SeatingPlan, type SeatingRoom, type SeatingAssignment,
} from "@/hooks/useExamSeating";
import { shareRollSlipCard, toastShareOutcome } from "@/utils/shareResultCard";

interface ExamSession {
  id: string; title: string; exam_year: number; exam_term: string;
  classes: string[]; class_order: string[]; starting_number: number;
  is_published: boolean; publish_at: string | null;
  countdown_label: string | null; created_at: string;
}
interface RollEntry {
  id: string; student_id: string; student_name: string; father_name: string | null;
  class: string; class_roll_no: string; exam_roll_no: string; serial_number: number;
}

/* ── The 9 exam-day rules — EXACTLY the same text the admin dashboard
      prints on the official Roll No Slips sheet ───────────────────────────── */
const SLIP_INSTRUCTIONS = [
  "1. Bring this Roll No Slip to the exam center for every paper.",
  "2. No slip, no entry to the examination hall.",
  "3. Do not bring mobile phones, smart watches, or any electronic device to the exam hall.",
  "4. Do not fold, scratch, or damage the QR code — it must scan cleanly for attendance.",
  "5. Report any errors or omissions on this slip before the exam begins.",
  "6. Reach the exam center at least 30 minutes before the paper starts.",
];

/* ── Shared motion variant (one-shot, GPU-safe) ─────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

/* ── Case/space-insensitive name normalisation for the finder ────────────── */
const normName = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/* ── Session status helpers (pure — module scope keeps hooks warning-free) ─ */
const publishTs = (s: ExamSession) => (s.publish_at ? new Date(s.publish_at).getTime() : null);
const isScheduled = (s: ExamSession, now: number) => { const t = publishTs(s); return t !== null && t > now; };
const isLive = (s: ExamSession, now: number) => {
  const t = publishTs(s);
  // Published → live unless still scheduled. Unpublished with an EXPIRED
  // countdown = legacy stuck session → auto-recovered as live.
  return s.is_published ? (t === null || t <= now) : (t !== null && t <= now);
};

/* ── Realistic countdown clock icon (same artwork as the Merit List panel) ── */
function RealisticClockIcon({ className = "w-8 h-8", hours = 0, minutes = 0, seconds = 0 }: { className?: string; hours?: number; minutes?: number; seconds?: number }) {
  const secAngle = (seconds % 60) * 6;
  const minAngle = (minutes % 60) * 6 + (seconds % 60) * 0.1;
  const hourAngle = (hours % 12) * 30 + (minutes % 60) * 0.5;
  const hand = (angleDeg: number, len: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x2: 32 + Math.sin(rad) * len, y2: 34 - Math.cos(rad) * len };
  };
  const hourHand = hand(hourAngle, 8.5);
  const minHand = hand(minAngle, 12);
  const secHand = hand(secAngle, 13.5);
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rslipClockFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFDF5" />
          <stop offset="100%" stopColor="#F3E9C7" />
        </linearGradient>
        <linearGradient id="rslipClockRim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4C550" />
          <stop offset="100%" stopColor="#C6912A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="10" r="5.5" fill="url(#rslipClockRim)" />
      <circle cx="48" cy="10" r="5.5" fill="url(#rslipClockRim)" />
      <rect x="22" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      <rect x="37.5" y="52" width="4.5" height="8" rx="2" fill="#8A6416" />
      <circle cx="32" cy="34" r="24" fill="url(#rslipClockRim)" />
      <circle cx="32" cy="34" r="19.5" fill="url(#rslipClockFace)" stroke="#C6912A" strokeWidth="1.5" />
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const x1 = 32 + Math.sin(angle) * 16.5;
        const y1 = 34 - Math.cos(angle) * 16.5;
        const x2 = 32 + Math.sin(angle) * 14;
        const y2 = 34 - Math.cos(angle) * 14;
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#B08628" strokeWidth={i % 3 === 0 ? 1.4 : 0.8} strokeLinecap="round" />
        );
      })}
      <line x1="32" y1="34" x2={hourHand.x2} y2={hourHand.y2} stroke="#3F2E10" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="32" y1="34" x2={minHand.x2} y2={minHand.y2} stroke="#3F2E10" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="32" y1="34" x2={secHand.x2} y2={secHand.y2} stroke="#D64545" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="32" cy="34" r="2.2" fill="#3F2E10" />
    </svg>
  );
}

/* ── Realistic exam-slip icon — a true-to-life 3D admit card artwork ───────
   Rendered fully in SVG (gradients, depth, gloss, QR modules, gold seal)
   with a gentle float animation. Used above "Find Your Roll No. Slip".   */
function RealisticSlipIcon({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <span className={`inline-block ${className}`} style={{ animation: "slipIconFloat 3.4s ease-in-out infinite" }}>
      <style>{`@keyframes slipIconFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}`}</style>
      <svg viewBox="0 0 96 96" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Roll number slip">
        <defs>
          <linearGradient id="slipPaper" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F5F0E1" />
          </linearGradient>
          <linearGradient id="slipHeader" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1C5F48" />
            <stop offset="100%" stopColor="#2F7D5F" />
          </linearGradient>
          <linearGradient id="slipPhoto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E9EFF3" />
            <stop offset="100%" stopColor="#C9D5DD" />
          </linearGradient>
          <linearGradient id="slipGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F6D365" />
            <stop offset="100%" stopColor="#C6912A" />
          </linearGradient>
          <clipPath id="slipClip">
            <rect x="20" y="6" width="56" height="78" rx="7" />
          </clipPath>
        </defs>

        {/* soft ground shadow */}
        <ellipse cx="48" cy="88" rx="24" ry="4.5" fill="#0F172A" opacity="0.16" />

        {/* ══ the slip card ══ */}
        <g>
          <rect x="20" y="6" width="56" height="78" rx="7" fill="url(#slipPaper)" stroke="#E0D8C0" strokeWidth="0.8" />

          <g clipPath="url(#slipClip)">
            {/* printed header band + gold hairline */}
            <rect x="20" y="6" width="56" height="20" fill="url(#slipHeader)" />
            <rect x="20" y="6" width="56" height="1.6" fill="#F4C550" opacity="0.9" />

            {/* school seal + name bars */}
            <circle cx="28" cy="16" r="4" fill="#F4C550" />
            <circle cx="28" cy="16" r="2.4" fill="none" stroke="#FFFFFF" strokeWidth="0.7" opacity="0.85" />
            <rect x="36" y="11.5" width="26" height="2.6" rx="1.3" fill="#FFFFFF" opacity="0.95" />
            <rect x="36" y="16.8" width="18" height="2" rx="1" fill="#FFFFFF" opacity="0.55" />

            {/* student photo box with silhouette */}
            <rect x="26" y="32" width="14" height="16" rx="2" fill="url(#slipPhoto)" stroke="#B4C2CC" strokeWidth="0.6" />
            <circle cx="33" cy="38" r="3" fill="#8FA3B0" />
            <path d="M27.5 47.5 Q33 40.5 38.5 47.5 Z" fill="#8FA3B0" />

            {/* detail lines beside the photo (gold = roll number row) */}
            <rect x="44" y="33" width="26" height="2.4" rx="1.2" fill="#C9D3DD" />
            <rect x="44" y="37.5" width="20" height="2.4" rx="1.2" fill="#C9D3DD" />
            <rect x="44" y="42.5" width="24" height="3" rx="1.5" fill="#E0B64F" />

            {/* section divider */}
            <line x1="26" y1="53" x2="70" y2="53" stroke="#E5DECB" strokeWidth="0.8" />

            {/* QR code block */}
            <rect x="26" y="57" width="16" height="16" rx="1.5" fill="#FFFFFF" stroke="#C9C2AD" strokeWidth="0.7" />
            <rect x="27.8" y="58.8" width="4.6" height="4.6" fill="#2B3440" />
            <rect x="28.9" y="59.9" width="2.4" height="2.4" fill="#FFFFFF" />
            <rect x="29.5" y="60.5" width="1.2" height="1.2" fill="#2B3440" />
            <rect x="35.6" y="58.8" width="4.6" height="4.6" fill="#2B3440" />
            <rect x="36.7" y="59.9" width="2.4" height="2.4" fill="#FFFFFF" />
            <rect x="37.3" y="60.5" width="1.2" height="1.2" fill="#2B3440" />
            <rect x="27.8" y="66.6" width="4.6" height="4.6" fill="#2B3440" />
            <rect x="28.9" y="67.7" width="2.4" height="2.4" fill="#FFFFFF" />
            <rect x="29.5" y="68.3" width="1.2" height="1.2" fill="#2B3440" />
            <rect x="34" y="64.6" width="1.3" height="1.3" fill="#2B3440" />
            <rect x="37.4" y="66" width="1.3" height="1.3" fill="#2B3440" />
            <rect x="34.8" y="68.8" width="1.3" height="1.3" fill="#2B3440" />
            <rect x="38.6" y="63.2" width="1.3" height="1.3" fill="#2B3440" />
            <rect x="34.6" y="70.2" width="1.3" height="1.3" fill="#2B3440" />

            {/* detail lines beside the QR + verified pill */}
            <rect x="46" y="58" width="20" height="2" rx="1" fill="#D4D9E2" />
            <rect x="46" y="62" width="15" height="2" rx="1" fill="#D4D9E2" />
            <rect x="46" y="66" width="18" height="2" rx="1" fill="#D4D9E2" />
            <rect x="46" y="70" width="14" height="3" rx="1.5" fill="#34D399" opacity="0.85" />

            {/* diagonal gloss across the top-left */}
            <path d="M20 36 L60 6 L70 6 L20 46 Z" fill="#FFFFFF" opacity="0.20" />
          </g>

          {/* gold wax-seal badge overlapping the bottom-right corner */}
          <path d="M64.5 80 L66.5 86 L69 83.2 L71.5 86 L73.5 80 Z" fill="#C6912A" />
          <circle cx="69" cy="76" r="6.5" fill="url(#slipGold)" stroke="#B8860B" strokeWidth="0.6" />
          <circle cx="69" cy="76" r="4.4" fill="none" stroke="#FFFFFF" strokeWidth="0.7" opacity="0.75" />
          <circle cx="69" cy="76" r="1.6" fill="#8A6416" opacity="0.55" />
        </g>
      </svg>
    </span>
  );
}

/* ── Countdown unit tile — bold colour-coded digits (reference style) ────── */
function CountdownUnit({ value, label }: { value: number; label: string }) {
  const names: Record<string, string> = { d: "Days", h: "Hours", m: "Min", s: "Sec" };
  return (
    <div className="flex min-w-[62px] flex-col items-center rounded-2xl border border-red-200 bg-white px-3 py-2.5 shadow-sm dark:border-red-500/30 dark:bg-red-500/10 md:min-w-[84px] md:py-3.5">
      <span className="font-mono text-3xl font-black tabular-nums leading-none !text-red-600 dark:!text-red-400 md:text-5xl">
        {String(Math.max(0, value)).padStart(2, "0")}
      </span>
      <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.16em] !text-red-500/80 dark:!text-red-300/80 md:text-xs">
        {names[label] ?? label}
      </span>
    </div>
  );
}

/* ═══ SLIP PDF — EXACT replica of the admin dashboard "Roll No Slips" sheet ═
   Full-page A4 PORTRAIT single slip (admin prints 2-up landscape) — same
   header, info rows, QR, class date-sheet table, 9 instructions and Deputy
   Controller signature — so the student's download is 1:1 identical to the
   office copy. The single slip is simply centred on the sheet.            */
async function downloadSlipPdf(session: ExamSession, r: RollEntry, schedule: ExamScheduleEntry[]) {
  // Student copy: ONE slip on a full A4 PORTRAIT page (the admin sheet is a
  // 2-up landscape print; students get a full-size single page instead).
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;

  const x = margin;
  const y = margin;
  const w = pageW - margin * 2;
  const h = pageH - margin * 2;

  // Same QR payload + settings as the admin sheet
  const qrData = encodeExamQRData(session.id, r.student_id, r.exam_roll_no);
  const qrImg = await QRCode.toDataURL(qrData, { width: 300, margin: 1, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#FFFFFF" } });

  // ── Same layout as the admin sheet (see AdminExamRollNumbers.downloadPrint) ──
  const padX = 12;
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
  doc.setFontSize(20);
  doc.text("GOVT. HIGH SCHOOL BABI KHEL", cx, y + 16, { align: "center" });

  doc.setFontSize(13);
  doc.setTextColor(60, 60, 60);
  const classExamType = schedule[0]?.exam_type || session.exam_term;
  doc.text(`${examTypeLabel(classExamType).toUpperCase()} ${session.exam_year}`, cx, y + 24, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 110);
  doc.text("EXAM  ROLL  NUMBER  SLIP", cx, y + 30, { align: "center", charSpace: 0.6 } as any);

  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.7);
  doc.line(x + padX, y + 34, x + w - padX, y + 34);
  doc.setLineWidth(0.2);
  doc.line(x + padX, y + 35.3, x + w - padX, y + 35.3);

  // ── STUDENT INFO (left) + QR (right) ──
  const qrSize = 42;
  const qrBoxX = x + w - padX - qrSize - 2;
  const qrBoxY = y + 42;
  const leftX = x + padX;
  const valX = leftX + 36;
  const maxValW = qrBoxX - valX - 4;

  const drawRow = (label: string, value: string, yy: number, big = false) => {
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(115, 115, 115);
    doc.text(label, leftX, yy);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(big ? 15 : 12);
    let v = value;
    while (v.length > 4 && doc.getTextWidth(v) > maxValW) v = v.slice(0, -2);
    if (v !== value) v = v.replace(/\s+$/, "") + "…";
    doc.text(v, valX, yy);
  };
  let rowY = y + 52;
  const rowGap = 11;
  drawRow("Student Name:", r.student_name, rowY); rowY += rowGap;
  drawRow("Father Name:", r.father_name || "—", rowY); rowY += rowGap;
  drawRow("Exam Roll No:", r.exam_roll_no, rowY, true); rowY += rowGap;
  drawRow("Class:", `Class ${r.class}`, rowY);

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
  const tableStartY = y + 94;
  const sigY = y + h - 14;
  const instrLines = SLIP_INSTRUCTIONS.length;
  const instrLineH = 6;
  const instrH = 9 + instrLines * instrLineH;
  const sigTop = sigY - 9;
  const tableAvail = sigTop - instrH - 6 - tableStartY;
  const nRows = Math.max(schedule.length, 1) + 1;
  const rowMm = Math.min(10, Math.max(5, tableAvail / nRows));
  const fontPt = rowMm >= 8 ? 10 : rowMm >= 6.6 ? 9 : rowMm >= 5.8 ? 7.8 : 7;
  const cellPad = Math.max(1, (rowMm - fontPt * 0.352 * 1.15) / 2);

  if (schedule.length > 0) {
    autoTable(doc, {
      startY: tableStartY,
      margin: { left: x + padX, right: pageW - (x + w) + padX, bottom: pageH - sigTop },
      tableWidth: w - padX * 2,
      head: [["Paper Date", "Day", "Subject", "From", "To"]],
      body: schedule.map(e => [
        format(new Date(e.exam_date), "dd-MM-yyyy"),
        format(new Date(e.exam_date), "EEEE"),
        e.subject,
        e.start_time || "—",
        e.end_time || "—",
      ]),
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 32 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 } },
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
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Instructions:", x + padX, instrStartY + 6);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(85, 85, 85);
  const instructions = SLIP_INSTRUCTIONS;
  const maxInstrW = w - padX * 2;
  instructions.forEach((line, i) => {
    let t = line;
    while (t.length > 8 && doc.getTextWidth(t) > maxInstrW) t = t.slice(0, -2);
    if (t !== line) t = t.replace(/\s+$/, "") + "…";
    doc.text(t, x + padX, instrStartY + 12.5 + i * instrLineH);
  });

  // ── SIGNATURE (anchored bottom-right) ──
  doc.setDrawColor(90, 90, 90);
  doc.setLineWidth(0.35);
  doc.line(x + w - padX - 60, sigY, x + w - padX, sigY);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("Deputy Controller of Exams", x + w - padX - 30, sigY + 5, { align: "center" });

  doc.save(`RollNoSlip-${r.exam_roll_no}-${r.student_name.replace(/\s+/g, "_")}.pdf`);
}

/* ═══ MAIN COMPONENT ═══════════════════════════════════════════════════════ */
const ExamRollNumbers = () => {
  const qc = useQueryClient();
  const now = useNowTick(1000);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  /* ── Exam Date Sheet (exam_schedule table) — the SAME source the admin
        dashboard prints on the official Roll No Slips, pulled here so the
        student's slip can carry the identical paper-by-paper schedule ──── */
  const { data: allExamSchedule = [] } = useAllExamSchedule();

  /* ── Sessions: published ones + scheduled ones (countdown running) ────── */
  const { data: sessions = [], isLoading: loadingSessions } = useQuery<ExamSession[]>({
    queryKey: ["public-roll-slip-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_roll_sessions")
        .select("*")
        .or("is_published.eq.true,publish_at.not.is.null")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  });

  /* ── Status helpers (tick-driven → countdown end flips UI instantly) ──── */
  const visible = useMemo(() => sessions.filter(s => isScheduled(s, now) || isLive(s, now)), [sessions, now]);
  const liveSessions = useMemo(() => visible.filter(s => isLive(s, now)), [visible, now]);
  const scheduledSessions = useMemo(() => visible.filter(s => isScheduled(s, now)), [visible, now]);

  // Manual pick wins while valid; otherwise first live session, else first
  // scheduled one (so a running countdown is what students land on).
  const selectedSession = useMemo(
    () => visible.find(s => s.id === selectedSessionId) || liveSessions[0] || scheduledSessions[0] || null,
    [visible, liveSessions, scheduledSessions, selectedSessionId]
  );

  /* ── Roll numbers: PRE-FETCHED even during the countdown so the flip to
        the finder at 0:00 is instant (data already on the device) ────────── */
  const { data: rollNumbers = [], isLoading: loadingRolls } = useQuery<RollEntry[]>({
    queryKey: ["public-exam-rolls", selectedSession?.id],
    queryFn: async () => {
      if (!selectedSession) return [];
      const { data, error } = await supabase
        .from("exam_roll_numbers")
        .select("id, student_id, student_name, father_name, class, class_roll_no, exam_roll_no, serial_number")
        .eq("session_id", selectedSession.id)
        .order("serial_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedSession,
    staleTime: 5 * 60 * 1000,
  });

  /* ── Legacy self-heal: old stuck sessions (countdown expired but never
        flipped) get published in the DB on a best-effort basis ───────────── */
  const healedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const s of sessions) {
      if (s.is_published || !s.publish_at) continue;
      const t = new Date(s.publish_at).getTime();
      if (t <= now && !healedRef.current.has(s.id)) {
        healedRef.current.add(s.id);
        supabase
          .from("exam_roll_sessions")
          .update({ is_published: true })
          .eq("id", s.id)
          .eq("is_published", false)
          .then(({ error }) => {
            if (!error) qc.invalidateQueries({ queryKey: ["public-roll-slip-sessions"] });
          });
      }
    }
  }, [sessions, now, qc]);

  const showCountdown = !!selectedSession && isScheduled(selectedSession, now);

  return (
    <PageLayout>
      <PageBanner
        variant="premium"
        compact
        eyebrow="GHS Babi Khel"
        icon={<Hash className="w-5 h-5 md:w-6 md:h-6" />}
        title="Roll No. Slip"
        subtitle="Find your exam roll number and download your admit card"
      />

      <section className="py-8 md:py-12">
        <div className="container mx-auto px-4">

          {loadingSessions ? (
            <div className="flex gap-3 mb-8">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-36 rounded-xl" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-20">
              <Hash className="w-14 h-14 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="font-heading font-semibold text-foreground text-lg">No Roll No. Slips Yet</h3>
              <p className="text-muted-foreground text-sm mt-1">Exam roll number slips will appear here once published by admin</p>
            </div>
          ) : (
            <>
              {/* Session switcher (only when more than one) */}
              {visible.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-8">
                  {visible.map(s => {
                    const sched = isScheduled(s, now);
                    const active = selectedSession?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSessionId(s.id)}
                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all border-2 ${
                          active
                            ? "gradient-hero text-white border-gold shadow-card"
                            : "bg-card text-muted-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        {sched && <Clock3 className="w-3.5 h-3.5 text-amber-500" />}
                        {s.title} — {s.exam_year}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedSession && (showCountdown ? (
                /* ═══ SCHEDULED — premium countdown (Merit-List style) ═══ */
                <motion.div
                  variants={fadeUp}
                  initial="hidden"
                  animate="visible"
                  className="relative overflow-hidden rounded-3xl border-2 border-gold/40 bg-gradient-to-br from-gold/10 via-card to-gold/5 p-8 text-center shadow-elevated max-w-2xl mx-auto"
                >
                  <div className="orb orb-gold w-56 h-56 -top-20 left-1/2 -translate-x-1/2 opacity-60" />
                  <div className="relative">
                    {(() => {
                      const target = new Date(selectedSession.publish_at!).getTime();
                      const diff = target - now;
                      const days = Math.floor(diff / 86400000);
                      const hours = Math.floor((diff % 86400000) / 3600000);
                      const mins = Math.floor((diff % 3600000) / 60000);
                      const secs = Math.floor((diff % 60000) / 1000);
                      return (
                        <>
                          {/* Clock hands show the REAL current time-of-day,
                              ticking normally toward the target time — not
                              the remaining countdown duration. */}
                          <span className="w-16 h-16 mx-auto mb-5 flex items-center justify-center"><RealisticClockIcon className="w-14 h-14" hours={new Date(now).getHours()} minutes={new Date(now).getMinutes()} seconds={new Date(now).getSeconds()} /></span>
                          <p className="text-xs md:text-sm font-black uppercase tracking-[0.2em] text-amber-700 dark:text-amber-500 mb-2">
                            Time Remaining
                          </p>
                          <div className="flex justify-center items-stretch gap-2 md:gap-3 flex-wrap mb-3">
                            {days > 0 && <CountdownUnit value={days} label="d" />}
                            <CountdownUnit value={hours} label="h" />
                            <CountdownUnit value={mins} label="m" />
                            <CountdownUnit value={secs} label="s" />
                          </div>
                        </>
                      );
                    })()}
                    <h2 className="text-lg md:text-xl font-heading font-bold text-foreground mt-4">{selectedSession.title}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {examTypeLabel(selectedSession.exam_term)} · Classes {selectedSession.class_order.join(", ")} · Year {selectedSession.exam_year}
                    </p>
                    <p className="text-xs text-muted-foreground mt-4 mb-1 font-medium">
                      Goes live {format(new Date(selectedSession.publish_at!), "EEEE, dd MMMM yyyy 'at' h:mm a")}
                    </p>
                    {selectedSession.countdown_label && (
                      <p className="text-xs text-muted-foreground mt-6 italic max-w-md mx-auto">"{selectedSession.countdown_label}"</p>
                    )}
                    <p className="inline-flex items-center gap-2 mt-6 text-[11px] font-semibold text-amber-700 dark:text-amber-500 bg-amber-600/10 border border-amber-600/20 rounded-full px-4 py-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
                      Slips open here automatically — no refresh needed
                    </p>
                  </div>
                </motion.div>
              ) : (
                /* ═══ LIVE — premium slip finder ═══ */
                <SlipFinder
                  key={selectedSession.id}
                  session={selectedSession}
                  rolls={rollNumbers}
                  loading={loadingRolls}
                  schedule={allExamSchedule}
                />
              ))}
            </>
          )}
        </div>
      </section>
    </PageLayout>
  );
};

/* ═══ MY SEAT — generated exam seating for ONE student ═══════════════════════
   Reads ONLY this student's own assignment rows (never the whole hall), then
   the matching plan + room. No published seat → nothing is shown at all.   */
interface MySeatInfo {
  plan: SeatingPlan;
  room: SeatingRoom;
  seat: SeatingAssignment;
  subject: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  startTime: string | null;
  endTime: string | null;
}

const toDay = (v?: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};
const fmtTime = (t?: string | null) => {
  if (!t) return null;
  const d = new Date(`2000-01-01T${String(t).slice(0, 5)}:00`);
  return isNaN(d.getTime()) ? String(t) : format(d, "h:mm a");
};

async function fetchMySeats(session: ExamSession, r: RollEntry): Promise<MySeatInfo[]> {
  const safe = (v: string) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  const parts: string[] = [];
  if (r.student_id) parts.push(`student_id.eq.${safe(r.student_id)}`);
  if (r.exam_roll_no) parts.push(`exam_roll_no.eq.${safe(r.exam_roll_no)}`);
  if (parts.length === 0) return [];

  // ONE round-trip: each seat row comes back with its plan and room embedded.
  const { data: asg, error: aErr } = await supabase
    .from("exam_seating_assignments")
    .select("*, plan:exam_seating_plans(*), room:exam_seating_rooms(*)")
    .or(parts.join(","));
  if (aErr) {
    console.error("[MySeat] could not read seating:", aErr.code, aErr.message);
    throw aErr;
  }
  if (!asg || asg.length === 0) {
    console.info("[MySeat] no seat rows for this student (not seated yet, or the table is not readable by visitors)");
    return [];
  }

  const out: MySeatInfo[] = [];
  for (const row of asg as any[]) {
    const { plan: planRaw, room: roomRaw, ...rest } = row;
    const a = rest as SeatingAssignment;
    const plan = (Array.isArray(planRaw) ? planRaw[0] : planRaw) as SeatingPlan | null;
    const room = (Array.isArray(roomRaw) ? roomRaw[0] : roomRaw) as SeatingRoom | null;
    if (!plan || !room) {
      console.warn("[MySeat] seat row found but plan/room is not readable by visitors (RLS/grants)");
      continue;
    }
    // There is no publish step for seating any more: every generated plan is
    // live for students. Only drafts (no seats yet) and archived plans stay hidden.
    if (plan.status !== "generated" && plan.status !== "published") {
      console.info(`[MySeat] plan "${plan.title}" has status="${plan.status}" — generate seating in Admin → Exam Seating`);
      continue;
    }
    // Same student only: exact student id, or same exam roll no + class inside this session
    const mine =
      (!!r.student_id && String(a.student_id) === String(r.student_id)) ||
      (String(a.exam_roll_no) === String(r.exam_roll_no) && a.class === r.class && plan.session_id === session.id);
    if (!mine) continue;

    const paper = resolveClassPaperTime(plan, r.class);
    const rangeFrom = toDay(plan.exam_date_from);
    const rangeTo = toDay(plan.exam_date_to);
    const single = toDay(paper.examDate);
    out.push({
      plan, room, seat: a,
      subject: paper.subject,
      dateFrom: rangeFrom && rangeTo ? rangeFrom : single,
      dateTo: rangeFrom && rangeTo ? rangeTo : single,
      startTime: paper.startTime,
      endTime: paper.endTime,
    });
  }
  out.sort((x, y) => (x.dateFrom?.getTime() ?? 9e15) - (y.dateFrom?.getTime() ?? 9e15));
  return out;
}

/* Mini hall map — the student's desk glows gold; other desks stay anonymous */
function SeatMap({ room, row, col }: { room: SeatingRoom; row: number; col: number }) {
  const blocked = new Set((room.block_layout || []).map(([rr, cc]) => `${rr}:${cc}`));
  const cols = Math.max(1, room.cols || 1);
  const rows = Math.max(1, room.rows || 1);
  return (
    <div className="mx-auto w-full" style={{ maxWidth: `${Math.min(cols * 30 + (cols - 1) * 3, 280)}px` }}>
      <div className="mb-1.5 flex items-center justify-center">
        <span className="rounded-full border border-border bg-muted/60 px-3 py-px text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Front · Board
        </span>
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows * cols }).map((_, i) => {
          const rr = Math.floor(i / cols);
          const cc = i % cols;
          const isMe = rr === row && cc === col;
          const isBlocked = blocked.has(`${rr}:${cc}`);
          return (
            <div
              key={i}
              className={`relative flex aspect-square items-center justify-center rounded-[4px] text-[7px] font-black ${
                isMe
                  ? "z-10 scale-105 bg-gradient-to-br from-[#F4C550] to-[#C6912A] text-[#3A2A06] shadow-[0_0_0_2px_hsl(var(--background)),0_6px_14px_-4px_rgba(198,145,42,0.9)]"
                  : isBlocked
                    ? "border border-dashed border-border/70 bg-transparent"
                    : "bg-primary/15 dark:bg-primary/25"
              }`}
              aria-label={isMe ? "Your seat" : undefined}
            >
              {isMe && "YOU"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeatCard({ info, className }: { info: MySeatInfo; className: string }) {
  const { room, seat, plan } = info;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = !!info.dateTo && info.dateTo.getTime() < today.getTime();
  const isRange = !!info.dateFrom && !!info.dateTo && info.dateFrom.getTime() !== info.dateTo.getTime();
  const dateLabel = info.dateFrom
    ? isRange
      ? `${format(info.dateFrom, "dd MMM")} – ${format(info.dateTo!, "dd MMM yyyy")}`
      : format(info.dateFrom, "EEE, dd MMM yyyy")
    : null;
  const timeLabel = info.startTime
    ? `${fmtTime(info.startTime)}${info.endTime ? ` – ${fmtTime(info.endTime)}` : ""}`
    : null;
  // A date-range plan seats the student for EVERY paper in the range, so one
  // subject name would be misleading — show "All Papers" instead.
  const title = isRange ? "All Papers" : (info.subject || plan.paper_subject || plan.title);

  return (
    <div className={`overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card ${done ? "opacity-70" : ""} ${className}`}>
      {/* paper header */}
      <div className="relative gradient-hero px-3.5 py-2.5 text-white">
        <div className="absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold">{isRange ? "Same seat every day" : "Paper"}</p>
            <h4 className="mt-0.5 break-words font-heading text-sm font-bold leading-snug">{title}</h4>
          </div>
          {done && (
            <span className="shrink-0 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">Done</span>
          )}
        </div>
        {(dateLabel || timeLabel) && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/85">
            {dateLabel && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3 text-gold" />{dateLabel}</span>}
            {timeLabel && <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3 text-gold" />{timeLabel}</span>}
          </div>
        )}
      </div>

      {/* seat facts */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        {[
          { k: "Room", v: room.name },
          { k: "Row", v: String(seat.row_idx + 1) },
          { k: "Seat", v: String(seat.col_idx + 1) },
        ].map(f => (
          <div key={f.k} className="min-w-0 px-2 py-2 text-center">
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{f.k}</p>
            <p className="break-words font-heading text-base font-extrabold leading-tight text-foreground">{f.v}</p>
          </div>
        ))}
      </div>

      {/* hall map */}
      <div className="px-4 py-3">
        <SeatMap room={room} row={seat.row_idx} col={seat.col_idx} />
        <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
          Seat code <span className="font-mono font-bold text-foreground">{seat.seat_label}</span>
        </p>
        {room.notes && (
          <p className="mt-1.5 break-words text-center text-[11px] leading-snug text-muted-foreground">{room.notes}</p>
        )}
      </div>
    </div>
  );
}

/* ═══ SLIP FINDER — class + full-name search, one student at a time ════════ */
interface SlipResult {
  entry: RollEntry;
  qrDataURL: string;
}

function SlipFinder({ session, rolls, loading, schedule }: {
  session: ExamSession;
  rolls: RollEntry[];
  loading: boolean;
  schedule: ExamScheduleEntry[];
}) {
  const classes = session.class_order?.length ? session.class_order : ["6", "7", "8", "9", "10"];
  const [selectedClass, setSelectedClass] = useState<string>(classes[0] || "6");
  const [fullName, setFullName] = useState("");
  const [matches, setMatches] = useState<RollEntry[] | null>(null);
  const [activeSlip, setActiveSlip] = useState<SlipResult | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const typed = fullName.trim();
  // A name needs 2+ letters; a roll number (digits only) can be a single digit.
  const canSearch = /^\d+$/.test(typed) ? typed.length >= 1 : typed.length >= 2;

  /* ── My Seat — fetched only for the open slip; button appears ONLY when a
        published seat exists for this student ─────────────────────────── */
  const [showSeat, setShowSeat] = useState(false);
  const seatEntry = activeSlip?.entry;
  const seatQuery = useQuery<MySeatInfo[]>({
    queryKey: ["slip-my-seat", session.id, seatEntry?.student_id, seatEntry?.exam_roll_no],
    queryFn: () => fetchMySeats(session, seatEntry!),
    enabled: !!seatEntry,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });
  const mySeats = seatQuery.data ?? [];

  /* ── Per-class date sheet — IDENTICAL fallback logic to the admin
        dashboard's Roll No Slips PDF (exact exam_type match first, then any
        exam_type that class actually has scheduled for this year) ──────── */
  const scheduleForClass = (cls: string): ExamScheduleEntry[] => {
    let rows = schedule
      .filter(e => e.class === cls && e.exam_type === session.exam_term && e.year === session.exam_year)
      .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
    if (rows.length === 0) {
      rows = schedule
        .filter(e => e.class === cls && e.year === session.exam_year)
        .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
    }
    return rows;
  };

  const qcSeat = useQueryClient();
  const openSlip = async (r: RollEntry) => {
    // Start loading the seat NOW — it runs in parallel with QR generation,
    // so My Seat is ready by the time the slip appears.
    qcSeat.prefetchQuery({
      queryKey: ["slip-my-seat", session.id, r.student_id, r.exam_roll_no],
      queryFn: () => fetchMySeats(session, r),
      staleTime: 60 * 1000,
    });
    setQrBusy(true);
    try {
      const qrData = encodeExamQRData(session.id, r.student_id, r.exam_roll_no);
      const qrDataURL = await QRCode.toDataURL(qrData, { width: 400, margin: 1, errorCorrectionLevel: "M", color: { dark: "#333333", light: "#FFFFFF" } });
      setActiveSlip({ entry: r, qrDataURL });
      triggerConfetti("burst");
    } catch {
      toast.error("Could not prepare the slip — please try again");
    }
    setQrBusy(false);
  };

  const handleSearch = () => {
    const raw = fullName.trim();
    const q = normName(raw);
    if (!q) return;
    // Digits only → exam roll no. (any class) or class roll no. (selected class); else name search
    const found = /^\d+$/.test(raw)
      ? rolls.filter(r => String(r.exam_roll_no).trim() === raw || (r.class === selectedClass && String(r.class_roll_no).trim() === raw))
      : rolls.filter(r => r.class === selectedClass && normName(r.student_name).includes(q));
    setMatches(found);
    setActiveSlip(null);
    if (found.length === 1) openSlip(found[0]); // exact one → straight to the slip
    if (found.length === 0) toast.error("No student found — check the class, name or roll no.");
  };

  const resetFinder = () => {
    setShowSeat(false);
    setMatches(null);
    setActiveSlip(null);
    setFullName("");
  };

  const handleDownload = async (r: RollEntry) => {
    setDownloading(true);
    try {
      await downloadSlipPdf(session, r, scheduleForClass(r.class));
      toast.success("Roll No. Slip downloaded!");
    } catch {
      toast.error("Failed to generate slip PDF");
    }
    setDownloading(false);
  };

  /* ── Share — renders the student's slip as a beautiful school-branded
        card IMAGE (green official header, roll no, class, exam) and sends
        it through the Web Share API together with the /roll-no-slip link,
        so the shared post looks like an official document — never plain
        text. Fallbacks: text share → download + clipboard. ─────────────── */
  const [sharingSlip, setSharingSlip] = useState(false);
  const shareSlip = async (r: RollEntry) => {
    if (sharingSlip) return;
    setSharingSlip(true);
    try {
      const examLabel = `${examTypeLabel(scheduleForClass(r.class)[0]?.exam_type || session.exam_term)} ${session.exam_year}`;
      const outcome = await shareRollSlipCard({
        studentName: r.student_name,
        fatherName: r.father_name || "—",
        rollNo: r.exam_roll_no,
        className: r.class,
        examLabel,
      });
      toastShareOutcome(outcome);
    } catch {
      toast.error("Could not prepare the share card — please try again");
    }
    setSharingSlip(false);
  };

  /* ── Result: the student's own slip — an exact on-screen replica of the
        admin dashboard "Roll No Slips" print (header, info + QR, class date
        sheet, instructions, Deputy Controller signature) in a premium frame */
  if (activeSlip) {
    const r = activeSlip.entry;
    const slipSchedule = scheduleForClass(r.class);
    const classExamType = slipSchedule[0]?.exam_type || session.exam_term;
    return (
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="max-w-xl mx-auto">
        {/* Premium gold frame around the true-to-print slip */}
        <div className="relative overflow-hidden rounded-3xl border-2 border-gold/40 bg-gradient-to-br from-gold/10 via-card to-gold/5 shadow-elevated">
          <div className="orb orb-gold w-44 h-44 -top-16 -right-12 opacity-40 pointer-events-none" />

          {/* ══ THE SLIP — mirrors the admin PDF artwork 1:1 ══ */}
          <div className="relative m-2.5 rounded-2xl border border-[#c9c9c9] bg-white text-[#1e1e1e] shadow-inner overflow-hidden">
            {/* header — same three lines as the printed slip */}
            <div className="text-center px-4 pt-4 pb-2.5">
              <p className="text-[15px] leading-tight font-black tracking-wide text-[#1e1e1e]">GOVT. HIGH SCHOOL BABI KHEL</p>
              <p className="text-[10px] font-bold text-[#464646] mt-0.5 tracking-wide">
                {examTypeLabel(classExamType).toUpperCase()} {session.exam_year}
              </p>
              <p className="text-[8px] text-[#787878] mt-0.5 tracking-[0.18em]">EXAM ROLL NUMBER SLIP</p>
              <div className="mt-2 border-t-2 border-[#5a5a5a]" />
            </div>

            <div className="px-4 pb-3">
              {/* student info (left) + QR (right) — same rows as the print */}
              <div className="flex items-start justify-between gap-4 mt-2.5">
                <div className="flex-1 min-w-0 space-y-[7px]">
                  {[
                    { label: "Student Name:", value: r.student_name },
                    { label: "Father Name:", value: r.father_name || "—" },
                    { label: "Exam Roll No:", value: r.exam_roll_no },
                    { label: "Class:", value: `Class ${r.class}` },
                  ].map(row => (
                    <div key={row.label} className="flex items-baseline text-[11px] leading-snug">
                      <span className="w-[92px] shrink-0 text-[#6e6e6e]">{row.label}</span>
                      <span className="font-bold text-[#1e1e1e] break-words">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="shrink-0 rounded-lg border border-[#b4b4b4] p-1 bg-white">
                  <img src={activeSlip.qrDataURL} alt="Attendance QR code" className="w-[84px] h-[84px]" />
                </div>
              </div>

              {/* date sheet — the student's real paper schedule, or the same
                  "not yet published" note the print shows */}
              {slipSchedule.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-[9.5px]">
                    <thead>
                      <tr className="bg-[#ebebeb] text-[#282828]">
                        {["Paper Date", "Day", "Subject", "From", "To"].map(h => (
                          <th key={h} className="border border-[#b4b4b4] px-1.5 py-1 font-bold text-center whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slipSchedule.map((e, i) => (
                        <tr key={e.id} className={i % 2 === 1 ? "bg-[#fafafa]" : "bg-white"}>
                          <td className="border border-[#b4b4b4] px-1.5 py-[3px] text-center whitespace-nowrap">{format(new Date(e.exam_date), "dd-MM-yyyy")}</td>
                          <td className="border border-[#b4b4b4] px-1.5 py-[3px] text-center whitespace-nowrap">{format(new Date(e.exam_date), "EEEE")}</td>
                          <td className="border border-[#b4b4b4] px-1.5 py-[3px] text-center">{e.subject}</td>
                          <td className="border border-[#b4b4b4] px-1.5 py-[3px] text-center whitespace-nowrap">{e.start_time || "—"}</td>
                          <td className="border border-[#b4b4b4] px-1.5 py-[3px] text-center whitespace-nowrap">{e.end_time || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 mb-1 text-center italic text-[10px] text-[#969696]">Date sheet not yet published for this class.</p>
              )}

              {/* instructions — the exact 9 rules from the printed slip */}
              <div className="mt-3 border-t border-[#969696] pt-1.5">
                <p className="text-[9.5px] font-bold text-[#464646]">Instructions:</p>
                <div className="mt-1 space-y-[3px]">
                  {SLIP_INSTRUCTIONS.map(line => (
                    <p key={line} className="text-[9px] leading-snug text-[#6e6e6e]">{line}</p>
                  ))}
                </div>
              </div>

              {/* signature — anchored at the slip bottom like the print */}
              <div className="mt-5 flex justify-end">
                <div className="w-40 text-center">
                  <div className="border-t border-[#787878]" />
                  <p className="text-[9px] font-bold text-[#3c3c3c] mt-1">Deputy Controller of Exams</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions — ONE line: Download Slip · My Seat (only if a seat exists) · Share */}
        <div className="mt-4 flex items-center gap-1.5">
          <button
            onClick={() => handleDownload(r)}
            disabled={downloading}
            className="flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-primary to-primary-glow px-2 text-[12.5px] font-bold text-primary-foreground shadow-card transition-all hover:shadow-elevated active:scale-[0.98] disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
            Download Slip
          </button>
          {mySeats.length > 0 && (
            <button
              onClick={() => setShowSeat(v => !v)}
              aria-expanded={showSeat}
              className={`flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-[12.5px] font-bold transition-all active:scale-[0.98] ${
                showSeat
                  ? "border-gold/60 bg-gold-soft/50 text-gold-strong dark:text-gold"
                  : "border-gold/50 bg-gradient-to-r from-[#B8860B] via-[#C99A1F] to-[#B8860B] text-white shadow-card hover:brightness-110"
              }`}
            >
              <Armchair className="h-4 w-4 shrink-0" />
              My Seat
              <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showSeat ? "rotate-180" : ""}`} />
            </button>
          )}
          <button
            onClick={() => shareSlip(r)}
            disabled={sharingSlip}
            aria-label="Share roll number slip card"
            title="Share your slip — beautiful card + website link"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/5 text-primary transition-all hover:bg-primary/10 active:scale-95 disabled:opacity-60"
          >
            {sharingSlip ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Share2 className="h-[18px] w-[18px]" />}
          </button>
        </div>

        {seatQuery.isLoading && (
          <Skeleton className="mt-2 h-8 w-full rounded-lg" />
        )}

        {seatQuery.isError && (
          <button
            onClick={() => seatQuery.refetch()}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-xs font-bold text-amber-700 transition-all active:scale-[0.98] dark:text-amber-400"
          >
            <AlertCircle className="h-4 w-4" /> Couldn’t load seat — tap to retry
          </button>
        )}

        {mySeats.length > 0 && (
          <div className="mt-2">
            {showSeat && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-3 space-y-3"
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg gradient-hero text-gold">
                    <DoorOpen className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-heading text-sm font-bold leading-tight text-foreground">Your Exam Seat</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">Reach your room 30 minutes early and sit on your marked desk</p>
                  </div>
                </div>
                {mySeats.map(info => (
                  <SeatCard key={`${info.plan.id}-${info.seat.id}`} info={info} className="" />
                ))}
              </motion.div>
            )}
          </div>
        )}

        <button
          onClick={resetFinder}
          className="mt-5 mx-auto flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Search another student
        </button>
      </motion.div>
    );
  }

  /* ── Single match whose QR isn't ready yet (rare retry state) ──────────── */
  if (matches && matches.length === 1 && !activeSlip) {
    const r = matches[0];
    return (
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="max-w-lg mx-auto">
        <button
          onClick={() => openSlip(r)}
          className="w-full text-left bg-card rounded-2xl p-4 shadow-card border border-border hover:border-primary/40 transition-colors flex items-center gap-3"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex flex-col items-center justify-center shrink-0">
            <span className="text-[8px] text-primary font-semibold leading-none">ROLL</span>
            <span className="text-primary font-bold text-[13px] leading-tight font-mono">{r.exam_roll_no}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-semibold text-foreground truncate text-sm">{r.student_name}</p>
            <p className="text-xs text-muted-foreground truncate">Class {r.class} · Class Roll No: {r.class_roll_no}</p>
          </div>
          <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-3 py-1.5 shrink-0">View Slip</span>
        </button>
        <button onClick={resetFinder} className="mt-4 mx-auto flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Search another student
        </button>
      </motion.div>
    );
  }

  /* ── Multiple matches with the same name — let the student pick ────────── */
  if (matches && matches.length > 1) {
    return (
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="max-w-lg mx-auto space-y-3">
        <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div>
            <p className="font-heading font-semibold text-foreground text-sm">{matches.length} students named "{fullName.trim()}" in Class {selectedClass}</p>
            <p className="text-xs text-muted-foreground">Tap your exact name to open your slip</p>
          </div>
        </div>
        {matches.slice(0, 10).map(r => (
          <button
            key={r.id}
            onClick={() => openSlip(r)}
            className="w-full text-left bg-card rounded-2xl p-4 shadow-card border border-border hover:border-primary/40 transition-colors flex items-center gap-3"
          >
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex flex-col items-center justify-center shrink-0">
              <span className="text-[8px] text-primary font-semibold leading-none">ROLL</span>
              <span className="text-primary font-bold text-[13px] leading-tight font-mono">{r.exam_roll_no}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-heading font-semibold text-foreground truncate text-sm">{r.student_name}</p>
              <p className="text-xs text-muted-foreground truncate">S/o {r.father_name || "—"} · Class Roll No: {r.class_roll_no}</p>
            </div>
            <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-3 py-1.5 shrink-0">View Slip</span>
          </button>
        ))}
        {matches.length > 10 && (
          <p className="text-center text-xs text-muted-foreground">Showing 10 of {matches.length} — type the full name to narrow it down</p>
        )}
        <button onClick={resetFinder} className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Search again
        </button>
      </motion.div>
    );
  }

  /* ── Not found ──────────────────────────────────────────────────────────── */
  if (matches && matches.length === 0) {
    return (
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="max-w-lg mx-auto">
        <div className="rounded-3xl border-2 border-amber-500/30 bg-amber-500/5 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h3 className="font-heading font-bold text-foreground">No slip found for "{fullName.trim()}"</h3>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            No student matches in <span className="font-semibold text-foreground">Class {selectedClass}</span>.
            Double-check the selected class and the spelling of your full name — it must match the school record.
          </p>
          <div className="flex items-center justify-center gap-2 mt-6">
            <button onClick={resetFinder} className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-primary/90 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Try Again
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  /* ── Default: the premium finder form ───────────────────────────────────── */
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="max-w-lg mx-auto">
      {/* Hero — with the realistic 3D slip artwork */}
      <div className="relative overflow-hidden rounded-[22px] gradient-hero text-white px-5 py-4 sm:py-5 text-center shadow-elevated mb-4 border border-gold/30">
        <div className="orb orb-gold w-52 h-52 -top-20 -right-14 opacity-90" />
        <div className="orb orb-light w-44 h-44 -bottom-20 -left-12" />
        <div className="absolute inset-0 dot-grid opacity-[0.10]" />
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        <div className="relative">
          <RealisticSlipIcon className="w-[48px] h-[48px] mx-auto mb-1.5 drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)]" />
          <h2 className="font-heading font-bold text-xl leading-tight">Find Your Roll No. Slip</h2>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-semibold text-on-hero">
            <CheckCircle2 className="w-3 h-3 text-gold" />
            {session.title} · {examTypeLabel(session.exam_term)} {session.exam_year}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
        </div>
      ) : rolls.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card p-8 text-center">
          <Hash className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-heading font-semibold text-foreground">Slips are being prepared</p>
          <p className="text-sm text-muted-foreground mt-1">Please check back a little later</p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[28px] border border-border bg-card shadow-elevated p-4 sm:p-5 space-y-4">
          {/* Step 1 — class */}
          <div>
            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground mb-2">
              <span className="w-5 h-5 rounded-full gradient-hero text-gold text-[10px] font-bold flex items-center justify-center">1</span>
              Select Your Class
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {classes.map(cls => {
                const active = selectedClass === cls;
                return (
                  <button
                    key={cls}
                    onClick={() => { setSelectedClass(cls); resetFinder(); }}
                    className={`w-14 sm:w-16 rounded-xl py-1.5 flex flex-col items-center gap-0 border-2 transition-all active:scale-95 ${
                      active
                        ? "gradient-hero text-white border-gold shadow-[0_10px_22px_-10px_hsl(var(--primary)/0.8)] -translate-y-0.5"
                        : "bg-muted/50 text-muted-foreground border-transparent hover:border-gold/40"
                    }`}
                  >
                    <span className="text-base font-black leading-none">{cls}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wide ${active ? "opacity-85" : "opacity-70"}`}>
                      {cls === "6" ? "6th" : cls === "7" ? "7th" : cls === "8" ? "8th" : cls === "9" ? "9th" : "10th"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 2 — full name */}
          <div>
            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground mb-2">
              <span className="w-5 h-5 rounded-full gradient-hero text-gold text-[10px] font-bold flex items-center justify-center">2</span>
              Full Name or Roll No.
            </p>
            <div className="relative">
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && canSearch) handleSearch(); }}
                placeholder="e.g. Muhammad Ahmad Khan or 100123"
                enterKeyHint="search"
                className="w-full h-11 px-4 rounded-xl border-2 border-border bg-muted/40 text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:bg-background focus:ring-4 focus:ring-gold/20 focus:border-gold outline-none transition-all"
              />
            </div>
          </div>

          {/* Search */}
          <button
            onClick={handleSearch}
            disabled={!canSearch || qrBusy}
            className="sheen mx-auto w-full max-w-[230px] h-9 inline-flex items-center justify-center gap-1.5 whitespace-nowrap gradient-hero text-white font-bold text-[13px] px-4 rounded-lg border border-gold/50 shadow-[0_8px_18px_-10px_hsl(var(--primary)/0.7)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {qrBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {qrBusy ? "Preparing your slip…" : "Search My Slip"}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground -mt-2">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            Your official slip appears instantly — same as the school office copy
          </p>
        </div>
      )}
    </motion.div>
  );
}

export default ExamRollNumbers;
