const db = require('../config/db');
const { syncOverdueFines } = require('../services/fineSyncService');

/**
 * Hệ thống Nhắc Hạn Thông Minh Đa Cấp Độ (Smart Proactive Due-Date Reminder)
 * Tự động chạy ngầm và phân loại 3 mức độ khẩn cấp:
 * - Cấp 1 (Trước hạn 1–3 ngày): Nhắc nhẹ + hỗ trợ nút "Gia hạn nhanh 1-Chạm (+7 ngày)" nếu chưa có người đặt trước.
 * - Cấp 2 (Đúng ngày đến hạn - 0 ngày): Cảnh báo màu cam nhắc trả tại Quầy hoặc thả qua Hòm 24/7.
 * - Cấp 3 (Quá hạn < 0 ngày): Cảnh báo đỏ và tạm khóa mượn mới.
 */
async function syncSmartDueReminders(targetUserId = null, forceInsert = false) {
    let inAppCount = 0;
    try {
        await syncOverdueFines(targetUserId);

        let sql = `
            SELECT br.id as borrow_record_id, br.user_id, br.due_date, IFNULL(br.renewal_count, 0) as renewal_count,
                   DATEDIFF(DATE(br.due_date), CURDATE()) as days_diff,
                   bc.qr_code as copy_qr, b.id as book_id, b.title,
                   u.full_name, u.email, u.card_number,
                   (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending', 'ready') AND r.user_id != br.user_id) as waiting_reservations
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.status = 'borrowing' AND DATEDIFF(DATE(br.due_date), CURDATE()) <= 3
        `;
        const params = [];
        if (targetUserId) {
            sql += ' AND br.user_id = ?';
            params.push(targetUserId);
        }

        const [rows] = await db.execute(sql, params);

        for (const item of rows) {
            const daysDiff = Number(item.days_diff);
            const renewalCount = Number(item.renewal_count || 0);
            const waitingRes = Number(item.waiting_reservations || 0);
            const canQuickRenew = daysDiff >= 0 && renewalCount === 0 && waitingRes === 0;
            const dueDateFormatted = new Date(item.due_date).toLocaleDateString('vi-VN');

            let notifTitle = '';
            let notifMessage = '';
            let notifType = 'reminder';
            let levelPrefix = '';

            if (daysDiff >= 1 && daysDiff <= 3) {
                // CẤP 1: TRƯỚC HẠN 1-2 NGÀY (NHẮC NHẸ + GIA HẠN NHANH 1-CHẠM)
                levelPrefix = '🔔 Nhắc hạn sớm';
                notifTitle = `🔔 Nhắc hạn sớm (trước ${daysDiff} ngày): «${item.title}»`;
                notifType = 'reminder';
                if (canQuickRenew) {
                    notifMessage = `Cuốn sách "${item.title}" [${item.copy_qr}] sẽ đến hạn trả vào ngày ${dueDateFormatted}. Sách hiện chưa có người đặt trước — bạn có thể bấm nút "Gia hạn nhanh 1-Chạm (+7 ngày)" ngay trong thông báo này!`;
                } else if (renewalCount >= 1) {
                    notifMessage = `Cuốn sách "${item.title}" [${item.copy_qr}] sẽ đến hạn trả vào ngày ${dueDateFormatted} (Đã sử dụng 1/1 lượt gia hạn). Vui lòng sắp xếp hoàn trả tại Quầy hoặc Hòm 24/7.`;
                } else {
                    notifMessage = `Cuốn sách "${item.title}" [${item.copy_qr}] sẽ đến hạn trả vào ngày ${dueDateFormatted}. Hiện đang có độc giả khác đặt trước cuốn sách này nên không thể gia hạn thêm, vui lòng hoàn trả đúng hạn.`;
                }
            } else if (daysDiff === 0) {
                // CẤP 2: ĐÚNG NGÀY ĐẾN HẠN (CẢNH BÁO CAM)
                levelPrefix = '🟠 Hôm nay đến hạn trả';
                notifTitle = `🟠 Hôm nay đến hạn trả: «${item.title}»`;
                notifType = 'warning';
                notifMessage = `Hôm nay (${dueDateFormatted}) là ngày đến hạn trả cuốn "${item.title}" [${item.copy_qr}]. Vui lòng mang sách trả tại Quầy Thủ Thư hoặc thả qua Hòm Trả Sách 24/7.`;
            } else if (daysDiff < 0) {
                // CẤP 3: QUÁ HẠN (CẢNH BÁO ĐỎ & TẠM KHÓA MƯỢN MỚI)
                const overdueDays = Math.abs(daysDiff);
                levelPrefix = '🔴 Quá hạn';
                notifTitle = `🔴 Quá hạn ${overdueDays} ngày & Tạm khóa mượn mới: «${item.title}»`;
                notifType = 'warning';
                notifMessage = `Cuốn sách "${item.title}" [${item.copy_qr}] đã quá hạn ${overdueDays} ngày (Hạn trả: ${dueDateFormatted}). Hệ thống đã tạm khóa quyền mượn sách mới của thẻ. Vui lòng hoàn trả sách tại Quầy hoặc Hòm 24/7 để mở khóa thẻ ngay!`;
            }

            if (!notifTitle) continue;

            // Kiểm tra xem trong ngày hôm nay đã tạo thông báo cấp độ này cho cuốn sách này chưa
            if (!forceInsert) {
                const [existing] = await db.execute(
                    `SELECT id FROM notifications 
                     WHERE user_id = ? 
                       AND (title = ? OR (title LIKE ? AND message LIKE ?))
                       AND DATE(created_at) = CURDATE()
                     LIMIT 1`,
                    [item.user_id, notifTitle, `${levelPrefix}%`, `%${item.title}%`]
                );
                if (existing.length > 0) {
                    continue;
                }
            }

            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [item.user_id, notifTitle, notifMessage, notifType]
            );
            inAppCount++;
        }
    } catch (err) {
        console.error('Lỗi khi chạy ngầm syncSmartDueReminders:', err);
    }
    return inAppCount;
}

