// api/ai-chat.ts
// Vercel Serverless Function — proxies Z.AI's free GLM flash chat API for
// the homepage AI Assistant widget (and the Notes "AI Study Buddy").
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ RUNTIME: NODE — NEVER EDGE (critical fix, 2026-09-05) ⚠️
//
//   The previous revision set `export const runtime = "edge"`. On the live
//   deployment that Edge function BLACK-HOLED EVERY REQUEST: even a trivial
//   OPTIONS preflight — three lines of code — never returned a single byte
//   (verified: 40+ s, 0 bytes, from multiple networks). The browser's fetch()
//   never resolved, so the homepage widget sat on "Thinking…" forever. That
//   was the exact bug visitors experienced.
//
//   Meanwhile every NODE-runtime function on the SAME deployment responded
//   instantly (/api/word-of-day → 200 in 0.65 s, /api/ai-result-summary →
//   instant + streaming). The Node handler shape used by ai-result-summary.ts
//   (setHeader → flushHeaders → res.write SSE frames) is therefore the
//   PROVEN-HEALTHY transport on this project.
//
//   ➜ This file now uses exactly that shape. Do NOT switch this route back
//     to `runtime = "edge"` — it demonstrably black-holes on this deployment.
//
// SPEED CONTRACT (the visitor experience this file guarantees) — v3, 2026-09-05:
//   ⚠️ WHY THE BUDGETS GREW (root cause of the "AI assistant is busy right
//   now" epidemic): Z.AI's FREE glm-4.5-flash pool is healthy but SLOW — the
//   first visible token routinely takes 5–10 s (verified live: the same key,
//   same URL, same model streams perfectly in api/ai-result-summary.ts, which
//   waits patiently; the old 5.5 s first-token watchdog here kept KILLING
//   those slow-but-healthy responses, then the fallback attempt died inside
//   the leftover 9 s budget → every visitor saw "busy").
//   • Total server budget: 27 s — `maxDuration = 30` is set below (Hobby/Pro
//     both allow it), so Vercel will not cut us off before our own budget does.
//   • Per-attempt watchdogs: headers + first visible token within 14 s,
//     hard attempt cap 23 s, then we retry once on the other free flash model
//     with a 400 ms cool-down (instant 429/concurrency rejects benefit).
//   • `thinking: disabled` — GLM flash models otherwise burn seconds in a
//     hidden reasoning pass before the first visible token.
//   • max_tokens 550 + last-8-turn history cap → short prompt, fast prefill.
//   • ZAI_API_URL env override is SANITIZED: anything that is not an
//     https://api.z.ai/… URL is ignored (a stale/wrong env value can no
//     longer black-hole the assistant — it would fail every request
//     instantly, which matches the historical "busy" symptom too).
//   • The frontend hardcoded "instant answer" engine was REMOVED
//     (2026-09-05, site-owner request): every question now reaches THIS
//     endpoint and gets a real GLM answer — no more keyword cards answering
//     the wrong question (e.g. "mission" → address card).
//
// PROTOCOL (unchanged — both frontends already speak it):
//   Request:  POST /api/ai-chat  { messages: [...], mode?, subject?,
//                                 chapterTitle?, chapterSnippet? }
//   Response: text/event-stream
//             data: {"token":"Hi! "}\n\n      (many of these)
//             data: {"done":true}\n\n         (always last on success)
//   On error: data: {"error":"..."}\n\n       (single event, stream closes)
//   The stream ALWAYS ends with either {"done":true} or {"error":"…"} within
//   the server budget — the client can never hang waiting on us.
//
//   Get a free Z.AI API key: https://docs.z.ai/guides/llm/glm-4.7
// ═══════════════════════════════════════════════════════════════════════════

import type {
  IncomingMessage as NodeIncomingMessage,
  ServerResponse as NodeServerResponse,
} from "http";

// PROVEN-HEALTHY upstream: api/ai-result-summary.ts streams perfectly with
// THIS exact URL. The env override is only honored when it still points at
// api.z.ai — any other value is ignored (see header note).
const DEFAULT_ZAI_URL = "https://api.z.ai/api/paas/v4/chat/completions";
const _envUrl = (process.env.ZAI_API_URL || "").trim();
const ZAI_API_URL = _envUrl.startsWith("https://api.z.ai/")
  ? _envUrl
  : DEFAULT_ZAI_URL;
