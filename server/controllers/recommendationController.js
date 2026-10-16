const db = require('../config/db');

exports.getRecommendations = async (req, res) => {
    const userId = req.user.id;

    try {
        // 1. Get user's borrowing history and find the most borrowed categories
        const [borrowedCategories] = await db.execute(`
            SELECT b.category_id, COUNT(*) as borrow_count
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.user_id = ?
            GROUP BY b.category_id
            ORDER BY borrow_count DESC
            LIMIT 2
        `, [userId]);

        let recommendedBooks = [];

        if (borrowedCategories.length > 0) {
            // Find books in these categories that the user hasn't borrowed yet
            const categoryIds = borrowedCategories.map(c => c.category_id);
            const placeholders = categoryIds.map(() => '?').join(',');
            
            const [books] = await db.execute(`
                SELECT b.*, c.name as category_name, a.name as author_name
                FROM books b
                LEFT JOIN categories c ON b.category_id = c.id
                LEFT JOIN authors a ON b.author_id = a.id
                WHERE b.category_id IN (${placeholders})
                AND b.id NOT IN (
                    SELECT DISTINCT bc.book_id
                    FROM borrow_records br
                    JOIN book_copies bc ON br.book_copy_id = bc.id
                    WHERE br.user_id = ?
                )
                ORDER BY b.available_copies DESC
                LIMIT 6
            `, [...categoryIds, userId]);

            recommendedBooks = books;
        }

        // If not enough recommended books, pad with recently added books or popular books
        if (recommendedBooks.length < 4) {
            const excludedIds = recommendedBooks.map(b => b.id);
            let query = `
                SELECT b.*, c.name as category_name, a.name as author_name
                FROM books b
                LEFT JOIN categories c ON b.category_id = c.id
                LEFT JOIN authors a ON b.author_id = a.id
            `;
            const params = [];

            if (excludedIds.length > 0) {
                const placeholders = excludedIds.map(() => '?').join(',');
                query += ` WHERE b.id NOT IN (${placeholders})`;
                params.push(...excludedIds);
            }

            query += ' ORDER BY b.created_at DESC LIMIT ?';
            params.push(6 - recommendedBooks.length);

            // Use db.query instead of db.execute for dynamic queries with LIMIT parameters
            const [fallbackBooks] = await db.query(query, params);
            recommendedBooks = [...recommendedBooks, ...fallbackBooks];
        }

        res.status(200).json(recommendedBooks);
    } catch (error) {
        console.error('Lỗi khi gợi ý sách AI:', error);
        res.status(500).json({ message: 'Lỗi server khi sinh gợi ý sách' });
    }
};
