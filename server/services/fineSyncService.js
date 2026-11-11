const db = require('../config/db');

/**
 * Standard calculation for calendar overdue days (without monetary fines).
 * Normalizes both reference date and dueDate to midnight (00:00:00) to ensure
 * consistency regardless of hour of day.
 */
function calculateOverdue(dueDateInput, referenceDateInput = new Date()) {
    const due = new Date(dueDateInput);
    const ref = new Date(referenceDateInput);
    ref.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);

    const diffTime = ref.getTime() - due.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const overdueDays = Math.max(0, diffDays);

    return {
        overdueDays,
        dueDateFormatted: new Date(dueDateInput).toLocaleDateString('vi-VN')
    };
}

/**
 * Fetch normalized non-monetary circulation & suspension discipline settings.
 */
async function getDisciplineConfigs(conn = db) {
    const [rows] = await conn.execute('SELECT key_name, value FROM system_configs');
    const map = {};
    for (const r of rows) {
        map[r.key_name] = r.value;
    }

    const parseIntOr = (val, fallback) => {
        const parsed = parseInt(val, 10);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const rawBlockReserve = String(map.block_reserve_when_suspended ?? '1').trim().toLowerCase();
    return {
        maxBooksPerUser: Math.max(1, parseIntOr(map.max_books_per_user, 5)),
        maxBorrowDays: Math.max(1, parseIntOr(map.max_borrow_days, 14)),
        graceDays: Math.max(0, parseIntOr(map.grace_days, 0)),
        suspensionDaysPerLateDay: Math.max(0, parseIntOr(map.suspension_days_per_late_day, 1)),
        maxSuspensionDays: Math.max(0, parseIntOr(map.max_suspension_days, 14)),
        blockReserveWhenSuspended: rawBlockReserve === '1' || rawBlockReserve === 'true' || rawBlockReserve === 'yes'
    };
}

/**
 * Apply Case 2 (SUSPENDED) temporary borrow suspension when a reader returns a book late.
 * Returns { overdueDays, effectiveLateDays, suspendedDaysAdded, suspendedUntil }.
 */
async function applyLateReturnSuspension(conn, userId, dueDateInput, returnDateInput = new Date()) {
    const { overdueDays } = calculateOverdue(dueDateInput, returnDateInput);
    const configs = await getDisciplineConfigs(conn);
    const effectiveLateDays = Math.max(0, overdueDays - configs.graceDays);

    if (effectiveLateDays <= 0 || configs.suspensionDaysPerLateDay <= 0 || configs.maxSuspensionDays <= 0) {
        return {
            overdueDays,
            effectiveLateDays,
            suspendedDaysAdded: 0,
            suspendedUntil: null
        };
    }

    const suspendedDaysAdded = Math.min(
        configs.maxSuspensionDays,
        effectiveLateDays * configs.suspensionDaysPerLateDay
    );

    if (suspendedDaysAdded <= 0) {
        return {
            overdueDays,
            effectiveLateDays,
            suspendedDaysAdded: 0,
            suspendedUntil: null
        };
    }

    // Extend from current suspended_until (if still active) or NOW(), capped at maxSuspensionDays from NOW()
    await conn.execute(
        `UPDATE users
         SET suspended_until = LEAST(
             DATE_ADD(NOW(), INTERVAL ? DAY),
             DATE_ADD(GREATEST(IFNULL(suspended_until, NOW()), NOW()), INTERVAL ? DAY)
         )
         WHERE id = ?`,
        [configs.maxSuspensionDays, suspendedDaysAdded, userId]
    );

    const [updated] = await conn.execute('SELECT suspended_until FROM users WHERE id = ?', [userId]);
    return {
        overdueDays,
        effectiveLateDays,
        suspendedDaysAdded,
        suspendedUntil: updated[0]?.suspended_until || null
    };
}

/**
 * Synchronize overdue borrow records with the `fines` (Violation & Remediation Ledger) table.
 * Strictly scopes operations to `violation_type = 'overdue'` so damaged/lost remediation records are never overwritten.
 */
async function syncOverdueFines(userId = null) {
    try {
        // 1.1. Returned on time or early -> clean up overdue ledger row
        await db.execute(`
            DELETE f FROM fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            WHERE (f.violation_type = 'overdue' OR f.violation_type IS NULL)
              AND f.remediation_status <> 'pending_remediation'
              AND br.status IN ('returned', 'returned_drop_box')
              AND DATE(IFNULL(br.drop_box_at, br.return_date)) <= DATE(br.due_date)
        `);

        // 1.2. Returned late -> mark overdue ledger row resolved (non-monetary, amount = 0)
        await db.execute(`
            UPDATE fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            SET f.status = 'paid',
                f.amount = 0,
                f.violation_type = 'overdue',
                f.remediation_status = 'resolved',
                f.paid_at = IFNULL(f.paid_at, IFNULL(br.drop_box_at, br.return_date)),
                f.resolved_at = IFNULL(f.resolved_at, IFNULL(br.drop_box_at, br.return_date)),
                f.reason = CONCAT('Đã hoàn trả sách (Trễ hạn ', GREATEST(1, DATEDIFF(DATE(IFNULL(br.drop_box_at, br.return_date)), DATE(br.due_date))), ' ngày • Hạn: ', DATE_FORMAT(br.due_date, '%e/%c/%Y'), ')')
            WHERE (f.violation_type = 'overdue' OR f.violation_type IS NULL)
              AND f.remediation_status <> 'pending_remediation'
              AND br.status IN ('returned', 'returned_drop_box')
              AND DATE(IFNULL(br.drop_box_at, br.return_date)) > DATE(br.due_date)
        `);

        // 1.3. Borrowing and still within due date -> remove any stale overdue ledger row
        await db.execute(`
            DELETE f FROM fines f
            JOIN borrow_records br ON f.borrow_record_id = br.id
            WHERE (f.violation_type = 'overdue' OR f.violation_type IS NULL)
              AND f.remediation_status <> 'pending_remediation'
              AND br.status = 'borrowing'
              AND DATE(br.due_date) >= CURDATE()
        `);

        // 2. Find currently active overdue borrow records
        let query = `
            SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            WHERE br.status = 'borrowing' AND DATE(br.due_date) < CURDATE()
        `;
        const params = [];
        if (userId) {
            query += ' AND br.user_id = ?';
            params.push(userId);
        }

        const [overdueRecords] = await db.execute(query, params);

        for (const record of overdueRecords) {
            const { overdueDays, dueDateFormatted } = calculateOverdue(record.due_date);

            if (overdueDays <= 0) {
                await db.execute(
                    "DELETE FROM fines WHERE borrow_record_id = ? AND (violation_type = 'overdue' OR violation_type IS NULL)",
                    [record.id]
                );
                continue;
            }

            const activeViolationReason = `Quá hạn ${overdueDays} ngày - Chưa hoàn trả sách (Hạn: ${dueDateFormatted})`;

            const [existingFine] = await db.execute(
                "SELECT id, status, amount, reason, remediation_status FROM fines WHERE borrow_record_id = ? AND (violation_type = 'overdue' OR violation_type IS NULL)",
                [record.id]
            );

            if (existingFine.length > 0) {
                if (
                    existingFine[0].status !== 'unpaid' ||
                    Number(existingFine[0].amount) !== 0 ||
                    existingFine[0].remediation_status !== 'active_overdue' ||
                    existingFine[0].reason !== activeViolationReason
                ) {
                    await db.execute(
                        "UPDATE fines SET status = 'unpaid', amount = 0, violation_type = 'overdue', remediation_status = 'active_overdue', reason = ?, paid_at = NULL WHERE id = ?",
                        [activeViolationReason, existingFine[0].id]
                    );
                }
            } else {
                await db.execute(
                    "INSERT INTO fines (borrow_record_id, user_id, amount, reason, status, violation_type, severity, remediation_status) VALUES (?, ?, 0, ?, 'unpaid', 'overdue', 'none', 'active_overdue')",
                    [record.id, record.u_id, activeViolationReason]
                );
            }
        }
    } catch (err) {
        console.error('Error syncing overdue violations:', err);
    }
}

/**
 * Evaluate independent circulation restriction causes for a reader.
 * Status codes: OVERDUE, SUSPENDED, PENDING_REMEDIATION, ACCOUNT_LOCKED, ELIGIBLE.
 * Borrow rights are granted ONLY when zero restriction causes remain.
 */
async function getReaderCirculationStatus(userId, conn = db) {
    const [users] = await conn.execute(
        'SELECT id, full_name, email, role, card_number, status, suspended_until FROM users WHERE id = ?',
        [userId]
    );
    if (users.length === 0) {
        return null;
    }

    const user = users[0];
    const configs = await getDisciplineConfigs(conn);

    const [overdueRows] = await conn.execute(
        `SELECT br.id as borrow_record_id, br.due_date, b.title, bc.qr_code,
                GREATEST(1, DATEDIFF(CURDATE(), DATE(br.due_date))) as overdue_days
         FROM borrow_records br
         JOIN book_copies bc ON br.book_copy_id = bc.id
         JOIN books b ON bc.book_id = b.id
         WHERE br.user_id = ? AND br.status = 'borrowing' AND DATE(br.due_date) < CURDATE()
         ORDER BY br.due_date ASC`,
        [userId]
    );

    const [remediationRows] = await conn.execute(
        `SELECT f.id, f.borrow_record_id, f.violation_type, f.severity, f.remediation_status,
                f.remediation_action, f.reason, f.created_at, b.title, bc.qr_code
         FROM fines f
         LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
         LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
         LEFT JOIN books b ON bc.book_id = b.id
         WHERE f.user_id = ?
           AND (f.remediation_status = 'pending_remediation' OR (f.violation_type IN ('damaged', 'lost') AND f.status = 'unpaid'))
         ORDER BY f.created_at DESC`,
        [userId]
    );

    const [activeBorrowCountRows] = await conn.execute(
        "SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ? AND status = 'borrowing'",
        [userId]
    );
    const activeBorrowCount = Number(activeBorrowCountRows[0]?.count || 0);

    const accountLocked = user.status !== 'active';
    const overdueCount = overdueRows.length;
    const isOverdue = overdueCount > 0;

    const suspendedUntilDate = user.suspended_until ? new Date(user.suspended_until) : null;
    const isSuspended = Boolean(suspendedUntilDate && suspendedUntilDate.getTime() > Date.now());
    const suspensionRemainingDays = isSuspended
        ? Math.max(1, Math.ceil((suspendedUntilDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;
    const suspendedUntilFormatted = isSuspended
        ? suspendedUntilDate.toLocaleDateString('vi-VN')
        : null;

    const pendingRemediationCount = remediationRows.length;
    const isPendingRemediation = pendingRemediationCount > 0;

    const restrictions = [];
    if (accountLocked) restrictions.push('ACCOUNT_LOCKED');
    if (isOverdue) restrictions.push('OVERDUE');
    if (isSuspended) restrictions.push('SUSPENDED');
    if (isPendingRemediation) restrictions.push('PENDING_REMEDIATION');

    const primaryStatus = accountLocked
        ? 'ACCOUNT_LOCKED'
        : isOverdue
            ? 'OVERDUE'
            : isPendingRemediation
                ? 'PENDING_REMEDIATION'
                : isSuspended
                    ? 'SUSPENDED'
                    : 'ELIGIBLE';

    const eligibleToBorrow = restrictions.length === 0;
    const eligibleToReserve =
        !accountLocked &&
        !isOverdue &&
        !isPendingRemediation &&
        (!isSuspended || !configs.blockReserveWhenSuspended);

    const reasonsList = [];
    if (accountLocked) reasonsList.push('Thẻ độc giả đang bị khóa quản trị hoặc chưa kích hoạt');
    if (isOverdue) reasonsList.push(`Đang giữ ${overdueCount} cuốn sách quá hạn chưa trả`);
    if (isSuspended) {
        reasonsList.push(`Đang bị tạm ngưng quyền mượn đến hết ${suspendedUntilFormatted} (còn ${suspensionRemainingDays} ngày)`);
    }
    if (isPendingRemediation) {
        reasonsList.push(`Có ${pendingRemediationCount} biên bản sách hư hỏng/mất đang chờ khắc phục và thủ thư xác nhận`);
    }

    const reserveReasonsList = [];
    if (accountLocked) reserveReasonsList.push('Thẻ độc giả đang bị khóa quản trị hoặc chưa kích hoạt');
    if (isOverdue) reserveReasonsList.push(`Đang giữ ${overdueCount} cuốn sách quá hạn chưa trả`);
    if (isPendingRemediation) reserveReasonsList.push(`Có ${pendingRemediationCount} sách hư hỏng/mất đang chờ khắc phục`);
    if (isSuspended && configs.blockReserveWhenSuspended) {
        reserveReasonsList.push(`Đang trong thời gian tạm ngưng mượn đến ${suspendedUntilFormatted}`);
    }

    return {
        user,
        configs,
        activeBorrowCount,
        primaryStatus,
        restrictions,
        accountLocked,
        isOverdue,
        overdueCount,
        overdueBooks: overdueRows,
        isSuspended,
        suspendedUntil: isSuspended ? suspendedUntilDate.toISOString() : null,
        suspendedUntilFormatted,
        suspensionRemainingDays,
        isPendingRemediation,
        pendingRemediationCount,
        pendingRemediations: remediationRows,
        eligibleToBorrow,
        eligibleToReserve,
        blockReason: reasonsList.length > 0 ? reasonsList.join('; ') : null,
        reserveBlockReason: reserveReasonsList.length > 0 ? reserveReasonsList.join('; ') : null
    };
}

module.exports = {
    syncOverdueFines,
    calculateOverdue,
    getDisciplineConfigs,
    applyLateReturnSuspension,
    getReaderCirculationStatus
};
