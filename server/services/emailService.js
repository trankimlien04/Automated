const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../config/db');
const { escapeHtml, formatLocalDateVN, LIBRARY_TIMEZONE } = require('../utils/dateUtils');
const { getJwtSecret } = require('../middlewares/authMiddleware');
const { isValidEmail } = require('../utils/validators');

const FRONTEND_BASE_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const buildFrontendUrl = (path = '') => `${FRONTEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const PLACEHOLDER_PATTERN = /^(your_|example|changeme|<|demo_)/i;
const SYNTHETIC_DOMAIN_PATTERN = /@(?:[^@]+\.(?:local|invalid|localhost)|example\.com|library\.com)$/i;

let cachedFingerprint = null;
let cachedTransporter = null;

function isPlaceholderSmtpValue(value) {
    if (value === null || value === undefined) return true;
    const trimmed = String(value).trim();
    if (!trimmed) return true;
    if (PLACEHOLDER_PATTERN.test(trimmed)) return true;
    if (trimmed === 'your_library_notification_email@gmail.com' || trimmed === 'your_app_password_here') {
        return true;
    }
    return false;
}

function normalizeSmtpPassword(host, rawPass) {
    const pass = String(rawPass || '').trim();
    if (String(host || '').toLowerCase().includes('gmail')) {
        const compact = pass.replace(/\s+/g, '');
        if (/^[a-z0-9]{16}$/i.test(compact)) {
            return compact;
        }
    }
    return pass;
}

function maskEmail(email) {
    const trimmed = String(email || '').trim();
    const atIdx = trimmed.indexOf('@');
    if (atIdx <= 0) return trimmed ? '***' : '';
    const local = trimmed.slice(0, atIdx);
    const domain = trimmed.slice(atIdx);
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***${domain}`;
}

function getEncryptionKey() {
    let secret;
    try {
        secret = getJwtSecret();
    } catch {
        secret = 'smart_library_fallback_smtp_key_2026';
    }
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptSecret(plainText) {
    const value = String(plainText || '');
    if (!value) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `aes256gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload) {
    if (!payload || typeof payload !== 'string') return '';
    if (!payload.startsWith('aes256gcm:')) return payload;
    try {
        const parts = payload.split(':');
        if (parts.length !== 4) return '';
        const [, ivHex, tagHex, dataHex] = parts;
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            getEncryptionKey(),
            Buffer.from(ivHex, 'hex')
        );
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(dataHex, 'hex')),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    } catch {
        return '';
    }
}

function resolveEnvSmtpConfig() {
    const host = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
    const port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10) || 587;
    const rawSecure = process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
        ? process.env.SMTP_SECURE
        : process.env.EMAIL_SECURE;
    const secure = rawSecure !== undefined && rawSecure !== ''
        ? String(rawSecure).toLowerCase() === 'true'
        : port === 465;
    const user = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
    const pass = normalizeSmtpPassword(
        host,
        process.env.SMTP_PASS || process.env.EMAIL_PASS || ''
    );
    const from = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || '').trim();

    if (isPlaceholderSmtpValue(host) || isPlaceholderSmtpValue(user) || isPlaceholderSmtpValue(pass)) {
        return null;
    }

    return {
        source: 'env',
        host,
        port,
        secure,
        user,
        pass,
        from: from || `Athenaeum Smart Library <${user}>`,
    };
}

async function resolveActiveSmtpConfig() {
    try {
        const [rows] = await db.execute(
            'SELECT host, port, secure, username, password_encrypted, from_address FROM email_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
        );
        if (Array.isArray(rows) && rows.length > 0 && rows[0]?.host && rows[0]?.username) {
            const decryptedPass = normalizeSmtpPassword(rows[0].host, decryptSecret(rows[0].password_encrypted));
            if (decryptedPass) {
                const port = parseInt(rows[0].port || '587', 10) || 587;
                return {
                    source: 'database',
                    host: String(rows[0].host).trim(),
                    port,
                    secure: Boolean(rows[0].secure),
                    user: String(rows[0].username).trim(),
                    pass: decryptedPass,
                    from: String(rows[0].from_address || '').trim() || `Athenaeum Smart Library <${String(rows[0].username).trim()}>`,
                };
            }
        }
    } catch {
        // Bỏ qua lỗi khi bảng chưa khởi tạo hoặc trong môi trường unit test mock DB
    }

    return resolveEnvSmtpConfig();
}

function invalidateTransporterCache() {
    cachedFingerprint = null;
    cachedTransporter = null;
}

function getOrCreateTransporter(cfg) {
    const fingerprint = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.pass}`;
    if (cachedTransporter && cachedFingerprint === fingerprint) {
        return cachedTransporter;
    }
    cachedFingerprint = fingerprint;
    cachedTransporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: Boolean(cfg.secure),
        auth: {
            user: cfg.user,
            pass: cfg.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
    });
    return cachedTransporter;
}

function formatSmtpError(error, host = '') {
    const raw = String(error?.message || error || 'Lỗi kết nối SMTP không xác định');
    const lower = raw.toLowerCase();
    if (lower.includes('535') || lower.includes('invalid login') || lower.includes('eauth') || lower.includes('badcredentials') || lower.includes('username and password not accepted')) {
        if (String(host).toLowerCase().includes('gmail')) {
            return 'Xác thực Gmail thất bại (535). Với Gmail, bạn cần bật "Xác minh 2 bước" và tạo "Mật khẩu ứng dụng (App Password 16 ký tự)" thay cho mật khẩu đăng nhập Gmail thông thường.';
        }
        return 'Sai tên đăng nhập hoặc mật khẩu SMTP (535 Authentication failed).';
    }
    if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('etimedout') || lower.includes('esocket')) {
        return `Không thể kết nối tới máy chủ SMTP (${host || 'host'}): ${raw}`;
    }
    return raw;
}

async function getSmtpStatus() {
    const active = await resolveActiveSmtpConfig();
    if (!active) {
        const rawHost = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com').trim();
        const rawPort = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587', 10) || 587;
        return {
            configured: false,
            mode: 'simulated',
            source: 'none',
            host: rawHost,
            port: rawPort,
            secure: rawPort === 465,
            userMasked: '',
            user: '',
            fromAddress: 'Athenaeum Smart Library <no-reply@athenaeum.edu.vn>',
            hasPassword: false,
            timezone: LIBRARY_TIMEZONE,
        };
    }
    return {
        configured: true,
        mode: 'smtp_real',
        source: active.source,
        host: active.host,
        port: active.port,
        secure: Boolean(active.secure),
        userMasked: maskEmail(active.user),
        user: active.user,
        fromAddress: active.from,
        hasPassword: true,
        timezone: LIBRARY_TIMEZONE,
    };
}

async function verifySmtpConnection(candidateConfig = null) {
    const cfg = candidateConfig || (await resolveActiveSmtpConfig());
    if (!cfg) {
        return {
            ok: false,
            configured: false,
            error: 'Chưa có cấu hình SMTP hợp lệ để kiểm tra.',
        };
    }
    try {
        const testTransporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: Boolean(cfg.secure),
            auth: {
                user: cfg.user,
                pass: cfg.pass,
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
        });
        await testTransporter.verify();
        return {
            ok: true,
            configured: true,
            host: cfg.host,
            port: cfg.port,
            userMasked: maskEmail(cfg.user),
        };
    } catch (error) {
        return {
            ok: false,
            configured: true,
            error: formatSmtpError(error, cfg.host),
        };
    }
}

