/**
 * CustomFeeModal.tsx
 * Add a one-off custom fee (absence fee, library fine, late fine, etc.)
 * to a SINGLE student. The fee appears as a separate voucher in the
 * student dashboard.
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Loader2, User, DollarSign, Calendar, FileText, Search, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useStudentsByClass, useAddCustomFee } from "@/hooks/useFees";
import toast from "react-hot-toast";

const COMMON_FEE_LABELS = [
  "Absence Fee",
  "Library Fine",
  "Late Fee",
  "Damage Fee",
  "Exam Re-checking Fee",
  "Duplicate Certificate Fee",
  "Sports Fee",
  "Other (custom)",
];

const CLASS_OPTIONS = ["6", "7", "8", "9", "10"];

interface Props {
  open: boolean;
  onClose: () => void;
  defaultClass?: string;
}

export default function CustomFeeModal({ open, onClose, defaultClass = "6" }: Props) {
  const [className, setClassName] = useState(defaultClass);
  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{
    id: string; full_name: string; roll_number: string;
  } | null>(null);
  const [feeLabel, setFeeLabel] = useState("Absence Fee");
  const [customLabel, setCustomLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14); // 2 weeks from today
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");

  const { data: students = [], isLoading: studentsLoading } = useStudentsByClass(className);
  const addFee = useAddCustomFee();

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q)
    );
  }, [students, search]);

  const finalLabel = feeLabel === "Other (custom)" ? customLabel : feeLabel;
  const canSubmit = selectedStudent && finalLabel.trim() && Number(amount) > 0 && dueDate;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await addFee.mutateAsync({
        studentId: selectedStudent!.id,
        studentName: selectedStudent!.full_name,
        className,
        feeLabel: finalLabel,
        amount: Number(amount),
        dueDate,
        notes: notes.trim() || undefined,
      });
      toast.success(`Custom fee added to ${selectedStudent!.full_name}`);
      // Reset
      setSelectedStudent(null);
      setAmount("");
      setNotes("");
      setCustomLabel("");
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to add fee");
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 10 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 z-10 bg-card border-b border-border/60 p-4 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
                <DollarSign className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-foreground">Add Custom Fee</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Charge a one-off fee to a single student (absence, fine, etc.)
                </p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Class selector */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Class</Label>
              <Select value={className} onValueChange={(v) => { setClassName(v); setSelectedStudent(null); }}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLASS_OPTIONS.map(c => (
                    <SelectItem key={c} value={c}>Class {c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Student picker */}
            {!selectedStudent ? (
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Select Student</Label>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or roll number…"
                    className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none"
                  />
                </div>
                <div className="border border-border/60 rounded-xl max-h-56 overflow-y-auto bg-card">
                  {studentsLoading ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" /> Loading…
                    </div>
                  ) : filteredStudents.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No students found in Class {className}.
                    </div>
                  ) : (
                    filteredStudents.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSelectedStudent({ id: s.id, full_name: s.full_name, roll_number: s.roll_number })}
                        className="w-full text-left p-2.5 hover:bg-primary/5 flex items-center gap-2 border-b border-border/60 last:border-0 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {s.full_name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{s.full_name}</p>
                          <p className="text-[10px] text-muted-foreground">Roll: {s.roll_number}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-muted/50 p-3 flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                  {selectedStudent.full_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{selectedStudent.full_name}</p>
                  <p className="text-[10px] text-muted-foreground">Roll: {selectedStudent.roll_number} · Class {className}</p>
                </div>
                <button
                  onClick={() => setSelectedStudent(null)}
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                >
                  Change
                </button>
              </div>
            )}

            {/* Fee label */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Fee Label</Label>
              <Select value={feeLabel} onValueChange={setFeeLabel}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_FEE_LABELS.map(l => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {feeLabel === "Other (custom)" && (
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Enter custom fee label…"
                  className="mt-2 h-9 text-sm"
                />
              )}
            </div>

            {/* Amount + due date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Amount (Rs.)</Label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 50"
                  className="h-10"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Due Date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-10"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. 3 absences in June"
                className="h-9 text-sm"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={onClose} className="h-9 min-w-0 flex-1 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 gap-1.5">Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || addFee.isPending}
                className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {addFee.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DollarSign className="w-3.5 h-3.5" />}
                Add Fee
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
