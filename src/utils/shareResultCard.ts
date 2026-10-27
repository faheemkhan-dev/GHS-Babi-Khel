// ── shareResultCard.ts ──────────────────────────────────────────────────────
// Generates a beautiful, professional "marks card" IMAGE for a student's
// result (school results AND BISE Peshawar board results) and shares it via
// the Web Share API — so a student can post his marks to WhatsApp,
// Instagram, or anywhere else, with the school's branding and the official
// website link baked into both the image and the caption.
//
// WHY CANVAS (instead of html2canvas / a screenshot of the on-screen card)?
//   • Pixel-perfect 1080px-wide output regardless of the visitor's screen
//     or the site's current theme (light/dark) — the shared image always
//     looks like an official document, never like a dark-mode screenshot.
//   • Fixed, hand-drawn layout = complete control over typography, gold
//     accents, subject bars and badges.
//   • Zero new dependencies — nothing is added to the bundle.
//
// SHARE STRATEGY (most-capable path first):
//   1. Web Share API Level 2 — share the PNG file itself
//      (navigator.share({ files })) so the image lands directly in a
//      WhatsApp chat / gallery. Used when navigator.canShare({ files })
//      is true (modern Android/iOS browsers, Chrome & Edge on desktop).
//   2. Web Share API text — share the marks caption + website link.
//   3. Fallback (desktop without sharing) — download the PNG and copy the
//      caption + link to the clipboard.
//
// The canvas → File conversion is fully SYNCHRONOUS (toDataURL + atob, no
// async toBlob callback), so navigator.share() is still called inside the
// browser's transient user-activation window — the #1 hidden reason file
// sharing silently fails on iOS Safari.
//
// The site URL is imported from the SEO module so the shared link can never
// drift away from the site's canonical origin.

import { SITE_URL } from "@/components/seo/SEO";
import toast from "react-hot-toast";

// The link that accompanies every shared marks card — the homepage Results
// section, where classmates can look up their own result.
export const RESULTS_SHARE_URL = `${SITE_URL}/results`;
// Companion links baked into the Roll No. Slip and Merit List share cards,
// so whoever receives a shared card lands exactly where they can look up
// their own slip / ranking.
export const ROLLSLIP_SHARE_URL = `${SITE_URL}/roll-no-slip`;
export const MERIT_SHARE_URL = `${SITE_URL}/merit-list`;

// ── Public data shapes ──────────────────────────────────────────────────────

export interface SchoolResultShareData {
  studentName: string;
  className: string;
  examLabel: string;            // e.g. "1st Semester 2026"
  rollNo: string;
  totalMarks: number | string;
  obtainedMarks: number | string;
  percentage: number | string;
  grade: string;
  isPass: boolean;
  schoolRank: number | null;    // whole-school rank (Trophy badge on screen)
  classPosition: number | null;
  schoolRankTotal?: number | null;     // pool size → "#2/50"
  classPositionTotal?: number | null;  // class size → "#1/20"
  subjects: { name: string; obtained: number; total: number }[];
  photoUrl?: string | null;     // optional student photo (CORS-safe load)
}

export interface BiseResultShareData {
  examTitle: string;            // live BISEP title, e.g. "SSC Annual-I Examination 2026"
  studentName: string;
  fatherName: string;
  rollNo: string;
  marks: string;                // e.g. "1028"
  grade: string;                // e.g. "A1"
  remarks: string;              // e.g. "PASS" / "PROMOTED" / ""
  subjects: {
    sr: string;
    subject: string;
    theory: string;
    practical: string;
    theoryFail?: boolean;
    practicalFail?: boolean;
    /** Bar length 0–100 = (theory + practical) / the subject's fixed maximum. null → no bar. */
    barPct?: number | null;
    /** The subject's fixed maximum (50 / 75 / 100) — used for the marks-total + percentage. */
    maxMarks?: number | null;
  }[];
}

export interface RollSlipShareData {
  studentName: string;
  fatherName: string;           // may be "—" when not recorded
  rollNo: string;               // EXAM roll no (the one on the slip)
  className: string;            // e.g. "9"
  examLabel: string;            // e.g. "First Semester 2026"
}

export interface MeritShareData {
  studentName: string;
  rollNo: string;
  className: string;            // e.g. "9"
  position: number;             // 1 = topper
  obtainedMarks: number | string;
  totalMarks: number | string;
  percentage: number | string;
  grade: string;
  examLabel: string;            // e.g. "Class 9 · First Semester · Year 2026"
  photoUrl?: string | null;
}

export interface Top3ShareEntry {
  studentName: string;
  rollNo: string;
  className: string;
  percentage: number | string;
  grade: string;
  photoUrl?: string | null;
}

export interface Top3ShareData {
  examLabel: string;            // e.g. "BISE (Class 9th & 10th) · Mid-Term · Year 2026"
  entries: Top3ShareEntry[];    // exactly the top 1–3 entries, in rank order
}

export type ShareOutcome =
  | "shared-file"   // PNG image + caption shared via the share sheet
  | "shared-text"   // caption + link shared (files unsupported)
  | "downloaded"    // PNG downloaded + caption copied (desktop fallback)
  | "cancelled"     // visitor closed the share sheet — no message needed
  | "failed";       // nothing worked

// ── Palette (fixed — shared images must be theme-independent) ───────────────

const C = {
  bgTop: "#0A2E1A",
  bgBottom: "#14532D",
  card: "#FDFCF7",
  headerTop: "#0E3B20",
  headerMid: "#14532D",
  headerBottom: "#2B8659",
  navy: "#0E3B20",
  navyBottom: "#14532D",
  ink: "#14281B",
  sub: "#4A5F52",
  label: "#667A6C",
  line: "#DDE8DF",
  track: "#E4EEE5",
  tile: "#F3F8F2",
  gold: "#D4A017",
  goldBright: "#E8BB45",
  goldDark: "#8F6508",
  goldBg: "#FBF5E0",
  goldBorder: "#EBD592",
  blue: "#14532D",
  blueBg: "#EEF6F0",
  blueBorder: "#BFDCC8",
  green: "#15803D",
  greenBg: "#F0FDF4",
  greenBorder: "#BBF7D0",
  red: "#DC2626",
  redBg: "#FEF2F2",
  redBorder: "#FECACA",
  slateBg: "#EFF5EE",
  slateBorder: "#DDE8DF",
} as const;

