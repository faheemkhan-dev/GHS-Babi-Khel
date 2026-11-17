// src/lib/admissionPayment.ts — browser side of the admission processing-fee
// payment + merit-list feature (ported from GHSS Ghallanai, adapted to the
// GHS Babi Khel High School flow — classes 6–10, no quotas).
//
// Layers:
//   • constants + labels shared by the tracker, the admin fee dialog and the
//     PDFs (one source of truth — they can never disagree)
//   • payment accounts (school bank / EasyPaisa / JazzCash / cash / other
//     rows configured in Admin → Admissions → Settings)
//   • ensurePaymentReference() — idempotent challan reference (RPC)
//   • online payment (Safepay) — config probe + checkout creation; the
//     browser never sees a secret and never sends an amount
//   • public cached readers for Classes & Seats and Merit Lists
//     (/api/public-data CDN first, direct RPC fallback — same pattern as
//     every other public read in this codebase)
// ═══════════════════════════════════════════════════════════════════════════

import { supabasePublic } from "@/lib/supabase";
import { cachedOrDirect } from "@/lib/publicData";

// Payment account shape used by the admission challan and online-pay panels.
export interface PaymentMethod {
  type: "bank" | "easypaisa" | "jazzcash" | "cash" | "other";
  // Bank-specific fields
  bank_name?: string;
  account_title?: string;
  account_number?: string;
  iban?: string;
  // Mobile money fields (EasyPaisa, JazzCash)
  account_name?: string;
  phone?: string;
  // Display label for custom types
  label?: string;
  instructions?: string;
}

// ── Types ──────────────────────────────────────────────────────────────────

/** One school payment account exactly as configured in Admission Settings. */
export type AdmissionPaymentAccount = PaymentMethod;

export interface AdmissionPaymentInfo {
  processing_fee: number | null;
  payment_status: "pending" | "paid" | "rejected" | null;
  payment_reference: string | null;
  payment_method: string | null;
  payment_receipt: string | null;
  fee_deadline: string | null;
  paid_at: string | null;
}

export interface ClassSeatRow {
  class: string;
  class_label: string;
  seats: number;
  is_open: boolean;
}

export interface PublicMeritListRow {
  id: string;
  class: string;
  class_label: string;
  list_no: number;
  title: string;
  session_year: string | null;
  admission_start_date: string | null;
  admission_last_date: string | null;
  published_at: string | null;
  listed_count: number;
  not_listed_count: number;
}

export interface PublicMeritEntry {
  position: number;
  reference_no: string;
  name: string;
  father_name: string | null;
  previous_marks: string | null;
  marks_pct: number | null;
  remarks: string | null;
  is_listed: boolean;
}

export interface PublicMeritListDetail {
  ok: boolean;
  list: {
    id: string;
    class: string;
    class_label: string;
    list_no: number;
    title: string;
    session_year: string | null;
    admission_start_date: string | null;
    admission_last_date: string | null;
    instructions: string | null;
    published_at: string | null;
  };
  entries: PublicMeritEntry[];
  listed_count: number;
  not_listed_count: number;
}

// ── Labels (single source of truth) ────────────────────────────────────────

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank: "Bank Transfer",
  easypaisa: "EasyPaisa",
  jazzcash: "JazzCash",
  cash: "Cash at School",
  safepay: "Online Payment",
  other: "Other",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "";
  return PAYMENT_METHOD_LABELS[method.toLowerCase()] || PAYMENT_METHOD_LABELS.other;
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  rejected: "Rejected",
};

// ── Payment accounts (challan "PAY TO" lines + manual transfer UI) ─────────

/** One compact centered line per account, e.g. "Meezan Bank | GHS Babi Khel | 0123… | IBAN PK…". */
export function describePaymentAccount(acc: AdmissionPaymentAccount | null | undefined): string {
  if (!acc) return "";
  const parts: string[] = [];
  if (acc.type === "bank") {
    if (acc.bank_name) parts.push(acc.bank_name);
    if (acc.account_title) parts.push(acc.account_title);
    if (acc.account_number) parts.push(`A/C ${acc.account_number}`);
    if (acc.iban) parts.push(`IBAN ${acc.iban}`);
  } else if (acc.type === "easypaisa" || acc.type === "jazzcash") {
    parts.push(paymentMethodLabel(acc.type));
    if (acc.account_name) parts.push(acc.account_name);
    if (acc.phone) parts.push(acc.phone);
  } else if (acc.type === "cash") {
    parts.push(acc.instructions ? "Cash at School" : "Cash at School Office");
  } else {
    parts.push(acc.label || "Other");
    if (acc.instructions) parts.push(acc.instructions);
  }
  return parts.join(" | ");
}

export function hasPaymentAccounts(accounts: AdmissionPaymentAccount[] | null | undefined): boolean {
  return Array.isArray(accounts) && accounts.length > 0;
}

