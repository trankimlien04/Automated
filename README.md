# 📚 Smart Library - Hệ thống Quản lý Thư viện Thông minh

Smart Library là một ứng dụng quản lý thư viện toàn diện (Fullstack) giúp tối ưu hóa quy trình mượn trả sách, quản lý độc giả, quản lý kho sách và thống kê báo cáo. Hệ thống cũng được tích hợp tính năng quét mã QR để thao tác nhanh chóng và tiện lợi.

---

## 🛠 Công nghệ sử dụng

**Frontend (Client):**
- **Core:** React 19, TypeScript, Vite
- **Styling & UI:** TailwindCSS, Radix UI, Class Variance Authority (CVA), Lucide React
- **State & Data Fetching:** TanStack React Query, Axios
- **Routing & Forms:** React Router DOM v7, React Hook Form, Zod (Validation)
- **Tiện ích:** Recharts (Vẽ biểu đồ), html5-qrcode (Quét mã QR), qrcode.react (Tạo mã QR), Sonner (Toast notifications)

**Backend (Server):**
- **Core:** Node.js, Express.js
- **Database:** MySQL (Sử dụng `mysql2`)
- **Authentication & Security:** JSON Web Token (JWT), bcrypt (Mã hóa mật khẩu), CORS
- **Tiện ích:** Dotenv, Node-cron (Chạy các tác vụ tự động như cập nhật tiền phạt, trạng thái sách)

---

## 📂 Cấu trúc thư mục dự án

```text
Automated/
├── client/                 # Mã nguồn Frontend (React/Vite)
│   ├── src/
│   │   ├── components/     # Các UI component dùng chung
│   │   ├── hooks/          # Custom hooks (ví dụ: use-confirm)
│   │   ├── pages/          # Các trang giao diện (Books, Borrow, Fines,...)
│   │   └── ...
│   └── package.json
├── server/                 # Mã nguồn Backend (Node.js/Express)
│   ├── controllers/        # Xử lý logic của các API
│   ├── routes/             # Định nghĩa các endpoint API
│   ├── index.js            # File khởi chạy server
│   └── package.json
├── database/               # Chứa các file liên quan đến CSDL
│   └── schema.sql          # Script tạo bảng và dữ liệu mẫu
├── run.bat                 # Script tự động khởi chạy dự án trên Windows
└── README.md               # Tài liệu dự án
```

---

## ⚙️ Hướng dẫn cài đặt và chạy dự án

### 1. Yêu cầu hệ thống
- Cài đặt **Node.js** (Phiên bản LTS).
- Cài đặt **MySQL** Server.

### 2. Thiết lập Cơ sở dữ liệu (Database)
1. Mở MySQL Client (hoặc phpMyAdmin, MySQL Workbench, DBeaver...).
2. Tạo cơ sở dữ liệu mới với tên `smart_library`.
3. Import file cơ sở dữ liệu: Chạy toàn bộ nội dung của file `database/schema.sql` để tạo cấu trúc bảng và nạp dữ liệu mẫu ban đầu.
4. *(Lưu ý: Nếu Backend có file `.env`, hãy đảm bảo cấu hình thông tin kết nối MySQL chính xác).*

### 3. Khởi chạy dự án tự động (Windows)
Dự án đã được tích hợp sẵn script chạy tự động cho Windows:
1. Nhấp đúp chuột vào file **`run.bat`** ở thư mục gốc của dự án.
2. Script sẽ tự động:
   - Kiểm tra và cài đặt các thư viện (npm packages) cho cả `client` và `server` nếu chưa có.
   - Khởi động Backend (Server) ở một cửa sổ dòng lệnh.
   - Khởi động Frontend (Client) ở một cửa sổ dòng lệnh khác.
   - Tự động mở trình duyệt truy cập vào `http://localhost:5173`.

> **Lưu ý:** Để tắt hệ thống, bạn chỉ cần đóng 2 cửa sổ cmd màu đen vừa được mở lên.

---

## 🔐 Thông tin tài khoản mặc định (Dữ liệu mẫu)

Hệ thống cung cấp sẵn các tài khoản với các vai trò khác nhau để phục vụ quá trình phát triển và kiểm thử:

| Vai trò | Tên người dùng | Email | Mật khẩu |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | Administrator | `admin@library.com` | `admin123` |
| **Thủ thư (Librarian)** | Trần Thủ Thư | `librarian@library.com` | `123456` |
| **Thủ thư (Librarian)** | Lê Thi Phương | `phuong.thuthu@library.com` | `123456` |
| **Độc giả (Reader)** | Nguyễn Minh Anh | `reader@library.com` | `123456` |

*(Mật khẩu của tất cả các tài khoản độc giả và thủ thư khác trong hệ thống mặc định đều là `123456`).*

---

## 🌟 Chức năng chính

1. **Quản lý hệ thống & Phân quyền:** Phân quyền theo Admin, Thủ thư và Độc giả. Quản lý tài khoản và cấu hình hệ thống.
2. **Quản lý Kho tài liệu:** Quản lý Sách, Bản sao sách (Book Copies), Thể loại (Categories), Tác giả (Authors), Nhà xuất bản (Publishers). Hỗ trợ QR Code cho từng bản sao sách.
3. **Quản lý Mượn/Trả sách:** Giao diện tối ưu cho mượn/trả sách; quét mã QR Thẻ độc giả và Mã QR sách để tự động điền thông tin.
4. **Quản lý Đặt trước (Reservations):** Độc giả có thể đặt trước các cuốn sách đang được mượn.
5. **Quản lý Tiền phạt (Fines):** Tự động tính toán và cập nhật tiền phạt nếu độc giả trả sách trễ hạn (thông qua Cron Job).
6. **Thông báo (Notifications):** Gửi thông báo đến độc giả về việc quá hạn, sách đặt trước đã sẵn sàng,...
7. **Thống kê & Báo cáo (Reports):** Xem chi tiết lịch sử hoạt động, biểu đồ mượn sách, thống kê sách được yêu thích.
8. **Nhật ký hoạt động (Activity Logs):** Theo dõi mọi thao tác trên hệ thống để dễ dàng quản lý.

---

*Tài liệu được tạo tự động cho dự án Smart Library.*
