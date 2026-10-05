const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { notifyRoles } = require('../services/notificationService');

exports.register = async (req, res) => {
    const { fullName, email, password, phone } = req.body;

    try {
        if (!fullName || !email || !password) {
            return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ tên, email và mật khẩu' });
        }

        const [existingUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Email đã được đăng ký' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await db.execute(
            'INSERT INTO users (full_name, email, password_hash, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)',
            [fullName, email, hashedPassword, phone || null, 'reader', 'pending']
        );

        // Notify Admin & Librarian
        await notifyRoles(
            ['admin', 'librarian'],
            'Độc giả mới đăng ký tài khoản',
            `Người dùng ${fullName} (${email}) vừa đăng ký tài khoản độc giả mới. Vui lòng vào mục Quản lý độc giả để kiểm tra và phê duyệt.`,
            'info'
        );

        res.status(201).json({ message: 'Đăng ký thành công, vui lòng chờ Admin phê duyệt' });
    } catch (error) {
        console.error('Lỗi khi đăng ký:', error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký' });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ message: 'Vui lòng cung cấp email và mật khẩu' });
        }

        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng' });
        }

        if (user.status === 'locked') {
            return res.status(403).json({ message: 'Tài khoản của bạn đã bị khóa' });
        }
        
        if (user.status === 'pending') {
            return res.status(403).json({ message: 'Tài khoản của bạn đang chờ phê duyệt' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        res.status(200).json({
            message: 'Đăng nhập thành công',
            token,
            user: {
                id: user.id,
                fullName: user.full_name,
                email: user.email,
                role: user.role,
                avatar: user.avatar_url
            }
        });
    } catch (error) {
        console.error('Lỗi khi đăng nhập:', error);
        res.status(500).json({ message: 'Lỗi server khi đăng nhập' });
    }
};
