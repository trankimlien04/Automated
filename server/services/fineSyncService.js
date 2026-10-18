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
    // Chỉ tính quá hạn khi ngày hôm nay thực sự sau ngày đến hạn (diffDays > 0)
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const overdueDays = Math.max(0, diffDays);
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

        // BƯỚC 1: TỰ ĐỘNG DỌN DẸP / QUYẾT TOÁN CÁC BẢN GHI PHẠT LỖI
        // 1.1. Sách đã trả đúng hạn hoặc trước hạn nhưng có fine 'unpaid' -> Xóa bỏ phạt oan
        await db.execute(`
            DELETE f FROM fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            WHERE br.status = 'returned' AND DATE(br.return_date) <= DATE(br.due_date) AND f.status = 'unpaid'
        `);

        // 1.2. Sách đã trả vào kho (status = 'returned') nhưng vẫn còn fine 'unpaid' -> Đồng bộ thành 'paid' (vì đã hoàn tất nhận trả tại quầy)
        await db.execute(`
            UPDATE fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            SET f.status = 'paid', f.paid_at = IFNULL(f.paid_at, br.return_date), f.payment_method = IFNULL(f.payment_method, 'cash'), f.payment_channel = IFNULL(f.payment_channel, 'counter')
            WHERE br.status = 'returned' AND f.status = 'unpaid'
        `);

        // 1.3. Sách đang mượn nhưng chưa quá hạn (DATE(due_date) >= CURDATE()) nhưng có fine 'unpaid' -> Xóa bỏ
        await db.execute(`
            DELETE f FROM fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            WHERE br.status = 'borrowing' AND DATE(br.due_date) >= CURDATE() AND f.status = 'unpaid'
        `);

        // BƯỚC 2: TÌM CÁC SÁCH ĐANG MƯỢN THỰC SỰ ĐÃ QUÁ HẠN (Hạn < Ngày hôm nay)
        let query = `
            SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.status = 'borrowing' AND DATE(br.due_date) < CURDATE()
        `;
        const params = [];
        if (userId) {
            query += ' AND br.user_id = ?';
            params.push(userId);
        }

        const [overdueRecords] = await db.execute(query, params);

        for (const record of overdueRecords) {
            const { overdueDays, fineAmount, dueDateFormatted } = calculateOverdue(record.due_date, finePerDay);
            
            // Nếu không thực sự quá hạn, bỏ qua
            if (overdueDays <= 0) {
                await db.execute('DELETE FROM fines WHERE borrow_record_id = ? AND status = "unpaid"', [record.id]);
                continue;
            }

            const fineReason = `Trả trễ hạn ${overdueDays} ngày (Hạn: ${dueDateFormatted})`;

            // Check if fine already exists for this borrow record
            const [existingFine] = await db.execute('SELECT id, status, amount, reason FROM fines WHERE borrow_record_id = ?', [record.id]);

            if (existingFine.length > 0) {
                // If unpaid, sync amount and reason if not matching current exact overdue calculation
                if (existingFine[0].status === 'unpaid') {
                    if (Number(existingFine[0].amount) !== fineAmount || existingFine[0].reason !== fineReason) {
                        await db.execute('UPDATE fines SET amount = ?, reason = ? WHERE id = ?', [
                            fineAmount,
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
                    fineAmount,
                    fineReason
                ]);
            }
        }
    } catch (err) {
        console.error('Error syncing overdue fines:', err);
    }
}

module.exports = { syncOverdueFines, calculateOverdue };
