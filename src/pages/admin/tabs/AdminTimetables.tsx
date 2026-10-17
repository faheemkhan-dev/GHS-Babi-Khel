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
  Loader2, Trash2, Copy, AlertTriangle, Plus, Pencil, Download, Share2,
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

// ─── PDF Export (Feature 2.4) ───────────────────────────────────────────────

function exportTimetablePDF(
  classLevel: string,
  periodNames: Record<string, string>,
  grid: Grid,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const ML = 10, MR = 10;

  // Header
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.8);
  doc.line(ML, 8, w - MR, 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(10, 10, 10);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", w / 2, 15, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);
  doc.text("District Mohmand, Khyber Pakhtunkhwa", w / 2, 20, { align: "center" });
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.25);
  doc.line(ML, 23, w - MR, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(10, 10, 10);
  doc.text(`CLASS ${classLevel} TIMETABLE`, w / 2, 29, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 70, 70);
  doc.text(`Academic Year ${new Date().getFullYear()}`, w / 2, 34, { align: "center" });
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(0.8);
  doc.line(ML, 37, w - MR, 37);

  // Table data
  const head = [["Period", ...days]];
  const body = periods.map((p) => {
    const pName = periodNames[p] || `Period ${p}`;
    const row: string[] = [pName];
    days.forEach((d) => {
      const cell = grid[`${p}-${d}`];
      if (cell?.subject) {
        let text = cell.subject;
        if (cell.teacher) text += `\n${cell.teacher}`;
        if (cell.start_time && cell.end_time) text += `\n${cell.start_time}-${cell.end_time}`;
        if (cell.room) text += `\nRoom: ${cell.room}`;
        row.push(text);
      } else {
        row.push("—");
      }
    });
    return row;
  });

  autoTable(doc, {
    startY: 40,
    head,
    body,
    headStyles: { fillColor: [30, 30, 30], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9, halign: "center", cellPadding: 4 },
    bodyStyles: { fontSize: 8, cellPadding: 3, textColor: [20, 20, 20], halign: "center", valign: "middle" },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold", halign: "center" },
      ...Object.fromEntries(days.map((_, i) => [i + 1, { cellWidth: "auto", halign: "center" }])),
    },
    alternateRowStyles: { fillColor: [246, 247, 250] },
    margin: { left: ML, right: MR, bottom: 14 },
    didDrawPage: (data) => {
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.25);
      doc.line(ML, h - 10, w - MR, h - 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(80, 80, 80);
      doc.text("GHS Babi Khel — Class Timetable", ML, h - 6);
      doc.text(`Generated: ${new Date().toLocaleDateString("en-GB")}`, w / 2, h - 6, { align: "center" });
    },
  });

  doc.save(`Timetable_Class${classLevel}.pdf`);
}

// ─── Image Export (Feature 2.4) ─────────────────────────────────────────────

