-- ========================================================
-- SMART LIBRARY - CƠ SỞ DỮ LIỆU & DỮ LIỆU MẪU (SCHEMA & SEED DATA)
-- Chuẩn hóa 4 vai trò: Admin, Librarian, Reader, Owner
-- ========================================================

CREATE DATABASE IF NOT EXISTS smart_library CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_library;

-- --------------------------------------------------------
-- 1. CẤU TRÚC CÁC BẢNG (TABLE STRUCTURE)
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    parent_id INT DEFAULT NULL,
    description TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS authors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    bio TEXT,
    image_url VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS publishers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    contact_email VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS books (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author_id INT,
    publisher_id INT,
    category_id INT,
    isbn VARCHAR(20) UNIQUE,
    published_year YEAR,
    description TEXT,
    cover_image VARCHAR(255),
    total_copies INT DEFAULT 0,
    available_copies INT DEFAULT 0,
    avg_rating DECIMAL(3,2) DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE SET NULL,
    FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS book_copies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    book_id INT NOT NULL,
    qr_code VARCHAR(255) UNIQUE NOT NULL,
    status ENUM('available', 'borrowed', 'lost', 'damaged') DEFAULT 'available',
    condition_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'librarian', 'reader', 'owner') DEFAULT 'reader',
    phone VARCHAR(20),
    avatar_url VARCHAR(255),
    card_number VARCHAR(20) UNIQUE,
    card_expiry DATE,
    status ENUM('active', 'locked', 'pending') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config_change_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    key_name VARCHAR(100) NOT NULL,
    current_value TEXT,
    proposed_value TEXT NOT NULL,
    reason TEXT,
    requested_by INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    review_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS borrow_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    book_copy_id INT NOT NULL,
    borrow_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATE NOT NULL,
    return_date DATETIME NULL,
    status ENUM('borrowing', 'returned', 'overdue') DEFAULT 'borrowing',
    processed_by INT NULL,
    note TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_copy_id) REFERENCES book_copies(id) ON DELETE CASCADE,
    FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    book_id INT NOT NULL,
    reservation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'ready', 'fulfilled', 'completed', 'cancelled') DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    borrow_record_id INT NOT NULL,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    reason TEXT,
    status ENUM('unpaid', 'paid') DEFAULT 'unpaid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME NULL,
    FOREIGN KEY (borrow_record_id) REFERENCES borrow_records(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'warning', 'reminder') DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    book_id INT NOT NULL,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS read_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    book_id INT NOT NULL,
    borrow_record_id INT NULL,
    read_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (borrow_record_id) REFERENCES borrow_records(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS system_configs (
    key_name VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(255) NOT NULL,
    target_type VARCHAR(50),
    target_id INT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- --------------------------------------------------------
-- 2. DỌN DẸP VÀ TÁI NẠP DỮ LIỆU MẪU (CLEAN & SEED DATA)
-- --------------------------------------------------------

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE activity_logs;
TRUNCATE TABLE read_history;
TRUNCATE TABLE reviews;
TRUNCATE TABLE notifications;
TRUNCATE TABLE fines;
TRUNCATE TABLE borrow_records;
TRUNCATE TABLE reservations;
TRUNCATE TABLE config_change_requests;
TRUNCATE TABLE book_copies;
TRUNCATE TABLE books;
TRUNCATE TABLE publishers;
TRUNCATE TABLE authors;
TRUNCATE TABLE categories;
TRUNCATE TABLE users;
TRUNCATE TABLE system_configs;

-- 2.1. CẤU HÌNH HỆ THỐNG (SYSTEM CONFIGS)
INSERT INTO system_configs (key_name, value, description) VALUES
('max_borrow_days', '14', 'Số ngày mượn tối đa cho mỗi sách'),
('fine_per_day', '5000', 'Số tiền phạt mỗi ngày trễ hạn (VNĐ)'),
('max_books_per_user', '3', 'Số lượng sách tối đa một độc giả được mượn cùng lúc');

-- 2.2. NGƯỜI DÙNG (USERS)
-- Mật khẩu mặc định:
-- admin@library.com -> admin123
-- Tất cả các tài khoản khác -> 123456
INSERT INTO users (id, full_name, email, password_hash, role, phone, card_number, card_expiry, status) VALUES
(1, 'Administrator', 'admin@library.com', '$2b$10$ldh/jWZc01Ya8VHdf1HFBO.yk08WvIfLT8vkDVIGfkp6AC6CnenXm', 'admin', '0901111222', 'LIB-AD-000001', '2030-12-31', 'active'),
(2, 'Trần Thủ Thư', 'librarian@library.com', '$2b$10$4.o7m82W01g7Zq7v9xY7m.E4cQd.5eX8u2z1v5y8A9b0c1d2e3f4g', 'librarian', '0902222333', 'LIB-LB-000001', '2028-12-31', 'active'),
(3, 'Nguyễn Minh A', 'reader@library.com', '$2b$10$4.o7m82W01g7Zq7v9xY7m.E4cQd.5eX8u2z1v5y8A9b0c1d2e3f4g', 'reader', '0904444555', 'LIB-RD-100001', '2027-06-30', 'active'),
(4, 'Trần Văn Chủ', 'owner@library.com', '$2b$10$4.o7m82W01g7Zq7v9xY7m.E4cQd.5eX8u2z1v5y8A9b0c1d2e3f4g', 'owner', '0909999000', 'LIB-OW-000001', '2030-12-31', 'active');

-- 2.3. ĐỀ XUẤT CẤU HÌNH MẪU (CONFIG CHANGE REQUESTS)
INSERT INTO config_change_requests (id, key_name, current_value, proposed_value, reason, requested_by, status, reviewed_by, reviewed_at, review_note) VALUES
(1, 'fine_per_day', '5000', '10000', 'Đề xuất tăng phí phạt theo quý mới nhằm giảm tỷ lệ trả sách trễ hạn', 1, 'pending', NULL, NULL, NULL);

-- 2.4. THỂ LOẠI (CATEGORIES)
INSERT INTO categories (id, name, parent_id, description) VALUES
(1, 'Văn học', NULL, 'Tiểu thuyết, truyện ngắn, thơ ca Việt Nam và thế giới'),
(2, 'Khoa học & Công nghệ', NULL, 'Vũ trụ học, vật lý, sinh học, CNTT và Trí tuệ nhân tạo AI'),
(3, 'Kinh tế & Quản trị', NULL, 'Kinh doanh, tiếp thị, tài chính cá nhân, khởi nghiệp và quản trị'),
(4, 'Kỹ năng & Phát triển', NULL, 'Phát triển bản thân, tư duy phản biện, nghệ thuật giao tiếp'),
(5, 'Lịch sử & Triết học', NULL, 'Lịch sử Việt Nam, văn minh thế giới và triết học ứng dụng'),
(6, 'Thiếu nhi & Tuổi trẻ', NULL, 'Truyện tranh, sách kỹ năng và khám phá cho lứa tuổi thiếu niên');

-- 2.5. TÁC GIẢ (AUTHORS)
INSERT INTO authors (id, name, bio, image_url) VALUES
(1, 'Nguyễn Nhật Ánh', 'Nhà văn gạo cội của văn học thanh thiếu niên Việt Nam với hàng loạt tác phẩm kinh điển.', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200'),
(2, 'Stephen Hawking', 'Nhà vật lý lý thuyết, vũ trụ học vĩ đại người Anh, nguyên Giáo sư Lucas tại Đại học Cambridge.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200'),
(3, 'Dale Carnegie', 'Tác giả huyền thoại về phát triển bản thân và nghệ thuật giao tiếp người Mỹ.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200'),
(4, 'Haruki Murakami', 'Nhà văn hiện đại nổi tiếng người Nhật Bản với phong cách hiện thực huyền ảo.', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200'),
(5, 'Walter Isaacson', 'Nhà tiểu sử học hàng đầu thế giới, tác giả các cuốn tiểu sử bán chạy về Steve Jobs, Elon Musk.', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=200'),
(6, 'Nguyễn Du', 'Đại thi hào dân tộc Việt Nam, Danh nhân văn hóa thế giới, tác giả tác phẩm Truyện Kiều.', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200'),
(7, 'James Clear', 'Tác giả sách bán chạy nhất New York Times về thay đổi thói quen và tối ưu hóa bản thân.', 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=200');

-- 2.6. NHÀ XUẤT BẢN (PUBLISHERS)
INSERT INTO publishers (id, name, address, contact_email) VALUES
(1, 'NXB Trẻ', '161B Lý Chính Thắng, Q.3, TP. Hồ Chí Minh', 'contact@nxbtre.com.vn'),
(2, 'NXB Hội Nhà Văn', '65 Nguyễn Du, Hai Bà Trưng, Hà Nội', 'hoinhavan@nxb.vn'),
(3, 'NXB Kim Đồng', '55 Quang Trung, Hai Bà Trưng, Hà Nội', 'info@nxbkimdong.com.vn'),
(4, 'NXB Tri Thức', '53 Nguyễn Du, Hai Bà Trưng, Hà Nội', 'trithuc@nxbtrithuc.com.vn'),
(5, 'NXB Thế Giới', '46 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội', 'thegioi@nxbthegioi.vn');

-- 2.7. SÁCH (BOOKS)
INSERT INTO books (id, title, author_id, publisher_id, category_id, isbn, published_year, description, cover_image, total_copies, available_copies, avg_rating) VALUES
(1, 'Mắt Biếc', 1, 1, 1, '978-604-1-15234-8', 2019, 'Tác phẩm lãng mạn kinh điển về tình yêu tuổi học trò giữa Ngạn và Hà Lan.', 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400', 5, 4, 5.00),
(2, 'Lược Sử Thời Gian', 2, 1, 2, '978-604-1-08912-5', 2018, 'Hành trình khám phá không gian, thời gian, hố đen và nguồn gốc của vũ trụ.', 'https://images.unsplash.com/photo-1532012197267-da84d127e765?w=400', 4, 3, 5.00),
(3, 'Đắc Nhân Tâm', 3, 2, 4, '978-604-53-4821-3', 2020, 'Nghệ thuật ứng xử, thu phục lòng người và xây dựng mối quan hệ bền vững.', 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=400', 6, 6, 4.00),
(4, 'Lập trình Node.js & React Thực Chiến', 5, 4, 2, '978-604-89-1234-0', 2024, 'Hướng dẫn từ cơ bản đến nâng cao xây dựng ứng dụng web hiện đại fullstack.', 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400', 4, 3, 5.00),
(5, 'Rừng Na Uy', 4, 2, 1, '978-604-964-112-9', 2021, 'Tiểu thuyết lừng danh về ký ức, tình yêu và những hoài niệm tuổi trẻ ở Tokyo.', 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400', 3, 2, 0.00),
(6, 'Atomic Habits - Thói Quen Nguyên Tử', 7, 5, 4, '978-604-77-8910-1', 2022, 'Phương pháp thay đổi 1% mỗi ngày để tạo nên những kết quả phi thường.', 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=400', 5, 5, 5.00),
(7, 'Steve Jobs', 5, 4, 3, '978-604-98-3344-9', 2021, 'Cuốn tiểu sử độc quyền về cuộc đời vị sáng lập tài ba của Apple.', 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400', 3, 3, 0.00),
(8, 'Truyện Kiều', 6, 2, 1, '978-604-56-1122-1', 2017, 'Kiệt tác thơ Nôm tài hoa của Đại thi hào Nguyễn Du.', 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400', 4, 4, 0.00),
(9, 'Kính Vạn Hoa', 1, 3, 6, '978-604-2-23112-8', 2023, 'Bộ truyện học trò hồn nhiên, hài hước và giàu tình bạn.', 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=400', 5, 4, 0.00);

-- 2.8. BẢN SAO SÁCH (BOOK COPIES)
INSERT INTO book_copies (id, book_id, qr_code, status, condition_note) VALUES
(1, 1, 'QR-BK-1-1', 'borrowed', NULL),
(2, 1, 'QR-BK-1-2', 'available', NULL),
(3, 1, 'QR-BK-1-3', 'available', NULL),
(4, 1, 'QR-BK-1-4', 'available', NULL),
(5, 1, 'QR-BK-1-5', 'available', NULL),
(6, 2, 'QR-BK-2-1', 'borrowed', NULL),
(7, 2, 'QR-BK-2-2', 'available', NULL),
(8, 2, 'QR-BK-2-3', 'available', NULL),
(9, 2, 'QR-BK-2-4', 'available', NULL),
(10, 3, 'QR-BK-3-1', 'available', NULL),
(11, 3, 'QR-BK-3-2', 'available', NULL),
(12, 3, 'QR-BK-3-3', 'available', NULL),
(13, 3, 'QR-BK-3-4', 'available', NULL),
(14, 3, 'QR-BK-3-5', 'available', NULL),
(15, 3, 'QR-BK-3-6', 'available', NULL),
(16, 4, 'QR-BK-4-1', 'borrowed', NULL),
(17, 4, 'QR-BK-4-2', 'available', NULL),
(18, 4, 'QR-BK-4-3', 'available', NULL),
(19, 4, 'QR-BK-4-4', 'available', NULL),
(20, 5, 'QR-BK-5-1', 'borrowed', NULL),
(21, 5, 'QR-BK-5-2', 'available', NULL),
(22, 5, 'QR-BK-5-3', 'available', NULL),
(23, 6, 'QR-BK-6-1', 'available', NULL),
(24, 6, 'QR-BK-6-2', 'available', NULL),
(25, 6, 'QR-BK-6-3', 'available', NULL),
(26, 6, 'QR-BK-6-4', 'available', NULL),
(27, 6, 'QR-BK-6-5', 'available', NULL),
(28, 7, 'QR-BK-7-1', 'available', NULL),
(29, 7, 'QR-BK-7-2', 'available', NULL),
(30, 7, 'QR-BK-7-3', 'available', NULL),
(31, 8, 'QR-BK-8-1', 'available', NULL),
(32, 8, 'QR-BK-8-2', 'available', NULL),
(33, 8, 'QR-BK-8-3', 'available', NULL),
(34, 8, 'QR-BK-8-4', 'available', NULL),
(35, 9, 'QR-BK-9-1', 'available', NULL),
(36, 9, 'QR-BK-9-2', 'available', NULL),
(37, 9, 'QR-BK-9-3', 'available', NULL),
(38, 9, 'QR-BK-9-4', 'available', NULL),
(39, 9, 'QR-BK-9-5', 'damaged', 'Sách bị rách trang bìa sau');

-- 2.9. PHIẾU MƯỢN TRẢ (BORROW RECORDS)
-- user_id = 3 (Nguyễn Minh A - Độc giả)
-- processed_by = 2 (Trần Thủ Thư)
INSERT INTO borrow_records (id, user_id, book_copy_id, borrow_date, due_date, return_date, status, processed_by) VALUES
(1, 3, 1, DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_ADD(NOW(), INTERVAL 4 DAY), NULL, 'borrowing', 2),
(2, 3, 6, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 6 DAY), NULL, 'borrowing', 2),
(3, 3, 10, DATE_SUB(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 16 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), 'returned', 2),
(4, 3, 16, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_ADD(NOW(), INTERVAL 9 DAY), NULL, 'borrowing', 2),
(5, 3, 20, DATE_SUB(NOW(), INTERVAL 18 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), NULL, 'borrowing', 2),
(6, 3, 23, DATE_SUB(NOW(), INTERVAL 40 DAY), DATE_SUB(NOW(), INTERVAL 26 DAY), DATE_SUB(NOW(), INTERVAL 20 DAY), 'returned', 2);

-- 2.10. TIỀN PHẠT (FINES)
INSERT INTO fines (id, borrow_record_id, user_id, amount, reason, status, created_at, paid_at) VALUES
(1, 2, 3, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Lược Sử Thời Gian)', 'unpaid', DATE_SUB(NOW(), INTERVAL 6 DAY), NULL),
(2, 5, 3, 20000.00, 'Quá hạn trả sách 4 ngày (Sách: Rừng Na Uy)', 'unpaid', DATE_SUB(NOW(), INTERVAL 4 DAY), NULL),
(3, 6, 3, 30000.00, 'Quá hạn trả sách 6 ngày (Sách: Atomic Habits)', 'paid', DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 20 DAY));

-- 2.11. ĐẶT TRƯỚC SÁCH (RESERVATIONS)
INSERT INTO reservations (id, user_id, book_id, reservation_date, status) VALUES
(1, 3, 2, DATE_SUB(NOW(), INTERVAL 3 DAY), 'pending'),
(2, 3, 5, DATE_SUB(NOW(), INTERVAL 5 DAY), 'ready'),
(3, 3, 6, DATE_SUB(NOW(), INTERVAL 10 DAY), 'fulfilled'),
(4, 3, 1, DATE_SUB(NOW(), INTERVAL 1 DAY), 'pending');

-- 2.12. ĐÁNH GIÁ SÁCH (REVIEWS)
INSERT INTO reviews (id, user_id, book_id, rating, comment, created_at) VALUES
(1, 3, 1, 5, 'Một cuốn sách tuyệt vời gắn liền với tuổi thơ, kết thúc gợi nhiều suy ngẫm.', DATE_SUB(NOW(), INTERVAL 8 DAY)),
(2, 3, 2, 5, 'Kiến thức vũ trụ rất sâu sắc nhưng tác giả diễn đạt khá dễ hiểu cho người mới bắt đầu.', DATE_SUB(NOW(), INTERVAL 15 DAY)),
(3, 3, 3, 4, 'Tác phẩm kinh điển về kỹ năng ứng xử và thấu hiểu con người.', DATE_SUB(NOW(), INTERVAL 25 DAY)),
(4, 3, 4, 5, 'Tài liệu thực hành lập trình Node.js và React rất rõ ràng, thực tế.', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(5, 3, 6, 5, 'Thói quen nhỏ mang lại sự thay đổi lớn, cuốn sách thực sự thay đổi tư duy làm việc của tôi.', DATE_SUB(NOW(), INTERVAL 12 DAY));

-- 2.13. LỊCH SỬ ĐỌC (READ HISTORY)
INSERT INTO read_history (id, user_id, book_id, borrow_record_id, read_date) VALUES
(1, 3, 1, 1, DATE_SUB(NOW(), INTERVAL 10 DAY)),
(2, 3, 2, 2, DATE_SUB(NOW(), INTERVAL 20 DAY)),
(3, 3, 3, 3, DATE_SUB(NOW(), INTERVAL 30 DAY));

-- 2.14. THÔNG BÁO (NOTIFICATIONS)
INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at) VALUES
(1, 3, 'Chào mừng đến với Smart Library!', 'Chúc mừng bạn đã kích hoạt thẻ thư viện trực tuyến thành công. Thẻ của bạn: LIB-RD-100001.', 'info', 1, DATE_SUB(NOW(), INTERVAL 10 DAY)),
(2, 3, 'Cảnh báo quá hạn mượn sách', 'Sách "Rừng Na Uy" của bạn đã quá hạn 4 ngày. Vui lòng làm thủ tục trả sách hoặc gia hạn.', 'warning', 0, DATE_SUB(NOW(), INTERVAL 4 DAY)),
(3, 3, 'Thông báo phạt trễ hạn', 'Bạn có khoản phí phạt 30,000đ cho cuốn "Lược Sử Thời Gian". Vui lòng thanh toán tại quầy.', 'warning', 0, DATE_SUB(NOW(), INTERVAL 6 DAY)),
(4, 3, 'Sách đặt trước đã sẵn sàng', 'Cuốn sách "Rừng Na Uy" bạn đặt trước đã có mặt tại quầy. Vui lòng đến nhận trong 48 giờ.', 'reminder', 0, DATE_SUB(NOW(), INTERVAL 2 DAY));

-- 2.15. NHẬT KÝ HOẠT ĐỘNG (ACTIVITY LOGS)
INSERT INTO activity_logs (id, user_id, action, target_type, target_id, details, created_at) VALUES
(1, 1, 'SYSTEM_INIT', 'system', NULL, 'Khởi tạo hệ thống Smart Library Athenaeum', DATE_SUB(NOW(), INTERVAL 30 DAY)),
(2, 2, 'BORROW_BOOK', 'borrow_records', 1, 'Thủ thư cho độc giả Nguyễn Minh A mượn sách Mắt Biếc qua mã QR', DATE_SUB(NOW(), INTERVAL 10 DAY)),
(3, 2, 'RETURN_BOOK', 'borrow_records', 3, 'Thủ thư nhận trả sách Đắc Nhân Tâm', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(4, 1, 'PROPOSE_CONFIG', 'config_change_requests', 1, 'Admin gửi đề xuất tăng fine_per_day lên 10.000đ', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(5, 4, 'SYSTEM_LOGIN', 'users', 4, 'Chủ thư viện Trần Văn Chủ đăng nhập kiểm toán hệ thống', NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ========================================================
-- HOÀN TẤT KHỞI TẠO CƠ SỞ DỮ LIỆU SMART LIBRARY
-- ========================================================
