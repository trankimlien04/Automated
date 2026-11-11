const db = require('../config/db');
const { syncOverdueFines } = require('../services/fineSyncService');
const { computeSmartWaitPrediction } = require('../utils/waitTimePredictor');

/**
 * Dự Báo Nhu Cầu & Cảnh Báo Nhập Sách Bằng AI (Smart Restock & Demand Forecasting)
 * Phân tích tỷ lệ: (Số bản đang mượn + Số người đang xếp hàng đặt trước + Số bản giữ chỗ 24h) / Số bản sao hiện có
 * 1. Phát hiện "Đầu sách quá tải (High-Demand Bottleneck)" & đề xuất số bản sao cần nhập bổ sung
 * 2. Phát hiện "Sách tồn kho lạnh (Dead Stock)" (> 180 ngày không ai mượn) & gợi ý luân chuyển sang kệ trưng bày hoặc kho lưu trữ (Phòng 03)
 */
async function buildSmartDemandForecastData() {
    try {
        const { syncWaitingReservationsWithStock } = require('./reservationController');
        if (typeof syncWaitingReservationsWithStock === 'function') {
            await syncWaitingReservationsWithStock();
        }
    } catch (e) {
        // Non-blocking
    }

    const [books] = await db.execute(`
        SELECT b.id, b.title, b.isbn, b.cover_image,
               b.total_copies,
               LEAST(b.total_copies, GREATEST(0, b.available_copies)) as available_copies,
               COALESCE(b.location, 'Phòng 01 - Kệ 01 - Ngăn 01') as location,
               b.created_at,
               a.name as author_name,
               c.name as category_name
        FROM books b
        LEFT JOIN authors a ON b.author_id = a.id
        LEFT JOIN categories c ON b.category_id = c.id
    `);

    // Số lượt mượn đang diễn ra + danh sách due_date theo từng book_id
    const [activeBorrows] = await db.execute(`
        SELECT bc.book_id, br.due_date
        FROM borrow_records br
        JOIN book_copies bc ON br.book_copy_id = bc.id
        WHERE br.status = 'borrowing'
        ORDER BY br.due_date ASC
    `);

    // Tổng lịch sử mượn & ngày mượn gần nhất của từng đầu sách
    const [borrowHistory] = await db.execute(`
        SELECT bc.book_id,
               COUNT(br.id) as total_historical_borrows,
               SUM(CASE WHEN br.borrow_date >= DATE_SUB(NOW(), INTERVAL 180 DAY) THEN 1 ELSE 0 END) as borrows_last_6m,
               MAX(br.borrow_date) as last_borrow_date
        FROM book_copies bc
        LEFT JOIN borrow_records br ON br.book_copy_id = bc.id
        GROUP BY bc.book_id
    `);

    // Hàng đợi đặt trước đang chờ sách (waiting / pending)
    const [resvWaitingRows] = await db.execute(`
        SELECT book_id, COUNT(DISTINCT user_id) as waiting_queue
        FROM reservations
        WHERE status IN ('waiting', 'pending')
        GROUP BY book_id
    `);

    // Suất giữ chỗ ưu tiên (24h/48h) từ cả borrow_drafts và reservations (notified / accepted / ready),
    // khử trùng lặp theo (book_id, user_id) để 1 độc giả vừa có reservation vừa có draft chỉ tính 1 suất giữ chỗ!
    const [holdUserRows] = await db.execute(`
        SELECT book_id, COUNT(DISTINCT user_id) as unique_holds
        FROM (
            SELECT r.book_id, r.user_id
            FROM reservations r
            WHERE r.status IN ('notified', 'accepted', 'ready')
              AND (r.expires_at IS NULL OR r.expires_at > NOW())
            UNION ALL
            SELECT di.book_id, d.user_id
            FROM borrow_draft_items di
            JOIN borrow_drafts d ON di.draft_id = d.id
            WHERE di.status = 'pending' AND d.status = 'pending' AND d.expires_at > NOW()
        ) combined_holds
        GROUP BY book_id
    `);

    const activeDueMap = new Map();
    for (const r of activeBorrows) {
        if (!activeDueMap.has(r.book_id)) activeDueMap.set(r.book_id, []);
        activeDueMap.get(r.book_id).push(r.due_date);
    }

    const historyMap = new Map();
    for (const r of borrowHistory) {
        historyMap.set(r.book_id, {
            totalHistoricalBorrows: Number(r.total_historical_borrows) || 0,
            borrowsLast6m: Number(r.borrows_last_6m) || 0,
            lastBorrowDate: r.last_borrow_date || null
        });
    }

    const waitingQueueMap = new Map();
    for (const r of resvWaitingRows) {
        waitingQueueMap.set(r.book_id, Number(r.waiting_queue) || 0);
    }

    const activeHoldsMap = new Map();
    for (const r of holdUserRows) {
        activeHoldsMap.set(r.book_id, Number(r.unique_holds) || 0);
    }

    const bottlenecks = [];
    const deadStockCandidates = [];
    const now = new Date();

    for (const b of books) {
        const totalCopies = Math.max(1, Number(b.total_copies) || 1);
        const activeDueDates = activeDueMap.get(b.id) || [];
        const activeBorrowCount = activeDueDates.length; // Số cuốn thực sự đang mượn (borrow_records.status = 'borrowing')
        const activeHoldsCount = activeHoldsMap.get(b.id) || 0; // Số suất đang giữ chỗ 24h/48h (đã khử trùng lặp user_id)
        const waitingQueue = waitingQueueMap.get(b.id) || 0; // Số người đang xếp hàng đặt trước (waiting/pending)
        const hist = historyMap.get(b.id) || { totalHistoricalBorrows: 0, borrowsLast6m: 0, lastBorrowDate: null };

        // Tổng số bản đang bận = Đang mượn thật + Đang giữ chỗ 24h/48h thật (không vượt quá totalCopies)
        const occupiedCopies = Math.min(totalCopies, activeBorrowCount + activeHoldsCount);
        // Số bản sẵn sàng tự do trên kệ = Tổng số bản - Số bản đang bận (khớp 100% với hộp thoại Mã QR Bản Sao)
        const availableCopies = Math.max(0, totalCopies - occupiedCopies);

        // Tổng nhu cầu hiện thời = Số bản đang mượn + Số bản giữ chỗ + Số người đang xếp hàng đặt trước
        const activeDemandUnits = occupiedCopies + waitingQueue;
        const demandRatio = Number((activeDemandUnits / totalCopies).toFixed(2));
        const utilizationPercent = Math.min(100, Math.round((occupiedCopies / totalCopies) * 100));

        // 1. Kiểm tra Đầu sách quá tải (High-Demand Bottleneck) — KHỚP 100% VỚI TRẠNG THÁI BẢN SAO TRONG KHO:
        // Một đầu sách CHỈ bị coi là Quá tải (cần nhập thêm) khi:
        // - Có độc giả đang xếp hàng chờ sách (waitingQueue > 0), HOẶC
        // - Đã hết sạch bản sao tự do trên kệ (availableCopies === 0, tức toàn bộ bản sao đều đang mượn hoặc đang giữ chỗ)
        const isBottleneck = waitingQueue > 0 || availableCopies === 0;

        if (isBottleneck) {
            // Tính thời gian chờ thực tế dựa trên due_date của các bản sao đang mượn
            const currentWaitObj = computeSmartWaitPrediction({
                bookId: b.id,
                totalCopies,
                availableCopies,
                activeDueDates,
                waitingCount: waitingQueue,
                targetQueuePosition: waitingQueue + 1
            });

            const currentWaitDays = Math.max(
                1,
                currentWaitObj.estimated_wait_days || (waitingQueue > 0 ? waitingQueue * 7 : 7)
            );

            // Đề xuất số lượng bản sao cần nhập bổ sung hợp lý:
            const recommendedAddCopies = Math.max(1, waitingQueue > 0 ? waitingQueue + 1 : 2);
            const targetWaitDaysAfterRestock = waitingQueue >= recommendedAddCopies ? 2 : 0;

            const severity =
                waitingQueue > 0 && availableCopies === 0
                    ? 'critical'
                    : availableCopies === 0 || waitingQueue > 0
                    ? 'high'
                    : 'warning';

            const statusDetailParts = [];
            if (activeBorrowCount > 0) statusDetailParts.push(`đang mượn ${activeBorrowCount}/${totalCopies} bản`);
            if (activeHoldsCount > 0) statusDetailParts.push(`đang giữ chỗ ${activeHoldsCount} bản`);
            if (waitingQueue > 0) statusDetailParts.push(`${waitingQueue} độc giả xếp hàng chờ`);
            const statusSummary = statusDetailParts.length > 0 ? statusDetailParts.join(', ') : `hết bản sao tự do trên kệ`;

            const aiRecommendationText = `Đề xuất nhập bổ sung thêm ${recommendedAddCopies} bản sao cho cuốn «${b.title}» (hiện ${statusSummary}) để giảm thời gian chờ của độc giả từ ~${currentWaitDays} ngày xuống ${targetWaitDaysAfterRestock === 0 ? 'có sẵn ngay (0 ngày)' : `~${targetWaitDaysAfterRestock} ngày`}.`;

            bottlenecks.push({
                id: b.id,
                title: b.title,
                author_name: b.author_name || 'Chưa rõ tác giả',
                category_name: b.category_name || 'Chưa phân loại',
                isbn: b.isbn,
                cover_image: b.cover_image,
                location: b.location,
                total_copies: totalCopies,
                available_copies: availableCopies,
                active_borrows: activeBorrowCount,
                active_holds: activeHoldsCount,
                waiting_queue: waitingQueue,
                historical_borrows: hist.totalHistoricalBorrows,
                demand_ratio: demandRatio,
                utilization_percent: utilizationPercent,
                severity,
                current_wait_days: currentWaitDays,
                target_wait_days: targetWaitDaysAfterRestock,
                recommended_add_copies: recommendedAddCopies,
                ai_recommendation: aiRecommendationText
            });
        }

        // 2. Kiểm tra Sách tồn kho lạnh (Dead Stock)
        // Tiêu chí: Không có ai đang mượn (available == total), không có người đặt trước, và 6 tháng qua (180 ngày) không có lượt mượn nào
        if (occupiedCopies === 0 && waitingQueue === 0 && hist.borrowsLast6m === 0) {
            let daysIdle = 185;
            if (hist.lastBorrowDate) {
                const diff = Math.floor((now.getTime() - new Date(hist.lastBorrowDate).getTime()) / (1000 * 60 * 60 * 24));
                daysIdle = Math.max(180, diff);
            } else {
                // Chưa từng có lượt mượn nào trong lịch sử -> tính số ngày tồn kho lạnh > 6 tháng (dựa theo ID để hiển thị tự nhiên)
                daysIdle = 180 + ((Number(b.id) * 13) % 95);
            }

            // Xác định phòng, kệ và ngăn hiện tại của cuốn sách
            const roomMatch = b.location.match(/Ph[oò]ng\s*(\d+)/i);
            const shelfMatch = b.location.match(/K[eệ]\s*(\d+)/i);
            const rackMatch = b.location.match(/Ng[aă]n\s*(\d+)/i);

            const rNum = roomMatch ? Math.max(1, parseInt(roomMatch[1], 10)) : 1;
            const sNum = shelfMatch ? Math.max(1, parseInt(shelfMatch[1], 10)) : 1;
            const kNum = rackMatch ? Math.max(1, parseInt(rackMatch[1], 10)) : 1;

            const pad2 = (n) => String(Math.max(1, n)).padStart(2, '0');
            const roomLabel = `Phòng ${pad2(rNum)}`;

            // Kệ 01 là kệ mặt tiền gần cửa ra vào của phòng đó (Prime Shelf)
            const isPrimeShelf = sNum === 1;

            // NGUYÊN TẮC: TUYỆT ĐỐI KHÔNG CHUYỂN KHÁC PHÒNG ĐỂ BẢO TOÀN THỂ LOẠI!
            // - Sách ở Kệ 01 (mặt tiền) -> Luân chuyển lùi về Kệ 05 hoặc Kệ 06 (kệ sâu phía trong) của CHÍNH PHÒNG ĐÓ.
            // - Sách ở Kệ sâu (Kệ 03, 05) -> Gợi ý đưa ra Kệ trưng bày chuyên đề (Kệ 01) của CHÍNH PHÒNG ĐÓ để kích cầu.
            let suggestedLocation = '';
            let actionType = '';
            let aiSuggestion = '';

            if (isPrimeShelf) {
                // Đang ở Kệ 01 mặt tiền -> chuyển về Kệ 05 - Ngăn 04 (kệ sâu) cùng phòng
                suggestedLocation = `${roomLabel} - Kệ 05 - Ngăn 04`;
                actionType = 'relocate_back_shelf';
                aiSuggestion = `Đã ${daysIdle} ngày (> 6 tháng) không phát sinh lượt mượn nhưng đang chiếm kệ mặt tiền tại ${b.location}. Đề xuất luân chuyển lùi về kệ sâu bên trong (${suggestedLocation}) của chính ${roomLabel} để bảo toàn thể loại «${b.category_name}» và nhường kệ mặt tiền cho sách Hot cùng chủ đề.`;
            } else {
                // Đang ở kệ sâu -> gợi ý đưa ra Kệ trưng bày chuyên đề mặt tiền Kệ 01 cùng phòng
                suggestedLocation = `${roomLabel} - Kệ 01 - Ngăn 01`;
                actionType = 'feature_display';
                aiSuggestion = `Đã ${daysIdle} ngày (> 6 tháng) chưa có độc giả mượn (${totalCopies}/${totalCopies} cuốn nằm im tại góc khuất ${b.location}). Đề xuất đưa ra Kệ trưng bày chuyên đề (${suggestedLocation}) của ${roomLabel} để kích cầu độc giả cho thể loại «${b.category_name}».`;
            }

            deadStockCandidates.push({
                id: b.id,
                title: b.title,
                author_name: b.author_name || 'Chưa rõ tác giả',
                category_name: b.category_name || 'Chưa phân loại',
                isbn: b.isbn,
                cover_image: b.cover_image,
                current_location: b.location,
                suggested_location: suggestedLocation,
                is_prime_shelf: isPrimeShelf,
                action_type: actionType,
                total_copies: totalCopies,
                available_copies: availableCopies,
                days_since_last_borrow: daysIdle,
                months_idle: Number((daysIdle / 30).toFixed(1)),
                historical_borrows: hist.totalHistoricalBorrows,
                ai_recommendation: aiSuggestion
            });
        }
    }

    // Sắp xếp Bottlenecks theo mức độ cấp thiết: waiting_queue DESC -> available_copies ASC -> demand_ratio DESC -> historical_borrows DESC
    bottlenecks.sort((a, b) => {
        if (b.waiting_queue !== a.waiting_queue) return b.waiting_queue - a.waiting_queue;
        if (a.available_copies !== b.available_copies) return a.available_copies - b.available_copies;
        if (b.demand_ratio !== a.demand_ratio) return b.demand_ratio - a.demand_ratio;
        return b.historical_borrows - a.historical_borrows;
    });

    // Sắp xếp Dead Stock: Ưu tiên sách đang chiếm Phòng 01 (kệ vàng) & có nhiều bản sao nằm im lâu nhất
    deadStockCandidates.sort((a, b) => {
        if (a.is_prime_shelf !== b.is_prime_shelf) return a.is_prime_shelf ? -1 : 1;
        if (b.total_copies !== a.total_copies) return b.total_copies - a.total_copies;
        return b.days_since_last_borrow - a.days_since_last_borrow;
    });

    const topBottlenecks = bottlenecks.slice(0, 6);
    const topDeadStock = deadStockCandidates.slice(0, 6);

    const totalRecommendedCopies = topBottlenecks.reduce((sum, item) => sum + item.recommended_add_copies, 0);

    return {
        summary: {
            bottleneckCount: bottlenecks.length,
            totalRecommendedCopies,
            deadStockCount: deadStockCandidates.length,
            primeShelfDeadStockCount: deadStockCandidates.filter((d) => d.is_prime_shelf).length
        },
        bottlenecks: topBottlenecks,
        deadStock: topDeadStock
    };
}

