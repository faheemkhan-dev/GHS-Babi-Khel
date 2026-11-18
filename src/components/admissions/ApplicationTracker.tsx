/**
 * ApplicationTracker.tsx — vertical timeline of an applicant's status changes,
 * restyled to the GHSS Ghallanai "Application Timeline" card:
 *   • gold-framed card with the green→emerald→gold gradient strip on top
 *   • header "Application Timeline · {n} update(s)"
 *   • gold vertical rail, latest entry = solid primary dot with glow ring
 *   • collapsed to the 3 latest entries with a "Show all N updates" toggle
 * Status colours, actor labels and the motion behaviour are unchanged.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2, Circle, Clock, AlertCircle, FileText, Calendar,
  ShieldCheck, Award, History, ChevronDown,
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
  merit_listed:         { label: "Merit Listed",              icon: Award,        color: "#a88228" },
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

const COLLAPSED_COUNT = 3;

export default function ApplicationTracker({
  timeline,
  currentStatus,
}: {
  timeline: TimelineEntry[];
  currentStatus: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? timeline : timeline.slice(0, COLLAPSED_COUNT);

  return (
    <div className="overflow-hidden rounded-2xl border border-gold/30 bg-card shadow-card">
      {/* gradient strip + header (GHSS timeline card) */}
      <div aria-hidden className="h-1 bg-gradient-to-r from-primary via-emerald-500 to-amber-400" />
      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <History className="h-4 w-4 text-primary" />
            Application Timeline
          </h3>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            {timeline.length} update{timeline.length === 1 ? "" : "(s)"}
          </span>
        </div>

        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Your application has been received. Status updates will appear here.
          </p>
        ) : (
          <div className="relative">
            {/* gold vertical rail */}
            <div aria-hidden className="absolute bottom-2 left-3.5 top-2 w-0.5 bg-gold/30" />

            <div className="space-y-4">
              {visible.map((entry, i) => {
                const meta = STATUS_META[entry.to_status] || { label: entry.to_status, icon: Circle, color: "#64748b" };
                const Icon = meta.icon;
                const isLatest = i === 0;
                const isCurrent = entry.to_status === currentStatus;

                return (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i, 4) * 0.05 }}
                    className="relative pl-10"
                  >
                    {/* dot — latest gets the solid primary glow (GHSS) */}
                    <div
                      className={`absolute left-0 top-0 flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm ${
                        isLatest ? "ring-4 ring-primary/15" : ""
                      }`}
                      style={
                        isLatest
                          ? { backgroundColor: meta.color, border: "2px solid " + meta.color }
                          : {
                              backgroundColor: meta.color + "20",
                              border: `2px solid ${meta.color}`,
                            }
                      }
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: isLatest ? "white" : meta.color }} />
                    </div>

                    {/* content */}
                    <div className={`pb-1 ${isLatest ? "" : "opacity-80"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                        {isCurrent && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
                            style={{ backgroundColor: meta.color }}
                          >
                            Current
                          </span>
                        )}
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {new Date(entry.created_at).toLocaleString("en-PK", {
                            day: "numeric", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit", hour12: true,
                          })}
                        </span>
                      </div>
                      {entry.note && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.note}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/80">by {ACTOR_LABELS[entry.actor] || entry.actor}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {timeline.length > COLLAPSED_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-4 inline-flex h-8 items-center gap-1 rounded-full border border-border/70 px-3 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
            {showAll ? "Show less" : `Show all ${timeline.length} updates`}
          </button>
        )}
      </div>
    </div>
  );
}
