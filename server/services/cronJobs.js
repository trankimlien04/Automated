const cron = require('node-cron');
const db = require('../config/db');
const { syncOverdueFines, calculateOverdue } = require('./fineSyncService');
const { LIBRARY_TIMEZONE, toLocalDateString } = require('../utils/dateUtils');
const { runDueDateRemindersSweep } = require('./dueReminderService');
const { getSmtpStatus } = require('./emailService');

let morningCronTask = null;
let isMorningSweepRunning = false;

function getLocalHour(date = new Date()) {
    const raw = new Intl.DateTimeFormat('en-US', {
        timeZone: LIBRARY_TIMEZONE,
        hour12: false,
        hour: 'numeric',
    }).format(date);
    return parseInt(raw, 10) % 24;
}

async function saveMorningCronState({ runDate, status, summary }) {
    try {
        await db.execute(
            `INSERT INTO cron_job_states (job_name, last_run_date, last_run_at, last_status, last_summary)
             VALUES ('morning_reminders', ?, NOW(), ?, ?)
             ON DUPLICATE KEY UPDATE
               last_run_date = VALUES(last_run_date),
               last_run_at = VALUES(last_run_at),
               last_status = VALUES(last_status),
               last_summary = VALUES(last_summary)`,
            [runDate, status, summary]
        );
    } catch {
        // Bỏ qua nếu đang chạy môi trường mock test
    }
}

async function executeMorningRemindersJob(triggerReason = 'cron_0800') {
    if (isMorningSweepRunning) return null;
    isMorningSweepRunning = true;
    const todayStr = toLocalDateString(new Date());

    try {
        const stats = await runDueDateRemindersSweep({
            source: 'cron',
            deduplicateToday: true,
            includeAllOverdue: false,
            cardExpiryWindowDays: 7,
        });

        const summary = `${stats.inAppCount} In-app, ${stats.realEmailCount} email thực tế (${stats.simulatedEmailCount} mô phỏng, ${stats.failedEmailCount} lỗi) • T-2: ${stats.dueSoonCount}, T-0: ${stats.dueTodayCount}, Quá hạn: ${stats.overdueMatchedCount} [${triggerReason}]`;
        await saveMorningCronState({ runDate: todayStr, status: 'success', summary });

        if (stats.inAppCount > 0 || stats.realEmailCount > 0) {
            const { notifyAllStaff } = require('./notificationService');
            await notifyAllStaff(
                'Báo cáo Cron 08:00: Nhắc hạn mượn sách tự động',
                `Hệ thống tự động quét lúc ${triggerReason === 'cron_0800' ? '08:00' : 'sau 08:00 (chạy bù)'}: Đã phát hành ${stats.inAppCount} thông báo In-app và ${stats.realEmailCount} email thực tế.`,
                'info'
            );
        }

        console.log(`✅ [CRON JOB 08:00 - ${triggerReason}] ${summary}`);
        return stats;
    } catch (error) {
        console.error(`❌ [CRON ERROR - ${triggerReason}] Error in morning reminders:`, error);
        await saveMorningCronState({
            runDate: todayStr,
            status: 'failed',
            summary: String(error?.message || 'Lỗi chạy Cron nhắc hạn').slice(0, 500),
        });
        return null;
    } finally {
        isMorningSweepRunning = false;
    }
}

async function runCatchUpIfMissedMorningCron() {
    if (getLocalHour() < 8) return;
    const todayStr = toLocalDateString(new Date());
    try {
        const [rows] = await db.execute(
            `SELECT DATE_FORMAT(last_run_date, '%Y-%m-%d') as last_run_date_str
             FROM cron_job_states
             WHERE job_name = 'morning_reminders'
             LIMIT 1`
        );
        const lastDate = rows?.[0]?.last_run_date_str || '';
        if (lastDate !== todayStr) {
            console.log(`🔄 [CRON CATCH-UP] Chưa ghi nhận lượt quét tự động ngày ${todayStr} (>= 08:00), tiến hành chạy bù tự động...`);
            await executeMorningRemindersJob('catchup_after_0800');
        }
    } catch {
        // Bỏ qua nếu bảng chưa sẵn sàng
    }
}

async function getCronRuntimeInfo() {
    let state = null;
    try {
        const [rows] = await db.execute(
            `SELECT DATE_FORMAT(last_run_date, '%Y-%m-%d') as last_run_date_str, last_run_at, last_status, last_summary
             FROM cron_job_states
             WHERE job_name = 'morning_reminders'
             LIMIT 1`
        );
        state = rows?.[0] || null;
    } catch {
        state = null;
    }

    return {
        active: Boolean(morningCronTask),
        schedule: '08:00 hằng ngày',
        cronExpression: '0 8 * * *',
        timezone: LIBRARY_TIMEZONE,
        catchUpEnabled: true,
        nextRunAt: morningCronTask && typeof morningCronTask.getNextRun === 'function'
            ? morningCronTask.getNextRun()
            : null,
        lastRunDate: state?.last_run_date_str || null,
        lastRunAt: state?.last_run_at || null,
        lastStatus: state?.last_status || null,
        lastSummary: state?.last_summary || null,
    };
}