/** wa.me link with a prefilled verification message (manual payment path). */
export function admissionWhatsappLink(
  whatsapp: string | null | undefined,
  fallbackPhone: string | null | undefined,
  message: string,
): string | null {
  const raw = (whatsapp || fallbackPhone || "").replace(/[^0-9+]/g, "");
  if (!raw) return null;
  // 03XX… → 923XX… ; +92… / 92… kept as-is.
  const digits = raw.startsWith("+") ? raw.slice(1) : raw;
  const intl = digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
  if (!/^\d{10,15}$/.test(intl)) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export function manualVerifyMessage(fee: number, reference: string, paymentRef: string | null): string {
  return (
    `Assalam o Alaikum, I have paid the admission processing fee (Rs ${fee}) ` +
    `for Reference No. ${reference}${paymentRef ? ` (Payment Reference ${paymentRef})` : ""}. ` +
    `Payment screenshot / receipt is attached. Please verify my payment.`
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function formatDeadline(deadline: string | null | undefined): string {
  if (!deadline) return "—";
  try {
    return new Date(deadline).toLocaleString("en-PK", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return String(deadline);
  }
}

export function formatFeeDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-PK", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return String(value);
  }
}

// ── Payment reference (idempotent RPC) ─────────────────────────────────────

export interface ProceedPaymentResult {
  ok: boolean;
  error?: string;
  already_paid?: boolean;
  reference_no?: string;
  payment_reference?: string | null;
  processing_fee?: number | null;
  fee_deadline?: string | null;
  payment_status?: string | null;
}

/**
 * Create (or return the existing) payment reference for an application.
 * Ownership is proven with the reference number + B-Form pair printed on
 * the applicant's own challan. Safe to call repeatedly.
 */
export async function ensurePaymentReference(
  referenceNo: string,
  bFormNo: string,
): Promise<ProceedPaymentResult> {
  const { data, error } = await supabasePublic.rpc("admission_proceed_payment", {
    p_reference_no: referenceNo,
    p_b_form_no: bFormNo,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { ok: false, error: "No response from server." };
}

// ── Online payment (Safepay) ───────────────────────────────────────────────

const SAFEPAY_TIMEOUT_MS = 20000;

/** Probe /api/safepay?kind=config — true only when keys exist AND the school switched it on. */
export async function fetchOnlinePaymentEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/safepay?kind=config", {
      signal: AbortSignal.timeout(SAFEPAY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.enabled === true;
  } catch {
    return false;
  }
}

export interface CreatePaymentResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Start a Safepay checkout. The server pulls the amount from the database —
 * the browser only proves who is paying (reference + B-Form). Returns the
 * hosted-checkout URL after allow-listing it to https://*.getsafepay.com.
 */
export async function createOnlinePayment(
  referenceNo: string,
  bFormNo: string,
): Promise<CreatePaymentResult> {
  try {
    const res = await fetch("/api/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference_no: referenceNo, b_form_no: bFormNo }),
      signal: AbortSignal.timeout(SAFEPAY_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !data?.url) {
      return { ok: false, error: data?.error || "Could not start the online payment. Please try again." };
    }
    // Allow-list: only a https Safepay hosted-checkout URL may be opened.
    let parsed: URL;
    try {
      parsed = new URL(data.url);
    } catch {
      return { ok: false, error: "Invalid checkout URL." };
    }
    if (parsed.protocol !== "https:" || !/(^|\.)getsafepay\.com$/.test(parsed.hostname)) {
      return { ok: false, error: "Invalid checkout URL." };
    }
    return { ok: true, url: data.url };
  } catch {
    return { ok: false, error: "Network problem — check your internet and try again." };
  }
}

// ── Public cached reads (classes & seats, merit lists) ─────────────────────

// Publish bust: for a short window after an admin publish/save, requests
// carry a `_` bucket param → fresh CDN key → guaranteed origin read (the
// same trick src/lib/publicData.ts uses for results-day).
let meritBustUntil = 0;
let classesBustUntil = 0;

export function markAdmissionMeritBust(): void {
  meritBustUntil = Date.now() + 75_000;
}
export function markAdmissionClassesBust(): void {
  classesBustUntil = Date.now() + 75_000;
}

function bustParam(until: number): Record<string, string> {
  return until > Date.now() ? { _: String(Math.floor(Date.now() / 10_000)) } : {};
}

export async function fetchClassSeatsPublic(): Promise<ClassSeatRow[]> {
  const rows = await cachedOrDirect<any>(
    "admission-classes",
    bustParam(classesBustUntil),
    async () => {
      const { data, error } = await supabasePublic.rpc("admission_class_seats_list");
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  );
  // Defensive unwrap: RPC/cache may return an array or {data|items|classes:[…]}.
  const list = Array.isArray(rows) ? rows : rows?.data ?? rows?.items ?? rows?.classes ?? [];
  return (list || []) as ClassSeatRow[];
}

export async function fetchMeritListsPublic(): Promise<PublicMeritListRow[]> {
  const rows = await cachedOrDirect<any>(
    "admission-merit-lists",
    bustParam(meritBustUntil),
    async () => {
      const { data, error } = await supabasePublic.rpc("admission_merit_lists_public");
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  );
  const list = Array.isArray(rows) ? rows : rows?.data ?? rows?.items ?? [];
  return (list || []) as PublicMeritListRow[];
}

export async function fetchMeritListPublic(id: string): Promise<PublicMeritListDetail | null> {
  const row = await cachedOrDirect<any>(
    "admission-merit-list",
    { id, ...bustParam(meritBustUntil) },
    async () => {
      const { data, error } = await supabasePublic.rpc("admission_merit_list_view", { p_id: id });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  );
  const detail = Array.isArray(row) ? row[0] : row;
  if (!detail?.ok) return null;
  return detail as PublicMeritListDetail;
}
