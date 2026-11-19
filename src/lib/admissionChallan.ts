// src/lib/admissionChallan.ts — shared admin helpers for the Admissions tab.
//
// • createChallanForEligibleApplicant — auto-creates the admission/migration
//   fee challan (fee_vouchers row) when an applicant is marked Eligible.
//   Moved here UNCHANGED from AdminAdmissions.tsx so the redesigned Application
//   View dialog and any other screen can share one implementation.
// • MIGRATION_STEPS / downloadFile — the migration progress labels and the
//   blob-download helper used by the Application View.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from "@/lib/supabase";
import type { Admission } from "@/hooks/useAdmission";
import type { PaymentMethod } from "@/lib/admissionPayment";

export const MIGRATION_STEPS = [
  "Student submitted online application",
  "Migration letter written to current principal",
  "Current principal signed the letter",
  "Our school principal signed the letter",
  "Current school applied migration on BISEP",
  "Our school approved on BISEP",
  "Bank challan generated — fee submitted",
  "Migration completed ✅",
];

/** Download a Cloudinary file by fetching it as a blob (falls back to a new tab). */
export async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "document";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank");
  }
}

export interface EnrollmentResult {
  studentId: string | null;
  voucherNumber: string | null;   // null = skipped
  voucherAmount: number | null;
  skippedReason?: string;
  feeType?: string;
  alreadyExisted?: boolean;       // true = challan was already created earlier
  paymentMethods?: PaymentMethod[];
}

export async function createChallanForEligibleApplicant(app: Admission): Promise<EnrollmentResult> {
  const targetFeeType = app.admission_type === "migration" ? "migration" : "admission";
  const feeName = targetFeeType === "migration" ? "Migration" : "Admission";

  // 1. Never create a second challan for the same application.
  const { data: existingV } = await supabase
    .from("fee_vouchers")
    .select("voucher_number, total_amount")
    .ilike("notes", `%${app.reference_no}%`)
    .limit(1);
  if (existingV && existingV.length > 0) {
    return {
      studentId: null,
      voucherNumber: existingV[0].voucher_number,
      voucherAmount: Number(existingV[0].total_amount ?? 0),
      feeType: targetFeeType,
      alreadyExisted: true,
    };
  }

  // 2. Fee structure first — if no amount is configured, create nothing.
  const { data: feeStruct, error: fsErr } = await supabase
    .from("fee_structures")
    .select("id, label, amount, is_optional, payment_methods")
    .eq("class", app.applying_class)
    .eq("fee_type", targetFeeType)
    .eq("is_active", true)
    .maybeSingle();

  if (fsErr) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `Fee lookup failed: ${fsErr.message}`, feeType: targetFeeType };
  }
  if (!feeStruct) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `No "${targetFeeType}" fee structure configured for Class ${app.applying_class}`, feeType: targetFeeType };
  }
  const amount = Number(feeStruct.amount ?? 0);
  if (amount <= 0) {
    return { studentId: null, voucherNumber: null, voucherAmount: null, skippedReason: `${feeName} fee for Class ${app.applying_class} is set to Rs 0 — set an amount for this fee, then save this applicant again`, feeType: targetFeeType };
  }

  // 3. Hidden, inactive register entry (required by the voucher's student FK).
  let studentId: string | null = null;
  const { data: existingStu } = await supabase
    .from("students")
    .select("id")
    .eq("roll_number", app.reference_no)
    .eq("class", app.applying_class)
    .maybeSingle();
  if (existingStu?.id) {
    studentId = existingStu.id;
  } else {
    const { data: newStu, error: stuErr } = await supabase
      .from("students")
      .insert({
        full_name:   app.full_name,
        father_name: app.father_name,
        roll_number: app.reference_no,
        class:       app.applying_class,
        is_active:   false,
      })
      .select("id")
      .single();
    if (stuErr) throw new Error(stuErr.message);
    studentId = newStu?.id ?? null;
  }
  if (!studentId) throw new Error("Could not prepare the student record for the challan");

  // 4. Voucher number — ADM-YYYY-MM-DD-HHMMSS-xxxx, due in 14 days.
  const now = new Date();
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  const ts =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const voucherNumber = `ADM-${ts}-${studentId.slice(-4).toUpperCase()}`;
  const due = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const dueDate = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;

  const { error: vErr } = await supabase.from("fee_vouchers").insert({
    voucher_number: voucherNumber,
    student_id:     studentId,
    class:          app.applying_class,
    month:          now.getMonth() + 1,
    year:           now.getFullYear(),
    fee_period:     "one_off",
    fee_items: [
      {
        fee_type:    targetFeeType,
        label:       feeStruct.label || `${feeName} Fee`,
        amount,
        is_optional: !!feeStruct.is_optional,
      },
    ],
    total_amount: amount,
    due_date:     dueDate,
    bank_details: { payment_methods: feeStruct.payment_methods || [] },
    status:       "unpaid",
    paid_amount:  0,
    late_fee:     0,
    // The applicant tracker finds the challan by this reference no. — keep the wording.
    notes: `Auto-generated on ${app.admission_type === "migration" ? "migration" : "admission"} approval of ${app.reference_no}`,
  });
  if (vErr) {
    return { studentId, voucherNumber: null, voucherAmount: null, skippedReason: `Voucher insert failed: ${vErr.message}`, feeType: targetFeeType };
  }

  return { studentId, voucherNumber, voucherAmount: amount, feeType: targetFeeType, paymentMethods: feeStruct.payment_methods || [] };
}
