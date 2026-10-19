import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bell, Check, CheckCheck, Trash2,
  Newspaper, Megaphone, BarChart3, Hash, Wallet, IdCard,
  CalendarDays, BookMarked, Video, MonitorPlay, GraduationCap,
  ClipboardList, FileText, UserPlus, Upload, HelpCircle,
  Mail, MessageSquareText, Flag, LayoutGrid, BellRing, BellOff, Clock, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { subscribeNotificationsRealtime } from "@/lib/notificationsRealtime";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { AnimatePresence, m } from "framer-motion";

// ─── Notification type ──────────────────────────────────────────────────────

interface NotificationRow {
  id: string;
  audience: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  actor_id: string | null;
  created_at: string;
}

// ─── Icon + color map per notification type ─────────────────────────────────
// Centralized so every type renders consistently. New types added in the SQL
// migration will fall back to the HelpCircle icon + neutral color.

const TYPE_META: Record<string, { icon: any; color: string; bg: string }> = {
  notice:                { icon: Megaphone,    color: "text-red-500",        bg: "bg-red-500/10"        },
  news:                  { icon: Newspaper,    color: "text-blue-500",       bg: "bg-blue-500/10"       },
  result:                { icon: BarChart3,    color: "text-emerald-500",    bg: "bg-emerald-500/10"    },
  exam_roll:             { icon: Hash,         color: "text-purple-500",     bg: "bg-purple-500/10"     },
  fee:                   { icon: Wallet,       color: "text-amber-500",      bg: "bg-amber-500/10"      },
  id_card:               { icon: IdCard,       color: "text-indigo-500",     bg: "bg-indigo-500/10"     },
  timetable:             { icon: CalendarDays, color: "text-cyan-500",       bg: "bg-cyan-500/10"       },
  event:                 { icon: CalendarDays, color: "text-pink-500",       bg: "bg-pink-500/10"       },
  library:               { icon: BookMarked,   color: "text-orange-500",     bg: "bg-orange-500/10"     },
  video:                 { icon: Video,        color: "text-rose-500",       bg: "bg-rose-500/10"       },
  online_class:          { icon: MonitorPlay,  color: "text-teal-500",       bg: "bg-teal-500/10"       },
  admission_open:        { icon: GraduationCap,color: "text-green-500",      bg: "bg-green-500/10"      },
  homework:              { icon: ClipboardList,color: "text-sky-500",        bg: "bg-sky-500/10"        },
  admission_application: { icon: UserPlus,     color: "text-violet-500",     bg: "bg-violet-500/10"     },
  admission_doc:         { icon: Upload,       color: "text-fuchsia-500",    bg: "bg-fuchsia-500/10"    },
  contact_message:       { icon: Mail,         color: "text-blue-600",       bg: "bg-blue-600/10"       },
  chapter_question:      { icon: MessageSquareText, color: "text-stone-500",  bg: "bg-stone-500/10"      },
  mistake_report:        { icon: Flag,         color: "text-red-500",        bg: "bg-red-500/10"        },
  exam_seating:          { icon: LayoutGrid,   color: "text-sky-500",        bg: "bg-sky-500/10"        },
  default:               { icon: FileText,     color: "text-muted-foreground", bg: "bg-muted"           },
};

const metaFor = (type: string) => TYPE_META[type] ?? TYPE_META.default;

// ─── Component ──────────────────────────────────────────────────────────────

interface NotificationBellProps {
  /**
   * Visual placement:
   *   - "header"     → desktop header style (default), square hover pad
   *   - "bottom-bar" → flat icon-only button for the mobile bottom dock
   */
  variant?: "header" | "bottom-bar";
}

