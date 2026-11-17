import { lazy, Suspense, useState, useCallback, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Search, ChevronRight, ChevronLeft, Loader2, AlertCircle, User, BookOpen, Download, Shield, XCircle, MapPin, Phone, GraduationCap, TrendingUp, Calendar, Send, Eye, Edit3, Save, Trash2, Info, X, Briefcase, FileText, FileDown, BadgeCheck } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useQuery } from "@tanstack/react-query";
import AdmissionHome from "@/components/admissions/AdmissionHome";
const TrackResult = lazy(() => import("@/components/admissions/TrackResult"));
const ClassesAndSeats = lazy(() => import("@/components/admissions/ClassesAndSeats"));
const AdmissionMeritLists = lazy(() => import("@/components/admissions/AdmissionMeritLists"));
const OnlinePayPanel = lazy(() => import("@/components/admissions/OnlinePayPanel"));

type View = "home" | "apply" | "track" | "success" | "eligibility";



// ── Visual Progress Stepper ───────────────────────────────────────────────────
function StepStepper({ step, totalSteps }: { step: number; totalSteps: number }) {
  const stepLabels = ["Student Info", "Academic Info", "Review & Submit"];
  const stepIcons = [User, BookOpen, Eye];
  const pct = totalSteps > 1 ? ((step - 1) / (totalSteps - 1)) * 100 : 0;
  return (
    <div className="mb-6 rounded-2xl border border-border bg-card px-4 pt-5 pb-4 shadow-sm">
      <div className="relative mx-auto flex max-w-sm items-start justify-between">
        {/* track */}
        <div className="absolute left-[16.66%] right-[16.66%] top-5 h-1 -translate-y-1/2 rounded-full bg-muted" aria-hidden />
        <div
          className="absolute left-[16.66%] top-5 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary to-green-500 transition-all duration-500"
          style={{ width: `${(pct / 100) * 66.68}%` }}
          aria-hidden
        />
        {stepLabels.map((label, i) => {
          const n = i + 1;
          const isActive = n === step;
          const isDone = n < step;
          const Icon = stepIcons[i];
          return (
            <div key={label} className="relative z-10 flex w-1/3 flex-col items-center text-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-110"
                    : isDone
                    ? "border-green-500 bg-green-500 text-white"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {isDone ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`mt-2 text-[10px] font-bold uppercase tracking-wide leading-tight ${isActive ? "text-primary" : isDone ? "text-green-600" : "text-muted-foreground"}`}>
                Step {n}
              </span>
              <span className={`text-[11px] leading-tight ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </div>
          );
        })}
      </div>
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
  // BUG FIX: "eligibility" used to be accepted by this initializer but has
  // NO render branch below — a deep link carrying it rendered a permanently
  // BLANK content area (looked like a crashed page). The apply flow IS the
  // eligibility check, so it now maps to "apply".
  const location = useLocation();
  const [view, setView]           = useState<View>(
    (() => {
      const state = location.state as { view?: View } | null;
      const v = state?.view;
      return v === "track" ? "track"
        : v === "apply" || v === "eligibility" ? "apply"
        : "home";
    })()
  );
  const [step, setStep]           = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [trackQuery, setTrackQuery]   = useState("");
  const [doTrack, setDoTrack]         = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  // ── Processing-fee payment state (success view + Safepay return) ─────────
  const [paymentRef, setPaymentRef]   = useState<string | null>(null);
  const [pdfBusy, setPdfBusy]         = useState<string | null>(null);
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Safepay checkout return: /admission?payment=return&ref=… (poll until the
  // webhook flips the fee to paid) or ?payment=cancelled&ref=… (calm toast).
  useEffect(() => {
    const mode = searchParams.get("payment");
    const ref = searchParams.get("ref");
    if (!mode || !ref) return;
    // clean the URL once consumed (no re-trigger on re-render)
    setSearchParams({}, { replace: true });
    setView("track");
    setTrackQuery(ref);
    setDoTrack(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (mode === "cancelled") {
      toast("Payment was not completed. You can try again whenever you are ready.", { icon: "ℹ️", duration: 5000 });
      return;
    }
    if (mode === "return") {
      setAwaitingPaymentRef(ref);
      let tries = 0;
      const poll = window.setInterval(async () => {
        tries += 1;
        await qc.invalidateQueries({ queryKey: ["track-admission"] });
        if (tries >= 12) window.clearInterval(poll);
      }, 3000);
      // Safety: stop polling when the visitor leaves the page.
      return () => window.clearInterval(poll);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — the params are consumed immediately

  // ── Track (moved up: the Safepay watcher needs its results) ─────────────
  const trackEnabled = doTrack && trackQuery.length >= 5;
  const { data: trackResults, isFetching: trackLoading } = useTrackAdmission(trackEnabled ? trackQuery : "");

  // When the polled refetch shows the fee as paid, confirm it once.
  const [awaitingPaymentRef, setAwaitingPaymentRef] = useState<string | null>(null);
  useEffect(() => {
    if (!awaitingPaymentRef || !trackResults) return;
    const match = (trackResults as any[]).find((r) => r?.reference_no === awaitingPaymentRef);
    if (match?.payment_status === "paid") {
      setAwaitingPaymentRef(null);
      toast.success("Payment received. Thank you!");
    }
  }, [trackResults, awaitingPaymentRef]);

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

  // ── Admin-uploaded admission documents ───────────────────────────────────
  // Not needed for first paint: fetched after the page is idle, cached for
  // 10 minutes, and shared across visits by react-query.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(() => setIdle(true), { timeout: 2500 }); return () => (window as any).cancelIdleCallback?.(id); }
    const t = window.setTimeout(() => setIdle(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  const { data: libFiles = {} } = useQuery<Record<string, { url: string; id: string }>>({
    queryKey: ["admission-files"],
    enabled: idle,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabasePublic.from("library_files").select("id, title, file_url").ilike("category", "Admission");
      const map: Record<string, { url: string; id: string }> = {};
      for (const f of data ?? []) {
        const t = (f.title || "").toLowerCase();
        if (t.includes("prospectus")) map.prospectus = { url: f.file_url, id: f.id };
        else if (t.includes("fee")) map.fee_structure = { url: f.file_url, id: f.id };
        else if (t.includes("migration")) map.migration_template = { url: f.file_url, id: f.id };
        else if (t.includes("rule")) map.rules = { url: f.file_url, id: f.id };
      }
      return map;
    },
  });

  // ── Downloads: the heavy document module loads on first tap ─────────────
  const runDownload = useCallback(async (key: string, fn: (m: typeof import("@/lib/admissionDocs")) => void | Promise<void>) => {
    setDownloading(key);
    try { await fn(await import("@/lib/admissionDocs")); }
    catch (err: any) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
    finally { setDownloading(null); }
  }, []);

  const generateAndDownload = useCallback((key: string) =>
    runDownload(key, (m) => {
      const item = m.DOWNLOAD_ITEMS.find((d) => d.key === key);
      if (item) return m.downloadAdmissionDoc(item, libFiles[key], school);
    }), [runDownload, libFiles, school]);

  const downloadAll = useCallback(() => {
    ["prospectus", "fee_structure", "migration_template", "rules"].forEach((k) => generateAndDownload(k));
  }, [generateAndDownload]);

  const generateEmptyForm = useCallback(() => runDownload("empty_form", (m) => m.generateEmptyForm(school)), [runDownload, school]);
  const generateFilledForm = useCallback(() => runDownload("filled_form", (m) => m.generateFilledForm(school, form)), [runDownload, school, form]);

  // ── Success-view PDFs (GHSS-style challan + application form) ────────────
  const successPdfInput = useCallback(() => ({
    referenceNo,
    name: form.full_name,
    fatherName: form.father_name,
    bFormNo: (form.b_form_no || "").replace(/[^0-9]/g, ""),
    applyingClass: form.applying_class,
    admissionType: form.admission_type || "fresh",
    processingFee: Number(settings?.processing_fee ?? 0),
    deadline: null,
    paymentAccounts: (settings?.payment_accounts ?? []) as any[],
    sessionYear: settings?.session_year ?? null,
    appliedOn: new Date().toISOString(),
  }), [referenceNo, form, settings]);

  const downloadSuccessPdf = useCallback(async (kind: "challan" | "application") => {
    if (!referenceNo) return;
    setPdfBusy(kind);
    try {
      const m = await import("@/lib/admissionPdf");
      if (kind === "application") {
        await m.downloadApplicationForm({
          ...successPdfInput(),
          paymentStatus: "pending",
          paymentReference: paymentRef,
          gender: form.gender,
          dateOfBirth: form.date_of_birth || null,
          contactNumber: form.contact_number,
          whatsappNumber: form.whatsapp_number || null,
          homeAddress: form.home_address || null,
          fatherCnic: form.father_cnic || null,
          occupation: form.occupation || null,
          previousSchool: form.previous_school || null,
          previousClass: form.previous_class || null,
          previousMarks: form.previous_marks || null,
          yearOfPassing: form.year_of_passing || null,
        });
      } else {
        let ref = paymentRef;
        if (!ref) {
          const { ensurePaymentReference } = await import("@/lib/admissionPayment");
          const res = await ensurePaymentReference(referenceNo, (form.b_form_no || "").replace(/[^0-9]/g, ""));
          if (!res.ok) { toast.error(res.error || "Could not create the payment reference."); return; }
          ref = res.payment_reference ?? null;
          if (ref) setPaymentRef(ref);
        }
        await m.downloadFeeChallan({ ...successPdfInput(), paymentReference: ref });
      }
    } catch (e: any) {
      toast.error(`Could not build the PDF: ${e?.message || "try again"}`);
    } finally { setPdfBusy(null); }
  }, [referenceNo, paymentRef, form, settings, successPdfInput]);

  // ── Save draft on form change ───────────────────────────────────────────
  useEffect(() => {
    const hasContent = Object.values(form).some(v => v && v !== "fresh");
    if (hasContent && view === "apply") { saveDraft(form); setHasDraft(true); }
  }, [form, view]);






  // ── Input masks: block extra / wrong characters while typing ────────────
  // CNIC & B-Form: digits only, auto-formatted XXXXX-XXXXXXX-X (max 13 digits)
  // Mobile: digits only, auto-formatted 03XX-XXXXXXX (max 11 digits)
  // Year: digits only, max 4. Names: letters/spaces only.
  const maskInput = (id: string, raw: string): string => {
    switch (id) {
      case "b_form_no":
      case "father_cnic": {
        const d = raw.replace(/\D/g, "").slice(0, 13);
        if (d.length <= 5) return d;
        if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
        return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
      }
      case "contact_number":
      case "whatsapp_number": {
        const d = raw.replace(/\D/g, "").slice(0, 11);
        return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4)}`;
      }
      case "year_of_passing":
        return raw.replace(/\D/g, "").slice(0, 4);
      case "full_name":
      case "father_name":
        return raw.replace(/[^A-Za-z\u0600-\u06FF\s.'-]/g, "").slice(0, 50);
      case "previous_marks":
        return raw.replace(/[^0-9A-Za-z+\-/%.\s]/g, "").slice(0, 12);
      case "previous_class":
        return raw.slice(0, 8);
      case "home_address":
        return raw.slice(0, 100);
      case "previous_school":
        return raw.slice(0, 80);
      case "occupation":
        return raw.slice(0, 40);
      default:
        return raw;
    }
  };
  const FIELD_INPUT_PROPS: Record<string, { inputMode?: "numeric" | "tel" | "text"; maxLength?: number; autoComplete?: string }> = {
    b_form_no:       { inputMode: "numeric", maxLength: 15, autoComplete: "off" },
    father_cnic:     { inputMode: "numeric", maxLength: 15, autoComplete: "off" },
    contact_number:  { inputMode: "tel", maxLength: 12, autoComplete: "tel" },
    whatsapp_number: { inputMode: "tel", maxLength: 12, autoComplete: "tel" },
    year_of_passing: { inputMode: "numeric", maxLength: 4 },
    full_name:       { maxLength: 50 },
    father_name:     { maxLength: 50 },
    previous_marks:  { maxLength: 12 },
    previous_class:  { maxLength: 8 },
    home_address:    { maxLength: 100 },
    previous_school: { maxLength: 80 },
    occupation:      { maxLength: 40 },
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = maskInput(k, e.target.value);
    setForm(f => ({ ...f, [k]: value }));
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
        if (digits.length !== 13) return "Must be exactly 13 digits";
        return null;
      }
      case "contact_number": {
        if (!v) return "This field is required";
        const digits = v.replace(/\D/g, "");
        if (digits.length !== 11) return "Mobile number must be exactly 11 digits";
        if (!digits.startsWith("03")) return "Mobile number must start with 03";
        return null;
      }
      case "whatsapp_number": {
        if (!v) return null; // optional
        const digits = v.replace(/\D/g, "");
        if (digits.length !== 11) return "Mobile number must be exactly 11 digits";
        if (!digits.startsWith("03")) return "Mobile number must start with 03";
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
        if (digits.length !== 13) return "Must be exactly 13 digits";
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
      toast.success("Application submitted successfully!");
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
          <div className="space-y-4">
            <AdmissionHome
              isOpen={isEffectivelyOpen}
              sessionLabel={displaySessionYear}
              lastDate={settings?.last_date}
              bannerMessage={settings?.banner_message}
              closedNote={nextOpeningNote}
              downloading={downloading}
              hasLibFile={(k) => !!libFiles[k]}
              onApply={startApply}
              onTrack={() => { setView("track"); window.scrollTo({ top: 0 }); }}
              onDownloadItem={generateAndDownload}
              onDownloadBlank={generateEmptyForm}
              onDownloadAll={downloadAll}
              onLocked={() => toast.error(nextOpeningNote || "Admissions are currently closed.")}
            >
              {/* Classes & Seats + Merit Lists sit above Eligibility / Downloads */}
              <Suspense fallback={null}><ClassesAndSeats processingFee={settings?.processing_fee ?? null} /></Suspense>
              <Suspense fallback={null}><AdmissionMeritLists /></Suspense>
            </AdmissionHome>
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
              <h2 className="text-lg font-bold text-foreground">Online Application</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Fill in the details below to apply. Seats are filled through the Merit List.
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

                <Card className="overflow-hidden rounded-2xl border-border shadow-md">
                  <CardContent className="p-5 space-y-4">

                    {/* Step 1 — Student Info (with icons & tooltips) */}
                    {step === 1 && (
                      <>
                        <div className="-mx-5 -mt-5 mb-1 flex items-center gap-3 rounded-t-xl border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                            <User className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h2 className="text-base font-bold leading-tight">Student Information</h2>
                            <p className="text-[11px] text-muted-foreground">Step 1 of 3 — about the student</p>
                          </div>
                        </div>
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
                                <f.icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/60" />
                                <Input value={(form as any)[f.id]} onChange={set(f.id)} onBlur={validateField(f.id)}
                                  placeholder={f.placeholder}
                                  {...FIELD_INPUT_PROPS[f.id]}
                                  aria-invalid={!!fieldErrors[f.id]}
                                  className={`h-11 rounded-xl bg-muted/30 text-sm pl-10 transition-colors focus-visible:bg-background ${fieldErrors[f.id] ? "border-red-500 focus-visible:ring-red-400" : ""}`} />
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
                        <div className="-mx-5 -mt-5 mb-1 flex items-center gap-3 rounded-t-xl border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                            <BookOpen className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h2 className="text-base font-bold leading-tight">Academic Information</h2>
                            <p className="text-[11px] text-muted-foreground">Step 2 of 3 — class & previous school</p>
                          </div>
                        </div>
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
                              <span>Class {form.applying_class} migration is completed school-to-school on the BISE Peshawar portal within the board's notified migration window — Track progress after submission.</span>
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
                                <f.icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/60" />
                                <Input value={(form as any)[f.id]} onChange={set(f.id)} onBlur={validateField(f.id)}
                                  placeholder={f.placeholder}
                                  {...FIELD_INPUT_PROPS[f.id]}
                                  aria-invalid={!!fieldErrors[f.id]}
                                  className={`h-11 rounded-xl bg-muted/30 text-sm pl-10 transition-colors focus-visible:bg-background ${fieldErrors[f.id] ? "border-red-500 focus-visible:ring-red-400" : ""}`} />
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
                        <div className="-mx-5 -mt-5 mb-1 flex items-center gap-3 rounded-t-xl border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-4">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                            <Eye className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <h2 className="text-base font-bold leading-tight">Review & Submit</h2>
                            <p className="text-[11px] text-muted-foreground">Step 3 of 3 — confirm and send</p>
                          </div>
                        </div>
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
                              <p className="text-[10px] text-muted-foreground">Pre-filled with the details you entered</p>
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
                Your application has been received. Seats are filled through the Merit List.
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
                  text="Alert when your status changes"
                  className="mb-6 text-left"
                />
              )}

              {/* ── Processing fee: reference + downloads + pay (GHSS-style) ── */}
              {referenceNo && Number(settings?.processing_fee ?? 0) > 0 && (
                <div className="space-y-3 mb-6 text-left">
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1.5">
                      <BadgeCheck className="w-4 h-4" /> Processing Fee — Rs {Number(settings?.processing_fee).toLocaleString("en-PK")}
                    </p>
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Pay online (Easypaisa · JazzCash · wallet) or by manual transfer to the school account, then verify on WhatsApp.
                      Your application enters the merit list once the fee is confirmed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => downloadSuccessPdf("challan")} disabled={!!pdfBusy}
                        className="h-9 gap-1.5 rounded-full px-3.5 text-xs font-bold">
                        {pdfBusy === "challan" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                        {paymentRef ? "Fee Challan" : "Generate + Fee Challan"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadSuccessPdf("application")} disabled={!!pdfBusy}
                        className="h-9 gap-1.5 rounded-full px-3.5 text-xs font-bold">
                        {pdfBusy === "application" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                        Application PDF
                      </Button>
                    </div>
                  </div>
                  <Suspense fallback={null}>
                    <OnlinePayPanel
                      referenceNo={referenceNo}
                      bFormNo={(form.b_form_no || "").replace(/[^0-9]/g, "")}
                      processingFee={Number(settings?.processing_fee ?? 0)}
                      paymentReference={paymentRef}
                      feeDeadline={null}
                      accounts={(settings?.payment_accounts ?? []) as any[]}
                      whatsappNumber={settings?.contact_whatsapp ?? null}
                      schoolPhone={school?.phone ?? null}
                      onReference={(ref) => setPaymentRef(ref)}
                      onDownloadChallan={() => downloadSuccessPdf("challan")}
                      challanBusy={pdfBusy === "challan"}
                    />
                  </Suspense>
                </div>
              )}

              <div className="bg-card border border-border rounded-2xl p-4 text-left text-xs space-y-2 mb-6 text-muted-foreground">
                <p className="font-semibold text-foreground text-sm">What happens next:</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">1.</span> Save your reference number</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">2.</span> Seats are allotted through the Merit List</p>
                <p className="flex items-start gap-2"><span className="text-primary font-bold">3.</span> Track your status anytime using B-Form or reference number</p>
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
                  <Suspense key={i} fallback={<div className="h-40 rounded-2xl bg-muted" aria-label="Loading result" />}><TrackResult result={r} /></Suspense>
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
