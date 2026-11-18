// src/components/admissions/TrackResult.tsx — the public Track Application
// result (GHSS Ghallanai §8 layout, ported to the GHS Babi Khel model):
//
//   • header block — "REFERENCE NUMBER" kicker + big mono id + ONE status
//     badge + note when closed
//   • progress — the gold stepper (Applied → Fee Paid → Review → Merit →
//     Admitted); a red banner replaces it when the application is closed
//   • amber warning strip when the workflow moved on but the fee is unpaid
//   • "Next:" line — what the applicant should do now
//   • Application summary review table + downloads (Application PDF / Fee
//     Challan) + payment (online Safepay + manual transfer) + timeline
//   • GHS-specific sections kept and restyled: migration progress stepper,
//     interview slot booking, admit card, admission-fee challan voucher.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { XCircle, FileDown, FileText, Loader2, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabasePublic } from "@/lib/supabase";
import { useAdmissionSettings, type Admission } from "@/hooks/useAdmission";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  ensurePaymentReference,
  formatDeadline,
  formatFeeDate,
  paymentMethodLabel,
  PAYMENT_STATUS_LABELS,
  type AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import AdmissionStepper, { resolveAdmissionStage } from "@/components/admissions/AdmissionStepper";
import AdmissionReviewTable from "@/components/admissions/AdmissionReviewTable";
import toast from "react-hot-toast";
const ApplicationTracker = lazy(() => import("@/components/admissions/ApplicationTracker"));
const InterviewSlotBooking = lazy(() => import("@/components/admissions/InterviewSlotBooking"));
const AdmitCard = lazy(() => import("@/components/admissions/AdmitCard"));
const FeeChallan = lazy(() => import("@/components/admissions/FeeChallan"));
const OnlinePayPanel = lazy(() => import("@/components/admissions/OnlinePayPanel"));

// Migration steps reflect the process described in BISE Peshawar's official
// enrollment notification for Class 9/10: migration is a school-to-school
// action on the BISEP portal (not something the student/parent submits
// directly to the board), it requires the School Leaving Certificate, and it
// runs only within a fixed window each year (from the SSC Annual-I result
// declaration through 31 December). We deliberately avoid inventing per-step
// day-counts, since BISEP does not publish those — only the overall window.
const MIGRATION_STEPS = [
  { label: "Student submits online eligibility application to our school", time: "Done instantly" },
  { label: "Merit list is published — merit-listed students submit documents (incl. School Leaving Certificate)", time: "Varies by school" },
  { label: "Current school initiates migration on the BISEP portal (school-to-school)", time: "Within BISEP's annual migration window" },
  { label: "Our school accepts the migration on the BISEP portal", time: "Within BISEP's annual migration window" },
  { label: "Any BISEP fee/challan (if applicable) is paid", time: "As per BISEP schedule" },
  { label: "School admission & enrollment confirmed", time: "Complete!" },
];

