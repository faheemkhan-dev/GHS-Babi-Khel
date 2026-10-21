import { useState, useMemo, useCallback, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign, Plus, Pencil, Trash2, Loader2, Search, Download,
  FileText, CheckCircle, XCircle, Clock, AlertTriangle,
  BarChart3, TrendingUp, Users, CreditCard, Receipt,
  ChevronLeft, ChevronRight, ArrowUpDown, Eye,
  Wallet, Banknote, Building2, Smartphone, Printer,
  CalendarDays, CircleDollarSign, UserX, CheckCheck,
  UserCircle, X,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
// PERF (chunk size): recharts lives in its own lazy chunk (see
// ./fees/FeeCharts.tsx) and jspdf/jspdf-autotable load only inside the
// download/export click handlers — the Fees tab no longer ships ~100 KB of
// charts + ~142 KB of PDF library to admins who only manage structures,
// vouchers or payments.
const AgingPie = lazy(() => import("./fees/FeeCharts").then(m => ({ default: m.AgingPie })));
const ClassCollectionBar = lazy(() => import("./fees/FeeCharts").then(m => ({ default: m.ClassCollectionBar })));
const MonthlyCollectionBar = lazy(() => import("./fees/FeeCharts").then(m => ({ default: m.MonthlyCollectionBar })));
const ClassSummaryBar = lazy(() => import("./fees/FeeCharts").then(m => ({ default: m.ClassSummaryBar })));

import {
  useAllFeeStructures,
  useFeeStructures,
  useMutateFeeStructure,
  useFeeVouchers,
  useGenerateVouchers,
  useUpdateVoucher,
  useDeleteVoucher,
  useRecordPayment,
  useFeePayments,
  useFeeDashboard,
  useFeeDefaulters,
  useFeeCollectionReport,
  useClassCollectionSummary,
  useStudentsByClass,
  type FeeStructure,
  type FeeVoucher,
  type FeePayment,
  type FeeItem,
  type PaymentMethod,
} from "@/hooks/useFees";
import CustomFeeModal from "@/components/admin/fees/CustomFeeModal";

const CLASSES = ["6", "7", "8", "9", "10"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const FEE_TYPES = [
  { value: "tuition", label: "Tuition Fee" },
  { value: "lab", label: "Lab Fee" },
  { value: "library", label: "Library Fee" },
  { value: "transport", label: "Transport Fee" },
  { value: "exam", label: "Exam Fee" },
  { value: "admission", label: "Admission Fee" },
  { value: "migration", label: "Migration Fee" },
  { value: "bise", label: "BISE Registration" },
  { value: "other", label: "Other Fee" },
];
const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One Time" },
];
const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote, color: "text-green-600" },
  { value: "bank", label: "Bank Transfer", icon: Building2, color: "text-blue-600" },
  { value: "online", label: "Online / JazzCash / Easypaisa", icon: Smartphone, color: "text-purple-600" },
  { value: "cheque", label: "Cheque", icon: CreditCard, color: "text-orange-600" },
];
const CLASS_COLORS: Record<string, string> = {
  "6": "#6366f1", "7": "#10b981", "8": "#1e3a8a", "9": "#ef4444", "10": "#8b5cf6",
};

// ═══════════════════════════════════════════════════════════════
// Voucher PDF Generation - ACADEMIC EDITORIAL CREAM STYLE v2
// ═══════════════════════════════════════════════════════════════
// FIXES:
// 1. Removed all blue colors - now uses warm cream/academic palette
// 2. Shows payment_methods (EasyPaisa, JazzCash, Bank) properly
// 3. Professional editorial look suitable for printing

