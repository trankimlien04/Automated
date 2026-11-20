const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'ci-smoke-test-jwt-secret';

const dbModulePath = require.resolve('../config/db');
require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
        execute: async () => [[], []],
        query: async () => [[], []],
        getConnection: async () => ({
            beginTransaction: async () => {},
            execute: async () => [[], []],
            commit: async () => {},
            rollback: async () => {},
            release: () => {},
        }),
    },
};

const { app } = require('../index');

// Note: Express app is invoked in-memory (no TCP bind) so tests pass inside locked-down sandboxes and CI alike.
function invokeApp({ method = 'GET', url, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const socket = new PassThrough();
        socket.remoteAddress = '127.0.0.1';

        const req = new http.IncomingMessage(socket);
        req.method = method;
        req.url = url;
        req.headers = { ...headers };

        if (body !== null) {
            const payload = typeof body === 'string' ? body : JSON.stringify(body);
            if (!req.headers['content-type']) {
                req.headers['content-type'] = 'application/json';
            }
            req.headers['content-length'] = String(Buffer.byteLength(payload));
            req.push(payload);
        }
        req.push(null);

        const res = new http.ServerResponse(req);
        res.useChunkedEncodingByDefault = false;

        const rawChunks = [];
        const outSocket = new PassThrough();
        outSocket.writable = true;
        outSocket.cork = () => {};
        outSocket.uncork = () => {};
        outSocket.destroy = () => {};
        outSocket._write = (chunk, _enc, cb) => {
            rawChunks.push(Buffer.from(chunk));
            cb();
        };
        res.assignSocket(outSocket);

        res.on('finish', () => {
            const raw = Buffer.concat(rawChunks).toString('utf8');
            const sepIndex = raw.indexOf('\r\n\r\n');
            const bodyText = sepIndex >= 0 ? raw.slice(sepIndex + 4) : raw;
            let json = null;
            try {
                json = bodyText ? JSON.parse(bodyText) : null;
            } catch {
                json = null;
            }
            resolve({
                status: res.statusCode,
                bodyText,
                json,
            });
        });

        app.handle(req, res, reject);
    });
}

