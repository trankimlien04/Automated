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

        res.status(200).json({
            stats: {
                totalBooks: books[0].count,
                totalCopies: copies[0].count,
                activeReaders: readers[0].count,
                currentlyBorrowing: borrowing[0].count,
                activeReservations: reservations[0].count,
                overdueCount: overdue[0].count,
                unpaidFinesSum: fines[0].sum || 0
            },
            popularBooks: popular,
            borrowTrends: trends,
            recentTransactions: recent
        });
    } catch (error) {
        console.error('Lỗi khi lấy thống kê Dashboard:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê' });
    }
};
