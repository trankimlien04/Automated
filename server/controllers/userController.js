const db = require('../config/db');
const bcrypt = require('bcrypt');

exports.getAllUsers = async (req, res) => {
    try {
        const [users] = await db.execute('SELECT id, full_name, email, role, phone, avatar_url, card_number, status, created_at FROM users');
        res.status(200).json(users);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách người dùng:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateUserStatus = async (req, res) => {
    const { status } = req.body;
    try {
        // If transitioning from pending to active for a reader who has no card number, generate one!
        if (status === 'active') {
            const [users] = await db.execute('SELECT role, card_number FROM users WHERE id = ?', [req.params.id]);
            if (users.length > 0 && users[0].role === 'reader' && !users[0].card_number) {
                const cardNumber = 'LIB-RD-' + Date.now().toString().slice(-6);
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 4); // Card valid for 4 years
                
                await db.execute(
                    'UPDATE users SET status = ?, card_number = ?, card_expiry = ? WHERE id = ?',
                    [status, cardNumber, expiryDate.toISOString().slice(0, 10), req.params.id]
                );
                return res.status(200).json({ message: 'Phê duyệt tài khoản và cấp thẻ thư viện thành công' });
            }
        }

        await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
        res.status(200).json({ message: 'Cập nhật trạng thái người dùng thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        const [users] = await db.execute('SELECT id, full_name, email, role, phone, avatar_url, card_number, card_expiry, status, created_at FROM users WHERE id = ?', [req.params.id]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }
        res.status(200).json(users[0]);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin người dùng:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createUser = async (req, res) => {
    const { fullName, email, password, role, phone } = req.body;

    try {
        if (!fullName || !email || !password || !role) {
            return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ họ tên, email, mật khẩu và vai trò' });
        }

        const [existingUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Email đã được đăng ký' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        let cardNumber = null;
        let cardExpiry = null;

        if (role === 'reader') {
            cardNumber = 'LIB-RD-' + Date.now().toString().slice(-6);
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 4);
            cardExpiry = expiryDate.toISOString().slice(0, 10);
        } else if (role === 'librarian') {
            cardNumber = 'LIB-LB-' + Date.now().toString().slice(-6);
        }

        await db.execute(
            'INSERT INTO users (full_name, email, password_hash, role, phone, card_number, card_expiry, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [fullName, email, hashedPassword, role, phone || null, cardNumber, cardExpiry, 'active']
        );

        res.status(201).json({ message: 'Tạo tài khoản thành công!' });
    } catch (error) {
        console.error('Lỗi khi tạo tài khoản:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo tài khoản' });
    }
};