// Same type system as the website: Inter for UI/body, Playfair Display for
// headings/display numbers (both self-hosted & declared in index.css).
const FONT = `'Inter', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
const FONT_SERIF = `'Playfair Display', Georgia, 'Times New Roman', serif`;

// Canvas can only draw a webfont that is already loaded — make sure both
// faces are ready before any card is drawn (no-op after the first call).
async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`400 20px ${FONT}`),
        document.fonts.load(`600 20px ${FONT}`),
        document.fonts.load(`800 20px ${FONT}`),
        document.fonts.load(`700 20px ${FONT_SERIF}`),
        document.fonts.load(`800 20px ${FONT_SERIF}`),
      ]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch { /* fall back to system fonts */ }
}
const W = 1080;          // canvas width — 4:5-ish portrait shares beautifully
const M = 44;            // outer background margin around the white card
const PAD = 44;          // inner card padding

// ── Small drawing helpers ───────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function setFont(ctx: Ctx, px: number, weight = 400, serif = false) {
  ctx.font = `${weight} ${px}px ${serif ? FONT_SERIF : FONT}`;
}

// Shrink font size until the text fits maxW (returns the final px used).
function fitText(ctx: Ctx, text: string, maxW: number, startPx: number, weight = 700, minPx = 13, serif = false): number {
  let px = startPx;
  setFont(ctx, px, weight, serif);
  while (px > minPx && ctx.measureText(text).width > maxW) {
    px -= 1;
    setFont(ctx, px, weight, serif);
  }
  return px;
}

// Hard-truncate with an ellipsis (font must already be set).
function truncateText(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function drawStar(ctx: Ctx, cx: number, cy: number, r: number, color: string) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawCheck(ctx: Ctx, cx: number, cy: number, r: number, color: string, lw: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.9, cy + r * 0.05);
  ctx.lineTo(cx - r * 0.15, cy + r * 0.75);
  ctx.lineTo(cx + r * 0.95, cy - r * 0.7);
  ctx.stroke();
}

function drawCross(ctx: Ctx, cx: number, cy: number, r: number, color: string, lw: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.75, cy - r * 0.75);
  ctx.lineTo(cx + r * 0.75, cy + r * 0.75);
  ctx.moveTo(cx + r * 0.75, cy - r * 0.75);
  ctx.lineTo(cx - r * 0.75, cy + r * 0.75);
  ctx.stroke();
}

interface PillOpts {
  bg: string;
  border: string;
  fg: string;
  icon?: "star" | "check" | "cross";
  iconColor?: string;
}

const PILL_H = 54;

function pillWidth(ctx: Ctx, text: string, px = 21): number {
  setFont(ctx, px, 800);
  return Math.ceil(ctx.measureText(text).width) + (text ? 92 : 52);
}

function drawPill(ctx: Ctx, x: number, cy: number, text: string, w: number, o: PillOpts): number {
  const y = cy - PILL_H / 2;
  rr(ctx, x, y, w, PILL_H, PILL_H / 2);
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.strokeStyle = o.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  // icon
  let textX = x + 30;
  if (o.icon) {
    const icx = x + 40;
    if (o.icon === "star") drawStar(ctx, icx, cy, 13, o.iconColor ?? C.gold);
    else if (o.icon === "check") drawCheck(ctx, icx, cy, 12, o.iconColor ?? C.green, 4.5);
    else drawCross(ctx, icx, cy, 11, o.iconColor ?? C.red, 4.5);
    textX = x + 62;
  }
  setFont(ctx, 21, 800);
  ctx.fillStyle = o.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, textX, cy + 1);
  return w;
}

// Draw a centred row of pills; returns the y cursor after the row.
function pillRow(ctx: Ctx, cy: number, pills: { text: string; o: PillOpts }[]) {
  const gap = 16;
  const widths = pills.map(p => pillWidth(ctx, p.text));
  const total = widths.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
  let x = (W - total) / 2;
  pills.forEach((p, i) => {
    drawPill(ctx, x, cy, p.text, widths[i], p.o);
    x += widths[i] + gap;
  });
}

// ── Chrome: background, card, header, footer (shared by both variants) ──────

function drawBackground(ctx: Ctx, H: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft blue glow (top-right) + gold glow (bottom-left)
  const b = ctx.createRadialGradient(W * 0.86, H * 0.1, 40, W * 0.86, H * 0.1, 480);
  b.addColorStop(0, "rgba(43,134,89,0.35)");
  b.addColorStop(1, "rgba(43,134,89,0)");
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, W, H);
  const gd = ctx.createRadialGradient(W * 0.08, H * 0.92, 40, W * 0.08, H * 0.92, 520);
  gd.addColorStop(0, "rgba(232,187,69,0.22)");
  gd.addColorStop(1, "rgba(232,187,69,0)");
  ctx.fillStyle = gd;
  ctx.fillRect(0, 0, W, H);
}

function drawCard(ctx: Ctx, H: number) {
  // drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(2,8,28,0.55)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 18;
  rr(ctx, M, M, W - 2 * M, H - 2 * M, 40);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.restore();
  // clip everything below to the rounded card
  ctx.save();
  rr(ctx, M, M, W - 2 * M, H - 2 * M, 40);
  ctx.clip();
}

interface HeaderOpts { pillText: string; tone?: "blue" | "green"; }

const HEADER_H = 300;

// Two header tones keep the card family recognisable while giving each
// document its own identity: blue = results/merit lists, green = roll slips
// (the school's brand green — used sparingly, per the design brief).
// Editorial/ivory palette — mirrors the official printed DMC (Detailed
// Marks Certificate): warm off-white header, dark serif-weight ink text,
// a restrained gold hairline instead of a photographic gradient or seal.
const HEADER_TONES = {
  blue:  { top: "#F7F5EF", mid: "#F3F0E7", bottom: "#EFEBDF" },
  green: { top: "#F7F5EF", mid: "#F3F0E7", bottom: "#EFEBDF" },
} as const;

function drawHeader(ctx: Ctx, o: HeaderOpts) {
  const top = M;
  const tone = HEADER_TONES[o.tone ?? "blue"];
  const g = ctx.createLinearGradient(M, top, W - M, top + HEADER_H);
  g.addColorStop(0, tone.top);
  g.addColorStop(0.55, tone.mid);
  g.addColorStop(1, tone.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(M, top, W - 2 * M, HEADER_H);

  // school identity — fully centred (no seal/logo competing for the middle)
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fitText(ctx, "GOVT. HIGH SCHOOL BABI KHEL", 760, 40, 800, 20, true);
  ctx.fillStyle = C.ink;
  ctx.fillText("GOVT. HIGH SCHOOL BABI KHEL", W / 2, top + 100);
  setFont(ctx, 21, 600);
  ctx.fillStyle = C.sub;
  ctx.fillText("District Mohmand · Khyber Pakhtunkhwa", W / 2, top + 138);

  // gold hairline
  const hl = ctx.createLinearGradient(W / 2 - 130, 0, W / 2 + 130, 0);
  hl.addColorStop(0, "rgba(143,101,8,0)");
  hl.addColorStop(0.5, C.goldDark);
  hl.addColorStop(1, "rgba(143,101,8,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(W / 2 - 130, top + 164, 260, 3);

  // gold pill with the exam label — centred under the hairline
  // (shrinks to fit so long labels like "RESULT COMPARISON · <exam>" never
  // spill past the card edges)
  const pillText = o.pillText.toUpperCase();
  const pillPx = fitText(ctx, pillText, W - 2 * M - 2 * PAD - 48, 21, 800, 15);
  setFont(ctx, pillPx, 800);
  const pw = Math.ceil(ctx.measureText(pillText).width) + 72;
  const ph = 46;
  const px = (W - pw) / 2;
  const py = top + 196;
  rr(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = C.gold;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#14281B";
  ctx.textBaseline = "middle";
  ctx.fillText(pillText, px + pw / 2, py + ph / 2 + 1);
  ctx.textBaseline = "alphabetic";

  // gold hairline along the header's bottom edge
  ctx.fillStyle = C.gold;
  ctx.fillRect(M, top + HEADER_H - 4, W - 2 * M, 4);
}

interface StudentOpts {
  name: string;
  subLine: string;
  rollLabel: string;
  rollNo: string;
  photo: HTMLImageElement | null;
}

const STUDENT_H = 168;

function drawStudentBand(ctx: Ctx, o: StudentOpts) {
  const y0 = M + HEADER_H;
  // avatar with gold ring
  const cx = M + PAD + 54;
  const cy = y0 + STUDENT_H / 2;
  ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI * 2);
  ctx.fillStyle = C.goldBg; ctx.fill();
  ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.stroke();
  if (o.photo) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.clip();
    // cover-fit the photo inside the circle
    const s = Math.max(100 / o.photo.width, 100 / o.photo.height);
    const dw = o.photo.width * s;
    const dh = o.photo.height * s;
    ctx.drawImage(o.photo, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    const ag = ctx.createLinearGradient(cx - 50, cy - 50, cx + 50, cy + 50);
    ag.addColorStop(0, C.headerMid);
    ag.addColorStop(1, C.headerBottom);
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fillStyle = ag; ctx.fill();
    setFont(ctx, 46, 800);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((o.name || "S").charAt(0).toUpperCase(), cx, cy + 2);
    ctx.textBaseline = "alphabetic";
  }

  // name + sub line
  const textX = M + PAD + 136;
  const maxW = 500;
  const namePx = fitText(ctx, o.name, maxW, 42, 800, 13, true);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "left";
  ctx.fillText(o.name, textX, y0 + 78);
  setFont(ctx, Math.min(23, namePx), 600);
  ctx.fillStyle = C.sub;
  ctx.fillText(truncateText(ctx, o.subLine, maxW), textX, y0 + 116);

  // roll no block (right)
  const rightX = W - M - PAD;
  setFont(ctx, 17, 700);
  ctx.fillStyle = C.label;
  ctx.textAlign = "right";
  ctx.fillText(o.rollLabel.toUpperCase(), rightX, y0 + 60);
  fitText(ctx, o.rollNo, 270, 40, 800, 13, true);
  ctx.fillStyle = C.blue;
  ctx.fillText(o.rollNo, rightX, y0 + 104);

  // divider
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M + PAD, y0 + STUDENT_H - 16);
  ctx.lineTo(W - M - PAD, y0 + STUDENT_H - 16);
  ctx.stroke();
}

interface StatTile { label: string; value: string; color: string; bg?: string; border?: string; }

function drawStatTiles(ctx: Ctx, tiles: StatTile[], y0: number = M + HEADER_H + STUDENT_H): number {
  const y1 = y0;
  const innerW = W - 2 * M - 2 * PAD;
  const gap = 16;
  const tileW = (innerW - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 104;
  tiles.forEach((t, i) => {
    const x = M + PAD + i * (tileW + gap);
    rr(ctx, x, y1 + 22, tileW, tileH, 20);
    ctx.fillStyle = t.bg ?? C.tile;
    ctx.fill();
    ctx.strokeStyle = t.border ?? C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = "center";
    setFont(ctx, 16, 700);
    ctx.fillStyle = C.label;
    ctx.fillText(t.label.toUpperCase(), x + tileW / 2, y1 + 54);
    fitText(ctx, t.value, tileW - 24, 33, 800, 13, true);
    ctx.fillStyle = t.color;
    ctx.fillText(t.value, x + tileW / 2, y1 + 96);
  });
  return y1 + 22 + tileH + 26; // y cursor for the next section
}

function drawSectionTitle(ctx: Ctx, y: number, title: string) {
  ctx.textAlign = "left";
  setFont(ctx, 19, 800);
  ctx.fillStyle = C.label;
  ctx.fillText(title, M + PAD, y);
  ctx.fillStyle = C.gold;
  ctx.fillRect(M + PAD, y + 12, 64, 3);
}

function drawNoteStrip(ctx: Ctx, y: number, text: string) {
  const x = M + PAD;
  const w = W - 2 * M - 2 * PAD;
  rr(ctx, x, y, w, 64, 14);
  ctx.fillStyle = C.slateBg;
  ctx.fill();
  // shrink-to-fit so longer notes never spill past the strip's edges
  fitText(ctx, text, w - 56, 20, 600, 14);
  ctx.fillStyle = C.label;
  ctx.textAlign = "center";
  ctx.fillText(text, W / 2, y + 40);
}

const FOOTER_H = 96;

function drawFooter(ctx: Ctx, linkPath = "/results") {
  const y = M + cardHeightSoFar - FOOTER_H;
  // gold hairline on top of the footer
  ctx.fillStyle = C.gold;
  ctx.fillRect(M, y, W - 2 * M, 2.5);
  const g = ctx.createLinearGradient(0, y, 0, y + FOOTER_H);
  g.addColorStop(0, C.navy);
  g.addColorStop(1, C.navyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(M, y, W - 2 * M, FOOTER_H);

  const linkText = `ghsbabikhel.dpdns.org${linkPath}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  setFont(ctx, 22, 600);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fillText("GHS Babi Khel — Official School Portal", M + PAD, y + FOOTER_H / 2 + 1);
  ctx.textAlign = "right";
  fitText(ctx, linkText, 430, 24, 800);
  ctx.fillStyle = C.goldBright;
  ctx.fillText(linkText, W - M - PAD, y + FOOTER_H / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

// Module-level cursor so drawFooter knows the card bottom — set by builders.
let cardHeightSoFar = 0;

// ── Canvas bootstrap ────────────────────────────────────────────────────────

function createCanvas(H: number): Ctx | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return ctx;
}

