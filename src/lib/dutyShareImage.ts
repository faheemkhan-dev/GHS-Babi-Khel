// src/lib/dutyShareImage.ts — builds a premium 1080×1350 share card (PNG) for a duty
// and shares it through the phone's native share sheet (WhatsApp etc.).
// Privacy: CNIC, mobile number and ref no are intentionally NOT drawn on the card.
import { type DrawDetails } from "@/hooks/useDrawLookup";

export const SITE_URL = "https://ghsbabikhel.dpdns.org/duties";
const SITE_LABEL = "ghsbabikhel.dpdns.org/duties";

const SERIF = `"Playfair Display", "Playfair Fallback", Georgia, "Times New Roman", serif`;
const SANS = `"Inter", "Inter Fallback", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
const GREEN_D = "#0e3d2c";
const GREEN = "#14583e";
const GOLD = "#c49628";
const GOLD_L = "#f2d27a";
const INK = "#16241d";

export interface ShareInput {
  details: DrawDetails;
  session?: string;
  dutyLabel?: string;
  facts?: { centerName?: string; reportDate?: string; reportTime?: string; commencing?: string };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y);
  ctx.closePath(); ctx.fill();
}

export async function buildDutyShareBlob(inp: ShareInput): Promise<Blob> {
  try {
    await Promise.all([
      document.fonts.load(`700 40px "Playfair Display"`),
      document.fonts.load(`600 28px "Inter"`),
      document.fonts.load(`800 28px "Inter"`),
    ]);
  } catch { /* fall back to system fonts */ }

  const W = 1080;
  const { details: d, facts: f = {}, session, dutyLabel } = inp;

  const rows: [string, string][] = ([
    ["Designation", d.designation],
    ["Institute", d.institute],
    ["Center No", d.centerNo],
    ["Center Name", f.centerName],
    ["Report Date", f.reportDate],
    ["Report Time", f.reportTime],
    ["Exam Starts", f.commencing],
  ] as [string, string | undefined][]).filter(([, v]) => !!v) as [string, string][];

  // measure first so the card height fits the content
  const probe = document.createElement("canvas").getContext("2d")!;
  const tblX = 70, tblW = W - 140, colL = 300, padV = 22, lineH = 40;
  probe.font = `700 31px ${SANS}`;
  const measured = rows.map(([l, v]) => {
    const ls = wrap(probe, v, tblW - colL - 40);
    return { l, ls, h: Math.max(78, ls.length * lineH + padV * 2) };
  });
  const tableH = measured.reduce((a, r) => a + r.h, 0);
  const headH = 400;
  const H = Math.max(1350, headH + 70 + tableH + 330);

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.textBaseline = "alphabetic";

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#fffef9"); bg.addColorStop(0.6, "#f6f3e2"); bg.addColorStop(1, "#e9f1e2");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // header band
  const hg = ctx.createLinearGradient(0, 0, W, headH);
  hg.addColorStop(0, GREEN_D); hg.addColorStop(1, GREEN);
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, headH);
  ctx.strokeStyle = "rgba(242,210,122,.14)"; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(W - 40, -20, 200 + i * 60, 0, Math.PI * 2); ctx.stroke(); }
  const gl = ctx.createLinearGradient(0, 0, W, 0);
  gl.addColorStop(0, GOLD); gl.addColorStop(0.5, GOLD_L); gl.addColorStop(1, GOLD);
  ctx.fillStyle = gl; ctx.fillRect(0, headH, W, 8);

  ctx.textAlign = "center";
  const logo = await loadImg("/icon-192.png");
  let y = 70;
  if (logo) {
    ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 120, 52, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.clip();
    ctx.drawImage(logo, W / 2 - 52, 68, 104, 104); ctx.restore();
    ctx.strokeStyle = GOLD_L; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(W / 2, 120, 54, 0, Math.PI * 2); ctx.stroke();
    y = 215;
  } else y = 120;

  ctx.fillStyle = GOLD_L; ctx.font = `700 24px ${SANS}`;
  (ctx as any).letterSpacing = "6px";
  ctx.fillText("GHS BABI KHEL", W / 2, y);
  (ctx as any).letterSpacing = "0px";
  ctx.fillStyle = "#fff"; ctx.font = `700 64px ${SERIF}`;
  ctx.fillText("Exam Duty Order", W / 2, y + 78);
  ctx.fillStyle = "rgba(255,255,255,.78)"; ctx.font = `500 25px ${SANS}`;
  ctx.fillText([session, dutyLabel].filter(Boolean).join("  •  ") || "Supervisory Draw", W / 2, y + 126);

  // name card
  const cy = headH + 70;
  ctx.fillStyle = GOLD; diamond(ctx, W / 2, cy - 8, 8);
  ctx.fillStyle = GREEN; ctx.font = `800 21px ${SANS}`;
  (ctx as any).letterSpacing = "5px";
  ctx.fillText("YOU ARE SELECTED FOR DUTY", W / 2, cy + 38);
  (ctx as any).letterSpacing = "0px";
  ctx.fillStyle = INK; ctx.font = `700 52px ${SERIF}`;
  const nm = d.name || "";
  while (ctx.measureText(nm).width > W - 140 && ctx.font.includes("px")) {
    const sz = parseInt(/(\d+)px/.exec(ctx.font)![1], 10) - 2;
    if (sz < 30) break;
    ctx.font = `700 ${sz}px ${SERIF}`;
  }
  ctx.fillText(nm, W / 2, cy + 105);
  if (d.appointedAs) {
    ctx.font = `800 24px ${SANS}`;
    (ctx as any).letterSpacing = "3px";
    const t = d.appointedAs.toUpperCase();
    const tw = Math.min(ctx.measureText(t).width + 64, W - 120);
    rr(ctx, W / 2 - tw / 2, cy + 130, tw, 56, 28);
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = "#8a5d0c"; ctx.fillText(t, W / 2, cy + 167, W - 160);
    (ctx as any).letterSpacing = "0px";
  }

  // table
  const ty = cy + 225;
  rr(ctx, tblX, ty, tblW, tableH, 26);
  ctx.save(); ctx.shadowColor = "rgba(20,88,62,.18)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
  ctx.strokeStyle = "rgba(196,150,40,.55)"; ctx.lineWidth = 2.5; rr(ctx, tblX, ty, tblW, tableH, 26); ctx.stroke();
  ctx.save(); rr(ctx, tblX, ty, tblW, tableH, 26); ctx.clip();
  ctx.fillStyle = "#f3f7ef"; ctx.fillRect(tblX, ty, colL, tableH);
  let ry = ty;
  measured.forEach((r, i) => {
    if (i > 0) { ctx.fillStyle = "rgba(196,150,40,.28)"; ctx.fillRect(tblX, ry, tblW, 2); }
    ctx.textAlign = "center";
    ctx.fillStyle = GREEN; ctx.font = `800 22px ${SANS}`;
    (ctx as any).letterSpacing = "3px";
    ctx.fillText(r.l.toUpperCase(), tblX + colL / 2, ry + r.h / 2 + 8);
    (ctx as any).letterSpacing = "0px";
    ctx.fillStyle = INK; ctx.font = `700 31px ${SANS}`;
    const vx = tblX + colL + (tblW - colL) / 2;
    const top = ry + r.h / 2 - ((r.ls.length - 1) * lineH) / 2 + 11;
    r.ls.forEach((ln, k) => ctx.fillText(ln, vx, top + k * lineH));
    ry += r.h;
  });
  ctx.fillStyle = "rgba(196,150,40,.5)"; ctx.fillRect(tblX + colL - 1, ty, 2, tableH);
  ctx.restore();

  // footer
  const fy = ty + tableH + 70;
  ctx.textAlign = "center";
  ctx.fillStyle = GOLD; diamond(ctx, W / 2, fy, 7);
  ctx.fillRect(W / 2 - 230, fy - 1, 190, 2); ctx.fillRect(W / 2 + 40, fy - 1, 190, 2);
  ctx.fillStyle = "#4d5f56"; ctx.font = `500 24px ${SANS}`;
  ctx.fillText("Check your own duty & download your duty order at", W / 2, fy + 52);
  const lw = 760;
  rr(ctx, W / 2 - lw / 2, fy + 82, lw, 82, 41);
  const bgp = ctx.createLinearGradient(0, fy + 82, W, fy + 164);
  bgp.addColorStop(0, GREEN_D); bgp.addColorStop(1, GREEN);
  ctx.fillStyle = bgp; ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `700 33px ${SANS}`;
  ctx.fillText(SITE_LABEL, W / 2, fy + 136);

  return await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

/** Shares the card via the native sheet (WhatsApp, etc.). Falls back to saving the image + opening WhatsApp. */
export async function shareDuty(inp: ShareInput): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await buildDutyShareBlob(inp);
  const file = new File([blob], "GHS-Babi-Khel-Exam-Duty.png", { type: "image/png" });
  const text = `📋 Exam Duty Order — GHS Babi Khel\nCheck your duty & download your duty order:\n${SITE_URL}`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, title: "Exam Duty Order" });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return "downloaded";
}
