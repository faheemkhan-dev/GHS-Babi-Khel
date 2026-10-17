// lib/rateLimiter.ts
// SECURITY FIX: Problem 23 - Advanced Rate Limiting System
// Multi-layer rate limiting with IP tracking, user identification, and adaptive throttling

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
  lastRequest: number;
  blocked: boolean;
  blockExpiry?: number;
}

interface RateLimitConfig {
  windowMs: number;        // Time window in milliseconds
  maxRequests: number;     // Max requests per window
  blockDuration?: number;  // How long to block if limit exceeded (ms)
  skipSuccessfulRequests?: boolean; // Only count failed requests
  keyGenerator?: (request: Request) => string; // Custom key generator
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  limit: number;
}

// In-memory store for edge runtime compatibility
// For production with multiple instances, use Redis or similar
class RateLimiterStore {
  private store = new Map<string, RateLimitEntry>();
  
  get(key: string): RateLimitEntry | undefined {
    return this.store.get(key);
  }
  
  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
    
    // Auto-cleanup after reset time + buffer
    setTimeout(() => {
      const current = this.store.get(key);
      if (current && Date.now() > current.resetTime + 60000) {
        this.store.delete(key);
      }
    }, entry.resetTime - Date.now() + 60000);
  }
  
  delete(key: string): void {
    this.store.delete(key);
  }
  
  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime && (!entry.blocked || now > (entry.blockExpiry || 0))) {
        this.store.delete(key);
      }
    }
  }
  
  get size(): number {
    return this.store.size;
  }

  // Read-only view of the store keys — lets monitoring code iterate the
  // tracked buckets without being able to mutate the underlying Map.
  snapshot(): ReadonlyMap<string, RateLimitEntry> {
    return this.store;
  }
}

// Global store instance
const globalStore = new RateLimiterStore();

// Predefined rate limit configurations
export const RATE_LIMITS = {
  // Global default
  default: {
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 100,
    blockDuration: 5 * 60 * 1000, // 5 minutes block
  },
  
  // Authentication endpoints - very strict
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    blockDuration: 15 * 60 * 1000, // 15 minutes block
  },
  
  // Login specifically - extra strict
  login: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 5,
    blockDuration: 30 * 60 * 1000, // 30 minutes block after 5 failed attempts
  },
  
  // Signup/Registration - prevent automated account creation
  signup: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,           // Only 3 signup attempts per hour per IP
    blockDuration: 24 * 60 * 60 * 1000, // 24 hour block!
  },
  
  // Contact form - prevent spam
  contact: {
    windowMs: 60 * 1000,      // 1 minute
    maxRequests: 2,            // Only 2 messages per minute
    blockDuration: 15 * 60 * 1000,
  },
  
  // Password reset - sensitive operation
  passwordReset: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 3,
    blockDuration: 60 * 60 * 1000,
  },
  
  // API calls - moderate limiting
  api: {
    windowMs: 60 * 1000,
    maxRequests: 60,
    blockDuration: 1 * 60 * 1000,
  },
  
  // Search endpoint - prevent scraping
  search: {
    windowMs: 60 * 1000,
    maxRequests: 20,
    blockDuration: 5 * 60 * 1000,
  },
} as const;

type RateLimitType = keyof typeof RATE_LIMITS;

// Extract client identifier from request
function extractClientIdentifier(request: Request): string {
  // Try multiple sources for the real IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  
  const ip = cfConnectingIp || 
              (forwardedFor ? forwardedFor.split(',')[0].trim() : null) ||
              realIp ||
              'unknown-ip';
  
  // Add user agent fingerprint (basic)
  const ua = request.headers.get('user-agent') || '';
  const uaFingerprint = ua.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '');
  
  // Combine IP + partial UA for better uniqueness
  return `${ip}:${uaFingerprint}`;
}

// Check if request is from a bot/crawler (skip rate limiting for legitimate bots)
function isLegitimateBot(userAgent: string): boolean {
  const legitimateBots = [
    'googlebot',
    'bingbot',
    'slurp',         // Yahoo
    'duckduckbot',
    'baiduspider',
    'yandexbot',
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
  ];
  
  const ua = userAgent.toLowerCase();
  return legitimateBots.some(bot => ua.includes(bot));
}

