// src/components/admissions/TrackResult.tsx — the public Track Application
// result. Deliberately SHORT and clean (no long details, no timeline, no
// document / payment tables):
//
//   • header   — Reference No. · name · class + ONE status badge
//   • progress — the gold stepper (Applied → Fee Paid → Review → Merit →
//                Admitted); a red banner replaces it when the application is closed
//   • note     — one status sentence + the "Next:" line
//   • facts    — Class · Type · Applied · (Fee) in a slim hairline grid
//   • actions  — only when they apply: pay the pending fee (opens on tap),
//                interview booking, waitlist notice, admit card, fee voucher,
//                and a message from the office if one exists
// The full application (documents, payment history, timeline) stays in the
// applicant's own "My Application" dashboard.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useState, useEffect, useCallback } from "react";
import { XCircle, BadgeCheck, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabasePublic } from "@/lib/supabase";
import { useAdmissionSettings, type Admission } from "@/hooks/useAdmission";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  ensurePaymentReference,
  formatDeadline,
  formatFeeDate,
  PAYMENT_STATUS_LABELS,
  type AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import AdmissionStepper, { resolveAdmissionStage } from "@/components/admissions/AdmissionStepper";
import toast from "react-hot-toast";
const InterviewSlotBooking = lazy(() => import("@/components/admissions/InterviewSlotBooking"));
const AdmitCard = lazy(() => import("@/components/admissions/AdmitCard"));
const FeeChallan = lazy(() => import("@/components/admissions/FeeChallan"));
const OnlinePayPanel = lazy(() => import("@/components/admissions/OnlinePayPanel"));

function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function TrackResult({ result }: { result: any }) {
  const stage = resolveAdmissionStage(result.status, result.payment_status, result.processing_fee);
  const status = result.status;

  const [realBooking, setRealBooking] = useState<{ label: string } | null>(null);
  const [bookingChecked, setBookingChecked] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [liveRef, setLiveRef] = useState<string | null>(result.payment_reference ?? null);
  const [showPay, setShowPay] = useState(false);

  const { data: settings } = useAdmissionSettings();
  const { data: school } = useSchoolSettings();
  const accounts: AdmissionPaymentAccount[] = (settings?.payment_accounts ?? []) as AdmissionPaymentAccount[];
  const processingFee = result.processing_fee ?? settings?.processing_fee ?? 0;
  const hasProcessingFee = Number(processingFee) > 0;
  const feePaid = result.payment_status === "paid";

  const canBookInterview = ["documents_verified", "under_review", "interview_scheduled"].includes(status);
  const canDownloadAdmitCard = ["interview_scheduled", "admitted", "admit_card_issued"].includes(status);

  useEffect(() => { setLiveRef(result.payment_reference ?? null); }, [result.payment_reference]);

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

  // Only look up an interview booking when the status can actually book one.
  useEffect(() => { if (canBookInterview) loadBooking(); }, [canBookInterview, loadBooking]);

  // Fee challan PDF (used by the pay panel, which opens only on demand).
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
      await m.downloadFeeChallan({
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
        paymentReference: ref,
      });
    } catch (e: any) {
      toast.error(`Could not build the challan: ${e?.message || "try again"}`);
    } finally { setPdfBusy(null); }
  };

  // ── Slim facts grid ──
  const facts: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Class", value: `Class ${result.applying_class}` },
    { label: "Type", value: result.admission_type === "migration" ? "Migration" : "Fresh" },
    { label: "Applied", value: formatFeeDate(result.created_at) },
    ...(hasProcessingFee
      ? [{
          label: "Fee",
          value: feePaid ? "Paid" : (PAYMENT_STATUS_LABELS[result.payment_status] || "Pending"),
          tone: feePaid ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400",
        }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden rounded-2xl border-gold/30 shadow-card">
        <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
        <CardContent className="space-y-3.5 p-4">
          {/* header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Reference Number</p>
              <p className="mt-0.5 break-all font-mono text-lg font-bold leading-tight text-primary">{result.reference_no}</p>
              <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
                {result.full_name} <span className="font-normal text-muted-foreground">· Class {result.applying_class}</span>
              </p>
            </div>
            <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${stage.tone}`}>
              {stage.label}
            </span>
          </div>

          {/* progress: stepper, or the red closed banner */}
          {stage.closed ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/25">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <p className="text-[13px] font-bold text-red-700 dark:text-red-400">Application not accepted</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-red-700/80 dark:text-red-400/80">
                  {result.rejection_reason || stage.note}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border/60 bg-muted/20 px-2 py-3">
              <AdmissionStepper current={stage.step} complete={stage.complete} />
            </div>
          )}

          {/* note + next */}
          <div>
            <p className="text-[13px] font-semibold leading-relaxed text-foreground">{stage.note}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span><span className="font-bold text-primary">Next:</span> {stage.next}</span>
            </p>
          </div>

          {/* key facts — hairline grid */}
          <div className={`grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70 ${facts.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}>
            {facts.map((f) => (
              <div key={f.label} className="bg-card px-3 py-2 text-center">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{f.label}</p>
                <p className={`mt-0.5 text-[12.5px] font-semibold leading-tight ${f.tone ?? "text-foreground"}`}>{f.value}</p>
              </div>
            ))}
          </div>

          {/* pending fee — one slim row; the pay panel opens only on tap */}
          {hasProcessingFee && !feePaid && !stage.closed && (
            <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="min-w-0 flex-1 text-[11.5px] font-semibold leading-snug text-amber-800 dark:text-amber-300">
                Processing fee Rs {Number(processingFee).toLocaleString("en-PK")} pending
                {formatDeadline(result.fee_deadline) !== "—" ? ` · by ${formatDeadline(result.fee_deadline)}` : ""}
              </p>
              <button
                type="button"
                onClick={() => setShowPay((v) => !v)}
                aria-expanded={showPay}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-bold text-primary-foreground active:opacity-80"
              >
                Pay fee <ChevronDown className={`h-3 w-3 transition-transform ${showPay ? "rotate-180" : ""}`} />
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {hasProcessingFee && !feePaid && !stage.closed && showPay && (
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
      )}

      {hasProcessingFee && !feePaid && result.payment_status === "rejected" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/20">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Payment could not be verified.</span> Please contact the school office
            {formatDeadline(result.fee_deadline) !== "—" ? ` before ${formatDeadline(result.fee_deadline)}` : ""}.
          </p>
        </div>
      )}

      {/* message from the office, if there is one */}
      {result.admin_note && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[12px] leading-relaxed text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
          <span className="font-semibold">Message from the school office: </span>{result.admin_note}
        </div>
      )}

      {/* status-specific actions (only when they apply) */}
      {(status === "approved" || status === "admitted") && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading fee details" />}><FeeChallan
          admissionId={result.id}
          admissionType={result.admission_type || "fresh"}
          studentName={result.full_name}
          applyingClass={result.applying_class}
          referenceNo={result.reference_no}
        /></Suspense>
      )}

      {canBookInterview && bookingChecked && (
        <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading interview slots" />}><InterviewSlotBooking
          admissionId={result.id}
          currentBooking={realBooking?.label || null}
          onBooked={async () => { await loadBooking(); }}
        /></Suspense>
      )}

      {status === "waitlisted" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">You&rsquo;re on the waitlist.</span> We&rsquo;ll promote you automatically when a seat opens up.
          </p>
        </div>
      )}

      {canDownloadAdmitCard && <Suspense fallback={<div className="h-16 rounded-2xl bg-muted" aria-label="Loading admit card" />}><AdmitCard admission={result as Admission} /></Suspense>}
    </div>
  );
}
