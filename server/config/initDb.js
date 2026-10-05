const db = require('./db');
const bcrypt = require('bcrypt');

async function initOwnerAndConfigTables() {
    try {
        // 1. Ensure role ENUM in users table contains 'owner'
        try {
            await db.execute(
                "ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'librarian', 'reader', 'owner') DEFAULT 'reader'"
            );
        } catch (err) {
            // Already modified or error
        }

        // 2. Ensure config_change_requests table exists
        await db.execute(`
            CREATE TABLE IF NOT EXISTS config_change_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                key_name VARCHAR(100) NOT NULL,
                current_value TEXT,
                proposed_value TEXT NOT NULL,
                reason TEXT,
                requested_by INT NOT NULL,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                reviewed_by INT NULL,
                reviewed_at DATETIME NULL,
                review_note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // 3. Ensure Owner account exists
        const [existingOwner] = await db.execute("SELECT id FROM users WHERE email = 'owner@library.com'");
        if (existingOwner.length === 0) {
            const ownerHash = await bcrypt.hash('123456', 10);
            await db.execute(
                `INSERT INTO users (full_name, email, password_hash, role, phone, card_number, card_expiry, status)
                 VALUES (?, ?, ?, 'owner', '0909999000', 'LIB-OW-000001', '2030-12-31', 'active')`,
                ['Trần Văn Chủ', 'owner@library.com', ownerHash]
            );
            console.log('👑 [INIT DB] Created default Owner account: owner@library.com / 123456');
        }

        // 4. Ensure all users have standardized card_number strictly matched with user ID
        await db.execute(`
            UPDATE users 
            SET card_number = CASE 
                WHEN role = 'reader' THEN CONCAT('LIB-RD-', LPAD(id, 6, '0'))
                WHEN role = 'librarian' THEN CONCAT('LIB-LB-', LPAD(id, 6, '0'))
                WHEN role = 'admin' THEN CONCAT('LIB-AD-', LPAD(id, 6, '0'))
                WHEN role = 'owner' THEN CONCAT('LIB-OW-', LPAD(id, 6, '0'))
                ELSE CONCAT('LIB-RD-', LPAD(id, 6, '0'))
            END,
            card_expiry = IFNULL(card_expiry, DATE_ADD(CURRENT_DATE, INTERVAL 4 YEAR))
        `);

        // 5. Ensure at least 1 sample pending proposal exists if empty
        const [existingRequests] = await db.execute("SELECT id FROM config_change_requests");
        if (existingRequests.length === 0) {
            const [adminUser] = await db.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            const adminId = adminUser.length > 0 ? adminUser[0].id : 1;
            await db.execute(
                `INSERT INTO config_change_requests (key_name, current_value, proposed_value, reason, requested_by, status)
                 VALUES ('fine_per_day', '5000', '10000', 'Đề xuất tăng phí phạt theo quý mới nhằm giảm thiểu độc giả giữ sách quá hạn', ?, 'pending')`,
                [adminId]
            );
            console.log('👑 [INIT DB] Seeded sample pending config request for Owner review');
        }

        // 6. Ensure all staff roles (Admin, Librarian, Owner) have starter notifications
        const [staffUsers] = await db.execute("SELECT id, role, full_name FROM users WHERE role IN ('admin', 'librarian', 'owner')");
        for (const staff of staffUsers) {
            const [notis] = await db.execute("SELECT COUNT(*) as count FROM notifications WHERE user_id = ?", [staff.id]);
            if (notis[0].count === 0) {
                if (staff.role === 'admin') {
                    await db.execute(`
                        INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES
                        (?, 'Hệ thống Smart Library đã sẵn sàng', 'Chào mừng Quản trị viên. Toàn bộ các dịch vụ mượn trả, tra cứu và Maker-Checker đang hoạt động bình thường.', 'info', 0, NOW()),
                        (?, 'Cảnh báo sách quá hạn định kỳ', 'Hệ thống ghi nhận có độc giả mượn sách quá hạn cần đôn đốc thu hồi và nộp phạt.', 'warning', 0, DATE_SUB(NOW(), INTERVAL 2 HOUR)),
                        (?, 'Yêu cầu phê duyệt cấu hình hệ thống', 'Đã có đề xuất thay đổi mức phí phạt trễ hạn gửi tới Giám đốc phê duyệt.', 'reminder', 0, DATE_SUB(NOW(), INTERVAL 5 HOUR))
                    `, [staff.id, staff.id, staff.id]);
                } else if (staff.role === 'librarian') {
                    await db.execute(`
                        INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES
                        (?, 'Ca làm việc thủ thư kích hoạt', 'Chào mừng Thủ thư. Bạn có thể sử dụng tính năng quét mã QR để xuất nhập mượn trả sách nhanh chóng.', 'info', 0, NOW()),
                        (?, 'Độc giả mượn sách tại quầy', 'Độc giả Trần Kim Liên (LIB-RD-000005) vừa mượn cuốn "Lập trình Node.js & React Thực Chiến" (Mã bản sao: QR-BK-4-1). Hạn trả sách: 14 ngày.', 'info', 0, DATE_SUB(NOW(), INTERVAL 2 HOUR)),
                        (?, 'Độc giả đặt trước sách mới', 'Có độc giả vừa tạo phiếu đặt trước cuốn sách "Mắt Biếc". Vui lòng kiểm tra và chuẩn bị sách tại quầy.', 'reminder', 0, DATE_SUB(NOW(), INTERVAL 1 HOUR)),
                        (?, 'Ghi nhận hoàn tất trả sách', 'Độc giả đã hoàn tất trả sách vào kho. Sách đã được chuyển trạng thái khả dụng cho người mượn tiếp theo.', 'info', 0, DATE_SUB(NOW(), INTERVAL 3 HOUR))
                    `, [staff.id, staff.id, staff.id, staff.id]);
                } else if (staff.role === 'owner') {
                    await db.execute(`
                        INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES
                        (?, 'Quyền Giám đốc / Chủ thư viện', 'Chào mừng Chủ thư viện. Bạn có toàn quyền giám sát toàn bộ hoạt động lưu thông, tài chính và phê duyệt Maker-Checker.', 'info', 0, NOW()),
                        (?, 'Đề xuất thay đổi quy chế mới (Maker-Checker)', 'Admin vừa đề xuất điều chỉnh tham số phí phạt trễ hạn "fine_per_day". Vui lòng vào mục Quản lý hệ thống để phê duyệt.', 'reminder', 0, DATE_SUB(NOW(), INTERVAL 4 HOUR)),
                        (?, 'Báo cáo doanh thu & lưu thông định kỳ', 'Tổng lượt mượn sách và doanh thu thu phạt đã được cập nhật tại mục Thống kê & Báo cáo.', 'info', 0, DATE_SUB(NOW(), INTERVAL 8 HOUR))
                    `, [staff.id, staff.id, staff.id]);
                }
            }
        }

        console.log('✅ [INIT DB] Owner role & Maker-Checker tables ready!');
    } catch (error) {
        console.error('⚠️ [INIT DB] Warning initializing owner/config tables:', error.message);
    }
}

module.exports = initOwnerAndConfigTables;
