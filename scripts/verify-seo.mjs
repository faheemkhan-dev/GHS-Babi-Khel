#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-seo.mjs — SEO / indexability verification for GHS Babi Khel
//
// Fetches every public route with a Googlebot User-Agent (desktop + smartphone)
// AND a normal browser UA, then prints a pass/fail table covering:
//   HTTP status · canonical · robots meta · X-Robots-Tag header · title ·
//   H1 · visible word count · JSON-LD validity
// plus site-level checks (sitemap completeness, robots.txt rules, URL
// canonicalisation traps: trailing slash, /index.html, wrong case, dead
// notice UUIDs).
//
// Usage:
//   node scripts/verify-seo.mjs                        # against production
//   node scripts/verify-seo.mjs https://localhost:3000 # against any base URL
//   node scripts/verify-seo.mjs --ua=googlebot         # bot UA only
//
// Exit code 0 = all checks passed, 1 = at least one failure.
// Node 18+ (uses global fetch). Zero dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = (process.argv.find((a) => a.startsWith("http")) || "https://ghsbabikhel.dpdns.org").replace(/\/+$/, "");
const BROWSER_ONLY = process.argv.includes("--ua=browser");
const BOT_ONLY = process.argv.includes("--ua=googlebot");

const GOOGLEBOT_DESKTOP =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GOOGLEBOT_SMARTPHONE =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

// The four pages Search Console complained about, then every other public route.
const PRIORITY_ROUTES = ["/faq", "/notices", "/notes", "/library"];
const OTHER_ROUTES = [
  "/", "/about", "/contact", "/admission", "/results", "/merit-list",
  "/roll-no-slip", "/result-card", "/teachers", "/gallery", "/duty",
];

const MIN_BOT_WORDS = 120; // below this the crawler page is "thin"

let passCount = 0;
let failCount = 0;
const failedChecks = [];

function record(ok, label) {
  if (ok) passCount++;
  else {
    failCount++;
    failedChecks.push(label);
  }
  return ok;
}

