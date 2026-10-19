// src/hooks/useNewFeatures.ts
// Hooks for: ExamSchedule, MeritList
// (Quotes and Honor Roll hooks removed — Quotes is now a static list at
// src/data/dailyQuotes.ts, Honor Roll was removed entirely.
//  School attendance stats hooks removed along with the Attendance feature.)
// Used by all new feature tabs/components

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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

/**
 * Whole exam date sheet. `options.enabled` lets callers gate the fetch —
 * the public /roll-no-slip page only needs the sheet in LIVE mode (the
 * countdown panel never prints a date sheet), so it passes
 * { enabled: !showCountdown } and saves one whole-table request during
 * countdown visits. All other callers keep the default (always on).
 */
export function useAllExamSchedule(options?: { enabled?: boolean }) {
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
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
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

