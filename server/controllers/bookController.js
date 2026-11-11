const db = require('../config/db');
const { computeSmartWaitPrediction } = require('../utils/waitTimePredictor');

// Helper: Đảm bảo available_copies luôn nằm trong khoảng hợp lệ [0, total_copies]
// và khớp với số bản sao thực tế đang mượn / giữ chỗ 24h / giữ ưu tiên đặt trước 48h
const normalizeBooksInventory = async () => {
    try {
        const { syncWaitingReservationsWithStock } = require('./reservationController');
        if (typeof syncWaitingReservationsWithStock === 'function') {
            await syncWaitingReservationsWithStock();
        }
        await db.execute(`
            UPDATE books
            SET available_copies = LEAST(total_copies, GREATEST(0, available_copies))
            WHERE available_copies > total_copies OR available_copies < 0
        `);
    } catch (e) {
        // Ignore if table locked
    }
};

exports.getAllBooks = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const [books] = await db.execute(`
            SELECT b.*,
                   LEAST(b.total_copies, GREATEST(0, b.available_copies)) as available_copies,
                   a.name as author_name, c.name as category_name, p.name as publisher_name,
                   (SELECT COUNT(*) FROM reviews rv WHERE rv.book_id = b.id) as review_count
            FROM books b
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
        `);

        // Batch-fetch active borrow due_dates, hold expiries & waiting reservation counts for Smart Wait-Time Predictor
        const [activeBorrows] = await db.execute(`
            SELECT bc.book_id, br.due_date
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            WHERE br.status = 'borrowing'
            ORDER BY br.due_date ASC
        `);

        const [activeHolds] = await db.execute(`
            SELECT book_id, expires_at
            FROM reservations
            WHERE status IN ('notified', 'accepted', 'ready') AND expires_at IS NOT NULL
            UNION ALL
            SELECT di.book_id, d.expires_at
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            WHERE di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
        `);

        const [waitingResvs] = await db.execute(`
            SELECT book_id, COUNT(*) as waiting_count
            FROM reservations
            WHERE status IN ('waiting', 'pending')
            GROUP BY book_id
        `);

        const dueDatesByBook = new Map();
        for (const row of activeBorrows) {
            if (!dueDatesByBook.has(row.book_id)) {
                dueDatesByBook.set(row.book_id, []);
            }
            dueDatesByBook.get(row.book_id).push(row.due_date);
        }

        const holdExpiriesByBook = new Map();
        for (const row of activeHolds) {
            if (!holdExpiriesByBook.has(row.book_id)) {
                holdExpiriesByBook.set(row.book_id, []);
            }
            holdExpiriesByBook.get(row.book_id).push(row.expires_at);
        }

        const waitingCountByBook = new Map();
        for (const row of waitingResvs) {
            waitingCountByBook.set(row.book_id, Number(row.waiting_count) || 0);
        }

        const enrichedBooks = books.map((b) => {
            const avail = Number(b.available_copies) || 0;
            const waitingCount = waitingCountByBook.get(b.id) || 0;
            const activeDueDates = dueDatesByBook.get(b.id) || [];
            const holdExpiryDates = holdExpiriesByBook.get(b.id) || [];

            const waitPrediction = avail <= 0
                ? computeSmartWaitPrediction({
                    bookId: b.id,
                    totalCopies: b.total_copies,
                    availableCopies: avail,
                    activeDueDates,
                    holdExpiryDates,
                    waitingCount
                })
                : null;

            return {
                ...b,
                waiting_queue_count: waitingCount,
                wait_prediction: waitPrediction
            };
        });

        res.status(200).json(enrichedBooks);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách sách:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.getBookById = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const [books] = await db.execute(`
            SELECT b.*,
                   LEAST(b.total_copies, GREATEST(0, b.available_copies)) as available_copies,
                   a.name as author_name, c.name as category_name, p.name as publisher_name,
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

        const [waitingRows] = await db.execute(
            `SELECT COUNT(*) as count FROM reservations WHERE book_id = ? AND status IN ('waiting', 'pending')`,
            [req.params.id]
        );
        const waitingCount = Number(waitingRows[0]?.count) || 0;
        const activeDueDates = copies.filter(c => c.due_date).map(c => c.due_date);
        const bookObj = books[0];
        const waitPrediction = Number(bookObj.available_copies) <= 0
            ? computeSmartWaitPrediction({
                bookId: bookObj.id,
                totalCopies: bookObj.total_copies,
                availableCopies: bookObj.available_copies,
                activeDueDates,
                waitingCount
            })
            : null;
        
        res.status(200).json({ 
            ...bookObj, 
            copies,
            active_holds: activeHolds,
            hold_count: activeHolds.length,
            waiting_queue_count: waitingCount,
            wait_prediction: waitPrediction
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

// =============================================================================
// KIỂM KÊ KHO SÁCH NHANH BẰNG QUÉT QR HÀNG LOẠT (SMART SHELF INVENTORY AUDIT)
// =============================================================================

function normalizeLocationString(raw) {
    const str = String(raw || 'Phòng 01 - Kệ 01 - Ngăn 01').trim();
    const roomMatch = str.match(/Ph[oò]ng\s*(\d+)/i);
    const shelfMatch = str.match(/K[eệ]\s*(\d+)/i);
    const rackMatch = str.match(/Ng[aă]n\s*(\d+)/i);
    const pad2 = (n) => String(Math.max(1, n)).padStart(2, '0');
    const r = roomMatch ? parseInt(roomMatch[1], 10) || 1 : 1;
    const s = shelfMatch ? parseInt(shelfMatch[1], 10) || 1 : 1;
    const k = rackMatch ? parseInt(rackMatch[1], 10) || 1 : 1;
    return `Phòng ${pad2(r)} - Kệ ${pad2(s)} - Ngăn ${pad2(k)}`;
}

// GET /api/books/shelf-audit/location?location=Phòng 01 - Kệ 02 - Ngăn 01
exports.getShelfAuditData = async (req, res) => {
    try {
        await normalizeBooksInventory();
        const rawTarget = req.query.location || 'Phòng 01 - Kệ 01 - Ngăn 01';
        const targetLocation = normalizeLocationString(rawTarget);

        // Lấy toàn bộ bản sao của các đầu sách thuộc ngăn này
        const [allCopies] = await db.execute(`
            SELECT bc.id as copy_id, bc.qr_code, bc.status as copy_status,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as raw_location,
                   a.name as author_name, c.name as category_name,
                   br.id as active_borrow_id, u.full_name as borrower_name, u.card_number as borrower_card_number,
                   di.id as active_draft_item_id, d.draft_code as active_draft_code, du.full_name as draft_reader_name
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            LEFT JOIN borrow_draft_items di ON bc.id = di.book_copy_id AND di.status = 'pending'
            LEFT JOIN borrow_drafts d ON di.draft_id = d.id AND d.status = 'pending' AND d.expires_at > NOW()
            LEFT JOIN users du ON d.user_id = du.id
            ORDER BY b.title ASC, bc.id ASC
        `);

        const expectedCopies = [];
        const demoMisplacedSamples = [];

        for (const row of allCopies) {
            const normLoc = normalizeLocationString(row.raw_location);
            const enriched = {
                copy_id: row.copy_id,
                qr_code: row.qr_code,
                copy_status: row.copy_status,
                book_id: row.book_id,
                book_title: row.book_title,
                isbn: row.isbn,
                cover_image: row.cover_image,
                author_name: row.author_name || 'Chưa rõ tác giả',
                category_name: row.category_name || 'Chưa phân loại',
                expected_location: normLoc,
                borrower_name: row.borrower_name || null,
                borrower_card_number: row.borrower_card_number || null,
                active_draft_code: row.active_draft_code || null,
                draft_reader_name: row.draft_reader_name || null,
                // Bản sao được kỳ vọng đang nằm trên kệ nếu status === 'available'
                expected_on_shelf: row.copy_status === 'available'
            };

            if (normLoc === targetLocation) {
                expectedCopies.push(enriched);
            } else if (row.copy_status === 'available' && demoMisplacedSamples.length < 4) {
                // Lấy mẫu vài cuốn từ ngăn/phòng khác để Thủ thư có thể bấm test nhanh trường hợp để nhầm kệ
                if (!demoMisplacedSamples.some(s => s.expected_location === normLoc)) {
                    demoMisplacedSamples.push(enriched);
                }
            }
        }

        const expectedOnShelfCopies = expectedCopies.filter(c => c.expected_on_shelf);
        const borrowedOrLockedCopies = expectedCopies.filter(c => !c.expected_on_shelf);

        // Thống kê số lượng bản sao theo từng Kệ và từng Ngăn của phòng này để gợi ý trực quan cho Thủ thư
        const currentRoomMatch = targetLocation.match(/(Phòng\s*\d+)/i);
        const currentRoomStr = currentRoomMatch ? currentRoomMatch[1] : 'Phòng 01';
        const currentShelfMatch = targetLocation.match(/(Kệ\s*\d+)/i);
        const currentShelfStr = currentShelfMatch ? currentShelfMatch[1] : 'Kệ 01';

        const shelfCopyCounts = {};
        const rackCopyCounts = {};

        for (const row of allCopies) {
            const normLoc = normalizeLocationString(row.raw_location);
            if (normLoc.startsWith(currentRoomStr)) {
                const sm = normLoc.match(/Kệ\s*(\d+)/i);
                if (sm) {
                    const shKey = `Kệ ${sm[1].padStart(2, '0')}`;
                    shelfCopyCounts[shKey] = (shelfCopyCounts[shKey] || 0) + 1;
                }
            }
            if (normLoc.startsWith(`${currentRoomStr} - ${currentShelfStr}`)) {
                const rm = normLoc.match(/Ngăn\s*(\d+)/i);
                if (rm) {
                    const rkKey = `Ngăn ${rm[1].padStart(2, '0')}`;
                    rackCopyCounts[rkKey] = (rackCopyCounts[rkKey] || 0) + 1;
                }
            }
        }

        res.status(200).json({
            targetLocation,
            totalExpectedOnShelf: expectedOnShelfCopies.length,
            totalCopiesInLocation: expectedCopies.length,
            expectedOnShelfCopies,
            borrowedOrLockedCopies,
            demoMisplacedSamples,
            shelfCopyCounts,
            rackCopyCounts
        });
    } catch (error) {
        console.error('Lỗi khi tải dữ liệu kiểm kê kệ sách:', error);
        res.status(500).json({ message: 'Lỗi server khi tải dữ liệu kiểm kê kệ sách' });
    }
};

// POST /api/books/shelf-audit/scan
// Body: { qrCode, targetLocation }
exports.scanCopyForShelfAudit = async (req, res) => {
    try {
        const { qrCode, targetLocation: rawTarget } = req.body;
        const cleanQr = String(qrCode || '').trim();
        if (!cleanQr) {
            return res.status(400).json({ message: 'Vui lòng nhập hoặc quét mã QR bản sao sách' });
        }

        const targetLocation = normalizeLocationString(rawTarget || 'Phòng 01 - Kệ 01 - Ngăn 01');

        const [rows] = await db.execute(`
            SELECT bc.id as copy_id, bc.qr_code, bc.status as copy_status,
                   b.id as book_id, b.title as book_title, b.isbn, b.cover_image,
                   COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as raw_location,
                   a.name as author_name, c.name as category_name,
                   br.id as active_borrow_id, u.full_name as borrower_name, u.card_number as borrower_card_number
            FROM book_copies bc
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN borrow_records br ON bc.id = br.book_copy_id AND br.status = 'borrowing'
            LEFT JOIN users u ON br.user_id = u.id
            WHERE LOWER(bc.qr_code) = LOWER(?)
               OR bc.id = ?
               OR LOWER(b.isbn) = LOWER(?)
            LIMIT 1
        `, [cleanQr, parseInt(cleanQr, 10) || 0, cleanQr]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: `Không tìm thấy bản sao sách nào khớp với mã [${cleanQr}] trong kho dữ liệu!`
            });
        }

        const copy = rows[0];
        const actualLocation = normalizeLocationString(copy.raw_location);
        const isCorrectLocation = actualLocation === targetLocation;

        const scannedItem = {
            copy_id: copy.copy_id,
            qr_code: copy.qr_code,
            copy_status: copy.copy_status,
            book_id: copy.book_id,
            book_title: copy.book_title,
            isbn: copy.isbn,
            cover_image: copy.cover_image,
            author_name: copy.author_name || 'Chưa rõ tác giả',
            category_name: copy.category_name || 'Chưa phân loại',
            actual_location: actualLocation,
            scanned_at_location: targetLocation,
            scanned_timestamp: new Date().toISOString(),
            borrower_name: copy.borrower_name || null,
            borrower_card_number: copy.borrower_card_number || null,
            audit_group: isCorrectLocation ? 'correct' : 'misplaced',
            instruction: isCorrectLocation
                ? `✅ Đúng vị trí (${actualLocation})`
                : `⚠️ Sách để nhầm kệ! Cuốn này thuộc [${actualLocation}] → Cần mang từ [${targetLocation}] về đúng [${actualLocation}]`
        };

        res.status(200).json({
            auditGroup: scannedItem.audit_group,
            message: scannedItem.instruction,
            item: scannedItem
        });
    } catch (error) {
        console.error('Lỗi khi quét kiểm kê bản sao sách:', error);
        res.status(500).json({ message: 'Lỗi server khi quét kiểm kê bản sao sách' });
    }
};

// =============================================================================
// NHẬP BỔ SUNG BẢN SAO NHANH (QUICK RESTOCK COPIES FOR BOTTLENECK BOOKS)
// POST /api/books/:id/restock
// Body: { additionalCopies: number }
// =============================================================================
exports.restockBookCopies = async (req, res) => {
    const bookId = parseInt(req.params.id, 10);
    const additionalCopies = Math.max(1, Math.min(50, parseInt(req.body.additionalCopies, 10) || 1));
    const userId = req.user?.id || null;

    if (!bookId) {
        return res.status(400).json({ message: 'ID đầu sách không hợp lệ' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [books] = await connection.execute(
            'SELECT id, title, total_copies, available_copies, location FROM books WHERE id = ? FOR UPDATE',
            [bookId]
        );

        if (books.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy đầu sách cần nhập bổ sung' });
        }

        const book = books[0];

        // Tìm chỉ số bản sao hiện tại để sinh mã QR tiếp theo (QR-BK-{id}-{n})
        const [existingCopies] = await connection.execute(
            'SELECT qr_code FROM book_copies WHERE book_id = ?',
            [bookId]
        );

        let maxSeq = existingCopies.length;
        for (const c of existingCopies) {
            const m = String(c.qr_code || '').match(/(\d+)$/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > maxSeq && n < 10000) maxSeq = n;
            }
        }

        const generatedQrCodes = [];
        for (let i = 1; i <= additionalCopies; i++) {
            const seq = maxSeq + i;
            const qrCode = `QR-BK-${bookId}-${seq}`;
            await connection.execute(
                'INSERT INTO book_copies (book_id, qr_code, status) VALUES (?, ?, "available")',
                [bookId, qrCode]
            );
            generatedQrCodes.push(qrCode);
        }

        await connection.execute(
            'UPDATE books SET total_copies = total_copies + ?, available_copies = available_copies + ? WHERE id = ?',
            [additionalCopies, additionalCopies, bookId]
        );

        if (userId) {
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, details) VALUES (?, ?, ?, ?)',
                [
                    userId,
                    'SMART_RESTOCK',
                    'books',
                    `Nhập bổ sung +${additionalCopies} bản sao cho «${book.title}» (${generatedQrCodes.join(', ')})`
                ]
            );
        }

        await connection.commit();

        // Tự động đồng bộ hàng đợi đặt trước nếu có độc giả đang chờ cuốn sách này
        try {
            const { syncWaitingReservationsWithStock } = require('./reservationController');
            if (typeof syncWaitingReservationsWithStock === 'function') {
                await syncWaitingReservationsWithStock(bookId);
            }
        } catch (syncErr) {
            // Non-blocking
        }

        res.status(200).json({
            message: `Đã nhập bổ sung +${additionalCopies} bản sao mới cho «${book.title}» (${generatedQrCodes.join(', ')})!`,
            bookId,
            title: book.title,
            addedCopies: additionalCopies,
            newTotalCopies: Number(book.total_copies) + additionalCopies,
            generatedQrCodes
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi nhập bổ sung bản sao sách:', error);
        res.status(500).json({ message: 'Lỗi server khi nhập bổ sung bản sao sách' });
    } finally {
        connection.release();
    }
};

