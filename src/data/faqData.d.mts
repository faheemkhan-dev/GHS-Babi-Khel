/**
 * Type declarations for the LIVE FAQ engine (src/data/faqData.mjs).
 * Plain ESM so the Vite frontend, the Vercel serverless functions and the
 * build scripts all share ONE generator — the FAQ can never drift between
 * the /faq page, the FAQPage JSON-LD, crawler HTML, /api/faq, /api/ai-data,
 * /llms.txt, /llms-full.txt and the Markdown pages.
 */
export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

/** Live context handed to the generator (built from Supabase by api/render.js). */
export interface FaqLiveContext {
  school?: {
    name?: string | null;
    full_name?: string | null;
    location?: string | null;
    established?: string | number | null;
    emis_code?: string | number | null;
    principal?: string | null;
    phone?: string | null;
    email?: string | null;
    board?: string | null;
    classes_offered?: string[] | null;
    total_students?: number | null;
    total_teachers?: number | null;
    pass_percentage?: number | null;
  };
  admission?: {
    currently_open?: boolean | null;
    session_year?: string | null;
    open_date?: string | null;
    last_date?: string | null;
    banner_message?: string | null;
    processing_fee?: number | null;
    payment_methods?: Array<{ type?: string; bank_name?: string; label?: string }>;
    contact_whatsapp?: string | null;
  };
  classes?: Array<{ class: string; seats: number; is_open: boolean }> | null;
  admissionMerit?: Array<{
    class?: string;
    list_no?: number;
    title?: string;
    published_at?: string | null;
    listed_count?: number;
  }>;
  grading?: {
    name?: string | null;
    pass_threshold?: number;
    ranges: Array<{ min_percentage: number; max_percentage: number; grade: string; gpa?: number }>;
  } | null;
  exams?: Array<{ exam: string; year?: number | string | null; class?: string | null }>;
  bisep?: { exam_title?: string; is_live?: boolean; countdown_date?: string | null } | null;
  schoolMerit?: Array<{ title: string; total_students?: number | null; passing_count?: number | null }>;
  rollSlips?: Array<{ title?: string; status?: string; publish_at?: string | null }>;
  teacherCount?: number | null;
  teacherSubjects?: string[];
  noticeCount?: number | null;
  latestNotice?: { title?: string; published_at?: string | null } | null;
  customFaqs?: Array<{ id?: string; category?: string; question: string; answer: string }>;
  generated_at?: string | null;
}

export declare const FAQ_CATEGORIES: string[];
/** Build-time / no-live-data rendering — never states a changing fact. */
export declare const FAQ_ITEMS: FaqItem[];
export declare function buildFaqItems(live?: FaqLiveContext | null): FaqItem[];
export declare function normalizeFaqLive(raw: unknown): FaqLiveContext | null;
export declare function buildFaqJsonLd(items?: FaqItem[]): Record<string, unknown>;
