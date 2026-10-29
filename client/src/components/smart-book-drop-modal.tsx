import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Inbox, Camera, CheckCircle2, BookOpen
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Html5Qrcode } from "html5-qrcode";

interface SmartBookDropModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  myBorrowingBooks?: any[];
}

export function SmartBookDropModal({ open, onOpenChange, onSuccess, myBorrowingBooks = [] }: SmartBookDropModalProps) {
  const [bookQrInput, setBookQrInput] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [receiptData, setReceiptData] = useState<any | null>(null);

  // Live copy preview
  const [checkingCopy, setCheckingCopy] = useState(false);
  const [copyPreview, setCopyPreview] = useState<any | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (open) {
      setReceiptData(null);
      setBookQrInput("");
      setCopyPreview(null);
      setNote("");
    } else {
      stopCamera();
    }
  }, [open]);

  // Live search copy info when QR is entered
  useEffect(() => {
    const raw = bookQrInput.trim();
    if (!raw) {
      setCopyPreview(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingCopy(true);
      try {
        const res = await api.get(`/borrow/check-copy/${encodeURIComponent(raw)}`);
        setCopyPreview(res.data);
      } catch (e) {
        setCopyPreview(null);
      } finally {
        setCheckingCopy(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [bookQrInput]);

  const handleSubmitDrop = async () => {
    const rawQr = bookQrInput.trim();
    if (!rawQr) {
      toast.error("Vui lòng nhập hoặc quét mã QR trên gáy sách");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post("/borrow/drop-box-return", {
        bookQrCode: rawQr,
        note: note.trim() || "Độc giả gửi sách vào hòm trả ngoài giờ"
      });

      setReceiptData(res.data.data);
      toast.success(res.data.message || "Đã ghi nhận trả sách ngoài giờ thành công!");
      if (onSuccess) onSuccess();
    } catch (error: any) {
      const msg = error.response?.data?.message || "Lỗi khi ghi nhận trả sách ngoài giờ";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const html5QrCode = new Html5Qrcode("dropbox-qr-scanner-box");
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          stopCamera();
          setBookQrInput(decodedText);
          toast.success("Đã nhận diện mã bản sao sách!");
        },
        () => {}
      );
    } catch (e) {
      console.error("Camera error:", e);
      setIsCameraActive(false);
      toast.error("Không thể khởi động camera");
    }
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current && isCameraActive) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current = null;
      } catch (e) {}
    }
    setIsCameraActive(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl w-[95vw] sm:w-full p-0 overflow-hidden rounded-2xl shadow-2xl border-2 border-sky-500/30 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-sky-700 via-blue-700 to-indigo-800 p-4 sm:p-6 text-white relative shrink-0">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold tracking-wider uppercase mb-2 border border-white/30">
            <Inbox className="w-3.5 h-3.5" />
            Trả sách ngoài giờ (After-hours Drop)
          </div>
          <DialogTitle className="text-xl font-black text-white">
            Ghi Nhận Trả Sách Ngoài Giờ (Hòm Trả Ngoại Tuyến)
          </DialogTitle>
          <DialogDescription className="text-sky-100 text-xs mt-1">
            Dành cho độc giả gửi trả sách ngoài giờ hành chính hoặc ngày nghỉ. Quét mã QR trên sách để hệ thống lưu thời điểm trả (ngưng tính phạt trễ hạn) trước khi thả sách vào hòm.
          </DialogDescription>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1">
          {/* Success Digital Receipt View */}
          {receiptData ? (
            <div className="space-y-4 py-2 animate-in zoom-in-95">
              <div className="p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-500 text-center space-y-2">
                <div className="w-14 h-14 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-black text-emerald-950">
                  Ghi Nhận Gửi Sách Vào Hòm Thành Công!
                </h3>
                <p className="text-xs text-emerald-800 font-medium">
                  Thời gian gửi sách đã được hệ thống lưu lại và ngưng tính phạt trễ hạn kể từ thời điểm này.
                </p>
              </div>

              {/* Receipt details */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2.5">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Tên ấn phẩm:</span>
                  <span className="font-bold text-slate-800">{receiptData.bookTitle}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Mã bản sao (QR):</span>
                  <span className="font-mono font-bold text-sky-700">{receiptData.copyQr}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Thời điểm ghi nhận:</span>
                  <span className="font-bold text-slate-800">
                    {new Date(receiptData.droppedAt).toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Đối soát vật lý:</span>
                  <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                    Đầu ca làm việc tiếp theo (Thủ thư kiểm đếm nhập kho)
                  </Badge>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900">
                <p className="font-bold mb-1">📌 Bước tiếp theo:</p>
                <p>Vui lòng thả cuốn sách vào khe hòm nhận sách ngoại tuyến đặt tại cửa thư viện. Bạn có thể theo dõi tiến độ kiểm kê trong sổ lưu thông cá nhân.</p>
              </div>

              <Button
                onClick={() => {
                  setReceiptData(null);
                  setBookQrInput("");
                  setNote("");
                }}
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold"
              >
                Ghi nhận tiếp cuốn khác
              </Button>
            </div>
          ) : (
            /* Form Input */
            <div className="space-y-4">
              {/* Quick Select from User's Currently Borrowed Books */}
              {myBorrowingBooks.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Chọn nhanh từ sách bạn đang mượn ({myBorrowingBooks.length} cuốn):
                  </label>
                  <div className="grid grid-cols-1 gap-2 max-h-36 overflow-y-auto pr-1">
                    {myBorrowingBooks.map((b: any) => (
                      <div
                        key={b.id}
                        onClick={() => setBookQrInput(b.qr_code)}
                        className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                          bookQrInput === b.qr_code
                            ? "border-sky-500 bg-sky-50 text-sky-950 font-bold shadow-xs"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{b.book_title}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            Mã: {b.qr_code} • Hạn: {new Date(b.due_date).toLocaleDateString("vi-VN")}
                          </p>
                        </div>
                        {bookQrInput === b.qr_code && (
                          <Badge className="bg-sky-600 text-white text-[10px] ml-2">Đã chọn</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* QR Input Bar */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Hoặc quét mã QR trên gáy cuốn sách:
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Nhập hoặc quét mã QR (VD: QR-BK-1-1)"
                    value={bookQrInput}
                    onChange={(e) => setBookQrInput(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant={isCameraActive ? "destructive" : "outline"}
                    onClick={isCameraActive ? stopCamera : startCamera}
                    className="gap-1.5 shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    {isCameraActive ? "Tắt" : "Quét"}
                  </Button>
                </div>
              </div>

              {/* Camera Scanner View */}
              {isCameraActive && (
                <div className="rounded-xl overflow-hidden border-2 border-sky-500 bg-black flex flex-col items-center p-3">
                  <div id="dropbox-qr-scanner-box" className="w-full max-w-sm rounded-lg overflow-hidden" />
                  <p className="text-white/80 text-xs mt-2 font-medium animate-pulse">
                    Hướng camera vào mã QR dán trên gáy sách
                  </p>
                </div>
              )}

              {/* Copy preview */}
              {copyPreview && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Badge variant="outline" className="text-sky-700 border-sky-300 text-[10px] mb-1">
                      Xác nhận sách hợp lệ
                    </Badge>
                    <h4 className="font-bold text-slate-900 truncate">
                      {copyPreview.title}
                    </h4>
                    <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                      Mã: {copyPreview.qr_code} • {copyPreview.location || "Khu vực lưu kho"}
                    </p>
                  </div>
                </div>
              )}

              {/* Optional Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Ghi chú tình trạng sách (Tùy chọn):
                </label>
                <Textarea
                  placeholder="Ghi chú nếu bìa sách có vết bẩn nhỏ, nếp gấp trang từ trước..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="text-xs h-16"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-muted/40 border text-[11px] text-muted-foreground leading-relaxed">
                💡 <strong>Tính năng phần mềm thuần túy:</strong> Không yêu cầu hòm thông minh IoT có cảm biến hay khóa từ. Độc giả chỉ cần quét mã QR để ghi nhận mốc thời gian, sau đó thả sách vào hòm thường; thủ thư sẽ kiểm kê vào ca sáng.
              </div>

              <Button
                onClick={handleSubmitDrop}
                disabled={isSubmitting || !bookQrInput.trim()}
                className="w-full h-11 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-md gap-2"
              >
                <Inbox className="w-4 h-4" />
                {isSubmitting ? "Đang ghi nhận..." : "Xác nhận gửi sách vào hòm ngoài giờ"}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 bg-slate-50 border-t flex sm:justify-between items-center text-xs text-muted-foreground">
          <span>Ghi nhận trả sách ngoài giờ • Smart Library Management</span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
