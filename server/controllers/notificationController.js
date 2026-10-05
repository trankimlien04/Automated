const db = require('../config/db');

// Lấy danh sách thông báo của người dùng hiện tại
exports.getNotifications = async (req, res) => {
    const userId = req.user.id;

    try {
        const [results] = await db.execute(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
            [userId]
        );
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thông báo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách thông báo' });
    }
};

// Lấy số lượng thông báo chưa đọc
exports.getUnreadCount = async (req, res) => {
    const userId = req.user.id;

    try {
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

// Kích hoạt quét nghiệp vụ & gửi thông báo nhắc hạn / quá hạn / thẻ hết hạn tức thì
exports.triggerManualReminders = async (req, res) => {
    try {
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        let count = 0;

        // 1. Nhắc sách sắp đến hạn trong 2 ngày
        const inTwoDays = new Date();
        inTwoDays.setDate(today.getDate() + 2);
        const inTwoDaysStr = inTwoDays.toISOString().slice(0, 10);

        const [dueSoon] = await db.execute(`
            SELECT br.user_id, b.title, br.due_date
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.status = 'borrowing' AND br.due_date = ?
        `, [inTwoDaysStr]);

        for (const item of dueSoon) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                [
                    item.user_id,
                    'Nhắc nhở trả sách sắp đến hạn',
                    `Cuốn sách "${item.title}" của bạn sẽ đến hạn trả vào ngày ${new Date(item.due_date).toLocaleDateString('vi-VN')}. Vui lòng sắp xếp hoàn trả đúng hạn.`
                ]
            );
            count++;
        }

        // 2. Cảnh báo sách quá hạn
        const [overdue] = await db.execute(`
            SELECT br.user_id, b.title, br.due_date
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
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
                    'Cảnh báo: Sách mượn đã quá hạn',
                    `Cuốn sách "${item.title}" đã quá hạn trả ${overdueDays} ngày (Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}). Vui lòng hoàn trả sách ngay và thanh toán phí phạt trễ hạn.`
                ]
            );
            count++;
        }

        // 3. Cảnh báo thẻ độc giả sắp hết hạn (trong 15 ngày)
        const in15Days = new Date();
        in15Days.setDate(today.getDate() + 15);
        const in15DaysStr = in15Days.toISOString().slice(0, 10);

        const [expiringUsers] = await db.execute(`
            SELECT id, full_name, card_number, card_expiry
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
            count++;
        }

        // Also notify all staff
        const { notifyAllStaff } = require('../services/notificationService');
        await notifyAllStaff(
            'Báo cáo quét nghiệp vụ hệ thống',
            `Quá trình quét nghiệp vụ đã hoàn tất: Đã kiểm tra và gửi ${count} thông báo nhắc hạn / quá hạn / hết hạn thẻ tới các độc giả liên quan.`,
            'info'
        );

        res.status(200).json({
            message: `Đã hoàn tất quét và gửi ${count} thông báo nghiệp vụ hệ thống!`,
            count
        });
    } catch (error) {
        console.error('Lỗi khi quét thông báo nghiệp vụ:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
