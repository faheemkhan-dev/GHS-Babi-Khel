// src/components/shared/CommandPalette.tsx
// Global command palette (⌘K / Ctrl+K, "/", the bottom-bar Search tab and the
// navbar search icon). 2026-11 PREMIUM REDESIGN:
//   • glass card with a green→gold accent line, large rounded search pill
//     (16 px input text — no iOS zoom), gradient voice button
//   • empty state = live dashboard: 6 gradient quick-action tiles (Admission
//     shows its LIVE Open/Closed badge, Call shows the live school phone),
//     the 3 latest published notices, Ask-AI + theme chips, recent searches
//   • typing = filter chips (All / Pages / Notices / Teachers with counts),
//     highlighted matches, colour-coded result icons, and an always-available
//     "Ask the AI Assistant" row that hands the query to the AI widget
//   • everything is live (useAdmissionSettings / useNotices / useSchoolSettings /
//     useSiteSearch) — no typed-in school facts.
// Keyboard: ↑ ↓ (← → in the tile grid) move, Enter opens, Esc closes.
// Fuzzy matching (Fuse.js) and voice search (Web Speech API) are unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Fuse from "fuse.js";
import {
  Search, Hash, FileText, Phone, Moon, SunMedium, CornerDownLeft, ChevronRight,
  ArrowUp, ArrowDown, X, Clock, Sparkles, Mic, MicOff, GraduationCap, Bell, Medal,
  Bot,
} from "lucide-react";
import { useSiteSearch, PAGE_INDEX, type SearchHit } from "@/hooks/useSiteSearch";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { useAdmissionSettings } from "@/hooks/useAdmission";
import { useNotices } from "@/hooks/useNotices";
import { useTheme } from "@/hooks/useTheme";

const RECENTS_KEY = "ghs_cmdk_recent_searches";
const MAX_RECENTS = 5;

// A tiny global open API so any button anywhere in the app (e.g. the
// mobile navbar's search icon) can trigger the palette without prop
// drilling or lifting state into App.tsx — CommandPalette is mounted
// once at the top of the app and just listens for this event.
const OPEN_EVENT = "ghs:open-command-palette";
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function pushRecent(query: string) {
  const q = query.trim();
  if (!q) return;
  try {
    const cur = readRecents().filter((r) => r.toLowerCase() !== q.toLowerCase());
    const next = [q, ...cur].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — recents just won't persist this session
  }
}

/* ── A palette row can be a quick action, a search hit, or a recent-search
      chip — unified so keyboard nav / selection doesn't care which. ── */
interface QuickAction {
  kind: "action";
  id: string;
  label: string;
  hint?: string;
  icon: typeof Hash;
  run: () => void;
  /** gradient classes for the icon tile */
  tone?: string;
  /** small live badge, e.g. Open / Closed */
  badge?: { text: string; ok: boolean };
  /** "tile" = big grid tile, "chip" = compact pill, "row" = list row (search) */
  variant?: "tile" | "chip" | "row";
}
interface HitRow {
  kind: "hit";
  id: string;
  hit: SearchHit;
}
type Row = QuickAction | HitRow;

/* ── Voice search (Web Speech API) ── Chrome / Edge / Samsung / Safari.
   Firefox has no SpeechRecognition — the mic button is hidden there. */
const VOICE_LANG = "en-US";

function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

const VOICE_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission denied. Allow mic access in your browser settings.",
  "service-not-allowed": "Microphone permission denied. Allow mic access in your browser settings.",
  "no-speech": "Didn't catch that. Tap the mic and try again.",
  "audio-capture": "No microphone found on this device.",
  "network": "Voice search needs an internet connection.",
};

const GROUP_LABEL: Record<SearchHit["group"], string> = {
  pages: "Pages",
  notices: "Notices",
  teachers: "Teachers",
};

