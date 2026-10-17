/**
 * ApplicationTracker.tsx
 * Vertical timeline of an applicant's status changes.
 * Shows: every status transition with timestamp, actor, and note.
 * Highlights the current step.
 */
import { motion } from "framer-motion";
import {
  CheckCircle2, Circle, Clock, AlertCircle, FileText, Calendar,
  ShieldCheck, User, Award,
} from "lucide-react";

interface TimelineEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor: string;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; icon: any; color: string }> = {
  pending:              { label: "Application Submitted",     icon: FileText,     color: "#3b82f6" },
  under_review:         { label: "Under Review",              icon: Clock,        color: "#8b5cf6" },
  documents_verified:   { label: "Documents Verified",        icon: ShieldCheck,  color: "#10b981" },
  documents_missing:    { label: "Documents Missing",         icon: AlertCircle,  color: "#f59e0b" },
  interview_scheduled:  { label: "Interview Scheduled",       icon: Calendar,     color: "#06b6d4" },
  interview_completed:  { label: "Interview Completed",       icon: CheckCircle2, color: "#10b981" },
  waitlisted:           { label: "Waitlisted",                icon: Clock,        color: "#f59e0b" },
  approved:             { label: "Approved",                  icon: CheckCircle2, color: "#10b981" },
  admitted:             { label: "Admitted",                  icon: Award,        color: "#10b981" },
  admit_card_issued:    { label: "Admit Card Issued",         icon: Award,        color: "#10b981" },
  rejected:             { label: "Not Approved",              icon: AlertCircle,  color: "#ef4444" },
};

const ACTOR_LABELS: Record<string, string> = {
  admin: "School Office",
  system: "System",
  applicant: "You",
};

export default function ApplicationTracker({
  timeline,
  currentStatus,
}: {
  timeline: TimelineEntry[];
  currentStatus: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-card p-5">
      <h3 className="font-bold text-foreground text-sm mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        Application Timeline
      </h3>

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Your application has been received. Status updates will appear here.
        </p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-border" />

          <div className="space-y-4">
            {timeline.map((entry, i) => {
              const meta = STATUS_META[entry.to_status] || { label: entry.to_status, icon: Circle, color: "#64748b" };
              const Icon = meta.icon;
              const isLatest = i === 0;
              const isCurrent = entry.to_status === currentStatus;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="relative pl-10"
                >
                  {/* Dot */}
                  <div
                    className="absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm"
                    style={{
                      backgroundColor: isCurrent ? meta.color : meta.color + "20",
                      border: `2px solid ${meta.color}`,
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: isCurrent ? "white" : meta.color }} />
                  </div>

                  {/* Content */}
                  <div className={`pb-1 ${isLatest ? "" : "opacity-80"}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{meta.label}</span>
                      {isCurrent && (
                        <span
                          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          Current
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(entry.created_at).toLocaleString("en-PK", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {entry.note && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{entry.note}</p>
                    )}
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                      <User className="w-2.5 h-2.5" />
                      by {ACTOR_LABELS[entry.actor] || entry.actor}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
