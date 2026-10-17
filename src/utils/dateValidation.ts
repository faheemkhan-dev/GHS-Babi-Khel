// utils/dateValidation.ts
// SECURITY FIX: Problem 32 - Date Validation Utilities
// Prevents date-based attacks: SQL injection via dates, out-of-range dates, invalid formats

import { z } from 'zod'; // If you use Zod, otherwise use manual validation
 
// Date validation result
interface ValidationResult {
  valid: boolean;
  value?: Date;
  error?: string;
  sanitized?: string;
}

// Allowed date formats for parsing
const DATE_FORMATS = [
  // ISO 8601 (preferred)
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?)?$/,
  // Common formats
  /^(\d{2})\/(\d{2})\/(\d{4})$/,           // MM/DD/YYYY
  /^(\d{2})-(\d{2})-(\d{4})$/,             // DD-MM-YYYY
  /^(\d{4})\/(\d{2})\/(\d{2})$/,           // YYYY/MM/DD
];

// Detect potential SQL injection in date strings
const SQL_INJECTION_PATTERNS = [
  /['"]/g,
  /(--)|(;)|(\|\|)/g,
  /(UNION)|(SELECT)|(INSERT)|(DELETE)|(UPDATE)|(DROP)/gi,
  /(OR\s+1\s*=\s*1)/gi,
  /(\bSLEEP\b)|(\bBENCHMARK\b)|(\bWAITFOR\b)/gi,
];

// Detect potential XSS in date strings
const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<img/gi,
];

/**
 * Validate and sanitize a date string input
 * @param input - Raw date string from user input
 * @param options - Validation options
 * @returns ValidationResult with sanitized date or error
 */
export function validateDate(
  input: unknown,
  options: {
    allowFuture?: boolean;
    allowPast?: boolean;
    minDate?: Date;
    maxDate?: Date;
    fieldName?: string;
    required?: boolean;
  } = {}
): ValidationResult {
  const {
    allowFuture = true,
    allowPast = true,
    minDate,
    maxDate,
    fieldName = 'Date',
    required = true,
  } = options;

  // Check for empty/undefined
  if (input === null || input === undefined || input === '') {
    if (required) {
      return { valid: false, error: `${fieldName} is required` };
    }
    return { valid: true }; // Optional field, empty is OK
  }

  // Convert to string if needed
  const dateString = typeof input === 'string' ? input : String(input);

  // SECURITY: Check for injection patterns first
  const sqlInjectionMatch = SQL_INJECTION_PATTERNS.some(pattern => pattern.test(dateString));
  if (sqlInjectionMatch) {
    console.warn(`[DateValidation] Potential SQL injection detected in ${fieldName}:`, dateString);
    return { 
      valid: false, 
      error: `Invalid ${fieldName.toLowerCase()} format`,
      sanitized: new Date().toISOString().split('T')[0] // Return safe default
    };
  }

  const xssMatch = XSS_PATTERNS.some(pattern => pattern.test(dateString));
  if (xssMatch) {
    console.warn(`[DateValidation] Potential XSS detected in ${fieldName}:`, dateString);
    return {
      valid: false,
      error: `Invalid ${fieldName.toLowerCase()} format`,
      sanitized: new Date().toISOString().split('T')[0]
    };
  }

  // SECURITY: Sanitize - remove any non-date characters except allowed ones
  const sanitizedInput = dateString
    .replace(/[^\d\-/T:.Z+-]/g, '') // Keep only date-related characters
    .trim();

  if (!sanitizedInput) {
    return { valid: false, error: `${fieldName} must be a valid date` };
  }

  // Try to parse the date
  let parsedDate: Date;

  // Try ISO format first (most reliable)
  if (/^\d{4}-\d{2}-\d{2}/.test(sanitizedInput)) {
    parsedDate = new Date(sanitizedInput + 'T00:00:00.000Z'); // Force UTC interpretation
  } else {
    // Try other formats
    parsedDate = new Date(sanitizedInput);
  }

  // Check if date is valid
  if (isNaN(parsedDate.getTime())) {
    return { 
      valid: false, 
      error: `Invalid ${fieldName.toLowerCase()}. Please use YYYY-MM-DD format`,
      sanitized: new Date().toISOString().split('T')[0]
    };
  }

  // SECURITY: Sanity check - reject obviously wrong dates
  const year = parsedDate.getFullYear();
  
  // Year range check (reasonable bounds)
  if (year < 1900 || year > 2100) {
    return { 
      valid: false, 
      error: `${fieldName} year must be between 1900 and 2100`,
      sanitized: new Date().toISOString().split('T')[0]
    };
  }

  // Month check (0-indexed in JS)
  const month = parsedDate.getMonth();
  if (month < 0 || month > 11) {
    return { valid: false, error: `Invalid month in ${fieldName.toLowerCase()}` };
  }

  // Day check
  const day = parsedDate.getDate();
  if (day < 1 || day > 31) {
    return { valid: false, error: `Invalid day in ${fieldName.toLowerCase()}` };
  }

  // Time-based validations
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Start of today
  parsedDate.setHours(0, 0, 0, 0);

  if (!allowPast && parsedDate < now) {
    return { 
      valid: false, 
      error: `${fieldName} cannot be in the past`,
      sanitized: now.toISOString().split('T')[0]
    };
  }

  if (!allowFuture && parsedDate > now) {
    return { 
      valid: false, 
      error: `${fieldName} cannot be in the future`,
      sanitized: now.toISOString().split('T')[0]
    };
  }

  // Min/Max date checks
  if (minDate && parsedDate < new Date(minDate)) {
    return { 
      valid: false, 
      error: `${fieldName} must be after ${new Date(minDate).toISOString().split('T')[0]}`
    };
  }

  if (maxDate && parsedDate > new Date(maxDate)) {
    return { 
      valid: false, 
      error: `${fieldName} must be before ${new Date(maxDate).toISOString().split('T')[0]}`
    };
  }

  // Return validated and formatted date
  return {
    valid: true,
    value: parsedDate,
    sanitized: parsedDate.toISOString().split('T')[0], // YYYY-MM-DD format
  };
}

