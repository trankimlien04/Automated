import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { 
  Camera, BookOpen, User, Clock, CheckCircle2, Scan, RefreshCw, 
  Upload, QrCode, AlertTriangle, ShieldCheck, ArrowRightLeft, 
  Search, CheckCircle, FileSpreadsheet, BookMarked,
  Download, Zap, CheckSquare, XCircle, UserCheck
} from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { QRCodeCanvas } from "qrcode.react";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/contexts/AuthContext";

interface Transaction {
  id: number;
  borrow_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  renewal_count?: number;
  reader_name: string;
  card_number: string;
  reader_phone?: string;
  book_title: string;
  cover_image?: string;
  qr_code: string;
  processed_by_name?: string;
}

interface Reservation {
  id: number;
  reservation_date: string;
  status: string;
  reader_name: string;
  card_number: string;
  book_title: string;
  book_id: number;
  cover_image?: string;
}

interface ScannedReaderData {
  reader: {
    id: number;
    full_name: string;
    email: string;
    card_number: string;
    status: string;
  };
  canBorrow?: boolean;
  borrowBlockReason?: string | null;
  monthlyBorrowCount?: number;
  activeBorrowCount?: number;
  overdueCount?: number;
  maxBooksAllowed?: number;
  pendingRequests: {
    reservation_id: number;
    reservation_date: string;
    reservation_status: string;
    book_id: number;
    book_title: string;
    isbn?: string;
    cover_image?: string;
    available_copies: number;
  }[];
  activeBorrows: {
    id: number;
    borrow_date: string;
    due_date: string;
    book_title: string;
    qr_code: string;
    cover_image?: string;
    overdue_days?: number;
    fine_amount?: number;
    renewal_count?: number;
  }[];
  unpaidFines?: {
    id: number;
    amount: number;
    reason: string;
    status: string;
    created_at: string;
    book_title?: string;
  }[];
  totalUnpaidFines?: number;
}

