import { m, useInView, useScroll, useTransform, useSpring, useReducedMotion } from "framer-motion";
import { useRef, useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, Bell, Users, GraduationCap,
  Trophy, ChevronRight,
  BookOpen, Sparkles, BarChart3, Calendar, Image,
  Star, Award, Heart, MapPin, Phone, Mail,
  Shield, Zap, Globe, Lightbulb, RefreshCw,
  Volume2, BookMarked, X as XIcon, Clock, ExternalLink,
  Send, Search
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useSchoolSettings, safeMediaUrl, optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";
import { useNotices } from "@/hooks/useNotices";
import { useTeachers } from "@/hooks/useTeachers";
import { useCountUp } from "@/hooks/useCountUp";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import EditorialNoticeCard from "@/components/shared/EditorialNoticeCard";
import NoticePollCard from "@/components/shared/NoticePollCard";
import TextToSpeechPlayer from "@/components/shared/TextToSpeechPlayer";
import type { Notice } from "@/hooks/useNotices";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cachedOrDirect } from "@/lib/publicData";
import { armAutoPublish } from "@/lib/autoPublish";
import DailyQuoteCard from "@/components/shared/DailyQuoteCard";
import { useAdmissionSettings } from "@/hooks/useAdmission";
import AIAssistantWidget from "@/components/shared/AIAssistantWidget";
import Deferred from "@/components/shared/Deferred";

/* ─── Animation variants ─── */
// PERF: short, small-distance reveals. Big offsets (y: 60) with long 0.7 s
// durations made sections visibly "crawl" in on slow phones and kept the
// compositor busy while the visitor was scrolling. These are quick and subtle.
const stagger = {
  parent: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  child: {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
  },
};

// Section-level reveal is now handled per content block by <ScrollStage>,
// so this variant is intentionally a no-op (kept so existing props still work).
const sectionFadeUp = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

/* Perf: several decorative background blobs/rings loop forever
   (repeat: Infinity) even when scrolled off-screen, which adds
   constant CPU/GPU work on lower-end phones. This just returns
   false when the OS-level "reduce motion" setting is on, so those
   loops don't run — the elements themselves stay visible, nothing
   is removed, they're just static instead of endlessly animating. */
function usePrefersMotion() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setOk(!mq.matches);
    const handler = () => setOk(!mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return ok;
}

/* ─── ScrollReveal ─── */
function ScrollReveal({ children, delay = 0, direction = "up" }: {
  children: React.ReactNode; delay?: number; direction?: "up" | "down" | "left" | "right";
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  return (
    <m.div ref={ref}
      initial={{ opacity: 0, y: direction === "up" ? 16 : direction === "down" ? -16 : 0, x: direction === "left" ? 16 : direction === "right" ? -16 : 0 }}
      animate={isInView ? { opacity: 1, y: 0, x: 0 } : {}}
      transition={{ duration: 0.35, delay: Math.min(delay, 0.15), ease: "easeOut" }}
    >{children}</m.div>
  );
}

/* ─── ScrollStage ───
   Scroll-LINKED reveal: content rises, un-scales and fades in as it enters,
   then dissolves (fade + shrink + lift) as it leaves the top of the screen.
   Section titles stay outside the stage so they remain crisp.
   Only transform + opacity are animated (GPU-composited, no blur) so it
   stays smooth on low-end phones. Tall blocks are measured by their own
   top / bottom edges, so content is never dimmed while being read. Falls
   back to a plain wrapper when the visitor prefers reduced motion. */
type StageVariant = "rise" | "zoom" | "left" | "right";
function ScrollStage({
  children, className = "", variant = "rise", enter = true, exitOffset,
}: {
  children: React.ReactNode; className?: string; variant?: StageVariant; enter?: boolean;
  exitOffset?: [string, string];
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: inRaw } = useScroll({ target: ref, offset: ["start end", "start 0.62"] as any });
  const { scrollYProgress: outRaw } = useScroll({ target: ref, offset: (exitOffset ?? ["end 0.38", "end 0"]) as any });
  const spring = { stiffness: 140, damping: 26, mass: 0.35 };
  const pin = useSpring(inRaw, spring);
  const pout = useSpring(outRaw, spring);
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const opacity = useTransform([pin, pout], ([i, o]: number[]) =>
    (enter ? clamp01(i * 1.15) : 1) * clamp01(1 - o * 1.1));
  const y = useTransform([pin, pout], ([i, o]: number[]) =>
    (enter && variant !== "zoom" ? (1 - clamp01(i)) * 56 : 0) - clamp01(o) * 44);
  const x = useTransform(pin, (i: number) =>
    !enter ? 0 : variant === "left" ? (1 - clamp01(i)) * -42 : variant === "right" ? (1 - clamp01(i)) * 42 : 0);
  const scale = useTransform([pin, pout], ([i, o]: number[]) => {
    const base = !enter ? 1 : variant === "zoom" ? 0.88 + 0.12 * clamp01(i) : 0.95 + 0.05 * clamp01(i);
    return base - clamp01(o) * 0.06;
  });

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <m.div ref={ref} className={className} style={{ opacity, y, x, scale, willChange: "transform, opacity" }}>
      {children}
    </m.div>
  );
}

/* ─── Animated counter ─── */
/**
 * SEO/prerender-safe: starts at the FINAL value so build-time prerenders and
 * no-JavaScript crawlers always read the real number (never a misleading
 * "0+"). The 0→end animation plays only when scrolled into view (below).
 */
