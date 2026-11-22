// src/components/admissions/AdmissionHome.tsx — the public Admission home
// (GHSS Ghallanai layout, GHS Babi Khel High School flow:
// fresh + migration, seats per class, no quotas / programs).
//
//   hero             light premium hero · Session / Days Left / Last Date tiles ·
//                    Apply Online (or My Application) + Track Application
//   closed notice    only Apply / eligibility / downloads lock — Track stays open
//   how to apply     7-step gold-rail card
//   track            inline Track Application card (trackSlot, injected by the page)
//   (children)       Merit Lists, then Classes & Seats — injected by the page
//   eligibility      premium on-demand banner + checker
//   instructions     7 numbered cards, the last one red
//   downloads        printable forms & guides
//   helpline         slim Call / Email pills
//
// Performance notes (this screen is the first thing parents open, often on
// slow mobile data) are unchanged: pure CSS (no framer-motion, no blur
// filters, no images), the eligibility checker is a lazy chunk, document
// generators load on the first download tap and below-the-fold sections use
// content-visibility:auto. The props are IDENTICAL to the previous version,
// so pages/Admission.tsx needs no change.
// ═══════════════════════════════════════════════════════════════════════════

import { lazy, Suspense, memo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen, Banknote, Mail, ScrollText, FileDown, Download, Loader2, Lock,
  ChevronDown, GraduationCap, Search, LayoutDashboard, AlertCircle, BadgeCheck,
  CalendarDays, CalendarCheck2, Hourglass, Phone, ListChecks, ArrowRight,
} from "lucide-react";
import type { AdmissionType } from "@/hooks/useAdmission";
import type { ReactNode } from "react";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";

const EligibilityChecker = lazy(() => import("@/components/admissions/EligibilityChecker"));

const DOWNLOADS = [
  { key: "prospectus",         title: "Prospectus",        desc: "Programs, documents & how admission works", icon: BookOpen },
  { key: "fee_structure",      title: "Fee Structure",     desc: "Tuition and BISE charges explained",       icon: Banknote },
  { key: "migration_template", title: "Transfer Letter",   desc: "Request your leaving certificate",         icon: Mail },
  { key: "rules",              title: "Admission Rules",   desc: "Policies, age limits & eligibility",       icon: ScrollText },
] as const;

const STEPS = [
  { title: "Check Eligibility",   desc: "A quick class and age check — takes under a minute." },
  { title: "Student Information", desc: "Name, father's name, B-Form number, contact and address." },
  { title: "Academic Information", desc: "Class, fresh or migration, previous school and marks." },
  { title: "Review & Submit",     desc: "Check everything, solve the security question and submit. You get a Reference Number." },
  { title: "Pay the Fee",         desc: "If a processing fee applies, pay online or by manual transfer using your fee challan." },
  { title: "Track Status",        desc: "Check payment and application status with your Reference Number, B-Form or mobile." },
  { title: "Merit List & Visit",  desc: "Seats are filled on merit. Merit-listed students bring original documents to the school office." },
] as const;

const INSTRUCTIONS = [
  "Submit only one application per student for the session.",
  "Choose the correct class and admission type (Fresh or Migration) carefully.",
  "Fields marked * are mandatory.",
  "Enter your mobile number carefully (03XXXXXXXXX). It is used for fee payment and status updates.",
  "Seats are filled through the published Merit List, ranked on previous class marks.",
  "Class 9 and 10 migration is completed school-to-school on the BISEP portal. Follow the Migration Progress in your tracker.",
  "Any false information will cancel your application.",
] as const;

const lazySection = { contentVisibility: "auto", containIntrinsicSize: "0 360px" } as const;

