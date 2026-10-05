const db = require('../config/db');
const bcrypt = require('bcrypt');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');

exports.getAllUsers = async (req, res) => {
    try {
        const [users] = await db.execute('SELECT id, full_name, email, role, phone, avatar_url, card_number, card_expiry, status, created_at FROM users ORDER BY id ASC');
        res.status(200).json(users);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách người dùng:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateUserStatus = async (req, res) => {
    const { status } = req.body;
    const targetUserId = req.params.id;
    try {
        if (status === 'active') {
            const [users] = await db.execute('SELECT id, full_name, role, card_number FROM users WHERE id = ?', [targetUserId]);
            if (users.length > 0 && users[0].role === 'reader') {
                const cardNumber = users[0].card_number || ('LIB-RD-' + String(targetUserId).padStart(6, '0'));
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 4);
                
                await db.execute(
                    'UPDATE users SET status = ?, card_number = ?, card_expiry = ? WHERE id = ?',
                    [status, cardNumber, expiryDate.toISOString().slice(0, 10), targetUserId]
                );

                // Notify reader
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        targetUserId,
                        'Thẻ thư viện đã được kích hoạt',
                        `Tài khoản độc giả của bạn đã được phê duyệt và kích hoạt thành công. Mã thẻ thư viện chính thức: ${cardNumber}, có giá trị sử dụng đến ngày ${expiryDate.toLocaleDateString('vi-VN')}.`
                    ]
                );

                // Notify all staff
                await notifyAllStaff(
                    'Kích hoạt thẻ thư viện độc giả',
                    `Độc giả ${users[0].full_name} đã được phê duyệt tài khoản và cấp mã thẻ ${cardNumber}.`,
                    'info'
                );

                return res.status(200).json({ message: 'Phê duyệt tài khoản và cấp thẻ thư viện thành công', cardNumber });
            } else if (users.length > 0) {
                await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId]);
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        targetUserId,
                        'Tài khoản đã được kích hoạt',
                        'Tài khoản của bạn đã được kích hoạt và có thể đăng nhập vào hệ thống.'
                    ]
                );
                return res.status(200).json({ message: 'Kích hoạt tài khoản thành công' });
            }
        }

        await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId]);

        if (status === 'locked') {
            const [users] = await db.execute('SELECT full_name FROM users WHERE id = ?', [targetUserId]);
            const readerName = users.length > 0 ? users[0].full_name : `#${targetUserId}`;

            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    targetUserId,
                    'Tài khoản đã bị tạm khóa',
                    'Tài khoản thư viện của bạn đã bị khóa. Vui lòng liên hệ cán bộ thư viện để được giải quyết.'
                ]
            );

            await notifyAllStaff(
                'Tài khoản người dùng bị tạm khóa',
                `Tài khoản của độc giả ${readerName} (ID: #${targetUserId}) đã bị khóa.`,
                'warning'
            );
        }

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