/**
 * Validate a date range (start and end dates)
 */
export function validateDateRange(
  startDate: unknown,
  endDate: unknown,
  options: {
    maxRangeDays?: number;
    minRangeDays?: number;
    fieldName?: string;
  } = {}
): ValidationResult & { startSanitized?: string; endSanitized?: string } {
  const { maxRangeDays, minRangeDays, fieldName = 'Date range' } = options;

  const startResult = validateDate(startDate, { ...options, fieldName: 'Start date' });
  const endResult = validateDate(endDate, { ...options, fieldName: 'End date' });

  if (!startResult.valid || !endResult.valid) {
    return {
      valid: false,
      error: startResult.error || endResult.error,
      sanitized: startResult.sanitized || endResult.sanitized
    };
  }

  if (startResult.value && endResult.value) {
    // Ensure end is after start
    if (endResult.value < startResult.value) {
      return {
        valid: false,
        error: 'End date must be after start date',
        startSanitized: startResult.sanitized,
        endSanitized: startResult.sanitized // Set both to start date as fallback
      };
    }

    // Range duration check
    const diffTime = Math.abs(endResult.value.getTime() - startResult.value.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (minRangeDays && diffDays < minRangeDays) {
      return {
        valid: false,
        error: `${fieldName} must span at least ${minRangeDays} days`
      };
    }

    if (maxRangeDays && diffDays > maxRangeDays) {
      return {
        valid: false,
        error: `${fieldName} cannot exceed ${maxRangeDays} days`
      };
    }
  }

  return {
    valid: true,
    startSanitized: startResult.sanitized,
    endSanitized: endResult.sanitized
  };
}

/**
 * Validate time input (HH:MM or HH:MM:SS format)
 */
export function validateTime(
  input: unknown,
  options: { required?: boolean; fieldName?: string } = {}
): ValidationResult {
  const { required = true, fieldName = 'Time' } = options;

  if (!input && !required) {
    return { valid: true };
  }

  const timeString = String(input || '').trim();

  // Basic format check
  const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-])(?::([0-5][0-9]))?$/;
  
  if (!timeRegex.test(timeString)) {
    return {
      valid: false,
      error: `Invalid ${fieldName.toLowerCase()}. Use HH:MM or HH:MM:SS format`
    };
  }

  return { valid: true, value: new Date(`2000-01-01T${timeString}`), sanitized: timeString };
}

/**
 * Create a date validator for form fields (React-compatible)
 */
export function createDateValidator(options?: Parameters<typeof validateDate>[1]) {
  return (value: unknown): string | undefined => {
    const result = validateDate(value, options);
    return result.valid ? undefined : result.error;
  };
}

/**
 * Sanitize date for database queries (prevent SQLi via dates)
 */
export function sanitizeDateForQuery(dateStr: string): string {
  const result = validateDate(dateStr, { required: false });
  
  if (!result.valid || !result.sanitized) {
    // Return current date as safe fallback
    console.warn('[DateValidation] Invalid date for query, using fallback');
    return new Date().toISOString().split('T')[0];
  }
  
  // Ensure proper ISO format for database
  return result.sanitized;
}

/**
 * Get today's date in safe format (for defaults)
 */
export function getTodaySafe(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculate age from birthdate (with validation)
 */
export function calculateAge(birthdate: unknown): number | null {
  const result = validateDate(birthdate, {
    allowFuture: false,
    fieldName: 'Birthdate',
    maxDate: new Date()
  });

  if (!result.valid || !result.value) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - result.value.getFullYear();
  const monthDiff = today.getMonth() - result.value.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < result.value.getDate())) {
    age--;
  }

  return age;
}

/**
 * Zod schema for date validation (if using Zod)
 */
export const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((date) => !isNaN(new Date(date).getTime()), 'Invalid date')
  .refine((date) => {
    const d = new Date(date);
    return d.getFullYear() >= 1900 && d.getFullYear() <= 2100;
  }, 'Year must be between 1900 and 2100');

export const dateRangeSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
}).refine((data) => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'End date must be after start date',
});

// Export types
export type { ValidationResult };
