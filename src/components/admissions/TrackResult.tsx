import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { AlertCircle, Download, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabasePublic } from "@/lib/supabase";
const ApplicationTracker = lazy(() => import("@/components/admissions/ApplicationTracker"));
const InterviewSlotBooking = lazy(() => import("@/components/admissions/InterviewSlotBooking"));
const AdmitCard = lazy(() => import("@/components/admissions/AdmitCard"));
const FeeChallan = lazy(() => import("@/components/admissions/FeeChallan"));

// Migration steps reflect the process described in BISE Peshawar's official
// enrollment notification for Class 9/10: migration is a school-to-school
// action on the BISEP portal (not something the student/parent submits
// directly to the board), it requires the School Leaving Certificate, and it
// runs only within a fixed window each year (from the SSC Annual-I result
// declaration through 31 December). We deliberately avoid inventing per-step
// day-counts, since BISEP does not publish those — only the overall window.
const MIGRATION_STEPS = [
  { label: "Student submits online eligibility application to our school", time: "Done instantly", action: null },
  { label: "School reviews eligibility & requests your documents (incl. School Leaving Certificate)", time: "Varies by school", action: null },
  { label: "Current school initiates migration on the BISEP portal (school-to-school)", time: "Within BISEP's annual migration window", action: null },
  { label: "Our school accepts the migration on the BISEP portal", time: "Within BISEP's annual migration window", action: null },
  { label: "Any BISEP fee/challan (if applicable) is paid", time: "As per BISEP schedule", action: null },
  { label: "School admission & enrollment confirmed", time: "Complete!", action: null },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  pending:           { label: "Pending",           color: "bg-blue-100 text-blue-800" },
  under_review:      { label: "Under Review",      color: "bg-purple-100 text-purple-800" },
  approved:          { label: "Approved ✅",        color: "bg-green-100 text-green-800" },
  rejected:          { label: "Rejected",           color: "bg-red-100 text-red-800" },
  documents_missing: { label: "Documents Missing", color: "bg-orange-100 text-orange-800" },
  documents_verified:{ label: "Documents Verified", color: "bg-emerald-100 text-emerald-800" },
  interview_scheduled:{ label: "Interview Scheduled", color: "bg-cyan-100 text-cyan-800" },
  interview_completed:{ label: "Interview Completed", color: "bg-teal-100 text-teal-800" },
  waitlisted:        { label: "Waitlisted",         color: "bg-amber-100 text-amber-800" },
  admitted:          { label: "Admitted ✅",        color: "bg-green-100 text-green-800" },
  admit_card_issued: { label: "Admit Card Issued",  color: "bg-green-100 text-green-800" },
};