async function fetchRaw(path, ua, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": ua, Accept: "text/html,*/*", ...extraHeaders },
    signal: AbortSignal.timeout(25000),
  });
  const body = await res.text().catch(() => "");
  return { res, body, status: res.status, headers: res.headers };
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseChecks({ status, headers, body }, route, uaLabel, isBot) {
  const out = [];
  const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || "";
  const canonical = (body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1] || "";
  const robotsMeta = (body.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) || [])[1] || "";
  const h1 = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, "").trim() || "";
  const words = stripTags(body).split(" ").filter(Boolean).length;
  const xRobots = headers.get("x-robots-tag") || "";
  const jsonLdBlocks = [...body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let jsonLdOk = true;
  const jsonLdTypes = [];
  for (const m of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(m[1]);
      const graphs = parsed["@graph"] || [parsed];
      for (const g of graphs) if (g?.["@type"]) jsonLdTypes.push(String(g["@type"]));
    } catch {
      jsonLdOk = false;
    }
  }

  out.push([record(status === 200, `${route} [${uaLabel}] HTTP status 200 (got ${status})`), `status:${status}`]);
  out.push([record(!!title, `${route} [${uaLabel}] has <title>`), title ? "title" : "title"]);
  const titleShort = title.length > 42 ? title.slice(0, 39) + "…" : title || "(none)";
  out.push([null, titleShort]);
  if (isBot) {
    // Canonical is only REQUIRED for crawler UAs — browsers receive the SPA
    // shell (react-helmet sets the canonical client-side after JS runs),
    // which is standard SPA behaviour and irrelevant for indexing.
    out.push([
      record(canonical === `${BASE}${route}`, `${route} [${uaLabel}] self-canonical ${BASE}${route} (got ${canonical || "none"})`),
      canonical === `${BASE}${route}` ? "canonical" : "canonical",
    ]);
  }
  const noindexMeta = /noindex/i.test(robotsMeta);
  out.push([
    record(!noindexMeta, `${route} [${uaLabel}] robots meta not noindex (got "${robotsMeta}")`),
    noindexMeta ? "robots!" : "robots",
  ]);
  out.push([
    record(!/noindex/i.test(xRobots), `${route} [${uaLabel}] X-Robots-Tag not noindex (got "${xRobots}")`),
    xRobots ? "X-robots!" : "X-robots",
  ]);
  if (isBot) {
    out.push([record(!!h1, `${route} [${uaLabel}] has <h1>`), h1 ? "h1" : "h1"]);
    out.push([
      record(words >= MIN_BOT_WORDS, `${route} [${uaLabel}] word count ≥ ${MIN_BOT_WORDS} (got ${words})`),
      `words:${words}`,
    ]);
    out.push([
      record(jsonLdOk && jsonLdTypes.length > 0, `${route} [${uaLabel}] valid JSON-LD (${jsonLdTypes.join(",") || "none"})`),
      jsonLdTypes.length ? "jsonld" : "jsonld",
    ]);
  } else {
    // Browser UA: the SPA shell is expected — only status + no accidental
    // noindex matter (content arrives via client JS).
    out.push([null, `words:${words}`]);
  }
  return { out, title, words, canonical, robotsMeta };
}

async function checkRoute(route) {
  const profiles = [];
  if (!BROWSER_ONLY) {
    profiles.push(["googlebot", GOOGLEBOT_DESKTOP, true]);
    profiles.push(["googlebot-smartphone", GOOGLEBOT_SMARTPHONE, true]);
  }
  if (!BOT_ONLY) profiles.push(["browser", BROWSER, false]);
  const titles = new Set();
  for (const [label, ua, isBot] of profiles) {
    const r = await fetchRaw(route, ua);
    const { out, title } = parseChecks(r, route, label, isBot);
    if (isBot && title) titles.add(title);
    const cells = out.map(([p, v]) => `${p === "FAIL" ? "✗" : p === "PASS" ? "✓" : " "} ${v}`);
    console.log(`  ${route.padEnd(22)} ${label.padEnd(20)} ${cells.join("  │  ")}`);
  }
  return titles;
}

async function main() {
  console.log(`\nSEO verification — ${BASE}`);
  console.log(`Googlebot desktop + smartphone + browser UA, redirect: manual\n`);

  const allTitles = new Set();
  const titleDupes = new Set();
  console.log("── Per-route checks ──────────────────────────────────────────────────");
  for (const route of [...PRIORITY_ROUTES, ...OTHER_ROUTES]) {
    const titles = await checkRoute(route);
    for (const t of titles) {
      if (allTitles.has(t)) titleDupes.add(t);
      allTitles.add(t);
    }
  }
  record(titleDupes.size === 0, `unique <title> per route (duplicates: ${[...titleDupes].join(" | ") || "none"})`);
  console.log(`  ${titleDupes.size === 0 ? "✓" : "✗"} titles unique across routes`);

  console.log("\n── URL canonicalisation traps (Googlebot UA) ─────────────────────────");
  const traps = [
    // [path, expectation description, checker]
    ["/faq/", (r) => record(r.status === 308 || r.status === 301, `trailing slash /faq/ → 308/301 (got ${r.status})`), "redirect to /faq"],
    ["/index.html", (r) => record(r.status === 308 || r.status === 301, `/index.html → 308/301 (got ${r.status})`), "redirect to /"],
    ["/faq/index.html", (r) => record(r.status === 308 || r.status === 301, `/faq/index.html → 308/301 (got ${r.status})`), "redirect to /faq"],
    ["/FAQ", (r) => record(r.status === 404, `wrong-case /FAQ → 404 for Googlebot (got ${r.status})`), "not a soft-200"],
    ["/notices/00000000-0000-4000-8000-000000000000", (r) => record(r.status === 404, `dead notice UUID → 404 (got ${r.status})`), "not a soft-200"],
    ["/notices/this-page-does-not-exist", (r) => record(r.status === 404, `invalid notice slug → 404 (got ${r.status})`), "not a soft-200"],
  ];
  for (const [path, checker, label] of traps) {
    let r;
    try {
      r = await fetchRaw(path, GOOGLEBOT_DESKTOP);
    } catch (e) {
      record(false, `${path} — fetch error: ${e.message}`);
      console.log(`  ${path.padEnd(48)} ✗ fetch error`);
      continue;
    }
    const ok = checker(r);
    console.log(`  ${path.padEnd(48)} ${ok ? "✓" : "✗"} ${label} (HTTP ${r.status})`);
  }

  console.log("\n── sitemap.xml ────────────────────────────────────────────────────────");
  let smBody = "";
  try {
    smBody = (await fetchRaw("/sitemap.xml", GOOGLEBOT_DESKTOP)).body;
  } catch (e) {
    record(false, `sitemap.xml fetch failed: ${e.message}`);
  }
  if (smBody) {
    record(smBody.includes("<?xml"), "sitemap.xml is XML");
    for (const route of [...PRIORITY_ROUTES, ...OTHER_ROUTES]) {
      const present = smBody.includes(`<loc>${BASE}${route}</loc>`);
      record(present, `sitemap contains ${route}`);
      console.log(`  sitemap ${route.padEnd(24)} ${present ? "✓ present" : "✗ MISSING"}`);
    }
    const nowStamp = new Date().toISOString().slice(0, 10);
    const everyRouteStampedToday = ["/", "/about", "/contact", "/faq", "/admission"].every((rt) => {
      const m = smBody.match(new RegExp(`<loc>${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${rt}</loc>\\s*<lastmod>([^<]+)</lastmod>`));
      return m && m[1] === nowStamp;
    });
    record(!everyRouteStampedToday, `sitemap lastmod not "today" on every static page (lastmod spam check)`);
    console.log(`  sitemap lastmod spam check             ${!everyRouteStampedToday ? "✓ ok" : "✗ every page says today"}`);
  }

  console.log("\n── robots.txt ─────────────────────────────────────────────────────────");
  let rbBody = "";
  try {
    rbBody = (await fetchRaw("/robots.txt", GOOGLEBOT_DESKTOP)).body;
  } catch (e) {
    record(false, `robots.txt fetch failed: ${e.message}`);
  }
  if (rbBody) {
    const blocksPublic = ["/faq", "/notices", "/notes", "/library"].some((rt) =>
      new RegExp(`^Disallow: ${rt}`, "m").test(rbBody)
    );
    record(!blocksPublic, "robots.txt does not disallow /faq /notices /notes /library");
    record(/Sitemap: /.test(rbBody), "robots.txt declares a Sitemap");
    console.log(`  robots.txt public pages allowed          ${!blocksPublic ? "✓" : "✗ BLOCKED"}`);
    console.log(`  robots.txt sitemap declared              ${/Sitemap: /.test(rbBody) ? "✓" : "✗"}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────────────");
  console.log(`RESULT: ${passCount} passed, ${failCount} failed ${failCount === 0 ? "— ALL GREEN ✅" : "❌"}`);
  if (failCount > 0) {
    console.log("\nFailed checks:");
    for (const f of failedChecks) console.log(`  ✗ ${f}`);
  }
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-seo crashed:", e.message);
  process.exit(1);
});
