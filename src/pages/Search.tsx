import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search as SearchIcon, Bell, Newspaper, Users, FileText, Compass,
  Home, Info, Phone, Calendar, BarChart3, BookOpen, Image, GraduationCap,
  Hash,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import { useNotices } from "@/hooks/useNotices";
import { useNews } from "@/hooks/useNews";
import { useTeachers } from "@/hooks/useTeachers";
import { useDebounce } from "@/hooks/useDebounce";

interface Hit {
  id: string;
  title: string;
  snippet?: string;
  href: string;
}

// ─── Static navigation/page index ─────────────────────────────────────────
// These mirror the navbar links (src/components/layout/Navbar.tsx). When a
// user types "News", "Calendar", "Library", etc., they almost certainly mean
// the page, not a piece of content that happens to contain that word. We
// surface page matches at the top of the results, ahead of content hits.
const PAGE_INDEX: { to: string; label: string; icon: any; keywords: string[] }[] = [
  { to: "/",          label: "Home",                icon: Home,         keywords: ["home", "main", "landing", "homepage", "start"] },
  { to: "/about",     label: "About",               icon: Info,         keywords: ["about", "school", "history", "info", "information"] },
  { to: "/contact",   label: "Contact",             icon: Phone,        keywords: ["contact", "phone", "email", "reach", "address", "location"] },
  { to: "/news",      label: "News",                icon: Newspaper,    keywords: ["news", "updates", "articles", "stories", "blog"] },
  { to: "/notices",   label: "Notices",             icon: Bell,         keywords: ["notice", "notices", "announcements", "alerts", "circular"] },
  { to: "/calendar",  label: "Calendar",            icon: Calendar,     keywords: ["calendar", "events", "dates", "schedule", "holidays", "exams"] },
  { to: "/results",   label: "Results",             icon: BarChart3,    keywords: ["results", "exams", "grades", "marks", "report", "scorecard"] },
  { to: "/roll-no-slip", label: "Roll No. Slip",    icon: Hash,         keywords: ["roll", "roll no", "roll number", "exam roll numbers", "admit card", "slip"] },
  { to: "/notes",     label: "Notes",               icon: BookOpen,     keywords: ["notes", "study", "material", "chapters", "lessons", "subjects"] },
  { to: "/gallery",   label: "Gallery",             icon: Image,        keywords: ["gallery", "photos", "pictures", "images", "media"] },
  { to: "/admission", label: "Admission",           icon: GraduationCap,keywords: ["admission", "admissions", "apply", "enroll", "register", "form"] },
  { to: "/teachers",  label: "Teachers",            icon: Users,        keywords: ["teachers", "staff", "faculty", "educators"] },
];

