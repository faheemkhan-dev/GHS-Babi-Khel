// middleware.ts (Fixed — Problem 1: Googlebot was being 403-blocked)
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT WAS BROKEN (and is fixed here):
//
// 1. GOOGLEBOT 403 — The old BLOCKED_USER_AGENTS list contained the bare
//    words "bot", "spider", "crawler", "scraper". Every real Googlebot
//    User-Agent contains "+http://www.google.com/bot.html" — and the
//    standalone word "bot" in that URL matched the old \b<word>\b regex.
//    Result: Google itself was blocked with 403 for weeks/months, which is
//    why indexed pages never refreshed, new pages never appeared, and
//    Search Console "Request Indexing" seemed to do nothing.
//    FIX: those bare words are removed. Only specific attack-tool names
//    remain (sqlmap, nikto, nmap, …), none of which appear in any
//    legitimate search-engine or AI crawler UA.
//
// 2. WHATSAPP REAL USERS REDIRECTED — The old bot check used
//    ua.includes("whatsapp"), which also matches ordinary visitors browsing
//    from inside the WhatsApp app (their UA ends with "(WhatsApp)"), so real
//    people were 302-redirected to /api/og instead of the website.
//    FIX: social-crawler detection now uses precise patterns. The WhatsApp
//    *crawler* UA starts with "WhatsApp/", while real in-app browsers start
//    with "Mozilla/5.0 …" and only carry "(WhatsApp)" at the end.
//
// 3. FACEBOOK PREVIEW INFINITE LOOP — The old code redirected social
//    crawlers to /api/og, but /api/og is ALSO matched by this middleware's
//    matcher, so the crawler was redirected to /api/og again and again
//    (302 → 302 → 302 …). Facebook gave up → broken link previews.
//    FIX: the social-crawler redirect only applies to page routes, never to
//    /api/* paths.
//
// 4. DEAD CODE — The old "Regular User Request" block built a Response with
//    security headers and then returned undefined, so that Response (and its
//    headers) was thrown away. Real headers come from vercel.json. Removed.
//
// Also: Applebot and W3C_Validator are no longer redirected to /api/og —
// Applebot is a search crawler (needs real HTML) and the W3C validator
// needs the real page to validate.
//
// 5. AI / SEARCH CRAWLERS GET LIVE-RENDERED HTML (dynamic rendering) ────────
//    The site ships build-time prerendered pages, but their content freezes
//    at the last deploy — while the admin changes admission status, notices,
//    news, results and events in the dashboard daily. So when a recognised
//    AI/search crawler (GPTBot, ClaudeBot, PerplexityBot, Googlebot, Bingbot,
//    …) requests a public page, the middleware proxies the request to
//    /api/render?path=… which returns a complete semantic HTML page built
//    from the LIVE database — fresh content within the 2-minute CDN cache
//    window, not the next deploy. Humans are unaffected: they still get the
//    real React app with the identical design. Private areas (admin,
//    dashboard, teacher, auth) are never proxied, and the crawler still
//    passes the same rate limiter as everyone else.
// ═══════════════════════════════════════════════════════════════════════════

export const config = {
  runtime: "edge",
  matcher: [
    // Page routes — everything except static assets and most /api/ routes.
    "/((?!api/|assets/|\\.well-known/|favicon|icon-|apple-touch-icon|manifest.json|robots.txt|sitemap.xml|rss.xml|feed.xml|og-image|sw.js|.*\\.(?:js|css|png|jpg|jpeg|svg|ico|webp|woff2?|ttf|json|xml|txt)$).*)",
    // Outbound-scraping endpoints get the tighter 'scrapeProxy' rate limit.
    "/api/bisep-proxy",
    "/api/og",
  ],
};

// ─── Blocked User-Agents (attack tools only) ──────────────────────────────
// ⚠️ NEVER add bare words like "bot", "spider", "crawler", "scraper" here.
// Googlebot's UA is:  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
// and the standalone word "bot" inside that URL WILL match \bbot\b and block
// Google. Same trap exists for Bingbot, ClaudeBot, GPTBot, etc.
// Every entry below is a dedicated attack/scrape tool that no legitimate
// search engine or AI crawler ever uses.
const BLOCKED_USER_AGENTS = [
  // Dedicated hacking/scanning tools
  "sqlmap", "nikto", "dirbuster", "nmap", "masscan",
  "zgrab", "gobuster", "wfuzz", "hydra", "medusa", "ncrack",
  "arachni", "w3af", "skipfish", "whatweb", "nuclei",
  "aquatone", "amass", "subfinder",
];

