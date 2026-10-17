import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  HelpCircle,
  School,
  Search,
  Globe,
  MessageCircle,
} from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import PageBanner from "@/components/shared/PageBanner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
// Canonical FAQ dataset — the SAME single source of truth used by the SEO
// injector (RouteSEOInjector.tsx), api/render.js (crawler HTML) and the
// build-time prerender filler (scripts/seo-page-content.mjs). Types come
// from src/data/faqData.d.mts. The import stays inside src/ on purpose —
// the frontend build must never depend on api/.
import { FAQ_ITEMS, FAQ_CATEGORIES } from "../data/faqData.mjs";

type FaqItem = (typeof FAQ_ITEMS)[number];

/** Icon + one-line blurb per FAQ category (keys must match FAQ_CATEGORIES). */
const CATEGORY_META: Record<
  string,
  { icon: typeof GraduationCap; blurb: string }
> = {
  "Admissions": {
    icon: GraduationCap,
    blurb: "Applying online, required documents, tracking your application and fees",
  },
  "Results & Exams": {
    icon: ClipboardList,
    blurb: "Checking results by roll number, merit lists, exam roll number slips, grading scale, date sheets and BISE Peshawar board exams",
  },
  "Notes & Library": {
    icon: BookOpen,
    blurb: "Free chapter-wise notes, the digital library and past papers",
  },
  "School Information": {
    icon: School,
    blurb: "Location, timings, teachers, events and the photo gallery",
  },
  "Website & Contact": {
    icon: Globe,
    blurb: "Using the website, installing it as an app, accounts and contacting the school",
  },
};

const FAQ = () => {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  /**
   * Group the canonical items by their declared category (the order of
   * FAQ_CATEGORIES is preserved) and filter by the search box when a
   * query is entered — matching is case-insensitive across question AND
   * answer text. Categories whose every item is filtered out are hidden.
   */
  const sections = useMemo(() => {
    return FAQ_CATEGORIES.map((category) => ({
      category,
      items: FAQ_ITEMS.filter((item: FaqItem) => {
        if (item.category !== category) return false;
        if (!normalized) return true;
        return (
          item.question.toLowerCase().includes(normalized) ||
          item.answer.toLowerCase().includes(normalized)
        );
      }),
    })).filter((section) => section.items.length > 0);
  }, [normalized]);

  const totalMatches = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <PageLayout>
      <PageBanner
        title="Frequently Asked Questions"
        subtitle="Quick answers about admissions, results, notes, school information and using this website"
      />

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 -mt-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="max-w-2xl mx-auto"
        >
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a question — e.g. admission, roll number, BISE result…"
              aria-label="Search frequently asked questions"
              className="w-full rounded-2xl border border-border bg-card pl-11 pr-4 py-3 text-sm md:text-base text-foreground placeholder:text-muted-foreground shadow-card outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {normalized && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {totalMatches > 0
                ? `${totalMatches} answer${totalMatches === 1 ? "" : "s"} matching “${query.trim()}”`
                : "No answers match your search"}
            </p>
          )}
        </motion.div>
      </section>

      {/* ── Category quick-nav chips ───────────────────────────────────── */}
      {!normalized && (
        <section className="container mx-auto px-4 mt-8">
          <div className="flex flex-wrap justify-center gap-2">
            {FAQ_CATEGORIES.map((category) => {
              const Icon =
                CATEGORY_META[category]?.icon ?? HelpCircle;
              const count = FAQ_ITEMS.filter(
                (item: FaqItem) => item.category === category
              ).length;
              return (
                <a
                  key={category}
                  href={`#faq-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs md:text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:shadow-card transition-all"
                >
                  <Icon className="w-4 h-4 text-primary" />
                  {category}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                    {count}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Q&A sections, grouped by category ──────────────────────────── */}
      <section className="py-12 md:py-14">
        <div className="container mx-auto px-4 max-w-3xl space-y-12">
          {sections.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-16"
            >
              <HelpCircle className="w-12 h-12 mx-auto text-muted-foreground/40" />
              <h2 className="mt-4 text-xl font-heading font-bold text-foreground">
                No matching questions
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                We couldn't find any FAQ matching “{query.trim()}”. Try a
                different keyword — or reach us directly using the contact
                options at the bottom of this page.
              </p>
              <button
                onClick={() => setQuery("")}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Clear search
              </button>
            </motion.div>
          )}

          {sections.map(({ category, items }, sectionIndex) => {
            const meta = CATEGORY_META[category];
            const Icon = meta?.icon ?? HelpCircle;
            return (
              <motion.div
                key={category}
                id={`faq-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: Math.min(sectionIndex * 0.05, 0.2) }}
                className="scroll-mt-24"
              >
                {/* Category heading */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="shrink-0 rounded-xl bg-primary/10 p-2.5">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl md:text-2xl font-heading font-bold text-foreground leading-tight">
                      {category}
                    </h2>
                    {meta?.blurb && (
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {meta.blurb}
                      </p>
                    )}
                  </div>
                </div>

                {/* Q&A accordion for this category */}
                <Accordion
                  type="single"
                  collapsible
                  className="w-full bg-card border border-border rounded-2xl px-4 md:px-5 shadow-card"
                >
                  {items.map((item: FaqItem) => (
                    <AccordionItem key={item.id} value={item.id} className="last:border-b-0">
                      <AccordionTrigger className="text-left text-sm sm:text-base font-heading font-semibold text-foreground hover:no-underline hover:text-primary">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </motion.div>
            );
          })}

          {/* ── Still need help? ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="gradient-hero rounded-2xl p-6 md:p-8 text-center"
          >
            <MessageCircle className="w-8 h-8 mx-auto text-gold" />
            <h2 className="mt-3 text-xl md:text-2xl font-heading font-bold text-on-hero">
              Still have a question?
            </h2>
            <p className="mt-2 text-sm md:text-base text-on-hero-soft max-w-lg mx-auto">
              If your question isn't answered above, the school office will be
              happy to help. Call us, send an email, or use the contact form —
              and for admission queries the Admission page answers most
              questions and lets you track an application instantly.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <a
                href="/contact"
                className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-gold-ink hover:bg-gold-strong hover:text-white dark:hover:text-gold-ink transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Contact the School
              </a>
              <a
                href="/admission"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-on-hero hover:bg-white/10 transition-colors"
              >
                <GraduationCap className="w-4 h-4" />
                Admission Page
              </a>
            </div>
          </motion.div>
        </div>
      </section>
    </PageLayout>
  );
};

export default FAQ;
