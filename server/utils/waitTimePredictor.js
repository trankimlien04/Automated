/**
 * Dự Báo Ngày Có Sách Khi Xếp Hàng Đặt Trước (Smart Wait-Time Predictor)
 * Tính toán dựa trên:
 * 1. Số bản sao thực tế đang sẵn sàng trên kệ (availableCopies)
 * 2. Danh sách hạn trả (due_date) của các bản sao đang được mượn (borrow_records.status = 'borrowing')
 *    hoặc hạn giữ chỗ của các bản sao đang giữ 24h/48h (drafts / notified reservations)
 * 3. Số lượng người đang xếp hàng đặt trước (reservations.status IN ('waiting', 'pending'))
 * 4. Vị trí xếp hàng của độc giả (queuePosition = 1, 2, 3...)
 */

const LOAN_CYCLE_DAYS = 14;

function formatVnDate(dateObj) {
    const d = new Date(dateObj);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

function startOfDay(dateInput) {
    const d = new Date(dateInput);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(dateInput, days) {
    const d = startOfDay(dateInput);
    d.setDate(d.getDate() + days);
    return d;
}

/**
 * Tính toán dự báo thời gian chờ cho 1 đầu sách tại vị trí hàng đợi `targetQueuePosition`
 */
function computeSmartWaitPrediction({
    bookId,
    totalCopies = 1,
    availableCopies = 0,
    activeDueDates = [],
    holdExpiryDates = [],
    waitingCount = 0,
    targetQueuePosition = null
}) {
    const today = startOfDay(new Date());
    const avail = Math.max(0, Number(availableCopies) || 0);
    const queuePos = targetQueuePosition != null ? Math.max(1, targetQueuePosition) : (waitingCount + 1);
    const waitingAheadCount = Math.max(0, queuePos - 1);

    // Nếu trên kệ ĐANG CÓ SẴN bản sao đủ cho vị trí xếp hàng này -> Báo có sách ngay hôm nay!
    if (avail >= queuePos) {
        const todayVn = formatVnDate(today);
        return {
            is_available_now: true,
            estimated_wait_days: 0,
            expected_available_date: today.toISOString().slice(0, 10),
            expected_date_vn: todayVn,
            earliest_due_date: today.toISOString().slice(0, 10),
            earliest_due_date_vn: todayVn,
            waiting_ahead_count: waitingAheadCount,
            queue_position: queuePos,
            active_borrowed_count: activeDueDates.length,
            summary_text: `Sách hiện đã có sẵn bản sao trên kệ (${avail}/${totalCopies} cuốn) • Bạn có thể nhận hoặc mượn ngay hôm nay (${todayVn})!`
        };
    }

    // Số vị trí cần chờ bản sao quay về (sau khi trừ đi số bản đang rảnh trên kệ nếu có)
    const effectiveQueueNeed = Math.max(1, queuePos - avail);

    // Chuẩn hóa danh sách ngày dự kiến trả của các bản sao đang mượn + các bản đang giữ chỗ 24h/48h
    const allIncomingDates = [
        ...activeDueDates.filter(Boolean).map((rawDate) => {
            const d = startOfDay(rawDate);
            // Nếu bản sao đang mượn bị quá hạn (due_date < today), dự kiến thu hồi trong 1 ngày tới
            return d < today ? addDays(today, 1) : d;
        }),
        ...holdExpiryDates.filter(Boolean).map((rawExp) => {
            const d = startOfDay(rawExp);
            return d <= today ? addDays(today, 1) : d;
        })
    ].sort((a, b) => a.getTime() - b.getTime());

    // Nếu sách báo available_copies = 0 trên danh mục nhưng không có bản ghi mượn/giữ chỗ nào trong DB
    if (allIncomingDates.length === 0) {
        const fallbackDays = ((Number(bookId) || 1) % 3) + 2;
        const copiesCount = Math.max(1, Number(totalCopies) || 1);
        for (let i = 0; i < copiesCount; i++) {
            allIncomingDates.push(addDays(today, fallbackDays + i * 2));
        }
    }

    const poolSize = allIncomingDates.length;
    const earliestReturnDate = allIncomingDates[0];

    const waveIndex = Math.floor((effectiveQueueNeed - 1) / poolSize);
    const slotInWave = (effectiveQueueNeed - 1) % poolSize;
    const baseReturnDate = allIncomingDates[slotInWave];
    const expectedAvailableDate = addDays(baseReturnDate, waveIndex * LOAN_CYCLE_DAYS);

    const diffMs = expectedAvailableDate.getTime() - today.getTime();
    const estimatedWaitDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    const earliestDueDateVn = formatVnDate(earliestReturnDate);
    const expectedDateVn = formatVnDate(expectedAvailableDate);

    const summaryText = `Dự kiến có sách sau ~${estimatedWaitDays} ngày nữa (Bản sao sớm nhất sẽ hoàn trả vào ${earliestDueDateVn} • Bạn đứng thứ #${queuePos} trong hàng chờ)`;

    return {
        is_available_now: false,
        estimated_wait_days: estimatedWaitDays,
        expected_available_date: expectedAvailableDate.toISOString().slice(0, 10),
        expected_date_vn: expectedDateVn,
        earliest_due_date: earliestReturnDate.toISOString().slice(0, 10),
        earliest_due_date_vn: earliestDueDateVn,
        waiting_ahead_count: waitingAheadCount,
        queue_position: queuePos,
        active_borrowed_count: activeDueDates.length,
        summary_text: summaryText
    };
}

module.exports = {
    computeSmartWaitPrediction,
    formatVnDate
};
