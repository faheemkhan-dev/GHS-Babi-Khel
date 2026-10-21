// api/_lib/push-core.js — shared Web Push logic (underscore folder ⇒ not a Vercel function).
import webpush from "web-push";

export const TOPICS = ["results", "merit", "rollslip", "admission", "notices", "news", "datesheet", "calendar"];
const SITE = "https://ghsbabikhel.dpdns.org";

function cfg() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  return { url, key, pub, priv, ok: !!(url && key && pub && priv) };
}
export const pushConfigured = () => cfg().ok;

// Every Supabase call gets a hard deadline: a stuck request used to hold the whole function open
// until Vercel killed it (60 s) — overlapping runs then piled up on the Nano database.
const SB_TIMEOUT_MS = 15000;

async function sb(path, { method = "GET", body, headers = {} } = {}) {
  const { url, key } = cfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
export { sb };

let vapidSet = false;
function initVapid() {
  if (vapidSet) return;
  const { pub, priv } = cfg();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE, pub, priv);
  vapidSet = true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send one payload to one subscription. Retries transient failures (429/5xx/network). */
async function sendOne(s, body) {
  const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
  const opts = { TTL: 60 * 60 * 24, urgency: "high", timeout: 8000 };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await webpush.sendNotification(sub, body, opts);
      return { ok: true };
    } catch (e) {
      lastErr = e;
      const code = e && e.statusCode;
      if (code === 404 || code === 410) return { ok: false, dead: true, code };
      // 400/401/403 are permanent for this subscription/key — retrying cannot help.
      if (code && code < 500 && code !== 429 && code !== 408) return { ok: false, code };
      const ra = Number(e && e.headers && e.headers["retry-after"]);
      await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 400 * 2 ** attempt, 3000));
    }
  }
  return { ok: false, code: (lastErr && lastErr.statusCode) || "network" };
}

