// embedMedia.ts — universal link-embed engine for the Gallery.
//
// The admin pastes a Facebook post / video / reel / watch / share link (or a
// YouTube link) into Admin Gallery → this module detects WHAT it is and builds
// the official embed URL so the site renders it natively, with its real
// thumbnail, inside our own pages (no new tabs, no external navigation).
//
// Embedded media is stored in gallery_photos as an ordinary row: 
//   photo_url  = the ORIGINAL pasted link (facebook.com/… / youtu.be/…)
//   media_type = "video"
// so NO database migration is needed and every consumer (public gallery,  
// admin grid, student dashboard) detects the provider from the URL itself.

export type EmbedProvider = "facebook" | "youtube";
export type EmbedKind = "video" | "post";

export interface EmbedInfo {
  provider: EmbedProvider;
  kind: EmbedKind;
  /** Human label shown in the admin panel, e.g. "Facebook Reel". */
  label: string;
  /** Short grid-badge text: VIDEO / REEL / POST. */
  badge: string;
  /** Ready-to-use iframe src (official FB plugin / privacy-enhanced YT). */
  embedUrl: string;
  /** width ÷ height of the natural player, for aspect-ratio containers. */
  aspect: number;
  originalUrl: string;
}

/** allow= attribute required by FB/YouTube iframe players (inline playback). */
export const EMBED_IFRAME_ALLOW =
  "autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";

const FB_HOST = /^(?:[a-z0-9-]+\.)*facebook\.com$/i;
const FB_SHORT_HOST = /^(?:fb\.watch|fb\.me|fb\.gg)$/i;

/**
 * Trim, add https:// when missing and normalise mobile hosts
 * (m./web./mbasic./touch. facebook → www.; m./music. youtube → www.)
 * so the same pasted link always produces the same stored URL.
 */
export function normalizeMediaUrl(raw: string): string {
  let url = (raw || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url.replace(/^\/+/, "");
  try {
    const u = new URL(url);
    if (FB_HOST.test(u.hostname)) u.hostname = "www.facebook.com";
    if (/^(?:m|music)\.youtube\.com$/i.test(u.hostname))
      u.hostname = "www.youtube.com";
    return u.toString();
  } catch {
    return url;
  }
}

/* ─────────────────────────── YouTube ─────────────────────────── */

function parseYouTube(
  u: URL
): { id: string; short: boolean; live: boolean } | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const isYt =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com";
  if (!isYt) return null;

  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0] || "";
    return /^[\w-]{6,}$/.test(id) ? { id, short: false, live: false } : null;
  }
  if (u.pathname === "/watch" || u.pathname === "/watch/") {
    const id = u.searchParams.get("v") || "";
    return /^[\w-]{6,}$/.test(id)
      ? { id, short: false, live: false }
      : null;
  }
  const m = u.pathname.match(/\/(shorts|embed|v|live)\/([\w-]{6,})/);
  if (m) return { id: m[2], short: m[1] === "shorts", live: m[1] === "live" };
  return null;
}

/* ─────────────────────────── Facebook ─────────────────────────── */

function buildFbEmbed(
  originalUrl: string,
  kind: EmbedKind,
  label: string,
  badge: string
): EmbedInfo {
  const enc = encodeURIComponent(originalUrl);
  const embedUrl =
    kind === "video"
      ? `https://www.facebook.com/plugins/video.php?href=${enc}&show_text=false&width=560`
      : `https://www.facebook.com/plugins/post.php?href=${enc}&show_text=false&width=500&adaptive=true`;
  return {
    provider: "facebook",
    kind,
    label,
    badge,
    embedUrl,
    aspect: kind === "video" ? 16 / 9 : 4 / 5,
    originalUrl,
  };
}

