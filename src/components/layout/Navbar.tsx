import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu, X, GraduationCap, LogIn, UserPlus, ArrowRight,
  LayoutDashboard, LogOut, Shield, Search, ChevronDown, ChevronRight,
  Home, Landmark, Mail, Megaphone,
  Trophy, Medal, BookOpen, Library, Images, ClipboardList, HelpCircle,
  Hash, Timer, Command as CommandIcon,
  Bell, FileSignature, type LucideIcon,
} from "lucide-react";
import { useRollSlipCountdown, compactCountdown } from "@/hooks/useRollSlipCountdown";
import { useResultsCountdown, splitCountdown } from "@/hooks/useResultsCountdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { armAutoPublish, serverNow, syncServerClock } from "@/lib/autoPublish";
import { supabase } from "@/lib/supabase";
import { useBisepCurrentExam } from "@/hooks/useBisepCurrentExam";
import { useSchoolSettings, safeMediaUrl, optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";
import { useSiteSearch } from "@/hooks/useSiteSearch";
import { useAuth } from "@/hooks/useAuth";
import NotificationBell from "@/components/shared/NotificationBell";
import ThemeSwitcher from "@/components/shared/ThemeSwitcher";
import ThemeToggleButton from "@/components/shared/ThemeToggleButton";
import HexagonLogoFrame from "@/components/shared/HexagonLogoFrame";
import NavSearchDropdown from "@/components/layout/NavSearchDropdown";
import { openCommandPalette } from "@/components/shared/CommandPalette";
import { intentPrefetchHandlers } from "@/lib/routePrefetch";

/* ═══════════════════════════════════════════════════════════════════════════
   useIsDesktop — tiny matchMedia hook (xl breakpoint = 1280px).
   Used to GATE the NavSearchBox so it (and its three Supabase queries —
   notices, news, teachers) only mounts on actual desktop viewports.
   On mobile the desktop nav is `display:none` anyway, but React still
   MOUNTS everything inside it, so without this gate every mobile page
   load fires 3 extra Supabase round-trips that contribute nothing and
   compete with the page's own data for main-thread / network time —
   one of the root causes of the mobile navbar feeling "stuck".
   ═════════════════════════════════════════════════════════════════════════ */
function useIsDesktop(breakpoint = "(min-width: 1280px)") {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(breakpoint).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(breakpoint);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [breakpoint]);
  return isDesktop;
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAV MODEL — the 15 site pages are grouped into 4 tidy drop-down sections
   (+ Home and Admission as direct links), so the top bar stays clean while
   every page remains one hover / one tap away.

   Each link carries: icon, one-line description and its own soft "tint"
   chip colour — a light pastel / dark translucent wash instead of a loud
   gradient square — shared by the desktop panels and the mobile accordion
   groups. Soft chips keep both menus calm, modern and premium. */
interface NavLinkItem {
  to: string;
  label: string;
  icon: LucideIcon;
  desc: string;
  tint: string; // soft icon-chip tint classes (bg + text, light & dark)
}

interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  tagline: string;
  tint: string;
  links: NavLinkItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: "school",
    label: "Our School",
    icon: Landmark,
    tagline: "Who we are & how to reach us",
    tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light",
    links: [
      { to: "/about",   label: "About",   icon: Landmark,   desc: "History, mission & facilities",      tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
      { to: "/gallery", label: "Gallery", icon: Images,     desc: "Photos & videos of school life",     tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
      { to: "/contact", label: "Contact", icon: Mail,       desc: "Address, phone & location map",      tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
      { to: "/faq",     label: "FAQs",    icon: HelpCircle, desc: "Answers to common questions",        tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
    ],
  },
  {
    id: "notices",
    label: "Notices",
    icon: Megaphone,
    tagline: "Official announcements",
    tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light",
    links: [
      { to: "/notices",  label: "Notices",  icon: Megaphone,   desc: "Official announcements",       tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
    ],
  },
  {
    id: "results",
    label: "Results",
    icon: Trophy,
    tagline: "Exam outcomes, toppers & slips",
    tint: "bg-gold-soft text-[hsl(43_89%_29%)] dark:bg-gold/15 dark:text-gold",
    links: [
      { to: "/results",   label: "Exam Results", icon: Trophy, desc: "Exam results & DMCs",           tint: "bg-gold-soft text-[hsl(43_89%_29%)] dark:bg-gold/15 dark:text-gold" },
      { to: "/merit-list", label: "Merit List", icon: Medal, desc: "Toppers & position holders",   tint: "bg-gold-soft text-[hsl(43_89%_29%)] dark:bg-gold/15 dark:text-gold" },
    ],
  },
  {
    id: "academics",
    label: "Academics",
    icon: BookOpen,
    tagline: "Learn anywhere, anytime",
    tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light",
    links: [
      { to: "/notes",          label: "Notes",          icon: BookOpen, desc: "Study notes by class & subject",   tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
      { to: "/library",        label: "Library",        icon: Library,  desc: "Books & reading resources",        tint: "bg-secondary text-primary dark:bg-primary/15 dark:text-primary-light" },
    ],
  },
];

// The Roll No. Slip page gets its own spotlight card inside the Results
// panel (with the live countdown badge) instead of a plain row.
const rollSlipItem: NavLinkItem = {
  to: "/roll-no-slip", label: "Roll No. Slip", icon: Hash,
  desc: "Find, download & share your slip", tint: "bg-gold-soft text-[hsl(43_89%_29%)] dark:bg-gold/15 dark:text-gold",
};

/* ── Roll No. Slip live countdown ────────────────────────────────────────────
   When the admin schedules Exam Roll Numbers, a live countdown appears on
   every "Roll No. Slip" entry point in the navbar:
     • chip       → desktop top bar (gold pill, ticking HH:MM:SS)
     • strip      → slim bar under the navbar on smaller screens
     • menu-badge → mini badge beside the Roll No. Slip row in the menus
   The countdown is driven by useRollSlipCountdown() — the exact same source
   the /roll-no-slip page uses, so everything ticks in sync. When the timer
   reaches zero the indicator flips to an orange "LIVE" state for ~90 seconds
   (slips are already published by then — publishing is instant), then hides. ──*/
const LIVE_GRACE_MS = 90 * 1000;

function RollSlipCountdown({ variant }: { variant: "chip" | "strip" | "menu-badge" }) {
  const { scheduled } = useRollSlipCountdown();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Tick only while a countdown is actually on screen.
    if (!scheduled) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [scheduled]);

  if (!scheduled || !scheduled.publish_at) return null;
  const diff = new Date(scheduled.publish_at).getTime() - now;
  if (diff <= -LIVE_GRACE_MS) return null; // countdown over + grace elapsed → hide
  const live = diff <= 0;

  if (variant === "chip") {
    return (
      <Link
        to="/roll-no-slip"
        aria-label="Roll No. Slip countdown — tap to open"
        className={`hidden xl:inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all shadow-sm no-underline ${
          live
            ? "bg-orange-600 text-white hover:bg-orange-700 shadow-orange-600/30"
            : "bg-azure/10 border border-azure/40 text-foreground hover:bg-azure/15"
        }`}
      >
        <Timer className={`w-4 h-4 ${live ? "" : "text-azure"}`} />
        <span className="leading-none">
          {live ? (
            <span className="tracking-wide">Slips LIVE</span>
          ) : (
            <span className="font-mono tabular-nums">{compactCountdown(diff)}</span>
          )}
        </span>
        {!live && <span className="w-1.5 h-1.5 rounded-full bg-azure animate-pulse" aria-hidden="true" />}
      </Link>
    );
  }

  if (variant === "strip") {
    // Professional red strip — same size/shape as the golden Results strip,
    // sits ABOVE the school name. Dark-crimson digit chips, white numbers.
    const { d, h, m, s: sec } = splitCountdown(diff);
    const pad = (n: number) => String(n).padStart(2, "0");
    const chip = (v: string, unit: string) => (
      <span className="inline-flex items-baseline gap-0.5 rounded-md bg-[#4A0B0B] px-1.5 py-[3px] leading-none shadow-sm ring-1 ring-white/20">
        <span className="font-mono tabular-nums text-[13px] font-extrabold text-white">{v}</span>
        <span className="text-[8px] font-bold uppercase text-white/70">{unit}</span>
      </span>
    );
    return (
      <Link
        to="/roll-no-slip"
        aria-label="Roll No. Slip countdown — tap to open"
        className={`group relative xl:hidden flex min-h-[34px] items-center justify-center gap-2 overflow-hidden border-b px-4 py-1.5 no-underline transition-[filter] hover:brightness-110 ${live ? "border-emerald-900/40 bg-gradient-to-r from-emerald-700 via-emerald-600 to-emerald-700" : "border-[#5E0F0F]/60 bg-gradient-to-r from-[#8E1515] via-[#B01C1C] to-[#8E1515]"}`}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" aria-hidden="true" />
        <Hash className="h-3.5 w-3.5 shrink-0 text-white" />
        {live ? (
          <span className="text-xs font-extrabold text-white">Roll No. Slips are <span className="underline underline-offset-2">LIVE</span> — tap to view</span>
        ) : (
          <>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white">Roll No. Slip in</span>
            <span className="flex items-center gap-1">
              {d > 0 && chip(String(d), "d")}
              {chip(pad(h), "h")}
              {chip(pad(m), "m")}
              {d === 0 && chip(pad(sec), "s")}
            </span>
          </>
        )}
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-white" aria-hidden="true" />
      </Link>
    );
  }

  // menu-badge — tiny inline badge beside the Roll No. Slip row
  return (
    <span
      className={`ml-auto shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        live
          ? "bg-azure text-white"
          : "bg-secondary text-azure-strong dark:text-azure border border-border/60"
      }`}
    >
      {live ? "LIVE" : <span className="font-mono tabular-nums">{compactCountdown(diff)}</span>}
    </span>
  );
}

/* ── Results top strip (mobile, tablet & desktop) ─────────────────────────────────
   ONE golden strip pinned ABOVE the school name (top of the header) that
   replaces the old red strips under it:
     1. A school results publish OR a BISE Peshawar countdown is running →
        stylish "RESULTS IN [02] : [05] : [09]" with dark-green digit chips.
     2. Countdown just hit zero → "Results are LIVE — tap to view" (short
        grace period, same as before), or "Publishing results…" for a
        school schedule, which flips within ~a second.

   The strip is COUNTDOWN-ONLY. Once the countdown has run out and the
   LIVE/publishing grace period elapses, the bar renders nothing at all.
   It used to fall back to a permanent "Results · <exam title>" line, but
   that just re-advertises a result the moment it goes live — the green
   announcements strip below the header already carries that news, and a
   gold bar pinned above the school name on every single page for the rest
   of the term is visual noise. ─────────────────────────────────────────── */
function ResultsTopStrip() {
  const { scheduled } = useResultsCountdown();
  const { data: bisepMeta } = useBisepCurrentExam();
  const qc = useQueryClient();
  const [now, setNow] = useState(() => serverNow());

  // Same source of truth as the /results page: has the school published?
  const { data: hasSchool } = useQuery<boolean>({
    queryKey: ["has-published-school-results"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("results").select("id", { count: "exact", head: true }).eq("is_published", true);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    staleTime: 60 * 1000,
  });

  // Exact-moment publish works from ANY page, not only /results.
  const schedKey = scheduled?.publish_at ?? "";
  useEffect(() => {
    if (!schedKey) return;
    return armAutoPublish([schedKey], qc);
  }, [schedKey, qc]);

  // Mode — mirrors Results.tsx: school mode when results are published OR a
  // school schedule is pending; BISE Peshawar only when neither exists.
  const schoolAt = scheduled?.publish_at ? new Date(scheduled.publish_at).getTime() : null;
  const schoolMode = hasSchool === true || schoolAt != null;
  const modeKnown = hasSchool !== undefined || schoolAt != null;

  const bisepAt =
    !schoolMode && bisepMeta?.countdown_date && !bisepMeta?.is_live
      ? new Date(bisepMeta.countdown_date).getTime() : null;
  const target =
    schoolAt != null && schoolAt - now > -LIVE_GRACE_MS ? schoolAt
    : bisepAt != null && bisepAt - now > -LIVE_GRACE_MS ? bisepAt
    : null;

  useEffect(() => { void syncServerClock(); }, []);
  useEffect(() => {
    if (target == null) return;
    // PERF (2026-10 mobile-navbar hang fix): 250 ms was an aggressive ticking
    // rate that re-rendered this entire strip (and its children) FOUR times
    // per second — fine on desktop, but on a low-end Android phone that's
    // exactly the kind of constant main-thread work that makes the navbar
    // feel "stuck" when you also tap to open a dropdown at the same time.
    // 1000 ms (1 Hz) is plenty for a countdown that shows hours:minutes:seconds
    // — humans cannot perceive the difference, but the main thread gets 4×
    // less re-render work. The seconds digit still ticks visibly every second.
    const t = window.setInterval(() => setNow(serverNow()), 1000);
    return () => window.clearInterval(t);
  }, [target]);

  const diff = target != null ? target - now : null;
  // School schedule at zero = "being published" (flips within ~a second);
  // never advertise it as LIVE before results are really readable.
  const live = diff != null && diff <= 0 && target !== schoolAt;
  const publishing = diff != null && diff <= 0 && target === schoolAt;

  // Don't guess (e.g. flash the BISE countdown) until the mode is known.
  if (!modeKnown) return null;
  // No countdown, nothing in the LIVE/publishing grace window → show nothing.
  if (diff == null) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const chip = (v: string, unit: string) => (
    <span className="inline-flex items-baseline gap-0.5 rounded-md bg-[#0B2E19] px-1.5 py-[3px] sm:px-2 sm:py-1 leading-none shadow-sm ring-1 ring-[#F2D27A]/20">
      <span className="font-mono tabular-nums text-[13px] sm:text-[15px] font-extrabold text-[#F2D27A]">{v}</span>
      <span className="text-[8px] sm:text-[9px] font-bold uppercase text-[#F2D27A]/70">{unit}</span>
    </span>
  );

  let body: React.ReactNode;
  if (diff != null && !live) {
    const { d, h, m, s: sec } = splitCountdown(diff);
    body = (
      <>
        <Timer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-[#0B2E19]" />
        <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-[0.14em] text-[#0B2E19]">Results in</span>
        <span className="flex items-center gap-1">
          {d > 0 && chip(String(d), "d")}
          {chip(pad(h), "h")}
          {chip(pad(m), "m")}
          {d === 0 && chip(pad(sec), "s")}
        </span>
      </>
    );
  } else if (publishing) {
    body = (
      <>
        <Timer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-[#0B2E19] animate-spin" />
        <span className="text-xs sm:text-sm font-extrabold text-[#0B2E19]">Publishing results…</span>
      </>
    );
  } else if (live) {
    body = (
      <>
        <Timer className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-[#0B2E19]" />
        <span className="text-xs sm:text-sm font-extrabold text-[#0B2E19]">Results are <span className="underline underline-offset-2">LIVE</span> — tap to view</span>
      </>
    );
  }

  return (
    <Link
      to="/results"
      aria-label="Results — tap to open"
      className="group relative flex items-center justify-center gap-2 sm:gap-3 px-4 py-1.5 sm:py-2 min-h-[34px] sm:min-h-[40px] no-underline border-b border-[#8F6508]/50 bg-gradient-to-r from-[#A97C0C] via-[#B8860B] to-[#A97C0C] hover:brightness-110 transition-[filter] overflow-hidden"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/30" aria-hidden="true" />
      {body}
      {diff != null && (
        <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 bg-[#0B2E19] animate-pulse" aria-hidden="true" />
      )}
    </Link>
  );
}

// INSTANT NAVIGATION: one delegated listener set on the navbar root covers
// every link inside it. The instant a finger touches or a cursor hovers a
// link, the target page's JS chunk starts downloading — by the time the tap
// completes, navigation is instant even on slow internet.
const navIntentPrefetch = intentPrefetchHandlers();

/* ── Desktop panel link row — clean, roomy list item: tinted icon chip,
      bold label + one-line description, gold active bar and an arrow that
      appears on hover. Plain element (no per-row JS animation) so panels
      open instantly even on modest laptops.
      PERF: wrapped in memo() so a scroll-direction flip (which sets
      `scrolled`/`navHidden` on the parent <nav>) does NOT re-render every
      desktop mega-row. The mega-row's props are stable references so the
      memo boundary holds. ─────────────────────────────────────────────── */
const MegaRow = memo(function MegaRow({ link, active, onNavigate }: {
  link: NavLinkItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = link.icon;
  return (
    <Link
      to={link.to}
      onClick={onNavigate}
      className={`mega-row group relative flex items-center gap-3 rounded-xl px-3 py-2.5 no-underline transition-colors duration-150 ${
        active ? "bg-gold-soft/60 dark:bg-gold/10" : "hover:bg-secondary"
      }`}
    >
      {active && (
        <span
          className="absolute left-0 top-1/2 h-6 w-[3px] rounded-full bg-gold"
          aria-hidden="true"
        />
      )}
      <span
        className={`w-10 h-10 shrink-0 rounded-xl ${link.tint} flex items-center justify-center`}
        aria-hidden="true"
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[14px] font-semibold leading-tight ${active ? "text-primary dark:text-gold" : "text-foreground"}`}>
          {link.label}
        </span>
        <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5 truncate">
          {link.desc}
        </span>
      </span>
      <ArrowRight
        className="mega-row-arrow w-4 h-4 shrink-0 text-gold"
        aria-hidden="true"
      />
    </Link>
  );
});
MegaRow.displayName = "MegaRow";

/* ── Mobile menu rows — clean, professional list (same language as the
      GHSS Ghallanai mobile sheet): plain bold labels, hairline dividers,
      chevron accordions, indented sub-links with a one-line description,
      48px+ tap targets. memo() so opening one group never re-paints the
      others. ─────────────────────────────────────────────────────────── */
const MobileLinkRow = memo(function MobileLinkRow({ link, active, onNavigate }: { link: NavLinkItem; active: boolean; onNavigate: () => void }) {
  return (
    <Link
      to={link.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-12 flex-col justify-center rounded-lg px-3 py-2 no-underline transition-colors duration-150 ${
        active ? "bg-secondary" : "active:bg-secondary hover:bg-secondary"
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gold" aria-hidden="true" />}
      <span className={`text-sm font-semibold leading-tight ${active ? "text-primary" : "text-foreground"}`}>{link.label}</span>
      <span className="mt-0.5 text-xs leading-tight text-muted-foreground">{link.desc}</span>
    </Link>
  );
});

const MobileDirectRow = memo(function MobileDirectRow({ to, label, active, onNavigate }: {
  to: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-12 items-center py-3 text-base font-semibold no-underline transition-colors ${
        active ? "text-primary" : "text-foreground"
      }`}
    >
      {active && <span className="absolute -left-4 top-3 bottom-3 w-[3px] rounded-full bg-gold" aria-hidden="true" />}
      {label}
    </Link>
  );
});

/* After a group finishes expanding, glide the drawer just far enough that
   the revealed list is fully on screen (only scrolls when it is clipped).
   PERF: instant scrollTo — no smooth-scroll animation loop on the main
   thread competing with the accordion transition on low-end phones. */
function revealPanelInDrawer(panel: HTMLElement | null) {
  if (!panel) return;
  const drawer = panel.closest("#mobile-menu") as HTMLElement | null;
  if (!drawer) return;
  const drawerRect = drawer.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  // leave room for the pinned Admission bar at the bottom of the drawer
  const clipped = panelRect.bottom - (drawerRect.bottom - 84) + 8;
  if (clipped > 4) {
    drawer.scrollTop = drawer.scrollTop + clipped;
  }
}

/* ── Mobile accordion group ──────────────────────────────────────────────────
   PERF REWRITE (the "mobile dropdown hang" fix):
   The old implementation animated `gridTemplateRows` with framer-motion —
   a JavaScript loop at 60fps that also forced a LAYOUT recalculation on
   every frame for ~300ms, then a second JS-driven smooth-scroll animation
   on top. On low-end Android phones this stacked up to the "hanging /
   stucking" feel when tapping a navbar dropdown group.

   The panel now expands with a NATIVE CSS grid-template-rows transition:
   • zero JavaScript per frame — the browser engine interpolates on its own;
   • one tiny React state flip per tap (memoised groups, stable callbacks);
   • the drawer reveal is a single instant scroll, not an animation.       */
const MobileAccordionSection = memo(function MobileAccordionSection({
  section,
  pathname,
  isOpen,
  onToggle,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  onNavigate: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const sectionActive =
    section.links.some((l) => l.to === pathname) ||
    (section.id === "results" && pathname === "/roll-no-slip");

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(section.id)}
        aria-expanded={isOpen}
        aria-controls={`m-panel-${section.id}`}
        className="relative flex min-h-12 w-full items-center justify-between py-3 text-left text-base font-semibold touch-manipulation select-none"
      >
        {sectionActive && <span className="absolute -left-4 top-3 bottom-3 w-[3px] rounded-full bg-gold" aria-hidden="true" />}
        <span className={sectionActive ? "text-primary" : "text-foreground"}>{section.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 text-gold" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
      </button>

      {/* CSS-only expand: grid-template-rows 0fr → 1fr. The panel is always
          in the DOM (it is tiny), so no mount/unmount work happens on tap. */}
      <div
        id={`m-panel-${section.id}`}
        className="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={panelRef}
            className={`space-y-0.5 pb-3 pl-1 transition-opacity duration-200 ${isOpen ? "opacity-100" : "opacity-0"}`}
          >
            {section.links.map((link) => (
              <MobileLinkRow key={link.to} link={link} active={pathname === link.to} onNavigate={onNavigate} />
            ))}
            {/* Results group: Roll No. Slip row with its live countdown badge */}
            {section.id === "results" && (
              <Link
                to={rollSlipItem.to}
                onClick={onNavigate}
                aria-current={pathname === rollSlipItem.to ? "page" : undefined}
                className={`relative flex min-h-12 items-center gap-2 rounded-lg px-3 py-2 no-underline transition-colors duration-150 ${
                  pathname === rollSlipItem.to ? "bg-secondary" : "active:bg-secondary hover:bg-secondary"
                }`}
              >
                {pathname === rollSlipItem.to && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gold" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold leading-tight ${pathname === rollSlipItem.to ? "text-primary" : "text-foreground"}`}>
                    {rollSlipItem.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">{rollSlipItem.desc}</span>
                </span>
                <RollSlipCountdown variant="menu-badge" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/* Brand wordmark — Playfair bold, last word in heritage gold ("GHS Babi <Khel>") */
function BrandName({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return <>{name}</>;
  const last = parts.pop();
  return <>{parts.join(" ")} <span className="text-gold">{last}</span></>;
}

/* ═════════════════════════════════════════════════════════════════════════
   NavSearchBox — the desktop inline search, isolated in its own memo.
   Typing updates state INSIDE this component only; the parent Navbar and
   the rest of the nav tree are never re-rendered per keystroke.
   ═════════════════════════════════════════════════════════════════════════ */
const NavSearchBox = memo(function NavSearchBox({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { hits } = useSiteSearch(value, 4);

  // Focus search input when it opens
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
    setValue("");
  }, [open]);

  const go = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    onOpenChange(false);
    setValue("");
  };

  return (
    <div className="relative ml-0.5 flex items-center shrink-0">
      <AnimatePresence mode="wait">
        {open ? (
          /* Expanded search bar */
          <motion.div
            key="search-form"
            initial={{ width: 36, opacity: 0 }}
            animate={{ width: 250, opacity: 1 }}
            exit={{ width: 36, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center overflow-hidden rounded-full border border-border bg-card shadow-card"
            style={{ height: 38 }}
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2.5" />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onOpenChange(false); setValue(""); }
                if (e.key === "Enter") { e.preventDefault(); go(value); }
              }}
              placeholder="Search…"
              aria-label="Search site"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none px-2 py-0"
              style={{ lineHeight: "38px" }}
            />
            {/* Submit / clear */}
            {value ? (
              <button
                type="button"
                aria-label="Go"
                onClick={() => go(value)}
                className="shrink-0 px-2.5 text-xs font-semibold text-azure hover:text-azure/80 transition-colors"
              >
                Go
              </button>
            ) : (
              <button
                type="button"
                aria-label="Close search"
                onClick={() => { onOpenChange(false); setValue(""); }}
                className="shrink-0 px-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        ) : (
          /* Collapsed — just the icon button */
          <motion.button
            key="search-icon"
            type="button"
            aria-label="Open search"
            onClick={() => onOpenChange(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5 h-10 px-2.5 rounded-full text-foreground/70 hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Search className="w-[18px] h-[18px]" />
            <span
              className="hidden 2xl:inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-secondary/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/80"
              aria-hidden="true"
              title="Press Cmd/Ctrl+K to open the command palette"
            >
              <CommandIcon className="w-2.5 h-2.5" />K
            </span>
          </motion.button>
        )}
      </AnimatePresence>
      {open && (
        <NavSearchDropdown
          query={value}
          hits={hits}
          className="w-[320px]"
          onSelect={() => { onOpenChange(false); setValue(""); }}
          onViewAll={() => go(value)}
        />
      )}
    </div>
  );
});

/* ═════════════════════════════════════════════════════════════════════════
   MobileMenu — the whole mobile drawer, isolated in its own memo.
   Owns the accordion open-group state so a tap re-renders the drawer only,
   never the desktop nav, the top bar, or the rest of the page.
   ═════════════════════════════════════════════════════════════════════════ */
const MobileMenu = memo(function MobileMenu({
  open,
  pathname,
  authLoading,
  user,
  isAdmin,
  signOut,
  onNavigate,
}: {
  open: boolean;
  pathname: string;
  authLoading: boolean;
  user: unknown;
  isAdmin: boolean;
  signOut: () => void;
  onNavigate: () => void;
}) {
  const [mobileOpenSection, setMobileOpenSection] = useState<string | null>(null);
  const revealTimer = useRef(0);

  // Stable accordion toggle — handed to every memoised mobile group; its
  // identity never changes, so memoisation actually holds and tapping one
  // group never re-renders the others.
  const toggleMobileSection = useCallback((id: string) => {
    setMobileOpenSection((cur) => (cur === id ? null : id));
    // Reveal the freshly expanded list in the drawer — scheduled to land
    // right after the 300ms CSS transition, as ONE instant scroll (no
    // smooth-scroll animation loop on the main thread).
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => {
      revealPanelInDrawer(document.getElementById(`m-panel-${id}`));
    }, 320);
  }, []);

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  // Reset the accordion whenever the drawer closes (next open starts clean).
  useEffect(() => {
    if (!open) setMobileOpenSection(null);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id="mobile-menu"
          role="navigation"
          aria-label="Mobile navigation"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          // PERF (2026-10 mobile hang fix): `contain: content` tells the
          // browser that layout / paint work inside this drawer never
          // affects the rest of the page, so the engine can skip a lot of
          // the cross-tree reflow / repaint work that an expanding accordion
          // would otherwise trigger. Combined with `overscroll-contain` (which
          // is on the className) this isolates the drawer's scroll and layout
          // completely from the page behind it.
          className="xl:hidden border-t border-border bg-background overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ maxHeight: "calc(100svh - 64px)", WebkitTapHighlightColor: "transparent", contain: "content" }}
        >
          <ul className="px-4 pt-1">
            <li className="border-b border-border/60">
              <MobileDirectRow to="/" label="Home" active={pathname === "/"} onNavigate={onNavigate} />
            </li>
            {NAV_SECTIONS.map((section) => (
              <li key={section.id} className="border-b border-border/60">
                <MobileAccordionSection
                  section={section}
                  pathname={pathname}
                  isOpen={mobileOpenSection === section.id}
                  onToggle={toggleMobileSection}
                  onNavigate={onNavigate}
                />
              </li>
            ))}

            {/* ── Account ── */}
            {!authLoading && (
              user ? (
                <>
                  {isAdmin && (
                    <li className="border-b border-border/60">
                      <Link
                        to="/admin"
                        onClick={onNavigate}
                        className="flex min-h-12 items-center justify-between py-3 text-base font-semibold text-foreground no-underline"
                      >
                        <span className="inline-flex items-center gap-2"><Shield className="h-4 w-4 text-gold" aria-hidden="true" /> Admin Panel</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  )}
                  <li>
                    <button
                      onClick={() => { signOut(); onNavigate(); }}
                      className="flex min-h-12 w-full items-center gap-2 border-none bg-transparent py-3 text-left text-base font-semibold text-destructive cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
                    </button>
                  </li>
                </>
              ) : (
                <li>
                  <Link
                    to="/auth/signin"
                    onClick={onNavigate}
                    className="flex min-h-12 items-center gap-2 py-3 text-base font-semibold text-foreground no-underline"
                  >
                    <LogIn className="h-4 w-4 text-gold" aria-hidden="true" /> Sign In
                  </Link>
                </li>
              )
            )}
          </ul>

          {/* Admission — pinned primary call-to-action */}
          <div className="sticky bottom-0 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Link
              to="/admission"
              onClick={onNavigate}
              className="mx-auto flex h-9 w-full max-w-[16rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-5 text-[13px] font-medium tracking-wide text-primary-foreground no-underline shadow-sm ring-1 ring-inset ring-white/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Apply for Admission
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

const Navbar = () => {
  const [open, setOpen] = useState(false);
  // Desktop mega-menu: which section panel is open (null = none)
  const [openSection, setOpenSection] = useState<string | null>(null);
  // Desktop inline search open state (the typing lives in NavSearchBox)
  const [searchOpen, setSearchOpen] = useState(false);
  const desktopNavRef = useRef<HTMLDivElement>(null);
  const hoverTimers = useRef<{ enter?: number; leave?: number }>({});

  const [scrolled, setScrolled]   = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const location  = useLocation();
  const { data: settings } = useSchoolSettings();
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const isAdmin = profile?.role === "admin";
  // PERF: gate the desktop-only NavSearchBox (and its Supabase queries) so
  // they never mount on mobile. See useIsDesktop docstring above.
  const isDesktop = useIsDesktop();

  useEffect(() => { setLogoFailed(false); }, [settings?.logo_url]);

  // Lock page scroll behind the open mobile menu (menu itself still scrolls).
  // PERF: lock on documentElement (the <html> element) instead of body —
  // toggling `overflow: hidden` on <body> triggers a synchronous layout
  // reflow because the scrollbar width is restored/removed on <body>, which
  // visibly stutters the open/close animation on low-end Android.
  // <html>-level locking avoids that reflow in modern browsers because the
  // scrollbar is part of the viewport, not the documentElement's content box.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open]);
  const prevPathnameRef = useRef(location.pathname);
  useEffect(() => {
    if (prevPathnameRef.current === location.pathname) return;
    prevPathnameRef.current = location.pathname;
    setOpen(false); setSearchOpen(false);
    setOpenSection(null);
  }, [location.pathname]);

  // Close the open mega panel on Escape / click outside the desktop nav,
  // and clear hover timers on unmount.
  useEffect(() => {
    if (!openSection) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenSection(null); };
    const onClick = (e: MouseEvent) => {
      if (desktopNavRef.current && !desktopNavRef.current.contains(e.target as Node)) {
        setOpenSection(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [openSection]);

  useEffect(() => () => {
    window.clearTimeout(hoverTimers.current.enter);
    window.clearTimeout(hoverTimers.current.leave);
  }, []);

  // Hover-intent open/close: tiny delay on enter (no flicker when skimming
  // across the bar), a small grace period on leave (moving into the panel).
  const sectionEnter = useCallback((id: string) => {
    window.clearTimeout(hoverTimers.current.leave);
    window.clearTimeout(hoverTimers.current.enter);
    hoverTimers.current.enter = window.setTimeout(() => setOpenSection(id), 70);
  }, []);
  const sectionLeave = useCallback(() => {
    window.clearTimeout(hoverTimers.current.enter);
    hoverTimers.current.leave = window.setTimeout(() => setOpenSection(null), 180);
  }, []);
  const toggleSection = useCallback((id: string) => {
    window.clearTimeout(hoverTimers.current.enter);
    window.clearTimeout(hoverTimers.current.leave);
    setOpenSection((cur) => (cur === id ? null : id));
  }, []);

  /* ── Scroll handling — ONE rAF-batched listener ──────────────────────────
     PERF REWRITE: the old code attached THREE separate scroll listeners
     (scrolled flag, top-nav hide, bottom-dock hide) each running its own
     state updates and its own last-Y ref — triple work on every scroll
     event, which is exactly when the CPU is busiest painting the page.

     Now: a single passive listener, coalesced to at most one pass per
     animation frame, that derives ALL three states in one go. The top nav
     and the bottom dock hide/reveal together (they always did — they used
     identical logic), driven by the same `navHidden` state. */
  const anyMenuOpen = open || !!openSection || searchOpen;
  const navHiddenRef = useRef(false);
  const scrolledRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const scrollRafRef = useRef(0);
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    lastScrollYRef.current = window.scrollY;
    const NAV_HEIGHT = 64; // matches h-16 top bar; hiding starts only past it

    const onScrollPass = () => {
      scrollRafRef.current = 0;
      const y = window.scrollY;
      const last = lastScrollYRef.current;
      const delta = y - last;

      // scrolled state (shadow/bg of the bar) — write once, let React bail
      // out when the value has not actually flipped.
      const nextScrolled = y > 10;
      if (nextScrolled !== scrolledRef.current) {
        scrolledRef.current = nextScrolled;
        setScrolled(nextScrolled);
      }

      // direction-aware retract/reveal — top nav AND bottom dock together.
      let nextHidden: boolean;
      if (anyMenuOpenRef.current) {
        nextHidden = false;
      } else if (y <= NAV_HEIGHT) {
        nextHidden = false;
      } else if (y + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        // at the very bottom: keep the dock out of the way of the footer copyright line
        nextHidden = true;
      } else if (delta > 4) {
        nextHidden = true;
      } else if (delta < -4) {
        nextHidden = false;
      } else {
        nextHidden = navHiddenRef.current;
      }
      lastScrollYRef.current = y;
      if (nextHidden !== navHiddenRef.current) {
        navHiddenRef.current = nextHidden;
        setNavHidden(nextHidden);
      }
    };

    const onScroll = () => {
      if (scrollRafRef.current) return; // one pass per frame at most
      scrollRafRef.current = requestAnimationFrame(onScrollPass);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the rAF closure in sync with menu-open state without re-binding
  // the listener (a ref avoids tearing down/reattaching on every open).
  const anyMenuOpenRef = useRef(anyMenuOpen);
  useEffect(() => { anyMenuOpenRef.current = anyMenuOpen; }, [anyMenuOpen]);

  // Hide the global bottom bar on routes that have their own dock, e.g.
  // chapter pages already render an X-style FAB row (AI / Timer / Listen
  // / Cards / Notes / Rank), so two docks would overlap. Same for any
  // future sub-route that wants the screen to itself.
  const hideGlobalBottomBar = useMemo(() => {
    const p = location.pathname;
    return /^\/notes\/[^/]+\/[^/]+/.test(p); // /notes/:subject/:chapter
  }, [location.pathname]);

  const closeAllMenus = useCallback(() => {
    setOpen(false);
    setOpenSection(null);
  }, []);

  /* Shared styling pieces for the modern link treatment:
     — animated gold underline that grows from the centre (.nav-underline)
     — soft gradient pill behind hover/active (.nav-link::before)
     — glowing gold dot on the active link (.nav-dot)
     All defined once in src/index.css, driven by data-active. */
  const desktopLinkClass = (active: boolean) =>
    `nav-link inline-flex items-center gap-1 px-2.5 2xl:px-3.5 py-2 rounded-full text-[13px] 2xl:text-sm font-semibold whitespace-nowrap transition-colors duration-200 ${
      active ? "text-primary dark:text-gold" : "text-foreground/75 hover:text-foreground"
    }`;

  // Spotlight hairline: track cursor X across the nav container and expose
  // it as a CSS var; the glow itself is rendered by .nav-spotlight-line in
  // src/index.css (radial-gradient centred on --mouse-x).
  const navRafRef = useRef(0);
  const handleNavMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // One style write per animation frame at most (not per mouse event).
    if (navRafRef.current) return;
    const el = e.currentTarget;
    const clientX = e.clientX;
    navRafRef.current = requestAnimationFrame(() => {
      navRafRef.current = 0;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${clientX - rect.left}px`);
    });
  }, []);

  // ⚠️ CONTAINING-BLOCK RULE (why the dock below is NOT inside <nav>):
  // the <nav> toggles Tailwind translate-y-0 / -translate-y-full (hide on
  // scroll). In Tailwind v3 translate-y-0 still emits a non-none CSS
  // transform, and ANY ancestor with a non-none transform becomes the
  // containing block for position:fixed descendants — so a fixed
  // bottom-0 dock inside <nav> was pinned to the BOTTOM OF THE 64px
  // NAVBAR (appearing at the top of the screen on mobile) instead of the
  // bottom of the viewport. Keep the dock a SIBLING of <nav>, and never
  // move it back inside an element that carries a transform/filter class.
  return (
    <>
    <nav
      {...navIntentPrefetch}
      onMouseMove={handleNavMouseMove}
      className={`nav-glass-edges sticky top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "bg-background/95 border-border shadow-card"
          : "bg-background border-border/80"
      } ${navHidden ? "-translate-y-full" : "translate-y-0"}`}
      style={{ transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), background-color 300ms, box-shadow 300ms, border-color 300ms" }}
    >
      {/* Golden results strip — above the school name (mobile / tablet) */}
      <ResultsTopStrip />

      {/* Red Roll No. Slip countdown strip — also ABOVE the school name
          (mobile / tablet; desktop uses the chip) — tap opens /roll-no-slip */}
      <RollSlipCountdown variant="strip" />

      {/* ── Top bar ── */}
      <div className="container mx-auto flex items-center justify-between gap-3 2xl:gap-6 h-16 px-4 lg:px-6">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 2xl:gap-4 shrink-0 no-underline">
          <HexagonLogoFrame size={38}>
            {settings?.logo_url && !logoFailed ? (
              <img
                src={optimizedCloudinaryUrl(settings.logo_url, { width: 96 }) || safeMediaUrl(settings.logo_url)!}
                alt={`${settings?.school_name || "GHS Babi Khel"} logo`}
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <GraduationCap className="w-4 h-4 text-white" />
            )}
          </HexagonLogoFrame>
          <div>
            <span className="font-display font-bold text-xl sm:text-2xl text-foreground leading-tight block tracking-tight whitespace-nowrap">
              <BrandName name={settings?.school_name || "GHS Babi Khel"} />
            </span>
            <span className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.2em] 2xl:tracking-[0.25em] text-muted-foreground leading-none whitespace-nowrap">
              High School · Mohmand
            </span>
          </div>
        </Link>

        {/* ── Desktop nav: direct links + grouped mega drop-downs ── */}
        <div className="hidden xl:flex flex-1 min-w-0 items-center justify-center gap-0.5 2xl:gap-1" ref={desktopNavRef}>

          {/* Home — direct link */}
          <Link
            to="/"
            data-active={location.pathname === "/" || undefined}
            className={desktopLinkClass(location.pathname === "/")}
          >
            Home
            <span className="nav-underline" aria-hidden="true" />
          </Link>

          {/* Grouped sections with mega panels */}
          {NAV_SECTIONS.map((section) => {
            const SectionIcon = section.icon;
            const sectionActive =
              section.links.some((l) => l.to === location.pathname) ||
              (section.id === "results" && location.pathname === "/roll-no-slip");
            const isOpen = openSection === section.id;
            return (
              <div
                key={section.id}
                className="relative"
                onMouseEnter={() => sectionEnter(section.id)}
                onMouseLeave={sectionLeave}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isOpen}
                  aria-haspopup="true"
                  data-active={sectionActive || isOpen || undefined}
                  className={desktopLinkClass(sectionActive)}
                >
                  {section.label}
                  <ChevronDown
                    className={`w-3.5 h-3.5 opacity-70 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="nav-underline" aria-hidden="true" />
                </button>

                {/* Panel — premium dropdown: caret notch, icon + title header,
                    roomy rows. Opens with one quick fade (no scale / per-row
                    animation) so it feels instant. */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 pt-3 z-50">
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="w-[344px] max-w-[calc(100vw-2rem)]"
                      >
                        <div className="relative rounded-2xl border border-border bg-card shadow-[0_22px_50px_-14px_rgba(8,32,18,0.30)] dark:shadow-[0_22px_50px_-14px_rgba(0,0,0,0.65)]">
                          {/* caret notch pointing at the trigger — positioned
                              without Tailwind translate (the global Android
                              transform fix would neutralise it here) */}
                          <span
                            className="absolute top-[6px] left-[calc(50%-6px)] w-3 h-3 rotate-45 bg-card border-l border-t border-border"
                            aria-hidden="true"
                          />
                          <div className="relative overflow-hidden rounded-2xl">
                            {/* gold top accent */}
                            <div className="absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-gold/0 via-gold to-gold/0" aria-hidden="true" />

                            {/* header: icon chip + section title + tagline */}
                            <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/70 bg-secondary/40">
                              <span className={`w-9 h-9 shrink-0 rounded-xl ${section.tint} flex items-center justify-center`} aria-hidden="true">
                                <SectionIcon className="w-[18px] h-[18px]" />
                              </span>
                              <div className="min-w-0">
                                <p className="font-display text-[15px] font-semibold leading-tight text-foreground truncate">
                                  {section.label}
                                </p>
                                <p className="text-[11.5px] leading-snug text-muted-foreground mt-0.5 truncate">
                                  {section.tagline}
                                </p>
                              </div>
                            </div>

                            {/* link rows */}
                            <div className="p-2 space-y-0.5">
                              {section.links.map((link) => (
                                <MegaRow
                                  key={link.to}
                                  link={link}
                                  active={location.pathname === link.to}
                                  onNavigate={() => setOpenSection(null)}
                                />
                              ))}
                            </div>

                            {/* Results panel: Roll No. Slip spotlight card with
                                the live countdown badge */}
                            {section.id === "results" && (
                              <div className="px-2 pb-2">
                                <Link
                                  to={rollSlipItem.to}
                                  onClick={() => setOpenSection(null)}
                                  className="group relative flex items-center gap-3 overflow-hidden rounded-xl bg-gold-soft/50 hover:bg-gold-soft dark:bg-gold/10 dark:hover:bg-gold/15 text-foreground px-3 py-2.5 no-underline border border-gold/30 transition-colors duration-150"
                                >
                                  <span className={`relative w-10 h-10 rounded-xl ${rollSlipItem.tint} flex items-center justify-center shrink-0`} aria-hidden="true">
                                    <Hash className="w-[18px] h-[18px]" />
                                  </span>
                                  <span className="relative flex-1 min-w-0">
                                    <span className="block text-[14px] font-semibold leading-tight text-foreground">{rollSlipItem.label}</span>
                                    <span className="block text-[12px] text-muted-foreground leading-snug mt-0.5 truncate">{rollSlipItem.desc}</span>
                                  </span>
                                  <RollSlipCountdown variant="menu-badge" />
                                  <ArrowRight className="mega-row-arrow w-4 h-4 shrink-0 text-gold" aria-hidden="true" />
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}

          {/* Admission — direct link */}
          <Link
            to="/admission"
            data-active={location.pathname === "/admission" || undefined}
            className={desktopLinkClass(location.pathname === "/admission")}
          >
            Admission
            <span className="nav-underline" aria-hidden="true" />
          </Link>

          {/* ── Inline Search (typing isolated inside NavSearchBox) ──
              PERF (2026-10 mobile hang fix): gated by `isDesktop` so the
              component (and its 3 Supabase queries via useSiteSearch) only
              mounts on viewports wide enough to show the desktop nav. On
              mobile this previously mounted invisibly inside `hidden xl:flex`
              and fired notices+news+teachers queries on every page load,
              competing with the page's own data for network + main thread. */}
          {isDesktop && <NavSearchBox open={searchOpen} onOpenChange={setSearchOpen} />}
        </div>

        {/* Desktop right-side controls */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {/* Live countdown on the Roll No. Slip link (desktop top bar) */}
          <RollSlipCountdown variant="chip" />
          <span className="hidden xl:block h-6 w-px bg-border" aria-hidden="true" />
          {!authLoading && (
            user ? (
              <>
                <NotificationBell />
                <ThemeSwitcher />
                {isAdmin && (
                  <Link
                    to="/admin"
                    aria-label="Admin panel"
                    title="Admin panel"
                    className="inline-flex items-center justify-center gap-1.5 h-10 w-10 2xl:w-auto 2xl:px-4 rounded-full text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity no-underline whitespace-nowrap"
                  >
                    <Shield className="w-4 h-4" /> <span className="hidden 2xl:inline">Admin</span>
                  </Link>
                )}
                <button
                  onClick={signOut}
                  aria-label="Sign out"
                  className="inline-flex items-center gap-1.5 h-10 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden 2xl:inline">Sign Out</span>
                </button>
              </>
            ) : (
              <>
                <ThemeSwitcher />
                <Link
                  to="/auth/signin"
                  className="inline-flex items-center gap-2 h-10 px-4 2xl:px-5 rounded-full text-sm font-semibold bg-primary text-primary-foreground shadow-card hover:opacity-90 transition-opacity no-underline whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4" /> Sign In
                </Link>
              </>
            )
          )}
        </div>

        {/* Mobile: Theme toggle + Hamburger — outside the drawer.
            The search icon now opens the full ⌘K command palette (fuzzy
            search + quick actions + recents) instead of the old inline
            search bar, so mobile gets the exact same experience as
            desktop's Cmd/Ctrl+K. */}
        <div className="xl:hidden flex items-center gap-0.5 shrink-0 ml-2">
          <ThemeToggleButton />
          <button
            onClick={() => { setSearchOpen(false); setOpen(!open); }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-secondary transition-colors"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* subtle gold hairline glowing along the navbar's bottom edge — base
          wash stays static so the line is never fully invisible, and the
          reactive spotlight (nav-spotlight-line, driven by --mouse-x from
          handleNavMouseMove above) brightens only under the cursor */}
      <div className="pointer-events-none absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" aria-hidden="true" />
      <div className="nav-spotlight-line pointer-events-none absolute bottom-0 inset-x-0 h-px" aria-hidden="true" />

      {/* ════════════ MOBILE MENU — clean full-width sheet ════════════
          Plain list with hairline dividers + CSS accordions; Admission
          is pinned as the primary call-to-action at the bottom (safe-area
          aware). Theme control lives in the header as a moon / sun button.
          Isolated in <MobileMenu> — see its perf notes. */}
      <MobileMenu
        open={open}
        pathname={location.pathname}
        authLoading={authLoading}
        user={user}
        isAdmin={isAdmin}
        signOut={signOut}
        onNavigate={closeAllMenus}
      />
    </nav>
    {/* ── Mobile bottom dock (X-style, global) ─────────────────────────────
        5 evenly-spaced icon buttons fixed to the bottom of the viewport on
        screens < lg. Mirrors the X (Twitter) bottom bar: icons only, no
        labels, hides on scroll down, reveals on scroll up. Hidden on the
        chapter page because that page already has its own dock.

        Rendered as a SIBLING of <nav> (outside the fragment's nav element)
        — see the CONTAINING-BLOCK RULE comment above: a position:fixed
        element must not live inside the transformed <nav>, or "bottom: 0"
        pins it to the navbar instead of the viewport. */}
    {!hideGlobalBottomBar && (
      <div
        className={`dock-bar lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-card/95 border-t border-border transition-transform duration-300 ease-out ${
          navHidden ? "translate-y-full" : "translate-y-0"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
          <div className="flex items-stretch justify-around">
            {/* Home */}
            <Link
              to="/"
              aria-label="Home"
              data-active={location.pathname === "/" || undefined}
              onClick={closeAllMenus}
              className={`dock-item flex-1 flex flex-col items-center justify-center py-3 ${
                location.pathname === "/" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Home className="w-6 h-6" fill={location.pathname === "/" ? "currentColor" : "none"} />
            </Link>

            {/* Search — opens the ⌘K command palette (the working mobile
                search UI on this site; the old setSearchOpen only rendered
                inside the desktop-only container, so it did nothing here). */}
            <button
              type="button"
              aria-label="Search"
              onClick={() => { closeAllMenus(); openCommandPalette(); }}
              className="dock-item flex-1 flex flex-col items-center justify-center py-3 text-muted-foreground"
            >
              <Search className="w-6 h-6" />
            </button>

            {/* Results */}
            <Link
              to="/results"
              aria-label="Results"
              data-active={location.pathname === "/results" || undefined}
              onClick={closeAllMenus}
              className={`dock-item flex-1 flex flex-col items-center justify-center py-3 ${
                location.pathname === "/results" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Trophy className="w-6 h-6" fill={location.pathname === "/results" ? "currentColor" : "none"} />
            </Link>

            {/* Notifications — opens the existing NotificationBell panel */}
            <NotificationBell variant="bottom-bar" />

            {/* Admission */}
            <Link
              to="/admission"
              aria-label="Admission"
              data-active={location.pathname === "/admission" || undefined}
              onClick={closeAllMenus}
              className={`dock-item flex-1 flex flex-col items-center justify-center py-3 ${
                location.pathname === "/admission" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <FileSignature className="w-6 h-6" fill={location.pathname === "/admission" ? "currentColor" : "none"} />
            </Link>
          </div>
      </div>
    )}
    </>
  );
};

export default Navbar;
