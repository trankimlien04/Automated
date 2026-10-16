const db = require('../config/db');

exports.getUserHistory = async (req, res) => {
    try {
        const [history] = await db.execute(`
            SELECT h.*, b.title as book_title, b.cover_image 
            FROM read_history h
            JOIN books b ON h.book_id = b.id
            WHERE h.user_id = ?
            ORDER BY h.read_date DESC
        `, [req.params.userId]);
        res.status(200).json(history);
    } catch (error) {
        console.error('Lỗi khi lấy lịch sử đọc:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.addHistory = async (req, res) => {
    const { user_id, book_id, borrow_record_id } = req.body;
    try {
        if (!user_id || !book_id) {
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
        }
        
        const [result] = await db.execute(
            'INSERT INTO read_history (user_id, book_id, borrow_record_id) VALUES (?, ?, ?)',
            [user_id, book_id, borrow_record_id || null]
        );

        res.status(201).json({ message: 'Ghi nhận lịch sử thành công', historyId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm lịch sử:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteHistory = async (req, res) => {
    try {
        await db.execute('DELETE FROM read_history WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa lịch sử thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa lịch sử:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
