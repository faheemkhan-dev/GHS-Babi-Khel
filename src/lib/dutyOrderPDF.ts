// src/lib/dutyOrderPDF.ts — A4 duty order built ONLY from what BISE Peshawar returns.
// Every word, number, date and the signature image come from the board's own letter.
// This file adds styling (type, spacing, gold hairlines) — never content.
//
// Layout: the letter is re-flowed on a real table grid taken from the board's own
// markup (colspan + width="%"), so full-width paragraphs stay full-width, the
// numbered rules keep their hanging indent, and the signature block sits on the
// right exactly like the board's printed letter. The largest type size that keeps
// the whole letter on ONE A4 page is chosen automatically.
//
// Typography metrics: jsPDF 4's built-in getTextWidth is ~0.7% too narrow for the
// standard fonts AND applies kerning that PDF renderers ignore, so multi-word
// segments measured with it overlap once rendered. All layout math below uses
// TRUE_WIDTHS instead — the canonical Adobe AFM advance widths (the exact values
// every PDF viewer renders with), calibrated from a reference renderer.
import { formatPkMobile, type DrawDetails } from "@/hooks/useDrawLookup";
import { groupRows, lineText, type LetterLine, type LetterRow } from "@/lib/letterModel";

type RGB = [number, number, number];
const A4_W = 595.28, A4_H = 841.89, M = 40;
const W = A4_W - M * 2;
const GOLD: RGB = [196, 150, 40];
const GREEN: RGB = [20, 88, 62];
const INK: RGB = [24, 32, 40];
const MUTED: RGB = [110, 120, 128];

// ── true font metrics (Adobe AFM advance widths, /1000 em) ──────────────────
type Widths = { ascii: number[]; extra: Record<number, number> };
const HELV: Widths = {
  ascii: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  extra: {133:1000,145:222,146:222,147:333,148:333,149:350,150:556,151:1000,169:737,176:400,177:584,183:278,188:834,189:834,190:834,215:584,247:584},
};
const HELVB: Widths = {
  ascii: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
  extra: {133:1000,145:278,146:278,147:500,148:500,149:350,150:556,151:1000,169:737,176:400,177:584,183:278,188:834,189:834,190:834,215:584,247:584},
};
const TIMESB: Widths = {
  ascii: [250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520],
  extra: {133:1000,145:333,146:333,147:500,148:500,149:350,150:500,151:1000,169:737,176:400,177:584,183:333,188:834,189:834,190:834,215:584,247:584},
};

/** True rendered advance width (no kerning), matching every PDF viewer. */
function trueWidth(d: import("jspdf").jsPDF, s: string, font: string, fs: number, bold: boolean): number {
  const t = font === "times" ? (bold ? TIMESB : null) : bold ? HELVB : HELV;
  if (!t) return d.getTextWidth(s);
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const u = c >= 32 && c <= 126 ? t.ascii[c - 32] : t.extra[c];
    if (u != null) w += u;
    else w += 1000 / 4; // rare glyph: conservative quarter-em
  }
  return (w / 1000) * fs;
}

export interface DutyOrderInput { letter?: LetterLine[] | null; details: DrawDetails; dutyLabel?: string; session?: string }

