// api/ai-chat.ts
// Vercel Serverless Function — proxies Z.AI's free GLM flash chat API for
// the homepage AI Assistant widget.
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
//   • LIVE DATA (2026-11): the prompt's facts are read from the database per
//     request window (see BEHAVIOUR_RULES / buildLiveBlock below).
//   • The frontend hardcoded "instant answer" engine was REMOVED
//     (2026-09-05, site-owner request): every question now reaches THIS
//     endpoint and gets a real GLM answer — no more keyword cards answering
//     the wrong question (e.g. "mission" → address card).
//
// PROTOCOL (unchanged — both frontends already speak it):
//   Request:  POST /api/ai-chat  { messages: [...] }
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

// ── System prompt = fixed BEHAVIOUR rules + LIVE school data ─────────────────
// 2026-11 REWRITE (site-owner request — "old data, hardcoded"): this file no
// longer contains ANY school fact that can change. Admission status, fee,
// dates, seats, merit lists, exams, grading scale, notices, staff, contact
// details and the FAQ are read from the school database on every cold/60 s
// cache window via the same live data layer that powers /api/ai-data
// (api/render.js → getLiveSiteData). The prompt only tells the model HOW to
// behave; WHAT is true comes from the live block appended per question.
const BEHAVIOUR_RULES = `You are the official AI Assistant of Government High School (GHS) Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan, on the school website (https://ghsbabikhel.dpdns.org).

IDENTITY (never break these)
- You were built by the GHS Babi Khel Administration for this school's students, parents and visitors. If asked who built you, who owns you, or which company or AI model you are: say the "GHS Babi Khel Administration" built you. Never name or discuss any underlying model, vendor or technology; if pushed, say those details are managed by the school administration.
- Your name: "GHS Babi Khel AI Assistant". Never claim to be human or a different AI.

GROUNDING (most important)
- Answer ONLY from the LIVE SCHOOL DATA block below. It is read from the school database right now and overrides anything you remember. If the block does not contain the answer, say it is not published yet and point to the right page — never guess.
- Never invent or "recall" dates, fees, seats, marks, roll numbers, names, phone numbers, timings or policies. Use the exact values in the block (quote the numbers and dates as given).
- The website has no student dashboard: sign-in is for the school administration only. Applicants track admission on /admission or /admission/portal; students find roll slips on /roll-no-slip and results on /results.
- A specific student's marks, roll number or application is private: tell them how to look it up themselves; never state one.
- Off-topic: briefly redirect to school/website topics (short, accurate study help is fine).
- Match the visitor's language (Urdu/Pashto included; Roman script if they write in Roman). Default English.

STYLE
- Warm, polished, confident. Greet only on a greeting. One-line direct answer first, then at most 4 short bullets ("- ", under 18 words). Numbered list for steps. **Bold** sparingly, at most one emoji, no headings or tables.
- Finish with one line when a page matches, e.g. "Next step: open the Admission page (/admission)." Typically 40–110 words.`;

const PKT = "Asia/Karachi";
const fmtD = (iso?: string | null) => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: PKT, day: "numeric", month: "long", year: "numeric" })
      .format(new Date(String(iso).length <= 10 ? `${iso}T12:00:00+05:00` : iso));
  } catch { return String(iso).slice(0, 10); }
};
const clip = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// 60 s in-memory cache per warm function instance (the live layer itself is
// already parallel + timeout-capped; this just avoids re-querying on every
// chat message).
let liveCache: { at: number; data: any } | null = null;
const LIVE_TTL_MS = 60_000;
const LIVE_SECTIONS = [
  "school", "admission", "classes", "admissionMerit", "exams", "meritLists",
  "rollSlips", "teachers", "notices", "customFaqs",
];

async function getLiveData(): Promise<any | null> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.data;
  try {
    // @ts-ignore — plain-JS sibling function module (no type declarations)
    const mod: any = await import("./render.js");
    const data = await Promise.race([
      mod.getLiveSiteData(LIVE_SECTIONS, { bisep: true, bisepTimeoutMs: 2000 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("live data timeout")), 5000)),
    ]);
    liveCache = { at: Date.now(), data };
    return data;
  } catch (err: any) {
    console.warn("ai-chat: live data unavailable:", err?.message || err);
    return liveCache?.data ?? null; // stale beats nothing
  }
}

