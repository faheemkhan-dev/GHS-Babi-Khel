// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUBJECT THEME ENGINE — turns ANY admin-chosen color into a professional tone
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Subject colors are admin-editable and can be anything (pure neon yellow,
// hot magenta…). Using them raw as full card backgrounds is what made the
// Notes section look garish. This engine:
//   1. Keeps the admin's HUE (subject identity) but clamps saturation and
//      lightness into a refined, print-quality range — neon becomes elegant.
//   2. Derives gradients, soft tints, borders and glows that always pair
//      well with the site's "Solar Cream" design system.
// Every helper is defensive: invalid/missing colors fall back to tangerine.

export interface Hsl { h: number; s: number; l: number }

/** Convert hex (#rgb or #rrggbb) to HSL. Returns tangerine default on bad input. */
export function hexToHsl(hex: string | undefined | null): Hsl {
  const fallback: Hsl = { h: 22, s: 0.80, l: 0.42 };
  if (!hex) return fallback;
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean.split("").map(c => c + c).join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l }; // achromatic — keep gray, clamp later

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s, l };
}

/** Convert HSL back to hex. */
export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));

  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60)       { r = c; g = x; }
  else if (hue < 120) { r = x; g = c; }
  else if (hue < 180) { g = c; b = x; }
  else if (hue < 240) { g = x; b = c; }
  else if (hue < 300) { r = x; b = c; }
  else                { r = c; b = x; }

  const toHex = (v: number) => {
    const hex = Math.round((v + m) * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Refined ranges — the sweet spot used by polished education products.
// Saturation 55–78%: vivid enough to feel alive, never neon.
// Lightness  34–52%: rich enough for white text, never muddy, never glaring.
const SAT_MIN = 0.55, SAT_MAX = 0.78;
const LIG_MAX = 0.52, LIG_SWEET = 0.44;

// Hue harmonization: pure yellows (50–72°) darken into muddy olive, so they
// are nudged toward warm amber-orange — which also ties them to the site's
// honey-tangerine accent. Similarly, yellow-greens (72–95°) are pulled toward
// leaf green so they don't read as "army". Everything else keeps its hue untouched.
function harmonizeHue(h: number): number {
  if (h >= 50 && h <= 72) return 39 - (h - 50) * 0.14;  // 50–72° → ~39–36° (amber-orange)
  if (h > 72 && h < 95)  return 78 - (h - 72) * 0.35;   // 72–95° → leaf green
  return h;
}

/**
 * The heart of the engine: keep the hue, tame the chrome.
 * Pure yellow #ffff00 → rich amber. Hot magenta #ff00ff → elegant orchid.
 */
export function refineSubjectColor(hex: string | undefined | null): string {
  const { h, s, l } = hexToHsl(hex);
  if (s === 0) return hslToHex({ h, s: 0.12, l: 0.42 }); // tasteful slate for grays
  const h2 = harmonizeHue(h);
  const s2 = Math.min(SAT_MAX, Math.max(SAT_MIN, s));
  const l2 = Math.min(LIG_MAX, Math.max(0.3, l < LIG_SWEET ? l : LIG_SWEET));
  return hslToHex({ h: h2, s: s2, l: l2 });
}

/** Professional 135° gradient: refined tone flowing into a deeper shade. */
export function getSubjectGradient(hex: string | undefined | null): string {
  const base = hexToHsl(refineSubjectColor(hex));
  const deep = hslToHex({ h: base.h, s: Math.min(0.72, base.s), l: 0.26 });
  return `linear-gradient(135deg, ${hslToHex(base)} 0%, ${deep} 100%)`;
}

/** Soft wash (default 12% alpha) for card backgrounds / badges. */
export function getSubjectTint(hex: string | undefined | null, alpha = 0.12): string {
  const { h, s, l } = hexToHsl(refineSubjectColor(hex));
  const soft = hslToHex({ h, s: Math.min(0.7, s), l: Math.max(0.42, Math.min(0.5, l)) });
  const r = parseInt(soft.slice(1, 3), 16);
  const g = parseInt(soft.slice(3, 5), 16);
  const b = parseInt(soft.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Slightly deeper tint for hover states / borders. */
export function getSubjectTintDeep(hex: string | undefined | null, alpha = 0.2): string {
  const { h, s } = hexToHsl(refineSubjectColor(hex));
  const deeper = hslToHex({ h, s: Math.min(0.72, s), l: 0.36 });
  const r = parseInt(deeper.slice(1, 3), 16);
  const g = parseInt(deeper.slice(3, 5), 16);
  const b = parseInt(deeper.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Solid refined color — safe for filled chips/buttons with white text. */
export function getSubjectSolid(hex: string | undefined | null): string {
  return refineSubjectColor(hex);
}
