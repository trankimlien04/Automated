const db = require('../config/db');

exports.getDashboardStats = async (req, res) => {
    try {
        // 1. Total books
        const [books] = await db.execute('SELECT COUNT(*) as count FROM books');
        
        // 2. Total copies
        const [copies] = await db.execute('SELECT COUNT(*) as count FROM book_copies');

        // 3. Active readers (status = active and role = reader)
        const [readers] = await db.execute('SELECT COUNT(*) as count FROM users WHERE role = "reader" AND status = "active"');

        // 4. Currently borrowing
        const [borrowing] = await db.execute('SELECT COUNT(*) as count FROM borrow_records WHERE status = "borrowing"');

        // 5. Active reservations
        const [reservations] = await db.execute('SELECT COUNT(*) as count FROM reservations WHERE status = "pending" OR status = "ready"');

        // 6. Overdue copies
        const [overdue] = await db.execute('SELECT COUNT(*) as count FROM borrow_records WHERE status = "borrowing" AND due_date < CURDATE()');

        // 7. Total unpaid fines amount
        const [fines] = await db.execute('SELECT SUM(amount) as sum FROM fines WHERE status = "unpaid"');

        const [popular] = await db.execute(`
            SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrow_count
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            GROUP BY b.id, b.title, a.name
            ORDER BY borrow_count DESC
            LIMIT 5
        `);

        // 9. Borrowing trends by month (Last 6 months)
        const [trends] = await db.execute(`
            SELECT DATE_FORMAT(borrow_date, '%m/%Y') as month, COUNT(*) as count
            FROM borrow_records
            WHERE borrow_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY month
            ORDER BY MIN(borrow_date) ASC
        `);

        // 10. Recent transactions (Last 10)
        const [recent] = await db.execute(`
            SELECT br.id, br.borrow_date, br.status,
                   u.full_name as reader_name,
                   b.title as book_title
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            ORDER BY br.borrow_date DESC
            LIMIT 10
        `);

        // 8. Unpaid fines list with debtor details
        const [unpaidFinesList] = await db.execute(`
            SELECT f.id, f.amount, f.reason, f.created_at,
                   u.id as user_id, u.full_name as reader_name, u.card_number,
                   b.title as book_title
            FROM fines f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
            WHERE f.status = 'unpaid'
            ORDER BY f.created_at DESC
            LIMIT 6
        `);

        res.status(200).json({
            stats: {
                totalBooks: Number(books[0].count) || 0,
                totalCopies: Number(copies[0].count) || 0,
                activeReaders: Number(readers[0].count) || 0,
                currentlyBorrowing: Number(borrowing[0].count) || 0,
                activeReservations: Number(reservations[0].count) || 0,
                overdueCount: Number(overdue[0].count) || 0,
                unpaidFinesSum: Number(fines[0].sum) || 0
            },
            popularBooks: popular,
            borrowTrends: trends,
            recentTransactions: recent,
            unpaidFinesList: unpaidFinesList.map(f => ({
                ...f,
                amount: Number(f.amount) || 0
            }))
        });
    } catch (error) {
        console.error('Lỗi khi lấy thống kê Dashboard:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê' });
    }
};

