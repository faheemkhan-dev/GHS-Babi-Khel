// src/components/seo/ResultsSeoContent.tsx
// ─────────────────────────────────────────────────────────────────────────────
// VISIBLE ON-PAGE SEO CONTENT for the /results route.
//
// WHY THIS EXISTS
// ───────────────
// The /results page already has strong technical SEO (Helmet meta, JSON-LD,
// canonical, hreflang, sitemap, OG/Twitter cards) and a working result-search
// UI. But Google ranks PAGES, not just meta tags — to outrank BISE Peshawar's
// official result page (cloud.bisep.edu.pk) for generic queries like
// "BISE Peshawar Result", "SSC Result", "BISEP Result", "Peshawar Board
// Result", the page itself must contain genuine, useful, keyword-relevant
// BODY CONTENT that matches user search intent.
//
// This component adds exactly that, as a single self-contained section that
// renders BELOW the existing result-search box (so the existing UX is
// untouched). It is purely additive:
//
//   • Does NOT modify the search box, BISEP proxy, or any existing logic.
//   • Does NOT change the page URL, route, or breadcrumbs.
//   • Uses semantic HTML (section > h2 > h3, p, ul, dl) so Googlebot can
//     parse it cleanly.
//   • Every paragraph is real, human-readable content — no keyword stuffing,
//     no hidden text. Google penalises both, and rightly so.
//   • Internal links to /result-card, /admission, /notes, /calendar help
//     Google understand the site's content graph and pass PageRank to the
//     result-related pages.
//
// The matching structured data (FAQPage, HowTo, ItemList, Service schemas)
// lives in RouteSEOInjector.tsx so it is injected via Helmet at the document
// <head> level. Keep the two files in sync when editing Q&A wording.
// ─────────────────────────────────────────────────────────────────────────────

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "react-router-dom";
import { ExternalLink, FileText, GraduationCap, Search, Trophy } from "lucide-react";

// ── BISE Peshawar official portal URL (used for the external "official source" link) ──
const BISEP_PORTAL_URL = "https://cloud.bisep.edu.pk/";

// ── Result types covered by BISE Peshawar (used in the ItemList section + on-page grid) ──
const RESULT_TYPES: { code: string; title: string; desc: string }[] = [
  {
    code: "SSC-I",
    title: "SSC Annual-I Result (9th Class)",
    desc: "First-year secondary school (Class 9) BISE Peshawar annual examination result — Science and Arts groups.",
  },
  {
    code: "SSC-II",
    title: "SSC Annual-II Result (10th Class / Matric)",
    desc: "Second-year secondary school (Class 10 / Matriculation) BISE Peshawar annual examination result.",
  },
  {
    code: "HSSC-I",
    title: "HSSC Annual-I Result (11th Class / First Year)",
    desc: "First-year higher secondary (Class 11 / Intermediate Part-I) BISE Peshawar annual examination result — Pre-Medical, Pre-Engineering, ICS, I.Com, FA.",
  },
  {
    code: "HSSC-II",
    title: "HSSC Annual-II Result (12th Class / Second Year)",
    desc: "Second-year higher secondary (Class 12 / Intermediate Part-II) BISE Peshawar annual examination result.",
  },
  {
    code: "SSC-SUPP",
    title: "SSC Supplementary Result",
    desc: "BISE Peshawar 9th and 10th class supplementary (second chance) examination result for students who failed a subject in the annual exam.",
  },
  {
    code: "HSSC-SUPP",
    title: "HSSC Supplementary Result",
    desc: "BISE Peshawar 11th and 12th class supplementary examination result for intermediate students who need to retake one or more subjects.",
  },
];

