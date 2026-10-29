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

    // 6. Draft borrow transaction format (DRAFT-BRW-... or DRAFT-...)
    if (raw.startsWith('DRAFT-BRW-') || raw.startsWith('DRAFT-')) {
        const [drafts] = await db.execute('SELECT user_id, draft_code, id FROM borrow_drafts WHERE draft_code = ?', [raw]);
        if (drafts.length > 0) {
            [users] = await db.execute('SELECT * FROM users WHERE id = ?', [drafts[0].user_id]);
            if (users.length > 0) return { user: users[0], targetResId: null, targetDraftCode: drafts[0].draft_code, draftId: drafts[0].id, rawCode: raw };
        }
    }

    return null;
};

// Helper to validate complete library borrow policy
const checkBorrowEligibility = async (userId, additionalCount = 1) => {
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
            message: `Độc giả "${user.full_name}" hiện có khoản nợ phí phạt chưa thanh toán (${unpaidAmount.toLocaleString('vi-VN')}đ). Phải đóng phí phạt trước khi được mượn sách mới!`,
            unpaidAmount
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
            message: `Độc giả "${user.full_name}" hiện có ${overdueCount} cuốn sách mượn quá hạn chưa trả. Phải hoàn trả sách quá hạn trước khi được mượn thêm sách!`,
            overdueCount
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
    const remainingSlots = Math.max(0, maxBooks - activeCount);

    if (activeCount >= maxBooks) {
        return {
            allowed: false,
            message: `Giới hạn sách đang mượn: tối đa ${maxBooks} cuốn/độc giả. Độc giả "${user.full_name}" đang giữ ${activeCount}/${maxBooks} cuốn (các sách đã mượn nhưng chưa trả vẫn tính vào hạn mức). Cần hoàn trả bớt sách trước khi mượn tiếp!`,
            user,
            maxBooks,
            maxBorrowDays,
            activeCount,
            remainingSlots: 0
        };
    }

    const needed = Math.max(1, parseInt(additionalCount || 1, 10));
    if (activeCount + needed > maxBooks) {
        return {
            allowed: false,
            message: `Vượt quá giới hạn mượn sách! Độc giả "${user.full_name}" hiện đang giữ ${activeCount}/${maxBooks} cuốn (chỉ còn được mượn thêm tối đa ${remainingSlots} cuốn). Giao dịch mượn ${needed} cuốn sẽ vượt hạn mức tối đa (${maxBooks} cuốn/độc giả). Cần hoàn trả bớt sách trước khi duyệt mượn thêm!`,
            user,
            maxBooks,
            maxBorrowDays,
            activeCount,
            remainingSlots
        };
    }

    return { allowed: true, user, maxBooks, maxBorrowDays, activeCount, remainingSlots };
};

// Cleanup all expired holds (drafts, requests, reservations)
const cleanupAllExpiredHolds = async () => {
    try {
        // 1. Cleanup expired borrow requests (24h hold)
        const [expiredReqs] = await db.execute(`
            SELECT brq.id, brq.user_id, brq.book_id, b.title as book_title
            FROM borrow_requests brq
            JOIN books b ON brq.book_id = b.id
            WHERE brq.status = 'pending' AND brq.expires_at IS NOT NULL AND brq.expires_at < NOW()
        `);
        for (const reqItem of expiredReqs) {
            await db.execute('UPDATE borrow_requests SET status = "expired" WHERE id = ?', [reqItem.id]);
            await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [reqItem.book_id]);
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    reqItem.user_id,
                    'Hết hạn giữ chỗ mượn sách online',
                    `Thời hạn giữ chỗ 24 giờ cho cuốn sách "${reqItem.book_title}" đã hết. Bản sao sách đã được đưa trở lại kho thư viện cho các bạn đọc khác.`
                ]
            );
        }

        // 2. Cleanup expired borrow drafts (24h hold)
        const [expiredDrafts] = await db.execute(`
            SELECT d.id, d.user_id, d.draft_code
            FROM borrow_drafts d
            WHERE d.status = 'pending' AND d.expires_at < NOW()
        `);
        for (const draft of expiredDrafts) {
            await db.execute('UPDATE borrow_drafts SET status = "expired" WHERE id = ?', [draft.id]);
            const [items] = await db.execute('SELECT book_id FROM borrow_draft_items WHERE draft_id = ? AND status = "pending"', [draft.id]);
            await db.execute('UPDATE borrow_draft_items SET status = "unavailable" WHERE draft_id = ? AND status = "pending"', [draft.id]);
            for (const it of items) {
                await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [it.book_id]);
            }
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    draft.user_id,
                    'Phiếu mượn online đã hết hạn 24h',
                    `Thời hạn 24 giờ cho phiếu mượn online ${draft.draft_code} đã hết. Các cuốn sách đã được đưa trở lại kho cho các bạn đọc khác.`
                ]
            );
        }

        // 3. Cleanup expired reservations (48h hold)
        const [expiredResvs] = await db.execute(`
            SELECT r.id, r.user_id, r.book_id, b.title as book_title
            FROM reservations r
            JOIN books b ON r.book_id = b.id
            WHERE r.status = 'notified' AND r.expires_at IS NOT NULL AND r.expires_at < NOW()
        `);
        for (const resv of expiredResvs) {
            await db.execute('UPDATE reservations SET status = "expired" WHERE id = ?', [resv.id]);
            const [nextWaiters] = await db.execute(
                'SELECT r.id, r.user_id, u.full_name FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                [resv.book_id]
            );
            if (nextWaiters.length > 0) {
                const nextUser = nextWaiters[0];
                await db.execute(
                    'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                    [nextUser.id]
                );
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                    [
                        nextUser.user_id,
                        '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                        `Cuốn sách "${resv.book_title}" bạn đặt trước đã có sẵn tại thư viện. Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Hãy vào mục "Đặt trước sách" để xác nhận mượn nhé!`
                    ]
                );
            } else {
                await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [resv.book_id]);
            }
        }
    } catch (e) {
        console.error('Lỗi khi dọn dẹp các yêu cầu/phiếu giữ chỗ hết hạn:', e);
    }
};

const cleanupExpiredBorrowRequests = cleanupAllExpiredHolds;

