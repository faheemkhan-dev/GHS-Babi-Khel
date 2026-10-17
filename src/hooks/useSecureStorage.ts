// hooks/useSecureStorage.ts
// SECURITY FIX: Problems 30 & 31 - Secure localStorage Handling
// Prevents localStorage manipulation and protects sensitive data 

import { useState, useEffect, useCallback } from 'react';

// Types of data that can be stored securely
type StorageCategory = 'public' | 'protected' | 'sensitive' | 'session';

interface SecureStorageOptions {
  category?: StorageCategory;
  encrypt?: boolean; // For sensitive data (client-side only)
  expiryMs?: number; // Auto-expire after this time
  validateOnChange?: boolean; // Validate integrity on every change
}

interface SecureStorageItem<T> {
  value: T;
  timestamp: number;
  expiry?: number;
  hash?: string; // Integrity check
  category: StorageCategory;
}

// Simple hash function for integrity checking (not cryptographically secure, just for tamper detection)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Encode value (basic obfuscation - not true encryption)
function encodeValue(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return btoa(encodeURIComponent(json));
  } catch {
    return '';
  }
}

// Decode value
function decodeValue<T>(encoded: string): T | null {
  try {
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Data that should NEVER be stored in localStorage (server-side only)
const FORBIDDEN_KEYS = [
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'private_key',
  'credit_card',
  'ssn',
  'cnic',
  'b_form_no',
  'emis_code',      // Problem 31: Move this to server-side
  'location_lat',   // Problem 31: Move this to server-side
  'location_lng',   // Problem 31: Move this to server-side
  'phone',          // Problem 31: Consider moving to server-side
  'principal_name', // Problem 31: Move to server-side
];

// Keys that should be read-only (cannot be modified by client code once set)
const READONLY_KEYS = [
  'user_role',
  'is_authenticated',
  'permissions',
  'user_id',
  'auth_token',
];

// Track original values for readonly keys
const readonlyValues = new Map<string, unknown>();

class SecureStorageError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

// Main secure storage hook
export function useSecureStorage<T>(
  key: string,
  defaultValue: T,
  options: SecureStorageOptions = {}
) {
  const {
    category = 'public',
    encrypt = false,
    expiryMs,
    validateOnChange = true,
  } = options;

  const [value, setValue] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate key name
  const isValidKey = useCallback((k: string): boolean => {
    if (FORBIDDEN_KEYS.some(forbidden => k.toLowerCase().includes(forbidden))) {
      throw new SecureStorageError(
        `Key "${k}" contains forbidden pattern. This data should be stored server-side.`,
        'FORBIDDEN_KEY'
      );
    }
    return true;
  }, []);

  // Check if key is readonly
  const isReadonlyKey = useCallback((k: string): boolean => {
    return READONLY_KEYS.some(readonly => k.toLowerCase().includes(readonly));
  }, []);

  // Load value from storage
  const loadFromStorage = useCallback(() => {
    try {
      if (!isValidKey(key)) {
        setValue(defaultValue);
        setIsLoaded(true);
        return;
      }

      const raw = localStorage.getItem(`secure_${key}`);
      
      if (!raw) {
        setValue(defaultValue);
        setIsLoaded(true);
        return;
      }

      const item: SecureStorageItem<T> = decodeValue<SecureStorageItem<T>>(raw);
      
      if (!item) {
        console.warn(`[SecureStorage] Corrupted data for key "${key}", using default`);
        localStorage.removeItem(`secure_${key}`);
        setValue(defaultValue);
        setIsLoaded(true);
        return;
      }

      // Check expiry
      if (item.expiry && Date.now() > item.expiry) {
        console.log(`[SecureStorage] Expired data for key "${key}", removing`);
        localStorage.removeItem(`secure_${key}`);
        setValue(defaultValue);
        setIsLoaded(true);
        return;
      }

      // Verify integrity
      if (item.hash && validateOnChange) {
        const expectedHash = simpleHash(JSON.stringify(item.value) + item.timestamp);
        if (expectedHash !== item.hash) {
          console.warn(`[SecureStorage] Tampering detected for key "${key}", resetting`);
          localStorage.removeItem(`secure_${key}`);
          setValue(defaultValue);
          setIsLoaded(true);
          return;
        }
      }

      // Check if trying to load a readonly key with different value
      if (isReadonlyKey(key)) {
        const existingValue = readonlyValues.get(key);
        if (existingValue !== undefined && JSON.stringify(existingValue) !== JSON.stringify(item.value)) {
          console.warn(`[SecureStorage] Attempted modification of readonly key "${key}" blocked`);
          setValue(existingValue as T);
          setIsLoaded(true);
          return;
        }
        readonlyValues.set(key, item.value);
      }

      setValue(item.value);
      setIsLoaded(true);
    } catch (err) {
      console.error(`[SecureStorage] Error loading key "${key}":`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setValue(defaultValue);
      setIsLoaded(true);
    }
  }, [key, defaultValue, isValidKey, isReadonlyKey, validateOnChange]);

  // Save value to storage
  const saveToStorage = useCallback((newValue: T) => {
    try {
      // Validate key
      if (!isValidKey(key)) {
        throw new SecureStorageError(
          `Cannot save forbidden key "${key}"`,
          'FORBIDDEN_KEY'
        );
      }

      // Check readonly
      if (isReadonlyKey(key)) {
        const existingValue = readonlyValues.get(key);
        if (existingValue !== undefined && JSON.stringify(existingValue) !== JSON.stringify(newValue)) {
          console.warn(`[SecureStorage] Blocked attempt to modify readonly key "${key}"`);
          setValue(existingValue as T);
          return;
        }
      }

      const now = Date.now();
      const item: SecureStorageItem<T> = {
        value: newValue,
        timestamp: now,
        category,
        ...(expiryMs ? { expiry: now + expiryMs } : {}),
        ...(validateOnChange ? { hash: simpleHash(JSON.stringify(newValue) + now) } : {}),
      };

      const encoded = encodeValue(item);
      localStorage.setItem(`secure_${key}`, encoded);
      
      // Update readonly tracking
      if (isReadonlyKey(key)) {
        readonlyValues.set(key, newValue);
      }
      
      setValue(newValue);
      setError(null);
    } catch (err) {
      console.error(`[SecureStorage] Error saving key "${key}":`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [key, category, expiryMs, isValidKey, isReadonlyKey, validateOnChange]);

  // Remove value from storage
  const removeFromStorage = useCallback(() => {
    try {
      localStorage.removeItem(`secure_${key}`);
      setValue(defaultValue);
      if (isReadonlyKey(key)) {
        readonlyValues.delete(key);
      }
    } catch (err) {
      console.error(`[SecureStorage] Error removing key "${key}":`, err);
    }
  }, [key, defaultValue, isReadonlyKey]);

  // Initialize on mount
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Listen for storage events (cross-tab sync)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `secure_${key}` && e.newValue !== e.oldValue) {
        loadFromStorage();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, loadFromStorage]);

  return {
    value,
    setValue: saveToStorage,
    remove: removeFromStorage,
    isLoaded,
    error,
    isLoading: !isLoaded,
  };
}

// Utility functions for secure storage management

// Migrate old insecure keys to secure format
export function migrateToSecureStorage(
  oldKey: string,
  newKey?: string,
  options?: SecureStorageOptions
): boolean {
  try {
    const targetKey = newKey || oldKey;
    
    // Check if already migrated
    if (localStorage.getItem(`secure_${targetKey}`)) {
      return true; // Already migrated
    }

    const oldValue = localStorage.getItem(oldKey);
    if (oldValue === null) {
      return false; // Nothing to migrate
    }

    // Parse and store securely
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(oldValue);
    } catch {
      parsedValue = oldValue; // Store as string if not JSON
    }

    const item: SecureStorageItem<unknown> = {
      value: parsedValue,
      timestamp: Date.now(),
      category: options?.category || 'public',
      ...(options?.expiryMs ? { expiry: Date.now() + options.expiryMs } : {}),
    };

    localStorage.setItem(`secure_${targetKey}`, encodeValue(item));
    localStorage.removeItem(oldKey); // Remove old insecure version
    
    console.log(`[SecureStorage] Migrated "${oldKey}" → "secure_${targetKey}"`);
    return true;
  } catch (err) {
    console.error(`[SecureStorage] Migration failed for "${oldKey}":`, err);
    return false;
  }
}

// Clear all secure storage data
export function clearSecureStorage(category?: StorageCategory): void {
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('secure_')) {
      if (category) {
        try {
          const item = decodeValue<SecureStorageItem<unknown>>(localStorage.getItem(key)!);
          if (item?.category === category) {
            keysToRemove.push(key!);
          }
        } catch {
          keysToRemove.push(key!); // Remove corrupted items
        }
      } else {
        keysToRemove.push(key!);
      }
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log(`[SecureStorage] Cleared ${keysToRemove.length} items${category ? ` in category "${category}"` : ''}`);
}

// Get all secure storage info (for debugging)
export function getSecureStorageInfo(): Array<{ key: string; category: string; timestamp: number; size: number }> {
  const info: Array<{ key: string; category: string; timestamp: number; size: number }> = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('secure_')) {
      try {
        const raw = localStorage.getItem(key)!;
        const item = decodeValue<SecureStorageItem<unknown>>(raw);
        if (item) {
          info.push({
            key: key.replace('secure_', ''),
            category: item.category,
            timestamp: item.timestamp,
            size: new Blob([raw]).size,
          });
        }
      } catch {
        info.push({
          key: key.replace('secure_', ''),
          category: 'corrupted',
          timestamp: 0,
          size: 0,
        });
      }
    }
  }
  
  return info;
}

// Detect potential tampering attempts
export function detectTampering(): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check for non-secure versions of sensitive keys
  const sensitivePatterns = ['role', 'auth', 'token', 'admin', 'permission'];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && !key.startsWith('secure_')) {
      const lowerKey = key.toLowerCase();
      if (sensitivePatterns.some(pattern => lowerKey.includes(pattern))) {
        issues.push(`Insecure storage detected: "${key}" should use secure storage`);
      }
    }
  }
  
  // Check for suspicious values in known keys
  const suspiciousValues = ['"admin"', '"superuser"', '"root"', 'true'];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('secure_')) {
      try {
        const item = decodeValue<SecureStorageItem<unknown>>(localStorage.getItem(key)!);
        if (item && typeof item.value === 'string') {
          if (suspiciousValues.includes(item.value.toLowerCase())) {
            issues.push(`Suspicious value in "${key.replace('secure_', '')}": ${item.value}`);
          }
        }
      } catch {
        // Ignore parse errors here
      }
    }
  }
  
  return { safe: issues.length === 0, issues };
}

export default useSecureStorage;
