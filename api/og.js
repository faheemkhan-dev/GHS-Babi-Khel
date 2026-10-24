import { createClient } from "@supabase/supabase-js";

// api/og.js
// Vercel Serverless Function — returns fully-formed static HTML with the
// correct <title>, <meta description>, Open Graph, Twitter Card, canonical,
// and JSON-LD tags for a given path. middleware.ts routes known social
// media crawlers (WhatsApp, Facebook, LinkedIn, X/Twitter, Slack, Discord,
// iMessage/Applebot, etc.) here instead of the normal SPA shell, because
// those crawlers read raw HTML once and never execute the JavaScript that
// would otherwise inject these tags via React Helmet.
//
// This mirrors the route table in src/components/seo/RouteSEOInjector.tsx
// so crawler previews match what users actually see once the page loads.
// Keep both in sync when adding new top-level routes.
//
// Access at: /api/og?path=/some/route  (middleware.ts sets this query param)

const SITE_URL = "https://ghsbabikhel.dpdns.org";
const SITE_NAME = "GHS Babi Khel";
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;
const DEFAULT_IMAGE_WIDTH = "1200";
const DEFAULT_IMAGE_HEIGHT = "630";
const TWITTER_SITE = "@GHSBabiKhel";

// ── Supabase client (serverless, no session) ────────────────────────────────
// Same pattern as api/sitemap.js — fresh, lightweight, anon, no auth state.
const supabaseUrl     = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _supabase;
}

// ── Live exam title for /results ────────────────────────────────────────────
// Mirrors the logic in src/pages/Results.tsx (useLatestPublishedExam /
// useScheduledPublishes) so crawler previews (WhatsApp, Facebook, etc.) show
// the same "Result - {Exam} {Year}" title real visitors see, instead of a
// generic fallback. Returns null on any failure — caller falls back to the
// static ROUTES entry for /results.
//
// SEO NOTE: The description is enhanced with target keywords (BISE Peshawar
// Result, SSC Result, BISEP Result, Peshawar Board Result) even when a live
// exam name is shown — so social-media link previews always contain the
// high-intent search phrases that bring students to this page from Google.
async function getResultsPageMeta() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: published } = await sb
      .from("results")
      .select("exam_type, year, created_at")
      .eq("is_published", true)
      .order("year", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (published && published.length > 0) {
      const { exam_type, year } = published[0];
      return {
        title: `Result - ${exam_type} ${year} — BISE Peshawar SSC, BISEP Result | GHS Babi Khel`,
        description:
          `${exam_type} ${year} result is now published. Check BISE Peshawar Result by roll number — ` +
          `SSC Result (9th & 10th class), HSSC Result (11th & 12th class), BISEP Result, ` +
          `Peshawar Board Result. Fast, free, mobile-friendly result lookup powered by GHS Babi Khel.`,
      };
    }

    const now = new Date().toISOString();
    const { data: scheduled } = await sb
      .from("results")
      .select("exam_type, year, publish_at")
      .eq("is_published", false)
      .not("publish_at", "is", null)
      .gt("publish_at", now)
      .order("publish_at", { ascending: true })
      .limit(1);

    if (scheduled && scheduled.length > 0) {
      const { exam_type, year } = scheduled[0];
      return {
        title: `${exam_type} ${year} Result Coming Soon — BISE Peshawar SSC, BISEP Result | GHS Babi Khel`,
        description:
          `${exam_type} ${year} result for GHS Babi Khel will be published soon. Meanwhile, check BISE Peshawar Result ` +
          `by roll number — SSC Result (9th & 10th class), HSSC Result (11th & 12th class), BISEP Result, ` +
          `Peshawar Board Result. Bookmark this page for instant result lookup.`,
      };
    }

    // ── BISE-mode fallback: scrape BISEP's live exam title ──────────────
    // When the school has NO published AND NO scheduled results, the page
    // falls back to BISE Peshawar's board result search. The title in that
    // mode should reflect whatever exam BISEP is currently serving (e.g.
    // "HSSC Annual-II 2025" or "SSC Annual-I 2026") — which we now scrape
    // live from cloud.bisep.edu.pk instead of using a stale env var.
    //
    // This is a duplicate of the same scraper in api/bisep-proxy.js's
    // `fetchCurrentExam` function. We duplicate it here (instead of
    // sharing via /api/_lib/) to stay at 12 Vercel functions — the user
    // is on Vercel Pro which caps at 12 serverless functions per project.
    const bisep = await scrapeBisepCurrentExam();
    if (bisep && bisep.exam_title) {
      if (bisep.is_live) {
        return {
          title: `Result - ${bisep.exam_title} — BISE Peshawar SSC, BISEP Result | GHS Babi Khel`,
          description:
            `Check ${bisep.exam_title} result by roll number — BISE Peshawar Result is LIVE. ` +
            `SSC Result (9th & 10th class), HSSC Result (11th & 12th class), BISEP Result, ` +
            `Peshawar Board Result. Fast, free, mobile-friendly lookup powered by GHS Babi Khel.`,
        };
      }
      if (bisep.countdown_date) {
        const d = new Date(bisep.countdown_date);
        const dateStr = d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
        return {
          title: `${bisep.exam_title} Result Coming Soon — BISE Peshawar SSC, BISEP Result | GHS Babi Khel`,
          description:
            `${bisep.exam_title} result from BISE Peshawar is expected on ${dateStr}. ` +
            `Bookmark this page to check your SSC (9th & 10th) or HSSC (11th & 12th) class result ` +
            `by roll number the moment it is announced. Powered by GHS Babi Khel.`,
        };
      }
    }

    // BISEP scrape failed too — return null so the caller falls back to
    // the static ROUTES title for /results.
    return null;
  } catch {
    return null;
  }
}

