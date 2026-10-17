import { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Tag, AlertCircle, Pin } from "lucide-react";
import { format } from "date-fns";
import PageLayout from "@/components/layout/PageLayout";
import SEO from "@/components/seo/SEO";
import { useNoticeItem } from "@/hooks/useNotices";
import TextToSpeechPlayer, { ListenButton } from "@/components/shared/TextToSpeechPlayer";
import NoticePollCard from "@/components/shared/NoticePollCard";
import { detectTextLanguage, estimateReadingTime } from "@/lib/newsUtils";

const NoticeDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: item, isLoading } = useNoticeItem(id);
  const [listening, setListening] = useState(false);

  // Always start at the top of the article when navigating in — fixes the
  // bug where the page would land at the bottom (preserved scroll position).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [id]);

  if (isLoading) {
    return (
      <PageLayout>
        <div className="container mx-auto px-4 py-16 max-w-3xl">
          <div className="h-8 w-2/3 bg-muted rounded animate-pulse mb-4" />
          <div className="h-64 bg-muted rounded animate-pulse mb-4" />
          <div className="h-4 w-full bg-muted rounded animate-pulse mb-2" />
          <div className="h-4 w-5/6 bg-muted rounded animate-pulse" />
        </div>
      </PageLayout>
    );
  }

  if (!item) {
    return (
      <PageLayout>
        <SEO title="Notice Not Found" description="The notice you are looking for was not found." noIndex />
        <div className="container mx-auto px-4 py-20 max-w-2xl text-center">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Notice not found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            The notice may have been removed or the link is incorrect.
          </p>
          <Link to="/notices" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white font-semibold">
            <ArrowLeft className="w-4 h-4" /> Back to Notices
          </Link>
        </div>
      </PageLayout>
    );
  }

  const dateText = (() => { try { return format(new Date(item.created_at), "d MMMM yyyy"); } catch { return ""; } })();
  const expiryText = (() => {
    if (!item.expires_at) return "";
    try { return format(new Date(item.expires_at), "d MMMM yyyy"); } catch { return ""; }
  })();
  const description = (item.content || "").replace(/\s+/g, " ").slice(0, 160);
  const publishedISO = (() => { try { return new Date(item.created_at).toISOString(); } catch { return undefined; } })();
  const titleLang = detectTextLanguage(item.title);
  const contentLang = detectTextLanguage(item.content || "");
  const titleDir = titleLang === "ur" ? "rtl" : "ltr";
  const contentDir = contentLang === "ur" ? "rtl" : "ltr";

  return (
    <PageLayout>
      <SEO
        title={`${item.title} — Notice`}
        description={description}
        path={`/notices/${item.id}`}
        type="article"
        publishedTime={publishedISO}
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Notices", path: "/notices" },
          { name: item.title, path: `/notices/${item.id}` },
        ]}
      />

      <article className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Breadcrumb */}
        <nav className="text-xs text-muted-foreground mb-4 flex items-center gap-1 flex-wrap">
          <Link to="/" className="hover:text-primary">Home</Link>
          <span>/</span>
          <Link to="/notices" className="hover:text-primary">Notices</Link>
          <span>/</span>
          <span className="text-foreground truncate max-w-[180px]">{item.title}</span>
        </nav>

        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Notices
        </button>

        {item.is_poll ? (
          <>
            <div className="max-w-md">
              <NoticePollCard item={item} />
            </div>
            <div className="mt-10 pt-6 border-t border-border flex items-center justify-between flex-wrap gap-3">
              <div className="h-[2px] w-12 bg-gold rounded-full" />
              <Link to="/notices" className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" /> All Notices
              </Link>
            </div>
          </>
        ) : (
        <>
        {/* Eyebrow — editorial-style tag with diamond + rule, language-aware.
            Replaces the old rounded pill badges. */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.32em] text-[hsl(20_74%_38%)]">
            <span className="inline-block w-1.5 h-1.5 rotate-45 bg-[hsl(20_74%_38%)]" />
            {titleLang === "ur" ? "سرکاری اطلاعات" : "Official Notice"}
          </span>
          <span className="h-px w-20 bg-gradient-to-r from-[hsl(20_74%_38%)] to-transparent" />
          {item.is_pinned && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[9px] font-bold uppercase tracking-[0.28em] bg-gradient-to-r from-[hsl(24_92%_46%)] to-[hsl(30_95%_55%)] text-[hsl(20_75%_20%)] shadow-sm ring-1 ring-[hsl(24_92%_46%)]/40">
              <Pin className="w-3 h-3" />
              {titleLang === "ur" ? "پن کردہ" : "Pinned"}
            </span>
          )}
          {item.is_urgent && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[9px] font-bold uppercase tracking-[0.28em] bg-[hsl(20_74%_38%)] text-[hsl(40_50%_97%)] shadow-sm ring-1 ring-[hsl(20_74%_38%)]/30">
              <AlertCircle className="w-3 h-3" />
              {titleLang === "ur" ? "فوری" : "Urgent"}
            </span>
          )}
        </div>

        <h1
          className={`text-2xl md:text-4xl font-display font-semibold text-foreground leading-tight mb-4 ${
            titleLang === "ur" ? "font-urdu-display" : ""
          }`}
          style={titleLang === "ur" ? undefined : { fontFamily: "var(--font-display)" }}
          dir={titleDir}
        >
          {item.title}
        </h1>

        {/* Byline / meta bar */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground pb-5 mb-6 border-b border-gold/30">
          {dateText && (
            <span className="inline-flex items-center gap-1.5 font-display italic font-semibold text-[hsl(215_45%_28%)] text-[13px]" style={{ fontFamily: "var(--font-display)" }}>
              <Calendar className="w-3.5 h-3.5" /> {dateText}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {estimateReadingTime(item.content)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Tag className="w-3 h-3" /> {item.category}
          </span>
          {expiryText && (
            <span className="inline-flex items-center gap-1.5 italic">
              <Calendar className="w-3.5 h-3.5" />
              {titleLang === "ur" ? "ختم ہونے کی تاریخ" : "Expires"} {expiryText}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            {titleLang === "ur" ? "انتظامیہ گورنمنٹ ہائی سکول بابی خیل" : "GHS Babi Khel Administration"}
          </span>
          <span className="ml-auto">
            <ListenButton onClick={() => setListening(true)} />
          </span>
        </div>

        {/* Masthead emblem — same style as NewsDetail no-image fallback */}
        <div className="w-full rounded-md border border-gold/30 mb-8 overflow-hidden h-56 relative paper-grain bg-card">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full border border-gold/25" />
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full border border-gold/15" />
          <div className="absolute inset-3 border border-gold/15 rounded-md" />
          <div className="absolute top-3 left-3 w-2.5 h-2.5 border-t-[1.5px] border-l-[1.5px] border-gold/80" />
          <div className="absolute top-3 right-3 w-2.5 h-2.5 border-t-[1.5px] border-r-[1.5px] border-gold/80" />
          <div className="absolute bottom-3 left-3 w-2.5 h-2.5 border-b-[1.5px] border-l-[1.5px] border-gold/80" />
          <div className="absolute bottom-3 right-3 w-2.5 h-2.5 border-b-[1.5px] border-r-[1.5px] border-gold/80" />
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-6">
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-primary/55">
              <span>EST. 2018</span>
              <span className="inline-block w-1.5 h-1.5 rotate-45 bg-gold/70" />
              <span>№ 01</span>
            </div>
            {/* School seal — hexagonal gold-ringed frame around the actual logo */}
            <div
              className="relative w-20 h-20"
              style={{ filter: "drop-shadow(0 4px 8px rgba(122,31,43,0.35))" }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(35 92% 48%) 0%, hsl(40 95% 65%) 50%, hsl(35 92% 48%) 100%)",
                  clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                  WebkitClipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                }}
              >
                <div
                  className="absolute inset-[2px] bg-[hsl(38_45%_97%)] overflow-hidden flex items-center justify-center"
                  style={{
                    clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                    WebkitClipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                  }}
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
            {/* School name — language-aware (matches the article language) */}
            {titleLang === "ur" ? (
              <p className="font-urdu-display text-primary text-base" dir="rtl">
                گورنمنٹ ہائی سکول بابی خیل
              </p>
            ) : (
              <p
                className="font-display font-bold text-primary tracking-[0.15em] uppercase text-sm"
                style={{ fontFamily: "var(--font-display)" }}
              >
                GHS Babi Khel
              </p>
            )}
            <div className="flex items-center gap-1.5 w-full max-w-[140px]">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-gold/70" />
              <span className="inline-block w-1.5 h-1.5 rotate-45 bg-gold/80" />
              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-gold/70" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[hsl(20_74%_38%)]">
              {titleLang === "ur" ? "اطلاعیہ" : "Notice Dispatch"}
            </p>
          </div>
        </div>

        {item.content && (
          <div
            className={`prose prose-sm md:prose-lg max-w-none text-foreground whitespace-pre-wrap leading-relaxed ${
              contentLang === "ur"
                ? "font-urdu"
                : "first-letter:text-5xl first-letter:font-display first-letter:font-semibold first-letter:text-[hsl(20_74%_38%)] first-letter:mr-2 first-letter:float-left"
            }`}
            style={contentLang === "ur" ? undefined : { fontFamily: "var(--font-body)" }}
            dir={contentDir}
          >
            {item.content}
          </div>
        )}

        {/* closing rule */}
        <div className="mt-10 pt-6 border-t border-border flex items-center justify-between flex-wrap gap-3">
          <div className="h-[2px] w-12 bg-gold rounded-full" />
          <Link to="/notices" className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> All Notices
          </Link>
        </div>
        </>
        )}
      </article>

      {listening && (
        <TextToSpeechPlayer
          text={item.content || item.title}
          title={item.title}
          onClose={() => setListening(false)}
        />
      )}
    </PageLayout>
  );
};

export default NoticeDetail;