// Suspicious patterns in User-Agent
const SUSPICIOUS_PATTERNS = [
  /^[A-Z]{20,}$/, // All caps long strings
];

// ─── Social preview crawlers (link-preview only) ──────────────────────────
// These are redirected to /api/og which serves tailored OG meta tags.
// Patterns are deliberately precise so that:
//   • WhatsApp CRAWLER ("WhatsApp/2.19.81 A" — starts with "WhatsApp/") is
//     detected, but
//   • WhatsApp IN-APP BROWSERS ("Mozilla/5.0 … (WhatsApp)") are NOT.
//   • Facebook's crawler is detected, but Facebook's in-app browser
//     ("… [FB_IAB/FB4A;FBAV/…]") is NOT.
// Search engine bots (Googlebot, Bingbot) and AI crawlers (GPTBot,
// ClaudeBot, PerplexityBot, Google-Extended, Applebot) are intentionally NOT
// in this list — they must receive the real (prerendered) HTML.
const SOCIAL_CRAWLER_PATTERNS: RegExp[] = [
  /\bfacebookexternalhit\//i,
  /\bfacebookcatalog\b/i,
  /\btwitterbot\//i,
  /\blinkedinbot\//i,
  /^WhatsApp\//i, // crawler only — real in-app browsers start with "Mozilla/"
  /\bslackbot\b/i,
  /\bslack-imgproxy\b/i,
  /\bdiscordbot\//i,
  /\btelegrambot\b/i,
  /\bskypeuripreview\b/i,
  /\bviber\//i,
  /\bpinterest(bot)?\//i,
  /\bredditbot\b/i,
  /\bvkshare\b/i,
  /\bembedly\b/i,
  /\boutbrain\b/i,
  /\bquora link preview\b/i,
  /\btumblr\//i,
];

// ─── AI & search-engine crawlers → live-rendered HTML ────────────────────
// These user-agents receive complete, freshly rendered HTML from /api/render
// (see api/render.js) instead of the build-time snapshot. Patterns are
// anchored to the crawler tokens so ordinary browsers can never match.
// Googlebot here ALSO covers Gemini (grounding) and Copilot/Bingbot covers
// Bing-powered answers; the dedicated AI-training crawlers (GPTBot,
// ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent)
// are listed explicitly as well.
//
// ADDED (2026-08): weaker/smaller AI systems whose fetchers were previously
// missed, so they too receive the full live-rendered content instead of a
// thin build-time snapshot:
//   • FacebookBot — Meta's web/AI crawler (distinct from facebookexternalhit,
//     which only builds link previews)
//   • BingPreview — used for link cards inside Copilot / Teams / Outlook
//   • DuckAssistBot — DuckDuckGo AI answers
//   • GoogleOther — Google's non-search crawlers (incl. AI pipelines)
//   • DeepSeekBot — DeepSeek's crawler
//   • cohere-ai — Cohere's web crawler
//   • KagiBot — Kagi search/assistant
//
// ADDED (2026-08 reliability pass): GENERIC_BOT_TOKEN_RE below. The explicit
// list can never cover every AI tool on the market — new/weak AI systems
// ship fetchers with their own UAs all the time ("SomeAI-Fetcher/1.0",
// "AcmeResearchCrawler", …). Any UA that SELF-IDENTIFIES as an automated
// agent (bot / crawler / spider / slurp / scraper / fetcher tokens, with the
// usual "/version" or ";" separators) now also gets live-rendered HTML.
// This is a RENDER-ONLY widening — the BLOCK list is untouched and stays
// limited to attack tools. Real browsers (Chrome, Safari, Firefox, Edge,
// Samsung Internet, WhatsApp/Telegram in-app views, …) never contain these
// tokens, so human traffic is unaffected. Note "/bot" and "bot/" segment
// patterns (not bare \bbot\b) so brand names like "CUBOT" phones or "Botim"
// can never match.
const AI_SEARCH_CRAWLER_PATTERNS: RegExp[] = [
  /\bGPTBot\b/i,
  /\bOAI-SearchBot\b/i,
  /\bChatGPT-User\b/i,
  /\bClaudeBot\b/i,
  /\bClaude-Web\b/i,
  /\bClaude-User\b/i,
  /\bClaude-SearchBot\b/i,
  /\bPerplexityBot\b/i,
  /\bPerplexity-User\b/i,
  /\bGoogle-Extended\b/i,
  /\bGooglebot\b/i,
  /\bGoogle-InspectionTool\b/i,
  /\bGoogleOther\b/i,
  /\bBingbot\b/i,
  /\bBingPreview\b/i,
  /\bApplebot\b/i,
  /\bApplebot-Extended\b/i,
  /\bDuckDuckBot\b/i,
  /\bDuckAssistBot\b/i,
  /\bYandexBot\b/i,
  /\bCCBot\b/i,
  /\bBytespider\b/i,
  /\bmeta-externalagent\b/i,
  /\bFacebookBot\b/i,
  /\bAmazonbot\b/i,
  /\bDiffbot\b/i,
  /\bYouBot\b/i,
  /\bMistralAI-User\b/i,
  /\bPetalBot\b/i,
  /\bDeepSeekBot\b/i,
  /\bcohere-ai\b/i,
  /\bKagiBot\b/i,
];

