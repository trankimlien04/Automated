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

// Batch Import Books from Excel
exports.importBooksBatch = async (req, res) => {
    const { books } = req.body;
    const userId = req.user.id;

    if (!books || !Array.isArray(books) || books.length === 0) {
        return res.status(400).json({ message: 'Danh sách sách tải lên không hợp lệ hoặc rỗng' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        let importedCount = 0;
        let totalCopiesGenerated = 0;

        for (const item of books) {
            const title = (item.title || item.name || item['Tên sách'] || item['Tên đầu sách'] || '').toString().trim();
            if (!title) continue;

            const authorName = (item.author || item.author_name || item['Tác giả'] || '').toString().trim();
            const categoryName = (item.category || item.category_name || item['Thể loại'] || '').toString().trim();
            const publisherName = (item.publisher || item.publisher_name || item['Nhà xuất bản'] || item['NXB'] || '').toString().trim();
            const isbn = (item.isbn || item['Mã ISBN'] || item['ISBN'] || '').toString().trim();
            const publishedYear = parseInt(item.published_year || item['Năm xuất bản'] || item['Năm XB'] || new Date().getFullYear(), 10) || new Date().getFullYear();
            const copiesCount = parseInt(item.total_copies || item.copies || item['Số lượng'] || item['Số bản sao'] || 1, 10) || 1;
            const description = (item.description || item['Mô tả'] || 'Sách nhập từ file Excel').toString().trim();

            // 1. Author lookup or insert
            let authorId = null;
            if (authorName) {
                const [existingAuthors] = await connection.execute('SELECT id FROM authors WHERE name = ?', [authorName]);
                if (existingAuthors.length > 0) {
                    authorId = existingAuthors[0].id;
                } else {
                    const [newAuthor] = await connection.execute('INSERT INTO authors (name) VALUES (?)', [authorName]);
                    authorId = newAuthor.insertId;
                }
            }

            // 2. Category lookup or insert
            let categoryId = null;
            if (categoryName) {
                const [existingCats] = await connection.execute('SELECT id FROM categories WHERE name = ?', [categoryName]);
                if (existingCats.length > 0) {
                    categoryId = existingCats[0].id;
                } else {
                    const [newCat] = await connection.execute('INSERT INTO categories (name) VALUES (?)', [categoryName]);
                    categoryId = newCat.insertId;
                }
            }

            // 3. Publisher lookup or insert
            let publisherId = null;
            if (publisherName) {
                const [existingPubs] = await connection.execute('SELECT id FROM publishers WHERE name = ?', [publisherName]);
                if (existingPubs.length > 0) {
                    publisherId = existingPubs[0].id;
                } else {
                    const [newPub] = await connection.execute('INSERT INTO publishers (name) VALUES (?)', [publisherName]);
                    publisherId = newPub.insertId;
                }
            }

            // 4. Check if Book with this ISBN already exists
            let newBookId = null;
            let isExisting = false;

            if (isbn) {
                const [existingBooks] = await connection.execute(
                    'SELECT id, total_copies, available_copies FROM books WHERE isbn = ?',
                    [isbn]
                );
                if (existingBooks.length > 0) {
                    newBookId = existingBooks[0].id;
                    isExisting = true;
                    // Increase copies for existing book
                    await connection.execute(
                        'UPDATE books SET total_copies = total_copies + ?, available_copies = available_copies + ? WHERE id = ?',
                        [copiesCount, copiesCount, newBookId]
                    );
                }
            }

            if (!isExisting) {
                // Insert New Book
                const [bookResult] = await connection.execute(
                    `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, total_copies, available_copies)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [title, authorId, publisherId, categoryId, isbn || null, publishedYear, description, copiesCount, copiesCount]
                );
                newBookId = bookResult.insertId;
            }

            importedCount++;

            // 5. Generate Book Copies & unique QR
            const [existingCopiesCount] = await connection.execute(
                'SELECT COUNT(*) as count FROM book_copies WHERE book_id = ?',
                [newBookId]
            );
            const startCopyIndex = (existingCopiesCount[0]?.count || 0) + 1;

            for (let i = 0; i < copiesCount; i++) {
                const copyNum = startCopyIndex + i;
                const uniqueQR = `QR-BK-${newBookId}-${copyNum}`;
                await connection.execute(
                    'INSERT INTO book_copies (book_id, qr_code, status) VALUES (?, ?, "available")',
                    [newBookId, uniqueQR]
                );
                totalCopiesGenerated++;
            }
        }

        // 6. Activity log
        await connection.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)',
            [userId, 'IMPORT_EXCEL', 'books', `Nhập ${importedCount} đầu sách (${totalCopiesGenerated} bản sao) từ file Excel`]
        );

        await connection.commit();

        res.status(200).json({
            message: `Nhập thành công ${importedCount} đầu sách với ${totalCopiesGenerated} bản sao và mã QR tương ứng!`,
            importedCount,
            totalCopiesGenerated
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi nhập sách từ Excel:', error);
        res.status(500).json({ message: 'Lỗi server khi nhập sách từ Excel' });
    } finally {
        connection.release();
    }
};
