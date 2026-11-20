const db = require('../config/db');
const emailService = require('./emailService');
const { calculateOverdue } = require('./fineSyncService');
const { toLocalDateString, addDaysToDateString, formatLocalDateVN } = require('../utils/dateUtils');

async function hasInAppNotificationToday(userId, title, messageKeyword = null) {
    try {
        if (messageKeyword) {
            const escaped = String(messageKeyword).replace(/[\\%_]/g, (m) => `\\${m}`);
            const [rows] = await db.execute(
                `SELECT id FROM notifications
                 WHERE user_id = ? AND title = ? AND message LIKE ? AND DATE(created_at) = CURDATE()
                 LIMIT 1`,
                [userId, title, `%${escaped}%`]
            );
            return Array.isArray(rows) && rows.length > 0;
        }
        const [rows] = await db.execute(
            `SELECT id FROM notifications
             WHERE user_id = ? AND title = ? AND DATE(created_at) = CURDATE()
             LIMIT 1`,
            [userId, title]
        );
        return Array.isArray(rows) && rows.length > 0;
    } catch {
        return false;
    }
}

async function insertInAppNotification({ userId, title, message, type, messageKeyword = null, deduplicateToday, stats }) {
    if (deduplicateToday && (await hasInAppNotificationToday(userId, title, messageKeyword))) {
        return false;
    }
    await db.execute(
        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
        [userId, title, message, type]
    );
    stats.inAppCount += 1;
    return true;
}

async function sendTrackedReminderEmail({ sendFn, payload, dedupKey, deduplicateToday, stats }) {
    if (!payload.to) return null;
    if (deduplicateToday && dedupKey && (await emailService.hasDispatchedByDedupKey(dedupKey))) {
        return { skippedDuplicate: true, dedupKey };
    }
    const result = await sendFn({
        ...payload,
        dedupKey: deduplicateToday ? dedupKey : null,
    });
    if (result?.skippedDuplicate) {
        return result;
    }
    stats.emailCount += 1;
    if (result?.success && result.mode === 'smtp_real') {
        stats.realEmailCount += 1;
    } else if (result?.success && result.mode === 'simulated') {
        stats.simulatedEmailCount += 1;
    } else {
        stats.failedEmailCount += 1;
    }
    return result;
}

function groupRowsByUser(rows) {
    const map = new Map();
    for (const row of rows) {
        const uid = Number(row.user_id);
        if (!map.has(uid)) {
            map.set(uid, {
                userId: uid,
                fullName: row.full_name,
                email: row.email,
                cardNumber: row.card_number,
                items: [],
            });
        }
        map.get(uid).items.push(row);
    }
    return Array.from(map.values());
}

/**
 * Quét & phát hành thông báo theo quy tắc kênh thống nhất:
 * - T-2 ngày: 1 Email gộp theo độc giả + In-app (chống trùng theo dedup_key)
 * - T-0 ngày (hạn chót): Chỉ In-app (không gửi trùng email lần 2)
 * - Quá hạn ngày đầu (T+1): 1 Email gộp theo độc giả + In-app (chống trùng theo dedup_key)
 * - Thẻ sắp hết hạn: Chỉ In-app
 */
