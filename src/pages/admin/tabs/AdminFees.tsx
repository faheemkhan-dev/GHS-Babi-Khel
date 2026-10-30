import { useState, lazy, Suspense } from "react";
import { BarChart3, Receipt, FileText, Wallet, TrendingUp, CircleDollarSign, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import OverviewTab from "./fees/OverviewTab";

// Heavy tabs load on demand.
const VouchersTab = lazy(() => import("./fees/VouchersTab"));
const PaymentsTab = lazy(() => import("./fees/PaymentsTab"));
const SetupTab = lazy(() => import("./fees/SetupTab"));
const ReportsTab = lazy(() => import("./fees/ReportsTab"));
const StudentsTab = lazy(() => import("./fees/StudentsTab"));

const TABS = [
  { v: "overview", label: "Overview", icon: BarChart3 },
  { v: "students", label: "Students", icon: Users },
  { v: "vouchers", label: "Vouchers", icon: FileText },
  { v: "payments", label: "Payments", icon: Wallet },
  { v: "setup", label: "Fee Setup", icon: Receipt },
  { v: "reports", label: "Reports", icon: TrendingUp },
] as const;
type TabId = (typeof TABS)[number]["v"];

const AdminFees = () => {
  const [tab, setTab] = useState<TabId>("overview");
  return (
    <div className="min-w-0 space-y-4 pb-20 md:pb-0">
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
          <CircleDollarSign className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[15px] font-bold leading-tight tracking-tight text-foreground sm:text-xl">Fee Management</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Students, vouchers and payments</p>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
          {TABS.map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition-all ${
                tab === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        {tab === "overview" && <OverviewTab />}
        {tab === "students" && <StudentsTab />}
        {tab === "vouchers" && <VouchersTab />}
        {tab === "payments" && <PaymentsTab />}
        {tab === "setup" && <SetupTab />}
        {tab === "reports" && <ReportsTab />}
      </Suspense>
    </div>
  );
};

export default AdminFees;