function exportTimetableImage(
  classLevel: string,
  periodNames: Record<string, string>,
  grid: Grid,
) {
  // Create a canvas-based image for sharing.
  // Rendered at a fixed high scale (not just devicePixelRatio) so the
  // downloaded PNG stays crisp regardless of the phone's screen density —
  // otherwise low-DPR devices produce a soft/blurry image.
  const canvas = document.createElement("canvas");
  const cellW = 140;
  const cellH = 70;
  const headerH = 40;
  const labelW = 110;
  const padding = 20;
  const totalW = labelW + days.length * cellW + padding * 2;
  const totalH = headerH + periods.length * cellH + padding * 2 + 50;

  const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  canvas.style.width = `${totalW}px`;
  canvas.style.height = `${totalH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  // Title
  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("GHS Babi Khel", totalW / 2, 28);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#555";
  ctx.fillText(`Class ${classLevel} Timetable — ${new Date().getFullYear()}`, totalW / 2, 48);

  let y = padding + 60;

  // Header row
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(padding, y, labelW, headerH);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Period", padding + labelW / 2, y + 25);

  days.forEach((d, i) => {
    const x = padding + labelW + i * cellW;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(x, y, cellW, headerH);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(d, x + cellW / 2, y + 25);
  });

  y += headerH;

  // Data rows
  periods.forEach((p, pi) => {
    const isAlt = pi % 2 === 1;
    const pName = periodNames[p] || `Period ${p}`;

    // Period label
    ctx.fillStyle = isAlt ? "#f0f0f5" : "#f8f8fc";
    ctx.fillRect(padding, y, labelW, cellH);
    ctx.fillStyle = "#1a1a2e";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pName, padding + labelW / 2, y + cellH / 2 + 4);

    days.forEach((d, di) => {
      const x = padding + labelW + di * cellW;
      ctx.fillStyle = isAlt ? "#f0f0f5" : "#f8f8fc";
      ctx.fillRect(x, y, cellW, cellH);

      const cell = grid[`${p}-${d}`];
      if (cell?.subject) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#1a1a2e";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(cell.subject, x + cellW / 2, y + 20);
        if (cell.teacher) {
          ctx.fillStyle = "#555";
          ctx.font = "10px sans-serif";
          ctx.fillText(cell.teacher, x + cellW / 2, y + 35);
        }
        if (cell.start_time && cell.end_time) {
          ctx.fillStyle = "#888";
          ctx.font = "9px sans-serif";
          ctx.fillText(`${cell.start_time}-${cell.end_time}`, x + cellW / 2, y + 48);
        }
        if (cell.room) {
          ctx.fillStyle = "#888";
          ctx.font = "9px sans-serif";
          ctx.fillText(`Room: ${cell.room}`, x + cellW / 2, y + 60);
        }
      }

      // Grid lines
      ctx.strokeStyle = "#ddd";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cellW, cellH);
    });

    // Grid line for period label
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(padding, y, labelW, cellH);

    y += cellH;
  });

  // Footer
  y += 10;
  ctx.fillStyle = "#999";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("GHS Babi Khel — Generated: " + new Date().toLocaleDateString("en-GB"), totalW / 2, y + 10);

  // Download as PNG
  const link = document.createElement("a");
  link.download = `Timetable_Class${classLevel}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSTITUTION PNG EXPORT — for WhatsApp sharing
// ─────────────────────────────────────────────────────────────────────────────
// Generates a beautiful, professional, mobile-friendly PNG image of today's
// substitute-teacher assignments. The image is designed to be shared in the
// teachers' WhatsApp group so every teacher knows which class they're
// covering today.
//
// Design:
//   • Portrait orientation (mobile-friendly — WhatsApp images are usually
//     viewed on phones).
//   • School header banner (deep blue gradient look + teal accent).
//   • "TODAY'S SUBSTITUTE ASSIGNMENTS" title with the date.
//   • One card per substitute assignment showing:
//       - Class + Period
//       - Subject
//       - Original (absent) teacher → Substitute teacher
//       - Reason badge (subject-match / free-period)
//   • Footer with generated timestamp.
//   • High-DPI rendering (2x scale) for crisp text on retina screens.
// ─────────────────────────────────────────────────────────────────────────────
function exportSubstitutionImage(
  absentTeachers: string[],
  result: SubstitutionResult,
) {
  const canvas = document.createElement("canvas");
  const W = 720; // mobile-friendly portrait width
  const headerH = 140;
  const cardH = 92;
  const cardGap = 10;
  const padding = 20;
  const footerH = 40;
  const cardsCount = result.assigned.length;
  const uncoveredH = result.uncovered.length > 0 ? 50 + result.uncovered.length * 22 : 0;
  const totalH = headerH + 20 + cardsCount * (cardH + cardGap) + uncoveredH + footerH + padding;

  const scale = Math.max(2, Math.min(3, window.devicePixelRatio || 2));
  canvas.width = W * scale;
  canvas.height = totalH * scale;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${totalH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // ── Background ──
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, totalH);

  // ── Header banner (deep blue) ──
  const headerGrad = ctx.createLinearGradient(0, 0, W, 0);
  headerGrad.addColorStop(0, "#0f4c81");
  headerGrad.addColorStop(1, "#1a6bb8");
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, W, headerH);

  // Teal accent stripe
  ctx.fillStyle = "#0d9488";
  ctx.fillRect(0, headerH - 4, W, 4);

  // School name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Government High School Babi Khel", W / 2, 32);

  ctx.font = "12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("District Mohmand, KPK", W / 2, 50);

  // Title
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("TODAY'S SUBSTITUTE ASSIGNMENTS", W / 2, 78);

  // Date + absent teachers
  const todayStr = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(`${todayStr}`, W / 2, 98);
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#fde68a";
  // Show all absent teachers (one or many).
  const absentLabel =
    absentTeachers.length === 0
      ? "—"
      : absentTeachers.length === 1
        ? `Absent: ${absentTeachers[0]}`
        : `Absent (${absentTeachers.length}): ${absentTeachers.join(", ")}`;
  ctx.fillText(absentLabel, W / 2, 118);
  // If the absent list is long, wrap to a second line so it doesn't clip.
  if (ctx.measureText(absentLabel).width > W - 40) {
    // Re-render split into two lines for readability
    ctx.fillStyle = "#0f4c81"; // banner color for clearRect trick
    ctx.fillRect(0, 110, W, 16);
    ctx.fillStyle = "#fde68a";
    ctx.font = "bold 11px sans-serif";
    const half = Math.ceil(absentTeachers.length / 2);
    const line1 = absentTeachers.slice(0, half).join(", ");
    const line2 = absentTeachers.slice(half).join(", ");
    ctx.fillText(`Absent: ${line1}`, W / 2, 116);
    ctx.fillText(line2, W / 2, 130);
  }

  // ── Cards ──
  let y = headerH + 20;

  if (cardsCount === 0) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "italic 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No substitute assignments were created.", W / 2, y + 30);
  } else {
    result.assigned.forEach((a, i) => {
      const x = padding;
      const cardW = W - padding * 2;

      // Card background (subtle grey, rounded)
      ctx.fillStyle = i % 2 === 0 ? "#f8fafc" : "#f1f5f9";
      roundRect(ctx, x, y, cardW, cardH, 8, true, false);
      // Border
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, cardW, cardH, 8, false, true);

      // Accent left bar (color by reason)
      const accentColor = a.reason === "subject-match" ? "#0d9488" : "#f59e0b";
      ctx.fillStyle = accentColor;
      ctx.fillRect(x, y, 4, cardH);

      // Class + Period (top-left, bold)
      ctx.fillStyle = "#0f4c81";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`Class ${a.class} · Period ${a.period_number}`, x + 16, y + 24);

      // Subject (top-right)
      ctx.fillStyle = "#475569";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`Subject: ${a.subject}`, x + cardW - 16, y + 24);

      // Original → Substitute (center, the main info)
      ctx.textAlign = "left";
      ctx.fillStyle = "#64748b";
      ctx.font = "11px sans-serif";
      ctx.fillText("Original:", x + 16, y + 46);
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 13px sans-serif";
      const origText = a.original_teacher || "—";
      ctx.fillText(origText, x + 70, y + 46);

      // Arrow
      ctx.fillStyle = "#0d9488";
      ctx.font = "bold 14px sans-serif";
      const arrowX = x + 70 + ctx.measureText(origText).width + 10;
      ctx.fillText("→", arrowX, y + 46);

      // Substitute
      ctx.fillStyle = "#64748b";
      ctx.font = "11px sans-serif";
      ctx.fillText("Substitute:", arrowX + 25, y + 46);
      ctx.fillStyle = "#0f4c81";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(a.substitute_teacher, arrowX + 100, y + 46);

      // Reason badge (bottom-left)
      const reasonLabel = a.reason === "subject-match" ? "✓ Subject Match" : "● Free Period";
      const reasonColor = a.reason === "subject-match" ? "#0d9488" : "#f59e0b";
      const reasonBg = a.reason === "subject-match" ? "#ccfbf1" : "#fef3c7";
      ctx.fillStyle = reasonBg;
      const reasonW = ctx.measureText(reasonLabel).width + 16;
      roundRect(ctx, x + 16, y + 60, reasonW, 20, 10, true, false);
      ctx.fillStyle = reasonColor;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(reasonLabel, x + 16 + reasonW / 2, y + 74);

      // Assignment number (bottom-right)
      ctx.textAlign = "right";
      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px sans-serif";
      ctx.fillText(`#${i + 1}`, x + cardW - 16, y + 74);

      y += cardH + cardGap;
    });
  }

  // ── Uncovered section (if any) ──
  if (result.uncovered.length > 0) {
    y += 10;
    ctx.fillStyle = "#fef2f2";
    roundRect(ctx, padding, y, W - padding * 2, 30 + result.uncovered.length * 22, 8, true, false);
    ctx.strokeStyle = "#fca5a5";
    ctx.lineWidth = 1;
    roundRect(ctx, padding, y, W - padding * 2, 30 + result.uncovered.length * 22, 8, false, true);
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`⚠ ${result.uncovered.length} period(s) could not be covered:`, padding + 12, y + 20);
    result.uncovered.forEach((u, i) => {
      ctx.fillStyle = "#7f1d1d";
      ctx.font = "11px sans-serif";
      ctx.fillText(`• Class ${u.class} P${u.period_number} (${u.subject}) — ${u.reason}`, padding + 12, y + 40 + i * 22);
    });
    y += 30 + result.uncovered.length * 22;
  }

  // ── Footer ──
  y += 15;
  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    `Generated: ${new Date().toLocaleString("en-GB")} · GHS Babi Khel Timetable System`,
    W / 2,
    y + 12,
  );

  // ── Download ──
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
    exportSubstitutionImage(selectedTeachers, result);
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
          <Button variant="outline" onClick={() => exportTimetableImage(cls, periodNames, grid)} className={`${btn} flex items-center justify-center`}>
            <Share2 className="w-3.5 h-3.5 shrink-0" /> Image
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
