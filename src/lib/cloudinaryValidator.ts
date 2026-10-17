// src/lib/cloudinaryValidator.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cloudinary URL Validator & Fixer
// ─────────────────────────────────────────────────────────────────────────────
// Validates Cloudinary URLs and attempts to fix common issues:
// 1. HTTP vs HTTPS mismatch
// 2. Missing cloud name
// 3. Malformed upload paths
// 4. Invalid transformation parameters
// 5. Detects if Cloudinary service is reachable
//
// This utility prevents broken image URLs from reaching <img> tags,
// which causes the "FK" / initials fallback issue you're seeing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid Cloudinary URL patterns:
 * - https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}
 * - https://res.cloudinary.com/{cloud_name}/video/upload/{public_id}
 * - https://res.cloudinary.com/{cloud_name}/auto/upload/{public_id}
 */
const CLOUDINARY_URL_PATTERN = /^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|auto|raw)\/upload\/(.+)$/i;

/**
 * Check if a URL is a valid Cloudinary URL format
 */
export function isValidCloudinaryUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  
  try {
    // Must be a valid URL
    const urlObj = new URL(url);
    
    // Must be res.cloudinary.com domain
    if (urlObj.hostname !== 'res.cloudinary.com') {
      return false;
    }
    
    // Must have the correct path structure: /{cloud_name}/{resource_type}/upload/...
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length < 4) { // minimum: cloud_name, resource_type, upload, public_id
      return false;
    }
    
    const [cloudName, resourceType, uploadSegment] = pathParts;
    
    // Validate segments
    if (!cloudName || cloudName.length < 3) return false;
    if (!['image', 'video', 'auto', 'raw'].includes(resourceType)) return false;
    if (uploadSegment !== 'upload') return false;
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to fix common Cloudinary URL issues
 */
export function fixCloudinaryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  // Trim whitespace
  url = url.trim();
  
  // Empty after trim
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    
    // Fix 1: Force HTTPS (HTTP is often blocked by mixed content)
    if (urlObj.protocol === 'http:') {
      urlObj.protocol = 'https:';
    }
    
    // Fix 2: Auto-remediate API/wrong domains → res.cloudinary.com delivery domain
    // Previously this returned null, which silently killed valid URLs stored in the DB
    // (e.g. if an api.cloudinary.com URL was saved, or Cloudinary changed its response format).
    // The path structure is identical — only the hostname differs.
    if (urlObj.hostname === 'api.cloudinary.com' ||
        urlObj.hostname === 'cloudinary.com' || 
        urlObj.hostname === 'www.cloudinary.com') {
      console.warn('[Cloudinary] Auto-fixing API domain to delivery domain:', urlObj.hostname, '→ res.cloudinary.com');
      urlObj.hostname = 'res.cloudinary.com';
      // Continue with the fixed URL — do NOT return null
    }
    
    // Fix 3: Remove any trailing slashes that might break the path
    urlObj.pathname = urlObj.pathname.replace(/\/+$/, '');
    
    // Fix 4: Ensure path starts with /
    if (!urlObj.pathname.startsWith('/')) {
      urlObj.pathname = '/' + urlObj.pathname;
    }
    
    const fixedUrl = urlObj.toString();
    
    // Validate the fixed URL
    if (isValidCloudinaryUrl(fixedUrl)) {
      return fixedUrl;
    } else {
      console.warn('[Cloudinary] URL could not be validated even after fixing:', { original: url, fixed: fixedUrl });
      return null;
    }
  } catch (e) {
    console.warn('[Cloudinary] Invalid URL format:', url, e);
    return null;
  }
}

/**
 * Extract the cloud name from a Cloudinary URL (useful for debugging)
 */
export function extractCloudName(url: string): string | null {
  if (!isValidCloudinaryUrl(url)) return null;
  
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    return pathParts[0] || null; // First segment is cloud name
  } catch {
    return null;
  }
}

/**
 * Extract the public ID from a Cloudinary URL (useful for debugging)
 */
export function extractPublicId(url: string): string | null {
  if (!isValidCloudinaryUrl(url)) return null;
  
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    // Path: /{cloud_name}/{resource_type}/upload/[{transformations}/]{public_id}
    // We need everything after "upload/"
    const uploadIndex = pathParts.indexOf('upload');
    if (uploadIndex === -1 || uploadIndex >= pathParts.length - 1) return null;
    
    return pathParts.slice(uploadIndex + 1).join('/') || null;
  } catch {
    return null;
  }
}

/**
 * Check if a URL has transformation parameters already applied
 */
export function hasTransformations(url: string): boolean {
  if (!isValidCloudinaryUrl(url)) return false;
  
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    const uploadIndex = pathParts.indexOf('upload');
    
    if (uploadIndex === -1) return false;
    
    // Check if the segment right after "upload" looks like transformations
    // Transformations are comma-separated parameters like: f_auto,q_auto,w_1600
    const afterUpload = pathParts[uploadIndex + 1];
    if (!afterUpload) return false;
    
    // Common transformation prefixes
    const transformPatterns = [/^f_/, /^q_/, /^w_/, /^h_/, /^c_/, /^fl_/, /^e_/];
    return transformPatterns.some(pattern => pattern.test(afterUpload));
  } catch {
    return false;
  }
}

/**
 * Safe wrapper for Cloudinary URLs - returns null for invalid URLs
 * Use this instead of passing raw database values to img tags
 */
export function safeCloudinaryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  
  // Try to fix the URL first
  const fixed = fixCloudinaryUrl(url);
  if (fixed) return fixed;
  
  // If fixing failed, return null to trigger fallback UI
  return null;
}

/**
 * Test if Cloudinary is reachable (for diagnostics)
 */
export async function testCloudinaryConnectivity(cloudName?: string): Promise<{
  reachable: boolean;
  latency?: number;
  error?: string;
}> {
  const testCloudName = cloudName || 'test';
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(
      `https://res.cloudinary.com/${testCloudName}/image/upload/w_1,h_1/blank.png`,
      { 
        method: 'HEAD',
        signal: controller.signal,
        mode: 'no-cors' // Avoid CORS issues for connectivity test
      }
    );
    
    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;
    
    // With no-cors, we can't read the status, but if we get here, DNS worked
    return { reachable: true, latency };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return { 
      reachable: false, 
      latency,
      error: errorMessage 
    };
  }
}

/**
 * Debug helper - logs detailed info about a Cloudinary URL
 * Call this in browser console to diagnose issues
 */
export function debugCloudinaryUrl(url: string | null | undefined): void {
  console.group('[Cloudinary Debug]');
  console.log('Original URL:', url);
  console.log('Is Valid:', isValidCloudinaryUrl(url));
  console.log('Fixed URL:', fixCloudinaryUrl(url));
  console.log('Cloud Name:', extractCloudName(url || undefined));
  console.log('Public ID:', extractPublicId(url || undefined));
  console.log('Has Transformations:', hasTransformations(url || ''));
  console.groupEnd();
}

// Export types
export interface CloudinaryDiagnosticInfo {
  originalUrl: string | null | undefined;
  isValid: boolean;
  fixedUrl: string | null;
  cloudName: string | null;
  publicId: string | null;
  hasTransformations: boolean;
}
