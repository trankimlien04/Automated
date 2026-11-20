/**
 * Content moderation utility for user comments and reviews.
 * Detects vulgarity, abusive language, and inappropriate slurs.
 */

// Normalized sensitive keywords (lowercase, accents removed or with accents)
const PROFANITY_PATTERNS = [
    /\b(đụ|đụ má|đụ mẹ|đm|dcm|đcm|vcl|vcll|vl|đéo|đếch|vãi lồn|lồn|buồi|cặc|chó đẻ|óc chó|đĩ|con đĩ|bú liếm)\b/i,
    /\b(fuck|shit|bitch|asshole|bastard|dick|pussy)\b/i,
    /\b(lừa đảo|scam|mất dạy|khốn nạn|súc vật|bố láo)\b/i
];

/**
 * Checks whether text contains flagged words.
 * @param {string} text
 * @returns {{ hasProfanity: boolean, flaggedReason?: string }}
 */
function checkProfanity(text) {
    if (!text || typeof text !== 'string') {
        return { hasProfanity: false };
    }

    const trimmed = text.trim();
    for (const pattern of PROFANITY_PATTERNS) {
        if (pattern.test(trimmed)) {
            return {
                hasProfanity: true,
                flaggedReason: 'Bình luận chứa từ ngữ không phù hợp với chuẩn mực văn hóa thư viện'
            };
        }
    }

    return { hasProfanity: false };
}

/**
 * Sanitizes profane words by replacing them with ***
 * @param {string} text
 * @returns {string}
 */
function sanitizeProfanity(text) {
    if (!text || typeof text !== 'string') return '';
    let result = text;
    for (const pattern of PROFANITY_PATTERNS) {
        result = result.replace(pattern, '***');
    }
    return result;
}

module.exports = {
    checkProfanity,
    sanitizeProfanity
};

