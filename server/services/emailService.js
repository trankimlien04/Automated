const nodemailer = require('nodemailer');
const db = require('../config/db');

// Check if SMTP is configured in environment
const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
);

let transporter = null;
if (hasSmtpConfig) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

/**
 * Base email layout with Athenaeum Smart Library 4.0 branding
 */
function createEmailTemplate({ headerBadge, headerTitle, subtitle, contentHtml, actionButtonText, actionButtonUrl }) {
    return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${headerTitle}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
            .container { max-width: 600px; margin: 24px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0; }
            .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #2563eb 100%); padding: 32px 24px; text-align: center; color: #ffffff; }
            .badge { display: inline-block; padding: 4px 12px; background: rgba(255, 255, 255, 0.18); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
            .title { font-size: 22px; font-weight: 800; margin: 0 0 6px 0; color: #ffffff; }
            .subtitle { font-size: 13px; opacity: 0.9; margin: 0; color: #cbd5e1; }
            .body { padding: 28px 24px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 18px 0; }
            .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; text-align: center; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
            .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
            .footer p { margin: 4px 0; }
            .highlight { color: #2563eb; font-weight: 700; }
            .danger { color: #dc2626; font-weight: 700; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <span class="badge">${headerBadge || 'Smart Library 4.0'}</span>
                <h1 class="title">📚 Athenaeum Library</h1>
                <p class="subtitle">${subtitle || 'Hệ thống Quản lý Thư viện Thông minh'}</p>
            </div>
            <div class="body">
                ${contentHtml}
                ${actionButtonText && actionButtonUrl ? `
                <div style="text-align: center; margin-top: 24px;">
                    <a href="${actionButtonUrl}" class="btn">${actionButtonText}</a>
                </div>
                ` : ''}
            </div>
            <div class="footer">
                <p><strong>Thư viện Thông minh Athenaeum</strong> - Phục vụ lưu thông 24/7</p>
                <p>Hòm trả sách thông minh 24/7 luôn sẵn sàng ngoài giờ hành chính tại Cổng chính thư viện.</p>
                <p style="font-size: 11px; color: #94a3b8; margin-top: 10px;">Email tự động từ hệ thống. Vui lòng không trả lời trực tiếp email này.</p>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Record dispatch log into notification_dispatches table
 */
async function recordDispatch({ userId, recipientEmail, channel = 'email', templateType, title, contentPreview, status = 'sent', errorMessage = null }) {
    try {
        await db.execute(`
            INSERT INTO notification_dispatches 
            (user_id, recipient_email, channel, template_type, title, content_preview, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId || null,
            recipientEmail,
            channel,
            templateType,
            title,
            (contentPreview || '').substring(0, 500),
            status,
            errorMessage
        ]);
    } catch (err) {
        console.error('Lỗi khi ghi nhật ký dispatch thông báo:', err.message);
    }
}

/**
 * Dispatch an email (real or simulated)
 */
async function sendEmail({ to, subject, html, text, templateType = 'general', userId = null }) {
    if (!to) return { success: false, message: 'Thiếu email người nhận' };

    const fromAddress = process.env.SMTP_FROM || 'Athenaeum Smart Library <no-reply@athenaeum.edu.vn>';

    if (hasSmtpConfig && transporter) {
        try {
            const info = await transporter.sendMail({
                from: fromAddress,
                to,
                subject,
                text: text || subject,
                html
            });
            await recordDispatch({
                userId,
                recipientEmail: to,
                channel: 'email',
                templateType,
                title: subject,
                contentPreview: text || subject,
                status: 'delivered'
            });
            console.log(`📧 [EMAIL SENT] Successfully sent real email to ${to}: "${subject}" (MessageID: ${info.messageId})`);
            return { success: true, mode: 'smtp_real', messageId: info.messageId };
        } catch (error) {
            console.error(`❌ [EMAIL ERROR] Failed to send email to ${to}:`, error);
            await recordDispatch({
                userId,
                recipientEmail: to,
                channel: 'email',
                templateType,
                title: subject,
                contentPreview: text || subject,
                status: 'failed',
                errorMessage: error.message
            });
            return { success: false, error: error.message };
        }
    } else {
        // High-fidelity Simulated Email Mode (Perfect for Development / Testing / Demo)
        console.log(`✉️ [EMAIL SIMULATED] Dispatching to [${to}] | Subject: "${subject}" | Template: [${templateType}]`);
        await recordDispatch({
            userId,
            recipientEmail: to,
            channel: 'email',
            templateType,
            title: subject,
            contentPreview: text || subject,
            status: 'simulated'
        });
        return { success: true, mode: 'simulated', message: 'Email đã được phát hành qua kênh truyền thông tự động (Mô phỏng đa kênh thành công)' };
    }
}

/**
 * Kịch bản 1: Nhắc nhở sắp đến hạn trả sách (T - 2 ngày / Trước 48h)
 */
async function sendDueReminderEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, dueDate, daysLeft = 2 }) {
    const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN');
    const subject = `⏰ [Nhắc hạn trả sách] Cuốn "${bookTitle}" sắp đến hạn trả trong ${daysLeft} ngày`;
    const contentHtml = `
        <p>Xin chào <strong>${fullName || 'Bạn đọc'}</strong> (Mã thẻ: <code>${cardNumber || 'LIB-RD-***'}</code>),</p>
        <p>Hệ thống Thư viện Thông minh Athenaeum xin gửi lời chào và nhắc nhở thân thiện về tài liệu bạn đang mượn:</p>
        
        <div class="card">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">📖 ${bookTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao (QR):</strong> <code>${copyQr || 'N/A'}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Hạn hoàn trả:</strong> <span class="highlight">${dueDateStr}</span> (Còn <strong>${daysLeft} ngày</strong>)</p>
            <p style="margin: 4px 0; font-size: 13px; color: #059669;"><strong>Trạng thái:</strong> Trong hạn mượn an toàn</p>
        </div>

        <p>💡 <em>Bạn đọc có thể mang sách đến quầy thủ thư, trả nhanh tại <strong>Hòm trả sách 24/7</strong>, hoặc truy cập cổng thông tin để bấm <strong>Gia hạn thêm 7 ngày</strong> nếu sách chưa có người khác xếp hàng đặt trước.</em></p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Cảnh báo nhắc hạn chủ động (T - 2 ngày)',
            subtitle: 'Chăm sóc bạn đọc & Lưu thông tài liệu',
            contentHtml,
            actionButtonText: 'Truy cập tài khoản & Gia hạn trực tuyến',
            actionButtonUrl: 'http://localhost:5173/borrow'
        }),
        templateType: 'due_reminder_t2',
        text: `Nhắc nhở: Sách "${bookTitle}" sắp đến hạn vào ${dueDateStr}. Vui lòng sắp xếp hoàn trả hoặc gia hạn.`
    });
}

/**
 * Kịch bản 2: Hạn chót trả sách hôm nay (T - 0 ngày)
 */
async function sendDueTodayEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, dueDate }) {
    const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN');
    const subject = `⚠️ [HẠN CHÓT HÔM NAY] Cuốn "${bookTitle}" đến hạn trả hôm nay`;
    const contentHtml = `
        <p>Xin chào <strong>${fullName || 'Bạn đọc'}</strong> (Mã thẻ: <code>${cardNumber || 'LIB-RD-***'}</code>),</p>
        <p>Hôm nay (<strong>${dueDateStr}</strong>) là <strong style="color: #ea580c;">HẠN CHÓT</strong> để hoàn trả ấn phẩm sau đây về thư viện:</p>
        
        <div class="card" style="border-left: 4px solid #ea580c;">
            <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">📖 ${bookTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${copyQr || 'N/A'}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Hạn cuối:</strong> <span style="color: #ea580c; font-weight: 700;">Hôm nay (${dueDateStr})</span></p>
        </div>

        <p>🌟 <strong>Nếu bạn bận hoặc trả ngoài giờ hành chính:</strong> Bạn hoàn toàn có thể thả sách vào <strong>Hòm trả sách tự động 24/7 (Smart Book Drop)</strong> tại sảnh trước thư viện. Hệ thống sẽ ngay lập tức chốt thời gian trả và ngừng tính phí phạt!</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Hạn chót trả sách hôm nay (T - 0)',
            subtitle: 'Lưu ý hoàn trả để tránh phát sinh phí trễ hạn',
            contentHtml,
            actionButtonText: 'Xem hướng dẫn Trả hòm 24/7 & Bản đồ thư viện',
            actionButtonUrl: 'http://localhost:5173/borrow'
        }),
        templateType: 'due_today_t0',
        text: `Hôm nay là hạn chót trả sách "${bookTitle}". Vui lòng hoàn trả tại quầy hoặc thả vào Hòm trả 24/7.`
    });
}

/**
 * Kịch bản 3: Cảnh báo quá hạn & Phát sinh phí phạt (T + 1 ngày hoặc quá hạn)
 */
async function sendOverdueWarningEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, dueDate, overdueDays = 1, fineAmount = 5000 }) {
    const dueDateStr = new Date(dueDate).toLocaleDateString('vi-VN');
    const fineStr = fineAmount.toLocaleString('vi-VN') + ' đ';
    const subject = `🚨 [CẢNH BÁO QUÁ HẠN] Sách "${bookTitle}" đã quá hạn ${overdueDays} ngày`;
    const contentHtml = `
        <p>Xin chào <strong>${fullName || 'Bạn đọc'}</strong> (Mã thẻ: <code>${cardNumber || 'LIB-RD-***'}</code>),</p>
        <p>Hệ thống ghi nhận bạn đang giữ tài liệu đã quá hạn quy định của thư viện:</p>
        
        <div class="card" style="border-left: 4px solid #dc2626; background: #fef2f2;">
            <h3 style="margin-top: 0; color: #991b1b; font-size: 16px;">📖 ${bookTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${copyQr || 'N/A'}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Ngày đến hạn:</strong> ${dueDateStr}</p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Số ngày trễ hạn:</strong> <span class="danger">${overdueDays} ngày</span></p>
            <p style="margin: 4px 0; font-size: 14px;"><strong>Phí phạt tích lũy tạm tính:</strong> <span class="danger">${fineStr}</span></p>
        </div>

        <p class="danger">⚠️ Lưu ý: Theo quy chế Maker-Checker, tài khoản quá hạn từ 7 ngày trở lên sẽ tự động bị khóa quyền mượn sách. Vui lòng mang sách trả gấp để ngưng tích lũy phí phạt!</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Cảnh báo quá hạn & Phí phạt',
            subtitle: 'Đôn đốc thu hồi tài nguyên thư viện',
            contentHtml,
            actionButtonText: 'Thanh toán phí phạt & Xem chi tiết',
            actionButtonUrl: 'http://localhost:5173/fines'
        }),
        templateType: 'overdue_warning',
        text: `Cảnh báo: Sách "${bookTitle}" đã quá hạn ${overdueDays} ngày. Phí phạt hiện tại: ${fineStr}. Vui lòng trả sách sớm!`
    });
}

