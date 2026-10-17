// src/utils/generateExamICS.ts
//
// Generates a standards-compliant .ics (iCalendar) file from an exam schedule
// array and triggers a browser download. Works with:
//   • Google Calendar  (File → Import)
//   • Apple Calendar / iPhone Calendar (tap the .ics file)
//   • Outlook (double-click the .ics file)
//   • Any RFC 5545 compliant calendar app
//
// USAGE:
//   import { generateExamICS } from "@/utils/generateExamICS";
//   generateExamICS(schedule, "10", "Annual-I", 2025);

export interface ICSExamEntry {
  id: string;
  subject: string;
  exam_date: string;           // "YYYY-MM-DD"
  start_time: string | null;   // "HH:MM" (24h) or "HH:MM:SS", optional
  end_time:   string | null;
  hall:       string | null;
  notes:      string | null;
  paper_code?: string | null;
  paper_name?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape special chars per RFC 5545 §3.3.11 */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g,  "\\;")
    .replace(/,/g,  "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Convert a "YYYY-MM-DD" + optional "HH:MM" pair to iCal datetime strings.
 * If no time is given, returns an all-day DATE value ("YYYYMMDD").
 */
function toICalDate(dateStr: string, timeStr: string | null): string {
  const [y, m, d] = dateStr.split("-");
  if (!timeStr) return `${y}${m}${d}`;

  // Normalise to "HH:MM" regardless of "HH:MM:SS" input
  const [hh, mm] = timeStr.split(":");
  return `${y}${m}${d}T${hh.padStart(2,"0")}${(mm ?? "00").padStart(2,"0")}00`;
}

/** Create a stable UID for each event (avoids duplicate imports on re-download) */
function makeUID(entry: ICSExamEntry, schoolSlug: string): string {
  return `ghs-${schoolSlug}-exam-${entry.id}@ghsbabikhel.dpdns.org`;
}

/** Current UTC timestamp in iCal format */
function nowUTC(): string {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// ── Main export function ───────────────────────────────────────────────────────

/**
 * Builds and downloads a .ics file for the given exam schedule.
 *
 * @param schedule   Array of exam entries (published, ordered by date)
 * @param cls        Class label, e.g. "10"
 * @param examType   e.g. "Annual-I" or "1st Semester"
 * @param year       e.g. 2025
 * @param schoolName Optional override, defaults to "GHS Babi Khel"
 */
export function generateExamICS(
  schedule: ICSExamEntry[],
  cls: string,
  examType: string,
  year: number,
  schoolName = "GHS Babi Khel"
): void {
  if (!schedule.length) return;

  const slug     = schoolName.toLowerCase().replace(/\s+/g, "-");
  const calName  = esc(`${schoolName} — Class ${cls} ${examType} ${year} Exam Schedule`);
  const now      = nowUTC();

  const events = schedule.map((entry) => {
    const title   = esc(entry.paper_name || entry.subject);
    const dtStart = toICalDate(entry.exam_date, entry.start_time);
    const dtEnd   = entry.end_time
      ? toICalDate(entry.exam_date, entry.end_time)
      : entry.start_time
        ? toICalDate(entry.exam_date, (() => {
            // Default duration: 3 hours if only start time given
            const [hh, mm] = entry.start_time!.split(":").map(Number);
            const endH = (hh + 3) % 24;
            return `${String(endH).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
          })())
        : null;

    const isAllDay = !entry.start_time;

    // Build description
    const descParts: string[] = [
      `Subject: ${entry.subject}`,
      `Class: ${cls}`,
      `Exam: ${examType} ${year}`,
      entry.paper_code ? `Paper Code: ${entry.paper_code}` : "",
      entry.hall        ? `Hall: ${entry.hall}`             : "",
      entry.notes       ? `Notes: ${entry.notes}`           : "",
      "",
      `GHS Babi Khel — ghsbabikhel.dpdns.org`,
    ];

    const description = esc(descParts.filter(Boolean).join("\n"));
    const location    = entry.hall ? esc(`${entry.hall}, ${schoolName}`) : esc(schoolName);
    const uid         = makeUID(entry, slug);

    // Alarm: reminder 1 day before and 1 hour before (for upcoming exams)
    const alarms = [
      `BEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:Exam tomorrow: ${title}\r\nEND:VALARM`,
      `BEGIN:VALARM\r\nTRIGGER:-PT1H\r\nACTION:DISPLAY\r\nDESCRIPTION:Exam in 1 hour: ${title}\r\nEND:VALARM`,
    ].join("\r\n");

    if (isAllDay) {
      // All-day event (no time specified)
      const dtEndAllDay = (() => {
        const d = new Date(entry.exam_date + "T00:00:00");
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10).replace(/-/g, "");
      })();

      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEndAllDay}`,
        `SUMMARY:📝 ${title} Exam`,
        `DESCRIPTION:${description}`,
        `LOCATION:${location}`,
        `STATUS:CONFIRMED`,
        `TRANSP:OPAQUE`,
        `CATEGORIES:EDUCATION,EXAM`,
        alarms,
        "END:VEVENT",
      ].join("\r\n");
    }

    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      dtEnd ? `DTEND:${dtEnd}` : "",
      `SUMMARY:📝 ${title} Exam`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      `STATUS:CONFIRMED`,
      `TRANSP:OPAQUE`,
      `CATEGORIES:EDUCATION,EXAM`,
      alarms,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n");
  });

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//GHS Babi Khel//Exam Schedule//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calName}`,
    `X-WR-CALDESC:${esc(`Exam schedule for Class ${cls} — ${examType} ${year}`)}`,
    "X-WR-TIMEZONE:Asia/Karachi",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  // Trigger download
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `GHS-Babi-Khel-Class${cls}-${examType.replace(/\s+/g, "-")}-${year}-Exam-Schedule.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
