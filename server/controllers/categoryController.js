const db = require('../config/db');

exports.getAllCategories = async (req, res) => {
    try {
        const { search, page, limit } = req.query;
        let query = `
            SELECT c.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.category_id = c.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM categories c
        `;
        const params = [];

        if (search && search.trim() !== '') {
            query += ' WHERE c.name LIKE ? OR c.description LIKE ?';
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        query += ' ORDER BY c.id DESC';

        if (page && limit) {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.max(1, parseInt(limit) || 10);
            const offset = (pageNum - 1) * limitNum;

            // Total count
            let countQuery = 'SELECT COUNT(*) as total FROM categories c';
            const countParams = [];
            if (search && search.trim() !== '') {
                countQuery += ' WHERE c.name LIKE ? OR c.description LIKE ?';
                const term = `%${search.trim()}%`;
                countParams.push(term, term);
            }
            const [countRes] = await db.execute(countQuery, countParams);
            const total = countRes[0]?.total || 0;

            query += ` LIMIT ${limitNum} OFFSET ${offset}`;

            const [categories] = await db.execute(query, params);
            return res.status(200).json({
                data: categories,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1
            });
        }

        const [categories] = await db.execute(query, params);
        res.status(200).json(categories);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getCategoryById = async (req, res) => {
    try {
        const [categories] = await db.execute(`
            SELECT c.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.category_id = c.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM categories c 
            WHERE c.id = ?
        `, [req.params.id]);
        if (categories.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thể loại' });
        }
        res.status(200).json(categories[0]);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createCategory = async (req, res) => {
    const { name, parent_id, description } = req.body;
    try {
        if (!name) {
            return res.status(400).json({ message: 'Tên thể loại là bắt buộc' });
        }
        const [result] = await db.execute(
            'INSERT INTO categories (name, parent_id, description) VALUES (?, ?, ?)',
            [name.trim(), parent_id || null, description ? description.trim() : null]
        );
        res.status(201).json({ message: 'Thêm thể loại thành công', categoryId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateCategory = async (req, res) => {
    const { name, parent_id, description } = req.body;
    try {
        await db.execute(
            'UPDATE categories SET name = ?, parent_id = ?, description = ? WHERE id = ?',
            [name.trim(), parent_id || null, description ? description.trim() : null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật thể loại thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        // Kiểm tra xem có đầu sách nào đang thuộc thể loại này không
        const [books] = await db.execute(
            "SELECT COUNT(*) as count FROM books WHERE category_id = ? AND COALESCE(status, 'active') != 'disposed'",
            [req.params.id]
        );
        const bookCount = books[0]?.count || 0;
        if (bookCount > 0) {
            return res.status(400).json({
                message: `Không thể xóa thể loại này vì đang có ${bookCount} đầu sách liên kết! Vui lòng chuyển các đầu sách này sang thể loại khác trước khi xóa.`
            });
        }

        await db.execute('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa thể loại thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa thể loại:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa thể loại' });
    }
};
