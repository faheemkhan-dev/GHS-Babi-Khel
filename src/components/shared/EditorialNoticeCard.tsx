import { memo, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Clock,
  Volume2,
  ArrowUpRight,
  Pin,
  AlertCircle,
  Feather,
  Quote,
  Calendar,
  Tag,
} from "lucide-react";
import { format } from "date-fns";
import {
  detectTextLanguage,
  estimateReadingTime,
} from "@/lib/newsUtils";
import type { Notice } from "@/hooks/useNotices";

/* ────────────────────────────────────────────────────────────────────────────
 *  EditorialNoticeCard  —  v1 (advanced)
 *  ─────────────────────────────────────────────────────────────────────────
 *  PhD-level research-paper-styled notice card. Companion to EditorialNewsCard
 *  — shares the same restrained palette (ivory ground, ink text, antique
 *  gold, deep crimson #7a1f2b, slate-blue #1e3a5f) and the same decorative
 *  vocabulary (paper grain, corner ticks, dual-tone gold rules, diamond
 *  ornaments, circular school seal, language-aware masthead).
 *
 *  Differences from EditorialNewsCard:
 *    • No image support (the notices table has no image_url column) — the
 *      MastheadEmblem is always shown.
 *    • Top-right badge stack reads Pinned / Urgent / Category, language-aware.
 *    • Compact single-column layout (no featured variant) — notices are short
 *      by nature and don't need a hero layout.
 *    • Footer shows "expires at" date if present (in addition to created_at).
 *
 *  Props:
 *    • item      – Notice from useNotices()
 *    • index     – list position (used for journal article number)
 *    • onListen  – callback fired when the "Listen" pill is clicked
 *  ───────────────────────────────────────────────────────────────────────── */

interface Props {
  item: Notice;
  index?: number;
  onListen?: (item: Notice, e: React.MouseEvent) => void;
}

const toRoman = (n: number): string => {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of map) {
    while (v >= val) { out += sym; v -= val; }
  }
  return out || "I";
};

/* ── Decorative journal flourishes ── */
const Diamond = ({ className = "" }: { className?: string }) => (
  <span className={`inline-block w-1.5 h-1.5 rotate-45 ${className}`} />
);

const CornerTicks = () => (
  <>
    <span className="pointer-events-none absolute top-3 left-3 w-2.5 h-2.5 border-t-[1.5px] border-l-[1.5px] border-gold/80" />
    <span className="pointer-events-none absolute top-3 right-3 w-2.5 h-2.5 border-t-[1.5px] border-r-[1.5px] border-gold/80" />
    <span className="pointer-events-none absolute bottom-3 left-3 w-2.5 h-2.5 border-b-[1.5px] border-l-[1.5px] border-gold/80" />
    <span className="pointer-events-none absolute bottom-3 right-3 w-2.5 h-2.5 border-b-[1.5px] border-r-[1.5px] border-gold/80" />
  </>
);

/* ── Hexagonal school seal (logo image inside a gold-ringed frame) ──
 *  Same pointy-top hexagon + gold gradient ring as EditorialNewsCard's
 *  SchoolSeal — both card families share the same heraldic crest look.
 *  Adds "xs" (48px) for use in compact masthead. */
const HEXAGON_CLIP =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

const SchoolSeal = ({
  size = "sm",
  className = "",
}: {
  size?: "xs" | "sm" | "md";
  className?: string;
}) => {
  const dims =
    size === "md" ? "w-20 h-20"
    : size === "xs" ? "w-12 h-12"
    : "w-16 h-16";
  return (
    <div
      className={`relative ${dims} ${className}`}
      style={{ filter: "drop-shadow(0 4px 8px rgba(122,31,43,0.35))" }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, hsl(35 92% 48%) 0%, hsl(40 95% 65%) 50%, hsl(35 92% 48%) 100%)",
          clipPath: HEXAGON_CLIP,
          WebkitClipPath: HEXAGON_CLIP,
        }}
      >
        <div
          className="absolute inset-[2px] bg-[hsl(38_45%_97%)] overflow-hidden flex items-center justify-center"
          style={{ clipPath: HEXAGON_CLIP, WebkitClipPath: HEXAGON_CLIP }}
        >
          <img
            src="/icon-96.png"
            alt="GHS Babi Khel school seal"
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 *  MastheadEmblem — always shown (notices have no images).
 * ────────────────────────────────────────────────────────────────────────── */