function useCountUpAnim(end: number, isInView: boolean) {
  const [count, setCount] = useState(end);
  useEffect(() => {
    if (!isInView) {
      setCount(end);
      return;
    }
    const duration = 2000;
    let frame = 0;
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(end * ease));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setCount(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [end, isInView]);
  return count;
}
function AnimCounter({ value, suffix = "", isInView }: { value: number; suffix?: string; isInView: boolean }) {
  const c = useCountUpAnim(value, isInView);
  return <>{c}{suffix}</>;
}

/* ─── Premium stat tile (stats bar) ─── */
const StatTile = ({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <div className={`group relative overflow-hidden rounded-xl border border-border/80 bg-gradient-to-b from-card to-secondary/40 px-3 py-4 md:py-5 text-center transition-all duration-300 hover:border-gold/60 hover:shadow-card ${wide ? "col-span-2 md:col-span-1" : ""}`}>
    <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
    <div className="text-[1.55rem] md:text-[1.75rem] leading-none font-heading font-extrabold tabular-nums bg-gradient-to-r from-primary via-primary-light to-gold bg-clip-text text-transparent">{children}</div>
    <div className="mt-1.5 text-[10px] md:text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">{label}</div>
  </div>
);

const CountStat = ({ value, label, suffix = "", wide }: { value: number; label: string; suffix?: string; wide?: boolean }) => {
  const { count, ref } = useCountUp(value);
  return (
    <div ref={ref} className={wide ? "col-span-2 md:col-span-1" : ""}>
      <StatTile label={label}>{count}{suffix}</StatTile>
    </div>
  );
};

// Same visual treatment as CountStat, for stats whose value is a grade
// string (e.g. "A+", "A1", "A++") rather than a number — board results
// aren't a quantity that can be counted up, so this renders statically.
const TextStat = ({ value, label, wide }: { value: string; label: string; wide?: boolean }) => (
  <StatTile label={label} wide={wide}>{value}</StatTile>
);

/* ─── Reusable section header ─── */
const SectionHeader = ({ eyebrow, title, subtitle, center = true }: { eyebrow?: string; title: string; subtitle?: string; center?: boolean }) => (
  <div className={`mb-10 md:mb-14 ${center ? "text-center" : ""}`}>
    {eyebrow && (
      <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1 eyebrow">
        <span className="w-1.5 h-1.5 rotate-45 bg-gold" />{eyebrow}
      </span>
    )}
    <h2 className="section-title">{title}</h2>
    <div className={`mt-4 flex items-center gap-2 ${center ? "justify-center" : ""}`}>
      <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold/70" />
      <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
      <span className="h-px w-12 bg-gradient-to-l from-transparent to-gold/70" />
    </div>
    {subtitle && <p className="section-subtitle">{subtitle}</p>}
  </div>
);

/* ─── Features data ─── */
const features = [
  { icon: BookOpen,    title: "Quality Curriculum", desc: "Comprehensive KPK board-aligned syllabus with modern teaching methods." },
  { icon: Trophy,      title: "Top Results",         desc: "Consistently achieving outstanding pass results across all classes." },
  { icon: GraduationCap, title: "Expert Teachers",  desc: "Qualified and experienced faculty dedicated to student success." },
];


/* ─── Free Dictionary API types ─── */
interface DictPhonetic { text?: string; audio?: string; }
interface DictDefinition { definition: string; example?: string; synonyms: string[]; }
interface DictMeaning { partOfSpeech: string; definitions: DictDefinition[]; }
interface DictEntry { word: string; phonetics: DictPhonetic[]; meanings: DictMeaning[]; }

/* ─── Word of the Day — 100% online via /api/word-of-day ──────────────────
 * The browser makes a SINGLE same-origin call to /api/word-of-day, which
 * is a Vercel serverless function that does the heavy lifting:
 *
 *   1. Wordnik's curated "word of the day"  (highest quality)
 *   2. Wordnik's previous-day word looked up in Free Dictionary
 *   3. Datamuse word picker + Free Dictionary lookup (last-resort fallback)
 *
 * Each upstream is tried in order; the first one that returns a real
 * word + definition + example wins. The chosen entry is cached on the
 * server for the rest of the day (PKT timezone), so every visitor sees
 * the same word, the lookup is instant, and we never hammer the APIs.
 *
 * Why server-side, not browser-side?
 *   • The project's CSP `connect-src` only whitelists `self` + a small
 *     list of approved domains — api.datamuse.com and api.dictionaryapi.dev
 *     are NOT on it, so browser fetch() to them was silently blocked,
 *     which is why the homepage always showed "Could not load today's
 *     word. Please check your connection."
 *   • The school's region has intermittent connectivity to those APIs;
 *     routing through Vercel's edge keeps it fast and reliable.
 *
 * NO offline fallback, NO built-in word list, NO guessing. If the API
 * genuinely can't be reached, the section renders the existing
 * "Could not load today's word — Retry" UI (and the Retry button just
 * re-calls the same endpoint).
 * ──────────────────────────────────────────────────────────────────────── */
async function getTodayEntry(): Promise<DictEntry | null> {
  try {
    const res = await fetch("/api/word-of-day", {
      method: "GET",
      headers: { Accept: "application/json" },
      // 10s client-side cap so the UI never hangs forever.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[WordOfDay] /api/word-of-day returned HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data || data.ok !== true || !data.word || !Array.isArray(data.meanings) || data.meanings.length === 0) {
      console.error("[WordOfDay] /api/word-of-day returned an empty/invalid body:", data);
      return null;
    }
    // The API returns the same shape as DictEntry (`word`, `phonetics`,
    // `meanings`) so the rest of the component needs no changes.
    return data as DictEntry;
  } catch (err) {
    console.error("[WordOfDay] /api/word-of-day fetch failed:", err);
    return null;
  }
}

/** Look up a word's definition via our /api/word-of-day?word=... proxy.
 *  Same-origin call → no CSP issues, no region blocks. */
async function lookupWord(word: string): Promise<DictEntry | null> {
  const w = word.toLowerCase().trim();
  if (!w) return null;
  try {
    const res = await fetch(
      `/api/word-of-day?word=${encodeURIComponent(w)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.ok !== true || !data.word) return null;
    return data as DictEntry;
  } catch {
    return null;
  }
}

/* ─── Global double-click definition popup ─── */
function GlobalDefinitionPopup() {
  const [popup, setPopup] = useState<{ word: string; x: number; y: number; entry: DictEntry | null; loading: boolean } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = async (e: MouseEvent) => {
      if (e.detail !== 2) return;

      // ── Scope guard (fix for 2.1) ──────────────────────────────────────
      // Never trigger the dictionary popup when the double-click happens
      // inside an editable element. This includes native form controls,
      // contenteditable regions (TipTap, Lexical, plain divs), and any
      // element explicitly opted out via `[data-no-dict]`. Also bail out
      // while a modal/dialog is open so the lookup doesn't steal focus
      // or stack on top of an overlapping dialog.
      const target = e.target as Element | null;
      if (target) {
        const editable = target.closest(
          'input, textarea, select, ' +
          '[contenteditable=""], [contenteditable="true"], ' +
          '[role="textbox"], ' +
          '[data-no-dict]'
        );
        if (editable) return;
        // Skip if a shadcn/radix dialog or sheet is currently open.
        if (document.querySelector('[role="dialog"][data-state="open"], [role="presentation"][data-state="open"]')) {
          return;
        }
      }

      const sel = window.getSelection();
      const raw = sel?.toString().trim();
      if (!raw || raw.length < 2 || raw.length > 40 || /\s/.test(raw)) return;
      const word = raw.replace(/[^a-zA-Z'-]/g, "");
      if (!word) return;
      const x = Math.min(e.clientX, window.innerWidth - 280);
      const y = e.clientY + window.scrollY;
      setPopup({ word, x, y, entry: null, loading: true });
      const entry = await lookupWord(word);
      setPopup((prev) => prev && prev.word === word ? { ...prev, entry, loading: false } : prev);
    };
    document.addEventListener("dblclick", handler);
    return () => document.removeEventListener("dblclick", handler);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const close = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopup(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [popup]);

  if (!popup) return null;

  const audioUrl = popup.entry?.phonetics.find((p) => p.audio && p.audio.startsWith("http"))?.audio;
  const phonetic = popup.entry?.phonetics.find((p) => p.text)?.text;
  const meaning = popup.entry?.meanings[0];
  const def = meaning?.definitions[0];

  const speakPopupWord = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(popup.word);
    utter.lang = "en-US"; utter.rate = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.lang.startsWith("en") && !v.name.includes("Google")) || voices.find(v => v.lang.startsWith("en"));
    if (v) utter.voice = v;
    window.speechSynthesis.speak(utter);
  };

  return (
    <div
      ref={popupRef}
      style={{ position: "absolute", top: popup.y + 14, left: popup.x, zIndex: 99999, maxWidth: 280 }}
      className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookMarked className="w-3.5 h-3.5 text-white shrink-0" />
          <span className="font-black text-white text-sm truncate capitalize">{popup.word}</span>
          {phonetic && <span className="text-white/70 text-[11px] font-mono shrink-0">{phonetic}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={speakPopupWord} className="p-1 rounded-full hover:bg-white/20 text-white transition-colors" title="Hear pronunciation">
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          <button onClick={() => setPopup(null)} className="p-1 rounded-full hover:bg-white/20 text-white transition-colors">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="p-3 text-xs space-y-1.5">
        {popup.loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-2">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Looking up…
          </div>
        ) : !popup.entry ? (
          <p className="text-muted-foreground py-1">No definition found for "{popup.word}".</p>
        ) : (
          <>
            {meaning && <span className="text-[10px] font-bold uppercase tracking-wider text-azure-strong dark:text-azure bg-azure-soft px-2 py-0.5 rounded-full">{meaning.partOfSpeech}</span>}
            {def && <p className="text-foreground leading-relaxed mt-1">{def.definition}</p>}
            {def?.example && <p className="text-muted-foreground italic">"{def.example}"</p>}
            {def?.synonyms && def.synonyms.length > 0 && (
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">Synonyms:</span> {def.synonyms.slice(0, 3).join(", ")}
              </p>
            )}
          </>
        )}
        <p className="text-[9px] text-muted-foreground/50 pt-0.5 border-t border-border">Double-click any word for definition</p>
      </div>
    </div>
  );
}

/* ─── Word of the Day section ─── */
function WordOfDaySection() {
  // getTodayEntry() fetches a word live from the online dictionary API.
  // Hold the entry in state and render nothing until it resolves.
  const [todayEntry, setTodayEntry] = useState<DictEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [activeMeaning, setActiveMeaning] = useState(0);

  const fetchEntry = useCallback(() => {
    setLoading(true);
    setError(false);
    let cancelled = false;
    getTodayEntry().then((entry) => {
      if (!cancelled) {
        if (entry) {
          setTodayEntry(entry);
        } else {
          setError(true);
        }
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setError(true);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // PERF: this section sits well below the fold. Fetching the word the
    // instant the homepage mounts made the /api/word-of-day serverless call
    // compete with the Supabase content queries during the critical load
    // window. Deferring to browser-idle (fallback: 3.5s) keeps the word
    // loading "soon enough" for anyone scrolling down, while the initial
    // paint gets the whole network to itself.
    let cleanupFn: (() => void) | undefined;
    const start = () => { cleanupFn = fetchEntry(); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(start, { timeout: 3500 });
    } else {
      const t = setTimeout(start, 2000);
      return () => { clearTimeout(t); cleanupFn?.(); };
    }
    return () => cleanupFn?.();
  }, [fetchEntry]);

  // Preload voices on mount (Chrome needs a gesture or small delay)
  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  // Today's date label
  const todayLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Show loading or error state while fetching from online API
  if (loading) {
    return (
      <m.section
        initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }}
        variants={sectionFadeUp}
        className="section-y cv-auto"
      >
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <SectionHeader
              title="Word of the Day"
            />
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="max-w-2xl mx-auto">
              <div className="bg-card border border-gold/40 rounded-3xl overflow-hidden shadow-card">
                <div className="bg-gradient-to-r from-primary via-primary to-primary/80 px-5 py-8">
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="text-white/80 text-sm font-medium">Loading today's word…</span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </m.section>
    );
  }

  if (error || !todayEntry) {
    return (
      <m.section
        initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }}
        variants={sectionFadeUp}
        className="section-y cv-auto"
      >
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <SectionHeader
              title="Word of the Day"
            />
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <div className="max-w-2xl mx-auto">
              <div className="bg-card border border-gold/40 rounded-3xl overflow-hidden shadow-card">
                <div className="bg-gradient-to-r from-primary via-primary to-primary/80 px-5 py-8">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <span className="text-white/80 text-sm font-medium">Could not load today's word. Please check your connection.</span>
                    <button
                      onClick={fetchEntry}
                      className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/35 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" /> Retry
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </m.section>
    );
  }

  const phonetic = todayEntry.phonetics?.find((p) => p.text)?.text ?? null;
  const meaning = todayEntry.meanings?.[activeMeaning] ?? todayEntry.meanings?.[0];

  // Web Speech API — works on every device, no network, no key, no blocked domains
  const speakWord = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(todayEntry.word);
    utter.lang = "en-US";
    utter.rate = 0.85;
    utter.pitch = 1;
    // Pick a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith("en") && !v.name.includes("Google")) || voices.find(v => v.lang.startsWith("en"));
    if (enVoice) utter.voice = enVoice;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  return (
    <m.section
      initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }}
      variants={sectionFadeUp}
      className="section-y cv-auto"
    >
      <div className="container mx-auto px-4">
        <ScrollReveal>
          <SectionHeader
            title="Word of the Day"
          />
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <div className="max-w-2xl mx-auto">
            {/* Gold hairline frame */}
            <div className="rounded-[28px] bg-gradient-to-br from-[#E3B341] via-[#E3B341]/30 to-[#E3B341]/80 p-px shadow-card">
              <div className="overflow-hidden rounded-[27px] bg-card">

                {/* ── Hero ── */}
                <div
                  className="relative overflow-hidden px-5 pb-6 pt-5 sm:px-7 sm:pb-7 sm:pt-6 text-white"
                  style={{ background: "radial-gradient(120% 90% at 100% 0%, rgba(227,179,65,0.28) 0%, rgba(227,179,65,0) 55%), linear-gradient(135deg, #064e3b 0%, #065f46 55%, #047857 100%)" }}
                >
                  {/* oversized watermark letter */}
                  <span aria-hidden className="pointer-events-none absolute -right-2 -bottom-10 select-none font-heading italic text-[9rem] sm:text-[11rem] leading-none text-white/[0.06]">
                    {todayEntry.word.charAt(0).toUpperCase()}
                  </span>

                  <div className="relative flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E3B341]/50 bg-black/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#FDE68A]">
                      <span className="h-1.5 w-1.5 rotate-45 bg-[#E3B341]" /> Today
                    </span>
                    <span className="text-[11px] font-semibold tracking-wide text-white/80">{todayLabel}</span>
                  </div>

                  <div className="relative mt-5 flex items-center gap-4">
                    <button
                      onClick={speakWord}
                      aria-label="Hear pronunciation"
                      title="Tap to hear pronunciation"
                      className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FDE68A] to-[#E3B341] text-emerald-900 shadow-lg shadow-black/25 transition-transform active:scale-95 ${speaking ? "ring-4 ring-[#E3B341]/40" : ""}`}
                    >
                      {speaking && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#E3B341]/40" />}
                      <Volume2 className={`relative h-6 w-6 ${speaking ? "animate-pulse" : ""}`} />
                    </button>

                    <div className="min-w-0 flex-1">
                      <h3
                        className={`font-heading italic font-bold capitalize leading-[1.05] tracking-tight break-words text-white ${
                          todayEntry.word.length > 12 ? "text-3xl sm:text-4xl"
                          : todayEntry.word.length > 8 ? "text-4xl sm:text-5xl"
                          : "text-5xl sm:text-6xl"
                        }`}
                      >
                        {todayEntry.word}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {phonetic && <span className="font-heading text-[15px] italic text-[#FDE68A]">{phonetic}</span>}
                        {meaning?.partOfSpeech && (
                          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/90">{meaning.partOfSpeech}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Part-of-speech tabs ── */}
                {(todayEntry.meanings?.length ?? 0) > 1 && (
                  <div className="flex flex-wrap gap-1.5 px-5 pt-5 sm:px-7">
                    {todayEntry.meanings.map((m, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveMeaning(i)}
                        className={`rounded-full border px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                          activeMeaning === i
                            ? "border-emerald-700 bg-emerald-800 text-white"
                            : "border-border bg-background text-muted-foreground hover:border-[#E3B341]/60"
                        }`}
                      >
                        {m.partOfSpeech}
                      </button>
                    ))}
                  </div>
                )}

                {/* ── Definitions ── */}
                {meaning && (
                  <div className="space-y-4 px-5 py-5 sm:px-7">
                    {meaning.definitions.slice(0, 3).map((def, i) => (
                      <div key={i} className={i > 0 ? "border-t border-border/60 pt-4" : ""}>
                        <div className="flex gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E3B341]/15 font-heading text-[12px] font-bold text-[#8a6508] dark:text-[#E3B341]">{i + 1}</span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="text-[15px] leading-relaxed text-foreground">{def.definition}</p>
                            {def.example && (
                              <p className="border-l-2 border-[#E3B341] pl-3 font-heading text-[14px] italic leading-relaxed text-muted-foreground">
                                “{def.example}”
                              </p>
                            )}
                            {def.synonyms?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                {def.synonyms.slice(0, 4).map((syn) => (
                                  <span key={syn} className="rounded-full border border-emerald-600/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">{syn}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Footer ── */}
                <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-5 py-3 sm:px-7">
                  <BookMarked className="h-4 w-4 shrink-0 text-[#B8860B]" />
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    <span className="font-semibold text-foreground">Tip:</span> double-click any English word on this site to see its meaning. A new word every day.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </m.section>
  );
}

// ── School's own result countdown / live state ───────────────────────────
// Mirrors the exact logic already used on /results (useHasPublishedSchoolResults
// + the scheduled-result-publishes query in Results.tsx) so the homepage,
// the /results page, and the admin panel all agree on one source of truth:
// the `results` table's is_published / publish_at columns.
//
//   • If the school has published results (any row is_published = true) →
//     show a LIVE "View Result" banner and hide BISE Peshawar entirely.
//   • Else if the school has an active countdown (publish_at in the future
//     on unpublished rows) → show ONE countdown card for it (grouped by
//     publish_at, same as /results) and hide BISE Peshawar.
//   • Else (no school result, no schedule) → fall back to the BISE
//     Peshawar banner, same as before.
interface ScheduledGroup { publish_at: string; exam_type: string; year: number; classes: string[]; }

function useSchoolScheduledPublish() {
  return useQuery<ScheduledGroup[]>({
    queryKey: ["scheduled-result-publishes-raw"],
    queryFn: async () => {
      // Phase 5: cached public read (CDN s-maxage 30 s) — the homepage's
      // countdown schedule used to cost one DB query per visitor. After a
      // publish, markPublishBust (autoPublish) forces a fresh origin read.
      const data = await cachedOrDirect<
        { class: string; exam_type: string; year: number; publish_at: string }[]
      >("result-schedule", {}, async () => {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from("results")
          .select("class, exam_type, year, publish_at")
          .eq("is_published", false)
          .not("publish_at", "is", null)
          .gt("publish_at", now)
          .order("publish_at", { ascending: true });
        if (error) throw error;
        return (data ?? []) as { class: string; exam_type: string; year: number; publish_at: string }[];
      });
      if (!data || data.length === 0) return [];
      // Group by publish_at so "All Classes At Once" schedules collapse
      // into ONE countdown instead of one per class.
      const byPublishAt = new Map<string, ScheduledGroup>();
      for (const r of data) {
        const key = r.publish_at as string;
        if (!byPublishAt.has(key)) {
          byPublishAt.set(key, { publish_at: key, exam_type: r.exam_type, year: r.year, classes: [r.class] });
        } else {
          const g = byPublishAt.get(key)!;
          if (!g.classes.includes(r.class)) g.classes.push(r.class);
        }
      }
      // Sort classes on a COPY, never in place — mutating a React Query
      // cache entry's array with .sort() during render is what caused the
      // homepage "Something went wrong" crash (React detects the mutated
      // cached reference changing shape mid-render and throws).
      return Array.from(byPublishAt.values())
        .map(g => ({ ...g, classes: [...g.classes].sort((a, b) => Number(a) - Number(b)) }))
        .sort((a, b) => a.publish_at.localeCompare(b.publish_at));
    },
    // This used to refetch every 30 seconds for as long as the tab was open,
    // backgrounded or not. The watcher below already knows exactly when the
    // next publish is due and re-checks the cache itself, so a blind 30s poll
    // just kept the radio busy and added latency. Now it only refreshes when
    // the page is actually visible, and much less often.
    refetchInterval: (() => {
      if (typeof document !== "undefined" && document.hidden) return false;
      return 5 * 60 * 1000;
    })(),
    refetchIntervalInBackground: false,
    staleTime: 60 * 1000,
  });
}

// Arms exact-moment publishing for every active schedule while the homepage
// is open (src/lib/autoPublish.ts): server-clock sync, function pre-warm, the
// server flips the rows at 00:00:00 and the caches are updated in the same
// tick. It is the SAME publisher the Navbar strip and /results use — each
// publish_at is handled exactly once app-wide — so the old per-page polling
// watcher (raw phone clock + DB polling + blind invalidations, which raced the
// publisher and made the UI flicker) is gone.
function useHomeAutoPublishWatcher(schedules: ScheduledGroup[]) {
  const qc = useQueryClient();
  const key = schedules.map((s) => s.publish_at).join("|");
  useEffect(() => {
    if (!key) return;
    return armAutoPublish(key.split("|"), qc);
  }, [key, qc]);
}

function SchoolCountdownText({ targetDate }: { targetDate: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const calc = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setText("Publishing now…"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) setText(`${d}d ${h}h ${m}m ${s}s`);
      else if (h > 0) setText(`${h}h ${m}m ${s}s`);
      else setText(`${m}m ${s}s`);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [targetDate]);
  return <span className="font-mono font-bold tracking-wider">{text}</span>;
}

// ── Hero heading typewriter — "Where bright minds find their light." ──────
// Types out character-by-character across styled segments (gold spans +
// line breaks preserved), holds the finished line, deletes it, then loops
// forever. Segment-aware so the gold highlight colour and <br/> placement
// never break mid-type, unlike a naive plain-string typewriter.
type HeroSegment = { text: string; gold?: boolean; breakAfter?: boolean };
const HERO_SEGMENTS: HeroSegment[] = [
  { text: "Where " },
  { text: "bright" },
  { text: " ", breakAfter: true },
  { text: "minds" },
  { text: " find their", breakAfter: true },
  { text: "light." },
];
const HERO_FULL_LENGTH = HERO_SEGMENTS.reduce((n, s) => n + s.text.length, 0);

function useHeroTypewriter() {
  const reduced = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [count, setCount] = useState(reduced ? HERO_FULL_LENGTH : 0);
  const [deleting, setDeleting] = useState(false);
  // A decorative heading must not keep re-rendering a background tab. This
  // effect re-runs ~20×/second forever, so on a phone that is real, constant
  // main-thread work competing with scrolling and page paint.
  const [tabActive, setTabActive] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setTabActive(!document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (reduced) return; // static full heading, no animation loop
    if (!tabActive) return; // paused while the tab is in the background
    const TYPE_MS = 62;
    const DELETE_MS = 34;
    const HOLD_MS = 2200;
    const RESTART_MS = 500;

    let timer: ReturnType<typeof setTimeout>;

    if (!deleting && count < HERO_FULL_LENGTH) {
      timer = setTimeout(() => setCount(c => c + 1), TYPE_MS);
    } else if (!deleting && count === HERO_FULL_LENGTH) {
      timer = setTimeout(() => setDeleting(true), HOLD_MS);
    } else if (deleting && count > 0) {
      timer = setTimeout(() => setCount(c => c - 1), DELETE_MS);
    } else {
      // count === 0 && deleting — brief pause, then start typing again.
      timer = setTimeout(() => setDeleting(false), RESTART_MS);
    }

    return () => clearTimeout(timer);
  }, [count, deleting, tabActive]);

  // Slice the segment list down to `count` visible characters, preserving
  // each segment's gold/breakAfter flags for however much of it is shown.
  const visible: HeroSegment[] = [];
  let remaining = count;
  for (const seg of HERO_SEGMENTS) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, seg.text.length);
    visible.push({ text: seg.text.slice(0, take), gold: seg.gold, breakAfter: take === seg.text.length && seg.breakAfter });
    remaining -= take;
  }
  return visible;
}

function HeroTypewriterHeading({ className, textColor }: { className: string; textColor: string }) {
  const segments = useHeroTypewriter();
  const reduced = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // PERF: the FULL heading is rendered invisibly to reserve its exact height,
  // and the typed text is overlaid on top. Previously the h1 grew one line at
  // a time while typing, so the whole hero re-centred and re-flowed ~16 times
  // per second — the "stuck / shaky" feel on the homepage. Now the layout is
  // fixed; only the overlay text changes. (The full sentence also stays in
  // the DOM for search engines and screen readers.)
  return (
    <m.h1
      variants={stagger.child}
      className={`${className} ${textColor} relative`}
      aria-label="Where bright minds find their light."
    >
      <span className="block invisible" aria-hidden="true">
        {HERO_SEGMENTS.map((seg, i) => (
          <span key={i}>
            <span>{seg.text}</span>
            {seg.breakAfter && <br />}
          </span>
        ))}
      </span>
      <span className="block absolute inset-0" aria-hidden="true">
        {segments.map((seg, i) => (
          <span key={i}>
            <span>{seg.text}</span>
            {seg.breakAfter && <br />}
          </span>
        ))}
        {!reduced && (
          <span className="inline-block w-[3px] h-[0.85em] -mb-[0.1em] ml-0.5 bg-azure align-middle" aria-hidden="true" />
        )}
      </span>
    </m.h1>
  );
}

// ── Homepage auto-publish watcher (no visible banner) ────────────────────
// The countdown banner itself was removed from the homepage per request —
// the countdown now lives only on /results. This component is kept mounted
// on Home purely so the auto-publish trigger (useHomeAutoPublishWatcher)
// still fires the instant any active schedule reaches zero, even if the
// visitor never opens /results. It renders nothing.
function HomeResultsBanner() {
  const { data: schedules = [] } = useSchoolScheduledPublish();
  useHomeAutoPublishWatcher(schedules);
  return null;
}

/* ══════════════════════════════════
   MAIN HOME COMPONENT
══════════════════════════════════ */
const Home = () => {
  // SPA navigation for in-page CTAs ("My Tracking" below) — never a full
  // document reload, even on the slowest connection.
  const navigate = useNavigate();
  // PERF: the old hero parallax (useScroll + useTransform on y/opacity) ran
  // JavaScript on EVERY scroll event and forced the whole hero to repaint —
  // the main cause of the sticky/hanging scroll feel. The hero now simply
  // scrolls away like normal content.

  const statsRef    = useRef(null);
  const statsInView = useInView(statsRef, { once: true, margin: "-100px" });

  const { data: settings,          isLoading: settingsLoading }      = useSchoolSettings();
  const { data: notices = [],      isLoading: noticesLoading }        = useNotices(4);
  const { data: teachers = [],     isLoading: teachersLoading }       = useTeachers(4);
  const { data: admSettings, isLoading: admLoading }                   = useAdmissionSettings();

  // Treat admissions as closed if last_date has already passed, even if DB is_open=true
  // (mirrors the same fix applied on /admission so both pages always agree)
  const isAdmissionEffectivelyOpen = (() => {
    if (!admSettings?.is_open) return false;
    if (!admSettings.last_date) return true;
    return new Date(admSettings.last_date) >= new Date(new Date().toDateString());
  })();

  // Track if banner image failed to load — show fallback bg instead of broken icon
  const [bannerFailed, setBannerFailed] = useState(false);
  const [bannerUsingOriginal, setBannerUsingOriginal] = useState(false);
  const [principalUsingOriginal, setPrincipalUsingOriginal] = useState(false);
  const [principalFailed, setPrincipalFailed] = useState(false);
  // Reset banner failed state when URL changes
  useEffect(() => {
    setBannerFailed(false);
    setBannerUsingOriginal(false);
  }, [settings?.banner_url]);
  useEffect(() => {
    setPrincipalUsingOriginal(false);
    setPrincipalFailed(false);
  }, [settings?.principal_photo_url]);

  // TTS player state — when set, the bottom TTS bar renders & auto-plays.
  // Wired up by the notices' onListen handlers (EditorialNoticeCard / poll cards).
  const [ttsItem, setTtsItem] = useState<{ title: string; content: string } | null>(null);

  const hasBannerPhoto = !!(settings?.banner_url && !bannerFailed);
  // The banner photo now renders inside a hexagon badge instead of as a
  // full-bleed background, so hero text/overlay always use the "no photo"
  // (light gradient background) styling regardless of whether a banner exists.
  const heroOverlay = "bg-transparent";
  const heroBadgeBg   = "bg-card/70 border border-azure/30 text-foreground/90";
  const heroTextColor = "text-foreground";
  const heroSubColor  = "text-foreground/80";
  const heroDescColor = "text-muted-foreground";
  const heroCursorColor = "bg-primary/80";
  const heroStatCard = "bg-card border border-border";


  return (
    <>
    <PageLayout>

      {/* Invisible — keeps the auto-publish watcher alive on the homepage.
          The visible countdown banner now lives only on /results. */}
      <HomeResultsBanner />

      {/* ══ 2. HERO ══ */}
      <section id="hero-section" className="relative md:min-h-[88vh] flex items-start md:items-center overflow-hidden">

        {/* ── Background: soft green-paper gradient with a whisper of gold
             (light) / deep green-black gradient (dark) — the Green & Gold
             hero. Dark: variant keeps hero text tokens readable ── */}
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(90,60%,98%)] via-[hsl(129,30%,96%)] to-[hsl(42,71%,92%)] dark:from-[hsl(147,48%,8%)] dark:via-[hsl(147,42%,12%)] dark:to-[hsl(150,35%,16%)]" />
        {/* Premium decoration — static radial gradients only (cheap on phones) */}
        <div className="orb orb-gold w-[520px] h-[520px] -top-48 -right-40 opacity-90" />
        <div className="orb orb-primary w-[460px] h-[460px] -bottom-48 -left-32" />
        <div className="absolute inset-0 dot-grid opacity-[0.07] dark:opacity-[0.10]" style={{ maskImage: "radial-gradient(ellipse at 70% 30%, black 10%, transparent 70%)", WebkitMaskImage: "radial-gradient(ellipse at 70% 30%, black 10%, transparent 70%)" }} />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />

        {/* ── Dark gradient overlay so text stays readable ── */}
        <div className={`absolute inset-0 ${heroOverlay}`} />

        {/* ── Foreground content ── */}
        <ScrollStage enter={false} exitOffset={["start start", "end start"]} className="container mx-auto px-4 sm:px-6 relative z-10 pt-10 pb-16 md:pt-6 md:pb-24">
          <div className="grid grid-cols-1 items-center">
            <m.div initial="hidden" animate="visible" variants={stagger.parent} className="max-w-2xl relative">

              {/* Est. badge — thin premium pill: gold left hairline + soft gold wash */}
              <m.div variants={stagger.child}>
                <span className="inline-flex items-center gap-2.5 rounded-full border border-gold/35 bg-gold/[0.07] dark:bg-gold/10 pl-2.5 pr-4 py-1.5 text-[11px] sm:text-xs font-semibold tracking-[0.1em] uppercase text-foreground/90 shadow-[inset_3px_0_0_0_hsl(var(--gold))]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-strong text-white shrink-0"><Award className="w-3 h-3" /></span>
                  <span className="whitespace-nowrap">Est. {settings?.established_year || 2018} · EMIS {settings?.emis_code || "60673"}</span>
                </span>
              </m.div>
              <HeroTypewriterHeading
                className="mt-5 sm:mt-6 text-[2.65rem] leading-[1.06] sm:text-[3.2rem] sm:leading-[1.05] md:text-[4rem] lg:text-[4.5rem] font-display font-normal tracking-tight"
                textColor={heroTextColor}
              />
              <m.p variants={stagger.child} className={`mt-4 sm:mt-5 text-[16.5px] md:text-xl ${heroDescColor} max-w-xl leading-relaxed`}>
                {settings?.description || "Government High School Babi Khel is committed to providing quality education and nurturing the future leaders of Pakistan."}
              </m.p>

              {/* CTAs — thin professional pills (h-10), gold primary + quiet outline */}
              <m.div variants={stagger.child} className="mt-6 sm:mt-7 flex flex-row flex-nowrap items-center justify-start gap-2.5">
                <Link to="/results">
                  <m.button whileTap={{ scale: 0.97 }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-10 rounded-full bg-gradient-to-r from-gold to-gold-strong text-white dark:text-gold-ink text-sm font-semibold px-6 shadow-[0_6px_16px_-8px_hsl(var(--gold)/0.55)] hover:shadow-[0_8px_20px_-8px_hsl(var(--gold)/0.7)] transition-shadow duration-200">
                    View Results <ArrowRight className="w-4 h-4" />
                  </m.button>
                </Link>
                <Link to="/about">
                  <m.button whileTap={{ scale: 0.97 }}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-10 rounded-full border border-primary/25 hover:border-gold/60 hover:text-primary text-foreground text-sm font-medium px-6 bg-transparent transition-colors duration-200">
                    Learn more
                  </m.button>
                </Link>
              </m.div>

            </m.div>

          </div>
        </ScrollStage>
      </section>

      {/* ══ 3. STATS BAR ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.15 }} variants={sectionFadeUp} className="relative z-20 -mt-10">
        <div className="container mx-auto px-4">
          <ScrollStage variant="zoom">
          <div className="relative overflow-hidden bg-card rounded-3xl shadow-elevated border border-gold/30 p-3 md:p-5">
            <div className="absolute inset-x-6 top-0 h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent" />
            <div className="orb orb-gold w-56 h-56 -top-24 -right-16 opacity-70" />
            <div className="relative grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
              {settingsLoading ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`flex flex-col items-center gap-2 py-4 rounded-2xl border border-border ${i === 4 ? "col-span-2 md:col-span-1" : ""}`}><Skeleton className="h-7 w-16" /><Skeleton className="h-3 w-14" /></div>
              )) : (
                <>
                  <CountStat value={settings?.total_students  || 180} suffix="+" label="Students" />
                  <CountStat value={settings?.total_teachers  || 8}   suffix="+" label="Teachers" />
                  <CountStat value={settings?.pass_percentage || 95}  suffix="%" label="Pass Rate" />
                  <CountStat value={settings?.established_year || 2018}            label="Established" />
                  <TextStat value={settings?.board_results || "A+"}   label="Results" wide />
                </>
              )}
            </div>
          </div>
          </ScrollStage>
        </div>
      </m.section>

      {/* ══ 4. SUBJECTS MARQUEE ══ */}
      <section className="py-5 bg-gradient-to-b from-secondary/40 to-background overflow-hidden border-y border-gold/20 mt-16" style={{ contain: "layout paint" }}>
        <div className="relative flex overflow-hidden">
          {/* PERF: translate3d + will-change promote this to a GPU-composited
              layer so the marquee never hits the main thread (Lighthouse
              "Avoid non-composited animations" fix). The two identical copies
              of the subject list let the keyframe translate exactly -50% for
              a seamless loop with no visible jump. */}
          <div
            className="flex gap-8 shrink-0"
            style={{
              animation: "marqueeScroll 40s linear infinite",
              willChange: "transform",
              transform: "translate3d(0,0,0)",
              backfaceVisibility: "hidden",
            }}
          >
            {["📐 Mathematics","⚡ Physics","🧪 Chemistry","🌿 Biology","📖 English","✍️ Urdu","🗺️ Pakistan Studies","☪️ Islamiyat","💻 Computer Science","📗 Mutalia Quran","🔬 General Science","🌍 Geography","🏛️ History","🪶 Pashto","🕌 Arabic",
              "📐 Mathematics","⚡ Physics","🧪 Chemistry","🌿 Biology","📖 English","✍️ Urdu","🗺️ Pakistan Studies","☪️ Islamiyat","💻 Computer Science","📗 Mutalia Quran","🔬 General Science","🌍 Geography","🏛️ History","🪶 Pashto","🕌 Arabic"]
              .map((s, i) => {
                const [emoji, ...rest] = s.split(" ");
                return (
                  <div key={i} className="flex items-center gap-2 shrink-0 pl-2 pr-4 py-1 rounded-full bg-card border border-border/80 shadow-sm">
                    <span className="text-lg">{emoji}</span>
                    <span className="text-sm font-semibold text-foreground whitespace-nowrap">{rest.join(" ")}</span>
                  </div>
                );
              })}
          </div>
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-background to-transparent z-10" />
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-background to-transparent z-10" />
        </div>
        <style>{`@keyframes marqueeScroll { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(-50%,0,0); } }`}</style>
      </section>

      {/* ══ 5. CAMPUS BANNER ══
          Full-bleed photo (the admin-uploaded banner_url) with a dark
          gradient overlay fading up from the bottom, an eyebrow label, and a
          large serif headline — matching the reference: "CAMPUS · <LOCATION>"
          above "A place shaped by mountains, made for learners." Sits above
          "Why Choose Us" as requested. Only renders when the admin has
          actually uploaded a banner image. */}
      {settings?.banner_url && !bannerFailed && (
        <m.section
          initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.15 }} variants={sectionFadeUp}
          className="container mx-auto px-4 mt-10 md:mt-14"
        >
          <ScrollStage variant="zoom">
          <div className="relative w-full h-[15rem] sm:h-[18rem] md:h-[22rem] overflow-hidden rounded-2xl border border-gold/50 shadow-elevated">
            <img
              src={bannerUsingOriginal
                ? settings.banner_url
                : (optimizedCloudinaryUrl(settings.banner_url, { width: 1600 }) || settings.banner_url)}
              {...(!bannerUsingOriginal && {
                srcSet: [
                  `${optimizedCloudinaryUrl(settings.banner_url, { width: 800 })} 800w`,
                  `${optimizedCloudinaryUrl(settings.banner_url, { width: 1200 })} 1200w`,
                  `${optimizedCloudinaryUrl(settings.banner_url, { width: 1600 })} 1600w`,
                ].join(", "),
              })}
              sizes="(min-width: 1280px) 1152px, 100vw"
              alt="School campus"
              className="absolute inset-0 w-full h-full object-cover object-center"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                // A browser may reject a responsive Cloudinary transform or
                // choose a srcset candidate that is unavailable at its edge.
                // Retry the known-good original before hiding the whole banner.
                if (!bannerUsingOriginal) {
                  event.currentTarget.removeAttribute("srcset");
                  setBannerUsingOriginal(true);
                } else {
                  setBannerFailed(true);
                }
              }}
            />
            {/* dark gradient rising from the bottom so the overlaid text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end">
              <div className="px-5 sm:px-7 md:px-10 pb-6 md:pb-9">
                <span className="inline-flex items-center gap-2 rounded-full border border-gold/60 bg-black/30 px-3.5 py-1 text-gold text-[10px] md:text-xs font-bold uppercase tracking-[0.22em] mb-3">
                  <MapPin className="w-3 h-3" /> Campus · Mohmand
                </span>
                <h2 className="font-display text-2xl sm:text-3xl md:text-5xl font-medium text-white leading-tight max-w-2xl">
                  A place shaped by mountains, made for learners.
                </h2>
              </div>
            </div>
          </div>
          </ScrollStage>
        </m.section>
      )}

      {/* ══ 6. WHY CHOOSE US ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionFadeUp} className="section-y bg-background cv-auto">
        <div className="container mx-auto px-4">
          <ScrollReveal><SectionHeader eyebrow="Our Strengths" title="Why Choose Us" subtitle="We provide a comprehensive educational experience that nurtures young minds" /></ScrollReveal>
          <ScrollStage>
          <m.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={stagger.parent} className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 max-w-5xl mx-auto">
            {features.map((f, idx) => (
              <ScrollReveal key={f.title} delay={idx * 0.08}>
                <m.div variants={stagger.child} whileHover={{ y: -6 }} whileTap={{ scale: 0.98 }}
                  className="group relative overflow-hidden bg-card rounded-2xl p-6 shadow-card hover:shadow-elevated transition-all duration-300 border border-border/80 hover:border-gold/60 h-full">
                  <div className="orb orb-gold w-44 h-44 -top-16 -right-16 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <span className="absolute top-4 right-5 font-heading text-4xl font-bold text-gold/20 select-none">0{idx + 1}</span>
                  <div className="relative w-12 h-12 rounded-xl gradient-hero text-gold flex items-center justify-center mb-4 shadow-card">
                    <f.icon className="w-6 h-6" />
                  </div>
                  <h3 className="relative font-heading font-bold text-foreground text-lg">{f.title}</h3>
                  <p className="relative text-sm text-muted-foreground mt-2 leading-relaxed">{f.desc}</p>
                  <div className="relative mt-4 h-[2px] w-10 bg-gradient-to-r from-gold to-transparent group-hover:w-20 transition-all duration-500" />
                </m.div>
              </ScrollReveal>
            ))}
          </m.div>
          </ScrollStage>
        </div>
      </m.section>

      {/* ══ 8. WORD OF THE DAY ══ */}
      <WordOfDaySection />


      {/* ══ 9. LATEST NOTICES ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionFadeUp} className="section-y bg-background cv-auto">
        <div className="container mx-auto px-4">
          {/* ── Premium section header ── */}
          <div className="mb-8 md:mb-12 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1 eyebrow">
                <Bell className="w-3 h-3" /> Announcements
              </span>
              <h2 className="section-title">Latest Notices</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-md">
                Official notices and announcements from our school administration.
              </p>
            </div>
            <Link to="/notices" className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-4 h-8 text-xs font-semibold text-foreground hover:border-gold/60 hover:text-primary transition-colors">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <ScrollStage>
          {noticesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
            </div>
          ) : notices.length === 0 ? (
            <div className="text-center py-12 bg-card rounded-2xl border border-border">
              <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No notices published yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {notices.map((notice, i) => (
                notice.is_poll ? (
                  <NoticePollCard key={notice.id} item={notice} index={i} />
                ) : (
                  <EditorialNoticeCard
                    key={notice.id}
                    item={notice}
                    index={i}
                    onListen={(it: Notice, e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setTtsItem({ title: it.title, content: it.content || it.title });
                    }}
                  />
                )
              ))}
            </div>
          )}
          </ScrollStage>
        </div>
      </m.section>

      {/* ══ 11. TEACHERS ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionFadeUp} className="section-y bg-background cv-auto">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-10">
            <div><span className="eyebrow">Our Faculty</span><h2 className="section-title">Meet Our Teachers</h2></div>
            <Link to="/teachers" className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/80 bg-card px-4 h-8 text-xs font-semibold text-foreground hover:border-gold/60 hover:text-primary transition-colors">All Teachers <ChevronRight className="w-3.5 h-3.5" /></Link>
          </div>
          <ScrollStage variant="zoom">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {teachersLoading ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card rounded-2xl p-4 sm:p-6 text-center shadow-card"><Skeleton className="w-16 h-16 sm:w-20 sm:h-20 rounded-full mx-auto mb-4" /><Skeleton className="h-5 w-2/3 mx-auto mb-2" /><Skeleton className="h-3 w-1/2 mx-auto" /></div>
            )) : teachers.map((teacher) => (
              <m.div key={teacher.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} whileHover={{ y: -6 }}
                className="bg-card rounded-xl p-4 text-center shadow-card hover:shadow-elevated transition-all duration-300 border border-border/70 hover:border-gold/50 group">
                {teacher.photo_url
                  ? <img src={teacher.photo_url} alt={teacher.full_name} loading="lazy" decoding="async" className="w-16 h-16 rounded-full mx-auto mb-3 object-cover ring-2 ring-secondary group-hover:ring-primary/30 transition-all" />
                  : <div className="w-16 h-16 rounded-full mx-auto mb-3 bg-primary flex items-center justify-center text-white text-lg font-heading font-bold">{(teacher.full_name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2)}</div>
                }
                <h3 className="font-heading font-semibold text-[15px] text-foreground leading-snug">{teacher.full_name}</h3>
                {teacher.subject       && <p className="text-[13px] text-muted-foreground font-medium mt-0.5">{teacher.subject}</p>}
                {teacher.qualification && <p className="text-xs text-muted-foreground/80 mt-0.5">{teacher.qualification}</p>}
              </m.div>
            ))}
          </div>
          </ScrollStage>
        </div>
      </m.section>

      {/* ══ 13. DAILY QUOTE ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionFadeUp} className="section-y bg-background cv-auto">
        <div className="container mx-auto px-4 max-w-4xl">
          <ScrollReveal><SectionHeader eyebrow="Daily Inspiration" title="Thought of the Day" /></ScrollReveal>
          <ScrollStage variant="zoom"><DailyQuoteCard /></ScrollStage>
        </div>
      </m.section>

      {/* ══ 15. ADMISSION / FINAL CTA ══
          Light & fast: no infinite animations, no huge blurred layers, no
          scroll-triggered motion wrapper, and a fixed-height placeholder while
          the settings load so the card never flips from "closed" to "open". */}
      <section className="py-10 md:py-16 relative">
        <div className="container mx-auto px-4">
          {admLoading ? (
            <div className="mx-auto max-w-3xl h-56 rounded-3xl border border-border bg-card animate-pulse" />
          ) : (
            <div className="relative mx-auto max-w-3xl rounded-3xl p-px bg-gradient-to-br from-gold/70 via-primary/30 to-gold/40 shadow-elevated">
              <div className="relative overflow-hidden rounded-[23px] gradient-hero text-white px-5 py-7 sm:px-10 sm:py-10">
                <div className="orb orb-gold w-64 h-64 -top-28 -right-20 opacity-80" />
                <div className="absolute inset-0 dot-grid opacity-[0.08]" />
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" />

                {isAdmissionEffectivelyOpen ? (
                  <div className="relative">
                    <span className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-white/10 pl-2.5 pr-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold" />
                      Admissions Open
                      <span className="text-white/50 font-medium normal-case tracking-normal">· {admSettings!.session_year}</span>
                    </span>
                    <h2 className="mt-4 font-heading text-[1.7rem] sm:text-4xl font-bold leading-tight text-on-hero">
                      Apply for Admission <span className="text-gold">Today</span>
                    </h2>
                    <p className="mt-2.5 text-sm sm:text-base text-on-hero-soft max-w-xl leading-relaxed">
                      {admSettings!.banner_message ?? "Classes 6 to 10 — fresh admissions and migration cases welcome. Apply online in minutes."}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-medium text-white/80">
                      {admSettings!.last_date && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1">
                          <Calendar className="w-3 h-3 text-gold" />
                          Last date: {new Date(admSettings!.last_date).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1">
                        <BookOpen className="w-3 h-3 text-gold" /> Class 6–10
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1">
                        <GraduationCap className="w-3 h-3 text-gold" /> Fresh &amp; Migration
                      </span>
                    </div>

                    <div className="mt-5 flex flex-row flex-wrap items-center gap-2.5">
                      <Link
                        to="/admission"
                        className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-gradient-to-r from-gold to-gold-strong text-white dark:text-gold-ink text-[13px] font-semibold shadow-[0_6px_16px_-8px_hsl(var(--gold)/0.6)] hover:shadow-[0_8px_20px_-8px_hsl(var(--gold)/0.75)] transition-shadow"
                      >
                        <Send className="w-3.5 h-3.5" /> Apply Online
                      </Link>
                      {/* "My Tracking": smooth-scroll to the tracking section if present,
                          otherwise SPA-navigate into the Admission page's tracking view. */}
                      <Link
                        to="/admission"
                        onClick={(e) => { e.preventDefault(); const el = document.querySelector('[data-track-section]'); if (el) { el.scrollIntoView({ behavior: 'smooth' }); } else { navigate("/admission", { state: { view: "track" } }); }}}
                        className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full border border-white/25 text-white text-[13px] font-medium hover:border-gold/70 transition-colors"
                      >
                        <Search className="w-3.5 h-3.5 text-gold" /> My Tracking
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <span className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-white/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
                      <Heart className="w-3 h-3" /> Join Our Community
                    </span>
                    <h2 className="mt-4 font-heading text-[1.7rem] sm:text-4xl font-bold leading-tight text-on-hero">
                      Ready to Begin Your <span className="text-gold">Educational Journey?</span>
                    </h2>
                    <p className="mt-2.5 text-sm sm:text-base text-on-hero-soft max-w-xl leading-relaxed">
                      Access your student portal to view results, attendance, timetables, and stay connected with your academic progress.
                    </p>
                    <div className="mt-5 flex flex-row flex-wrap items-center gap-2.5">
                      <Link to="/auth/signin" className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full bg-gradient-to-r from-gold to-gold-strong text-white dark:text-gold-ink text-[13px] font-semibold shadow-[0_6px_16px_-8px_hsl(var(--gold)/0.6)] transition-shadow">
                        Sign In to Portal <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                      <Link to="/results" className="inline-flex items-center gap-1.5 h-9 px-5 rounded-full border border-white/25 text-white text-[13px] font-medium hover:border-gold/70 transition-colors">
                        Check Results
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ══ 16. ABOUT PREVIEW ══ */}
      <m.section initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.1 }} variants={sectionFadeUp} className="section-y cv-auto relative overflow-hidden bg-background">
        <div className="absolute inset-0 opacity-40 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full border border-border/70" />
          <div className="absolute -bottom-24 -left-24 w-[22rem] h-[22rem] rounded-full border border-border/70" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <ScrollReveal direction="left">
              <div className="text-foreground">
                <span className="inline-block bg-card text-foreground border border-azure/30 text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full mb-4">About Us</span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-heading font-bold mb-6 leading-tight">Building Future Leaders Since {settings?.established_year || 2018}</h2>
                <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                  {settings?.description || "Government High School Babi Khel has been serving the community of District Mohmand with dedication and excellence. We believe in nurturing every student's potential through quality education and modern teaching methodologies."}
                </p>
                <div className="grid sm:grid-cols-2 gap-4 mb-8">
                  {[
                    { icon: MapPin, text: settings?.address || "Babi Khel, District Mohmand, KPK" },
                    { icon: Phone,  text: settings?.phone   || "+92 XXX XXXXXXX" },
                    { icon: Mail,   text: settings?.email   || "ghsbabikhel@gmail.com" },
                  ].map((item, i) => (
                    <m.div key={i} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-3 bg-card rounded-xl p-3 border border-border">
                      <div className="w-10 h-10 rounded-lg bg-azure-soft flex items-center justify-center shrink-0"><item.icon className="w-5 h-5 text-azure-strong dark:text-azure" /></div>
                      <span className="text-sm text-muted-foreground">{item.text}</span>
                    </m.div>
                  ))}
                </div>
                <Link to="/about">
                  <m.button whileTap={{ scale: 0.97 }} className="inline-flex items-center gap-2 h-10 px-6 rounded-full bg-transparent text-primary border border-primary/40 hover:border-gold/60 hover:bg-primary/5 text-sm font-semibold transition-colors">
                    Learn More About Us <ArrowRight className="w-4 h-4" />
                  </m.button>
                </Link>
              </div>
            </ScrollReveal>
            <ScrollReveal direction="right" delay={0.2}>
              <div className="relative">
                <div className="aspect-square rounded-3xl bg-card border border-border p-2 shadow-xl">
                  <div className="w-full h-full rounded-2xl bg-muted flex items-center justify-center overflow-hidden">
                    {settings?.principal_photo_url && !principalFailed ? (
                      <img
                        src={principalUsingOriginal
                          ? settings.principal_photo_url
                          : (optimizedCloudinaryUrl(settings.principal_photo_url, { width: 600 }) || settings.principal_photo_url)}
                        alt={settings?.principal_name || "Principal"}
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          // Keep the principal card visible if the optimized
                          // delivery URL fails in a desktop browser.
                          if (!principalUsingOriginal) {
                            setPrincipalUsingOriginal(true);
                          } else {
                            setPrincipalFailed(true);
                          }
                        }}
                      />
                    ) : null}
                    <div className={`w-full h-full flex items-center justify-center ${settings?.principal_photo_url && !principalFailed ? "hidden" : ""}`}>
                      <GraduationCap className="w-40 h-40 text-muted-foreground/30" />
                    </div>
                  </div>
                </div>
                {settings?.principal_name && (
                  <div className="absolute bottom-4 left-4 right-4 bg-card/90 backdrop-blur-sm rounded-xl p-3 text-center">
                    <p className="font-heading font-bold text-foreground text-sm">{settings.principal_name}</p>
                    <p className="text-xs text-muted-foreground">Principal</p>
                  </div>
                )}
                <div className="absolute -bottom-6 -left-6 bg-card rounded-2xl shadow-card border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-lg"><Star className="w-6 h-6 text-white" /></div>
                    <div><p className="text-2xl font-black text-foreground">{settings?.pass_percentage || 95}%</p><p className="text-xs text-muted-foreground font-medium">Pass Rate</p></div>
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 bg-card rounded-2xl shadow-card border border-border p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center shadow-lg"><Award className="w-6 h-6 text-white" /></div>
                    <div><p className="text-2xl font-black text-foreground">{settings?.board_results || "A+"}</p><p className="text-xs text-muted-foreground font-medium">Results</p></div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </m.section>

    </PageLayout>
    <Deferred><GlobalDefinitionPopup /></Deferred>
    <Deferred><AIAssistantWidget /></Deferred>

    {/* TTS bar — auto-plays the moment a "Listen" pill is clicked on a notice card.
        Language (Urdu / English) is auto-detected from the article text. */}
    {ttsItem && (
      <TextToSpeechPlayer
        text={ttsItem.content}
        title={ttsItem.title}
        onClose={() => setTtsItem(null)}
      />
    )}
    </>
  );
};

export default Home;
