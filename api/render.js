// ─────────────────────────────────────────────────────────────────────────────
// api/render.js — ONE function, TWO live modes  (function-limit consolidation)
//
//   • /api/render?path=/admission   → complete LIVE HTML page for crawlers
//   • /api/render?feed=ai           → complete LIVE JSON feed for AI tools
//     (old /api/ai-data, /ai-data.json and /ai.json URLs are rewritten to
//      this function by vercel.json — every public URL is unchanged)
//
// WHY ONE FUNCTION?
//   Vercel's Hobby plan allows a maximum of 12 Serverless Functions per
//   deployment. The repo previously had 14 separate function files, which
//   would make every deploy fail with "exceeded the maximum number of
//   Serverless Functions". render.js (crawler HTML) and ai-data.js (AI JSON
//   feed) share the same data layer, so they are now ONE function with a tiny
//   query-param dispatcher. The four machine endpoints robots/sitemap/llms/rss
//   were merged the same way into api/seo.js. Total functions: 10 (2 spare
//   slots for future growth).
//
// WHY THE DATA LAYER IS INLINED HERE (no api/_site-data.mjs import):
//   Every helper file inside api/ was one more file the deployment depended
//   on that is NOT a function — and a deleted helper once broke the whole
//   production build. This function is now fully SELF-CONTAINED: its only
//   imports are the @supabase/supabase-js dependency, the canonical FAQ
//   dataset (src/data/faqData.mjs) and the shared page-content module
//   (scripts/seo-page-content.mjs) — both bundled by Vercel automatically.
//   Nothing in api/ except the 10 function files needs to exist.
//
// ── MODE 1: LIVE DYNAMIC RENDERING FOR CRAWLERS (?path=/…) ──────────────────
//
// THE PROBLEM THIS SOLVES
// ──────────────────────
// The site ships build-time prerendered pages (great for humans and as a
// crawlable floor), but their content freezes at the last deploy. The admin
// changes admission status, publishes notices/news/results and edits events
// in the dashboard daily — AI and search crawlers must see those changes in
// near-real-time, not next deploy.
//
// HOW IT WORKS (classic SaaS "dynamic rendering")
// ───────────────────────────────────────────────
//   1. middleware.ts detects AI/search crawler user-agents (GPTBot, ClaudeBot,
//      PerplexityBot, Googlebot, Bingbot, …) on public page routes.
//   2. Those requests are proxied HERE (?path=/admission …).
//   3. This function fetches the LIVE data from Supabase (same tables the
//      admin dashboard writes to) and returns a complete, standalone,
//      semantic HTML document: real headings, lists, full notice/news text,
//      per-route JSON-LD (FAQPage, ItemList, Article…), canonical + OG tags.
//   4. Humans are NOT affected — they still get the real React app, identical
//      design and behaviour. Nothing visual changes for users.
//
// CONTENT GUARANTEES
//   • Same facts as the React pages (same database, same tables).
//   • Every page ends with full internal navigation → one fetch lets a
//     crawler discover every public section of the site.
//   • Detail routes /notices/<id> and /news/<id> render the FULL content of
//     any published item — not just the latest 20 that are prerendered.
//
// ── MODE 2: LIVE MACHINE-READABLE FEED FOR AI TOOLS (?feed=ai) ──────────────
//
// One public JSON endpoint that carries the COMPLETE current state of every
// dynamic thing on the site, straight from the database. An AI tool fetches
// this single URL and gets the latest admission procedure + status, results
// info, notices, news, events, contacts and the full FAQ — in one round trip.
// Access (all open, GET only — aliases are rewrites in vercel.json):
//   https://ghsbabikhel.dpdns.org/api/ai-data
//   https://ghsbabikhel.dpdns.org/ai-data.json
//   https://ghsbabikhel.dpdns.org/ai.json
//
// SAFETY (both modes)
//   • Strict route allow-list; unknown paths → 404 (no open proxy).
//   • UUID validation before any id-based query.
//   • Public tables only — NO student records, NO marks, NO application data.
//   • Edge-cached (HTML 120 s / JSON 60 s, stale-while-revalidate) → fast + DB-safe.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { getPageMeta, NAV_LINKS, SITE_URL, SITE_NAME } from "../scripts/seo-page-content.mjs";
import { FAQ_ITEMS, FAQ_CATEGORIES, buildFaqJsonLd } from "../src/data/faqData.mjs";
import { getCurrentBisepPayload } from "./bisep-proxy.js";

// Deterministic function ceiling (Vercel serverless). All DB work is capped
// at ~4.5 s by safeQuery and runs in parallel, so the worst-case render is
// ~5 s — comfortably inside this limit. Exported so cold starts can never
// push a render past the platform default and return a 504 to a crawler.
export const maxDuration = 10;

// ─────────────────────────────────────────────────────────────────────────────
// INLINED LIVE-DATA LAYER (formerly api/_site-data.mjs — now part of THIS
// function so no helper file inside api/ can ever break the deployment).
//
// DESIGN GOALS
//   • ALWAYS-FRESH: every call queries Supabase directly — whatever the admin
//     changed in the dashboard is reflected within the CDN cache window
//     (60–120 s), not on the next deploy. This is the fix for "content changes
//     by admin but AI tools keep reading the build-time snapshot".
//   • NEVER FAILS: every section is fetched independently with its own
//     try/catch and a sensible static fallback. A Supabase hiccup degrades one
//     section, never the whole endpoint.
//   • NEVER LEAKS PRIVATE DATA: only genuinely public tables are read
//     (school_settings, admission_settings, published notices/news/events,
//     active teachers and library files). The
//     `admissions` and `results` tables contain personal data and are NOT
//     dumped here — the endpoints only explain how to search them.
// ─────────────────────────────────────────────────────────────────────────────

const SCHOOL_TZ = "Asia/Karachi";

const FALLBACK_SETTINGS = {
  school_name: "GHS Babi Khel",
  phone: "+92 346 9898295",
  email: "ghsbabikhel@gmail.com",
  principal: "Mr. Imdad Ullah",
  established: "2018",
  emis: "60673",
  address: "Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan",
};

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _supabase;
}

/** Run a Supabase query with a hard timeout; returns [] on any failure.
 *  Also used for single-item (detail) queries below.
 *
 *  TIMEOUT BUDGET (2026-08 reliability fix): lowered 8000 → 4500 ms. All
 *  section fetchers of a route run in PARALLEL, so the whole live snapshot
 *  is now bounded by ~4.5 s instead of ~8 s. Supabase queries on this project
 *  normally complete in < 500 ms; 4.5 s is still ~9× headroom, but keeps the
 *  total render well inside the serverless duration limit even when the
 *  database is waking up — which is exactly what caused the intermittent
 *  crawler timeouts reported by external tests. */
async function safeQuery(label, run, timeoutMs = 4500) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const result = await Promise.race([
      run(sb),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
      ),
    ]);
    const { data, error } = result;
    if (error) throw error;
    return Array.isArray(data) ? data : data ? [data] : [];
  } catch (err) {
    console.warn(`[site-data] ${label} failed:`, err?.message || err);
    return [];
  }
}

// ── Individual section fetchers ──────────────────────────────────────────────

async function fetchSchoolProfile() {
  const rows = await safeQuery("school_settings", (sb) =>
    sb
      .from("school_settings")
      .select(
        "school_name, phone, email, principal_name, established_year, emis_code, address, tagline, description, total_students, total_teachers, pass_percentage"
      )
      .eq("id", 1)
      .limit(1)
  );
  const s = rows[0] || {};
  return {
    name: s.school_name || FALLBACK_SETTINGS.school_name,
    full_name: "Government High School Babi Khel",
    location: s.address || FALLBACK_SETTINGS.address,
    district: "Mohmand",
    province: "Khyber Pakhtunkhwa",
    country: "Pakistan",
    established: String(s.established_year || FALLBACK_SETTINGS.established),
    emis_code: String(s.emis_code || FALLBACK_SETTINGS.emis),
    principal: s.principal_name || FALLBACK_SETTINGS.principal,
    phone: s.phone || FALLBACK_SETTINGS.phone,
    email: s.email || FALLBACK_SETTINGS.email,
    tagline: s.tagline || "Excellence in Education",
    description:
      s.description ||
      "Official website of Government High School Babi Khel — online admissions, exam results, notices, news, free study notes and more for classes 6 to 10.",
    // Real statistics from the admin dashboard (shown to AI crawlers so they
    // never read misleading "0+" placeholders — only values the school set).
    total_students: typeof s.total_students === "number" ? s.total_students : null,
    total_teachers: typeof s.total_teachers === "number" ? s.total_teachers : null,
    pass_percentage: typeof s.pass_percentage === "number" ? s.pass_percentage : null,
    classes_offered: ["6", "7", "8", "9", "10"],
    board: "BISE Peshawar",
    website: SITE_URL,
    facebook: "https://www.facebook.com/share/1EERTSk1W7/",
  };
}

async function fetchAdmissionInfo() {
  const rows = await safeQuery("admission_settings", (sb) =>
    sb
      .from("admission_settings")
      .select(
        "id, is_open, session_year, open_date, last_date, banner_message, notes, updated_at"
      )
      .eq("id", 1)
      .limit(1)
  );
  const a = rows[0] || null;
  // Live status straight from the admin dashboard — falls back to a clear
  // "check the page" message when the table can't be read.
  return {
    currently_open: a ? Boolean(a.is_open) : null,
    session_year: a?.session_year || null,
    open_date: a?.open_date || null,
    last_date: a?.last_date || null,
    banner_message: a?.banner_message || null,
    notes: a?.notes || null,
    updated_at: a?.updated_at || null,
    apply_url: `${SITE_URL}/admission`,
    track_url: `${SITE_URL}/admission`,
    classes: ["6", "7", "8", "9", "10"],
    fee: "Free of charge (government school)",
    how_to_apply: [
      "Fill the online admission form at " +
        `${SITE_URL}/admission and submit it`,
      "Save the reference number issued after submission",
      "Track the application any time by reference number, B-Form number or contact number",
      "Once approved, download the printable form, attach documents and complete enrolment at the school office",
    ],
    required_documents: [
      "Student B-Form (NADRA)",
      "Recent passport-size photograph",
      "Previous class result card (where applicable)",
      "School Leaving Certificate (SLC) — required for ALL admissions, fresh and migration",
      "Father's/Guardian's CNIC copy",
      "For class 9/10 migration from another board/school: DMC, migration certificate and enrollment letter — processed by the schools on the BISE Peshawar portal",
    ],
  };
}

