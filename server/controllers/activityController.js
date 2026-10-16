const db = require('../config/db');

exports.getActivityLogs = async (req, res) => {
    try {
        const [logs] = await db.execute(`
            SELECT al.*, u.full_name as user_name, u.email as user_email, u.role as user_role
            FROM activity_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT 100
        `);
        res.status(200).json(logs);
    } catch (error) {
        console.error('Lỗi khi lấy nhật ký hoạt động:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy nhật ký hoạt động' });
    }
};

exports.createLog = async (userId, action, targetType, targetId, details) => {
    try {
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [userId || null, action, targetType || null, targetId || null, details || null]
        );
    } catch (error) {
        console.error('Lỗi khi ghi activity log:', error);
    }
};
