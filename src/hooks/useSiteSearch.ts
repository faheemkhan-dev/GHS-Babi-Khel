// src/hooks/useSiteSearch.ts
// Shared "site search index" used for LIVE, as-you-type suggestions in the
// navbar search box (mobile + desktop), and also powers the full /search
// results page. Centralizing this here means both places always agree on
// what counts as a match — type "a" and you get real, ranked hits back
// immediately, not just after pressing Go.

import { useMemo } from "react";
import {
  Bell, Newspaper, Users, Home, Info, Phone, Calendar,
  BarChart3, BookOpen, Image, GraduationCap, Medal, Hash,
} from "lucide-react";
import { useNotices } from "@/hooks/useNotices";
import { useNews } from "@/hooks/useNews";
import { useTeachers } from "@/hooks/useTeachers";

export interface SearchHit {
  id: string;
  title: string;
  snippet?: string;
  href: string;
  group: "pages" | "notices" | "news" | "teachers";
  icon: any;
}

// ─── Static navigation/page index ─────────────────────────────────────────
export const PAGE_INDEX: { to: string; label: string; icon: any; keywords: string[] }[] = [
  { to: "/",          label: "Home",       icon: Home,          keywords: ["home", "main", "landing", "homepage", "start"] },
  { to: "/about",     label: "About",      icon: Info,          keywords: ["about", "school", "history", "info", "information"] },
  { to: "/contact",   label: "Contact",    icon: Phone,         keywords: ["contact", "phone", "email", "reach", "address", "location"] },
  { to: "/news",      label: "News",       icon: Newspaper,     keywords: ["news", "updates", "articles", "stories", "blog"] },
  { to: "/notices",   label: "Notices",    icon: Bell,          keywords: ["notice", "notices", "announcements", "alerts", "circular"] },
  { to: "/calendar",  label: "Calendar",   icon: Calendar,      keywords: ["calendar", "events", "dates", "schedule", "holidays", "exams"] },
  { to: "/results",   label: "Results",    icon: BarChart3,     keywords: ["results", "exams", "grades", "marks", "report", "scorecard"] },
  { to: "/merit-list", label: "Merit List", icon: Medal,         keywords: ["merit", "merit list", "toppers", "position holders", "rank", "ranking", "champions"] },
  { to: "/roll-no-slip", label: "Roll No. Slip", icon: Hash,     keywords: ["roll", "roll no", "roll number", "exam roll numbers", "admit card", "slip"] },
  { to: "/notes",     label: "Notes",      icon: BookOpen,      keywords: ["notes", "study", "material", "chapters", "lessons", "subjects"] },
  { to: "/gallery",   label: "Gallery",    icon: Image,         keywords: ["gallery", "photos", "pictures", "images", "media"] },
  { to: "/admission", label: "Admission",  icon: GraduationCap, keywords: ["admission", "admissions", "apply", "enroll", "register", "form"] },
  { to: "/teachers",  label: "Teachers",   icon: Users,         keywords: ["teachers", "staff", "faculty", "educators"] },
];

const match = (text: string | null | undefined, needle: string) =>
  !!text && text.toLowerCase().includes(needle.toLowerCase());

/**
 * Returns ranked search hits for `query`, live, with no debounce required
 * by the caller (callers may still debounce the query themselves for perf,
 * but a single keystroke like "a" already returns real matches).
 *
 * `limit` caps how many hits come back per group — useful for a compact
 * dropdown vs. the full /search page which can show everything.
 */
export function useSiteSearch(query: string, limitPerGroup = 4) {
  const { data: notices = [] } = useNotices();
  const { data: news = [] } = useNews();
  const { data: teachers = [] } = useTeachers();

  return useMemo(() => {
    const needle = query.trim();
    if (!needle) return { hits: [] as SearchHit[], total: 0 };

    const needleLower = needle.toLowerCase();

    const pageHits: SearchHit[] = PAGE_INDEX
      .filter((p) => {
        if (p.label.toLowerCase().includes(needleLower)) return true;
        return p.keywords.some((k) => k.includes(needleLower) || needleLower.includes(k));
      })
      .slice(0, limitPerGroup)
      .map((p) => ({
        id: `page-${p.to}`,
        title: p.label,
        snippet: "Page",
        href: p.to,
        group: "pages" as const,
        icon: p.icon,
      }));

    const noticeHits: SearchHit[] = notices
      .filter((n) => match(n.title, needle) || match(n.content, needle))
      .slice(0, limitPerGroup)
      .map((n) => ({
        id: n.id,
        title: n.title,
        snippet: (n.content || "").slice(0, 90),
        href: `/notices/${n.id}`,
        group: "notices" as const,
        icon: Bell,
      }));

    const newsHits: SearchHit[] = news
      .filter((n) => match(n.title, needle) || match(n.content, needle))
      .slice(0, limitPerGroup)
      .map((n) => ({
        id: n.id,
        title: n.title,
        snippet: (n.content || "").slice(0, 90),
        href: `/news/${n.id}`,
        group: "news" as const,
        icon: Newspaper,
      }));

    const teacherHits: SearchHit[] = teachers
      .filter((t) => match(t.full_name, needle) || match(t.subject, needle))
      .slice(0, limitPerGroup)
      .map((t) => ({
        id: t.id,
        title: t.full_name,
        snippet: t.subject || "Teacher",
        href: `/teachers`,
        group: "teachers" as const,
        icon: Users,
      }));

    const hits = [...pageHits, ...noticeHits, ...newsHits, ...teacherHits];
    return { hits, total: hits.length };
  }, [query, notices, news, teachers, limitPerGroup]);
}
