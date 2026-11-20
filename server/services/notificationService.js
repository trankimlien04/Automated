const db = require('../config/db');
const { toLocalDateString } = require('../utils/dateUtils');

/**
 * Unified notification policy matrix for Automated:
 * - email: 'required' | 'optional' | 'none'
 * - inApp: true | false
 */
const NOTIFICATION_POLICIES = {
    account_approved: { email: 'required', inApp: true, group: 'important' },
    account_rejected: { email: 'required', inApp: true, group: 'important' },
    account_locked: { email: 'required', inApp: true, group: 'important' },
    account_unlocked: { email: 'required', inApp: true, group: 'important' },
    due_reminder_t2: { email: 'required', inApp: true, group: 'important' },
    overdue_day1: { email: 'required', inApp: true, group: 'important' },
    account_suspended: { email: 'required', inApp: true, group: 'important' },
    reservation_ready: { email: 'required', inApp: true, group: 'important' },
    drop_box_receipt: { email: 'required', inApp: true, group: 'important' },
    drop_box_incident: { email: 'required', inApp: true, group: 'important' },

    counter_borrow_receipt: { email: 'optional', inApp: true, group: 'optional' },
    counter_return_receipt: { email: 'optional', inApp: true, group: 'optional' },

    drop_box_normal_audit: { email: 'none', inApp: true, group: 'in_app_only' },
    suspension_expired: { email: 'none', inApp: true, group: 'in_app_only' },
    renewal_success: { email: 'none', inApp: true, group: 'in_app_only' },
    reservation_cancelled: { email: 'none', inApp: true, group: 'in_app_only' },
    draft_borrow_created: { email: 'none', inApp: true, group: 'in_app_only' },
    book_recommendation: { email: 'none', inApp: true, group: 'in_app_only' },
    card_expiring: { email: 'none', inApp: true, group: 'in_app_only' },
    system_broadcast: { email: 'none', inApp: true, group: 'in_app_only' },
    profile_updated: { email: 'none', inApp: true, group: 'in_app_only' },
    due_today_inapp: { email: 'none', inApp: true, group: 'in_app_only' },
};

function getNotificationPolicy(eventType) {
    return NOTIFICATION_POLICIES[eventType] || { email: 'none', inApp: true, group: 'in_app_only' };
}

/**
 * Read optional email channel preferences for a reader (defaults to opt-in false for counter slips)
 */
async function getUserNotificationPreferences(userId, conn = db) {
    if (!userId) return { emailReceipts: false };
    try {
        const [rows] = await conn.execute(
            'SELECT email_receipts FROM user_preferences WHERE user_id = ? LIMIT 1',
            [userId]
        );
        return {
            emailReceipts: Boolean(rows[0]?.email_receipts),
        };
    } catch {
        return { emailReceipts: false };
    }
}

async function updateUserNotificationPreferences(userId, { emailReceipts = false } = {}) {
    const cleanVal = emailReceipts ? 1 : 0;
    await db.execute(
        `INSERT INTO user_preferences (user_id, email_receipts)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE email_receipts = VALUES(email_receipts)`,
        [userId, cleanVal]
    );
    return { emailReceipts: Boolean(cleanVal) };
}

/**
 * Gửi thông báo In-app tới 1 người dùng cụ thể
 */
async function notifyUser(userId, title, message, type = 'info', conn = db) {
    if (!userId) return;
    try {
        await conn.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
            [userId, title, message, type]
        );
    } catch (err) {
        console.error(`Lỗi gửi thông báo tới user #${userId}:`, err);
    }
}

/**
 * Gửi thông báo tới tất cả người dùng active thuộc danh sách roles (vd: ['librarian', 'admin', 'owner'])
 */
async function notifyRoles(roles, title, message, type = 'info', excludeUserId = null) {
    if (!roles || roles.length === 0) return;
    try {
        const placeholders = roles.map(() => '?').join(',');
        const queryParams = [...roles];
        let sql = `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`;
        
        if (excludeUserId) {
            sql += ` AND id != ?`;
            queryParams.push(excludeUserId);
        }

        const [users] = await db.execute(sql, queryParams);
        for (const u of users) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [u.id, title, message, type]
            );
        }
    } catch (err) {
        console.error(`Lỗi gửi thông báo theo role [${roles.join(', ')}]:`, err);
    }
}

/**
 * Gửi thông báo tới toàn bộ ban điều hành thư viện (Thủ thư, Admin, Chủ thư viện)
 */
async function notifyAllStaff(title, message, type = 'info', excludeUserId = null) {
    return notifyRoles(['librarian', 'admin', 'owner'], title, message, type, excludeUserId);
}

/**
 * Central Notification Service Dispatcher:
 * - Always invoked AFTER backend state is committed
 * - Enforces event channel rules (required email vs optional email vs in-app only)
 * - Checks deduplication via dedupKey in notification_dispatches
 */