// ── BISEP homepage scraper (duplicate of api/bisep-proxy.js fetchCurrentExam) ──
// Kept in sync with the same function in api/bisep-proxy.js. If BISEP's
// HTML structure changes, BOTH files need to be updated.
//
// Returns { is_live, exam_title, exam_year, countdown_text, countdown_date }
// or null on failure. Does NOT throw — failures are silently swallowed so
// the OG metadata always falls back gracefully.
async function scrapeBisepCurrentExam() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const BROWSER_HEADERS = [
    "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "-H", "Accept-Language: en-US,en;q=0.5",
    "-H", "Referer: https://cloud.bisep.edu.pk/",
    "--compressed", "--silent", "--show-error", "--location",
    "--max-time", "8", "--connect-timeout", "5",
  ];

  const stripAndNorm = (s) =>
    (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();

  const toTitleCase = (s) =>
    s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
     .replace(/\b(Ssc|Hssc)\b/g, m => m.toUpperCase())
     .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, m => m.toUpperCase());

  try {
    const { stdout } = await execFileAsync("curl", [
      ...BROWSER_HEADERS, "https://cloud.bisep.edu.pk/",
    ], { maxBuffer: 5 * 1024 * 1024, timeout: 10000, encoding: "utf8" });

    const html = stdout || "";
    // Cloudflare challenge — bail.
    if (/Just a moment|_cf_chl_opt|cf_chl_opt/i.test(html)) return null;

    // ── Extract exam title — try multiple patterns ──
    let raw = "";

    // Pattern A: Old BISEP format — class="sub-header"
    const matchA = html.match(/<div\s+class="sub-header"[^>]*>\s*([\s\S]*?)\s*<\/div>/i);
    if (matchA) raw = stripAndNorm(matchA[1]);

    // Pattern B: New BISEP format — class="h3"
    if (!raw) {
      const matchB = html.match(/<div[^>]*\bclass="h3"[^>]*>\s*([\s\S]*?)\s*<\/div>/i);
      if (matchB) raw = stripAndNorm(matchB[1]);
    }

    // Pattern C: Broadest fallback — any <div> with "RESULT -" + exam name
    if (!raw) {
      const matchC = html.match(/<div[^>]*>\s*(RESULT\s*-\s*(?:SSC|HSSC)[\s\S]*?)\s*<\/div>/i);
      if (matchC) raw = stripAndNorm(matchC[1]);
    }

    if (!raw) return null;

    // ── Extract countdown from JavaScript ──
    let jsCountdownDate = null;
    const jsCountdownMatch = html.match(/new\s+Date\s*\(\s*"([^"]+)"\s*\)\s*\.getTime\s*\(\s*\)/);
    if (jsCountdownMatch) {
      try {
        const parsed = new Date(jsCountdownMatch[1]);
        if (!isNaN(parsed.getTime())) jsCountdownDate = parsed;
      } catch { /* ignore */ }
    }

    // ── Extract announcement date (DD-MM-YYYY at HH:MM AM/PM) ──
    let announcementDate = null;
    const announcementMatch = html.match(/<p[^>]*>\s*([\s\S]*?WILL\s+BE\s+ANNOUNCED\s+ON[\s\S]*?)\s*<\/p>/i);
    if (announcementMatch) {
      const announcementText = stripAndNorm(announcementMatch[1]);
      const dateMatch = announcementText.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (dateMatch) {
        let [, day, month, year, hour, minute, ampm] = dateMatch;
        hour = parseInt(hour, 10);
        minute = parseInt(minute, 10);
        if (ampm.toUpperCase() === "PM" && hour < 12) hour += 12;
        if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
        const parsed = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour, minute, 0, 0);
        if (!isNaN(parsed.getTime())) announcementDate = parsed;
      }
    }

    const bestCountdownDate = jsCountdownDate || announcementDate;
    const liveMatch = raw.match(/^RESULT\s*-\s*(.+?)\s*$/i);
    const examNameMatch = raw.match(/\b(SSC|HSSC)\s+ANNUAL-(I|II)(?:\s+EXAMINATION)?\s+(\d{4})\b/i);
    const examNameFullMatch = !examNameMatch
      ? html.match(/\b(SSC|HSSC)\s+ANNUAL-(I|II)(?:\s+EXAMINATION)?\s+(\d{4})\b/i)
      : null;
    const effectiveExamName = examNameMatch || examNameFullMatch;

    // ── LIVE state (no countdown) ──
    if (liveMatch && !bestCountdownDate) {
      let rawTitle = liveMatch[1].trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
      const yearInTitle = rawTitle.match(/\b(\d{4})\b/);
      return {
        is_live: true,
        exam_title: toTitleCase(rawTitle),
        exam_year: yearInTitle ? parseInt(yearInTitle[1], 10) : null,
        countdown_text: null,
        countdown_date: null,
      };
    }

    // ── PENDING state (with countdown or announcement) ──
    let examTitle = null;
    let examYear = null;
    let countdownDate = null;
    let countdownText = null;

    if (liveMatch) {
      let rawTitle = liveMatch[1].trim().replace(/\s*\([^)]*\)\s*$/, "").trim();
      examTitle = toTitleCase(rawTitle);
      const yearInTitle = rawTitle.match(/\b(\d{4})\b/);
      examYear = yearInTitle ? parseInt(yearInTitle[1], 10) : null;
    } else if (effectiveExamName) {
      examTitle = `${effectiveExamName[1].toUpperCase()} Annual-${effectiveExamName[2].toUpperCase()} ${effectiveExamName[3]}`;
      examYear = parseInt(effectiveExamName[3], 10);
    }

    if (bestCountdownDate) {
      countdownDate = bestCountdownDate.toISOString();
      countdownText = `Announced on ${bestCountdownDate.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}`;
    } else {
      // Fallback text patterns
      const pendingDateMatch = raw.match(/(?:ANNOUNCED\s+ON|EXPECTED\s+(?:ON|BY)|DECLARED\s+ON|PUBLISHED\s+ON)\s*:?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i);
      const pendingMonthMatch = raw.match(/EXPECTED\s+IN\s+:?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
      const awaitingMatch = /\b(AWAITED|COMING\s+SOON|STAY\s+TUNED|PENDING)\b/i.test(raw);

      if (pendingDateMatch) {
        const dateStr = pendingDateMatch[1].replace(/(\d+)(st|nd|rd|th)/i, "$1").trim();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          countdownDate = parsed.toISOString();
          countdownText = `Announced on ${parsed.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })}`;
        }
      } else if (pendingMonthMatch) {
        const monthName = pendingMonthMatch[1];
        const yearNum = parseInt(pendingMonthMatch[2], 10);
        const monthIdx = ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(monthName);
        if (monthIdx >= 0) {
          const parsed = new Date(yearNum, monthIdx, 1, 0, 0, 0, 0);
          countdownDate = parsed.toISOString();
          countdownText = `Expected in ${monthName} ${yearNum}`;
        }
      } else if (awaitingMatch) {
        countdownText = "Result awaited — check back soon";
      }
    }

    return {
      is_live: false,
      exam_title: examTitle,
      exam_year: examYear,
      countdown_text: countdownText,
      countdown_date: countdownDate,
    };
  } catch {
    return null;
  }
}

