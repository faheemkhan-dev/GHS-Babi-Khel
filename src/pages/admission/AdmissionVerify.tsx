// src/pages/admission/AdmissionVerify.tsx — the QR-code landing page printed
// on the Admit Card (https://…/admission/verify?ref=GHS-2026-00001).
//
// The QR used to point at a route that did not exist (a hard 404). This page
// verifies a reference number through the same hardened track_admission RPC
// the public tracker uses, and shows a SHORT, safe result: name, class,
// status badge. No B-Form, no contact details, no marks — a stranger who
// scans the QR learns only whether the card is genuine.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BadgeCheck, XCircle, Search, ShieldCheck, Loader2, QrCode } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrackAdmission, type Admission } from "@/hooks/useAdmission";
import { resolveAdmissionStage } from "@/components/admissions/AdmissionStepper";

export default function AdmissionVerify() {
  const [searchParams, setSearchParams] = useSearchParams();
  const refParam = useMemo(() => (searchParams.get("ref") || "").trim(), [searchParams]);
  const [query, setQuery] = useState(refParam);
  const [doTrack, setDoTrack] = useState(refParam.length >= 5);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (refParam && refParam !== query) { setQuery(refParam); setDoTrack(true); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refParam]);

  const enabled = doTrack && query.trim().length >= 5;
  const { data: results, isFetching } = useTrackAdmission(enabled ? query.trim() : "");
  const result: Admission | undefined = enabled && !isFetching ? (results ?? [])[0] : undefined;

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 5) return;
    setDoTrack(true);
    setSearchParams({ ref: query.trim() }, { replace: true });
  };

  return (
    <PageLayout>
      <div className="container mx-auto max-w-md px-4 pt-10 pb-16">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/40 bg-gold/10 text-gold-strong">
            <QrCode className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-extrabold leading-tight">Verify Application</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Scan result from an Admit Card QR code. Enter the reference number to check whether the card is genuine.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={onSubmit} className="mt-6 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setDoTrack(false); }}
              placeholder="e.g. GHS-2026-00001"
              className="h-10 rounded-md pl-9 text-sm font-mono"
              aria-label="Reference number"
            />
          </div>
          <Button type="submit" disabled={query.trim().length < 5 || isFetching}
            className="h-10 gap-1.5 rounded-md px-4 text-xs font-bold">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Verify
          </Button>
        </form>

        {/* Result */}
        <div className="mt-6">
          {enabled && isFetching && (
            <div className="rounded-2xl border border-border/70 bg-card p-6 text-center">
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Checking…</p>
            </div>
          )}

          {enabled && !isFetching && result && (
            <div className="overflow-hidden rounded-2xl border border-green-200 bg-card dark:border-green-900/60">
              <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
              <div className="p-5 text-center">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600">
                  <BadgeCheck className="h-6 w-6" />
                </span>
                <p className="text-sm font-bold text-green-700 dark:text-green-400">Genuine application</p>
                <p className="mt-2 font-mono text-lg font-bold text-primary">{result.reference_no}</p>
                <div className="mt-3 space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> <span className="font-semibold">{result.full_name}</span></p>
                  <p><span className="text-muted-foreground">Father:</span> <span className="font-semibold">{result.father_name}</span></p>
                  <p><span className="text-muted-foreground">Class:</span> <span className="font-semibold">Class {result.applying_class}</span></p>
                  <p><span className="text-muted-foreground">Status:</span>{" "}
                    <span className="font-semibold">{resolveAdmissionStage(result.status, result.payment_status, result.processing_fee).label}</span>
                  </p>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                  Issued by Government High School Babi Khel. If this does not match the card in your hand, contact the school office.
                </p>
              </div>
            </div>
          )}

          {enabled && !isFetching && !result && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/20">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <XCircle className="h-6 w-6" />
              </span>
              <p className="text-sm font-bold text-red-700 dark:text-red-400">No application found</p>
              <p className="mt-1 text-xs leading-relaxed text-red-700/80 dark:text-red-400/80">
                The reference number on the card does not match any application. Check the number or contact the school office.
              </p>
            </div>
          )}

          {!enabled && (
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-center text-xs leading-relaxed text-muted-foreground">
              This page is the target of the QR code printed on every Admit Card. The school office can scan a
              card to confirm the application is genuine within seconds.
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button asChild variant="outline" className="h-10 rounded-md text-xs font-bold">
            <Link to="/admission">Back to Admission</Link>
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
