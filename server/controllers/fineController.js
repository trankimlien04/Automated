const db = require('../config/db');
const { notifyUser, notifyRoles, notifyAllStaff } = require('../services/notificationService');
const { syncOverdueFines } = require('../services/fineSyncService');

exports.getFines = async (req, res) => {
    const { role, id } = req.user;

    try {
        // Sync overdue fines in real-time before querying
        await syncOverdueFines(role === 'reader' ? id : null);

        let query = `
            SELECT f.id, f.amount, f.reason, f.status, f.payment_method, f.payment_channel, f.transaction_ref,
                   f.paid_at as payment_date, f.created_at,
                   u.full_name as reader_name, u.card_number,
                   b.title as book_title, bc.qr_code as book_copy_qr
            FROM fines f
            JOIN users u ON f.user_id = u.id
            LEFT JOIN borrow_records br ON f.borrow_record_id = br.id
            LEFT JOIN book_copies bc ON br.book_copy_id = bc.id
            LEFT JOIN books b ON bc.book_id = b.id
        `;
        const params = [];

        if (role === 'reader') {
            query += ' WHERE f.user_id = ?';
            params.push(id);
        }

        query += ' ORDER BY f.created_at DESC';

        const [results] = await db.execute(query, params);
        const formatted = results.map(r => ({
            ...r,
            amount: Number(r.amount) || 0
        }));
        res.status(200).json(formatted);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phí phạt:', error);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

exports.payFine = async (req, res) => {
    const { id } = req.params;
    const { payment_method, payment_channel, transaction_ref } = req.body || {};
    const processedBy = req.user.id;
    const userRole = req.user.role;

    try {
        const [fines] = await db.execute(`
            SELECT f.*, u.full_name as reader_name, u.card_number
            FROM fines f
            JOIN users u ON f.user_id = u.id
            WHERE f.id = ?
        `, [id]);

        if (fines.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy hóa đơn phí phạt' });
        }
        const fine = fines[0];

        // Reader can only pay their own fine
        if (userRole === 'reader' && fine.user_id !== processedBy) {
            return res.status(403).json({ message: 'Bạn không có quyền thanh toán khoản phạt của người khác' });
        }

        if (fine.status === 'paid') {
            return res.status(400).json({ message: 'Khoản phí phạt này đã được thanh toán từ trước' });
        }

        const finalMethod = payment_method || (userRole === 'reader' ? 'transfer' : 'cash');
        const finalChannel = payment_channel || (userRole === 'reader' ? 'online' : 'counter');
        const finalRef = transaction_ref || (finalMethod === 'transfer' ? `TXN-FINE-${id}-${Date.now().toString().slice(-6)}` : null);

        await db.execute(
            'UPDATE fines SET status = "paid", paid_at = NOW(), payment_method = ?, payment_channel = ?, transaction_ref = ? WHERE id = ?',
            [finalMethod, finalChannel, finalRef, id]
        );

        const methodLabel = finalMethod === 'transfer' ? 'Chuyển khoản VietQR' : 'Tiền mặt';
        const channelLabel = finalChannel === 'online' ? 'Online (Tự phục vụ)' : 'Tại quầy thư viện';

        // Save activity log
        await db.execute(
            'INSERT INTO activity_logs (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [processedBy, 'PAY_FINE', 'fines', id, `Thanh toán phí phạt #${id}: ${Number(fine.amount).toLocaleString('vi-VN')}đ. Phương thức: ${methodLabel} (${channelLabel}). Mã đối soát: ${finalRef || 'N/A'}`]
        );

        // Notify user
        await db.execute(
            'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, "info")',
            [
                fine.user_id,
                'Xác nhận thanh toán phí phạt',
                `Khoản phí phạt ${Number(fine.amount).toLocaleString('vi-VN')}đ (Lý do: ${fine.reason || 'Trễ hạn trả sách'}) đã được thanh toán thành công qua hình thức ${methodLabel} (${channelLabel}).`
            ]
        );

        // Notify all staff
        await notifyAllStaff(
            'Độc giả đã thanh toán phí phạt',
            `Độc giả ${fine.reader_name} (${fine.card_number}) vừa thanh toán khoản phạt ${Number(fine.amount).toLocaleString('vi-VN')}đ qua ${methodLabel} (${channelLabel}).`,
            'info',
            processedBy
        );

        res.status(200).json({ 
            message: 'Đã xác nhận thanh toán phí phạt thành công',
            fine: {
                id: fine.id,
                status: 'paid',
                payment_method: finalMethod,
                payment_channel: finalChannel,
                transaction_ref: finalRef
            }
        });
    } catch (error) {
        console.error('Lỗi khi thanh toán phí phạt:', error);
        res.status(500).json({ message: 'Lỗi server khi thanh toán phí phạt' });
    }
};

exports.getBankConfig = async (req, res) => {
    try {
        const [configs] = await db.execute(`
            SELECT key_name, value FROM system_configs 
            WHERE key_name IN ('bank_code', 'bank_name', 'bank_account_no', 'bank_account_name')
        `);
        const bankConfig = {
            bank_code: 'TPB',
            bank_name: 'TPBank (Ngân hàng Tiên Phong)',
            bank_account_no: '00000307092',
            bank_account_name: 'THU VIEN ATHENAEUM'
        };
        configs.forEach(c => {
            bankConfig[c.key_name] = c.value;
        });
        res.status(200).json(bankConfig);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin ngân hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy thông tin ngân hàng' });
    }
};
