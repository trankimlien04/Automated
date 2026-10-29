const db = require('../config/db');

/**
 * MODULE GỢI Ý SÁCH THÔNG MINH (RECOMMENDATION ENGINE)
 * Thuật toán gợi ý cá nhân hóa dựa trên:
 * 1. Sở thích thể loại & Tác giả khai báo (Explicit Preferences - Giải quyết Cold-Start)
 * 2. Lịch sử mượn & đọc sách (Implicit Borrowing History & Frequency)
 * 3. Đánh giá và tương tác người dùng (User Ratings & Reviews)
 * 4. Tương đồng nội dung (Content-Based Filtering - CBF: Category, Author, Description Keywords)
 * 5. Xu hướng thịnh hành cộng đồng (Collaborative Signals & Trending in Library)
 * 6. Trạng thái sẵn sàng lưu thông (Availability in Warehouse)
 * 7. Trí tuệ nhân tạo giải thích được (Explainable AI - XAI Match Reasons)
 */

exports.getRecommendations = async (req, res) => {
    const userId = req.user.id;
    const mode = req.query.mode || 'hybrid'; // 'hybrid' | 'cbf' | 'preferences' | 'trending' | 'top_rated'
    const limit = Math.min(24, Math.max(4, parseInt(req.query.limit) || 12));

    try {
        // 1. LẤY HỒ SƠ SỞ THÍCH KHAI BÁO CỦA ĐỘC GIẢ (EXPLICIT PREFERENCES)
        const [prefRows] = await db.query(
            'SELECT * FROM user_preferences WHERE user_id = ?',
            [userId]
        );
        let userPrefs = {
            favorite_categories: [],
            favorite_authors: [],
            preferred_topics: ''
        };
        if (prefRows.length > 0) {
            const row = prefRows[0];
            try {
                userPrefs.favorite_categories = typeof row.favorite_categories === 'string' 
                    ? JSON.parse(row.favorite_categories) 
                    : (row.favorite_categories || []);
            } catch (e) {
                userPrefs.favorite_categories = [];
            }
            try {
                userPrefs.favorite_authors = typeof row.favorite_authors === 'string' 
                    ? JSON.parse(row.favorite_authors) 
                    : (row.favorite_authors || []);
            } catch (e) {
                userPrefs.favorite_authors = [];
            }
            userPrefs.preferred_topics = row.preferred_topics || '';
        }

        const favCategorySet = new Set(userPrefs.favorite_categories.map(Number));
        const favAuthorSet = new Set(userPrefs.favorite_authors.map(Number));

        // 2. LẤY LỊCH SỬ MƯỢN ĐỌC & TƯƠNG TÁC CỦA ĐỘC GIẢ (IMPLICIT SIGNALS)
        const [borrowHistory] = await db.query(`
            SELECT 
                br.id as record_id,
                br.borrow_date,
                br.status as borrow_status,
                bc.book_id,
                b.title,
                b.category_id,
                b.author_id,
                c.name as category_name,
                a.name as author_name
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN authors a ON b.author_id = a.id
            WHERE br.user_id = ?
            ORDER BY br.borrow_date DESC
        `, [userId]);

        // Sách độc giả đã đánh giá sao
        const [userReviews] = await db.query(
            'SELECT book_id, rating FROM reviews WHERE user_id = ?',
            [userId]
        );
        const reviewRatingMap = new Map();
        userReviews.forEach(r => reviewRatingMap.set(r.book_id, r.rating));

        // Sách độc giả đang giữ chỗ / đặt trước
        const [userHolds] = await db.query(`
            SELECT book_id FROM borrow_requests WHERE user_id = ? AND status = 'pending'
            UNION
            SELECT book_id FROM reservations WHERE user_id = ? AND status IN ('waiting', 'pending', 'ready', 'accepted')
        `, [userId, userId]);
        const holdBookIdSet = new Set(userHolds.map(h => h.book_id));

        // Tổng hợp thống kê hành vi đọc
        const categoryFreqMap = new Map(); // catId -> { count, name }
        const authorFreqMap = new Map();   // authId -> { count, name }
        const readBookIdSet = new Set();
        const currentlyBorrowingIdSet = new Set();

        borrowHistory.forEach(record => {
            readBookIdSet.add(record.book_id);
            if (record.borrow_status === 'borrowing') {
                currentlyBorrowingIdSet.add(record.book_id);
            }

            // Tính điểm tương tác thể loại
            if (record.category_id) {
                const current = categoryFreqMap.get(record.category_id) || { count: 0, name: record.category_name };
                current.count += 1;
                // Nếu từng đánh giá 5 sao -> tăng trọng số
                if (reviewRatingMap.get(record.book_id) >= 4) {
                    current.count += 1;
                }
                categoryFreqMap.set(record.category_id, current);
            }

            // Tính điểm tương tác tác giả
            if (record.author_id) {
                const current = authorFreqMap.get(record.author_id) || { count: 0, name: record.author_name };
                current.count += 1;
                if (reviewRatingMap.get(record.book_id) >= 4) {
                    current.count += 1;
                }
                authorFreqMap.set(record.author_id, current);
            }
        });

        // 3. TRUY VẤN TOÀN BỘ DANH MỤC ĐẦU SÁCH KÈM TÍN HIỆU TOÀN HỆ THỐNG
        const [allBooks] = await db.query(`
            SELECT 
                b.id,
                b.title,
                b.author_id,
                b.publisher_id,
                b.category_id,
                b.isbn,
                b.published_year,
                b.description,
                b.cover_image,
                b.total_copies,
                b.available_copies,
                b.avg_rating,
                b.created_at,
                c.name as category_name,
                a.name as author_name,
                p.name as publisher_name,
                (
                    SELECT COUNT(*) 
                    FROM borrow_records br 
                    JOIN book_copies bc ON br.book_copy_id = bc.id 
                    WHERE bc.book_id = b.id
                ) as total_borrow_count,
                (
                    SELECT COUNT(*) 
                    FROM reviews rv 
                    WHERE rv.book_id = b.id
                ) as total_review_count
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN authors a ON b.author_id = a.id
            LEFT JOIN publishers p ON b.publisher_id = p.id
        `);

        // Tìm số lượt mượn cao nhất để chuẩn hóa độ phổ biến
        const maxBorrowCount = Math.max(1, ...allBooks.map(b => b.total_borrow_count || 0));

        // Xác định trạng thái Cold-Start (Người dùng mới)
        const hasHistory = borrowHistory.length > 0;
        const hasPreferences = favCategorySet.size > 0 || favAuthorSet.size > 0;
        const isColdStart = !hasHistory && !hasPreferences;

        // 4. THUẬT TOÁN TÍNH ĐIỂM CÁ NHÂN HÓA (PERSONALIZED SCORING ENGINE)
        const scoredBooks = allBooks.map(b => {
            let score = 50; // Điểm cơ sở
            const reasons = [];
            let primaryReason = '';
            let badge = '';

            const isCurrentlyReading = currentlyBorrowingIdSet.has(b.id);
            const hasReadBefore = readBookIdSet.has(b.id);
            const isHolding = holdBookIdSet.has(b.id);

            // A. ĐIỂM THỂ LOẠI (CATEGORY / GENRE SCORE: TỐI ĐA 35 ĐIỂM)
            const isFavCategory = favCategorySet.has(b.category_id);
            const catHistory = categoryFreqMap.get(b.category_id);

            if (isFavCategory) {
                score += 25;
                reasons.push(`Thuộc nhóm thể loại yêu thích của bạn: ${b.category_name || 'Thể loại này'}`);
                if (!primaryReason) primaryReason = `Khớp sở thích thể loại ${b.category_name}`;
            } else if (catHistory && catHistory.count > 0) {
                const boost = Math.min(22, 10 + catHistory.count * 3);
                score += boost;
                reasons.push(`Dựa trên ${catHistory.count} lần bạn đọc sách chủ đề "${b.category_name}"`);
                if (!primaryReason) primaryReason = `Phù hợp gu đọc ${b.category_name} của bạn`;
            }

            // B. ĐIỂM TÁC GIẢ (AUTHOR SCORE: TỐI ĐA 28 ĐIỂM)
            const isFavAuthor = favAuthorSet.has(b.author_id);
            const authHistory = authorFreqMap.get(b.author_id);

            if (isFavAuthor) {
                score += 24;
                reasons.push(`Tác giả bạn theo dõi: ${b.author_name}`);
                if (!primaryReason) primaryReason = `Tác phẩm của tác giả yêu thích ${b.author_name}`;
            } else if (authHistory && authHistory.count > 0) {
                const boost = Math.min(20, 10 + authHistory.count * 4);
                score += boost;
                reasons.push(`Bạn từng mượn ${authHistory.count} tác phẩm của tác giả ${b.author_name}`);
                if (!primaryReason) primaryReason = `Cùng tác giả ${b.author_name} bạn đã đọc`;
            }

            // C. ĐIỂM TƯƠNG ĐỒNG TỪ KHÓA CHỦ ĐỀ (PREFERED TOPICS: TỐI ĐA 8 ĐIỂM)
            if (userPrefs.preferred_topics && userPrefs.preferred_topics.trim().length > 0) {
                const keywords = userPrefs.preferred_topics.toLowerCase().split(/[\s,;]+/);
                const bookContent = `${b.title} ${b.description || ''} ${b.category_name || ''}`.toLowerCase();
                const matchedKeywords = keywords.filter(kw => kw.length > 2 && bookContent.includes(kw));
                if (matchedKeywords.length > 0) {
                    score += Math.min(8, matchedKeywords.length * 3);
                    reasons.push(`Phù hợp chủ đề bạn quan tâm: "${matchedKeywords.slice(0, 2).join(', ')}"`);
                }
            }

            // D. ĐIỂM CHẤT LƯỢNG & ĐỘ PHỔ BIẾN CỘNG ĐỒNG (POPULARITY & QUALITY: TỐI ĐA 18 ĐIỂM)
            const ratingNum = parseFloat(b.avg_rating) || 0;
            if (ratingNum >= 4.5) {
                score += 8;
                reasons.push(`Đánh giá xuất sắc ${ratingNum.toFixed(1)}★ từ cộng đồng độc giả`);
            } else if (ratingNum >= 4.0) {
                score += 5;
            }

            const borrowPopularityRatio = (b.total_borrow_count || 0) / maxBorrowCount;
            if (borrowPopularityRatio > 0.5) {
                score += 8;
                reasons.push(`Đang thịnh hành trong thư viện với ${b.total_borrow_count} lượt mượn`);
            } else if (b.total_borrow_count > 0) {
                score += 4;
            }

            // E. ĐIỂM SẴN CÓ TRÊN KỆ (AVAILABILITY: TỐI ĐA 8 ĐIỂM)
            if (b.available_copies > 0) {
                score += 8;
                reasons.push(`Còn ${b.available_copies}/${b.total_copies} bản sao sẵn sàng mượn ngay`);
            } else {
                reasons.push(`Tạm hết sách (có thể đặt trước để nhận thông báo sớm)`);
            }

            // F. ĐIỀU CHỈNH THEO TRẠNG THÁI ĐÃ ĐỌC (HISTORY PENALTY / RE-READ BONUS)
            if (isCurrentlyReading) {
                score -= 35; // Đang mượn thì hạ ưu tiên để nhường sách khác
                badge = 'Đang đọc';
            } else if (isHolding) {
                score -= 15;
                badge = 'Đã giữ chỗ';
            } else if (hasReadBefore) {
                // Nếu độc giả đã đọc gần hết sách thư viện, không loại trừ mà gắn nhãn đọc lại
                score -= 12;
                if (!badge) badge = 'Đọc lại';
                reasons.push(`Bạn đã từng mượn cuốn này trước đây`);
            } else {
                // Sách mới toanh chưa đọc -> thưởng điểm khám phá
                score += 10;
                if (!badge) badge = 'Khám phá mới';
            }

            // G. XỬ LÝ ĐỘC GIẢ MỚI (COLD-START ADJUSTMENT)
            if (isColdStart) {
                const baseQuality = (ratingNum >= 4 ? 12 : 6) + Math.round(borrowPopularityRatio * 15);
                score = 75 + baseQuality + (b.available_copies > 0 ? 5 : 0);
                badge = b.total_borrow_count >= 2 
                    ? 'Thịnh hành nhất' 
                    : ratingNum >= 4.5 
                    ? 'Đánh giá 5★' 
                    : 'Gợi ý cho bạn mới';
                primaryReason = b.total_borrow_count >= 2
                    ? `Top sách thịnh hành được mượn nhiều nhất (${b.total_borrow_count} lượt)`
                    : `Sách tiêu biểu được cộng đồng đánh giá cao (${ratingNum.toFixed(1)}★)`;
                reasons.unshift('Sách nổi bật dành cho độc giả mới khám phá thư viện');
            }

            // Chuẩn hóa điểm Match Score về khoảng 60% - 99%
            const matchScore = Math.min(99, Math.max(60, Math.round(score)));

            // Nếu chưa có badge, đặt theo điểm và chất lượng
            if (!badge) {
                if (matchScore >= 92) badge = 'Gợi ý hàng đầu';
                else if (borrowPopularityRatio > 0.6) badge = 'Thịnh hành';
                else if (ratingNum >= 4.5) badge = 'Đánh giá cao';
                else badge = 'Phù hợp với bạn';
            }

            if (!primaryReason) {
                primaryReason = reasons[0] || `Được gợi ý theo chủ đề ${b.category_name || 'thư viện'}`;
            }

            return {
                ...b,
                match_score: matchScore,
                badge_label: badge,
                primary_reason: primaryReason,
                match_reasons: reasons.slice(0, 4),
                is_currently_reading: isCurrentlyReading,
                has_read_before: hasReadBefore,
                is_holding: isHolding
            };
        });

        // 5. LỌC VÀ SẮP XẾP THEO CHẾ ĐỘ (MODE FILTERING)
        let finalRecommendations = [...scoredBooks];

        // Lọc theo thể loại cụ thể nếu được truyền từ thanh chip nhanh
        if (req.query.category_id && req.query.category_id !== 'all') {
            const filterCatId = parseInt(req.query.category_id);
            if (!isNaN(filterCatId)) {
                finalRecommendations = finalRecommendations.filter(b => b.category_id === filterCatId);
            }
        }

        if (mode === 'cbf') {
            // Content-Based: Ưu tiên tương quan Thể loại và Tác giả cao nhất
            finalRecommendations.sort((a, b) => {
                const aCatMatch = favCategorySet.has(a.category_id) || categoryFreqMap.has(a.category_id);
                const bCatMatch = favCategorySet.has(b.category_id) || categoryFreqMap.has(b.category_id);
                if (aCatMatch && !bCatMatch) return -1;
                if (!aCatMatch && bCatMatch) return 1;
                return b.match_score - a.match_score;
            });
        } else if (mode === 'preferences') {
            // Chỉ hiển thị sách khớp đúng Thể loại hoặc Tác giả đã cấu hình
            const prefFiltered = finalRecommendations.filter(
                b => favCategorySet.has(b.category_id) || favAuthorSet.has(b.author_id)
            );
            if (prefFiltered.length > 0) {
                finalRecommendations = prefFiltered.sort((a, b) => b.match_score - a.match_score);
            } else {
                finalRecommendations.sort((a, b) => b.match_score - a.match_score);
            }
        } else if (mode === 'trending') {
            // Sách mượn nhiều nhất toàn thư viện
            finalRecommendations.sort((a, b) => (b.total_borrow_count || 0) - (a.total_borrow_count || 0) || b.match_score - a.match_score);
        } else if (mode === 'top_rated') {
            // Sách đánh giá cao nhất
            finalRecommendations.sort((a, b) => (parseFloat(b.avg_rating) || 0) - (parseFloat(a.avg_rating) || 0) || b.match_score - a.match_score);
        } else {
            // Chế độ 'hybrid' (mặc định): Điểm tổng hợp thông minh
            finalRecommendations.sort((a, b) => b.match_score - a.match_score);
        }

        // Cắt theo giới hạn limit
        const resultBooks = finalRecommendations.slice(0, limit);

        // 6. THỐNG KÊ HỒ SƠ ĐỘC GIẢ (USER READING INSIGHTS)
        const sortedTopCats = Array.from(categoryFreqMap.entries())
            .map(([id, val]) => ({ id, name: val.name, count: val.count }))
            .sort((a, b) => b.count - a.count);

        const sortedTopAuthors = Array.from(authorFreqMap.entries())
            .map(([id, val]) => ({ id, name: val.name, count: val.count }))
            .sort((a, b) => b.count - a.count);

        // Tính danh xưng phong cách đọc (Persona)
        let readingPersona = 'Độc giả khám phá tri thức';
        if (sortedTopCats.length > 0) {
            const topNames = sortedTopCats.slice(0, 2).map(c => c.name).filter(Boolean);
            if (topNames.length > 0) {
                readingPersona = `Độc giả đam mê ${topNames.join(' & ')}`;
            }
        }

        const userInsights = {
            total_borrowed: borrowHistory.length,
            unique_books_read: readBookIdSet.size,
            currently_reading_count: currentlyBorrowingIdSet.size,
            top_categories: sortedTopCats.slice(0, 4),
            top_authors: sortedTopAuthors.slice(0, 4),
            has_history: hasHistory,
            has_preferences: hasPreferences,
            is_cold_start: isColdStart,
            reading_persona: readingPersona,
            configured_preferences: userPrefs
        };

        res.status(200).json({
            active_mode: mode,
            total_found: resultBooks.length,
            recommendations: resultBooks,
            user_insights: userInsights
        });

    } catch (error) {
        console.error('Lỗi tính toán Gợi ý sách AI:', error);
        res.status(500).json({ message: 'Lỗi server khi tính toán gợi ý sách thông minh' });
    }
};

