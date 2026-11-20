const { saveBase64ToDisk } = require('../utils/fileStorage');

/**
 * POST /api/upload
 * Accepts { image: "data:image/png;base64,...", subfolder: "covers"|"proofs"|"avatars" }
 * Returns { url: "/uploads/<subfolder>/<filename>" }
 */
exports.uploadImage = async (req, res) => {
    try {
        const { image, subfolder = 'general', prefix = 'media' } = req.body;
        if (!image || typeof image !== 'string') {
            return res.status(400).json({ message: 'Vui lòng cung cấp dữ liệu hình ảnh (base64 data URI)' });
        }

        const safeSubfolder = ['covers', 'proofs', 'avatars', 'general'].includes(subfolder) ? subfolder : 'general';
        const fileUrl = await saveBase64ToDisk(image, safeSubfolder, prefix);

        if (!fileUrl) {
            return res.status(400).json({ message: 'Không thể xử lý hình ảnh tải lên' });
        }

        return res.status(200).json({
            status: 'success',
            url: fileUrl,
            message: 'Tải tệp tin lên hệ thống thành công'
        });
    } catch (err) {
        console.error('Error in uploadImage:', err);
        return res.status(500).json({ message: 'Lỗi máy chủ khi lưu tệp tin', error: err.message });
    }
};

