// api/safepay.js — ONE function, THREE kinds  (GHSS-Ghallanai-style gateway)
// ═══════════════════════════════════════════════════════════════════════════
//   • GET  /api/safepay?kind=config          → is online payment available?
//   • POST /api/create-payment               → create a Safepay checkout
//                                             (vercel.json rewrites this to
//                                             /api/safepay?kind=create)
//   • POST /api/safepay-webhook              → Safepay's payment webhook
//                                             (rewritten to ?kind=webhook)
//
// WHY ONE FUNCTION?  Vercel Hobby allows 12 serverless functions; this repo
// already had 10 — one consolidated `kind` dispatcher keeps the Safepay
// integration at exactly ONE extra file (11 total, 1 spare).
//
// NO SDK DEPENDENCY: this file talks to the exact same endpoints as the
// official @sfpy/node-sdk (payments.init + hosted checkout + HMAC webhook
// verification), implemented with plain fetch + node:crypto so the project
// needs ZERO new npm dependencies.
//   • payments.create  → POST {api}/order/v1/init {amount, client: apiKey,
//     currency, environment}          → data.data.token  (the "tracker")
//   • checkout url     → {checkout}/pay?beacon=<tracker>&order_id=…
//   • webhook verify   → HMAC-SHA512(webhookSecret, JSON.stringify(body.data))
//     compared against the x-sfpy-signature header — byte-for-byte the same
//     computation the SDK performs.
//
// SECURITY MODEL (mirrors the GHSS Ghallanai gateway):
//   • The browser NEVER sends an amount: the fee always comes from the
//     database via the admission_payment_context RPC (service role).
//   • Checkout is tied to the applicant's reference number + B-Form pair.
//   • The webhook must present the exact tracker we created (checked again
//     inside admission_safepay_apply), the amount and currency are
//     re-verified in the DB, and every event is deduplicated through the
//     admission_payment_events ledger (event_key = tracker:state).
//   • The checkout URL is allow-listed to https://*.getsafepay.com before
//     it is handed back to the browser.
//
// ENV (server-only — add to Vercel project settings):
//   SAFEPAY_ENV=sandbox|production
//   SAFEPAY_API_KEY=            (dashboard → Developers → API keys)
//   SAFEPAY_WEBHOOK_SECRET=     (dashboard → Developers → Webhooks)
//   SUPABASE_SERVICE_ROLE_KEY=  (already used by api/public-data.js)
//   SITE_URL=                   (optional; falls back to the request origin)
// Register the webhook URL in the Safepay dashboard:
//   https://<your-domain>/api/safepay-webhook
// ═══════════════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "node:crypto";

const SB_TIMEOUT_MS = 10000;
const SAFEPAY_TIMEOUT_MS = 20000;

// ── Safepay endpoints (identical to the official SDK constants) ───────────
function safepayCfg() {
  const env = (process.env.SAFEPAY_ENV || "sandbox").toLowerCase();
  const apiKey = process.env.SAFEPAY_API_KEY || "";
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET || "";
  const isProd = env === "production" || env === "prod" || env === "live";
  return {
    env: isProd ? "production" : "sandbox",
    apiKey,
    webhookSecret,
    api: isProd ? "https://api.getsafepay.com" : "https://sandbox.api.getsafepay.com",
    checkout: isProd ? "https://getsafepay.com/checkout" : "https://sandbox.api.getsafepay.com/checkout",
    ok: !!(apiKey && webhookSecret),
  };
}

function sbCfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, ok: !!(url && key) };
}

/** Supabase RPC with the service role + hard timeout. Returns parsed JSON. */
async function sbRpc(fn, body) {
  const { url, key } = sbCfg();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || text || res.status;
    throw new Error(`rpc ${fn} → ${res.status}: ${msg}`);
  }
  return data;
}

