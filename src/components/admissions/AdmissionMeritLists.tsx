// src/components/admissions/AdmissionMeritLists.tsx — public "Merit Lists"
// section for the admission home (GHSS Ghallanai feature, High School
// adaptation: lists are per CLASS — no programs / quotas). Shows every
// published list as a card; a dialog reveals the ranked entries with a
// live "find yourself" search.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Loader2, Search, X, ListChecks, CalendarDays, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdmissionMeritLists, useAdmissionMeritList } from "@/hooks/useAdmission";
import type { PublicMeritListRow } from "@/lib/admissionPayment";

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return String(v);
  }
}

function MeritListDialog({ row, onClose }: { row: PublicMeritListRow | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["admission-merit-list", row?.id],
    queryFn: async () => {
      if (!row) return null;
      const { fetchMeritListPublic } = await import("@/lib/admissionPayment");
      return fetchMeritListPublic(row.id);
    },
    enabled: !!row,
    staleTime: 60 * 1000,
  });
  const [q, setQ] = useState("");

  const entries = useMemo(() => {
    if (!data?.entries) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.entries;
    return data.entries.filter(
      (e) => e.name.toLowerCase().includes(needle) || e.reference_no.toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-1.5rem)] max-h-[85vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-left flex items-start gap-2.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Trophy className="w-4 h-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-snug">{row.class_label} — Merit List #{row.list_no}</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    Session {row.session_year ?? ""} · Government High School Babi Khel
                  </span>
                </span>
              </DialogTitle>
            </DialogHeader>

            {!data ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading merit list…
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Admission Start</p>
                    <p className="text-xs font-semibold mt-0.5">{fmtDate(data.list.admission_start_date)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Join By</p>
                    <p className="text-xs font-semibold mt-0.5">{fmtDate(data.list.admission_last_date)}</p>
                  </div>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder="Find yourself: Reference No. or name"
                    className="h-10 rounded-full pl-9 text-sm" />
                  {q && (
                    <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-full border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-2.5 py-1 font-bold text-green-700 dark:text-green-300">
                    {data.listed_count} Merit Listed
                  </span>
                  {data.not_listed_count > 0 && (
                    <span className="rounded-full border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-2.5 py-1 font-bold text-red-600 dark:text-red-300">
                      {data.not_listed_count} Not Merit Listed
                    </span>
                  )}
                </div>

                {/* Mobile: cards */}
                <div className="md:hidden space-y-2">
                  {entries.map((e) => (
                    <div key={e.position} className={`rounded-xl border p-3 text-center ${e.is_listed ? "border-border/60 bg-card" : "border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900"}`}>
                      <p className="text-[10px] text-muted-foreground font-bold">#{e.position}</p>
                      <p className="text-sm font-bold leading-snug">{e.name}</p>
                      {e.father_name && <p className="text-[11px] text-muted-foreground">S/O {e.father_name}</p>}
                      <p className="text-[11px] font-mono text-primary mt-0.5">{e.reference_no}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
        {e.previous_marks || "—"}{e.marks_pct != null ? ` · ${Number(e.marks_pct).toFixed(2)}%` : ""}
                      </p>
                      {e.remarks && (
                        <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${e.is_listed ? "bg-muted text-muted-foreground" : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>
                          {e.remarks}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/60 text-left">
                        {["#", "Reference No.", "Name", "Father Name", "Marks", "%", "Remarks"].map((h, i) => (
                          <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${i >= 5 ? "text-right" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {entries.map((e) => (
                        <tr key={e.position} className={!e.is_listed ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                          <td className="px-3 py-2 font-bold tabular-nums">{e.position}</td>
                          <td className="px-3 py-2 font-mono text-xs">{e.reference_no}</td>
                          <td className="px-3 py-2 font-medium">{e.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{e.father_name || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.previous_marks || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{e.marks_pct != null ? Number(e.marks_pct).toFixed(2) : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {e.is_listed ? (
                              <span className="text-muted-foreground text-xs">{e.remarks || "—"}</span>
                            ) : (
                              <span className="rounded-full bg-red-100 dark:bg-red-950/50 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">Not Merit Listed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {data.list.instructions && (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <p className="text-xs font-bold flex items-center gap-1.5 mb-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" /> Instructions
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                      {data.list.instructions.split(/\n+/).filter(Boolean).map((l, i) => <li key={i}>{l.replace(/^\d+\.\s*/, "")}</li>)}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function AdmissionMeritLists() {
  const { data: rows, isLoading } = useAdmissionMeritLists();
  const [selected, setSelected] = useState<PublicMeritListRow | null>(null);

  return (
    <Card id="merit-lists" className="rounded-2xl border-border/60 shadow-sm scroll-mt-24">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Trophy className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-heading font-bold tracking-tight text-foreground">Merit Lists</h2>
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              Published automatically from the class seats — ranked on previous class marks.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No merit list has been published yet. Lists appear here as soon as the school publishes them after the admission deadline.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-border/60 bg-card p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">{r.class_label}</p>
                  <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">List #{r.list_no}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-300">
                    {r.listed_count} Merit Listed
                  </span>
                  {r.not_listed_count > 0 && (
                    <span className="rounded-full border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-300">
                      {r.not_listed_count} Not Listed
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3 shrink-0" />
                  Published {fmtDate(r.published_at)}{r.admission_last_date ? ` · Join by ${fmtDate(r.admission_last_date)}` : ""}
                </p>
                <Button size="sm" onClick={() => setSelected(r)}
                  className="h-8 w-full gap-1.5 rounded-full px-3 text-xs font-bold">
                  <ListChecks className="w-3.5 h-3.5" /> View Merit List
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <MeritListDialog row={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
