import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Camera,
  Play,
  WifiOff,
  RefreshCw,
  Images,
  ArrowRight,
  Image as ImageIcon,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import {
  useGalleryAlbums,
  useGalleryPhotos,
  useAlbumPhotoCount,
  useAlbumFallbackCover,
  isVideoUrl,
  type GalleryAlbum,
  type GalleryPhoto,
} from "@/hooks/useGallery";
import { getEmbedInfo, youTubeThumbnail } from "@/lib/embedMedia";
import EmbedFrame from "@/components/shared/EmbedFrame";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

/* ────────────────────── shared bits ────────────────────── */

const PlayOverlay = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-primary-dark/15 pointer-events-none">
    <div className="w-11 h-11 rounded-full bg-black/50 border border-white/35 flex items-center justify-center shadow-elevated">
      <Play className="w-5 h-5 text-white ml-0.5" />
    </div>
  </div>
);

/** Grid-card content for any album item: photo, uploaded video, FB post/video or YouTube. */
const MediaThumb = ({ photo }: { photo: GalleryPhoto }) => {
  const embed = getEmbedInfo(photo.photo_url);
  const ytThumb =
    embed?.provider === "youtube" ? youTubeThumbnail(photo.photo_url) : null;
  const nativeVideo =
    !embed && (photo.media_type === "video" || isVideoUrl(photo.photo_url));

  if (embed) {
    if (ytThumb) {
      return (
        <>
          <img
            src={ytThumb}
            alt={photo.caption || embed.label}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
          <PlayOverlay />
        </>
      );
    }
    // Facebook post / video / reel — official player as the live thumbnail.
    return (
      <EmbedFrame
        url={photo.photo_url}
        title={embed.label}
        className="absolute inset-0 w-full h-full"
      />
    );
  }

  if (nativeVideo) {
    return (
      <>
        <video
          src={photo.photo_url}
          preload="metadata"
          playsInline
          className="w-full h-full object-cover"
        />
        <PlayOverlay />
      </>
    );
  }

  return (
    <img
      src={photo.photo_url}
      alt={photo.caption || "Photo"}
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
    />
  );
};

const mediaBadge = (photo: GalleryPhoto): string | null => {
  const embed = getEmbedInfo(photo.photo_url);
  if (embed) return embed.badge; // VIDEO / REEL / POST
  if (photo.media_type === "video" || isVideoUrl(photo.photo_url)) return "VIDEO";
  return null;
};

/** Album card with a live item counter (per-card hook, avoids N+1 in the list).
 *  Premium editorial tile: full-bleed cover, title + meta overlaid on a soft
 *  gradient, hairline gold accent, thin "View" pill. Titles wrap (never cut). */
const AlbumCard = ({
  album,
  index,
  onOpen,
  featured = false,
}: {
  album: GalleryAlbum;
  index: number;
  onOpen: () => void;
  featured?: boolean;
}) => {
  const { data: count } = useAlbumPhotoCount(album.id);
  const { data: fallbackCover } = useAlbumFallbackCover(album.id, !album.cover_url);
  const mediaCls =
    "absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105";
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: Math.min(index * 0.05, 0.3), duration: 0.45 }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={`Open album ${album.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative overflow-hidden rounded-2xl bg-secondary shadow-card hover:shadow-elevated ring-1 ring-border hover:ring-gold/50 transition-all duration-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
        featured
          ? "aspect-[4/3] sm:aspect-[16/9] sm:col-span-2 lg:row-span-2 lg:aspect-auto lg:min-h-[26rem]"
          : "aspect-[4/3]"
      }`}
    >
      {album.cover_url ? (
        <img src={album.cover_url} alt={album.title} loading="lazy" decoding="async" className={mediaCls} />
      ) : fallbackCover?.isVideo ? (
        <video src={fallbackCover.url} preload="metadata" playsInline muted className={mediaCls} />
      ) : fallbackCover?.url ? (
        <img src={fallbackCover.url} alt={album.title} loading="lazy" decoding="async" className={mediaCls} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Camera className="w-10 h-10 text-muted-foreground/40" />
        </div>
      )}

      {/* readability gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* item counter */}
      {typeof count === "number" && (
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-0.5 border border-white/15">
          <Images className="w-3 h-3" />
          {count} {count === 1 ? "item" : "items"}
        </div>
      )}

      {/* caption block */}
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <h3
          className={`font-heading font-semibold text-white leading-snug break-words line-clamp-2 ${
            featured ? "text-lg sm:text-2xl" : "text-base sm:text-lg"
          }`}
        >
          {album.title}
        </h3>
        {album.description && (
          <p className="mt-1 text-xs sm:text-[13px] text-white/75 line-clamp-2 leading-relaxed">
            {album.description}
          </p>
        )}
        <span className="mt-3 inline-flex h-7 items-center gap-1 rounded-full border border-white/30 bg-white/10 backdrop-blur-sm px-3 text-[11px] font-medium text-white transition-colors group-hover:bg-gold group-hover:border-gold group-hover:text-gold-ink">
          View album <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </motion.div>
  );
};