// Central Helper: Lấy danh sách bạn đọc đang giữ chỗ hợp lệ cho 1 đầu sách (từ drafts, requests, reservations)
const getActiveHoldsForBook = async (bookId) => {
    await cleanupAllExpiredHolds();

    // 1. Holds từ borrow_drafts (Mượn Online - Giữ chỗ 24h & QR code)
    const [draftHolds] = await db.execute(`
        SELECT d.id as hold_id, 'draft' as hold_type, d.draft_code, d.user_id,
               di.id as item_id, di.book_copy_id, bc.qr_code as copy_qr_code,
               d.created_at, d.expires_at,
               GREATEST(1, TIMESTAMPDIFF(HOUR, NOW(), d.expires_at)) as time_left_hours,
               u.full_name as reader_name, u.card_number, u.phone as reader_phone, u.email as reader_email
        FROM borrow_draft_items di
        JOIN borrow_drafts d ON di.draft_id = d.id
        JOIN users u ON d.user_id = u.id
        LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
        WHERE di.book_id = ? AND d.status = 'pending' AND di.status = 'pending' AND d.expires_at > NOW()
        ORDER BY d.created_at ASC
    `, [bookId]);

    // 2. Holds từ borrow_requests (Yêu cầu giữ chỗ mượn online)
    const [reqHolds] = await db.execute(`
        SELECT brq.id as hold_id, 'request' as hold_type, NULL as draft_code, brq.user_id,
               NULL as item_id, NULL as book_copy_id, NULL as copy_qr_code,
               brq.request_date as created_at, brq.expires_at,
               GREATEST(1, IFNULL(TIMESTAMPDIFF(HOUR, NOW(), IFNULL(brq.expires_at, DATE_ADD(brq.request_date, INTERVAL 24 HOUR))), 24)) as time_left_hours,
               u.full_name as reader_name, u.card_number, u.phone as reader_phone, u.email as reader_email
        FROM borrow_requests brq
        JOIN users u ON brq.user_id = u.id
        WHERE brq.book_id = ? AND brq.status = 'pending' AND (brq.expires_at IS NULL OR brq.expires_at > NOW())
        ORDER BY brq.request_date ASC
    `, [bookId]);

    // 3. Holds từ reservations (Đặt trước đã có thông báo nhận sách)
    const [resvHolds] = await db.execute(`
        SELECT r.id as hold_id, 'reservation' as hold_type, CONCAT('TICKET-RES-', r.id) as draft_code, r.user_id,
               NULL as item_id, NULL as book_copy_id, NULL as copy_qr_code,
               r.reservation_date as created_at, r.expires_at,
               GREATEST(1, IFNULL(TIMESTAMPDIFF(HOUR, NOW(), IFNULL(r.expires_at, DATE_ADD(r.notified_at, INTERVAL 48 HOUR))), 48)) as time_left_hours,
               u.full_name as reader_name, u.card_number, u.phone as reader_phone, u.email as reader_email
        FROM reservations r
        JOIN users u ON r.user_id = u.id
        WHERE r.book_id = ? AND r.status IN ('notified', 'ready', 'accepted') AND (r.expires_at IS NULL OR r.expires_at > NOW())
        ORDER BY r.reservation_date ASC
    `, [bookId]);

    // Hợp nhất và deduplicate theo user_id
    const userMap = new Map();
    for (const h of [...draftHolds, ...reqHolds, ...resvHolds]) {
        if (!userMap.has(h.user_id)) {
            userMap.set(h.user_id, h);
        } else {
            const existing = userMap.get(h.user_id);
            if (!existing.book_copy_id && h.book_copy_id) {
                userMap.set(h.user_id, h);
            }
        }
    }

    return Array.from(userMap.values());
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

            // Find book copy with active borrow check
            const [copies] = await db.execute(`
                SELECT bc.*, b.title, b.id as book_real_id, b.available_copies,
                       br.id as active_borrow_id, br.user_id as borrower_user_id, br.due_date,
                       u.full_name as borrower_name, u.card_number as borrower_card_number
                FROM book_copies bc 
                JOIN books b ON bc.book_id = b.id 
                LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
                LEFT JOIN users u ON br.user_id = u.id
                WHERE bc.qr_code = ?
            `, [targetQr]);
            if (copies.length === 0) {
                return res.status(404).json({ message: 'Không tìm thấy mã sách này trong hệ thống' });
            }
            const copy = copies[0];

            if (copy.status !== 'available' || copy.active_borrow_id) {
                const bText = copy.borrower_name ? `bởi bạn đọc "${copy.borrower_name}" (${copy.borrower_card_number || '---'})` : '';
                const dDate = copy.due_date ? ` (Hạn trả: ${new Date(copy.due_date).toLocaleDateString('vi-VN')})` : '';
                await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]).catch(() => {});
                return res.status(400).json({ 
                    message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.title}» hiện ĐANG ĐƯỢC MƯỢN ${bText}${dDate}! Bạn vui lòng chọn cuốn sách khác trên kệ.` 
                });
            }

            // KIỂM TRA ĐẦU SÁCH CÓ ĐANG BỊ GIỮ CHỖ ONLINE 24H KHÔNG:
            const activeHolds = await getActiveHoldsForBook(copy.book_real_id);
            const isCurrentUserHolding = activeHolds.some(h => h.user_id === user.id);
            const otherHolds = activeHolds.filter(h => h.user_id !== user.id);

            // Kiểm tra xem bản sao này có đang bị bạn đọc khác giữ riêng không
            const specificHold = otherHolds.find(h => h.book_copy_id === copy.id);
            if (specificHold) {
                return res.status(400).json({
                    message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.title}» hiện đã được bạn đọc "${specificHold.reader_name}" chọn và giữ chỗ online (thời hạn giữ chỗ còn ${specificHold.time_left_hours} giờ). Vui lòng để lại sách trên kệ cho bạn đọc đó!`,
                    isHeld: true,
                    isSpecificCopyHeld: true,
                    bookTitle: copy.title,
                    bookId: copy.book_real_id,
                    copyQr: copy.qr_code,
                    holdCount: 1,
                    holds: [specificHold]
                });
            }

            if (otherHolds.length > 0 && !isCurrentUserHolding) {
                // Đếm số bản sao available hiện có trên kệ
                const [availCountRows] = await db.execute(
                    'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
                    [copy.book_real_id]
                );
                const availCount = availCountRows[0]?.count || 0;
                const freeCopies = Math.max(0, availCount - otherHolds.length);

                if (availCount <= otherHolds.length || freeCopies === 0) {
                    return res.status(400).json({
                        message: `Cuốn sách "${copy.title}" hiện đã có ${otherHolds.length} bạn đọc đăng ký giữ chỗ online 24h trước đó (${otherHolds.map(h => `${h.reader_name} - Còn ${h.time_left_hours}h`).join(', ')})! Toàn bộ bản sao trên kệ hiện đã có người giữ chỗ chờ đến nhận.`,
                        isHeld: true,
                        allCopiesHeld: true,
                        holdCount: otherHolds.length,
                        holds: otherHolds,
                        bookTitle: copy.title,
                        bookId: copy.book_real_id,
                        copyQr: copy.qr_code
                    });
                }
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

                if (isCurrentUserHolding) {
                    const userHold = activeHolds.find(h => h.user_id === user.id);
                    if (userHold && userHold.hold_type === 'request') {
                        await connection.execute(
                            'UPDATE borrow_requests SET status = "borrowed" WHERE id = ?',
                            [userHold.hold_id]
                        );
                    }
                } else {
                    await connection.execute(
                        'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                        [copy.book_real_id]
                    );
                }

                // Đồng bộ đóng mọi yêu cầu mượn online, phiếu mượn nháp và đặt trước cùng đầu sách của độc giả này
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [user.id, copy.book_real_id]
                );
                await connection.execute(`
                    UPDATE borrow_draft_items di 
                    JOIN borrow_drafts d ON di.draft_id = d.id 
                    SET di.status = 'borrowed', di.book_copy_id = ? 
                    WHERE d.user_id = ? AND di.book_id = ? AND di.status = 'pending'
                `, [copy.id, user.id, copy.book_real_id]);
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
                const exitPass = await issueExitPass(user.id, [{
                    book_id: copy.book_real_id,
                    title: copy.title,
                    qr_code: copy.qr_code,
                    cover_image: copy.cover_image
                }]);

                return res.status(200).json({
                    message: `Bạn đã mượn thành công cuốn sách "${copy.title}"!`,
                    data: {
                        readerName: user.full_name,
                        bookTitle: copy.title,
                        dueDate: dueDate.toLocaleDateString('vi-VN'),
                        exitPass
                    },
                    exitPass
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

        // 3. Find book copy by QR code with active borrow check
        const [copies] = await db.execute(`
            SELECT bc.*, b.title, b.id as book_real_id, b.available_copies,
                   br.id as active_borrow_id, br.user_id as borrower_user_id, br.due_date,
                   u.full_name as borrower_name, u.card_number as borrower_card_number
            FROM book_copies bc 
            JOIN books b ON bc.book_id = b.id 
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            WHERE bc.qr_code = ?
        `, [bookQrCode]);
        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy mã sách này trong hệ thống' });
        }
        const copy = copies[0];

        if (copy.status !== 'available' || copy.active_borrow_id) {
            const bName = copy.borrower_name ? `bởi độc giả "${copy.borrower_name}" (${copy.borrower_card_number || '---'})` : '';
            const dDate = copy.due_date ? ` (Hạn trả: ${new Date(copy.due_date).toLocaleDateString('vi-VN')})` : '';
            await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]).catch(() => {});
            return res.status(400).json({ 
                message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.title}» hiện ĐANG ĐƯỢC MƯỢN ${bName}${dDate}! Vui lòng nhận trả sách trước hoặc nhập mã bản sao khác.` 
            });
        }

        // KIỂM TRA ĐẦU SÁCH CÓ ĐANG BỊ GIỮ CHỖ ONLINE 24H KHÔNG:
        const activeHolds = await getActiveHoldsForBook(copy.book_real_id);
        const isCurrentUserHolding = activeHolds.some(h => h.user_id === user.id);
        const otherHolds = activeHolds.filter(h => h.user_id !== user.id);

        // Kiểm tra xem bản sao này có đang bị bạn đọc khác giữ riêng không
        const specificHold = otherHolds.find(h => h.book_copy_id === copy.id);
        if (specificHold) {
            return res.status(400).json({
                message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.title}» hiện đã được bạn đọc "${specificHold.reader_name}" chọn và giữ chỗ online (thời hạn giữ chỗ còn ${specificHold.time_left_hours} giờ). Vui lòng để lại sách trên kệ cho bạn đọc đó!`,
                isHeld: true,
                isSpecificCopyHeld: true,
                bookTitle: copy.title,
                bookId: copy.book_real_id,
                copyQr: copy.qr_code,
                holdCount: 1,
                holds: [specificHold]
            });
        }

        if (otherHolds.length > 0 && !isCurrentUserHolding) {
            // Đếm số bản sao available hiện có trên kệ
            const [availCountRows] = await db.execute(
                'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
                [copy.book_real_id]
            );
            const availCount = availCountRows[0]?.count || 0;
            const freeCopies = Math.max(0, availCount - otherHolds.length);

            if (availCount <= otherHolds.length || freeCopies === 0) {
                // Toàn bộ bản sao trên kệ hiện đã có người giữ chỗ trước!
                return res.status(400).json({
                    message: `Cuốn sách "${copy.title}" hiện đã có ${otherHolds.length} bạn đọc đăng ký giữ chỗ online 24h trước đó (${otherHolds.map(h => `${h.reader_name} - Còn ${h.time_left_hours}h`).join(', ')})! Toàn bộ bản sao trên kệ hiện đã có chủ giữ chỗ chờ đến lấy.`,
                    isHeld: true,
                    allCopiesHeld: true,
                    holdCount: otherHolds.length,
                    holds: otherHolds,
                    bookTitle: copy.title,
                    bookId: copy.book_real_id,
                    copyQr: copy.qr_code
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
                const userHold = activeHolds.find(h => h.user_id === user.id);
                if (userHold && userHold.hold_type === 'request') {
                    await connection.execute(
                        'UPDATE borrow_requests SET status = "borrowed" WHERE id = ?',
                        [userHold.hold_id]
                    );
                }
            } else {
                // Trừ số lượng bản sao khả dụng nếu là mượn trực tiếp tự do
                await connection.execute(
                    'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                    [copy.book_real_id]
                );
            }

            // Đồng bộ đóng mọi yêu cầu mượn online, phiếu mượn nháp và đặt trước cùng đầu sách của độc giả này
            await connection.execute(
                'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                [user.id, copy.book_real_id]
            );
            await connection.execute(`
                UPDATE borrow_draft_items di 
                JOIN borrow_drafts d ON di.draft_id = d.id 
                SET di.status = 'borrowed', di.book_copy_id = ? 
                WHERE d.user_id = ? AND di.book_id = ? AND di.status = 'pending'
            `, [copy.id, user.id, copy.book_real_id]);
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
            const exitPass = await issueExitPass(user.id, [{
                book_id: copy.book_real_id,
                title: copy.title,
                qr_code: copy.qr_code,
                cover_image: copy.cover_image
            }], callerId);

            res.status(200).json({
                message: 'Đã xác nhận cho mượn sách thành công!',
                data: {
                    readerName: user.full_name,
                    bookTitle: copy.title,
                    dueDate: dueDate.toLocaleDateString('vi-VN'),
                    exitPass
                },
                exitPass
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
            'SELECT bc.*, b.title, b.id as book_real_id, COALESCE(b.location, "Phòng 01 - Kệ 01 - Ngăn 01") as book_location FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
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

        // 2.0. If caller is a reader, ensure they are returning their OWN borrowed book
        if (req.user.role === 'reader' && record.u_id !== req.user.id) {
            return res.status(403).json({
                message: `Bạn không thể tự trả cuốn sách này vì sách đang được mượn bởi độc giả khác (${record.full_name})!`
            });
        }

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

            const returnLocation = copy.book_location || 'Phòng 01 - Kệ 01 - Ngăn 01';
            res.status(200).json({
                message: overdueDays > 0 
                    ? `Đã thu phí phạt ${fineAmount.toLocaleString('vi-VN')}đ và nhận trả sách "${copy.title}" thành công! Vui lòng xếp về: ${returnLocation}` 
                    : `Đã nhận trả sách "${copy.title}" thành công! Vui lòng xếp về: ${returnLocation}`,
                data: {
                    readerName: record.full_name,
                    bookTitle: copy.title,
                    returnLocation,
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
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as book_location,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
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
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
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
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
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
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
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

        // Active draft borrow transaction if any
        const [draftRows] = await db.execute(`
            SELECT d.*, 
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as time_left_hours,
                   TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at) as time_left_minutes
            FROM borrow_drafts d
            WHERE d.user_id = ? AND d.status = 'pending' AND d.expires_at > NOW()
            ORDER BY d.created_at DESC
            LIMIT 1
        `, [user.id]);

        let activeDraft = null;
        let draftWillExceedLimit = false;
        let draftExceedReason = null;

        if (draftRows.length > 0) {
            const d = draftRows[0];
            const [items] = await db.execute(`
                SELECT di.id as item_id, di.book_id, di.status as item_status,
                       b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                       COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
                FROM borrow_draft_items di
                JOIN books b ON di.book_id = b.id
                WHERE di.draft_id = ?
            `, [d.id]);
            activeDraft = { ...d, items };

            if (activeBorrows.length + items.length > maxBooks) {
                draftWillExceedLimit = true;
                draftExceedReason = `Phiếu mượn online ${d.draft_code} gồm ${items.length} cuốn sách. Độc giả đang giữ ${activeBorrows.length}/${maxBooks} cuốn. Nếu duyệt thêm phiếu này sẽ thành ${activeBorrows.length + items.length}/${maxBooks} cuốn (vượt quá giới hạn tối đa ${maxBooks} cuốn/độc giả)! Cần trả bớt sách trước khi duyệt.`;
            }
        }

            // Active exit pass if any
            const [exitPassRows] = await db.execute(`
                SELECT ep.*, 
                       TIMESTAMPDIFF(MINUTE, NOW(), ep.expires_at) as minutes_left
                FROM exit_passes ep
                WHERE ep.user_id = ? AND ep.status = 'active' AND ep.expires_at > NOW()
                ORDER BY ep.created_at DESC
                LIMIT 1
            `, [user.id]);
            let activeExitPass = null;
            if (exitPassRows.length > 0) {
                let items = [];
                try {
                    items = typeof exitPassRows[0].items_summary === 'string' ? JSON.parse(exitPassRows[0].items_summary) : exitPassRows[0].items_summary;
                } catch (e) {}
                activeExitPass = {
                    ...exitPassRows[0],
                    items,
                    minutesLeft: Math.max(0, exitPassRows[0].minutes_left || 0)
                };
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
                targetDraftCode: found?.targetDraftCode || null,
                activeDraft,
                activeExitPass,
                draftWillExceedLimit,
                draftExceedReason,
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
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
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

        // Lấy danh sách các yêu cầu giữ chỗ online 24h & đặt trước đang còn hiệu lực của đầu sách này
        const holdRows = await getActiveHoldsForBook(copy.book_id);

        // Đếm số lượng bản sao đang có sẵn trên kệ của đầu sách này (status = 'available')
        const [availCopiesRows] = await db.execute(
            'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
            [copy.book_id]
        );
        const availablePhysicalCopies = availCopiesRows[0]?.count || 0;
        const holdCount = holdRows.length;
        const freeCopies = Math.max(0, availablePhysicalCopies - holdCount);
        const allCopiesHeld = holdCount > 0 && availablePhysicalCopies <= holdCount;

        // Kiểm tra xem bản sao cụ thể này có đang được bạn đọc nào giữ riêng không
        const specificHold = holdRows.find(h => h.book_copy_id === copy.id);

        copy.holds = holdRows;
        copy.hold_count = holdCount;
        copy.available_physical_copies = availablePhysicalCopies;
        copy.free_copies = freeCopies;
        copy.all_copies_held = allCopiesHeld;
        copy.is_this_copy_held = Boolean(specificHold);
        // Đồng bộ trạng thái nếu có bản ghi mượn đang active trong borrow_records
        if (copy.active_borrow_id || copy.borrower_user_id) {
            copy.status = 'borrowed';
            copy.is_already_borrowed = true;
            copy.is_available = false;
            await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]).catch(() => {});
        } else if (copy.status === 'borrowed') {
            copy.is_already_borrowed = true;
            copy.is_available = false;
        } else {
            copy.is_already_borrowed = false;
            copy.is_available = (copy.status === 'available');
        }

        res.status(200).json(copy);
    } catch (error) {
        console.error('Lỗi khi kiểm tra mã bản sao:', error);
        res.status(500).json({ message: 'Lỗi server khi kiểm tra mã bản sao' });
    }
};

// =========================================================================
// BORROW REQUESTS (Đăng ký mượn online khi sách CÒN SẴN trên kệ - Giữ chỗ 24h)
// =========================================================================

// =========================================================================
// HỢP NHẤT: ĐĂNG KÝ MƯỢN ONLINE (UNIFIED ONLINE BORROW ORDER)
// Mọi yêu cầu mượn online (1 cuốn hay nhiều cuốn) đều đổ về Phiếu mượn online (Borrow Draft)
// =========================================================================

exports.createBorrowRequest = async (req, res) => {
    // Tự động chuyển tiếp yêu cầu mượn lẻ về cơ chế Phiếu mượn online đa cuốn có mã QR
    const bookId = req.body.bookId || (req.body.bookIds && req.body.bookIds[0]);
    if (!bookId) {
        return res.status(400).json({ message: 'Vui lòng cung cấp mã đầu sách cần đăng ký mượn' });
    }
    req.body.bookIds = [parseInt(bookId, 10)];
    return exports.createBorrowDraft(req, res);
};

// GET /api/borrow/requests
exports.getBorrowRequests = async (req, res) => {
    const { role, id } = req.user;

    try {
        await cleanupAllExpiredHolds();

        let query = `
            SELECT di.id, d.user_id, di.book_id, d.created_at as request_date, d.expires_at, di.status,
                   d.draft_code,
                   IFNULL(TIMESTAMPDIFF(HOUR, NOW(), d.expires_at), 24) as time_left_hours,
                   IFNULL(TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at), 1440) as time_left_minutes,
                   b.title as book_title, b.cover_image, b.isbn, b.available_copies, b.total_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
                   a.name as author_name, c.name as category_name,
                   u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            JOIN books b ON di.book_id = b.id
            JOIN users u ON d.user_id = u.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            WHERE di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
        `;
        const params = [];

        if (role === 'reader') {
            query += ' AND d.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY d.created_at DESC';

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
        // 1. Kiểm tra xem ID có phải là mục trong phiếu mượn online (borrow_draft_items)
        const [draftItems] = await db.execute(`
            SELECT di.*, d.user_id, b.title as book_title
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            JOIN books b ON di.book_id = b.id
            WHERE di.id = ?
        `, [id]);

        if (draftItems.length > 0) {
            req.params.itemId = id;
            return exports.removeDraftItem(req, res);
        }

        // 2. Hỗ trợ bản ghi cũ trong bảng borrow_requests nếu còn
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

// =============================================================================
// DRAFT BORROW TRANSACTIONS (GIAO DỊCH PHIẾU MƯỢN NHÁP ĐA CUỐN & MÃ QR DUYỆT NHANH)
// =============================================================================

// POST /api/borrow/drafts
// Tạo giao dịch phiếu mượn nháp gồm nhiều cuốn sách và sinh mã QR
exports.createBorrowDraft = async (req, res) => {
    const userId = req.body.userId || req.user.id;
    const { bookIds, notes } = req.body;

    try {
        if (!bookIds || !Array.isArray(bookIds) || bookIds.length === 0) {
            return res.status(400).json({ message: 'Vui lòng chọn ít nhất một cuốn sách vào phiếu mượn online' });
        }

        // Deduplicate book IDs
        const uniqueBookIds = Array.from(new Set(bookIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0)));
        if (uniqueBookIds.length === 0) {
            return res.status(400).json({ message: 'Danh sách sách không hợp lệ' });
        }

        // 1. Kiểm tra tính khả dụng của từng đầu sách (tránh trường hợp sách đã hết)
        const [books] = await db.execute(`
            SELECT id, title, available_copies, COALESCE(location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
            FROM books
            WHERE id IN (${uniqueBookIds.map(() => '?').join(',')})
        `, uniqueBookIds);

        if (books.length !== uniqueBookIds.length) {
            return res.status(400).json({ message: 'Một số đầu sách được chọn không tồn tại trong hệ thống' });
        }

        // Kiểm tra số lượng bản sao thực tế còn tự do (trừ các độc giả đang giữ chỗ online 24h)
        for (const book of books) {
            const allHolds = await getActiveHoldsForBook(book.id);
            const otherHolds = allHolds.filter(h => h.user_id !== userId);
            const [availCountRows] = await db.execute(
                'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
                [book.id]
            );
            const availCount = availCountRows[0]?.count || 0;
            const freeCount = Math.max(0, availCount - otherHolds.length);

            if (freeCount <= 0) {
                return res.status(400).json({
                    message: `Đầu sách «${book.title}» hiện toàn bộ ${availCount} bản sao trong kho đã có người mượn hoặc đang được bạn đọc khác giữ chỗ online 24h. Vui lòng bỏ sách này khỏi phiếu hoặc sử dụng tính năng "Đặt trước sách" để xếp hàng!`
                });
            }
        }

        // 2. Kiểm tra xem độc giả đã có phiếu mượn chờ duyệt còn hiệu lực chưa
        const [activeDrafts] = await db.execute(
            "SELECT id, draft_code FROM borrow_drafts WHERE user_id = ? AND status = 'pending' AND expires_at > NOW()",
            [userId]
        );

        let draftId;
        let draftCode;
        let isExistingDraft = false;
        let existingBookIds = new Set();

        if (activeDrafts.length > 0) {
            draftId = activeDrafts[0].id;
            draftCode = activeDrafts[0].draft_code;
            isExistingDraft = true;

            const [existingItems] = await db.execute(
                "SELECT book_id FROM borrow_draft_items WHERE draft_id = ? AND status = 'pending'",
                [draftId]
            );
            existingBookIds = new Set(existingItems.map(i => i.book_id));
        } else {
            // Hủy các phiếu cũ đã hết hạn hoặc thừa nếu có
            await db.execute(
                "UPDATE borrow_drafts SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'",
                [userId]
            );
            const randomSalt = Math.floor(100 + Math.random() * 900);
            draftCode = `DRAFT-BRW-${Date.now().toString().slice(-5)}${randomSalt}-${userId}`;
        }

        // Tính tổng số sách độc giả muốn mượn
        const combinedBookIds = new Set([...existingBookIds, ...uniqueBookIds]);
        const totalDraftCount = combinedBookIds.size;

        // 3. Kiểm tra quy chế mượn của độc giả với tổng số sách trong phiếu
        const eligibility = await checkBorrowEligibility(userId, totalDraftCount);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            if (!isExistingDraft) {
                // Insert new draft
                const [draftResult] = await connection.execute(
                    `INSERT INTO borrow_drafts (draft_code, user_id, status, notes, expires_at)
                     VALUES (?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
                    [draftCode, userId, notes || null]
                );
                draftId = draftResult.insertId;
            } else {
                // Gia hạn thêm 24 giờ khi thêm sách mới
                await connection.execute(
                    `UPDATE borrow_drafts SET expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ?`,
                    [draftId]
                );
            }

            // Lấy danh sách sách đã có trong phiếu để tránh thêm trùng
            const [existingItems] = await connection.execute(
                `SELECT book_id FROM borrow_draft_items WHERE draft_id = ? AND status = 'pending'`,
                [draftId]
            );
            const existingBookIds = new Set(existingItems.map(i => i.book_id));

            // Insert new items & tạm giữ available_copies
            let newlyAddedCount = 0;
            for (const book of books) {
                if (!existingBookIds.has(book.id)) {
                    await connection.execute(
                        `INSERT INTO borrow_draft_items (draft_id, book_id, status) VALUES (?, ?, 'pending')`,
                        [draftId, book.id]
                    );
                    await connection.execute(
                        `UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?`,
                        [book.id]
                    );
                    newlyAddedCount++;
                }
            }

            // Gửi thông báo đến độc giả
            await connection.execute(
                `INSERT INTO notifications (user_id, title, message, type)
                 VALUES (?, ?, ?, 'info')`,
                [
                    userId,
                    'Đăng ký giữ chỗ & Tạo mã QR phiếu mượn thành công',
                    `Phiếu mượn online ${draftCode} đã được cập nhật. Bạn có 24 giờ để đến các phòng, kệ lấy sách và xuất trình mã QR tại quầy để Thủ thư duyệt trao sách siêu tốc 1 chạm.`
                ]
            );

            await connection.commit();

            // Fetch newly created/updated draft with full details
            const [draftRows] = await db.execute(`
                SELECT d.*, 
                       TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as time_left_hours,
                       TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at) as time_left_minutes,
                       u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone
                FROM borrow_drafts d
                JOIN users u ON d.user_id = u.id
                WHERE d.id = ?
            `, [draftId]);

            const [itemRows] = await db.execute(`
                SELECT di.id as item_id, di.book_id, di.status as item_status,
                       b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                       COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
                FROM borrow_draft_items di
                JOIN books b ON di.book_id = b.id
                WHERE di.draft_id = ?
            `, [draftId]);

            res.status(201).json({
                message: isExistingDraft 
                    ? `Đã thêm sách vào phiếu mượn online ${draftCode}! Mã QR giao dịch đã sẵn sàng.`
                    : `Đã đăng ký mượn online thành công! Mã QR giao dịch phiếu mượn ${draftCode} đã sẵn sàng.`,
                draft: {
                    ...draftRows[0],
                    items: itemRows
                }
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi tạo phiếu mượn nháp:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi tạo phiếu mượn nháp' });
    }
};

// GET /api/borrow/drafts/my-active
// Độc giả lấy phiếu mượn nháp đang hoạt động của mình kèm trạng thái đối soát bản sao
exports.getMyActiveDraft = async (req, res) => {
    const userId = req.user.id;
    try {
        const [drafts] = await db.execute(`
            SELECT d.*, 
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as time_left_hours,
                   TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at) as time_left_minutes,
                   u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone
            FROM borrow_drafts d
            JOIN users u ON d.user_id = u.id
            WHERE d.user_id = ? AND d.status = 'pending' AND d.expires_at > NOW()
            ORDER BY d.created_at DESC
            LIMIT 1
        `, [userId]);

        if (drafts.length === 0) {
            return res.status(200).json({ draft: null });
        }

        const draft = drafts[0];
        const [items] = await db.execute(`
            SELECT di.id as item_id, di.book_id, di.book_copy_id, di.status as item_status,
                   b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
                   bc.qr_code as copy_qr_code, bc.status as copy_status
            FROM borrow_draft_items di
            JOIN books b ON di.book_id = b.id
            LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
            WHERE di.draft_id = ?
        `, [draft.id]);

        const verifiedCount = items.filter(it => it.book_copy_id != null).length;
        const allVerified = items.length > 0 && verifiedCount === items.length;

        res.status(200).json({
            draft: {
                ...draft,
                items,
                verified_count: verifiedCount,
                total_items: items.length,
                all_verified: allVerified
            }
        });
    } catch (error) {
        console.error('Lỗi khi lấy phiếu mượn nháp của độc giả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// GET /api/borrow/drafts/pending-list
// Thủ thư xem toàn bộ danh sách phiếu mượn nháp đang chờ duyệt tại quầy
exports.getPendingDraftsList = async (req, res) => {
    try {
        const [drafts] = await db.execute(`
            SELECT d.*, 
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as time_left_hours,
                   TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at) as time_left_minutes,
                   u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone,
                   COUNT(di.id) as total_books
            FROM borrow_drafts d
            JOIN users u ON d.user_id = u.id
            LEFT JOIN borrow_draft_items di ON d.id = di.draft_id
            WHERE d.status = 'pending' AND d.expires_at > NOW()
            GROUP BY d.id
            ORDER BY d.created_at DESC
        `);

        // Attach items preview for each draft
        for (const draft of drafts) {
            const [items] = await db.execute(`
                SELECT di.id as item_id, di.book_id, di.book_copy_id, di.status as item_status,
                       b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                       COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
                       bc.qr_code as copy_qr_code, bc.status as copy_status
                FROM borrow_draft_items di
                JOIN books b ON di.book_id = b.id
                LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
                WHERE di.draft_id = ?
            `, [draft.id]);
            draft.items = items;
            draft.verified_count = items.filter(it => it.book_copy_id != null).length;
            draft.all_verified = items.length > 0 && draft.verified_count === items.length;
        }

        res.status(200).json(drafts);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phiếu mượn nháp chờ duyệt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// GET /api/borrow/drafts/:code
// Tra cứu chi tiết phiếu mượn nháp theo mã QR hoặc ID
exports.getBorrowDraftByCode = async (req, res) => {
    const { code } = req.params;
    try {
        const cleanCode = decodeURIComponent(code || '').trim();
        const [drafts] = await db.execute(`
            SELECT d.*, 
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as time_left_hours,
                   TIMESTAMPDIFF(MINUTE, NOW(), d.expires_at) as time_left_minutes,
                   u.id as reader_id, u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone, u.status as reader_status
            FROM borrow_drafts d
            JOIN users u ON d.user_id = u.id
            WHERE d.draft_code = ? OR d.id = ?
        `, [cleanCode, parseInt(cleanCode, 10) || 0]);

        if (drafts.length === 0) {
            return res.status(404).json({ message: `Không tìm thấy phiếu mượn online với mã [${cleanCode}]` });
        }

        const draft = drafts[0];

        // Fetch items with copy verification details
        const [items] = await db.execute(`
            SELECT di.id as item_id, di.book_id, di.book_copy_id, di.status as item_status,
                   b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
                   bc.qr_code as copy_qr_code, bc.status as copy_status
            FROM borrow_draft_items di
            JOIN books b ON di.book_id = b.id
            LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
            WHERE di.draft_id = ?
        `, [draft.id]);

        const verifiedCount = items.filter(it => it.book_copy_id != null).length;
        const allVerified = items.length > 0 && verifiedCount === items.length;

        // Check reader eligibility with items.length
        const eligibility = await checkBorrowEligibility(draft.user_id, items.length);

        res.status(200).json({
            draft: {
                ...draft,
                items,
                verified_count: verifiedCount,
                total_items: items.length,
                all_verified: allVerified
            },
            items,
            reader: {
                id: draft.reader_id,
                full_name: draft.reader_name,
                card_number: draft.card_number,
                email: draft.reader_email,
                phone: draft.reader_phone,
                status: draft.reader_status
            },
            eligibility: {
                canBorrow: eligibility.allowed,
                borrowBlockReason: eligibility.message,
                unpaidFines: eligibility.unpaidAmount || 0,
                overdueCount: eligibility.overdueCount || 0,
                activeCount: eligibility.activeCount || 0,
                maxBooks: eligibility.maxBooks || 5,
                remainingSlots: eligibility.remainingSlots ?? Math.max(0, (eligibility.maxBooks || 5) - (eligibility.activeCount || 0))
            },
            activeBorrowsCount: eligibility.activeCount || 0,
            maxBooks: eligibility.maxBooks || 5,
            allVerified
        });
    } catch (error) {
        console.error('Lỗi khi tra cứu phiếu mượn nháp:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// POST /api/borrow/drafts/:code/verify-copy
// BƯỚC 2: Độc giả dùng điện thoại quét mã QR bản sao sách tại kệ để tự đối soát xem có nhặt đúng sách đã đăng ký không
exports.verifyDraftItemCopy = async (req, res) => {
    const { code } = req.params;
    const { copyQr } = req.body;
    const userId = req.user.id;

    try {
        const cleanCopyQr = (copyQr || '').trim();
        if (!cleanCopyQr) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR bản sao sách' });
        }

        const cleanCode = decodeURIComponent(code || '').trim();
        const [drafts] = await db.execute(`
            SELECT d.*, u.full_name as reader_name
            FROM borrow_drafts d
            JOIN users u ON d.user_id = u.id
            WHERE (d.draft_code = ? OR d.id = ?) AND d.status = 'pending' AND d.expires_at > NOW()
        `, [cleanCode, parseInt(cleanCode, 10) || 0]);

        if (drafts.length === 0) {
            return res.status(404).json({ message: `Không tìm thấy phiếu mượn đang hoạt động hoặc phiếu đã hết hạn!` });
        }

        const draft = drafts[0];

        // Check ownership if reader
        if (req.user.role === 'reader' && draft.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa phiếu mượn này' });
        }

        // Tìm bản sao sách theo mã QR
        const [copies] = await db.execute(`
            SELECT bc.*, b.id as book_id, b.title as book_title, b.location
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            WHERE bc.qr_code = ?
        `, [cleanCopyQr]);

        if (copies.length === 0) {
            return res.status(404).json({ message: `Mã QR sách [${cleanCopyQr}] không tồn tại trong hệ thống thư viện!` });
        }

        const copy = copies[0];

        if (copy.status !== 'available') {
            return res.status(400).json({
                message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.book_title}» hiện không ở trạng thái sẵn sàng (Trạng thái hiện tại: "${copy.status}")`
            });
        }

        // Lấy danh sách các mục trong phiếu mượn
        const [draftItems] = await db.execute(`
            SELECT di.*, b.title as book_title
            FROM borrow_draft_items di
            JOIN books b ON di.book_id = b.id
            WHERE di.draft_id = ?
        `, [draft.id]);

        const matchingItem = draftItems.find(it => it.book_id === copy.book_id);

        if (!matchingItem) {
            const registeredTitles = draftItems.map(it => `«${it.book_title}»`).join(', ');
            return res.status(400).json({
                message: `SÁCH KHÔNG KHỚP: Cuốn sách bạn vừa quét là «${copy.book_title}» (${copy.qr_code}), KHÔNG nằm trong danh sách đăng ký mượn của bạn. Danh sách bạn đã đăng ký: ${registeredTitles}. Vui lòng kiểm tra lại vị trí kệ!`
            });
        }

        // 1. Kiểm tra xem bản sao cụ thể này có đang bị bạn đọc khác giữ riêng không
        const activeHolds = await getActiveHoldsForBook(copy.book_id);
        const specificHold = activeHolds.find(h => h.user_id !== userId && h.book_copy_id === copy.id);
        if (specificHold) {
            return res.status(400).json({
                message: `⛔ BẢN SAO ĐÃ CÓ NGƯỜI NHẶT:\nBản sao sách [${copy.qr_code}] của cuốn «${copy.book_title}» đã được bạn đọc "${specificHold.reader_name}" chọn và đối soát trong phiếu mượn của họ (thời hạn giữ chỗ còn ${specificHold.time_left_hours} giờ)!\n\n👉 Vui lòng để lại cuốn sách này trên kệ cho bạn đọc đó.`,
                isHeld: true,
                isSpecificCopyHeld: true,
                bookTitle: copy.book_title,
                bookId: copy.book_id,
                copyQr: copy.qr_code,
                holdCount: 1,
                holds: [specificHold]
            });
        }

        // 2. Kiểm tra quyền ưu tiên theo thứ tự đăng ký giữ chỗ 24h
        const [availCopiesRows] = await db.execute(
            'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
            [copy.book_id]
        );
        const availCount = availCopiesRows[0]?.count || 0;
        const myHoldIndex = activeHolds.findIndex(h => h.user_id === userId);

        if (myHoldIndex >= availCount && myHoldIndex !== -1) {
            const earlierHolders = activeHolds.slice(0, availCount);
            return res.status(400).json({
                message: `⛔ SÁCH ĐÃ ĐƯỢC ƯU TIÊN GIỮ CHỖ 24H!\nBản sao sách [${copy.qr_code}] của cuốn «${copy.book_title}» hiện đã được ưu tiên giữ chỗ cho bạn đọc "${earlierHolders.map(h => h.reader_name).join(', ')}" (đăng ký online trước bạn).\n\nToàn bộ ${availCount} bản sao trên kệ hiện đã có bạn đọc đến nhận trước.\n👉 Vui lòng để lại sách trên kệ cho bạn đọc đó! Bạn có thể chọn "Đặt trước sách" để xếp hàng nhận sách đợt tiếp theo.`,
                isHeld: true,
                allCopiesHeld: true,
                bookTitle: copy.book_title,
                bookId: copy.book_id,
                copyQr: copy.qr_code,
                holdCount: earlierHolders.length,
                holds: earlierHolders
            });
        }

        // Kiểm tra xem bản sao này đã bị trùng trong chính phiếu này chưa
        const [duplicateCopy] = await db.execute(`
            SELECT id FROM borrow_draft_items WHERE draft_id = ? AND book_copy_id = ? AND id != ?
        `, [draft.id, copy.id, matchingItem.id]);

        if (duplicateCopy.length > 0) {
            return res.status(400).json({ message: `Bản sao sách [${copy.qr_code}] đã được gán cho một mục khác trong phiếu mượn!` });
        }

        // Cập nhật gán bản sao này vào mục tương ứng trong phiếu mượn
        await db.execute(`
            UPDATE borrow_draft_items 
            SET book_copy_id = ?, status = 'pending'
            WHERE id = ?
        `, [copy.id, matchingItem.id]);

        // Kiểm tra xem tất cả các mục trong phiếu đã được đối soát chưa
        const [remainingUnverified] = await db.execute(`
            SELECT COUNT(*) as count FROM borrow_draft_items WHERE draft_id = ? AND (book_copy_id IS NULL OR book_copy_id = 0)
        `, [draft.id]);

        const unverifiedCount = remainingUnverified[0]?.count || 0;
        const allVerified = unverifiedCount === 0;

        return res.status(200).json({
            message: `Đối soát thành công! Bạn đã nhặt chính xác cuốn «${copy.book_title}» (${copy.qr_code}).`,
            verifiedItem: {
                itemId: matchingItem.id,
                bookId: copy.book_id,
                bookTitle: copy.book_title,
                copyQr: copy.qr_code,
                bookCopyId: copy.id
            },
            unverifiedCount,
            allVerified,
            draftCode: draft.draft_code
        });
    } catch (error) {
        console.error('Lỗi khi đối soát mã QR bản sao sách tại kệ:', error);
        res.status(500).json({ message: 'Lỗi server khi đối soát bản sao sách' });
    }
};

// POST /api/borrow/drafts/scan-direct
// MƯỢN TRỰC TIẾP TẠI KỆ: Độc giả đến kệ nhặt sách và dùng camera điện thoại quét mã QR bản sao vào giỏ mượn tại chỗ
exports.addDirectCopyScan = async (req, res) => {
    const userId = req.body.userId || req.user.id;
    const { copyQr } = req.body;

    try {
        const cleanCopyQr = (copyQr || '').trim();
        if (!cleanCopyQr) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR bản sao sách' });
        }

        // 1. Kiểm tra bản sao sách
        const [copies] = await db.execute(`
            SELECT bc.*, b.id as book_id, b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            WHERE bc.qr_code = ?
        `, [cleanCopyQr]);

        if (copies.length === 0) {
            return res.status(404).json({ message: `Mã QR sách [${cleanCopyQr}] không tồn tại trong hệ thống thư viện!` });
        }

        const copy = copies[0];
        if (copy.status !== 'available') {
            return res.status(400).json({
                message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.book_title}» hiện không ở trạng thái sẵn sàng (Trạng thái hiện tại: "${copy.status}")`
            });
        }

        // KIỂM TRA ĐẦU SÁCH CÓ ĐANG BỊ GIỮ CHỖ ONLINE 24H KHÔNG:
        const activeHolds = await getActiveHoldsForBook(copy.book_id);
        const isCurrentUserHolding = activeHolds.some(h => h.user_id === userId);
        const otherHolds = activeHolds.filter(h => h.user_id !== userId);

        // 1. Kiểm tra xem bản sao cụ thể này có đang bị bạn đọc khác giữ riêng không
        const specificHold = otherHolds.find(h => h.book_copy_id === copy.id);
        if (specificHold) {
            return res.status(400).json({
                message: `⛔ BẢN SAO SÁCH ĐÃ ĐƯỢC GIỮ CHỖ 24H!\nBản sao sách [${copy.qr_code}] của cuốn «${copy.book_title}» hiện đã được bạn đọc "${specificHold.reader_name}" chọn và đối soát trong phiếu mượn (thời hạn giữ chỗ còn ${specificHold.time_left_hours} giờ).\n\n👉 Vui lòng để lại cuốn sách này trên kệ cho bạn đọc đó!`,
                isHeld: true,
                isSpecificCopyHeld: true,
                bookTitle: copy.book_title,
                bookId: copy.book_id,
                copyQr: copy.qr_code,
                holdCount: 1,
                holds: [specificHold]
            });
        }

        // 2. Kiểm tra tổng số bản sao còn trống trên kệ
        const [availCountRows] = await db.execute(
            'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
            [copy.book_id]
        );
        const availCount = availCountRows[0]?.count || 0;
        const freeCopies = Math.max(0, availCount - otherHolds.length);

        if (otherHolds.length > 0 && !isCurrentUserHolding) {
            if (availCount <= otherHolds.length || freeCopies === 0) {
                return res.status(400).json({
                    message: `⛔ SÁCH ĐÃ CÓ BẠN ĐỌC GIỮ CHỖ 24H!\nCuốn sách «${copy.book_title}» (Mã tem: ${copy.qr_code}) hiện đã có ${otherHolds.length} bạn đọc đăng ký giữ chỗ trước (${otherHolds.map(h => `${h.reader_name} - Còn ${h.time_left_hours}h`).join(', ')}).\n\nToàn bộ ${availCount} bản sao trên kệ hiện đã có người giữ chỗ chờ đến nhận.\n👉 Vui lòng để lại sách trên kệ cho bạn đọc đã hẹn trước. Bạn có thể sử dụng tính năng "Đặt trước sách" để xếp hàng mượn khi có sách sẵn sàng!`,
                    isHeld: true,
                    allCopiesHeld: true,
                    bookTitle: copy.book_title,
                    bookId: copy.book_id,
                    copyQr: copy.qr_code,
                    holdCount: otherHolds.length,
                    holds: otherHolds
                });
            }
        }

        // 2. Tìm hoặc tạo draft active cho độc giả
        const [activeDrafts] = await db.execute(
            "SELECT id, draft_code FROM borrow_drafts WHERE user_id = ? AND status = 'pending' AND expires_at > NOW()",
            [userId]
        );

        let draftId;
        let draftCode;

        if (activeDrafts.length > 0) {
            draftId = activeDrafts[0].id;
            draftCode = activeDrafts[0].draft_code;
        } else {
            // Hủy các phiếu cũ nếu có
            await db.execute(
                "UPDATE borrow_drafts SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'",
                [userId]
            );
            const randomSalt = Math.floor(100 + Math.random() * 900);
            draftCode = `DRAFT-BRW-${Date.now().toString().slice(-5)}${randomSalt}-${userId}`;

            const [draftResult] = await db.execute(
                `INSERT INTO borrow_drafts (draft_code, user_id, status, notes, expires_at)
                 VALUES (?, ?, 'pending', 'Mượn trực tiếp tại kệ', DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
                [draftCode, userId]
            );
            draftId = draftResult.insertId;
        }

        // 3. Kiểm tra xem bản sao này đã có trong draft chưa
        const [existingItems] = await db.execute(
            "SELECT id, book_id, book_copy_id FROM borrow_draft_items WHERE draft_id = ?",
            [draftId]
        );

        const isCopyAlreadyInDraft = existingItems.some(it => it.book_copy_id === copy.id);
        if (isCopyAlreadyInDraft) {
            return res.status(400).json({ message: `Cuốn sách «${copy.book_title}» (${copy.qr_code}) đã có trong giỏ mượn của bạn rồi!` });
        }

        // Kiểm tra xem độc giả đã thêm cuốn sách này (cùng book_id) chưa
        const isBookAlreadyInDraft = existingItems.some(it => it.book_id === copy.book_id);
        if (isBookAlreadyInDraft) {
            // Cập nhật gán copy_id cho mục này nếu chưa có
            const unassignedItem = existingItems.find(it => it.book_id === copy.book_id && !it.book_copy_id);
            if (unassignedItem) {
                await db.execute(
                    "UPDATE borrow_draft_items SET book_copy_id = ? WHERE id = ?",
                    [copy.id, unassignedItem.id]
                );
                return res.status(200).json({
                    message: `Đã đối soát bản sao «${copy.book_title}» (${copy.qr_code}) vào phiếu mượn!`,
                    draftCode
                });
            } else {
                return res.status(400).json({ message: `Bạn đã thêm đầu sách «${copy.book_title}» vào phiếu mượn rồi!` });
            }
        }

        // 4. Kiểm tra điều kiện mượn với tổng số sách mới
        const totalItemsCount = existingItems.length + 1;
        const eligibility = await checkBorrowEligibility(userId, totalItemsCount);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }

        // 5. Thêm bản sao vào draft với book_copy_id đã được xác thực sẵn
        await db.execute(
            `INSERT INTO borrow_draft_items (draft_id, book_id, book_copy_id, status) VALUES (?, ?, ?, 'pending')`,
            [draftId, copy.book_id, copy.id]
        );

        // Tạm giữ 1 suất available_copies cho cuốn sách vừa nhặt vào giỏ mượn
        await db.execute(
            `UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?`,
            [copy.book_id]
        );

        // Gia hạn 24 giờ cho draft
        await db.execute(
            `UPDATE borrow_drafts SET expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ?`,
            [draftId]
        );

        // Lấy lại danh sách items cập nhật
        const [updatedItems] = await db.execute(`
            SELECT di.id as item_id, di.book_id, di.book_copy_id, di.status as item_status,
                   b.title as book_title, b.isbn, b.cover_image, b.available_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
                   bc.qr_code as copy_qr_code, bc.status as copy_status
            FROM borrow_draft_items di
            JOIN books b ON di.book_id = b.id
            LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
            WHERE di.draft_id = ?
        `, [draftId]);

        res.status(200).json({
            message: `Đã thêm cuốn «${copy.book_title}» (${copy.qr_code}) vào giỏ mượn tại chỗ!`,
            draftCode,
            draftId,
            items: updatedItems,
            allVerified: updatedItems.every(it => it.book_copy_id != null),
            hasHoldNotice: otherHolds.length > 0,
            holds: otherHolds,
            freeCopiesRemaining: Math.max(0, freeCopies - 1)
        });
    } catch (error) {
        console.error('Lỗi khi quét mượn trực tiếp tại kệ:', error);
        res.status(500).json({ message: 'Lỗi server khi thêm sách vào giỏ mượn' });
    }
};

// DELETE /api/borrow/drafts/items/:itemId
// Xóa một cuốn sách khỏi phiếu mượn nháp
exports.removeDraftItem = async (req, res) => {
    const { itemId } = req.params;
    const userId = req.user.id;
    try {
        const [items] = await db.execute(`
            SELECT di.*, d.user_id, d.id as draft_id
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            WHERE di.id = ?
        `, [itemId]);

        if (items.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy mục sách trong phiếu' });
        }

        if (req.user.role === 'reader' && items[0].user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa phiếu này' });
        }

        await db.execute('DELETE FROM borrow_draft_items WHERE id = ?', [itemId]);

        // Hoàn trả lại 1 suất available_copies cho đầu sách
        await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [items[0].book_id]);

        // If no items left in draft, cancel draft
        const [remaining] = await db.execute('SELECT COUNT(*) as count FROM borrow_draft_items WHERE draft_id = ?', [items[0].draft_id]);
        if ((remaining[0]?.count || 0) === 0) {
            await db.execute("UPDATE borrow_drafts SET status = 'cancelled' WHERE id = ?", [items[0].draft_id]);
        }

        res.status(200).json({ message: 'Đã xóa cuốn sách khỏi phiếu mượn' });
    } catch (error) {
        console.error('Lỗi khi xóa mục trong phiếu mượn:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// POST /api/borrow/drafts/:code/approve
// BƯỚC 3: THỦ THƯ DUYỆT 1 LẦN DUY NHẤT: Xuất kho toàn bộ sách trong phiếu mượn nháp
exports.approveBorrowDraft = async (req, res) => {
    const { code } = req.params;
    const { copyOverrides } = req.body || {}; // Optional map: { [bookId: number]: string (copyQr) }
    const processedBy = req.user.id;

    try {
        const cleanCode = decodeURIComponent(code || '').trim();
        const [drafts] = await db.execute(`
            SELECT d.*, u.full_name as reader_name, u.card_number, u.email as reader_email
            FROM borrow_drafts d
            JOIN users u ON d.user_id = u.id
            WHERE d.draft_code = ? OR d.id = ?
        `, [cleanCode, parseInt(cleanCode, 10) || 0]);

        if (drafts.length === 0) {
            return res.status(404).json({ message: `Không tìm thấy phiếu mượn nháp với mã [${cleanCode}]` });
        }

        const draft = drafts[0];
        if (draft.status === 'approved') {
            return res.status(400).json({ message: 'Phiếu mượn nháp này đã được duyệt trao sách trước đó' });
        }
        if (draft.status === 'cancelled') {
            return res.status(400).json({ message: 'Phiếu mượn nháp này đã bị hủy bỏ' });
        }
        if (new Date(draft.expires_at) < new Date()) {
            await db.execute("UPDATE borrow_drafts SET status = 'expired' WHERE id = ?", [draft.id]);
            return res.status(400).json({ message: 'Phiếu mượn nháp này đã hết hạn 24 giờ. Vui lòng tạo phiếu mới!' });
        }

        // 1. Lấy danh sách sách trong phiếu
        const [items] = await db.execute(`
            SELECT di.*, b.title as book_title, b.available_copies
            FROM borrow_draft_items di
            JOIN books b ON di.book_id = b.id
            WHERE di.draft_id = ?
        `, [draft.id]);

        if (items.length === 0) {
            return res.status(400).json({ message: 'Phiếu mượn không có đầu sách nào' });
        }

        // 2. Kiểm tra quy chế mượn của độc giả & giới hạn số lượng sách (items.length)
        const eligibility = await checkBorrowEligibility(draft.user_id, items.length);
        if (!eligibility.allowed) {
            return res.status(400).json({ message: eligibility.message });
        }

        const maxBorrowDays = eligibility.maxBorrowDays;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);
        const dueDateStr = dueDate.toISOString().slice(0, 10);

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const approvedRecords = [];

            for (const item of items) {
                let chosenCopy = null;

                // Priority 1: If librarian explicitly provided a verified physical copy QR for this book
                if (copyOverrides && copyOverrides[item.book_id]) {
                    const providedQr = copyOverrides[item.book_id].trim();
                    const [specificCopies] = await connection.execute(
                        'SELECT * FROM book_copies WHERE qr_code = ? AND book_id = ? LIMIT 1 FOR UPDATE',
                        [providedQr, item.book_id]
                    );
                    if (specificCopies.length > 0 && specificCopies[0].status === 'available') {
                        chosenCopy = specificCopies[0];
                    } else {
                        await connection.rollback();
                        return res.status(400).json({
                            message: `Mã bản sao [${providedQr}] không hợp lệ hoặc không thuộc cuốn «${item.book_title}» hoặc không ở trạng thái sẵn sàng!`
                        });
                    }
                }

                // Priority 2: Use the physical copy that the reader already self-verified at the shelf!
                if (!chosenCopy && item.book_copy_id) {
                    const [preVerifiedCopies] = await connection.execute(
                        'SELECT * FROM book_copies WHERE id = ? AND book_id = ? AND status = "available" LIMIT 1 FOR UPDATE',
                        [item.book_copy_id, item.book_id]
                    );
                    if (preVerifiedCopies.length > 0) {
                        chosenCopy = preVerifiedCopies[0];
                    }
                }

                // Priority 3: Fallback - auto-pick first available copy
                if (!chosenCopy) {
                    const [availCopies] = await connection.execute(
                        'SELECT * FROM book_copies WHERE book_id = ? AND status = "available" LIMIT 1 FOR UPDATE',
                        [item.book_id]
                    );
                    if (availCopies.length === 0) {
                        await connection.rollback();
                        return res.status(400).json({
                            message: `Đầu sách «${item.book_title}» hiện không còn bản sao nào sẵn có trong kho để xuất mượn!`
                        });
                    }
                    chosenCopy = availCopies[0];
                }

                // Create borrow record
                const [recordRes] = await connection.execute(
                    `INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by, note)
                     VALUES (?, ?, ?, 'borrowing', ?, ?)`,
                    [draft.user_id, chosenCopy.id, dueDateStr, processedBy, `Mượn theo phiếu ${draft.draft_code}`]
                );

                // Update copy status
                await connection.execute(
                    `UPDATE book_copies SET status = 'borrowed' WHERE id = ?`,
                    [chosenCopy.id]
                );

                // Suất available_copies đã được tạm giữ ngay từ lúc tạo phiếu mượn / quét nhặt sách tại kệ
                // Khi thủ thư duyệt xuất kho, sách chuyển sang trạng thái 'borrowed' của độc giả mà không bị trừ trùng 2 lần.
                // Đồng bộ đóng mọi yêu cầu giữ chỗ online của độc giả này nếu có:
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [draft.user_id, item.book_id]
                );

                // Đồng bộ đóng mọi yêu cầu mượn online và đặt trước cùng đầu sách của độc giả này
                await connection.execute(
                    'UPDATE borrow_requests SET status = "borrowed" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [draft.user_id, item.book_id]
                );
                await connection.execute(
                    'UPDATE reservations SET status = "completed" WHERE user_id = ? AND book_id = ? AND status IN ("pending", "accepted", "ready")',
                    [draft.user_id, item.book_id]
                );

                // Update draft item
                await connection.execute(
                    `UPDATE borrow_draft_items SET status = 'borrowed', book_copy_id = ? WHERE id = ?`,
                    [chosenCopy.id, item.id]
                );

                approvedRecords.push({
                    recordId: recordRes.insertId,
                    bookTitle: item.book_title,
                    copyQr: chosenCopy.qr_code,
                    dueDate: dueDate.toLocaleDateString('vi-VN')
                });
            }

            // Update draft status
            await connection.execute(
                `UPDATE borrow_drafts SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?`,
                [processedBy, draft.id]
            );

            // Log activity
            await connection.execute(
                `INSERT INTO activity_logs (user_id, action, target_type, target_id, details)
                 VALUES (?, 'APPROVE_DRAFT_BORROW', 'borrow_drafts', ?, ?)`,
                [processedBy, draft.id, `Duyệt xuất kho ${items.length} cuốn sách theo phiếu ${draft.draft_code} cho độc giả ${draft.reader_name} (${draft.card_number})`]
            );

            // Notify reader
            await connection.execute(
                `INSERT INTO notifications (user_id, title, message, type)
                 VALUES (?, ?, ?, 'info')`,
                [
                    draft.user_id,
                    'Đã nhận sách thành công',
                    `Thủ thư đã duyệt xuất kho thành công ${items.length} cuốn sách theo phiếu ${draft.draft_code}. Hạn trả sách: ${dueDate.toLocaleDateString('vi-VN')}. Chúc bạn đọc sách vui vẻ!`
                ]
            );

            // Notify staff
            await notifyAllStaff(
                'Xuất kho phiếu mượn thành công',
                `Thủ thư vừa duyệt xuất kho ${items.length} cuốn sách theo phiếu ${draft.draft_code} cho độc giả ${draft.reader_name} (${draft.card_number}).`,
                'info'
            );

            await connection.commit();

            const exitPass = await issueExitPass(draft.user_id, approvedRecords.map(r => ({
                book_id: r.bookId,
                title: r.bookTitle,
                qr_code: r.copyQr
            })), processedBy);

            res.status(200).json({
                message: `Đã duyệt và xuất kho thành công toàn bộ ${items.length} cuốn sách cho độc giả ${draft.reader_name}!`,
                draftCode: draft.draft_code,
                readerName: draft.reader_name,
                cardNumber: draft.card_number,
                dueDate: dueDate.toLocaleDateString('vi-VN'),
                booksCount: items.length,
                records: approvedRecords,
                exitPass
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi phê duyệt phiếu mượn nháp:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi phê duyệt phiếu mượn nháp' });
    }
};



// DELETE /api/borrow/drafts/:id
// Hủy phiếu mượn nháp
exports.cancelBorrowDraft = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const [drafts] = await db.execute('SELECT * FROM borrow_drafts WHERE id = ?', [id]);
        if (drafts.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn nháp' });
        }

        const draft = drafts[0];
        if (userRole === 'reader' && draft.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền hủy phiếu mượn của người khác' });
        }

        if (draft.status !== 'pending') {
            return res.status(400).json({ message: `Phiếu mượn đang ở trạng thái "${draft.status}", không thể hủy` });
        }

        // Hoàn trả lại available_copies cho tất cả các sách trong draft items
        const [pendingItems] = await db.execute(
            'SELECT book_id FROM borrow_draft_items WHERE draft_id = ? AND status = "pending"',
            [id]
        );
        for (const item of pendingItems) {
            await db.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [item.book_id]);
        }

        await db.execute("UPDATE borrow_draft_items SET status = 'unavailable' WHERE draft_id = ? AND status = 'pending'", [id]);
        await db.execute("UPDATE borrow_drafts SET status = 'cancelled' WHERE id = ?", [id]);
        res.status(200).json({ message: 'Đã hủy phiếu mượn nháp thành công' });
    } catch (error) {
        console.error('Lỗi khi hủy phiếu mượn nháp:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// POST /api/borrow/batch-return-preview
// Xem trước thông tin gom trả nhiều cuốn sách (qua mã QR gom hoặc danh sách recordIds)
exports.previewBatchReturn = async (req, res) => {
    let { batchCode, recordIds } = req.body;
    try {
        let targetIds = [];
        if (batchCode) {
            const raw = batchCode.toString().trim();
            const match = raw.match(/RETURN-BATCH-(?:U\d+-)?([0-9,]+)/i) || raw.match(/RTN-(?:BATCH-)?([0-9,]+)/i);
            if (match) {
                targetIds = match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            } else if (raw.startsWith('{') && raw.endsWith('}')) {
                try {
                    const parsed = JSON.parse(raw);
                    targetIds = parsed.recordIds || parsed.ids || [];
                } catch (e) {}
            }
        } else if (Array.isArray(recordIds)) {
            targetIds = recordIds.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        }

        if (!targetIds || targetIds.length === 0) {
            return res.status(400).json({ message: 'Không tìm thấy danh sách mã phiếu mượn hợp lệ' });
        }

        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');

        const placeholders = targetIds.map(() => '?').join(',');
        const [records] = await db.execute(`
            SELECT br.*, bc.qr_code, bc.id as book_copy_id, b.title as book_title, b.cover_image, b.id as book_id,
                   u.id as reader_id, u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.id IN (${placeholders})
        `, targetIds);

        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin các phiếu mượn này' });
        }

        let totalFine = 0;
        let hasOverdue = false;
        const books = [];

        for (const r of records) {
            const { overdueDays, fineAmount } = calculateOverdue(r.due_date, finePerDay);
            const isOverdue = overdueDays > 0;
            const isAlreadyReturned = r.status === 'returned';

            const [fines] = await db.execute('SELECT * FROM fines WHERE borrow_record_id = ? AND status = "paid"', [r.id]);
            const isFinePaid = fines.length > 0;

            if (isOverdue && !isFinePaid && !isAlreadyReturned) {
                totalFine += fineAmount;
                hasOverdue = true;
            }

            books.push({
                recordId: r.id,
                bookId: r.book_id,
                bookTitle: r.book_title,
                qrCode: r.qr_code,
                coverImage: r.cover_image,
                borrowDate: r.borrow_date,
                dueDate: r.due_date,
                status: r.status,
                isReturned: isAlreadyReturned,
                overdueDays,
                fineAmount,
                isFinePaid,
                isOverdue
            });
        }

        const reader = {
            id: records[0].reader_id,
            fullName: records[0].reader_name,
            cardNumber: records[0].card_number,
            email: records[0].reader_email,
            phone: records[0].reader_phone
        };

        res.status(200).json({
            reader,
            books,
            totalFine,
            hasOverdue,
            activeCount: books.filter(b => !b.isReturned).length,
            batchCode: batchCode || `RETURN-BATCH-${targetIds.join(',')}`
        });
    } catch (error) {
        console.error('Lỗi khi xem trước trả hàng loạt:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi xem trước trả hàng loạt' });
    }
};

// POST /api/borrow/batch-return
// Thủ thư xác nhận nhận trả hàng loạt N cuốn sách trong 1 lần
exports.batchReturnBooks = async (req, res) => {
    const { recordIds, batchCode, confirmPaidFine, paymentMethod } = req.body;
    const processedBy = req.user.id;

    try {
        let targetIds = [];
        if (Array.isArray(recordIds) && recordIds.length > 0) {
            targetIds = recordIds.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        } else if (batchCode) {
            const raw = batchCode.toString().trim();
            const match = raw.match(/RETURN-BATCH-(?:U\d+-)?([0-9,]+)/i) || raw.match(/RTN-(?:BATCH-)?([0-9,]+)/i);
            if (match) {
                targetIds = match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            }
        }

        if (!targetIds || targetIds.length === 0) {
            return res.status(400).json({ message: 'Vui lòng cung cấp danh sách mã phiếu mượn cần trả' });
        }

        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const placeholders = targetIds.map(() => '?').join(',');
            const [records] = await connection.execute(`
                SELECT br.*, bc.id as book_copy_id, bc.book_id, bc.qr_code, b.title as book_title, u.id as reader_id, u.full_name as reader_name
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                JOIN users u ON br.user_id = u.id
                WHERE br.id IN (${placeholders}) AND br.status = 'borrowing'
            `, targetIds);

            if (records.length === 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({ message: 'Không có phiếu mượn nào ở trạng thái đang mượn để nhận trả' });
            }

            let totalCollectedFine = 0;
            const returnedList = [];

            for (const record of records) {
                const { overdueDays, fineAmount } = calculateOverdue(record.due_date, finePerDay);

                // Update borrow record
                await connection.execute(
                    'UPDATE borrow_records SET return_date = NOW(), status = "returned" WHERE id = ?',
                    [record.id]
                );

                // Update copy status
                await connection.execute(
                    'UPDATE book_copies SET status = "available" WHERE id = ?',
                    [record.book_copy_id]
                );

                // Increment book available count
                await connection.execute(
                    'UPDATE books SET available_copies = available_copies + 1 WHERE id = ?',
                    [record.book_id]
                );

                // Handle fines if overdue
                if (overdueDays > 0) {
                    const [existingFines] = await connection.execute(
                        'SELECT * FROM fines WHERE borrow_record_id = ?',
                        [record.id]
                    );
                    const isAlreadyPaid = existingFines.length > 0 && existingFines[0].status === 'paid';

                    if (!isAlreadyPaid && confirmPaidFine) {
                        totalCollectedFine += fineAmount;
                        if (existingFines.length > 0) {
                            await connection.execute(
                                'UPDATE fines SET amount = ?, reason = ?, status = "paid", paid_at = NOW(), payment_method = ? WHERE borrow_record_id = ?',
                                [fineAmount, `Trả trễ hạn ${overdueDays} ngày`, paymentMethod || 'cash', record.id]
                            );
                        } else {
                            await connection.execute(
                                'INSERT INTO fines (borrow_record_id, user_id, amount, reason, status, paid_at, payment_method, payment_channel) VALUES (?, ?, ?, ?, "paid", NOW(), ?, "counter")',
                                [record.id, record.reader_id, fineAmount, `Trả trễ hạn ${overdueDays} ngày`, paymentMethod || 'cash']
                            );
                        }
                    }
                }

                returnedList.push({
                    recordId: record.id,
                    bookTitle: record.book_title,
                    qrCode: record.qr_code
                });
            }

            await connection.commit();
            connection.release();

            // Notify reader
            notifyUser(records[0].reader_id, {
                title: 'Hoàn tất trả sách vào kho',
                message: `Thủ thư đã tiếp nhận và hoàn tất thủ tục trả ${returnedList.length} cuốn sách vào kho thư viện. Hạn mức mượn của bạn đã được giải phóng!`,
                type: 'system',
                link: '/borrow'
            });

            res.status(200).json({
                success: true,
                message: `Đã nhận trả thành công toàn bộ ${returnedList.length} cuốn sách vào kho cho độc giả ${records[0].reader_name}!`,
                returnedCount: returnedList.length,
                totalFine: totalCollectedFine,
                readerName: records[0].reader_name,
                returnedBooks: returnedList
            });
        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }
    } catch (error) {
        console.error('Lỗi khi nhận trả hàng loạt:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi nhận trả hàng loạt' });
    }
};

