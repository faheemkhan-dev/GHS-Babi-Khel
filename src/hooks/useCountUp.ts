import { useEffect, useRef, useState } from "react";

/**
 * SEO/prerender-safe count-up.
 *
 * ⚠ WHY THIS EXISTS (2026-08 crawler fix):
 * The counter previously started at 0 and only began counting when the
 * element scrolled into view. During build-time prerendering (headless
 * Chromium) the element is below the fold, the IntersectionObserver never
 * fires, and the saved HTML permanently contains "0+" — which is exactly the
 * misleading "0+" statistic AI crawlers reported reading on the homepage and
 * about page.
 *
 * FIX: the FINAL value renders on the first paint (so any prerendered HTML,
 * server render or no-JavaScript reader sees the real number). When the
 * element scrolls into view for a human, the number resets to 0 and plays
 * the count-up animation exactly as before.
 */
export function useCountUp(end: number, duration = 2000) {
  // Start at the final value — the real number must be in the initial HTML.
  const [count, setCount] = useState(end);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the displayed value in sync when the target changes (e.g. school
  // settings load after first paint).
  useEffect(() => {
    if (!started) setCount(end);
  }, [end, started]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    let frame: number;
    // Reset to 0 and animate up — visible only to the human who just
    // scrolled the element into view.
    setCount(0);
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * end));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [started, end, duration]);

  return { count, ref };
}
