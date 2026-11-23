// src/hooks/useLiveFaq.ts — the LIVE FAQ for the React app.
//
// The questions and answers are generated on the server (api/render.js →
// src/data/faqData.mjs → GET /api/faq) from the school's own database:
// admission status/fee/seats/merit lists, grading scheme, published exams,
// staff, notices and admin-written entries. The /faq page and the FAQPage
// JSON-LD both read this hook, so humans, Google and AI tools see IDENTICAL
// text. If /api/faq is unreachable (offline, `vite dev` without Vercel
// functions) the hook falls back to the build-time "no live data" rendering
// (FAQ_ITEMS) — which never states a fee, date, status or number.

import { useQuery } from "@tanstack/react-query";
import { FAQ_ITEMS, FAQ_CATEGORIES, type FaqItem } from "../data/faqData.mjs";

export interface LiveFaq {
  items: FaqItem[];
  categories: string[];
  /** true when the answers came from /api/faq, false for the offline fallback */
  live: boolean;
  generatedAt: string | null;
}

const FALLBACK: LiveFaq = {
  items: FAQ_ITEMS,
  categories: FAQ_CATEGORIES,
  live: false,
  generatedAt: null,
};

async function fetchLiveFaq(): Promise<LiveFaq> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("/api/faq", {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`faq ${res.status}`);
    const json = await res.json();
    const items: FaqItem[] = Array.isArray(json?.items)
      ? json.items.filter(
          (i: FaqItem) => i && typeof i.question === "string" && typeof i.answer === "string"
        )
      : [];
    if (!items.length) throw new Error("faq empty");
    const categories: string[] =
      Array.isArray(json.categories) && json.categories.length
        ? json.categories
        : FAQ_CATEGORIES;
    return { items, categories, live: true, generatedAt: json.generated_at ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/** `enabled` lets the SEO injector fetch only on /faq and /admission. */
export function useLiveFaq(enabled = true): LiveFaq {
  const { data } = useQuery({
    queryKey: ["live-faq"],
    queryFn: fetchLiveFaq,
    enabled,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  return data ?? FALLBACK;
}
