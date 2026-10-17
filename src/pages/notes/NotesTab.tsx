import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, CheckCircle, Bookmark, ChevronRight, Trophy } from "lucide-react";
import { useNoteSubjects, useNoteChapters, useNoteProgress } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectTint, getSubjectTintDeep } from "@/lib/subjectTheme";

function SubjectProgress({ subject, userId }: { subject: any; userId: string }) {
  const { data: chapters = [] } = useNoteChapters(subject.id);
  const { data: progress = [] } = useNoteProgress(userId);

  const completedCount = chapters.filter(ch => progress.find(p => p.chapter_id === ch.id && p.completed)).length;
  const pct = chapters.length > 0 ? Math.round((completedCount / chapters.length) * 100) : 0;
  const bookmarked = chapters.filter(ch => progress.find(p => p.chapter_id === ch.id && p.bookmarked));

  return (
    <Link to={`/notes/${subject.slug}`}>
      <motion.div whileHover={{ y: -3 }} className="bg-card border border-border rounded-2xl p-4 hover:shadow-md transition-all overflow-hidden group relative">
        {/* Signature color strip */}
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${getSubjectTintDeep(subject.color, 0.9)}, ${getSubjectTint(subject.color, 0.35)})` }} />
        <div className="h-1.5 rounded-full mb-4 transition-all mt-1" style={{ backgroundColor: getSubjectTint(subject.color, 0.16) }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${getSubjectTintDeep(subject.color, 0.85)}, ${getSubjectTintDeep(subject.color, 1)})` }} />
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 transition-transform duration-300 group-hover:scale-110"
            style={{ backgroundColor: getSubjectTint(subject.color, 0.14), boxShadow: `inset 0 0 0 1px ${getSubjectTint(subject.color, 0.28)}` }}>
            {subject.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-foreground truncate">{subject.name}</p>
            <p className="text-xs text-muted-foreground">{completedCount}/{chapters.length} chapters</p>
          </div>
          <div className="text-sm font-black" style={{ color: getSubjectTintDeep(subject.color, 1) }}>{pct}%</div>
        </div>
        {bookmarked.length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Bookmark className="w-3 h-3" /> {bookmarked.length} bookmarked
          </p>
        )}
      </motion.div>
    </Link>
  );
}

const NotesTab = () => {
  const { user } = useAuth();
  const { data: subjects = [], isLoading } = useNoteSubjects();
  const { data: progress = [] } = useNoteProgress(user?.id);

  const bookmarkedChapterIds = progress.filter(p => p.bookmarked).map(p => p.chapter_id);
  const completedTotal = progress.filter(p => p.completed).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" /> Study Notes
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Your learning progress across all subjects</p>
        </div>
        <Link to="/notes"
          className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          Browse All <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: CheckCircle, label: "Completed", value: completedTotal, color: "text-green-600" },
          { icon: Bookmark,    label: "Bookmarked", value: bookmarkedChapterIds.length, color: "text-blue-700" },
          { icon: Trophy,      label: "Subjects",  value: subjects.length, color: "text-violet-600" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-2xl p-4 text-center">
            <s.icon className={`w-5 h-5 mx-auto mb-1 ${s.color}`} />
            <p className="text-2xl font-black text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Subject progress grid */}
      <div>
        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-3">Your Progress</p>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {subjects.map(s => user && <SubjectProgress key={s.id} subject={s} userId={user.id} />)}
          </div>
        )}
      </div>

    </div>
  );
};

export default NotesTab;