const MastheadEmblem = ({
  articleNo,
  lang,
}: {
  articleNo: string;
  lang: "ur" | "en";
}) => (
  <div className="w-full h-full relative overflow-hidden paper-grain flex flex-col items-center justify-center">
    {/* Concentric gold rings, off-center */}
    <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full border border-gold/25" />
    <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full border border-gold/15" />
    <div className="absolute -left-10 -bottom-10 w-32 h-32 rounded-full border border-gold/15" />

    {/* Hairline inner frame */}
    <div className="absolute inset-3 border border-gold/15 rounded-md" />
    <CornerTicks />

    {/* Subtle opening-quote watermark */}
    <Quote
      className="absolute text-primary/8 rotate-180 w-10 h-10 top-2 left-2"
      strokeWidth={1.2}
    />

    <div className="relative z-10 flex flex-col items-center gap-1 px-3">
      {/* Top line: EST · diamond · roman numeral */}
      <div className="flex items-center gap-1.5 text-[7px] font-bold uppercase tracking-[0.3em] text-primary/55">
        <span>EST. 2018</span>
        <Diamond className="bg-gold/70" />
        <span>№ {articleNo}</span>
      </div>

      <SchoolSeal size="xs" />

      {/* School name — language-aware (one language only) */}
      <div className="text-center min-h-[1.2rem]">
        {lang === "ur" ? (
          <p className="font-urdu-display text-primary text-[11px]" dir="rtl">
            گورنمنٹ ہائی سکول بابی خیل
          </p>
        ) : (
          <p
            className="font-display font-bold text-primary tracking-[0.15em] uppercase text-[10px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            GHS Babi Khel
          </p>
        )}
      </div>

      {/* Dual-tone gold rule */}
      <div className="flex items-center gap-1.5 w-full max-w-[100px]">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gold/70" />
        <Diamond className="bg-gold/80" />
        <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/70" />
      </div>

      {/* Edition tag */}
      <p className="text-[7px] font-bold uppercase tracking-[0.32em] text-[hsl(20_74%_38%)]">
        {lang === "ur" ? "اطلاعیہ" : "Notice Dispatch"}
      </p>
    </div>
  </div>
);

/* ── "Listen" pill ── */
const ListenPill = ({
  onClick,
  lang,
}: {
  onClick: (e: React.MouseEvent) => void;
  lang: "ur" | "en";
}) => (
  <button
    onClick={onClick}
    aria-label={lang === "ur" ? "سننے کے لیے دبائیں" : "Listen to this notice"}
    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wide
               bg-gradient-to-r from-[hsl(20_74%_38%)] to-[hsl(20_70%_30%)] text-[hsl(40_50%_97%)]
               shadow-sm hover:shadow-md hover:brightness-110 active:scale-95 transition-all
               ring-1 ring-[hsl(20_74%_38%)]/30"
  >
    <Volume2 className="w-3 h-3" />
    <span>{lang === "ur" ? "سنئیں" : "Listen"}</span>
  </button>
);

/* ──────────────────────────────────────────────────────────────────────────
 *  Title — language-aware (compact: shrunk from text-xl/text-lg to text-base)
 * ────────────────────────────────────────────────────────────────────────── */
