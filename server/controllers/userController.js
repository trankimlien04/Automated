const db = require('../config/db');
const bcrypt = require('bcrypt');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');
const {
    sendAccountApprovedEmail,
    sendAccountUnlockedEmail,
    sendAccountLockedEmail,
} = require('../services/emailService');
const { validateEmail, validatePhone } = require('../utils/validators');
const { syncOverdueFines, getReaderCirculationStatus } = require('../services/fineSyncService');
const { saveBase64ToDisk } = require('../utils/fileStorage');

exports.getAllUsers = async (req, res) => {
    try {
        let query = `
            SELECT u.id, u.full_name, u.email, u.role, u.phone, u.avatar_url, u.card_number,
                   u.card_expiry, u.status, u.suspended_until, u.created_at,
                   (SELECT COUNT(*) FROM borrow_records br WHERE br.user_id = u.id AND br.status = 'borrowing' AND DATE(br.due_date) < CURDATE()) as overdue_count,
                   (SELECT COUNT(*) FROM fines f WHERE f.user_id = u.id AND (f.remediation_status = 'pending_remediation' OR (f.violation_type IN ('damaged', 'lost') AND f.status = 'unpaid'))) as pending_remediation_count
            FROM users u
        `;
        const params = [];
        if (req.user && req.user.role === 'librarian') {
            query += ' WHERE u.role = "reader"';
        }
        query += ' ORDER BY u.id ASC';
        const [users] = await db.execute(query, params);
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
        if (!['active', 'locked', 'pending'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái tài khoản không hợp lệ' });
        }

        const [users] = await db.execute(
            'SELECT id, full_name, email, role, card_number, card_expiry, status FROM users WHERE id = ?',
            [targetUserId]
        );
        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }
        const targetUser = users[0];
        const wasPending = targetUser.status === 'pending';
        const wasLocked = targetUser.status === 'locked';

        // RBAC enforcement:
        if (req.user && req.user.role === 'librarian' && targetUser.role !== 'reader') {
            return res.status(403).json({ message: 'Thủ thư chỉ có quyền quản lý tài khoản của độc giả!' });
        }
        if (req.user && req.user.role === 'admin' && targetUser.role === 'owner') {
            return res.status(403).json({ message: 'Quản trị viên không thể thay đổi trạng thái của Chủ thư viện!' });
        }
        if (req.user && Number(targetUser.id) === Number(req.user.id)) {
            return res.status(400).json({ message: 'Bạn không thể tự khóa tài khoản của chính mình!' });
        }

        if (status === 'active') {
            if (targetUser.role === 'reader') {
                const cardNumber = targetUser.card_number || ('LIB-RD-' + String(targetUserId).padStart(6, '0'));
                let expiryDateStr = null;
                if (targetUser.card_expiry) {
                    const parsedExp = new Date(targetUser.card_expiry);
                    if (!Number.isNaN(parsedExp.getTime())) {
                        expiryDateStr = parsedExp.toISOString().slice(0, 10);
                    }
                }
                if (!expiryDateStr) {
                    const expiryDate = new Date();
                    expiryDate.setFullYear(expiryDate.getFullYear() + 4);
                    expiryDateStr = expiryDate.toISOString().slice(0, 10);
                }

                await db.execute(
                    'UPDATE users SET status = ?, card_number = ?, card_expiry = ? WHERE id = ?',
                    [status, cardNumber, expiryDateStr, targetUserId]
                );

                // Notify reader in-app
                const readerNotifTitle = wasLocked ? '🔓 Thẻ thư viện đã được mở khóa' : 'Thẻ thư viện đã được kích hoạt';
                const readerNotifMsg = wasLocked
                    ? `Thẻ thư viện ${cardNumber} của bạn đã được mở khóa trở lại. Bạn có thể đăng nhập ngay để tiếp tục tra cứu, đặt trước và mượn sách.`
                    : `Tài khoản độc giả của bạn đã được phê duyệt và kích hoạt thành công. Mã thẻ thư viện chính thức: ${cardNumber}, có giá trị sử dụng đến ngày ${new Date(expiryDateStr).toLocaleDateString('vi-VN')}.`;

                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [targetUserId, readerNotifTitle, readerNotifMsg]
                );

                // Send email on BOTH initial approval AND card unlock
                let emailResult = null;
                if (targetUser.email) {
                    const emailCall = wasLocked
                        ? sendAccountUnlockedEmail({
                            to: targetUser.email,
                            userId: targetUserId,
                            fullName: targetUser.full_name,
                            role: targetUser.role,
                            cardNumber,
                        })
                        : sendAccountApprovedEmail({
                            to: targetUser.email,
                            userId: targetUserId,
                            fullName: targetUser.full_name,
                            role: targetUser.role,
                            cardNumber,
                            cardExpiry: expiryDateStr,
                        });
                    emailResult = await emailCall.catch((mailErr) => {
                        console.error('Không thể gửi email kích hoạt/mở khóa độc giả:', mailErr.message);
                        return null;
                    });
                }

                // Notify all staff
                await notifyAllStaff(
                    wasLocked ? 'Mở khóa thẻ thư viện độc giả' : 'Kích hoạt thẻ thư viện độc giả',
                    wasLocked
                        ? `Độc giả ${targetUser.full_name} (mã thẻ ${cardNumber}) đã được mở khóa thẻ và thông báo qua email.`
                        : `Độc giả ${targetUser.full_name} đã được phê duyệt tài khoản và cấp mã thẻ ${cardNumber}.`,
                    'info'
                );

                const mailDelivered = emailResult?.mode === 'smtp_real' && emailResult?.success;
                return res.status(200).json({
                    message: wasLocked
                        ? (mailDelivered
                            ? `Mở khóa thẻ ${cardNumber} thành công! Đã gửi email thông báo tới ${targetUser.email}.`
                            : `Mở khóa thẻ thư viện ${cardNumber} thành công!`)
                        : (mailDelivered
                            ? `Phê duyệt tài khoản & cấp thẻ ${cardNumber} thành công! Đã gửi email thông báo tới ${targetUser.email}.`
                            : 'Phê duyệt tài khoản và cấp thẻ thư viện thành công'),
                    cardNumber,
                    emailSent: Boolean(emailResult?.success),
                });
            } else {
                await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId]);
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        targetUserId,
                        wasLocked ? '🔓 Tài khoản đã được mở khóa' : 'Tài khoản đã được kích hoạt',
                        wasLocked
                            ? 'Tài khoản của bạn đã được mở khóa trở lại và có thể đăng nhập vào hệ thống.'
                            : 'Tài khoản của bạn đã được kích hoạt và có thể đăng nhập vào hệ thống.'
                    ]
                );

                let emailResult = null;
                if (targetUser.email) {
                    const emailCall = wasLocked
                        ? sendAccountUnlockedEmail({
                            to: targetUser.email,
                            userId: targetUserId,
                            fullName: targetUser.full_name,
                            role: targetUser.role,
                        })
                        : sendAccountApprovedEmail({
                            to: targetUser.email,
                            userId: targetUserId,
                            fullName: targetUser.full_name,
                            role: targetUser.role,
                        });
                    emailResult = await emailCall.catch((mailErr) => {
                        console.error('Không thể gửi email kích hoạt/mở khóa tài khoản:', mailErr.message);
                        return null;
                    });
                }

                const mailDelivered = emailResult?.mode === 'smtp_real' && emailResult?.success;
                return res.status(200).json({
                    message: wasLocked
                        ? (mailDelivered ? `Mở khóa tài khoản thành công! Đã gửi email tới ${targetUser.email}.` : 'Mở khóa tài khoản thành công!')
                        : (mailDelivered ? `Kích hoạt tài khoản thành công! Đã gửi email tới ${targetUser.email}.` : 'Kích hoạt tài khoản thành công'),
                    emailSent: Boolean(emailResult?.success),
                });
            }
        }

        await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId]);

        let lockEmailResult = null;
        if (status === 'locked') {
            const readerName = targetUser.full_name || `#${targetUserId}`;
            const lockTitle = wasPending
                ? 'Yêu cầu đăng ký tài khoản chưa được phê duyệt'
                : (targetUser.card_number ? '🔒 Thẻ thư viện đã bị tạm khóa' : '🔒 Tài khoản đã bị tạm khóa');
            const lockMsg = wasPending
                ? 'Hồ sơ đăng ký tài khoản thư viện của bạn hiện chưa được phê duyệt. Vui lòng liên hệ Quầy Thủ thư để được hỗ trợ.'
                : `${targetUser.card_number ? `Thẻ thư viện ${targetUser.card_number}` : 'Tài khoản thư viện'} của bạn đã bị tạm khóa. Vui lòng liên hệ cán bộ thư viện để được giải quyết.`;

            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [targetUserId, lockTitle, lockMsg]
            );

            if (targetUser.email) {
                lockEmailResult = await sendAccountLockedEmail({
                    to: targetUser.email,
                    userId: targetUserId,
                    fullName: readerName,
                    cardNumber: targetUser.card_number || null,
                    wasPending,
                }).catch((mailErr) => {
                    console.error('Không thể gửi email thông báo khóa/từ chối:', mailErr.message);
                    return null;
                });
            }

            await notifyAllStaff(
                wasPending ? 'Từ chối hồ sơ đăng ký độc giả' : 'Tài khoản / thẻ người dùng bị tạm khóa',
                wasPending
                    ? `Yêu cầu đăng ký của ${readerName} (ID: #${targetUserId}) đã bị từ chối/khóa.`
                    : `Tài khoản/thẻ của ${readerName}${targetUser.card_number ? ` (${targetUser.card_number})` : ` (ID: #${targetUserId})`} đã bị tạm khóa và gửi email thông báo.`,
                'warning'
            );
        }

        const lockMailDelivered = lockEmailResult?.mode === 'smtp_real' && lockEmailResult?.success;
        res.status(200).json({
            message: status === 'locked'
                ? (wasPending
                    ? (lockMailDelivered ? `Đã từ chối hồ sơ & gửi email thông báo tới ${targetUser.email}` : 'Đã từ chối hồ sơ đăng ký và ghi nhận thông báo')
                    : (lockMailDelivered ? `Đã khóa thẻ/tài khoản & gửi email thông báo tới ${targetUser.email}` : 'Đã khóa thẻ/tài khoản và ghi nhận thông báo'))
                : 'Cập nhật trạng thái người dùng thành công',
            emailSent: Boolean(lockEmailResult?.success),
        });
    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (!targetId) {
            return res.status(400).json({ message: 'ID người dùng không hợp lệ' });
        }

        const isStaff = ['admin', 'librarian', 'owner'].includes(req.user.role);
        if (!isStaff && targetId !== Number(req.user.id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem hồ sơ của người dùng khác' });
        }

        const [users] = await db.execute('SELECT id, full_name, email, role, phone, avatar_url, card_number, card_expiry, status, created_at FROM users WHERE id = ?', [targetId]);
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
            'SELECT id, full_name, email, role, phone, avatar_url, card_number, card_expiry, status, suspended_until, created_at FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin tài khoản' });
        }

        const user = users[0];
        let stats = {};

        if (user.role === 'reader') {
            await syncOverdueFines(userId);
            const circulationStatus = await getReaderCirculationStatus(userId);

            // Thống kê dành cho Độc giả
            const [borrowing] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ? AND status = "borrowing"',
                [userId]
            );
            const [totalBorrowed] = await db.execute(
                'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ?',
                [userId]
            );
            const [reservations] = await db.execute(
                'SELECT COUNT(*) as count FROM reservations WHERE user_id = ? AND status IN ("waiting", "pending", "notified", "ready", "accepted")',
                [userId]
            );

            stats = {
                currentlyBorrowing: borrowing[0].count,
                totalBorrowed: totalBorrowed[0].count,
                unpaidFines: 0,
                activeReservations: reservations[0].count,
                circulationStatus: circulationStatus
                    ? {
                        primaryStatus: circulationStatus.primaryStatus,
                        restrictions: circulationStatus.restrictions,
                        isOverdue: circulationStatus.isOverdue,
                        overdueCount: circulationStatus.overdueCount,
                        isSuspended: circulationStatus.isSuspended,
                        suspendedUntil: circulationStatus.suspendedUntil,
                        suspendedUntilFormatted: circulationStatus.suspendedUntilFormatted,
                        suspensionRemainingDays: circulationStatus.suspensionRemainingDays,
                        isPendingRemediation: circulationStatus.isPendingRemediation,
                        pendingRemediationCount: circulationStatus.pendingRemediationCount,
                        eligibleToBorrow: circulationStatus.eligibleToBorrow,
                        eligibleToReserve: circulationStatus.eligibleToReserve,
                        blockReason: circulationStatus.blockReason
                    }
                    : null
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

    const phoneCheck = validatePhone(phone, false);
    if (!phoneCheck.isValid) {
        return res.status(400).json({ message: phoneCheck.message });
    }

    const cleanPhone = phone ? phone.trim() : null;

    try {
        let storedAvatar = avatar_url || null;
        if (storedAvatar && typeof storedAvatar === 'string' && storedAvatar.startsWith('data:image/')) {
            storedAvatar = await saveBase64ToDisk(storedAvatar, 'avatars', `user_${userId}`);
        }

        await db.execute(
            'UPDATE users SET full_name = ?, phone = ?, avatar_url = ? WHERE id = ?',
            [full_name.trim(), cleanPhone, storedAvatar, userId]
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

        // RBAC enforcement: Admin cannot create Owner account
        if (req.user && req.user.role === 'admin' && role === 'owner') {
            return res.status(403).json({ message: 'Quản trị viên không có quyền tạo tài khoản Chủ thư viện / Giám đốc!' });
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

        const hashedPassword = await bcrypt.hash(password, 10);

        let cardExpiry = null;
        if (role === 'reader') {
            const expiryDate = new Date();
            expiryDate.setFullYear(expiryDate.getFullYear() + 4);
            cardExpiry = expiryDate.toISOString().slice(0, 10);
        }

        const [result] = await db.execute(
            'INSERT INTO users (full_name, email, password_hash, role, phone, card_number, card_expiry, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [fullName.trim(), cleanEmail, hashedPassword, role, cleanPhone, null, cardExpiry, 'active']
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
