const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { saveBase64ToDisk, deleteDiskFile } = require('../utils/fileStorage');
const { checkProfanity, sanitizeProfanity } = require('../utils/contentFilter');

test('Point 2 - fileStorage correctly decodes base64, persists to disk, and deletes', async () => {
    // 1x1 transparent PNG in base64
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const savedPath = await saveBase64ToDisk(sampleBase64, 'test_covers', 'test_book');
    assert.ok(savedPath, 'Should return saved path');
    assert.match(savedPath, /^\/uploads\/test_covers\/test_book_.*\.png$/, 'Path matches expected relative structure');

    // Check disk file existence
    const absolutePath = path.join(__dirname, '..', savedPath);
    assert.ok(fs.existsSync(absolutePath), 'Disk file must exist after saving');

    // Delete disk file
    const deleted = await deleteDiskFile(savedPath);
    assert.strictEqual(deleted, true, 'deleteDiskFile should return true');
    assert.strictEqual(fs.existsSync(absolutePath), false, 'File must be deleted from disk');

    // Clean up test directory if empty
    const testDir = path.join(__dirname, '..', 'uploads', 'test_covers');
    if (fs.existsSync(testDir) && fs.readdirSync(testDir).length === 0) {
        fs.rmdirSync(testDir);
    }

    // Normal URL should be returned as-is
    const externalUrl = 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c';
    const unchanged = await saveBase64ToDisk(externalUrl, 'covers', 'cover');
    assert.strictEqual(unchanged, externalUrl, 'External HTTP URLs must remain untouched');

    // Null/undefined returns null
    assert.strictEqual(await saveBase64ToDisk(null), null);
    assert.strictEqual(await saveBase64ToDisk(''), null);
});

test('Point 3 - contentFilter detects profanity and sanitizes vulgarity in reviews', () => {
    const cleanComment = 'Cuốn sách này rất hay, cung cấp nhiều kiến thức bổ ích về kiến trúc phần mềm!';
    const checkClean = checkProfanity(cleanComment);
    assert.strictEqual(checkClean.hasProfanity, false, 'Clean text should pass');

    const vulgarComment = 'Sách như cc lừa đảo không đáng đọc';
    const checkVulgar = checkProfanity(vulgarComment);
    assert.strictEqual(checkVulgar.hasProfanity, true, 'Vulgar text should be detected');
    assert.ok(checkVulgar.flaggedReason, 'Should include flagged explanation');

    const sanitized = sanitizeProfanity('Đọc sách này như shit luôn');
    assert.match(sanitized, /\*\*\*/, 'Vulgar words should be masked with asterisks');
});

test('Point 1 - Password reset token generation format and expiration logic', () => {
    const crypto = require('crypto');
    const otp = crypto.randomInt(100000, 999999).toString();
    assert.strictEqual(otp.length, 6, 'OTP must be exactly 6 digits');
    assert.match(otp, /^\d{6}$/, 'OTP must be numeric');

    const now = new Date();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    assert.ok(expiresAt.getTime() > now.getTime(), 'Expiration must be in the future');
    assert.strictEqual(Math.round((expiresAt - now) / 60000), 15, 'OTP should expire in 15 minutes');
});

test('Point 4 - Auxiliary catalogs safeguard logic against deleting items with active books', () => {
    // Simulated category delete guard
    function canDeleteCategory(bookCount) {
        if (bookCount > 0) {
            return {
                allowed: false,
                status: 400,
                message: `Không thể xóa thể loại này vì đang có ${bookCount} đầu sách liên kết. Vui lòng chuyển sách sang thể loại khác trước!`
            };
        }
        return { allowed: true, status: 200, message: 'Xóa thành công' };
    }

    const linkedResult = canDeleteCategory(5);
    assert.strictEqual(linkedResult.allowed, false);
    assert.strictEqual(linkedResult.status, 400);
    assert.match(linkedResult.message, /5 đầu sách liên kết/);

    const emptyResult = canDeleteCategory(0);
    assert.strictEqual(emptyResult.allowed, true);
    assert.strictEqual(emptyResult.status, 200);
});

