import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import {
  Calendar,
  Bell,
  X,
  CheckCircle2,
  QrCode,
  Camera,
  AlertTriangle,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  Upload,
  RefreshCw,
  Search,
  BookOpen,
  ArrowRight,
  Sparkles,
  Download,
  Copy,
  Check,
  Clock,
  BookmarkCheck,
  HelpCircle,
  XCircle,
  ThumbsUp,
  RotateCcw
} from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { QRCodeCanvas } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";

interface Reservation {
  id: number;
  reservation_date: string;
  status: "waiting" | "pending" | "notified" | "ready" | "accepted" | "completed" | "cancelled" | "expired";
  reader_name: string;
  card_number: string;
  reader_email?: string;
  reader_phone?: string;
  book_title: string;
  book_id: number;
  available_copies?: number;
  total_copies?: number;
  cover_image?: string;
  notified_at?: string;
  expires_at?: string;
  queue_position?: number;
  time_left_hours?: number;
}

const statusMap: Record<string, { label: string; cls: string; desc: string }> = {
  waiting: { label: "Đang chờ sách về kho", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", desc: "Xếp hàng đợi khi có sách trả về" },
  pending: { label: "Đang chờ sách về kho", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", desc: "Xếp hàng đợi khi có sách trả về" },
  notified: { label: "Chờ độc giả xác nhận", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 animate-pulse font-semibold", desc: "Sách đã về kho, giữ ưu tiên 48h" },
  accepted: { label: "Đã xác nhận • Giữ tại quầy", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold", desc: "Độc giả đã đồng ý mượn, sách chờ tại quầy" },
  ready: { label: "Sẵn sàng nhận tại quầy", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold", desc: "Sách đang giữ sẵn sàng tại quầy" },
  completed: { label: "Đã giao sách", cls: "bg-muted text-muted-foreground border-muted-foreground/20", desc: "Thủ thư đã trao sách cho độc giả" },
  cancelled: { label: "Đã hủy / Nhường lượt", cls: "bg-destructive/10 text-destructive border-destructive/20", desc: "Phiếu đặt trước đã hủy" },
  expired: { label: "Đã hết hạn", cls: "bg-muted text-muted-foreground border-muted-foreground/20", desc: "Quá 48h chưa xác nhận" },
};

export default function ReservationsPage() {
  const [resList, setResList] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [adminTab, setAdminTab] = useState<"all" | "hold" | "notified" | "waiting" | "history">("all");
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const navigate = useNavigate();

  // Handover QR Verification Modal State (For Librarian)
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [selectedResv, setSelectedResv] = useState<Reservation | null>(null);
  const [scannedCodeInput, setScannedCodeInput] = useState("");
  const [bookCopyQrInput, setBookCopyQrInput] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const [submittingHandover, setSubmittingHandover] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const response = await api.get("/reservations");
      setResList(response.data || []);
    } catch (error) {
      console.error("Lỗi khi tải phiếu đặt trước:", error);
      toast.error("Không thể tải danh sách đặt trước");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  // Cleanup camera scanner on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(console.error);
          }
          html5QrCodeRef.current.clear();
        } catch (e) {}
      }
    };
  }, []);

  // Stop camera helper
  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.error("Error stopping camera:", e);
      }
      html5QrCodeRef.current = null;
    }
    setIsCameraActive(false);
    setIsCameraStarting(false);
  };

  // Start Camera with proper DOM mounting delay
  const startCamera = async () => {
    setIsCameraStarting(true);
    setIsCameraActive(true);

    setTimeout(async () => {
      try {
        const scannerId = "handover-qr-reader";
        const viewport = document.getElementById(scannerId);
        if (!viewport) {
          toast.error("Không tìm thấy khung quét camera trong giao diện");
          setIsCameraActive(false);
          setIsCameraStarting(false);
          return;
        }

        if (html5QrCodeRef.current) {
          try {
            if (html5QrCodeRef.current.isScanning) {
              await html5QrCodeRef.current.stop();
            }
            html5QrCodeRef.current.clear();
          } catch (e) {}
        }

        const qrScanner = new Html5Qrcode(scannerId);
        html5QrCodeRef.current = qrScanner;

        let cameras: Array<{ id: string; label: string }> = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch (camErr) {
          console.warn("Could not enumerate cameras:", camErr);
        }

        const cameraConfig = cameras && cameras.length > 0
          ? (cameras.find(c => c.label.toLowerCase().includes("back") || c.label.toLowerCase().includes("sau"))?.id || cameras[0].id)
          : { facingMode: "environment" };

        await qrScanner.start(
          cameraConfig,
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            setScannedCodeInput(decodedText.trim());
            toast.success("Đã quét nhận diện mã QR thành công!");
            stopCamera();
          },
          () => {}
        );
        setIsCameraStarting(false);
      } catch (err: any) {
        console.error("Lỗi mở camera:", err);
        toast.error("Không thể mở camera. Vui lòng cấp quyền truy cập máy ảnh hoặc tải file ảnh QR.");
        setIsCameraActive(false);
        setIsCameraStarting(false);
      }
    }, 250);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const qrScanner = new Html5Qrcode("handover-qr-reader-file-temp");
    qrScanner
      .scanFile(file, true)
      .then((decodedText) => {
        setScannedCodeInput(decodedText.trim());
        toast.success("Đã đọc mã QR từ file ảnh thành công!");
      })
      .catch(() => {
        toast.error("Không tìm thấy mã QR hợp lệ trong ảnh này. Vui lòng thử ảnh rõ nét hơn.");
      })
      .finally(() => {
        try {
          qrScanner.clear();
        } catch (e) {}
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      });
  };

  const handleOpenHandoverModal = (resv: Reservation) => {
    setSelectedResv(resv);
    setScannedCodeInput("");
    setBookCopyQrInput("");
    setIsCameraActive(false);
    setIsCameraStarting(false);
    setHandoverModalOpen(true);
  };

  const handleCloseHandoverModal = () => {
    stopCamera();
    setHandoverModalOpen(false);
    setSelectedResv(null);
    setScannedCodeInput("");
    setBookCopyQrInput("");
  };

  // Verify scanned code against the selected reservation
  const isCodeMatch = () => {
    if (!selectedResv || !scannedCodeInput.trim()) return null;
    const input = scannedCodeInput.trim().toUpperCase().replace(/\s+/g, "");
    const expectedTicket = `TICKET-RES-${selectedResv.id}`.toUpperCase();
    const expectedCard = selectedResv.card_number ? selectedResv.card_number.toUpperCase().replace(/\s+/g, "") : "";

    if (
      input === expectedTicket ||
      input === `TICKET-${selectedResv.id}` ||
      input === `RES-${selectedResv.id}` ||
      input === String(selectedResv.id)
    ) {
      return true;
    }

    if (expectedCard && input === expectedCard) {
      return true;
    }

    if (selectedResv.reader_email && scannedCodeInput.trim() === selectedResv.reader_email) {
      return true;
    }

    if (scannedCodeInput.trim().startsWith("{") && scannedCodeInput.trim().endsWith("}")) {
      try {
        const parsed = JSON.parse(scannedCodeInput.trim());
        const jsonCode = (parsed.ticketCode || parsed.ticketQrCode || parsed.cardNumber || parsed.card_number || parsed.code || "").toString().toUpperCase();
        if (jsonCode === expectedTicket || (expectedCard && jsonCode === expectedCard)) {
          return true;
        }
      } catch {}
    }

    return false;
  };

  // Execute handover with strict QR verification
  const handleConfirmHandover = async () => {
    if (!selectedResv) return;

    const targetCode = scannedCodeInput.trim();
    if (!targetCode) {
      toast.error("Vui lòng quét hoặc nhập mã QR thẻ của độc giả để xác thực!");
      return;
    }

    const match = isCodeMatch();
    if (match === false) {
      toast.error(`Mã quét được không khớp với độc giả "${selectedResv.reader_name}"! Tuyệt đối không giao sách nhầm người.`);
      return;
    }

    const targetBookCopyQr = bookCopyQrInput.trim();
    if (!targetBookCopyQr) {
      toast.error("Vui lòng quét hoặc nhập mã QR trên cuốn sách vật lý mà bạn trao cho độc giả!");
      return;
    }

    setSubmittingHandover(true);
    try {
      const res = await api.put(`/reservations/${selectedResv.id}/complete`, {
        scannedCode: targetCode,
        bookCopyQr: targetBookCopyQr,
      });

      toast.success(res.data.message || "Đã xác thực QR và hoàn tất giao sách thành công!");
      handleCloseHandoverModal();
      fetchReservations();
    } catch (error: any) {
      console.error("Lỗi khi giao sách:", error);
      toast.error(error.response?.data?.message || "Không thể hoàn thành thủ tục giao sách");
    } finally {
      setSubmittingHandover(false);
    }
  };

  // Reader responds: Accept or Decline hold
  const handleRespondReservation = (id: number, action: "accept" | "decline", bookTitle: string) => {
    if (action === "accept") {
      confirm({
        title: "Xác nhận đồng ý mượn cuốn sách này?",
        description: `Bạn đồng ý mượn cuốn sách "${bookTitle}". Sách sẽ được giữ riêng tại quầy thủ thư cho bạn. Bạn chỉ cần tới quầy xuất trình Thẻ độc giả (mã QR cá nhân) để nhận sách.`,
        confirmText: "Đồng ý mượn & Giữ sách",
        cancelText: "Trở lại",
        variant: "default",
        onConfirm: async () => {
          try {
            const res = await api.post(`/reservations/${id}/respond`, { action: "accept" });
            toast.success(res.data.message || "Đã xác nhận mượn sách thành công! Vui lòng tới quầy nhận sách.");
            fetchReservations();
          } catch (error: any) {
            console.error("Lỗi khi xác nhận:", error);
            toast.error(error.response?.data?.message || "Không thể xác nhận mượn sách");
          }
        }
      });
    } else {
      confirm({
        title: "Xác nhận nhường lượt / Không mượn?",
        description: `Bạn có chắc muốn từ chối mượn cuốn sách "${bookTitle}" không?\n\n👉 Quyền ưu tiên giữ sách 48h sẽ được tự động chuyển ngay cho bạn đọc tiếp theo trong hàng đợi!`,
        confirmText: "Nhường lượt cho bạn khác",
        cancelText: "Trở lại",
        variant: "destructive",
        onConfirm: async () => {
          try {
            const res = await api.post(`/reservations/${id}/respond`, { action: "decline" });
            toast.success(res.data.message || "Đã nhường lượt mượn thành công.");
            fetchReservations();
          } catch (error: any) {
            console.error("Lỗi khi từ chối:", error);
            toast.error(error.response?.data?.message || "Không thể thực hiện thao tác");
          }
        }
      });
    }
  };

  // Cancel reservation
  const handleCancel = (id: number, bookTitle: string) => {
    confirm({
      title: "Xác nhận hủy đặt trước",
      description: `Bạn có chắc chắn muốn hủy đặt trước cuốn sách "${bookTitle}" không? Nếu hủy, bạn sẽ rời khỏi hàng đợi ưu tiên.`,
      confirmText: "Đồng ý hủy",
      cancelText: "Trở lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.put(`/reservations/${id}/cancel`);
          toast.success("Đã hủy phiếu đặt trước thành công!");
          fetchReservations();
        } catch (error: any) {
          console.error("Lỗi khi hủy đặt trước:", error);
          toast.error(error.response?.data?.message || "Không thể hủy phiếu đặt trước");
        }
      }
    });
  };

  const isReader = user?.role === "reader";

  // Filtered reservations for Staff view
  const filteredStaffList = resList.filter((r) => {
    // Admin tab filter
    if (adminTab === "hold" && !["accepted", "ready"].includes(r.status)) return false;
    if (adminTab === "notified" && r.status !== "notified") return false;
    if (adminTab === "waiting" && !["waiting", "pending"].includes(r.status)) return false;
    if (adminTab === "history" && !["completed", "cancelled", "expired"].includes(r.status)) return false;

    // Search filter
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      r.book_title.toLowerCase().includes(q) ||
      r.reader_name.toLowerCase().includes(q) ||
      (r.card_number && r.card_number.toLowerCase().includes(q)) ||
      String(r.id).includes(q)
    );
  });

  // Categorized lists for Reader view
  const readerNotifiedList = resList.filter((r) => r.status === "notified");
  const readerReadyList = resList.filter((r) => ["accepted", "ready"].includes(r.status));
  const readerWaitingList = resList.filter((r) => ["waiting", "pending"].includes(r.status));
  const readerHistoryList = resList.filter((r) => ["completed", "cancelled", "expired"].includes(r.status));

  // Staff Metrics
  const totalWaiting = resList.filter((r) => ["waiting", "pending"].includes(r.status)).length;
  const totalNotified = resList.filter((r) => r.status === "notified").length;
  const totalHold = resList.filter((r) => ["accepted", "ready"].includes(r.status)).length;
  const totalCompleted = resList.filter((r) => r.status === "completed").length;

  const codeMatchStatus = isCodeMatch();

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* 1. GIAO DIỆN DÀNH CHO ĐỘC GIẢ (READER VIEW) */}
      {/* ======================================================== */}
      {isReader ? (
        <div className="space-y-6">
          {/* Header & Policy Explanation Banner */}
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[11px] font-semibold">
                    Dành cho Độc giả
                  </Badge>
                  <span className="text-xs text-muted-foreground">• Hệ thống hàng đợi tự động</span>
                </div>
                <h1 className="text-xl font-bold font-display text-foreground">
                  Sách Bạn Đặt Trước (Hàng Đợi Chờ Sách Về Kho)
                </h1>
                <p className="text-xs text-muted-foreground max-w-2xl">
                  Tính năng <strong>Đặt trước</strong> chỉ áp dụng khi sách <strong>đã được mượn hết trong kho</strong>. Khi có độc giả trả sách về thư viện, hệ thống sẽ tự động giữ sách ưu tiên cho bạn trong <strong>48 giờ</strong> và gửi thông báo hỏi bạn có muốn mượn không.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/borrow")}
                className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 shrink-0"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>Xem Thẻ Thư Viện Cá Nhân</span>
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>

            {/* Quy trình ngắn gọn */}
            <div className="mt-4 pt-3 border-t border-border/50 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="font-bold text-primary shrink-0">1. Xếp hàng:</span>
                <span>Khi sách hết bản sao, bạn đăng ký đặt trước và nhận số thứ tự trong hàng đợi.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0">2. Giữ sách 48h:</span>
                <span>Khi sách có người trả về, hệ thống giữ sách ưu tiên và hỏi bạn có muốn mượn không.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0">3. Nhận tại quầy:</span>
                <span>Bạn bấm <strong>[Đồng ý mượn]</strong> và đến quầy đưa Thẻ độc giả để thủ thư giao sách.</span>
              </div>
            </div>
          </div>

          {/* KHU VỰC 1: SÁCH ĐÃ CÓ VỀ KHO - CẦN ĐỘC GIẢ PHẢN HỒI (NOTIFIED) */}
          {readerNotifiedList.length > 0 && (
            <Card className="border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent shadow-sm">
              <CardHeader className="pb-3 border-b border-amber-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 grid place-items-center animate-bounce">
                      <Sparkles className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <CardTitle className="font-display text-base text-amber-800 dark:text-amber-300">
                        🎉 Sách Bạn Đặt Trước Đã Có Mặt Tại Thư Viện! ({readerNotifiedList.length})
                      </CardTitle>
                      <CardDescription className="text-xs text-amber-700/80 dark:text-amber-400/80">
                        Đầu sách đã được hoàn trả về kho và đang ưu tiên giữ riêng cho bạn trong 48 giờ. Vui lòng xác nhận bạn có muốn mượn không.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className="bg-amber-600 text-white text-[10px] animate-pulse">Cần bạn xác nhận</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {readerNotifiedList.map((resv) => (
                  <div
                    key={resv.id}
                    className="p-4 rounded-xl border border-amber-500/30 bg-card shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="h-16 w-12 rounded bg-muted overflow-hidden shrink-0 border border-border">
                        {resv.cover_image ? (
                          <img src={resv.cover_image} alt={resv.book_title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full grid place-items-center bg-primary/10 text-primary font-bold text-xs">
                            {resv.book_title[0]}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-foreground">{resv.book_title}</h3>
                          <Badge variant="outline" className="font-mono text-[10px] text-primary border-primary/30">
                            #RES-{resv.id}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Bạn đã đặt trước vào ngày: {new Date(resv.reservation_date).toLocaleDateString("vi-VN")}
                        </p>
                        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            Hạn giữ sách ưu tiên: {resv.time_left_hours !== null && resv.time_left_hours !== undefined ? `Còn ${resv.time_left_hours} giờ` : "Trong vòng 48 giờ"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 2 Nút hành động nổi bật */}
                    <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
                      <Button
                        size="sm"
                        onClick={() => handleRespondReservation(resv.id, "accept", resv.book_title)}
                        className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        <span>Đồng ý mượn & Giữ sách</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRespondReservation(resv.id, "decline", resv.book_title)}
                        className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/30"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Không mượn / Nhường lượt</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* KHU VỰC 2: SÁCH ĐÃ XÁC NHẬN - SẴN SÀNG NHẬN TẠI QUẦY (ACCEPTED / READY) */}
          {readerReadyList.length > 0 && (
            <Card className="border-emerald-500/40 bg-emerald-500/[0.03] shadow-xs">
              <CardHeader className="pb-3 border-b border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <div>
                      <CardTitle className="font-display text-base text-emerald-800 dark:text-emerald-300">
                        Sách Đã Xác Nhận - Sẵn Sàng Nhận Tại Quầy ({readerReadyList.length})
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Sách đang được giữ riêng tại quầy thủ thư. Bạn không cần tìm trên kệ, chỉ cần đến quầy xuất trình Thẻ độc giả.
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className="bg-emerald-600 text-white text-[10px]">Giữ tại quầy</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {readerReadyList.map((resv) => (
                  <div
                    key={resv.id}
                    className="p-4 rounded-xl border border-emerald-500/30 bg-card shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border border-border">
                        {resv.cover_image ? (
                          <img src={resv.cover_image} alt={resv.book_title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full grid place-items-center bg-primary/10 text-primary font-bold text-xs">
                            {resv.book_title[0]}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-xs text-foreground">{resv.book_title}</h4>
                          <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-300">
                            Đã giữ sách
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Thủ thư đang giữ sẵn ấn phẩm này tại quầy lưu thông. Khi đến nhận, bạn chỉ cần mở mục <strong>Mượn / Trả qua QR</strong> để đưa Thẻ độc giả QR.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0">
                      <Button
                        size="sm"
                        onClick={() => navigate("/borrow")}
                        className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        <span>Mở Thẻ QR Độc Giả</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCancel(resv.id, resv.book_title)}
                        className="h-8 text-xs text-destructive hover:bg-destructive/10"
                        title="Hủy không nhận sách này nữa"
                      >
                        <X className="h-3.5 w-3.5 mr-0.5" /> Hủy giữ
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* KHU VỰC 3: SÁCH ĐANG CHỜ TRONG HÀNG ĐỢI (WAITING / PENDING) */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-display text-base flex items-center gap-2">
                    <Clock className="h-5 w-5 text-amber-500" />
                    <span>Sách Đang Trong Hàng Đợi Chờ Sách Về Kho ({readerWaitingList.length})</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Các cuốn sách bạn yêu thích nhưng hiện đang hết bản sao. Hệ thống sẽ tự động xếp bạn vào hàng đợi và báo ngay khi có sách.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {readerWaitingList.length === 0 ? (
                <div className="text-center py-10 border border-dashed rounded-xl bg-muted/20">
                  <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">Bạn chưa có cuốn sách nào trong hàng đợi</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm mx-auto">
                    Khi tìm kiếm sách trong thư viện thấy sách đã hết bản sao, bạn hãy bấm nút <em>"Hết sách • Đặt trước"</em> để xếp hàng nhé!
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate("/books")}
                    className="mt-3 h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <span>Khám phá danh mục sách</span>
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {readerWaitingList.map((resv) => (
                    <div
                      key={resv.id}
                      className="p-3.5 rounded-xl border border-border bg-card shadow-xs flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border border-border">
                          {resv.cover_image ? (
                            <img src={resv.cover_image} alt={resv.book_title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full grid place-items-center bg-primary/10 text-primary font-bold text-xs">
                              {resv.book_title[0]}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <h4 className="font-semibold text-xs text-foreground truncate">{resv.book_title}</h4>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px] font-bold">
                              Hàng đợi: Vị trí #{resv.queue_position || 1}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              Đăng ký: {new Date(resv.reservation_date).toLocaleDateString("vi-VN")}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                            Sách hiện đang được độc giả khác mượn. Khi có người trả sách về thư viện, hệ thống sẽ ưu tiên gửi thông báo cho bạn.
                          </p>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/50 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCancel(resv.id, resv.book_title)}
                          className="h-7 text-xs text-destructive hover:bg-destructive/10 gap-1 px-2"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Hủy đặt trước</span>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* KHU VỰC 4: LỊCH SỬ ĐẶT TRƯỚC (COMPLETED / CANCELLED) */}
          {readerHistoryList.length > 0 && (
            <Card className="border-border/60 shadow-xs">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="font-display text-sm text-muted-foreground flex items-center gap-2">
                  <BookmarkCheck className="h-4 w-4" />
                  <span>Lịch Sử Đặt Trước ({readerHistoryList.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="w-20 text-[11px]">Mã phiếu</TableHead>
                      <TableHead className="text-[11px]">Tên sách</TableHead>
                      <TableHead className="text-[11px]">Ngày đăng ký</TableHead>
                      <TableHead className="text-right text-[11px]">Kết quả</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {readerHistoryList.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">#RES-{r.id}</TableCell>
                        <TableCell className="font-medium text-xs text-foreground">{r.book_title}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.reservation_date).toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={`text-[10px] ${statusMap[r.status]?.cls || ""}`}>
                            {statusMap[r.status]?.label || r.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        /* ======================================================== */
        /* 2. GIAO DIỆN DÀNH CHO THỦ THƯ & ADMIN (STAFF VIEW) */
        /* ======================================================== */
        <div className="space-y-6">
          {/* Metrics Row */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/10 border-amber-500/20">
                    Chờ sách về
                  </Badge>
                </div>
                <p className="mt-3 font-display text-3xl font-bold">{totalWaiting}</p>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">Độc giả đang xếp hàng đợi</p>
              </CardContent>
            </Card>

            <Card className="border-blue-500/30 bg-blue-500/[0.03] shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <Bell className="h-5 w-5 text-blue-500 animate-pulse" />
                  <Badge variant="outline" className="text-[10px] text-blue-600 bg-blue-500/15 border-blue-500/30 font-bold">
                    Đang giữ 48h
                  </Badge>
                </div>
                <p className="mt-3 font-display text-3xl font-bold text-blue-600 dark:text-blue-400">{totalNotified}</p>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">Chờ độc giả phản hồi mượn</p>
              </CardContent>
            </Card>

            <Card className="border-emerald-500/30 bg-emerald-500/[0.03] shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <QrCode className="h-5 w-5 text-emerald-500" />
                  <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-500/15 border-emerald-500/30 font-bold">
                    Cần quét giao
                  </Badge>
                </div>
                <p className="mt-3 font-display text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalHold}</p>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">Sách giữ tại quầy chờ lấy</p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-xs">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Hoàn tất
                  </Badge>
                </div>
                <p className="mt-3 font-display text-3xl font-bold text-muted-foreground">{totalCompleted}</p>
                <p className="text-xs text-muted-foreground font-medium mt-0.5">Đã bàn giao sách thành công</p>
              </CardContent>
            </Card>
          </div>

          {/* Main Reservation Management Table */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="font-display text-base">Hàng Đợi & Quản Lý Đặt Trước Sách</CardTitle>
                  <CardDescription className="text-xs">
                    Theo dõi hàng đợi của các đầu sách hết bản sao. Khi sách trả về, hệ thống tự động giữ sách 48h cho độc giả đầu hàng đợi.
                  </CardDescription>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Tìm tên sách, độc giả, mã thẻ..."
                    className="h-8 pl-8 text-xs bg-muted/30"
                  />
                </div>
              </div>

              {/* Filter Tabs for Staff */}
              <div className="flex flex-wrap gap-1.5 pt-3">
                {[
                  { id: "all", label: "Tất cả", count: resList.length },
                  { id: "hold", label: "Giữ tại quầy chờ giao", count: totalHold },
                  { id: "notified", label: "Đang chờ phản hồi (48h)", count: totalNotified },
                  { id: "waiting", label: "Hàng đợi chờ sách về", count: totalWaiting },
                  { id: "history", label: "Lịch sử", count: totalCompleted },
                ].map((tab) => (
                  <Button
                    key={tab.id}
                    variant={adminTab === tab.id ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setAdminTab(tab.id as typeof adminTab)}
                    className={`h-7 px-2.5 text-xs rounded-md ${adminTab === tab.id ? "font-semibold" : "bg-muted/60 text-muted-foreground hover:text-foreground"}`}
                  >
                    <span>{tab.label}</span>
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${adminTab === tab.id ? "bg-primary-foreground text-primary font-bold" : "bg-muted text-muted-foreground"}`}>
                      {tab.count}
                    </span>
                  </Button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  <p className="text-xs">Đang tải danh sách đặt trước...</p>
                </div>
              ) : filteredStaffList.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium text-foreground">Không tìm thấy yêu cầu đặt trước nào</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {searchFilter ? "Không có kết quả khớp với từ khóa tìm kiếm." : "Hiện không có yêu cầu nào trong mục này."}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-20">Mã phiếu</TableHead>
                      <TableHead>Tên sách</TableHead>
                      <TableHead>Độc giả đặt trước</TableHead>
                      <TableHead>Ngày đăng ký / Thứ tự</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Thao tác & Bàn giao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStaffList.map((r) => (
                      <TableRow key={r.id} className={["accepted", "ready"].includes(r.status) ? "bg-emerald-500/[0.03]" : r.status === "notified" ? "bg-blue-500/[0.02]" : ""}>
                        <TableCell className="font-mono text-xs font-semibold">
                          <span className="text-primary">#RES-{r.id}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="h-9 w-7 shrink-0 rounded bg-muted overflow-hidden border border-border">
                              {r.cover_image ? (
                                <img src={r.cover_image} alt={r.book_title} className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full grid place-items-center bg-primary/10 text-primary text-[10px] font-bold">
                                  {r.book_title[0]}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-xs text-foreground truncate max-w-[220px]">{r.book_title}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">TICKET-RES-{r.id}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <p className="font-medium text-foreground">{r.reader_name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              {r.card_number || "Chưa cấp mã thẻ"}
                              {r.reader_phone ? ` • ${r.reader_phone}` : ""}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>
                            {new Date(r.reservation_date).toLocaleDateString("vi-VN", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric"
                            })}
                          </div>
                          {["waiting", "pending"].includes(r.status) && (
                            <Badge variant="outline" className="text-[9px] mt-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                              Hàng đợi #{r.queue_position || 1}
                            </Badge>
                          )}
                          {r.status === "notified" && (
                            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold block mt-0.5">
                              ⏱️ Còn {r.time_left_hours !== null && r.time_left_hours !== undefined ? `${r.time_left_hours}h` : "48h"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${statusMap[r.status]?.cls || ""}`}>
                            {statusMap[r.status]?.label || r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* If status is accepted/ready -> Quét QR Giao Sách */}
                            {["accepted", "ready"].includes(r.status) && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenHandoverModal(r)}
                                className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs font-semibold"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                                <span>Quét QR Giao sách</span>
                              </Button>
                            )}

                            {/* If status is notified -> Thủ thư có thể chủ động chuyển lượt nếu độc giả báo không lấy */}
                            {r.status === "notified" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRespondReservation(r.id, "decline", r.book_title)}
                                className="h-7 text-xs gap-1 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                                title="Chuyển lượt cho độc giả tiếp theo trong hàng đợi"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Chuyển lượt</span>
                              </Button>
                            )}

                            {/* Cancel button */}
                            {["waiting", "pending", "accepted", "ready"].includes(r.status) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-destructive hover:bg-destructive/10"
                                onClick={() => handleCancel(r.id, r.book_title)}
                                title="Hủy phiếu đặt trước"
                              >
                                <X className="h-3.5 w-3.5 mr-0.5" /> Hủy
                              </Button>
                            )}

                            {r.status === "completed" && (
                              <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Đã giao xong
                              </span>
                            )}

                            {r.status === "cancelled" && (
                              <span className="text-xs text-muted-foreground line-through">Đã hủy</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL XÁC THỰC QUÉT MÃ QR GIAO SÁCH (CHO THỦ THƯ) */}
      {/* ======================================================== */}
      <Dialog open={handoverModalOpen} onOpenChange={(open) => !open && handleCloseHandoverModal()}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-base">
              <QrCode className="h-5 w-5 text-emerald-600" />
              <span>Xác thực mã QR & Bàn giao sách đặt trước</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Thủ thư quét mã QR Thẻ độc giả (hoặc mã phiếu) và mã QR trên cuốn sách vật lý giữ tại quầy trước khi giao.
            </DialogDescription>
          </DialogHeader>

          {selectedResv && (
            <div className="space-y-4 py-2">
              {/* Box Info: Sách & Độc giả cần đối soát */}
              <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Đầu sách cần giao</p>
                    <p className="font-bold text-foreground text-sm truncate mt-0.5">{selectedResv.book_title}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">Phiếu: #RES-{selectedResv.id}</p>
                  </div>
                  <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] shrink-0 font-semibold">
                    Sách đã sẵn sàng
                  </Badge>
                </div>

                <div className="border-t border-border/60 pt-2 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium">ĐÚNG ĐỘC GIẢ ĐẶT TRƯỚC</p>
                    <p className="font-bold text-foreground mt-0.5">{selectedResv.reader_name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium">MÃ THẺ ĐỊNH DANH</p>
                    <p className="font-mono font-bold text-primary mt-0.5">
                      {selectedResv.card_number || "Chưa có mã thẻ"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Camera Scanner View Area */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <Camera className="h-3.5 w-3.5 text-primary" />
                    <span>Quét mã QR từ Thẻ độc giả</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-7 text-[11px] gap-1"
                    >
                      <Upload className="h-3 w-3" /> Tải ảnh QR
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />

                    <Button
                      type="button"
                      variant={isCameraActive ? "destructive" : "secondary"}
                      size="sm"
                      onClick={isCameraActive ? stopCamera : startCamera}
                      disabled={isCameraStarting}
                      className="h-7 text-[11px] gap-1"
                    >
                      {isCameraStarting ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Camera className="h-3 w-3" />
                      )}
                      <span>
                        {isCameraStarting
                          ? "Đang kết nối..."
                          : isCameraActive
                          ? "Tắt Camera"
                          : "Bật Camera Quét"}
                      </span>
                    </Button>
                  </div>
                </div>

                {/* HTML5 QR Code Scanner Element */}
                <div
                  id="handover-qr-reader"
                  className={`overflow-hidden rounded-xl border border-dashed border-border bg-black/5 text-center transition-all ${
                    isCameraActive ? "block min-h-[240px] w-full p-2" : "hidden"
                  }`}
                />
                <div id="handover-qr-reader-file-temp" className="hidden" />

                {/* Manual Input or Barcode Gun Input */}
                <div className="relative">
                  <QrCode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={scannedCodeInput}
                    onChange={(e) => setScannedCodeInput(e.target.value)}
                    placeholder={`Quét thẻ độc giả (${selectedResv.card_number || "Mã thẻ"}) hoặc nhập TICKET-RES-${selectedResv.id}`}
                    className="pl-9 text-xs font-mono font-medium h-9 bg-card border-border/80"
                  />
                  {scannedCodeInput && (
                    <button
                      type="button"
                      onClick={() => setScannedCodeInput("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Real-time Verification Feedback Box */}
              {scannedCodeInput.trim() && (
                <div className="animate-in fade-in zoom-in-95">
                  {codeMatchStatus === true ? (
                    <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                      <div>
                        <p className="font-bold">ĐÃ XÁC THỰC MÃ QR HỢP LỆ!</p>
                        <p className="text-[11px] mt-0.5 text-emerald-600/90 dark:text-emerald-300/90">
                          Mã khớp chính xác với độc giả <strong>{selectedResv.reader_name}</strong> (Mã thẻ: {selectedResv.card_number || "N/A"}). Đã sẵn sàng bàn giao sách.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2.5 text-xs text-destructive">
                      <ShieldAlert className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                      <div>
                        <p className="font-bold">CẢNH BÁO: MÃ QR KHÔNG KHỚP!</p>
                        <p className="text-[11px] mt-0.5 leading-relaxed">
                          Mã quét được [<strong>{scannedCodeInput}</strong>] không thuộc về độc giả <strong>{selectedResv.reader_name}</strong>. Tuyệt đối không giao sách nhầm người!
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mã QR bản sao cuốn sách vật lý giữ tại quầy */}
              <div className="space-y-1.5 border-t border-border/50 pt-3">
                <label className="text-[11px] text-foreground font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <QrCode className="h-3.5 w-3.5" /> Mã QR trên cuốn sách vật lý giữ tại quầy (*)
                  </span>
                  <span className="text-[10px] text-muted-foreground">Bắt buộc quét đúng sách</span>
                </label>
                <Input
                  value={bookCopyQrInput}
                  onChange={(e) => setBookCopyQrInput(e.target.value)}
                  placeholder="Quét mã QR sách hoặc nhập (VD: LIB-BK-1-1)..."
                  className="text-xs font-mono h-8 bg-card border-border/80"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={handleCloseHandoverModal} className="text-xs">
              Đóng
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmHandover}
              disabled={submittingHandover || !scannedCodeInput.trim() || codeMatchStatus !== true}
              className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
            >
              {submittingHandover ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              <span>Xác nhận giao sách cho độc giả</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