async function saveSmtpConfig({ host, port = 587, secure, user, pass, fromAddress, updatedBy }) {
    const cleanHost = String(host || '').trim();
    const parsedPort = parseInt(port, 10) || 587;
    const resolvedSecure = secure !== undefined ? Boolean(secure) : parsedPort === 465;
    const cleanUser = String(user || '').trim();

    if (!cleanHost || !cleanUser) {
        return { success: false, status: 400, message: 'Vui lòng nhập đầy đủ SMTP Host và Email/Tài khoản gửi.' };
    }

    let resolvedPass = normalizeSmtpPassword(cleanHost, pass);
    if (!resolvedPass) {
        const active = await resolveActiveSmtpConfig();
        if (active && active.user === cleanUser && active.pass) {
            resolvedPass = active.pass;
        }
    }

    if (!resolvedPass || isPlaceholderSmtpValue(resolvedPass)) {
        return { success: false, status: 400, message: 'Vui lòng nhập Mật khẩu SMTP / Google App Password.' };
    }

    const cleanFrom = String(fromAddress || '').trim() || `Athenaeum Smart Library <${cleanUser}>`;
    const check = await verifySmtpConnection({
        host: cleanHost,
        port: parsedPort,
        secure: resolvedSecure,
        user: cleanUser,
        pass: resolvedPass,
    });

    if (!check.ok) {
        return { success: false, status: 400, message: check.error };
    }

    const encryptedPass = encryptSecret(resolvedPass);
    await db.execute('UPDATE email_settings SET is_active = 0 WHERE is_active = 1');
    await db.execute(
        `INSERT INTO email_settings (host, port, secure, username, password_encrypted, from_address, updated_by, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [cleanHost, parsedPort, resolvedSecure ? 1 : 0, cleanUser, encryptedPass, cleanFrom, updatedBy || null]
    );
    invalidateTransporterCache();

    return {
        success: true,
        status: 200,
        message: `Đã xác thực kết nối SMTP (${cleanHost}) và kích hoạt gửi email thực tế thành công!`,
        smtpStatus: await getSmtpStatus(),
    };
}

async function clearSmtpConfig() {
    await db.execute('UPDATE email_settings SET is_active = 0 WHERE is_active = 1');
    invalidateTransporterCache();
    return await getSmtpStatus();
}

/**
 * Base email layout with Athenaeum Smart Library 4.0 branding
 */
function createEmailTemplate({ headerBadge, headerTitle, subtitle, contentHtml, actionButtonText, actionButtonUrl }) {
    return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${headerTitle}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
            .container { max-width: 600px; margin: 24px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0; }
            .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #2563eb 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
            .badge { display: inline-block; padding: 4px 12px; background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
            .title { font-size: 22px; font-weight: 800; margin: 0 0 6px 0; color: #ffffff; }
            .subtitle { font-size: 13px; opacity: 0.9; margin: 0; color: #cbd5e1; }
            .body { padding: 28px 24px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0; }
            .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; text-align: center; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
            .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
            .footer p { margin: 4px 0; }
            .highlight { color: #2563eb; font-weight: 700; }
            .danger { color: #dc2626; font-weight: 700; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <span class="badge">${headerBadge || 'Smart Library 4.0'}</span>
                <h1 class="title">📚 Athenaeum Library</h1>
                <p class="subtitle">${subtitle || 'Hệ thống Quản lý Thư viện Thông minh'}</p>
            </div>
            <div class="body">
                ${contentHtml}
                ${actionButtonText && actionButtonUrl ? (
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(String(actionButtonUrl))
                ? `<div style="margin-top: 20px; padding: 12px 16px; border-radius: 8px; background: #eff6ff; border: 1px solid #bfdbfe; text-align: center; font-size: 13px; color: #1e3a8a;">💻 <strong>${escapeHtml(actionButtonText)}:</strong> Mở hệ thống Thư viện Athenaeum trên trình duyệt của bạn để tiếp tục.</div>`
                : `<div style="text-align: center; margin-top: 24px;"><a href="${actionButtonUrl}" class="btn">${actionButtonText}</a></div>`
        ) : ''}
            </div>
            <div class="footer">
                <p><strong>Thư viện Thông minh Athenaeum</strong> - Phục vụ lưu thông 24/7</p>
                <p>Hòm trả sách thông minh 24/7 luôn sẵn sàng ngoài giờ hành chính tại Cổng chính thư viện.</p>
                <p style="font-size: 11px; color: #94a3b8; margin-top: 10px;">Email tự động từ hệ thống. Vui lòng không trả lời trực tiếp email này.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Record dispatch log into notification_dispatches table
 */
async function hasDispatchedByDedupKey(dedupKey) {
    const cleanKey = String(dedupKey || '').trim();
    if (!cleanKey) return false;
    try {
        const [rows] = await db.execute(
            `SELECT id FROM notification_dispatches
             WHERE dedup_key = ? AND status IN ('delivered', 'simulated', 'sent')
             LIMIT 1`,
            [cleanKey]
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

async function recordDispatch({
    userId,
    recipientEmail,
    channel = 'email',
    templateType,
    title,
    contentPreview,
    status = 'sent',
    errorMessage = null,
    dedupKey = null,
    eventType = null,
}) {
    try {
        await db.execute(`
            INSERT INTO notification_dispatches 
            (user_id, recipient_email, channel, template_type, title, content_preview, status, error_message, dedup_key, event_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId || null,
            recipientEmail,
            channel,
            templateType,
            title,
            (contentPreview || '').substring(0, 500),
            status,
            errorMessage,
            dedupKey ? String(dedupKey).slice(0, 191) : null,
            eventType ? String(eventType).slice(0, 64) : (templateType ? String(templateType).slice(0, 64) : null),
        ]);
    } catch (err) {
        console.error('Lỗi khi ghi nhật ký dispatch thông báo:', err.message);
    }
}

/**
 * Dispatch an email (real SMTP when configured, else honest simulated fallback)
 */
async function sendEmail({
    to,
    subject,
    html,
    text,
    templateType = 'general',
    userId = null,
    dedupKey = null,
    eventType = null,
}) {
    const cleanTo = String(to || '').trim();
    if (!cleanTo || !isValidEmail(cleanTo)) {
        return { success: false, mode: 'invalid', message: 'Địa chỉ email người nhận không hợp lệ' };
    }

    if (dedupKey && await hasDispatchedByDedupKey(dedupKey)) {
        return {
            success: true,
            mode: 'dedup_skipped',
            skippedDuplicate: true,
            dedupKey,
            message: 'Bỏ qua gửi trùng email đã phát hành trước đó',
        };
    }

    const activeConfig = await resolveActiveSmtpConfig();

    if (activeConfig) {
        if (SYNTHETIC_DOMAIN_PATTERN.test(cleanTo)) {
            const skipMsg = 'Bỏ qua gửi SMTP thực tế tới địa chỉ thử nghiệm nội bộ (.local/.invalid/.localhost).';
            await recordDispatch({
                userId,
                recipientEmail: cleanTo,
                channel: 'email',
                templateType,
                title: subject,
                contentPreview: text || subject,
                status: 'failed',
                errorMessage: skipMsg,
                dedupKey,
                eventType,
            });
            return { success: false, mode: 'smtp_real', error: skipMsg };
        }

        try {
            const transporter = getOrCreateTransporter(activeConfig);
            const info = await transporter.sendMail({
                from: activeConfig.from,
                to: cleanTo,
                subject,
                text: text || subject,
                html,
            });
            await recordDispatch({
                userId,
                recipientEmail: cleanTo,
                channel: 'email',
                templateType,
                title: subject,
                contentPreview: text || subject,
                status: 'delivered',
                dedupKey,
                eventType,
            });
            console.log(`📧 [EMAIL SENT] Successfully sent real email to ${cleanTo}: "${subject}" (MessageID: ${info.messageId})`);
            return { success: true, mode: 'smtp_real', messageId: info.messageId };
        } catch (error) {
            const friendlyErr = formatSmtpError(error, activeConfig.host);
            console.error(`❌ [EMAIL ERROR] Failed to send email to ${cleanTo}:`, friendlyErr);
            await recordDispatch({
                userId,
                recipientEmail: cleanTo,
                channel: 'email',
                templateType,
                title: subject,
                contentPreview: text || subject,
                status: 'failed',
                errorMessage: friendlyErr,
                dedupKey,
                eventType,
            });
            return { success: false, mode: 'smtp_real', error: friendlyErr };
        }
    }

    // Chế độ mô phỏng khi chưa cấu hình SMTP thực tế
    console.log(`✉️ [EMAIL SIMULATED] Dispatching to [${cleanTo}] | Subject: "${subject}" | Template: [${templateType}]`);
    await recordDispatch({
        userId,
        recipientEmail: cleanTo,
        channel: 'email',
        templateType,
        title: subject,
        contentPreview: text || subject,
        status: 'simulated',
        dedupKey,
        eventType,
    });
    return {
        success: true,
        mode: 'simulated',
        message: 'Chưa cấu hình SMTP thực tế — email chỉ mới được ghi nhận ở chế độ Mô phỏng',
    };
}