exports.getActiveHoldsForBook = getActiveHoldsForBook;
exports.cleanupAllExpiredHolds = cleanupAllExpiredHolds;

// =========================================================================
// HELPER: Tự động cấp Vé thông hành ra cửa (Digital Exit Pass)
// =========================================================================
async function issueExitPass(userId, booksArray, callerId = null) {
    try {
        if (!userId || !Array.isArray(booksArray) || booksArray.length === 0) return null;

        // Tự động hết hạn mọi vé cũ chưa dùng của bạn đọc này
        await db.execute('UPDATE exit_passes SET status = "expired" WHERE user_id = ? AND status = "active"', [userId]);

        const timestamp = Date.now().toString().slice(-6);
        const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
        const passCode = `PASS-EXP-${timestamp}-${randomStr}`;
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // Có hiệu lực 30 phút

        const summary = booksArray.map(b => ({
            bookId: b.book_id || b.book_real_id || b.id,
            title: b.title || b.book_title,
            copyQr: b.qr_code || b.copy_qr,
            coverImage: b.cover_image || null
        }));

        const [res] = await db.execute(`
            INSERT INTO exit_passes (pass_code, user_id, book_count, items_summary, status, expires_at)
            VALUES (?, ?, ?, ?, 'active', ?)
        `, [passCode, userId, summary.length, JSON.stringify(summary), expiresAt]);

        // Gửi vé ra cửa qua email bạn đọc
        const [users] = await db.execute('SELECT full_name, email, card_number FROM users WHERE id = ?', [userId]);
        if (users.length > 0 && users[0].email) {
            const emailService = require('../services/emailService');
            emailService.sendExitPassEmail({
                to: users[0].email,
                userId,
                fullName: users[0].full_name,
                cardNumber: users[0].card_number,
                passCode,
                bookCount: summary.length,
                books: summary,
                expiresAt
            }).catch(e => console.error('Lỗi khi gửi email vé ra cửa:', e.message));
        }

        return {
            id: res.insertId,
            passCode,
            bookCount: summary.length,
            items: summary,
            status: 'active',
            expiresAt: expiresAt.toISOString()
        };
    } catch (err) {
        console.error('Lỗi khi tạo vé thông hành ra cửa:', err);
        return null;
    }
}
exports.issueExitPass = issueExitPass;

