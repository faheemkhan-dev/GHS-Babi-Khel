import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HUD ASSEMBLY — the "Iron Man" reveal 🤖
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Three sci-fi building blocks used by the result reveal:
//
//   HudDigits  — a stat value ("484", "90%", "A+") breaks into individual
//     characters. Each character flies in from a corner of the SCREEN,
//     spinning and rotating, then spring-locks into its exact place on the
//     card with a cyan HUD flash and a soft synthesized tick. Implemented
//     with an invisible layout placeholder (reserves the exact final space,
//     so nothing reflows) + a fixed-position portal layer that renders the
//     flying characters ABOVE the card (they must be free to leave the
//     card's clipping). When the last character lands, the real inline
//     value swaps in seamlessly.
//
//   HudPulse   — the moment all digits lock, blue + orange energy rings
//     radiate out from the center of the card (fixed-position portal so the
//     rings can escape the card's rounded clipping). One soft "power-up"
//     whoosh. Pure transform/opacity — GPU only.
//
//   CircuitFill — the subject bars don't just fill up; a glowing energy tip
//     races along the bar like a current completing a digital circuit, with
//     faint circuit dashes lighting up behind it. ONE scaleX transform on
//     the fill does all the work (the tip and dashes live inside the scaled
//     element, so they stretch with the fill = free motion, zero JS).
//
// PERFORMANCE + ACCESSIBILITY CONTRACT:
//   • Transform / opacity only — no filters, no layout animations, no
//     per-frame React state (the flight is a mount-once motion timeline).
//   • Sounds are synthesized on-device with WebAudio (no audio files) at
//     modest volume, and fail silently when audio is unavailable.
//   • Callers never render HUD components for prefers-reduced-motion users —
//     they get the calm static card instead (see ResultReveal).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Tiny WebAudio synth — HUD ticks + power-up whoosh ───────────────────────
let hudAC: AudioContext | null = null;

function hudAudio(): AudioContext | null {
  try {
    if (!hudAC) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      hudAC = new AC();
    }
    if (hudAC.state === "suspended") void hudAC.resume();
    return hudAC;
  } catch {
    return null;
  }
}

/** Short bright lock tick — one per landing digit. */
function hudTick() {
  const ctx = hudAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 1250 + Math.random() * 550;
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.09);
  } catch { /* stay silent */ }
}

/** Soft rising power-up whoosh — fires with the energy pulse. */
function hudWhoosh() {
  const ctx = hudAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    const dur = 0.55;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(2300, t + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
    // low arc-reactor hum underneath
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(320, t + dur * 0.7);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og);
    og.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur);
  } catch { /* stay silent */ }
}

// ── HudDigits ────────────────────────────────────────────────────────────────

/** Screen corners the digits fly in from (fractions of the viewport). */
const CORNERS = [
  { x: -0.74, y: -0.66 }, // top-left
  { x: 0.74, y: -0.66 },  // top-right
  { x: 0.74, y: 0.66 },   // bottom-right
  { x: -0.74, y: 0.66 },  // bottom-left
];

/** Spring flight time used for the lock schedule (matches the spring feel). */
const HUD_FLIGHT_MS = 560;

interface HudDigitsProps {
  value: string;
  /** Typography + color classes — applied to BOTH the placeholder and the flying chars. */
  className?: string;
  /** false → render the plain static value (used for hidden/static modes). */
  active?: boolean;
  /** Base delay before the first char launches (s). */
  delay?: number;
  /** Stagger between chars (s). */
  charDelay?: number;
  /** Lock ticks on/off. */
  sound?: boolean;
}

interface CharTarget { x: number; y: number; w: number; h: number; }

