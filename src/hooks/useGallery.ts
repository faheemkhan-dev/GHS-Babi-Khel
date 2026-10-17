import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GalleryAlbum {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
}

export interface GalleryPhoto {
  id: string;
  album_id: string;
  photo_url: string;
  caption: string | null;
  media_type: "image" | "video";
  created_at: string;
}

export const isVideoUrl = (url: string) =>
  /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);

export function useGalleryAlbums() {
  return useQuery<GalleryAlbum[]>({
    queryKey: ["gallery-albums"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gallery_albums")
        .select("id, title, description, cover_url, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

export function useGalleryPhotos(albumId: string | null) {
  return useQuery<GalleryPhoto[]>({
    queryKey: ["gallery-photos", albumId],
    queryFn: async () => {
      if (!albumId) return [];
      const { data, error } = await supabase
        .from("gallery_photos")
        .select("id, album_id, photo_url, caption, media_type, created_at")
        .eq("album_id", albumId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        media_type: p.media_type || (isVideoUrl(p.photo_url) ? "video" : "image"),
      })) as GalleryPhoto[];
    },
    enabled: !!albumId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

/** Fallback cover for albums with no cover_url set in the admin panel —
 *  grabs the most recent item in the album so the card always shows real
 *  media instead of the plain placeholder tile. */
export function useAlbumFallbackCover(albumId: string, enabled: boolean) {
  return useQuery<{ url: string; isVideo: boolean } | null>({
    queryKey: ["gallery-fallback-cover", albumId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gallery_photos")
        .select("photo_url, media_type")
        .eq("album_id", albumId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const first = data?.[0];
      if (!first) return null;
      return {
        url: first.photo_url,
        isVideo: first.media_type === "video" || isVideoUrl(first.photo_url),
      };
    },
    enabled: enabled && !!albumId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useAlbumPhotoCount(albumId: string) {
  return useQuery<number>({
    queryKey: ["gallery-photo-count", albumId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("gallery_photos")
        .select("*", { count: "exact", head: true })
        .eq("album_id", albumId);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