const SearchPage = () => {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [input, setInput] = useState(initialQ);
  const q = useDebounce(input.trim(), 250);

  // Keep the input box in sync with the URL's `q` param whenever it changes
  // from OUTSIDE this component — e.g. the navbar search box calling
  // navigate(`/search?q=...`) while SearchPage is already mounted (SPA
  // route, no remount). Without this, `input` only ever reflects the URL
  // param that existed at first mount, so a second search from the navbar
  // (or browser back/forward) silently shows nothing until the user
  // manually retypes into the box.
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== input) setInput(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("q")]);

  useEffect(() => {
    const cur = params.get("q") ?? "";
    if (q !== cur) {
      const next = new URLSearchParams(params);
      if (q) next.set("q", q); else next.delete("q");
      setParams(next, { replace: true });
    }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: notices = [] } = useNotices();
  const { data: news = [] } = useNews();
  const { data: teachers = [] } = useTeachers();

  const match = (text: string | null | undefined, needle: string) =>
    !!text && text.toLowerCase().includes(needle.toLowerCase());

  const results = useMemo(() => {
    const needle = q.trim();
    if (!needle) return { pages: [], notices: [], news: [], teachers: [] } as Record<string, Hit[]>;

    // ─── 1. Page / navigation matches (top priority) ─────────────────────
    // A page matches if the needle is contained in the label OR in any
    // keyword. Example: typing "news" → matches the News page (label+keyword).
    // Typing "events" → matches the Calendar page (keyword).
    const needleLower = needle.toLowerCase();
    const pageHits: Hit[] = PAGE_INDEX
      .filter((p) => {
        if (p.label.toLowerCase().includes(needleLower)) return true;
        return p.keywords.some((k) => k.includes(needleLower) || needleLower.includes(k));
      })
      .map((p) => ({
        id: `page-${p.to}`,
        title: p.label,
        snippet: "Open this page",
        href: p.to,
      }));

    // ─── 2. Content matches (notices / news / teachers) ──────────────────
    const noticeHits: Hit[] = notices
      .filter((n) => match(n.title, needle) || match(n.content, needle))
      .map((n) => ({
        id: n.id, title: n.title,
        snippet: (n.content || "").slice(0, 140),
        href: `/notices/${n.id}`,
      }));

    const newsHits: Hit[] = news
      .filter((n) => match(n.title, needle) || match(n.content, needle))
      .map((n) => ({
        id: n.id, title: n.title,
        snippet: (n.content || "").slice(0, 140),
        href: `/news/${n.id}`,
      }));

    const teacherHits: Hit[] = teachers
      .filter((t) => match(t.full_name, needle) || match(t.subject, needle))
      .map((t) => ({
        id: t.id, title: t.full_name,
        snippet: t.subject || "",
        href: `/teachers`,
      }));

    return { pages: pageHits, notices: noticeHits, news: newsHits, teachers: teacherHits };
  }, [q, notices, news, teachers]);

  const totalCount =
    results.pages.length + results.notices.length + results.news.length + results.teachers.length;

  // Look up the icon for each matched page (so we can render it in the result row)
  const pageIconFor = (to: string) =>
    PAGE_INDEX.find((p) => p.to === to)?.icon ?? Compass;

  const groups = [
    { key: "pages",    label: "Pages",    icon: Compass,    items: results.pages,    color: "text-primary"        },
    { key: "notices",  label: "Notices",  icon: Bell,       items: results.notices,  color: "text-red-500"        },
    { key: "news",     label: "News",     icon: Newspaper,  items: results.news,     color: "text-blue-500"       },
    { key: "teachers", label: "Teachers", icon: Users,      items: results.teachers, color: "text-emerald-500"    },
  ];

  return (
    <PageLayout>
      <PageBanner title="Search" subtitle="Find pages, notices, news, teachers and more" />

      <section className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="relative mb-6">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search pages, notices, news, teachers…"
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-card border border-border text-base text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {!q ? (
          <div className="bg-card border border-border rounded-2xl p-10 text-center">
            <SearchIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Type to search across the website.</p>
            {/* Quick-jump chips — most-searched pages */}
            <div className="flex flex-wrap justify-center gap-2 mt-5">
              {PAGE_INDEX.slice(3, 9).map((p) => {
                const Icon = p.icon;
                return (
                  <Link
                    key={p.to}
                    to={p.to}
                    className="inline-flex items-center gap-1.5 text-xs bg-secondary hover:bg-secondary/70 text-foreground rounded-full px-3 py-1.5 transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {p.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : totalCount === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-10 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-base font-semibold text-foreground">No results for "{q}"</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try a different keyword or browse{" "}
              <Link to="/notices" className="text-primary underline">notices</Link>,{" "}
              <Link to="/news" className="text-primary underline">news</Link>, or{" "}
              <Link to="/calendar" className="text-primary underline">events</Link>.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <g.icon className={`w-4 h-4 ${g.color}`} />
                    <h2 className="font-heading font-bold text-foreground">
                      {g.label}
                      <span className="ml-2 text-xs font-medium text-muted-foreground">
                        ({g.items.length})
                      </span>
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {g.items.map((h) => {
                      // For page hits, render the matching page icon on the left
                      const PageIcon = g.key === "pages" ? pageIconFor(h.href) : null;
                      return (
                        <Link
                          key={h.id}
                          to={h.href}
                          className="flex items-start gap-3 bg-card border border-border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition"
                        >
                          {PageIcon && (
                            <PageIcon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">{h.title}</p>
                            {h.snippet && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {h.snippet}
                              </p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>
    </PageLayout>
  );
};

export default SearchPage;
