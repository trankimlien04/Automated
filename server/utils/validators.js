/**
 * Validation utilities for Server
 */

// Regex for standard RFC 5322-compatible email validation
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Checks if the string contains any alphabetical characters (a-z, A-Z)
 */
function containsLetters(str) {
    if (!str || typeof str !== 'string') return false;
    return /[a-zA-Z]/.test(str);
}

/**
 * Checks if email has valid format
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    return EMAIL_REGEX.test(trimmed);
}

/**
 * Checks if phone number is valid Vietnamese standard:
 * - Does NOT contain any letters or characters
 * - Only contains numbers (and optional leading +84)
 * - Has 10 digits starting with 0 (or +84 followed by 9 digits)
 */
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const trimmed = phone.trim();
    if (containsLetters(trimmed)) return false;

    // Normalize +84 to 0
    let normalized = trimmed;
    if (normalized.startsWith('+84')) {
        normalized = '0' + normalized.slice(3);
    } else if (normalized.startsWith('84') && normalized.length === 11) {
        normalized = '0' + normalized.slice(2);
    }

    // Must be exactly 10 digits, starting with 0
    return /^0[0-9]{9}$/.test(normalized);
}

/**
 * Validates email field and returns validation result with user-friendly message
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string' || !email.trim()) {
        return { isValid: false, message: 'Email không được để trống' };
    }
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
        return { isValid: false, message: 'Email không đúng định dạng (Ví dụ: user@example.com)' };
    }
    return { isValid: true };
}

/**
 * Validates phone field and returns validation result with user-friendly message
 */
function validatePhone(phone, isRequired = false) {
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
        if (isRequired) {
            return { isValid: false, message: 'Số điện thoại không được để trống' };
        }
        return { isValid: true };
    }
    const trimmed = phone.trim();
    if (containsLetters(trimmed)) {
        return { isValid: false, message: 'Số điện thoại không hợp lệ: Không được ghi chữ hoặc chứa chữ cái (Ví dụ: 0912345678)' };
    }
    if (!isValidPhone(trimmed)) {
        return { isValid: false, message: 'Số điện thoại không đúng định dạng: Phải gồm 10 chữ số, bắt đầu bằng số 0 (Ví dụ: 0912345678)' };
    }
    return { isValid: true };
}

module.exports = {
    EMAIL_REGEX,
    containsLetters,
    isValidEmail,
    isValidPhone,
    validateEmail,
    validatePhone
};
