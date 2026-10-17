import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Wind } from "lucide-react";

/**
 * 🪁 The Kite on 404 — A Guddi You Can Fly
 *
 * A black-paper guddi (Peshawar kite) drifts across a pale sky. Its string
 * is attached to the visitor's cursor — or finger, on touch screens — and
 * the kite reacts with real spring physics: it dips, soars, banks into
 * turns, and drags a hand-tied tail behind it. Leave it alone and it flies
 * itself on a gentle wind. Pull hard and it tugs back.
 *
 * Engineering notes:
 *   • ONE requestAnimationFrame loop, one transparent canvas, zero DOM
 *     writes per frame (everything is drawn) — cheap enough for low-end
 *     Android phones in Babi Khel.
 *   • Pointer input is captured with passive window listeners — the page
 *     still scrolls normally, nothing is ever blocked (canvas is
 *     pointer-events:none, content above stays fully clickable).
 *   • Tail is an 11-node verlet chain with 2 constraint passes — the same
 *     trick games use for rope, ~15 lines of math.
 *   • Hidden counter: after 30 seconds of flight a quiet message offers
 *     the way home. Shown once per visit, non-intrusive.
 *   • prefers-reduced-motion: wind, wobble and autopilot are damped to a
 *     near-still hover; the kite still follows the hand gently.
 *   • The loop pauses when the tab is hidden and fully cleans up on unmount.
 */

interface Vec { x: number; y: number; }