async function generateVoucherPDF(voucher: FeeVoucher, studentName: string, rollNumber: string) {
  // PERF: the PDF libraries load only when a voucher is actually downloaded.
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // ── CREAM/IVORY ACADEMIC PALETTE (No Blue!) ──
  const CREAM_BG: [number, number, number] = [254, 251, 245];       // Warm cream background
  const DARK_INK: [number, number, number] = [45, 35, 30];           // Dark brown/black for text
  const ACCENT_COLOR: [number, number, number] = [120, 80, 50];      // Warm brown accent
  const LIGHT_LINE: [number, number, number] = [200, 185, 165];      // Light brown lines
  const HEADER_BG: [number, number, number] = [235, 225, 210];       // Slightly darker cream for header
  const TABLE_HEADER: [number, number, number] = [180, 160, 140];    // Muted brown table header
  const TOTAL_BAR: [number, number, number] = [160, 140, 120];       // Darker brown for total bar

  // ── BACKGROUND ──
  doc.setFillColor(...CREAM_BG);
  doc.rect(0, 0, w, h, "F");

  // ── SUBTLE BORDER FRAME ──
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.8);
  doc.rect(8, 8, w - 16, h - 16);

  // ── HEADER SECTION ──
  doc.setFillColor(...HEADER_BG);
  doc.roundedRect(8, 8, w - 16, 30, 2, 2, "F");

  // School name - serif academic feel
  doc.setTextColor(...DARK_INK);
  doc.setFontSize(15);
  doc.setFont("times", "bold");
  doc.text("GHS Babi Khel", w / 2, 19, { align: "center" });

  doc.setFontSize(8);
  doc.setFont("times", "normal");
  doc.setTextColor(...ACCENT_COLOR);
  doc.text("Government High School  •  Mohmand District  •  KPK", w / 2, 25, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("times", "bold");
  doc.setTextColor(...DARK_INK);
  doc.text("FEE VOUCHER", w / 2, 34, { align: "center" });

  // ── VOUCHER INFO BOX ──
  const yPos = 42;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(12, yPos, w - 24, 22, 2, 2, "FD");

  const leftInfo = [
    ["Voucher #", voucher.voucher_number],
    ["Student", studentName],
    ["Roll No", rollNumber || "—"],
    ["Class", `Class ${voucher.class}`],
  ];
  
  const rightInfo = [
    ["Period", voucher.fee_period === "monthly" ? `${MONTHS[voucher.month - 1]} ${voucher.year}` : `${voucher.year}`],
    ["Due Date", format(new Date(voucher.due_date), "dd MMM yyyy")],
    ["Status", voucher.status.toUpperCase()],
    ["Type", voucher.fee_period === "monthly" ? "Monthly" : voucher.fee_period === "quarterly" ? "Quarterly" : "One-time"],
  ];

  leftInfo.forEach((row, i) => {
    const y = yPos + 6 + i * 4.5;
    doc.setTextColor(...ACCENT_COLOR);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(row[0], 16, y);
    doc.setTextColor(...DARK_INK);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(row[1], 44, y);
  });

  rightInfo.forEach((row, i) => {
    const y = yPos + 6 + i * 4.5;
    doc.setTextColor(...ACCENT_COLOR);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(row[0], w / 2 + 8, y);
    doc.setTextColor(...DARK_INK);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(row[1], w / 2 + 36, y);
  });

  // ── FEE BREAKDOWN TABLE ──
  const tableBody = (voucher.fee_items as FeeItem[]).map((item, i) => [
    String(i + 1),
    item.label,
    item.is_optional ? "Optional" : "Mandatory",
    `Rs. ${Number(item.amount).toLocaleString()}`,
  ]);

  if (voucher.late_fee > 0) {
    tableBody.push(["", "Late Fee", "Penalty", `Rs. ${Number(voucher.late_fee).toLocaleString()}`]);
  }

  autoTable(doc, {
    startY: 68,
    head: [["#", "Fee Description", "Type", "Amount"]],
    body: tableBody,
    headStyles: { 
      fillColor: TABLE_HEADER, 
      textColor: [255, 255, 255], 
      fontStyle: "bold", 
      fontSize: 9,
      font: "helvetica"
    },
    bodyStyles: { 
      fontSize: 9, 
      textColor: DARK_INK,
      font: "helvetica",
      lineColor: LIGHT_LINE,
      lineWidth: 0.1
    },
    columnStyles: {
      0: { cellWidth: 12, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 70 },
      2: { cellWidth: 38, halign: "center" },
      3: { cellWidth: 38, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [252, 248, 240] },
    margin: { left: 12, right: 12 },
    theme: "grid"
  });

  // ── TOTAL AMOUNT BAR ──
  const finalY = (doc as any).lastAutoTable?.finalY || 120;
  const totalY = finalY + 3;

  doc.setFillColor(...TOTAL_BAR);
  doc.roundedRect(12, totalY, w - 24, 11, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("TOTAL AMOUNT", 16, totalY + 7.5);
  doc.text(`Rs. ${Number(voucher.total_amount + (voucher.late_fee || 0)).toLocaleString()}`, w - 16, totalY + 7.5, { align: "right" });

  // ── PAYMENT METHODS SECTION (FIXED: Now shows ALL payment methods!) ──
  const paymentMethods = voucher.bank_details?.payment_methods || [];
  const hasBankDetails = voucher.bank_details?.bank_name || paymentMethods.length > 0;

  if (hasBankDetails) {
    let payY = totalY + 17;

    doc.setDrawColor(...LIGHT_LINE);
    doc.setLineWidth(0.2);
    doc.line(12, payY - 4, w - 12, payY - 4);

    doc.setTextColor(...DARK_INK);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("PAYMENT METHODS", 12, payY + 2);

    payY += 7;

    // If we have payment_methods array (new format)
    if (paymentMethods.length > 0) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...LIGHT_LINE);
      doc.roundedRect(12, payY, w - 24, Math.min(paymentMethods.length * 18 + 8, 72), 2, 2, "FD");

      payY += 6;

      paymentMethods.forEach((pm: PaymentMethod, idx: number) => {
        if (payY > h - 35) return; // Don't overflow page

        // Method type label with icon indicator
        const methodLabel = pm.type === "bank" 
          ? (pm.bank_name || "Bank Transfer")
          : pm.type === "easypaisa"
          ? `EasyPaisa${pm.account_name ? ` - ${pm.account_name}` : ""}`
          : pm.type === "jazzcash"
          ? `JazzCash${pm.account_name ? ` - ${pm.account_name}` : ""}`
          : pm.type === "cash"
          ? "Cash at School Office"
          : pm.label || pm.type;

        doc.setTextColor(...ACCENT_COLOR);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(`${idx + 1}. ${methodLabel.toUpperCase()}`, 18, payY);
        payY += 4;

        // Method-specific details
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(80, 70, 60);

        if (pm.type === "bank") {
          if (pm.account_title) doc.text(`   Account Title: ${pm.account_title}`, 18, payY); payY += 3.5;
          if (pm.account_number) doc.text(`   Account Number: ${pm.account_number}`, 18, payY); payY += 3.5;
          if (pm.iban) doc.text(`   IBAN: ${pm.iban}`, 18, payY); payY += 3.5;
        } else if (pm.type === "easypaisa" || pm.type === "jazzcash") {
          if (pm.account_name) doc.text(`   Account Name: ${pm.account_name}`, 18, payY); payY += 3.5;
          if (pm.phone) doc.text(`   Phone: ${pm.phone}`, 18, payY); payY += 3.5;
          doc.text(`   Open ${pm.type} app → Send Money → Enter details above`, 18, payY); payY += 3.5;
        } else if (pm.type === "cash") {
          doc.text(`   Pay at school office during working hours`, 18, payY); payY += 3.5;
        } else if (pm.type === "other" && pm.instructions) {
          doc.text(`   ${pm.instructions}`, 18, payY); payY += 3.5;
        }

        payY += 3; // Space between methods
      });
    } else if (voucher.bank_details?.bank_name) {
      // Legacy format: direct bank_details fields
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...LIGHT_LINE);
      doc.roundedRect(12, payY, w - 24, 22, 2, 2, "FD");

      doc.setTextColor(...ACCENT_COLOR);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("BANK DETAILS", 18, payY + 7);

      doc.setTextColor(80, 70, 60);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      
      const legacyBankLines = [
        voucher.bank_details.bank_name ? `Bank: ${voucher.bank_details.bank_name}` : "",
        voucher.bank_details.account_title ? `Account Title: ${voucher.bank_details.account_title}` : "",
        voucher.bank_details.account_number ? `Account No: ${voucher.bank_details.account_number}` : "",
        voucher.bank_details.iban ? `IBAN: ${voucher.bank_details.iban}` : "",
      ].filter(Boolean);

      legacyBankLines.forEach((line, i) => {
        doc.text(line, 18, payY + 13 + i * 4);
      });
    }
  }

  // ── FOOTER ──
  doc.setFillColor(...HEADER_BG);
  doc.rect(8, h - 14, w - 16, 6, "F");
  
  doc.setDrawColor(...LIGHT_LINE);
  doc.setLineWidth(0.3);
  doc.line(8, h - 14, w - 8, h - 14);

  doc.setTextColor(...LIGHT_LINE);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.text("GHS Babi Khel — Official Document", w / 2, h - 9, { align: "center" });
  
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated: ${format(new Date(), "dd MMM yyyy HH:mm")}`, 12, h - 9);
  doc.text(`${voucher.voucher_number}`, w - 12, h - 9, { align: "right" });

  doc.save(`Voucher-${voucher.voucher_number}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// CustomTip moved to ./fees/FeeCharts.tsx (lazy chunk).

// ═══════════════════════════════════════════════════════════════
// Status Badge Component
// ═══════════════════════════════════════════════════════════════

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  unpaid: { label: "Unpaid", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: <XCircle className="w-3 h-3" /> },
  partial: { label: "Partial", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: <Clock className="w-3 h-3" /> },
  paid: { label: "Paid", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: <CheckCircle className="w-3 h-3" /> },
  overdue: { label: "Overdue", color: "bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300", icon: <AlertTriangle className="w-3 h-3" /> },
  waived: { label: "Waived", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: <CheckCheck className="w-3 h-3" /> },
};

