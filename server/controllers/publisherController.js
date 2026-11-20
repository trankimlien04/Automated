const db = require('../config/db');
const { validateEmail } = require('../utils/validators');

exports.getAllPublishers = async (req, res) => {
    try {
        const { search, page, limit } = req.query;
        let query = `
            SELECT p.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.publisher_id = p.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM publishers p
        `;
        const params = [];

        if (search && search.trim() !== '') {
            query += ' WHERE p.name LIKE ? OR p.address LIKE ? OR p.contact_email LIKE ?';
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        query += ' ORDER BY p.id DESC';

        if (page && limit) {
            const pageNum = Math.max(1, parseInt(page) || 1);
            const limitNum = Math.max(1, parseInt(limit) || 10);
            const offset = (pageNum - 1) * limitNum;

            let countQuery = 'SELECT COUNT(*) as total FROM publishers p';
            const countParams = [];
            if (search && search.trim() !== '') {
                countQuery += ' WHERE p.name LIKE ? OR p.address LIKE ? OR p.contact_email LIKE ?';
                const term = `%${search.trim()}%`;
                countParams.push(term, term, term);
            }
            const [countRes] = await db.execute(countQuery, countParams);
            const total = countRes[0]?.total || 0;

            query += ` LIMIT ${limitNum} OFFSET ${offset}`;

            const [publishers] = await db.execute(query, params);
            return res.status(200).json({
                data: publishers,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1
            });
        }

        const [publishers] = await db.execute(query, params);
        res.status(200).json(publishers);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getPublisherById = async (req, res) => {
    try {
        const [publishers] = await db.execute(`
            SELECT p.*, 
                   (SELECT COUNT(*) FROM books b WHERE b.publisher_id = p.id AND COALESCE(b.status, 'active') != 'disposed') as book_count
            FROM publishers p 
            WHERE p.id = ?
        `, [req.params.id]);
        if (publishers.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy nhà xuất bản' });
        }
        res.status(200).json(publishers[0]);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createPublisher = async (req, res) => {
    const { name, address, contact_email } = req.body;
    try {
        if (!name) {
            return res.status(400).json({ message: 'Tên nhà xuất bản là bắt buộc' });
        }
        if (contact_email && contact_email.trim() !== '') {
            const emailCheck = validateEmail(contact_email);
            if (!emailCheck.isValid) {
                return res.status(400).json({ message: emailCheck.message });
            }
        }
        const [result] = await db.execute(
            'INSERT INTO publishers (name, address, contact_email) VALUES (?, ?, ?)',
            [name.trim(), address ? address.trim() : null, contact_email ? contact_email.trim() : null]
        );
        res.status(201).json({ message: 'Thêm nhà xuất bản thành công', publisherId: result.insertId });
    } catch (error) {
        console.error('Lỗi khi thêm nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updatePublisher = async (req, res) => {
    const { name, address, contact_email } = req.body;
    try {
        if (contact_email && contact_email.trim() !== '') {
            const emailCheck = validateEmail(contact_email);
            if (!emailCheck.isValid) {
                return res.status(400).json({ message: emailCheck.message });
            }
        }
        await db.execute(
            'UPDATE publishers SET name = ?, address = ?, contact_email = ? WHERE id = ?',
            [name ? name.trim() : '', address ? address.trim() : null, contact_email ? contact_email.trim() : null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật nhà xuất bản thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deletePublisher = async (req, res) => {
    try {
        // Kiểm tra xem có sách nào của nhà xuất bản này không
        const [books] = await db.execute(
            "SELECT COUNT(*) as count FROM books WHERE publisher_id = ? AND COALESCE(status, 'active') != 'disposed'",
            [req.params.id]
        );
        const bookCount = books[0]?.count || 0;
        if (bookCount > 0) {
            return res.status(400).json({
                message: `Không thể xóa nhà xuất bản này vì đang có ${bookCount} đầu sách liên kết! Vui lòng chuyển các đầu sách này sang nhà xuất bản khác trước khi xóa.`
            });
        }

        await db.execute('DELETE FROM publishers WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa nhà xuất bản thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa nhà xuất bản' });
    }
};
