const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { PassThrough } = require('node:stream');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-smoke-test-jwt-secret';

const dbModulePath = require.resolve('../config/db');
if (!require.cache[dbModulePath]) {
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: {
            execute: async () => [[], []],
            query: async () => [[], []],
            getConnection: async () => ({
                beginTransaction: async () => { },
                execute: async () => [[], []],
                commit: async () => { },
                rollback: async () => { },
                release: () => { },
            }),
        },
    };
}

const db = require('../config/db');
const { getJwtSecret } = require('../middlewares/authMiddleware');
const { app } = require('../index');

const { runDueDateRemindersSweep } = require('../services/dueReminderService');
const {
    NOTIFICATION_POLICIES,
    getNotificationPolicy,
    dispatchDomainNotification,
    dispatchReservationReadyNotification,
    dispatchSuspensionTransitionNotification,
} = require('../services/notificationService');
const { toLocalDateString, addDaysToDateString } = require('../utils/dateUtils');

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
        outSocket.cork = () => { };
        outSocket.uncork = () => { };
        outSocket.destroy = () => { };
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

test('Notification policy matrix enforces 3-tier Email/In-app rules', () => {
    assert.equal(getNotificationPolicy('account_approved').email, 'required');
    assert.equal(getNotificationPolicy('due_reminder_t2').email, 'required');
    assert.equal(getNotificationPolicy('overdue_day1').email, 'required');
    assert.equal(getNotificationPolicy('account_suspended').email, 'required');
    assert.equal(getNotificationPolicy('reservation_ready').email, 'required');
    assert.equal(getNotificationPolicy('drop_box_receipt').email, 'required');
    assert.equal(getNotificationPolicy('drop_box_incident').email, 'required');

    assert.equal(getNotificationPolicy('counter_borrow_receipt').email, 'optional');
    assert.equal(getNotificationPolicy('counter_return_receipt').email, 'optional');

    assert.equal(getNotificationPolicy('drop_box_normal_audit').email, 'none');
    assert.equal(getNotificationPolicy('suspension_expired').email, 'none');
    assert.equal(getNotificationPolicy('renewal_success').email, 'none');
    assert.equal(getNotificationPolicy('card_expiring').email, 'none');
    assert.equal(getNotificationPolicy('system_broadcast').email, 'none');
    assert.equal(getNotificationPolicy('due_today_inapp').email, 'none');

    for (const key of Object.keys(NOTIFICATION_POLICIES)) {
        assert.equal(NOTIFICATION_POLICIES[key].inApp, true);
    }
});

