const db = require('../config/db');

exports.createReservation = async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.id;

    try {
        if (!bookId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã đầu sách đặt trước' });
        }

        // Check user active
        const [users] = await db.execute('SELECT status FROM users WHERE id = ?', [userId]);
        if (users.length === 0 || users[0].status !== 'active') {
            return res.status(403).json({ message: 'Tài khoản của bạn hiện không thể thực hiện đặt trước' });
        }

        // Check book exists
        const [books] = await db.execute('SELECT title, available_copies FROM books WHERE id = ?', [bookId]);
        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đầu sách này' });
        }
        const book = books[0];

        // Check if there is already an active reservation for this book by this user
        const [existing] = await db.execute(
            'SELECT id FROM reservations WHERE user_id = ? AND book_id = ? AND status IN ("pending", "ready")',
            [userId, bookId]
        );
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã đặt trước đầu sách này rồi' });
        }

        // Determine initial status: if available_copies > 0, set to ready immediately
        const initialStatus = book.available_copies > 0 ? 'ready' : 'pending';

        await db.execute(
            'INSERT INTO reservations (user_id, book_id, status) VALUES (?, ?, ?)',
            [userId, bookId, initialStatus]
        );

        res.status(201).json({
            message: initialStatus === 'ready' 
                ? 'Sách đang có sẵn, yêu cầu đặt trước của bạn đã sẵn sàng lấy!' 
                : 'Đặt trước sách thành công! Hệ thống sẽ thông báo khi sách có sẵn.',
            status: initialStatus
        });
    } catch (error) {
        console.error('Lỗi khi tạo đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getReservations = async (req, res) => {
    const { role, id } = req.user;

    try {
        let query = `
            SELECT r.id, r.reservation_date, r.status,
                   u.full_name as reader_name, u.card_number,
                   b.title as book_title, b.id as book_id
            FROM reservations r
            JOIN users u ON r.user_id = u.id
            JOIN books b ON r.book_id = b.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE r.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY r.reservation_date DESC';

        const [results] = await db.execute(query, params);
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.cancelReservation = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { role } = req.user;

    try {
        // Find reservation
        const [reservations] = await db.execute('SELECT * FROM reservations WHERE id = ?', [id]);
        if (reservations.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu đặt trước' });
        }
        const resv = reservations[0];

        // Readers can only cancel their own reservations
        if (role === 'reader' && resv.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền hủy phiếu đặt trước này' });
        }

        await db.execute('UPDATE reservations SET status = "cancelled" WHERE id = ?', [id]);
        res.status(200).json({ message: 'Đã hủy phiếu đặt trước thành công' });
    } catch (error) {
        console.error('Lỗi khi hủy đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.completeReservation = async (req, res) => {
    const { id } = req.params;

    try {
        await db.execute('UPDATE reservations SET status = "completed" WHERE id = ?', [id]);
        res.status(200).json({ message: 'Đã hoàn thành phiếu đặt trước' });
    } catch (error) {
        console.error('Lỗi khi hoàn thành đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
