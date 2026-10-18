const db = require('../config/db');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');
const { syncOverdueFines, calculateOverdue } = require('../services/fineSyncService');

// Helper to reliably find user by any representation of QR code / Card / ID / Email / Phone
const findUserByAnyCode = async (code) => {
    let raw = (code || '').toString().trim();
    if (!raw) return null;

    // 0. If explicitly a book code, reject immediately
    if (raw.startsWith('QR-BK-') || raw.startsWith('BK-') || raw.startsWith('BOOK-') || raw.startsWith('LIB-BK-') || raw.includes('-BK-')) {
        return null;
    }

    // 1. If JSON format
    if (raw.startsWith('{') && raw.endsWith('}')) {
        try {
            const p = JSON.parse(raw);
            raw = (p.cardNumber || p.card_number || p.ticketCode || p.ticket_code || p.ticketQrCode || p.code || p.qrCode || raw).toString().trim();
        } catch (e) {}
    }

    // Double check after JSON parsing
    if (raw.startsWith('QR-BK-') || raw.startsWith('BK-') || raw.startsWith('BOOK-') || raw.startsWith('LIB-BK-') || raw.includes('-BK-')) {
        return null;
    }

    // 2. Direct search by card_number, email, phone
    let [users] = await db.execute(
        'SELECT * FROM users WHERE card_number = ? OR email = ? OR phone = ?',
        [raw, raw, raw]
    );
    if (users.length > 0) return { user: users[0], targetResId: null, rawCode: raw };

    // 3. Pure numeric string -> search by id
    if (/^\d+$/.test(raw)) {
        [users] = await db.execute('SELECT * FROM users WHERE id = ?', [parseInt(raw, 10)]);
        if (users.length > 0) return { user: users[0], targetResId: null, rawCode: raw };
    }

    // 4. Ticket format: TICKET-RES-123, TICKET-123, RESV-123, RES-123
    const ticketMatch = raw.match(/^(?:TICKET-RES-|TICKET-|RESV-|RES-)(\d+)$/i);
    if (ticketMatch) {
        const resId = parseInt(ticketMatch[1], 10);
        const [resvs] = await db.execute('SELECT user_id, id FROM reservations WHERE id = ?', [resId]);
        if (resvs.length > 0) {
            [users] = await db.execute('SELECT * FROM users WHERE id = ?', [resvs[0].user_id]);
            if (users.length > 0) return { user: users[0], targetResId: resvs[0].id, rawCode: raw };
        }
    }

    // 5. Card number with prefix (LIB-RD-000005, LIB-RD-5, RD-5, USER-5, UID-5)
    const cardMatch = raw.match(/^(?:LIB-RD-|LIB-AD-|LIB-LB-|LIB-OW-|RD-|USER-|UID-)(\d+)$/i);
    if (cardMatch) {
        const uid = parseInt(cardMatch[1], 10);
        [users] = await db.execute('SELECT * FROM users WHERE id = ? OR card_number = ?', [uid, raw]);
        if (users.length > 0) {
            // Auto backfill card_number if missing
            if (!users[0].card_number) {
                await db.execute('UPDATE users SET card_number = ? WHERE id = ?', [raw, users[0].id]);
                users[0].card_number = raw;
            }
            return { user: users[0], targetResId: null, rawCode: raw };
        }
    }

    return null;
};

// Helper to validate complete library borrow policy
const checkBorrowEligibility = async (userId) => {
    // 1. Kiểm tra trạng thái tài khoản
    const [users] = await db.execute('SELECT id, full_name, card_number, email, status FROM users WHERE id = ?', [userId]);
    if (users.length === 0) return { allowed: false, message: 'Không tìm thấy thông tin tài khoản độc giả' };
    const user = users[0];
    if (user.status !== 'active') {
        return { allowed: false, message: `Tài khoản của độc giả "${user.full_name}" đang bị khóa hoặc chưa được kích hoạt` };
    }

    // 2. Kiểm tra nợ phí phạt (Unpaid fines)
    const [unpaidFines] = await db.execute('SELECT SUM(amount) as total_unpaid FROM fines WHERE user_id = ? AND status = "unpaid"', [userId]);
    const unpaidAmount = parseInt(unpaidFines[0]?.total_unpaid || 0);
    if (unpaidAmount > 0) {
        return {
            allowed: false,
            message: `Độc giả "${user.full_name}" hiện có khoản nợ phí phạt chưa thanh toán (${unpaidAmount.toLocaleString('vi-VN')}đ). Phải đóng phí phạt trước khi được mượn sách mới!`
        };
    }

    // 3. Kiểm tra sách mượn quá hạn (Overdue borrows)
    const todayStr = new Date().toISOString().slice(0, 10);
    const [overdueBorrows] = await db.execute(`
        SELECT COUNT(*) as overdue_count 
        FROM borrow_records 
        WHERE user_id = ? AND status = 'borrowing' AND due_date < ?
    `, [userId, todayStr]);
    const overdueCount = parseInt(overdueBorrows[0]?.overdue_count || 0);
    if (overdueCount > 0) {
        return {
            allowed: false,
            message: `Độc giả "${user.full_name}" hiện có ${overdueCount} cuốn sách mượn quá hạn chưa trả. Phải hoàn trả sách quá hạn trước khi được mượn thêm sách!`
        };
    }

    // 4. Kiểm tra giới hạn số lượng sách mượn tối đa (Mặc định: 5 cuốn)
    const [configs] = await db.execute('SELECT key_name, value FROM system_configs');
    const configMap = Object.fromEntries(configs.map(c => [c.key_name, c.value]));
    const maxBooks = parseInt(configMap['max_books_per_user'] || '5');
    const maxBorrowDays = parseInt(configMap['max_borrow_days'] || '14');

    const [activeBorrows] = await db.execute(
        'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ? AND status = "borrowing"',
        [userId]
    );
    const activeCount = parseInt(activeBorrows[0]?.count || 0);
    if (activeCount >= maxBooks) {
        return {
            allowed: false,
            message: `Giới hạn sách đang mượn: tối đa ${maxBooks} cuốn/độc giả. Độc giả đang giữ ${activeCount}/${maxBooks} cuốn (các sách đã mượn nhưng chưa trả vẫn tính vào hạn mức, bất kể ngày mượn). Vui lòng trả bớt sách trước khi mượn tiếp!`
        };
    }

    return { allowed: true, user, maxBooks, maxBorrowDays, activeCount };
};

// Cleanup expired borrow requests (Tự động hoàn lại sách sau 24h nếu độc giả không đến lấy)
const cleanupExpiredBorrowRequests = async () => {
    try {
        const [expiredRows] = await db.execute(`
            SELECT brq.id, brq.user_id, brq.book_id, b.title as book_title, u.full_name, u.card_number
            FROM borrow_requests brq
            JOIN books b ON brq.book_id = b.id
            JOIN users u ON brq.user_id = u.id
            WHERE brq.status = 'pending' AND brq.expires_at IS NOT NULL AND brq.expires_at < NOW()
        `);

        for (const reqItem of expiredRows) {
            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                await connection.execute('UPDATE borrow_requests SET status = "expired" WHERE id = ?', [reqItem.id]);
                await connection.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [reqItem.book_id]);

                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                    [
                        reqItem.user_id,
                        'Hết hạn giữ chỗ mượn sách online',
                        `Thời hạn giữ chỗ 24 giờ cho cuốn sách "${reqItem.book_title}" đã hết. Bản sao sách đã được đưa trở lại kho thư viện cho các bạn đọc khác.`
                    ]
                );

                await connection.commit();
            } catch (err) {
                await connection.rollback();
            } finally {
                connection.release();
            }
        }
    } catch (e) {
        console.error('Lỗi khi dọn dẹp yêu cầu mượn hết hạn:', e);
    }
};