// =========================================================================
// 1. NGHIỆP VỤ HÒM TRẢ SÁCH TỰ ĐỘNG 24/7 (SMART BOOK DROP)
// =========================================================================

// POST /api/borrow/drop-box-return
// Độc giả hoặc khách thả sách vào hòm ngoài giờ 24/7
exports.dropBoxReturn = async (req, res) => {
    let { bookQrCode, readerCardNumber, note } = req.body;
    const callerId = req.user.id;
    const isReader = req.user.role === 'reader';

    try {
        let targetQr = (bookQrCode || '').toString().trim();
        if (targetQr.startsWith('{') && targetQr.endsWith('}')) {
            try {
                const parsed = JSON.parse(targetQr);
                targetQr = (parsed.bookQrCode || parsed.qrCode || parsed.copyQr || parsed.code || targetQr).toString().trim();
            } catch (e) {}
        }

        if (!targetQr) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR trên gáy/bìa sách cần thả vào hòm' });
        }

        // 1. Tìm bản sao sách
        const [copies] = await db.execute(`
            SELECT bc.*, b.title, b.id as book_real_id, b.cover_image,
                   br.id as active_borrow_id, br.user_id as borrower_id, br.due_date,
                   u.full_name as borrower_name, u.email as borrower_email, u.card_number as borrower_card
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status IN ('borrowing', 'returned_drop_box')
            LEFT JOIN users u ON br.user_id = u.id
            WHERE bc.qr_code = ?
        `, [targetQr]);

        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy mã sách này trong cơ sở dữ liệu thư viện' });
        }
        const copy = copies[0];

        if (!copy.active_borrow_id) {
            return res.status(400).json({
                message: `Bản sao sách [${copy.qr_code}] của cuốn «${copy.title}» hiện không có giao dịch mượn đang hoạt động.`
            });
        }

        // Nếu sách đã ở trong hòm và đang chờ thủ thư kiểm tra
        if (copy.status === 'borrowed' && copy.active_borrow_id) {
            const [existingDrop] = await db.execute(
                'SELECT id, drop_box_at, drop_box_status FROM borrow_records WHERE id = ?',
                [copy.active_borrow_id]
            );
            if (existingDrop.length > 0 && existingDrop[0].drop_box_status === 'pending_audit') {
                return res.status(400).json({
                    message: `Cuốn sách «${copy.title}» đã được ghi nhận thả vào Hòm trả 24/7 lúc ${new Date(existingDrop[0].drop_box_at).toLocaleString('vi-VN')} và đang chờ thủ thư đối soát!`
                });
            }
        }

        // Nếu bạn đọc tự trả, kiểm tra đúng người mượn
        if (isReader && copy.borrower_id !== callerId) {
            return res.status(403).json({
                message: `Cuốn sách này đang được mượn bởi độc giả ${copy.borrower_name} (${copy.borrower_card}), bạn không thể thao tác trả thay!`
            });
        }

        // 2. Tính toán ngày quá hạn & tiền phạt (chốt tại thời điểm thả hòm)
        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000', 10);
        const { overdueDays, fineAmount } = calculateOverdue(copy.due_date, finePerDay);

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            const dropTime = new Date();

            // 3. Cập nhật phiếu mượn sang trạng thái 'returned_drop_box'
            await connection.execute(`
                UPDATE borrow_records 
                SET status = 'returned_drop_box',
                    is_drop_box = 1,
                    drop_box_at = NOW(),
                    drop_box_status = 'pending_audit',
                    drop_box_audit_note = ?
                WHERE id = ?
            `, [note || 'Trả qua Hòm thông minh 24/7 ngoài giờ', copy.active_borrow_id]);

            // Giữ bản sao ở trạng thái an toàn (không cho mượn lại trên kệ đến khi thủ thư gom hòm kiểm tra)
            await connection.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy.id]);

            // Ghi nhật ký hệ thống
            await connection.execute(`
                INSERT INTO activity_logs (user_id, action, target_type, target_id, details)
                VALUES (?, 'DROP_BOX_RETURN', 'borrow_records', ?, ?)
            `, [
                copy.borrower_id,
                copy.active_borrow_id,
                `Độc giả thả sách «${copy.title}» vào Hòm trả sách 24/7 (Mã sách: ${copy.qr_code})`
            ]);

            // Gửi thông báo in-app cho độc giả
            await connection.execute(`
                INSERT INTO notifications (user_id, title, message, type)
                VALUES (?, 'Biên nhận thả sách Hòm 24/7', ?, 'info')
            `, [
                copy.borrower_id,
                `Hệ thống đã tiếp nhận cuốn sách "${copy.title}" (Mã: ${copy.qr_code}) vào Hòm trả sách 24/7 lúc ${dropTime.toLocaleTimeString('vi-VN')}. Phí phạt (nếu có) đã ngưng tính từ thời điểm này. Thủ thư sẽ đối soát tình trạng sách vào đầu ca sáng mai.`
            ]);

            // Báo cho toàn bộ nhân viên thủ thư
            await notifyAllStaff(
                '📦 Sách mới trong Hòm trả 24/7',
                `Độc giả ${copy.borrower_name} vừa thả cuốn "${copy.title}" (Mã: ${copy.qr_code}) vào Hòm trả sách 24/7. Vui lòng đối soát vào đầu ca sáng.`,
                'info'
            );

            await connection.commit();

            // 4. Gửi email biên nhận đa kênh cho bạn đọc
            if (copy.borrower_email) {
                const emailService = require('../services/emailService');
                emailService.sendDropBoxReceiptEmail({
                    to: copy.borrower_email,
                    userId: copy.borrower_id,
                    fullName: copy.borrower_name,
                    cardNumber: copy.borrower_card,
                    bookTitle: copy.title,
                    copyQr: copy.qr_code,
                    droppedAt: dropTime
                }).catch(e => console.error('Lỗi khi gửi email biên nhận hòm 24/7:', e.message));
            }

            res.status(200).json({
                success: true,
                message: `Đã ghi nhận gửi trả sách "${copy.title}" ngoài giờ thành công! Hệ thống đã ngưng tính hạn trả.`,
                data: {
                    recordId: copy.active_borrow_id,
                    bookTitle: copy.title,
                    copyQr: copy.qr_code,
                    borrowerName: copy.borrower_name,
                    cardNumber: copy.borrower_card,
                    droppedAt: dropTime.toISOString(),
                    overdueDays,
                    fineAmount
                }
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi trả sách qua hòm 24/7:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi trả sách qua hòm 24/7' });
    }
};

