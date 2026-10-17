// src/lib/push.ts — client-side Web Push helpers (subscribe / topics / status).
// Server contract: /api/push (see api/push.js). The VAPID public key is served
// by the server, so no VITE_ env var is needed.

export type PushTopic = "results" | "merit" | "rollslip" | "admission" | "notices" | "news" | "datesheet" | "calendar";

export const ALL_TOPICS: PushTopic[] = ["results", "merit", "rollslip", "admission", "notices", "news", "datesheet", "calendar"];

export const TOPIC_LABELS: Record<PushTopic, string> = {
  results: "Results",
  merit: "Merit lists",
  rollslip: "Roll number slips",
  admission: "Admission",
  notices: "Notices",
  news: "News",
  datesheet: "Date sheet",
  calendar: "Calendar",
};

export type PushStatus = "unsupported" | "ios-install" | "denied" | "off" | "on";

const TOPICS_KEY = "ghs_push_topics";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
}
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function isPushConfigured(): Promise<boolean> {
  return (await getConfig()).configured;
}

let configCache: Promise<{ configured: boolean; publicKey: string | null }> | null = null;
function getConfig() {
  if (!configCache) {
    configCache = fetch("/api/push?action=config")
      .then((r) => (r.ok ? r.json() : { configured: false, publicKey: null }))
      .catch(() => ({ configured: false, publicKey: null }));
  }
  return configCache;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }));
  } catch {
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export function getSavedTopics(): PushTopic[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TOPICS_KEY) || "null");
    if (Array.isArray(raw)) return raw.filter((t: any) => ALL_TOPICS.includes(t));
  } catch { /* ignore */ }
  return [...ALL_TOPICS];
}
function saveTopics(t: PushTopic[]) {
  try { localStorage.setItem(TOPICS_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

async function post(action: string, body: unknown) {
  const r = await fetch(`/api/push?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Push request failed (${r.status})`);
  return r.json();
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return (await currentSubscription()) ? "on" : "off";
  return "off";
}

/** Must be called from a user gesture (tap). Returns the resulting status. */
export async function enablePush(opts: { topics?: PushTopic[]; admissionRef?: string } = {}): Promise<PushStatus> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  const cfg = await getConfig();
  if (!cfg.configured || !cfg.publicKey) throw new Error("Notifications aren't available right now. Please try again later.");

  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";

  const reg = await getRegistration();
  if (!reg) throw new Error("Couldn't start the notification service on this browser.");
  await navigator.serviceWorker.ready;

  const sub = await getFreshSubscription(reg, cfg.publicKey);

  const topics = opts.topics ?? getSavedTopics();
  saveTopics(topics);
  await post("subscribe", { subscription: sub.toJSON(), topics, ...(opts.admissionRef ? { admissionRef: opts.admissionRef } : {}) });
  try { localStorage.setItem("ghs_push_enabled", "1"); } catch { /* ignore */ }
  return "on";
}

/** True when an existing subscription was created with a DIFFERENT VAPID public key. */
function keyMismatch(sub: PushSubscription, publicKey: string): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return false;
  const have = new Uint8Array(k as ArrayBuffer);
  const want = urlB64ToUint8Array(publicKey);
  return have.length !== want.length || have.some((v, i) => v !== want[i]);
}

/**
 * Returns a subscription that is valid for the CURRENT server VAPID key. A subscription made
 * under an older/different key is silently rejected by the push service (403) — that is the
 * classic "notifications work sometimes / never for some people" bug — so it is replaced.
 */
async function getFreshSubscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub && keyMismatch(sub, publicKey)) {
    const old = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await post("unsubscribe", { endpoint: old }).catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) as BufferSource });
  return sub;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await post("unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  try { localStorage.removeItem("ghs_push_enabled"); } catch { /* ignore */ }
}

export async function updateTopics(topics: PushTopic[]): Promise<void> {
  const sub = await currentSubscription();
  saveTopics(topics);
  if (sub) await post("topics", { endpoint: sub.endpoint, topics });
}

export async function sendTestPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await post("test", { endpoint: sub.endpoint });
}

/** Ask the server to push anything newly published (idempotent, throttled server-side). */
export function pingDispatch(src: "admin" | "visitor") {
  try {
    fetch(`/api/push?action=dispatch&src=${src}`, { method: "POST", keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

/**
 * Keep the server-side subscription healthy. Runs on every visit (cheap): re-validates the
 * key, and re-registers with the server at most every 6 h so a deleted/expired row heals itself.
 */
export async function refreshSubscriptionIfNeeded() {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const cfg = await getConfig();
    if (!cfg.configured || !cfg.publicKey) return;
    const reg = await getRegistration();
    if (!reg) return;
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const stale = !!existing && keyMismatch(existing, cfg.publicKey);
    const gap = 6 * 60 * 60 * 1000;
    const last = Number(localStorage.getItem("ghs_push_refreshed") || 0);
    if (!stale && existing && Date.now() - last < gap) return;
    // Only auto-(re)subscribe people who already opted in on this device.
    if (!existing && localStorage.getItem("ghs_push_enabled") !== "1") return;
    const sub = await getFreshSubscription(reg, cfg.publicKey);
    await post("subscribe", { subscription: sub.toJSON(), topics: getSavedTopics() });
    localStorage.setItem("ghs_push_refreshed", String(Date.now()));
  } catch { /* ignore */ }
}
