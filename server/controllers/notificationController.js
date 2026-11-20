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
    const { runDueDateRemindersSweep } = require('../services/dueReminderService');

    try {
        const [stats, smtpStatus] = await Promise.all([
            runDueDateRemindersSweep({
                source: 'manual',
                deduplicateToday: false,
                includeAllOverdue: true,
                cardExpiryWindowDays: 15,
            }),
            emailService.getSmtpStatus(),
        ]);

        // Thông báo cho toàn bộ ban quản lý
        const { notifyAllStaff } = require('../services/notificationService');
        const emailBreakdown = smtpStatus.configured
            ? `${stats.realEmailCount} email gửi thật thành công${stats.failedEmailCount > 0 ? `, ${stats.failedEmailCount} thất bại` : ''}`
            : `${stats.simulatedEmailCount} lượt ghi nhận mô phỏng (chưa bật SMTP thực tế)`;

        await notifyAllStaff(
            'Báo cáo tự động: Quét cảnh báo nhắc hạn đa kênh',
            `Quá trình quét hoàn tất: Đã phát hành ${stats.inAppCount} thông báo In-app và ${emailBreakdown}.`,
            stats.failedEmailCount > 0 ? 'warning' : 'info'
        );

        let message = `Đã hoàn tất quét: ${stats.inAppCount} thông báo in-app`;
        if (stats.emailCount === 0) {
            message += ' (không có độc giả nào sắp đến hạn/quá hạn cần gửi email hôm nay).';
        } else if (smtpStatus.configured) {
            message += `, gửi thực tế ${stats.realEmailCount}/${stats.emailCount} email${stats.failedEmailCount > 0 ? ` (${stats.failedEmailCount} lỗi gửi SMTP)` : ''}!`;
        } else {
            message += ` và ghi nhận ${stats.simulatedEmailCount} lượt ở chế độ Mô phỏng (chưa cấu hình SMTP thực tế).`;
        }

        res.status(200).json({
            message,
            count: stats.inAppCount + stats.emailCount,
            inAppCount: stats.inAppCount,
            emailCount: stats.emailCount,
            realEmailCount: stats.realEmailCount,
            simulatedEmailCount: stats.simulatedEmailCount,
            failedEmailCount: stats.failedEmailCount,
            smtpMode: smtpStatus.mode,
            stats,
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

// Gửi email cảnh báo theo kịch bản mẫu (gửi thật qua SMTP nếu đã cấu hình)
exports.testSendEmail = async (req, res) => {
    const { targetEmail, templateType = 'due_reminder_t2' } = req.body;
    const recipient = String(targetEmail || req.user.email || '').trim();
    const emailService = require('../services/emailService');
    const { isValidEmail } = require('../utils/validators');

    if (!isValidEmail(recipient)) {
        return res.status(400).json({ message: 'Địa chỉ email người nhận không hợp lệ' });
    }

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
        } else if (templateType === 'account_suspended') {
            const suspendedUntil = new Date(Date.now() + 5 * 86400000);
            result = await emailService.sendSuspensionNoticeEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                suspendedUntil,
                suspendedDaysAdded: 5,
                overdueDays: 5,
                bookTitle: sampleBook,
            });
        } else if (templateType === 'reservation_ready') {
            result = await emailService.sendReservationReadyEmail({
                to: recipient,
                userId: req.user.id,
                fullName: req.user.full_name,
                cardNumber: req.user.card_number || 'LIB-RD-000001',
                bookTitle: sampleBook,
                location: 'Phòng 01 - Kệ 01 - Ngăn 02',
                ticketCode: 'TICKET-RES-SAMPLE',
                expiresAt: new Date(Date.now() + 48 * 3600000),
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

        if (!result?.success) {
            return res.status(502).json({
                message: result?.error || result?.message || 'Gửi email SMTP thất bại',
                simulated: false,
                details: result
            });
        }

        if (result.mode === 'simulated') {
            return res.status(200).json({
                message: `Chưa cấu hình SMTP thực tế — email tới ${recipient} mới được ghi nhận ở chế độ Mô phỏng. Vui lòng thiết lập SMTP ở tab "Cấu hình SMTP" hoặc file .env để gửi email thật.`,
                simulated: true,
                details: result
            });
        }

        res.status(200).json({
            message: `Đã gửi email thực tế thành công tới ${recipient}!`,
            simulated: false,
            details: result
        });
    } catch (error) {
        console.error('Lỗi khi gửi email:', error);
        res.status(500).json({ message: 'Lỗi server khi gửi email' });
    }
};

// Lấy trạng thái cấu hình SMTP hiện tại (không trả về mật khẩu) + thông tin Cron 08:00 tự động
exports.getSmtpStatus = async (req, res) => {
    const emailService = require('../services/emailService');
    const cronJobs = require('../services/cronJobs');
    try {
        const [status, cron] = await Promise.all([
            emailService.getSmtpStatus(),
            typeof cronJobs.getCronRuntimeInfo === 'function' ? cronJobs.getCronRuntimeInfo() : Promise.resolve(null),
        ]);
        res.status(200).json({ ...status, cron });
    } catch (error) {
        console.error('Lỗi khi kiểm tra trạng thái SMTP:', error);
        res.status(500).json({ message: 'Lỗi server khi kiểm tra trạng thái SMTP' });
    }
};

// Kiểm tra kết nối SMTP thực tế
exports.verifySmtpConnection = async (req, res) => {
    const emailService = require('../services/emailService');
    try {
        const check = await emailService.verifySmtpConnection();
        if (!check.ok) {
            return res.status(400).json({
                ok: false,
                message: check.error || 'Không thể kết nối tới máy chủ SMTP',
                ...check,
            });
        }
        res.status(200).json({
            ok: true,
            message: `Kết nối SMTP (${check.host}:${check.port}) hoạt động bình thường!`,
            ...check,
        });
    } catch (error) {
        console.error('Lỗi khi xác thực SMTP:', error);
        res.status(500).json({ ok: false, message: 'Lỗi server khi kiểm tra kết nối SMTP' });
    }
};

// Lưu cấu hình SMTP thực tế (Admin / Chủ thư viện) - verify trước khi lưu
exports.updateSmtpConfig = async (req, res) => {
    const emailService = require('../services/emailService');
    try {
        const result = await emailService.saveSmtpConfig({
            host: req.body?.host,
            port: req.body?.port,
            secure: req.body?.secure,
            user: req.body?.user,
            pass: req.body?.pass,
            fromAddress: req.body?.fromAddress,
            updatedBy: req.user.id,
        });

        if (!result.success) {
            return res.status(result.status || 400).json({ message: result.message });
        }

        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, "UPDATE_SMTP_CONFIG", "email_settings", NULL, ?)',
            [req.user.id, `Cập nhật và xác thực cấu hình SMTP thực tế (${result.smtpStatus?.host}:${result.smtpStatus?.port})`]
        ).catch(() => {});

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi khi lưu cấu hình SMTP:', error);
        res.status(500).json({ message: 'Lỗi server khi lưu cấu hình SMTP' });
    }
};