// GET /api/borrow/drop-box-items
// Thủ thư lấy danh sách sách hiện đang có trong Hòm 24/7 chờ đối soát
exports.getDropBoxItems = async (req, res) => {
    try {
        const [items] = await db.execute(`
            SELECT br.id as record_id, br.borrow_date, br.due_date, br.status,
                   br.drop_box_at, br.drop_box_status, br.drop_box_audit_note,
                   bc.id as copy_id, bc.qr_code as copy_qr,
                   b.id as book_id, b.title as book_title, b.cover_image, b.isbn,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as book_location,
                   u.id as reader_id, u.full_name as reader_name, u.card_number, u.phone as reader_phone, u.email as reader_email
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.drop_box_status = 'pending_audit' OR br.status = 'returned_drop_box'
            ORDER BY br.drop_box_at ASC
        `);

        // Bổ sung tính toán phí phạt quá hạn tại thời điểm thả hòm
        const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
        const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000', 10);

        const enrichedItems = items.map(it => {
            const dropDate = it.drop_box_at ? new Date(it.drop_box_at) : new Date();
            const dueDate = new Date(it.due_date);
            let overdueDays = 0;
            if (dropDate > dueDate) {
                const diffTime = dropDate.getTime() - dueDate.getTime();
                overdueDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }
            return {
                ...it,
                overdueDays,
                fineAmount: overdueDays * finePerDay
            };
        });

        res.status(200).json(enrichedItems);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách sách trong hòm 24/7:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách hòm 24/7' });
    }
};