function parseDay(d?: string | null): Date | null {
  if (!d) return null;
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Kicker + serif title, centred (Ghallanai section heading). */
function SectionTitle({ kicker, children, hint }: { kicker?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 text-center">
      {kicker && (
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gold-strong">{kicker}</p>
      )}
      <h2 className="text-xl font-bold text-foreground sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
        {children}
      </h2>
      {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One hero stat tile (Session / Days Left / Last Date) — all three are white cards. */
function StatTile({ icon: Icon, label, value }: {
  icon: typeof CalendarDays; label: string; value: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-card px-2 py-3 text-center shadow-card">
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
      <Icon className="mx-auto h-4 w-4 text-primary" />
      <p className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-[15px] font-bold leading-tight text-foreground sm:text-lg" style={{ fontFamily: "var(--font-luxe, var(--font-display))" }}>{value}</p>
    </div>
  );
}

const helpRowCls =
  "group flex h-12 touch-manipulation items-center gap-3 rounded-full border border-gold/40 bg-card pl-1.5 pr-4 shadow-sm transition-colors hover:bg-gold/5 active:bg-gold/10";

function HelpRowInner({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/85 text-gold">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
        <span className="block truncate text-[13px] font-bold text-foreground">{value}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-gold-strong" />
    </>
  );
}

export interface AdmissionHomeProps {
  isOpen: boolean;
  sessionLabel: string;
  lastDate?: string | null;
  bannerMessage?: string | null;
  closedNote?: string | null;
  downloading: string | null;
  hasLibFile: (key: string) => boolean;
  onApply: (cls?: string, type?: AdmissionType) => void;
  onTrack: () => void;
  onDownloadItem: (key: string) => void;
  onDownloadBlank: () => void;
  onDownloadAll: () => void;
  onLocked: () => void;
  /** With a saved applicant session the primary CTA becomes
   *  "My Application" → /admission/portal (the Applicant Dashboard). */
  hasSession?: boolean;
  /** Inline "Track Application" card — rendered right below "How to apply". */
  trackSlot?: ReactNode;
  /** Rendered below the track card: Merit Lists, then Classes & Seats. */
  children?: ReactNode;
}

function AdmissionHome({
  isOpen, sessionLabel, lastDate, bannerMessage, closedNote, downloading, hasLibFile,
  onApply, onTrack, onDownloadItem, onDownloadBlank, onDownloadAll, onLocked, hasSession, trackSlot, children,
}: AdmissionHomeProps) {
  const [showElig, setShowElig] = useState(false);
  const navigate = useNavigate();
  const { data: school } = useSchoolSettings();

  const last = parseDay(lastDate);
  const lastLabel = last
    ? last.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })
    : null;
  let daysLeft: number | null = null;
  if (last && isOpen) {
    const today = new Date(new Date().toDateString());
    daysLeft = Math.max(0, Math.round((last.getTime() - today.getTime()) / 86_400_000)) + 1;
  }
  // Inclusive count: on the last date itself there is still 1 day left.
  const daysValue = !isOpen ? "—" : daysLeft === null ? "Open" : String(daysLeft);
  const daysLabel = daysLeft === 1 ? "Day Left" : "Days Left";

  const guard = (fn: () => void) => () => (isOpen ? fn() : onLocked());

  const phone = school?.phone || null;
  const email = school?.email || "ghsbabikhel@gmail.com";

  return (
    <div>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-gold/30 bg-gradient-to-br from-[hsl(42_65%_95%)] via-[hsl(100_22%_95%)] to-[hsl(152_30%_93%)] px-4 pb-8 pt-9 dark:from-card dark:via-card dark:to-background sm:pb-10 sm:pt-12">
        {/* soft blobs */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="relative mx-auto max-w-3xl text-center">
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
                isOpen
                  ? "border-green-300/70 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
                  : "border-red-300/70 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isOpen ? "animate-pulse bg-green-500" : "bg-red-500"}`} />
              {isOpen ? "Admissions Open" : "Admissions Closed"}
            </span>
          </div>

          <h1
            className="text-[2.6rem] font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl"
            style={{ fontFamily: "var(--font-luxe, var(--font-display))" }}
          >
            High School{" "}
            <em className="bg-gradient-to-r from-gold-strong via-gold to-gold-strong bg-clip-text pr-1 italic text-transparent">
              Admissions
            </em>
          </h1>

          {/* ornament */}
          <div aria-hidden className="mx-auto my-3 flex max-w-[11rem] items-center gap-2">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold/70" />
            <i className="h-1.5 w-1.5 rotate-45 bg-gold" />
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold/70" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary dark:text-gold">
            GHS Babi Khel, District Mohmand
          </p>

          {/* stat tiles */}
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2.5">
            <StatTile icon={CalendarDays} label="Session" value={isOpen ? sessionLabel : "—"} />
            <StatTile icon={Hourglass} label={daysLabel} value={daysValue} />
            <StatTile icon={CalendarCheck2} label="Last Date" value={isOpen ? (lastLabel ?? "To be announced") : "—"} />
          </div>

          {/* actions */}
          <div className="mx-auto mt-5 grid max-w-md grid-cols-2 gap-2.5">
            {hasSession ? (
              <button
                type="button"
                onClick={() => navigate("/admission/portal")}
                className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground shadow-sm transition-opacity active:opacity-80"
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>My Application</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={guard(() => onApply())}
                aria-disabled={!isOpen}
                className={`inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition-opacity active:opacity-80 ${
                  isOpen
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                }`}
              >
                {isOpen ? <GraduationCap className="h-4 w-4 shrink-0" /> : <Lock className="h-3.5 w-3.5 shrink-0" />}
                <span>Apply Online</span>
              </button>
            )}
            {/* Track is NEVER locked — applicants must be able to follow their application after the deadline */}
            <button
              type="button"
              onClick={onTrack}
              className="inline-flex h-10 touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-gold/60 bg-card px-3 text-[12px] font-semibold text-primary transition-colors hover:bg-gold/10 active:bg-gold/15"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span>Track Application</span>
            </button>
          </div>

          {isOpen && bannerMessage && (
            <p className="mt-4 text-xs italic leading-relaxed text-muted-foreground">“{bannerMessage}”</p>
          )}
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-4">
        {/* ── CLOSED NOTICE ──────────────────────────────────────────────── */}
        {!isOpen && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-red-700 dark:text-red-400">Admissions are currently closed</p>
              <p className="mt-1 text-xs leading-relaxed text-red-700/80 dark:text-red-400/80">
                {closedNote} Applying, the eligibility check and downloads unlock when admissions reopen.
                You can still <b>track your application</b> and view published merit lists.
              </p>
            </div>
          </div>
        )}

        {/* ── HOW TO APPLY ───────────────────────────────────────────────── */}
        <section className="mt-10" style={lazySection}>
          <SectionTitle kicker="Process" hint="Simple steps from home to classroom">How to Apply</SectionTitle>
          <div className="relative mx-auto max-w-2xl overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card">
            <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
            <ol className="relative ml-8 space-y-3 border-l-2 border-gold/30 py-5 pl-6 pr-4 sm:ml-10">
              {STEPS.map((s, i) => {
                const isLast = i === STEPS.length - 1;
                return (
                  <li key={s.title} className="relative">
                    <span
                      className={`absolute -left-[2.55rem] top-1 flex h-[26px] w-[26px] items-center justify-center rounded-full border text-[11px] font-bold ${
                        isLast
                          ? "border-primary bg-primary text-primary-foreground ring-4 ring-primary/10"
                          : "border-gold bg-card text-primary"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-3.5 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-gold-strong">Step {String(i + 1).padStart(2, "0")}</p>
                      <p className="mt-0.5 text-[1.05rem] font-bold leading-snug text-foreground" style={{ fontFamily: "var(--font-luxe, var(--font-display))" }}>{s.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ── Inline Track Application (right below How to Apply) ── */}
        {trackSlot && <div className="mt-10">{trackSlot}</div>}

        {/* ── Merit Lists, then Classes & Seats (injected by the page) ── */}
        {children && <div className="mt-12 space-y-12">{children}</div>}

        {/* ── ELIGIBILITY — slim premium banner (checker loaded on demand) ── */}
        <section className="mt-12" style={lazySection}>
          <div className={`relative overflow-hidden rounded-2xl border border-gold/40 bg-card shadow-card ${isOpen ? "" : "opacity-60"}`}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-gold via-gold-strong to-gold" />
            <button
              type="button"
              onClick={() => (isOpen ? setShowElig((v) => !v) : onLocked())}
              aria-expanded={showElig}
              aria-disabled={!isOpen}
              className={`flex w-full touch-manipulation items-center gap-3 py-3 pl-5 pr-3 text-left ${isOpen ? "active:bg-muted/40" : "cursor-not-allowed"}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/85 text-gold ring-2 ring-gold/30">
                <BadgeCheck className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold leading-tight text-foreground" style={{ fontFamily: "var(--font-luxe, var(--font-display))" }}>
                  Check Your Eligibility
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">Quick class &amp; age check · under a minute</span>
              </span>
              <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-gold/50 bg-gold/10 pl-3 pr-2 text-[11px] font-bold text-primary">
                {isOpen ? (showElig ? "Close" : "Start") : "Locked"}
                {isOpen
                  ? <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${showElig ? "rotate-180" : ""}`} />
                  : <Lock className="h-3 w-3" />}
              </span>
            </button>
            {isOpen && showElig && (
              <div className="border-t border-border/60 bg-muted/20 p-3">
                <Suspense fallback={<div className="h-56 rounded-xl bg-muted" aria-label="Loading eligibility checker" />}>
                  <EligibilityChecker onApply={(cls, type) => onApply(cls, type)} />
                </Suspense>
              </div>
            )}
          </div>
        </section>

        {/* ── IMPORTANT INSTRUCTIONS ─────────────────────────────────────── */}
        <section className="mt-12" style={lazySection}>
          <div className="overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card">
            <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
            <div className="p-4 sm:p-5">
              <div className="mb-4 text-center">
                <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gold/15 text-gold-strong ring-2 ring-gold/25">
                  <ListChecks className="h-5 w-5" />
                </span>
                <h2 className="text-lg font-bold text-foreground sm:text-xl" style={{ fontFamily: "var(--font-display)" }}>Important Instructions</h2>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Please read before applying</p>
              </div>
              <ol className="space-y-2">
                {INSTRUCTIONS.map((text, i) => {
                  const danger = i === INSTRUCTIONS.length - 1;
                  return (
                    <li
                      key={text}
                      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                        danger
                          ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                          : "border-border/60 bg-muted/20"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          danger ? "bg-red-500 text-white" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <p className={`text-xs leading-relaxed ${danger ? "font-semibold text-red-700 dark:text-red-400" : "text-foreground/85"}`}>{text}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* ── DOWNLOADS — slim premium list ──────────────────────────────── */}
        <section className="mt-12" style={lazySection}>
          <SectionTitle kicker="Resources" hint={isOpen ? "Printable forms and guides" : "Unlock when admissions reopen"}>Downloads</SectionTitle>

          <div className={`mx-auto max-w-lg overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card ${isOpen ? "" : "opacity-60"}`}>
            <div aria-hidden className="h-[3px] bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
            <ul className="divide-y divide-border/60">
              <li>
                <button
                  type="button"
                  disabled={!!downloading}
                  onClick={guard(onDownloadBlank)}
                  className="flex w-full touch-manipulation items-center gap-2.5 bg-gold/5 px-3 py-2.5 text-left active:bg-gold/10 disabled:opacity-60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/50 bg-card text-primary">
                    {downloading === "empty_form" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13px] font-semibold text-foreground">Admission Form</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">Blank form — print, fill by hand and submit at the office</span>
                  </span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 text-primary">
                    {isOpen ? <FileDown className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  </span>
                </button>
              </li>
              {DOWNLOADS.map((d) => (
                <li key={d.key}>
                  <button
                    type="button"
                    disabled={!!downloading}
                    onClick={guard(() => onDownloadItem(d.key))}
                    className="flex w-full touch-manipulation items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted/50 disabled:opacity-60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-primary">
                      {downloading === d.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <d.icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block text-[13px] font-semibold text-foreground">{d.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{d.desc}</span>
                    </span>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground">
                      {isOpen
                        ? <FileDown className={`h-3.5 w-3.5 ${hasLibFile(d.key) ? "text-green-600" : ""}`} />
                        : <Lock className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {isOpen && (
              <div className="border-t border-border/60 bg-muted/20 p-2.5">
                <button
                  type="button"
                  disabled={!!downloading}
                  onClick={onDownloadAll}
                  className="inline-flex h-8 w-full touch-manipulation items-center justify-center gap-1.5 rounded-full border border-gold/60 bg-card px-4 text-[12px] font-semibold text-primary active:bg-gold/15 disabled:opacity-50"
                >
                  <FileDown className="h-3.5 w-3.5" /> Download all
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── HELPLINE — slim Call / Email pills ───────────────────────── */}
        <section className="mt-12" style={lazySection}>
          <SectionTitle kicker="Support">School Helpline</SectionTitle>
          <div className="mx-auto grid max-w-lg gap-2 sm:grid-cols-2">
            {phone ? (
              <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className={helpRowCls}>
                <HelpRowInner icon={Phone} label="Call" value={phone} />
              </a>
            ) : (
              <Link to="/contact" className={helpRowCls}>
                <HelpRowInner icon={Phone} label="Call" value="See Contact page" />
              </Link>
            )}
            <a href={`mailto:${email}`} className={helpRowCls}>
              <HelpRowInner icon={Mail} label="Email" value={email} />
            </a>
          </div>
          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            Need more help? Visit the school office during working hours or{" "}
            <Link to="/contact" className="font-semibold text-primary underline-offset-2 hover:underline">contact us</Link>.
          </p>
        </section>

        {/* ── SEO content (screen-reader / crawler only) ───────────────────── */}
              <section aria-label="Admission information" className="sr-only">
                <h2>Admission at Government High School Babi Khel</h2>
                <p>Government High School Babi Khel, District Mohmand, KPK welcomes admissions for Class 6 to Class 10. Admissions are open every academic session for both fresh students and migration/transfer cases.</p>
                <ul>
                  <li><strong>Class 6, 7, 8 (Fresh):</strong> School-level admission.</li>
                  <li><strong>Class 9 (Fresh):</strong> Student is enrolled with BISE Peshawar by the school after admission.</li>
                  <li><strong>Class 9 &amp; 10 (Migration):</strong> School-to-school transfer on the BISE Peshawar portal, from another BISE-affiliated institution.</li>
                  <li><strong>Class 6–8 (Transfer):</strong> Handled directly between schools, outside the BISE portal.</li>
                </ul>
                <p>Class 9/10 migration from another Board may additionally require DMC and migration certificate (BISE requirements), submitted by the schools as part of BISEP's process.</p>
                <p>How to apply: apply online. Seats are filled through the published Merit List ranked on previous class marks; merit-listed students are then asked to submit their documents at the school office. For Class 9/10 migration, board-level migration is completed by the schools on the BISEP portal separately from this online application.</p>
              </section>
      </div>
    </div>
  );
}

export default memo(AdmissionHome);