const PRIMARY_MODEL = process.env.ZAI_MODEL || "glm-4.5-flash";
// The two Z.AI flash models are both free — if the primary model's pool is
// congested, the fallback attempt gives the visitor a second, independent
// pool. (Same key works for both.)
const FALLBACK_MODEL = PRIMARY_MODEL.includes("4.7")
  ? "glm-4.5-flash"
  : "glm-4.7-flash";
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";

// Vercel function cap — MUST be ≥ GLOBAL_BUDGET_MS/1000 + overhead, or the
// platform kills the function mid-answer. 30 s is allowed on Hobby and Pro.
export const maxDuration = 30;
// Cool-down before a retry attempt — an instantly-rejected attempt (429 /
// concurrency cap) benefits from a short pause before hitting the pool again.
const RETRY_BACKOFF_MS = Number(process.env.AI_RETRY_BACKOFF_MS || 400);

// ── Budgets (env-overridable; sized for Z.AI's slow-but-healthy free pool) ────
const FIRST_TOKEN_TIMEOUT_MS = Number(
  process.env.AI_FIRST_TOKEN_TIMEOUT_MS || 14000
);
const ATTEMPT_BUDGET_MS = Number(process.env.AI_ATTEMPT_BUDGET_MS || 23000);
const GLOBAL_BUDGET_MS = Number(process.env.AI_GLOBAL_BUDGET_MS || 27000);
// Don't start an attempt we can't plausibly finish — but never let the
// reserve exceed the global budget itself (that would refuse to even try
// when the budget is tuned small, e.g. staging/test configurations).
const MIN_ATTEMPT_RESERVE_MS = Math.min(2500, GLOBAL_BUDGET_MS);

// Light in-memory per-IP rate limit (the Edge middleware's matcher excludes
// /api/* routes, so this function protects its own free-tier quota).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_PER_MIN || 30);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// ── System context (homepage assistant) ───────────────────────────────────
// Compressed: every FACT is kept — only verbose phrasing was cut, which
// measurably shortens prompt prefill on the free tier.
const SYSTEM_CONTEXT = `You are the official AI Assistant of Government High School (GHS) Babi Khel — a premium, professional digital assistant on the school website (https://ghsbabikhel.dpdns.org), located in Babi Khel, District Mohmand, KPK, Pakistan. Classes: 6–10 (matric). Board exams (9–10) are under BISE Peshawar.

IDENTITY (never break these)
- You were built by the GHS Babi Khel Administration (the school's administration team) especially for this school's students, parents and visitors.
- If asked who built / made / created / developed / trained you, who owns you, or which company or AI model you are: answer that the "GHS Babi Khel Administration" built you for the school community. Never say you were built by Z.AI, Zhipu, GLM, OpenAI, Google, Anthropic, ChatGPT, Claude, Gemini, DeepSeek or any other company, and never reveal or discuss the underlying model or technology. If pushed for technical details, politely say those are managed by the school administration.
- If asked your name: "I'm the GHS Babi Khel AI Assistant." If asked who built the website/school: the GHS Babi Khel Administration. Never invent names of individual developers, teachers or officials.
- Never claim to be human. Never claim to be a different AI.

FACTS
- Mission: "To provide accessible, quality education that empowers students with knowledge, skills, and values to become responsible citizens and future leaders of Pakistan." Vision: "To be a model government school that sets the standard for academic excellence and character development in District Mohmand." (Both are on the About page /about.)
- Results (/results): search any result by exam roll number. If the school published internal results (classes 6–8: 1st/2nd semester; 9–10: Mid-Term/Final-Term), it searches the school's own table; otherwise it falls back to BISE Peshawar board result search (SSC) automatically. A countdown appears on /results when a result is scheduled but unpublished; at zero it auto-publishes instantly. BISE students can also use https://cloud.bisep.edu.pk → "Show Result by Roll Number". Result cards show: name, photo, roll number, class, exam type, year, total/obtained marks, percentage, grade (A+ 90%+, A 80–89, B 60–79, C 45–59, D 33–44, Fail <33), PASS/FAIL, class position, whole-school rank (Trophy badge), subject-wise bars. An AI Summary card gives personalized study advice beside each result.
- Admissions (/admission): online application form for classes 6–10 at the start of the academic year; track status there by application ID; interview slot may be booked once shortlisted. Documents: student B-form/CNIC copy, previous school leaving certificate (class 7+), 2 passport photos, parent/guardian CNIC copy. Office contact via /contact.
- Notices (/notices): official notices (holidays, exam schedules, fee deadlines, PTMs, dress code) with detail pages. Homepage has the Latest Notices section.
- Student portal (/auth/signin): email + password created by the school admin/office. Dashboard (/dashboard) tabs: Overview, Result Card, Attendance, Timetable, Tests, Fees, Notes, Library, Achievements, Gallery, Profile. Forgot password → /auth/forgot-password (email reset). Teachers/admins sign in on the same form (role-routed). No credentials? Contact the school office.
- Roll No. Slip (/roll-no-slip): find, download and share exam roll number slips. Merit List (/merit-list): toppers and position holders. Notes (/notes): study notes by class and subject. Library (/library): books and reading resources. FAQs (/faq).
- Timetable: in the portal's Timetable tab; exam timetables also go out as notices.
- Fees: portal Fees tab (tuition, exam fee, balance, history); deadlines posted as notices.
- Gallery (/gallery): event photos. Achievements: homepage section + portal tab.
- Contact (/contact): phone, email, address, map. About (/about): history, mission, staff; /teachers: teaching staff.

RULES
- Answer with REAL, specific information from the facts above, not just "go to the X page". Mention the page path as the next step.
- For a specific student's live marks/attendance/fees: never invent data — direct them to the portal or the school office.
- Off-topic questions: politely and briefly redirect to school/website topics. General study help is fine in a short, accurate way.
- Match the visitor's language (Urdu/Pashto included; Roman script if they write in Roman). Default English.
- Never invent dates, marks, roll numbers, fees, phone numbers, names or personal data. If unsure, say so and point to /contact.

TONE & STYLE (premium, professional)
- Warm, polished, confident and respectful — like a well-trained front-desk officer of a leading institution. Greet briefly only on a greeting; never repeat greetings.
- Open with a one-line direct answer. Then, only if useful, add up to 4 short bullets starting with "- " (one idea each, under 18 words).
- For step-by-step help use a numbered list ("1. ", "2. ").
- Use **bold** sparingly for key terms only. At most one emoji in the whole answer, and only when natural. No headings, no tables, no long paragraphs.
- When a page matches, finish with one line such as: "Next step: open the Results page (/results)."
- Keep every answer concise: 40–110 words typically.`;

