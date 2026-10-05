const db = require('./config/db');
const bcrypt = require('bcrypt');

async function seed() {
    console.log('🚀 Bắt đầu seeding dữ liệu chuẩn hóa cho Smart Library...');

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
        await db.execute('CREATE TABLE IF NOT EXISTS config_change_requests (id INT AUTO_INCREMENT PRIMARY KEY, key_name VARCHAR(100) NOT NULL, current_value TEXT, proposed_value TEXT NOT NULL, reason TEXT, requested_by INT NOT NULL, status ENUM("pending", "approved", "rejected") DEFAULT "pending", reviewed_by INT NULL, reviewed_at DATETIME NULL, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL)');
        await db.execute('TRUNCATE TABLE config_change_requests');
        await db.execute('TRUNCATE TABLE system_configs');
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');

        // 2. System Configs
        console.log('⚙️ Seeding cấu hình hệ thống...');
        await db.execute(`
            INSERT INTO system_configs (key_name, value, description) VALUES
            ('max_borrow_days', '14', 'Số ngày mượn tối đa cho mỗi sách'),
            ('fine_per_day', '5000', 'Số tiền phạt mỗi ngày trễ hạn (VNĐ)'),
            ('max_books_per_user', '5', 'Số lượng sách tối đa một độc giả được mượn (chưa trả)')
        `);

        // 3. Seed Users (4 Vai trò chuẩn: Admin, Librarian, Reader, Owner)
        console.log('👤 Seeding danh sách 4 người dùng chuẩn hóa...');
        const adminHash = await bcrypt.hash('admin123', 10);
        const standardHash = await bcrypt.hash('123456', 10);

        const usersData = [
            [1, 'Administrator', 'admin@library.com', adminHash, 'admin', '0901111222', 'LIB-AD-000001', '2030-12-31', 'active'],
            [2, 'Trần Thủ Thư', 'librarian@library.com', standardHash, 'librarian', '0902222333', 'LIB-LB-000001', '2028-12-31', 'active'],
            [3, 'Nguyễn Minh A', 'reader@library.com', standardHash, 'reader', '0904444555', 'LIB-RD-100001', '2027-06-30', 'active'],
            [4, 'Trần Văn Chủ', 'owner@library.com', standardHash, 'owner', '0909999000', 'LIB-OW-000001', '2030-12-31', 'active']
        ];

        for (const u of usersData) {
            await db.execute(
                `INSERT INTO users (id, full_name, email, password_hash, role, phone, card_number, card_expiry, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                u
            );
        }

        // 4. Seed Config Change Requests
        console.log('📝 Seeding đề xuất cấu hình mẫu (Maker - Checker)...');
        await db.execute(
            `INSERT INTO config_change_requests (id, key_name, current_value, proposed_value, reason, requested_by, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [1, 'fine_per_day', '5000', '10000', 'Đề xuất tăng phí phạt theo quý mới nhằm giảm tỷ lệ trả sách trễ hạn', 1, 'pending']
        );

        // 5. Seed Categories
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

        // 6. Seed Authors
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

        // 7. Seed Publishers
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

        // 8. Seed Books
        console.log('📚 Seeding đầu sách...');
        const booksData = [
            [1, 'Mắt Biếc', 1, 1, 1, '978-604-1-15234-8', 2019, 'Tác phẩm lãng mạn kinh điển về tình yêu tuổi học trò giữa Ngạn và Hà Lan.', 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400', 5, 4, 5.00],
            [2, 'Lược Sử Thời Gian', 2, 1, 2, '978-604-1-08912-5', 2018, 'Hành trình khám phá không gian, thời gian, hố đen và nguồn gốc của vũ trụ.', 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=400', 4, 3, 5.00],
            [3, 'Đắc Nhân Tâm', 3, 2, 4, '978-604-53-4821-3', 2020, 'Nghệ thuật ứng xử, thu phục lòng người và xây dựng mối quan hệ bền vững.', 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400', 6, 6, 4.00],
            [4, 'Lập trình Node.js & React Thực Chiến', 5, 4, 2, '978-604-89-1234-0', 2024, 'Hướng dẫn từ cơ bản đến nâng cao xây dựng ứng dụng web hiện đại fullstack.', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400', 4, 3, 5.00],
            [5, 'Rừng Na Uy', 4, 2, 1, '978-604-964-112-9', 2021, 'Tiểu thuyết lừng danh về ký ức, tình yêu và những hoài niệm tuổi trẻ ở Tokyo.', 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400', 3, 2, 0.00],
            [6, 'Atomic Habits - Thói Quen Nguyên Tử', 7, 5, 4, '978-604-77-8910-1', 2022, 'Phương pháp thay đổi 1% mỗi ngày để tạo nên những kết quả phi thường.', 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=400', 5, 5, 5.00],
            [7, 'Steve Jobs', 5, 4, 3, '978-604-98-3344-9', 2021, 'Cuốn tiểu sử độc quyền về cuộc đời vị sáng lập tài ba của Apple.', 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400', 3, 3, 0.00],
            [8, 'Truyện Kiều', 6, 2, 1, '978-604-56-1122-1', 2017, 'Kiệt tác thơ Nôm tài hoa của Đại thi hào Nguyễn Du.', 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400', 4, 4, 0.00],
            [9, 'Kính Vạn Hoa', 1, 3, 6, '978-604-2-23112-8', 2023, 'Bộ truyện học trò hồn nhiên, hài hước và giàu tình bạn.', 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=400', 5, 4, 0.00]
        ];

        for (const b of booksData) {
            await db.execute(
                `INSERT INTO books (id, title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, total_copies, available_copies, avg_rating) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                b
            );
        }

        // 9. Seed Book Copies
        console.log('🏷️ Seeding bản sao sách (mã QR)...');
        let copyId = 1;
        for (const b of booksData) {
            const count = b[9];
            for (let i = 1; i <= count; i++) {
                const qr = `QR-BK-${b[0]}-${i}`;
                await db.execute(
                    'INSERT INTO book_copies (id, book_id, qr_code, status) VALUES (?, ?, ?, "available")',
                    [copyId++, b[0], qr]
                );
            }
        }

        // Đánh dấu một số bản sao đang mượn và hỏng
        await db.execute('UPDATE book_copies SET status = "borrowed" WHERE id IN (1, 6, 16, 20)');
        await db.execute('UPDATE book_copies SET status = "damaged", condition_note = "Sách bị rách trang bìa sau" WHERE id = 39');

        // 10. Seed Borrow Records (Gắn vào user_id = 3 - Nguyễn Minh A, processed_by = 2 - Thủ thư)
        console.log('📖 Seeding phiếu mượn trả...');
        const now = new Date();
        const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
        const daysLater = (d) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

        const borrowData = [
            [1, 3, 1, daysAgo(10), daysLater(4), null, 'borrowing', 2],
            [2, 3, 6, daysAgo(20), daysAgo(6), null, 'borrowing', 2],
            [3, 3, 10, daysAgo(30), daysAgo(16), daysAgo(2), 'returned', 2],
            [4, 3, 16, daysAgo(5), daysLater(9), null, 'borrowing', 2],
            [5, 3, 20, daysAgo(18), daysAgo(4), null, 'borrowing', 2],
            [6, 3, 23, daysAgo(40), daysAgo(26), daysAgo(20), 'returned', 2]
        ];

        for (const br of borrowData) {
            await db.execute(
                `INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, return_date, status, processed_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                br
            );
        }

        // 11. Seed Fines (Gắn vào user_id = 3)
        console.log('💸 Seeding danh sách phạt...');
        const finesData = [
            [1, 2, 3, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Lược Sử Thời Gian)', 'unpaid', daysAgo(6), null],
            [2, 5, 3, 20000.00, 'Quá hạn trả sách 4 ngày (Sách: Rừng Na Uy)', 'unpaid', daysAgo(4), null],
            [3, 6, 3, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Atomic Habits)', 'paid', daysAgo(20), daysAgo(20)]
        ];

        for (const f of finesData) {
            await db.execute(
                `INSERT INTO fines (id, borrow_record_id, user_id, amount, reason, status, created_at, paid_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                f
            );
        }

        // 12. Seed Reservations (Gắn vào user_id = 3)
        console.log('📌 Seeding đặt trước sách...');
        const reservationsData = [
            [1, 3, 2, daysAgo(3), 'pending'],
            [2, 3, 5, daysAgo(5), 'ready'],
            [3, 3, 6, daysAgo(10), 'fulfilled'],
            [4, 3, 1, daysAgo(1), 'pending']
        ];

        for (const r of reservationsData) {
            await db.execute(
                'INSERT INTO reservations (id, user_id, book_id, reservation_date, status) VALUES (?, ?, ?, ?, ?)',
                r
            );
        }

        // 13. Seed Reviews (Gắn vào user_id = 3)
        console.log('⭐ Seeding đánh giá sách...');
        const reviewsData = [
            [1, 3, 1, 5, 'Một cuốn sách tuyệt vời gắn liền với tuổi thơ, kết thúc gợi nhiều suy ngẫm.', daysAgo(8)],
            [2, 3, 2, 5, 'Kiến thức vũ trụ rất sâu sắc nhưng tác giả diễn đạt khá dễ hiểu cho người mới bắt đầu.', daysAgo(15)],
            [3, 3, 3, 4, 'Tác phẩm kinh điển về kỹ năng ứng xử và thấu hiểu con người.', daysAgo(25)],
            [4, 3, 4, 5, 'Tài liệu thực hành lập trình Node.js và React rất rõ ràng, thực tế.', daysAgo(3)],
            [5, 3, 6, 5, 'Thói quen nhỏ mang lại sự thay đổi lớn, cuốn sách thực sự thay đổi tư duy làm việc của tôi.', daysAgo(12)]
        ];

        for (const rev of reviewsData) {
            await db.execute(
                'INSERT INTO reviews (id, user_id, book_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                rev
            );
        }

        // 14. Seed Notifications (Đầy đủ cho mọi Actor: Admin, Thủ thư, Độc giả, Chủ thư viện)
        console.log('🔔 Seeding thông báo cho tất cả các Actor...');
        const notificationsData = [
            // Admin (user_id = 1)
            [1, 1, 'Hệ thống Smart Library đã sẵn sàng', 'Chào mừng Quản trị viên. Toàn bộ các dịch vụ mượn trả, tra cứu và Maker-Checker đang hoạt động bình thường.', 'info', 1, daysAgo(10)],
            [2, 1, 'Cảnh báo sách quá hạn định kỳ', 'Hệ thống ghi nhận có độc giả mượn sách quá hạn cần đôn đốc thu hồi và nộp phạt.', 'warning', 0, daysAgo(2)],
            [3, 1, 'Đề xuất cấu hình gửi tới Giám đốc', 'Đề xuất thay đổi tham số mức phí phạt trễ hạn đã được gửi tới Giám đốc / Chủ thư viện.', 'info', 0, daysAgo(1)],
            
            // Librarian (user_id = 2)
            [4, 2, 'Ca làm việc thủ thư kích hoạt', 'Chào mừng Thủ thư. Bạn có thể sử dụng tính năng quét mã QR để xuất nhập mượn trả sách nhanh chóng.', 'info', 1, daysAgo(10)],
            [5, 2, 'Độc giả mượn sách tại quầy', 'Độc giả Trần Kim Liên (LIB-RD-000005) vừa mượn cuốn "Lập trình Node.js & React Thực Chiến" (Mã bản sao: QR-BK-4-1). Hạn trả sách: 14 ngày.', 'info', 0, daysAgo(2)],
            [6, 2, 'Độc giả đặt trước sách mới', 'Độc giả vừa tạo phiếu đặt trước cuốn sách "Mắt Biếc". Vui lòng kiểm tra và chuẩn bị sách tại quầy.', 'reminder', 0, daysAgo(2)],
            [7, 2, 'Ghi nhận hoàn tất trả sách', 'Độc giả đã hoàn tất trả sách "Đắc Nhân Tâm" vào kho thư viện.', 'info', 0, daysAgo(1)],

            // Reader (user_id = 3)
            [7, 3, 'Chào mừng đến với Smart Library!', 'Chúc mừng bạn đã kích hoạt thẻ thư viện trực tuyến thành công. Thẻ của bạn: LIB-RD-100001.', 'info', 1, daysAgo(10)],
            [8, 3, 'Cảnh báo quá hạn mượn sách', 'Sách "Rừng Na Uy" của bạn đã quá hạn 4 ngày. Vui lòng làm thủ tục trả sách hoặc gia hạn.', 'warning', 0, daysAgo(4)],
            [9, 3, 'Thông báo phạt trễ hạn', 'Bạn có khoản phí phạt 30,000đ cho cuốn "Lược Sử Thời Gian". Vui lòng thanh toán tại quầy.', 'warning', 0, daysAgo(6)],
            [10, 3, 'Sách đặt trước đã sẵn sàng', 'Cuốn sách "Rừng Na Uy" bạn đặt trước đã có mặt tại quầy. Vui lòng đến nhận trong 48 giờ.', 'reminder', 0, daysAgo(2)],

            // Owner (user_id = 4)
            [11, 4, 'Quyền Giám đốc / Chủ thư viện', 'Chào mừng Chủ thư viện. Bạn có toàn quyền giám sát toàn bộ hoạt động lưu thông, tài chính và phê duyệt Maker-Checker.', 'info', 1, daysAgo(10)],
            [12, 4, 'Đề xuất thay đổi quy chế mới (Maker-Checker)', 'Admin vừa đề xuất điều chỉnh tham số phí phạt trễ hạn "fine_per_day". Vui lòng vào mục Quản lý hệ thống để phê duyệt.', 'reminder', 0, daysAgo(1)],
            [13, 4, 'Báo cáo doanh thu & lưu thông định kỳ', 'Tổng lượt mượn sách và doanh thu thu phạt đã được cập nhật tại mục Thống kê & Báo cáo.', 'info', 0, daysAgo(0)]
        ];

        for (const n of notificationsData) {
            await db.execute(
                `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                n
            );
        }

        // 15. Seed Activity Logs
        console.log('📋 Seeding nhật ký hoạt động...');
        const activityLogsData = [
            [1, 1, 'SYSTEM_INIT', 'system', null, 'Khởi tạo thành công cơ sở dữ liệu Smart Library.', daysAgo(30)],
            [2, 2, 'BORROW', 'borrow_records', 1, 'Cho độc giả Nguyễn Minh A mượn sách "Mắt Biếc".', daysAgo(10)],
            [3, 2, 'RETURN', 'borrow_records', 3, 'Thủ thư nhận trả sách "Đắc Nhân Tâm" cho độc giả Nguyễn Minh A.', daysAgo(2)],
            [4, 1, 'PROPOSE_CONFIG', 'config_change_requests', 1, 'Admin gửi đề xuất tăng fine_per_day lên 10.000đ', daysAgo(1)],
            [5, 4, 'SYSTEM_LOGIN', 'users', 4, 'Chủ thư viện Trần Văn Chủ đăng nhập kiểm toán hệ thống.', daysAgo(0)]
        ];

        for (const log of activityLogsData) {
            await db.execute(
                `INSERT INTO activity_logs (id, user_id, action, target_type, target_id, details, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                log
            );
        }

        console.log('\n==================================================');
        console.log('✅ HỆ THỐNG ĐÃ SEED DỮ LIỆU MẪU CHUẨN HÓA THÀNH CÔNG!');
        console.log('==================================================');
        console.log('1. Admin:         admin@library.com     | admin123');
        console.log('2. Thủ thư:       librarian@library.com | 123456');
        console.log('3. Độc giả:       reader@library.com    | 123456');
        console.log('4. Chủ thư viện:  owner@library.com     | 123456');
        console.log('==================================================\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi khi seeding dữ liệu:', error);
        process.exit(1);
    }
}

seed();
