/**
 * InterviewSlotBooking.tsx
 * Calendar-style interview slot picker with live capacity tracking.
 * Uses book_interview_slot RPC (atomic) to prevent over-booking.
 * Shows slots grouped by date, with progress bars for capacity.
 *
 * If a slot is full, applicant is auto-waitlisted (handled in RPC).
 */
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Clock, MapPin, Users, Loader2, CheckCircle2,
  AlertCircle, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import { supabasePublic as supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

interface Slot {
  id: string;
  slot_date: string;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  current_bookings: number;
  location: string | null;
  notes: string | null;
}

interface Props {
  admissionId: string;
  currentBooking: string | null;
  onBooked: () => void;
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PK", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export default function InterviewSlotBooking({ admissionId, currentBooking, onBooked }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [confirmSlot, setConfirmSlot] = useState<Slot | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  const loadSlots = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("interview_slots")
        .select("*")
        .gte("slot_date", today)
        .eq("is_active", true)
        .order("slot_date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      setSlots(data || []);
    } catch (e) {
      console.error("Failed to load slots:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentBooking) { setLoading(false); return; }
    loadSlots();
  }, [currentBooking]);

  // Group slots by date
  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      if (!map.has(s.slot_date)) map.set(s.slot_date, []);
      map.get(s.slot_date)!.push(s);
    }
    return Array.from(map.entries());
  }, [slots]);

  const bookSlot = async (slot: Slot) => {
    setBookingId(slot.id);
    try {
      const { data, error } = await supabase.rpc("book_interview_slot", {
        p_admission_id: admissionId,
        p_slot_id: slot.id,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Booking failed");

      if (data.waitlisted) {
        toast.success("Added to waitlist", { duration: 5000 });
      } else {
        toast.success(`Interview booked for ${formatDate(data.slot_date)} at ${formatTime(data.slot_time)}`);
      }
      setConfirmSlot(null);
      await loadSlots();
      onBooked();
    } catch (e) {
      toast.error(e.message || "Booking failed");
    } finally {
      setBookingId(null);
    }
  };

  const cancelBooking = async () => {
    setShowCancel(false);
    try {
      const { data, error } = await supabase.rpc("cancel_interview_booking", {
        p_admission_id: admissionId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Cancel failed");

      toast.success("Booking cancelled");
      if (data.promoted_applicant_name) {
        toast(`Waitlisted applicant promoted: ${data.promoted_applicant_name}`, { icon: "✨" });
      }
      await loadSlots();
      onBooked();
    } catch (e) {
      toast.error(e.message || "Cancel failed");
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground text-sm">
          {currentBooking ? "Your Interview" : "Book Interview Slot"}
        </h3>
      </div>

      {/* Current booking notice */}
      {currentBooking && (
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-xl p-3 mb-4 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-green-700 dark:text-green-400">Interview scheduled</p>
            <p className="text-xs text-foreground/80 mt-0.5">{currentBooking}</p>
          </div>
          <button
            onClick={() => setShowCancel(true)}
            className="text-[11px] text-red-600 hover:underline shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted-foreground mt-2">Loading available slots…</p>
        </div>
      ) : currentBooking ? (
        // Already has an interview scheduled (whether booked through this
        // slot picker or set manually by admin via a status note) — don't
        // show the open-slots list below, it's irrelevant once scheduled.
        null
      ) : slots.length === 0 ? (
        <div className="text-center py-8">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm font-semibold text-foreground">No slots available</p>
          <p className="text-xs text-muted-foreground mt-1">
            The school hasn't opened interview slots yet. Check back later.
          </p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
          {grouped.map(([date, daySlots]) => (
            <div key={date}>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2 sticky top-0 bg-card py-1">
                {formatDate(date)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {daySlots.map(slot => {
                  const isFull = slot.current_bookings >= slot.capacity;
                  const fillPct = (slot.current_bookings / slot.capacity) * 100;
                  const isBooking = bookingId === slot.id;

                  return (
                    <button
                      key={slot.id}
                      onClick={() => !isFull && !currentBooking && setConfirmSlot(slot)}
                      disabled={isFull || !!currentBooking || isBooking}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        currentBooking
                          ? "opacity-50 cursor-not-allowed border-border"
                          : isFull
                          ? "opacity-60 cursor-not-allowed border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                          : "border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-sm text-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(slot.start_time)}
                        </span>
                        {isFull && (
                          <span className="text-[10px] font-bold text-red-600">FULL</span>
                        )}
                      </div>
                      {slot.location && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
                          <MapPin className="w-2.5 h-2.5" />
                          {slot.location}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-2">
                        <Users className="w-3 h-3 text-muted-foreground" />
                        <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isFull ? "bg-red-500" : fillPct > 70 ? "bg-amber-500" : "bg-green-500"}`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                          {slot.current_bookings}/{slot.capacity}
                        </span>
                      </div>
                      {isBooking && (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-primary">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" /> Booking…
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation modal */}
      <AnimatePresence>
        {confirmSlot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setConfirmSlot(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-2xl shadow-2xl max-w-sm w-full p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-foreground text-sm">Confirm Interview</h4>
                <button onClick={() => setConfirmSlot(null)} className="p-1 rounded-lg hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 mb-4 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold">{formatDate(confirmSlot.slot_date)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span>{formatTime(confirmSlot.start_time)} ({confirmSlot.duration_minutes} min)</span>
                </div>
                {confirmSlot.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{confirmSlot.location}</span>
                  </div>
                )}
                {confirmSlot.notes && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2 text-xs text-amber-700 dark:text-amber-300 mt-2">
                    📋 {confirmSlot.notes}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setConfirmSlot(null)} className="flex-1">
                  Back
                </Button>
                <Button
                  onClick={() => bookSlot(confirmSlot)}
                  disabled={!!bookingId}
                  className="flex-1 gap-1.5"
                >
                  {bookingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Confirm
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cancel confirmation */}
      <AnimatePresence>
        {showCancel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowCancel(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-2xl shadow-2xl max-w-sm w-full p-5"
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h4 className="font-bold text-foreground text-sm">Cancel interview?</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your slot will be released to the next waitlisted applicant. You can rebook if another slot is available.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowCancel(false)} className="flex-1">
                  Keep Booking
                </Button>
                <Button variant="destructive" onClick={cancelBooking} className="flex-1">
                  Yes, Cancel
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
