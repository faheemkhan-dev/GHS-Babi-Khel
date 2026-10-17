// ─────────────────────────────────────────────────────────────────────────────
// scripts/prerender-lib.mjs — Shared build-time prerender core
//
// WHY THIS MODULE EXISTS
// ─────────────────────────────────────────────────────────────────────────────
// The site is a client-rendered React SPA. Without prerendering, every
// no-JavaScript reader (GPTBot/ChatGPT, ClaudeBot, PerplexityBot, Gemini,
// Meta AI, older Bingbot, social link previews…) receives a ~3.3 KB empty
// shell with ~60 readable characters — the "discoverable but unreadable"
// crawlability problem.
//
// THE DEPLOYMENT BUG THIS FIXES
// ─────────────────────────────────────────────────────────────────────────────
// Previously prerendering only ran when the build command was exactly
// `npm run build` (vite build && node scripts/prerender.mjs). Vercel's Vite
// framework preset runs `vite build` DIRECTLY — so the deployed site had NO
// prerendered pages at all, and every crawler got the empty shell.
//
// The prerender step is therefore now invoked from a Vite `closeBundle` hook
// (see vite.config.ts), so it runs with ANY build command, from any CI, on
// any machine. scripts/prerender.mjs remains as a manual CLI entry point.
//
// WHAT runPrerender() DOES (never fails the build)
// ─────────────────────────────────────────────────────────────────────────────
//   1. writeAssetManifestAndPatchSW() — PWA offline manifest + per-build SW
//      version stamp. Runs on EVERY call, before anything else.
//   2. Chromium phase — renders every public route (plus latest notices
//      detail pages) with headless Chromium and writes dist/<route>/index.html
//      with the FULL rendered DOM. Skipped when PRERENDER=false.
//   3. Static fallback phase — for any public route the Chromium phase did
//      not produce a full page (browser missing, render failure, …), writes a
//      guaranteed crawler-readable page from scripts/seo-page-content.mjs:
//      per-route <title>/meta/JSON-LD + real school content + internal links.
//      Skipped only when SEO_FALLBACK=false.
//   4. Writes dist/.ghs-prerender-done marker so the CLI wrapper never runs
//      the pipeline twice for the same dist.
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  SITE_URL,
  NAV_LINKS,
  getPageMeta,
  registerExtraPage,
  buildFallbackHtml,
} from "./seo-page-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// dist/ is normally next to the project root (this file lives in scripts/).
// The cwd fallback covers exotic invocations where the script is copied or
// bundled elsewhere — e.g. Vite bundles vite.config.ts into a temp dir, and
// if this module ever ends up inside such a bundle, __dirname would point to
// the temp location while the build's cwd is still the project root.
function resolveDist() {
  const primary = path.resolve(__dirname, "..", "dist");
  if (existsSync(primary)) return primary;
  const secondary = path.resolve(process.cwd(), "dist");
  if (existsSync(secondary)) return secondary;
  return primary;
}
const DIST = resolveDist();
const PORT = Number(process.env.PRERENDER_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = Number(process.env.PRERENDER_SETTLE_MS || 1800);
const DETAIL_LIMIT = Number(process.env.PRERENDER_DETAIL_LIMIT || 20);
const PAGE_TIMEOUT_MS = 45000;
// The bare SPA shell is ~3.3 KB. Any prerendered page must be far larger than
// this to count as "real content" — otherwise the static fallback takes over.
const MIN_VALID_HTML_BYTES = 8 * 1024;
const MARKER = path.join(DIST, ".ghs-prerender-done");

// ── Public routes (mirrors App.tsx public routes + sitemap) ─────────────────
// CRITICAL: every route here gets a prerendered /<route>/index.html on every
// build. The vercel.json rewrites then serve that file as the FALLBACK when
// the middleware's live-render hop times out or fails (cold start, Supabase
// hiccup, BISEP slow). Without a prerendered fallback, the request falls
// through to the SPA shell /index.html — which carries the HOMEPAGE title —
// so Googlebot sees /roll-no-slip returning 200 with the same content as /,
// reads it as a duplicate/soft-404 and refuses to index it. This was the
// actual root cause of the Search Console "errors" on /roll-no-slip. Adding
// the route here (and the matching rewrite in vercel.json) guarantees the
// crawler always sees route-correct HTML even when live-render fails.
export const STATIC_ROUTES = [
  "/",
  "/about",
  "/contact",
  "/admission",
  "/notices",
  "/results",
  "/merit-list",
  "/roll-no-slip",   // ← was missing — root cause of Googlebot index failures
  "/result-card",
  "/teachers",
  "/gallery",
  "/library",
  "/duty",
  "/notes",
  "/notes/math",
  "/notes/physics",
  "/notes/chemistry",
  "/notes/biology",
  "/notes/english",
  "/notes/urdu",
  "/notes/islamiat",
  "/notes/pakistan-studies",
  "/notes/computer",
  "/faq",
];

// ── MIME types for the local static server ──────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Local static server with SPA fallback (for the Chromium phase) ──────────
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", BASE);
      let pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith("/api/")) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not found (prerender local server)" }));
        return;
      }

      if (pathname.length > 1 && pathname.endsWith("/")) {
        pathname = pathname.slice(0, -1);
      }

      let abs = path.join(DIST, path.posix.normalize(pathname || "/"));
      if (!abs.startsWith(DIST)) abs = path.join(DIST, "index.html");

      let filePath = null;
      try {
        const st = await stat(abs);
        if (st.isFile()) filePath = abs;
        else if (st.isDirectory()) {
          const idx = path.join(abs, "index.html");
          if (existsSync(idx)) filePath = idx;
        }
      } catch {
        /* not found — fall through */
      }
      if (!filePath) filePath = path.join(DIST, "index.html");

      const ext = path.extname(filePath).toLowerCase();
      const body = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
    } catch {
      res.statusCode = 500;
      res.end("prerender server error");
    }
  });

  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

