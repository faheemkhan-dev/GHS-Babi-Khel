/**
 * Duty.tsx — GHS Babi Khel
 *
 * Public-facing School Duty Board.
 * Data is read from Supabase `duty_board` table (set by admin).
 * Works on ALL devices — no localStorage dependency.
 */

import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { supabasePublic } from "@/lib/supabase";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import {
  Shield, ShieldCheck, Users, Star, BookOpen,
  Crown, Award, BadgeCheck, GraduationCap,
  RefreshCw, Info, ChevronDown, ChevronUp
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ClassId = "6" | "7" | "8" | "9" | "10";

interface ClassDuty {
  monitor: string;
  proctor: string;
  social_worker: string;
  head_boy: string;
  nazira: string;
}

interface DutyData {
  classes: Record<ClassId, ClassDuty>;
  chief_proctor: string;
  updated_at: string;
}

const CLASSES: ClassId[] = ["6", "7", "8", "9", "10"];

const emptyClass = (): ClassDuty => ({
  monitor: "", proctor: "", social_worker: "", head_boy: "", nazira: "",
});

// ── Role config ────────────────────────────────────────────────────────────────
interface RoleCfg {
  key: keyof ClassDuty;
  label: string;
  icon: React.ReactNode;
  gradient: string;
  glow: string;
  accent: string;
  ribbon: string;
  emoji: string;
}

const ROLES: RoleCfg[] = [
  {
    key: "monitor",
    label: "Class Monitor",
    icon: <Shield className="w-5 h-5" />,
    gradient: "from-blue-600 via-blue-500 to-blue-700",
    glow: "shadow-blue-400/40",
    accent: "bg-blue-600",
    ribbon: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    emoji: "🛡️",
  },
  {
    key: "proctor",
    label: "Proctor",
    icon: <ShieldCheck className="w-5 h-5" />,
    gradient: "from-sky-500 via-sky-400 to-sky-700",
    glow: "shadow-sky-400/40",
    accent: "bg-sky-600",
    ribbon: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    emoji: "✅",
  },
  {
    key: "social_worker",
    label: "Social Worker",
    icon: <Users className="w-5 h-5" />,
    gradient: "from-indigo-500 via-indigo-400 to-indigo-700",
    glow: "shadow-indigo-400/40",
    accent: "bg-indigo-600",
    ribbon: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
    emoji: "🤝",
  },
  {
    key: "head_boy",
    label: "Head Boy",
    icon: <Star className="w-5 h-5" />,
    gradient: "from-cyan-500 via-blue-400 to-cyan-700",
    glow: "shadow-cyan-400/40",
    accent: "bg-cyan-600",
    ribbon: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
    emoji: "⭐",
  },
  {
    key: "nazira",
    label: "Nazira",
    icon: <BookOpen className="w-5 h-5" />,
    gradient: "from-slate-500 via-blue-500 to-slate-700",
    glow: "shadow-blue-300/30",
    accent: "bg-slate-600",
    ribbon: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    emoji: "📖",
  },
];

// ── Supabase fetch ─────────────────────────────────────────────────────────────
async function fetchDuty(): Promise<DutyData> {
  const { data, error } = await supabasePublic
    .from("duty_board")
    .select("classes, chief_proctor, updated_at")
    .eq("id", 1)
    .single();

  if (error) throw error;

  // Ensure all classes exist with fallback empty structure
  const classes = {} as Record<ClassId, ClassDuty>;
  for (const cls of CLASSES) {
    classes[cls] = { ...emptyClass(), ...(data.classes?.[cls] ?? {}) };
  }

  return {
    classes,
    chief_proctor: data.chief_proctor ?? "",
    updated_at: data.updated_at ?? "",
  };
}

// ── Badge card ─────────────────────────────────────────────────────────────────
function BadgeCard({ role, name, index }: { role: RoleCfg; name: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: "easeOut" }}
      className={`relative rounded-2xl bg-white dark:bg-slate-900 border border-blue-100 dark:border-slate-700 shadow-lg ${role.glow} overflow-hidden group`}
    >
      <div className={`h-1.5 w-full bg-gradient-to-r ${role.gradient}`} />
      <div className="p-4 flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${role.gradient} flex items-center justify-center text-white shadow-lg shrink-0 group-hover:scale-105 transition-transform`}>
          {role.icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-foreground truncate leading-tight">{name}</p>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 mt-1 ${role.ribbon}`}>
            {role.emoji} {role.label}
          </span>
        </div>
        <BadgeCheck className="w-5 h-5 text-blue-400 dark:text-blue-500 shrink-0 mt-0.5" />
      </div>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />
    </motion.div>
  );
}

// ── Empty badge ────────────────────────────────────────────────────────────────
function EmptyBadge({ role }: { role: RoleCfg }) {
  return (
    <div className="rounded-2xl border border-dashed border-blue-200 dark:border-slate-700 bg-blue-50/30 dark:bg-slate-900/30 p-4 flex items-center gap-3 opacity-50">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {role.icon}
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground italic">Not assigned</p>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 mt-1 ${role.ribbon}`}>
          {role.emoji} {role.label}
        </span>
      </div>
    </div>
  );
}