test('runDueDateRemindersSweep groups T-2 books per reader, skips T-0 email, limits overdue email to day 1, and deduplicates across reruns', async () => {
    const originalExecute = db.execute;
    const dispatched = [];
    const inAppLogs = [];
    const dispatchedDedupKeys = new Set();

    const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
    const envBackup = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    const todayStr = toLocalDateString(new Date());
    const inTwoDaysStr = addDaysToDateString(todayStr, 2);
    const yesterdayStr = addDaysToDateString(todayStr, -1);
    const threeDaysAgoStr = addDaysToDateString(todayStr, -4);
    const cardTargetStr = addDaysToDateString(todayStr, 7);

    db.execute = async (sql, params = []) => {
        if (sql.includes('SELECT host, port, secure, username, password_encrypted')) {
            return [[], []];
        }
        if (sql.includes('FROM notification_dispatches') && sql.includes('dedup_key = ?')) {
            const exists = dispatchedDedupKeys.has(params[0]);
            return [exists ? [{ id: 1 }] : [], []];
        }
        if (sql.includes('INSERT INTO notification_dispatches')) {
            dispatched.push({
                userId: params[0],
                email: params[1],
                templateType: params[3],
                title: params[4],
                status: params[6],
                dedupKey: params[8],
                eventType: params[9],
            });
            if (params[8]) dispatchedDedupKeys.add(params[8]);
            return [{ insertId: dispatched.length }, []];
        }
        if (sql.includes('FROM notifications') && sql.includes('DATE(created_at) = CURDATE()')) {
            const matched = inAppLogs.some(
                (n) => n.userId === params[0] && n.title === params[1] && (!params[2] || n.message.includes(params[2].replace(/%/g, '')))
            );
            return [matched ? [{ id: 1 }] : [], []];
        }
        if (sql.includes('INSERT INTO notifications')) {
            inAppLogs.push({ userId: params[0], title: params[1], message: params[2], type: params[3] });
            return [{ insertId: inAppLogs.length }, []];
        }
        if (sql.includes('FROM borrow_records br') && sql.includes('DATE(br.due_date) = ?') && params[0] === inTwoDaysStr) {
            return [[
                { borrow_record_id: 101, user_id: 7, due_date: `${inTwoDaysStr}T00:00:00`, copy_qr: 'QR-BK-1', title: 'Atomic Habits', full_name: 'Trần Kim Liên', email: 'lien@example.com', card_number: 'LIB-RD-000007' },
                { borrow_record_id: 102, user_id: 7, due_date: `${inTwoDaysStr}T00:00:00`, copy_qr: 'QR-BK-2', title: 'Đắc Nhân Tâm', full_name: 'Trần Kim Liên', email: 'lien@example.com', card_number: 'LIB-RD-000007' },
                { borrow_record_id: 103, user_id: 7, due_date: `${inTwoDaysStr}T00:00:00`, copy_qr: 'QR-BK-3', title: 'Nhà Giả Kim', full_name: 'Trần Kim Liên', email: 'lien@example.com', card_number: 'LIB-RD-000007' },
            ], []];
        }
        if (sql.includes('FROM borrow_records br') && sql.includes('DATE(br.due_date) = ?') && params[0] === todayStr) {
            return [[
                { borrow_record_id: 201, user_id: 8, due_date: `${todayStr}T00:00:00`, copy_qr: 'QR-BK-4', title: 'Sapiens', full_name: 'Lê Minh', email: 'minh@example.com', card_number: 'LIB-RD-000008' },
            ], []];
        }
        if (sql.includes('FROM borrow_records br') && sql.includes('DATE(br.due_date) < ?')) {
            return [[
                { borrow_record_id: 301, user_id: 9, due_date: `${yesterdayStr}T00:00:00`, copy_qr: 'QR-BK-5', title: 'Clean Code', full_name: 'Nguyễn An', email: 'an@example.com', card_number: 'LIB-RD-000009' },
                { borrow_record_id: 302, user_id: 9, due_date: `${threeDaysAgoStr}T00:00:00`, copy_qr: 'QR-BK-6', title: 'Refactoring', full_name: 'Nguyễn An', email: 'an@example.com', card_number: 'LIB-RD-000009' },
            ], []];
        }
        if (sql.includes('FROM users') && sql.includes('DATE(card_expiry)')) {
            return [[
                { id: 10, full_name: 'Phạm Hoa', email: 'hoa@example.com', card_number: 'LIB-RD-000010', card_expiry: cardTargetStr },
            ], []];
        }
        return [[], []];
    };

    try {
        const firstRun = await runDueDateRemindersSweep({ source: 'cron', deduplicateToday: true });
        assert.equal(firstRun.dueSoonCount, 3);
        assert.equal(firstRun.dueTodayCount, 1);
        assert.equal(firstRun.expiringCardsCount, 1);

        // Expect ONLY 2 emails on first run: 1 grouped T-2 digest for user 7, and 1 day-1 overdue warning for user 9 (NOT T-0, NOT 4-day old overdue, NOT expiring card)
        assert.equal(dispatched.length, 2);
        assert.equal(dispatched.filter((d) => d.templateType === 'due_reminder_t2').length, 1);
        assert.ok(dispatched[0].title.includes('3 cuốn sách'));
        assert.equal(dispatched.filter((d) => d.templateType === 'due_today_t0').length, 0);
        assert.equal(dispatched.filter((d) => d.templateType === 'overdue_warning').length, 1);
        assert.ok(dispatched[1].title.includes('Clean Code'));

        // Re-run immediately (simulating Cron restart / catch-up) -> 0 duplicate emails!
        const secondRun = await runDueDateRemindersSweep({ source: 'cron', deduplicateToday: true });
        assert.equal(secondRun.emailCount, 0);
        assert.equal(dispatched.length, 2);
    } finally {
        db.execute = originalExecute;
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test('Suspension notification fires ONLY on non-suspended -> suspended transition and deduplicates', async () => {
    const originalExecute = db.execute;
    const dispatched = [];
    const seenKeys = new Set();

    const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
    const envBackup = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    db.execute = async (sql, params = []) => {
        if (sql.includes('SELECT host, port, secure, username, password_encrypted')) return [[], []];
        if (sql.includes('SELECT id, full_name, email, card_number FROM users WHERE id = ?')) {
            return [[{ id: 55, full_name: 'Trần Văn B', email: 'b@example.com', card_number: 'LIB-RD-000055' }], []];
        }
        if (sql.includes('FROM notification_dispatches') && sql.includes('dedup_key = ?')) {
            return [seenKeys.has(params[0]) ? [{ id: 1 }] : [], []];
        }
        if (sql.includes('INSERT INTO notification_dispatches')) {
            dispatched.push({ templateType: params[3], dedupKey: params[8] });
            if (params[8]) seenKeys.add(params[8]);
            return [{ insertId: dispatched.length }, []];
        }
        return [[], []];
    };

    try {
        const futureEnd = new Date(Date.now() + 5 * 86400000).toISOString();
        const alreadyFuture = new Date(Date.now() + 2 * 86400000).toISOString();

        // Already suspended -> must NOT fire again
        const skipped = await dispatchSuspensionTransitionNotification({
            userId: 55,
            previousSuspendedUntil: alreadyFuture,
            newSuspendedUntil: futureEnd,
            suspendedDaysAdded: 3,
            overdueDays: 3,
            skipInApp: true,
        });
        assert.equal(skipped.skippedTransition, true);
        assert.equal(dispatched.length, 0);

        // Genuine transition null -> future -> fires once
        const sent = await dispatchSuspensionTransitionNotification({
            userId: 55,
            previousSuspendedUntil: null,
            newSuspendedUntil: futureEnd,
            suspendedDaysAdded: 5,
            overdueDays: 5,
            bookTitle: 'Thiết kế hệ thống',
            skipInApp: true,
        });
        assert.equal(sent.emailResult?.success, true);
        assert.equal(dispatched.length, 1);
        assert.equal(dispatched[0].templateType, 'account_suspended');

        // Repeated call with same transition window -> deduped!
        const deduped = await dispatchSuspensionTransitionNotification({
            userId: 55,
            previousSuspendedUntil: null,
            newSuspendedUntil: futureEnd,
            suspendedDaysAdded: 5,
            overdueDays: 5,
            skipInApp: true,
        });
        assert.equal(deduped.emailResult?.skippedDuplicate, true);
        assert.equal(dispatched.length, 1);
    } finally {
        db.execute = originalExecute;
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test('Reservation ready sends both In-app + Email once and optional email preference API toggles cleanly', async () => {
    const originalExecute = db.execute;
    const dispatched = [];
    const inApp = [];
    let storedPref = 0;

    const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
    const envBackup = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    db.execute = async (sql, params = []) => {
        if (sql.includes('SELECT host, port, secure, username, password_encrypted')) return [[], []];
        if (sql.includes('SELECT email_receipts FROM user_preferences')) {
            return [[{ email_receipts: storedPref }], []];
        }
        if (sql.includes('INSERT INTO user_preferences')) {
            storedPref = params[1];
            return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('SELECT id, full_name, email, card_number FROM users WHERE id = ?')) {
            return [[{ id: 77, full_name: 'Độc giả Test', email: 'reader77@example.com', card_number: 'LIB-RD-000077' }], []];
        }
        if (sql.includes('FROM notification_dispatches') && sql.includes('dedup_key = ?')) {
            const exists = dispatched.some((d) => d.dedupKey === params[0]);
            return [exists ? [{ id: 1 }] : [], []];
        }
        if (sql.includes('INSERT INTO notification_dispatches')) {
            dispatched.push({ templateType: params[3], dedupKey: params[8] });
            return [{ insertId: dispatched.length }, []];
        }
        if (sql.includes('INSERT INTO notifications')) {
            inApp.push({ userId: params[0], title: params[1] });
            return [{ insertId: inApp.length }, []];
        }
        return [[], []];
    };

    try {
        const readerToken = jwt.sign(
            { id: 77, role: 'reader', full_name: 'Độc giả Test', email: 'reader77@example.com' },
            getJwtSecret(),
            { expiresIn: '1h' }
        );

        // Optional counter receipt blocked when preference is false
        const optOff = await dispatchDomainNotification({
            userId: 77,
            eventType: 'counter_borrow_receipt',
            dedupKey: 'exit_pass:PM-1',
            inApp: { title: 'Phiếu mượn', message: 'Đã mượn' },
            sendEmailFn: async () => ({ success: true }),
        });
        assert.equal(optOff.inAppSent, true);
        assert.equal(optOff.skippedEmailReason, 'optional_preference_disabled');

        // Toggle preference ON via API
        const putRes = await invokeApp({
            method: 'PUT',
            url: '/api/notifications/preferences',
            headers: { authorization: `Bearer ${readerToken}` },
            body: { emailReceipts: true },
        });
        assert.equal(putRes.status, 200);
        assert.equal(putRes.json.emailReceipts, true);

        const getRes = await invokeApp({
            method: 'GET',
            url: '/api/notifications/preferences',
            headers: { authorization: `Bearer ${readerToken}` },
        });
        assert.equal(getRes.status, 200);
        assert.equal(getRes.json.emailReceipts, true);

        // Reservation ready fires Email + In-app once
        const resReady = await dispatchReservationReadyNotification({
            userId: 77,
            reservationId: 99,
            bookTitle: 'Clean Architecture',
            expiresAt: new Date(Date.now() + 48 * 3600000),
        });
        assert.equal(resReady.inAppSent, true);
        assert.equal(resReady.emailResult?.success, true);
        assert.equal(dispatched.some((d) => d.templateType === 'reservation_ready'), true);

        // Second call with same reservation ready window -> skipped
        const resReadyDup = await dispatchReservationReadyNotification({
            userId: 77,
            reservationId: 99,
            bookTitle: 'Clean Architecture',
            expiresAt: new Date(Date.now() + 48 * 3600000),
        });
        assert.equal(resReadyDup.skippedEmailReason, 'dedup_key_already_sent');
        assert.equal(dispatched.filter((d) => d.templateType === 'reservation_ready').length, 1);
    } finally {
        db.execute = originalExecute;
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});

test('Drop Box 24/7 normal audit sends In-app ONLY while damaged/missing sends Email + In-app', async () => {
    const originalExecute = db.execute;
    const originalGetConnection = db.getConnection;
    const dispatched = [];
    const inApp = [];

    const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_HOST', 'EMAIL_USER', 'EMAIL_PASS'];
    const envBackup = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];

    let currentAuditAction = 'verify_intact';
    const mockDbHandler = async (sql, params = []) => {
        if (sql.includes('SELECT host, port, secure, username, password_encrypted')) return [[], []];
        if (sql.includes('SHOW COLUMNS FROM return_slips') || sql.includes('SHOW COLUMNS FROM borrow_records')) return [[{ Field: 'ok' }], []];
        if (sql.includes('FROM borrow_records br') && sql.includes('br.id = ?')) {
            return [[{
                id: 501,
                book_copy_id: 88,
                copy_id: 88,
                book_id: 12,
                book_title: 'Thiết kế hệ thống phân tán',
                qr_code: 'QR-BK-0088',
                location: 'Phòng 01 - Kệ 01 - Ngăn 01',
                due_date: new Date(Date.now() + 86400000).toISOString(),
                borrow_date: new Date(Date.now() - 86400000).toISOString(),
                drop_box_at: new Date().toISOString(),
                status: 'returned_drop_box',
                drop_box_status: 'pending_audit',
                reader_id: 33,
                reader_name: 'Độc giả DropBox',
                reader_email: 'dropbox@example.com',
                reader_card: 'LIB-RD-000033',
            }], []];
        }
        if (sql.includes('SELECT id, full_name, email, role, card_number, status, suspended_until FROM users WHERE id = ?')) {
            return [[{ id: 33, full_name: 'Độc giả DropBox', email: 'dropbox@example.com', role: 'reader', card_number: 'LIB-RD-000033', status: 'active', suspended_until: null }], []];
        }
        if (sql.includes('SELECT full_name FROM users WHERE id = ?')) {
            return [[{ full_name: 'Trần Thủ Thư' }], []];
        }
        if (sql.includes('INSERT INTO notifications')) {
            inApp.push({ userId: params[0], title: params[1] });
            return [{ insertId: inApp.length }, []];
        }
        if (sql.includes('INSERT INTO notification_dispatches')) {
            dispatched.push({ action: currentAuditAction, templateType: params[3], eventType: params[9] });
            return [{ insertId: dispatched.length }, []];
        }
        return [[], []];
    };

    db.execute = mockDbHandler;
    db.getConnection = async () => ({
        beginTransaction: async () => { },
        execute: mockDbHandler,
        commit: async () => { },
        rollback: async () => { },
        release: () => { },
    });

    try {
        const librarianToken = jwt.sign(
            { id: 2, role: 'librarian', full_name: 'Trần Thủ Thư', email: 'lib@example.com' },
            getJwtSecret(),
            { expiresIn: '1h' }
        );

        // 1. Normal audit -> In-app ONLY, 0 emails dispatched
        currentAuditAction = 'verify_intact';
        const normalRes = await invokeApp({
            method: 'POST',
            url: '/api/borrow/drop-box-audit',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { recordId: 501, action: 'verify_intact', auditNote: 'Sách nguyên vẹn' },
        });
        assert.equal(normalRes.status, 200);
        assert.equal(inApp.some((n) => n.userId === 33), true);
        assert.equal(dispatched.length, 0);

        // 2. Damaged audit -> Email + In-app dispatched
        currentAuditAction = 'report_damaged';
        const damagedRes = await invokeApp({
            method: 'POST',
            url: '/api/borrow/drop-box-audit',
            headers: { authorization: `Bearer ${librarianToken}` },
            body: { recordId: 501, action: 'report_damaged', severity: 'moderate', auditNote: 'Rách bìa' },
        });
        assert.equal(damagedRes.status, 200);
        assert.equal(dispatched.length, 1);
        assert.equal(dispatched[0].templateType, 'drop_box_audit_result');
        assert.equal(dispatched[0].eventType, 'drop_box_incident');
    } finally {
        db.execute = originalExecute;
        db.getConnection = originalGetConnection;
        for (const [k, v] of Object.entries(envBackup)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
});
