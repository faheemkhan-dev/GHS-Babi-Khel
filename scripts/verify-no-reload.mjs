// Regression proof for the "whole page reloads while I'm editing" bug.
//
// WHAT THIS TEST PROVES
// ─────────────────────
//  1. A service-worker UPDATE completing must NOT produce a new document
//     request. (The old code reloaded the page from a "controllerchange"
//     listener, so an update arriving mid-edit destroyed the user's work.)
//  2. DOM state the user created — simulated "unsaved edits" — must survive
//     that update completely.
//  3. Registering unsaved work must keep the new worker from taking over,
//     and must still never reload the page.
//
// It simulates an app deploy by rewriting sw.js with a new CACHE_VERSION,
// which is exactly what scripts/prerender-lib.mjs does on every real build.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PORT = 4197;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

const server = createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(DIST, urlPath);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500); res.end("err");
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const documentRequests = [];
page.on("request", (r) => {
  if (r.resourceType() === "document") documentRequests.push(r.url());
});
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|React DevTools/i.test(m.text())) consoleErrors.push(m.text());
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
};

// Simulate a deploy the way scripts/prerender-lib.mjs does.
const swPath = join(DIST, "sw.js");
const stamp = (tag) =>
  writeFileSync(
    swPath,
    readFileSync(swPath, "utf8").replace(
      /const CACHE_VERSION = "[^"]*";/,
      `const CACHE_VERSION = "ghs-${tag}-${Date.now()}";`
    )
  );

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForSelector("#root *", { timeout: 30000 });

  // Wait until a service worker actually controls this page — without a
  // controller there is no "update" to trigger and the test proves nothing.
  const controlled = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return false;
    if (navigator.serviceWorker.controller) return true;
    return new Promise((res) => {
      const t = setTimeout(() => res(!!navigator.serviceWorker.controller), 10000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        clearTimeout(t); res(true);
      });
    });
  });
  check("service worker controls the page", controlled);

  if (controlled) {
    const originalSw = readFileSync(swPath, "utf8");

    // ── 1. The user is mid-edit ───────────────────────────────────────────
    await page.evaluate(() => {
      const box = document.createElement("textarea");
      box.id = "unsaved-work";
      box.value = "half-written notice that must survive";
      document.body.appendChild(box);
    });
    const before = documentRequests.length;

    // ── 2. A deploy lands and the new worker installs + activates ─────────
    stamp("deploy1");
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    // Generous window: on a slow link this is precisely when the old code
    // reloaded the page out from under the user.
    await page.waitForTimeout(9000);

    const after = documentRequests.length;
    const survived = await page.evaluate(() => {
      const el = document.getElementById("unsaved-work");
      return el ? el.value : null;
    });

    check("SW update caused ZERO document reloads", after === before, `${before} → ${after} document requests`);
    check(
      "unsaved DOM state survived the SW update",
      survived === "half-written notice that must survive",
      String(survived)
    );

    // ── 3. A second deploy, still no reload ───────────────────────────────
    const before2 = documentRequests.length;
    stamp("deploy2");
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });
    await page.waitForTimeout(9000);
    check(
      "second SW update also caused ZERO reloads",
      documentRequests.length === before2,
      `${before2} → ${documentRequests.length}`
    );

    const survived2 = await page.evaluate(() => {
      const el = document.getElementById("unsaved-work");
      return el ? el.value : null;
    });
    check("unsaved DOM state survived the second update", survived2 === "half-written notice that must survive", String(survived2));

    writeFileSync(swPath, originalSw); // restore
  }

  check("no unexpected console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