const STOP = new Set("what when where which who how why the and for are you your can does did have has with this that from about please tell give need want will would should could any there their them they school khel babi".split(" "));
function tokens(t: string): string[] {
  return (t.toLowerCase().match(/[a-z0-9\u0600-\u06ff]{3,}/g) || []).filter((w) => !STOP.has(w));
}

/** Compact live fact sheet + the FAQ answers most relevant to the question. */
function buildLiveBlock(data: any | null, question: string): string {
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: PKT, dateStyle: "full", timeStyle: "short" }).format(new Date());
  // currently_open === null means the settings row could not be read at all
  // (database unreachable) — never present empty lists as "nothing published".
  if (!data || (data.admission?.currently_open === null && !(data.notices || []).length)) {
    return `LIVE SCHOOL DATA\nThe live database could not be reached right now (current time ${now} PKT). Do not state any fee, date, seat count, status or notice. Tell the visitor to open the relevant page (/admission, /results, /notices, /contact) or ${"https://ghsbabikhel.dpdns.org/api/ai-data"} for current information.`;
  }
  const s = data.school || {}, a = data.admission || {}, ex = data.exams || {};
  const L: string[] = [`LIVE SCHOOL DATA (read from the school database; current time ${now} PKT)`];
  L.push(`School: ${s.full_name || s.name}, ${s.location}. Established ${s.established}. EMIS ${s.emis_code}. Principal: ${s.principal}. Classes ${(s.classes_offered || []).join(", ")}. Board: ${s.board}.`);
  L.push(`Contact: phone ${s.phone}; email ${s.email}${a.contact_whatsapp ? `; WhatsApp ${a.contact_whatsapp}` : ""}. Page /contact has map and form.`);
  const st = [s.total_students != null && `${s.total_students}+ students`, s.total_teachers != null && `${s.total_teachers} teachers`, s.pass_percentage != null && `${s.pass_percentage}% pass rate`].filter(Boolean);
  if (st.length) L.push(`Statistics set by administration: ${st.join(", ")}.`);

  L.push(`ADMISSION: online form is ${a.currently_open === true ? "OPEN" : a.currently_open === false ? "CLOSED/paused" : "status unknown"}${a.session_year ? ` (session ${a.session_year})` : ""}.${a.open_date ? ` Opens ${fmtD(a.open_date)}.` : ""}${a.last_date ? ` Last date ${fmtD(a.last_date)}.` : " No last date announced."}${a.banner_message ? ` Announcement: ${clip(a.banner_message, 200)}` : ""}`);
  L.push(`Fee: ${a.fee_text || "see /admission"}${(a.payment_methods || []).length ? ` Payment options: ${a.payment_methods.map((m: any) => m.label || (m.type === "bank" && m.bank_name ? `bank (${m.bank_name})` : m.type)).join(", ")}.` : ""}`);
  if ((data.classes || []).length) L.push(`Seats: ${data.classes.map((c: any) => `Class ${c.class}: ${c.seats} (${c.is_open ? "open" : "closed"})`).join("; ")}.`);
  L.push(`Admission flow: apply on /admission → reference number → pay processing fee by challan if a fee is set → office verifies → seats filled by merit list (previous-class marks) → merit-listed students submit documents at the office. Track by reference/B-Form/phone on /admission; full timeline at /admission/portal (reference + B-Form). Documents: ${(a.required_documents || []).join("; ")}.`);
  if ((data.admissionMerit || []).length) L.push(`Published admission merit lists: ${data.admissionMerit.slice(0, 8).map((m: any) => `${m.title} (${fmtD(m.published_at)}, ${m.listed_count} listed)`).join("; ")}.`);
  if ((data.admissionFiles || []).length) L.push(`Downloadable admission files: ${data.admissionFiles.slice(0, 6).map((f: any) => `${f.title}`).join("; ")} (on /admission).`);

  if ((ex.published_exams || []).length) L.push(`RESULTS published: ${ex.published_exams.slice(0, 8).map((e: any) => `${e.exam}${e.class ? ` Class ${e.class}` : ""}${e.year ? ` ${e.year}` : ""}`).join("; ")}. Search by roll number on /results.`);
  else L.push("RESULTS: no school exam result is published right now. Search by roll number on /results when published.");
  const b = data.bisep;
  if (b && b.ok && b.exam_title) L.push(`BISE Peshawar current cycle: ${String(b.exam_title).trim()} — ${b.is_live ? "results are LIVE" : b.countdown_date ? `announcement scheduled ${new Intl.DateTimeFormat("en-GB", { timeZone: PKT, dateStyle: "full", timeStyle: "short" }).format(new Date(b.countdown_date))} PKT` : "not announced yet"}.`);
  if (ex.grading?.ranges) L.push(`Grading: ${ex.grading.ranges.map((r: any) => r.grade === "Fail" ? `Fail below ${ex.grading.pass_threshold}%` : `${r.grade} ${r.min_percentage}–${r.max_percentage}%`).join(", ")}.`);
  if ((data.meritLists || []).length) L.push(`Result merit lists published: ${data.meritLists.slice(0, 5).map((m: any) => m.title).join("; ")} (/merit-list).`);
  const slips = data.rollSlips || [];
  if (slips.length) L.push(`Roll number slips: ${slips.slice(0, 5).map((r: any) => `${r.title} [${r.status}${r.publish_at ? `, publishes ${fmtD(r.publish_at)}` : ""}]`).join("; ")} (/roll-no-slip: pick class + type full name).`);
  else L.push("Roll number slips: none published or scheduled right now (/roll-no-slip).");

  if ((data.notices || []).length) {
    L.push("LATEST NOTICES (newest first, /notices):");
    for (const n of data.notices.slice(0, 8)) L.push(`- ${fmtD(n.published_at)}${n.urgent ? " URGENT" : ""}: ${clip(n.title, 110)} — ${clip(n.content, 220)}`);
  } else L.push("Notices: none published right now.");
  if ((data.teachers || []).length) L.push(`Staff (/teachers): ${data.teachers.length} listed; subjects: ${[...new Set(data.teachers.map((t: any) => t.subject).filter(Boolean))].slice(0, 15).join(", ")}.`);
  L.push("Pages: /results /admission /admission/portal /notices /merit-list /roll-no-slip /duties (teachers' BISE exam duty draw) /teachers /about /contact /faq. Website developer: Muhammad Faheem, class-10 Computer Science student of the school.");

  // FAQ retrieval — the live, generated FAQ answers most relevant to this question.
  const qt = new Set(tokens(question));
  const faq: Array<{ question: string; answer: string }> = data.faq?.items || [];
  const scored = faq
    .map((f) => ({ f, sc: tokens(f.question + " " + f.answer).reduce((n, w) => n + (qt.has(w) ? 1 : 0), 0) + tokens(f.question).reduce((n, w) => n + (qt.has(w) ? 3 : 0), 0) }))
    .filter((x) => x.sc > 0).sort((x, y) => y.sc - x.sc).slice(0, 3);
  if (scored.length) {
    L.push("RELEVANT FAQ (live-generated):");
    for (const { f } of scored) L.push(`Q: ${f.question}\nA: ${clip(f.answer, 900)}`);
  }
  return L.join("\n");
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
  "The **GHS Babi Khel website** was independently designed and developed by **Muhammad Faheem**, a class-10 (matric) Computer Science student of the school, son of Zabih Ullah, from Village Sangar, Tehsil Halimzai, District Mohmand, KPK — as a school/community project.\n" +
  "- This AI Assistant was built by the **GHS Babi Khel Administration**.\n" +
  "- For school matters such as admissions or results, use the Contact page (/contact).";
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

  // Parse + validate the incoming messages array.
  // Vercel's Node runtime parses JSON bodies into req.body automatically.
  let messages: IncomingMessage[] = [];
  try {
    const raw: any =
      typeof (req as any).body === "string"
        ? JSON.parse((req as any).body || "{}")
        : (req as any).body;
    if (!raw) throw new Error("empty body");
    messages = Array.isArray(raw?.messages) ? raw.messages : [];
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
  const fixedReply = identityReply(cleaned[cleaned.length - 1].content);
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

  // Live facts are fetched BEFORE the SSE stream opens (cached 60 s, hard
  // 5 s cap) so the model always answers from current database values.
  const liveData = await getLiveData();
  const systemPrompt =
    BEHAVIOUR_RULES + "\n\n" + buildLiveBlock(liveData, cleaned[cleaned.length - 1].content);

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