// ── Class section ──────────────────────────────────────────────────────────────
function ClassSection({ cls, duty, index }: { cls: ClassId; duty: ClassDuty; index: number }) {
  const [open, setOpen] = useState(true);
  const assigned = ROLES.filter((r) => duty[r.key]?.trim()).length;
  const hasAny = assigned > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-white dark:bg-slate-900/80 shadow-md overflow-hidden"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-blue-600 to-sky-500 text-white"
      >
        <GraduationCap className="w-5 h-5 shrink-0" />
        <span className="font-bold text-lg flex-1 text-left">Class {cls}</span>
        {hasAny ? (
          <span className="text-xs font-semibold bg-white/25 rounded-full px-3 py-1">
            {assigned} of {ROLES.length} assigned
          </span>
        ) : (
          <span className="text-xs font-semibold bg-white/15 rounded-full px-3 py-1 italic opacity-70">
            No assignments yet
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ROLES.map((role, i) => {
                const name = duty[role.key]?.trim();
                return name
                  ? <BadgeCard key={role.key} role={role} name={name} index={i} />
                  : <EmptyBadge key={role.key} role={role} />;
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const DutyPage = () => {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["duty-board"],
    queryFn: fetchDuty,
    staleTime: 2 * 60 * 1000,
  });

  const hasAnyData = data && (
    data.chief_proctor?.trim() ||
    CLASSES.some((cls) => ROLES.some((r) => data.classes?.[cls]?.[r.key]?.trim()))
  );

  const updatedStr = data?.updated_at
    ? new Date(data.updated_at).toLocaleDateString("en-PK", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <PageLayout>
      <PageBanner
        title="School Duty Board"
        subtitle="Official duty assignments for GHS Babi Khel — Classes 6 to 10"
      />

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Controls */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="w-4 h-4 text-blue-500 shrink-0" />
            <span>
              Duty assignments are managed by the school administration.
              {updatedStr && (
                <span className="ml-1">
                  Last updated: <strong className="text-foreground">{updatedStr}</strong>
                </span>
              )}
            </span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium">Loading duty assignments…</p>
            </div>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-24 space-y-3">
            <p className="text-lg font-bold text-destructive">Failed to load duty board</p>
            <p className="text-muted-foreground text-sm">Please check your connection and try again.</p>
            <button
              onClick={() => refetch()}
              className="mt-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && !hasAnyData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24 space-y-4"
          >
            <div className="w-20 h-20 mx-auto rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
              <Shield className="w-10 h-10 text-blue-400" />
            </div>
            <p className="text-lg font-bold text-foreground">No Duty Assignments Yet</p>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              The school administration hasn't published duty assignments yet.
              Please check back later or contact your class teacher.
            </p>
          </motion.div>
        )}

        {/* Content */}
        {!isLoading && !isError && hasAnyData && data && (
          <>
            {/* Chief Proctor card */}
            {data.chief_proctor?.trim() && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="relative rounded-3xl overflow-hidden shadow-2xl"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-400 via-orange-400 to-yellow-600 opacity-90" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent)]" />
                <div className="relative px-6 py-8 flex flex-col sm:flex-row items-center gap-6">
                  <div className="w-20 h-20 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center shadow-xl shrink-0">
                    <Crown className="w-10 h-10 text-white" />
                  </div>
                  <div className="text-center sm:text-left">
                    <p className="text-white/80 text-sm font-semibold uppercase tracking-widest mb-1">
                      Chief Proctor — GHS Babi Khel
                    </p>
                    <p className="text-white font-extrabold text-3xl sm:text-4xl leading-tight drop-shadow">
                      {data.chief_proctor}
                    </p>
                    <p className="text-white/70 text-sm mt-1">Whole School Supervisor</p>
                  </div>
                  <div className="sm:ml-auto flex flex-col items-center gap-1">
                    <Award className="w-12 h-12 text-white/70" />
                    <span className="text-white/60 text-[10px] font-semibold uppercase tracking-wider">Verified</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Role legend */}
            <div className="rounded-2xl border border-blue-100 dark:border-slate-800 bg-blue-50/50 dark:bg-slate-900/40 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-sky-700 dark:text-sky-400 mb-3">
                Duty Roles
              </p>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <span key={r.key} className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 ${r.ribbon}`}>
                    <span>{r.emoji}</span> {r.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Per-class sections */}
            <div className="space-y-5">
              {CLASSES.map((cls, i) => (
                <ClassSection
                  key={cls}
                  cls={cls}
                  duty={data.classes?.[cls] ?? emptyClass()}
                  index={i}
                />
              ))}
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-muted-foreground pt-4 pb-8">
              GHS Babi Khel · District Mohmand · KPK — Duty Board
              {updatedStr ? ` · Updated ${updatedStr}` : ""}
            </p>
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default DutyPage;
      