/**
 * Lấy danh sách sở thích đọc của độc giả hiện tại
 * Kèm danh sách toàn bộ Thể loại và Tác giả trong thư viện để hiển thị popup chọn
 */
exports.getUserPreferences = async (req, res) => {
    const userId = req.user.id;

    try {
        const [prefRows] = await db.query(
            'SELECT * FROM user_preferences WHERE user_id = ?',
            [userId]
        );

        let preferences = {
            favorite_categories: [],
            favorite_authors: [],
            preferred_topics: ''
        };

        if (prefRows.length > 0) {
            const row = prefRows[0];
            try {
                preferences.favorite_categories = typeof row.favorite_categories === 'string'
                    ? JSON.parse(row.favorite_categories)
                    : (row.favorite_categories || []);
            } catch (e) {
                preferences.favorite_categories = [];
            }
            try {
                preferences.favorite_authors = typeof row.favorite_authors === 'string'
                    ? JSON.parse(row.favorite_authors)
                    : (row.favorite_authors || []);
            } catch (e) {
                preferences.favorite_authors = [];
            }
            preferences.preferred_topics = row.preferred_topics || '';
        }

        // Lấy tất cả thể loại trong hệ thống
        const [allCategories] = await db.query(`
            SELECT c.id, c.name, COUNT(b.id) as book_count
            FROM categories c
            LEFT JOIN books b ON b.category_id = c.id
            GROUP BY c.id, c.name
            ORDER BY book_count DESC, c.name ASC
        `);

        // Lấy các tác giả tiêu biểu trong hệ thống
        const [allAuthors] = await db.query(`
            SELECT a.id, a.name, COUNT(b.id) as book_count
            FROM authors a
            LEFT JOIN books b ON b.author_id = a.id
            GROUP BY a.id, a.name
            ORDER BY book_count DESC, a.name ASC
            LIMIT 30
        `);

        res.status(200).json({
            preferences,
            all_categories: allCategories,
            all_authors: allAuthors
        });
    } catch (error) {
        console.error('Lỗi khi lấy sở thích đọc:', error);
        res.status(500).json({ message: 'Lỗi server khi tải sở thích độc giả' });
    }
};