// ── SCHOOL result card ──────────────────────────────────────────────────────

function buildSchoolCanvas(d: SchoolResultShareData, photo: HTMLImageElement | null): HTMLCanvasElement | null {
  const rows = d.subjects.length;
  const subjectBlock = rows > 0 ? 52 + rows * 56 : 52 + 64 + 18;
  const badgesH = 34 + PILL_H + 30;
  cardHeightSoFar = HEADER_H + STUDENT_H + 152 + subjectBlock + badgesH + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawHeader(ctx, { pillText: `Official Result · ${d.examLabel}` });
  drawStudentBand(ctx, {
    name: d.studentName,
    subLine: `Class ${d.className} · ${d.examLabel}`,
    rollLabel: "Exam Roll No",
    rollNo: d.rollNo,
    photo,
  });

  const ySub = drawStatTiles(ctx, [
    { label: "Total", value: String(d.totalMarks), color: C.ink },
    { label: "Obtained", value: String(d.obtainedMarks), color: C.blue },
    { label: "Percentage", value: `${d.percentage}%`, color: C.green },
    { label: "Grade", value: d.grade || "—", color: C.goldDark, bg: C.goldBg, border: C.goldBorder },
  ]);

  drawSectionTitle(ctx, ySub + 14, "SUBJECT-WISE MARKS");
  let y = ySub + 52;
  if (rows > 0) {
    const trackX = M + PAD + 330;
    const trackW = W - M - PAD - 150 - trackX;
    d.subjects.forEach((s) => {
      const cy = y + 26;
      setFont(ctx, 25, 600);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.fillText(truncateText(ctx, s.name, 310), M + PAD, cy + 9);
      // track
      rr(ctx, trackX, cy - 3, trackW, 6, 3);
      ctx.fillStyle = C.track;
      ctx.fill();
      // fill
      const pct = s.total > 0 ? Math.min(Math.max(s.obtained / s.total, 0), 1) : 0;
      if (pct > 0) {
        const fg = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
        if (pct >= 0.5) { fg.addColorStop(0, "#14532D"); fg.addColorStop(1, "#4CAF7A"); }
        else if (pct >= 0.33) { fg.addColorStop(0, "#B7860B"); fg.addColorStop(1, "#E8BB45"); }
        else { fg.addColorStop(0, "#DC2626"); fg.addColorStop(1, "#F87171"); }
        rr(ctx, trackX, cy - 3, Math.max(trackW * pct, 6), 6, 3);
        ctx.fillStyle = fg;
        ctx.fill();
      }
      // value
      setFont(ctx, 25, 700);
      ctx.fillStyle = C.sub;
      ctx.textAlign = "right";
      ctx.fillText(`${s.obtained}/${s.total}`, W - M - PAD, cy + 9);
      y += 56;
    });
  } else {
    drawNoteStrip(ctx, y, "Detailed subject-wise marks are not entered for this result.");
    y += 82;
  }

  // badges row
  const badges: { text: string; o: PillOpts }[] = [];
  if (d.schoolRank) {
    badges.push({ text: `SCHOOL RANK #${d.schoolRank}${d.schoolRankTotal ? `/${d.schoolRankTotal}` : ""}`, o: { bg: C.goldBg, border: C.goldBorder, fg: C.goldDark, icon: "star", iconColor: C.gold } });
  }
  badges.push(
    d.isPass
      ? { text: "PASS", o: { bg: C.greenBg, border: C.greenBorder, fg: C.green, icon: "check", iconColor: C.green } }
      : { text: "FAIL", o: { bg: C.redBg, border: C.redBorder, fg: C.red, icon: "cross", iconColor: C.red } }
  );
  if (d.classPosition) {
    badges.push({ text: `CLASS POSITION #${d.classPosition}${d.classPositionTotal ? `/${d.classPositionTotal}` : ""}`, o: { bg: C.blueBg, border: C.blueBorder, fg: C.blue } });
  }
  pillRow(ctx, y + 34 + PILL_H / 2 - 8, badges);

  drawFooter(ctx);
  ctx.restore(); // card clip
  return ctx.canvas;
}

// ── BISE Peshawar result card ───────────────────────────────────────────────

function bisePassState(d: BiseResultShareData): boolean | null {
  if (d.subjects.some(s => s.theoryFail || s.practicalFail)) return false;
  if (/fail/i.test(d.grade || "")) return false;
  if (/^\s*(pass|promoted)/i.test(d.remarks || "")) return true;
  return null;
}

function buildBiseCanvas(d: BiseResultShareData): HTMLCanvasElement | null {
  const rows = d.subjects.length;
  const tableHeaderH = 46;
  const subjectBlock = rows > 0 ? 52 + tableHeaderH + rows * 54 + 8 : 52 + 64 + 18;
  const badgesH = 34 + PILL_H + 30;
  cardHeightSoFar = HEADER_H + STUDENT_H + 152 + subjectBlock + badgesH + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawHeader(ctx, { pillText: "BISE Peshawar · Official Result" });
  drawStudentBand(ctx, {
    name: d.studentName,
    subLine: d.examTitle,
    rollLabel: "Board Roll No",
    rollNo: d.rollNo,
    photo: null,
  });

  const status = bisePassState(d);
  const remarksColor = status === false || /fail/i.test(d.remarks || "") ? C.red : C.green;
  // Total + percentage only when EVERY paper has a known fixed maximum and the
  // board's marks figure is a plain number that fits inside that total.
  const obtainedNum = /^\d{1,4}$/.test((d.marks || "").trim()) ? Number((d.marks || "").trim()) : null;
  const allMax = d.subjects.length > 0 && d.subjects.every(s => typeof s.maxMarks === "number" && s.maxMarks > 0);
  const maxTotal = allMax ? d.subjects.reduce((a, s) => a + (s.maxMarks as number), 0) : null;
  const totalKnown = obtainedNum !== null && maxTotal !== null && obtainedNum <= maxTotal;
  const pctText = totalKnown ? `${Math.round(((obtainedNum as number) / (maxTotal as number)) * 1000) / 10}%` : null;

  const ySub = drawStatTiles(ctx, [
    { label: "Marks", value: totalKnown ? `${obtainedNum} / ${maxTotal}` : (d.marks || "—"), color: C.blue },
    { label: "Grade", value: d.grade || "—", color: C.goldDark, bg: C.goldBg, border: C.goldBorder },
    { label: "Remarks", value: d.remarks || "—", color: d.remarks ? remarksColor : C.ink },
    { label: "Father Name", value: d.fatherName || "—", color: C.ink },
  ]);

  drawSectionTitle(ctx, ySub + 14, "SUBJECT-WISE MARKS");
  let y = ySub + 52;
  if (rows > 0) {
    const leftX = M + PAD;
    const innerW = W - 2 * M - 2 * PAD;
    // Column layout (innerW = 904): # | SUBJECT | ── BAR ── | THEORY | PRACTICAL
    const subjX = leftX + 62;
    const barX = leftX + 300;
    const barW = 250;
    const theoryX = leftX + 650;
    const pracX = leftX + 820;

    // table header
    setFont(ctx, 17, 800);
    ctx.fillStyle = C.label;
    ctx.textAlign = "left";
    ctx.fillText("#", leftX, y + 14);
    ctx.fillText("SUBJECT", subjX, y + 14);
    ctx.textAlign = "center";
    ctx.fillText("BAR", barX + barW / 2, y + 14);
    ctx.fillText("THEORY", theoryX, y + 14);
    ctx.fillText("PRACTICAL", pracX, y + 14);
    // gold-tipped divider
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftX, y + 30);
    ctx.lineTo(leftX + innerW, y + 30);
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.fillRect(leftX, y + 29, 64, 3);
    y += tableHeaderH;

    d.subjects.forEach((s, i) => {
      const cy = y + 30;
      if (i % 2 === 1) {
        rr(ctx, leftX - 14, y + 4, innerW + 28, 52, 14);
        ctx.fillStyle = C.tile;
        ctx.fill();
      }
      // serial
      setFont(ctx, 22, 600);
      ctx.fillStyle = C.label;
      ctx.textAlign = "left";
      ctx.fillText(truncateText(ctx, s.sr, 50), leftX, cy + 8);
      // subject (shrinks to fit before the bar starts)
      const subj = s.subject || "—";
      fitText(ctx, subj, barX - subjX - 20, 25, 700, 16);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.fillText(truncateText(ctx, subj, barX - subjX - 20), subjX, cy + 9);

      // thin blue bar — track + gradient fill + soft glow dot at the tip
      const bh = 9;
      const by = cy + 4 - bh / 2;
      rr(ctx, barX, by, barW, bh, bh / 2);
      ctx.fillStyle = C.track;
      ctx.fill();
      if (s.barPct != null) {
        const failed = s.theoryFail === true || s.practicalFail === true;
        const frac = Math.min(Math.max(s.barPct / 100, 0), 1);
        const fw = Math.max(barW * frac, bh);
        const fg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        if (failed) { fg.addColorStop(0, "#DC2626"); fg.addColorStop(1, "#F87171"); }
        else { fg.addColorStop(0, "#14532D"); fg.addColorStop(1, "#4CAF7A"); }
        rr(ctx, barX, by, fw, bh, bh / 2);
        ctx.fillStyle = fg;
        ctx.fill();
        // tiny highlight along the top of the fill for a glossy finish
        rr(ctx, barX + 3, by + 1.5, Math.max(fw - 6, 0), 2.5, 1.25);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fill();
      }

      // theory / practical
      setFont(ctx, 25, 700);
      ctx.textAlign = "center";
      ctx.fillStyle = s.theoryFail ? C.red : C.ink;
      ctx.fillText(s.theory || "—", theoryX, cy + 9);
      ctx.fillStyle = s.practicalFail ? C.red : C.ink;
      ctx.fillText(s.practical || "—", pracX, cy + 9);
      y += 54;
    });
    y += 8;
  } else {
    drawNoteStrip(ctx, y, "Subject-wise marks are not available for this result.");
    y += 82;
  }

  // badges: grade + pass/fail (+ remarks when it adds information)
  const badges: { text: string; o: PillOpts }[] = [];
  if (pctText) {
    badges.push({ text: `${pctText} SCORED`, o: { bg: C.blueBg, border: C.blueBorder, fg: C.blue, icon: "star", iconColor: C.blue } });
  }
  if (d.grade) {
    badges.push({ text: `GRADE ${d.grade.toUpperCase()}`, o: { bg: C.goldBg, border: C.goldBorder, fg: C.goldDark, icon: "star", iconColor: C.gold } });
  }
  if (status === true) {
    badges.push({ text: "PASS", o: { bg: C.greenBg, border: C.greenBorder, fg: C.green, icon: "check", iconColor: C.green } });
  } else if (status === false) {
    badges.push({ text: "FAIL", o: { bg: C.redBg, border: C.redBorder, fg: C.red, icon: "cross", iconColor: C.red } });
  }
  const remarks = (d.remarks || "").trim();
  if (remarks && !/^(pass|promoted|fail)$/i.test(remarks)) {
    badges.push({ text: remarks.toUpperCase(), o: { bg: C.slateBg, border: C.slateBorder, fg: C.sub } });
  }
  if (badges.length > 0) pillRow(ctx, y + 34 + PILL_H / 2 - 8, badges);

  drawFooter(ctx);
  ctx.restore(); // card clip
  return ctx.canvas;
}

