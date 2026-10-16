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
        console.log('📢 [CRON JOB] Running morning reminders...');
        try {
            const today = new Date();
            const inTwoDays = new Date();
            inTwoDays.setDate(today.getDate() + 2);
            const inTwoDaysStr = inTwoDays.toISOString().slice(0, 10);

            // Remind readers whose books are due in 2 days
            const [dueSoon] = await db.execute(`
                SELECT br.user_id, b.title, br.due_date
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.status = 'borrowing' AND br.due_date = ?
            `, [inTwoDaysStr]);

            for (const item of dueSoon) {
                await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")', [
                    item.user_id,
                    'Nhắc nhở trả sách sắp đến hạn',
                    `Cuốn sách "${item.title}" của bạn sẽ đến hạn trả vào ngày ${new Date(item.due_date).toLocaleDateString('vi-VN')}. Vui lòng mang sách trả đúng hạn.`
                ]);
            }

            // Remind readers whose library card is expiring in 7 days
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

            console.log(`✅ [CRON JOB] Sent ${dueSoon.length} book reminders and ${expiringCards.length} card expiry reminders.`);
        } catch (error) {
            console.error('❌ [CRON ERROR] Error in morning reminders:', error);
        }
    });
}

module.exports = initCronJobs;
