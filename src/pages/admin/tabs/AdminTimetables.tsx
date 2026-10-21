import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, Trash2, Copy, AlertTriangle, Plus, Pencil, Download,
  MapPin, DoorOpen, Check, X as XIcon, UserX, UserCheck, Image as ImageIcon, CalendarDays,
} from "lucide-react";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  useTimetableSettings, useSaveTimetableSettings,
  useAllTimetables, useCheckTeacherConflict, useCheckRoomConflict,
  useSaveTimetable, useRooms, useSaveRoom, useDeleteRoom,
} from "@/hooks/useTimetable";
import { useTeachers } from "@/hooks/useTeachers";
import {
  useTodayTimetableOverrides, useAssignSubstitutes, useClearTodayOverrides,
  type SubstitutionResult,
} from "@/hooks/useTimetableOverrides";

const classes = ["6", "7", "8", "9", "10"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const periods = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const subjectColors: Record<string, string> = {
  math: "bg-blue-100 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700",
  english: "bg-emerald-100 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-700",
  urdu: "bg-sky-100 border-sky-300 dark:bg-sky-900/30 dark:border-sky-700",
  science: "bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700",
  islamiat: "bg-green-100 border-green-300 dark:bg-green-900/30 dark:border-green-700",
  "social studies": "bg-orange-100 border-orange-300 dark:bg-orange-900/30 dark:border-orange-700",
  pst: "bg-cyan-100 border-cyan-300 dark:bg-cyan-900/30 dark:border-cyan-700",
  computer: "bg-indigo-100 border-indigo-300 dark:bg-indigo-900/30 dark:border-indigo-700",
};

const getSubjectColor = (subject: string) => {
  const key = subject.toLowerCase();
  for (const [k, v] of Object.entries(subjectColors)) {
    if (key.includes(k)) return v;
  }
  return "bg-secondary border-border";
};

interface CellData {
  subject: string; teacher: string; start_time: string; end_time: string;
  room: string; meet_link: string;
}
type Grid = Record<string, CellData>;

interface TimetableRow {
  id?: string; class: string; day: string; period_number: number;
  subject: string; teacher: string; start_time: string; end_time: string;
  room: string; meet_link: string;
}

const emptyCell = (): CellData => ({
  subject: "", teacher: "", start_time: "", end_time: "", room: "", meet_link: "",
});

const defaultPeriodNames = (): Record<string, string> => {
  const m: Record<string, string> = {};
  for (let i = 1; i <= 9; i++) m[i] = `Period ${i}`;
  return m;
};

// ─── Room Manager Component (Feature 2.5) ───────────────────────────────────

function RoomManager({ onClose }: { onClose: () => void }) {
  const { data: rooms = [], isLoading } = useRooms();
  const saveRoom = useSaveRoom();
  const deleteRoom = useDeleteRoom();
  const [editing, setEditing] = useState<Partial<{ id: string; name: string; capacity: number; room_type: string; is_available: boolean }> | null>(null);
  const [adding, setAdding] = useState(false);

  const roomTypes = ["classroom", "lab", "library", "hall"];

  const handleSave = async (room: any) => {
    await saveRoom.mutateAsync(room);
    setEditing(null);
    setAdding(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-5 sm:p-6 gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
              <DoorOpen className="h-4 w-4" />
            </span>
            Room / Location Management
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Add, edit, or remove rooms. These appear in the room dropdown when assigning timetable entries.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { setAdding(true); setEditing({ name: "", capacity: 40, room_type: "classroom", is_available: true }); }}
            className="h-9 w-full rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none transition-colors hover:bg-primary/90 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Room
          </button>

          {isLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : (
            <div className="space-y-2">
              {rooms.map((room) => (
                <div key={room.id} className="flex items-center gap-2 p-2.5 rounded-xl border border-border/60 bg-card shadow-sm transition-colors hover:border-primary/30">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MapPin className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{room.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="outline" className="rounded-full text-[10px] h-5 capitalize">{room.room_type}</Badge>
                      <span className="text-[10px] text-muted-foreground">Cap: {room.capacity}</span>
                      <Badge variant="outline" className={`rounded-full text-[10px] h-5 border-0 ${room.is_available ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
                        {room.is_available ? "Available" : "Unavailable"}
                      </Badge>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-primary shrink-0" onClick={() => { setAdding(false); setEditing(room); }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {room.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This room will be removed from the list. Existing timetable entries with this room will keep the text value.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="h-9 rounded-full px-4 text-xs font-semibold shadow-none">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteRoom.mutate(room.id)} className="h-9 rounded-full px-4 text-xs font-semibold shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
              {rooms.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border bg-card/50 px-5 py-10 text-center">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60"><DoorOpen className="h-6 w-6" /></span>
                  <p className="text-sm font-semibold text-foreground">No rooms yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Add classrooms, labs and halls to assign them to periods.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Edit/Add form */}
        {(adding || editing) && (
          <div className="rounded-2xl border border-border/60 bg-secondary/30 p-3.5 space-y-3">
            <h4 className="font-bold text-sm flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"><Pencil className="h-3 w-3" /></span>
              {adding ? "Add New Room" : "Edit Room"}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Room Name</Label>
                <Input
                  placeholder="e.g. Science Lab"
                  value={editing?.name || ""}
                  onChange={(e) => setEditing((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Capacity</Label>
                <Input
                  type="number"
                  value={editing?.capacity ?? 40}
                  onChange={(e) => setEditing((prev) => prev ? { ...prev, capacity: parseInt(e.target.value) || 40 } : prev)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select
                  value={editing?.room_type || "classroom"}
                  onValueChange={(v) => setEditing((prev) => prev ? { ...prev, room_type: v } : prev)}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roomTypes.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing?.is_available ?? true}
                  onChange={(e) => setEditing((prev) => prev ? { ...prev, is_available: e.target.checked } : prev)}
                  className="rounded"
                />
                <Label className="text-xs">Available for scheduling</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => handleSave(editing)} disabled={!editing?.name?.trim() || saveRoom.isPending} className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none gap-1.5">
                {saveRoom.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {adding ? "Add Room" : "Save Changes"}
              </Button>
              <Button variant="outline" onClick={() => { setEditing(null); setAdding(false); }} className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none">Cancel</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-9 w-full rounded-full px-4 text-xs font-semibold shadow-none">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Conflict Warning Dialog (Feature 2.2) ─────────────────────────────────

function ConflictDialog({
  conflict, type, onSwap, onCancel,
}: {
  conflict: { teacher?: string; room?: string; day: string; period_number: number; existing_class: string; existing_subject: string; };
  type: "teacher" | "room";
  onSwap: () => void;
  onCancel: () => void;
}) {
  const name = type === "teacher" ? conflict.teacher : conflict.room;
  return (
    <Dialog open>
      <DialogContent className="max-w-sm rounded-2xl p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base text-destructive">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            {type === "teacher" ? "Teacher" : "Room"} Conflict
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {name} is already assigned to Class {conflict.existing_class} on {conflict.day} Period {conflict.period_number} ({conflict.existing_subject}).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onCancel} className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none">Cancel</Button>
          <Button onClick={onSwap} className="h-9 flex-1 gap-1.5 rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90">
            <Copy className="w-3.5 h-3.5" /> Swap Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PDF Export ─────────────────────────────────────────────────────────────

const PDF_GREEN: [number, number, number] = [20, 83, 45];
const PDF_GREEN_DARK: [number, number, number] = [12, 52, 28];
const PDF_GOLD: [number, number, number] = [191, 152, 54];

// Soft pastel tints so every subject is recognisable at a glance.
const PDF_TINTS: [number, number, number][] = [
  [232, 244, 236], [254, 246, 225], [230, 240, 252], [251, 233, 238],
  [240, 235, 252], [226, 245, 245], [253, 238, 226], [237, 244, 222],
];
const subjectTint = (subject: string): [number, number, number] => {
  let hash = 0;
  const s = subject.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return PDF_TINTS[hash % PDF_TINTS.length];
};
const hhmm = (t: string) => (t || "").slice(0, 5);

function exportTimetablePDF(
  classLevel: string,
  periodNames: Record<string, string>,
  grid: Grid,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const ML = 10, MR = 10;

  // Only print what is actually used: drop empty periods and empty days.
  const usedPeriods = periods.filter((p) => days.some((d) => grid[`${p}-${d}`]?.subject));
  const printPeriods = usedPeriods.length ? usedPeriods : periods.slice(0, 8);
  const usedDays = days.filter((d) => periods.some((p) => grid[`${p}-${d}`]?.subject));
  const printDays = usedDays.length ? usedDays : days.slice(0, 5);

  // ── Header band ──
  doc.setFillColor(...PDF_GREEN_DARK);
  doc.rect(0, 0, w, 30, "F");
  doc.setFillColor(...PDF_GOLD);
  doc.rect(0, 30, w, 1.6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(214, 226, 218);
  doc.text("DISTRICT MOHMAND  ·  KHYBER PAKHTUNKHWA", w / 2, 18, { align: "center" });

  // Title pill
  const title = `CLASS ${classLevel}  ·  WEEKLY TIMETABLE`;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  const tw = doc.getTextWidth(title) + 16;
  doc.setFillColor(...PDF_GOLD);
  doc.roundedRect((w - tw) / 2, 21.2, tw, 6.6, 3.3, 3.3, "F");
  doc.setTextColor(30, 24, 8);
  doc.text(title, w / 2, 25.8, { align: "center" });

  // ── Table ──
  const head = [["PERIOD", ...printDays.map((d) => d.toUpperCase())]];
  const body = printPeriods.map((p) => [String(p), ...printDays.map(() => "")]);

  const startY = 37;
  const footerH = 12;
  const headRowH = 10;
  const rowH = Math.min(24, Math.max(13, (h - startY - footerH - headRowH - 6) / printPeriods.length));

  autoTable(doc, {
    startY,
    head,
    body,
    theme: "grid",
    rowPageBreak: "avoid",
    margin: { left: ML, right: MR, bottom: footerH },
    styles: {
      lineColor: [205, 214, 208], lineWidth: 0.25, halign: "center", valign: "middle",
      minCellHeight: rowH, textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: PDF_GREEN, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9,
      halign: "center", valign: "middle", minCellHeight: headRowH, lineColor: PDF_GREEN,
    },
    columnStyles: { 0: { cellWidth: 30, fillColor: [244, 247, 245], textColor: [255, 255, 255] } },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index === 0) return;
      const p = printPeriods[data.row.index];
      if (p === undefined) return;
      const cell = grid[`${p}-${printDays[data.column.index - 1]}`];
      data.cell.styles.fillColor = cell?.subject ? subjectTint(cell.subject) : [252, 252, 252];
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      const { x, y, width, height } = data.cell;
      const cx = x + width / 2;
      const p = printPeriods[data.row.index];
      if (p === undefined) return;

      // Period label column
      if (data.column.index === 0) {
        const pName = (periodNames[p] || `Period ${p}`).toUpperCase();
        const sample = printDays.map((d) => grid[`${p}-${d}`]).find((c) => c?.start_time && c?.end_time);
        doc.setFillColor(...PDF_GREEN);
        doc.rect(x, y, width, height, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(255, 255, 255);
        doc.text(String(p), cx, y + height / 2 + (sample ? -1 : 1.8), { align: "center" });
        doc.setFontSize(6.5);
        doc.setTextColor(...PDF_GOLD);
        doc.text(pName === `PERIOD ${p}` ? "PERIOD" : pName, cx, y + height / 2 + (sample ? 3 : 6.2), { align: "center", maxWidth: width - 3 });
        if (sample) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          doc.setTextColor(214, 226, 218);
          doc.text(`${hhmm(sample.start_time)} - ${hhmm(sample.end_time)}`, cx, y + height / 2 + 7, { align: "center" });
        }
        return;
      }

      const cell = grid[`${p}-${printDays[data.column.index - 1]}`];
      if (!cell?.subject) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(185, 190, 187);
        doc.text("-", cx, y + height / 2 + 1.2, { align: "center" });
        return;
      }

      // Build centred lines, then centre the whole block vertically.
      const lines: { t: string; font: "bold" | "normal" | "italic"; size: number; color: [number, number, number] }[] = [
        { t: cell.subject, font: "bold", size: 9.5, color: PDF_GREEN_DARK },
      ];
      if (cell.teacher) lines.push({ t: cell.teacher, font: "normal", size: 7.8, color: [60, 66, 62] });
      if (cell.start_time && cell.end_time) lines.push({ t: `${hhmm(cell.start_time)} - ${hhmm(cell.end_time)}`, font: "normal", size: 6.8, color: [110, 116, 112] });
      if (cell.room) lines.push({ t: `Room ${cell.room}`, font: "italic", size: 6.8, color: [140, 105, 30] });

      const gap = 3.6;
      const blockH = (lines.length - 1) * gap;
      let ty = y + height / 2 - blockH / 2 + 1;
      lines.forEach((ln) => {
        doc.setFont("helvetica", ln.font);
        doc.setFontSize(ln.size);
        doc.setTextColor(...ln.color);
        doc.text(ln.t, cx, ty, { align: "center", maxWidth: width - 3 });
        ty += gap;
      });
    },
    didDrawPage: () => {
      doc.setDrawColor(...PDF_GOLD);
      doc.setLineWidth(0.5);
      doc.line(ML, h - 9, w - MR, h - 9);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...PDF_GREEN);
      doc.text("GHS BABI KHEL", w / 2, h - 4.5, { align: "center" });
    },
  });

  doc.save(`Timetable_Class${classLevel}.pdf`);
}

// ─── Substitution Image (WhatsApp) ──────────────────────────────────────────

/** Shrinks the font until the text fits, then trims with an ellipsis. */
function fitText(
  ctx: CanvasRenderingContext2D, text: string, maxW: number,
  weight: string, startPx: number, minPx: number, family: string,
): string {
  let px = startPx;
  ctx.font = `${weight} ${px}px ${family}`;
  while (ctx.measureText(text).width > maxW && px > minPx) {
    px -= 1;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  let out = text;
  while (ctx.measureText(out).width > maxW && out.length > 1) out = out.slice(0, -1);
  return out === text ? text : `${out.trimEnd()}…`;
}

async function exportSubstitutionImage(
  absentTeachers: string[],
  result: SubstitutionResult,
) {
  const SANS = `"Inter", "Segoe UI", Roboto, Arial, sans-serif`;
  const SERIF = `"Playfair Display", Georgia, "Times New Roman", serif`;
  try {
    await Promise.all([
      document.fonts.load(`700 40px "Playfair Display"`),
      document.fonts.load(`700 24px "Inter"`),
      document.fonts.load(`500 24px "Inter"`),
    ]);
  } catch { /* fall back to system fonts */ }

  const W = 1080;
  const PAD = 48;
  const cardW = W - PAD * 2;
  const cardH = 250;
  const cardGap = 26;

  const assigned = [...result.assigned].sort(
    (a, b) => a.period_number - b.period_number || a.class.localeCompare(b.class, undefined, { numeric: true }),
  );

  // Absent chips (wrapped) -- measured first so the header can grow.
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `700 26px ${SANS}`;
  const chipH = 52, chipGap = 14;
  const chipRows: string[][] = [[]];
  let rowW = 0;
  absentTeachers.forEach((n) => {
    const cw = measure.measureText(n).width + 56;
    if (rowW + cw > W - PAD * 2 && chipRows[chipRows.length - 1].length) { chipRows.push([]); rowW = 0; }
    chipRows[chipRows.length - 1].push(n);
    rowW += cw + chipGap;
  });
  const chipsBlockH = chipRows.length * (chipH + chipGap);

  const headerH = 330 + chipsBlockH;
  const uncoveredH = result.uncovered.length ? 110 + result.uncovered.length * 46 : 0;
  const bodyH = assigned.length ? assigned.length * (cardH + cardGap) : 140;
  const footerH = 150;
  const totalH = headerH + 40 + bodyH + uncoveredH + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.textBaseline = "alphabetic";

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, totalH);
  bg.addColorStop(0, "#f4f1e6");
  bg.addColorStop(1, "#eaf0e8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, totalH);

  // Header
  const hg = ctx.createLinearGradient(0, 0, W, headerH);
  hg.addColorStop(0, "#0b3a1f");
  hg.addColorStop(1, "#14532d");
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, headerH);
  // soft decorative circles
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.beginPath(); ctx.arc(W - 90, 60, 220, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(70, headerH - 20, 170, 0, Math.PI * 2); ctx.fill();
  // gold edge
  const gg = ctx.createLinearGradient(0, 0, W, 0);
  gg.addColorStop(0, "#a8801f"); gg.addColorStop(0.5, "#e6c565"); gg.addColorStop(1, "#a8801f");
  ctx.fillStyle = gg;
  ctx.fillRect(0, headerH - 8, W, 8);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 46px ${SERIF}`;
  ctx.fillText("GHS Babi Khel", W / 2, 84);
  ctx.fillStyle = "rgba(226,236,228,0.85)";
  ctx.font = `500 21px ${SANS}`;
  ctx.fillText("GOVERNMENT HIGH SCHOOL  ·  DISTRICT MOHMAND", W / 2, 122);

  // Divider ornament
  ctx.strokeStyle = "rgba(230,197,101,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W / 2 - 190, 158); ctx.lineTo(W / 2 - 24, 158); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2 + 24, 158); ctx.lineTo(W / 2 + 190, 158); ctx.stroke();
  ctx.fillStyle = "#e6c565";
  ctx.save(); ctx.translate(W / 2, 158); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore();

  ctx.fillStyle = "#e6c565";
  ctx.font = `700 54px ${SERIF}`;
  ctx.fillText("Substitute Arrangement", W / 2, 232);

  // Date pill
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  ctx.font = `600 24px ${SANS}`;
  const dpW = ctx.measureText(dateStr).width + 60;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, (W - dpW) / 2, 258, dpW, 48, 24, true, false);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(dateStr, W / 2, 291);

  // Absent chips
  let cy = 330;
  ctx.font = `700 26px ${SANS}`;
  chipRows.forEach((row) => {
    const widths = row.map((n) => ctx.measureText(n).width + 56);
    const total = widths.reduce((a, b) => a + b, 0) + chipGap * (row.length - 1);
    let cx0 = (W - total) / 2;
    row.forEach((n, i) => {
      ctx.fillStyle = "#fde8e6";
      roundRect(ctx, cx0, cy, widths[i], chipH, 26, true, false);
      ctx.fillStyle = "#c0392b";
      ctx.beginPath(); ctx.arc(cx0 + 24, cy + chipH / 2, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#7f1d1d";
      ctx.textAlign = "left";
      ctx.fillText(n, cx0 + 40, cy + 35);
      cx0 += widths[i] + chipGap;
    });
    cy += chipH + chipGap;
  });
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `600 18px ${SANS}`;
  ctx.fillText("ABSENT TODAY", W / 2, 322);

  // Cards
  let y = headerH + 40;
  if (!assigned.length) {
    ctx.fillStyle = "#6b7280";
    ctx.font = `italic 500 28px ${SANS}`;
    ctx.fillText("No substitute assignments were created.", W / 2, y + 70);
    y += 140;
  }
  assigned.forEach((a) => {
    const x = PAD;
    const match = a.reason === "subject-match";
    // shadow + body
    ctx.save();
    ctx.shadowColor = "rgba(20,60,35,0.14)";
    ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y, cardW, cardH, 28, true, false);
    ctx.restore();
    ctx.strokeStyle = "#dfe7e0"; ctx.lineWidth = 2;
    roundRect(ctx, x, y, cardW, cardH, 28, false, true);

    // top strip: class / period
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + 28, y); ctx.lineTo(x + cardW - 28, y);
    ctx.quadraticCurveTo(x + cardW, y, x + cardW, y + 28);
    ctx.lineTo(x + cardW, y + 70); ctx.lineTo(x, y + 70); ctx.lineTo(x, y + 28);
    ctx.quadraticCurveTo(x, y, x + 28, y);
    ctx.closePath();
    const sg = ctx.createLinearGradient(x, 0, x + cardW, 0);
    sg.addColorStop(0, "#14532d"); sg.addColorStop(1, "#1f6b3c");
    ctx.fillStyle = sg; ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `700 30px ${SANS}`;
    ctx.fillText(`CLASS ${a.class}   ·   PERIOD ${a.period_number}`, W / 2, y + 47);

    // subject pill
    const subj = (a.subject || "").toUpperCase();
    ctx.font = `700 22px ${SANS}`;
    const sw = ctx.measureText(subj).width + 48;
    ctx.fillStyle = "#fbf3d9";
    roundRect(ctx, (W - sw) / 2, y + 86, sw, 40, 20, true, false);
    ctx.fillStyle = "#8a6414";
    ctx.fillText(subj, W / 2, y + 114);

    // two columns: absent -> substitute
    const colW = (cardW - 120) / 2;
    const leftC = x + 20 + colW / 2;
    const rightC = x + cardW - 20 - colW / 2;

    ctx.fillStyle = "#9a9fa5";
    ctx.font = `700 17px ${SANS}`;
    ctx.fillText("ABSENT", leftC, y + 158);
    const origName = a.original_teacher || a.absent_teacher || "-";
    ctx.fillStyle = "#7f1d1d";
    const fittedOrig = fitText(ctx, origName, colW - 10, "600", 30, 18, SANS);
    ctx.fillText(fittedOrig, leftC, y + 198);

    ctx.fillStyle = "#14532d";
    ctx.font = `700 17px ${SANS}`;
    ctx.fillText("SUBSTITUTE", rightC, y + 158);
    ctx.fillStyle = "#0b3a1f";
    const fittedSub = fitText(ctx, a.substitute_teacher, colW - 10, "700", 32, 18, SANS);
    ctx.fillText(fittedSub, rightC, y + 198);

    // arrow medallion
    ctx.fillStyle = "#e6c565";
    ctx.beginPath(); ctx.arc(W / 2, y + 180, 32, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3a2a05"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(W / 2 - 13, y + 180); ctx.lineTo(W / 2 + 13, y + 180);
    ctx.moveTo(W / 2 + 4, y + 169); ctx.lineTo(W / 2 + 14, y + 180); ctx.lineTo(W / 2 + 4, y + 191);
    ctx.stroke();

    // reason tag
    const tag = match ? "SUBJECT EXPERT" : "FREE PERIOD";
    ctx.font = `700 15px ${SANS}`;
    const tw2 = ctx.measureText(tag).width + 32;
    ctx.fillStyle = match ? "#dcf5e6" : "#fdeccf";
    roundRect(ctx, (W - tw2) / 2, y + cardH - 34, tw2, 26, 13, true, false);
    ctx.fillStyle = match ? "#166534" : "#92580a";
    ctx.fillText(tag, W / 2, y + cardH - 15);

    y += cardH + cardGap;
  });

  // Uncovered
  if (result.uncovered.length) {
    const bh = 90 + result.uncovered.length * 46;
    ctx.fillStyle = "#fff1f0";
    roundRect(ctx, PAD, y, cardW, bh, 24, true, false);
    ctx.strokeStyle = "#f5b5b0"; ctx.lineWidth = 2;
    roundRect(ctx, PAD, y, cardW, bh, 24, false, true);
    ctx.fillStyle = "#b42318";
    ctx.textAlign = "center";
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText(`${result.uncovered.length} period(s) still need a teacher`, W / 2, y + 52);
    ctx.fillStyle = "#7f1d1d";
    ctx.font = `600 22px ${SANS}`;
    result.uncovered.forEach((u, i) => {
      ctx.fillText(`Class ${u.class}  ·  Period ${u.period_number}  ·  ${u.subject}`, W / 2, y + 96 + i * 46);
    });
    y += bh + cardGap;
  }

  // Footer
  ctx.fillStyle = "#14532d";
  ctx.fillRect(0, totalH - footerH + 20, W, footerH - 20);
  ctx.fillStyle = gg;
  ctx.fillRect(0, totalH - footerH + 20, W, 5);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 28px ${SERIF}`;
  ctx.fillText("Please reach your assigned class on time", W / 2, totalH - 62);
  ctx.fillStyle = "rgba(226,236,228,0.8)";
  ctx.font = `500 20px ${SANS}`;
  ctx.fillText("Principal Office  ·  GHS Babi Khel", W / 2, totalH - 28);

  const link = document.createElement("a");
  const fnameSafe = (absentTeachers.join("_") || "substitutes").replace(/\s+/g, "_");
  link.download = `Substitutes_${fnameSafe}_${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/** Canvas rounded-rect helper. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number, fill: boolean, stroke: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSTITUTE TEACHER DIALOG — mobile-friendly
// ─────────────────────────────────────────────────────────────────────────────
// A compact dialog that lets the admin:
//   1. Pick an absent teacher from the real Manage Teachers list.
//   2. Click "Assign Substitutes" — auto-assigns free teachers to every
//      class+period the absent teacher was supposed to teach today.
//   3. See a summary of assignments + uncovered periods.
//   4. Download a beautiful PNG image of the assignments for WhatsApp sharing.
//   5. Clear today's overrides if a mistake was made.
//
// Mobile-friendly: full-width buttons, large tap targets, no horizontal
// scrolling, stacks vertically on narrow screens.
// ─────────────────────────────────────────────────────────────────────────────
function SubstituteTeacherDialog({
  teachers, allTimetableEntries, onClose,
}: {
  teachers: ReturnType<typeof useTeachers>["data"];
  allTimetableEntries: import("@/hooks/useTimetable").TimetableEntry[];
  onClose: () => void;
}) {
  // MULTI-SELECT: pick one or many absent teachers. Different free
  // teachers are auto-assigned to each absent teacher's periods.
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [result, setResult] = useState<SubstitutionResult | null>(null);
  const assignMutation = useAssignSubstitutes();
  const clearMutation = useClearTodayOverrides();
  const { data: todayOverrides = [] } = useTodayTimetableOverrides();

  const toggleTeacher = (name: string) => {
    setSelectedTeachers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
    setResult(null);
  };

  const handleAssign = async () => {
    if (selectedTeachers.length === 0) {
      toast.error("Please select at least one absent teacher.");
      return;
    }
    setResult(null);
    const res = await assignMutation.mutateAsync({
      absentTeachers: selectedTeachers,
      teachers: teachers ?? [],
      allTimetableEntries,
      existingOverrides: todayOverrides,
    });
    setResult(res);
  };

  const handleDownloadImage = () => {
    if (!result || result.assigned.length === 0) {
      toast.error("No assignments to export.");
      return;
    }
    void exportSubstitutionImage(selectedTeachers, result);
    toast.success("PNG image downloaded — share it in the teachers' WhatsApp group.");
  };

  const handleClear = async () => {
    await clearMutation.mutateAsync();
    setResult(null);
    setSelectedTeachers([]);
  };

  // Group result entries by absent teacher for the summary.
  const resultByOwner = useMemo(() => {
    if (!result) return null;
    const map = new Map<string, { assigned: typeof result.assigned; uncovered: typeof result.uncovered }>();
    for (const t of selectedTeachers) {
      map.set(t, { assigned: [], uncovered: [] });
    }
    for (const a of result.assigned) {
      const key = a.absent_teacher || "(unknown)";
      if (!map.has(key)) map.set(key, { assigned: [], uncovered: [] });
      map.get(key)!.assigned.push(a);
    }
    for (const u of result.uncovered) {
      const key = u.absent_teacher || "(unknown)";
      if (!map.has(key)) map.set(key, { assigned: [], uncovered: [] });
      map.get(key)!.uncovered.push(u);
    }
    return map;
  }, [result, selectedTeachers]);

  // Today's day name for the info note
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayDateStr = new Date().toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-5 gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-400 text-amber-950 shadow-md shadow-amber-500/25">
              <UserX className="h-4 w-4" />
            </span>
            Substitute Teacher — Today Only
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Pick one or more absent teachers. Free teachers will be auto-assigned to cover their classes <strong>today only</strong> ({todayName}, {todayDateStr}). Each absent teacher's periods will be covered by <strong>different</strong> free teachers so nobody is double-booked at the same period. A shareable image is generated for the teachers' WhatsApp group.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* ── Multi-select teacher picker ──
              Popover with a checkable list of teachers. Selected teachers
              show as removable chips. Works on mobile (the popover anchors
              to the trigger, scrollable list inside). */}
          <div>
            <Label className="text-xs font-semibold">Absent Teacher(s)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="mt-1 w-full justify-between font-normal h-auto min-h-10 py-2"
                >
                  <span className="text-left flex-1 truncate">
                    {selectedTeachers.length === 0
                      ? "Select absent teacher(s)…"
                      : selectedTeachers.length === 1
                        ? selectedTeachers[0]
                        : `${selectedTeachers.length} teachers selected`}
                  </span>
                  <span className="ml-2 text-muted-foreground text-xs">▾</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0 max-h-72 overflow-y-auto z-[200]"
                align="start"
              >
                <div className="p-1">
                  {(teachers ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground p-3">No teachers found.</p>
                  )}
                  {(teachers ?? []).map((t) => {
                    const checked = selectedTeachers.includes(t.full_name);
                    return (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => toggleTeacher(t.full_name)}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-secondary text-left text-sm"
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            checked
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-border bg-background"
                          }`}
                          aria-hidden="true"
                        >
                          {checked && <Check className="w-3 h-3" />}
                        </span>
                        <span className="flex-1 truncate">
                          {t.full_name}
                          {t.subject && (
                            <span className="text-muted-foreground text-xs"> ({t.subject})</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedTeachers.length > 0 && (
                  <div className="border-t border-border p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs h-7"
                      onClick={() => setSelectedTeachers([])}
                    >
                      Clear all
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Selected chips — visible feedback for what's picked */}
            {selectedTeachers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {selectedTeachers.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full pl-2.5 pr-1 py-0.5 text-xs font-medium"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => toggleTeacher(name)}
                      className="p-0.5 rounded-full hover:bg-primary/20 transition-colors"
                      aria-label={`Remove ${name}`}
                    >
                      <XIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Action buttons ── */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleAssign}
              disabled={selectedTeachers.length === 0 || assignMutation.isPending}
              className="h-9 w-full gap-1.5 rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {assignMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
              Assign Substitutes for Today ({selectedTeachers.length})
            </Button>

            {result && result.assigned.length > 0 && (
              <Button
                onClick={handleDownloadImage}
                variant="outline"
                className="h-9 w-full gap-1.5 rounded-full px-4 text-xs font-semibold shadow-none bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
              >
                <ImageIcon className="w-3.5 h-3.5" /> Download WhatsApp Image (PNG)
              </Button>
            )}

            {todayOverrides.length > 0 && (
              <Button
                onClick={handleClear}
                variant="outline"
                disabled={clearMutation.isPending}
                className="h-9 w-full gap-1.5 rounded-full px-4 text-xs font-semibold shadow-none border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {clearMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Clear Today's Substitutes ({todayOverrides.length})
              </Button>
            )}
          </div>

          {/* ── Result summary — grouped by absent teacher ── */}
          {result && resultByOwner && (
            <div className="mt-2 space-y-3">
              {/* Overall summary tiles */}
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-xs font-semibold text-foreground mb-1">
                  Summary ({selectedTeachers.length} absent teacher{selectedTeachers.length === 1 ? "" : "s"})
                </p>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 p-2">
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{result.assigned.length}</p>
                    <p className="text-[10px] text-muted-foreground">Covered</p>
                  </div>
                  <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-2">
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">{result.uncovered.length}</p>
                    <p className="text-[10px] text-muted-foreground">Uncovered</p>
                  </div>
                </div>
              </div>

              {/* Per-teacher breakdown */}
              {Array.from(resultByOwner.entries()).map(([owner, bucket]) => (
                <div key={owner} className="rounded-lg border border-border bg-card p-2.5">
                  <p className="text-xs font-bold text-foreground mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5 text-amber-500" />
                      {owner}
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {bucket.assigned.length} covered · {bucket.uncovered.length} uncovered
                    </span>
                  </p>

                  {bucket.assigned.length > 0 ? (
                    <div className="space-y-1.5">
                      {bucket.assigned.map((a, i) => (
                        <div key={i} className="rounded-md border border-border p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-foreground">
                              Class {a.class} · P{a.period_number}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{a.subject}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">→ {a.substitute_teacher}</span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] h-4 px-1 ${
                                a.reason === "subject-match"
                                  ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
                                  : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                              }`}
                            >
                              {a.reason === "subject-match" ? "Subject Match" : "Free Period"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground italic">No classes scheduled for today.</p>
                  )}

                  {bucket.uncovered.length > 0 && (
                    <div className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-2 mt-1.5">
                      <p className="text-[11px] font-semibold text-red-700 dark:text-red-400 mb-1">
                        ⚠ Could not cover:
                      </p>
                      {bucket.uncovered.map((u, i) => (
                        <p key={i} className="text-[11px] text-red-600 dark:text-red-500">
                          • Class {u.class} P{u.period_number} ({u.subject}) — {u.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Today's existing overrides (if any) ── */}
          {!result && todayOverrides.length > 0 && (
            <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-2">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">
                ℹ {todayOverrides.length} substitute assignment(s) already active for today:
              </p>
              <div className="space-y-0.5 max-h-32 overflow-y-auto">
                {todayOverrides.slice(0, 8).map((o) => (
                  <p key={o.id} className="text-[10px] text-blue-600 dark:text-blue-500">
                    • Class {o.class} P{o.period_number} ({o.subject}): {o.substitute_teacher}
                  </p>
                ))}
                {todayOverrides.length > 8 && (
                  <p className="text-[10px] text-muted-foreground italic">...and {todayOverrides.length - 8} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="h-9 w-full rounded-full px-4 text-xs font-semibold shadow-none">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Admin Timetables Component ────────────────────────────────────────

const AdminTimetables = () => {
  const qc = useQueryClient();
  const [cls, setCls] = useState("6");
  const [grid, setGrid] = useState<Grid>({});
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [showSubstituteDialog, setShowSubstituteDialog] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<any>(null);
  const [conflictType, setConflictType] = useState<"teacher" | "room">("teacher");
  const [conflictCellKey, setConflictCellKey] = useState<string | null>(null);
  const [copyDayDialog, setCopyDayDialog] = useState<string | null>(null); // source day name, or null when closed
  const [copyDayTargets, setCopyDayTargets] = useState<string[]>([]);
  const [mobileDay, setMobileDay] = useState<string>("Monday"); // mobile shows one day at a time

  // ─── 2.1 Period Names from Supabase ─────────────────────────────────────
  const { data: settings } = useTimetableSettings(cls);
  const saveSettings = useSaveTimetableSettings();
  const [periodNames, setPeriodNames] = useState<Record<string, string>>(defaultPeriodNames());

  useEffect(() => {
    if (settings?.period_names) {
      setPeriodNames(settings.period_names as Record<string, string>);
    }
  }, [settings]);

  const handlePeriodNameChange = useCallback((periodNum: number, name: string) => {
    setPeriodNames((prev) => {
      const next = { ...prev, [periodNum]: name };
      // Debounced save to Supabase
      saveSettings.mutate({ classLevel: cls, periodNames: next });
      return next;
    });
  }, [cls, saveSettings]);

  // ─── Fetch timetable data ──────────────────────────────────────────────
  const queryKey = ["admin-timetable", cls];
  const { data: rows = [], isLoading } = useQuery<TimetableRow[]>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("timetables").select("*").eq("class", cls);
      if (error) throw error;
      return (data ?? []) as TimetableRow[];
    },
  });

  // ─── All timetables (for conflict detection) ───────────────────────────
  const { data: allRows = [] } = useAllTimetables();

  // ─── Rooms ─────────────────────────────────────────────────────────────
  const { data: rooms = [] } = useRooms();

  // ─── Teachers (real list from Manage Teachers, replaces free-text typing) ──
  // includeInactive = true: the admin needs to see ALL teachers here (active
  // AND inactive) so they can assign anyone to a timetable slot. A teacher
  // might be marked inactive in Manage Teachers (e.g. temporarily on leave,
  // or the admin forgot to tick the "Active" switch when adding them).
  // Inactive teachers are shown greyed out in the dropdown below but are
  // still selectable. Public-facing pages (homepage, public Teachers page,
  // student dashboard) keep using useTeachers() without this flag, so they
  // only show active teachers to visitors/students.
  const { data: teachers = [] } = useTeachers(undefined, true);

  useEffect(() => {
    const g: Grid = {};
    periods.forEach((p) => days.forEach((d) => { g[`${p}-${d}`] = emptyCell(); }));
    rows.forEach((r) => {
      g[`${r.period_number}-${r.day}`] = {
        subject: r.subject, teacher: r.teacher || "", start_time: r.start_time || "",
        end_time: r.end_time || "", room: r.room || "", meet_link: (r as any).meet_link || "",
      };
    });
    setGrid(g);
  }, [rows]);

  const updateCell = useCallback((key: string, field: keyof CellData, value: string) => {
    setGrid((prev) => {
      const next = { ...prev, [key]: { ...prev[key], [field]: value } };
      // When a teacher is picked and the subject field is still empty,
      // auto-fill it from the teacher's profile (Manage Teachers → subject).
      // Never overwrites a subject the admin already typed/kept.
      if (field === "teacher" && !prev[key]?.subject?.trim()) {
        const t = teachers.find((tc) => tc.full_name === value);
        if (t?.subject) next[key] = { ...next[key], subject: t.subject };
      }
      return next;
    });
  }, [teachers]);

  // ─── 2.2 Real-time Conflict Detection ──────────────────────────────────
  const teacherConflicts = useMemo(() => {
    const conflicts: Record<string, { teacher: string; existingClass: string; existingSubject: string }[]> = {};
    // For each cell in grid, check if teacher is already assigned elsewhere
    periods.forEach((p) => {
      days.forEach((d) => {
        const key = `${p}-${d}`;
        const cell = grid[key];
        if (!cell?.teacher?.trim()) return;
        // Check against allRows (other classes)
        const matches = allRows.filter(
          (r) =>
            r.day === d &&
            r.period_number === p &&
            r.class !== cls &&
            (r.teacher || r.teacher_name || "").toLowerCase().trim() === cell.teacher.toLowerCase().trim()
        );
        if (matches.length) {
          if (!conflicts[key]) conflicts[key] = [];
          matches.forEach((m) => conflicts[key].push({
            teacher: cell.teacher,
            existingClass: m.class,
            existingSubject: m.subject,
          }));
        }
      });
    });
    return conflicts;
  }, [grid, allRows, cls]);

  const roomConflicts = useMemo(() => {
    const conflicts: Record<string, { room: string; existingClass: string; existingSubject: string }[]> = {};
    periods.forEach((p) => {
      days.forEach((d) => {
        const key = `${p}-${d}`;
        const cell = grid[key];
        if (!cell?.room?.trim()) return;
        const matches = allRows.filter(
          (r) => r.day === d && r.period_number === p && r.class !== cls && r.room?.toLowerCase().trim() === cell.room.toLowerCase().trim()
        );
        if (matches.length) {
          if (!conflicts[key]) conflicts[key] = [];
          matches.forEach((m) => conflicts[key].push({ room: cell.room, existingClass: m.class, existingSubject: m.subject }));
        }
      });
    });
    return conflicts;
  }, [grid, allRows, cls]);

  // ─── Busy-teacher lookup for the dropdown (Feature: prevent duplicate
  //     assignment at the point of selection, not just at save time) ──────
  // For a given day+period, returns a map of teacher full_name → which other
  // class already has them booked, so the dropdown can show "(busy — Class 7)"
  // next to that teacher's name and the admin never picks a conflict in the
  // first place.
  const getBusyTeachersFor = useCallback((day: string, periodNumber: number): Record<string, string> => {
    const busy: Record<string, string> = {};
    allRows
      .filter((r) => r.day === day && r.period_number === periodNumber && r.class !== cls)
      .forEach((r) => {
        const t = (r.teacher || r.teacher_name || "").trim();
        if (t) busy[t] = r.class;
      });
    return busy;
  }, [allRows, cls]);

  // ─── Save with conflict check ──────────────────────────────────────────
  const handleSave = async () => {
    // ── Pre-save validation: block save if any teacher is double-booked ──
    // teacherConflicts is a Record<cellKey, conflicts[]> computed from grid
    // + allRows (the other classes' timetables). If even one conflict exists
    // we refuse to save and surface a clear, actionable toast.
    const conflictKeys = Object.keys(teacherConflicts);
    if (conflictKeys.length > 0) {
      const first = teacherConflicts[conflictKeys[0]][0];
      // Decode the cellKey to a human-readable day + period
      const [periodNo, dayName] = conflictKeys[0].split("-");
      toast.error(
        `Cannot save: ${first.teacher} is already assigned to Class ${first.existingClass} ` +
        `(${first.existingSubject}) on ${dayName} Period ${periodNo}. ` +
        `Resolve all ${conflictKeys.length} conflict${conflictKeys.length > 1 ? "s" : ""} first.`,
        { duration: 6000 }
      );
      return;
    }

    setSaving(true);
    try {
      const inserts: Omit<TimetableRow, "id">[] = [];
      periods.forEach((p) => days.forEach((d) => {
        const cell = grid[`${p}-${d}`];
        if (cell?.subject) {
          inserts.push({
            class: cls, day: d, period_number: p, subject: cell.subject, teacher: cell.teacher,
            start_time: cell.start_time, end_time: cell.end_time, room: cell.room, meet_link: cell.meet_link,
          });
        }
      }));

      // Delete existing rows for this class — CHECK the error this time.
      // The old code silently ignored delete failures, which masked RLS issues.
      const { error: delErr } = await supabase.from("timetables").delete().eq("class", cls);
      if (delErr) {
        // PGRST116 = "JSON object requested, but no rows matched" — harmless
        // here (nothing to delete). Any other error is a real problem.
        if (delErr.code !== "PGRST116") {
          toast.error(`Delete failed: ${delErr.message}`, { duration: 6000 });
          return;
        }
      }

      if (inserts.length) {
        const { error } = await supabase.from("timetables").insert(inserts);
        if (error) {
          // Surface the actual Postgres/PostgREST message so the user (and
          // we, debugging) can see e.g. "new row violates row-level security
          // policy" or "column \"teacher_name\" does not exist" instead of
          // the old opaque "Save failed".
          toast.error(`Save failed: ${error.message}`, { duration: 7000 });
          return;
        }
      }
      toast.success("Timetable saved!");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["all-timetables"] });
    } catch (err) {
      // Catch network errors, supabase client errors, anything thrown.
      toast.error(err?.message || "Save failed — please try again.", { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await supabase.from("timetables").delete().eq("class", cls);
    toast.success("Cleared");
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["all-timetables"] });
  };

  // ─── Copy one day's full schedule (all periods, this class) to other days ──
  // This is the "set up Monday once, then one click to apply the same
  // periods/teachers/rooms to Tuesday, Wednesday, etc." feature. Only touches
  // the current class's grid in memory — admin still clicks Save afterward,
  // so nothing is written to Supabase until they confirm. Conflict checks
  // (teacherConflicts/roomConflicts) automatically re-run against the updated
  // grid since they're derived via useMemo from `grid`.
  const handleCopyDayToOthers = (sourceDay: string, targetDays: string[]) => {
    if (!targetDays.length) return;
    setGrid((prev) => {
      const next = { ...prev };
      periods.forEach((p) => {
        const sourceCell = prev[`${p}-${sourceDay}`];
        targetDays.forEach((targetDay) => {
          next[`${p}-${targetDay}`] = sourceCell ? { ...sourceCell } : emptyCell();
        });
      });
      return next;
    });
    toast.success(`Copied ${sourceDay}'s schedule to ${targetDays.join(", ")}. Review conflicts, then click Save.`, { duration: 5000 });
    setCopyDayDialog(null);
    setCopyDayTargets([]);
  };

  // ─── Swap on conflict ─────────────────────────────────────────────────
  const handleConflictSwap = async () => {
    if (!conflictCellKey || !conflictInfo) return;
    // Clear the conflicting teacher/room from the other class entry
    const { day, period_number } = (() => {
      const [p, d] = conflictCellKey.split("-");
      return { day: d, period_number: parseInt(p) };
    })();

    // Find and clear the other class's entry
    const otherClass = conflictInfo.existing_class || conflictInfo.existingClass;
    const { data: otherRows } = await supabase
      .from("timetables")
      .select("id")
      .eq("class", otherClass)
      .eq("day", day)
      .eq("period_number", period_number);

    if (otherRows?.length) {
      const field = conflictType === "teacher" ? "teacher" : "room";
      await supabase.from("timetables").update({ [field]: null }).eq("id", otherRows[0].id);
      qc.invalidateQueries({ queryKey: ["all-timetables"] });
      toast.success(`Swapped ${conflictType} from Class ${otherClass}`);
    }
    setConflictInfo(null);
    setConflictCellKey(null);
  };

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  const filledCount = periods.reduce((acc, p) => acc + days.filter((d) => grid[`${p}-${d}`]?.subject).length, 0);
  const totalSlots = periods.length * days.length;
  const totalConflicts = Object.keys(teacherConflicts).length + Object.keys(roomConflicts).length;

  const btn = "h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none";
  const pillBtn = (active = false) =>
    `h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
      active
        ? "bg-primary text-primary-foreground border-primary shadow-sm"
        : "bg-card text-muted-foreground border-border/70 hover:bg-secondary hover:text-foreground"
    }`;

  // Compact, reusable preview of one period cell.
  const renderCellSummary = (cell: CellData, compact = false) =>
    cell.subject ? (
      <div className={`flex flex-col ${compact ? "items-center text-center" : "items-start text-left"} gap-0.5 min-w-0 w-full`}>
        <p className="font-semibold text-xs text-foreground leading-tight truncate max-w-full">{cell.subject}</p>
        {cell.teacher && <p className="text-[10px] text-muted-foreground truncate max-w-full">{cell.teacher}</p>}
        {(cell.start_time || cell.room) && (
          <p className="text-[10px] text-muted-foreground/90 truncate max-w-full">
            {cell.start_time && `${cell.start_time}–${cell.end_time}`}
            {cell.start_time && cell.room && " · "}
            {cell.room}
          </p>
        )}
      </div>
    ) : (
      <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1"><Plus className="w-3 h-3" /> Add</p>
    );

  const renderConflictBadges = (key: string, d: string, p: number) => {
    const tConflict = teacherConflicts[key];
    const rConflict = roomConflicts[key];
    if (!tConflict?.length && !rConflict?.length) return null;
    return (
      <div className="flex flex-col gap-0.5 mb-1 max-w-full">
        {tConflict?.map((c, i) => (
          <Badge key={`t${i}`} variant="destructive" className="max-w-full truncate text-[9px] h-4 px-1.5 gap-0.5 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setConflictType("teacher"); setConflictInfo({ ...c, day: d, period_number: p }); setConflictCellKey(key); }}>
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{c.teacher} → Cls {c.existingClass}</span>
          </Badge>
        ))}
        {rConflict?.map((c, i) => (
          <Badge key={`r${i}`} variant="destructive" className="max-w-full truncate text-[9px] h-4 px-1.5 gap-0.5 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setConflictType("room"); setConflictInfo({ ...c, day: d, period_number: p }); setConflictCellKey(key); }}>
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">{c.room} → Cls {c.existingClass}</span>
          </Badge>
        ))}
      </div>
    );
  };

  // Cell being edited (opened in a dialog so it works well on phones too)
  const editParts = editingCell ? editingCell.split("-") : null;
  const editP = editParts ? Number(editParts[0]) : 0;
  const editD = editParts ? editParts[1] : "";
  const editCell = editingCell ? grid[editingCell] || emptyCell() : emptyCell();

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* ─── Premium header ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <CalendarDays className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Timetables</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              <span>Class {cls} · tap a period to edit</span>
              <span className="hidden sm:inline text-border">•</span>
              <span className="font-semibold text-foreground">{filledCount}/{totalSlots}</span> slots filled
            </p>
          </div>
          {totalConflicts > 0 && (
            <Badge variant="destructive" className="h-6 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] font-semibold">
              <AlertTriangle className="w-3 h-3" /> {totalConflicts} Conflict{totalConflicts > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Action toolbar — thin pills (grid on phones, row on desktop) */}
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button
            onClick={handleSave}
            disabled={saving}
            className={`${btn} flex items-center justify-center border-0 bg-primary px-4 text-primary-foreground hover:bg-primary/90`}
            title={Object.keys(teacherConflicts).length > 0 ? "Resolve all teacher conflicts before saving" : undefined}
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Timetable
          </Button>
          <Button variant="outline" onClick={() => exportTimetablePDF(cls, periodNames, grid)} className={`${btn} flex items-center justify-center`}>
            <Download className="w-3.5 h-3.5 shrink-0" /> PDF
          </Button>
          <Button variant="outline" onClick={() => setShowRoomManager(true)} className={`${btn} flex items-center justify-center`}>
            <MapPin className="w-3.5 h-3.5 shrink-0" /> Rooms
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowSubstituteDialog(true)}
            className={`${btn} flex items-center justify-center border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50`}
          >
            <UserX className="w-3.5 h-3.5 shrink-0" /> Substitute
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className={`${btn} flex items-center justify-center border-destructive/40 text-destructive hover:bg-destructive/10 sm:ml-auto`}>
                <Trash2 className="w-3.5 h-3.5 shrink-0" /> Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Clear timetable?</AlertDialogTitle>
                <AlertDialogDescription>All periods for Class {cls} will be removed.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-9 rounded-full px-4 text-xs font-semibold shadow-none">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClear} className="h-9 rounded-full px-4 text-xs font-semibold shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* ─── Class selector — premium pill tabs ───────────────────────── */}
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
          {classes.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCls(c)}
              className={pillBtn(cls === c)}
            >
              Class {c}
            </button>
          ))}
        </div>
      </div>

      {/* ─── MOBILE: one day at a time ──────────────────────────────────── */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-1 -mx-1 px-1">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setMobileDay(d)}
                className={`h-8 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                  mobileDay === d
                    ? "bg-gradient-to-r from-primary to-primary-light text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-muted-foreground border-border/70 hover:bg-secondary"
                }`}
              >
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-full shadow-none shrink-0"
            title={`Copy ${mobileDay} to other days`}
            onClick={() => { setCopyDayDialog(mobileDay); setCopyDayTargets([]); }}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="space-y-2">
          {periods.map((p) => {
            const key = `${p}-${mobileDay}`;
            const cell = grid[key] || emptyCell();
            const hasConflict = teacherConflicts[key]?.length || roomConflicts[key]?.length;
            return (
              <div
                key={key}
                onClick={() => setEditingCell(key)}
                className={`flex items-stretch rounded-2xl border overflow-hidden cursor-pointer transition ${
                  hasConflict
                    ? "border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 shadow-[0_0_0_3px_hsl(0_74%_42%/0.06)]"
                    : cell.subject
                    ? `${getSubjectColor(cell.subject)} shadow-sm`
                    : "border-dashed border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="w-16 shrink-0 flex flex-col items-center justify-center bg-background/60 border-r border-border/60 px-1 py-2">
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Period</span>
                  <span className="text-base font-heading font-bold text-primary leading-none mt-0.5">{p}</span>
                </div>
                <div className="flex-1 min-w-0 p-3">
                  {renderConflictBadges(key, mobileDay, p)}
                  {cell.subject ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-sm text-foreground truncate">{cell.subject}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {cell.teacher && <span className="truncate">{cell.teacher}</span>}
                        {cell.start_time && <span>{cell.start_time}–{cell.end_time}</span>}
                        {cell.room && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{cell.room}</span>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 flex items-center gap-1 py-1"><Plus className="w-3.5 h-3.5" /> Tap to add {periodNames[p] || `Period ${p}`}</p>
                  )}
                </div>
                <div className="flex items-center pr-3 text-muted-foreground/60"><Pencil className="w-3.5 h-3.5" /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── DESKTOP: full weekly grid ──────────────────────────────────── */}
      <div className="hidden md:block rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/40 px-4 py-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"><CalendarDays className="h-3 w-3" /></span>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Weekly Schedule — Class {cls}</p>
          <span className="ml-auto text-[11px] font-medium text-muted-foreground">Click any cell to edit · click day name to copy</span>
        </div>
        <div className="overflow-x-auto admin-nav-scroll">
          <table className="w-full text-sm border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-secondary/50">
                <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wider font-bold text-muted-foreground w-32 border-b border-border">Period</th>
                {days.map((d) => (
                  <th key={d} className="px-2 py-2.5 text-center text-[10px] uppercase tracking-wider font-bold text-muted-foreground min-w-[125px] border-b border-l border-border">
                    <div className="flex items-center justify-center gap-1.5">
                      {d}
                      <button
                        type="button"
                        title={`Copy ${d}'s schedule to other days`}
                        onClick={() => { setCopyDayDialog(d); setCopyDayTargets([]); }}
                        className="text-muted-foreground/70 hover:text-primary transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p}>
                  <td className="px-2 py-1.5 bg-secondary/30 border-b border-border">
                    <input
                      type="text"
                      value={periodNames[p] || `Period ${p}`}
                      onChange={(e) => handlePeriodNameChange(p, e.target.value)}
                      className="w-full bg-transparent text-xs font-semibold text-foreground border-none outline-none text-center"
                      placeholder={`Period ${p}`}
                    />
                  </td>
                  {days.map((d) => {
                    const key = `${p}-${d}`;
                    const cell = grid[key] || emptyCell();
                    const hasConflict = teacherConflicts[key]?.length || roomConflicts[key]?.length;
                    return (
                      <td
                        key={key}
                        onClick={() => setEditingCell(key)}
                        className={`p-1.5 border-b border-l border-border cursor-pointer transition-colors align-middle ${
                          hasConflict
                            ? "bg-red-50 dark:bg-red-900/20"
                            : cell.subject
                            ? getSubjectColor(cell.subject)
                            : "hover:bg-secondary/40"
                        }`}
                      >
                        {renderConflictBadges(key, d, p)}
                        <div className="min-h-[46px] flex items-center justify-center px-1">
                          {renderCellSummary(cell, true)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Period editor dialog ───────────────────────────────────────── */}
      {editingCell && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditingCell(null); }}>
          <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto rounded-2xl p-5 gap-3">
            <DialogHeader>
              <DialogTitle className="text-base">{editD} · {periodNames[editP] || `Period ${editP}`}</DialogTitle>
              <DialogDescription className="text-xs">Class {cls}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Subject</Label>
                <Input className="h-9 text-sm" placeholder="e.g. Mathematics" value={editCell.subject} onChange={(e) => updateCell(editingCell, "subject", e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Teacher</Label>
                {(() => {
                  const busy = getBusyTeachersFor(editD, editP);
                  return (
                    <Select value={editCell.teacher || "__none__"} onValueChange={(v) => updateCell(editingCell, "teacher", v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select teacher" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— No teacher —</SelectItem>
                        {teachers.map((t) => {
                          const busyClass = busy[t.full_name];
                          const inactiveTag = t.is_active ? "" : " (inactive)";
                          return (
                            <SelectItem key={t.id} value={t.full_name} disabled={!!busyClass && t.full_name !== editCell.teacher}>
                              <span className={!t.is_active ? "opacity-50" : ""}>
                                {t.full_name}{t.subject ? ` (${t.subject})` : ""}{inactiveTag}{busyClass && t.full_name !== editCell.teacher ? ` — busy: Class ${busyClass}` : ""}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Start</Label>
                  <Input type="time" className="h-9 text-sm" value={editCell.start_time} onChange={(e) => updateCell(editingCell, "start_time", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">End</Label>
                  <Input type="time" className="h-9 text-sm" value={editCell.end_time} onChange={(e) => updateCell(editingCell, "end_time", e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Room</Label>
                <Select value={rooms.find((r) => r.name === editCell.room) ? editCell.room : "__custom__"} onValueChange={(v) => {
                  if (v === "__custom__") return;
                  updateCell(editingCell, "room", v);
                }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Room" /></SelectTrigger>
                  <SelectContent>
                    {rooms.filter((r) => r.is_available).map((r) => (
                      <SelectItem key={r.id} value={r.name}>{r.name} ({r.room_type})</SelectItem>
                    ))}
                    <SelectItem value="__custom__">Type custom...</SelectItem>
                  </SelectContent>
                </Select>
                {!rooms.find((r) => r.name === editCell.room) && (
                  <Input placeholder="Room (custom)" value={editCell.room} onChange={(e) => updateCell(editingCell, "room", e.target.value)} className="h-9 text-sm mt-1.5" />
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Meet link <span className="text-muted-foreground">(optional)</span></Label>
                <Input placeholder="https://meet.google.com/..." value={editCell.meet_link} onChange={(e) => updateCell(editingCell, "meet_link", e.target.value)} className="h-9 text-sm" />
              </div>
            </div>

            <DialogFooter className="flex-row gap-2 sm:justify-between pt-1">
              <Button
                variant="outline"
                className={`${btn} flex items-center justify-center border-destructive/40 text-destructive hover:bg-destructive/10 flex-1 sm:flex-none`}
                onClick={() => {
                  (["subject", "teacher", "start_time", "end_time", "room", "meet_link"] as (keyof CellData)[]).forEach((f) => updateCell(editingCell, f, ""));
                  setEditingCell(null);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </Button>
              <Button className={`${btn} flex items-center justify-center bg-primary px-5 text-primary-foreground hover:bg-primary/90 flex-1 sm:flex-none`} onClick={() => setEditingCell(null)}>
                <Check className="w-3.5 h-3.5" /> Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── Copy Day → Other Days dialog ───────────────────────────────── */}
      {copyDayDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) { setCopyDayDialog(null); setCopyDayTargets([]); } }}>
          <DialogContent className="max-w-md rounded-2xl p-5">
            <DialogHeader>
              <DialogTitle className="text-base">Copy {copyDayDialog}'s Schedule</DialogTitle>
              <DialogDescription className="text-xs">
                Applies all of Class {cls}'s {copyDayDialog} periods (subject, teacher, time, room) to the
                days you pick. This only updates the grid — click <strong>Save</strong> afterward to
                write it to the database.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2 py-1">
              {days.filter((d) => d !== copyDayDialog).map((d) => {
                const active = copyDayTargets.includes(d);
                return (
                  <label key={d} className={`flex items-center gap-2 text-sm rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${active ? "border-primary/40 bg-primary/10" : "border-border hover:bg-secondary/50"}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`} aria-hidden>
                      {active && <Check className="w-3 h-3" />}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={active}
                      onChange={(e) => {
                        setCopyDayTargets((prev) =>
                          e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)
                        );
                      }}
                    />
                    {d}
                  </label>
                );
              })}
            </div>
            <DialogFooter className="flex-row gap-2 sm:justify-end">
              <Button variant="outline" className={`${btn} flex-1 sm:flex-none`} onClick={() => { setCopyDayDialog(null); setCopyDayTargets([]); }}>Cancel</Button>
              <Button
                className={`${btn} flex-1 bg-primary px-5 text-primary-foreground hover:bg-primary/90 sm:flex-none`}
                disabled={!copyDayTargets.length}
                onClick={() => handleCopyDayToOthers(copyDayDialog, copyDayTargets)}
              >
                Copy to {copyDayTargets.length || ""} day{copyDayTargets.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showRoomManager && <RoomManager onClose={() => setShowRoomManager(false)} />}
      {showSubstituteDialog && (
        <SubstituteTeacherDialog
          teachers={teachers}
          allTimetableEntries={allRows}
          onClose={() => setShowSubstituteDialog(false)}
        />
      )}
      {conflictInfo && (
        <ConflictDialog
          conflict={conflictInfo}
          type={conflictType}
          onSwap={handleConflictSwap}
          onCancel={() => { setConflictInfo(null); setConflictCellKey(null); }}
        />
      )}
    </div>
  );
};

export default AdminTimetables;
