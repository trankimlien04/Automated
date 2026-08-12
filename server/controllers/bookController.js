const db = require('../config/db');

exports.getAllBooks = async (req, res) => {
    try {
        const [books] = await db.execute(`
            SELECT b.*, a.name as author_name, c.name as category_name
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
        `);
        res.status(200).json(books);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getBookById = async (req, res) => {
    try {
        const [books] = await db.execute(`
            SELECT b.*, a.name as author_name, c.name as category_name
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            WHERE b.id = ?
        `, [req.params.id]);

        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sách' });
        }

        // Get copies
        const [copies] = await db.execute('SELECT * FROM book_copies WHERE book_id = ?', [req.params.id]);
        
        res.status(200).json({ ...books[0], copies });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createBook = async (req, res) => {
    const { title, author_id, publisher_id, category_id, isbn, published_year, description, total_copies } = req.body;
    try {
        const [result] = await db.execute(
            `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, total_copies, available_copies)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, author_id || null, publisher_id || null, category_id || null, isbn || null, published_year || null, description || null, total_copies || 0, total_copies || 0]
        );
        
        const newBookId = result.insertId;

        // Automatically generate book copies if total_copies > 0
        if (total_copies > 0) {
            const qrPrefix = 'LIB-BK-';
            for (let i = 1; i <= total_copies; i++) {
                const uniqueQR = qrPrefix + newBookId + '-' + i + '-' + Date.now();
                await db.execute('INSERT INTO book_copies (book_id, qr_code) VALUES (?, ?)', [newBookId, uniqueQR]);
            }
        }

        res.status(201).json({ message: 'Thêm sách thành công', bookId: newBookId });
    } catch (error) {
        console.error('Lỗi khi thêm sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateBook = async (req, res) => {
    const { title, author_id, publisher_id, category_id, isbn, published_year, description } = req.body;
    try {
        await db.execute(
            `UPDATE books SET title=?, author_id=?, publisher_id=?, category_id=?, isbn=?, published_year=?, description=? WHERE id=?`,
            [title, author_id || null, publisher_id || null, category_id || null, isbn || null, published_year || null, description || null, req.params.id]
        );
        res.status(200).json({ message: 'Cập nhật sách thành công' });
    } catch (error) {
        console.error('Lỗi khi cập nhật sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.deleteBook = async (req, res) => {
    try {
        await db.execute('DELETE FROM books WHERE id=?', [req.params.id]);
        res.status(200).json({ message: 'Xóa sách thành công' });
    } catch (error) {
        console.error('Lỗi khi xóa sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
