// src/pages/admission/AdmissionPortal.tsx — the Applicant Dashboard
// (GHSS Ghallanai /admission/portal, ported to the GHS Babi Khel flow).
//
// Shown after Apply Online: "My Application" lives here — the reference
// number, the class, the fee status and the fee deadline — with:
//   • the applicant session kept on this device (reference + B-Form pair)
//   • "View & Pay Fee" (unpaid) / "View Application" (paid) → application view
//   • Exit — clears the session exactly like GHSS inter_logout
// The dashboard loads itself through admission_portal_state (migration 21),
// which verifies BOTH keys server-side before returning anything.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LogOut, LayoutDashboard, Wallet, BadgeCheck, Search,
  WifiOff, RefreshCw, ClipboardList, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import PageLayout from "@/components/layout/PageLayout";
import AdmissionBackBar from "@/components/admissions/AdmissionBackBar";
import {
  getAdmissionSession, clearAdmissionSession, ADMISSION_SESSION_EVENT,
  maskBForm, maskMobile,
} from "@/lib/admissionSession";
import { useAdmissionPortalState, useAdmissionSettings } from "@/hooks/useAdmission";
import { formatDeadline } from "@/lib/admissionPayment";
import { resolveAdmissionStage } from "@/components/admissions/AdmissionStepper";
import toast from "react-hot-toast";

