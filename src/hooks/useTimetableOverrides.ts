// src/hooks/useTimetableOverrides.ts
// ─────────────────────────────────────────────────────────────────────────────
// TODAY-ONLY SUBSTITUTE-TEACHER ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────
// When a teacher is absent, the admin opens the Timetables page and clicks
// "Substitute" → picks the absent teacher → the system auto-assigns a
// substitute for every period that teacher was supposed to teach today.
//
// Those temporary assignments live in the `timetable_overrides` table (see
// migration 014). They do NOT modify the permanent `timetables` table —
// tomorrow the regular timetable is back in effect automatically.
//
// ── How the substitute is chosen ────────────────────────────────────────────
// For each (class, day, period, subject) the absent teacher was supposed to
// teach today:
//   1. Find all teachers whose `subject` matches the entry's subject.
//   2. Exclude the absent teacher.
//   3. Exclude teachers who are ALREADY teaching in any class at the same
//      day + period — both in the regular timetable AND in today's already-
//      assigned overrides (so we don't double-book a substitute).
//   4. Pick the first remaining teacher (sorted by display_order for stable
//      results). Reason = "subject-match".
//   5. If no subject-match is free, fall back to ANY free teacher (any
//      subject). Reason = "free-period".
//   6. If NO teacher is free at that period (everyone is teaching), leave
//      that period unsdubstituted and report it as "uncovered".
//
// The auto-assignment is done CLIENT-SIDE here (in the hook) because it
// needs to join `teachers` + `timetables` + `timetable_overrides` and apply
// the free-period logic — easier to do in JS than in a SQL function.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import type { Teacher } from "@/hooks/useTeachers";
import type { TimetableEntry } from "@/hooks/useTimetable";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TimetableOverride {
  id: string;
  effective_date: string; // "YYYY-MM-DD"
  class: string;
  day: string;
  period_number: number;
  subject: string;
  original_teacher: string | null;
  substitute_teacher: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SubstitutionResult {
  /** Overrides that were successfully created. */
  assigned: Array<{
    class: string;
    day: string;
    period_number: number;
    subject: string;
    original_teacher: string | null;
    substitute_teacher: string;
    reason: string;
    /** Which absent teacher this assignment is covering for. Useful when
     *  the admin marks multiple teachers absent in a single run — the UI
     *  can group results by this field. */
    absent_teacher?: string | null;
  }>;
  /** Periods the absent teacher was supposed to teach but NO free teacher
   *  could be found to cover them. */
  uncovered: Array<{
    class: string;
    day: string;
    period_number: number;
    subject: string;
    reason: string;
    /** Which absent teacher this uncovered period belongs to. */
    absent_teacher?: string | null;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date as "YYYY-MM-DD" in the user's local timezone. */
function todayDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns the day name (e.g. "Monday") for today in the user's local
 *  timezone. This is what we match against the timetable's `day` column. */
function todayDayName(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch all overrides for TODAY. Used by the student/teacher dashboard to
 * show substitute teachers in place of the regular timetable, and by the
 * admin Timetables page to show a "today's overrides" summary.
 */
export function useTodayTimetableOverrides() {
  const today = todayDateStr();
  return useQuery<TimetableOverride[]>({
    queryKey: ["timetable-overrides", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("timetable_overrides")
        .select("*")
        .eq("effective_date", today)
        .order("class", { ascending: true })
        .order("period_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30 * 1000, // refresh every 30s — substitutes may be added mid-day
  });
}

/**
 * Auto-assign substitute teachers for one or more absent teachers, for TODAY only.
 *
 * Algorithm:
 *   1. Fetch ALL timetable entries for today's day name (across ALL classes).
 *   2. Filter to entries where the teacher is in the absent set.
 *   3. Build a single shared "busy" map across all periods — so a teacher
 *      already assigned as a substitute for one absent teacher's period
 *      CAN'T be double-booked for another absent teacher's same period.
 *   4. For each absent teacher's entry (in round-robin order across the
 *      absent teachers so they get fair coverage), pick a free substitute
 *      (subject match preferred, then any free teacher).
 *   5. Upsert all assignments into timetable_overrides with today's date.
 *
 * Backward-compat: still accepts the legacy single `absentTeacher: string`
 * field — internally we just wrap it into a one-element array.
 *
 * Returns the SubstitutionResult so the UI can show a summary + generate
 * the PNG image for WhatsApp sharing. Each entry in `assigned` /
 * `uncovered` is tagged with `absent_teacher` so the UI can group by
 * which teacher was out.
 */
export function useAssignSubstitutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      /** @deprecated use `absentTeachers` instead. Still accepted for
       *  backward-compat. */
      absentTeacher?: string;
      /** List of absent teacher names (case-insensitive match against
       *  `timetable_entries.teacher`). Pass 1+ teachers. */
      absentTeachers?: string[];
      teachers: Teacher[];
      allTimetableEntries: TimetableEntry[];
      /** Already-assigned overrides for today (so we don't double-book a
       *  substitute across multiple absent-teacher assignments). */
      existingOverrides?: TimetableOverride[];
    }): Promise<SubstitutionResult> => {
      // Normalize to a set. Support both the new and legacy param name.
      const rawList =
        params.absentTeachers && params.absentTeachers.length > 0
          ? params.absentTeachers
          : params.absentTeacher
            ? [params.absentTeacher]
            : [];
      const absentList = rawList.map((n) => n.trim()).filter(Boolean);
      if (absentList.length === 0) {
        throw new Error("Please select at least one absent teacher.");
      }
      const absentNorms = new Set(absentList.map((n) => n.toLowerCase()));
      const { teachers, allTimetableEntries, existingOverrides = [] } = params;
      const today = todayDateStr();
      const todayName = todayDayName();

      // 1. Find every entry any of the absent teachers was supposed to teach
      //    today. "Today" = entries whose `day` column matches today's day.
      const absentEntries = allTimetableEntries.filter((e) => {
        const t = (e.teacher || e.teacher_name || "").trim().toLowerCase();
        return absentNorms.has(t) && e.day === todayName;
      });

      if (absentEntries.length === 0) {
        throw new Error(
          `None of the selected teachers have classes scheduled for today (${todayName}).`
        );
      }

      // 2. Build a "busy" set: for each (day, period), which teachers are
      //    already teaching in ANY class? This includes:
      //      a. Regular timetable entries (from allTimetableEntries)
      //      b. Already-assigned overrides for today (existingOverrides)
      //    Every absent teacher is NOT counted as busy (they're absent), so
      //    their names are removed from the busy set.
      const busyMap = new Map<string, Set<string>>(); // "day|period" → Set<teacherLower>
      const addBusy = (day: string, period: number, teacherName: string) => {
        const t = teacherName.trim().toLowerCase();
        if (!t || absentNorms.has(t)) return; // skip any absent teacher
        const key = `${day}|${period}`;
        if (!busyMap.has(key)) busyMap.set(key, new Set());
        busyMap.get(key)!.add(t);
      };
      // (a) regular timetable
      allTimetableEntries.forEach((e) => {
        if (e.day !== todayName) return;
        const t = e.teacher || e.teacher_name || "";
        if (t) addBusy(e.day, e.period_number, t);
      });
      // (b) existing overrides
      existingOverrides.forEach((o) => {
        if (o.effective_date !== today) return;
        addBusy(o.day, o.period_number, o.substitute_teacher);
      });

      const isFree = (teacherName: string, day: string, period: number): boolean => {
        const t = teacherName.trim().toLowerCase();
        if (absentNorms.has(t)) return false;
        const key = `${day}|${period}`;
        const busy = busyMap.get(key);
        return !busy || !busy.has(t);
      };

      // 3. FAIR ASSIGNMENT.
      //    Previously the subject-match teacher was ALWAYS preferred, so one
      //    teacher could end up covering every period. Now every free
      //    teacher gets a score and the lowest score wins:
      //        score = (substitute periods already given today) * 10
      //              + (15 if the teacher does NOT teach this subject)
      //              + (regular periods the teacher already teaches today) * 0.5
      //    => a subject expert is used at most ~2 times before the work is
      //       spread to other free teachers, and nobody is double-booked.
      //    The most constrained periods (fewest free teachers) are solved
      //    first so fewer periods are left uncovered.
      const norm = (n: string) => n.trim().toLowerCase();
      const assignCount = new Map<string, number>();
      const getCount = (name: string) => assignCount.get(norm(name)) || 0;

      // Slots being (re)assigned now -- old overrides on these are replaced.
      const slotKey = (e: { class: string; day: string; period_number: number }) =>
        `${e.class}|${e.day}|${e.period_number}`;
      const replacing = new Set(absentEntries.map(slotKey));

      // Load already given today (from earlier runs) counts too.
      existingOverrides.forEach((o) => {
        if (o.effective_date !== today || replacing.has(slotKey(o))) return;
        assignCount.set(norm(o.substitute_teacher), getCount(o.substitute_teacher) + 1);
      });

      // Regular teaching load today (tie-breaker: spare the busiest teachers).
      const regularLoad = new Map<string, number>();
      allTimetableEntries.forEach((e) => {
        if (e.day !== todayName) return;
        const t = norm(e.teacher || e.teacher_name || "");
        if (t) regularLoad.set(t, (regularLoad.get(t) || 0) + 1);
      });

      // Rebuild busy map without overrides that are being replaced.
      busyMap.clear();
      allTimetableEntries.forEach((e) => {
        if (e.day !== todayName) return;
        const t = e.teacher || e.teacher_name || "";
        if (t) addBusy(e.day, e.period_number, t);
      });
      existingOverrides.forEach((o) => {
        if (o.effective_date !== today || replacing.has(slotKey(o))) return;
        addBusy(o.day, o.period_number, o.substitute_teacher);
      });

      const candidates = teachers.filter(
        (t) => t.is_active !== false && !absentNorms.has(norm(t.full_name))
      );
      const subjectOk = (t: Teacher, subjectNorm: string) => {
        const tSub = (t.subject || "").trim().toLowerCase();
        return !!tSub && !!subjectNorm &&
          (tSub === subjectNorm || tSub.includes(subjectNorm) || subjectNorm.includes(tSub));
      };
      const scoreOf = (t: Teacher, subjectNorm: string) =>
        getCount(t.full_name) * 10 +
        (subjectOk(t, subjectNorm) ? 0 : 15) +
        (regularLoad.get(norm(t.full_name)) || 0) * 0.5;

      const assigned: SubstitutionResult["assigned"] = [];
      const uncovered: SubstitutionResult["uncovered"] = [];
      const overridesToUpsert: Array<{
        effective_date: string;
        class: string;
        day: string;
        period_number: number;
        subject: string;
        original_teacher: string | null;
        substitute_teacher: string;
        reason: string;
      }> = [];

      const remaining = [...absentEntries];
      while (remaining.length > 0) {
        // Pick the most constrained remaining entry.
        let bestIdx = 0;
        let bestFree = Infinity;
        remaining.forEach((e, i) => {
          const free = candidates.filter((t) => isFree(t.full_name, e.day, e.period_number)).length;
          if (free < bestFree || (free === bestFree && e.period_number < remaining[bestIdx].period_number)) {
            bestFree = free;
            bestIdx = i;
          }
        });
        const entry = remaining.splice(bestIdx, 1)[0];
        const subjectNorm = (entry.subject || "").trim().toLowerCase();
        const absentOwnerName = (entry.teacher || entry.teacher_name || "").trim();

        const pick = candidates
          .filter((t) => isFree(t.full_name, entry.day, entry.period_number))
          .sort((a, b) =>
            scoreOf(a, subjectNorm) - scoreOf(b, subjectNorm) ||
            (a.display_order || 0) - (b.display_order || 0)
          )[0];

        if (pick) {
          const reason = subjectOk(pick, subjectNorm) ? "subject-match" : "free-period";
          assigned.push({
            class: entry.class,
            day: entry.day,
            period_number: entry.period_number,
            subject: entry.subject,
            original_teacher: entry.teacher || entry.teacher_name || null,
            substitute_teacher: pick.full_name,
            reason,
            absent_teacher: absentOwnerName,
          });
          overridesToUpsert.push({
            effective_date: today,
            class: entry.class,
            day: entry.day,
            period_number: entry.period_number,
            subject: entry.subject,
            original_teacher: entry.teacher || entry.teacher_name || null,
            substitute_teacher: pick.full_name,
            reason,
          });
          addBusy(entry.day, entry.period_number, pick.full_name);
          assignCount.set(norm(pick.full_name), getCount(pick.full_name) + 1);
        } else {
          uncovered.push({
            class: entry.class,
            day: entry.day,
            period_number: entry.period_number,
            subject: entry.subject,
            reason: "No free teacher available",
            absent_teacher: absentOwnerName,
          });
        }
      }

      // 5. Upsert all overrides into the database.
      if (overridesToUpsert.length > 0) {
        const { error } = await supabase
          .from("timetable_overrides")
          .upsert(overridesToUpsert, {
            onConflict: "effective_date,class,day,period_number",
          });
        if (error) throw error;
      }

      return { assigned, uncovered };
    },
    onSuccess: (result, vars) => {
      const today = todayDateStr();
      qc.invalidateQueries({ queryKey: ["timetable-overrides", today] });
      const names =
        vars.absentTeachers && vars.absentTeachers.length > 0
          ? vars.absentTeachers.join(", ")
          : vars.absentTeacher || "";
      const head =
        result.assigned.length === 0
          ? `No substitutes could be assigned for ${names}.`
          : `Assigned ${result.assigned.length} substitute class${result.assigned.length === 1 ? "" : "es"} for ${names} today.`;
      const tail = result.uncovered.length ? ` ${result.uncovered.length} uncovered.` : "";
      toast.success(head + tail);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to assign substitutes");
    },
  });
}

/**
 * Clear all of today's overrides. Useful if the admin made a mistake or
 * the absent teacher suddenly shows up.
 */
export function useClearTodayOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const today = todayDateStr();
      const { data, error } = await supabase
        .from("timetable_overrides")
        .delete()
        .eq("effective_date", today)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (count) => {
      const today = todayDateStr();
      qc.invalidateQueries({ queryKey: ["timetable-overrides", today] });
      toast.success(count > 0 ? `Cleared ${count} substitute assignment${count === 1 ? "" : "s"} for today.` : "No overrides to clear.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to clear overrides");
    },
  });
}
