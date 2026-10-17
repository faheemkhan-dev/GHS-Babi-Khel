// api/resolve-fb.js
// Vercel Serverless Function — resolves Facebook SHARE links
// (facebook.com/share/v/… , /share/r/… , /share/p/… , /share/<code>,
//  fb.watch/… , fb.me/…) into the CANONICAL permalink URL that Facebook's
// official embed plugins (plugins/video.php / plugins/post.php) actually
// accept.
//
// WHY THIS EXISTS
//   When the admin pastes a Facebook *share* link into Admin Gallery, the
//   embed plugins render Facebook's own "Video Unavailable — this video may
//   no longer exist, or you don't have permission to view it" box, both in
//   the admin live preview and on the public gallery. Share links are
//   redirect shortcuts; the plugin requires the real permalink (e.g.
//   facebook.com/<page>/videos/<id>/ or facebook.com/watch/?v=<id>).
//   The browser cannot follow that redirect itself (CORS + no cookies), so
//   this serverless function follows it server-side and returns the
//   canonical URL.
//
// WHAT IT RETURNS (JSON)
//   ok: true   → { ok, canonical, resolved: boolean }
//                canonical = cleaned, embeddable URL (share links resolved
//                when Facebook redirects; otherwise the cleaned original).
//   ok: false  → { ok: false, reason, message }
//                reason: "invalid" | "not_found" | "private" | "unresolved"
//                with an admin-friendly `message` for each case.
//
// CACHING
//   Facebook share redirects never change for a given code, so responses are
//   edge-cached (s-maxage=1 day + stale-while-revalidate) to keep function
//   invocations low. The client additionally caches per session.
//
// SECURITY
//   - Strict host allow-list (facebook.com, fb.watch, fb.me) — no SSRF.
//   - Outbound requests capped (6 redirect hops, 8 s timeout, response body
//     never read beyond a 64 KB slice for og:url extraction).
//   - No Facebook login, tokens or cookies are used or accepted.

const ALLOWED_HOST_RE = /^(?:[a-z0-9-]+\.)*facebook\.com$|^(?:fb\.watch|fb\.me)$/i;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HOPS = 6;
const TIMEOUT_MS = 8000;

/** Tracking params Facebook appends to share redirects — safe to strip. */
const STRIP_PARAMS = new Set([
  "mibextid", "rdid", "share_url", "ext", "hrc", "ref", "refsrc", "sfnsn",
  "wtsid", "rdc", "rdr", "__cft__", "__tn__", "paipv", "av", "eav", "d",
  "comment_id", "notif_id", "notif_t", "refid", "loc",
]);

function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    // normalise mobile hosts → www
    if (/^(?:m|web|mbasic|touch)\.facebook\.com$/i.test(u.hostname))
      u.hostname = "www.facebook.com";
    for (const p of [...u.searchParams.keys()])
      if (STRIP_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p);
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

function isFacebookHost(hostname) {
  return ALLOWED_HOST_RE.test(hostname);
}

/** Does this URL need a redirect-follow to become embeddable?
 *  NOTE: /watch/?v=<id> is NOT a canonical permalink — Facebook's
 *  plugins/video.php frequently rejects it with "Video Unavailable" even
 *  for fully public Page videos. It must be resolved (its HTML og:url
 *  points at the real .../videos/<id>/ permalink) just like share links. */
function needsResolution(u) {
  const h = u.hostname.toLowerCase();
  if (h === "fb.watch" || h === "fb.me") return true;
  const p = u.pathname;
  if (/^\/watch\/?$/.test(p) && u.searchParams.has("v")) return true;
  return /^\/share\/(?:v|r|p)\/|^\/share\/[^/]+\/?$/.test(p);
}

/** Is this URL already a canonical, plugin-friendly permalink? */
function looksCanonical(u) {
  const p = u.pathname;
  return (
    /\/videos?\//.test(p) ||
    /\/reels?\//.test(p) ||
    /\/posts?\//.test(p) ||
    /\/permalink\.php/.test(p) ||
    /\/story\.php/.test(p) ||
    /\/photo(\.php)?($|\/)/.test(p) ||
    /\/live\//.test(p) ||
    /\/video\.php/.test(p) ||
    /\/groups\/[^/]+\/(?:posts|videos|permalink)\//.test(p)
  );
}

