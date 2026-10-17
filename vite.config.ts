import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { plausiblePlugin } from "./vite-plugin-plausible";

// ── Build-time prerender hook (crawler-readability fix) ─────────────────────
// Runs the full prerender pipeline (Chromium render of every public route +
// guaranteed static fallback content) inside the Vite build itself, in the
// closeBundle phase (after all files are written to dist/).
//
// WHY IN VITE AND NOT IN package.json's "build" SCRIPT:
// Vercel's Vite framework preset runs `vite build` DIRECTLY — it never calls
// `npm run build` — so a prerender step attached only to the npm script is
// silently skipped on every deployment, and the live site serves the empty
// SPA shell to AI/search crawlers. Hooking into closeBundle guarantees the
// prerendered pages exist no matter which command/CI performs the build.
async function prerenderPlugin() {
  return {
    name: "ghs-prerender",
    apply: "build" as const,
    closeBundle: async () => {
      if (process.env.GHS_SKIP_PRERENDER === "1") return;
      try {
        // NOTE: import by runtime-computed absolute URL — Vite bundles the
        // config into a temp directory, so a static relative import would
        // resolve inside that temp dir. The absolute path always resolves to
        // the real scripts/prerender-lib.mjs on disk.
        const { pathToFileURL } = await import("node:url");
        const libUrl = pathToFileURL(path.resolve(process.cwd(), "scripts/prerender-lib.mjs")).href;
        const { runPrerender } = await import(/* @vite-ignore */ libUrl);
        await runPrerender("vite");
      } catch (e) {
        // Never fail the build — the site still deploys as a normal SPA.
        console.warn(`Prerender hook failed (${e?.message || e}) — build continues.`);
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [
    react(),
    plausiblePlugin(),
    prerenderPlugin(),
    // ✅ VitePWA completely removed — the Service Worker was causing
    // pages to hang on refresh by serving stale/broken cached JS chunks.
  ].filter(Boolean),

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },

  // PERF: esbuild tweaks
  // - legalComments: 'none' strips license comment blocks from minified
  //   output (smaller bytes on the wire; the licenses themselves remain
  //   in node_modules and in the source tree, so compliance is preserved).
  esbuild: {
    legalComments: "none",
  },

  // PERF: skip the modulepreload polyfill (~0.7 KB). Every browser that
  // supports ES2020 modules also supports <link rel="modulepreload">
  // natively, so the polyfill is dead weight. The build target is already
  // es2020, so this is safe.
  modulePreload: { polyfill: false },

  build: {
    target: "es2020",
    minify: "esbuild",
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
    // PERF: reportCompressedSize=false skips the gzip-size report during
    // build (saves several seconds of build time, no runtime impact).
    reportCompressedSize: false,
    // PERF: chunkSizeWarningLimit raised slightly so the dev console
    // doesn't drown in warnings for vendor chunks that are intentionally
    // split (and are themselves lazy-loaded on demand).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":    ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-query":    ["@tanstack/react-query"],
          "vendor-motion":   ["framer-motion"],
          "vendor-ui":       ["lucide-react", "react-hot-toast"],
          "vendor-utils":    ["date-fns", "clsx", "tailwind-merge"],
          "vendor-xlsx":     ["xlsx"],
          // PROBLEM 6 FIX: "vendor-pdf" (jspdf + jspdf-autotable, ~142 KB
          // compressed) REMOVED from manualChunks. Forcing it into a named
          // chunk made Rollup place a tiny shared helper inside it, which the
          // ENTRY chunk then statically imported — so every visitor
          // (including the homepage) modulepreloaded the whole PDF library
          // before seeing anything. Without the manual entry, Rollup keeps
          // jspdf inside the on-demand lazy-route graph (Results, dashboard,
          // admin tabs) — it only downloads when a user actually opens a
          // page that offers PDF export.
          "vendor-charts":   ["recharts"],
          // PERF FIX: "vendor-three" removed — no source file imports three
          // (the 3D Hall was deleted earlier), so this entry produced an
          // EMPTY chunk on every build plus a build warning.
        },
        chunkFileNames:  "assets/[name]-[hash].js",
        entryFileNames:  "assets/[name]-[hash].js",
        assetFileNames:  "assets/[name]-[hash].[ext]",
      },
    },
    sourcemap: mode === "development",
  },
}));
