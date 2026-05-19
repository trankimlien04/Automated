export const stats = {
  totalBooks: 12480,
  totalReaders: 3265,
  borrowedToday: 142,
  overdue: 23,
  returnRate: 94.2,
  finesThisMonth: 1840000,
};

export const monthlyTrend = [
  { month: "T1", borrow: 320, return: 298 },
  { month: "T2", borrow: 410, return: 392 },
  { month: "T3", borrow: 380, return: 360 },
  { month: "T4", borrow: 520, return: 488 },
  { month: "T5", borrow: 610, return: 575 },
  { month: "T6", borrow: 480, return: 462 },
  { month: "T7", borrow: 540, return: 520 },
  { month: "T8", borrow: 690, return: 640 },
  { month: "T9", borrow: 820, return: 770 },
  { month: "T10", borrow: 760, return: 730 },
  { month: "T11", borrow: 690, return: 668 },
  { month: "T12", borrow: 580, return: 552 },
];

export const categoryShare = [
  { name: "Văn học", value: 32 },
  { name: "Khoa học", value: 22 },
  { name: "Công nghệ", value: 18 },
  { name: "Lịch sử", value: 12 },
  { name: "Kinh tế", value: 9 },
  { name: "Khác", value: 7 },
];

export const topBooks = [
  { title: "Nhà Giả Kim", author: "Paulo Coelho", borrows: 142, rating: 4.8 },
  { title: "Sapiens", author: "Yuval N. Harari", borrows: 128, rating: 4.7 },
  { title: "Đắc Nhân Tâm", author: "Dale Carnegie", borrows: 119, rating: 4.6 },
  { title: "Tuổi Trẻ Đáng Giá Bao Nhiêu", author: "Rosie Nguyễn", borrows: 104, rating: 4.5 },
  { title: "Tôi Tài Giỏi, Bạn Cũng Thế", author: "Adam Khoo", borrows: 96, rating: 4.4 },
  { title: "Cha Giàu Cha Nghèo", author: "Robert Kiyosaki", borrows: 88, rating: 4.5 },
  { title: "Đi Tìm Lẽ Sống", author: "Viktor Frankl", borrows: 81, rating: 4.7 },
];

export const recentTransactions = [
  { id: "BR-10241", reader: "Nguyễn Minh Anh", code: "SV2024001", book: "Clean Code", action: "borrow", time: "5 phút trước", due: "20/11/2025" },
  { id: "BR-10240", reader: "Trần Thùy Linh", code: "SV2024042", book: "Sapiens", action: "return", time: "12 phút trước", due: "—" },
  { id: "BR-10239", reader: "Lê Quang Huy", code: "SV2023118", book: "Atomic Habits", action: "borrow", time: "24 phút trước", due: "20/11/2025" },
  { id: "BR-10238", reader: "Phạm Hồng Nhung", code: "SV2024073", book: "Đắc Nhân Tâm", action: "return", time: "38 phút trước", due: "—" },
  { id: "BR-10237", reader: "Đỗ Văn Tài", code: "SV2022254", book: "Nhà Giả Kim", action: "borrow", time: "1 giờ trước", due: "20/11/2025" },
  { id: "BR-10236", reader: "Hoàng Thị Mai", code: "SV2024189", book: "Deep Work", action: "overdue", time: "2 giờ trước", due: "10/11/2025" },
];

export const books = [
  { id: "B001", title: "Clean Code", author: "Robert C. Martin", category: "Công nghệ", isbn: "978-0132350884", total: 8, available: 3, rating: 4.7, cover: "🧑‍💻" },
  { id: "B002", title: "Sapiens: Lược Sử Loài Người", author: "Yuval Noah Harari", category: "Lịch sử", isbn: "978-0062316097", total: 12, available: 5, rating: 4.8, cover: "🌍" },
  { id: "B003", title: "Nhà Giả Kim", author: "Paulo Coelho", category: "Văn học", isbn: "978-0062315007", total: 15, available: 2, rating: 4.6, cover: "🏜️" },
  { id: "B004", title: "Atomic Habits", author: "James Clear", category: "Kỹ năng", isbn: "978-0735211292", total: 10, available: 4, rating: 4.9, cover: "⚛️" },
  { id: "B005", title: "Đắc Nhân Tâm", author: "Dale Carnegie", category: "Kỹ năng", isbn: "978-1439199190", total: 20, available: 11, rating: 4.5, cover: "🤝" },
  { id: "B006", title: "Deep Work", author: "Cal Newport", category: "Kỹ năng", isbn: "978-1455586691", total: 6, available: 0, rating: 4.6, cover: "🧠" },
  { id: "B007", title: "Tư Duy Nhanh và Chậm", author: "Daniel Kahneman", category: "Tâm lý", isbn: "978-0374533557", total: 7, available: 3, rating: 4.7, cover: "💭" },
  { id: "B008", title: "Vũ Trụ Trong Vỏ Hạt Dẻ", author: "Stephen Hawking", category: "Khoa học", isbn: "978-0553802023", total: 5, available: 2, rating: 4.5, cover: "🌌" },
];