async function followRedirects(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch {
      clearTimeout(timer);
      return { status: 0, url: current, location: null, body: null };
    }
    clearTimeout(timer);

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).toString();
      if (!isFacebookHost(new URL(next).hostname))
        return { status: res.status, url: current, location: next, body: null, external: true };
      current = next;
      continue;
    }
    // 200 (or unexpected status) — decide caller-side; hand back a small
    // body slice so the caller can look for og:url on bot-wall responses.
    let body = null;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        body = value ? Buffer.from(value).toString("utf8", 0, 65536) : null;
        try { await reader.cancel(); } catch { /* ignore */ }
      }
    } catch { /* body optional */ }
    return { status: res.status, url: current, location: null, body };
  }
  return { status: 0, url: current, location: null, body: null, tooManyHops: true };
}

function ogUrlFromHtml(html) {
  if (!html) return null;
  const m =
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i);
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return isFacebookHost(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, reason: "invalid", message: "GET only" });

  const raw = (req.query.url || "").toString().trim();
  if (!raw || raw.length > 2048)
    return res.status(400).json({ ok: false, reason: "invalid", message: "Missing or too-long url parameter" });

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/+/, ""));
  } catch {
    return res.status(400).json({ ok: false, reason: "invalid", message: "Not a valid URL" });
  }
  if (!isFacebookHost(u.hostname))
    return res.status(400).json({ ok: false, reason: "invalid", message: "Only Facebook links can be resolved" });

  const original = cleanUrl(u.toString());

  // Canonical already? Clean tracking params and return immediately —
  // zero outbound requests for already-embeddable links.
  if (!needsResolution(u) || looksCanonical(u)) {
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ ok: true, canonical: original, resolved: false });
  }

  // Share link → follow Facebook's redirect chain server-side.
  const out = await followRedirects(original);
  const finalUrl = out.location || out.url;
  let candidate = finalUrl;

  // Bot-wall / no-redirect case (share links AND /watch/?v= links serve a
  // 200 HTML page rather than a redirect): try og:url out of the body slice
  // to get the real .../videos/<id>/ permalink.
  if (out.status === 200 && candidate) {
    const candPath = new URL(candidate, original).pathname;
    if (/\/share\//.test(candPath) || /^\/watch\/?$/.test(candPath))
      candidate = ogUrlFromHtml(out.body) || candidate;
  }

  let verdict;
  try {
    verdict = analyze(new URL(candidate || original), original, out);
  } catch {
    verdict = { ok: false, reason: "unresolved", message: "Could not resolve this share link to a direct Facebook link." };
  }

  if (verdict.ok) {
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(verdict);
  }
  // Don't cache failures long — the admin may fix the video's audience and retry.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res.status(200).json(verdict);
}

function analyze(finalU, original, out) {
  const host = finalU.hostname.toLowerCase();
  const path = finalU.pathname;

  // Facebook bounced us to a login wall → the post is not public
  // (or was deleted / is age- or region-restricted).
  if (/^login\./.test(host) || /^\/login(\/|$|\.php)/.test(path) || /\/login\/\?next=/.test(path) || /^www\.fb\.watch\/login/.test(host + path))
    return {
      ok: false,
      reason: "private",
      message:
        "Facebook redirects this link to a login page, so the video is not public. Open the post on Facebook and set its audience to Public (for a Page: Settings → Audience and visibility), then paste the link again. Facebook cannot embed private or friends-only videos on any website.",
    };

  if (out && (out.status === 400 || out.status === 404))
    return {
      ok: false,
      reason: "not_found",
      message:
        "Facebook rejected this link (HTTP " + out.status + "). Double-check it — the post may have been deleted or the link truncated when pasted.",
    };

  if (host !== "www.facebook.com" && host !== "facebook.com" && host !== "fb.watch" && host !== "web.facebook.com")
    return { ok: false, reason: "unresolved", message: "The share link redirected outside Facebook and cannot be embedded." };

  if (/\/share\//.test(path))
    return {
      ok: false,
      reason: "unresolved",
      message:
        "Could not resolve this share link to a direct Facebook permalink. On the post, open the ··· menu → Copy link and paste that direct link instead.",
    };

  if (/^\/watch\/?$/.test(path))
    return {
      ok: false,
      reason: "unresolved",
      message:
        "Could not resolve this /watch/ link to the video's direct permalink. Open the video on Facebook, click the timestamp/date on the post (or ··· → Copy link) to get the .../videos/<id>/ link, then paste that instead.",
    };

  return { ok: true, canonical: cleanUrl(finalU.toString()), resolved: true, original };
}
