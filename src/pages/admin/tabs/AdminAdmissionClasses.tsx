// src/pages/admin/tabs/AdminAdmissionClasses.tsx — "Classes & Seats" sub-tab
// of Admin → Admissions (GHSS Ghallanai "Programs & Seats", High School
// model: every class 6–10 carries its number of seats DIRECTLY — no
// faculties, no quotas). Inline seat editing + open/close switch per class.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { GraduationCap, Loader2, Save, Armchair, Lock, Unlock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="space-y-4 pb-16">
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="p-3 sm:p-5">
          <div className="mb-4 flex flex-col items-center text-center">
            <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Armchair className="h-5 w-5" />
            </span>
            <h2 className="font-heading text-base font-bold tracking-tight text-foreground sm:text-lg">Classes &amp; Seats</h2>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No classes configured yet — run Supabase migration 20.
            </p>
          ) : (
            <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-primary/20 shadow-sm">
              <table className="w-full table-fixed text-center">
                <thead>
                  <tr className="bg-primary/10">
                    {["Class", "Seats", "Status"].map((h) => (
                      <th key={h} className="px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-primary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r, i) => (
                    <tr key={r.class} className={i % 2 ? "bg-muted/30" : "bg-card"}>
                      <td className="px-2 py-3 align-middle">
                        <span className="inline-flex flex-col items-center gap-0.5 sm:flex-row sm:gap-1.5">
                          <GraduationCap className="h-4 w-4 shrink-0 text-primary" />
                          <span className="whitespace-nowrap text-[13px] font-bold">Class {r.class}</span>
                        </span>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <div className="flex flex-col items-center gap-1.5">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={10000}
                            value={drafts[r.class] ?? r.seats}
                            onChange={(e) => setDrafts((d) => ({ ...d, [r.class]: Number(e.target.value) }))}
                            className="h-8 w-16 rounded-lg px-1 text-center text-sm font-bold tabular-nums"
                          />
                          {dirty(r.class) && (
                            <Button size="sm" onClick={() => saveSeats(r.class)} disabled={setSeatsMut.isPending}
                              className="h-7 gap-1 whitespace-nowrap rounded-full px-3 text-[11px] font-bold shadow-none">
                              {setSeatsMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <div className="flex flex-col items-center gap-1.5">
                          <Switch checked={r.is_open} onCheckedChange={(v) => toggleOpen(r.class, v)} />
                          {r.is_open ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 dark:text-green-300">
                              <Unlock className="h-3 w-3" /> Open
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                              <Lock className="h-3 w-3" /> Closed
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
