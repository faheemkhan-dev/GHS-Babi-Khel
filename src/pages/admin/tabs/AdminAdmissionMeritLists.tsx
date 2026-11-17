// src/pages/admin/tabs/AdminAdmissionMeritLists.tsx — "Merit Lists" sub-tab
// of Admin → Admissions (ported from GHSS Ghallanai, High School model):
//   • ONE-CLICK auto merit list: ranks every processing-fee-PAID applicant
//     of each class by previous class marks / percentage (ties → earlier
//     application), selects the top N where N = class seats − seats already
//     taken by earlier published lists. Everyone ranked appears in the list:
//     inside the seats = Merit Listed, the rest = Not Merit Listed.
//   • Preview (dry run) before generating, publish now or as draft,
//     re-running a list number REPLACES the old list.
//   • View dialog with per-entry editable remarks.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Zap, Trophy, Loader2, Eye, Upload, Trash2, Save, ListChecks,
  AlertTriangle, X, Search, CalendarDays,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import toast from "react-hot-toast";
import {
  useAdminAdmissionMeritLists,
  useAdminAdmissionMeritList,
  useAdmissionMeritAuto,
  useAdmissionMeritPublish,
  useAdmissionMeritDelete,
  useAdmissionMeritRemark,
} from "@/hooks/useAdmission";

