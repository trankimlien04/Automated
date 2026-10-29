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

        // 3. Ensure Default Demo Accounts exist with valid credentials (Auto-healing)
        const defaultAccounts = [
            { email: 'admin@library.com', fullName: 'Administrator', pass: 'admin123', role: 'admin', phone: '0901111222', card: 'LIB-AD-000001' },
            { email: 'librarian@library.com', fullName: 'Trần Thủ Thư', pass: '123456', role: 'librarian', phone: '0902222333', card: 'LIB-LB-000001' },
            { email: 'reader@library.com', fullName: 'Nguyễn Minh A', pass: '123456', role: 'reader', phone: '0904444555', card: 'LIB-RD-100001' },
            { email: 'owner@library.com', fullName: 'Trần Văn Chủ', pass: '123456', role: 'owner', phone: '0909999000', card: 'LIB-OW-000001' }
        ];

        for (const acc of defaultAccounts) {
            const [rows] = await db.execute("SELECT id, password_hash FROM users WHERE email = ?", [acc.email]);
            if (rows.length === 0) {
                const passHash = await bcrypt.hash(acc.pass, 10);
                await db.execute(
                    `INSERT INTO users (full_name, email, password_hash, role, phone, card_number, card_expiry, status)
                     VALUES (?, ?, ?, ?, ?, ?, '2030-12-31', 'active')`,
                    [acc.fullName, acc.email, passHash, acc.role, acc.phone, acc.card]
                );
                console.log(`👤 [INIT DB] Created default account: ${acc.email} (${acc.role})`);
            } else {
                const isMatch = await bcrypt.compare(acc.pass, rows[0].password_hash || '').catch(() => false);
                if (!isMatch) {
                    const passHash = await bcrypt.hash(acc.pass, 10);
                    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passHash, rows[0].id]);
                    console.log(`🔑 [INIT DB] Reset & verified password for default account: ${acc.email}`);
                }
            }
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

        // 7. Ensure payment columns exist in fines table (Omnichannel payment: Cash & VietQR Transfer)
        try {
            const [pMethodCol] = await db.execute("SHOW COLUMNS FROM fines LIKE 'payment_method'");
            if (pMethodCol.length === 0) {
                await db.execute("ALTER TABLE fines ADD COLUMN payment_method ENUM('cash', 'transfer') DEFAULT 'cash'");
            }
            const [pChannelCol] = await db.execute("SHOW COLUMNS FROM fines LIKE 'payment_channel'");
            if (pChannelCol.length === 0) {
                await db.execute("ALTER TABLE fines ADD COLUMN payment_channel ENUM('counter', 'online') DEFAULT 'counter'");
            }
            const [pRefCol] = await db.execute("SHOW COLUMNS FROM fines LIKE 'transaction_ref'");
            if (pRefCol.length === 0) {
                await db.execute("ALTER TABLE fines ADD COLUMN transaction_ref VARCHAR(100) NULL");
            }
        } catch (colErr) {
            console.error('⚠️ [INIT DB] Error verifying fines payment columns:', colErr.message);
        }

        // 8. Ensure library bank configuration exists for VietQR payment
        const bankConfigs = [
            ['bank_code', 'TPB', 'Mã ngân hàng nhận thanh toán VietQR (ví dụ: TPB, MB, VCB, TCB, ACB...)'],
            ['bank_name', 'TPBank (Ngân hàng Tiên Phong)', 'Tên ngân hàng thụ hưởng'],
            ['bank_account_no', '00000307092', 'Số tài khoản ngân hàng nhận tiền phạt'],
            ['bank_account_name', 'THU VIEN ATHENAEUM', 'Tên chủ tài khoản thụ hưởng']
        ];
        for (const [key, val, desc] of bankConfigs) {
            const [exist] = await db.execute('SELECT key_name FROM system_configs WHERE key_name = ?', [key]);
            if (exist.length === 0) {
                await db.execute('INSERT INTO system_configs (key_name, value, description) VALUES (?, ?, ?)', [key, val, desc]);
            }
        }

        // 9. Ensure borrow_requests table exists (Yêu cầu mượn online khi sách còn sẵn - Giữ chỗ trước 24h)
        await db.execute(`
            CREATE TABLE IF NOT EXISTS borrow_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                book_id INT NOT NULL,
                request_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NULL,
                status ENUM('pending', 'borrowed', 'cancelled', 'expired') DEFAULT 'pending',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
            )
        `);

        try {
            await db.execute(
                "ALTER TABLE borrow_requests MODIFY COLUMN status ENUM('pending', 'borrowed', 'cancelled', 'expired') DEFAULT 'pending'"
            );
        } catch (err) {}

        try {
            const [expCol] = await db.execute("SHOW COLUMNS FROM borrow_requests LIKE 'expires_at'");
            if (expCol.length === 0) {
                await db.execute("ALTER TABLE borrow_requests ADD COLUMN expires_at DATETIME NULL");
            }
        } catch (err) {}

        // 10. Ensure reservations table supports waitlist, notification and expiration columns
        try {
            await db.execute(
                "ALTER TABLE reservations MODIFY COLUMN status ENUM('waiting', 'pending', 'notified', 'ready', 'accepted', 'fulfilled', 'completed', 'cancelled', 'expired') DEFAULT 'waiting'"
            );
        } catch (err) {}

        try {
            const [notifiedCol] = await db.execute("SHOW COLUMNS FROM reservations LIKE 'notified_at'");
            if (notifiedCol.length === 0) {
                await db.execute("ALTER TABLE reservations ADD COLUMN notified_at DATETIME NULL");
            }
            const [expiresCol] = await db.execute("SHOW COLUMNS FROM reservations LIKE 'expires_at'");
            if (expiresCol.length === 0) {
                await db.execute("ALTER TABLE reservations ADD COLUMN expires_at DATETIME NULL");
            }
        } catch (err) {}

        // 11. Migrate any existing 'ready' reservations for available books into borrow_requests
        try {
            const [readyResvs] = await db.execute(`
                SELECT r.id, r.user_id, r.book_id, r.reservation_date
                FROM reservations r
                JOIN books b ON r.book_id = b.id
                WHERE r.status = 'ready' AND b.available_copies > 0
            `);
            for (const r of readyResvs) {
                // Check if already in borrow_requests
                const [exist] = await db.execute(
                    'SELECT id FROM borrow_requests WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [r.user_id, r.book_id]
                );
                if (exist.length === 0) {
                    await db.execute(
                        'INSERT INTO borrow_requests (user_id, book_id, request_date, status) VALUES (?, ?, ?, "pending")',
                        [r.user_id, r.book_id, r.reservation_date]
                    );
                }
                // Mark old reservation as migrated / completed
                await db.execute('UPDATE reservations SET status = "completed" WHERE id = ?', [r.id]);
            }
        } catch (err) {
            console.error('Error migrating ready reservations:', err.message);
        }

        // 12. Ensure user_preferences table exists for Smart Recommendation Engine
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,
                favorite_categories JSON NULL,
                favorite_authors JSON NULL,
                preferred_topics TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // 13. Ensure location column exists in books table (Phòng XX - Kệ YY - Ngăn ZZ)
        try {
            const [locCol] = await db.execute("SHOW COLUMNS FROM books LIKE 'location'");
            if (locCol.length === 0) {
                await db.execute("ALTER TABLE books ADD COLUMN location VARCHAR(100) DEFAULT 'Phòng 01 - Kệ 01 - Ngăn 01'");
            }
            // Backfill standard room locations for existing books if null or empty
            const [booksWithoutLoc] = await db.execute("SELECT id, category_id, title FROM books WHERE location IS NULL OR location = ''");
            for (const b of booksWithoutLoc) {
                const roomNum = ((b.category_id || b.id) % 3) + 1;
                const shelfNum = ((b.id * 2) % 6) + 1;
                const rackNum = ((b.id * 3) % 4) + 1;
                const locStr = `Phòng 0${roomNum} - Kệ 0${shelfNum} - Ngăn 0${rackNum}`;
                await db.execute("UPDATE books SET location = ? WHERE id = ?", [locStr, b.id]);
            }
        } catch (locErr) {
            console.error('⚠️ [INIT DB] Error setting up books location column:', locErr.message);
        }

        // 14. Ensure borrow_drafts and borrow_draft_items tables exist for Multi-Book Draft Transaction & QR Code
        await db.execute(`
            CREATE TABLE IF NOT EXISTS borrow_drafts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                draft_code VARCHAR(50) UNIQUE NOT NULL,
                user_id INT NOT NULL,
                status ENUM('pending', 'approved', 'cancelled', 'expired') DEFAULT 'pending',
                notes TEXT,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                approved_by INT NULL,
                approved_at DATETIME NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS borrow_draft_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                draft_id INT NOT NULL,
                book_id INT NOT NULL,
                book_copy_id INT NULL,
                status ENUM('pending', 'borrowed', 'unavailable') DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (draft_id) REFERENCES borrow_drafts(id) ON DELETE CASCADE,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
                FOREIGN KEY (book_copy_id) REFERENCES book_copies(id) ON DELETE SET NULL
            )
        `);

        // 15. Ensure Smart Book Drop columns, renewal_count & status in borrow_records
        try {
            await db.execute(
                "ALTER TABLE borrow_records MODIFY COLUMN status ENUM('borrowing', 'returned', 'overdue', 'returned_drop_box') DEFAULT 'borrowing'"
            );
        } catch (err) {}

        try {
            const [renewCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'renewal_count'");
            if (renewCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN renewal_count INT DEFAULT 0");
            }
        } catch (renewErr) {
            console.error('⚠️ [INIT DB] Error setting up renewal_count column:', renewErr.message);
        }

        try {
            const [dropBoxCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'is_drop_box'");
            if (dropBoxCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN is_drop_box TINYINT(1) DEFAULT 0");
            }
            const [dropBoxAtCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'drop_box_at'");
            if (dropBoxAtCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN drop_box_at DATETIME NULL");
            }
            const [dropBoxStatCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'drop_box_status'");
            if (dropBoxStatCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN drop_box_status ENUM('none', 'pending_audit', 'verified_intact', 'damaged', 'missing') DEFAULT 'none'");
            }
            const [dropBoxNoteCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'drop_box_audit_note'");
            if (dropBoxNoteCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN drop_box_audit_note TEXT NULL");
            }
            const [dropBoxAuditorCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'drop_box_audited_by'");
            if (dropBoxAuditorCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN drop_box_audited_by INT NULL");
            }
            const [dropBoxAuditedAtCol] = await db.execute("SHOW COLUMNS FROM borrow_records LIKE 'drop_box_audited_at'");
            if (dropBoxAuditedAtCol.length === 0) {
                await db.execute("ALTER TABLE borrow_records ADD COLUMN drop_box_audited_at DATETIME NULL");
            }
        } catch (dropBoxErr) {
            console.error('⚠️ [INIT DB] Error setting up drop box columns:', dropBoxErr.message);
        }

        // 16. Ensure exit_passes table exists for Physical Security & Loss Prevention
        await db.execute(`
            CREATE TABLE IF NOT EXISTS exit_passes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                pass_code VARCHAR(60) UNIQUE NOT NULL,
                user_id INT NOT NULL,
                book_count INT NOT NULL DEFAULT 1,
                items_summary JSON NULL,
                status ENUM('active', 'used', 'expired') DEFAULT 'active',
                expires_at DATETIME NOT NULL,
                verified_by INT NULL,
                verified_at DATETIME NULL,
                notes TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // 17. Ensure notification_dispatches table exists for Multi-channel Email/SMS tracking
        await db.execute(`
            CREATE TABLE IF NOT EXISTS notification_dispatches (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                recipient_email VARCHAR(120) NOT NULL,
                channel ENUM('email', 'zns_sms', 'in_app') DEFAULT 'email',
                template_type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content_preview TEXT NULL,
                status ENUM('sent', 'delivered', 'failed', 'simulated') DEFAULT 'sent',
                error_message TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        console.log('✅ [INIT DB] Smart Library 4.0 Suite Ready: Maker-Checker, VietQR, Smart Book Drop 24/7, Exit Passes & Multi-channel Notifications!');
    } catch (error) {
        console.error('⚠️ [INIT DB] Warning initializing owner/config tables:', error.message);
    }
}

module.exports = initOwnerAndConfigTables;

