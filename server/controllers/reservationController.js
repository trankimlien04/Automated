const db = require('../config/db');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');
const { computeSmartWaitPrediction } = require('../utils/waitTimePredictor');
const { syncOverdueFines, getReaderCirculationStatus } = require('../services/fineSyncService');

/**
 * Helper: Tự động tạo hoặc thêm sách đặt trước (khi độc giả bấm "Đồng ý mượn")
 * vào Phiếu mượn nháp 24h (borrow_drafts + borrow_draft_items) giống hệt luồng Đăng ký mượn online.
 * Quy trình thống nhất: Đồng ý mượn -> Tạo Phiếu mượn nháp & Khóa giữ chỗ 1 bản sao (24h)
 * -> Độc giả đến kệ lấy sách & Quét Tem Sách Tại Kệ -> Tới quầy Thủ thư quét duyệt mượn!
 */
async function ensureDraftForAcceptedReservation(conn, userId, bookId, notes = 'Chuyển từ Đặt trước sách') {
    const [activeDrafts] = await conn.execute(
        `SELECT id, draft_code FROM borrow_drafts WHERE user_id = ? AND status = 'pending' AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
        [userId]
    );

    let draftId;
    let draftCode;

    if (activeDrafts.length > 0) {
        draftId = activeDrafts[0].id;
        draftCode = activeDrafts[0].draft_code;
        // Giữ nguyên thời hạn expires_at ban đầu của phiếu nháp, không reset lại 24h mỗi lần đồng bộ nền
    } else {
        const randomSalt = Math.floor(100 + Math.random() * 900);
        draftCode = `DRAFT-BRW-${Date.now().toString().slice(-5)}${randomSalt}-${userId}`;
        const [draftRes] = await conn.execute(
            `INSERT INTO borrow_drafts (draft_code, user_id, status, notes, expires_at)
             VALUES (?, ?, 'pending', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [draftCode, userId, notes]
        );
        draftId = draftRes.insertId;
    }

    const [existItems] = await conn.execute(
        `SELECT id FROM borrow_draft_items WHERE draft_id = ? AND book_id = ? AND status = 'pending'`,
        [draftId, bookId]
    );

    if (existItems.length === 0) {
        await conn.execute(
            `INSERT INTO borrow_draft_items (draft_id, book_id, book_copy_id, status)
             VALUES (?, ?, NULL, 'pending')`,
            [draftId, bookId]
        );
    }

    return { draftId, draftCode };
}

/**
 * Tự động đồng bộ hàng đợi đặt trước với tồn kho bản sao thực tế:
 * 1. Đồng bộ mọi phiếu đặt trước đã 'accepted' vào Phiếu mượn nháp 24h (borrow_drafts) nếu chưa có.
 * 2. Nếu một cuốn sách đang có người xếp hàng ('waiting', 'pending') NHƯNG trên kệ đang có bản sao rảnh
 *    (book_copies.status = 'available' chưa bị giữ bởi phiếu nháp 24h hay phiếu đặt trước khác),
 *    hệ thống lập tức chuyển người đứng đầu hàng chờ sang trạng thái 'notified' (Đã có sách - Giữ ưu tiên 48h).
 */
