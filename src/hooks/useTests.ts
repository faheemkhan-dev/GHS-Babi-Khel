import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

// ─── Types ───────────────────────────────────────────────────────────
export interface Test {
  id: string;
  title: string;
  subject: string;
  type: "weekly" | "monthly";
  description: string | null;
  time_per_question: number;
  is_published: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  question_count?: number;
}

export interface TestQuestion {
  id: string;
  test_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: "A" | "B" | "C" | "D";
  order_number: number;
  created_at: string;
}

export interface TestAttempt {
  id: string;
  test_id: string;
  user_id: string;
  student_name: string;
  student_class: string | null;
  roll_number: string | null;
  answers: Record<string, string>;
  score: number;
  total_questions: number;
  percentage: number;
  time_taken: number | null;
  completed_at: string;
}

export type TestFormData = Pick<Test, "title" | "subject" | "type" | "description" | "time_per_question">;
export type QuestionFormData = Pick<TestQuestion, "question_text" | "option_a" | "option_b" | "option_c" | "option_d" | "correct_option">;

const QUERY_OPTS = { staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000 };

// ─── Admin hooks ─────────────────────────────────────────────────────
export function useAdminTests() {
  return useQuery<Test[]>({
    queryKey: ["admin-tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tests")
        .select("id, title, subject, type, description, time_per_question, is_published, is_active, created_by, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // get question counts
      const ids = (data || []).map((t) => t.id);
      if (ids.length === 0) return [];
      const { data: counts } = await supabase
        .from("test_questions")
        .select("test_id")
        .in("test_id", ids);
      const countMap: Record<string, number> = {};
      (counts || []).forEach((q: { test_id: string }) => {
        countMap[q.test_id] = (countMap[q.test_id] || 0) + 1;
      });
      return (data || []).map((t) => ({ ...t, question_count: countMap[t.id] || 0 }));
    },
    ...QUERY_OPTS,
  });
}

export function useTestQuestions(testId: string | null) {
  return useQuery<TestQuestion[]>({
    queryKey: ["test-questions", testId],
    queryFn: async () => {
      if (!testId) return [];
      const { data, error } = await supabase
        .from("test_questions")
        .select("id, test_id, question_text, option_a, option_b, option_c, option_d, correct_option, order_number, created_at")
        .eq("test_id", testId)
        .order("order_number");
      if (error) throw error;
      return data || [];
    },
    enabled: !!testId,
    ...QUERY_OPTS,
  });
}

export function useTestAttempts(testId: string | null) {
  return useQuery<TestAttempt[]>({
    queryKey: ["test-attempts", testId],
    queryFn: async () => {
      if (!testId) return [];
      const { data, error } = await supabase
        .from("test_attempts")
        .select("id, test_id, user_id, student_name, student_class, roll_number, answers, score, total_questions, percentage, time_taken, completed_at")
        .eq("test_id", testId)
        .order("score", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!testId,
    ...QUERY_OPTS,
  });
}

export function useTestMutations() {
  const qc = useQueryClient();

  const createTest = useMutation({
    mutationFn: async (form: TestFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("tests").insert({ ...form, created_by: user?.id }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tests"] }),
  });

  const updateTest = useMutation({
    mutationFn: async ({ id, ...form }: TestFormData & { id: string }) => {
      const { error } = await supabase.from("tests").update(form).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tests"] }),
  });

  const deleteTest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tests"] }),
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) => {
      const { error } = await supabase.from("tests").update({ is_published }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-tests"] }),
  });

  const addQuestion = useMutation({
    mutationFn: async ({ testId, question, orderNumber }: { testId: string; question: QuestionFormData; orderNumber: number }) => {
      const { error } = await supabase.from("test_questions").insert({ ...question, test_id: testId, order_number: orderNumber });
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["test-questions", v.testId] });
      qc.invalidateQueries({ queryKey: ["admin-tests"] });
    },
  });

  const updateQuestion = useMutation({
    mutationFn: async ({ id, ...q }: QuestionFormData & { id: string }) => {
      const { error } = await supabase.from("test_questions").update(q).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-questions"] }),
  });

  const deleteQuestion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("test_questions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test-questions"] });
      qc.invalidateQueries({ queryKey: ["admin-tests"] });
    },
  });

  const bulkInsertQuestions = useMutation({
    mutationFn: async ({ testId, questions }: { testId: string; questions: (QuestionFormData & { order_number: number })[] }) => {
      const rows = questions.map((q) => ({ ...q, test_id: testId }));
      const { error } = await supabase.from("test_questions").insert(rows);
      if (error) throw error;
      return questions.length;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["test-questions", v.testId] });
      qc.invalidateQueries({ queryKey: ["admin-tests"] });
    },
  });

  return { createTest, updateTest, deleteTest, togglePublish, addQuestion, updateQuestion, deleteQuestion, bulkInsertQuestions };
}

// ─── User hooks ──────────────────────────────────────────────────────
export function usePublishedTests() {
  return useQuery<Test[]>({
    queryKey: ["published-tests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tests")
        .select("id, title, subject, type, description, time_per_question, is_published, is_active, created_by, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // counts
      const ids = (data || []).map((t) => t.id);
      if (ids.length === 0) return [];
      const { data: counts } = await supabase.from("test_questions").select("test_id").in("test_id", ids);
      const cm: Record<string, number> = {};
      (counts || []).forEach((q: { test_id: string }) => { cm[q.test_id] = (cm[q.test_id] || 0) + 1; });
      return (data || []).map((t) => ({ ...t, question_count: cm[t.id] || 0 }));
    },
    ...QUERY_OPTS,
  });
}

export function useMyAttempts() {
  const { user } = useAuth();
  return useQuery<TestAttempt[]>({
    queryKey: ["my-attempts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("test_attempts")
        .select("id, test_id, user_id, student_name, student_class, roll_number, answers, score, total_questions, percentage, time_taken, completed_at")
        .eq("user_id", user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    ...QUERY_OPTS,
  });
}

export function useSubmitAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attempt: Omit<TestAttempt, "id" | "completed_at">) => {
      const { data, error } = await supabase.from("test_attempts").insert(attempt).select().single();
      if (error) throw error;
      return data as TestAttempt;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-attempts"] });
      qc.invalidateQueries({ queryKey: ["test-attempts"] });
    },
  });
}

export function useAllAttempts() {
  return useQuery<TestAttempt[]>({
    queryKey: ["all-attempts-rankings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_attempts")
        .select("id, test_id, user_id, student_name, student_class, roll_number, score, total_questions, percentage, time_taken, completed_at, answers");
      if (error) throw error;
      return data || [];
    },
    ...QUERY_OPTS,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────
export function getGrade(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 50) return "C";
  return "F";
}

export function formatTimeTaken(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