/**
 * Lưu / cập nhật sở thích đọc của độc giả
 */
exports.saveUserPreferences = async (req, res) => {
    const userId = req.user.id;
    const { favorite_categories, favorite_authors, preferred_topics } = req.body;

    try {
        const cleanCategories = Array.isArray(favorite_categories) 
            ? favorite_categories.map(Number).filter(id => !isNaN(id))
            : [];
        const cleanAuthors = Array.isArray(favorite_authors)
            ? favorite_authors.map(Number).filter(id => !isNaN(id))
            : [];
        const cleanTopics = typeof preferred_topics === 'string' ? preferred_topics.trim() : '';

        const categoriesJson = JSON.stringify(cleanCategories);
        const authorsJson = JSON.stringify(cleanAuthors);

        await db.query(`
            INSERT INTO user_preferences (user_id, favorite_categories, favorite_authors, preferred_topics)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                favorite_categories = VALUES(favorite_categories),
                favorite_authors = VALUES(favorite_authors),
                preferred_topics = VALUES(preferred_topics),
                updated_at = NOW()
        `, [userId, categoriesJson, authorsJson, cleanTopics]);

        res.status(200).json({
            message: 'Đã cập nhật hồ sơ sở thích đọc thành công! Hệ thống AI đã làm mới gợi ý cho bạn.',
            preferences: {
                favorite_categories: cleanCategories,
                favorite_authors: cleanAuthors,
                preferred_topics: cleanTopics
            }
        });
    } catch (error) {
        console.error('Lỗi lưu sở thích đọc:', error);
        res.status(500).json({ message: 'Lỗi server khi lưu sở thích đọc' });
    }
};

