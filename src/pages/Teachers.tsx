import { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Search, BookOpen, Phone, GraduationCap, Briefcase, X } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import { useTeachers } from "@/hooks/useTeachers";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

/* Soft, light tones — rotated per card so the grid feels lively, never heavy. */
const TONES = [
  { band: "from-sky-100 to-indigo-100 dark:from-sky-500/20 dark:to-indigo-500/20",     chip: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",         avatar: "from-sky-400 to-indigo-400" },
  { band: "from-amber-100 to-orange-100 dark:from-amber-500/20 dark:to-orange-500/20", chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", avatar: "from-amber-400 to-orange-400" },
  { band: "from-rose-100 to-pink-100 dark:from-rose-500/20 dark:to-pink-500/20",       chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",     avatar: "from-rose-400 to-pink-400" },
  { band: "from-violet-100 to-fuchsia-100 dark:from-violet-500/20 dark:to-fuchsia-500/20", chip: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", avatar: "from-violet-400 to-fuchsia-400" },
  { band: "from-teal-100 to-cyan-100 dark:from-teal-500/20 dark:to-cyan-500/20",       chip: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",     avatar: "from-teal-400 to-cyan-400" },
];

const initialsOf = (name: string) =>
  name.replace(/^(mr|mrs|ms|miss|dr|sir|madam)\.?\s+/i, "").split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

const Teachers = () => {
  const { data: teachers = [], isLoading } = useTeachers();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [subject, setSubject] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearch = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 250);
  };

  const subjects = useMemo(
    () => Array.from(new Set(teachers.map((t) => (t.subject || "").trim()).filter(Boolean))).sort(),
    [teachers]
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return teachers.filter((t) => {
      if (subject !== "all" && (t.subject || "").trim() !== subject) return false;
      if (!q) return true;
      return (
        t.full_name.toLowerCase().includes(q) ||
        (t.subject && t.subject.toLowerCase().includes(q)) ||
        (t.qualification && t.qualification.toLowerCase().includes(q))
      );
    });
  }, [teachers, debouncedSearch, subject]);

  return (
    <PageLayout>
      {/* ── Light header ───────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-amber-50 via-background to-sky-50 dark:from-amber-500/5 dark:via-background dark:to-sky-500/5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-500/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10" />
        <div className="container relative mx-auto px-4 py-10 text-center sm:py-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Our Staff</p>
          <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight text-foreground sm:text-5xl">Our Teachers</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground sm:text-base">
            Dedicated educators shaping the future
          </p>
          {!isLoading && teachers.length > 0 && (
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              {teachers.length} {teachers.length === 1 ? "teacher" : "teachers"}
            </span>
          )}
        </div>
      </section>

      <section className="py-8 sm:py-12">
        <div className="container mx-auto px-4">
          {/* Search + subject chips */}
          <div className="mx-auto mb-8 max-w-2xl space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name or subject..."
                className="h-11 w-full rounded-xl border border-border/80 bg-card pl-10 pr-10 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setDebouncedSearch(""); }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {subjects.length > 1 && (
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
                {["all", ...subjects].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubject(s)}
                    className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11.5px] font-medium transition-colors ${
                      subject === s
                        ? "border-gold bg-gold/15 text-foreground"
                        : "border-border/80 bg-card text-muted-foreground hover:border-gold/50 hover:text-foreground"
                    }`}
                  >
                    {s === "all" ? "All" : s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                    <Skeleton className="h-14 w-full rounded-none" />
                    <div className="flex flex-col items-center space-y-2 p-4 pt-0">
                      <Skeleton className="-mt-9 h-[72px] w-[72px] rounded-full" />
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))
              : filtered.map((t, i) => {
                  const tone = TONES[i % TONES.length];
                  return (
                    <motion.article
                      key={t.id}
                      initial={{ opacity: 0, y: 14 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{ duration: 0.35, delay: Math.min(i % 4, 3) * 0.05 }}
                      className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-[box-shadow,border-color] duration-200 hover:border-gold/40 hover:shadow-elevated"
                    >
                      <div className={`h-14 bg-gradient-to-br sm:h-16 ${tone.band}`} />
                      <div className="flex flex-col items-center px-3 pb-4 text-center sm:px-4 sm:pb-5">
                        {t.photo_url ? (
                          <img
                            src={t.photo_url}
                            alt={t.full_name}
                            loading="lazy"
                            decoding="async"
                            className="-mt-9 h-[72px] w-[72px] rounded-full border-[3px] border-card object-cover shadow-md sm:-mt-10 sm:h-20 sm:w-20"
                          />
                        ) : (
                          <div className={`-mt-9 flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px] border-card bg-gradient-to-br font-heading text-lg font-bold text-white shadow-md sm:-mt-10 sm:h-20 sm:w-20 sm:text-xl ${tone.avatar}`}>
                            {initialsOf(t.full_name)}
                          </div>
                        )}

                        <h3 className="mt-2.5 w-full truncate font-heading text-[14px] font-bold leading-tight text-foreground sm:text-base">
                          {t.full_name}
                        </h3>

                        {t.subject && (
                          <span className={`mt-1.5 max-w-full truncate rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold sm:text-xs ${tone.chip}`}>
                            {t.subject}
                          </span>
                        )}

                        {(t.qualification || t.experience) && (
                          <div className="mt-3 w-full space-y-1 border-t border-border/60 pt-3 text-[11px] text-muted-foreground sm:text-xs">
                            {t.qualification && (
                              <p className="flex items-center justify-center gap-1.5">
                                <GraduationCap className="h-3.5 w-3.5 shrink-0 text-gold" />
                                <span className="truncate">{t.qualification}</span>
                              </p>
                            )}
                            {t.experience && (
                              <p className="flex items-center justify-center gap-1.5">
                                <Briefcase className="h-3.5 w-3.5 shrink-0 text-gold" />
                                <span className="truncate">{t.experience} experience</span>
                              </p>
                            )}
                          </div>
                        )}

                        {user && t.phone && (
                          <a
                            href={`tel:${String(t.phone).replace(/\s/g, "")}`}
                            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-background px-3 text-[11.5px] font-medium text-foreground transition-colors hover:border-gold/60 hover:bg-gold/10"
                          >
                            <Phone className="h-3 w-3 text-gold" />
                            {t.phone}
                          </a>
                        )}
                      </div>
                    </motion.article>
                  );
                })}
          </div>

          {!isLoading && filtered.length === 0 && (
            <div className="py-16 text-center">
              <BookOpen className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No teachers found matching your search.</p>
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
};

export default Teachers;
