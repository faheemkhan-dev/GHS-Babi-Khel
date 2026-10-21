import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { VideoItem } from "@/pages/dashboard/tabs/VideosTab";
import { supabase } from "@/lib/supabase";
import { cachedOrDirect } from "@/lib/publicData";

export interface LibraryFile {
  id: string;
  title: string;
  description: string | null;
  category: string;
  class: string;
  subject: string | null;
  file_url: string;
  file_type: string | null;
  file_size: string | null;
  cover_url: string | null;
  download_count: number;
  uploaded_by: string | null;
  created_at: string;
}

export function useLibraryFiles(options?: {
  category?: string;
  classFilter?: string;
  search?: string;
  page?: number;
  perPage?: number;
  /** Skip the request entirely (e.g. when another tab is showing). */
  enabled?: boolean;
}) {
  const { category, classFilter, search, page = 1, perPage = 12, enabled = true } = options || {};

  return useQuery<{ data: LibraryFile[]; count: number }>({
    queryKey: ["library-files", category, classFilter, search, page, perPage],
    queryFn: async () =>
      // Phase 5: cached public listing (CDN s-maxage 120 s) — the Library page
      // browses the same handful of filter/page URLs for everyone, so the DB
      // is read once per combination per two minutes. Falls back to the exact
      // direct query (with its count=exact head request) when unavailable.
      cachedOrDirect<{ data: LibraryFile[]; count: number }>(
        "library",
        { category, class: classFilter, search, page, perPage },
        async () => {
          let query = supabase
            .from("library_files")
            .select("id, title, category, class, subject, file_url, file_type, file_size, cover_url, download_count, created_at", { count: "exact" })
            .order("created_at", { ascending: false });

          if (category && category !== "All") query = query.eq("category", category);
          if (classFilter && classFilter !== "All") query = query.eq("class", classFilter);
          if (search) {
            // Escape LIKE wildcards to prevent wildcard injection
            const safe = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
            query = query.ilike("title", `%${safe}%`);
          }

          const from = (page - 1) * perPage;
          query = query.range(from, from + perPage - 1);

          const { data, error, count } = await query;
          if (error) throw error;
          return { data: (data ?? []) as unknown as LibraryFile[], count: count ?? 0 };
        },
      ),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Keep the previous page on screen while the next one loads (no flicker,
    // no empty-state flash) — first load still shows skeletons.
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Light videos query for the Library: only the first `limit` rows, only when
 *  the Videos tab is open, search done on the server. */
export function useLibraryVideos(options: { search?: string; limit?: number; enabled?: boolean }) {
  const { search, limit = 12, enabled = true } = options;
  return useQuery<VideoItem[]>({
    queryKey: ["library-videos", search, limit],
    queryFn: async () => {
      let query = supabase
        .from("videos")
        .select("id, title, description, video_url, thumbnail_url, category, class, subject, is_published, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (search) {
        const safe = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
        query = query.ilike("title", `%${safe}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as VideoItem[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export async function incrementDownloadCount(fileId: string) {
  try {
    await supabase.rpc("increment_download_count", { file_id: fileId });
  } catch {
    // Fallback: ignore if RPC doesn't exist
  }
}
