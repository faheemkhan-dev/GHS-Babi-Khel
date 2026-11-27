// src/pages/admin/tabs/AdminAdmissionClasses.tsx — "Classes & Seats" sub-tab
// of Admin → Admissions. Every class 6–10 carries its seats AND its own last
// date (empty = the global last date). Class 9 can close earlier — the BISE
// Peshawar enrollment window ends before the school's general last date.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Loader2, Check, CalendarDays, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";
import { useAdminAdmissionClasses, useSetAdmissionClassSeats, useAdmissionSettings } from "@/hooks/useAdmission";

export default function AdminAdmissionClasses() {
  const { data: rows, isLoading } = useAdminAdmissionClasses();
  const { data: settings } = useAdmissionSettings();
  const setSeatsMut = useSetAdmissionClassSeats();

  // Local drafts so typing doesn't fire a save per keystroke.
  const [seats, setSeats] = useState<Record<string, number>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const seatsKey = rows?.map((r) => `${r.class}:${r.seats}`).join(",") ?? "";
  const datesKey = rows?.map((r) => `${r.class}:${r.last_date ?? ""}`).join(",") ?? "";

  useEffect(() => {
    if (rows) {
      setSeats(Object.fromEntries(rows.map((r) => [r.class, r.seats])));
      setDates(Object.fromEntries(rows.map((r) => [r.class, r.last_date ?? ""])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatsKey, datesKey]);

  const dirtySeats = (cls: string): boolean => {
    const row = rows?.find((r) => r.class === cls);
    return row ? seats[cls] !== row.seats : false;
  };
  const dirtyDate = (cls: string): boolean => {
    const row = rows?.find((r) => r.class === cls);
    return row ? (dates[cls] || "") !== (row.last_date ?? "") : false;
  };

  const saveSeats = async (cls: string) => {
    const value = seats[cls];
    if (value == null || Number.isNaN(value)) return;
    try {
      await setSeatsMut.mutateAsync({ class: cls, seats: value });
      toast.success(`Class ${cls} seats saved — ${value}.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not save seats.");
    }
  };

  const saveDate = async (cls: string) => {
    const value = dates[cls] ?? "";
    try {
      await setSeatsMut.mutateAsync(
        value ? { class: cls, last_date: value } : { class: cls, clear_last_date: true },
      );
      toast.success(
        value
          ? `Class ${cls} last date saved — ${value}.`
          : `Class ${cls} now uses the global last date.`,
      );
    } catch (e: any) {
      toast.error(e?.message || "Could not save the last date.");
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
        <div className="mx-auto max-w-lg overflow-hidden rounded-xl border border-border/70 bg-card">
          {/* column labels */}
          <div className="grid grid-cols-[80px_1fr_1fr_44px] items-center gap-1 border-b border-border/70 bg-secondary/50 px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Class</span>
            <span>Seats</span>
            <span className="flex items-center justify-center gap-1"><CalendarDays className="h-3 w-3" /> Last Date</span>
            <span aria-hidden>&nbsp;</span>
          </div>

          <ul className="divide-y divide-border/60">
            {rows.map((r) => {
              const dS = dirtySeats(r.class);
              const dD = dirtyDate(r.class);
              return (
                <li key={r.class} className="grid grid-cols-[80px_1fr_1fr_44px] items-center gap-1 px-2 py-2.5 text-center">
                  <p className="whitespace-nowrap text-[13px] font-semibold leading-none text-foreground">Class {r.class}</p>

                  {/* seats */}
                  <div className="relative flex justify-center">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10000}
                      value={seats[r.class] ?? r.seats}
                      onChange={(e) => setSeats((d) => ({ ...d, [r.class]: Number(e.target.value) }))}
                      aria-label={`Seats for class ${r.class}`}
                      className={`h-8 w-16 rounded-md border bg-background p-0 text-center text-[13px] font-semibold leading-none tabular-nums outline-none transition-[border-color,box-shadow] focus:border-[hsl(var(--gold))] focus:ring-2 focus:ring-[hsl(var(--gold)/0.2)] ${dS ? "border-[hsl(var(--gold))]" : "border-border/80"}`}
                    />
                    {dS && (
                      <button
                        type="button"
                        onClick={() => saveSeats(r.class)}
                        disabled={setSeatsMut.isPending}
                        aria-label={`Save class ${r.class} seats`}
                        className="absolute left-1/2 top-0 ml-10 grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground active:opacity-80 disabled:opacity-60"
                      >
                        {setSeatsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  {/* per-class last date (empty = global) */}
                  <div className="relative flex justify-center">
                    <Input
                      type="date"
                      value={dates[r.class] ?? ""}
                      onChange={(e) => setDates((d) => ({ ...d, [r.class]: e.target.value }))}
                      aria-label={`Last date for class ${r.class}`}
                      className={`h-8 w-[128px] rounded-md border bg-background px-1.5 text-center text-[11.5px] tabular-nums ${dD ? "border-[hsl(var(--gold))]" : "border-border/80"}`}
                    />
                    {dD && (
                      <button
                        type="button"
                        onClick={() => saveDate(r.class)}
                        disabled={setSeatsMut.isPending}
                        aria-label={`Save class ${r.class} last date`}
                        className="absolute left-1/2 top-0 ml-[72px] grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground active:opacity-80 disabled:opacity-60"
                      >
                        {setSeatsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                    )}
                    {!dates[r.class] && (
                      <span
                        className="pointer-events-none absolute -bottom-0.5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[9px] text-muted-foreground"
                        aria-hidden
                      />
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

          <div className="border-t border-border/70 bg-muted/20 px-3 py-2">
            <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
              <X className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                An empty Last Date uses the global last date ({settings?.last_date || "not set"}).
                Set an earlier date for Class 9 — the BISE Peshawar enrollment window
                (Rs 1,300 by 30 Sep 2026) closes before the school's general last date.
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
