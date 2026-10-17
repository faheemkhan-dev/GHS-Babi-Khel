// src/components/shared/AIAssistantWidget.tsx
// Floating "AI Assistant" circle button (bottom-right) — homepage only.
// Clicking it opens a wider chat panel where visitors can ask questions
// about the school / website, answered by Z.AI's free GLM flash models
// via our own /api/ai-chat serverless proxy.
//
// STREAMING + TYPING EFFECT:
//   /api/ai-chat returns a Server-Sent Events stream of { token: "..." }
//   frames as the model writes its answer. This component consumes that
//   stream with fetch + ReadableStream, pushes tokens into a reveal queue
//   and drains ONE CHARACTER at a time on a fast interval — so the visitor
//   sees true letter-by-letter typing (like Claude/DeepSeek) no matter how
//   big each network chunk was.
//
// 2026-10-03 REDESIGN: premium green & gold interface, professional answer
// style, correct identity ("built by the GHS Babi Khel Administration" — see
// api/ai-chat.ts), tappable page links, lighter streaming render.
//
// 2026-09-05 REVISION (site-owner request — "remove hardcoded answers"):
//   • The local hardcoded "instant answer" layer (aiInstantAnswers.ts) is
//     GONE — every question now goes to /api/ai-chat and gets a REAL
//     GLM-4.5-Flash answer. No more keyword cards answering the wrong
//     question (asking about the school mission returned the address card).
//   • ONE AUTOMATIC SILENT RETRY: if the server ever reports the assistant
//     "busy", the widget resends the question itself ~1.2 s later — the
//     visitor no longer has to tap send again. (Skipped if the visitor
//     closed the panel or already sent/edited something newer.)
//   • Client timeout raised 25 s → 34 s to stay above the server's new 27 s
//     budget (sized for Z.AI's slow-but-healthy free flash pool).
//
//
// CLAUDE-STYLE POLISH (per site-owner request, 2026-08-31):
//   1. ANIMATED SPARKLE — while the assistant is working before the first
//      token and while it's busy overall, the in-message sparkle glyph
//      "sparkles": a slow continuous rotation plus a heartbeat scale pulse
//      and an orange glow, exactly like Claude's thinking state.
//   2. EDIT + COPY ON YOUR OWN MESSAGES — hovering (desktop) or tapping
//      (mobile) a user bubble reveals two small actions, Copy and Edit,
//      just like Claude. Copy puts the message text on the clipboard and
//      flashes "Copied". Edit turns the bubble into an inline editor with
//      Cancel / Save; saving replaces that message, drops everything after
//      it (including any in-flight partial answer) and re-asks the
//      assistant, streaming a fresh response.
//
// WHY A SERVERLESS PROXY (not Puter.js, not a direct browser call):
//   - A direct browser → Z.AI call would leak the API key.
//   - A same-origin POST to /api/ai-chat is allowed by CSP
//     (connect-src 'self'), keeps the key server-side, and gives us a
//     real AbortController timeout on the client too.
//
//   Get a free Z.AI API key: https://docs.z.ai/guides/llm/glm-4.7

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { m, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { X, Send, Copy, Check, Pencil, Trophy, GraduationCap, Bell, Search, type LucideIcon } from "lucide-react";
import AiSparkleIcon from "./AiSparkleIcon";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // `streaming` = true while tokens are still arriving for this message.
  // Used to show a subtle blinking caret at the end of the partial text.
  streaming?: boolean;
}

const API_ENDPOINT = "/api/ai-chat";
// Hard client-side cap. The server's own budget is 27 s and it ALWAYS ends
// its stream (done or error) within that, so 34 s here is a generous
// last-resort safety net for catastrophic cases (dead network, platform
// outage). It must stay comfortably ABOVE the server budget so the server's
// own error/done frame always wins.
const CLIENT_TIMEOUT_MS = 34000;