function initCronJobs() {
    console.log(`⏰ Initializing automated cron jobs (timezone: ${LIBRARY_TIMEZONE})...`);
    getSmtpStatus()
        .then((smtp) => {
            if (smtp.configured) {
                console.log(`📧 Email transport READY [SMTP REAL via ${smtp.source}]: ${smtp.host}:${smtp.port} (${smtp.userMasked})`);
            } else {
                console.warn('⚠️ Email transport not configured yet (running in Simulated mode until configured in .env or UI)');
            }
        })
        .catch(() => {});

    // Immediately run overdue fine sync on startup
    syncOverdueFines().catch(err => console.error('Initial fine sync error:', err));

    // Chạy bù 1 lần nếu server bật hoặc tỉnh lại sau 08:00 sáng mà hôm nay chưa quét
    const startupCatchUpTimer = setTimeout(() => {
        runCatchUpIfMissedMorningCron().catch(() => {});
    }, 5000);
    if (typeof startupCatchUpTimer.unref === 'function') {
        startupCatchUpTimer.unref();
    }

    // Run every day at 00:00 AM (local timezone) to sync overdue discipline records and notify staff
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 [CRON JOB] Running daily midnight discipline sync...');
        try {
            // 1. Sync all overdue violations using normalized calendar calculation
            await syncOverdueFines();

            // 2. Find unreturned overdue records to alert readers and staff
            const [overdueRecords] = await db.execute(`
                SELECT br.*, u.id as u_id, u.full_name, u.status as user_status, b.title
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.status = 'borrowing' AND DATE(br.due_date) < CURDATE()
            `);

            for (const record of overdueRecords) {
                const { overdueDays } = calculateOverdue(record.due_date);

                // Case 1 (OVERDUE) blocks borrow & reserve automatically via getReaderCirculationStatus without changing account status
                if (overdueDays > 0 && overdueDays % 3 === 1) {
                    await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")', [
                        record.u_id,
                        'Nhắc trả sách quá hạn — Quyền mượn tạm khóa',
                        `Sách "${record.title}" đã quá hạn ${overdueDays} ngày. Quyền mượn & đặt trước sách hiện đang tạm khóa cho đến khi bạn hoàn trả đầy đủ sách quá hạn.`
                    ]);
                }
            }

            if (overdueRecords.length > 0) {
                const { notifyAllStaff } = require('./notificationService');
                await notifyAllStaff(
                    'Báo cáo tự động: Sách mượn quá hạn',
                    `Hệ thống ghi nhận ${overdueRecords.length} lượt mượn đang quá hạn chưa trả cần theo dõi đôn đốc thu hồi tài liệu.`,
                    'warning'
                );
            }

            console.log(`✅ [CRON JOB] Processed ${overdueRecords.length} overdue borrow records.`);
        } catch (error) {
            console.error('❌ [CRON ERROR] Error in midnight maintenance:', error);
        }
    }, { timezone: LIBRARY_TIMEZONE });

    // Run every day at 08:00 AM (local timezone) to send reminders (T-2, T-0, milestone overdue + expiring cards)
    morningCronTask = cron.schedule('0 8 * * *', async () => {
        console.log(`📢 [CRON JOB 08:00 ${LIBRARY_TIMEZONE}] Running morning multi-channel reminders (In-app + Email)...`);
        await executeMorningRemindersJob('cron_0800');
    }, { timezone: LIBRARY_TIMEZONE });

    // Run every 15 minutes to release expired online borrow requests (24h hold), reservations (48h hold), and catch up missed 08:00 sleep/wake cycles
    cron.schedule('*/15 * * * *', async () => {
        runCatchUpIfMissedMorningCron().catch(() => {});
        try {
            // 1. Release expired borrow requests (24h hold)
            const [expiredBorrows] = await db.execute(`
                SELECT brq.id, brq.user_id, brq.book_id, b.title as book_title
                FROM borrow_requests brq
                JOIN books b ON brq.book_id = b.id
                WHERE brq.status = 'pending' AND brq.expires_at IS NOT NULL AND brq.expires_at < NOW()
            `);
            for (const item of expiredBorrows) {
                await db.execute('UPDATE borrow_requests SET status = "expired" WHERE id = ?', [item.id]);
                await db.execute('UPDATE books SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?', [item.book_id]);
                await db.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                    [
                        item.user_id,
                        'Hết hạn giữ chỗ mượn sách online',
                        `Thời hạn giữ chỗ 24 giờ cho cuốn sách "${item.book_title}" đã hết. Bản sao sách đã được đưa trở lại kho thư viện cho các bạn đọc khác.`
                    ]
                );
            }

            // 2. Release expired reservations (48h hold with no response)
            const [expiredResvs] = await db.execute(`
                SELECT r.id, r.user_id, r.book_id, b.title as book_title
                FROM reservations r
                JOIN books b ON r.book_id = b.id
                WHERE r.status = 'notified' AND r.expires_at IS NOT NULL AND r.expires_at < NOW()
            `);
            for (const resv of expiredResvs) {
                const [nextWaiters] = await db.execute(
                    'SELECT r.id, r.user_id, u.full_name FROM reservations r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? AND r.status IN ("waiting", "pending") ORDER BY r.reservation_date ASC LIMIT 1',
                    [resv.book_id]
                );
                await db.execute('UPDATE reservations SET status = "expired" WHERE id = ?', [resv.id]);

                if (nextWaiters.length > 0) {
                    const nextUser = nextWaiters[0];
                    await db.execute(
                        'UPDATE reservations SET status = "notified", notified_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?',
                        [nextUser.id]
                    );
                    const { dispatchReservationReadyNotification } = require('./notificationService');
                    await dispatchReservationReadyNotification({
                        userId: nextUser.user_id,
                        reservationId: nextUser.id,
                        bookTitle: resv.book_title,
                        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
                    });
                } else {
                    await db.execute('UPDATE books SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?', [resv.book_id]);
                }
            }

            // 3. Release expired borrow drafts (24h hold)
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
                    await db.execute('UPDATE books SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?', [it.book_id]);
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
        } catch (e) {
            console.error('Lỗi khi quét dọn yêu cầu và đặt trước hết hạn:', e);
        }
    }, { timezone: LIBRARY_TIMEZONE });
}

initCronJobs.getCronRuntimeInfo = getCronRuntimeInfo;

module.exports = initCronJobs;