// POST /api/borrow/drop-box-audit
// Thủ thư đối soát sách trong hòm: 'verify_intact' (nguyên vẹn) | 'report_damaged' (hư hại) | 'report_missing' (thiếu sách)
exports.auditDropBoxItem = async (req, res) => {
    const { recordId, action, auditNote, damageFee } = req.body;
    const auditorId = req.user.id;

    if (!recordId || !action) {
        return res.status(400).json({ message: 'Thiếu thông tin đối soát sách hòm 24/7' });
    }

    try {
        const [records] = await db.execute(`
            SELECT br.*, bc.id as copy_id, bc.qr_code, bc.book_id,
                   b.title as book_title, u.id as reader_id, u.full_name as reader_name, u.email as reader_email
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.id = ?
        `, [recordId]);

        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
        }
        const record = records[0];

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            if (action === 'verify_intact') {
                // Sách nguyên vẹn: Hoàn tất trả sách chính thức
                await connection.execute(`
                    UPDATE borrow_records 
                    SET status = 'returned',
                        return_date = IFNULL(drop_box_at, NOW()),
                        drop_box_status = 'verified_intact',
                        drop_box_audited_by = ?,
                        drop_box_audited_at = NOW(),
                        drop_box_audit_note = ?
                    WHERE id = ?
                `, [auditorId, auditNote || 'Sách nguyên vẹn đạt chuẩn lưu kho', record.id]);

                // Bản sao chuyển về available
                await connection.execute('UPDATE book_copies SET status = "available" WHERE id = ?', [record.copy_id]);

                // Tăng số lượng available_copies
                await connection.execute('UPDATE books SET available_copies = available_copies + 1 WHERE id = ?', [record.book_id]);

                // Thông báo bạn đọc
                await connection.execute(`
                    INSERT INTO notifications (user_id, title, message, type)
                    VALUES (?, 'Hoàn tất đối soát sách trả ngoài giờ', ?, 'info')
                `, [
                    record.reader_id,
                    `Thủ thư đã kiểm đếm và đối soát thành công cuốn sách "${record.book_title}" gửi ngoài giờ. Sách nguyên vẹn, giao dịch trả sách đã hoàn tất thành công!`
                ]);
            } else if (action === 'report_damaged') {
                // Sách bị rách bìa, vẽ bậy, ướt nước: Lập biên bản phạt
                const fee = parseInt(damageFee || '50000', 10);

                await connection.execute(`
                    UPDATE borrow_records 
                    SET status = 'returned',
                        return_date = IFNULL(drop_box_at, NOW()),
                        drop_box_status = 'damaged',
                        drop_box_audited_by = ?,
                        drop_box_audited_at = NOW(),
                        drop_box_audit_note = ?
                    WHERE id = ?
                `, [auditorId, auditNote || 'Phát hiện sách hư hại/rách trang khi kiểm kê sách trả ngoài giờ', record.id]);

                await connection.execute('UPDATE book_copies SET status = "damaged", condition_note = ? WHERE id = ?', [
                    auditNote || 'Hư hỏng khi trả ngoài giờ',
                    record.copy_id
                ]);

                // Tạo khoản phạt hư hỏng
                await connection.execute(`
                    INSERT INTO fines (borrow_record_id, user_id, amount, reason, status, created_at)
                    VALUES (?, ?, ?, ?, 'unpaid', NOW())
                `, [
                    record.id,
                    record.reader_id,
                    fee,
                    `Phạt hư hại sách khi trả ngoài giờ («${record.book_title}»): ${auditNote || 'Rách/hỏng bìa trang'}`
                ]);

                // Thông báo bạn đọc
                await connection.execute(`
                    INSERT INTO notifications (user_id, title, message, type)
                    VALUES (?, 'Biên bản phạt hư hại sách (Trả ngoài giờ)', ?, 'warning')
                `, [
                    record.reader_id,
                    `Thủ thư phát hiện cuốn sách "${record.book_title}" bạn gửi trả ngoài giờ có dấu hiệu hư hại: "${auditNote}". Phí phạt bồi hoàn: ${fee.toLocaleString('vi-VN')}đ. Vui lòng vào mục Phí phạt để thanh toán.`
                ]);
            } else if (action === 'report_missing') {
                // Không tìm thấy sách trong hòm
                await connection.execute(`
                    UPDATE borrow_records 
                    SET status = 'borrowing',
                        drop_box_status = 'missing',
                        drop_box_audited_by = ?,
                        drop_box_audited_at = NOW(),
                        drop_box_audit_note = ?
                    WHERE id = ?
                `, [auditorId, auditNote || 'Thủ thư kiểm kê không tìm thấy cuốn sách này trong hòm', record.id]);

                await connection.execute(`
                    INSERT INTO notifications (user_id, title, message, type)
                    VALUES (?, 'Cảnh báo đối soát sách trả ngoài giờ', ?, 'warning')
                `, [
                    record.reader_id,
                    `CẢNH BÁO: Thủ thư kiểm kê hòm trả ngoài giờ không tìm thấy cuốn sách "${record.book_title}". Phiếu mượn đã được hoàn tác về ĐANG MƯỢN. Vui lòng liên hệ quầy để đối soát lại!`
                ]);
            }

            // Ghi log
            await connection.execute(`
                INSERT INTO activity_logs (user_id, action, target_type, target_id, details)
                VALUES (?, 'DROP_BOX_AUDIT', 'borrow_records', ?, ?)
            `, [
                auditorId,
                record.id,
                `Thủ thư đối soát hòm 24/7 cho cuốn «${record.book_title}»: ${action} (${auditNote || '---'})`
            ]);

            await connection.commit();

            res.status(200).json({
                success: true,
                message: `Đã hoàn tất đối soát cuốn sách "${record.book_title}" (${action})!`
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi đối soát hòm trả sách 24/7:', error);
        res.status(500).json({ message: 'Lỗi server khi đối soát hòm 24/7' });
    }
};

// =========================================================================
// 2. NGHIỆP VỤ VÉ THÔNG HÀNH RA CỬA (DIGITAL EXIT PASS / LOSS PREVENTION)
// =========================================================================

// GET /api/borrow/exit-passes/my-active
// Độc giả lấy vé ra cửa đang có hiệu lực của mình
exports.getMyActiveExitPass = async (req, res) => {
    const userId = req.user.id;

    try {
        const [passes] = await db.execute(`
            SELECT ep.*, u.full_name as reader_name, u.card_number, u.avatar_url
            FROM exit_passes ep
            JOIN users u ON ep.user_id = u.id
            WHERE ep.user_id = ? AND ep.status = 'active' AND ep.expires_at > NOW()
            ORDER BY ep.created_at DESC LIMIT 1
        `, [userId]);

        if (passes.length === 0) {
            return res.status(200).json(null);
        }

        const pass = passes[0];
        let items = [];
        try {
            items = typeof pass.items_summary === 'string' ? JSON.parse(pass.items_summary) : pass.items_summary;
        } catch (e) {}

        const now = new Date();
        const exp = new Date(pass.expires_at);
        const minutesLeft = Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 60000));

        res.status(200).json({
            ...pass,
            items,
            minutesLeft
        });
    } catch (error) {
        console.error('Lỗi khi lấy vé ra cửa:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy vé ra cửa' });
    }
};