// Starter suggestions — the four most common homepage questions.
const STARTER_SUGGESTIONS: { text: string; Icon: LucideIcon }[] = [
  { text: "When will the result be announced?", Icon: Trophy },
  { text: "How do I apply for admission?", Icon: GraduationCap },
  { text: "What's new on the Notices page?", Icon: Bell },
  { text: "How do I check my result by roll number?", Icon: Search },
];

// ── "Thinking" indicator ──────────────────────────────────────────────────
// Three softly pulsing dots (CSS opacity/transform only — no JS animation
// loop, so it stays smooth even on low-end phones).
const TypingDots = () => (
  <span className="ai-typing" aria-label="Assistant is typing" role="status">
    <span /><span /><span />
  </span>
);

// ── Tiny inline markdown renderer ─────────────────────────────────────────
// Same renderer as before — supports line breaks, bullet lists, bold, and
// inline code. Used for the FINAL rendered HTML of each assistant message
// once it has finished streaming (during streaming, we show the raw text
// with a blinking caret so the visitor sees characters appear live).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Known site pages → rendered as tappable in-app links (SPA navigation).
const PATH_RE = /(^|[\s(])(\/(?:results|admission|notices|news|contact|about|calendar|gallery|faq|library|notes|merit-list|roll-no-slip|teachers|dashboard|search|auth\/signin|auth\/forgot-password))(?=[\s).,;:!?]|$)/g;
const URL_RE = /(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g;

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(URL_RE, '<a href="$1" target="_blank" rel="noopener noreferrer" class="ai-link">$1</a>');
  out = out.replace(PATH_RE, '$1<a href="$2" data-nav="1" class="ai-link">$2</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">$1</code>');
  return out;
}

function renderAssistantContent(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;

  const closeList = () => {
    if (list) {
      html.push("</ul>");
      list = null;
    }
  };

  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) {
      closeList();
      continue;
    }
    const bulletMatch = t.match(/^\s*(?:[-•*])\s+(.*)$/);
    const numMatch = t.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bulletMatch || numMatch) {
      const kind = numMatch ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        html.push(`<ul class="ai-bullet-list${kind === "ol" ? " ai-bullet-list--numbered" : ""}">`);
        list = kind;
      }
      html.push(`<li>${renderInline((numMatch ?? bulletMatch)![1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(t)}</p>`);
  }
  closeList();
  return html.join("");
}