interface AutoClassResult {
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
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/* ── Auto Merit dialog ─────────────────────────────────────────────────── */
function AutoMeritDialog({ open, onClose, defaultListNo }: { open: boolean; onClose: () => void; defaultListNo: number }) {
  const [listNo, setListNo] = useState(defaultListNo);
  const [startDate, setStartDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [preview, setPreview] = useState<AutoClassResult[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const autoMut = useAdmissionMeritAuto();

  const run = async (dryRun: boolean) => {
    if (listNo < 1 || listNo > 50) { toast.error("List number must be between 1 and 50."); return; }
    if (dryRun) setPreviewing(true);
    else setGenerating(true);
    try {
      const res: any = await autoMut.mutateAsync({
        list_no: listNo,
        admission_start_date: startDate || null,
        admission_last_date: lastDate || null,
        instructions: instructions || null,
        publish: dryRun ? false : publishNow,
        dry_run: dryRun,
      });
      if (dryRun) {
        setPreview((res?.lists ?? []) as AutoClassResult[]);
        if (!res?.lists?.length) toast("No open classes found to build lists for.", { icon: "ℹ️" });
      } else {
        toast.success(
          `Merit list #${listNo} created${publishNow ? " and published" : " as draft"} for ${(res?.lists ?? []).length} class(es).`,
        );
        onClose();
        setPreview(null);
      }
    } catch (e: any) {
      toast.error(e?.message || "The merit run failed.");
    } finally {
      setPreviewing(false);
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Zap className="w-4 h-4" /></span>
            Auto Merit List (All Classes)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ranks every fee-paid applicant (online + walk-in) of every open class by marks and selects
            the top ones up to the seats fixed in <b>Classes &amp; Seats</b>.
          </p>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-semibold mb-1 block">List No.</Label>
              <Input type="number" min={1} max={50} value={listNo}
                onChange={(e) => setListNo(Number(e.target.value))} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-semibold mb-1 block">Last Date</Label>
              <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-1 block">Instructions (optional — shown on the public list)</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder="Leave empty to use the standard 7-point instructions."
              className="text-xs min-h-[70px]" />
          </div>

          <div className="flex items-center justify-between gap-3 p-3 bg-muted/40 border border-border/60 rounded-xl">
            <div className="min-w-0">
              <p className="font-semibold text-sm">Publish immediately</p>
              <p className="text-xs text-muted-foreground">Lists go public right away, with Merit Listed and Not Merit Listed students. Leave off to check them as drafts first.</p>
            </div>
            <Switch checked={publishNow} onCheckedChange={setPublishNow} />
          </div>

          {preview && (
            <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-3">
              <p className="text-xs font-bold flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5 text-primary" /> Preview — list #{listNo}</p>
              {preview.map((p) => (
                <div key={p.class} className="rounded-lg bg-card border border-border/60 p-2.5 text-[11px]">
                  <p className="font-bold text-xs mb-1">{p.class_label}</p>
                  <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-muted-foreground">
                    <span>Seats: <b className="text-foreground">{p.seats}</b></span>
                    <span>Already taken: <b className="text-foreground">{p.taken}</b></span>
                    <span>Left: <b className="text-foreground">{p.seats_left}</b></span>
                    <span>Eligible: <b className="text-foreground">{p.eligible}</b></span>
                    <span>Selected: <b className="text-green-600">{p.selected}</b></span>
                    <span>Waiting: <b className="text-red-600">{p.waiting}</b></span>
                    {p.cutoff != null && <span className="col-span-3">Cut-off: <b className="text-foreground">{Number(p.cutoff).toFixed(2)}%</b></span>}
                    {p.seats <= 0 && <span className="col-span-3 text-amber-600 font-semibold">No seats set for this class — set seats in Classes &amp; Seats first.</span>}
                  </div>
                  {p.unpaid > 0 && (
                    <p className="mt-1.5 text-amber-600">{p.unpaid} application(s) with unpaid fee are not included.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" onClick={() => run(true)} disabled={previewing || generating}
              className="h-10 flex-1 gap-2 rounded-xl text-xs font-bold">
              {previewing ? <><Loader2 className="w-4 h-4 animate-spin" /> Previewing…</> : <><Eye className="w-4 h-4" /> Preview</>}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={generating || previewing} className="h-10 flex-1 gap-2 rounded-xl text-xs font-bold">
                  {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Zap className="w-4 h-4" /> Generate All</>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Create merit list #{listNo} for ALL open classes now?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Applicants inside the seats become <b>Merit Listed</b>, the others <b>Not Merit Listed</b>
                    {publishNow ? ", and the lists are published publicly" : ""}. Old lists of this number are replaced.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 rounded-full px-4 text-xs font-semibold">Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(false)} className="h-9 rounded-full bg-primary px-4 text-xs font-semibold hover:bg-primary/90">
                    Yes, Generate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <p className="text-[10.5px] text-muted-foreground leading-relaxed border-t border-border/60 pt-2.5">
            <b>Ranking:</b> previous class marks as entered (450/600 → 75%, 82% → 82%); grade-only entries
            rank after numeric marks; ties go to the earlier application. Every fee-paid applicant appears
            in the list. Running the same list number again replaces the old lists, so nothing is duplicated.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── View dialog (entries + inline remarks) ────────────────────────────── */
function MeritViewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useAdminAdmissionMeritList(id);
  const remarkMut = useAdmissionMeritRemark();
  const publishMut = useAdmissionMeritPublish();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [seeded, setSeeded] = useState<string | null>(null);

  const entries = useMemo(() => {
    if (!data?.entries) return [];
    const needle = search.trim().toLowerCase();
    const base = needle
      ? data.entries.filter((e: any) => e.name.toLowerCase().includes(needle) || e.reference_no.toLowerCase().includes(needle))
      : data.entries;
    return base;
  }, [data, search]);

  if (data?.list?.id && seeded !== data.list.id) {
    setSeeded(data.list.id);
    setRemarks(Object.fromEntries(data.entries.map((e: any) => [e.id, e.remarks ?? ""])));
  }

  const dirtyRemark = (entryId: string) => {
    const orig = data?.entries.find((e: any) => e.id === entryId)?.remarks ?? "";
    return (remarks[entryId] ?? "") !== orig;
  };

  const saveRemark = async (entryId: string) => {
    try {
      await remarkMut.mutateAsync({ entryId, remarks: remarks[entryId] ?? "" });
      toast.success("Remark saved — it appears on the public merit list.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save the remark.");
    }
  };

  const togglePublish = async (published: boolean) => {
    if (!id) return;
    try {
      await publishMut.mutateAsync({ id, published });
      toast.success(published ? "Merit list published — it is now public." : "Merit list unpublished — it is hidden from the public page.");
    } catch (e: any) {
      toast.error(e?.message || "Publish failed.");
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-4 sm:p-6">
        {isLoading || !data ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading merit list…
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-start justify-between gap-3 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-snug">{data.list.class_label} — Merit List #{data.list.list_no}</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    Session {data.list.session_year ?? ""} · {data.list.is_published ? "Published" : "Draft"}
                  </span>
                </span>
                <div className="flex shrink-0 gap-1.5">
                  {data.list.published_at ? (
                    <Button size="sm" variant="outline" onClick={() => togglePublish(false)} disabled={publishMut.isPending}
                      className="h-8 rounded-full px-3 text-[11px] font-bold">Unpublish</Button>
                  ) : (
                    <Button size="sm" onClick={() => togglePublish(true)} disabled={publishMut.isPending}
                      className="h-8 gap-1.5 rounded-full px-3 text-[11px] font-bold">
                      <Upload className="w-3.5 h-3.5" /> Publish
                    </Button>
                  )}
                </div>
              </DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ["Merit Listed", data.listed_count, "text-green-600"],
                ["Not Listed", data.not_listed_count, "text-red-600"],
                ["Start", data.list.admission_start_date ? format(new Date(data.list.admission_start_date), "dd MMM yy") : "—", ""],
                ["Join By", data.list.admission_last_date ? format(new Date(data.list.admission_last_date), "dd MMM yy") : "—", ""],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="rounded-xl border border-border/60 bg-muted/30 p-2.5 text-center">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">{label}</p>
                  <p className={`text-sm font-bold mt-0.5 ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Find: Reference No. or name" className="h-10 rounded-full pl-9 text-sm" />
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    {["#", "Ref No.", "Name", "Father", "Marks", "%", "Remarks (editable)"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap ${i >= 5 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {entries.map((e: any) => (
                    <tr key={e.id} className={!e.is_listed ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                      <td className="px-3 py-2 font-bold tabular-nums">{e.position}</td>
                      <td className="px-3 py-2 font-mono text-xs">{e.reference_no}</td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{e.name}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.father_name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.previous_marks || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{e.marks_pct != null ? Number(e.marks_pct).toFixed(2) : "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <Input value={remarks[e.id] ?? ""} onChange={(ev) => setRemarks((r) => ({ ...r, [e.id]: ev.target.value }))}
                            placeholder={e.is_listed ? "e.g. 2 session(s) missed" : "Not Merit Listed"}
                            className="h-8 w-40 text-xs" />
                          {dirtyRemark(e.id) && (
                            <Button size="sm" onClick={() => saveRemark(e.id)} disabled={remarkMut.isPending}
                              className="h-8 w-8 rounded-full p-0" aria-label="Save remark">
                              {remarkMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.list.instructions && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-bold mb-1.5">Instructions (public)</p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-muted-foreground">
                  {data.list.instructions.split(/\n+/).filter(Boolean).map((l: string, i: number) => <li key={i}>{l.replace(/^\d+\.\s*/, "")}</li>)}
                </ol>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Main tab ──────────────────────────────────────────────────────────── */
export default function AdminAdmissionMeritLists() {
  const { data: lists, isLoading } = useAdminAdmissionMeritLists();
  const publishMut = useAdmissionMeritPublish();
  const deleteMut = useAdmissionMeritDelete();
  const [autoOpen, setAutoOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const nextListNo = useMemo(() => {
    const maxNo = (lists ?? []).reduce((m, l: any) => Math.max(m, l.list_no ?? 1), 0);
    return Math.min(50, maxNo + 1);
  }, [lists]);

  const confirmPublish = async (id: string, label: string, count: number) => {
    try {
      await publishMut.mutateAsync({ id, published: true });
      toast.success(`${label} published${count ? ` — ${count} selected student(s) marked Merit Listed` : ""}.`);
    } catch (e: any) {
      toast.error(e?.message || "Publish failed.");
    }
  };

  return (
    <div className="space-y-4 pb-16">
      {/* One-click hero card */}
      <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
        <div className="bg-gradient-to-r from-primary/10 via-[hsl(43_89%_58%)]/15 to-primary/10 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
                <Zap className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-heading font-bold tracking-tight text-foreground sm:text-lg">One-Click Merit List</h2>
                <p className="mt-0.5 text-xs text-muted-foreground leading-snug max-w-xl">
                  Ranks every fee-paid applicant (online + walk-in) of every open class by marks and selects
                  the top ones up to the seats fixed in Classes &amp; Seats.
                </p>
              </div>
            </div>
            <Button onClick={() => setAutoOpen(true)} className="h-10 gap-2 rounded-xl px-4 text-xs font-bold shrink-0">
              <Zap className="w-4 h-4" /> Auto Merit List (All Classes)
            </Button>
          </div>
        </div>
      </Card>

      {/* Lists table */}
      <Card className="rounded-2xl border-border/60 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3 mb-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Trophy className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-tight">All Merit Lists</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Drafts are only visible here — publish to make them public.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : !lists || lists.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No merit list yet — create the first one with the button above.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    {["Class", "List #", "Dates", "Status", ""].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${i === 4 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {lists.map((l: any) => (
                    <tr key={l.id} className="hover:bg-primary/5 transition-colors">
                      <td className="px-4 py-3 font-semibold">Class {l.class}</td>
                      <td className="px-4 py-3">#{l.list_no} <span className="text-[10px] text-muted-foreground">({ordinal(l.list_no)})</span></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {l.admission_start_date ? format(new Date(l.admission_start_date), "dd MMM") : "—"} → {l.admission_last_date ? format(new Date(l.admission_last_date), "dd MMM yy") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {l.is_published ? (
                          <Badge className="border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 text-green-700 dark:text-green-300 text-[10px] font-bold">
                            Published {l.published_at ? format(new Date(l.published_at), "dd MMM") : ""}
                          </Badge>
                        ) : (
                          <Badge className="border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-[10px] font-bold">Draft</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setViewId(l.id)}
                            className="h-8 gap-1.5 rounded-full border-border/60 px-3 text-[11px] font-bold">
                            <Eye className="w-3.5 h-3.5" /> View
                          </Button>
                          {l.is_published ? (
                            <Button size="sm" variant="outline" disabled={publishMut.isPending}
                              onClick={() => publishMut.mutateAsync({ id: l.id, published: false }).then(() => toast.success("Unpublished.")).catch((e) => toast.error(e?.message || "Failed."))}
                              className="h-8 rounded-full border-border/60 px-3 text-[11px] font-bold">Unpublish</Button>
                          ) : (
                            <>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" disabled={publishMut.isPending}
                                    className="h-8 gap-1.5 rounded-full px-3 text-[11px] font-bold">
                                    <Upload className="w-3.5 h-3.5" /> Publish
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="rounded-2xl">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Publish Class {l.class} list #{l.list_no}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      It becomes public, and its selected applicant(s) are marked <b>Merit Listed</b> in their tracker.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="h-9 rounded-full px-4 text-xs font-semibold">Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => confirmPublish(l.id, `Class ${l.class} list #${l.list_no}`, 0)}
                                      className="h-9 rounded-full bg-primary px-4 text-xs font-semibold hover:bg-primary/90">Publish</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" disabled={deleteMut.isPending} aria-label="Delete draft"
                                    className="h-8 w-8 rounded-full p-0 text-red-500 hover:bg-red-500/10 hover:text-red-700">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="rounded-2xl">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Class {l.class} list #{l.list_no} and its entries are removed. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="h-9 rounded-full px-4 text-xs font-semibold">Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMut.mutateAsync(l.id).then(() => toast.success("Draft deleted.")).catch((e) => toast.error(e?.message || "Delete failed."))}
                                      className="h-9 rounded-full bg-red-600 px-4 text-xs font-semibold hover:bg-red-700">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
            Deleting an application that sits in a published list is blocked — unpublish that list first.
          </p>
        </CardContent>
      </Card>

      <AutoMeritDialog open={autoOpen} onClose={() => setAutoOpen(false)} defaultListNo={nextListNo} />
      <MeritViewDialog id={viewId} onClose={() => setViewId(null)} />
    </div>
  );
}
