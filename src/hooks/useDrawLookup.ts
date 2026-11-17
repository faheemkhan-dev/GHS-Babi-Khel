// src/hooks/useDrawLookup.ts — BISE Peshawar Exam Duties (Supervisory Draw)
// Talks to /api/bisep-draw (served by api/public-data.js?kind=draw).
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LetterLine } from "@/lib/letterModel";

export interface DrawSource { id: string; label: string; session: string; official_page?: string }
export interface DrawDetails {
  centerNo?: string; name?: string; designation?: string;
  institute?: string; mobile?: string; appointedAs?: string;
}
export interface DrawResult {
  ok: boolean; error?: string; detail?: string;
  selected?: boolean; details?: DrawDetails;
  letterDoc?: LetterLine[]; letterRef?: string;
  session?: string; source?: string;
  fetched_at?: string; cached?: boolean;
}
export interface DrawPreviewEntry extends DrawDetails { letter?: string }
export type { LetterLine };
export interface DrawPreview {
  ok: boolean; entries?: DrawPreviewEntry[]; fetched_at?: string;
  official_page?: string; error?: string;
}

// Used instantly (no network) and as fallback if the sources call fails.
// The session title shown on the page is fetched LIVE from BISE Peshawar by
// the API (which auto-discovers the latest published draw from the board's own
// homepage — see api/_lib/bisep-draw-core.js); this offline fallback stays
// generic so it can never show a stale or invented exam session, and the
// official_page link points at the board's homepage (always reachable) rather
// than any specific draw dir (which the board removes once the cycle closes).
export const FALLBACK_SOURCES: DrawSource[] = [
  { id: "theory", label: "Theory Duties", session: "BISE Peshawar", official_page: "https://bisep.edu.pk/" },
];

async function getJson<T>(qs: string, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`/api/bisep-draw?${qs}`, { signal: ctl.signal });
    return (await r.json()) as T;
  } finally { clearTimeout(t); }
}

export function useDrawSources() {
  return useQuery({
    queryKey: ["draw-sources"],
    queryFn: async () => {
      const j = await getJson<{ ok: boolean; sources: DrawSource[] }>("mode=sources", 8000);
      return j.ok && j.sources?.length ? j.sources : FALLBACK_SOURCES;
    },
    initialData: FALLBACK_SOURCES,
    // The fallback above is only a placeholder — mark it as always-stale so the
    // REAL session title is fetched live from BISE Peshawar on every fresh visit
    // instead of waiting out the staleTime window.
    initialDataUpdatedAt: 0,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useDrawLookup() {
  return useMutation({
    mutationFn: async (p: { source: string; by: "cnic" | "mobile"; value: string }) => {
      const qs = new URLSearchParams({ source: p.source, by: p.by, value: p.value }).toString();
      let res = await getJson<DrawResult>(qs);
      // one gentle retry if the board was busy (matches the rest of the site)
      if (!res.ok && res.detail) {
        await new Promise((r) => setTimeout(r, 900));
        res = await getJson<DrawResult>(qs);
      }
      // the board's own letter, if the first call ran out of time to fetch it
      if (res.ok && res.selected && !res.letterDoc && res.letterRef) {
        const lr = await getJson<{ ok: boolean; letterDoc?: LetterLine[] }>(`mode=letter&ref=${encodeURIComponent(res.letterRef)}`);
        if (lr.ok && lr.letterDoc) res = { ...res, letterDoc: lr.letterDoc };
      }
      return res;
    },
  });
}

export function useDrawPreview(source: string) {
  return useQuery({
    queryKey: ["draw-preview", source],
    queryFn: () => getJson<DrawPreview>(`mode=preview&source=${encodeURIComponent(source)}`),
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

/** Board sends 3459162160 (leading 0 dropped) → 0345 9162160. Safe on already-correct values. */
export function formatPkMobile(m?: string): string {
  if (!m) return "";
  let d = m.replace(/\D/g, "");
  if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d[0] === "3") d = "0" + d;
  return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4)}` : m;
}