/**
 * Kịch bản 4: Biên nhận trả sách qua Hòm tự động 24/7 (Smart Book Drop Receipt)
 */
async function sendDropBoxReceiptEmail({ to, userId, fullName, cardNumber, bookTitle, copyQr, droppedAt }) {
    const timeStr = new Date(droppedAt || Date.now()).toLocaleString('vi-VN');
    const subject = `📦 [Hòm trả sách 24/7] Xác nhận đã thả sách "${bookTitle}" vào hòm`;
    const contentHtml = `
        <p>Xin chào <strong>${fullName || 'Bạn đọc'}</strong> (Mã thẻ: <code>${cardNumber || 'LIB-RD-***'}</code>),</p>
        <p>Hệ thống tự động ghi nhận bạn vừa hoàn tất thao tác thả sách vào <strong>Hòm trả sách ngoài giờ 24/7 (Smart Book Drop)</strong>:</p>
        
        <div class="card" style="border-left: 4px solid #0284c7; background: #f0f9ff;">
            <h3 style="margin-top: 0; color: #0369a1; font-size: 16px;">📖 ${bookTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Mã bản sao:</strong> <code>${copyQr || 'N/A'}</code></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Thời điểm thả hòm:</strong> <span class="highlight">${timeStr}</span></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Tính phí phạt:</strong> <span style="color: #059669; font-weight: 700;">Đã ngưng tính phạt tại mốc thời gian trên</span></p>
            <p style="margin: 4px 0; font-size: 13px;"><strong>Trạng thái:</strong> ⏳ Đang chờ thủ thư kiểm tra tình trạng sách đầu ca sáng</p>
        </div>

        <p>Thủ thư sẽ kiểm tra tình trạng nguyên vẹn của sách vào đầu ca làm việc tiếp theo. Bạn sẽ nhận được thông báo ngay khi sách được đối soát xong.</p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Hòm trả sách 24/7 - Biên nhận tạm',
            subtitle: 'Xác nhận tiếp nhận sách trả tự động ngoài giờ',
            contentHtml,
            actionButtonText: 'Kiểm tra trạng thái phiếu mượn',
            actionButtonUrl: 'http://localhost:5173/borrow'
        }),
        templateType: 'drop_box_receipt',
        text: `Đã ghi nhận thả sách "${bookTitle}" vào hòm 24/7 lúc ${timeStr}.`
    });
}

/**
 * Kịch bản 5: Vé thông hành ra cửa điện tử (Digital Exit Pass)
 */
async function sendExitPassEmail({ to, userId, fullName, cardNumber, passCode, bookCount, books = [], expiresAt }) {
    const expStr = new Date(expiresAt).toLocaleTimeString('vi-VN');
    const subject = `🎫 [Vé ra cửa] Vé thông hành mang sách ra khỏi thư viện (${passCode})`;
    
    const bookListHtml = books.map((b, i) => `
        <li style="margin: 6px 0; font-size: 13px;">
            <strong>${i + 1}. ${b.title || b.book_title}</strong> (Mã: <code>${b.qr_code || b.copy_qr || 'N/A'}</code>)
        </li>
    `).join('');

    const contentHtml = `
        <p>Xin chào <strong>${fullName || 'Bạn đọc'}</strong> (Mã thẻ: <code>${cardNumber || 'LIB-RD-***'}</code>),</p>
        <p>Bạn vừa thực hiện mượn sách thành công tại kệ. Dưới đây là <strong>Vé thông hành ra cửa điện tử (Exit Pass)</strong> của bạn:</p>
        
        <div class="card" style="border: 2px dashed #2563eb; background: #eff6ff; text-align: center;">
            <span style="font-size: 11px; font-weight: 700; color: #2563eb; text-transform: uppercase;">Mã Vé Ra Cửa</span>
            <h2 style="margin: 6px 0; color: #1e3a8a; font-family: monospace; letter-spacing: 0.1em;">${passCode}</h2>
            <p style="margin: 4px 0; font-size: 14px; font-weight: 700; color: #059669;">
                ✅ HỢP LỆ CHO PHÉP MANG RA: ${bookCount} CUỐN SÁCH
            </p>
            <p style="margin: 4px 0; font-size: 12px; color: #dc2626;">
                ⏳ Hiệu lực xuất cổng đến: <strong>${expStr}</strong> (Trong vòng 30 phút)
            </p>
        </div>

        <div style="margin-top: 16px;">
            <p style="font-size: 13px; font-weight: 700; margin-bottom: 6px;">Danh mục sách kèm vé:</p>
            <ul style="padding-left: 20px; margin-top: 4px;">
                ${bookListHtml}
            </ul>
        </div>

        <p style="font-size: 12px; color: #64748b; margin-top: 14px;">
            Khi đi qua cửa kiểm soát, vui lòng xuất trình màn hình vé này hoặc mã vé cho nhân viên trực cửa/bảo vệ quét kiểm tra đối soát.
        </p>
    `;

    return sendEmail({
        to,
        userId,
        subject,
        html: createEmailTemplate({
            headerBadge: 'Kiểm soát an ninh - Vé ra cửa',
            subtitle: 'Digital Exit Pass & Security Clearance',
            contentHtml,
            actionButtonText: 'Mở Vé Ra Cửa Trên Ứng Dụng',
            actionButtonUrl: 'http://localhost:5173/borrow'
        }),
        templateType: 'exit_pass',
        text: `Vé ra cửa ${passCode}: Cho phép mang ra ${bookCount} cuốn sách. Hết hạn lúc ${expStr}.`
    });
}

module.exports = {
    sendEmail,
    sendDueReminderEmail,
    sendDueTodayEmail,
    sendOverdueWarningEmail,
    sendDropBoxReceiptEmail,
    sendExitPassEmail,
    recordDispatch
};
