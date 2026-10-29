import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  FileCheck, ShieldAlert, Scan, Camera, CheckCircle2,
  Clock, BookOpen, AlertTriangle, UserCheck, RefreshCw, QrCode
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Html5Qrcode } from "html5-qrcode";

interface SecurityExitScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SecurityExitScannerModal({ open, onOpenChange, onSuccess }: SecurityExitScannerModalProps) {
  const [passCodeInput, setPassCodeInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    status?: string;
    message?: string;
    pass?: any;
  } | null>(null);

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isSubmittingClear, setIsSubmittingClear] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const [activePassesList, setActivePassesList] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Load recently active receipts
  const fetchActivePasses = async () => {
    setLoadingList(true);
    try {
      const res = await api.get("/borrow/exit-passes/active-list");
      setActivePassesList(res.data);
    } catch (e) {
      console.error("Lỗi khi tải danh sách biên lai:", e);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchActivePasses();
      setVerifyResult(null);
      setPassCodeInput("");
    } else {
      stopCamera();
    }
  }, [open]);

  const handleVerify = async (codeToVerify?: string) => {
    const code = (codeToVerify || passCodeInput).trim();
    if (!code) {
      toast.error("Vui lòng nhập hoặc quét mã biên lai / thẻ độc giả");
      return;
    }

    setIsVerifying(true);
    try {
      const res = await api.post("/borrow/exit-passes/verify", { passCode: code });
      setVerifyResult(res.data);
      if (res.data.valid) {
        toast.success("Biên lai điện tử HỢP LỆ! Đối soát thông tin sách.");
      } else {
        toast.error(res.data.message || "Biên lai không hợp lệ");
      }
    } catch (error: any) {
      const msg = error.response?.data?.message || "Không thể xác minh biên lai";
      setVerifyResult({
        valid: false,
        status: "error",
        message: msg
      });
      toast.error(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClearPass = async () => {
    if (!verifyResult?.pass?.pass_code) return;

    setIsSubmittingClear(true);
    try {
      const res = await api.post("/borrow/exit-passes/clear", {
        passCode: verifyResult.pass.pass_code,
        notes: "Thủ thư/Nhân viên đã đối soát đúng số lượng và xác nhận biên lai"
      });
      toast.success(res.data.message || "Đã xác nhận đối soát biên lai thành công!");
      fetchActivePasses();
      setVerifyResult(null);
      setPassCodeInput("");
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Lỗi khi đối soát biên lai");
    } finally {
      setIsSubmittingClear(false);
    }
  };

  // Camera toggle
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const html5QrCode = new Html5Qrcode("security-reader-qr-box");
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          stopCamera();
          setPassCodeInput(decodedText);
          handleVerify(decodedText);
        },
        () => {}
      );
    } catch (e) {
      console.error("Camera error:", e);
      setIsCameraActive(false);
      toast.error("Không thể bật camera thiết bị");
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
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full p-0 overflow-hidden rounded-2xl shadow-2xl border-2 border-slate-700 max-h-[90vh] flex flex-col">
        {/* Header - Digital Receipt Verifier */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-4 sm:p-6 text-white flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <FileCheck className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                Bộ Đối Soát Biên Lai Mượn Sách Điện Tử
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-0.5">
                Kiểm tra & tra cứu nhanh chứng từ mượn sách số hóa của độc giả qua Camera hoặc mã QR
              </DialogDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-indigo-300 border-indigo-400/40 bg-indigo-950/50 hidden sm:inline-flex">
            Digital Verifier
          </Badge>
        </div>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto flex-1">
          {/* Scanner Input Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Quét Thẻ Độc Giả (LIB-RD-...) hoặc Mã Biên Lai (PASS-EXP-...)
              </label>
              <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">
                ⭐ Nhận diện qua mã QR
              </Badge>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="Quét Thẻ Độc Giả (VD: LIB-RD-000003) hoặc mã PASS-EXP-..."
                  value={passCodeInput}
                  onChange={(e) => setPassCodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                  className="font-mono text-sm pr-10"
                />
                {passCodeInput && (
                  <button
                    onClick={() => setPassCodeInput("")}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant={isCameraActive ? "destructive" : "outline"}
                onClick={isCameraActive ? stopCamera : startCamera}
                className="gap-2 shrink-0"
              >
                <Camera className="w-4 h-4" />
                {isCameraActive ? "Tắt Camera" : "Bật Camera"}
              </Button>
              <Button
                onClick={() => handleVerify()}
                disabled={isVerifying || !passCodeInput.trim()}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
              >
                <Scan className="w-4 h-4" />
                {isVerifying ? "Đang soát..." : "Kiểm tra biên lai"}
              </Button>
            </div>
          </div>

          {/* Camera View Box */}
          {isCameraActive && (
            <div className="rounded-xl overflow-hidden border-2 border-indigo-500 bg-black flex flex-col items-center p-3 relative">
              <div id="security-reader-qr-box" className="w-full max-w-sm rounded-lg overflow-hidden" />
              <p className="text-white/80 text-xs mt-2 font-medium animate-pulse">
                Hướng camera vào mã QR Biên lai trên điện thoại hoặc Thẻ thư viện
              </p>
            </div>
          )}

          {/* Verification Result Display */}
          {verifyResult && (
            <div className="transition-all animate-in fade-in-50 zoom-in-95">
              {verifyResult.valid ? (
                /* VALID RECEIPT CARD */
                <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-teal-500/10 border-2 border-emerald-500 shadow-lg space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3.5">
                      <Avatar className="w-14 h-14 border-2 border-emerald-500 shadow-md">
                        <AvatarImage src={verifyResult.pass?.avatar_url} />
                        <AvatarFallback className="bg-emerald-600 text-white font-bold text-lg">
                          {verifyResult.pass?.reader_name?.slice(0, 2).toUpperCase() || "RD"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="inline-flex items-center gap-1 text-emerald-800 text-xs font-black uppercase tracking-wider">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          BIÊN LAI HỢP LỆ - ĐÃ XÁC THỰC MƯỢN SÁCH
                        </div>
                        <h3 className="text-lg font-black text-slate-900 mt-0.5">
                          {verifyResult.pass?.reader_name}
                        </h3>
                        <p className="text-xs text-slate-600 font-mono">
                          Mã thẻ: <strong>{verifyResult.pass?.card_number}</strong>
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-700">
                        {verifyResult.pass?.book_count} CUỐN
                      </div>
                      <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                        ĐÃ XÁC NHẬN SỐ LƯỢNG
                      </Badge>
                    </div>
                  </div>

                  {/* Book list to cross-check */}
                  <div className="space-y-1.5 p-3 rounded-xl bg-white/80 border border-emerald-200">
                    <p className="text-xs font-bold text-emerald-950 uppercase tracking-wider flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                      Danh sách ấn phẩm theo biên lai ({verifyResult.pass?.items?.length || verifyResult.pass?.book_count} cuốn):
                    </p>
                    <div className="space-y-1.5 mt-2">
                      {verifyResult.pass?.items?.map((it: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-xs p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                          <span className="font-semibold text-slate-800">
                            {idx + 1}. {it.title || it.book_title}
                          </span>
                          <span className="font-mono text-slate-500 text-[11px]">
                            {it.copyQr || it.qr_code}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Action button */}
                  <Button
                    onClick={handleClearPass}
                    disabled={isSubmittingClear}
                    className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md gap-2"
                  >
                    <UserCheck className="w-5 h-5" />
                    {isSubmittingClear ? "Đang xác nhận..." : "XÁC NHẬN ĐỐI SOÁT HOÀN TẤT"}
                  </Button>
                </div>
              ) : (
                /* INVALID / USED / EXPIRED RECEIPT CARD */
                <div className="p-5 rounded-2xl bg-red-500/10 border-2 border-red-500 shadow-lg space-y-3">
                  <div className="flex items-center gap-3 text-red-700">
                    <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-xl shrink-0">
                      <ShieldAlert className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-black text-base text-red-900">
                        CẢNH BÁO: BIÊN LAI KHÔNG HỢP LỆ HOẶC ĐÃ HẾT HẠN!
                      </h4>
                      <p className="text-xs text-red-700 mt-0.5">
                        {verifyResult.message}
                      </p>
                    </div>
                  </div>

                  {verifyResult.pass && (
                    <div className="p-3 rounded-xl bg-white border border-red-200 text-xs text-slate-700 space-y-1">
                      <p><strong>Người đứng tên:</strong> {verifyResult.pass.reader_name} ({verifyResult.pass.card_number})</p>
                      <p><strong>Trạng thái biên lai:</strong> <span className="font-bold uppercase text-red-600">{verifyResult.pass.status}</span></p>
                      {verifyResult.pass.verified_at && (
                        <p><strong>Thời gian đã đối soát:</strong> {new Date(verifyResult.pass.verified_at).toLocaleString("vi-VN")}</p>
                      )}
                    </div>
                  )}

                  <p className="text-xs font-semibold text-red-800 bg-red-100 p-2.5 rounded-lg border border-red-200">
                    💡 <strong>Hướng dẫn xử lý:</strong> Vui lòng đối chiếu với danh sách sách đang mượn của độc giả trên hệ thống để đảm bảo tính chuẩn xác.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Live Recent Receipts in Library */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-indigo-600" />
                Các Biên Lai Mượn Số Vừa Được Tạo
              </h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={fetchActivePasses}
                disabled={loadingList}
                className="h-7 text-xs text-muted-foreground"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingList ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {activePassesList.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Chưa có biên lai mượn số nào được tạo gần đây.
                </p>
              ) : (
                activePassesList.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2.5 rounded-xl border bg-card hover:bg-muted/40 transition-colors text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-slate-700">
                        {p.pass_code}
                      </span>
                      <span className="text-slate-500">•</span>
                      <span className="font-semibold text-foreground truncate max-w-[140px]">
                        {p.reader_name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {p.book_count} cuốn
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      {p.status === "used" ? (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 text-[10px]">
                          Đã đối soát
                        </Badge>
                      ) : p.status === "expired" ? (
                        <Badge variant="destructive" className="text-[10px]">
                          Hết hạn
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-600 text-white text-[10px] animate-pulse">
                          Còn {p.minutesLeft}p
                        </Badge>
                      )}

                      {p.status === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-indigo-600 font-bold"
                          onClick={() => {
                            setPassCodeInput(p.pass_code);
                            handleVerify(p.pass_code);
                          }}
                        >
                          Kiểm tra
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 bg-slate-100 border-t flex sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
