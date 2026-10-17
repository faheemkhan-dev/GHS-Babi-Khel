import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { computeAttendancePercentage, fetchReportCardAttendance, type ReportCardAttendance } from "@/hooks/useAttendanceAnalytics";

// Re-export for convenience
export type { ReportCardAttendance };
export { fetchReportCardAttendance };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ResultWithStudent {
  id: string;
  student_id: string;
  class: string;
  exam_type: string;
  year: number;
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  grade: string | null;
  position: number | null;
  is_pass: boolean;
  remarks: string | null;
  teacher_remarks: string | null;
  subject_marks: Record<string, { obtained: number; total: number }> | null;
  created_at: string;
  students: {
    full_name: string;
    roll_number: string;
    photo_url: string | null;
  } | null;
}

export interface GradingScheme {
  id: string;
  scheme_name: string;
  ranges: Array<{
    min_percentage: number;
    max_percentage: number;
    grade: string;
    gpa: number;
  }>;
  pass_threshold: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Default grading (hardcoded fallback) ───────────────────────────────────

const DEFAULT_RANGES: GradingScheme["ranges"] = [
  { min_percentage: 90, max_percentage: 100, grade: "A+", gpa: 4.0 },
  { min_percentage: 80, max_percentage: 89, grade: "A", gpa: 3.7 },
  { min_percentage: 60, max_percentage: 79, grade: "B", gpa: 3.0 },
  { min_percentage: 45, max_percentage: 59, grade: "C", gpa: 2.0 },
  { min_percentage: 33, max_percentage: 44, grade: "D", gpa: 1.0 },
  { min_percentage: 0, max_percentage: 32, grade: "Fail", gpa: 0.0 },
];

// ─── Grading from active scheme ─────────────────────────────────────────────

let _activeScheme: GradingScheme | null = null;

export function setActiveScheme(scheme: GradingScheme | null) {
  _activeScheme = scheme;
}

export function getGradeFromPercentage(pct: number): string {
  const ranges = _activeScheme?.ranges || DEFAULT_RANGES;
  for (const r of ranges) {
    if (pct >= r.min_percentage && pct <= r.max_percentage) return r.grade;
  }
  return "Fail";
}

export function getPassThreshold(): number {
  return _activeScheme?.pass_threshold ?? 33;
}

export function getGradeColor(grade: string): string {
  switch (grade) {
    case "A+": return "bg-primary-dark text-primary-foreground";
    case "A": return "bg-primary text-primary-foreground";
    case "B": return "bg-[hsl(172,66%,40%)] text-white";
    case "C": return "bg-warning text-white";
    case "D": return "bg-[hsl(25,95%,53%)] text-white";
    case "E": return "bg-orange-400 text-white";
    default: return "bg-destructive text-destructive-foreground";
  }
}

// ─── Published results for student view ─────────────────────────────────────

export function useResults(options: {
  classFilter: string;
  examType: string;
  year?: number;
  search?: string;
}) {
  const { classFilter, examType, year, search } = options;

  return useQuery<ResultWithStudent[]>({
    queryKey: ["results", classFilter, examType, year, search],
    queryFn: async () => {
      let query = supabase
        .from("results")
        .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, teacher_remarks, subject_marks, created_at, students(full_name, roll_number, photo_url)")
        .eq("class", classFilter)
        .eq("exam_type", examType)
        .eq("is_published", true)
        .order("position", { ascending: true, nullsFirst: false })
        .order("percentage", { ascending: false });

      if (year) query = query.eq("year", year);
      if (search) {
        const safe = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
        query = query.or(`students.full_name.ilike.%${safe}%,students.roll_number.ilike.%${safe}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as ResultWithStudent[];
    },
    enabled: !!classFilter && !!examType,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

// ─── All results for a class (admin, includes unpublished) ──────────────────

export function useAdminResults(cls: string, examType: string, year: number) {
  return useQuery<ResultWithStudent[]>({
    queryKey: ["admin-results", cls, examType, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("results")
        .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, teacher_remarks, subject_marks, created_at, students(full_name, roll_number, photo_url)")
        .eq("class", cls)
        .eq("exam_type", examType)
        .eq("year", year)
        .order("percentage", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ResultWithStudent[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

// ─── Multi-exam results for analytics ───────────────────────────────────────

export function useClassResultsForYear(cls: string, year: number) {
  return useQuery<ResultWithStudent[]>({
    queryKey: ["class-results-year", cls, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("results")
        .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, teacher_remarks, subject_marks, created_at, students(full_name, roll_number, photo_url)")
        .eq("class", cls)
        .eq("year", year);
      if (error) throw error;
      return (data ?? []) as unknown as ResultWithStudent[];
    },
    enabled: !!cls && !!year,
    staleTime: 10 * 60 * 1000,
  });
}

export function useResultYears() {
  return useQuery<number[]>({
    queryKey: ["result-years"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("results")
        .select("year")
        .order("year", { ascending: false });
      if (error) throw error;
      const years = [...new Set((data ?? []).map((r: { year: number }) => r.year))];
      return years;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

// ─── 3.4 Grading Schemes CRUD ───────────────────────────────────────────────

export function useGradingSchemes() {
  return useQuery<GradingScheme[]>({
    queryKey: ["grading-schemes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grading_schemes")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // Set the active scheme in memory
      const active = (data ?? []).find((s: GradingScheme) => s.is_active);
      if (active) setActiveScheme(active);
      return (data ?? []) as GradingScheme[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveGradingScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scheme: Partial<GradingScheme> & { scheme_name: string }) => {
      if (scheme.id) {
        const { data, error } = await supabase
          .from("grading_schemes")
          .update(scheme)
          .eq("id", scheme.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("grading_schemes")
          .insert(scheme)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grading-schemes"] });
    },
  });
}

export function useActivateGradingScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Deactivate all first
      await supabase.from("grading_schemes").update({ is_active: false }).neq("id", id);
      // Activate the selected one
      const { data, error } = await supabase
        .from("grading_schemes")
        .update({ is_active: true })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grading-schemes"] });
    },
  });
}

export function useDeleteGradingScheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grading_schemes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grading-schemes"] });
    },
  });
}

// ─── Attendance summary for report cards (Enhanced - Feature 4.6) ───────────

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfday: number;
  total: number;
  percentage: number;
  isEligible: boolean;
  warningLevel: "none" | "caution" | "warning" | "critical";
  award: string | null;
}

export function useAttendanceSummary(studentId: string, year: number) {
  return useQuery<AttendanceSummary>({
    queryKey: ["attendance-summary", studentId, year],
    queryFn: async () => {
      const data = await fetchReportCardAttendance(studentId, year);
      return data;
    },
    enabled: !!studentId,
    staleTime: 30 * 60 * 1000,
  });
}
