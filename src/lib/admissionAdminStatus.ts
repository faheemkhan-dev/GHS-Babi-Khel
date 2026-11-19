// src/lib/admissionAdminStatus.ts — admin-side status vocabulary for the
// Admissions tab (labels, badge tones, hints, picker groups).
//
// This is the `statusConfig` that used to live inside AdminAdmissions.tsx,
// moved here (values UNCHANGED) so the list, the Application View dialog and
// the filters all read one source. Pure data — no JSX, no React.
// ═══════════════════════════════════════════════════════════════════════════

import type { AdmissionStatus } from "@/hooks/useAdmission";

export interface AdminStatusMeta {
  label: string;
  badge: string;
  desc: string;
}

export const STATUS_CONFIG: Record<AdmissionStatus, AdminStatusMeta> = {
  pending:             { label: "Pending",             badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",             desc: "Eligibility application received — review needed" },
  under_review:        { label: "Under Review",        badge: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800", desc: "Currently reviewing eligibility" },
  approved:            { label: "Eligible ✅",         badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800", desc: "Eligible for admission — ask student to bring documents" },
  rejected:            { label: "Not Eligible",        badge: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",                 desc: "Does not meet eligibility criteria" },
  documents_missing:   { label: "Docs Missing",        badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",     desc: "Student needs to bring missing documents" },
  documents_verified:  { label: "Docs Verified",       badge: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800",           desc: "All documents verified at office" },
  interview_scheduled: { label: "Interview Scheduled", badge: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-800",           desc: "Interview slot booked" },
  interview_completed: { label: "Interview Done",      badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800", desc: "Interview completed successfully" },
  waitlisted:          { label: "Waitlisted",          badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",     desc: "Waiting for a seat to open" },
  merit_listed:        { label: "Merit Listed 🎉",     badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",     desc: "Selected in a published merit list — seat confirmed by merit" },
  admitted:            { label: "Admitted ✅",         badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800", desc: "Fully admitted — enrolled in students register" },
  admit_card_issued:   { label: "Admit Card Issued",   badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800", desc: "Admit card generated and issued" },
};

/** Status picker groups in the Application View → Status tab. */
export const STATUS_GROUPS: { title: string; items: AdmissionStatus[] }[] = [
  { title: "Review",   items: ["pending", "under_review", "documents_missing", "documents_verified"] },
  { title: "Interview", items: ["interview_scheduled", "interview_completed", "waitlisted"] },
  { title: "Decision", items: ["approved", "merit_listed", "admitted", "admit_card_issued", "rejected"] },
];

/** List filter chips (Applications tab). `match` decides which rows each chip shows. */
export const FILTER_CHIPS: { key: string; label: string; match: (s: AdmissionStatus) => boolean }[] = [
  { key: "all",       label: "All",          match: () => true },
  { key: "new",       label: "New",          match: (s) => s === "pending" },
  { key: "review",    label: "In Review",    match: (s) => ["under_review", "documents_missing", "documents_verified", "interview_scheduled", "interview_completed", "waitlisted"].includes(s) },
  { key: "eligible",  label: "Eligible",     match: (s) => s === "approved" },
  { key: "merit",     label: "Merit Listed", match: (s) => s === "merit_listed" },
  { key: "admitted",  label: "Admitted",     match: (s) => s === "admitted" || s === "admit_card_issued" },
  { key: "rejected",  label: "Not Eligible", match: (s) => s === "rejected" },
];

export const initials = (name: string) =>
  (name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
