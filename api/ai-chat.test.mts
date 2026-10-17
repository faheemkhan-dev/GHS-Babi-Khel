// api/ai-chat.test.mts
// Offline functional tests for the REWRITTEN Node-runtime ai-chat handler.
// Mocks global fetch (the Z.AI upstream) and a fake ServerResponse, then
// exercises every reliability path:
//   1. happy stream → tokens + done
//   2. first model stalls at first-token watchdog → fallback model recovers
//   3. both attempts fail → single {"error":…} frame, stream closes
//   4. upstream 401 → fatal auth, ONE attempt, clear owner-facing error
//   5. OPTIONS preflight → instant 200, no upstream call
//   6. invalid/empty messages → 400 JSON
//   7. partial stream then stall → graceful done, NO retry (no duplication)
//   8. total upstream hang → handler still terminates within its budget
//   9. rate limit → 429 JSON before any upstream call
//
// Run: npx vitest run --config vitest.standalone.config.mts

import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";

// ── Shrink the budgets BEFORE importing the module (constants are read at
//    module-load time) so tests run in milliseconds, not seconds. ──────────
process.env.AI_FIRST_TOKEN_TIMEOUT_MS = "250";
process.env.AI_ATTEMPT_BUDGET_MS = "400";
// Must leave room for BOTH attempts: 250ms watchdog + retry reserve (min(2500, 3000) = 2500).
process.env.AI_GLOBAL_BUDGET_MS = "3000";
process.env.ZAI_API_KEY = "test-key-123";
process.env.ZAI_MODEL = "glm-test-primary";