/** Highlights the first occurrence of the query inside a title. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-gold/25 px-0.5 text-foreground">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

const fmtShort = (iso: string) => {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch { return ""; }
};

const OPEN_AI_EVENT = "ghs:open-ai-assistant";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: settings } = useSchoolSettings();
  const { data: admission } = useAdmissionSettings();
  const { data: allNotices = [] } = useNotices();
  const { theme, setTheme } = useTheme();
  const [filter, setFilter] = useState<"all" | SearchHit["group"]>("all");
  const [recents, setRecents] = useState<string[]>([]);

  // ── Voice search state ────────────────────────────────────────────────
  const [voiceSupported] = useState(() => !!getSpeechRecognitionCtor());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);

  const stopVoice = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const startVoice = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
    setVoiceError("");
    setInterim("");

    const rec = new Ctor();
    rec.lang = VOICE_LANG;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (interimText) setInterim(interimText);
      if (finalText) {
        setInterim("");
        setQuery(finalText.trim().replace(/[.]+$/, ""));
      }
    };
    rec.onerror = (e: any) => {
      setVoiceError(VOICE_ERRORS[e?.error] || "Voice search failed. Please try again.");
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, []);

  const toggleVoice = useCallback(() => {
    if (listening) stopVoice();
    else startVoice();
  }, [listening, startVoice, stopVoice]);

  // Never leave the mic open after the palette closes / unmounts.
  useEffect(() => {
    if (!open) {
      try { recognitionRef.current?.abort(); } catch { /* noop */ }
      setListening(false);
      setInterim("");
      setVoiceError("");
    }
  }, [open]);
  useEffect(() => () => {
    try { recognitionRef.current?.abort(); } catch { /* noop */ }
  }, []);

  // ── Global Cmd/Ctrl+K listener — works from anywhere, any route ──────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k";
      if ((e.metaKey || e.ctrlKey) && isK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "/" && !open) {
        // Also support the bare "/" shortcut (GitHub/Linear-style), but
        // never while the user is typing into any other field.
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag !== "input" && tag !== "textarea" && !target?.isContentEditable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // ── Also open on the custom event — this is what lets the mobile
  //      navbar's search icon (or any other on-screen button) launch the
  //      exact same palette, with the same fuzzy search, quick actions
  //      and recents, instead of the old inline search bar. ────────────
  useEffect(() => {
    const onOpenEvent = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => window.removeEventListener(OPEN_EVENT, onOpenEvent);
  }, []);

  // ── Open/close side-effects ───────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setRecents(readRecents());
      setQuery("");
      setFilter("all");
      setActiveIndex(0);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // Focus after the mount/animation frame so it reliably grabs focus
      // on both desktop and mobile browsers.
      requestAnimationFrame(() => inputRef.current?.focus());
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // ── Quick actions (all values live) ────────────────────────────────────
  const quickActions = useMemo<QuickAction[]>(() => {
    const phone = settings?.phone?.trim();
    const admOpen = admission ? !!admission.is_open : null;
    const tile = (a: Omit<QuickAction, "kind" | "variant">): QuickAction => ({ kind: "action", variant: "tile", ...a });
    const actions: QuickAction[] = [
      tile({ id: "qa-roll-slip", label: "Roll No. Slip", hint: "Find & download your slip", icon: Hash,
        tone: "from-emerald-500 to-emerald-700", run: () => navigate("/roll-no-slip") }),
      tile({ id: "qa-results", label: "Results & DMC", hint: "Report card download", icon: FileText,
        tone: "from-teal-500 to-cyan-700", run: () => navigate("/results") }),
      tile({ id: "qa-admission", label: "Admission", icon: GraduationCap,
        hint: admission?.session_year ? `Session ${admission.session_year}` : "Apply & track",
        badge: admOpen === null ? undefined : { text: admOpen ? "Open" : "Closed", ok: admOpen },
        tone: "from-amber-400 to-amber-600", run: () => navigate("/admission") }),
      tile({ id: "qa-notices", label: "Notices", hint: "Latest announcements", icon: Bell,
        tone: "from-rose-400 to-rose-600", run: () => navigate("/notices") }),
      tile({ id: "qa-merit", label: "Merit List", hint: "Position holders", icon: Medal,
        tone: "from-violet-500 to-purple-700", run: () => navigate("/merit-list") }),
    ];
    if (phone) {
      actions.push(tile({ id: "qa-call", label: "Call Office", hint: phone, icon: Phone,
        tone: "from-sky-500 to-blue-700",
        run: () => { window.location.href = `tel:${phone.replace(/\s/g, "")}`; } }));
    }
    const chip = (a: Omit<QuickAction, "kind" | "variant">): QuickAction => ({ kind: "action", variant: "chip", ...a });
    actions.push(
      chip({ id: "qa-ai", label: "Ask AI Assistant", icon: Bot,
        run: () => window.dispatchEvent(new CustomEvent(OPEN_AI_EVENT)) }),
      chip({ id: "qa-theme", label: theme === "dark" ? "Light mode" : "Dark mode", icon: theme === "dark" ? SunMedium : Moon,
        run: () => setTheme(theme === "dark" ? "system" : "dark") })
    );
    return actions;
  }, [settings?.phone, admission, theme, setTheme, navigate]);

  // ── Search: reuse the same live index the navbar dropdown uses, then
  //      layer Fuse.js fuzzy matching on top so typos / abbreviations
  //      ("rns" → "Roll No. Slip") still surface the right page. ─────
  const { hits: rawHits } = useSiteSearch(query, 6);

  // Fuse also runs directly over the static page index so short/fuzzy
  // queries match pages even when useSiteSearch's plain substring check
  // (which rawHits is built from) misses an abbreviation.
  const pageFuse = useMemo(
    () =>
      new Fuse(PAGE_INDEX, {
        keys: [
          { name: "label", weight: 0.6 },
          { name: "keywords", weight: 0.4 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    []
  );

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim();
    if (!q) return [];

    // Start from the exact/substring hits (already ranked pages-first).
    const seen = new Set(rawHits.map((h) => h.id));
    const combined = [...rawHits];

    // Add fuzzy page matches that the substring pass missed.
    if (q.length >= 2) {
      const fuzzyPages = pageFuse.search(q, { limit: 6 });
      for (const r of fuzzyPages) {
        const id = `page-${r.item.to}`;
        if (seen.has(id)) continue;
        seen.add(id);
        combined.push({
          id,
          title: r.item.label,
          snippet: "Page",
          href: r.item.to,
          group: "pages",
          icon: r.item.icon,
        });
      }
    }
    return combined;
  }, [query, rawHits, pageFuse]);

  // Latest published notices — live, shown on the empty state.
  const latestNotices = useMemo(() => allNotices.slice(0, 3), [allNotices]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = { all: hits.length, pages: 0, notices: 0, teachers: 0 };
    for (const h of hits) c[h.group] += 1;
    return c;
  }, [hits]);
  const shownHits = useMemo(
    () => (filter === "all" ? hits : hits.filter((h) => h.group === filter)),
    [hits, filter]
  );

  // ── Unified row list (drives keyboard navigation) ────────────────────────
  //   empty query : quick actions → latest notices
  //   typing      : matching quick actions → search hits → "Ask AI" row
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const noticeRows: Row[] = latestNotices.map((n) => ({
        kind: "hit",
        id: `latest-${n.id}`,
        hit: { id: n.id, title: n.title, snippet: fmtShort(n.created_at), href: `/notices/${n.id}`, group: "notices", icon: Bell },
      }));
      return [...quickActions, ...noticeRows];
    }
    const actionRows: Row[] = quickActions
      .filter((a) => a.variant === "tile" && a.label.toLowerCase().includes(q))
      .map((a) => ({ ...a, variant: "row" as const }));
    const hitRows: Row[] = shownHits.map((h) => ({ kind: "hit", id: `${h.group}-${h.id}`, hit: h }));
    const askAi: Row = {
      kind: "action", id: "qa-ask-ai", variant: "row", icon: Bot, tone: "from-primary to-emerald-700",
      label: `Ask the AI Assistant`, hint: `“${query.trim()}”`,
      run: () => window.dispatchEvent(new CustomEvent(OPEN_AI_EVENT, { detail: { prompt: query.trim() } })),
    };
    return [...actionRows, ...hitRows, askAi];
  }, [query, quickActions, shownHits, latestNotices]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filter]);

  const runRow = useCallback(
    (row: Row) => {
      if (row.kind === "action") {
        (row as QuickAction).run();
      } else {
        if (query.trim()) pushRecent(query.trim());
        navigate(row.hit.href);
      }
      close();
    },
    [close, navigate, query]
  );

  // ── Keyboard navigation within the palette ────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
        return;
      }
      if (query.trim() === "" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        setActiveIndex((i) => Math.min(Math.max(i + (e.key === "ArrowRight" ? 1 : -1), 0), Math.max(rows.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row) runRow(row);
        return;
      }
    },
    [rows, activeIndex, close, runRow, query]
  );

  // Keep the active row scrolled into view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const showRecents = query.trim().length === 0 && recents.length > 0;
  const hasQuery = query.trim().length > 0;
  const idx = rows.map((r, i) => ({ r, i }));
  const actionList = idx.filter((x) => x.r.kind === "action" && (x.r as QuickAction).variant === "tile");
  const chips = idx.filter((x) => x.r.kind === "action" && (x.r as QuickAction).variant === "chip");
  const noticeRows = idx.filter((x) => x.r.kind === "hit" && !hasQuery);
  const listRows = hasQuery ? idx : [];

  const Label = ({ children }: { children: React.ReactNode }) => (
    <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{children}</p>
  );

  // One slim row used everywhere (actions, notices, search hits).
  const renderRow = (row: Row, i: number) => {
    const active = i === activeIndex;
    const isAction = row.kind === "action";
    const Icon = isAction ? (row as QuickAction).icon : (row as HitRow).hit.icon;
    const title = isAction ? (row as QuickAction).label : (row as HitRow).hit.title;
    const sub = isAction
      ? (row as QuickAction).hint
      : `${GROUP_LABEL[(row as HitRow).hit.group]}${(row as HitRow).hit.snippet ? ` · ${(row as HitRow).hit.snippet}` : ""}`;
    const badge = isAction ? (row as QuickAction).badge : undefined;
    return (
      <button
        key={row.id}
        data-row-index={i}
        onMouseEnter={() => setActiveIndex(i)}
        onClick={() => runRow(row)}
        className={`relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
          active ? "bg-secondary" : "hover:bg-secondary/60"
        }`}
      >
        {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />}
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13.5px] font-medium text-foreground">
            {isAction ? title : <Highlight text={title} q={query} />}
          </span>
          {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
        </span>
        {badge && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium ${
            badge.ok ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-border text-muted-foreground"
          }`}>
            <span className={`h-1 w-1 rounded-full ${badge.ok ? "bg-emerald-500" : "bg-muted-foreground/60"}`} />
            {badge.text}
          </span>
        )}
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground/30"}`} strokeWidth={1.75} />
      </button>
    );
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),10px)] sm:px-4 sm:pt-[12vh]"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{ background: "rgba(6,12,10,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Search and quick actions"
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="relative mt-2 w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_50px_-16px_rgba(0,0,0,0.5)] sm:mt-0"
            onKeyDown={onKeyDown}
          >
            <div aria-hidden className="h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

            {/* ── Slim search field ── */}
            <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <input
                ref={inputRef}
                value={listening && interim ? interim : query}
                onChange={(e) => { setQuery(e.target.value); if (voiceError) setVoiceError(""); }}
                placeholder={listening ? "Listening…" : "Search pages, notices, teachers"}
                className="min-w-0 flex-1 border-none bg-transparent py-1 text-[16px] text-foreground outline-none placeholder:text-muted-foreground/60 sm:text-[14px]"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-label="Search"
              />
              {hasQuery && (
                <button onClick={() => setQuery("")} aria-label="Clear" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  aria-label={listening ? "Stop voice search" : "Start voice search"}
                  aria-pressed={listening}
                  className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                    listening ? "bg-gold text-white" : "text-muted-foreground hover:bg-secondary hover:text-primary"
                  }`}
                >
                  {listening && <span className="absolute inset-0 animate-ping rounded-md bg-gold/40" aria-hidden="true" />}
                  {listening ? <MicOff className="relative h-4 w-4" strokeWidth={1.75} /> : <Mic className="relative h-4 w-4" strokeWidth={1.75} />}
                </button>
              )}
              <button onClick={close} className="hidden h-6 shrink-0 items-center rounded border border-border px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground sm:flex">
                esc
              </button>
              <button onClick={close} aria-label="Close" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary sm:hidden">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            {/* ── Voice status ── */}
            <AnimatePresence initial={false}>
              {(listening || voiceError) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="overflow-hidden border-b border-border/70"
                >
                  {listening ? (
                    <div className="flex items-center gap-2.5 px-3 py-2" role="status" aria-live="polite">
                      <div className="flex h-4 items-end gap-[2px]" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((n) => (
                          <motion.span key={n} className="w-[2px] rounded-full bg-gold"
                            animate={{ height: ["25%", "100%", "40%", "85%", "25%"] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: n * 0.12, ease: "easeInOut" }}
                            style={{ height: "25%" }} />
                        ))}
                      </div>
                      <p className="flex-1 truncate text-xs text-muted-foreground">
                        {interim ? <span className="font-medium text-foreground">{interim}</span> : "Listening… speak now"}
                      </p>
                      <button onClick={stopVoice} className="text-[11px] font-medium text-primary hover:underline">Stop</button>
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-xs text-destructive" role="alert">{voiceError}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Filter chips (thin) ── */}
            {hasQuery && hits.length > 0 && (
              <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Filter results">
                {(["all", "pages", "notices", "teachers"] as const).map((g) =>
                  g === "all" || groupCounts[g] > 0 ? (
                    <button
                      key={g}
                      role="tab"
                      aria-selected={filter === g}
                      onClick={() => setFilter(g)}
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors ${
                        filter === g ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {g === "all" ? "All" : GROUP_LABEL[g]} <span className="opacity-60">{groupCounts[g]}</span>
                    </button>
                  ) : null
                )}
              </div>
            )}

            {/* ── Body ── */}
            <div ref={listRef} className="max-h-[min(62dvh,440px)] overflow-y-auto overscroll-contain px-1.5 pb-1.5">
              {!hasQuery ? (
                <>
                  {showRecents && (
                    <>
                      <Label>Recent</Label>
                      <div className="flex flex-wrap gap-1 px-2 pb-1">
                        {recents.map((r) => (
                          <button key={r} onClick={() => setQuery(r)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-foreground/80 hover:bg-secondary">
                            <Clock className="h-3 w-3 text-muted-foreground" /> {r}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <Label>Quick actions</Label>
                  <div>{actionList.map(({ r, i }) => renderRow(r, i))}</div>

                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
                      {chips.map(({ r, i }) => {
                        const a = r as QuickAction;
                        return (
                          <button
                            key={a.id}
                            data-row-index={i}
                            onMouseEnter={() => setActiveIndex(i)}
                            onClick={() => runRow(r)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                              i === activeIndex ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-foreground/80 hover:bg-secondary"
                            }`}
                          >
                            <a.icon className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} /> {a.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {noticeRows.length > 0 && (
                    <>
                      <Label>Latest notices</Label>
                      <div>{noticeRows.map(({ r, i }) => renderRow(r, i))}</div>
                    </>
                  )}
                </>
              ) : (
                <div className="pt-1">
                  {hits.length === 0 && (
                    <div className="px-3 py-5 text-center">
                      <Sparkles className="mx-auto mb-1.5 h-4 w-4 text-gold" />
                      <p className="text-[13px] font-medium text-foreground">No matches for “{query.trim()}”</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">Ask the AI Assistant — it answers from live school records.</p>
                    </div>
                  )}
                  {listRows.map(({ r, i }) => renderRow(r, i))}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-[10.5px] text-muted-foreground">
              <span className="hidden items-center gap-1 sm:flex"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> navigate</span>
              <span className="hidden items-center gap-1 sm:flex"><CornerDownLeft className="h-3 w-3" /> open</span>
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live school data</span>
              <span className="ml-auto hidden sm:inline">⌘K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
