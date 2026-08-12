const db = require('../config/db');

exports.getAllAuthors = async (req, res) => {
    try {
        const [authors] = await db.execute('SELECT * FROM authors');
        res.status(200).json(authors);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getAuthorById = async (req, res) => {
    try {
        const [authors] = await db.execute('SELECT * FROM authors WHERE id = ?', [req.params.id]);
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
            [name, bio || null, image_url || null]
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
            [name, bio || null, image_url || null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật tác giả thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteAuthor = async (req, res) => {
    try {
        await db.execute('DELETE FROM authors WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa tác giả thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa tác giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