// Lấy danh sách thông báo của người dùng hiện tại (kèm dữ liệu Nhắc Hạn Thông Minh Đa Cấp Độ)
exports.getNotifications = async (req, res) => {
    const userId = req.user.id;

    try {
        // Tự động chạy ngầm kiểm tra & phát sinh thông báo nhắc hạn đa cấp độ
        await syncSmartDueReminders(userId, false);

        const [results] = await db.execute(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
            [userId]
        );

        // Lấy danh sách sách đang mượn của người dùng để gắn metadata nút "Gia hạn nhanh 1-Chạm (+7 ngày)"
        const [activeBorrows] = await db.execute(`
            SELECT br.id as borrow_record_id, br.user_id, br.due_date, IFNULL(br.renewal_count, 0) as renewal_count,
                   DATEDIFF(DATE(br.due_date), CURDATE()) as days_diff,
                   bc.qr_code as copy_qr, b.id as book_id, b.title as book_title,
                   (SELECT COUNT(*) FROM reservations r WHERE r.book_id = b.id AND r.status IN ('pending', 'ready') AND r.user_id != br.user_id) as waiting_reservations
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.user_id = ? AND br.status = 'borrowing'
        `, [userId]);

        const enriched = results.map((noti) => {
            const lowerTitle = (noti.title || '').toLowerCase();
            const lowerMsg = (noti.message || '').toLowerCase();
            const fullText = `${lowerTitle} ${lowerMsg}`;

            // Tìm bản ghi mượn đang hoạt động khớp với thông báo này
            const matchedBorrow = activeBorrows.find((ab) => {
                const qr = (ab.copy_qr || '').toLowerCase();
                const bTitle = (ab.book_title || '').toLowerCase();
                return (qr && fullText.includes(qr)) || (bTitle && fullText.includes(bTitle));
            });

            // Phân loại cấp độ nhắc hạn thông minh
            let smartLevel = null;
            if (
                lowerTitle.includes('nhắc hạn sớm') ||
                lowerTitle.includes('sắp đến hạn') ||
                (lowerTitle.includes('nhắc nhở') && fullText.includes('hạn trả'))
            ) {
                smartLevel = 'upcoming_2d';
            } else if (
                lowerTitle.includes('hôm nay đến hạn') ||
                lowerTitle.includes('đến hạn trả hôm nay') ||
                lowerTitle.includes('hạn chót')
            ) {
                smartLevel = 'due_today';
            } else if (
                lowerTitle.includes('quá hạn') ||
                (lowerTitle.includes('cảnh báo') && fullText.includes('quá hạn'))
            ) {
                smartLevel = 'overdue';
            }

            if (!smartLevel && !matchedBorrow) {
                return noti;
            }

            if (matchedBorrow) {
                const daysDiff = Number(matchedBorrow.days_diff);
                const renewalCount = Number(matchedBorrow.renewal_count || 0);
                const waitingRes = Number(matchedBorrow.waiting_reservations || 0);
                const canQuickRenew = daysDiff >= 0 && renewalCount === 0 && waitingRes === 0;

                // Nếu cuốn sách đã được gia hạn thành công (daysDiff > 3), cập nhật smartLevel theo thực tế
                const effectiveLevel =
                    daysDiff < 0
                        ? 'overdue'
                        : daysDiff === 0
                        ? 'due_today'
                        : daysDiff <= 3
                        ? 'upcoming_2d'
                        : smartLevel;

                return {
                    ...noti,
                    smart_reminder: effectiveLevel
                        ? {
                              level: effectiveLevel,
                              borrow_record_id: matchedBorrow.borrow_record_id,
                              book_id: matchedBorrow.book_id,
                              book_title: matchedBorrow.book_title,
                              copy_qr: matchedBorrow.copy_qr,
                              due_date: matchedBorrow.due_date,
                              days_diff: daysDiff,
                              renewal_count: renewalCount,
                              waiting_reservations: waitingRes,
                              can_quick_renew: canQuickRenew
                          }
                        : null
                };
            }

            return {
                ...noti,
                smart_reminder: smartLevel
                    ? {
                          level: smartLevel,
                          borrow_record_id: null,
                          book_id: null,
                          book_title: null,
                          copy_qr: null,
                          due_date: null,
                          days_diff: smartLevel === 'overdue' ? -1 : smartLevel === 'due_today' ? 0 : 2,
                          renewal_count: 0,
                          waiting_reservations: 0,
                          can_quick_renew: false
                      }
                    : null
            };
        });

        res.status(200).json(enriched);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách thông báo' });
    }
};