async function syncWaitingReservationsWithStock() {
    try {
        // BƯỚC A: Đảm bảo mọi phiếu đặt trước đang ở trạng thái 'accepted' (và chưa hết hạn 24h) đều nằm trong Phiếu mượn nháp của độc giả
        const [acceptedResvs] = await db.execute(`
            SELECT id, user_id, book_id
            FROM reservations
            WHERE status = 'accepted' AND (expires_at IS NULL OR expires_at > NOW())
        `);
        for (const acc of acceptedResvs) {
            await ensureDraftForAcceptedReservation(db, acc.user_id, acc.book_id);
        }

        // BƯỚC B: Kiểm tra các sách đang có người chờ ('waiting', 'pending') hoặc đang giữ chỗ
        const [targetBooks] = await db.execute(`
            SELECT DISTINCT r.book_id, b.title as book_title
            FROM reservations r
            JOIN books b ON r.book_id = b.id
            WHERE r.status IN ('waiting', 'pending', 'notified', 'accepted', 'ready')
        `);

        for (const wb of targetBooks) {
            const bookId = wb.book_id;

            // 1. Tổng số bản sao vật lý đang 'available' trên kệ
            const [physRows] = await db.execute(
                `SELECT COUNT(*) as cnt FROM book_copies WHERE book_id = ? AND status = 'available'`,
                [bookId]
            );
            const availPhysical = Number(physRows[0]?.cnt) || 0;

            // 2. Đếm số độc giả (distinct user_id) đang giữ chỗ hợp lệ cho cuốn sách này
            // (gộp chung giữa Phiếu mượn nháp 24h và Đặt trước 'notified'/'accepted'/'ready' để 1 độc giả không bị trừ 2 lần)
            const [holdUsers] = await db.execute(`
                SELECT DISTINCT user_id FROM (
                    SELECT d.user_id
                    FROM borrow_draft_items di
                    JOIN borrow_drafts d ON di.draft_id = d.id
                    WHERE di.book_id = ? AND di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
                    UNION ALL
                    SELECT r.user_id
                    FROM reservations r
                    WHERE r.book_id = ? AND r.status IN ('notified', 'accepted', 'ready')
                ) as combined_holds
            `, [bookId, bookId]);
            let activeHoldCount = holdUsers.length;

            // 3. Số bản sao thực sự còn tự do có thể phân bổ ngay cho người đang chờ trong hàng đợi
            const freeToAllocate = Math.max(0, availPhysical - activeHoldCount);

            if (freeToAllocate > 0) {
                const [waiters] = await db.execute(`
                    SELECT id, user_id
                    FROM reservations
                    WHERE book_id = ? AND status IN ('waiting', 'pending')
                    ORDER BY reservation_date ASC, id ASC
                    LIMIT ${freeToAllocate}
                `, [bookId]);

                for (const w of waiters) {
                    await db.execute(`
                        UPDATE reservations
                        SET status = 'notified',
                            notified_at = NOW(),
                            expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR)
                        WHERE id = ?
                    `, [w.id]);

                    await db.execute(
                        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'reminder')`,
                        [
                            w.user_id,
                            '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                            `Cuốn sách "${wb.book_title}" bạn đặt trước hiện đã có bản sao sẵn sàng tại thư viện và đang được giữ ưu tiên cho bạn trong 48 giờ. Hãy vào mục "Đặt trước sách" để bấm [Đồng ý mượn & Tạo Phiếu nháp 24h] nhé!`
                        ]
                    );
                    activeHoldCount++;
                }
            }

            // Đồng bộ lại books.available_copies phản ánh đúng số bản sao tự do
            const finalFreeCopies = Math.max(0, availPhysical - activeHoldCount);
            await db.execute(
                `UPDATE books SET available_copies = ? WHERE id = ?`,
                [finalFreeCopies, bookId]
            );
        }
    } catch (err) {
        console.error('Lỗi đồng bộ hàng đợi đặt trước với tồn kho:', err);
    }
}
exports.syncWaitingReservationsWithStock = syncWaitingReservationsWithStock;

exports.createReservation = async (req, res) => {
    const { bookId } = req.body;
    const userId = req.user.id;

    try {
        if (!bookId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã đầu sách đặt trước' });
        }

        // Check user active
        const [users] = await db.execute('SELECT full_name, card_number, email, status FROM users WHERE id = ?', [userId]);
        if (users.length === 0 || users[0].status !== 'active') {
            return res.status(403).json({ message: 'Tài khoản của bạn hiện không thể thực hiện đặt trước' });
        }
        const user = users[0];

        // Check book exists
        const [books] = await db.execute('SELECT title, available_copies, total_copies FROM books WHERE id = ?', [bookId]);
        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đầu sách này' });
        }
        const book = books[0];

        // ĐẶT TRƯỚC ÁP DỤNG KHI SÁCH ĐÃ HẾT BẢN SAO HOẶC TOÀN BỘ ĐÃ BỊ GIỮ CHỖ 24H
        const { getActiveHoldsForBook } = require('./borrowController');
        const activeHolds = await getActiveHoldsForBook(bookId);
        const [physCopies] = await db.execute(
            'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ? AND status = "available"',
            [bookId]
        );
        const availPhysCount = physCopies[0]?.count || 0;
        const otherHolds = activeHolds.filter(h => h.user_id !== userId);
        const freeCopies = Math.max(0, availPhysCount - otherHolds.length);

        if (book.available_copies > 0 && freeCopies > 0) {
            return res.status(400).json({
                message: `Đầu sách "${book.title}" hiện vẫn còn ${freeCopies} cuốn sẵn có tự do trên kệ! Vui lòng chọn "Mượn trực tiếp tại kệ" hoặc "Đăng ký online" thay vì đặt trước.`
            });
        }

        // Check multi-cause non-monetary circulation eligibility (OVERDUE / PENDING_REMEDIATION / SUSPENDED / ACCOUNT_LOCKED)
        await syncOverdueFines(userId);
        const circStatus = await getReaderCirculationStatus(userId);
        if (!circStatus) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin độc giả!' });
        }
        if (!circStatus.eligibleToReserve) {
            return res.status(400).json({
                message: `Không thể đặt trước sách: ${circStatus.reserveBlockReason || circStatus.blockReason}.`,
                circulationStatus: circStatus
            });
        }

        // Check if there is already an active reservation for this book by this user
        const [existing] = await db.execute(
            'SELECT id FROM reservations WHERE user_id = ? AND book_id = ? AND status IN ("waiting", "pending", "notified", "ready", "accepted")',
            [userId, bookId]
        );
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Bạn đã đăng ký đặt trước đầu sách này trong hàng đợi rồi!' });
        }

        // Tính toán vị trí trong hàng đợi (Queue position) & Dự báo ngày có sách (Smart Wait-Time Predictor)
        const [queueRows] = await db.execute(
            'SELECT COUNT(*) as count FROM reservations WHERE book_id = ? AND status IN ("waiting", "pending")',
            [bookId]
        );
        const waitingBeforeCount = Number(queueRows[0]?.count) || 0;
        const queuePosition = waitingBeforeCount + 1;

        const [activeBorrowsForBook] = await db.execute(`
            SELECT br.due_date
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            WHERE bc.book_id = ? AND br.status = 'borrowing'
            ORDER BY br.due_date ASC
        `, [bookId]);

        const waitPrediction = computeSmartWaitPrediction({
            bookId,
            totalCopies: book.total_copies,
            availableCopies: 0,
            activeDueDates: activeBorrowsForBook.map(r => r.due_date),
            waitingCount: waitingBeforeCount,
            targetQueuePosition: queuePosition
        });

        const [result] = await db.execute(
            'INSERT INTO reservations (user_id, book_id, status) VALUES (?, ?, "waiting")',
            [userId, bookId]
        );

        const reservationId = result.insertId;
        const ticketQr = `TICKET-RES-${reservationId}`;

        // Gửi thông báo cho độc giả kèm dự báo ngày có sách
        await db.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
            [
                userId,
                'Ghi nhận đặt trước sách & Dự báo ngày có sách',
                `Đầu sách "${book.title}" đã được ghi nhận vào hàng đợi đặt trước. ${waitPrediction.summary_text}. Ngay khi bản sao được hoàn trả về thư viện, hệ thống sẽ ưu tiên giữ riêng 48h và báo cho bạn!`
            ]
        );

        // Gửi thông báo cho ban thư viện
        await notifyAllStaff(
            'Độc giả đặt trước sách (Hàng đợi)',
            `Độc giả ${user.full_name} (${user.card_number || user.email}) vừa đăng ký đặt trước cuốn "${book.title}" (Vị trí #${queuePosition}, Dự kiến có sách: ${waitPrediction.expected_date_vn}, Phiếu #${reservationId}).`,
            'info',
            userId
        );

        res.status(201).json({
            message: `Đã xếp hàng đặt trước cuốn "${book.title}"! ${waitPrediction.summary_text}`,
            status: 'waiting',
            queuePosition,
            reservationId,
            ticketQrCode: ticketQr,
            waitPrediction
        });
    } catch (error) {
        console.error('Lỗi khi tạo đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getReservations = async (req, res) => {
    const { role, id } = req.user;

    try {
        // Tự động đồng bộ: nếu sách đã có bản sao rảnh trong kho thì chuyển ngay phiếu 'waiting' sang 'notified'
        await syncWaitingReservationsWithStock();

        let query = `
            SELECT r.id, r.reservation_date, r.status, r.notified_at, r.expires_at,
                   CONCAT('TICKET-RES-', r.id) as ticket_qr_code,
                   u.id as user_id, u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone,
                   b.title as book_title, b.id as book_id, b.cover_image, b.available_copies, b.total_copies,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as book_location,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location
            FROM reservations r
            JOIN users u ON r.user_id = u.id
            JOIN books b ON r.book_id = b.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE r.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY r.reservation_date DESC';

        const [results] = await db.execute(query, params);

        // Bổ sung thông tin vị trí hàng đợi, thời gian còn lại & Dự báo ngày có sách (Smart Wait-Time Predictor)
        const enriched = await Promise.all(results.map(async (r) => {
            let queuePosition = null;
            let waitPrediction = null;
            if (r.status === 'waiting' || r.status === 'pending') {
                const [qRes] = await db.execute(
                    'SELECT COUNT(*) as pos FROM reservations WHERE book_id = ? AND status IN ("waiting", "pending") AND (reservation_date < ? OR (reservation_date = ? AND id <= ?))',
                    [r.book_id, r.reservation_date, r.reservation_date, r.id]
                );
                queuePosition = qRes[0]?.pos || 1;

                const [activeBorrows] = await db.execute(`
                    SELECT br.due_date
                    FROM borrow_records br
                    JOIN book_copies bc ON br.book_copy_id = bc.id
                    WHERE bc.book_id = ? AND br.status = 'borrowing'
                    ORDER BY br.due_date ASC
                `, [r.book_id]);

                const [activeHolds] = await db.execute(`
                    SELECT expires_at FROM reservations
                    WHERE book_id = ? AND status IN ('notified', 'accepted', 'ready') AND expires_at IS NOT NULL
                    UNION ALL
                    SELECT d.expires_at
                    FROM borrow_draft_items di
                    JOIN borrow_drafts d ON di.draft_id = d.id
                    WHERE di.book_id = ? AND di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
                `, [r.book_id, r.book_id]);

                waitPrediction = computeSmartWaitPrediction({
                    bookId: r.book_id,
                    totalCopies: r.total_copies,
                    availableCopies: r.available_copies,
                    activeDueDates: activeBorrows.map(b => b.due_date),
                    holdExpiryDates: activeHolds.map(h => h.expires_at),
                    waitingCount: Math.max(0, queuePosition - 1),
                    targetQueuePosition: queuePosition
                });
            }

            let timeLeftHours = null;
            if (r.expires_at) {
                const diffMs = new Date(r.expires_at).getTime() - Date.now();
                timeLeftHours = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
            }

            // Nếu đã xác nhận mượn ('accepted' / 'ready'), lấy thông tin Phiếu mượn nháp 24h liên kết
            let draftCode = null;
            let draftId = null;
            let copyQrCode = null;
            if (r.status === 'accepted' || r.status === 'ready') {
                const [draftRows] = await db.execute(`
                    SELECT d.id as draft_id, d.draft_code, bc.qr_code as copy_qr_code
                    FROM borrow_draft_items di
                    JOIN borrow_drafts d ON di.draft_id = d.id
                    LEFT JOIN book_copies bc ON di.book_copy_id = bc.id
                    WHERE d.user_id = ? AND di.book_id = ? AND d.status = 'pending' AND di.status = 'pending' AND d.expires_at > NOW()
                    ORDER BY d.id DESC
                    LIMIT 1
                `, [r.user_id, r.book_id]);

                if (draftRows.length > 0) {
                    draftId = draftRows[0].draft_id;
                    draftCode = draftRows[0].draft_code;
                    copyQrCode = draftRows[0].copy_qr_code || null;
                }
            }

            return {
                ...r,
                queue_position: queuePosition,
                time_left_hours: timeLeftHours,
                wait_prediction: waitPrediction,
                draft_id: draftId,
                draft_code: draftCode,
                copy_qr_code: copyQrCode
            };
        }));

        res.status(200).json(enriched);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Độc giả phản hồi khi sách đặt trước đã có mặt tại thư viện (Accept hoặc Decline)
exports.respondReservation = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; // 'accept' | 'decline'
    const userId = req.user.id;
    const { role } = req.user;

    try {
        if (!['accept', 'decline'].includes(action)) {
            return res.status(400).json({ message: 'Hành động không hợp lệ. Vui lòng chọn "accept" hoặc "decline"' });
        }

        const [reservations] = await db.execute(`
            SELECT r.*, b.id as book_real_id, b.title as book_title, u.full_name as reader_name, u.card_number
            FROM reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.user_id = u.id
            WHERE r.id = ?
        `, [id]);

        if (reservations.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu đặt trước' });
        }
        const resv = reservations[0];

        if (role === 'reader' && resv.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền thao tác trên phiếu đặt trước này' });
        }

        if (resv.status !== 'notified' && resv.status !== 'ready') {
            return res.status(400).json({ 
                message: `Phiếu đặt trước này hiện ở trạng thái "${resv.status}", không thể xác nhận mượn hoặc từ chối.` 
            });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            if (action === 'accept') {
                await syncOverdueFines(resv.user_id);
                const circStatus = await getReaderCirculationStatus(resv.user_id, connection);
                if (circStatus && !circStatus.eligibleToBorrow) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Chưa thể xác nhận mượn sách đặt trước: ${circStatus.blockReason}. Vui lòng xử lý các điều kiện lưu thông trước!`,
                        circulationStatus: circStatus
                    });
                }

                // ĐỘC GIẢ ĐỒNG Ý MƯỢN:
                // Quy về luồng chuẩn giống Đăng ký mượn online:
                // Tạo Phiếu mượn nháp & Khóa giữ chỗ 1 bản sao (24h) -> Độc giả đến kệ lấy sách quét tem -> Tới quầy Thủ thư quét duyệt mượn!
                await connection.execute(
                    'UPDATE reservations SET status = "accepted", expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE id = ?',
                    [id]
                );

                const { draftId, draftCode } = await ensureDraftForAcceptedReservation(
                    connection,
                    resv.user_id,
                    resv.book_real_id,
                    `Tạo từ Đặt trước sách #RES-${id}`
                );

                // Gửi thông báo cho độc giả
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        resv.user_id,
                        'Đã tạo Phiếu mượn nháp (24h) từ Đặt trước sách',
                        `Bạn đã đồng ý mượn cuốn "${resv.book_title}". Hệ thống đã chuyển sách vào Phiếu mượn nháp (${draftCode}) và khóa giữ riêng 1 bản sao trên kệ trong 24 giờ. Hãy đến đúng vị trí kệ lấy sách, bấm "Quét Tem Sách Tại Kệ", rồi mang ra quầy để Thủ thư quét duyệt mượn!`
                    ]
                );

                // Gửi thông báo cho ban thư viện
                await notifyAllStaff(
                    'Độc giả xác nhận mượn sách đặt trước (Tạo Phiếu nháp 24h)',
                    `Độc giả ${resv.reader_name} (${resv.card_number}) đã xác nhận mượn cuốn "${resv.book_title}" -> Hệ thống đã tạo/cập nhật Phiếu mượn nháp ${draftCode} (giữ chỗ 24h chờ độc giả đến kệ quét sách và ra quầy duyệt).`,
                    'info'
                );

                await connection.commit();
                return res.status(200).json({
                    message: `Đã tạo Phiếu mượn nháp (${draftCode}) & khóa giữ chỗ 1 bản sao trong 24h cho cuốn "${resv.book_title}"! Bạn hãy đến kệ lấy sách, bấm "Quét Tem Sách Tại Kệ" rồi ra quầy để Thủ thư quét duyệt mượn.`,
                    draftCode,
                    draftId
                });
            } else {
                // ĐỘC GIẢ TỪ CHỐI / HỦY NHƯỜNG LƯỢT:
                await connection.execute(
                    'UPDATE reservations SET status = "cancelled" WHERE id = ?',
                    [id]
                );
                // Hủy yêu cầu mượn online liên kết nếu có
                await connection.execute(
                    'UPDATE borrow_requests SET status = "cancelled" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [resv.user_id, resv.book_real_id]
                );

                // Kiểm tra xem có người tiếp theo trong hàng đợi không
                const [nextWaiters] = await connection.execute(
                    'SELECT r.id, r.user_id, u.full_name, u.card_number FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                    [resv.book_real_id]
                );

                if (nextWaiters.length > 0) {
                    const nextUser = nextWaiters[0];
                    await connection.execute(
                        'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                        [nextUser.id]
                    );

                    // Gửi thông báo cho người tiếp theo
                    await connection.execute(
                        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                        [
                            nextUser.user_id,
                            '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                            `Cuốn sách "${resv.book_title}" bạn đặt trước vừa được người đặt trước nhường lại. Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Bạn có muốn mượn cuốn sách này không? Hãy vào mục "Đặt trước sách" để xác nhận mượn nhé!`
                        ]
                    );

                    // Báo thủ thư
                    await notifyAllStaff(
                        'Chuyển quyền ưu tiên đặt trước sách',
                        `Độc giả ${resv.reader_name} đã nhường lượt cuốn "${resv.book_title}". Quyền giữ sách 48h đã được tự động chuyển cho độc giả tiếp theo: ${nextUser.full_name} (${nextUser.card_number}).`,
                        'info'
                    );
                } else {
                    // Không có ai chờ -> nhả sách về kho chung
                    await connection.execute(
                        'UPDATE books SET available_copies = available_copies + 1 WHERE id = ?',
                        [resv.book_real_id]
                    );

                    await notifyAllStaff(
                        'Sách đặt trước hoàn lại kho chung',
                        `Độc giả ${resv.reader_name} đã từ chối mượn cuốn "${resv.book_title}" và không còn ai trong hàng đợi. Bản sao sách đã được đưa trở lại trạng thái sẵn có trong kho.`,
                        'info'
                    );
                }

                await connection.commit();
                return res.status(200).json({
                    message: `Bạn đã hủy đặt trước cuốn "${resv.book_title}". Quyền ưu tiên mượn đã được nhường lại cho bạn đọc tiếp theo trong hàng đợi!`
                });
            }
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi phản hồi đặt trước:', error);
        res.status(500).json({ message: error.message || 'Lỗi server' });
    }
};

