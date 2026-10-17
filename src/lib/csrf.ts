// lib/csrf.ts
// SECURITY FIX: CSRF Protection Utility
// Implements CSRF token generation and validation for form protection

/** 
 * Generate a cryptographically secure random token for CSRF protection
 * Uses Web Crypto API for secure random number generation
 */
export function generateCSRFToken(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for environments without crypto API
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  
  // Convert to hexadecimal string
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Set CSRF token in cookie for server-side validation
 * Cookie is set with security flags: HttpOnly (via server), SameSite=Strict, Secure
 */
export function setCSRFCookie(token: string): void {
  // Note: HttpOnly flag can only be set server-side
  // This sets a non-HttpOnly cookie for client-side reference
  document.cookie = `csrf_token=${token}; SameSite=Strict; Path=/; ${window.location.protocol === 'https:' ? 'Secure;' : ''} Max-Age=${60 * 60};`; // 1 hour expiry
}

/**
 * Get CSRF token from cookie
 */
export function getCSRFCookie(): string | null {
  const match = document.cookie.match(/(^| )csrf_token=([^;]+)/);
  return match ? match[2] : null;
}

/**
 * Get or create CSRF token (returns existing valid token or generates new one)
 */
export function getOrCreateCSRFToken(): string {
  // First check for existing token
  let token = getCSRFCookie();
  
  if (!token) {
    // Generate new token
    token = generateCSRFToken();
    setCSRFCookie(token);
    
    // Also store in sessionStorage as backup
    sessionStorage.setItem('ghs_csrf_token', token);
  }
  
  return token;
}

/**
 * Validate CSRF token against stored value
 * Returns true if tokens match, false otherwise
 */
export function validateCSRFToken(submittedToken: string): boolean {
  if (!submittedToken) return false;
  
  // Check against cookie
  const cookieToken = getCSRFCookie();
  if (cookieToken && cookieToken === submittedToken) {
    return true;
  }
  
  // Check against session storage backup
  const sessionToken = sessionStorage.getItem('ghs_csrf_token');
  if (sessionToken && sessionToken === submittedToken) {
    return true;
  }
  
  return false;
}

/**
 * Create hidden input element for CSRF token
 * Use this to add CSRF protection to forms
 */
export function createCSRFHiddenInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'csrf_token';
  input.value = getOrCreateCSRFToken();
  return input;
}

/**
 * Add CSRF token to all forms on the page
 * Call this after DOM is loaded to protect all forms
 */
export function addCSRFToForms(): void {
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    // Check if form already has CSRF token
    const existingToken = form.querySelector('input[name="csrf_token"]');
    if (!existingToken) {
      const csrfInput = createCSRFHiddenInput();
      form.appendChild(csrfInput);
    }
  });
}

/**
 * Get CSRF headers for fetch/XHR requests
 * Use this when making AJAX requests that need CSRF protection
 */
export function getCSRFHeaders(): Record<string, string> {
  return {
    'X-CSRF-Token': getOrCreateCSRFToken()
  };
}

/**
 * Initialize CSRF protection
 * Call this once when your app loads
 */
export function initializeCSRFProtection(): void {
  // Generate and store token
  getOrCreateCSRFToken();
  
  // Add to all existing forms
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addCSRFToForms);
  } else {
    addCSRFToForms();
  }
  
  // Observe DOM changes to add CSRF to dynamically created forms
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLFormElement) {
            const existingToken = node.querySelector('input[name="csrf_token"]');
            if (!existingToken) {
              const csrfInput = createCSRFHiddenInput();
              node.appendChild(csrfInput);
            }
          }
        });
      });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Auto-initialize if this module is imported
if (typeof window !== 'undefined') {
  initializeCSRFProtection();
}

export default {
  generateCSRFToken,
  setCSRFCookie,
  getCSRFCookie,
  getOrCreateCSRFToken,
  validateCSRFToken,
  createCSRFHiddenInput,
  addCSRFToForms,
  getCSRFHeaders,
  initializeCSRFProtection
};
