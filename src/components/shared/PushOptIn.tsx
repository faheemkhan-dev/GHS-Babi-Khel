// src/components/shared/PushOptIn.tsx
// Web Push opt-in UI:
//   • <PushOptIn />        reusable premium card (contextual wording per page)
//   • <PushContextBar />   auto-picks the right wording from the current route —
//                          mounted once in PageLayout so every relevant page has it
//   • <PushPrompt />       gentle, dismissible global prompt (mounted once in App)
// Permission is only ever requested from a tap, never on page load.

import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bell, BellRing, BellOff, Check, Loader2, Share, X, Settings2 } from "lucide-react";
import { toast } from "sonner";
import {
  ALL_TOPICS, TOPIC_LABELS, disablePush, enablePush, getPushStatus, getSavedTopics, isPushConfigured,
  pingDispatch, refreshSubscriptionIfNeeded, sendTestPush, updateTopics,
  type PushStatus, type PushTopic,
} from "@/lib/push";

/* ── Shared status hook ───────────────────────────────────────────────── */
function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | "loading" | "hidden">("loading");
  const refresh = useCallback(async () => {
    if (!(await isPushConfigured())) return setStatus("hidden");
    setStatus(await getPushStatus());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { status, setStatus, refresh };
}

/* ── Contextual copy ──────────────────────────────────────────────────── */
type Ctx = { topics: PushTopic[]; title: string; text: string; short: string; shortText: string };
const CONTEXTS: Record<string, Ctx> = {
  results:   { topics: ["results"],   title: "Be first to know your result", text: "Get an instant alert the second results go live — no refreshing.", short: "Result alerts", shortText: "Know the second results go live" },
  merit:     { topics: ["merit"],     title: "Merit list alerts",            text: "We'll notify you the moment a new merit list is published.", short: "Merit list alerts", shortText: "Alert when a new list is published" },
  rollslip:  { topics: ["rollslip", "datesheet"], title: "Roll number slip alerts", text: "Get notified when slips and the date sheet are ready.", short: "Roll slip alerts", shortText: "Slips and date sheet, as soon as ready" },
  admission: { topics: ["admission"], title: "Admission updates",            text: "Be notified about admission announcements and your application status.", short: "Admission updates", shortText: "Announcements and your application status" },
  notices:   { topics: ["notices"],   title: "Never miss a notice",          text: "Important school notices, delivered straight to your phone.", short: "Never miss a notice", shortText: "Important notices on your phone" },
};
const ROUTE_CONTEXT: [RegExp, keyof typeof CONTEXTS][] = [
  [/^\/results/, "results"],
  [/^\/merit-list/, "merit"],
  [/^\/roll-no-slip/, "rollslip"],
  [/^\/admission/, "admission"],
  [/^\/notices/, "notices"],
];

/* ── Topic manager (shown once enabled) ───────────────────────────────── */
const TopicManager = ({ onOff }: { onOff: () => void }) => {
  const [topics, setTopics] = useState<PushTopic[]>(getSavedTopics);
  const [busy, setBusy] = useState(false);

  const toggle = async (t: PushTopic) => {
    const next = topics.includes(t) ? topics.filter((x) => x !== t) : [...topics, t];
    setTopics(next);
    try { await updateTopics(next); } catch { toast.error("Couldn't save your choice. Please try again."); }
  };
  return (
    <div className="mt-3 pt-3 border-t border-white/15">
      <p className="text-[11px] font-semibold text-white/70 mb-2">Notify me about</p>
      <div className="flex flex-wrap gap-1.5">
        {ALL_TOPICS.map((t) => {
          const on = topics.includes(t);
          return (
            <button
              key={t} type="button" onClick={() => toggle(t)} aria-pressed={on}
              className={`h-8 px-3 rounded-full text-xs font-semibold border transition-colors ${
                on ? "bg-gold text-white border-gold" : "bg-white/5 text-white/70 border-white/20 hover:bg-white/10"
              }`}
            >
              {TOPIC_LABELS[t]}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px]">
        <button type="button" onClick={async () => { await sendTestPush().catch(() => {}); toast.success("Test notification sent"); }} className="font-semibold text-gold hover:underline">Send test</button>
        <button
          type="button" disabled={busy}
          onClick={async () => { setBusy(true); await disablePush(); setBusy(false); onOff(); toast("Notifications turned off"); }}
          className="font-semibold text-white/60 hover:text-white hover:underline"
        >
          Turn off
        </button>
      </div>
    </div>
  );
};

/* ── Reusable card ────────────────────────────────────────────────────── */
export const PushOptIn = ({
  context = "results", title, text, admissionRef, className = "", showWhenOn = false, onDismiss, variant = "strip",
}: {
  context?: keyof typeof CONTEXTS; title?: string; text?: string; admissionRef?: string;
  className?: string; showWhenOn?: boolean; onDismiss?: () => void; variant?: "strip" | "card";
}) => {
  const ctx = CONTEXTS[context] ?? CONTEXTS.results;
  const { status, setStatus } = usePushStatus();
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      // Everything by default ("notify me for everything"); the person can narrow it in Manage.
      const next = await enablePush({ topics: [...ALL_TOPICS], admissionRef });
      setStatus(next);
      if (next === "on") {
        toast.success("Notifications enabled 🔔");
        sendTestPush().catch(() => {});
      } else if (next === "denied") toast.error("Notifications are blocked. Allow them in your browser's site settings.");
    } catch (e) {
      toast.error(e?.message || "Couldn't enable notifications.");
    } finally { setBusy(false); }
  };

  if (status === "loading" || status === "hidden" || status === "unsupported") return null;
  if (status === "on" && !showWhenOn) return null;

  // ── Thin, translucent strip (default) — one slim row, never a big card ──
  if (variant === "strip" && status !== "on") {
    const off = status === "off";
    const sTitle = status === "denied" ? "Notifications blocked"
      : status === "ios-install" ? "Alerts on iPhone"
      : (title && title.length <= 28 ? title : ctx.short);
    const sText = status === "denied" ? "Allow them in browser site settings"
      : status === "ios-install" ? "Share → Add to Home Screen, then open the app"
      : (text && text.length <= 48 ? text : ctx.shortText);
    return (
      <div role="region" aria-label="Notification alerts"
        className={`relative overflow-hidden rounded-2xl border border-white/15 bg-[#0b2e1f]/75 text-white shadow-[0_12px_32px_-10px_rgba(0,0,0,0.5)] backdrop-blur-xl supports-[backdrop-filter]:bg-[#0b2e1f]/65 ${className}`}>
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" aria-hidden="true" />
        <div className="flex items-center gap-2.5 py-2 pl-2.5 pr-1.5">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-gold">
            {status === "denied" ? <BellOff className="h-[18px] w-[18px]" /> : <Bell className="h-[18px] w-[18px]" />}
            {off && <span className="absolute inset-0 animate-pulse rounded-xl ring-1 ring-gold/50" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold tracking-tight">{sTitle}</p>
            <p className="mt-0.5 truncate text-[11px] text-white/65">{sText}</p>
          </div>
          {off && (
            <button
              onClick={enable} disabled={busy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-gold to-gold-strong px-3.5 text-xs font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Turn on
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} aria-label="Dismiss" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-3xl gradient-hero text-white p-4 sm:p-5 shadow-elevated ${className}`}>
      <div className="orb orb-gold w-40 h-40 -top-16 -right-10 opacity-70" aria-hidden="true" />
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" aria-hidden="true" />
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 z-10">
          <X className="w-4 h-4" />
        </button>
      )}
      <div className="relative flex items-start gap-3.5">
        <span className="w-11 h-11 shrink-0 rounded-2xl bg-white/10 border border-white/15 text-gold flex items-center justify-center">
          {status === "on" ? <BellRing className="w-5 h-5" /> : status === "denied" ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
        </span>
        <div className="min-w-0 flex-1 pr-6">
          {status === "on" ? (
            <>
              <h3 className="font-heading font-bold text-[15px] leading-tight flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-300" /> Notifications are on</h3>
              <p className="mt-1 text-xs text-white/70">You'll be alerted about new results, notices and updates.</p>
              <button onClick={() => setManage((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gold">
                <Settings2 className="w-3.5 h-3.5" /> {manage ? "Hide options" : "Manage"}
              </button>
              {manage && <TopicManager onOff={() => setStatus("off")} />}
            </>
          ) : status === "denied" ? (
            <>
              <h3 className="font-heading font-bold text-[15px] leading-tight">Notifications are blocked</h3>
              <p className="mt-1 text-xs text-white/70">Allow notifications for this site in your browser settings, then reload the page.</p>
            </>
          ) : status === "ios-install" ? (
            <>
              <h3 className="font-heading font-bold text-[15px] leading-tight">Get instant alerts on iPhone</h3>
              <p className="mt-1 text-xs text-white/70 flex flex-wrap items-center gap-1">
                Tap <Share className="w-3.5 h-3.5 inline text-gold" /> Share, then <strong className="text-white">Add to Home Screen</strong>, and open the app from there to turn on notifications.
              </p>
            </>
          ) : (
            <>
              <h3 className="font-heading font-bold text-[15px] leading-tight">{title ?? ctx.title}</h3>
              <p className="mt-1 text-xs text-white/70">{text ?? ctx.text}</p>
              <button
                onClick={enable} disabled={busy}
                className="mt-3 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-gradient-to-r from-gold to-gold-strong text-white text-sm font-bold shadow-md active:scale-95 transition-transform disabled:opacity-70"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                Turn on notifications
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Route-aware bar for PageLayout ───────────────────────────────────── */
// Floats (fixed) above the bottom dock as a thin glass strip, so it NEVER
// takes space in the page or pushes the hero / banner down.
const CTX_DISMISS_KEY = "ghs_push_ctx_dismissed";
const CTX_DISMISS_MS = 3 * 24 * 60 * 60 * 1000;

export const PushContextBar = () => {
  const { pathname } = useLocation();
  const hit = ROUTE_CONTEXT.find(([re]) => re.test(pathname));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!hit) return;
    try {
      if (Date.now() - Number(localStorage.getItem(CTX_DISMISS_KEY) || 0) < CTX_DISMISS_MS) return;
    } catch { /* ignore */ }
    const t = window.setTimeout(() => setVisible(true), 1400);   // let the page paint first
    return () => window.clearTimeout(t);
  }, [pathname, !!hit]);

  const dismiss = () => {
    try { localStorage.setItem(CTX_DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setVisible(false);
  };

  if (!hit || !visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-[55] mx-auto max-w-md animate-in fade-in slide-in-from-bottom-3 duration-500 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:mx-0 lg:w-[26rem]">
      <PushOptIn context={hit[1]} onDismiss={dismiss} className="pointer-events-auto" />
    </div>
  );
};

/* ── Global gentle prompt + background upkeep (mounted once in App) ───── */
const DISMISS_KEY = "ghs_push_prompt_dismissed";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export const PushPrompt = () => {
  const { pathname } = useLocation();
  const { status, setStatus } = usePushStatus();
  const [show, setShow] = useState(false);
  const skip = pathname.startsWith("/admin") || pathname.startsWith("/auth");
  const hasContextBar = ROUTE_CONTEXT.some(([re]) => re.test(pathname));

  // Upkeep: refresh subscription daily + nudge the server to announce new content.
  useEffect(() => {
    if (skip) return;
    refreshSubscriptionIfNeeded();
    try {
      if (!sessionStorage.getItem("ghs_push_pinged")) {
        sessionStorage.setItem("ghs_push_pinged", "1");
        const t = window.setTimeout(() => pingDispatch("visitor"), 4000);
        return () => window.clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, [skip]);

  // Show once, after the visitor has been around a bit — never on first paint.
  useEffect(() => {
    if (skip || hasContextBar || status !== "off") return setShow(false);
    try {
      const d = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (Date.now() - d < DISMISS_MS) return;
    } catch { /* ignore */ }
    const t = window.setTimeout(() => setShow(true), 20000);
    return () => window.clearTimeout(t);
  }, [skip, hasContextBar, status, pathname]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

  if (!show) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom,0px))] z-[60] mx-auto max-w-md animate-in fade-in slide-in-from-bottom-3 duration-500 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:mx-0 lg:w-[26rem]">
      <PushOptIn context="results" title="Get instant school alerts" text="Results, notices, merit lists & more" onDismiss={dismiss} />
    </div>
  );
};
