// api/push.js — the ONLY push endpoint (one Vercel function; Hobby plan allows 12).
//   GET  ?action=config                      → { configured, publicKey }
//   POST ?action=subscribe  {subscription, topics?, admissionRef?}
//   POST ?action=topics     {endpoint, topics}
//   POST ?action=unsubscribe{endpoint}
//   POST ?action=test       {endpoint}       → sends a test notification
//   GET|POST ?action=dispatch[&src=visitor]  → pushes anything newly published
//        (Supabase pg_cron + DB triggers call this with `Authorization: Bearer $CRON_SECRET` — see migration 09)
import { TOPICS, pushConfigured, sb, dispatchChanges, sendToEndpoint, seedAdmissionRef } from "./_lib/push-core.js";

export const maxDuration = 60; // enough time to fan out to every subscriber + retries

const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
const cleanTopics = (t) => (Array.isArray(t) ? [...new Set(t.filter((x) => TOPICS.includes(x)))] : null);
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/]{2,39}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = String((req.query && req.query.action) || "");
  const configured = pushConfigured();

  try {
    if (action === "config") {
      return res.status(200).json({ configured, publicKey: configured ? (process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY) : null, topics: TOPICS });
    }
    if (!configured) return bad(res, 503, "Push is not configured on the server yet.");

    if (action === "dispatch") {
      const visitor = String(req.query.src || "") === "visitor";
      // Trusted callers: Supabase pg_cron / DB triggers, Vercel cron (Authorization: Bearer <CRON_SECRET>).
      const secret = process.env.CRON_SECRET;
      const sent = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || String(req.headers["x-cron-secret"] || "");
      const trusted = !!secret && sent === secret;
      const out = await dispatchChanges({ minGapMs: trusted ? 0 : visitor ? 60000 : 10000, trusted });
      return res.status(200).json(out);
    }

    if (req.method !== "POST") return bad(res, 405, "POST required");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    if (action === "subscribe") {
      const sub = b.subscription;
      const endpoint = sub && sub.endpoint;
      const p256dh = sub && sub.keys && sub.keys.p256dh;
      const auth = sub && sub.keys && sub.keys.auth;
      if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return bad(res, 400, "Invalid subscription");
      const row = {
        endpoint, p256dh: String(p256dh).slice(0, 200), auth: String(auth).slice(0, 100),
        user_agent: String(req.headers["user-agent"] || "").slice(0, 200), last_seen: new Date().toISOString(),
      };
      const topics = cleanTopics(b.topics);
      if (topics) row.topics = topics;
      if (b.admissionRef !== undefined) {
        if (!REF_RE.test(String(b.admissionRef))) return bad(res, 400, "Invalid reference");
        row.admission_ref = String(b.admissionRef);
      }
      await sb("push_subscriptions?on_conflict=endpoint", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: row });
      if (row.admission_ref) await seedAdmissionRef(row.admission_ref).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
    if (!endpoint) return bad(res, 400, "endpoint required");

    if (action === "topics") {
      const topics = cleanTopics(b.topics);
      if (!topics) return bad(res, 400, "topics required");
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "PATCH", body: { topics, last_seen: new Date().toISOString() } });
      return res.status(200).json({ ok: true });
    }
    if (action === "unsubscribe") {
      await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }
    if (action === "test") {
      const out = await sendToEndpoint(endpoint, { title: "🔔 Notifications are on", body: "You'll now get instant updates from GHS Babi Khel.", url: "/", tag: "welcome" });
      return res.status(200).json({ ok: true, ...out });
    }
    return bad(res, 400, "Unknown action");
  } catch (e) {
    return bad(res, 500, String(e).slice(0, 200));
  }
}
