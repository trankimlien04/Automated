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

        const [avgResult] = await db.execute(
            'SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE book_id = ?', 
            [req.params.bookId]
        );
        const avg = avgResult[0]?.avg ? parseFloat(avgResult[0].avg).toFixed(1) : 0;
        const total = avgResult[0]?.count || 0;

        res.status(200).json({
            reviews,
            avg_rating: avg,
            total_reviews: total
        });
    } catch (error) {
        console.error('Lỗi khi lấy đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy đánh giá' });
    }
};

exports.addReview = async (req, res) => {
    const userId = req.user?.id || req.body.user_id;
    const { book_id, rating, comment } = req.body;

    try {
        if (!userId || !book_id || !rating) {
            return res.status(400).json({ message: 'Vui lòng cung cấp số sao đánh giá hợp lệ' });
        }

        const ratingNum = Math.min(5, Math.max(1, parseInt(rating)));

        // Kiểm tra xem độc giả đã từng đánh giá sách này chưa -> nếu có thì cập nhật, nếu chưa thì thêm mới
        const [existing] = await db.execute(
            'SELECT id FROM reviews WHERE user_id = ? AND book_id = ?', 
            [userId, book_id]
        );

        let isUpdate = false;
        if (existing.length > 0) {
            isUpdate = true;
            await db.execute(
                'UPDATE reviews SET rating = ?, comment = ?, created_at = NOW() WHERE id = ?',
                [ratingNum, comment ? comment.trim() : null, existing[0].id]
            );
        } else {
            await db.execute(
                'INSERT INTO reviews (user_id, book_id, rating, comment) VALUES (?, ?, ?, ?)',
                [userId, book_id, ratingNum, comment ? comment.trim() : null]
            );
        }

        // Tự động tính lại điểm trung bình avg_rating của sách
        const [avgResult] = await db.execute(
            'SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE book_id = ?', 
            [book_id]
        );
        const newAvg = avgResult[0]?.avg ? parseFloat(avgResult[0].avg).toFixed(2) : 0;
        await db.execute('UPDATE books SET avg_rating = ? WHERE id = ?', [newAvg, book_id]);

        res.status(200).json({ 
            message: isUpdate ? 'Cập nhật đánh giá sách thành công!' : 'Đã gửi đánh giá sao thành công!',
            avg_rating: parseFloat(newAvg).toFixed(1),
            total_reviews: avgResult[0]?.count || 1
        });
    } catch (error) {
        console.error('Lỗi khi thêm/cập nhật đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server khi xử lý đánh giá' });
    }
};

exports.deleteReview = async (req, res) => {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    try {
        const [review] = await db.execute('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
        if (review.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đánh giá' });
        }

        // Chỉ tác giả bài đánh giá hoặc thủ thư/admin mới có quyền xóa
        if (userId && review[0].user_id !== userId && !['admin', 'librarian'].includes(userRole)) {
            return res.status(403).json({ message: 'Bạn không có quyền xóa đánh giá này' });
        }

        const book_id = review[0].book_id;
        await db.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);

        // Tính lại điểm trung bình
        const [avgResult] = await db.execute('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE book_id = ?', [book_id]);
        const newAvg = avgResult[0]?.avg ? parseFloat(avgResult[0].avg).toFixed(2) : 0;
        await db.execute('UPDATE books SET avg_rating = ? WHERE id = ?', [newAvg, book_id]);

        res.status(200).json({ 
            message: 'Đã xóa đánh giá thành công',
            avg_rating: parseFloat(newAvg).toFixed(1),
            total_reviews: avgResult[0]?.count || 0
        });
    } catch (error) {
        console.error('Lỗi khi xóa đánh giá:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