function parseFacebook(u: URL, originalUrl: string): EmbedInfo | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  // fb.watch / fb.me short links
  if (!FB_HOST.test(u.hostname)) {
    if (FB_SHORT_HOST.test(u.hostname)) {
      // fb.watch → video share; fb.me → post/page share
      return host === "fb.watch"
        ? buildFbEmbed(originalUrl, "video", "Facebook Video", "VIDEO")
        : buildFbEmbed(originalUrl, "post", "Facebook Post", "POST");
    }
    return null;
  }

  const p = u.pathname;
  const hasVidParam = p === "/watch" || p.startsWith("/watch/");

  // VIDEO family (play with the official video plugin, 16:9)
  if (
    /\/reels?\//.test(p) ||
    /\/share\/r\//.test(p) ||
    /\/videos?\//.test(p) ||
    /\/share\/v\//.test(p) ||
    hasVidParam ||
    /\/live\//.test(p) ||
    /\/video\.php/.test(p)
  ) {
    const isReel = /\/reels?\//.test(p) || /\/share\/r\//.test(p);
    return buildFbEmbed(
      originalUrl,
      "video",
      isReel ? "Facebook Reel" : "Facebook Video",
      isReel ? "REEL" : "VIDEO"
    );
  }

  // POST family (play with the official post plugin, 4:5 card)
  if (
    /\/posts?\//.test(p) ||
    /\/permalink\.php/.test(p) ||
    /\/story\.php/.test(p) ||
    /\/photo(\.php)?($|\/)/.test(p) ||
    u.searchParams.has("fbid") ||
    /\/share\/p\//.test(p) ||
    /\/groups\//.test(p) ||
    /\/share\//.test(p) || // generic share codes, e.g. /share/1EERTSk1W7/
    /\/(events|notes|questions)\//.test(p)
  ) {
    return buildFbEmbed(originalUrl, "post", "Facebook Post", "POST");
  }

  // Any other facebook.com URL — best effort as a post embed (the admin
  // sees a live preview before saving, so nothing is ever a guess).
  return buildFbEmbed(originalUrl, "post", "Facebook Post", "POST");
}

/* ─────────────────────────── Public API ─────────────────────────── */

/**
 * Detect a Facebook / YouTube link and return everything needed to embed it.
 * Returns null for any other URL (direct Cloudinary files stay images/videos).
 */