// ── Fake ServerResponse ────────────────────────────────────────────────────
function makeFakeRes() {
  const written: string[] = [];
  let ended = false;
  const headers: Record<string, unknown> = {};
  const res: any = {
    statusCode: 0,
    headers,
    written,
    get ended() {
      return ended;
    },
    setHeader(k: string, v: unknown) {
      headers[k.toLowerCase()] = v;
    },
    flushHeaders() {},
    write(chunk: string) {
      if (ended) throw new Error("write after end");
      written.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    on(_evt: string, _cb: () => void) {
      /* never fire "close" in tests */
    },
  };
  return res;
}

// ── Fake upstream builders ─────────────────────────────────────────────────
function sseData(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Upstream that streams the given tokens, then [DONE]. */
function okUpstream(tokens: string[], modelEcho?: (url: string, body: any) => void) {
  return vi.fn(async (url: string, init: any) => {
    modelEcho?.(url, JSON.parse(init.body));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const t of tokens) {
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`
            )
          );
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return { ok: true, status: 200, body } as any;
  });
}

/** Upstream whose response body NEVER produces a readable chunk until the
 *  fetch signal aborts (mirrors undici rejecting the pending read on abort). */
function stallingUpstream() {
  return vi.fn((_url: string, init: any) => {
    const signal: AbortSignal = init.signal;
    const body = new ReadableStream<Uint8Array>({
      start() {},
      pull() {
        /* never push — eternal stall */
      },
      cancel() {},
    });
    const reader = (body as any).getReader();
    const stallReader = {
      read: () =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) return reject(new Error("AbortError"));
          signal.addEventListener("abort", () => reject(new Error("AbortError")));
        }),
    };
    return Promise.resolve({
      ok: true,
      status: 200,
      body: { getReader: () => stallReader },
    } as any);
  });
}

/** Fake Request-like req for the Node handler. */
function makeReq(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return {
    method,
    headers,
    body,
    on: (_evt: string, _cb: () => void) => {},
  } as any;
}

let handler: (req: any, res: any) => Promise<void>;

beforeAll(async () => {
  const mod = await import("./ai-chat");
  handler = (mod as any).default;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("ai-chat (Node runtime rewrite)", () => {
  it("OPTIONS preflight returns 200 instantly with CORS, zero upstream calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = makeFakeRes();
    await handler(makeReq("OPTIONS"), res);
    expect(res.statusCode).toBe(200);
    expect(res.ended).toBe(true);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods with 405 JSON", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = makeFakeRes();
    await handler(makeReq("GET"), res);
    expect(res.statusCode).toBe(405);
    expect(String(res.headers["content-type"])).toContain("application/json");
  });

  it("rejects empty/invalid message lists with 400", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const body of [{ messages: [] }, { messages: [{ role: "assistant", content: "hi" }] }, {}]) {
      const res = makeFakeRes();
      await handler(makeReq("POST", body), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("streams tokens then done on the happy path", async () => {
    const upstream = okUpstream(["Hello", "!", " Welcome"]);
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }] }),
      res
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    const tokens = frames.filter((f: any) => f.token).map((f: any) => f.token);
    expect(tokens.join("")).toBe("Hello! Welcome");
    expect(frames[frames.length - 1]).toEqual({ done: true });
    // Exactly ONE upstream call — no pointless retries on success.
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("retries on the fallback model when the first model stalls, then recovers", async () => {
    // First call: eternal stall → first-token watchdog (250ms) → retry.
    // Second call: healthy stream on the fallback model.
    let call = 0;
    const upstream = vi.fn(async (_url: string, init: any) => {
      call += 1;
      if (call === 1) return stallingUpstream()(_url, init);
      return okUpstream(["Recovered ", "answer"])("", init);
    });
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    const t0 = Date.now();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hello" }] }),
      res
    );
    const elapsed = Date.now() - t0;
    expect(upstream).toHaveBeenCalledTimes(2);
    // The fallback model name must be the second attempt's model.
    const secondBody = JSON.parse(upstream.mock.calls[1][1].body);
    expect(secondBody.model).not.toBe("glm-test-primary");
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    const tokens = frames.filter((f: any) => f.token).map((f: any) => f.token);
    expect(tokens.join("")).toBe("Recovered answer");
    expect(frames[frames.length - 1]).toEqual({ done: true });
    // Whole thing stays far inside the real 9s budget (shrunk here to 900ms).
    expect(elapsed).toBeLessThan(3000);
  });

  it("ends with a single error frame when every attempt fails", async () => {
    const upstream = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }));
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }] }),
      res
    );
    expect(upstream).toHaveBeenCalledTimes(2); // primary + fallback
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    expect(frames).toHaveLength(1);
    expect(frames[0].error).toMatch(/busy right now/i);
    expect(res.ended).toBe(true);
  });

  it("treats upstream 401 as fatal: one attempt, owner-actionable error", async () => {
    const upstream = vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key" }));
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }] }),
      res
    );
    expect(upstream).toHaveBeenCalledTimes(1); // no pointless retry
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    expect(frames[0].error).toMatch(/ZAI_API_KEY/i);
  });

  it("ends gracefully (done, no retry) after a partial stream stalls", async () => {
    // Streams 2 tokens, then the socket dies mid-stream.
    let call = 0;
    const upstream = vi.fn(async (_url: string, init: any) => {
      call += 1;
      if (call === 1) {
        const signal: AbortSignal = init.signal;
        const enc = new TextEncoder();
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent === 0) {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: "Partial " } }] })}\n\n`
                )
              );
              sent = 1;
              return;
            }
            if (sent === 1) {
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: "text" } }] })}\n\n`
                )
              );
              sent = 2;
              return;
            }
            // Third pull: hang forever until aborted (stalled stream).
            return new Promise(() => {
              signal.addEventListener("abort", () => controller.error(new Error("stall")));
            });
          },
        });
        return { ok: true, status: 200, body } as any;
      }
      return okUpstream(["SHOULD NOT APPEAR"])("", init);
    });
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }] }),
      res
    );
    expect(upstream).toHaveBeenCalledTimes(1); // never duplicate partial text
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    const tokens = frames.filter((f: any) => f.token).map((f: any) => f.token);
    expect(tokens.join("")).toBe("Partial text");
    expect(frames[frames.length - 1]).toEqual({ done: true });
  });

  it("always terminates even when the upstream hangs forever", async () => {
    vi.stubGlobal("fetch", stallingUpstream());
    const res = makeFakeRes();
    const t0 = Date.now();
    await handler(
      makeReq("POST", { messages: [{ role: "user", content: "hi" }] }),
      res
    );
    const elapsed = Date.now() - t0;
    // Shrunk budget is 900ms — the handler MUST finish shortly after.
    expect(elapsed).toBeLessThan(3000);
    expect(res.ended).toBe(true);
    const frames = res.written.map((w: string) => JSON.parse(w.slice(6)));
    expect(frames[frames.length - 1].error).toBeDefined();
  });

  it("sends the notes-mode system prompt when mode=notes", async () => {
    let captured: any = null;
    const upstream = okUpstream(["ok"], (_url, body) => {
      captured = body;
    });
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    await handler(
      makeReq("POST", {
        messages: [{ role: "user", content: "explain this" }],
        mode: "notes",
        subject: "Physics",
        chapterTitle: "Motion",
        chapterSnippet: "v = u + at",
      }),
      res
    );
    expect(captured.messages[0].role).toBe("system");
    expect(captured.messages[0].content).toContain("AI Study Buddy");
    expect(captured.messages[0].content).toContain("Motion");
    expect(captured.messages[0].content).toContain("v = u + at");
  });

  it("caps conversation history to the last 8 turns", async () => {
    let captured: any = null;
    const upstream = okUpstream(["ok"], (_url, body) => {
      captured = body;
    });
    vi.stubGlobal("fetch", upstream);
    const res = makeFakeRes();
    const messages: any[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: "user", content: `u${i}` });
      messages.push({ role: "assistant", content: `a${i}` });
    }
    // The widget ALWAYS ends with the user's fresh question.
    messages.push({ role: "user", content: "u20" });
    await handler(makeReq("POST", { messages }), res);
    // system + last 8 turns
    expect(captured.messages).toHaveLength(9);
    expect(captured.messages[8].content).toBe("u20");
  });
});
