/**
 * Type declarations for the canonical FAQ dataset (src/data/faqData.mjs).
 * The .mjs file is plain ESM JavaScript so that BOTH the Vite frontend
 * (src/pages/FAQ.tsx, RouteSEOInjector) and the Vercel serverless functions
 * (api/render.js, scripts/seo-page-content.mjs) can share ONE source of
 * truth — no duplicated FAQ content that can drift apart.
 *
 * Lives in src/data/ next to the data file so the frontend build never
 * depends on the api/ folder (which is managed as Vercel Serverless
 * Functions and must stay free of frontend dependencies).
 */
export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

export declare const FAQ_ITEMS: FaqItem[];
export declare const FAQ_CATEGORIES: string[];
export declare function buildFaqJsonLd(): Record<string, unknown>;