// ── FAQ entries ──
// These map 1:1 to the FAQPage JSON-LD in RouteSEOInjector.tsx. Keep wording
// in sync — Google cross-checks on-page FAQ text against the JSON-LD and may
// flag mismatches as structured data spam.
const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I check my BISE Peshawar Result 2026 by roll number?",
    a: "To check your BISE Peshawar Result 2026, enter your 6-digit roll number in the search box at the top of this page and tap Search Result. Our server fetches your result directly from the official BISEP portal (cloud.bisep.edu.pk) and displays your name, father name, total marks, grade, remarks and subject-wise theory and practical marks in a clean, mobile-friendly card. You can also visit cloud.bisep.edu.pk directly and enter your roll number on the board's official ShowResult page.",
  },
  {
    q: "What is the official website of BISE Peshawar (BISEP)?",
    a: "The official website of the Board of Intermediate and Secondary Education Peshawar is https://cloud.bisep.edu.pk/. This is the only authoritative source for BISEP results, date sheets, roll number slips, enrollment, migration and gazette publications. Result lookups on this page are routed through the same official BISEP endpoint via a cached proxy for speed and reliability.",
  },
  {
    q: "How do I check the 9th class result of BISE Peshawar?",
    a: "The 9th class result of BISE Peshawar is published as the SSC Annual-I Result. Once announced by the board, you can search it on this page using your 9th class roll number. The result card will show your obtained marks out of the total, grade, position in class (if available), and subject-wise breakdown. The 9th class SSC-I result is usually declared in August or September each year.",
  },
  {
    q: "How do I check the 10th class result of BISE Peshawar?",
    a: "The 10th class (Matriculation) result of BISE Peshawar is published as the SSC Annual-II Result. Enter your 10th class roll number in the search box above to view your result instantly. The Matric result includes marks for all subjects (English, Urdu, Islamiyat, Pakistan Studies, Mathematics, Physics, Chemistry, Biology / Computer Science), total obtained marks, grade and pass/fail remarks. The SSC-II result is typically declared in July or August.",
  },
  {
    q: "How do I check the 11th class (First Year) result of BISE Peshawar?",
    a: "The 11th class result, also called First Year or Intermediate Part-I, is published by BISE Peshawar as the HSSC Annual-I Result. Use your 11th class roll number in the search box above to retrieve your result. HSSC-I results are usually declared in October or November. Available groups include Pre-Medical, Pre-Engineering, ICS (Computer Science), I.Com (Commerce) and FA (Humanities).",
  },
  {
    q: "How do I check the 12th class (Second Year) result of BISE Peshawar?",
    a: "The 12th class result, also called Second Year or Intermediate Part-II, is published by BISE Peshawar as the HSSC Annual-II Result. Enter your 12th class roll number above to view your final intermediate result, which determines university admission eligibility. The HSSC-II result is usually declared in September. Both Part-I and Part-II marks are combined on the final HSSC marksheet.",
  },
  {
    q: "When will BISE Peshawar announce the SSC Result 2026?",
    a: "BISE Peshawar typically announces the SSC Annual-II (10th class / Matric) Result in the last week of July or first week of August, and the SSC Annual-I (9th class) Result in August or September. The exact SSC Result 2026 date is officially confirmed by the Chairman of the Board a few days before declaration. Once declared, results are searchable immediately on this page.",
  },
  {
    q: "When will BISE Peshawar announce the HSSC Result 2026?",
    a: "BISE Peshawar typically announces the HSSC Annual-II (12th class / Intermediate Part-II) Result in mid-September, and the HSSC Annual-I (11th class / First Year) Result in October or November. The official HSSC Result 2026 date is confirmed by the board closer to declaration. Bookmark this page to check your HSSC result by roll number the moment it is announced.",
  },
  {
    q: "What are the passing marks for BISE Peshawar SSC and HSSC exams?",
    a: "To pass any subject in BISE Peshawar SSC (9th and 10th class) or HSSC (11th and 12th class) exams, a student must obtain at least 33% marks in both theory and practical separately. To pass the overall exam, a student must pass all subjects. Students who fail 1 or 2 subjects are placed in a supplementary exam; those who fail 3 or more subjects must repeat the entire year.",
  },
  {
    q: "What is the grading system of BISE Peshawar?",
    a: "BISE Peshawar uses the following grading system for SSC and HSSC results: 80% and above = A-1 (A-One), 70% to 79% = A, 60% to 69% = B, 50% to 59% = C, 40% to 49% = D, 33% to 39% = E, and below 33% = F (Fail). The overall grade on the result card is calculated from the combined percentage of theory and practical marks across all subjects.",
  },
  {
    q: "How do I check my BISEP result by name instead of roll number?",
    a: "BISE Peshawar's online result portal at cloud.bisep.edu.pk officially supports search by Roll Number only. Name-based search is available exclusively through the printed gazette, which is distributed to affiliated schools and educational institutions on result day. If you do not know your roll number, contact your school admin office — they have a complete list of roll numbers issued to enrolled students.",
  },
  {
    q: "How do I download the BISE Peshawar result gazette PDF?",
    a: "The BISE Peshawar result gazette PDF is a complete list of every student's result for a given exam session. It is published on result day and is accessible only to affiliated school principals and authorized institutions via the board's institutional login at cloud.bisep.edu.pk. Individual students cannot download the gazette directly; they should request a print copy from their school office.",
  },
  {
    q: "What does BISEP stand for?",
    a: "BISEP stands for Board of Intermediate and Secondary Education Peshawar. It is the government education board responsible for conducting, regulating and certifying Secondary School Certificate (SSC, Class 9 and 10) and Higher Secondary School Certificate (HSSC, Class 11 and 12) examinations in Peshawar District and several adjacent districts of Khyber Pakhtunkhwa (KPK), Pakistan.",
  },
  {
    q: "How do I apply for rechecking or re-totaling of my BISE Peshawar result?",
    a: "If you believe your BISE Peshawar result marks are incorrect, you can apply for rechecking (also called re-totaling) within 15 days of result declaration. Visit the BISEP office at Jamrud Road, Peshawar, or apply through your school. The rechecking fee is paid via bank challan at designated banks. Only the totals are re-counted — the answer sheet is not re-evaluated. Updated marks (if any) are reflected in a revised result card.",
  },
  {
    q: "How do I apply for result correction (name, father name, date of birth) in BISE Peshawar?",
    a: "To correct a name, father name or date of birth error on your BISE Peshawar result card, submit a result correction application through your school along with the original B-Form from NADRA, your father's CNIC copy and the original result card. The board processes corrections through its Record department. Processing typically takes 4 to 8 weeks. Always verify your B-Form details before enrollment to prevent such errors.",
  },
];

