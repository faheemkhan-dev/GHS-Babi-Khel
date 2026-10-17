/**
 * useFormPersistence.ts — SaaS-grade form state persistence system
 * 
 * PROBLEM SOLVED:
 * When internet is slow or connection drops, React Query refetches can cause
 * component re-renders that wipe out unsaved form data. This hook:
 * 
 * 1. Auto-saves form state to sessionStorage every 500ms (debounced)
 * 2. Restores state on component mount (even after page refresh)
 * 3. Warns user before leaving with unsaved changes
 * 4. Works offline - no network required
 * 5. Cleans up saved data when form is successfully submitted
 * 
 * USAGE:
 * const { formData, updateField, setFormData, isDirty, clearSaved, hasSavedData } = useFormPersistence('notice-form', initialData);
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseFormPersistenceOptions<T> {
  /** Unique key for this form (e.g., 'notice-form', 'result-entry') */
  storageKey: string;
  /** Initial form data structure */
  initialValues: T;
  /** How often to auto-save to sessionStorage (ms) */
  debounceMs?: number;
  /** Enable/disable the beforeunload warning */
  enableLeaveWarning?: boolean;
  /** Custom validation - only save if returns true */
  shouldPersist?: (data: T) => boolean;
  /** Called when saved data is restored */
  onRestore?: (data: T) => void;
}

interface UseFormPersistenceReturn<T> {
  /** Current form data */
  formData: T;
  /** Update a single field */
  updateField: (field: keyof T, value: any) => void;
  /** Replace entire form data */
  setFormData: (data: T | ((prev: T) => T)) => void;
  /** Whether current data differs from initial/saved values */
  isDirty: boolean;
  /** Clear persisted data (call after successful submit) */
  clearSaved: () => void;
  /** Whether there's saved data available */
  hasSavedData: boolean;
  /** Manually trigger save */
  save: () => void;
}

const PREFIX = 'ghs-form-';

export function useFormPersistence<T extends Record<string, any>>({
  storageKey,
  initialValues,
  debounceMs = 500,
  enableLeaveWarning = true,
  shouldPersist,
  onRestore,
}: UseFormPersistenceOptions<T>): UseFormPersistenceReturn<T> {
  const fullKey = `${PREFIX}${storageKey}`;
  
  // Initialize from saved data or use initial values
  const [formData, setFormDataState] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(fullKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          // Call onRestore if provided
          setTimeout(() => onRestore?.(parsed), 0);
          return parsed;
        }
      }
    } catch {
      // Invalid saved data, ignore
    }
    return { ...initialValues };
  });

  const [hasSavedData, setHasSavedData] = useState(() => {
    return sessionStorage.getItem(fullKey) !== null;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initialValues);
  const lastSavedRef = useRef(formData);

  // Debounced save function
  const save = useCallback((data?: T) => {
    const dataToSave = data || formData;
    
    // Check custom validation
    if (shouldPersist && !shouldPersist(dataToSave)) {
      return;
    }

    // Don't save if data hasn't changed since last save
    if (JSON.stringify(dataToSave) === JSON.stringify(lastSavedRef.current)) {
      return;
    }

    try {
      sessionStorage.setItem(fullKey, JSON.stringify(dataToSave));
      lastSavedRef.current = { ...dataToSave };
      setHasSavedData(true);
    } catch {
      // SessionStorage might be full or unavailable
      console.warn('[useFormPersistence] Failed to save form data');
    }
  }, [formData, fullKey, shouldPersist]);

  // Auto-save with debounce
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    timerRef.current = setTimeout(() => {
      save();
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [formData, debounceMs, save]);

  // Update a single field
  const updateField = useCallback((field: keyof T, value: any) => {
    setFormDataState(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  // Replace entire form data
  const setFormData = useCallback((data: T | ((prev: T) => T)) => {
    setFormDataState(prev => {
      const newData = typeof data === 'function' ? (data as (prev: T) => T)(prev) : data;
      return newData;
    });
  }, []);

  // Clear saved data (after successful submit)
  const clearSaved = useCallback(() => {
    try {
      sessionStorage.removeItem(fullKey);
      setHasSavedData(false);
      lastSavedRef.current = initialValues;
      // Reset to initial values
      setFormDataState({ ...initialValues });
    } catch {
      // Ignore errors during cleanup
    }
  }, [fullKey, initialValues]);

  // Calculate if form is dirty
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialRef.current);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    if (!enableLeaveWarning || !isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save one final time before leaving
      save();
      
      // Show browser warning
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, enableLeaveWarning, save]);

  return {
    formData,
    updateField,
    setFormData,
    isDirty,
    clearSaved,
    hasSavedData,
    save,
  };
}

/**
 * Hook to detect network status and provide resilience features
 */
export function useNetworkResilience() {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      // Mark that we just came back online
      setWasOffline(true);
      // Reset the flag after 5 seconds
      setTimeout(() => setWasOffline(false), 5000);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    isOnline,
    wasOffline,
    /** Whether we should suppress background refetches (just came back online) */
    shouldSuppressRefetch: wasOffline,
  };
}
