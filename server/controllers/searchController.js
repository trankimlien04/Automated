const db = require('../config/db');

exports.globalSearch = async (req, res) => {
    const query = (req.query.q || '').trim();
    const role = req.user?.role || 'reader';
    const userId = req.user?.id;

    if (!query || query.length === 0) {
        return res.status(200).json({
            role,
            books: [],
            users: [],
            copies: [],
            borrows: [],
            reservations: [],
            fines: [],
            configs: [],
            logs: []
        });
    }

    const searchTerm = `%${query}%`;

    try {
        let results = {
            role,
            books: [],
            users: [],
            copies: [],
            borrows: [],
            reservations: [],
            fines: [],
            configs: [],
            logs: []
        };

        // 1. SÁCH & ẤN PHẨM (Tất cả các vai trò đều có thể tìm sách)
        const [books] = await db.execute(`
            SELECT b.id, b.title, b.isbn, b.cover_image, b.available_copies, b.total_copies, b.published_year,
                   a.name as author_name, c.name as category_name
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            WHERE b.title LIKE ? OR b.isbn LIKE ? OR a.name LIKE ? OR c.name LIKE ?
            LIMIT 6
        `, [searchTerm, searchTerm, searchTerm, searchTerm]);
        results.books = books;

        // ==========================================
        // 2. DÀNH CHO ĐỘC GIẢ (READER)
        // ==========================================
        if (role === 'reader' && userId) {
            // Sách độc giả này đang mượn hoặc đã từng mượn
            const [myBorrows] = await db.execute(`
                SELECT br.id, br.borrow_date, br.due_date, br.status,
                       b.title as book_title, b.cover_image, bc.qr_code
                FROM borrow_records br
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE br.user_id = ? AND (b.title LIKE ? OR bc.qr_code LIKE ? OR CAST(br.id AS CHAR) LIKE ?)
                ORDER BY br.borrow_date DESC
                LIMIT 5
            `, [userId, searchTerm, searchTerm, searchTerm]);
            results.borrows = myBorrows;

            // Phiếu đặt trước của độc giả này
            const [myResvs] = await db.execute(`
                SELECT r.id, r.status, r.reservation_date,
                       CONCAT('TICKET-RES-', r.id) as ticket_code,
                       b.title as book_title, b.cover_image
                FROM reservations r
                JOIN books b ON r.book_id = b.id
                WHERE r.user_id = ? AND (b.title LIKE ? OR CAST(r.id AS CHAR) LIKE ?)
                ORDER BY r.reservation_date DESC
                LIMIT 5
            `, [userId, searchTerm, searchTerm]);
            results.reservations = myResvs;

            // Khoản phí phạt của độc giả này
            const [myFines] = await db.execute(`
                SELECT f.id, f.amount, f.reason, f.status, f.created_at, b.title as book_title
                FROM fines f
                LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
                LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
                LEFT JOIN books b ON bc.book_id = b.id
                WHERE f.user_id = ? AND (f.reason LIKE ? OR b.title LIKE ? OR CAST(f.id AS CHAR) LIKE ?)
                ORDER BY f.created_at DESC
                LIMIT 5
            `, [userId, searchTerm, searchTerm, searchTerm]);
            results.fines = myFines;
        }

        // ==========================================
        // 3. DÀNH CHO THỦ THƯ (LIBRARIAN)
        // ==========================================
        if (role === 'librarian') {
            // Tra cứu Độc giả & Mã thẻ
            const [readers] = await db.execute(`
                SELECT id, full_name, email, phone, card_number, role, status, avatar_url
                FROM users
                WHERE role = 'reader' AND (full_name LIKE ? OR card_number LIKE ? OR email LIKE ? OR phone LIKE ?)
                LIMIT 6
            `, [searchTerm, searchTerm, searchTerm, searchTerm]);
            results.users = readers;

            // Tra cứu Bản sao sách & Mã QR
            const [copies] = await db.execute(`
                SELECT bc.id, bc.qr_code, bc.status, bc.condition_note, b.id as book_id, b.title as book_title, b.cover_image
                FROM book_copies bc
                JOIN books b ON bc.book_id = b.id
                WHERE bc.qr_code LIKE ? OR b.title LIKE ?
                LIMIT 6
            `, [searchTerm, searchTerm]);
            results.copies = copies;

            // Tra cứu Phiếu mượn / Trả toàn hệ thống
            const [borrows] = await db.execute(`
                SELECT br.id, br.borrow_date, br.due_date, br.status, 
                       u.full_name as reader_name, u.card_number,
                       b.title as book_title, bc.qr_code
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                WHERE CAST(br.id AS CHAR) LIKE ? OR u.full_name LIKE ? OR u.card_number LIKE ? OR b.title LIKE ? OR bc.qr_code LIKE ?
                ORDER BY br.borrow_date DESC
                LIMIT 6
            `, [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm]);
            results.borrows = borrows;

            // Tra cứu Phiếu đặt trước của bạn đọc
            const [reservations] = await db.execute(`
                SELECT r.id, r.status, r.reservation_date,
                       CONCAT('TICKET-RES-', r.id) as ticket_code,
                       u.full_name as reader_name, u.card_number,
                       b.title as book_title
                FROM reservations r
                JOIN users u ON r.user_id = u.id
                JOIN books b ON r.book_id = b.id
                WHERE CAST(r.id AS CHAR) LIKE ? OR u.full_name LIKE ? OR u.card_number LIKE ? OR b.title LIKE ?
                ORDER BY r.reservation_date DESC
                LIMIT 5
            `, [searchTerm, searchTerm, searchTerm, searchTerm]);
            results.reservations = reservations;
        }

        // ==========================================
        // 4. DÀNH CHO QUẢN TRỊ VIÊN (ADMIN)
        // ==========================================
        if (role === 'admin') {
            // Tra cứu toàn bộ Tài khoản & Phân quyền
            const [allUsers] = await db.execute(`
                SELECT id, full_name, email, phone, card_number, role, status, avatar_url
                FROM users
                WHERE full_name LIKE ? OR card_number LIKE ? OR email LIKE ? OR role LIKE ?
                LIMIT 6
            `, [searchTerm, searchTerm, searchTerm, searchTerm]);
            results.users = allUsers;

            // Tra cứu Cấu hình tham số & Đề xuất thay đổi (Maker-Checker)
            const [configs] = await db.execute(`
                SELECT sc.key_name, sc.value, sc.description
                FROM system_configs sc
                WHERE sc.key_name LIKE ? OR sc.description LIKE ?
                LIMIT 4
            `, [searchTerm, searchTerm]);

            const [proposals] = await db.execute(`
                SELECT cr.id, cr.key_name, cr.current_value, cr.proposed_value, cr.status, cr.reason,
                       u.full_name as proposer_name
                FROM config_change_requests cr
                JOIN users u ON cr.requested_by = u.id
                WHERE cr.key_name LIKE ? OR cr.reason LIKE ? OR CAST(cr.id AS CHAR) LIKE ?
                ORDER BY cr.created_at DESC
                LIMIT 4
            `, [searchTerm, searchTerm, searchTerm]);
            results.configs = [...configs.map(c => ({ ...c, type: 'config' })), ...proposals.map(p => ({ ...p, type: 'proposal' }))];

            // Tra cứu Nhật ký hoạt động kiểm toán (Audit Logs)
            const [logs] = await db.execute(`
                SELECT al.id, al.action, al.details, al.created_at, u.full_name as actor_name
                FROM activity_logs al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.action LIKE ? OR al.details LIKE ? OR u.full_name LIKE ?
                ORDER BY al.created_at DESC
                LIMIT 5
            `, [searchTerm, searchTerm, searchTerm]);
            results.logs = logs;

            // Tra cứu Mã QR Bản sao
            const [copies] = await db.execute(`
                SELECT bc.id, bc.qr_code, bc.status, b.title as book_title
                FROM book_copies bc
                JOIN books b ON bc.book_id = b.id
                WHERE bc.qr_code LIKE ? OR b.title LIKE ?
                LIMIT 4
            `, [searchTerm, searchTerm]);
            results.copies = copies;
        }

        // ==========================================
        // 5. DÀNH CHO CHỦ THƯ VIỆN / GIÁM ĐỐC (OWNER)
        // ==========================================
        if (role === 'owner') {
            // Tra cứu Đề xuất cần phê duyệt Maker-Checker
            const [proposals] = await db.execute(`
                SELECT cr.id, cr.key_name, cr.current_value, cr.proposed_value, cr.status, cr.reason, cr.created_at,
                       u.full_name as proposer_name
                FROM config_change_requests cr
                JOIN users u ON cr.requested_by = u.id
                WHERE cr.key_name LIKE ? OR cr.reason LIKE ? OR CAST(cr.id AS CHAR) LIKE ? OR cr.status LIKE ?
                ORDER BY (cr.status = 'pending') DESC, cr.created_at DESC
                LIMIT 6
            `, [searchTerm, searchTerm, searchTerm, searchTerm]);
            results.configs = proposals.map(p => ({ ...p, type: 'proposal' }));

            // Tra cứu Nhân sự & Người dùng hệ thống
            const [users] = await db.execute(`
                SELECT id, full_name, email, role, status, card_number
                FROM users
                WHERE full_name LIKE ? OR email LIKE ? OR role LIKE ? OR card_number LIKE ?
                LIMIT 6
            `, [searchTerm, searchTerm, searchTerm, searchTerm]);
            results.users = users;

            // Tra cứu Nhật ký kiểm toán trọng yếu (Audit Trail)
            const [logs] = await db.execute(`
                SELECT al.id, al.action, al.details, al.created_at, u.full_name as actor_name
                FROM activity_logs al
                LEFT JOIN users u ON al.user_id = u.id
                WHERE al.action LIKE ? OR al.details LIKE ? OR u.full_name LIKE ?
                ORDER BY al.created_at DESC
                LIMIT 5
            `, [searchTerm, searchTerm, searchTerm]);
            results.logs = logs;
        }

        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi tìm kiếm tổng thể theo actor:', error);
        res.status(500).json({ message: 'Lỗi server khi tìm kiếm' });
    }
};