// ── How-to steps (mirror the HowTo JSON-LD in RouteSEOInjector.tsx) ──
const HOW_TO_STEPS: { name: string; text: string }[] = [
  {
    name: "Find your roll number",
    text: "Locate your 6-digit exam roll number printed on your roll number slip issued by BISE Peshawar or your school. If you lost your slip, contact your school admin office — they have a master list of all issued roll numbers.",
  },
  {
    name: "Enter the roll number in the search box",
    text: "Type your roll number into the 'Roll No' input field at the top of this page. Use digits only — no spaces, dashes or letters. The field accepts 4 to 10 digit roll numbers.",
  },
  {
    name: "Tap 'Search Result'",
    text: "Click the blue Search Result button. Our server fetches your result from the official BISEP portal (cloud.bisep.edu.pk) through a cached proxy and parses the response into a clean card view.",
  },
  {
    name: "Review your result card",
    text: "Your result appears instantly showing your name, father name, roll number, total marks, obtained marks, grade, remarks and subject-wise theory and practical marks. Take a screenshot or print the page for your records.",
  },
  {
    name: "Collect your original DMC",
    text: "The online result is for information only. Collect your original Detailed Marks Certificate (DMC) from your school or the BISEP office on the date mentioned in the 'Collect DMC From' field of your result.",
  },
];

