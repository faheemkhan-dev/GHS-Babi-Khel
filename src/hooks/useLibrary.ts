import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

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
}) {
  const { category, classFilter, search, page = 1, perPage = 12 } = options || {};

  return useQuery<{ data: LibraryFile[]; count: number }>({
    queryKey: ["library-files", category, classFilter, search, page, perPage],
    queryFn: async () => {
      let query = supabase
        .from("library_files")
        .select("id, title, description, category, class, subject, file_url, file_type, file_size, cover_url, download_count, uploaded_by, created_at", { count: "exact" })
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
      return { data: data ?? [], count: count ?? 0 };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: { data: [], count: 0 },
  });
}

export async function incrementDownloadCount(fileId: string) {
  try {
    await supabase.rpc("increment_download_count", { file_id: fileId });
  } catch {
    // Fallback: ignore if RPC doesn't exist
  }
}