// Main rate limiter function
export function checkRateLimit(
  request: Request,
  limitType: RateLimitType = 'default',
  customConfig?: Partial<RateLimitConfig>
): RateLimitResult {
  const config = { ...RATE_LIMITS[limitType], ...customConfig };
  const now = Date.now();
  
  // Skip rate limiting for legitimate bots
  const userAgent = request.headers.get('user-agent') || '';
  if (isLegitimateBot(userAgent)) {
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetTime: now + config.windowMs,
      limit: config.maxRequests,
    };
  }
  
  // Generate unique key for this client
  const keyGenerator = config.keyGenerator || extractClientIdentifier;
  const clientId = keyGenerator(request);
  const key = `ratelimit:${limitType}:${clientId}`;
  
  // Get existing entry or create new one
  let entry = globalStore.get(key);
  
  if (!entry || now > entry.resetTime) {
    // New window
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
      firstRequest: now,
      lastRequest: now,
      blocked: false,
    };
    globalStore.set(key, entry);
    
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: entry.resetTime,
      limit: config.maxRequests,
    };
  }
  
  // Check if currently blocked
  if (entry.blocked && entry.blockExpiry && now < entry.blockExpiry) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.blockExpiry,
      retryAfter: Math.ceil((entry.blockExpiry - now) / 1000),
      limit: config.maxRequests,
    };
  }
  
  // Check if blocked but block has expired
  if (entry.blocked && entry.blockExpiry && now >= entry.blockExpiry) {
    // Reset after block expires
    entry.count = 1;
    entry.blocked = false;
    entry.blockExpiry = undefined;
    entry.resetTime = now + config.windowMs;
    entry.lastRequest = now;
    globalStore.set(key, entry);
    
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: entry.resetTime,
      limit: config.maxRequests,
    };
  }
  
  // Normal rate limit check
  if (entry.count >= config.maxRequests) {
    // Limit exceeded - apply block
    const blockDuration = config.blockDuration || config.windowMs * 2;
    entry.blocked = true;
    entry.blockExpiry = now + blockDuration;
    globalStore.set(key, entry);
    
    console.warn(`[RateLimit] ${limitType} exceeded for ${clientId}. Blocked for ${blockDuration / 1000}s`);
    
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.blockExpiry,
      retryAfter: Math.ceil(blockDuration / 1000),
      limit: config.maxRequests,
    };
  }
  
  // Increment counter
  entry.count++;
  entry.lastRequest = now;
  globalStore.set(key, entry);
  
  // Detect suspicious patterns (rapid fire requests)
  const timeSinceFirst = now - entry.firstRequest;
  const rapidFireThreshold = config.windowMs / config.maxRequests / 4; // If avg time is less than 1/4 of expected
  
  if (entry.count > 3 && (timeSinceFirst / entry.count) < rapidFireThreshold) {
    console.warn(`[RateLimit] Suspicious rapid-fire pattern detected from ${clientId}`);
    // Could trigger additional monitoring or CAPTCHA requirement
  }
  
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
    limit: config.maxRequests,
  };
}

// Create rate-limited response helper
export function createRateLimitedResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({
    error: result.allowed ? undefined : 'Too many requests. Please try again later.',
    message: result.allowed ? undefined : `Rate limit exceeded. Retry after ${result.retryAfter} seconds.`,
    retry_after: result.retryAfter,
    limit: result.limit,
    remaining: result.remaining,
    reset_time: result.resetTime,
  }), {
    status: result.allowed ? 200 : 429,
    headers: {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
      ...(result.retryAfter ? { 'Retry-After': result.retryAfter.toString() } : {}),
    }
  });
}

// Middleware factory for Next.js/Vercel
export function createRateLimitMiddleware(limitType: RateLimitType = 'default') {
  return function rateLimitMiddleware(request: Request): Response | null {
    const result = checkRateLimit(request, limitType);
    
    if (!result.allowed) {
      return createRateLimitedResponse(result);
    }
    
    return null; // Allow request to proceed
  };
}

// Cleanup old entries periodically (call this occasionally)
export function cleanupRateLimits(): void {
  globalStore.cleanup();
}

// Get statistics (for monitoring)
export function getRateLimitStats(): { totalEntries: number; byType: Record<string, number> } {
  const stats = { totalEntries: globalStore.size, byType: {} as Record<string, number> };
  
  // NOTE: reads through the public snapshot() method — the raw store Map is
  // private on purpose so nothing outside the store can mutate it.
  for (const key of globalStore.snapshot().keys()) {
    const type = key.split(':')[1] || 'unknown';
    stats.byType[type] = (stats.byType[type] || 0) + 1;
  }
  
  return stats;
}

// Export types
export type { RateLimitConfig, RateLimitResult, RateLimitEntry };
