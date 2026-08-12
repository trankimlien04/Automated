const db = require('../config/db');

exports.getReviewsByBook = async (req, res) => {
    try {
        const [reviews] = await db.execute(`
            SELECT r.*, u.full_name as user_name, u.avatar_url 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.book_id = ?
            ORDER BY r.created_at DESC
        `, [req.params.bookId]);
        res.status(200).json(reviews);
    } catch (error) {
        console.error('Lỗi khi lấy đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.addReview = async (req, res) => {
    const { user_id, book_id, rating, comment } = req.body;
    try {
        if (!user_id || !book_id || !rating) {
            return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
        }
        
        // Check if user already reviewed this book
        const [existing] = await db.execute('SELECT id FROM reviews WHERE user_id = ? AND book_id = ?', [user_id, book_id]);
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã đánh giá sách này rồi' });
        }

        const [result] = await db.execute(
            'INSERT INTO reviews (user_id, book_id, rating, comment) VALUES (?, ?, ?, ?)',
            [user_id, book_id, rating, comment || null]
        );

        // Update avg_rating in books table
        const [avgResult] = await db.execute('SELECT AVG(rating) as avg FROM reviews WHERE book_id = ?', [book_id]);
        const newAvg = avgResult[0].avg || 0;
        await db.execute('UPDATE books SET avg_rating = ? WHERE id = ?', [newAvg, book_id]);

        res.status(201).json({ message: 'Thêm đánh giá thành công', reviewId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteReview = async (req, res) => {
    try {
        // Get book_id before deleting to update avg_rating
        const [review] = await db.execute('SELECT book_id FROM reviews WHERE id = ?', [req.params.id]);
        if (review.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đánh giá' });
        }
        const book_id = review[0].book_id;

        await db.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);

        // Update avg_rating in books table
        const [avgResult] = await db.execute('SELECT AVG(rating) as avg FROM reviews WHERE book_id = ?', [book_id]);
        const newAvg = avgResult[0].avg || 0;
        await db.execute('UPDATE books SET avg_rating = ? WHERE id = ?', [newAvg, book_id]);

        res.status(200).json({ message: 'Xóa đánh giá thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
