import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type RecordStatus = "enrolled" | "withdrawn";

export interface StudentRecord {
  id: string;
  admission_date: string | null;
  serial_no: number | null;
  student_name: string;
  date_of_birth: string | null;
  father_name: string | null;
  caste: string | null;
  profession: string | null;
  address: string | null;
  admitted_class: string | null;
  fee: number | null;
  left_class: string | null;
  left_date: string | null;
  remarks: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
}

export type StudentRecordPayload = Omit<
  StudentRecord,
  "id" | "created_at" | "updated_at" | "status"
>;

const TABLE = "student_records";
const PAGE_SIZE = 25;

// A record counts as withdrawn if EITHER the class-left or date-left field
// is populated — real registers sometimes have one filled without the
// other (e.g. "left in 8th" noted with no exact date), and that alone
// means the student is no longer enrolled.
function deriveStatus(payload: Partial<StudentRecordPayload>): RecordStatus {
  return payload.left_class || payload.left_date ? "withdrawn" : "enrolled";
}

// ── List with search + filters + pagination ────────────────────────────
export function useStudentRecords(opts: {
  search?: string;
  status?: RecordStatus | "all";
  admittedClass?: string | "all";
  page?: number;
}) {
  const { search = "", status = "all", admittedClass = "all", page = 0 } = opts;

  return useQuery({
    queryKey: ["student_records", search, status, admittedClass, page],
    queryFn: async () => {
      let query = supabase
        .from(TABLE)
        .select("*", { count: "exact" })
        // Oldest admissions first (1993, 94, 95...) — matches the physical
        // register's chronological layout the school is used to reading.
        .order("admission_date", { ascending: true, nullsFirst: false })
        .order("serial_no", { ascending: true, nullsFirst: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(
          `student_name.ilike.%${search}%,father_name.ilike.%${search}%`
        );
      }
      if (status !== "all") query = query.eq("status", status);
      if (admittedClass !== "all") query = query.eq("admitted_class", admittedClass);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as StudentRecord[], count: count || 0 };
    },
  });
}

// ── Create ───────────────────────────────────────────────────────────────
export function useCreateStudentRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<StudentRecordPayload>) => {
      const status = deriveStatus(payload);
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ ...payload, status })
        .select()
        .single();
      if (error) throw error;
      return data as StudentRecord;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student_records"] }),
  });
}

// ── Update ───────────────────────────────────────────────────────────────
export function useUpdateStudentRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<StudentRecordPayload> & { id: string }) => {
      // Recompute status whenever either "left" field is part of this edit —
      // the admin edit form always sends both together, so this is safe.
      const touchesLeftFields = "left_date" in payload || "left_class" in payload;
      const status = touchesLeftFields ? deriveStatus(payload) : undefined;
      const { data, error } = await supabase
        .from(TABLE)
        .update(status ? { ...payload, status } : payload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as StudentRecord;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student_records"] }),
  });
}

// ── Delete ALL records — bulk wipe, used by the "Delete All" button ─────
export function useDeleteAllStudentRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Supabase requires a WHERE clause on delete — "id is not null" is
      // always true for every row, so this deletes everything in the
      // table. The real safety net is the multi-step UI confirmation
      // (type "DELETE ALL" + a warning dialog) before this ever fires.
      const { error, count } = await supabase
        .from(TABLE)
        .delete({ count: "exact" })
        .not("id", "is", null);
      if (error) throw error;
      return count || 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student_records"] }),
  });
}

// ── Delete (single) ──────────────────────────────────────────────────────
export function useDeleteStudentRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student_records"] }),
  });
}

// ── Bulk import (from Excel) ─────────────────────────────────────────────
export function useBulkImportStudentRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Partial<StudentRecordPayload>[]) => {
      const withStatus = rows.map((r) => ({
        ...r,
        status: deriveStatus(r),
      }));
      // Supabase caps payload size — chunk large imports.
      const CHUNK = 200;
      let inserted = 0;
      for (let i = 0; i < withStatus.length; i += CHUNK) {
        const chunk = withStatus.slice(i, i + CHUNK);
        const { error, count } = await supabase
          .from(TABLE)
          .insert(chunk, { count: "exact" });
        if (error) throw error;
        inserted += count || chunk.length;
      }
      return inserted;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student_records"] }),
  });
}

// ── Register order ──────────────────────────────────────────────────────
// Oldest admission first (1993 → 2026), then by the register's own S.No.
// A record with NO admission date used to jump to the very top of the export
// (e.g. S.No 877, admitted 2009, listed before 1993). It is now placed by its
// S.No: it inherits the date of the nearest dated record with a lower S.No
// (else the next higher one), so S.No 877 sits right after S.No 876. Only the
// ORDER is affected — the blank date itself is exported untouched.
export function sortRegisterOrder(rows: StudentRecord[]): StudentRecord[] {
  const END = "9999-12-31";
  const dated = rows
    .filter((r) => r.admission_date && r.serial_no != null)
    .sort((a, b) => (a.serial_no as number) - (b.serial_no as number));
  const effectiveDate = (r: StudentRecord): string => {
    if (r.admission_date) return r.admission_date;
    if (r.serial_no == null) return END;
    let before: StudentRecord | null = null;
    let after: StudentRecord | null = null;
    for (const d of dated) {
      if ((d.serial_no as number) <= r.serial_no) before = d;
      else { after = d; break; }
    }
    return (before ?? after)?.admission_date ?? END;
  };
  return rows
    .map((r) => ({ r, d: effectiveDate(r) }))
    .sort((x, y) =>
      x.d.localeCompare(y.d) ||
      (x.r.serial_no ?? Infinity) - (y.r.serial_no ?? Infinity) ||
      String(x.r.created_at).localeCompare(String(y.r.created_at)))
    .map((x) => x.r);
}

// ── Fetch ALL rows (for full export, ignoring pagination) ───────────────
// Pages through the table: PostgREST returns at most 1000 rows per request,
// so a plain select would silently cut the export off once the register
// passes 1000 records.
export async function fetchAllStudentRecordsForExport(): Promise<StudentRecord[]> {
  const all: StudentRecord[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("id", { ascending: true })       // stable paging
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data || []) as StudentRecord[]));
    if (!data || data.length < PAGE) break;
  }
  return sortRegisterOrder(all);
}
