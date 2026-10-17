/**
 * NotificationsPanel.tsx — GHS Babi Khel
 * -----------------------------------------------------------------------------
 * Full-page notifications feed for the Admin and User dashboards.
 *
 * Renders a chronological list of all notifications visible to the current
 * user (filtered by RLS on the `notifications` table), grouped by today /
 * earlier, with:
 *   - colored type icons (same map as NotificationBell)
 *   - mark-as-read on click
 *   - "Mark all as read" button
 *   - filter chips: All / Unread / Mentions
 *   - empty state with helpful messaging
 *   - live updates via Supabase Realtime (new notifications appear instantly)
 *
 * The same component is used in both dashboards — the RLS policy automatically
 * shows admins everything, students only their addressed notifications.
 * -----------------------------------------------------------------------------
 */
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { subscribeNotificationsRealtime } from "@/lib/notificationsRealtime";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck, BellOff, Filter, Trash2, Square, CheckSquare, X } from "lucide-react";
import toast from "react-hot-toast";

// Reuse the same icon map as NotificationBell (kept in sync).
const TYPE_META: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  notice:                { icon: Megaphone,    color: "text-red-500",        bg: "bg-red-500/10",        label: "Notice"         },
  news:                  { icon: Newspaper,    color: "text-blue-500",       bg: "bg-blue-500/10",       label: "News"           },
  result:                { icon: BarChart3,    color: "text-emerald-500",    bg: "bg-emerald-500/10",    label: "Result"         },
  exam_roll:             { icon: Hash,         color: "text-purple-500",     bg: "bg-purple-500/10",     label: "Exam Roll"      },
  fee:                   { icon: Wallet,       color: "text-amber-500",      bg: "bg-amber-500/10",      label: "Fee"            },
  id_card:               { icon: IdCard,       color: "text-indigo-500",     bg: "bg-indigo-500/10",     label: "ID Card"        },
  timetable:             { icon: CalendarDays, color: "text-cyan-500",       bg: "bg-cyan-500/10",       label: "Timetable"      },
  event:                 { icon: CalendarDays, color: "text-pink-500",       bg: "bg-pink-500/10",       label: "Event"          },
  library:               { icon: BookMarked,   color: "text-orange-500",     bg: "bg-orange-500/10",     label: "Library"        },
  video:                 { icon: Video,        color: "text-rose-500",       bg: "bg-rose-500/10",       label: "Video"          },
  online_class:          { icon: MonitorPlay,  color: "text-teal-500",       bg: "bg-teal-500/10",       label: "Online Class"   },
  admission_open:        { icon: GraduationCap,color: "text-green-500",      bg: "bg-green-500/10",      label: "Admissions"     },
  achievement:           { icon: Trophy,       color: "text-yellow-500",     bg: "bg-yellow-500/10",     label: "Achievement"    },
  homework:              { icon: ClipboardList,color: "text-sky-500",        bg: "bg-sky-500/10",        label: "Homework"       },
  admission_application: { icon: UserPlus,     color: "text-violet-500",     bg: "bg-violet-500/10",     label: "Application"    },
  admission_doc:         { icon: Upload,       color: "text-fuchsia-500",    bg: "bg-fuchsia-500/10",    label: "Document"       },
  notes_chapter:         { icon: BookOpen,     color: "text-lime-500",       bg: "bg-lime-500/10",       label: "Notes"          },
  notes_feedback:        { icon: MessageSquare,color: "text-stone-500",      bg: "bg-stone-500/10",      label: "Feedback"       },
  chapter_question:      { icon: MessageSquare,color: "text-stone-500",      bg: "bg-stone-500/10",      label: "Question"       },
  mistake_report:        { icon: Flag,         color: "text-red-500",        bg: "bg-red-500/10",        label: "Mistake"        },
  contact_message:       { icon: Mail,         color: "text-blue-600",       bg: "bg-blue-600/10",       label: "Contact"        },
  gallery:               { icon: Image,        color: "text-pink-500",       bg: "bg-pink-500/10",       label: "Gallery"        },
  default:               { icon: FileText,     color: "text-muted-foreground", bg: "bg-muted",           label: "Update"         },
};