const ResultsSeoContent = () => {
  return (
    // ⚠️ SEO RISK — READ BEFORE EDITING ─────────────────────────────────────
    // This section is wrapped in `sr-only`, which visually hides it from
    // every sighted visitor (clipped to 1px, off-screen) while keeping it in
    // the actual DOM so Googlebot still crawls and indexes the text, and
    // screen readers can still read it.
    //
    // This was an explicit, informed choice by the site owner. Worth knowing
    // if you're the one debugging a ranking drop later: Google's spam
    // policies target "hidden text / cloaking" — content shown to crawlers
    // but not to real users — and this section is exactly that pattern. It
    // may still be indexed and may still help long-tail queries, but it is
    // NOT the safe, guideline-compliant way to do on-page SEO, and Google
    // can discount or penalize it if detected. The safer alternative is a
    // visible collapsed/"Read more" accordion (same content, one tap to
    // expand) — genuinely present to users, not just bots.
    //
    // If rankings drop after this change, this section is the first place
    // to check — try converting `sr-only` back to a visible (even
    // collapsed-by-default) section before assuming something else broke.
    <section
      aria-labelledby="bisep-result-seo-heading"
      className="sr-only"
    >
      <div className="container mx-auto px-3 sm:px-4 max-w-4xl space-y-10">

        {/* ── Keyword-rich intro section (the main on-page SEO content) ── */}
        <div className="space-y-4 text-foreground">
          <h2
            id="bisep-result-seo-heading"
            className="text-2xl sm:text-3xl font-heading font-bold tracking-tight"
          >
            BISE Peshawar Result 2026 — Check SSC Result, HSSC Result &amp; BISEP Result by Roll Number
          </h2>

          <p className="leading-relaxed">
            This is the official result portal of <strong>Government High School Babi Khel</strong> for
            students of District Mohmand and the wider Peshawar Board jurisdiction. From this page you
            can search your <strong>BISE Peshawar Result</strong> by roll number — covering the
            <strong> SSC Result</strong> (9th and 10th class / Matric), the
            <strong> HSSC Result</strong> (11th and 12th class / Intermediate), and both
            <strong> Annual-I and Annual-II</strong> examination sessions. The result is fetched live
            from the official BISEP portal (<a href={BISEP_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline font-medium hover:opacity-80 inline-flex items-center gap-1 align-baseline">cloud.bisep.edu.pk<ExternalLink className="w-3 h-3" /></a>)
            through a cached server-side proxy, so it is always accurate, fast and works even when the
            board's own website is overloaded on result day.
          </p>

          <p className="leading-relaxed">
            Common search terms that bring students to this page include
            <em> &quot;Result&quot;</em>, <em>&quot;SSC Result&quot;</em>,
            <em> &quot;BISE Result&quot;</em>, <em>&quot;BISEP Result&quot;</em>,
            <em> &quot;Peshawar Board Result&quot;</em>, <em>&quot;9th class result&quot;</em>,
            <em> &quot;10th class result&quot;</em>, <em>&quot;11th class result&quot;</em>,
            <em> &quot;12th class result&quot;</em>, <em>&quot;Matric result&quot;</em> and
            <em> &quot;Intermediate result&quot;</em>. Whatever you call it, this page lets you
            search the official BISE Peshawar result by roll number in one click — no login, no
            captcha, no waiting in a queue at the board office. The search works on every device
            including low-end Android phones on slow 2G/3G connections.
          </p>

          <p className="leading-relaxed">
            For school-specific exam results — internal class tests, mid-term exams, send-up exams
            and school-internal Mid-Term/Final-Term exams for Classes 6 to 10 at GHS Babi Khel — use the same
            search box above with your school exam roll number. You can also download your detailed
            subject-wise result card from the{" "}
            <Link to="/result-card" className="text-blue-600 dark:text-blue-400 underline font-medium hover:opacity-80">Result Card</Link>{" "}
            page once your school result is published by the admin office.
          </p>
        </div>

        {/* ── Result types covered (also fed into ItemList JSON-LD) ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl sm:text-2xl font-heading font-bold">
              Result Types Covered — BISE Peshawar (BISEP)
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            BISE Peshawar conducts two main examination streams every year — Secondary School
            Certificate (SSC) and Higher Secondary School Certificate (HSSC) — each split into
            Annual Part-I and Annual Part-II, plus a Supplementary exam for students who fail a
            subject. All six result types below are searchable on this page by roll number once
            officially declared by the board.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {RESULT_TYPES.map((rt) => (
              <div
                key={rt.code}
                className="bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-elevated transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <span className="shrink-0 inline-flex items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 px-2 py-1 text-[11px] font-mono font-bold text-blue-700 dark:text-blue-300 tracking-wider">
                    {rt.code}
                  </span>
                  <div>
                    <h3 className="font-heading font-semibold text-foreground leading-snug">
                      {rt.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rt.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── How to check your BISEP result (HowTo) ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl sm:text-2xl font-heading font-bold">
              How to Check Your BISE Peshawar Result by Roll Number
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Follow these five steps to retrieve your BISEP result in under 30 seconds. The same
            steps apply whether you are checking the SSC Result (9th or 10th class) or the HSSC
            Result (11th or 12th class) — only the roll number differs.
          </p>
          <ol className="space-y-3">
            {HOW_TO_STEPS.map((step, i) => (
              <li
                key={i}
                className="flex items-start gap-3 bg-card border border-border rounded-2xl p-4 shadow-card"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold font-mono"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-heading font-semibold text-foreground leading-snug">
                    {step.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* ── FAQ accordion (also fed into FAQPage JSON-LD) ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl sm:text-2xl font-heading font-bold">
              BISE Peshawar Result — Frequently Asked Questions
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Quick answers to the most common questions students ask about BISEP results — including
            result dates, passing marks, grading system, rechecking process, gazette access and
            name/father-name corrections.
          </p>
          <Accordion type="single" collapsible className="w-full bg-card border border-border rounded-2xl px-4 shadow-card">
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-sm sm:text-base font-heading font-semibold text-foreground hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* ── Internal links (pass PageRank to related pages) ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl sm:text-2xl font-heading font-bold">
              Related Resources for GHS Babi Khel Students
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Once you have checked your BISE Peshawar result, the following school resources may be
            useful — including your detailed result card, exam schedule, study notes and the
            admissions portal for new enrollment.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              to="/result-card"
              className="group bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-elevated transition-shadow flex items-start gap-3"
            >
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-heading font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                  Detailed Result Card (DMC)
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Download your subject-wise detailed marks certificate with school rank and class
                  position for GHS Babi Khel school-internal exams.
                </p>
              </div>
            </Link>
            <Link
              to="/calendar"
              className="group bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-elevated transition-shadow flex items-start gap-3"
            >
              <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-heading font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                  Exam Schedule &amp; Calendar
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Upcoming exam dates, result declaration dates, holidays and parent-teacher meetings
                  for the current academic year. Subscribe via .ics for Google Calendar / iPhone sync.
                </p>
              </div>
            </Link>
            <Link
              to="/notes"
              className="group bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-elevated transition-shadow flex items-start gap-3"
            >
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-heading font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                  Subject-wise Study Notes
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Free chapter-wise notes for Mathematics, Physics, Chemistry, Biology, English,
                  Urdu, Islamiyat, Pakistan Studies and Computer Science — Classes 6 to 10.
                </p>
              </div>
            </Link>
            <Link
              to="/admission"
              className="group bg-card border border-border rounded-2xl p-4 shadow-card hover:shadow-elevated transition-shadow flex items-start gap-3"
            >
              <GraduationCap className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-heading font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
                  Admissions Open — Apply Online
                </h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Online admission application for Class 6, 7, 8 and 9. Migration to Class 9 and 10
                  through the BISEP migration process is also supported.
                </p>
              </div>
            </Link>
          </div>
        </div>

        {/* ── Authority statement (signals E-E-A-T to Google) ── */}
        <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-5">
          <h2 className="text-base sm:text-lg font-heading font-bold text-blue-900 dark:text-blue-200 mb-2">
            About This Result Portal
          </h2>
          <p className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
            This BISE Peshawar Result search portal is maintained by{" "}
            <strong>Government High School Babi Khel</strong>, District Mohmand, Khyber Pakhtunkhwa,
            Pakistan (founded 2018). It is provided free of charge to students of the Peshawar Board
            and the school's own enrolled students. All BISEP result data shown on this page is
            fetched live from the official board portal{" "}
            <a href={BISEP_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:opacity-80 inline-flex items-center gap-1 align-baseline">
              cloud.bisep.edu.pk<ExternalLink className="w-3 h-3" />
            </a>{" "}
            through a cached server-side proxy for performance and reliability. We are not affiliated
            with the Board of Intermediate and Secondary Education Peshawar — for official
            notifications, always refer to the BISEP portal directly.
          </p>
        </div>

      </div>
    </section>
  );
};

export default ResultsSeoContent;