// GET /api/borrow/exit-passes/active-list
// Bảo vệ / Thủ thư lấy danh sách các vé ra cửa đang hoạt động trong thư viện
exports.getActiveExitPassesList = async (req, res) => {
    try {
        const [passes] = await db.execute(`
            SELECT ep.*, u.full_name as reader_name, u.card_number, u.avatar_url, u.email
            FROM exit_passes ep
            JOIN users u ON ep.user_id = u.id
            ORDER BY ep.created_at DESC LIMIT 50
        `);

        const formatted = passes.map(p => {
            let items = [];
            try {
                items = typeof p.items_summary === 'string' ? JSON.parse(p.items_summary) : p.items_summary;
            } catch (e) {}
            const now = new Date();
            const exp = new Date(p.expires_at);
            const isExpired = p.status === 'active' && now > exp;
            return {
                ...p,
                items,
                status: isExpired ? 'expired' : p.status,
                minutesLeft: Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 60000))
            };
        });

        res.status(200).json(formatted);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách vé ra cửa:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách vé ra cửa' });
    }
};

// POST /api/borrow/exit-passes/verify
// Bảo vệ / Nhân viên trực cửa quét mã vé QR hoặc Thẻ Độc Giả (Universal Reader Card)
exports.verifyExitPass = async (req, res) => {
    let { passCode } = req.body;
    if (!passCode) {
        return res.status(400).json({ message: 'Vui lòng cung cấp mã vé ra cửa hoặc mã thẻ độc giả cần xác minh' });
    }

    try {
        let code = passCode.toString().trim();
        if (code.startsWith('{') && code.endsWith('}')) {
            try {
                const parsed = JSON.parse(code);
                code = parsed.passCode || parsed.code || parsed.cardNumber || parsed.card_number || code;
            } catch (e) {}
        }

        // 1. Tìm vé theo pass_code trực tiếp HOẶC theo mã thẻ độc giả / user id / email
        const [passes] = await db.execute(`
            SELECT ep.*, u.full_name as reader_name, u.card_number, u.avatar_url, u.email, u.phone
            FROM exit_passes ep
            JOIN users u ON ep.user_id = u.id
            WHERE ep.pass_code = ? OR u.card_number = ? OR u.id = ? OR u.email = ?
            ORDER BY ep.created_at DESC
            LIMIT 1
        `, [code, code, code, code]);

        if (passes.length === 0) {
            // Kiểm tra xem mã này có phải là thẻ của độc giả nhưng chưa có vé nào
            const [users] = await db.execute(`
                SELECT id, full_name, card_number FROM users 
                WHERE card_number = ? OR id = ? OR email = ?
                LIMIT 1
            `, [code, code, code]);

            if (users.length > 0) {
                return res.status(200).json({
                    valid: false,
                    status: 'no_pass',
                    message: `CHƯA CÓ BIÊN LAI: Độc giả ${users[0].full_name} (${users[0].card_number}) chưa hoàn tất thủ tục mượn sách hoặc không có biên lai điện tử nào đang hoạt động!`,
                    reader: users[0]
                });
            }

            return res.status(404).json({
                valid: false,
                message: `MÃ KHÔNG TỒN TẠI: Không tìm thấy biên lai mượn số hoặc thẻ độc giả [${code}] trên hệ thống!`
            });
        }

        const pass = passes[0];
        let items = [];
        try {
            items = typeof pass.items_summary === 'string' ? JSON.parse(pass.items_summary) : pass.items_summary;
        } catch (e) {}

        const now = new Date();
        const exp = new Date(pass.expires_at);
        const isTimeExpired = now > exp;

        if (pass.status === 'used') {
            return res.status(200).json({
                valid: false,
                status: 'used',
                message: `BIÊN LAI ĐÃ ĐƯỢC ĐỐI SOÁT: Biên lai này đã được nhân viên đối soát hoàn tất vào lúc ${new Date(pass.verified_at).toLocaleTimeString('vi-VN')}!`,
                pass: { ...pass, items }
            });
        }

        if (pass.status === 'expired' || isTimeExpired) {
            await db.execute('UPDATE exit_passes SET status = "expired" WHERE id = ?', [pass.id]).catch(() => {});
            return res.status(200).json({
                valid: false,
                status: 'expired',
                message: `BIÊN LAI ĐÃ HẾT HẠN: Biên lai điện tử này đã hết thời hạn hiệu lực lúc ${exp.toLocaleTimeString('vi-VN')}. Yêu cầu độc giả liên hệ quầy thủ thư để đối soát lại!`,
                pass: { ...pass, items }
            });
        }

        // Hợp lệ!
        const minutesLeft = Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / 60000));
        res.status(200).json({
            valid: true,
            status: 'active',
            message: `✅ BIÊN LAI HỢP LỆ: Xác nhận mượn đúng ${pass.book_count} cuốn sách.`,
            pass: {
                ...pass,
                items,
                minutesLeft
            }
        });
    } catch (error) {
        console.error('Lỗi khi kiểm tra biên lai:', error);
        res.status(500).json({ message: 'Lỗi server khi xác minh biên lai' });
    }
};

