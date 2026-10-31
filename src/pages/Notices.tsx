import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Newspaper } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { useNotices, type Notice } from "@/hooks/useNotices";
import { Skeleton } from "@/components/ui/skeleton";
import TextToSpeechPlayer from "@/components/shared/TextToSpeechPlayer";
import EditorialNoticeCard from "@/components/shared/EditorialNoticeCard";
import NoticePollCard from "@/components/shared/NoticePollCard";

const tabs = ["All", "Urgent", "General", "Academic", "Events"];
const PER_PAGE = 9;

const Notices = () => {
  const { data: allNotices = [], isLoading } = useNotices();
  const [activeTab, setActiveTab] = useState("All");
  const [page, setPage] = useState(1);
  const [ttsNotice, setTtsNotice] = useState<{ title: string; content: string } | null>(null);

  const filtered = allNotices.filter((n) => {
    if (activeTab === "All") return true;
    if (activeTab === "Urgent") return n.is_urgent;
    // The admin dashboard saves categories in lowercase ("general", "academic",
    // "events", "urgent") while these tabs are capitalised, so a strict ===
    // never matched and the General/Academic/Events tabs always showed
    // "No notices found". Compare case-insensitively and ignore stray spaces.
    return (n.category || "").trim().toLowerCase() === activeTab.toLowerCase();
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const openListen = (item: Notice, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setTtsNotice({ title: item.title, content: item.content || item.title });
  };

  return (
    <PageLayout>
      <PageBanner title="Notice Board" subtitle="Stay updated with school announcements" />

      {/* ══════════════════════════════════════════
          SECTION — Notices (editorial dispatch style)
         ══════════════════════════════════════════ */}
      <section className="py-8 sm:py-14">
        <div className="container mx-auto px-4">

          {/* ── Centered editorial header ── */}
          <div className="mb-5 sm:mb-8 text-center">
            <div className="flex items-center justify-center gap-2 mb-2.5 sm:mb-4">
              <span className="h-px w-12 bg-gradient-to-r from-transparent to-gold/70" />
              <span className="inline-block w-1.5 h-1.5 rotate-45 bg-gold/80" />
              <span className="h-px w-12 bg-gradient-to-l from-transparent to-gold/70" />
            </div>
            <h2 className="text-[1.7rem] sm:text-3xl md:text-4xl leading-tight font-display italic font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              From GHS Babi Khel
            </h2>
            <p className="text-muted-foreground mt-2 text-[13px] sm:text-sm leading-relaxed max-w-xl mx-auto">
              Official notices and announcements from our school administration — read or listen, in English or Urdu.
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mt-2">
              <Newspaper className="w-3.5 h-3.5" /> {allNotices.length} notice{allNotices.length === 1 ? "" : "s"} published
            </span>
            <div className="flex items-center justify-center gap-2 mt-3">
              <span className="h-px w-16 bg-gradient-to-r from-transparent to-gold/40" />
              <span className="inline-block w-1 h-1 rotate-45 bg-gold/50" />
              <span className="h-px w-16 bg-gradient-to-l from-transparent to-gold/40" />
            </div>
          </div>

          {/* Tabs — slim pills in ONE swipeable row (no wrapping, no tall buttons) */}
          <div className="-mx-4 mb-5 sm:mb-8">
            <div
              role="tablist"
              aria-label="Notice categories"
              className="flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:justify-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x"
            >
              {tabs.map((tab) => {
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setActiveTab(tab); setPage(1); }}
                    className={`inline-flex h-8 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors active:scale-[0.97] ${
                      active
                        ? "bg-[hsl(348_55%_28%)] text-[hsl(45_40%_95%)] border-[hsl(348_55%_28%)] shadow-sm"
                        : "bg-card text-muted-foreground border-border hover:border-gold/60 hover:text-foreground"
                    }`}
                  >
                    {tab}
                    {tab === "Urgent" && (
                      <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${active ? "bg-[hsl(45_40%_95%)]" : "bg-[hsl(348_55%_28%)]"}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notices grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-56 sm:h-80 rounded-md" />)}
            </div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-10 sm:py-16 bg-card rounded-md border border-gold/30">
              <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No notices found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {paginated.map((item, i) => (
                item.is_poll ? (
                  <NoticePollCard key={item.id} item={item} index={i} />
                ) : (
                  <EditorialNoticeCard
                    key={item.id}
                    item={item}
                    index={i}
                    onListen={(it, e) => openListen(it, e)}
                  />
                )
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1.5 mt-6 sm:mt-10">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`h-8 w-8 rounded-full text-xs font-medium transition-colors border ${
                    page === i + 1
                      ? "bg-[hsl(348_55%_28%)] text-[hsl(45_40%_95%)] border-[hsl(348_55%_28%)]"
                      : "bg-card text-muted-foreground border-border hover:border-gold/60 hover:text-foreground"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          {/* Back to top link */}
          <div className="text-center mt-8 sm:mt-12">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>
      </section>

      {ttsNotice && (
        <TextToSpeechPlayer
          text={ttsNotice.content}
          title={ttsNotice.title}
          onClose={() => setTtsNotice(null)}
        />
      )}
    </PageLayout>
  );
};

export default Notices;
