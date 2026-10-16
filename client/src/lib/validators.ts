/**
 * Validation utilities for Email and Phone numbers (Frontend)
 */

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Checks if a string contains alphabetical letters (a-z, A-Z)
 */
export function containsLetters(str: string): boolean {
  if (!str) return false;
  return /[a-zA-Z]/.test(str);
}

/**
 * Checks if email has valid format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Checks if phone number is a valid 10-digit number (or +84 prefix)
 * Strictly does not allow letters
 */
export function isValidPhone(phone: string): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (containsLetters(trimmed)) return false;

  let normalized = trimmed;
  if (normalized.startsWith("+84")) {
    normalized = "0" + normalized.slice(3);
  } else if (normalized.startsWith("84") && normalized.length === 11) {
    normalized = "0" + normalized.slice(2);
  }

  return /^0[0-9]{9}$/.test(normalized);
}

/**
 * Sanitizes phone input in real-time:
 * Blocks or strips any letters, special symbols, spaces.
 * Keeps only digits (and optional leading '+' for +84).
 * Limits length to standard (max 10-12 chars).
 */
export function sanitizePhoneInput(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    return "+" + trimmed.slice(1).replace(/\D/g, "").slice(0, 11);
  }
  return trimmed.replace(/\D/g, "").slice(0, 10);
}

/**
 * Validates email input and returns an error message or null if valid
 */
export function validateEmailInput(email: string): string | null {
  if (!email || !email.trim()) {
    return "Vui lòng nhập địa chỉ email";
  }
  if (!isValidEmail(email)) {
    return "Email không đúng định dạng (Ví dụ: reader@example.com)";
  }
  return null;
}

/**
 * Validates phone input and returns an error message or null if valid
 */
export function validatePhoneInput(phone: string, isRequired = false): string | null {
  if (!phone || !phone.trim()) {
    if (isRequired) return "Vui lòng nhập số điện thoại";
    return null;
  }
  const trimmed = phone.trim();
  if (containsLetters(trimmed)) {
    return "Số điện thoại không được chứa chữ cái";
  }
  if (!isValidPhone(trimmed)) {
    return "Số điện thoại phải gồm 10 chữ số, bắt đầu bằng số 0 (Ví dụ: 0912345678)";
  }
  return null;
}