/** Insert a ledger row; returns true when it was NEW (false = duplicate). */
async function ledgerInsert(row) {
  const { url, key } = sbCfg();
  const res = await fetch(`${url}/rest/v1/admission_payment_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation, resolution=ignore-duplicates",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
  });
  const text = await res.text();
  const rows = text ? JSON.parse(text) : [];
  if (!res.ok && res.status !== 409) {
    throw new Error(`ledger insert → ${res.status}: ${text}`);
  }
  return Array.isArray(rows) && rows.length > 0;
}

// ── In-memory per-IP rate limit (per warm lambda) ──────────────────────────
const CREATE_HITS = new Map(); // ip → [timestamps]
function rateLimited(ip, max = 8, windowMs = 60_000) {
  const now = Date.now();
  const hits = (CREATE_HITS.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    CREATE_HITS.set(ip, hits);
    return true;
  }
  hits.push(now);
  CREATE_HITS.set(ip, hits);
  if (CREATE_HITS.size > 5000) CREATE_HITS.clear(); // cold-start safety
  return false;
}

const REF_RE = /^[A-Za-z0-9_-]{4,32}$/;
const BFORM_RE = /^[0-9-]{8,20}$/;

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const h = req.headers.host || "";
  if (h) return `https://${h}`;
  return "";
}

// ── kind=config ────────────────────────────────────────────────────────────
async function kindConfig(req, res) {
  const { ok } = safepayCfg();
  let enabled = false;
  if (ok && sbCfg().ok) {
    try {
      // Online payment is on only when the school ALSO switched it on in
      // Admission Settings. Read the single public column with the service
      // role (cheapest possible query).
      const { url, key } = sbCfg();
      const r = await fetch(
        `${url}/rest/v1/admission_settings?select=online_payment_enabled&id=eq.1&limit=1`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(SB_TIMEOUT_MS),
        },
      );
      const rows = r.ok ? JSON.parse(await r.text()) : [];
      enabled = rows?.[0]?.online_payment_enabled === true;
    } catch {
      enabled = false;
    }
  }
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res.status(200).json({ enabled });
}