exports.cancelReservation = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { role } = req.user;

    try {
        // Find reservation
        const [reservations] = await db.execute(`
            SELECT r.*, b.id as book_real_id, b.title as book_title, u.full_name as reader_name
            FROM reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.user_id = u.id
            WHERE r.id = ?
        `, [id]);

        if (reservations.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu đặt trước' });
        }
        const resv = reservations[0];

        // Readers can only cancel their own reservations
        if (role === 'reader' && resv.user_id !== userId) {
            return res.status(403).json({ message: 'Bạn không có quyền hủy phiếu đặt trước này' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            await connection.execute('UPDATE reservations SET status = "cancelled" WHERE id = ?', [id]);
            // Hủy yêu cầu mượn online liên kết nếu có
            await connection.execute(
                'UPDATE borrow_requests SET status = "cancelled" WHERE user_id = ? AND book_id = ? AND status = "pending"',
                [resv.user_id, resv.book_real_id]
            );

            // Đồng thời xóa sách này khỏi Phiếu mượn nháp đang hoạt động của độc giả (nếu có)
            const [draftItemsToRemove] = await connection.execute(`
                SELECT di.id as item_id, di.draft_id
                FROM borrow_draft_items di
                JOIN borrow_drafts d ON di.draft_id = d.id
                WHERE d.user_id = ? AND di.book_id = ? AND d.status = 'pending' AND di.status = 'pending'
            `, [resv.user_id, resv.book_real_id]);

            for (const ditem of draftItemsToRemove) {
                await connection.execute('DELETE FROM borrow_draft_items WHERE id = ?', [ditem.item_id]);
                const [rem] = await connection.execute(
                    'SELECT COUNT(*) as cnt FROM borrow_draft_items WHERE draft_id = ? AND status = "pending"',
                    [ditem.draft_id]
                );
                if ((rem[0]?.cnt || 0) === 0) {
                    await connection.execute("UPDATE borrow_drafts SET status = 'cancelled' WHERE id = ?", [ditem.draft_id]);
                }
            }

            // Nếu phiếu này đang giữ sách ('notified', 'ready', 'accepted'), chuyển lượt cho người tiếp theo hoặc trả sách về kho
            if (['notified', 'ready', 'accepted'].includes(resv.status)) {
                const [nextWaiters] = await connection.execute(
                    'SELECT r.id, r.user_id, u.full_name, u.card_number FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                    [resv.book_real_id]
                );

                if (nextWaiters.length > 0) {
                    const nextUser = nextWaiters[0];
                    await connection.execute(
                        'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                        [nextUser.id]
                    );

                    await connection.execute(
                        'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "reminder")',
                        [
                            nextUser.user_id,
                            '🎉 Sách bạn đặt trước đã có mặt tại thư viện!',
                            `Cuốn sách "${resv.book_title}" bạn đặt trước vừa có sẵn tại thư viện. Thư viện đang giữ sách ưu tiên cho bạn trong vòng 48 giờ. Bạn có muốn mượn cuốn sách này không? Hãy vào mục "Đặt trước sách" để xác nhận nhé!`
                        ]
                    );
                } else {
                    await connection.execute(
                        'UPDATE books SET available_copies = available_copies + 1 WHERE id = ?',
                        [resv.book_real_id]
                    );
                }
            }

            // Insert notification for reader
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    resv.user_id,
                    'Đã hủy phiếu đặt trước',
                    `Yêu cầu đặt trước cuốn sách "${resv.book_title}" (#TICKET-RES-${id}) đã được hủy thành công.`
                ]
            );

            await connection.commit();
            res.status(200).json({ message: 'Đã hủy phiếu đặt trước thành công' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi hủy đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};


// Giao sách đặt trước: BẮT BUỘC quét / đối soát mã QR của độc giả & phiếu đặt trước
exports.completeReservation = async (req, res) => {
    const { id } = req.params;
    const { scannedCode, bookCopyQr, qrCode } = req.body;
    const processedBy = req.user.id;

    const targetCode = (scannedCode || qrCode || '').toString().trim();

    if (!targetCode) {
        return res.status(400).json({
            message: 'Bắt buộc phải quét mã QR (Mã phiếu nhận sách hoặc Mã thẻ độc giả) để xác thực trước khi giao sách!'
        });
    }

    try {
        // 1. Lấy thông tin phiếu đặt trước
        const [reservations] = await db.execute(`
            SELECT r.*, u.id as u_id, u.full_name as reader_name, u.card_number, u.email as reader_email, u.status as user_status,
                   b.id as book_real_id, b.title as book_title, b.available_copies
            FROM reservations r
            JOIN users u ON r.user_id = u.id
            JOIN books b ON r.book_id = b.id
            WHERE r.id = ?
        `, [id]);

        if (reservations.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu đặt trước' });
        }
        const resv = reservations[0];

        if (resv.status === 'completed') {
            return res.status(400).json({ message: 'Phiếu đặt trước này đã được giao sách hoàn tất từ trước' });
        }
        if (resv.status === 'cancelled') {
            return res.status(400).json({ message: 'Phiếu đặt trước này đã bị hủy, không thể giao sách' });
        }
        if (resv.user_status !== 'active') {
            return res.status(400).json({ message: `Tài khoản độc giả "${resv.reader_name}" đang bị khóa hoặc chưa kích hoạt` });
        }

        // 2. Kiểm tra đối soát mã QR quét được với độc giả & phiếu này
        let isCodeValid = false;
        const expectedTicketCode = `TICKET-RES-${resv.id}`.toUpperCase();
        const cleanCode = targetCode.toUpperCase().replace(/\s+/g, '');

        // Khớp mã phiếu nhận: TICKET-RES-123, TICKET-123, RES-123, 123
        if (
            cleanCode === expectedTicketCode || 
            cleanCode === `TICKET-${resv.id}` || 
            cleanCode === `RES-${resv.id}` || 
            cleanCode === String(resv.id)
        ) {
            isCodeValid = true;
        }

        // Khớp mã thẻ độc giả: LIB-RD-000003
        if (!isCodeValid && resv.card_number && cleanCode === resv.card_number.toUpperCase().replace(/\s+/g, '')) {
            isCodeValid = true;
        }

        // Khớp email / ID
        if (!isCodeValid && (targetCode === resv.reader_email || targetCode === String(resv.u_id))) {
            isCodeValid = true;
        }

        // Khớp đối tượng JSON nếu camera quét chuỗi JSON
        if (!isCodeValid && targetCode.startsWith('{') && targetCode.endsWith('}')) {
            try {
                const parsed = JSON.parse(targetCode);
                const codeInJson = (parsed.ticketCode || parsed.ticketQrCode || parsed.cardNumber || parsed.card_number || parsed.code || '').toString().toUpperCase();
                if (codeInJson === expectedTicketCode || (resv.card_number && codeInJson === resv.card_number.toUpperCase())) {
                    isCodeValid = true;
                }
            } catch (e) {}
        }

        if (!isCodeValid) {
            return res.status(400).json({
                message: `Mã QR quét được [${targetCode}] KHÔNG KHỚP với phiếu đặt trước này! Phiếu #${resv.id} («${resv.book_title}») thuộc về độc giả "${resv.reader_name}" (Mã thẻ: ${resv.card_number || 'N/A'}). Vui lòng yêu cầu đúng độc giả xuất trình mã QR nhận sách!`
            });
        }

        // 3. Tìm bản sao sách khả dụng để giao (Bắt buộc quét mã QR trên sách vật lý độc giả mang tới)
        let selectedCopy = null;
        if (!bookCopyQr || !bookCopyQr.trim()) {
            return res.status(400).json({ 
                message: 'Bắt buộc phải quét mã QR trên cuốn sách vật lý mà độc giả mang tới để hoàn tất trao sách!' 
            });
        }

        const [copies] = await db.execute(
            'SELECT * FROM book_copies WHERE qr_code = ? AND book_id = ?',
            [bookCopyQr.trim(), resv.book_real_id]
        );
        if (copies.length === 0) {
            return res.status(400).json({ message: `Mã QR bản sao [${bookCopyQr}] không thuộc đầu sách "${resv.book_title}" hoặc không tồn tại!` });
        }
        if (copies[0].status !== 'available') {
            return res.status(400).json({ message: `Bản sao [${bookCopyQr}] hiện không ở trạng thái sẵn sàng (Trạng thái: ${copies[0].status})` });
        }
        selectedCopy = copies[0];

        // 4. Tính hạn trả sách
        const [configs] = await db.execute('SELECT key_name, value FROM system_configs');
        const configMap = Object.fromEntries(configs.map(c => [c.key_name, c.value]));
        const maxBorrowDays = parseInt(configMap['max_borrow_days'] || '14');

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Tạo phiếu mượn chính thức
            await connection.execute(
                'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                [resv.u_id, selectedCopy.id, dueDate.toISOString().slice(0, 10), processedBy]
            );

            // Cập nhật bản sao sách -> borrowed
            await connection.execute(
                'UPDATE book_copies SET status = "borrowed" WHERE id = ?',
                [selectedCopy.id]
            );

            // Giảm số lượng bản sao sẵn có của sách
            await connection.execute(
                'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                [resv.book_real_id]
            );

            // Cập nhật trạng thái phiếu đặt trước -> completed
            await connection.execute(
                'UPDATE reservations SET status = "completed" WHERE id = ?',
                [resv.id]
            );

            // Ghi nhật ký hệ thống
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, "HANDOVER_RESERVATION", "reservations", ?, ?)',
                [processedBy, resv.id, `Thủ thư quét QR xác thực và giao sách "${resv.book_title}" (Bản sao: ${selectedCopy.qr_code}) cho độc giả ${resv.reader_name} (Thẻ: ${resv.card_number})`]
            );

            // Gửi thông báo cho độc giả
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    resv.u_id,
                    'Đã nhận sách đặt trước tại quầy',
                    `Thủ thư đã xác thực mã QR và bàn giao thành công cuốn sách "${resv.book_title}" (Mã bản sao: ${selectedCopy.qr_code}). Hạn trả sách là ngày ${dueDate.toLocaleDateString('vi-VN')}.`
                ]
            );

            // Gửi thông báo cho toàn bộ ban thư viện
            await notifyAllStaff(
                'Độc giả nhận sách đặt trước tại quầy',
                `Độc giả ${resv.reader_name} (${resv.card_number || 'ID: #' + resv.u_id}) vừa nhận cuốn "${resv.book_title}" (Mã bản sao: ${selectedCopy.qr_code}). Hạn trả: ${dueDate.toLocaleDateString('vi-VN')}.`,
                'info'
            );

            await connection.commit();

            res.status(200).json({
                message: `Xác thực mã QR thành công! Đã bàn giao cuốn sách "${resv.book_title}" cho độc giả ${resv.reader_name}.`,
                data: {
                    reservationId: resv.id,
                    readerName: resv.reader_name,
                    cardNumber: resv.card_number,
                    bookTitle: resv.book_title,
                    copyQr: selectedCopy.qr_code,
                    dueDate: dueDate.toLocaleDateString('vi-VN')
                }
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi giao sách đặt trước:', error);
        res.status(500).json({ message: error.message || 'Lỗi server khi giao sách' });
    }
};