export const readers = [
  { id: "SV2024001", name: "Nguyễn Minh Anh", email: "anh.nm@uni.edu.vn", phone: "0901 234 567", status: "active", borrowed: 3, expiry: "30/06/2026", since: "09/2024" },
  { id: "SV2024042", name: "Trần Thùy Linh", email: "linh.tt@uni.edu.vn", phone: "0912 345 678", status: "active", borrowed: 1, expiry: "30/06/2026", since: "09/2024" },
  { id: "SV2023118", name: "Lê Quang Huy", email: "huy.lq@uni.edu.vn", phone: "0923 456 789", status: "active", borrowed: 2, expiry: "30/06/2026", since: "09/2023" },
  { id: "SV2024073", name: "Phạm Hồng Nhung", email: "nhung.ph@uni.edu.vn", phone: "0934 567 890", status: "active", borrowed: 0, expiry: "30/06/2026", since: "09/2024" },
  { id: "SV2022254", name: "Đỗ Văn Tài", email: "tai.dv@uni.edu.vn", phone: "0945 678 901", status: "locked", borrowed: 4, expiry: "30/06/2026", since: "09/2022" },
  { id: "SV2024189", name: "Hoàng Thị Mai", email: "mai.ht@uni.edu.vn", phone: "0956 789 012", status: "pending", borrowed: 0, expiry: "—", since: "11/2025" },
];

export const reservations = [
  { id: "RS-201", book: "Deep Work", reader: "Nguyễn Minh Anh", date: "18/11/2025", status: "waiting", queue: 1 },
  { id: "RS-202", book: "Atomic Habits", reader: "Lê Quang Huy", date: "17/11/2025", status: "ready", queue: 0 },
  { id: "RS-203", book: "Nhà Giả Kim", reader: "Trần Thùy Linh", date: "16/11/2025", status: "waiting", queue: 2 },
  { id: "RS-204", book: "Clean Code", reader: "Phạm Hồng Nhung", date: "15/11/2025", status: "expired", queue: 0 },
];

export const fines = [
  { id: "FN-301", reader: "Đỗ Văn Tài", book: "Nhà Giả Kim", days: 12, amount: 60000, status: "unpaid" },
  { id: "FN-302", reader: "Hoàng Thị Mai", book: "Deep Work", days: 8, amount: 40000, status: "unpaid" },
  { id: "FN-303", reader: "Trần Thùy Linh", book: "Sapiens", days: 3, amount: 15000, status: "paid" },
  { id: "FN-304", reader: "Lê Quang Huy", book: "Atomic Habits", days: 5, amount: 25000, status: "paid" },
];

export const notifications = [
  { id: 1, title: "Sách bạn đặt trước đã có", body: "“Atomic Habits” đã sẵn sàng để mượn tại quầy A2.", time: "10 phút trước", type: "success", unread: true },
  { id: 2, title: "Nhắc trả sách", body: "Còn 2 ngày để trả “Clean Code”. Vui lòng gia hạn hoặc trả đúng hạn.", time: "1 giờ trước", type: "warning", unread: true },
  { id: 3, title: "Mượn sách thành công", body: "Bạn vừa mượn “Sapiens”. Hạn trả: 30/11/2025.", time: "Hôm qua", type: "info", unread: false },
  { id: 4, title: "Cảnh báo quá hạn", body: "“Deep Work” đã quá hạn 3 ngày. Phí phạt: 15.000đ.", time: "2 ngày trước", type: "danger", unread: false },
];

export const recommendations = [
  { title: "Show Your Work", author: "Austin Kleon", reason: "Vì bạn đã đọc Atomic Habits", match: 96, cover: "✍️" },
  { title: "The Pragmatic Programmer", author: "Andy Hunt", reason: "Cùng thể loại với Clean Code", match: 94, cover: "🛠️" },
  { title: "Homo Deus", author: "Yuval N. Harari", reason: "Tiếp nối Sapiens", match: 92, cover: "🤖" },
  { title: "Tư Duy Phản Biện", author: "Richard Paul", reason: "Độc giả tương tự đã mượn", match: 88, cover: "🎯" },
  { title: "Bí Mật Tư Duy Triệu Phú", author: "T. Harv Eker", reason: "Đang thịnh hành tuần này", match: 85, cover: "💰" },
  { title: "Khởi Nghiệp Tinh Gọn", author: "Eric Ries", reason: "Phù hợp sở thích Kinh tế", match: 82, cover: "🚀" },
];
