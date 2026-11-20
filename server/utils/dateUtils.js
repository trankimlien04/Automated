const LIBRARY_TIMEZONE = process.env.LIBRARY_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';

/**
 * Format a Date (or date-like value) as YYYY-MM-DD in the library's local timezone
 * to avoid UTC midnight skew against MySQL CURDATE().
 */
function toLocalDateString(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: LIBRARY_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/**
 * Add (or subtract) calendar days on a YYYY-MM-DD date string without timezone drift.
 */
function addDaysToDateString(dateStr, deltaDays = 0) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    if (!match) return '';
    const [, y, m, d] = match;
    const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + Number(deltaDays || 0)));
    return utc.toISOString().slice(0, 10);
}

/**
 * Format a Date or YYYY-MM-DD string as DD/MM/YYYY in the library's local timezone.
 */
function formatLocalDateVN(input) {
    const iso = toLocalDateString(input);
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Escape HTML special characters before interpolating user data into email templates.
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

module.exports = {
    LIBRARY_TIMEZONE,
    toLocalDateString,
    addDaysToDateString,
    formatLocalDateVN,
    escapeHtml,
};

