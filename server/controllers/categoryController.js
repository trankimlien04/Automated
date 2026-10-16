const db = require('../config/db');

exports.getAllCategories = async (req, res) => {
    try {
        const [categories] = await db.execute('SELECT * FROM categories');
        res.status(200).json(categories);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getCategoryById = async (req, res) => {
    try {
        const [categories] = await db.execute('SELECT * FROM categories WHERE id = ?', [req.params.id]);
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
            [name, parent_id || null, description || null]
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
            [name, parent_id || null, description || null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật thể loại thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        await db.execute('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa thể loại thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa thể loại:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
