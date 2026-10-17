/**
 * StudentProfileDrawer.tsx — GHS Babi Khel
 * -----------------------------------------------------------------------------
 * One-drawer 360° student view: results trend (mini chart),
 * fee status, credential/ID card, and exam roll numbers — all joined from
 * tables that already exist (students / results / fee_vouchers /
 * generated_id_cards / exam_roll_numbers).
 *
 * Mobile-first: full-width slide-in on phones, wide side panel on desktop.
 * -----------------------------------------------------------------------------
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Wallet,
  CreditCard,
  Hash,
  Phone,
  CheckCircle2,
  XCircle,
  ArrowLeft,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { examTypeLabel } from "@/utils/examTypeLabel";

// ─── Public types (mirror the local Student interface in AdminStudents.tsx) ──

export interface StudentProfileStudent {
  id: string;
  full_name: string;
  roll_number: string;
  class: string;
  father_name: string | null;
  father_cnic: string | null;
  contact_number: string | null;
  photo_url: string | null;
  is_active: boolean;
  created_at?: string;
}

interface Props {
  student: StudentProfileStudent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const fmtPKR = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "Rs 0";
  return "Rs " + v.toLocaleString("en-PK");
};

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");


// ─── Results query ───────────────────────────────────────────────────────────

interface ResultRow {
  id: string;
  exam_type: string;
  year: number;
  total_marks: number;
  obtained_marks: number;
  percentage: number;
  grade: string | null;
  is_pass: boolean;
  position: number | null;
}

function useStudentResults(studentId: string | null) {
  return useQuery<ResultRow[]>({
    queryKey: ["student-profile-results", studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const { data, error } = await supabase
        .from("results")
        .select(
          "id, exam_type, year, total_marks, obtained_marks, percentage, grade, is_pass, position"
        )
        .eq("student_id", studentId)
        .order("year", { ascending: true })
        .order("exam_type", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ResultRow[];
    },
    enabled: !!studentId,
    staleTime: 60 * 1000,
  });
}

// ─── Fee query (per-student aggregate + voucher list) ────────────────────────

interface FeeVoucherRow {
  id: string;
  voucher_number: string;
  month: number | null;
  year: number | null;
  fee_period: string | null;
  total_amount: number;
  paid_amount: number;
  late_fee: number;
  status: string;
  due_date: string | null;
}

interface FeeAggregate {
  vouchers: FeeVoucherRow[];
  totalBilled: number;
  totalPaid: number;
  totalLate: number;
  outstanding: number;
  byStatus: Record<string, number>; // unpaid / partial / paid / overdue / waived
}

function useStudentFees(studentId: string | null) {
  return useQuery<FeeAggregate>({
    queryKey: ["student-profile-fees", studentId],
    queryFn: async () => {
      if (!studentId)
        return { vouchers: [], totalBilled: 0, totalPaid: 0, totalLate: 0, outstanding: 0, byStatus: {} };
      const { data, error } = await supabase
        .from("fee_vouchers")
        .select(
          "id, voucher_number, month, year, fee_period, total_amount, paid_amount, late_fee, status, due_date"
        )
        .eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const vouchers = (data ?? []) as FeeVoucherRow[];
      const totalBilled = vouchers.reduce((s, v) => s + Number(v.total_amount ?? 0), 0);
      const totalPaid = vouchers.reduce((s, v) => s + Number(v.paid_amount ?? 0), 0);
      const totalLate = vouchers.reduce((s, v) => s + Number(v.late_fee ?? 0), 0);
      const outstanding =
        totalBilled + totalLate - totalPaid;
      const byStatus: Record<string, number> = {};
      vouchers.forEach((v) => {
        byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
      });
      return { vouchers, totalBilled, totalPaid, totalLate, outstanding, byStatus };
    },
    enabled: !!studentId,
    staleTime: 60 * 1000,
  });
}

// ─── Generated ID card query ─────────────────────────────────────────────────

interface GeneratedIDCard {
  id: string;
  session: string | null;
  serial_no: string | null;
  emis_code: string | null;
  front_url: string | null;
}

function useStudentIDCard(studentId: string | null) {
  return useQuery<GeneratedIDCard | null>({
    queryKey: ["student-profile-idcard", studentId],
    queryFn: async () => {
      if (!studentId) return null;
      const { data, error } = await supabase
        .from("generated_id_cards")
        .select("id, session, serial_no, emis_code, front_url")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as GeneratedIDCard | null) ?? null;
    },
    enabled: !!studentId,
    staleTime: 60 * 1000,
  });
}

// ─── Exam roll numbers query ─────────────────────────────────────────────────

interface ExamRollEntry {
  id: string;
  exam_roll_no: string;
  class_roll_no: string | null;
  class: string | null;
  serial_number: number;
  student_name: string | null;
  father_name: string | null;
}

interface ExamRollWithSession extends ExamRollEntry {
  session_title: string | null;
  exam_year: number | null;
  exam_term: string | null;
}

function useStudentExamRolls(studentId: string | null) {
  return useQuery<ExamRollWithSession[]>({
    queryKey: ["student-profile-exam-rolls", studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const { data, error } = await supabase
        .from("exam_roll_numbers")
        .select(
          "id, exam_roll_no, class_roll_no, class, serial_number, student_name, father_name, session_id"
        )
        .eq("student_id", studentId)
        .order("serial_number", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as (ExamRollEntry & { session_id: string })[];

      if (rows.length === 0) return [];

      // Fetch the related sessions in a single call
      const sessionIds = Array.from(new Set(rows.map((r) => r.session_id)));
      const { data: sessions, error: sErr } = await supabase
        .from("exam_roll_sessions")
        .select("id, title, exam_year, exam_term")
        .in("id", sessionIds);
      if (sErr) throw sErr;
      const sMap = new Map<string, { title: string; exam_year: number; exam_term: string }>();
      (sessions ?? []).forEach((s: any) => {
        sMap.set(s.id, { title: s.title, exam_year: s.exam_year, exam_term: s.exam_term });
      });

      return rows.map((r) => {
        const s = sMap.get(r.session_id);
        return {
          id: r.id,
          exam_roll_no: r.exam_roll_no,
          class_roll_no: r.class_roll_no,
          class: r.class,
          serial_number: r.serial_number,
          student_name: r.student_name,
          father_name: r.father_name,
          session_title: s?.title ?? null,
          exam_year: s?.exam_year ?? null,
          exam_term: s?.exam_term ?? null,
        };
      });
    },
    enabled: !!studentId,
    staleTime: 60 * 1000,
  });
}

// ─── Fee status badge ────────────────────────────────────────────────────────

function FeeStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800" },
    partial: { label: "Partial", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800" },
    unpaid: { label: "Unpaid", cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800" },
    overdue: { label: "Overdue", cls: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-700" },
    waived: { label: "Waived", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800" },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
  );
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Main component ──────────────────────────────────────────────────────────

export function StudentProfileDrawer({ student, open, onOpenChange }: Props) {
  const id = student?.id ?? null;

  // Image error states for handling broken Cloudinary URLs
  const [headerImgError, setHeaderImgError] = useState(false);
  const [idCardImgError, setIdCardImgError] = useState(false);

  // Reset image errors when student changes
  useMemo(() => {
    setHeaderImgError(false);
    setIdCardImgError(false);
  }, [student?.id]);

  const resultsQ = useStudentResults(id);
  const feesQ = useStudentFees(id);
  const idCardQ = useStudentIDCard(id);
  const examRollsQ = useStudentExamRolls(id);

  // Chart data: results trend (percentage per exam, oldest → newest)
  const chartData = useMemo(() => {
    if (!resultsQ.data) return [];
    return resultsQ.data.map((r) => ({
      label: `${examTypeLabel(r.exam_type)} ${r.year}`,
      short: `${r.exam_type.slice(0, 2)}${String(r.year).slice(-2)}`,
      percentage: Math.round(Number(r.percentage ?? 0) * 10) / 10,
      is_pass: r.is_pass,
    }));
  }, [resultsQ.data]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl p-0 flex flex-col"
      >
        {/* Hidden accessible title/description for Radix Dialog semantics */}
        <SheetHeader className="sr-only">
          <SheetTitle>Student profile</SheetTitle>
          <SheetDescription>
            Results, fees, ID card, and exam roll numbers for{" "}
            {student?.full_name ?? "the selected student"}.
          </SheetDescription>
        </SheetHeader>

        {/* ── Sticky header (back button + photo + name + status) ────────── */}
        <div className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border/60 px-4 sm:px-5 py-3.5 flex items-start gap-3">
          {/* Back / close button — prominent, easy to tap on mobile */}
          <button
            onClick={() => onOpenChange(false)}
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-secondary text-foreground shadow-none transition-colors hover:bg-secondary/70"
            aria-label="Close student profile"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          {/* Header photo with error handling */}
          {student?.photo_url && !headerImgError ? (
            <img
              src={student.photo_url}
              alt={`${student.full_name}'s photo`}
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border-2 border-background shadow-sm shrink-0"
              onError={() => setHeaderImgError(true)}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-base shrink-0 border-2 border-background shadow-sm">
              {student ? initials(student.full_name) : "?"}
            </div>
          )}
          
          <div className="flex-1 min-w-0">
            <h2 className="font-heading font-bold text-base sm:text-lg leading-tight truncate">
              {student?.full_name ?? "—"}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-xs font-mono text-muted-foreground">
                #{student?.roll_number ?? "—"}
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                Class {student?.class ?? "—"}
              </span>
              {student && (
                <span
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    student.is_active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  {student.is_active ? "Active" : "Inactive"}
                </span>
              )}
            </div>
            {student?.father_name && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                S/o {student.father_name}
              </p>
            )}
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-4">
          {/* ── Quick contacts row (mobile-friendly chips) ─────────────── */}
          {(student?.contact_number || student?.father_cnic) && (
            <div className="flex flex-wrap gap-2">
              {student?.contact_number && (
                <a
                  href={`tel:${student.contact_number}`}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <Phone className="w-3 h-3" />
                  <span className="font-mono">{student.contact_number}</span>
                </a>
              )}
              {student?.father_cnic && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-xs font-medium">
                  <CreditCard className="w-3 h-3" />
                  <span className="font-mono">{student.father_cnic}</span>
                </span>
              )}
            </div>
          )}


          {/* ── 2. Results trend (mini chart) ──────────────────────────── */}
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold">Results Trend</h3>
                </div>
                {resultsQ.data && resultsQ.data.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {resultsQ.data.length} exam(s)
                  </span>
                )}
              </div>

              {resultsQ.isLoading ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : chartData.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  <TrendingUp className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
                  No results recorded yet.
                </div>
              ) : (
                <>
                  {/* Mini line chart — responsive, full width on mobile */}
                  <div className="h-32 sm:h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chartData}
                        margin={{ top: 5, right: 8, bottom: 0, left: -22 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" />
                        <XAxis
                          dataKey="short"
                          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                          axisLine={false}
                          interval={0}
                          height={16}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                          tickLine={false}
                          axisLine={false}
                          width={28}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: "11px",
                            borderRadius: "8px",
                            border: "1px solid hsl(var(--border))",
                            background: "hsl(var(--card))",
                            color: "hsl(var(--foreground))",
                            padding: "6px 8px",
                          }}
                          labelStyle={{ fontSize: "10px", fontWeight: 600 }}
                          formatter={(value: number) => [`${value}%`, "Score"]}
                          labelFormatter={(_, payload) =>
                            payload?.[0]?.payload?.label ?? ""
                          }
                        />
                        <ReferenceLine y={33} stroke="#ef4444" strokeDasharray="2 2" />
                        <Line
                          type="monotone"
                          dataKey="percentage"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "hsl(var(--primary))" }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-1 text-center">
                    Red dashed line = pass threshold (33%)
                  </p>

                  {/* Results table — card list on mobile, table on sm */}
                  <div className="mt-3 space-y-1.5 sm:hidden">
                    {resultsQ.data!.slice().reverse().map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/40 px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{examTypeLabel(r.exam_type)}</p>
                          <p className="text-[10px] text-muted-foreground">{r.year}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-bold">{Math.round(r.percentage)}%</span>
                          {r.is_pass ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-red-500" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden sm:block mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/60 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          <th className="py-1.5 pr-2">Exam</th>
                          <th className="py-1.5 pr-2">Year</th>
                          <th className="py-1.5 pr-2">Obtained</th>
                          <th className="py-1.5 pr-2">%</th>
                          <th className="py-1.5 pr-2">Grade</th>
                          <th className="py-1.5 pr-2">Pos</th>
                          <th className="py-1.5 pr-2 text-right">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultsQ.data!.slice().reverse().map((r) => (
                          <tr key={r.id} className="border-b last:border-0">
                            <td className="py-1.5 pr-2 font-medium">{examTypeLabel(r.exam_type)}</td>
                            <td className="py-1.5 pr-2 text-muted-foreground">{r.year}</td>
                            <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                              {r.obtained_marks}/{r.total_marks}
                            </td>
                            <td className="py-1.5 pr-2 font-bold">
                              {Math.round(r.percentage)}%
                            </td>
                            <td className="py-1.5 pr-2">
                              {r.grade ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {r.grade}
                                </Badge>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {r.position ?? "—"}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {r.is_pass ? (
                                <span className="text-emerald-600 font-medium">Pass</span>
                              ) : (
                                <span className="text-red-600 font-medium">Fail</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── 3. Fee status ──────────────────────────────────────────── */}
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Fee Status</h3>
              </div>

              {feesQ.isLoading ? (
                <Skeleton className="h-24 rounded-lg" />
              ) : !feesQ.data || feesQ.data.vouchers.length === 0 ? (
                <div className="text-center py-4 text-xs text-muted-foreground">
                  <Wallet className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
                  No fee vouchers issued yet.
                </div>
              ) : (
                <>
                  {/* Aggregate — 3 stat blocks */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="rounded-xl border border-border/60 bg-muted/40 p-2 text-center">
                      <p className="text-[9px] uppercase text-muted-foreground">Billed</p>
                      <p className="text-sm font-bold mt-0.5">
                        {fmtPKR(feesQ.data.totalBilled)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-200/60 bg-emerald-50 p-2 text-center dark:border-emerald-800/40 dark:bg-emerald-900/20">
                      <p className="text-[9px] uppercase text-muted-foreground">Paid</p>
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">
                        {fmtPKR(feesQ.data.totalPaid)}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border p-2 text-center ${
                        feesQ.data.outstanding > 0
                          ? "border-red-200/60 bg-red-50 dark:border-red-800/40 dark:bg-red-900/20"
                          : "border-border/60 bg-muted/40"
                      }`}
                    >
                      <p className="text-[9px] uppercase text-muted-foreground">Outstanding</p>
                      <p
                        className={`text-sm font-bold mt-0.5 ${
                          feesQ.data.outstanding > 0
                            ? "text-red-700 dark:text-red-300"
                            : "text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        {fmtPKR(feesQ.data.outstanding)}
                      </p>
                    </div>
                  </div>

                  {/* Status chip summary */}
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {(["unpaid", "partial", "overdue", "paid", "waived"] as const).map((s) => {
                      const n = feesQ.data!.byStatus[s] ?? 0;
                      if (n === 0) return null;
                      return (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                        >
                          <FeeStatusBadge status={s} /> ×{n}
                        </span>
                      );
                    })}
                  </div>

                  {/* Voucher list */}
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {feesQ.data.vouchers.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/30 px-2.5 py-1.5 transition-colors hover:bg-muted/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono font-medium truncate">
                            {v.voucher_number}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {v.month && v.year
                              ? `${MONTH_NAMES[v.month]} ${v.year}`
                              : v.fee_period
                              ? v.fee_period
                              : "—"}
                            {v.due_date && ` · Due ${v.due_date.slice(5)}`}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-semibold">
                            {fmtPKR(Number(v.total_amount) + Number(v.late_fee))}
                          </p>
                          <div className="flex items-center gap-1 justify-end mt-0.5">
                            <FeeStatusBadge status={v.status} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── 4. Credential / ID card ────────────────────────────────── */}
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Credential / ID Card</h3>
              </div>

              {idCardQ.isLoading ? (
                <Skeleton className="h-40 rounded-lg" />
              ) : (
                <div className="rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-card p-3.5">
                  {/* Header strip */}
                  <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-2.5">
                    <div>
                      <p className="text-[11px] font-heading font-bold text-primary leading-tight">
                        GHS Babi Khel
                      </p>
                      <p className="text-[8px] text-muted-foreground uppercase tracking-wide">
                        Student Identity Card
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[8px] text-muted-foreground uppercase">EMIS</p>
                      <p className="text-[10px] font-mono font-bold">
                        {idCardQ.data?.emis_code ?? "60673"}
                      </p>
                    </div>
                  </div>

                  {/* Photo + core identity with error handling */}
                  <div className="flex gap-3">
                    <div className="shrink-0">
                      {student?.photo_url && !idCardImgError ? (
                        <img
                          src={student.photo_url}
                          alt={`${student.full_name}'s photo`}
                          className="w-14 h-16 rounded-md object-cover border border-border"
                          onError={() => setIdCardImgError(true)}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-14 h-16 rounded-md bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm border border-border">
                          {student ? initials(student.full_name) : "?"}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div>
                        <p className="text-[8px] uppercase text-muted-foreground">Name</p>
                        <p className="text-xs font-bold truncate">
                          {student?.full_name ?? "—"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[8px] uppercase text-muted-foreground">Roll No</p>
                          <p className="text-[11px] font-mono font-medium">
                            {student?.roll_number ?? "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] uppercase text-muted-foreground">Class</p>
                          <p className="text-[11px] font-medium">
                            {student?.class ?? "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detail rows */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-border/60 text-[10px]">
                    <div>
                      <p className="uppercase text-muted-foreground">Father</p>
                      <p className="font-medium truncate">
                        {student?.father_name ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase text-muted-foreground">Session</p>
                      <p className="font-mono font-medium">
                        {idCardQ.data?.session ??
                          `${new Date().getFullYear()}–${new Date().getFullYear() + 1}`}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase text-muted-foreground">Serial No</p>
                      <p className="font-mono font-medium">
                        {idCardQ.data?.serial_no ??
                          `SN-${student?.id.slice(0, 6).toUpperCase() ?? "------"}`}
                      </p>
                    </div>
                    <div>
                      <p className="uppercase text-muted-foreground">Status</p>
                      <p
                        className={`font-medium ${
                          student?.is_active ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        {student?.is_active ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>

                  {/* Footer / ID */}
                  <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between">
                    <span className="text-[8px] text-muted-foreground">
                      ID:{" "}
                      <span className="font-mono">
                        {student?.id.slice(0, 8).toUpperCase() ?? "—"}
                      </span>
                    </span>
                    {idCardQ.data?.front_url && (
                      <a
                        href={idCardQ.data.front_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[9px] text-primary hover:underline"
                      >
                        View full card →
                      </a>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── 5. Exam roll numbers ───────────────────────────────────── */}
          <Card className="rounded-2xl border-border/60 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Hash className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Exam Roll Numbers</h3>
              </div>

              {examRollsQ.isLoading ? (
                <Skeleton className="h-20 rounded-lg" />
              ) : !examRollsQ.data || examRollsQ.data.length === 0 ? (
                <div className="text-center py-4 text-xs text-muted-foreground">
                  <Hash className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
                  No exam roll numbers assigned yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {examRollsQ.data.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/30 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">
                          {r.session_title ?? "Exam Session"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {[r.exam_term, r.exam_year].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold font-mono text-primary leading-none">
                          {r.exam_roll_no}
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-1">
                          Class Roll: {r.class_roll_no ?? "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bottom spacer for breathing room on mobile */}
          <div className="h-2" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default StudentProfileDrawer;
