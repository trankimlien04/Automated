const db = require('../config/db');

exports.getAllBooks = async (req, res) => {
    try {
        const [books] = await db.execute(`
            SELECT b.*, a.name as author_name, c.name as category_name, p.name as publisher_name,
                   (SELECT COUNT(*) FROM reviews rv WHERE rv.book_id = b.id) as review_count
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
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
            SELECT b.*, a.name as author_name, c.name as category_name, p.name as publisher_name,
                   (SELECT COUNT(*) FROM reviews rv WHERE rv.book_id = b.id) as review_count
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
            WHERE b.id = ?
        `, [req.params.id]);

        if (books.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sách' });
        }

        // Get copies enriched with current active borrower & shelf verification details
        const [copies] = await db.execute(`
            SELECT bc.*, 
                   br.id as active_borrow_id, br.borrow_date, br.due_date,
                   u.id as borrower_id, u.full_name as borrower_name, u.card_number as borrower_card_number,
                   di.id as active_draft_item_id, d.id as active_draft_id, d.draft_code as active_draft_code,
                   du.full_name as draft_reader_name, du.card_number as draft_reader_card_number,
                   TIMESTAMPDIFF(HOUR, NOW(), d.expires_at) as draft_time_left_hours
            FROM book_copies bc
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            LEFT JOIN borrow_draft_items di ON bc.id = di.book_copy_id AND di.status = 'pending'
            LEFT JOIN borrow_drafts d ON di.draft_id = d.id AND d.status = 'pending' AND d.expires_at > NOW()
            LEFT JOIN users du ON d.user_id = du.id
            WHERE bc.book_id = ?
            ORDER BY bc.id ASC
        `, [req.params.id]);

        // Lấy danh sách bạn đọc đang đăng ký giữ chỗ 24h cho đầu sách này
        const { getActiveHoldsForBook } = require('./borrowController');
        const activeHolds = await getActiveHoldsForBook(req.params.id);
        
        res.status(200).json({ 
            ...books[0], 
            copies,
            active_holds: activeHolds,
            hold_count: activeHolds.length
        });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.createBook = async (req, res) => {
    const { title, author_id, publisher_id, category_id, isbn, published_year, description, total_copies, location } = req.body;
    try {
        const bookLocation = (location || '').trim() || 'Phòng 01 - Kệ 01 - Ngăn 01';
        const [result] = await db.execute(
            `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, total_copies, available_copies, location)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, author_id || null, publisher_id || null, category_id || null, isbn || null, published_year || null, description || null, total_copies || 0, total_copies || 0, bookLocation]
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

        res.status(201).json({ message: 'Thêm sách thành công', bookId: newBookId, location: bookLocation });
    } catch (error) {
        console.error('Lỗi khi thêm sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateBook = async (req, res) => {
    const { title, author_id, publisher_id, category_id, isbn, published_year, description, location } = req.body;
    try {
        await db.execute(
            `UPDATE books SET 
                title=COALESCE(?, title), 
                author_id=COALESCE(?, author_id), 
                publisher_id=COALESCE(?, publisher_id), 
                category_id=COALESCE(?, category_id), 
                isbn=COALESCE(?, isbn), 
                published_year=COALESCE(?, published_year), 
                description=COALESCE(?, description), 
                location=COALESCE(?, location) 
             WHERE id=?`,
            [title || null, author_id || null, publisher_id || null, category_id || null, isbn || null, published_year || null, description || null, location || null, req.params.id]
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

        // Pre-cache existing lookups to maximize import speed and prevent timeouts
        const [allAuthors] = await connection.execute('SELECT id, name FROM authors');
        const authorMap = new Map(allAuthors.map(a => [a.name.toLowerCase().trim(), a.id]));

        const [allCats] = await connection.execute('SELECT id, name FROM categories');
        const catMap = new Map(allCats.map(c => [c.name.toLowerCase().trim(), c.id]));

        const [allPubs] = await connection.execute('SELECT id, name FROM publishers');
        const pubMap = new Map(allPubs.map(p => [p.name.toLowerCase().trim(), p.id]));

        const [allExistingBooks] = await connection.execute('SELECT id, isbn FROM books WHERE isbn IS NOT NULL');
        const isbnMap = new Map(allExistingBooks.map(b => [b.isbn.trim(), b.id]));

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
            const coverImage = (item.cover_image || item.cover || item['Hình ảnh'] || item['Ảnh bìa'] || '').toString().trim() || null;
            const location = (item.location || item['Vị trí'] || item['Vị trí kho'] || item['Vị trí sách'] || '').toString().trim() || null;

            // 1. Author lookup or insert
            let authorId = null;
            if (authorName) {
                const aKey = authorName.toLowerCase().trim();
                if (authorMap.has(aKey)) {
                    authorId = authorMap.get(aKey);
                } else {
                    const [newAuthor] = await connection.execute('INSERT INTO authors (name) VALUES (?)', [authorName]);
                    authorId = newAuthor.insertId;
                    authorMap.set(aKey, authorId);
                }
            }

            // 2. Category lookup or insert
            let categoryId = null;
            if (categoryName) {
                const cKey = categoryName.toLowerCase().trim();
                if (catMap.has(cKey)) {
                    categoryId = catMap.get(cKey);
                } else {
                    const [newCat] = await connection.execute('INSERT INTO categories (name) VALUES (?)', [categoryName]);
                    categoryId = newCat.insertId;
                    catMap.set(cKey, categoryId);
                }
            }

            // 3. Publisher lookup or insert
            let publisherId = null;
            if (publisherName) {
                const pKey = publisherName.toLowerCase().trim();
                if (pubMap.has(pKey)) {
                    publisherId = pubMap.get(pKey);
                } else {
                    const [newPub] = await connection.execute('INSERT INTO publishers (name) VALUES (?)', [publisherName]);
                    publisherId = newPub.insertId;
                    pubMap.set(pKey, publisherId);
                }
            }

            // 4. Check if Book with this ISBN already exists
            let newBookId = null;
            let isExisting = false;

            if (isbn && isbnMap.has(isbn)) {
                newBookId = isbnMap.get(isbn);
                isExisting = true;
                // Increase copies for existing book & update cover image if missing
                await connection.execute(
                    'UPDATE books SET total_copies = total_copies + ?, available_copies = available_copies + ?, cover_image = COALESCE(cover_image, ?) WHERE id = ?',
                    [copiesCount, copiesCount, coverImage, newBookId]
                );
            }

            if (!isExisting) {
                // Generate a deterministic room-shelf-rack location if not provided
                const fallbackRoom = `Phòng 0${((categoryId || 1) % 3) + 1} - Kệ 0${((importedCount * 2) % 6) + 1} - Ngăn 0${((importedCount * 3) % 4) + 1}`;
                const bookLocation = location || fallbackRoom;

                // Insert New Book
                const [bookResult] = await connection.execute(
                    `INSERT INTO books (title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, location, total_copies, available_copies)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [title, authorId, publisherId, categoryId, isbn || null, publishedYear, description, coverImage, bookLocation, copiesCount, copiesCount]
                );
                newBookId = bookResult.insertId;
                if (isbn) {
                    isbnMap.set(isbn, newBookId);
                }
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
