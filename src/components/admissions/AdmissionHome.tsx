import { lazy, Suspense, memo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, Banknote, Mail, ScrollText, FileDown, Download,
  Loader2, Lock, CheckCircle2, ChevronDown, GraduationCap, Repeat, Search,
  AlertCircle, Sparkles, CalendarClock, Layers,
} from "lucide-react";
import type { AdmissionType } from "@/hooks/useAdmission";

/**
 * Admission Portal — home view.
 *
 * Performance notes (this screen is the first thing parents open, often on
 * slow mobile data):
 *  • Pure CSS — no framer-motion, no blur/backdrop filters, no infinite
 *    animations, no images. Everything is gradients, borders and SVG icons.
 *  • The eligibility checker (Radix Select + date input + logic) is a separate
 *    chunk fetched only when the visitor opens it.
 *  • The document text / printable-form generators live in lib/admissionDocs
 *    and are fetched on the first download tap.
 *  • Below-the-fold sections use content-visibility:auto so the browser skips
 *    their layout/paint until they scroll near the viewport.
 */
const EligibilityChecker = lazy(() => import("@/components/admissions/EligibilityChecker"));

const DOWNLOADS = [
  { key: "prospectus",         title: "Prospectus",        desc: "Programs, documents & how admission works", icon: BookOpen },
  { key: "fee_structure",      title: "Fee Structure",     desc: "Tuition and BISE charges explained",       icon: Banknote },
  { key: "migration_template", title: "Transfer Letter",   desc: "Request your leaving certificate",         icon: Mail },
  { key: "rules",              title: "Admission Rules",   desc: "Policies, age limits & eligibility",       icon: ScrollText },
] as const;

const STEPS = [
  { title: "Check eligibility", desc: "A quick class and age check — takes under a minute." },
  { title: "Apply online",      desc: "Fill a simple 3-step form and get your reference number." },
  { title: "School review",     desc: "Track your status anytime using the reference number." },
  { title: "Visit the office",  desc: "Bring the printed form and documents to complete admission." },
] as const;

const DOCUMENTS = [
  "B-Form (NADRA)",
  "Recent passport photo",
  "Previous result card",
  "School Leaving Certificate",
  "Father / guardian CNIC copy",
] as const;

const lazySection = { contentVisibility: "auto", containIntrinsicSize: "0 360px" } as const;

function parseDay(d?: string | null): Date | null {
  if (!d) return null;
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
        {children}
      </h2>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </div>
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
}

