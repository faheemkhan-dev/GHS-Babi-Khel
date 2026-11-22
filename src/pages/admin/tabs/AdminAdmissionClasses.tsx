// src/pages/admin/tabs/AdminAdmissionClasses.tsx — "Classes & Seats" sub-tab
// of Admin → Admissions (GHSS Ghallanai "Programs & Seats", High School
// model: every class 6–10 carries its number of seats DIRECTLY — no
// faculties, no quotas). Inline seat editing + open/close switch per class.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import { useAdminAdmissionClasses, useSetAdmissionClassSeats } from "@/hooks/useAdmission";

export default function AdminAdmissionClasses() {
  const { data: rows, isLoading } = useAdminAdmissionClasses();
  const setSeatsMut = useSetAdmissionClassSeats();

  // Local draft of seat values so typing doesn't fire a save per keystroke.
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const seatsKey = rows?.map((r) => `${r.class}:${r.seats}`).join(",") ?? "";

  useEffect(() => {
    if (rows) setDrafts(Object.fromEntries(rows.map((r) => [r.class, r.seats])));
    // Re-seed whenever the saved seats change (first load + after each save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatsKey]);

  const dirty = (cls: string): boolean => {
    const row = rows?.find((r) => r.class === cls);
    return row ? drafts[cls] !== row.seats : false;
  };

  const saveSeats = async (cls: string) => {
    const value = drafts[cls];
    if (value == null || Number.isNaN(value)) return;
    try {
      await setSeatsMut.mutateAsync({ class: cls, seats: value });
      toast.success(`Class ${cls} seats saved — ${value}.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not save seats.");
    }
  };

  const toggleOpen = async (cls: string, next: boolean) => {
    try {
      await setSeatsMut.mutateAsync({ class: cls, is_open: next });
      toast.success(
        next
          ? `Class ${cls} re-opened for admission.`
          : `Class ${cls} closed for admission.`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Could not update the class.");
    }
  };

  const totalSeats = rows?.reduce((sum, r) => sum + (r.seats || 0), 0) ?? 0;
  const openCount = rows?.filter((r) => r.is_open).length ?? 0;

  return (
    <div className="pb-16">
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No classes configured yet — run Supabase migration 20.
        </p>
      ) : (
        <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-border/70 bg-card">
          {/* column labels — three equal columns, everything centred */}
          <div className="grid grid-cols-3 items-center border-b border-border/70 bg-secondary/50 px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Class</span>
            <span>Seats</span>
            <span aria-hidden>&nbsp;</span>
          </div>

          <ul className="divide-y divide-border/60">
            {rows.map((r) => {
              const isDirty = dirty(r.class);
              return (
                <li key={r.class} className="grid grid-cols-3 items-center px-2 py-2.5 text-center">
                  <p className="whitespace-nowrap text-[13px] font-semibold leading-none text-foreground">Class {r.class}</p>

                  {/* seats: thin input centred; save tick floats beside it so nothing shifts */}
                  <div className="relative flex justify-center">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10000}
                      value={drafts[r.class] ?? r.seats}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.class]: Number(e.target.value) }))}
                      aria-label={`Seats for class ${r.class}`}
                      className={`h-8 w-16 rounded-lg border bg-background p-0 text-center text-[13px] font-semibold leading-none tabular-nums outline-none transition-[border-color,box-shadow] focus:border-[hsl(var(--gold))] focus:ring-2 focus:ring-[hsl(var(--gold)/0.2)] ${isDirty ? "border-[hsl(var(--gold))]" : "border-border/80"}`}
                    />
                    {isDirty && (
                      <button
                        type="button"
                        onClick={() => saveSeats(r.class)}
                        disabled={setSeatsMut.isPending}
                        aria-label={`Save class ${r.class} seats`}
                        className="absolute left-1/2 top-0 ml-10 grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground active:opacity-80 disabled:opacity-60"
                      >
                        {setSeatsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <Switch
                      checked={r.is_open}
                      onCheckedChange={(v) => toggleOpen(r.class, v)}
                      className="origin-center scale-[0.8]"
                      aria-label={`Toggle admission for class ${r.class}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between border-t border-border/70 bg-secondary/40 px-3.5 py-2 text-[10.5px] font-medium text-muted-foreground">
            <span>{openCount} of {rows.length} classes open</span>
            <span>Total seats <b className="ml-1 text-[12px] font-bold tabular-nums text-foreground">{totalSeats}</b></span>
          </div>
        </div>
      )}
    </div>
  );
}
