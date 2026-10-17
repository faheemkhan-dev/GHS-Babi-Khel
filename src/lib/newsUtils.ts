/**
 * newsUtils — small shared helpers for the News feature.
 * Kept dependency-free so they're cheap to import anywhere (cards, detail page, TTS).
 */

/** Detects whether a string is primarily Urdu/Arabic-script vs Latin-script English. */
export function detectTextLanguage(text: string): "ur" | "en" {
  if (!text) return "en";
  const arabicScript = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  const latinLetters = (text.match(/[A-Za-z]/g) || []).length;
  return arabicScript > latinLetters ? "ur" : "en";
}

/** Rough reading time estimate, aware of Urdu (slightly slower avg WPM for on-screen reading). */
export function estimateReadingTime(text: string | null | undefined): string {
  if (!text) return "1 min read";
  const lang = detectTextLanguage(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wpm = lang === "ur" ? 160 : 200;
  const minutes = Math.max(1, Math.round(words / wpm));
  return `${minutes} min read`;
}