// GET /api/users/profile/me - Lấy thông tin cá nhân của Actor hiện tại kèm số liệu thống kê
exports.getMyProfile = async (req, res) => {
    const userId = req.user.id;
    try {
        const [users] = await db.execute(
            'SELECT id, full_name, email, role, phone, avatar_url, card_number, card_expiry, status, created_at FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin tài khoản' });
        }

        const user = users[0];
        let stats = {};

        if (user.role === 'reader') {
            // Thống kê dành cho Độc giả
            const [borrowing] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ? AND status = "borrowing"',
                [userId]
            );
            const [totalBorrowed] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ?',
                [userId]
            );
            const [unpaidFines] = await db.execute(
                'SELECT COALESCE(SUM(amount), 0) as total FROM fines WHERE user_id = ? AND status = "unpaid"',
                [userId]
            );
            const [reservations] = await db.execute(
                'SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND status IN ("pending", "ready")',
                [userId]
            );

            stats = {
                currentlyBorrowing: borrowing[0].count,
                totalBorrowed: totalBorrowed[0].count,
                unpaidFines: Number(unpaidFines[0].total),
                activeReservations: reservations[0].count,
            };
        } else if (user.role === 'librarian') {
            // Thống kê dành cho Thủ thư
            const [processed] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE processed_by = ?',
                [userId]
            );
            const [todayProcessed] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE processed_by = ? AND DATE(borrow_date) = CURDATE()',
                [userId]
            );

            stats = {
                totalProcessedTransactions: processed[0].count,
                todayProcessedTransactions: todayProcessed[0].count,
            };
        } else if (user.role === 'admin') {
            // Thống kê dành cho Quản trị viên
            const [totalUsers] = await db.execute('SELECT COUNT(*) as count FROM users');
            const [myProposals] = await db.execute(
                'SELECT COUNT(*) as count FROM config_change_requests WHERE requested_by = ?',
                [userId]
            );

            stats = {
                totalUsersInSystem: totalUsers[0].count,
                proposalsSubmitted: myProposals[0].count,
            };
        } else if (user.role === 'owner') {
            // Thống kê dành cho Chủ thư viện / Giám đốc
            const [reviewedProposals] = await db.execute(
                'SELECT COUNT(*) as count FROM config_change_requests WHERE reviewed_by = ?',
                [userId]
            );
            const [pendingProposals] = await db.execute(
                'SELECT COUNT(*) as count FROM config_change_requests WHERE status = "pending"'
            );

            stats = {
                proposalsReviewed: reviewedProposals[0].count,
                proposalsPendingReview: pendingProposals[0].count,
            };
        }

        res.status(200).json({ user, stats });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin cá nhân:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy hồ sơ cá nhân' });
    }
};

// PUT /api/users/profile/me - Cập nhật thông tin cá nhân
exports.updateMyProfile = async (req, res) => {
    const userId = req.user.id;
    const { full_name, phone, avatar_url } = req.body;

    if (!full_name || full_name.trim() === '') {
        return res.status(400).json({ message: 'Họ và tên không được để trống' });
    }

    try {
        await db.execute(
            'UPDATE users SET full_name = ?, phone = ?, avatar_url = ? WHERE id = ?',
            [full_name.trim(), phone || null, avatar_url || null, userId]
        );

        // Ghi activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId, 'UPDATE_PROFILE', 'users', userId, `Người dùng ${full_name} cập nhật thông tin cá nhân`]
        );

        res.status(200).json({ message: 'Cập nhật thông tin cá nhân thành công!' });
    } catch (error) {
        console.error('Lỗi khi cập nhật hồ sơ cá nhân:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật hồ sơ' });
    }
};

// PUT /api/users/profile/change-password - Đổi mật khẩu
exports.changePassword = async (req, res) => {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }

    try {
        const [users] = await db.execute('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Người dùng không tồn tại' });
        }

        const isMatch = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Mật khẩu hiện tại không chính xác' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

        // Ghi activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId, 'CHANGE_PASSWORD', 'users', userId, 'Người dùng thay đổi mật khẩu tài khoản thành công']
        );

        res.status(200).json({ message: 'Đổi mật khẩu thành công! Vui lòng ghi nhớ mật khẩu mới.' });
    } catch (error) {
        console.error('Lỗi khi đổi mật khẩu:', error);
        res.status(500).json({ message: 'Lỗi server khi đổi mật khẩu' });
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
        
        let cardExpiry = null;
        if (role === 'reader') {
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 4);
            cardExpiry = expiryDate.toISOString().slice(0, 10);
        }

        const [result] = await db.execute(
            'INSERT INTO users (full_name, email, password_hash, role, phone, card_number, card_expiry, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [fullName, email, hashedPassword, role, phone || null, null, cardExpiry, 'active']
        );

        const newId = result.insertId;
        const prefixMap = {
            reader: 'LIB-RD-',
            librarian: 'LIB-LB-',
            admin: 'LIB-AD-',
            owner: 'LIB-OW-'
        };
        const prefix = prefixMap[role] || 'LIB-RD-';
        const finalCardNumber = prefix + String(newId).padStart(6, '0');

        await db.execute('UPDATE users SET card_number = ? WHERE id = ?', [finalCardNumber, newId]);

        res.status(201).json({ message: 'Tạo tài khoản thành công!', cardNumber: finalCardNumber });
    } catch (error) {
        console.error('Lỗi khi tạo tài khoản:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo tài khoản' });
    }
};
