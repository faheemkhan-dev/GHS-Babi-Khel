import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

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

export interface FeeStructure {
  id: string;
  class: string;
  fee_type: string;
  label: string;
  amount: number;
  is_optional: boolean;
  is_recurring: boolean;
  frequency: "monthly" | "quarterly" | "annual" | "one_time";
  is_active: boolean;
  payment_methods: PaymentMethod[];
  created_at: string;
  updated_at: string;
}

export interface FeeItem {
  fee_type: string;
  label: string;
  amount: number;
  is_optional?: boolean;
}

export interface FeeVoucher {
  id: string;
  voucher_number: string;
  student_id: string;
  class: string;
  month: number;
  year: number;
  fee_period: "monthly" | "quarterly" | "one_off";  // one_off for admission/migration/custom fees
  fee_items: FeeItem[];
  total_amount: number;
  due_date: string;
  bank_details: {
    bank_name?: string;
    account_title?: string;
    account_number?: string;
    iban?: string;
    payment_methods?: PaymentMethod[];  // Stored here for admission/migration vouchers
  };
  status: "unpaid" | "partial" | "paid" | "overdue" | "waived";
  late_fee: number;
  paid_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  students?: {
    full_name: string;
    roll_number: string;
    father_name: string | null;
    contact_number: string | null;
    photo_url: string | null;
  };
}

export interface FeePayment {
  id: string;
  voucher_id: string;
  student_id: string;
  amount: number;
  payment_method: "cash" | "bank" | "online" | "cheque";
  receipt_number: string | null;
  payment_date: string;
  received_by: string | null;
  notes: string | null;
  created_at: string;
  // Joined
  fee_vouchers?: {
    voucher_number: string;
    total_amount: number;
  };
  students?: {
    full_name: string;
    roll_number: string;
    class: string;
  };
}

export interface StudentFeeSummary {
  student_id: string;
  full_name: string;
  roll_number: string;
  class: string;
  photo_url: string | null;
  total_vouchers: number;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
  overdue_count: number;
  last_payment_date: string | null;
}

export interface CollectionReport {
  month: number;
  year: number;
  total_vouchers: number;
  total_amount: number;
  collected: number;
  outstanding: number;
  collection_rate: number;
}

export interface ClassCollectionSummary {
  class: string;
  total_students: number;
  total_billed: number;
  total_collected: number;
  total_outstanding: number;
  collection_rate: number;
  defaulters_count: number;
}

// ═══════════════════════════════════════════════════════════════
// Fee Structure Hooks
// ═══════════════════════════════════════════════════════════════