// ── Roll No. Slip announcement card (green “official document” tone) ──────

function buildRollSlipCanvas(d: RollSlipShareData): HTMLCanvasElement | null {
  // sections: header + student band + stat tiles + note strip + luck pill + footer
  const afterTiles = 64 + 34 + PILL_H + 30;
  cardHeightSoFar = HEADER_H + STUDENT_H + 152 + afterTiles + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawHeader(ctx, { pillText: `Official Slip · ${d.examLabel}`, tone: "green" });
  drawStudentBand(ctx, {
    name: d.studentName,
    subLine: `Class ${d.className} · ${d.examLabel}`,
    rollLabel: "Exam Roll No",
    rollNo: d.rollNo,
    photo: null,
  });

  drawStatTiles(ctx, [
    { label: "Exam Roll No", value: d.rollNo, color: C.blue },
    { label: "Class", value: `Class ${d.className}`, color: C.ink },
    { label: "Father Name", value: d.fatherName || "—", color: C.ink },
    { label: "Exam", value: d.examLabel, color: C.goldDark, bg: C.goldBg, border: C.goldBorder },
  ]);

  const yNote = M + HEADER_H + STUDENT_H + 152;
  drawNoteStrip(ctx, yNote, "QR code, date sheet & instructions are on the official slip — download it from our website.");
  pillRow(ctx, yNote + 64 + 34 + PILL_H / 2 - 8, [
    { text: "GOOD LUCK ON YOUR EXAMS!", o: { bg: C.goldBg, border: C.goldBorder, fg: C.goldDark, icon: "star", iconColor: C.gold } },
  ]);

  drawFooter(ctx, "/roll-no-slip");
  ctx.restore(); // card clip
  return ctx.canvas;
}

// ── Merit List position card (gold medallion, restrained palette) ──────────

const MEDALLION_H = 236;

function drawMedallion(ctx: Ctx, cx: number, cy: number, position: number) {
  // soft gold halo
  const halo = ctx.createRadialGradient(cx, cy, 30, cx, cy, 132);
  halo.addColorStop(0, "rgba(232,187,69,0.32)");
  halo.addColorStop(1, "rgba(232,187,69,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 132, cy - 132, 264, 264);
  // gold ring (gradient rim → keeps it alive without extra colours)
  const rim = ctx.createLinearGradient(cx - 92, cy - 92, cx + 92, cy + 92);
  rim.addColorStop(0, C.goldBright);
  rim.addColorStop(1, "#C6912A");
  ctx.beginPath(); ctx.arc(cx, cy, 92, 0, Math.PI * 2);
  ctx.fillStyle = rim; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 79, 0, Math.PI * 2);
  ctx.fillStyle = C.goldBg; ctx.fill();
  ctx.strokeStyle = "rgba(198,145,42,0.35)"; ctx.lineWidth = 2; ctx.stroke();

  // star + big position number + letter-spaced label
  drawStar(ctx, cx, cy - 36, 14, C.gold);
  setFont(ctx, 56, 800, true);
  ctx.fillStyle = C.goldDark;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`#${position}`, cx, cy + 2);
  setFont(ctx, 13, 800);
  ctx.fillStyle = C.label;
  ctx.fillText("P O S I T I O N", cx, cy + 44);
  ctx.textBaseline = "alphabetic";
}

function buildMeritCanvas(d: MeritShareData, photo: HTMLImageElement | null): HTMLCanvasElement | null {
  const afterMedallion = 152 + 34 + PILL_H + 30;
  cardHeightSoFar = HEADER_H + STUDENT_H + MEDALLION_H + afterMedallion + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawHeader(ctx, { pillText: "Official Merit List · School Rankings" });
  drawStudentBand(ctx, {
    name: d.studentName,
    subLine: d.examLabel,
    rollLabel: "Roll No",
    rollNo: d.rollNo,
    photo,
  });

  const cyMed = M + HEADER_H + STUDENT_H + MEDALLION_H / 2 + 6;
  drawMedallion(ctx, W / 2, cyMed, d.position);

  drawStatTiles(ctx, [
    { label: "Marks", value: `${d.obtainedMarks}/${d.totalMarks}`, color: C.ink },
    { label: "Percentage", value: `${d.percentage}%`, color: C.green },
    { label: "Grade", value: d.grade || "—", color: C.goldDark, bg: C.goldBg, border: C.goldBorder },
    { label: "Class", value: `Class ${d.className}`, color: C.blue },
  ], M + HEADER_H + STUDENT_H + MEDALLION_H);

  const yPill = M + HEADER_H + STUDENT_H + MEDALLION_H + 152;
  pillRow(ctx, yPill + 34 + PILL_H / 2 - 8, [
    d.position <= 3
      ? { text: "PODIUM FINISH!", o: { bg: C.goldBg, border: C.goldBorder, fg: C.goldDark, icon: "star", iconColor: C.gold } }
      : { text: "MERIT LIST HONOUR", o: { bg: C.slateBg, border: C.slateBorder, fg: C.sub } },
  ]);

  drawFooter(ctx, "/merit-list");
  ctx.restore(); // card clip
  return ctx.canvas;
}

// ── TOP 3 ACHIEVERS group card ──────────────────────────────────────────────
// A single beautiful podium-style image with all 3 top achievers together —
// built for sharing to WhatsApp/social in one tap instead of per-student cards.

const TOP3_HEADER_H = 220;

