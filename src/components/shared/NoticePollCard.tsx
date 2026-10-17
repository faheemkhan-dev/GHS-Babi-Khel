import { memo, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, Check, Users, Lock, Pin, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { detectTextLanguage } from "@/lib/newsUtils";
import { useMyPollVote, useCastPollVote, type Notice } from "@/hooks/useNotices";

/* ────────────────────────────────────────────────────────────────────────────
 *  NoticePollCard — WhatsApp-style single-choice poll
 *  ─────────────────────────────────────────────────────────────────────────
 *  Rendered instead of EditorialNoticeCard whenever a notice has
 *  is_poll = true. Shares the same ivory/gold/crimson editorial palette so
 *  it sits naturally next to regular notice cards in the same grid, but the
 *  layout is purpose-built for voting rather than reading:
 *
 *    • Before voting: tappable option rows, no results shown (like
 *      WhatsApp — seeing results first can bias how people vote).
 *    • After voting (or if this device already voted / poll is closed):
 *      animated percentage bars, the device's own pick marked with a check,
 *      and a total-votes counter.
 *    • No login: "have you voted" is tracked per-device via a token in
 *      localStorage (see useNotices.ts / cast_poll_vote() migration) —
 *      good enough to stop accidental double-votes without requiring an
 *      account, which is exactly what was asked for.
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  item: Notice;
  index?: number;
}

const NoticePollCard = ({ item, index = 0 }: Props) => {
  const titleLang = useMemo(() => detectTextLanguage(item.title), [item.title]);
  const { data: myVote, isLoading: myVoteLoading } = useMyPollVote(item.id, item.is_poll);
  const castVote = useCastPollVote();
  const [pendingOption, setPendingOption] = useState<string | null>(null);

  const isClosed = !!item.poll_closes_at && new Date(item.poll_closes_at) <= new Date();
  const hasVoted = !!myVote;
  const showResults = hasVoted || isClosed;

  const options = item.poll_options || [];
  const totalVotes = options.reduce((sum, o) => sum + (o.votes || 0), 0);
  const leadingId = useMemo(() => {
    if (!totalVotes) return null;
    return options.reduce((a, b) => ((b.votes || 0) > (a.votes || 0) ? b : a), options[0])?.id ?? null;
  }, [options, totalVotes]);

  const dateText = (() => {
    try { return format(new Date(item.created_at), "d MMMM yyyy"); }
    catch { return ""; }
  })();

  const handleVote = (optionId: string) => {
    if (isClosed || hasVoted || castVote.isPending) return;
    setPendingOption(optionId);
    castVote.mutate(
      { noticeId: item.id, optionId },
      {
        onError: (err: any) => {
          const msg = String(err?.message || "");
          if (msg.includes("already voted")) {
            toast.error(titleLang === "ur" ? "آپ پہلے ہی ووٹ دے چکے ہیں" : "You've already voted on this poll");
          } else if (msg.includes("closed")) {
            toast.error(titleLang === "ur" ? "یہ پول بند ہو چکا ہے" : "This poll is closed");
          } else {
            toast.error(titleLang === "ur" ? "ووٹ دینے میں ناکامی، دوبارہ کوشش کریں" : "Couldn't cast your vote — try again");
          }
        },
        onSettled: () => setPendingOption(null),
      }
    );
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.45, ease: "easeOut", delay: (index % 3) * 0.08 }}
      className="group relative h-full"
    >
      <div className="relative h-full bg-card rounded-md overflow-hidden shadow-[0_6px_28px_-12px_rgba(0,0,0,0.22)] hover:shadow-[0_18px_44px_-12px_rgba(0,0,0,0.36)] transition-all duration-400 border border-gold/30 hover:border-gold/70 flex flex-col">
        {/* Top triple-rule, in the poll's signature indigo instead of crimson so
            it reads as a distinct content type at a glance in the grid. */}
        <div className="relative">
          <div className="h-[3px] w-full bg-gradient-to-r from-transparent via-[hsl(258_60%_55%)] to-transparent" />
          <div className="h-px w-full bg-gold/40" />
        </div>

        <div className="p-5 flex flex-col flex-1">
          {/* Eyebrow: POLL badge + pinned/urgent + date */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.25em] bg-gradient-to-r from-[hsl(258_60%_55%)] to-[hsl(268_55%_48%)] text-white shadow-sm">
              <BarChart3 className="w-3 h-3" />
              {titleLang === "ur" ? "پول" : "Poll"}
            </span>
            {item.is_pinned && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-[0.25em] bg-gradient-to-r from-[hsl(43_70%_48%)] to-[hsl(43_80%_55%)] text-[hsl(348_55%_22%)] shadow-sm">
                <Pin className="w-2 h-2" /> {titleLang === "ur" ? "پن" : "Pinned"}
              </span>
            )}
            {item.is_urgent && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[7px] font-bold uppercase tracking-[0.25em] bg-[hsl(348_55%_28%)] text-[hsl(45_40%_95%)] shadow-sm">
                <AlertCircle className="w-2 h-2" /> {titleLang === "ur" ? "فوری" : "Urgent"}
              </span>
            )}
            <span className="ml-auto text-[9px] text-muted-foreground italic" style={{ fontFamily: "var(--font-display)" }}>
              {dateText}
            </span>
          </div>

          {/* Question */}
          <h3
            dir={titleLang === "ur" ? "rtl" : "ltr"}
            className={titleLang === "ur"
              ? "font-urdu-display text-foreground leading-[1.6] text-base mb-1"
              : "font-display font-semibold text-foreground leading-[1.25] text-lg mb-1"}
            style={titleLang === "ur" ? undefined : { fontFamily: "var(--font-display)" }}
          >
            {item.title}
          </h3>
          {item.content && (
            <p className="text-[12.5px] text-muted-foreground leading-snug mb-4">{item.content}</p>
          )}

          {/* Options */}
          <div className="space-y-2 mt-1">
            {options.map((opt) => {
              const pct = totalVotes > 0 ? Math.round(((opt.votes || 0) / totalVotes) * 100) : 0;
              const isMine = myVote === opt.id;
              const isLeader = showResults && totalVotes > 0 && leadingId === opt.id;
              const isBusy = pendingOption === opt.id && castVote.isPending;

              if (!showResults) {
                return (
                  <button
                    key={opt.id}
                    onClick={() => handleVote(opt.id)}
                    disabled={castVote.isPending || myVoteLoading}
                    className="w-full text-left px-4 py-2.5 rounded-xl border-2 border-border bg-background hover:border-[hsl(258_60%_55%)] hover:bg-[hsl(258_60%_55%)]/5 transition-all text-sm font-medium text-foreground disabled:opacity-60 flex items-center justify-between gap-2 active:scale-[0.99]"
                  >
                    <span dir={detectTextLanguage(opt.text) === "ur" ? "rtl" : "ltr"} className={detectTextLanguage(opt.text) === "ur" ? "font-urdu" : ""}>
                      {opt.text}
                    </span>
                    {isBusy && (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-[hsl(258_60%_55%)] border-t-transparent animate-spin shrink-0" />
                    )}
                  </button>
                );
              }

              return (
                <div
                  key={opt.id}
                  className={`relative overflow-hidden rounded-xl border-2 px-4 py-2.5 transition-colors ${
                    isMine ? "border-[hsl(258_60%_55%)]" : "border-border"
                  }`}
                >
                  {/* Fill bar */}
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className={`absolute inset-y-0 left-0 ${
                      isMine
                        ? "bg-gradient-to-r from-[hsl(258_60%_55%)]/25 to-[hsl(258_60%_55%)]/10"
                        : "bg-muted/70"
                    }`}
                  />
                  <div className="relative flex items-center justify-between gap-2 text-sm">
                    <span
                      dir={detectTextLanguage(opt.text) === "ur" ? "rtl" : "ltr"}
                      className={`flex items-center gap-1.5 font-medium ${isMine ? "text-[hsl(258_60%_38%)]" : "text-foreground"} ${detectTextLanguage(opt.text) === "ur" ? "font-urdu" : ""}`}
                    >
                      {isMine && <Check className="w-3.5 h-3.5 shrink-0" />}
                      {opt.text}
                      {isLeader && (
                        <span className="text-[8px] font-bold uppercase tracking-wider text-[hsl(43_70%_40%)] ml-1">
                          {titleLang === "ur" ? "سرِفہرست" : "Leading"}
                        </span>
                      )}
                    </span>
                    <span className={`text-xs font-bold tabular-nums shrink-0 ${isMine ? "text-[hsl(258_60%_38%)]" : "text-muted-foreground"}`}>
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: total votes + status */}
          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3 h-3" />
              {totalVotes} {titleLang === "ur" ? "ووٹ" : totalVotes === 1 ? "vote" : "votes"}
            </span>
            <AnimatePresence mode="wait">
              {isClosed ? (
                <motion.span key="closed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5 font-semibold">
                  <Lock className="w-3 h-3" /> {titleLang === "ur" ? "پول بند ہے" : "Poll closed"}
                </motion.span>
              ) : hasVoted ? (
                <motion.span key="voted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5 font-semibold text-[hsl(258_60%_45%)]">
                  <Check className="w-3 h-3" /> {titleLang === "ur" ? "ووٹ دے دیا گیا" : "You voted"}
                </motion.span>
              ) : (
                <motion.span key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {titleLang === "ur" ? "ایک آپشن منتخب کریں" : "Tap an option to vote"}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom triple-rule */}
        <div className="relative">
          <div className="h-px w-full bg-gold/40" />
          <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[hsl(258_60%_55%)]/60 to-transparent" />
        </div>
      </div>
    </motion.article>
  );
};

export default memo(NoticePollCard);