function makeToken(role, id = 99) {
    return jwt.sign(
        { id, email: `${role}@library.com`, role, fullName: `Test ${role}` },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
}

test('GET /api/health returns 200 success payload', async () => {
    const res = await invokeApp({ method: 'GET', url: '/api/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
        status: 'success',
        message: 'Smart Library API is running',
    });
});

test('Protected routes return 401 without token and 403 for invalid token', async () => {
    const noTokenRes = await invokeApp({ method: 'GET', url: '/api/books' });
    assert.equal(noTokenRes.status, 401);

    const badTokenRes = await invokeApp({
        method: 'GET',
        url: '/api/books',
        headers: { authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(badTokenRes.status, 403);
});

test('Maker-Checker RBAC blocks unauthorized roles on /api/configs endpoints', async () => {
    const readerToken = makeToken('reader');
    const adminToken = makeToken('admin');

    // Reader cannot propose system regulation changes (admin only)
    const readerPropose = await invokeApp({
        method: 'POST',
        url: '/api/configs/propose',
        headers: { authorization: `Bearer ${readerToken}` },
        body: { key_name: 'max_borrow_days', proposed_value: '21' },
    });
    assert.equal(readerPropose.status, 403);

    // Admin cannot approve/reject config proposals (owner only — Maker-Checker separation)
    const adminReview = await invokeApp({
        method: 'PATCH',
        url: '/api/configs/requests/1/review',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { status: 'approved' },
    });
    assert.equal(adminReview.status, 403);

    // Admin passes RBAC check on /propose and hits controller input validation (400 instead of 401/403)
    const adminInvalidPropose = await invokeApp({
        method: 'POST',
        url: '/api/configs/propose',
        headers: { authorization: `Bearer ${adminToken}` },
        body: {},
    });
    assert.equal(adminInvalidPropose.status, 400);
});

test('Option 4 Risk-Based Warehouse Control enforces RBAC across Librarian, Admin, Owner, and Reader', async () => {
    const adminToken = makeToken('admin', 1);
    const librarianToken = makeToken('librarian', 2);
    const ownerToken = makeToken('owner', 4);
    const readerToken = makeToken('reader', 3);

    // Admin and Owner cannot directly mutate book catalog or inventory (403)
    for (const token of [adminToken, ownerToken, readerToken]) {
        for (const req of [
            { method: 'POST', url: '/api/books', body: { title: 'Test', total_copies: 0 } },
            { method: 'PUT', url: '/api/books/1', body: { location: 'Phòng 01 - Kệ 05 - Ngăn 01' } },
            { method: 'DELETE', url: '/api/books/1' },
            { method: 'POST', url: '/api/books/import-batch', body: { books: [] } },
            { method: 'POST', url: '/api/books/1/restock', body: { additionalCopies: 2 } },
            { method: 'POST', url: '/api/book-requests', body: { request_type: 'restock', book_id: 1, quantity: 2 } },
        ]) {
            const res = await invokeApp({
                ...req,
                headers: { authorization: `Bearer ${token}` },
            });
            assert.equal(res.status, 403, `${req.method} ${req.url} should forbid unauthorized role`);
        }
    }

    // Only Owner can review (approve/reject) book_requests; Admin, Librarian, Reader receive 403
    for (const token of [adminToken, librarianToken, readerToken]) {
        const res = await invokeApp({
            method: 'PATCH',
            url: '/api/book-requests/1/review',
            headers: { authorization: `Bearer ${token}` },
            body: { decision: 'approved' },
        });
        assert.equal(res.status, 403);
    }

    // Reader cannot view book_requests or activity_logs; Librarian CAN inspect both (filtered activity_logs)
    const readerReqList = await invokeApp({
        method: 'GET',
        url: '/api/book-requests',
        headers: { authorization: `Bearer ${readerToken}` },
    });
    assert.equal(readerReqList.status, 403);

    const readerLogs = await invokeApp({
        method: 'GET',
        url: '/api/activity-logs',
        headers: { authorization: `Bearer ${readerToken}` },
    });
    assert.equal(readerLogs.status, 403);

    const librarianLogs = await invokeApp({
        method: 'GET',
        url: '/api/activity-logs',
        headers: { authorization: `Bearer ${librarianToken}` },
    });
    assert.equal(librarianLogs.status, 200);
});

test('RBAC boundaries, date utilities, and SMTP status security', async () => {
    const adminToken = makeToken('admin');
    const ownerToken = makeToken('owner');
    const smokeReaderToken = makeToken('reader');

    // Unauthenticated access to history routes is blocked (401)
    for (const req of [
        { method: 'GET', url: '/api/history/user/1' },
        { method: 'POST', url: '/api/history', body: { user_id: 1, action: 'TEST' } },
        { method: 'DELETE', url: '/api/history/1' },
    ]) {
        const res = await invokeApp(req);
        assert.equal(res.status, 401, `${req.method} ${req.url} without token should return 401`);
    }

    // Reader IDOR / RBAC boundaries on history, user profile, and notification triggers (403)
    for (const req of [
        { method: 'GET', url: '/api/history/user/1' },
        { method: 'GET', url: '/api/users/1' },
        { method: 'POST', url: '/api/notifications/trigger-reminders' },
        { method: 'POST', url: '/api/notifications/test-email', body: { email: 'a@b.com' } },
        { method: 'POST', url: '/api/notifications/broadcast', body: { title: 'T', message: 'M' } },
    ]) {
        const res = await invokeApp({
            ...req,
            headers: { authorization: `Bearer ${smokeReaderToken}` },
        });
        assert.equal(res.status, 403, `Reader ${req.method} ${req.url} should return 403`);
    }

    // Direct PUT /api/configs bypass around Maker-Checker is disabled (403)
    for (const token of [adminToken, ownerToken]) {
        const res = await invokeApp({
            method: 'PUT',
            url: '/api/configs',
            headers: { authorization: `Bearer ${token}` },
            body: { max_borrow_days: 30 },
        });
        assert.equal(res.status, 403, 'Direct PUT /api/configs bypass should return 403');
    }

    // Owner is supervisor-only on catalog writes and circulation counter/kiosk operations (403)
    for (const req of [
        { method: 'POST', url: '/api/categories', body: { name: 'Test' } },
        { method: 'POST', url: '/api/authors', body: { name: 'Test' } },
        { method: 'POST', url: '/api/publishers', body: { name: 'Test' } },
        { method: 'GET', url: '/api/borrow/drop-box-items' },
        { method: 'POST', url: '/api/borrow/exit-passes/verify', body: { code: 'EXIT-1' } },
        { method: 'POST', url: '/api/borrow/drafts', body: { bookIds: [1] } },
        { method: 'POST', url: '/api/borrow/borrow', body: { bookId: 1 } },
    ]) {
        const res = await invokeApp({
            ...req,
            headers: { authorization: `Bearer ${ownerToken}` },
        });
        assert.equal(res.status, 403, `Owner ${req.method} ${req.url} should return 403`);
    }

    // Date timezone formatting & HTML escaping utilities
    const {
        LIBRARY_TIMEZONE,
        toLocalDateString,
        addDaysToDateString,
        formatLocalDateVN,
        escapeHtml,
    } = await import('../utils/dateUtils.js');
    assert.match(toLocalDateString(new Date('2026-11-11T18:30:00Z')), /^\d{4}-\d{2}-\d{2}$/);
    if (LIBRARY_TIMEZONE === 'Asia/Ho_Chi_Minh') {
        assert.equal(toLocalDateString(new Date('2026-11-11T18:30:00Z')), '2026-11-12');
        assert.equal(formatLocalDateVN(new Date('2026-11-11T18:30:00Z')), '12/11/2026');
    }
    assert.equal(addDaysToDateString('2026-11-29', 2), '2026-12-01');
    assert.equal(toLocalDateString('invalid-date'), '');
    assert.equal(escapeHtml(null), '');
    assert.equal(
        escapeHtml('<script>alert("x" & \'y\')</script>'),
        '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
    );

    // SMTP RBAC & invalid email guard checks
    const smokeLibrarianToken = makeToken('librarian');
    for (const req of [
        { method: 'GET', url: '/api/notifications/smtp-status' },
        { method: 'POST', url: '/api/notifications/smtp-verify' },
        { method: 'PUT', url: '/api/notifications/smtp-config', body: { host: 'smtp.gmail.com' } },
        { method: 'DELETE', url: '/api/notifications/smtp-config' },
    ]) {
        const res = await invokeApp({
            ...req,
            headers: { authorization: `Bearer ${smokeReaderToken}` },
        });
        assert.equal(res.status, 403, `Reader ${req.method} ${req.url} should return 403`);
    }

    for (const req of [
        { method: 'PUT', url: '/api/notifications/smtp-config', body: { host: 'smtp.gmail.com' } },
        { method: 'DELETE', url: '/api/notifications/smtp-config' },
    ]) {
        const res = await invokeApp({
            ...req,
            headers: { authorization: `Bearer ${smokeLibrarianToken}` },
        });
        assert.equal(res.status, 403, `Librarian ${req.method} ${req.url} should return 403`);
    }

    const smtpStatusRes = await invokeApp({
        method: 'GET',
        url: '/api/notifications/smtp-status',
        headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(smtpStatusRes.status, 200);
    assert.equal(smtpStatusRes.json.pass, undefined);
    assert.equal(smtpStatusRes.json.password, undefined);
    assert.ok(smtpStatusRes.json.timezone);
    assert.ok(smtpStatusRes.json.cron);
    assert.equal(smtpStatusRes.json.cron.cronExpression, '0 8 * * *');
    assert.equal(smtpStatusRes.json.cron.catchUpEnabled, true);

    const invalidTestEmailRes = await invokeApp({
        method: 'POST',
        url: '/api/notifications/test-email',
        headers: { authorization: `Bearer ${adminToken}` },
        body: { targetEmail: 'not-an-email' },
    });
    assert.equal(invalidTestEmailRes.status, 400);

    // Email service helper checks (encryption, masking, placeholder filtering & EMAIL_* fallback)
    const {
        isPlaceholderSmtpValue,
        maskEmail,
        encryptSecret,
        decryptSecret,
        getSmtpStatus,
    } = await import('../services/emailService.js');
    assert.equal(isPlaceholderSmtpValue('your_library_notification_email@gmail.com'), true);
    assert.equal(isPlaceholderSmtpValue('your_app_password_here'), true);
    assert.equal(isPlaceholderSmtpValue('library.real@gmail.com'), false);
    assert.equal(maskEmail('athenaeum@gmail.com'), 'at***@gmail.com');

    const cipher = encryptSecret('abcd-efgh-ijkl-mnop');
    assert.ok(cipher.startsWith('aes256gcm:'));
    assert.equal(decryptSecret(cipher), 'abcd-efgh-ijkl-mnop');

    const envBackup = {
        EMAIL_HOST: process.env.EMAIL_HOST,
        EMAIL_PORT: process.env.EMAIL_PORT,
        EMAIL_USER: process.env.EMAIL_USER,
        EMAIL_PASS: process.env.EMAIL_PASS,
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
    };
    try {
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
        process.env.EMAIL_HOST = 'smtp.gmail.com';
        process.env.EMAIL_PORT = '587';
        process.env.EMAIL_USER = 'library.sender@gmail.com';
        process.env.EMAIL_PASS = 'abcd efgh ijkl mnop';
        const resolved = await getSmtpStatus();
        assert.equal(resolved.configured, true);
        assert.equal(resolved.mode, 'smtp_real');
        assert.equal(resolved.source, 'env');
        assert.equal(resolved.userMasked, 'li***@gmail.com');
    } finally {
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test('Reader registration, pending login check, and approval email dispatch flow', async () => {
    const dbMock = require('../config/db');
    const originalExecute = dbMock.execute;
    const bcrypt = require('bcrypt');
    const hashed = await bcrypt.hash('secret123', 4);
    const dispatchTemplates = [];
    let currentStatus = 'pending';
    let currentCardNumber = null;
    let latestUnreadNotice = null;

    const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
    const envBackup = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    dbMock.execute = async (sql, params = []) => {
        if (sql.includes('SELECT host, port, secure, username, password_encrypted')) {
            return [[], []];
        }
        if (sql.includes('INSERT INTO notification_dispatches')) {
            dispatchTemplates.push({
                email: params[1],
                templateType: params[3],
                title: params[4],
                status: params[6],
            });
            return [{ insertId: dispatchTemplates.length }, []];
        }
        if (sql.includes('INSERT INTO notifications')) {
            if (Number(params[0]) === 42) {
                latestUnreadNotice = {
                    id: 901,
                    title: params[1],
                    message: params[2],
                    created_at: '2026-11-11T14:40:00.000Z',
                };
            }
            return [{ insertId: 901 }, []];
        }
        if (sql.includes('SELECT id, title, message, created_at') && sql.includes('FROM notifications')) {
            return [latestUnreadNotice ? [latestUnreadNotice] : [], []];
        }
        if (sql.includes('SELECT id FROM users WHERE email = ?')) {
            return [[], []];
        }
        if (sql.includes('INSERT INTO users')) {
            return [{ insertId: 42 }, []];
        }
        if (sql.includes('SELECT * FROM users WHERE email = ?')) {
            return [[{
                id: 42,
                full_name: 'Trần Kim Thanh',
                email: 'reader.pending@example.com',
                password_hash: hashed,
                role: 'reader',
                status: currentStatus,
                card_number: currentCardNumber,
            }], []];
        }
        if (sql.includes('SELECT id, full_name, email, role, card_number, card_expiry, status FROM users WHERE id = ?')) {
            return [[{
                id: 42,
                full_name: 'Trần Kim Thanh',
                email: 'reader.pending@example.com',
                role: 'reader',
                card_number: currentCardNumber,
                card_expiry: null,
                status: currentStatus,
            }], []];
        }
        if (sql.includes('UPDATE users SET status = ?, card_number = ?')) {
            currentStatus = params[0];
            currentCardNumber = params[1];
            return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('UPDATE users SET status = ?')) {
            currentStatus = params[0];
            return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('SELECT id FROM users WHERE role IN')) {
            return [[{ id: 1 }, { id: 2 }], []];
        }
        return [[], []];
    };

    try {
        const regRes = await invokeApp({
            method: 'POST',
            url: '/api/auth/register',
            body: {
                fullName: 'Trần Kim Thanh',
                email: 'reader.pending@example.com',
                password: 'secret123',
                phone: '0367572982',
            },
        });
        assert.equal(regRes.status, 201);
        assert.equal(regRes.json.status, 'pending');
        assert.equal(dispatchTemplates.some((d) => d.templateType === 'account_registration'), false);

        const pendingLoginRes = await invokeApp({
            method: 'POST',
            url: '/api/auth/login',
            body: { email: 'reader.pending@example.com', password: 'secret123' },
        });
        assert.equal(pendingLoginRes.status, 403);
        assert.equal(pendingLoginRes.json.accountStatus, 'pending');

        const librarianToken = makeToken('librarian');
        const approveRes = await invokeApp({
            method: 'PUT',
            url: '/api/users/42/status',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { status: 'active' },
        });
        assert.equal(approveRes.status, 200);
        assert.equal(approveRes.json.cardNumber, 'LIB-RD-000042');
        assert.equal(dispatchTemplates.some((d) => d.templateType === 'account_approved'), true);

        const activeLoginRes = await invokeApp({
            method: 'POST',
            url: '/api/auth/login',
            body: { email: 'reader.pending@example.com', password: 'secret123' },
        });
        assert.equal(activeLoginRes.status, 200);
        assert.ok(activeLoginRes.json.token);
        assert.equal(activeLoginRes.json.accountNotice?.kind, 'approved');
        assert.equal(activeLoginRes.json.accountNotice?.cardNumber, 'LIB-RD-000042');

        const lockRes = await invokeApp({
            method: 'PUT',
            url: '/api/users/42/status',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { status: 'locked' },
        });
        assert.equal(lockRes.status, 200);
        assert.equal(dispatchTemplates.some((d) => d.templateType === 'account_locked'), true);

        const lockedLoginRes = await invokeApp({
            method: 'POST',
            url: '/api/auth/login',
            body: { email: 'reader.pending@example.com', password: 'secret123' },
        });
        assert.equal(lockedLoginRes.status, 403);
        assert.equal(lockedLoginRes.json.accountStatus, 'locked');
        assert.equal(lockedLoginRes.json.cardNumber, 'LIB-RD-000042');

        const unlockRes = await invokeApp({
            method: 'PUT',
            url: '/api/users/42/status',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { status: 'active' },
        });
        assert.equal(unlockRes.status, 200);
        assert.equal(dispatchTemplates.some((d) => d.templateType === 'account_unlocked'), true);

        const unlockedLoginRes = await invokeApp({
            method: 'POST',
            url: '/api/auth/login',
            body: { email: 'reader.pending@example.com', password: 'secret123' },
        });
        assert.equal(unlockedLoginRes.status, 200);
        assert.equal(unlockedLoginRes.json.accountNotice?.kind, 'unlocked');
        assert.equal(unlockedLoginRes.json.accountNotice?.cardNumber, 'LIB-RD-000042');
    } finally {
        dbMock.execute = originalExecute;
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test('Option 4 workflow enforces metadata vs physical copy split, no self-approval, double-review guard, soft delete & audit logs', async () => {
    const dbMock = require.cache[dbModulePath].exports;
    const originalExecute = dbMock.execute;
    const originalGetConnection = dbMock.getConnection;

    const books = [
        {
            id: 10,
            title: 'Lập Trình Hệ Thống',
            isbn: '978-604-1-10001-1',
            author_id: 1,
            publisher_id: 1,
            category_id: 2,
            published_year: 2024,
            description: 'Mô tả ban đầu',
            location: 'Phòng 01 - Kệ 01 - Ngăn 01',
            total_copies: 2,
            available_copies: 2,
            status: 'active',
            author_name: 'Tác giả A',
            category_name: 'CNTT',
            publisher_name: 'NXB A',
        },
    ];
    const bookCopies = [
        { id: 101, book_id: 10, qr_code: 'QR-BK-10-1', status: 'available' },
        { id: 102, book_id: 10, qr_code: 'QR-BK-10-2', status: 'available' },
    ];
    let borrowedActive = false;
    const bookRequests = [];
    const bookRequestDetails = [];
    const bookRequestApprovals = [];
    const activityLogs = [];

    const runQuery = async (sql, params = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();

        if (s.startsWith('SELECT id FROM books WHERE isbn = ?')) {
            const match = books.find((b) => b.isbn === params[0] && b.status === 'active' && (params.length < 2 || b.id !== params[1]));
            return [match ? [{ id: match.id }] : [], []];
        }
        if (s.startsWith('INSERT INTO books')) {
            const newId = books.length + 20;
            books.push({
                id: newId,
                title: params[0],
                author_id: params[1],
                publisher_id: params[2],
                category_id: params[3],
                isbn: params[4],
                published_year: params[5],
                description: params[6],
                location: params[params.length - 1],
                total_copies: 0,
                available_copies: 0,
                status: 'active',
            });
            return [{ insertId: newId }, []];
        }
        if (s.includes('FROM books b LEFT JOIN authors')) {
            const book = books.find((b) => b.id === Number(params[0]));
            return [book ? [{ ...book }] : [], []];
        }
        if (s.startsWith('UPDATE books SET title = ?')) {
            const book = books.find((b) => b.id === Number(params[8]));
            if (book) {
                book.title = params[0];
                book.isbn = params[4];
                book.location = params[7];
            }
            return [{ affectedRows: book ? 1 : 0 }, []];
        }
        if (s.startsWith('UPDATE books SET total_copies = total_copies + ?')) {
            const book = books.find((b) => b.id === Number(params[3]));
            if (book) {
                book.total_copies += Number(params[0]);
                book.available_copies += Number(params[1]);
                book.location = params[2];
            }
            return [{ affectedRows: 1 }, []];
        }
        if (s.startsWith('UPDATE books SET status = ?, deleted_at = NOW()')) {
            const book = books.find((b) => b.id === Number(params[2]));
            if (book) {
                book.status = params[0];
                book.deleted_by = params[1];
                book.available_copies = 0;
            }
            return [{ affectedRows: 1 }, []];
        }
        if (s.startsWith('SELECT id, title, total_copies, available_copies, location FROM books WHERE id = ?')) {
            const book = books.find((b) => b.id === Number(params[0]) && b.status === 'active');
            return [book ? [{ ...book }] : [], []];
        }
        if (s.startsWith("SELECT id, title, COALESCE(status, 'active') AS status FROM books WHERE id = ?")) {
            const book = books.find((b) => b.id === Number(params[0]));
            return [book ? [{ ...book }] : [], []];
        }
        if (s.startsWith('SELECT COUNT(*) AS count FROM book_copies WHERE book_id = ?')) {
            return [[{ count: bookCopies.filter((c) => c.book_id === Number(params[0])).length }], []];
        }
        if (s.startsWith('SELECT id FROM book_copies WHERE qr_code = ?')) {
            const dup = bookCopies.find((c) => c.qr_code === params[0]);
            return [dup ? [{ id: dup.id }] : [], []];
        }
        if (s.startsWith('INSERT INTO book_copies')) {
            bookCopies.push({ id: bookCopies.length + 200, book_id: params[0], qr_code: params[1], status: 'available' });
            return [{ insertId: bookCopies.length + 200 }, []];
        }
        if (s.includes('FROM book_copies bc LEFT JOIN borrow_records')) {
            return [[{ count: borrowedActive ? 1 : 0 }], []];
        }
        if (s.startsWith('SELECT COUNT(*) AS count FROM borrow_requests') || s.includes('FROM borrow_draft_items') || s.includes('FROM reservations')) {
            return [[{ count: 0 }], []];
        }
        if (s.startsWith('SELECT br.id, br.request_code FROM book_requests')) {
            const match = bookRequests.find((r) => {
                const det = bookRequestDetails.find((d) => d.request_id === r.id);
                return r.request_type === 'delete' && r.status === 'pending' && det?.book_id === Number(params[0]);
            });
            return [match ? [match] : [], []];
        }
        if (s.startsWith('INSERT INTO book_requests')) {
            const id = bookRequests.length + 1;
            bookRequests.push({
                id,
                request_code: null,
                request_type: params[0],
                status: 'pending',
                title: params[1],
                reason: params[2],
                requested_by: params[3],
            });
            return [{ insertId: id }, []];
        }
        if (s.startsWith('UPDATE book_requests SET request_code = ?')) {
            const req = bookRequests.find((r) => r.id === Number(params[1]));
            if (req) req.request_code = params[0];
            return [{ affectedRows: 1 }, []];
        }
        if (s.startsWith('INSERT INTO book_request_details')) {
            const id = bookRequestDetails.length + 1;
            bookRequestDetails.push({
                id,
                request_id: params[0],
                book_id: params[1],
                quantity: params[2],
                location: params[3],
                payload_json: params[4],
                before_json: params[5],
            });
            return [{ insertId: id }, []];
        }
        if (s.startsWith('SELECT * FROM book_requests WHERE id = ?')) {
            const req = bookRequests.find((r) => r.id === Number(params[0]));
            return [req ? [{ ...req }] : [], []];
        }
        if (s.startsWith('SELECT * FROM book_request_details WHERE request_id = ?')) {
            const det = bookRequestDetails.find((d) => d.request_id === Number(params[0]));
            return [det ? [{ ...det }] : [], []];
        }
        if (s.startsWith('UPDATE book_requests SET status = \'completed\'')) {
            const req = bookRequests.find((r) => r.id === Number(params[2]));
            if (req) {
                req.status = 'completed';
                req.reviewed_by = params[0];
                req.review_note = params[1];
            }
            return [{ affectedRows: 1 }, []];
        }
        if (s.startsWith('UPDATE book_requests SET status = \'cancelled\'')) {
            const req = bookRequests.find((r) => r.id === Number(params[1]));
            if (req) req.status = 'cancelled';
            return [{ affectedRows: 1 }, []];
        }
        if (s.startsWith('INSERT INTO book_request_approvals')) {
            bookRequestApprovals.push({ request_id: params[0], reviewer_id: params[1], decision: params[2], note: params[3] });
            return [{ insertId: bookRequestApprovals.length }, []];
        }
        if (s.startsWith('INSERT INTO activity_logs')) {
            activityLogs.push({ user_id: params[0], action: params[1], target_type: params[2], target_id: params[3], details: params[4], before_data: params[5], after_data: params[6], outcome: params[7] });
            return [{ insertId: activityLogs.length }, []];
        }
        if (s.startsWith('SELECT id FROM users WHERE role IN')) {
            return [[{ id: 4 }, { id: 1 }], []];
        }
        return [[], []];
    };

    dbMock.execute = runQuery;
    dbMock.getConnection = async () => ({
        beginTransaction: async () => {},
        execute: runQuery,
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    });

    try {
        const librarianToken = makeToken('librarian', 2);
        const sameUserOwnerToken = makeToken('owner', 2);
        const ownerToken = makeToken('owner', 4);

        // 1. Direct low-risk cataloguing with 0 copies succeeds immediately + writes CREATE_BOOK audit log
        const zeroCopyCreate = await invokeApp({
            method: 'POST',
            url: '/api/books',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { title: 'Đầu Sách Biên Mục', total_copies: 0, location: 'Phòng 01 - Kệ 02 - Ngăn 01' },
        });
        assert.equal(zeroCopyCreate.status, 201);
        assert.equal(zeroCopyCreate.json.requiresApproval, false);
        assert.equal(activityLogs.some((l) => l.action === 'CREATE_BOOK'), true);

        // 2. Direct shelf relocation applies immediately with before/after diff log
        const directRelocate = await invokeApp({
            method: 'PUT',
            url: '/api/books/10',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { location: 'Phòng 02 - Kệ 03 - Ngăn 02' },
        });
        assert.equal(directRelocate.status, 200);
        assert.equal(directRelocate.json.requiresApproval, false);
        assert.equal(books[0].location, 'Phòng 02 - Kệ 03 - Ngăn 02');
        assert.equal(activityLogs.some((l) => l.action === 'MOVE_LOCATION'), true);

        // 3. Modifying ISBN on a book with existing copies creates pending proposal (ISBN unchanged until approved)
        const sensitiveUpdate = await invokeApp({
            method: 'PUT',
            url: '/api/books/10',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { isbn: '978-604-1-99999-9', reason: 'Hiệu đính ISBN sai in ấn' },
        });
        assert.equal(sensitiveUpdate.status, 202);
        assert.equal(sensitiveUpdate.json.requiresApproval, true);
        assert.equal(books[0].isbn, '978-604-1-10001-1');

        // 4. Restock creates pending request (no stock increase until Owner approves)
        const restockProposal = await invokeApp({
            method: 'POST',
            url: '/api/books/10/restock',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { additionalCopies: 3, reason: 'Nhu cầu mượn tăng cao' },
        });
        assert.equal(restockProposal.status, 202);
        const restockId = restockProposal.json.request.id;
        assert.equal(books[0].total_copies, 2);

        // 5. Rule 1: Self-approval blocked (403) when reviewer_id === requested_by
        const selfApprove = await invokeApp({
            method: 'PATCH',
            url: `/api/book-requests/${restockId}/review`,
            headers: { authorization: `Bearer ${sameUserOwnerToken}` },
            body: { decision: 'approved' },
        });
        assert.equal(selfApprove.status, 403);

        // 6. Owner approves restock -> stock increases (+3) atomically + Rule 5 prevents double-approval (409)
        const ownerApprove = await invokeApp({
            method: 'PATCH',
            url: `/api/book-requests/${restockId}/review`,
            headers: { authorization: `Bearer ${ownerToken}` },
            body: { decision: 'approved', review_note: 'Đồng ý nhập thêm' },
        });
        assert.equal(ownerApprove.status, 200);
        assert.equal(ownerApprove.json.status, 'completed');
        assert.equal(books[0].total_copies, 5);
        assert.equal(bookCopies.filter((c) => c.book_id === 10).length, 5);

        const doubleApprove = await invokeApp({
            method: 'PATCH',
            url: `/api/book-requests/${restockId}/review`,
            headers: { authorization: `Bearer ${ownerToken}` },
            body: { decision: 'approved' },
        });
        assert.equal(doubleApprove.status, 409);

        // 7. Rule 2: Disposal blocked if book has active borrows, succeeds as soft delete after borrows clear
        borrowedActive = true;
        const blockedDisposal = await invokeApp({
            method: 'DELETE',
            url: '/api/books/10',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { reason: 'Thanh lý kiểm kê' },
        });
        assert.equal(blockedDisposal.status, 409);

        borrowedActive = false;
        const disposalProposal = await invokeApp({
            method: 'DELETE',
            url: '/api/books/10',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { reason: 'Thanh lý cuối năm', disposal_status: 'disposed' },
        });
        assert.equal(disposalProposal.status, 202);
        const disposalId = disposalProposal.json.request.id;

        const ownerApproveDisposal = await invokeApp({
            method: 'PATCH',
            url: `/api/book-requests/${disposalId}/review`,
            headers: { authorization: `Bearer ${ownerToken}` },
            body: { decision: 'approved' },
        });
        assert.equal(ownerApproveDisposal.status, 200);
        assert.equal(books[0].status, 'disposed');
    } finally {
        dbMock.execute = originalExecute;
        dbMock.getConnection = originalGetConnection;
    }
});

test('Smart Book Drop validates ownership and copy status before confirming drop-box return', async () => {
    const dbMock = require.cache[dbModulePath].exports;
    const originalExecute = dbMock.execute;
    const originalGetConnection = dbMock.getConnection;

    const copies = [
        {
            id: 193,
            book_id: 19,
            book_real_id: 19,
            qr_code: 'QR-BK-19-3',
            status: 'borrowed',
            book_title: 'Năng Đoạn Kim Cương',
            title: 'Năng Đoạn Kim Cương',
            location: 'Phòng 02 - Kệ 01 - Ngăn 02',
            active_borrow_id: 701,
            borrower_user_id: 3,
            borrower_id: 3,
            borrow_status: 'borrowing',
            active_borrow_status: 'borrowing',
            borrower_name: 'Hồ Thị B',
            borrower_email: 'reader3@example.com',
            borrower_card: 'LIB-RD-000007',
            due_date: '2026-11-11T00:00:00.000Z',
            is_drop_box: 0,
            drop_box_at: null,
            drop_box_status: 'none',
        },
        {
            id: 195,
            book_id: 19,
            book_real_id: 19,
            qr_code: 'QR-BK-19-5',
            status: 'available',
            book_title: 'Năng Đoạn Kim Cương',
            title: 'Năng Đoạn Kim Cương',
            location: 'Phòng 02 - Kệ 01 - Ngăn 02',
            active_borrow_id: null,
            borrower_user_id: null,
            borrower_id: null,
            borrow_status: null,
            active_borrow_status: null,
            borrower_name: null,
            due_date: null,
            is_drop_box: 0,
            drop_box_at: null,
            drop_box_status: 'none',
        },
        {
            id: 194,
            book_id: 19,
            book_real_id: 19,
            qr_code: 'QR-BK-19-4',
            status: 'borrowed',
            book_title: 'Năng Đoạn Kim Cương',
            title: 'Năng Đoạn Kim Cương',
            location: 'Phòng 02 - Kệ 01 - Ngăn 02',
            active_borrow_id: 702,
            borrower_user_id: 9,
            borrower_id: 9,
            borrow_status: 'borrowing',
            active_borrow_status: 'borrowing',
            borrower_name: 'Độc Giả Khác',
            due_date: '2026-11-15T00:00:00.000Z',
            is_drop_box: 0,
            drop_box_at: null,
            drop_box_status: 'none',
        },
    ];

    const runQuery = async (sql, params = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('SHOW COLUMNS FROM borrow_records LIKE')) {
            return [[{ Field: 'drop_box_proof_image' }], []];
        }
        if (s.includes('FROM borrow_records br JOIN book_copies bc ON br.book_copy_id = bc.id') && s.includes('WHERE br.user_id = ?')) {
            const own = copies
                .filter((c) => Number(c.borrower_user_id) === Number(params[0]) && c.active_borrow_status === 'borrowing')
                .map((c) => ({ qr_code: c.qr_code, book_id: c.book_id, title: c.title }));
            return [own, []];
        }
        if (s.includes('FROM book_copies bc JOIN books b ON bc.book_id = b.id') && s.includes('WHERE bc.qr_code = ?')) {
            const target = String(params[0] || '').trim().toUpperCase();
            const match = copies.find((c) => c.qr_code.toUpperCase() === target);
            return [match ? [{ ...match }] : [], []];
        }
        if (s.startsWith('SELECT COUNT(*) as count FROM book_copies')) {
            return [[{ count: 1 }], []];
        }
        if (s.startsWith('UPDATE borrow_records SET status = \'returned_drop_box\'')) {
            const recId = Number(params[2]);
            const target = copies.find((c) => Number(c.active_borrow_id) === recId);
            if (target) {
                target.borrow_status = 'returned_drop_box';
                target.active_borrow_status = 'returned_drop_box';
                target.drop_box_status = 'pending_audit';
                target.is_drop_box = 1;
                target.drop_box_at = new Date().toISOString();
            }
            return [{ affectedRows: 1 }, []];
        }
        return [[], []];
    };

    dbMock.execute = runQuery;
    dbMock.getConnection = async () => ({
        beginTransaction: async () => {},
        execute: runQuery,
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    });

    try {
        const readerToken = makeToken('reader', 3);
        const librarianToken = makeToken('librarian', 2);

        // 1. Reader checks QR-BK-19-5 (same book, available copy on shelf, NOT their loan) -> ineligible
        const checkWrongCopy = await invokeApp({
            method: 'GET',
            url: '/api/borrow/check-copy/QR-BK-19-5',
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(checkWrongCopy.status, 200);
        assert.equal(checkWrongCopy.json.can_return_by_caller, false);
        assert.equal(checkWrongCopy.json.is_own_loan, false);
        assert.equal(checkWrongCopy.json.drop_box_eligibility.eligible, false);
        assert.equal(checkWrongCopy.json.drop_box_eligibility.reason_code, 'NOT_BORROWED');
        assert.equal(checkWrongCopy.json.drop_box_eligibility.same_book_qr_code, 'QR-BK-19-3');

        // 2. Reader submits drop-box-return with QR-BK-19-5 -> rejected 400 and reminds QR-BK-19-3
        const submitWrongCopy = await invokeApp({
            method: 'POST',
            url: '/api/borrow/drop-box-return',
            headers: { authorization: `Bearer ${readerToken}` },
            body: { bookQrCode: 'QR-BK-19-5', proofImage: 'data:image/jpeg;base64,abc' },
        });
        assert.equal(submitWrongCopy.status, 400);
        assert.match(submitWrongCopy.json.message, /QR-BK-19-3/);

        // 3. Reader checks QR-BK-19-4 (borrowed by ANOTHER reader) -> ineligible 403 on submit + PII redacted
        const checkOthersCopy = await invokeApp({
            method: 'GET',
            url: '/api/borrow/check-copy/QR-BK-19-4',
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(checkOthersCopy.status, 200);
        assert.equal(checkOthersCopy.json.can_return_by_caller, false);
        assert.equal(checkOthersCopy.json.drop_box_eligibility.reason_code, 'NOT_OWN_LOAN');
        assert.equal(checkOthersCopy.json.borrower_name, undefined);

        const submitOthersCopy = await invokeApp({
            method: 'POST',
            url: '/api/borrow/drop-box-return',
            headers: { authorization: `Bearer ${readerToken}` },
            body: { bookQrCode: 'QR-BK-19-4', proofImage: 'data:image/jpeg;base64,abc' },
        });
        assert.equal(submitOthersCopy.status, 403);

        // 4. Reader checks their OWN borrowed copy QR-BK-19-3 -> eligible
        const checkOwnCopy = await invokeApp({
            method: 'GET',
            url: '/api/borrow/check-copy/QR-BK-19-3',
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(checkOwnCopy.status, 200);
        assert.equal(checkOwnCopy.json.is_own_loan, true);
        assert.equal(checkOwnCopy.json.can_return_by_caller, true);
        assert.equal(checkOwnCopy.json.drop_box_eligibility.eligible, true);
        assert.equal(checkOwnCopy.json.drop_box_eligibility.reason_code, 'OK');

        // 5. Kiosk staff check on available copy QR-BK-19-5 is also ineligible, whereas active loan QR-BK-19-3 is eligible
        const staffCheckShelf = await invokeApp({
            method: 'GET',
            url: '/api/borrow/check-copy/QR-BK-19-5',
            headers: { authorization: `Bearer ${librarianToken}` },
        });
        assert.equal(staffCheckShelf.json.drop_box_eligibility.eligible, false);
        assert.equal(staffCheckShelf.json.drop_box_eligibility.reason_code, 'NOT_BORROWED');

        const staffCheckOwn = await invokeApp({
            method: 'GET',
            url: '/api/borrow/check-copy/QR-BK-19-3',
            headers: { authorization: `Bearer ${librarianToken}` },
        });
        assert.equal(staffCheckOwn.json.drop_box_eligibility.eligible, true);
    } finally {
        dbMock.execute = originalExecute;
        dbMock.getConnection = originalGetConnection;
    }
});

test('GET /api/configs/public-rules exposes only whitelisted reader circulation rules without auth', async () => {
    const dbMock = require.cache[dbModulePath].exports;
    const originalExecute = dbMock.execute;

    dbMock.execute = async (sql) => {
        if (sql.includes('FROM system_configs WHERE key_name IN')) {
            return [[
                { key_name: 'max_books_per_user', value: '6' },
                { key_name: 'max_borrow_days', value: '21' },
                { key_name: 'secret_internal_key', value: 'should_not_leak' },
            ], []];
        }
        return [[], []];
    };

    try {
        const res = await invokeApp({
            method: 'GET',
            url: '/api/configs/public-rules',
        });
        assert.equal(res.status, 200);
        assert.equal(res.json.max_books_per_user, '6');
        assert.equal(res.json.max_borrow_days, '21');
        assert.equal(res.json.grace_days, '0');
        assert.equal(res.json.max_suspension_days, '14');
        assert.equal(res.json.secret_internal_key, undefined);
    } finally {
        dbMock.execute = originalExecute;
    }
});

test('Counter multi-slip return session issues one Return Slip linking all original Borrow Slips and enforces RBAC', async () => {
    const dbMock = require.cache[dbModulePath].exports;
    const originalExecute = dbMock.execute;
    const originalGetConnection = dbMock.getConnection;

    const insertedSlips = [];
    const updatedReturnSlipIds = [];
    const readerToken = makeToken('reader', 55);
    const otherReaderToken = makeToken('reader', 99);
    const librarianToken = makeToken('librarian', 2);

    const mockRecords = new Map([
        [101, {
            id: 101, user_id: 55, u_id: 55, book_copy_id: 201, copy_id: 201,
            qr_code: 'QR-BK-10-1', book_real_id: 10, title: 'Atomic Habits',
            cover_image: null, book_location: 'Phòng 01 - Kệ 01',
            full_name: 'Trần Kim Liên', email: 'lien@example.com', card_number: 'LIB-RD-000055',
            borrow_date: '2026-11-06T08:00:00Z', due_date: '2026-11-20T08:00:00Z', status: 'borrowing'
        }],
        [102, {
            id: 102, user_id: 55, u_id: 55, book_copy_id: 202, copy_id: 202,
            qr_code: 'QR-BK-11-1', book_real_id: 11, title: 'Nhà Giả Kim',
            cover_image: null, book_location: 'Phòng 01 - Kệ 02',
            full_name: 'Trần Kim Liên', email: 'lien@example.com', card_number: 'LIB-RD-000055',
            borrow_date: '2026-11-08T08:00:00Z', due_date: '2026-11-22T08:00:00Z', status: 'borrowing'
        }]
    ]);

    const sharedExecute = async (sql, params = []) => {
        if (sql.includes('SHOW COLUMNS FROM')) return [[{ Field: 'ok' }], []];
        if (sql.includes('CREATE TABLE IF NOT EXISTS')) return [{}, []];
        if (sql.includes('UPDATE exit_passes SET pass_code')) return [{}, []];
        if (sql.includes('FROM borrow_records br') && sql.includes('WHERE br.status = \'returned\' AND br.return_slip_id IS NULL')) return [[], []];
        if (sql.includes('FROM borrow_records br') && sql.includes('WHERE br.id = ? AND br.status = \'borrowing\'')) {
            const rec = mockRecords.get(Number(params[0]));
            return [rec ? [rec] : [], []];
        }
        if (sql.includes('FROM borrow_records br') && sql.includes('ORDER BY br.borrow_date ASC')) return [[], []];
        if (sql.includes('FROM exit_passes WHERE user_id = ?')) {
            return [[
                { id: 1, user_id: 55, pass_code: 'PM-BRW-001', items_summary: JSON.stringify([{ copyQr: 'QR-BK-10-1' }]), created_at: '2026-11-06T08:00:00Z' },
                { id: 2, user_id: 55, pass_code: 'PM-BRW-002', items_summary: JSON.stringify([{ copyQr: 'QR-BK-11-1' }]), created_at: '2026-11-08T08:00:00Z' }
            ], []];
        }
        if (sql.includes('FROM users WHERE card_number = ?')) {
            return [[{ id: 55, full_name: 'Trần Kim Liên', card_number: 'LIB-RD-000055', phone: '0976453123', status: 'active' }], []];
        }
        if (sql.includes('FROM users WHERE id = ?')) {
            const uid = Number(params[0]);
            if (uid === 2) return [[{ id: 2, full_name: 'Trần Thủ Thư', status: 'active' }], []];
            return [[{ id: 55, full_name: 'Trần Kim Liên', email: '', card_number: 'LIB-RD-000055', phone: '0976453123', status: 'active' }], []];
        }
        if (sql.includes('SELECT COALESCE(MAX(id), 0) as max_id FROM return_slips')) {
            return [[{ max_id: insertedSlips.length }], []];
        }
        if (sql.includes('SELECT id FROM return_slips WHERE return_code = ?')) {
            const hit = insertedSlips.find(s => s.return_code === params[0]);
            return [hit ? [{ id: hit.id }] : [], []];
        }
        if (sql.includes('INSERT INTO return_slips')) {
            const newId = insertedSlips.length + 1;
            insertedSlips.push({
                id: newId,
                return_code: params[0],
                user_id: params[1],
                processed_by: params[2],
                return_method: params[3],
                status: params[4],
                book_count: params[5],
                borrow_slip_codes: params[6],
                items_summary: params[7],
                drop_box_received_at: params[8],
                returned_at: params[9],
                notes: params[10],
                reader_name: 'Trần Kim Liên',
                card_number: 'LIB-RD-000055',
                librarian_name: 'Trần Thủ Thư',
            });
            return [{ insertId: newId }, []];
        }
        if (sql.includes('UPDATE borrow_records SET return_slip_id = ?')) {
            updatedReturnSlipIds.push({ slipId: params[0], condition: params[1], recordId: params[3] });
            return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('FROM return_slips rs') && sql.includes('WHERE rs.return_code = ?')) {
            const hit = insertedSlips.find(s => s.return_code === params[0] || s.id === Number(params[1]));
            return [hit ? [hit] : [], []];
        }
        if (sql.includes('FROM system_configs')) {
            return [[{ key_name: 'max_books_per_user', value: '5' }], []];
        }
        if (sql.includes('SELECT id, due_date FROM borrow_records')) return [[], []];
        if (sql.includes('SELECT f.id')) return [[], []];
        if (sql.includes('FROM reservations')) return [[], []];
        if (sql.includes('FROM users WHERE role IN')) return [[], []];
        return [[], []];
    };

    dbMock.execute = sharedExecute;
    dbMock.getConnection = async () => ({
        beginTransaction: async () => {},
        execute: sharedExecute,
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
    });

    try {
        // 1. Reader cannot call /api/borrow/return-session or /api/borrow/return-slips/list
        const readerDeniedSession = await invokeApp({
            method: 'POST',
            url: '/api/borrow/return-session',
            headers: { authorization: `Bearer ${readerToken}` },
            body: { items: [{ borrowRecordId: 101 }] },
        });
        assert.equal(readerDeniedSession.status, 403);

        const readerDeniedList = await invokeApp({
            method: 'GET',
            url: '/api/borrow/return-slips/list',
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(readerDeniedList.status, 403);

        // 2. Librarian completes counter return session for 2 books across PM-BRW-001 & PM-BRW-002
        const sessionRes = await invokeApp({
            method: 'POST',
            url: '/api/borrow/return-session',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: {
                readerCardNumber: 'LIB-RD-000055',
                items: [
                    { borrowRecordId: 101, bookQrCode: 'QR-BK-10-1', condition: 'normal' },
                    { borrowRecordId: 102, bookQrCode: 'QR-BK-11-1', condition: 'damaged', conditionNote: 'Quăn góc bìa' }
                ]
            },
        });
        assert.equal(sessionRes.status, 200);
        assert.equal(sessionRes.json.returnedCount, 2);
        assert.ok(sessionRes.json.returnSlip);
        const generatedCode = sessionRes.json.returnSlip.return_code;
        assert.match(generatedCode, /^RT-\d{4}-\d{4}/);
        assert.deepEqual(sessionRes.json.returnSlip.borrow_slip_codes, ['PM-BRW-001', 'PM-BRW-002']);
        assert.equal(sessionRes.json.returnSlip.status, 'partial_incident');
        assert.equal(updatedReturnSlipIds.length, 2);

        // 3. Owner reader can fetch their own Return Slip by code; other reader gets 403
        const ownGetRes = await invokeApp({
            method: 'GET',
            url: `/api/borrow/return-slips/${generatedCode}`,
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(ownGetRes.status, 200);
        assert.equal(ownGetRes.json.return_code, generatedCode);

        const otherGetRes = await invokeApp({
            method: 'GET',
            url: `/api/borrow/return-slips/${generatedCode}`,
            headers: { authorization: `Bearer ${otherReaderToken}` },
        });
        assert.equal(otherGetRes.status, 403);
    } finally {
        dbMock.execute = originalExecute;
        dbMock.getConnection = originalGetConnection;
    }
});