function drawTop3Header(ctx: Ctx, examLabel: string) {
  const top = M;
  const tone = HEADER_TONES.blue;
  const g = ctx.createLinearGradient(M, top, W - M, top + TOP3_HEADER_H);
  g.addColorStop(0, tone.top);
  g.addColorStop(0.55, tone.mid);
  g.addColorStop(1, tone.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(M, top, W - 2 * M, TOP3_HEADER_H);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fitText(ctx, "GOVT. HIGH SCHOOL BABI KHEL", 760, 36, 800, 18, true);
  ctx.fillStyle = C.ink;
  ctx.fillText("GOVT. HIGH SCHOOL BABI KHEL", W / 2, top + 66);
  setFont(ctx, 18, 600);
  ctx.fillStyle = C.sub;
  ctx.fillText("District Mohmand · Khyber Pakhtunkhwa", W / 2, top + 96);

  setFont(ctx, 44, 800, true);
  ctx.fillStyle = C.goldDark;
  ctx.fillText("🏆 TOP 3 ACHIEVERS", W / 2, top + 152);

  fitText(ctx, examLabel, 900, 22, 700);
  ctx.fillStyle = C.sub;
  ctx.fillText(examLabel, W / 2, top + 186);

  ctx.fillStyle = C.gold;
  ctx.fillRect(M, top + TOP3_HEADER_H - 4, W - 2 * M, 4);
}

interface Top3Slot {
  entry: Top3ShareEntry;
  rank: number;
  photo: HTMLImageElement | null;
  cx: number;
  avatarTopY: number;  // y of the very top of this slot (crown top, or avatar ring top if no crown)
  baseY: number;       // y of the podium column top (same for every slot)
  colH: number;        // podium column height
  medalColor: [string, string]; // gradient stops
  medalEmoji: string;
}

const TOP3_AVATAR_R: Record<number, number> = { 1: 92, 2: 74, 3: 74 };

function drawTop3Slot(ctx: Ctx, s: Top3Slot) {
  const { entry, rank, photo, cx, avatarTopY, baseY, colH } = s;
  const avatarR = TOP3_AVATAR_R[rank] ?? 74;
  const ringR = avatarR + 8;
  const crownH = rank === 1 ? 60 : 0;
  const avatarCy = avatarTopY + crownH + ringR;

  // crown above 1st place
  if (rank === 1) {
    setFont(ctx, 46, 800);
    ctx.textAlign = "center";
    ctx.fillText("👑", cx, avatarTopY + 46);
  }

  // avatar ring
  const rim = ctx.createLinearGradient(cx - ringR, avatarCy - ringR, cx + ringR, avatarCy + ringR);
  rim.addColorStop(0, s.medalColor[0]);
  rim.addColorStop(1, s.medalColor[1]);
  ctx.beginPath(); ctx.arc(cx, avatarCy, ringR, 0, Math.PI * 2);
  ctx.fillStyle = rim; ctx.fill();

  ctx.beginPath(); ctx.arc(cx, avatarCy, avatarR, 0, Math.PI * 2);
  ctx.fillStyle = C.card; ctx.fill();

  if (photo) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, avatarCy, avatarR - 3, 0, Math.PI * 2); ctx.clip();
    const scale = Math.max((2 * avatarR) / photo.width, (2 * avatarR) / photo.height);
    const dw = photo.width * scale;
    const dh = photo.height * scale;
    ctx.drawImage(photo, cx - dw / 2, avatarCy - dh / 2, dw, dh);
    ctx.restore();
  } else {
    const ag = ctx.createLinearGradient(cx - avatarR, avatarCy - avatarR, cx + avatarR, avatarCy + avatarR);
    ag.addColorStop(0, C.headerMid);
    ag.addColorStop(1, C.headerBottom);
    ctx.beginPath(); ctx.arc(cx, avatarCy, avatarR - 3, 0, Math.PI * 2);
    ctx.fillStyle = ag; ctx.fill();
    setFont(ctx, avatarR * 0.7, 800);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((entry.studentName || "S").charAt(0).toUpperCase(), cx, avatarCy + 3);
    ctx.textBaseline = "alphabetic";
  }

  // medal badge (bottom-right of avatar)
  setFont(ctx, 30, 800);
  ctx.textAlign = "center";
  ctx.fillText(s.medalEmoji, cx + ringR - 4, avatarCy + ringR - 2);

  // name (wraps to 2 lines max)
  const nameY = avatarCy + ringR + 40;
  setFont(ctx, rank === 1 ? 27 : 23, 800);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  const maxNameW = rank === 1 ? 300 : 250;
  const words = entry.studentName.split(" ");
  let line1 = "";
  let line2 = "";
  for (const w of words) {
    const test = line1 ? `${line1} ${w}` : w;
    if (ctx.measureText(test).width <= maxNameW || !line1) line1 = test;
    else line2 = line2 ? `${line2} ${w}` : w;
  }
  const nameLineGap = rank === 1 ? 32 : 28;
  let nameBottomY: number;
  if (line2) {
    ctx.fillText(truncateText(ctx, line1, maxNameW), cx, nameY);
    ctx.fillText(truncateText(ctx, line2, maxNameW), cx, nameY + nameLineGap);
    nameBottomY = nameY + nameLineGap;
  } else {
    ctx.fillText(truncateText(ctx, line1, maxNameW), cx, nameY);
    nameBottomY = nameY;
  }

  // class + grade pill
  const nameToPill = rank === 1 ? 24 : 20;
  const pillY = nameBottomY + nameToPill;
  setFont(ctx, 16, 700);
  ctx.fillStyle = C.sub;
  ctx.fillText(`Class ${entry.className} · ${entry.grade || "—"}`, cx, pillY);

  // percentage
  const pillToPct = rank === 1 ? 44 : 38;
  setFont(ctx, rank === 1 ? 34 : 28, 800);
  ctx.fillStyle = C.green;
  ctx.fillText(`${entry.percentage}%`, cx, pillY + pillToPct);

  setFont(ctx, 15, 600);
  ctx.fillStyle = C.label;
  ctx.fillText(`Roll ${entry.rollNo}`, cx, pillY + pillToPct + 24);

  // podium column
  const colW = rank === 1 ? 260 : 210;
  const colX = cx - colW / 2;
  const colGrad = ctx.createLinearGradient(colX, baseY, colX, baseY + colH);
  colGrad.addColorStop(0, s.medalColor[0]);
  colGrad.addColorStop(1, s.medalColor[1]);
  rr(ctx, colX, baseY, colW, colH, 18);
  ctx.fillStyle = colGrad;
  ctx.fill();
  setFont(ctx, 46, 800);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.textAlign = "center";
  ctx.fillText(String(rank), cx, baseY + 58);
}

function buildTop3Canvas(d: Top3ShareData, photos: (HTMLImageElement | null)[]): HTMLCanvasElement | null {
  const ranked = d.entries.slice(0, 3);

  // Fixed per-rank geometry, computed bottom-up so text never collides
  // with the podium column beneath it.
  const AVATAR_R: Record<number, number> = { 1: 92, 2: 74, 3: 74 };
  const COL_H: Record<number, number> = { 1: 210, 2: 150, 3: 110 };
  const RING_PAD = 8;

  // Vertical block (top of crown/avatar → bottom of "Roll ###" text) for a slot.
  function slotContentH(rank: number, twoLineName: boolean) {
    const avatarR = AVATAR_R[rank];
    const crownH = rank === 1 ? 60 : 0;
    const avatarBlock = 2 * (avatarR + RING_PAD);
    const gapToName = 40;
    const nameLineGap = rank === 1 ? 32 : 28;
    const nameBlockH = twoLineName ? nameLineGap * 2 : nameLineGap;
    const nameToPill = rank === 1 ? 24 : 20;
    const pillToPct = rank === 1 ? 44 : 38;
    const pctToRoll = 24;
    const tailPad = 30; // breathing room below "Roll ###" before the column starts
    return crownH + avatarBlock + gapToName + nameBlockH + nameToPill + pillToPct + pctToRoll + tailPad;
  }

  // Whether a name needs 2 lines, using an offscreen measuring context.
  const measureCtx = createCanvas(10);
  function needsTwoLines(name: string, rank: number): boolean {
    if (!measureCtx) return name.length > 16;
    setFont(measureCtx, rank === 1 ? 27 : 23, 800);
    const maxW = rank === 1 ? 300 : 250;
    return measureCtx.measureText(name).width > maxW;
  }

  const slotHeights = ranked.map((e, i) => slotContentH(i + 1, needsTwoLines(e.studentName, i + 1)));
  const contentH = Math.max(...slotHeights, 300);
  const podiumTop = M + TOP3_HEADER_H + 40;
  const TOP3_PODIUM_H = contentH + Math.max(...ranked.map((_, i) => COL_H[i + 1]));

  cardHeightSoFar = TOP3_HEADER_H + 40 + TOP3_PODIUM_H + 40 + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawTop3Header(ctx, d.examLabel);

  const cols: [string, string][] = [
    ["#CBD5E1", "#94A3B8"], // silver
    [C.goldBright, "#C6912A"], // gold
    ["#FCD9A8", "#C2703D"], // bronze
  ];
  const emojis = ["🥈", "🥇", "🥉"];
  const centersByCount: Record<number, number[]> = {
    1: [W / 2],
    2: [W / 2 - 220, W / 2 + 220],
    3: [W / 2 - 300, W / 2, W / 2 + 300],
  };
  const centers = centersByCount[ranked.length] || centersByCount[3];

  // Every slot's text block starts at the same y (podiumTop), so names/photos
  // always align — only the column height (and therefore its top) differs.
  const avatarTopY = podiumTop;

  // Always render in visual order 2nd–1st–3rd (or fewer), left→right.
  const visualOrder = ranked.length === 3 ? [1, 0, 2] : ranked.length === 2 ? [1, 0] : [0];
  visualOrder.forEach((entryIdx, slot) => {
    const entry = ranked[entryIdx];
    if (!entry) return;
    const rank = entryIdx + 1;
    const cx = centers[slot];
    const colH = COL_H[rank];
    drawTop3Slot(ctx, {
      entry,
      rank,
      photo: photos[entryIdx] ?? null,
      cx,
      avatarTopY,
      baseY: podiumTop + contentH,
      colH,
      medalColor: cols[rank - 1],
      medalEmoji: emojis[rank - 1],
    });
  });

  drawFooter(ctx, "/merit-list");
  ctx.restore(); // card clip
  return ctx.canvas;
}

// ── Photo loading (CORS-safe; failure simply falls back to the initial) ─────

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 3500);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

// ── Share plumbing ──────────────────────────────────────────────────────────

// Synchronous canvas → PNG File (keeps navigator.share inside the
// user-activation window).
function canvasToPngFile(canvas: HTMLCanvasElement, fileName: string): File {
  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], fileName, { type: "image/png" });
}

function downloadFile(file: File) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareCanvas(
  canvas: HTMLCanvasElement | null,
  opts: { fileName: string; title: string; text: string; url?: string },
): Promise<ShareOutcome> {
  if (!canvas) return "failed";
  const nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined;
  // opts.text already ends with the website link (every *ShareText() builder
  // appends it) — never append opts.url again here, or the link shows twice
  // in the shared caption (WhatsApp, clipboard, etc).
  const fullText = opts.text;

  let file: File | null = null;
  try { file = canvasToPngFile(canvas, opts.fileName); } catch { file = null; }

  // 1) Best: share the actual PNG file + caption (caption already has the link)
  try {
    if (nav?.share && file && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: opts.title, text: fullText });
      return "shared-file";
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
    // otherwise fall through to the text-only share
  }

  // 2) Share caption only — no separate `url` field, since the caption
  //    text already ends with the link (a separate url would duplicate it).
  try {
    if (nav?.share) {
      await nav.share({ title: opts.title, text: fullText });
      return "shared-text";
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
  }

  // 3) Desktop fallback: download the card + copy the caption
  try {
    if (file) downloadFile(file);
    if (nav?.clipboard) await nav.clipboard.writeText(fullText);
    return "downloaded";
  } catch {
    return "failed";
  }
}

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Result";

// ── Public API ──────────────────────────────────────────────────────────────

