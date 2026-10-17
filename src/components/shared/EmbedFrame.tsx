// EmbedFrame.tsx — shared iframe wrapper for embedded Facebook / YouTube media.
//
// The PARENT owns sizing: pass className="absolute inset-0 w-full h-full"
// inside an aspect-ratio container (grid card, lightbox stage, admin preview).
//
// interactive=false → hover-through live thumbnail preview (pointer-events
// disabled so the card's own click opens the lightbox — no accidental
// navigation, nothing opens in a new tab).
// interactive=true  → full player (lightbox / admin preview), still 100%
// inline inside our page.
//
// FACEBOOK SHARE LINKS: a pasted /share/… link is a redirect shortcut that
// Facebook's own embed plugin cannot display. Before rendering the iframe we
// resolve such links to their canonical permalink via /api/resolve-fb
// (cached per session + edge). This fixes the admin preview, the public
// gallery AND every album row that was saved with a share link.
//
// REJECTED LINKS: when FACEBOOK ITSELF refuses the link (deleted post,
// broken/truncated share code, or a video that is not Public), it is
// impossible for ANY website to embed it. Instead of showing Facebook's ugly
// "Video Unavailable" error box, we render a clean fallback card with a
// "Watch on Facebook" button so visitors are never stuck on an error.
// Pass showReason (admin contexts) for the fix-it hint text.

import { memo, useEffect, useState } from "react";
import { getEmbedInfo, EMBED_IFRAME_ALLOW, resolveMediaInfo, type ResolvedMedia } from "@/lib/embedMedia";
import { Loader2, ExternalLink, VideoOff } from "lucide-react";

interface EmbedFrameProps {
  url: string;
  interactive?: boolean;
  title?: string;
  className?: string;
  /** Admin contexts: explain WHY the video can't play + how to fix it. */
  showReason?: boolean;
}

const REASON_TEXT: Record<string, string> = {
  not_found: "Facebook no longer recognises this link — re-copy it from the post's ··· menu on Facebook, then embed it again.",
  private: "This video is not Public on Facebook. Set its audience to Public (private or friends-only videos cannot be embedded on any website).",
  unresolved: "This share link can't be converted to a direct Facebook link. Copy the link from the post's ··· menu instead.",
};

const EmbedFrame = ({
  url,
  interactive = false,
  title = "Embedded video",
  className,
  showReason = false,
}: EmbedFrameProps) => {
  const [media, setMedia] = useState<ResolvedMedia | null>(null);

  useEffect(() => {
    let alive = true;
    setMedia(null);
    resolveMediaInfo(url)
      .then((r) => {
        if (alive) setMedia(r);
      })
      .catch(() => {
        if (alive) setMedia({ url, embeddable: true });
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // Resolving (share links only — direct URLs resolve in the same tick).
  if (media === null) {
    return (
      <div className={className} style={{ border: 0, pointerEvents: "none" }} aria-label="Loading video">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-white/80">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-[11px] font-medium">Loading video…</span>
        </div>
      </div>
    );
  }

  // Facebook itself rejected this link → a friendly card, never FB's error box.
  if (!media.embeddable) {
    return (
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className ?? ""} flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#1877F2]/95 to-[#0b5fce]/95 text-white text-center p-4 no-underline select-none`}
        style={{ border: 0, pointerEvents: interactive ? "auto" : "none" }}
        aria-label="This video plays on Facebook — tap to watch it there"
      >
        <span className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0">
          <VideoOff className="w-5 h-5" />
        </span>
        <span className="text-sm font-semibold leading-tight">Video plays on Facebook</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-white text-[#0b5fce] rounded-full px-3 py-1.5">
          <ExternalLink className="w-3.5 h-3.5" /> Watch there
        </span>
        {showReason && media.reason && (
          <span className="text-[11px] leading-snug text-white/85 mt-1 max-w-[280px]">
            {REASON_TEXT[media.reason]}
          </span>
        )}
      </a>
    );
  }

  const info = getEmbedInfo(media.url) || getEmbedInfo(url);
  if (!info) return null;
  return (
    <iframe
      src={info.embedUrl}
      title={title}
      loading="lazy"
      allow={EMBED_IFRAME_ALLOW}
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className={className}
      style={{ border: 0, pointerEvents: interactive ? "auto" : "none" }}
    />
  );
};

export default memo(EmbedFrame);