async function fetchNotices(limit = 20) {
  const rows = await safeQuery("notices", (sb) =>
    sb
      .from("notices")
      .select("id, title, content, category, is_urgent, created_at")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  return rows.map((n) => ({
    id: n.id,
    title: n.title,
    content: (n.content || "").slice(0, 2000),
    category: n.category || "General",
    urgent: Boolean(n.is_urgent),
    published_at: n.created_at,
    url: `${SITE_URL}/notices/${n.id}`,
  }));
}

async function fetchNews(limit = 20) {
  const rows = await safeQuery("news", (sb) =>
    sb
      .from("news")
      .select("id, title, content, image_url, created_at")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  return rows.map((n) => ({
    id: n.id,
    title: n.title,
    content: (n.content || "").slice(0, 2000),
    image_url: n.image_url || null,
    published_at: n.created_at,
    url: `${SITE_URL}/news/${n.id}`,
  }));
}

async function fetchEvents(limit = 30) {
  const today = new Date().toISOString().slice(0, 10);
  // Upcoming first (soonest → latest), then recent past as context.
  const upcoming = await safeQuery("school_events_upcoming", (sb) =>
    sb
      .from("school_events")
      .select("id, title, description, event_type, start_date, end_date, updated_at")
      .eq("is_published", true)
      .or(`end_date.gte.${today},and(end_date.is.null,start_date.gte.${today})`)
      .order("start_date", { ascending: true })
      .limit(limit)
  );
  const recent = await safeQuery("school_events_recent", (sb) =>
    sb
      .from("school_events")
      .select("id, title, description, event_type, start_date, end_date, updated_at")
      .eq("is_published", true)
      .lt("start_date", today)
      .order("start_date", { ascending: false })
      .limit(10)
  );
  const shape = (e) => ({
    id: e.id,
    title: e.title,
    description: e.description || null,
    type: e.event_type || "general",
    start_date: e.start_date,
    end_date: e.end_date || null,
  });
  return { upcoming: upcoming.map(shape), recent: recent.map(shape) };
}

async function fetchTeachers(limit = 50) {
  const rows = await safeQuery("teachers", (sb) =>
    sb
      .from("teachers")
      .select("id, full_name, subject, qualification, experience, bio")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .limit(limit)
  );
  return rows.map((t) => ({
    name: t.full_name,
    subject: t.subject || null,
    qualification: t.qualification || null,
    experience: t.experience || null,
    bio: t.bio || null,
  }));
}

async function fetchLibraryFiles(limit = 20) {
  const rows = await safeQuery("library_files", (sb) =>
    sb
      .from("library_files")
      .select("id, title, description, category, class, subject, file_url, file_type, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  return rows.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description || null,
    category: f.category || null,
    class: f.class || null,
    subject: f.subject || null,
    file_type: f.file_type || null,
    download_url: f.file_url || null,
    added_at: f.created_at,
  }));
}

// ── Admission forms & documents (admin-uploaded real files) ────────────────
// The /admission page's Downloads section serves four documents (prospectus,
// fee structure, school-to-school transfer letter, rules). When the admin has
// uploaded the real PDFs to the library with category "Admission" (title
// containing prospectus / fee / migration / rules — the same mapping the
// Admission page uses), those ACTUAL files are listed here with their direct
// download URLs, so AI tools can point users straight at the forms.
// Client-generated fallback PDFs (built in the browser when no file is
// uploaded) are described separately — no URL exists for those.
async function fetchAdmissionFiles(limit = 20) {
  const rows = await safeQuery("admission_files", (sb) =>
    sb
      .from("library_files")
      .select("id, title, description, file_url, file_type, created_at")
      .ilike("category", "Admission")
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  return rows
    .filter((f) => f && f.file_url)
    .map((f) => {
      const t = (f.title || "").toLowerCase();
      let kind = "document";
      if (t.includes("prospectus")) kind = "prospectus";
      else if (t.includes("fee")) kind = "fee_structure";
      else if (t.includes("migration") || t.includes("transfer")) kind = "transfer_letter";
      else if (t.includes("rule")) kind = "rules";
      else if (t.includes("form")) kind = "admission_form";
      return {
        kind,
        title: f.title,
        description: f.description || null,
        file_type: f.file_type || (t.includes(".pdf") || (f.file_url || "").toLowerCase().includes(".pdf") ? "PDF" : null),
        download_url: f.file_url,
        added_at: f.created_at,
      };
    });
}


// ── Merit lists (public rankings — the /merit-list page data) ──────────────
// Previously /merit-list had NO fetcher: AI tools could never see which merit
// lists are published. Metadata + statistics + top 3 positions per list — the
// same information any visitor sees first on the public page (the full ranked
// list is on the page; student entries are PUBLIC there by design).
async function fetchMeritLists(limit = 10) {
  const rows = await safeQuery("merit_lists_public", (sb) =>
    sb
      .from("merit_lists")
      .select(
        "id, scope, class, exam_type, year, is_published, publish_at, title, notes, created_at, entries, total_students, passing_count, highest_percentage, average_percentage"
      )
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  const now = Date.now();
  return rows.map((m) => {
    const ts = m.publish_at ? new Date(m.publish_at).getTime() : null;
    // Withheld students ("Hide top 3" / "Hide top 3 of each class") sit in
    // the snapshot as ANONYMOUS placeholder rows (hidden: true — no name,
    // roll number, class or marks). They count toward the hidden total but
    // must NEVER appear as toppers. Older published rows (pre-placeholder)
    // instead stored fewer entries than total_students — same conclusion.
    const allRows = Array.isArray(m.entries) ? m.entries : [];
    const hiddenRows = allRows.filter((e) => e && e.hidden === true);
    const entries = allRows
      .filter((e) => e && e.hidden !== true)
      .sort((a, b) => (Number(b.percentage) || 0) - (Number(a.percentage) || 0));
    // If the school withheld students at publish time, the snapshot's best
    // VISIBLE entries are NOT the real toppers and the stored
    // highest_percentage is withheld (0) — exactly why the public page shows
    // a dash for Highest % and never crowns the visible top 3. Mirror that
    // behaviour here so AI consumers are never told the wrong achievers.
    // total_students / passing_count / average_percentage already include
    // the hidden students, so they stay.
    const hasHiddenStudents =
      hiddenRows.length > 0 ||
      (Number.isFinite(m.total_students) && m.total_students > entries.length);
    const hiddenCount = hasHiddenStudents
      ? Math.max(
          hiddenRows.length,
          Number.isFinite(m.total_students) ? m.total_students - entries.length : 0,
          0
        )
      : 0;
    return {
      title:
        m.title ||
        (m.scope === "school"
          ? `School merit list${m.year ? ` ${m.year}` : ""}`
          : m.scope === "school-bise"
            ? `BISE merit list${m.year ? ` ${m.year}` : ""}`
            : `Class ${m.class ?? "?"} merit list${m.year ? ` ${m.year}` : ""}`),
      scope: m.scope || null,
      class: m.scope === "school" ? null : m.class ?? null,
      exam: m.exam_type || null,
      year: m.year ?? null,
      status: ts && ts > now ? "scheduled" : "live",
      publish_at: m.publish_at || null,
      total_students: m.total_students ?? (allRows.length || null),
      passing_count: m.passing_count ?? null,
      highest_percentage: hasHiddenStudents ? null : (m.highest_percentage ?? null),
      average_percentage: m.average_percentage ?? null,
      hidden_students: hiddenCount > 0 ? hiddenCount : undefined,
      // Top 3 positions only — full ranked list is on the public page.
      // Omitted entirely while the school keeps the toppers hidden.
      top_positions: hasHiddenStudents
        ? []
        : entries.slice(0, 3).map((e, i) => ({
            position: e.position ?? i + 1,
            name: e.full_name || null,
            class: e.class ?? null,
            percentage: e.percentage ?? null,
            grade: e.grade || null,
          })),
      top_positions_hidden: hasHiddenStudents ? true : undefined,
      notes: m.notes || null,
      url: `${SITE_URL}/merit-list`,
    };
  });
}

// ── Exam roll number slip sessions (metadata only — the /roll-no-slip page) ─
// The slips themselves are PRIVATE per student (found by class + full name),
// so this fetcher exposes ONLY session metadata — which exam sessions are
// live or scheduled — never any student rows or roll numbers.
async function fetchRollSlipSessions(limit = 10) {
  const rows = await safeQuery("exam_roll_sessions_public", (sb) =>
    sb
      .from("exam_roll_sessions")
      .select("id, title, exam_year, exam_term, class_order, is_published, publish_at, countdown_label")
      .or("is_published.eq.true,publish_at.not.is.null")
      .order("publish_at", { ascending: true, nullsFirst: false })
      .limit(limit)
  );
  const now = Date.now();
  return rows.map((s) => {
    const ts = s.publish_at ? new Date(s.publish_at).getTime() : null;
    return {
      title: s.title || [s.exam_term, s.exam_year].filter(Boolean).join(" "),
      exam_year: s.exam_year ?? null,
      exam_term: s.exam_term || null,
      classes: Array.isArray(s.class_order) ? s.class_order : null,
      status: ts && ts > now ? "scheduled" : "live",
      publish_at: ts && ts > now ? s.publish_at : null,
      countdown_label: s.countdown_label || null,
      url: `${SITE_URL}/roll-no-slip`,
      how_to_find:
        "A student opens the Roll No. Slip page, picks their class, types their full name and searches — only their own slip appears, which they can download as a PDF or share.",
    };
  });
}

// ── Gallery (public albums + photos — shown on the public /gallery page) ────
// Previously /gallery had NO fetcher at all: every AI crawler only ever read
// a generic two-paragraph description while real albums and photos existed.
async function fetchGallery(limit = 10) {
  const albums = await safeQuery("gallery_albums", (sb) =>
    sb
      .from("gallery_albums")
      .select("id, title, description, cover_url, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
  );
  if (!albums.length) return { albums: [], photos: [] };

  // Photo counts + recent captions per album (one lightweight query).
  const photos = await safeQuery("gallery_photos", (sb) =>
    sb
      .from("gallery_photos")
      .select("id, album_id, photo_url, caption, media_type, created_at")
      .order("created_at", { ascending: false })
      .limit(120)
  );
  const byAlbum = new Map();
  for (const p of photos) {
    if (!byAlbum.has(p.album_id)) byAlbum.set(p.album_id, []);
    byAlbum.get(p.album_id).push(p);
  }
  return {
    albums: albums.map((a) => {
      const list = byAlbum.get(a.id) || [];
      return {
        id: a.id,
        title: a.title,
        description: a.description || null,
        cover_url: a.cover_url || null,
        photo_count: list.length,
        video_count: list.filter((p) => p.media_type === "video").length,
        // First few captions give AI tools real context about the photos.
        sample_captions: list
          .slice(0, 5)
          .map((p) => p.caption)
          .filter(Boolean),
        added_at: a.created_at,
        url: `${SITE_URL}/gallery`,
      };
    }),
    photos: photos.slice(0, 30).map((p) => ({
      album_id: p.album_id,
      url: p.photo_url,
      caption: p.caption || null,
      type: p.media_type || "image",
    })),
  };
}

// ── Notes (public subjects + published chapters — the /notes section) ───────
// Previously /notes and /notes/<subject> had NO fetcher: AI tools never saw
// the real subject list or any chapter, even though teachers publish both.
async function fetchNotes() {
  const subjects = await safeQuery("note_subjects", (sb) =>
    sb
      .from("note_subjects")
      .select("id, name, slug, emoji, description, class_level, display_order")
      .eq("is_visible", true)
      .order("display_order", { ascending: true })
      .limit(30)
  );
  const chapters = await safeQuery("note_chapters", (sb) =>
    sb
      .from("note_chapters")
      .select("id, subject_id, title, slug, description, chapter_number, read_time_mins, difficulty, is_published")
      .eq("is_published", true)
      .order("chapter_number", { ascending: true })
      .limit(300)
  );
  const chaptersBySubject = new Map();
  for (const c of chapters) {
    if (!chaptersBySubject.has(c.subject_id)) chaptersBySubject.set(c.subject_id, []);
    chaptersBySubject.get(c.subject_id).push(c);
  }
  return {
    subjects: subjects.map((s) => {
      const list = chaptersBySubject.get(s.id) || [];
      return {
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description || null,
        class_level: s.class_level || null,
        chapter_count: list.length,
        url: `${SITE_URL}/notes/${s.slug}`,
      };
    }),
    chapters: chapters.map((c) => ({
      subject_id: c.subject_id,
      title: c.title,
      slug: c.slug,
      description: c.description || null,
      chapter_number: c.chapter_number ?? null,
      read_time_mins: c.read_time_mins ?? null,
      difficulty: c.difficulty || null,
    })),
  };
}

// ── Duty roster (already displayed on the public /duty page) ────────────────
async function fetchDuty() {
  const rows = await safeQuery("duty_board", (sb) =>
    sb
      .from("duty_board")
      .select("id, classes, chief_proctor, updated_at")
      .order("id", { ascending: true })
      .limit(1)
  );
  const d = rows[0];
  if (!d) return null;
  return {
    chief_proctor: d.chief_proctor || null,
    // classes: { "6": { monitor, proctor, nazira, head_boy, social_worker }, … }
    classes: d.classes || null,
    updated_at: d.updated_at || null,
  };
}

async function fetchExamInfo() {
  // Which exams exist (names + years only — NO student rows, NO marks).
  // The results table is PII-sensitive; this metadata alone is safe and is
  // all an AI needs to answer "which results are published?".
  //
  // ⚠ BUGFIX (2026-08): this query previously selected `exam_name, exam_year,
  // class_level` — columns that DO NOT EXIST on the results table (the real
  // columns are `exam_type`, `year`, `class`). PostgREST rejected every call
  // with a 42703 error, safeQuery swallowed it, and AI tools always read
  // "0 published exams" even when results were published. Correct columns +
  // is_published filter now.
  const rows = await safeQuery("results_meta", (sb) =>
    sb
      .from("results")
      .select("exam_type, year, class")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(500)
  );
  const seen = new Set();
  const exams = [];
  for (const r of rows) {
    const key = `${r.exam_type}|${r.year}|${r.class}`;
    if (!r.exam_type || seen.has(key)) continue;
    seen.add(key);
    exams.push({
      exam: r.exam_type,
      year: r.year ?? null,
      class: r.class ?? null,
    });
    if (exams.length >= 12) break;
  }
  return {
    published_exams: exams,
    how_to_check:
      "Select the exam on ghsbabikhel.dpdns.org/results and enter the student's roll number. Result cards with subject-wise marks are on ghsbabikhel.dpdns.org/result-card. BISE Peshawar SSC results are fetched live from the official board portal on the same page.",
    grading: {
      "A+": "90% and above",
      A: "80–89%",
      B: "60–79%",
      C: "45–59%",
      D: "33–44%",
      Fail: "below 33%",
    },
    note: "Individual student marks are private — they are only shown to the person searching with the exact roll number, never listed publicly.",
  };
}

/** Section fetchers registry — each section maps to one DB fetch. */
const SECTION_FETCHERS = {
  school: fetchSchoolProfile,
  admission: fetchAdmissionInfo,
  admissionFiles: fetchAdmissionFiles,
  notices: () => fetchNotices(20),
  news: () => fetchNews(20),
  events: () => fetchEvents(30),
  teachers: () => fetchTeachers(50),
  library: () => fetchLibraryFiles(20),
  meritLists: () => fetchMeritLists(10),
  rollSlips: () => fetchRollSlipSessions(10),
  exams: fetchExamInfo,
  gallery: () => fetchGallery(10),
  notes: fetchNotes,
  duty: fetchDuty,
};

// Which sections each public route needs. PER-ROUTE FETCHING (2026-08):
// previously EVERY page — including /faq, whose content is a static dataset —
// ran the full 9-query snapshot with up to 8 s of timeout headroom per query,
// which is what produced the "crawler timeout" reports on /faq. Now a page
// only queries the sections it actually renders, so responses are fast.
const ROUTE_SECTIONS = {
  "/":                ["school", "admission", "admissionFiles", "notices", "news", "events"],
  "/admission":       ["school", "admission", "admissionFiles"],
  "/notices":         ["school", "notices"],
  "/news":            ["school", "news"],
  "/results":         ["school", "exams"],
  "/merit-list":      ["school", "exams", "meritLists"],
  "/roll-no-slip":    ["school", "exams", "rollSlips"],
  "/result-card":     ["school", "exams"],
  "/calendar":        ["school", "events"],
  "/teachers":        ["school", "teachers"],
  "/gallery":         ["school", "gallery"],
  "/library":         ["school", "library"],
  "/duty":            ["school", "duty"],
  "/notes":           ["school", "notes"],
  "/faq":             ["school"],
  "/about":           ["school"],
  "/contact":         ["school"],
  // every /notes/<subject> and /notes/<subject>/<chapter> route
  __notes:            ["school", "notes"],
  // notice/news detail pages
  __detail:           ["school"],
};

/** Sections required for a route. Notes routes and detail routes fall back to
 *  their family defaults. */
function sectionsForRoute(route) {
  if (ROUTE_SECTIONS[route]) return ROUTE_SECTIONS[route];
  if (route.startsWith("/notes/")) return ROUTE_SECTIONS.__notes;
  return ROUTE_SECTIONS.__detail; // detail pages (notices/news/<id>)
}

/**
 * Fetch a live snapshot containing ONLY the sections a route needs.
 * Every section is independent — a failure in one never blocks the others.
 * All sections run in parallel, so the response is bounded by the slowest
 * single query (≤ 8 s), never by their sum.
 */
async function getLiveSiteData(sections) {
  const wanted = sections || Object.keys(SECTION_FETCHERS); // default: all (AI feed)
  const entries = await Promise.all(
    wanted.map(async (key) => {
      const fetcher = SECTION_FETCHERS[key];
      if (!fetcher) return [key, null];
      try {
        return [key, await fetcher()];
      } catch {
        return [key, null];
      }
    })
  );
  const data = {};
  for (const [key, value] of entries) data[key] = value;
  // Sensible empty defaults so consumers never crash on a missing section.
  data.school = data.school || {
    ...FALLBACK_SETTINGS,
    full_name: "Government High School Babi Khel",
    location: FALLBACK_SETTINGS.address,
    district: "Mohmand",
    province: "Khyber Pakhtunkhwa",
    country: "Pakistan",
    tagline: "Excellence in Education",
    description: "",
    total_students: null,
    total_teachers: null,
    pass_percentage: null,
    classes_offered: ["6", "7", "8", "9", "10"],
    board: "BISE Peshawar",
    website: SITE_URL,
    facebook: "https://www.facebook.com/share/1EERTSk1W7/",
  };
  data.admission = data.admission || { currently_open: null, how_to_apply: [], required_documents: [] };
  data.admissionFiles = data.admissionFiles || [];
  data.notices = data.notices || [];
  data.news = data.news || [];
  data.events = data.events || { upcoming: [], recent: [] };
  data.teachers = data.teachers || [];
  data.library = data.library || [];
  data.meritLists = data.meritLists || [];
  data.rollSlips = data.rollSlips || [];
  data.exams = data.exams || { published_exams: [], grading: {} };
  data.gallery = data.gallery || { albums: [], photos: [] };
  data.notes = data.notes || { subjects: [], chapters: [] };
  data.faq = { categories: FAQ_CATEGORIES, items: FAQ_ITEMS };
  return data;
}

/** ISO timestamp right now, in the school's timezone, for display. */
function nowInSchoolTz() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: SCHOOL_TZ,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

/** Escape a string for safe interpolation into HTML. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape a string for safe interpolation inside a JS/JSON <script> tag. */
function escJson(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/** Pretty date (dd Month yyyy, school timezone) from an ISO string. */
function prettyDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: SCHOOL_TZ,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}
// ───────────────────────────── end inlined data layer ────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Static routes this renderer accepts (mirrors prerender STATIC_ROUTES).
const STATIC_ROUTES = new Set([
  "/", "/about", "/contact", "/admission", "/notices", "/news", "/results",
  "/merit-list", "/roll-no-slip", "/result-card", "/calendar", "/teachers", "/gallery", "/library",
  "/duty", "/notes", "/notes/math", "/notes/physics",
  "/notes/chemistry", "/notes/biology", "/notes/english", "/notes/urdu",
  "/notes/islamiat", "/notes/pakistan-studies", "/notes/computer", "/faq",
]);

// Legacy subject aliases that older sitemapes/links used before the site
// stored real subject slugs in the database (e.g. "math" → "mathematics",
// "chemistry" → "chemistry6"). A crawler (or a human) opening one of these
// old URLs now receives the content of the REAL subject instead of a 404 or
// a redirect loop — mirrors what the React app does, but crawler-friendly.
const SUBJECT_SLUG_ALIASES = {
  math: "mathematics",
  chemistry: "chemistry6",
  biology: "biology",
  computer: "computer",
};

// ── Minimal inline styling — for the rare human eye; bots read the text ─────
const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.7;color:#29231C;background:#FDFBF6}
header,footer{background:#7C2D12;color:#fff;padding:20px}
header a,footer a{color:#FBE3CC}
.wrap{max-width:860px;margin:0 auto;padding:24px 20px}
h1{font-size:1.7em;margin:.2em 0 .6em;line-height:1.25}
h2{font-size:1.25em;margin:1.6em 0 .5em;color:#9A3412;border-bottom:2px solid #F0E4D2;padding-bottom:.25em}
a{color:#C2410C}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #E5D9C6;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#FAF3E6}
.badge{display:inline-block;font-size:.75em;font-weight:700;padding:2px 10px;border-radius:999px;margin-right:6px;vertical-align:middle}
.badge-open{background:#FFEDD5;color:#9A3412}
.badge-closed{background:#fee2e2;color:#991b1b}
.meta{color:#75695C;font-size:.9em}
article{border:1px solid #E5D9C6;border-radius:10px;padding:16px 18px;margin:14px 0}
footer .cols{display:flex;flex-wrap:wrap;gap:24px}
footer ul{list-style:none;padding:0;margin:0}
.small{font-size:.85em}
`;

// ── Detail fetchers (full content of ONE published item) ────────────────────
async function fetchNoticeDetail(id) {
  const rows = await safeQuery(`notice:${id}`, (sb) =>
    sb
      .from("notices")
      .select("id, title, content, category, is_urgent, created_at")
      .eq("id", id)
      .eq("is_published", true)
      .limit(1)
  );
  return rows[0] || null;
}
async function fetchNewsDetail(id) {
  const rows = await safeQuery(`news:${id}`, (sb) =>
    sb
      .from("news")
      .select("id, title, content, image_url, created_at")
      .eq("id", id)
      .eq("is_published", true)
      .limit(1)
  );
  return rows[0] || null;
}

// ── Small HTML helpers ───────────────────────────────────────────────────────
const listHtml = (items) =>
  items.length
    ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
    : "";
const linkList = (items, emptyText) =>
  items.length
    ? `<ul>${items
        .map(
          ([label, href, extra]) =>
            `<li><a href="${esc(href)}">${esc(label)}</a>${extra ? ` — <span class="meta">${esc(extra)}</span>` : ""}</li>`
        )
        .join("")}</ul>`
    : `<p class="meta">${esc(emptyText || "")}</p>`;

/** Admission live-status box (rendered into /admission and /). */
function admissionStatusHtml(admission) {
  const open = admission.currently_open;
  const badge =
    open === true
      ? `<span class="badge badge-open">OPEN</span>`
      : open === false
        ? `<span class="badge badge-closed">PAUSED</span>`
        : `<span class="badge" style="background:#e2e8f0;color:#334155">SEE PAGE</span>`;
  const lines = [];
  if (admission.session_year) lines.push(`Session: ${admission.session_year}`);
  if (admission.open_date) lines.push(`Applications open: ${prettyDate(admission.open_date)}`);
  if (admission.last_date) lines.push(`Last date to apply: ${prettyDate(admission.last_date)}`);
  return `<h2>Admission status — updated live</h2>
<p><strong>${badge} ${esc(
    open === true ? "Online admission form is open" : open === false ? "Online admission form is paused" : "Check the Admission page for the live status"
  )}</strong></p>
${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
${admission.banner_message ? `<p><em>${esc(admission.banner_message)}</em></p>` : ""}`;
}

/** Real downloadable admission files (admin-uploaded, category "Admission"). */
function admissionFilesHtml(admissionFiles) {
  if (!Array.isArray(admissionFiles) || !admissionFiles.length) return "";
  return `<h2>Downloadable admission forms and documents (live)</h2>
<p class="meta">These are the actual files the school office maintains — direct download links, no sign-in required.</p>
<ul>${admissionFiles
    .map(
      (f) =>
        `<li><a href="${esc(f.download_url)}" rel="noopener">${esc(f.title)}</a>${f.file_type ? ` — ${esc(f.file_type)}` : ""}${f.description ? `<br><span class="meta">${esc(f.description.slice(0, 200))}</span>` : ""}</li>`
    )
    .join("")}</ul>`;
}

/** Route-specific LIVE sections appended after the static blocks. */
function liveSections(route, data) {
  const parts = [];
  const { admission, admissionFiles, notices, news, events, exams, teachers, library, meritLists, rollSlips, gallery, notes, duty, school } = data;

  // Notes subject / chapter pages are handled by their own builders below.
  const isNotesSubject = route.startsWith("/notes/") && route.split("/").filter(Boolean).length === 2;
  const isNotesChapter = route.startsWith("/notes/") && route.split("/").filter(Boolean).length === 3;

  switch (true) {
    case route === "/": {
      // Real numbers straight from the admin dashboard — so AI tools quote
      // actual statistics instead of a meaningless "0+".
      const stats = [];
      if (school?.total_students != null) stats.push(`${school.total_students}+ students enrolled`);
      if (school?.total_teachers != null) stats.push(`${school.total_teachers} teachers`);
      if (school?.pass_percentage != null) stats.push(`${school.pass_percentage}% pass rate`);
      stats.push(`Established ${school?.established || "2018"}`);
      if (stats.length) {
        parts.push("<h2>School at a glance (live)</h2>");
        parts.push(`<ul>${stats.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`);
      }
      parts.push("<h2>Latest notices (live)</h2>");
      parts.push(
        linkList(
          notices.slice(0, 10).map((n) => [n.title, `/notices/${n.id}`, prettyDate(n.published_at)]),
          "Open the Notices page for the latest official notices."
        )
      );
      parts.push("<h2>Latest news (live)</h2>");
      parts.push(
        linkList(
          news.slice(0, 10).map((n) => [n.title, `/news/${n.id}`, prettyDate(n.published_at)]),
          "Open the News page for the latest school news."
        )
      );
      if (events.upcoming.length) {
        parts.push("<h2>Upcoming events (live)</h2>");
        parts.push(
          `<table><tr><th>Date</th><th>Event</th></tr>${events.upcoming
            .slice(0, 10)
            .map(
              (e) =>
                `<tr><td>${esc(prettyDate(e.start_date))}</td><td>${esc(e.title)}${
                  e.end_date && e.end_date !== e.start_date ? ` – ${esc(prettyDate(e.end_date))}` : ""
                }</td></tr>`
            )
            .join("")}</table>`
        );
      }
      break;
    }
    case route === "/admission": {
      parts.push(admissionStatusHtml(admission));
      parts.push("<h2>How to apply (full procedure)</h2>");
      parts.push(
        `<ol>${admission.how_to_apply.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
      );
      parts.push("<h2>Required documents</h2>");
      parts.push(listHtml(admission.required_documents.map((d) => esc(d))));
      // Real admin-uploaded files with direct URLs (prospectus, fee
      // structure, transfer letter, rules …) — live from the library.
      const filesHtml = admissionFilesHtml(admissionFiles);
      if (filesHtml) parts.push(filesHtml);
      parts.push(`<h2>Documents generated on the Admission page itself</h2>
<ul>
<li>Admission Prospectus (PDF) — school introduction, admission process and rules</li>
<li>Fee Structure (PDF) — free-of-charge government education, BISE Peshawar exam fees where applicable</li>
<li>School-to-School Transfer Reference Letter (PDF) — for migration cases between schools</li>
<li>Admission Rules &amp; Regulations (PDF) — eligibility, documents and code of conduct</li>
</ul>
<p class="meta">If a downloadable file for one of these documents is listed above, prefer that direct link. Otherwise these documents are generated on the page itself (open it in a browser and use the download buttons); the online application form and the application-status tracker are on the same page.</p>`);
      break;
    }
    case route === "/notices": {
      parts.push("<h2>All recent notices (live, newest first)</h2>");
      parts.push(
        notices
          .map(
            (n) => `<article><h3><a href="/notices/${esc(n.id)}">${esc(n.title)}</a></h3>
<p class="meta">${esc(prettyDate(n.published_at))}${n.category ? ` · ${esc(n.category)}` : ""}${n.urgent ? " · <strong>URGENT</strong>" : ""}</p>
<p>${esc((n.content || "").slice(0, 600))}${(n.content || "").length > 600 ? "…" : ""}</p></article>`
          )
          .join("") || `<p class="meta">No notices published yet.</p>`
      );
      break;
    }
    case route === "/news": {
      parts.push("<h2>All recent news (live, newest first)</h2>");
      parts.push(
        news
          .map(
            (n) => `<article><h3><a href="/news/${esc(n.id)}">${esc(n.title)}</a></h3>
<p class="meta">${esc(prettyDate(n.published_at))}</p>
<p>${esc((n.content || "").slice(0, 600))}${(n.content || "").length > 600 ? "…" : ""}</p></article>`
          )
          .join("") || `<p class="meta">No news published yet.</p>`
      );
      break;
    }
    case route === "/results" || route === "/result-card": {
      // Live BISE Peshawar section — only on /results (result-card is a
      // different, school-only page) and only when the fetch above
      // succeeded. Mirrors exactly what real visitors see: either a live
      // countdown to the announcement, or a "results are live" notice.
      if (route === "/results" && bisep && bisep.ok && bisep.exam_title) {
        const examTitle = esc(bisep.exam_title.trim());
        if (bisep.is_live) {
          parts.push(
            `<h2>${examTitle} — Results are LIVE (BISE Peshawar)</h2>` +
            `<p>${examTitle} results have been announced by BISE Peshawar and are live now. Search your result by roll number on this page — fetched live from the official board portal, cloud.bisep.edu.pk.</p>`
          );
        } else if (bisep.countdown_date) {
          const announceDate = new Date(bisep.countdown_date);
          const formatted = isNaN(announceDate.getTime())
            ? null
            : announceDate.toLocaleString("en-US", {
                weekday: "long", day: "numeric", month: "long", year: "numeric",
                hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi",
              });
          parts.push(
            `<h2>${examTitle} Result — Countdown (BISE Peshawar)</h2>` +
            `<p>${examTitle} results will be announced by BISE Peshawar${formatted ? ` on ${esc(formatted)} (Pakistan Standard Time)` : ""}. A live countdown is shown on this page; once announced, search by roll number here or directly at cloud.bisep.edu.pk.</p>`
          );
        } else {
          parts.push(
            `<h2>${examTitle} Result (BISE Peshawar)</h2>` +
            `<p>${examTitle} is the current exam cycle on BISE Peshawar's result portal. Search your result by roll number on this page once announced — fetched live from cloud.bisep.edu.pk.</p>`
          );
        }
      }
      if (exams.published_exams.length) {
        parts.push("<h2>Currently published exams (live)</h2>");
        parts.push(
          `<ul>${exams.published_exams
            .map((e) => `<li>${esc(e.exam)}${e.class ? ` — Class ${esc(e.class)}` : ""}${e.year ? ` (${esc(String(e.year))})` : ""}</li>`)
            .join("")}</ul>`
        );
      } else {
        parts.push(`<p class="meta">No school-published exam results are available at this moment. Results appear here as soon as the school administration publishes them on the Results page.</p>`);
      }
      parts.push(
        `<p class="meta">Individual results are private: they appear only when the correct roll number is entered on the Results page. Student marks are never listed publicly on this site.</p>`
      );
      break;
    }
    case route === "/merit-list": {
      if (meritLists.length) {
        parts.push("<h2>Published merit lists (live)</h2>");
        parts.push(
          meritLists
            .map((m) => {
              const stats = [];
              if (m.total_students != null) stats.push(`${m.total_students} students`);
              if (m.passing_count != null) stats.push(`${m.passing_count} passed`);
              if (m.highest_percentage != null) stats.push(`highest ${m.highest_percentage}%`);
              if (m.average_percentage != null) stats.push(`average ${m.average_percentage}%`);
              const top = (m.top_positions || [])
                .map((t) => `${t.position}. ${t.name || "—"}${t.class ? ` (Class ${t.class})` : ""}${t.percentage != null ? ` — ${t.percentage}%` : ""}`)
                .join("; ");
              const topLine = m.top_positions_hidden
                ? `<p>Top position holders are temporarily hidden by the school — they will be revealed at the official announcement. All statistics (total students, passed, average) include every student.</p>`
                : top
                  ? `<p>Top positions: ${esc(top)}</p>`
                  : "";
              return `<article><h3>${esc(m.title)}${m.exam ? ` — ${esc(m.exam)}` : ""}${m.year ? ` ${esc(String(m.year))}` : ""}${m.status === "scheduled" ? " (scheduled)" : ""}</h3>${stats.length ? `<p class="meta">${esc(stats.join(" · "))}</p>` : ""}${topLine}${m.notes ? `<p class="meta">${esc(m.notes)}</p>` : ""}</article>`;
            })
            .join("")
        );
      } else {
        parts.push(`<p class="meta">No merit list is published at this moment. When the school office publishes exam rankings (top position holders per class or school-wide), they appear on the Merit List page.</p>`);
      }
      break;
    }
    case route === "/roll-no-slip": {
      const liveSlips = rollSlips.filter((s) => s.status === "live");
      const scheduledSlips = rollSlips.filter((s) => s.status === "scheduled");
      if (liveSlips.length) {
        parts.push("<h2>Exam roll number slips (live)</h2>");
        parts.push(
          `<ul>${liveSlips
            .map((s) => `<li>${esc(s.title)}${Array.isArray(s.classes) && s.classes.length ? ` · Classes ${esc(s.classes.join(", "))}` : ""}</li>`)
            .join("")}</ul>`
        );
        parts.push(
          `<p>A student finds their own slip on the Roll No. Slip page: pick the class, type the student's full name and search — only that student's slip appears, with its QR code, the class exam date sheet and the exam-day instructions, and it can be downloaded as a PDF identical to the office copy. No slip, no entry to the examination hall.</p>`
        );
      } else if (scheduledSlips.length) {
        parts.push("<h2>Exam roll number slips (scheduled)</h2>");
        parts.push(
          `<ul>${scheduledSlips
            .map((s) => `<li>${esc(s.title)} — publishes ${esc(prettyDate(s.publish_at))}${s.countdown_label ? ` · ${esc(s.countdown_label)}` : ""}</li>`)
            .join("")}</ul>`
        );
        parts.push(`<p class="meta">The slips appear automatically on the Roll No. Slip page the moment the countdown reaches zero.</p>`);
      } else {
        parts.push(`<p class="meta">No roll number slips are published or scheduled right now. When the school administration releases exam roll numbers, students find and download their own slip on the Roll No. Slip page by picking their class and typing their full name.</p>`);
      }
      break;
    }
    case route === "/calendar": {
      parts.push("<h2>School events (live)</h2>");
      if (events.upcoming.length) {
        parts.push("<h3>Upcoming</h3>");
        parts.push(
          `<table><tr><th>Date</th><th>Event</th><th>Type</th></tr>${events.upcoming
            .map(
              (e) =>
                `<tr><td>${esc(prettyDate(e.start_date))}${e.end_date && e.end_date !== e.start_date ? ` – ${esc(prettyDate(e.end_date))}` : ""}</td><td>${esc(e.title)}${e.description ? `<br><span class="meta">${esc(e.description)}</span>` : ""}</td><td>${esc(e.type)}</td></tr>`
            )
            .join("")}</table>`
        );
      }
      if (events.recent.length) {
        parts.push("<h3>Recent past</h3>");
        parts.push(
          `<ul>${events.recent.slice(0, 8).map((e) => `<li>${esc(e.title)} — ${esc(prettyDate(e.start_date))}</li>`).join("")}</ul>`
        );
      }
      if (!events.upcoming.length && !events.recent.length)
        parts.push(`<p class="meta">No events published yet.</p>`);
      break;
    }
    case route === "/teachers": {
      if (teachers.length) {
        parts.push("<h2>Current staff directory (live)</h2>");
        parts.push(
          `<ul>${teachers
            .map(
              (t) =>
                `<li><strong>${esc(t.name)}</strong>${t.subject ? ` — ${esc(t.subject)}` : ""}${t.qualification ? ` · ${esc(t.qualification)}` : ""}</li>`
            )
            .join("")}</ul>`
        );
      }
      break;
    }
    case route === "/library": {
      if (library.length) {
        parts.push("<h2>Latest downloadable materials (live)</h2>");
        parts.push(
          `<ul>${library
            .map(
              (f) =>
                `<li><a href="${esc(f.download_url || "/library")}">${esc(f.title)}</a>${f.class ? ` — Class ${esc(f.class)}` : ""}${f.subject ? ` · ${esc(f.subject)}` : ""}${f.category ? ` · ${esc(f.category)}` : ""}${f.description ? `<br><span class="meta">${esc(f.description.slice(0, 220))}</span>` : ""}</li>`
            )
            .join("")}</ul>`
        );
      } else {
        parts.push(`<p class="meta">No downloadable materials have been added to the library yet. When the school uploads books, past papers, notes or admission forms they will be listed here.</p>`);
      }
      break;
    }
    case route === "/gallery": {
      if (gallery.albums.length) {
        parts.push("<h2>Photo albums (live)</h2>");
        parts.push(
          gallery.albums
            .map((a) => {
              const captions = (a.sample_captions || []).length
                ? `<p class="meta">Photos include: ${esc(a.sample_captions.join("; "))}</p>`
                : "";
              return `<article>
<h3>${esc(a.title)}</h3>
${a.cover_url ? `<p><img src="${esc(a.cover_url)}" alt="${esc(a.title)} — photo album of Government High School Babi Khel" style="max-width:320px;border-radius:8px" /></p>` : ""}
${a.description ? `<p>${esc(a.description)}</p>` : ""}
<p class="meta">${a.photo_count} photo${a.photo_count === 1 ? "" : "s"}${a.video_count ? ` · ${a.video_count} video${a.video_count === 1 ? "" : "s"}` : ""}${a.added_at ? ` · added ${esc(prettyDate(a.added_at))}` : ""}</p>
${captions}
</article>`;
            })
            .join("")
        );
      } else {
        parts.push(`<p class="meta">No photo albums have been published yet. Albums added by the school administration (sports days, science fairs, study tours, national days) will appear here.</p>`);
      }
      break;
    }
    case route === "/duty": {
      if (duty && duty.classes) {
        const roles = ["monitor", "proctor", "nazira", "head_boy", "social_worker"];
        const roleLabels = { monitor: "Class Monitor", proctor: "Proctor", nazira: "Nazira", head_boy: "Head Boy", social_worker: "Social Worker" };
        const classIds = Object.keys(duty.classes).sort((a, b) => Number(a) - Number(b));
        if (classIds.length) {
          parts.push("<h2>Current duty roster (live)</h2>");
          if (duty.chief_proctor) parts.push(`<p><strong>Chief Proctor:</strong> ${esc(duty.chief_proctor)}</p>`);
          parts.push(
            `<table><tr><th>Class</th><th>Role</th><th>Student on duty</th></tr>${classIds
              .flatMap((cid) =>
                roles
                  .filter((r) => duty.classes[cid] && duty.classes[cid][r])
                  .map((r) => `<tr><td>${esc(cid)}</td><td>${esc(roleLabels[r] || r)}</td><td>${esc(duty.classes[cid][r])}</td></tr>`)
              )
              .join("")}</table>`
          );
          parts.push(`<p class="meta">This roster is maintained by the school administration and is the same one shown on the public Duty Roster page.</p>`);
        }
      }
      break;
    }
    case isNotesSubject: {
      const slug = route.split("/")[2];
      parts.push(notesSubjectHtml(slug, data));
      break;
    }
    case route === "/notes": {
      // Live subject directory — the static block above lists the nine
      // canonical subjects; this adds the real, current DB list with chapter
      // counts and links so crawlers always see today's subjects.
      if (notes.subjects.length) {
        parts.push("<h2>Current subjects (live)</h2>");
        parts.push(
          `<ul>${notes.subjects
            .map(
              (s) =>
                `<li><a href="/notes/${esc(s.slug)}">${esc(s.name)}</a> — Classes ${esc(s.class_level || "6–10")} · ${s.chapter_count} published chapter${s.chapter_count === 1 ? "" : "s"}${s.description ? `<br><span class="meta">${esc(s.description)}</span>` : ""}</li>`
            )
            .join("")}</ul>`
        );
      }
      break;
    }
    case isNotesChapter: {
      // Chapter pages build their own full content in renderHandler.
      break;
    }
    case route === "/faq": {
      // Grouped Q&A — the full FAQ with every answer inline.
      const byCat = new Map();
      for (const item of FAQ_ITEMS) {
        if (!byCat.has(item.category)) byCat.set(item.category, []);
        byCat.get(item.category).push(item);
      }
      for (const [cat, items] of byCat) {
        parts.push(`<h2>${esc(cat)}</h2>`);
        parts.push(
          items
            .map(
              (it) =>
                `<article><h3>${esc(it.question)}</h3><p>${esc(it.answer)}</p></article>`
            )
            .join("")
        );
      }
      break;
    }
    default:
      break;
  }
  return parts.join("\n");
}

/** Live section for a notes SUBJECT page (/notes/<slug>). */
function notesSubjectHtml(slug, data) {
  const { notes } = data;
  const subject =
    notes.subjects.find((s) => s.slug === slug) ||
    notes.subjects.find((s) => s.slug === (SUBJECT_SLUG_ALIASES[slug] || "\u0000"));
  if (!subject) {
    return `<h2>Available note subjects (live)</h2>${linkList(
      notes.subjects.map((s) => [s.name, `/notes/${s.slug}`, `Class ${s.class_level || "6–10"} · ${s.chapter_count} chapter${s.chapter_count === 1 ? "" : "s"}`]),
      "Subjects will be listed here as teachers publish them."
    )}`;
  }
  const chapters = data.notes.chapters.filter((c) => c.subject_id === subject.id);
  const chapterList = chapters.length
    ? `<h2>Chapters (live)</h2>
<ol>${chapters
        .map(
          (c) =>
            `<li><a href="/notes/${esc(subject.slug)}/${esc(c.slug)}">${esc(c.title)}</a>${c.read_time_mins ? ` — ${esc(String(c.read_time_mins))} min read` : ""}${c.difficulty ? ` · ${esc(c.difficulty)}` : ""}${c.description ? `<br><span class="meta">${esc(c.description)}</span>` : ""}</li>`
        )
        .join("")}</ol>`
    : `<p class="meta">No chapters have been published for this subject yet.</p>`;
  return `<h2>${esc(subject.name)} — live subject details</h2>
<p>${esc(subject.description || `Study notes for ${subject.name} at Government High School Babi Khel.`)}</p>
<p class="meta">Classes: ${esc(subject.class_level || "6–10")} · ${subject.chapter_count} published chapter${subject.chapter_count === 1 ? "" : "s"}</p>
${chapterList}
<p class="meta">Every chapter page contains the full chapter notes, and many include a practice quiz with questions written by the school's teachers.</p>`;
}

/** The live "School at a glance" list, shared by the __stats block and the
 *  placeholder-injection safety net. When `skip` is true (homepage — its live
 *  section already shows the numbers) an empty string is returned so the
 *  heading is not followed by a duplicated list. */
function statsListHtml(school, skip = false) {
  if (skip || !school) return "";
  const lis = [
    school.total_students != null ? `<li>${esc(String(school.total_students))}+ students enrolled</li>` : "",
    school.total_teachers != null ? `<li>${esc(String(school.total_teachers))} teachers</li>` : "",
    school.pass_percentage != null ? `<li>${esc(String(school.pass_percentage))}% pass rate</li>` : "",
    school.established != null ? `<li>Established ${esc(String(school.established))}</li>` : "",
  ].filter(Boolean);
  return lis.length ? `<ul>${lis.join("")}</ul>` : "";
}

/** Replace the build-time stats placeholder (from seo-page-content.mjs) with
 *  the LIVE numbers from school_settings. The prerender pipeline does the
 *  same at build time (prerender-lib.mjs); without this the LIVE-rendered
 *  /about, /contact, /faq, /results … pages showed no real statistics at all
 *  ("Exact enrolment and staff numbers are maintained by the school
 *  administration.") while / showed them — an inconsistency AI tools notice.
 *  Skipped on "/" because its live section already renders the same numbers. */
function injectLiveStats(html, school, route) {
  if (!html || !html.includes('<ul data-ghs-stats></ul>')) return html;
  const replacement = statsListHtml(school, route === "/");
  return html
    .replace(/<ul data-ghs-stats><\/ul>/, replacement)
    .replace(/\s*<p data-ghs-stats-empty>[\s\S]*?<\/p>/, "");
}

/** Strip HTML/style/script from a chapter's stored HTML content and return a
 *  plain-text excerpt (content is authored HTML with embedded <style>). */
function chapterTextExcerpt(html, maxChars = 2200) {
  if (!html) return "";
  let text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  // decode common entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "…";
  return text;
}

// ── Developer attribution (machine-readable layer ONLY — never visible UI) ──
// This website was independently designed and developed by Muhammad Faheem,
// a class-10 Computer Science student of the school, as a school/community
// project. The attribution is published as schema.org structured data (Person
// node referenced by WebSite.creator / WebSite.maintainer), as fields of the
// /api/ai-data JSON feed and as a section of /llms.txt. It is deliberately
// NOT rendered as visible page text, so the site's appearance is unchanged
// for humans while AI/search systems can answer "who developed this website?"
// — including his father's name and full home address, so even weak
// keyword-matching AI fetchers (Copilot, DeepSeek, lightweight scrapers)
// retrieve the complete developer profile in one hop.
// Entity @ids match src/components/seo/SiteSchema.tsx so search engines
// merge crawler-HTML and SPA-page structured data into one graph.
const DEVELOPER = {
  name: "Muhammad Faheem",
  role: "Student & Website Developer",
  schoolClass: "Class 10 (matric)",
  father: "Zabih Ullah",
  address:
    "Village Sangar, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa (KPK), Pakistan",
  nationality: "Pakistani",
  school: "GHS Babi Khel, District Mohmand",
  studies: "Class-10 (matric) Computer Science student at GHS Babi Khel",
  contribution: "Independently designed and developed this website",
  purpose: "School/community project",
  description:
    "Muhammad Faheem, son of Zabih Ullah, is a class-10 (matric) Computer Science student at Government High School Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan. He is a resident of Village Sangar, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa (KPK), Pakistan, and he independently designed and developed the school's official website (ghsbabikhel.dpdns.org) as a school/community project.",
};

const DEVELOPER_ADDRESS_JSONLD = {
  "@type": "PostalAddress",
  streetAddress: "Village Sangar, Tehsil Halimzai",
  addressLocality: "District Mohmand",
  addressRegion: "Khyber Pakhtunkhwa",
  addressCountry: "PK",
};

const DEVELOPER_PERSON_JSONLD = {
  "@type": "Person",
  "@id": `${SITE_URL}#website-developer`,
  name: DEVELOPER.name,
  alternateName: "Faheem",
  jobTitle: DEVELOPER.role,
  description: DEVELOPER.description,
  fatherName: DEVELOPER.father,
  parent: [
    {
      "@type": "Person",
      name: DEVELOPER.father,
      gender: "Male",
      description: "Father of Muhammad Faheem, the developer of the GHS Babi Khel website",
    },
  ],
  address: DEVELOPER_ADDRESS_JSONLD,
  homeLocation: { ...DEVELOPER_ADDRESS_JSONLD, name: "Village Sangar, Tehsil Halimzai, District Mohmand" },
  nationality: DEVELOPER.nationality,
  gender: "Male",
  affiliation: { "@id": `${SITE_URL}#organization` },
  knowsAbout: [
    "Computer Science",
    "Web Development",
    "React",
    "JavaScript",
    "TypeScript",
    "Tailwind CSS",
    "Web Design",
    "Search Engine Optimization",
  ],
  url: `${SITE_URL}/`,
};

/** JSON-LD per route (always fresh). */
function jsonLdFor(route, data, detail, pageName) {
  const generatedAt = new Date().toISOString();
  const graph = [
    {
      "@type": "EducationalOrganization",
      "@id": `${SITE_URL}#organization`,
      name: "Government High School Babi Khel, District Mohmand",
      alternateName: SITE_NAME,
      url: SITE_URL,
      telephone: data.school.phone,
      email: data.school.email,
      foundingDate: data.school.established,
      // Live admin-maintained statistics — so AI answers quote the current
      // numbers, never a stale build-time figure.
      ...(typeof data.school.total_students === "number"
        ? { numberOfStudents: data.school.total_students }
        : {}),
      address: {
        "@type": "PostalAddress",
        streetAddress: "Babi Khel",
        addressLocality: "Babi Khel",
        addressRegion: "Khyber Pakhtunkhwa",
        addressCountry: "PK",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}#website`,
      name: "Government High School Babi Khel",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}#organization` },
      // Correct creator/developer relationship: the website (a CreativeWork)
      // was created and is maintained by the student developer below.
      creator: { "@id": `${SITE_URL}#website-developer` },
      maintainer: { "@id": `${SITE_URL}#website-developer` },
    },
    {
      "@type": "WebPage",
      name: detail?.title || getPageMeta(route)?.title || SITE_NAME,
      url: `${SITE_URL}${route}`,
      isPartOf: { "@id": `${SITE_URL}#website` },
      // Freshness signal: this page was rendered from the live database NOW.
      dateModified: generatedAt,
    },
    DEVELOPER_PERSON_JSONLD,
  ];

  // ── BreadcrumbList — gives Google the site hierarchy for every page so it
  //    can show breadcrumb rich results in SERPs (the "Home > Section > Page"
  //    trail that replaces the bare URL in the search snippet). Maps each
  //    route to its section + page name; detail routes use the item's title.
  //    Drives BreadcrumbList schema for /about, /contact, /news, /notices,
  //    /results, /merit-list, /roll-no-slip, /calendar, /teachers, /library,
  //    /gallery, /faq, /duty, /admission, /result-card, /notes, /notes/<subj>,
  //    /notes/<subj>/<chapter>, /notices/<id>, /news/<id>.
  const BREADCRUMB_MAP = {
    "/about":        ["Our School",      "About"],
    "/contact":      ["Our School",      "Contact"],
    "/faq":          ["Our School",      "FAQ"],
    "/gallery":      ["Our School",      "Gallery"],
    "/news":         ["News & Events",   "News"],
    "/notices":      ["News & Events",   "Notices"],
    "/calendar":     ["News & Events",   "Calendar"],
    "/results":      ["Results",         "Exam Results"],
    "/merit-list":   ["Results",         "Merit List"],
    "/roll-no-slip": ["Results",         "Roll No. Slip"],
    "/result-card":  ["Results",         "Result Card"],
    "/admission":    ["Admissions",      "Apply for Admission"],
    "/notes":        ["Academics",       "Study Notes"],
    "/teachers":     ["Our School",      "Teachers"],
    "/library":      ["Academics",       "Library"],
    "/duty":         ["Our School",      "Duty Roster"],
  };
  let breadcrumbItems = null;
  if (BREADCRUMB_MAP[route]) {
    const [section, page] = BREADCRUMB_MAP[route];
    breadcrumbItems = [
      { name: "Home", url: SITE_URL },
      { name: section, url: `${SITE_URL}${route}` },
      { name: page, url: `${SITE_URL}${route}` },
    ];
  } else if (route.startsWith("/notes/") && !route.split("/")[3]) {
    // /notes/<subject> — try to find the subject name from the live data
    const slug = route.split("/")[2];
    const subj = data.notes?.subjects?.find((s) => s.slug === slug);
    breadcrumbItems = [
      { name: "Home", url: SITE_URL },
      { name: "Academics", url: `${SITE_URL}/notes` },
      { name: "Study Notes", url: `${SITE_URL}/notes` },
      { name: subj?.name || "Subject", url: `${SITE_URL}${route}` },
    ];
  } else if (route.startsWith("/notes/")) {
    // /notes/<subject>/<chapter> — chapter page
    const slug = route.split("/")[2];
    const subj = data.notes?.subjects?.find((s) => s.slug === slug);
    breadcrumbItems = [
      { name: "Home", url: SITE_URL },
      { name: "Academics", url: `${SITE_URL}/notes` },
      { name: subj?.name || "Subject", url: `${SITE_URL}/notes/${slug}` },
      { name: pageName || "Chapter", url: `${SITE_URL}${route}` },
    ];
  } else if (route.startsWith("/notices/") && detail) {
    breadcrumbItems = [
      { name: "Home", url: SITE_URL },
      { name: "Notices", url: `${SITE_URL}/notices` },
      { name: detail.title, url: `${SITE_URL}${route}` },
    ];
  } else if (route.startsWith("/news/") && detail) {
    breadcrumbItems = [
      { name: "Home", url: SITE_URL },
      { name: "News", url: `${SITE_URL}/news` },
      { name: detail.title, url: `${SITE_URL}${route}` },
    ];
  }
  if (breadcrumbItems) {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: b.url,
      })),
    });
  }

  if (route === "/faq") graph.push(buildFaqJsonLd());

  // Notes index → subject directory; subject page → chapter list. This is
  // how AI/search crawlers discover every published study chapter.
  if (route === "/notes" && data.notes?.subjects?.length) {
    graph.push({
      "@type": "ItemList",
      name: "Study note subjects — GHS Babi Khel",
      itemListElement: data.notes.subjects.slice(0, 30).map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: s.name,
        url: s.url,
      })),
    });
  }
  if (route.startsWith("/notes/") && !route.split("/")[3] && data.notes?.subjects?.length) {
    const slug = route.split("/")[2];
    const subject =
      data.notes.subjects.find((s) => s.slug === slug) ||
      data.notes.subjects.find((s) => s.slug === (SUBJECT_SLUG_ALIASES[slug] || "\u0000"));
    if (subject) {
      const chapters = data.notes.chapters.filter((c) => c.subject_id === subject.id);
      if (chapters.length) {
        graph.push({
          "@type": "ItemList",
          name: `${subject.name} chapters — GHS Babi Khel`,
          itemListElement: chapters.slice(0, 60).map((c, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: c.title,
            url: `${SITE_URL}/notes/${subject.slug}/${c.slug}`,
          })),
        });
      }
    }
  }
  if (route.startsWith("/notes/") && route.split("/")[3]) {
    // Chapter page → Article-like schema so it can surface as a learning
    // resource answer.
    graph.push({
      "@type": "Article",
      headline: detail?.title || pageName || "Study notes chapter",
      isPartOf: { "@type": "WebSite", name: "GHS Babi Khel — Study Notes", url: `${SITE_URL}/notes` },
      about: "Study notes chapter",
      mainEntityOfPage: `${SITE_URL}${route}`,
    });
  }
  if (route === "/gallery" && data.gallery?.albums?.length) {
    graph.push({
      "@type": "ImageGallery",
      name: "Photo gallery — GHS Babi Khel",
      associatedMedia: data.gallery.albums.slice(0, 10).map((a) => ({
        "@type": "ImageObject",
        name: a.title,
        contentUrl: a.cover_url || undefined,
        description: a.description || a.title,
      })),
    });
  }

  if (route === "/notices" && data.notices.length) {
    graph.push({
      "@type": "ItemList",
      name: "Recent notices — GHS Babi Khel",
      itemListElement: data.notices.slice(0, 20).map((n, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: n.title,
        url: n.url,
      })),
    });
  }
  if (route === "/news" && data.news.length) {
    graph.push({
      "@type": "ItemList",
      name: "Recent news — GHS Babi Khel",
      itemListElement: data.news.slice(0, 20).map((n, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: n.title,
        url: n.url,
      })),
    });
  }
  if (route.startsWith("/notices/") && detail) {
    graph.push({
      "@type": "Article",
      headline: detail.title,
      datePublished: detail.created_at,
      author: { "@type": "Organization", name: "GHS Babi Khel" },
      publisher: { "@type": "Organization", name: "GHS Babi Khel" },
      mainEntityOfPage: `${SITE_URL}${route}`,
    });
  }
  if (route.startsWith("/news/") && detail) {
    graph.push({
      "@type": "NewsArticle",
      headline: detail.title,
      datePublished: detail.created_at,
      author: { "@type": "Organization", name: "GHS Babi Khel" },
      publisher: { "@type": "Organization", name: "GHS Babi Khel" },
      mainEntityOfPage: `${SITE_URL}${route}`,
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

// ── MODE 2 constants — the machine-readable AI feed (former ai-data.js) ─────

// Static, timeless navigation + procedures that belong in every snapshot.
const PAGES_GUIDE = [
  { path: "/", purpose: "School overview, latest notices, news and highlights" },
  { path: "/admission", purpose: "Online admission application form + application status tracker (classes 6–10)" },
  { path: "/results", purpose: "Search school exam results by roll number; BISE Peshawar SSC results live from the board portal" },
  { path: "/merit-list", purpose: "Official merit list — top position holders and class/whole-school exam rankings published by the school office, with pass statistics and a live countdown while a list is scheduled" },
  { path: "/roll-no-slip", purpose: "Exam roll number slips — a student picks their class and types their full name to view, download (PDF with QR code) or share their own slip; a live countdown shows while a release is scheduled" },
  { path: "/result-card", purpose: "Detailed result cards with subject-wise marks, grades and class position" },
  { path: "/notices", purpose: "Official notices — exams, holidays, fee deadlines, parent-teacher meetings" },
  { path: "/news", purpose: "School news — events, achievements, sports" },
  { path: "/calendar", purpose: "Academic calendar — exam dates, holidays, events (ICS feed: /calendar.ics)" },
  { path: "/teachers", purpose: "Teaching staff directory" },
  { path: "/notes", purpose: "Free study notes for 9 subjects, classes 6–10, with quizzes and flashcards. Subject pages at /notes/<subject-slug> and individual chapters at /notes/<subject-slug>/<chapter-slug>" },
  { path: "/library", purpose: "Downloadable books, notes and past papers (each item links to its file)" },
  { path: "/gallery", purpose: "Photo albums of school events — sports day, science fair, study tours, national days" },
  { path: "/duty", purpose: "Student duty roster — class monitors, proctors and chief proctor" },
  { path: "/contact", purpose: "Contact details, map, WhatsApp and contact form" },
  { path: "/about", purpose: "School history, mission and vision" },
  { path: "/faq", purpose: "Frequently asked questions — admissions, results, contact, website usage" },
];

const RESULT_SEARCH_STEPS = [
  "Open " + "https://ghsbabikhel.dpdns.org/results",
  "Select the exam (class + examination name)",
  "Enter the student's roll number exactly as on the admit card",
  "View total/obtained marks, percentage, grade and pass status; open /result-card for the printable subject-wise card",
];

// Shared cache policy for /api/ai-data (GET and HEAD): one hour at every
// layer — browser (max-age) and Vercel CDN (s-maxage) — plus up to 24h of
// stale-while-revalidate so a slow revalidation never fails a crawler fetch.
const AI_DATA_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

// ── MODE 2 handler — the JSON feed (former api/ai-data.js, behaviour intact) ─
async function aiDataHandler(req, res) {
  // ── CORS: readable from any origin (AI agents, browser tools) — GET only ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }
  // HEAD support — health-check tools and crawler validators probe endpoints
  // with HEAD; a 405 here was reported as a failed check even though GET
  // worked. HEAD returns the exact same headers as GET with no body, and
  // without doing the DB work a body would need.
  if (req.method === "HEAD") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", AI_DATA_CACHE_CONTROL);
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const data = await getLiveSiteData();

  const payload = {
    // ── Meta ────────────────────────────────────────────────────────────────
    meta: {
      name: "GHS Babi Khel — AI data feed",
      description:
        "Live, machine-readable snapshot of Government High School Babi Khel (District Mohmand, KPK, Pakistan): school profile with real statistics, admission status and procedure, results info, published merit lists, roll-number-slip sessions, latest notices, news, events, teachers, library files, study notes subjects and chapters, photo gallery albums, duty roster, and the full FAQ. Generated on request from the school's own database — safe to quote.",
      generated_at: new Date().toISOString(),
      generated_at_display: `${nowInSchoolTz()} (PKT)`,
      timezone: "Asia/Karachi",
      freshness:
        "Data is fetched live from the school database on every request; the response is cached for one hour (Cache-Control max-age=3600) to keep the endpoint fast for repeat AI crawler hits, so answers can lag dashboard changes by up to an hour.",
      site_url: "https://ghsbabikhel.dpdns.org",
      companion_sources: [
        "https://ghsbabikhel.dpdns.org/llms.txt",
        "https://ghsbabikhel.dpdns.org/sitemap.xml",
        "https://ghsbabikhel.dpdns.org/rss.xml",
      ],
      content_type: "application/json; charset=utf-8",
      // Developer attribution (machine-readable only — never rendered in the
      // visual UI). Full details in the website_development section below.
      developer:
        "Muhammad Faheem — Student & Website Developer, class 10 (matric) at GHS Babi Khel, " +
        "son of Zabih Ullah, Village Sangar, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa (KPK), Pakistan",
    },

    // ── School profile (live) ───────────────────────────────────────────────
    school: data.school,

    // ── Website development (who built this website) ────────────────────────
    // Answers "Who developed/created the GHS Babi Khel website?" directly.
    // Machine-readable only — the visible UI does not show this section.
    // Field names are intentionally duplicated/aliased (father_name + father,
    // full_address + granular village/tehsil/district/province) so even weak
    // keyword-matching AI fetchers lock onto the exact facts in one read.
    website_development: {
      developed_by: DEVELOPER.name,
      direct_answer:
        `The GHS Babi Khel website was independently designed and developed by ${DEVELOPER.name}, ` +
        `a class-10 (matric) Computer Science student of GHS Babi Khel (District Mohmand, Khyber Pakhtunkhwa, Pakistan), ` +
        `son of ${DEVELOPER.father}, and a resident of ${DEVELOPER.address}, ` +
        `as a school/community project.`,
      developer: {
        name: DEVELOPER.name,
        full_name: DEVELOPER.name,
        role: DEVELOPER.role,
        father_name: DEVELOPER.father,
        father: DEVELOPER.father,
        class: DEVELOPER.schoolClass,
        school_class: "Class 10 at Government High School Babi Khel",
        studies: DEVELOPER.studies,
        school: DEVELOPER.school,
        school_full_name: "Government High School Babi Khel",
        address: DEVELOPER.address,
        full_address: DEVELOPER.address,
        address_parts: {
          village: "Village Sangar",
          tehsil: "Tehsil Halimzai",
          district: "District Mohmand",
          province: "Khyber Pakhtunkhwa (KPK)",
          country: "Pakistan",
        },
        nationality: DEVELOPER.nationality,
        contribution: DEVELOPER.contribution,
        purpose: DEVELOPER.purpose,
        website_url: SITE_URL,
      },
      structured_data:
        "Published as schema.org structured data on every page: a Person node (@id " +
        `${SITE_URL}#website-developer) referenced by WebSite.creator and WebSite.maintainer ` +
        "and linked to the school organization via Person.affiliation. The Person node " +
        "carries fatherName (Zabih Ullah), parent, address and homeLocation (Village " +
        "Sangar, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa, Pakistan).",
    },

    // ── Admissions (live status + timeless procedure) ───────────────────────
    admission: {
      ...data.admission,
      status_text:
        data.admission.currently_open === true
          ? `Admissions are OPEN${data.admission.session_year ? ` for session ${data.admission.session_year}` : ""}. Apply at ${data.admission.apply_url}.`
          : data.admission.currently_open === false
            ? `The online admission form is currently PAUSED by the school${data.admission.session_year ? ` (session ${data.admission.session_year})` : ""}. Check ${data.admission.apply_url} — it shows the live status — or download the printable form from the same page and submit it at the school office.`
            : `Admissions run every academic session for classes 6–10. Check ${data.admission.apply_url} for the current status.`,
      deadline_text: data.admission.last_date
        ? `Application deadline: ${data.admission.last_date}`
        : "No application deadline is currently published; see the Admission page for the live status.",
      // Admin-uploaded admission documents (prospectus, fee structure,
      // transfer letter, rules …) with DIRECT download URLs — from the same
      // library the Downloads section of the Admission page serves.
      downloadable_files: data.admissionFiles,
    },

    // ── Results (metadata only — no student data, ever) ─────────────────────
    results: {
      ...data.exams,
      search_steps: RESULT_SEARCH_STEPS,
    },

    // ── Latest content (live, newest first) ─────────────────────────────────
    latest_notices: data.notices,
    latest_news: data.news,
    calendar: {
      upcoming_events: data.events.upcoming,
      recent_events: data.events.recent,
      subscribe_ics: "https://ghsbabikhel.dpdns.org/calendar.ics",
    },
    teachers: data.teachers,
    library: data.library,

    // ── Merit lists (public rankings — the /merit-list page data) ───────────
    merit_lists: {
      page_url: "https://ghsbabikhel.dpdns.org/merit-list",
      note: "Official exam rankings published by the school office — top position holders per class and school-wide. Student entries are public on the page; only list metadata, statistics and the top 3 positions are included here.",
      lists: data.meritLists,
    },

    // ── Exam roll number slips (session metadata only — no student data) ────
    roll_no_slips: {
      page_url: "https://ghsbabikhel.dpdns.org/roll-no-slip",
      note: "Roll number slips are private per student: the student picks their class and types their full name to view/download their own slip (PDF with QR code, exam date sheet and exam-day instructions). Only session metadata is included here — never student rows or roll numbers.",
      sessions: data.rollSlips,
    },

    // ── Study notes (live subjects + published chapters) ───────────────────
    // Each subject lists its real slug + chapter count; chapter URLs follow
    // the pattern /notes/<subject-slug>/<chapter-slug> and are fully
    // crawlable (live-rendered for AI/search crawlers).
    notes: {
      index_url: "https://ghsbabikhel.dpdns.org/notes",
      subjects: data.notes.subjects,
      chapters: data.notes.chapters,
      chapter_url_pattern: "https://ghsbabikhel.dpdns.org/notes/<subject-slug>/<chapter-slug>",
    },

    // ── Photo gallery (live albums + recent photos) ────────────────────────
    gallery: {
      page_url: "https://ghsbabikhel.dpdns.org/gallery",
      albums: data.gallery.albums,
      recent_photos: data.gallery.photos,
    },

    // ── Duty roster (same public data as the /duty page) ───────────────────
    duty: data.duty,

    // ── FAQ (complete, categorised) ─────────────────────────────────────────
    faq: {
      page_url: "https://ghsbabikhel.dpdns.org/faq",
      categories: data.faq.categories,
      items: data.faq.items,
      count: FAQ_ITEMS.length,
    },

    // ── Where each piece of information lives ───────────────────────────────
    pages: PAGES_GUIDE,
  };

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // P2 hardening: 1-hour cache (browser + CDN). Keeps TTFB near-zero for
  // repeated AI-crawler hits while data stays reasonably fresh. CORS headers
  // above remain fully permissive (Access-Control-Allow-Origin: *).
  res.setHeader("Cache-Control", AI_DATA_CACHE_CONTROL);
  return res.status(200).send(JSON.stringify(payload));
}

// ── MODE 1 handler — live crawler HTML (former default export, intact) ──────
async function renderHandler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const rawPath = String(req.query?.path || "/");
  let route = "/";
  try {
    route = decodeURIComponent(rawPath.split("?")[0] || "/");
  } catch {
    route = String(rawPath || "/");
  }
  if (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);
  if (!route.startsWith("/")) route = "/" + route;

  // Detail routes: /notices/<uuid>, /news/<uuid>
  const detailMatch = route.match(/^\/(notices|news)\/([^/]+)$/);
  let detail = null;
  let detailKind = null;

  // Notes routes: /notes/<subject> and /notes/<subject>/<chapter>
  const notesMatch = route.match(/^\/notes\/([^/]+)(?:\/([^/]+))?$/);
  let notesSubject = null; // resolved subject (or null → render /notes index)
  let notesChapter = null; // resolved chapter row (chapter routes only)
  let notesEffectiveRoute = route; // canonical route after alias resolution
  let notesEarlyData = null; // snapshot fetched during notes resolution

  if (detailMatch) {
    detailKind = detailMatch[1];
    const id = detailMatch[2];
    if (!UUID_RE.test(id)) {
      return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(notFoundHtml(route));
    }
    detail = detailKind === "notices" ? await fetchNoticeDetail(id) : await fetchNewsDetail(id);
    if (!detail) {
      return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(notFoundHtml(route));
    }
  } else if (notesMatch) {
    // ⚠ Previously ANY /notes/<x> URL that wasn't in the hardcoded list got a
    // 404 here — including REAL chapter pages (/notes/<subject>/<chapter>)
    // that the React app serves. AI crawlers following chapter links from the
    // Notes pages hit dead ends. Now subjects and chapters are resolved
    // against the live database (with legacy alias support).
    const slug = notesMatch[1].toLowerCase();
    const chapterSlug = notesMatch[2] ? decodeURIComponent(notesMatch[2]) : null;
    const notesData = await getLiveSiteData(["school", "notes"]);
    const subjects = notesData.notes.subjects;
    const subject =
      subjects.find((s) => s.slug === slug) ||
      subjects.find((s) => s.slug === (SUBJECT_SLUG_ALIASES[slug] || "\u0000"));
    if (subject) {
      notesSubject = subject;
      notesEffectiveRoute = `/notes/${subject.slug}`;
      if (chapterSlug) {
        const chapterRow = await safeQuery(`note-chapter:${subject.id}:${chapterSlug}`, (sb) =>
          sb
            .from("note_chapters")
            .select("id, subject_id, title, slug, description, content, chapter_number, read_time_mins, difficulty, is_published, audio_enabled, pdf_url")
            .eq("subject_id", subject.id)
            .eq("slug", chapterSlug)
            .eq("is_published", true)
            .limit(1)
        );
        const chapter = chapterRow[0] || null;
        if (chapter) {
          notesChapter = chapter;
          notesEffectiveRoute = `/notes/${subject.slug}/${chapter.slug}`;
        }
        // unknown chapter → fall back to the subject page (mirrors the SPA)
      }
    } else {
      // unknown subject → render the /notes index (mirrors the SPA redirect)
      notesEffectiveRoute = "/notes";
    }
    // Reuse the data we already fetched — render continues below.
    notesEarlyData = notesData;
  } else if (!STATIC_ROUTES.has(route)) {
    // Strict allow-list — anything else is a 404 for crawlers.
    return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(notFoundHtml(route));
  }

  // Per-route live snapshot — only the sections this page renders. (Detail
  // pages need just school facts; /faq needs none of the dynamic tables.)
  const data = notesEarlyData || await getLiveSiteData(sectionsForRoute(route));

  // ── Live BISE Peshawar exam title / countdown (for /results only) ──────────
  // Crawlers (Google, AI tools) previously got a static "no results published"
  // snapshot even while real visitors saw a live BISE Peshawar countdown or
  // "results are live" banner — because that data only ever loaded client-side
  // via /api/bisep-proxy. Fetching it here (same runtime, no network hop) lets
  // the crawler-facing page carry the SAME live exam title, so the page can
  // rank for searches like "GHS Babi Khel result" / "HSSC Annual-I Examination
  // 2026 Result". A short guard keeps a slow/unreachable board from ever
  // delaying the whole render — on any failure this just stays null and the
  // page falls back to its normal static content, exactly as before.
  let bisep = null;
  if (route === "/results") {
    try {
      bisep = await Promise.race([
        getCurrentBisepPayload(Date.now()),
        new Promise((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);
    } catch {
      bisep = null;
    }
  }

  // ── Title / description ────────────────────────────────────────────────────
  let title, description, h1;
  if (detail) {
    title = `${detail.title} — ${detailKind === "notices" ? "Notice" : "News"} | GHS Babi Khel`;
    description =
      (detail.content || "").replace(/\s+/g, " ").trim().slice(0, 155) ||
      `${detailKind === "notices" ? "Official notice" : "News article"} from Government High School Babi Khel, District Mohmand.`;
    h1 = detail.title;
  } else if (notesSubject && notesChapter) {
    title = `${notesChapter.title} — ${notesSubject.name} Notes | GHS Babi Khel`;
    description =
      (notesChapter.description || chapterTextExcerpt(notesChapter.content, 150)).replace(/\s+/g, " ").trim().slice(0, 155) ||
      `${notesSubject.name} chapter notes from Government High School Babi Khel.`;
    h1 = notesChapter.title;
  } else if (notesSubject) {
    const meta = getPageMeta(notesEffectiveRoute) || getPageMeta(`/notes/${notesSubject.slug}`);
    title = `${notesSubject.name} Notes (Classes ${notesSubject.class_level || "6–10"}) — GHS Babi Khel`;
    description =
      (notesSubject.description || meta?.description || `Free ${notesSubject.name} notes for classes 6–10 of GHS Babi Khel.`)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 155);
    h1 = `${notesSubject.name} Notes`;
  } else if (route === "/results" && bisep && bisep.exam_title) {
    // Live BISE Peshawar exam is the more specific, more searched-for thing
    // on this page right now — lead the title/H1/description with it. Exact
    // exam title keeps the page matching what people are actually typing
    // into Google ("HSSC Annual-I Examination 2026 Result"), while still
    // keeping "GHS Babi Khel" for brand/local searches.
    const examTitle = bisep.exam_title.trim();
    title = `${examTitle} Result — GHS Babi Khel`;
    h1 = `${examTitle} Result`;
    description = bisep.is_live
      ? `${examTitle} results are LIVE. Search your BISE Peshawar SSC/HSSC result by roll number on GHS Babi Khel's results page — fetched live from the official board portal.`
      : `${examTitle} results — check the live countdown and search by roll number as soon as BISE Peshawar announces them, on GHS Babi Khel's results page.`;
  } else {
    const meta = getPageMeta(notesEffectiveRoute);
    title = meta?.title || `${SITE_NAME}`;
    description = meta?.description || "";
    h1 = meta?.h1 || SITE_NAME;
  }
  const canonical = `${SITE_URL}${notesEffectiveRoute === "/" ? "/" : notesEffectiveRoute}`;

  // ── Body content ───────────────────────────────────────────────────────────
  let contentHtml;
  if (detail) {
    contentHtml = `<p class="meta">${esc(prettyDate(detail.created_at))}${
      detail.category ? ` · ${esc(detail.category)}` : ""
    }${detail.is_urgent ? " · <strong>URGENT</strong>" : ""}</p>
${detail.content ? detail.content.split(/\n{2,}|\n/).map((p) => `<p>${esc(p)}</p>`).join("") : "<p class=\"meta\">(No further text — see the page for details or contact the school.)</p>"}
<p><a href="/${detailKind}">← All ${detailKind}</a></p>`;
  } else if (notesSubject && notesChapter) {
    // Chapter page — full study notes as text excerpt + context.
    const excerpt = chapterTextExcerpt(notesChapter.content, 4000);
    const metaLine = [];
    if (notesChapter.chapter_number != null) metaLine.push(`Chapter ${notesChapter.chapter_number}`);
    if (notesChapter.read_time_mins) metaLine.push(`${notesChapter.read_time_mins} min read`);
    if (notesChapter.difficulty) metaLine.push(`difficulty: ${notesChapter.difficulty}`);
    contentHtml = `<p class="meta">${esc(notesSubject.name)}${metaLine.length ? ` · ${esc(metaLine.join(" · "))}` : ""}</p>
${notesChapter.description ? `<p><strong>${esc(notesChapter.description)}</strong></p>` : ""}
${excerpt
  ? excerpt.split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("\n")
  : "<p class=\"meta\">The full chapter notes are on the page (some chapters also include interactive quizzes and audio).</p>"}
${notesChapter.pdf_url ? `<p><a href="${esc(notesChapter.pdf_url)}">Download this chapter as PDF</a></p>` : ""}
${notesChapter.audio_enabled ? `<p class="meta">Audio narration is available for this chapter on the website.</p>` : ""}
<p><a href="/notes/${esc(notesSubject.slug)}">← All ${esc(notesSubject.name)} chapters</a></p>`;
  } else {
    // Static blocks from the shared content module + LIVE sections appended.
    const effectiveRoute = notesEffectiveRoute !== route ? notesEffectiveRoute : route;
    const meta = getPageMeta(effectiveRoute) || getPageMeta(route);
    const staticBlocks = (meta?.blocks || [])
      .map((block) => {
        const parts = [];
        if (block.__faqCategory) {
          // FAQ page — every canonical Q&A of this category (src/data/faqData.mjs).
          const items = FAQ_ITEMS.filter((it) => it.category === block.__faqCategory);
          if (block.h2) parts.push(`<h2>${esc(block.h2)}</h2>`);
          for (const it of items) {
            parts.push(`<article><h3>${esc(it.question)}</h3><p>${esc(it.answer)}</p></article>`);
          }
          return parts.join("\n");
        }
        if (block.__stats) {
          // "School at a glance" — render the LIVE admin-maintained statistics
          // directly here (prerender-lib.mjs does the same at build time).
          // On "/" the live section already renders them, so avoid duplicates.
          if (block.h2) parts.push(`<h2>${esc(block.h2)}</h2>`);
          parts.push(statsListHtml(data.school, route === "/"));
          return parts.join("\n");
        }
        if (block.h2) parts.push(`<h2>${esc(block.h2)}</h2>`);
        if (block.p) for (const para of block.p) parts.push(`<p>${esc(para)}</p>`);
        if (block.ul) parts.push(`<ul>${block.ul.map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`);
        if (block.links?.nav) {
          parts.push(
            `<ul>${NAV_LINKS.filter(([l, href]) => href !== effectiveRoute)
              .map(([l, href]) => `<li><a href="${esc(href)}">${esc(l)}</a></li>`)
              .join("")}</ul>`
          );
        }
        // `links: {source}` markers (build-time concept) are skipped here —
        // the live sections below always carry fresh lists instead.
        return parts.join("\n");
      })
      .join("\n");
    contentHtml = staticBlocks + (effectiveRoute === "/faq" ? "" : "\n" + liveSections(effectiveRoute, data));
  }

  // Live statistics into the static "School at a glance" placeholder — real
  // admin-maintained numbers on EVERY live-rendered page (see helper).
  contentHtml = injectLiveStats(contentHtml, data.school, route);

  // Admission live box also belongs on the homepage of crawler HTML.
  if (route === "/" && !detail) {
    contentHtml = admissionStatusHtml(data.admission) + "\n" + contentHtml;
  }

  // ── Page shell ─────────────────────────────────────────────────────────────
  const nav = NAV_LINKS.map(
    ([label, href]) => `<a href="${esc(href)}" style="margin-right:14px">${esc(label)}</a>`
  ).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="generator" content="GHS Babi Khel live renderer — dynamic rendering for AI/search crawlers; humans receive the full interactive site" />
<meta property="og:type" content="${detail && detailKind === "news" ? "article" : "website"}" />
<meta property="og:site_name" content="${esc(SITE_NAME)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${SITE_URL}/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${jsonLdFor(route, data, detail, title)}</script>
<style>${CSS}</style>
</head>
<body>
<!-- Rendered live by /api/render from the school database at ${new Date().toISOString()} -->
<header>
  <div class="wrap" style="padding:0">
    <strong>${esc(data.school.name)}</strong> — ${esc(data.school.tagline)}<br>
    <span class="small">${esc(data.school.location)} · Phone ${esc(data.school.phone)} · ${esc(data.school.email)}</span>
  </div>
</header>
<main class="wrap">
<h1>${esc(h1)}</h1>
${contentHtml}
<h2>Website sections</h2>
${nav ? `<nav>${nav}</nav>` : ""}
<p>Machine-readable data: <a href="/api/ai-data">/api/ai-data</a> (live JSON — school profile, admission status, notices, news, events, FAQ) · <a href="/llms.txt">/llms.txt</a> · <a href="/sitemap.xml">/sitemap.xml</a> · <a href="/rss.xml">/rss.xml</a></p>
</main>
<footer>
  <div class="wrap" style="padding:0">
    <div class="cols">
      <div><strong>${esc(data.school.full_name || data.school.name)}</strong><br>
      ${esc(data.school.location)}<br>
      Principal: ${esc(data.school.principal)} · EMIS ${esc(data.school.emis_code)}<br>
      Phone: ${esc(data.school.phone)} · Email: ${esc(data.school.email)}</div>
      <div class="small">${NAV_LINKS.map(([l, href]) => `<a href="${esc(href)}">${esc(l)}</a>`).join(" · ")}</div>
    </div>
    <p class="small">© ${new Date().getFullYear()} ${esc(data.school.name)}. Free government education — District Mohmand, Khyber Pakhtunkhwa.</p>
  </div>
</footer>
<script type="application/json" id="ghs-live-data">${escJson({
    generated_at: new Date().toISOString(),
    school: data.school,
    admission: data.admission,
  })}</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=86400, max-age=0");
  res.setHeader("X-GHS-Render", `live; generated=${new Date().toISOString()}`);
  return res.status(200).send(html);
}

// ── 404 page for unknown routes (also helps crawlers stop asking) ───────────
function notFoundHtml(pathname) {
  const links = NAV_LINKS.map(([l, href]) => `<a href="${esc(href)}">${esc(l)}</a>`).join(" · ");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Page not found — ${esc(SITE_NAME)}</title>
<meta name="robots" content="noindex" /><style>${CSS}</style></head>
<body><main class="wrap"><h1>Page not found</h1>
<p>The address <code>${esc(pathname)}</code> does not exist on this website. All public sections are listed below.</p>
<p>${links}</p>
<p class="small">Machine-readable data: <a href="/api/ai-data">/api/ai-data</a> · <a href="/llms.txt">/llms.txt</a></p>
</main></body></html>`;
}

// ── Entry point — tiny dispatcher, zero overhead ─────────────────────────────
//   ?feed=ai  → JSON feed (the old /api/ai-data behaviour; vercel.json rewrites
//               /api/ai-data, /ai-data.json and /ai.json here with feed=ai)
//   otherwise → live crawler HTML (?path=/…)
export default async function handler(req, res) {
  if (String(req.query?.feed || "").toLowerCase() === "ai") {
    return aiDataHandler(req, res);
  }
  return renderHandler(req, res);
}
