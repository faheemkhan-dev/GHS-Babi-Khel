import type { ExamScheduleEntry } from "@/hooks/useNewFeatures";

/**
 * Exam date sheet → calendar.
 *
 * Zero dependencies and fully client-side: builds a standards-compliant .ics
 * file (RFC 5545) with built-in reminders (VALARM) that every calendar app —
 * Google Calendar, Apple Calendar, Samsung, Outlook — understands. The phone's
 * calendar then fires the notifications itself, even offline and even when the
 * website is closed.
 *
 * Pakistan has a fixed UTC+5 offset (no daylight saving), so times are stored
 * as absolute UTC instants and appear correctly on any device.
 */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DEFAULT_PAPER_MS = 3 * 60 * 60 * 1000; // when the sheet has no end time
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderOption { id: string; label: string; minutes: number }
export const REMINDER_OPTIONS: ReminderOption[] = [
  { id: "1d",  label: "1 day before",    minutes: 1440 },
  { id: "3h",  label: "3 hours before",  minutes: 180 },
  { id: "1h",  label: "1 hour before",   minutes: 60 },
  { id: "30m", label: "30 min before",   minutes: 30 },
];
export const DEFAULT_REMINDERS = ["1d", "1h"];

export interface CalendarPaper {
  id: string;
  subject: string;
  /** YYYY-MM-DD as entered in the date sheet */
  day: string;
  start: Date | null; // null → all-day (date sheet has no start time)
  end: Date | null;
  startLabel: string | null;
  endLabel: string | null;
  hall: string | null;
  allDay: boolean;
}

/** "09:00", "09:00:00", "9:30 AM", "2:15pm" → {h, m}; anything else → null */
export function parseClock(t?: string | null): { h: number; m: number } | null {
  if (!t) return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

const label12 = (c: { h: number; m: number }) => {
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
  return `${h12}:${String(c.m).padStart(2, "0")} ${c.h < 12 ? "AM" : "PM"}`;
};

const pktInstant = (day: string, c: { h: number; m: number }) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, c.h, c.m) - PKT_OFFSET_MS);
};

export function buildPapers(entries: ExamScheduleEntry[]): CalendarPaper[] {
  const out: CalendarPaper[] = [];
  for (const e of entries) {
    const day = (e.exam_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const s = parseClock(e.start_time);
    const en = parseClock(e.end_time);
    const start = s ? pktInstant(day, s) : null;
    let end: Date | null = null;
    if (start) {
      end = en ? pktInstant(day, en) : new Date(start.getTime() + DEFAULT_PAPER_MS);
      if (end <= start) end = new Date(start.getTime() + DEFAULT_PAPER_MS);
    }
    out.push({
      id: e.id,
      subject: (e.paper_name || e.subject || "Paper").trim(),
      day, start, end,
      startLabel: s ? label12(s) : null,
      endLabel: en ? label12(en) : null,
      hall: e.hall,
      allDay: !start,
    });
  }
  return out.sort((a, b) => (a.start?.getTime() ?? pktInstant(a.day, { h: 0, m: 0 }).getTime()) - (b.start?.getTime() ?? pktInstant(b.day, { h: 0, m: 0 }).getTime()));
}

/** Papers that have not finished yet (all-day papers count until their day ends). */
export function upcomingPapers(papers: CalendarPaper[], now = Date.now()): CalendarPaper[] {
  return papers.filter((p) => (p.end ? p.end.getTime() : pktInstant(p.day, { h: 0, m: 0 }).getTime() + DAY_MS) > now);
}

export function hasUpcomingPapers(entries: ExamScheduleEntry[]): boolean {
  return upcomingPapers(buildPapers(entries)).length > 0;
}

// ── ICS ──────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const ymd = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const n = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}`;
};
const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 line folding at 75 octets (multi-byte safe). */
function fold(line: string): string {
  const enc = new TextEncoder();
  let out = "", cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 74) { out += cur + "\r\n "; cur = ""; bytes = 1; }
    cur += ch; bytes += b;
  }
  return out + cur;
}

export interface CalendarContext {
  studentName: string;
  rollNo: string;
  className: string;
  examLabel: string;
  siteUrl: string;
}

const detailsFor = (p: CalendarPaper, c: CalendarContext) =>
  `${c.examLabel} — Class ${c.className}\nStudent: ${c.studentName}\nExam Roll No: ${c.rollNo}\n` +
  `Bring your Roll No. Slip and reach the exam centre 30 minutes early.\n${c.siteUrl}/roll-no-slip`;

const locationFor = (p: CalendarPaper) => (p.hall ? `${p.hall} — GHS Babi Khel, Mohmand` : "GHS Babi Khel, Mohmand");

export function buildIcs(papers: CalendarPaper[], reminderIds: string[], c: CalendarContext): string {
  const stamp = utc(new Date());
  const seq = Math.floor(Date.now() / 60000);
  const alarms = REMINDER_OPTIONS.filter((r) => reminderIds.includes(r.id));
  const L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GHS Babi Khel//Exam Date Sheet//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(`${c.examLabel} — Class ${c.className}`)}`,
  ];
  for (const p of papers) {
    L.push("BEGIN:VEVENT", `UID:${p.id}@ghs-babi-khel`, `DTSTAMP:${stamp}`, `SEQUENCE:${seq}`);
    if (p.allDay) {
      L.push(`DTSTART;VALUE=DATE:${ymd(p.day)}`, `DTEND;VALUE=DATE:${nextDay(p.day)}`);
    } else {
      L.push(`DTSTART:${utc(p.start!)}`, `DTEND:${utc(p.end!)}`);
    }
    L.push(
      `SUMMARY:${esc(`${p.subject} Paper — Class ${c.className}`)}`,
      `DESCRIPTION:${esc(detailsFor(p, c))}`,
      `LOCATION:${esc(locationFor(p))}`,
      "CATEGORIES:Exam", "TRANSP:OPAQUE",
    );
    for (const a of alarms) {
      // Clock-time reminders make no sense for an all-day paper; keep the day-before one.
      if (p.allDay && a.minutes < 1440) continue;
      L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`${p.subject} paper — ${a.label}`)}`, `TRIGGER:-PT${a.minutes}M`, "END:VALARM");
    }
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarUrl(p: CalendarPaper, c: CalendarContext): string {
  const dates = p.allDay ? `${ymd(p.day)}/${nextDay(p.day)}` : `${utc(p.start!)}/${utc(p.end!)}`;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${p.subject} Paper — Class ${c.className}`,
    dates,
    details: detailsFor(p, c),
    location: locationFor(p),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
