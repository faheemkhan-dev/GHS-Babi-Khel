// Proves the value of removing the render-blocking CSS @import for Google
// Fonts.
//
// WHY THIS TEST EXISTS
// ────────────────────
// In CI/sandboxes, fonts.googleapis.com either resolves fast or fails fast
// (DNS NXDOMAIN in a second), so the old blocking @import looks harmless.
// That is NOT what users on a restricted/slow mobile network experience —
// there the request HANGS for many seconds, and because a stylesheet is
// render-blocking, the whole page stays blank for the entire duration.
//
// So this test reproduces the real condition by holding the Google Fonts
// request open for FONT_DELAY_MS, which is what a congested connection to
// that host actually looks like. It then measures first paint for the page
// as it is now (non-blocking <link>) versus the page with the old blocking
// @import restored in the CSS.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, extname } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PORT = 4194;
const FONT_DELAY_MS = 6000;
const FONT_URL = "https://fonts.googleapis.com/css2";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

const server = createServer((req, res) => {
  try {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = join(DIST, u);
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, "index.html");
    const ext = extname(f);
    const body = readFileSync(f);
    if (/\.(js|css|html|json|svg|webmanifest)$/.test(ext)) {
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Encoding": "gzip" });
      res.end(gzipSync(body));
    } else {
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(body);
    }
  } catch {
    res.writeHead(500); res.end("e");
  }
});
await new Promise((r) => server.listen(PORT, r));

const cssFile = readFileSync(join(DIST, "index.html"), "utf8").match(/\/assets\/[A-Za-z0-9_.-]+\.css/)[0];
const CSS_PATH = join(DIST, cssFile.replace(/^\//, ""));
const INDEX_PATH = join(DIST, "index.html");
const cssOriginal = readFileSync(CSS_PATH, "utf8");
const indexOriginal = readFileSync(INDEX_PATH, "utf8");
const FONT_LINK = FONT_URL + "?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap";

async function measure(label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Hold the font request open, exactly like a congested link to Google.
  await ctx.route(FONT_URL + "**", async (route) => {
    await new Promise((r) => setTimeout(r, FONT_DELAY_MS));
    route.fulfill({ status: 200, contentType: "text/css", body: "" });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 100,
    downloadThroughput: (1200 * 1024) / 8, uploadThroughput: (600 * 1024) / 8,
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#root *", { timeout: 30000 });
  const fcp = await page.evaluate(() => {
    const e = performance.getEntriesByName("first-contentful-paint")[0];
    return e ? Math.round(e.startTime) : null;
  });
  await browser.close();
  console.log(`  ${label.padEnd(34)} FCP = ${fcp}ms`);
  return fcp;
}

console.log(`\nGoogle Fonts artificially held for ${FONT_DELAY_MS}ms (simulating a slow/congested link to that host)\n`);

try {
  // ── Current code: non-blocking <link media="print"> in index.html ──
  const nowFcp = await measure("CURRENT (non-blocking <link>)");

  // ── Old code: blocking CSS @import, no <link> ──
  writeFileSync(CSS_PATH, `@import url('${FONT_LINK}');\n` + cssOriginal, "utf8");
  writeFileSync(INDEX_PATH, indexOriginal.replace(/<link\s+rel="stylesheet"[\s\S]*?onload="this\.media='all'; this\.onload=null;"\s*\/>\n/, ""), "utf8");
  const oldFcp = await measure("OLD (blocking CSS @import)");

  const delta = oldFcp - nowFcp;
  console.log(`\n  improvement: ${delta}ms faster to first paint (${(oldFcp / Math.max(nowFcp, 1)).toFixed(1)}x)`);
  console.log(
    nowFcp < oldFcp
      ? "  PASS — paint no longer waits on the font request"
      : "  FAIL — the non-blocking link is not behaving as intended"
  );
  process.exitCode = nowFcp < oldFcp ? 0 : 1;
} finally {
  writeFileSync(CSS_PATH, cssOriginal, "utf8");
  writeFileSync(INDEX_PATH, indexOriginal, "utf8");
  server.close();
}
void copyFileSync;
