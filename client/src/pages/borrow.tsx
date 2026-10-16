import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Camera, BookOpen, User, Clock, CheckCircle2, Scan, RefreshCw, 
  Upload, QrCode, AlertTriangle, ShieldCheck, ArrowRightLeft, 
  Search, CheckCircle, FileSpreadsheet, BookMarked,
  Download, Zap, CheckSquare, XCircle, UserCheck, Sparkles, X,
  Inbox, Layers, Filter, Check
} from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { QRCodeCanvas } from "qrcode.react";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/contexts/AuthContext";
import { VietQrModal } from "@/components/vietqr-modal";

interface Transaction {
  id: number;
  user_id?: number;
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
  fine_id?: number;
  fine_status?: string;
  fine_amount?: number;
  fine_already_paid?: boolean;
  fine_payment_method?: string | null;
  fine_payment_channel?: string | null;
  fine_paid_at?: string | null;
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
    phone?: string;
  };
  canBorrow?: boolean;
  borrowBlockReason?: string | null;
  monthlyBorrowCount?: number;
  activeBorrowCount?: number;
  overdueCount?: number;
  maxBooksAllowed?: number;
  maxBooks?: number;
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
    fine_already_paid?: boolean;
    fine_paid_amount?: number;
    fine_payment_method?: string | null;
    fine_payment_channel?: string | null;
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
  const [scannerMode, setScannerMode] = useState<"reader_card" | "return" | "direct_borrow" | "approve_book" | "return_verify" | "table_return_reader">("reader_card");
  const [simulatedQrCode, setSimulatedQrCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Modal 1: Yêu cầu quét mã để nhận trả sách (Xác thực thẻ độc giả trước khi sang Modal 2)
  const [tableReturnPromptOpen, setTableReturnPromptOpen] = useState(false);
  const [tableReturnRecord, setTableReturnRecord] = useState<Transaction | null>(null);
  const [tableReturnAuthInput, setTableReturnAuthInput] = useState("");
  const [tableReturnError, setTableReturnError] = useState<string | null>(null);
  const [isVerifyingTableReader, setIsVerifyingTableReader] = useState(false);
  const [tableFilter, setTableFilter] = useState<"all" | "borrowing" | "overdue" | "returned">("all");

  // Approve reservation modal state (Quét mã sách vật lý độc giả mang tới bàn)
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveResvTarget, setApproveResvTarget] = useState<{
    reservation_id: number;
    book_id: number;
    book_title: string;
    cover_image?: string;
    isbn?: string;
  } | null>(null);
  const [approveBookQr, setApproveBookQr] = useState("");
  const [approveCheckedCopy, setApproveCheckedCopy] = useState<any>(null);
  const [approveCheckError, setApproveCheckError] = useState<string | null>(null);
  const [isCheckingCopy, setIsCheckingCopy] = useState(false);
  const [isApproveSubmitting, setIsApproveSubmitting] = useState(false);

  // Return verification modal state (Đối soát mã QR sách độc giả mang tới trả)
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnTargetLoan, setReturnTargetLoan] = useState<{
    id: number;
    book_copy_id?: number;
    qr_code: string;
    book_title: string;
    borrow_date: string;
    due_date: string;
    cover_image?: string;
    overdue_days?: number;
    fine_amount?: number;
    fine_already_paid?: boolean;
    fine_paid_amount?: number;
    fine_payment_method?: string | null;
    fine_payment_channel?: string | null;
    reader_name?: string;
    card_number?: string;
  } | null>(null);
  const [returnScannedQr, setReturnScannedQr] = useState("");
  const [returnCheckedCopy, setReturnCheckedCopy] = useState<any>(null);
  const [returnCheckError, setReturnCheckError] = useState<string | null>(null);
  const [returnMatchState, setReturnMatchState] = useState<'none' | 'exact' | 'other_borrowed' | 'mismatch'>('none');
  const [matchedOtherLoan, setMatchedOtherLoan] = useState<any>(null);
  const [isCheckingReturnCopy, setIsCheckingReturnCopy] = useState(false);
  const [isReturnSubmitting, setIsReturnSubmitting] = useState(false);

  // VietQR Fine Payment Modal State
  const [vietQrFineModalOpen, setVietQrFineModalOpen] = useState(false);
  const [vietQrPaymentInfo, setVietQrPaymentInfo] = useState<{
    amount: number;
    readerName?: string;
    cardNumber?: string;
    bookTitle?: string;
    bookCopyQr?: string;
    overdueDays?: number;
    transferNote: string;
    borrowRecordId?: number;
    copyQr?: string;
    fineId?: number;
  } | null>(null);
  const [isFinePaying, setIsFinePaying] = useState(false);

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

    // 1. If in table return reader verification mode (scanning reader card from table return prompt Modal 1)
    if (scannerMode === "table_return_reader") {
      setTableReturnAuthInput(code);
      await handleVerifyTableReturnReader(code);
      return;
    }

    // 2. If in return verify scanner mode (scanning book copy that reader brought to desk to return)
    if (scannerMode === "return_verify") {
      setReturnScannedQr(code);
      if (returnTargetLoan) {
        verifyReturnBookCopy(code, returnTargetLoan);
      }
      return;
    }

    // 3. If in direct borrow scanner mode (scanning book to borrow for current reader)
    if (scannerMode === "direct_borrow") {
      setDirectBookQr(code);
      handleDirectBorrow(undefined, code);
      return;
    }

    // 4. If in approve book mode (scanning book copy that reader brought to desk)
    if (scannerMode === "approve_book") {
      setApproveBookQr(code);
      if (approveResvTarget) {
        verifyApproveBookCopy(code, approveResvTarget);
      }
      return;
    }

    // 5. If in return scanner mode
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

    // 6. If scanned code is a Reader Card QR (LIB-RD-..., LIB-AD-..., LIB-LB-..., USER-..., UID-...)
    const isReaderCard = /^(?:LIB-RD-|LIB-AD-|LIB-LB-|LIB-OW-|RD-|USER-|UID-)/i.test(code);
    if (isReaderCard) {
      setSearchReaderInput(code);
      setReturnBookQr("");
      await loadReaderCheckoutInfo(code);
      return;
    }

    // Default: Scanned Reader Card QR or Ticket QR or Book QR
    setSearchReaderInput(code);
    loadReaderCheckoutInfo(code);
  };

  // Librarian: Đối soát trực tiếp mã QR bản sao sách với yêu cầu đăng ký
  const verifyApproveBookCopy = async (qrCodeStr: string, customTarget?: any) => {
    const target = customTarget || approveResvTarget;
    const cleanQr = (qrCodeStr || '').trim();
    if (!cleanQr || !target) {
      setApproveCheckedCopy(null);
      setApproveCheckError(null);
      return null;
    }

    setIsCheckingCopy(true);
    setApproveCheckError(null);
    try {
      const res = await api.get(`/borrow/check-copy/${encodeURIComponent(cleanQr)}`);
      const copy = res.data;

      // 1. Kiểm tra cuốn sách quét được có đúng thuộc đầu sách đã đăng ký không
      if (copy.book_id !== target.book_id) {
        const errorMsg = `MÃ SÁCH KHÔNG KHỚP: Cuốn sách bạn vừa quét là «${copy.book_title}» (Mã: ${copy.qr_code}), KHÔNG PHẢI cuốn «${target.book_title}» mà độc giả đã đăng ký!`;
        setApproveCheckError(errorMsg);
        setApproveCheckedCopy(null);
        toast.error(`❌ CẢNH BÁO SAI SÁCH: Quét được «${copy.book_title}», không khớp với «${target.book_title}»!`);
        return null;
      }

      // 2. Kiểm tra trạng thái bản sao
      if (copy.status !== 'available') {
        const errorMsg = `Bản sao sách [${copy.qr_code}] hiện không ở trạng thái sẵn sàng (Trạng thái: ${copy.status}). Vui lòng chọn bản sao khác sẵn có trong kho!`;
        setApproveCheckError(errorMsg);
        setApproveCheckedCopy(null);
        toast.error(errorMsg);
        return null;
      }

      // 3. Khớp chính xác 100%
      setApproveCheckedCopy(copy);
      setApproveCheckError(null);
      toast.success(`✅ ĐÃ ĐỐI SOÁT KHỚP ĐÚNG SÁCH: ${copy.qr_code} («${copy.book_title}»)`);
      return copy;
    } catch (err: any) {
      const msg = err.response?.data?.message || `Mã QR [${cleanQr}] không tồn tại trong hệ thống thư viện!`;
      setApproveCheckError(msg);
      setApproveCheckedCopy(null);
      toast.error(`❌ ${msg}`);
      return null;
    } finally {
      setIsCheckingCopy(false);
    }
  };

  // Librarian: Mở Modal Quét mã sách vật lý độc giả mang tới bàn để duyệt trao sách
  const handleOpenApproveModal = (req: any) => {
    setApproveResvTarget(req);
    setApproveBookQr("");
    setApproveCheckedCopy(null);
    setApproveCheckError(null);
    setApproveModalOpen(true);
  };

  // Librarian: Submit duyệt & trao sách kèm mã QR bản sao vật lý
  const handleApproveSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!approveResvTarget) return;
    const cleanQr = approveBookQr.trim();
    if (!cleanQr) {
      toast.error("Vui lòng quét hoặc nhập mã QR trên cuốn sách vật lý mà độc giả mang tới bàn!");
      return;
    }

    // Nếu chưa được verify hoặc đang có lỗi, verify ngay
    let verifiedCopy = approveCheckedCopy;
    if (!verifiedCopy || verifiedCopy.qr_code !== cleanQr) {
      verifiedCopy = await verifyApproveBookCopy(cleanQr, approveResvTarget);
      if (!verifiedCopy) {
        return; // Đã báo lỗi trong hàm verify
      }
    }

    setIsApproveSubmitting(true);
    try {
      const res = await api.post("/borrow/approve-reservation", {
        reservationId: approveResvTarget.reservation_id,
        bookCopyQr: cleanQr
      });
      toast.success(res.data.message || "Đã đối soát khớp và trao sách thành công!");
      setApproveModalOpen(false);
      setApproveBookQr("");
      setApproveCheckedCopy(null);
      setApproveCheckError(null);
      setApproveResvTarget(null);

      // Reload reader info
      if (scannedReaderInfo?.reader.card_number) {
        loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
      } else if (scannedReaderInfo?.reader.id) {
        loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
      }
      fetchHistory();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Lỗi khi duyệt mượn sách");
    } finally {
      setIsApproveSubmitting(false);
    }
  };

  // Librarian: Mở Modal Đối Soát & Nhận Trả Sách Vào Kho
  const handleOpenReturnModal = (loan: any) => {
    setReturnTargetLoan(loan);
    setReturnScannedQr("");
    setReturnCheckedCopy(null);
    setReturnCheckError(null);
    setReturnMatchState('none');
    setMatchedOtherLoan(null);
    setReturnModalOpen(true);
  };

  // Librarian: Đối soát trực tiếp mã QR sách trả
  const verifyReturnBookCopy = async (qrCodeStr: string, customTarget?: any) => {
    const target = customTarget || returnTargetLoan;
    const cleanQr = (qrCodeStr || '').trim();
    if (!cleanQr || !target) {
      setReturnCheckedCopy(null);
      setReturnCheckError(null);
      setReturnMatchState('none');
      setMatchedOtherLoan(null);
      return null;
    }

    setIsCheckingReturnCopy(true);
    setReturnCheckError(null);
    try {
      const res = await api.get(`/borrow/check-copy/${encodeURIComponent(cleanQr)}`);
      const copy = res.data;
      setReturnCheckedCopy(copy);

      // 1. Khớp chính xác bản sao của cuốn đang chọn trả
      if (copy.qr_code.toLowerCase() === target.qr_code.toLowerCase()) {
        setReturnMatchState('exact');
        setMatchedOtherLoan(null);
        setReturnCheckError(null);
        toast.success(`✅ Khớp chính xác bản sao [${copy.qr_code}] của cuốn «${copy.book_title}»!`);
        return { match: 'exact', copy, target };
      }

      // 2. Mã sách khác cuốn đang chọn, nhưng độc giả này CŨNG ĐANG MƯỢN cuốn vừa quét
      const otherBorrowed = scannedReaderInfo?.activeBorrows?.find(
        (b) => b.qr_code.toLowerCase() === copy.qr_code.toLowerCase()
      );
      if (otherBorrowed) {
        setReturnMatchState('other_borrowed');
        setMatchedOtherLoan(otherBorrowed);
        const warnMsg = `Độc giả đang chọn trả «${target.book_title}» (${target.qr_code}), nhưng lại đưa cuốn «${otherBorrowed.book_title}» (${otherBorrowed.qr_code}).`;
        setReturnCheckError(warnMsg);
        toast.warning(`⚠️ Bạn vừa quét cuốn «${otherBorrowed.book_title}» (Độc giả cũng đang mượn cuốn này).`);
        return { match: 'other_borrowed', copy, otherBorrowed };
      }

      // 3. Sách không nằm trong danh sách mượn của độc giả này
      setReturnMatchState('mismatch');
      setMatchedOtherLoan(null);
      let reason = `Cuốn sách «${copy.book_title}» (${copy.qr_code}) KHÔNG THUỘC danh sách đang mượn của độc giả ${scannedReaderInfo?.reader?.full_name || 'này'}!`;
      if (copy.borrower_name) {
        reason += ` (Hiện đang do độc giả khác là "${copy.borrower_name}" - Thẻ: ${copy.borrower_card_number} mượn).`;
      } else if (copy.status === 'available') {
        reason += ` (Cuốn sách này hiện đang có sẵn trên kệ thư viện, không có ai đang mượn).`;
      }
      setReturnCheckError(reason);
      toast.error(`❌ CẢNH BÁO: Cuốn sách vừa quét không thuộc danh sách mượn của độc giả!`);
      return null;
    } catch (err: any) {
      const msg = err.response?.data?.message || `Mã QR [${cleanQr}] không tồn tại trong hệ thống thư viện!`;
      setReturnCheckError(msg);
      setReturnCheckedCopy(null);
      setReturnMatchState('mismatch');
      setMatchedOtherLoan(null);
      toast.error(`❌ ${msg}`);
      return null;
    } finally {
      setIsCheckingReturnCopy(false);
    }
  };

  // Librarian: Chuyển sang nhận trả cuốn sách khác mà độc giả cũng đang mượn
  const handleSwitchReturnTarget = (newLoan: any) => {
    setReturnTargetLoan(newLoan);
    setReturnScannedQr(newLoan.qr_code);
    setReturnMatchState('exact');
    setReturnCheckError(null);
    setMatchedOtherLoan(null);
    toast.success(`Đã chuyển sang nhận trả cuốn «${newLoan.book_title}» (${newLoan.qr_code})`);
  };

  // Librarian: Submit nhận trả từ modal đối soát
  const handleReturnModalSubmit = async (
    e?: React.FormEvent, 
    confirmPaidFine: boolean = false,
    paymentMethod?: "transfer" | "cash"
  ) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!returnTargetLoan || !returnScannedQr.trim()) return;
    const targetQr = returnScannedQr.trim();

    const overdueDays = returnTargetLoan.overdue_days || 0;
    const fineAmount = returnTargetLoan.fine_amount || (overdueDays * 5000);
    const hasAlreadyPaid = Boolean(returnTargetLoan.fine_already_paid);

    // If overdue and NOT yet paid and NOT yet confirmed:
    if (overdueDays > 0 && !hasAlreadyPaid && !confirmPaidFine) {
      const cardNum = returnTargetLoan.card_number || scannedReaderInfo?.reader.card_number || 'RD';
      const copyCode = returnTargetLoan.qr_code || targetQr;
      setVietQrPaymentInfo({
        amount: fineAmount,
        readerName: returnTargetLoan.reader_name || scannedReaderInfo?.reader.full_name,
        cardNumber: cardNum,
        bookTitle: returnTargetLoan.book_title,
        bookCopyQr: copyCode,
        overdueDays: overdueDays,
        transferNote: `PHAT ${cardNum} ${copyCode}`,
        borrowRecordId: returnTargetLoan.id,
        copyQr: targetQr
      });
      setVietQrFineModalOpen(true);
      return;
    }

    setIsReturnSubmitting(true);
    try {
      const finalMethod = paymentMethod || (hasAlreadyPaid ? (returnTargetLoan.fine_payment_method as any) : 'cash');
      const response = await api.post("/borrow/return", {
        bookQrCode: targetQr,
        readerCardNumber: returnTargetLoan.card_number,
        borrowRecordId: returnTargetLoan.id,
        confirmPaidFine: hasAlreadyPaid || confirmPaidFine,
        paymentMethod: finalMethod,
        paymentChannel: 'counter'
      });

      const resData = response.data?.data;
      if (resData?.finePaid && resData?.fineAmount > 0) {
        const methodTxt = resData.paymentMethod === 'transfer' ? 'Chuyển khoản VietQR' : 'Tiền mặt';
        toast.success(`Đã thu phí phạt ${resData.fineAmount.toLocaleString('vi-VN')}đ (${methodTxt}) và nhận trả sách thành công!`);
      } else {
        toast.success(response.data?.message || "Đã nhận trả sách thành công vào kho!");
      }

      setReturnModalOpen(false);
      setReturnTargetLoan(null);
      setReturnScannedQr("");
      setReturnCheckedCopy(null);
      setReturnCheckError(null);
      setReturnMatchState('none');
      setMatchedOtherLoan(null);
      setVietQrFineModalOpen(false);
      setVietQrPaymentInfo(null);

      if (scannedReaderInfo?.reader.card_number) {
        loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
      } else if (scannedReaderInfo?.reader.id) {
        loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
      }
      fetchHistory();
    } catch (error: any) {
      const errData = error.response?.data;
      if (errData?.requiresFinePayment) {
        const cardNum = errData.cardNumber || scannedReaderInfo?.reader.card_number || 'RD';
        const copyCode = errData.copyQr || returnTargetLoan.qr_code || targetQr;
        setVietQrPaymentInfo({
          amount: errData.fineAmount,
          readerName: errData.readerName,
          cardNumber: cardNum,
          bookTitle: errData.bookTitle,
          bookCopyQr: copyCode,
          overdueDays: errData.overdueDays,
          transferNote: `PHAT ${cardNum} ${copyCode}`,
          borrowRecordId: errData.borrowRecordId || returnTargetLoan.id,
          copyQr: targetQr
        });
        setVietQrFineModalOpen(true);
      } else {
        toast.error(errData?.message || "Không thể thực hiện trả sách");
      }
    } finally {
      setIsReturnSubmitting(false);
    }
  };

  const handleConfirmVietQrFine = async (method: "transfer" | "cash") => {
    setIsFinePaying(true);
    try {
      if (user?.role === "reader") {
        let fineId = vietQrPaymentInfo?.fineId;
        if (!fineId && vietQrPaymentInfo?.borrowRecordId) {
          const fRes = await api.get("/fines");
          const match = fRes.data.find((f: any) => f.borrow_record_id === vietQrPaymentInfo.borrowRecordId && f.status === 'unpaid');
          if (match) fineId = match.id;
        }

        if (fineId) {
          await api.put(`/fines/${fineId}/pay`, {
            payment_method: 'transfer',
            payment_channel: 'online',
            transaction_ref: vietQrPaymentInfo?.transferNote || `VIETQR-ONLINE-${Date.now()}`
          });
          toast.success("Xác nhận thanh toán VietQR thành công! Khoản phạt đã được thanh toán.");
          setVietQrFineModalOpen(false);
          setVietQrPaymentInfo(null);
          await fetchHistory();
          await fetchUserProfile();
        } else {
          toast.error("Không tìm thấy thông tin hóa đơn phạt tương ứng để thanh toán");
        }
      } else {
        await handleReturnModalSubmit(undefined, true, method);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Lỗi khi xử lý thanh toán");
    } finally {
      setIsFinePaying(false);
    }
  };

  const handleReaderPayFine = (loan: Transaction) => {
    const dueStatus = getDueStatus(loan.due_date);
    const overdueDays = Math.max(1, Math.abs(dueStatus.diffDays || 1));
    const amount = Number(loan.fine_amount) || (overdueDays * 5000);
    const cardNum = readerCardNumber || 'RD';
    const copyCode = loan.qr_code || '';

    setVietQrPaymentInfo({
      amount: amount,
      readerName: readerName,
      cardNumber: cardNum,
      bookTitle: loan.book_title,
      bookCopyQr: copyCode,
      overdueDays: overdueDays,
      transferNote: `PHAT ${cardNum} ${copyCode}`,
      borrowRecordId: loan.id,
      fineId: loan.fine_id,
      copyQr: loan.qr_code
    });
    setVietQrFineModalOpen(true);
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

  // Librarian: Khi bấm "Nhận trả" từ bảng Sổ Lưu Thông Chi Tiết -> Mở Hộp Thoại Yêu Cầu Quét Thẻ Độc GiẢ (Modal 1)
  const handleTableReturnPrompt = (record: Transaction) => {
    setTableReturnRecord(record);
    setTableReturnAuthInput("");
    setTableReturnError(null);
    setTableReturnPromptOpen(true);
  };

  // Librarian: Xác thực mã thẻ độc giả từ Modal 1 -> Chỉ chấp nhận đúng độc giả đã mượn cuốn sách đó
  const handleVerifyTableReturnReader = async (inputCode?: string) => {
    const rawCode = (inputCode || tableReturnAuthInput).trim();
    if (!rawCode) {
      toast.error("Vui lòng quét hoặc nhập mã thẻ độc giả");
      return;
    }
    if (!tableReturnRecord) {
      toast.error("Không tìm thấy thông tin phiếu mượn cần nhận trả");
      return;
    }

    // Chặn nếu quét nhầm mã sách vào bước quét thẻ độc giả
    if (/^(?:QR-BK-|BK-|BOOK-)/i.test(rawCode)) {
      const err = `[${rawCode}] là mã sách. Bước 1 yêu cầu quét MÃ THẺ ĐỘC GIẢ của «${tableReturnRecord.reader_name}» (${tableReturnRecord.card_number})!`;
      setTableReturnError(err);
      toast.error(`❌ ${err}`);
      setTableReturnPromptOpen(true);
      return;
    }

    setIsVerifyingTableReader(true);
    setTableReturnError(null);
    try {
      // Tra cứu thông tin thẻ độc giả
      const res = await api.get(`/borrow/reader-checkout-info/${encodeURIComponent(rawCode)}`);
      if (res.data.type === 'reader') {
        const scannedUser = res.data.reader;
        const scannedCard = (scannedUser.card_number || '').trim().toLowerCase();
        const targetCard = (tableReturnRecord.card_number || '').trim().toLowerCase();
        const scannedName = (scannedUser.full_name || '').trim().toLowerCase();
        const targetName = (tableReturnRecord.reader_name || '').trim().toLowerCase();

        // Chuẩn hóa số/ID để so sánh chính xác
        const cleanDigits = (s?: string | number) => String(s || '').replace(/\D/g, '');
        const scannedDigits = cleanDigits(scannedCard) || String(scannedUser.id || '');
        const targetDigits = cleanDigits(targetCard) || String(tableReturnRecord.user_id || '');
        const inputDigits = cleanDigits(rawCode);

        // So khớp bắt buộc đúng độc giả đang mượn cuốn sách này
        const isMatched = 
          (scannedCard && targetCard && scannedCard === targetCard) ||
          (scannedUser.id && tableReturnRecord.user_id && Number(scannedUser.id) === Number(tableReturnRecord.user_id)) ||
          (scannedDigits && targetDigits && scannedDigits === targetDigits) ||
          (inputDigits && targetDigits && inputDigits === targetDigits) ||
          (scannedName && targetName && scannedName === targetName);

        if (!isMatched) {
          const errorMsg = `Mã thẻ vừa quét/nhập là của độc giả "${scannedUser.full_name}" (${scannedUser.card_number || rawCode}), KHÔNG PHẢI độc giả "${tableReturnRecord.reader_name}" (${tableReturnRecord.card_number}) đã mượn cuốn «${tableReturnRecord.book_title}»!`;
          setTableReturnError(errorMsg);
          toast.error(`❌ SAI ĐỘC GIẢ: ${errorMsg}`);
          setTableReturnPromptOpen(true);
          return;
        }

        // Khớp chính xác độc giả!
        setScannedReaderInfo(res.data);
        setSearchReaderInput(res.data.reader.card_number || rawCode);
        setTableReturnError(null);
        toast.success(`✅ Đã xác thực đúng độc giả: ${res.data.reader.full_name}! Đang chuyển sang bước đối soát sách...`);
        
        // Đóng Modal 1 & Tự động mở Modal 2 để quét mã sách trả
        setTableReturnPromptOpen(false);
        const currentLoan = { ...tableReturnRecord };
        setTimeout(() => {
          handleOpenReturnModal({
            id: currentLoan.id,
            qr_code: currentLoan.qr_code,
            book_title: currentLoan.book_title,
            borrow_date: currentLoan.borrow_date,
            due_date: currentLoan.due_date,
            cover_image: currentLoan.cover_image,
            reader_name: currentLoan.reader_name,
            card_number: currentLoan.card_number
          });
        }, 150);
      } else {
        const err = `Mã [${rawCode}] không phải là mã thẻ độc giả hợp lệ`;
        setTableReturnError(err);
        toast.error(err);
        setTableReturnPromptOpen(true);
      }
    } catch (err: any) {
      const errText = err.response?.data?.message || "Không thể xác thực mã thẻ độc giả này";
      setTableReturnError(errText);
      toast.error(errText);
      setTableReturnPromptOpen(true);
    } finally {
      setIsVerifyingTableReader(false);
    }
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
  const openScannerModal = (mode: "reader_card" | "return" | "direct_borrow" | "approve_book" | "return_verify" | "table_return_reader") => {
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
      return { text: `Quá hạn ${Math.abs(diffDays)} ngày`, variant: "destructive" as const, isOverdue: true, diffDays: Math.abs(diffDays) };
    } else if (diffDays === 0) {
      return { text: "Hôm nay là hạn chót!", variant: "secondary" as const, isOverdue: false, diffDays: 0 };
    }
    return { text: `Còn ${diffDays} ngày`, variant: "outline" as const, isOverdue: false, diffDays };
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
          activeLoans.filter(l => getDueStatus(l.due_date).isOverdue).every(l => l.fine_already_paid) ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 animate-pulse" />
                <div>
                  <p className="font-bold">Bạn đã nộp phạt trực tuyến đầy đủ cho toàn bộ sách trễ hạn!</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Hệ thống đã ghi nhận thanh toán. Vui lòng mang sách đến quầy để Thủ thư quét nhận trả sách vào kho.
                  </p>
                </div>
              </div>
              <Badge className="bg-emerald-600 text-white shrink-0 w-fit">Đã nộp phạt online</Badge>
            </div>
          ) : (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-destructive">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-destructive animate-pulse" />
                <div>
                  <p className="font-bold">Lưu ý: Bạn có sách đang mượn đã quá hạn trả!</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Bạn có thể nộp phạt trực tuyến ngay qua mã VietQR bên dưới hoặc đóng trực tiếp tại quầy khi trả sách.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button 
                  size="sm" 
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 h-8 shadow-xs"
                  onClick={() => {
                    const unpaidLoan = activeLoans.find(l => getDueStatus(l.due_date).isOverdue && !l.fine_already_paid);
                    if (unpaidLoan) handleReaderPayFine(unpaidLoan);
                  }}
                >
                  <QrCode className="h-3.5 w-3.5" /> Nộp phạt VietQR ngay
                </Button>
              </div>
            </div>
          )
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
                              {isOverdue && loan.fine_already_paid && (
                                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px] gap-1 py-1 px-2.5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Đã nộp phạt online
                                </Badge>
                              )}
                              {isOverdue && !loan.fine_already_paid && (
                                <Button 
                                  size="sm" 
                                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs h-7 gap-1.5 shadow-xs"
                                  onClick={() => handleReaderPayFine(loan)}
                                >
                                  <QrCode className="h-3 w-3" /> Nộp phạt VietQR ({(loan.fine_amount || (getDueStatus(loan.due_date).diffDays || 1) * 5000).toLocaleString('vi-VN')}đ)
                                </Button>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              Chủ thẻ: <strong className="text-foreground">{readerName}</strong> ({readerCardNumber})
                            </span>
                            {isOverdue && loan.fine_already_paid && (
                              <span className="text-[10px] text-emerald-600 font-medium">
                                ✓ Đã thanh toán trực tuyến • Hãy mang sách tới quầy để hoàn tất trả
                              </span>
                            )}
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

        {/* VietQR Fine Modal for Reader */}
        {vietQrPaymentInfo && (
          <VietQrModal
            open={vietQrFineModalOpen}
            onOpenChange={setVietQrFineModalOpen}
            amount={vietQrPaymentInfo.amount}
            readerName={vietQrPaymentInfo.readerName}
            cardNumber={vietQrPaymentInfo.cardNumber}
            bookTitle={vietQrPaymentInfo.bookTitle}
            bookCopyQr={vietQrPaymentInfo.bookCopyQr}
            overdueDays={vietQrPaymentInfo.overdueDays}
            transferNote={vietQrPaymentInfo.transferNote}
            allowCashOption={false}
            onConfirmPayment={handleConfirmVietQrFine}
            isSubmitting={isFinePaying}
          />
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: THỦ THƯ & ADMIN - QUẦY GIAO DỊCH LƯU THÔNG THÔNG MINH (QR HUB)
  // =========================================================================
  const activeLoansCount = history.filter(h => h.status === 'borrowing').length;
  const overdueLoansCount = history.filter(h => h.status === 'borrowing' && getDueStatus(h.due_date).isOverdue).length;
  const returnedLoansCount = history.filter(h => h.status === 'returned').length;

  const filteredHistory = history.filter((record) => {
    // 1. Tab filter
    if (tableFilter === "borrowing" && record.status !== "borrowing") return false;
    if (tableFilter === "returned" && record.status !== "returned") return false;
    if (tableFilter === "overdue") {
      if (record.status !== "borrowing") return false;
      const dueStatus = getDueStatus(record.due_date);
      if (!dueStatus.isOverdue) return false;
    }

    // 2. Search term
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      record.book_title?.toLowerCase().includes(term) ||
      record.reader_name?.toLowerCase().includes(term) ||
      record.card_number?.toLowerCase().includes(term) ||
      record.qr_code?.toLowerCase().includes(term) ||
      String(record.id).includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* 1. Tiêu đề trang & Thanh công cụ chuẩn Athenaeum */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-[11px] font-semibold">
              <Sparkles className="h-3 w-3 mr-1 text-primary" /> Nghiệp Vụ Lưu Thông
            </Badge>
            <span className="text-xs text-muted-foreground">• Thủ thư & Quản trị viên</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <ArrowRightLeft className="h-7 w-7 text-primary" /> Mượn / Trả Sách (QR)
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Quầy giao dịch lưu thông tự động qua mã thẻ độc giả và mã định danh sách vật lý.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchHistory}
            className="h-9 text-xs gap-1.5 shadow-2xs hover:bg-primary/5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Đồng bộ
          </Button>

          <Button
            size="sm"
            onClick={() => openScannerModal("return")}
            className="h-9 text-xs gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
          >
            <Scan className="h-3.5 w-3.5" /> Quét Trả Sách Vào Kho
          </Button>
        </div>
      </div>

      {/* 2. Thẻ chỉ số thống kê chuẩn hệ thống Athenaeum (4-Card Grid) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Tổng lượt mượn", value: history.length.toString(), icon: ArrowRightLeft, sub: "Tất cả giao dịch ghi nhận" },
          { label: "Đang lưu thông", value: activeLoansCount.toString(), icon: BookMarked, sub: "Sách độc giả đang giữ" },
          { label: "Quá hạn cần thu hồi", value: overdueLoansCount.toString(), icon: AlertTriangle, sub: "Cần nhắc nhở & tính phạt", danger: overdueLoansCount > 0 },
          { label: "Đã hoàn trả vào kho", value: returnedLoansCount.toString(), icon: CheckCircle2, sub: "Đã kiểm đếm an toàn" },
        ].map((s, idx) => (
          <Card key={idx} className="relative overflow-hidden border shadow-xs">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{s.label}</span>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${s.danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
              <p className={`mt-2 font-display text-3xl font-semibold tracking-tight ${s.danger ? 'text-destructive' : 'text-foreground'}`}>{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 3. Quầy Tiếp Nhận & Quét Thẻ Độc Giả (Circulation Desk Terminal) */}
      <Card className="border shadow-xs">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="font-display text-base font-bold flex items-center gap-2">
                <QrCode className="h-4.5 w-4.5 text-primary" /> Quầy Tiếp Nhận Bạn Đọc
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Nhập hoặc quét mã thẻ bạn đọc để mở phiên làm việc, duyệt mượn và đối soát nhận trả
              </CardDescription>
            </div>
            {scannedReaderInfo && (
              <Badge variant="outline" className="text-xs text-emerald-700 bg-emerald-500/10 border-emerald-500/30 gap-1 self-start sm:self-auto font-semibold">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Phiên đang mở: {scannedReaderInfo.reader.full_name}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Nhập hoặc dùng súng quét mã thẻ bạn đọc (VD: LIB-RD-000005)..."
                value={searchReaderInput}
                onChange={(e) => setSearchReaderInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (searchReaderInput.trim()) {
                      loadReaderCheckoutInfo(searchReaderInput);
                    }
                  }
                }}
                className="pl-9 h-10 font-mono text-xs bg-background focus-visible:ring-primary shadow-2xs"
              />
            </div>

            <Button
              onClick={() => {
                if (searchReaderInput.trim()) {
                  loadReaderCheckoutInfo(searchReaderInput);
                } else {
                  toast.info("Vui lòng quét hoặc nhập mã thẻ độc giả");
                }
              }}
              size="sm"
              className="h-10 px-4 text-xs font-semibold gap-1.5 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
            >
              <Search className="h-3.5 w-3.5" /> Tra cứu thẻ
            </Button>

            <Button
              onClick={() => openScannerModal("reader_card")}
              size="sm"
              variant="outline"
              className="h-10 px-4 text-xs font-semibold gap-1.5 shrink-0 border-primary/30 text-primary hover:bg-primary/10 shadow-2xs"
            >
              <Camera className="h-3.5 w-3.5" /> Camera Quét Thẻ
            </Button>

            {scannedReaderInfo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setScannedReaderInfo(null);
                  setSearchReaderInput("");
                  setDirectBookQr("");
                  toast.info("Đã hoàn tất phiên làm việc của độc giả.");
                }}
                className="h-10 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 shrink-0"
              >
                <X className="h-3.5 w-3.5" /> Đóng phiên
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. Không gian làm việc: Trạng thái chờ hoặc Thẻ bạn đọc */}
      {!scannedReaderInfo ? null : (
        /* ACTIVE READER HUB: Professional Reader Identity & Split Operations */
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Reader Profile Header Card */}
          <Card className="border-primary/30 shadow-sm bg-gradient-to-r from-primary/10 via-card to-primary/5 overflow-hidden">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <Avatar className="h-14 w-14 border-2 border-primary/20 shadow-xs">
                    <AvatarFallback className="bg-primary text-primary-foreground font-display font-bold text-lg">
                      {scannedReaderInfo.reader.full_name?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-foreground">
                        {scannedReaderInfo.reader.full_name}
                      </h2>
                      {scannedReaderInfo.canBorrow === false ? (
                        <Badge variant="destructive" className="text-[11px] font-semibold gap-1">
                          ⛔ Tạm khóa mượn sách
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-emerald-700 bg-emerald-500/10 border-emerald-500/30 text-[11px] font-semibold gap-1">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Đủ điều kiện mượn sách
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1 font-mono">
                      <span>Mã thẻ: <strong className="text-primary font-bold">{scannedReaderInfo.reader.card_number}</strong></span>
                      {scannedReaderInfo.reader.phone && <span>• SĐT: {scannedReaderInfo.reader.phone}</span>}
                      <span>• Email: {scannedReaderInfo.reader.email}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start md:self-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => {
                      setSelectedCopyQr({
                        title: `Thẻ Thư Viện: ${scannedReaderInfo.reader.full_name}`,
                        qrCode: scannedReaderInfo.reader.card_number || `LIB-RD-${scannedReaderInfo.reader.id}`,
                        readerName: scannedReaderInfo.reader.full_name
                      });
                      setViewCopyQrDialog(true);
                    }}
                  >
                    <QrCode className="h-3.5 w-3.5" /> Xem Mã QR Thẻ
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
                    onClick={() => {
                      setScannedReaderInfo(null);
                      setSearchReaderInput("");
                      setDirectBookQr("");
                    }}
                  >
                    <X className="h-3.5 w-3.5" /> Đóng phiên
                  </Button>
                </div>
              </div>

              {/* 4 Chỉ số chính sách mượn */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-primary/10">
                <div className="p-3 bg-card/90 rounded-xl border shadow-2xs space-y-1">
                  <span className="text-[11px] text-muted-foreground block font-medium">📚 Sách đang giữ</span>
                  <div className="flex items-baseline justify-between">
                    <strong className="text-sm font-bold text-foreground">
                      {scannedReaderInfo.activeBorrowCount ?? scannedReaderInfo.activeBorrows.length} / {scannedReaderInfo.maxBooks || 5} cuốn
                    </strong>
                    <span className="text-[10px] text-muted-foreground">Tối đa {scannedReaderInfo.maxBooks || 5}</span>
                  </div>
                  <Progress 
                    value={((scannedReaderInfo.activeBorrowCount ?? scannedReaderInfo.activeBorrows.length) / (scannedReaderInfo.maxBooks || 5)) * 100} 
                    className="h-1.5 bg-muted"
                  />
                </div>

                <div className="p-3 bg-card/90 rounded-xl border shadow-2xs space-y-1">
                  <span className="text-[11px] text-muted-foreground block font-medium">📊 Lượt mượn tháng này</span>
                  <strong className="text-sm font-bold text-primary block">
                    {scannedReaderInfo.monthlyBorrowCount ?? 0} lượt mượn
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">Đã tích lũy trong tháng</span>
                </div>

                <div className="p-3 bg-card/90 rounded-xl border shadow-2xs space-y-1">
                  <span className="text-[11px] text-muted-foreground block font-medium">⚠️ Sách quá hạn</span>
                  <strong className={`text-sm font-bold block ${(scannedReaderInfo.overdueCount || 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {scannedReaderInfo.overdueCount ?? 0} cuốn
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">
                    {(scannedReaderInfo.overdueCount || 0) > 0 ? "Cần thu hồi / phạt" : "Không có quá hạn"}
                  </span>
                </div>

                <div className="p-3 bg-card/90 rounded-xl border shadow-2xs space-y-1">
                  <span className="text-[11px] text-muted-foreground block font-medium">💰 Nợ phí phạt</span>
                  <strong className={`text-sm font-bold block ${(scannedReaderInfo.totalUnpaidFines || 0) > 0 ? "text-destructive" : "text-foreground"}`}>
                    {(scannedReaderInfo.totalUnpaidFines || 0).toLocaleString('vi-VN')}đ
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">
                    {(scannedReaderInfo.totalUnpaidFines || 0) > 0 ? "Cần nộp trước khi mượn" : "Không có nợ phạt"}
                  </span>
                </div>
              </div>

              {/* Thông báo lý do nếu bị khóa mượn sách */}
              {scannedReaderInfo.canBorrow === false && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-xs flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold text-destructive">Tài khoản tạm thời không được mượn thêm sách:</p>
                    <p className="text-muted-foreground leading-relaxed">
                      {scannedReaderInfo.borrowBlockReason || "Độc giả đang có sách quá hạn hoặc vượt quá số lượng mượn tối đa theo quy chế thư viện."}
                    </p>
                  </div>
                </div>
              )}

              {/* Cảnh báo nợ phạt cũ nếu có */}
              {scannedReaderInfo.totalUnpaidFines && scannedReaderInfo.totalUnpaidFines > 0 ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="font-semibold text-amber-800 dark:text-amber-400">
                      Độc giả còn nợ phạt chưa thanh toán: {scannedReaderInfo.totalUnpaidFines.toLocaleString('vi-VN')}đ
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 shrink-0">
                    Thu phạt tại quầy
                  </Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Hai Cột Nghiệp Vụ Cân Đối (Duyệt Mượn & Nhận Trả) */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* CỘT 1: DUYỆT MƯỢN & TRAO SÁCH (CHECKOUT) */}
            <div className="space-y-4">
              {/* Phân vùng 1.1: Sách đặt trước đã sẵn sàng nhận */}
              <Card className="border-amber-500/30 shadow-xs">
                <CardHeader className="pb-3 border-b bg-amber-500/5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <Inbox className="h-4 w-4 text-amber-600" /> Sách Đặt Trước Chờ Nhận
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 font-semibold">
                      {scannedReaderInfo.pendingRequests.length} yêu cầu
                    </Badge>
                  </div>
                  <CardDescription className="text-[11px]">
                    Sách độc giả đã đăng ký online trước khi đến quầy
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-4">
                  {scannedReaderInfo.pendingRequests.length === 0 ? (
                    <div className="text-center py-6 border border-dashed rounded-xl bg-muted/10 text-xs text-muted-foreground">
                      Độc giả không có cuốn sách đặt trước nào đang chờ nhận tại quầy.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {scannedReaderInfo.pendingRequests.map((req) => (
                        <div key={req.reservation_id} className="flex items-center justify-between p-3 rounded-xl border bg-card text-xs shadow-2xs gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                              {req.cover_image ? (
                                <img src={req.cover_image} alt={req.book_title} className="h-full w-full object-cover" />
                              ) : (
                                <BookOpen className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-xs text-foreground truncate">{req.book_title}</p>
                              <p className="text-muted-foreground text-[11px] mt-0.5">
                                Đặt: {new Date(req.reservation_date).toLocaleDateString("vi-VN")} • Tồn kho: <strong className="text-emerald-600">{req.available_copies} cuốn</strong>
                              </p>
                            </div>
                          </div>

                          <Button 
                            size="sm" 
                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shrink-0 shadow-xs disabled:opacity-50"
                            onClick={() => handleOpenApproveModal(req)}
                            disabled={req.available_copies <= 0 || scannedReaderInfo.canBorrow === false}
                            title={scannedReaderInfo.canBorrow === false ? (scannedReaderInfo.borrowBlockReason || "Độc giả không đủ điều kiện mượn") : undefined}
                          >
                            <CheckSquare className="h-3.5 w-3.5" /> Quét Sách & Trao
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Phân vùng 1.2: Cho mượn trực tiếp sách độc giả tự lấy từ kệ */}
              <Card className="border-primary/20 shadow-xs">
                <CardHeader className="pb-3 border-b bg-primary/5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-primary">
                      <Zap className="h-4 w-4 text-primary" /> Cho Mượn Trực Tiếp Tại Kệ
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                      Lấy thêm tại chỗ
                    </Badge>
                  </div>
                  <CardDescription className="text-[11px]">
                    Độc giả tự lấy cuốn sách trên kệ mang lại quầy để làm thủ tục mượn
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-4 space-y-3">
                  <form onSubmit={(e) => handleDirectBorrow(e)} className="flex gap-2">
                    <Input 
                      placeholder="Quét mã QR trên gáy sách (VD: QR-BK-1-1)..." 
                      value={directBookQr} 
                      onChange={(e) => setDirectBookQr(e.target.value)} 
                      className="text-xs h-9 bg-background font-mono focus-visible:ring-primary"
                      disabled={scannedReaderInfo.canBorrow === false}
                    />
                    <Button 
                      type="button" 
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                      onClick={() => openScannerModal("direct_borrow")}
                      disabled={scannedReaderInfo.canBorrow === false}
                    >
                      <Camera className="h-3.5 w-3.5" /> Quét
                    </Button>
                    <Button 
                      type="submit" 
                      size="sm" 
                      className="h-9 text-xs shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                      disabled={scannedReaderInfo.canBorrow === false}
                    >
                      Cho mượn
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* CỘT 2: SÁCH ĐỘC GIẢ ĐANG GIỮ & NHẬN TRẢ (RETURN & RENEW) */}
            <div>
              <Card className="border-emerald-600/30 shadow-xs h-full flex flex-col">
                <CardHeader className="pb-3 border-b bg-emerald-600/5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                      <BookMarked className="h-4 w-4 text-emerald-600" /> Sách Độc Giả Đang Giữ
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 font-semibold">
                      {scannedReaderInfo.activeBorrows.length} cuốn
                    </Badge>
                  </div>
                  <CardDescription className="text-[11px]">
                    Theo dõi hạn trả, gia hạn hoặc nhận trả từng cuốn vào kho
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-4 flex-1">
                  {scannedReaderInfo.activeBorrows.length === 0 ? (
                    <div className="text-center py-10 border border-dashed rounded-xl bg-muted/10 text-xs text-muted-foreground flex flex-col items-center justify-center h-full">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600/40 mb-2" />
                      <p className="font-semibold text-foreground">Độc giả hiện không giữ cuốn sách nào</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Tất cả sách mượn trước đây đều đã được hoàn trả vào kho.</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {scannedReaderInfo.activeBorrows.map((loan) => {
                        const dueStatus = getDueStatus(loan.due_date);
                        const isOverdue = dueStatus.isOverdue || (loan.overdue_days && loan.overdue_days > 0);
                        const fineAmount = loan.fine_amount || ((loan.overdue_days || 0) * 5000);
                        const hasRenewed = (loan.renewal_count || 0) >= 1;

                        return (
                          <div key={loan.id} className="p-3 rounded-xl border bg-card text-xs shadow-2xs space-y-2 hover:border-primary/30 transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-11 w-9 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                  {loan.cover_image ? (
                                    <img src={loan.cover_image} alt={loan.book_title} className="h-full w-full object-cover" />
                                  ) : (
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-xs text-foreground truncate">{loan.book_title}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                                    <code className="px-1 py-0.2 bg-muted rounded font-mono text-[10px] font-bold text-primary">{loan.qr_code}</code>
                                    <span>• Hạn: <span className={dueStatus.isOverdue ? "text-destructive font-bold" : ""}>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span></span>
                                  </div>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-1">
                                <Badge variant={dueStatus.variant} className="text-[9px] py-0 px-1.5">{dueStatus.text}</Badge>
                                {isOverdue && (
                                  <Badge variant="destructive" className="text-[9px] py-0 px-1.5">
                                    Phạt: {fineAmount.toLocaleString('vi-VN')}đ
                                  </Badge>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t text-[11px]">
                              <div>
                                {hasRenewed ? (
                                  <span className="text-[10px] text-muted-foreground italic">Đã gia hạn (1/1)</span>
                                ) : !isOverdue ? (
                                  <Button 
                                    size="sm" 
                                    variant="ghost" 
                                    className="h-6 text-[10px] text-muted-foreground hover:text-foreground gap-1 px-1.5"
                                    onClick={() => handleRenew(loan.id, loan.book_title)}
                                  >
                                    <RefreshCw className="h-3 w-3" /> Gia hạn +7 ngày
                                  </Button>
                                ) : null}
                              </div>

                               <Button 
                                size="sm" 
                                className={`h-7 text-xs gap-1.5 px-3 font-semibold shadow-xs shrink-0 ${
                                  loan.fine_already_paid
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                    : isOverdue 
                                      ? "bg-amber-600 hover:bg-amber-700 text-white" 
                                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                }`}
                                onClick={() => handleOpenReturnModal(loan)}
                              >
                                {loan.fine_already_paid ? (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Quét trả • Đã nộp phạt online
                                  </>
                                ) : isOverdue ? (
                                  <>
                                    <AlertTriangle className="h-3.5 w-3.5" /> Quét trả • Thu {fineAmount.toLocaleString('vi-VN')}đ
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Quét & Nhận trả
                                  </>
                                )}
                              </Button>
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
        </div>
      )}

      {/* 5. Sổ Theo Dõi Lưu Thông Toàn Thư Viện (Data Table) */}
      <Card className="shadow-xs border">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="font-display text-base font-bold flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" /> Sổ Theo Dõi Lưu Thông Toàn Thư Viện
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Nhật ký lưu thông sách mượn - trả thời gian thực kèm mã bản sao hiện vật
              </CardDescription>
            </div>

            {/* Filter Buttons & Search */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTableFilter("all")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${tableFilter === "all" ? "bg-background text-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Tất cả ({history.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter("borrowing")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${tableFilter === "borrowing" ? "bg-background text-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Đang mượn ({activeLoansCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter("overdue")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${tableFilter === "overdue" ? "bg-background text-destructive font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Quá hạn ({overdueLoansCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter("returned")}
                  className={`px-2.5 py-1 rounded-md transition-colors ${tableFilter === "returned" ? "bg-background text-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Đã trả ({returnedLoansCount})
                </button>
              </div>

              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Tìm theo sách, độc giả, thẻ..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 text-xs h-8 bg-background"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Mã Phiếu</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Tên Sách & Bản Sao</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Chủ Thẻ / Độc Giả</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Ngày Mượn</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Hạn Trả</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold">Trạng Thái</TableHead>
                <TableHead className="py-2.5 px-4 text-xs font-semibold text-right">Thao Tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredHistory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                    Không tìm thấy bản ghi giao dịch nào phù hợp với bộ lọc.
                  </TableCell>
                </TableRow>
              ) : (
                filteredHistory.map((record) => {
                  const dueStatus = getDueStatus(record.due_date);
                  const isOverdue = record.status === "borrowing" && dueStatus.isOverdue;

                  return (
                    <TableRow key={record.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell className="py-3 px-4 font-mono font-bold text-muted-foreground text-xs">
                        #{record.id}
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <p className="font-semibold text-foreground text-xs">{record.book_title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <code className="text-[10px] font-mono bg-primary/10 text-primary px-1.5 py-0.2 rounded font-bold">
                            {record.qr_code}
                          </code>
                          <button 
                            type="button"
                            onClick={() => {
                              setSelectedCopyQr({ title: record.book_title, qrCode: record.qr_code, readerName: record.reader_name });
                              setViewCopyQrDialog(true);
                            }}
                            className="text-[10px] text-muted-foreground hover:text-primary underline"
                          >
                            Xem QR
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <p className="font-semibold text-foreground text-xs">{record.reader_name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          Thẻ: <strong className="text-foreground">{record.card_number}</strong> {record.reader_phone ? `• SĐT: ${record.reader_phone}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="py-3 px-4 text-muted-foreground text-xs">
                        {new Date(record.borrow_date).toLocaleDateString("vi-VN")}
                      </TableCell>
                      <TableCell className="py-3 px-4 text-xs">
                        <span className={isOverdue ? "text-destructive font-bold" : "text-muted-foreground"}>
                          {new Date(record.due_date).toLocaleDateString("vi-VN")}
                        </span>
                        {isOverdue && (
                          <Badge variant="destructive" className="ml-1 text-[8px] py-0 px-1">Trễ hạn</Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <Badge 
                          variant={record.status === "borrowing" ? (isOverdue ? "destructive" : "default") : "outline"} 
                          className="text-[9px]"
                        >
                          {record.status === "borrowing" ? (isOverdue ? "Quá hạn" : "Đang mượn") : "Đã trả"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 px-4 text-right">
                        {record.status === "borrowing" && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-6 text-[10px] px-2 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 font-semibold" 
                            onClick={() => handleTableReturnPrompt(record)}
                          >
                            Nhận trả
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Scanner Modal */}
      <Dialog open={isScannerOpen} onOpenChange={(open) => {
        setIsScannerOpen(open);
        if (!open) {
          stopCameraScanner();
          // Nếu đang ở luồng xác thực thẻ độc giả nhận trả mà tắt camera -> Tự động mở lại Modal 1
          if (scannerMode === "table_return_reader" && tableReturnRecord) {
            setTableReturnPromptOpen(true);
          }
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Scan className="h-5 w-5 text-primary" /> 
              {scannerMode === "reader_card" && "Quét Mã Thẻ Độc Giả"}
              {scannerMode === "table_return_reader" && "Quét Thẻ Độc Giả Xác Thực Nhận Trả"}
              {scannerMode === "direct_borrow" && "Quét Mã QR Sách Cho Mượn Thêm"}
              {scannerMode === "approve_book" && "Quét Mã QR Sách Độc Giả Cầm Tới"}
              {scannerMode === "return_verify" && "Quét Mã QR Sách Đối Soát Vào Kho"}
              {scannerMode === "return" && "Quét Mã QR Sách Trả / Thẻ Độc Giả"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {scannerMode === "reader_card" && "Đưa mã QR trên thẻ độc giả vào camera để mở danh sách sách muốn mượn"}
              {scannerMode === "table_return_reader" && `Đưa mã QR trên thẻ của độc giả «${tableReturnRecord?.reader_name || ''}» (${tableReturnRecord?.card_number || ''}) vào camera`}
              {scannerMode === "direct_borrow" && `Đưa mã QR dán trên gáy/bìa cuốn sách lấy thêm vào camera để cho độc giả ${scannedReaderInfo?.reader.full_name || ''} mượn`}
              {scannerMode === "approve_book" && `Đưa tem mã QR trên cuốn sách vật lý mà độc giả ${scannedReaderInfo?.reader.full_name || ''} mang tới vào camera để đối soát`}
              {scannerMode === "return_verify" && "Đưa tem mã QR trên bìa cuốn sách vật lý vào camera để đối soát vào kho"}
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
                      : scannerMode === "table_return_reader"
                      ? `Hoặc nhập mã thẻ độc giả (VD: ${tableReturnRecord?.card_number || 'LIB-RD-000005'})...`
                      : scannerMode === "direct_borrow" 
                      ? "Hoặc nhập mã QR cuốn sách lấy thêm (VD: LIB-BK-1-1)..." 
                      : scannerMode === "approve_book"
                      ? "Hoặc nhập mã QR cuốn sách vật lý trên tay độc giả (VD: LIB-BK-1-1)..."
                      : scannerMode === "return_verify"
                      ? "Hoặc nhập mã QR trên cuốn sách trả (VD: QR-BK-1-1)..."
                      : "Hoặc nhập mã QR sách / mã thẻ độc giả..."
                  }
                  value={simulatedQrCode} 
                  onChange={(e) => setSimulatedQrCode(e.target.value)} 
                  className="text-xs font-mono"
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

      {/* Modal: Quét mã QR Sách Vật Lý Độc Giả Mang Tới Bàn */}
      <Dialog open={approveModalOpen} onOpenChange={(open) => {
        setApproveModalOpen(open);
        if (!open) {
          setApproveBookQr("");
          setApproveCheckedCopy(null);
          setApproveCheckError(null);
          setApproveResvTarget(null);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Đối Soát & Trao Sách Cho Độc Giả
            </DialogTitle>
            <DialogDescription className="text-xs">
              Độc giả tự lấy sách trên kệ mang tới bàn. Thủ thư quét mã QR trên cuốn sách đó để đối soát và trao sách.
            </DialogDescription>
          </DialogHeader>

          {approveResvTarget && (
            <div className="space-y-4 py-1">
              {/* Thông tin đầu sách & độc giả */}
              <div className="p-3 bg-muted/40 border rounded-xl flex items-center gap-3">
                <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center shadow-xs">
                  {approveResvTarget.cover_image ? (
                    <img src={approveResvTarget.cover_image} alt={approveResvTarget.book_title} className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 mb-1">
                    Sách độc giả đã đăng ký trước
                  </Badge>
                  <p className="font-bold text-sm text-foreground truncate">{approveResvTarget.book_title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Độc giả: <strong>{scannedReaderInfo?.reader.full_name}</strong> • Mã thẻ: <code className="font-mono font-bold text-primary">{scannedReaderInfo?.reader.card_number || `LIB-RD-${scannedReaderInfo?.reader.id}`}</code>
                  </p>
                </div>
              </div>

              {/* Hướng dẫn & Ô nhập / quét mã QR sách */}
              <form onSubmit={handleApproveSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <QrCode className="h-4 w-4 text-primary" /> Mã QR trên cuốn sách vật lý độc giả mang tới (*):
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground">Máy quét USB / Camera</span>
                  </label>
                  <div className="flex gap-2">
                    <Input 
                      autoFocus
                      placeholder="Bắn máy quét hoặc nhập mã QR sách (VD: LIB-BK-1-1)..."
                      value={approveBookQr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setApproveBookQr(val);
                        if (!val.trim()) {
                          setApproveCheckedCopy(null);
                          setApproveCheckError(null);
                        } else {
                          // Tự động đối soát khi nhập xong
                          verifyApproveBookCopy(val, approveResvTarget);
                        }
                      }}
                      onBlur={() => {
                        if (approveBookQr.trim()) {
                          verifyApproveBookCopy(approveBookQr, approveResvTarget);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (approveBookQr.trim()) {
                            verifyApproveBookCopy(approveBookQr, approveResvTarget);
                          }
                        }
                      }}
                      className={`font-mono text-xs ${
                        approveCheckError 
                          ? 'border-destructive focus-visible:ring-destructive bg-destructive/5' 
                          : approveCheckedCopy 
                          ? 'border-emerald-500 focus-visible:ring-emerald-500 bg-emerald-50/30' 
                          : ''
                      }`}
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={() => openScannerModal("approve_book")} 
                      className="gap-1.5 shrink-0 text-xs"
                      title="Mở Camera để quét mã trên cuốn sách"
                    >
                      <Camera className="h-4 w-4 text-primary" /> Camera
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    💡 <em>Lưu ý: Mã QR quét được phải thuộc đúng bản sao của đầu sách «{approveResvTarget.book_title}» và ở trạng thái sẵn sàng.</em>
                  </p>
                </div>

                {/* Hộp phản hồi đối soát Real-time */}
                {isCheckingCopy ? (
                  <div className="p-2.5 rounded-xl border bg-muted/20 flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" /> Đang kiểm tra đối soát mã sách với hệ thống...
                  </div>
                ) : approveCheckError ? (
                  <div className="p-3 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 font-bold text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive animate-pulse" />
                      <span>CẢNH BÁO: SAI ĐẦU SÁCH! KHÔNG ĐƯỢC TRAO SÁCH</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-destructive/95 font-medium">{approveCheckError}</p>
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-destructive/20">
                      👉 <strong>Hành động:</strong> Tuyệt đối không giao cuốn sách này. Vui lòng hướng dẫn độc giả vào kệ lấy đúng cuốn <strong>«{approveResvTarget.book_title}»</strong>.
                    </p>
                  </div>
                ) : approveCheckedCopy ? (
                  <div className="p-3 rounded-xl border border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-xs space-y-1 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>ĐÃ ĐỐI SOÁT KHỚP CHÍNH XÁC 100%!</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      • Bản sao: <code className="font-mono font-bold bg-emerald-100 dark:bg-emerald-950 px-1 py-0.5 rounded">{approveCheckedCopy.qr_code}</code> thuộc đúng đầu sách <strong>«{approveCheckedCopy.book_title}»</strong>.
                    </p>
                    <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-medium">
                      ✨ Sách sẵn sàng trao. Bạn có thể nhấn nút xác nhận bên dưới.
                    </p>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setApproveModalOpen(false)}
                    disabled={isApproveSubmitting}
                  >
                    Hủy
                  </Button>
                  <Button 
                    type="submit" 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm disabled:opacity-50"
                    disabled={isApproveSubmitting || !approveBookQr.trim() || !approveCheckedCopy || !!approveCheckError}
                  >
                    {isApproveSubmitting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Xác nhận đối soát & Trao sách
                  </Button>
                </div>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal 1: Yêu cầu quét mã thẻ độc giả để nhận trả sách */}
      <Dialog open={tableReturnPromptOpen} onOpenChange={(open) => {
        setTableReturnPromptOpen(open);
        if (!open) {
          if (scannerMode !== "table_return_reader") {
            setTableReturnAuthInput("");
            setTableReturnError(null);
            setTableReturnRecord(null);
          }
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-center sm:text-left">
            <DialogTitle className="font-display flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
              <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              Yêu cầu quét mã để nhận trả sách
            </DialogTitle>
            <DialogDescription className="text-xs pt-1 leading-relaxed">
              Để đảm bảo quy trình đối soát hiện vật tại quầy, vui lòng quét mã thẻ của độc giả <strong>«{tableReturnRecord?.reader_name}»</strong> ({tableReturnRecord?.card_number}) để kiểm tra và nhận trả vào kho.
            </DialogDescription>
          </DialogHeader>

          {tableReturnRecord && (
            <form onSubmit={(e) => { e.preventDefault(); handleVerifyTableReturnReader(); }} className="space-y-4 pt-1">
              <div className="p-3 bg-muted/40 border rounded-xl space-y-1 text-xs">
                <p className="text-muted-foreground">Ấn phẩm chọn trả: <strong className="text-foreground">{tableReturnRecord.book_title}</strong> (<code className="font-mono text-[11px] font-bold text-primary">{tableReturnRecord.qr_code}</code>)</p>
                <p className="text-muted-foreground">Độc giả mượn: <strong className="text-primary">{tableReturnRecord.reader_name}</strong> • Mã thẻ: <code className="font-mono font-bold">{tableReturnRecord.card_number}</code></p>
              </div>

              {tableReturnError && (
                <div className="p-3.5 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs space-y-1.5 animate-in shake duration-200">
                  <div className="flex items-center gap-1.5 font-bold text-destructive">
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                    <span>LỖI: SAI ĐỘC GIẢ - KHÔNG THỂ DUYỆT TRẢ!</span>
                  </div>
                  <p className="text-[11px] leading-relaxed font-medium">
                    {tableReturnError}
                  </p>
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-destructive/20">
                    👉 Yêu cầu độc giả <strong>«{tableReturnRecord.reader_name}»</strong> ({tableReturnRecord.card_number}) xuất trình đúng thẻ thư viện của mình để tiếp tục nhận trả sách.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold flex items-center justify-between">
                  <span>Quét / Nhập mã thẻ độc giả:</span>
                  <span className="text-[10px] text-muted-foreground font-normal">Máy quét Barcode / Camera</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="Bắn mã thẻ (VD: LIB-RD-000005)..."
                    value={tableReturnAuthInput}
                    onChange={(e) => {
                      setTableReturnAuthInput(e.target.value);
                      if (tableReturnError) setTableReturnError(null);
                    }}
                    className={`font-mono text-xs h-9 bg-background ${tableReturnError ? 'border-destructive focus-visible:ring-destructive' : 'focus-visible:ring-amber-500'}`}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="text-xs shrink-0 bg-primary hover:bg-primary/90 font-semibold"
                    disabled={isVerifyingTableReader || !tableReturnAuthInput.trim()}
                  >
                    {isVerifyingTableReader ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Xác thực"}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTableReturnPromptOpen(false);
                    setTableReturnAuthInput("");
                    setTableReturnError(null);
                    setTableReturnRecord(null);
                  }}
                >
                  Đóng
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5"
                  onClick={() => {
                    setScannerMode("table_return_reader");
                    setTableReturnPromptOpen(false);
                    openScannerModal("table_return_reader");
                  }}
                >
                  <Camera className="h-3.5 w-3.5" /> Mở Camera Quét Thẻ Độc Giả
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Đối Soát & Nhận Trả Sách Vào Kho */}
      <Dialog open={returnModalOpen} onOpenChange={(open) => {
        setReturnModalOpen(open);
        if (!open) {
          setReturnScannedQr("");
          setReturnCheckedCopy(null);
          setReturnCheckError(null);
          setReturnMatchState('none');
          setMatchedOtherLoan(null);
          setReturnTargetLoan(null);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-base text-primary">
              <ArrowRightLeft className="h-5 w-5 text-primary" /> Đối Soát & Nhận Trả Sách Vào Kho
            </DialogTitle>
            <DialogDescription className="text-xs">
              Thủ thư quét mã QR trên cuốn sách vật lý độc giả đem tới để đối soát chống nhầm lẫn trước khi nhận lại vào kho.
            </DialogDescription>
          </DialogHeader>

          {returnTargetLoan && (
            <div className="space-y-4 py-1">
              {/* Thông tin cuốn sách độc giả muốn trả */}
              <div className="p-3 bg-muted/40 border rounded-xl flex items-center gap-3">
                <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center shadow-xs">
                  {returnTargetLoan.cover_image ? (
                    <img src={returnTargetLoan.cover_image} alt={returnTargetLoan.book_title} className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/5">
                      Cuốn sách chọn trả
                    </Badge>
                    <code className="text-[11px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded border">
                      Mã dự kiến: {returnTargetLoan.qr_code}
                    </code>
                  </div>
                  <p className="font-bold text-sm text-foreground truncate">{returnTargetLoan.book_title}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                    <span>Độc giả: <strong>{returnTargetLoan.reader_name || scannedReaderInfo?.reader.full_name}</strong></span>
                    <span>• Hạn trả: <strong>{new Date(returnTargetLoan.due_date).toLocaleDateString('vi-VN')}</strong></span>
                    {returnTargetLoan.fine_already_paid ? (
                      <Badge variant="outline" className="text-[10px] font-semibold text-emerald-700 border-emerald-500/30 bg-emerald-500/10">
                        Đã nộp phạt {Number(returnTargetLoan.fine_paid_amount || returnTargetLoan.fine_amount || 0).toLocaleString('vi-VN')}đ (Online)
                      </Badge>
                    ) : returnTargetLoan.overdue_days && returnTargetLoan.overdue_days > 0 ? (
                      <span className="text-destructive font-semibold">
                        (Quá hạn {returnTargetLoan.overdue_days} ngày • Phạt: {((returnTargetLoan.fine_amount || (returnTargetLoan.overdue_days * 5000))).toLocaleString('vi-VN')}đ)
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Ô Nhập / Quét mã QR cuốn sách thực tế độc giả đưa */}
              <form onSubmit={handleReturnModalSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <QrCode className="h-4 w-4 text-primary" /> Mã QR trên cuốn sách độc giả thực tế đem tới (*):
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground">Máy quét USB / Camera</span>
                  </label>
                  <div className="flex gap-2">
                    <Input 
                      autoFocus
                      placeholder="Bắn máy quét hoặc nhập mã QR trên cuốn sách (VD: QR-BK-1-1)..."
                      value={returnScannedQr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReturnScannedQr(val);
                        if (!val.trim()) {
                          setReturnCheckedCopy(null);
                          setReturnCheckError(null);
                          setReturnMatchState('none');
                          setMatchedOtherLoan(null);
                        } else {
                          verifyReturnBookCopy(val, returnTargetLoan);
                        }
                      }}
                      className="font-mono text-xs h-9 bg-background focus-visible:ring-primary"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 text-xs gap-1.5 shrink-0 border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => openScannerModal("return_verify")}
                    >
                      <Camera className="h-3.5 w-3.5" /> Camera
                    </Button>
                  </div>
                </div>

                {/* Khu vực đối soát thời gian thực */}
                {isCheckingReturnCopy ? (
                  <div className="p-3 rounded-xl border bg-muted/30 text-xs text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                    <span>Đang kiểm tra và đối soát mã bản sao sách với hệ thống...</span>
                  </div>
                ) : returnMatchState === 'exact' && returnCheckedCopy ? (
                  <div className="p-3.5 rounded-xl border border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-xs space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>ĐÃ ĐỐI SOÁT KHỚP CHÍNH XÁC 100%!</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      • Cuốn sách: <strong>«{returnCheckedCopy.book_title}»</strong> (Mã QR: <code className="font-mono font-bold bg-emerald-100 dark:bg-emerald-950 px-1 py-0.5 rounded">{returnCheckedCopy.qr_code}</code>).
                    </p>
                    {returnTargetLoan.fine_already_paid ? (
                      <div className="p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <div>
                          <p className="font-bold text-xs text-emerald-700 dark:text-emerald-400">
                            ĐỘC GIẢ ĐÃ THANH TOÁN PHÍ PHẠT TRƯỚC ĐÓ!
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Khoản phạt <strong>{Number(returnTargetLoan.fine_paid_amount || returnTargetLoan.fine_amount || 0).toLocaleString('vi-VN')}đ</strong> đã thanh toán thành công ({returnTargetLoan.fine_payment_method === 'transfer' ? 'Chuyển khoản VietQR Online' : 'Tiền mặt'}). Sẵn sàng nhận trả sách vào kho mà không cần thu thêm phí.
                          </p>
                        </div>
                      </div>
                    ) : returnTargetLoan.overdue_days && returnTargetLoan.overdue_days > 0 ? (
                      <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs space-y-1">
                        <p className="font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Sách trễ hạn {returnTargetLoan.overdue_days} ngày. Phí phạt cần thu: {((returnTargetLoan.fine_amount || (returnTargetLoan.overdue_days * 5000))).toLocaleString('vi-VN')}đ.
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Hệ thống hỗ trợ Độc giả quét <strong>mã VietQR tự động</strong> hoặc nộp <strong>tiền mặt trực tiếp tại quầy</strong>.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-medium">
                        ✨ Đúng sách, đúng bản sao và đúng độc giả. Sẵn sàng nhận lại vào kho.
                      </p>
                    )}
                  </div>
                ) : returnMatchState === 'other_borrowed' && matchedOtherLoan ? (
                  <div className="p-3.5 rounded-xl border border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs space-y-2 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      <span>ĐỘC GIẢ ĐƯA CUỐN KHÁC (CŨNG LÀ SÁCH ĐANG MƯỢN)</span>
                    </div>
                    <div className="text-[11px] space-y-1 leading-relaxed">
                      <p>• Bạn đang chọn trả: <strong>«{returnTargetLoan.book_title}»</strong> (<code className="font-mono">{returnTargetLoan.qr_code}</code>)</p>
                      <p>• Nhưng sách thực tế độc giả đưa: <strong>«{matchedOtherLoan.book_title}»</strong> (<code className="font-mono font-bold">{matchedOtherLoan.qr_code}</code>)</p>
                      <p className="text-amber-700 dark:text-amber-300 font-medium">
                        💡 <em>Độc giả này CŨNG ĐANG MƯỢN cuốn «{matchedOtherLoan.book_title}». Bạn có thể chuyển sang nhận trả cuốn này ngay:</em>
                      </p>
                    </div>
                    <Button 
                      type="button" 
                      size="sm" 
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1.5 h-8 text-xs shadow-xs"
                      onClick={() => handleSwitchReturnTarget(matchedOtherLoan)}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Chuyển sang nhận trả cuốn «{matchedOtherLoan.book_title}»
                    </Button>
                  </div>
                ) : returnMatchState === 'mismatch' ? (
                  <div className="p-3.5 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs space-y-1.5 animate-in shake duration-200">
                    <div className="flex items-center gap-2 font-bold">
                      <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                      <span>LỖI: SÁCH KHÔNG KHỚP VỚI ĐỘC GIẢ!</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      {returnCheckError}
                    </p>
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-destructive/20">
                      👉 <strong>Hành động:</strong> Tuyệt đối không nhận trả cuốn sách này vào phiếu mượn hiện tại. Yêu cầu độc giả đưa đúng cuốn <strong>«{returnTargetLoan.book_title}»</strong> hoặc cuốn mà độc giả thực sự đã mượn.
                    </p>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setReturnModalOpen(false)}
                    disabled={isReturnSubmitting}
                  >
                    Hủy
                  </Button>
                  <Button 
                    type="submit" 
                    size="sm" 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm disabled:opacity-50"
                    disabled={isReturnSubmitting || !returnScannedQr.trim() || returnMatchState !== 'exact'}
                  >
                    {isReturnSubmitting ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Xác nhận đối soát & Nhận trả sách
                  </Button>
                </div>
              </form>
            </div>
          )}
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

      {/* VietQR Fine Payment Modal (At counter) */}
      {vietQrPaymentInfo && (
        <VietQrModal
          open={vietQrFineModalOpen}
          onOpenChange={setVietQrFineModalOpen}
          amount={vietQrPaymentInfo.amount}
          readerName={vietQrPaymentInfo.readerName}
          cardNumber={vietQrPaymentInfo.cardNumber}
          bookTitle={vietQrPaymentInfo.bookTitle}
          bookCopyQr={vietQrPaymentInfo.bookCopyQr}
          overdueDays={vietQrPaymentInfo.overdueDays}
          transferNote={vietQrPaymentInfo.transferNote}
          allowCashOption={true}
          onConfirmPayment={handleConfirmVietQrFine}
          isSubmitting={isFinePaying}
        />
      )}

      {ConfirmDialogComponent}
    </div>
  );
}
