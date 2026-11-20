const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { notifyRoles, notifyUser } = require('../services/notificationService');
const { sendPasswordResetEmail } = require('../services/emailService');
const { validateEmail, validatePhone } = require('../utils/validators');
const { getJwtSecret } = require('../middlewares/authMiddleware');

exports.register = async (req, res) => {
    const { fullName, email, password, phone } = req.body;

    try {
        if (!fullName || !email || !password) {
            return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ tên, email và mật khẩu' });
        }

        const emailCheck = validateEmail(email);
        if (!emailCheck.isValid) {
            return res.status(400).json({ message: emailCheck.message });
        }

        const phoneCheck = validatePhone(phone, false);
        if (!phoneCheck.isValid) {
            return res.status(400).json({ message: phoneCheck.message });
        }

        const cleanEmail = email.trim();
        const cleanPhone = phone ? phone.trim() : null;

        const [existingUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [cleanEmail]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Email đã được đăng ký' });
        }

        const cleanName = fullName.trim();
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [result] = await db.execute(
            'INSERT INTO users (full_name, email, password_hash, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)',
            [cleanName, cleanEmail, hashedPassword, cleanPhone, 'reader', 'pending']
        );

        const newUserId = result?.insertId || null;

        // Notify Admin & Librarian (In-app only; reader receives email once approved or rejected)
        await notifyRoles(
            ['admin', 'librarian'],
            'Độc giả mới đăng ký tài khoản',
            `Người dùng ${cleanName} (${cleanEmail}) vừa đăng ký tài khoản độc giả mới. Vui lòng vào mục Quản lý độc giả để kiểm tra và phê duyệt.`,
            'info'
        );

        res.status(201).json({
            message: 'Đăng ký thành công! Tài khoản đang chờ Thủ thư/Admin phê duyệt. Khi được duyệt, hệ thống sẽ gửi thông báo kèm Mã thẻ về email của bạn.',
            status: 'pending',
            email: cleanEmail,
        });
    } catch (error) {
        console.error('Lỗi khi đăng ký:', error);
        res.status(500).json({ message: 'Lỗi server khi đăng ký' });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const cleanEmail = String(email || '').trim().toLowerCase();
        if (!cleanEmail || !password) {
            return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ email và mật khẩu' });
        }

        const emailCheck = validateEmail(cleanEmail);
        if (!emailCheck.isValid) {
            return res.status(400).json({ message: emailCheck.message });
        }

        const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [cleanEmail]);
        if (users.length === 0) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không chính xác' });
        }

        const user = users[0];

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không chính xác' });
        }

        if (user.status === 'locked') {
            return res.status(403).json({
                message: user.card_number
                    ? `Thẻ thư viện (${user.card_number}) của bạn hiện đang bị tạm khóa. Thông báo đã được gửi qua email; vui lòng liên hệ Quầy Thủ thư hoặc Quản trị viên để được mở khóa.`
                    : 'Tài khoản của bạn đã bị khóa hoặc chưa được phê duyệt. Thông báo đã được gửi qua email; vui lòng liên hệ Quầy Thủ thư.',
                accountStatus: 'locked',
                cardNumber: user.card_number || null,
            });
        }
        
        if (user.status === 'pending') {
            return res.status(403).json({
                message: 'Tài khoản của bạn đang chờ Thủ thư/Admin phê duyệt. Khi được duyệt, hệ thống sẽ gửi email thông báo tới hộp thư của bạn.',
                accountStatus: 'pending',
            });
        }

        // Check if there is an unread account approval/unlock notice to surface right after login
        let accountNotice = null;
        try {
            const [noticeRows] = await db.execute(
                `SELECT id, title, message, created_at
                 FROM notifications
                 WHERE user_id = ? AND is_read = 0
                   AND title IN (
                     'Thẻ thư viện đã được kích hoạt',
                     'Tài khoản đã được kích hoạt',
                     '🔓 Thẻ thư viện đã được mở khóa',
                     '🔓 Tài khoản đã được mở khóa'
                   )
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1`,
                [user.id]
            );
            if (Array.isArray(noticeRows) && noticeRows.length > 0) {
                const row = noticeRows[0];
                accountNotice = {
                    id: row.id,
                    kind: String(row.title || '').toLowerCase().includes('mở khóa') ? 'unlocked' : 'approved',
                    title: row.title,
                    message: row.message,
                    cardNumber: user.card_number || null,
                    createdAt: row.created_at,
                };
            }
        } catch {
            accountNotice = null;
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, fullName: user.full_name },
            getJwtSecret(),
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
                avatar: user.avatar_url,
                cardNumber: user.card_number,
                card_number: user.card_number
            },
            accountNotice,
        });
    } catch (error) {
        console.error('Lỗi khi đăng nhập:', error);
        res.status(500).json({ message: 'Lỗi server khi đăng nhập' });
    }
};

