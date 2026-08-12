const db = require('./config/db');
const bcrypt = require('bcrypt');

async function seed() {
    console.log('🚀 Bắt đầu seeding dữ liệu toàn diện cho Smart Library...');

    try {
        // 1. Clear existing data safely
        console.log('🧹 Đang làm sạch dữ liệu cũ...');
        await db.execute('SET FOREIGN_KEY_CHECKS = 0');
        await db.execute('TRUNCATE TABLE activity_logs');
        await db.execute('TRUNCATE TABLE read_history');
        await db.execute('TRUNCATE TABLE reviews');
        await db.execute('TRUNCATE TABLE notifications');
        await db.execute('TRUNCATE TABLE fines');
        await db.execute('TRUNCATE TABLE borrow_records');
        await db.execute('TRUNCATE TABLE reservations');
        await db.execute('TRUNCATE TABLE book_copies');
        await db.execute('TRUNCATE TABLE books');
        await db.execute('TRUNCATE TABLE categories');
        await db.execute('TRUNCATE TABLE authors');
        await db.execute('TRUNCATE TABLE publishers');
        await db.execute('TRUNCATE TABLE users');
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');

        // 2. Seed Users
        console.log('👤 Seeding danh sách người dùng...');
        const adminHash = await bcrypt.hash('admin123', 10);
        const standardHash = await bcrypt.hash('123456', 10);

        const usersData = [
            [1, 'Administrator', 'admin@library.com', adminHash, 'admin', '0901111222', 'LIB-AD-000001', '2030-12-31', 'active'],
            [2, 'Trần Thủ Thư', 'librarian@library.com', standardHash, 'librarian', '0902222333', 'LIB-LB-000001', '2028-12-31', 'active'],
            [3, 'Lê Thi Phương', 'phuong.thuthu@library.com', standardHash, 'librarian', '0903333444', 'LIB-LB-000002', '2028-12-31', 'active'],
            [4, 'Nguyễn Minh Anh', 'reader@library.com', standardHash, 'reader', '0904444555', 'LIB-RD-100001', '2027-06-30', 'active'],
            [5, 'Phạm Hoàng Nam', 'hoang.nam@gmail.com', standardHash, 'reader', '0905555666', 'LIB-RD-100002', '2027-06-30', 'active'],
            [6, 'Vũ Thu Trang', 'thu.trang@gmail.com', standardHash, 'reader', '0906666777', 'LIB-RD-100003', '2027-06-30', 'active'],
            [7, 'Đỗ Đức Hiếu', 'duc.hieu@gmail.com', standardHash, 'reader', '0907777888', 'LIB-RD-100004', '2027-06-30', 'active'],
            [8, 'Bùi Lan Hương', 'lan.huong@gmail.com', standardHash, 'reader', '0908888999', 'LIB-RD-100005', '2027-06-30', 'pending']
        ];

        for (const u of usersData) {
            await db.execute(
                `INSERT INTO users (id, full_name, email, password_hash, role, phone, card_number, card_expiry, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                u
            );
        }

        // 3. Seed Categories
        console.log('🏷️ Seeding thể loại sách...');
        const categoriesData = [
            [1, 'Văn học', null, 'Tiểu thuyết, truyện ngắn, thơ ca Việt Nam và thế giới'],
            [2, 'Khoa học & Công nghệ', null, 'Vũ trụ học, vật lý, sinh học, CNTT và Trí tuệ nhân tạo AI'],
            [3, 'Kinh tế & Quản trị', null, 'Kinh doanh, tiếp thị, tài chính cá nhân, khởi nghiệp và quản trị'],
            [4, 'Kỹ năng & Phát triển', null, 'Phát triển bản thân, tư duy phản biện, nghệ thuật giao tiếp'],
            [5, 'Lịch sử & Triết học', null, 'Lịch sử Việt Nam, văn minh thế giới và triết học ứng dụng'],
            [6, 'Thiếu nhi & Tuổi trẻ', null, 'Truyện tranh, sách kỹ năng và khám phá cho lứa tuổi thiếu niên']
        ];

        for (const c of categoriesData) {
            await db.execute('INSERT INTO categories (id, name, parent_id, description) VALUES (?, ?, ?, ?)', c);
        }

        // 4. Seed Authors
        console.log('✍️ Seeding tác giả...');
        const authorsData = [
            [1, 'Nguyễn Nhật Ánh', 'Nhà văn gạo cội của văn học thanh thiếu niên Việt Nam với hàng loạt tác phẩm kinh điển.', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'],
            [2, 'Stephen Hawking', 'Nhà vật lý lý thuyết, vũ trụ học vĩ đại người Anh, nguyên Giáo sư Lucas tại Đại học Cambridge.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200'],
            [3, 'Dale Carnegie', 'Tác giả huyền thoại về phát triển bản thân và nghệ thuật giao tiếp người Mỹ.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200'],
            [4, 'Haruki Murakami', 'Nhà văn hiện đại nổi tiếng người Nhật Bản với phong cách hiện thực huyền ảo.', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200'],
            [5, 'Walter Isaacson', 'Nhà tiểu sử học hàng đầu thế giới, tác giả các cuốn tiểu sử bán chạy về Steve Jobs, Elon Musk.', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200'],
            [6, 'Nguyễn Du', 'Đại thi hào dân tộc Việt Nam, Danh nhân văn hóa thế giới, tác giả tác phẩm Truyện Kiều.', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200'],
            [7, 'James Clear', 'Tác giả sách bán chạy nhất New York Times về thay đổi thói quen và tối ưu hóa bản thân.', 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=200']
        ];

        for (const a of authorsData) {
            await db.execute('INSERT INTO authors (id, name, bio, image_url) VALUES (?, ?, ?, ?)', a);
        }

        // 5. Seed Publishers
        console.log('🏢 Seeding nhà xuất bản...');
        const publishersData = [
            [1, 'NXB Trẻ', '161B Lý Chính Thắng, Q.3, TP. Hồ Chí Minh', 'contact@nxbtre.com.vn'],
            [2, 'NXB Hội Nhà Văn', '65 Nguyễn Du, Hai Bà Trưng, Hà Nội', 'hoinhavan@nxb.vn'],
            [3, 'NXB Kim Đồng', '55 Quang Trung, Hai Bà Trưng, Hà Nội', 'info@nxbkimdong.com.vn'],
            [4, 'NXB Tri Thức', '53 Nguyễn Du, Hai Bà Trưng, Hà Nội', 'trithuc@nxbtrithuc.com.vn'],
            [5, 'NXB Thế Giới', '46 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội', 'thegioi@nxbthegioi.vn']
        ];

        for (const p of publishersData) {
            await db.execute('INSERT INTO publishers (id, name, address, contact_email) VALUES (?, ?, ?, ?)', p);
        }

        // 6. Seed Books
        console.log('📚 Seeding đầu sách...');
        const booksData = [
            { id: 1, title: 'Mắt Biếc', author_id: 1, publisher_id: 1, category_id: 1, isbn: '978-604-1-15234-8', published_year: 2019, description: 'Tác phẩm lãng mạn kinh điển về tình yêu tuổi học trò giữa Ngạn và Hà Lan.', cover_image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400', total: 5 },
            { id: 2, title: 'Lược Sử Thời Gian', author_id: 2, publisher_id: 1, category_id: 2, isbn: '978-604-1-08912-5', published_year: 2018, description: 'Hành trình khám phá không gian, thời gian, hố đen và nguồn gốc của vũ trụ.', cover_image: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=400', total: 4 },
            { id: 3, title: 'Đắc Nhân Tâm', author_id: 3, publisher_id: 2, category_id: 4, isbn: '978-604-53-4821-3', published_year: 2020, description: 'Nghệ thuật ứng xử, thu phục lòng người và xây dựng mối quan hệ bền vững.', cover_image: 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400', total: 6 },
            { id: 4, title: 'Lập trình Node.js & React Thực Chiến', author_id: 5, publisher_id: 4, category_id: 2, isbn: '978-604-89-1234-0', published_year: 2024, description: 'Hướng dẫn từ cơ bản đến nâng cao xây dựng ứng dụng web hiện đại fullstack.', cover_image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400', total: 4 },
            { id: 5, title: 'Rừng Na Uy', author_id: 4, publisher_id: 2, category_id: 1, isbn: '978-604-964-112-9', published_year: 2021, description: 'Tiểu thuyết lừng danh về ký ức, tình yêu và những hoài niệm tuổi trẻ ở Tokyo.', cover_image: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400', total: 3 },
            { id: 6, title: 'Atomic Habits - Thói Quen Nguyên Tử', author_id: 7, publisher_id: 5, category_id: 4, isbn: '978-604-77-8910-1', published_year: 2022, description: 'Phương pháp thay đổi 1% mỗi ngày để tạo nên những kết quả phi thường.', cover_image: 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=400', total: 5 },
            { id: 7, title: 'Steve Jobs', author_id: 5, publisher_id: 4, category_id: 3, isbn: '978-604-98-3344-9', published_year: 2021, description: 'Cuốn tiểu sở độc quyền về cuộc đời vị sáng lập tài ba của Apple.', cover_image: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400', total: 3 },
            { id: 8, title: 'Truyện Kiều', author_id: 6, publisher_id: 2, category_id: 1, isbn: '978-604-56-1122-1', published_year: 2017, description: 'Kiệt tác thơ Nôm tài hoa của Đại thi hào Nguyễn Du.', cover_image: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400', total: 4 },
            { id: 9, title: 'Kính Vạn Hoa', author_id: 1, publisher_id: 3, category_id: 6, isbn: '978-604-2-23112-8', published_year: 2023, description: 'Bộ truyện học trò hồn nhiên, hài hước và giàu tình bạn của bộ ba Quý rố, Hạnh, Tiểu Long.', cover_image: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=400', total: 5 }
        ];

        // Insert books and create book copies
        const copyMap = {}; // store inserted copy IDs for later referencing in borrow_records
        for (const b of booksData) {
            await db.execute(
                `INSERT INTO books (id, title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, total_copies, available_copies) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [b.id, b.title, b.author_id, b.publisher_id, b.category_id, b.isbn, b.published_year, b.description, b.cover_image, b.total, b.total]
            );

            copyMap[b.id] = [];
            for (let i = 1; i <= b.total; i++) {
                const qrCode = `QR-BK-${b.id}-${i}`;
                const [res] = await db.execute(
                    'INSERT INTO book_copies (book_id, qr_code, status) VALUES (?, ?, "available")',
                    [b.id, qrCode]
                );
                copyMap[b.id].push({ copyId: res.insertId, qrCode });
            }
        }

        // 7. Seed Borrow Records & update copy statuses
        console.log('📖 Seeding phiếu mượn trả sách...');
        const now = new Date();
        const daysAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
        const daysAhead = (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);

        // Record 1: Reader 4 borrows Book 1 Copy 1 (Active borrow)
        const copy1_1 = copyMap[1][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, status, processed_by) 
             VALUES (1, 4, ?, ?, ?, 'borrowing', 2)`,
            [copy1_1, daysAgo(10), daysAhead(4)]
        );
        await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy1_1]);

        // Record 2: Reader 5 borrows Book 2 Copy 1 (Overdue borrow)
        const copy2_1 = copyMap[2][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, status, processed_by) 
             VALUES (2, 5, ?, ?, ?, 'borrowing', 2)`,
            [copy2_1, daysAgo(20), daysAhead(-6)] // due 6 days ago
        );
        await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy2_1]);

        // Record 3: Reader 6 borrows Book 3 Copy 1 (Returned)
        const copy3_1 = copyMap[3][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, return_date, status, processed_by) 
             VALUES (3, 6, ?, ?, ?, ?, 'returned', 3)`,
            [copy3_1, daysAgo(30), daysAhead(-16), daysAgo(2)]
        );

        // Record 4: Reader 7 borrows Book 4 Copy 1 (Active borrow)
        const copy4_1 = copyMap[4][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, status, processed_by) 
             VALUES (4, 7, ?, ?, ?, 'borrowing', 2)`,
            [copy4_1, daysAgo(5), daysAhead(9)]
        );
        await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy4_1]);

        // Record 5: Reader 4 borrows Book 5 Copy 1 (Overdue borrow)
        const copy5_1 = copyMap[5][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, status, processed_by) 
             VALUES (5, 4, ?, ?, ?, 'borrowing', 3)`,
            [copy5_1, daysAgo(18), daysAhead(-4)]
        );
        await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id = ?', [copy5_1]);

        // Record 6: Reader 5 borrows Book 6 Copy 1 (Returned with past fine)
        const copy6_1 = copyMap[6][0].copyId;
        await db.execute(
            `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, return_date, status, processed_by) 
             VALUES (6, 5, ?, ?, ?, ?, 'returned', 2)`,
            [copy6_1, daysAgo(40), daysAhead(-26), daysAgo(20)]
        );

        // Record 7: Damaged copy setup (Book 9 Copy 5)
        const copy9_5 = copyMap[9][4].copyId;
        await db.execute('UPDATE book_copies SET status = "damaged", condition_note = "Sách bị rách trang bìa sau" WHERE id = ?', [copy9_5]);

        // Recalculate available_copies for each book
        for (const b of booksData) {
            await db.execute(
                `UPDATE books SET available_copies = (
                    SELECT COUNT(*) FROM book_copies WHERE book_id = ? AND status = 'available'
                ) WHERE id = ?`,
                [b.id, b.id]
            );
        }

        // 8. Seed Fines
        console.log('💸 Seeding danh sách phạt...');
        const finesData = [
            [1, 2, 5, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Lược Sử Thời Gian)', 'unpaid', daysAgo(6), null],
            [2, 5, 4, 20000.00, 'Quá hạn trả sách 4 ngày (Sách: Rừng Na Uy)', 'unpaid', daysAgo(4), null],
            [3, 6, 5, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Atomic Habits)', 'paid', daysAgo(20), daysAgo(20)]
        ];

        for (const f of finesData) {
            await db.execute(
                `INSERT INTO fines (id, borrow_record_id, user_id, amount, reason, status, created_at, paid_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                f
            );
        }

        // 9. Seed Reservations
        console.log('📌 Seeding yêu cầu đặt trước sách...');
        const reservationsData = [
            [1, 4, 2, daysAgo(3), 'pending'],
            [2, 5, 5, daysAgo(5), 'ready'],
            [3, 6, 6, daysAgo(10), 'fulfilled'],
            [4, 7, 1, daysAgo(1), 'pending']
        ];

        for (const r of reservationsData) {
            await db.execute(
                'INSERT INTO reservations (id, user_id, book_id, reservation_date, status) VALUES (?, ?, ?, ?, ?)',
                r
            );
        }

        // 10. Seed Reviews & Update avg_rating
        console.log('⭐ Seeding đánh giá sách...');
        const reviewsData = [
            [1, 4, 1, 5, 'Một cuốn sách tuyệt vời gắn liền với tuổi thơ, kết thúc gợi nhiều suy ngẫm.', daysAgo(8)],
            [2, 5, 2, 5, 'Kiến thức vũ trụ rất sâu sắc nhưng tác giả diễn đạt khá dễ hiểu cho người mới bắt đầu.', daysAgo(15)],
            [3, 6, 3, 4, 'Tác phẩm kinh điển về kỹ năng ứng xử và thấu hiểu con người.', daysAgo(25)],
            [4, 7, 4, 5, 'Tài liệu thực hành lập trình Node.js và React rất rõ ràng, thực tế.', daysAgo(3)],
            [5, 4, 6, 5, 'Thói quen nhỏ mang lại sự thay đổi lớn, cuốn sách thực sự thay đổi tư duy làm việc của tôi.', daysAgo(12)]
        ];

        for (const rev of reviewsData) {
            await db.execute(
                'INSERT INTO reviews (id, user_id, book_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                rev
            );
        }

        // Update avg_rating in books table
        for (const b of booksData) {
            await db.execute(
                `UPDATE books SET avg_rating = COALESCE((
                    SELECT AVG(rating) FROM reviews WHERE book_id = ?
                ), 0.00) WHERE id = ?`,
                [b.id, b.id]
            );
        }

        // 11. Seed Notifications
        console.log('🔔 Seeding thông báo...');
        const notificationsData = [
            [1, 4, 'Chào mừng đến với Smart Library!', 'Chúc mừng bạn đã kích hoạt thẻ thư viện trực tuyến thành công. Thẻ của bạn: LIB-RD-100001.', 'info', 1, daysAgo(10)],
            [2, 4, 'Cảnh báo quá hạn mượn sách', 'Sách "Rừng Na Uy" của bạn đã quá hạn 4 ngày. Vui lòng làm thủ tục trả sách hoặc gia hạn.', 'warning', 0, daysAgo(4)],
            [3, 5, 'Thông báo phạt trễ hạn', 'Bạn có khoản phí phạt 30,000đ cho cuốn "Lược Sử Thời Gian". Vui lòng thanh toán tại quầy.', 'warning', 0, daysAgo(6)],
            [4, 5, 'Sách đặt trước đã sẵn sàng', 'Cuốn sách "Rừng Na Uy" bạn đặt trước đã có mặt tại quầy. Vui lòng đến nhận trong 48 giờ.', 'reminder', 0, daysAgo(2)]
        ];

        for (const n of notificationsData) {
            await db.execute(
                `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                n
            );
        }

        // 12. Seed Activity Logs
        console.log('📋 Seeding nhật ký hoạt động...');
        const activityLogsData = [
            [1, 1, 'SYSTEM_INIT', 'system', 0, 'Khởi tạo thành công cơ sở dữ liệu Smart Library.', daysAgo(30)],
            [2, 2, 'BORROW', 'borrow_records', 1, 'Cho độc giả Nguyễn Minh Anh mượn sách "Mắt Biếc".', daysAgo(10)],
            [3, 2, 'BORROW', 'borrow_records', 2, 'Cho độc giả Phạm Hoàng Nam mượn sách "Lược Sử Thời Gian".', daysAgo(20)],
            [4, 3, 'RETURN', 'borrow_records', 3, 'Xác nhận trả sách "Đắc Nhân Tâm" cho độc giả Vũ Thu Trang.', daysAgo(2)],
            [5, 4, 'RESERVE', 'reservations', 1, 'Độc giả Nguyễn Minh Anh đăng ký đặt trước cuốn "Lược Sử Thời Gian".', daysAgo(3)],
            [6, 2, 'CREATE_BOOK', 'books', 4, 'Thêm mới đầu sách "Lập trình Node.js & React Thực Chiến".', daysAgo(15)]
        ];

        for (const log of activityLogsData) {
            await db.execute(
                `INSERT INTO activity_logs (id, user_id, action, target_type, target_id, details, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                log
            );
        }

        // 13. System configs check & update
        await db.execute('UPDATE system_configs SET description = "Số ngày mượn tối đa cho mỗi sách" WHERE key_name = "max_borrow_days"');

        console.log('\n==================================================');
        console.log('✅ HỆ THỐNG ĐÃ SEED DỮ LIỆU MẪU THÀNH CÔNG!');
        console.log('==================================================');
        console.log('📌 Danh sách tài khoản đăng nhập mẫu:');
        console.log('1. Admin:      email: admin@library.com     | password: admin123');
        console.log('2. Thủ thư 1:  email: librarian@library.com | password: 123456');
        console.log('3. Thủ thư 2:  email: phuong.thuthu@library.com | password: 123456');
        console.log('4. Độc giả 1:  email: reader@library.com    | password: 123456');
        console.log('5. Độc giả 2:  email: hoang.nam@gmail.com   | password: 123456');
        console.log('==================================================\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi khi seeding dữ liệu:', error);
        process.exit(1);
    }
}

seed();