// Lấy số lượng thông báo chưa đọc
exports.getUnreadCount = async (req, res) => {
    const userId = req.user.id;

    try {
        await syncSmartDueReminders(userId, false);
        const [results] = await db.execute(
            'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );
        res.status(200).json({ unreadCount: results[0]?.unreadCount || 0 });
    } catch (error) {
        console.error('Lỗi khi lấy số lượng thông báo chưa đọc:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Đánh dấu 1 thông báo là đã đọc
exports.markAsRead = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const [notifications] = await db.execute('SELECT * FROM notifications WHERE id = ?', [id]);
        if (notifications.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông báo' });
        }

        if (notifications[0].user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa thông báo này' });
        }

        await db.execute('UPDATE notifications SET is_read = TRUE WHERE id = ?', [id]);
        res.status(200).json({ message: 'Đã đánh dấu là đã đọc' });
    } catch (error) {
        console.error('Lỗi khi cập nhật thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Đánh dấu tất cả là đã đọc
exports.markAllRead = async (req, res) => {
    const userId = req.user.id;

    try {
        await db.execute('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [userId]);
        res.status(200).json({ message: 'Đã đánh dấu đọc tất cả thông báo' });
    } catch (error) {
        console.error('Lỗi khi cập nhật tất cả thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa 1 thông báo
exports.deleteNotification = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const [notifications] = await db.execute('SELECT * FROM notifications WHERE id = ?', [id]);
        if (notifications.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông báo' });
        }

        if (notifications[0].user_id !== userId && !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa thông báo này' });
        }

        await db.execute('DELETE FROM notifications WHERE id = ?', [id]);
        res.status(200).json({ message: 'Đã xóa thông báo thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa tất cả thông báo đã đọc
exports.clearReadNotifications = async (req, res) => {
    const userId = req.user.id;

    try {
        await db.execute('DELETE FROM notifications WHERE user_id = ? AND is_read = TRUE', [userId]);
        res.status(200).json({ message: 'Đã dọn dẹp các thông báo đã đọc' });
    } catch (error) {
        console.error('Lỗi khi dọn dẹp thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Đánh dấu đã đọc hàng loạt (theo danh sách id)
exports.batchMarkRead = async (req, res) => {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Danh sách ID không hợp lệ' });
    }

    try {
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(
            `UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND id IN (${placeholders})`,
            [userId, ...ids]
        );
        res.status(200).json({ message: `Đã đánh dấu đã đọc ${ids.length} thông báo` });
    } catch (error) {
        console.error('Lỗi khi cập nhật nhiều thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa thông báo hàng loạt (theo danh sách id)
exports.batchDelete = async (req, res) => {
    const userId = req.user.id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Danh sách ID không hợp lệ' });
    }

    try {
        const placeholders = ids.map(() => '?').join(',');
        await db.execute(
            `DELETE FROM notifications WHERE user_id = ? AND id IN (${placeholders})`,
            [userId, ...ids]
        );
        res.status(200).json({ message: `Đã xóa ${ids.length} thông báo thành công` });
    } catch (error) {
        console.error('Lỗi khi xóa nhiều thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Xóa tất cả thông báo của người dùng
exports.deleteAllNotifications = async (req, res) => {
    const userId = req.user.id;

    try {
        await db.execute('DELETE FROM notifications WHERE user_id = ?', [userId]);
        res.status(200).json({ message: 'Đã xóa tất cả thông báo thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa tất cả thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Gửi thông báo hệ thống / Phát loa (Broadcast hoặc gửi cá nhân)
exports.broadcastNotification = async (req, res) => {
    const { title, message, type = 'info', audience = 'all', targetUserId } = req.body;
    const senderRole = req.user.role;
    const senderId = req.user.id;

    if (!['admin', 'librarian', 'owner'].includes(senderRole)) {
        return res.status(403).json({ message: 'Bạn không có quyền phát thông báo hệ thống' });
    }

    if (!title || !message) {
        return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ tiêu đề và nội dung thông báo' });
    }

    try {
        let recipientIds = [];

        if (targetUserId) {
            recipientIds = [parseInt(targetUserId, 10)];
        } else if (audience === 'readers') {
            const [users] = await db.execute('SELECT id FROM users WHERE role = "reader" AND status = "active"');
            recipientIds = users.map(u => u.id);
        } else if (audience === 'librarians') {
            const [users] = await db.execute('SELECT id FROM users WHERE role IN ("librarian", "admin") AND status = "active"');
            recipientIds = users.map(u => u.id);
        } else {
            // all active users
            const [users] = await db.execute('SELECT id FROM users WHERE status = "active"');
            recipientIds = users.map(u => u.id);
        }

        if (recipientIds.length === 0) {
            return res.status(400).json({ message: 'Không tìm thấy người nhận phù hợp' });
        }

        for (const uid of recipientIds) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [uid, title, message, type]
            );
        }

        // Ghi activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, "SEND_NOTIFICATION", "notifications", NULL, ?)',
            [senderId, `Gửi thông báo: "${title}" tới ${recipientIds.length} người dùng (${audience})`]
        );

        res.status(200).json({
            message: `Đã gửi thông báo thành công tới ${recipientIds.length} người nhận!`,
            sentCount: recipientIds.length
        });
    } catch (error) {
        console.error('Lỗi khi phát thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi phát thông báo' });
    }
};

// Kích hoạt quét nghiệp vụ & gửi thông báo nhắc hạn / quá hạn đa kênh (In-app + Email)
exports.triggerManualReminders = async (req, res) => {
    const emailService = require('../services/emailService');

    try {
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        let inAppCount = 0;
        let emailCount = 0;

        // 1. Nhắc sách sắp đến hạn trong 2 ngày (T - 2 ngày)
        const inTwoDays = new Date();
        inTwoDays.setDate(today.getDate() + 2);
        const inTwoDaysStr = inTwoDays.toISOString().slice(0, 10);

        const [dueSoon] = await db.execute(`
            SELECT br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                   u.full_name, u.email, u.card_number
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.status = 'borrowing' AND br.due_date = ?
        `, [inTwoDaysStr]);

        for (const item of dueSoon) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                [
                    item.user_id,
                    'Nhắc nhở trả sách sắp đến hạn (còn 2 ngày)',
                    `Cuốn sách "${item.title}" của bạn sẽ đến hạn trả vào ngày ${new Date(item.due_date).toLocaleDateString('vi-VN')}. Vui lòng sắp xếp hoàn trả hoặc gia hạn trực tuyến.`
                ]
            );
            inAppCount++;

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
                emailCount++;
            }
        }

        // 2. Hạn chót trả sách hôm nay (T - 0 ngày)
        const [dueToday] = await db.execute(`
            SELECT br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                   u.full_name, u.email, u.card_number
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.status = 'borrowing' AND br.due_date = ?
        `, [todayStr]);

        for (const item of dueToday) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    item.user_id,
                    '⚠️ HẠN CHÓT: Sách đến hạn trả hôm nay',
                    `Hôm nay là ngày cuối cùng hoàn trả cuốn "${item.title}". Bạn có thể trả tại quầy hoặc thả vào Hòm trả sách tự động 24/7 để tránh bị phạt.`
                ]
            );
            inAppCount++;

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
                emailCount++;
            }
        }

        // 3. Cảnh báo sách quá hạn & tạm khóa mượn mới (T + 1 hoặc lâu hơn)
        const [overdue] = await db.execute(`
            SELECT br.user_id, br.due_date, bc.qr_code as copy_qr, b.title,
                   u.full_name, u.email, u.card_number
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.status = 'borrowing' AND br.due_date < ?
        `, [todayStr]);

        for (const item of overdue) {
            const dueDate = new Date(item.due_date);
            const diffTime = Math.abs(today - dueDate);
            const overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    item.user_id,
                    `🔴 Quá hạn ${overdueDays} ngày & Tạm khóa mượn mới: «${item.title}»`,
                    `Cuốn sách "${item.title}" [${item.copy_qr}] đã quá hạn trả ${overdueDays} ngày. Hệ thống đã tạm khóa quyền mượn sách mới của thẻ. Vui lòng hoàn trả sách tại Quầy hoặc Hòm 24/7 để mở khóa thẻ ngay!`
                ]
            );
            inAppCount++;

            if (item.email) {
                await emailService.sendOverdueWarningEmail({
                    to: item.email,
                    userId: item.user_id,
                    fullName: item.full_name,
                    cardNumber: item.card_number,
                    bookTitle: item.title,
                    copyQr: item.copy_qr,
                    dueDate: item.due_date,
                    overdueDays
                });
                emailCount++;
            }
        }

        // 4. Cảnh báo thẻ độc giả sắp hết hạn (trong 15 ngày)
        const in15Days = new Date();
        in15Days.setDate(today.getDate() + 15);
        const in15DaysStr = in15Days.toISOString().slice(0, 10);

        const [expiringUsers] = await db.execute(`
            SELECT id, full_name, email, card_number, card_expiry
            FROM users
            WHERE role = 'reader' AND status = 'active' AND card_expiry BETWEEN ? AND ?
        `, [todayStr, in15DaysStr]);

        for (const u of expiringUsers) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                [
                    u.id,
                    'Thẻ thư viện sắp hết hạn',
                    `Thẻ thư viện ${u.card_number} của bạn sẽ hết hạn vào ngày ${new Date(u.card_expiry).toLocaleDateString('vi-VN')}. Vui lòng liên hệ quầy thủ thư để gia hạn thẻ.`
                ]
            );
            inAppCount++;
        }

        // Thông báo cho toàn bộ ban quản lý
        const { notifyAllStaff } = require('../services/notificationService');
        await notifyAllStaff(
            'Báo cáo tự động: Quét cảnh báo nhắc hạn đa kênh',
            `Quá trình quét tự động hoàn tất: Đã phát hành ${inAppCount} thông báo hệ thống và ${emailCount} lượt email nhắc hạn/quá hạn chủ động.`,
            'info'
        );

        res.status(200).json({
            message: `Đã hoàn tất quét và phát hành ${inAppCount} thông báo in-app và ${emailCount} email nhắc hạn chủ động!`,
            count: inAppCount + emailCount,
            inAppCount,
            emailCount
        });
    } catch (error) {
        console.error('Lỗi khi quét thông báo nghiệp vụ đa kênh:', error);
        res.status(500).json({ message: 'Lỗi server khi quét thông báo đa kênh' });
    }
};

// Lấy lịch sử phát hành thông báo đa kênh (Email / In-app Dispatch Logs)
exports.getDispatchHistory = async (req, res) => {
    try {
        const isStaff = ['admin', 'librarian', 'owner'].includes(req.user.role);
        let sql = `
            SELECT nd.*, u.full_name as user_name, u.card_number
            FROM notification_dispatches nd
            LEFT JOIN users u ON nd.user_id = u.id
        `;
        const params = [];

        if (!isStaff) {
            sql += ` WHERE nd.user_id = ? OR nd.recipient_email = ?`;
            params.push(req.user.id, req.user.email);
        }

        sql += ` ORDER BY nd.created_at DESC LIMIT 100`;

        const [rows] = await db.execute(sql, params);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Lỗi khi lấy lịch sử dispatch thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử dispatch thông báo' });
    }
};

// Gửi thử nghiệm một email cảnh báo mẫu
exports.testSendEmail = async (req, res) => {
    const { targetEmail, templateType = 'due_reminder_t2' } = req.body;
    const recipient = targetEmail || req.user.email;
    const emailService = require('../services/emailService');

    try {
        let result;
        const sampleBook = 'Lập trình Web Hiện Đại với React & Node.js';
        const sampleQr = 'QR-BK-001-A';
        const sampleDate = new Date();
        sampleDate.setDate(sampleDate.getDate() + 2);

        if (templateType === 'due_today_t0') {
            result = await emailService.sendDueTodayEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                bookTitle: sampleBook,
                copyQr: sampleQr,
                dueDate: new Date()
            });
        } else if (templateType === 'overdue_warning') {
            result = await emailService.sendOverdueWarningEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                bookTitle: sampleBook,
                copyQr: sampleQr,
                dueDate: new Date(Date.now() - 3 * 86400000),
                overdueDays: 3
            });
        } else if (templateType === 'drop_box_receipt') {
            result = await emailService.sendDropBoxReceiptEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                bookTitle: sampleBook,
                copyQr: sampleQr,
                droppedAt: new Date()
            });
        } else {
            result = await emailService.sendDueReminderEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                bookTitle: sampleBook,
                copyQr: sampleQr,
                dueDate: sampleDate,
                daysLeft: 2
            });
        }

        res.status(200).json({
            message: `Đã phát hành email thử nghiệm thành công tới ${recipient}!`,
            details: result
        });
    } catch (error) {
        console.error('Lỗi khi gửi email thử nghiệm:', error);
        res.status(500).json({ message: 'Lỗi server khi gửi email thử nghiệm' });
    }
};

