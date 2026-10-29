const cron = require('node-cron');
const db = require('../config/db');
const { syncOverdueFines, calculateOverdue } = require('./fineSyncService');

function initCronJobs() {
    console.log('⏰ Initializing automated cron jobs...');

    // Immediately run overdue fine sync on startup
    syncOverdueFines().catch(err => console.error('Initial fine sync error:', err));

    // Run every day at 00:00 AM to calculate fines and lock severely overdue accounts
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 [CRON JOB] Running daily midnight maintenance (Fines & Account locking)...');
        try {
            // 1. Sync all overdue fines using standard normalized calendar calculation
            await syncOverdueFines();

            // 2. Find all unreturned records that are past due_date to check for auto-lock
            const [overdueRecords] = await db.execute(`
                SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.status = 'borrowing' AND br.due_date < NOW()
            `);

            for (const record of overdueRecords) {
                const { overdueDays } = calculateOverdue(record.due_date);

                // Auto lock account if overdue by 7 days or more (UC24)
                if (overdueDays >= 7 && record.user_status !== 'locked') {
                    await db.execute('UPDATE users SET status = "locked" WHERE id = ?', [record.u_id]);
                    await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")', [
                        record.u_id,
                        'Tài khoản đã bị khóa tự động',
                        `Tài khoản của bạn đã bị khóa do mượn sách "${record.title}" quá hạn ${overdueDays} ngày. Vui lòng liên hệ thủ thư.`
                    ]);
                    await db.execute('INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (NULL, "AUTO_LOCK", "users", ?, ?)', [
                        record.u_id,
                        `Tự động khóa tài khoản độc giả ${record.full_name} do trễ hạn ${overdueDays} ngày`
                    ]);

                    // Also notify all staff
                    const { notifyAllStaff } = require('./notificationService');
                    await notifyAllStaff(
                        'Độc giả bị khóa tài khoản do quá hạn',
                        `Tài khoản của độc giả ${record.full_name} đã bị khóa tự động do mượn sách "${record.title}" quá hạn ${overdueDays} ngày.`,
                        'warning'
                    );
                }
            }

            if (overdueRecords.length > 0) {
                const { notifyAllStaff } = require('./notificationService');
                await notifyAllStaff(
                    'Báo cáo tự động: Sách mượn quá hạn',
                    `Hệ thống phát hiện ${overdueRecords.length} lượt mượn quá hạn cần theo dõi thu hồi và xử lý phạt.`,
                    'warning'
                );
            }

            console.log(`✅ [CRON JOB] Processed ${overdueRecords.length} overdue borrow records.`);
        } catch (error) {
            console.error('❌ [CRON ERROR] Error in midnight maintenance:', error);
        }
    });

    // Run every day at 8:00 AM to send reminders (UC21)
    cron.schedule('0 8 * * *', async () => {
        console.log('📢 [CRON JOB] Running morning multi-channel reminders (In-app + Email)...');
        try {
            const emailService = require('./emailService');
            const today = new Date();
            const todayStr = today.toISOString().slice(0, 10);
            const inTwoDays = new Date();
            inTwoDays.setDate(today.getDate() + 2);
            const inTwoDaysStr = inTwoDays.toISOString().slice(0, 10);

            // 1. Remind readers whose books are due in 2 days (T - 2)
            const [dueSoon] = await db.execute(`
                SELECT br.user_id, b.title, br.due_date, bc.qr_code as copy_qr,
                       u.full_name, u.email, u.card_number
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                JOIN users u ON br.user_id = u.id
                WHERE br.status = 'borrowing' AND br.due_date = ?
            `, [inTwoDaysStr]);

            for (const item of dueSoon) {
                await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")', [
                    item.user_id,
                    'Nhắc nhở trả sách sắp đến hạn (còn 2 ngày)',
                    `Cuốn sách "${item.title}" của bạn sẽ đến hạn trả vào ngày ${new Date(item.due_date).toLocaleDateString('vi-VN')}. Vui lòng sắp xếp hoàn trả hoặc gia hạn.`
                ]);
                if (item.email) {
                    await emailService.sendDueReminderEmail({
                        to: item.email,
                        userId: item.user_id,
                        fullName: item.full_name,
                        cardNumber: item.card_number,
                        bookTitle: item.title,
                        copyQr: item.copy_qr,
                        dueDate: item.due_date,
                        daysLeft: 2
                    });
                }
            }

            // 2. Remind readers whose books are due TODAY (T - 0)
            const [dueToday] = await db.execute(`
                SELECT br.user_id, b.title, br.due_date, bc.qr_code as copy_qr,
                       u.full_name, u.email, u.card_number
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                JOIN users u ON br.user_id = u.id
                WHERE br.status = 'borrowing' AND br.due_date = ?
            `, [todayStr]);

            for (const item of dueToday) {
                await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")', [
                    item.user_id,
                    '⚠️ HẠN CHÓT: Sách đến hạn trả hôm nay',
                    `Hôm nay là hạn chót trả sách "${item.title}". Bạn có thể trả tại quầy hoặc thả vào Hòm trả sách 24/7.`
                ]);
                if (item.email) {
                    await emailService.sendDueTodayEmail({
                        to: item.email,
                        userId: item.user_id,
                        fullName: item.full_name,
                        cardNumber: item.card_number,
                        bookTitle: item.title,
                        copyQr: item.copy_qr,
                        dueDate: item.due_date
                    });
                }
            }

            // 3. Remind readers whose library card is expiring in 7 days
            const inSevenDays = new Date();
            inSevenDays.setDate(today.getDate() + 7);
            const inSevenDaysStr = inSevenDays.toISOString().slice(0, 10);

            const [expiringCards] = await db.execute(`
                SELECT id, full_name, card_number, card_expiry
                FROM users
                WHERE role = 'reader' AND status = 'active' AND card_expiry = ?
            `, [inSevenDaysStr]);

            for (const u of expiringCards) {
                await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")', [
                    u.id,
                    'Thẻ thư viện sắp hết hạn',
                    `Thẻ thư viện mã ${u.card_number} của bạn sẽ hết hạn vào ngày ${new Date(u.card_expiry).toLocaleDateString('vi-VN')}. Vui lòng liên hệ quầy thủ thư để gia hạn thẻ.`
                ]);
            }

            console.log(`✅ [CRON JOB] Sent ${dueSoon.length} T-2 reminders, ${dueToday.length} T-0 deadline notices and ${expiringCards.length} card expiry reminders.`);
        } catch (error) {
            console.error('❌ [CRON ERROR] Error in morning reminders:', error);
        }
    });

    // Run every 15 minutes to release expired online borrow requests (24h hold) and reservations (48h hold)
    cron.schedule('*/15 * * * *', async () => {
        try {
            // 1. Release expired borrow requests (24h hold)
            const [expiredBorrows] = await db.execute(`
                SELECT brq.id, brq.user_id, brq.book_id, b.title as book_title
                FROM borrow_requests brq
                JOIN books b ON brq.book_id = b.id
                WHERE brq.status = 'pending' AND brq.expires_at IS NOT NULL AND brq.expires_at < NOW()
            `);
            for (const item of expiredBorrows) {
                await db.execute('UPDATE borrow_requests SET status = "expired" WHERE id = ?', [item.id]);
                await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [item.book_id]);
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                    [
                        item.user_id,
                        'Hết hạn giữ chỗ mượn sách online',
                        `Thời hạn giữ chỗ 24 giờ cho cuốn sách "${item.book_title}" đã hết. Bản sao sách đã được đưa trở lại kho thư viện cho các bạn đọc khác.`
                    ]
                );
            }

            // 2. Release expired reservations (48h hold with no response)
            const [expiredResvs] = await db.execute(`
                SELECT r.id, r.user_id, r.book_id, b.title as book_title
                FROM reservations r
                JOIN books b ON r.book_id = b.id
                WHERE r.status = 'notified' AND r.expires_at IS NOT NULL AND r.expires_at < NOW()
            `);
            for (const resv of expiredResvs) {
                const [nextWaiters] = await db.execute(
                    'SELECT r.id, r.user_id, u.full_name FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                    [resv.book_id]
                );
                await db.execute('UPDATE reservations SET status = "expired" WHERE id = ?', [resv.id]);

                if (nextWaiters.length > 0) {
                    const nextUser = nextWaiters[0];
                    await db.execute(
                        'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                        [nextUser.id]
                    );
                    await db.execute(
                        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                        [
                            nextUser.user_id,
                            '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                            `Cuốn sách "${resv.book_title}" bạn đặt trước đã có sẵn tại thư viện. Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Hãy vào mục "Đặt trước sách" để xác nhận mượn nhé!`
                        ]
                    );
                } else {
                    await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [resv.book_id]);
                }
            }

            // 3. Release expired borrow drafts (24h hold)
            const [expiredDrafts] = await db.execute(`
                SELECT d.id, d.user_id, d.draft_code
                FROM borrow_drafts d
                WHERE d.status = 'pending' AND d.expires_at < NOW()
            `);
            for (const draft of expiredDrafts) {
                await db.execute('UPDATE borrow_drafts SET status = "expired" WHERE id = ?', [draft.id]);
                const [items] = await db.execute('SELECT book_id FROM borrow_draft_items WHERE draft_id = ? AND status = "pending"', [draft.id]);
                await db.execute('UPDATE borrow_draft_items SET status = "unavailable" WHERE draft_id = ? AND status = "pending"', [draft.id]);
                for (const it of items) {
                    await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [it.book_id]);
                }
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                    [
                        draft.user_id,
                        'Phiếu mượn online đã hết hạn 24h',
                        `Thời hạn 24 giờ cho phiếu mượn online ${draft.draft_code} đã hết. Các cuốn sách đã được đưa trở lại kho cho các bạn đọc khác.`
                    ]
                );
            }
        } catch (e) {
            console.error('Lỗi khi quét dọn yêu cầu và đặt trước hết hạn:', e);
        }
    });
}

module.exports = initCronJobs;
