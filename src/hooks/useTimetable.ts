import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TimetableEntry {
  id: string;
  class: string;
  day: string;
  period_number: number;
  subject: string;
  teacher: string | null;
  teacher_name: string | null; // alias for backward compat
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  meet_link: string | null;
  updated_at: string;
}

export interface TimetableSetting {
  id: string;
  class_level: string;
  period_names: Record<string, string>; // {"1":"Period 1","2":"Morning",...}
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  room_type: string; // classroom | lab | library | hall
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConflictInfo {
  teacher: string;
  day: string;
  period_number: number;
  existing_class: string;
  existing_subject: string;
}

// ─── 2.1 Period Names from Supabase ────────────────────────────────────────

export function useTimetableSettings(classLevel: string) {
  return useQuery<TimetableSetting>({
    queryKey: ["timetable-settings", classLevel],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timetable_settings")
        .select("*")
        .eq("class_level", classLevel)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Auto-create default settings
        const defaults: Record<string, string> = {};
        for (let i = 1; i <= 9; i++) defaults[i] = `Period ${i}`;
        const { data: created, error: insertErr } = await supabase
          .from("timetable_settings")
          .insert({ class_level: classLevel, period_names: defaults })
          .select()
          .single();
        if (insertErr) throw insertErr;
        return created;
      }
      return data;
    },
    enabled: !!classLevel,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveTimetableSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ classLevel, periodNames }: { classLevel: string; periodNames: Record<string, string> }) => {
      const { data, error } = await supabase
        .from("timetable_settings")
        .upsert(
          { class_level: classLevel, period_names: periodNames },
          { onConflict: "class_level" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["timetable-settings", vars.classLevel] });
    },
  });
}

// ─── Timetable Entries ──────────────────────────────────────────────────────

export function useTimetable(classFilter: string) {
  return useQuery<TimetableEntry[]>({
    queryKey: ["timetable", classFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timetables")
        .select("id, class, day, period_number, subject, teacher, teacher_name, start_time, end_time, room, meet_link, updated_at")
        .eq("class", classFilter)
        .order("period_number", { ascending: true });
      if (error) throw error;
      // Normalize teacher field: prefer teacher, fallback to teacher_name
      return (data ?? []).map((row: any) => ({
        ...row,
        teacher: row.teacher || row.teacher_name || null,
        teacher_name: row.teacher_name || row.teacher || null,
      }));
    },
    enabled: !!classFilter,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });
}

// ─── All Timetable Entries (for conflict detection + copy) ──────────────────

export function useAllTimetables() {
  return useQuery<TimetableEntry[]>({
    queryKey: ["all-timetables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timetables")
        .select("id, class, day, period_number, subject, teacher, teacher_name, start_time, end_time, room, meet_link, updated_at");
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        ...row,
        teacher: row.teacher || row.teacher_name || null,
        teacher_name: row.teacher_name || row.teacher || null,
      }));
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ─── 2.2 Teacher Conflict Detection ────────────────────────────────────────

export function useCheckTeacherConflict() {
  return useMutation({
    mutationFn: async ({
      teacher,
      day,
      periodNumber,
      excludeClass,
    }: {
      teacher: string;
      day: string;
      periodNumber: number;
      excludeClass: string;
    }): Promise<ConflictInfo | null> => {
      if (!teacher.trim()) return null;
      const { data, error } = await supabase
        .from("timetables")
        .select("class, subject, teacher, teacher_name")
        .eq("day", day)
        .eq("period_number", periodNumber)
        .neq("class", excludeClass);
      if (error) throw error;
      // Check if any row has the same teacher (case-insensitive)
      const conflict = (data ?? []).find((row: any) => {
        const t = row.teacher || row.teacher_name || "";
        return t.toLowerCase().trim() === teacher.toLowerCase().trim();
      });
      if (conflict) {
        return {
          teacher: conflict.teacher || conflict.teacher_name || teacher,
          day,
          period_number: periodNumber,
          existing_class: conflict.class,
          existing_subject: conflict.subject,
        };
      }
      return null;
    },
  });
}

// ─── Room Conflict Detection ────────────────────────────────────────────────

export function useCheckRoomConflict() {
  return useMutation({
    mutationFn: async ({
      room,
      day,
      periodNumber,
      excludeClass,
    }: {
      room: string;
      day: string;
      periodNumber: number;
      excludeClass: string;
    }): Promise<{ class: string; subject: string; teacher: string } | null> => {
      if (!room.trim()) return null;
      const { data, error } = await supabase
        .from("timetables")
        .select("class, subject, teacher, teacher_name")
        .eq("day", day)
        .eq("period_number", periodNumber)
        .eq("room", room)
        .neq("class", excludeClass);
      if (error) throw error;
      const conflict = (data ?? [])[0];
      if (conflict) {
        return {
          class: conflict.class,
          subject: conflict.subject,
          teacher: conflict.teacher || conflict.teacher_name || "",
        };
      }
      return null;
    },
  });
}

