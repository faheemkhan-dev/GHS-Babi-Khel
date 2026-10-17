import { useEffect, useRef } from "react";

/* ════════════════════════════════════════════════════════════════════
   PARTICLE MANIFESTO — the school's soul in a few thousand points
   ────────────────────────────────────────────────────────────────────
   A black field of small antique-gold dust motes drifts in from the
   edges, gathers into a line of the school's mission, holds it for a
   breath, then dissolves back into drifting dust before the next line
   gathers. The cursor (or a finger, on touch) parts the dust like a
   hand moving through smoke — it never grabs or drags anything, it
   just gently displaces the nearest motes and lets them ease back.

   PERFORMANCE / SMOOTHNESS CONTRACT
   • One canvas, one rAF loop, no React re-renders during animation —
     every particle lives in a plain array, mutated in place.
   • Target points are read off an offscreen canvas's text render
     (fillText → getImageData), sampled on a grid — not one DOM node
     per particle, so this scales to thousands of points for free.
   • Point count and text size scale down on narrow / low-DPR screens
     so the phone that struggles with the Scratch foil doesn't struggle
     here either.
   • Cursor/touch repel is a simple radius check against a spatial
     bucket grid (not O(n²) against every point), so it stays smooth
     even with a few thousand particles on screen.
   • prefers-reduced-motion: particles fade straight to a static line
     and stay there — no drifting, no cursor interaction loop running.
   ════════════════════════════════════════════════════════════════════ */

const LINES = [
  "Knowledge. Character. Service.",
  "Every child deserves a future.",
  "We teach the lesson and the person.",
  "Small campus. No small dreams.",
  "Discipline today, opportunity tomorrow.",
];

const GOLD = { r: 247, g: 177, b: 69 };   // matches --gold (honey amber)
const CREAM = { r: 244, g: 235, b: 211 }; // brightest few motes only

interface Particle {
  x: number; y: number;       // current position
  tx: number; ty: number;     // target (formed-word) position
  ox: number; oy: number;     // origin (drift-in) position
  vx: number; vy: number;
  size: number;
  hue: 0 | 1;                 // 0 = gold, 1 = cream (rare, for sparkle)
  baseAlpha: number;
}

type Phase = "gathering" | "holding" | "scattering" | "drifting";

function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Word-wrap `text` to fit `maxW` at the given font, greedy line-break. */
function wrapToLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Sample an offscreen text render into a grid of {x,y} target points.
    Wraps onto up to 2 lines at a legible floor size — instead of shrinking
    a long line down to single-digit pixels to force it onto one line,
    which renders too few pixels per letter to read as text at all. */
function sampleTextPoints(
  text: string,
  canvasW: number,
  canvasH: number,
  fontPx: number,
  floorPx: number
): { x: number; y: number }[] {
  const off = document.createElement("canvas");
  off.width = canvasW;
  off.height = canvasH;
  const octx = off.getContext("2d", { willReadFrequently: true });
  if (!octx) return [];
  octx.clearRect(0, 0, canvasW, canvasH);
  octx.fillStyle = "#fff";
  octx.textAlign = "center";
  octx.textBaseline = "middle";

  const maxW = canvasW * 0.92;
  let size = fontPx;
  let lines: string[] = [text];

  const setFont = (px: number) => { octx.font = `600 ${px}px 'Fraunces', 'Playfair Display', Georgia, serif`; };
  setFont(size);

  // 1) Try to fit on one line by shrinking, but only down to floorPx —
  //    below that a word stops reading as a word once sampled onto dots.
  while (octx.measureText(text).width > maxW && size > floorPx) {
    size -= 1;
    setFont(size);
  }

  // 2) Still too wide at the floor size → wrap onto lines instead of
  //    continuing to shrink past legibility.
  if (octx.measureText(text).width > maxW) {
    size = Math.max(floorPx, Math.round(fontPx * 0.82));
    setFont(size);
    lines = wrapToLines(octx, text, maxW);
    // Keep shrinking (down to a hard floor) until it settles at 2 lines
    // or fewer — 3+ short dotted lines get cramped on a phone-height
    // canvas, so a slightly smaller 2-line layout reads better.
    let guard = 0;
    while (lines.length > 2 && size > 18 && guard < 40) {
      size -= 1;
      setFont(size);
      lines = wrapToLines(octx, text, maxW);
      guard++;
    }
    // Last resort: a stubborn single very long word — shrink further.
    guard = 0;
    while (lines.some((l) => octx.measureText(l).width > maxW) && size > 10 && guard < 40) {
      size -= 1;
      setFont(size);
      lines = wrapToLines(octx, text, maxW);
      guard++;
    }
  }

  const lineHeight = size * 1.22;
  const totalH = lineHeight * lines.length;
  const startY = canvasH / 2 - totalH / 2 + lineHeight / 2;
  lines.forEach((line, i) => octx.fillText(line, canvasW / 2, startY + i * lineHeight));

  const img = octx.getImageData(0, 0, canvasW, canvasH).data;

  // Sampling step scales with the actual rendered font size, so small
  // wrapped text still gets enough dots per letter to read as a word
  // instead of a fixed step crushing detail at small sizes.
  const step = Math.max(1.1, size / 14);

  const points: { x: number; y: number }[] = [];
  for (let y = 0; y < canvasH; y += step) {
    for (let x = 0; x < canvasW; x += step) {
      const alpha = img[(Math.floor(y) * canvasW + Math.floor(x)) * 4 + 3];
      if (alpha > 120) points.push({ x, y });
    }
  }
  return points;
}

