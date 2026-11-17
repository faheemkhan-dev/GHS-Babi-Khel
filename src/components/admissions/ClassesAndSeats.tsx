// src/components/admissions/ClassesAndSeats.tsx — public "Classes & Seats"
// section for the admission home (GHSS Ghallanai "Programs & Seats", High
// School model: every class 6–10 has its number of seats DIRECTLY — no
// programs, no quotas).
// ═══════════════════════════════════════════════════════════════════════════

import { memo } from "react";
import { GraduationCap, Armchair, Lock, BadgeCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmissionClassSeats } from "@/hooks/useAdmission";

function ClassesAndSeatsBase({ processingFee }: { processingFee?: number | null }) {
  const { data: rows, isLoading } = useAdmissionClassSeats();

  return (
    <Card id="classes-seats" className="rounded-2xl border-border/60 shadow-sm scroll-mt-24">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Armchair className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-heading font-bold tracking-tight text-foreground">Classes &amp; Seats</h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              Seats per class for the new session — High School (Class 6 to 10).
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Seats will be announced by the school soon.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 text-left">
                  {["Class", "Seats", "Status"].map((h, i) => (
                    <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i === 2 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr key={r.class} className="transition-colors hover:bg-primary/5">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2 font-semibold">
                        <GraduationCap className="w-4 h-4 text-primary shrink-0" />
                        {r.class_label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-bold tabular-nums">{r.seats}</span>
                      <span className="text-muted-foreground text-xs"> seats</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.is_open ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-300">
                          <BadgeCheck className="w-3 h-3" /> Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          <Lock className="w-3 h-3" /> Closed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-semibold text-primary">
            Every applicant competes for the class seats on merit
          </span>
          <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-semibold text-primary">
            One application per student per session
          </span>
          {!!processingFee && processingFee > 0 && (
            <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-[10px] font-semibold text-primary">
              Processing fee Rs {Number(processingFee).toLocaleString("en-PK")} per application
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const ClassesAndSeats = memo(ClassesAndSeatsBase);
export default ClassesAndSeats;
