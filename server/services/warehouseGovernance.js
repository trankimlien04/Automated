const db = require('../config/db');

const REQUEST_TYPE_LABELS = {
    create: 'Thêm đầu sách kèm bản sao',
    import: 'Nhập kho hàng loạt từ Excel',
    restock: 'Nhập bổ sung bản sao vật lý',
    delete: 'Đề xuất thanh lý / Xóa mềm đầu sách',
    update_sensitive: 'Cập nhật thông tin định danh quan trọng (ISBN)',
};

const pad2 = (n) => (Number(n) < 10 ? `0${Number(n)}` : String(n));

const normalizeLocationString = (rawLoc) => {
    if (!rawLoc || typeof rawLoc !== 'string') return 'Phòng 01 - Kệ 01 - Ngăn 01';
    const roomMatch = rawLoc.match(/Phòng\s*(\d+)/i);
    const shelfMatch = rawLoc.match(/Kệ\s*(\d+)/i);
    const rackMatch = rawLoc.match(/Ngăn\s*(\d+)/i);
    if (roomMatch && shelfMatch && rackMatch) {
        return `Phòng ${pad2(roomMatch[1])} - Kệ ${pad2(shelfMatch[1])} - Ngăn ${pad2(rackMatch[1])}`;
    }
    return rawLoc.trim() || 'Phòng 01 - Kệ 01 - Ngăn 01';
};

