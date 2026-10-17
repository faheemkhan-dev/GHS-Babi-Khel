import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Square, X, Volume2, Loader2 } from "lucide-react";
import { detectTextLanguage } from "@/lib/newsUtils";

interface TTSPlayerProps {
  text: string;
  title: string;
  onClose: () => void;
  /** When true (default), narration starts automatically as soon as a voice is ready. */
  autoPlay?: boolean;
}

const speeds = [0.75, 1, 1.25, 1.5, 2];

const cleanText = (t: string) =>
  t
    // Intentional emoji/symbol strip before speech synthesis — the ranges
    // deliberately include combining marks (skin tones, ZWJ pieces).
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u{1F600}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Picks the best available system voice for the detected language.
 *
 * IMPORTANT — Urdu voice availability varies wildly by OS/browser:
 *   • Android Chrome: usually NO native ur-* voice; Arabic (ar-SA/ar-EG) is
 *     the closest phonetic match (both languages share many phonemes + the
 *     same script). Hindi (hi-IN) is the next fallback.
 *   • iOS Safari: usually has Urdu (ur-PK) on newer devices.
 *   • Desktop Chrome: depends on installed OS voices.
 *
 * So we try: ur → ar → hi → fa → (any voice) so that SOMETHING speaks.
 */
function pickVoice(voices: SpeechSynthesisVoice[], lang: "ur" | "en") {
  if (!voices.length) return undefined;
  if (lang === "ur") {
    return (
      voices.find(v => v.lang?.toLowerCase().startsWith("ur")) ||
      voices.find(v => /urdu/i.test(v.name)) ||
      voices.find(v => v.lang?.toLowerCase().startsWith("ar")) ||
      voices.find(v => v.lang?.toLowerCase().startsWith("fa")) ||
      voices.find(v => v.lang?.toLowerCase().startsWith("hi")) ||  // Hindi: phonetic neighbour
      voices.find(v => v.lang?.toLowerCase().startsWith("ps"))    // Pashto: regional neighbour
    );
  }
  return (
    voices.find(v => v.lang?.toLowerCase() === "en-us") ||
    voices.find(v => v.lang?.toLowerCase().startsWith("en-gb")) ||
    voices.find(v => v.lang?.toLowerCase().startsWith("en-in")) ||
    voices.find(v => v.lang?.toLowerCase().startsWith("en"))
  );
}

/**
 * Split text into sentence-sized chunks so the speech engine doesn't choke
 * on long inputs (some Android builds silently fail on >200 chars). Also
 * gives us per-chunk progress.
 */
const splitIntoChunks = (text: string, lang: "ur" | "en"): string[] => {
  if (!text) return [];
  // Split on . ! ? ۔ (Urdu full-stop) and newlines, keep chunk length ≤ 180 chars.
  const sentenceEnd = lang === "ur" ? /[۔.!?\n]/ : /[.!?\n]/;
  const rough = text.split(sentenceEnd).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const s of rough) {
    if ((buf + " " + s).trim().length > 180) {
      if (buf) chunks.push(buf.trim());
      buf = s;
    } else {
      buf = (buf + " " + s).trim();
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text];
};