async function runDueDateRemindersSweep({
    source = 'cron',
    deduplicateToday = true,
    includeAllOverdue = false,
    cardExpiryWindowDays = 7,
} = {}) {
    const todayStr = toLocalDateString(new Date());
    const inTwoDaysStr = addDaysToDateString(todayStr, 2);
    const cardTargetStr = addDaysToDateString(todayStr, cardExpiryWindowDays);

    const stats = {
        todayStr,
        inTwoDaysStr,
        dueSoonCount: 0,
        dueTodayCount: 0,
        overdueMatchedCount: 0,
        expiringCardsCount: 0,
        inAppCount: 0,
        emailCount: 0,
        realEmailCount: 0,
        simulatedEmailCount: 0,
        failedEmailCount: 0,
    };

    // 1. Nhắc sách sắp đến hạn trong 2 ngày (Mốc Email duy nhất T - 2 ngày, gộp theo độc giả)
    const [dueSoon] = await db.execute(
        `SELECT br.id as borrow_record_id, br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                u.full_name, u.email, u.card_number
         FROM borrow_records br
         JOIN book_copies bc ON br.book_copy_id = bc.id
         JOIN books b ON bc.book_id = b.id
         JOIN users u ON br.user_id = u.id
         WHERE br.status = 'borrowing' AND DATE(br.due_date) = ?
         ORDER BY br.user_id ASC, br.id ASC`,
        [inTwoDaysStr]
    );
    stats.dueSoonCount = dueSoon.length;

    for (const item of dueSoon) {
        const dueDateLabel = formatLocalDateVN(item.due_date);
        await insertInAppNotification({
            userId: item.user_id,
            title: 'Nhắc nhở trả sách sắp đến hạn (còn 2 ngày)',
            message: `Cuốn sách "${item.title}" của bạn sẽ đến hạn trả vào ngày ${dueDateLabel}. Vui lòng sắp xếp hoàn trả hoặc gia hạn trực tuyến.`,
            type: 'reminder',
            messageKeyword: item.title,
            deduplicateToday,
            stats,
        });
    }

    const dueSoonByUser = groupRowsByUser(dueSoon);
    for (const group of dueSoonByUser) {
        const recordIds = group.items
            .map((it) => it.borrow_record_id || it.copy_qr || it.title)
            .sort()
            .join(',');
        const dedupKey = `due_t2:${group.userId}:${inTwoDaysStr}:${recordIds}`.slice(0, 191);

        await sendTrackedReminderEmail({
            sendFn: emailService.sendDueReminderEmail,
            payload: {
                to: group.email,
                userId: group.userId,
                fullName: group.fullName,
                cardNumber: group.cardNumber,
                dueDate: group.items[0].due_date,
                daysLeft: 2,
                books: group.items.map((it) => ({
                    bookTitle: it.title,
                    copyQr: it.copy_qr,
                    dueDate: it.due_date,
                })),
            },
            dedupKey,
            deduplicateToday,
            stats,
        });
    }

    // 2. Hạn chót trả sách hôm nay (T - 0 ngày) -> CHỈ In-app (không gửi email lần 2)
    const [dueToday] = await db.execute(
        `SELECT br.id as borrow_record_id, br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                u.full_name, u.email, u.card_number
         FROM borrow_records br
         JOIN book_copies bc ON br.book_copy_id = bc.id
         JOIN books b ON bc.book_id = b.id
         JOIN users u ON br.user_id = u.id
         WHERE br.status = 'borrowing' AND DATE(br.due_date) = ?`,
        [todayStr]
    );
    stats.dueTodayCount = dueToday.length;

    for (const item of dueToday) {
        await insertInAppNotification({
            userId: item.user_id,
            title: '⚠️ HẠN CHÓT: Sách đến hạn trả hôm nay',
            message: `Hôm nay là ngày cuối cùng hoàn trả cuốn "${item.title}". Bạn có thể trả tại quầy hoặc thả vào Hòm trả sách tự động 24/7 để tránh phát sinh quá hạn và tạm ngưng quyền mượn.`,
            type: 'warning',
            messageKeyword: item.title,
            deduplicateToday,
            stats,
        });
    }

    // 3. Cảnh báo quá hạn: Email chỉ gửi vào ngày đầu quá hạn (overdueDays === 1), gộp theo độc giả
    const [overdue] = await db.execute(
        `SELECT br.id as borrow_record_id, br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                u.full_name, u.email, u.card_number
         FROM borrow_records br
         JOIN book_copies bc ON br.book_copy_id = bc.id
         JOIN books b ON bc.book_id = b.id
         JOIN users u ON br.user_id = u.id
         WHERE br.status = 'borrowing' AND DATE(br.due_date) < ?
         ORDER BY br.user_id ASC, br.id ASC`,
        [todayStr]
    );

    const overdueForEmail = [];
    for (const item of overdue) {
        const { overdueDays } = calculateOverdue(item.due_date);
        if (overdueDays <= 0) continue;

        const isDay1Overdue = overdueDays === 1;
        const isInAppMilestone = isDay1Overdue || overdueDays % 3 === 1;
        if (!includeAllOverdue && !isInAppMilestone) continue;

        stats.overdueMatchedCount += 1;

        await insertInAppNotification({
            userId: item.user_id,
            title: `🔴 Quá hạn ${overdueDays} ngày & Tạm khóa mượn mới: «${item.title}»`,
            message: `Cuốn sách "${item.title}" [${item.copy_qr}] đã quá hạn trả ${overdueDays} ngày. Hệ thống đã tạm khóa quyền mượn sách mới của thẻ. Vui lòng hoàn trả sách tại Quầy hoặc Hòm 24/7 để mở khóa thẻ ngay!`,
            type: 'warning',
            messageKeyword: item.title,
            deduplicateToday,
            stats,
        });

        if (isDay1Overdue || includeAllOverdue) {
            overdueForEmail.push({ ...item, overdueDays });
        }
    }

    const overdueByUser = groupRowsByUser(overdueForEmail);
    for (const group of overdueByUser) {
        const recordIds = group.items
            .map((it) => it.borrow_record_id || it.copy_qr || it.title)
            .sort()
            .join(',');
        const dedupKey = `overdue_d1:${group.userId}:${todayStr}:${recordIds}`.slice(0, 191);

        await sendTrackedReminderEmail({
            sendFn: emailService.sendOverdueWarningEmail,
            payload: {
                to: group.email,
                userId: group.userId,
                fullName: group.fullName,
                cardNumber: group.cardNumber,
                dueDate: group.items[0].due_date,
                overdueDays: Math.max(...group.items.map((it) => it.overdueDays)),
                books: group.items.map((it) => ({
                    bookTitle: it.title,
                    copyQr: it.copy_qr,
                    dueDate: it.due_date,
                    overdueDays: it.overdueDays,
                })),
            },
            dedupKey,
            deduplicateToday,
            stats,
        });
    }

    // 4. Cảnh báo thẻ thư viện sắp hết hạn -> Chỉ In-app
    const cardQuery = source === 'manual'
        ? `SELECT id, full_name, email, card_number, card_expiry
           FROM users
           WHERE role = 'reader' AND status = 'active' AND DATE(card_expiry) BETWEEN ? AND ?`
        : `SELECT id, full_name, email, card_number, card_expiry
           FROM users
           WHERE role = 'reader' AND status = 'active' AND DATE(card_expiry) = ?`;
    const cardParams = source === 'manual' ? [todayStr, cardTargetStr] : [cardTargetStr];
    const [expiringUsers] = await db.execute(cardQuery, cardParams);
    stats.expiringCardsCount = expiringUsers.length;

    for (const u of expiringUsers) {
        await insertInAppNotification({
            userId: u.id,
            title: 'Thẻ thư viện sắp hết hạn',
            message: `Thẻ thư viện ${u.card_number} của bạn sẽ hết hạn vào ngày ${formatLocalDateVN(u.card_expiry)}. Vui lòng liên hệ quầy thủ thư để gia hạn thẻ.`,
            type: 'reminder',
            deduplicateToday,
            stats,
        });
    }

    return stats;
}

module.exports = {
    runDueDateRemindersSweep,
};

