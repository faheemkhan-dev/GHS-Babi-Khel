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
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Armchair className="w-5 h-5" />
          </span>
          <h2 className="text-lg font-heading font-bold tracking-tight text-foreground">Classes &amp; Seats</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            Seats per class for the new session — High School (Class 6 to 10).
          </p>
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
          <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-primary/20 shadow-sm">
            <table className="w-full text-sm text-center">
              <thead>
                <tr className="bg-primary/10">
                  {["Class", "Seats", "Status"].map((h) => (
                    <th key={h} className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-widest text-primary">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r, i) => (
                  <tr key={r.class} className={`transition-colors hover:bg-primary/5 ${i % 2 ? "bg-muted/30" : "bg-card"}`}>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex items-center justify-center gap-2 font-semibold">
                        <GraduationCap className="w-4 h-4 text-primary shrink-0" />
                        {r.class_label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="font-bold tabular-nums text-base">{r.seats}</span>
                      <span className="text-muted-foreground text-xs"> seats</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      {r.is_open ? (
                        <span className="inline-flex items-center justify-center gap-1 rounded-full border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-2.5 py-1 text-[10px] font-bold text-green-700 dark:text-green-300">
                          <BadgeCheck className="w-3 h-3" /> Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
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

        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
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
