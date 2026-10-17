import { lazy, Suspense, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  Upload, CheckCircle2, Search, Laptop,
  ChevronRight, ChevronLeft, Loader2, AlertCircle,
  User, BookOpen, Download, Shield, RefreshCw, XCircle,
  FileText, FileDown, MapPin, Clock, Phone, ListChecks,
  Lightbulb, GraduationCap, Users, TrendingUp, Calendar,
  Send, Eye, Edit3, Save, Trash2, Info, HelpCircle,
  ChevronDown, ArrowRight, Sparkles, X, Briefcase,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  useAdmissionSettings, useTrackAdmission,
  submitAdmission,
} from "@/hooks/useAdmission";
import { AdmissionType } from "@/hooks/useAdmission";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { supabasePublic } from "@/lib/supabase";
import toast from "react-hot-toast";
import { PushOptIn } from "@/components/shared/PushOptIn";
const ApplicationTracker = lazy(() => import("@/components/admissions/ApplicationTracker"));
const InterviewSlotBooking = lazy(() => import("@/components/admissions/InterviewSlotBooking"));
const AdmitCard = lazy(() => import("@/components/admissions/AdmitCard"));
const FeeChallan = lazy(() => import("@/components/admissions/FeeChallan"));

type View = "home" | "apply" | "track" | "success" | "eligibility";

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

// ── Downloadable documents with colored icons & file size hints ─────────
const DOWNLOAD_ITEMS = [
  {
    key: "prospectus",
    title: "Admission Prospectus",
    icon: "📖",
    iconBg: "bg-blue-500",
    desc: "Complete guide to admissions, programs & requirements",
    fileSize: "PDF, ~2 MB",
    pdfTitle: "Admission Prospectus",
    pdfSections: [
      { heading: "Welcome", body: `Welcome to our school's Admission Portal. We are committed to providing quality education and nurturing the future leaders of Pakistan. This prospectus contains general information to help you apply. Final eligibility, fees, and requirements are always confirmed by the school office and, where applicable, BISE Peshawar / the KP Elementary & Secondary Education Department.` },
      { heading: "Available Programs", body: `• Class 6–8: Fresh admission (school-level, not BISE-registered)\n• Class 9: Fresh admission — student is later enrolled with BISE Peshawar by the school\n• Class 9 & 10 Migration: For students already studying elsewhere who wish to transfer, processed as school-to-school migration on the BISE Peshawar portal\n• Class 6–8 transfer: Handled directly between schools; not a BISE board process` },
      { heading: "Preliminary Eligibility", body: `The online "Check Eligibility" tool on our website gives a preliminary, non-final indication only. It currently checks the one age rule officially published by BISE Peshawar (minimum age for Class 9 enrollment). Final eligibility for all classes depends on document verification by the school and, for Class 9/10, on BISE Peshawar's enrollment/migration rules for the relevant academic year.` },
      { heading: "Documents (where applicable)", body: `• B-Form (NADRA) — required for all applicants\n• Recent passport-size photograph — required for all applicants\n• Previous class result card / marksheet — required for all applicants where applicable\n• School Leaving Certificate (SLC) — required for ALL applicants (both Fresh Admission and Migration/Transfer), per GHS Babi Khel admission policy\n• Father's/Guardian's CNIC copy — required for all applicants\n• For Class 9/10 migration from another BISE-affiliated school ONLY: DMC, migration certificate from the previous Board, and enrollment/reference letter from the previous school's head — submitted by the schools to BISE Peshawar as part of the portal migration, per current BISEP notification requirements` },
      { heading: "How Admission Works", body: `Online:\n1. Fill the online eligibility application on our website\n2. Receive a reference number for tracking\n3. School reviews your application and documents\n4. If approved, download the printable form, fill it, attach documents, and bring them to the school office to complete enrollment\n\nOffline (at the school office):\n1. Download and print the Admission Application Form from our website\n2. Fill it by hand and attach photocopies of required documents\n3. Submit it in person at the school office\n\nFor Class 9/10 migration specifically: school-level approval of your application is separate from the BISE Peshawar school-to-school migration on their portal, which is carried out by the schools within BISEP's notified migration window for the academic year — it is not completed simply by submitting our online form.` },
      { heading: "Important Notes", body: `• Keep your reference number safe after submission\n• Ensure all documents are clear and legible\n• Admission is subject to availability of seats and school/BISE Peshawar approval\n• The school reserves the right to reject incomplete applications\n• All information provided must be accurate — false information may result in rejection or cancellation` },
    ],
  },
  {
    key: "fee_structure",
    title: "Fee Structure",
    icon: "💰",
    iconBg: "bg-green-500",
    desc: "Tuition fees, BISE charges & payment details",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "Fee Structure",
    pdfSections: [
      { heading: "School Fee Policy", body: `Government High Schools in KPK operate under the free education policy. There are generally no tuition fees for regular students. Any school-level charges (if applicable) are confirmed at the school office, as these can vary by session and are not fixed centrally.` },
      { heading: "BISE Peshawar Charges (Class 9 & 10)", body: `Any applicable BISE Peshawar fees (enrollment, migration, or related charges) are subject to the current Board notification/fee schedule for the academic session. Fee amounts can vary and are set by BISE Peshawar — please confirm the current amounts and deadlines with the school office or directly with BISEP before making any payment. Fees are paid through the Board's designated payment channels (e.g., bank/branchless banking), not to the school directly.` },
      { heading: "Migration / Related BISEP Charges", body: `Where BISE Peshawar migration or related processes apply (Class 9 & 10 only), any applicable Board fees are subject to the current BISEP notification for that academic session. These may include enrollment fees, migration processing fees, or correction charges as notified by the Board. Always confirm current amounts with the school office or BISEP before payment — this prospectus does not list specific amounts since they are set by the Board and may change each session.` },
      { heading: "Payment Method", body: `• BISE Peshawar charges: paid through the board's designated payment channels (e.g., bank/branchless banking, as notified by BISEP for the session) — computer-generated receipts only\n• Any school-level charges (if applicable): paid at the school office during working hours\n• Fee concessions, where available, are considered case-by-case by the school` },
    ],
  },
  {
    key: "migration_template",
    title: "School-to-School Transfer Reference Letter",
    icon: "✉️",
    iconBg: "bg-amber-500",
    desc: "Reference letter template to request transfer records from your current school",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "School-to-School Transfer Reference Letter",
    pdfSections: [
      { heading: "Important — please read first", body: `This is a reference/consent letter you can use to formally inform your current school of your intent to transfer, and to request your School Leaving Certificate. For Class 9 & 10, the actual migration is completed by the two schools directly on the BISE Peshawar portal, within BISEP's notified migration window for the academic year — this letter supports that process but does not itself complete migration. It does not need signatures from both principals unless your current school specifically requires it as part of its own internal process.` },
      { heading: "Reference Letter Template", body: `From: ___________________ (Parent/Guardian Name)\nFather/Guardian of: ___________________ (Student Name)\nCurrent Class: ___________________\nB-Form No: ___________________\n\nTo,\nThe Head of Institution,\n___________________ (Current School Name),\n___________________ (Current School Address)\n\nSubject: Request for School Leaving Certificate & Transfer Records\n\nRespected Sir/Madam,\n\nWith due respect, I wish to transfer my son/daughter ___________________ (B-Form No: ____________), currently studying in Class _____ at your institution, to ___________________ (New School Name, District Mohmand). I request that the School Leaving Certificate and relevant academic records be issued, and — where the class requires BISE Peshawar migration — that the school-to-school migration be initiated on the BISEP portal at your convenience within the current migration window.\n\nI shall be grateful for your cooperation.\n\nDate: _______________\n\nSignature of Parent/Guardian: _______________\n\n--- For School Office Use ---\nReceived by (Current School): _______________  Date: _______________\nSLC Issued: ☐ Yes ☐ Pending   BISEP Migration Initiated (if applicable): ☐ Yes ☐ N/A` },
    ],
  },
  {
    key: "rules",
    title: "Admission Rules",
    icon: "📏",
    iconBg: "bg-red-500",
    desc: "Admission policies, eligibility & procedures",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "Admission Rules & Regulations",
    pdfSections: [
      { heading: "General Rules", body: `1. Admission is open to all eligible students regardless of gender, religion, or ethnicity.\n2. Applications can be submitted online through the school portal, or by downloading the admission form and submitting it in person at the school office.\n3. Incomplete applications will not be considered.\n4. All information provided must be accurate. False information may result in rejection or cancellation of admission.\n5. The school reserves the right to accept or reject any application, subject to seat availability and applicable rules.` },
      { heading: "Age Requirement", body: `The only numeric age rule we can currently confirm from an official source is BISE Peshawar's published minimum age for Class 9 enrollment: a candidate must be at least 12 years old (i.e. not "above 12 years" short of the minimum) as of the date specified in that session's enrollment notification. For Classes 6, 7, 8, and 10, age suitability is assessed by the school office according to current KP Elementary & Secondary Education Department policy at the time of admission — we do not publish a fixed age table for these classes here, since it can vary by policy/session; please confirm with the school office.` },
      { heading: "Migration / Transfer Rules (Class 9 & 10)", body: `1. Board-level migration on the BISE Peshawar portal applies to Class 9 and Class 10 students moving between BISE-Peshawar-affiliated institutions, or between boards.\n2. A valid School Leaving Certificate from the previous school is required.\n3. Migration (school-to-school) is carried out on the BISEP portal by the sending and receiving schools, within the board's notified migration window for the academic year (typically from declaration of the SSC Annual-I result through 31 December) — it is not completed by the parent/student submitting a form to BISEP directly.\n4. For students migrating from another Board, the receiving school submits the student's DMC, migration certificate, and a reference/enrollment letter from the previous school's head to BISE Peshawar, along with the prescribed fee.\n5. Any applicable BISEP fee is paid through the board's designated channels.\n6. For Class 6–8, a transfer between schools is handled at the school level and does not go through the BISE Peshawar portal.` },
      { heading: "Document Requirements", body: `• B-Form (NADRA) is required for all applicants.\n• Passport size photograph should be recent.\n• Result card from the previous class should be from a recognized board/school (where applicable).\n• School Leaving Certificate (SLC) is REQUIRED for ALL admissions — both Fresh Admission and Migration/Transfer — per GHS Babi Khel admission policy. This is our school's standard requirement.\n• Father's/Guardian's CNIC copy should be valid and legible.\n• For Class 9/10 migration from another Board ONLY: additionally requires DMC, migration certificate, and enrollment/reference letter as listed under Migration Rules above. These are BISE-specific requirements, separate from our school's SLC requirement.` },
      { heading: "Cancellation Policy", body: `• Admission can be cancelled if documents are found to be forged or inaccurate.\n• Admission can be cancelled if the student fails to attend classes within the period set by the school after confirmation.\n• A pending migration case may lapse if BISEP's portal procedures/window are not completed by the relevant deadline.\n• Any fee refund (where applicable) follows the school's or BISE Peshawar's own refund policy, as relevant.` },
    ],
  },
] as const;