/**
 * Kịch bản 1: Nhắc nhở sắp đến hạn trả sách theo một mốc duy nhất (T - 2 ngày), gộp theo độc giả
 */
async function sendDueReminderEmail({
    to,
    userId,
    fullName,
    cardNumber,
    bookTitle = null,
    copyQr = null,
    dueDate,
    daysLeft = 2,
    books = null,
    dedupKey = null,
}) {
    const normalizedBooks = Array.isArray(books) && books.length > 0
        ? books.map((b) => ({
            bookTitle: b.bookTitle || b.title || 'Tài liệu thư viện',
            copyQr: b.copyQr || b.qrCode || b.qr_code || 'N/A',
            dueDate: b.dueDate || b.due_date || dueDate,
        }))
        : [{
            bookTitle: bookTitle || 'Tài liệu thư viện',
            copyQr: copyQr || 'N/A',
            dueDate,
        }];

    const primaryDueDate = normalizedBooks[0]?.dueDate || dueDate;
    const dueDateStr = formatLocalDateVN(primaryDueDate);
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || 'LIB-RD-***');
    const bookCount = normalizedBooks.length;

    const subject = bookCount > 1
        ? `⏰ [Nhắc hạn trả sách] Bạn có ${bookCount} cuốn sách sắp đến hạn trả ngày ${dueDateStr}`
        : `⏰ [Nhắc hạn trả sách] Cuốn "${normalizedBooks[0].bookTitle}" sắp đến hạn trả trong ${daysLeft} ngày`;

    const booksHtml = bookCount > 1
        ? `
        <p>Bạn có <strong>${bookCount} cuốn sách</strong> sắp đến hạn trả vào ngày <span class="highlight">${dueDateStr}</span> (còn <strong>${daysLeft} ngày</strong>):</p>
        <div class="card">
            <ol style="margin: 0; padding-left: 20px;">
                ${normalizedBooks.map((item) => `
                    <li style="margin: 6px 0; font-size: 13px; color: #1e293b;">
                        <strong>${escapeHtml(item.bookTitle)}</strong>
                        ${item.copyQr && item.copyQr !== 'N/A' ? ` — Mã bản sao: <code>${escapeHtml(item.copyQr)}</code>` : ''}
                    </li>
                `).join('')}
            </ol>
            <p style="margin: 10px 0 0; font-size: 12px; color: #059669;"><strong>Trạng thái:</strong> Trong hạn mượn an toàn</p>
        </div>
        `
        : `
        <p>Hệ thống Thư viện Thông minh Athenaeum xin gửi lời chào và nhắc nhở thân thiện về tài liệu bạn đang mượn:</p>
        <div class="card">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">📖 ${escapeHtml(normalizedBooks[0].bookTitle)}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao (QR):</strong> <code>${escapeHtml(normalizedBooks[0].copyQr)}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Hạn hoàn trả:</strong> <span class="highlight">${dueDateStr}</span> (Còn <strong>${daysLeft} ngày</strong>)</p>
            <p style="margin: 4px 0; font-size: 13px; color: #059669;"><strong>Trạng thái:</strong> Trong hạn mượn an toàn</p>
        </div>
        `;

    const contentHtml = `
        <p>Xin chào <strong>${safeName}</strong> (Mã thẻ: <code>${safeCard}</code>),</p>
        ${booksHtml}
        <p>Vui lòng hoàn trả đúng hạn tại quầy thủ thư hoặc <strong>Hòm trả sách 24/7</strong> để tránh bị tạm ngưng quyền mượn, hoặc truy cập cổng thông tin để bấm <strong>Gia hạn thêm 7 ngày</strong> nếu sách chưa có người đặt trước.</p>
    `;

    const textSummary = bookCount > 1
        ? `Nhắc nhở: Bạn có ${bookCount} cuốn sách sắp đến hạn trả vào ${dueDateStr}: ${normalizedBooks.map((b, i) => `${i + 1}. ${b.bookTitle}`).join('; ')}.`
        : `Nhắc nhở: Sách "${normalizedBooks[0].bookTitle}" sắp đến hạn vào ${dueDateStr}. Vui lòng sắp xếp hoàn trả hoặc gia hạn.`;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Nhắc hạn trả sách (T - 2 ngày)',
            subtitle: 'Chăm sóc bạn đọc & Lưu thông tài liệu',
            contentHtml,
            actionButtonText: 'Xem sách đang mượn & Gia hạn trực tuyến',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'due_reminder_t2',
        eventType: 'due_reminder_t2',
        dedupKey,
        text: textSummary,
    });
}

/**
 * Kịch bản 2: Hạn chót trả sách hôm nay (T - 0 ngày)
 */
async function sendDueTodayEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, dueDate }) {
    const dueDateStr = formatLocalDateVN(dueDate);
    const subject = `⚠️ [HẠN CHÓT HÔM NAY] Cuốn "${bookTitle}" đến hạn trả hôm nay`;
    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Hôm nay (<strong>${dueDateStr}</strong>) là <strong style="color: #ea580c;">HẠN CHÓT</strong> để hoàn trả ấn phẩm sau đây về thư viện:</p>
        
        <div class="card" style="border-left: 4px solid #ea580c;">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">📖 ${escapeHtml(bookTitle)}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${escapeHtml(copyQr || 'N/A')}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Hạn cuối:</strong> <span style="color: #ea580c; font-weight: 700;">Hôm nay (${dueDateStr})</span></p>
        </div>

        <p>🌟 <strong>Nếu bạn bận hoặc trả ngoài giờ hành chính:</strong> Bạn hoàn toàn có thể thả sách vào <strong>Hòm trả sách tự động 24/7 (Smart Book Drop)</strong> tại sảnh trước thư viện. Hệ thống sẽ ngay lập tức chốt mốc thời gian trả hợp lệ và không phát sinh thêm ngày trễ hạn!</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Hạn chót trả sách hôm nay (T - 0)',
            subtitle: 'Lưu ý hoàn trả đúng hạn để tránh tạm ngưng quyền mượn theo quy chế',
            contentHtml,
            actionButtonText: 'Xem hướng dẫn Trả hòm 24/7 & Bản đồ thư viện',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'due_today_t0',
        text: `Hôm nay là hạn chót trả sách "${bookTitle}". Vui lòng hoàn trả tại quầy hoặc thả vào Hòm trả 24/7.`
    });
}

/**
 * Kịch bản 3: Cảnh báo quá hạn & Tạm khóa quyền mượn (Ngày đầu quá hạn, hỗ trợ gộp theo độc giả)
 */
