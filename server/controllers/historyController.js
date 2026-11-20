const db = require('../config/db');

exports.getUserHistory = async (req, res) => {
    try {
        const requestedUserId = parseInt(req.params.userId, 10);
        if (!requestedUserId) {
            return res.status(400).json({ message: 'Mã người dùng không hợp lệ' });
        }

        const isPrivileged = ['admin', 'librarian', 'owner'].includes(req.user.role);
        if (!isPrivileged && requestedUserId !== req.user.id) {
            return res.status(403).json({ message: 'Bạn không có quyền xem lịch sử đọc của người khác' });
        }

        const [history] = await db.execute(`
            SELECT h.*, b.title as book_title, b.cover_image 
            FROM read_history h
            JOIN books b ON h.book_id = b.id
            WHERE h.user_id = ?
            ORDER BY h.read_date DESC
        `, [requestedUserId]);
        res.status(200).json(history);
    } catch (error) {
        console.error('Lỗi khi lấy lịch sử đọc:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.addHistory = async (req, res) => {
    const { user_id, book_id, borrow_record_id } = req.body;
    const isOperationalStaff = ['admin', 'librarian'].includes(req.user.role);
    const targetUserId = isOperationalStaff && user_id ? parseInt(user_id, 10) : req.user.id;

    try {
        if (!targetUserId || !book_id) {
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
        }
        
        const [result] = await db.execute(
            'INSERT INTO read_history (user_id, book_id, borrow_record_id) VALUES (?, ?, ?)',
            [targetUserId, book_id, borrow_record_id || null]
        );

        res.status(201).json({ message: 'Ghi nhận lịch sử thành công', historyId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm lịch sử:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteHistory = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, user_id FROM read_history WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lịch sử đọc' });
        }

        const record = rows[0];
        if (req.user.role !== 'admin' && Number(record.user_id) !== Number(req.user.id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa bản ghi lịch sử đọc này' });
        }

        await db.execute('DELETE FROM read_history WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa lịch sử thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa lịch sử:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
