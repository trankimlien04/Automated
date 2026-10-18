const db = require('../config/db');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');

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

        // ĐẶT TRƯỚC CHỈ ÁP DỤNG KHI SÁCH ĐÃ HẾT BẢN SAO TRONG KHO (available_copies <= 0)
        if (book.available_copies > 0) {
            return res.status(400).json({
                message: `Đầu sách "${book.title}" hiện vẫn còn ${book.available_copies} cuốn sẵn có trong kho! Vui lòng chọn "Đăng ký mượn online" để thêm vào danh sách yêu cầu mượn thay vì đặt trước.`
            });
        }

        // Check unpaid fines
        const [unpaidFines] = await db.execute(
            'SELECT SUM(amount) as total_unpaid FROM fines WHERE user_id = ? AND status = "unpaid"',
            [userId]
        );
        const unpaidAmount = parseInt(unpaidFines[0]?.total_unpaid || 0);
        if (unpaidAmount > 0) {
            return res.status(400).json({
                message: `Bạn hiện có khoản nợ phí phạt chưa thanh toán (${unpaidAmount.toLocaleString('vi-VN')}đ). Vui lòng thanh toán phí phạt trước khi đặt trước sách!`
            });
        }

        // Check active overdue borrows
        const todayStr = new Date().toISOString().slice(0, 10);
        const [overdueBorrows] = await db.execute(`
            SELECT COUNT(*) as overdue_count 
            FROM borrow_records 
            WHERE user_id = ? AND status = 'borrowing' AND due_date < ?
        `, [userId, todayStr]);
        const overdueCount = parseInt(overdueBorrows[0]?.overdue_count || 0);
        if (overdueCount > 0) {
            return res.status(400).json({
                message: `Bạn hiện có ${overdueCount} cuốn sách mượn quá hạn chưa trả. Vui lòng hoàn trả sách quá hạn trước khi đặt trước!`
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

        // Tính toán vị trí trong hàng đợi (Queue position)
        const [queueRows] = await db.execute(
            'SELECT COUNT(*) as count FROM reservations WHERE book_id = ? AND status IN ("waiting", "pending")',
            [bookId]
        );
        const queuePosition = (queueRows[0]?.count || 0) + 1;

        const [result] = await db.execute(
            'INSERT INTO reservations (user_id, book_id, status) VALUES (?, ?, "waiting")',
            [userId, bookId]
        );

        const reservationId = result.insertId;
        const ticketQr = `TICKET-RES-${reservationId}`;

        // Gửi thông báo cho độc giả
        await db.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
            [
                userId,
                'Ghi nhận đặt trước sách vào hàng đợi',
                `Đầu sách "${book.title}" hiện đang hết bản sao. Yêu cầu đặt trước của bạn đã được ghi nhận vào hàng đợi (Vị trí #${queuePosition}). Ngay khi có người hoàn trả sách về thư viện, hệ thống sẽ ưu tiên giữ sách và thông báo hỏi bạn có muốn mượn không!`
            ]
        );

        // Gửi thông báo cho ban thư viện
        await notifyAllStaff(
            'Độc giả đặt trước sách (Hàng đợi)',
            `Độc giả ${user.full_name} (${user.card_number || user.email}) vừa đăng ký đặt trước cuốn "${book.title}" (Hàng đợi vị trí #${queuePosition}, Phiếu #${reservationId}).`,
            'info',
            userId
        );

        res.status(201).json({
            message: `Đầu sách "${book.title}" hiện đang hết. Hệ thống đã ghi nhận bạn vào hàng đợi đặt trước (Vị trí #${queuePosition}) và sẽ tự động thông báo khi có sách về kho!`,
            status: 'waiting',
            queuePosition,
            reservationId,
            ticketQrCode: ticketQr
        });
    } catch (error) {
        console.error('Lỗi khi tạo đặt trước:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getReservations = async (req, res) => {
    const { role, id } = req.user;

    try {
        let query = `
            SELECT r.id, r.reservation_date, r.status, r.notified_at, r.expires_at,
                   CONCAT('TICKET-RES-', r.id) as ticket_qr_code,
                   u.id as user_id, u.full_name as reader_name, u.card_number, u.email as reader_email, u.phone as reader_phone,
                   b.title as book_title, b.id as book_id, b.cover_image, b.available_copies, b.total_copies
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

        // Bổ sung thông tin vị trí hàng đợi và thời gian còn lại
        const enriched = await Promise.all(results.map(async (r) => {
            let queuePosition = null;
            if (r.status === 'waiting' || r.status === 'pending') {
                const [qRes] = await db.execute(
                    'SELECT COUNT(*) as pos FROM reservations WHERE book_id = ? AND status IN ("waiting", "pending") AND reservation_date <= ?',
                    [r.book_id, r.reservation_date]
                );
                queuePosition = qRes[0]?.pos || 1;
            }

            let timeLeftHours = null;
            if (r.expires_at) {
                const diffMs = new Date(r.expires_at).getTime() - Date.now();
                timeLeftHours = Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
            }

            return {
                ...r,
                queue_position: queuePosition,
                time_left_hours: timeLeftHours
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
                // ĐỘC GIẢ ĐỒNG Ý MƯỢN:
                // Cập nhật trạng thái thành 'accepted' (sẵn sàng chờ độc giả tới nhận tại quầy)
                await connection.execute(
                    'UPDATE reservations SET status = "accepted" WHERE id = ?',
                    [id]
                );

                // Đồng thời thêm vào giỏ mượn / yêu cầu mượn borrow_requests để khi quét thẻ tại quầy sẽ hiện ra ngay
                const [existRequest] = await connection.execute(
                    'SELECT id FROM borrow_requests WHERE user_id = ? AND book_id = ? AND status = "pending"',
                    [resv.user_id, resv.book_real_id]
                );
                if (existRequest.length === 0) {
                    await connection.execute(
                        'INSERT INTO borrow_requests (user_id, book_id, status, expires_at) VALUES (?, ?, "pending", DATE_ADD(NOW(), INTERVAL 24 HOUR))',
                        [resv.user_id, resv.book_real_id]
                    );
                }

                // Gửi thông báo cho độc giả
                const expiryStr = resv.expires_at ? new Date(resv.expires_at).toLocaleDateString('vi-VN') : '48 giờ tới';
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        resv.user_id,
                        'Đã xác nhận mượn sách đặt trước',
                        `Bạn đã xác nhận mượn cuốn sách "${resv.book_title}". Sách đang được giữ riêng cho bạn tại quầy thư viện. Vui lòng đến nhận trước ngày ${expiryStr}!`
                    ]
                );

                // Gửi thông báo cho ban thư viện
                await notifyAllStaff(
                    'Độc giả xác nhận mượn sách đặt trước',
                    `Độc giả ${resv.reader_name} (${resv.card_number}) đã xác nhận đồng ý mượn cuốn "${resv.book_title}". Sách đang chờ độc giả tới quầy nhận.`,
                    'info'
                );

                await connection.commit();
                return res.status(200).json({
                    message: `Xác nhận mượn cuốn "${resv.book_title}" thành công! Sách đang được giữ riêng cho bạn tại quầy. Vui lòng đến xuất trình Thẻ độc giả QR để nhận sách.`
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
