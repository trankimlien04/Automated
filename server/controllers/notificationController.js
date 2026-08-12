const db = require('../config/db');

exports.getNotifications = async (req, res) => {
    const userId = req.user.id;

    try {
        const [results] = await db.execute(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [userId]
        );
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thông báo:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

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
