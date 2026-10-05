const db = require('../config/db');

// 1. Get all current system configs
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

// 2. Get list of config change requests (Maker - Checker history & queue)
exports.getConfigRequests = async (req, res) => {
    try {
        const query = `
            SELECT 
                ccr.*,
                u1.full_name AS requested_by_name,
                u1.email AS requested_by_email,
                u2.full_name AS reviewed_by_name,
                sc.description AS config_description
            FROM config_change_requests ccr
            LEFT JOIN users u1 ON ccr.requested_by = u1.id
            LEFT JOIN users u2 ON ccr.reviewed_by = u2.id
            LEFT JOIN system_configs sc ON ccr.key_name = sc.key_name
            ORDER BY ccr.created_at DESC
        `;
        const [requests] = await db.execute(query);
        res.status(200).json(requests);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đề xuất cấu hình:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 3. Admin proposes a new config change (Maker)
exports.proposeConfigChange = async (req, res) => {
    const { key_name, proposed_value, reason } = req.body;
    const requestedBy = req.user.id;

    if (!key_name || proposed_value === undefined || proposed_value === null || proposed_value === '') {
        return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin tham số và giá trị đề xuất' });
    }

    try {
        // Check if there is already a pending request for this key (BR-08)
        const [pending] = await db.execute(
            'SELECT id FROM config_change_requests WHERE key_name = ? AND status = "pending"',
            [key_name]
        );

        if (pending.length > 0) {
            return res.status(409).json({ 
                message: `Tham số "${key_name}" hiện đã có một đề xuất đang chờ Giám đốc duyệt. Không thể tạo thêm!` 
            });
        }

        // Get current value
        const [current] = await db.execute('SELECT value FROM system_configs WHERE key_name = ?', [key_name]);
        const currentValue = current.length > 0 ? current[0].value : null;

        // Insert new proposal
        const [result] = await db.execute(
            `INSERT INTO config_change_requests (key_name, current_value, proposed_value, reason, requested_by, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [key_name, currentValue, String(proposed_value), reason || 'Đề xuất cập nhật tham số', requestedBy]
        );

        // Record activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [requestedBy, 'PROPOSE_CONFIG', 'config_change_requests', result.insertId, `Đề xuất đổi ${key_name} từ "${currentValue}" sang "${proposed_value}". Lý do: ${reason || 'N/A'}`]
        );

        // Notify all owners
        const [owners] = await db.execute('SELECT id FROM users WHERE role = "owner" AND status = "active"');
        for (const owner of owners) {
            await db.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    owner.id,
                    'Đề xuất thay đổi cấu hình mới',
                    `Admin đã gửi đề xuất thay đổi tham số "${key_name}" sang giá trị "${proposed_value}". Vui lòng xem xét phê duyệt.`
                ]
            );
        }

        res.status(201).json({ 
            message: 'Đã gửi đề xuất thay đổi cấu hình tới Giám đốc / Chủ thư viện thành công!',
            requestId: result.insertId
        });
    } catch (error) {
        console.error('Lỗi khi gửi đề xuất cấu hình:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// 4. Owner reviews (Approve / Reject) config proposal (Checker)
exports.reviewConfigRequest = async (req, res) => {
    const { id } = req.params;
    const { action, review_note } = req.body; // action: 'approved' | 'rejected'
    const reviewedBy = req.user.id;

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ message: 'Hành động không hợp lệ. Chỉ chấp nhận "approved" hoặc "rejected"' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // Find proposal and lock for update
        const [requests] = await connection.execute(
            'SELECT * FROM config_change_requests WHERE id = ? FOR UPDATE',
            [id]
        );

        if (requests.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy đề xuất cấu hình' });
        }

        const request = requests[0];

        if (request.status !== 'pending') {
            await connection.rollback();
            return res.status(409).json({ message: `Đề xuất này đã được xử lý trước đó với trạng thái: ${request.status}` });
        }

        const now = new Date();

        if (action === 'approved') {
            // 1. Update system_configs (BR-09)
            await connection.execute(
                'UPDATE system_configs SET value = ? WHERE key_name = ?',
                [request.proposed_value, request.key_name]
            );

            // 2. Update request record
            await connection.execute(
                'UPDATE config_change_requests SET status = "approved", reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?',
                [reviewedBy, now, review_note || 'Đã phê duyệt', id]
            );

            // 3. Log activity
            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [reviewedBy, 'APPROVE_CONFIG', 'config_change_requests', id, `Chủ thư viện phê duyệt thay đổi "${request.key_name}" thành "${request.proposed_value}". Ghi chú: ${review_note || 'Không'}`]
            );

            // 4. Send notification to requester
            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                [
                    request.requested_by,
                    'Đề xuất cấu hình đã được Phê duyệt',
                    `Chủ thư viện đã phê duyệt đề xuất đổi tham số "${request.key_name}" sang "${request.proposed_value}". Giá trị mới đã có hiệu lực.`
                ]
            );

            // 5. Notify all librarians and admins
            const [staff] = await connection.execute(
                'SELECT id FROM users WHERE role IN ("admin", "librarian") AND id != ? AND id != ? AND status = "active"',
                [request.requested_by, reviewedBy]
            );
            for (const s of staff) {
                await connection.execute(
                    'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
                    [
                        s.id,
                        'Cập nhật tham số hệ thống',
                        `Chủ thư viện vừa phê duyệt thay đổi tham số "${request.key_name}" sang giá trị mới "${request.proposed_value}".`
                    ]
                );
            }
        } else {
            // Rejected
            await connection.execute(
                'UPDATE config_change_requests SET status = "rejected", reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?',
                [reviewedBy, now, review_note || 'Bị từ chối', id]
            );

            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [reviewedBy, 'REJECT_CONFIG', 'config_change_requests', id, `Chủ thư viện từ chối thay đổi "${request.key_name}". Lý do: ${review_note || 'Không nêu'}`]
            );

            await connection.execute(
                'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "warning")',
                [
                    request.requested_by,
                    'Đề xuất cấu hình bị Từ chối',
                    `Chủ thư viện đã từ chối đề xuất đổi tham số "${request.key_name}". Lý do: ${review_note || 'Không có ghi chú'}.`
                ]
            );
        }

        await connection.commit();
        res.status(200).json({ 
            message: action === 'approved' ? 'Phê duyệt cấu hình thành công!' : 'Đã từ chối đề xuất cấu hình!',
            status: action
        });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi duyệt đề xuất cấu hình:', error);
        res.status(500).json({ message: 'Lỗi server' });
    } finally {
        connection.release();
    }
};

// Direct update fallback (Admin / Owner)
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

            await connection.execute(
                'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
                [processedBy, 'UPDATE_CONFIG', 'system_configs', null, `Cập nhật trực tiếp cấu hình hệ thống: ${JSON.stringify(configs)}`]
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