// ── Custom realistic SVG icons (Enhanced Professional Version) ────────────────

// ── Simple Real Icons using Lucide (Standard Icon Library) ────────────────

/**
 * Apply Online Icon - Standard Laptop icon
 */
const ApplyOnlineIcon = Laptop;

/**
 * Track Application Icon - Standard Search icon
 */
const TrackApplicationIcon = Search;

/**
 * Apply Now / Graduation Cap Icon - Standard GraduationCap icon
 */
const ApplyNowIcon = GraduationCap;

/* Perf: the hero banner's blurred glow blobs animate forever
   (repeat: Infinity) the instant the page loads, combined with the
   expensive blur-3xl CSS filter — a real contributor to the page
   feeling stuck on lower-end phones. This gates them behind the
   OS-level "reduce motion" setting; the glows stay visible, just
   static instead of endlessly animating, when that's on. */
function PrintableFormIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      {/* Paper sheet - white with subtle shadow */}
      <path d="M6 2H14.5L19 6.5V20.5C19 21.05 18.55 21.5 18 21.5H6C5.45 21.5 5 21.05 5 20.5V3C5 2.95 5.45 2.5 6 2Z"
        fill="white" stroke="#DC2626" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* Folded corner - red accent */}
      <path d="M14.5 2V6.5H19" fill="#FEE2E2" stroke="#DC2626" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* Header bar on paper - red */}
      <rect x="7" y="4.5" width="10" height="1.5" rx="0.4" fill="#DC2626"/>
      {/* Form lines - realistic text lines */}
      <rect x="7" y="8" width="10" height="1" rx="0.3" fill="#374151" opacity="0.7"/>
      <rect x="7" y="10.5" width="8" height="0.9" rx="0.3" fill="#374151" opacity="0.4"/>
      <rect x="7" y="12.8" width="9" height="0.9" rx="0.3" fill="#374151" opacity="0.4"/>
      <rect x="7" y="15.1" width="6" height="0.9" rx="0.3" fill="#374151" opacity="0.4"/>
      {/* Download arrow circle - green accent */}
      <circle cx="16.5" cy="17.5" r="4" fill="#10B981" stroke="#059669" strokeWidth="1"/>
      <path d="M16.5 15V19M14.5 17L16.5 19L18.5 17" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 10.5V7.5C8 5.01472 10.0147 3 12.5 3C14.9853 3 17 5.01472 17 7.5V10.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
      <path d="M12 16.4V18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

// ── Animated counter component ────────────────────────────────────────────────
function AnimatedCounter({ end, label, icon: Icon }: { end: number; label: string; icon: any }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const duration = 1500;
    const stepTime = 30;
    const steps = duration / stepTime;
    const increment = end / steps;
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, stepTime);
    return () => clearInterval(timer);
  }, [visible, end]);

  return (
    <div ref={ref} className="text-center">
      <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mx-auto mb-2">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-2xl sm:text-3xl font-bold text-white">{count.toLocaleString()}+</p>
      <p className="text-xs text-white/70 mt-1">{label}</p>
    </div>
  );
}

// ── Age eligibility criteria per class (official school standards) ────────
const AGE_CRITERIA: Record<string, { min: number; max: number }> = {
  "6": { min: 10, max: 11 },   // Class 6: 10–11 years
  "7": { min: 11, max: 12 },   // Class 7: 11–12 years
  "8": { min: 12, max: 13 },   // Class 8: 12–13 years
  "9": { min: 12, max: 14 },   // Class 9: 12–14 years
  "10": { min: 13, max: 15 },  // Class 10: 13–15 years
};