function AdmissionHome({
  isOpen, sessionLabel, lastDate, bannerMessage, closedNote, downloading, hasLibFile,
  onApply, onTrack, onDownloadItem, onDownloadBlank, onDownloadAll, onLocked,
}: AdmissionHomeProps) {
  const [showElig, setShowElig] = useState(false);

  const last = parseDay(lastDate);
  const lastLabel = last
    ? last.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })
    : null;
  let daysLeft: number | null = null;
  if (last && isOpen) {
    const today = new Date(new Date().toDateString());
    daysLeft = Math.round((last.getTime() - today.getTime()) / 86_400_000);
  }
  const urgency =
    daysLeft === null ? null : daysLeft <= 0 ? "Last day today" : daysLeft === 1 ? "1 day left" : daysLeft <= 30 ? `${daysLeft} days left` : null;

  const guard = (fn: () => void) => () => (isOpen ? fn() : onLocked());

  return (
    <div className="container mx-auto px-4 max-w-3xl">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section
        className="relative -mx-4 sm:mx-0 sm:rounded-2xl rounded-b-3xl overflow-hidden px-5 pt-7 pb-6 sm:px-8 sm:pt-9 sm:pb-8 border-b sm:border border-gold/40"
        style={{ background: "linear-gradient(160deg, hsl(var(--primary-strong)) 0%, hsl(var(--primary)) 65%, hsl(var(--primary-dark)) 100%)" }}
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-40 bg-gradient-to-r from-transparent via-gold to-transparent" aria-hidden />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
              isOpen
                ? "bg-gold-soft text-[hsl(var(--gold-ink))] border-gold/50"
                : "bg-white/10 text-white/85 border-white/25"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isOpen ? "bg-gold" : "bg-red-400"}`} />
            {isOpen ? "Admissions Open" : "Admissions Closed"}
          </span>
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border border-white/25 text-white/85">
            Session {sessionLabel}
          </span>
          {urgency && (
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold bg-white/15 text-white border border-white/20">
              <CalendarClock className="h-3 w-3" /> {urgency}
            </span>
          )}
        </div>

        <h1
          className="text-[1.9rem] sm:text-4xl font-extrabold leading-tight text-balance"
          style={{ fontFamily: "var(--font-display)", color: "hsl(var(--primary-foreground))" }}
        >
          Admission Portal
        </h1>
        <p className="mt-2 text-sm leading-relaxed max-w-md" style={{ color: "hsl(var(--primary-foreground) / 0.8)" }}>
          Apply online in minutes. Once the school approves, print your form and complete admission at the office.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:max-w-md">
          <button
            type="button"
            onClick={guard(() => onApply())}
            aria-disabled={!isOpen}
            className={`h-10 inline-flex items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold sm:flex-1 touch-manipulation transition-opacity active:opacity-80 ${
              isOpen ? "bg-gold text-[hsl(var(--primary-strong))]" : "bg-white/15 text-white/60 cursor-not-allowed"
            }`}
          >
            {isOpen ? <GraduationCap className="h-4 w-4 shrink-0" /> : <Lock className="h-3.5 w-3.5 shrink-0" />}
            <span>Apply Now</span>
          </button>
          <button
            type="button"
            onClick={guard(onTrack)}
            aria-disabled={!isOpen}
            className={`h-10 inline-flex items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold border sm:flex-1 touch-manipulation transition-colors active:bg-white/10 ${
              isOpen ? "border-white/40 text-white" : "border-white/20 text-white/50 cursor-not-allowed"
            }`}
          >
            {isOpen ? <Search className="h-4 w-4 shrink-0" /> : <Lock className="h-3.5 w-3.5 shrink-0" />}
            <span>Track Status</span>
          </button>
        </div>

        {/* key facts */}
        <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/15 bg-white/15 text-center">
          {[
            { k: "Classes", v: "6 – 10" },
            { k: "Intake", v: "Fresh & Migration" },
            { k: isOpen ? "Last date" : "Status", v: isOpen ? lastLabel ?? "Open" : "Closed" },
          ].map((f) => (
            <div key={f.k} className="bg-black/15 px-2 py-2.5">
              <dt className="text-[10px] uppercase tracking-wider text-white/60">{f.k}</dt>
              <dd className="mt-0.5 text-[13px] font-semibold text-white leading-snug">{f.v}</dd>
            </div>
          ))}
        </dl>

        {isOpen && bannerMessage && (
          <p className="mt-3 text-xs italic leading-relaxed text-white/75">“{bannerMessage}”</p>
        )}
      </section>

      {/* ── CLOSED NOTICE ────────────────────────────────────────────────── */}
      {!isOpen && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-red-700 dark:text-red-400">Admissions are currently closed</p>
            <p className="mt-1 text-xs leading-relaxed text-red-700/80 dark:text-red-400/80">
              {closedNote} Applications, tracking, eligibility check and downloads will unlock when admissions reopen.
            </p>
          </div>
        </div>
      )}

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="mt-8" style={lazySection}>
        <SectionTitle hint="Four simple steps from home to classroom">How it works</SectionTitle>
        <ol className="relative ml-3.5 border-l border-gold/40 pl-6 space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="absolute -left-[2.35rem] top-0 flex h-7 w-7 items-center justify-center rounded-full border border-gold bg-background text-xs font-bold text-primary">
                {i + 1}
              </span>
              <p className="text-sm font-semibold text-foreground leading-snug">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── CHOOSE YOUR PATH ─────────────────────────────────────────────── */}
      <section className="mt-8" style={lazySection}>
        <SectionTitle hint="Pick the option that matches your child">Choose your path</SectionTitle>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            { type: "fresh" as AdmissionType, title: "Fresh Admission", desc: "New student joining Class 6 to 10", icon: Layers },
            { type: "migration" as AdmissionType, title: "Migration / Transfer", desc: "Moving from another school — Class 9 & 10", icon: Repeat },
          ].map((p) => (
            <button
              key={p.type}
              type="button"
              onClick={guard(() => onApply(undefined, p.type))}
              aria-disabled={!isOpen}
              className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left touch-manipulation transition-colors ${
                isOpen ? "active:bg-gold/10 hover:border-gold/60" : "opacity-60 cursor-not-allowed"
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/60 text-primary">
                <p.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{p.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{p.desc}</span>
              </span>
              {isOpen ? <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </section>

      {/* ── ELIGIBILITY (loaded on demand) ───────────────────────────────── */}
      <section className="mt-6" style={lazySection}>
        <button
          type="button"
          onClick={() => (isOpen ? setShowElig((v) => !v) : onLocked())}
          aria-expanded={showElig}
          aria-disabled={!isOpen}
          className={`flex h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 text-left touch-manipulation ${
            isOpen ? "active:bg-muted/60" : "opacity-60 cursor-not-allowed"
          }`}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-gold-strong" />
          <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-foreground">Check your eligibility</span>
          {isOpen ? (
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${showElig ? "rotate-180" : ""}`} />
          ) : (
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
        {isOpen && showElig && (
          <div className="mt-2.5">
            <Suspense fallback={<div className="h-56 rounded-xl bg-muted" aria-label="Loading eligibility checker" />}>
              <EligibilityChecker onApply={(cls, type) => onApply(cls, type)} />
            </Suspense>
          </div>
        )}
      </section>

      {/* ── DOCUMENTS NEEDED ─────────────────────────────────────────────── */}
      <section className="mt-8" style={lazySection}>
        <SectionTitle hint="Keep these ready before you visit the school office">Documents you need</SectionTitle>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          {DOCUMENTS.map((d) => (
            <li key={d} className="flex items-start gap-2 text-[13px] leading-snug text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">{d}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── DOWNLOADS ────────────────────────────────────────────────────── */}
      <section className="mt-8" style={lazySection}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>Downloads</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isOpen ? "Printable forms and guides" : "Unlock when admissions reopen"}
            </p>
          </div>
          {isOpen && (
            <button
              type="button"
              disabled={!!downloading}
              onClick={onDownloadAll}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-primary touch-manipulation active:bg-muted disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" /> Download all
            </button>
          )}
        </div>

        <div className={`overflow-hidden rounded-xl border border-border bg-card divide-y divide-border ${isOpen ? "" : "opacity-60"}`}>
          <button
            type="button"
            disabled={!!downloading}
            onClick={guard(onDownloadBlank)}
            className="flex w-full items-center gap-3 bg-gold/5 p-3.5 text-left touch-manipulation active:bg-gold/10 disabled:opacity-60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/60 text-primary">
              {downloading === "empty_form" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">Admission Form</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">Blank form — print, fill by hand and submit at the office</span>
            </span>
            {isOpen ? <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>

          {DOWNLOADS.map((d) => (
            <button
              key={d.key}
              type="button"
              disabled={!!downloading}
              onClick={guard(() => onDownloadItem(d.key))}
              className="flex w-full items-center gap-3 p-3.5 text-left touch-manipulation active:bg-muted/60 disabled:opacity-60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border text-primary">
                {downloading === d.key ? <Loader2 className="h-5 w-5 animate-spin" /> : <d.icon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{d.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{d.desc}</span>
              </span>
              {isOpen ? (
                hasLibFile(d.key)
                  ? <FileDown className="h-4 w-4 shrink-0 text-green-600" />
                  : <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* ── HELP ─────────────────────────────────────────────────────────── */}
      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        Need help with admission? Visit the school office during working hours or{" "}
        <Link to="/contact" className="font-semibold text-primary underline-offset-2 hover:underline">contact us</Link>.
      </p>

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
        <p>Documents (where applicable): B-Form (NADRA); passport size photo; previous result card; School Leaving Certificate (SLC) — required for all admissions; father's/guardian's CNIC copy. Class 9/10 migration from another Board may additionally require DMC and migration certificate (BISE requirements), submitted by the schools as part of BISEP's process.</p>
        <p>How to apply: apply online for a preliminary eligibility check. If the school approves your application, download the printable admission form, fill it, and visit the school office with your documents. For Class 9/10 migration, board-level migration is completed by the schools on the BISEP portal separately from this online application.</p>
      </section>
    </div>
  );
}

export default memo(AdmissionHome);
