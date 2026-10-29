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

Hệ thống cung cấp sẵn 4 tài khoản chuẩn hóa đại diện cho 4 vai trò để phục vụ phát triển, kiểm thử và demo:

| Vai trò | Tên người dùng | Email | Mật khẩu | Mã thẻ |
| :--- | :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | Administrator | `admin@library.com` | `admin123` | `LIB-AD-000001` |
| **Thủ thư (Librarian)** | Trần Thủ Thư | `librarian@library.com` | `123456` | `LIB-LB-000001` |
| **Độc giả (Reader)** | Nguyễn Minh A | `reader@library.com` | `123456` | `LIB-RD-100001` |
| **Chủ thư viện (Owner)** | Trần Văn Chủ | `owner@library.com` | `123456` | `LIB-OW-000001` |

*(Mật khẩu của tài khoản Admin là `admin123`, các tài khoản còn lại mặc định là `123456`).*

---

## 🌟 Chức năng chính

1. **Quản lý hệ thống & Phân quyền RBAC 4 vai trò:** Quản trị viên (Admin), Thủ thư (Librarian), Độc giả (Reader), Chủ thư viện / Giám đốc (Owner).
2. **Cơ chế Đề xuất & Phê duyệt 2 cấp (Maker - Checker):** Admin gửi đề xuất thay đổi chính sách vận hành (phí phạt, hạn mượn, giới hạn sách) và Chủ thư viện độc quyền phê duyệt/bác bỏ.
2. **Quản lý Kho tài liệu:** Quản lý Sách, Bản sao sách (Book Copies), Thể loại (Categories), Tác giả (Authors), Nhà xuất bản (Publishers). Hỗ trợ QR Code cho từng bản sao sách.
3. **Quản lý Mượn/Trả sách:** Giao diện tối ưu cho mượn/trả sách; quét mã QR Thẻ độc giả và Mã QR sách để tự động điền thông tin.
4. **Quản lý Đặt trước (Reservations):** Độc giả có thể đặt trước các cuốn sách đang được mượn.
5. **Quản lý Tiền phạt (Fines):** Tự động tính toán và cập nhật tiền phạt nếu độc giả trả sách trễ hạn (thông qua Cron Job).
6. **Thông báo (Notifications):** Gửi thông báo đến độc giả về việc quá hạn, sách đặt trước đã sẵn sàng,...
7. **Thống kê & Báo cáo (Reports):** Xem chi tiết lịch sử hoạt động, biểu đồ mượn sách, thống kê sách được yêu thích.
8. **Nhật ký hoạt động (Activity Logs):** Theo dõi mọi thao tác trên hệ thống để dễ dàng quản lý.

---

## 🐳 Triển khai với Docker & Docker Compose (Production Ready)

Hệ thống đã được đóng gói hoàn chỉnh bằng Docker đa tầng (Multi-stage build) và Nginx Reverse Proxy.

### 1. Khởi chạy nhanh 1 chạm:
* **Trên Linux / macOS / VPS Server:**
  ```bash
  chmod +x deploy.sh
  ./deploy.sh
  ```
* **Trên Windows:**
  Nhấp đúp vào file **`deploy.bat`** hoặc chạy lệnh:
  ```cmd
  deploy.bat
  ```
* **Hoặc bằng lệnh Docker Compose tiêu chuẩn:**
  ```bash
  # Sao chép file cấu hình môi trường
  cp .env.example .env

  # Build và khởi chạy ngầm tất cả container
  docker compose up -d --build
  ```

### 2. Các dịch vụ trong Docker Compose:
| Container | Dịch vụ | Cổng nội bộ | Cổng công khai | Ghi chú |
| :--- | :--- | :--- | :--- | :--- |
| `smart_library_client` | Nginx + React Vite | 80 | `80` (hoặc `APP_PORT`) | Phục vụ SPA & định tuyến ngược `/api/` |
| `smart_library_server` | Node.js Express API | 5000 | `5000` | REST API & Tự động chạy Cron Job |
| `smart_library_db` | MySQL 8.0 Database | 3306 | `3306` | Tự động import `database/schema.sql` |

### 3. Các lệnh quản lý Docker hữu ích:
```bash
# Xem log thời gian thực của toàn bộ hệ thống
docker compose logs -f

# Xem trạng thái sức khỏe (Healthcheck) của các container
docker compose ps

# Dừng hệ thống
docker compose down

# Dừng và xóa toàn bộ dữ liệu database (dùng khi muốn reset sạch sẽ)
docker compose down -v
```

---

## 🔄 Tự động hóa CI/CD với GitHub Actions

Tệp quy trình [`.github/workflows/ci-cd.yml`](file:///.github/workflows/ci-cd.yml) tự động thực hiện 4 giai đoạn khi có commit hoặc Pull Request:

1. **`server-ci`**: Kiểm tra cú pháp, cài đặt dependencies và kiểm tra tính toàn vẹn của mã nguồn Backend trên Node.js 20.
2. **`client-ci`**: Kiểm tra TypeScript và đóng gói bản phát hành Vite Frontend (`npm run build`).
3. **`docker-build`**: Thiết lập Docker Buildx, kiểm tra tính hợp lệ của `docker-compose.yml` và build thử nghiệm 2 Docker images (`client` & `server`).
4. **`deploy`**: Tự động SSH vào máy chủ VPS (khi đẩy code lên nhánh `main`/`master`) và cập nhật container không gián đoạn (Zero-Downtime Deployment).

*Các biến Secrets cần cấu hình trên GitHub Repository (nếu kích hoạt auto deploy VPS):*
- `SERVER_HOST`: IP hoặc tên miền máy chủ VPS.
- `SERVER_USER`: Tên người dùng SSH (ví dụ: `ubuntu` hoặc `root`).
- `SERVER_SSH_KEY`: Khóa SSH Private Key.
- `SERVER_PORT`: Cổng SSH (mặc định 22).

---

*Tài liệu được cập nhật cho hệ thống Smart Library 4.0.*
