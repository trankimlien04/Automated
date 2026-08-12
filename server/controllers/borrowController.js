const db = require('../config/db');

exports.borrowBook = async (req, res) => {
    const { readerCardNumber, bookQrCode } = req.body;
    const processedBy = req.user.id;

    try {
        if (!readerCardNumber || !bookQrCode) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã thẻ độc giả và mã QR sách' });
        }

        // 1. Check user by card_number
        const [users] = await db.execute('SELECT * FROM users WHERE card_number = ?', [readerCardNumber]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thẻ độc giả' });
        }
        const user = users[0];

        if (user.status !== 'active') {
            return res.status(400).json({ message: 'Tài khoản độc giả này đang bị khóa hoặc chưa được duyệt' });
        }

        // 2. Get system configs
        const [configs] = await db.execute('SELECT key_name, value FROM system_configs');
        const configMap = Object.fromEntries(configs.map(c => [c.key_name, c.value]));
        const maxBooks = parseInt(configMap['max_books_per_user'] || '3');
        const maxBorrowDays = parseInt(configMap['max_borrow_days'] || '14');

        // Check if user has exceeded maximum borrow limit
        const [activeBorrows] = await db.execute(
            'SELECT COUNT(*) as count FROM borrow_records WHERE user_id = ? AND status = "borrowing"',
            [user.id]
        );
        if (activeBorrows[0].count >= maxBooks) {
            return res.status(400).json({ message: `Độc giả đã mượn tối đa số sách cho phép (${maxBooks} cuốn)` });
        }

        // 3. Find book copy by QR code
        const [copies] = await db.execute(
            'SELECT bc.*, b.title, b.id as book_real_id, b.available_copies FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [bookQrCode]
        );
        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy mã sách này trong hệ thống' });
        }
        const copy = copies[0];

        if (copy.status !== 'available') {
            return res.status(400).json({ message: `Bản sao sách này hiện tại không khả dụng (Trạng thái: ${copy.status})` });
        }

        // 4. Calculate due date
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + maxBorrowDays);

        // Start transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Create borrow record
            await connection.execute(
                'INSERT INTO borrow_records (user_id, book_copy_id, due_date, status, processed_by) VALUES (?, ?, ?, "borrowing", ?)',
                [user.id, copy.id, dueDate.toISOString().slice(0, 10), processedBy]
            );

            // Update book copy status
            await connection.execute(
                'UPDATE book_copies SET status = "borrowed" WHERE id = ?',
                [copy.id]
            );

            // Decrement available copies of book
            await connection.execute(
                'UPDATE books SET available_copies = GREATEST(0, available_copies - 1) WHERE id = ?',
                [copy.book_real_id]
            );

            // Save log
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'BORROW', 'borrow_records', copy.id, `Mượn sách: ${copy.title} cho độc giả: ${user.full_name}`]
            );

            await connection.commit();
            res.status(200).json({
                message: 'Đã xác nhận cho mượn sách thành công!',
                data: {
                    readerName: user.full_name,
                    bookTitle: copy.title,
                    dueDate: dueDate.toLocaleDateString('vi-VN'),
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi mượn sách:', error);
        res.status(500).json({ message: 'Lỗi server khi mượn sách' });
    }
};

exports.returnBook = async (req, res) => {
    const { bookQrCode } = req.body;
    const processedBy = req.user.id;

    try {
        if (!bookQrCode) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã QR sách để trả' });
        }

        // 1. Find book copy
        const [copies] = await db.execute(
            'SELECT bc.*, b.title, b.id as book_real_id FROM book_copies bc JOIN books b ON bc.book_id = b.id WHERE bc.qr_code = ?',
            [bookQrCode]
        );
        if (copies.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bản sao sách này' });
        }
        const copy = copies[0];

        if (copy.status !== 'borrowed') {
            return res.status(400).json({ message: 'Bản sao sách này hiện không ở trạng thái đang được mượn' });
        }

        // 2. Find active borrow record
        const [records] = await db.execute(
            'SELECT br.*, u.full_name, u.email, u.id as u_id FROM borrow_records br JOIN users u ON br.user_id = u.id WHERE br.book_copy_id = ? AND br.status = "borrowing"',
            [copy.id]
        );
        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn hoạt động cho bản sao sách này' });
        }
        const record = records[0];

        const today = new Date();
        const dueDate = new Date(record.due_date);
        let overdueDays = 0;
        let fineAmount = 0;

        // Calculate if overdue
        if (today > dueDate) {
            const timeDiff = today.getTime() - dueDate.getTime();
            overdueDays = Math.ceil(timeDiff / (1000 * 3600 * 24));
            
            // Get fine config
            const [configs] = await db.execute('SELECT value FROM system_configs WHERE key_name = "fine_per_day"');
            const finePerDay = parseInt(configs.length > 0 ? configs[0].value : '5000');
            fineAmount = overdueDays * finePerDay;
        }

        // Start transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // Update borrow record
            await connection.execute(
                'UPDATE borrow_records SET return_date = NOW(), status = "returned" WHERE id = ?',
                [record.id]
            );

            // Update copy status
            await connection.execute(
                'UPDATE book_copies SET status = "available" WHERE id = ?',
                [copy.id]
            );

            // Increment book available count
            await connection.execute(
                'UPDATE books SET available_copies = available_copies + 1 WHERE id = ?',
                [copy.book_real_id]
            );

            // If there's fine, insert fine record
            if (fineAmount > 0) {
                await connection.execute(
                    'INSERT INTO fines (borrow_record_id, user_id, amount, reason, status) VALUES (?, ?, ?, ?, "unpaid")',
                    [record.id, record.u_id, fineAmount, `Trả trễ hạn ${overdueDays} ngày (Hạn trả: ${dueDate.toLocaleDateString('vi-VN')})`]
                );
            }

            // Save log
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'RETURN', 'borrow_records', record.id, `Trả sách: ${copy.title}. Độc giả: ${record.full_name}. Trễ hạn: ${overdueDays} ngày. Phạt: ${fineAmount}đ`]
            );

            await connection.commit();

            res.status(200).json({
                message: 'Trả sách thành công!',
                data: {
                    readerName: record.full_name,
                    bookTitle: copy.title,
                    overdueDays,
                    fineAmount,
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi trả sách:', error);
        res.status(500).json({ message: 'Lỗi server khi trả sách' });
    }
};

exports.getBorrowRecords = async (req, res) => {
    const { role, id } = req.user;

    try {
        let query = `
            SELECT br.id, br.borrow_date, br.due_date, br.return_date, br.status, 
                   u.full_name as reader_name, u.card_number,
                   b.title as book_title, bc.qr_code
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
        `;
        
        const params = [];
        if (role === 'reader') {
            query += ' WHERE br.user_id = ?';
            params.push(id);
        }
        
        query += ' ORDER BY br.borrow_date DESC LIMIT 50';

        const [records] = await db.execute(query, params);
        res.status(200).json(records);
    } catch (error) {
        console.error('Lỗi khi lấy lịch sử mượn trả:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.renewBook = async (req, res) => {
    const { borrowRecordId } = req.body;
    const userId = req.user.id;

    try {
        if (!borrowRecordId) {
            return res.status(400).json({ message: 'Vui lòng cung cấp mã phiếu mượn' });
        }

        const [records] = await db.execute(`
            SELECT br.*, b.title, u.full_name
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            JOIN users u ON br.user_id = u.id
            WHERE br.id = ?
        `, [borrowRecordId]);

        if (records.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy phiếu mượn' });
        }
        const record = records[0];

        if (record.status !== 'borrowing') {
            return res.status(400).json({ message: 'Chỉ có thể gia hạn phiếu mượn đang trong trạng thái mượn' });
        }

        const today = new Date();
        const dueDate = new Date(record.due_date);
        if (today > dueDate) {
            return res.status(400).json({ message: 'Phiếu mượn đã quá hạn, không thể gia hạn tự động. Vui lòng thanh toán phí phạt.' });
        }

        // Add 7 days to current due date
        const newDueDate = new Date(dueDate);
        newDueDate.setDate(newDueDate.getDate() + 7);

        await db.execute('UPDATE borrow_records SET due_date = ? WHERE id = ?', [
            newDueDate.toISOString().slice(0, 10),
            borrowRecordId
        ]);

        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId, 'RENEW', 'borrow_records', borrowRecordId, `Gia hạn mượn sách "${record.title}" thêm 7 ngày (Hạn mới: ${newDueDate.toLocaleDateString('vi-VN')})`]
        );

        res.status(200).json({
            message: 'Gia hạn sách thành công thêm 7 ngày!',
            newDueDate: newDueDate.toLocaleDateString('vi-VN')
        });
    } catch (error) {
        console.error('Lỗi khi gia hạn sách:', error);
        res.status(500).json({ message: 'Lỗi server khi gia hạn sách' });
    }
};