export function schoolShareText(d: SchoolResultShareData): string {
  const lines = [
    `🎓 ${d.studentName} — Class ${d.className}`,
    `📜 ${d.examLabel} · GHS Babi Khel`,
    `📋 Roll No: ${d.rollNo}`,
    `📊 Marks: ${d.obtainedMarks}/${d.totalMarks} (${d.percentage}%) · Grade: ${d.grade || "—"} · ${d.isPass ? "PASS" : "FAIL"}`,
  ];
  const extras: string[] = [];
  if (d.schoolRank) extras.push(`School Rank #${d.schoolRank}${d.schoolRankTotal ? `/${d.schoolRankTotal}` : ""}`);
  if (d.classPosition) extras.push(`Class Position #${d.classPosition}${d.classPositionTotal ? `/${d.classPositionTotal}` : ""}`);
  if (extras.length) lines.push(`🏆 ${extras.join(" · ")}`);
  lines.push(`🔗 ${RESULTS_SHARE_URL}`);
  return lines.join("\n");
}

export function biseShareText(d: BiseResultShareData): string {
  const status = bisePassState(d);
  const lines = [
    `🎓 ${d.studentName}`,
    `📜 ${d.examTitle} · BISE Peshawar`,
    `📋 Roll No: ${d.rollNo}`,
    `📊 Marks: ${d.marks || "—"} · Grade: ${d.grade || "—"}${status === true ? " · PASS" : status === false ? " · FAIL" : ""}`,
    `🏫 Shared via GHS Babi Khel — Govt. High School Babi Khel`,
    `🔗 ${RESULTS_SHARE_URL}`,
  ];
  return lines.join("\n");
}

// ── Comparison share card — hand-drawn 1080px canvas ─────────────────────
// The comparison image used to be a screenshot of the on-screen modal
// (html-to-image at devicePixelRatio ≤ 2 of a ~330–460px-wide node), which
// produced a ~700px-wide PNG whose small table/chart text turned to mush
// once WhatsApp re-compressed it. This builder instead draws a dedicated,
// school-branded "duel" card at the same fixed 1080px width as every other
// share card — so the image that lands in WhatsApp is always crisp HD and
// professional, regardless of screen size, device pixel ratio or theme.

export interface ComparisonSubjectRow {
  name: string;
  obA: number | null;
  obB: number | null;
  max: number | null;
  failA?: boolean; // paper failed (board prints it red) — drawn red
  failB?: boolean;
  avgA?: number | null; // class average for this subject (school mode) — tick on the bar
  avgB?: number | null;
}

export interface ComparisonShareData {
  examTitle: string;
  nameA: string;
  rollA: string;
  pctA: number | null;
  gradeA?: string;   // e.g. "A1" — shown under the percentage when present
  marksA?: string;   // fallback shown when the overall % is unknown
  nameB: string;
  rollB: string;
  pctB: number | null;
  gradeB?: string;
  marksB?: string;
  leadsA: number; // subjects A led
  leadsB: number; // subjects B led
  ties: number;
  subjects?: ComparisonSubjectRow[]; // per-paper duel rows (union of both)
  source?: string;   // "BISE Peshawar" (default) or "GHS Babi Khel" for school results
  failedA?: boolean; // failed overall → percentage drawn red
  failedB?: boolean;
  classAvgA?: number | null; // overall class average % (school mode)
  classAvgB?: number | null;
  classLabelA?: string;      // e.g. "Class 8"
  classLabelB?: string;
  classCount?: number | null; // students in the class
}

const FAIL_RED = "#B91C1C";

// Side-B "sky" identity — side A reuses the palette's blue family.
const SKY_FG = "#9A6F06";
const SKY_BG = "#FBF5E0";
const SKY_BORDER = "#EBD592";

const CMP_PANEL_H = 260;
const CMP_PANEL_H_AVG = 292; // taller when a "vs class average" line is shown

function cmpPanel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  o: {
    name: string;
    roll: string;
    pct: string;
    grade: string;
    accentTop: string;
    accentBottom: string;
    bg: string;
    border: string;
    leading: boolean;
    failed?: boolean;
    vsClass?: string; // e.g. "+6.2% vs Class 8 average"
    vsClassUp?: boolean;
  },
  panelH: number = CMP_PANEL_H,
) {
  rr(ctx, x, y, w, panelH, 24);
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.strokeStyle = o.leading ? C.green : o.border;
  ctx.lineWidth = o.leading ? 4 : 2.5;
  ctx.stroke();

  const cx = x + w / 2;
  // Winner badge — green flag on the leading side.
  if (o.leading) {
    setFont(ctx, 15, 800);
    const pw = Math.ceil(ctx.measureText("LEADING").width) + 44;
    rr(ctx, cx - pw / 2, y + 16, pw, 32, 16);
    ctx.fillStyle = C.green;
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LEADING", cx, y + 33);
    ctx.textBaseline = "alphabetic";
  }

  // Initial avatar in the side's accent colour, gold ring like the result cards.
  const avCy = y + 92;
  ctx.beginPath();
  ctx.arc(cx, avCy, 40, 0, Math.PI * 2);
  const ag = ctx.createLinearGradient(cx - 40, avCy - 40, cx + 40, avCy + 40);
  ag.addColorStop(0, o.accentTop);
  ag.addColorStop(1, o.accentBottom);
  ctx.fillStyle = ag;
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  setFont(ctx, 32, 800);
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((o.name || "S").charAt(0).toUpperCase(), cx, avCy + 2);
  ctx.textBaseline = "alphabetic";

  // Name (shrinks before it can overflow), roll, big percentage, grade.
  fitText(ctx, o.name, w - 28, 24, 800, 15);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.fillText(truncateText(ctx, o.name, w - 28), cx, y + 160);
  setFont(ctx, 16, 700);
  ctx.fillStyle = C.label;
  ctx.fillText(`ROLL ${o.roll}`, cx, y + 182);
  fitText(ctx, o.pct, w - 32, 46, 800, 26, true);
  ctx.fillStyle = o.failed ? FAIL_RED : C.blue;
  ctx.fillText(o.pct, cx, y + 224);
  if (o.grade) {
    setFont(ctx, 16, 800);
    ctx.fillStyle = C.goldDark;
    ctx.fillText(`GRADE ${o.grade.toUpperCase()}`, cx, y + 247);
  }
  if (o.vsClass) {
    setFont(ctx, 17, 800);
    ctx.fillStyle = o.vsClassUp ? C.green : FAIL_RED;
    ctx.textAlign = "center";
    ctx.fillText(truncateText(ctx, o.vsClass, w - 24), cx, y + 278);
  }
}

// Gold verdict strip under the panels — the headline of the whole duel.
function cmpVerdict(ctx: Ctx, y: number, text: string) {
  const x = M + PAD;
  const w = W - 2 * M - 2 * PAD;
  rr(ctx, x, y, w, 64, 16);
  ctx.fillStyle = C.goldBg;
  ctx.fill();
  ctx.strokeStyle = C.goldBorder;
  ctx.lineWidth = 2;
  ctx.stroke();
  fitText(ctx, text, w - 120, 23, 800, 15);
  ctx.fillStyle = C.goldDark;
  const tw = ctx.measureText(text).width;
  drawStar(ctx, W / 2 - tw / 2 - 24, y + 32, 12, C.gold);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, y + 33);
  ctx.textBaseline = "alphabetic";
}

