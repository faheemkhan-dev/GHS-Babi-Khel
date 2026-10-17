// src/hooks/useNewFeatures.ts
// Hooks for: ExamSchedule, MeritList, AttendanceStats
// (Quotes and Honor Roll hooks removed — Quotes is now a static list at
// src/data/dailyQuotes.ts, Honor Roll was removed entirely.)
// Updated for Feature 4.4: Half-Day attendance support
// Used by all new feature tabs/components

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { computeAttendancePercentage } from "@/hooks/useAttendanceAnalytics";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ExamScheduleEntry {
  id: string;
  class: string;
  exam_type: string;
  year: number;
  subject: string;
  paper_name: string | null;
  paper_code: string | null;
  exam_date: string;
  start_time: string | null;
  end_time: string | null;
  hall: string | null;
  notes: string | null;
  is_published: boolean;
  created_at: string;
}

export interface MeritList {
  id: string;
  class: string;
  exam_type: string;
  year: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

// ─── EXAM SCHEDULE HOOKS ──────────────────────────────────────────────────────

export function useExamSchedule(cls?: string, examType?: string, year?: number) {
  return useQuery<ExamScheduleEntry[]>({
    queryKey: ["exam-schedule", cls, examType, year],
    queryFn: async () => {
      let q = supabase
        .from("exam_schedule")
        .select("*")
        .eq("is_published", true)
        .order("exam_date", { ascending: true });
      if (cls) q = q.eq("class", cls);
      if (examType) q = q.eq("exam_type", examType);
      if (year) q = q.eq("year", year);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!cls,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllExamSchedule() {
  return useQuery<ExamScheduleEntry[]>({
    queryKey: ["all-exam-schedule"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exam_schedule")
        .select("*")
        .order("exam_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertExamSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entries: Omit<ExamScheduleEntry, "id" | "created_at">[]) => {
      const { error } = await supabase.from("exam_schedule").insert(entries);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-schedule"] });
      qc.invalidateQueries({ queryKey: ["all-exam-schedule"] });
    },
  });
}

export function useDeleteExamEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("exam_schedule").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-schedule"] });
      qc.invalidateQueries({ queryKey: ["all-exam-schedule"] });
    },
  });
}

// Deletes every exam-schedule row for one class + exam type + year in a single go —
// used by the "clear this class's schedule" action in the Exam Date Sheet manager.
export function useDeleteExamScheduleBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { cls: string; examType: string; year: number }) => {
      const { error } = await supabase
        .from("exam_schedule")
        .delete()
        .eq("class", params.cls)
        .eq("exam_type", params.examType)
        .eq("year", params.year);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-schedule"] });
      qc.invalidateQueries({ queryKey: ["all-exam-schedule"] });
    },
  });
}

// ─── MERIT LIST HOOKS ─────────────────────────────────────────────────────────

export function useMeritLists() {
  return useQuery<MeritList[]>({
    queryKey: ["merit-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("merit_lists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePublishMeritList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cls, examType, year }: { cls: string; examType: string; year: number }) => {
      const { error } = await supabase.from("merit_lists").upsert({
        class: cls, exam_type: examType, year,
        is_published: true, published_at: new Date().toISOString(),
      }, { onConflict: "class,exam_type,year" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merit-lists"] }),
  });
}

// ─── ATTENDANCE STATS HOOKS (Enhanced with Half-Day - Feature 4.4) ───────────

export interface AttendanceStat {
  total_days: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  leave_days: number;
  halfday_days: number;
  percentage: number;
}

export function useStudentAttendanceStats(studentId: string | undefined, month?: number, year?: number) {
  return useQuery<AttendanceStat>({
    queryKey: ["attendance-stat", studentId, month, year],
    queryFn: async () => {
      if (!studentId) return { total_days: 0, present_days: 0, absent_days: 0, late_days: 0, leave_days: 0, halfday_days: 0, percentage: 0 };
      let q = supabase.from("attendance").select("status").eq("student_id", studentId);
      if (month && year) {
        const start = `${year}-${String(month).padStart(2, "0")}-01`;
        const end = `${year}-${String(month).padStart(2, "0")}-31`;
        q = q.gte("date", start).lte("date", end);
      }
      const { data, error } = await q;
      if (error) throw error;
      const records = data ?? [];
      const present = records.filter((r) => r.status === "present").length;
      const absent = records.filter((r) => r.status === "absent").length;
      const late = records.filter((r) => r.status === "late").length;
      const leave = records.filter((r) => r.status === "leave").length;
      const halfday = records.filter((r) => r.status === "halfday").length;
      const total = records.length;
      const percentage = computeAttendancePercentage({ present, late, halfday, total });
      return { total_days: total, present_days: present, absent_days: absent, late_days: late, leave_days: leave, halfday_days: halfday, percentage };
    },
    enabled: !!studentId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClassAttendanceSummary(cls: string, month: number, year: number) {
  return useQuery<{ student_id: string; student_name: string; percentage: number }[]>({
    queryKey: ["class-attendance-summary", cls, month, year],
    queryFn: async () => {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const end = `${year}-${String(month).padStart(2, "0")}-31`;
      const { data: students } = await supabase
        .from("students")
        .select("id, full_name")
        .eq("class", cls)
        .eq("is_active", true);
      if (!students?.length) return [];
      const { data: att } = await supabase
        .from("attendance")
        .select("student_id, status")
        .in("student_id", students.map((s) => s.id))
        .gte("date", start)
        .lte("date", end);
      const attRecords = att ?? [];
      return students.map((s) => {
        const mine = attRecords.filter((a) => a.student_id === s.id);
        const present = mine.filter((a) => a.status === "present").length;
        const late = mine.filter((a) => a.status === "late").length;
        const halfday = mine.filter((a) => a.status === "halfday").length;
        const total = mine.length;
        const percentage = computeAttendancePercentage({ present, late, halfday, total });
        return {
          student_id: s.id,
          student_name: s.full_name,
          percentage,
        };
      }).sort((a, b) => b.percentage - a.percentage);
    },
    enabled: !!cls,
    staleTime: 5 * 60 * 1000,
  });
}
