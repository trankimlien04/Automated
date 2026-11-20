const db = require('../config/db');
const { computeSmartWaitPrediction } = require('../utils/waitTimePredictor');
const {
    normalizeLocationString,
    recordAuditLog,
    validateExcelImportRows,
    checkBookDisposalBlockers,
    buildBookSnapshot,
    createWarehouseRequest,
} = require('../services/warehouseGovernance');
const { saveBase64ToDisk } = require('../utils/fileStorage');

// Helper: Đảm bảo available_copies luôn nằm trong khoảng hợp lệ [0, total_copies]
// và khớp với số bản sao thực tế đang mượn / giữ chỗ 24h / giữ ưu tiên đặt trước 48h
const normalizeBooksInventory = async () => {
    try {
        const { syncWaitingReservationsWithStock } = require('./reservationController');
        if (typeof syncWaitingReservationsWithStock === 'function') {
            await syncWaitingReservationsWithStock();
        }
        await db.execute(`
            UPDATE books
            SET available_copies = LEAST(total_copies, GREATEST(0, available_copies))
            WHERE available_copies > total_copies OR available_copies < 0
        `);
    } catch (e) {
        // Ignore if table locked
    }
};

exports.getAllBooks = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const [books] = await db.execute(`
            SELECT b.*,
                   LEAST(b.total_copies, GREATEST(0, b.available_copies)) as available_copies,
                   a.name as author_name, c.name as category_name, p.name as publisher_name,
                   (SELECT COUNT(*) FROM reviews rv WHERE rv.book_id = b.id) as review_count
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
            WHERE COALESCE(b.status, 'active') = 'active'
        `);

        // Batch-fetch active borrow due_dates, hold expiries & waiting reservation counts for Smart Wait-Time Predictor
        const [activeBorrows] = await db.execute(`
            SELECT bc.book_id, br.due_date
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            WHERE br.status = 'borrowing'
            ORDER BY br.due_date ASC
        `);

        const [activeHolds] = await db.execute(`
            SELECT book_id, expires_at
            FROM reservations
            WHERE status IN ('notified', 'accepted', 'ready') AND expires_at IS NOT NULL
            UNION ALL
            SELECT di.book_id, d.expires_at
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            WHERE di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
        `);

        const [waitingResvs] = await db.execute(`
            SELECT book_id, COUNT(*) as waiting_count
            FROM reservations
            WHERE status IN ('waiting', 'pending')
            GROUP BY book_id
        `);

        const dueDatesByBook = new Map();
        for (const row of activeBorrows) {
            if (!dueDatesByBook.has(row.book_id)) {
                dueDatesByBook.set(row.book_id, []);
            }
            dueDatesByBook.get(row.book_id).push(row.due_date);
        }

        const holdExpiriesByBook = new Map();
        for (const row of activeHolds) {
            if (!holdExpiriesByBook.has(row.book_id)) {
                holdExpiriesByBook.set(row.book_id, []);
            }
            holdExpiriesByBook.get(row.book_id).push(row.expires_at);
        }

        const waitingCountByBook = new Map();
        for (const row of waitingResvs) {
            waitingCountByBook.set(row.book_id, Number(row.waiting_count) || 0);
        }

        const enrichedBooks = books.map((b) => {
            const avail = Number(b.available_copies) || 0;
            const waitingCount = waitingCountByBook.get(b.id) || 0;
            const activeDueDates = dueDatesByBook.get(b.id) || [];
            const holdExpiryDates = holdExpiriesByBook.get(b.id) || [];

            const waitPrediction = avail <= 0
                ? computeSmartWaitPrediction({
                    bookId: b.id,
                    totalCopies: b.total_copies,
                    availableCopies: avail,
                    activeDueDates,
                    holdExpiryDates,
                    waitingCount
                })
                : null;

            return {
                ...b,
                waiting_queue_count: waitingCount,
                wait_prediction: waitPrediction
            };
        });

        res.status(200).json(enrichedBooks);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getBookById = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const [books] = await db.execute(`
            SELECT b.*,
                   LEAST(b.total_copies, GREATEST(0, b.available_copies)) as available_copies,
                   a.name as author_name, c.name as category_name, p.name as publisher_name,
                   (SELECT COUNT(*) FROM reviews rv WHERE rv.book_id = b.id) as review_count
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
            WHERE b.id = ? AND COALESCE(b.status, 'active') = 'active'
        `, [req.params.id]);

        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sách' });
        }

        // Get copies enriched with current active borrower & shelf verification details
        const [copies] = await db.execute(`
            SELECT bc.*, 
                   br.id as active_borrow_id, br.borrow_date, br.due_date,
                   u.id as borrower_id, u.full_name as borrower_name, u.card_number as borrower_card_number,
                   di.id as active_draft_item_id, d.id as active_draft_id, d.draft_code as active_draft_code,
                   du.full_name as draft_reader_name, du.card_number as draft_reader_card_number,
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as draft_time_left_hours
            FROM book_copies bc
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            LEFT JOIN borrow_draft_items di ON bc.id = di.book_copy_id AND di.status = 'pending'
            LEFT JOIN borrow_drafts d ON di.draft_id = d.id AND d.status = 'pending' AND d.expires_at > NOW()
            LEFT JOIN users du ON d.user_id = du.id
            WHERE bc.book_id = ?
            ORDER BY bc.id ASC
        `, [req.params.id]);

        // Lấy danh sách bạn đọc đang đăng ký giữ chỗ 24h cho đầu sách này
        const { getActiveHoldsForBook } = require('./borrowController');
        const activeHolds = await getActiveHoldsForBook(req.params.id);

        const [waitingRows] = await db.execute(
            `SELECT COUNT(*) as count FROM reservations WHERE book_id = ? AND status IN ('waiting', 'pending')`,
            [req.params.id]
        );
        const waitingCount = Number(waitingRows[0]?.count) || 0;
        const activeDueDates = copies.filter(c => c.due_date).map(c => c.due_date);
        const bookObj = books[0];
        const waitPrediction = Number(bookObj.available_copies) <= 0
            ? computeSmartWaitPrediction({
                bookId: bookObj.id,
                totalCopies: bookObj.total_copies,
                availableCopies: bookObj.available_copies,
                activeDueDates,
                waitingCount
            })
            : null;
        
        res.status(200).json({ 
            ...bookObj, 
            copies,
            active_holds: activeHolds,
            hold_count: activeHolds.length,
            waiting_queue_count: waitingCount,
            wait_prediction: waitPrediction
        });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createBook = async (req, res) => {
    const {
        title,
        author_id,
        publisher_id,
        category_id,
        isbn,
        published_year,
        description,
        cover_image,
        total_copies,
        location,
        reason,
    } = req.body;
    const userId = req.user?.id || null;
    const cleanTitle = String(title || '').trim();

    if (!cleanTitle) {
        return res.status(400).json({ message: 'Vui lòng nhập tên đầu sách' });
    }

    const cleanIsbn = isbn ? String(isbn).trim() : null;
    const requestedCopies = Math.max(0, parseInt(total_copies, 10) || 0);
    const bookLocation = normalizeLocationString(location);

    try {
        if (cleanIsbn) {
            const [dup] = await db.execute(
                "SELECT id FROM books WHERE isbn = ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                [cleanIsbn]
            );
            if (dup.length > 0) {
                return res.status(409).json({ message: `Mã ISBN "${cleanIsbn}" đã tồn tại trên hệ thống` });
            }
        }

        // Lưu ảnh bìa từ base64 sang tệp tin đĩa tĩnh nếu cần
        let storedCover = cover_image || null;
        if (storedCover && typeof storedCover === 'string' && storedCover.startsWith('data:image/')) {
            storedCover = await saveBase64ToDisk(storedCover, 'covers', 'book_cover');
        }

        // Tách biệt Đầu sách vs Bản sao vật lý:
        // - 0 bản sao: Thủ thư biên mục trực tiếp đầu sách + ghi nhật ký
        // - >= 1 bản sao: Tạo phiếu đề xuất kho chờ Chủ thư viện phê duyệt (chưa cộng tồn kho)
        if (requestedCopies === 0) {
            const [result] = await db.execute(
                `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, total_copies, available_copies, location, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'active')`,
                [
                    cleanTitle,
                    author_id || null,
                    publisher_id || null,
                    category_id || null,
                    cleanIsbn,
                    published_year || new Date().getFullYear(),
                    description || null,
                    storedCover,
                    bookLocation,
                ]
            );

            const newBookId = result.insertId;
            const afterSnapshot = await buildBookSnapshot(db, newBookId);

            await recordAuditLog(db, {
                userId,
                action: 'CREATE_BOOK',
                targetType: 'books',
                targetId: newBookId,
                details: `Biên mục trực tiếp đầu sách «${cleanTitle}» (0 bản sao vật lý, vị trí ${bookLocation})`,
                beforeData: null,
                afterData: afterSnapshot,
                outcome: 'success',
            });

            return res.status(201).json({
                requiresApproval: false,
                message: `Đã thêm thông tin đầu sách «${cleanTitle}» (0 bản sao). Khi cần nhập bản sao vật lý, vui lòng gửi phiếu đề xuất kho!`,
                bookId: newBookId,
                location: bookLocation,
                book: afterSnapshot,
            });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();
        try {
            const request = await createWarehouseRequest(connection, {
                requestType: 'create',
                title: `Thêm đầu sách «${cleanTitle}» (+${requestedCopies} bản sao)`,
                reason: reason || `Đề xuất tạo đầu sách mới kèm nhập ${requestedCopies} bản sao vật lý`,
                requestedBy: userId,
                quantity: requestedCopies,
                location: bookLocation,
                payload: {
                    title: cleanTitle,
                    author_id: author_id || null,
                    publisher_id: publisher_id || null,
                    category_id: category_id || null,
                    isbn: cleanIsbn,
                    published_year: published_year || new Date().getFullYear(),
                    description: description || null,
                    cover_image: cover_image || null,
                    location: bookLocation,
                    total_copies: requestedCopies,
                },
                before: null,
                actionLog: 'PROPOSE_BOOK_CREATE',
            });
            await connection.commit();

            return res.status(202).json({
                requiresApproval: true,
                message: `Đã tạo phiếu ${request.request_code} thêm đầu sách «${cleanTitle}» (+${requestedCopies} bản sao) chờ Chủ thư viện phê duyệt!`,
                request,
            });
        } catch (txErr) {
            await connection.rollback();
            throw txErr;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi thêm sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateBook = async (req, res) => {
    const bookId = parseInt(req.params.id, 10);
    const {
        title,
        author_id,
        publisher_id,
        category_id,
        isbn,
        published_year,
        description,
        location,
        reason,
    } = req.body;
    const userId = req.user?.id || null;

    if (!bookId) {
        return res.status(400).json({ message: 'ID đầu sách không hợp lệ' });
    }

    try {
        const before = await buildBookSnapshot(db, bookId);
        if (!before || before.status !== 'active') {
            return res.status(404).json({ message: 'Không tìm thấy đầu sách đang hoạt động' });
        }

        const hasIsbnField = Object.prototype.hasOwnProperty.call(req.body, 'isbn');
        const nextIsbn = hasIsbnField ? (String(isbn || '').trim() || null) : before.isbn;
        const isbnChanged = hasIsbnField && nextIsbn !== (before.isbn || null);

        // Kiểm tra sửa thông tin định danh quan trọng (ISBN khi sách đã có bản sao hoặc đã có ISBN cũ)
        if (isbnChanged && (Number(before.total_copies) > 0 || Boolean(before.isbn))) {
            if (nextIsbn) {
                const [dup] = await db.execute(
                    "SELECT id FROM books WHERE isbn = ? AND id <> ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                    [nextIsbn, bookId]
                );
                if (dup.length > 0) {
                    return res.status(409).json({ message: `Mã ISBN "${nextIsbn}" đã thuộc về một đầu sách khác` });
                }
            }

            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                const request = await createWarehouseRequest(connection, {
                    requestType: 'update_sensitive',
                    title: `Đổi mã định danh ISBN «${before.title}»`,
                    reason: reason || `Đề xuất thay đổi ISBN từ "${before.isbn || 'Trống'}" sang "${nextIsbn || 'Trống'}"`,
                    requestedBy: userId,
                    bookId,
                    quantity: before.total_copies,
                    location: location !== undefined ? normalizeLocationString(location) : before.location,
                    payload: {
                        book_id: bookId,
                        title: title !== undefined ? String(title).trim() : before.title,
                        author_id: author_id !== undefined ? (author_id || null) : before.author_id,
                        publisher_id: publisher_id !== undefined ? (publisher_id || null) : before.publisher_id,
                        category_id: category_id !== undefined ? (category_id || null) : before.category_id,
                        isbn: nextIsbn,
                        published_year: published_year !== undefined ? (published_year || null) : before.published_year,
                        description: description !== undefined ? description : before.description,
                        location: location !== undefined ? normalizeLocationString(location) : before.location,
                    },
                    before,
                    actionLog: 'PROPOSE_BOOK_UPDATE_SENSITIVE',
                });
                await connection.commit();

                return res.status(202).json({
                    requiresApproval: true,
                    message: `Thay đổi ISBN trên sách đang lưu thông cần Chủ thư viện phê duyệt. Đã tạo phiếu ${request.request_code}!`,
                    request,
                });
            } catch (txErr) {
                await connection.rollback();
                throw txErr;
            } finally {
                connection.release();
            }
        }

        // Thao tác ít rủi ro (sửa tên, tác giả, mô tả, NXB, thể loại, năm XB, vị trí kệ) -> Thực hiện trực tiếp + ghi nhật ký
        const nextTitle = title !== undefined ? String(title).trim() : before.title;
        if (!nextTitle) {
            return res.status(400).json({ message: 'Tên đầu sách không được để trống' });
        }

        const nextLocation = location !== undefined && String(location).trim()
            ? normalizeLocationString(location)
            : before.location;

        if (nextIsbn && isbnChanged) {
            const [dup] = await db.execute(
                "SELECT id FROM books WHERE isbn = ? AND id <> ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                [nextIsbn, bookId]
            );
            if (dup.length > 0) {
                return res.status(409).json({ message: `Mã ISBN "${nextIsbn}" đã thuộc về một đầu sách khác` });
            }
        }

        await db.execute(
            `UPDATE books SET
                title = ?,
                author_id = ?,
                publisher_id = ?,
                category_id = ?,
                isbn = ?,
                published_year = ?,
                description = ?,
                location = ?
             WHERE id = ? AND COALESCE(status, 'active') = 'active'`,
            [
                nextTitle,
                author_id !== undefined ? (author_id || null) : before.author_id,
                publisher_id !== undefined ? (publisher_id || null) : before.publisher_id,
                category_id !== undefined ? (category_id || null) : before.category_id,
                nextIsbn,
                published_year !== undefined ? (published_year || null) : before.published_year,
                description !== undefined ? description : before.description,
                nextLocation,
                bookId,
            ]
        );

        const after = await buildBookSnapshot(db, bookId);
        const onlyLocationChanged =
            before.location !== after.location &&
            before.title === after.title &&
            before.author_id === after.author_id &&
            before.publisher_id === after.publisher_id &&
            before.category_id === after.category_id &&
            before.description === after.description &&
            before.published_year === after.published_year;

        await recordAuditLog(db, {
            userId,
            action: onlyLocationChanged ? 'MOVE_LOCATION' : 'UPDATE_BOOK_METADATA',
            targetType: 'books',
            targetId: bookId,
            details: onlyLocationChanged
                ? `Điều chuyển vị trí «${after.title}»: "${before.location}" → "${after.location}"`
                : `Cập nhật thông tin biên mục «${after.title}»`,
            beforeData: before,
            afterData: after,
            outcome: 'success',
        });

        res.status(200).json({
            requiresApproval: false,
            message: 'Cập nhật thông tin đầu sách thành công',
            book: after,
        });
    } catch (error) {
        console.error('Lỗi khi cập nhật sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteBook = async (req, res) => {
    const bookId = parseInt(req.params.id, 10);
    const userId = req.user?.id || null;
    const reason = String(req.body?.reason || req.query?.reason || '').trim();
    const disposalStatus = (req.body?.disposal_status || req.query?.disposal_status) === 'inactive' ? 'inactive' : 'disposed';

    if (!bookId) {
        return res.status(400).json({ message: 'ID đầu sách không hợp lệ' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const before = await buildBookSnapshot(connection, bookId);
        if (!before || before.status !== 'active') {
            await connection.rollback();
            return res.status(404).json({ message: 'Đầu sách không tồn tại hoặc đã được thanh lý trước đó' });
        }

        const [existingPending] = await connection.execute(
            `SELECT br.id, br.request_code
             FROM book_requests br
             JOIN book_request_details brd ON brd.request_id = br.id
             WHERE br.request_type = 'delete' AND br.status = 'pending' AND brd.book_id = ?
             LIMIT 1`,
            [bookId]
        );
        if (existingPending.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                message: `Đầu sách «${before.title}» đã có phiếu đề xuất thanh lý ${existingPending[0].request_code} đang chờ Chủ thư viện duyệt.`,
            });
        }

        const blockerCheck = await checkBookDisposalBlockers(connection, bookId);
        if (blockerCheck.blocked) {
            await connection.rollback();
            return res.status(409).json({
                message: blockerCheck.summary,
                blockers: blockerCheck.blockers,
            });
        }

        const request = await createWarehouseRequest(connection, {
            requestType: 'delete',
            title: `Đề xuất thanh lý «${before.title}» (${before.total_copies} bản sao)`,
            reason: reason || 'Đề xuất thanh lý / ngừng lưu thông đầu sách theo kiểm kê kho',
            requestedBy: userId,
            bookId,
            quantity: before.total_copies,
            location: before.location,
            payload: { book_id: bookId, disposal_status: disposalStatus },
            before,
            actionLog: 'PROPOSE_BOOK_DELETE',
        });

        await connection.commit();
        res.status(202).json({
            requiresApproval: true,
            message: `Đã gửi phiếu đề xuất thanh lý ${request.request_code} cho «${before.title}» chờ Chủ thư viện phê duyệt (không xóa cứng CSDL).`,
            request,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi đề xuất xóa/thanh lý sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    } finally {
        connection.release();
    }
};

// Batch Import Books from Excel -> Maker proposal awaiting Owner review
exports.importBooksBatch = async (req, res) => {
    const { books, fileName, reason } = req.body;
    const userId = req.user.id;

    if (!books || !Array.isArray(books) || books.length === 0) {
        return res.status(400).json({ message: 'Danh sách sách tải lên không hợp lệ hoặc rỗng' });
    }

    const { validRows, invalidRows } = validateExcelImportRows(books);
    if (validRows.length === 0) {
        return res.status(400).json({
            message: 'Không có dòng sách hợp lệ trong file Excel để tạo phiếu nhập kho',
            invalidRows,
        });
    }

    const totalCopies = validRows.reduce((sum, item) => sum + (Number(item.total_copies) || 1), 0);
    const cleanFileName = String(fileName || 'Excel batch').trim();

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const request = await createWarehouseRequest(connection, {
            requestType: 'import',
            title: `Nhập Excel (${validRows.length} đầu sách • ${totalCopies} bản sao)`,
            reason: reason || `Đề xuất nhập kho hàng loạt từ file "${cleanFileName}"`,
            requestedBy: userId,
            quantity: totalCopies,
            location: 'Theo cấu hình từng dòng Excel',
            payload: {
                fileName: cleanFileName,
                validCount: validRows.length,
                invalidCount: invalidRows.length,
                totalCopies,
                rows: validRows,
            },
            before: { fileName: cleanFileName, validCount: validRows.length, invalidCount: invalidRows.length },
            actionLog: 'PROPOSE_BOOK_IMPORT',
        });

        await connection.commit();

        res.status(202).json({
            requiresApproval: true,
            message: `Đã tạo phiếu nhập Excel ${request.request_code} (${validRows.length} đầu sách hợp lệ / ${totalCopies} bản sao) chờ Chủ thư viện duyệt!`,
            request,
            validCount: validRows.length,
            invalidCount: invalidRows.length,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi tạo phiếu nhập sách từ Excel:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo phiếu nhập sách từ Excel' });
    } finally {
        connection.release();
    }
};

// =============================================================================
// KIỂM KÊ KHO SÁCH NHANH BẰNG QUÉT QR HÀNG LOẠT (SMART SHELF INVENTORY AUDIT)
// =============================================================================

// GET /api/books/shelf-audit/location?location=Phòng 01 - Kệ 02 - Ngăn 01
exports.getShelfAuditData = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const rawTarget = req.query.location || 'Phòng 01 - Kệ 01 - Ngăn 01';
        const targetLocation = normalizeLocationString(rawTarget);

        // Lấy toàn bộ bản sao của các đầu sách thuộc ngăn này
        const [allCopies] = await db.execute(`
            SELECT bc.id as copy_id, bc.qr_code, bc.status as copy_status,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as raw_location,
                   a.name as author_name, c.name as category_name,
                   br.id as active_borrow_id, u.full_name as borrower_name, u.card_number as borrower_card_number,
                   di.id as active_draft_item_id, d.draft_code as active_draft_code, du.full_name as draft_reader_name
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id AND COALESCE(b.status, 'active') = 'active'
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            LEFT JOIN borrow_draft_items di ON bc.id = di.book_copy_id AND di.status = 'pending'
            LEFT JOIN borrow_drafts d ON di.draft_id = d.id AND d.status = 'pending' AND d.expires_at > NOW()
            LEFT JOIN users du ON d.user_id = du.id
            ORDER BY b.title ASC, bc.id ASC
        `);

        const expectedCopies = [];
        const demoMisplacedSamples = [];

        for (const row of allCopies) {
            const normLoc = normalizeLocationString(row.raw_location);
            const enriched = {
                copy_id: row.copy_id,
                qr_code: row.qr_code,
                copy_status: row.copy_status,
                book_id: row.book_id,
                book_title: row.book_title,
                isbn: row.isbn,
                cover_image: row.cover_image,
                author_name: row.author_name || 'Chưa rõ tác giả',
                category_name: row.category_name || 'Chưa phân loại',
                expected_location: normLoc,
                borrower_name: row.borrower_name || null,
                borrower_card_number: row.borrower_card_number || null,
                active_draft_code: row.active_draft_code || null,
                draft_reader_name: row.draft_reader_name || null,
                // Bản sao được kỳ vọng đang nằm trên kệ nếu status === 'available'
                expected_on_shelf: row.copy_status === 'available'
            };

            if (normLoc === targetLocation) {
                expectedCopies.push(enriched);
            } else if (row.copy_status === 'available' && demoMisplacedSamples.length < 4) {
                // Lấy mẫu vài cuốn từ ngăn/phòng khác để Thủ thư có thể bấm test nhanh trường hợp để nhầm kệ
                if (!demoMisplacedSamples.some(s => s.expected_location === normLoc)) {
                    demoMisplacedSamples.push(enriched);
                }
            }
        }

        const expectedOnShelfCopies = expectedCopies.filter(c => c.expected_on_shelf);
        const borrowedOrLockedCopies = expectedCopies.filter(c => !c.expected_on_shelf);

        // Thống kê số lượng bản sao theo từng Kệ và từng Ngăn của phòng này để gợi ý trực quan cho Thủ thư
        const currentRoomMatch = targetLocation.match(/(Phòng\s*\d+)/i);
        const currentRoomStr = currentRoomMatch ? currentRoomMatch[1] : 'Phòng 01';
        const currentShelfMatch = targetLocation.match(/(Kệ\s*\d+)/i);
        const currentShelfStr = currentShelfMatch ? currentShelfMatch[1] : 'Kệ 01';

        const shelfCopyCounts = {};
        const rackCopyCounts = {};

        for (const row of allCopies) {
            const normLoc = normalizeLocationString(row.raw_location);
            if (normLoc.startsWith(currentRoomStr)) {
                const sm = normLoc.match(/Kệ\s*(\d+)/i);
                if (sm) {
                    const shKey = `Kệ ${sm[1].padStart(2, '0')}`;
                    shelfCopyCounts[shKey] = (shelfCopyCounts[shKey] || 0) + 1;
                }
            }
            if (normLoc.startsWith(`${currentRoomStr} - ${currentShelfStr}`)) {
                const rm = normLoc.match(/Ngăn\s*(\d+)/i);
                if (rm) {
                    const rkKey = `Ngăn ${rm[1].padStart(2, '0')}`;
                    rackCopyCounts[rkKey] = (rackCopyCounts[rkKey] || 0) + 1;
                }
            }
        }

        res.status(200).json({
            targetLocation,
            totalExpectedOnShelf: expectedOnShelfCopies.length,
            totalCopiesInLocation: expectedCopies.length,
            expectedOnShelfCopies,
            borrowedOrLockedCopies,
            demoMisplacedSamples,
            shelfCopyCounts,
            rackCopyCounts
        });
    } catch (error) {
        console.error('Lỗi khi tải dữ liệu kiểm kê kệ sách:', error);
        res.status(500).json({ message: 'Lỗi server khi tải dữ liệu kiểm kê kệ sách' });
    }
};

// POST /api/books/shelf-audit/scan
// Body: { qrCode, targetLocation }
exports.scanCopyForShelfAudit = async (req, res) => {
    try {
        const { qrCode, targetLocation: rawTarget } = req.body;
        const cleanQr = String(qrCode || '').trim();
        if (!cleanQr) {
            return res.status(400).json({ message: 'Vui lòng nhập hoặc quét mã QR bản sao sách' });
        }

        const targetLocation = normalizeLocationString(rawTarget || 'Phòng 01 - Kệ 01 - Ngăn 01');

        const [rows] = await db.execute(`
            SELECT bc.id as copy_id, bc.qr_code, bc.status as copy_status,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as raw_location,
                   a.name as author_name, c.name as category_name,
                   br.id as active_borrow_id, u.full_name as borrower_name, u.card_number as borrower_card_number
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id AND COALESCE(b.status, 'active') = 'active'
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            WHERE LOWER(bc.qr_code) = LOWER(?)
               OR bc.id = ?
               OR LOWER(b.isbn) = LOWER(?)
            LIMIT 1
        `, [cleanQr, parseInt(cleanQr, 10) || 0, cleanQr]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: `Không tìm thấy bản sao sách nào khớp với mã [${cleanQr}] trong kho dữ liệu!`
            });
        }

        const copy = rows[0];
        const actualLocation = normalizeLocationString(copy.raw_location);
        const isCorrectLocation = actualLocation === targetLocation;

        const scannedItem = {
            copy_id: copy.copy_id,
            qr_code: copy.qr_code,
            copy_status: copy.copy_status,
            book_id: copy.book_id,
            book_title: copy.book_title,
            isbn: copy.isbn,
            cover_image: copy.cover_image,
            author_name: copy.author_name || 'Chưa rõ tác giả',
            category_name: copy.category_name || 'Chưa phân loại',
            actual_location: actualLocation,
            scanned_at_location: targetLocation,
            scanned_timestamp: new Date().toISOString(),
            borrower_name: copy.borrower_name || null,
            borrower_card_number: copy.borrower_card_number || null,
            audit_group: isCorrectLocation ? 'correct' : 'misplaced',
            instruction: isCorrectLocation
                ? `✅ Đúng vị trí (${actualLocation})`
                : `⚠️ Sách để nhầm kệ! Cuốn này thuộc [${actualLocation}] → Cần mang từ [${targetLocation}] về đúng [${actualLocation}]`
        };

        res.status(200).json({
            auditGroup: scannedItem.audit_group,
            message: scannedItem.instruction,
            item: scannedItem
        });
    } catch (error) {
        console.error('Lỗi khi quét kiểm kê bản sao sách:', error);
        res.status(500).json({ message: 'Lỗi server khi quét kiểm kê bản sao sách' });
    }
};

// =============================================================================
// NHẬP BỔ SUNG BẢN SAO NHANH (QUICK RESTOCK COPIES FOR BOTTLENECK BOOKS)
// POST /api/books/:id/restock
// Body: { additionalCopies: number }
// =============================================================================
exports.restockBookCopies = async (req, res) => {
    const bookId = parseInt(req.params.id, 10);
    const rawQty = parseInt(req.body.additionalCopies ?? req.body.quantity, 10);
    const additionalCopies = Math.max(1, Math.min(500, Number.isInteger(rawQty) ? rawQty : 1));
    const userId = req.user?.id || null;
    const reason = String(req.body.reason || '').trim();
    const location = req.body.location ? normalizeLocationString(req.body.location) : null;

    if (!bookId) {
        return res.status(400).json({ message: 'ID đầu sách không hợp lệ' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const before = await buildBookSnapshot(connection, bookId);
        if (!before || before.status !== 'active') {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy đầu sách cần nhập bổ sung' });
        }

        const targetLoc = location || before.location;
        const request = await createWarehouseRequest(connection, {
            requestType: 'restock',
            title: `Nhập bổ sung +${additionalCopies} bản sao «${before.title}»`,
            reason: reason || `Đề xuất nhập bổ sung +${additionalCopies} bản sao theo cảnh báo nhu cầu cao`,
            requestedBy: userId,
            bookId,
            quantity: additionalCopies,
            location: targetLoc,
            payload: { book_id: bookId, additionalCopies, location: targetLoc },
            before,
            actionLog: 'PROPOSE_BOOK_RESTOCK',
        });

        await connection.commit();

        res.status(202).json({
            requiresApproval: true,
            message: `Đã gửi phiếu đề xuất ${request.request_code} (+${additionalCopies} bản sao cho «${before.title}») chờ Chủ thư viện phê duyệt!`,
            request,
            bookId,
            title: before.title,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi tạo phiếu nhập bổ sung bản sao:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo phiếu nhập bổ sung bản sao sách' });
    } finally {
        connection.release();
    }
};