async function sendOverdueWarningEmail({
    to,
    userId,
    fullName,
    cardNumber,
    bookTitle = null,
    copyQr = null,
    dueDate,
    overdueDays = 1,
    books = null,
    dedupKey = null,
}) {
    const normalizedBooks = Array.isArray(books) && books.length > 0
        ? books.map((b) => ({
            bookTitle: b.bookTitle || b.title || 'Tài liệu thư viện',
            copyQr: b.copyQr || b.qrCode || b.qr_code || 'N/A',
            dueDate: b.dueDate || b.due_date || dueDate,
            overdueDays: Number(b.overdueDays || b.overdue_days || overdueDays || 1),
        }))
        : [{
            bookTitle: bookTitle || 'Tài liệu thư viện',
            copyQr: copyQr || 'N/A',
            dueDate,
            overdueDays: Number(overdueDays || 1),
        }];

    const maxOverdue = Math.max(...normalizedBooks.map((b) => b.overdueDays || 1));
    const bookCount = normalizedBooks.length;
    const dueDateStr = formatLocalDateVN(normalizedBooks[0]?.dueDate || dueDate);

    const subject = bookCount > 1
        ? `🚨 [CẢNH BÁO QUÁ HẠN] Bạn có ${bookCount} cuốn sách đã quá hạn trả`
        : `🚨 [CẢNH BÁO QUÁ HẠN] Sách "${normalizedBooks[0].bookTitle}" đã quá hạn ${maxOverdue} ngày`;

    const bodyCardsHtml = bookCount > 1
        ? `
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            <p style="margin: 0 0 8px; font-size: 13px; color: #991b1b;"><strong>Danh sách ${bookCount} tài liệu quá hạn chưa hoàn trả:</strong></p>
            <ol style="margin: 0; padding-left: 20px;">
                ${normalizedBooks.map((item) => `
                    <li style="margin: 6px 0; font-size: 13px; color: #7f1d1d;">
                        <strong>${escapeHtml(item.bookTitle)}</strong>
                        ${item.copyQr && item.copyQr !== 'N/A' ? ` (<code>${escapeHtml(item.copyQr)}</code>)` : ''}
                        — Hạn: ${formatLocalDateVN(item.dueDate)} (<span class="danger">trễ ${item.overdueDays} ngày</span>)
                    </li>
                `).join('')}
            </ol>
            <p style="margin: 10px 0 0; font-size: 14px;"><strong>Trạng thái lưu thông:</strong> <span class="danger">Tạm khóa quyền mượn &amp; đặt trước sách</span></p>
        </div>
        `
        : `
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            <h3 style="margin-top: 0; color: #991b1b; font-size: 16px;">📖 ${escapeHtml(normalizedBooks[0].bookTitle)}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${escapeHtml(normalizedBooks[0].copyQr)}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Ngày đến hạn:</strong> ${dueDateStr}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Số ngày trễ hạn:</strong> <span class="danger">${normalizedBooks[0].overdueDays} ngày</span></p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Trạng thái lưu thông:</strong> <span class="danger">Tạm khóa quyền mượn &amp; đặt trước sách</span></p>
        </div>
        `;

    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Hệ thống ghi nhận bạn đang giữ tài liệu đã quá hạn quy định của thư viện:</p>
        ${bodyCardsHtml}
        <p class="danger">⚠️ Lưu ý quy chế kỷ luật mượn: Thẻ đang ở trạng thái tạm khóa cho đến khi bạn hoàn trả hết sách quá hạn. Sau khi hoàn trả trễ, hệ thống sẽ áp dụng số ngày tạm ngưng quyền mượn tương ứng theo quy chế thư viện. Vui lòng hoàn trả sách sớm tại Quầy hoặc Hòm trả 24/7!</p>
    `;

    const textSummary = bookCount > 1
        ? `Cảnh báo: Bạn có ${bookCount} cuốn sách quá hạn (${normalizedBooks.map((b, i) => `${i + 1}. ${b.bookTitle}`).join('; ')}). Quyền mượn/đặt trước đang tạm khóa cho đến khi hoàn trả.`
        : `Cảnh báo: Sách "${normalizedBooks[0].bookTitle}" đã quá hạn ${normalizedBooks[0].overdueDays} ngày. Quyền mượn/đặt trước đang tạm khóa cho đến khi bạn hoàn trả sách.`;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Cảnh báo quá hạn & Kỷ luật mượn',
            subtitle: 'Đôn đốc thu hồi tài nguyên thư viện',
            contentHtml,
            actionButtonText: 'Xem hồ sơ vi phạm & Thời hạn trả',
            actionButtonUrl: buildFrontendUrl('/fines')
        }),
        templateType: 'overdue_warning',
        eventType: 'overdue_day1',
        dedupKey,
        text: textSummary,
    });
}

/**
 * Kịch bản 4: Biên nhận trả sách qua Hòm tự động 24/7 (Smart Book Drop Receipt)
 */
async function sendDropBoxReceiptEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, droppedAt, dedupKey = null }) {
    const timeStr = new Date(droppedAt || Date.now()).toLocaleString('vi-VN');
    const subject = `📦 [Hòm trả sách 24/7] Xác nhận đã thả sách "${bookTitle}" vào hòm`;
    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Hệ thống tự động ghi nhận bạn vừa hoàn tất thao tác thả sách vào <strong>Hòm trả sách ngoài giờ 24/7 (Smart Book Drop)</strong>:</p>
        
        <div class="card" style="border-left: 4px solid #0284c7; background: #f0f9ff;">
            <h3 style="margin-top: 0; color: #0369a1; font-size: 16px;">📖 ${escapeHtml(bookTitle)}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${escapeHtml(copyQr || 'N/A')}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Thời điểm thả hòm:</strong> <span class="highlight">${timeStr}</span></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Chốt mốc hoàn trả:</strong> <span style="color: #059669; font-weight: 700;">Đã ngưng tính thêm ngày trễ hạn tại mốc thời gian trên</span></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Trạng thái:</strong> ⏳ Đang chờ thủ thư kiểm tra tình trạng sách đầu ca sáng</p>
        </div>

        <p>Thủ thư sẽ kiểm tra tình trạng nguyên vẹn của sách vào đầu ca làm việc tiếp theo. Bạn sẽ nhận được thông báo trong hệ thống ngay khi sách được đối soát xong.</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Hòm trả sách 24/7 - Biên nhận tiếp nhận',
            subtitle: 'Xác nhận tiếp nhận sách trả tự động ngoài giờ',
            contentHtml,
            actionButtonText: 'Kiểm tra trạng thái phiếu mượn',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'drop_box_receipt',
        eventType: 'drop_box_receipt',
        dedupKey,
        text: `Đã ghi nhận thả sách "${bookTitle}" vào hòm 24/7 lúc ${timeStr}.`
    });
}

/**
 * Kịch bản 4B: Kết quả Thủ thư đối soát Hòm trả sách 24/7 (Chỉ gửi email khi phát hiện sự cố hư hỏng/mất)
 */
async function sendDropBoxAuditResultEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, action, auditorName, auditNote, severity = 'moderate', remediationAction = '', auditedAt, dedupKey = null }) {
    const timeStr = new Date(auditedAt || Date.now()).toLocaleString('vi-VN');
    let subject = `✅ [Kết quả đối soát Hòm 24/7] Đã xác nhận trả sách "${bookTitle}" thành công`;
    let headerBadge = 'Hoàn tất đối soát Hòm 24/7';
    let cardBorder = '#059669';
    let cardBg = '#ecfdf5';
    let statusHtml = `<span style="color: #059669; font-weight: 700;">✅ Đã kiểm nhận nguyên vẹn & Nhập kho</span>`;
    let extraHtml = `<p>Giao dịch hoàn trả cuốn sách của bạn đã chính thức hoàn tất. Cảm ơn bạn đã giữ gìn ấn phẩm của thư viện!</p>`;

    if (action === 'report_damaged') {
        subject = `⚠️ [Biên bản đối soát Hòm 24/7] Phát hiện hư hại sách "${bookTitle}"`;
        headerBadge = 'Biên bản hư hại sách - Hòm 24/7';
        cardBorder = '#d97706';
        cardBg = '#fffbeb';
        statusHtml = `<span style="color: #d97706; font-weight: 700;">⚠️ Đã nhận sách - Ghi nhận hư hại (${escapeHtml(severity)}) • Chờ khắc phục</span>`;
        extraHtml = `<p class="danger">Hướng xử lý: <strong>${escapeHtml(remediationAction || 'Khắc phục hoặc nộp sách thay thế tương đương theo quy chế thư viện')}</strong>. Quyền mượn & đặt trước tạm ngưng cho đến khi thủ thư xác nhận bạn đã hoàn tất khắc phục tại mục <strong>Vi phạm & Kỷ luật mượn</strong>.</p>`;
    } else if (action === 'report_missing') {
        subject = `🚨 [Cảnh báo đối soát Hòm 24/7] Không tìm thấy sách "${bookTitle}" trong hòm`;
        headerBadge = 'Cảnh báo thất lạc - Hòm 24/7';
        cardBorder = '#dc2626';
        cardBg = '#fef2f2';
        statusHtml = `<span style="color: #dc2626; font-weight: 700;">🚨 Không tìm thấy sách trong hòm (Hoàn tác về Đang mượn)</span>`;
        extraHtml = `<p class="danger">Phiếu mượn đã được hoàn tác về trạng thái <strong>ĐANG MƯỢN</strong>. Vui lòng mang ảnh minh chứng đến quầy thủ thư để đối chiếu camera và xử lý ngay!</p>`;
    }

    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Thủ thư vừa hoàn tất kiểm kê và đối soát cuốn sách bạn gửi qua <strong>Hòm trả sách 24/7</strong> với kết quả chi tiết như sau:</p>
        
        <div class="card" style="border-left: 4px solid ${cardBorder}; background: ${cardBg};">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">📖 ${escapeHtml(bookTitle)}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${escapeHtml(copyQr || 'N/A')}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Kết quả xác nhận:</strong> ${statusHtml}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Thủ thư xác nhận:</strong> ${escapeHtml(auditorName || 'Thủ thư trực ca')}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Thời điểm xác nhận:</strong> ${timeStr}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Ghi chú kiểm kê:</strong> <em>"${escapeHtml(auditNote || 'Sách nguyên vẹn đạt chuẩn lưu kho')}"</em></p>
        </div>

        ${extraHtml}
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge,
            subtitle: 'Thông báo kết quả kiểm kê sách trả ngoài giờ',
            contentHtml,
            actionButtonText: 'Xem chi tiết trên Sổ Lưu Thông Cá Nhân',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'drop_box_audit_result',
        eventType: action === 'report_damaged' || action === 'report_missing' ? 'drop_box_incident' : 'drop_box_normal_audit',
        dedupKey,
        text: `Kết quả đối soát Hòm 24/7 cho cuốn "${bookTitle}": ${action} (${auditNote || 'Đã kiểm nhận'}).`
    });
}

/**
 * Kịch bản 5: Phiếu mượn sách chính thức (Sau khi Thủ thư xác nhận cho mượn - Chứng từ đối soát)
 */
async function sendExitPassEmail({ to, userId, fullName, cardNumber, passCode, draftCode, librarianName, dueDate, bookCount, books = [], expiresAt, dedupKey = null }) {
    const borrowTimeStr = new Date().toLocaleString('vi-VN', { timeZone: LIBRARY_TIMEZONE });
    const dueDateStr = dueDate ? formatLocalDateVN(dueDate) : formatLocalDateVN(expiresAt || Date.now() + 14 * 86400000);
    const subject = `📋 [Phiếu Mượn Sách] Xác nhận Phiếu mượn chính thức (${passCode})`;

    const bookListHtml = books.map((b, i) => `
        <li style="margin: 6px 0; font-size: 13px;">
            <strong>${i + 1}. ${escapeHtml(b.title || b.book_title)}</strong> — Mã bản sao: <code>${escapeHtml(b.copyQr || b.qr_code || b.copy_qr || 'N/A')}</code>
        </li>
    `).join('');

    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Thủ thư đã quét xác nhận cho mượn sách thành công. <strong>Phiếu mượn nháp</strong> của bạn đã được chuyển thành <strong>Phiếu mượn chính thức</strong> dùng làm minh chứng mượn trả và đối soát khi cần thiết:</p>
        
        <div class="card" style="border: 2px solid #059669; background: #ecfdf5; text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">Mã Phiếu Mượn Chính Thức</span>
            <h2 style="margin: 6px 0; color: #065f46; font-family: monospace; letter-spacing: 0.1em;">${escapeHtml(passCode)}</h2>
            ${draftCode ? `<p style="margin: 2px 0; font-size: 11px; color: #047857;">Chuyển đổi từ Phiếu mượn nháp: <code>${escapeHtml(draftCode)}</code></p>` : ''}
            <p style="margin: 6px 0; font-size: 14px; font-weight: 700; color: #059669;">
                ✅ ĐÃ XÁC NHẬN CHO MƯỢN: ${bookCount} CUỐN SÁCH
            </p>
            <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">
                📅 Thời điểm xác nhận: <strong>${borrowTimeStr}</strong> &bull; Hạn trả sách: <strong style="color: #dc2626;">${dueDateStr}</strong>
            </p>
            ${librarianName ? `<p style="margin: 4px 0; font-size: 12px; color: #475569;">👨‍💼 Thủ thư xác nhận: <strong>${escapeHtml(librarianName)}</strong></p>` : ''}
        </div>

        <div style="margin-top: 16px;">
            <p style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">Danh sách bản sao sách trong Phiếu mượn:</p>
            <ul style="padding-left: 20px; margin-top: 4px;">
                ${bookListHtml}
            </ul>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-top: 14px;">
            Vui lòng lưu giữ <strong>Phiếu mượn</strong> này trên ứng dụng hoặc email làm minh chứng giao dịch hợp lệ để đối soát với nhân viên thư viện khi cần thiết.
        </p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Phiếu Mượn Sách Chính Thức',
            subtitle: 'Chứng từ xác nhận mượn sách & Minh chứng đối soát',
            contentHtml,
            actionButtonText: 'Xem Phiếu Mượn Trên Ứng Dụng',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'exit_pass',
        eventType: 'counter_borrow_receipt',
        dedupKey,
        text: `Phiếu mượn chính thức ${passCode}: Đã xác nhận cho mượn ${bookCount} cuốn sách. Hạn trả: ${dueDateStr}.`
    });
}

/**
 * Kịch bản 6: Phiếu trả sách điện tử (Sau khi trả tại quầy hoặc Thủ thư xác nhận Hòm 24/7)
 */
async function sendReturnSlipEmail({
    to,
    userId,
    fullName,
    cardNumber,
    returnCode,
    borrowSlipCodes = [],
    returnMethod = 'counter',
    droppedAt = null,
    returnedAt = null,
    librarianName = 'Thủ thư trực quầy',
    items = [],
    dedupKey = null,
}) {
    const isDropBox = returnMethod === 'drop_box';
    const returnedStr = (returnedAt ? new Date(returnedAt) : new Date()).toLocaleString('vi-VN', { timeZone: LIBRARY_TIMEZONE });
    const droppedStr = droppedAt ? new Date(droppedAt).toLocaleString('vi-VN', { timeZone: LIBRARY_TIMEZONE }) : null;
    const methodLabel = isDropBox ? 'Hòm trả sách 24/7' : 'Tại quầy thủ thư';
    const subject = `📥 [Phiếu Trả Sách] Xác nhận hoàn trả sách (${returnCode})`;

    const condLabelMap = {
        normal: 'Bình thường',
        damaged: 'Hư hỏng (Chờ khắc phục)',
        lost: 'Mất sách (Chờ khắc phục)'
    };

    const bookListHtml = items.map((b, i) => {
        const condText = condLabelMap[b.condition] || 'Bình thường';
        const slipText = b.borrowSlipCode ? ` • Phiếu mượn gốc: <code>${escapeHtml(b.borrowSlipCode)}</code>` : '';
        return `
        <li style="margin: 6px 0; font-size: 13px;">
            <strong>${i + 1}. ${escapeHtml(b.bookTitle || b.title || 'Ấn phẩm thư viện')}</strong>
            — Mã bản sao: <code>${escapeHtml(b.copyQr || b.qr_code || 'N/A')}</code>
            ${slipText}
            <br/><span style="font-size: 12px; color: #475569;">Tình trạng: <strong>${escapeHtml(condText)}</strong></span>
        </li>
    `;
    }).join('');

    const linkedSlipsHtml = Array.isArray(borrowSlipCodes) && borrowSlipCodes.length > 0
        ? `<p style="margin: 4px 0; font-size: 12px; color: #0f766e;">🔗 Phiếu mượn gốc: <strong>${borrowSlipCodes.map(c => escapeHtml(c)).join(', ')}</strong></p>`
        : '';

    const dropTimeHtml = isDropBox && droppedStr
        ? `<p style="margin: 4px 0; font-size: 12px; color: #1e293b;">📦 Thời điểm tiếp nhận (thả hòm - chốt hạn trả): <strong>${droppedStr}</strong></p>`
        : '';

    const contentHtml = `
        <p>Xin chào <strong>${escapeHtml(fullName || 'Bạn đọc')}</strong> (Mã thẻ: <code>${escapeHtml(cardNumber || 'LIB-RD-***')}</code>),</p>
        <p>Hệ thống đã hoàn tất xác nhận hoàn trả sách và phát hành <strong>Phiếu trả sách điện tử</strong> làm minh chứng đối soát giao dịch của bạn:</p>

        <div class="card" style="border: 2px solid #0284c7; background: #f0f9ff; text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase;">Mã Phiếu Trả Sách Điện Tử</span>
            <h2 style="margin: 6px 0; color: #0c4a6e; font-family: monospace; letter-spacing: 0.08em;">${escapeHtml(returnCode)}</h2>
            <p style="margin: 6px 0; font-size: 14px; font-weight: 700; color: #0369a1;">
                ✅ ĐÃ XÁC NHẬN TRẢ: ${items.length || 1} CUỐN SÁCH (${escapeHtml(methodLabel)})
            </p>
            ${linkedSlipsHtml}
            ${dropTimeHtml}
            <p style="margin: 4px 0; font-size: 12px; color: #1e293b;">
                🗓️ ${isDropBox ? 'Thời điểm Thủ thư xác nhận' : 'Ngày giờ trả thực tế'}: <strong>${returnedStr}</strong>
            </p>
            <p style="margin: 4px 0; font-size: 12px; color: #475569;">👨‍💼 Người xác nhận: <strong>${escapeHtml(librarianName || 'Thủ thư trực quầy')}</strong></p>
        </div>

        <div style="margin-top: 16px;">
            <p style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">Danh sách bản sao đã xác nhận trả:</p>
            <ul style="padding-left: 20px; margin-top: 4px;">
                ${bookListHtml}
            </ul>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-top: 14px;">
            Bạn có thể xem lại cả <strong>Phiếu mượn</strong> và <strong>Phiếu trả</strong> bất cứ lúc nào trong mục Lịch sử mượn trả trên hệ thống.
        </p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Phiếu Trả Sách Điện Tử',
            subtitle: 'Chứng từ xác nhận hoàn trả sách & Đối soát giao dịch',
            contentHtml,
            actionButtonText: 'Xem Phiếu Trả Trong Lịch Sử',
            actionButtonUrl: buildFrontendUrl('/borrow')
        }),
        templateType: 'return_slip',
        eventType: 'counter_return_receipt',
        dedupKey,
        text: `Phiếu trả sách điện tử ${returnCode}: Đã xác nhận trả ${items.length || 1} cuốn (${methodLabel}) lúc ${returnedStr}.`
    });
}