// ── Rich JSON-LD stack for /results ──────────────────────────────────────────
// Mirrors the schema stack in src/components/seo/RouteSEOInjector.tsx so that
// social-media crawlers (WhatsApp, Facebook, X, LinkedIn, etc.) see the same
// FAQPage / HowTo / ItemList / Service structured data that Googlebot picks
// up via React Helmet after JS rendering. This is purely additive — non-
// results routes still get the basic WebPage/Article schema below.
//
// IMPORTANT: The text inside FAQ/HowTo MUST mirror the on-page copy in
// ResultsSeoContent.tsx and RouteSEOInjector.tsx — keep all three in sync.
function getResultsExtraSchemas(url) {
  // ── FAQPage (15 Q&As) ──
  const faqs = [
    { q: "How do I check my BISE Peshawar Result 2026 by roll number?", a: "To check your BISE Peshawar Result 2026, enter your 6-digit roll number in the search box at the top of this page and tap Search Result. Our server fetches your result directly from the official BISEP portal (cloud.bisep.edu.pk) and displays your name, father name, total marks, grade, remarks and subject-wise theory and practical marks in a clean, mobile-friendly card. You can also visit cloud.bisep.edu.pk directly and enter your roll number on the board's official ShowResult page." },
    { q: "What is the official website of BISE Peshawar (BISEP)?", a: "The official website of the Board of Intermediate and Secondary Education Peshawar is https://cloud.bisep.edu.pk/. This is the only authoritative source for BISEP results, date sheets, roll number slips, enrollment, migration and gazette publications. Result lookups on this page are routed through the same official BISEP endpoint via a cached proxy for speed and reliability." },
    { q: "How do I check the 9th class result of BISE Peshawar?", a: "The 9th class result of BISE Peshawar is published as the SSC Annual-I Result. Once announced by the board, you can search it on this page using your 9th class roll number. The result card will show your obtained marks out of the total, grade, position in class (if available), and subject-wise breakdown. The 9th class SSC-I result is usually declared in August or September each year." },
    { q: "How do I check the 10th class result of BISE Peshawar?", a: "The 10th class (Matriculation) result of BISE Peshawar is published as the SSC Annual-II Result. Enter your 10th class roll number in the search box above to view your result instantly. The Matric result includes marks for all subjects (English, Urdu, Islamiyat, Pakistan Studies, Mathematics, Physics, Chemistry, Biology / Computer Science), total obtained marks, grade and pass/fail remarks. The SSC-II result is typically declared in July or August." },
    { q: "How do I check the 11th class (First Year) result of BISE Peshawar?", a: "The 11th class result, also called First Year or Intermediate Part-I, is published by BISE Peshawar as the HSSC Annual-I Result. Use your 11th class roll number in the search box above to retrieve your result. HSSC-I results are usually declared in October or November. Available groups include Pre-Medical, Pre-Engineering, ICS (Computer Science), I.Com (Commerce) and FA (Humanities)." },
    { q: "How do I check the 12th class (Second Year) result of BISE Peshawar?", a: "The 12th class result, also called Second Year or Intermediate Part-II, is published by BISE Peshawar as the HSSC Annual-II Result. Enter your 12th class roll number above to view your final intermediate result, which determines university admission eligibility. The HSSC-II result is usually declared in September. Both Part-I and Part-II marks are combined on the final HSSC marksheet." },
    { q: "When will BISE Peshawar announce the SSC Result 2026?", a: "BISE Peshawar typically announces the SSC Annual-II (10th class / Matric) Result in the last week of July or first week of August, and the SSC Annual-I (9th class) Result in August or September. The exact SSC Result 2026 date is officially confirmed by the Chairman of the Board a few days before declaration. Once declared, results are searchable immediately on this page." },
    { q: "When will BISE Peshawar announce the HSSC Result 2026?", a: "BISE Peshawar typically announces the HSSC Annual-II (12th class / Intermediate Part-II) Result in mid-September, and the HSSC Annual-I (11th class / First Year) Result in October or November. The official HSSC Result 2026 date is confirmed by the board closer to declaration. Bookmark this page to check your HSSC result by roll number the moment it is announced." },
    { q: "What are the passing marks for BISE Peshawar SSC and HSSC exams?", a: "To pass any subject in BISE Peshawar SSC (9th and 10th class) or HSSC (11th and 12th class) exams, a student must obtain at least 33% marks in both theory and practical separately. To pass the overall exam, a student must pass all subjects. Students who fail 1 or 2 subjects are placed in a supplementary exam; those who fail 3 or more subjects must repeat the entire year." },
    { q: "What is the grading system of BISE Peshawar?", a: "BISE Peshawar uses the following grading system for SSC and HSSC results: 80% and above = A-1 (A-One), 70% to 79% = A, 60% to 69% = B, 50% to 59% = C, 40% to 49% = D, 33% to 39% = E, and below 33% = F (Fail). The overall grade on the result card is calculated from the combined percentage of theory and practical marks across all subjects." },
    { q: "How do I check my BISEP result by name instead of roll number?", a: "BISE Peshawar's online result portal at cloud.bisep.edu.pk officially supports search by Roll Number only. Name-based search is available exclusively through the printed gazette, which is distributed to affiliated schools and educational institutions on result day. If you do not know your roll number, contact your school admin office — they have a complete list of roll numbers issued to enrolled students." },
    { q: "How do I download the BISE Peshawar result gazette PDF?", a: "The BISE Peshawar result gazette PDF is a complete list of every student's result for a given exam session. It is published on result day and is accessible only to affiliated school principals and authorized institutions via the board's institutional login at cloud.bisep.edu.pk. Individual students cannot download the gazette directly; they should request a print copy from their school office." },
    { q: "What does BISEP stand for?", a: "BISEP stands for Board of Intermediate and Secondary Education Peshawar. It is the government education board responsible for conducting, regulating and certifying Secondary School Certificate (SSC, Class 9 and 10) and Higher Secondary School Certificate (HSSC, Class 11 and 12) examinations in Peshawar District and several adjacent districts of Khyber Pakhtunkhwa (KPK), Pakistan." },
    { q: "How do I apply for rechecking or re-totaling of my BISE Peshawar result?", a: "If you believe your BISE Peshawar result marks are incorrect, you can apply for rechecking (also called re-totaling) within 15 days of result declaration. Visit the BISEP office at Jamrud Road, Peshawar, or apply through your school. The rechecking fee is paid via bank challan at designated banks. Only the totals are re-counted — the answer sheet is not re-evaluated. Updated marks (if any) are reflected in a revised result card." },
    { q: "How do I apply for result correction (name, father name, date of birth) in BISE Peshawar?", a: "To correct a name, father name or date of birth error on your BISE Peshawar result card, submit a result correction application through your school along with the original B-Form from NADRA, your father's CNIC copy and the original result card. The board processes corrections through its Record department. Processing typically takes 4 to 8 weeks. Always verify your B-Form details before enrollment to prevent such errors." },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: "BISE Peshawar Result — Frequently Asked Questions",
    url,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  // ── HowTo (5 steps) ──
  const howToSteps = [
    { name: "Find your roll number", text: "Locate your 6-digit exam roll number printed on your roll number slip issued by BISE Peshawar or your school. If you lost your slip, contact your school admin office — they have a master list of all issued roll numbers." },
    { name: "Enter the roll number in the search box", text: "Type your roll number into the 'Roll No' input field at the top of this page. Use digits only — no spaces, dashes or letters. The field accepts 4 to 10 digit roll numbers." },
    { name: "Tap 'Search Result'", text: "Click the blue Search Result button. Our server fetches your result from the official BISEP portal (cloud.bisep.edu.pk) through a cached proxy and parses the response into a clean card view." },
    { name: "Review your result card", text: "Your result appears instantly showing your name, father name, roll number, total marks, obtained marks, grade, remarks and subject-wise theory and practical marks. Take a screenshot or print the page for your records." },
    { name: "Collect your original DMC", text: "The online result is for information only. Collect your original Detailed Marks Certificate (DMC) from your school or the BISEP office on the date mentioned in the 'Collect DMC From' field of your result." },
  ];

  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to Check Your BISE Peshawar Result by Roll Number",
    description: "Step-by-step guide to retrieve your BISEP (Board of Intermediate and Secondary Education Peshawar) result by roll number — covers SSC (9th & 10th class) and HSSC (11th & 12th class) exams.",
    url,
    inLanguage: ["en", "ur"],
    totalTime: "PT2M",
    estimatedCost: { "@type": "MonetaryAmount", currency: "PKR", value: "0" },
    supply: [{ "@type": "HowToSupply", name: "Exam roll number" }],
    tool: [
      { "@type": "HowToTool", name: "Any web browser (mobile or desktop)" },
      { "@type": "HowToTool", name: "Internet connection" },
    ],
    step: howToSteps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };

  // ── ItemList (6 result types) ──
  const resultTypes = [
    { title: "SSC Annual-I Result (9th Class)", desc: "First-year secondary school (Class 9) BISE Peshawar annual examination result — Science and Arts groups." },
    { title: "SSC Annual-II Result (10th Class / Matric)", desc: "Second-year secondary school (Class 10 / Matriculation) BISE Peshawar annual examination result." },
    { title: "HSSC Annual-I Result (11th Class / First Year)", desc: "First-year higher secondary (Class 11 / Intermediate Part-I) BISE Peshawar annual examination result — Pre-Medical, Pre-Engineering, ICS, I.Com, FA." },
    { title: "HSSC Annual-II Result (12th Class / Second Year)", desc: "Second-year higher secondary (Class 12 / Intermediate Part-II) BISE Peshawar annual examination result." },
    { title: "SSC Supplementary Result", desc: "BISE Peshawar 9th and 10th class supplementary (second chance) examination result for students who failed a subject in the annual exam." },
    { title: "HSSC Supplementary Result", desc: "BISE Peshawar 11th and 12th class supplementary examination result for intermediate students who need to retake one or more subjects." },
  ];

  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "BISE Peshawar Result Types",
    description: "All examination result types conducted and published by the Board of Intermediate and Secondary Education Peshawar (BISEP).",
    url,
    numberOfItems: resultTypes.length,
    itemListElement: resultTypes.map((rt, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: rt.title,
      description: rt.desc,
    })),
  };

  // ── Service (result lookup) ──
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "BISE Peshawar Result Lookup by Roll Number",
    serviceType: "Examination result search",
    description: "Free online service to look up any BISE Peshawar (BISEP) examination result by roll number. Returns student name, father name, total marks, grade, remarks and subject-wise marks.",
    url,
    inLanguage: ["en", "ur"],
    isAccessibleForFree: true,
    category: "Education > Examination Results",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${url}?roll={roll_number}`,
        actionPlatform: ["DesktopWebBrowser", "MobileWebBrowser"],
      },
      "query-input": "required name=roll_number",
    },
  };

  return [faqSchema, howToSchema, itemListSchema, serviceSchema];
}

// Static route metadata — mirrors RouteSEOInjector.tsx's ROUTES table.
// Dynamic detail pages (/notices/:id, /notes/:subject/:chapter)
// use a sensible generic description below since this function has no
// database access; the canonical URL still points at the exact shared
// link, so the destination is always correct even though the preview
// text is generic for those specific pages.
const ROUTES = [
  { pattern: "/", title: "GHS Babi Khel — Government High School, District Mohmand KPK", description: "Government High School Babi Khel, District Mohmand, KPK Pakistan. Quality education, notices, results, library and admissions." },
  { pattern: "/about", title: "About GHS Babi Khel — History, Mission & Vision | District Mohmand KPK", description: "Learn about Government High School Babi Khel — our history since 2018, mission, vision, faculty and commitment to quality education in District Mohmand." },
  { pattern: "/teachers", title: "Teachers & Faculty — GHS Babi Khel | District Mohmand KPK", description: "Meet the qualified teachers and faculty of GHS Babi Khel — dedicated educators shaping the future of students in District Mohmand, KPK." },
  { pattern: "/notices", title: "School Notices & Announcements — GHS Babi Khel", description: "Browse the latest school notices, urgent announcements, academic updates and event information from Government High School Babi Khel." },
  { pattern: "/results", title: "BISE Peshawar Result 2026 — SSC Result, BISEP Result, Peshawar Board Result | GHS Babi Khel", description: "Check BISE Peshawar Result 2026 by roll number — SSC Result (9th & 10th class), HSSC Result (11th & 12th class), BISEP Result, Peshawar Board Result, Annual-I & Annual-II exams. Fast, free, mobile-friendly BISE Peshawar board result lookup powered by GHS Babi Khel." },
  { pattern: "/merit-list", title: "Merit List — Official School Exam Rankings | GHS Babi Khel", description: "Official GHS Babi Khel merit list — top position holders of every exam, class-wise and whole-school rankings with marks, percentages and grades." },
  { pattern: "/gallery", title: "Photo Gallery — GHS Babi Khel School Events & Activities", description: "Explore the photo and video gallery of Government High School Babi Khel — events, sports, academic activities and celebrations." },
  { pattern: "/library", title: "Digital Library — GHS Babi Khel | Books, Notes & Past Papers", description: "Access the digital library of GHS Babi Khel — books, study notes, past papers and educational resources for all classes." },
  { pattern: "/weather", title: "Weather — District Mohmand KPK | GHS Babi Khel", description: "Live weather forecast for Babi Khel and District Mohmand, KPK — temperature, conditions and outlook for the school community." },
  { pattern: "/contact", title: "Contact GHS Babi Khel — Address, Phone & Email | District Mohmand", description: "Contact Government High School Babi Khel, District Mohmand, KPK. Find our address, phone number, email, WhatsApp and location map. Reach out for admissions, queries and feedback." },
  { pattern: "/admission", title: "Admissions Open — GHS Babi Khel | Apply Online District Mohmand", description: "Apply for admission at Government High School Babi Khel — eligibility, fee structure, required documents and online application form." },
  { pattern: "/notes", title: "Study Notes — GHS Babi Khel | Subject-wise Notes & Resources", description: "Access subject-wise study notes, summaries and chapter resources for all classes at GHS Babi Khel — interactive learning made easy." },
  { pattern: "/search", title: "Search — GHS Babi Khel", description: "Search across notices, teachers and notes at Government High School Babi Khel." },
  // Dynamic / nested routes — generic but on-brand previews.
  { pattern: /^\/notes\/[^/]+\/[^/]+$/, title: "Chapter Notes — GHS Babi Khel | Detailed Study Material", description: "Read detailed chapter notes, examples and revision content. Interactive study resources for GHS Babi Khel students.", type: "article" },
  { pattern: /^\/notes\/[^/]+$/, title: "Subject Notes — GHS Babi Khel | Chapter-wise Study Material", description: "Browse chapter-wise notes and lessons for the selected subject. Comprehensive study material curated for GHS Babi Khel students." },
  { pattern: /^\/notices\/.+$/, title: "School Notice — GHS Babi Khel", description: "Read the full school notice from Government High School Babi Khel.", type: "article" },
];

const NOT_FOUND = {
  title: "Page Not Found — GHS Babi Khel",
  description: "The page you are looking for could not be found. Return to GHS Babi Khel home page.",
};

function matchRoute(path) {
  for (const r of ROUTES) {
    if (typeof r.pattern === "string") {
      if (r.pattern === path) return r;
    } else if (r.pattern.test(path)) {
      return r;
    }
  }
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default async function handler(req, res) {
  const rawPath = (req.query && req.query.path) || "/";
  // Normalize: strip query/hash if somehow present, collapse trailing slash.
  const path = ("/" + String(rawPath).replace(/^\/+/, "")).replace(/\/$/, "") || "/";

  const matched = matchRoute(path) || NOT_FOUND;
  const isNotFound = matched === NOT_FOUND;

  let title = matched.title;
  let description = matched.description;

  // /results gets a live title/description reflecting whichever exam is
  // actually published or counting down right now, instead of the static
  // fallback copy — same data src/pages/Results.tsx uses for real visitors.
  if (path === "/results" && !isNotFound) {
    const live = await getResultsPageMeta();
    if (live) {
      title = live.title;
      description = live.description;
    }
  }

  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const url = `${SITE_URL}${path === "/" ? "" : path}`;
  const type = matched.type || "website";

  // Base WebPage / Article schema (always emitted).
  const baseSchema = {
    "@context": "https://schema.org",
    "@type": type === "article" ? "Article" : "WebPage",
    name: fullTitle,
    description,
    url,
  };

  // ── /results: stack the rich schemas (FAQ, HowTo, ItemList, Service) ──
  // These mirror src/components/seo/RouteSEOInjector.tsx so social-media
  // crawlers (WhatsApp, Facebook, X, LinkedIn, etc.) see the same structured
  // data Googlebot picks up after JS rendering. Eligible for Google rich
  // results in social link previews.
  const extraSchemas = (path === "/results" && !isNotFound)
    ? getResultsExtraSchemas(url)
    : [];

  const allSchemas = [baseSchema, ...extraSchemas];
  const jsonLdScripts = allSchemas
    .map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join("\n");

  // /results gets a comprehensive keywords meta tag (Bing / Yandex still use
  // this; Google ignores it but it does no harm). Mirrors the keywords
  // defined in RouteSEOInjector.tsx for /results.
  const keywordsTag = (path === "/results" && !isNotFound)
    ? `<meta name="keywords" content="${escapeHtml("BISE Peshawar Result, BISEP Result, SSC Result, HSSC Result, Peshawar Board Result, BISE Result, Result 2026, 9th class result, 10th class result, 11th class result, 12th class result, Matric result, Intermediate result, BISE Peshawar result by roll number, BISEP result by roll number, BISE Peshawar SSC Result 2026, BISE Peshawar HSSC Result 2026, Annual-I result, Annual-II result, Supplementary result, Peshawar board result 2026, GHS Babi Khel results, school results, exam results, annual results, term results")}" />`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}" />
${keywordsTag}<meta name="robots" content="${isNotFound ? "noindex, nofollow" : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"}" />
<link rel="canonical" href="${escapeHtml(url)}" />

<meta property="og:title" content="${escapeHtml(fullTitle)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="${type}" />
<meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:image" content="${DEFAULT_IMAGE}" />
<meta property="og:image:width" content="${DEFAULT_IMAGE_WIDTH}" />
<meta property="og:image:height" content="${DEFAULT_IMAGE_HEIGHT}" />
<meta property="og:image:alt" content="${escapeHtml(fullTitle)}" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:locale" content="en_PK" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="${TWITTER_SITE}" />
<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${DEFAULT_IMAGE}" />
<meta name="twitter:image:alt" content="${escapeHtml(fullTitle)}" />

${jsonLdScripts}

<!-- This response is served only to social-media link-preview crawlers
     (see middleware.ts). Real visitors get the full single-page app. -->
<meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
</head>
<body>
<p>${escapeHtml(fullTitle)}</p>
<p>${escapeHtml(description)}</p>
<p><a href="${escapeHtml(url)}">Continue to ${SITE_NAME}</a></p>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    path === "/results"
      ? "public, s-maxage=300, stale-while-revalidate=600"
      : "public, s-maxage=3600, stale-while-revalidate=86400"
  );
  return res.status(isNotFound ? 404 : 200).send(html);
                                              }