/**
 * POST /api/auth/forgot-password (Point 1: Quên mật khẩu)
 */
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        if (!email) {
            return res.status(400).json({ message: 'Vui lòng cung cấp địa chỉ email tài khoản' });
        }

        const emailCheck = validateEmail(email);
        if (!emailCheck.isValid) {
            return res.status(400).json({ message: emailCheck.message });
        }

        const cleanEmail = email.trim();
        const [users] = await db.execute('SELECT id, full_name, email, status FROM users WHERE email = ?', [cleanEmail]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản với email này trong hệ thống' });
        }

        const user = users[0];
        if (user.status === 'locked') {
            return res.status(403).json({ message: 'Tài khoản đang bị tạm khóa. Vui lòng liên hệ Quầy Thủ thư để được hỗ trợ mở khóa.' });
        }

        // Tạo mã OTP 6 số và mã hex bảo mật
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút

        // Hủy các mã reset chưa dùng trước đó
        await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0', [user.id]);

        // Lưu mã vào CSDL
        await db.execute(
            'INSERT INTO password_reset_tokens (user_id, token, reset_code, expires_at, used) VALUES (?, ?, ?, ?, 0)',
            [user.id, resetToken, resetCode, expiresAt]
        );

        // Gửi email chứa OTP
        await sendPasswordResetEmail({
            to: user.email,
            userId: user.id,
            fullName: user.full_name,
            resetCode,
            expiresMinutes: 15
        });

        return res.status(200).json({
            status: 'success',
            message: 'Mã xác thực 6 số đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư (kể cả thư mục Spam/Rác).',
            email: cleanEmail
        });
    } catch (err) {
        console.error('Lỗi forgotPassword:', err);
        return res.status(500).json({ message: 'Lỗi máy chủ khi xử lý yêu cầu quên mật khẩu' });
    }
};

/**
 * POST /api/auth/reset-password (Point 1: Đặt lại mật khẩu)
 */
exports.resetPassword = async (req, res) => {
    const { email, resetCode, newPassword } = req.body;
    try {
        if (!email || !resetCode || !newPassword) {
            return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ email, mã xác thực và mật khẩu mới' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Mật khẩu mới phải có tối thiểu 6 ký tự' });
        }

        const cleanEmail = email.trim();
        const cleanCode = String(resetCode).trim();

        const [users] = await db.execute('SELECT id, full_name, email, status FROM users WHERE email = ?', [cleanEmail]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản tương ứng' });
        }

        const user = users[0];

        // Tìm token hợp lệ chưa dùng và còn hạn
        const [tokens] = await db.execute(
            `SELECT id, expires_at, used FROM password_reset_tokens 
             WHERE user_id = ? AND reset_code = ? AND used = 0 AND expires_at > NOW() 
             ORDER BY id DESC LIMIT 1`,
            [user.id, cleanCode]
        );

        if (tokens.length === 0) {
            return res.status(400).json({ message: 'Mã xác thực không hợp lệ hoặc đã hết hạn (15 phút). Vui lòng yêu cầu mã mới.' });
        }

        const tokenId = tokens[0].id;
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Cập nhật mật khẩu và đánh dấu token đã dùng
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, user.id]);
        await db.execute('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [tokenId]);

        // Ghi nhật ký
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [user.id, 'RESET_PASSWORD', 'users', user.id, `Người dùng ${user.full_name} (${cleanEmail}) đặt lại mật khẩu qua mã OTP email`]
        );

        // Gửi thông báo in-app
        await notifyUser(
            user.id,
            'Mật khẩu tài khoản đã được thay đổi',
            'Mật khẩu tài khoản thư viện của bạn vừa được đặt lại thành công. Nếu không phải bạn thực hiện, vui lòng liên hệ ngay với Thủ thư.',
            'info'
        );

        return res.status(200).json({
            status: 'success',
            message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.'
        });
    } catch (err) {
        console.error('Lỗi resetPassword:', err);
        return res.status(500).json({ message: 'Lỗi máy chủ khi đặt lại mật khẩu' });
    }
};