export function useFeeStructures(classLevel?: string) {
  return useQuery<FeeStructure[]>({
    queryKey: ["fee-structures", classLevel],
    queryFn: async () => {
      let query = supabase
        .from("fee_structures")
        .select("*")
        .eq("is_active", true)
        .order("class")
        .order("fee_type");
      if (classLevel) query = query.eq("class", classLevel);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000, // mutations invalidate this query; the poll is only a slow safety net
  });
}

/**
 * useMyFeeStructures — uses the SECURITY DEFINER RPC `get_all_fee_structures()`
 * to return EVERY active fee structure across ALL classes — visible to ANY
 * authenticated user. No student-linking required.
 */
export function useMyFeeStructures() {
  return useQuery<{ structures: FeeStructure[]; error: string | null }>({
    queryKey: ["my-fee-structures"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_fee_structures");
      if (error) throw error;
      const result = (data || { success: false, structures: [], error: "RPC failed" }) as any;
      return {
        structures: (result.structures || []) as FeeStructure[],
        error: result.success === false ? (result.error || "Unknown error") : null,
      };
    },
    staleTime: 0,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
    refetchOnReconnect: false,    // Don't refetch on reconnect — prevents interrupting edits
    refetchOnMount: true,
  });
}

export function useAllFeeStructures() {
  return useQuery<FeeStructure[]>({
    queryKey: ["fee-structures-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_structures")
        .select("*")
        .order("class")
        .order("fee_type");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useMutateFeeStructure() {
  const qc = useQueryClient();

  const upsert = useMutation({
    mutationFn: async (fs: Partial<FeeStructure> & { id?: string }) => {
      if (fs.id) {
        const { error } = await supabase
          .from("fee_structures")
          .update(fs)
          .eq("id", fs.id);
        if (error) throw error;
      } else {
        // Use upsert with onConflict so soft-deleted items can be reactivated
        // instead of failing with UNIQUE constraint violation on (class, fee_type)
        const { error } = await supabase
          .from("fee_structures")
          .upsert(
            { ...fs, is_active: true },
            { onConflict: "class,fee_type" }
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-structures"] });
      qc.invalidateQueries({ queryKey: ["fee-structures-all"] });
      qc.invalidateQueries({ queryKey: ["my-fee-structures"] }); // student-facing RPC
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("fee_structures")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-structures"] });
      qc.invalidateQueries({ queryKey: ["fee-structures-all"] });
      qc.invalidateQueries({ queryKey: ["my-fee-structures"] }); // student-facing RPC
    },
  });

  return { upsert, remove };
}

// ═══════════════════════════════════════════════════════════════
// Fee Voucher Hooks
// ═══════════════════════════════════════════════════════════════

export function useFeeVouchers(filters?: {
  classLevel?: string;
  month?: number;
  year?: number;
  status?: string;
  studentId?: string;
}) {
  return useQuery<FeeVoucher[]>({
    queryKey: ["fee-vouchers", filters],
    queryFn: async () => {
      let query = supabase
        .from("fee_vouchers")
        .select("*, students(full_name, roll_number, father_name, contact_number, photo_url)")
        .order("created_at", { ascending: false });
      if (filters?.classLevel) query = query.eq("class", filters.classLevel);
      if (filters?.month) query = query.eq("month", filters.month);
      if (filters?.year) query = query.eq("year", filters.year);
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.studentId) query = query.eq("student_id", filters.studentId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as FeeVoucher[];
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000, // mutations invalidate this query; the poll is only a safety net
  });
}

export function useStudentVouchers(classLevel?: string | null, studentId?: string | null) {
  // Uses the SECURITY DEFINER RPC `get_all_vouchers()` to return EVERY fee voucher
  // in the system — visible to ANY authenticated user. No student-linking required.
  // This is intentional: every signed-up + admin-approved user sees all vouchers.
  return useQuery<{ vouchers: FeeVoucher[]; error: string | null }>({
    queryKey: ["student-vouchers", classLevel, studentId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_all_vouchers");
      if (error) throw error;
      const result = (data || { success: false, vouchers: [], error: "RPC failed" }) as any;
      return {
        vouchers: (result.vouchers || []) as FeeVoucher[],
        error: result.success === false ? (result.error || "Unknown error") : null,
      };
    },
    staleTime: 0,            // Always fetch fresh — deleted vouchers must disappear immediately
    refetchInterval: 2 * 60 * 1000,  // safety net (mutations already invalidate)
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
    refetchOnReconnect: false,    // Don't refetch on reconnect — prevents interrupting edits
    refetchOnMount: true,
  });
}

export function useGenerateVouchers() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      classLevel: string;
      month: number;
      year: number;
      feePeriod: "monthly" | "quarterly";
      dueDate: string;
      lateFee?: number;
      bankDetails?: FeeVoucher["bank_details"];
      optionalFees?: string[]; // fee_types to include for all (like transport)
    }) => {
      // 1. Get all active students in the class
      const { data: students, error: stuErr } = await supabase
        .from("students")
        .select("id, class")
        .eq("class", params.classLevel)
        .eq("is_active", true);
      if (stuErr) throw stuErr;
      if (!students?.length) throw new Error("No active students found in this class");

      // 2. Get fee structures for this class
      const { data: structures, error: structErr } = await supabase
        .from("fee_structures")
        .select("*")
        .eq("class", params.classLevel)
        .eq("is_active", true);
      if (structErr) throw structErr;

      // 3. Filter fee items based on period
      const feeItems: FeeItem[] = structures
        .filter((s) => {
          if (s.frequency === "one_time") return false; // skip one_time for monthly/quarterly
          if (params.feePeriod === "monthly" && s.frequency === "monthly") return true;
          if (params.feePeriod === "quarterly" && (s.frequency === "quarterly" || s.frequency === "monthly"))
            return true;
          return false;
        })
        .map((s) => ({
          fee_type: s.fee_type,
          label: s.label,
          amount: s.amount,
          is_optional: s.is_optional,
        }));

      // Include optional fees that admin selected
      if (params.optionalFees?.length) {
        params.optionalFees.forEach((ft) => {
          const existing = feeItems.find((f) => f.fee_type === ft);
          if (!existing) {
            const struct = structures.find((s) => s.fee_type === ft);
            if (struct) {
              feeItems.push({
                fee_type: struct.fee_type,
                label: struct.label,
                amount: struct.amount,
                is_optional: struct.is_optional,
              });
            }
          }
        });
      }

      const totalAmount = feeItems.reduce((sum, f) => sum + Number(f.amount), 0);
      if (totalAmount === 0) throw new Error("No fee items with amounts configured for this class");

      // 4. Generate voucher number
      const voucherPrefix = `FV-${params.year}-${String(params.month).padStart(2, "0")}`;

      // 5. Create vouchers for each student
      const vouchers = students.map((stu, idx) => ({
        voucher_number: `${voucherPrefix}-${String(idx + 1).padStart(3, "0")}`,
        student_id: stu.id,
        class: params.classLevel,
        month: params.month,
        year: params.year,
        fee_period: params.feePeriod,
        fee_items: feeItems,
        total_amount: totalAmount,
        due_date: params.dueDate,
        bank_details: params.bankDetails || {},
        status: "unpaid" as const,
        late_fee: params.lateFee || 0,
        paid_amount: 0,
      }));

      // 6. Insert (upsert on conflict)
      const { data, error } = await supabase
        .from("fee_vouchers")
        .upsert(vouchers, {
          onConflict: "student_id,month,year,fee_period",
          ignoreDuplicates: false,
        })
        .select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
      qc.invalidateQueries({ queryKey: ["student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
      qc.invalidateQueries({ queryKey: ["fee-defaulters"] });
      qc.invalidateQueries({ queryKey: ["fee-collection-report"] });
    },
  });
}

export function useUpdateVoucher() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      id: string;
      status?: string;
      late_fee?: number;
      notes?: string;
      bank_details?: FeeVoucher["bank_details"];
      due_date?: string;
    }) => {
      const { error } = await supabase
        .from("fee_vouchers")
        .update(params)
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
      qc.invalidateQueries({ queryKey: ["student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
    },
  });
}

export function useDeleteVoucher() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fee_vouchers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
      qc.invalidateQueries({ queryKey: ["student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Fee Payment Hooks
// ═══════════════════════════════════════════════════════════════

export function useFeePayments(filters?: {
  voucherId?: string;
  studentId?: string;
  month?: number;
  year?: number;
}) {
  return useQuery<FeePayment[]>({
    queryKey: ["fee-payments", filters],
    queryFn: async () => {
      let query = supabase
        .from("fee_payments")
        .select("*, fee_vouchers(voucher_number, total_amount), students(full_name, roll_number, class)")
        .order("payment_date", { ascending: false });
      if (filters?.voucherId) query = query.eq("voucher_id", filters.voucherId);
      if (filters?.studentId) query = query.eq("student_id", filters.studentId);
      // Filter by payment_date range for the selected month/year
      if (filters?.month && filters?.year) {
        const y = filters.year;
        const m = filters.month;
        const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
        const endDay = new Date(y, m, 0).getDate();
        const endDate = `${y}-${String(m).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
        query = query.gte("payment_date", startDate).lte("payment_date", endDate);
      } else if (filters?.year) {
        query = query.gte("payment_date", `${filters.year}-01-01`).lte("payment_date", `${filters.year}-12-31`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as FeePayment[];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
    refetchOnReconnect: false,    // Don't refetch on reconnect — prevents interrupting edits
    refetchOnMount: true,
    retry: 1, // Only retry once — if query fails, show error state quickly
  });
}

// Shape of a fee_payments row as returned by both the RPC and the fallback.
type FeePaymentRow = {
  id: string;
  voucher_id: string;
  student_id: string;
  amount: number;
  payment_method: string;
  receipt_number: string | null;
  payment_date: string;
  received_by: string | null;
  notes: string | null;
  [k: string]: unknown;
};

export function useRecordPayment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      voucherId: string;
      studentId: string;
      amount: number;
      paymentMethod: "cash" | "bank" | "online" | "cheque";
      receiptNumber?: string;
      paymentDate: string;
      receivedBy?: string;
      notes?: string;
    }) => {
      // ── FAST PATH: one atomic RPC (payment insert + voucher update in a
      // single transaction). Also fixes the read-modify-write race where two
      // clerks recording payments on the same voucher concurrently could
      // LOSE an amount (both read paid_amount=X, both write X+their amount).
      // The RPC lives in supabase/migrations/…_fee_record_payment.sql; if it
      // is not installed yet (PGRST202 / 404), we transparently fall back to
      // the original 3-step client flow so recording payments NEVER breaks
      // on a database that hasn't run the migration.
      const rpc = await supabase.rpc("record_fee_payment", {
        p_voucher_id: params.voucherId,
        p_student_id: params.studentId,
        p_amount: params.amount,
        p_payment_method: params.paymentMethod,
        p_receipt_number: params.receiptNumber || `RCP-${Date.now()}`,
        p_payment_date: params.paymentDate,
        p_received_by: params.receivedBy ?? null,
        p_notes: params.notes ?? null,
      });
      const rpcMissing =
        rpc.error &&
        (rpc.error.code === "PGRST202" || rpc.error.code === "404" ||
          /function .* does not exist|Could not find the function/i.test(rpc.error.message || ""));
      if (!rpc.error && rpc.data) return rpc.data as unknown as FeePaymentRow;
      if (!rpcMissing) throw rpc.error;

      // ── FALLBACK: original 3-step flow (pre-migration databases) ──
      // 1. Insert payment
      const { data: payment, error: payErr } = await supabase
        .from("fee_payments")
        .insert({
          voucher_id: params.voucherId,
          student_id: params.studentId,
          amount: params.amount,
          payment_method: params.paymentMethod,
          receipt_number: params.receiptNumber || `RCP-${Date.now()}`,
          payment_date: params.paymentDate,
          received_by: params.receivedBy,
          notes: params.notes,
        })
        .select()
        .single();
      if (payErr) throw payErr;

      // 2. Update voucher: add paid_amount and determine status
      const { data: voucher } = await supabase
        .from("fee_vouchers")
        .select("total_amount, late_fee, paid_amount")
        .eq("id", params.voucherId)
        .single();

      if (voucher) {
        const newPaid = Number(voucher.paid_amount) + Number(params.amount);
        const totalDue = Number(voucher.total_amount) + Number(voucher.late_fee);
        const newStatus = newPaid >= totalDue ? "paid" : "partial";

        await supabase
          .from("fee_vouchers")
          .update({ paid_amount: newPaid, status: newStatus })
          .eq("id", params.voucherId);
      }

      return payment;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-payments"] });
      qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
      qc.invalidateQueries({ queryKey: ["student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
      qc.invalidateQueries({ queryKey: ["fee-defaulters"] });
      qc.invalidateQueries({ queryKey: ["fee-collection-report"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Dashboard & Reports Hooks
// ═══════════════════════════════════════════════════════════════

export function useFeeDashboard() {
  return useQuery({
    queryKey: ["fee-dashboard"],
    queryFn: async () => {
      // Get all vouchers
      const { data: vouchers, error } = await supabase
        .from("fee_vouchers")
        .select("status, total_amount, paid_amount, late_fee, class, month, year, due_date, student_id");
      if (error) throw error;

      const all = vouchers ?? [];
      const totalBilled = all.reduce((s, v) => s + Number(v.total_amount) + Number(v.late_fee), 0);
      const totalCollected = all.reduce((s, v) => s + Number(v.paid_amount), 0);
      const totalOutstanding = totalBilled - totalCollected;
      const totalVouchers = all.length;
      const paidVouchers = all.filter((v) => v.status === "paid").length;
      const unpaidVouchers = all.filter((v) => v.status === "unpaid").length;
      const overdueVouchers = all.filter((v) => v.status === "overdue").length;
      const partialVouchers = all.filter((v) => v.status === "partial").length;
      const waivedVouchers = all.filter((v) => v.status === "waived").length;
      const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;

      // Aging analysis
      const now = new Date();
      const aging = {
        current: 0,     // not due yet
        days30: 0,      // 1-30 days overdue
        days60: 0,      // 31-60 days overdue
        days90: 0,      // 61-90 days overdue
        over90: 0,      // 90+ days overdue
      };
      all.forEach((v) => {
        if (v.status === "paid" || v.status === "waived") return;
        const due = new Date(v.due_date);
        const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        const outstanding = Number(v.total_amount) + Number(v.late_fee) - Number(v.paid_amount);
        if (diffDays <= 0) aging.current += outstanding;
        else if (diffDays <= 30) aging.days30 += outstanding;
        else if (diffDays <= 60) aging.days60 += outstanding;
        else if (diffDays <= 90) aging.days90 += outstanding;
        else aging.over90 += outstanding;
      });

      // Class-wise breakdown
      const classBreakdown: Record<string, { billed: number; collected: number; outstanding: number }> = {};
      all.forEach((v) => {
        if (!classBreakdown[v.class]) classBreakdown[v.class] = { billed: 0, collected: 0, outstanding: 0 };
        classBreakdown[v.class].billed += Number(v.total_amount) + Number(v.late_fee);
        classBreakdown[v.class].collected += Number(v.paid_amount);
        classBreakdown[v.class].outstanding += Number(v.total_amount) + Number(v.late_fee) - Number(v.paid_amount);
      });

      return {
        totalBilled,
        totalCollected,
        totalOutstanding,
        totalVouchers,
        paidVouchers,
        unpaidVouchers,
        overdueVouchers,
        partialVouchers,
        waivedVouchers,
        collectionRate,
        aging,
        classBreakdown,
      };
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useFeeDefaulters(classLevel?: string, options?: { enabled?: boolean }) {
  return useQuery<StudentFeeSummary[]>({
    queryKey: ["fee-defaulters", classLevel],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      let voucherQuery = supabase
        .from("fee_vouchers")
        .select("student_id, class, total_amount, paid_amount, late_fee, status")
        .in("status", ["unpaid", "partial", "overdue"]);
      if (classLevel) voucherQuery = voucherQuery.eq("class", classLevel);
      const { data: vouchers, error } = await voucherQuery;
      if (error) throw error;

      // Group by student
      const map: Record<string, StudentFeeSummary> = {};
      (vouchers ?? []).forEach((v) => {
        if (!map[v.student_id]) {
          map[v.student_id] = {
            student_id: v.student_id,
            full_name: "",
            roll_number: "",
            class: v.class,
            photo_url: null,
            total_vouchers: 0,
            total_amount: 0,
            paid_amount: 0,
            outstanding: 0,
            overdue_count: 0,
            last_payment_date: null,
          };
        }
        map[v.student_id].total_vouchers += 1;
        map[v.student_id].total_amount += Number(v.total_amount) + Number(v.late_fee);
        map[v.student_id].paid_amount += Number(v.paid_amount);
        map[v.student_id].outstanding += Number(v.total_amount) + Number(v.late_fee) - Number(v.paid_amount);
        if (v.status === "overdue") map[v.student_id].overdue_count += 1;
      });

      // Get student details + last payment dates.
      // PERF: both queries depend only on studentIds, so they now run in
      // PARALLEL (previously two serial round trips).
      const studentIds = Object.keys(map);
      if (!studentIds.length) return [];

      const [studentsRes, paymentsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, full_name, roll_number, class, photo_url")
          .in("id", studentIds),
        supabase
          .from("fee_payments")
          .select("student_id, payment_date")
          .in("student_id", studentIds)
          .order("payment_date", { ascending: false }),
      ]);
      const students = studentsRes.data;
      const payments = paymentsRes.data;

      students?.forEach((s) => {
        if (map[s.id]) {
          map[s.id].full_name = s.full_name;
          map[s.id].roll_number = s.roll_number;
          map[s.id].photo_url = s.photo_url;
        }
      });

      payments?.forEach((p) => {
        if (map[p.student_id] && !map[p.student_id].last_payment_date) {
          map[p.student_id].last_payment_date = p.payment_date;
        }
      });

      return Object.values(map).sort((a, b) => b.outstanding - a.outstanding);
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useFeeCollectionReport(year?: number, options?: { enabled?: boolean }) {
  const reportYear = year || new Date().getFullYear();

  return useQuery<CollectionReport[]>({
    queryKey: ["fee-collection-report", reportYear],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data: vouchers, error } = await supabase
        .from("fee_vouchers")
        .select("month, year, total_amount, paid_amount, late_fee, status")
        .eq("year", reportYear);
      if (error) throw error;

      const monthMap: Record<number, { total: number; collected: number; count: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthMap[m] = { total: 0, collected: 0, count: 0 };
      }

      (vouchers ?? []).forEach((v) => {
        if (!monthMap[v.month]) monthMap[v.month] = { total: 0, collected: 0, count: 0 };
        monthMap[v.month].total += Number(v.total_amount) + Number(v.late_fee);
        monthMap[v.month].collected += Number(v.paid_amount);
        monthMap[v.month].count += 1;
      });

      return Object.entries(monthMap).map(([m, d]) => ({
        month: Number(m),
        year: reportYear,
        total_vouchers: d.count,
        total_amount: d.total,
        collected: d.collected,
        outstanding: d.total - d.collected,
        collection_rate: d.total > 0 ? Math.round((d.collected / d.total) * 100) : 0,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useClassCollectionSummary(year?: number, options?: { enabled?: boolean }) {
  const reportYear = year || new Date().getFullYear();

  return useQuery<ClassCollectionSummary[]>({
    queryKey: ["class-collection-summary", reportYear],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data: vouchers, error } = await supabase
        .from("fee_vouchers")
        .select("class, total_amount, paid_amount, late_fee, status, student_id")
        .eq("year", reportYear);
      if (error) throw error;

      const classMap: Record<string, ClassCollectionSummary> = {};
      const studentSet: Record<string, Set<string>> = {};
      const defaulterSet: Record<string, Set<string>> = {};

      (vouchers ?? []).forEach((v) => {
        if (!classMap[v.class]) {
          classMap[v.class] = {
            class: v.class,
            total_students: 0,
            total_billed: 0,
            total_collected: 0,
            total_outstanding: 0,
            collection_rate: 0,
            defaulters_count: 0,
          };
          studentSet[v.class] = new Set();
          defaulterSet[v.class] = new Set();
        }
        classMap[v.class].total_billed += Number(v.total_amount) + Number(v.late_fee);
        classMap[v.class].total_collected += Number(v.paid_amount);
        studentSet[v.class].add(v.student_id);
        if (v.status === "overdue" || v.status === "unpaid" || v.status === "partial") {
          defaulterSet[v.class].add(v.student_id);
        }
      });

      Object.keys(classMap).forEach((cls) => {
        classMap[cls].total_students = studentSet[cls].size;
        classMap[cls].total_outstanding = classMap[cls].total_billed - classMap[cls].total_collected;
        classMap[cls].collection_rate = classMap[cls].total_billed > 0
          ? Math.round((classMap[cls].total_collected / classMap[cls].total_billed) * 100)
          : 0;
        classMap[cls].defaulters_count = defaulterSet[cls].size;
      });

      return Object.values(classMap).sort((a, b) => a.class.localeCompare(b.class, undefined, { numeric: true }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════
// Students hook (minimal, for fee module)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Real-time Subscription — invalidates queries when fee data changes
// ═══════════════════════════════════════════════════════════════

export function useFeeVouchersRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("fee-vouchers-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fee_vouchers" },
        () => {
          // Invalidate all fee-voucher-related queries so fresh data is fetched
          qc.invalidateQueries({ queryKey: ["student-vouchers"] });
          qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
          qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
          qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
          qc.invalidateQueries({ queryKey: ["fee-defaulters"] });
          qc.invalidateQueries({ queryKey: ["fee-collection-report"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fee_structures" },
        () => {
          qc.invalidateQueries({ queryKey: ["fee-structures"] });
          qc.invalidateQueries({ queryKey: ["fee-structures-all"] });
          qc.invalidateQueries({ queryKey: ["my-fee-structures"] }); // student-facing RPC
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fee_payments" },
        () => {
          // Payments affect voucher status — invalidate everything fee-related
          qc.invalidateQueries({ queryKey: ["student-vouchers"] });
          qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
          qc.invalidateQueries({ queryKey: ["fee-payments"] });
          qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

// ═══════════════════════════════════════════════════════════════
// All Students' Vouchers — for student dashboard to see ALL vouchers
// ═══════════════════════════════════════════════════════════════

export function useAllVouchersForStudents(classLevel?: string | null) {
  return useQuery<FeeVoucher[]>({
    queryKey: ["all-student-vouchers", classLevel],
    queryFn: async () => {
      if (!classLevel) return [];
      const query = supabase
        .from("fee_vouchers")
        .select("*, students(full_name, roll_number, father_name, contact_number, photo_url)")
        .eq("class", classLevel)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as FeeVoucher[];
    },
    enabled: !!classLevel,
    staleTime: 0, // Always fetch fresh — deleted vouchers must disappear immediately
    refetchInterval: 2 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════
// Resolve the student's DB record ID from their auth user ID
// This is needed because fee_vouchers.student_id references
// students.id (auto-generated UUID), NOT auth.uid().
// ═══════════════════════════════════════════════════════════════

export function useMyStudentRecord(authUserId?: string | null) {
  return useQuery<{
    id: string;
    full_name: string;
    class: string;
    roll_number: string;
  } | null>({
    queryKey: ["my-student-record", authUserId],
    queryFn: async () => {
      if (!authUserId) return null;
      // First try matching by user_id column (proper link)
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class, roll_number")
        .eq("user_id", authUserId)
        .limit(1);
      if (error) throw error;
      if (data && data.length > 0) return data[0];

      // Fallback: match by profile's full_name + class
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, class")
        .eq("id", authUserId)
        .single();

      if (profile?.full_name && profile?.class) {
        const { data: students } = await supabase
          .from("students")
          .select("id, full_name, class, roll_number")
          .ilike("full_name", profile.full_name)
          .eq("class", profile.class)
          .limit(1);
        if (students && students.length > 0) {
          // Backfill user_id so future lookups are fast
          await supabase
            .from("students")
            .update({ user_id: authUserId })
            .eq("id", students[0].id);
          return students[0];
        }
      }
      return null;
    },
    enabled: !!authUserId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useStudentsByClass(classLevel: string) {
  return useQuery<{
    id: string;
    full_name: string;
    roll_number: string;
    photo_url: string | null;
    father_name: string | null;
    contact_number: string | null;
  }[]>({
    queryKey: ["students-by-class", classLevel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, roll_number, photo_url, father_name, contact_number")
        .eq("class", classLevel)
        .eq("is_active", true)
        .order("roll_number");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!classLevel,
    staleTime: 5 * 60 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════
// Custom Fee — add a one-off fee (absence fee, library fine, etc.)
// to a SINGLE student. Creates a new fee_voucher row with the
// custom fee as the only line item.
// ═══════════════════════════════════════════════════════════════

export interface CustomFeeParams {
  studentId: string;
  studentName: string;
  className: string;
  feeLabel: string;          // "Absence Fee - June 2026", "Library Fine", etc.
  amount: number;
  dueDate: string;           // "yyyy-MM-dd"
  notes?: string;
}

export function useAddCustomFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: CustomFeeParams) => {
      // Generate a unique voucher number: CF-YYYY-MM-XXXX
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const random = Math.floor(Math.random() * 9000) + 1000;
      const voucherNumber = `CF-${y}-${m}-${random}`;

      const { data, error } = await supabase
        .from("fee_vouchers")
        .insert({
          voucher_number: voucherNumber,
          student_id: params.studentId,
          class: params.className,
          month: now.getMonth() + 1,
          year: y,
          fee_period: "one_off",
          fee_items: [
            {
              fee_type: "custom",
              label: params.feeLabel,
              amount: params.amount,
            },
          ],
          total_amount: params.amount,
          due_date: params.dueDate,
          status: "unpaid",
          paid_amount: 0,
          late_fee: 0,
          notes: params.notes || null,
          bank_details: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fee-vouchers"] });
      qc.invalidateQueries({ queryKey: ["student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["all-student-vouchers"] });
      qc.invalidateQueries({ queryKey: ["fee-dashboard"] });
    },
  });
}

