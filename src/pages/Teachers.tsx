import { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Search, BookOpen } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { useTeachers } from "@/hooks/useTeachers";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";

const Teachers = () => {
  const { data: teachers = [], isLoading } = useTeachers();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearch = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const filtered = useMemo(
    () =>
      teachers.filter(
        (t) =>
          t.full_name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
          (t.subject && t.subject.toLowerCase().includes(debouncedSearch.toLowerCase()))
      ),
    [teachers, debouncedSearch]
  );

  const isTouchDevice = () => window.matchMedia("(hover: none)").matches;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchDevice()) return; // skip 3D tilt on touch/mobile — causes GPU glitch
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -16;
    card.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg) translateY(-8px)`;
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchDevice()) return;
    e.currentTarget.style.transform = "perspective(600px) rotateY(0deg) rotateX(0deg) translateY(0px)";
  };

  return (
    <PageLayout>
      <PageBanner title="Our Teachers" subtitle="Dedicated educators shaping the future" />

      <section className="py-16">
        <div className="container mx-auto px-4">
          {/* Search */}
          <div className="max-w-md mx-auto mb-10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name or subject..."
                className="w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-sm shadow-card focus:ring-2 focus:ring-ring outline-none"
              />
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-card rounded-2xl overflow-hidden shadow-card">
                    <Skeleton className="h-20 sm:h-28 w-full" />
                    <div className="pt-8 sm:pt-12 p-3 sm:p-5 space-y-2">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))
              : filtered.map((t) => (
                  <div
                    key={t.id}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    className="bg-card rounded-2xl overflow-hidden shadow-card hover:shadow-elevated transition-all duration-200"
                    style={{ transition: "transform 0.15s ease-out, box-shadow 0.3s" }}
                  >
                    <div className="h-20 sm:h-28 gradient-hero relative">
                      <div className="absolute -bottom-8 sm:-bottom-10 left-3 sm:left-5">
                        {t.photo_url ? (
                          <img
                            src={t.photo_url}
                            alt={t.full_name}
                            loading="lazy"
                            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-4 border-card object-cover"
                          />
                        ) : (
                          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-4 border-card gradient-accent flex items-center justify-center text-primary-foreground text-lg sm:text-xl font-heading font-bold">
                            {t.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="pt-10 sm:pt-14 p-3 sm:p-5">
                      <h3 className="font-heading font-semibold text-foreground text-sm sm:text-base truncate">{t.full_name}</h3>
                      {t.subject && (
                        <span className="inline-block mt-1.5 bg-primary/10 text-primary text-[10px] sm:text-xs font-medium px-2 sm:px-2.5 py-0.5 rounded-full">
                          {t.subject}
                        </span>
                      )}
                      {t.qualification && (
                        <p className="text-[10px] sm:text-xs text-muted-foreground mt-2 truncate">{t.qualification}</p>
                      )}
                      {t.experience && (
                        <p className="text-xs text-muted-foreground">{t.experience} experience</p>
                      )}
                      {user && t.phone && (
                        <p className="text-xs text-muted-foreground mt-1">📞 {t.phone}</p>
                      )}
                    </div>
                  </div>
                ))}
          </div>

          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-16">
              <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No teachers found matching your search.</p>
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
};

export default Teachers;

