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

  // 2. DÀNH CHO NHÂN VIÊN & QUẢN TRỊ (LIBRARIAN / ADMIN / OWNER)
  // Phân luồng công thái học theo tham số chế độ:
  if (mode === "history") {
    return <CirculationHistoryView />;
  }

  if (mode === "kiosk") {
    return <KioskToolsView />;
  }

  // Mặc định: QUẦY GIAO DỊCH ĐA NĂNG THÔNG MINH (Smart Unified Counter)
  return <SmartCounter />;
}