export function buildComparisonCanvas(d: ComparisonShareData): HTMLCanvasElement | null {
  const rows = d.subjects ?? [];
  const hasTally = d.leadsA + d.leadsB + d.ties > 0;
  const subjectBlock = rows.length > 0 ? 122 + rows.length * 56 : 0;
  const tallyBlock = hasTally ? 68 : 0;
  const hasAvg = d.classAvgA != null || d.classAvgB != null;
  const avgBlock = hasAvg ? 68 : 0;
  const panelH = hasAvg ? CMP_PANEL_H_AVG : CMP_PANEL_H;
  cardHeightSoFar =
    HEADER_H + 20 + panelH + 24 + 64 + subjectBlock + avgBlock + tallyBlock + FOOTER_H;
  const H = cardHeightSoFar + 2 * M;
  const ctx = createCanvas(H);
  if (!ctx) return null;

  drawBackground(ctx, H);
  drawCard(ctx, H);
  drawHeader(ctx, { pillText: `Result Comparison · ${d.examTitle}` });

  const leaderA = d.pctA != null && d.pctB != null && d.pctA > d.pctB;
  const leaderB = d.pctA != null && d.pctB != null && d.pctB > d.pctA;

  // ── duel panels ──
  const innerW = W - 2 * M - 2 * PAD;
  const panelW = Math.floor((innerW - 56) / 2);
  const panelTop = M + HEADER_H + 20;
  const pctText = (pct: number | null, marks?: string) =>
    pct != null ? `${pct}%` : (marks && marks.trim() ? marks.trim() : "—");
  const vsText = (pct: number | null, avg: number | null | undefined, label?: string) => {
    if (pct == null || avg == null) return { t: undefined as string | undefined, up: true };
    const dl = Math.round((pct - avg) * 10) / 10;
    return { t: `${dl >= 0 ? "+" : "−"}${Math.abs(dl)}% vs ${label || "class"} avg`, up: dl >= 0 };
  };
  const vA = vsText(d.pctA, d.classAvgA, d.classLabelA);
  const vB = vsText(d.pctB, d.classAvgB, d.classLabelB);
  cmpPanel(ctx, M + PAD, panelTop, panelW, {
    name: d.nameA || `Roll ${d.rollA}`,
    roll: d.rollA,
    pct: pctText(d.pctA, d.marksA),
    grade: (d.gradeA || "").trim(),
    accentTop: "#14532D",
    accentBottom: "#4CAF7A",
    bg: C.blueBg,
    border: C.blueBorder,
    leading: leaderA,
    failed: d.failedA,
    vsClass: vA.t,
    vsClassUp: vA.up,
  }, panelH);
  cmpPanel(ctx, W - M - PAD - panelW, panelTop, panelW, {
    name: d.nameB || `Roll ${d.rollB}`,
    roll: d.rollB,
    pct: pctText(d.pctB, d.marksB),
    grade: (d.gradeB || "").trim(),
    accentTop: "#B7860B",
    accentBottom: "#E8BB45",
    bg: SKY_BG,
    border: SKY_BORDER,
    leading: leaderB,
    failed: d.failedB,
    vsClass: vB.t,
    vsClassUp: vB.up,
  }, panelH);

  // VS medallion between the panels.
  const vsCy = panelTop + panelH / 2;
  const halo = ctx.createRadialGradient(W / 2, vsCy, 8, W / 2, vsCy, 64);
  halo.addColorStop(0, "rgba(239,167,12,0.35)");
  halo.addColorStop(1, "rgba(239,167,12,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(W / 2 - 64, vsCy - 64, 128, 128);
  ctx.beginPath();
  ctx.arc(W / 2, vsCy, 30, 0, Math.PI * 2);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 4;
  ctx.stroke();
  setFont(ctx, 21, 800);
  ctx.fillStyle = C.goldDark;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", W / 2, vsCy + 1);
  ctx.textBaseline = "alphabetic";

  // ── verdict strip ──
  const verdictY = panelTop + panelH + 24;
  const diffPct =
    d.pctA != null && d.pctB != null
      ? Math.round(Math.abs(d.pctA - d.pctB) * 10) / 10
      : null;
  const verdictText = leaderA
    ? `${d.nameA || `Roll ${d.rollA}`} leads by ${diffPct}% overall`
    : leaderB
      ? `${d.nameB || `Roll ${d.rollB}`} leads by ${diffPct}% overall`
      : "Both candidates are tied overall";
  cmpVerdict(ctx, verdictY, verdictText);

  // ── subject-wise duel table ──
  let yCur = verdictY + 64;
  if (rows.length > 0) {
    const yTitle = yCur + 28;
    drawSectionTitle(ctx, yTitle, "SUBJECT-WISE MARKS");
    let y = yTitle + 38;
    const leftX = M + PAD;
    const scoreAX = leftX + 560;
    const scoreBX = leftX + 720;

    // table header
    setFont(ctx, 17, 800);
    ctx.fillStyle = C.label;
    ctx.textAlign = "left";
    ctx.fillText("SUBJECT", leftX, y + 14);
    ctx.textAlign = "right";
    ctx.fillText(`ROLL ${d.rollA}`, scoreAX, y + 14);
    ctx.fillText(`ROLL ${d.rollB}`, scoreBX, y + 14);
    ctx.fillText("MARGIN", leftX + innerW, y + 14);
    // gold-tipped divider (same rhythm as the BISE result card table)
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftX, y + 30);
    ctx.lineTo(leftX + innerW, y + 30);
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.fillRect(leftX, y + 29, 64, 3);
    y += 46;

    rows.forEach((r, i) => {
      const cy = y + 28;
      if (i % 2 === 1) {
        rr(ctx, leftX - 14, y + 4, innerW + 28, 52, 14);
        ctx.fillStyle = C.tile;
        ctx.fill();
      }
      const aWin = r.obA != null && r.obB != null && r.obA > r.obB;
      const bWin = r.obA != null && r.obB != null && r.obB > r.obA;

      // subject name + dual mini bars beneath it (mirrors the on-screen table)
      setFont(ctx, 22, 600);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.fillText(truncateText(ctx, r.name, 340), leftX, cy - 4);
      const barW = 360;
      const barH = 7;
      const drawBar = (ob: number | null, yTop: number, win: boolean, sideA: boolean, fail: boolean, avg: number | null | undefined) => {
        rr(ctx, leftX, yTop, barW, barH, barH / 2);
        ctx.fillStyle = C.track;
        ctx.fill();
        if (ob == null || r.max == null || r.max <= 0) return;
        const frac = Math.min(Math.max(ob / r.max, 0), 1);
        const fg = ctx.createLinearGradient(leftX, 0, leftX + barW, 0);
        if (fail) { fg.addColorStop(0, FAIL_RED); fg.addColorStop(1, "#EF4444"); }
        else if (win) { fg.addColorStop(0, "#15803D"); fg.addColorStop(1, "#4CAF7A"); }
        else if (sideA) { fg.addColorStop(0, "#14532D"); fg.addColorStop(1, "#4CAF7A"); }
        else { fg.addColorStop(0, "#B7860B"); fg.addColorStop(1, "#E8BB45"); }
        rr(ctx, leftX, yTop, Math.max(barW * frac, barH), barH, barH / 2);
        ctx.fillStyle = fg;
        ctx.fill();
        // class-average tick
        if (avg != null) {
          const tx = leftX + barW * Math.min(Math.max(avg / r.max, 0), 1);
          ctx.fillStyle = C.ink;
          ctx.fillRect(tx - 1.5, yTop - 3, 3, barH + 6);
        }
      };
      drawBar(r.obA, cy + 6, aWin, true, r.failA === true, r.avgA);
      drawBar(r.obB, cy + 17, bWin, false, r.failB === true, r.avgB);

      // scores + margin
      const fmt = (ob: number | null) =>
        ob == null ? "—" : r.max != null ? `${ob}/${r.max}` : `${ob}`;
      setFont(ctx, 22, 700);
      ctx.textAlign = "right";
      ctx.fillStyle = r.failA ? FAIL_RED : aWin ? C.green : C.ink;
      ctx.fillText(fmt(r.obA), scoreAX, cy + 8);
      ctx.fillStyle = r.failB ? FAIL_RED : bWin ? C.green : C.ink;
      ctx.fillText(fmt(r.obB), scoreBX, cy + 8);
      setFont(ctx, 21, 800);
      if (r.obA != null && r.obB != null) {
        const md = r.obA - r.obB;
        ctx.fillStyle = md === 0 ? C.label : aWin ? C.blue : SKY_FG;
        ctx.fillText(md === 0 ? "=" : `${Math.abs(md)}`, leftX + innerW, cy + 8);
      } else {
        ctx.fillStyle = C.label;
        ctx.fillText("—", leftX + innerW, cy + 8);
      }
      y += 56;
    });
    yCur = y + 10;
  }

  // ── class-average strip (school mode) ──
  if (hasAvg) {
    const same = d.classLabelA && d.classLabelA === d.classLabelB;
    const part = (label: string | undefined, v: number | null | undefined) => (v != null ? `${label || "Class"} average ${v}%` : "");
    const txt = (same ? part(d.classLabelA, d.classAvgA) : [part(d.classLabelA, d.classAvgA), part(d.classLabelB, d.classAvgB)].filter(Boolean).join(" · "))
      + (d.classCount ? ` · ${d.classCount} students` : "") + " · tick on bars = class average";
    drawNoteStrip(ctx, yCur + 4, txt);
    yCur += 68;
  }

  // ── subjects-led tally strip ──
  if (hasTally) {
    drawNoteStrip(
      ctx,
      yCur + 4,
      `Subjects led — ${d.nameA || `Roll ${d.rollA}`}: ${d.leadsA} · ${d.nameB || `Roll ${d.rollB}`}: ${d.leadsB}${d.ties ? ` · Tied: ${d.ties}` : ""}`,
    );
  }

  drawFooter(ctx);
  ctx.restore(); // card clip
  return ctx.canvas;
}

export function comparisonShareText(d: ComparisonShareData): string {
  const lines = [
    `📊 Result Comparison — ${d.examTitle} · ${d.source || "BISE Peshawar"}`,
    `🥇 ${d.nameA} (Roll ${d.rollA}) — ${d.pctA != null ? `${d.pctA}%` : "—"}`,
    `🥈 ${d.nameB} (Roll ${d.rollB}) — ${d.pctB != null ? `${d.pctB}%` : "—"}`,
  ];
  if (d.pctA != null && d.pctB != null && d.pctA !== d.pctB) {
    const leaderName = d.pctA > d.pctB ? d.nameA : d.nameB;
    const diff = Math.abs(d.pctA - d.pctB);
    lines.push(`🏆 ${leaderName} leads by ${diff}% overall`);
  }
  if (d.classAvgA != null || d.classAvgB != null) {
    const same = d.classLabelA && d.classLabelA === d.classLabelB;
    lines.push(`🏫 ${same ? `${d.classLabelA} average: ${d.classAvgA}%` : [d.classAvgA != null ? `${d.classLabelA || "Class"} avg ${d.classAvgA}%` : "", d.classAvgB != null ? `${d.classLabelB || "Class"} avg ${d.classAvgB}%` : ""].filter(Boolean).join(" · ")}`);
  }
  if (d.leadsA > 0 || d.leadsB > 0) {
    lines.push(`📚 Subjects led — ${d.nameA}: ${d.leadsA} · ${d.nameB}: ${d.leadsB}${d.ties ? ` · Tied: ${d.ties}` : ""}`);
  }
  lines.push(`🏫 Shared via GHS Babi Khel — Govt. High School Babi Khel`);
  lines.push(`🔗 ${RESULTS_SHARE_URL}`);
  return lines.join("\n");
}

// Shares the comparison as a hand-drawn 1080px branded card (see
// buildComparisonCanvas above) via the same three-tier strategy as every
// other share card (file share → text-only share → download+clipboard
// fallback) — a fixed-HD image that stays crisp in WhatsApp.
export async function shareComparisonCard(d: ComparisonShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const canvas = buildComparisonCanvas(d);
  return shareCanvas(canvas, {
    fileName: `Comparison-${safeName(d.rollA)}-vs-${safeName(d.rollB)}-GHS-Babi-Khel.png`,
    title: "Result Comparison — GHS Babi Khel",
    text: comparisonShareText(d),
  });
}