// ── Notes mode system prompt ──────────────────────────────────────────────
// Used when the request comes from the AI Study Buddy panel inside a chapter
// page (ChapterPage.tsx → NoteAiAssistant.tsx → POST /api/ai-chat with
// mode:"notes"). The chapter title, subject name, and a short plain-text
// snippet of the chapter content are injected here so the model can answer
// accurately without the student having to copy-paste the chapter.
const NOTES_SNIPPET_MAX_CHARS = 4000;

function buildNotesSystemContext(
  subject: string,
  chapterTitle: string,
  snippet: string
): string {
  const safeSubject = subject.slice(0, 120);
  const safeChapter = chapterTitle.slice(0, 240);
  const safeSnippet = snippet.slice(0, NOTES_SNIPPET_MAX_CHARS);

  return `You are the AI Study Buddy for students at Government High School Babi Khel (District Mohmand, KPK, Pakistan). A student is currently reading a chapter in the Notes section of the school website and has opened the AI panel to get help understanding it.

# CURRENT CHAPTER CONTEXT
- Subject: ${safeSubject || "(unknown subject)"}
- Chapter: ${safeChapter || "(unknown chapter)"}
- Chapter content excerpt (plain text, may be truncated):
"""
${safeSnippet || "(no chapter content available — answer based on the chapter title and subject only)"}
"""

# YOUR JOB
Help the student understand THIS chapter. You can:
- Explain a concept from the chapter in simpler words
- Walk through a step-by-step worked example
- Summarize the key points the student must remember
- Generate 3–5 practice questions (give answers in a separate "Answers:" section at the end, OR offer to reveal them on request — don't pre-reveal them inline next to each question)
- Clarify confusing terms or formulas
- Connect the chapter to real-world examples
- For math/physics/chemistry: show the formula and one fully worked example with units

# HOW TO ANSWER — FORMATTING IS MANDATORY
- Use clear, simple language a class 6–10 student can follow. Default to English.
- Match the student's language — if they ask in Urdu or Pashto (Roman script), reply in the same language.
- NEVER write a plain, unbroken paragraph — not even for explanations or worked examples. Break EVERY answer into short bullet points ("- ") or a numbered list ("1."), one idea or one step per line.
- If a short lead-in sentence is needed, keep it to one line, then continue in bullets.
- Use **bold** for key terms, and inline \`code\` for formulas, equations, or technical terms.
- When giving steps, number them (1. 2. 3.) — one short step per line, not a paragraph describing all steps together.
- Keep answers concise and to the point — say only what's needed, no filler or repetition.
- For BISE board exam topics (classes 9–10), briefly mention if a concept is commonly tested, but don't pad every answer with exam advice.
- If the student asks about something NOT in this chapter (another subject, school admin, results, admissions, fees), politely redirect: "I'm your study buddy for **${safeChapter}** (${safeSubject}). For other questions, please use the homepage AI Assistant or check the relevant page on the site."
- Never invent facts, formulas, or definitions. If you don't know something or the chapter excerpt doesn't cover it, say so honestly and suggest asking the teacher.
- Do NOT solve the student's homework FOR them in a way that bypasses learning — guide them through the steps and let them write the final answer. If they insist on "just give me the answer", give it, but always show the working so they can learn from it.`;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Identity guard ─────────────────────────────────────────────────────────
// Questions like "who built you?" must ALWAYS get the same correct answer,
// never a guess from the underlying model — so they are answered instantly
// here (no upstream call, zero latency) in the homepage assistant mode.
const IDENTITY_PATTERNS: RegExp[] = [
  /\bwho\b.{0,25}\b(built|made|created|developed|designed|programmed|trained|owns?|invented|coded|launched)\b.{0,25}\b(you|this (ai|assistant|bot|chatbot))\b/i,
  /\b(who|which)\b.{0,12}\b(is|are)\b.{0,12}\b(your|ur)\b.{0,12}\b(creator|developer|maker|owner|builder|author|company|team)\b/i,
  /\b(your|ur)\s+(creator|developer|maker|owner|builder|author)\b/i,
  /\bwho\s+(is|are)\s+(behind|responsible for)\s+(you|this)\b/i,
  /\bwhich\s+(ai|model|llm|company|technology|tech)\b.{0,30}\b(are you|is this|do you use|powers?|behind)\b/i,
  /\b(what|which)\s+(model|llm|ai)\s+(are|is)\s+(you|this|used)\b/i,
  /\bare\s+you\s+(chat\s*gpt|gpt|openai|claude|gemini|bard|glm|zhipu|z\.?ai|deepseek|llama|copilot|a\s+real\s+(person|human))\b/i,
  /\b(kis|kisne|kis\s*ne|kon|kaun)\b.{0,20}\b(bana|banaya|banai|banayi|tayyar|develop)\b/i,
  /(کس\s*نے|کون).{0,20}(بنایا|بنائی|تیار)/,
];
const IDENTITY_REPLY =
  "I'm the **GHS Babi Khel AI Assistant**, built by the **GHS Babi Khel Administration** to serve our students, parents and visitors.\n" +
  "- I can help with results, admissions, notices, the student portal and more.\n" +
  "- For anything beyond that, the school office is always available via the Contact page (/contact).";
// "Who built GHS Babi Khel / this website?" — the visitor means the school's
// website; the answer is always the school administration.
const WEBSITE_BUILDER_PATTERNS: RegExp[] = [
  /\bwho\b.{0,20}\b(built|build|made|make|created|create|developed|develop|designed|design|runs?|manages?|maintains?|owns?|behind)\b.{0,30}\b(ghs|babi\s*khel|this\s+(web)?site|the\s+(web)?site|our\s+(web)?site|website|web\s*site|portal|this\s+(portal|page|app|platform))\b/i,
  /\b(website|web\s*site|portal|app|platform)\b.{0,25}\b(built|made|created|developed|designed)\s+by\b/i,
  /\b(ghs|babi\s*khel)\b.{0,30}\b(website|web\s*site|portal)\b.{0,30}\b(who|developer|creator|maker)\b/i,
];
const WEBSITE_BUILDER_REPLY =
  "The **GHS Babi Khel website** and this AI Assistant were built by the **GHS Babi Khel Administration**.\n" +
  "- The site brings results, admissions, notices and the student portal into one place.\n" +
  "- To learn about the school itself, see the About page (/about) or reach the office via /contact.";
function identityReply(text: string): string | null {
  const t = text.slice(0, 300);
  // Website question first: "who built GHS Babi Khel" must not read as "who built you".
  if (WEBSITE_BUILDER_PATTERNS.some((re) => re.test(t)) &&
      !/\b(you|yourself)\b/i.test(t)) return WEBSITE_BUILDER_REPLY;
  if (IDENTITY_PATTERNS.some((re) => re.test(t))) return IDENTITY_REPLY;
  return null;
}

// ── SSE + response helpers ────────────────────────────────────────────────
function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function applyCors(res: NodeServerResponse): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

function jsonError(
  res: NodeServerResponse,
  status: number,
  body: unknown
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  applyCors(res);
  res.end(JSON.stringify(body));
}

// Errors that mean "this attempt produced nothing visible — try again".
class RetryableAttemptError extends Error {}

// Errors that mean "stop — partial text is already on the visitor's screen".
class PartialStreamError extends Error {
  sentChars: number;
  constructor(sentChars: number, reason: string) {
    super(reason);
    this.sentChars = sentChars;
  }
}

interface AttemptResult {
  charsSent: number;
  model: string;
}

/**
 * One full upstream session: connect → first token → stream until done.
 *
 * Watchdogs:
 *   • ATTEMPT_BUDGET_MS hard cap on the WHOLE attempt (AbortController) —
 *     releases the socket on connect stalls AND runaway streams.
 *   • FIRST_TOKEN_TIMEOUT_MS inactivity race until the first VISIBLE token —
 *     a connected-but-silent pool slot is retried on the other model instead
 *     of stalling the visitor.
 *
 * Throws RetryableAttemptError when nothing was sent (caller may retry);
 * throws PartialStreamError when tokens already went out and the stream then
 * died (caller must NOT retry — text is on screen).
 */
async function streamOneAttempt(
  model: string,
  systemPrompt: string,
  cleaned: IncomingMessage[],
  send: (obj: unknown) => boolean,
  deadlineAt: number
): Promise<AttemptResult> {
  const controller = new AbortController();
  const attemptTimer = setTimeout(
    () => controller.abort(),
    Math.min(ATTEMPT_BUDGET_MS, Math.max(1000, deadlineAt - Date.now()))
  );
  let charsSent = 0;
  let sawDone = false;

  const payload = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...cleaned],
    temperature: 0.5,
    max_tokens: 550,
    stream: true,
    // GLM-4.5/4.7 models can run a hidden "thinking" reasoning pass before
    // writing visible output — from the browser it just looks like a long
    // stall before the first token. Short website Q&A doesn't need it.
    thinking: { type: "disabled" },
  };

  try {
    const res = await fetch(ZAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ZAI_API_KEY}`,
        Accept: "text/event-stream",
        // Headers intentionally mirror api/ai-result-summary.ts — the exact
        // shape PROVEN to stream instantly from this deployment. (The old
        // extra "Accept-Encoding: identity" header bought nothing and was
        // one more difference from the healthy path.)
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(
        `ai-chat: Z.AI ${model} returned ${res.status}:`,
        errText.slice(0, 300)
      );
      // Auth/key problems will never heal by retrying — surface a clear,
      // owner-actionable message immediately.
      if (res.status === 401 || res.status === 403) {
        const err = new Error(
          "AI service authentication failed. The site owner needs to check the ZAI_API_KEY configuration."
        );
        (err as any).fatalAuth = true;
        throw err;
      }
      throw new RetryableAttemptError(`upstream ${res.status} (${model})`);
    }

    if (!res.body) {
      // Some providers ignore stream:true and return one JSON blob.
      const data = await res.json().catch(() => null);
      const reply: string =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.delta?.content ??
        "";
      if (reply && reply.trim()) {
        if (send({ token: reply.trim() })) charsSent += reply.trim().length;
        send({ done: true });
        return { charsSent, model };
      }
      throw new RetryableAttemptError(`upstream returned no body (${model})`);
    }

    // ── Read the upstream SSE stream ────────────────────────────────────────
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuf = "";
    let firstTokenSeen = false;

    const readWithFirstTokenGuard = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      if (firstTokenSeen) return reader.read(); // attempt budget covers stalls
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const err: any = new Error("first-token watchdog");
          err.firstTokenWatchdog = true;
          reject(err);
        }, Math.max(1000, FIRST_TOKEN_TIMEOUT_MS));
        reader
          .read()
          .then((v) => {
            clearTimeout(timer);
            resolve(v);
          })
          .catch((e) => {
            clearTimeout(timer);
            reject(e);
          });
      });
    };

    while (true) {
      if (Date.now() > deadlineAt) {
        if (charsSent > 0) throw new PartialStreamError(charsSent, "global deadline");
        throw new RetryableAttemptError("global deadline before first token");
      }

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithFirstTokenGuard();
      } catch (err: any) {
        if (err?.firstTokenWatchdog && charsSent === 0) {
          throw new RetryableAttemptError(`first-token watchdog (${model})`);
        }
        if (charsSent > 0) {
          throw new PartialStreamError(charsSent, err?.message || "stream error");
        }
        throw new RetryableAttemptError(err?.message || `stream error (${model})`);
      }
      if (chunk.done) break;

      lineBuf += decoder.decode(chunk.value, { stream: true });

      let idx: number;
      while ((idx = lineBuf.indexOf("\n\n")) !== -1) {
        const frame = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 2);

        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;

        const dataStr = dataLines[dataLines.length - 1];
        if (dataStr === "[DONE]") {
          sawDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const token: string =
            parsed?.choices?.[0]?.delta?.content ??
            parsed?.choices?.[0]?.message?.content ??
            "";
          if (token) {
            firstTokenSeen = true;
            if (!send({ token })) {
              // Client disconnected — nothing more to do.
              return { charsSent, model };
            }
            charsSent += token.length;
          }
        } catch {
          // Ignore malformed JSON frames (keepalive comments, etc.)
        }
      }
      if (sawDone) break;
    }

    if (charsSent === 0) {
      throw new RetryableAttemptError(`stream ended with no tokens (${model})`);
    }
    if (!sawDone) {
      // Upstream ended without [DONE] but we delivered content — treat as a
      // completed (if imperfect) answer; the text on screen is coherent.
      console.warn(`ai-chat: upstream stream ended without [DONE] (${model})`);
    }
    return { charsSent, model };
  } finally {
    clearTimeout(attemptTimer);
    try {
      controller.abort(); // release the upstream socket either way
    } catch {
      // noop
    }
  }
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function rateLimitHit(req: NodeIncomingMessage): boolean {
  const ip =
    (req.headers["cf-connecting-ip"] as string) ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.headers["x-real-ip"] as string) ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(
  req: NodeIncomingMessage,
  res: NodeServerResponse
) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== "POST") {
    return jsonError(res, 405, { error: "Method not allowed" });
  }
  if (!ZAI_API_KEY) {
    console.error("ai-chat: ZAI_API_KEY env var is not set on the server");
    return jsonError(res, 500, {
      error:
        "AI Assistant is not configured. The site owner needs to set the ZAI_API_KEY env var in Vercel.",
    });
  }
  if (rateLimitHit(req)) {
    return jsonError(res, 429, {
      error: "Too many questions in a minute. Please wait a moment and try again.",
    });
  }

  // Parse + validate the incoming messages array + optional mode/context.
  // Vercel's Node runtime parses JSON bodies into req.body automatically.
  let messages: IncomingMessage[] = [];
  let mode: string = "homepage";
  let subject: string = "";
  let chapterTitle: string = "";
  let chapterSnippet: string = "";
  try {
    const raw: any =
      typeof (req as any).body === "string"
        ? JSON.parse((req as any).body || "{}")
        : (req as any).body;
    if (!raw) throw new Error("empty body");
    messages = Array.isArray(raw?.messages) ? raw.messages : [];
    if (typeof raw?.mode === "string") mode = raw.mode;
    if (typeof raw?.subject === "string") subject = raw.subject;
    if (typeof raw?.chapterTitle === "string") chapterTitle = raw.chapterTitle;
    if (typeof raw?.chapterSnippet === "string") chapterSnippet = raw.chapterSnippet;
  } catch {
    return jsonError(res, 400, { error: "Invalid JSON body." });
  }

  // Keep only valid user/assistant turns, drop empties, cap to last 8 turns
  // so the prompt stays small and the response stays fast.
  const cleaned: IncomingMessage[] = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim()
    )
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return jsonError(res, 400, { error: "No user message provided." });
  }

  // Identity questions (homepage assistant only) get the fixed, correct answer.
  const fixedReply =
    mode !== "notes" ? identityReply(cleaned[cleaned.length - 1].content) : null;
  if (fixedReply) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(sseFrame({ token: fixedReply }));
    res.write(sseFrame({ done: true }));
    return res.end();
  }

  const systemPrompt =
    mode === "notes"
      ? buildNotesSystemContext(subject, chapterTitle, chapterSnippet)
      : SYSTEM_CONTEXT;

  // ── Open the SSE response ─────────────────────────────────────────────────
  // Headers go out IMMEDIATELY (Node runtime — the exact pattern that is
  // proven healthy in production via ai-result-summary), so the client's
  // fetch resolves instantly and its "Thinking" state is bounded by OUR
  // budget, never by a platform black hole.
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  const send = (obj: unknown): boolean => {
    if (clientClosed) return false;
    try {
      res.write(sseFrame(obj));
      return true;
    } catch {
      clientClosed = true;
      return false;
    }
  };

  const startedAt = Date.now();
  const deadlineAt = startedAt + GLOBAL_BUDGET_MS;
  // Attempt chain: primary → fallback (fresh connection each time).
  const modelChain: string[] = [PRIMARY_MODEL, FALLBACK_MODEL];

  let lastError = "";
  let fatalMessage = ""; // e.g. bad ZAI_API_KEY — message the owner can act on
  let charsSentTotal = 0;

  for (let attempt = 0; attempt < modelChain.length; attempt++) {
    if (clientClosed) break;
    // Attempt 1 ALWAYS runs — the deadline inside streamOneAttempt caps it.
    // Retries only start when enough budget remains to be worth it.
    const remaining = deadlineAt - Date.now();
    if (attempt > 0 && remaining < MIN_ATTEMPT_RESERVE_MS) {
      console.warn(
        `ai-chat: stopping before attempt ${attempt + 1}, only ${remaining}ms left in budget`
      );
      break;
    }
    // Short cool-down before retry attempts — an instantly-rejected previous
    // attempt (429 / concurrency cap) benefits from a brief pause. Never
    // sleeps past the global deadline, and attempt 1 never waits.
    if (attempt > 0) {
      const room = deadlineAt - Date.now() - 500;
      if (room > 0) {
        await new Promise((r) => setTimeout(r, Math.min(RETRY_BACKOFF_MS, room)));
      }
      if (clientClosed) break;
    }

    const model = modelChain[attempt];
    try {
      const result = await streamOneAttempt(
        model,
        systemPrompt,
        cleaned,
        send,
        deadlineAt
      );
      charsSentTotal += result.charsSent;
      if (attempt > 0) {
        console.log(
          `ai-chat: recovered on attempt ${attempt + 1} (model ${model}) after: ${lastError}`
        );
      }
      break; // attempt completed
    } catch (err: any) {
      if (err instanceof PartialStreamError) {
        // Tokens are already on the visitor's screen — end gracefully,
        // never retry (a retry would duplicate the partial answer).
        console.warn(
          `ai-chat: ${err.message} — ending gracefully with partial answer`
        );
        charsSentTotal += err.sentChars;
        break;
      }
      lastError = err?.message || String(err);
      console.warn(`ai-chat: attempt ${attempt + 1} failed (${model}): ${lastError}`);
      if ((err as any)?.fatalAuth) {
        fatalMessage = err.message;
        break; // retrying a bad key is pointless
      }
      if (clientClosed) break; // client gone — no point retrying
      continue;
    }
  }

  if (!clientClosed) {
    if (charsSentTotal === 0) {
      if (fatalMessage) {
        console.error(`ai-chat: fatal upstream auth problem: ${fatalMessage}`);
        send({ error: fatalMessage });
      } else {
        console.error(`ai-chat: all attempts failed. Last error: ${lastError}`);
        send({
          error:
            "The AI assistant is busy right now. Please send your question again in a few seconds.",
        });
      }
    } else {
      send({ done: true });
    }
  }
  res.end();
}