exports.borrowBook = async (req, res) => {
    let { readerCardNumber, bookQrCode, ticketCode, qrCode } = req.body;
    const callerId = req.user.id;
    const callerRole = req.user.role;

    try {
        // If single unified qrCode is provided
        const singleCode = ticketCode || qrCode || readerCardNumber || bookQrCode;
        
        // -------------------------------------------------------------
        // CASE 1: 1-SCAN ONLINE TICKET QR (Format: TICKET-RES-123 or TICKET-123)
        // -------------------------------------------------------------
        if (typeof singleCode === 'string' && (singleCode.startsWith('TICKET-RES-') || singleCode.startsWith('TICKET-'))) {
            const resId = parseInt(singleCode.replace('TICKET-RES-', '').replace('TICKET-', ''));
            if (!resId) {
                return res.status(400).json({ message: 'Mã phiếu nhận sách không hợp lệ' });
            }

            const [reservations] = await db.execute(`
                SELECT r.*, u.id as u_id, u.full_name, u.card_number, u.status as user_status,
                       b.id as book_id, b.title, b.available_copies
                FROM reservations r
                JOIN users u ON r.user_id = u.id
                JOIN books b ON r.book_id = b.id
                WHERE r.id = ?
            `, [resId]);

            if (reservations.length === 0) {
                return res.status(404).json({ message: 'Không tìm thấy phiếu đặt mượn sách này' });
            }
            const resv = reservations[0];

            if (resv.status === 'completed' || resv.status === 'fulfilled') {
                return res.status(400).json({ message: 'Phiếu mượn này đã được xử lý nhận sách trước đó' });
            }
            if (resv.status === 'cancelled') {
                return res.status(400).json({ message: 'Phiếu mượn này đã bị hủy' });
            }

            // Kiểm tra quy chế mượn (Eligibility)
            const eligibility = await checkBorrowEligibility(resv.u_id);
            if (!eligibility.allowed) {
                return res.status(400).json({ message: eligibility.message });
            }

            // Find an available copy for this book
            const [availableCopies] = await db.execute(
                'SELECT * FROM book_copies WHERE book_id = ? AND status = "available" LIMIT 1',
                [resv.book_id]
            );

            if (availableCopies.length === 0) {
                return res.status(400).json({ message: `Đầu sách "${resv.title}" hiện tại không còn bản sao nào sẵn có trong kho` });
            }
            const copy = availableCopies[0];
            const maxBorrowDays = eligibility.maxBorrowDays;

            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + maxBorrowDays);

            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                // Create borrow record
                await connection.execute(
                    'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                    [resv.u_id, copy.id, dueDate.toISOString().slice(0, 10), callerId]
                );

                // Update copy status
                await connection.execute(
                    'UPDATE book_copies SET status = "borrowed" WHERE id = ?',
                    [copy.id]
                );

                // Update book available count
                await connection.execute(
                    'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                    [resv.book_id]
                );

                // Update reservation to completed
                await connection.execute(
                    'UPDATE reservations SET status = "completed" WHERE id = ?',
                    [resv.id]
                );
                // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [resv.u_id, resv.book_id]
                );
                await connection.execute(
                    'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                    [resv.u_id, resv.book_id]
                );

                // Log activity
                await connection.execute(
                    'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                    [callerId, 'BORROW', 'borrow_records', copy.id, `Xử lý phiếu QR Online #${resv.id}: Độc giả ${resv.full_name} nhận sách ${resv.title}`]
                );

                // Notify reader
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        resv.u_id,
                        'Đã nhận sách tại quầy',
                        `Bạn đã nhận thành công cuốn sách "${resv.title}" (Mã bản sao: ${copy.qr_code}). Hạn trả sách: ${dueDate.toLocaleDateString('vi-VN')}. Vui lòng hoàn trả đúng hạn.`
                    ]
                );

                // Notify all staff (Librarian, Admin, Owner)
                await notifyAllStaff(
                    'Độc giả nhận sách qua mã QR',
                    `Độc giả ${resv.full_name} (${resv.card_number || 'ID: #' + resv.u_id}) vừa nhận cuốn "${resv.title}" (Mã bản sao: ${copy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                    'info'
                );

                await connection.commit();
                return res.status(200).json({
                    message: `Xác nhận trao sách thành công cho độc giả ${resv.full_name}!`,
                    data: {
                        readerName: resv.full_name,
                        cardNumber: resv.card_number,
                        bookTitle: resv.title,
                        copyQr: copy.qr_code,
                        dueDate: dueDate.toLocaleDateString('vi-VN')
                    }
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // -------------------------------------------------------------
        // CASE 2: SELF-SERVICE CHECK-OUT (Reader scans book copy QR himself)
        // -------------------------------------------------------------
        if (callerRole === 'reader') {
            const targetQr = bookQrCode || singleCode;
            if (!targetQr) {
                return res.status(400).json({ message: 'Vui lòng quét mã QR trên cuốn sách để tự mượn' });
            }

            // Kiểm tra quy chế mượn (Eligibility)
            const eligibility = await checkBorrowEligibility(callerId);
            if (!eligibility.allowed) {
                return res.status(400).json({ message: eligibility.message });
            }
            const user = eligibility.user;
            const maxBorrowDays = eligibility.maxBorrowDays;

            // Find book copy
            const [copies] = await db.execute(
                'SELECT bc.*, b.title, b.id as book_real_id, b.available_copies FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
                [targetQr]
            );
            if (copies.length === 0) {
                return res.status(404).json({ message: 'Không tìm thấy mã sách này trong hệ thống' });
            }
            const copy = copies[0];

            if (copy.status !== 'available') {
                return res.status(400).json({ message: `Bản sao sách này hiện tại không khả dụng (Trạng thái: ${copy.status})` });
            }

            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + maxBorrowDays);

            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                await connection.execute(
                    'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                    [user.id, copy.id, dueDate.toISOString().slice(0, 10), user.id]
                );

                await connection.execute(
                    'UPDATE book_copies SET status = "borrowed" WHERE id = ?',
                    [copy.id]
                );

                await connection.execute(
                    'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                    [copy.book_real_id]
                );

                // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [user.id, copy.book_real_id]
                );
                await connection.execute(
                    'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                    [user.id, copy.book_real_id]
                );

                await connection.execute(
                    'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                    [user.id, 'BORROW', 'borrow_records', copy.id, `Độc giả tự quét mượn sách: ${copy.title}`]
                );

                // Notify reader
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        user.id,
                        'Tự mượn sách thành công',
                        `Bạn đã mượn thành công cuốn sách "${copy.title}" (Mã: ${copy.qr_code}). Hạn trả sách: ${dueDate.toLocaleDateString('vi-VN')}. Chúc bạn đọc sách vui vẻ!`
                    ]
                );

                // Notify all staff
                await notifyAllStaff(
                    'Độc giả tự mượn sách qua QR',
                    `Độc giả ${user.full_name} (${user.card_number || 'ID: #' + user.id}) vừa tự quét mượn cuốn "${copy.title}" (Mã: ${copy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                    'info',
                    user.id
                );

                await connection.commit();
                return res.status(200).json({
                    message: `Bạn đã mượn thành công cuốn sách "${copy.title}"!`,
                    data: {
                        readerName: user.full_name,
                        bookTitle: copy.title,
                        dueDate: dueDate.toLocaleDateString('vi-VN'),
                    }
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // -------------------------------------------------------------
        // CASE 3: TRADITIONAL DESK CHECK-OUT (Librarian/Admin scans Reader Card + Book QR)
        // -------------------------------------------------------------
        if (!readerCardNumber || !bookQrCode) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã thẻ độc giả và mã QR sách' });
        }

        // 1. Check user by card_number, ID, email, or prefix
        const foundData = await findUserByAnyCode(readerCardNumber);
        if (!foundData || !foundData.user) {
            return res.status(404).json({ message: `Không tìm thấy thẻ độc giả với mã [${readerCardNumber}]` });
        }
        const user = foundData.user;

        // 2. Kiểm tra quy chế mượn (Eligibility)
        const eligibility = await checkBorrowEligibility(user.id);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }
        const maxBorrowDays = eligibility.maxBorrowDays;

        // 3. Find book copy by QR code
        const [copies] = await db.execute(
            'SELECT bc.*, b.title, b.id as book_real_id, b.available_copies FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [bookQrCode]
        );
        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy mã sách này trong hệ thống' });
        }
        const copy = copies[0];

        if (copy.status !== 'available') {
            return res.status(400).json({ message: `Bản sao sách này hiện tại không khả dụng (Trạng thái: ${copy.status})` });
        }

        // KIỂM TRA ĐẦU SÁCH CÓ ĐANG BỊ GIỮ CHỖ ONLINE 24H KHÔNG:
        await cleanupExpiredBorrowRequests();

        const [activeHolds] = await db.execute(`
            SELECT brq.id as request_id, brq.user_id, brq.request_date, brq.expires_at,
                   TIMESTAMPDIFF(HOUR, NOW(), brq.expires_at) as time_left_hours,
                   u.full_name as reader_name, u.card_number, u.phone as reader_phone
            FROM borrow_requests brq
            JOIN users u ON brq.user_id = u.id
            WHERE brq.book_id = ? AND brq.status = 'pending' AND (brq.expires_at IS NULL OR brq.expires_at > NOW())
            ORDER BY brq.request_date ASC
        `, [copy.book_real_id]);

        const userHoldIndex = activeHolds.findIndex(h => h.user_id === user.id);
        const isCurrentUserHolding = userHoldIndex !== -1;

        if (activeHolds.length > 0 && !isCurrentUserHolding) {
            // Đếm số bản sao available hiện có trên kệ
            const [availCountRows] = await db.execute(
                'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
                [copy.book_real_id]
            );
            const availCount = availCountRows[0]?.count || 0;

            if (availCount <= activeHolds.length) {
                // Toàn bộ bản sao trên kệ hiện đã có người giữ chỗ trước!
                return res.status(400).json({
                    message: `Cuốn sách "${copy.title}" hiện đã có ${activeHolds.length} bạn đọc đăng ký giữ chỗ online 24h trước đó! Toàn bộ bản sao trên kệ hiện đã có chủ giữ chỗ chờ đến lấy.`,
                    isHeld: true,
                    holdCount: activeHolds.length,
                    holds: activeHolds,
                    bookTitle: copy.title
                });
            }
        }

        // 4. Calculate due date
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);

        // Start transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Create borrow record
            await connection.execute(
                'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                [user.id, copy.id, dueDate.toISOString().slice(0, 10), callerId]
            );

            // Update book copy status
            await connection.execute(
                'UPDATE book_copies SET status = "borrowed" WHERE id = ?',
                [copy.id]
            );

            // Nếu chính độc giả này đã giữ chỗ trước đó: hoàn tất yêu cầu mượn đó (không trừ thêm available_copies vì lúc đăng ký đã trừ)
            if (isCurrentUserHolding) {
                const userHold = activeHolds[userHoldIndex];
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE id = ?',
                    [userHold.request_id]
                );
            } else {
                // Trừ số lượng bản sao khả dụng nếu là mượn trực tiếp tự do
                await connection.execute(
                    'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                    [copy.book_real_id]
                );
            }

            // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
            await connection.execute(
                'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                [user.id, copy.book_real_id]
            );
            await connection.execute(
                'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                [user.id, copy.book_real_id]
            );

            // Save log
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [callerId, 'BORROW', 'borrow_records', copy.id, `Mượn sách: ${copy.title} cho độc giả: ${user.full_name}`]
            );

            // Notify reader
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    user.id,
                    'Xác nhận mượn sách tại quầy',
                    `Thủ thư đã xác nhận cho bạn mượn cuốn sách "${copy.title}" (Mã: ${copy.qr_code}). Hạn hoàn trả: ${dueDate.toLocaleDateString('vi-VN')}.`
                ]
            );

            // Notify all staff
            await notifyAllStaff(
                'Độc giả mượn sách tại quầy',
                `Độc giả ${user.full_name} (${user.card_number || 'ID: #' + user.id}) vừa mượn cuốn "${copy.title}" (Mã bản sao: ${copy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                'info'
            );

            await connection.commit();
            res.status(200).json({
                message: 'Đã xác nhận cho mượn sách thành công!',
                data: {
                    readerName: user.full_name,
                    bookTitle: copy.title,
                    dueDate: dueDate.toLocaleDateString('vi-VN'),
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi mượn sách:', error);
        res.status(500).json({ message: 'Lỗi server khi mượn sách' });
    }
};

exports.returnBook = async (req, res) => {
    let { bookQrCode, qrCode, copyQr, readerCardNumber, borrowRecordId, confirmPaidFine, paymentMethod, paymentChannel, transactionRef } = req.body;
    const processedBy = req.user.id;

    try {
        let targetQr = (bookQrCode || qrCode || copyQr || '').toString().trim();
        if (targetQr.startsWith('{') && targetQr.endsWith('}')) {
            try {
                const parsed = JSON.parse(targetQr);
                targetQr = (parsed.bookQrCode || parsed.qrCode || parsed.copyQr || parsed.code || targetQr).toString().trim();
            } catch (e) {}
        }

        if (!targetQr) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR sách để trả' });
        }

        // Check if caller passed a reader card code instead of book QR
        const foundReader = await findUserByAnyCode(targetQr);
        if (foundReader && foundReader.user && !targetQr.startsWith('QR-BK-') && !targetQr.startsWith('BK-') && !targetQr.startsWith('BOOK-')) {
            const [userBorrows] = await db.execute(`
                SELECT br.id, br.book_copy_id, bc.qr_code, b.title
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.user_id = ? AND br.status = 'borrowing'
            `, [foundReader.user.id]);

            if (userBorrows.length === 0) {
                return res.status(400).json({
                    message: `[${targetQr}] là mã thẻ của độc giả "${foundReader.user.full_name}", hiện tại độc giả này không có sách nào đang mượn.`
                });
            }
            if (userBorrows.length === 1) {
                // If only 1 book borrowed, intelligently use that copy's QR code
                targetQr = userBorrows[0].qr_code;
            } else {
                return res.status(400).json({
                    message: `[${targetQr}] là mã thẻ độc giả "${foundReader.user.full_name}" (đang mượn ${userBorrows.length} cuốn). Vui lòng chọn cuốn cụ thể cần trả từ danh sách.`
                });
            }
        }

        // 1. Find book copy
        const [copies] = await db.execute(
            'SELECT bc.*, b.title, b.id as book_real_id FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [targetQr]
        );
        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản sao sách này' });
        }
        const copy = copies[0];

        if (copy.status !== 'borrowed') {
            return res.status(400).json({ message: 'Bản sao sách này hiện không ở trạng thái đang được mượn' });
        }

        // 2. Find active borrow record
        let recordQuery = 'SELECT br.*, u.full_name, u.email, u.card_number, u.id as u_id FROM borrow_records br JOIN users u ON br.user_id = u.id WHERE br.book_copy_id = ? AND br.status = "borrowing"';
        const queryParams = [copy.id];
        if (borrowRecordId) {
            recordQuery += ' AND br.id = ?';
            queryParams.push(borrowRecordId);
        }
        const [records] = await db.execute(recordQuery, queryParams);
        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn hoạt động cho bản sao sách này' });
        }
        const record = records[0];

        // 2.1. Strict Reader Verification if readerCardNumber provided
        if (readerCardNumber) {
            const rawReaderCode = readerCardNumber.toString().trim();
            const verifiedReader = await findUserByAnyCode(rawReaderCode);
            if (verifiedReader && verifiedReader.user) {
                if (verifiedReader.user.id !== record.u_id) {
                    return res.status(400).json({
                        message: `SAI ĐỘC GIẢ: Thẻ vừa xác thực là của độc giả "${verifiedReader.user.full_name}" (${verifiedReader.user.card_number || rawReaderCode}), KHÔNG PHẢI độc giả "${record.full_name}" (${record.card_number}) đã mượn cuốn «${copy.title}»!`
                    });
                }
            }
        }

        // Get fine config
        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');
        const { overdueDays, fineAmount } = calculateOverdue(record.due_date, finePerDay);

        // Check if fine was already paid previously (e.g. reader paid online via VietQR beforehand)
        const [existingFines] = await db.execute(
            'SELECT * FROM fines WHERE borrow_record_id = ? ORDER BY id DESC LIMIT 1',
            [record.id]
        );
        const hasExistingPaidFine = existingFines.length > 0 && existingFines[0].status === 'paid';

        // Strict Enforcement: Overdue books CANNOT be returned unless fine is paid/collected OR already paid online
        if (overdueDays > 0 && !hasExistingPaidFine && !confirmPaidFine) {
            return res.status(400).json({
                message: `Sách "${copy.title}" đã bị quá hạn ${overdueDays} ngày (Hạn trả: ${new Date(record.due_date).toLocaleDateString('vi-VN')}). Phí phạt: ${fineAmount.toLocaleString('vi-VN')}đ. Độc giả phải đóng phí phạt mới được phép trả sách!`,
                requiresFinePayment: true,
                overdueDays,
                fineAmount,
                bookTitle: copy.title,
                readerName: record.full_name,
                cardNumber: record.card_number,
                copyQr: copy.qr_code,
                borrowRecordId: record.id
            });
        }

        // Start transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Update borrow record
            await connection.execute(
                'UPDATE borrow_records SET return_date = NOW(), status = "returned" WHERE id = ?',
                [record.id]
            );

            // Update copy status
            await connection.execute(
                'UPDATE book_copies SET status = "available" WHERE id = ?',
                [copy.id]
            );

            // Increment book available count
            await connection.execute(
                'UPDATE books SET available_copies = available_copies + 1 WHERE id = ?',
                [copy.book_real_id]
            );

            const finalMethod = paymentMethod === 'transfer' ? 'transfer' : 'cash';
            const finalChannel = paymentChannel === 'online' ? 'online' : 'counter';
            const finalRef = transactionRef || (finalMethod === 'transfer' ? `TXN-RET-${record.id}-${Date.now().toString().slice(-6)}` : null);

            // If there's fine and it wasn't already paid, record fine as paid
            if (fineAmount > 0 && !hasExistingPaidFine) {
                if (existingFines.length > 0) {
                    await connection.execute(
                        'UPDATE fines SET amount = ?, reason = ?, status = "paid", paid_at = NOW(), payment_method = ?, payment_channel = ?, transaction_ref = ? WHERE borrow_record_id = ? AND status = "unpaid"',
                        [
                            fineAmount,
                            `Trả trễ hạn ${overdueDays} ngày (Hạn trả: ${new Date(record.due_date).toLocaleDateString('vi-VN')})`,
                            finalMethod,
                            finalChannel,
                            finalRef,
                            record.id
                        ]
                    );
                } else {
                    await connection.execute(
                        'INSERT INTO fines (borrow_record_id, user_id, amount, reason, status, paid_at, payment_method, payment_channel, transaction_ref) VALUES (?, ?, ?, ?, "paid", NOW(), ?, ?, ?)',
                        [
                            record.id,
                            record.u_id,
                            fineAmount,
                            `Trả trễ hạn ${overdueDays} ngày (Hạn trả: ${new Date(record.due_date).toLocaleDateString('vi-VN')})`,
                            finalMethod,
                            finalChannel,
                            finalRef
                        ]
                    );
                }
            } else if (fineAmount === 0) {
                // Sách trả đúng hạn hoặc không quá hạn: nếu có bản ghi phạt unpaid nào gắn với record này (do lỗi sync trước đó) -> xóa bỏ ngay
                await connection.execute(
                    'DELETE FROM fines WHERE borrow_record_id = ? AND status = "unpaid"',
                    [record.id]
                );
            }

            const methodDesc = hasExistingPaidFine 
                ? 'Đã nộp trước qua Chuyển khoản online' 
                : (finalMethod === 'transfer' ? 'Chuyển khoản VietQR tại quầy' : 'Tiền mặt tại quầy');

            // Save log
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'RETURN', 'borrow_records', record.id, `Trả sách: ${copy.title}. Độc giả: ${record.full_name}. ${overdueDays > 0 ? `Phí phạt trễ hạn ${overdueDays} ngày: ${fineAmount.toLocaleString('vi-VN')}đ [Hình thức: ${methodDesc}]` : 'Trả đúng hạn'}`]
            );

            // Notify reader
            if (overdueDays > 0) {
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                    [
                        record.u_id,
                        'Hoàn tất trả sách & nộp phạt trễ hạn',
                        `Bạn đã hoàn tất trả cuốn sách "${copy.title}". Phí phạt trễ hạn: ${fineAmount.toLocaleString('vi-VN')}đ (${overdueDays} ngày) [${methodDesc}].`
                    ]
                );
            } else {
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        record.u_id,
                        'Hoàn tất trả sách thành công',
                        `Cảm ơn bạn đã hoàn trả đúng hạn cuốn sách "${copy.title}" vào kho thư viện!`
                    ]
                );
            }

            // Notify all staff (Librarians, Admin, Owner)
            await notifyAllStaff(
                'Độc giả hoàn trả sách',
                `Độc giả ${record.full_name} (${record.card_number}) vừa hoàn trả cuốn "${copy.title}". ${overdueDays > 0 ? `Phí phạt trễ hạn: ${fineAmount.toLocaleString('vi-VN')}đ (${overdueDays} ngày) - ${methodDesc}.` : 'Trả đúng hạn.'}`,
                overdueDays > 0 ? 'warning' : 'info'
            );

            // Check if any reader is waiting for this book in reservations
            const [pendingReservations] = await connection.execute(
                'SELECT r.id, r.user_id, b.title, u.full_name, u.card_number FROM reservations r JOIN books b ON r.book_id = b.id JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                [copy.book_real_id]
            );
            if (pendingReservations.length > 0) {
                const nextRes = pendingReservations[0];
                // Cập nhật trạng thái phiếu đặt trước -> 'notified' (giữ sách 48h và gửi thông báo hỏi độc giả có muốn mượn không)
                await connection.execute(
                    'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                    [nextRes.id]
                );

                // Giữ riêng cuốn sách này cho độc giả đặt trước, không tăng available_copies công khai
                await connection.execute(
                    'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                    [copy.book_real_id]
                );

                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                    [
                        nextRes.user_id,
                        '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                        `Cuốn sách "${nextRes.title}" bạn đặt trước vừa được hoàn trả về thư viện! Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Bạn có muốn mượn cuốn sách này không? Hãy vào mục "Đặt trước sách" để xác nhận mượn hoặc hủy nhường cho bạn đọc khác nhé.`
                    ]
                );

                // Also notify librarians that reserved book is held for next reader
                await notifyRoles(
                    ['librarian', 'admin'],
                    'Sách đặt trước đã có mặt - Đang đợi độc giả xác nhận',
                    `Sách "${nextRes.title}" vừa trả về kho đã được giữ chỗ 48h và gửi thông báo mời mượn cho độc giả ${nextRes.full_name} (${nextRes.card_number}) trong hàng đợi.`,
                    'reminder'
                );
            }

            await connection.commit();

            res.status(200).json({
                message: overdueDays > 0 
                    ? `Đã thu phí phạt ${fineAmount.toLocaleString('vi-VN')}đ và nhận trả sách "${copy.title}" thành công!` 
                    : `Đã nhận trả sách "${copy.title}" thành công vào kho!`,
                data: {
                    readerName: record.full_name,
                    bookTitle: copy.title,
                    overdueDays,
                    fineAmount,
                    finePaid: overdueDays > 0
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi trả sách:', error);
        res.status(500).json({ message: 'Lỗi server khi trả sách' });
    }
};

exports.getBorrowRecords = async (req, res) => {
    const { role, id } = req.user;

    try {
        // Sync overdue fines in real-time before fetching records
        await syncOverdueFines(role === 'reader' ? id : null);

        let query = `
            SELECT br.id, br.user_id as user_id, br.borrow_date, br.due_date, br.return_date, br.status, br.renewal_count,
                   u.full_name as reader_name, u.card_number, u.phone as reader_phone,
                   b.title as book_title, b.cover_image, bc.qr_code,
                   p.full_name as processed_by_name,
                   f.id as fine_id, f.status as fine_status, f.amount as fine_amount,
                   f.payment_method as fine_payment_method, f.payment_channel as fine_payment_channel,
                   f.paid_at as fine_paid_at
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN users p ON br.processed_by = p.id
            LEFT JOIN fines f ON f.borrow_record_id = br.id
        `;
        
        const params = [];
        if (role === 'reader') {
            query += ' WHERE br.user_id = ?';
            params.push(id);
        }
        
        query += ' ORDER BY br.borrow_date DESC LIMIT 100';

        const [records] = await db.execute(query, params);
        const formatted = records.map(r => {
            const { overdueDays, fineAmount } = calculateOverdue(r.due_date);
            return {
                ...r,
                overdue_days: overdueDays,
                fine_amount: r.fine_amount ? Number(r.fine_amount) : fineAmount,
                fine_already_paid: r.fine_status === 'paid'
            };
        });
        res.status(200).json(formatted);
    } catch (error) {
        console.error('Lỗi khi lấy lịch sử mượn trả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.renewBook = async (req, res) => {
    const { borrowRecordId } = req.body;
    const userId = req.user.id;

    try {
        if (!borrowRecordId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã phiếu mượn' });
        }

        const [records] = await db.execute(`
            SELECT br.*, b.id as book_real_id, b.title, u.full_name, u.card_number
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.id = ?
        `, [borrowRecordId]);

        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
        }
        const record = records[0];

        if (req.user.role === 'reader' && record.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn chỉ có quyền gia hạn phiếu mượn của chính mình' });
        }

        if (record.status !== 'borrowing') {
            return res.status(400).json({ message: 'Chỉ có thể gia hạn phiếu mượn đang trong trạng thái mượn' });
        }

        // Quy tắc 1: Kiểm tra quá hạn
        const today = new Date();
        const dueDate = new Date(record.due_date);
        if (today > dueDate) {
            return res.status(400).json({ 
                message: 'Cuốn sách này đã quá hạn hoàn trả, không thể gia hạn. Vui lòng mang sách trả tại quầy và nộp phạt nếu có!' 
            });
        }

        // Quy tắc 2: Tối đa 1 lần gia hạn / 7 ngày
        const renewalCount = parseInt(record.renewal_count || 0);
        if (renewalCount >= 1) {
            return res.status(400).json({ 
                message: 'Mỗi lượt mượn chỉ được gia hạn tối đa 1 lần (+7 ngày). Bạn đã sử dụng lượt gia hạn cho cuốn sách này rồi!' 
            });
        }

        // Quy tắc 3: Kiểm tra hàng đợi đặt trước từ độc giả khác
        const [waitingReservations] = await db.execute(
            'SELECT id, user_id FROM reservations WHERE book_id = ? AND status IN ("pending", "ready") AND user_id != ?',
            [record.book_real_id, record.user_id]
        );
        if (waitingReservations.length > 0) {
            return res.status(400).json({ 
                message: `Không thể gia hạn cuốn "${record.title}" do hiện tại đang có độc giả khác đặt trước trong hàng đợi. Vui lòng hoàn trả sách đúng hạn!` 
            });
        }

        // Add 7 days to current due date
        const newDueDate = new Date(dueDate);
        newDueDate.setDate(newDueDate.getDate() + 7);

        await db.execute('UPDATE borrow_records SET due_date = ?, renewal_count = renewal_count + 1 WHERE id = ?', [
            newDueDate.toISOString().slice(0, 10),
            borrowRecordId
        ]);

        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId, 'RENEW', 'borrow_records', borrowRecordId, `Gia hạn mượn sách "${record.title}" thêm 7 ngày (Lượt 1/1 - Hạn mới: ${newDueDate.toLocaleDateString('vi-VN')})`]
        );

        // Notify reader
        await db.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
            [
                record.user_id,
                'Gia hạn mượn sách thành công',
                `Cuốn sách "${record.title}" đã được gia hạn thêm 7 ngày (Lượt 1/1). Hạn trả mới: ${newDueDate.toLocaleDateString('vi-VN')}.`
            ]
        );

        // Notify all staff
        await notifyAllStaff(
            'Độc giả gia hạn mượn sách',
            `Độc giả ${record.full_name} (${record.card_number || 'ID: #' + record.user_id}) vừa gia hạn mượn cuốn "${record.title}" thêm 7 ngày (Hạn mới: ${newDueDate.toLocaleDateString('vi-VN')}).`,
            'info'
        );

        res.status(200).json({
            message: 'Gia hạn sách thành công thêm 7 ngày (1/1)!',
            newDueDate: newDueDate.toLocaleDateString('vi-VN'),
            renewalCount: renewalCount + 1
        });
    } catch (error) {
        console.error('Lỗi khi gia hạn sách:', error);
        res.status(500).json({ message: 'Lỗi server khi gia hạn sách' });
    }
};

// GET /api/borrow/reader-checkout-info/:cardNumber
exports.getReaderCheckoutInfo = async (req, res) => {
    let { cardNumber } = req.params;
    try {
        let rawCode = decodeURIComponent(cardNumber || '').trim();
        if (!rawCode) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã thẻ hoặc mã QR để tra cứu' });
        }

        // 1. If rawCode is a book code format, reject immediately with a clear error
        if (rawCode.startsWith('QR-BK-') || rawCode.startsWith('BK-') || rawCode.startsWith('BOOK-') || rawCode.startsWith('LIB-BK-') || rawCode.includes('-BK-')) {
            const [copies] = await db.execute(`
                SELECT bc.*, b.title
                FROM book_copies bc
                JOIN books b ON bc.book_id = b.id
                WHERE bc.qr_code = ?
            `, [rawCode]);

            const bookDetail = copies.length > 0 ? `cuốn sách "${copies[0].title}"` : 'sách';
            return res.status(400).json({
                message: `Mã [${rawCode}] là mã định danh ${bookDetail}, không phải mã thẻ độc giả. Quầy tiếp nhận chỉ tra cứu thẻ độc giả, vui lòng nhập đúng mã thẻ (VD: LIB-RD-000003)!`
            });
        }

        // 2. Check if user can be found via any format
        const found = await findUserByAnyCode(rawCode);
        let user = found?.user || null;
        let targetReservationId = found?.targetResId || null;

        if (!user) {
            return res.status(404).json({ message: `Không tìm thấy thông tin độc giả với mã [${rawCode}]. Vui lòng kiểm tra lại!` });
        }

        // Sync overdue fines in real-time for this user
        await syncOverdueFines(user.id);

        // Get fine per day config
        const [configs] = await db.execute('SELECT key_name, value FROM system_configs');
        const configMap = Object.fromEntries(configs.map(c => [c.key_name, c.value]));
        const finePerDay = parseInt(configMap['fine_per_day'] || '5000');
        const maxBooks = parseInt(configMap['max_books_per_user'] || '5');
        const maxBorrowDays = parseInt(configMap['max_borrow_days'] || '14');

        await cleanupExpiredBorrowRequests();

        // 0. Tự động đồng bộ dọn dẹp: Nếu độc giả đang thực sự giữ cuốn sách nào (status='borrowing'),
        // thì toàn bộ yêu cầu giữ chỗ online ('pending') hoặc đặt trước ('accepted', 'ready', 'pending')
        // của đầu sách đó phải được cập nhật hoàn tất ngay lập tức
        await db.execute(`
            UPDATE borrow_requests brq
            JOIN book_copies bc ON bc.book_id = brq.book_id
            JOIN borrow_records br ON br.book_copy_id = bc.id AND br.user_id = brq.user_id AND br.status = 'borrowing'
            SET brq.status = 'borrowed'
            WHERE brq.user_id = ? AND brq.status = 'pending'
        `, [user.id]);

        await db.execute(`
            UPDATE reservations r
            JOIN book_copies bc ON bc.book_id = r.book_id
            JOIN borrow_records br ON br.book_copy_id = bc.id AND br.user_id = r.user_id AND br.status = 'borrowing'
            SET r.status = 'completed'
            WHERE r.user_id = ? AND r.status IN ('pending', 'accepted', 'ready')
        `, [user.id]);

        // 1. Get pending online borrow requests (Sách độc giả đăng ký mượn trước khi đến thư viện - Giữ chỗ 24h)
        // Loại trừ những đầu sách mà độc giả đã đang mượn
        const [borrowRequests] = await db.execute(`
            SELECT brq.id as request_id, brq.id as reservation_id, brq.request_date, brq.expires_at, brq.status as request_status,
                   IFNULL(TIMESTAMPDIFF(HOUR, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 24) as time_left_hours,
                   IFNULL(TIMESTAMPDIFF(MINUTE, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 1440) as time_left_minutes,
                   'borrow_request' as item_type,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image, b.available_copies
            FROM borrow_requests brq
            JOIN books b ON brq.book_id = b.id
            WHERE brq.user_id = ? AND brq.status = 'pending'
              AND brq.book_id NOT IN (
                  SELECT bc2.book_id 
                  FROM borrow_records br2 
                  JOIN book_copies bc2 ON br2.book_copy_id = bc2.id 
                  WHERE br2.user_id = ? AND br2.status = 'borrowing'
              )
            ORDER BY brq.request_date DESC
        `, [user.id, user.id]);

        // 2. Get accepted/ready reservations (Sách đặt trước độc giả đã xác nhận mượn, đang giữ tại quầy)
        // Loại trừ những đầu sách mà độc giả đã đang mượn
        const [readyReservations] = await db.execute(`
            SELECT r.id as reservation_id, r.id as request_id, r.reservation_date, r.status as reservation_status,
                   'reservation' as item_type,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image, b.available_copies
            FROM reservations r
            JOIN books b ON r.book_id = b.id
            WHERE r.user_id = ? AND r.status IN ('accepted', 'ready')
              AND r.book_id NOT IN (
                  SELECT bc2.book_id 
                  FROM borrow_records br2 
                  JOIN book_copies bc2 ON br2.book_copy_id = bc2.id 
                  WHERE br2.user_id = ? AND br2.status = 'borrowing'
              )
            ORDER BY r.reservation_date DESC
        `, [user.id, user.id]);

        // Combined for backwards compatibility
        const pendingRequests = [...borrowRequests, ...readyReservations];

        // Get active borrows with fine status
        const [activeBorrows] = await db.execute(`
            SELECT br.id, br.borrow_date, br.due_date, br.renewal_count, b.title as book_title, b.cover_image, b.id as book_id,
                   bc.qr_code, GREATEST(0, DATEDIFF(CURDATE(), br.due_date)) as overdue_days,
                   f.id as paid_fine_id, f.status as fine_status, f.payment_method as fine_payment_method,
                   f.payment_channel as fine_payment_channel, f.paid_at as fine_paid_at, f.amount as fine_paid_amount
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN fines f ON f.borrow_record_id = br.id AND f.status = 'paid'
            WHERE br.user_id = ? AND br.status = 'borrowing'
            ORDER BY br.due_date ASC
        `, [user.id]);

        // Calculate fine amounts for active overdue loans
        const enrichedActiveBorrows = activeBorrows.map(loan => {
            const isAlreadyPaid = Boolean(loan.paid_fine_id && loan.fine_status === 'paid');
            const { overdueDays, fineAmount } = calculateOverdue(loan.due_date, finePerDay);
            return {
                ...loan,
                overdue_days: overdueDays,
                fine_amount: fineAmount,
                renewal_count: Number(loan.renewal_count) || 0,
                fine_already_paid: isAlreadyPaid,
                fine_paid_amount: Number(loan.fine_paid_amount) || 0,
                fine_payment_method: loan.fine_payment_method || null,
                fine_payment_channel: loan.fine_payment_channel || null,
                fine_paid_at: loan.fine_paid_at || null
            };
        });

        // Get unpaid fines history for this user
        const [unpaidFines] = await db.execute(`
            SELECT f.id, f.amount, f.reason, f.status, f.created_at, b.title as book_title, bc.qr_code as book_copy_qr
            FROM fines f
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
            WHERE f.user_id = ? AND f.status = 'unpaid'
            ORDER BY f.created_at DESC
        `, [user.id]);

        const totalUnpaidFines = unpaidFines.reduce((sum, f) => sum + Number(f.amount), 0);

        // Monthly borrow count (in current month)
        const [monthlyBorrows] = await db.execute(`
            SELECT COUNT(*) as count 
            FROM borrow_records 
            WHERE user_id = ? AND MONTH(borrow_date) = MONTH(CURDATE()) AND YEAR(borrow_date) = YEAR(CURDATE())
        `, [user.id]);
        const monthlyBorrowCount = parseInt(monthlyBorrows[0]?.count || 0);

        // Overdue count
        const overdueLoansCount = enrichedActiveBorrows.filter(b => b.overdue_days > 0).length;

        // Policy borrow capability
        let canBorrow = true;
        let borrowBlockReason = null;

        if (user.status !== 'active') {
            canBorrow = false;
            borrowBlockReason = 'Tài khoản độc giả đang bị tạm khóa hoặc chưa kích hoạt';
        } else if (totalUnpaidFines > 0) {
            canBorrow = false;
            borrowBlockReason = `Có khoản nợ phí phạt chưa thanh toán (${totalUnpaidFines.toLocaleString('vi-VN')}đ)`;
        } else if (overdueLoansCount > 0) {
            canBorrow = false;
            borrowBlockReason = `Đang giữ ${overdueLoansCount} cuốn sách mượn quá hạn chưa trả`;
        } else if (activeBorrows.length >= maxBooks) {
            canBorrow = false;
            borrowBlockReason = `Độc giả đang giữ ${activeBorrows.length}/${maxBooks} cuốn chưa trả (đã đạt giới hạn tối đa ${maxBooks} cuốn/độc giả). Các sách đã mượn nhưng chưa trả vẫn được tính vào hạn mức, bất kể ngày mượn. Cần trả bớt sách để mượn tiếp!`;
        }

        res.status(200).json({
            type: 'reader',
            reader: user,
            borrowRequests,
            readyReservations,
            pendingRequests,
            activeBorrows: enrichedActiveBorrows,
            unpaidFines,
            totalUnpaidFines,
            monthlyBorrowCount,
            overdueLoansCount,
            canBorrow,
            borrowBlockReason,
            maxBooks,
            maxBorrowDays,
            targetReservationId,
            scannedCode: rawCode,
            bookCopy: null
        });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin mượn độc giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// POST /api/borrow/approve-reservation
exports.approveReservation = async (req, res) => {
    const { reservationId, bookCopyQr, bookQrCode } = req.body;
    const targetBookQr = (bookCopyQr || bookQrCode || '').trim();
    const processedBy = req.user.id;

    try {
        if (!reservationId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã yêu cầu mượn' });
        }

        if (!targetBookQr) {
            return res.status(400).json({ 
                message: 'Vui lòng quét mã QR trên cuốn sách vật lý mà độc giả mang tới bàn để hoàn tất cho mượn!' 
            });
        }

        // Tìm trong borrow_requests trước, nếu không có thì tìm trong reservations
        let isBorrowRequest = false;
        let resv = null;

        const [requests] = await db.execute(`
            SELECT brq.*, u.id as u_id, u.full_name, u.card_number, u.status as user_status,
                   b.id as book_id, b.title as book_title, b.available_copies
            FROM borrow_requests brq
            JOIN users u ON brq.user_id = u.id
            JOIN books b ON brq.book_id = b.id
            WHERE brq.id = ?
        `, [reservationId]);

        if (requests.length > 0) {
            isBorrowRequest = true;
            resv = requests[0];
        } else {
            const [resvs] = await db.execute(`
                SELECT r.*, u.id as u_id, u.full_name, u.card_number, u.status as user_status,
                       b.id as book_id, b.title as book_title, b.available_copies
                FROM reservations r
                JOIN users u ON r.user_id = u.id
                JOIN books b ON r.book_id = b.id
                WHERE r.id = ?
            `, [reservationId]);

            if (resvs.length > 0) {
                resv = resvs[0];
            }
        }

        if (!resv) {
            return res.status(404).json({ message: 'Không tìm thấy yêu cầu mượn này' });
        }

        if (resv.status === 'completed' || resv.status === 'fulfilled') {
            return res.status(400).json({ message: 'Yêu cầu mượn này đã được xử lý trao sách trước đó' });
        }
        if (resv.status === 'cancelled') {
            return res.status(400).json({ message: 'Yêu cầu mượn này đã bị hủy' });
        }

        // Kiểm tra quy chế mượn (Eligibility)
        const eligibility = await checkBorrowEligibility(resv.u_id);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }

        // Tìm đúng bản sao sách theo mã QR quét được từ cuốn sách vật lý
        const [copies] = await db.execute(
            'SELECT bc.*, b.title as copy_book_title FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [targetBookQr]
        );
        if (copies.length === 0) {
            return res.status(404).json({ 
                message: `Mã QR sách [${targetBookQr}] không tồn tại trong hệ thống thư viện!` 
            });
        }
        const copy = copies[0];

        // ĐỐI SOÁT CHẶT CHẼ: Cuốn sách vật lý độc giả cầm tới phải thuộc đúng đầu sách đã đăng ký
        if (copy.book_id !== resv.book_id) {
            return res.status(400).json({ 
                message: `MÃ SÁCH KHÔNG KHỚP: Cuốn sách độc giả mang tới là "${copy.copy_book_title}" (${copy.qr_code}), nhưng độc giả đã đăng ký mượn cuốn "${resv.book_title}". Vui lòng yêu cầu độc giả lấy đúng sách!` 
            });
        }

        // Kiểm tra trạng thái bản sao
        if (copy.status !== 'available') {
            return res.status(400).json({ 
                message: `Bản sao sách [${copy.qr_code}] hiện không ở trạng thái sẵn sàng (Trạng thái: ${copy.status}). Vui lòng chọn bản sao khác sẵn có trong kho!` 
            });
        }

        const maxBorrowDays = eligibility.maxBorrowDays;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            // Tạo bản ghi mượn chính xác với bản sao vừa quét
            await connection.execute(
                'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                [resv.u_id, copy.id, dueDate.toISOString().slice(0, 10), processedBy]
            );

            // Cập nhật trạng thái bản sao -> borrowed
            await connection.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]);

            // Giảm số lượng bản sao sẵn có của đầu sách (với borrow_requests thì đã tạm giữ lúc đăng ký nên không trừ lại)
            if (!isBorrowRequest) {
                await connection.execute('UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?', [resv.book_id]);
            }

            // Cập nhật trạng thái phiếu đăng ký / đặt trước -> completed / borrowed
            if (isBorrowRequest) {
                await connection.execute('UPDATE borrow_requests SET status = "borrowed" WHERE id = ?', [resv.id]);
            } else {
                await connection.execute('UPDATE reservations SET status = "completed" WHERE id = ?', [resv.id]);
            }

            // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
            await connection.execute(
                'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                [resv.u_id, resv.book_id]
            );
            await connection.execute(
                'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                [resv.u_id, resv.book_id]
            );

            // Ghi nhật ký hoạt động
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'BORROW', 'borrow_records', copy.id, `Thủ thư quét khớp mã bản sao ${copy.qr_code} và duyệt trao sách "${resv.book_title}" cho độc giả ${resv.full_name}`]
            );

            // Gửi thông báo cho độc giả
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    resv.u_id,
                    'Đã nhận sách tại quầy',
                    `Thủ thư đã quét xác thực bản sao sách (${copy.qr_code}) và bàn giao thành công cuốn "${resv.book_title}" cho bạn. Hạn trả sách: ${dueDate.toLocaleDateString('vi-VN')}.`
                ]
            );

            // Gửi thông báo cho ban thư viện
            await notifyAllStaff(
                'Độc giả nhận sách đặt trước tại quầy',
                `Độc giả ${resv.full_name} (${resv.card_number || 'ID: #' + resv.u_id}) vừa nhận cuốn "${resv.book_title}" (Mã bản sao: ${copy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                'info'
            );

            await connection.commit();
            res.status(200).json({
                message: `Đã đối soát khớp mã QR và trao cuốn "${resv.book_title}" (Mã bản sao: ${copy.qr_code}) cho độc giả ${resv.full_name}!`,
                data: {
                    readerName: resv.full_name,
                    bookTitle: resv.book_title,
                    dueDate: dueDate.toLocaleDateString('vi-VN'),
                    copyQr: copy.qr_code
                }
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi duyệt mượn sách:', error);
        res.status(500).json({ message: 'Lỗi server khi duyệt mượn sách' });
    }
};

// GET /api/borrow/check-copy/:qrCode
exports.checkBookCopy = async (req, res) => {
    const { qrCode } = req.params;
    try {
        if (!qrCode || !qrCode.trim()) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR bản sao sách' });
        }

        // Tự động dọn dẹp các yêu cầu giữ chỗ đã hết hạn trước khi kiểm tra
        await cleanupExpiredBorrowRequests();

        const [copies] = await db.execute(`
            SELECT bc.id, bc.book_id, bc.qr_code, bc.status, bc.condition_note,
                   b.title as book_title, b.isbn, b.cover_image, b.available_copies, b.total_copies,
                   br.id as active_borrow_id, br.user_id as borrower_user_id, br.borrow_date, br.due_date,
                   u.full_name as borrower_name, u.card_number as borrower_card_number,
                   a.name as author_name, c.name as category_name
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            WHERE bc.qr_code = ?
        `, [qrCode.trim()]);

        if (copies.length === 0) {
            return res.status(404).json({ message: `Mã QR [${qrCode}] không tồn tại trong hệ thống thư viện` });
        }

        const copy = copies[0];

        // Lấy danh sách các yêu cầu giữ chỗ online 24h đang còn hiệu lực của đầu sách này
        const [holdRows] = await db.execute(`
            SELECT brq.id as request_id, brq.user_id, brq.request_date, brq.expires_at,
                   IFNULL(TIMESTAMPDIFF(HOUR, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 24) as time_left_hours,
                   IFNULL(TIMESTAMPDIFF(MINUTE, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 1440) as time_left_minutes,
                   u.full_name as reader_name, u.card_number, u.phone as reader_phone, u.email as reader_email
            FROM borrow_requests brq
            JOIN users u ON brq.user_id = u.id
            WHERE brq.book_id = ? AND brq.status = 'pending' AND (brq.expires_at IS NULL OR brq.expires_at > NOW())
            ORDER BY brq.request_date ASC
        `, [copy.book_id]);

        // Đếm số lượng bản sao đang có sẵn trên kệ của đầu sách này (status = 'available')
        const [availCopiesRows] = await db.execute(
            'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
            [copy.book_id]
        );
        const availablePhysicalCopies = availCopiesRows[0]?.count || 0;
        const holdCount = holdRows.length;
        const freeCopies = Math.max(0, availablePhysicalCopies - holdCount);
        const allCopiesHeld = holdCount > 0 && availablePhysicalCopies <= holdCount;

        copy.holds = holdRows;
        copy.hold_count = holdCount;
        copy.available_physical_copies = availablePhysicalCopies;
        copy.free_copies = freeCopies;
        copy.all_copies_held = allCopiesHeld;

        res.status(200).json(copy);
    } catch (error) {
        console.error('Lỗi khi kiểm tra mã bản sao:', error);
        res.status(500).json({ message: 'Lỗi server khi kiểm tra mã bản sao' });
    }
};

// =========================================================================
// BORROW REQUESTS (Đăng ký mượn online khi sách CÒN SẴN trên kệ - Giữ chỗ 24h)
// =========================================================================

exports.createBorrowRequest = async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.id;

    try {
        if (!bookId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã đầu sách cần đăng ký mượn' });
        }

        // Tự động dọn dẹp các yêu cầu đã hết hạn trước khi xử lý
        await cleanupExpiredBorrowRequests();

        // 1. Kiểm tra quy chế mượn của độc giả
        const eligibility = await checkBorrowEligibility(userId);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }
        const user = eligibility.user;

        // 2. Kiểm tra sách tồn tại & CÒN SẴN TRONG KHO
        const [books] = await db.execute('SELECT id, title, available_copies, total_copies FROM books WHERE id = ?', [bookId]);
        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đầu sách này' });
        }
        const book = books[0];

        if (book.available_copies <= 0) {
            return res.status(400).json({
                message: `Đầu sách "${book.title}" hiện đã hết bản sao sẵn có trong kho. Bạn vui lòng sử dụng tính năng "Đặt trước sách" để xếp hàng nhận khi có sách hoàn trả!`
            });
        }

        // 3. Kiểm tra xem độc giả đã có yêu cầu mượn cuốn này đang chờ xử lý chưa
        const [existing] = await db.execute(
            'SELECT id FROM borrow_requests WHERE user_id = ? AND book_id = ? AND status = "pending"',
            [userId, bookId]
        );
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã đăng ký giữ chỗ cuốn sách này rồi! Sách đang được giữ cho bạn trong 24 giờ. Vui lòng đến thư viện nhận sách.' });
        }

        // 4. Kiểm tra giới hạn số lượng yêu cầu mượn
        const [activeRequests] = await db.execute(
            'SELECT COUNT(*) as count FROM borrow_requests WHERE user_id = ? AND status = "pending"',
            [userId]
        );
        const requestCount = activeRequests[0]?.count || 0;
        if (eligibility.activeCount + requestCount >= eligibility.maxBooks) {
            return res.status(400).json({
                message: `Bạn đang giữ ${eligibility.activeCount} cuốn và đã đăng ký giữ chỗ ${requestCount} cuốn (đạt giới hạn tối đa ${eligibility.maxBooks} cuốn/độc giả). Vui lòng hoàn tất hoặc hủy bớt yêu cầu mượn!`
            });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // TẠM GIỮ 1 BẢN SAO NGAY LẬP TỨC: Giảm available_copies để người khác không mượn mất trong thời gian độc giả tới thư viện
            await connection.execute(
                'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                [bookId]
            );

            // Thêm vào bảng borrow_requests với thời hạn giữ chỗ 24 giờ
            const [result] = await connection.execute(
                'INSERT INTO borrow_requests (user_id, book_id, status, expires_at) VALUES (?, ?, "pending", DATE_ADD(NOW(), INTERVAL 24 HOUR))',
                [userId, bookId]
            );

            // Gửi thông báo cho độc giả
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    userId,
                    'Đã giữ chỗ mượn sách online thành công (24h)',
                    `Thư viện đã tạm giữ riêng 1 cuốn "${book.title}" cho bạn trong vòng 24 giờ để không bị người khác mượn mất. Khi đến thư viện, bạn vui lòng vào kệ lấy cuốn sách này mang đến quầy và xuất trình Thẻ độc giả QR để Thủ thư duyệt mượn nhé!`
                ]
            );

            // Gửi thông báo cho thủ thư
            await notifyAllStaff(
                'Độc giả đăng ký giữ chỗ mượn online',
                `Độc giả ${user.full_name} (${user.card_number || user.email}) vừa đăng ký giữ chỗ online cuốn "${book.title}". Bản sao đã được tạm giữ trong 24 giờ.`,
                'info',
                userId
            );

            await connection.commit();

            res.status(201).json({
                message: `Đã giữ chỗ thành công cuốn "${book.title}" trong 24 giờ! Bản sao đã được tạm giữ để không ai mượn mất. Khi đến thư viện, bạn hãy vào kệ lấy sách mang lại quầy và giơ Thẻ QR để Thủ thư duyệt mượn.`,
                requestId: result.insertId,
                bookTitle: book.title,
                holdHours: 24
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi tạo yêu cầu mượn:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi đăng ký mượn sách' });
    }
};

