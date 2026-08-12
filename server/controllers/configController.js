const db = require('../config/db');

exports.getConfigs = async (req, res) => {
    try {
        const [configs] = await db.execute('SELECT * FROM system_configs');
        const configMap = Object.fromEntries(configs.map(c => [c.key_name, { value: c.value, description: c.description }]));
        res.status(200).json(configMap);
    } catch (error) {
        console.error('Lỗi khi lấy cấu hình hệ thống:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.updateConfigs = async (req, res) => {
    const { configs } = req.body;
    const processedBy = req.user.id;

    try {
        if (!configs || typeof configs !== 'object') {
            return res.status(400).json({ message: 'Vui lòng cung cấp cấu hình hợp lệ' });
        }

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            for (const [key, value] of Object.entries(configs)) {
                await connection.execute(
                    'UPDATE system_configs SET value = ? WHERE key_name = ?',
                    [String(value), key]
                );
            }

            // Save activity log
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'UPDATE_CONFIG', 'system_configs', null, `Cập nhật cấu hình hệ thống: ${JSON.stringify(configs)}`]
            );

            await connection.commit();
            res.status(200).json({ message: 'Đã cập nhật cấu hình hệ thống thành công' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Lỗi khi cập nhật cấu hình:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};
