// src/hooks/useAdminAdmissionsAll.ts — every application for the admin
// Admissions tab (stats, search, filters, list).
//
// WHY: the old tab read only the FIRST page (20 rows) of `useAdminAdmissions`
// and computed the Applied / Pending / Paid counters, the search and the
// stat-card filters from that single page — wrong as soon as more than 20
// students applied. This hook loads the whole register once (admission volume
// for one school is a few hundred rows) and everything is derived from it.
//
// The query key starts with "admin-admissions", so every existing mutation
// (status update, fee, delete, reset-all) that invalidates ["admin-admissions"]
// refreshes this list automatically — no other file has to change.
// ═══════════════════════════════════════════════════════════════════════════

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Admission } from "@/hooks/useAdmission";

const FIELDS =
  "id, reference_no, full_name, father_name, date_of_birth, b_form_no, contact_number, whatsapp_number, home_address, gender, applying_class, admission_type, previous_school, previous_class, previous_marks, year_of_passing, status, admin_note, rejection_reason, admission_roll_no, migration_step, previous_board, board_enrollment_no, board_roll_no, previous_result, slc_no, slc_date, migration_cert_no, previously_enrolled, admission_date, bisep_enrollment_no, bisep_enrolled_at, board_fee_status, board_fee_paid_at, father_cnic, occupation, payment_status, payment_reference, payment_method, payment_receipt, processing_fee, fee_deadline, paid_at, created_at, updated_at";

export function useAdminAdmissionsAll() {
  return useQuery<Admission[]>({
    queryKey: ["admin-admissions", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admissions")
        .select(FIELDS)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Admission[];
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