/**
 * Kịch bản 7: Xác nhận tiếp nhận đăng ký tài khoản độc giả mới (Chờ duyệt)
 */
async function sendRegistrationPendingEmail({ to, userId, fullName }) {
    const subject = '📝 [Athenaeum] Đã tiếp nhận đăng ký tài khoản thư viện (Chờ duyệt)';
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeEmail = escapeHtml(to);

    const contentHtml = `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Hệ thống <strong>Thư viện Thông minh Athenaeum</strong> đã tiếp nhận yêu cầu đăng ký tài khoản độc giả của bạn (<code>${safeEmail}</code>).</p>

        <div class="card" style="border-left: 4px solid #f59e0b; background: #fffbeb;">
            <p style="margin: 0; font-size: 13px; color: #92400e;"><strong>⏳ Trạng thái hồ sơ: Đang chờ phê duyệt</strong></p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #78350f;">
                Thủ thư hoặc Quản trị viên sẽ kiểm tra thông tin và kích hoạt thẻ thư viện cho bạn trong thời gian sớm nhất.
            </p>
        </div>

        <p style="font-size: 13px; color: #334155;">
            <strong>Làm sao để biết tài khoản đã được duyệt?</strong>
        </p>
        <ul style="padding-left: 18px; font-size: 13px; color: #475569; margin-top: 4px;">
            <li>Ngay khi được phê duyệt, hệ thống sẽ <strong>gửi tự động một email thông báo</strong> kèm <strong>Mã số thẻ thư viện chính thức</strong> tới địa chỉ <code>${safeEmail}</code>.</li>
            <li>Bạn cũng có thể thử đăng nhập trực tiếp bất cứ lúc nào — hệ thống sẽ báo rõ trạng thái chờ duyệt hoặc cho phép vào ngay khi đã kích hoạt.</li>
        </ul>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Đăng Ký Thành Công • Chờ Duyệt',
            subtitle: 'Xác nhận tiếp nhận hồ sơ thẻ độc giả',
            contentHtml,
            actionButtonText: 'Đi tới trang Đăng nhập',
            actionButtonUrl: buildFrontendUrl('/login')
        }),
        templateType: 'account_registration',
        text: `Athenaeum đã tiếp nhận đăng ký tài khoản cho ${fullName} (${to}). Hồ sơ đang chờ Thủ thư/Admin duyệt; bạn sẽ nhận được email thông báo ngay khi tài khoản được kích hoạt.`
    });
}

/**
 * Kịch bản 8: Thông báo tài khoản đã được phê duyệt & cấp thẻ thư viện
 */
async function sendAccountApprovedEmail({ to, userId, fullName, role = 'reader', cardNumber = null, cardExpiry = null }) {
    const isReader = role === 'reader' && cardNumber;
    const subject = isReader
        ? `✅ [Athenaeum] Tài khoản độc giả đã được duyệt — Mã thẻ ${cardNumber}`
        : '✅ [Athenaeum] Tài khoản thư viện của bạn đã được kích hoạt';
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || '');
    const expiryLabel = cardExpiry ? formatLocalDateVN(cardExpiry) : null;

    const contentHtml = isReader
        ? `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Chúc mừng! Yêu cầu đăng ký tài khoản độc giả của bạn tại <strong>Thư viện Thông minh Athenaeum</strong> đã được phê duyệt. Bạn đã có thể <strong>đăng nhập ngay</strong> để tra cứu, đặt trước và mượn sách.</p>

        <div class="card" style="border: 2px solid #059669; background: #ecfdf5; text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #059669; text-transform: uppercase;">Mã Số Thẻ Thư Viện Chính Thức</span>
            <h2 style="margin: 8px 0 4px; color: #065f46; font-family: monospace; letter-spacing: 0.08em;">${safeCard}</h2>
            ${expiryLabel ? `<p style="margin: 4px 0 0; font-size: 12px; color: #047857;">Hiệu lực thẻ đến ngày: <strong>${expiryLabel}</strong></p>` : ''}
        </div>

        <p style="font-size: 13px; color: #475569;">
            Hãy nhấn nút bên dưới và sử dụng <strong>Email + Mật khẩu</strong> bạn đã đăng ký để đăng nhập vào hệ thống và lấy mã QR thẻ thư viện.
        </p>
        `
        : `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Tài khoản của bạn tại <strong>Thư viện Thông minh Athenaeum</strong> đã được kích hoạt thành công. Bạn có thể đăng nhập ngay bằng email và mật khẩu đã đăng ký.</p>
        `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Tài Khoản Đã Được Duyệt',
            subtitle: 'Sẵn sàng đăng nhập & sử dụng dịch vụ thư viện',
            contentHtml,
            actionButtonText: 'Đăng Nhập Thư Viện Ngay',
            actionButtonUrl: buildFrontendUrl('/login')
        }),
        templateType: 'account_approved',
        text: isReader
            ? `Tài khoản độc giả ${fullName} đã được duyệt! Mã thẻ thư viện: ${cardNumber}${expiryLabel ? ` (Hạn thẻ: ${expiryLabel})` : ''}. Bạn có thể đăng nhập ngay tại ${buildFrontendUrl('/login')}.`
            : `Tài khoản ${fullName} đã được kích hoạt. Đăng nhập ngay tại ${buildFrontendUrl('/login')}.`
    });
}

/**
 * Kịch bản 9: Thông báo tài khoản / thẻ thư viện vừa được mở khóa
 */
async function sendAccountUnlockedEmail({ to, userId, fullName, role = 'reader', cardNumber = null }) {
    const isReader = role === 'reader' && cardNumber;
    const subject = isReader
        ? `🔓 [Athenaeum] Thẻ thư viện ${cardNumber} đã được mở khóa — Có thể đăng nhập lại`
        : '🔓 [Athenaeum] Tài khoản thư viện của bạn đã được mở khóa';
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || '');

    const contentHtml = isReader
        ? `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Thẻ thư viện của bạn tại <strong>Thư viện Thông minh Athenaeum</strong> đã được <strong>mở khóa trở lại</strong>. Bạn có thể đăng nhập ngay để tiếp tục tra cứu, đặt trước và mượn sách.</p>

        <div class="card" style="border: 2px solid #0284c7; background: #f0f9ff; text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase;">Thẻ Thư Viện Đã Mở Khóa</span>
            <h2 style="margin: 8px 0 4px; color: #0c4a6e; font-family: monospace; letter-spacing: 0.08em;">${safeCard}</h2>
            <p style="margin: 4px 0 0; font-size: 12px; color: #0369a1;">Trạng thái hiện tại: <strong>Đang hoạt động</strong></p>
        </div>

        <p style="font-size: 13px; color: #475569;">
            Hãy sử dụng <strong>Email + Mật khẩu</strong> của bạn để đăng nhập vào hệ thống thư viện.
        </p>
        `
        : `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Tài khoản của bạn tại <strong>Thư viện Thông minh Athenaeum</strong> đã được <strong>mở khóa</strong> và sẵn sàng đăng nhập trở lại.</p>
        `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Thẻ Đã Được Mở Khóa',
            subtitle: 'Quyền truy cập & lưu thông thư viện đã được khôi phục',
            contentHtml,
            actionButtonText: 'Đăng Nhập Lại Vào Thư Viện',
            actionButtonUrl: buildFrontendUrl('/login')
        }),
        templateType: 'account_unlocked',
        text: isReader
            ? `Thẻ thư viện ${cardNumber} của bạn đọc ${fullName} đã được mở khóa trở lại. Bạn có thể đăng nhập vào hệ thống ngay.`
            : `Tài khoản thư viện của ${fullName} đã được mở khóa. Bạn có thể đăng nhập lại vào hệ thống.`
    });
}

/**
 * Kịch bản 10: Thông báo từ chối hồ sơ đăng ký hoặc tạm khóa thẻ / tài khoản
 */
async function sendAccountLockedEmail({ to, userId, fullName, cardNumber = null, wasPending = false }) {
    const subject = wasPending
        ? '⚠️ [Athenaeum] Yêu cầu đăng ký tài khoản chưa được phê duyệt'
        : cardNumber
            ? `🔒 [Athenaeum] Thẻ thư viện ${cardNumber} đã bị tạm khóa`
            : '🔒 [Athenaeum] Thông báo tạm khóa tài khoản thư viện';
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || '');

    const contentHtml = wasPending
        ? `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Rất tiếc, yêu cầu đăng ký tài khoản độc giả của bạn tại <strong>Thư viện Thông minh Athenaeum</strong> hiện <strong>chưa được phê duyệt</strong>.</p>
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            <p style="margin: 0; font-size: 13px; color: #991b1b;">
                Vui lòng kiểm tra lại thông tin đăng ký (Họ tên, Số điện thoại) hoặc liên hệ trực tiếp <strong>Quầy Thủ thư</strong> để được hỗ trợ xác minh và cấp thẻ.
            </p>
        </div>
        `
        : `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>${cardNumber ? `Thẻ thư viện <code>${safeCard}</code>` : 'Tài khoản thư viện'} của bạn hiện đang ở trạng thái <strong>tạm khóa</strong>.</p>
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            ${cardNumber ? `<p style="margin: 0 0 6px; font-size: 12px; color: #7f1d1d;">Mã thẻ: <strong style="font-family: monospace;">${safeCard}</strong></p>` : ''}
            <p style="margin: 0; font-size: 13px; color: #991b1b;">
                Bạn tạm thời chưa thể đăng nhập hoặc thực hiện giao dịch mượn sách mới. Vui lòng liên hệ Quầy Thủ thư hoặc Quản trị viên để kiểm tra lý do và mở khóa thẻ.
            </p>
        </div>
        `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: wasPending ? 'Chưa Phê Duyệt Hồ Sơ' : 'Thẻ / Tài Khoản Tạm Khóa',
            subtitle: 'Thông báo trạng thái tài khoản từ Thư viện Athenaeum',
            contentHtml,
            actionButtonText: 'Kiểm Tra Trạng Thái Tại Trang Đăng Nhập',
            actionButtonUrl: buildFrontendUrl('/login')
        }),
        templateType: 'account_locked',
        eventType: wasPending ? 'account_rejected' : 'account_locked',
        text: wasPending
            ? `Yêu cầu đăng ký tài khoản của ${fullName} hiện chưa được phê duyệt. Vui lòng liên hệ Quầy Thủ thư để được hỗ trợ.`
            : `${cardNumber ? `Thẻ thư viện ${cardNumber}` : 'Tài khoản thư viện'} của ${fullName} hiện đang bị tạm khóa. Vui lòng liên hệ Quầy Thủ thư hoặc Quản trị viên để được giải quyết.`
    });
}

/**
 * Kịch bản 11: Thông báo đình chỉ quyền mượn (Chỉ gửi đúng lúc trạng thái chuyển sang SUSPENDED)
 */
async function sendSuspensionNoticeEmail({
    to,
    userId,
    fullName,
    cardNumber = null,
    suspendedUntil,
    suspendedDaysAdded = null,
    overdueDays = null,
    bookTitle = null,
    reason = null,
    dedupKey = null,
}) {
    const untilStr = suspendedUntil ? formatLocalDateVN(suspendedUntil) : 'Đang cập nhật';
    const subject = `⛔ [Athenaeum] Thông báo tạm đình chỉ quyền mượn sách đến ${untilStr}`;
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || 'LIB-RD-***');
    const detailReason = reason || (
        bookTitle
            ? `Hoàn trả trễ hạn cuốn "${bookTitle}"${overdueDays ? ` (${overdueDays} ngày)` : ''}`
            : overdueDays
                ? `Hoàn trả tài liệu trễ hạn ${overdueDays} ngày theo quy chế thư viện`
                : 'Áp dụng quy chế kỷ luật trả trễ hạn'
    );

    const contentHtml = `
        <p>Xin chào <strong>${safeName}</strong> (Mã thẻ: <code>${safeCard}</code>),</p>
        <p>Hệ thống thư viện xin thông báo quyền mượn &amp; đặt trước sách của bạn vừa chuyển sang trạng thái <strong>Tạm đình chỉ (SUSPENDED)</strong> theo quy chế lưu thông:</p>
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            <p style="margin: 0 0 6px; font-size: 13px; color: #991b1b;"><strong>Lý do áp dụng:</strong> ${escapeHtml(detailReason)}</p>
            ${suspendedDaysAdded ? `<p style="margin: 4px 0; font-size: 13px; color: #7f1d1d;"><strong>Thời gian đình chỉ:</strong> ${Number(suspendedDaysAdded)} ngày</p>` : ''}
            <p style="margin: 4px 0 0; font-size: 14px; color: #b91c1c;"><strong>Hiệu lực đến hết ngày:</strong> <span class="danger">${escapeHtml(untilStr)}</span></p>
        </div>
        <p style="font-size: 13px; color: #475569;">Sau thời điểm trên, nếu bạn không còn sách quá hạn hoặc biên bản hư hỏng chưa khắc phục, quyền mượn sách sẽ tự động được khôi phục trong hệ thống.</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Thông báo đình chỉ quyền mượn',
            subtitle: 'Áp dụng quy chế kỷ luật lưu thông thư viện',
            contentHtml,
            actionButtonText: 'Xem chi tiết hồ sơ vi phạm',
            actionButtonUrl: buildFrontendUrl('/fines'),
        }),
        templateType: 'account_suspended',
        eventType: 'account_suspended',
        dedupKey,
        text: `Thẻ ${cardNumber || ''} bị tạm đình chỉ quyền mượn đến hết ${untilStr} do ${detailReason}.`,
    });
}

