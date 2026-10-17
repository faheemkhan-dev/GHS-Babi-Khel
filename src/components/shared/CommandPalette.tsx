// src/components/shared/CommandPalette.tsx
// ⌘K / Ctrl+K global command palette — the fastest path to any page, quick
// action, notice, news item or teacher on the site. Opens as a floating
// overlay from anywhere (any route, any scroll position), fuzzy-matches as
// you type via Fuse.js layered on top of the same useSiteSearch index the
// navbar dropdown already uses (so results always agree), and is fully
// keyboard-driven: Arrow keys to move, Enter to go, Escape to close.
//
// Quick actions (Go to Roll No. Slip, Download Result DMC, Call school
// office, Toggle dark/light mode) are pinned above search results so the
// most common jumps never require typing anything.
//
// Recent searches persist in localStorage (last 5) and resurface as
// one-tap suggestions the next time the palette opens with an empty query.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Fuse from "fuse.js";
import {
  Search, Hash, FileText, Phone, Moon, SunMedium, CornerDownLeft,
  ArrowUp, ArrowDown, X, Clock, Sparkles, Command as CommandIcon, Mic, MicOff,
} from "lucide-react";
import { useSiteSearch, PAGE_INDEX, type SearchHit } from "@/hooks/useSiteSearch";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
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
  news: "News",
  teachers: "Teachers",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { data: settings } = useSchoolSettings();
  const { theme, setTheme } = useTheme();
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

  // ── Quick actions ──────────────────────────────────────────────────
  const quickActions = useMemo<QuickAction[]>(() => {
    const phone = settings?.phone?.trim();
    const actions: QuickAction[] = [
      {
        kind: "action",
        id: "qa-roll-slip",
        label: "Go to Roll No. Slip",
        hint: "Find, download & share your exam roll slip",
        icon: Hash,
        run: () => navigate("/roll-no-slip"),
      },
      {
        kind: "action",
        id: "qa-results",
        label: "Download Result DMC",
        hint: "Open Results — Report Card & DMC download",
        icon: FileText,
        run: () => navigate("/results"),
      },
    ];
    if (phone) {
      actions.push({
        kind: "action",
        id: "qa-call",
        label: "Call School Office",
        hint: phone,
        icon: Phone,
        run: () => {
          window.location.href = `tel:${phone.replace(/\s/g, "")}`;
        },
      });
    }
    actions.push({
      kind: "action",
      id: "qa-theme",
      label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      hint: "Toggle site appearance",
      icon: theme === "dark" ? SunMedium : Moon,
      run: () => setTheme(theme === "dark" ? "system" : "dark"),
    });
    return actions;
  }, [settings?.phone, theme, setTheme, navigate]);

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

  // ── Unified row list: quick actions first (only when query is empty or
  //      a quick action's own label fuzzily matches), then search hits. ──
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const actionRows: Row[] = (
      q.length === 0
        ? quickActions
        : quickActions.filter((a) => a.label.toLowerCase().includes(q))
    ).map((a) => ({ kind: "action", id: a.id, ...a }));

    const hitRows: Row[] = hits.map((h) => ({ kind: "hit", id: `${h.group}-${h.id}`, hit: h }));

    return [...actionRows, ...hitRows];
  }, [query, quickActions, hits]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runRow = useCallback(
    (row: Row) => {
      if (row.kind === "action") {
        (row as QuickAction).run();
      } else {
        pushRecent(query.trim() || row.hit.title);
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
    [rows, activeIndex, close, runRow]
  );

  // Keep the active row scrolled into view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const showRecents = query.trim().length === 0 && recents.length > 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center px-3 sm:px-4 pt-[8vh] sm:pt-0"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          style={{ background: "linear-gradient(180deg, rgba(8,10,14,0.55), rgba(4,6,10,0.7))", backdropFilter: "blur(2px)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5"
            onKeyDown={onKeyDown}
          >
            {/* ── Input row ── */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/70">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                value={listening && interim ? interim : query}
                onChange={(e) => { setQuery(e.target.value); if (voiceError) setVoiceError(""); }}
                placeholder={listening ? "Listening…" : "Search pages, notices, news, teachers…"}
                className="flex-1 bg-transparent border-none outline-none text-sm sm:text-[15px] text-foreground placeholder:text-muted-foreground/70"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Command palette search"
              />
              {voiceSupported && (
                <>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    aria-label={listening ? "Stop voice search" : "Start voice search"}
                    aria-pressed={listening}
                    className={`relative shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      listening
                        ? "bg-gradient-to-br from-gold to-gold-strong text-white shadow-[0_0_0_4px_hsl(var(--gold)/0.25)]"
                        : "bg-primary/10 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {listening && <span className="absolute inset-0 rounded-full bg-gold/40 animate-ping" aria-hidden="true" />}
                    {listening ? <MicOff className="relative w-4 h-4" /> : <Mic className="relative w-4 h-4" />}
                  </button>
                </>
              )}
              <button
                onClick={close}
                aria-label="Close"
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* ── Voice status strip ── */}
            <AnimatePresence initial={false}>
              {(listening || voiceError) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-b border-border/70"
                >
                  {listening ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-gold/10 via-transparent to-primary/5" role="status" aria-live="polite">
                      <div className="flex items-end gap-[3px] h-5" aria-hidden="true">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <motion.span
                            key={i}
                            className="w-[3px] rounded-full bg-gold"
                            animate={{ height: ["25%", "100%", "40%", "85%", "25%"] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                            style={{ height: "25%" }}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground flex-1 truncate">
                        {interim ? <span className="text-foreground font-medium">{interim}</span> : "Listening… speak now"}
                      </p>
                      <button onClick={stopVoice} className="text-[11px] font-semibold text-primary hover:underline">Stop</button>
                    </div>
                  ) : (
                    <p className="px-4 py-2.5 text-xs text-destructive bg-destructive/5" role="alert">{voiceError}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Results / actions / recents ── */}
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1.5">
              {showRecents && (
                <div className="px-2 pb-1">
                  <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> Recent Searches
                  </p>
                  <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                    {recents.map((r) => (
                      <button
                        key={r}
                        onClick={() => setQuery(r)}
                        className="px-2.5 py-1 rounded-full bg-secondary/70 hover:bg-secondary text-xs text-foreground/80 transition-colors"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {rows.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Sparkles className="w-5 h-5 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No matches for &ldquo;{query.trim()}&rdquo;
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Try a page name, a teacher, or a notice title{voiceSupported ? " — or tap the mic" : ""}
                  </p>
                </div>
              ) : (
                <>
                  {/* Quick actions group */}
                  {rows.some((r) => r.kind === "action") && (
                    <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Quick Actions
                    </p>
                  )}
                  {rows.map((row, idx) => {
                    const active = idx === activeIndex;
                    // Insert a "Results" divider right before the first hit row.
                    const isFirstHit = row.kind === "hit" && rows[idx - 1]?.kind !== "hit";
                    return (
                      <div key={row.id}>
                        {isFirstHit && (
                          <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                            Results
                          </p>
                        )}
                        {row.kind === "action" ? (
                          <button
                            data-row-index={idx}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => runRow(row)}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                              active ? "bg-azure/10" : "hover:bg-secondary/60"
                            }`}
                          >
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-azure text-white" : "bg-secondary text-azure"}`}>
                              <row.icon className="w-4 h-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground truncate">{row.label}</span>
                              {row.hint && <span className="block text-[11px] text-muted-foreground truncate">{row.hint}</span>}
                            </span>
                            {active && <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
                          </button>
                        ) : (
                          <button
                            data-row-index={idx}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => runRow(row)}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                              active ? "bg-azure/10" : "hover:bg-secondary/60"
                            }`}
                          >
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-azure text-white" : "bg-secondary text-muted-foreground"}`}>
                              <row.hit.icon className="w-4 h-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-foreground truncate">{row.hit.title}</span>
                              <span className="block text-[11px] text-muted-foreground truncate">
                                {GROUP_LABEL[row.hit.group]}{row.hit.snippet ? ` · ${row.hit.snippet}` : ""}
                              </span>
                            </span>
                            {active && <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* ── Footer hint bar ── */}
            <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-border/70 bg-secondary/30 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> Navigate</span>
              <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> Select</span>
              <span className="flex items-center gap-1">Esc Close</span>
              <span className="ml-auto flex items-center gap-1 font-medium">
                <CommandIcon className="w-3 h-3" />K to reopen
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