// GET /api/borrow/requests
exports.getBorrowRequests = async (req, res) => {
    const { role, id } = req.user;

    try {
        await cleanupExpiredBorrowRequests();

        let query = `
            SELECT brq.id, brq.user_id, brq.book_id, brq.request_date, brq.expires_at, brq.status,
                   IFNULL(TIMESTAMPDIFF(HOUR, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 24) as time_left_hours,
                   IFNULL(TIMESTAMPDIFF(MINUTE, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 1440) as time_left_minutes,
                   b.title as book_title, b.cover_image, b.isbn, b.available_copies, b.total_copies,
                   a.name as author_name, c.name as category_name,
                   u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone
            FROM borrow_requests brq
            JOIN books b ON brq.book_id = b.id
            JOIN users u ON brq.user_id = u.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE brq.user_id = ? AND brq.status = "pending"';
            params.push(id);
        } else {
            query += ' WHERE brq.status = "pending"';
        }

        query += ' ORDER BY brq.request_date DESC';

        const [rows] = await db.execute(query, params);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách yêu cầu mượn:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// DELETE /api/borrow/requests/:id
exports.cancelBorrowRequest = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { role } = req.user;

    try {
        const [requests] = await db.execute(`
            SELECT brq.*, b.title as book_title 
            FROM borrow_requests brq
            JOIN books b ON brq.book_id = b.id
            WHERE brq.id = ?
        `, [id]);

        if (requests.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy yêu cầu mượn này' });
        }
        const request = requests[0];

        if (role === 'reader' && request.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền hủy yêu cầu mượn này' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            await connection.execute('UPDATE borrow_requests SET status = "cancelled" WHERE id = ?', [id]);

            // HOÀN TRẢ LẠI 1 BẢN SAO VÀO KHO (vì lúc đăng ký đã tạm giữ 1 bản sao)
            if (request.status === 'pending') {
                await connection.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [request.book_id]);
            }

            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    request.user_id,
                    'Đã hủy giữ chỗ mượn sách',
                    `Yêu cầu giữ chỗ cuốn sách "${request.book_title}" đã được hủy. Bản sao sách đã được hoàn trả lại kho.`
                ]
            );

            await connection.commit();
            res.status(200).json({ message: 'Đã hủy giữ chỗ mượn sách thành công! Bản sao đã được hoàn trả về kho.' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi hủy yêu cầu mượn:', error);
        res.status(500).json({ message: error.message || 'Lỗi server' });
    }
};

// POST /api/borrow/requests/:id/fulfill (Thủ thư quét sách duyệt mượn)
exports.fulfillBorrowRequest = async (req, res) => {
    const { id } = req.params;
    const { bookCopyQr } = req.body;
    const processedBy = req.user.id;

    try {
        if (!bookCopyQr || !bookCopyQr.trim()) {
            return res.status(400).json({ message: 'Vui lòng quét mã QR trên cuốn sách vật lý mà độc giả mang tới!' });
        }

        // 1. Lấy thông tin yêu cầu mượn
        const [requests] = await db.execute(`
            SELECT brq.*, u.id as u_id, u.full_name, u.card_number, u.status as user_status,
                   b.id as book_id, b.title as book_title, b.available_copies
            FROM borrow_requests brq
            JOIN users u ON brq.user_id = u.id
            JOIN books b ON brq.book_id = b.id
            WHERE brq.id = ?
        `, [id]);

        if (requests.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy yêu cầu mượn' });
        }
        const reqItem = requests[0];

        if (reqItem.status !== 'pending') {
            return res.status(400).json({ message: `Yêu cầu mượn này đã ở trạng thái "${reqItem.status}"` });
        }

        // 2. Kiểm tra điều kiện mượn
        const eligibility = await checkBorrowEligibility(reqItem.u_id);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }

        // 3. Tìm bản sao sách
        const [copies] = await db.execute(
            'SELECT bc.*, b.title as copy_book_title FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [bookCopyQr.trim()]
        );
        if (copies.length === 0) {
            return res.status(404).json({ message: `Mã QR sách [${bookCopyQr}] không tồn tại trong hệ thống thư viện!` });
        }
        const copy = copies[0];

        if (copy.book_id !== reqItem.book_id) {
            return res.status(400).json({
                message: `MÃ SÁCH KHÔNG KHỚP: Cuốn sách độc giả mang tới là "${copy.copy_book_title}" (${copy.qr_code}), nhưng yêu cầu mượn là cuốn "${reqItem.book_title}". Vui lòng yêu cầu độc giả lấy đúng sách!`
            });
        }

        if (copy.status !== 'available') {
            return res.status(400).json({
                message: `Bản sao sách [${copy.qr_code}] hiện không ở trạng thái sẵn sàng (Trạng thái: ${copy.status})`
            });
        }

        const maxBorrowDays = eligibility.maxBorrowDays;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            await connection.execute(
                'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                [reqItem.u_id, copy.id, dueDate.toISOString().slice(0, 10), processedBy]
            );

            await connection.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]);
            // Không trừ available_copies lần nữa vì đã được tạm giữ lúc đăng ký mượn online
            await connection.execute('UPDATE borrow_requests SET status = "borrowed" WHERE id = ?', [reqItem.id]);

            // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
            await connection.execute(
                'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                [reqItem.u_id, reqItem.book_id]
            );
            await connection.execute(
                'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                [reqItem.u_id, reqItem.book_id]
            );

            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, "BORROW", "borrow_records", ?, ?)',
                [processedBy, copy.id, `Thủ thư duyệt mượn cuốn "${reqItem.book_title}" (Mã bản sao: ${copy.qr_code}) cho độc giả ${reqItem.full_name}`]
            );

            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    reqItem.u_id,
                    'Đã nhận sách tại quầy',
                    `Thủ thư đã quét xác thực bản sao sách (${copy.qr_code}) và trao thành công cuốn "${reqItem.book_title}" cho bạn. Hạn trả sách: ${dueDate.toLocaleDateString('vi-VN')}.`
                ]
            );

            await notifyAllStaff(
                'Độc giả mượn sách tại quầy (Online Request)',
                `Độc giả ${reqItem.full_name} (${reqItem.card_number}) vừa nhận cuốn "${reqItem.book_title}" (Mã bản sao: ${copy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                'info'
            );

            await connection.commit();
            res.status(200).json({
                message: `Đã đối soát khớp mã QR và trao cuốn "${reqItem.book_title}" (Mã bản sao: ${copy.qr_code}) cho độc giả ${reqItem.full_name}!`,
                data: {
                    readerName: reqItem.full_name,
                    bookTitle: reqItem.book_title,
                    dueDate: dueDate.toLocaleDateString('vi-VN'),
                    copyQr: copy.qr_code
                }
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi duyệt mượn sách:', error);
        res.status(500).json({ message: error.message || 'Lỗi server' });
    }
};


