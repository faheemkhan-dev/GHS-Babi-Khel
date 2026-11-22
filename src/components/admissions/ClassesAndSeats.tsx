// src/components/admissions/ClassesAndSeats.tsx — public "Classes & Seats"
// section for the admission home. High School model: every class has its
// number of seats DIRECTLY — no programs, no quotas.
//
// Design: centred serif title, then ONE premium card — a slim column-header
// strip, then airy rows (class · seats · status) with an open/closed accent
// rail. No class icons. A total-seats footer sums the open classes.
// ═══════════════════════════════════════════════════════════════════════════

import { memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmissionClassSeats } from "@/hooks/useAdmission";

function ClassesAndSeatsBase({ processingFee }: { processingFee?: number | null }) {
  const { data: rows, isLoading } = useAdmissionClassSeats();
  const openSeats = (rows ?? []).filter((r) => r.is_open).reduce((a, r) => a + (Number(r.seats) || 0), 0);

  return (
    <section id="classes-seats" className="scroll-mt-24">
      <div className="mb-4 text-center">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gold-strong">Admission</p>
        <h2 className="text-xl font-bold text-foreground sm:text-2xl" style={{ fontFamily: "var(--font-display)" }}>
          Classes &amp; Seats
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Seats available per class for the new session
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-2xl border border-gold/30 bg-card px-4 py-8 text-center shadow-card">
          <p className="text-sm text-muted-foreground">Seats will be announced by the school soon.</p>
        </div>
      ) : (
        <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card">
          <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />

          {/* column headers — centred */}
          <div className="grid grid-cols-3 items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <span>Class</span>
            <span>Seats</span>
            <span>Status</span>
          </div>

          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li
                key={r.class}
                className={`grid grid-cols-3 items-center gap-2 border-l-[3px] px-3 py-2.5 text-center ${
                  r.is_open ? "border-l-primary" : "border-l-transparent"
                }`}
              >
                <span
                  className={`min-w-0 truncate text-[14px] font-semibold leading-tight ${r.is_open ? "text-foreground" : "text-muted-foreground"}`}
                  style={{ fontFamily: "var(--font-luxe, var(--font-display))" }}
                >
                  {r.class_label}
                </span>
                {/* "60 seats" — one normal, light line */}
                <span className="whitespace-nowrap text-[13px] font-normal tabular-nums text-foreground/80">
                  {r.seats} seats
                </span>
                <span className="flex justify-center">
                  {r.is_open ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Open
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" /> Closed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {openSeats > 0 && (
            <div className="border-t border-gold/30 bg-gold/10 px-3 py-2 text-center text-[11.5px] text-foreground/80">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold-strong">Total open seats</span>
              <span className="ml-2 font-normal tabular-nums">{openSeats} seats</span>
            </div>
          )}
        </div>
      )}

      <ul className="mx-auto mt-4 max-w-lg space-y-1.5 text-center text-[11px] leading-snug text-muted-foreground">
        <li>Every applicant competes for the class seats on merit</li>
        <li>One application per student per session</li>
      </ul>
    </section>
  );
}

const ClassesAndSeats = memo(ClassesAndSeatsBase);
export default ClassesAndSeats;