// POST /api/borrow/exit-passes/clear
// Thủ thư / Nhân viên nhấn "Xác nhận đối soát hoàn tất"
exports.clearExitPass = async (req, res) => {
    const { passCode, notes } = req.body;
    const verifiedBy = req.user.id;

    if (!passCode) {
        return res.status(400).json({ message: 'Thiếu mã biên lai hoặc mã thẻ độc giả' });
    }

    try {
        let code = passCode.toString().trim();
        if (code.startsWith('{') && code.endsWith('}')) {
            try {
                const parsed = JSON.parse(code);
                code = parsed.passCode || parsed.code || parsed.cardNumber || parsed.card_number || code;
            } catch (e) {}
        }

        const [passes] = await db.execute(`
            SELECT ep.*, u.full_name as reader_name, u.card_number
            FROM exit_passes ep
            JOIN users u ON ep.user_id = u.id
            WHERE ep.pass_code = ? OR u.card_number = ? OR u.id = ?
            ORDER BY ep.created_at DESC
            LIMIT 1
        `, [code, code, code]);

        if (passes.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy biên lai hoặc thẻ độc giả' });
        }
        const pass = passes[0];

        if (pass.status === 'used') {
            return res.status(400).json({ message: 'Biên lai này đã được xác nhận đối soát trước đó!' });
        }

        await db.execute(`
            UPDATE exit_passes 
            SET status = 'used',
                verified_by = ?,
                verified_at = NOW(),
                notes = ?
            WHERE id = ?
        `, [verifiedBy, notes || 'Nhân viên đã đối soát đúng số lượng và danh mục sách', pass.id]);

        // Ghi nhật ký
        await db.execute(`
            INSERT INTO activity_logs (user_id, action, target_type, target_id, details)
            VALUES (?, 'RECEIPT_VERIFIED', 'exit_passes', ?, ?)
        `, [
            verifiedBy,
            pass.id,
            `Đối soát biên lai mượn số cho độc giả ${pass.reader_name} (${pass.book_count} cuốn sách theo mã ${pass.pass_code})`
        ]);

        // Thông báo bạn đọc
        await db.execute(`
            INSERT INTO notifications (user_id, title, message, type)
            VALUES (?, 'Đã hoàn tất đối soát biên lai mượn sách', ?, 'info')
        `, [
            pass.user_id,
            `Biên lai mượn sách (${pass.pass_code}) của bạn đã được nhân viên thư viện xác nhận đối soát hoàn tất. Chúc bạn đọc sách vui vẻ!`
        ]);

        res.status(200).json({
            success: true,
            message: `Đã xác nhận đối soát biên lai cho độc giả ${pass.reader_name} thành công!`
        });
    } catch (error) {
        console.error('Lỗi khi duyệt vé ra cửa:', error);
        res.status(500).json({ message: 'Lỗi server khi duyệt vé ra cửa' });
    }
};