/**
 * Thống kê xu hướng thịnh hành thực tế của thư viện
 * Dựa trên lượt mượn thực tế từ bảng borrow_records
 */
exports.getTrendingInsights = async (req, res) => {
    try {
        // Thống kê thể loại được mượn nhiều nhất thực tế
        const [trendingCategories] = await db.query(`
            SELECT 
                c.id,
                c.name,
                COUNT(br.id) as borrow_count
            FROM categories c
            JOIN books b ON b.category_id = c.id
            JOIN book_copies bc ON bc.book_id = b.id
            JOIN borrow_records br ON br.book_copy_id = bc.id
            GROUP BY c.id, c.name
            ORDER BY borrow_count DESC
            LIMIT 4
        `);

        const totalCirculation = trendingCategories.reduce((sum, item) => sum + (item.borrow_count || 0), 0) || 1;
        const formattedTrends = trendingCategories.map(cat => ({
            id: cat.id,
            label: cat.name,
            borrow_count: cat.borrow_count,
            percentage: Math.round((cat.borrow_count / totalCirculation) * 100),
            trend_badge: `+${Math.round((cat.borrow_count / totalCirculation) * 100)}% mượn đọc`
        }));

        // Top 4 cuốn sách được mượn nhiều nhất toàn thư viện
        const [topBorrowedBooks] = await db.query(`
            SELECT 
                b.id,
                b.title,
                b.cover_image,
                b.available_copies,
                b.total_copies,
                b.avg_rating,
                c.name as category_name,
                a.name as author_name,
                COUNT(br.id) as borrow_count
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            LEFT JOIN authors a ON b.author_id = a.id
            JOIN book_copies bc ON bc.book_id = b.id
            JOIN borrow_records br ON br.book_copy_id = bc.id
            GROUP BY b.id, b.title, b.cover_image, b.available_copies, b.total_copies, b.avg_rating, c.name, a.name
            ORDER BY borrow_count DESC
            LIMIT 4
        `);

        res.status(200).json({
            trending_categories: formattedTrends,
            top_borrowed_books: topBorrowedBooks
        });
    } catch (error) {
        console.error('Lỗi thống kê xu hướng thư viện:', error);
        res.status(500).json({ message: 'Lỗi server khi thống kê xu hướng thư viện' });
    }
};
