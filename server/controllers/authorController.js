const db = require('../config/db');

exports.getAllAuthors = async (req, res) => {
    try {
        const { search, page, limit } = req.query;
        let query = `
            SELECT a.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.author_id = a.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM authors a
        `;
        const params = [];

        if (search && search.trim() !== '') {
            query += ' WHERE a.name LIKE ? OR a.bio LIKE ?';
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        query += ' ORDER BY a.id DESC';

        if (page && limit) {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.max(1, parseInt(limit) || 10);
            const offset = (pageNum - 1) * limitNum;

            let countQuery = 'SELECT COUNT(*) as total FROM authors a';
            const countParams = [];
            if (search && search.trim() !== '') {
                countQuery += ' WHERE a.name LIKE ? OR a.bio LIKE ?';
                const term = `%${search.trim()}%`;
                countParams.push(term, term);
            }
            const [countRes] = await db.execute(countQuery, countParams);
            const total = countRes[0]?.total || 0;

            query += ` LIMIT ${limitNum} OFFSET ${offset}`;

            const [authors] = await db.execute(query, params);
            return res.status(200).json({
                data: authors,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1
            });
        }

        const [authors] = await db.execute(query, params);
        res.status(200).json(authors);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getAuthorById = async (req, res) => {
    try {
        const [authors] = await db.execute(`
            SELECT a.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.author_id = a.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM authors a 
            WHERE a.id = ?
        `, [req.params.id]);
        if (authors.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tác giả' });
        }
        res.status(200).json(authors[0]);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createAuthor = async (req, res) => {
    const { name, bio, image_url } = req.body;
    try {
        if (!name) {
            return res.status(400).json({ message: 'Tên tác giả là bắt buộc' });
        }
        const [result] = await db.execute(
            'INSERT INTO authors (name, bio, image_url) VALUES (?, ?, ?)',
            [name.trim(), bio ? bio.trim() : null, image_url || null]
        );
        res.status(201).json({ message: 'Thêm tác giả thành công', authorId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateAuthor = async (req, res) => {
    const { name, bio, image_url } = req.body;
    try {
        await db.execute(
            'UPDATE authors SET name = ?, bio = ?, image_url = ? WHERE id = ?',
            [name.trim(), bio ? bio.trim() : null, image_url || null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật tác giả thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteAuthor = async (req, res) => {
    try {
        // Kiểm tra xem có sách nào của tác giả này không
        const [books] = await db.execute(
            "SELECT COUNT(*) as count FROM books WHERE author_id = ? AND COALESCE(status, 'active') != 'disposed'",
            [req.params.id]
        );
        const bookCount = books[0]?.count || 0;
        if (bookCount > 0) {
            return res.status(400).json({
                message: `Không thể xóa tác giả này vì đang có ${bookCount} đầu sách liên kết! Vui lòng chuyển các đầu sách này sang tác giả khác trước khi xóa.`
            });
        }

        await db.execute('DELETE FROM authors WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa tác giả thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa tác giả:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa tác giả' });
    }
};
