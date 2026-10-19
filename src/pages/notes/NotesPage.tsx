import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, ChevronRight, Sparkles, GraduationCap, Star, WifiOff, RefreshCw, SearchX } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useNoteSubjects } from "@/hooks/useNotes";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectGradient, getSubjectSolid, getSubjectTint, getSubjectTintDeep } from "@/lib/subjectTheme";

const CLASS_FILTERS = ["All Classes", "6-7", "8", "9-10"];

const NotesPage = () => {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All Classes");
  const { data: subjects = [], isLoading, isError, refetch } = useNoteSubjects();

  const filtered = subjects.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchClass = classFilter === "All Classes" || s.class_level?.includes(classFilter.split("-")[0]);
    return matchSearch && matchClass;
  });

  return (
    <PageLayout>
      {/* ═══ Premium hero ═══ */}
      <section className="gradient-hero relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="orb orb-gold w-[360px] h-[360px] -top-40 -right-24 opacity-80" />
          <div className="orb orb-light w-[280px] h-[280px] -bottom-32 -left-16" />
          <div className="absolute inset-0 dot-grid opacity-[0.10]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        <div className="relative max-w-4xl mx-auto px-4 pt-8 pb-10 md:pt-12 md:pb-14 text-center">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="inline-flex items-center gap-1.5 bg-white/10 border border-gold/40 text-gold px-3 h-7 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] mb-3 backdrop-blur-sm whitespace-nowrap">
              <Sparkles className="w-3 h-3" /> Interactive Study Notes
            </div>
            <h1 className="text-[1.9rem] md:text-5xl leading-[1.1] font-heading font-bold text-on-hero tracking-tight">
              Study Smarter,{" "}
              <span className="bg-gradient-to-r from-gold to-[hsl(45_75%_74%)] bg-clip-text text-transparent">Not Harder</span>
            </h1>
            <div className="mt-3 flex items-center justify-center gap-2">
              <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold" />
              <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
              <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold" />
            </div>
            <p className="mt-3 text-sm md:text-base text-on-hero-soft max-w-md mx-auto leading-relaxed">
              Beautiful notes, animations, quizzes and graphs — free for GHS Babi Khel students.
            </p>

            <div className="relative max-w-md mx-auto mt-5">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search subjects…"
                type="text"
                enterKeyHint="search"
                className="w-full h-11 px-5 rounded-full bg-white text-gray-900 placeholder:text-gray-400 text-sm font-medium outline-none border border-gold/40 focus:ring-4 focus:ring-gold/25 shadow-[0_14px_30px_-14px_rgba(0,0,0,0.55)] transition-shadow"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Stats — one compact row ─── */}
      <section className="max-w-6xl mx-auto px-4 pt-4">
        <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
          {[
            { label: "Subjects", value: subjects.length, icon: BookOpen },
            { label: "Interactive", value: "100%", icon: Sparkles },
            { label: "Free", value: "✓", icon: Star },
            { label: "Classes", value: "6–10", icon: GraduationCap },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-border bg-card shadow-card py-2 px-1 flex flex-col items-center gap-0.5">
              <Icon className="w-3.5 h-3.5 text-gold" />
              <span className="font-heading font-bold text-sm text-foreground leading-none">{value}</span>
              <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Filters + Subject list ─── */}
      <section className="max-w-6xl mx-auto px-4 pt-4">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 mb-4">
          {CLASS_FILTERS.map(f => (
            <button key={f} onClick={() => setClassFilter(f)}
              className={`shrink-0 whitespace-nowrap h-8 px-4 rounded-full text-xs font-semibold border transition-all ${
                classFilter === f
                  ? "bg-gold text-[hsl(var(--gold-ink))] border-gold shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:border-gold/50"
              }`}>{f === "All Classes" ? f : `Class ${f}`}</button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mx-auto mb-3">
              <WifiOff className="w-7 h-7 text-orange-500" />
            </div>
            <p className="font-heading font-bold text-foreground">Can't load subjects</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">You appear to be offline. Visited subjects load from cache.</p>
            <button onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg gradient-hero text-white text-xs font-bold border border-gold/40 whitespace-nowrap">
              <RefreshCw className="w-3.5 h-3.5" /> Try Again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <SearchX className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-heading font-bold text-foreground">No subjects found</p>
            <p className="text-xs text-muted-foreground mt-1">Try a different search or filter</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 pb-12">
            {filtered.map((subject, i) => {
              const solid = getSubjectSolid(subject.color);
              return (
                <motion.div key={subject.id}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.04 }}
                  className="group"
                  style={{ "--sc": solid, "--sc-soft": getSubjectTintDeep(subject.color, 0.45) } as React.CSSProperties}>
                  <Link to={`/notes/${subject.slug}`} className="block">
                    <div className="relative overflow-hidden rounded-2xl bg-card border border-border shadow-card transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_18px_36px_-18px_var(--sc)] group-hover:border-[color:var(--sc-soft)] active:scale-[0.99]">
                      <div className="absolute inset-y-0 left-0 w-1" style={{ background: getSubjectGradient(subject.color) }} />
                      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none"
                        style={{ background: `radial-gradient(circle, ${getSubjectTint(subject.color, 0.2)}, transparent 68%)` }} />
                      <div className="relative flex items-center gap-3 p-3.5 pl-5">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 transition-transform duration-300 group-hover:scale-110"
                          style={{ backgroundColor: getSubjectTint(subject.color, 0.14), boxShadow: `inset 0 0 0 1px ${getSubjectTintDeep(subject.color, 0.28)}` }}>
                          {subject.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-heading text-[15px] font-bold text-foreground leading-snug">{subject.name}</h3>
                          {subject.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{subject.description}</p>}
                          <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full font-bold bg-gold/15 text-gold-strong dark:text-gold whitespace-nowrap">
                            Class {subject.class_level}
                          </span>
                        </div>
                        <span className="shrink-0 inline-flex items-center justify-center gap-0.5 h-8 pl-3 pr-2 rounded-lg text-white text-xs font-bold whitespace-nowrap shadow-sm transition-all group-hover:gap-1.5"
                          style={{ background: getSubjectGradient(subject.color) }}>
                          Open <ChevronRight className="w-3.5 h-3.5" />
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

export default NotesPage;
