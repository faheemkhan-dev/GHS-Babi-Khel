// src/pages/admission/ApplicationView.tsx — the applicant's full application
// record (GHSS Ghallanai /admission/application/:id, ported to the GHS Babi
// Khel High School model). Reached from the Applicant Dashboard via
// "View & Pay Fee" / "View Application".
//
// GHSS layout, top to bottom:
//   • header + Fee Challan / Application PDF downloads
//   • Processing Fee card (amber when unpaid / green when paid): payment
//     reference block, notice, OnlinePayPanel (online + manual), submission
//     details — id="pay-fee" for the ?pay=1 auto-scroll
//   • Application / Personal Information / Academic Information review tables
//   • PII masking (B-Form + mobiles) with a Show / Hide toggle
//   • declaration bar + Application Timeline card
// GHS-specific sections (kept, restyled): migration progress, interview slot
// booking, admit card, admission-fee challan voucher, admin note / rejection.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Wallet, BadgeCheck, FileText, FileDown, Loader2, Eye, EyeOff,
  RefreshCw, AlertCircle, XCircle, Info, Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import toast from "react-hot-toast";
import PageLayout from "@/components/layout/PageLayout";
import AdmissionBackBar from "@/components/admissions/AdmissionBackBar";
import AdmissionReviewTable from "@/components/admissions/AdmissionReviewTable";
import { resolveAdmissionStage } from "@/components/admissions/AdmissionStepper";
import ApplicationTracker from "@/components/admissions/ApplicationTracker";
import {
  getAdmissionSession, clearAdmissionSession, maskBForm, maskMobile,
} from "@/lib/admissionSession";
import { useAdmissionPortalState, useAdmissionSettings, type Admission } from "@/hooks/useAdmission";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  ensurePaymentReference, formatDeadline, formatFeeDate, paymentMethodLabel,
  type AdmissionPaymentAccount,
} from "@/lib/admissionPayment";
import { supabasePublic } from "@/lib/supabase";

const OnlinePayPanel = lazy(() => import("@/components/admissions/OnlinePayPanel"));
const FeeChallan = lazy(() => import("@/components/admissions/FeeChallan"));
const InterviewSlotBooking = lazy(() => import("@/components/admissions/InterviewSlotBooking"));
const AdmitCard = lazy(() => import("@/components/admissions/AdmitCard"));

const MIGRATION_STEPS = [
  "Student submits online eligibility application to our school",
  "Merit list is published — merit-listed students submit documents (incl. School Leaving Certificate)",
  "Current school initiates migration on the BISEP portal (school-to-school)",
  "Our school accepts the migration on the BISEP portal",
  "Any BISEP fee/challan (if applicable) is paid",
  "School admission & enrollment confirmed",
];

function fmtSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function ApplicationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = getAdmissionSession();

  const { data: settings } = useAdmissionSettings();
  const { data: school } = useSchoolSettings();

  const query = useAdmissionPortalState(session?.reference_no ?? null, session?.b_form_no ?? null);
  const app = query.data?.ok ? query.data.application : null;

  const [showPii, setShowPii] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [liveRef, setLiveRef] = useState<string | null>(null);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (app) setLiveRef(app.payment_reference ?? null); }, [app?.payment_reference]);

  /* ── ?pay=1 — ensure the reference, then scroll to the payment panel ──── */
  useEffect(() => {
    if (!app || searchParams.get("pay") !== "1") return;
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("pay");
      return p;
    }, { replace: true });
    const run = async () => {
      if (!app.payment_reference && Number(app.processing_fee ?? 0) > 0) {
        const res = await ensurePaymentReference(app.reference_no, (app.b_form_no || "").replace(/[^0-9]/g, ""));
        if (res.ok && res.payment_reference) setLiveRef(res.payment_reference);
        await qc.invalidateQueries({ queryKey: ["admission-portal-state"] });
      }
      window.setTimeout(() => {
        document.getElementById("pay-fee")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.id, searchParams]);

  /* ── Interview booking (GHS flow, same conditions as the tracker) ─────── */
  const [booking, setBooking] = useState<{ label: string } | null>(null);
  const [bookingChecked, setBookingChecked] = useState(false);
  const loadBooking = useCallback(async () => {
    if (!app?.id) return;
    setBookingChecked(false);
    try {
      const { data, error } = await supabasePublic
        .from("interview_bookings")
        .select("id, slot_id, cancelled_at, interview_slots(slot_date, start_time, location)")
        .eq("admission_id", app.id)
        .is("cancelled_at", null)
        .maybeSingle();
      if (!error && data && (data as any).interview_slots) {
        const slot = (data as any).interview_slots;
        const dateLabel = new Date(slot.slot_date + "T00:00:00").toLocaleDateString("en-PK", {
          weekday: "short", day: "numeric", month: "short", year: "numeric",
        });
        setBooking({ label: `${dateLabel} at ${fmtSlotTime(slot.start_time)}${slot.location ? " — " + slot.location : ""}` });
      } else { setBooking(null); }
    } catch { setBooking(null); }
    finally { setBookingChecked(true); }
  }, [app?.id]);
  useEffect(() => { loadBooking(); }, [loadBooking]);

  /* ── Guards ────────────────────────────────────────────────────────────── */
  if (!session) {
    const returnRef = searchParams.get("ref");
    return (
      <PageLayout>
        <div className="container mx-auto max-w-md px-4 pt-10 pb-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold">Application not found or session expired</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            No application session is saved on this device. Track your application with your Reference
            Number or B-Form number instead.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button onClick={() => navigate("/admission", { state: { view: "track", query: returnRef } })}
              className="h-11 gap-2 rounded-full font-bold">
              <RefreshCw className="h-4 w-4" /> {returnRef ? "Track This Application" : "Track Application"}
            </Button>
            <Button variant="outline" onClick={() => navigate("/admission")} className="h-11 rounded-full font-bold">
              Back to Admission
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (id && app && app.id !== id) {
    // The route id and the session's application disagree — offer the right one.
    return (
      <PageLayout>
        <div className="container mx-auto max-w-md px-4 pt-10 pb-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold">Application not found or session expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">This link does not match the application saved on this device.</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button onClick={() => navigate(`/admission/application/${app.id}`)} className="h-11 gap-2 rounded-full font-bold">
              Open My Application
            </Button>
            <Button variant="outline" onClick={() => navigate("/admission/portal")} className="h-11 rounded-full font-bold">
              Back to Dashboard
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  /* ── Loading / error shells ────────────────────────────────────────────── */
  if (query.isLoading) {
    return (
      <PageLayout>
        <div className="container mx-auto max-w-3xl px-4 pt-6 pb-16">
          <AdmissionBackBar to="/admission/portal" label="Back to Dashboard" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </PageLayout>
    );
  }

  if (query.isError || !app) {
    return (
      <PageLayout>
        <div className="container mx-auto max-w-md px-4 pt-10 pb-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
            <XCircle className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold">Application not found or session expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {query.data?.error || "The saved session could not be loaded."} Track your application instead.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button onClick={() => { clearAdmissionSession(); navigate("/admission", { state: { view: "track" } }); }}
              className="h-11 gap-2 rounded-full font-bold">
              Track Application
            </Button>
            <Button variant="outline" onClick={() => navigate("/admission")} className="h-11 rounded-full font-bold">
              Back to Admission
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  /* ── Derived values ────────────────────────────────────────────────────── */
  const stage = resolveAdmissionStage(app.status, app.payment_status, app.processing_fee);
  const feePaid = app.payment_status === "paid";
  const processingFee = Number(app.processing_fee ?? settings?.processing_fee ?? 0);
  const hasFee = processingFee > 0;
  const accounts: AdmissionPaymentAccount[] = (settings?.payment_accounts ?? []) as AdmissionPaymentAccount[];
  const isMigration = app.admission_type === "migration";
  const currentMigStep = app.migration_step ?? 0;
  const canBookInterview = ["documents_verified", "under_review", "interview_scheduled"].includes(app.status);
  const canDownloadAdmitCard = ["interview_scheduled", "admitted", "admit_card_issued"].includes(app.status);
  const showVoucher = ["approved", "admitted"].includes(app.status);

  const bFormDigits = (app.b_form_no || "").replace(/[^0-9]/g, "");
  const maybe = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  /* ── PDF downloads (GHSS documents) ────────────────────────────────────── */
  const pdfInputBase = () => ({
    referenceNo: app.reference_no,
    name: app.full_name,
    fatherName: app.father_name,
    bFormNo: app.b_form_no,
    applyingClass: app.applying_class,
    admissionType: app.admission_type || "fresh",
    processingFee,
    deadline: app.fee_deadline,
    paymentAccounts: accounts,
    sessionYear: settings?.session_year ?? null,
    appliedOn: app.created_at,
  });

  const downloadApplicationPdf = async () => {
    setPdfBusy("application");
    try {
      const m = await import("@/lib/admissionPdf");
      await m.downloadApplicationForm({
        ...pdfInputBase(),
        paymentStatus: app.payment_status || "pending",
        paymentReference: liveRef,
        gender: app.gender,
        dateOfBirth: app.date_of_birth,
        contactNumber: app.contact_number,
        whatsappNumber: app.whatsapp_number,
        homeAddress: app.home_address,
        fatherCnic: maybe(app.father_cnic),
        occupation: maybe(app.occupation),
        previousSchool: maybe(app.previous_school),
        previousClass: maybe(app.previous_class),
        previousMarks: maybe(app.previous_marks),
        yearOfPassing: maybe(app.year_of_passing),
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
        const res = await ensurePaymentReference(app.reference_no, bFormDigits);
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

  const ensureRef = async (): Promise<string | null> => {
    if (liveRef) return liveRef;
    const res = await ensurePaymentReference(app.reference_no, bFormDigits);
    if (!res.ok) { toast.error(res.error || "Could not create the payment reference."); return null; }
    const ref = res.payment_reference ?? null;
    if (ref) setLiveRef(ref);
    return ref;
  };

  return (
    <PageLayout>
      <div className="container mx-auto max-w-3xl px-4 pt-6 pb-16">
        <AdmissionBackBar to="/admission/portal" label="Back to Dashboard" />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mt-4 text-center">
          <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">Application Form</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {app.full_name} · {school?.school_name ?? "Government High School Babi Khel"}
          </p>
        </div>

        {/* Downloads (GHSS 2-col grid) */}
        {hasFee && (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button variant="outline" onClick={() => downloadChallanPdf(true)} disabled={!!pdfBusy}
              className="h-11 gap-2 rounded-full text-xs font-bold">
              {pdfBusy === "challan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              {liveRef ? "Fee Challan" : "Generate + Fee Challan"}
            </Button>
            <Button variant="outline" onClick={downloadApplicationPdf} disabled={!!pdfBusy}
              className="h-11 gap-2 rounded-full text-xs font-bold">
              {pdfBusy === "application" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Application PDF
            </Button>
          </div>
        )}
        {!hasFee && (
          <div className="mt-4">
            <Button variant="outline" onClick={downloadApplicationPdf} disabled={!!pdfBusy}
              className="h-11 w-full gap-2 rounded-full text-xs font-bold">
              {pdfBusy === "application" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Application PDF
            </Button>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {/* ── Processing Fee card (GHSS) ─────────────────────────────────── */}
          {hasFee && (
            <Card className={`overflow-hidden rounded-2xl border-2 ${
              feePaid ? "border-green-300/70 dark:border-green-900/60" : "border-amber-200 dark:border-amber-900/60"
            }`}>
              <div aria-hidden className={`h-1 ${feePaid
                ? "bg-gradient-to-r from-green-600 via-emerald-500 to-green-600"
                : "bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400"}`} />
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      feePaid ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-amber-500/15 text-amber-600"
                    }`}>
                      <Wallet className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground">
                        Processing Fee — Rs {processingFee.toLocaleString("en-PK")}
                      </p>
                      {feePaid ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Paid on {app.paid_at ? formatFeeDate(app.paid_at) : "—"}
                          {app.payment_method ? ` · via ${paymentMethodLabel(app.payment_method)}` : ""}
                          {app.payment_receipt ? ` · Receipt ${app.payment_receipt}` : ""}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">Pay by manual transfer to the school account.</p>
                      )}
                    </div>
                  </div>
                  <Badge className={feePaid
                    ? "bg-green-500/15 text-green-700 dark:text-green-400"
                    : app.payment_status === "rejected"
                      ? "bg-red-500/10 text-red-600"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}>
                    {feePaid ? <><BadgeCheck className="mr-1 h-3.5 w-3.5" /> Paid</> : app.payment_status === "rejected" ? "Rejected" : "Pending"}
                  </Badge>
                </div>

                {/* Payment reference block */}
                {liveRef ? (
                  <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3.5 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Payment Reference
                    </p>
                    <p className="mt-0.5 font-mono text-xl font-extrabold tracking-wider text-primary">{liveRef}</p>
                    {!feePaid && (
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Pay the processing fee by manual transfer to the school account shown on your
                        challan quoting reference <b>{liveRef}</b>
                        {app.fee_deadline ? <> on or before <b>{formatDeadline(app.fee_deadline)}</b></> : null}.
                      </p>
                    )}
                  </div>
                ) : !feePaid && (
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    Tap &ldquo;Fee Challan&rdquo; above to generate your payment reference.
                  </p>
                )}

                {/* Manual payment panel */}
                {!feePaid && (
                  <div id="pay-fee" className="mt-4 scroll-mt-24">
                    <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading payment panel" />}>
                      <OnlinePayPanel
                        referenceNo={app.reference_no}
                        bFormNo={bFormDigits}
                        processingFee={processingFee}
                        paymentReference={liveRef}
                        feeDeadline={app.fee_deadline}
                        accounts={accounts}
                        whatsappNumber={settings?.contact_whatsapp ?? null}
                        schoolPhone={school?.phone ?? null}
                        onReference={(ref) => setLiveRef(ref)}
                        onDownloadChallan={() => downloadChallanPdf(false)}
                        challanBusy={pdfBusy === "challan"}
                      />
                    </Suspense>
                  </div>
                )}

                {/* Submission details */}
                <div className="mt-4">
                  <AdmissionReviewTable
                    title="Submission Details"
                    rows={[
                      { label: "Reference No.", value: <span className="font-mono">{app.reference_no}</span> },
                      { label: "Date Applied", value: formatFeeDate(app.created_at) },
                      { label: "Amount", value: `Rs ${processingFee.toLocaleString("en-PK")}` },
                      { label: "Fee Status", value: feePaid ? "Paid" : app.payment_status === "rejected" ? "Rejected" : "Pending" },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Status note (GHSS resolveStage note + next) ───────────────── */}
          <Card className="rounded-2xl border-border/70">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {stage.note}
                </p>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${stage.tone}`}>{stage.label}</span>
              </div>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted-foreground">Next: {stage.next}</p>
              {stage.warning && (
                <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {stage.warning}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Application review tables (GHSS) ──────────────────────────── */}
          <AdmissionReviewTable
            title="Application"
            rows={[
              { label: "School", value: school?.school_name ?? "Government High School Babi Khel", wide: true },
              { label: "Applying for Class", value: `Class ${app.applying_class}` },
              { label: "Admission Type", value: app.admission_type === "migration" ? "Migration / Transfer" : "Fresh Admission" },
              { label: "Admission No.", value: maybe(app.admission_roll_no) ?? "Given at admission" },
              { label: "Applied On", value: formatFeeDate(app.created_at) },
            ]}
          />

          <AdmissionReviewTable
            title="Personal Information"
            rows={[
              { label: "Name", value: app.full_name },
              { label: "Father Name", value: app.father_name },
              { label: "B-Form No.", value: showPii ? <span className="font-mono">{app.b_form_no}</span> : <span className="font-mono">{maskBForm(app.b_form_no)}</span> },
              { label: "Date of Birth", value: app.date_of_birth ? formatFeeDate(app.date_of_birth) : null },
              { label: "Gender", value: app.gender ? app.gender.charAt(0).toUpperCase() + app.gender.slice(1) : null },
              { label: "Contact", value: showPii ? <span className="font-mono">{app.contact_number}</span> : <span className="font-mono">{maskMobile(app.contact_number)}</span> },
              { label: "WhatsApp", value: app.whatsapp_number ? (showPii ? <span className="font-mono">{app.whatsapp_number}</span> : <span className="font-mono">{maskMobile(app.whatsapp_number)}</span>) : null },
              { label: "Father's CNIC", value: maybe(app.father_cnic) ? (showPii ? <span className="font-mono">{app.father_cnic}</span> : <span className="font-mono">{maskBForm(app.father_cnic)}</span>) : null },
              { label: "Occupation", value: maybe(app.occupation) },
              { label: "Home Address", value: maybe(app.home_address), wide: true },
            ]}
          />

          <div>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPii((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 px-3 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {showPii ? <><EyeOff className="h-3.5 w-3.5" /> Hide B-Form &amp; mobile</> : <><Eye className="h-3.5 w-3.5" /> Show B-Form &amp; mobile</>}
              </button>
            </div>
            <AdmissionReviewTable
              title="Academic Information"
              rows={[
                { label: "Previous School", value: maybe(app.previous_school), wide: true },
                { label: "Previous Class", value: maybe(app.previous_class) },
                { label: "Previous Marks / Grade", value: maybe(app.previous_marks) },
                { label: "Year of Passing", value: maybe(app.year_of_passing) },
              ]}
            />
          </div>

          {/* ── Admin note / rejection reason (GHS) ───────────────────────── */}
          {app.admin_note && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300">
              <p className="mb-1 font-semibold">Message from Admin:</p>
              <p className="leading-relaxed">{app.admin_note}</p>
            </div>
          )}
          {app.rejection_reason && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
              <p className="mb-1 font-semibold">Rejection Reason:</p>
              <p className="leading-relaxed">{app.rejection_reason}</p>
            </div>
          )}

          {/* ── Declaration (GHSS muted bar) ──────────────────────────────── */}
          <div className="rounded-2xl border border-border/60 bg-muted/30 p-3.5 text-[11px] leading-relaxed text-muted-foreground">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <b>Declaration:</b> I declare that the information given in support of the application is accurate and
                complete. I understand that any misrepresentation will result in disqualification of my application
                for admission.
              </span>
            </p>
          </div>

          {/* ── Migration progress (GHS flow) ─────────────────────────────── */}
          {isMigration && (
            <Card>
              <CardContent className="p-5">
                <p className="mb-4 flex items-center gap-2 text-sm font-bold">
                  <RefreshCw className="h-4 w-4 text-primary" /> Migration Progress
                </p>
                <div className="overflow-x-auto pb-2">
                  <div className="flex min-w-[600px] items-start gap-1">
                    {MIGRATION_STEPS.map((s, i) => {
                      const done = i + 1 < currentMigStep;
                      const current = i + 1 === currentMigStep;
                      return (
                        <div key={i} className="flex-1 text-center">
                          <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
                            done ? "bg-green-500 text-white"
                              : current ? "bg-primary text-white animate-pulse shadow-lg shadow-primary/30"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {done ? "✓" : i + 1}
                          </div>
                          <p className={`mt-1.5 text-[10px] leading-tight ${current ? "font-bold text-primary" : done ? "text-green-600" : "text-muted-foreground"}`}>
                            {s}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Interview slot booking (GHS flow) ─────────────────────────── */}
          {canBookInterview && bookingChecked && (
            <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading interview slots" />}>
              <InterviewSlotBooking
                admissionId={app.id}
                currentBooking={booking?.label ?? null}
                onBooked={async () => {
                  await loadBooking();
                  await qc.invalidateQueries({ queryKey: ["admission-portal-state"] });
                }}
              />
            </Suspense>
          )}

          {/* ── Admission-fee challan voucher (GHS flow) ──────────────────── */}
          {showVoucher && (
            <Suspense fallback={<div className="h-24 rounded-2xl bg-muted" aria-label="Loading fee details" />}>
              <FeeChallan
                admissionId={app.id}
                admissionType={app.admission_type || "fresh"}
                studentName={app.full_name}
                applyingClass={app.applying_class}
                referenceNo={app.reference_no}
              />
            </Suspense>
          )}

          {/* ── Admit card (GHS flow) ────────────────────────────────────── */}
          {canDownloadAdmitCard && (
            <Suspense fallback={<div className="h-16 rounded-2xl bg-muted" aria-label="Loading admit card" />}>
              <AdmitCard admission={app as unknown as Admission} />
            </Suspense>
          )}

          {/* ── Application Timeline (GHSS card) ─────────────────────────── */}
          <ApplicationTracker timeline={query.data?.timeline ?? []} currentStatus={app.status} />

          <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground">
            <Landmark className="h-3 w-3" />
            {school?.school_name ?? "Government High School Babi Khel"} · Application {app.reference_no}
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