// Import the icon components used in the map above.
import {
  Megaphone, Newspaper, BarChart3, Hash, Wallet, IdCard,
  CalendarDays, BookMarked, Video, MonitorPlay, GraduationCap,
  Trophy, ClipboardList, UserPlus, Upload, BookOpen, MessageSquare,
  Image, FileText, Mail, Flag,
} from "lucide-react";

const metaFor = (type: string) => TYPE_META[type] ?? TYPE_META.default;

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

type FilterKey = "all" | "unread";

interface Props {
  /** Optional title shown above the feed. Defaults to "Notifications". */
  title?: string;
  /** Optional subtitle shown below the title. */
  subtitle?: string;
}

const PAGE_SIZE = 30;

export default function NotificationsPanel({ title = "Notifications", subtitle }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Fetch notifications ──────────────────────────────────────────────────
  const { data: notifications = [], isLoading } = useQuery<NotificationRow[]>({
    queryKey: ["notifications-feed", user?.id, filter],
    queryFn: async () => {
      if (!user) return [];
      let q = supabase
        .from("notifications")
        .select("id, audience, type, title, body, link, is_read, actor_id, created_at")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (filter === "unread") q = q.eq("is_read", false);
      const { data, error } = await q;
      if (error) {
        console.warn("[NotificationsPanel] fetch error:", error.message);
        return [];
      }
      return (data ?? []) as NotificationRow[];
    },
    enabled: !!user,
    staleTime: 15_000,
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
  });

  // ── Realtime: instant refresh when a new notification lands ──────────────
  // Hardened: shares the app-wide ref-counted notifications channel
  // (see src/lib/notificationsRealtime.ts) instead of owning its own
  // "notifications-feed-realtime" topic — the previous own-channel pattern
  // could throw "cannot add postgres_changes callbacks ... after subscribe()"
  // when the effect re-ran while the old channel was still deregistering.
  // Deps also use the stable user?.id, not the user object identity.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    return subscribeNotificationsRealtime(() => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", userId] });
    });
  }, [userId, qc]);

  // ── Mark all read ────────────────────────────────────────────────────────
  const markAllReadMut = useMutation({
    mutationFn: async () => {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (unreadIds.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", unreadIds);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", user?.id] });
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
      toast.success("All marked as read");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to mark read"),
  });

  // ── Mark one read on click ───────────────────────────────────────────────
  const markOneReadMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", user?.id] });
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });

  // ── Delete (dismiss) one notification ────────────────────────────────────
  // Uses dismiss_notification RPC — hides it for this user only, leaving the
  // shared broadcast row untouched for everyone else who can also see it.
  const deleteOneMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("dismiss_notification", { p_notification_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", user?.id] });
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete"),
  });

  // ── Delete a specific set of selected notifications ──────────────────────
  const deleteSelectedMut = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("dismiss_notification", { p_notification_id: id });
        if (error) throw error;
      }
    },
    onSuccess: (_data, ids) => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", user?.id] });
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
      toast.success(`Deleted ${ids.length} notification${ids.length !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setSelectMode(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete"),
  });

  // ── Delete everything currently visible (across all pages) ───────────────
  const deleteAllMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("dismiss_all_notifications");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-feed", user?.id] });
      qc.invalidateQueries({ queryKey: ["notifications", user?.id] });
      toast.success("All notifications deleted");
      setSelectedIds(new Set());
      setSelectMode(false);
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete"),
  });

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  };

  const handleClick = (n: NotificationRow) => {
    if (selectMode) {
      toggleSelected(n.id);
      return;
    }
    if (!n.is_read) markOneReadMut.mutate(n.id);
    if (!n.link) return;
    // mailto: / tel: / external http(s) links must NOT go through the SPA
    // router — open them directly (e.g. mailto opens the device's mail app).
    if (/^(mailto:|tel:|https?:\/\/)/i.test(n.link)) {
      window.location.href = n.link;
    } else {
      navigate(n.link);
    }
  };

  // ── Group by day for display ─────────────────────────────────────────────
  const groups = useMemo(() => {
    const today: NotificationRow[] = [];
    const yesterday: NotificationRow[] = [];
    const earlier: NotificationRow[] = [];
    notifications.forEach((n) => {
      const d = new Date(n.created_at);
      if (isToday(d)) today.push(n);
      else if (isYesterday(d)) yesterday.push(n);
      else earlier.push(n);
    });
    return [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "Earlier", items: earlier },
    ].filter((g) => g.items.length > 0);
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            {title}
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground ml-1">
                {unreadCount} new
              </Badge>
            )}
          </h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* Filter chips */}
          <div className="flex bg-secondary rounded-lg p-0.5">
            {(["all", "unread"] as FilterKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  filter === k
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markAllReadMut.mutate()}
              disabled={markAllReadMut.isPending}
              className="gap-1.5"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              size="sm"
              variant={selectMode ? "secondary" : "outline"}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds(new Set());
              }}
              className="gap-1.5"
            >
              {selectMode ? <X className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
              {selectMode ? "Cancel" : "Select"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Bulk action bar (shown while in select mode) ── */}
      {selectMode && notifications.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-secondary/60 border border-border">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
          >
            {selectedIds.size === notifications.length ? (
              <CheckSquare className="w-4 h-4" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </button>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteSelectedMut.mutate(Array.from(selectedIds))}
                disabled={deleteSelectedMut.isPending}
                className="gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete selected
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => deleteAllMut.mutate()}
              disabled={deleteAllMut.isPending}
              className="gap-1.5"
            >
              Delete all
            </Button>
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-10 text-center">
              <BellOff className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-base font-semibold text-foreground">
                {filter === "unread" ? "No unread notifications" : "No notifications yet"}
              </p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                {filter === "unread"
                  ? "You're all caught up! New updates will appear here the moment they're published."
                  : "When admin publishes notices, results, fee vouchers, timetables, or other updates, they'll appear here instantly — no refresh needed."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {groups.map((group) => (
                <div key={group.label}>
                  {/* Day header */}
                  <div className="px-4 py-2 bg-muted/40 sticky top-0 z-10">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {group.label}
                    </p>
                  </div>
                  {/* Items */}
                  {group.items.map((n) => {
                    const meta = metaFor(n.type);
                    const Icon = meta.icon;
                    const isUnread = !n.is_read;
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleClick(n)}
                        className={`px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-secondary/50 transition-colors ${
                          isUnread ? "bg-primary/5" : ""
                        }`}
                      >
                        {/* Checkbox — only in select mode */}
                        {selectMode && (
                          <div className="shrink-0 pt-1.5">
                            {selectedIds.has(n.id) ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4 text-muted-foreground/50" />
                            )}
                          </div>
                        )}

                        {/* Type icon */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${meta.bg}`}>
                          <Icon className={`w-4 h-4 ${meta.color}`} />
                        </div>

                    {/* Body */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm leading-snug ${isUnread ? "font-semibold text-foreground" : "text-foreground/90"}`}>
                              {n.title}
                            </p>
                            {isUnread && !selectMode && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                            )}
                          </div>
                          {n.body && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5">
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-medium">
                              {meta.label}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground/70">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                              {" · "}
                              {format(new Date(n.created_at), "dd MMM, h:mm a")}
                            </span>
                          </div>
                        </div>

                        {/* Per-item delete — hidden while in select mode (use bulk bar instead) */}
                        {!selectMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteOneMut.mutate(n.id);
                            }}
                            disabled={deleteOneMut.isPending}
                            className="shrink-0 p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30"
                            aria-label="Delete notification"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer hint */}
      {notifications.length > 0 && (
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <Filter className="w-3 h-3" />
          Showing the latest {notifications.length} notification{notifications.length !== 1 ? "s" : ""}.
          Updates appear live — no refresh needed.
        </p>
      )}
    </div>
  );
}
