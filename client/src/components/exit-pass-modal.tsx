import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QRCodeCanvas } from "qrcode.react";
import { FileCheck, Clock, AlertTriangle, BookOpen, Copy, Check, QrCode } from "lucide-react";
import { toast } from "sonner";

interface ExitPassModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passData: {
    pass_code?: string;
    passCode?: string;
    book_count?: number;
    bookCount?: number;
    items?: any[];
    items_summary?: any;
    expires_at?: string;
    expiresAt?: string;
    status?: string;
    reader_name?: string;
    readerName?: string;
    card_number?: string;
    cardNumber?: string;
  } | null;
}

export function ExitPassModal({ open, onOpenChange, passData }: ExitPassModalProps) {
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number; isExpired: boolean }>({
    minutes: 0,
    seconds: 0,
    isExpired: false
  });

  const passCode = passData?.pass_code || passData?.passCode || "";
  const bookCount = passData?.book_count || passData?.bookCount || (passData?.items?.length || 1);
  const rawItems = passData?.items || passData?.items_summary || [];
  const items = Array.isArray(rawItems)
    ? rawItems
    : typeof rawItems === "string"
    ? (() => { try { return JSON.parse(rawItems); } catch { return []; } })()
    : [];

  const expiresAtStr = passData?.expires_at || passData?.expiresAt || "";

  // Realtime countdown timer
  useEffect(() => {
    if (!expiresAtStr) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const target = new Date(expiresAtStr).getTime();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft({ minutes: 0, seconds: 0, isExpired: true });
      } else {
        const minutes = Math.floor(diff / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        setTimeLeft({ minutes, seconds, isExpired: false });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAtStr]);

  const handleCopyCode = () => {
    if (!passCode) return;
    navigator.clipboard.writeText(passCode);
    setCopied(true);
    toast.success(`Đã sao chép mã biên lai: ${passCode}`);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!passData) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] sm:w-full p-0 overflow-hidden border-2 border-emerald-500/30 shadow-2xl rounded-2xl bg-gradient-to-b from-card to-background max-h-[90vh] flex flex-col">
        {/* Header - Digital Borrow Receipt */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-4 sm:p-6 text-white text-center relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold tracking-wider uppercase mb-2 border border-white/30">
            <FileCheck className="w-3.5 h-3.5" />
            Biên lai mượn sách điện tử (Digital Receipt)
          </div>
          <DialogTitle className="text-xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
            Chứng Nhận Mượn Sách Kỹ Thuật Số
          </DialogTitle>
          <DialogDescription className="text-emerald-100 text-xs mt-1">
            Mã QR biên lai xác thực giao dịch mượn sách thành công, thay thế hoàn toàn phiếu in giấy
          </DialogDescription>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
          {/* Main QR Card */}
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-white border border-slate-200 shadow-inner">
            <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-100">
              <QRCodeCanvas
                value={passCode}
                size={180}
                level="H"
                includeMargin={false}
              />
            </div>

            {/* Pass Code badge with copy */}
            <div className="mt-3.5 flex items-center gap-2">
              <span className="font-mono font-black text-lg tracking-wider text-slate-800">
                {passCode}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleCopyCode}
                title="Sao chép mã biên lai"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>

            {/* Countdown Badge */}
            <div className="mt-2.5">
              {timeLeft.isExpired ? (
                <Badge variant="destructive" className="px-3 py-1 text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Biên lai đã hoàn tất đối soát
                </Badge>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-300 text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                  Thời hạn đối soát biên lai còn:{" "}
                  <span className="font-mono font-bold text-amber-700">
                    {String(timeLeft.minutes).padStart(2, "0")}:{String(timeLeft.seconds).padStart(2, "0")}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Book Count Banner */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md font-black text-lg">
                {bookCount}
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-900 uppercase tracking-wide">
                  Đã ghi nhận mượn thành công
                </p>
                <p className="text-xs text-emerald-700">
                  Tổng số lượng ấn phẩm trong phiếu mượn này
                </p>
              </div>
            </div>
            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
              ĐÃ DUYỆT
            </Badge>
          </div>

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Danh sách ấn phẩm kèm biên lai ({items.length} cuốn):
              </p>
              <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                {items.map((it: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/40 text-xs"
                  >
                    <BookOpen className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">
                        {it.title || it.book_title || "Ấn phẩm thư viện"}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Mã bản sao: {it.copyQr || it.qr_code || "N/A"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guidelines note */}
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-900 dark:text-emerald-200 space-y-1">
            <p className="font-bold">📌 Lợi ích của Biên lai mượn sách điện tử:</p>
            <p>1. Lưu trữ trực tiếp trên thiết bị, bạn có thể tra cứu hạn trả bất kỳ lúc nào mà không sợ thất lạc phiếu giấy.</p>
            <p>2. Khi cần đối soát hoặc hỗ trợ, chỉ cần xuất trình mã QR này hoặc <strong>Thẻ Thư Viện</strong> cho nhân viên kiểm tra nhanh.</p>
          </div>
        </div>

        <DialogFooter className="p-4 bg-muted/30 border-t flex sm:justify-between items-center gap-2">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Smart Library Management • Biên lai số
          </span>
          <Button
            className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            onClick={() => onOpenChange(false)}
          >
            Đã hiểu & Đóng biên lai
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
