const db = require('../config/db');
const {
    normalizeLocationString,
    safeJsonParse,
    recordAuditLog,
    notifyUser,
    notifyRoles,
    validateExcelImportRows,
    checkBookDisposalBlockers,
    buildBookSnapshot,
    createWarehouseRequest,
    executeApprovedRequest,
} = require('../services/warehouseGovernance');

exports.getBookRequests = async (req, res) => {
    try {
        const statusFilter = String(req.query.status || '').trim();
        const typeFilter = String(req.query.request_type || '').trim();

        const conditions = [];
        const params = [];

        if (statusFilter && statusFilter !== 'all') {
            conditions.push('br.status = ?');
            params.push(statusFilter);
        }
        if (typeFilter && typeFilter !== 'all') {
            conditions.push('br.request_type = ?');
            params.push(typeFilter);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows] = await db.execute(`
            SELECT br.*,
                   u_req.full_name AS requested_by_name,
                   u_req.email AS requested_by_email,
                   u_req.role AS requested_by_role,
                   u_rev.full_name AS reviewed_by_name,
                   u_rev.email AS reviewed_by_email,
                   brd.id AS detail_id,
                   brd.book_id,
                   brd.quantity,
                   brd.location,
                   brd.payload_json,
                   brd.before_json,
                   b.title AS book_title,
                   b.isbn AS book_isbn,
                   b.location AS book_current_location,
                   b.total_copies AS book_total_copies,
                   b.available_copies AS book_available_copies,
                   COALESCE(b.status, 'active') AS book_status
            FROM book_requests br
            LEFT JOIN users u_req ON br.requested_by = u_req.id
            LEFT JOIN users u_rev ON br.reviewed_by = u_rev.id
            LEFT JOIN book_request_details brd ON brd.request_id = br.id
            LEFT JOIN books b ON brd.book_id = b.id
            ${whereClause}
            ORDER BY
                CASE br.status WHEN 'pending' THEN 0 ELSE 1 END ASC,
                br.created_at DESC
            LIMIT 150
        `, params);

        const requestIds = rows.map((r) => r.id);
        const approvalsByRequest = new Map();

        if (requestIds.length > 0) {
            const placeholders = requestIds.map(() => '?').join(',');
            const [approvals] = await db.execute(`
                SELECT bra.*, u.full_name AS reviewer_name, u.role AS reviewer_role
                FROM book_request_approvals bra
                LEFT JOIN users u ON bra.reviewer_id = u.id
                WHERE bra.request_id IN (${placeholders})
                ORDER BY bra.created_at ASC, bra.id ASC
            `, requestIds);

            for (const item of approvals) {
                if (!approvalsByRequest.has(item.request_id)) {
                    approvalsByRequest.set(item.request_id, []);
                }
                approvalsByRequest.get(item.request_id).push(item);
            }
        }

        const [statusCounts] = await db.execute(`
            SELECT status, COUNT(*) AS count
            FROM book_requests
            GROUP BY status
        `);

        const summary = { pending: 0, approved: 0, rejected: 0, cancelled: 0, completed: 0, total: 0 };
        for (const row of statusCounts) {
            const cnt = Number(row.count) || 0;
            if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
                summary[row.status] = cnt;
            }
            summary.total += cnt;
        }

        const requests = rows.map((row) => ({
            ...row,
            payload: safeJsonParse(row.payload_json),
            before: safeJsonParse(row.before_json),
            approvals: approvalsByRequest.get(row.id) || [],
        }));

        res.status(200).json({ requests, summary });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phiếu đề xuất kho:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách phiếu đề xuất kho' });
    }
};

