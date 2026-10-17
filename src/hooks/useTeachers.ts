import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Teacher {
  id: string;
  full_name: string;
  subject: string | null;
  qualification: string | null;
  experience: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  bio: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

/**
 * Fetch the school's teacher list.
 *
 * @param limit    Optional row cap (e.g. homepage shows only 4).
 * @param includeInactive  When true, ALSO returns inactive teachers
 *   (is_active = false). Defaults to false so public-facing pages
 *   (homepage, public Teachers page, student dashboard) only show
 *   active teachers. The admin Timetables page passes true so the
 *   admin can assign ANY teacher — including ones marked inactive
 *   (e.g. a teacher on leave who's still in the system, or a teacher
 *   the admin forgot to activate). Inactive teachers are shown greyed
 *   out in the dropdown but are still selectable.
 */
export function useTeachers(limit?: number, includeInactive: boolean = false) {
  return useQuery<Teacher[]>({
    queryKey: ["teachers", limit, includeInactive],
    queryFn: async () => {
      let query = supabase
        .from("teachers")
        .select("id, full_name, subject, qualification, experience, phone, email, photo_url, bio, is_active, display_order, created_at")
        .order("display_order", { ascending: true });
      if (!includeInactive) {
        query = query.eq("is_active", true);
      }
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}
