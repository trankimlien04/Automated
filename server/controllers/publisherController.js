const db = require('../config/db');
const { validateEmail } = require('../utils/validators');

exports.getAllPublishers = async (req, res) => {
    try {
        const [publishers] = await db.execute('SELECT * FROM publishers');
        res.status(200).json(publishers);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getPublisherById = async (req, res) => {
    try {
        const [publishers] = await db.execute('SELECT * FROM publishers WHERE id = ?', [req.params.id]);
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
        await db.execute('DELETE FROM publishers WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Xóa nhà xuất bản thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa nhà xuất bản:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