export const HudDigits = memo(function HudDigits({
  value,
  className,
  active = true,
  delay = 0,
  charDelay = 0.11,
  sound = true,
}: HudDigitsProps) {
  const [landed, setLanded] = useState(!active);
  const phRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [targets, setTargets] = useState<CharTarget[] | null>(null);
  const timers = useRef<number[]>([]);

  const chars = value.split("");

  // Cleanup every scheduled timer on unmount
  useEffect(() => {
    const ids = timers.current;
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, []);

  // Measure each placeholder char's exact on-screen position (twice — fonts settling)
  useLayoutEffect(() => {
    if (!active || landed) return;
    const measure = () => {
      const t: CharTarget[] = [];
      for (let i = 0; i < chars.length; i++) {
        const el = phRefs.current[i];
        if (!el) return;
        const r = el.getBoundingClientRect();
        t.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height });
      }
      setTargets(t);
    };
    measure();
    const id = window.setTimeout(measure, 70);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, landed, value]);

  // Lock schedule — tick per char, then swap the real inline value in
  useEffect(() => {
    if (!active || landed) return;
    for (let i = 0; i < chars.length; i++) {
      const at = delay * 1000 + i * charDelay * 1000 + HUD_FLIGHT_MS - 50;
      timers.current.push(
        window.setTimeout(() => { if (sound) hudTick(); }, Math.max(0, at))
      );
    }
    const last = delay * 1000 + (chars.length - 1) * charDelay * 1000 + HUD_FLIGHT_MS + 120;
    timers.current.push(window.setTimeout(() => setLanded(true), Math.max(0, last)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, landed, delay, charDelay, value, sound]);

  // Static / inactive → plain value, no motion, no portal
  if (!active || landed) {
    return (
      <span className={cn("inline-block whitespace-nowrap", className)}>
        {chars.map((ch, i) => (
          <span key={i} className="inline-block">{ch}</span>
        ))}
      </span>
    );
  }

  return (
    <>
      {/* Layout placeholder — reserves the exact final space (invisible) */}
      <span className={cn("inline-block whitespace-nowrap", className)} aria-label={value}>
        {chars.map((ch, i) => (
          <span
            key={i}
            ref={(el) => { phRefs.current[i] = el; }}
            className="inline-block invisible"
            aria-hidden
          >
            {ch}
          </span>
        ))}
      </span>

      {/* The flying HUD chars — fixed portal layer above the card */}
      {targets &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[95]" aria-hidden>
            {chars.map((ch, i) => {
              const t = targets[i];
              if (!t) return null;
              const c = CORNERS[i % 4];
              const dx = c.x * Math.min(window.innerWidth * 0.52, 500);
              const dy = c.y * Math.min(window.innerHeight * 0.44, 430);
              const rot = (i % 2 === 0 ? 1 : -1) * (380 + (i % 3) * 170);
              const at = delay + i * charDelay;
              const glow = "0 0 18px rgba(125,211,252,0.95), 0 0 42px rgba(56,150,255,0.55)";
              return (
                <motion.span
                  key={i}
                  className={cn("absolute inline-block", className)}
                  style={{ left: t.x, top: t.y, marginLeft: -t.w / 2, marginTop: -t.h / 2 }}
                  initial={{ x: dx, y: dy, rotate: rot, scale: 0.35, opacity: 0, textShadow: glow }}
                  animate={{
                    x: 0,
                    y: 0,
                    rotate: 0,
                    scale: 1,
                    opacity: 1,
                    textShadow: [
                      glow,
                      glow,
                      "0 0 0px rgba(125,211,252,0), 0 0 0px rgba(56,150,255,0)",
                    ],
                  }}
                  transition={{
                    delay: at,
                    type: "spring",
                    stiffness: 300,
                    damping: 25,
                    mass: 0.85,
                    opacity: { delay: at + 0.06, duration: 0.26 },
                    rotate: { delay: at, type: "spring", stiffness: 210, damping: 16 },
                    textShadow: {
                      delay: at + HUD_FLIGHT_MS / 1000,
                      duration: 0.55,
                      ease: "easeOut",
                    },
                  }}
                >
                  {ch}
                </motion.span>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
});

// ── HudPulse — blue + orange energy rings from the card's center ────────────

interface HudPulseProps {
  /** Ref of the element whose center the pulse radiates from (the card). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Power-up whoosh on/off. */
  sound?: boolean;
}

export function HudPulse({ anchorRef, sound = true }: HudPulseProps) {
  const [geo, setGeo] = useState<{ cx: number; cy: number; r: number } | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) { setGone(true); return; }
    const r = el.getBoundingClientRect();
    setGeo({
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      r: (Math.hypot(r.width, r.height) / 2) * 1.06,
    });
    if (sound) hudWhoosh();
    const t = window.setTimeout(() => setGone(true), 2000);
    return () => window.clearTimeout(t);
  }, [anchorRef, sound]);

  if (gone || !geo) return null;

  const D = geo.r * 2;
  const ring = (key: string, delay: number, dur: number, border: string, glow: string) => (
    <motion.span
      key={key}
      className="absolute rounded-full border-2"
      style={{
        left: geo.cx - geo.r,
        top: geo.cy - geo.r,
        width: D,
        height: D,
        borderColor: border,
        boxShadow: glow,
        willChange: "transform, opacity",
      }}
      initial={{ scale: 0.12, opacity: 0.9 }}
      animate={{ scale: 1.06, opacity: 0 }}
      transition={{ delay, duration: dur, ease: [0.16, 0.84, 0.44, 1] }}
    />
  );

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[95]" aria-hidden>
      {/* Arc-reactor core flash — blue flare blooming into orange */}
      <motion.span
        className="absolute rounded-full"
        style={{
          left: geo.cx - geo.r * 0.62,
          top: geo.cy - geo.r * 0.62,
          width: geo.r * 1.24,
          height: geo.r * 1.24,
          background:
            "radial-gradient(circle, rgba(186,230,253,0.9) 0%, rgba(56,150,255,0.42) 30%, rgba(251,146,60,0.32) 55%, rgba(251,146,60,0) 74%)",
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0.22, opacity: 0.95 }}
        animate={{ scale: 1.55, opacity: 0 }}
        transition={{ duration: 0.72, ease: "easeOut" }}
      />
      {ring("b", 0.05, 0.95, "rgba(96,190,255,0.9)", "0 0 24px rgba(56,150,255,0.55)")}
      {ring("o", 0.2, 1.05, "rgba(251,146,60,0.85)", "0 0 22px rgba(251,146,60,0.45)")}
      {ring("w", 0.34, 1.1, "rgba(255,255,255,0.5)", "none")}
    </div>,
    document.body
  );
}

// ── CircuitFill — subject bars grow like a circuit completing ───────────────

interface CircuitFillProps {
  /** Final fill percentage 0..100. */
  pct: number;
  /** false → stays empty (pre-reveal). */
  visible: boolean;
  /** Shows the energy tip + circuit dashes (only during the HUD moment). */
  energized: boolean;
  delay?: number;
  duration?: number;
  /** Color classes for the bar fill. */
  className?: string;
}

export const CircuitFill = memo(function CircuitFill({
  pct,
  visible,
  energized,
  delay = 0,
  duration = 0.55,
  className,
}: CircuitFillProps) {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  return (
    <motion.div
      className={cn("relative h-full w-full rounded-full", className)}
      initial={{ scaleX: 0 }}
      animate={visible ? { scaleX: p } : {}}
      transition={{ delay, duration, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformOrigin: "left center", willChange: "transform" }}
    >
      {energized && (
        <>
          {/* Circuit dashes light up behind the current */}
          <span
            className="absolute inset-0 rounded-full opacity-35"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.7) 0 2px, rgba(255,255,255,0) 2px 8px)",
            }}
          />
          {/* Glowing energy tip riding the leading edge (stretches with scaleX = free motion) */}
          <span
            className="absolute inset-y-0 right-0 w-[7px] rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 100%)",
              boxShadow: "0 0 9px rgba(147,214,255,0.95)",
            }}
          />
        </>
      )}
    </motion.div>
  );
});
