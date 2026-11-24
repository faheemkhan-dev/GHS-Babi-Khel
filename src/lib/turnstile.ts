// src/lib/turnstile.ts — Cloudflare Turnstile helpers (bot protection).
//
// The SITE key is public (baked into the build via VITE_*); the SECRET key
// never reaches the browser — it lives only in api/turnstile.js and, for the
// Sign-in page, in Supabase's own CAPTCHA protection settings.
//
// If no site key is configured the whole feature switches itself off cleanly
// (widgets render nothing, nothing is required), so a missing env var can never
// lock visitors out.

const env = import.meta.env as Record<string, string | undefined>;

export const TURNSTILE_SITE_KEY = (
  env.VITE_TURNSTILE_SITE_KEY ||
  env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY ||
  env.VITE_TURNSTILE_KEY ||
  ""
).trim();

export const turnstileEnabled = TURNSTILE_SITE_KEY.length > 0;

export interface TurnstileVerifyResult {
  ok: boolean;
  error?: string;
}

/**
 * Server-side verification (api/turnstile.js asks Cloudflare, using the secret
 * key). Used before the admission application is saved. Tokens are single-use,
 * so the caller must reset the widget afterwards.
 */
export async function verifyTurnstile(token: string, action: string): Promise<TurnstileVerifyResult> {
  try {
    const res = await fetch("/api/turnstile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action }),
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { ok: true };
    return { ok: false, error: data?.error || "Security check failed. Please try again." };
  } catch {
    return { ok: false, error: "Could not reach the security check. Check your internet and try again." };
  }
}