/** Send one payload to a list of subscription rows; prune dead endpoints. */
async function deliver(subs, payload) {
  initVapid();
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const dead = [];
  const errors = {};
  const queue = subs.slice();
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift();
      const r = await sendOne(s, body);
      if (r.ok) sent++;
      else {
        failed++;
        if (r.dead) dead.push(s.endpoint);
        else errors[r.code] = (errors[r.code] || 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  // Delete dead endpoints in small chunks (URL length safe).
  for (let i = 0; i < dead.length; i += 40) {
    const list = dead.slice(i, i + 40).map((d) => `"${d.replace(/"/g, "")}"`).join(",");
    await sb(`push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`, { method: "DELETE" }).catch(() => {});
  }
  return { total: subs.length, sent, failed, pruned: dead.length, ...(Object.keys(errors).length ? { errors } : {}) };
}

export async function sendToTopic(topic, payload) {
  const subs = await fetchAll(
    `push_subscriptions?select=endpoint,p256dh,auth&topics=cs.${encodeURIComponent(`{${topic}}`)}&order=endpoint.asc`,
    1000, 100,
  );
  return deliver(subs, { icon: "/icon-192.png", badge: "/icon-192.png", url: "/", ...payload });
}

const clip = (a, n = 800) => a.slice(0, n);
async function fetchAll(path, pageSize = 1000, maxPages = 6) {
  const out = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let p = 0; p < maxPages; p++) {
    const rows = await sb(`${path}${sep}limit=${pageSize}&offset=${p * pageSize}`);
    out.push(...(rows || []));
    if (!rows || rows.length < pageSize) break;
  }
  return out;
}

const STATUS_TEXT = {
  pending: "Your application is pending review.",
  under_review: "Your application is now under review.",
  approved: "Congratulations! Your application has been approved.",
  rejected: "There is an update on your application. Please check the status.",
  documents_missing: "Documents are missing from your application. Please check.",
  documents_verified: "Your documents have been verified.",
  interview_scheduled: "An interview has been scheduled for you.",
  interview_completed: "Your interview is marked complete.",
  waitlisted: "You have been placed on the waiting list.",
  admitted: "Congratulations! You have been admitted.",
  admit_card_issued: "Your admit card has been issued.",
};

/**
 * Compare live data with the last-notified snapshot (push_state.seen) and push
 * anything new. First sight of a source only SEEDS the snapshot (no blast).
 * Idempotent: running it twice never double-notifies.
 */
const nowIso = () => new Date().toISOString();

/**
 * Atomic lease: only ONE dispatch runs at a time (two parallel runs used to read the same
 * snapshot and either double-send or overwrite each other's progress). The conditional PATCH
 * is a single SQL UPDATE, so exactly one caller wins.
 */
async function acquireLease(leaseMs) {
  await sb("push_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: { key: "lock", value: {}, updated_at: "1970-01-01T00:00:00Z" } }).catch(() => {});
  const cutoff = new Date(Date.now() - leaseMs).toISOString();
  const got = await sb(`push_state?key=eq.lock&updated_at=lt.${encodeURIComponent(cutoff)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { value: { at: nowIso() }, updated_at: nowIso() } });
  return Array.isArray(got) && got.length > 0;
}
const releaseLease = () =>
  sb("push_state?key=eq.lock", { method: "PATCH", body: { updated_at: "1970-01-01T00:00:00Z" } }).catch(() => {});
const markDirty = () =>
  sb("push_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { key: "dirty", value: { at: nowIso() }, updated_at: nowIso() } }).catch(() => {});

/**
 * One tiny RPC (migration 12: public.push_signature) returns a hash of everything the dispatcher
 * watches, the hash stored after the last COMPLETE run, and whether a retry is pending.
 * Returns null when the RPC is missing / fails → callers fall back to the full run (old behaviour).
 */
async function readSignature() {
  try {
    const r = await sb("rpc/push_signature", { method: "POST", body: {} });
    const v = Array.isArray(r) ? r[0] : r;
    return v && typeof v.cur === "string" ? v : null;
  } catch { return null; }
}

/**
 * trusted = cron / database trigger / auto-publisher (no throttle, never loses a signal).
 * Untrusted visitor/admin pings are throttled by minGapMs.
 */
export async function dispatchChanges({ minGapMs = 10000, trusted = minGapMs === 0 } = {}) {
  if (!cfg().ok) return { skipped: "not-configured" };
  // EARLY EXIT: nothing published/changed since the last complete run and no retry pending →
  // return now. No lease, no six table reads, no push_state writes (this is what used to burn
  // the Disk IO budget every minute).
  const sig = await readSignature();
  if (sig && sig.cur === sig.prev && sig.retry === false) return { ok: true, skipped: "unchanged" };
  const lease = trusted ? 60000 : Math.max(minGapMs, 10000);
  if (!(await acquireLease(lease))) {
    // Someone else is mid-run. A trusted signal means "new data exists": leave a marker so the
    // running dispatch loops once more instead of the change waiting for the next tick.
    if (trusted) await markDirty();
    return { skipped: "busy" };
  }
  const reports = [];
  try {
    for (let i = 0; i < 3; i++) {
      const startedAt = nowIso();
      reports.push(await runDispatch(i === 0 ? sig : await readSignature()));
      if (!trusted) break;
      const d = (await sb("push_state?select=updated_at&key=eq.dirty").catch(() => []))?.[0];
      if (!d || d.updated_at < startedAt) break;
    }
  } finally {
    if (trusted) await releaseLease();
  }
  return { ok: true, report: reports.length === 1 ? reports[0] : reports };
}

async function runDispatch(sig = null) {
  const stRow = (await sb("push_state?select=value&key=eq.seen"))?.[0];
  const seen = stRow?.value || {};
  const next = { ...seen };
  const report = {};
  // Returns true when the announcement can be considered handled. If NOBODY received it because
  // of transient errors, return false so the snapshot is NOT advanced and the next run retries
  // (max 5 tries). Partial success counts as handled so nobody gets duplicates.
  const tries = { ...(seen._tries || {}) };
  next._tries = tries;
  let retry = false; // true while any announcement still needs another attempt
  const notify = async (topic, payload, key) => {
    const r = (report[key] = await sendToTopic(topic, payload));
    const handled = r.total === 0 || r.sent > 0 || r.failed === r.pruned;
    if (handled) { delete tries[key]; return true; }
    tries[key] = (tries[key] || 0) + 1;
    if (tries[key] >= 5) { delete tries[key]; return true; }
    retry = true;
    return false;
  };

  // Generic "id list" sources ---------------------------------------------
  const listSources = [
    { key: "notices", topic: "notices", q: "notices?select=id,title&is_published=eq.true&order=created_at.desc&limit=200",
      one: (r) => ({ title: "📢 New Notice", body: r.title, url: `/notices/${r.id}`, tag: `notice-${r.id}` }),
      many: (n) => ({ title: "📢 New Notices", body: `${n} new notices were published.`, url: "/notices", tag: "notices" }) },
    { key: "merit", topic: "merit", q: "merit_lists?select=id,class,exam_type,year&is_published=eq.true&limit=500",
      one: (r) => ({ title: "🏆 Merit List Published", body: [r.class && `Class ${r.class}`, r.exam_type, r.year].filter(Boolean).join(" · ") + " merit list is now available.", url: "/merit-list", tag: `merit-${r.id}` }),
      many: () => ({ title: "🏆 Merit Lists Published", body: "New merit lists are now available.", url: "/merit-list", tag: "merit" }) },
    { key: "rollslip", topic: "rollslip", q: "exam_roll_sessions?select=id,title&is_published=eq.true&order=created_at.desc&limit=200",
      one: (r) => ({ title: "🎫 Roll Number Slips Ready", body: `${r.title || "Exam"} — download your roll number slip now.`, url: "/roll-no-slip", tag: `slip-${r.id}` }),
      many: () => ({ title: "🎫 Roll Number Slips Ready", body: "New roll number slips are available.", url: "/roll-no-slip", tag: "slip" }) },
  ];
  for (const s of listSources) {
    try {
      const rows = (await sb(s.q)) || [];
      const ids = rows.map((r) => String(r.id));
      if (!Array.isArray(seen[s.key])) { next[s.key] = clip(ids); continue; }
      const fresh = rows.filter((r) => !seen[s.key].includes(String(r.id)));
      if (fresh.length) {
        if (await notify(s.topic, fresh.length === 1 ? s.one(fresh[0]) : s.many(fresh.length), s.key)) {
          next[s.key] = clip([...ids, ...seen[s.key]].filter((v, i, a) => a.indexOf(v) === i));
        }
      }
    } catch (e) { report[s.key] = { error: String(e).slice(0, 120) }; }
  }

  // Results — one push per newly published class/exam/year ------------------
  try {
    const rows = await fetchAll("results?select=class,exam_type,year&is_published=eq.true&order=created_at.desc");
    const map = new Map();
    for (const r of rows) map.set(`${r.class}|${r.exam_type}|${r.year}`, r);
    const keys = [...map.keys()];
    if (!Array.isArray(seen.results)) next.results = clip(keys, 600);
    else {
      const fresh = keys.filter((k) => !seen.results.includes(k));
      if (fresh.length) {
        const r0 = map.get(fresh[0]);
        if (await notify("results", fresh.length === 1
          ? { title: "🎓 Results Declared!", body: `Class ${r0.class} · ${r0.exam_type} ${r0.year} results are now live. Tap to check yours.`, url: "/results", tag: "results" }
          : { title: "🎓 Results Declared!", body: `Results for ${fresh.length} classes are now live. Tap to check yours.`, url: "/results", tag: "results" }, "results")) {
          next.results = clip([...keys, ...seen.results].filter((v, i, a) => a.indexOf(v) === i), 600);
        }
      }
    }
  } catch (e) { report.results = { error: String(e).slice(0, 120) }; }

  // Date sheet --------------------------------------------------------------
  try {
    const rows = await fetchAll("exam_schedule?select=id", 1000, 3);
    const ids = rows.map((r) => String(r.id));
    if (!Array.isArray(seen.datesheet)) next.datesheet = clip(ids, 1500);
    else {
      const fresh = ids.filter((i) => !seen.datesheet.includes(i));
      if (fresh.length) {
        if (await notify("datesheet", { title: "📅 Exam Date Sheet Updated", body: "The exam schedule has been updated. Tap to view.", url: "/", tag: "datesheet" }, "datesheet")) {
          next.datesheet = clip([...ids, ...seen.datesheet].filter((v, i, a) => a.indexOf(v) === i), 1500);
        }
      }
    }
  } catch (e) { report.datesheet = { error: String(e).slice(0, 120) }; }

  // Admission — applicant-specific status changes ---------------------------
  try {
    const subs = (await sb("push_subscriptions?select=endpoint,p256dh,auth,admission_ref&admission_ref=not.is.null&limit=5000")) || [];
    const refs = [...new Set(subs.map((s) => s.admission_ref))];
    const prev = seen.admission && typeof seen.admission === "object" ? seen.admission : null;
    const cur = { ...(prev || {}) };
    if (refs.length) {
      const list = refs.map((r) => `"${String(r).replace(/"/g, "")}"`).join(",");
      const rows = (await sb(`admissions?select=reference_no,status&reference_no=in.(${encodeURIComponent(list)})`)) || [];
      for (const r of rows) {
        const before = cur[r.reference_no];
        if (before !== r.status) {
          if (before === undefined) { cur[r.reference_no] = r.status; continue; }
          {
            const mine = subs.filter((s) => s.admission_ref === r.reference_no);
            const out = (report[`admission:${r.reference_no}`] = await deliver(mine, {
              title: "🎒 Admission Update", body: STATUS_TEXT[r.status] || `Your application status is now: ${String(r.status).replace(/_/g, " ")}.`,
              icon: "/icon-192.png", badge: "/icon-192.png", url: "/admission", tag: `adm-${r.reference_no}`,
            }));
            // Advance only if someone got it (or nobody can) — otherwise retry next run.
            if (out.total === 0 || out.sent > 0 || out.failed === out.pruned) cur[r.reference_no] = r.status;
            else retry = true;
          }
        }
      }
    }
    next.admission = cur;
  } catch (e) { report.admission = { error: String(e).slice(0, 120) }; }

  // Remember the signature ONLY after a clean, complete run — a source error or a pending retry
  // must never be hidden by the early exit. (The signature was read BEFORE this run, so a change
  // that lands mid-run simply triggers one more idempotent run next time.)
  const failed = Object.values(report).some((v) => v && v.error);
  if (sig && !retry && !failed) next._sig = sig.cur; else delete next._sig;
  await sb("push_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { key: "seen", value: next, updated_at: new Date().toISOString() } });
  return report;
}

export async function sendToEndpoint(endpoint, payload) {
  const subs = await sb(`push_subscriptions?select=endpoint,p256dh,auth&endpoint=eq.${encodeURIComponent(endpoint)}&limit=1`);
  return deliver(subs || [], { icon: "/icon-192.png", badge: "/icon-192.png", url: "/", ...payload });
}

/** Seed the admission snapshot so the very first status change is never missed. */
export async function seedAdmissionRef(ref) {
  const rows = await sb(`admissions?select=reference_no,status&reference_no=eq.${encodeURIComponent(ref)}&limit=1`);
  if (!rows?.[0]) return;
  const st = (await sb("push_state?select=value&key=eq.seen"))?.[0]?.value || {};
  const adm = st.admission && typeof st.admission === "object" ? st.admission : {};
  if (adm[ref] === undefined) adm[ref] = rows[0].status;
  await sb("push_state?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { key: "seen", value: { ...st, admission: adm }, updated_at: new Date().toISOString() } });
                                          }
                                                             