export default function BorrowPage() {
  const [history, setHistory] = useState<Transaction[]>([]);
  const [myReservations, setMyReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const { user } = useAuth();
  
  // Librarian Scanned Reader Checkout Data
  const [scannedReaderInfo, setScannedReaderInfo] = useState<ScannedReaderData | null>(null);
  const [searchReaderInput, setSearchReaderInput] = useState("");
  const [directBookQr, setDirectBookQr] = useState("");
  const [activeTab, setActiveTab] = useState("checkout");
  
  // Return form state
  const [returnBookQr, setReturnBookQr] = useState("");

  // Scanner Dialogs
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scannerMode, setScannerMode] = useState<"reader_card" | "return" | "direct_borrow">("reader_card");
  const [simulatedQrCode, setSimulatedQrCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Reader profile info for QR
  const [readerProfile, setReaderProfile] = useState<any>(null);

  // Modal to inspect a specific book copy QR code
  const [viewCopyQrDialog, setViewCopyQrDialog] = useState(false);
  const [selectedCopyQr, setSelectedCopyQr] = useState<{ title: string; qrCode: string; readerName?: string } | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const response = await api.get("/borrow/records");
      setHistory(response.data);
    } catch (error) {
      console.error("Lỗi khi tải lịch sử giao dịch:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMyReservations = async () => {
    try {
      const response = await api.get("/reservations");
      setMyReservations(response.data);
    } catch (error) {
      console.error("Lỗi khi tải danh sách sách đăng ký:", error);
    }
  };

  const fetchUserProfile = async () => {
    try {
      const response = await api.get("/users/profile/me");
      setReaderProfile(response.data?.user || response.data);
    } catch (error) {
      console.error("Lỗi khi tải thông tin độc giả:", error);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchMyReservations();
    fetchUserProfile();
  }, [user]);

  // Clean up camera on unmount
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

  // Download QR Code Canvas as PNG
  const handleDownloadQr = (canvasId: string, filename: string) => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
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
    toast.success(`Đã tải ảnh mã QR (${filename}.png) về máy!`);
  };

  // Librarian: Fetch reader info & their requested books when scanning reader card QR or Ticket QR
  const loadReaderCheckoutInfo = async (cardNumber: string) => {
    const trimmed = cardNumber.trim();
    if (!trimmed) {
      toast.error("Vui lòng nhập hoặc quét mã thẻ");
      return;
    }
    try {
      const res = await api.get(`/borrow/reader-checkout-info/${encodeURIComponent(trimmed)}`);
      if (res.data.type === 'book_copy') {
        toast.info(res.data.message || `Đã quét mã sách: ${res.data.bookCopy?.title}`);
        if (scannerMode === 'return' || activeTab === 'return') {
          setReturnBookQr(res.data.bookCopy.qr_code);
          handleReturnSubmit(res.data.bookCopy.qr_code);
        } else {
          setDirectBookQr(res.data.bookCopy.qr_code);
          toast.success(`Đã điền mã sách "${res.data.bookCopy.title}" vào ô cho mượn trực tiếp`);
        }
        return;
      }

      setScannedReaderInfo(res.data);
      setSearchReaderInput(res.data.reader.card_number || `LIB-RD-${String(res.data.reader.id).padStart(6, '0')}`);
      setActiveTab("checkout");
      toast.success(`Đã nhận diện độc giả: ${res.data.reader.full_name} (${res.data.reader.card_number || 'ID: ' + res.data.reader.id})`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không tìm thấy thông tin phù hợp với mã này");
      setScannedReaderInfo(null);
    }
  };

  // Librarian: Process scanned QR (Card, Ticket or Book Return)
  const processScannedText = async (decodedText: string) => {
    const code = decodedText.trim();
    await stopCameraScanner();
    setIsScannerOpen(false);

    if (!code) return;

    // 1. If scanned code is a Reader Card QR (LIB-RD-..., LIB-AD-..., LIB-LB-..., USER-..., UID-...)
    const isReaderCard = /^(?:LIB-RD-|LIB-AD-|LIB-LB-|LIB-OW-|RD-|USER-|UID-)/i.test(code);
    if (isReaderCard) {
      setSearchReaderInput(code);
      setReturnBookQr("");
      await loadReaderCheckoutInfo(code);
      return;
    }

    // 2. If in direct borrow scanner mode (scanning book to borrow for current reader)
    if (scannerMode === "direct_borrow") {
      setDirectBookQr(code);
      handleDirectBorrow(undefined, code);
      return;
    }

    // 3. If in return scanner mode
    if (scannerMode === "return") {
      // Check if it might be a reader by querying info
      try {
        const checkRes = await api.get(`/borrow/reader-checkout-info/${encodeURIComponent(code)}`);
        if (checkRes.data.type === 'reader') {
          setScannedReaderInfo(checkRes.data);
          setSearchReaderInput(checkRes.data.reader.card_number || code);
          setReturnBookQr("");
          toast.success(`Đã nhận diện độc giả: ${checkRes.data.reader.full_name} (${checkRes.data.activeBorrows.length} cuốn đang mượn)`);
          return;
        }
      } catch (e) {}

      setReturnBookQr(code);
      handleReturnSubmit(code);
      return;
    }

    // Default: Scanned Reader Card QR or Ticket QR or Book QR
    setSearchReaderInput(code);
    loadReaderCheckoutInfo(code);
  };

  // Librarian: Approve a pending book request for reader (Duyệt mượn sách)
  const handleApproveReservation = async (reservationId: number, bookTitle: string) => {
    confirm({
      title: "Duyệt & Trao sách cho độc giả",
      description: `Bạn có xác nhận duyệt cho mượn và trao cuốn "${bookTitle}" cho độc giả ${scannedReaderInfo?.reader.full_name} không?`,
      confirmText: "Duyệt & Trao sách ngay",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const res = await api.post("/borrow/approve-reservation", { reservationId });
          toast.success(res.data.message || "Đã duyệt và trao sách thành công!");
          // Reload reader info
          if (scannedReaderInfo?.reader.card_number) {
            loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
          } else if (scannedReaderInfo?.reader.id) {
            loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
          }
          fetchHistory();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Lỗi khi duyệt mượn sách");
        }
      }
    });
  };

  // Reader: Cancel reservation
  const handleCancelReservation = async (reservationId: number, bookTitle: string) => {
    confirm({
      title: "Hủy yêu cầu mượn sách",
      description: `Bạn có chắc chắn muốn hủy yêu cầu mượn cuốn "${bookTitle}" không?`,
      confirmText: "Hủy yêu cầu",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.put(`/reservations/${reservationId}/cancel`);
          toast.success("Đã hủy yêu cầu mượn sách thành công");
          fetchMyReservations();
          fetchHistory();
        } catch (err: any) {
          try {
            await api.delete(`/reservations/${reservationId}`);
            toast.success("Đã hủy yêu cầu mượn sách thành công");
            fetchMyReservations();
            fetchHistory();
          } catch (delErr: any) {
            toast.error(err.response?.data?.message || delErr.response?.data?.message || "Không thể hủy yêu cầu này");
          }
        }
      }
    });
  };

  // Librarian: Direct Borrow (Mượn trực tiếp tại quầy bằng mã sách)
  const handleDirectBorrow = async (e?: React.FormEvent, customBookQr?: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const targetBookQr = (customBookQr || directBookQr).trim();
    const readerCard = scannedReaderInfo?.reader.card_number || (scannedReaderInfo?.reader.id ? String(scannedReaderInfo.reader.id) : "");
    
    if (!readerCard) {
      toast.error("Vui lòng quét hoặc nhập mã thẻ độc giả ở mục 1 trước khi cho mượn sách");
      return;
    }
    if (!targetBookQr) {
      toast.error("Vui lòng nhập hoặc bật camera quét mã QR cuốn sách muốn cho mượn thêm");
      return;
    }

    confirm({
      title: "Xác nhận cho mượn thêm sách",
      description: `Bạn có đồng ý cho độc giả "${scannedReaderInfo?.reader.full_name}" (Mã thẻ: ${readerCard}) mượn thêm cuốn sách có mã QR [${targetBookQr}] không?`,
      confirmText: "Đồng ý cho mượn",
      cancelText: "Hủy bỏ",
      onConfirm: async () => {
        try {
          const res = await api.post("/borrow/borrow", {
            readerCardNumber: readerCard,
            bookQrCode: targetBookQr
          });
          toast.success(res.data.message || "Cho mượn thêm sách thành công!");
          setDirectBookQr("");
          loadReaderCheckoutInfo(readerCard);
          fetchHistory();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Lỗi khi cho mượn sách");
        }
      }
    });
  };

  // Librarian: Prompt scanning reader card or book barcode when clicking return from Circulation table
  const handleTableReturnPrompt = (record: Transaction) => {
    confirm({
      title: "Yêu cầu quét mã để nhận trả sách",
      description: `Để đảm bảo quy trình đối soát hiện vật tại quầy, vui lòng quét mã QR trên cuốn sách "${record.book_title}" (${record.qr_code}) hoặc quét mã thẻ của độc giả "${record.reader_name}" (${record.card_number}) để kiểm tra và nhận trả vào kho.`,
      confirmText: "Mở Camera Quét Trả Ngay",
      cancelText: "Đóng",
      variant: "warning",
      onConfirm: () => {
        setActiveTab("return");
        openScannerModal("return");
      }
    });
  };

  // Return book handler with strict fine collection rule
  const handleReturnSubmit = (bookQr?: string, loanData?: any) => {
    const qrToReturn = (bookQr || returnBookQr).trim();
    if (!qrToReturn) {
      toast.error("Vui lòng điền hoặc quét mã QR sách cần trả");
      return;
    }

    // If user mistakenly provided a Reader Card code into book return input
    if (/^(?:LIB-RD-|LIB-AD-|LIB-LB-|LIB-OW-|RD-|USER-|UID-)/i.test(qrToReturn)) {
      toast.info(`[${qrToReturn}] là Mã Thẻ Độc Giả. Đang tải danh sách sách độc giả đang mượn...`);
      setReturnBookQr("");
      setSearchReaderInput(qrToReturn);
      loadReaderCheckoutInfo(qrToReturn);
      return;
    }

    // Check if we know this loan is overdue
    let overdueDays = loanData?.overdue_days || 0;
    let fineAmount = loanData?.fine_amount || (overdueDays * 5000);
    let bookTitle = loanData?.book_title || "";

    if (!loanData && scannedReaderInfo?.activeBorrows) {
      const match = scannedReaderInfo.activeBorrows.find(b => b.qr_code === qrToReturn);
      if (match) {
        overdueDays = match.overdue_days || 0;
        fineAmount = match.fine_amount || (overdueDays * 5000);
        bookTitle = match.book_title;
      }
    }

    const executeReturn = async (confirmPaidFine: boolean = false) => {
      try {
        const response = await api.post("/borrow/return", {
          bookQrCode: qrToReturn,
          confirmPaidFine
        });

        const { overdueDays: resDays, fineAmount: resFine, finePaid } = response.data?.data || {};
        if (finePaid && resFine > 0) {
          toast.success(`Đã thu phí phạt ${resFine.toLocaleString('vi-VN')}đ và nhận trả sách thành công!`);
        } else {
          toast.success(response.data?.message || "Đã ghi nhận trả sách thành công vào kho!");
        }
        
        setReturnBookQr("");
        fetchHistory();
        if (scannedReaderInfo?.reader.card_number) {
          loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
        } else if (scannedReaderInfo?.reader.id) {
          loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
        }
      } catch (error: any) {
        const errData = error.response?.data;
        if (errData?.requiresFinePayment) {
          // If server rejects because fine payment is required, prompt librarian to collect fine
          confirm({
            title: "⚠️ Độc giả phải đóng phí phạt quá hạn",
            description: `Sách "${errData.bookTitle}" của độc giả ${errData.readerName} bị quá hạn ${errData.overdueDays} ngày. Phí phạt là ${errData.fineAmount.toLocaleString('vi-VN')}đ. Độc giả phải đóng đủ phí phạt mới được phép trả sách. Xác nhận đã thu đủ tiền phạt để hoàn tất trả sách?`,
            confirmText: `Đã thu ${errData.fineAmount.toLocaleString('vi-VN')}đ & Nhận sách`,
            cancelText: "Hủy bỏ",
            variant: "warning",
            onConfirm: () => executeReturn(true)
          });
        } else {
          toast.error(errData?.message || "Không thể thực hiện trả sách");
        }
      }
    };

    if (overdueDays > 0) {
      const oldDebt = scannedReaderInfo?.totalUnpaidFines || 0;
      confirm({
        title: "⚠️ Thu phí phạt trễ hạn cho cuốn sách này",
        description: `• Phí phạt trễ hạn của cuốn "${bookTitle || qrToReturn}": ${fineAmount.toLocaleString('vi-VN')}đ (${overdueDays} ngày trễ × 5.000đ/ngày).${
          oldDebt > 0 
            ? `\n• Độc giả còn có nợ phạt cũ từ các lần trước: ${oldDebt.toLocaleString('vi-VN')}đ.\n👉 Tổng nghĩa vụ cần thu nếu thanh toán tất cả: ${(oldDebt + fineAmount).toLocaleString('vi-VN')}đ.`
            : ''
        }\n\nBạn xác nhận thu ${fineAmount.toLocaleString('vi-VN')}đ (tiền phạt của cuốn này) để hoàn tất nhận trả sách vào kho?`,
        confirmText: `Đã thu ${fineAmount.toLocaleString('vi-VN')}đ & Nhận trả`,
        cancelText: "Hủy",
        variant: "warning",
        onConfirm: () => executeReturn(true)
      });
    } else {
      confirm({
        title: "Xác nhận nhận trả sách",
        description: `Xác nhận tiếp nhận thu hồi cuốn sách [${bookTitle || qrToReturn}] vào kho thư viện?`,
        confirmText: "Xác nhận nhận sách",
        cancelText: "Hủy",
        onConfirm: () => executeReturn(false)
      });
    }
  };

  // Renew book handler
  const handleRenew = (id: number, title: string) => {
    confirm({
      title: "Xác nhận gia hạn mượn sách",
      description: `Gia hạn thêm 07 ngày thời gian đọc cho ấn phẩm "${title}"?`,
      confirmText: "Gia hạn ngay",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const response = await api.post("/borrow/renew", { borrowRecordId: id });
          toast.success(response.data.message || "Gia hạn mượn sách thành công thêm 7 ngày!");
          fetchHistory();
        } catch (error: any) {
          toast.error(error.response?.data?.message || "Không thể gia hạn phiếu mượn này");
        }
      }
    });
  };

  // Camera start / stop functions
  const startCameraScanner = async () => {
    setIsCameraActive(true);
    setTimeout(async () => {
      try {
        const viewport = document.getElementById("qr-reader-viewport");
        if (!viewport) return;

        if (html5QrCodeRef.current) {
          try {
            if (html5QrCodeRef.current.isScanning) {
              await html5QrCodeRef.current.stop();
            }
            html5QrCodeRef.current.clear();
          } catch (e) {}
        }

        const scanner = new Html5Qrcode("qr-reader-viewport");
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            processScannedText(decodedText);
          },
          () => {}
        );
      } catch (err) {
        console.error("Camera start error:", err);
        toast.error("Không thể mở camera. Vui lòng cấp quyền truy cập máy ảnh hoặc tải file ảnh QR.");
        setIsCameraActive(false);
      }
    }, 250);
  };

  const stopCameraScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.error(e);
      }
      html5QrCodeRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Scanner modal helper
  const openScannerModal = (mode: "reader_card" | "return") => {
    setScannerMode(mode);
    setSimulatedQrCode("");
    setIsCameraActive(false);
    setIsScannerOpen(true);
  };

  const handleSimulatedScan = () => {
    if (!simulatedQrCode.trim()) {
      toast.error("Vui lòng nhập mã quét");
      return;
    }
    processScannedText(simulatedQrCode);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const html5QrCode = new Html5Qrcode("hidden-qr-reader");
      try {
        const decodedText = await html5QrCode.scanFile(file, true);
        processScannedText(decodedText);
      } catch (err) {
        toast.error("Không tìm thấy mã QR hợp lệ trong ảnh này");
      } finally {
        try {
          html5QrCode.clear();
        } catch (e) {}
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const activeLoans = history.filter(h => h.status === 'borrowing');
  const pendingRequests = myReservations.filter(r => r.status === 'pending' || r.status === 'ready');
  const readerName = readerProfile?.full_name || (readerProfile as any)?.user?.full_name || user?.fullName || (user as any)?.full_name || "Độc giả";
  const readerCardNumber = readerProfile?.card_number || (readerProfile as any)?.user?.card_number || (user as any)?.card_number || (user?.id ? `LIB-RD-${String(user.id).padStart(6, '0')}` : "LIB-RD-100001");
  const readerEmail = readerProfile?.email || (readerProfile as any)?.user?.email || user?.email || "";

  const getDueStatus = (dueDateStr: string) => {
    const due = new Date(dueDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Quá hạn ${Math.abs(diffDays)} ngày`, variant: "destructive" as const, isOverdue: true };
    } else if (diffDays === 0) {
      return { text: "Hôm nay là hạn chót!", variant: "secondary" as const, isOverdue: false };
    }
    return { text: `Còn ${diffDays} ngày`, variant: "outline" as const, isOverdue: false };
  };

  // =========================================================================
  // VIEW 1: ĐỘC GIẢ (READER) - THẺ QR CÁ NHÂN & SÁCH ĐÃ ĐĂNG KÝ MƯỢN
  // =========================================================================
  if (user?.role === "reader") {
    return (
      <div className="space-y-6">
        {/* Banner */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 rounded-2xl border border-primary/20">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-primary text-primary-foreground">Không Gian Độc Giả</Badge>
              <span className="text-xs text-muted-foreground">Thẻ Thư Viện QR & Sách Đã Đăng Ký</span>
            </div>
            <h1 className="font-display text-2xl font-bold mt-1">Sổ Mượn Sách & Thẻ Thư Viện Của Tôi</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Đến thư viện chỉ cần đưa mã thẻ QR này cho Thủ thư quét. Thủ thư sẽ thấy ngay danh sách sách bạn muốn mượn để duyệt trao sách.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { fetchMyReservations(); fetchHistory(); }} className="gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ
            </Button>
          </div>
        </div>

        {/* Banner cảnh báo nếu độc giả có sách quá hạn */}
        {activeLoans.some(l => getDueStatus(l.due_date).isOverdue) && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-destructive">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive animate-pulse" />
              <div>
                <p className="font-bold">Lưu ý: Bạn có sách đang mượn đã quá hạn trả!</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Theo quy chế của thư viện, độc giả cần nộp phí phạt trễ hạn tại quầy thì thủ thư mới có thể hoàn tất nhận trả sách vào kho và duyệt mượn thêm sách mới.
                </p>
              </div>
            </div>
            <Badge variant="destructive" className="shrink-0 w-fit">Cần đóng phạt tại quầy</Badge>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Cột trái: Thẻ QR Cá Nhân Độc Giả */}
          <Card className="border-primary/30 shadow-xs bg-gradient-to-b from-card to-primary/5">
            <CardHeader className="pb-3 text-center">
              <CardTitle className="font-display text-base flex items-center justify-center gap-2">
                <QrCode className="h-5 w-5 text-primary" /> Thẻ QR Thư Viện Cá Nhân
              </CardTitle>
              <CardDescription className="text-xs">
                Mã thẻ dùng để Thủ thư quét nhận diện & duyệt sách tại quầy
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-3.5">
              <div className="p-3.5 bg-white rounded-2xl shadow-sm border-2 border-primary/20 flex flex-col items-center">
                <QRCodeCanvas
                  id="reader-card-canvas"
                  value={readerCardNumber}
                  size={175}
                  level="H"
                  includeMargin={true}
                  className="rounded-lg"
                />
                <code className="text-sm font-bold text-primary tracking-wider px-2 py-0.5 bg-primary/10 rounded-md mt-1.5 inline-block">
                  {readerCardNumber}
                </code>
              </div>

              <Button 
                size="sm" 
                variant="outline" 
                className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => handleDownloadQr("reader-card-canvas", `The-Doc-Gia-${readerCardNumber}`)}
              >
                <Download className="h-3.5 w-3.5" /> Tải ảnh Thẻ QR về máy
              </Button>

              <div className="w-full bg-muted/40 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Chủ thẻ:</span>
                  <span className="font-semibold text-foreground">{readerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email:</span>
                  <span className="font-medium text-foreground">{readerEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trạng thái:</span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50">
                    <CheckCircle className="h-2.5 w-2.5 mr-1" /> Đang hoạt động
                  </Badge>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground bg-primary/5 p-3 rounded-xl border border-primary/10 w-full text-center">
                💡 <strong>Cách mượn sách:</strong> Bạn vào mục <em>Quản lý sách</em> bấm <em>"Đăng ký mượn"</em>. Sau đó tới thư viện chỉ cần giơ mã QR này là Thủ thư sẽ trao sách ngay!
              </div>

              {/* Bảng tóm tắt Chính sách thư viện */}
              <div className="w-full bg-card rounded-xl p-3 border shadow-xs space-y-2 text-xs">
                <p className="font-semibold text-foreground flex items-center gap-1.5 text-[12px]">
                  📜 Quy Định Nghiệp Vụ Mượn Sách
                </p>
                <div className="space-y-1.5 text-muted-foreground text-[11px] leading-relaxed">
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0">📚</span>
                    <span><strong>Giới hạn sách đang mượn:</strong> tối đa <strong>5 cuốn/độc giả</strong>. Các sách đã mượn nhưng chưa trả vẫn được tính vào hạn mức, bất kể ngày mượn.</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>⏰</span>
                    <span><strong>Thời hạn mượn:</strong> <strong>14 ngày</strong> / cuốn</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>🔄</span>
                    <span><strong>Gia hạn:</strong> <strong>1 lần (+7 ngày)</strong> nếu không có người chờ</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>✅</span>
                    <span><strong>Trả sách:</strong> Xong được <strong>mượn sách mới ngay lập tức</strong></span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="shrink-0">⚠️</span>
                    <span><strong>Khóa quyền mượn:</strong> Nếu có <strong>sách quá hạn</strong> hoặc <strong>nợ phí phạt</strong></span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cột giữa & phải: Danh sách Sách Đã Đăng Ký Chờ Duyệt & Sách Đang Mượn */}
          <div className="lg:col-span-2 space-y-6">
            {/* KHU VỰC 1: SÁCH BẠN ĐÃ ĐĂNG KÝ (CHỜ THỦ THƯ DUYỆT TẠI QUẦY) */}
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-display text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <BookOpen className="h-5 w-5" /> Sách Bạn Đã Đăng Ký Mượn ({pendingRequests.length})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Khi tới thư viện, giơ Thẻ QR của bạn để Thủ thư duyệt và trao các cuốn sách này
                    </CardDescription>
                  </div>
                  <Badge className="bg-amber-600 text-white text-[10px]">Chờ duyệt tại quầy</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {pendingRequests.length === 0 ? (
                  <div className="text-center py-6 border border-dashed rounded-xl bg-background/50">
                    <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-1.5" />
                    <p className="text-xs font-medium">Bạn chưa đăng ký mượn cuốn sách nào</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Hãy vào trang <strong>Quản lý sách</strong> và bấm <em>"Đăng ký mượn cuốn này"</em> để lưu vào danh sách.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {pendingRequests.map((resv) => (
                      <div key={resv.id} className="p-3 rounded-xl border bg-card shadow-xs flex flex-col justify-between space-y-2.5">
                        <div className="flex items-start gap-3">
                          <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                            {resv.cover_image ? (
                              <img src={resv.cover_image} alt={resv.book_title} className="h-full w-full object-cover" />
                            ) : (
                              <BookOpen className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-semibold text-xs truncate">{resv.book_title}</h4>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Đăng ký: {new Date(resv.reservation_date).toLocaleDateString("vi-VN")}
                            </p>
                            <Badge variant="outline" className="text-[9px] mt-1 text-amber-700 border-amber-300 bg-amber-50">
                              ⏳ Chờ thủ thư quét thẻ duyệt
                            </Badge>
                          </div>
                        </div>

                        <div className="pt-2 border-t flex justify-end">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-7 text-xs text-destructive hover:bg-destructive/10 gap-1 px-2"
                            onClick={() => handleCancelReservation(resv.id, resv.book_title)}
                          >
                            <XCircle className="h-3 w-3" /> Hủy yêu cầu
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* KHU VỰC 2: SÁCH BẠN ĐANG MƯỢN */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-display text-base flex items-center gap-2">
                      <BookMarked className="h-5 w-5 text-primary" /> Sách Bạn Đang Mượn ({activeLoans.length}/5)
                    </CardTitle>
                    <CardDescription className="text-xs">Theo dõi hạn trả và tự gia hạn mượn sách (tối đa 1 lần / +7 ngày)</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {activeLoans.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Bạn hiện không có sách nào đang mượn</p>
                ) : (
                  <div className="space-y-3">
                    {activeLoans.map((loan) => {
                      const dueStatus = getDueStatus(loan.due_date);
                      const isOverdue = dueStatus.isOverdue;
                      const hasRenewed = (loan.renewal_count || 0) >= 1;

                      return (
                        <div key={loan.id} className="p-3.5 rounded-xl border bg-card text-xs space-y-2.5 shadow-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                {loan.cover_image ? (
                                  <img src={loan.cover_image} alt={loan.book_title} className="h-full w-full object-cover" />
                                ) : (
                                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="font-semibold text-sm text-foreground">{loan.book_title}</p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-[10px] font-mono font-semibold">
                                    🏷️ Bản sao: {loan.qr_code}
                                  </Badge>
                                  <Badge variant={dueStatus.variant} className="text-[10px]">{dueStatus.text}</Badge>
                                  {hasRenewed && (
                                    <Badge variant="outline" className="text-[10px] bg-muted/40 text-muted-foreground border-muted-foreground/30">
                                      ✓ Đã gia hạn 1/1
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground">
                                  Mượn ngày: <strong>{new Date(loan.borrow_date).toLocaleDateString("vi-VN")}</strong> • Hạn trả: <span className={dueStatus.isOverdue ? "text-destructive font-bold" : "font-semibold text-foreground"}>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span>
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              {!isOverdue && !hasRenewed && (
                                <Button size="sm" variant="default" className="text-xs h-7 gap-1 shadow-xs" onClick={() => handleRenew(loan.id, loan.book_title)}>
                                  <RefreshCw className="h-3 w-3" /> Tự gia hạn +7 ngày
                                </Button>
                              )}
                              {!isOverdue && hasRenewed && (
                                <Badge variant="secondary" className="text-[11px] py-1 px-2 text-muted-foreground">
                                  Hết lượt gia hạn
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              Chủ thẻ: <strong className="text-foreground">{readerName}</strong> ({readerCardNumber})
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        {ConfirmDialogComponent}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: THỦ THƯ & ADMIN - QUẦY QUÉT THẺ ĐỘC GIẢ & DUYỆT SÁCH
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 rounded-2xl border border-primary/20">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary text-primary-foreground">Quầy Nghiệp Vụ</Badge>
            <span className="text-xs text-muted-foreground">Thủ thư & Quản trị viên</span>
          </div>
          <h1 className="font-display text-2xl font-bold mt-1">Quầy Quét Thẻ Độc Giả & Duyệt Mượn Sách</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quét mã thẻ QR của độc giả để hệ thống tự động tải ra danh sách sách độc giả muốn mượn và duyệt trao sách.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchHistory} className="gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="checkout" className="gap-2">
            <UserCheck className="h-4 w-4" /> Quầy Cho Mượn (Quét Thẻ)
          </TabsTrigger>
          <TabsTrigger value="return" className="gap-2">
            <CheckCircle2 className="h-4 w-4" /> Quầy Nhận Trả Sách
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: QUẦY CHO MƯỢN (QUÉT THẺ ĐỘC GIẢ -> HIỆN SÁCH MUỐN MƯỢN) */}
        <TabsContent value="checkout" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Cột 1: Khung Quét Mã Thẻ Độc Giả */}
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <Scan className="h-5 w-5 text-primary" /> 1. Quét Mã Thẻ Độc Giả
                </CardTitle>
                <CardDescription className="text-xs">
                  Quét mã QR trên điện thoại độc giả khi đến quầy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative aspect-video w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 grid place-items-center p-4">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Camera className="h-8 w-8 text-primary animate-pulse" />
                    <p className="font-semibold text-xs">Camera Quét Thẻ Độc Giả</p>
                    <Button onClick={() => openScannerModal("reader_card")} size="sm" className="gap-1.5 text-xs mt-1">
                      <Scan className="h-3.5 w-3.5" /> Bật Camera Quét Thẻ
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <label className="text-xs font-medium text-muted-foreground">Hoặc nhập mã số thẻ thủ công:</label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="VD: LIB-RD-123456" 
                      value={searchReaderInput} 
                      onChange={(e) => setSearchReaderInput(e.target.value)} 
                      className="text-xs h-9"
                    />
                    <Button size="sm" onClick={() => loadReaderCheckoutInfo(searchReaderInput)} className="text-xs">
                      Tìm kiếm
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cột 2 & 3: Kết Quả Nhận Diện Độc Giả & Danh Sách Sách Muốn Mượn */}
            <Card className="lg:col-span-2 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-primary" /> 2. Danh Sách Sách Độc Giả Yêu Cầu Mượn
                </CardTitle>
                <CardDescription className="text-xs">
                  {scannedReaderInfo ? `Độc giả: ${scannedReaderInfo.reader.full_name} (${scannedReaderInfo.reader.card_number})` : "Chưa có độc giả nào được quét"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!scannedReaderInfo ? (
                  <div className="text-center py-12 border border-dashed rounded-xl bg-muted/20">
                    <User className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="font-medium text-sm">Vui lòng quét Thẻ QR độc giả ở cột bên trái</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hệ thống sẽ ngay lập tức tải ra các cuốn sách độc giả đã đăng ký trước để bạn duyệt trao sách.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Reader mini profile & Policy Status */}
                    <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-bold text-sm text-primary">{scannedReaderInfo.reader.full_name}</p>
                          <p className="text-muted-foreground mt-0.5">{scannedReaderInfo.reader.email} • Mã thẻ: <strong>{scannedReaderInfo.reader.card_number}</strong></p>
                        </div>
                        <div className="flex items-center gap-2">
                          {scannedReaderInfo.canBorrow === false ? (
                            <Badge variant="destructive" className="font-medium text-[11px]">
                              ⛔ Khóa quyền mượn sách
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-300 font-medium text-[11px]">
                              ✓ Đủ điều kiện mượn sách
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* 4 Thống kê chính sách mượn */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-primary/10">
                        <div className="p-2 bg-background/80 rounded-lg border text-center">
                          <span className="text-[10px] text-muted-foreground block">📚 Đang mượn</span>
                          <strong className="text-xs font-bold text-foreground">
                            {scannedReaderInfo.activeBorrowCount ?? scannedReaderInfo.activeBorrows.length} / {scannedReaderInfo.maxBooks || 5} cuốn
                          </strong>
                        </div>
                        <div className="p-2 bg-background/80 rounded-lg border text-center">
                          <span className="text-[10px] text-muted-foreground block">📊 Tháng này</span>
                          <strong className="text-xs font-bold text-primary">
                            {scannedReaderInfo.monthlyBorrowCount ?? 0} lượt
                          </strong>
                        </div>
                        <div className="p-2 bg-background/80 rounded-lg border text-center">
                          <span className="text-[10px] text-muted-foreground block">⚠️ Quá hạn</span>
                          <strong className={`text-xs font-bold ${(scannedReaderInfo.overdueCount || 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                            {scannedReaderInfo.overdueCount ?? 0} cuốn
                          </strong>
                        </div>
                        <div className="p-2 bg-background/80 rounded-lg border text-center">
                          <span className="text-[10px] text-muted-foreground block">💰 Nợ phí phạt</span>
                          <strong className={`text-xs font-bold ${(scannedReaderInfo.totalUnpaidFines || 0) > 0 ? "text-destructive" : "text-foreground"}`}>
                            {(scannedReaderInfo.totalUnpaidFines || 0).toLocaleString('vi-VN')}đ
                          </strong>
                        </div>
                      </div>
                    </div>

                    {/* Cảnh báo vi phạm chính sách nếu không đủ điều kiện mượn */}
                    {scannedReaderInfo.canBorrow === false && (
                      <div className="p-3.5 bg-destructive/10 border border-destructive/30 rounded-xl text-xs space-y-1">
                        <div className="flex items-center gap-2 text-destructive font-bold">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>Không đủ điều kiện mượn thêm sách theo chính sách thư viện:</span>
                        </div>
                        <p className="text-muted-foreground pl-6 leading-relaxed">
                          {scannedReaderInfo.borrowBlockReason || "Độc giả đang có sách quá hạn hoặc vượt quá số lượng mượn tối đa."}
                        </p>
                      </div>
                    )}

                    {/* Cảnh báo nợ phạt cũ tồn đọng nếu có */}
                    {scannedReaderInfo.totalUnpaidFines && scannedReaderInfo.totalUnpaidFines > 0 ? (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              Nợ phí phạt cũ chưa xử lý: {scannedReaderInfo.totalUnpaidFines.toLocaleString('vi-VN')}đ
                            </span>
                          </div>
                          <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 shrink-0">
                            Cần thu trước khi cho mượn
                          </Badge>
                        </div>
                      </div>
                    ) : null}

                    {/* Danh sách sách độc giả muốn mượn (đặt trước) */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-amber-600" /> Sách độc giả đã đăng ký mượn ({scannedReaderInfo.pendingRequests.length} cuốn)
                      </p>
                      {scannedReaderInfo.pendingRequests.length === 0 ? (
                        <div className="text-center py-4 border rounded-xl bg-muted/10 text-xs text-muted-foreground">
                          Độc giả này không có yêu cầu đăng ký mượn sách nào đang chờ duyệt.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {scannedReaderInfo.pendingRequests.map((req) => (
                            <div key={req.reservation_id} className="flex items-center justify-between p-3 rounded-xl border bg-card text-xs">
                              <div className="flex items-center gap-3">
                                <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                  {req.cover_image ? (
                                    <img src={req.cover_image} alt={req.book_title} className="h-full w-full object-cover" />
                                  ) : (
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-sm">{req.book_title}</p>
                                  <p className="text-muted-foreground text-[11px] mt-0.5">
                                    Đăng ký: {new Date(req.reservation_date).toLocaleDateString("vi-VN")} • Tồn kho sẵn có: <strong className="text-emerald-600">{req.available_copies} cuốn</strong>
                                  </p>
                                </div>
                              </div>

                              <Button 
                                size="sm" 
                                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs disabled:opacity-50"
                                onClick={() => handleApproveReservation(req.reservation_id, req.book_title)}
                                disabled={req.available_copies <= 0 || scannedReaderInfo.canBorrow === false}
                                title={scannedReaderInfo.canBorrow === false ? (scannedReaderInfo.borrowBlockReason || "Độc giả không đủ điều kiện mượn") : undefined}
                              >
                                <CheckSquare className="h-4 w-4" /> Duyệt & Trao Sách
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Danh sách các cuốn sách độc giả ĐANG MƯỢN (Thủ thư có thể chọn trả từng cuốn riêng lẻ) */}
                    <div className="border-t pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-primary">
                          <BookMarked className="h-3.5 w-3.5" /> Sách độc giả ĐANG MƯỢN ({scannedReaderInfo.activeBorrows.length} cuốn)
                        </span>
                        <span className="text-[11px] font-normal text-muted-foreground">Chọn trả riêng từng cuốn dưới đây (Trả xong độc giả được mượn tiếp)</span>
                      </p>

                      {scannedReaderInfo.activeBorrows.length === 0 ? (
                        <div className="text-center py-4 border rounded-xl bg-muted/10 text-xs text-muted-foreground">
                          Độc giả hiện không giữ cuốn sách nào của thư viện.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {scannedReaderInfo.activeBorrows.map((loan) => {
                            const dueStatus = getDueStatus(loan.due_date);
                            const isOverdue = dueStatus.isOverdue || (loan.overdue_days && loan.overdue_days > 0);
                            const fineAmount = loan.fine_amount || ((loan.overdue_days || 0) * 5000);
                            const hasRenewed = (loan.renewal_count || 0) >= 1;

                            return (
                              <div key={loan.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border bg-card text-xs gap-2">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-9 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                    {loan.cover_image ? (
                                      <img src={loan.cover_image} alt={loan.book_title} className="h-full w-full object-cover" />
                                    ) : (
                                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-semibold text-xs text-foreground">{loan.book_title}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                                      <code className="px-1 py-0.2 bg-muted rounded font-mono text-[10px]">{loan.qr_code}</code>
                                      <span>• Hạn: <span className={dueStatus.isOverdue ? "text-destructive font-bold" : ""}>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span></span>
                                      <Badge variant={dueStatus.variant} className="text-[9px] py-0 px-1.5">{dueStatus.text}</Badge>
                                      {hasRenewed && (
                                        <Badge variant="outline" className="text-[9px] py-0 px-1.5 bg-muted/40 text-muted-foreground">
                                          Gia hạn 1/1
                                        </Badge>
                                      )}
                                      {isOverdue && (
                                        <Badge variant="destructive" className="text-[9px] py-0 px-1.5">
                                          Phạt: {fineAmount.toLocaleString('vi-VN')}đ
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 justify-end shrink-0">
                                  {!dueStatus.isOverdue && !hasRenewed && (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                                      onClick={() => handleRenew(loan.id, loan.book_title)}
                                    >
                                      <RefreshCw className="h-3 w-3" /> Gia hạn +7n
                                    </Button>
                                  )}
                                  <Button 
                                    size="sm" 
                                    variant="default"
                                    className={`h-7 text-xs gap-1 px-2.5 shadow-xs font-medium ${
                                      isOverdue 
                                        ? "bg-amber-600 hover:bg-amber-700 text-white" 
                                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                    }`}
                                    onClick={() => handleReturnSubmit(loan.qr_code, loan)}
                                  >
                                    {isOverdue ? (
                                      <>
                                        <AlertTriangle className="h-3.5 w-3.5" /> Thu {fineAmount.toLocaleString('vi-VN')}đ & Trả sách
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Nhận trả cuốn này
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Ô cho mượn trực tiếp thêm nếu độc giả lấy thêm sách tại chỗ */}
                    <div className="border-t pt-3 space-y-2.5 bg-primary/5 p-3 rounded-xl border border-primary/15">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5 text-primary" /> Mượn thêm sách trực tiếp tại chỗ cho độc giả:
                        </p>
                        <Button 
                          type="button" 
                          size="sm" 
                          variant="outline" 
                          className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => openScannerModal("direct_borrow")}
                          disabled={scannedReaderInfo.canBorrow === false}
                        >
                          <Camera className="h-3.5 w-3.5" /> Quét Camera Mã Sách Mượn Thêm
                        </Button>
                      </div>

                      <form onSubmit={(e) => handleDirectBorrow(e)} className="flex gap-2">
                        <Input 
                          placeholder="Quét hoặc nhập mã QR cuốn sách lấy thêm (VD: QR-BK-1-1)..." 
                          value={directBookQr} 
                          onChange={(e) => setDirectBookQr(e.target.value)} 
                          className="text-xs h-9 bg-background"
                          disabled={scannedReaderInfo.canBorrow === false}
                        />
                        <Button 
                          type="submit" 
                          size="sm" 
                          className="text-xs shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                          disabled={scannedReaderInfo.canBorrow === false}
                        >
                          Cho mượn thêm
                        </Button>
                      </form>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 2: QUẦY NHẬN TRẢ SÁCH */}
        <TabsContent value="return" className="mt-4 space-y-4">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Cột 1: Khung quét sách trả hoặc quét thẻ độc giả */}
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <Scan className="h-5 w-5 text-primary" /> Quét Mã Sách Hoặc Thẻ Độc Giả
                </CardTitle>
                <CardDescription className="text-xs">
                  Quét mã QR trên gáy sách trả hoặc quét thẻ độc giả để chọn sách cần trả
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border bg-muted/30 p-6 text-center flex flex-col items-center">
                  <BookOpen className="h-8 w-8 text-primary animate-bounce" />
                  <p className="mt-2 font-display text-sm font-semibold">Quét Camera Sách / Thẻ</p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mt-0.5">
                    Đưa mã QR trên bìa sách hoặc mã thẻ độc giả vào camera
                  </p>
                  <Button onClick={() => openScannerModal("return")} className="mt-3 gap-2 text-xs" size="sm">
                    <Scan className="h-3.5 w-3.5" /> Bật Camera Quét Sách Trả
                  </Button>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <label className="text-xs font-medium">Hoặc nhập mã QR sách trả:</label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="VD: QR-BK-1-1" 
                      value={returnBookQr} 
                      onChange={(e) => setReturnBookQr(e.target.value)} 
                      className="text-xs h-9"
                    />
                    <Button onClick={() => handleReturnSubmit()} className="text-xs shrink-0">Nhận trả</Button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t">
                  <label className="text-xs font-medium text-muted-foreground">Hoặc tra cứu theo mã thẻ độc giả:</label>
                  <div className="flex gap-2">
                    <Input 
                      placeholder="VD: LIB-RD-000005" 
                      value={searchReaderInput} 
                      onChange={(e) => setSearchReaderInput(e.target.value)} 
                      className="text-xs h-9"
                    />
                    <Button variant="outline" size="sm" onClick={() => loadReaderCheckoutInfo(searchReaderInput)} className="text-xs shrink-0">
                      Xem sách đang mượn
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Cột 2 & 3: Danh sách sách độc giả đang mượn (để chọn trả từng cuốn) */}
            <Card className="lg:col-span-2 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <BookMarked className="h-5 w-5 text-primary" /> Danh Sách Sách Độc Giả Đang Mượn
                </CardTitle>
                <CardDescription className="text-xs">
                  {scannedReaderInfo ? `Độc giả: ${scannedReaderInfo.reader.full_name} (${scannedReaderInfo.reader.card_number})` : "Chưa chọn độc giả nào"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!scannedReaderInfo ? (
                  <div className="text-center py-12 border border-dashed rounded-xl bg-muted/20 text-xs text-muted-foreground">
                    <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="font-medium text-sm text-foreground">Bạn có thể trả sách theo 2 cách:</p>
                    <p className="mt-1">1. Quét trực tiếp <strong>mã QR dán trên cuốn sách</strong> trả vào kho.</p>
                    <p>2. Hoặc <strong>quét mã thẻ độc giả</strong> để danh sách các cuốn sách đang mượn hiện ra và bấm nút <em>"Nhận trả cuốn này"</em> cho cuốn độc giả muốn trả.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs">
                      <div>
                        <p className="font-bold text-sm text-primary">{scannedReaderInfo.reader.full_name}</p>
                        <p className="text-muted-foreground mt-0.5">Mã thẻ: <strong>{scannedReaderInfo.reader.card_number}</strong></p>
                      </div>
                      <Badge variant="secondary">Đang mượn: {scannedReaderInfo.activeBorrows.length} cuốn</Badge>
                    </div>

                    {/* Cảnh báo nợ phạt cũ tồn đọng nếu có */}
                    {scannedReaderInfo.totalUnpaidFines && scannedReaderInfo.totalUnpaidFines > 0 ? (
                      <div className="p-3.5 bg-destructive/10 border border-destructive/30 rounded-xl text-xs space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                            <span className="font-bold text-destructive">
                              Nợ phí phạt cũ tồn đọng (hóa đơn các lần trước): {scannedReaderInfo.totalUnpaidFines.toLocaleString('vi-VN')}đ
                            </span>
                          </div>
                          <Badge variant="destructive" className="text-[10px] shrink-0">Hóa đơn phạt cũ</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          📌 <em>Khoản {scannedReaderInfo.totalUnpaidFines.toLocaleString('vi-VN')}đ này là tổng nợ từ các đợt mượn trước lưu trong sổ Phí phạt. Khác với tiền phạt trễ hạn tạm tính của cuốn sách đang trả dưới đây.</em>
                        </p>
                      </div>
                    ) : null}

                    {scannedReaderInfo.activeBorrows.length === 0 ? (
                      <div className="text-center py-8 border rounded-xl bg-muted/10 text-xs text-muted-foreground">
                        Độc giả này hiện không còn sách nào đang mượn.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {scannedReaderInfo.activeBorrows.map((loan) => {
                          const dueStatus = getDueStatus(loan.due_date);
                          const isOverdue = dueStatus.isOverdue || (loan.overdue_days && loan.overdue_days > 0);
                          const fineAmount = loan.fine_amount || ((loan.overdue_days || 0) * 5000);

                          return (
                            <div key={loan.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border bg-card text-xs gap-2">
                              <div className="flex items-center gap-3">
                                <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                  {loan.cover_image ? (
                                    <img src={loan.cover_image} alt={loan.book_title} className="h-full w-full object-cover" />
                                  ) : (
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-sm">{loan.book_title}</p>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                    <code className="px-1.5 py-0.5 bg-muted rounded font-mono text-[10px]">{loan.qr_code}</code>
                                    <span>Ngày mượn: {new Date(loan.borrow_date).toLocaleDateString("vi-VN")}</span>
                                    <span>• Hạn trả: <span className={dueStatus.isOverdue ? "text-destructive font-bold" : ""}>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span></span>
                                    <Badge variant={dueStatus.variant} className="text-[9px]">{dueStatus.text}</Badge>
                                    {isOverdue && (
                                      <Badge variant="destructive" className="text-[9px]">
                                        Phạt: {fineAmount.toLocaleString('vi-VN')}đ
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <Button 
                                size="sm" 
                                className={`h-8 text-xs gap-1.5 px-3 font-semibold shadow-xs shrink-0 ${
                                  isOverdue 
                                    ? "bg-amber-600 hover:bg-amber-700 text-white" 
                                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                }`}
                                onClick={() => handleReturnSubmit(loan.qr_code, loan)}
                              >
                                {isOverdue ? (
                                  <>
                                    <AlertTriangle className="h-4 w-4" /> Thu {fineAmount.toLocaleString('vi-VN')}đ & Nhận trả
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="h-4 w-4" /> Nhận trả cuốn này
                                  </>
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Sổ Lưu Thông Chi Tiết */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="font-display text-base">Sổ Theo Dõi Lưu Thông Chi Tiết</CardTitle>
              <CardDescription className="text-xs">Toàn bộ lịch sử mượn trả</CardDescription>
            </div>
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Tìm theo sách, độc giả..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="p-2.5">Mã Phiếu</th>
                    <th className="p-2.5">Tên Sách & Bản Sao</th>
                    <th className="p-2.5">Chủ Thẻ / Độc Giả</th>
                    <th className="p-2.5">Ngày Mượn</th>
                    <th className="p-2.5">Hạn Trả</th>
                    <th className="p-2.5">Trạng Thái</th>
                    <th className="p-2.5 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.filter(t => !searchTerm || t.book_title.toLowerCase().includes(searchTerm.toLowerCase()) || t.reader_name.toLowerCase().includes(searchTerm.toLowerCase()) || (t.card_number && t.card_number.toLowerCase().includes(searchTerm.toLowerCase()))).map((record) => (
                    <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 font-mono text-muted-foreground">#{record.id}</td>
                      <td className="p-2.5">
                        <p className="font-semibold text-foreground">{record.book_title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <code className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.2 rounded font-semibold">
                            {record.qr_code}
                          </code>
                          <button 
                            onClick={() => {
                              setSelectedCopyQr({ title: record.book_title, qrCode: record.qr_code, readerName: record.reader_name });
                              setViewCopyQrDialog(true);
                            }}
                            className="text-[10px] text-muted-foreground hover:text-primary underline"
                          >
                            Xem QR
                          </button>
                        </div>
                      </td>
                      <td className="p-2.5">
                        <p className="font-semibold text-foreground">{record.reader_name}</p>
                        <p className="text-[10px] text-muted-foreground">Thẻ: <strong>{record.card_number}</strong> {record.reader_phone ? `• SĐT: ${record.reader_phone}` : ""}</p>
                      </td>
                      <td className="p-2.5 text-muted-foreground">{new Date(record.borrow_date).toLocaleDateString("vi-VN")}</td>
                      <td className="p-2.5">{new Date(record.due_date).toLocaleDateString("vi-VN")}</td>
                      <td className="p-2.5">
                        <Badge variant={record.status === "borrowing" ? "default" : "outline"} className="text-[9px]">
                          {record.status === "borrowing" ? "Đang mượn" : "Đã trả"}
                        </Badge>
                      </td>
                      <td className="p-2.5 text-right space-x-1">
                        {record.status === "borrowing" && (
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 text-emerald-600 border-emerald-300 hover:bg-emerald-50" onClick={() => handleTableReturnPrompt(record)}>
                            Nhận trả
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scanner Modal */}
      <Dialog open={isScannerOpen} onOpenChange={(open) => {
        setIsScannerOpen(open);
        if (!open) {
          stopCameraScanner();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Scan className="h-5 w-5 text-primary" /> 
              {scannerMode === "reader_card" && "Quét Mã Thẻ Độc Giả"}
              {scannerMode === "direct_borrow" && "Quét Mã QR Sách Cho Mượn Thêm"}
              {scannerMode === "return" && "Quét Mã QR Sách Trả / Thẻ Độc Giả"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {scannerMode === "reader_card" && "Đưa mã QR trên thẻ độc giả vào camera để mở danh sách sách muốn mượn"}
              {scannerMode === "direct_borrow" && `Đưa mã QR dán trên gáy/bìa cuốn sách lấy thêm vào camera để cho độc giả ${scannedReaderInfo?.reader.full_name || ''} mượn`}
              {scannerMode === "return" && "Đưa mã QR trên bìa sách để nhận trả vào kho hoặc mã thẻ độc giả để chọn sách trả"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!isCameraActive ? (
              <div className="flex flex-col gap-3">
                <Button onClick={startCameraScanner} className="w-full gap-2">
                  <Camera className="h-4 w-4" /> Bật Camera / WebCam Quét Trực Tiếp
                </Button>
                <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Tải ảnh mã QR từ thiết bị
                </Button>
                <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileUpload} />
                <Input 
                  placeholder={
                    scannerMode === "reader_card" 
                      ? "Hoặc nhập mã thẻ độc giả / mã phiếu (VD: LIB-RD-100001)..." 
                      : scannerMode === "direct_borrow" 
                      ? "Hoặc nhập mã QR cuốn sách lấy thêm (VD: QR-BK-1-1)..." 
                      : "Hoặc nhập mã QR sách / mã thẻ độc giả..."
                  }
                  value={simulatedQrCode} 
                  onChange={(e) => setSimulatedQrCode(e.target.value)} 
                  className="text-xs"
                />
                <Button onClick={handleSimulatedScan} variant="secondary" className="w-full text-xs">
                  Xác nhận nạp mã
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div id="qr-reader-viewport" className="w-full min-h-[260px] overflow-hidden rounded-xl border bg-black flex items-center justify-center"></div>
                <Button onClick={stopCameraScanner} variant="outline" className="w-full">
                  Tắt Camera
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Copy QR Inspection Modal */}
      <Dialog open={viewCopyQrDialog} onOpenChange={setViewCopyQrDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-base">
              <QrCode className="h-5 w-5 text-primary" /> Tem QR Định Danh Bản Sao
            </DialogTitle>
            <DialogDescription className="text-xs truncate">
              {selectedCopyQr?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center p-4 bg-muted/20 rounded-xl border space-y-3">
            <div className="bg-white p-3 rounded-xl border shadow-sm">
              {selectedCopyQr?.qrCode && (
                <QRCodeCanvas 
                  id="inspect-copy-qr-canvas"
                  value={selectedCopyQr.qrCode} 
                  size={160} 
                  level={"H"}
                  includeMargin={true}
                />
              )}
            </div>
            <code className="px-2.5 py-1 bg-primary/10 text-primary rounded font-mono font-bold text-xs tracking-wide">
              {selectedCopyQr?.qrCode}
            </code>
            <p className="text-[11px] text-muted-foreground text-center">
              💡 Đây là tem mã QR định danh duy nhất cho cuốn sách vật lý này. Hãy đối chiếu với tem in dán trên gáy hoặc bìa sách.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <div id="hidden-qr-reader" className="hidden"></div>
      {ConfirmDialogComponent}
    </div>
  );
}