const StatusBadge = ({ status }: { status: string }) => {
  const cfg = statusConfig[status] || statusConfig.unpaid;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════════
// Main AdminFees Component
// ═══════════════════════════════════════════════════════════════

const AdminFees = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"structures" | "vouchers" | "payments" | "dashboard" | "reports">("dashboard");

  const tabItems = [
    { v: "dashboard", label: "Dashboard", icon: BarChart3 },
    { v: "structures", label: "Structures", icon: Receipt },
    { v: "vouchers", label: "Vouchers", icon: FileText },
    { v: "payments", label: "Payments", icon: Wallet },
    { v: "reports", label: "Reports", icon: TrendingUp },
  ] as const;

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* Premium page header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <CircleDollarSign className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Fee Management</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">structures · vouchers · payments · reports</p>
          </div>
        </div>
      </div>

      {/* Tab Switcher — pill tabs */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
          {tabItems.map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => setActiveTab(v)}
              className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "structures" && <StructuresTab />}
      {activeTab === "vouchers" && <VouchersTab />}
      {activeTab === "payments" && <PaymentsTab />}
      {activeTab === "reports" && <ReportsTab />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Dashboard Tab
// ═══════════════════════════════════════════════════════════════

function DashboardTab() {
  const { data: dash, isLoading } = useFeeDashboard();
  const { data: defaulters = [] } = useFeeDefaulters();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  if (!dash) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
        <CircleDollarSign className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-semibold text-foreground">No fee data yet</p>
        <p className="text-xs text-muted-foreground mt-1">Set up fee structures and generate vouchers to see the dashboard.</p>
      </div>
    );
  }

  const statCards = [
    { icon: <CircleDollarSign className="w-4 h-4" />, label: "Total Billed", value: `Rs. ${dash.totalBilled.toLocaleString()}`, color: "#6366f1", bg: "bg-indigo-50 dark:bg-indigo-900/20" },
    { icon: <CheckCircle className="w-4 h-4" />, label: "Collected", value: `Rs. ${dash.totalCollected.toLocaleString()}`, color: "#10b981", bg: "bg-green-50 dark:bg-green-900/20" },
    { icon: <AlertTriangle className="w-4 h-4" />, label: "Outstanding", value: `Rs. ${dash.totalOutstanding.toLocaleString()}`, color: "#ef4444", bg: "bg-red-50 dark:bg-red-900/20" },
    { icon: <TrendingUp className="w-4 h-4" />, label: "Collection Rate", value: `${dash.collectionRate}%`, color: dash.collectionRate >= 80 ? "#10b981" : dash.collectionRate >= 50 ? "#f59e0b" : "#ef4444", bg: "bg-blue-50 dark:bg-blue-900/20" },
    { icon: <FileText className="w-4 h-4" />, label: "Total Vouchers", value: dash.totalVouchers, color: "#6366f1", bg: "bg-violet-50 dark:bg-violet-900/20" },
    { icon: <CheckCircle className="w-4 h-4" />, label: "Paid", value: dash.paidVouchers, color: "#10b981", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { icon: <Clock className="w-4 h-4" />, label: "Unpaid", value: dash.unpaidVouchers, color: "#f59e0b", bg: "bg-yellow-50 dark:bg-yellow-900/20" },
    { icon: <AlertTriangle className="w-4 h-4" />, label: "Overdue", value: dash.overdueVouchers, color: "#ef4444", bg: "bg-red-50 dark:bg-red-900/20" },
  ];

  // Aging chart data
  const agingData = [
    { name: "Current", value: dash.aging.current, fill: "#10b981" },
    { name: "1-30 Days", value: dash.aging.days30, fill: "#f59e0b" },
    { name: "31-60 Days", value: dash.aging.days60, fill: "#f97316" },
    { name: "61-90 Days", value: dash.aging.days90, fill: "#ef4444" },
    { name: "90+ Days", value: dash.aging.over90, fill: "#991b1b" },
  ].filter((d) => d.value > 0);

  // Class breakdown chart
  const classChartData = Object.entries(dash.classBreakdown).map(([cls, d]) => ({
    class: `Class ${cls}`,
    collected: d.collected,
    outstanding: d.outstanding,
  }));

  return (
    <div className="space-y-5">
      {/* Collection hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(152_48%_14%)] via-[hsl(152_42%_19%)] to-[hsl(152_36%_26%)] p-4 sm:p-5 text-white shadow-md ring-1 ring-black/5">
        <div className="absolute -top-12 -right-8 w-40 h-40 rounded-full bg-[hsl(43_80%_55%)]/15" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(43_80%_60%)]/70 to-transparent" />
        <div className="relative">
          <p className="text-[11px] uppercase tracking-wider text-white/70">Total Collected</p>
          <div className="flex items-end justify-between gap-3 mt-1">
            <p className="text-2xl sm:text-3xl font-heading font-bold leading-none">Rs. {dash.totalCollected.toLocaleString()}</p>
            <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm">{dash.collectionRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/15 overflow-hidden mt-3.5">
            <div className="h-full rounded-full bg-gradient-to-r from-[hsl(43_85%_62%)] to-[hsl(38_85%_52%)]" style={{ width: `${Math.min(100, Math.max(0, dash.collectionRate))}%` }} />
          </div>
          <div className="flex justify-between mt-2 text-[11px] text-white/70">
            <span>of Rs. {dash.totalBilled.toLocaleString()} billed</span>
            <span>Rs. {dash.totalOutstanding.toLocaleString()} outstanding</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {statCards.map((s) => (
          <div key={s.label} className="min-w-0 rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate text-xl font-bold leading-none tabular-nums text-foreground sm:text-2xl">{s.value}</p>
              <span className="ml-auto shrink-0 text-muted-foreground/50">{s.icon}</span>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aging Analysis */}
        {agingData.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" /> Aging Analysis
            </h3>
            <Suspense fallback={<div className="h-[220px] animate-pulse rounded-xl bg-muted/40" />}>
              <AgingPie data={agingData} />
            </Suspense>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5 mt-2">
              {agingData.map((entry, i) => (
                <div key={i} className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="text-[10px] text-muted-foreground truncate">
                    {entry.name}: <span className="font-medium text-foreground">Rs.{entry.value.toLocaleString()}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Class-wise Breakdown */}
        {classChartData.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Class-wise Collection
            </h3>
            <Suspense fallback={<div className="h-[200px] animate-pulse rounded-xl bg-muted/40" />}>
              <ClassCollectionBar data={classChartData} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Top Defaulters */}
      {defaulters.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">
          <div className="bg-destructive/10 text-destructive px-4 py-3 flex items-center gap-2">
            <UserX className="w-4 h-4" />
            <span className="font-bold text-sm">Top Defaulters — {defaulters.length} student(s) with outstanding fees</span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/50">
                  <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Student</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Outstanding</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center hidden sm:table-cell">Overdue</TableHead>
                  <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center hidden md:table-cell">Last Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defaulters.slice(0, 10).map((d) => (
                  <TableRow key={d.student_id} className="border-border/50 hover:bg-primary/5">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {d.photo_url ? (
                          <img src={d.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{d.full_name?.charAt(0) || "?"}</div>
                        )}
                        <div>
                          <p className="text-sm font-medium">{d.full_name}</p>
                          <p className="text-[10px] text-muted-foreground">Class {d.class} | #{d.roll_number}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-bold text-destructive">Rs. {d.outstanding.toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="text-center hidden sm:table-cell">
                      {d.overdue_count > 0 && <Badge variant="destructive" className="text-[10px]">{d.overdue_count} voucher(s)</Badge>}
                    </TableCell>
                    <TableCell className="text-center hidden md:table-cell text-xs text-muted-foreground">
                      {d.last_payment_date ? format(new Date(d.last_payment_date), "dd MMM yyyy") : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Fee Structures Tab
// ═══════════════════════════════════════════════════════════════

function StructuresTab() {
  const [cls, setCls] = useState("6");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FeeStructure | null>(null);
  const [form, setForm] = useState({
    class: "6", fee_type: "tuition", label: "Tuition Fee", amount: 0,
    is_optional: false, is_recurring: true, frequency: "monthly" as string,
    payment_methods: [] as PaymentMethod[],
  });
  const [saving, setSaving] = useState(false);

  const { data: structures = [], isLoading } = useFeeStructures(cls);
  const { upsert, remove } = useMutateFeeStructure();

  // Payment method type options
  const PAYMENT_METHOD_TYPES = [
    { value: "bank", label: "Bank Transfer", icon: Building2 },
    { value: "easypaisa", label: "EasyPaisa", icon: Smartphone },
    { value: "jazzcash", label: "JazzCash", icon: Smartphone },
    { value: "cash", label: "Cash (Office)", icon: Banknote },
    { value: "other", label: "Other", icon: CreditCard },
  ];

  const openAdd = () => {
    setEditing(null);
    setForm({ 
      class: cls, fee_type: "tuition", label: "Tuition Fee", amount: 0, 
      is_optional: false, is_recurring: true, frequency: "monthly",
      payment_methods: [],
    });
    setModalOpen(true);
  };

  const openEdit = (s: FeeStructure) => {
    setEditing(s);
    // Defensive: ensure payment_methods is always an array even if DB returns null/undefined
    let paymentMethods: PaymentMethod[] = [];
    try {
      // Handle case where payment_methods might be null, undefined, or not an array
      if (Array.isArray(s.payment_methods)) {
        paymentMethods = s.payment_methods;
      } else if (s.payment_methods && typeof s.payment_methods === 'object') {
        // Sometimes JSONB comes as object instead of array
        paymentMethods = [s.payment_methods as any];
      }
    } catch (e) {
      console.warn('Failed to parse payment_methods:', e);
      paymentMethods = [];
    }
    
    setForm({
      class: s.class, fee_type: s.fee_type, label: s.label, amount: Number(s.amount),
      is_optional: s.is_optional, is_recurring: s.is_recurring, frequency: s.frequency,
      payment_methods: paymentMethods,
    });
    setModalOpen(true);
  };

  // Add a new empty payment method
  const addPaymentMethod = () => {
    setForm(p => ({
      ...p,
      payment_methods: [...p.payment_methods, { type: "bank" as const }],
    }));
  };

  // Remove a payment method by index
  const removePaymentMethod = (index: number) => {
    setForm(p => ({
      ...p,
      payment_methods: p.payment_methods.filter((_, i) => i !== index),
    }));
  };

  // Update a specific payment method field
  const updatePaymentMethod = (index: number, field: string, value: any) => {
    setForm(p => ({
      ...p,
      payment_methods: p.payment_methods.map((pm, i) =>
        i === index ? { ...pm, [field]: value } : pm
      ),
    }));
  };

  const handleSave = async () => {
    if (!form.label || !form.fee_type) { toast.error("Label and fee type required"); return; }
    setSaving(true);
    try {
      // Build the payload - only include payment_methods if it has items
      // This prevents errors if the DB column doesn't exist yet
      const payload: any = {
        ...(editing ? { id: editing.id } : {}),
        class: form.class,
        fee_type: form.fee_type,
        label: form.label,
        amount: form.amount,
        is_optional: form.is_optional,
        is_recurring: form.is_recurring,
        frequency: form.frequency,
        is_active: true,
      };
      
      // Only include payment_methods if we have some and they're valid
      if (form.payment_methods && form.payment_methods.length > 0) {
        payload.payment_methods = form.payment_methods;
      }
      
      await upsert.mutateAsync(payload);
      toast.success(editing ? "Updated" : "Added");
      setModalOpen(false);
    } catch (err) {
      console.error('Fee structure save error:', err);
      // Provide more specific error message for common issues
      if (err?.message?.includes('payment_methods')) {
        toast.error("Payment methods feature requires database migration. Please run migration 014 first, or save without payment methods.");
      } else {
        toast.error(err?.message || "Save failed");
      }
    }
    setSaving(false);
  };

  const handleDelete = async (s: FeeStructure) => {
    try {
      await remove.mutateAsync(s.id);
      toast.success("Deactivated");
    } catch (err) {
      toast.error(err?.message || "Delete failed");
    }
  };

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  // Auto-fill label from fee type
  const handleFeeTypeChange = (ft: string) => {
    const found = FEE_TYPES.find((t) => t.value === ft);
    setForm((p) => ({ ...p, fee_type: ft, label: found?.label || ft }));
  };

  return (
    <div className="space-y-4">
      {/* Class selector + add button */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CLASSES.map((c) => (
            <button key={c} onClick={() => setCls(c)}
              className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${cls === c ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-muted-foreground border-border/70 hover:bg-secondary hover:text-foreground"}`}>
              Class {c}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90" onClick={openAdd}><Plus className="w-3.5 h-3.5" /> Add Fee</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : structures.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <Receipt className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">No fee structures for Class {cls}</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Add Fee" to create one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {structures.map((s) => (
            <Card key={s.id} className="border-border/60 rounded-2xl shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {s.fee_type.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{s.label}</p>
                      <Badge variant="outline" className="text-[10px]">{s.frequency}</Badge>
                      {s.is_optional && <Badge className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Optional</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.fee_type} | {s.is_recurring ? "Recurring" : "One-time"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold text-foreground whitespace-nowrap">Rs. {Number(s.amount).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(s)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Fee Structure" : "Add Fee Structure"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Class</Label>
                <Select value={form.class} onValueChange={(v) => set("class", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CLASSES.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fee Type</Label>
                <Select value={form.fee_type} onValueChange={handleFeeTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FEE_TYPES.map((ft) => <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Display Label</Label>
              <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Tuition Fee" />
            </div>
            <div>
              <Label>Amount (Rs.)</Label>
              <Input type="number" value={form.amount} onChange={(e) => set("amount", Number(e.target.value))} min={0} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => { set("frequency", v); set("is_recurring", v !== "one_time"); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_optional} onCheckedChange={(v) => set("is_optional", v)} />
                  <Label className="text-xs">Optional</Label>
                </div>
              </div>
            </div>

            {/* Payment Methods Section (Optional) */}
            <div className="border border-border/60 rounded-xl p-3 space-y-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  <Label className="text-sm font-semibold">Payment Methods <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addPaymentMethod} className="gap-1 h-7 rounded-full px-3 text-xs font-semibold shadow-none border-border/60">
                  <Plus className="w-3 h-3" /> Add Method
                </Button>
              </div>
              
              {form.payment_methods.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No payment methods added. Students will be instructed to pay at the school office.
                </p>
              ) : (
                <div className="space-y-3">
                  {form.payment_methods.map((pm, idx) => (
                    <div key={idx} className="bg-card border border-border/60 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Select 
                          value={pm.type} 
                          onValueChange={(v) => updatePaymentMethod(idx, "type", v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHOD_TYPES.map(pt => (
                              <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button 
                          onClick={() => removePaymentMethod(idx)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Bank-specific fields */}
                      {pm.type === "bank" && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input 
                            placeholder="Bank Name (e.g. HBL)" 
                            value={pm.bank_name || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "bank_name", e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input 
                            placeholder="Account Title" 
                            value={pm.account_title || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "account_title", e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input 
                            placeholder="Account Number" 
                            value={pm.account_number || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "account_number", e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input 
                            placeholder="IBAN (optional)" 
                            value={pm.iban || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "iban", e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}

                      {/* EasyPaisa/JazzCash fields */}
                      {(pm.type === "easypaisa" || pm.type === "jazzcash") && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input 
                            placeholder="Account Name" 
                            value={pm.account_name || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "account_name", e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Input 
                            placeholder="Phone Number (e.g. 0300-1234567)" 
                            value={pm.phone || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "phone", e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}

                      {/* Other/Custom fields */}
                      {pm.type === "other" && (
                        <div className="space-y-2">
                          <Input 
                            placeholder="Payment method name (e.g. SadaPay)" 
                            value={pm.label || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "label", e.target.value)}
                            className="h-8 text-xs"
                          />
                          <Textarea 
                            placeholder="Instructions for student..." 
                            value={pm.instructions || ""} 
                            onChange={(e) => updatePaymentMethod(idx, "instructions", e.target.value)}
                            className="min-h-[50px] text-xs"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Vouchers Tab
// ═══════════════════════════════════════════════════════════════

function VouchersTab() {
  const [cls, setCls] = useState("6");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<FeeVoucher | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  // NEW: custom + bulk absence fee modals
  const [customFeeOpen, setCustomFeeOpen] = useState(false);

  // Generate form
  const [genForm, setGenForm] = useState({
    feePeriod: "monthly" as "monthly" | "quarterly",
    dueDate: "",
    lateFee: 0,
    bankName: "", accountTitle: "", accountNumber: "", iban: "",
    optionalFees: [] as string[],
  });

  // Payment form
  const [payForm, setPayForm] = useState({
    amount: 0,
    method: "cash" as "cash" | "bank" | "online" | "cheque",
    receiptNumber: "",
    paymentDate: format(new Date(), "yyyy-MM-dd"),
    notes: "",
  });
  const [paying, setPaying] = useState(false);

  const { data: vouchers = [], isLoading } = useFeeVouchers({
    classLevel: cls,
    month,
    year,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const { data: structures = [] } = useFeeStructures(cls);
  const { data: students = [] } = useStudentsByClass(cls);
  const generateMutation = useGenerateVouchers();
  const recordPayment = useRecordPayment();
  const deleteVoucher = useDeleteVoucher();

  const filteredVouchers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (q) {
        const name = v.students?.full_name?.toLowerCase() || "";
        const roll = v.students?.roll_number?.toLowerCase() || "";
        const vn = v.voucher_number.toLowerCase();
        if (!name.includes(q) && !roll.includes(q) && !vn.includes(q)) return false;
      }
      return true;
    });
  }, [vouchers, search]);

  // Summary
  const summary = useMemo(() => {
    const total = filteredVouchers.length;
    const totalAmount = filteredVouchers.reduce((s, v) => s + Number(v.total_amount) + Number(v.late_fee), 0);
    const paid = filteredVouchers.reduce((s, v) => s + Number(v.paid_amount), 0);
    const outstanding = totalAmount - paid;
    const overdue = filteredVouchers.filter((v) => v.status === "overdue").length;
    return { total, totalAmount, paid, outstanding, overdue };
  }, [filteredVouchers]);

  const openGenerate = () => {
    // Set default due date to end of selected month
    const due = new Date(year, month, 20);
    setGenForm((p) => ({ ...p, dueDate: format(due, "yyyy-MM-dd"), optionalFees: [] }));
    setGenDialogOpen(true);
  };

  const handleGenerate = async () => {
    if (!genForm.dueDate) { toast.error("Due date required"); return; }
    try {
      const result = await generateMutation.mutateAsync({
        classLevel: cls,
        month,
        year,
        feePeriod: genForm.feePeriod,
        dueDate: genForm.dueDate,
        lateFee: genForm.lateFee,
        bankDetails: {
          bank_name: genForm.bankName || undefined,
          account_title: genForm.accountTitle || undefined,
          account_number: genForm.accountNumber || undefined,
          iban: genForm.iban || undefined,
        },
        optionalFees: genForm.optionalFees,
      });
      toast.success(`Generated ${result?.length || 0} vouchers for Class ${cls}`);
      setGenDialogOpen(false);
    } catch (err) {
      toast.error(err?.message || "Generation failed");
    }
  };

  const openPayment = (v: FeeVoucher) => {
    setSelectedVoucher(v);
    const remaining = Number(v.total_amount) + Number(v.late_fee) - Number(v.paid_amount);
    setPayForm({
      amount: remaining,
      method: "cash",
      receiptNumber: "",
      paymentDate: format(new Date(), "yyyy-MM-dd"),
      notes: "",
    });
    setPayDialogOpen(true);
  };

  const handlePayment = async () => {
    if (!selectedVoucher || payForm.amount <= 0) { toast.error("Enter a valid amount"); return; }
    setPaying(true);
    try {
      await recordPayment.mutateAsync({
        voucherId: selectedVoucher.id,
        studentId: selectedVoucher.student_id,
        amount: payForm.amount,
        paymentMethod: payForm.method,
        receiptNumber: payForm.receiptNumber || undefined,
        paymentDate: payForm.paymentDate,
        notes: payForm.notes || undefined,
      });
      toast.success("Payment recorded");
      setPayDialogOpen(false);
    } catch (err) {
      toast.error(err?.message || "Payment failed");
    }
    setPaying(false);
  };

  const handleDownloadVoucher = (v: FeeVoucher) => {
    generateVoucherPDF(v, v.students?.full_name || "", v.students?.roll_number || "").catch(() => toast.error("Could not load the PDF library — check your connection"));
  };

  const handleDeleteVoucher = async (v: FeeVoucher) => {
    if (!confirm(`Delete voucher ${v.voucher_number} for ${v.students?.full_name || "this student"}? This cannot be undone.`)) return;
    try {
      await deleteVoucher.mutateAsync(v.id);
      toast.success("Voucher deleted");
    } catch (err) {
      toast.error(err?.message || "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CLASSES.map((c) => (
            <button key={c} onClick={() => setCls(c)}
              className={`h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${cls === c ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-card text-muted-foreground border-border/70 hover:bg-secondary hover:text-foreground"}`}>
              Class {c}
            </button>
          ))}
        </div>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-28 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m.slice(0, 3)}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-20 h-9 rounded-full border-border/60 bg-card text-sm shadow-none" min={2000} max={2099} />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-28 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="waived">Waived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Search + Generate */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, roll, voucher #…" className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" />
        </div>
        <Button className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90" onClick={openGenerate}>
          <Plus className="w-3.5 h-3.5" /> Generate Vouchers
        </Button>
        {/* Add custom fee to a single student (covers absence fees too) */}
        <Button variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60" onClick={() => setCustomFeeOpen(true)} title="Add a one-off fee to a single student (absence, fine, etc.)">
          <UserCircle className="w-3.5 h-3.5" /> Custom Fee
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <MiniStat label="Total Vouchers" value={summary.total} icon={<FileText className="w-3.5 h-3.5" />} tone="primary" />
        <MiniStat label="Total Amount" value={`Rs.${summary.totalAmount.toLocaleString()}`} icon={<CircleDollarSign className="w-3.5 h-3.5" />} tone="muted" />
        <MiniStat label="Collected" value={`Rs.${summary.paid.toLocaleString()}`} icon={<CheckCircle className="w-3.5 h-3.5" />} tone="success" />
        <MiniStat label="Outstanding" value={`Rs.${summary.outstanding.toLocaleString()}`} icon={<AlertTriangle className="w-3.5 h-3.5" />} tone="destructive" />
        <MiniStat label="Overdue" value={summary.overdue} icon={<Clock className="w-3.5 h-3.5" />} tone="destructive" />
      </div>

      {/* Voucher List */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filteredVouchers.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">No vouchers found</p>
          <p className="text-xs text-muted-foreground mt-1">Generate vouchers for this class and period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredVouchers.map((v) => {
            const remaining = Number(v.total_amount) + Number(v.late_fee) - Number(v.paid_amount);
            return (
              <Card key={v.id} className="border-border/60 rounded-2xl shadow-sm">
                <CardContent className="p-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Student avatar */}
                      {v.students?.photo_url ? (
                        <img src={v.students.photo_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold shrink-0">
                          {v.students?.full_name?.charAt(0) || "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm leading-snug break-words">{v.students?.full_name}</p>
                          <StatusBadge status={v.status} />
                          <span className="text-[10px] text-muted-foreground font-mono">{v.voucher_number}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          <span>#{v.students?.roll_number}</span>
                          <span>Class {v.class}</span>
                          <span>{MONTHS[v.month - 1]} {v.year}</span>
                          <span>Due: {format(new Date(v.due_date), "dd MMM")}</span>
                        </div>
                        {v.status !== "paid" && v.status !== "waived" && remaining > 0 && (
                          <div className="mt-1.5">
                            <Progress value={(Number(v.paid_amount) / (Number(v.total_amount) + Number(v.late_fee))) * 100} className="h-1.5" />
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Rs. {Number(v.paid_amount).toLocaleString()} / Rs. {(Number(v.total_amount) + Number(v.late_fee)).toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-right shrink-0">
                        <p className="text-lg font-black text-foreground">Rs. {Number(v.total_amount).toLocaleString()}</p>
                        {v.late_fee > 0 && <p className="text-[10px] text-destructive">+Rs.{Number(v.late_fee).toLocaleString()} late</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => { setSelectedVoucher(v); setViewDialogOpen(true); }} title="View Details">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteVoucher(v)} title="Delete Voucher">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Generate Vouchers Dialog */}
      <Dialog open={genDialogOpen} onOpenChange={setGenDialogOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-md w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Generate Vouchers — Class {cls}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              This will create fee vouchers for <strong>{students.length} active student(s)</strong> in Class {cls} for {MONTHS[month - 1]} {year}.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fee Period</Label>
                <Select value={genForm.feePeriod} onValueChange={(v) => setGenForm((p) => ({ ...p, feePeriod: v as "monthly" | "quarterly" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due Date *</Label>
                <Input type="date" value={genForm.dueDate} onChange={(e) => setGenForm((p) => ({ ...p, dueDate: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label>Late Fee (Rs.)</Label>
              <Input type="number" value={genForm.lateFee} onChange={(e) => setGenForm((p) => ({ ...p, lateFee: Number(e.target.value) }))} min={0} />
            </div>

            {/* Bank Details */}
            <div className="space-y-2 border border-border/60 rounded-xl p-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Bank Details (optional)</p>
              <Input placeholder="Bank Name" value={genForm.bankName} onChange={(e) => setGenForm((p) => ({ ...p, bankName: e.target.value }))} />
              <Input placeholder="Account Title" value={genForm.accountTitle} onChange={(e) => setGenForm((p) => ({ ...p, accountTitle: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Account Number" value={genForm.accountNumber} onChange={(e) => setGenForm((p) => ({ ...p, accountNumber: e.target.value }))} />
                <Input placeholder="IBAN" value={genForm.iban} onChange={(e) => setGenForm((p) => ({ ...p, iban: e.target.value }))} />
              </div>
            </div>

            {/* Fee items preview */}
            {structures.length > 0 && (
              <div className="border border-border/60 rounded-xl p-3">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">Fee Items</p>
                <div className="space-y-1.5">
                  {structures
                    .filter((s) => {
                      if (s.frequency === "one_time") return false;
                      if (genForm.feePeriod === "monthly" && s.frequency === "monthly") return true;
                      if (genForm.feePeriod === "quarterly") return true;
                      return false;
                    })
                    .map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {s.is_optional && (
                            <input
                              type="checkbox"
                              checked={genForm.optionalFees.includes(s.fee_type)}
                              onChange={(e) => {
                                setGenForm((p) => ({
                                  ...p,
                                  optionalFees: e.target.checked
                                    ? [...p.optionalFees, s.fee_type]
                                    : p.optionalFees.filter((f) => f !== s.fee_type),
                                }));
                              }}
                              className="rounded"
                            />
                          )}
                          <span className={s.is_optional ? "text-muted-foreground" : "text-foreground"}>
                            {s.label} {s.is_optional && "(optional)"}
                          </span>
                        </div>
                        <span className="font-semibold">Rs. {Number(s.amount).toLocaleString()}</span>
                      </div>
                    ))}
                  <div className="border-t border-border pt-1.5 flex items-center justify-between text-sm font-bold">
                    <span>Total per student</span>
                    <span>Rs. {structures
                      .filter((s) => {
                        if (s.frequency === "one_time") return false;
                        if (genForm.feePeriod === "monthly" && s.frequency === "monthly") return true;
                        if (genForm.feePeriod === "quarterly") return true;
                        return false;
                      })
                      .reduce((sum, s) => sum + (s.is_optional && !genForm.optionalFees.includes(s.fee_type) ? 0 : Number(s.amount)), 0)
                      .toLocaleString()
                    }</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setGenDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={generateMutation.isPending} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none">
              {generateMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Generate for {students.length} Student(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-md w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-600" /> Record Payment
            </DialogTitle>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-xl p-3">
                <p className="font-semibold text-sm">{selectedVoucher.students?.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  #{selectedVoucher.students?.roll_number} | {selectedVoucher.voucher_number} | Rs. {Number(selectedVoucher.total_amount).toLocaleString()}
                </p>
                {selectedVoucher.paid_amount > 0 && (
                  <p className="text-xs text-green-600 mt-1">
                    Already paid: Rs. {Number(selectedVoucher.paid_amount).toLocaleString()}
                  </p>
                )}
                {selectedVoucher.late_fee > 0 && (
                  <p className="text-xs text-destructive mt-0.5">
                    Late fee: Rs. {Number(selectedVoucher.late_fee).toLocaleString()}
                  </p>
                )}
              </div>

              <div>
                <Label>Amount (Rs.) *</Label>
                <Input type="number" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: Number(e.target.value) }))} min={0} />
              </div>

              <div>
                <Label>Payment Method</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {PAYMENT_METHODS.map((pm) => (
                    <button
                      key={pm.value}
                      onClick={() => setPayForm((p) => ({ ...p, method: pm.value as any }))}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                        payForm.method === pm.value ? "border-primary bg-primary/10 text-primary ring-1 ring-primary" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <pm.icon className={`w-4 h-4 ${pm.color}`} />
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Receipt Number</Label>
                  <Input value={payForm.receiptNumber} onChange={(e) => setPayForm((p) => ({ ...p, receiptNumber: e.target.value }))} placeholder="Auto-generated if empty" />
                </div>
                <div>
                  <Label>Payment Date</Label>
                  <Input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm((p) => ({ ...p, paymentDate: e.target.value }))} />
                </div>
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea value={payForm.notes} onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" rows={2} />
              </div>
            </div>
          )}
          <DialogFooter className="mt-2">
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setPayDialogOpen(false)}>Cancel</Button>
            <Button onClick={handlePayment} disabled={paying} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-green-600 hover:bg-green-700 text-white sm:flex-none">
              {paying && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Voucher Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-md w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-muted-foreground">{selectedVoucher.voucher_number}</span>
                <StatusBadge status={selectedVoucher.status} />
              </div>
              <div className="bg-muted/50 rounded-xl p-3">
                <p className="font-semibold">{selectedVoucher.students?.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  Roll #{selectedVoucher.students?.roll_number} | Class {selectedVoucher.class}
                </p>
                {selectedVoucher.students?.father_name && (
                  <p className="text-xs text-muted-foreground">Father: {selectedVoucher.students.father_name}</p>
                )}
                {selectedVoucher.students?.contact_number && (
                  <p className="text-xs text-muted-foreground">Contact: {selectedVoucher.students.contact_number}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Fee Breakdown</p>
                {(selectedVoucher.fee_items as FeeItem[]).map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="font-semibold">Rs. {Number(item.amount).toLocaleString()}</span>
                  </div>
                ))}
                {selectedVoucher.late_fee > 0 && (
                  <div className="flex justify-between text-sm text-destructive">
                    <span>Late Fee</span>
                    <span className="font-semibold">Rs. {Number(selectedVoucher.late_fee).toLocaleString()}</span>
                  </div>
                )}
                <div className="border-t border-border pt-1.5 flex justify-between font-bold">
                  <span>Total</span>
                  <span>Rs. {(Number(selectedVoucher.total_amount) + Number(selectedVoucher.late_fee)).toLocaleString()}</span>
                </div>
                {selectedVoucher.paid_amount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Paid</span>
                    <span className="font-semibold">Rs. {Number(selectedVoucher.paid_amount).toLocaleString()}</span>
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Period: {MONTHS[selectedVoucher.month - 1]} {selectedVoucher.year} ({selectedVoucher.fee_period})</p>
                <p>Due Date: {format(new Date(selectedVoucher.due_date), "dd MMMM yyyy")}</p>
                {selectedVoucher.notes && <p>Notes: {selectedVoucher.notes}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60" onClick={() => handleDownloadVoucher(selectedVoucher)}>
                  <Download className="w-3.5 h-3.5" /> Download PDF
                </Button>
                {selectedVoucher.status !== "paid" && selectedVoucher.status !== "waived" && (
                  <Button className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-green-600 hover:bg-green-700 text-white" onClick={() => { setViewDialogOpen(false); openPayment(selectedVoucher); }}>
                    <Wallet className="w-3.5 h-3.5" /> Record Payment
                  </Button>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => { setViewDialogOpen(false); handleDeleteVoucher(selectedVoucher); }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Voucher
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Custom Fee Modal — add one-off fee to a single student */}
      <CustomFeeModal
        open={customFeeOpen}
        onClose={() => setCustomFeeOpen(false)}
        defaultClass={cls}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Payments Tab
// ═══════════════════════════════════════════════════════════════

function PaymentsTab() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState("");

  const { data: payments = [], isLoading, error } = useFeePayments({ month, year });

  const filtered = useMemo(() => {
    if (!Array.isArray(payments)) return [];
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) => {
      const name = p.students?.full_name?.toLowerCase() || "";
      const roll = p.students?.roll_number?.toLowerCase() || "";
      const receipt = p.receipt_number?.toLowerCase() || "";
      return name.includes(q) || roll.includes(q) || receipt.includes(q);
    });
  }, [payments, search]);

  const totalCollected = filtered.reduce((s, p) => s + Number(p.amount) || 0, 0);

  // Safe date formatter — never throws, even on null/undefined/invalid dates
  const safeFormatDate = (dateStr: string | null | undefined): string => {
    try {
      if (!dateStr) return "—";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return "—";
      return format(d, "dd MMM yyyy");
    } catch {
      return "—";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-28 rounded-full border-border/60 bg-card text-sm shadow-none"><SelectValue /></SelectTrigger>
          <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-20 h-9 rounded-full border-border/60 bg-card text-sm shadow-none" min={2000} max={2099} />
        <div className="relative flex-1 min-w-[10rem]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search payments…" className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" />
        </div>
        <Badge variant="secondary" className="gap-1 text-xs">
          <CircleDollarSign className="w-3 h-3" /> Total: Rs. {totalCollected.toLocaleString()}
        </Badge>
      </div>

      {/* Error state — show clear error message instead of crashing */}
      {error ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Couldn't load payments</p>
          <p className="text-xs text-muted-foreground mt-1">
            {error?.message || "There was a problem fetching payment records. Try refreshing."}
          </p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <Wallet className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm font-semibold">No payments recorded for this period</p>
          <p className="text-xs text-muted-foreground mt-1">
            Payments you record from the Vouchers tab will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className="border-border/60 rounded-2xl shadow-sm">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                    {(() => {
                      const Icon = PAYMENT_METHODS.find((m) => m.value === p.payment_method)?.icon || Wallet;
                      return <Icon className="w-5 h-5 text-green-600" />;
                    })()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{p.students?.full_name || "Unknown student"}</p>
                      <Badge variant="outline" className="text-[10px]">{p.payment_method || "—"}</Badge>
                      {p.receipt_number && <span className="text-[10px] text-muted-foreground font-mono">{p.receipt_number}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      #{p.students?.roll_number || "—"} | Class {p.students?.class || "—"} | {safeFormatDate(p.payment_date)}
                    </p>
                    {p.notes && <p className="text-[10px] text-muted-foreground italic mt-0.5">{p.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-green-600">Rs. {Number(p.amount || 0).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{p.fee_vouchers?.voucher_number || "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Reports Tab
// ═══════════════════════════════════════════════════════════════

function ReportsTab() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [reportType, setReportType] = useState<"collection" | "class" | "defaulters">("collection");

  // PERF: each report query runs ONLY when its sub-report is selected.
  // Previously all three (two of them whole-year full-table aggregations)
  // fired on mount even for an admin who only ever looked at one report.
  const { data: collectionReport = [], isLoading: loadingCollection } = useFeeCollectionReport(year, { enabled: reportType === "collection" });
  const { data: classSummary = [], isLoading: loadingClass } = useClassCollectionSummary(year, { enabled: reportType === "class" });
  const { data: defaulters = [], isLoading: loadingDefaulters } = useFeeDefaulters(undefined, { enabled: reportType === "defaulters" });

  // PERF: the defaulters table rendered EVERY defaulter at once; large
  // lists now render in pages of 25 with a "Show more" button.
  const [defaulterLimit, setDefaulterLimit] = useState(25);
  const visibleDefaulters = defaulters.slice(0, defaulterLimit);

  const handleExportDefaulterList = async () => {
    let jsPDF: typeof import("jspdf")["default"], autoTable: typeof import("jspdf-autotable")["default"];
    try {
      ([{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]));
    } catch { toast.error("Could not load the PDF library — check your connection"); return; }
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.text("Fee Defaulters List", 14, 16);
    doc.setFontSize(9);
    doc.text(`Generated: ${format(new Date(), "dd MMMM yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 28,
      head: [["#", "Student Name", "Roll No", "Class", "Outstanding (Rs.)", "Overdue Vouchers", "Last Payment"]],
      body: defaulters.map((d, i) => [
        i + 1, d.full_name, d.roll_number, `Class ${d.class}`,
        d.outstanding.toLocaleString(), d.overdue_count,
        d.last_payment_date ? format(new Date(d.last_payment_date), "dd MMM yyyy") : "Never",
      ]),
      headStyles: { fillColor: [220, 38, 38] },
      styles: { fontSize: 8 },
    });
    doc.save(`Defaulters-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast.success("PDF downloaded");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 min-w-0 max-w-full overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Tabs value={reportType} onValueChange={(v) => setReportType(v as any)} className="max-w-full">
            <TabsList className="h-10 rounded-full border border-border/60 bg-muted/50 p-1">
              <TabsTrigger value="collection" className="h-8 gap-1.5 rounded-full px-4 text-xs font-semibold whitespace-nowrap shrink-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><BarChart3 className="w-3.5 h-3.5" /> Monthly Collection</TabsTrigger>
              <TabsTrigger value="class" className="h-8 gap-1.5 rounded-full px-4 text-xs font-semibold whitespace-nowrap shrink-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><Users className="w-3.5 h-3.5" /> Class-wise</TabsTrigger>
              <TabsTrigger value="defaulters" className="h-8 gap-1.5 rounded-full px-4 text-xs font-semibold whitespace-nowrap shrink-0 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"><UserX className="w-3.5 h-3.5" /> Defaulters</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Year:</Label>
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-20 h-9 rounded-full border-border/60 bg-card text-sm shadow-none" min={2000} max={2099} />
        </div>
      </div>

      {/* Collection Report */}
      {reportType === "collection" && (
        <>
          {loadingCollection ? <Skeleton className="h-64 rounded-xl" /> : collectionReport.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-semibold">No collection data for {year}</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" /> Monthly Collection — {year}
                </h3>
                <Suspense fallback={<div className="h-[280px] animate-pulse rounded-xl bg-muted/40" />}>
                  <MonthlyCollectionBar
                    data={collectionReport.filter((r) => r.total_vouchers > 0)}
                    monthLabel={(v: number) => MONTHS[v - 1]?.slice(0, 3) || String(v)}
                  />
                </Suspense>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">
                <div className="bg-primary text-white px-4 py-3 font-bold text-sm">
                  Collection Summary — {year}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-border/50">
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Month</TableHead>
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Vouchers</TableHead>
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Billed</TableHead>
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Collected</TableHead>
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right">Outstanding</TableHead>
                        <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {collectionReport.filter((r) => r.total_vouchers > 0).map((r) => (
                        <TableRow key={r.month} className="border-border/50 hover:bg-primary/5">
                          <TableCell className="font-medium text-sm">{MONTHS[r.month - 1]}</TableCell>
                          <TableCell className="text-center text-sm">{r.total_vouchers}</TableCell>
                          <TableCell className="text-right text-sm">Rs. {r.total_amount.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm text-green-600 font-semibold">Rs. {r.collected.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm text-destructive font-semibold">Rs. {r.outstanding.toLocaleString()}</TableCell>
                          <TableCell className="text-center">
                            <Badge className={
                              r.collection_rate >= 80 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : r.collection_rate >= 50 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }>
                              {r.collection_rate}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Class-wise Summary */}
      {reportType === "class" && (
        <>
          {loadingClass ? <Skeleton className="h-64 rounded-xl" /> : classSummary.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-semibold">No class-wise data for {year}</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                <h3 className="font-bold text-sm text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Class-wise Collection — {year}
                </h3>
                <Suspense fallback={<div className="h-[240px] animate-pulse rounded-xl bg-muted/40" />}>
                  <ClassSummaryBar data={classSummary} classColors={CLASS_COLORS} />
                </Suspense>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {classSummary.map((c) => (
                  <Card key={c.class} className="border-border/60 rounded-2xl shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-sm">Class {c.class}</p>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CLASS_COLORS[c.class] }} />
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">Students</span><span className="font-semibold">{c.total_students}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Billed</span><span className="font-semibold">Rs. {c.total_billed.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Collected</span><span className="font-semibold text-green-600">Rs. {c.total_collected.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-semibold text-destructive">Rs. {c.total_outstanding.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Defaulters</span><span className="font-semibold">{c.defaulters_count}</span></div>
                      </div>
                      <div className="mt-2">
                        <Progress value={c.collection_rate} className="h-2" />
                        <p className="text-[10px] text-muted-foreground mt-0.5">{c.collection_rate}% collected</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Defaulters List */}
      {reportType === "defaulters" && (
        <>
          <div className="flex justify-end">
            <Button variant="outline" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60" onClick={handleExportDefaulterList}>
              <Download className="w-3.5 h-3.5" /> Export PDF
            </Button>
          </div>
          {loadingDefaulters ? <Skeleton className="h-64 rounded-xl" /> : defaulters.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-green-600">No defaulters!</p>
              <p className="text-xs text-muted-foreground mt-1">All fees are paid or no vouchers exist.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">
              <div className="bg-destructive/10 text-destructive px-4 py-3 font-bold text-sm">
                Defaulters List — {defaulters.length} student(s) with outstanding fees
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/50">
                      <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</TableHead>
                      <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Student</TableHead>
                      <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">Outstanding</TableHead>
                      <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center hidden sm:table-cell">Overdue</TableHead>
                      <TableHead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center hidden md:table-cell">Last Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleDefaulters.map((d, i) => (
                      <TableRow key={d.student_id} className="border-border/50 hover:bg-primary/5">
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {d.photo_url ? (
                              <img src={d.photo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{d.full_name?.charAt(0)}</div>
                            )}
                            <div>
                              <p className="text-sm font-medium">{d.full_name}</p>
                              <p className="text-[10px] text-muted-foreground">Class {d.class} | #{d.roll_number}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-sm font-bold text-destructive">Rs. {d.outstanding.toLocaleString()}</TableCell>
                        <TableCell className="text-center hidden sm:table-cell">
                          {d.overdue_count > 0 && <Badge variant="destructive" className="text-[10px]">{d.overdue_count}</Badge>}
                        </TableCell>
                        <TableCell className="text-center hidden md:table-cell text-xs text-muted-foreground">
                          {d.last_payment_date ? format(new Date(d.last_payment_date), "dd MMM yyyy") : "Never"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {defaulters.length > visibleDefaulters.length && (
                  <div className="border-t border-border/50 p-3 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDefaulterLimit((n) => n + 25)}
                      className="h-8 rounded-full px-4 text-xs font-semibold"
                    >
                      Show more ({defaulters.length - visibleDefaulters.length} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Tiny MiniStat Component
// ═══════════════════════════════════════════════════════════════

const toneStyles: Record<string, string> = {
  primary: "text-primary",
  success: "text-emerald-600 dark:text-emerald-400",
  destructive: "text-destructive",
  muted: "text-foreground",
};

const toneDots: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-emerald-500",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/40",
};

const MiniStat = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string }) => (
  <div className="min-w-0 rounded-2xl border border-border/60 bg-card px-3 py-2.5 shadow-sm">
    <div className="flex items-center gap-2">
      <p className={`min-w-0 truncate text-xl font-bold leading-none tabular-nums sm:text-2xl ${toneStyles[tone] || toneStyles.muted}`}>{value}</p>
      <span className="ml-auto shrink-0 text-muted-foreground/50">{icon}</span>
    </div>
    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDots[tone] || toneDots.muted}`} />
      {label}
    </p>
  </div>
);

export default AdminFees;