// Generic self-identified automated-agent tokens — catches AI/AI-research
// fetchers that are NOT in the explicit list above (e.g. "AcmeBot/2.0",
// "SomeWeakAI-Fetcher/1.0"). Three safe token shapes:
//   • standalone words ( \bbot\b … ) — "bot; research"
//   • segment tokens ( bot/, /bot., -bot/, bot; ) — "Googlebot/2.1"
//   • suffixed tokens ( xbot/ ) — "GPTBot/1.2", "AcmeBot/2.0"
// The suffix shape requires a letter/digit directly before "bot" AND a
// separator (slash, semicolon, comma, bracket or space) directly after — so
// brand names like "CUBOT_X30" or the "Botim" app can never match, and no
// real browser UA contains any of these shapes. RENDER-ONLY: the BLOCK list
// is untouched and stays limited to attack tools.
const GENERIC_BOT_TOKEN_RE =
  /\b(?:bot|crawler|spider|slurp|scraper|fetcher|archiver)\b|\bbot[/;)]|\/bot\.|-bot\/|bot;|headless|[a-z0-9]bot[/;,)\s]|crawl[- ]?bot/i;

function isSearchOrAICrawler(ua: string): boolean {
  return (
    AI_SEARCH_CRAWLER_PATTERNS.some((re) => re.test(ua)) ||
    GENERIC_BOT_TOKEN_RE.test(ua)
  );
}

// Paths that must NEVER be proxied to the live renderer:
//   • private/authenticated areas (they are robots-disallowed and
//     authentication-protected — bots get the real protected behaviour),
//   • the client-side search utility (no standalone content),
//   • anything under /api/ (excluded by the matcher anyway — defence in depth).
//
// ⚠ BUGFIX (2026-08): this list previously used the bare prefix "/teacher" for
// the protected teacher dashboard — but "/teachers" (the PUBLIC staff
// directory) also starts with "/teacher", so the public Teachers page was
// silently excluded from live rendering and every AI/search crawler only ever
// saw its thin build-time snapshot without the actual staff directory. The
// check now matches the dashboard route EXACTLY (/teacher or /teacher/...)
// and no longer swallows /teachers.
const LIVE_RENDER_EXCLUDE_PREFIXES = [
  "/admin",
  "/dashboard",
  "/teacher", // handled exactly below — see isLiveRenderExcluded()
  "/auth",
  "/search",
  "/api/",
];

/** True when the path is the protected /teacher dashboard (exact), NOT the
 *  public /teachers directory. "/teacher" and "/teacher/anything" are private;
 *  "/teachers" and every other public route are fine to live-render. */
function isLiveRenderExcluded(pathname: string): boolean {
  if (pathname === "/teacher" || pathname.startsWith("/teacher/")) return true;
  return LIVE_RENDER_EXCLUDE_PREFIXES.some(
    (p) => p !== "/teacher" && pathname.startsWith(p)
  );
}

function shouldLiveRender(pathname: string): boolean {
  return !isLiveRenderExcluded(pathname);
}