const TextToSpeechPlayer = ({ text, title, onClose, autoPlay = true }: TTSPlayerProps) => {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(() => {
    const saved = localStorage.getItem("tts-speed");
    return saved ? Number(saved) : 1;
  });
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [autoPlayAttempted, setAutoPlayAttempted] = useState(false);

  const chunkIdxRef = useRef(0);
  const chunksRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const cleaned = useMemo(() => cleanText(text), [text]);
  const detectedLang = useMemo(() => detectTextLanguage(cleaned), [cleaned]);
  const voice = useMemo(() => pickVoice(voices, detectedLang), [voices, detectedLang]);
  const chunks = useMemo(() => splitIntoChunks(cleaned, detectedLang), [cleaned, detectedLang]);

  // Keep refs in sync for use inside the speakNext callback.
  useEffect(() => { chunksRef.current = chunks; }, [chunks]);
  useEffect(() => { chunkIdxRef.current = 0; }, [cleaned]);

  // Voice lists load asynchronously in most browsers — wait for them.
  useEffect(() => {
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length) {
        setVoices(v);
        setVoicesReady(true);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    const kickTimer = setTimeout(load, 250);
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      clearTimeout(kickTimer);
    };
  }, []);

  const configureUtterance = useCallback((utter: SpeechSynthesisUtterance, lang: "ur" | "en") => {
    // Urdu reads slightly slower by default; nudge the base rate down for
    // clarity, then apply the user's chosen speed multiplier on top so the
    // 0.75x/1x/1.25x/1.5x/2x dropdown actually changes anything.
    const baseRate = lang === "ur" ? 0.88 : 1;
    utter.rate = Math.min(10, Math.max(0.1, baseRate * speed));
    utter.pitch = 1;
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = lang === "ur" ? "ur-PK" : "en-US";
    }
  }, [voice, speed]);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    setPlaying(false);
    setPaused(false);
    setProgress(0);
    chunkIdxRef.current = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  /**
   * Speaks the next chunk in the queue. Called recursively via utter.onend.
   * This is the key trick for getting Urdu to actually speak on Android —
   * many Android TTS engines will refuse a single long utterance but will
   * happily speak it broken into ~180-char sentence chunks.
   */
  const speakNext = useCallback(() => {
    if (cancelledRef.current) return;
    const list = chunksRef.current;
    const idx = chunkIdxRef.current;
    if (idx >= list.length) {
      setPlaying(false);
      setPaused(false);
      setProgress(100);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const chunk = list[idx];
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    const utter = new SpeechSynthesisUtterance(chunk);
    configureUtterance(utter, detectedLang);
    utter.onstart = () => {
      setPlaying(true);
      setPaused(false);
    };
    utter.onend = () => {
      if (cancelledRef.current) return;
      chunkIdxRef.current += 1;
      setProgress(Math.min(99, Math.round((chunkIdxRef.current / list.length) * 100)));
      // Small gap between chunks helps Android TTS not drop the next one.
      setTimeout(speakNext, 60);
    };
    utter.onerror = (e) => {
      if (cancelledRef.current) return;
      // If a chunk errors, try the next one rather than killing playback.
      chunkIdxRef.current += 1;
      setTimeout(speakNext, 100);
    };
    try {
      window.speechSynthesis.speak(utter);
    } catch {
      setPlaying(false);
    }
  }, [configureUtterance, detectedLang]);

  const play = useCallback(() => {
    if (!cleaned || chunks.length === 0) return;
    cancelledRef.current = false;
    chunkIdxRef.current = 0;
    setProgress(0);

    // Resume audio context (needed on some mobile browsers).
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    try { window.speechSynthesis.resume(); } catch { /* noop */ }

    // Small delay so cancel() finishes flushing the queue.
    setTimeout(() => {
      setPlaying(true);
      setPaused(false);
      speakNext();

      // Progress timer — fallback when onend/onboundary don't fire reliably.
      const totalChunks = chunks.length;
      const estimatedDuration = (cleaned.split(/\s+/).length / (detectedLang === "ur" ? 110 : 150)) * 60 * 1000;
      const start = Date.now();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (cancelledRef.current) return;
        const elapsed = Date.now() - start;
        const pct = Math.min(99, Math.round((elapsed / Math.max(estimatedDuration, 1000)) * 100));
        // Prefer chunk-based progress if available — it's more accurate.
        const chunkPct = Math.round((chunkIdxRef.current / totalChunks) * 100);
        setProgress(Math.max(pct, chunkPct));
      }, 250);
    }, 120);
  }, [cleaned, chunks, detectedLang, speakNext]);

  // ── AUTO-PLAY ──────────────────────────────────────────────────────────
  // As soon as voices are loaded (and we haven't already attempted), kick
  // off narration automatically. This is what makes the player "just start
  // reading" the moment the user clicks the Listen pill — English or Urdu.
  useEffect(() => {
    if (!autoPlay || autoPlayAttempted) return;
    if (!voicesReady) return;
    const t = setTimeout(() => {
      setAutoPlayAttempted(true);
      play();
    }, 400);
    return () => clearTimeout(t);
  }, [autoPlay, autoPlayAttempted, voicesReady, play]);

  // If voices are slow to load, attempt with whatever we have after 1.6s.
  // (Even if no Urdu voice is found, the engine will fall back to default
  // and at least make a sound — better than silence.)
  useEffect(() => {
    if (!autoPlay || autoPlayAttempted) return;
    const t = setTimeout(() => {
      setAutoPlayAttempted(true);
      play();
    }, 1600);
    return () => clearTimeout(t);
  }, [autoPlay, autoPlayAttempted, play]);

  const togglePause = () => {
    if (paused) {
      // Resume by re-speaking from the same chunk rather than calling the
      // native speechSynthesis.resume() — on Chrome Android (and some other
      // engines) resume() after a pause() very often just never continues,
      // leaving the player silently stuck. Cancelling and re-speaking the
      // current chunk is slightly less seamless (may repeat a word or two)
      // but is reliable everywhere.
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      cancelledRef.current = false;
      setPaused(false);
      setPlaying(true);
      setTimeout(speakNext, 80);
    } else {
      cancelledRef.current = true;
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      setPaused(true);
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    localStorage.setItem("tts-speed", String(s));
    if (playing) {
      // Restart from current chunk with new speed.
      const idx = chunkIdxRef.current;
      cancelledRef.current = true;
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      setTimeout(() => {
        cancelledRef.current = false;
        chunkIdxRef.current = idx;
        setPlaying(true);
        setPaused(false);
        speakNext();
      }, 150);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Keep speed applied to the speech engine — utter.rate is set per chunk
  // from configureUtterance, but we also nudge it for the active utterance
  // when speed changes mid-playback.
  useEffect(() => {
    // no-op; speed is read inside speakNext via the next chunk.
  }, [speed]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", damping: 24, stiffness: 280 }}
        className="fixed bottom-0 left-0 right-0 z-50 shadow-elevated"
        style={{
          background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--card) / 0.99) 100%)",
          borderTop: "1px solid hsl(var(--gold) / 0.5)",
          boxShadow: "0 -10px 30px -10px rgba(0,0,0,0.25)",
        }}
      >
        {/* Top hairline accent — subtle gold/crimson dual-rule */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="container mx-auto max-w-3xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
          {/* Row 1 (mobile) — status icon + title/meta/progress */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md"
              style={{
                background: "linear-gradient(135deg, hsl(43 89% 34%) 0%, hsl(43 89% 26%) 100%)",
              }}
            >
              {playing && !paused ? (
                <Volume2 className="w-4 h-4 text-[hsl(40_50%_97%)]" style={{ animation: "none" }} />
              ) : !voicesReady && !autoPlayAttempted ? (
                <Loader2 className="w-4 h-4 text-[hsl(40_50%_97%)] animate-spin" />
              ) : (
                <Volume2 className="w-4 h-4 text-[hsl(40_50%_97%)]" />
              )}
            </div>

            {/* Title + meta + progress — stacked compactly */}
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium text-foreground truncate"
                dir={detectedLang === "ur" ? "rtl" : "ltr"}
                style={detectedLang === "ur" ? { fontFamily: "var(--font-urdu)" } : undefined}
              >
                {title}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground/80">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: "hsl(43 89% 34%)" }}
                  />
                  {detectedLang === "ur" ? "Urdu narration" : "English narration"}
                </span>
                <span className="text-[9px] text-muted-foreground/50">·</span>
                <span className="text-[9px] text-muted-foreground/70">
                  {playing && !paused ? "Playing" : paused ? "Paused" : "Ready"}
                </span>
                {/* Progress bar */}
                <div className="flex-1 bg-secondary rounded-full h-1 ml-1 overflow-hidden">
                  <div
                    className="h-1 rounded-full transition-all duration-300"
                    style={{
                      width: `${progress}%`,
                      background: "linear-gradient(90deg, hsl(43 89% 34%) 0%, hsl(43 89% 45%) 100%)",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2 (mobile) — controls get their own row and full width so
              nothing is squeezed onto one cramped line next to the title. */}
          <div className="flex items-center justify-end gap-1.5 shrink-0 pl-[52px] sm:pl-0">
            {!playing ? (
              <button
                onClick={play}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[hsl(20_74%_38%)] hover:bg-secondary transition-colors"
                aria-label="Play"
              >
                <Play className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={togglePause}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[hsl(20_74%_38%)] hover:bg-secondary transition-colors"
                aria-label="Pause/Resume"
              >
                {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={stop}
              disabled={!playing}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-40"
              aria-label="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { stop(); onClose(); }}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            {/* Speed pill — clearly bounded, doesn't crowd the other controls */}
            <div className="ml-1 pl-2 border-l border-border">
              <select
                value={speed}
                onChange={e => changeSpeed(Number(e.target.value))}
                className="text-xs bg-secondary rounded-md px-2 py-1.5 border border-border/50 outline-none cursor-pointer hover:border-gold/60 transition-colors min-w-[44px]"
                aria-label="Playback speed"
              >
                {speeds.map(s => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TextToSpeechPlayer;

// Listen button — same pill shape used on cards & the detail page.
export const ListenButton = ({ onClick }: { onClick: (e: React.MouseEvent) => void }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold
               bg-gradient-to-r from-[hsl(20_74%_38%)] to-[hsl(20_70%_30%)] text-[hsl(40_50%_97%)]
               hover:brightness-110 active:scale-95 transition-all shadow-sm
               ring-1 ring-[hsl(20_74%_38%)]/30"
  >
    <Volume2 className="w-3.5 h-3.5" /> Listen
  </button>
);
