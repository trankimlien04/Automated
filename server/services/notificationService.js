const db = require('../config/db');

/**
 * Gửi thông báo tới 1 người dùng cụ thể
 */
async function notifyUser(userId, title, message, type = 'info') {
    if (!userId) return;
    try {
        await db.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
            [userId, title, message, type]
        );
    } catch (err) {
        console.error(`Lỗi gửi thông báo tới user #${userId}:`, err);
    }
}

/**
 * Gửi thông báo tới tất cả người dùng active thuộc danh sách roles (vd: ['librarian', 'admin', 'owner'])
 */
async function notifyRoles(roles, title, message, type = 'info', excludeUserId = null) {
    if (!roles || roles.length === 0) return;
    try {
        const placeholders = roles.map(() => '?').join(',');
        const queryParams = [...roles];
        let sql = `SELECT id FROM users WHERE role IN (${placeholders}) AND status = 'active'`;
        
        if (excludeUserId) {
            sql += ` AND id != ?`;
            queryParams.push(excludeUserId);
        }

        const [users] = await db.execute(sql, queryParams);
        for (const u of users) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
                [u.id, title, message, type]
            );
        }
    } catch (err) {
        console.error(`Lỗi gửi thông báo theo role [${roles.join(', ')}]:`, err);
    }
}

/**
 * Gửi thông báo tới toàn bộ ban điều hành thư viện (Thủ thư, Admin, Chủ thư viện)
 */
async function notifyAllStaff(title, message, type = 'info', excludeUserId = null) {
    return notifyRoles(['librarian', 'admin', 'owner'], title, message, type, excludeUserId);
}

module.exports = {
    notifyUser,
    notifyRoles,
    notifyAllStaff
};