// ─── 2.3 Copy Timetable from Another Class ──────────────────────────────────

export function useCopyTimetable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sourceClass,
      targetClass,
    }: {
      sourceClass: string;
      targetClass: string;
    }) => {
      // Fetch source entries
      const { data: sourceRows, error: fetchErr } = await supabase
        .from("timetables")
        .select("day, period_number, subject, teacher, start_time, end_time, room, meet_link")
        .eq("class", sourceClass);
      if (fetchErr) throw fetchErr;
      if (!sourceRows?.length) throw new Error("Source class has no timetable entries");

      // Delete existing target entries
      await supabase.from("timetables").delete().eq("class", targetClass);

      // Insert copied entries
      const inserts = sourceRows.map((row: any) => ({
        ...row,
        class: targetClass,
      }));
      const { error: insertErr } = await supabase.from("timetables").insert(inserts);
      if (insertErr) throw insertErr;

      return inserts.length;
    },
    onSuccess: (_count, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-timetable", vars.targetClass] });
      qc.invalidateQueries({ queryKey: ["timetable", vars.targetClass] });
      toast.success(`Copied ${_count} periods from Class ${vars.sourceClass} to Class ${vars.targetClass}`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to copy timetable");
    },
  });
}

// ─── Save Timetable (Upsert-based) ─────────────────────────────────────────

export function useSaveTimetable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      classLevel,
      entries,
    }: {
      classLevel: string;
      entries: Array<{
        day: string;
        period_number: number;
        subject: string;
        teacher: string;
        start_time: string;
        end_time: string;
        room: string;
        meet_link: string;
      }>;
    }) => {
      // Delete all existing entries for the class
      const { error: delErr } = await supabase
        .from("timetables")
        .delete()
        .eq("class", classLevel);
      if (delErr) throw delErr;

      // Insert all non-empty entries
      const inserts = entries
        .filter((e) => e.subject.trim())
        .map((e) => ({ class: classLevel, ...e }));
      if (inserts.length) {
        const { error: insertErr } = await supabase.from("timetables").insert(inserts);
        if (insertErr) throw insertErr;
      }
      return inserts.length;
    },
    onSuccess: (_count, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-timetable", vars.classLevel] });
      qc.invalidateQueries({ queryKey: ["timetable", vars.classLevel] });
      qc.invalidateQueries({ queryKey: ["all-timetables"] });
      toast.success("Timetable saved successfully!");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save timetable");
    },
  });
}

// ─── 2.5 Rooms CRUD ────────────────────────────────────────────────────────

export function useRooms() {
  return useQuery<Room[]>({
    queryKey: ["rooms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .order("room_type", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useSaveRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (room: Partial<Room> & { name: string }) => {
      if (room.id) {
        const { data, error } = await supabase
          .from("rooms")
          .update(room)
          .eq("id", room.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from("rooms")
          .insert(room)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Room saved");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save room");
    },
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rooms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Room deleted");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete room");
    },
  });
}

// ─── 2.6 Notification Permission Helper ────────────────────────────────────

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function scheduleClassReminder(
  entry: { subject: string; teacher: string | null; room: string | null; start_time: string | null; meet_link: string | null },
  minutesBefore: number = 5
): number | null {
  if (!entry.start_time) return null;
  if (!("Notification" in window) || Notification.permission !== "granted") return null;

  const now = new Date();
  const [hours, minutes] = entry.start_time.split(":").map(Number);
  const classTime = new Date();
  classTime.setHours(hours, minutes, 0, 0);

  const reminderTime = new Date(classTime.getTime() - minutesBefore * 60 * 1000);
  const delay = reminderTime.getTime() - now.getTime();

  if (delay <= 0) return null; // Already past

  return window.setTimeout(() => {
    const n = new Notification(`Class starting in ${minutesBefore} min`, {
      body: `${entry.subject}${entry.teacher ? ` — ${entry.teacher}` : ""}${entry.room ? ` | Room: ${entry.room}` : ""}`,
      icon: "/favicon.ico",
      tag: `class-reminder-${entry.subject}-${entry.start_time}`,
    });
    if (entry.meet_link) {
      n.onclick = () => {
        window.open(entry.meet_link!, "_blank");
        n.close();
      };
    }
  }, delay);
}
