import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import { Play, X, Youtube, Video, BookOpen, Megaphone, Calendar, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

// ─── Types ───────────────────────────────────────────────────
export interface VideoItem {
  id: string;
  title: string;
  description: string | null;
  video_url: string;        // YouTube URL or Supabase storage URL
  thumbnail_url: string | null;
  category: string;         // "lecture" | "event" | "program" | "announcement" | "other"
  class: string | null;     // "6"-"10" or "All"
  subject: string | null;
  is_published: boolean;
  created_at: string;
}

export const VIDEO_CATEGORIES = ["All", "Lecture", "Event", "Program", "Announcement", "Other"];

// ─── Helpers ─────────────────────────────────────────────────

/** Extract YouTube video ID from any YouTube URL format */
export const getYouTubeId = (url: string): string | null => {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
};

/** Get YouTube thumbnail URL from video ID */
export const getYouTubeThumbnail = (videoId: string) =>
  `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

/** Check if URL is a YouTube link */
export const isYouTubeUrl = (url: string) =>
  /youtube\.com|youtu\.be/.test(url);

/** Check if URL is a direct video file */
export const isVideoFileUrl = (url: string) =>
  /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);

// ─── Hook ─────────────────────────────────────────────────────
export function useVideos(options?: { category?: string; search?: string }) {
  const { category, search } = options || {};
  return useQuery<VideoItem[]>({
    queryKey: ["videos", category, search],
    queryFn: async () => {
      let query = supabase
        .from("videos")
        .select("id, title, description, video_url, thumbnail_url, category, class, subject, is_published, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });

      if (category && category !== "All")
        query = query.eq("category", category);
      if (search)
        query = query.ilike("title", `%${search}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

// ─── Video Card ───────────────────────────────────────────────
const VideoCard = ({ video, onClick }: { video: VideoItem; onClick: () => void }) => {
  const ytId = getYouTubeId(video.video_url);
  const thumb = video.thumbnail_url || (ytId ? getYouTubeThumbnail(ytId) : null);

  const categoryIcon = {
    Lecture: <BookOpen className="w-3 h-3" />,
    Event: <Calendar className="w-3 h-3" />,
    Announcement: <Megaphone className="w-3 h-3" />,
  }[video.category] || <Video className="w-3 h-3" />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl overflow-hidden shadow-card hover:shadow-elevated transition-all cursor-pointer group"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="aspect-video relative bg-muted overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={video.title}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full gradient-hero flex items-center justify-center">
            <Video className="w-10 h-10 text-white/40" />
          </div>
        )}

        {/* Play overlay */}
        <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/30 transition-colors flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity scale-75 group-hover:scale-100 duration-200">
            <Play className="w-5 h-5 text-primary fill-primary ml-0.5" />
          </div>
        </div>

        {/* YouTube badge */}
        {ytId && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Youtube className="w-2.5 h-2.5" /> YouTube
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <Badge variant="secondary" className="text-[10px] gap-1 py-0">
            {categoryIcon} {video.category}
          </Badge>
          {video.class && video.class !== "All" && (
            <Badge variant="outline" className="text-[10px] py-0">Class {video.class}</Badge>
          )}
        </div>
        <h4 className="text-sm font-semibold text-foreground line-clamp-2">{video.title}</h4>
        {video.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{video.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1.5">
          {format(new Date(video.created_at), "dd MMM yyyy")}
        </p>
      </div>
    </motion.div>
  );
};

// ─── Video Player Modal ───────────────────────────────────────
const VideoPlayerModal = ({ video, onClose }: { video: VideoItem; onClose: () => void }) => {
  const ytId = getYouTubeId(video.video_url);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-foreground/90 backdrop-blur-md flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-3xl bg-card rounded-2xl overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex-1 min-w-0 pr-3">
              <h3 className="font-heading font-semibold text-foreground truncate">{video.title}</h3>
              {video.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{video.description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Player */}
          <div className="aspect-video bg-black">
            {ytId ? (
              // ✅ YouTube embed — auto plays, full controls
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            ) : isVideoFileUrl(video.video_url) ? (
              // ✅ Direct video file
              <video
                src={video.video_url}
                controls
                autoPlay
                className="w-full h-full"
                controlsList="nodownload"
              />
            ) : (
              // ✅ Unknown — try as iframe src
              <iframe
                src={video.video_url}
                title={video.title}
                allowFullScreen
                className="w-full h-full"
              />
            )}
          </div>

          {/* Meta */}
          <div className="p-4 flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{video.category}</Badge>
            {video.class && video.class !== "All" && (
              <Badge variant="outline">Class {video.class}</Badge>
            )}
            {video.subject && (
              <Badge variant="outline">{video.subject}</Badge>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {format(new Date(video.created_at), "dd MMM yyyy")}
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─── Main Tab ─────────────────────────────────────────────────
const VideosTab = () => {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);

  const { data: videos = [], isLoading } = useVideos({ category, search });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-heading font-bold text-foreground">Videos</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Lectures, events, programs and announcements
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search videos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          {VIDEO_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                category === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-secondary shadow-card"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl overflow-hidden shadow-card">
              <Skeleton className="aspect-video w-full" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="bg-card rounded-xl p-16 text-center shadow-card">
          <Video className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-30" />
          <p className="font-medium text-foreground">No videos found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? "Try a different search term" : "Videos will appear here once uploaded"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onClick={() => setActiveVideo(v)} />
          ))}
        </div>
      )}

      {/* Player modal */}
      {activeVideo && (
        <VideoPlayerModal video={activeVideo} onClose={() => setActiveVideo(null)} />
      )}
    </div>
  );
};

export default VideosTab;