export async function shareSchoolResultCard(d: SchoolResultShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const photo = d.photoUrl ? await loadImage(d.photoUrl) : null;
  const canvas = buildSchoolCanvas(d, photo);
  return shareCanvas(canvas, {
    fileName: `GHS-Babi-Khel-Result-${safeName(d.rollNo)}-${safeName(d.studentName)}.png`,
    title: "Result Card — GHS Babi Khel",
    text: schoolShareText(d),
  });
}

export async function shareBiseResultCard(d: BiseResultShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const canvas = buildBiseCanvas(d);
  return shareCanvas(canvas, {
    fileName: `BISE-Result-${safeName(d.rollNo)}-GHS-Babi-Khel.png`,
    title: "BISE Peshawar Result — via GHS Babi Khel",
    text: biseShareText(d),
  });
}

// ── Save to gallery — same beautiful canvas as Share, but always saves the
// PNG straight to the device (no share-sheet detour). Mirrors the "downloaded"
// branch of shareCanvas() above: canvas → PNG File → anchor download.
export async function saveSchoolResultCard(d: SchoolResultShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const photo = d.photoUrl ? await loadImage(d.photoUrl) : null;
  const canvas = buildSchoolCanvas(d, photo);
  try {
    const file = canvasToPngFile(canvas, `GHS-Babi-Khel-Result-${safeName(d.rollNo)}-${safeName(d.studentName)}.png`);
    downloadFile(file);
    return "downloaded";
  } catch {
    return "failed";
  }
}

export async function saveBiseResultCard(d: BiseResultShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const canvas = buildBiseCanvas(d);
  try {
    const file = canvasToPngFile(canvas, `BISE-Result-${safeName(d.rollNo)}-GHS-Babi-Khel.png`);
    downloadFile(file);
    return "downloaded";
  } catch {
    return "failed";
  }
}

// ── DOM-capture Save/Share — the REAL, on-screen full result card ──────────
// Unlike buildBiseCanvas() above (a simplified, hand-drawn summary), these
// two capture the exact "Student Result Details" card the student is
// already looking at — Candidate Information table, full Subject Wise
// Marks table with bars, everything — via html-to-image. This is what the
// BISE Peshawar Save/Share buttons now use, so the saved/shared PNG matches
// the on-screen full result card pixel-for-pixel instead of a stripped-down
// alternate design.
//
// A few defensive rules keep this correct across the site's theme system:
//   • Forced to a fixed light background + light card surface at capture
//     time, restored immediately after — so a Save/Share taken in dark mode
//     still produces a normal, readable, shareable image (not a black card).
//   • HD pixel floor — WhatsApp re-compresses shared images, so anything
//     under ~1080px wide turns blurry. The ratio is chosen so the PNG is
//     ALWAYS ≥1080px wide regardless of the on-screen node width (a
//     ~360–460px-wide phone modal needs ratio 2.4–3), capped at 3.5 and
//     by a ~12 MP area budget so low-end phones stay safe.
//   • cacheBust + skipFonts:false lets html-to-image inline the page's own
//     webfonts so text renders identically to what's on screen.
export async function captureNodeAsPngFile(node: HTMLElement, fileName: string): Promise<File | null> {
  try {
    const { toPng } = await import("html-to-image");
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    if (hadDark) root.classList.remove("dark");
    // Temporary branded footer — appears ONLY in the saved/shared image so the
    // picture carries the school + website, then is removed straight away.
    const brand = document.createElement("div");
    brand.setAttribute("data-capture-brand", "true");
    brand.style.cssText =
      "padding:10px 16px 12px;text-align:center;background:#f7faf8;border-top:2px solid #E3B341;" +
      "font-family:'Playfair Display',Georgia,serif;";
    brand.innerHTML =
      '<div style="font-size:11px;font-weight:600;letter-spacing:.14em;color:#14532d;text-transform:uppercase">GHS Babi Khel · Official Result</div>' +
      '<div style="margin-top:2px;font-size:10px;letter-spacing:.08em;color:#8a6508">ghsbabikhel.dpdns.org</div>';
    node.appendChild(brand);
    try {
      const w0 = node.offsetWidth || node.getBoundingClientRect().width || 0;
      const h0 = node.offsetHeight || 0;
      const widthFloor = w0 > 0 ? 1080 / w0 : 2.5;
      const areaCap = w0 > 0 && h0 > 0 ? Math.sqrt(12_000_000 / (w0 * h0)) : 4;
      const dataUrl = await toPng(node, {
        pixelRatio: Math.max(2, Math.min(3.5, widthFloor, areaCap)),
        cacheBust: true,
        backgroundColor: "#ffffff",
        style: { transform: "none" },
        // Skip anything marked data-capture-exclude (e.g. the Share/Save/
        // Compare action row) so buttons never end up baked into the image.
        filter: (el) =>
          !(el instanceof HTMLElement && el.dataset?.captureExclude === "true"),
      });
      const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], fileName, { type: "image/png" });
    } finally {
      brand.remove();
      if (hadDark) root.classList.add("dark");
    }
  } catch {
    return null;
  }
}

// Saves the actual rendered full result card DOM node straight to the
// device — no OS share sheet, mirrors the "downloaded" branch used
// everywhere else in this file.
export async function saveResultCardNode(node: HTMLElement | null, fileName: string): Promise<ShareOutcome> {
  if (!node) return "failed";
  const file = await captureNodeAsPngFile(node, fileName);
  if (!file) return "failed";
  try {
    downloadFile(file);
    return "downloaded";
  } catch {
    return "failed";
  }
}

// Shares the actual rendered full result card DOM node via the OS share
// sheet (falling back to text-only share, then desktop download+clipboard),
// mirroring shareCanvas()'s three-tier strategy above but starting from a
// captured DOM node instead of a hand-drawn canvas.
export async function shareResultCardNode(
  node: HTMLElement | null,
  opts: { fileName: string; title: string; text: string },
): Promise<ShareOutcome> {
  if (!node) return "failed";
  const file = await captureNodeAsPngFile(node, opts.fileName);
  const nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined;
  const fullText = opts.text;

  try {
    if (nav?.share && file && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: opts.title, text: fullText });
      return "shared-file";
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
  }

  try {
    if (nav?.share) {
      await nav.share({ title: opts.title, text: fullText });
      return "shared-text";
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
  }

  try {
    if (file) downloadFile(file);
    if (nav?.clipboard) await nav.clipboard.writeText(fullText);
    return "downloaded";
  } catch {
    return "failed";
  }
}

export function rollSlipShareText(d: RollSlipShareData): string {
  return [
    `🎫 ${d.studentName} — Class ${d.className}`,
    `🏷️ Exam Roll No: ${d.rollNo}`,
    `📜 ${d.examLabel} · GHS Babi Khel`,
    `✅ Official slip — QR code, date sheet & instructions on the printed copy`,
    `🔗 Get your slip: ${ROLLSLIP_SHARE_URL}`,
  ].join("\n");
}

export function meritShareText(d: MeritShareData): string {
  return [
    `🏆 ${d.studentName} — Position #${d.position}`,
    `📊 Marks: ${d.obtainedMarks}/${d.totalMarks} (${d.percentage}%) · Grade: ${d.grade || "—"}`,
    `📜 ${d.examLabel} · GHS Babi Khel`,
    `🏫 Official Merit List — see all rankings: ${MERIT_SHARE_URL}`,
  ].join("\n");
}

export async function shareRollSlipCard(d: RollSlipShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const canvas = buildRollSlipCanvas(d);
  return shareCanvas(canvas, {
    fileName: `GHS-Babi-Khel-Roll-No-Slip-${safeName(d.rollNo)}-${safeName(d.studentName)}.png`,
    title: "Exam Roll No. Slip — GHS Babi Khel",
    text: rollSlipShareText(d),
    url: ROLLSLIP_SHARE_URL,
  });
}

export async function shareMeritCard(d: MeritShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const photo = d.photoUrl ? await loadImage(d.photoUrl) : null;
  const canvas = buildMeritCanvas(d, photo);
  return shareCanvas(canvas, {
    fileName: `GHS-Babi-Khel-Merit-Position-${safeName(String(d.position))}-${safeName(d.studentName)}.png`,
    title: "Merit List — GHS Babi Khel",
    text: meritShareText(d),
    url: MERIT_SHARE_URL,
  });
}

export function top3ShareText(d: Top3ShareData): string {
  const medals = ["🥇", "🥈", "🥉"];
  const lines = [`🏆 Top 3 Achievers — ${d.examLabel}`, ""];
  d.entries.slice(0, 3).forEach((e, i) => {
    lines.push(`${medals[i]} ${e.studentName} — ${e.percentage}% (${e.grade || "—"})`);
  });
  lines.push("", `🏫 GHS Babi Khel — see the full merit list: ${MERIT_SHARE_URL}`);
  return lines.join("\n");
}

export async function shareTop3Card(d: Top3ShareData): Promise<ShareOutcome> {
  await ensureFonts();
  const photos = await Promise.all(
    d.entries.slice(0, 3).map((e) => (e.photoUrl ? loadImage(e.photoUrl) : Promise.resolve(null)))
  );
  const canvas = buildTop3Canvas(d, photos);
  return shareCanvas(canvas, {
    fileName: `GHS-Babi-Khel-Top-3-Achievers.png`,
    title: "Top 3 Achievers — GHS Babi Khel",
    text: top3ShareText(d),
    url: MERIT_SHARE_URL,
  });
}

// Consistent toast feedback for every share outcome (works for results,
// roll slips and merit cards alike).
export function toastShareOutcome(outcome: ShareOutcome) {
  switch (outcome) {
    case "shared-file":
      toast.success("Shared — beautiful card image + your website link sent!");
      break;
    case "shared-text":
      toast.success("Shared with your website link!");
      break;
    case "downloaded":
      toast.success("Card image downloaded & link copied — paste anywhere to share!");
      break;
    case "failed":
      toast.error("Sharing is not available on this device");
      break;
    case "cancelled":
    default:
      break;
  }
}