// ── Eligibility Checker Component ─────────────────────────────────────────────
function EligibilityChecker({ onApply }: { onApply: (cls: string, type: AdmissionType) => void }) {
  const [cls, setCls] = useState("");
  const [admissionType, setAdmissionType] = useState<AdmissionType>("fresh");
  const [dob, setDob] = useState("");
  const [result, setResult] = useState<{ eligible: boolean; reasons: string[] } | null>(null);

  const checkEligibility = () => {
    const reasons: string[] = [];
    if (!cls) { toast.error("Select a class"); return; }

    // Age check — per-class age eligibility as per school admission policy
    if (dob) {
      const ageMs = Date.now() - new Date(dob).getTime();
      const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
      const criteria = AGE_CRITERIA[cls];
      if (criteria) {
        if (age < criteria.min) {
          reasons.push(`Minimum age for Class ${cls} enrollment is ${criteria.min} years. Recorded age is ${age} years.`);
        } else if (age > criteria.max) {
          reasons.push(`Maximum age for Class ${cls} enrollment is ${criteria.max} years. Recorded age is ${age} years.`);
        }
      }
    } else {
      reasons.push(`Please enter your date of birth so the school can verify age eligibility for Class ${cls}.`);
    }

    // Migration class check
    if (admissionType === "migration" && !["9", "10"].includes(cls)) {
      reasons.push(`BISE Peshawar board-level migration (school-to-school) applies to Class 9 and Class 10 only. For Class 6–8, a school transfer is handled directly between schools, not through the BISE portal.`);
    }

    setResult({ eligible: reasons.length === 0, reasons });
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-card p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <h3 className="font-bold text-foreground text-xs">Preliminary Eligibility Check</h3>
        <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-bold ml-auto">Quick Check</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2.5">
        Final eligibility always depends on document verification by the school office.
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Applying for Class *</Label>
          <Select value={cls} onValueChange={setCls}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {["6","7","8","9","10"].map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Admission Type *</Label>
          <Select value={admissionType} onValueChange={v => setAdmissionType(v as AdmissionType)}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fresh">Fresh Admission</SelectItem>
              {["9", "10"].includes(cls) && <SelectItem value="migration">Migration / Transfer</SelectItem>}
            </SelectContent>
          </Select>
          {!['9', '10'].includes(cls) && cls && (
            <p className="text-[9px] text-muted-foreground mt-1">Note: For Class {cls}, only Fresh Admission is available. School-level transfers are handled directly between schools.</p>
          )}
        </div>
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Date of Birth</Label>
          <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="h-9 text-xs" />

        </div>
        <Button onClick={checkEligibility} className="w-full gap-2 rounded-xl h-9 text-xs">
          <Search className="w-3.5 h-3.5" /> Check Now
        </Button>
      </div>

      {result && (
        <div
          className={`mt-3 rounded-xl p-3 border ${
            result.eligible
              ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900"
              : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
          }`}>
          {result.eligible ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <p className="font-bold text-sm text-green-700 dark:text-green-400">Likely eligible — preliminary result</p>
              </div>
              <p className="text-xs text-green-700 dark:text-green-400 mb-3">
                Based on the information provided, there's no obvious issue for Class {cls} ({admissionType} admission). This is not final — the school office will confirm eligibility after reviewing your documents. Apply now to get started!
              </p>
              <Button onClick={() => onApply(cls, admissionType)} className="w-full gap-2 rounded-xl h-9 text-xs">
                <ArrowRight className="w-3.5 h-3.5" /> Apply for Class {cls}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <p className="font-bold text-sm text-red-700 dark:text-red-400">Possible issue found</p>
              </div>
              <ul className="space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-400 flex items-start gap-1.5">
                    <span className="mt-0.5">•</span> {r}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-red-600/80 dark:text-red-400/70 mt-2">
                You may still contact the school office directly, as exceptional or hardship cases are handled case-by-case per current policy.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Visual Progress Stepper ───────────────────────────────────────────────────
function StepStepper({ step, totalSteps }: { step: number; totalSteps: number }) {
  const stepLabels = ["Student Info", "Academic Info", "Review & Submit"];
  return (
    <div className="flex items-center justify-center gap-0 mb-8 px-2">
      {stepLabels.map((s, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === step;
        const isDone = stepNum < step;
        return (
          <div key={i} className="flex items-center">
            <div
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full text-xs font-bold transition-all ${
                isActive ? "bg-primary text-white shadow-lg shadow-primary/30" :
                isDone  ? "bg-green-500 text-white" :
                "bg-muted text-muted-foreground"
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                isDone ? "bg-white text-green-600" : isActive ? "bg-white/30 text-white" : "bg-muted-foreground/20"
              }`}>
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : stepNum}
              </div>
              <span className="hidden sm:inline">{s}</span>
            </div>
            {i < totalSteps - 1 && (
              <div className={`h-0.5 w-4 sm:w-8 mx-1 rounded transition-colors ${isDone ? "bg-green-400" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tooltip wrapper ───────────────────────────────────────────────────────────
function FieldTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex ml-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="w-4 h-4 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-primary/20 hover:text-primary transition-colors"
      >
        <Info className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute z-50 top-6 left-0 bg-popover border border-border rounded-lg shadow-lg p-2 text-[11px] text-popover-foreground max-w-[200px] whitespace-normal">
          {text}
        </div>
      )}
    </span>
  );
}

function formatSlotTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function TrackResult({ result }: { result: any }) {
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

// ── Save/Load draft from localStorage ─────────────────────────────────────────
const DRAFT_KEY = "ghs_admission_draft";
function saveDraft(form: any) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, savedAt: Date.now() })); } catch { /* intentional */ }
}
function loadDraft(): any | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.savedAt > 7 * 24 * 60 * 60 * 1000) { localStorage.removeItem(DRAFT_KEY); return null; }
    return d.form;
  } catch { return null; }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* intentional */ } }

/* ══ MAIN PAGE ══════════════════════════════════════════════════════════════ */
const Admission = () => {
  const { data: settings } = useAdmissionSettings();
  const { data: school }   = useSchoolSettings();

  const isEffectivelyOpen = (() => {
    if (!settings?.is_open) return false;
    if (!settings.last_date) return true;
    return new Date(settings.last_date) >= new Date(new Date().toDateString());
  })();

  // Format session year as "2026-27" style from stored value like "2026"
  const displaySessionYear = useMemo(() => {
    const raw = settings?.session_year || String(new Date().getFullYear() + 1);
    // If it's a 4-digit year like "2026", convert to "2026-27" format
    if (/^\d{4}$/.test(raw)) {
      return `${raw}-${String(parseInt(raw) + 1).slice(-2)}`;
    }
    return raw;
  }, [settings?.session_year]);

  const nextOpeningNote = (() => {
    if (isEffectivelyOpen) return null;
    const today = new Date(new Date().toDateString());
    if (settings?.open_date && new Date(settings.open_date) > today) {
      try { return `Next session opens ${new Date(settings.open_date).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}.`; } catch { return null; }
    }
    return `Applications are not being accepted at this time. Please check back later.`;
  })();

  // Deep-link support for SPA navigation: the homepage's "My Tracking" CTA
  // navigates here with router state { view: "track" } instead of forcing a
  // full page reload, so the visitor lands directly in the tracking view.
  const location = useLocation();
  const [view, setView]           = useState<View>(
    (() => {
      const state = location.state as { view?: View } | null;
      return state?.view === "track" || state?.view === "apply" || state?.view === "eligibility"
        ? state.view
        : "home";
    })()
  );
  const [step, setStep]           = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [trackQuery, setTrackQuery]   = useState("");
  const [doTrack, setDoTrack]         = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const defaultForm = {
    full_name: "", father_name: "", date_of_birth: "", b_form_no: "",
    contact_number: "", whatsapp_number: "", home_address: "", gender: "",
    applying_class: "", admission_type: "fresh" as AdmissionType,
    previous_school: "", previous_class: "", previous_marks: "", year_of_passing: "",
    father_cnic: "", occupation: "",
  };

  const [form, setForm] = useState(() => {
    const draft = loadDraft();
    return draft || defaultForm;
  });
  const [hasDraft, setHasDraft] = useState(() => !!loadDraft());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isMigration = form.admission_type === "migration";

  // ── Math CAPTCHA ─────────────────────────────────────────────────────────
  // Harder than plain single-digit addition: two-digit numbers combined with
  // a randomly chosen operator (+, -, ×), so the answer isn't guessable at a glance.
  const [captchaQ, setCaptchaQ] = useState<{ a: number; b: number; op: "+" | "-" | "×" }>({ a: 0, b: 0, op: "+" });
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);

  const captchaAnswer = (a: number, b: number, op: "+" | "-" | "×") =>
    op === "+" ? a + b : op === "-" ? a - b : a * b;

  const newCaptcha = useCallback(() => {
    const ops: Array<"+" | "-" | "×"> = ["+", "-", "×"];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a: number, b: number;
    if (op === "×") {
      // Keep multiplication in a friendly-but-nontrivial range (2–12)
      a = Math.floor(Math.random() * 11) + 2;
      b = Math.floor(Math.random() * 11) + 2;
    } else if (op === "-") {
      // Ensure a non-negative, two-digit-scale result
      a = Math.floor(Math.random() * 41) + 20; // 20–60
      b = Math.floor(Math.random() * 20) + 1;  // 1–20
    } else {
      a = Math.floor(Math.random() * 41) + 10; // 10–50
      b = Math.floor(Math.random() * 41) + 10; // 10–50
    }
    setCaptchaQ({ a, b, op });
    setCaptchaInput("");
    setCaptchaError(false);
  }, []);

  useEffect(() => { if (step === 3) newCaptcha(); }, [step, newCaptcha]);

  // ── Library files (admin-uploaded) ───────────────────────────────────────
  const [libFiles, setLibFiles] = useState<Record<string, { url: string; id: string }>>({});
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabasePublic.from("library_files").select("id, title, file_url").ilike("category", "Admission");
        if (data?.length) {
          const map: Record<string, { url: string; id: string }> = {};
          for (const f of data) {
            const t = (f.title || "").toLowerCase();
            if (t.includes("prospectus")) map.prospectus = { url: f.file_url, id: f.id };
            else if (t.includes("fee")) map.fee_structure = { url: f.file_url, id: f.id };
            else if (t.includes("migration")) map.migration_template = { url: f.file_url, id: f.id };
            else if (t.includes("rule")) map.rules = { url: f.file_url, id: f.id };
          }
          setLibFiles(map);
        }
      } catch { /* intentional */ }
    })();
  }, []);

  // ── Save draft on form change ───────────────────────────────────────────
  useEffect(() => {
    const hasContent = Object.values(form).some(v => v && v !== "fresh");
    if (hasContent && view === "apply") { saveDraft(form); setHasDraft(true); }
  }, [form, view]);

  // ── Generate and download PDF ───────────────────────────────────────────
  const generateAndDownload = useCallback(async (item: typeof DOWNLOAD_ITEMS[number]) => {
    setDownloading(item.key);
    try {
      const libFile = libFiles[item.key];
      if (libFile?.url) {
        try {
          const resp = await fetch(libFile.url);
          if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `${item.title}.pdf`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success(`Downloaded ${item.title}`);
            try { await supabasePublic.rpc("increment_download_count", { file_id: libFile.id }); } catch { /* intentional */ }
            return;
          }
        } catch { /* intentional */ }
        window.open(libFile.url, "_blank");
        toast.success(`Opening ${item.title}`);
        try { await supabasePublic.rpc("increment_download_count", { file_id: libFile.id }); } catch { /* intentional */ }
        return;
      }

      const schoolName = school?.school_name || "GHS Babi Khel";
      const tagline = school?.tagline || "Excellence in Education";
      const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
      const logoUrl = school?.logo_url || "";
      const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

      // Distinct accent color per document, echoing each card's icon color
      // on the site (blue = Prospectus, green = Fee Structure, amber =
      // Transfer template, red = Rules) so each PDF feels purpose-built
      // rather than a single generic template reused four times.
      const ACCENTS: Record<string, { main: string; dark: string; soft: string; text: string }> = {
        prospectus:         { main: "#3b82f6", dark: "#1d4ed8", soft: "#eff6ff", text: "#1e40af" },
        fee_structure:       { main: "#15803D", dark: "#14532D", soft: "#F0F7F1", text: "#14532D" },
        migration_template:  { main: "#f59e0b", dark: "#b45309", soft: "#fffbeb", text: "#92400e" },
        rules:               { main: "#ef4444", dark: "#b91c1c", soft: "#fef2f2", text: "#991b1b" },
      };
      const accent = ACCENTS[item.key] || { main: "#B8860B", dark: "#8A6508", soft: "#F5E6C4", text: "#14532D" };

      const sectionsHtml = item.pdfSections.map((s, i) => `
        <div style="margin-bottom:18px;page-break-inside:avoid;">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;">
            <span style="flex-shrink:0;width:22px;height:22px;border-radius:7px;background:${accent.main};color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;">${i + 1}</span>
            <h3 style="font-size:14.5px;font-weight:800;color:${accent.text};margin:0;letter-spacing:0.2px;">${s.heading}</h3>
          </div>
          <p style="font-size:12px;line-height:1.75;color:#334155;white-space:pre-wrap;margin:0 0 0 31px;padding:10px 14px;background:${accent.soft};border-left:3px solid ${accent.main};border-radius:0 8px 8px 0;">${s.body}</p>
        </div>`).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${item.pdfTitle}</title>
        <style>
          @page { margin: 18mm 16mm; size: A4; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; }

          .topband { height: 7px; background: linear-gradient(90deg, ${accent.dark} 0%, ${accent.main} 55%, #f0a55f 100%); border-radius: 0 0 4px 4px; margin-bottom: 16px; }

          .header { display: flex; align-items: center; gap: 13px; border-bottom: 3px solid ${accent.main}; padding-bottom: 13px; margin-bottom: 18px; }
          .logo-wrap { width: 54px; height: 54px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
          .logo-wrap img { width: 100%; height: 100%; object-fit: cover; }
          .header-text { flex: 1; }
          .school-name { font-size: 20px; font-weight: 800; color: #0E3B20; letter-spacing: 0.3px; font-family: Georgia, 'Times New Roman', serif; }
          .tagline { font-size: 10.5px; color: ${accent.text}; font-weight: 600; margin-top: 2px; letter-spacing: 0.4px; }
          .address { font-size: 9.5px; color: #94a3b8; margin-top: 3px; }

          .doc-title-wrap { text-align: center; margin: 6px 0 20px; }
          .doc-title { display: inline-block; font-size: 16.5px; font-weight: 800; color: #ffffff; padding: 9px 26px; background: linear-gradient(135deg, ${accent.dark}, ${accent.main}); border-radius: 999px; letter-spacing: 0.3px; }

          .footer { text-align: center; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 26px; font-size: 8.5px; color: #94a3b8; }
          .footer span { color: ${accent.text}; font-weight: 700; }
        </style></head><body>

        <div class="topband"></div>

        <div class="header">
          <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:20px;">🏫</span>`}</div>
          <div class="header-text">
            <div class="school-name">${schoolName}</div>
            <div class="tagline">${tagline}</div>
            <div class="address">${address}</div>
          </div>
        </div>

        <div class="doc-title-wrap"><span class="doc-title">${item.pdfTitle}</span></div>

        ${sectionsHtml}

        <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; ${window.location.origin}</div>
      </body></html>`;

      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(html); printWin.document.close();
        printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
        toast.success(`Generating ${item.title} — use Save as PDF in print dialog`);
      } else {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `${item.title}.html`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast.success(`Downloaded ${item.title}`);
      }
    } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
    finally { setDownloading(null); }
  }, [libFiles, school]);

  // ── Generate offline admission form ─────────────────────────────────────
  const generateFilledForm = useCallback(() => {
    setDownloading("filled_form");
    try {
      const schoolName = school?.school_name || "GHS Babi Khel";
      const tagline = school?.tagline || "Excellence in Education";
      const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
      const logoUrl = school?.logo_url || "";
      const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

      const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // Pre-filled underline field — shows the applicant's entered value instead of a blank line.
      // Plain block-level markup (no tables) so the print/PDF renderer can't
      // double-paint nested table rows — label sits above the underline.
      const line = (labelText: string, value: string, _widthPct?: number, required = false) =>
        `<div style="margin-bottom:10px;">
          <div style="font-size:9.5px;font-weight:600;color:#0E3B20;text-transform:uppercase;letter-spacing:0.2px;margin-bottom:3px;">${labelText}${required ? ' <span style="color:#B8860B;">*</span>' : ''}</div>
          <div style="font-size:11px;font-weight:600;color:#1e293b;border-bottom:1.5px solid #94a3b8;padding-bottom:3px;min-height:15px;">${esc(value) || "&nbsp;"}</div>
        </div>`;

      const lineRow = (fields: string[]) =>
        `<div style="display:flex;gap:16px;">${fields.map(f => `<div style="flex:1;min-width:0;">${f}</div>`).join("")}</div>`;
      // Checkbox that renders filled/checked when it matches the applicant's selection
      const checkbox = (labelText: string, checked = false) => `
        <span style="display:inline-flex;align-items:center;gap:7px;margin:0 20px 10px 0;font-size:12px;color:#1e293b;font-weight:500;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border:1.6px solid #0E3B20;border-radius:4px;flex-shrink:0;background:${checked ? "#0E3B20" : "transparent"};color:#fff;font-size:11px;font-weight:800;line-height:1;">${checked ? "✓" : ""}</span>${labelText}
        </span>`;

      const docChecklist = [
        "B-Form (NADRA) — Required for all applicants",
        "Recent Passport Size Photo — Required for all applicants",
        "Previous Result Card / Marksheet — Required where applicable",
        "School Leaving Certificate (SLC) — REQUIRED for all applicants (Fresh Admission & Migration/Transfer), per GHS Babi Khel policy",
        "Father's/Guardian's CNIC Copy — Required for all applicants",
        "DMC & Migration Certificate from previous Board — Class 9/10 migration from another Board only (BISE requirement), submitted by schools",
      ].map(d => `<li style="margin-bottom:6px;">${d}</li>`).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admission Application Form</title>
        <style>
          @page { margin: 14mm 16mm; size: A4; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.5; }

          /* ── Decorative top band ── */
          .topband { height: 8px; background: linear-gradient(90deg, #0E3B20 0%, #14532D 45%, #B8860B 100%); border-radius: 0 0 4px 4px; margin-bottom: 16px; }

          /* ── Header ── */
          .header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #0E3B20; padding-bottom: 14px; margin-bottom: 18px; }
          .logo-wrap { width: 58px; height: 58px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
          .logo-wrap img { width: 100%; height: 100%; object-fit: cover; }
          .header-text { flex: 1; }
          .school-name { font-size: 22px; font-weight: 800; color: #0E3B20; letter-spacing: 0.3px; font-family: Georgia, 'Times New Roman', serif; }
          .tagline { font-size: 11px; color: #B8860B; font-weight: 600; margin-top: 2px; letter-spacing: 0.5px; }
          .address { font-size: 9.5px; color: #94a3b8; margin-top: 3px; }
          .header-badge { text-align: right; font-size: 9px; color: #64748b; }
          .header-badge .yr { font-size: 13px; font-weight: 800; color: #0E3B20; }

          .doc-title-wrap { text-align: center; margin: 4px 0 8px; }
          .doc-title { display: inline-block; font-size: 17px; font-weight: 800; color: #ffffff; padding: 9px 28px; background: linear-gradient(135deg, #0E3B20, #14532D); border-radius: 999px; letter-spacing: 0.4px; }
          .doc-sub { font-size: 10.5px; color: #64748b; text-align: center; margin: 8px 0 18px; font-style: italic; }
          .intro-row { display: flex; align-items: flex-start; justify-content: center; gap: 18px; margin: 8px 0 20px; flex-wrap: wrap; }
          .intro-text { flex: 1; min-width: 200px; max-width: 420px; }

          .section-title { font-size: 12.5px; font-weight: 800; color: #0E3B20; margin: 20px 0 10px; padding: 6px 12px; background: #F5E6C4; border-left: 4px solid #B8860B; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.4px; }

          .note { font-size: 10px; color: #475569; background: #FDFBF2; border: 1px dashed #f0a55f; border-radius: 6px; padding: 9px 12px; margin-top: 6px; }

          .photo-box { flex-shrink: 0; width: 92px; height: 110px; border: 1.6px dashed #94a3b8; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #94a3b8; text-align: center; padding: 6px; }

          .footer { text-align: center; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 24px; font-size: 8.5px; color: #94a3b8; }
          .footer span { color: #0E3B20; font-weight: 700; }

          .officebox { border: 1.6px dashed #B8860B; border-radius: 8px; padding: 12px 14px; margin-top: 16px; background: #FDFBF2; }
          .officebox .t { font-size: 10.5px; font-weight: 800; color: #B8860B; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.4px; }

          .declaration { font-size: 10px; color: #475569; border: 1px solid #e5d9c6; border-radius: 6px; padding: 10px 12px; margin-top: 16px; background: #fbf6ec; }

          .signrow { display: flex; justify-content: space-between; margin-top: 30px; }
          .signrow .sig { width: 46%; text-align: center; }
          .signrow .sig .l { border-top: 1.4px solid #64748b; padding-top: 5px; font-size: 9.5px; color: #64748b; }
        </style></head><body>

        <div class="topband"></div>

        <div class="header">
          <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:22px;">🏫</span>`}</div>
          <div class="header-text">
            <div class="school-name">${schoolName}</div>
            <div class="tagline">${tagline}</div>
            <div class="address">${address}</div>
          </div>
          <div class="header-badge">Session<br/><span class="yr">2026–27</span></div>
        </div>

        <div class="doc-title-wrap"><span class="doc-title">Admission Application Form</span></div>
        <div class="intro-row">
          <div class="intro-text"><div class="doc-sub" style="margin:0;">Pre-filled with the details you submitted online. Please review, sign, and submit it in person at the school office.</div></div>
          <div class="photo-box">Attach<br/>Passport<br/>Size Photo<br/>Here</div>
        </div>

        <div class="section-title">1&nbsp; &nbsp;Student Information</div>
        ${line("Full Name", form.full_name, undefined, true)}
        ${line("Father Name", form.father_name, undefined, true)}
        ${line("B-Form Number", form.b_form_no, undefined, true)}
        ${lineRow([line("Contact Number (WhatsApp)", form.contact_number, undefined, true), line("WhatsApp (if different)", form.whatsapp_number)])}
        ${line("Home Address (Village / Mohalla)", form.home_address)}
        ${line("Father's CNIC", form.father_cnic, undefined, true)}
        ${line("Occupation", form.occupation)}
        ${line("Date of Birth", form.date_of_birth)}
        <div style="margin:6px 0 16px;clear:both;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Gender <span style="color:#B8860B;">*</span></div>${checkbox("Male", form.gender === "male")}${checkbox("Female", form.gender === "female")}</div>

        <div class="section-title">2&nbsp; &nbsp;Academic Information</div>
        <div style="margin:6px 0 14px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Applying for Class <span style="color:#B8860B;">*</span></div>${["6","7","8","9","10"].map(c => checkbox(`Class ${c}`, form.applying_class === c)).join("")}</div>
        <div style="margin:6px 0 16px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Admission Type <span style="color:#B8860B;">*</span></div>${checkbox("Fresh Admission", form.admission_type === "fresh")}${checkbox("Migration / Transfer (Class 9 & 10 only)", form.admission_type === "migration")}</div>
        <div class="note" style="margin-bottom:14px;">Important: At GHS Babi Khel, School Leaving Certificate (SLC) AND previous-school information are required for BOTH Fresh Admission and Migration/Transfer. All four fields below are required for all applicants.</div>
        ${line("Previous School Name", form.previous_school)}
        ${lineRow([line("Previous Class", form.previous_class), line("Previous Marks / Grade (%)", form.previous_marks)])}
        ${line("Year of Passing", form.year_of_passing)}

        <div class="section-title">3&nbsp; &nbsp;Documents to Attach</div>
        <ul style="font-size:11.5px;color:#334155;padding-left:20px;line-height:1.6;">${docChecklist}</ul>
        <div class="note">📎 Attach photocopies of the above documents with this form. Originals may be asked for verification at the office. For Class 9/10 migration, board-level migration on the BISE Peshawar portal is completed by the schools separately and is not finished simply by submitting this form.</div>

        <div class="declaration">
          <strong>Declaration:</strong> I/We declare that the information provided in this form is true and correct to the best of my/our knowledge. I/We understand that admission may be cancelled if any information is found to be false, and that final admission is subject to verification of documents and applicable school/BISE Peshawar rules.
        </div>

        <div class="signrow">
          <div class="sig"><div class="l">Signature of Parent / Guardian</div></div>
          <div class="sig"><div class="l">Date</div></div>
        </div>

        <div class="officebox">
          <div class="t">✦ For Office Use Only</div>
          ${lineRow([line("Reference No.", ""), line("Received By", "")])}
          ${lineRow([line("Date Received", ""), line("Status", "")])}
        </div>

        <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; Submit this form in person at the school office &bull; ${window.location.origin}</div>
      </body></html>`;

      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(html); printWin.document.close();
        printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
        toast.success("Generating Admission Form — use Save as PDF in print dialog");
      } else {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "Admission Application Form.html";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast.success("Downloaded Admission Application Form");
      }
    } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
    finally { setDownloading(null); }
  }, [school, form]);

  // ── Generate EMPTY admission form (for Downloads section) ──────────────────
  const generateEmptyForm = useCallback(() => {
    setDownloading("empty_form");
    try {
      const schoolName = school?.school_name || "GHS Babi Khel";
      const tagline = school?.tagline || "Excellence in Education";
      const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
      const logoUrl = school?.logo_url || "";
      const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

      const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // Helper functions for PDF layout — plain block markup (no tables) so
      // the print/PDF renderer can't double-paint nested rows.
      const line = (label: string, value?: string | null, _w?: number, req = false) =>
        `<div style="margin-bottom:10px;">
          <div style="font-size:9px;font-weight:600;color:#0E3B20;text-transform:uppercase;letter-spacing:0.2px;margin-bottom:3px;">${esc(label)}${req ? ' <span style="color:#B8860B;">*</span>' : ''}</div>
          <div style="font-size:10.5px;color:#1e293b;border-bottom:1px solid #94a3b8;padding-bottom:3px;min-height:14px;">${esc(value) || "&nbsp;"}</div>
        </div>`;

      const lineRow = (fields: string[]) =>
        `<div style="display:flex;gap:16px;">${fields.map(f => `<div style="flex:1;min-width:0;">${f}</div>`).join("")}</div>`;

      const checkbox = (label: string, checked: boolean) =>
        `<span style="display:inline-flex;align-items:center;margin-right:14px;font-size:10.5px;color:#334155;"><span style="width:13px;height:13px;border:2px solid #94a3b8;border-radius:3px;margin-right:5px;display:inline-flex;align-items:center;justify-content:center;background:${checked ? '#10B981' : 'transparent'};border-color:${checked ? '#059669' : '#94a3b8'};">${checked ? '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>' : ''}</span>${esc(label)}</span>`;

      const docChecklist = [
        "B-Form (NADRA) — Original + 2 photocopies",
        "Recent passport-size photographs (4 copies)",
        "Previous school result card / marksheet",
        "School Leaving Certificate (SLC) from previous school",
        "Father's / Guardian's CNIC photocopy",
        "Domicile (if available)",
        "Character Certificate from previous school (if available)",
      ].map(item => `<li>${esc(item)}</li>`).join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>Admission Application Form - ${esc(schoolName)}</title>
        <style>
          * { margin:0;padding:0;box-sizing:border-box; }
          body { font-family:'Segoe UI',Arial,sans-serif; background:#fff; color:#1e293b; padding:20px; line-height:1.5; }
          .page { max-width:210mm; margin:0 auto; border:1px solid #e2e8f0; padding:25mm 18mm 20mm; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
          .topband { height:6px; background:linear-gradient(90deg,#0E3B20,#10B981); margin:-25mm -18mm 20px; }
          .header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:16px;flex-wrap:wrap; }
          .logo-wrap { width:56px;height:56px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center; }
          .logo-wrap img { width:100%;height:100%;object-fit:cover; }
          .header-text { flex:1;min-width:200px; }
          .school-name { font-size:18px;font-weight:700;color:#0E3B20;line-height:1.2; }
          .tagline { font-size:11px;color:#64748b;margin-top:2px; }
          .address { font-size:10px;color:#94a3b8;margin-top:3px; }
          .header-badge { background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:8px 12px;text-align:center; }
          .header-badge .t { font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px; }
          .header-badge .yr { font-size:18px;font-weight:800;color:#B45309;display:block;margin-top:2px; }
          .doc-title-wrap { text-align:center;margin:18px 0 12px; }
          .doc-title { display:inline-block;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0E3B20,#059669);padding:10px 28px;border-radius:8px;letter-spacing:0.5px; }
          .doc-sub { text-align:center;font-size:11px;color:#64748b;margin-top:8px;font-style:italic; }
          .intro-row { display:flex;align-items:flex-start;justify-content:center;gap:18px;margin:14px 0 20px;flex-wrap:wrap; }
          .intro-text { flex:1;min-width:200px;max-width:420px; }
          .photo-box { flex-shrink:0;width:80px;height:100px;border:2px dashed #94a3b8;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9px;color:#94a3b8;padding:6px;line-height:1.3; }
          .section-title { font-size:12px;font-weight:700;color:#fff;background:linear-gradient(90deg,#0E3B20,#10B981);padding:7px 14px;border-radius:6px;margin:18px 0 10px;letter-spacing:0.3px; }
          .note { font-size:10px;color:#B45309;background:#FEF3C7;padding:8px 12px;border-radius:6px;border-left:3px solid #F59E0B;margin:8px 0;line-height:1.5; }
          .declaration { font-size:11px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:8px;margin-top:20px;line-height:1.6; }
          .signrow { display:flex;gap:40px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0; }
          .sig { flex:1; } .sig .l { font-size:10px;color:#64748b;border-top:1px solid #334155;padding-top:6px;height:30px; }
          .officebox { background:#fefce8;border:2px solid #eab308;border-radius:8px;padding:16px;margin-top:20px; }
          .officebox .t { font-size:12px;font-weight:700;color:#854d0e;text-align:center;margin-bottom:12px; }
          .footer { text-align:center;font-size:9px;color:#94a3b8;margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0; }
          @media print { body { padding:0; } .page { box-shadow:none;border:none;max-width:none; } .topband { -print-color-adjust:exact;-webkit-print-color-adjust:exact; } }
        </style>
      </head><body><div class="page">
        <div class="topband"></div>

        <div class="header">
          <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:22px;">🏫</span>`}</div>
          <div class="header-text">
            <div class="school-name">${schoolName}</div>
            <div class="tagline">${tagline}</div>
            <div class="address">${address}</div>
          </div>
          <div class="header-badge">Session<br/><span class="yr">2026–27</span></div>
        </div>

        <div class="doc-title-wrap"><span class="doc-title">Admission Application Form</span></div>
        <div class="intro-row">
          <div class="intro-text"><div class="doc-sub" style="margin-top:0;">Blank form — Please print, fill in all fields by hand, attach required documents, and submit at the school office.</div></div>
          <div class="photo-box">Attach<br/>Passport<br/>Size Photo<br/>Here</div>
        </div>

        <div class="section-title">1&nbsp; &nbsp;Student Information</div>
        ${line("Full Name", "", undefined, true)}
        ${line("Father Name", "", undefined, true)}
        ${line("B-Form Number", "", undefined, true)}
        ${lineRow([line("Contact Number (WhatsApp)", "", undefined, true), line("WhatsApp (if different)", "")])}
        ${line("Home Address (Village / Mohalla)", "")}
        ${lineRow([line("Father's CNIC Number", "", undefined, true), line("Occupation", "")])}
        ${line("Date of Birth", "")}
        <div style="margin:6px 0 16px;clear:both;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Gender <span style="color:#B8860B;">*</span></div>${checkbox("Male", false)}${checkbox("Female", false)}</div>

        <div class="section-title">2&nbsp; &nbsp;Academic Information</div>
        <div style="margin:6px 0 14px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Applying for Class <span style="color:#B8860B;">*</span></div>${["6","7","8","9","10"].map(c => checkbox(`Class ${c}`, false)).join("")}</div>
        <div style="margin:6px 0 16px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Admission Type <span style="color:#B8860B;">*</span></div>${checkbox("Fresh Admission", false)}${checkbox("Migration / Transfer (Class 9 & 10 only)", false)}</div>
        <div class="note" style="margin-bottom:14px;">Important: At GHS Babi Khel, School Leaving Certificate (SLC) AND previous-school information are required for BOTH Fresh Admission and Migration/Transfer.</div>
        ${line("Previous School Name", "", undefined, true)}
        ${lineRow([line("Previous Class", "", undefined, true), line("Previous Marks / Grade", "", undefined, true)])}
        ${line("Year of Passing", "", undefined, true)}

        <div class="section-title">3&nbsp; &nbsp;Documents to Attach</div>
        <ul style="font-size:11.5px;color:#334155;padding-left:20px;line-height:1.6;">${docChecklist}</ul>
        <div class="note">📎 Attach photocopies of the above documents with this form. Originals may be asked for verification at the office.</div>

        <div class="declaration">
          <strong>Declaration:</strong> I/We declare that the information provided in this form is true and correct to the best of my/our knowledge. I/We understand that admission may be cancelled if any information is found to be false.
        </div>

        <div class="signrow">
          <div class="sig"><div class="l">Signature of Parent / Guardian</div></div>
          <div class="sig"><div class="l">Date</div></div>
        </div>

        <div class="officebox">
          <div class="t">✦ For Office Use Only</div>
          ${lineRow([line("Reference No.", ""), line("Received By", "")])}
          ${lineRow([line("Date Received", ""), line("Status", "")])}
        </div>

        <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; Blank Form</div>
      </div></body></html>`;

      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(html); printWin.document.close();
        printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
        toast.success("Generating blank Admission Form — use Save as PDF in print dialog");
      } else {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = "Admission Application Form (Blank).html";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        toast.success("Downloaded blank Admission Form");
      }
    } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
    finally { setDownloading(null); }
  }, [school]);

  const trackEnabled = doTrack && trackQuery.length >= 5;
  const { data: trackResults, isFetching: trackLoading } = useTrackAdmission(trackEnabled ? trackQuery : "");

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    if (fieldErrors[k]) setFieldErrors(errs => { const n = { ...errs }; delete n[k]; return n; });
  };

  const validateField = (id: string) => (e: React.FocusEvent<HTMLInputElement>) => {
    const err = fieldError(id, e.target.value);
    setFieldErrors(errs => {
      const n = { ...errs };
      if (err) n[id] = err; else delete n[id];
      return n;
    });
  };

  // ── Field-level validation (regex based, blocks garbage input like "1234" in a name field) ──
  const NAME_RE = /^[A-Za-z\u0600-\u06FF][A-Za-z\u0600-\u06FF\s.'-]{2,49}$/; // letters (incl. Urdu/Arabic script), spaces, . ' - only
  const BFORM_RE = /^\d{5}-\d{7}-\d$/;             // 13 digits formatted as XXXXX-XXXXXXX-X
  const BFORM_DIGITS_RE = /^\d{13}$/;              // or plain 13 digits
  const PHONE_RE = /^0\d{2,4}-?\d{6,8}$/;          // Pakistani-style phone: 03XX-XXXXXXX (allows optional dash, some variance)
  const ADDRESS_RE = /^[A-Za-z\u0600-\u06FF0-9][A-Za-z\u0600-\u06FF0-9\s,.'-]{2,99}$/;
  const SCHOOL_RE = /^[A-Za-z\u0600-\u06FF0-9][A-Za-z\u0600-\u06FF0-9\s,.'&-]{2,79}$/;
  const CLASS_RE = /^(Class\s*)?(6|7|8|9|10)$/i;
  const MARKS_RE = /^(\d{1,4}\s*\/\s*\d{2,4}|\d{1,3}(\.\d{1,2})?\s*%?|[A-F][+-]?)$/i; // e.g. 450/600, 82, 82%, A+
  const currentYear = new Date().getFullYear();

  const fieldError = (id: string, raw: string, isMigrationCtx: boolean = isMigration): string | null => {
    const v = raw.trim();
    switch (id) {
      case "full_name":
      case "father_name": {
        if (!v) return "This field is required";
        if (v.length < 3) return "Enter at least 3 letters";
        if (!NAME_RE.test(v)) return "Only letters and spaces allowed — no numbers or symbols";
        if (!/[A-Za-z\u0600-\u06FF]/.test(v)) return "Please enter a valid name";
        return null;
      }
      case "b_form_no": {
        if (!v) return "This field is required";
        const digits = v.replace(/\D/g, "");
        if (digits.length !== 13) return "Must be exactly 13 digits (XXXXX-XXXXXXX-X)";
        if (!BFORM_RE.test(v) && !BFORM_DIGITS_RE.test(v)) return "Use format XXXXX-XXXXXXX-X";
        return null;
      }
      case "contact_number": {
        if (!v) return "This field is required";
        const digits = v.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 11) return "Enter a valid 11-digit phone number";
        if (!PHONE_RE.test(v)) return "Use format 03XX-XXXXXXX";
        return null;
      }
      case "whatsapp_number": {
        if (!v) return null; // optional
        const digits = v.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 11 || !PHONE_RE.test(v)) return "Use format 03XX-XXXXXXX";
        return null;
      }
      case "home_address": {
        if (!v) return null; // optional
        if (v.length < 3) return "Address looks too short";
        if (!ADDRESS_RE.test(v)) return "Enter a valid address (letters/numbers only)";
        return null;
      }
      case "father_cnic": {
        if (!v) return "This field is required";
        const digits = v.replace(/\D/g, "");
        if (digits.length !== 13) return "Must be exactly 13 digits (XXXXX-XXXXXXX-X)";
        if (!BFORM_RE.test(v) && !BFORM_DIGITS_RE.test(v)) return "Use format XXXXX-XXXXXXX-X";
        return null;
      }
      case "occupation": {
        if (!v) return null; // optional
        if (v.length < 2) return "Enter a valid occupation";
        if ((!NAME_RE.test(v)) && !/^[A-Za-z\u0600-\u06FF0-9\s\-/]+$/.test(v)) return "Only letters, numbers, spaces and common symbols allowed";
        return null;
      }
      case "previous_school": {
        // Required for ALL applicants at GHS Babi Khel (both Fresh Admission and
        // Migration/Transfer), per our school's admission policy.
        if (!v) return "Required — enter your previous/current school's name";
        if (v.length < 3) return "Enter a valid school name";
        if (!SCHOOL_RE.test(v)) return "Enter a valid school name — no stray symbols";
        return null;
      }
      case "previous_class": {
        if (!v) return "Required — enter your previous class";
        if (!CLASS_RE.test(v)) return "Enter a valid class, e.g. 8 or Class 8";
        return null;
      }
      case "previous_marks": {
        if (!v) return "Required — enter your marks or grade";
        if (!MARKS_RE.test(v)) return "Enter valid marks, e.g. 450/600, 82% or A+";
        return null;
      }
      case "year_of_passing": {
        if (!v) return "Required — enter year of passing";
        if (!/^\d{4}$/.test(v)) return "Enter a valid 4-digit year";
        const y = parseInt(v, 10);
        if (y < currentYear - 20 || y > currentYear) return `Enter a year between ${currentYear - 20} and ${currentYear}`;
        return null;
      }
      default:
        return null;
    }
  };

  const STEP1_FIELDS = ["full_name", "father_name", "b_form_no", "contact_number", "whatsapp_number", "home_address", "father_cnic"];
  const STEP2_FIELDS = ["previous_school", "previous_class", "previous_marks", "year_of_passing"];

  const validateStep = (): boolean => {
    const fail = (msg: string) => { toast.error(msg); return false; };
    const errs: Record<string, string> = {};

    if (step === 1) {
      for (const id of STEP1_FIELDS) {
        const err = fieldError(id, (form as any)[id] ?? "");
        if (err) errs[id] = err;
      }
      if (!form.gender) errs.gender = "Please select gender";
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) return fail("Please fix the highlighted fields before continuing");
      return true;
    }
    if (step === 2) {
      if (!form.applying_class) errs.applying_class = "Please select applying class";
      if (!form.admission_type) errs.admission_type = "Please select admission type";
      for (const id of STEP2_FIELDS) {
        const err = fieldError(id, (form as any)[id] ?? "");
        if (err) errs[id] = err;
      }
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) return fail("Please fix the highlighted fields before continuing");
      return true;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (step !== 3) return;
    // CAPTCHA check
    if (parseInt(captchaInput, 10) !== captchaAnswer(captchaQ.a, captchaQ.b, captchaQ.op)) {
      setCaptchaError(true); newCaptcha();
      toast.error("Incorrect answer. Please solve the math question.");
      return;
    }

    if (!isEffectivelyOpen) {
      toast.error(nextOpeningNote || "Admissions are currently closed.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: inserted, error: insErr } = await supabasePublic.from("admissions").insert({
        full_name: form.full_name.trim(),
        father_name: form.father_name.trim(),
        date_of_birth: form.date_of_birth || null,
        b_form_no: form.b_form_no.trim(),
        contact_number: form.contact_number.trim(),
        whatsapp_number: form.whatsapp_number.trim() || null,
        home_address: form.home_address.trim() || null,
        gender: form.gender || null,
        applying_class: form.applying_class,
        admission_type: form.admission_type,
        previous_school: form.previous_school.trim() || null,
        previous_class: form.previous_class.trim() || null,
        previous_marks: form.previous_marks.trim() || null,
        year_of_passing: form.year_of_passing.trim() || null,
        father_cnic: form.father_cnic.trim() || null,
        occupation: form.occupation.trim() || null,
      }).select("id, reference_no").single();

      if (insErr) throw new Error(`Submission failed: ${insErr.message}`);
      const refNo = inserted?.reference_no ?? "";

      setReferenceNo(refNo);
      setView("success");
      clearDraft(); setHasDraft(false);
      toast.success("Eligibility application submitted successfully!");
    } catch (err) {
      toast.error(err?.message ?? "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setForm(defaultForm);
    setFieldErrors({});
    clearDraft(); setHasDraft(false);
  };

  const startApply = (cls?: string, type?: AdmissionType) => {
    if (!isEffectivelyOpen) {
      toast.error(nextOpeningNote || "Admissions are currently closed.");
      return;
    }
    setFieldErrors({});
    // Only reset if no draft — if draft exists, keep it
    const draft = loadDraft();
    if (draft) {
      setForm(draft);
      setHasDraft(true);
    } else {
      setForm(defaultForm);
      setHasDraft(false);
    }
    if (cls) setForm(f => ({ ...f, applying_class: cls }));
    if (type) setForm(f => ({ ...f, admission_type: type }));
    setView("apply");
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <PageLayout>
      <div className="min-h-screen bg-gradient-to-br from-background via-primary/3 to-background pb-16">

        {/* ══════════ HOME VIEW ══════════ */}
        {view === "home" && (
          <div className="container mx-auto px-4 pt-0 max-w-3xl">

            {/* ── EDITORIAL HERO BANNER ── */}
            <div

              className="relative rounded-2xl overflow-hidden mb-6 -mx-4 sm:-mx-8 px-4 sm:px-8 py-8 sm:py-10 border border-gold/40"
              style={{
                background: "linear-gradient(145deg, hsl(var(--primary-strong)) 0%, hsl(var(--primary)) 62%, hsl(var(--primary-dark)) 100%)",
              }}
            >
              {/* Lightweight editorial hero — no animated decorative layers. */}
              {/* Subtle editorial line accent */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 w-16 h-[2px] bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

              <div className="relative text-center">
                {/* Admissions status badge */}
                <div
                  className="inline-flex items-center gap-2 mb-4"
                >
                  {isEffectivelyOpen ? (
                    <div className="inline-flex items-center gap-2.5 bg-gold-soft text-[hsl(var(--gold-ink))] border border-gold/50 text-sm font-semibold tracking-wide px-5 py-2.5 rounded-full shadow-sm backdrop-blur-sm">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-gold opacity-30"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold"></span>
                      </span>
                      <span style={{ fontFamily: "var(--font-display)" }} className="text-base italic normal-case">Admissions Open</span>
                      <span className="text-[hsl(var(--gold-ink)/0.7)] font-light">— Session {displaySessionYear}</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 bg-muted text-muted-foreground border border-border text-sm font-semibold tracking-wide px-5 py-2.5 rounded-full shadow-sm">
                      <span className="w-2.5 h-2.5 rounded-full bg-destructive" />
                      <span style={{ fontFamily: "var(--font-display)" }} className="text-base italic normal-case">Admissions Closed</span>
                      <span className="text-muted-foreground font-light">— Session {displaySessionYear}</span>
                    </div>
                  )}
                </div>

                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold mb-3 leading-tight" style={{ fontFamily: "var(--font-display)", color: 'hsl(var(--primary-foreground))' }}>
                  Admission Portal
                </h1>
                <p className="text-sm sm:text-base max-w-lg mx-auto mb-6 leading-relaxed" style={{ color: 'hsl(var(--primary-foreground) / 0.78)' }}>
                  Apply online to check your eligibility. If approved, download forms and visit the school office to complete admission.
                </p>

                {isEffectivelyOpen && (
                  <button
                    onClick={() => startApply()}
                    className="inline-flex items-center gap-2 font-bold px-8 py-3 rounded-full border border-gold bg-transparent hover:bg-gold/10 transition-all text-sm"
                    style={{ color: 'hsl(var(--gold))' }}
                  >
                    <ApplyNowIcon className="w-5 h-5" /> Apply Now
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {settings?.last_date && isEffectivelyOpen && (
                  <p className="text-xs mt-4" style={{ color: 'hsl(var(--primary-foreground) / 0.72)' }}>
                    Last Date: <span className="font-bold" style={{ color: 'hsl(var(--gold-soft))' }}>{new Date(settings.last_date).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}</span>
                  </p>
                )}
                {settings?.banner_message && isEffectivelyOpen && (
                  <p className="text-xs mt-1 italic" style={{ color: 'hsl(var(--primary-foreground) / 0.7)', fontFamily: "var(--font-display)", }}>"{settings.banner_message}"</p>
                )}
              </div>

              {/* School Stats — removed static fake counters; real stats shown on HomePage */}
            </div>

            {/* ── CLOSED NOTICE — shown when admissions are not open ── */}
            {!isEffectivelyOpen && (
              <div

                className="mb-6 p-5 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-sm text-red-700 dark:text-red-400">Admissions are currently closed</p>
                  <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-1">
                    {nextOpeningNote} Online application, tracking, eligibility check, and downloads will be available again once admissions reopen.
                  </p>
                </div>
              </div>
            )}

            {/* ── ACTION CARDS (Apply / Track) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {[
                {
                  title: "Apply Online",
                  desc: "Check eligibility & submit your application from home",
                  icon: ApplyOnlineIcon,
                  action: () => startApply(),
                },
                {
                  title: "Track Application",
                  desc: "Check your application status anytime",
                  icon: TrackApplicationIcon,
                  action: () => {
                    if (!isEffectivelyOpen) {
                      toast.error(nextOpeningNote || "Admissions are currently closed.");
                      return;
                    }
                    setView("track"); window.scrollTo({ top: 0, behavior: "smooth" });
                  },
                },
              ].map((card, i) => (
                <button key={i}


                  disabled={!isEffectivelyOpen}
                  onClick={() => {
                    if (!isEffectivelyOpen) {
                      toast.error(nextOpeningNote || "Admissions are currently closed.");
                      return;
                    }
                    card.action();
                  }}
                  className={`relative text-left p-5 rounded-2xl border border-gold bg-transparent transition-all group ${
                    isEffectivelyOpen ? "hover:bg-gold/10" : "opacity-60 cursor-not-allowed grayscale"
                  }`}
                >
                  {!isEffectivelyOpen && (
                    <div className="absolute top-3 right-3 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <LockIcon className="w-2.5 h-2.5" /> Locked
                    </div>
                  )}
                  <div className={`w-11 h-11 rounded-xl bg-transparent border border-gold flex items-center justify-center mb-3 ${isEffectivelyOpen ? "group-hover:scale-110" : ""} transition-transform`}>
                    <card.icon className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-sm text-foreground">{card.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{card.desc}</p>
                </button>
              ))}
            </div>



            {/* ── DOWNLOAD SECTION ── */}
            <div

              className="p-4 bg-card border border-border rounded-2xl mb-6 relative"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-bold text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-primary" /> Downloads
                </p>
                {isEffectivelyOpen ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!!downloading}
                    onClick={() => { DOWNLOAD_ITEMS.forEach(d => generateAndDownload(d)); }}
                    className="text-xs gap-1.5 text-primary"
                  >
                    <FileDown className="w-3.5 h-3.5" /> Download All
                  </Button>
                ) : (
                  <span className="text-[10px] text-red-500 font-bold flex items-center gap-1">
                    <LockIcon className="w-3 h-3" /> Locked
                  </span>
                )}
              </div>
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${!isEffectivelyOpen ? "opacity-50 pointer-events-none select-none" : ""}`}>
                {/* Download Admission Form (Printable) - Featured at top - EMPTY FORM */}
                <button
                  onClick={() => isEffectivelyOpen && !downloading && generateEmptyForm()}
                  disabled={!!downloading || !isEffectivelyOpen}
                  className="text-left p-3 rounded-xl border border-gold bg-transparent hover:bg-gold/10 transition-all group relative overflow-hidden disabled:opacity-60 sm:col-span-2"
                >
                  {downloading === "empty_form" && (
                    <div className="absolute inset-0 bg-gold/10 flex items-center justify-center rounded-xl">
                      <Loader2 className="w-5 h-5 animate-spin text-gold" />
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-transparent border border-primary flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                      <Download className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-primary flex items-center gap-1.5">
                        <span>Download Admission Form</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 leading-tight">Blank form — print, fill by hand & submit at school office</p>
                      <p className="text-[9px] text-muted-foreground font-medium mt-1 flex items-center gap-1">
                        <FileDown className="w-3 h-3 text-primary" /> No pre-filling required
                      </p>
                    </div>
                  </div>
                </button>

                {DOWNLOAD_ITEMS.map((d) => {
                  const isDownloading = downloading === d.key;
                  const hasFile = !!libFiles[d.key];
                  return (
                    <button key={d.key}
                      onClick={() => isEffectivelyOpen && !isDownloading && generateAndDownload(d)}
                      disabled={!!downloading || !isEffectivelyOpen}
                      className="text-left p-3 rounded-xl border border-border bg-muted/50 hover:bg-primary/5 hover:border-primary/30 transition-all group relative overflow-hidden disabled:opacity-60"
                    >
                      {isDownloading && (
                        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        </div>
                      )}
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-lg ${d.iconBg} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                          <span className="text-base leading-none">{d.icon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-xs truncate">{d.title}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-1">{d.desc}</p>
                          <p className="text-[9px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                            {d.fileSize}
                            {hasFile ? <FileDown className="w-2.5 h-2.5 text-green-600" /> : <FileText className="w-2.5 h-2.5 text-blue-500" />}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                {isEffectivelyOpen ? "Tap to download • Admin-uploaded files used when available" : "Downloads unlock automatically when admissions reopen"}
              </p>
            </div>

            {/* ── ELIGIBILITY CHECKER (moved below Downloads, compacted) ── */}
            <div

              className="mb-6 relative"
            >
              {isEffectivelyOpen ? (
                <EligibilityChecker onApply={(cls, type) => startApply(cls, type)} />
              ) : (
                <div className="relative">
                  <div className="pointer-events-none select-none opacity-40 blur-[1px]">
                    <EligibilityChecker onApply={() => {}} />
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/60 rounded-2xl">
                    <LockIcon className="w-7 h-7 text-muted-foreground mb-2" />
                    <p className="text-xs font-semibold text-muted-foreground">Available when admissions open</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── SEO content block (sr-only) ── */}
            <section aria-label="Admission information" className="sr-only">
              <h2 className="text-base font-bold text-foreground">Admission at Government High School Babi Khel</h2>
              <p>Government High School Babi Khel, District Mohmand, KPK welcomes admissions for Class 6 to Class 10. Admissions are open every academic session for both fresh students and migration/transfer cases.</p>
              <div>
                <p className="font-semibold text-foreground mb-1">Programs offered:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Class 6, 7, 8 (Fresh):</strong> School-level admission.</li>
                  <li><strong>Class 9 (Fresh):</strong> Student is enrolled with BISE Peshawar by the school after admission.</li>
                  <li><strong>Class 9 & 10 (Migration):</strong> School-to-school transfer on the BISE Peshawar portal, from another BISE-affiliated institution.</li>
                  <li><strong>Class 6–8 (Transfer):</strong> Handled directly between schools, outside the BISE portal.</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">Documents (where applicable):</p>
                <p>B-Form (NADRA); passport size photo; previous result card (where applicable); <strong>School Leaving Certificate (SLC) — required for ALL admissions</strong> (Fresh & Migration) per GHS Babi Khel policy; father's/guardian's CNIC copy. Class 9/10 migration from another Board may additionally require DMC and migration certificate (BISE requirements only), submitted by the schools as part of BISEP's process.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">How to apply:</p>
                <p>Apply online for a preliminary eligibility check. If the school approves your application, download the printable admission form, fill it, and visit the school office with your documents. You can also walk in directly with documents. For Class 9/10 migration, board-level migration is completed by the schools on the BISEP portal separately from this online application.</p>
              </div>
            </section>
          </div>
        )}

        {/* ══════════ APPLY VIEW ══════════ */}
        {view === "apply" && (
          <div className="container mx-auto px-4 pt-6 max-w-lg">
            <button onClick={() => { setView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 hover:text-foreground">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>

            <div className="text-center mb-2">
              <h2 className="text-lg font-bold text-foreground">Eligibility Application</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Fill your details to check eligibility. If approved, you'll download forms & visit the office.
              </p>
            </div>

            {/* Draft restore banner */}
            {hasDraft && step === 1 && (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-xl p-3 mb-4 flex items-center gap-2 text-xs">
                <Save className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="text-blue-700 dark:text-blue-300 flex-1">You have a saved draft from a previous session.</span>
                <button onClick={() => { clearDraft(); setForm(defaultForm); setHasDraft(false); }}
                  className="text-red-600 hover:underline shrink-0 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Discard
                </button>
              </div>
            )}

            <StepStepper step={step} totalSteps={3} />

            <div>
              <div key={step}>

                <Card className="border-border">
                  <CardContent className="p-5 space-y-4">

                    {/* Step 1 — Student Info (with icons & tooltips) */}
                    {step === 1 && (
                      <>
                        <h2 className="font-bold text-base flex items-center gap-2">
                          <User className="w-4 h-4 text-primary" /> Student Information
                        </h2>
                        <div className="space-y-3">
                          {[
                            { id: "full_name", label: "Full Name", placeholder: "Student full name", req: true, icon: User, tip: "Enter the student's full name as on B-Form" },
                            { id: "father_name", label: "Father Name", placeholder: "Father full name", req: true, icon: User, tip: "Enter father's name as on CNIC" },
                            { id: "b_form_no", label: "B-Form Number", placeholder: "XXXXX-XXXXXXX-X", req: true, icon: Shield, tip: "13-digit NADRA B-Form number (CRC)" },
                            { id: "contact_number", label: "Contact (WhatsApp)", placeholder: "03XX-XXXXXXX", req: true, icon: Phone, tip: "Primary contact — we'll send updates here" },
                            { id: "whatsapp_number", label: "WhatsApp (if different)", placeholder: "03XX-XXXXXXX", req: false, icon: Phone, tip: "If WhatsApp number is different from contact" },
                            { id: "home_address", label: "Home Address", placeholder: "Village / Mohalla", req: false, icon: MapPin, tip: "Your village or mohalla name" },
                            { id: "father_cnic", label: "Father's CNIC", placeholder: "XXXXX-XXXXXXX-X", req: true, icon: Shield, tip: "Father's 13-digit CNIC number (required for admission)" },
                            { id: "occupation", label: "Occupation", placeholder: "e.g. Teacher, Farmer, Business", req: false, icon: Briefcase, tip: "Father/Guardian's profession (optional)" },
                          ].map(f => (
                            <div key={f.id}>
                              <Label className="text-xs font-semibold mb-1 flex items-center">
                                {f.label} {f.req && <span className="text-red-500 ml-0.5">*</span>}
                                <FieldTooltip text={f.tip} />
                              </Label>
                              <div className="relative">
                                <f.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                                <Input value={(form as any)[f.id]} onChange={set(f.id)} onBlur={validateField(f.id)}
                                  placeholder={f.placeholder}
                                  aria-invalid={!!fieldErrors[f.id]}
                                  className={`text-sm h-10 pl-9 ${fieldErrors[f.id] ? "border-red-500 focus-visible:ring-red-400" : ""}`} />
                              </div>
                              {fieldErrors[f.id] && (
                                <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                                  <XCircle className="w-2.5 h-2.5 shrink-0" /> {fieldErrors[f.id]}
                                </p>
                              )}
                            </div>
                          ))}
                          <div>
                            <Label className="text-xs font-semibold mb-1 block">Date of Birth</Label>
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                              <Input type="date" value={form.date_of_birth} onChange={set("date_of_birth")}
                                className="text-sm h-10 pl-9" />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs font-semibold mb-1 block">
                              Gender <span className="text-red-500">*</span>
                            </Label>
                            <Select value={form.gender} onValueChange={v => { setForm(f => ({ ...f, gender: v })); if (fieldErrors.gender) setFieldErrors(errs => { const n = { ...errs }; delete n.gender; return n; }); }}>
                              <SelectTrigger className={`h-10 text-sm ${fieldErrors.gender ? "border-red-500" : ""}`}><SelectValue placeholder="Select gender" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">Male</SelectItem>
                                <SelectItem value="female">Female</SelectItem>
                              </SelectContent>
                            </Select>
                            {fieldErrors.gender && (
                              <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                                <XCircle className="w-2.5 h-2.5 shrink-0" /> {fieldErrors.gender}
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Step 2 — Academic Info (with icons & tooltips) */}
                    {step === 2 && (
                      <>
                        <h2 className="font-bold text-base flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-primary" /> Academic Information
                        </h2>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs font-semibold mb-1 flex items-center">
                              Applying for Class <span className="text-red-500 ml-0.5">*</span>
                              <FieldTooltip text="Select the class you want admission in" />
                            </Label>
                            <Select value={form.applying_class} onValueChange={v => { setForm(f => ({ ...f, applying_class: v })); if (fieldErrors.applying_class) setFieldErrors(errs => { const n = { ...errs }; delete n.applying_class; return n; }); }}>
                              <SelectTrigger className={`h-10 text-sm ${fieldErrors.applying_class ? "border-red-500" : ""}`}><SelectValue placeholder="Select class" /></SelectTrigger>
                              <SelectContent>
                                {["6","7","8","9","10"].map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {fieldErrors.applying_class && (
                              <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                                <XCircle className="w-2.5 h-2.5 shrink-0" /> {fieldErrors.applying_class}
                              </p>
                            )}
                          </div>
                          <div>
                            <Label className="text-xs font-semibold mb-1 flex items-center">
                              Admission Type <span className="text-red-500 ml-0.5">*</span>
                              <FieldTooltip text="Fresh = new student, Migration = transfer from another school" />
                            </Label>
                            <Select value={form.admission_type} onValueChange={v => { setForm(f => ({ ...f, admission_type: v as AdmissionType })); if (fieldErrors.admission_type) setFieldErrors(errs => { const n = { ...errs }; delete n.admission_type; return n; }); }}>
                              <SelectTrigger className={`h-10 text-sm ${fieldErrors.admission_type ? "border-red-500" : ""}`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="fresh">Fresh Admission</SelectItem>
                                {["9", "10"].includes(form.applying_class) && <SelectItem value="migration">Migration / Transfer</SelectItem>}
                              </SelectContent>
                            </Select>
                            {!['9', '10'].includes(form.applying_class) && form.applying_class && form.admission_type === "fresh" && (
                              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                                <Info className="w-2.5 h-2.5 shrink-0" /> Note: For Class {form.applying_class}, only Fresh Admission is available.
                              </p>
                            )}
                          </div>
                          {form.applying_class === "9" && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex gap-2">
                              <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>Class 9 students are enrolled with BISE Peshawar by the school after admission is confirmed.</span>
                            </div>
                          )}
                          {isMigration && ["9", "10"].includes(form.applying_class) && (
                            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-primary flex gap-2">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>Class {form.applying_class} migration is completed school-to-school on the BISE Peshawar portal within the board's notified migration window — school approval of this application is a separate first step. Track progress after submission.</span>
                            </div>
                          )}
                          {isMigration && !["9", "10"].includes(form.applying_class) && form.applying_class && (
                            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-primary flex gap-2">
                              <Info className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>For Class {form.applying_class}, transfer is handled directly between schools and does not go through the BISE Peshawar portal.</span>
                            </div>
                          )}
                          {[
                            { id: "previous_school", label: "Previous School Name", placeholder: "School name", req: true, icon: GraduationCap, tip: "Required — name of your previous/current school" },
                            { id: "previous_class", label: "Previous Class", placeholder: "e.g. Class 8", req: true, icon: BookOpen, tip: "Required — the class you last completed" },
                            { id: "previous_marks", label: "Previous Marks / Grade", placeholder: "e.g. 450/600 or A", req: true, icon: TrendingUp, tip: "Required — your marks or grade from the last exam" },
                            { id: "year_of_passing", label: "Year of Passing", placeholder: `${new Date().getFullYear()}`, req: true, icon: Calendar, tip: "Required — year you completed the previous class" },
                          ].map(f => (
                            <div key={f.id}>
                              <Label className="text-xs font-semibold mb-1 flex items-center">
                                {f.label} {f.req && <span className="text-red-500 ml-0.5">*</span>}
                                <FieldTooltip text={f.tip} />
                              </Label>
                              <div className="relative">
                                <f.icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                                <Input value={(form as any)[f.id]} onChange={set(f.id)} onBlur={validateField(f.id)}
                                  placeholder={f.placeholder}
                                  aria-invalid={!!fieldErrors[f.id]}
                                  className={`text-sm h-10 pl-9 ${fieldErrors[f.id] ? "border-red-500 focus-visible:ring-red-400" : ""}`} />
                              </div>
                              {fieldErrors[f.id] && (
                                <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                                  <XCircle className="w-2.5 h-2.5 shrink-0" /> {fieldErrors[f.id]}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Step 3 — REVIEW & SUBMIT (no document upload) */}
                    {step === 3 && (
                      <>
                        <h2 className="font-bold text-base flex items-center gap-2">
                          <Eye className="w-4 h-4 text-primary" /> Review & Submit
                        </h2>
                        <p className="text-xs text-muted-foreground mb-3">
                          Review your details below. If approved by the school, you'll be asked to bring your documents to the office.
                        </p>

                        {/* Review summary */}
                        <div className="space-y-3">
                          <div className="bg-muted/50 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-primary" /> Student Information
                              </p>
                              <button onClick={() => setStep(1)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                                <Edit3 className="w-2.5 h-2.5" /> Edit
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div><span className="text-muted-foreground">Name:</span> <span className="font-medium ml-1">{form.full_name}</span></div>
                              <div><span className="text-muted-foreground">Father:</span> <span className="font-medium ml-1">{form.father_name}</span></div>
                              <div><span className="text-muted-foreground">B-Form:</span> <span className="font-mono ml-1">{form.b_form_no}</span></div>
                              <div><span className="text-muted-foreground">Contact:</span> <span className="ml-1">{form.contact_number}</span></div>
                              {form.whatsapp_number && <div><span className="text-muted-foreground">WhatsApp:</span> <span className="ml-1">{form.whatsapp_number}</span></div>}
                              <div><span className="text-muted-foreground">Gender:</span> <span className="capitalize ml-1">{form.gender}</span></div>
                              {form.date_of_birth && <div><span className="text-muted-foreground">DOB:</span> <span className="ml-1">{form.date_of_birth}</span></div>}
                              <div><span className="text-muted-foreground">Father's CNIC:</span> <span className="font-mono ml-1">{form.father_cnic}</span></div>
                              {form.occupation && <div><span className="text-muted-foreground">Occupation:</span> <span className="ml-1">{form.occupation}</span></div>}
                              {form.home_address && <div className="col-span-2"><span className="text-muted-foreground">Address:</span> <span className="ml-1">{form.home_address}</span></div>}
                            </div>
                          </div>

                          <div className="bg-muted/50 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                                <BookOpen className="w-3.5 h-3.5 text-primary" /> Academic Information
                              </p>
                              <button onClick={() => setStep(2)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                                <Edit3 className="w-2.5 h-2.5" /> Edit
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div><span className="text-muted-foreground">Class:</span> <span className="font-medium ml-1">Class {form.applying_class}</span></div>
                              <div><span className="text-muted-foreground">Type:</span> <span className="capitalize ml-1">{form.admission_type}</span></div>
                              {form.previous_school && <div><span className="text-muted-foreground">School:</span> <span className="ml-1">{form.previous_school}</span></div>}
                              {form.previous_class && <div><span className="text-muted-foreground">Prev Class:</span> <span className="ml-1">{form.previous_class}</span></div>}
                              {form.previous_marks && <div><span className="text-muted-foreground">Marks:</span> <span className="ml-1">{form.previous_marks}</span></div>}
                              {form.year_of_passing && <div><span className="text-muted-foreground">Year:</span> <span className="ml-1">{form.year_of_passing}</span></div>}
                            </div>
                          </div>

                          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300 flex gap-2">
                            <Info className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>Documents are not uploaded online. If your eligibility is approved, you'll need to bring the original documents listed in the Admission Application Form (downloadable below) to the school office (Mon–Sat, 8AM–12PM).</span>
                          </div>

                          {/* Filled Admission Form download — appears once the applicant has completed the form */}
                          <button
                            type="button"
                            onClick={() => !downloading && generateFilledForm()}
                            disabled={!!downloading}
                            className="w-full flex items-center gap-3 p-3 border border-primary border-dashed bg-transparent hover:bg-primary/10 transition-all text-left disabled:opacity-60"
                          >
                            <div className="w-9 h-9 rounded-lg border border-primary bg-transparent flex items-center justify-center shrink-0">
                              {downloading === "filled_form" ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <Download className="w-5 h-5 text-primary" />}
                            </div>
                            <div>
                              <p className="font-semibold text-xs text-primary">Download Admission Form (Printable)</p>
                              <p className="text-[10px] text-muted-foreground">Pre-filled with the details you entered — print, sign & submit at office</p>
                            </div>
                          </button>
                        </div>

                        {/* Styled CAPTCHA */}
                        <div className={`mt-4 border-2 rounded-xl p-4 space-y-3 ${
                          captchaError ? "border-red-400 bg-red-50/50" : "border-primary/20 bg-primary/5"
                        }`}>
                          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Shield className="w-4 h-4 text-primary" />
                            Security Verification
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="bg-white dark:bg-card rounded-lg px-4 py-2 border border-border shadow-sm">
                              <span className="text-lg font-bold text-foreground">{captchaQ.a}</span>
                              <span className="text-lg font-bold text-primary mx-2">{captchaQ.op}</span>
                              <span className="text-lg font-bold text-foreground">{captchaQ.b}</span>
                              <span className="text-lg font-bold text-primary mx-2">=</span>
                            </div>
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={captchaInput}
                              onChange={e => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
                              placeholder="?"
                              className={`h-11 w-20 text-center text-xl font-bold rounded-lg ${captchaError ? "border-red-400" : ""}`}
                            />
                            <button type="button" onClick={newCaptcha}
                              className="text-xs text-muted-foreground underline hover:text-primary shrink-0">
                              New
                            </button>
                          </div>
                          {captchaError && (
                            <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                              <XCircle className="w-3 h-3" /> Wrong answer — try again
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Navigation — mobile sticky bottom bar */}
                <div className="flex gap-3 mt-4 pb-4 sm:pb-0">
                  {step > 1 && (
                    <Button variant="outline" onClick={() => setStep(s => s - 1)}
                      className="flex-1 gap-2 rounded-xl h-11 sm:h-10">
                      <ChevronLeft className="w-4 h-4" /> Previous
                    </Button>
                  )}
                  {step < 3 ? (
                    <Button onClick={() => { if (validateStep()) setStep(s => s + 1); }}
                      className="flex-1 gap-2 rounded-xl h-11 sm:h-10">
                      Next <ChevronRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button onClick={handleSubmit} disabled={submitting}
                      className="flex-1 gap-2 rounded-xl h-11 sm:h-10">
                      {submitting
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
                        : <><Send className="w-4 h-4" /> Submit Application</>
                      }
                    </Button>
                  )}
                </div>

                {/* Save draft button */}
                {view === "apply" && (step === 1 || step === 2) && (
                  <div className="mt-2 text-center">
                    <button
                      onClick={() => { saveDraft(form); setHasDraft(true); toast.success("Draft saved! You can continue later."); }}
                      className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5 mx-auto"
                    >
                      <Save className="w-3.5 h-3.5" /> Save as Draft
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════ SUCCESS VIEW ══════════ */}
        {view === "success" && (
          <div className="container mx-auto px-4 pt-10 max-w-md text-center">
            <div>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold mb-2">Application Submitted!</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Your eligibility application has been received. The school will review it and contact you.
              </p>
              <div className="bg-primary/10 border border-primary/30 rounded-2xl p-5 mb-6">
                <p className="text-xs text-muted-foreground mb-1">Your Reference Number</p>
                <p className="text-2xl font-bold font-mono text-primary">{referenceNo}</p>
              </div>
              {referenceNo && (
                <PushOptIn
                  context="admission"
                  admissionRef={referenceNo}
                  title="Get your application updates"
                  text="Turn on notifications and we'll alert you the moment your application status changes."
                  className="mb-6 text-left"
                />
              )}
              <div className="bg-card border border-border rounded-2xl p-4 text-left text-xs space-y-2 mb-6 text-muted-foreground">
                <p className="font-semibold text-foreground text-sm">What happens next:</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">1.</span> Save your reference number</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">2.</span> School reviews your eligibility</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">3.</span> If approved — download forms, fill them, and bring to office</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">4.</span> If not approved — you'll be informed with the reason</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">5.</span> Track your status anytime using B-Form or reference number</p>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={() => { setView("track"); setTrackQuery(referenceNo); setDoTrack(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="gap-2 rounded-xl">
                  <Search className="w-4 h-4" /> Track This Application
                </Button>
                <Button variant="outline" onClick={() => { resetForm(); setView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="gap-2 rounded-xl">
                  Submit Another Application
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ TRACK VIEW ══════════ */}
        {view === "track" && (
          <div className="container mx-auto px-4 pt-6 max-w-lg">
            <button onClick={() => { setView("home"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 hover:text-foreground">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6 text-blue-500" />
              </div>
              <h2 className="text-xl font-bold">Track Application</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enter your B-Form number, Reference Number, or Contact Number
              </p>
            </div>

            {/* Search input with phone support */}
            <div className="flex gap-2 mb-3">
              <Input
                value={trackQuery}
                onChange={e => { setTrackQuery(e.target.value); setDoTrack(false); }}
                placeholder="B-Form, Reference No., or Phone"
                className="text-sm h-11"
                onKeyDown={e => e.key === "Enter" && setDoTrack(true)}
              />
              <Button onClick={() => setDoTrack(true)} disabled={trackQuery.length < 5}
                className="gap-1.5 rounded-xl px-4 h-11">
                {trackLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            {/* Forgot reference link */}
            <div className="text-center mb-6">
              <p className="text-[10px] text-muted-foreground">
                Forgot your reference number? Search by your contact number or B-Form number instead. Only your own application (matched by exact number) is shown — your B-Form number is never displayed publicly.
              </p>
            </div>

            {trackLoading && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                Searching…
              </div>
            )}
            {doTrack && !trackLoading && trackResults && trackResults.length === 0 && (
              <div className="text-center py-10">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No application found for this query.</p>
                <p className="text-xs text-muted-foreground mt-1">Check your B-Form, reference, or contact number and try again.</p>
              </div>
            )}
            {!trackLoading && trackResults && trackResults.length > 0 && (
              <div className="space-y-4">
                {trackResults.map((r: any, i: number) => (
                  <TrackResult key={i} result={r} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </PageLayout>
  );
};

export default Admission;
