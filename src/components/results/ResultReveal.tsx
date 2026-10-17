import { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, ArrowDown, Trophy } from "lucide-react";
// ── Iron Man HUD Assembly 🤖 — digits fly in from the screen corners, spin,
// spring-lock into place, then a blue/orange energy pulse radiates out and
// the subject bars complete like digital circuits. See HudAssembly.tsx.
import { HudDigits, HudPulse, CircuitFill } from "@/components/results/HudAssembly";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULT REVEAL — cinematic result moment for GHS Babi Khel
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Opens straight to the result card — no curtain-lift / scratch-card choice
// screen, no 3D tilt, no gold glow. A gold confetti burst (pass) or calm
// teal sparkle drift (fail) fires immediately alongside a soft thump + ta-da
// chime, while the marks and subject bars animate in at normal speed via the
// Iron Man HUD digit assembly.
//
// SMOOTHNESS CONTRACT (why it never hangs on a low-end phone):
//   • All reveal motion is transform/opacity only — progress bars animate
//     scaleX (GPU) instead of width (layout).
//   • Subject rows are memoized so their entrance stays cheap.
//
// SAFETY RULES (the "don't distract / don't break anything" contract):
//   • Appears ONLY after the student actively searches — never on page load.
//   • Always closeable in one tap; full result cards stay below, untouched.
//   • Gentle celebration sounds are synthesized on-device (WebAudio, no audio
//     files, modest volume).
//   • prefers-reduced-motion users see everything appear instantly, with no
//     confetti/sound and no digit fly-in.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface RevealSubject {
  name: string;
  obtained: number;
  /** Total marks for the subject — null when the board doesn't publish per-subject totals (e.g. BISE Peshawar theory/practical columns). */
  total: number | null;
  /** Raw theory marks string (BISE Peshawar) — shown as a chip when there is no bar. */
  theory?: string | null;
  /** Raw practical marks string (BISE Peshawar) — shown as a chip when there is no bar. */
  practical?: string | null;
  /** BISE Peshawar: bar length 0–100 (obtained relative to the top subject). null = no bar. */
  barPct?: number | null;
  /** BISE Peshawar: true when a part failed — bar turns red. */
  barFail?: boolean;
}

export interface RevealResultData {
  studentName: string;
  /** Class label — null/omitted for board results where the class isn't part of the record. */
  className?: string | null;
  examLabel: string;
  rollNo?: string | null;
  /** null when the source only offers a raw marks string (BISE Peshawar). */
  obtained: number | null;
  total: number | null;
  percentage: number | null;
  grade: string;
  isPass: boolean;
  subjects: RevealSubject[];
  photoUrl?: string | null;
  /** Raw marks line (e.g. "455/550") shown when obtained/total can't be split. */
  marksLine?: string | null;
  /** Board remarks (e.g. "PROMOTED") shown in the compact stats row. */
  remarksLine?: string | null;
  /** Class rank, when known — 1 marked the class topper. School results only; board (BISE) results omit this. */
  classPosition?: number | null;
  /** Whole-school rank (Trophy badge on the full result card), when known.
   *  School results only; board (BISE) results omit this. Kept separate from
   *  classPosition because the reveal card shows BOTH badges. */
  schoolRank?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  data: RevealResultData;
}

export type CelebrationMode = "gold" | "calm";
type PlayFn = (kind: "thump" | "tada") => void;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// NOTE: the old rAF count-up was replaced by the Iron Man HUD Assembly —
// stats no longer tick 0→N; each digit now flies in from a screen corner,
// spins, and spring-locks into place (HudDigits below), which is both more
// cinematic AND cheaper (one mount-once motion timeline vs. ~30fps of
// React re-renders per number on low-end phones).

