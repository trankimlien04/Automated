import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Inbox, ShieldCheck, FileCheck, Scan, ArrowRightLeft,
  CheckCircle2, Clock, Sparkles, ExternalLink, ArrowRight
} from "lucide-react";
import { SmartBookDropModal } from "@/components/smart-book-drop-modal";
import { SecurityExitScannerModal } from "@/components/security-exit-scanner-modal";
import { BookDropAuditModal } from "@/components/book-drop-audit-modal";

export function KioskToolsView() {
  const [smartBookDropOpen, setSmartBookDropOpen] = useState(false);
  const [securityExitOpen, setSecurityExitOpen] = useState(false);
  const [bookDropAuditOpen, setBookDropAuditOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Trạm Kiosk Tự Phục Vụ & Kiểm Soát An Ninh
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Quản lý các trạm thiết bị vật lý đặt tại cửa thư viện: Hòm trả sách 24/7 ngoài giờ và Cổng kiểm soát lối ra.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Hòm trả sách 24/7 */}
        <Card className="border-border hover:border-primary/40 transition-all shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center mb-2">
              <Inbox className="h-5 w-5" />
            </div>
            <CardTitle className="text-base font-bold">Hòm Trả Sách 24/7</CardTitle>
            <CardDescription className="text-xs">
              Mô phỏng giao diện trạm Kiosk thả sách ngoài giờ dành cho bạn đọc trả sách khi thư viện đóng cửa.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={() => setSmartBookDropOpen(true)}
              className="w-full h-9 text-xs font-semibold gap-1.5 cursor-pointer bg-sky-600 hover:bg-sky-700 text-white"
            >
              <span>Mở Kiosk Trả Sách</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        {/* Card 2: Kiểm kê Hòm sách */}
        <Card className="border-border hover:border-primary/40 transition-all shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="h-10 w-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center mb-2">
              <FileCheck className="h-5 w-5" />
            </div>
            <CardTitle className="text-base font-bold">Đối Soát & Kiểm Kê Hòm</CardTitle>
            <CardDescription className="text-xs">
              Thủ thư mở hòm lấy sách về quầy, đối soát từng cuốn được trả trong đêm và xác nhận nhập kho vật lý.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={() => setBookDropAuditOpen(true)}
              className="w-full h-9 text-xs font-semibold gap-1.5 cursor-pointer bg-purple-600 hover:bg-purple-700 text-white"
            >
              <span>Kiểm Kê Hòm Sách</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>

        {/* Card 3: Đối soát Phiếu mượn tại cổng */}
        <Card className="border-border hover:border-primary/40 transition-all shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-2">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle className="text-base font-bold">Đối Soát Phiếu Mượn & Cổng Ra</CardTitle>
            <CardDescription className="text-xs">
              Màn hình trạm quét đối soát tại lối ra: Quét mã QR Phiếu mượn chính thức (PM-BRW-...) hoặc Thẻ độc giả để kiểm tra sách mang ra khỏi thư viện.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              onClick={() => setSecurityExitOpen(true)}
              className="w-full h-9 text-xs font-semibold gap-1.5 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <span>Mở Trạm Đối Soát Phiếu Mượn</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Modals */}
      <SmartBookDropModal
        open={smartBookDropOpen}
        onOpenChange={setSmartBookDropOpen}
      />

      <BookDropAuditModal
        open={bookDropAuditOpen}
        onOpenChange={setBookDropAuditOpen}
      />

      <SecurityExitScannerModal
        open={securityExitOpen}
        onOpenChange={setSecurityExitOpen}
      />
    </div>
  );
}
export default KioskToolsView;
