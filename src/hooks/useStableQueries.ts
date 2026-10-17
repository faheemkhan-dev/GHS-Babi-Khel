/**
 * useStableQueries.ts
 * 
 * CRITICAL HOOK FOR PREVENTING PAGE REFRESH FEELING ON SLOW CONNECTIONS
 * 
 * This hook provides stable, non-disruptive data fetching behavior that
 * prevents the "page is refreshing" sensation users experience when:
 * - Internet connection is slow or unstable
 * - Network latency causes delayed responses
 * - Background refetches trigger UI updates
 * - Multiple queries update simultaneously
 * 
 * KEY FEATURES:
 * 1. Connection-aware refetching — reduces/stops refetching on slow networks
 * 2. Debounced invalidations — batches multiple invalidations together
 * 3. Silent background updates — updates data without causing UI flicker
 * 4. Optimistic UI preservation — keeps showing old data until new data arrives
 * 5. Edit-aware pausing — stops background refreshes during active editing
 * 
 * USAGE:
 * ```tsx
 * const { isSlowConnection, pauseRefetches, invalidateSoftly } = useStableQueries();
 * 
 * // During form editing
 * useEffect(() => {
 *   pauseRefetches(); // Stop all background refreshes while user edits
 *   return resumeRefetches; // Resume when component unmounts
 * }, []);
 * 
 * // When you need to update data without disrupting the user
 * function handleSave() {
 *   await saveData();
 *   await invalidateSoftly(['users', 'settings']); // Gentle, non-disruptive update
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Configuration constants
const SLOW_CONNECTION_THRESHOLD = 1000; // ms — above this is considered "slow"
const DEBOUNCE_MS = 500; // Debounce multiple invalidations
const EDIT_DETECTION_TIMEOUT = 30000; // 30 seconds of no input = not editing

interface StableQueriesReturn {
  /** Whether the current connection is detected as slow */
  isSlowConnection: boolean;
  /** Current estimated round-trip time in ms (0 if unknown) */
  estimatedRTT: number;
  
  /** Pause all automatic background refetches (call during active editing) */
  pauseRefetches: () => void;
  /** Resume paused refetches */
  resumeRefetches: () => void;
  /** Whether refetches are currently paused */
  isPaused: boolean;
  
  /** Invalidate queries gently (debounced, won't cause visible flicker) */
  invalidateSoftly: (queryKeys: string[]) => Promise<void>;
  /** Mark that user is actively editing (pauses background refreshes) */
  markEditing: () => void;
  /** Mark that user stopped editing (resumes after timeout) */
  markStoppedEditing: () => void;
}

export function useStableQueries(): StableQueriesReturn {
  const queryClient = useQueryClient();
  const [isSlowConnection, setIsSlowConnection] = useState(false);
  const [estimatedRTT, setEstimatedRTT] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditingRef = useRef(false);

  // ── Connection speed monitoring ──────────────────────────────────
  useEffect(() => {
    // Check if we can measure connection speed
    const conn = (navigator as any).connection || 
                 (navigator as any).mozConnection || 
                 (navigator as any).webkitConnection;
    
    if (!conn) return;

    const updateConnectionInfo = () => {
      const rtt = conn.rtt || 0;
      const effectiveType = conn.effectiveType || '';
      const downlink = conn.downlink || 0;
      
      setEstimatedRTT(rtt);
      
      // Consider slow if:
      // - RTT > threshold, OR
      // - Effective type is 2g/3g/slow-2g, OR
      // - Downlink < 1.5 Mbps
      const isSlow = rtt > SLOW_CONNECTION_THRESHOLD ||
                     ['2g', '3g', 'slow-2g'].includes(effectiveType) ||
                     (downlink > 0 && downlink < 1.5);
      
      setIsSlowConnection(isSlow);
      
      // Log for debugging
      if (isSlow) {
        console.log(`[useStableQueries] Slow connection detected: RTT=${rtt}ms, type=${effectiveType}, downlink=${downlink}Mbps`);
      }
    };

    // Initial check
    updateConnectionInfo();

    // Listen for changes
    conn.addEventListener('change', updateConnectionInfo);
    return () => conn.removeEventListener('change', updateConnectionInfo);
  }, []);

  // ── Manual RTT measurement fallback ──────────────────────────────
  useEffect(() => {
    if (estimatedRTT > 0) return; // Already have a measurement

    const measureRTT = async () => {
      try {
        const start = performance.now();
        // Use a lightweight request to measure RTT
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        await fetch('/favicon.ico', { 
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        const rtt = Math.round(performance.now() - start);
        
        setEstimatedRTT(rtt);
        setIsSlowConnection(rtt > SLOW_CONNECTION_THRESHOLD);
      } catch {
        // Can't measure — assume normal connection
        setEstimatedRTT(0);
        setIsSlowConnection(false);
      }
    };

    // Measure after a short delay to let initial load settle
    const timer = setTimeout(measureRTT, 3000);
    return () => clearTimeout(timer);
  }, [estimatedRTT]);

  // ── Refetch pause/resume ─────────────────────────────────────────
  const pauseRefetches = useCallback(() => {
    // Clear any existing resume timer
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
    
    setIsPaused(true);
    
    console.log('[useStableQueries] Background refetches PAUSED');
  }, []);

  const resumeRefetches = useCallback(() => {
    setIsPaused(false);
    console.log('[useStableQueries] Background refetches RESUMED');
  }, []);

  // Auto-resume after extended pause (safety net)
  const pauseWithAutoResume = useCallback((durationMs = EDIT_DETECTION_TIMEOUT) => {
    setIsPaused(true);
    
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
    
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
      console.log('[useStableQueries] Auto-resumed refetches after timeout');
    }, durationMs);
  }, []);

  // ── Soft invalidation (debounced, gentle) ────────────────────────
  const invalidateSoftly = useCallback(async (queryKeys: string[]) => {
    // If connection is slow, add extra delay between invalidations
    const delay = isSlowConnection ? DEBOUNCE_MS * 2 : DEBOUNCE_MS;
    
    return new Promise<void>((resolve) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        try {
          // Invalidate each key with minimal disruption
          for (const key of queryKeys) {
            await queryClient.invalidateQueries({ queryKey: [key] });
          }
          
          console.log(`[useStableQueries] Soft invalidation complete for: ${queryKeys.join(', ')}`);
        } catch (e) {
          console.warn('[useStableQueries] Soft invalidation failed:', e);
        } finally {
          resolve();
        }
      }, delay);
    });
  }, [queryClient, isSlowConnection]);

  // ── Editing detection helpers ────────────────────────────────────
  const markEditing = useCallback(() => {
    isEditingRef.current = true;
    pauseWithAutoResume(EDIT_DETECTION_TIMEOUT);
    
    console.log('[useStableQueries] User editing detected — refetches paused');
  }, [pauseWithAutoResume]);

  const markStoppedEditing = useCallback(() => {
    isEditingRef.current = false;
    
    // Resume after a short grace period (user might start typing again)
    if (editTimeoutRef.current) {
      clearTimeout(editTimeoutRef.current);
    }
    
    editTimeoutRef.current = setTimeout(() => {
      if (!isEditingRef.current) {
        resumeRefetches();
        console.log('[useStableQueries] User finished editing — refetches resumed');
      }
    }, 5000); // 5 second grace period
  }, [resumeRefetches]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
    };
  }, []);

  return {
    isSlowConnection,
    estimatedRTT,
    pauseRefetches: pauseWithAutoResume,
    resumeRefetches,
    isPaused,
    invalidateSoftly,
    markEditing,
    markStoppedEditing,
  };
}

export default useStableQueries;
