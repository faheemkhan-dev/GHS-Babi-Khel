import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
  created_at: string;
  students: {
    full_name: string;
    roll_number: string;
    photo_url: string | null;
  } | null;
}

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
        .select("id, student_id, class, exam_type, year, total_marks, obtained_marks, percentage, grade, position, is_pass, remarks, created_at, students(full_name, roll_number, photo_url)")
        .eq("class", classFilter)
        .eq("exam_type", examType)
        .eq("is_published", true)
        .order("position", { ascending: true, nullsFirst: false })
        .order("percentage", { ascending: false });

      if (year) query = query.eq("year", year);
      if (search) {
        // Escape LIKE wildcards to prevent wildcard injection
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

export function getGradeFromPercentage(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 60) return "B";
  if (pct >= 45) return "C";
  if (pct >= 33) return "D";
  return "Fail";
}

export function getGradeColor(grade: string): string {
  switch (grade) {
    case "A+": return "bg-primary-dark text-primary-foreground";
    case "A": return "bg-primary text-primary-foreground";
    case "B": return "bg-[hsl(172,66%,40%)] text-white";
    case "C": return "bg-warning text-white";
    case "D": return "bg-[hsl(25,95%,53%)] text-white";
    default: return "bg-destructive text-destructive-foreground";
  }
  }