export function getEmbedInfo(rawUrl: string): EmbedInfo | null {
  const url = normalizeMediaUrl(rawUrl);
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const yt = parseYouTube(u);
  if (yt) {
    const label = yt.short
      ? "YouTube Short"
      : yt.live
        ? "YouTube Live"
        : "YouTube Video";
    return {
      provider: "youtube",
      kind: "video",
      label,
      badge: "VIDEO",
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt.id}?rel=0&modestbranding=1&playsinline=1`,
      aspect: yt.short ? 9 / 16 : 16 / 9,
      originalUrl: url,
    };
  }

  return parseFacebook(u, url);
}

export const isEmbedUrl = (url: string): boolean => !!getEmbedInfo(url);

/* ───────────── Share-link → canonical resolution (Facebook) ───────────── */

// Facebook SHARE links (facebook.com/share/v|p|r/<code>, /share/<code>,
// fb.watch/…, fb.me/…) are redirect shortcuts. Facebook's official embed
// plugins cannot follow them and render "Video Unavailable" instead. The
// browser can't follow the redirect either (CORS), so resolveMediaUrl()
// asks our tiny serverless endpoint /api/resolve-fb to follow it
// server-side and return the canonical permalink to embed.

const FB_SHARE_PATH_RE = /^\/share\/(?:v|r|p)\/|^\/share\/[^/]+\/?$/;
const FB_SHORT_HOSTS = /^(?:fb\.watch|fb\.me)$/i;

/** True when this URL is a Facebook share/short link OR a /watch/?v= link
 *  that must be resolved to its canonical .../videos/<id>/ permalink before
 *  it can be embedded. plugins/video.php frequently rejects /watch/?v= URLs
 *  with "Video Unavailable" even for fully public Page videos. */
export function needsCanonicalResolve(rawUrl: string): boolean {
  const url = normalizeMediaUrl(rawUrl);
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase().replace(/^www\./, "") !== "facebook.com")
      return FB_SHORT_HOSTS.test(u.hostname);
    if (/^\/watch\/?$/.test(u.pathname) && u.searchParams.has("v")) return true;
    return FB_SHARE_PATH_RE.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Resolution verdict for a media URL:
 *  - url          → best URL to embed (canonical when resolved)
 *  - embeddable   → false when FACEBOOK ITSELF rejects the link (deleted
 *                   post, broken share code, or non-public video). In that
 *                   case NO embed can work — the UI shows a clean
 *                   "watch on Facebook" card instead of FB's error box.
 *  - reason       → why it failed: "not_found" | "private" | "unresolved"
 */
export interface ResolvedMedia {
  url: string;
  embeddable: boolean;
  reason?: "not_found" | "private" | "unresolved";
}

const RESOLVE_CACHE_KEY = "ghsbk-fb-canonical-v1";
const resolveMemory = new Map<string, ResolvedMedia>();
const resolveInFlight = new Map<string, Promise<ResolvedMedia>>();

function cacheGet(key: string): ResolvedMedia | undefined {
  if (resolveMemory.has(key)) return resolveMemory.get(key);
  try {
    const store = JSON.parse(sessionStorage.getItem(RESOLVE_CACHE_KEY) || "{}");
    const v = store[key];
    if (v && typeof v.url === "string" && typeof v.embeddable === "boolean") {
      resolveMemory.set(key, v);
      return v;
    }
  } catch { /* private mode / disabled storage */ }
  return undefined;
}

function cacheSet(key: string, value: ResolvedMedia): void {
  resolveMemory.set(key, value);
  try {
    const store = JSON.parse(sessionStorage.getItem(RESOLVE_CACHE_KEY) || "{}");
    store[key] = value;
    sessionStorage.setItem(RESOLVE_CACHE_KEY, JSON.stringify(store));
  } catch { /* ignore quota errors */ }
}

const RESOLVE_TIMEOUT_MS = 7000;

/**
 * Resolve a gallery media URL to its best embeddable form, with a verdict:
 *  - Facebook share links → canonical permalink via /api/resolve-fb
 *    (cached per session; results edge-cached server-side).
 *  - If FACEBOOK rejects the link (HTTP 400/404 on the share code, login
 *    redirect for non-public videos, unresolvable codes) → embeddable:false
 *    so the player can show a friendly fallback instead of FB's error box.
 *  - Network errors / timeouts → the original URL marked embeddable, so
 *    behaviour degrades to exactly the pre-resolver player (never blocks).
 */
export async function resolveMediaInfo(rawUrl: string): Promise<ResolvedMedia> {
  const url = normalizeMediaUrl(rawUrl);
  if (!url || !needsCanonicalResolve(url)) return { url, embeddable: true };

  const cached = cacheGet(url);
  if (cached) return cached;

  const existing = resolveInFlight.get(url);
  if (existing) return existing;

  const task = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS);
      const r = await fetch(`/api/resolve-fb?url=${encodeURIComponent(url)}`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        if (j?.ok && typeof j.canonical === "string" && j.canonical) {
          const result: ResolvedMedia = { url: j.canonical as string, embeddable: true };
          cacheSet(url, result);
          return result;
        }
        if (j && j.ok === false) {
          const reason =
            j.reason === "private" || j.reason === "not_found" || j.reason === "unresolved"
              ? (j.reason as ResolvedMedia["reason"])
              : "unresolved";
          const result: ResolvedMedia = { url, embeddable: false, reason };
          cacheSet(url, result);
          return result;
        }
      }
    } catch { /* offline, cold start, timeout */ }
    return { url, embeddable: true } as ResolvedMedia; // graceful fallback — old behaviour
  })();

  resolveInFlight.set(url, task);
  try {
    return await task;
  } finally {
    resolveInFlight.delete(url);
  }
}

/** Convenience wrapper — just the best embeddable URL (legacy callers). */
export async function resolveMediaUrl(rawUrl: string): Promise<string> {
  return (await resolveMediaInfo(rawUrl)).url;
}

/** Real static thumbnail for YouTube embeds (grid cards, no iframe needed). */
export function youTubeThumbnail(url: string): string | null {
  const info = getEmbedInfo(url);
  if (!info || info.provider !== "youtube") return null;
  const m = info.embedUrl.match(/\/embed\/([\w-]+)/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` : null;
}
