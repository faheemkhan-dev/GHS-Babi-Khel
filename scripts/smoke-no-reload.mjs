// Smoke test: proves the "whole page reload" fix works.
//  1. Load the site (one document request).
//  2. Click through several internal links — every one must be a CLIENT-SIDE
//     route swap: URL changes, ZERO new document requests, no white reload.
//  3. Go OFFLINE (service worker active) — in-app navigation must still work
//     from the precached chunks (client-side, zero document requests).
//  4. Reload offline — the SW must serve cached HTML for the current route
//     (document request answered from cache, page renders, not homepage).
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PORT = 4199;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml",
};

// Tiny static server with SPA-ish fallback (dist contains prerendered dirs).
const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(DIST, urlPath);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    console.log("STATIC 500 for", req.url, "→", e.message);
    res.writeHead(500); res.end(String(e));
  }
});

await new Promise((r) => server.listen(PORT, r));
console.log(`server on :${PORT}`);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

let documentRequests = [];
page.on("request", (req) => {
  if (req.resourceType() === "document") documentRequests.push(req.url());
});
page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !/favicon|sourcemap|Download the React DevTools/i.test(msg.text()))
    console.log("console.error:", msg.text().slice(0, 160));
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

// ── 1. Initial load ──────────────────────────────────────────────────────────
await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
await page.waitForSelector("#root *", { timeout: 30000 });
await page.waitForTimeout(1500);
check("initial load renders", (await page.locator("#root *").count()) > 0);
check("exactly 1 document request on load", documentRequests.length === 1, `${documentRequests.length}`);

// ── 2. In-app navigations: zero document reloads ────────────────────────────
const navTargets = ["/about", "/contact", "/results", "/notices", "/gallery", "/"];
for (const target of navTargets) {
  const before = documentRequests.length;
  const link = page.locator(`a[href="${target}"]`).first();
  if ((await link.count()) === 0) {
    check(`link ${target} exists`, false, "not found on page");
    continue;
  }
  await link.click({ force: true });
  await page.waitForTimeout(1200);
  const path = new URL(page.url()).pathname;
  const docs = documentRequests.length - before;
  check(
    `navigate ${target} → client-side only`,
    path === target && docs === 0,
    `url=${path}, new document requests=${docs}`
  );
}

// ── 3. Offline in-app navigation (service worker must serve everything) ────
// Give the SW a moment to finish installing/activating.
await page.waitForTimeout(2500);
const swState = await page.evaluate(async () => {
  if (!navigator.serviceWorker.controller) {
    const reg = await navigator.serviceWorker.ready;
    await reg.active?.postMessage({ type: "SKIP_WAITING" });
  }
  return navigator.serviceWorker.controller ? "controlled" : "none";
});
await page.waitForTimeout(1000);
check("service worker controls page", swState === "controlled", swState);

await context.setOffline(true);
const beforeOffline = documentRequests.length;
const aboutLink = page.locator('a[href="/about"]').first();
await aboutLink.click({ force: true });
await page.waitForTimeout(2500);
const offlinePath = new URL(page.url()).pathname;
const offlineDocs = documentRequests.length - beforeOffline;
const bodyText = (await page.locator("body").innerText()).slice(0, 300);
check(
  "OFFLINE navigate → client-side, real page renders",
  offlinePath === "/about" && offlineDocs === 0 && /about|school|about us/i.test(bodyText),
  `url=${offlinePath}, new document requests=${offlineDocs}`
);

// ── 4. Offline hard reload of an inner route (SW serves cached HTML) ───────
await page.reload({ waitUntil: "load" }).catch(() => {});
await page.waitForTimeout(2500);
const reloadPath = new URL(page.url()).pathname;
const reloadText = (await page.locator("body").innerText().catch(() => "")).slice(0, 300);
check(
  "OFFLINE reload of /about stays on /about (no homepage redirect)",
  reloadPath === "/about" && !/this site can.t be reached/i.test(reloadText),
  `url=${reloadPath}`
);

await context.setOffline(false);
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