async function dispatchDomainNotification({
    userId,
    eventType,
    dedupKey = null,
    inApp = null,
    sendEmailFn = null,
    forceEmail = false,
}) {
    const policy = getNotificationPolicy(eventType);
    const emailService = require('./emailService');

    let alreadyDispatched = false;
    if (dedupKey) {
        alreadyDispatched = await emailService.hasDispatchedByDedupKey(dedupKey);
    }

    let inAppSent = false;
    if (policy.inApp && inApp && userId && !(inApp.skipIfDeduped && alreadyDispatched)) {
        await notifyUser(userId, inApp.title, inApp.message, inApp.type || 'info');
        inAppSent = true;
    }

    if (policy.email === 'none' || typeof sendEmailFn !== 'function') {
        return {
            eventType,
            policy,
            inAppSent,
            emailResult: null,
            skippedEmailReason: policy.email === 'none' ? 'in_app_only_policy' : 'no_email_sender',
        };
    }

    if (alreadyDispatched) {
        return {
            eventType,
            policy,
            inAppSent,
            emailResult: { success: true, mode: 'dedup_skipped', skippedDuplicate: true, dedupKey },
            skippedEmailReason: 'dedup_key_already_sent',
        };
    }

    if (policy.email === 'optional' && !forceEmail) {
        const prefs = await getUserNotificationPreferences(userId);
        if (!prefs.emailReceipts) {
            return {
                eventType,
                policy,
                inAppSent,
                emailResult: null,
                skippedEmailReason: 'optional_preference_disabled',
            };
        }
    }

    const emailResult = await sendEmailFn(dedupKey).catch((err) => {
        console.error(`Lỗi gửi email sự kiện [${eventType}] cho user #${userId}:`, err.message);
        return { success: false, mode: 'error', error: err.message };
    });

    return {
        eventType,
        policy,
        inAppSent,
        emailResult,
        skippedEmailReason: null,
    };
}

/**
 * Helper: Notify reader (In-app + Email) when a reservation transitions to 'notified' (ready for 48h pickup)
 * Must be called AFTER DB status update is committed.
 */
async function dispatchReservationReadyNotification({
    userId,
    reservationId,
    bookTitle,
    expiresAt = null,
    location = null,
    inAppTitle = '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
    inAppMessage = null,
    skipInApp = false,
}) {
    if (!userId || !bookTitle) return null;

    let reader = null;
    try {
        const [rows] = await db.execute(
            'SELECT id, full_name, email, card_number FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        reader = rows[0] || null;
    } catch {
        reader = null;
    }

    const expiresDay = toLocalDateString(expiresAt || new Date()) || toLocalDateString(new Date());
    const dedupKey = reservationId ? `reservation_ready:${reservationId}:${expiresDay}` : null;
    const finalMessage = inAppMessage
        || `Cuốn sách "${bookTitle}" bạn đặt trước đã có sẵn tại thư viện. Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Hãy vào mục "Đặt trước sách" để xác nhận mượn nhé!`;

    const emailService = require('./emailService');
    return dispatchDomainNotification({
        userId,
        eventType: 'reservation_ready',
        dedupKey,
        inApp: skipInApp ? null : {
            title: inAppTitle,
            message: finalMessage,
            type: 'reminder',
            skipIfDeduped: true,
        },
        sendEmailFn: reader?.email
            ? (key) => emailService.sendReservationReadyEmail({
                to: reader.email,
                userId,
                fullName: reader.full_name,
                cardNumber: reader.card_number,
                bookTitle,
                location,
                ticketCode: reservationId ? `TICKET-RES-${reservationId}` : null,
                expiresAt,
                dedupKey: key,
            })
            : null,
    });
}

/**
 * Helper: Notify reader ONLY when circulation state genuinely transitions from NOT SUSPENDED -> SUSPENDED.
 * Prevents repeated suspension emails on status checks or batch updates.
 */
async function dispatchSuspensionTransitionNotification({
    userId,
    previousSuspendedUntil = null,
    newSuspendedUntil = null,
    suspendedDaysAdded = 0,
    overdueDays = 0,
    bookTitle = null,
    reason = null,
    skipInApp = true,
}) {
    if (!userId || !newSuspendedUntil || Number(suspendedDaysAdded) <= 0) return null;

    const nowMs = Date.now();
    const wasAlreadySuspended = Boolean(
        previousSuspendedUntil && new Date(previousSuspendedUntil).getTime() > nowMs
    );
    const isNowSuspended = Boolean(new Date(newSuspendedUntil).getTime() > nowMs);

    // Only emit when status genuinely transitions into SUSPENDED
    if (wasAlreadySuspended || !isNowSuspended) {
        return { skippedTransition: true, wasAlreadySuspended, isNowSuspended };
    }

    let reader = null;
    try {
        const [rows] = await db.execute(
            'SELECT id, full_name, email, card_number FROM users WHERE id = ? LIMIT 1',
            [userId]
        );
        reader = rows[0] || null;
    } catch {
        reader = null;
    }

    const untilStr = toLocalDateString(newSuspendedUntil);
    const dedupKey = `account_suspended:${userId}:${untilStr}`;
    const emailService = require('./emailService');

    return dispatchDomainNotification({
        userId,
        eventType: 'account_suspended',
        dedupKey,
        inApp: skipInApp ? null : {
            title: '⛔ Thẻ tạm đình chỉ quyền mượn sách',
            message: `Quyền mượn sách của bạn bị tạm đình chỉ ${suspendedDaysAdded} ngày (đến ${new Date(newSuspendedUntil).toLocaleDateString('vi-VN')}) do hoàn trả trễ hạn${bookTitle ? ` cuốn "${bookTitle}"` : ''}.`,
            type: 'warning',
            skipIfDeduped: true,
        },
        sendEmailFn: reader?.email
            ? (key) => emailService.sendSuspensionNoticeEmail({
                to: reader.email,
                userId,
                fullName: reader.full_name,
                cardNumber: reader.card_number,
                suspendedUntil: newSuspendedUntil,
                suspendedDaysAdded,
                overdueDays,
                bookTitle,
                reason,
                dedupKey: key,
            })
            : null,
    });
}

module.exports = {
    NOTIFICATION_POLICIES,
    getNotificationPolicy,
    getUserNotificationPreferences,
    updateUserNotificationPreferences,
    notifyUser,
    notifyRoles,
    notifyAllStaff,
    dispatchDomainNotification,
    dispatchReservationReadyNotification,
    dispatchSuspensionTransitionNotification,
};
