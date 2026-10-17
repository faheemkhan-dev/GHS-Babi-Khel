import { Component, Suspense, useCallback, type ReactNode } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "@/components/layout/AdminLayout";
import { Skeleton } from "@/components/ui/skeleton";

const AdminOverview          = lazy(() => import("./tabs/AdminOverview"));
const AdminSchoolSettings    = lazy(() => import("./tabs/AdminSchoolSettings"));
const AdminTeachers          = lazy(() => import("./tabs/AdminTeachers"));
const AdminStudents          = lazy(() => import("./tabs/AdminStudents"));
const AdminResults           = lazy(() => import("./tabs/AdminResults"));
const AdminAttendance        = lazy(() => import("./tabs/AdminAttendance"));
const AdminTimetables        = lazy(() => import("./tabs/AdminTimetables"));
const AdminEvents            = lazy(() => import("./tabs/AdminEvents"));
const AdminAnnouncements     = lazy(() => import("./tabs/AdminAnnouncements"));
const AdminLibrary           = lazy(() => import("./tabs/AdminLibrary"));
// ── Exams section: three separate pages, no shared wrapper ──
const AdminExamDateSheet    = lazy(() => import("./tabs/AdminExamDateSheet"));
const AdminExamRollNumbers  = lazy(() => import("./tabs/AdminExamRollNumbers"));
const AdminExamSeating      = lazy(() => import("./tabs/AdminExamSeating"));
const AdminMeritList        = lazy(() => import("./tabs/AdminMeritList"));
const AdminVideos            = lazy(() => import("./tabs/AdminVideos"));
const AdminUsers             = lazy(() => import("./tabs/AdminUsers"));
const AdminNotes             = lazy(() => import("../notes/AdminNotes"));
// ── New feature admin tabs ──
const AdminAdmissions        = lazy(() => import("./tabs/AdminAdmissions"));
const AdminStudentRecords    = lazy(() => import("./tabs/AdminStudentRecords"));
// ── Fee Management ──
const AdminFees = lazy(() => import("./tabs/AdminFees"));
// ── Site Analytics (standalone tab) ──
const AdminSiteAnalytics = lazy(() => import("./tabs/AdminSiteAnalytics"));

const tabMap: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  overview:           AdminOverview,
  settings:           AdminSchoolSettings,
  teachers:           AdminTeachers,
  students:           AdminStudents,
  results:            AdminResults,
  attendance:         AdminAttendance,
  timetables:         AdminTimetables,
  events:             AdminEvents,
  announcements:      AdminAnnouncements,
  library:            AdminLibrary,
  // ── Exams section: each item is its own separate page ──
  "exam-date-sheet":  AdminExamDateSheet,
  "exam-rolls":       AdminExamRollNumbers,
  "exam-seating":     AdminExamSeating,
  "exam-console":     AdminExamSeating,
  "merit-list":       AdminMeritList,
  // Old combined-hub id — send to Date Sheet as a sane default if bookmarked
  "exams":            AdminExamDateSheet,
  notes:              AdminNotes,
  videos:             AdminVideos,
  users:              AdminUsers,
  admissions:         AdminAdmissions,
  "student-records":  AdminStudentRecords,
  "fees":             AdminFees,
  "site-analytics":   AdminSiteAnalytics,
};

// ── Per-tab error boundary ───────────────────────────────────────────────────
// A tab that fails to load (or throws while rendering) used to bubble all the
// way up to RouteErrorBoundary, which replaced the WHOLE admin page with
// "This page couldn't load". Now the failure stays inside the tab area: the
// sidebar/layout stay mounted and the person can switch tabs or retry.
class TabBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[AdminDashboard] Tab failed:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <p className="font-semibold text-foreground">This section couldn't load</p>
        <p className="text-sm text-muted-foreground">
          Most likely a slow or interrupted connection. The rest of the dashboard is untouched — you can switch tabs or try again.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg gradient-accent text-primary-foreground text-sm font-semibold"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

const Fallback = () => (
  <div className="space-y-4">
    <Skeleton className="h-8 w-48" />
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
    </div>
    <Skeleton className="h-64 rounded-xl" />
  </div>
);

const AdminDashboard = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive activeTab purely from URL — no local useState so back/forward
  // navigation and refresh always show the correct tab without desync.
  const urlTab = searchParams.get("tab");
  const activeTab = urlTab && tabMap[urlTab] ? urlTab : "overview";

  const setActiveTab = useCallback((tab: string) => {
    // replace: true keeps the browser history clean — back button goes to
    // wherever the user came from before the dashboard, not to a previous tab.
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

  const ActiveComponent = tabMap[activeTab] || AdminOverview;

  return (
    <AdminLayout activeTab={activeTab} onTabChange={setActiveTab}>
      <TabBoundary key={activeTab}>
        <Suspense fallback={<Fallback />}>
          <ActiveComponent />
        </Suspense>
      </TabBoundary>
    </AdminLayout>
  );
};

export default AdminDashboard;
