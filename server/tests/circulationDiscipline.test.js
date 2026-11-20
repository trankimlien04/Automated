const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Prevent fineSyncService from opening a real MySQL connection during unit tests
const dbModulePath = require.resolve('../config/db');
require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
        execute: async () => [[], []],
    },
};

const {
    calculateOverdue,
    getDisciplineConfigs,
    applyLateReturnSuspension,
    getReaderCirculationStatus,
} = require(path.resolve(__dirname, '../services/fineSyncService'));

test('calculateOverdue normalizes midnight boundaries and avoids negative counts', () => {
    const due = new Date('2026-10-10T23:59:00');
    const sameDayEarly = new Date('2026-10-10T01:00:00');
    const fiveDaysLater = new Date('2026-10-15T08:30:00');

    assert.equal(calculateOverdue(due, sameDayEarly).overdueDays, 0);
    assert.equal(calculateOverdue(due, fiveDaysLater).overdueDays, 5);
});

test('getDisciplineConfigs parses regulation rows and boolean flags with safe defaults', async () => {
    const mockConn = {
        execute: async () => [
            [
                { key_name: 'max_books_per_user', value: '7' },
                { key_name: 'max_borrow_days', value: '21' },
                { key_name: 'grace_days', value: '2' },
                { key_name: 'suspension_days_per_late_day', value: '2' },
                { key_name: 'max_suspension_days', value: '10' },
                { key_name: 'block_reserve_when_suspended', value: '0' },
            ],
        ],
    };

    const cfg = await getDisciplineConfigs(mockConn);
    assert.deepEqual(cfg, {
        maxBooksPerUser: 7,
        maxBorrowDays: 21,
        graceDays: 2,
        suspensionDaysPerLateDay: 2,
        maxSuspensionDays: 10,
        blockReserveWhenSuspended: false,
    });
});

test('applyLateReturnSuspension skips suspension within grace days and caps penalty at maxSuspensionDays', async () => {
    const configRows = [
        { key_name: 'grace_days', value: '2' },
        { key_name: 'suspension_days_per_late_day', value: '3' },
        { key_name: 'max_suspension_days', value: '10' },
    ];

    const callsDuringGrace = [];
    const graceConn = {
        execute: async (sql, params) => {
            callsDuringGrace.push({ sql, params });
            return [configRows];
        },
    };
    const withinGrace = await applyLateReturnSuspension(
        graceConn,
        42,
        new Date('2026-10-10T00:00:00'),
        new Date('2026-10-12T00:00:00')
    );
    assert.equal(withinGrace.overdueDays, 2);
    assert.equal(withinGrace.effectiveLateDays, 0);
    assert.equal(withinGrace.suspendedDaysAdded, 0);
    assert.equal(callsDuringGrace.length, 1);

    const queries = [];
    const lateConn = {
        execute: async (sql, params) => {
            queries.push({ sql, params });
            if (sql.includes('FROM system_configs')) return [configRows];
            if (sql.includes('UPDATE users')) return [{ affectedRows: 1 }];
            if (sql.includes('SELECT suspended_until')) {
                return [[{ suspended_until: '2026-10-30T00:00:00.000Z' }]];
            }
            return [[]];
        },
    };
    // 8 days overdue - 2 grace days = 6 effective days; 6 * 3 = 18 days -> capped at 10 days
    const penalized = await applyLateReturnSuspension(
        lateConn,
        42,
        new Date('2026-10-10T00:00:00'),
        new Date('2026-10-18T00:00:00')
    );
    assert.equal(penalized.overdueDays, 8);
    assert.equal(penalized.effectiveLateDays, 6);
    assert.equal(penalized.suspendedDaysAdded, 10);
    assert.equal(penalized.suspendedUntil, '2026-10-30T00:00:00.000Z');
    assert.deepEqual(queries[1].params, [10, 10, 42]);
});

test('getReaderCirculationStatus isolates independent lock causes and only unlocks when zero causes remain', async () => {
    const futureSuspension = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    function createStatusConn({
        userStatus = 'active',
        suspendedUntil = null,
        overdueRows = [],
        remediationRows = [],
        blockReserve = '1',
    }) {
        return {
            execute: async (sql) => {
                if (sql.includes('FROM users WHERE id')) {
                    return [
                        [
                            {
                                id: 3,
                                full_name: 'Độc Giả Test',
                                email: 'reader@library.com',
                                role: 'reader',
                                card_number: 'LIB-RD-000003',
                                status: userStatus,
                                suspended_until: suspendedUntil,
                            },
                        ],
                    ];
                }
                if (sql.includes('FROM system_configs')) {
                    return [[{ key_name: 'block_reserve_when_suspended', value: blockReserve }]];
                }
                if (sql.includes("br.status = 'borrowing' AND DATE(br.due_date)")) {
                    return [overdueRows];
                }
                if (sql.includes('FROM fines f')) {
                    return [remediationRows];
                }
                if (sql.includes('COUNT(*) as count FROM borrow_records')) {
                    return [[{ count: overdueRows.length }]];
                }
                return [[]];
            },
        };
    }

    // All three discipline causes stacked simultaneously
    const stacked = await getReaderCirculationStatus(
        3,
        createStatusConn({
            suspendedUntil: futureSuspension,
            overdueRows: [{ borrow_record_id: 1, title: 'Mắt Biếc', overdue_days: 4 }],
            remediationRows: [{ id: 9, violation_type: 'damaged', remediation_status: 'pending_remediation' }],
        })
    );
    assert.equal(stacked.eligibleToBorrow, false);
    assert.equal(stacked.eligibleToReserve, false);
    assert.equal(stacked.primaryStatus, 'OVERDUE');
    assert.deepEqual(stacked.restrictions, ['OVERDUE', 'SUSPENDED', 'PENDING_REMEDIATION']);

    // Overdue resolved, but suspension + pending remediation remain -> STILL locked
    const partial = await getReaderCirculationStatus(
        3,
        createStatusConn({
            suspendedUntil: futureSuspension,
            overdueRows: [],
            remediationRows: [{ id: 9, violation_type: 'damaged', remediation_status: 'pending_remediation' }],
        })
    );
    assert.equal(partial.eligibleToBorrow, false);
    assert.equal(partial.primaryStatus, 'PENDING_REMEDIATION');
    assert.deepEqual(partial.restrictions, ['SUSPENDED', 'PENDING_REMEDIATION']);

    // Only suspended with block_reserve_when_suspended = 0 -> borrow blocked, reserve allowed
    const suspendedReserveAllowed = await getReaderCirculationStatus(
        3,
        createStatusConn({
            suspendedUntil: futureSuspension,
            blockReserve: '0',
        })
    );
    assert.equal(suspendedReserveAllowed.eligibleToBorrow, false);
    assert.equal(suspendedReserveAllowed.eligibleToReserve, true);
    assert.equal(suspendedReserveAllowed.primaryStatus, 'SUSPENDED');

    // All restrictions cleared -> ELIGIBLE
    const clean = await getReaderCirculationStatus(3, createStatusConn({}));
    assert.equal(clean.eligibleToBorrow, true);
    assert.equal(clean.eligibleToReserve, true);
    assert.equal(clean.primaryStatus, 'ELIGIBLE');
    assert.deepEqual(clean.restrictions, []);
});

