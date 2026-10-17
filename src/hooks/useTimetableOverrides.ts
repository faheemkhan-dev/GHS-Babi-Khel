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

      // 3. Round-robin across absent teachers so each gets fair coverage.
      //    Group entries by absent teacher (preserving original order), then
      //    pull one entry per teacher in turn. This means if teacher A and
      //    teacher B both have a Period-1 class, they get DIFFERENT
      //    substitutes (instead of one teacher eating both).
      const entriesByAbsent = new Map<string, typeof absentEntries>();
      absentEntries.forEach((e) => {
        const ownerKey = (e.teacher || e.teacher_name || "").trim().toLowerCase();
        if (!entriesByAbsent.has(ownerKey)) entriesByAbsent.set(ownerKey, []);
        entriesByAbsent.get(ownerKey)!.push(e);
      });
      // Stable per-teacher order: sort each bucket by period_number.
      entriesByAbsent.forEach((arr) => {
        arr.sort((a, b) => a.period_number - b.period_number);
      });
      // Round-robin: take one from each absent teacher in turn until empty.
      const ownerOrder = Array.from(entriesByAbsent.keys()); // original teachers (lower)
      const orderedEntries: typeof absentEntries = [];
      let anyLeft = true;
      while (anyLeft) {
        anyLeft = false;
        for (const owner of ownerOrder) {
          const arr = entriesByAbsent.get(owner);
          if (arr && arr.length > 0) {
            orderedEntries.push(arr.shift()!);
            anyLeft = true;
          }
        }
      }

      // 4. For each entry in round-robin order, pick a substitute.
      //
      // LOAD BALANCING: previously this always picked the FIRST free
      // teacher by display_order — meaning if e.g. "Faheem" happened to be
      // early in that list and free at several periods, he'd get picked
      // for every single one of those slots while other equally-free
      // teachers never got touched at all (one teacher doing 3 subs, two
      // periods left completely uncovered, while a dozen other free
      // teachers sat idle). That's not actually "no free teacher available"
      // — it's the algorithm re-picking the same person out of habit.
      //
      // Fix: track how many substitute periods each teacher has already
      // picked up during THIS run (assignCount), and among the free
      // candidates for each slot, prefer whoever currently has the FEWEST
      // assignments so far. Ties fall back to display_order for stability.
      // This spreads coverage across the whole free-teacher pool instead of
      // repeatedly loading up one or two people.
      const assignCount = new Map<string, number>(); // teacherLower → count this run
      const getCount = (name: string) => assignCount.get(name.trim().toLowerCase()) || 0;
      const bumpCount = (name: string) => {
        const key = name.trim().toLowerCase();
        assignCount.set(key, (assignCount.get(key) || 0) + 1);
      };
      const byLoadThenOrder = (a: Teacher, b: Teacher) => {
        const diff = getCount(a.full_name) - getCount(b.full_name);
        if (diff !== 0) return diff;
        return (a.display_order || 0) - (b.display_order || 0);
      };

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

      for (const entry of orderedEntries) {
        const entrySubject = entry.subject?.trim() || "";
        const entrySubjectNorm = entrySubject.toLowerCase();
        const absentOwnerName = (entry.teacher || entry.teacher_name || "").trim();

        // Candidate pool: all active teachers EXCEPT any absent one.
        const candidates = teachers.filter(
          (t) => !absentNorms.has(t.full_name.trim().toLowerCase())
        );

        // Strategy 1: subject match + free — among matches, prefer the
        // least-loaded teacher so far this run, not just the first in list.
        let pick: Teacher | undefined;
        let reason = "";
        const subjectMatches = candidates
          .filter((t) => {
            const tSub = (t.subject || "").trim().toLowerCase();
            return tSub && (tSub === entrySubjectNorm || tSub.includes(entrySubjectNorm) || entrySubjectNorm.includes(tSub));
          })
          .filter((t) => isFree(t.full_name, entry.day, entry.period_number))
          .sort(byLoadThenOrder);
        if (subjectMatches.length > 0) {
          pick = subjectMatches[0];
          reason = "subject-match";
        }

        // Strategy 2: any free teacher (fallback — no subject match),
        // again preferring whoever has picked up the fewest subs so far.
        if (!pick) {
          const anyFree = candidates
            .filter((t) => isFree(t.full_name, entry.day, entry.period_number))
            .sort(byLoadThenOrder);
          if (anyFree.length > 0) {
            pick = anyFree[0];
            reason = "free-period";
          }
        }

        if (pick) {
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
          // Mark this substitute as busy at this period for subsequent entries
          // (so we don't assign the same substitute to two classes at once —
          // even across different absent teachers), AND bump their load
          // count so the next slot prefers someone else.
          addBusy(entry.day, entry.period_number, pick.full_name);
          bumpCount(pick.full_name);
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