const toJsonText = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const safeJsonParse = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const recordAuditLog = async (executor, {
    userId = null,
    action,
    targetType = 'books',
    targetId = null,
    details = '',
    beforeData = null,
    afterData = null,
    outcome = 'success',
}) => {
    const conn = executor || db;
    await conn.execute(
        `INSERT INTO activity_logs (user_id, action, target_type, target_id, details, before_data, after_data, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, action, targetType, targetId, details, toJsonText(beforeData), toJsonText(afterData), outcome]
    );
};

const notifyUser = async (executor, userId, { title, message, type = 'info' }) => {
    if (!userId) return;
    const conn = executor || db;
    await conn.execute(
        `INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)`,
        [userId, title, message, type]
    );
};

const notifyRoles = async (executor, roles, { title, message, type = 'info' }) => {
    if (!Array.isArray(roles) || roles.length === 0) return;
    const conn = executor || db;
    const placeholders = roles.map(() => '?').join(',');
    const [users] = await conn.execute(
        `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`,
        roles
    );
    for (const user of users) {
        await notifyUser(conn, user.id, { title, message, type });
    }
};

const parseExcelBookRow = (row = {}, index = 0) => {
    const rowNumber = Number(row.rowNumber || row._rowNumber || index + 2);
    const title = String(row.title ?? row.name ?? row['Tên sách'] ?? row['Tên đầu sách'] ?? '').trim();
    const author = String(row.author ?? row.author_name ?? row['Tác giả'] ?? '').trim();
    const category = String(row.category ?? row.category_name ?? row['Thể loại'] ?? '').trim();
    const publisher = String(row.publisher ?? row.publisher_name ?? row['Nhà xuất bản'] ?? row['NXB'] ?? '').trim();
    const isbn = String(row.isbn ?? row['Mã ISBN'] ?? row['ISBN'] ?? '').trim();
    const rawYear = row.published_year ?? row['Năm xuất bản'] ?? row['Năm XB'] ?? '';
    const parsedYear = rawYear === '' || rawYear === null || rawYear === undefined
        ? new Date().getFullYear()
        : Number(rawYear);
    const rawCopies = row.total_copies ?? row.copies ?? row['Số lượng'] ?? row['Số bản sao'] ?? 1;
    const parsedCopies = Number(rawCopies);
    const location = String(row.location ?? row['Vị trí'] ?? row['Vị trí kho'] ?? row['Vị trí sách'] ?? '').trim();
    const description = String(row.description ?? row['Mô tả'] ?? 'Sách nhập từ file Excel').trim();
    const cover_image = String(row.cover_image ?? row.cover ?? row['Hình ảnh'] ?? row['Ảnh bìa'] ?? '').trim();

    const errors = [];
    if (!title) {
        errors.push('Thiếu tên đầu sách');
    } else if (title.length > 255) {
        errors.push('Tên đầu sách vượt quá 255 ký tự');
    }

    if (!Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 200) {
        errors.push('Số lượng bản sao phải là số nguyên từ 1 đến 200');
    }

    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > currentYear + 1) {
        errors.push(`Năm xuất bản phải hợp lệ (1800 - ${currentYear + 1})`);
    }

    if (isbn && isbn.length > 20) {
        errors.push('Mã ISBN vượt quá 20 ký tự');
    }

    return {
        rowNumber,
        normalized: {
            title,
            author,
            category,
            publisher,
            isbn,
            published_year: Number.isInteger(parsedYear) ? parsedYear : currentYear,
            total_copies: Number.isInteger(parsedCopies) ? parsedCopies : 0,
            location: location ? normalizeLocationString(location) : '',
            description: description || 'Sách nhập từ file Excel',
            cover_image,
        },
        errors,
    };
};

const validateExcelImportRows = (rawRows) => {
    if (!Array.isArray(rawRows)) {
        return { validRows: [], invalidRows: [{ rowNumber: 0, raw: null, errors: ['Dữ liệu Excel không hợp lệ'] }] };
    }

    const validRows = [];
    const invalidRows = [];
    const seenIsbns = new Set();

    rawRows.forEach((raw, idx) => {
        const { rowNumber, normalized, errors } = parseExcelBookRow(raw, idx);
        const rowErrors = [...errors];

        if (normalized.isbn) {
            const isbnKey = normalized.isbn.toLowerCase();
            if (seenIsbns.has(isbnKey)) {
                rowErrors.push(`Trùng mã ISBN "${normalized.isbn}" trong cùng file Excel`);
            } else {
                seenIsbns.add(isbnKey);
            }
        }

        if (rowErrors.length > 0) {
            invalidRows.push({
                rowNumber,
                title: normalized.title || '(Trống)',
                isbn: normalized.isbn || '',
                total_copies: raw?.total_copies ?? raw?.copies ?? raw?.['Số lượng'] ?? '',
                errors: rowErrors,
                raw,
            });
        } else {
            validRows.push(normalized);
        }
    });

    return { validRows, invalidRows };
};

const checkBookDisposalBlockers = async (executor, bookId) => {
    const conn = executor || db;

    const [borrowedRows] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM book_copies bc
         LEFT JOIN borrow_records br ON br.book_copy_id = bc.id AND br.status = 'borrowing'
         WHERE bc.book_id = ? AND (bc.status = 'borrowed' OR br.id IS NOT NULL)`,
        [bookId]
    );

    const [pendingReqRows] = await conn.execute(
        `SELECT COUNT(*) AS count FROM borrow_requests WHERE book_id = ? AND status = 'pending'`,
        [bookId]
    );

    const [activeDraftRows] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM borrow_draft_items di
         JOIN borrow_drafts d ON di.draft_id = d.id
         WHERE di.book_id = ? AND di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()`,
        [bookId]
    );

    const [activeResvRows] = await conn.execute(
        `SELECT COUNT(*) AS count
         FROM reservations
         WHERE book_id = ? AND status IN ('waiting', 'pending', 'ready', 'notified', 'accepted')`,
        [bookId]
    );

    const blockers = {
        borrowedCount: Number(borrowedRows[0]?.count) || 0,
        pendingRequestsCount: Number(pendingReqRows[0]?.count) || 0,
        activeDraftsCount: Number(activeDraftRows[0]?.count) || 0,
        activeReservationsCount: Number(activeResvRows[0]?.count) || 0,
    };

    const parts = [];
    if (blockers.borrowedCount > 0) parts.push(`${blockers.borrowedCount} bản sao đang cho mượn`);
    if (blockers.pendingRequestsCount > 0) parts.push(`${blockers.pendingRequestsCount} yêu cầu mượn chờ duyệt`);
    if (blockers.activeDraftsCount > 0) parts.push(`${blockers.activeDraftsCount} phiếu nháp 24h đang giữ sách`);
    if (blockers.activeReservationsCount > 0) parts.push(`${blockers.activeReservationsCount} lượt đặt trước đang hoạt động`);

    return {
        blocked: parts.length > 0,
        blockers,
        summary: parts.length > 0 ? `Không thể thanh lý đầu sách vì còn ${parts.join(', ')}.` : '',
    };
};

const createBookCopiesBatch = async (connection, { bookId, quantity, prefix = 'QR-BK' }) => {
    const qty = Number(quantity) || 0;
    if (qty <= 0) return [];

    const [existingCopies] = await connection.execute(
        'SELECT COUNT(*) AS count FROM book_copies WHERE book_id = ?',
        [bookId]
    );
    const startIdx = (Number(existingCopies[0]?.count) || 0) + 1;
    const generated = [];

    for (let i = 0; i < qty; i++) {
        let candidateQr = `${prefix}-${bookId}-${startIdx + i}`;
        const [dup] = await connection.execute(
            'SELECT id FROM book_copies WHERE qr_code = ? LIMIT 1',
            [candidateQr]
        );
        if (dup.length > 0) {
            candidateQr = `${prefix}-${bookId}-${startIdx + i}-${Date.now().toString().slice(-4)}`;
        }
        await connection.execute(
            'INSERT INTO book_copies (book_id, qr_code, status) VALUES (?, ?, "available")',
            [bookId, candidateQr]
        );
        generated.push(candidateQr);
    }

    return generated;
};

const buildBookSnapshot = async (executor, bookId) => {
    const conn = executor || db;
    const [rows] = await conn.execute(
        `SELECT b.id, b.title, b.isbn, b.author_id, b.publisher_id, b.category_id,
                b.published_year, b.description, b.location, b.total_copies, b.available_copies,
                COALESCE(b.status, 'active') AS status,
                a.name AS author_name, c.name AS category_name, p.name AS publisher_name
         FROM books b
         LEFT JOIN authors a ON b.author_id = a.id
         LEFT JOIN categories c ON b.category_id = c.id
         LEFT JOIN publishers p ON b.publisher_id = p.id
         WHERE b.id = ?`,
        [bookId]
    );
    return rows[0] || null;
};

const createWarehouseRequest = async (connection, {
    requestType,
    title,
    reason,
    requestedBy,
    bookId = null,
    quantity = 0,
    location = null,
    payload = null,
    before = null,
    actionLog = null,
    targetType = 'book_requests',
    auditDetails = null,
}) => {
    const [insertReq] = await connection.execute(
        `INSERT INTO book_requests (request_type, status, title, reason, requested_by)
         VALUES (?, 'pending', ?, ?, ?)`,
        [requestType, title, reason || null, requestedBy]
    );
    const requestId = insertReq.insertId;

    const now = new Date();
    const ymd = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
    const requestCode = `WH-${ymd}-${String(requestId).padStart(4, '0')}`;
    await connection.execute(
        'UPDATE book_requests SET request_code = ? WHERE id = ?',
        [requestCode, requestId]
    );

    await connection.execute(
        `INSERT INTO book_request_details (request_id, book_id, quantity, location, payload_json, before_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            requestId,
            bookId,
            Number(quantity) || 0,
            location || null,
            toJsonText(payload),
            toJsonText(before),
        ]
    );

    const logAction = actionLog || `PROPOSE_BOOK_${String(requestType).toUpperCase()}`;
    const logDetails = auditDetails || `[${requestCode}] Đề xuất ${REQUEST_TYPE_LABELS[requestType] || requestType}: ${title}. Lý do: ${reason || 'Không ghi rõ'}`;

    await recordAuditLog(connection, {
        userId: requestedBy,
        action: logAction,
        targetType,
        targetId: requestId,
        details: logDetails,
        beforeData: before,
        afterData: { requestCode, requestType, status: 'pending', quantity, location, payload },
        outcome: 'pending',
    });

    await notifyRoles(connection, ['owner'], {
        title: `Phiếu đề xuất kho sách mới (${requestCode})`,
        message: `Thủ thư vừa gửi phiếu "${title}" (${REQUEST_TYPE_LABELS[requestType] || requestType}) chờ Chủ thư viện phê duyệt.`,
        type: 'info',
    });

    await notifyRoles(connection, ['admin'], {
        title: `[Giám sát] Phiếu đề xuất kho ${requestCode}`,
        message: `Hệ thống ghi nhận phiếu đề xuất "${title}" đang chờ Chủ thư viện xem xét.`,
        type: 'info',
    });

    return {
        id: requestId,
        request_code: requestCode,
        request_type: requestType,
        status: 'pending',
        title,
        reason: reason || null,
        quantity: Number(quantity) || 0,
        location: location || null,
    };
};