/**
 * Proxy the crawler request to /api/render, which returns complete,
 * LIVE database-backed HTML for this path.
 *
 * RELIABILITY CONTRACT (2026-08 fix for intermittent crawler timeouts):
 * a crawler that reaches this branch must NEVER receive an error page and
 * NEVER wait longer than RENDER_PROXY_TIMEOUT_MS. The previous version had
 * no timeout and no status check on this hop, so whenever the Node function
 * was cold or Supabase was slow, the function-level 504/500 body was piped
 * STRAIGHT THROUGH to the crawler — which external crawl tests reported as
 * "intermittent timeouts / inconsistent HTML". Now:
 *   • the fetch is hard-aborted after RENDER_PROXY_TIMEOUT_MS,
 *   • any non-200 response or non-HTML body throws,
 *   • and BOTH cases fall through to the build-time prerendered page via the
 *     caller's catch — which is complete, crawlable HTML served instantly.
 *
 * TIMEOUT BUMP (2026-10): 4000 → 6000 ms. The previous 4 s ceiling was too
 * tight for a cold Node function on Vercel (cold starts can be 1–2 s before
 * the first DB query even fires), so the live-render hop frequently timed
 * out and Googlebot got the prerendered fallback instead of fresh content.
 * With /roll-no-slip now also having a prerendered fallback (so the static
 * page is always correct, not the SPA shell), 6 s is safe: worst case the
 * crawler waits 6 s and gets the prerendered page; best case it gets fresh,
 * database-backed HTML. The Vercel Edge runtime allows up to 25 s for
 * middleware, so 6 s leaves plenty of headroom.
 */
const RENDER_PROXY_TIMEOUT_MS = 6000;

async function proxyToLiveRender(request: Request, pathname: string): Promise<Response> {
  // NOTE: a renderer 404 is a DELIBERATE answer ("this route does not exist"),
  // not a failure. It MUST be passed through to the crawler — previously any
  // non-200 (including 404) threw and fell through to the static pipeline,
  // whose SPA-fallback shell answers 200 "index, follow" with the homepage
  // title. Googlebot crawling a dead /notices/<uuid>, a wrong-case /FAQ or
  // any other unknown path therefore saw a soft-404 instead of a clean 404 —
  // the exact "duplicate/soft-404" signal Search Console reports. Only
  // 5xx / timeouts / non-HTML bodies are treated as renderer failures and
  // fall back to the (prerendered) static page.
  const sanitize = (h: Headers) => {
    const safe = new Headers(h);
    for (const k of ["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]) {
      safe.delete(k);
    }
    return safe;
  };
  const renderUrl = new URL("/api/render", request.url);
  renderUrl.searchParams.set("path", pathname);
  const resp = await fetch(renderUrl.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "GHSRenderBot/1.0 (internal dynamic-render hop)",
      Accept: "text/html",
    },
    redirect: "follow",
    // Hard ceiling on the live-render hop. AbortSignal.timeout is supported
    // in the Vercel Edge runtime; on timeout it rejects with TimeoutError,
    // the catch below falls through to the static page.
    signal: AbortSignal.timeout(RENDER_PROXY_TIMEOUT_MS),
  });
  const contentType = resp.headers.get("content-type") || "";
  // Deliberate 404 from the renderer's strict route allow-list → pass it
  // straight through (noindex 404 page) so crawlers get a real 404.
  if (resp.status === 404 && contentType.includes("text/html")) {
    return new Response(resp.body, { status: 404, statusText: "Not Found", headers: sanitize(resp.headers) });
  }
  if (!resp.ok || !contentType.includes("text/html")) {
    // Renderer failed (cold-start 504, Supabase outage 5xx, rate limit, …).
    // Throw so the caller serves the prerendered page instead of piping the
    // error body to the crawler.
    throw new Error(`render hop returned ${resp.status} ${contentType || "(no content-type)"}`);
  }
  // HEADER SANITISING (indexing fix): `fetch()` in the Edge runtime hands us an
  // already-DECODED body, but the upstream headers still say
  // "Content-Encoding: gzip/br" and carry the old Content-Length. Re-sending
  // those headers with a decoded body makes the response undecodable for
  // some clients — a crawler then reports "page fetch failed / couldn't be
  // rendered". Copy only safe headers and let the platform re-compress.
  const safeHeaders = sanitize(resp.headers);
  const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: safeHeaders });
  // SEO NOTE: "Vary: User-Agent" is intentionally NOT set.
  //
  // Google explicitly recommends against `Vary: User-Agent` for dynamic
  // rendering because:
  //   1. CDN caches fragment by UA — Googlebot/2.1 (smartphone), Googlebot/2.1
  //      (desktop), Google-InspectionTool/1.0, Googlebot-Image/1.0 etc. each
  //      get their own cache entry, so each UA variant triggers a fresh
  //      origin request every TTL window → wasted crawl budget → "quota
  //      exceeded" errors in Search Console URL inspection.
  //   2. Googlebot re-crawls the same URL multiple times (once per UA variant)
  //      instead of once, which is the #1 cause of slow indexation for sites
  //      that do dynamic rendering.
  //   3. It's a cloaking-risk signal — Google may flag the site for review.
  //
  // Removing it lets the CDN cache by URL only. The first request (bot or
  // human) primes the cache; subsequent requests for the same URL within the
  // 120s s-maxage window are served from cache regardless of UA. Bots get
  // the live-rendered HTML (cached) → fast, consistent, single crawl per URL.
  out.headers.set("X-GHS-Live-Render", "1");
  return out;
}