const Title = ({ title, lang }: { title: string; lang: "ur" | "en" }) => {
  if (lang === "ur") {
    return (
      <h3 dir="rtl" className="font-urdu-display text-foreground leading-[1.7] text-[17px] line-clamp-2">
        {title}
      </h3>
    );
  }
  return (
    <h3
      dir="ltr"
      className="font-heading font-bold text-foreground leading-snug text-[17px] line-clamp-2 group-hover:text-primary transition-colors"
    >
      {title}
    </h3>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 *  Content preview — drop cap for English, plain Nastaliq for Urdu.
 *  Shrunk to text-[12px] line-clamp-2 to fit the smaller compact card.
 * ────────────────────────────────────────────────────────────────────────── */
const ContentPreview = ({ content, lang }: { content: string; lang: "ur" | "en" }) => {
  if (!content) return null;
  if (lang === "ur") {
    return (
      <p dir="rtl" className="font-urdu text-muted-foreground leading-[2] text-[13px] line-clamp-3">
        {content}
      </p>
    );
  }
  return (
    <p dir="ltr" className="text-muted-foreground leading-relaxed text-[13px] line-clamp-3">
      {content}
    </p>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 *  EditorialNoticeCard — main component
 * ────────────────────────────────────────────────────────────────────────── */
const EditorialNoticeCard = ({ item, index = 0, onListen }: Props) => {
  const titleLang = useMemo(() => detectTextLanguage(item.title), [item.title]);
  const contentLang = useMemo(
    () => detectTextLanguage(item.content || ""),
    [item.content]
  );
  const readTime = useMemo(
    () => estimateReadingTime(item.content),
    [item.content]
  );
  const dateText = (() => {
    try { return format(new Date(item.created_at), "d MMMM yyyy"); }
    catch { return ""; }
  })();
  const expiryText = (() => {
    if (!item.expires_at) return "";
    try { return format(new Date(item.expires_at), "d MMMM yyyy"); }
    catch { return ""; }
  })();
  const articleNo = toRoman(index + 1);
  const detailUrl = `/notices/${item.id}`;

  const handleListen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onListen?.(item, e);
  };

  const dateObj = (() => { try { return new Date(item.created_at); } catch { return null; } })();
  const accent = item.is_urgent
    ? "from-rose-500 to-orange-500"
    : item.is_pinned
      ? "from-gold to-gold-strong"
      : "from-primary to-primary-light";

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: (index % 3) * 0.06 }}
      className="group relative h-full"
    >
      <Link
        to={detailUrl}
        className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-gold/60 hover:shadow-elevated"
      >
        {/* Accent bar — colour tells urgency at a glance */}
        <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent}`} />

        <div className="flex flex-1 flex-col p-4 pl-5 sm:p-5 sm:pl-6">
          {/* Top row: date block + badges */}
          <div className="flex items-start gap-3">
            {dateObj && (
              <div className="shrink-0 w-12 overflow-hidden rounded-xl border border-border text-center shadow-sm">
                <div className={`bg-gradient-to-r ${accent} py-0.5 text-[9px] font-bold uppercase tracking-wider text-white`}>
                  {format(dateObj, "MMM")}
                </div>
                <div className="bg-card py-1 font-heading text-lg font-bold leading-none text-foreground">
                  {format(dateObj, "d")}
                </div>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 border border-gold/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-strong dark:text-gold">
                  <Tag className="h-2.5 w-2.5" />
                  {item.category}
                </span>
                {item.is_pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    <Pin className="h-2.5 w-2.5" />
                    {titleLang === "ur" ? "پن" : "Pinned"}
                  </span>
                )}
                {item.is_urgent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                    <AlertCircle className="h-2.5 w-2.5" />
                    {titleLang === "ur" ? "فوری" : "Urgent"}
                  </span>
                )}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" /> {readTime}
                {expiryText && (
                  <>
                    <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/50" />
                    <Calendar className="h-3 w-3" />
                    {titleLang === "ur" ? "ختم" : "Until"} {expiryText}
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Title + preview */}
          <div className="mt-3.5">
            <Title title={item.title} lang={titleLang} />
          </div>
          <div className="mt-2">
            <ContentPreview content={item.content || ""} lang={contentLang} />
          </div>

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3.5 mt-4">
            <ListenPill onClick={handleListen} lang={titleLang} />
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition-all group-hover:gap-1.5">
              {titleLang === "ur" ? "مزید" : "Read notice"}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
};

export default memo(EditorialNoticeCard);