const lookupOrInsertMeta = async (connection, tableName, cacheMap, name) => {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    if (!key) return null;
    if (cacheMap.has(key)) return cacheMap.get(key);

    const [created] = await connection.execute(`INSERT INTO ${tableName} (name) VALUES (?)`, [name.trim()]);
    cacheMap.set(key, created.insertId);
    return created.insertId;
};

const executeExcelImportBatch = async (connection, rows, defaultLocation = null) => {
    const [allAuthors] = await connection.execute('SELECT id, name FROM authors');
    const authorMap = new Map(allAuthors.map((a) => [a.name.toLowerCase().trim(), a.id]));

    const [allCats] = await connection.execute('SELECT id, name FROM categories');
    const catMap = new Map(allCats.map((c) => [c.name.toLowerCase().trim(), c.id]));

    const [allPubs] = await connection.execute('SELECT id, name FROM publishers');
    const pubMap = new Map(allPubs.map((p) => [p.name.toLowerCase().trim(), p.id]));

    const [allActiveBooks] = await connection.execute(
        "SELECT id, isbn, title FROM books WHERE COALESCE(status, 'active') = 'active'"
    );
    const isbnMap = new Map();
    for (const book of allActiveBooks) {
        if (book.isbn && String(book.isbn).trim()) {
            isbnMap.set(String(book.isbn).trim().toLowerCase(), book.id);
        }
    }

    let importedCount = 0;
    let createdBooksCount = 0;
    let restockedBooksCount = 0;
    let totalCopiesGenerated = 0;
    const touchedBookIds = new Set();

    for (const item of rows) {
        const title = String(item.title || '').trim();
        if (!title) continue;

        const authorId = await lookupOrInsertMeta(connection, 'authors', authorMap, item.author);
        const categoryId = await lookupOrInsertMeta(connection, 'categories', catMap, item.category);
        const publisherId = await lookupOrInsertMeta(connection, 'publishers', pubMap, item.publisher);

        const cleanIsbn = String(item.isbn || '').trim();
        const isbnKey = cleanIsbn.toLowerCase();
        const copiesCount = Math.max(1, parseInt(item.total_copies, 10) || 1);
        const publishedYear = parseInt(item.published_year, 10) || new Date().getFullYear();
        const description = String(item.description || 'Sách nhập từ file Excel').trim();
        const coverImage = String(item.cover_image || '').trim() || null;
        const requestedLoc = item.location || defaultLocation;

        let targetBookId = null;
        if (isbnKey && isbnMap.has(isbnKey)) {
            targetBookId = isbnMap.get(isbnKey);
            await connection.execute(
                `UPDATE books
                 SET total_copies = total_copies + ?,
                     available_copies = available_copies + ?,
                     cover_image = COALESCE(cover_image, ?)
                 WHERE id = ?`,
                [copiesCount, copiesCount, coverImage, targetBookId]
            );
            restockedBooksCount++;
        } else {
            const fallbackRoom = `Phòng 0${((categoryId || 1) % 3) + 1} - Kệ 0${((importedCount * 2) % 6) + 1} - Ngăn 0${((importedCount * 3) % 4) + 1}`;
            const bookLocation = requestedLoc ? normalizeLocationString(requestedLoc) : fallbackRoom;

            const [bookResult] = await connection.execute(
                `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, location, total_copies, available_copies, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
                [title, authorId, publisherId, categoryId, cleanIsbn || null, publishedYear, description, coverImage, bookLocation, copiesCount, copiesCount]
            );
            targetBookId = bookResult.insertId;
            if (isbnKey) isbnMap.set(isbnKey, targetBookId);
            createdBooksCount++;
        }

        const generated = await createBookCopiesBatch(connection, { bookId: targetBookId, quantity: copiesCount });
        totalCopiesGenerated += generated.length;
        touchedBookIds.add(targetBookId);
        importedCount++;
    }

    return {
        importedCount,
        createdBooksCount,
        restockedBooksCount,
        totalCopiesGenerated,
        touchedBookIds: Array.from(touchedBookIds),
    };
};

const createExecutionError = (status, message) => {
    const err = new Error(message);
    err.statusCode = status;
    return err;
};

const executeApprovedRequest = async (connection, { request, detail, reviewerId }) => {
    const payload = safeJsonParse(detail?.payload_json) || {};
    const bookId = detail?.book_id || payload?.book_id || null;
    const touchedBookIds = [];

    if (request.request_type === 'create') {
        const cleanTitle = String(payload.title || '').trim();
        if (!cleanTitle) throw createExecutionError(400, 'Dữ liệu đầu sách đề xuất không có tên sách hợp lệ');
        const cleanIsbn = payload.isbn ? String(payload.isbn).trim() : null;

        if (cleanIsbn) {
            const [dupIsbn] = await connection.execute(
                "SELECT id FROM books WHERE isbn = ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                [cleanIsbn]
            );
            if (dupIsbn.length > 0) {
                throw createExecutionError(409, `Không thể duyệt: Mã ISBN "${cleanIsbn}" đã tồn tại trên một đầu sách đang hoạt động.`);
            }
        }

        const qty = Math.max(0, parseInt(detail?.quantity ?? payload.total_copies, 10) || 0);
        const loc = normalizeLocationString(detail?.location || payload.location);
        const [ins] = await connection.execute(
            `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, location, total_copies, available_copies, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [
                cleanTitle,
                payload.author_id || null,
                payload.publisher_id || null,
                payload.category_id || null,
                cleanIsbn,
                payload.published_year || new Date().getFullYear(),
                payload.description || 'Mô tả sách thư viện',
                payload.cover_image || null,
                loc,
                qty,
                qty,
            ]
        );
        const newBookId = ins.insertId;
        const generatedQrCodes = await createBookCopiesBatch(connection, { bookId: newBookId, quantity: qty });
        await connection.execute('UPDATE book_request_details SET book_id = ? WHERE id = ?', [newBookId, detail.id]);

        const afterSnapshot = await buildBookSnapshot(connection, newBookId);
        touchedBookIds.push(newBookId);

        return {
            beforeSnapshot: safeJsonParse(detail?.before_json),
            afterSnapshot: { ...afterSnapshot, generatedQrCodes },
            touchedBookIds,
            summaryMessage: `Đã tạo đầu sách «${cleanTitle}» cùng +${generatedQrCodes.length} bản sao QR`,
        };
    }

    if (request.request_type === 'restock') {
        const [bookRows] = await connection.execute(
            "SELECT id, title, total_copies, available_copies, location FROM books WHERE id = ? AND COALESCE(status, 'active') = 'active' FOR UPDATE",
            [bookId]
        );
        if (bookRows.length === 0) {
            throw createExecutionError(404, 'Đầu sách không còn tồn tại hoặc đã bị thanh lý, không thể nhập bổ sung.');
        }

        const beforeSnapshot = await buildBookSnapshot(connection, bookId);
        const qty = parseInt(detail?.quantity ?? payload.additionalCopies, 10) || 0;
        if (qty < 1 || qty > 500) {
            throw createExecutionError(400, 'Số lượng bản sao bổ sung phải từ 1 đến 500');
        }

        const generatedQrCodes = await createBookCopiesBatch(connection, { bookId, quantity: qty });
        const targetLocation = detail?.location ? normalizeLocationString(detail.location) : bookRows[0].location;

        await connection.execute(
            `UPDATE books
             SET total_copies = total_copies + ?,
                 available_copies = available_copies + ?,
                 location = ?
             WHERE id = ?`,
            [qty, qty, targetLocation, bookId]
        );

        const afterSnapshot = await buildBookSnapshot(connection, bookId);
        touchedBookIds.push(bookId);

        return {
            beforeSnapshot,
            afterSnapshot: { ...afterSnapshot, generatedQrCodes },
            touchedBookIds,
            summaryMessage: `Đã nhập bổ sung +${qty} bản sao QR cho «${bookRows[0].title}» (${generatedQrCodes.join(', ')})`,
        };
    }

    if (request.request_type === 'import') {
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        if (rows.length === 0) {
            throw createExecutionError(400, 'Phiếu nhập Excel không chứa dòng dữ liệu hợp lệ nào.');
        }

        const importResult = await executeExcelImportBatch(connection, rows, detail?.location);
        return {
            beforeSnapshot: safeJsonParse(detail?.before_json) || { totalBooksBefore: payload.totalBooksBefore ?? null },
            afterSnapshot: importResult,
            touchedBookIds: importResult.touchedBookIds,
            summaryMessage: `Đã hoàn tất nhập kho ${importResult.importedCount} đầu sách (${importResult.createdBooksCount} đầu sách mới, ${importResult.restockedBooksCount} đầu sách bổ sung) và sinh ${importResult.totalCopiesGenerated} bản sao QR`,
        };
    }

    if (request.request_type === 'delete') {
        const [bookRows] = await connection.execute(
            "SELECT id, title, COALESCE(status, 'active') AS status FROM books WHERE id = ? FOR UPDATE",
            [bookId]
        );
        if (bookRows.length === 0) {
            throw createExecutionError(404, 'Đầu sách không tồn tại');
        }
        if (bookRows[0].status !== 'active') {
            throw createExecutionError(409, `Đầu sách «${bookRows[0].title}» đã ở trạng thái ${bookRows[0].status} trước đó.`);
        }

        const blockerCheck = await checkBookDisposalBlockers(connection, bookId);
        if (blockerCheck.blocked) {
            throw createExecutionError(409, `Không thể duyệt thanh lý: ${blockerCheck.summary}`);
        }

        const beforeSnapshot = await buildBookSnapshot(connection, bookId);
        const targetStatus = payload.disposal_status === 'inactive' ? 'inactive' : 'disposed';

        await connection.execute(
            `UPDATE books
             SET status = ?, deleted_at = NOW(), deleted_by = ?, available_copies = 0
             WHERE id = ?`,
            [targetStatus, reviewerId, bookId]
        );

        const afterSnapshot = await buildBookSnapshot(connection, bookId);
        return {
            beforeSnapshot,
            afterSnapshot,
            touchedBookIds: [],
            summaryMessage: `Đã chuyển đầu sách «${bookRows[0].title}» sang trạng thái ${targetStatus} (xóa mềm bảo toàn lịch sử)`,
        };
    }

    if (request.request_type === 'update_sensitive') {
        const [bookRows] = await connection.execute(
            "SELECT id, title, isbn FROM books WHERE id = ? AND COALESCE(status, 'active') = 'active' FOR UPDATE",
            [bookId]
        );
        if (bookRows.length === 0) {
            throw createExecutionError(404, 'Đầu sách không tồn tại hoặc đã bị thanh lý.');
        }

        const newIsbn = payload.isbn !== undefined ? (String(payload.isbn).trim() || null) : bookRows[0].isbn;
        if (newIsbn && newIsbn !== bookRows[0].isbn) {
            const [dupIsbn] = await connection.execute(
                "SELECT id FROM books WHERE isbn = ? AND id <> ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                [newIsbn, bookId]
            );
            if (dupIsbn.length > 0) {
                throw createExecutionError(409, `Mã ISBN "${newIsbn}" đang được sử dụng bởi đầu sách khác.`);
            }
        }

        const beforeSnapshot = await buildBookSnapshot(connection, bookId);
        const nextTitle = payload.title !== undefined ? String(payload.title).trim() : beforeSnapshot.title;
        const nextLocation = payload.location !== undefined ? normalizeLocationString(payload.location) : beforeSnapshot.location;

        await connection.execute(
            `UPDATE books
             SET title = ?,
                 author_id = ?,
                 publisher_id = ?,
                 category_id = ?,
                 isbn = ?,
                 published_year = ?,
                 description = ?,
                 location = ?
             WHERE id = ?`,
            [
                nextTitle || beforeSnapshot.title,
                payload.author_id !== undefined ? payload.author_id : beforeSnapshot.author_id,
                payload.publisher_id !== undefined ? payload.publisher_id : beforeSnapshot.publisher_id,
                payload.category_id !== undefined ? payload.category_id : beforeSnapshot.category_id,
                newIsbn,
                payload.published_year !== undefined ? payload.published_year : beforeSnapshot.published_year,
                payload.description !== undefined ? payload.description : beforeSnapshot.description,
                nextLocation,
                bookId,
            ]
        );

        const afterSnapshot = await buildBookSnapshot(connection, bookId);
        return {
            beforeSnapshot,
            afterSnapshot,
            touchedBookIds: [],
            summaryMessage: `Đã cập nhật mã định danh ISBN (${beforeSnapshot.isbn || 'Trống'} → ${newIsbn || 'Trống'}) cho «${afterSnapshot.title}»`,
        };
    }

    throw createExecutionError(400, `Loại phiếu đề xuất không được hỗ trợ: ${request.request_type}`);
};

module.exports = {
    REQUEST_TYPE_LABELS,
    normalizeLocationString,
    safeJsonParse,
    recordAuditLog,
    notifyUser,
    notifyRoles,
    validateExcelImportRows,
    checkBookDisposalBlockers,
    createBookCopiesBatch,
    buildBookSnapshot,
    createWarehouseRequest,
    executeApprovedRequest,
};

