import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ReaderBorrowView } from "@/components/reader-borrow-view";
import { SmartCounter } from "@/components/smart-counter";
import { CirculationHistoryView } from "@/components/circulation-history-view";
import { KioskToolsView } from "@/components/kiosk-tools-view";

export default function BorrowPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode");

  // 1. DÀNH CHO ĐỘC GIẢ (READER)
  // Giao diện tinh gọn: Thẻ đọc số, Sách đang giữ, Gia hạn 1 chạm, Hòm trả 24/7 và Lịch sử
  if (user?.role === "reader") {
    return <ReaderBorrowView />;
  }

  // 2. DÀNH CHO CHỦ THƯ VIỆN / GIÁM ĐỐC (OWNER)
  // Ban Giám đốc giám sát kiểm toán sổ lưu thông & toàn bộ lịch sử mượn trả
  if (user?.role === "owner" && mode !== "kiosk") {
    return <CirculationHistoryView />;
  }

  // 3. DÀNH CHO NHÂN VIÊN & QUẢN TRỊ (LIBRARIAN / ADMIN)
  // Phân luồng công thái học theo tham số chế độ:
  if (mode === "history") {
    return <CirculationHistoryView />;
  }

  if (mode === "kiosk") {
    return <KioskToolsView />;
  }

  // Mặc định: QUẦY GIAO DỊCH ĐA NĂNG THÔNG MINH (Dành cho Thủ thư tác nghiệp trực tiếp, hoặc Admin hỗ trợ)
  return <SmartCounter />;
}
