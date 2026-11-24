// api/turnstile.js — server-side Cloudflare Turnstile verification.
//
//   POST /api/turnstile   { token, action }   →  { ok: true } | { ok: false, error }
//
// The SECRET key stays here (Vercel env TURNSTILE_SECRET_KEY — never VITE_).
// Tokens are single-use and expire after ~5 minutes; Cloudflare enforces both.
// Checks: success flag, hostname belongs to this site, and the action label
// matches the one the widget was rendered with (stops a token minted on one
// form being replayed on another).
//
// If no secret is configured the endpoint reports {ok:true, skipped:true} so a
// missing env var can never take admissions offline. If the secret IS set,
// verification is fail-closed.

const SECRET =
  process.env.TURNSTILE_SECRET_KEY ||
  process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY ||
  process.env.TURNSTILE_SECRET ||
  "";

const ALLOWED_ACTIONS = new Set(["admission", "signin"]);
const SITE_HOSTS = ["ghsbabikhel.dpdns.org", "www.ghsbabikhel.dpdns.org", "localhost"];

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.headers["x-real-ip"] || "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  if (!SECRET) return res.status(200).json({ ok: true, skipped: true });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const token = typeof body?.token === "string" ? body.token : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!token || token.length > 2048) {
    return res.status(400).json({ ok: false, error: "Please complete the security check." });
  }
  if (action && !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: "Unknown action." });
  }

  try {
    const form = new URLSearchParams();
    form.set("secret", SECRET);
    form.set("response", token);
    const ip = clientIp(req);
    if (ip) form.set("remoteip", String(ip));

    const cf = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await cf.json().catch(() => null);
    if (!data || data.success !== true) {
      const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"] : [];
      const expired = codes.includes("timeout-or-duplicate");
      return res.status(403).json({
        ok: false,
        error: expired
          ? "The security check expired. Please complete it again."
          : "Security check failed. Please try again.",
      });
    }

    const host = String(req.headers.host || "").split(":")[0];
    const okHost = !data.hostname || SITE_HOSTS.includes(data.hostname) || data.hostname === host || /\.vercel\.app$/.test(data.hostname);
    if (!okHost) return res.status(403).json({ ok: false, error: "Security check failed. Please try again." });
    if (action && data.action && data.action !== action) {
      return res.status(403).json({ ok: false, error: "Security check failed. Please try again." });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false, error: "Security service is unreachable. Please try again in a moment." });
  }
}
