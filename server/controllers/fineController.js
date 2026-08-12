const db = require('../config/db');

exports.getFines = async (req, res) => {
    const { role, id } = req.user;

    try {
        let query = `
            SELECT f.id, f.amount, f.reason, f.status, f.paid_at as payment_date, f.created_at,
                   u.full_name as reader_name, u.card_number,
                   b.title as book_title
            FROM fines f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE f.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY f.created_at DESC';

        const [results] = await db.execute(query, params);
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phí phạt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.payFine = async (req, res) => {
    const { id } = req.params;
    const processedBy = req.user.id;

    try {
        const [fines] = await db.execute('SELECT * FROM fines WHERE id = ?', [id]);
        if (fines.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy hóa đơn phí phạt' });
        }
        const fine = fines[0];

        if (fine.status === 'paid') {
            return res.status(400).json({ message: 'Khoản phí phạt này đã được thanh toán từ trước' });
        }

        await db.execute(
            'UPDATE fines SET status = "paid", paid_at = NOW() WHERE id = ?',
            [id]
        );

        // Save activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [processedBy, 'PAY_FINE', 'fines', id, `Thanh toán phí phạt: ${fine.amount}đ cho hóa đơn #${id}`]
        );

        res.status(200).json({ message: 'Đã xác nhận thanh toán phí phạt thành công' });
    } catch (error) {
        console.error('Lỗi khi thanh toán phí phạt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