/* ────────────────────── page ────────────────────── */

const Gallery = () => {
  const {
    data: albums = [],
    isLoading,
    isError: albumsError,
    refetch: refetchAlbums,
  } = useGalleryAlbums();
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const {
    data: photos = [],
    isLoading: photosLoading,
    isError: photosError,
    refetch: refetchPhotos,
  } = useGalleryPhotos(selectedAlbumId);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const selectedAlbum = albums.find((a) => a.id === selectedAlbumId);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevPhoto = useCallback(() => {
    setLightboxIndex((i) => (i !== null && i > 0 ? i - 1 : i));
  }, []);
  const nextPhoto = useCallback(() => {
    setLightboxIndex((i) =>
      i !== null && i < photos.length - 1 ? i + 1 : i
    );
  }, [photos.length]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightboxIndex === null) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") prevPhoto();
      if (e.key === "ArrowRight") nextPhoto();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, closeLightbox, prevPhoto, nextPhoto]);

  // Lock background scroll while the lightbox is open
  useEffect(() => {
    if (lightboxIndex === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxIndex]);

  const activePhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;
  const activeEmbed = activePhoto ? getEmbedInfo(activePhoto.photo_url) : null;
  const activeIsVideo =
    activePhoto &&
    !activeEmbed &&
    (activePhoto.media_type === "video" || isVideoUrl(activePhoto.photo_url));

  return (
    <PageLayout>
      <PageBanner
        title="Photo Gallery"
        subtitle="Photos, videos & memorable moments at GHS Babi Khel"
      />

      <section className="py-10 md:py-16">
        <div className="container mx-auto px-4">
          {!selectedAlbumId && (
            <div className="mb-8 md:mb-10 text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-strong dark:text-gold">
                <span className="w-1.5 h-1.5 rotate-45 bg-gold" /> Moments &amp; Memories
              </span>
              <h2 className="mt-3 font-heading text-2xl sm:text-3xl font-bold text-foreground">
                Life at GHS Babi Khel
              </h2>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold/70" />
                <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
                <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold/70" />
              </div>
              {!isLoading && albums.length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {albums.length} {albums.length === 1 ? "album" : "albums"} · tap any album to explore
                </p>
              )}
            </div>
          )}
          {selectedAlbumId && (
            <div className="mb-6 border-b border-border pb-4">
              <button
                onClick={() => setSelectedAlbumId(null)}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card pl-2.5 pr-3.5 text-xs font-medium text-foreground hover:border-gold/60 hover:text-primary transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> All Albums
              </button>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {selectedAlbum && (
                  <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground leading-snug break-words">
                    {selectedAlbum.title}
                  </h2>
                )}
                {!photosLoading && (
                  <Badge variant="secondary" className="text-[11px] font-medium px-2.5 py-0.5">
                    {photos.length} {photos.length === 1 ? "item" : "items"}
                  </Badge>
                )}
              </div>
              {selectedAlbum?.description && (
                <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{selectedAlbum.description}</p>
              )}
            </div>
          )}

          {!selectedAlbumId ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-[4/3] rounded-2xl overflow-hidden"
                    >
                      <Skeleton className="w-full h-full" />
                    </div>
                  ))
                : albumsError && !albums.length
                  ? (
                    <div className="col-span-full text-center py-20">
                      <div className="w-16 h-16 rounded-full bg-gold-soft dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
                        <WifiOff className="w-8 h-8 text-amber-600" />
                      </div>
                      <p className="font-semibold text-foreground text-lg">
                        Can't load gallery
                      </p>
                      <p className="text-sm text-muted-foreground mt-1 mb-4">
                        You appear to be offline. Albums you've visited before
                        will load from cache.
                      </p>
                      <button
                        onClick={() => refetchAlbums()}
                        className="inline-flex h-9 items-center gap-1.5 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Try Again
                      </button>
                    </div>
                  )
                  : albums.map((album, i) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        index={i}
                        featured={i === 0 && albums.length > 2}
                        onOpen={() => setSelectedAlbumId(album.id)}
                      />
                    ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 md:gap-4">
                {photosLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square rounded-xl" />
                    ))
                  : photosError && !photos.length
                    ? (
                      <div className="col-span-full text-center py-16">
                        <div className="w-16 h-16 rounded-full bg-gold-soft dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
                          <WifiOff className="w-8 h-8 text-amber-600" />
                        </div>
                        <p className="font-semibold text-foreground">
                          Can't load photos
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 mb-4">
                          You appear to be offline.
                        </p>
                        <button
                          onClick={() => refetchPhotos()}
                          className="inline-flex h-9 items-center gap-1.5 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Try Again
                        </button>
                      </div>
                    )
                    : photos.map((photo, i) => {
                        const badge = mediaBadge(photo);
                        return (
                          <motion.div
                            key={photo.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true, margin: "-20px" }}
                            transition={{ delay: Math.min(i * 0.03, 0.3) }}
                            onClick={() => setLightboxIndex(i)}
                            role="button"
                            tabIndex={0}
                            aria-label={badge ? `Open ${badge.toLowerCase()}` : "Open photo"}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setLightboxIndex(i);
                              }
                            }}
                            className="aspect-square rounded-xl overflow-hidden cursor-pointer group relative bg-secondary shadow-card hover:shadow-elevated ring-1 ring-border hover:ring-gold/60 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                          >
                            <MediaThumb photo={photo} />
                            {badge && (
                              <Badge className="absolute top-2 left-2 z-10 bg-black/55 backdrop-blur-sm text-white text-[10px] font-medium gap-1 px-2 py-0.5 border border-white/10">
                                <Play className="w-3 h-3" />
                                {badge}
                              </Badge>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                            {photo.caption && (
                              <p className="absolute inset-x-0 bottom-0 p-2.5 text-[11px] leading-snug text-white line-clamp-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                                {photo.caption}
                              </p>
                            )}
                          </motion.div>
                        );
                      })}
              </div>

              {!photosLoading && photos.length === 0 && (
                <div className="text-center py-16 bg-card rounded-2xl shadow-card ring-1 ring-border">
                  <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    No photos in this album yet.
                  </p>
                </div>
              )}
            </>
          )}

          {!selectedAlbumId && !isLoading && albums.length === 0 && (
            <div className="text-center py-16 bg-card rounded-2xl shadow-card ring-1 ring-border">
              <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No albums yet.</p>
            </div>
          )}
        </div>
      </section>

      {/* ───────────── Premium Lightbox — everything plays inline ───────────── */}
      <AnimatePresence>
        {activePhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={(e) => {
              // Only close when the tap/click lands on the backdrop itself —
              // never when it bubbles up from the video/image/iframe content
              // (native <video> controls and embedded iframes can dispatch
              // events in ways that stopPropagation on the inner wrapper
              // doesn't always catch on mobile browsers, which was closing
              // the viewer while someone was just tapping play/pause/seek).
              if (e.target === e.currentTarget) closeLightbox();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Media viewer"
            style={{
              // Neutral near-black backdrop — theme-independent, so it never
              // tints gold (dark theme) or green (light/system theme).
              background:
                "linear-gradient(180deg, rgba(8,8,10,0.97), rgba(2,2,3,0.98))",
            }}
          >
            {/* top chrome */}
            <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 z-20">
              <span className="rounded-full bg-white/10 text-white/90 text-[11px] font-medium px-3 py-1 tabular-nums border border-white/10">
                {lightboxIndex! + 1} / {photos.length}
              </span>
              <button
                onClick={closeLightbox}
                aria-label="Close viewer"
                className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {lightboxIndex! > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  prevPhoto();
                }}
                aria-label="Previous"
                className="absolute left-3 md:left-5 h-9 w-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-20 border border-white/10"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}

            {lightboxIndex! < photos.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  nextPhoto();
                }}
                aria-label="Next"
                className="absolute right-3 md:right-5 h-9 w-9 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-20 border border-white/10"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            <motion.div
              key={lightboxIndex}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="flex flex-col items-center gap-3 p-4 md:p-10 max-w-full"
            >
              {activeEmbed ? (
                /* Facebook / YouTube — official player, inline, never a new tab */
                <div
                  className="relative rounded-2xl overflow-hidden bg-black shadow-elevated"
                  style={{
                    aspectRatio: String(activeEmbed.aspect),
                    width: `min(94vw, ${(78 * activeEmbed.aspect).toFixed(2)}vh)`,
                  }}
                >
                  <EmbedFrame
                    url={activePhoto.photo_url}
                    interactive
                    title={activeEmbed.label}
                    className="absolute inset-0 w-full h-full"
                  />
                </div>
              ) : activeIsVideo ? (
                <video
                  key={activePhoto.photo_url}
                  src={activePhoto.photo_url}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-[78vh] w-auto rounded-2xl bg-black shadow-elevated"
                />
              ) : (
                <img
                  src={activePhoto.photo_url}
                  alt={activePhoto.caption || "Photo"}
                  className="max-w-full max-h-[78vh] object-contain rounded-2xl shadow-elevated"
                />
              )}
              {activePhoto.caption && (
                <p className="text-white/85 text-sm text-center max-w-[80vw]">
                  {activePhoto.caption}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
};

export default Gallery;