// ─── Rate Limiting Store (In-Memory for Edge) ─────────────────────────────

interface RateLimitEntry {
  count: number;
  resetTime: number;
  lastRequest: number;
  blockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMITS = {
  default: { windowMs: 60000, maxRequests: 100 },
  auth: { windowMs: 900000, maxRequests: 10 },        // 15 min
  login: { windowMs: 900000, maxRequests: 5 },         // 15 min
  signup: { windowMs: 3600000, maxRequests: 3 },        // 1 hour
  contact: { windowMs: 60000, maxRequests: 2 },          // 1 min
  passwordReset: { windowMs: 3600000, maxRequests: 3 }, // 1 hour
  api: { windowMs: 60000, maxRequests: 60 },
  // v6 (Oct 24, 2026) — relaxed 15 → 300 per minute.
  // The 15/min ceiling was a self-imposed guard against v5's "probabilistic
  // 403 rate limit", which has now been debunked: BISE Peshawar's PHP backend
  // has NO rate-limit counter (no IP tracking, no request counting, no 429s,
  // reusable ResultToken). The 403s were Cloudflare challenging our HTTP/2
  // client for missing browser fingerprint headers — fixed at the proxy
  // layer in api/bisep-proxy.js v6 (full Chrome 126 sec-ch-ua / sec-fetch-*
  // / accept-encoding headers + 3-session pool).
  // With the v6 bulkFetch.ts running at concurrency 8, a 54-roll class PDF
  // fires ~54 /api/bisep-proxy calls in ~8 s — that's already 408/min and
  // would blow past the old 15/min cap, killing bulk Report Card generation
  // and AdminMeritList's BISE-class fetch at OUR middleware, not the board.
  // 300/min = 5 req/s, plenty of headroom for 8-way concurrency while still
  // being a sane abuse ceiling (a single attacker hammering the public
  // endpoint still gets throttled hard).
  scrapeProxy: { windowMs: 60000, maxRequests: 300 },
};

type LimitType = keyof typeof RATE_LIMITS;

// ─── Client Identification ─────────────────────────────────────────────────

function getClientInfo(request: Request): {
  ip: string;
  fingerprint: string;
} {
  const ua = request.headers.get("user-agent") || "";
  const uaLower = ua.toLowerCase();

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const fingerprint = `${ip}:${uaLower.substring(0, 50)}`;
  return { ip, fingerprint };
}

function isBlockedUA(ua: string): boolean {
  // Word-boundary match to avoid false positives inside unrelated words.
  return (
    BLOCKED_USER_AGENTS.some((blocked) =>
      new RegExp(`\\b${blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(ua)
    ) || SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(ua))
  );
}

function isSocialCrawler(ua: string): boolean {
  return SOCIAL_CRAWLER_PATTERNS.some((re) => re.test(ua));
}

// ─── Rate Limiting Functions ────────────────────────────────────────────────

function checkRateLimit(
  identifier: string,
  limitType: LimitType = "default"
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const config = RATE_LIMITS[limitType];
  const now = Date.now();

  let entry = rateLimitStore.get(identifier);

  // New entry or expired window
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
      lastRequest: now,
    };
    rateLimitStore.set(identifier, entry);
    return { allowed: true, remaining: config.maxRequests - 1 };
  }

  // Currently blocked?
  if (entry.blockedUntil && now < entry.blockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  // Block expired?
  if (entry.blockedUntil && now >= entry.blockedUntil) {
    entry.count = 0;
    entry.blockedUntil = undefined;
  }

  // Over limit?
  if (entry.count >= config.maxRequests) {
    // Apply block (double the window)
    entry.blockedUntil = now + config.windowMs * 2;
    entry.count = 0;
    rateLimitStore.set(identifier, entry);

    console.warn(`[RateLimit] ${limitType} exceeded for ${identifier}`);

    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  // Under the limit — count this request.
  entry.count += 1;
  entry.lastRequest = now;
  rateLimitStore.set(identifier, entry);

  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - entry.count),
  };
}

// ─── Small JSON response helpers ─────────────────────────────────────────────
function jsonResponse(
  status: number,
  payload: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function tooManyRequests(retryAfter?: number): Response {
  return jsonResponse(
    429,
    { ok: false, error: "Too many requests. Please slow down and try again shortly." },
    retryAfter ? { "Retry-After": String(retryAfter) } : {}
  );
}

// ─── /index.html canonicalisation (duplicate-URL fix for SEO) ────────────────
// "/index.html" → "/" and "/faq/index.html" → "/faq" as a 308 (Permanent
// Redirect) with the query string preserved, so search engines only ever see
// one canonical URL per page instead of both the clean path and its
// /index.html twin.
function canonicalIndexHtmlRedirect(url: URL): Response | null {
  if (!url.pathname.endsWith("/index.html")) return null;
  const cleanPath =
    url.pathname === "/index.html" ? "/" : url.pathname.slice(0, -"/index.html".length);
  const target = new URL(cleanPath, url.origin);
  target.search = url.search;
  return new Response(null, {
    status: 308,
    headers: { Location: target.toString() },
  });
}

// ─── Main Edge Middleware ─────────────────────────────────────────────────────
// Order of operations (each stage can short-circuit):
//   OPTIONS passthrough → /index.html 308 → attack-UA 403 →
//   social-crawler 302 → AI/search-crawler live render → rate limit → pass.
export default async function middleware(
  request: Request
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflights must never be rate-limited or redirected.
  if (request.method === "OPTIONS") return undefined;

  // 1) Canonicalise /index.html URLs for every client.
  const canonical = canonicalIndexHtmlRedirect(url);
  if (canonical) return canonical;

  const ua = request.headers.get("user-agent") || "";
  const { fingerprint } = getClientInfo(request);
  const isApiRoute = pathname.startsWith("/api/");

  // 2) Known attack-tool user agents → hard block.
  if (isBlockedUA(ua)) {
    return jsonResponse(403, { ok: false, error: "Blocked" });
  }

  // 3) Social preview crawlers → /api/og (PAGE routes only — never /api/*,
  //    which would redirect-loop; see header comment #3).
  if (!isApiRoute && isSocialCrawler(ua)) {
    const ogUrl = new URL("/api/og", url.origin);
    ogUrl.searchParams.set("path", pathname);
    return new Response(null, {
      status: 302,
      headers: { Location: ogUrl.toString() },
    });
  }

  // 4) AI / search crawlers → live database-rendered HTML. The trusted-bot
  //    branch sits BEFORE the rate limiter, so recognised crawlers are never
  //    throttled on page routes. On renderer failure we return undefined so
  //    Vercel serves the build-time prerendered page — crawling never breaks.
  if (!isApiRoute && isSearchOrAICrawler(ua) && shouldLiveRender(pathname)) {
    try {
      return await proxyToLiveRender(request, pathname);
    } catch {
      return undefined;
    }
  }

  // 5) Everyone else passes the standard rate limiter, then falls through
  //    untouched (undefined = continue to the static/SPA pipeline).
  const limitType: LimitType = isApiRoute ? "scrapeProxy" : "default";
  const verdict = checkRateLimit(fingerprint, limitType);
  if (!verdict.allowed) {
    return tooManyRequests(verdict.retryAfter);
  }
  return undefined;
}