function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function TrackResult({ result }: { result: any }) {
  const stage = resolveAdmissionStage(result.status, result.payment_status, result.processing_fee);
  const isMigration = result.admission_type === "migration";
  const currentStep = result.migration_step ?? 0;
  const status = result.status;

  const [timeline, setTimeline] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [realBooking, setRealBooking] = useState<{ label: string } | null>(null);
  const [bookingChecked, setBookingChecked] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [liveRef, setLiveRef] = useState<string | null>(result.payment_reference ?? null);

  const { data: settings } = useAdmissionSettings();
  const { data: school } = useSchoolSettings();
  const accounts: AdmissionPaymentAccount[] = (settings?.payment_accounts ?? []) as AdmissionPaymentAccount[];
  const processingFee = result.processing_fee ?? settings?.processing_fee ?? 0;
  const hasProcessingFee = Number(processingFee) > 0;

  useEffect(() => { setLiveRef(result.payment_reference ?? null); }, [result.payment_reference]);

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

  // ── PDF downloads (GHSS-Ghallanai-style documents) ───────────────────────
  const pdfInputBase = () => ({
    referenceNo: result.reference_no,
    name: result.full_name,
    fatherName: result.father_name,
    bFormNo: result.b_form_no,
    applyingClass: result.applying_class,
    admissionType: result.admission_type || "fresh",
    processingFee: Number(processingFee),
    deadline: result.fee_deadline,
    paymentAccounts: accounts,
    sessionYear: settings?.session_year ?? null,
    appliedOn: result.created_at,
  });

  const downloadApplicationPdf = async () => {
    setPdfBusy("application");
    try {
      const m = await import("@/lib/admissionPdf");
      await m.downloadApplicationForm({
        ...pdfInputBase(),
        paymentStatus: result.payment_status || "pending",
        paymentReference: liveRef,
        gender: result.gender,
        dateOfBirth: result.date_of_birth,
        contactNumber: result.contact_number,
        whatsappNumber: result.whatsapp_number,
        homeAddress: result.home_address,
        fatherCnic: result.father_cnic,
        occupation: result.occupation,
        previousSchool: result.previous_school,
        previousClass: result.previous_class,
        previousMarks: result.previous_marks,
        yearOfPassing: result.year_of_passing,
      });
    } catch (e: any) {
      toast.error(`Could not build the PDF: ${e?.message || "try again"}`);
    } finally { setPdfBusy(null); }
  };

  const downloadChallanPdf = async (withReference: boolean) => {
    setPdfBusy("challan");
    try {
      let ref = liveRef;
      if (withReference && !ref) {
        const res = await ensurePaymentReference(result.reference_no, result.b_form_no);
        if (!res.ok) { toast.error(res.error || "Could not create the payment reference."); return; }
        ref = res.payment_reference ?? null;
        if (ref) setLiveRef(ref);
      }
      const m = await import("@/lib/admissionPdf");
      await m.downloadFeeChallan({ ...pdfInputBase(), paymentReference: ref });
    } catch (e: any) {
      toast.error(`Could not build the challan: ${e?.message || "try again"}`);
    } finally { setPdfBusy(null); }
  };

  const canBookInterview = ["documents_verified", "under_review", "interview_scheduled"].includes(status);
  const canDownloadAdmitCard = ["interview_scheduled", "admitted", "admit_card_issued"].includes(status);
  const feePaid = result.payment_status === "paid";

  return (
    <div className="space-y-4">
      {/* ══ 1 · Header block + progress (GHSS track result) ═══════════════ */}
      <Card className="overflow-hidden rounded-2xl border-gold/30 shadow-card">
        <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
        <CardContent className="p-5 space-y-4">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Reference Number
              </p>
              <p className="mt-1 break-all font-mono text-xl font-extrabold text-primary">{result.reference_no}</p>
              <p className="mt-1 text-sm font-semibold">{result.full_name} · Class {result.applying_class}</p>
            </div>
            <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold ${stage.tone}`}>
              {stage.label}
            </span>
          </div>

          {/* progress: stepper, or the red closed banner (GHSS) */}
          {stage.closed ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-900 dark:bg-red-950/25">
              <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <div>
                <p className="text-sm font-bold text-red-700 dark:text-red-400">Application not accepted</p>
                <p className="mt-0.5 text-xs leading-relaxed text-red-700/80 dark:text-red-400/80">
                  {result.rejection_reason || stage.note}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-4">
              <AdmissionStepper current={stage.step} complete={stage.complete} />
            </div>
          )}

          {/* warning strip (GHSS) */}
          {stage.warning && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {stage.warning}
            </p>
          )}

          {/* note + next (GHSS) */}
          <div>
            <p className="text-sm font-semibold leading-relaxed">{stage.note}</p>
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="font-bold text-primary">Next:</span> {stage.next}</span>
            </p>
          </div>

          {/* downloads (GHSS row) */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadApplicationPdf} disabled={!!pdfBusy}
              className="h-9 gap-1.5 rounded-full px-3.5 text-xs font-bold">
              {pdfBusy === "application" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Application PDF
            </Button>
            {hasProcessingFee && (
              <Button variant="outline" size="sm" onClick={() => downloadChallanPdf(true)} disabled={!!pdfBusy}
                className="h-9 gap-1.5 rounded-full px-3.5 text-xs font-bold">
                {pdfBusy === "challan" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                {liveRef ? "Fee Challan" : "Generate + Fee Challan"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ══ 2 · Processing Fee (GHSS payment card / paid state) ═══════════ */}
      {hasProcessingFee && (
        feePaid ? (
          <Card className="border-2 border-green-300/60 dark:border-green-900/60">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-foreground">Processing Fee — Rs {Number(processingFee).toLocaleString("en-PK")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {result.paid_at ? `Paid on ${formatFeeDate(result.paid_at)}` : "Fee received"}
                    {result.payment_method ? ` · via ${paymentMethodLabel(result.payment_method)}` : ""}
                    {result.payment_receipt ? ` · Ref ${result.payment_receipt}` : ""}
                  </p>
                </div>
                <Badge className="bg-green-500/15 text-green-700 text-xs font-bold px-3 py-1 dark:text-green-400">
                  <BadgeCheck className="mr-1 h-3.5 w-3.5" /> Paid
                </Badge>
              </div>
              {liveRef && (
                <p className="text-xs text-muted-foreground">
                  Payment Reference <span className="font-mono font-bold text-foreground">{liveRef}</span>
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading payment panel" />}>
            <OnlinePayPanel
              referenceNo={result.reference_no}
              bFormNo={result.b_form_no}
              processingFee={Number(processingFee)}
              paymentReference={liveRef}
              feeDeadline={result.fee_deadline}
              accounts={accounts}
              whatsappNumber={settings?.contact_whatsapp ?? null}
              schoolPhone={school?.phone ?? null}
              onReference={(ref) => setLiveRef(ref)}
              onDownloadChallan={() => downloadChallanPdf(false)}
              challanBusy={pdfBusy === "challan"}
            />
          </Suspense>
        )
      )}
      {hasProcessingFee && !feePaid && result.payment_status === "rejected" && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-foreground">Payment could not be verified</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The school office could not verify your processing fee payment. Please contact the office
              {formatDeadline(result.fee_deadline) !== "—" ? ` before ${formatDeadline(result.fee_deadline)}` : ""}.
            </p>
          </div>
        </div>
      )}

      {/* ══ 3 · Application summary table (GHSS) ═════════════════════════ */}
      <AdmissionReviewTable
        title="Application"
        rows={[
          { label: "Class", value: `Class ${result.applying_class}` },
          { label: "Admission Type", value: result.admission_type === "migration" ? "Migration / Transfer" : "Fresh Admission" },
          { label: "Previous School", value: result.previous_school },
          { label: "Previous Marks", value: result.previous_marks },
          ...(hasProcessingFee ? [{
            label: "Fee",
            value: `Rs ${Number(processingFee).toLocaleString("en-PK")} · ${PAYMENT_STATUS_LABELS[result.payment_status] || result.payment_status}`,
          }] : []),
          { label: "Applied On", value: formatFeeDate(result.created_at) },
          ...(result.payment_method && feePaid ? [{ label: "Paid Via", value: paymentMethodLabel(result.payment_method) }] : []),
          ...(result.payment_receipt && feePaid ? [{ label: "Receipt No.", value: result.payment_receipt }] : []),
          ...(feePaid && liveRef
            ? [{ label: "Payment Reference", value: <span className="font-mono">{liveRef}</span> }]
            : hasProcessingFee && result.fee_deadline
              ? [{ label: "Fee Deadline", value: formatDeadline(result.fee_deadline) }]
              : []),
          ...(result.admission_roll_no ? [{ label: "Admission No.", value: result.admission_roll_no }] : []),
        ]}
      />

      {/* ══ 4 · Office messages (GHS) ═══════════════════════════════════ */}
      {result.admin_note && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
          <p className="mb-1 font-semibold">Message from Admin:</p>
          <p className="leading-relaxed">{result.admin_note}</p>
        </div>
      )}
      {!stage.closed && result.rejection_reason && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <p className="mb-1 font-semibold">Rejection Reason:</p>
          <p className="leading-relaxed">{result.rejection_reason}</p>
        </div>
      )}
      {status === "merit_listed" && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300">
          <p className="mb-1 font-semibold">You are on the merit list!</p>
          <p className="leading-relaxed">
            Congratulations — you have been selected for a seat in Class {result.applying_class}. Bring your
            original documents to the school office by the last date shown on the merit list to confirm your
            admission.
          </p>
        </div>
      )}

      {/* ══ 5 · Admission-fee challan voucher (GHS — approved / admitted) ═ */}
      {(status === "approved" || status === "admitted") && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading fee details" />}><FeeChallan
          admissionId={result.id}
          admissionType={result.admission_type || "fresh"}
          studentName={result.full_name}
          applyingClass={result.applying_class}
          referenceNo={result.reference_no}
        /></Suspense>
      )}

      {/* ══ 6 · Migration progress (GHS) ═════════════════════════════════ */}
      {isMigration && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-4 flex items-center gap-2 text-sm font-bold">
              <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v9h-9"/></svg>
              Migration Progress
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

      {/* ══ 7 · Timeline (GHSS card) ════════════════════════════════════ */}
      {!timelineLoading && timeline.length > 0 && (
        <Suspense fallback={<div className="h-28 rounded-2xl bg-muted" aria-label="Loading application timeline" />}><ApplicationTracker timeline={timeline} currentStatus={status} /></Suspense>
      )}

      {/* ══ 8 · Interview booking + waitlist + admit card (GHS) ══════════ */}
      {canBookInterview && bookingChecked && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading interview slots" />}><InterviewSlotBooking
          admissionId={result.id}
          currentBooking={realBooking?.label || null}
          onBooked={async () => { await loadTimeline(); await loadBooking(); }}
        /></Suspense>
      )}

      {status === "waitlisted" && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-foreground">You&rsquo;re on the waitlist</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">All interview slots are currently full. We&rsquo;ll promote you automatically when a seat opens up.</p>
          </div>
        </div>
      )}

      {canDownloadAdmitCard && <Suspense fallback={<div className="h-16 rounded-2xl bg-muted" aria-label="Loading admit card" />}><AdmitCard admission={result as Admission} /></Suspense>}
    </div>
  );
}
