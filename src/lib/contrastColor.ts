// Subject colors are admin-editable and stored as hex strings (e.g. the
// bright yellow used for English). White text, which the subject/chapter
// cards used unconditionally, is unreadable on light colors like yellow.
// This picks black or white text based on the background's relative
// luminance so every subject color — current and future — stays readable.

/**
 * Returns "#111827" (near-black) for light backgrounds or "#ffffff" for
 * dark backgrounds, using the WCAG relative luminance formula.
 * Falls back to white if the input isn't a valid hex color.
 */
export function getReadableTextColor(hex: string | undefined | null): string {
  if (!hex) return "#ffffff";
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean.split("").map(c => c + c).join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

  // Threshold ~0.5 (rather than the stricter WCAG 0.179) since these are
  // large, bold display text on solid/gradient fills, not small body text.
  return luminance > 0.5 ? "#111827" : "#ffffff";
}

/** Same idea, but returns a translucent variant for secondary text/badges. */
export function getReadableTextColorMuted(hex: string | undefined | null): string {
  const base = getReadableTextColor(hex);
  return base === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(17,24,39,0.75)";
}
