// api/phet.js
// Vercel Serverless Function — COMBINED PhET proxy + asset proxy.
//
// WHY COMBINED: Vercel Hobby plan allows a maximum of 12 serverless
// functions per deployment. The project already had 12 (calendar, Iss,
// sitemap, countries, robots, rss, space-weather, nasa-apod, og,
// phet-proxy, phet-asset, nasa-image) and adding api/bisep-proxy.js
// pushed it to 13, which fails the build with:
//   "No more than 12 Serverless Functions can be added to a Deployment
//    on the Hobby plan."
// phet-proxy and phet-asset are tightly coupled (the proxy rewrites
// asset URLs inside the HTML to point to the asset proxy) and no
// frontend code calls either URL directly — they're only referenced
// from vercel.json rewrites and from the proxy's own HTML output — so
// merging them into one file was the safest consolidation.
//
// Routing inside this single function:
//   • ?sim=<slug>          → serve the PhET simulation HTML (was phet-proxy)
//   • ?path=<asset-path>   → serve a PhET asset (was phet-asset)
//
// vercel.json rewrites both URLs to this file:
//   /api/phet-proxy  → /api/phet
//   /api/phet-asset  → /api/phet
//
// The HTML returned in `sim` mode rewrites all asset URLs to
// `/api/phet-asset?path=...` (the OLD URL), which vercel.json then
// rewrites to `/api/phet?path=...` (the NEW URL). This keeps the
// existing HTML-rewriting logic unchanged.

const ALLOWED_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2|ttf|eot|gif|mp3|ogg|wav|json|html)$/i;
const PHET_BASE = "https://phet.colorado.edu/";

export default async function handler(req, res) {
  const { sim, path: assetPath } = req.query;

  // ── Asset mode (was api/phet-asset.js) ──────────────────────────────
  // Triggered when the request has a `path` query param. The phet-proxy
  // HTML rewriter generates URLs like `/api/phet-asset?path=...` which
  // vercel.json rewrites to `/api/phet?path=...`.
  if (assetPath) {
    return servePhetAsset(req, res, assetPath);
  }

  // ── Simulation HTML mode (was api/phet-proxy.js) ────────────────────
  // Triggered when the request has a `sim` query param.
  if (sim) {
    return servePhetSim(req, res, sim);
  }

  // Neither `sim` nor `path` — bad request.
  return res
    .status(400)
    .send("Missing required query parameter: `sim` or `path`.");
}

// ── PhET simulation HTML proxy (was api/phet-proxy.js) ─────────────────
async function servePhetSim(req, res, sim) {
  // Validate sim ID — only lowercase letters, digits, hyphens
  if (!/^[a-z0-9-]+$/.test(sim)) {
    return res.status(400).send("Invalid sim ID");
  }

  const simBase = `https://phet.colorado.edu/sims/html/${sim}/latest/`;
  const simUrl = `${simBase}${sim}_en-iframe.html`;

  try {
    const upstream = await fetch(simUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GHSBabiKhel/1.0)",
        Accept: "text/html",
      },
    });

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .send(`PhET returned ${upstream.status} for sim: ${sim}`);
    }

    let html = await upstream.text();

    // Rewrite absolute phet URLs → our asset proxy (still uses the OLD
    // /api/phet-asset URL — vercel.json rewrites it to /api/phet
    // transparently, so we don't need to change this string).
    html = html.replace(
      /https:\/\/phet\.colorado\.edu\/sims\/html\/([^"'\s]+)/g,
      (_, path) =>
        `/api/phet-asset?path=${encodeURIComponent("sims/html/" + path)}`
    );

    // Rewrite root-relative URLs that point to PhET assets
    html = html.replace(
      /(['"])\/([a-zA-Z][^"'\s]*\.(?:js|css|png|svg|ico|woff2?))/g,
      (_, quote, path) =>
        `${quote}/api/phet-asset?path=${encodeURIComponent(path)}`
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Allow this response to be iframed from our own origin
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'self'"
    );
    // Cache for 1 hour (PhET sims don't change mid-day)
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    return res.status(200).send(html);
  } catch (err) {
    console.error("phet sim proxy error:", err);
    return res.status(502).send("Failed to fetch simulation from PhET");
  }
}

// ── PhET asset proxy (was api/phet-asset.js) ──────────────────────────
async function servePhetAsset(req, res, assetPath) {
  // Decode and sanitise — no directory traversal
  const decoded = decodeURIComponent(assetPath).replace(/\.\.\//g, "");

  if (!ALLOWED_EXTENSIONS.test(decoded)) {
    return res.status(403).send("Forbidden file type");
  }

  const upstreamUrl = `${PHET_BASE}${decoded}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GHSBabiKhel/1.0)",
        Referer: "https://phet.colorado.edu/",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Asset not found: ${decoded}`);
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
    // Forward as a buffer (binary-safe for images, fonts, etc.)
    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error("phet asset proxy error:", err);
    return res.status(502).send("Failed to fetch asset");
  }
}