// ── SSE stream parser ─────────────────────────────────────────────────────
// Reads from a fetch Response's body stream, parses SSE frames
// (`data: {...}\n\n`), and yields parsed JSON objects. Stops at [DONE].
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<any, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let lineBuf = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;

      lineBuf += decoder.decode(value, { stream: true });

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
        if (dataStr === "[DONE]") return;

        try {
          yield JSON.parse(dataStr);
        } catch {
          // Ignore malformed frames (keepalive comments, etc.)
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

const AIAssistantWidget = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false); // true while streaming is in progress
  const [error, setError] = useState<string | null>(null);
  const [waitingFirstToken, setWaitingFirstToken] = useState(false); // true between send and first token
  // ── Edit / Copy state (Claude-style message actions) ────────────────────
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [actionsIdx, setActionsIdx] = useState<number | null>(null); // touch devices: tapped bubble
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const abortKindRef = useRef<"panel" | "edit" | "timeout" | null>(null);
  const waitingRef = useRef(false);
  // Mirror of `open` for async callbacks (the scheduled auto-retry) that
  // must check the panel state at fire time, not render time.
  const panelOpenRef = useRef(false);
  // Generation counter: every runStream call takes a new generation. All
  // state mutations inside a stream are guarded by it, so a stale abort
  // (e.g. "Edit" canceling an in-flight answer) can never corrupt the
  // state of a newer conversation turn.
  const streamGenRef = useRef(0);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Hover-capable device? Desktop shows actions on hover; touch devices
  // show them after tapping the bubble.
  const canHover = useMemo(
    () => typeof matchMedia === "function" && !matchMedia("(hover: none)").matches,
    []
  );

  useEffect(() => {
    panelOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, waitingFirstToken]);

  // Focus the input shortly after the panel opens. Skipped on touch devices
  // to avoid popping the on-screen keyboard before the user has chosen to type.
  useEffect(() => {
    if (!open) return;
    const isTouch = matchMedia("(hover: none)").matches;
    if (isTouch) return;
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [open]);

  // Focus + select the textarea when entering edit mode.
  useEffect(() => {
    if (editingIdx === null) return;
    const el = editTextareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editingIdx]);

  // Abort any in-flight stream when the panel closes — saves server CPU
  // and bandwidth if the visitor closes the chat mid-answer.
  useEffect(() => {
    if (!open && abortRef.current) {
      abortKindRef.current = "panel";
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
      setWaitingFirstToken(false);
      waitingRef.current = false;
      // Mark the last assistant message as no longer streaming.
      setMessages((prev) =>
        prev.map((msg, i) =>
          i === prev.length - 1 && msg.role === "assistant"
            ? { ...msg, streaming: false }
            : msg
        )
      );
    }
  }, [open]);

  // ── Core streaming pipeline ───────────────────────────────────────────────
  // Takes the conversation INCLUDING the latest user turn (but WITHOUT the
  // empty assistant placeholder), appends the placeholder, and streams the
  // answer into it character by character. Used both by normal sends and by
  // "Save" after editing a message.
  const runStream = useCallback(
    async (base: ChatMessage[], retryDepth = 0) => {
      const nextMessages: ChatMessage[] = [
        ...base,
        // Pre-add an empty assistant message that we'll fill as tokens arrive.
        { role: "assistant", content: "", streaming: true },
      ];
      setMessages(nextMessages);
      setError(null);
      setLoading(true);
      setWaitingFirstToken(true);
      waitingRef.current = true;
      setActionsIdx(null);

      // Index of the assistant message we're streaming into.
      const assistantIdx = nextMessages.length - 1;

      const controller = new AbortController();
      abortRef.current = controller;
      abortKindRef.current = null;
      const myGen = ++streamGenRef.current;
      const isCurrent = () => streamGenRef.current === myGen;

      // Hard client-side safety net (the server's own watchdogs normally
      // finish long before this).
      const clientTimer = setTimeout(() => {
        abortKindRef.current = "timeout";
        controller.abort();
      }, CLIENT_TIMEOUT_MS);

      // ── Letter-by-letter reveal queue ──────────────────────────────────
      // Z.AI's deltas can arrive as multi-character chunks (e.g. "Hello",
      // " there"), which would otherwise pop onto the screen as a whole
      // chunk at once. To get a true Claude-style typing effect, we push
      // incoming text into a small queue and drain ONE character at a time
      // on a fast interval, independent of how big each network delta was.
      let revealQueue = "";
      let revealTimer: ReturnType<typeof setInterval> | null = null;
      const CHAR_INTERVAL_MS = 28; // one tick per reveal step (~35 renders/s — smooth on low-end phones)

      const appendToAssistant = (chunk: string) => {
        if (!isCurrent()) return;
        setMessages((prev) => {
          const copy = prev.slice();
          const cur = copy[assistantIdx];
          if (cur && cur.role === "assistant") {
            copy[assistantIdx] = { ...cur, content: cur.content + chunk };
          }
          return copy;
        });
      };

      // `charsPerTick`: 3 per 28 ms → ~105 chars/s — visibly typed, Claude-style.
      const startRevealTimer = (charsPerTick = 3) => {
        if (revealTimer) return;
        revealTimer = setInterval(() => {
          if (revealQueue.length === 0) return;
          // Adaptive: a long backlog drains faster so the visitor never waits.
          const step = Math.max(charsPerTick, Math.ceil(revealQueue.length / 40));
          const chunk = revealQueue.slice(0, step);
          revealQueue = revealQueue.slice(chunk.length);
          appendToAssistant(chunk);
        }, CHAR_INTERVAL_MS);
      };

      const stopRevealTimer = () => {
        if (revealTimer) {
          clearInterval(revealTimer);
          revealTimer = null;
        }
      };

      // Drain whatever's left in the queue instantly (used on error/abort
      // so the visitor never loses the tail end of an answer).
      const flushRevealQueue = () => {
        if (revealQueue) {
          appendToAssistant(revealQueue);
          revealQueue = "";
        }
        stopRevealTimer();
      };

      try {
        // ── STREAMED PATH ─ /api/ai-chat (Node runtime · GLM-4.5-Flash) ─
        // EVERY question takes this path — the old local hardcoded answer
        // layer was removed, so the model answers everything, including the
        // common questions it used to never see.
        const res = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            // Send only the user/assistant turns BEFORE the empty assistant
            // placeholder — the server doesn't need to see the empty one.
            messages: nextMessages.slice(0, -1).map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // Try to parse a JSON error body (non-streaming error response).
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Request failed (${res.status}).`);
        }
        if (!res.body) {
          throw new Error("AI Assistant did not return a stream. Please try again.");
        }

        // ── Consume the SSE stream ────────────────────────────────────────
        // For each { token } event, append to the last assistant message's
        // content. The first token also clears `waitingFirstToken` so the
        // animated sparkle disappears and the streaming text takes over.
        for await (const evt of parseSseStream(res.body, controller.signal)) {
          if (evt?.token && typeof evt.token === "string") {
            if (waitingRef.current) {
              waitingRef.current = false;
              setWaitingFirstToken(false);
            }
            // Push into the reveal queue instead of appending directly —
            // the interval timer drains it one character at a time so the
            // visitor sees true letter-by-letter typing regardless of how
            // large this particular network chunk was.
            revealQueue += evt.token;
            startRevealTimer();
          } else if (evt?.error && typeof evt.error === "string") {
            throw new Error(evt.error);
          } else if (evt?.done === true) {
            break;
          }
        }

        // Stream finished on the network side — let the reveal queue finish
        // draining naturally (don't force-flush here, so the tail end of the
        // answer still types out letter by letter instead of popping in).
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (revealQueue.length === 0) {
              clearInterval(check);
              resolve();
            }
          }, CHAR_INTERVAL_MS);
        });
        stopRevealTimer();

        // Mark the message as no longer streaming.
        if (!isCurrent()) return;
        setMessages((prev) => {
          const copy = prev.slice();
          const cur = copy[assistantIdx];
          if (cur && cur.role === "assistant") {
            copy[assistantIdx] = { ...cur, streaming: false, content: cur.content.trim() };
          }
          return copy;
        });
      } catch (err) {
        // A newer stream owns the conversation state now (e.g. this stream
        // was aborted by "Edit") — drop everything silently.
        if (!isCurrent()) return;
        flushRevealQueue();
        if (err?.name === "AbortError") {
          if (abortKindRef.current === "panel") {
            // Silent — panel closed mid-answer.
          } else if (abortKindRef.current === "edit") {
            // Silent — the edit flow takes over the conversation state.
          } else {
            setError(
              "The AI didn't respond in time. Send your question again."
            );
          }
        } else {
          setError(err?.message || "Something went wrong. Please try again.");
        }
        // Remove the empty/partial assistant placeholder on error/abort —
        // but never touch state that belongs to a newer conversation
        // (e.g. after an edit truncated the messages array).
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (copy.length > 0 && last?.role === "assistant" && last.streaming !== undefined) {
            if (!last.content.trim()) {
              copy.pop();
            } else {
              copy[copy.length - 1] = { ...last, streaming: false };
            }
          }
          return copy;
        });

        // ── ONE automatic silent retry on a transient "busy" report ──────
        // The server only says "busy" when BOTH upstream attempts failed
        // (rare now that its budgets match the free pool's real latency).
        // Instead of making the visitor tap send again, resend the same
        // question once ~1.2 s later — but only if nothing newer started
        // (no new send/edit, panel still open).
        const errMsg: string = err?.message || "";
        if (
          retryDepth === 0 &&
          err?.name !== "AbortError" &&
          /busy right now/i.test(errMsg) &&
          streamGenRef.current === myGen &&
          panelOpenRef.current
        ) {
          setTimeout(() => {
            if (streamGenRef.current !== myGen || !panelOpenRef.current) return;
            void runStream(base, 1);
          }, 1200);
        }
      } finally {
        clearTimeout(clientTimer);
        stopRevealTimer();
        // Only the CURRENT stream may reset the shared busy flags — a stale
        // stream's finally must not clobber a newer turn that is still running.
        if (isCurrent()) {
          setLoading(false);
          setWaitingFirstToken(false);
          waitingRef.current = false;
          if (abortRef.current === controller) {
            abortRef.current = null;
            abortKindRef.current = null;
          }
        }
      }
    },
    [open]
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      const base: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      // Every question goes to /api/ai-chat (GLM-4.5-Flash) for a real
      // streamed answer — the old hardcoded instant-answer layer is gone.
      void runStream(base);
    },
    [messages, loading, runStream]
  );

  // ── Copy / Edit actions (Claude-style) ────────────────────────────────────
  const copyMessage = useCallback(async (idx: number) => {
    const msg = messages[idx];
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      // Clipboard API can be unavailable (permissions / older webviews) —
      // fall back to a temporary textarea + execCommand.
      const ta = document.createElement("textarea");
      ta.value = msg.content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        // give up silently — nothing else we can do
      }
      ta.remove();
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1600);
  }, [messages]);

  const startEdit = useCallback(
    (idx: number) => {
      const msg = messages[idx];
      if (!msg || msg.role !== "user") return;
      // If an answer is currently streaming, stop it first — exactly like
      // Claude, editing a message cancels the in-flight response.
      if (abortRef.current) {
        abortKindRef.current = "edit";
        abortRef.current.abort();
        abortRef.current = null;
        setLoading(false);
        setWaitingFirstToken(false);
        waitingRef.current = false;
      }
      // Everything after the edited message (including any partial answer)
      // is dropped — it will be regenerated after saving.
      setMessages((prev) => prev.slice(0, idx + 1));
      setEditDraft(msg.content);
      setEditingIdx(idx);
      setActionsIdx(null);
      setError(null);
    },
    [messages]
  );

  const cancelEdit = useCallback(() => {
    setEditingIdx(null);
    setEditDraft("");
  }, []);

  const saveEdit = useCallback(() => {
    if (editingIdx === null) return;
    const draft = editDraft.trim();
    if (!draft) return;
    // Replace the edited message, drop everything after it, and re-ask.
    const base: ChatMessage[] = [
      ...messages.slice(0, editingIdx),
      { role: "user", content: draft },
    ];
    setEditingIdx(null);
    setEditDraft("");
    void runStream(base);
  }, [editingIdx, editDraft, messages, runStream]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
    setInput("");
  };

  // Pre-render assistant message HTML. Finished messages are cached by
  // content so a streaming tick only re-parses the one message that grew.
  const renderCache = useRef<Map<string, string>>(new Map());
  const renderedAssistant = useMemo(() => {
    const cache = renderCache.current;
    if (cache.size > 60) cache.clear();
    return messages.map((msg) => {
      if (msg.role !== "assistant") return null;
      if (msg.streaming) return renderAssistantContent(msg.content);
      let html = cache.get(msg.content);
      if (html === undefined) {
        html = renderAssistantContent(msg.content);
        cache.set(msg.content, html);
      }
      return html;
    });
  }, [messages]);

  // Tapping a page link inside an answer navigates inside the app (no reload).
  const navigate = useNavigate();
  const onBubbleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const a = (e.target as HTMLElement).closest?.("a[data-nav]") as HTMLAnchorElement | null;
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href");
      if (href) {
        setOpen(false);
        navigate(href);
      }
    },
    [navigate]
  );

  // Escape closes the panel (desktop keyboards).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingIdx === null) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, editingIdx]);

  return (
    <>
      {/* ── Floating launcher ───────────────────────────────────────────
          Deep-green circle with a gold sparkle and a fine gold ring; on
          laptops it widens into an "Ask AI" pill. One-shot entrance only
          (no looping animation) so it never costs scroll performance.

          Sized down from 52px → 44px with a 1.5px ring (was 2px): the old
          proportions read as a heavy, thick disc on a laptop screen. 44px
          is still the standard minimum touch target, so it stays
          comfortable to tap. The chat panel's bottom offsets below are
          trimmed by the same 8px to keep the gap to the launcher intact. */}
      <m.button
        type="button"
        aria-label={open ? "Close AI Assistant" : "Open AI Assistant"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.8, type: "spring", stiffness: 300, damping: 24 }}
        whileTap={{ scale: 0.94 }}
        style={{ background: "linear-gradient(145deg,#14532d 0%,#0e3b20 100%)" }}
        className="ai-launcher fixed right-4 sm:right-6 z-[60] h-[44px] min-w-[44px] lg:px-3.5 flex items-center justify-center gap-1.5 rounded-full text-white ring-[1.5px] ring-[#d4a93a]/70 shadow-[0_6px_18px_-6px_rgba(14,59,32,0.5)] hover:ring-[#e9c46a] transition-shadow bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
      >
        {open ? (
          <X className="w-[18px] h-[18px] text-[#e9c46a]" />
        ) : (
          <AiSparkleIcon size={21} className="text-[#e9c46a]" />
        )}
        {!open && (
          <span className="hidden lg:inline text-[13px] font-semibold tracking-wide text-white">
            Ask AI
          </span>
        )}
      </m.button>

      {/* ── Chat panel ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <m.div
            role="dialog"
            aria-label="GHS Babi Khel AI Assistant"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed right-3 sm:right-6 z-[60] w-[calc(100vw-1.5rem)] max-w-[26rem] lg:max-w-[27.5rem] h-[34rem] lg:h-[36rem] max-h-[78vh] bg-background border border-border rounded-[22px] shadow-[0_24px_60px_-12px_rgba(8,32,18,0.45)] flex flex-col overflow-hidden bottom-[calc(7.25rem+env(safe-area-inset-bottom,0px))] lg:bottom-[5.5rem]"
          >
            {/* Header — deep green with gold accents (same in light & dark) */}
            <div
              className="relative shrink-0 flex items-center gap-3 px-4 py-3.5 text-white"
              style={{ background: "linear-gradient(135deg,#0e3b20 0%,#14532d 60%,#1b6b3a 100%)" }}
            >
              <span
                className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center ring-2 ring-white/20"
                style={{ background: "linear-gradient(145deg,#f0d27a 0%,#d4a93a 100%)" }}
              >
                <AiSparkleIcon size={22} className="text-[#0e3b20]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[15px] font-semibold leading-tight truncate">
                  GHS Babi Khel <span className="text-[#e9c46a]">AI Assistant</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight text-white/75">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  Online · Official school assistant
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close AI Assistant"
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <span
                className="absolute bottom-0 inset-x-0 h-[2px]"
                style={{ background: "linear-gradient(90deg,transparent,#d4a93a,transparent)" }}
                aria-hidden="true"
              />
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto overscroll-contain px-3.5 py-4 space-y-3.5 bg-secondary/40"
            >
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-card border border-border px-4 py-3.5 shadow-sm">
                    <p className="font-display text-base font-semibold text-foreground">
                      Welcome to GHS Babi Khel
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      I'm the official school assistant. Ask me about results, admissions, notices, news, the student portal or how to find anything on this site.
                    </p>
                  </div>
                  <div>
                    <p className="px-1 mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a6508] dark:text-[#e9c46a]">
                      Popular questions
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {STARTER_SUGGESTIONS.map(({ text, Icon }) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => sendMessage(text)}
                          className="group flex items-center gap-3 text-left text-[13px] px-3 py-2.5 rounded-xl bg-card hover:bg-secondary border border-border hover:border-[#d4a93a]/70 text-foreground transition-colors"
                        >
                          <span className="shrink-0 w-8 h-8 rounded-lg bg-secondary text-primary dark:text-primary flex items-center justify-center group-hover:bg-[#f5e6c4] group-hover:text-[#8a6508] dark:group-hover:bg-[#e9c46a]/15 dark:group-hover:text-[#e9c46a] transition-colors">
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="leading-snug">{text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col ${
                    msg.role === "user" ? "items-end group" : "items-start"
                  }`}
                >
                  {msg.role === "user" ? (
                    editingIdx === i ? (
                      /* ── Inline edit mode ──────────────────────────── */
                      <div className="w-[92%] rounded-2xl rounded-br-md bg-[#14532d] px-2.5 pt-2.5 pb-2 shadow-sm">
                        <textarea
                          ref={editTextareaRef}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              saveEdit();
                            }
                          }}
                          rows={Math.min(6, Math.max(2, editDraft.split("\n").length))}
                          className="w-full bg-transparent text-sm leading-relaxed text-white resize-none focus:outline-none placeholder:text-white/50"
                          placeholder="Edit your message…"
                        />
                        <div className="flex items-center justify-end gap-1.5 pt-1.5">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="text-[11px] px-2.5 py-1 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={!editDraft.trim()}
                            className="text-[11px] font-semibold px-3 py-1 rounded-full bg-[#e9c46a] text-[#0e3b20] hover:bg-[#f0d27a] disabled:opacity-40 transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* ── The visitor's bubble ──────────────────── */}
                        <div
                          onClick={() => {
                            if (!canHover) {
                              setActionsIdx((cur) => (cur === i ? null : i));
                            }
                          }}
                          style={{ background: "linear-gradient(135deg,#14532d 0%,#1b6b3a 100%)" }}
                          className={`max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words text-white shadow-sm ${
                            canHover ? "" : "cursor-pointer"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div
                          className={`flex items-center gap-0.5 mt-1 mr-1 transition-opacity duration-150 ${
                            canHover
                              ? "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                              : actionsIdx === i
                                ? "opacity-100"
                                : "opacity-0 pointer-events-none"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => copyMessage(i)}
                            aria-label="Copy message"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] leading-none text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            {copiedIdx === i ? (
                              <>
                                <Check className="w-3 h-3 text-green-600" />
                                <span className="text-green-600">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(i)}
                            aria-label="Edit message"
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] leading-none text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    /* ── Assistant answer: avatar + card ───────────── */
                    <div className="flex items-start gap-2 max-w-[94%]">
                      <span
                        className="shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ background: "linear-gradient(145deg,#f0d27a 0%,#d4a93a 100%)" }}
                        aria-hidden="true"
                      >
                        <AiSparkleIcon size={15} className="text-[#0e3b20]" />
                      </span>
                      <div className="min-w-0">
                        <div
                          onClick={onBubbleClick}
                          className="ai-message-bubble rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13.5px] leading-relaxed bg-card border border-border text-foreground shadow-sm min-w-[56px]"
                        >
                          {msg.streaming && waitingFirstToken && !msg.content ? (
                            <TypingDots />
                          ) : (
                            <div
                              dangerouslySetInnerHTML={{
                                __html:
                                  (renderedAssistant[i] ?? "") +
                                  (msg.streaming ? '<span class="ai-caret"></span>' : ""),
                              }}
                            />
                          )}
                        </div>
                        {!msg.streaming && msg.content && (
                          <button
                            type="button"
                            onClick={() => copyMessage(i)}
                            aria-label="Copy answer"
                            className="mt-1 ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] leading-none text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            {copiedIdx === i ? (
                              <>
                                <Check className="w-3 h-3 text-green-600" />
                                <span className="text-green-600">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                Copy
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {error && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-border bg-card">
              <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3 pb-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about results, admission, notices…"
                  disabled={loading}
                  className="flex-1 min-w-0 text-sm px-3.5 py-2.5 rounded-xl bg-secondary/60 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#d4a93a]/40 focus:border-[#d4a93a]/70 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  className="shrink-0 w-10 h-10 rounded-xl bg-[#d4a93a] hover:bg-[#e9c46a] text-[#0e3b20] flex items-center justify-center disabled:opacity-40 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <p className="px-3 pb-2.5 text-center text-[10px] text-muted-foreground">
                Official AI Assistant · GHS Babi Khel Administration
              </p>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AIAssistantWidget;
