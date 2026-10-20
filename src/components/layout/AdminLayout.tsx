import { useState, useCallback, useRef, useEffect, memo, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Menu, X, ExternalLink, Moon, Sun, Search, GraduationCap, BarChart2, Bell, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { pingDispatch } from "@/lib/push";
import { useAuth } from "@/hooks/useAuth";
import { useDarkMode } from "@/hooks/useDarkMode";
import NotificationBell from "@/components/shared/NotificationBell";
import { cn } from "@/lib/utils";

// ── Emoji icon component ──────────────────────────────────────────────────────
const EmojiIcon = ({ emoji, size = "w-5 h-5" }: { emoji: string; size?: string }) => (
  <span className={`${size} flex items-center justify-center text-base leading-none select-none`} aria-hidden>
    {emoji}
  </span>
);

// ── Nav structure with sections ───────────────────────────────────────────────
interface NavItem {
  id: string;
  label: string;
  emoji: string;
  lucideIcon?: React.ElementType;
  lucideColor?: string;
}
interface NavSection {
  heading: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    heading: "OVERVIEW",
    items: [
      { id: "overview",         label: "Overview",              emoji: "📊" },
      { id: "settings",         label: "School Settings",       emoji: "⚙️" },
      { id: "site-analytics",   label: "Site Analytics",        emoji: "📈",
        lucideIcon: BarChart2,  lucideColor: "text-violet-500" },
    ],
  },
  {
    heading: "STUDENTS",
    items: [
      { id: "admissions",   label: "Admissions",          emoji: "📋" },
      { id: "results",      label: "Manage Results",      emoji: "📝" },
      { id: "fees",          label: "Fee Management",       emoji: "💰" },
      { id: "student-records", label: "Student Records",   emoji: "🗂️" },
    ],
  },
  {
    heading: "EXAMS",
    items: [
      { id: "exam-date-sheet", label: "Exam Date Sheet",   emoji: "🗓️" },
      { id: "exam-rolls",      label: "Exam Roll Numbers", emoji: "🔢" },
      { id: "exam-seating",    label: "Exam Seating",      emoji: "🪑" },
      { id: "merit-list",      label: "Merit List",        emoji: "🏆" },
    ],
  },
  {
    heading: "SCHOOL",
    items: [
      { id: "teachers",      label: "Manage Teachers",   emoji: "👨‍🏫" },
      { id: "timetables",    label: "Timetables",        emoji: "📅" },
      { id: "announcements", label: "Notices",           emoji: "📢" },
      { id: "library",       label: "Library",           emoji: "📚" },
    ],
  },
  {
    heading: "CONTENT",
    items: [
      { id: "notes",   label: "Notes Manager",    emoji: "📓" },
      { id: "videos",  label: "Gallery",          emoji: "🖼️" },
    ],
  },
  {
    heading: "ADMIN ACCESS",
    items: [
      { id: "users", label: "Manage Users", emoji: "👤" },
    ],
  },
];

// Flat list for searching
const allNavItems: NavItem[] = navSections.flatMap(s => s.items);

// First few items for the mobile bottom bar quick-access row
const bottomBarItems: NavItem[] = allNavItems.slice(0, 4);

