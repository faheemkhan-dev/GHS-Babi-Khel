<div align="center">

<br />

# GHS Babi Khel

### The Official Digital Platform of Government High School Babi Khel

*District Mohmand · Khyber Pakhtunkhwa · Pakistan*

<br />

[![Live Site](https://img.shields.io/badge/LIVE-ghsbabikhel.dpdns.org-0B3D24?style=for-the-badge&logo=googlechrome&logoColor=D4A017)](https://ghsbabikhel.dpdns.org)

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Vercel-Edge%20%2B%20Functions-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com)

<br />

A fast, installable, search-engine-ready school platform: public website, results & exam tools,
online admissions, a study-notes hub with interactive labs, an AI assistant, web-push alerts,
and a complete admin console, all running on free-tier infrastructure.

<br />

[**Features**](#-features) ·
[**Architecture**](#-architecture) ·
[**Quick Start**](#-quick-start) ·
[**Configuration**](#-configuration) ·
[**Deployment**](#-deployment) ·
[**Security**](#-security)

</div>

<br />

---

## 🏫 The School

| | |
|:--|:--|
| **Institution** | Government High School Babi Khel |
| **EMIS Code** | 60673 |
| **Established** | 2018 |
| **Classes** | 6 – 10 |
| **Board** | BISE Peshawar |
| **Location** | Babi Khel, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa |
| **Website** | [ghsbabikhel.dpdns.org](https://ghsbabikhel.dpdns.org) |

---

## ✨ Features

### 🌐 Public Website

| Route | What it offers |
|:--|:--|
| `/` Home | Hero, live news ticker, stats bar, notices & news, achievements, Word of the Day, daily quote, floating AI assistant |
| `/about` · `/teachers` · `/contact` · `/faq` | School story, staff directory, interactive school map, common questions |
| `/notices` · `/news` | Listing and detail pages with text-to-speech playback; notices can include polls |
| `/results` | School-published results with report-card **PDF and Excel export**, and an automatic BISE Peshawar fallback when none are published |
| `/merit-list` | Toppers and position holders |
| `/result-card` | Student result card (DMC) that opens a print window to save as PDF |
| `/roll-no-slip` | Exam roll-number slips with a live publish countdown |
| `/calendar` | Events calendar, exam countdowns and one-click `.ics` subscription |
| `/gallery` · `/library` | Photo albums and videos, study material and resources |
| `/admission` | Online application, status tracker, interview-slot booking, admit card and fee challan |
| `/duty` · `/search` | Duty board and site-wide search |

Also included: a global **command palette** for quick navigation, a custom **404 page** and an
**offline fallback page**.

### 📚 Notes Platform

A study hub at `/notes` with a dedicated page for each of **nine subjects**: Math, Physics,
Chemistry, Biology, English, Urdu, Islamiat, Pakistan Studies and Computer.

- Chapter pages with rich content authored in a TipTap-based admin editor
- **AI Study Buddy** for questions about the chapter being read
- **Audio notes** (text-to-speech), highlights and annotations with community upvotes
- Quizzes, flashcards, wrong-answer tracking and revision reminders
- Reading-time progress, XP and streaks, and a public leaderboard
- Concept maps (markmap)

**Interactive Labs** (lazy-loaded): Graphing Calculator · Step-by-Step Solver · PhET Simulations ·
3D Molecule Viewer · Periodic Table · Code Playground · Punnett Square · Number Line Lab ·
Statistics Playground.

### 🎓 Exams, Results & Admissions

- **Result publishing** per class and exam, with **scheduled release** (`publish_at`) and a
  server-side auto-publisher as a safety net
- **BISE Peshawar integration**: a server proxy fetches board results and reads the current
  exam title live, so the Results page follows the board automatically
- **Exam tools**: date sheets, roll-number slips, seating plans, and QR-based exam attendance
- **Admissions**: applications with documents, a status timeline, interview slots, admit
  cards and fee challans
- **Fees**: structures, vouchers and payment recording

### 🔔 Web Push Notifications

Visitors can opt in to alerts by topic: **results · merit · roll slips · admission · notices ·
news · date sheet · calendar**. Delivery is handled by `/api/push` using VAPID keys.

### 🤖 AI Assistant

A floating homepage assistant and the Notes Study Buddy are powered by **Z.AI GLM flash
models** (`glm-4.5-flash` by default, with fallback to `glm-4.7-flash`). Requests go through the
`/api/ai-chat` serverless function over **SSE streaming**, so the API key never reaches the
browser.

### 🛠️ Admin Console

Role-gated at `/admin` (only profiles with `role = admin`). The sidebar has **21 sections** in six groups:

| Group | Sections |
|:--|:--|
| **Overview** | Overview · School Settings · Site Analytics |
| **Students** | Manage Students (CSV import) · Admissions · Manage Results · Attendance · Fee Management · Student Records |
| **Exams** | Exam Date Sheet · Exam Roll Numbers · Exam Seating · Merit List |
| **School** | Manage Teachers · Timetables · Event Calendar |
| **Content** | Announcements (notices, news, polls) · Library · Notes Manager · Gallery |
| **Admin Access** | Manage Users |

Each tab loads lazily inside its own error boundary, so one failing section never takes down the dashboard.

> **Authentication** is sign-in based (email + password, forgot/reset password and OAuth callback
> pages). New admin access is granted through the `profiles` table (see [First Admin](#first-admin)).

---

## 🏗️ Architecture

```text
                   ┌────────────────────────────────────────────┐
                   │                  Visitors                  │
                   │     humans → React SPA · bots → HTML       │
                   └─────────────────────┬──────────────────────┘
                                         │
                   ┌─────────────────────▼──────────────────────┐
                   │        Edge Middleware (middleware.ts)     │
                   │  • blocks attack-tool / script user agents │
                   │  • tiered rate limiting                    │
                   │  • social crawlers  → /api/og              │
                   │  • AI/search crawlers → /api/render        │
                   └───────────┬─────────────────────┬──────────┘
                               │                     │
              ┌────────────────▼───────┐   ┌─────────▼──────────────────┐
              │   React SPA (Vite)     │   │   Vercel Serverless (api/) │
              │  • lazy-loaded routes  │   │  ai-chat · render · seo    │
              │  • React Query cache   │   │  og · bisep-proxy · phet   │
              │  • IndexedDB offline   │   │  calendar · push · word-of │
              │  • Service Worker      │   │  -day · resolve-fb · auto- │
              └───────────┬────────────┘   │  publish-results           │
                          │                └─────────┬──────────────────┘
                ┌─────────▼──────────┐     ┌─────────▼──────────────────┐
                │      Supabase      │     │      External services     │
                │ Postgres · Auth    │     │ Z.AI · Cloudinary · BISEP  │
                │ Row Level Security │     │ PhET · Plausible · Wordnik │
                └────────────────────┘     └────────────────────────────┘
```

**Key design decisions**

1. **Crawlers get live HTML, people get the SPA.** Recognised search and AI crawlers are routed to
   `/api/render`, which builds semantic HTML from the live database; if it is slow or down, the
   build-time prerendered page is served instead. Private areas are never proxied.
2. **Rich link previews.** Social crawlers (WhatsApp, Facebook, X, Telegram and others) are
   redirected to `/api/og`. Real in-app browsers are never redirected.
3. **Prerender runs inside the Vite build.** Vercel's Vite preset runs `vite build` directly, so
   the prerender pipeline hooks into Vite's `closeBundle` phase (`vite.config.ts`). It renders public
   routes into `dist/` with Chromium on every deploy.
4. **Consolidated serverless functions.** Related endpoints share a function (for example
   `/api/seo` serves robots, sitemap, llms.txt and RSS through a `kind` parameter), which keeps the
   function count low.
5. **Supabase is the single backend**: Postgres, Auth and Row Level Security. Media is hosted on
   **Cloudinary** through an unsigned upload preset.

---

## 🧱 Tech Stack

| Layer | Technology |
|:--|:--|
| **Frontend** | React 18 · TypeScript 5 · Vite 5 (SWC) · React Router 6 |
| **UI** | Tailwind CSS 3.4 · shadcn/ui (Radix) · Framer Motion · Lucide icons |
| **Themes** | Bright (follows system) and Dark |
| **Data** | TanStack React Query 5 (IndexedDB persistence) · Supabase JS 2 |
| **Forms** | React Hook Form · Zod |
| **Rich content** | TipTap · markmap |
| **Documents** | jsPDF + AutoTable · ExcelJS · SheetJS · qrcode · html5-qrcode |
| **Maps & 3D** | Leaflet · Three.js (`@react-three/fiber`) |
| **Charts** | Recharts |
| **Search** | Fuse.js · cmdk command palette |
| **Push** | `web-push` (VAPID) |
| **AI** | Z.AI GLM flash models via SSE proxy |
| **Analytics** | Plausible (optional) · first-party `site_visits` table |
| **Hosting** | Vercel (region `bom1`, Mumbai) · Edge Middleware |
| **Tooling** | ESLint 9 · Vitest · Testing Library · Playwright |

---

## 📁 Project Structure

```text
GHS-Babi-Khel/
├── api/                          # Vercel serverless functions
│   ├── ai-chat.ts                # Z.AI GLM proxy · SSE streaming · model fallback
│   ├── auto-publish-results.js   # Publishes results once publish_at has passed
│   ├── bisep-proxy.js            # BISE Peshawar results + live exam title
│   ├── calendar.js               # /calendar.ics feed
│   ├── og.js                     # Open Graph / JSON-LD HTML for social crawlers
│   ├── push.js                   # Web Push: config · subscribe · topics · dispatch
│   ├── push-core.js              # Shared Web Push logic used by push.js
│   ├── render.js                 # Live DB-rendered HTML for crawlers + AI JSON feed
│   ├── resolve-fb.js             # Facebook share-link resolver
│   ├── seo.js                    # robots · sitemap · llms.txt · RSS
│   └── word-of-day.js            # Homepage Word of the Day
├── middleware.ts                 # Edge: security, rate limits, crawler routing
├── public/                       # sw.js · manifest · offline.html · icons · fonts
├── scripts/                      # Prerender pipeline and verification scripts
├── src/
│   ├── components/               # layout · shared · ui · notes · interactive ·
│   │                             # admissions · ReportCard · Calendar · seo · admin
│   ├── contexts/AuthContext.tsx
│   ├── hooks/                    # Data hooks per domain (results, fees, notes …)
│   ├── lib/                      # supabase · cloudinary · push · routePrefetch …
│   ├── pages/                    # Public pages · admin/ · auth/ · notes/
│   └── App.tsx                   # Routes, lazy loading with retry, offline bootstrap
├── vite.config.ts                # Build, chunking, prerender hook
├── vercel.json                   # Rewrites, security headers, caching, region
└── env.example
```

---

## 🚀 Quick Start

**Requirements:** Node.js 18+ and npm.

```bash
# 1. Install
npm install

# 2. Configure (see Configuration below)
cp env.example .env

# 3. Run the dev server → http://localhost:8080
npm run dev

# 4. Production build (includes prerender)
npm run build

# 5. Preview the build locally
npm run preview
```

### Scripts

| Command | Description |
|:--|:--|
| `npm run dev` | Vite dev server on port **8080** |
| `npm run build` | Production build and prerender pipeline |
| `npm run build:dev` | Development-mode build |
| `npm run prerender` | Run the prerender pipeline against an existing `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run test` · `npm run test:watch` | Vitest, single run / watch |

---

## 🔐 Configuration

Copy `env.example` to `.env` for local work. For production, add the same variables in
**Vercel → Project Settings → Environment Variables** and **redeploy**.

### Browser-side (`VITE_` prefix: public, never put secrets here)

| Variable | Required | Purpose |
|:--|:--:|:--|
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (protected by RLS) |
| `VITE_CLOUDINARY_CLOUD_NAME` | Uploads | Cloudinary cloud name |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Uploads | Cloudinary **unsigned** upload preset |
| `VITE_PLAUSIBLE_DOMAIN` | Optional | Plausible site domain; leave empty to disable analytics |
| `VITE_PLAUSIBLE_SRC` | Optional | Script URL for self-hosted Plausible |
| `VITE_BISEP_EXAM_TITLE` | Optional | Fallback exam title if the live scraper fails |

### Server-side (never expose to the browser)

| Variable | Required | Purpose |
|:--|:--:|:--|
| `SUPABASE_SERVICE_ROLE_KEY` | Push, auto-publish | Service-role key used by `api/push-core.js` and `api/auto-publish-results.js` |
| `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` | Push | VAPID key pair (`VITE_VAPID_PUBLIC_KEY` is accepted as an alternative for the public key) |
| `VAPID_SUBJECT` | Push | VAPID contact subject (see `api/push-core.js`) |
| `CRON_SECRET` | Optional | Authorises scheduled calls to `/api/push?action=dispatch` and the auto-publisher |
| `ZAI_API_KEY` | AI | Z.AI API key for `/api/ai-chat` |
| `ZAI_MODEL` | Optional | Model override (default `glm-4.5-flash`) |
| `ZAI_API_URL` | Optional | Ignored unless it starts with `https://api.z.ai/` |
| `WORDNIK_API_KEY` | Optional | Enables Wordnik-curated Word of the Day (works without it) |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Optional | Server-side aliases; the `VITE_` variants are used as fallback |

### Build flags

| Flag | Effect |
|:--|:--|
| `GHS_SKIP_PRERENDER=1` | Skip the prerender hook inside `vite build` |
| `PRERENDER=false` | CLI prerender: skip Chromium rendering |
| `SEO_FALLBACK=false` | CLI prerender: skip static fallback content |

> Without Supabase variables the UI still boots, but data features will not work.

---

## 🗄️ Database

The code reads and writes **64 Supabase tables** plus the `v_student_seating` view:

| Domain | Tables |
|:--|:--|
| **Core** | `school_settings`, `profiles`, `students`, `teachers`, `rooms`, `notifications`, `notification_dismissals`, `site_visits` |
| **Content** | `notices`, `news`, `gallery_albums`, `gallery_photos`, `videos`, `library_files`, `achievements`, `school_events`, `duty_board` |
| **Academics** | `results`, `grading_schemes`, `merit_lists`, `houses`, `house_members`, `timetables`, `timetable_settings`, `timetable_overrides`, `generated_id_cards` |
| **Attendance** | `attendance`, `attendance_daily_stats`, `attendance_thresholds` |
| **Exams** | `exam_schedule`, `exam_roll_numbers`, `exam_roll_sessions`, `exam_attendance`, `exam_seating_plans`, `exam_seating_rooms`, `exam_seating_assignments`, `tests`, `test_questions`, `test_attempts` |
| **Fees** | `fee_structures`, `fee_vouchers`, `fee_payments` |
| **Admissions** | `admissions`, `admission_documents`, `admission_settings`, `admission_status_timeline`, `interview_slots`, `interview_bookings` |
| **Notes** | `note_subjects`, `note_chapters`, `notes`, `note_quizzes`, `note_quiz_results`, `note_questions`, `note_flashcards`, `note_wrong_answers`, `note_progress`, `note_highlights`, `note_annotations`, `annotation_upvotes`, `chapter_reading_times`, `chapter_connections`, `student_gamification`, `revision_reminders` |

The Web Push feature also uses its own subscription storage through the Supabase REST API in `api/push-core.js`.

**Row Level Security must be enabled on every table.** Visitors use only the anon key against
tables whose policies allow it; admin operations require `profiles.role = 'admin'`.

---

## 🔌 Serverless Endpoints

| Endpoint | Purpose |
|:--|:--|
| `POST /api/ai-chat` | AI assistant proxy: SSE stream of `{"token": …}` frames, then `{"done": true}` |
| `GET /api/render?path=/…` | Live DB-rendered HTML for crawlers |
| `GET /api/render?feed=ai` | AI JSON feed, also at `/ai-data.json`, `/ai.json`, `/api/ai-data` |
| `/robots.txt` · `/sitemap.xml` · `/llms.txt` · `/rss.xml` · `/feed.xml` | Served by `/api/seo?kind=…` |
| `GET /api/og?path=/…` | Open Graph / Twitter / JSON-LD HTML for social crawlers |
| `GET /api/bisep-proxy` | BISE Peshawar results; `mode=current` returns the live exam title |
| `GET /calendar.ics` | iCalendar feed of school events |
| `GET /api/word-of-day` | Word of the Day |
| `POST /api/resolve-fb` | Facebook share link → canonical permalink |
| `/api/push?action=…` | Web Push: `config`, `subscribe`, `topics`, `unsubscribe`, `test`, `dispatch` |
| `GET /api/auto-publish-results` | Flips `is_published` once `publish_at` has passed |

---

## 🛡️ Security

- **Response headers** (`vercel.json`): Content-Security-Policy, HSTS with preload,
  `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options`, Referrer-Policy and Permissions-Policy.
- **Edge rate limiting** (`middleware.ts`): sliding window per IP and user-agent fingerprint.
  Exceeding a limit blocks the client for twice the window and returns `429` with `Retry-After`.

  | Tier | Limit | Applies to |
  |:--|:--|:--|
  | default | 100 / min | Page routes |
  | api | 60 / min | `/api/*` |
  | scrapeProxy | 15 / min | `/api/bisep-proxy`, `/api/og` |
  | auth | 10 / 15 min | `/auth/*` pages |
  | login | 5 / 15 min | Login API calls |
  | signup | 3 / hour | Signup API calls |
  | passwordReset | 3 / hour | Password-reset API calls |
  | contact | 2 / min | Contact API calls |

- **Blocked clients**: dedicated attack tools (such as sqlmap, nikto, nmap) and generic script
  clients (such as curl, wget, python-requests) receive `403`. Search and AI crawlers are never matched.
- **Client hardening**: per-route error boundaries, safe URL handling, rate limiting,
  and security-focused request middleware.
- **Secrets stay server-side**: the AI key, service-role key and VAPID private key are only read in `api/`.
- **Private routes** (`/admin`, `/auth`, `/search`) are never proxied to the crawler renderer.

---

## 🔍 SEO & AI Discoverability

- **Build-time prerendering** of public routes into static HTML
- **Live dynamic rendering** for search and AI crawlers through `/api/render`
- **JSON-LD** structured data (`index.html` and `SiteSchema.tsx`)
- **Machine-readable feeds**: `/llms.txt`, AI JSON feed, `/rss.xml`, `/sitemap.xml`, `/robots.txt`
- **Per-route meta** through React Helmet and `RouteSEOInjector`, kept in step with `api/og.js`

## ⚡ Performance & Offline

- **Lazy routes** with a retry loader (`lazyWithRetry`) that recovers from failed or stale chunk loads
- **Offline-first data**: key queries persist to **IndexedDB** and restore on cold start
- **Custom service worker** (`public/sw.js`): precaches the app shell and hashed assets, caches
  images, and falls back to `/offline.html`
- **Idle prefetch** of route chunks and prefetch on hover/touch intent
- **Installable PWA** via `manifest.json` and maskable icons

---

## 🧪 Testing

```bash
npm run test       # Vitest, single run
npm run lint       # ESLint
```

Vitest runs with jsdom and Testing Library. Playwright is installed for end-to-end tests.

---

## ☁️ Deployment

1. Push the repository to GitHub.
2. Import it in **Vercel**; the Vite preset is detected automatically.
3. Add the environment variables from [Configuration](#-configuration) and **redeploy**.
4. `vercel.json` provides the SPA rewrites, headers, caching and the `bom1` region.
5. The prerender step runs automatically inside `vite build`.

### Scheduled jobs

`vercel.json` does not define any cron entries yet. To run the result auto-publisher and push
dispatcher on a schedule, add entries like these and set `CRON_SECRET`:

```json
"crons": [
  { "path": "/api/auto-publish-results", "schedule": "0 * * * *" },
  { "path": "/api/push?action=dispatch", "schedule": "0 * * * *" }
]
```

### First Admin

1. Create a user in **Supabase → Authentication**, then sign in at `/auth/signin`.
2. In **Supabase → Table Editor → `profiles`**, set that user's `role` to `admin`.
3. Sign in again; `/admin` is now available.

---

## 🙌 Credits

- **Developer:** Muhammad Faheem, student at GHS Babi Khel, who designed and built the platform
  as a school and community project (also listed in `public/humans.txt`).
- **Principal:** Mr. Imdad Ullah, Government High School Babi Khel.
- **Powered by** Supabase, Vercel, Cloudinary, Z.AI and Plausible.

---

<div align="center">

© **Government High School Babi Khel**, District Mohmand, Khyber Pakhtunkhwa, Pakistan.
All rights reserved.

</div>