const NotificationBell = ({ variant = "header" }: NotificationBellProps = {}) => {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Fetch notifications ──────────────────────────────────────────────────
  // RLS on the notifications table ensures the user only sees rows addressed
  // to them (audience = 'all' / 'admin' / 'students' / 'class:X' / 'user:me').
  const { data: notifications = [] } = useQuery<NotificationRow[]>({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("id, audience, type, title, body, link, is_read, actor_id, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) {
        // Most likely the table doesn't exist yet (migration 013 not applied).
        // Fail silently — the bell just shows "No notifications" instead of
        // crashing the whole navbar.
        console.warn("[NotificationBell] fetch error:", error.message);
        return [];
      }

      // Exclude notifications this user has dismissed (migration 014).
      // A shared/broadcast row can't be deleted outright — dismissing it
      // hides it only for the current user via notification_dismissals.
      const { data: dismissed, error: dismissError } = await supabase
        .from("notification_dismissals")
        .select("notification_id")
        .eq("user_id", user.id);
      if (dismissError) {
        console.warn("[NotificationBell] dismissals fetch error:", dismissError.message);
        return (data ?? []) as NotificationRow[];
      }
      const dismissedIds = new Set((dismissed ?? []).map((d) => d.notification_id));
      return ((data ?? []) as NotificationRow[]).filter((n) => !dismissedIds.has(n.id));
    },
    enabled: !!user,
    staleTime: 30_000,        // 30s — re-fetch when tab refocuses
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
  });

  // ── Realtime: instant update when a new notification is inserted ─────────
  // This is the "Facebook-style" behavior — the bell pulses the moment admin
  // publishes something, no polling required.
  //
  // CRASH FIX: this component is mounted TWICE (desktop header bell + mobile
  // bottom-dock bell). Each instance used to run its own
  // supabase.channel("live-notifications").on(...).subscribe(); the second
  // instance's .on("postgres_changes") hit an already-subscribed channel and
  // THREW "cannot add postgres_changes callbacks for realtime:live-notifications
  // after subscribe()" — tearing the whole route into the error screen for
  // every signed-in visitor ~2–3 s after load (the moment auth resolved).
  // All bells now share ONE ref-counted channel via notificationsRealtime.ts,
  // and the effect depends on the stable user?.id instead of the user object
  // (whose identity changes on every auth-state emission).
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    return subscribeNotificationsRealtime(({ kind }) => {
      qc.invalidateQueries({ queryKey: ["notifications", userId] });
      if (kind === "insert") {
        setPulse(true);
        window.setTimeout(() => setPulse(false), 3000);
      }
    });
  }, [userId, qc]);

  // ── Mark-all-read mutation ───────────────────────────────────────────────
  const markAllReadMut = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  // ── Mark-one-read mutation ───────────────────────────────────────────────
  const markOneReadMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  // ── Delete (dismiss) one notification ────────────────────────────────────
  // Uses the dismiss_notification RPC — this hides it for the current user
  // only, without removing it for other users who share the same broadcast row.
  const deleteOneMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("dismiss_notification", { p_notification_id: id });
      if (error) throw error;
      return id;
    },
    // Optimistic update: remove it from the cached list immediately so the
    // row disappears the instant the trash icon is clicked, instead of
    // waiting on a refetch (and instead of silently doing nothing on error,
    // which was the original bug — the RPC didn't exist so this never fired).
    onSuccess: (id) => {
      qc.setQueryData<NotificationRow[]>(["notifications", user?.id], (old) =>
        (old ?? []).filter((n) => n.id !== id)
      );
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
    onError: (err: any) => {
      console.error("[NotificationBell] dismiss failed:", err?.message ?? err);
    },
  });

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);

  const handleNotificationClick = (n: NotificationRow) => {
    if (!n.is_read) markOneReadMut.mutate(n.id);
    setOpen(false);
    if (!n.link) return;
    // mailto: / tel: / external http(s) links must NOT go through the SPA
    // router — open them directly (e.g. mailto opens the device's mail app).
    if (/^(mailto:|tel:|https?:\/\/)/i.test(n.link)) {
      window.location.href = n.link;
    } else {
      navigate(n.link);
    }
  };

  const markAllRead = () => {
    markAllReadMut.mutate(unreadIds);
    setOpen(false);
  };


  // ── Close on outside click (desktop dropdown only — the mobile sheet has
  //     its own backdrop and renders in a portal, outside this ref) ───────
  useEffect(() => {
    if (variant !== "header") return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [variant]);

  // ── Escape closes; mobile sheet locks page scroll while open ─────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    let prevOverflow = "";
    if (variant === "bottom-bar") {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      if (variant === "bottom-bar") document.body.style.overflow = prevOverflow;
    };
  }, [open, variant]);

  useEffect(() => { if (!open) { setFilter("all"); setDragY(0); } }, [open]);

  // ── Swipe-down-to-close on the sheet's handle / header ───────────────────
  const onDragStart = (e: React.TouchEvent) => { dragStartRef.current = e.touches[0].clientY; };
  const onDragMove = (e: React.TouchEvent) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStartRef.current));
  };
  const onDragEnd = () => {
    if (dragY > 110) setOpen(false);
    setDragY(0);
    dragStartRef.current = null;
  };

  // ── Filter + group by day ────────────────────────────────────────────────
  const visible = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications),
    [notifications, filter]
  );
  const groups = useMemo(() => {
    const g: { label: string; items: NotificationRow[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Earlier", items: [] },
    ];
    for (const n of visible) {
      const d = new Date(n.created_at);
      (isToday(d) ? g[0] : isYesterday(d) ? g[1] : g[2]).items.push(n);
    }
    return g.filter((x) => x.items.length > 0);
  }, [visible]);

  const isSheet = variant === "bottom-bar";

  // ── Shared panel body (header, tabs, grouped list, footer) ───────────────
  const panelBody = (
    <>
      {/* Header */}
      <div
        className="relative px-4 pt-2 pb-3 border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-gold/15"
        onTouchStart={isSheet ? onDragStart : undefined}
        onTouchMove={isSheet ? onDragMove : undefined}
        onTouchEnd={isSheet ? onDragEnd : undefined}
      >
        {isSheet && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />}
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 shrink-0 rounded-2xl gradient-hero text-gold flex items-center justify-center shadow-sm">
            <BellRing className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-heading font-bold text-base text-foreground leading-tight">Notifications</h2>
            <p className="text-[11px] text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markAllReadMut.isPending}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 h-8 text-[11px] font-semibold text-foreground hover:bg-gold/20 disabled:opacity-50 transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Read all
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close notifications"
            className={`${isSheet ? "" : "sm:hidden"} shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented filter */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-secondary/70 p-1" role="tablist" aria-label="Filter notifications">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`h-8 rounded-full text-xs font-semibold transition-all ${
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className={`${isSheet ? "flex-1 min-h-0" : "max-h-96"} overflow-y-auto overscroll-contain py-2`}>
        {groups.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto mb-3 w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
              <BellOff className="w-6 h-6 text-muted-foreground/60" />
            </span>
            <p className="text-sm font-semibold text-foreground">
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === "unread" ? "Everything has been read." : "Updates appear here the moment they're published."}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-muted-foreground/80 tracking-wide">{group.label}</p>
              {group.items.map((n) => {
                const meta = metaFor(n.type);
                const Icon = meta.icon;
                const isUnread = !n.is_read;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleNotificationClick(n)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNotificationClick(n); } }}
                    className={`relative mx-2 my-1 rounded-2xl pl-3 pr-1.5 py-3 cursor-pointer flex items-start gap-3 transition-colors active:scale-[0.99] ${
                      isUnread ? "bg-gold/10 hover:bg-gold/15 ring-1 ring-gold/25" : "hover:bg-secondary/60"
                    }`}
                  >
                    {isUnread && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gold" aria-hidden="true" />}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                      <Icon className={`w-[18px] h-[18px] ${meta.color}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13.5px] leading-snug line-clamp-2 ${isUnread ? "font-semibold text-foreground" : "text-foreground/85"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground/70">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteOneMut.mutate(n.id); }}
                      disabled={deleteOneMut.isPending}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                      aria-label="Delete notification"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <button
          onClick={() => {
            setOpen(false);
            // User Dashboard removed — only admin accounts remain,
            // so this always goes to Admin Overview.
            navigate("/admin");
          }}
          className="w-full h-11 shrink-0 text-center text-xs font-semibold text-primary hover:bg-primary/5 border-t border-border transition-colors"
        >
          View all in dashboard
        </button>
      )}
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={ref} className={isSheet ? "relative flex-1 flex" : "relative flex items-center"}>
      <button
        onClick={() => setOpen(!open)}
        className={
          isSheet
            ? `dock-item flex-1 flex flex-col items-center justify-center py-3 relative ${open ? "text-primary" : "text-muted-foreground"}`
            : "p-2 rounded-lg hover:bg-secondary text-muted-foreground relative transition-colors inline-flex items-center justify-center"
        }
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {isSheet && open && (
          <span className="absolute top-0 left-1/2 -ml-[14px] w-7 h-[3px] rounded-b bg-gold pointer-events-none" aria-hidden="true" />
        )}
        <span className="relative inline-flex items-center justify-center leading-none">
          {unreadCount > 0 ? (
            <BellRing
              className={`${isSheet ? "w-[22px] h-[22px]" : "w-5 h-5"} ${pulse ? "animate-bounce text-gold-strong" : ""} transition-colors`}
              fill={isSheet && open ? "currentColor" : "none"}
            />
          ) : (
            <Bell
              className={`${isSheet ? "w-[22px] h-[22px]" : "w-5 h-5"} transition-colors`}
              fill={isSheet && open ? "currentColor" : "none"}
            />
          )}
          {unreadCount > 0 && (
            <>
              {pulse && (
                <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] bg-gold/60 rounded-full animate-ping" />
              )}
              <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-gold to-gold-strong text-white text-[10px] font-extrabold leading-none flex items-center justify-center ring-2 ring-card shadow">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            </>
          )}
        </span>
      </button>

      {/* Desktop / header dropdown */}
      {!isSheet && (
        <AnimatePresence>
          {open && (
            <m.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem] bg-card border border-gold/30 rounded-2xl shadow-elevated z-50 overflow-hidden flex flex-col"
            >
              {panelBody}
            </m.div>
          )}
        </AnimatePresence>
      )}

      {/* Mobile bottom-dock sheet — portalled to <body> so the dock's
          hide-on-scroll transform can't act as its containing block. */}
      {isSheet &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <m.div
                  key="notif-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]"
                  onClick={() => setOpen(false)}
                  aria-hidden="true"
                />
                <m.div
                  key="notif-sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Notifications"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                  className="fixed inset-x-0 bottom-0 z-[71]"
                >
                  <div
                    className="flex flex-col max-h-[82vh] rounded-t-[28px] bg-card border-t border-gold/40 shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.55)] overflow-hidden"
                    style={{
                      transform: dragY ? `translateY(${dragY}px)` : undefined,
                      transition: dragStartRef.current === null ? "transform 0.2s ease" : "none",
                      paddingBottom: "env(safe-area-inset-bottom, 0px)",
                    }}
                  >
                    {panelBody}
                  </div>
                </m.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};

export default NotificationBell;