// ── Celebration audio — synthesized with WebAudio, zero audio assets ────────
// Always on (the old on/off toggle is gone). Deliberately gentle: a soft
// filtered noise roll under the curtain, one deep-but-quiet thump at the
// payoff, then a short bright ta-da chime. Modest gains throughout.
export function useRevealAudio(): { play: PlayFn; prime: () => void } {
  const ctxRef = useRef<AudioContext | null>(null);

  const prime = useCallback(() => {
    try {
      if (!ctxRef.current) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) ctxRef.current = new AC();
      }
      if (ctxRef.current && ctxRef.current.state === "suspended") {
        void ctxRef.current.resume();
      }
    } catch { /* audio unavailable — stay silent */ }
  }, []);

  const play = useCallback<PlayFn>((kind) => {
    try {
      prime();
      const ctx = ctxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;

      if (kind === "thump") {
        // Deep-but-quiet cinematic landing
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(150, now);
        o.frequency.exponentialRampToValueAtTime(44, now + 0.3);
        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
        o.connect(g); g.connect(ctx.destination);
        o.start(now); o.stop(now + 0.4);
      } else {
        // ta-da — short bright chime arpeggio + one sparkle ping
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const t = now + i * 0.085;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "triangle";
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
          o.connect(g); g.connect(ctx.destination);
          o.start(t); o.stop(t + 0.6);
        });
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = "sine";
        o2.frequency.value = 1567.98;
        g2.gain.setValueAtTime(0.0001, now + 0.34);
        g2.gain.exponentialRampToValueAtTime(0.07, now + 0.37);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        o2.connect(g2); g2.connect(ctx.destination);
        o2.start(now + 0.34); o2.stop(now + 0.95);
      }
    } catch { /* audio unavailable — stay silent */ }
  }, [prime]);

  return { play, prime };
}

// ── School crest — honey hexagon frame, umber shield, GHS monogram ─────────
// The glow is a blurred radial div fading by OPACITY (compositor-only) —
// animating a drop-shadow filter repaints every frame and was a major source
// of the reveal jank on low-end phones.
const Crest = ({ size = 72, glow }: { size?: number; glow: "gold" | "teal" | "none" }) => (
  <div className="relative shrink-0" style={{ width: size, height: size }}>
    <div
      className="absolute inset-0 rounded-full pointer-events-none"
      style={{
        background:
          glow === "teal"
            ? "radial-gradient(circle, rgba(94,210,189,0.45) 0%, rgba(94,210,189,0) 65%)"
            : "radial-gradient(circle, rgba(250,185,71,0.55) 0%, rgba(250,185,71,0) 65%)",
        transform: "scale(1.9)",
        opacity: glow === "none" ? 0 : 1,
        transition: "opacity 1.1s ease",
      }}
    />
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg" className="relative">
      <defs>
        <linearGradient id="crestGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD591" />
          <stop offset="55%" stopColor="#F0A70C" />
          <stop offset="100%" stopColor="#C77D14" />
        </linearGradient>
        <linearGradient id="crestField" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5C3315" />
          <stop offset="100%" stopColor="#331B0C" />
        </linearGradient>
      </defs>
      {/* Hexagon frame */}
      <path d="M32 3 L57 16.5 V47.5 L32 61 L7 47.5 V16.5 Z" fill="url(#crestGold)" />
      <path d="M32 8 L52.5 18.9 V45.1 L32 56 L11.5 45.1 V18.9 Z" fill="url(#crestField)" />
      <path d="M32 10.8 L50.2 20.4 V43.6 L32 53.2 L13.8 43.6 V20.4 Z" fill="none" stroke="#EFA70C" strokeOpacity="0.5" strokeWidth="1" />
      {/* Star */}
      <path d="M32 14.5 l1.7 3.4 3.8 0.5 -2.75 2.65 0.65 3.75 -3.4 -1.8 -3.4 1.8 0.65 -3.75 -2.75 -2.65 3.8 -0.5 Z" fill="#FFD591" opacity="0.95" />
      {/* Open book + GHS */}
      <path d="M20 40 c4 -2.4 8 -2.4 12 0 c4 -2.4 8 -2.4 12 0 v6 c-4 -2.4 -8 -2.4 -12 0 c-4 -2.4 -8 -2.4 -12 0 Z" fill="#FFD591" opacity="0.9" />
      <text x="32" y="36.4" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="10.5" fill="#FFF3DC" letterSpacing="1">GHS</text>
    </svg>
  </div>
);