export async function downloadDutyOrderPDF({ letter, details, dutyLabel, session }: DutyOrderInput) {
  const { jsPDF } = await import("jspdf");
  const d = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const ink = (c: RGB) => d.setTextColor(c[0], c[1], c[2]);
  const stroke = (c: RGB, w = 0.6) => { d.setDrawColor(c[0], c[1], c[2]); d.setLineWidth(w); };
  const mid = A4_W / 2;
  // width helpers bound to this document
  const tw = (s: string, font: string, fs: number, bold: boolean) => trueWidth(d, s, font, fs, bold);

  const frame = () => {
    stroke(GOLD, 1); d.rect(20, 20, A4_W - 40, A4_H - 40);
    stroke([225, 210, 160], 0.5); d.rect(25, 25, A4_W - 50, A4_H - 50);
  };

  // ───────────────────────── fallback: verified fields only ─────────────────────────
  if (!letter || letter.length < 5) {
    frame();
    ink(GREEN); d.setFont("times", "bold"); d.setFontSize(15);
    d.text("BOARD OF INTERMEDIATE AND SECONDARY EDUCATION PESHAWAR", mid, 74, { align: "center", maxWidth: W });
    stroke(GOLD, 1); d.line(mid - 50, 90, mid + 50, 90);
    ink(MUTED); d.setFont("helvetica", "normal"); d.setFontSize(10);
    d.text([session, dutyLabel].filter(Boolean).join("  -  "), mid, 108, { align: "center" });
    const rows: [string, string | undefined][] = [
      ["Name", details.name], ["Designation", details.designation], ["Address", details.institute],
      ["Center No", details.centerNo], ["Contact", formatPkMobile(details.mobile)], ["Appointed As", details.appointedAs],
    ];
    let y = 140;
    rows.filter(([, v]) => v).forEach(([k, v]) => {
      const ls: string[] = d.splitTextToSize(String(v), W - 150);
      const h = Math.max(30, ls.length * 14 + 14);
      stroke([215, 222, 216], 0.6); d.rect(M, y, W, h); d.line(M + 130, y, M + 130, y + h);
      ink(GREEN); d.setFont("helvetica", "bold"); d.setFontSize(9); d.text(k.toUpperCase(), M + 12, y + h / 2 + 3);
      ink(INK); d.setFontSize(11); d.text(ls, M + 142, y + h / 2 - (ls.length - 1) * 7 + 4);
      y += h;
    });
    save(d, details.name);
    return;
  }

  // ───────────────────────── the board's letter, verbatim ─────────────────────────
  const rows: LetterRow[] = groupRows(letter);

  type Word = { t: string; b: boolean; u: boolean };
  const wrap = (runs: { t: string; b?: 1; u?: 1 }[], width: number, fs: number, font: string): Word[][] => {
    const lines: Word[][] = [[]]; let x = 0;
    runs.forEach((r) => {
      const bold = !!r.b;
      const sp = tw(" ", font, fs, bold);
      r.t.split(/(\s+)/).forEach((tok) => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { if (x > 0) x += sp; return; }
        const w = tw(tok, font, fs, bold);
        if (x > 0 && x + w > width + 0.5) { lines.push([]); x = 0; }
        lines[lines.length - 1].push({ t: tok, b: bold, u: !!r.u });
        x += w;
      });
    });
    return lines.filter((l) => l.length);
  };
  type Seg = { t: string; b: boolean; u: boolean; sp: boolean };
  const toSegs = (ws: Word[]): Seg[] => {
    const segs: Seg[] = [];
    ws.forEach((w, i) => {
      const last = segs[segs.length - 1];
      if (last && last.b === w.b && last.u === w.u) last.t += " " + w.t;
      else segs.push({ t: w.t, b: w.b, u: w.u, sp: i > 0 });
    });
    return segs;
  };
  // a style change keeps its word-space: measured explicitly (never as a trailing char)
  const segW = (segs: Seg[], font: string, fs: number) =>
    segs.reduce((a, g) => a + (g.sp ? tw(" ", font, fs, g.b) : 0) + tw(g.t, font, fs, g.b), 0);

  // Table geometry: the board's own width hints (percent) set the base column
  // grid; each track is then widened to whatever its own single-track labels
  // actually need — measured across EVERY row of the table, so one row's labels
  // can never be squeezed by another row's geometry — and the total is
  // normalised back to the content width.
  const widthsCache = new Map<string, number[]>();
  const trackWidths = (row: LetterRow, fs: number): number[] => {
    const tracks = Math.max(row.tracks, 1);
    const hints = Array.from({ length: tracks }, (_, i) => row.hints[i] || 0);
    const key = `${tracks}|${hints.join(",")}`;
    const hit = widthsCache.get(key);
    if (hit) return hit;

    const need = Array.from({ length: tracks }, () => 0);
    rows.forEach((r) => {
      if (Math.max(r.tracks, 1) !== tracks || r.hints.join(",") !== row.hints.join(",")) return;
      r.cells.forEach((c) => {
        if (c.span !== 1) return;
        c.lines.forEach((l) => {
          if (l.img) { need[c.g] = Math.max(need[c.g], 92); return; }
          const t = lineText(l);
          if (t.length > 34) return; // long text wraps; only compact labels pin a minimum
          need[c.g] = Math.max(need[c.g], tw(t, "helvetica", fs, (l.runs || []).some((rn) => rn.b)));
        });
      });
    });

    const hintTotal = hints.reduce((a, b) => a + b, 0);
    let base: number[];
    if (hintTotal >= 40) base = hints.map((h) => (h / 100) * W);
    else {
      const tot = need.reduce((a, b) => a + Math.max(b, 26), 0) || 1;
      base = need.map((n) => (Math.max(n, 26) / tot) * W);
    }
    base = base.map((b, i) => Math.max(b, Math.min(need[i], W * 0.48)));
    let tot = base.reduce((a, b) => a + b, 0);
    if (tot > W + 0.5) {
      // take the overflow only from tracks that have slack over their own content
      const slack = base.map((b, i) => Math.max(0, b - need[i]));
      const slackTot = slack.reduce((a, b) => a + b, 0);
      const deficit = tot - W;
      if (slackTot > deficit) base = base.map((b, i) => b - slack[i] * (deficit / slackTot));
      else base = base.map((b) => (b / tot) * W);
      tot = base.reduce((a, b) => a + b, 0);
    }
    if (tot < W - 0.5 && tot > 0) base = base.map((b) => (b / tot) * W);
    widthsCache.set(key, base);
    return base;
  };

  const layout = (fs: number, draw: boolean) => {
    widthsCache.clear();
    const top = M, bottom = A4_H - M;
    let y = top; let pages = 1;
    const ensure = (h: number) => {
      if (y + h <= bottom) return;
      if (draw) { d.addPage(); frame(); } else pages += 1;
      y = top;
    };

    rows.forEach((row, ri) => {
      const isTitle = ri === 0;
      const rfs = isTitle ? Math.min(fs + 2.5, 13.5) : fs;
      const font = isTitle ? "times" : "helvetica";
      const lh = rfs * 1.4;

      // cell geometry on the grid (colspan-aware)
      const full = row.cells.length === 1 && row.cells[0].g === 0 && row.cells[0].span >= row.tracks;
      const twd = full ? null : trackWidths(row, fs);
      const geo = row.cells.map((c) => {
        if (full) return { x: M, w: W };
        const w = (twd as number[]).slice(c.g, c.g + c.span).reduce((a, b) => a + b, 0);
        const x = M + (twd as number[]).slice(0, c.g).reduce((a, b) => a + b, 0);
        return { x, w };
      });

      // wrap every line inside its cell
      const built = row.cells.map((c, i) => {
        const avail = Math.max(geo[i].w - (i < row.cells.length - 1 ? 10 : 2), 24);
        const items = c.lines.map((l) => {
          if (l.img) return { kind: "img" as const, l, h: 30 };
          const ws = wrap(l.runs || [], avail, rfs, font);
          return { kind: "txt" as const, l, ws, h: ws.length * lh };
        });
        return { items, h: items.reduce((a, it) => a + it.h, 0) };
      });
      const h = Math.max(...built.map((b) => b.h), 0);

      const onlyDashes = row.cells.length === 1 && /^[-–—_=\s]{12,}$/.test(lineText(row.cells[0].lines[0] || ({} as LetterLine)));
      const headTxt = lineText((row.cells[0]?.lines[0] || {}) as LetterLine).trim();
      const isListItem = row.cells.length >= 2 && /^\d{1,2}\.$/.test(headTxt);
      const gap = onlyDashes ? 2 : isListItem ? fs * 0.28 : isTitle ? 7 : fs * 0.4;

      ensure(onlyDashes ? lh : h + gap);

      if (draw) {
        if (onlyDashes) {
          stroke([186, 186, 186], 0.7); d.setLineDashPattern([3, 3], 0);
          d.line(M, y + lh / 2, M + W, y + lh / 2); d.setLineDashPattern([], 0);
        } else {
          built.forEach((b, i) => {
            let yy = y;
            b.items.forEach((it) => {
              if (it.kind === "img") {
                try {
                  const p = d.getImageProperties(it.l.img!);
                  const ih = 28, iw = Math.min(geo[i].w - 6, (p.width / p.height) * ih);
                  const ix = it.l.center ? geo[i].x + (geo[i].w - iw) / 2 : geo[i].x;
                  d.addImage(it.l.img!, p.fileType, ix, yy + 1, iw, ih);
                } catch { /* unreadable image → skipped, never replaced */ }
                yy += it.h; return;
              }
              it.ws.forEach((ws) => {
                const segs = toSegs(ws);
                const lw = segW(segs, font, rfs);
                const align = it.l.center ? "center" : it.l.right ? "right" : isTitle ? "center" : "left";
                let x = align === "center" ? geo[i].x + (geo[i].w - lw) / 2 : align === "right" ? geo[i].x + geo[i].w - lw : geo[i].x;
                const base = yy + rfs;
                segs.forEach((g) => {
                  d.setFont(font, g.b ? "bold" : "normal"); d.setFontSize(rfs);
                  if (g.sp) x += tw(" ", font, rfs, g.b);
                  ink(isTitle ? GREEN : INK);
                  d.text(g.t, x, base);
                  const gw = tw(g.t, font, rfs, g.b);
                  if (g.u) { stroke(isTitle ? GREEN : INK, 0.6); d.line(x, base + 1.7, x + gw, base + 1.7); }
                  x += gw;
                });
                yy += lh;
              });
            });
          });
          // the board's own boxed slogan keeps its box
          if (full && row.cells[0].lines.some((l) => l.box)) {
            stroke(GREEN, 0.9);
            d.rect(M - 6, y - 3, W + 12, h + 6);
          }
        }
        if (isTitle) { stroke(GOLD, 1.1); d.line(mid - 60, y + h + 4, mid + 60, y + h + 4); }
      }
      y += (onlyDashes ? lh : h) + gap;
    });
    return { y, pages };
  };

  // largest size that keeps the whole letter on a single A4 page; never below
  // 7.75 pt (the board's own letter prints at a comparable density) — truly long
  // letters flow onto a second framed page at a readable size instead of turning
  // microscopic.
  let fs = 10.5;
  let fits = false;
  for (; fs >= 7.75; fs -= 0.25) { if (layout(fs, false).pages === 1) { fits = true; break; } }
  if (!fits) fs = 9.5;
  frame();
  layout(fs, true);
  save(d, details.name);
}

function save(d: import("jspdf").jsPDF, name?: string) {
  const safe = (name || "Duty").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  d.save(`Duty-Order-${safe || "Staff"}.pdf`);
}