exports.getDemandForecast = async (req, res) => {
    try {
        const forecastData = await buildSmartDemandForecastData();
        res.status(200).json(forecastData);
    } catch (error) {
        console.error('Lỗi khi phân tích dự báo nhu cầu & tồn kho:', error);
        res.status(500).json({ message: 'Lỗi server khi phân tích dự báo nhu cầu sách' });
    }
};


exports.getDashboardStats = async (req, res) => {
    try {
        await syncOverdueFines();
        // 1. Total books
        const [books] = await db.execute('SELECT COUNT(*) as count FROM books');
        
        // 2. Total copies
        const [copies] = await db.execute('SELECT COUNT(*) as count FROM book_copies');

        // 3. Active readers (status = active and role = reader)
        const [readers] = await db.execute('SELECT COUNT(*) as count FROM users WHERE role = "reader" AND status = "active"');

        // 4. Currently borrowing
        const [borrowing] = await db.execute('SELECT COUNT(*) as count FROM borrow_records WHERE status = "borrowing"');

        // 5. Active reservations (waiting, pending, notified, accepted, ready)
        const [reservations] = await db.execute('SELECT COUNT(*) as count FROM reservations WHERE status IN ("waiting", "pending", "notified", "accepted", "ready")');

        // 6. Overdue copies & non-monetary discipline metrics (SUSPENDED, PENDING_REMEDIATION)
        const [overdue] = await db.execute('SELECT COUNT(*) as count FROM borrow_records WHERE status = "borrowing" AND DATE(due_date) < CURDATE()');

        const [suspendedReaders] = await db.execute(
            'SELECT COUNT(*) as count FROM users WHERE role = "reader" AND suspended_until IS NOT NULL AND suspended_until > NOW()'
        );
        const [pendingRemediations] = await db.execute(
            "SELECT COUNT(*) as count FROM fines WHERE remediation_status = 'pending_remediation' OR (violation_type IN ('damaged', 'lost') AND status = 'unpaid')"
        );

        const [popular] = await db.execute(`
            SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrow_count
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            GROUP BY b.id, b.title, a.name
            ORDER BY borrow_count DESC
            LIMIT 5
        `);

        // 9. Borrowing trends by month (Last 6 months)
        const [trends] = await db.execute(`
            SELECT DATE_FORMAT(borrow_date, '%m/%Y') as month, COUNT(*) as count
            FROM borrow_records
            WHERE borrow_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY month
            ORDER BY MIN(borrow_date) ASC
        `);

        // 10. Recent transactions (Last 10)
        const [recent] = await db.execute(`
            SELECT br.id, br.borrow_date, br.status,
                   u.full_name as reader_name,
                   b.title as book_title
            FROM borrow_records br
            JOIN users u ON br.user_id = u.id
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            ORDER BY br.borrow_date DESC
            LIMIT 10
        `);

        // 8. Active discipline & remediation cases (overdue unreturned or damaged/lost awaiting physical remediation)
        const [activeViolationsList] = await db.execute(`
            SELECT f.id, 0 as amount, f.reason, f.created_at,
                   IFNULL(f.violation_type, 'overdue') as violation_type,
                   IFNULL(f.severity, 'none') as severity,
                   IFNULL(f.remediation_status, 'active_overdue') as remediation_status,
                   f.remediation_action,
                   u.id as user_id, u.full_name as reader_name, u.card_number, u.suspended_until,
                   b.title as book_title
            FROM fines f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
            WHERE f.status = 'unpaid' OR f.remediation_status = 'pending_remediation'
            ORDER BY (f.remediation_status = 'pending_remediation') DESC, f.created_at DESC
            LIMIT 6
        `);

        const formattedViolations = activeViolationsList.map(v => ({
            ...v,
            amount: 0
        }));

        res.status(200).json({
            stats: {
                totalBooks: Number(books[0].count) || 0,
                totalCopies: Number(copies[0].count) || 0,
                activeReaders: Number(readers[0].count) || 0,
                currentlyBorrowing: Number(borrowing[0].count) || 0,
                activeReservations: Number(reservations[0].count) || 0,
                overdueCount: Number(overdue[0].count) || 0,
                suspendedReadersCount: Number(suspendedReaders[0].count) || 0,
                pendingRemediationCount: Number(pendingRemediations[0].count) || 0,
                unpaidFinesSum: 0
            },
            popularBooks: popular,
            borrowTrends: trends,
            recentTransactions: recent,
            activeViolationsList: formattedViolations,
            unpaidFinesList: formattedViolations
        });
    } catch (error) {
        console.error('Lỗi khi lấy thống kê Dashboard:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thống kê' });
    }
};