// Deep search index
const searchIndex: { label: string; sublabel?: string; tabId: string }[] = [
  ...allNavItems.map(item => ({ label: item.label, tabId: item.id })),
  { label: "Analytics",         sublabel: "Site Analytics",          tabId: "site-analytics" },
  { label: "Page Views",        sublabel: "Site Analytics",          tabId: "site-analytics" },
  { label: "Visitors",         sublabel: "Site Analytics",          tabId: "site-analytics" },
  { label: "Merit List",       sublabel: "Notices",        tabId: "announcements" },
  { label: "Videos",           sublabel: "Library",              tabId: "library" },
  { label: "Gallery",          sublabel: "Gallery",               tabId: "videos" },
  { label: "Add Admin",        sublabel: "Admin Access",          tabId: "users" },
  { label: "Delete Admin",     sublabel: "Admin Access",          tabId: "users" },
  { label: "Manage Users",     sublabel: "Admin Access",          tabId: "users" },
  { label: "YouTube",          sublabel: "Library",              tabId: "library" },
  { label: "Exam Schedule",    sublabel: "Exams · Date Sheet",    tabId: "exam-date-sheet" },
  { label: "Exam Date Sheet",  sublabel: "Exams · Date Sheet",    tabId: "exam-date-sheet" },
  { label: "Exam Roll Numbers",sublabel: "Exams · Roll Numbers",  tabId: "exam-rolls" },
  { label: "Admit Card",       sublabel: "Exams · Roll Numbers",  tabId: "exam-rolls" },
  { label: "Upload Results",   sublabel: "Manage Results",       tabId: "results" },
  { label: "Marksheet",        sublabel: "Manage Results",       tabId: "results" },
  { label: "Class Timetable",  sublabel: "Timetables",           tabId: "timetables" },
  { label: "Exam Timetable",   sublabel: "Timetables",           tabId: "timetables" },
  { label: "School Files",     sublabel: "Library",              tabId: "library" },
  { label: "Fee Structures",   sublabel: "Fee Management",       tabId: "fees" },
  { label: "Fee Vouchers",     sublabel: "Fee Management",       tabId: "fees" },
  { label: "Payments",         sublabel: "Fee Management",       tabId: "fees" },
  { label: "Fee Reports",      sublabel: "Fee Management",       tabId: "fees" },
  { label: "Defaulters List",  sublabel: "Fee Management",       tabId: "fees" },
  // ── Exam Seating synonyms ──
  { label: "Seating",          sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Seating Plan",     sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Exam Hall",        sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Room",             sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Desk",             sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Desk Layout",      sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Desk Map",         sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Invigilator",      sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "QR Stickers",      sublabel: "Exam Seating",         tabId: "exam-seating" },
  { label: "Anti-Cheat",       sublabel: "Exam Seating",         tabId: "exam-seating" },
  // ── Merit List synonyms ──
  { label: "Merit List",       sublabel: "Merit List",           tabId: "merit-list" },
  { label: "Toppers",          sublabel: "Merit List",           tabId: "merit-list" },
  { label: "School Merit",     sublabel: "Merit List",           tabId: "merit-list" },
  { label: "Position Holders", sublabel: "Merit List",           tabId: "merit-list" },
  // ── Live Exam Console synonyms (now nested inside Exam Seating → Live Console tab) ──
  { label: "Console",          sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Live Console",     sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Exam Day",         sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Control Room",     sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Hall Operations",  sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Tally",            sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Absentee",         sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Absentee List",    sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Re-Exam",          sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Invigilation",     sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Paper Countdown",  sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
  { label: "Live Attendance",  sublabel: "Exam Seating · Live Console",    tabId: "exam-seating" },
];

// Case-insensitive match against a label or any of its known synonyms
// in searchIndex, so e.g. typing "fee" finds "Fee Management".
const matchesQuery = (item: NavItem, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.label.toLowerCase().includes(q)) return true;
  return searchIndex.some(
    (e) => e.tabId === item.id && e.label.toLowerCase().includes(q)
  );
};

// ── PERFORMANCE: NavBtn + SectionedNav are defined OUTSIDE the parent ────────
// Previously these were defined INSIDE <AdminLayout>, which meant every
// render of the parent (e.g. typing in the search box, opening the mobile
// sidebar) created NEW component identities for NavBtn and SectionedNav.
// React then unmounted + remounted every single nav button on every render
// → focus loss, layout thrash, visible jank, and slow search filtering.
// Moving them outside + wrapping NavBtn in memo() means React can now skip
// re-rendering buttons whose props haven't changed. Pure refactor — the DOM
// output is byte-identical to before.
type NavBtnProps = {
  item: NavItem;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onItemClick?: () => void;
};
const NavBtn = memo(({ item, activeTab, onTabChange, onItemClick }: NavBtnProps) => {
  const isActive = activeTab === item.id;
  return (
    <button
      key={item.id}
      data-active={isActive ? "true" : "false"}
      onClick={() => { onTabChange(item.id); onItemClick?.(); }}
      className={cn(
        "group relative w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-gradient-to-r from-primary via-primary to-primary-light text-primary-foreground ring-1 ring-inset ring-white/10 shadow-[0_8px_20px_-8px_hsl(144_61%_20%/0.5)]"
          : "hover:bg-secondary/80 text-foreground",
      )}
    >
      {/* gold active rail — hairline with a soft heritage-gold glow */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200",
          isActive ? "bg-[hsl(43_89%_58%)] shadow-[0_0_8px_hsl(43_89%_58%/0.75)] opacity-100" : "opacity-0",
        )}
      />
      {item.lucideIcon ? (
        <item.lucideIcon
          className={cn("w-5 h-5 shrink-0", isActive ? "text-white" : item.lucideColor ?? "text-muted-foreground")}
        />
      ) : (
        <span className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
          isActive ? "bg-white/15" : "bg-transparent group-hover:bg-background/70",
        )}>
          <EmojiIcon emoji={item.emoji} size="w-4 h-4" />
        </span>
      )}
      <span className="truncate">{item.label}</span>
      <ChevronRight
        aria-hidden
        className={cn(
          "ml-auto h-3.5 w-3.5 shrink-0 transition-all duration-200",
          isActive ? "text-white/70 opacity-100" : "text-muted-foreground/0 group-hover:text-muted-foreground/60 group-hover:opacity-100 opacity-0",
        )}
      />
    </button>
  );
});
NavBtn.displayName = "NavBtn";

type SectionedNavProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onItemClick?: () => void;
  query?: string;
};
// ── PERFORMANCE: SectionedNav memoizes the filtered sections array so the
// .map().filter() work only re-runs when `query` actually changes — not on
// every parent render. Without this, typing in the search box would rebuild
// the entire navSections-derived array on every keystroke even when the
// filtered result was identical to the previous render.
const SectionedNav = memo(({ activeTab, onTabChange, onItemClick, query = "" }: SectionedNavProps) => {
  const filteredSections = useMemo(() =>
    navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => matchesQuery(item, query)),
      }))
      .filter(section => section.items.length > 0),
    [query]
  );

  if (query.trim() && filteredSections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No matches for "{query.trim()}"
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {filteredSections.map(section => (
        <div key={section.heading}>
          <p className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/80 tracking-[0.16em] uppercase px-3 mb-1.5">
            <span aria-hidden className="h-px w-3 rounded-full bg-gradient-to-r from-[hsl(43_89%_58%/0.7)] to-transparent" />
            {section.heading}
          </p>
          <div className="space-y-1">
            {section.items.map(item => <NavBtn key={item.id} item={item} activeTab={activeTab} onTabChange={onTabChange} onItemClick={onItemClick} />)}
          </div>
        </div>
      ))}
    </div>
  );
});
SectionedNav.displayName = "SectionedNav";

/* ── Sidebar shell (shared by desktop rail + mobile drawer) ─────────────────── */
const SidebarInner = ({
  activeTab, onTabChange, onItemClick, query, setQuery, onSignOut,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onItemClick?: () => void;
  query: string;
  setQuery: (q: string) => void;
  onSignOut: () => void;
}) => (
  <>
    {/* Brand */}
    <div className="relative overflow-hidden border-b border-border/60 p-4">
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
      <Link to="/" className="relative flex items-center gap-2.5">
        <div className="relative">
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 ring-2 ring-primary/15 shadow-sm">
            <img src="/icon-512.png" alt="GHS Babi Khel logo" className="w-full h-full object-cover" />
          </div>
          <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <span className="font-heading font-bold text-foreground text-sm leading-tight block truncate">GHS Babi Khel</span>
          <p className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase">Admin Panel</p>
        </div>
      </Link>
    </div>

    {/* Search — filters the menu below in place, never opens a popup */}
    <div className="px-3 py-2.5 border-b border-border/60">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anything..."
          className="w-full h-9 pl-9 pr-3 text-xs rounded-full bg-secondary/70 border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-colors"
        />
      </div>
    </div>

    <nav className="flex-1 p-3 overflow-y-auto admin-nav-scroll">
      <SectionedNav activeTab={activeTab} onTabChange={onTabChange} onItemClick={onItemClick} query={query} />
    </nav>

    <div className="p-3 border-t border-border/60 space-y-1">
      <Link to="/" onClick={onItemClick} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
        <ExternalLink className="w-4 h-4" /> View Website
      </Link>
      <button onClick={onSignOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
        <LogOut className="w-4 h-4" /> Sign Out
      </button>
    </div>
  </>
);

interface AdminLayoutProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
}