const TAIL_NODES = 11;
const TAIL_SEG = 13;          // px between tail nodes
const SPRING = 0.02;          // pull toward the hand
const DAMPING = 0.06;         // air drag per frame
const HOVER_ABOVE_HAND = 175; // the kite floats this far above the string hand
const IDLE_TIMEOUT = 2500;    // ms without a hand → autopilot wind takes over
const HOME_HINT_AFTER = 30_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const FlyingKite = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showHomeHint, setShowHomeHint] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  const dismissHint = useCallback(() => setHintDismissed(true), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── state ─────────────────────────────────────────────────────────
    let w = 0, h = 0, dpr = 1;
    const kite: Vec = { x: 0, y: 0 };
    const vel: Vec = { x: 0, y: 0 };
    // tail: verlet chain — pos + previous pos per node
    const tailPos: Vec[] = Array.from({ length: TAIL_NODES }, () => ({ x: 0, y: 0 }));
    const tailPrev: Vec[] = Array.from({ length: TAIL_NODES }, () => ({ x: 0, y: 0 }));

    let rect = canvas.getBoundingClientRect();
    const hand = { x: 0, y: 0, active: false, lastSeen: 0 };

    const updateRect = () => { rect = canvas.getBoundingClientRect(); };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateRect();
      if (kite.x === 0 && kite.y === 0) {
        // first placement — upper sky, so it doesn't spawn under the text
        kite.x = w * 0.68; kite.y = h * 0.30;
        tailPos.forEach((p) => { p.x = kite.x; p.y = kite.y; });
        tailPrev.forEach((p) => { p.x = kite.x; p.y = kite.y; });
      }
    };
    resize();

    // ── pointer input (passive — never blocks scrolling or clicks) ────
    const noteHand = (cx: number, cy: number) => {
      hand.x = cx; hand.y = cy;
      hand.active = true;
      hand.lastSeen = performance.now();
    };
    const onPointerMove = (e: PointerEvent) => noteHand(e.clientX, e.clientY);
    const onPointerDown = (e: PointerEvent) => noteHand(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) noteHand(t.clientX, t.clientY);
    };
    const onHandGone = () => { hand.active = false; };
    const onScroll = () => updateRect();

    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("mouseout", onHandGone);

    // ── helpers ───────────────────────────────────────────────────────
    const toLocal = (cx: number, cy: number): Vec => ({ x: cx - rect.left, y: cy - rect.top });

    let raf = 0;
    let last = performance.now();
    let running = true;

    const frame = (now: number) => {
      const dt = clamp(now - last, 4, 50);
      last = now;
      const f = dt / 16.666;                       // 60fps normaliser
      const windScale = reduced ? 0.12 : 1;

      // autopilot: a slow figure-of-eight on the wind when no hand is near
      const idle = !hand.active || now - hand.lastSeen > IDLE_TIMEOUT;
      let tx: number, ty: number;
      if (idle) {
        tx = w * 0.5 + Math.sin(now * 0.00045) * w * 0.23;
        ty = h * 0.30 + Math.sin(now * 0.00092 + 1.3) * h * 0.085;
      } else {
        const p = toLocal(hand.x, hand.y);
        tx = p.x;
        ty = p.y - HOVER_ABOVE_HAND;
      }
      // keep the kite inside the sky
      tx = clamp(tx, 60, Math.max(60, w - 60));
      ty = clamp(ty, 46, Math.max(46, h * 0.72));

      // spring + wind + drag
      const wind = (Math.sin(now * 0.00042) * 16 + Math.sin(now * 0.00131 + 1.7) * 7) * windScale;
      vel.x += ((tx - kite.x) * SPRING + wind * 0.05) * f;
      vel.y += (ty - kite.y) * SPRING * f;
      const drag = Math.pow(1 - (reduced ? DAMPING * 1.8 : DAMPING), f);
      vel.x *= drag; vel.y *= drag;
      kite.x += vel.x * f;
      kite.y += vel.y * f;

      // verlet tail: gravity + breeze, then 2 constraint passes
      // kite orientation + geometry — needed by the tail BEFORE drawing
      const s = clamp(Math.min(w, h) / 560, 0.72, 1);
      const HH = 52 * s;
      const angle = clamp(vel.x * 0.0038, -0.5, 0.5) + Math.sin(now * 0.0011) * 0.06 * windScale;
      // tail hangs from the kite's ROTATED tail vertex, not its centre
      const tailBase = {
        x: kite.x - HH * Math.sin(angle),
        y: kite.y + HH * Math.cos(angle),
      };
      const head = tailPos[0];
      head.x = tailBase.x; head.y = tailBase.y;
      const seg = TAIL_SEG * clamp(Math.min(w, h) / 560, 0.7, 1);
      for (let i = 1; i < TAIL_NODES; i++) {
        const p = tailPos[i], prev = tailPrev[i];
        const vx = (p.x - prev.x) * 0.94;
        const vy = (p.y - prev.y) * 0.94;
        prev.x = p.x; prev.y = p.y;
        p.x += vx * f + Math.sin(now * 0.003 + i * 0.9) * 0.5 * windScale * f;
        p.y += vy * f + 0.42 * f;                  // gravity
      }
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < TAIL_NODES; i++) {
          const a = tailPos[i - 1], b = tailPos[i];
          const dx2 = b.x - a.x, dy2 = b.y - a.y;
          const d = Math.hypot(dx2, dy2) || 1;
          const diff = (d - seg) / d;
          if (i === 1) { b.x -= dx2 * diff; b.y -= dy2 * diff; }
          else {
            a.x += dx2 * diff * 0.25; a.y += dy2 * diff * 0.25;
            b.x -= dx2 * diff * 0.75; b.y -= dy2 * diff * 0.75;
          }
        }
      }

      // ── draw ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, w, h);
      const handLocal = idle
        ? { x: w * 0.5, y: h - 12 }                 // tethered to the page itself
        : toLocal(hand.x, hand.y);

      // string — a slack line that straightens when you pull;
      // it leaves the kite at the rotated bridle point
      const bridle = { x: kite.x - HH * 0.22 * Math.sin(angle), y: kite.y + HH * 0.22 * Math.cos(angle) };
      const dxs = handLocal.x - bridle.x, dys = handLocal.y - bridle.y;
      const dist = Math.hypot(dxs, dys);
      const sag = clamp(1 - dist / 640, 0.06, 0.6) * dist * 0.24;
      ctx.beginPath();
      ctx.moveTo(bridle.x, bridle.y);
      ctx.quadraticCurveTo((bridle.x + handLocal.x) / 2, (bridle.y + handLocal.y) / 2 + sag, handLocal.x, handLocal.y);
      ctx.strokeStyle = "rgba(72, 52, 30, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // tail — smooth tapering curve
      ctx.beginPath();
      ctx.moveTo(tailPos[0].x, tailPos[0].y);
      for (let i = 1; i < TAIL_NODES - 1; i++) {
        const mx = (tailPos[i].x + tailPos[i + 1].x) / 2;
        const my = (tailPos[i].y + tailPos[i + 1].y) / 2;
        ctx.quadraticCurveTo(tailPos[i].x, tailPos[i].y, mx, my);
      }
      ctx.strokeStyle = "rgba(244, 232, 208, 0.85)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // bows on the tail (crimson + gold, like a real guddi)
      const bow = (n: number, fill: string) => {
        const p = tailPos[n];
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = fill;
        ctx.fillRect(-4.4, -4.4, 8.8, 8.8);
        ctx.restore();
      };
      bow(3, "rgba(163, 59, 46, 0.9)");
      bow(7, "rgba(214, 168, 74, 0.9)");

      // kite — a black paper guddi with bamboo spars
      const HW = 40 * s, WIDEN = 0.78;
      ctx.save();
      ctx.translate(kite.x, kite.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -HH); ctx.lineTo(HW * WIDEN, 0); ctx.lineTo(0, HH); ctx.lineTo(-HW * WIDEN, 0);
      ctx.closePath();
      const body = ctx.createLinearGradient(-HW, -HH, HW, HH);
      body.addColorStop(0, "#2b2118");
      body.addColorStop(0.55, "#1b140d");
      body.addColorStop(1, "#100b07");
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 240, 214, 0.35)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // bamboo spars (vertical spine + curved cross spar)
      ctx.strokeStyle = "rgba(226, 178, 88, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -HH); ctx.lineTo(0, HH); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-HW * WIDEN, 0);
      ctx.quadraticCurveTo(0, -HH * 0.16, HW * WIDEN, 0);
      ctx.stroke();
      // crimson corner patch
      ctx.beginPath();
      ctx.moveTo(0, -HH); ctx.lineTo(HW * WIDEN, 0); ctx.lineTo(0, -HH * 0.30);
      ctx.closePath();
      ctx.fillStyle = "rgba(163, 59, 46, 0.78)";
      ctx.fill();
      // bridle
      ctx.strokeStyle = "rgba(72, 52, 30, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -HH); ctx.lineTo(0, HH * 0.22);
      ctx.moveTo(-HW * WIDEN, 0); ctx.lineTo(0, HH * 0.22);
      ctx.moveTo(HW * WIDEN, 0); ctx.lineTo(0, HH * 0.22);
      ctx.stroke();
      ctx.restore();

      if (running) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // hidden counter — 30 seconds of flight, then a gentle way home
    const hintTimer = window.setTimeout(() => setShowHomeHint(true), HOME_HINT_AFTER);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(hintTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseout", onHandGone);
    };
  }, []);

  return (
    <>
      {/* the sky is a playfield, never a blocker — content above stays clickable */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />

      {/* the 30-second whisper — a way home, only if you've stayed a while */}
      <AnimatePresence>
        {showHomeHint && !hintDismissed && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4"
            role="status"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl border border-border/70 bg-card/90 px-5 py-3 text-center shadow-elevated">
              <p className="text-sm text-muted-foreground">
                You've been here a while. Want to go home?
              </p>
              <Link
                to="/"
                className="inline-flex items-center gap-2 rounded-xl gradient-accent px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-card transition-all hover:shadow-elevated"
              >
                <Home className="h-3.5 w-3.5" />
                Fly home
              </Link>
              <button
                onClick={dismissHint}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Keep flying
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* quiet invitation to play */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">
          <Wind className="h-3 w-3" />
          Drag anywhere — the guddi follows your hand
        </span>
      </div>
    </>
  );
};

export default FlyingKite;