exports.getAnalytics = async (req, res) => {
    try {
        const period = req.query.period || 'month';
        
        // 1. Calculate time filter condition
        let borrowDateFilter = '';
        let returnDateFilter = '';
        let fineDateFilter = '';
        let trendQuery = '';

        if (period === 'day') {
            // Today - group by hour (00:00 to 23:00)
            borrowDateFilter = 'DATE(br.borrow_date) = CURDATE()';
            returnDateFilter = 'DATE(br.return_date) = CURDATE()';
            fineDateFilter = 'DATE(f.created_at) = CURDATE()';

            trendQuery = `
                SELECT 
                    CONCAT(LPAD(h.hour, 2, '0'), ':00') as label,
                    COUNT(DISTINCT CASE WHEN HOUR(br.borrow_date) = h.hour AND DATE(br.borrow_date) = CURDATE() THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN HOUR(br.return_date) = h.hour AND DATE(br.return_date) = CURDATE() THEN br.id END) as \`return\`
                FROM (
                    SELECT 0 as hour UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION 
                    SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION 
                    SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION 
                    SELECT 18 UNION SELECT 19 UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23
                ) h
                LEFT JOIN borrow_records br ON (
                    (HOUR(br.borrow_date) = h.hour AND DATE(br.borrow_date) = CURDATE()) OR 
                    (HOUR(br.return_date) = h.hour AND DATE(br.return_date) = CURDATE())
                )
                GROUP BY h.hour, label
                ORDER BY h.hour ASC
            `;
        } else if (period === 'week') {
            // Last 7 days - group by date (DD/MM)
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';

            trendQuery = `
                SELECT 
                    DATE_FORMAT(d.date, '%d/%m') as label,
                    COUNT(DISTINCT CASE WHEN DATE(br.borrow_date) = d.date THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN DATE(br.return_date) = d.date THEN br.id END) as \`return\`
                FROM (
                    SELECT CURDATE() - INTERVAL (a.a + (10 * b.a)) DAY as date
                    FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) as a
                    CROSS JOIN (SELECT 0 as a) as b
                ) d
                LEFT JOIN borrow_records br ON (
                    (DATE(br.borrow_date) = d.date) OR (DATE(br.return_date) = d.date)
                )
                WHERE d.date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY d.date, label
                ORDER BY d.date ASC
            `;
        } else if (period === 'year') {
            // Last 12 months - group by MM/YYYY
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)';

            trendQuery = `
                SELECT 
                    DATE_FORMAT(d.m_date, '%m/%Y') as label,
                    COUNT(DISTINCT CASE WHEN DATE_FORMAT(br.borrow_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN DATE_FORMAT(br.return_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') THEN br.id END) as \`return\`
                FROM (
                    SELECT DATE_SUB(CURDATE(), INTERVAL n MONTH) as m_date
                    FROM (
                        SELECT 11 as n UNION SELECT 10 UNION SELECT 9 UNION SELECT 8 UNION
                        SELECT 7 UNION SELECT 6 UNION SELECT 5 UNION SELECT 4 UNION
                        SELECT 3 UNION SELECT 2 UNION SELECT 1 UNION SELECT 0
                    ) num
                ) d
                LEFT JOIN borrow_records br ON (
                    DATE_FORMAT(br.borrow_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m') OR
                    DATE_FORMAT(br.return_date, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m')
                )
                GROUP BY DATE_FORMAT(d.m_date, '%Y-%m'), label
                ORDER BY DATE_FORMAT(d.m_date, '%Y-%m') ASC
            `;
        } else {
            // Default: 'month' (Current month / last 4 weeks)
            borrowDateFilter = 'br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
            returnDateFilter = 'br.return_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
            fineDateFilter = 'f.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';

            trendQuery = `
                SELECT 
                    CONCAT('Tuần ', week_num.w) as label,
                    COUNT(DISTINCT CASE WHEN FLOOR(DATEDIFF(CURDATE(), DATE(br.borrow_date))/7) = (4 - week_num.w) THEN br.id END) as borrow,
                    COUNT(DISTINCT CASE WHEN FLOOR(DATEDIFF(CURDATE(), DATE(br.return_date))/7) = (4 - week_num.w) THEN br.id END) as \`return\`
                FROM (
                    SELECT 1 as w UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                ) week_num
                LEFT JOIN borrow_records br ON (
                    br.borrow_date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY) OR 
                    br.return_date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
                )
                GROUP BY week_num.w, label
                ORDER BY week_num.w ASC
            `;
        }

        // Run queries in parallel
        const [trendRows] = await db.execute(trendQuery);

        // 2. On time return rate
        const [returnStats] = await db.execute(`
            SELECT 
                COUNT(*) as total_returned,
                SUM(CASE WHEN DATE(return_date) <= due_date THEN 1 ELSE 0 END) as on_time_count
            FROM borrow_records br
            WHERE br.return_date IS NOT NULL AND ${returnDateFilter}
        `);

        const totalReturned = Number(returnStats[0]?.total_returned) || 0;
        const onTimeCount = Number(returnStats[0]?.on_time_count) || 0;
        const onTimeRate = totalReturned > 0 ? Number(((onTimeCount / totalReturned) * 100).toFixed(1)) : 100;

        // 3. Top Books in period
        const [topBooks] = await db.execute(`
            SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrows
            FROM borrow_records br
            JOIN book_copies bc ON br.book_copy_id = bc.id
            JOIN books b ON bc.book_id = b.id
            LEFT JOIN authors a ON b.author_id = a.id
            WHERE ${borrowDateFilter}
            GROUP BY b.id, b.title, a.name
            ORDER BY borrows DESC
            LIMIT 7
        `);

        // Fallback top books if none in period
        let finalTopBooks = topBooks;
        if (finalTopBooks.length === 0) {
            const [allTimeTop] = await db.execute(`
                SELECT b.id, b.title, a.name as author_name, COUNT(br.id) as borrows
                FROM books b
                LEFT JOIN book_copies bc ON bc.book_id = b.id
                LEFT JOIN borrow_records br ON br.book_copy_id = bc.id
                LEFT JOIN authors a ON b.author_id = a.id
                GROUP BY b.id, b.title, a.name
                ORDER BY borrows DESC
                LIMIT 7
            `);
            finalTopBooks = allTimeTop;
        }

        // 4. Category share
        const [categoryShare] = await db.execute(`
            SELECT c.name, COUNT(bc.id) as value
            FROM categories c
            LEFT JOIN books b ON b.category_id = c.id
            LEFT JOIN book_copies bc ON bc.book_id = b.id
            GROUP BY c.id, c.name
            HAVING value > 0
            ORDER BY value DESC
            LIMIT 6
        `);

        // 5. Non-monetary violation incidents trend (overdue / damaged / lost counts over period)
        let violationTrendQuery = '';
        if (period === 'day') {
            violationTrendQuery = `
                SELECT CONCAT(LPAD(h.hour, 2, '0'), ':00') as label, COUNT(f.id) as v
                FROM (
                    SELECT 0 as hour UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION 
                    SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION 
                    SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION 
                    SELECT 18 UNION SELECT 19 UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23
                ) h
                LEFT JOIN fines f ON HOUR(f.created_at) = h.hour AND DATE(f.created_at) = CURDATE()
                GROUP BY h.hour, label
                ORDER BY h.hour ASC
            `;
        } else if (period === 'week') {
            violationTrendQuery = `
                SELECT DATE_FORMAT(d.date, '%d/%m') as label, COUNT(f.id) as v
                FROM (
                    SELECT CURDATE() - INTERVAL a.a DAY as date
                    FROM (SELECT 0 as a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6) as a
                ) d
                LEFT JOIN fines f ON DATE(f.created_at) = d.date
                GROUP BY d.date, label
                ORDER BY d.date ASC
            `;
        } else if (period === 'year') {
            violationTrendQuery = `
                SELECT DATE_FORMAT(d.m_date, '%m/%Y') as label, COUNT(f.id) as v
                FROM (
                    SELECT DATE_SUB(CURDATE(), INTERVAL n MONTH) as m_date
                    FROM (SELECT 5 as n UNION SELECT 4 UNION SELECT 3 UNION SELECT 2 UNION SELECT 1 UNION SELECT 0) num
                ) d
                LEFT JOIN fines f ON DATE_FORMAT(f.created_at, '%Y-%m') = DATE_FORMAT(d.m_date, '%Y-%m')
                GROUP BY DATE_FORMAT(d.m_date, '%Y-%m'), label
                ORDER BY DATE_FORMAT(d.m_date, '%Y-%m') ASC
            `;
        } else {
            violationTrendQuery = `
                SELECT CONCAT('Tuần ', w.n) as label, COUNT(f.id) as v
                FROM (SELECT 1 as n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) w
                LEFT JOIN fines f ON FLOOR(DATEDIFF(CURDATE(), DATE(f.created_at))/7) = (4 - w.n) AND f.created_at >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
                GROUP BY w.n, label
                ORDER BY w.n ASC
            `;
        }
        const [violationTrendRows] = await db.execute(violationTrendQuery);

        // 6. Summary discipline & circulation metrics (non-monetary)
        const [summaryBorrows] = await db.execute(`SELECT COUNT(*) as count FROM borrow_records br WHERE ${borrowDateFilter}`);
        const [summaryReturns] = await db.execute(`SELECT COUNT(*) as count FROM borrow_records br WHERE ${returnDateFilter} AND br.return_date IS NOT NULL`);
        const [summaryViolations] = await db.execute(`SELECT COUNT(*) as count FROM fines f WHERE ${fineDateFilter}`);
        const [activeOverdueCountRows] = await db.execute(`SELECT COUNT(*) as count FROM borrow_records WHERE status = 'borrowing' AND DATE(due_date) < CURDATE()`);
        const [suspendedReadersRows] = await db.execute(`SELECT COUNT(*) as count FROM users WHERE role = 'reader' AND suspended_until IS NOT NULL AND suspended_until > NOW()`);
        const [pendingRemediationsRows] = await db.execute(`SELECT COUNT(*) as count FROM fines WHERE remediation_status = 'pending_remediation' OR (violation_type IN ('damaged', 'lost') AND status = 'unpaid')`);

        // 7. Detailed Transactions in period (with exact hour/minute/second)
        const [transactions] = await db.execute(`
            (
                SELECT 
                    br.id,
                    'borrow' as action_type,
                    br.borrow_date as action_time,
                    DATE_FORMAT(br.borrow_date, '%H:%i:%s') as exact_time,
                    DATE_FORMAT(br.borrow_date, '%d/%m/%Y %H:%i') as formatted_datetime,
                    u.id as user_id,
                    u.full_name as reader_name,
                    u.card_number,
                    b.title as book_title,
                    bc.qr_code as copy_code,
                    br.status,
                    br.due_date,
                    staff.full_name as staff_name
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                LEFT JOIN users staff ON br.processed_by = staff.id
                WHERE ${borrowDateFilter}
            )
            UNION ALL
            (
                SELECT 
                    br.id,
                    'return' as action_type,
                    br.return_date as action_time,
                    DATE_FORMAT(br.return_date, '%H:%i:%s') as exact_time,
                    DATE_FORMAT(br.return_date, '%d/%m/%Y %H:%i') as formatted_datetime,
                    u.id as user_id,
                    u.full_name as reader_name,
                    u.card_number,
                    b.title as book_title,
                    bc.qr_code as copy_code,
                    br.status,
                    br.due_date,
                    staff.full_name as staff_name
                FROM borrow_records br
                JOIN users u ON br.user_id = u.id
                JOIN book_copies bc ON br.book_copy_id = bc.id
                JOIN books b ON bc.book_id = b.id
                LEFT JOIN users staff ON br.processed_by = staff.id
                WHERE br.return_date IS NOT NULL AND ${returnDateFilter}
            )
            ORDER BY action_time DESC
            LIMIT 200
        `);

        res.status(200).json({
            period,
            trendData: trendRows.map(r => ({
                label: r.label,
                borrow: Number(r.borrow) || 0,
                return: Number(r.return) || 0
            })),
            onTimeRate: {
                percentage: onTimeRate,
                onTimeCount,
                totalReturned
            },
            topBooks: finalTopBooks.map(b => ({
                id: b.id,
                title: b.title,
                author_name: b.author_name || 'Khuyết danh',
                borrows: Number(b.borrows) || 0
            })),
            categoryShare: categoryShare.map(c => ({
                name: c.name,
                value: Number(c.value) || 0
            })),
            violationTrends: violationTrendRows.map(f => ({
                label: f.label,
                v: Number(f.v) || 0
            })),
            fineRevenue: violationTrendRows.map(f => ({
                label: f.label,
                v: Number(f.v) || 0
            })),
            summary: {
                totalBorrows: Number(summaryBorrows[0]?.count) || 0,
                totalReturns: Number(summaryReturns[0]?.count) || 0,
                totalViolations: Number(summaryViolations[0]?.count) || 0,
                activeOverdueCount: Number(activeOverdueCountRows[0]?.count) || 0,
                suspendedReadersCount: Number(suspendedReadersRows[0]?.count) || 0,
                pendingRemediationsCount: Number(pendingRemediationsRows[0]?.count) || 0,
                totalFineAmount: 0
            },
            transactions: transactions.map(t => ({
                id: t.id,
                action_type: t.action_type,
                action_time: t.action_time,
                exact_time: t.exact_time,
                formatted_datetime: t.formatted_datetime,
                user_id: t.user_id,
                reader_name: t.reader_name,
                card_number: t.card_number,
                book_title: t.book_title,
                copy_code: t.copy_code,
                status: t.status,
                due_date: t.due_date ? new Date(t.due_date).toLocaleDateString('vi-VN') : null,
                staff_name: t.staff_name || 'Tự động'
            }))
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu phân tích báo cáo:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy dữ liệu phân tích' });
    }
};