exports.getAnalytics = async (req, res) => {
    try {
        const period = req.query.period || 'month';
        
        // 1. Calculate time filter condition
        let borrowDateFilter = '';
        let returnDateFilter = '';
        let fineDateFilter = '';
        let trendQuery = '';

        if (period === 'day') {
            // Today - group by hour (00:00 to 23:00)
            borrowDateFilter = 'DATE(br.borrow_date) = CURDATE()';
            returnDateFilter = 'DATE(br.return_date) = CURDATE()';
            fineDateFilter = 'DATE(f.created_at) = CURDATE()';

            trendQuery = `
                SELECT 
                    CONCAT(LPAD(h.hour, 2, '0'), ':00') as label,
                    COUNT(DISTINCT CASE WHEN HOUR(br.borrow_date) = h.hour AND DATE(br.borrow_date) = CURDATE() THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN HOUR(br.return_date) = h.hour AND DATE(br.return_date) = CURDATE() THEN br.id END) as \`return\`
                FROM (
                    SELECT 0 as hour UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION 
                    SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION 
                    SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION 
                    SELECT 18 UNION SELECT 19 UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23
                ) h
                LEFT JOIN borrow_records br ON (
                    (HOUR(br.borrow_date) = h.hour AND DATE(br.borrow_date) = CURDATE()) OR 
                    (HOUR(br.return_date) = h.hour AND DATE(br.return_date) = CURDATE())
                )
                GROUP BY h.hour, label
                ORDER BY h.hour ASC
            `;
        } else if (period === 'week') {
            // Last 7 days - group by date (DD/MM)
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';

            trendQuery = `
                SELECT 
                    DATE_FORMAT(d.date, '%d/%m') as label,
                    COUNT(DISTINCT CASE WHEN DATE(br.borrow_date) = d.date THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN DATE(br.return_date) = d.date THEN br.id END) as \`return\`
                FROM (
                    SELECT CURDATE() - INTERVAL (a.a + (10 * b.a)) DAY as date
                    FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) as a
                    CROSS JOIN (SELECT 0 as a) as b
                ) d
                LEFT JOIN borrow_records br ON (
                    (DATE(br.borrow_date) = d.date) OR (DATE(br.return_date) = d.date)
                )
                WHERE d.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY d.date, label
                ORDER BY d.date ASC
            `;
        } else if (period === 'year') {
            // Last 12 months - group by MM/YYYY
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';

            trendQuery = `
                SELECT 
                    DATE_FORMAT(d.m_date, '%m/%Y') as label,
                    COUNT(DISTINCT CASE WHEN DATE_FORMAT(br.borrow_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN DATE_FORMAT(br.return_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') THEN br.id END) as \`return\`
                FROM (
                    SELECT DATE_SUB(CURDATE(), INTERVAL n MONTH) as m_date
                    FROM (
                        SELECT 11 as n UNION SELECT 10 UNION SELECT 9 UNION SELECT 8 UNION
                        SELECT 7 UNION SELECT 6 UNION SELECT 5 UNION SELECT 4 UNION
                        SELECT 3 UNION SELECT 2 UNION SELECT 1 UNION SELECT 0
                    ) num
                ) d
                LEFT JOIN borrow_records br ON (
                    DATE_FORMAT(br.borrow_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') OR
                    DATE_FORMAT(br.return_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m')
                )
                GROUP BY DATE_FORMAT(d.m_date, '%Y-%m'), label
                ORDER BY DATE_FORMAT(d.m_date, '%Y-%m') ASC
            `;
        } else {
            // Default: 'month' (Current month / last 4 weeks)
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';

            trendQuery = `
                SELECT 
                    CONCAT('Tuần ', week_num.w) as label,
                    COUNT(DISTINCT CASE WHEN FLOOR(DATEDIFF(CURDATE(), DATE(br.borrow_date))/7) = (4 - week_num.w) THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN FLOOR(DATEDIFF(CURDATE(), DATE(br.return_date))/7) = (4 - week_num.w) THEN br.id END) as \`return\`
                FROM (
                    SELECT 1 as w UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                ) week_num
                LEFT JOIN borrow_records br ON (
                    br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) OR 
                    br.return_date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
                )
                GROUP BY week_num.w, label
                ORDER BY week_num.w ASC
            `;
        }

        // Run queries in parallel
        const [trendRows] = await db.execute(trendQuery);

        // 2. On time return rate
        const [returnStats] = await db.execute(`
            SELECT 
                COUNT(*) as total_returned,
                SUM(CASE WHEN DATE(return_date) <= due_date THEN 1 ELSE 0 END) as on_time_count
            FROM borrow_records br
            WHERE br.return_date IS NOT NULL AND ${returnDateFilter}
        `);

        const totalReturned = Number(returnStats[0]?.total_returned) || 0;
        const onTimeCount = Number(returnStats[0]?.on_time_count) || 0;
        const onTimeRate = totalReturned > 0 ? Number(((onTimeCount / totalReturned) * 100).toFixed(1)) : 100;

        // 3. Top Books in period
        const [topBooks] = await db.execute(`
            SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrows
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            WHERE ${borrowDateFilter}
            GROUP BY b.id, b.title, a.name
            ORDER BY borrows DESC
            LIMIT 7
        `);

        // Fallback top books if none in period
        let finalTopBooks = topBooks;
        if (finalTopBooks.length === 0) {
            const [allTimeTop] = await db.execute(`
                SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrows
                FROM books b
                LEFT JOIN book_copies bc ON bc.book_id = b.id
                LEFT JOIN borrow_records br ON br.book_copy_id = bc.id
                LEFT JOIN authors a ON b.author_id = a.id
                GROUP BY b.id, b.title, a.name
                ORDER BY borrows DESC
                LIMIT 7
            `);
            finalTopBooks = allTimeTop;
        }

        // 4. Category share
        const [categoryShare] = await db.execute(`
            SELECT c.name, COUNT(bc.id) as value
            FROM categories c
            LEFT JOIN books b ON b.category_id = c.id
            LEFT JOIN book_copies bc ON bc.book_id = b.id
            GROUP BY c.id, c.name
            HAVING value > 0
            ORDER BY value DESC
            LIMIT 6
        `);

        // 5. Fine revenue over period
        let fineRevenueQuery = '';
        if (period === 'day') {
            fineRevenueQuery = `
                SELECT CONCAT(LPAD(h.hour, 2, '0'), ':00') as label, IFNULL(SUM(f.amount), 0) as v
                FROM (
                    SELECT 0 as hour UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION 
                    SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION 
                    SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION 
                    SELECT 18 UNION SELECT 19 UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23
                ) h
                LEFT JOIN fines f ON HOUR(f.created_at) = h.hour AND DATE(f.created_at) = CURDATE()
                GROUP BY h.hour, label
                ORDER BY h.hour ASC
            `;
        } else if (period === 'week') {
            fineRevenueQuery = `
                SELECT DATE_FORMAT(d.date, '%d/%m') as label, IFNULL(SUM(f.amount), 0) as v
                FROM (
                    SELECT CURDATE() - INTERVAL a.a DAY as date
                    FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) as a
                ) d
                LEFT JOIN fines f ON DATE(f.created_at) = d.date
                GROUP BY d.date, label
                ORDER BY d.date ASC
            `;
        } else if (period === 'year') {
            fineRevenueQuery = `
                SELECT DATE_FORMAT(d.m_date, '%m/%Y') as label, IFNULL(SUM(f.amount), 0) as v
                FROM (
                    SELECT DATE_SUB(CURDATE(), INTERVAL n MONTH) as m_date
                    FROM (SELECT 5 as n UNION SELECT 4 UNION SELECT 3 UNION SELECT 2 UNION SELECT 1 UNION SELECT 0) num
                ) d
                LEFT JOIN fines f ON DATE_FORMAT(f.created_at, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m')
                GROUP BY DATE_FORMAT(d.m_date, '%Y-%m'), label
                ORDER BY DATE_FORMAT(d.m_date, '%Y-%m') ASC
            `;
        } else {
            fineRevenueQuery = `
                SELECT CONCAT('Tuần ', w.n) as label, IFNULL(SUM(f.amount), 0) as v
                FROM (SELECT 1 as n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) w
                LEFT JOIN fines f ON FLOOR(DATEDIFF(CURDATE(), DATE(f.created_at))/7) = (4 - w.n) AND f.created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
                GROUP BY w.n, label
                ORDER BY w.n ASC
            `;
        }
        const [fineRevenue] = await db.execute(fineRevenueQuery);

        // 6. Summary metrics
        const [summaryBorrows] = await db.execute(`SELECT COUNT(*) as count FROM borrow_records br WHERE ${borrowDateFilter}`);
        const [summaryReturns] = await db.execute(`SELECT COUNT(*) as count FROM borrow_records br WHERE ${returnDateFilter} AND br.return_date IS NOT NULL`);
        const [summaryFines] = await db.execute(`SELECT IFNULL(SUM(amount), 0) as sum FROM fines f WHERE ${fineDateFilter}`);

        // 7. Detailed Transactions in period (with exact hour/minute/second)
        const [transactions] = await db.execute(`
            (
                SELECT 
                    br.id,
                    'borrow' as action_type,
                    br.borrow_date as action_time,
                    DATE_FORMAT(br.borrow_date, '%H:%i:%s') as exact_time,
                    DATE_FORMAT(br.borrow_date, '%d/%m/%Y %H:%i') as formatted_datetime,
                    u.id as user_id,
                    u.full_name as reader_name,
                    u.card_number,
                    b.title as book_title,
                    bc.qr_code as copy_code,
                    br.status,
                    br.due_date,
                    staff.full_name as staff_name
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                LEFT JOIN users staff ON br.processed_by = staff.id
                WHERE ${borrowDateFilter}
            )
            UNION ALL
            (
                SELECT 
                    br.id,
                    'return' as action_type,
                    br.return_date as action_time,
                    DATE_FORMAT(br.return_date, '%H:%i:%s') as exact_time,
                    DATE_FORMAT(br.return_date, '%d/%m/%Y %H:%i') as formatted_datetime,
                    u.id as user_id,
                    u.full_name as reader_name,
                    u.card_number,
                    b.title as book_title,
                    bc.qr_code as copy_code,
                    br.status,
                    br.due_date,
                    staff.full_name as staff_name
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                LEFT JOIN users staff ON br.processed_by = staff.id
                WHERE br.return_date IS NOT NULL AND ${returnDateFilter}
            )
            ORDER BY action_time DESC
            LIMIT 200
        `);

        res.status(200).json({
            period,
            trendData: trendRows.map(r => ({
                label: r.label,
                borrow: Number(r.borrow) || 0,
                return: Number(r.return) || 0
            })),
            onTimeRate: {
                percentage: onTimeRate,
                onTimeCount,
                totalReturned
            },
            topBooks: finalTopBooks.map(b => ({
                id: b.id,
                title: b.title,
                author_name: b.author_name || 'Khuyết danh',
                borrows: Number(b.borrows) || 0
            })),
            categoryShare: categoryShare.map(c => ({
                name: c.name,
                value: Number(c.value) || 0
            })),
            fineRevenue: fineRevenue.map(f => ({
                label: f.label,
                v: Number(f.v) || 0
            })),
            summary: {
                totalBorrows: Number(summaryBorrows[0]?.count) || 0,
                totalReturns: Number(summaryReturns[0]?.count) || 0,
                totalFineAmount: Number(summaryFines[0]?.sum) || 0
            },
            transactions: transactions.map(t => ({
                id: t.id,
                action_type: t.action_type,
                action_time: t.action_time,
                exact_time: t.exact_time,
                formatted_datetime: t.formatted_datetime,
                user_id: t.user_id,
                reader_name: t.reader_name,
                card_number: t.card_number,
                book_title: t.book_title,
                copy_code: t.copy_code,
                status: t.status,
                due_date: t.due_date ? new Date(t.due_date).toLocaleDateString('vi-VN') : null,
                staff_name: t.staff_name || 'Tự động'
            }))
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu phân tích báo cáo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu phân tích' });
    }
};
