import { useState, useEffect, useRef } from "react";
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
  Check
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
  status: "pending" | "ready" | "completed" | "cancelled";
  reader_name: string;
  card_number: string;
  reader_email?: string;
  reader_phone?: string;
  book_title: string;
  book_id: number;
  available_copies?: number;
  total_copies?: number;
  cover_image?: string;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  pending: { label: "Đang đợi sách", cls: "bg-warning/15 text-warning border-warning/30" },
  ready: { label: "Sẵn sàng nhận", cls: "bg-success/15 text-success border-success/20 animate-pulse font-semibold" },
  completed: { label: "Đã hoàn thành", cls: "bg-muted text-muted-foreground border-muted-foreground/20" },
  cancelled: { label: "Đã hủy", cls: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function ReservationsPage() {
  const [resList, setResList] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState("");
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

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

  // Reader's Ticket QR Modal State (For Reader)
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketForReader, setTicketForReader] = useState<Reservation | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const response = await api.get("/reservations");
      setResList(response.data);
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

        // Check available video devices
        let cameras: Array<{ id: string; label: string }> = [];
        try {
          cameras = await Html5Qrcode.getCameras();
        } catch (camErr) {
          console.warn("Could not enumerate cameras, will fallback to environment constraint:", camErr);
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

  const handleOpenTicketModal = (resv: Reservation) => {
    setTicketForReader(resv);
    setCopiedCode(false);
    setTicketModalOpen(true);
  };

  // Download QR Code Canvas as PNG for Readers
  const handleDownloadQr = (filename: string) => {
    const canvas = document.getElementById("reader-reservation-qr-canvas") as HTMLCanvasElement;
    if (!canvas) {
      toast.error("Không tìm thấy mã QR để tải xuống");
      return;
    }
    const pngUrl = canvas.toDataURL("image/png");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `${filename}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    toast.success(`Đã tải ảnh mã QR (${filename}.png) về thiết bị của bạn!`);
  };

  const handleCopyTicketCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    toast.success("Đã sao chép mã phiếu nhận sách!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Verify scanned code against the selected reservation
  const isCodeMatch = () => {
    if (!selectedResv || !scannedCodeInput.trim()) return null;
    const input = scannedCodeInput.trim().toUpperCase().replace(/\s+/g, "");
    const expectedTicket = `TICKET-RES-${selectedResv.id}`.toUpperCase();
    const expectedCard = selectedResv.card_number ? selectedResv.card_number.toUpperCase().replace(/\s+/g, "") : "";

    // Match ticket formats
    if (
      input === expectedTicket ||
      input === `TICKET-${selectedResv.id}` ||
      input === `RES-${selectedResv.id}` ||
      input === String(selectedResv.id)
    ) {
      return true;
    }

    // Match reader card number
    if (expectedCard && input === expectedCard) {
      return true;
    }

    // Match email
    if (selectedResv.reader_email && scannedCodeInput.trim() === selectedResv.reader_email) {
      return true;
    }

    // JSON format
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
      toast.error("Vui lòng quét hoặc nhập mã QR của độc giả để xác thực trước khi giao sách!");
      return;
    }

    const match = isCodeMatch();
    if (match === false) {
      toast.error(`Mã QR quét được không khớp với độc giả "${selectedResv.reader_name}"! Tuyệt đối không được giao sách nhầm người.`);
      return;
    }

    setSubmittingHandover(true);
    try {
      const res = await api.put(`/reservations/${selectedResv.id}/complete`, {
        scannedCode: targetCode,
        bookCopyQr: bookCopyQrInput.trim() || undefined,
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

  const handleCancel = (id: number) => {
    confirm({
      title: "Xác nhận hủy đặt trước",
      description: "Bạn có chắc chắn muốn hủy yêu cầu đặt trước đầu sách này không?",
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

  const filteredReservations = resList.filter((r) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      r.book_title.toLowerCase().includes(q) ||
      r.reader_name.toLowerCase().includes(q) ||
      (r.card_number && r.card_number.toLowerCase().includes(q)) ||
      String(r.id).includes(q)
    );
  });

  const totalActive = resList.filter((r) => r.status === "pending").length;
  const totalReady = resList.filter((r) => r.status === "ready").length;
  const totalCompleted = resList.filter((r) => r.status === "completed").length;
  const canManage = user?.role === "admin" || user?.role === "librarian";

  const codeMatchStatus = isCodeMatch();

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/80 shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <Calendar className="h-5 w-5 text-amber-500" />
              <Badge variant="outline" className="text-[10px] text-amber-600 bg-amber-500/10 border-amber-500/20">
                Đang chờ
              </Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-bold">{totalActive}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Đặt trước đang chờ sách về kho</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/[0.03] shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <Bell className="h-5 w-5 text-emerald-500 animate-bounce" />
              <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-500/15 border-emerald-500/30 font-bold">
                Cần quét QR giao
              </Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalReady}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Sách đã sẵn sàng tại quầy nhận</p>
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
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Yêu cầu đã giao sách thành công</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Reservation Management Table */}
      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-base">Hàng đợi & Quản lý Đặt trước sách</CardTitle>
              <CardDescription className="text-xs">
                Xác thực mã QR độc giả trước khi bàn giao sách để đảm bảo tính chính xác và an toàn tuyệt đối.
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
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-xs">Đang tải danh sách đặt trước...</p>
            </div>
          ) : filteredReservations.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-foreground">Không tìm thấy yêu cầu đặt trước nào</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {searchFilter ? "Không có kết quả khớp với từ khóa tìm kiếm." : "Hiện không có độc giả nào đang đặt trước sách."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-20">Mã phiếu</TableHead>
                  <TableHead>Tên sách</TableHead>
                  <TableHead>Độc giả đặt trước</TableHead>
                  <TableHead>Ngày đăng ký</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác & Xác thực QR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReservations.map((r) => (
                  <TableRow key={r.id} className={r.status === "ready" ? "bg-emerald-500/[0.03]" : ""}>
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
                      {new Date(r.reservation_date).toLocaleDateString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${statusMap[r.status]?.cls || ""}`}>
                        {statusMap[r.status]?.label || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* If status is ready and user is Librarian/Admin -> Quét QR Giao Sách */}
                        {r.status === "ready" && canManage && (
                          <Button
                            size="sm"
                            onClick={() => handleOpenHandoverModal(r)}
                            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs font-semibold"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span>Quét QR Giao sách</span>
                          </Button>
                        )}

                        {/* Reader can click to show their QR Code Ticket */}
                        {r.status === "ready" && !canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenTicketModal(r)}
                            className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 font-medium"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span>Mã QR nhận sách</span>
                          </Button>
                        )}

                        {/* If pending, reader can also see their ticket code */}
                        {r.status === "pending" && !canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenTicketModal(r)}
                            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            <span>Mã phiếu</span>
                          </Button>
                        )}

                        {/* Cancel button */}
                        {(r.status === "pending" || r.status === "ready") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleCancel(r.id)}
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

      {/* ======================================================== */}
      {/* MODAL 1: XÁC THỰC QUÉT MÃ QR GIAO SÁCH (CHO THỦ THƯ) */}
      {/* ======================================================== */}
      <Dialog open={handoverModalOpen} onOpenChange={(open) => !open && handleCloseHandoverModal()}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-base">
              <QrCode className="h-5 w-5 text-emerald-600" />
              <span>Xác thực mã QR & Bàn giao sách đặt trước</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Thủ thư bắt buộc phải quét mã QR trên điện thoại độc giả hoặc mã thẻ thư viện để đối soát chính xác trước khi giao sách.
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
                    <p className="text-[11px] text-muted-foreground font-mono">Mã phiếu: TICKET-RES-{selectedResv.id}</p>
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
                    <span>Quét mã QR từ độc giả</span>
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

                {/* HTML5 QR Code Scanner Element (Always in DOM with proper dimensions when active) */}
                <div
                  id="handover-qr-reader"
                  className={`overflow-hidden rounded-xl border border-dashed border-border bg-black/5 text-center transition-all ${
                    isCameraActive ? "block min-h-[260px] w-full p-2" : "hidden"
                  }`}
                />
                <div id="handover-qr-reader-file-temp" className="hidden" />

                {/* Manual Input or Barcode Gun Input */}
                <div className="relative">
                  <QrCode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={scannedCodeInput}
                    onChange={(e) => setScannedCodeInput(e.target.value)}
                    placeholder={`Nhập hoặc quét mã: TICKET-RES-${selectedResv.id} hoặc ${selectedResv.card_number || "Mã thẻ"}`}
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
                          Mã quét được [<strong>{scannedCodeInput}</strong>] không thuộc về độc giả <strong>{selectedResv.reader_name}</strong> của phiếu đặt trước này. Tuyệt đối không được giao sách cho người khác!
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Optional: Gán mã QR bản sao cụ thể */}
              <div className="space-y-1.5 border-t border-border/50 pt-3">
                <label className="text-[11px] text-muted-foreground font-medium flex items-center justify-between">
                  <span>Mã QR bản sao sách giao (Tùy chọn)</span>
                  <span className="text-[10px] text-muted-foreground">Mặc định: Tự động chọn 1 bản sao sẵn có trong kho</span>
                </label>
                <Input
                  value={bookCopyQrInput}
                  onChange={(e) => setBookCopyQrInput(e.target.value)}
                  placeholder="Ví dụ: QR-BK-1-1 hoặc LIB-BK-..."
                  className="text-xs font-mono h-8 bg-muted/20"
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

      {/* ======================================================== */}
      {/* MODAL 2: XEM MÃ QR NHẬN SÁCH (CHO ĐỘC GIẢ XUẤT TRÌNH & TẢI VỀ) */}
      {/* ======================================================== */}
      <Dialog open={ticketModalOpen} onOpenChange={setTicketModalOpen}>
        <DialogContent className="sm:max-w-[400px] text-center">
          <DialogHeader>
            <DialogTitle className="font-display text-base">Mã QR Phiếu nhận sách</DialogTitle>
            <DialogDescription className="text-xs">
              Xuất trình mã này tại quầy để thủ thư quét xác thực, hoặc tải ảnh về máy để tiện sử dụng khi không có mạng.
            </DialogDescription>
          </DialogHeader>

          {ticketForReader && (
            <div className="flex flex-col items-center py-3 space-y-4">
              {/* QR Code Canvas */}
              <div className="rounded-2xl border-2 border-primary/20 bg-white p-4 shadow-md">
                <QRCodeCanvas
                  id="reader-reservation-qr-canvas"
                  value={`TICKET-RES-${ticketForReader.id}`}
                  size={200}
                  level="H"
                  includeMargin={false}
                />
              </div>

              {/* Ticket Details */}
              <div className="space-y-1.5 w-full">
                <div className="flex items-center justify-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-xs font-bold text-primary border-primary/30 px-3 py-1 bg-primary/5">
                    TICKET-RES-{ticketForReader.id}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyTicketCode(`TICKET-RES-${ticketForReader.id}`)}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Sao chép mã phiếu"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>

                <p className="font-bold text-sm text-foreground">{ticketForReader.book_title}</p>
                <p className="text-xs text-muted-foreground">
                  Độc giả: <strong>{ticketForReader.reader_name}</strong> {ticketForReader.card_number ? `(${ticketForReader.card_number})` : ""}
                </p>
              </div>

              {/* Status Alert */}
              <div className="w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                {ticketForReader.status === "ready" ? (
                  <span>✅ Sách đã có sẵn tại quầy! Vui lòng đến nhận trong vòng 48 giờ.</span>
                ) : (
                  <span>⏳ Đang chờ sách được hoàn trả về kho. Hệ thống sẽ thông báo ngay khi có sách.</span>
                )}
              </div>

              {/* Download QR Image Button for Reader */}
              <Button
                type="button"
                size="sm"
                onClick={() => handleDownloadQr(`Phieu-Nhan-Sach-RES-${ticketForReader.id}`)}
                className="w-full text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
              >
                <Download className="h-4 w-4" />
                <span>Tải ảnh mã QR về máy</span>
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTicketModalOpen(false)} className="w-full text-xs">
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
