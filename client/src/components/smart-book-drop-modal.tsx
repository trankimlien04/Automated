import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Inbox, Camera, CheckCircle2, BookOpen, Upload, Image as ImageIcon, Trash2, Bell, Mail, ClipboardCheck
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
  const [proofImage, setProofImage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProofCameraActive, setIsProofCameraActive] = useState(false);
  const [receiptData, setReceiptData] = useState<any | null>(null);

  // Live copy preview
  const [checkingCopy, setCheckingCopy] = useState(false);
  const [copyPreview, setCopyPreview] = useState<any | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  const proofVideoRef = useRef<HTMLVideoElement | null>(null);
  const proofStreamRef = useRef<MediaStream | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const scanner = new Html5Qrcode("dropbox-qr-file-temp");
      try {
        const decodedText = await scanner.scanFile(file, true);
        setBookQrInput(decodedText.trim());
        toast.success(`Đã nhận diện mã QR: ${decodedText.trim()}`);
      } catch (err) {
        toast.error("Không tìm thấy mã QR hợp lệ trong ảnh này");
      } finally {
        try { scanner.clear(); } catch (e) {}
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const stopProofCamera = () => {
    if (proofStreamRef.current) {
      proofStreamRef.current.getTracks().forEach(track => track.stop());
      proofStreamRef.current = null;
    }
    setIsProofCameraActive(false);
  };

  const startProofCamera = async () => {
    try {
      stopCamera();
      setIsProofCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 960 }, height: { ideal: 720 } }
      });
      proofStreamRef.current = stream;
      setTimeout(() => {
        if (proofVideoRef.current) {
          proofVideoRef.current.srcObject = stream;
          proofVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (e) {
      setIsProofCameraActive(false);
      toast.error("Không thể mở Camera chụp ảnh. Vui lòng chọn 'Tải ảnh minh chứng' từ thiết bị!");
    }
  };

  const captureProofFromCamera = () => {
    if (!proofVideoRef.current) return;
    const video = proofVideoRef.current;
    const canvas = document.createElement("canvas");
    const w = video.videoWidth || 800;
    const h = video.videoHeight || 600;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, w, h);
      // Stamp timestamp & QR watermark at the bottom for authenticity
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.fillRect(0, h - 44, w, 44);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px monospace";
      const stampText = `HÒM TRẢ 24/7 • MÃ: ${bookQrInput.trim() || "CHƯA CHỌN"} • ${new Date().toLocaleString("vi-VN")}`;
      ctx.fillText(stampText, 14, h - 16);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      setProofImage(dataUrl);
      toast.success("Đã chụp ảnh minh chứng thả sách thành công!");
    }
    stopProofCamera();
  };

  const handleProofFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      if (!file.type.startsWith("image/")) {
        toast.error("Vui lòng chọn tệp hình ảnh hợp lệ (JPG, PNG, WEBP)");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxW = 900;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
            setProofImage(dataUrl);
            toast.success("Đã đính kèm ảnh minh chứng thả sách!");
          }
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
    if (proofFileInputRef.current) {
      proofFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      setReceiptData(null);
      setBookQrInput("");
      setCopyPreview(null);
      setNote("");
      setProofImage("");
    } else {
      stopCamera();
      stopProofCamera();
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
    if (!proofImage) {
      toast.error("Bắt buộc phải có ảnh minh chứng! Vui lòng chụp hoặc tải ảnh sách tại Hòm trả 24/7.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post("/borrow/drop-box-return", {
        bookQrCode: rawQr,
        note: note.trim() || "Độc giả gửi sách vào hòm trả ngoài giờ (Có ảnh minh chứng)",
        proofImage
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
    await stopCamera();
    stopProofCamera();
    setIsCameraActive(true);
    setTimeout(async () => {
      try {
        const el = document.getElementById("dropbox-qr-scanner-box");
        if (!el) return;
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
        toast.error("Không thể khởi động Camera. Bạn có thể bấm 'Tải ảnh' mã QR!");
      }
    }, 150);
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (e) {}
      html5QrCodeRef.current = null;
    }
    const container = document.getElementById("dropbox-qr-scanner-box");
    if (container) {
      const videos = container.querySelectorAll("video");
      videos.forEach((v) => {
        if (v.srcObject) {
          const stream = v.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
          v.srcObject = null;
        }
      });
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
                    Chờ Thủ thư kiểm đếm & xác nhận nhập kho
                  </Badge>
                </div>
                {receiptData.proofImage && (
                  <div className="pt-2 border-t space-y-1.5">
                    <span className="text-muted-foreground font-semibold block">Ảnh minh chứng đã lưu:</span>
                    <img
                      src={receiptData.proofImage}
                      alt="Ảnh minh chứng thả hòm 24/7"
                      className="w-full max-h-40 object-cover rounded-lg border border-emerald-300 shadow-2xs"
                    />
                  </div>
                )}
              </div>

              {/* How reader knows when librarian confirms */}
              <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-950 space-y-2">
                <p className="font-bold text-sky-900 flex items-center gap-1.5">
                  <ClipboardCheck className="w-4 h-4 text-sky-700 shrink-0" />
                  Làm sao để biết Thủ thư đã xác nhận hòm trả hay chưa?
                </p>
                <ul className="space-y-1.5 text-[11px] text-sky-900/90 pl-1">
                  <li className="flex items-start gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                    <span><strong>1. Chuông thông báo (In-App):</strong> Ngay khi Thủ thư bấm xác nhận kiểm kê, hệ thống sẽ báo ngay lên biểu tượng Chuông thông báo ở góc trên màn hình.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                    <span><strong>2. Email tự động:</strong> Hệ thống gửi biên bản kết quả đối soát (Nguyên vẹn / Hư hại / Thiếu sách) kèm tên Thủ thư xác nhận về Email của bạn.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span><strong>3. Trạng thái trực tiếp tại trang Mượn/Trả:</strong> Xem tại mục <strong>"Trạng thái đối soát Hòm 24/7"</strong> và tab <strong>"Lịch sử đã trả"</strong> (hiển thị rõ tên Thủ thư, giờ xác nhận và ghi chú).</span>
                  </li>
                </ul>
              </div>

              <Button
                onClick={() => {
                  setReceiptData(null);
                  setBookQrInput("");
                  setNote("");
                  setProofImage("");
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
                    className="gap-1.5 shrink-0 text-xs font-semibold"
                    title={isCameraActive ? "Tắt camera quét QR" : "Bật camera quét QR"}
                  >
                    <Camera className="w-4 h-4" />
                    {isCameraActive ? "Tắt Camera" : "Bật Camera"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-1.5 shrink-0 text-xs"
                    title="Tải ảnh QR từ máy tính/điện thoại"
                  >
                    <Upload className="w-4 h-4 text-sky-600" />
                    <span>Tải ảnh</span>
                  </Button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div id="dropbox-qr-file-temp" className="hidden" />
                </div>
              </div>

              {/* Camera Scanner View */}
              {isCameraActive && (
                <div className="rounded-xl overflow-hidden border-2 border-sky-500 bg-black flex flex-col items-center p-3 space-y-2">
                  <div id="dropbox-qr-scanner-box" className="w-full max-w-sm rounded-lg overflow-hidden" />
                  <div className="flex items-center justify-between w-full px-1">
                    <p className="text-white/80 text-xs font-medium animate-pulse">
                      Hướng camera vào mã QR dán trên gáy sách
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={stopCamera}
                      className="h-7 text-xs gap-1"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      Tắt Camera
                    </Button>
                  </div>
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

              {/* Mandatory Proof Image Upload / Capture */}
              <div className="space-y-2 p-3.5 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/40">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-sky-600" />
                    <span>Ảnh minh chứng thả sách vào Hòm 24/7:</span>
                  </label>
                  <Badge variant={proofImage ? "default" : "destructive"} className={`text-[10px] ${proofImage ? "bg-emerald-600 text-white" : ""}`}>
                    {proofImage ? "✓ Đã có ảnh minh chứng" : "* Bắt buộc"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Vui lòng chụp ảnh hoặc tải ảnh cuốn sách đặt tại khe Hòm trả 24/7 làm căn cứ đối soát cho Thủ thư.
                </p>

                {isProofCameraActive ? (
                  <div className="rounded-xl overflow-hidden border-2 border-sky-500 bg-black flex flex-col items-center p-2.5 space-y-2">
                    <video
                      ref={proofVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-52 object-cover rounded-lg"
                    />
                    <div className="flex items-center gap-2 w-full">
                      <Button
                        type="button"
                        onClick={captureProofFromCamera}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 font-bold gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Chụp ảnh minh chứng
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={stopProofCamera}
                        className="text-xs h-8 gap-1"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Tắt Camera
                      </Button>
                    </div>
                  </div>
                ) : proofImage ? (
                  <div className="relative rounded-xl overflow-hidden border border-emerald-400 bg-white p-2 space-y-2">
                    <img
                      src={proofImage}
                      alt="Ảnh minh chứng thả sách"
                      className="w-full max-h-48 object-cover rounded-lg border"
                    />
                    <div className="flex items-center justify-between text-[11px] px-1">
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ảnh minh chứng hợp lệ
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setProofImage("")}
                        className="h-6 text-xs text-destructive hover:text-destructive gap-1 px-2"
                      >
                        <Trash2 className="w-3 h-3" /> Chụp / chọn lại
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={startProofCamera}
                      className="flex-1 h-9 text-xs font-semibold gap-1.5 border-sky-400 text-sky-700 bg-white hover:bg-sky-50"
                    >
                      <Camera className="w-3.5 h-3.5 text-sky-600" />
                      Bật Camera chụp ảnh
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => proofFileInputRef.current?.click()}
                      className="flex-1 h-9 text-xs font-semibold gap-1.5 border-sky-400 text-sky-700 bg-white hover:bg-sky-50"
                    >
                      <Upload className="w-3.5 h-3.5 text-sky-600" />
                      Tải ảnh minh chứng
                    </Button>
                    <input
                      type="file"
                      ref={proofFileInputRef}
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleProofFileUpload}
                    />
                  </div>
                )}
              </div>

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
                💡 <strong>Quy trình minh bạch 2 chiều:</strong> Khi thả sách vào hòm, hệ thống lưu lại <strong>ảnh chụp minh chứng + thời gian thực</strong> (chốt mốc thời gian hoàn trả hợp lệ ngay lập tức). Khi Thủ thư kiểm kê và bấm xác nhận, bạn sẽ nhận được <strong>Thông báo chuông trên web + Email xác nhận + Cập nhật trạng thái đối soát</strong>.
              </div>

              <Button
                onClick={handleSubmitDrop}
                disabled={isSubmitting || !bookQrInput.trim() || !proofImage}
                className="w-full h-11 bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm shadow-md gap-2"
              >
                <Inbox className="w-4 h-4" />
                {isSubmitting
                  ? "Đang ghi nhận..."
                  : !proofImage
                  ? "Vui lòng đính kèm ảnh minh chứng để xác nhận"
                  : "Xác nhận gửi sách vào hòm ngoài giờ"}
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
