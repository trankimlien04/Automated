const db = require('../config/db');

exports.getActivityLogs = async (req, res) => {
    try {
        const isLibrarian = req.user?.role === 'librarian';
        const whereClause = isLibrarian
            ? `WHERE al.user_id = ? OR al.target_type IN ('books', 'book_copies', 'book_requests')`
            : '';
        const params = isLibrarian ? [req.user.id] : [];

        const [logs] = await db.execute(`
            SELECT al.*, u.full_name as user_name, u.email as user_email, u.role as user_role
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ${whereClause}
            ORDER BY al.created_at DESC
            LIMIT 150
        `, params);
        res.status(200).json(logs);
    } catch (error) {
        console.error('Lỗi khi lấy nhật ký hoạt động:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy nhật ký hoạt động' });
    }
};

exports.createLog = async (userId, action, targetType, targetId, details, options = {}) => {
    try {
        const beforeData = options.beforeData !== undefined && options.beforeData !== null
            ? (typeof options.beforeData === 'string' ? options.beforeData : JSON.stringify(options.beforeData))
            : null;
        const afterData = options.afterData !== undefined && options.afterData !== null
            ? (typeof options.afterData === 'string' ? options.afterData : JSON.stringify(options.afterData))
            : null;
        const outcome = options.outcome || 'success';

        await db.execute(
            `INSERT INTO activity_logs (user_id, action, target_type, target_id, details, before_data, after_data, outcome)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId || null, action, targetType || null, targetId || null, details || null, beforeData, afterData, outcome]
        );
    } catch (error) {
        console.error('Lỗi khi ghi activity log:', error);
    }
};