const ParticleManifesto = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = prefersReducedMotion();

    let particles: Particle[] = [];
    let lineIndex = 0;
    let phase: Phase = "drifting";
    let phaseStart = performance.now();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0; // CSS pixels

    // Timings (ms) — one calm, readable cycle.
    const T_GATHER = 1500;
    const T_HOLD = 4000;
    const T_SCATTER = 1300;
    const T_DRIFT = 550; // brief dust beat between scatter and the next gather

    const isMobile = () => w < 640;

    const setup = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildTargetsForCurrentLine(true);
    };

    // Build/rebuild the particle array's TARGET positions for `lineIndex`.
    // `reflow` = true means also snap origins (used on first load / resize).
    function buildTargetsForCurrentLine(reflow: boolean) {
      // A generous starting size that wrapToLines/shrink will bring down as
      // needed, plus a floor below which we wrap to 2 lines instead of
      // continuing to shrink — that floor is what keeps text legible once
      // it's turned into dots.
      const fontPx = isMobile() ? Math.round(Math.min(w * 0.1, 38)) : Math.round(Math.min(w * 0.058, 72));
      const floorPx = isMobile() ? 22 : 34;
      const pts = sampleTextPoints(LINES[lineIndex], w, h, fontPx, floorPx);

      // Cap particle count for perf; sample down evenly if oversized.
      const CAP = isMobile() ? 4200 : 5200;
      let sampled = pts;
      if (pts.length > CAP) {
        const strideN = Math.ceil(pts.length / CAP);
        sampled = pts.filter((_, i) => i % strideN === 0);
      }

      if (reflow || sampled.length !== particles.length) {
        // (Re)build the array fresh — origins scattered from the four
        // corners/edges so the first gather reads as "drifting in".
        particles = sampled.map((p) => {
          const edge = Math.floor(Math.random() * 4);
          const ox = edge === 0 ? -20 : edge === 1 ? w + 20 : Math.random() * w;
          const oy = edge === 2 ? -20 : edge === 3 ? h + 20 : Math.random() * h;
          return {
            x: ox, y: oy, ox, oy, tx: p.x, ty: p.y,
            vx: 0, vy: 0,
            size: 0.9 + Math.random() * 1.6,
            hue: Math.random() < 0.08 ? 1 : 0,
            baseAlpha: 0.55 + Math.random() * 0.45,
          };
        });
      } else {
        // Re-target existing particles to the new word (scatter → reform),
        // keeping their current on-screen position as the new origin so
        // the dissolve/reform reads continuous rather than a hard cut.
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.ox = p.x; p.oy = p.y;
          const t = sampled[i % sampled.length];
          p.tx = t.x; p.ty = t.y;
        }
      }
    }

    // Random "dust" scatter target — used during the "scattering"/"drifting"
    // phases so particles drift like motes in sunlight, not snap to a point.
    function scatterTarget(p: Particle) {
      const dx = (Math.random() - 0.5) * w * 0.5;
      const dy = (Math.random() - 0.5) * h * 0.4;
      p.ox = p.x; p.oy = p.y;
      p.tx = Math.min(w + 20, Math.max(-20, p.x + dx));
      p.ty = Math.min(h + 20, Math.max(-20, p.y + dy));
    }

    const onPointerMove = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current.x = clientX - rect.left;
      pointerRef.current.y = clientY - rect.top;
      pointerRef.current.active = true;
    };
    const onPointerLeave = () => { pointerRef.current.active = false; };

    const handleMouseMove = (e: MouseEvent) => onPointerMove(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) onPointerMove(t.clientX, t.clientY);
    };
    const handleTouchEnd = () => onPointerLeave();

    wrap.addEventListener("mousemove", handleMouseMove);
    wrap.addEventListener("mouseleave", onPointerLeave);
    wrap.addEventListener("touchmove", handleTouchMove, { passive: true });
    wrap.addEventListener("touchend", handleTouchEnd);

    setup();

    // ── Reduced motion: fade in once, hold the first line, done. ──────
    if (reduced) {
      let raf = 0;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 900);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#120C07";
        ctx.fillRect(0, 0, w, h);
        for (const pt of particles) {
          const x = pt.ox + (pt.tx - pt.ox) * p;
          const y = pt.oy + (pt.ty - pt.oy) * p;
          const c = pt.hue === 1 ? CREAM : GOLD;
          ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${pt.baseAlpha * p})`;
          ctx.beginPath();
          ctx.arc(x, y, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      const ro = new ResizeObserver(() => setup());
      ro.observe(wrap);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        wrap.removeEventListener("mousemove", handleMouseMove);
        wrap.removeEventListener("mouseleave", onPointerLeave);
        wrap.removeEventListener("touchmove", handleTouchMove);
        wrap.removeEventListener("touchend", handleTouchEnd);
      };
    }

    // ── Full animated cycle ────────────────────────────────────────────
    let raf = 0;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

    const advancePhase = (now: number) => {
      const elapsed = now - phaseStart;
      if (phase === "gathering" && elapsed > T_GATHER) {
        phase = "holding"; phaseStart = now;
      } else if (phase === "holding" && elapsed > T_HOLD) {
        phase = "scattering"; phaseStart = now;
        for (const p of particles) scatterTarget(p);
      } else if (phase === "scattering" && elapsed > T_SCATTER) {
        phase = "drifting"; phaseStart = now;
      } else if (phase === "drifting" && elapsed > T_DRIFT) {
        lineIndex = (lineIndex + 1) % LINES.length;
        buildTargetsForCurrentLine(false);
        phase = "gathering"; phaseStart = now;
      } else if (phase === "drifting" && elapsed <= T_DRIFT && particles.length === 0) {
        // safety: nothing sampled (e.g. font not yet loaded) — try again
        buildTargetsForCurrentLine(false);
      }
    };

    // Kick off the very first gather shortly after mount, so the section
    // doesn't feel frozen while the page settles in.
    const kickoff = window.setTimeout(() => {
      phase = "gathering"; phaseStart = performance.now();
    }, 450);

    const tick = (now: number) => {
      advancePhase(now);
      const elapsed = now - phaseStart;

      let eased = 1;
      if (phase === "gathering") eased = easeOutCubic(Math.min(1, elapsed / T_GATHER));
      else if (phase === "scattering") eased = easeInOutSine(Math.min(1, elapsed / T_SCATTER));
      else if (phase === "drifting") eased = 1;
      else if (phase === "holding") eased = 1;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#120C07";
      ctx.fillRect(0, 0, w, h);

      // Soft vignette so edges recede into black — keeps focus centred.
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");

      const pointer = pointerRef.current;
      const REPEL_R = isMobile() ? 55 : 80;
      const REPEL_R2 = REPEL_R * REPEL_R;

      for (const p of particles) {
        // Base interpolated position for this phase.
        let bx: number, by: number;
        if (phase === "holding") { bx = p.tx; by = p.ty; }
        else { bx = p.ox + (p.tx - p.ox) * eased; by = p.oy + (p.ty - p.oy) * eased; }

        // Gentle idle sway so even a "held" word feels alive, not frozen.
        const sway = phase === "holding" ? Math.sin(now / 900 + p.tx * 0.05) * 0.6 : 0;
        bx += sway;

        // Cursor/touch repel — a soft push away from the pointer, eased
        // back by spring-like interpolation toward the base position.
        let targetX = bx, targetY = by;
        if (pointer.active) {
          const dx = bx - pointer.x, dy = by - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < REPEL_R2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (1 - d / REPEL_R) * (isMobile() ? 26 : 34);
            targetX = bx + (dx / d) * push;
            targetY = by + (dy / d) * push;
          }
        }

        p.vx += (targetX - p.x) * 0.16;
        p.vy += (targetY - p.y) * 0.16;
        p.vx *= 0.72;
        p.vy *= 0.72;
        p.x += p.vx;
        p.y += p.vy;

        const c = p.hue === 1 ? CREAM : GOLD;
        const alpha = phase === "gathering" ? p.baseAlpha * (0.35 + 0.65 * eased)
          : phase === "scattering" ? p.baseAlpha * (1 - 0.7 * eased)
          : p.baseAlpha;
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${Math.max(0, alpha)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => setup());
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(kickoff);
      ro.disconnect();
      wrap.removeEventListener("mousemove", handleMouseMove);
      wrap.removeEventListener("mouseleave", onPointerLeave);
      wrap.removeEventListener("touchmove", handleTouchMove);
      wrap.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  return (
    <section className="relative w-full overflow-hidden bg-[#120C07]" aria-label="Our mission">
      <div
        ref={wrapRef}
        className="relative w-full h-[62vh] min-h-[360px] max-h-[620px] sm:h-[68vh] touch-none"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden="true" />

        {/* Screen-reader / no-JS fallback — the real mission text, present
            in the DOM even though the canvas paints over it visually. */}
        <p className="sr-only">
          {LINES.join(" ")}
        </p>

        {/* Quiet caption beneath the particle field — no eyebrow label,
            just a small on-brand signature so the moment stays wordless. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 sm:bottom-7 flex justify-center">
          <span className="text-[10px] sm:text-[11px] tracking-[0.3em] text-[#F7B145]/60 font-medium">
            GHS BABI KHEL
          </span>
        </div>
      </div>
    </section>
  );
};

export default ParticleManifesto;
