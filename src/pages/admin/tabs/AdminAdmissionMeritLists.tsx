// src/pages/admin/tabs/AdminAdmissionMeritLists.tsx — the ADMIN Merit Lists
// console. Lists are per CLASS and per TYPE (fresh / migration), ranked on
// previous class marks:
//
//   • Auto Merit dialog: class (or all), type (all/fresh/migration), list no.,
//     dates, instructions, publish switch → Preview (dry run) / Generate.
//   • Lists table: published/draft per class, publish / unpublish, delete
//     (drafts), show/hide "Not Merit Listed" names (privacy), PDF download.
//   • View dialog: exactly what the public sees + inline editable remarks.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import {
  Trophy, Zap, ScanSearch, Eye, Globe, GlobeLock, Trash2, Loader2,
  CalendarDays, CalendarCheck2, Save, AlertTriangle, ListChecks,
  FileDown, EyeOff, Eye as EyeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import {
  useAdminAdmissionMeritLists, useAdminAdmissionMeritList,
  useAdmissionMeritAuto, useAdmissionMeritPublish, useAdmissionMeritDelete,
  useAdmissionMeritRemark, useAdmissionMeritShowNotListed,
} from "@/hooks/useAdmission";
import { downloadMeritListPdf } from "@/lib/admissionMeritPdf";

interface ClassResult {
  class: string;
  class_label: string;
  seats: number;
  taken: number;
  seats_left: number;
  eligible: number;
  selected: number;
  waiting: number;
  unpaid: number;
  cutoff: number | null;
  list_id?: string;
}

interface MeritListRow {
  id: string;
  class: string;
  list_no: number;
  title: string | null;
  session_year: string | null;
  admission_start_date: string | null;
  admission_last_date: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  show_not_listed?: boolean;
  listed_count: number;
  not_listed_count: number;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString("en-PK", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return String(v);
  }
}