// ── Subject rows — memoized so count-up re-renders never touch them ─────────
// Bars animate scaleX (transform, GPU-composited) instead of width (layout) —
// animating width reflows the page for every row on every frame.
// During the HUD moment (`energized`), fills grow like a digital circuit:
// circuit dashes light up and a glowing energy tip rides the leading edge.
const SubjectRows = memo(function SubjectRows({ subjects, visible, animate }: {
  subjects: RevealSubject[]; visible: boolean; animate: boolean;
}) {
  if (subjects.length === 0) return null;
  return (
    <div className="mt-4 space-y-1.5 text-left">
      {subjects.map((s, i) => {
        const hasBar = s.total != null && s.total > 0;
        const pct = hasBar ? Math.min(Math.round(((s.obtained || 0) / (s.total as number)) * 100), 100) : 0;
        return (
          <motion.div
            key={`${s.name}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={visible ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: animate ? 0.75 + i * 0.045 : 0, duration: 0.4 }}
            className="flex items-center gap-2.5"
          >
            <span className="text-[11.5px] text-foreground w-24 shrink-0 truncate font-medium" title={s.name}>{s.name}</span>
            {hasBar ? (
              <>
                <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                  <CircuitFill
                    pct={pct}
                    visible={visible}
                    energized={animate}
                    delay={animate ? 0.85 + i * 0.045 : 0}
                    duration={0.55}
                    className={pct < 33 ? "bg-gradient-to-r from-rose-500 to-rose-400" : "bg-gradient-to-r from-orange-600 to-amber-400"}
                  />
                </div>
                <span className="text-[11px] font-bold text-foreground w-14 text-right tabular-nums shrink-0">{s.obtained}/{s.total}</span>
              </>
            ) : (
              <>
              {s.barPct != null && (
                <div className="flex-1 min-w-[28px] bg-secondary rounded-full h-1 overflow-hidden">
                  <CircuitFill
                    pct={Math.max(0, Math.min(100, s.barPct))}
                    visible={visible}
                    energized={animate}
                    delay={animate ? 0.85 + i * 0.045 : 0}
                    duration={0.55}
                    className={s.barFail ? "bg-gradient-to-r from-red-500 to-red-400" : "bg-gradient-to-r from-blue-600 to-sky-400"}
                  />
                </div>
              )}
              <div className={`${s.barPct != null ? "shrink-0" : "flex-1"} flex justify-end gap-1.5 min-w-0`}>
                {s.theory && s.theory !== "—" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary border border-border text-foreground whitespace-nowrap">Theory {s.theory}</span>
                )}
                {s.practical && s.practical !== "—" && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-secondary border border-border text-foreground whitespace-nowrap">Prac {s.practical}</span>
                )}
              </div>
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
});

// ── Shared summary card — the actual result, styled premium ─────────────────
// mode "hidden"   → stats/subjects invisible (theater pre-reveal)
// mode "animate"  → IRON MAN HUD: digits fly in from the screen corners and
//                   spring-lock, an energy pulse radiates out, subject bars
//                   complete like circuits, light sweep crosses the card
// mode "static"   → everything plainly visible (scratch payoff / calm mode);
//                   the scratch payoff re-fires the energy pulse + circuits
const SummaryCard = ({ data, mode, celebrate }: { data: RevealResultData; mode: "hidden" | "animate" | "static"; celebrate?: boolean }) => {
  const animate = mode === "animate";
  const visible = mode !== "hidden";
  const hasFullMarks = data.obtained != null && data.total != null;
  const glow = !visible ? "none" : data.isPass ? "gold" : "teal";
  const displayName = data.studentName.trim();

  // School results have obtained/total/percent; board (BISE Peshawar) results
  // fall back to the raw marks line + grade + remarks.
  const stats = hasFullMarks
    ? [
        { l: "Obtained", v: data.obtained, c: "text-blue-600 dark:text-blue-400" },
        { l: "Total", v: data.total, c: "text-foreground" },
        { l: "Percent", v: `${data.percentage}%`, c: "text-orange-600 dark:text-orange-400" },
        { l: "Grade", v: data.grade, c: "text-amber-600 dark:text-amber-400" },
      ]
    : [
        { l: "Marks", v: data.marksLine || "—", c: "text-blue-600 dark:text-blue-400" },
        { l: "Grade", v: data.grade, c: "text-amber-600 dark:text-amber-400" },
        { l: "Remarks", v: data.remarksLine || "—", c: "text-teal-600 dark:text-teal-400" },
      ];

  // ── Iron Man HUD: energy pulse scheduling.
  // In HUD mode the pulse fires right after the LAST digit of the LAST stat
  // locks in — computed from the exact same schedule HudDigits uses
  // (base 0.38s + 0.1s per stat + 0.11s per char + 0.56s flight). In scratch
  // mode it fires just after the foil pops, as the circuits re-complete.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (mode === "animate") {
      const values = hasFullMarks
        ? [data.obtained ?? "", data.total ?? "", `${data.percentage ?? ""}%`, data.grade ?? ""]
        : [data.marksLine || "—", data.grade || "—", data.remarksLine || "—"];
      const maxChars = Math.max(1, ...values.map(v => String(v).length));
      const at = (0.38 + (values.length - 1) * 0.1 + maxChars * 0.11 + 0.56 + 0.18) * 1000;
      const t = window.setTimeout(() => setPulseKey(k => k + 1), at);
      return () => window.clearTimeout(t);
    }
    if (mode === "static" && celebrate) {
      const t = window.setTimeout(() => setPulseKey(k => k + 1), 320);
      return () => window.clearTimeout(t);
    }
  }, [mode, celebrate, hasFullMarks, data]);

  return (
    <div ref={rootRef} className="relative w-[min(92vw,400px)]">
      <div className="relative w-full bg-card rounded-3xl border border-border shadow-2xl overflow-hidden">
      {/* Light sweep on reveal (theater) or finished scratching */}
      {((animate && !celebrate) || (celebrate && mode === "static")) && (
        <motion.div
          key="sweep"
          initial={{ x: "-130%" }}
          animate={{ x: "130%" }}
          transition={{ duration: 1.25, ease: "easeInOut", delay: 0.15 }}
          className="absolute inset-0 pointer-events-none z-20"
          style={{ background: "linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.35) 50%, transparent 58%)" }}
        />
      )}

      <div className="px-6 pt-6 pb-5 text-center relative">
        {/* Crest + school */}
        <div className="flex flex-col items-center">
          <Crest size={72} glow={glow} />
          <p className="mt-2.5 text-[11px] font-bold tracking-[0.22em] uppercase text-muted-foreground">GHS Babi Khel</p>
          <span className="mt-1.5 inline-flex items-center bg-secondary border border-border rounded-full px-3 py-0.5 text-[10px] font-bold tracking-wide uppercase text-secondary-foreground">
            {data.examLabel}{data.className ? ` · Class ${data.className}` : ""}
          </span>
        </div>

        {/* Student — premium monogram: honey-gold ring, ember core, star pin */}
        <div className="mt-4 flex items-center justify-center gap-3">
          {data.photoUrl ? (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={visible ? { scale: 1, opacity: 1 } : {}}
              transition={{ type: "spring", stiffness: 300, damping: 20, delay: animate ? 0.1 : 0 }}
              className="shrink-0 rounded-full p-[2.5px]"
              style={{ background: "linear-gradient(135deg,#FFD9A8 0%,#F59E4C 45%,#D97A1E 100%)", boxShadow: "0 5px 16px -5px rgba(240,140,50,0.6)" }}
            >
              <img src={data.photoUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={visible ? { scale: 1, opacity: 1 } : {}}
              transition={{ type: "spring", stiffness: 300, damping: 20, delay: animate ? 0.1 : 0 }}
              className="relative shrink-0"
            >
              <div
                className="w-12 h-12 rounded-full p-[2.5px]"
                style={{ background: "linear-gradient(135deg,#FFD9A8 0%,#F59E4C 45%,#D97A1E 100%)", boxShadow: "0 5px 16px -5px rgba(240,140,50,0.6)" }}
              >
                <div
                  className="w-full h-full rounded-full flex items-center justify-center"
                  style={{ background: "linear-gradient(160deg,#6B3A16 0%,#3E2110 100%)" }}
                >
                  <span className="text-white text-lg font-black font-heading leading-none">{displayName.charAt(0)}</span>
                </div>
              </div>
              <span
                className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                style={{ background: "linear-gradient(135deg,#FFD9A8,#F0A70C)", boxShadow: "0 1px 5px rgba(240,140,50,0.65)" }}
              >
                <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden>
                  <path d="M5 0 l1.2 3.8 L10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8 Z" fill="#fff" />
                </svg>
              </span>
            </motion.div>
          )}
          <div className="text-left min-w-0 flex-1">
            {data.isPass ? (
              <h3 className="font-heading font-extrabold text-base sm:text-lg text-foreground leading-snug break-words">
                Congratulations, {displayName}! <span aria-hidden>🎉</span>
              </h3>
            ) : (
              <h3 className="font-heading font-extrabold text-base sm:text-lg text-foreground leading-snug break-words">
                Your result is here, {displayName}
              </h3>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {data.rollNo ? <>Roll No <span className="font-mono font-bold text-foreground">{data.rollNo}</span></> : data.studentName}
            </p>
          </div>
        </div>

        {/* Respectful support line for the hard days — no red, no shame */}
        {!data.isPass && visible && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: animate ? 0.9 : 0, duration: 0.5 }}
            className="mt-3 mx-auto max-w-[300px] rounded-xl bg-teal-50 dark:bg-teal-900/25 border border-teal-200/70 dark:border-teal-800/60 px-3.5 py-2">
            <p className="text-[11.5px] leading-relaxed font-medium text-teal-800 dark:text-teal-300">
              Every result is a step. Talk to your teacher tomorrow.
            </p>
          </motion.div>
        )}

        {/* Stats — labels fade in; in HUD mode the values are assembled by
            digits flying in from the four corners of the screen. The parent
            cell skips its y-offset in HUD mode so the measured landing
            positions match the placeholder exactly. */}
        <div className={`mt-5 grid ${hasFullMarks ? "grid-cols-4" : "grid-cols-3"} divide-x divide-border rounded-2xl border border-border bg-background/60`}>
          {stats.map((s, i) => (
            <motion.div key={s.l} initial={animate ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={visible ? { opacity: 1, y: 0 } : {}} transition={{ delay: animate ? 0.3 + i * 0.08 : 0, duration: 0.45 }} className="py-2.5 px-1">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">{s.l}</p>
              {animate ? (
                <HudDigits
                  value={String(s.v)}
                  className={`text-base sm:text-lg font-extrabold tabular-nums ${s.c}`}
                  delay={0.38 + i * 0.1}
                  charDelay={0.11}
                />
              ) : (
                <p className={`text-base sm:text-lg font-extrabold tabular-nums ${s.c}`}>{s.v}</p>
              )}
            </motion.div>
          ))}
        </div>

        {/* Rank + Class Position badges — school results only.
            FIX: the full result card below always showed the Trophy "Rank #N"
            and "Class Position: #N" badges, but this reveal card (shared by
            BOTH The Grand Reveal and Scratch & Shine) silently dropped them —
            so students who celebrated through the theater never saw where they
            stood. Both badges render here, matching the full card's styling
            (amber trophy pill for school rank, neutral pill for class
            position). Board (BISE Peshawar) results have neither value, and
            the row hides itself entirely for them instead of showing dashes. */}
        {(data.schoolRank != null || data.classPosition != null) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={visible ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: animate ? 0.72 : 0, duration: 0.45 }}
            className="mt-3 flex items-center justify-center gap-2 flex-wrap"
          >
            {data.schoolRank != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 px-3 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-300">
                <Trophy className="w-3 h-3 text-amber-500" />
                Rank #{data.schoolRank}
              </span>
            )}
            {data.classPosition != null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-3 py-1 text-[11px] font-bold text-secondary-foreground">
                Class Position #{data.classPosition}
              </span>
            )}
          </motion.div>
        )}

        {/* Subject rows — one at a time, 0.045s stagger (circuits during HUD) */}
        <SubjectRows subjects={data.subjects} visible={visible} animate={animate} />
      </div>
      </div>

      {/* Iron Man energy pulse — blue + orange rings radiate from the card's
          center once every digit has locked into place */}
      {pulseKey > 0 && <HudPulse key={pulseKey} anchorRef={rootRef} />}
    </div>
  );
};

// ── Summary stage — the one and only reveal view ────────────────────────────
// Numbers and subject bars animate in at normal speed (HudDigits) unless the
// user prefers reduced motion, in which case everything appears instantly.
const SummaryStage = ({ data, onDone }: { data: RevealResultData; onDone: () => void }) => {
  const reduced = prefersReducedMotion();
  return (
    <div className="w-[min(92vw,430px)] flex flex-col items-center">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <SummaryCard data={data} mode={reduced ? "static" : "animate"} celebrate />
      </motion.div>
      <motion.button onClick={onDone} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl px-6 py-3 font-bold text-sm text-white shadow-lg"
        style={{ background: "linear-gradient(135deg, hsl(147 48% 10%), hsl(150 40% 16%))" }}>
        View Full Result Card <ArrowDown className="w-4 h-4" />
      </motion.button>
    </div>
  );
};

// ── Celebration canvas — gold confetti burst (pass) / calm teal drift (fail)
// One <canvas>, one rAF loop, auto-stops and clears itself. No shadows, no
// blur, no React re-renders — 60fps even on low-end phones.
export const CelebrationCanvas = ({ mode }: { mode: CelebrationMode }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const gold = mode === "gold";
    const colors = gold
      ? ["#FFD591", "#F0A70C", "#FFF3DC", "#C2410C", "#FFFFFF"]
      : ["#8ED8C9", "#C4CFD4", "#E9EEF0", "#2F6B4F"];

    interface P { x: number; y: number; vx: number; vy: number; size: number; rot: number; vr: number; color: string; round: boolean; delay: number; }
    const parts: P[] = [];
    const N = gold ? 120 : 16;
    for (let i = 0; i < N; i++) {
      if (gold) {
        // Burst from behind the card, like a party popper
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 7;
        parts.push({
          x: w / 2 + (Math.random() - 0.5) * 60,
          y: h * 0.4 + (Math.random() - 0.5) * 40,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 5.5,
          size: 3 + Math.random() * 4.5,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[i % colors.length],
          round: Math.random() < 0.3,
          delay: Math.random() * 160,
        });
      } else {
        // Gentle respectful drift — sparkles falling like slow snow
        parts.push({
          x: Math.random() * w,
          y: -20 - Math.random() * 80,
          vx: (Math.random() - 0.5) * 0.5,
          vy: 0.5 + Math.random() * 0.7,
          size: 2.5 + Math.random() * 3,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.06,
          color: colors[i % colors.length],
          round: Math.random() < 0.4,
          delay: Math.random() * 900,
        });
      }
    }

    let raf = 0;
    const t0 = performance.now();
    const LIFE = gold ? 2200 : 3000;
    const tick = (t: number) => {
      const el = t - t0;
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of parts) {
        if (el < p.delay) { alive = true; continue; }
        const age = el - p.delay;
        if (age > LIFE) continue;
        alive = true;
        if (gold) { p.vy += 0.16; p.vx *= 0.985; p.vy *= 0.99; }
        else { p.vx += Math.sin(age / 500 + p.rot) * 0.012; }
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        const fade = age > LIFE - 500 ? (LIFE - age) / 500 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
        ctx.restore();
      }
      if (alive && el < LIFE + 1200) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[45]" />;
};

// ── Main overlay ────────────────────────────────────────────────────────────
// Opens straight to the result — no curtain-lift / scratch-card choice
// screen. Confetti (pass) or a calm sparkle drift (fail) fires immediately,
// plus the soft thump + ta-da chime, while the numbers and subject bars
// animate in via HudDigits — cinematic, but with zero extra taps.
const ResultRevealOverlay = ({ open, onClose, data }: Props) => {
  const [celebration, setCelebration] = useState<{ k: number; mode: CelebrationMode } | null>(null);
  const { play, prime } = useRevealAudio();
  const reduced = useRef(false);
  const firedRef = useRef(false);

  // Reset + fire celebration each time the overlay opens
  useEffect(() => {
    if (open) {
      reduced.current = prefersReducedMotion();
      setCelebration(null);
      firedRef.current = false;
      // Lock page scroll while the overlay is up
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      if (!reduced.current && !firedRef.current) {
        firedRef.current = true;
        prime();
        const t1 = window.setTimeout(() => play("thump"), 120);
        const t2 = window.setTimeout(() => {
          play("tada");
          setCelebration(c => ({ k: (c?.k ?? 0) + 1, mode: data.isPass ? "gold" : "calm" }));
        }, 260);
        return () => { document.body.style.overflow = prev; window.clearTimeout(t1); window.clearTimeout(t2); };
      }
      return () => { document.body.style.overflow = prev; };
    }
  }, [open, data.isPass, play, prime]);

  // Esc to close — one more escape hatch
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[90]"
          style={{ background: "radial-gradient(circle at 50% 38%, rgba(31,18,10,0.90), rgba(15,8,4,0.95))" }}
          role="dialog" aria-modal="true" aria-label="Result reveal"
        >
          {/* Close — anchored to the viewport root, so it never scrolls away. */}
          <button onClick={onClose} aria-label="Close"
            className="absolute top-4 right-4 z-40 w-10 h-10 rounded-full bg-black/55 hover:bg-black/70 border border-white/25 text-white flex items-center justify-center shadow-lg backdrop-blur-sm transition-colors">
            <X className="w-5 h-5" />
          </button>

          {/* Confetti / sparkle celebration (fires immediately on open) */}
          {celebration && <CelebrationCanvas key={celebration.k} mode={celebration.mode} />}

          {/* ── Scrollable viewport ──
              TALL cards (BISE Peshawar with ~20 subject rows) grow past the
              viewport and SCROLL — fully, top and bottom, on touch and
              desktop. min-h-full + items-center keeps short cards centered
              without ever clipping tall ones. overflow-x-hidden keeps the
              HUD digits' flight corridor from creating a horizontal
              scrollbar — they simply enter from the screen edge. */}
          <div
            className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
                <SummaryStage data={data} onDone={onClose} />
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ResultRevealOverlay;
