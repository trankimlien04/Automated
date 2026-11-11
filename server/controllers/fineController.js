const db = require('../config/db');
const { notifyAllStaff } = require('../services/notificationService');
const {
    syncOverdueFines,
    getReaderCirculationStatus,
    applyLateReturnSuspension
} = require('../services/fineSyncService');

exports.getFines = async (req, res) => {
    const { role, id } = req.user;

    try {
        await syncOverdueFines(role === 'reader' ? id : null);

        let query = `
            SELECT f.id, 0 as amount, f.reason, f.status,
                   IFNULL(f.violation_type, 'overdue') as violation_type,
                   IFNULL(f.severity, 'none') as severity,
                   IFNULL(f.remediation_status, IF(f.status = 'paid', 'resolved', 'active_overdue')) as remediation_status,
                   f.remediation_action, f.remediation_note, f.resolved_at,
                   resolver.full_name as resolved_by_name,
                   IFNULL(f.resolved_at, IFNULL(br.return_date, f.paid_at)) as payment_date,
                   f.created_at,
                   u.id as user_id, u.full_name as reader_name, u.card_number,
                   u.status as user_status, u.suspended_until,
                   b.id as book_id, b.title as book_title,
                   bc.id as book_copy_id, bc.qr_code as book_copy_qr, bc.status as copy_status,
                   br.id as borrow_record_id, br.status as borrow_status, br.borrow_date, br.due_date, br.return_date,
                   CASE
                     WHEN br.status IN ('returned', 'returned_drop_box') THEN GREATEST(0, DATEDIFF(DATE(IFNULL(br.drop_box_at, br.return_date)), DATE(br.due_date)))
                     WHEN br.due_date IS NOT NULL THEN GREATEST(0, DATEDIFF(CURDATE(), DATE(br.due_date)))
                     ELSE 0
                   END as overdue_days
            FROM fines f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN users resolver ON f.resolved_by = resolver.id
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE f.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY (f.status = "unpaid") DESC, f.created_at DESC';

        const [results] = await db.execute(query, params);
        const formatted = results.map(r => ({
            ...r,
            amount: 0
        }));
        res.status(200).json(formatted);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách vi phạm & kỷ luật mượn:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách vi phạm' });
    }
};

exports.getCirculationStatus = async (req, res) => {
    try {
        const isStaff = ['admin', 'librarian', 'owner'].includes(req.user.role);
        const targetUserId = isStaff && req.query.userId ? Number(req.query.userId) : req.user.id;

        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
            return res.status(400).json({ message: 'ID độc giả không hợp lệ' });
        }

        await syncOverdueFines(targetUserId);
        const statusInfo = await getReaderCirculationStatus(targetUserId);

        if (!statusInfo) {
            return res.status(404).json({ message: 'Không tìm thấy độc giả' });
        }

        res.status(200).json(statusInfo);
    } catch (error) {
        console.error('Lỗi khi kiểm tra trạng thái lưu thông độc giả:', error);
        res.status(500).json({ message: 'Lỗi server khi kiểm tra trạng thái quyền mượn' });
    }
};

exports.reportBookIncident = async (req, res) => {
    const {
        borrowRecordId,
        violationType = 'damaged',
        severity = 'moderate',
        remediationAction,
        reason,
        conditionNote
    } = req.body || {};
    const staffId = req.user.id;

    if (!borrowRecordId) {
        return res.status(400).json({ message: 'Vui lòng chọn phiếu mượn liên quan để lập biên bản.' });
    }
    if (!['damaged', 'lost'].includes(violationType)) {
        return res.status(400).json({ message: 'Loại biên bản chỉ hỗ trợ damaged (hư hỏng) hoặc lost (mất sách).' });
    }

    const validSeverities = ['minor', 'moderate', 'severe', 'lost'];
    const finalSeverity = violationType === 'lost'
        ? 'lost'
        : (validSeverities.includes(severity) ? severity : 'moderate');

    const defaultAction = violationType === 'lost'
        ? 'Nộp sách thay thế cùng nhan đề hoặc ấn bản tương đương theo quy định thư viện'
        : finalSeverity === 'severe'
            ? 'Nộp sách thay thế tương đương theo quy chế thư viện'
            : 'Khắc phục / Phục hồi nguyên trạng sách dưới sự hướng dẫn của thủ thư';

    const finalAction = (remediationAction || '').trim() || defaultAction;
    const finalReason = (reason || '').trim() || (
        violationType === 'lost'
            ? 'Báo mất sách - Chờ nộp sách thay thế theo quy chế thư viện'
            : `Biên bản sách hư hỏng (${finalSeverity}) - Chờ khắc phục theo quy chế`
    );

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [records] = await connection.execute(
            `SELECT br.*, u.full_name as reader_name, u.card_number,
                    bc.id as copy_id, bc.book_id, bc.qr_code, bc.status as copy_status,
                    b.title as book_title
             FROM borrow_records br
             JOIN users u ON br.user_id = u.id
             JOIN book_copies bc ON br.book_copy_id = bc.id
             JOIN books b ON bc.book_id = b.id
             WHERE br.id = ? FOR UPDATE`,
            [borrowRecordId]
        );

        if (records.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy giao dịch mượn sách này.' });
        }
        const rec = records[0];

        const [existingPending] = await connection.execute(
            "SELECT id FROM fines WHERE borrow_record_id = ? AND violation_type IN ('damaged', 'lost') AND remediation_status = 'pending_remediation'",
            [borrowRecordId]
        );
        if (existingPending.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Phiếu mượn này đã có biên bản hư hỏng/mất đang chờ khắc phục.' });
        }

        const targetCopyStatus = violationType === 'lost' ? 'lost' : 'damaged';

        if (rec.status === 'borrowing') {
            // Apply temporary suspension as well if returned/reported past due date
            await applyLateReturnSuspension(connection, rec.user_id, rec.due_date, new Date());

            await connection.execute(
                "UPDATE borrow_records SET status = 'returned', return_date = NOW(), note = CONCAT(IFNULL(note, ''), ?) WHERE id = ?",
                [` | Biên bản ${violationType}: ${finalReason}`, borrowRecordId]
            );
            await connection.execute(
                "UPDATE book_copies SET status = ?, condition_note = ? WHERE id = ?",
                [targetCopyStatus, (conditionNote || finalReason), rec.copy_id]
            );
            // Resolve any stale overdue row for this record since copy is no longer unreturned overdue
            await connection.execute(
                "UPDATE fines SET status = 'paid', amount = 0, remediation_status = 'resolved', resolved_at = NOW(), paid_at = NOW() WHERE borrow_record_id = ? AND (violation_type = 'overdue' OR violation_type IS NULL)",
                [borrowRecordId]
            );
        } else {
            if (rec.copy_status === 'available') {
                await connection.execute(
                    "UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?",
                    [rec.book_id]
                );
            }
            await connection.execute(
                "UPDATE book_copies SET status = ?, condition_note = ? WHERE id = ?",
                [targetCopyStatus, (conditionNote || finalReason), rec.copy_id]
            );
        }

        const [insertRes] = await connection.execute(
            `INSERT INTO fines (
                borrow_record_id, user_id, amount, reason, status,
                violation_type, severity, remediation_status, remediation_action, created_at
            ) VALUES (?, ?, 0, ?, 'unpaid', ?, ?, 'pending_remediation', ?, NOW())`,
            [borrowRecordId, rec.user_id, finalReason, violationType, finalSeverity, finalAction]
        );

        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [
                staffId,
                'REPORT_BOOK_INCIDENT',
                'fines',
                insertRes.insertId,
                `Lập biên bản ${violationType} (${finalSeverity}) cho sách "${rec.book_title}" (${rec.qr_code}) - Độc giả: ${rec.reader_name} (${rec.card_number}). Hướng khắc phục: ${finalAction}`
            ]
        );

        await connection.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
            [
                rec.user_id,
                violationType === 'lost' ? 'Biên bản mất sách — Tạm khóa quyền mượn' : 'Biên bản sách hư hỏng — Chờ khắc phục',
                `Cuốn sách "${rec.book_title}" (${rec.qr_code}) được ghi nhận ${violationType === 'lost' ? 'báo mất' : 'hư hỏng'}. Hướng xử lý: ${finalAction}. Quyền mượn/đặt trước tạm ngưng cho đến khi thủ thư xác nhận đã khắc phục.`
            ]
        );

        await connection.commit();

        await notifyAllStaff(
            `Lập biên bản ${violationType === 'lost' ? 'mất sách' : 'hư hỏng sách'}`,
            `Độc giả ${rec.reader_name} (${rec.card_number}) có biên bản #${insertRes.insertId} cho cuốn "${rec.book_title}" (${rec.qr_code}). Trạng thái: Chờ khắc phục hiện vật.`,
            'warning',
            staffId
        );

        const updatedStatus = await getReaderCirculationStatus(rec.user_id);

        res.status(201).json({
            message: 'Đã lập biên bản hiện trạng sách và tạm ngưng quyền mượn chờ khắc phục!',
            incidentId: insertRes.insertId,
            circulationStatus: updatedStatus
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi lập biên bản hư hỏng/mất sách:', error);
        res.status(500).json({ message: 'Lỗi server khi lập biên bản hiện trạng sách' });
    } finally {
        connection.release();
    }
};

exports.resolveViolation = async (req, res) => {
    const { id } = req.params;
    const { remediationNote, restoreCopy = false } = req.body || {};
    const processedBy = req.user.id;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [fines] = await connection.execute(
            `SELECT f.*, u.full_name as reader_name, u.card_number,
                    br.status as borrow_status, br.book_copy_id,
                    bc.book_id, bc.status as copy_status, bc.qr_code,
                    b.title as book_title
             FROM fines f
             JOIN users u ON f.user_id = u.id
             LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
             LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
             LEFT JOIN books b ON bc.book_id = b.id
             WHERE f.id = ? FOR UPDATE`,
            [id]
        );

        if (fines.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ vi phạm / biên bản khắc phục.' });
        }
        const fine = fines[0];

        if (fine.status === 'paid' && fine.remediation_status === 'resolved') {
            await connection.rollback();
            return res.status(400).json({ message: 'Hồ sơ vi phạm này đã được xác nhận khắc phục trước đó.' });
        }

        if ((fine.violation_type === 'overdue' || !fine.violation_type) && fine.borrow_status === 'borrowing') {
            await connection.rollback();
            return res.status(400).json({
                message: 'Độc giả chưa hoàn trả cuốn sách quá hạn này vào kho. Vui lòng thực hiện nghiệp vụ Trả sách trước khi đóng vi phạm.'
            });
        }

        const noteText = (remediationNote || '').trim() || 'Thủ thư đã kiểm tra và xác nhận độc giả hoàn tất khắc phục theo quy chế.';

        await connection.execute(
            `UPDATE fines
             SET status = 'paid',
                 amount = 0,
                 remediation_status = 'resolved',
                 remediation_note = ?,
                 resolved_by = ?,
                 resolved_at = NOW(),
                 paid_at = NOW()
             WHERE id = ?`,
            [noteText, processedBy, id]
        );

        // If a replacement book or repaired copy is placed back on shelf
        if (restoreCopy && fine.book_copy_id && ['damaged', 'lost'].includes(fine.copy_status)) {
            await connection.execute(
                "UPDATE book_copies SET status = 'available', condition_note = ? WHERE id = ?",
                [`Đã khắc phục/bổ sung bản sao thay thế: ${noteText}`, fine.book_copy_id]
            );
            await connection.execute(
                "UPDATE books SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?",
                [fine.book_id]
            );
        }

        // Re-evaluate multi-cause status AFTER clearing this violation!
        // If reader still has OVERDUE books or SUSPENDED period or another PENDING_REMEDIATION,
        // eligibleToBorrow remains FALSE automatically.
        const updatedStatus = await getReaderCirculationStatus(fine.user_id, connection);

        const unlockMessage = updatedStatus && updatedStatus.eligibleToBorrow
            ? 'Không còn hạn chế lưu thông nào — quyền mượn sách của bạn đã được mở lại.'
            : `Hồ sơ #${id} đã đóng, tuy nhiên thẻ vẫn tạm ngưng do: ${updatedStatus?.blockReason || 'còn vi phạm khác chưa xử lý'}.`;

        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [
                processedBy,
                'RESOLVE_VIOLATION',
                'fines',
                id,
                `Xác nhận hoàn tất khắc phục hồ sơ #${id} (${fine.violation_type || 'overdue'}) cho ${fine.reader_name} (${fine.card_number}). Ghi chú: ${noteText}. Trạng thái thẻ sau cập nhật: ${updatedStatus?.primaryStatus || 'ELIGIBLE'}`
            ]
        );

        await connection.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
            [
                fine.user_id,
                'Xác nhận đã khắc phục vi phạm',
                `Thủ thư đã xác nhận hoàn tất khắc phục biên bản "${fine.book_title || 'Lưu thông sách'}" (${noteText}). ${unlockMessage}`,
                updatedStatus?.eligibleToBorrow ? 'info' : 'warning'
            ]
        );

        await connection.commit();

        await notifyAllStaff(
            'Đã xác nhận khắc phục vi phạm',
            `Độc giả ${fine.reader_name} (${fine.card_number}) đã được xác nhận khắc phục hồ sơ #${id} (${fine.book_title || ''}). Trạng thái lưu thông hiện tại: ${updatedStatus?.primaryStatus || 'ELIGIBLE'}.`,
            'info',
            processedBy
        );

        res.status(200).json({
            message: updatedStatus?.eligibleToBorrow
                ? 'Đã xác nhận khắc phục và mở lại quyền mượn sách cho độc giả!'
                : 'Đã xác nhận khắc phục biên bản này (độc giả vẫn còn điều kiện hạn chế khác chưa hết).',
            violation: {
                id: fine.id,
                status: 'paid',
                remediation_status: 'resolved',
                remediation_note: noteText,
                restoreCopy: Boolean(restoreCopy)
            },
            circulationStatus: updatedStatus
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi xác nhận khắc phục vi phạm:', error);
        res.status(500).json({ message: 'Lỗi server khi xác nhận khắc phục vi phạm' });
    } finally {
        connection.release();
    }
};
