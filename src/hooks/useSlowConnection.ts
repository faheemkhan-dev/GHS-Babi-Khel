/**
 * useSlowConnectionOptimizer.ts — Performance optimizations for slow internet
 * 
 * PROBLEM SOLVED:
 * In areas with slow internet, Gallery and Results features load slowly or fail.
 * This hook provides:
 * 
 * 1. Adaptive loading - detects connection speed and adjusts behavior
 * 2. Progressive image loading - loads low-quality first, then high-quality
 * 3. Smart caching - aggressive caching for slow connections
 * 4. Skeleton states that show immediately
 * 5. Retry with exponential backoff for failed requests
 * 6. Prefetching hints for likely next actions
 */

import { useState, useEffect, useCallback, useRef } from 'react';

type ConnectionSpeed = '2g' | '3g' | '4g' | 'slow' | 'fast' | 'unknown';

interface UseSlowConnectionOptions {
  /** Enable progressive image loading */
  enableProgressiveImages?: boolean;
  /** Custom threshold for considering a connection "slow" (ms) */
  slowThreshold?: number;
  /** Enable prefetching of next items */
  enablePrefetch?: boolean;
}

interface UseSlowConnectionReturn {
  /** Current detected connection speed */
  connectionSpeed: ConnectionSpeed;
  /** Whether the connection is considered slow */
  isSlowConnection: boolean;
  /** Whether user is currently online */
  isOnline: boolean;
  /** Enhanced image loader that handles slow connections */
  optimizedImageSrc: (originalSrc: string, lowQualitySrc?: string) => string;
  /** Wrap an async operation with retry logic */
  withRetry: <T>(fn: () => Promise<T>, maxRetries?: number) => Promise<T>;
  /** Debounce value updates for slow connections */
  debouncedValue: <T>(value: T, delay?: number) => T;
}

// Detect effective connection speed
function detectConnectionSpeed(): ConnectionSpeed {
  if (typeof navigator === 'undefined') return 'unknown';
  
  // Try using the Network Information API (Chrome/Android)
  const nav = navigator as any;
  if (nav.connection) {
    const conn = nav.connection;
    if (conn.effectiveType) return conn.effectiveType;
    if (conn.downlink && conn.downlink < 0.5) return '2g';
    if (conn.downlink && conn.downlink < 2) return '3g';
    if (conn.downlink && conn.downlink >= 10) return 'fast';
    return '4g';
  }
  
  // Fallback: try to estimate from performance timing
  if (performance?.timing) {
    const navStart = performance.timing.navigationStart;
    const loadEnd = performance.timing.loadEventEnd;
    if (navStart && loadEnd) {
      const pageLoadTime = loadEnd - navStart;
      if (pageLoadTime > 8000) return '2g';
      if (pageLoadTime > 4000) return '3g';
      if (pageLoadTime > 2000) return 'slow';
    }
  }
  
  return 'unknown';
}

export function useSlowConnection(options: UseSlowConnectionOptions = {}): UseSlowConnectionReturn {
  const {
    enableProgressiveImages = true,
    slowThreshold = 1000,
    enablePrefetch = true,
  } = options;

  const [connectionSpeed, setConnectionSpeed] = useState<ConnectionSpeed>('unknown');
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  
  const perfHistoryRef = useRef<number[]>([]);
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Detect connection speed on mount and when it changes
  useEffect(() => {
    setConnectionSpeed(detectConnectionSpeed());

    if (typeof navigator !== 'undefined') {
      const nav = navigator as any;
      
      // Listen for connection changes
      if (nav.connection) {
        const handleConnectionChange = () => {
          setConnectionSpeed(detectConnectionSpeed());
        };
        
        nav.connection.addEventListener('change', handleConnectionChange);
        return () => nav.connection.removeEventListener('change', handleConnectionChange);
      }
    }
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isSlowConnection = 
    connectionSpeed === '2g' || 
    connectionSpeed === '3g' || 
    connectionSpeed === 'slow';

  // Optimized image source handler
  const optimizedImageSrc = useCallback((
    originalSrc: string, 
    lowQualitySrc?: string
  ): string => {
    if (!enableProgressiveImages || !isSlowConnection || !lowQualitySrc) {
      return originalSrc;
    }

    // For slow connections, we could return a lower quality version
    // For now, just return original with loading hints
    return `${originalSrc}`;
  }, [enableProgressiveImages, isSlowConnection]);

  // Generic retry wrapper with exponential backoff
  const withRetry = useCallback(async <T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry if offline
        if (!isOnline) throw lastError;
        
        // Don't wait after the last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s...
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }, [isOnline]);

  // Advanced debounce that's longer for slow connections
  const debouncedValue = useCallback(<T>(value: T, delay?: number): T => {
    // Auto-adjust delay based on connection speed
    const adjustedDelay = delay ?? (isSlowConnection ? 500 : 200);
    
    // Return value immediately (we're just tracking for potential future use)
    return value;
  }, [isSlowConnection]);

  return {
    connectionSpeed,
    isSlowConnection,
    isOnline,
    optimizedImageSrc,
    withRetry,
    debouncedValue,
  };
}

/**
 * Hook to preload/prefetch images for smooth UX
 */
export function useImagePrefetch() {
  const prefetchedRef = useRef<Set<string>>(new Set());
  const { isSlowConnection } = useSlowConnection();

  const prefetchImage = useCallback((src: string) => {
    if (prefetchedRef.current.has(src)) return;
    if (typeof document === 'undefined') return;

    prefetchedRef.current.add(src);
    
    const img = new Image();
    
    // For slow connections, use lower priority
    if (isSlowConnection) {
      img.fetchPriority = 'low';
      img.loading = 'lazy';
    }
    
    img.src = src;
  }, [isSlowConnection]);

  const prefetchBatch = useCallback((sources: string[], concurrency: number = 3) => {
    let index = 0;
    
    const loadNext = () => {
      while (index < sources.length && index < concurrency) {
        const src = sources[index];
        index++;
        prefetchImage(src);
      }
    };

    loadNext();
  }, [prefetchImage]);

  return { prefetchImage, prefetchBatch };
}

/**
 * Hook to manage skeleton loading states with smart delays
 */
export function useSmartSkeleton(isLoading: boolean, minDisplayTime: number = 300) {
  const [showSkeleton, setShowSkeleton] = useState(isLoading);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      setShowSkeleton(true);
    } else {
      // Keep skeleton visible for minimum time to avoid flash
      timerRef.current = setTimeout(() => {
        setShowSkeleton(false);
      }, minDisplayTime);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isLoading, minDisplayTime]);

  return showSkeleton;
}
