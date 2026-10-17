import { Link, useParams, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, CheckCircle, Zap, Download, PlayCircle, WifiOff, RefreshCw, FileText } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useNoteSubjects, useNoteChapters, useNoteProgress } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectGradient, getSubjectTint, getSubjectTintDeep } from "@/lib/subjectTheme";

const DIFFICULTY_COLOR = {
  easy: "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40",
  medium: "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40",
  hard: "text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900/40",
};
const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

const SubjectPage = () => {
  const { subject: slug } = useParams<{ subject: string }>();
  const { user } = useAuth();
  const { data: subjects = [], isLoading: loadingSubjects, isError: subjectsError, refetch: refetchSubjects } = useNoteSubjects();
  const subject = subjects.find(s => s.slug === slug);
  const { data: chapters = [], isLoading: loadingChapters, isError: chaptersError, refetch: refetchChapters } = useNoteChapters(subject?.id);
  const { data: progress = [] } = useNoteProgress(user?.id);

  if (loadingSubjects) return <PageLayout><div className="p-8"><Skeleton className="h-48 rounded-3xl mb-6" />{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl mb-3" />)}</div></PageLayout>;

  // Offline error state for subjects
  if (subjectsError && !subjects.length) return (
    <PageLayout>
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mx-auto mb-4">
          <WifiOff className="w-8 h-8 text-orange-500" />
        </div>
        <p className="font-semibold text-foreground text-lg">Can't load subject</p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">You appear to be offline. Please check your connection.</p>
        <button onClick={() => refetchSubjects()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity">
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
        <Link to="/notes" className="block text-primary text-sm mt-4">← Back to Notes</Link>
      </div>
    </PageLayout>
  );

  if (!subject && !loadingSubjects) return <Navigate to="/notes" replace />;
  if (!subject) return null;

  const completedIds = new Set(progress.filter(p => p.completed).map(p => p.chapter_id));
  const completedCount = chapters.filter(c => completedIds.has(c.id)).length;
  const progressPct = chapters.length > 0 ? Math.round((completedCount / chapters.length) * 100) : 0;

  return (
    <PageLayout>
      {/* ─── Header — refined gradient, always readable ─── */}
      <section className="relative overflow-hidden py-5 sm:py-9 px-4" style={{ background: getSubjectGradient(subject.color) }}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
        {/* Ambient glows + texture */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 88% 10%, rgba(255,255,255,0.14), transparent 50%)" }} />
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

        <div className="relative max-w-4xl mx-auto">
          <Link to="/notes" className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/15 border border-white/25 text-[11px] font-bold text-white whitespace-nowrap hover:bg-white/25 transition-colors mb-4">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to All Subjects
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-3xl sm:text-4xl shrink-0 bg-white/15"
              style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)" }}>
              {subject.emoji}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-heading font-bold leading-tight text-white">{subject.name}</h1>
              <p className="text-xs sm:text-sm mt-1 line-clamp-1 text-white/75">{subject.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold bg-white/15 text-white" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}>Class {subject.class_level}</span>
                <span className="text-[10px] px-2.5 py-1 rounded-full font-semibold bg-white/15 text-white" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}>{chapters.length} Chapters</span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {user && chapters.length > 0 && (
            <div className="mt-5">
              <div className="flex justify-between text-[11px] mb-1.5 text-white/80">
                <span>{completedCount} of {chapters.length} chapters completed</span>
                <span className="font-bold text-white">{progressPct}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-white/20">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-white" />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Chapters ─── */}
      <section className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center gap-2 mb-3"><span className="w-1.5 h-1.5 rotate-45 bg-gold" /><p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.22em]">Chapters</p><span className="h-px flex-1 bg-gradient-to-r from-gold/40 to-transparent" /></div>
        {loadingChapters ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : chaptersError && !chapters.length ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mx-auto mb-4">
              <WifiOff className="w-8 h-8 text-orange-500" />
            </div>
            <p className="font-semibold text-foreground text-lg">Can't load chapters</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">You appear to be offline. Chapters you've visited before will load from cache.</p>
            <button onClick={() => refetchChapters()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity">
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
          </div>
        ) : chapters.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground text-lg">No chapters yet</p>
            <p className="text-sm text-muted-foreground mt-1">Chapters will appear here when published by admin</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {chapters.map((ch, i) => {
              const done = completedIds.has(ch.id);
              return (
                <motion.div key={ch.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.035 }}>
                  <Link to={`/notes/${slug}/${ch.slug}`} className="block">
                    <div className={`group relative overflow-hidden bg-card border rounded-2xl shadow-card hover:shadow-elevated hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 ${done ? "border-emerald-300/60 dark:border-emerald-800/50" : "border-border hover:border-[color:var(--sc-soft)]"}`}
                      style={{ "--sc-soft": getSubjectTintDeep(subject.color, 0.45) } as React.CSSProperties}>
                      <div className="absolute inset-y-0 left-0 w-1" style={{ background: done ? "linear-gradient(180deg,#10b981,#047857)" : getSubjectGradient(subject.color) }} />
                      <div className="pl-4 pr-3 py-3 flex items-center gap-3">
                        <div className={`min-w-10 max-w-24 h-10 px-2 rounded-xl flex items-center justify-center shrink-0 font-heading font-black text-sm leading-tight text-center ${done ? "bg-emerald-500 text-white shadow-sm" : "text-foreground"}`}
                          style={done ? undefined : { backgroundColor: getSubjectTint(subject.color, 0.14), boxShadow: `inset 0 0 0 1px ${getSubjectTintDeep(subject.color, 0.28)}` }}>
                          {done ? <CheckCircle className="w-5 h-5" /> : ch.chapter_number}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-heading font-bold text-foreground text-sm leading-snug">{ch.title}</h3>
                          {ch.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{ch.description}</p>}
                          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1.5 text-[10px] text-muted-foreground">
                            <span className={`font-bold px-1.5 py-0.5 rounded-full ${DIFFICULTY_COLOR[ch.difficulty]}`}>{DIFFICULTY_LABEL[ch.difficulty]}</span>
                            <span className="flex items-center gap-1 whitespace-nowrap"><Clock className="w-3 h-3" /> {ch.read_time_mins} min</span>
                            {ch.animation_code && <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400 font-semibold whitespace-nowrap"><Zap className="w-3 h-3" /> Interactive</span>}
                            {ch.pdf_url && <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold whitespace-nowrap"><Download className="w-3 h-3" /> PDF</span>}
                          </div>
                        </div>

                        <span className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-white text-xs font-bold shrink-0 whitespace-nowrap shadow-sm"
                          style={{ background: done ? "linear-gradient(135deg, #10b981, #047857)" : getSubjectGradient(subject.color) }}>
                          <PlayCircle className="w-3.5 h-3.5" />
                          {done ? "Review" : "Read"}
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </PageLayout>
  );
};

export default SubjectPage;
