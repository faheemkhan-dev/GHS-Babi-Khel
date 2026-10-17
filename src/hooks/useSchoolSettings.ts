import { useQuery } from "@tanstack/react-query";
import { supabase, supabasePublic } from "@/lib/supabase";
import { safeCloudinaryUrl, isValidCloudinaryUrl, fixCloudinaryUrl } from "@/lib/cloudinaryValidator";

export interface SchoolSettings {
  id: number;
  school_name: string;
  tagline: string;
  description: string | null;
  about_text: string | null;
  logo_url: string | null;
  banner_url: string | null;
  emis_code: string;
  address: string;
  phone: string | null;
  email: string | null;
  established_year: number;
  total_students: number;
  total_teachers: number;
  pass_percentage: number;
  board_results: string | null;
  location_lat: number | null;
  location_lng: number | null;
  principal_name: string | null;
  principal_message: string | null;
  principal_photo_url: string | null;
}

export const fallbackSettings: SchoolSettings = {
  id: 1,
  school_name: "GHS Babi Khel",
  tagline: "Excellence in Education",
  description:
    "Government High School Babi Khel is committed to providing quality education and nurturing the future leaders of Pakistan.",
  about_text: null,
  logo_url: null,
  banner_url: null,
  emis_code: "60673",
  address: "Babi Khel, District Mohmand, KPK, Pakistan",
  phone: null,
  email: "ghsbabikhel@gmail.com",
  established_year: 2018,
  // ⚠ KEEP ALIGNED WITH THE ADMIN DASHBOARD (school_settings id=1).
  // These are only shown BEFORE Supabase responds (or if it fails) — but
  // JS-running AI tools (ChatGPT browser, Copilot, screenshot bots) extract
  // exactly this state, so stale numbers here are what AI quotes.
  // Last synced with dashboard: 180 students · 8 teachers · 95% pass rate.
  total_students: 180,
  total_teachers: 8,
  pass_percentage: 95,
  board_results: "A+",
  location_lat: 34.4084,
  location_lng: 71.3707,
  principal_name: null,
  principal_message: null,
  principal_photo_url: null,
};

export function safeMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  // Force HTTPS
  const safeUrl = url.replace(/^http:\/\//i, "https://");
  
  // If this looks like a Cloudinary URL, validate it
  if (safeUrl.includes("cloudinary.com")) {
    const validated = safeCloudinaryUrl(safeUrl);
    if (!validated) {
      if (import.meta.env.DEV) {
        console.warn('[useSchoolSettings] Invalid Cloudinary URL detected and removed:', {
          original: url,
          reason: 'URL failed validation'
        });
      }
      return null; // Return null to trigger fallback UI instead of broken image
    }
    return validated;
  }
  
  return safeUrl;
}

// ─── Cloudinary delivery-time optimization ─────────────────────────────────
// Uploads are already compressed client-side (see src/lib/cloudinary.ts), but
// the ORIGINAL uploaded resolution (up to 1920px, ~1.5MB) is what gets served
// to every visitor today — full desktop res even on a small mobile hero
// banner. Cloudinary supports on-the-fly delivery transforms via URL segments
// inserted right after "/upload/": f_auto (serve WebP/AVIF automatically when
// the browser supports it), q_auto (automatic quality/compression), and
// w_<px> (resize server-side, so mobile never downloads more pixels than it
// can show). This is purely a URL rewrite — it doesn't touch the stored
// original, doesn't change any upload behavior, and if the URL isn't a
// Cloudinary URL it's returned unchanged so nothing else breaks.
export function optimizedCloudinaryUrl(
  url: string | null | undefined,
  opts: { width?: number; quality?: string } = {}
): string | null {
  // First validate/sanitize the URL using our robust validator
  const safe = safeMediaUrl(url);
  if (!safe) return null;
  
  // Double-check it's actually valid before applying transformations
  if (!isValidCloudinaryUrl(safe)) {
    // Not a Cloudinary URL or invalid format - return as-is (might be a different CDN)
    return safe.includes('http') ? safe : null;
  }
  
  if (!safe.includes("res.cloudinary.com") || !safe.includes("/upload/")) return safe;

  const { width, quality = "auto" } = opts;
  // Already has a transform segment right after /upload/ — don't double-insert.
  if (/\/upload\/(f_auto|q_auto|w_\d+)/i.test(safe)) return safe;

  const transforms = ["f_auto", `q_${quality}`, width ? `w_${width}` : null]
    .filter(Boolean)
    .join(",");

  const optimized = safe.replace("/upload/", `/upload/${transforms}/`);
  
  // Validate the optimized URL too
  if (isValidCloudinaryUrl(optimized)) {
    return optimized;
  }

  // If optimization broke something, return the original safe URL
  if (import.meta.env.DEV) {
    console.warn('[useSchoolSettings] URL optimization produced invalid URL, using original:', {
      original: safe,
      optimized
    });
  }
  return safe;
}

