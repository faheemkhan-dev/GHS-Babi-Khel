import { useMemo, useRef, useState } from "react";
import { Upload, Download, Search, UserMinus, Users, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useClassRoster, useImportFeeStudents, useRemoveFeeStudents } from "@/hooks/useFees";
import { readRosterFile, downloadRosterTemplateXlsx, type RosterParseResult } from "./studentFile";
import { CLASSES, pillPrimary, pillOutline, fieldCls, ClassTabs, Stat, EmptyState, Avatar } from "./shared";

export default function StudentsTab() {
  const [cls, setCls] = useState("6");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const { data: roster = [], isLoading } = useClassRoster(cls);
  const remove = useRemoveFeeStudents();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? roster.filter((r) => r.student_name.toLowerCase().includes(q) || r.class_roll_no.toLowerCase().includes(q) || (r.father_name || "").toLowerCase().includes(q)) : roster;
  }, [roster, search]);

  const sample = async () => { try { await downloadRosterTemplateXlsx(); } catch { toast.error("Could not create the sample file"); } };
  const dropOne = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from the fee list? Their existing vouchers are kept.`)) return;
    try { await remove.mutateAsync([id]); toast.success("Removed from fee list"); } catch (e: any) { toast.error(e?.message || "Could not remove"); }
  };
  const dropClass = async () => {
    if (!roster.length || !confirm(`Remove all ${roster.length} students of Class ${cls} from the fee list? Existing vouchers are kept.`)) return;
    try { await remove.mutateAsync(roster.map((r) => r.id)); toast.success(`Class ${cls} list cleared`); } catch (e: any) { toast.error(e?.message || "Could not clear"); }
  };

  return (
    <div className="space-y-4">
      <ClassTabs value={cls} onChange={setCls} />
      <div className="flex flex-wrap gap-2">
        <Button className={pillPrimary} onClick={() => setOpen(true)}><Upload className="h-3.5 w-3.5" /> Import students</Button>
        <Button variant="outline" className={pillOutline} onClick={sample}><Download className="h-3.5 w-3.5" /> Sample file</Button>
        {roster.length > 0 && (
          <Button variant="outline" className={`${pillOutline} ml-auto text-destructive`} onClick={dropClass}><UserMinus className="h-3.5 w-3.5" /> Clear class</Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label={`Class ${cls} students`} value={roster.length} />
        <Stat label="With father name" value={roster.filter((r) => r.father_name).length} />
      </div>

      {roster.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, father or roll" className={`${fieldCls} rounded-full pl-9`} />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
      ) : roster.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title={`No students in Class ${cls}`}
          text="Download the sample file, fill in Class No, Full Name, Father Name and Class, then import it."
          action={<Button className={pillPrimary} onClick={() => setOpen(true)}><Upload className="h-3.5 w-3.5" /> Import students</Button>} />
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={r.student_name} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold leading-snug">{r.student_name}</p>
                <p className="break-words text-[11px] leading-snug text-muted-foreground">Roll {r.class_roll_no}{r.father_name ? ` · S/o ${r.father_name}` : ""}</p>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full text-destructive shadow-none hover:bg-destructive/10" onClick={() => dropOne(r.id, r.student_name)} aria-label="Remove"><UserMinus className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      )}

      <ImportDialog open={open} onClose={() => setOpen(false)} onDone={(c) => c && setCls(c)} />
    </div>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (firstClass?: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<RosterParseResult | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [reading, setReading] = useState(false);
  const imp = useImportFeeStudents();

  const reset = () => { setFileName(""); setParsed(null); setMode("merge"); if (input.current) input.current.value = ""; };
  const close = () => { reset(); onClose(); };

  const pick = async (f?: File) => {
    if (!f) return;
    setFileName(f.name); setReading(true);
    try { setParsed(await readRosterFile(f)); } catch { setParsed(null); toast.error("Could not read that file"); }
    setReading(false);
  };

  const perClass = useMemo(() => {
    const m: Record<string, number> = {};
    parsed?.students.forEach((s) => { m[s.class] = (m[s.class] || 0) + 1; });
    return CLASSES.filter((c) => m[c]).map((c) => [c, m[c]] as const);
  }, [parsed]);

  const run = async () => {
    if (!parsed?.students.length) return;
    try {
      const r = await imp.mutateAsync({
        mode,
        rows: parsed.students.map((s) => ({ class: s.class, roll_number: s.roll_number, full_name: s.full_name, father_name: s.father_name })),
      });
      toast.success(r.removed ? `${r.imported} students imported · ${r.removed} removed` : `${r.imported} students imported`);
      onDone(perClass[0]?.[0]);
      close();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-base">Import students</DialogTitle></DialogHeader>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition-colors hover:bg-muted/60">
          {reading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <FileSpreadsheet className="h-6 w-6 text-primary" />}
          <span className="break-all text-sm font-semibold">{fileName || "Choose Excel or CSV file"}</span>
          <span className="text-[11px] text-muted-foreground">Columns: Class No · Full Name · Father Name · Class</span>
        </button>

        {parsed?.error && (
          <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{parsed.error}</span>
          </div>
        )}

        {parsed && !parsed.error && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 p-3">
              <p className="mb-2 text-center text-sm font-semibold">{parsed.students.length} students ready</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {perClass.map(([c, n]) => <span key={c} className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium">Class {c} · {n}</span>)}
              </div>
              {(parsed.skippedNoName + parsed.skippedBadClass + parsed.skippedDuplicate) > 0 && (
                <p className="mt-2 text-center text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                  Skipped: {parsed.skippedNoName} without name · {parsed.skippedBadClass} bad class · {parsed.skippedDuplicate} duplicates
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/40 p-1">
              {([["merge", "Add / update"], ["replace", "Replace list"]] as const).map(([m, l]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-all ${mode === m ? "bg-card text-foreground shadow-sm ring-1 ring-border/70" : "text-muted-foreground"}`}>{l}</button>
              ))}
            </div>
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              {mode === "merge" ? "Adds new students and updates names of matching roll numbers." : "The file becomes the complete list of each class in it. Students not in the file are taken off the fee list (never deleted)."}
            </p>
          </div>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" className={`${pillOutline} flex-1 sm:flex-none`} onClick={close}>Cancel</Button>
          <Button className={`${pillPrimary} flex-1 sm:flex-none`} onClick={run} disabled={!parsed?.students.length || imp.isPending}>
            {imp.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