/* ══ Auto Merit dialog — class + type scoped generation ════════════════════ */
function AutoMeritDialog({ open, onClose, presetListNo }: { open: boolean; onClose: () => void; presetListNo: number }) {
  const meritMut = useAdmissionMeritAuto();
  const [listNo, setListNo] = useState(String(Math.max(1, presetListNo)));
  const [startDate, setStartDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [publish, setPublish] = useState(false);
  const [cls, setCls] = useState("all");
  const [type, setType] = useState<"all" | "fresh" | "migration">("all");
  const [preview, setPreview] = useState<ClassResult[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const n = Math.max(1, Math.floor(Number(listNo) || 0));
  const scopeLabel = cls === "all" ? "ALL classes" : `Class ${cls}`;
  const typeLabel = type === "all" ? "" : type === "fresh" ? " (Fresh)" : " (Migration)";

  const run = async (dryRun: boolean) => {
    if (!dryRun) {
      const ok = window.confirm(
        `Create merit list #${n} for ${scopeLabel}${typeLabel} now?\n\nEvery fee-paid applicant is ranked by previous class marks and the top ones up to each class's seats become Merit Listed. Old lists of this number are replaced.`,
      );
      if (!ok) return;
    }
    setPreviewing(dryRun);
    try {
      const res: any = await meritMut.mutateAsync({
        list_no: n,
        admission_start_date: startDate || null,
        admission_last_date: lastDate || null,
        instructions: instructions || null,
        publish,
        dry_run: dryRun,
        class: cls === "all" ? null : cls,
        type,
      });
      if (dryRun) {
        setPreview((res?.lists ?? []) as ClassResult[]);
      } else {
        const lists = (res?.lists ?? []) as ClassResult[];
        const selected = lists.reduce((s, c) => s + (c.selected ?? 0), 0);
        const notListed = lists.reduce((s, c) => s + (c.waiting ?? 0), 0);
        toast.success(`Done: ${selected} Merit Listed, ${notListed} Not Merit Listed${res?.published ? ", published" : ""}.`);
        onClose();
        setPreview(null);
        setInstructions("");
      }
    } catch (e: any) {
      toast.error(e?.message || "Merit list failed.");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); } }}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[88vh] overflow-y-auto rounded-2xl p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold-strong">
              <Zap className="h-4 w-4" />
            </span>
            Merit List Generator
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs font-bold mb-1 block">List No.</Label>
              <Input type="number" min={1} max={50} value={listNo}
                onChange={(e) => setListNo(e.target.value)} className="h-9 rounded-md text-sm" />
            </div>
            <div>
              <Label className="text-xs font-bold mb-1 block">Class</Label>
              <Select value={cls} onValueChange={setCls}>
                <SelectTrigger className="h-9 rounded-md text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All classes</SelectItem>
                  {["6", "7", "8", "9", "10"].map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold mb-1 block">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "all" | "fresh" | "migration")}>
                <SelectTrigger className="h-9 rounded-md text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="fresh">Fresh</SelectItem>
                  <SelectItem value="migration">Migration</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs font-bold mb-1 block">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 rounded-md text-sm" />
            </div>
            <div>
              <Label className="text-xs font-bold mb-1 block">Last Date</Label>
              <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} className="h-9 rounded-md text-sm" />
            </div>
          </div>

          <div>
            <Label className="text-xs font-bold mb-1 block">Instructions</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder="Instructions shown with the lists (optional, a standard set is used if empty)"
              className="text-xs min-h-[70px]" />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground">Publish immediately.</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Lists go public right away. Leave off to check them as drafts first.
              </p>
            </div>
            <Switch checked={publish} onCheckedChange={setPublish} />
          </div>

          {preview && (
            <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/[0.04] p-3">
              {preview.map((c) => (
                <div key={c.class} className="rounded-lg border border-border/60 bg-card p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-xs font-bold">{c.class_label}</p>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {c.selected} / {c.seats_left} seats
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {[
                      ["Seats", c.seats],
                      ["Eligible", c.eligible],
                      ["Not Listed", c.waiting],
                      ["Cut-off", c.cutoff != null ? `${Number(c.cutoff).toFixed(1)}%` : "—"],
                    ].map(([k, v]) => (
                      <div key={String(k)} className="rounded-md bg-muted/50 px-1 py-1.5">
                        <p className="text-[13px] font-bold tabular-nums leading-none">{v}</p>
                        <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{k}</p>
                      </div>
                    ))}
                  </div>
                  {c.seats === 0 && (
                    <p className="mt-1.5 text-[10px] font-semibold text-amber-600">
                      No seats set for this class. Set them in Classes &amp; Seats.
                    </p>
                  )}
                  {c.unpaid > 0 && (
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {c.unpaid} application(s) with unpaid fee are not included.
                    </p>
                  )}
                </div>
              ))}
              {preview.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  No open class with a fee-paid applicant matched.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={previewing || meritMut.isPending}
              className="h-9 flex-1 gap-1.5 rounded-md text-xs font-bold">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              Preview
            </Button>
            <Button onClick={() => run(false)} disabled={previewing || meritMut.isPending}
              className="h-9 flex-1 gap-1.5 rounded-md text-xs font-bold">
              {meritMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Generate{cls === "all" ? " All" : ` Class ${cls}`}
            </Button>
          </div>

          <p className="border-t border-border/60 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
            Ranking: previous class marks (percentage), ties go to the earlier application. Every fee-paid
            applicant appears in the list: inside the seats = Merit Listed, the rest = Not Merit Listed.
            Running the same list number again replaces the old lists, so nothing is duplicated.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ══ View list dialog — public view + editable remarks + PDF ═══════════════ */
function ViewListDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useAdminAdmissionMeritList(id);
  const remarkMut = useAdmissionMeritRemark();
  const showMut = useAdmissionMeritShowNotListed();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const saveRemark = async (entryId: string) => {
    const value = (drafts[entryId] ?? "").trim();
    setSavingId(entryId);
    try {
      await remarkMut.mutateAsync({ entryId, remarks: value });
      toast.success("Remark updated.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save the remark.");
    } finally {
      setSavingId(null);
    }
  };

  const downloadPdf = async () => {
    if (!data?.ok) return;
    setPdfBusy(true);
    try {
      await downloadMeritListPdf({
        list: data.list,
        entries: data.entries,
        listedCount: data.listed_count,
        notListedCount: data.not_listed_count,
      });
    } catch (e: any) {
      toast.error(e?.message || "Could not build the PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  const toggleNotListed = async () => {
    if (!data?.ok) return;
    const next = !data.list.show_not_listed;
    const ok = window.confirm(
      next
        ? "Show the names of Not Merit Listed students on the public list?"
        : "HIDE the names of Not Merit Listed students from the public list? (their count stays visible)",
    );
    if (!ok) return;
    try {
      await showMut.mutateAsync({ id: data.list.id, show: next });
      toast.success(next ? "Not-listed names are visible." : "Not-listed names are hidden.");
    } catch (e: any) {
      toast.error(e?.message || "Could not update the visibility.");
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[calc(100vw-1.5rem)] max-h-[88vh] overflow-y-auto rounded-2xl p-4 sm:p-5">
        {isLoading || !data?.ok ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {isLoading ? <><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" /> Loading merit list…</> : "This merit list is no longer available."}
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-left">
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <span className="rounded-full bg-gold/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gold-strong">
                    Merit List #{data.list.list_no}
                  </span>
                  <span className="text-base font-bold leading-tight">
                    {data.list.class_label} · Session {data.list.session_year ?? ""}
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">Government High School Babi Khel</span>
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              {/* dates */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gold/40 bg-gold/5 p-2.5 text-center">
                  <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
                    <CalendarDays className="h-3 w-3" /> Admission Start
                  </p>
                  <p className="mt-0.5 text-xs font-semibold">{fmtDate(data.list.admission_start_date)}</p>
                </div>
                <div className="rounded-xl border border-gold/40 bg-gold/5 p-2.5 text-center">
                  <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
                    <CalendarCheck2 className="h-3 w-3" /> Join By
                  </p>
                  <p className="mt-0.5 text-xs font-semibold">{fmtDate(data.list.admission_last_date)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 font-bold text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                  {data.listed_count} Merit Listed
                </span>
                {data.not_listed_count > 0 && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-bold text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                    {data.not_listed_count} Not Merit Listed{!data.list.show_not_listed ? " (names hidden)" : ""}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={downloadPdf} disabled={pdfBusy}
                  className="h-8 gap-1.5 rounded-md text-[11.5px] font-bold">
                  {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                  Download PDF
                </Button>
                <Button variant="outline" size="sm" onClick={toggleNotListed} disabled={showMut.isPending}
                  className="h-8 gap-1.5 rounded-md text-[11.5px] font-bold">
                  {data.list.show_not_listed ? <><EyeOff className="h-3.5 w-3.5" /> Hide Not-Listed Names</> : <><EyeIcon className="h-3.5 w-3.5" /> Show Not-Listed Names</>}
                </Button>
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground">
                Remarks are editable (e.g. &ldquo;2 Session(s) Missed&rdquo;), they appear on the public merit list.
              </p>

              {/* Mobile: cards */}
              <div className="space-y-2 md:hidden">
                {data.entries.map((e) => (
                  <div key={e.id}
                    className={`rounded-xl border p-3 text-center ${e.is_listed ? "border-border/60 bg-card" : "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"}`}>
                    <p className="text-[10px] font-bold text-muted-foreground">#{e.position}</p>
                    <p className="text-sm font-bold leading-snug">{e.name}</p>
                    {e.father_name && <p className="text-[11px] text-muted-foreground">S/O {e.father_name}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-primary">{e.reference_no}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {e.previous_marks || "—"}{e.marks_pct != null ? ` · ${Number(e.marks_pct).toFixed(2)}%` : ""}
                    </p>
                    {!e.is_listed && (
                      <span className="mt-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        Not Merit Listed
                      </span>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <Input
                        value={drafts[e.id] ?? e.remarks ?? ""}
                        onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                        placeholder="Remark"
                        className="h-8 flex-1 rounded-md text-xs" />
                      <Button size="sm" variant="outline" onClick={() => saveRemark(e.id)} disabled={savingId === e.id}
                        className="h-8 w-9 rounded-md p-0">
                        {savingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-left">
                      {["#", "Reference No.", "Name", "Father Name", "Marks", "%", "Remarks"].map((h, i) => (
                        <th key={h} className={`whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i >= 5 ? "text-right" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.entries.map((e) => (
                      <tr key={e.id} className={!e.is_listed ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                        <td className="px-3 py-2 font-bold tabular-nums">{e.position}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.reference_no}</td>
                        <td className="px-3 py-2 font-medium">{e.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{e.father_name || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{e.previous_marks || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.marks_pct != null ? Number(e.marks_pct).toFixed(2) : "—"}</td>
                        <td className="px-3 py-2">
                          {e.is_listed ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <Input
                                value={drafts[e.id] ?? e.remarks ?? ""}
                                onChange={(ev) => setDrafts((d) => ({ ...d, [e.id]: ev.target.value }))}
                                placeholder="—"
                                className="h-8 w-36 rounded-md text-xs" />
                              <Button size="sm" variant="outline" onClick={() => saveRemark(e.id)} disabled={savingId === e.id}
                                className="h-8 w-9 rounded-md p-0">
                                {savingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          ) : (
                            <span className="block text-right">
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">Not Merit Listed</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.entries.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No entries — no fee-paid applicant matched this class.
                </p>
              )}

              {data.list.instructions && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                    <ListChecks className="h-3.5 w-3.5 text-primary" /> Instructions
                  </p>
                  <ol className="list-inside list-decimal space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                    {data.list.instructions.split(/\n+/).filter(Boolean).map((l, i) => (
                      <li key={i}>{l.replace(/^\d+\.\s*/, "")}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ══ MAIN — generator hero + lists table ═══════════════════════════════════ */
export default function AdminAdmissionMeritLists() {
  const { data: rows, isLoading } = useAdminAdmissionMeritLists();
  const publishMut = useAdmissionMeritPublish();
  const deleteMut = useAdmissionMeritDelete();
  const [autoOpen, setAutoOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const presetListNo = useMemo(() => {
    const list = (rows ?? []) as MeritListRow[];
    return list.length ? Math.max(...list.map((r) => r.list_no ?? 1)) + 1 : 1;
  }, [rows]);

  const togglePublish = async (row: MeritListRow) => {
    if (row.is_published) {
      const ok = window.confirm(`Unpublish Class ${row.class} list #${row.list_no}?\n\nIt disappears from the public Admission page until you publish it again.`);
      if (!ok) return;
    } else {
      const ok = window.confirm(
        `Publish Class ${row.class} list #${row.list_no}?\n\nIt becomes public, and its ${row.listed_count} fee-paid applicant(s) are marked "Merit Listed".`,
      );
      if (!ok) return;
    }
    try {
      await publishMut.mutateAsync({ id: row.id, published: !row.is_published });
      toast.success(row.is_published ? "Merit list unpublished." : "Merit list published.");
    } catch (e: any) {
      toast.error(e?.message || "Publish failed.");
    }
  };

  const removeDraft = async (row: MeritListRow) => {
    const ok = window.confirm(`Delete the draft merit list for Class ${row.class}?`);
    if (!ok) return;
    try {
      await deleteMut.mutateAsync(row.id);
      toast.success("Draft merit list deleted.");
    } catch (e: any) {
      toast.error(e?.message || "Delete failed.");
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Generator hero ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gold/40 bg-gradient-to-br from-primary/[0.06] via-card to-gold/[0.08] p-4 sm:p-5">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-strong ring-2 ring-gold/25">
            <Zap className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-foreground">Merit List Generator</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Ranks fee-paid applicants by previous class marks, up to each class's seats. Generate for all
              classes or one class, for all applicants or Fresh / Migration separately.
            </p>
          </div>
          <Button onClick={() => setAutoOpen(true)}
            className="h-9 shrink-0 gap-1.5 whitespace-nowrap rounded-md px-5 text-xs font-bold">
            <Zap className="h-4 w-4" /> Generate Merit List
          </Button>
        </div>
      </div>

      {/* ── Lists table ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="py-14 text-center">
              <Trophy className="mx-auto mb-2 h-8 w-8 text-gold-strong/60" />
              <p className="text-sm font-semibold text-foreground">No merit list generated yet.</p>
              <p className="mx-auto mt-1 max-w-md px-4 text-xs leading-relaxed text-muted-foreground">
                Click <b>Generate Merit List</b>. Every fee-paid applicant (online + walk-in) is
                ranked by previous class marks and the seats of each class decide who is Merit Listed.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="bg-muted/60">
                      {["Class", "List #", "Listed / Not", "Dates", "Status", "Actions"].map((h, i) => (
                        <th key={h} className={`whitespace-nowrap px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i === 5 ? "text-right" : "text-center"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {(rows as MeritListRow[]).map((r) => (
                      <tr key={r.id} className="text-center transition-colors hover:bg-primary/5">
                        <td className="px-4 py-3 font-bold">
                          Class {r.class}
                          {(r.title || "").includes("Migration") && <span className="ml-1 text-[10px] font-bold text-primary">Migration</span>}
                        </td>
                        <td className="px-4 py-3 tabular-nums">#{r.list_no}</td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-green-700 dark:text-green-400">{r.listed_count}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="font-bold text-red-600 dark:text-red-400">{r.not_listed_count}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(r.admission_start_date)} → {fmtDate(r.admission_last_date)}
                        </td>
                        <td className="px-4 py-3">
                          {r.is_published ? (
                            <span className="inline-flex flex-col items-center">
                              <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[10px] font-bold text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                                Published
                              </span>
                              {r.published_at && <span className="mt-0.5 text-[9px] text-muted-foreground">{fmtDate(r.published_at)}</span>}
                            </span>
                          ) : (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setViewId(r.id)}
                              className="h-8 gap-1.5 rounded-md px-3 text-[11.5px] font-semibold">
                              <Eye className="h-3.5 w-3.5" /> View
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => togglePublish(r)} disabled={publishMut.isPending}
                              className="h-8 gap-1.5 rounded-md px-3 text-[11.5px] font-semibold">
                              {r.is_published ? <GlobeLock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                              {r.is_published ? "Unpublish" : "Publish"}
                            </Button>
                            {!r.is_published && (
                              <Button size="sm" variant="outline" onClick={() => removeDraft(r)} disabled={deleteMut.isPending}
                                className="h-8 gap-1.5 rounded-md border-red-300/70 px-3 text-[11.5px] font-semibold text-red-600 hover:bg-red-500/10 hover:text-red-700">
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <ul className="space-y-2 p-3 md:hidden">
                {(rows as MeritListRow[]).map((r) => (
                  <li key={r.id} className="rounded-2xl border border-border/60 bg-card p-3 text-center shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold">
                        Class {r.class}
                        {(r.title || "").includes("Migration") && <span className="ml-1 text-[10px] font-bold text-primary">Migration</span>}
                      </p>
                      <span className="text-xs font-semibold text-muted-foreground">List #{r.list_no}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {r.listed_count} listed · {r.not_listed_count} not listed{r.show_not_listed === false ? " (names hidden)" : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {fmtDate(r.admission_start_date)} → {fmtDate(r.admission_last_date)}
                    </p>
                    <div className="mt-2">
                      {r.is_published ? (
                        <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-[10px] font-bold text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                          Published {r.published_at ? fmtDate(r.published_at) : ""}
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setViewId(r.id)}
                        className="h-8 gap-1 rounded-md px-2 text-[11px] font-semibold">
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => togglePublish(r)} disabled={publishMut.isPending}
                        className="h-8 gap-1 rounded-md px-2 text-[11px] font-semibold">
                        {r.is_published ? <GlobeLock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                        {r.is_published ? "Unpublish" : "Publish"}
                      </Button>
                      {!r.is_published && (
                        <Button size="sm" variant="outline" onClick={() => removeDraft(r)} disabled={deleteMut.isPending}
                          className="col-span-2 h-8 gap-1 rounded-md border-red-300/70 px-2 text-[11px] font-semibold text-red-600">
                          <Trash2 className="h-3.5 w-3.5" /> Delete draft
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <AutoMeritDialog open={autoOpen} onClose={() => setAutoOpen(false)} presetListNo={presetListNo} />
      <ViewListDialog id={viewId} onClose={() => setViewId(null)} />
    </div>
  );
}
