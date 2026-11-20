const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSmartWaitPrediction } = require('../utils/waitTimePredictor');

function localDateOffset(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
}

test('computeSmartWaitPrediction returns immediate availability when shelf stock covers queue position', () => {
    const result = computeSmartWaitPrediction({
        bookId: 1,
        totalCopies: 3,
        availableCopies: 2,
        waitingCount: 1,
        targetQueuePosition: 2,
    });

    assert.equal(result.is_available_now, true);
    assert.equal(result.estimated_wait_days, 0);
    assert.equal(result.queue_position, 2);
    assert.equal(result.waiting_ahead_count, 1);
});

test('computeSmartWaitPrediction predicts return wait days and second-wave rollover accurately', () => {
    const dueIn5Days = localDateOffset(5);

    const firstInQueue = computeSmartWaitPrediction({
        bookId: 4,
        totalCopies: 1,
        availableCopies: 0,
        activeDueDates: [dueIn5Days],
        targetQueuePosition: 1,
    });
    assert.equal(firstInQueue.is_available_now, false);
    assert.equal(firstInQueue.estimated_wait_days, 5);

    // 2nd person in queue with only 1 total copy must wait an extra 14-day loan cycle
    const secondInQueue = computeSmartWaitPrediction({
        bookId: 4,
        totalCopies: 1,
        availableCopies: 0,
        activeDueDates: [dueIn5Days],
        targetQueuePosition: 2,
    });
    assert.equal(secondInQueue.is_available_now, false);
    assert.equal(secondInQueue.estimated_wait_days, 19);
});

test('computeSmartWaitPrediction normalizes past overdue due_date to 1 day recovery estimate', () => {
    const overdueDate = localDateOffset(-4);

    const result = computeSmartWaitPrediction({
        bookId: 9,
        totalCopies: 1,
        availableCopies: 0,
        activeDueDates: [overdueDate],
        targetQueuePosition: 1,
    });

    assert.equal(result.is_available_now, false);
    assert.equal(result.estimated_wait_days, 1);
});

test('computeSmartWaitPrediction produces positive fallback prediction when no active due dates exist', () => {
    const result = computeSmartWaitPrediction({
        bookId: 7,
        totalCopies: 2,
        availableCopies: 0,
        activeDueDates: [],
        holdExpiryDates: [],
    });

    assert.equal(result.is_available_now, false);
    assert.ok(result.estimated_wait_days >= 1);
});