// Xóa cấu hình SMTP lưu trong DB (quay về biến môi trường .env)
exports.resetSmtpConfig = async (req, res) => {
    const emailService = require('../services/emailService');
    try {
        const smtpStatus = await emailService.clearSmtpConfig();
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, "RESET_SMTP_CONFIG", "email_settings", NULL, ?)',
            [req.user.id, 'Gỡ cấu hình SMTP trong DB, quay về biến môi trường .env']
        ).catch(() => {});

        res.status(200).json({
            message: smtpStatus.configured
                ? 'Đã gỡ cấu hình SMTP trong DB — hệ thống đang dùng cấu hình từ file .env.'
                : 'Đã gỡ cấu hình SMTP trong DB — hệ thống chuyển về chế độ Mô phỏng cho đến khi cấu hình lại.',
            smtpStatus,
        });
    } catch (error) {
        console.error('Lỗi khi gỡ cấu hình SMTP:', error);
        res.status(500).json({ message: 'Lỗi server khi gỡ cấu hình SMTP' });
    }
};

// Lấy tùy chọn nhận email biên lai giao dịch tại quầy & ma trận kênh thông báo
exports.getNotificationPreferences = async (req, res) => {
    try {
        const {
            getUserNotificationPreferences,
            NOTIFICATION_POLICIES,
        } = require('../services/notificationService');
        const prefs = await getUserNotificationPreferences(req.user.id);
        res.status(200).json({
            emailReceipts: prefs.emailReceipts,
            policies: NOTIFICATION_POLICIES,
        });
    } catch (error) {
        console.error('Lỗi khi lấy tùy chọn thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy tùy chọn thông báo' });
    }
};

// Cập nhật tùy chọn nhận Email biên lai mượn / trả tại quầy (Nhóm 2 - Tùy chọn)
exports.updateNotificationPreferences = async (req, res) => {
    try {
        const { updateUserNotificationPreferences } = require('../services/notificationService');
        const emailReceipts = Boolean(req.body?.emailReceipts);
        const updated = await updateUserNotificationPreferences(req.user.id, { emailReceipts });
        res.status(200).json({
            message: updated.emailReceipts
                ? 'Đã bật nhận biên lai Mượn / Trả tại quầy qua Email.'
                : 'Đã tắt nhận biên lai Mượn / Trả tại quầy qua Email (vẫn luôn lưu đầy đủ trên In-app).',
            emailReceipts: updated.emailReceipts,
        });
    } catch (error) {
        console.error('Lỗi khi cập nhật tùy chọn thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật tùy chọn thông báo' });
    }
};