export default function AdmissionPortal() {
  const navigate = useNavigate();
  const session = getAdmissionSession();
  const { data: settings } = useAdmissionSettings();

  const query = useAdmissionPortalState(session?.reference_no ?? null, session?.b_form_no ?? null);
  const app = query.data?.ok ? query.data.application : null;

  // Keep the stored application id fresh so the view-page route always matches.
  useEffect(() => {
    if (app?.id && session && session.application_id !== app.id) {
      try {
        localStorage.setItem(
          "ghs_admission_session",
          JSON.stringify({ ...session, application_id: app.id }),
        );
      } catch { /* private mode */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.id]);

  // Leave with the user when the session is cleared elsewhere (Exit on another tab).
  useEffect(() => {
    const onChange = () => {
      if (!getAdmissionSession()) navigate("/admission", { replace: true });
    };
    window.addEventListener(ADMISSION_SESSION_EVENT, onChange);
    return () => window.removeEventListener(ADMISSION_SESSION_EVENT, onChange);
  }, [navigate]);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const exit = () => {
    clearAdmissionSession();
    toast.success("You have exited your application session.");
    navigate("/admission");
  };

  /* ── No session on this device ─────────────────────────────────────────── */
  if (!session) {
    return (
      <PageLayout>
        <div className="container mx-auto max-w-md px-4 pt-10 pb-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LayoutDashboard className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold">Applicant Dashboard</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            No application session is saved on this device. Track your application any time with your
            Reference Number or B-Form number.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Button onClick={() => navigate("/admission", { state: { view: "track" } })}
              className="h-10 gap-2 rounded-md font-bold">
              <Search className="h-4 w-4" /> Track Application
            </Button>
            <Button variant="outline" onClick={() => navigate("/admission")}
              className="h-10 rounded-md font-bold">
              Back to Admission
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const stage = app ? resolveAdmissionStage(app.status, app.payment_status, app.processing_fee) : null;
  const feePaid = app?.payment_status === "paid";
  const hasFee = !!app && Number(app.processing_fee ?? 0) > 0;

  return (
    <PageLayout>
      <div className="container mx-auto max-w-2xl px-4 pt-6 pb-16">
        <AdmissionBackBar to="/admission" label="Back to Admission" />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">Applicant Dashboard</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              B-Form: <span className="font-mono font-semibold">{maskBForm(session.b_form_no)}</span>
              {app ? <> · Mobile: <span className="font-mono font-semibold">{maskMobile(app.contact_number)}</span></> : null}
              {settings?.session_year ? <> · Session {settings.session_year}</> : null}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exit}
            className="h-9 shrink-0 gap-1.5 rounded-md px-4 text-xs font-bold">
            <LogOut className="h-3.5 w-3.5" /> Exit
          </Button>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        {query.isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : query.isError ? (
          <Card className="mt-6 border-2 border-red-200 dark:border-red-900/60">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                <WifiOff className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-bold">Couldn&rsquo;t load your dashboard</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The connection dropped while loading your application. Your application is safe — try again.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => query.refetch()} className="h-9 gap-1.5 rounded-md px-4 text-xs font-bold">
                  <RefreshCw className="h-3.5 w-3.5" /> Try Again
                </Button>
                <Button variant="outline" onClick={() => navigate("/admission")}
                  className="h-9 rounded-md px-4 text-xs font-bold">
                  Back to Admission
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : !app ? (
          <Card className="mt-6 border-2 border-amber-200 dark:border-amber-900/60">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
                <Search className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-bold">Session expired</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {query.data?.error || "No application found for this reference and B-Form number."}
                  {" "}Track your application instead with your Reference Number.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => { clearAdmissionSession(); navigate("/admission", { state: { view: "track" } }); }}
                  className="h-9 gap-1.5 rounded-md px-4 text-xs font-bold">
                  <Search className="h-3.5 w-3.5" /> Track Application
                </Button>
                <Button variant="outline" onClick={exit} className="h-9 rounded-md px-4 text-xs font-bold">
                  Back to Admission
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 space-y-4"
          >
            {/* ── My Application card (GHSS "Your Admission Request") ────── */}
            <Card className="overflow-hidden rounded-2xl border-border/70 shadow-md">
              <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      My Application
                    </p>
                    <p className="mt-1 font-mono text-lg font-bold text-primary">{app.reference_no}</p>
                  </div>
                  {hasFee ? (
                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold ${
                      feePaid
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}>
                      {feePaid ? <BadgeCheck className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                      {feePaid ? "Fee Paid" : "Fee Pending"}
                    </span>
                  ) : null}
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { k: "Name", v: app.full_name },
                    { k: "Class", v: `Class ${app.applying_class}` },
                    { k: "Type", v: app.admission_type === "migration" ? "Migration" : "Fresh" },
                    ...(hasFee && !feePaid && app.fee_deadline
                      ? [{ k: "Fee Deadline", v: formatDeadline(app.fee_deadline) }]
                      : []),
                    ...(stage ? [{ k: "Status", v: stage.label }] : []),
                    ...(feePaid && app.paid_at
                      ? [{ k: "Paid On", v: formatDeadline(app.paid_at) }]
                      : []),
                  ].map((f) => (
                    <div key={f.k} className="rounded-xl bg-muted/40 px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{f.k}</dt>
                      <dd className="mt-0.5 truncate text-[13px] font-semibold" title={String(f.v)}>{f.v}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {hasFee && !feePaid ? (
                    <Button asChild className="h-10 gap-2 rounded-md font-bold">
                      <Link to={`/admission/application/${app.id}?pay=1`}>
                        <Wallet className="h-4 w-4" /> View &amp; Pay Fee
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild className="h-10 gap-2 rounded-md font-bold">
                      <Link to={`/admission/application/${app.id}`}>
                        <ClipboardList className="h-4 w-4" /> View Application
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" className="h-10 gap-2 rounded-md font-bold">
                    <Link to="/admission" onClick={(e) => { e.preventDefault(); navigate("/admission", { state: { view: "track" } }); }}>
                      <Search className="h-4 w-4" /> Track Application
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ── Next-step note (GHSS resolveStage note + next) ─────────── */}
            {stage && (
              <Card className="rounded-2xl border-border/70">
                <CardContent className="p-4">
                  <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {stage.note}
                  </p>
                  <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted-foreground">
                    Next: {stage.next}
                  </p>
                  {stage.warning && (
                    <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-semibold leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                      <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {stage.warning}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── What happens next (GHS flow) ────────────────────────────── */}
            <Card className="rounded-2xl border-border/70">
              <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
                <p className="text-sm font-semibold text-foreground">What happens next:</p>
                <p className="flex items-start gap-2"><span className="font-bold text-primary">1.</span> Save your Reference Number — it is on every document.</p>
                <p className="flex items-start gap-2"><span className="font-bold text-primary">2.</span> Pay the processing fee (online or manual), then seats are filled through the Merit List.</p>
                <p className="flex items-start gap-2"><span className="font-bold text-primary">3.</span> Track your status any time — this dashboard stays on this device until you exit.</p>
              </CardContent>
            </Card>

            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              This dashboard is saved on this device only. Use Track Application on any other device.
            </p>
          </motion.div>
        )}
      </div>
    </PageLayout>
  );
}