exports.createBookRequest = async (req, res) => {
    const requestedBy = req.user.id;
    const {
        request_type: rawType,
        book_id: rawBookId,
        quantity: rawQuantity,
        location: rawLocation,
        reason,
        payload = {},
    } = req.body;

    const requestType = String(rawType || '').trim();
    const validTypes = ['create', 'import', 'restock', 'delete', 'update_sensitive'];

    if (!validTypes.includes(requestType)) {
        return res.status(400).json({ message: 'Loại phiếu đề xuất kho không hợp lệ' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        let createdRequest = null;

        if (requestType === 'create') {
            const bookTitle = String(payload.title || req.body.title || '').trim();
            if (!bookTitle) {
                await connection.rollback();
                return res.status(400).json({ message: 'Vui lòng nhập tên đầu sách cần đề xuất' });
            }

            const qty = parseInt(rawQuantity ?? payload.total_copies ?? 0, 10) || 0;
            if (qty < 1 || qty > 500) {
                await connection.rollback();
                return res.status(400).json({ message: 'Số lượng bản sao vật lý đề xuất nhập kho phải từ 1 đến 500' });
            }

            const cleanIsbn = String(payload.isbn ?? req.body.isbn ?? '').trim() || null;
            if (cleanIsbn) {
                const [dup] = await connection.execute(
                    "SELECT id FROM books WHERE isbn = ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                    [cleanIsbn]
                );
                if (dup.length > 0) {
                    await connection.rollback();
                    return res.status(409).json({ message: `Mã ISBN "${cleanIsbn}" đã tồn tại trên hệ thống` });
                }
            }

            const targetLoc = normalizeLocationString(rawLocation || payload.location);
            const normalizedPayload = {
                title: bookTitle,
                author_id: payload.author_id || null,
                publisher_id: payload.publisher_id || null,
                category_id: payload.category_id || null,
                isbn: cleanIsbn,
                published_year: payload.published_year || new Date().getFullYear(),
                description: payload.description || 'Mô tả sách thư viện',
                cover_image: payload.cover_image || null,
                location: targetLoc,
                total_copies: qty,
            };

            createdRequest = await createWarehouseRequest(connection, {
                requestType: 'create',
                title: `Thêm đầu sách «${bookTitle}» (+${qty} bản sao)`,
                reason: reason || `Đề xuất tạo mới đầu sách kèm ${qty} bản sao vật lý`,
                requestedBy,
                quantity: qty,
                location: targetLoc,
                payload: normalizedPayload,
                before: null,
                actionLog: 'PROPOSE_BOOK_CREATE',
            });
        } else if (requestType === 'restock') {
            const bookId = parseInt(rawBookId, 10);
            const qty = parseInt(rawQuantity ?? payload.additionalCopies, 10);

            if (!bookId || !Number.isInteger(qty) || qty < 1 || qty > 500) {
                await connection.rollback();
                return res.status(400).json({ message: 'Vui lòng chọn đầu sách và số lượng nhập bổ sung hợp lệ (1 - 500)' });
            }

            const before = await buildBookSnapshot(connection, bookId);
            if (!before || before.status !== 'active') {
                await connection.rollback();
                return res.status(404).json({ message: 'Không tìm thấy đầu sách đang hoạt động trong kho' });
            }

            const targetLoc = rawLocation ? normalizeLocationString(rawLocation) : before.location;
            createdRequest = await createWarehouseRequest(connection, {
                requestType: 'restock',
                title: `Nhập bổ sung +${qty} bản sao «${before.title}»`,
                reason: reason || `Đề xuất nhập bổ sung +${qty} bản sao phục vụ nhu cầu bạn đọc`,
                requestedBy,
                bookId,
                quantity: qty,
                location: targetLoc,
                payload: { book_id: bookId, additionalCopies: qty, location: targetLoc },
                before,
                actionLog: 'PROPOSE_BOOK_RESTOCK',
            });
        } else if (requestType === 'import') {
            const sourceRows = Array.isArray(payload.rows)
                ? payload.rows
                : Array.isArray(req.body.books)
                    ? req.body.books
                    : [];

            if (sourceRows.length === 0) {
                await connection.rollback();
                return res.status(400).json({ message: 'Danh sách sách nhập từ Excel đang rỗng' });
            }

            const { validRows, invalidRows } = validateExcelImportRows(sourceRows);
            if (validRows.length === 0) {
                await connection.rollback();
                return res.status(400).json({
                    message: 'Không có dòng dữ liệu hợp lệ nào trong file Excel',
                    invalidRows,
                });
            }

            const totalCopies = validRows.reduce((sum, item) => sum + (Number(item.total_copies) || 1), 0);
            const fileName = String(payload.fileName || req.body.fileName || 'Excel batch').trim();

            createdRequest = await createWarehouseRequest(connection, {
                requestType: 'import',
                title: `Nhập Excel (${validRows.length} đầu sách • ${totalCopies} bản sao)`,
                reason: reason || `Đề xuất nhập kho hàng loạt từ file "${fileName}"`,
                requestedBy,
                quantity: totalCopies,
                location: rawLocation ? normalizeLocationString(rawLocation) : 'Theo cấu hình từng dòng Excel',
                payload: {
                    fileName,
                    validCount: validRows.length,
                    invalidCount: invalidRows.length,
                    totalCopies,
                    rows: validRows,
                },
                before: { fileName, validCount: validRows.length, invalidCount: invalidRows.length },
                actionLog: 'PROPOSE_BOOK_IMPORT',
            });
        } else if (requestType === 'delete') {
            const bookId = parseInt(rawBookId, 10);
            if (!bookId) {
                await connection.rollback();
                return res.status(400).json({ message: 'Vui lòng chọn đầu sách cần đề xuất thanh lý' });
            }

            const before = await buildBookSnapshot(connection, bookId);
            if (!before || before.status !== 'active') {
                await connection.rollback();
                return res.status(404).json({ message: 'Đầu sách không tồn tại hoặc đã ngừng lưu thông' });
            }

            const [existingPendingDelete] = await connection.execute(
                `SELECT br.id, br.request_code
                 FROM book_requests br
                 JOIN book_request_details brd ON brd.request_id = br.id
                 WHERE br.request_type = 'delete' AND br.status = 'pending' AND brd.book_id = ?
                 LIMIT 1`,
                [bookId]
            );
            if (existingPendingDelete.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    message: `Đầu sách «${before.title}» đã có phiếu đề xuất thanh lý ${existingPendingDelete[0].request_code} đang chờ Chủ thư viện duyệt.`,
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

            const disposalStatus = payload.disposal_status === 'inactive' ? 'inactive' : 'disposed';
            createdRequest = await createWarehouseRequest(connection, {
                requestType: 'delete',
                title: `Đề xuất thanh lý «${before.title}» (${before.total_copies} bản sao)`,
                reason: reason || 'Đề xuất thanh lý / ngừng lưu thông đầu sách theo kiểm kê kho',
                requestedBy,
                bookId,
                quantity: before.total_copies,
                location: before.location,
                payload: { book_id: bookId, disposal_status: disposalStatus },
                before,
                actionLog: 'PROPOSE_BOOK_DELETE',
            });
        } else if (requestType === 'update_sensitive') {
            const bookId = parseInt(rawBookId, 10);
            if (!bookId) {
                await connection.rollback();
                return res.status(400).json({ message: 'Vui lòng chọn đầu sách cần cập nhật thông tin định danh' });
            }

            const before = await buildBookSnapshot(connection, bookId);
            if (!before || before.status !== 'active') {
                await connection.rollback();
                return res.status(404).json({ message: 'Không tìm thấy đầu sách đang hoạt động' });
            }

            const nextIsbn = payload.isbn !== undefined ? (String(payload.isbn).trim() || null) : before.isbn;
            if (nextIsbn && nextIsbn !== before.isbn) {
                const [dup] = await connection.execute(
                    "SELECT id FROM books WHERE isbn = ? AND id <> ? AND COALESCE(status, 'active') = 'active' LIMIT 1",
                    [nextIsbn, bookId]
                );
                if (dup.length > 0) {
                    await connection.rollback();
                    return res.status(409).json({ message: `Mã ISBN "${nextIsbn}" đã thuộc về một đầu sách khác` });
                }
            }

            createdRequest = await createWarehouseRequest(connection, {
                requestType: 'update_sensitive',
                title: `Đổi mã định danh ISBN «${before.title}»`,
                reason: reason || `Đề xuất chỉnh sửa mã ISBN (${before.isbn || 'Trống'} → ${nextIsbn || 'Trống'})`,
                requestedBy,
                bookId,
                quantity: before.total_copies,
                location: payload.location ? normalizeLocationString(payload.location) : before.location,
                payload: { ...payload, book_id: bookId, isbn: nextIsbn },
                before,
                actionLog: 'PROPOSE_BOOK_UPDATE_SENSITIVE',
            });
        }

        await connection.commit();

        res.status(202).json({
            requiresApproval: true,
            message: `Đã tạo phiếu ${createdRequest.request_code} chờ Chủ thư viện phê duyệt! Kho sách chưa thay đổi cho đến khi được duyệt.`,
            request: createdRequest,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi tạo phiếu đề xuất kho sách:', error);
        res.status(500).json({ message: 'Lỗi server khi tạo phiếu đề xuất kho sách' });
    } finally {
        connection.release();
    }
};

exports.reviewBookRequest = async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    const reviewerId = req.user.id;
    const rawDecision = String(req.body.decision || req.body.status || '').trim().toLowerCase();
    const reviewNote = String(req.body.review_note || req.body.note || '').trim();

    if (!requestId || !['approved', 'rejected'].includes(rawDecision)) {
        return res.status(400).json({ message: 'Quyết định duyệt không hợp lệ (chỉ chấp nhận approved hoặc rejected)' });
    }

    if (rawDecision === 'rejected' && !reviewNote) {
        return res.status(400).json({ message: 'Vui lòng nhập lý do từ chối phiếu đề xuất để Thủ thư đối chiếu' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    let touchedBookIds = [];

    try {
        // Lock the proposal row inside transaction to eliminate duplicate concurrent approvals (Rule 5)
        const [reqRows] = await connection.execute(
            'SELECT * FROM book_requests WHERE id = ? FOR UPDATE',
            [requestId]
        );

        if (reqRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy phiếu đề xuất kho sách' });
        }

        const request = reqRows[0];

        // Rule 1: Maker cannot self-approve even if holding privileges
        if (Number(request.requested_by) === Number(reviewerId)) {
            await connection.rollback();
            return res.status(403).json({
                message: 'Vi phạm nguyên tắc kiểm soát kép (Maker–Checker): Người tạo phiếu không được tự phê duyệt phiếu của chính mình!',
            });
        }

        // Rule 5: Prevent double review
        if (request.status !== 'pending') {
            await connection.rollback();
            return res.status(409).json({
                message: `Phiếu ${request.request_code || `#${request.id}`} đã ở trạng thái "${request.status}" trước đó, không thể duyệt trùng!`,
            });
        }

        const [detailRows] = await connection.execute(
            'SELECT * FROM book_request_details WHERE request_id = ? LIMIT 1',
            [requestId]
        );
        const detail = detailRows[0] || {};

        if (rawDecision === 'rejected') {
            await connection.execute(
                `UPDATE book_requests
                 SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_note = ?
                 WHERE id = ?`,
                [reviewerId, reviewNote, requestId]
            );

            await connection.execute(
                `INSERT INTO book_request_approvals (request_id, reviewer_id, decision, note)
                 VALUES (?, ?, 'rejected', ?)`,
                [requestId, reviewerId, reviewNote]
            );

            await recordAuditLog(connection, {
                userId: reviewerId,
                action: 'REJECT_BOOK_REQUEST',
                targetType: 'book_requests',
                targetId: requestId,
                details: `[${request.request_code}] Chủ thư viện từ chối phiếu "${request.title}". Lý do: ${reviewNote}`,
                beforeData: { status: 'pending', payload: safeJsonParse(detail.payload_json) },
                afterData: { status: 'rejected', review_note: reviewNote },
                outcome: 'rejected',
            });

            await notifyUser(connection, request.requested_by, {
                title: `Phiếu kho ${request.request_code} bị từ chối`,
                message: `Chủ thư viện đã từ chối phiếu "${request.title}". Lý do: ${reviewNote}`,
                type: 'warning',
            });

            await connection.commit();
            return res.status(200).json({
                message: `Đã từ chối phiếu ${request.request_code}!`,
                status: 'rejected',
            });
        }

        // Approved branch -> record approval, execute inventory transaction atomically, mark completed
        await connection.execute(
            `INSERT INTO book_request_approvals (request_id, reviewer_id, decision, note)
             VALUES (?, ?, 'approved', ?)`,
            [requestId, reviewerId, reviewNote || 'Chủ thư viện đã phê duyệt']
        );

        const execResult = await executeApprovedRequest(connection, { request, detail, reviewerId });
        touchedBookIds = execResult.touchedBookIds || [];

        await connection.execute(
            `UPDATE book_requests
             SET status = 'completed', reviewed_by = ?, reviewed_at = NOW(), review_note = ?, completed_at = NOW()
             WHERE id = ?`,
            [reviewerId, reviewNote || 'Đã phê duyệt & thực thi cập nhật kho', requestId]
        );

        await connection.execute(
            `INSERT INTO book_request_approvals (request_id, reviewer_id, decision, note)
             VALUES (?, ?, 'completed', ?)`,
            [requestId, reviewerId, execResult.summaryMessage]
        );

        await recordAuditLog(connection, {
            userId: reviewerId,
            action: 'APPROVE_BOOK_REQUEST',
            targetType: 'book_requests',
            targetId: requestId,
            details: `[${request.request_code}] Phê duyệt & thực thi: ${execResult.summaryMessage}${reviewNote ? `. Ghi chú: ${reviewNote}` : ''}`,
            beforeData: execResult.beforeSnapshot,
            afterData: execResult.afterSnapshot,
            outcome: 'completed',
        });

        await notifyUser(connection, request.requested_by, {
            title: `Phiếu kho ${request.request_code} đã được duyệt & hoàn tất`,
            message: `Chủ thư viện đã phê duyệt phiếu "${request.title}". Kết quả: ${execResult.summaryMessage}.`,
            type: 'info',
        });

        await notifyRoles(connection, ['admin'], {
            title: `[Giám sát] Phiếu kho ${request.request_code} đã hoàn tất`,
            message: `Chủ thư viện đã phê duyệt phiếu "${request.title}": ${execResult.summaryMessage}.`,
            type: 'info',
        });

        await connection.commit();

        // Sync reservation queue non-blocking if physical stock increased
        if (touchedBookIds.length > 0) {
            try {
                const { syncWaitingReservationsWithStock } = require('./reservationController');
                if (typeof syncWaitingReservationsWithStock === 'function') {
                    for (const bid of touchedBookIds) {
                        await syncWaitingReservationsWithStock(bid);
                    }
                }
            } catch {
                // Non-blocking sync
            }
        }

        res.status(200).json({
            message: `Đã phê duyệt & thực thi ${request.request_code}: ${execResult.summaryMessage}`,
            status: 'completed',
            result: execResult,
        });
    } catch (error) {
        await connection.rollback();
        if (error.statusCode) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error('Lỗi khi phê duyệt phiếu kho:', error);
        res.status(500).json({ message: 'Lỗi server khi phê duyệt phiếu đề xuất kho sách' });
    } finally {
        connection.release();
    }
};

exports.cancelBookRequest = async (req, res) => {
    const requestId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const cancelReason = String(req.body?.reason || '').trim();

    if (!requestId) {
        return res.status(400).json({ message: 'Mã phiếu đề xuất không hợp lệ' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [rows] = await connection.execute(
            'SELECT * FROM book_requests WHERE id = ? FOR UPDATE',
            [requestId]
        );
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy phiếu đề xuất' });
        }

        const request = rows[0];
        if (Number(request.requested_by) !== Number(userId)) {
            await connection.rollback();
            return res.status(403).json({ message: 'Chỉ Thủ thư đã tạo phiếu mới có quyền hủy phiếu này' });
        }

        if (request.status !== 'pending') {
            await connection.rollback();
            return res.status(409).json({ message: `Không thể hủy phiếu đang ở trạng thái "${request.status}"` });
        }

        await connection.execute(
            `UPDATE book_requests
             SET status = 'cancelled', review_note = ?
             WHERE id = ?`,
            [cancelReason || 'Người đề xuất chủ động hủy phiếu', requestId]
        );

        await connection.execute(
            `INSERT INTO book_request_approvals (request_id, reviewer_id, decision, note)
             VALUES (?, ?, 'cancelled', ?)`,
            [requestId, userId, cancelReason || 'Thủ thư hủy phiếu khi còn chờ duyệt']
        );

        await recordAuditLog(connection, {
            userId,
            action: 'CANCEL_BOOK_REQUEST',
            targetType: 'book_requests',
            targetId: requestId,
            details: `[${request.request_code}] Thủ thư đã hủy phiếu đề xuất "${request.title}". ${cancelReason ? `Lý do: ${cancelReason}` : ''}`,
            beforeData: { status: 'pending' },
            afterData: { status: 'cancelled', reason: cancelReason || null },
            outcome: 'cancelled',
        });

        await connection.commit();
        res.status(200).json({ message: `Đã hủy phiếu đề xuất ${request.request_code}!`, status: 'cancelled' });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi hủy phiếu đề xuất:', error);
        res.status(500).json({ message: 'Lỗi server khi hủy phiếu đề xuất' });
    } finally {
        connection.release();
    }
};