const AdminLayout = ({ activeTab, onTabChange, children }: AdminLayoutProps) => {
  const { profile, signOut } = useAuth();

  // Web Push: whenever any admin action (publish notice/results/merit list/
  // roll slips/date sheet, change an application status…) succeeds, ask the
  // server to announce whatever is newly public. Debounced; the server is
  // idempotent so repeated pings never double-notify.
  const queryClientForPush = useQueryClient();
  useEffect(() => {
    let timer: number | undefined;
    const unsub = queryClientForPush.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => pingDispatch("admin"), 2500);
      }
    });
    return () => { unsub(); window.clearTimeout(timer); };
  }, [queryClientForPush]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopQuery, setDesktopQuery] = useState("");
  const [mobileQuery, setMobileQuery] = useState("");
  const mobileNavRef = useRef<HTMLElement>(null);
  const [bottomHidden, setBottomHidden] = useState(false);
  const bottomLastScrollYRef = useRef(0);
  const bottomHiddenRef = useRef(false);
  const bottomRafRef = useRef(0);
  const navigate = useNavigate();
  // PERF: rAF-coalesced — one pass per animation frame at most, and the
  // state is only written when the value actually flips (React then bails
  // out of re-rendering the layout for no-op scrolls).
  useEffect(() => {
    bottomLastScrollYRef.current = window.scrollY;
    const onScrollPass = () => {
      bottomRafRef.current = 0;
      const y = window.scrollY;
      const delta = y - bottomLastScrollYRef.current;
      let next: boolean;
      if (y <= 64 || delta < -4) next = false;
      else if (delta > 4) next = true;
      else next = bottomHiddenRef.current;
      bottomLastScrollYRef.current = y;
      if (next !== bottomHiddenRef.current) {
        bottomHiddenRef.current = next;
        setBottomHidden(next);
      }
    };
    const onScroll = () => {
      if (bottomRafRef.current) return;
      bottomRafRef.current = requestAnimationFrame(onScrollPass);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (bottomRafRef.current) cancelAnimationFrame(bottomRafRef.current);
    };
  }, []);
  const { isDark, toggle } = useDarkMode();

  useEffect(() => {
    if (!sidebarOpen) return;
    requestAnimationFrame(() => {
      const nav = mobileNavRef.current;
      if (!nav) return;
      const active = nav.querySelector('[data-active="true"]') as HTMLElement | null;
      if (active) {
        const top = active.offsetTop - nav.clientHeight / 2 + active.clientHeight / 2;
        nav.scrollTop = Math.max(0, top);
      }
    });
  }, [sidebarOpen]);

  const handleSignOut = async () => { await signOut(); navigate("/"); };

  const initials = profile?.full_name
    ?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() || "A";

  const activeLabel = allNavItems.find(n => n.id === activeTab)?.label || "Admin Dashboard";
  const activeSection = navSections.find(s => s.items.some(i => i.id === activeTab))?.heading || "Panel";

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[264px] bg-card border-r border-border/70 shrink-0 sticky top-0 h-screen">
        <SidebarInner
          activeTab={activeTab} onTabChange={onTabChange}
          query={desktopQuery} setQuery={setDesktopQuery} onSignOut={handleSignOut}
        />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header — breadcrumb + actions */}
        <header className="sticky top-0 z-40 bg-card/90 border-b border-border/60 flex items-center h-14 px-3 sm:px-4 gap-2 sm:gap-3">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-secondary text-foreground transition-colors" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 leading-none">{activeSection}</p>
            <h1 className="truncate font-heading font-bold text-foreground text-[15px] sm:text-base leading-tight">{activeLabel}</h1>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            {/* SPA link (NOT <a href>) — a plain anchor here did a FULL
                document reload of the whole admin panel just to peek at the
                public site, losing the admin's scroll/forms/tabs. */}
            <Link to="/" className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full hover:bg-secondary transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> View Website
            </Link>
            <button onClick={toggle} className="p-2 rounded-full hover:bg-secondary text-muted-foreground transition-colors" title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <div className="hidden sm:block h-6 w-px bg-border/70" aria-hidden />
            <button onClick={handleSignOut} className="flex items-center gap-1.5 text-xs font-medium text-destructive px-3 py-1.5 rounded-full hover:bg-destructive/10 transition-colors">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-4 md:p-6 pb-24 lg:pb-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Mobile bottom bar */}
      <div className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 border-t border-border/70 shadow-[0_-8px_24px_-16px_hsl(var(--primary)/0.28)] transition-transform duration-300 ease-out ${bottomHidden ? "translate-y-full" : "translate-y-0"}`} style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around py-1.5">
          {bottomBarItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                aria-label={item.label}
                className={`admin-dock-item relative flex flex-col items-center gap-0.5 p-2 min-w-[3.25rem] rounded-xl transition-all duration-200 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <span aria-hidden className="absolute -top-1.5 h-1 w-7 rounded-full bg-[hsl(43_89%_58%)] shadow-[0_0_10px_hsl(43_89%_58%/0.8)]" />}
                {item.lucideIcon ? (
                  <item.lucideIcon className={`w-6 h-6 ${isActive ? "text-primary" : item.lucideColor ?? "text-muted-foreground"}`} />
                ) : (
                  <span className="text-xl leading-none">{item.emoji}</span>
                )}
              </button>
            );
          })}
          <button onClick={() => setSidebarOpen(true)} aria-label="Open menu" className="admin-dock-item flex flex-col items-center gap-0.5 p-2 min-w-[3.25rem] text-muted-foreground">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-foreground/50 backdrop-blur-[2px]" onClick={() => setSidebarOpen(false)} />
          <div className="relative w-[290px] bg-card h-full shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            {/* Profile block for mobile */}
            <div className="flex items-center justify-between p-4 border-b border-border/60">
              <div className="flex items-center gap-2.5 min-w-0">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-border shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight">{profile?.full_name || "Admin"}</p>
                  <span className="inline-block text-[10px] font-semibold uppercase bg-primary text-primary-foreground px-2 py-0.5 rounded-full mt-0.5 tracking-wider">
                    Administrator
                  </span>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-xl hover:bg-secondary shrink-0" aria-label="Close menu">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-3 py-2 border-b border-border/60">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={mobileQuery}
                  onChange={(e) => setMobileQuery(e.target.value)}
                  placeholder="Search anything..."
                  className="w-full h-9 pl-9 pr-3 text-xs rounded-full bg-secondary/70 border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-colors"
                />
              </div>
            </div>
            <nav ref={mobileNavRef} className="flex-1 overflow-y-auto admin-nav-scroll">
              <SectionedNav activeTab={activeTab} onTabChange={onTabChange} onItemClick={() => setSidebarOpen(false)} query={mobileQuery} />
            </nav>
            <div className="p-3 border-t border-border/60 space-y-1">
              <Link to="/" onClick={() => setSidebarOpen(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
                <ExternalLink className="w-4 h-4" /> Main Website
              </Link>
              <button onClick={handleSignOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminLayout;
