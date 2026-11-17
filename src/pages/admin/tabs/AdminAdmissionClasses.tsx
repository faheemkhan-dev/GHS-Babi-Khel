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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import { useAdminAdmissionClasses, useSetAdmissionClassSeats } from "@/hooks/useAdmission";
import { format } from "date-fns";

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
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3 mb-1">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Armchair className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-heading font-bold tracking-tight text-foreground sm:text-lg">Classes &amp; Seats</h2>
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                Seats per class for the new session. The auto merit list fills these seats — every
                fee-paid applicant competes on merit, no quotas.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="mt-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : !rows || rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No classes configured yet — run Supabase migration 20.
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    {["Class", "Seats", "Open for Admission", ""].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r) => (
                    <tr key={r.class} className="hover:bg-primary/5 transition-colors">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2 font-semibold">
                          <GraduationCap className="w-4 h-4 text-primary shrink-0" />
                          Class {r.class}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={10000}
                            value={drafts[r.class] ?? r.seats}
                            onChange={(e) => setDrafts((d) => ({ ...d, [r.class]: Number(e.target.value) }))}
                            className="h-9 w-24 text-sm tabular-nums"
                          />
                          {dirty(r.class) && (
                            <Button size="sm" onClick={() => saveSeats(r.class)} disabled={setSeatsMut.isPending}
                              className="h-9 gap-1.5 rounded-full px-3 text-xs font-bold">
                              {setSeatsMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {r.is_open ? (
                            <Badge className="border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-700 dark:text-green-300 text-[10px] font-bold">
                              <Unlock className="w-3 h-3 mr-1" /> Open
                            </Badge>
                          ) : (
                            <Badge className="border border-border bg-muted/50 text-muted-foreground text-[10px] font-bold">
                              <Lock className="w-3 h-3 mr-1" /> Closed
                            </Badge>
                          )}
                          <Switch checked={r.is_open} onCheckedChange={(v) => toggleOpen(r.class, v)} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-[10px] text-muted-foreground whitespace-nowrap">
                        {format(new Date(r.updated_at), "dd MMM yy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            <b>Seats filled by earlier published lists are never double-counted</b> — generating merit
            list #2 only fills the seats left over after list #1. Setting seats to 0 with applications
            still pending means nobody new is selected (everyone appears as Not Merit Listed).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
