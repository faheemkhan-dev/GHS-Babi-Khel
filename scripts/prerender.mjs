#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/prerender.mjs — CLI entry for the build-time prerender pipeline.
//
// The actual logic lives in scripts/prerender-lib.mjs and is invoked from BOTH:
//   • the Vite `closeBundle` hook (vite.config.ts) — this is what guarantees
//     prerendering happens on Vercel, whose Vite framework preset runs
//     `vite build` directly and NEVER executes `npm run build`; and
//   • this CLI script (npm run prerender / manual runs).
//
// The lib writes dist/.ghs-prerender-done, so when `npm run build`
// (vite build && node scripts/prerender.mjs) triggers both paths, the second
// one is a no-op instead of rendering everything twice.
//
// Manual usage:  node scripts/prerender.mjs        (after vite build)
// Skip Chromium: PRERENDER=false node scripts/prerender.mjs
// Skip fallback: SEO_FALLBACK=false node scripts/prerender.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { runPrerender } from "./prerender-lib.mjs";

runPrerender("cli").catch((e) => {
  // Never fail the build — worst case the site deploys as a normal SPA.
  console.warn(`Prerender SKIPPED (${e.message}). The site deploys as a normal client-rendered SPA.`);
});
