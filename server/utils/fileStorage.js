const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

/**
 * Ensures target directory exists under uploads
 */
function ensureDirExists(targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
}

/**
 * Parses and saves a base64 data URI image to disk, returning its relative URL path.
 * If input is already an existing URL or path (e.g. starts with '/uploads' or 'http'), returns as-is.
 *
 * @param {string} payload - Base64 data URI string or existing URL
 * @param {string} subfolder - Target subfolder inside uploads (e.g. 'covers', 'proofs', 'avatars')
 * @param {string} prefix - Filename prefix (e.g. 'cover', 'proof', 'avatar')
 * @returns {Promise<string|null>} Relative path '/uploads/<subfolder>/<filename>' or original URL
 */
async function saveBase64ToDisk(payload, subfolder = 'general', prefix = 'file') {
    if (!payload || typeof payload !== 'string') {
        return null;
    }

    const trimmed = payload.trim();
    if (!trimmed.startsWith('data:image/')) {
        // Already a normal URL or relative path
        return trimmed;
    }

    const match = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) {
        return trimmed;
    }

    let ext = match[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'svg+xml') ext = 'svg';

    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const targetFolder = path.join(BASE_UPLOAD_DIR, subfolder);
    ensureDirExists(targetFolder);

    const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `${safePrefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const filePath = path.join(targetFolder, filename);

    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${subfolder}/${filename}`;
}

/**
 * Safely removes a file from disk if it points to a local upload path.
 *
 * @param {string} relativePath - Path such as '/uploads/proofs/file_123.jpg'
 * @returns {Promise<boolean>}
 */
async function deleteDiskFile(relativePath) {
    if (!relativePath || typeof relativePath !== 'string' || !relativePath.startsWith('/uploads/')) {
        return false;
    }

    try {
        const cleanPath = relativePath.replace(/^\/uploads\//, '');
        const targetPath = path.resolve(BASE_UPLOAD_DIR, cleanPath);

        // Security check: ensure target path is within BASE_UPLOAD_DIR (no directory traversal)
        if (!targetPath.startsWith(path.resolve(BASE_UPLOAD_DIR))) {
            return false;
        }

        if (fs.existsSync(targetPath)) {
            await fs.promises.unlink(targetPath);
            return true;
        }
    } catch (err) {
        // Silently ignore deletion errors
    }
    return false;
}

module.exports = {
    BASE_UPLOAD_DIR,
    saveBase64ToDisk,
    deleteDiskFile
};