// ── Supabase REST helpers (public anon key, published rows only) ────────────
function supabaseEnv() {
  return {
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_ANON_KEY,
  };
}

async function fetchIds(table, limit) {
  const { url, key } = supabaseEnv();
  if (!url || !key) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(
      `${url}/rest/v1/${table}?select=id&is_published=eq.true&order=created_at.desc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => r.id).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Latest published items for the static fallback lists. Returns
 * { notices, library, gallery, notes, stats } — empty values when the
 * env vars are missing or a fetch fails (fallback stays fully functional).
 *
 * EXTENDED (2026-08): previously only notices were injected at build
 * time, so the STATIC fallback pages for /library, /gallery and /notes were
 * almost content-free for any crawler that does not receive the live render
 * (weak AI tools with browser-like user-agents, offline archives, …). Now
 * the build-time snapshot carries the same public data the live renderer
 * serves: library files, gallery albums, note subjects with chapter counts
 * and the school's real statistics.
 */
async function fetchLatestLists(limit = 10) {
  const { url, key } = supabaseEnv();
  const out = {
    notices: [],
    library: [],
    gallery: [],
    notes: [],
    chapters: [],
    admissionFiles: [],
    stats: null,
    subjectSlugs: [],
  };
  if (!url || !key) return out;

  const withTimeout = async (label, run) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await run(controller.signal);
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      console.warn(`[prerender] ${label} fetch failed — static fallback continues without it.`);
      return null;
    }
  };
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const grab = (table) =>
    withTimeout(table, (signal) =>
      fetch(
        `${url}/rest/v1/${table}?select=id,title,created_at&is_published=eq.true&order=created_at.desc&limit=${limit}`,
        { headers, signal }
      )
    );

  const [notices, libraryRows, galleryRows, subjectRows, chapterRows, settingsRow, admissionFileRows] =
    await Promise.all([
      grab("notices"),
      withTimeout("library_files", (signal) =>
        fetch(
          `${url}/rest/v1/library_files?select=id,title,category,class,file_url,created_at&order=created_at.desc&limit=12`,
          { headers, signal }
        )
      ),
      withTimeout("gallery_albums", (signal) =>
        fetch(
          `${url}/rest/v1/gallery_albums?select=id,title,description,cover_url,created_at&order=created_at.desc&limit=10`,
          { headers, signal }
        )
      ),
      withTimeout("note_subjects", (signal) =>
        fetch(
          `${url}/rest/v1/note_subjects?select=id,name,slug,description,class_level&is_visible=eq.true&order=display_order`,
          { headers, signal }
        )
      ),
      withTimeout("note_chapters", (signal) =>
        fetch(
          `${url}/rest/v1/note_chapters?select=id,subject_id,title,slug,chapter_number,is_published&is_published=eq.true&order=chapter_number&limit=300`,
          { headers, signal }
        )
      ),
      withTimeout("school_settings", (signal) =>
        fetch(
          `${url}/rest/v1/school_settings?select=total_students,total_teachers,pass_percentage,established_year&id=eq.1`,
          { headers, signal }
        )
      ),
      // Admin-uploaded admission documents (prospectus, fee structure, …).
      // Baked into the static /admission page so even browser-UA AI tools
      // that never receive the live render see the real form URLs.
      withTimeout("library_files:admission", (signal) =>
        fetch(
          `${url}/rest/v1/library_files?select=id,title,description,file_url,file_type,created_at&category=ilike.Admission&order=created_at.desc&limit=20`,
          { headers, signal }
        )
      ),
    ]);

  out.notices = Array.isArray(notices) ? notices.filter((r) => r && r.id && r.title) : [];
  out.library = Array.isArray(libraryRows) ? libraryRows.filter((r) => r && r.title) : [];
  out.admissionFiles = Array.isArray(admissionFileRows)
    ? admissionFileRows.filter((r) => r && r.title && r.file_url)
    : [];

  if (Array.isArray(galleryRows) && galleryRows.length) {
    // Photo counts per album (single lightweight query).
    const photoRows = await withTimeout("gallery_photos", (signal) =>
      fetch(
        `${url}/rest/v1/gallery_photos?select=id,album_id&limit=200`,
        { headers, signal }
      )
    );
    const counts = new Map();
    for (const p of Array.isArray(photoRows) ? photoRows : []) {
      if (p && p.album_id) counts.set(p.album_id, (counts.get(p.album_id) || 0) + 1);
    }
    out.gallery = galleryRows.map((a) => ({
      ...a,
      photo_count: counts.get(a.id) || 0,
    }));
  }

  if (Array.isArray(subjectRows) && subjectRows.length) {
    const chapters = Array.isArray(chapterRows) ? chapterRows : [];
    const bySubject = new Map();
    for (const c of chapters) {
      if (c && c.subject_id) bySubject.set(c.subject_id, (bySubject.get(c.subject_id) || 0) + 1);
    }
    out.notes = subjectRows
      .filter((s) => s && s.slug)
      .map((s) => ({ ...s, chapter_count: bySubject.get(s.id) || 0 }));
    out.subjectSlugs = out.notes.map((s) => s.slug);
    // Full chapter rows (title + slug) for the per-subject fallback pages.
    out.chapters = chapters.filter((c) => c && c.subject_id && c.slug && c.title);
  } else {
    out.chapters = [];
  }

  if (Array.isArray(settingsRow) && settingsRow[0]) {
    const s = settingsRow[0];
    out.stats = {
      total_students: typeof s.total_students === "number" ? s.total_students : null,
      total_teachers: typeof s.total_teachers === "number" ? s.total_teachers : null,
      pass_percentage: typeof s.pass_percentage === "number" ? s.pass_percentage : null,
      established_year: typeof s.established_year === "number" ? s.established_year : null,
    };
  }
  return out;
}

// ── PWA offline: asset manifest + service-worker version stamp ──────────────
// Runs on EVERY build (before any skip check — the manifest and the SW stamp
// are required even when prerendering itself is disabled):
//   1. Writes dist/asset-manifest.json — public/sw.js precaches every file in
//      it at install time, which is what makes ALL pages work offline.
//   2. Stamps a unique CACHE_VERSION into dist/sw.js so every deploy ships a
//      byte-different worker → browsers reinstall → fresh precache of the new
//      hashed files.
async function writeAssetManifestAndPatchSW() {
  try {
    const assetsDir = path.join(DIST, "assets");
    if (!existsSync(assetsDir)) {
      console.warn("PWA offline: dist/assets not found — skipping asset manifest.");
      return;
    }
    const entries = await readdir(assetsDir);
    const files = entries
      .filter((f) => /\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|svg|avif|gif|ico|json|wasm)$/i.test(f))
      .map((f) => `/assets/${f}`)
      .sort();

    const manifest = { builtAt: new Date().toISOString(), count: files.length, files };
    await writeFile(path.join(DIST, "asset-manifest.json"), JSON.stringify(manifest), "utf8");

    const swPath = path.join(DIST, "sw.js");
    if (existsSync(swPath)) {
      const stamp = `ghs-${Date.now().toString(36)}`;
      let swSource = await readFile(swPath, "utf8");
      if (/const CACHE_VERSION = "[^"]*";/.test(swSource)) {
        swSource = swSource.replace(
          /const CACHE_VERSION = "[^"]*";/,
          `const CACHE_VERSION = "${stamp}";`
        );
        await writeFile(swPath, swSource, "utf8");
      }
    }

    console.log(
      `Prerender: asset-manifest.json written (${files.length} assets), sw.js version stamped.`
    );
  } catch (e) {
    console.warn(`PWA offline: skipped (${e.message}) — build continues.`);
  }
}

// ── Chromium launcher with auto-install fallback ────────────────────────────
async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    ({ chromium } = await import("playwright-core"));
  }

  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  try {
    return await chromium.launch({ args });
  } catch (launchErr) {
    console.warn("Prerender: Chromium not installed — downloading (one-time)…");
    const install = spawnSync("npx playwright install chromium", {
      shell: true,
      stdio: "inherit",
      timeout: 300000,
    });
    if (install.status !== 0) throw launchErr;
    return await chromium.launch({ args });
  }
}

// ── Render one route to a static HTML file ──────────────────────────────────
async function renderPage(context, route, outPath, originalPreloads) {
  const page = await context.newPage();
  try {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT_MS });
    } catch {
      try {
        await page.goto(BASE + route, { waitUntil: "load", timeout: 30000 });
      } catch {
        /* page may still be usable — try to continue */
      }
    }

    await page.waitForSelector("footer", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    // Strip runtime-added modulepreload/prefetch links (the idle route
    // prefetcher injects 50+ chunks incl. exceljs ~938 KB — catastrophic on
    // 3G if baked into every saved page). Keep only the shell's originals.
    await page.evaluate((keepSet) => {
      const keep = new Set(keepSet);
      document
        .querySelectorAll('link[rel="modulepreload"], link[rel="prefetch"]')
        .forEach((link) => {
          const href = (link.getAttribute("href") || "").split("?")[0];
          if (!keep.has(href)) link.remove();
        });
      document.querySelectorAll('link[rel="preload"][as="script"]').forEach((link) => {
        const href = (link.getAttribute("href") || "").split("?")[0];
        if (href.startsWith("/assets/") || href.includes("/assets/")) {
          if (!keep.has(href)) link.remove();
        }
      });
    }, originalPreloads);

    const html = await page.content();
    if (!html || html.length < MIN_VALID_HTML_BYTES)
      throw new Error("rendered HTML too small — skipping");

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");
    return html.length;
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Static fallback filler ───────────────────────────────────────────────────
/**
 * Fill dynamic lists inside a fallback page with build-time public data.
 * Handles:
 *   • <ul data-ghs-list="notices"></ul>   — latest published items
 *   • <ul data-ghs-list="library"></ul>        — latest library downloads
 *   • <ul data-ghs-list="gallery"></ul>        — photo albums with counts
 *   • <ul data-ghs-list="notes"></ul>          — note subjects + chapters
 *   • <ul data-ghs-stats></ul>                 — real school statistics
 * Each list's "empty" paragraph is removed when real items exist (or the
 * marker is removed when the list is empty).
 */
function makeListFiller(lists) {
  const subjectsBySlug = new Map(
    ((lists && lists.notes) || []).map((s) => [s.slug, s])
  );
  return (html) => {
    // Per-subject chapter lists: <ul data-ghs-list="chapters-<subject-slug>"></ul>
    const chapterMarkers = [...html.matchAll(/<ul data-ghs-list="chapters-([^"]+)"><\/ul>/g)];
    for (const m of chapterMarkers) {
      const slug = m[1];
      const subject = subjectsBySlug.get(slug);
      const chapters = ((lists && lists.chapters) || []).filter(
        (c) => subject && c.subject_id === subject.id
      );
      if (chapters.length) {
        const lis = chapters
          .map(
            (c) =>
              `<li><a href="/notes/${esc(slug)}/${esc(c.slug)}">${esc(c.title)}</a></li>`
          )
          .join("");
        html = html.replace(
          new RegExp(`<ul data-ghs-list="chapters-${slug}"></ul>`),
          `<ul>${lis}</ul>`
        );
      } else {
        html = html.replace(new RegExp(`<ul data-ghs-list="chapters-${slug}"></ul>`), "");
      }
      html = html.replace(
        new RegExp(`\\s*<p data-ghs-empty="chapters-${slug}">[\\s\\S]*?</p>`),
        ""
      );
    }

    for (const source of ["notices", "library", "gallery", "notes", "admission-files"]) {
      const items = source === "admission-files" ? (lists && lists.admissionFiles) || [] : (lists && lists[source]) || [];
      const ulRe = new RegExp(`<ul data-ghs-list="${source}"></ul>`);
      const pRe = new RegExp(`\\s*<p data-ghs-empty="${source}">[\\s\\S]*?</p>`);
      if (items.length > 0) {
        let lis = "";
        if (source === "notices") {
          lis = items
            .map((it) => {
              const date = it.created_at ? new Date(it.created_at) : null;
              const nice = date && !isNaN(date.getTime())
                ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                : "";
              const label = nice ? `${esc(it.title)} — ${nice}` : esc(it.title);
              return `<li><a href="/${source}/${esc(it.id)}">${label}</a></li>`;
            })
            .join("");
        } else if (source === "library") {
          lis = items
            .map((f) => {
              const bits = [];
              if (f.category) bits.push(esc(f.category));
              if (f.class && f.class !== "All") bits.push(`Class ${esc(f.class)}`);
              const meta = bits.length ? ` (${bits.join(" · ")})` : "";
              const href = f.file_url || "/library";
              return `<li><a href="${esc(href)}">${esc(f.title)}</a>${meta}</li>`;
            })
            .join("");
        } else if (source === "admission-files") {
          // Direct download links to the admin-uploaded admission documents.
          lis = items
            .map((f) => {
              const meta = f.file_type ? ` — ${esc(f.file_type)}` : "";
              return `<li><a href="${esc(f.file_url)}">${esc(f.title)}</a>${meta}</li>`;
            })
            .join("");
        } else if (source === "gallery") {
          lis = items
            .map((a) => {
              const date = a.created_at ? new Date(a.created_at) : null;
              const nice = date && !isNaN(date.getTime())
                ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
                : "";
              const desc = a.description ? ` — ${esc(String(a.description).replace(/\s+/g, " ").slice(0, 160))}` : "";
              const count =
                typeof a.photo_count === "number"
                  ? ` — ${a.photo_count} photo${a.photo_count === 1 ? "" : "s"}`
                  : "";
              return `<li>${esc(a.title)}${count}${nice ? ` · ${nice}` : ""}${desc}</li>`;
            })
            .join("");
        } else if (source === "notes") {
          lis = items
            .map((s) => {
              const cls = s.class_level ? ` — Classes ${esc(s.class_level)}` : "";
              const count =
                typeof s.chapter_count === "number"
                  ? ` · ${s.chapter_count} published chapter${s.chapter_count === 1 ? "" : "s"}`
                  : "";
              return `<li><a href="/notes/${esc(s.slug)}">${esc(s.name)}</a>${cls}${count}</li>`;
            })
            .join("");
        }
        html = html.replace(ulRe, `<ul>${lis}</ul>`).replace(pRe, "");
      } else {
        html = html.replace(ulRe, "").replace(pRe, "");
      }
    }

    // Real school statistics — never let a crawler read "0+" placeholders.
    const stats = lists && lists.stats;
    if (stats && (stats.total_students != null || stats.total_teachers != null || stats.pass_percentage != null)) {
      const lis = [
        stats.total_students != null ? `<li>${stats.total_students}+ students enrolled</li>` : "",
        stats.total_teachers != null ? `<li>${stats.total_teachers} teachers</li>` : "",
        stats.pass_percentage != null ? `<li>${stats.pass_percentage}% pass rate</li>` : "",
        stats.established_year != null ? `<li>Established ${stats.established_year}</li>` : "",
      ]
        .filter(Boolean)
        .join("");
      html = html
        .replace(/<ul data-ghs-stats><\/ul>/, `<ul>${lis}</ul>`)
        .replace(/\s*<p data-ghs-stats-empty>[\s\S]*?<\/p>/, "");
    } else {
      html = html.replace(/<ul data-ghs-stats><\/ul>/, "").replace(/\s*<p data-ghs-stats-empty>[\s\S]*?<\/p>/, "");
    }
    return html;
  };
}

/**
 * Guarantee crawler-readable HTML for every public route.
 * For each static route: if the Chromium phase did not write a sufficiently
 * large dist/<route>/index.html, write the static fallback page. Also covers
 * dist/index.html (the homepage) when it is still the bare shell.
 */
async function fillMissingRoutesWithStaticContent() {
  const shellPath = path.join(DIST, "index.html");
  if (!existsSync(shellPath)) return { filled: [], skipped: "dist/index.html missing" };

  const shellHtml = await readFile(shellPath, "utf8");
  let lists = { notices: [], library: [], gallery: [], notes: [], stats: null, subjectSlugs: [] };
  // Always fetch build-time data now — /library, /gallery, /notes and the
  // stats blocks need it (previously only notices lists were fetched).
  lists = await fetchLatestLists(10);

  // Real DB subject slugs (e.g. "mathematics", "chemistry6") get their own
  // prerendered static pages too, so weak crawlers with browser-like UAs see
  // real content on the URLs the React app actually routes by.
  const dynamicSubjectRoutes = (lists.subjectSlugs || [])
    .filter((slug) => !STATIC_ROUTES.includes(`/notes/${slug}`))
    .map((slug) => `/notes/${slug}`);

  // Register a fallback page definition for each dynamically-discovered
  // subject (the nine hardcoded ones already exist in seo-page-content.mjs).
  for (const s of lists.notes || []) {
    const route = `/notes/${s.slug}`;
    if (getPageMeta(route)) continue;
    registerExtraPage(route, {
      title: `${s.name} Notes (Classes ${s.class_level || "6–10"}) — GHS Babi Khel`,
      description: String(
        s.description || `Free ${s.name} study notes for classes 6–10 of GHS Babi Khel, District Mohmand.`
      )
        .replace(/\s+/g, " ")
        .slice(0, 155),
      h1: `${s.name} Notes — Classes ${s.class_level || "6 to 10"}`,
      blocks: [
        {
          p: [
            `These are the ${s.name} notes of Government High School Babi Khel for classes ${s.class_level || "6 to 10"}. ${
              s.description || ""
            } The notes are written and maintained by the school's teachers and are free to read for every student.`.replace(/\s+/g, " "),
            "Choose a chapter below to open its full notes. Students can read the notes online or install the website as an app to use them offline; many chapters also include practice quizzes.",
          ],
        },
        { h2: "Chapters", links: { source: `chapters-${s.slug}`, empty: "Chapters will be listed here as teachers publish them." } },
        { h2: "Other subjects", links: { nav: true } },
      ],
    });
  }

  const filler = makeListFiller(lists);
  const filled = [];

  for (const route of [...STATIC_ROUTES, ...dynamicSubjectRoutes]) {
    const meta = getPageMeta(route);
    if (!meta) continue;

    const outPath =
      route === "/" ? shellPath : path.join(DIST, route.replace(/^\//, ""), "index.html");

    let currentSize = 0;
    try {
      currentSize = (await stat(outPath)).size;
    } catch {
      currentSize = 0;
    }
    if (currentSize >= MIN_VALID_HTML_BYTES) continue; // Chromium output exists

    const html = buildFallbackHtml(shellHtml, route, filler);
    if (!html) continue;

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, html, "utf8");
    filled.push(route);
    console.log(
      `  ⚑ ${route} — static fallback written (${(html.length / 1024).toFixed(1)} KB, no Chromium render)`
    );
  }

  return { filled };
}

