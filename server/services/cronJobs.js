const cron = require('node-cron');
const db = require('../config/db');

function initCronJobs() {
    console.log('⏰ Initializing automated cron jobs...');

    // Run every day at 00:00 AM to calculate fines and lock severely overdue accounts
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 [CRON JOB] Running daily midnight maintenance (Fines & Account locking)...');
        try {
            const todayStr = new Date().toISOString().slice(0, 10);
            
            // 1. Get fine rate per day from config
            const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
            const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');

            // 2. Find all unreturned records that are past due_date
            const [overdueRecords] = await db.execute(`
                SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.status = 'borrowing' AND br.due_date < ?
            `, [todayStr]);

            for (const record of overdueRecords) {
                const dueDate = new Date(record.due_date);
                const today = new Date();
                const diffTime = Math.abs(today - dueDate);
                const overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // Update or Insert Fine
                const fineAmount = overdueDays * finePerDay;
                const [existingFine] = await db.execute('SELECT id FROM fines WHERE borrow_record_id = ?', [record.id]);
                
                if (existingFine.length > 0) {
                    await db.execute('UPDATE fines SET amount = ?, reason = ? WHERE id = ?', [
                        fineAmount,
                        `Trả trễ hạn ${overdueDays} ngày (Hạn: ${dueDate.toLocaleDateString('vi-VN')})`,
                        existingFine[0].id
                    ]);
                } else {
                    await db.execute('INSERT INTO fines (borrow_record_id, user_id, amount, reason, status) VALUES (?, ?, ?, ?, "unpaid")', [
                        record.id,
                        record.u_id,
                        fineAmount,
                        `Trả trễ hạn ${overdueDays} ngày`
                    ]);
                }

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
                }
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

            console.log(`✅ [CRON JOB] Sent ${dueSoon.length} reminder notifications.`);
        } catch (error) {
            console.error('❌ [CRON ERROR] Error in morning reminders:', error);
        }
    });
}

module.exports = initCronJobs;
