import fs from "node:fs";

// Load .env BEFORE importing the renderer — render.js captures
// process.env.VITE_SUPABASE_* at module-evaluation time.
try {
  const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
  const u = env.match(/VITE_SUPABASE_URL=(.*)/)?.[1]?.trim();
  const k = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim();
  if (u && !process.env.VITE_SUPABASE_URL) process.env.VITE_SUPABASE_URL = u;
  if (k && !process.env.VITE_SUPABASE_ANON_KEY) process.env.VITE_SUPABASE_ANON_KEY = k;
} catch { /* no .env — renderer falls back to static content */ }

const { default: handler } = await import("../api/render.js");

import { createServer } from "node:http";
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const vr = { method: req.method, query: Object.fromEntries(url.searchParams.entries()), headers: req.headers };
  const vres = {
    statusCode: 200,
    setHeader(k, v) { res.setHeader(k, v); return this; },
    status(c) { this.statusCode = c; return this; },
    send(body) {
      res.writeHead(this.statusCode, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return this;
    },
    json(o) {
      res.writeHead(this.statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(o));
      return this;
    },
    end: () => res.end(),
  };
  try {
    await handler(vr, vres);
  } catch (e) {
    res.writeHead(500);
    res.end("harness error: " + e.message);
  }
});

server.listen(8788, "127.0.0.1", () => console.log("render harness on http://127.0.0.1:8788/api/render?path=/…"));