/**
 * Kịch bản 12: Thông báo sách đặt trước đã sẵn sàng nhận tại thư viện (Giữ ưu tiên 48h)
 */
async function sendReservationReadyEmail({
    to,
    userId,
    fullName,
    cardNumber = null,
    bookTitle,
    location = null,
    ticketCode = null,
    expiresAt = null,
    dedupKey = null,
}) {
    const expiryStr = expiresAt
        ? new Date(expiresAt).toLocaleString('vi-VN', { timeZone: LIBRARY_TIMEZONE })
        : 'trong vòng 48 giờ tới';
    const subject = `🎉 [Sách đặt trước đã sẵn sàng] Cuốn "${bookTitle}" đang chờ bạn xác nhận`;
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCard = escapeHtml(cardNumber || 'LIB-RD-***');
    const safeTitle = escapeHtml(bookTitle || 'Tài liệu đặt trước');

    const contentHtml = `
        <p>Xin chào <strong>${safeName}</strong> (Mã thẻ: <code>${safeCard}</code>),</p>
        <p>Tin vui! Cuốn sách bạn xếp hàng đặt trước hiện <strong>đã có sẵn tại thư viện</strong> và đang được giữ ưu tiên riêng cho bạn:</p>
        <div class="card" style="border-left: 4px solid #059669; background: #ecfdf5;">
            <h3 style="margin-top: 0; color: #065f46; font-size: 16px;">📖 ${safeTitle}</h3>
            ${ticketCode ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Mã phiếu đặt:</strong> <code>${escapeHtml(ticketCode)}</code></p>` : ''}
            ${location ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Vị trí kệ sách:</strong> ${escapeHtml(location)}</p>` : ''}
            <p style="margin: 4px 0; font-size: 13px;"><strong>Hạn giữ chỗ ưu tiên:</strong> <span style="color: #047857; font-weight: 700;">${escapeHtml(expiryStr)}</span></p>
        </div>
        <p>Vui lòng vào mục <strong>Đặt trước sách</strong> để xác nhận mượn và tạo phiếu giữ chỗ 24h trước khi hết hạn ưu tiên (nếu quá hạn hệ thống sẽ chuyển lượt cho bạn đọc tiếp theo).</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Sách Đặt Trước Đã Sẵn Sàng',
            subtitle: 'Giữ chỗ ưu tiên 48 giờ dành cho bạn đọc',
            contentHtml,
            actionButtonText: 'Xác Nhận Mượn Sách Ngay',
            actionButtonUrl: buildFrontendUrl('/reservations'),
        }),
        templateType: 'reservation_ready',
        eventType: 'reservation_ready',
        dedupKey,
        text: `Sách "${bookTitle}" bạn đặt trước đã sẵn sàng và được giữ ưu tiên đến ${expiryStr}. Vui lòng vào mục Đặt trước sách để xác nhận.`,
    });
}

/**
 * Gửi email đặt lại mật khẩu kèm mã xác thực 6 số (Point 1: Forgot Password)
 */
async function sendPasswordResetEmail({ to, userId, fullName, resetCode, resetUrl, expiresMinutes = 15 }) {
    const subject = `🔑 [Athenaeum] Yêu cầu đặt lại mật khẩu tài khoản`;
    const safeName = escapeHtml(fullName || 'Bạn đọc');
    const safeCode = escapeHtml(resetCode || '000000');

    const contentHtml = `
        <p>Xin chào <strong>${safeName}</strong>,</p>
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản thư viện của bạn.</p>
        <div class="card" style="border-left: 4px solid #4f46e5; background: #eef2ff; text-align: center; padding: 20px 16px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #4338ca; font-weight: 600; text-transform: uppercase;">Mã xác thực đặt lại mật khẩu (OTP):</p>
            <div style="font-family: monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #312e81; padding: 8px 0;">
                ${safeCode}
            </div>
            <p style="margin: 8px 0 0 0; font-size: 12px; color: #6366f1;">Mã có hiệu lực trong vòng <strong>${expiresMinutes} phút</strong>.</p>
        </div>
        <p style="font-size: 13px; color: #4b5563; margin-top: 16px;">
            Vui lòng nhập mã 6 số này vào màn hình Đặt lại mật khẩu trên hệ thống Athenaeum để hoàn tất việc thiết lập mật khẩu mới.
        </p>
        <p style="font-size: 12px; color: #9ca3af; margin-top: 20px; border-top: 1px dashed #e5e7eb; padding-top: 12px;">
            🛡️ <em>Nếu bạn không yêu cầu đặt lại mật khẩu, xin vui lòng bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ an toàn tuyệt đối.</em>
        </p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Bảo Mật Tài Khoản',
            subtitle: 'Xác thực yêu cầu cấp lại mật khẩu',
            contentHtml,
            actionButtonText: 'Đến Trang Đặt Lại Mật Khẩu',
            actionButtonUrl: resetUrl || buildFrontendUrl('/login'),
        }),
        templateType: 'password_reset',
        eventType: 'password_reset',
        text: `Mã xác thực đặt lại mật khẩu Athenaeum của bạn là: ${resetCode}. Mã có hiệu lực trong ${expiresMinutes} phút.`,
    });
}

module.exports = {
    sendEmail,
    sendDueReminderEmail,
    sendDueTodayEmail,
    sendOverdueWarningEmail,
    sendDropBoxReceiptEmail,
    sendDropBoxAuditResultEmail,
    sendExitPassEmail,
    sendReturnSlipEmail,
    sendRegistrationPendingEmail,
    sendAccountApprovedEmail,
    sendAccountUnlockedEmail,
    sendAccountLockedEmail,
    sendSuspensionNoticeEmail,
    sendReservationReadyEmail,
    sendPasswordResetEmail,
    hasDispatchedByDedupKey,
    recordDispatch,
    getSmtpStatus,
    verifySmtpConnection,
    saveSmtpConfig,
    clearSmtpConfig,
    invalidateTransporterCache,
    maskEmail,
    isPlaceholderSmtpValue,
    encryptSecret,
    decryptSecret
};