// ── kind=create (POST /api/create-payment) ─────────────────────────────────
async function kindCreate(req, res) {
  const cfg = safepayCfg();
  if (!cfg.ok || !sbCfg().ok) {
    return res.status(503).json({
      ok: false,
      error: "Online payment is not available right now. Please use the manual method.",
    });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    res.setHeader("Retry-After", "60");
    return res
      .status(429)
      .json({ ok: false, error: "Too many payment attempts. Please wait a minute and try again." });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const referenceNo = String(body.reference_no || "").trim();
  const bFormNo = String(body.b_form_no || "").trim();
  if (!REF_RE.test(referenceNo) || !BFORM_RE.test(bFormNo)) {
    return res.status(400).json({ ok: false, error: "Invalid application details." });
  }

  // 1. Ownership + fee from the DATABASE (never from the browser).
  let ctx;
  try {
    ctx = await sbRpc("admission_payment_context", {
      p_reference_no: referenceNo,
      p_b_form_no: bFormNo,
    });
  } catch (e) {
    console.error("[safepay] payment_context failed:", e?.message);
    return res.status(502).json({ ok: false, error: "Could not reach the admission service. Please try again." });
  }
  if (!ctx?.ok) {
    const map = {
      not_found: [404, "No application found for this reference and B-Form number."],
      online_disabled: [403, "Online payment is currently switched off. Please pay by manual transfer."],
      already_paid: [409, "The processing fee for this application is already paid."],
      not_allowed: [409, "This application can no longer be paid for online. Please contact the school office."],
      deadline_passed: [409, "The fee deadline has passed. Please contact the school office."],
    };
    const [code, msg] = map[ctx?.error] || [403, "Online payment is not allowed for this application."];
    return res.status(code).json({ ok: false, error: msg });
  }

  const amount = Number(ctx.processing_fee || 0);
  if (!(amount > 0)) {
    return res.status(409).json({ ok: false, error: "No processing fee is charged for this application." });
  }

  // 2. Create the Safepay payment (tracker). Identical wire format to the
  //    official SDK: POST {api}/order/v1/init {amount, client, currency,
  //    environment} → data.data.token
  let tracker;
  try {
    const r = await fetch(`${cfg.api}/order/v1/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ amount, client: cfg.apiKey, currency: "PKR", environment: cfg.env }),
      signal: AbortSignal.timeout(SAFEPAY_TIMEOUT_MS),
    });
    const payload = await safeJsonOrText(r);
    if (!r.ok) throw new Error(`init → ${r.status}: ${payload?.text?.slice(0, 200)}`);
    tracker = payload?.json?.data?.token || payload?.json?.token;
    if (!tracker) throw new Error("no tracker in payment response");
  } catch (e) {
    console.error("[safepay] payments.create failed:", e?.message);
    return res.status(502).json({ ok: false, error: "Safepay is not responding. Please try again in a moment." });
  }

  // 3. Ledger: the webhook must later present EXACTLY this tracker.
  try {
    await ledgerInsert({
      provider: "safepay",
      kind: "checkout_created",
      tracking_id: ctx.tracking_id,
      tracker,
      state: "created",
      event_key: `${tracker}:created`,
      amount,
      currency: "PKR",
      outcome: "created",
    });
  } catch (e) {
    console.error("[safepay] ledger checkout_created failed:", e?.message);
    // Not fatal: admission_safepay_apply also validates the tracker, and a
    // missing checkout row only makes the webhook reject that tracker.
  }

  // 4. Hosted checkout URL (identical to the SDK's checkout.create).
  const site = siteUrl(req);
  const params = new URLSearchParams({
    beacon: tracker,
    cancel_url: `${site}/admission?payment=cancelled&ref=${encodeURIComponent(ctx.tracking_id)}`,
    env: cfg.env,
    order_id: ctx.tracking_id,
    redirect_url: `${site}/admission?payment=return&ref=${encodeURIComponent(ctx.tracking_id)}`,
    source: "custom",
    webhooks: "true",
  });
  const url = `${cfg.checkout}/pay?${params.toString()}`;

  // 5. Allow-list before handing the URL to the browser.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(502).json({ ok: false, error: "Invalid checkout URL." });
  }
  if (parsed.protocol !== "https:" || !/(^|\.)getsafepay\.com$/.test(parsed.hostname)) {
    console.error("[safepay] blocked non-safepay checkout host:", parsed.hostname);
    return res.status(502).json({ ok: false, error: "Invalid checkout URL." });
  }

  return res.status(200).json({ ok: true, url });
}

// ── kind=webhook (POST /api/safepay-webhook) ───────────────────────────────
async function kindWebhook(req, res) {
  const cfg = safepayCfg();
  if (!cfg.webhookSecret) {
    return res.status(503).json({ ok: false, error: "webhook not configured" });
  }

  const raw = typeof req.body === "string" ? req.body : null;
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "invalid payload" });
  }

  // 1. Signature: HMAC-SHA512 over JSON.stringify(body.data) — exactly what
  //    the official SDK computes. timingSafeEqual, no early exit.
  const signature = req.headers["x-sfpy-signature"] || "";
  const expected = createHmac("sha512", cfg.webhookSecret)
    .update(Buffer.from(JSON.stringify(body.data)))
    .digest("hex");
  const sigOk =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) {
    console.error("[safepay] webhook signature mismatch");
    return res.status(400).json({ ok: false, error: "invalid signature" });
  }

  // 2. Extract the fields (Safepay payload shapes have moved around a bit —
  //    accept the known variants).
  const d = body.data || {};
  const tracker = d.tracker || d.beacon || d.token || "";
  const orderId = d.metadata?.order_id || d.order_id || d.orderId || body.metadata?.order_id || "";
  const rawState = String(d.state || body.type || d.status || "").toUpperCase();
  const txnId =
    d.transaction?.id || d.txn?.id || d.txn_id || d.transaction_id || d.reference || null;
  const amount = num(d.amount) ?? num(d.transaction?.amount) ?? null;
  const currency = d.currency || d.transaction?.currency || null;
  const method = d.method || d.payment_method || d.transaction?.method || null;

  // 3. Map the state.
  let state;
  if (["PAID", "SUCCESS", "SUCCEEDED", "COMPLETED", "CAPTURED"].includes(rawState)) state = "paid";
  else if (["FAILED", "DECLINED", "CANCELLED", "CANCELED", "EXPIRED", "REJECTED"].includes(rawState)) state = "failed";
  else {
    // e.g. TRACKER_STARTED — nothing to do yet.
    return res.status(200).json({ ok: true, ignored: rawState || "unknown" });
  }

  if (!tracker || !orderId) {
    console.error("[safepay] webhook missing tracker/orderId:", { tracker, orderId });
    return res.status(200).json({ ok: true, ignored: true }); // nothing actionable
  }

  // 4. Idempotency: the same {tracker}:{state} must only ever act once.
  const eventKey = `${tracker}:${state}`;
  let isNew = true;
  try {
    isNew = await ledgerInsert({
      provider: "safepay",
      kind: "webhook",
      tracking_id: orderId,
      tracker,
      state,
      event_key: eventKey,
      amount,
      currency,
      outcome: "pending",
    });
  } catch (e) {
    console.error("[safepay] ledger insert failed (transient):", e?.message);
    return res.status(500).json({ ok: false, error: "ledger unavailable" }); // Safepay retries
  }
  if (!isNew) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 5. Apply inside the database (tracker / amount / currency re-verified).
  let outcome = state;
  try {
    const result = await sbRpc("admission_safepay_apply", {
      p_reference_no: orderId,
      p_tracker: tracker,
      p_state: state,
      p_txn_id: txnId,
      p_amount: amount,
      p_currency: currency,
      p_method: method,
    });
    if (!result?.ok) {
      outcome = `rejected:${result?.error || "unknown"}`;
      console.error("[safepay] apply rejected:", orderId, tracker, result?.error);
    }
  } catch (e) {
    // Transient DB error → 500 so Safepay retries the webhook.
    console.error("[safepay] apply failed (transient):", e?.message);
    return res.status(500).json({ ok: false, error: "apply failed" });
  }

  // 6. Final ledger outcome (ignore-duplicates keeps the event_key unique).
  try {
    await ledgerInsert({
      provider: "safepay",
      kind: "webhook",
      tracking_id: orderId,
      tracker,
      state,
      event_key: `${eventKey}:applied`,
      amount,
      currency,
      outcome,
    });
  } catch (e) {
    console.error("[safepay] ledger outcome failed:", e?.message);
  }

  // Always 200 on logical outcomes — an endless retry loop would only
  // duplicate ledger noise.
  return res.status(200).json({ ok: true, state });
}

// ── tiny helpers ────────────────────────────────────────────────────────────
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
async function safeJsonOrText(r) {
  const text = await r.text();
  return { json: safeJson(text), text };
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── dispatcher ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const url = new URL(req.url, "https://x.invalid");
  const kind =
    url.searchParams.get("kind") ||
    (url.pathname.includes("create-payment") ? "create" : undefined) ||
    (url.pathname.includes("webhook") ? "webhook" : url.searchParams.get("kind") || "config");

  try {
    if (kind === "config" && req.method === "GET") return await kindConfig(req, res);
    if (kind === "create" && req.method === "POST") return await kindCreate(req, res);
    if (kind === "webhook" && req.method === "POST") return await kindWebhook(req, res);
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    console.error("[safepay] unhandled:", e);
    return res.status(500).json({ ok: false, error: "internal" });
  }
}
