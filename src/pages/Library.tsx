// Library.tsx — public "Digital Library" page (premium redesign)
// Same data + behaviour as before (files, videos, in-site PDF reader, video
// player). Only the presentation changed: premium hero with search, thin
// segmented switch, scrollable chips (no wrapping/cut-off), compact cards,
// thin action buttons, mobile-first bottom-sheet modals.
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";
import {
  Download, FileText, File, Play, X, Youtube, Library as LibraryIcon,
  Video as VideoIcon, ExternalLink as ExternalLinkIcon, ChevronLeft, ChevronRight, SearchX,
} from "lucide-react";
import { triggerConfetti } from "@/lib/confetti";
import PageLayout from "@/components/layout/PageLayout";
import { useLibraryFiles, useLibraryVideos, incrementDownloadCount, type LibraryFile } from "@/hooks/useLibrary";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  getYouTubeId, isVideoFileUrl,
  type VideoItem,
} from "@/pages/dashboard/tabs/VideosTab";

// Smaller YouTube thumbnail (320×180) — ~3× lighter than hqdefault on slow data
const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const fileCategories = ["All", "Past Papers", "Books", "Notes", "Assignments", "Admission", "Other"];
const classOptions = ["All", "6", "7", "8", "9", "10"];

type ContentType = "files" | "videos";

/**
 * Decides whether a pasted link can be shown inside our own site (in an
 * iframe) or must open externally.
 *  - Direct .pdf files: browsers render PDFs natively in an iframe.
 *  - archive.org/details/<id> pages: Archive.org publishes a dedicated
 *    embeddable reader at archive.org/embed/<id> specifically for iframes
 *    (documented at https://archive.org/embed/<id>) — we rewrite to that.
 *  - Everything else: most sites send X-Frame-Options/CSP headers that
 *    block being embedded at all (a browser security rule, not something
 *    fixable from our side), so those still open in a new tab.
 */
function getEmbeddableUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/\.pdf(\?.*)?$/i.test(trimmed)) return trimmed;

  const archiveMatch = trimmed.match(/^https?:\/\/(?:www\.)?archive\.org\/details\/([^/?#]+)/i);
  if (archiveMatch) return `https://archive.org/embed/${archiveMatch[1]}`;

  return null;
}

const Library = () => {
  const [contentType, setContentType] = useState<ContentType>("videos");
  const [category, setCategory] = useState("All");
  const [classFilter, setClassFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [videoLimit, setVideoLimit] = useState(12);
  const [playingVideo, setPlayingVideo] = useState<VideoItem | null>(null);
  const [readingFile, setReadingFile] = useState<LibraryFile | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); setVideoLimit(12); }, 400);
  };

  // ── Files data ──
  const { data, isLoading } = useLibraryFiles({
    category,
    classFilter,
    search: debouncedSearch,
    page,
    perPage: 12,
    enabled: contentType === "files", // don't download files while on Videos
  });
  const files = data?.data ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / 12));

  // ── Videos data (reuses the same hook the student dashboard uses) ──
  const { data: videos = [], isLoading: videosLoading } = useLibraryVideos({
    search: debouncedSearch,
    limit: videoLimit,
    enabled: contentType === "videos",
  });
  const filteredVideos = classFilter === "All" ? videos : videos.filter((v) => !v.class || v.class === "All" || v.class === classFilter);

  const handleFileAction = (file: LibraryFile) => {
    incrementDownloadCount(file.id);
    const embedUrl = file.file_type === "LINK" ? getEmbeddableUrl(file.file_url) : null;
    if (embedUrl) {
      setReadingFile(file);
    } else {
      window.open(file.file_url, "_blank");
      triggerConfetti("mini");
    }
  };

  const getFileIcon = (type: string | null) => {
    if (type === "LINK") return <ExternalLinkIcon className="w-5 h-5 text-emerald-600" />;
    if (type?.toLowerCase().includes("pdf")) return <FileText className="w-5 h-5 text-red-600" />;
    if (type?.toLowerCase().includes("doc") || type?.toLowerCase().includes("word"))
      return <File className="w-5 h-5 text-blue-600" />;
    return <FileText className="w-5 h-5 text-primary" />;
  };

  const resultCount = contentType === "files" ? totalCount : filteredVideos.length;

  return (
    <PageLayout>
      {/* ═══ Premium hero ═══ */}
      <section className="gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-gold w-[360px] h-[360px] -top-40 -right-24 opacity-80" />
          <div className="orb orb-light w-[280px] h-[280px] -bottom-32 -left-16" />
          <div className="absolute inset-0 dot-grid opacity-[0.10]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        <div className="relative container mx-auto px-4 pt-8 pb-10 md:pt-12 md:pb-14 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="mx-auto mb-3 w-12 h-12 rounded-2xl flex items-center justify-center text-gold bg-white/10 border border-white/20 backdrop-blur-sm shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.25)]">
            <LibraryIcon className="w-6 h-6" />
          </motion.div>
          <p className="text-[10px] md:text-xs font-bold uppercase tracking-[0.28em] text-gold mb-1.5">GHS Babi Khel</p>
          <h1 className="text-[1.9rem] md:text-5xl leading-[1.1] font-heading font-bold text-on-hero tracking-tight">Digital Library</h1>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold" />
            <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold" />
          </div>
          <p className="mt-3 text-sm md:text-base text-on-hero-soft max-w-md mx-auto leading-relaxed">
            Past papers, books and video lessons — free for every student.
          </p>

          {/* Search */}
          <div className="relative max-w-md mx-auto mt-5">
            <input
              type="text"
              enterKeyHint="search"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={contentType === "files" ? "Search files, papers, books…" : "Search video lessons…"}
              className="w-full h-11 px-5 rounded-full bg-white text-gray-900 placeholder:text-gray-400 text-sm font-medium outline-none border border-gold/40 focus:ring-4 focus:ring-gold/25 shadow-[0_14px_30px_-14px_rgba(0,0,0,0.55)] transition-shadow"
            />
          </div>
        </div>
      </section>

      <section className="py-5 md:py-8">
        <div className="container mx-auto px-4 max-w-6xl">

          {/* ── Segmented switch + class filter ── */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="inline-flex p-0.5 rounded-full bg-muted border border-border">
              {([
                { id: "videos", label: "Videos", Icon: VideoIcon },
                { id: "files", label: "Files", Icon: FileText },
              ] as const).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => { setContentType(id); setPage(1); }}
                  className={`inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    contentType === id
                      ? "gradient-hero text-white shadow-card"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
              {resultCount} {contentType === "files" ? "file" : "video"}{resultCount === 1 ? "" : "s"}
            </span>
          </div>

          {/* Class chips — single scrollable row */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
            {classOptions.map((c) => (
              <button
                key={c}
                onClick={() => { setClassFilter(c); setPage(1); }}
                className={`shrink-0 whitespace-nowrap h-8 px-3.5 rounded-full text-xs font-semibold transition-all border ${
                  classFilter === c
                    ? "bg-gold text-[hsl(var(--gold-ink))] border-gold shadow-sm"
                    : "bg-card text-muted-foreground border-border hover:border-gold/50"
                }`}
              >
                {c === "All" ? "All Classes" : `Class ${c}`}
              </button>
            ))}
          </div>

          {/* Category chips — Files only */}
          {contentType === "files" && (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pt-1.5 pb-1">
              {fileCategories.map((c) => (
                <button
                  key={c}
                  onClick={() => { setCategory(c); setPage(1); }}
                  className={`shrink-0 whitespace-nowrap h-8 px-3.5 rounded-full text-xs font-semibold transition-all border ${
                    category === c
                      ? "gradient-hero text-white border-transparent shadow-sm"
                      : "bg-card text-muted-foreground border-border hover:border-primary/40"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <div className="h-4" />

          {/* ══ FILES VIEW ══ */}
          {contentType === "files" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="bg-card rounded-2xl border border-border p-4 space-y-3">
                        <div className="flex gap-3"><Skeleton className="h-12 w-12 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>
                        <Skeleton className="h-8 w-full rounded-lg" />
                      </div>
                    ))
                  : files.map((f) => {
                      const isLink = f.file_type === "LINK";
                      return (
                      <div
                        key={f.id}
                        style={{ contentVisibility: "auto", containIntrinsicSize: "0 118px" }}
                        className="group relative overflow-hidden bg-card rounded-2xl border border-border shadow-card"
                      >
                        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-gold to-primary" />
                        <div className="p-4 pl-5">
                          <div className="flex items-start gap-3">
                            {f.cover_url ? (
                              <img src={optimizedCloudinaryUrl(f.cover_url, { width: 120 }) || f.cover_url} alt="" loading="lazy" decoding="async" width={48} height={64}
                                className="w-12 h-16 rounded-lg object-cover shrink-0 border border-border shadow-sm" />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center shrink-0 border border-border">
                                {getFileIcon(f.file_type)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-heading font-bold text-foreground text-sm leading-snug line-clamp-2">{f.title}</h3>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                <span className="text-[10px] font-bold bg-gold/15 text-gold-strong dark:text-gold px-2 py-0.5 rounded-full whitespace-nowrap">Class {f.class}</span>
                                {f.subject && <span className="text-[10px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{f.subject}</span>}
                                <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{f.category}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-3">
                            <p className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
                              {f.file_size ? `${f.file_size} · ` : ""}{f.download_count} {isLink ? "views" : "downloads"} · {format(new Date(f.created_at), "dd MMM yyyy")}
                            </p>
                            <button
                              onClick={() => handleFileAction(f)}
                              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-8 px-3.5 rounded-lg gradient-hero text-white text-xs font-bold whitespace-nowrap border border-gold/40 shadow-sm active:scale-[0.97] transition-all"
                            >
                              {isLink ? <ExternalLinkIcon className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                              {isLink ? (getEmbeddableUrl(f.file_url) ? "Read" : "Open") : "Download"}
                            </button>
                          </div>
                        </div>
                      </div>
                      );
                    })}
              </div>

              {!isLoading && files.length === 0 && (
                <div className="text-center py-14 bg-card rounded-2xl border border-border shadow-card">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3"><SearchX className="w-7 h-7 text-muted-foreground" /></div>
                  <p className="font-heading font-bold text-foreground">No files found</p>
                  <p className="text-xs text-muted-foreground mt-1">Try a different search or filter</p>
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Previous page"
                    className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center text-foreground disabled:opacity-40"
                  ><ChevronLeft className="w-4 h-4" /></button>
                  <span className="text-xs font-bold text-foreground px-3 h-8 inline-flex items-center rounded-lg bg-card border border-border whitespace-nowrap">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    aria-label="Next page"
                    className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center text-foreground disabled:opacity-40"
                  ><ChevronRight className="w-4 h-4" /></button>
                </div>
              )}
            </>
          )}

          {/* ══ VIDEOS VIEW ══ */}
          {contentType === "videos" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                {videosLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="aspect-video w-full rounded-xl" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    ))
                  : filteredVideos.map((v) => {
                      const ytId = getYouTubeId(v.video_url);
                      const thumb = (v.thumbnail_url ? (optimizedCloudinaryUrl(v.thumbnail_url, { width: 400 }) || v.thumbnail_url) : null) || (ytId ? ytThumb(ytId) : null);
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => setPlayingVideo(v)}
                          className="text-left bg-card rounded-2xl overflow-hidden border border-border shadow-card active:scale-[0.99] transition group"
                        >
                          <div className="aspect-video relative bg-muted overflow-hidden">
                            {thumb ? (
                              <img src={thumb} alt="" loading="lazy" decoding="async" width={320} height={180}
                                className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full gradient-hero flex items-center justify-center">
                                <VideoIcon className="w-8 h-8 text-white/40" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                            <div className="absolute right-2 bottom-2 w-8 h-8 rounded-full bg-gold text-[hsl(var(--gold-ink))] flex items-center justify-center shadow-lg">
                              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                            </div>
                            {ytId && (
                              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                                <Youtube className="w-2.5 h-2.5" /> YouTube
                              </div>
                            )}
                          </div>
                          <div className="p-2.5">
                            <h4 className="text-xs md:text-sm font-bold text-foreground leading-snug line-clamp-2">{v.title}</h4>
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full whitespace-nowrap">{v.category}</span>
                              {v.class && v.class !== "All" && (
                                <span className="text-[9px] font-bold bg-gold/15 text-gold-strong dark:text-gold px-1.5 py-0.5 rounded-full whitespace-nowrap">Class {v.class}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
              </div>

              {!videosLoading && videos.length >= videoLimit && (
                <div className="flex justify-center mt-5">
                  <button
                    type="button"
                    onClick={() => setVideoLimit((n) => n + 12)}
                    className="h-9 px-6 rounded-full border border-gold/40 bg-gold/10 text-xs font-bold text-amber-700 dark:text-amber-300 active:scale-95 transition"
                  >
                    Show more videos
                  </button>
                </div>
              )}

              {!videosLoading && filteredVideos.length === 0 && (
                <div className="text-center py-14 bg-card rounded-2xl border border-border shadow-card">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3"><VideoIcon className="w-7 h-7 text-muted-foreground" /></div>
                  <p className="font-heading font-bold text-foreground">No videos found</p>
                  <p className="text-xs text-muted-foreground mt-1">Try a different search or filter</p>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Video player modal ── */}
      <AnimatePresence>
        {playingVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
            // Closes ONLY via the X button (or Esc) — tapping outside must not dismiss it.
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-3xl bg-card rounded-2xl overflow-hidden shadow-2xl border border-gold/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border">
                <div className="flex-1 min-w-0 pr-3">
                  <h3 className="font-heading font-semibold text-foreground text-sm sm:text-base truncate">{playingVideo.title}</h3>
                  {playingVideo.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{playingVideo.description}</p>
                  )}
                </div>
                <button
                  onClick={() => setPlayingVideo(null)}
                  className="p-2 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="aspect-video bg-black">
                {getYouTubeId(playingVideo.video_url) ? (
                  <iframe
                    src={`https://www.youtube.com/embed/${getYouTubeId(playingVideo.video_url)}?autoplay=1&rel=0&modestbranding=1`}
                    title={playingVideo.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                ) : isVideoFileUrl(playingVideo.video_url) ? (
                  <video
                    src={playingVideo.video_url}
                    controls
                    autoPlay
                    className="w-full h-full"
                    controlsList="nodownload"
                  />
                ) : (
                  <iframe
                    src={playingVideo.video_url}
                    title={playingVideo.title}
                    allowFullScreen
                    className="w-full h-full"
                  />
                )}
              </div>

              <div className="p-3 sm:p-4 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">{playingVideo.category}</span>
                {playingVideo.class && playingVideo.class !== "All" && (
                  <span className="text-[10px] font-bold border border-border text-foreground px-2 py-0.5 rounded-full whitespace-nowrap">Class {playingVideo.class}</span>
                )}
                {playingVideo.subject && (
                  <span className="text-[10px] font-bold border border-border text-foreground px-2 py-0.5 rounded-full whitespace-nowrap">{playingVideo.subject}</span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(new Date(playingVideo.created_at), "dd MMM yyyy")}
                </span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── In-site PDF reader modal (direct PDF links only) ── */}
      <AnimatePresence>
        {readingFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
            // Closes ONLY via the X button (or Esc) — tapping outside must not dismiss it.
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-3xl h-[85vh] bg-card rounded-2xl overflow-hidden shadow-2xl border border-gold/30 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border shrink-0">
                <div className="flex-1 min-w-0 pr-3">
                  <h3 className="font-heading font-semibold text-foreground text-sm sm:text-base truncate">{readingFile.title}</h3>
                </div>
                <a
                  href={readingFile.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0"
                  title="Open in new tab"
                >
                  <ExternalLinkIcon className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setReadingFile(null)}
                  className="p-2 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 bg-muted">
                <iframe
                  src={getEmbeddableUrl(readingFile.file_url) || readingFile.file_url}
                  title={readingFile.title}
                  className="w-full h-full"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
};

export default Library;