// Persistent cache key — survives sign-in/sign-out, page reloads, and
// browser tab restarts. This is the fix for the "logo & banner disappear
// after sign-in/sign-out on mobile Chrome" bug: even if Supabase fetch
// fails or is slow during an auth state change, we still have the last
// known good settings on disk so the UI never shows the empty fallback.
// Keep the same cache key as before — changing it wipes every browser's
// cached logo/banner URLs and causes them to disappear until Supabase refetches.
const CACHE_KEY = "ghs-school-settings-v1";

function readCache(): SchoolSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "school_name" in parsed) {
      return parsed as SchoolSettings;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(s: SchoolSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

async function fetchSettings(client: typeof supabase) {
  const { data, error } = await client
    .from("school_settings")
    .select(
      "id, school_name, tagline, description, about_text, logo_url, banner_url, emis_code, address, phone, email, established_year, total_students, total_teachers, pass_percentage, board_results, location_lat, location_lng, principal_name, principal_message, principal_photo_url"
    )
    .eq("id", 1)
    .single();

  if (error) throw error;

  // Validate URLs for rendering (safeMediaUrl may return null for broken URLs)
  const validated = {
    ...data,
    logo_url: safeMediaUrl(data.logo_url),
    banner_url: safeMediaUrl(data.banner_url),
    principal_photo_url: safeMediaUrl(data.principal_photo_url),
  } as SchoolSettings;

  // IMPORTANT: Cache the RAW data (before safeMediaUrl nullification).
  // Previously, null URLs from validation were written to localStorage, permanently
  // suppressing valid URLs. Now we cache the raw DB values so that even if
  // safeMediaUrl temporarily rejects a URL (e.g. during a network glitch),
  // the cache still has the real value for the next read.
  if (data) {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* ignore quota */ }
  }

  return validated;
}

export function useSchoolSettings() {
  return useQuery<SchoolSettings>({
    queryKey: ["school-settings"],
    queryFn: async () => {
      // Attempt 1: public client (no auth — immune to refresh-token issues)
      try {
        const fresh = await fetchSettings(supabasePublic);
        // fetchSettings now caches raw data internally — no need for writeCache here
        return fresh;
      } catch (publicErr) {
        if (import.meta.env.DEV) console.warn("[useSchoolSettings] Public client failed:", publicErr);
      }

      // Attempt 2: authenticated client
      try {
        const fresh = await fetchSettings(supabase);
        return fresh;
      } catch (authErr) {
        if (import.meta.env.DEV) console.warn("[useSchoolSettings] Authenticated client failed:", authErr);
      }

      // Both fetches failed: return last known good settings from
      // localStorage so logo/banner stay visible. If nothing cached yet,
      // fall back to the safe defaults.
      const cached = readCache();
      return cached ?? fallbackSettings;
    },
    // Hydrate immediately from localStorage so logo/banner render on the
    // very first paint — even before Supabase responds. This is what
    // makes sign-in / sign-out smooth on mobile Chrome.
    initialData: () => readCache() ?? undefined,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Keep showing previous data while refetching — never blank out.
    placeholderData: (previousData) => previousData ?? readCache() ?? fallbackSettings,
  });
}