// ── Main orchestrator ────────────────────────────────────────────────────────
/**
 * Run the full prerender pipeline. NEVER throws — a build always succeeds.
 * @param {string} source "vite" (closeBundle hook) or "cli" (manual script).
 */
export async function runPrerender(source = "cli") {
  // 1. PWA manifest + SW stamp — every call, unconditionally.
  await writeAssetManifestAndPatchSW();

  if (!existsSync(DIST)) {
    console.warn("Prerender: dist/ not found — run `vite build` first. Skipping.");
    return;
  }

  // The Vite hook runs right after a fresh build (outDir was emptied), so it
  // always runs. The CLI wrapper skips when the hook already did the work.
  if (source === "cli" && existsSync(MARKER)) {
    console.log("Prerender: already completed during this build (vite closeBundle) — skipping CLI run.");
    return;
  }

  const log = [];
  const skipChromium = process.env.PRERENDER === "false" || process.env.PRERENDER === "0";
  const skipFallback = process.env.SEO_FALLBACK === "false" || process.env.SEO_FALLBACK === "0";

  // 2. Chromium phase — full-fidelity rendered pages.
  let chromiumOk = 0;
  let chromiumFailed = 0;
  const server = await startServer();
  let browser = null;
  try {
    if (skipChromium) {
      console.log("Prerender: Chromium phase skipped (PRERENDER=false).");
    } else {
      browser = await launchBrowser();

      // Capture vite's ORIGINAL modulepreload set from the shell — anything
      // added at runtime must be stripped from the saved HTML.
      const shellHtml = await readFile(path.join(DIST, "index.html"), "utf8").catch(() => "");
      const originalPreloads = [...shellHtml.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/g)]
        .map((m) => (/rel="(modulepreload|preload|stylesheet|prefetch)"/.test(m[0]) ? m[1] : null))
        .filter(Boolean);
      if (originalPreloads.length) {
        console.log(
          `Prerender: keeping ${originalPreloads.length} original preload links, stripping runtime-added ones.`
        );
      }

      const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 GHSPrerender/1.0",
      });

      // Don't pollute analytics with local prerender hits.
      await context.route("**/*", (route) => {
        const u = route.request().url();
        if (u.includes("plausible.io")) return route.abort();
        return route.continue();
      });

      const noticeIds = await fetchIds("notices", DETAIL_LIMIT);
      // Real DB subject slugs — prerender them with Chromium as well.
      const buildLists = await fetchLatestLists(10).catch(() => null);
      const subjectRoutes = ((buildLists && buildLists.subjectSlugs) || [])
        .filter((slug) => !STATIC_ROUTES.includes(`/notes/${slug}`))
        .map((slug) => `/notes/${slug}`);
      const routes = [
        ...STATIC_ROUTES,
        ...subjectRoutes,
        ...noticeIds.map((id) => `/notices/${id}`),
      ];

      console.log(
        `\nPrerender: rendering ${routes.length} routes (${STATIC_ROUTES.length} static + ${subjectRoutes.length} note subjects + ${noticeIds.length} notices)…`
      );

      for (const route of routes) {
        const outPath =
          route === "/" ? path.join(DIST, "index.html") : path.join(DIST, route.replace(/^\//, ""), "index.html");
        try {
          const size = await renderPage(context, route, outPath, originalPreloads);
          chromiumOk++;
          if (STATIC_ROUTES.includes(route) || subjectRoutes.includes(route)) log.push(`  ✔ ${route} (${(size / 1024).toFixed(1)} KB)`);
        } catch (e) {
          chromiumFailed++;
          log.push(`  ✘ ${route}: ${e.message}`);
        }
      }
      console.log(log.join("\n"));
    }
  } catch (e) {
    console.warn(`Prerender: Chromium phase aborted (${e.message}) — static fallback will cover public routes.`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  // 3. Static fallback phase — guaranteed content for anything missing.
  let fallbackCount = 0;
  if (skipFallback) {
    console.log("Prerender: static fallback skipped (SEO_FALLBACK=false).");
  } else {
    try {
      const { filled } = await fillMissingRoutesWithStaticContent();
      fallbackCount = filled.length;
      if (fallbackCount > 0) {
        console.log(
          `Prerender: static fallback filled ${fallbackCount} route(s) without a full Chromium render.`
        );
      }
    } catch (e) {
      console.warn(`Prerender: static fallback failed (${e.message}) — build continues.`);
    }
  }

  // 4. Marker so the CLI wrapper never double-runs for this dist.
  try {
    await writeFile(
      MARKER,
      JSON.stringify({
        at: new Date().toISOString(),
        source,
        chromiumOk,
        chromiumFailed,
        fallback: fallbackCount,
      }),
      "utf8"
    );
  } catch {
    /* non-fatal */
  }

  console.log(
    `Prerender complete (source=${source}): chromium ${chromiumOk} ok / ${chromiumFailed} failed, ` +
      `${fallbackCount} static fallback page(s) written.\n`
  );
}