function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function TrackResult({ result }: { result: any }) {
  const cfg = statusConfig[result.status] ?? { label: result.status, color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" };
  const isMigration = result.admission_type === "migration";
  const currentStep = result.migration_step ?? 0;
  const status = result.status;

  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [realBooking, setRealBooking] = useState<{ label: string } | null>(null);
  const [bookingChecked, setBookingChecked] = useState(false);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const { data, error } = await supabasePublic
        .from("admission_status_timeline")
        .select("id, from_status, to_status, note, actor, created_at")
        .eq("admission_id", result.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTimeline(data || []);
    } catch { setTimeline([]); }
    finally { setTimelineLoading(false); }
  }, [result.id]);

  const loadBooking = useCallback(async () => {
    setBookingChecked(false);
    try {
      const { data, error } = await supabasePublic
        .from("interview_bookings")
        .select("id, slot_id, cancelled_at, interview_slots(slot_date, start_time, location)")
        .eq("admission_id", result.id)
        .is("cancelled_at", null)
        .maybeSingle();
      if (error) throw error;
      if (data && (data as any).interview_slots) {
        const slot = (data as any).interview_slots;
        const dateLabel = new Date(slot.slot_date + "T00:00:00").toLocaleDateString("en-PK", {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
        });
        setRealBooking({ label: `${dateLabel} at ${formatSlotTime(slot.start_time)}${slot.location ? " — " + slot.location : ""}` });
      } else { setRealBooking(null); }
    } catch { setRealBooking(null); }
    finally { setBookingChecked(true); }
  }, [result.id]);

  useEffect(() => { loadTimeline(); loadBooking(); }, [loadTimeline, loadBooking]);

  const canBookInterview = ["documents_verified", "under_review", "interview_scheduled"].includes(status);
  const canDownloadAdmitCard = ["interview_scheduled", "admitted", "admit_card_issued"].includes(status);

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/20">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Reference Number</p>
              <p className="text-lg font-bold font-mono text-primary">{result.reference_no}</p>
            </div>
            <Badge className={`${cfg.color} text-xs font-bold px-3 py-1`}>{cfg.label}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Student Name</p><p className="font-semibold">{result.full_name}</p></div>
            <div><p className="text-xs text-muted-foreground">Class Applied</p><p className="font-semibold">Class {result.applying_class}</p></div>
            <div><p className="text-xs text-muted-foreground">Type</p><p className="font-semibold capitalize">{result.admission_type}</p></div>
            <div><p className="text-xs text-muted-foreground">Applied On</p><p className="font-semibold">{new Date(result.created_at).toLocaleDateString("en-PK")}</p></div>
          </div>
          {result.admin_note && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
              <p className="font-semibold mb-1">Message from Admin:</p>
              <p>{result.admin_note}</p>
            </div>
          )}
          {result.rejection_reason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
              <p className="font-semibold mb-1">Rejection Reason:</p>
              <p>{result.rejection_reason}</p>
            </div>
          )}
          {/* If approved, show next steps reminder */}
          {["approved", "admitted"].includes(status) && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
              <p className="font-semibold mb-1">🎉 Great news! You're approved!</p>
              <p>Download the admission forms, fill them, attach your documents, and submit at the school office to complete your enrollment.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fee Challan - Show when approved or admitted */}
      {(status === "approved" || status === "admitted") && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading fee details" />}><FeeChallan
          admissionId={result.id}
          admissionType={result.admission_type || "fresh"}
          studentName={result.full_name}
          applyingClass={result.applying_class}
          referenceNo={result.reference_no}
        /></Suspense>
      )}

      {isMigration && (
        <Card>
          <CardContent className="p-5">
            <p className="font-bold text-sm mb-4 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-primary" /> Migration Progress
            </p>
            {/* Horizontal stepper for migration */}
            <div className="overflow-x-auto pb-2">
              <div className="flex items-start gap-1 min-w-[600px]">
                {MIGRATION_STEPS.map((s, i) => {
                  const done = i + 1 < currentStep;
                  const current = i + 1 === currentStep;
                  return (
                    <div key={i} className="flex-1 text-center">
                      <div className={`w-7 h-7 rounded-full mx-auto flex items-center justify-center text-[10px] font-bold transition-all ${
                        done ? "bg-green-500 text-white" :
                        current ? "bg-primary text-white animate-pulse shadow-lg shadow-primary/30" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {done ? "✓" : i + 1}
                      </div>
                      <p className={`text-[10px] mt-1.5 leading-tight ${current ? "font-bold text-primary" : done ? "text-green-600" : "text-muted-foreground"}`}>
                        {s.label}
                      </p>
                      <p className="text-[9px] text-muted-foreground/70 mt-0.5">{s.time}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!timelineLoading && timeline.length > 0 && (
        <Suspense fallback={<div className="h-28 rounded-2xl bg-muted" aria-label="Loading application timeline" />}><ApplicationTracker timeline={timeline} currentStatus={status} /></Suspense>
      )}

      {canBookInterview && bookingChecked && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading interview slots" />}><InterviewSlotBooking
          admissionId={result.id}
          currentBooking={realBooking?.label || null}
          onBooked={async () => { await loadTimeline(); await loadBooking(); }}
        /></Suspense>
      )}

      {status === "waitlisted" && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-foreground text-sm">You're on the waitlist</p>
            <p className="text-xs text-muted-foreground mt-1">All interview slots are currently full. We'll promote you automatically when a seat opens up.</p>
          </div>
        </div>
      )}

      {canDownloadAdmitCard && <Suspense fallback={<div className="h-16 rounded-2xl bg-muted" aria-label="Loading admit card" />}><AdmitCard admission={result} /></Suspense>}
    </div>
  );
}

