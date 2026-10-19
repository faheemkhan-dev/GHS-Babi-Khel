#!/usr/bin/env node
// Lighthouse runner — mobile form factor, simulated throttling (slow 4G, 4x CPU).
// Usage: node scripts/lighthouse-run.mjs <port> <label> [paths...]
import { execSync } from "node:child_process";
import fs from "node:fs";

const [port, label, ...paths] = process.argv.slice(2);
const CHROME = "/home/z/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome";
const targets = paths.length ? paths : ["/", "/roll-no-slip", "/faq"];
const out = [];

for (const p of targets) {
  const url = `http://127.0.0.1:${port}${p}`;
  const slug = p === "/" ? "home" : p.replace(/\//g, "_").replace(/^_/, "");
  const json = `/tmp/lh-${label}-${slug}.json`;
  try {
    execSync(
      `npx lighthouse "${url}" --output=json --output-path=${json} --quiet --chrome-flags="--headless=new --no-sandbox" --only-categories=performance --screenEmulation.mobile --form-factor=mobile`,
      { env: { ...process.env, CHROME_PATH: CHROME }, stdio: "pipe", timeout: 180000 }
    );
    const r = JSON.parse(fs.readFileSync(json, "utf8"));
    const a = r.audits;
    const num = (k) => Math.round(a[k]?.numericValue ?? -1);
    out.push({
      page: p,
      score: Math.round((r.categories.performance.score || 0) * 100),
      fcp: num("first-contentful-paint"),
      lcp: num("largest-contentful-paint"),
      tbt: num("total-blocking-time"),
      cls: (a["cumulative-layout-shift"]?.numericValue ?? -1).toFixed(3),
      js: Math.round((a["total-byte-weight"]?.numericValue ?? 0) / 1024),
    });
  } catch (e) {
    out.push({ page: p, error: String(e.message).slice(0, 120) });
  }
}
console.log(`\n=== Lighthouse (mobile, simulated throttling) — ${label} ===`);
for (const o of out) {
  if (o.error) console.log(`${o.page.padEnd(16)} ERROR ${o.error}`);
  else
    console.log(
      `${o.page.padEnd(16)} score:${String(o.score).padStart(3)}  FCP:${o.fcp}ms  LCP:${o.lcp}ms  TBT:${o.tbt}ms  CLS:${o.cls}  totalBytes:${o.js}KB`
    );
}
