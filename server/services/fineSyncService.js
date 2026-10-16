const db = require('../config/db');

/**
 * Standard calculation for calendar overdue days and fine amount.
 * Normalizes both today and dueDate to midnight (00:00:00) to ensure
 * consistency across all components regardless of the hour of the day.
 */
function calculateOverdue(dueDateInput, finePerDay = 5000) {
    const due = new Date(dueDateInput);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - due.getTime();
    const overdueDays = Math.max(0, Math.round(diffTime / (1000 * 60 * 60 * 24)));
    const fineAmount = overdueDays * finePerDay;

    return {
        overdueDays,
        fineAmount,
        dueDateFormatted: new Date(dueDateInput).toLocaleDateString('vi-VN')
    };
}

/**
 * Synchronize overdue borrow records with the `fines` table in real-time.
 * Can be called on-demand before querying fines or checkout info.
 * Ensures readers and librarians always see real-time unpaid fines with exact overdue days.
 */
async function syncOverdueFines(userId = null) {
    try {
        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');

        let query = `
            SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.status = 'borrowing' AND br.due_date < NOW()
        `;
        const params = [];
        if (userId) {
            query += ' AND br.user_id = ?';
            params.push(userId);
        }

        const [overdueRecords] = await db.execute(query, params);

        for (const record of overdueRecords) {
            const { overdueDays, fineAmount, dueDateFormatted } = calculateOverdue(record.due_date, finePerDay);
            
            // Only create/update fine if actually overdue by at least 1 day
            const effectiveDays = Math.max(1, overdueDays);
            const effectiveAmount = effectiveDays * finePerDay;
            const fineReason = `Trả trễ hạn ${effectiveDays} ngày (Hạn: ${dueDateFormatted})`;

            // Check if fine already exists for this borrow record
            const [existingFine] = await db.execute('SELECT id, status, amount, reason FROM fines WHERE borrow_record_id = ?', [record.id]);

            if (existingFine.length > 0) {
                // If unpaid, sync amount and reason if not matching current exact overdue calculation
                if (existingFine[0].status === 'unpaid') {
                    if (Number(existingFine[0].amount) !== effectiveAmount || existingFine[0].reason !== fineReason) {
                        await db.execute('UPDATE fines SET amount = ?, reason = ? WHERE id = ?', [
                            effectiveAmount,
                            fineReason,
                            existingFine[0].id
                        ]);
                    }
                }
            } else {
                // Insert new unpaid fine record
                await db.execute('INSERT INTO fines (borrow_record_id, user_id, amount, reason, status) VALUES (?, ?, ?, ?, "unpaid")', [
                    record.id,
                    record.u_id,
                    effectiveAmount,
                    fineReason
                ]);
            }
        }
    } catch (err) {
        console.error('Error syncing overdue fines:', err);
    }
}

module.exports = { syncOverdueFines, calculateOverdue };
