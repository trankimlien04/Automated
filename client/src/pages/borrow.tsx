import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Camera, BookOpen, User, Clock, CheckCircle2, Scan, RefreshCw,
  Upload, QrCode, AlertTriangle, ShieldCheck, ArrowRightLeft,
  Search, CheckCircle, FileSpreadsheet, BookMarked, BookmarkPlus,
  Download, Zap, CheckSquare, XCircle, UserCheck, Sparkles, X,
  Inbox, Layers, Filter, Check, Banknote, CreditCard, Copy, Trash2
} from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { QRCodeCanvas } from "qrcode.react";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/contexts/AuthContext";
import { VietQrModal } from "@/components/vietqr-modal";
import { LibraryMiniMapModal } from "@/components/library-mini-map-modal";
import { Checkbox } from "@/components/ui/checkbox";
import { ExitPassModal } from "@/components/exit-pass-modal";
import { SmartBookDropModal } from "@/components/smart-book-drop-modal";
import { SecurityExitScannerModal } from "@/components/security-exit-scanner-modal";
import { BookDropAuditModal } from "@/components/book-drop-audit-modal";

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
  location?: string;
  book_location?: string;
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
  location?: string;
  book_location?: string;
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
  overdueLoansCount?: number;
  maxBooksAllowed?: number;
  maxBooks?: number;
  activeDraft?: any;
  draftWillExceedLimit?: boolean;
  draftExceedReason?: string | null;
  targetDraftCode?: string | null;
  borrowRequests?: {
    request_id: number;
    reservation_id?: number;
    request_date: string;
    request_status: string;
    book_id: number;
    book_title: string;
    isbn?: string;
    cover_image?: string;
    available_copies: number;
    location?: string;
    book_location?: string;
  }[];
  readyReservations?: {
    reservation_id: number;
    reservation_date: string;
    reservation_status: string;
    book_id: number;
    book_title: string;
    isbn?: string;
    cover_image?: string;
    available_copies: number;
    location?: string;
    book_location?: string;
  }[];
  pendingRequests: {
    reservation_id: number;
    reservation_date: string;
    reservation_status: string;
    book_id: number;
    book_title: string;
    isbn?: string;
    cover_image?: string;
    available_copies: number;
    location?: string;
    book_location?: string;
  }[];
  activeBorrows: {
    id: number;
    borrow_date: string;
    due_date: string;
    book_title: string;
    qr_code: string;
    cover_image?: string;
    location?: string;
    book_location?: string;
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
    book_copy_qr?: string;
  }[];
  totalUnpaidFines?: number;
}

export interface ActiveBatchSlip {
  batchCode: string;
  createdAt: string;
  loanIds: number[];
  books: {
    id: number;
    book_title: string;
    qr_code: string;
    cover_image?: string;
    due_date?: string;
  }[];
}

export default function BorrowPage() {
  const [history, setHistory] = useState<Transaction[]>([]);
  const [myReservations, setMyReservations] = useState<Reservation[]>([]);
  const [myBorrowRequests, setMyBorrowRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlMode = searchParams.get("mode") as "checkout" | "return" | "history" | null;
  const [stationMode, setStationModeState] = useState<"checkout" | "return" | "history">(
    urlMode && ["checkout", "return", "history"].includes(urlMode) ? urlMode : "checkout"
  );

  const setStationMode = (mode: "checkout" | "return" | "history") => {
    setStationModeState(mode);
    setSearchParams({ mode }, { replace: true });
  };

  useEffect(() => {
    if (urlMode && ["checkout", "return", "history"].includes(urlMode) && urlMode !== stationMode) {
      setStationModeState(urlMode);
    }
  }, [urlMode]);

  // Librarian Scanned Reader Checkout Data
  const [scannedReaderInfo, setScannedReaderInfo] = useState<ScannedReaderData | null>(null);
  const [searchReaderInput, setSearchReaderInput] = useState("");
  const [directBookQr, setDirectBookQr] = useState("");
  const [directBookInfo, setDirectBookInfo] = useState<any>(null);
  const [isCheckingDirectBook, setIsCheckingDirectBook] = useState(false);
  const [directBookCheckError, setDirectBookCheckError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("checkout");

  // Return form state
  const [returnBookQr, setReturnBookQr] = useState("");

  // Scanner Dialogs
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scannerMode, setScannerMode] = useState<"desk_auto" | "reader_card" | "return" | "direct_borrow" | "approve_book" | "return_verify" | "table_return_reader" | "shelf_verify_copy" | "shelf_scan_direct" | "shelf_scan_auto">("desk_auto");
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
  const [readerHistoryTab, setReaderHistoryTab] = useState<"borrowing" | "returned" | "all">("borrowing");

  // Approve reservation modal state (Quét mã sách vật lý độc giả mang tới bàn)
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveResvTarget, setApproveResvTarget] = useState<{
    reservation_id: number;
    book_id: number;
    book_title: string;
    cover_image?: string;
    isbn?: string;
    location?: string;
    book_location?: string;
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
    location?: string;
    book_location?: string;
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
    isCounterDirectFine?: boolean;
    unpaidFinesList?: any[];
  } | null>(null);
  const [isFinePaying, setIsFinePaying] = useState(false);

  // Multi-book Draft Borrowing States (Phiếu Mượn Nháp Gom Nhiều Cuốn & Quét Duyệt 1 Chạm)
  const [myActiveDraft, setMyActiveDraft] = useState<any | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<any[]>([]);
  const [draftApprovalModalOpen, setDraftApprovalModalOpen] = useState(false);
  const [targetDraftData, setTargetDraftData] = useState<any | null>(null);
  const [copyOverrides, setCopyOverrides] = useState<{ [bookId: number]: string }>({});
  const [isApprovingDraft, setIsApprovingDraft] = useState(false);

  // Batch Return Bundle States (Độc giả gom nhiều cuốn trả 1 lần & Thủ thư quét 1 lần)
  const [selectedLoanIdsForReturn, setSelectedLoanIdsForReturn] = useState<number[]>([]);
  const [activeBatchSlips, setActiveBatchSlips] = useState<ActiveBatchSlip[]>([]);
  const [viewingBatchSlip, setViewingBatchSlip] = useState<ActiveBatchSlip | null>(null);
  const [returnBundleModalOpen, setReturnBundleModalOpen] = useState(false);
  const [bulkReturnModalOpen, setBulkReturnModalOpen] = useState(false);
  const [bulkReturnData, setBulkReturnData] = useState<any | null>(null);
  const [isSubmittingBulkReturn, setIsSubmittingBulkReturn] = useState(false);

  // Reader profile info for QR
  const [readerProfile, setReaderProfile] = useState<any>(null);

  // Smart Library 4.0: Exit Pass & Book Drop 24/7 States
  const [exitPassModalOpen, setExitPassModalOpen] = useState(false);
  const [myExitPassData, setMyExitPassData] = useState<any | null>(null);
  const [smartBookDropOpen, setSmartBookDropOpen] = useState(false);
  const [securityScannerOpen, setSecurityScannerOpen] = useState(false);
  const [bookDropAuditOpen, setBookDropAuditOpen] = useState(false);
  const [dropBoxPendingCount, setDropBoxPendingCount] = useState(0);

  const fetchMyExitPass = async () => {
    try {
      const res = await api.get("/borrow/exit-passes/my-active");
      setMyExitPassData(res.data);
    } catch (e) {
      console.error("Lỗi khi tải vé ra cửa:", e);
    }
  };

  const fetchDropBoxCount = async () => {
    try {
      const res = await api.get("/borrow/drop-box-items");
      setDropBoxPendingCount(res.data?.length || 0);
    } catch (e) {
      console.error("Lỗi khi tải số lượng sách hòm 24/7:", e);
    }
  };

  // Modal Cảnh báo & Đặt trước khi sách đã có người giữ chỗ 24h
  const [heldBookModalData, setHeldBookModalData] = useState<{
    open: boolean;
    bookTitle: string;
    copyQr: string;
    bookId?: number;
    holdCount: number;
    holds: any[];
    allCopiesHeld?: boolean;
    isSpecificCopyHeld?: boolean;
    message?: string;
  } | null>(null);
  const [isReservingFromModal, setIsReservingFromModal] = useState(false);

  // Live Shelf Scanner Preview & Hold Inspector
  const [shelfScanLiveInfo, setShelfScanLiveInfo] = useState<any | null>(null);
  const [isCheckingShelfLive, setIsCheckingShelfLive] = useState(false);

  useEffect(() => {
    const raw = simulatedQrCode.trim();
    if (!raw || !isScannerOpen) {
      setShelfScanLiveInfo(null);
      return;
    }
    const isBookCode = /^(?:QR-BK-|BK-|BOOK-|LIB-BK-)/i.test(raw) || raw.includes('-BK-');
    if (!isBookCode) {
      setShelfScanLiveInfo(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingShelfLive(true);
      try {
        const res = await api.get(`/borrow/check-copy/${encodeURIComponent(raw)}`);
        setShelfScanLiveInfo(res.data);
      } catch (e) {
        setShelfScanLiveInfo(null);
      } finally {
        setIsCheckingShelfLive(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [simulatedQrCode, isScannerOpen]);

  // Mini Map Wayfinding State
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [miniMapTarget, setMiniMapTarget] = useState<{
    location?: string;
    title?: string;
    author?: string;
    cover?: string;
  } | null>(null);

  const handleOpenMiniMap = (item?: {
    location?: string;
    book_location?: string;
    title?: string;
    book_title?: string;
    author_name?: string;
    cover_image?: string;
    cover?: string;
  } | null) => {
    if (!item) return;
    setMiniMapTarget({
      location: item.location || item.book_location || "Phòng 01 - Kệ 01 - Ngăn 01",
      title: item.title || item.book_title,
      author: item.author_name,
      cover: item.cover_image || item.cover,
    });
    setMiniMapOpen(true);
  };

  // Modal to inspect a specific book copy QR code or Reader Card QR
  const [viewCopyQrDialog, setViewCopyQrDialog] = useState(false);
  const [selectedCopyQr, setSelectedCopyQr] = useState<{ title: string; qrCode: string; readerName?: string; type?: 'reader' | 'book' } | null>(null);

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

  const fetchMyBorrowRequests = async () => {
    try {
      const response = await api.get("/borrow/requests");
      setMyBorrowRequests(response.data || []);
    } catch (error) {
      console.error("Lỗi khi tải danh sách yêu cầu mượn:", error);
    }
  };

  const fetchMyReservations = async () => {
    try {
      const response = await api.get("/reservations");
      setMyReservations(response.data || []);
    } catch (error) {
      console.error("Lỗi khi tải danh sách sách đặt trước:", error);
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

  const fetchMyActiveDraft = async () => {
    try {
      const res = await api.get("/borrow/drafts/my-active");
      setMyActiveDraft(res.data?.draft || null);
    } catch (e) {
      console.error("Lỗi khi tải phiếu mượn nháp của tôi:", e);
    }
  };

  const fetchPendingDrafts = async () => {
    try {
      const res = await api.get("/borrow/drafts/pending-list");
      setPendingDrafts(res.data || []);
    } catch (e) {
      console.error("Lỗi khi tải hàng đợi phiếu mượn nháp:", e);
    }
  };

  const handleOpenDraftByCode = async (draftCode: string) => {
    try {
      const res = await api.get(`/borrow/drafts/${encodeURIComponent(draftCode)}`);
      const data = res.data;
      const isDraftOverLimit = (data.activeBorrowsCount ?? data.eligibility?.activeCount ?? 0) + (data.items?.length || data.draft?.items?.length || 0) > (data.maxBooks ?? data.eligibility?.maxBooks ?? 5);
      const normalizedData = {
        ...data,
        items: data.items || data.draft?.items || [],
        reader: data.reader || {
          id: data.draft?.reader_id,
          full_name: data.draft?.reader_name,
          card_number: data.draft?.card_number,
          email: data.draft?.reader_email,
        },
        draft: data.draft || data,
        eligibility: {
          ...data.eligibility,
          canBorrow: data.eligibility?.canBorrow !== false && !isDraftOverLimit,
          borrowBlockReason: isDraftOverLimit
            ? `Vượt quá giới hạn mượn sách! Độc giả hiện đang giữ ${data.activeBorrowsCount ?? data.eligibility?.activeCount ?? 0}/${data.maxBooks ?? data.eligibility?.maxBooks ?? 5} cuốn. Phiếu mượn gồm ${data.items?.length || data.draft?.items?.length || 0} cuốn sẽ vượt hạn mức tối đa (${data.maxBooks ?? data.eligibility?.maxBooks ?? 5} cuốn/độc giả). Cần trả bớt sách trước khi duyệt mượn thêm!`
            : data.eligibility?.borrowBlockReason
        },
        activeBorrowsCount: data.activeBorrowsCount ?? data.eligibility?.activeCount ?? 0,
        maxBooks: data.maxBooks ?? data.eligibility?.maxBooks ?? 5
      };
      setTargetDraftData(normalizedData);
      setCopyOverrides({});
      setDraftApprovalModalOpen(true);
      if (isDraftOverLimit || data.eligibility?.canBorrow === false) {
        toast.error(
          normalizedData.eligibility?.borrowBlockReason ||
            "Cảnh báo: Độc giả đã đạt giới hạn mượn sách hoặc phiếu mượn vượt quá hạn mức tối đa!",
          { duration: 6000 }
        );
      } else {
        toast.success(`Đã tải thông tin phiếu mượn online: ${draftCode}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Không tìm thấy phiếu mượn online [${draftCode}]`);
    }
  };

  const handleConfirmApproveDraft = async () => {
    if (!targetDraftData) return;
    const isDraftOverLimit =
      (targetDraftData.activeBorrowsCount || 0) +
        (targetDraftData.items?.length || 0) >
      (targetDraftData.maxBooks || 5);
    if (isDraftOverLimit || targetDraftData.eligibility?.canBorrow === false) {
      toast.error(
        targetDraftData.eligibility?.borrowBlockReason ||
          "Không thể phê duyệt! Độc giả đã đạt giới hạn mượn sách tối đa.",
        { duration: 6000 }
      );
      return;
    }
    setIsApprovingDraft(true);
    try {
      const res = await api.post(`/borrow/drafts/${encodeURIComponent(targetDraftData.draft.draft_code)}/approve`, {
        copyOverrides
      });
      toast.success(res.data.message || `Đã duyệt trao thành công toàn bộ sách cho độc giả ${targetDraftData.draft.reader_name}!`);
      setDraftApprovalModalOpen(false);
      setTargetDraftData(null);
      setCopyOverrides({});

      fetchHistory();
      fetchPendingDrafts();

      if (scannedReaderInfo) {
        loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể phê duyệt phiếu mượn online");
    } finally {
      setIsApprovingDraft(false);
    }
  };

  const handleCancelReaderDraft = async (draftId: number) => {
    confirm({
      title: "Hủy phiếu mượn online?",
      description: "Bạn có chắc muốn hủy phiếu mượn online này không? Mã QR của giao dịch này sẽ bị hủy bỏ.",
      confirmText: "Hủy phiếu",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/drafts/${draftId}`);
          toast.success("Đã hủy phiếu mượn online thành công");
          setMyActiveDraft(null);
          fetchMyBorrowRequests();
          fetchMyReservations();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể hủy phiếu mượn online");
        }
      }
    });
  };

  const handleCancelBorrowRequest = (requestId: number, bookTitle: string) => {
    confirm({
      title: "Hủy giữ chỗ mượn sách online?",
      description: `Bạn có chắc muốn hủy giữ chỗ cuốn sách "${bookTitle}" không? Nếu hủy, cuốn sách sẽ được hoàn trả lại kho cho các bạn đọc khác mượn.`,
      confirmText: "Hủy giữ chỗ",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/requests/${requestId}`);
          toast.success("Đã hủy giữ chỗ mượn sách thành công");
          fetchMyBorrowRequests();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể hủy giữ chỗ");
        }
      }
    });
  };

  useEffect(() => {
    fetchHistory();
    fetchMyBorrowRequests();
    fetchMyReservations();
    fetchUserProfile();
    if (user?.role === "reader") {
      fetchMyActiveDraft();
      fetchMyExitPass();
    } else {
      fetchPendingDrafts();
      fetchDropBoxCount();
    }
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
        } catch (e) { }
      }
    };
  }, []);

  // Batch Return Handlers (Xử lý xem trước và xác nhận gom trả N cuốn trong 1 chạm)
  const handlePreviewBatchReturn = async (param: string | number[]) => {
    try {
      let payload: any = {};
      if (typeof param === "string") {
        payload = { batchCode: param };
      } else {
        payload = { recordIds: param };
      }
      const res = await api.post("/borrow/batch-return-preview", payload);
      setBulkReturnData(res.data);
      setBulkReturnModalOpen(true);
      toast.success(`Đã nhận diện mã gom trả: ${res.data.books?.length || 0} cuốn sách của độc giả ${res.data.reader?.fullName}!`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể tải thông tin gom trả sách");
    }
  };

  const handleExecuteBulkReturn = async () => {
    if (!bulkReturnData) return;
    setIsSubmittingBulkReturn(true);
    try {
      const payload: any = {
        batchCode: bulkReturnData.batchCode,
        recordIds: bulkReturnData.books?.map((b: any) => b.recordId),
        confirmPaidFine: true,
        paymentMethod: "cash"
      };
      const res = await api.post("/borrow/batch-return", payload);
      toast.success(res.data.message || `Đã hoàn tất nhận trả thành công ${res.data.returnedCount} cuốn sách vào kho!`);
      setBulkReturnModalOpen(false);
      setBulkReturnData(null);
      fetchHistory();
      if (scannedReaderInfo?.reader?.card_number) {
        loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
      } else if (scannedReaderInfo?.reader?.id) {
        loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể thực hiện trả hàng loạt");
    } finally {
      setIsSubmittingBulkReturn(false);
    }
  };

  // Tải danh sách phiếu gom trả đang chờ từ localStorage khi đăng nhập
  useEffect(() => {
    if (user?.id) {
      try {
        const raw = localStorage.getItem(`active_return_batches_${user.id}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setActiveBatchSlips(parsed);
          }
        }
      } catch (e) {
        console.error("Lỗi khi đọc danh sách phiếu gom trả:", e);
      }
    }
  }, [user?.id]);

  // Đồng bộ phiếu gom trả với lịch sử mượn (tự động xóa phiếu/cuốn đã trả thành công)
  useEffect(() => {
    if (user?.role === "reader" && history.length > 0) {
      const activeBorrowingIds = new Set(history.filter(h => h.status === 'borrowing').map(h => h.id));

      setActiveBatchSlips(prevSlips => {
        if (!prevSlips || prevSlips.length === 0) return [];
        let changed = false;
        const validSlips: ActiveBatchSlip[] = [];

        for (const slip of prevSlips) {
          const remainingLoanIds = slip.loanIds.filter(id => activeBorrowingIds.has(id));
          if (remainingLoanIds.length === 0) {
            changed = true; // Toàn bộ cuốn trong phiếu đã được trả xong
          } else if (remainingLoanIds.length !== slip.loanIds.length) {
            changed = true; // Một phần sách trong phiếu đã được trả
            validSlips.push({
              ...slip,
              loanIds: remainingLoanIds,
              books: slip.books.filter(b => remainingLoanIds.includes(b.id))
            });
          } else {
            validSlips.push(slip);
          }
        }

        if (changed && user?.id) {
          localStorage.setItem(`active_return_batches_${user.id}`, JSON.stringify(validSlips));
        }
        return changed ? validSlips : prevSlips;
      });
    }
  }, [history, user]);

  // Handler tạo phiếu gom trả mới cho các cuốn sách được chọn
  const handleCreateBatchSlip = () => {
    if (selectedLoanIdsForReturn.length === 0) {
      toast.error("Vui lòng chọn ít nhất 1 cuốn sách để tạo mã gom trả!");
      return;
    }
    const currentActiveLoans = history.filter(h => h.status === 'borrowing');
    const selectedLoans = currentActiveLoans.filter(l => selectedLoanIdsForReturn.includes(l.id));
    const newBatchCode = `RETURN-BATCH-U${user?.id || 1}-${selectedLoanIdsForReturn.join(',')}`;
    const newSlip: ActiveBatchSlip = {
      batchCode: newBatchCode,
      createdAt: new Date().toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric'
      }),
      loanIds: [...selectedLoanIdsForReturn],
      books: selectedLoans.map(l => ({
        id: l.id,
        book_title: l.book_title,
        qr_code: l.qr_code,
        cover_image: l.cover_image,
        due_date: l.due_date
      }))
    };

    const updatedSlips = [newSlip, ...activeBatchSlips.filter(s => s.batchCode !== newBatchCode)];
    setActiveBatchSlips(updatedSlips);
    if (user?.id) {
      localStorage.setItem(`active_return_batches_${user.id}`, JSON.stringify(updatedSlips));
    }
    setSelectedLoanIdsForReturn([]); // Đã gom thành công thì bỏ chọn để không bị trùng
    setViewingBatchSlip(newSlip);
    setReturnBundleModalOpen(true);
    toast.success(`Đã tạo phiếu gom trả (${newSlip.books.length} cuốn)! Bạn có thể xem lại mã QR bất cứ lúc nào.`);
  };

  // Handler hủy phiếu gom trả (trả các cuốn sách về danh sách bình thường)
  const handleCancelBatchSlip = (batchCode: string) => {
    const targetSlip = activeBatchSlips.find(s => s.batchCode === batchCode);
    const updatedSlips = activeBatchSlips.filter(s => s.batchCode !== batchCode);
    setActiveBatchSlips(updatedSlips);
    if (user?.id) {
      localStorage.setItem(`active_return_batches_${user.id}`, JSON.stringify(updatedSlips));
    }
    if (viewingBatchSlip?.batchCode === batchCode) {
      setViewingBatchSlip(null);
      setReturnBundleModalOpen(false);
    }
    toast.info(`Đã hủy phiếu gom (${targetSlip?.books.length || 0} cuốn). Các cuốn sách này đã sẵn sàng để bạn chọn lại.`);
  };

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

  // Librarian: Close reader session helper and reset all direct borrow inputs
  const handleCloseReaderSession = () => {
    setScannedReaderInfo(null);
    setSearchReaderInput("");
    setDirectBookQr("");
    setDirectBookInfo(null);
    setDirectBookCheckError(null);
    setSimulatedQrCode("");
    setShelfScanLiveInfo(null);
    toast.info("Đã đóng phiên làm việc của độc giả.");
  };

  // Reset direct borrow state whenever active reader changes or closes
  useEffect(() => {
    setDirectBookQr("");
    setDirectBookInfo(null);
    setDirectBookCheckError(null);
  }, [scannedReaderInfo?.reader?.id]);

  // Librarian: Fetch reader info & their requested books when scanning reader card QR or Ticket QR
  const loadReaderCheckoutInfo = async (cardNumber: string) => {
    const trimmed = cardNumber.trim();
    if (!trimmed) {
      toast.error("Vui lòng nhập hoặc quét mã thẻ độc giả");
      return;
    }

    // Luôn dọn dẹp các trường nhập sách mượn trước đó khi mở/chuyển phiên độc giả mới
    setDirectBookQr("");
    setDirectBookInfo(null);
    setDirectBookCheckError(null);
    setSimulatedQrCode("");
    setShelfScanLiveInfo(null);

    // Nếu là mã QR Gom Trả Nhiều Cuốn -> Mở ngay modal nhận trả toàn bộ
    if (trimmed.startsWith('RETURN-BATCH-') || trimmed.startsWith('RTN-BATCH-') || trimmed.startsWith('RTN-')) {
      setSearchReaderInput("");
      await handlePreviewBatchReturn(trimmed);
      return;
    }

    // Nếu thủ thư quét hoặc nhập mã định danh cuốn sách vật lý -> Tự động kích hoạt nhận trả sách vào kho!
    const isBookCode = /^(?:QR-BK-|BK-|BOOK-|LIB-BK-)/i.test(trimmed) || trimmed.includes('-BK-');
    if (isBookCode) {
      setSearchReaderInput("");
      await handleReturnBook(trimmed);
      return;
    }

    try {
      const res = await api.get(`/borrow/reader-checkout-info/${encodeURIComponent(trimmed)}`);
      setScannedReaderInfo(res.data);
      setSearchReaderInput(res.data.reader.card_number || `LIB-RD-${String(res.data.reader.id).padStart(6, '0')}`);
      setActiveTab("checkout");
      toast.success(`Đã nhận diện độc giả: ${res.data.reader.full_name} (${res.data.reader.card_number || 'ID: ' + res.data.reader.id})`);

      // Tự động mở Modal Duyệt Phiếu Mượn nếu độc giả có giỏ mượn đang chờ duyệt (kể cả khi quét Thẻ Độc Giả LIB-RD- hay mã phiếu)
      if (res.data.activeDraft) {
        const isDraftOverLimit = (res.data.activeBorrows?.length || 0) + (res.data.activeDraft.items?.length || 0) > (res.data.maxBooks || 5);
        setTargetDraftData({
          draft: res.data.activeDraft,
          items: res.data.activeDraft.items || [],
          reader: res.data.reader,
          activeBorrowsCount: res.data.activeBorrows?.length || 0,
          maxBooks: res.data.maxBooks || 5,
          eligibility: {
            canBorrow: res.data.canBorrow && !isDraftOverLimit,
            borrowBlockReason: isDraftOverLimit 
              ? (res.data.draftExceedReason || `Vượt quá giới hạn mượn sách! Độc giả đang giữ ${res.data.activeBorrows?.length || 0}/${res.data.maxBooks || 5} cuốn. Phiếu mượn gồm ${res.data.activeDraft.items?.length || 0} cuốn sẽ vượt hạn mức tối đa (${res.data.maxBooks || 5} cuốn/độc giả).`) 
              : res.data.borrowBlockReason,
            unpaidFines: res.data.totalUnpaidFines || 0,
            overdueCount: res.data.overdueLoansCount || 0
          }
        });
        setDraftApprovalModalOpen(true);
        if (isDraftOverLimit || !res.data.canBorrow) {
          toast.error(
            res.data.draftExceedReason ||
              res.data.borrowBlockReason ||
              "Cảnh báo: Phiếu mượn này vượt quá số lượng mượn tối đa!",
            { duration: 6000 }
          );
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không tìm thấy thông tin độc giả phù hợp với mã này");
      setScannedReaderInfo(null);
    }
  };

  // Đăng ký đặt trước sách (xếp hàng chờ nhận) trực tiếp từ modal cảnh báo giữ chỗ
  const handleReserveFromHeldModal = async () => {
    if (!heldBookModalData?.bookId) {
      toast.error("Không tìm thấy thông tin đầu sách để đặt trước");
      return;
    }
    setIsReservingFromModal(true);
    try {
      const res = await api.post("/reservations", {
        bookId: heldBookModalData.bookId
      });
      toast.success(res.data.message || "Đã đăng ký xếp hàng đặt trước sách thành công! Bạn sẽ nhận được thông báo ngay khi có sách sẵn sàng.");
      setHeldBookModalData(null);
      fetchMyReservations();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể đặt trước cuốn sách này");
    } finally {
      setIsReservingFromModal(false);
    }
  };

  // Độc giả: Quét sách thông minh tại kệ (Tự động nhận diện: đối soát nếu có trong phiếu, thêm vào giỏ nếu là sách mới)
  const handleReaderShelfScan = async (copyQr: string) => {
    const clean = copyQr.trim();
    if (!clean) return;

    // 1. Nếu đang có phiếu mượn, thử đối soát trước
    if (myActiveDraft) {
      try {
        const res = await api.post(`/borrow/drafts/${encodeURIComponent(myActiveDraft.draft_code)}/verify-copy`, {
          copyQr: clean
        });
        toast.success(res.data.message || "Đã đối soát sách thành công!");
        await fetchMyActiveDraft();
        return;
      } catch (err: any) {
        // CẢNH BÁO: Nếu server báo sách này đã có người giữ chỗ 24h -> CHẶN NGAY & BẬT MODAL, KHÔNG ĐƯỢC CHUYỂN QUA SCAN-DIRECT!
        if (err.response?.data?.isHeld) {
          const heldData = err.response.data;
          setHeldBookModalData({
            open: true,
            bookTitle: heldData.bookTitle || "Sách thư viện",
            copyQr: heldData.copyQr || clean,
            bookId: heldData.bookId,
            holdCount: heldData.holdCount || 1,
            holds: heldData.holds || [],
            allCopiesHeld: heldData.allCopiesHeld,
            isSpecificCopyHeld: heldData.isSpecificCopyHeld,
            message: heldData.message
          });
          return;
        }

        // Nếu không thuộc danh sách đối soát -> thử thêm vào giỏ mượn tại chỗ (scan-direct)
        const isNotMatch = err.response?.status === 400 || err.response?.status === 404;
        if (!isNotMatch) {
          toast.error(err.response?.data?.message || "Đối soát sách thất bại");
          return;
        }
      }
    }

    // 2. Thêm vào giỏ mượn tại kệ
    try {
      const res = await api.post(`/borrow/drafts/scan-direct`, {
        copyQr: clean
      });
      if (res.data?.hasHoldNotice && res.data?.freeCopiesRemaining !== undefined) {
        toast.info(
          `ℹ️ Lưu ý: Cuốn «${res.data.items?.[res.data.items.length - 1]?.book_title || 'Sách'}» đang có bạn đọc giữ chỗ online. Thư viện còn ${res.data.freeCopiesRemaining} bản sao tự do khác trên kệ.`,
          { duration: 6000 }
        );
      }
      toast.success(res.data.message || "Đã thêm sách vào giỏ mượn tại chỗ!");
      await fetchMyActiveDraft();
    } catch (err: any) {
      if (err.response?.data?.isHeld) {
        const heldData = err.response.data;
        setHeldBookModalData({
          open: true,
          bookTitle: heldData.bookTitle || "Sách thư viện",
          copyQr: heldData.copyQr || clean,
          bookId: heldData.bookId,
          holdCount: heldData.holdCount || 1,
          holds: heldData.holds || [],
          allCopiesHeld: heldData.allCopiesHeld,
          isSpecificCopyHeld: heldData.isSpecificCopyHeld,
          message: heldData.message
        });
        return;
      }
      toast.error(err.response?.data?.message || "Không thể thêm cuốn sách này vào giỏ");
    }
  };

  // Độc giả: Tự đối soát bản sao sách đã nhặt tại kệ
  const handleShelfVerifyCopy = async (copyQr: string) => {
    await handleReaderShelfScan(copyQr);
  };

  // Độc giả: Quét mã QR bản sao sách mượn trực tiếp tại kệ
  const handleShelfScanDirect = async (copyQr: string) => {
    await handleReaderShelfScan(copyQr);
  };

  // Độc giả: Xóa 1 cuốn sách khỏi phiếu mượn
  const handleRemoveDraftItem = async (itemId: number) => {
    confirm({
      title: "Xóa sách khỏi phiếu mượn?",
      description: "Bạn có chắc chắn muốn bỏ cuốn sách này khỏi danh sách mượn không?",
      confirmText: "Xóa sách",
      cancelText: "Giữ lại",
      onConfirm: async () => {
        try {
          const res = await api.delete(`/borrow/drafts/items/${itemId}`);
          toast.success(res.data.message || "Đã xóa sách khỏi phiếu");
          await fetchMyActiveDraft();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể xóa sách khỏi phiếu");
        }
      }
    });
  };

  // Độc giả: Tự quét mã QR sách để trả vào kho
  const handleReaderReturnBook = async (bookQr: string) => {
    const cleanQr = bookQr.trim();
    if (!cleanQr) return;

    try {
      const response = await api.post("/borrow/return", {
        bookQrCode: cleanQr
      });

      const { overdueDays, fineAmount, finePaid } = response.data?.data || {};
      if (finePaid && fineAmount > 0) {
        toast.success(`Đã nộp phí phạt ${fineAmount.toLocaleString('vi-VN')}đ và trả sách thành công!`);
      } else {
        toast.success(response.data?.message || "Đã tự hoàn trả sách thành công vào kho!");
      }

      await fetchHistory();
      await fetchMyActiveDraft();
    } catch (error: any) {
      const errData = error.response?.data;
      if (errData?.requiresFinePayment) {
        toast.error(`Sách trễ hạn ${errData.overdueDays} ngày. Vui lòng thanh toán phí phạt để hoàn tất trả sách.`);
        setVietQrPaymentInfo({
          amount: errData.fineAmount,
          readerName: user?.fullName || (user as any)?.full_name || "Độc giả",
          cardNumber: (user as any)?.card_number || `LIB-RD-${user?.id}`,
          bookTitle: errData.bookTitle,
          bookCopyQr: cleanQr,
          overdueDays: errData.overdueDays,
          transferNote: `PHAT ${cleanQr} RD${user?.id}`
        });
        setVietQrFineModalOpen(true);
      } else {
        toast.error(errData?.message || "Không thể thực hiện trả cuốn sách này");
      }
    }
  };

  // Librarian & Reader: Process scanned QR (Card, Ticket, Book Return, or Shelf Scan)
  const processScannedText = async (decodedText: string) => {
    const code = decodedText.trim();
    await stopCameraScanner();
    setIsScannerOpen(false);

    if (!code) return;

    // A. Độc giả: Quét tem sách tại kệ (Thông minh: Tự động đối soát hoặc thêm vào giỏ mượn)
    if (scannerMode === "shelf_scan_auto" || scannerMode === "shelf_verify_copy" || scannerMode === "shelf_scan_direct") {
      await handleReaderShelfScan(code);
      return;
    }

    // X. Quét mã QR Gom Trả Nhiều Cuốn (RETURN-BATCH-xxxx hoặc RTN-) -> Mở modal nhận trả gom
    if (code.startsWith('RETURN-BATCH-') || code.startsWith('RTN-BATCH-') || code.startsWith('RTN-')) {
      await handlePreviewBatchReturn(code);
      return;
    }

    // D. Chế độ thủ thư cho mượn thêm sách tại quầy (direct_borrow)
    if (scannerMode === "direct_borrow") {
      setDirectBookQr(code);
      await handleDirectBorrow(undefined, code);
      return;
    }

    // C. Quét ở chế độ Quầy thông minh (desk_auto), Thẻ độc giả (reader_card), hoặc Trả sách (return)
    if (scannerMode === "desk_auto" || scannerMode === "reader_card" || scannerMode === "return") {
      const isBookCode = /^(?:QR-BK-|BK-|BOOK-|LIB-BK-)/i.test(code) || code.includes('-BK-');
      if (isBookCode) {
        setReturnBookQr(code);
        await handleReturnBook(code);
        return;
      }

      setSearchReaderInput(code);
      setReturnBookQr("");
      await loadReaderCheckoutInfo(code);
      return;
    }

    // Default: Check if code looks like a book code and route
    const isBookCode = /^(?:QR-BK-|BK-|BOOK-|LIB-BK-)/i.test(code) || code.includes('-BK-');
    if (isBookCode) {
      setReturnBookQr(code);
      await handleReturnBook(code);
      return;
    }

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
    if (scannedReaderInfo?.canBorrow === false) {
      toast.error(scannedReaderInfo?.borrowBlockReason || "Độc giả không đủ điều kiện mượn thêm sách (đã đạt giới hạn tối đa)!");
      return;
    }
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

  const handleCollectReaderFinesAtCounter = () => {
    if (!scannedReaderInfo) return;
    const unpaidList = scannedReaderInfo.unpaidFines || [];
    const totalAmount = scannedReaderInfo.totalUnpaidFines || unpaidList.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
    const firstFine = unpaidList[0];

    setVietQrPaymentInfo({
      amount: totalAmount,
      readerName: scannedReaderInfo.reader.full_name,
      cardNumber: scannedReaderInfo.reader.card_number,
      bookTitle: unpaidList.length === 1 ? (firstFine?.book_title || "Phí phạt trễ hạn") : `Thanh toán ${unpaidList.length} khoản phí phạt tồn đọng`,
      bookCopyQr: unpaidList.length === 1 ? (firstFine?.book_copy_qr || "") : "",
      overdueDays: 0,
      transferNote: `PHAT ${scannedReaderInfo.reader.card_number || scannedReaderInfo.reader.id}`,
      isCounterDirectFine: true,
      unpaidFinesList: unpaidList
    });
    setVietQrFineModalOpen(true);
  };

  const handleConfirmVietQrFine = async (method: "transfer" | "cash") => {
    setIsFinePaying(true);
    try {
      if (vietQrPaymentInfo?.isCounterDirectFine) {
        const finesToPay = vietQrPaymentInfo.unpaidFinesList || [];
        for (const fineItem of finesToPay) {
          await api.put(`/fines/${fineItem.id}/pay`, {
            payment_method: method,
            payment_channel: 'counter',
            transaction_ref: method === 'transfer' ? `TXN-COUNTER-FINE-${fineItem.id}-${Date.now().toString().slice(-6)}` : null
          });
        }
        toast.success(`Đã thu ${method === 'cash' ? 'tiền mặt' : 'chuyển khoản VietQR'} phí phạt (${vietQrPaymentInfo.amount.toLocaleString('vi-VN')}đ) thành công!`);
        setVietQrFineModalOpen(false);
        setVietQrPaymentInfo(null);
        if (scannedReaderInfo?.reader?.card_number) {
          await loadReaderCheckoutInfo(scannedReaderInfo.reader.card_number);
        } else if (scannedReaderInfo?.reader?.id) {
          await loadReaderCheckoutInfo(String(scannedReaderInfo.reader.id));
        }
        await fetchHistory();
        return;
      }

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

  // Tra cứu và kiểm tra thông tin bản sao sách mượn trực tiếp tại kệ (kiểm tra giữ chỗ 24h & kiểm tra đã mượn)
  const checkDirectBookCopy = async (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) {
      setDirectBookInfo(null);
      setDirectBookCheckError(null);
      return;
    }
    if (/^(?:LIB-RD-|LIB-AD-|LIB-LB-|LIB-OW-|RD-|USER-|UID-)/i.test(clean)) {
      setDirectBookInfo(null);
      setDirectBookCheckError(`[${clean}] là mã thẻ độc giả. Vui lòng quét mã tem QR dán trên cuốn sách!`);
      return;
    }

    // 1. Kiểm tra ngay lập tức trong danh sách sách độc giả đang giữ (activeBorrows)
    const isCurrentReaderHolding = scannedReaderInfo?.activeBorrows?.find(
      (b: any) => b.qr_code?.toLowerCase() === clean.toLowerCase()
    );
    if (isCurrentReaderHolding) {
      const copyTitle = isCurrentReaderHolding.book_title || "Sách";
      const dueStr = isCurrentReaderHolding.due_date ? ` (Hạn trả: ${new Date(isCurrentReaderHolding.due_date).toLocaleDateString('vi-VN')})` : "";
      toast.error(
        `⛔ CẢNH BÁO: Độc giả "${scannedReaderInfo?.reader?.full_name}" ĐANG GIỮ cuốn sách này (${copyTitle})${dueStr}! Không thể cho mượn lại.`,
        { duration: 7000 }
      );
    }

    // 2. Kiểm tra trong toàn bộ giao dịch đang lưu thông (history)
    const otherActiveLoan = history.find(
      (h: any) => h.status === 'borrowing' && h.qr_code?.toLowerCase() === clean.toLowerCase()
    );
    if (otherActiveLoan && (!scannedReaderInfo || otherActiveLoan.user_id !== scannedReaderInfo.reader?.id)) {
      toast.error(
        `⛔ CẢNH BÁO: Bản sao [${clean}] hiện ĐANG ĐƯỢC MƯỢN bởi độc giả "${otherActiveLoan.reader_name}" (${otherActiveLoan.card_number || 'ID: ' + otherActiveLoan.user_id})! Cần nhận trả sách trước khi cho mượn lại.`,
        { duration: 7000 }
      );
    }

    setIsCheckingDirectBook(true);
    setDirectBookCheckError(null);
    try {
      const res = await api.get(`/borrow/check-copy/${encodeURIComponent(clean)}`);
      const copyData = res.data;
      setDirectBookInfo(copyData);
      setDirectBookCheckError(null);

      const isBorrowed = Boolean(
        copyData.status === 'borrowed' ||
        copyData.active_borrow_id != null ||
        copyData.is_already_borrowed === true ||
        Boolean(copyData.borrower_user_id) ||
        Boolean(copyData.borrower_name) ||
        Boolean(isCurrentReaderHolding) ||
        Boolean(otherActiveLoan)
      );

      if (isBorrowed) {
        const isCurrentHolder = Boolean(
          (copyData.borrower_user_id && copyData.borrower_user_id === scannedReaderInfo?.reader?.id) ||
          (copyData.borrower_card_number && copyData.borrower_card_number === scannedReaderInfo?.reader?.card_number) ||
          isCurrentReaderHolding
        );

        if (isCurrentHolder) {
          toast.error(
            `⛔ Bản sao [${clean}] («${copyData.book_title}») đang được độc giả này giữ! Không thể cho mượn trùng lặp.`,
            { duration: 6000 }
          );
        } else {
          const bName = copyData.borrower_name || otherActiveLoan?.reader_name || "độc giả khác";
          const bCard = copyData.borrower_card_number || otherActiveLoan?.card_number ? ` (${copyData.borrower_card_number || otherActiveLoan?.card_number})` : "";
          const dDateRaw = copyData.due_date || otherActiveLoan?.due_date;
          const dDate = dDateRaw ? ` - Hạn trả: ${new Date(dDateRaw).toLocaleDateString('vi-VN')}` : "";
          toast.error(
            `⛔ Bản sao [${clean}] đang được mượn bởi: ${bName}${bCard}${dDate}. Vui lòng nhập bản sao khác còn sẵn trên kệ!`,
            { duration: 7000 }
          );
        }
      } else if (copyData.all_copies_held) {
        const isThisReaderHolding = copyData.holds?.some((h: any) => h.user_id === scannedReaderInfo?.reader?.id);
        if (!isThisReaderHolding) {
          toast.warning(
            `⚠️ Cuốn «${copyData.book_title}» đã có ${copyData.hold_count} bạn đọc giữ chỗ 24h. Toàn bộ sách trên kệ đã hết suất tự do!`,
            { duration: 6000 }
          );
        }
      }
    } catch (err: any) {
      setDirectBookInfo(null);
      const msg = err.response?.data?.message || `Mã sách [${clean}] không tồn tại trong hệ thống!`;
      setDirectBookCheckError(msg);
      toast.error(msg);
    } finally {
      setIsCheckingDirectBook(false);
    }
  };

  useEffect(() => {
    if (!directBookQr.trim()) {
      setDirectBookInfo(null);
      setDirectBookCheckError(null);
      return;
    }
    const timer = setTimeout(() => {
      checkDirectBookCopy(directBookQr);
    }, 350);
    return () => clearTimeout(timer);
  }, [directBookQr]);

  // Librarian: Direct Borrow (Mượn trực tiếp tại quầy bằng mã sách)
  const handleDirectBorrow = async (e?: React.FormEvent, customBookQr?: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const targetBookQr = (customBookQr || directBookQr).trim();
    const readerCard = scannedReaderInfo?.reader.card_number || (scannedReaderInfo?.reader.id ? String(scannedReaderInfo.reader.id) : "");
    const currentReaderId = scannedReaderInfo?.reader.id;

    if (!readerCard) {
      toast.error("Vui lòng quét hoặc nhập mã thẻ độc giả ở mục 1 trước khi cho mượn sách");
      return;
    }
    if (scannedReaderInfo?.canBorrow === false) {
      toast.error(scannedReaderInfo?.borrowBlockReason || "Độc giả không đủ điều kiện mượn thêm sách (đã đạt giới hạn tối đa)!");
      return;
    }
    if (!targetBookQr) {
      toast.error("Vui lòng nhập hoặc bật camera quét mã QR cuốn sách muốn cho mượn thêm");
      return;
    }

    const isCurrentReaderHolding = scannedReaderInfo?.activeBorrows?.some(
      (b: any) => b.qr_code?.toLowerCase() === targetBookQr.toLowerCase()
    );
    const activeHistoryLoan = history.find(
      (h: any) => h.status === 'borrowing' && h.qr_code?.toLowerCase() === targetBookQr.toLowerCase()
    );
    const isBorrowed = Boolean(
      directBookInfo?.status === 'borrowed' ||
      directBookInfo?.active_borrow_id ||
      directBookInfo?.is_already_borrowed ||
      directBookInfo?.borrower_user_id ||
      directBookInfo?.borrower_name ||
      isCurrentReaderHolding ||
      activeHistoryLoan
    );

    // Nếu bản sao này hiện đang được mượn
    if (isBorrowed) {
      const isCurrentHolder = Boolean(
        isCurrentReaderHolding ||
        (directBookInfo?.borrower_user_id && directBookInfo?.borrower_user_id === currentReaderId) ||
        (activeHistoryLoan && activeHistoryLoan.user_id === currentReaderId)
      );
      const bName = directBookInfo?.borrower_name || activeHistoryLoan?.reader_name || (isCurrentHolder ? scannedReaderInfo?.reader.full_name : "Độc giả khác");
      const bCard = directBookInfo?.borrower_card_number || activeHistoryLoan?.card_number ? ` (${directBookInfo?.borrower_card_number || activeHistoryLoan?.card_number})` : "";
      const dDateRaw = directBookInfo?.due_date || activeHistoryLoan?.due_date;
      const dDate = dDateRaw ? ` (Hạn trả: ${new Date(dDateRaw).toLocaleDateString('vi-VN')})` : "";
      confirm({
        title: isCurrentHolder ? "⛔ Độc giả này đang giữ cuốn sách này!" : "⛔ Bản sao này đang được mượn!",
        description: isCurrentHolder
          ? `Độc giả "${scannedReaderInfo?.reader.full_name}" hiện ĐANG GIỮ cuốn sách [${targetBookQr}]${dDate}.\n\n👉 Không thể cho mượn cuốn sách mà chính bạn đọc chưa trả lại thư viện!`
          : `Bản sao sách [${targetBookQr}] của cuốn «${directBookInfo?.book_title || 'Sách'}» hiện ĐANG ĐƯỢC MƯỢN bởi độc giả "${bName}"${bCard}${dDate} và chưa được trả lại thư viện.\n\n👉 Vui lòng nhận trả sách vào kho trước khi cho mượn lại, hoặc yêu cầu độc giả lấy bản sao khác còn sẵn sàng trên kệ!`,
        confirmText: "Đã hiểu",
        cancelText: "Đóng",
        variant: "destructive",
        onConfirm: () => { }
      });
      return;
    }

    // Nếu cuốn sách đã được độc giả khác giữ chỗ 24h và không còn bản sao dư trên kệ:
    if (directBookInfo && directBookInfo.all_copies_held) {
      const isThisReaderHolding = directBookInfo.holds?.some((h: any) => h.user_id === currentReaderId);
      if (!isThisReaderHolding) {
        confirm({
          title: "⛔ Không thể cho mượn: Sách đã được giữ chỗ 24h!",
          description: `Cuốn sách «${directBookInfo.book_title}» hiện có ${directBookInfo.hold_count} độc giả đang giữ chỗ online 24h:\n` +
            directBookInfo.holds.map((h: any, i: number) => `  ${i + 1}. ${h.reader_name} (${h.card_number || 'ID:' + h.user_id}) - Còn ${Math.max(1, (h.time_left_hours !== null && h.time_left_hours !== undefined) ? h.time_left_hours : 24)} giờ`).join('\n') +
            `\n\nToàn bộ ${directBookInfo.available_physical_copies} bản sao trên kệ hiện đã có bạn đọc giữ chỗ trước. Bạn không thể cho mượn trực tiếp để tránh làm mất sách của người đã giữ chỗ!\n\n👉 Vui lòng giải thích cho độc giả chọn cuốn sách khác hoặc Đặt trước sách.`,
          confirmText: "Đã hiểu",
          cancelText: "Đóng",
          variant: "destructive",
          onConfirm: () => { }
        });
        return;
      }
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
          setDirectBookInfo(null);
          setDirectBookCheckError(null);
          loadReaderCheckoutInfo(readerCard);
          fetchHistory();
          fetchMyBorrowRequests();
        } catch (err: any) {
          const errData = err.response?.data;
          if (errData?.isHeld) {
            confirm({
              title: "⛔ Sách đã được độc giả khác giữ chỗ 24h",
              description: `Cuốn sách «${errData.bookTitle || targetBookQr}» hiện đã có ${errData.holdCount} bạn đọc đăng ký giữ chỗ 24h:\n` +
                (errData.holds || []).map((h: any, i: number) => `  ${i + 1}. ${h.reader_name} (${h.card_number || 'ID:' + h.user_id}) - Còn ${Math.max(1, (h.time_left_hours !== null && h.time_left_hours !== undefined) ? h.time_left_hours : 24)} giờ`).join('\n') +
                `\n\nToàn bộ bản sao trên kệ đã có chủ giữ chỗ trước. Vui lòng giải thích cho độc giả chọn cuốn khác!`,
              confirmText: "Đã hiểu",
              cancelText: "Đóng",
              variant: "destructive",
              onConfirm: () => { }
            });
          } else {
            toast.error(errData?.message || "Lỗi khi cho mượn sách");
          }
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
  function handleReturnSubmit(bookQr?: string, loanData?: any) {
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
      const match = scannedReaderInfo.activeBorrows.find(b => b.qr_code.toLowerCase() === qrToReturn.toLowerCase());
      if (match) {
        overdueDays = match.overdue_days || 0;
        fineAmount = match.fine_amount || (overdueDays * 5000);
        bookTitle = match.book_title;
      }
    } else if (!loanData && history) {
      const match = history.find(b => b.qr_code.toLowerCase() === qrToReturn.toLowerCase() && b.status === 'borrowing');
      if (match) {
        const dueStatus = getDueStatus(match.due_date);
        overdueDays = dueStatus.isOverdue ? (dueStatus.diffDays || 1) : 0;
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
        description: `• Phí phạt trễ hạn của cuốn "${bookTitle || qrToReturn}": ${fineAmount.toLocaleString('vi-VN')}đ (${overdueDays} ngày trễ × 5.000đ/ngày).${oldDebt > 0
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
  }

  function handleReturnBook(bookQr?: string, loanData?: any) {
    return handleReturnSubmit(bookQr, loanData);
  }

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
          } catch (e) { }
        }

        const scanner = new Html5Qrcode("qr-reader-viewport");
        html5QrCodeRef.current = scanner;

        try {
          await scanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            (decodedText) => {
              processScannedText(decodedText);
            },
            () => { }
          );
        } catch (camErr) {
          console.warn("Camera sau không tìm thấy, chuyển sang camera mặc định:", camErr);
          const cameras = await Html5Qrcode.getCameras().catch(() => []);
          if (cameras && cameras.length > 0) {
            await scanner.start(
              cameras[0].id,
              { fps: 10, qrbox: { width: 240, height: 240 } },
              (decodedText) => {
                processScannedText(decodedText);
              },
              () => { }
            );
          } else {
            throw camErr;
          }
        }
      } catch (err) {
        console.error("Camera start error:", err);
        toast.error("Không thể mở camera. Vui lòng cấp quyền máy ảnh hoặc nhập mã QR sách thủ công bên dưới.");
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
  const openScannerModal = (mode: "desk_auto" | "reader_card" | "return" | "direct_borrow" | "approve_book" | "return_verify" | "table_return_reader" | "shelf_verify_copy" | "shelf_scan_direct" | "shelf_scan_auto" = "desk_auto") => {
    setScannerMode(mode);
    setSimulatedQrCode("");
    setShelfScanLiveInfo(null);
    setIsCameraActive(false);
    setIsScannerOpen(true);
  };

  const handleSimulatedScan = () => {
    const clean = simulatedQrCode.trim();
    if (!clean) {
      toast.error("Vui lòng nhập mã quét");
      return;
    }

    const isBorrowMode = (
      scannerMode === "direct_borrow" || 
      scannerMode === "shelf_scan_direct" || 
      scannerMode === "shelf_verify_copy" || 
      scannerMode === "shelf_scan_auto"
    );

    const activeHistoryLoanInScan = history.find(
      (h: any) => h.status === 'borrowing' && h.qr_code?.toLowerCase() === clean.toLowerCase()
    );
    const isCopyBorrowedInScan = Boolean(
      shelfScanLiveInfo?.status === 'borrowed' ||
      shelfScanLiveInfo?.active_borrow_id ||
      shelfScanLiveInfo?.is_already_borrowed ||
      shelfScanLiveInfo?.borrower_name ||
      activeHistoryLoanInScan
    );

    // Nếu bản sao này ĐANG ĐƯỢC MƯỢN và đang ở chế độ mượn sách
    if (isBorrowMode && isCopyBorrowedInScan) {
      const bName = shelfScanLiveInfo?.borrower_name || activeHistoryLoanInScan?.reader_name || "Độc giả khác";
      const bCard = shelfScanLiveInfo?.borrower_card_number || activeHistoryLoanInScan?.card_number ? ` (${shelfScanLiveInfo?.borrower_card_number || activeHistoryLoanInScan?.card_number})` : "";
      const dDateRaw = shelfScanLiveInfo?.due_date || activeHistoryLoanInScan?.due_date;
      const dDate = dDateRaw ? ` (Hạn trả: ${new Date(dDateRaw).toLocaleDateString('vi-VN')})` : "";
      toast.error(`⛔ Bản sao [${clean}] hiện ĐANG ĐƯỢC MƯỢN bởi ${bName}${bCard}${dDate}! Vui lòng nhập bản sao khác.`);
      return;
    }

    // Nếu đã kiểm tra thấy toàn bộ bản sao trên kệ đã có người giữ chỗ 24h
    if (shelfScanLiveInfo && (shelfScanLiveInfo.all_copies_held || shelfScanLiveInfo.is_this_copy_held)) {
      const isMe = shelfScanLiveInfo.holds?.some((h: any) => h.user_id === user?.id);
      if (!isMe) {
        setIsScannerOpen(false);
        setHeldBookModalData({
          open: true,
          bookTitle: shelfScanLiveInfo.book_title,
          copyQr: clean,
          bookId: shelfScanLiveInfo.book_id,
          holdCount: shelfScanLiveInfo.hold_count || 1,
          holds: shelfScanLiveInfo.holds || [],
          allCopiesHeld: true,
          isSpecificCopyHeld: shelfScanLiveInfo.is_this_copy_held
        });
        return;
      }
    }

    processScannedText(clean);
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
        } catch (e) { }
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Reusable Scanner Modal rendered for both Reader and Librarian
  const renderScannerModal = () => (
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
            {scannerMode === "desk_auto" && "Máy Quét Thông Minh (All-in-One)"}
            {scannerMode === "reader_card" && "Quét Mã Thẻ Độc Giả"}
            {scannerMode === "return" && "Quét Mã QR Sách Để Nhận Trả Vào Kho"}
            {scannerMode === "table_return_reader" && "Quét Thẻ Độc Giả Xác Thực Nhận Trả"}
            {scannerMode === "direct_borrow" && "Quét Mã QR Sách Cho Mượn Thêm"}
            {scannerMode === "approve_book" && "Quét Mã QR Sách Độc Giả Cầm Tới"}
            {scannerMode === "return_verify" && "Quét Mã QR Sách Đối Soát Vào Kho"}
            {(scannerMode === "shelf_scan_auto" || scannerMode === "shelf_verify_copy" || scannerMode === "shelf_scan_direct") && "Quét Tem Sách Thông Minh Tại Kệ"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {scannerMode === "desk_auto" && "Đưa Thẻ độc giả, Mã phiếu mượn (DRAFT-BRW-...), Mã gom trả (RETURN-BATCH-...), hoặc Tem sách (QR-BK-...) vào camera để tự động xử lý ngay lập tức."}
            {scannerMode === "reader_card" && "Đưa mã QR trên thẻ độc giả vào camera để mở phiên giao dịch mượn / trả sách"}
            {scannerMode === "return" && "Đưa tem mã QR dán trên gáy hoặc bìa cuốn sách độc giả mang tới vào camera để thủ thư nhận trả và thu hồi sách vào kho."}
            {scannerMode === "table_return_reader" && `Đưa mã QR trên thẻ của độc giả «${tableReturnRecord?.reader_name || ''}» (${tableReturnRecord?.card_number || ''}) vào camera`}
            {scannerMode === "direct_borrow" && `Đưa mã QR dán trên gáy/bìa cuốn sách lấy thêm vào camera để cho độc giả ${scannedReaderInfo?.reader.full_name || ''} mượn`}
            {scannerMode === "approve_book" && `Đưa tem mã QR trên cuốn sách vật lý mà độc giả ${scannedReaderInfo?.reader.full_name || ''} mang tới vào camera để đối soát`}
            {scannerMode === "return_verify" && "Đưa tem mã QR trên bìa cuốn sách vật lý vào camera để đối soát vào kho"}
            {(scannerMode === "shelf_scan_auto" || scannerMode === "shelf_verify_copy" || scannerMode === "shelf_scan_direct") && "Đưa tem mã QR dán trên gáy sách bạn nhặt tại kệ vào khung quét để hệ thống tự động đối soát hoặc thêm vào giỏ mượn ngay lập tức."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {!isCameraActive ? (
            <div className="flex flex-col gap-3">
              <Button onClick={startCameraScanner} className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs">
                <Camera className="h-4 w-4" /> Bật Camera / WebCam Quét Trực Tiếp
              </Button>
              <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Tải ảnh mã QR từ thiết bị
              </Button>
              <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileUpload} />

              <div className="relative my-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-background px-2 text-muted-foreground font-medium">Hoặc nhập mã quét thủ công</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder={
                      scannerMode === "reader_card"
                        ? "Nhập mã thẻ độc giả (VD: LIB-RD-000003)..."
                        : scannerMode === "return"
                          ? "Nhập mã QR trên gáy cuốn sách trả (VD: QR-BK-1-1)..."
                          : scannerMode === "table_return_reader"
                            ? `Nhập mã thẻ độc giả (VD: ${tableReturnRecord?.card_number || 'LIB-RD-000005'})...`
                            : scannerMode === "direct_borrow"
                              ? "Nhập mã QR cuốn sách lấy thêm (VD: QR-BK-1-1)..."
                              : scannerMode === "approve_book"
                                ? "Nhập mã QR cuốn sách vật lý (VD: QR-BK-1-1)..."
                                : scannerMode === "return_verify"
                                  ? "Nhập mã QR trên cuốn sách trả (VD: QR-BK-1-1)..."
                                  : (scannerMode === "shelf_verify_copy" || scannerMode === "shelf_scan_direct" || scannerMode === "shelf_scan_auto")
                                    ? "Nhập mã QR cuốn sách (VD: QR-BK-1-2, QR-BK-2-4)..."
                                    : "Nhập mã..."
                    }
                    value={simulatedQrCode}
                    onChange={(e) => setSimulatedQrCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSimulatedScan();
                      }
                    }}
                    className="text-xs font-mono"
                  />
                  {(() => {
                    const cleanScan = simulatedQrCode.trim().toLowerCase();
                    const activeHistoryLoanInModal = cleanScan
                      ? history.find((h: any) => h.status === 'borrowing' && h.qr_code?.toLowerCase() === cleanScan)
                      : null;
                    const isModalCopyBorrowed = Boolean(
                      cleanScan && (
                        shelfScanLiveInfo?.status === 'borrowed' ||
                        shelfScanLiveInfo?.active_borrow_id ||
                        shelfScanLiveInfo?.is_already_borrowed ||
                        shelfScanLiveInfo?.borrower_name ||
                        activeHistoryLoanInModal
                      )
                    );
                    const isBorrowMode = (
                      scannerMode === "direct_borrow" || 
                      scannerMode === "shelf_scan_direct" || 
                      scannerMode === "shelf_verify_copy" || 
                      scannerMode === "shelf_scan_auto"
                    );

                    return (
                      <Button
                        onClick={handleSimulatedScan}
                        disabled={isBorrowMode && isModalCopyBorrowed}
                        variant={
                          (isBorrowMode && isModalCopyBorrowed) || shelfScanLiveInfo?.all_copies_held
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs shrink-0 font-semibold px-4 cursor-pointer"
                      >
                        {(isBorrowMode && isModalCopyBorrowed)
                          ? "⛔ Đang có người mượn"
                          : shelfScanLiveInfo?.all_copies_held
                          ? "⛔ Đã giữ chỗ"
                          : "Nạp mã"}
                      </Button>
                    );
                  })()}
                </div>

                {/* Real-time Live Inspection Card for Shelf Book Scanning */}
                {isCheckingShelfLive && (
                  <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 text-[11px] flex items-center gap-2 text-muted-foreground animate-pulse">
                    <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                    <span>Đang kiểm tra dữ liệu bản sao sách và trạng thái giữ chỗ...</span>
                  </div>
                )}

                {shelfScanLiveInfo && !isCheckingShelfLive && (
                  (() => {
                    const cleanScan = simulatedQrCode.trim().toLowerCase();
                    const activeHistoryLoanInModal = cleanScan
                      ? history.find((h: any) => h.status === 'borrowing' && h.qr_code?.toLowerCase() === cleanScan)
                      : null;
                    const isModalCopyBorrowed = Boolean(
                      cleanScan && (
                        shelfScanLiveInfo.status === 'borrowed' ||
                        shelfScanLiveInfo.active_borrow_id ||
                        shelfScanLiveInfo.is_already_borrowed ||
                        shelfScanLiveInfo.borrower_name ||
                        activeHistoryLoanInModal
                      )
                    );
                    const modalBorrowerName = shelfScanLiveInfo.borrower_name || activeHistoryLoanInModal?.reader_name || "Độc giả";
                    const modalBorrowerCard = shelfScanLiveInfo.borrower_card_number || activeHistoryLoanInModal?.card_number || "";
                    const modalDueDate = shelfScanLiveInfo.due_date || activeHistoryLoanInModal?.due_date;

                    return isModalCopyBorrowed ? (
                      <div className="p-3 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-red-950 dark:text-red-200 text-xs space-y-2.5 transition-all shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-8 w-8 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0 text-red-600 shadow-2xs">
                              <AlertTriangle className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-xs text-foreground truncate">
                                {shelfScanLiveInfo.book_title}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">
                                Mã: {simulatedQrCode} • {shelfScanLiveInfo.location || "Kệ thư viện"}
                              </p>
                            </div>
                          </div>

                          <Badge variant="destructive" className="text-[10px] shrink-0 font-bold uppercase tracking-wider">
                            ⛔ ĐANG CÓ NGƯỜI MƯỢN
                          </Badge>
                        </div>

                        <div className="space-y-1.5 pt-1 border-t border-red-200 dark:border-red-900/40 text-[11px] leading-relaxed">
                          <div className="p-2 bg-white/90 dark:bg-zinc-900/90 rounded-lg border border-red-200 dark:border-red-900/40 space-y-1 shadow-2xs">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-foreground flex items-center gap-1">
                                <User className="h-3 w-3 text-red-600" />
                                Người đang mượn: <strong>{modalBorrowerName}</strong>
                              </span>
                              <span className="font-mono text-muted-foreground text-[10px]">
                                {modalBorrowerCard}
                              </span>
                            </div>
                            {modalDueDate && (
                              <div className="text-red-700 dark:text-red-300 text-[10px]">
                                📅 Hạn trả: <strong>{new Date(modalDueDate).toLocaleDateString("vi-VN")}</strong>
                              </div>
                            )}
                          </div>

                          <p className="text-red-900 dark:text-red-200 font-medium">
                            ⚠️ Bản sao này hiện chưa được trả lại thư viện. Vui lòng nhận trả sách trước hoặc nhập mã bản sao khác!
                          </p>
                        </div>
                      </div>
                    ) : (shelfScanLiveInfo.all_copies_held || shelfScanLiveInfo.is_this_copy_held) ? (
                    // TRƯỜNG HỢP 2: TẤT CẢ BẢN SAO TRÊN KỆ ĐÃ CÓ NGƯỜI GIỮ CHỖ
                    <div className="p-3 rounded-xl border border-red-300 dark:border-red-900/60 bg-red-50/90 dark:bg-red-950/40 text-red-950 dark:text-red-200 text-xs space-y-2.5 transition-all shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-lg bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0 text-red-600 shadow-2xs">
                            <AlertTriangle className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs text-foreground truncate">
                              {shelfScanLiveInfo.book_title}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">
                              Mã: {simulatedQrCode} • {shelfScanLiveInfo.location || "Kệ thư viện"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          variant="destructive"
                          className="text-[10px] shrink-0 font-semibold"
                        >
                          ⛔ ĐÃ CÓ NGƯỜI GIỮ CHỖ
                        </Badge>
                      </div>

                      <div className="space-y-2 pt-1 border-t border-red-200 dark:border-red-900/40 text-[11px] leading-relaxed">
                        <div className="p-2 bg-white/90 dark:bg-zinc-900/90 rounded-lg border border-red-200 dark:border-red-900/40 flex items-center justify-between shadow-2xs">
                          <span className="font-semibold text-foreground">
                            👤 Bạn đọc giữ chỗ: <strong>{shelfScanLiveInfo.holds?.[0]?.reader_name || "Trần Kim Liên"}</strong>
                          </span>
                          <Badge variant="outline" className="text-[10px] bg-red-100 text-red-800 border-red-300 font-medium">
                            Còn {Math.max(1, shelfScanLiveInfo.holds?.[0]?.time_left_hours ?? 24)}h giữ
                          </Badge>
                        </div>

                        <p className="text-red-900 dark:text-red-200">
                          ⚠️ Toàn bộ <strong>{shelfScanLiveInfo.available_physical_copies || 1} bản sao</strong> trên kệ hiện đã có bạn đọc hẹn trước. Vui lòng để lại sách trên kệ cho bạn đọc đó!
                        </p>

                        <div className="pt-1 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              setIsScannerOpen(false);
                              setHeldBookModalData({
                                open: true,
                                bookTitle: shelfScanLiveInfo.book_title,
                                copyQr: simulatedQrCode.trim(),
                                bookId: shelfScanLiveInfo.book_id,
                                holdCount: shelfScanLiveInfo.hold_count || 1,
                                holds: shelfScanLiveInfo.holds || [],
                                allCopiesHeld: true,
                                isSpecificCopyHeld: shelfScanLiveInfo.is_this_copy_held
                              });
                            }}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 h-8 shadow-xs cursor-pointer"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" /> 🔔 Đặt Trước Sách (Xếp Hàng Nhận Sách)
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // TRƯỜNG HỢP 3: BẢN SAO SẴN SÀNG TRÊN KỆ
                    <div className="p-3 rounded-xl border border-emerald-300 dark:border-emerald-900/60 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 text-xs space-y-2.5 transition-all shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0 text-emerald-600 shadow-2xs">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs text-foreground truncate">
                              {shelfScanLiveInfo.book_title}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">
                              Mã: {simulatedQrCode} • {shelfScanLiveInfo.location || "Kệ thư viện"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0 font-semibold bg-emerald-100 text-emerald-800 border-emerald-300"
                        >
                          ✓ Còn {shelfScanLiveInfo.free_copies ?? shelfScanLiveInfo.available_physical_copies ?? 1} cuốn sẵn sàng
                        </Badge>
                      </div>

                      <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                        Cuốn sách này hiện có sẵn trên kệ và không bị giữ chỗ. Bạn có thể bấm "Nạp mã" để thêm vào giỏ mượn ngay!
                      </p>
                    </div>
                  );
                })()
              )}

                {/* Quick suggestions if user is shelf verifying copies for their draft */}
                {scannerMode === "shelf_verify_copy" && myActiveDraft?.items && (
                  <div className="p-2.5 bg-muted/40 rounded-xl border border-border/70 text-[11px] space-y-1.5">
                    <p className="font-semibold text-foreground flex items-center gap-1">
                      <span>💡 Gợi ý mã bản sao sách trong phiếu:</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {myActiveDraft.items.map((item: any, idx: number) => {
                        const isVerified = Boolean(item.book_copy_id);
                        if (isVerified) return null;
                        const sampleCode = `QR-BK-${item.book_id || (idx + 1)}-${idx === 0 ? 3 : 2}`;
                        return (
                          <Button
                            key={item.item_id || item.id || idx}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 py-0 border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 font-mono"
                            onClick={() => {
                              setSimulatedQrCode(sampleCode);
                              processScannedText(sampleCode);
                            }}
                          >
                            ⚡ Quét thử: {item.book_title?.slice(0, 16)}... ({sampleCode})
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick suggestions if librarian is returning books */}
                {scannerMode === "return" && history.filter(h => h.status === 'borrowing').length > 0 && (
                  <div className="p-2.5 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-900/60 text-[11px] space-y-1.5">
                    <p className="font-semibold text-emerald-950 dark:text-emerald-200 flex items-center gap-1">
                      <span>💡 Gợi ý nhanh sách đang mượn cần thu hồi vào kho:</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {history.filter(h => h.status === 'borrowing').slice(0, 5).map((loan) => (
                        <Button
                          key={loan.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 py-0 border-emerald-400 bg-white dark:bg-zinc-900 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 font-mono shadow-2xs"
                          onClick={() => {
                            setSimulatedQrCode(loan.qr_code);
                            processScannedText(loan.qr_code);
                          }}
                        >
                          ⚡ Trả ngay: {loan.book_title?.slice(0, 16)}... ({loan.qr_code})
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
  );

  const activeLoans = history.filter(h => h.status === 'borrowing');
  const batchedLoanIds = activeBatchSlips.flatMap(s => s.loanIds);
  const unbatchedActiveLoans = activeLoans.filter(l => !batchedLoanIds.includes(l.id));
  const returnedLoans = history.filter(h => h.status === 'returned');
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

  // Modal hiển thị Mã QR Gom Trả Nhiều Cuốn Sách (Dành cho cả Độc giả & Nhân viên)
  const renderReturnBundleModal = () => {
    const targetSlip = viewingBatchSlip;
    const finalLoans: any[] = targetSlip
      ? targetSlip.books
      : (activeLoans.filter(l => selectedLoanIdsForReturn.includes(l.id)).length > 0
          ? activeLoans.filter(l => selectedLoanIdsForReturn.includes(l.id))
          : activeLoans);
    const finalLoanIds = finalLoans.map((l: any) => l.id);
    const batchCodeValue = targetSlip
      ? targetSlip.batchCode
      : `RETURN-BATCH-U${user?.id || 1}-${finalLoanIds.join(',')}`;

    return (
      <Dialog open={returnBundleModalOpen} onOpenChange={(open) => {
        setReturnBundleModalOpen(open);
        if (!open) setViewingBatchSlip(null);
      }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <QrCode className="h-5 w-5 text-emerald-600" />
              Mã QR Gom Trả Sách (${finalLoans.length} cuốn)
            </DialogTitle>
            <DialogDescription className="text-xs">
              {targetSlip?.createdAt ? (
                <span className="block mb-1 text-emerald-700 dark:text-emerald-400 font-medium">
                  🕒 Phiếu tạo lúc: {targetSlip.createdAt}
                </span>
              ) : null}
              Xuất trình mã QR này tại quầy để Thủ thư quét nhận trả đồng loạt tất cả các cuốn sách đã chọn
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center space-y-4 py-2">
            <div className="p-4 bg-white rounded-2xl border-2 border-emerald-500 shadow-sm flex flex-col items-center">
              <QRCodeCanvas
                id="return-batch-canvas"
                value={batchCodeValue}
                size={180}
                level="H"
                includeMargin={true}
                className="rounded-lg"
              />
              <code className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded mt-2 max-w-[240px] truncate">
                {batchCodeValue}
              </code>
            </div>

            <div className="flex items-center gap-2 w-full justify-center flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 cursor-pointer"
                onClick={() => handleDownloadQr("return-batch-canvas", `Ma-Tra-Gom-${finalLoans.length}-Cuon`)}
              >
                <Download className="h-3.5 w-3.5" /> Tải ảnh mã QR về máy
              </Button>

              {targetSlip && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-destructive hover:bg-destructive/10 gap-1.5 cursor-pointer"
                  onClick={() => handleCancelBatchSlip(targetSlip.batchCode)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hủy phiếu này
                </Button>
              )}
            </div>

            <div className="w-full bg-muted/40 rounded-xl p-3 space-y-1.5 text-xs max-h-40 overflow-y-auto border">
              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider mb-1">
                Danh sách sách trả (${finalLoans.length} cuốn):
              </p>
              {finalLoans.map((loan: any, idx: number) => (
                <div key={loan.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0 border-border/50">
                  <span className="truncate pr-2 font-medium">{idx + 1}. {loan.book_title}</span>
                  <code className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded shrink-0">{loan.qr_code}</code>
                </div>
              ))}
            </div>

            <div className="w-full p-2.5 rounded-xl bg-primary/5 border border-primary/10 text-[11px] text-muted-foreground text-center">
              💡 Bạn cũng có thể xuất trình trực tiếp <strong>Thẻ Độc Giả Vạn Năng</strong> kèm chồng sách vật lý tại quầy!
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setReturnBundleModalOpen(false);
              setViewingBatchSlip(null);
            }} className="w-full text-xs cursor-pointer">
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

    // =========================================================================
  // VIEW 1: ĐỘC GIẢ (READER) - GIAO DIỆN TỰ PHỤC VỤ & THẺ ĐỘC GIẢ VẠN NĂNG
  // =========================================================================
  if (user?.role === "reader") {
    return (
      <div className="space-y-4 sm:space-y-5">
        {/* Compact, Modern Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-primary/10 via-card to-emerald-500/10 border border-primary/20 shadow-xs">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-primary text-primary-foreground text-[10px] font-bold py-0.5">Thư Viện Số 4.0</Badge>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">2 Mã Cốt Lõi: Thẻ Độc Giả & Tem Gáy Sách</span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Mượn & Trả Sách Thông Minh
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
              Thẻ Độc Giả duy nhất (<code className="font-mono text-primary font-bold text-[11px]">{readerCardNumber}</code>) dùng cho Mượn, Trả & Ra cổng an ninh.
            </p>
          </div>

          {/* Quick Action Chips (Touch-friendly, wraps cleanly on mobile) */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                if (!myExitPassData) {
                  toast.info("Bạn chưa có biên lai mượn số nào đang hoạt động. Sau khi mượn sách thành công, biên lai điện tử sẽ tự động xuất hiện tại đây!");
                  return;
                }
                setExitPassModalOpen(true);
              }}
              size="sm"
              variant={myExitPassData ? "default" : "outline"}
              className={`h-8 text-xs font-bold gap-1.5 shadow-2xs cursor-pointer ${
                myExitPassData
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
                  : "border-emerald-400/60 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Biên Lai Số {myExitPassData ? `(${myExitPassData.book_count || 1} cuốn)` : ""}</span>
            </Button>

            <Button
              onClick={() => setSmartBookDropOpen(true)}
              variant="outline"
              size="sm"
              className="h-8 text-xs font-bold gap-1.5 border-sky-400 text-sky-800 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50 shadow-2xs cursor-pointer"
            >
              <Inbox className="h-3.5 w-3.5 text-sky-600" />
              <span>Trả Ngoài Giờ</span>
            </Button>

            {myActiveDraft?.all_verified ? (
              <Badge className="bg-emerald-600 text-white font-semibold text-xs h-8 px-2.5 gap-1.5 shadow-xs">
                <CheckCircle2 className="h-3.5 w-3.5" /> Sẵn sàng nhận sách!
              </Badge>
            ) : (
              <Button
                onClick={() => {
                  setScannerMode("shelf_scan_auto");
                  setSimulatedQrCode("");
                  setIsScannerOpen(true);
                }}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 h-8 shadow-xs cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" /> Quét Tem Sách
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => { fetchMyActiveDraft(); fetchMyBorrowRequests(); fetchMyReservations(); fetchHistory(); fetchMyExitPass(); }}
              className="h-8 text-xs gap-1 px-2.5 shadow-2xs hover:bg-primary/5 cursor-pointer"
              title="Đồng bộ dữ liệu"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Compact 4-Step Stepper (Tinh gọn, không chiếm diện tích dọc trên điện thoại) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <div className="p-2.5 sm:p-3 rounded-xl border bg-card/80 flex items-center gap-2.5 shadow-2xs">
            <span className="h-7 w-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">1</span>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">1. Soạn giỏ mượn</p>
              <p className="text-[10px] text-muted-foreground truncate hidden sm:block">Đăng ký online hoặc tại kệ</p>
            </div>
          </div>

          <div
            onClick={() => {
              setScannerMode("shelf_scan_auto");
              setSimulatedQrCode("");
              setIsScannerOpen(true);
            }}
            className={`p-2.5 sm:p-3 rounded-xl border flex items-center gap-2.5 shadow-2xs cursor-pointer hover:border-emerald-500 transition-all ${
              myActiveDraft 
                ? (myActiveDraft.all_verified ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200" : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200") 
                : "bg-card/80"
            }`}
          >
            <span className={`h-7 w-7 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
              myActiveDraft?.all_verified ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
            }`}>
              {myActiveDraft?.all_verified ? "✓" : "2"}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">2. Nhặt & Quét kệ</p>
              <p className="text-[10px] opacity-80 truncate hidden sm:block">
                {myActiveDraft ? `${myActiveDraft.verified_count || 0}/${myActiveDraft.items?.length || 0} đã quét` : "Bấm để quét tem"}
              </p>
            </div>
          </div>

          <div className={`p-2.5 sm:p-3 rounded-xl border flex items-center gap-2.5 shadow-2xs ${
            myActiveDraft?.all_verified ? "bg-emerald-600 text-white shadow-sm animate-pulse" : "bg-card/80"
          }`}>
            <span className={`h-7 w-7 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
              myActiveDraft?.all_verified ? "bg-white text-emerald-700" : "bg-muted text-muted-foreground"
            }`}>3</span>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">3. Nhận 1-Chạm</p>
              <p className="text-[10px] opacity-80 truncate hidden sm:block">
                {myActiveDraft?.all_verified ? "Chìa Thẻ nhận ngay!" : "Chìa Thẻ tại quầy"}
              </p>
            </div>
          </div>

          <div
            onClick={() => {
              if (activeBatchSlips.length > 0) {
                setViewingBatchSlip(activeBatchSlips[0]);
                setReturnBundleModalOpen(true);
              } else if (unbatchedActiveLoans.length > 0) {
                setSelectedLoanIdsForReturn(unbatchedActiveLoans.map(l => l.id));
                toast.info("Đã chọn toàn bộ sách chưa gom trả. Bấm 'Tạo Mã QR Trả Gom' ở bảng danh sách để tạo phiếu!");
              } else if (activeLoans.length > 0) {
                toast.info("Tất cả sách đã được gom vào phiếu trả chờ xuất trình!");
              }
            }}
            className={`p-2.5 sm:p-3 rounded-xl border flex items-center gap-2.5 shadow-2xs cursor-pointer hover:border-emerald-500 transition-all ${
              activeLoans.length > 0 ? "border-emerald-500/30 bg-emerald-500/5 hover:shadow-xs" : "bg-card/80"
            }`}
          >
            <span className="h-7 w-7 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">4</span>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">4. Trả sách linh hoạt</p>
              <p className="text-[10px] text-muted-foreground truncate hidden sm:block">
                {activeBatchSlips.length > 0
                  ? `${activeBatchSlips.length} phiếu gom đang chờ`
                  : activeLoans.length > 0
                    ? `Đang giữ ${activeLoans.length} cuốn`
                    : "Tại quầy hoặc Hòm ngoài giờ"}
              </p>
            </div>
          </div>
        </div>

        {/* Main 12-Column Responsive Layout: Left = Reader Pass (Sticky on desktop, first on mobile), Right = Draft & Books */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* CỘT TRÁI (Mobile: Trên cùng! Desktop: 4/12 cố định bên trái) */}
          <div className="lg:col-span-4 xl:col-span-4 space-y-4 lg:sticky lg:top-4">
            {/* THẺ ĐỘC GIẢ VẠN NĂNG (ALL-IN-ONE DIGITAL PASS) */}
            <Card className={`shadow-sm transition-all duration-300 overflow-hidden ${
              myExitPassData 
                ? "border-2 border-emerald-500 ring-4 ring-emerald-500/20 bg-gradient-to-b from-card via-emerald-500/5 to-emerald-500/10" 
                : myActiveDraft?.all_verified
                ? "border-2 border-primary ring-2 ring-primary/20 bg-gradient-to-b from-card to-primary/5"
                : "border-primary/30 bg-gradient-to-b from-card to-primary/5"
            }`}>
              <CardHeader className="pb-3 text-center border-b bg-muted/20">
                <div className="flex flex-col items-center gap-1.5">
                  {myExitPassData ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1 px-3 py-1 shadow-sm animate-pulse">
                      <FileSpreadsheet className="h-3.5 w-3.5" /> BIÊN LAI MƯỢN SÁCH ĐIỆN TỬ ({myExitPassData.book_count || 1} CUỐN)
                    </Badge>
                  ) : myActiveDraft?.all_verified ? (
                    <Badge className="bg-emerald-600 text-white font-bold text-xs gap-1 px-3 py-1 shadow-xs">
                      <Zap className="h-3.5 w-3.5" /> GIỎ SẴN SÀNG NHẬN SÁCH
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-xs font-semibold">
                      ⭐ Hộ Chiếu Thư Viện Số
                    </Badge>
                  )}
                  <CardTitle className="font-display text-base font-bold flex items-center justify-center gap-2 mt-1">
                    <QrCode className="h-5 w-5 text-primary" /> Thẻ Độc Giả Vạn Năng
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Mã duy nhất dùng cho Mượn, Trả & Tra cứu biên lai điện tử
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 sm:p-5 flex flex-col items-center space-y-3.5">
                {/* Dynamic Alert Banner based on status */}
                {myExitPassData && (
                  <div className="w-full p-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md text-center space-y-0.5">
                    <p className="font-bold text-xs flex items-center justify-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> BIÊN LAI MƯỢN SÁCH HỢP LỆ
                    </p>
                    <p className="text-[11px] text-emerald-100">
                      Đã mượn: <strong>{myExitPassData.book_count || 1} cuốn sách</strong> • Hiệu lực đối soát: {myExitPassData.minutesLeft || 30} phút
                    </p>
                    <p className="text-[10px] text-emerald-200">
                      Nhân viên thư viện có thể quét mã QR thẻ này để tra cứu nhanh biên lai!
                    </p>
                  </div>
                )}

                {myActiveDraft?.all_verified && !myExitPassData && (
                  <div className="w-full p-2.5 rounded-xl bg-gradient-to-r from-emerald-600/90 to-teal-600/90 text-white shadow-xs text-center space-y-0.5">
                    <p className="font-bold text-xs flex items-center justify-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> SẴN SÀNG NHẬN SÁCH
                    </p>
                    <p className="text-[10px] text-emerald-100">
                      Đưa mã thẻ này cho Thủ thư để duyệt phiếu trong 3 giây!
                    </p>
                  </div>
                )}

                {/* QR Canvas */}
                <div className={`p-3 bg-white rounded-2xl shadow-sm border-2 flex flex-col items-center transition-all ${
                  myExitPassData ? "border-emerald-500 ring-2 ring-emerald-400" : "border-primary/20"
                }`}>
                  <QRCodeCanvas
                    id="reader-card-canvas"
                    value={readerCardNumber}
                    size={160}
                    level="H"
                    includeMargin={true}
                    className="rounded-lg"
                  />
                  <div className="flex items-center gap-1.5 mt-2">
                    <code className="text-sm font-bold text-primary tracking-wider px-2 py-0.5 bg-primary/10 rounded-md inline-block">
                      {readerCardNumber}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => {
                        navigator.clipboard.writeText(readerCardNumber);
                        toast.success(`Đã sao chép mã thẻ: ${readerCardNumber}`);
                      }}
                      title="Sao chép mã thẻ"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
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
                    <span className="font-medium text-foreground truncate max-w-[170px]">{readerEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Trạng thái:</span>
                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50">
                      <CheckCircle className="h-2.5 w-2.5 mr-1" /> Đang hoạt động
                    </Badge>
                  </div>
                </div>

                {/* Collapsible Regulations Accordion */}
                <details className="w-full rounded-xl border bg-card/60 p-2.5 text-xs cursor-pointer group">
                  <summary className="font-semibold text-foreground text-[11px] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">📜 Quy Định Mượn Sách</span>
                    <span className="text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 space-y-1.5 text-muted-foreground text-[11px] leading-relaxed border-t pt-2">
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0">📚</span>
                      <span><strong>Giới hạn:</strong> tối đa <strong>5 cuốn/độc giả</strong>.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>⏰</span>
                      <span><strong>Thời hạn:</strong> <strong>14 ngày</strong> / cuốn.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>🔄</span>
                      <span><strong>Gia hạn:</strong> <strong>1 lần (+7 ngày)</strong> nếu không ai chờ.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>✅</span>
                      <span><strong>Trả sách:</strong> Xong được mượn ngay lập tức.</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0">⚠️</span>
                      <span><strong>Khóa mượn:</strong> Khi có sách quá hạn hoặc nợ phạt.</span>
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          </div>

          {/* CỘT PHẢI (Desktop: 8/12, Mobile: Tiếp sau Thẻ Độc Giả) */}
          <div className="lg:col-span-8 xl:col-span-8 space-y-4 sm:space-y-5">
            {/* Banner cảnh báo nếu độc giả có sách quá hạn */}
            {activeLoans.some(l => getDueStatus(l.due_date).isOverdue) && (
              activeLoans.filter(l => getDueStatus(l.due_date).isOverdue).every(l => l.fine_already_paid) ? (
                <div className="p-3.5 sm:p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
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
                <div className="p-3.5 sm:p-4 bg-destructive/10 border border-destructive/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-destructive">
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

            {/* Active Draft Transaction Card for Reader */}
            {myActiveDraft && (
              <Card className={`border-2 shadow-md overflow-hidden transition-all ${myActiveDraft.all_verified ? "border-emerald-500 bg-gradient-to-r from-emerald-500/10 via-card to-emerald-500/10" : "border-primary/40 bg-gradient-to-r from-primary/10 via-card to-accent/10"}`}>
                <CardHeader className={`pb-3 border-b ${myActiveDraft.all_verified ? "bg-emerald-500/10" : "bg-primary/5"}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl text-white shadow-sm shrink-0 ${myActiveDraft.all_verified ? "bg-emerald-600 animate-pulse" : "bg-primary"}`}>
                        <Zap className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className={`font-display text-base font-bold ${myActiveDraft.all_verified ? "text-emerald-700 dark:text-emerald-300" : "text-primary"}`}>
                            {myActiveDraft.all_verified ? "GIỎ MƯỢN ĐÃ SẴN SÀNG" : "Phiếu Mượn Online - Tự Đối Soát Tại Kệ"}
                          </CardTitle>
                          <code className="px-2 py-0.5 bg-background rounded-md border text-xs font-mono font-bold text-primary">
                            {myActiveDraft.draft_code}
                          </code>
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold text-[11px] gap-1">
                            <Clock className="h-3 w-3 text-amber-600" /> Còn {myActiveDraft.time_left_hours ?? 24}h
                          </Badge>
                        </div>
                        <CardDescription className="text-xs mt-0.5">
                          {myActiveDraft.all_verified 
                            ? "🎉 Bạn đã đối soát xong toàn bộ sách. Chỉ cần xuất trình Thẻ Độc Giả bên cạnh cho Thủ thư quét để nhận sách trong 3s!"
                            : `Đến đúng vị trí kệ theo danh sách bên dưới và bấm "Quét" để tự đối soát trước khi ra quầy.`}
                        </CardDescription>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1 cursor-pointer"
                        onClick={() => handleCancelReaderDraft(myActiveDraft.id)}
                      >
                        <X className="h-3.5 w-3.5" /> Hủy phiếu
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 items-center">
                    {/* Left: Action & Guidance Panel (Hội tụ về Thẻ Độc Giả duy nhất) */}
                    {myActiveDraft.all_verified ? (
                      <div className="flex flex-col items-center justify-center p-4 sm:p-5 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-teal-500/10 rounded-2xl border-2 border-emerald-500 shadow-sm space-y-3 text-center">
                        <div className="h-14 w-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md animate-pulse">
                          <CheckCircle2 className="h-8 w-8" />
                        </div>
                        <div>
                          <Badge className="bg-emerald-600 text-white font-bold text-xs px-2.5 py-1 shadow-xs">
                            ✓ ĐÃ ĐỐI SOÁT ĐỦ {myActiveDraft.items?.length || 0} CUỐN
                          </Badge>
                          <h4 className="font-bold text-sm text-foreground mt-2">
                            Sẵn Sàng Ra Quầy Nhận Sách!
                          </h4>
                          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                            Mang sách ra quầy và <strong>chỉ cần xuất trình Thẻ Thư Viện</strong> cho Thủ thư quét là hoàn tất.
                          </p>
                        </div>

                        {/* Tùy chọn xem mã QR phụ dự phòng */}
                        <div className="pt-2 w-full border-t border-emerald-500/20">
                          <details className="text-[11px] text-muted-foreground cursor-pointer group">
                            <summary className="font-medium text-emerald-700 dark:text-emerald-300 hover:underline flex items-center justify-center gap-1">
                              <QrCode className="h-3 w-3" /> Xem mã phiếu phụ ({myActiveDraft.draft_code})
                            </summary>
                            <div className="mt-2.5 flex flex-col items-center bg-white p-3 rounded-xl border shadow-inner">
                              <QRCodeCanvas
                                id={`draft-qr-canvas-page-${myActiveDraft.draft_code}`}
                                value={myActiveDraft.draft_code}
                                size={120}
                                level="H"
                                includeMargin={true}
                                className="rounded-lg"
                              />
                              <code className="text-[10px] font-mono font-bold text-primary mt-1">
                                {myActiveDraft.draft_code}
                              </code>
                            </div>
                          </details>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 sm:p-5 bg-amber-500/10 rounded-2xl border-2 border-amber-400/50 shadow-sm space-y-3 text-center">
                        <div className="h-12 w-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
                          <Camera className="h-6 w-6" />
                        </div>
                        <div>
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs">
                            Đang đối soát tại kệ: {myActiveDraft.verified_count || 0}/{myActiveDraft.items?.length || 0}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                            Đến đúng vị trí kệ theo danh sách bên cạnh và bấm "Quét" để tự đối soát trước khi ra quầy.
                          </p>
                        </div>
                        <Button
                          onClick={() => {
                            setScannerMode("shelf_scan_auto");
                            setSimulatedQrCode("");
                            setIsScannerOpen(true);
                          }}
                          className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 h-8 font-semibold shadow-xs"
                        >
                          <Camera className="h-3.5 w-3.5" /> Quét Tem Sách Tại Kệ
                        </Button>
                      </div>
                    )}

                    {/* Right: Book items list with shelf locations & verification state */}
                    <div className="md:col-span-2 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                        <span className="flex items-center gap-1.5">
                          <span>Danh sách {myActiveDraft.items?.length || 0} cuốn:</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {myActiveDraft.verified_count || 0}/{myActiveDraft.items?.length || 0} đã quét
                          </Badge>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                          onClick={() => {
                            setScannerMode("shelf_scan_auto");
                            setSimulatedQrCode("");
                            setIsScannerOpen(true);
                          }}
                        >
                          <Camera className="h-3 w-3 text-emerald-600" /> Quét tại kệ
                        </Button>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {myActiveDraft.items?.map((item: any, idx: number) => {
                          const isVerified = Boolean(item.book_copy_id);
                          return (
                            <div
                              key={item.item_id || item.id || idx}
                              className={`p-2.5 bg-background border rounded-xl flex items-center justify-between gap-2.5 text-xs shadow-2xs transition-colors ${isVerified ? "border-emerald-500/40 bg-emerald-50/10 dark:bg-emerald-950/20" : "hover:border-primary/40"}`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`h-5 w-5 rounded-full font-bold text-[11px] flex items-center justify-center shrink-0 ${isVerified ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"}`}>
                                  {isVerified ? "✓" : idx + 1}
                                </span>
                                {item.cover_image ? (
                                  <img src={item.cover_image} alt={item.book_title} className="h-9 w-7 object-cover rounded shrink-0 shadow-2xs" />
                                ) : (
                                  <div className="h-9 w-7 bg-muted rounded flex items-center justify-center text-xs shrink-0">📚</div>
                                )}
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground truncate">{item.book_title}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground truncate">ISBN: {item.isbn || "N/A"}</span>
                                    {isVerified ? (
                                      <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-1.5 h-4 gap-0.5">
                                        <Check className="h-2.5 w-2.5" /> {item.copy_qr_code}
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/40 text-[10px] py-0 px-1.5 h-4">
                                        Chưa quét
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-[10px] sm:text-[11px] gap-1 px-2 border-primary/30 text-primary hover:bg-primary/10 font-medium cursor-pointer"
                                  onClick={() => handleOpenMiniMap({ location: item.location, title: item.book_title, cover: item.cover_image })}
                                  title="Xem sơ đồ vị trí kệ sách"
                                >
                                  <span>📍</span>
                                  <span className="truncate max-w-[80px] sm:max-w-[110px]">{item.location || "Kệ sách"}</span>
                                  <span className="text-primary font-semibold">🗺️</span>
                                </Button>

                                {!isVerified && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 text-[10px] sm:text-[11px] gap-1 px-2 font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 cursor-pointer"
                                    onClick={() => {
                                      setScannerMode("shelf_scan_auto");
                                      setSimulatedQrCode("");
                                      setIsScannerOpen(true);
                                    }}
                                  >
                                    <Camera className="h-3 w-3" /> Quét
                                  </Button>
                                )}

                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveDraftItem(item.item_id || item.id)}
                                  title="Xóa cuốn sách này khỏi phiếu"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className={`p-2 rounded-xl border text-[11px] ${myActiveDraft.all_verified ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-200 font-medium" : "bg-primary/5 border-primary/10 text-muted-foreground"}`}>
                        {myActiveDraft.all_verified ? (
                          <span>⭐ <strong>Hoàn tất Bước 2!</strong> Bạn đã tự đối soát đủ {myActiveDraft.items?.length || 0} cuốn sách. Mang sách ra quầy và xuất trình Thẻ Độc Giả bên cạnh cho Thủ thư quét là xong!</span>
                        ) : (
                          <span>💡 Đến các kệ sách ở trên, dùng camera quét mã để đối soát sách trước khi ra quầy nhận sách.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KHU VỰC 2: QUẢN LÝ MƯỢN - TRẢ & LỊCH SỬ PHIẾU MƯỢN */}
            <Card className="border-border/80 shadow-xs">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="font-display text-base flex items-center gap-2">
                      <BookMarked className="h-5 w-5 text-primary" /> Quản Lý Mượn - Trả & Lịch Sử
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Theo dõi hạn trả, gia hạn sách và tra cứu toàn bộ lịch sử các lần mượn trả
                    </CardDescription>
                  </div>

                  {/* Tabs Switcher for Reader */}
                  <div className="flex items-center gap-1 bg-muted/80 p-1 rounded-xl border border-border/70 shrink-0">
                    <Button
                      size="sm"
                      variant={readerHistoryTab === "borrowing" ? "default" : "ghost"}
                      className="h-7 text-xs font-semibold gap-1.5 px-2.5 rounded-lg transition-all"
                      onClick={() => setReaderHistoryTab("borrowing")}
                    >
                      <span>Đang mượn</span>
                      <Badge variant={readerHistoryTab === "borrowing" ? "secondary" : "outline"} className="text-[10px] px-1 py-0 h-4">
                        {activeLoans.length}
                      </Badge>
                    </Button>
                    <Button
                      size="sm"
                      variant={readerHistoryTab === "returned" ? "default" : "ghost"}
                      className="h-7 text-xs font-semibold gap-1.5 px-2.5 rounded-lg transition-all"
                      onClick={() => setReaderHistoryTab("returned")}
                    >
                      <span>Lịch sử đã trả</span>
                      <Badge variant={readerHistoryTab === "returned" ? "secondary" : "outline"} className="text-[10px] px-1 py-0 h-4">
                        {returnedLoans.length}
                      </Badge>
                    </Button>
                    <Button
                      size="sm"
                      variant={readerHistoryTab === "all" ? "default" : "ghost"}
                      className="h-7 text-xs font-semibold gap-1.5 px-2 rounded-lg transition-all"
                      onClick={() => setReaderHistoryTab("all")}
                    >
                      <span>Tất cả</span>
                      <Badge variant={readerHistoryTab === "all" ? "secondary" : "outline"} className="text-[10px] px-1 py-0 h-4">
                        {history.length}
                      </Badge>
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-4 space-y-4">
                {/* Hướng Dẫn Trả Sách Rõ Ràng Cho Độc Giả */}
                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-primary/5 to-emerald-500/5 text-xs text-foreground flex items-start gap-3 shadow-2xs">
                  <div className="p-2 rounded-lg bg-emerald-600 text-white shrink-0 mt-0.5">
                    <ArrowRightLeft className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-emerald-900 dark:text-emerald-300">
                        📍 Trả sách ở đâu?
                      </p>
                      <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-2 h-4">
                        Quầy Thủ Thư (Bàn Lưu Thông - Tầng 1)
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Khi cần hoàn trả sách, bạn vui lòng mang cuốn sách vật lý đến <strong>Quầy Thủ Thư (Bàn Lưu Thông - Tầng 1)</strong>. Thủ thư sẽ dùng máy quét lướt qua tem mã QR dán trên gáy sách đúng <strong>1 giây</strong> để kiểm đếm thu hồi và giải phóng hạn mức mượn cho bạn ngay lập tức!
                    </p>
                  </div>
                </div>

                {/* TAB 1: SÁCH ĐANG MƯỢN */}
                {readerHistoryTab === "borrowing" && (
                  <div>
                    {activeLoans.length === 0 ? (
                      <div className="text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border/80">
                        <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                        <p className="text-xs font-medium text-foreground">Bạn hiện không có sách nào đang mượn</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Hãy chọn sách tại kệ hoặc đăng ký mượn online để nhận sách đọc nhé!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* 1. DANH SÁCH CÁC PHIẾU GOM TRẢ ĐANG CHỜ XUẤT TRÌNH TẠI QUẦY */}
                        {activeBatchSlips.length > 0 && (
                          <div className="p-3.5 sm:p-4 rounded-xl border-2 border-emerald-500/40 bg-emerald-50/25 dark:bg-emerald-950/25 space-y-3 shadow-xs">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-2.5">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                                  <QrCode className="h-4 w-4" />
                                </div>
                                <div>
                                  <h4 className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5">
                                    Phiếu Gom Trả Đang Chờ Xuất Trình
                                    <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.2">
                                      {activeBatchSlips.length} phiếu
                                    </Badge>
                                  </h4>
                                  <p className="text-[11px] text-muted-foreground">
                                    Bấm "Xuất trình QR" để đưa thủ thư quét 1 chạm tại quầy trả sách
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-2">
                              {activeBatchSlips.map((slip, idx) => (
                                <div key={slip.batchCode} className="p-3 rounded-lg border border-emerald-500/30 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                                  <div className="space-y-1.5 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-xs text-foreground">
                                        Phiếu #{idx + 1} ({slip.books.length} cuốn)
                                      </span>
                                      <code className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 rounded font-semibold">
                                        {slip.batchCode}
                                      </code>
                                      <span className="text-[10px] text-muted-foreground">
                                        🕒 {slip.createdAt}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                                      {slip.books.map((b) => (
                                        <span key={b.id} className="inline-flex items-center gap-1 bg-muted/80 px-2 py-0.5 rounded text-[11px] text-foreground font-medium border border-border/50">
                                          📖 {b.book_title} <code className="text-[10px] text-muted-foreground font-mono">({b.qr_code})</code>
                                        </span>
                                      ))}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                    <Button
                                      size="sm"
                                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-7 gap-1 shadow-2xs cursor-pointer"
                                      onClick={() => {
                                        setViewingBatchSlip(slip);
                                        setReturnBundleModalOpen(true);
                                      }}
                                    >
                                      <QrCode className="h-3 w-3" /> Xuất trình QR
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:bg-destructive/10 text-xs h-7 gap-1 cursor-pointer"
                                      onClick={() => handleCancelBatchSlip(slip.batchCode)}
                                    >
                                      <Trash2 className="h-3 w-3" /> Hủy phiếu
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 2. THANH CÔNG CỤ CHỌN SÁCH TẠO PHIẾU GOM MỚI */}
                        {unbatchedActiveLoans.length > 0 ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-muted/40 border border-emerald-500/30 rounded-xl shadow-2xs">
                            <div className="flex items-center gap-2.5">
                              <Checkbox
                                id="select-all-loans"
                                checked={unbatchedActiveLoans.length > 0 && selectedLoanIdsForReturn.length === unbatchedActiveLoans.length}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedLoanIdsForReturn(unbatchedActiveLoans.map(l => l.id));
                                  } else {
                                    setSelectedLoanIdsForReturn([]);
                                  }
                                }}
                              />
                              <label htmlFor="select-all-loans" className="text-xs font-semibold cursor-pointer select-none">
                                Chọn sách mang trả hôm nay ({selectedLoanIdsForReturn.length}/{unbatchedActiveLoans.length} cuốn chưa gom)
                              </label>
                            </div>

                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 h-8 shadow-xs cursor-pointer"
                              disabled={selectedLoanIdsForReturn.length === 0}
                              onClick={handleCreateBatchSlip}
                            >
                              <QrCode className="h-3.5 w-3.5" /> ⚡ Tạo Mã QR Trả Gom ({selectedLoanIdsForReturn.length} cuốn)
                            </Button>
                          </div>
                        ) : (
                          <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-500/20 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-medium">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                              Tất cả <strong>{activeLoans.length} cuốn</strong> sách đang mượn đã được gom vào {activeBatchSlips.length} phiếu trả chờ xuất trình tại quầy!
                            </span>
                          </div>
                        )}

                        {activeLoans.map((loan) => {
                          const dueStatus = getDueStatus(loan.due_date);
                          const isOverdue = dueStatus.isOverdue;
                          const hasRenewed = (loan.renewal_count || 0) >= 1;
                          const batchedSlip = activeBatchSlips.find(s => s.loanIds.includes(loan.id));
                          const isBatched = Boolean(batchedSlip);
                          const isSelected = selectedLoanIdsForReturn.includes(loan.id);

                          return (
                            <div key={loan.id} className={`p-3.5 rounded-xl border text-xs space-y-2.5 shadow-xs transition-colors ${
                              isBatched
                                ? "border-emerald-500/60 bg-emerald-50/15 dark:bg-emerald-950/15"
                                : isSelected
                                  ? "border-emerald-500/50 bg-emerald-50/10 dark:bg-emerald-950/10"
                                  : "bg-card hover:border-primary/40"
                            }`}>
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  <div className="pt-3.5 shrink-0">
                                    {isBatched ? (
                                      <div
                                        className="h-4 w-4 rounded bg-emerald-600 text-white flex items-center justify-center cursor-pointer shadow-2xs"
                                        title={`Sách này đã nằm trong phiếu gom #${batchedSlip?.batchCode}. Bấm để xem mã QR.`}
                                        onClick={() => {
                                          if (batchedSlip) {
                                            setViewingBatchSlip(batchedSlip);
                                            setReturnBundleModalOpen(true);
                                          }
                                        }}
                                      >
                                        <Check className="h-3 w-3 stroke-[3]" />
                                      </div>
                                    ) : (
                                      <Checkbox
                                        id={`loan-check-${loan.id}`}
                                        checked={isSelected}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            setSelectedLoanIdsForReturn(prev => [...prev, loan.id]);
                                          } else {
                                            setSelectedLoanIdsForReturn(prev => prev.filter(id => id !== loan.id));
                                          }
                                        }}
                                      />
                                    )}
                                  </div>
                                  <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                    {loan.cover_image ? (
                                      <img src={loan.cover_image} alt={loan.book_title} className="h-full w-full object-cover" />
                                    ) : (
                                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    <p className="font-semibold text-sm text-foreground break-words">{loan.book_title}</p>
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
                                      {isBatched && (
                                        <Badge
                                          className="bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] font-semibold gap-1 cursor-pointer"
                                          onClick={() => {
                                            if (batchedSlip) {
                                              setViewingBatchSlip(batchedSlip);
                                              setReturnBundleModalOpen(true);
                                            }
                                          }}
                                        >
                                          <QrCode className="h-3 w-3" /> Đã tạo phiếu gom
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">
                                      Mượn ngày: <strong>{new Date(loan.borrow_date).toLocaleDateString("vi-VN")}</strong> • Hạn trả: <span className={dueStatus.isOverdue ? "text-destructive font-bold" : "font-semibold text-foreground"}>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span>
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 pl-14 sm:pl-0 flex-wrap">
                                  {isBatched && batchedSlip && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs h-7 gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer"
                                      onClick={() => {
                                        setViewingBatchSlip(batchedSlip);
                                        setReturnBundleModalOpen(true);
                                      }}
                                    >
                                      <QrCode className="h-3 w-3" /> Xem QR phiếu
                                    </Button>
                                  )}
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

                              <div className="pt-2 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-muted-foreground">
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
                  </div>
                )}

                {/* TAB 2: LỊCH SỬ ĐÃ TRẢ */}
                {readerHistoryTab === "returned" && (
                  <div>
                    {returnedLoans.length === 0 ? (
                      <div className="text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border/80">
                        <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                        <p className="text-xs font-medium text-foreground">Bạn chưa có lịch sử trả sách nào</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Các cuốn sách sau khi hoàn trả thành công tại quầy sẽ được lưu trữ đầy đủ tại đây.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {returnedLoans.map((record) => {
                          const returnDate = record.return_date ? new Date(record.return_date) : null;
                          const dueDate = new Date(record.due_date);
                          const isOverdueReturn = returnDate && returnDate.getTime() > dueDate.getTime();

                          return (
                            <div key={record.id} className="p-3.5 rounded-xl border bg-card text-xs space-y-2 shadow-xs hover:border-border transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center opacity-85">
                                    {record.cover_image ? (
                                      <img src={record.cover_image} alt={record.book_title} className="h-full w-full object-cover" />
                                    ) : (
                                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-semibold text-sm text-foreground">{record.book_title}</p>
                                      <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-2 h-4 gap-0.5">
                                        <Check className="h-2.5 w-2.5" /> Đã trả lại kho
                                      </Badge>
                                      {isOverdueReturn ? (
                                        <Badge variant="outline" className="border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-[10px] py-0 px-1.5 h-4">
                                          Trả trễ hạn
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-[10px] py-0 px-1.5 h-4">
                                          Đúng hạn
                                        </Badge>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                      <span className="font-mono bg-muted/60 px-1.5 py-0.5 rounded border text-[10px]">
                                        🏷️ {record.qr_code}
                                      </span>
                                      <span>•</span>
                                      <span>Mượn: <strong>{new Date(record.borrow_date).toLocaleDateString("vi-VN")}</strong></span>
                                      <span>•</span>
                                      <span>Hạn trả: {dueDate.toLocaleDateString("vi-VN")}</span>
                                      <span>•</span>
                                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                        Đã trả ngày: <strong>{returnDate ? returnDate.toLocaleDateString("vi-VN") : "Đã hoàn tất"}</strong>
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  {record.fine_amount && record.fine_amount > 0 ? (
                                    <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">
                                      Phí phạt: {record.fine_amount.toLocaleString("vi-VN")}đ
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground font-mono">Không phạt</span>
                                  )}
                                </div>
                              </div>

                              <div className="pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>Thủ thư tiếp nhận trả: <strong>{record.processed_by_name || "Quầy lưu thông"}</strong></span>
                                <span className="font-mono text-[10px]">Mã phiếu #{record.id}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 3: TẤT CẢ (LỊCH SỬ TOÀN BỘ) */}
                {readerHistoryTab === "all" && (
                  <div className="space-y-3">
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">Bạn chưa có giao dịch mượn trả nào</p>
                    ) : (
                      history.map((record) => {
                        const isReturned = record.status === "returned";
                        const dueStatus = getDueStatus(record.due_date);
                        return (
                          <div key={record.id} className="p-3 rounded-xl border bg-card text-xs flex items-center justify-between gap-3 shadow-2xs">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-8 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                                {record.cover_image ? (
                                  <img src={record.cover_image} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <BookOpen className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground truncate">{record.book_title}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {isReturned ? (
                                    <span>Đã trả ngày {record.return_date ? new Date(record.return_date).toLocaleDateString("vi-VN") : "Đã trả"}</span>
                                  ) : (
                                    <span>Hạn trả: <strong className={dueStatus.isOverdue ? "text-destructive" : ""}>{new Date(record.due_date).toLocaleDateString("vi-VN")}</strong></span>
                                  )}
                                  {" • "}Mã bản sao: <code className="font-mono">{record.qr_code}</code>
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              {isReturned ? (
                                <Badge className="bg-emerald-600 text-white text-[10px]">Đã trả</Badge>
                              ) : (
                                <Badge variant={dueStatus.variant} className="text-[10px]">{dueStatus.text}</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        {ConfirmDialogComponent}

        {/* Mini Map Navigation Modal for Reader */}
        <LibraryMiniMapModal
          open={miniMapOpen}
          onOpenChange={setMiniMapOpen}
          location={miniMapTarget?.location}
          bookTitle={miniMapTarget?.title}
          authorName={miniMapTarget?.author}
          coverImage={miniMapTarget?.cover}
        />

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

        {/* Modal tạo mã QR gom trả nhiều cuốn sách */}
        {renderReturnBundleModal()}

        {/* Scanner Modal for Reader (Mượn trực tiếp tại kệ & Đối soát sách) */}
        {renderScannerModal()}

        {/* Smart Library 4.0: Exit Pass Modal for Reader */}
        <ExitPassModal
          open={exitPassModalOpen}
          onOpenChange={setExitPassModalOpen}
          passData={myExitPassData}
        />

        {/* Smart Library 4.0: Smart Book Drop 24/7 Modal for Reader */}
        <SmartBookDropModal
          open={smartBookDropOpen}
          onOpenChange={setSmartBookDropOpen}
          onSuccess={() => {
            fetchHistory();
          }}
          myBorrowingBooks={history.filter(h => h.status === 'borrowing')}
        />

        {/* Hidden QR reader for scanning uploaded image files */}
        <div id="hidden-qr-reader" className="hidden"></div>
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
      {/* 1. Thanh Chuyển Đổi Quầy Lưu Thông Phân Luồng Chuyên Nghiệp */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-card via-muted/30 to-card border shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-[11px] font-semibold">
              <Sparkles className="h-3 w-3 mr-1 text-primary" /> Quầy Lưu Thông Phân Luồng Chuyên Nghiệp
            </Badge>
            <span className="text-xs text-muted-foreground">• Thủ thư & Quản trị viên</span>
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {stationMode === "checkout" && (
              <>
                <Zap className="h-6 w-6 text-primary" /> Quầy Xuất Mượn Sách (Checkout Wizard)
              </>
            )}
            {stationMode === "return" && (
              <>
                <ArrowRightLeft className="h-6 w-6 text-primary" /> Quầy Nhận Trả Sách & Hòm Ngoài Giờ
              </>
            )}
            {stationMode === "history" && (
              <>
                <FileSpreadsheet className="h-6 w-6 text-primary" /> Sổ Theo Dõi Lưu Thông & Đối Soát
              </>
            )}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stationMode === "checkout" && "Quy trình xuất mượn 3 bước chuẩn hóa: Nhận diện độc giả → Duyệt sách → Cấp biên lai số."}
            {stationMode === "return" && "Quét nhận sách trả vào kho, xử lý phạt quá hạn và kiểm đếm hòm trả sách 24/7."}
            {stationMode === "history" && "Nhật ký lưu thông toàn thư viện, phân tích trạng thái và đối soát biên lai ra cửa."}
          </p>
        </div>

        {/* Station Mode Switcher Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex p-1 bg-muted/80 rounded-xl border shadow-inner">
            <button
              type="button"
              onClick={() => setStationMode("checkout")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                stationMode === "checkout"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Xuất Mượn</span>
              {pendingDrafts.length > 0 && (
                <Badge className="ml-0.5 bg-amber-500 text-white text-[10px] h-4.5 px-1.5 rounded-full font-bold">
                  {pendingDrafts.length}
                </Badge>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStationMode("return")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                stationMode === "return"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>Nhận Trả Sách</span>
              {dropBoxPendingCount > 0 && (
                <Badge className="ml-0.5 bg-sky-500 text-white text-[10px] h-4.5 px-1.5 rounded-full font-bold animate-bounce">
                  {dropBoxPendingCount}
                </Badge>
              )}
            </button>

            <button
              type="button"
              onClick={() => setStationMode("history")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                stationMode === "history"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Sổ Lưu Thông</span>
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchHistory();
              fetchMyBorrowRequests();
              fetchDropBoxCount();
            }}
            className="h-9 text-xs gap-1.5 shadow-2xs hover:bg-primary/5 cursor-pointer"
            title="Đồng bộ dữ liệu"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* =========================================================================
          TRẠM 1: QUẦY XUẤT MƯỢN SÁCH (CHECKOUT WIZARD)
          ========================================================================= */}
      {stationMode === "checkout" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Thanh Tiến Trình 3 Bước (3-Step Guided Wizard Stepper) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-gradient-to-r from-card via-muted/20 to-card rounded-2xl border shadow-xs">
            {/* Bước 1 */}
            <div
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                scannedReaderInfo
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                  : "bg-primary/10 border-primary/40 text-primary"
              }`}
            >
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  scannedReaderInfo
                    ? "bg-emerald-600 text-white"
                    : "bg-primary text-primary-foreground shadow-xs"
                }`}
              >
                {scannedReaderInfo ? <Check className="h-4 w-4" /> : "1"}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight flex items-center gap-1.5">
                  1. Nhận diện Độc Giả
                  {scannedReaderInfo && <Badge variant="outline" className="text-[9px] py-0 px-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700">Đã mở phiên</Badge>}
                </p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {scannedReaderInfo ? scannedReaderInfo.reader.full_name : "Quét mã thẻ / Tra cứu tài khoản"}
                </p>
              </div>
            </div>

            {/* Bước 2 */}
            <div
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                !scannedReaderInfo
                  ? "bg-card/50 border-border/40 text-muted-foreground opacity-60"
                  : "bg-primary/10 border-primary/40 text-primary"
              }`}
            >
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  !scannedReaderInfo
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground shadow-xs"
                }`}
              >
                2
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight">2. Đối Soát & Chọn Sách</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {scannedReaderInfo?.activeDraft
                    ? `Phiếu chờ (${scannedReaderInfo.activeDraft.items?.length || 0} cuốn)`
                    : scannedReaderInfo?.readyReservations && scannedReaderInfo.readyReservations.length > 0
                    ? `Có ${scannedReaderInfo.readyReservations.length} sách đặt trước`
                    : scannedReaderInfo
                    ? "Quét mã gáy sách độc giả mang tới"
                    : "Chờ tiếp nhận độc giả"}
                </p>
              </div>
            </div>

            {/* Bước 3 */}
            <div
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                !scannedReaderInfo
                  ? "bg-card/50 border-border/40 text-muted-foreground opacity-60"
                  : "bg-card border-border/80 text-foreground"
              }`}
            >
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  !scannedReaderInfo
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted border text-foreground"
                }`}
              >
                3
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight">3. Xuất Kho & Cấp Biên Lai</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  Phê duyệt 1-chạm & Cấp mã ra cổng
                </p>
              </div>
            </div>
          </div>

          {/* TRƯỜNG HỢP 1: CHƯA MỞ PHIÊN ĐỘC GIẢ (BƯỚC 1: TIẾP NHẬN) */}
          {!scannedReaderInfo ? (
            <div className="space-y-6">
              {/* Terminal Quét & Tìm Kiếm Độc Giả */}
              <Card className="border shadow-xs overflow-hidden">
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <CardTitle className="font-display text-base font-bold flex items-center gap-2">
                        <UserCheck className="h-4.5 w-4.5 text-primary" /> Bước 1: Tiếp Nhận & Quét Thẻ Độc Giả
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Quét mã thẻ thư viện (LIB-RD-...), nhập số điện thoại hoặc mã phiếu mượn online (DRAFT-BRW-xxxx) để mở phiên
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="text-xs text-primary border-primary/30 gap-1 font-mono">
                      <Zap className="h-3 w-3 text-primary" /> Quầy Xuất Mượn Sẵn Sàng
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                    <div className="relative flex-1">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Quét mã thẻ (LIB-RD-...), mã QR phiếu (DRAFT-BRW-xxxx), hoặc SĐT độc giả..."
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
                          toast.info("Vui lòng quét hoặc nhập mã thẻ độc giả hoặc mã phiếu mượn");
                        }
                      }}
                      size="sm"
                      className="h-10 px-4 text-xs font-semibold gap-1.5 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer"
                    >
                      <Search className="h-3.5 w-3.5" /> Mở Phiên Độc Giả
                    </Button>

                    <Button
                      onClick={() => openScannerModal("desk_auto")}
                      size="sm"
                      variant="outline"
                      className="h-10 px-3.5 text-xs font-semibold gap-1.5 shrink-0 border-primary/30 text-primary hover:bg-primary/10 shadow-2xs cursor-pointer"
                    >
                      <Camera className="h-3.5 w-3.5" /> Quét Camera
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Hàng Đợi Phiếu Mượn Chờ Tiếp Nhận Tại Quầy */}
              <Card className="border shadow-xs overflow-hidden">
                <CardHeader className="pb-3 border-b bg-primary/5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-foreground">
                        <Zap className="h-4 w-4 text-primary" /> Hàng Đợi Phiếu Mượn Online Chờ Tiếp Nhận Tại Quầy
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Bạn đọc đã đăng ký mượn online qua hệ thống và đang tới quầy nhận sách trong thời hạn giữ chỗ 24h
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-primary/15 text-primary text-xs font-bold">
                        {pendingDrafts.length} phiếu chờ
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchPendingDrafts}
                        className="h-7 text-xs gap-1 border-border shadow-2xs hover:bg-primary/5"
                        title="Đồng bộ phiếu mượn mới"
                      >
                        <RefreshCw className="h-3 w-3" /> Làm mới
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  {pendingDrafts.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center">
                      <CheckCircle2 className="h-10 w-10 text-primary/30 mb-2.5" />
                      <p className="font-bold text-foreground text-sm">
                        Hiện không có phiếu mượn online nào đang chờ tại quầy
                      </p>
                      <p className="text-[11px] text-muted-foreground max-w-md mt-1 leading-relaxed">
                        Khi độc giả gửi phiếu mượn online trên ứng dụng hoặc quét thẻ trực tiếp tại quầy, danh sách sách giữ chỗ 24 giờ sẽ hiển thị ở đây để thủ thư xuất kho 1-chạm.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableHead className="text-xs font-bold text-foreground">Mã Phiếu Mượn</TableHead>
                          <TableHead className="text-xs font-bold text-foreground">Độc Giả</TableHead>
                          <TableHead className="text-xs font-bold text-foreground text-center">Số Lượng</TableHead>
                          <TableHead className="text-xs font-bold text-foreground">Thời Gian Tạo</TableHead>
                          <TableHead className="text-xs font-bold text-foreground">Thời Gian Giữ Chỗ</TableHead>
                          <TableHead className="text-xs font-bold text-foreground text-right">Thao Tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingDrafts.map((d: any) => (
                          <TableRow key={d.id} className="hover:bg-muted/40 text-xs">
                            <TableCell className="font-mono font-bold text-primary">
                              {d.draft_code}
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold text-foreground">{d.reader_name}</p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                Mã thẻ: {d.card_number || "Chưa cập nhật"}
                              </p>
                            </TableCell>
                            <TableCell className="text-center font-bold">
                              <Badge variant="secondary" className="text-xs bg-primary/10 text-primary font-bold">
                                {d.books_count} cuốn
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(d.created_at).toLocaleString("vi-VN")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                              >
                                Còn {d.time_left_hours ?? 24}h giữ chỗ
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                className="h-7.5 text-xs gap-1.5 px-3 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-2xs cursor-pointer"
                                onClick={() => handleOpenDraftByCode(d.draft_code)}
                              >
                                <Zap className="h-3 w-3" /> ⚡ Tiếp Nhận & Duyệt
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Hướng Dẫn Nghiệp Vụ Xuất Mượn Chuẩn Hóa */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border bg-card/60 space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-2 font-bold text-xs text-foreground">
                    <UserCheck className="h-4 w-4 text-primary" /> Bước 1: Tiếp nhận Độc Giả
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Yêu cầu độc giả xuất trình thẻ thư viện hoặc mã QR thẻ trên điện thoại. Bắn máy quét để hệ thống tự động kiểm tra hạn mức và sách quá hạn.
                  </p>
                </div>

                <div className="p-4 rounded-xl border bg-card/60 space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-2 font-bold text-xs text-foreground">
                    <BookOpen className="h-4 w-4 text-primary" /> Bước 2: Kiểm đếm Ấn Phẩm
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Đối soát mã bản sao trên gáy sách (QR-BK-...) với phiếu mượn online hoặc cho mượn trực tiếp các cuốn sách độc giả lấy trên kệ.
                  </p>
                </div>

                <div className="p-4 rounded-xl border bg-card/60 space-y-1.5 shadow-2xs">
                  <div className="flex items-center gap-2 font-bold text-xs text-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Bước 3: Cấp Biên Lai Ra Cổng
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Hệ thống cấp biên lai số và mã QR thông hành có hiệu lực 60 phút để độc giả đối soát tại cổng ra của thư viện an toàn.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* TRƯỜNG HỢP 2: ĐÃ MỞ PHIÊN ĐỘC GIẢ (BƯỚC 2 & 3: ĐỐI SOÁT & XUẤT KHO) */
            <div className="space-y-6">
              {/* Thẻ Hồ Sơ Bạn Đọc Đang Phục Vụ */}
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

                    <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
                      {scannedReaderInfo.activeBorrows && scannedReaderInfo.activeBorrows.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5 border-emerald-500/40 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300"
                          onClick={() => setStationMode("return")}
                          title="Chuyển sang Quầy Trả Sách để nhận trả sách của độc giả này"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" /> Có {scannedReaderInfo.activeBorrows.length} sách đang giữ → Trả sách
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => {
                          setSelectedCopyQr({
                            title: `Thẻ Thư Viện: ${scannedReaderInfo.reader.full_name}`,
                            qrCode: scannedReaderInfo.reader.card_number || `LIB-RD-${scannedReaderInfo.reader.id}`,
                            readerName: scannedReaderInfo.reader.full_name,
                            type: "reader"
                          });
                          setViewCopyQrDialog(true);
                        }}
                      >
                        <QrCode className="h-3.5 w-3.5" /> Mã QR Thẻ
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
                        onClick={handleCloseReaderSession}
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
                        {(scannedReaderInfo.totalUnpaidFines || 0).toLocaleString("vi-VN")}đ
                      </strong>
                      <span className="text-[10px] text-muted-foreground block">
                        {(scannedReaderInfo.totalUnpaidFines || 0) > 0 ? "Cần nộp trước khi mượn" : "Không có nợ phạt"}
                      </span>
                    </div>
                  </div>

                  {/* Cảnh báo khóa mượn */}
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

                  {/* Cảnh báo nợ phạt */}
                  {scannedReaderInfo.totalUnpaidFines && scannedReaderInfo.totalUnpaidFines > 0 ? (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="font-semibold text-amber-800 dark:text-amber-400">
                          Độc giả còn nợ phạt chưa thanh toán: {scannedReaderInfo.totalUnpaidFines.toLocaleString("vi-VN")}đ
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs font-semibold text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 hover:text-amber-800 gap-1 shrink-0 cursor-pointer shadow-2xs"
                        onClick={handleCollectReaderFinesAtCounter}
                      >
                        <Banknote className="h-3.5 w-3.5" /> Thu phạt tại quầy
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Không Gian Nghiệp Vụ Xuất Kho (Full-Width Thoáng Đãng) */}
              <div className="space-y-5">
                {/* Phân vùng A: Duyệt Theo Phiếu Chờ Online (Nếu Độc Giả Có Phiếu) */}
                {scannedReaderInfo.activeDraft && (
                  <Card className="border-2 border-primary/40 shadow-sm bg-gradient-to-r from-primary/10 via-card to-accent/10 overflow-hidden">
                    <CardHeader className="pb-2.5 bg-primary/10 border-b border-primary/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" />
                          <CardTitle className="font-display text-sm font-bold text-primary">
                            Duyệt Mượn Theo Phiếu Chờ 24h
                          </CardTitle>
                          <code className="text-[11px] px-1.5 py-0.5 bg-background font-mono font-bold rounded border text-primary">
                            {scannedReaderInfo.activeDraft.draft_code}
                          </code>
                        </div>
                        <Badge className="bg-primary text-primary-foreground text-[10px]">
                          {scannedReaderInfo.activeDraft.items?.length || 0} cuốn
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Độc giả xuất trình phiếu mượn gồm <strong className="text-foreground">{scannedReaderInfo.activeDraft.items?.length || 0} cuốn sách</strong>. Bấm nút dưới để kiểm tra và xuất kho 1-chạm:
                      </p>

                      {/* Danh sách các cuốn trong phiếu để thủ thư đối soát trực quan */}
                      {scannedReaderInfo.activeDraft.items && scannedReaderInfo.activeDraft.items.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                          {scannedReaderInfo.activeDraft.items.map((item: any, idx: number) => (
                            <div key={idx} className="p-2.5 bg-background border rounded-lg flex items-center justify-between text-xs gap-2">
                              <span className="font-medium truncate flex-1">{item.book_title}</span>
                              <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                                {item.copy_qr_code || item.qr_code || "Chờ đối soát"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}

                      {scannedReaderInfo.draftWillExceedLimit && (
                        <div className="p-2.5 bg-destructive/10 border border-destructive/30 rounded-xl text-xs text-destructive flex items-start gap-2 font-medium">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>{scannedReaderInfo.draftExceedReason}</span>
                        </div>
                      )}

                      <Button
                        size="sm"
                        disabled={scannedReaderInfo.draftWillExceedLimit}
                        className={`w-full h-10 text-xs font-semibold gap-1.5 ${
                          scannedReaderInfo.draftWillExceedLimit
                            ? "bg-muted text-muted-foreground cursor-not-allowed opacity-70"
                            : "bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer"
                        }`}
                        onClick={() => {
                          if (scannedReaderInfo.draftWillExceedLimit) {
                            toast.error(scannedReaderInfo.draftExceedReason || "Vượt quá giới hạn mượn sách tối đa!");
                            return;
                          }
                          const isDraftOverLimit =
                            (scannedReaderInfo.activeBorrows?.length || 0) +
                              (scannedReaderInfo.activeDraft.items?.length || 0) >
                            (scannedReaderInfo.maxBooks || 5);
                          setTargetDraftData({
                            draft: scannedReaderInfo.activeDraft,
                            items: scannedReaderInfo.activeDraft.items || [],
                            reader: scannedReaderInfo.reader,
                            activeBorrowsCount: scannedReaderInfo.activeBorrows?.length || 0,
                            maxBooks: scannedReaderInfo.maxBooks || 5,
                            eligibility: {
                              canBorrow: scannedReaderInfo.canBorrow && !isDraftOverLimit,
                              borrowBlockReason: isDraftOverLimit
                                ? scannedReaderInfo.draftExceedReason
                                : scannedReaderInfo.borrowBlockReason,
                              unpaidFines: scannedReaderInfo.totalUnpaidFines || 0,
                              overdueCount: scannedReaderInfo.overdueLoansCount || 0
                            }
                          });
                          setDraftApprovalModalOpen(true);
                        }}
                      >
                        <Zap className="h-4 w-4" />
                        {scannedReaderInfo.draftWillExceedLimit
                          ? "⛔ Không thể duyệt: Vượt hạn mức mượn"
                          : `⚡ Phê Duyệt & Xuất Kho Toàn Bộ ${scannedReaderInfo.activeDraft.items?.length || 0} Cuốn Sách (1-Chạm)`}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Phân vùng B: Sách Đặt Trước Giữ Riêng Tại Quầy */}
                {scannedReaderInfo.readyReservations && scannedReaderInfo.readyReservations.length > 0 && (
                  <Card className="border-amber-500/30 shadow-xs">
                    <CardHeader className="pb-3 border-b bg-amber-500/5">
                      <div className="flex items-center justify-between">
                        <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                          <Inbox className="h-4 w-4 text-amber-600" /> Sách Đặt Trước Giữ Riêng Tại Quầy
                        </CardTitle>
                        <Badge variant="secondary" className="text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 font-semibold">
                          {scannedReaderInfo.readyReservations.length} cuốn
                        </Badge>
                      </div>
                      <CardDescription className="text-[11px]">
                        Sách hết đã về kho, độc giả đã xác nhận đồng ý mượn và đang được giữ tại quầy
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="p-4 space-y-2.5">
                      {scannedReaderInfo.readyReservations.map((resv: any) => (
                        <div key={resv.reservation_id} className="flex items-center justify-between p-3 rounded-xl border bg-card text-xs shadow-2xs gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
                              {resv.cover_image ? (
                                <img src={resv.cover_image} alt={resv.book_title} className="h-full w-full object-cover" />
                              ) : (
                                <BookOpen className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-xs text-foreground truncate">{resv.book_title}</p>
                              <p className="text-muted-foreground text-[11px] mt-0.5">
                                Phiếu: #RES-{resv.reservation_id} • Đã giữ chỗ tại quầy
                              </p>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono mt-0.5">
                                <span>📍 Vị trí gốc:</span>
                                <span className="font-semibold text-foreground">{resv.location || "Phòng 01 - Kệ 01 - Ngăn 01"}</span>
                              </div>
                            </div>
                          </div>

                          <Button
                            size="sm"
                            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shrink-0 shadow-xs disabled:opacity-50"
                            onClick={() => handleOpenApproveModal(resv)}
                            disabled={scannedReaderInfo.canBorrow === false}
                          >
                            <CheckSquare className="h-3.5 w-3.5" /> Quét Sách & Bàn Giao
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Phân vùng C: Cho Mượn Trực Tiếp Tại Quầy (Độc giả lấy sách từ kệ) */}
                <Card className="border-primary/20 shadow-xs">
                  <CardHeader className="pb-3 border-b bg-muted/10">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-foreground">
                        <BookOpen className="h-4 w-4 text-primary" /> Cho Mượn Sách Trực Tiếp Tại Quầy
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                        {scannedReaderInfo.activeDraft ? "Mượn thêm sách ngoài phiếu" : "Mượn trực tiếp tại kệ"}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      Độc giả lấy sách từ kệ mang lại quầy • Quét mã trên gáy sách (QR-BK-...) để làm thủ tục cho mượn trực tiếp
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 space-y-3">
                    {(() => {
                      const cleanDirectQr = directBookQr.trim().toLowerCase();
                      const isCurrentReaderHoldingDirect = Boolean(
                        cleanDirectQr &&
                          scannedReaderInfo?.activeBorrows?.some(
                            (b: any) => b.qr_code?.toLowerCase() === cleanDirectQr
                          )
                      );
                      const activeHistoryLoanForDirect = cleanDirectQr
                        ? history.find(
                            (h: any) => h.status === "borrowing" && h.qr_code?.toLowerCase() === cleanDirectQr
                          )
                        : null;
                      const isDirectBookBorrowed = Boolean(
                        cleanDirectQr && (
                          directBookInfo?.status === "borrowed" ||
                          directBookInfo?.active_borrow_id ||
                          directBookInfo?.is_already_borrowed ||
                          directBookInfo?.borrower_user_id ||
                          directBookInfo?.borrower_name ||
                          isCurrentReaderHoldingDirect ||
                          activeHistoryLoanForDirect
                        )
                      );

                      const isDirectCurrentBorrower = Boolean(
                        cleanDirectQr && (
                          isCurrentReaderHoldingDirect ||
                          (directBookInfo?.borrower_user_id && directBookInfo?.borrower_user_id === scannedReaderInfo?.reader?.id) ||
                          (directBookInfo?.borrower_card_number && directBookInfo?.borrower_card_number === scannedReaderInfo?.reader?.card_number) ||
                          (activeHistoryLoanForDirect && activeHistoryLoanForDirect.user_id === scannedReaderInfo?.reader?.id)
                        )
                      );

                      const directBorrowerName =
                        directBookInfo?.borrower_name ||
                        activeHistoryLoanForDirect?.reader_name ||
                        (isDirectCurrentBorrower ? scannedReaderInfo?.reader?.full_name : "Độc giả khác");

                      const directBorrowerCard =
                        directBookInfo?.borrower_card_number ||
                        activeHistoryLoanForDirect?.card_number ||
                        (isDirectCurrentBorrower ? scannedReaderInfo?.reader?.card_number : "");

                      const directDueDate =
                        directBookInfo?.due_date ||
                        activeHistoryLoanForDirect?.due_date ||
                        (isCurrentReaderHoldingDirect
                          ? scannedReaderInfo?.activeBorrows?.find((b: any) => b.qr_code?.toLowerCase() === cleanDirectQr)?.due_date
                          : null);

                      return (
                        <>
                          <form onSubmit={(e) => handleDirectBorrow(e)} className="flex gap-2">
                            <Input
                              placeholder="Quét mã QR trên gáy sách (VD: QR-BK-1-1)..."
                              value={directBookQr}
                              onChange={(e) => setDirectBookQr(e.target.value)}
                              className={`text-xs h-9 bg-background font-mono focus-visible:ring-primary ${
                                isDirectBookBorrowed || directBookInfo?.all_copies_held
                                  ? "border-destructive focus-visible:ring-destructive text-destructive font-bold"
                                  : ""
                              }`}
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
                              className={`h-9 text-xs shrink-0 font-semibold shadow-xs ${
                                isDirectBookBorrowed || directBookInfo?.all_copies_held
                                  ? "bg-destructive hover:bg-destructive/90 text-white"
                                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
                              }`}
                              disabled={
                                scannedReaderInfo.canBorrow === false ||
                                isDirectBookBorrowed ||
                                directBookInfo?.all_copies_held
                              }
                            >
                              {isDirectBookBorrowed
                                ? isDirectCurrentBorrower
                                  ? "⛔ Độc giả đang giữ"
                                  : "⛔ Đang có người mượn"
                                : directBookInfo?.all_copies_held
                                ? "⛔ Đã giữ chỗ 24h"
                                : "Cho mượn sách"}
                            </Button>
                          </form>

                          {/* Khu vực đối soát thông tin sách Real-time */}
                          {isCheckingDirectBook ? (
                            <div className="p-3 rounded-xl border bg-muted/30 text-xs text-muted-foreground flex items-center gap-2 animate-pulse">
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                              <span>Đang tra cứu thông tin sách và tình trạng lưu thông...</span>
                            </div>
                          ) : directBookCheckError ? (
                            <div className="p-3 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-xs flex items-center gap-2">
                              <XCircle className="h-4 w-4 shrink-0" />
                              <span>{directBookCheckError}</span>
                            </div>
                          ) : directBookInfo ? (
                            <div className="p-3.5 rounded-xl border bg-muted/20 space-y-3 animate-in fade-in duration-200">
                              <div className="flex items-center gap-3">
                                <div className="h-14 w-11 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center shadow-2xs">
                                  {directBookInfo.cover_image ? (
                                    <img src={directBookInfo.cover_image} alt={directBookInfo.book_title} className="h-full w-full object-cover" />
                                  ) : (
                                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-xs text-foreground truncate">{directBookInfo.book_title}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                                    <code className="font-mono bg-primary/10 text-primary px-1.5 py-0.2 rounded font-bold">
                                      {directBookInfo.qr_code}
                                    </code>
                                    {directBookInfo.author_name && <span>• ✍️ {directBookInfo.author_name}</span>}
                                    <span>• Trên kệ: <strong>{directBookInfo.available_physical_copies || 1} cuốn</strong></span>
                                  </div>
                                  {directBookInfo.location && (
                                    <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground font-mono mt-0.5">
                                      <span>📍 Vị trí: <strong className="text-foreground">{directBookInfo.location}</strong></span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenMiniMap({
                                            location: directBookInfo.location,
                                            title: directBookInfo.book_title,
                                            cover_image: directBookInfo.cover_image,
                                            author_name: directBookInfo.author_name
                                          })
                                        }
                                        className="text-primary hover:underline ml-1 font-semibold"
                                      >
                                        🗺️ Xem bản đồ
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {isDirectBookBorrowed ? (
                                <div className="p-3 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs space-y-1.5">
                                  <div className="flex items-center gap-1.5 font-bold">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    <span>
                                      {isDirectCurrentBorrower
                                        ? "CẢNH BÁO: ĐỘC GIẢ NÀY ĐANG MƯỢN BẢN SAO NÀY!"
                                        : "CẢNH BÁO: BẢN SAO NÀY ĐANG CÓ NGƯỜI KHÁC MƯỢN!"}
                                    </span>
                                  </div>
                                  <p className="text-[11px]">
                                    Người mượn: <strong>{directBorrowerName}</strong> ({directBorrowerCard})
                                    {directDueDate && ` • Hạn trả: ${new Date(directDueDate).toLocaleDateString("vi-VN")}`}
                                  </p>
                                </div>
                              ) : directBookInfo.hold_count > 0 && directBookInfo.all_copies_held ? (
                                <div className="p-3 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs space-y-1.5">
                                  <div className="flex items-center gap-1.5 font-bold">
                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                    <span>CẢNH BÁO: CUỐN SÁCH NÀY ĐÃ CÓ NGƯỜI GIỮ CHỖ ONLINE 24H!</span>
                                  </div>
                                  <p className="text-[11px]">
                                    Toàn bộ sách trên kệ đã có độc giả khác hẹn trước. Không thể cho mượn trực tiếp!
                                  </p>
                                </div>
                              ) : (
                                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                  <span>Sách sẵn sàng cho mượn trực tiếp.</span>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TRẠM 2: QUẦY NHẬN TRẢ SÁCH & HÒM NGOÀI GIỜ (RETURN STATION)
          ========================================================================= */}
      {stationMode === "return" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Hàng 2 Thao Tác Nhanh: Quét Trả Siêu Tốc & Hòm Trả 24/7 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Quét Trả Sách Siêu Tốc */}
            <Card className="border shadow-xs border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-card to-card">
              <CardHeader className="pb-3 border-b bg-emerald-500/5">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <ArrowRightLeft className="h-4.5 w-4.5 text-emerald-600" /> Quầy Tiếp Nhận Trả Sách Siêu Tốc
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-50 border-emerald-300">
                    Bắn mã nhận trả
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Bắn máy quét mã QR trên gáy sách (QR-BK-...) hoặc quét mã gom trả (RETURN-BATCH-...) của độc giả
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <QrCode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Quét mã QR gáy sách (QR-BK-...) hoặc Mã gom trả (RETURN-BATCH-...)..."
                      value={returnBookQr}
                      onChange={(e) => setReturnBookQr(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (returnBookQr.trim()) {
                            loadReaderCheckoutInfo(returnBookQr.trim());
                            setReturnBookQr("");
                          }
                        }
                      }}
                      className="pl-9 h-10 font-mono text-xs bg-background focus-visible:ring-emerald-500 shadow-2xs"
                    />
                  </div>

                  <Button
                    onClick={() => {
                      if (returnBookQr.trim()) {
                        loadReaderCheckoutInfo(returnBookQr.trim());
                        setReturnBookQr("");
                      } else {
                        toast.info("Vui lòng quét hoặc nhập mã sách hoặc mã gom trả");
                      }
                    }}
                    size="sm"
                    className="h-10 px-4 text-xs font-semibold gap-1.5 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Nhận Trả
                  </Button>

                  <Button
                    onClick={() => openScannerModal("desk_auto")}
                    size="sm"
                    variant="outline"
                    className="h-10 px-3 text-xs font-semibold gap-1.5 shrink-0 border-emerald-500/30 text-emerald-700 hover:bg-emerald-50 shadow-2xs cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5" /> Camera
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  💡 <em>Hệ thống tự động tra cứu người mượn, tính phạt trễ hạn (nếu có) và đưa sách trở lại trạng thái sẵn sàng trong kho.</em>
                </p>
              </CardContent>
            </Card>

            {/* Card 2: Hòm Trả Sách Thông Minh 24/7 */}
            <Card className="border shadow-xs border-sky-500/30 bg-gradient-to-r from-sky-500/5 via-card to-card">
              <CardHeader className="pb-3 border-b bg-sky-500/5">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-sky-800 dark:text-sky-300">
                    <Inbox className="h-4.5 w-4.5 text-sky-600" /> Hòm Trả Sách Ngoài Giờ 24/7 (Smart Book Drop)
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-sky-700 bg-sky-50 border-sky-300 font-mono">
                    24/7 Tự Phục Vụ
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Kiểm đếm và đối soát danh sách sách độc giả đã thả vào hòm trả sách ngoài giờ làm việc
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-display text-sky-700 dark:text-sky-400">
                      {dropBoxPendingCount}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">cuốn sách đang chờ kiểm đếm</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Sách được ghi nhận đã trả ngay khi thả hòm, thủ thư kiểm kê định kỳ mỗi buổi sáng.
                  </p>
                </div>

                <Button
                  size="sm"
                  onClick={() => setBookDropAuditOpen(true)}
                  className="h-9 px-3.5 text-xs font-semibold gap-1.5 shrink-0 bg-sky-600 hover:bg-sky-700 text-white shadow-xs cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5" /> Kiểm Đếm Hòm Trả
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Nếu Đang Mở Phiên Độc Giả: Hiển Thị Danh Sách Sách Độc Giả Đang Giữ */}
          {scannedReaderInfo && (
            <Card className="border-emerald-600/30 shadow-xs">
              <CardHeader className="pb-3 border-b bg-emerald-600/5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CardTitle className="font-display text-sm font-bold flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
                      <BookMarked className="h-4 w-4 text-emerald-600" /> Sách Độc Giả «{scannedReaderInfo.reader.full_name}» Đang Giữ
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 font-semibold">
                      {scannedReaderInfo.activeBorrows.length} cuốn
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    {scannedReaderInfo.activeBorrows.length > 0 && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 h-8 shadow-xs cursor-pointer"
                        onClick={() => handlePreviewBatchReturn(scannedReaderInfo.activeBorrows.map((b) => b.id))}
                      >
                        <Zap className="h-3 w-3" /> Nhận Trả Toàn Bộ ({scannedReaderInfo.activeBorrows.length} cuốn)
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCloseReaderSession}
                      className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
                    >
                      <X className="h-3.5 w-3.5" /> Đóng phiên
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4">
                {scannedReaderInfo.activeBorrows.length === 0 ? (
                  <div className="text-center py-8 border border-dashed rounded-xl bg-muted/10 text-xs text-muted-foreground flex flex-col items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600/40 mb-2" />
                    <p className="font-semibold text-foreground">Độc giả hiện không giữ cuốn sách nào</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Tất cả sách mượn trước đây đều đã được hoàn trả vào kho an toàn.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {scannedReaderInfo.activeBorrows.map((loan) => {
                      const dueStatus = getDueStatus(loan.due_date);
                      const isOverdue = dueStatus.isOverdue || (loan.overdue_days && loan.overdue_days > 0);
                      const fineAmount = loan.fine_amount || ((loan.overdue_days || 0) * 5000);
                      const hasRenewed = (loan.renewal_count || 0) >= 1;

                      return (
                        <div key={loan.id} className="p-3.5 rounded-xl border bg-card text-xs shadow-2xs space-y-2.5 hover:border-emerald-500/40 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-12 w-10 rounded bg-muted overflow-hidden shrink-0 border grid place-items-center">
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
                                  Phạt: {fineAmount.toLocaleString("vi-VN")}đ
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
                              className={`h-7.5 text-xs gap-1.5 px-3 font-semibold shadow-xs shrink-0 ${
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
                                  <AlertTriangle className="h-3.5 w-3.5" /> Quét trả • Thu {fineAmount.toLocaleString("vi-VN")}đ
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
          )}

          {/* Bảng Danh Sách Ấn Phẩm Quá Hạn Cần Thu Hồi Khẩn Cấp */}
          <Card className="shadow-xs border overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-sm font-bold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Danh Sách Sách Quá Hạn & Cần Thu Hồi Khẩn Cấp
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Các ấn phẩm đã quá hạn quy định hoặc độc giả cần hoàn trả về thư viện ngay
                  </CardDescription>
                </div>
                <Badge variant={overdueLoansCount > 0 ? "destructive" : "outline"} className="text-xs font-semibold">
                  {overdueLoansCount} cuốn quá hạn
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {(() => {
                const overdueItems = history.filter((h) => h.status === "borrowing" && getDueStatus(h.due_date).isOverdue);
                const urgentReturnList = overdueItems.length > 0 ? overdueItems : history.filter((h) => h.status === "borrowing").slice(0, 8);

                if (urgentReturnList.length === 0) {
                  return (
                    <div className="py-10 text-center text-xs text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600/40 mx-auto mb-2" />
                      <p className="font-bold text-foreground">Không có ấn phẩm nào đang trễ hạn hoặc cần thu hồi khẩn cấp</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Toàn bộ sách đang lưu thông đều trong thời hạn an toàn.</p>
                    </div>
                  );
                }

                return (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="text-xs font-bold text-foreground">Mã Phiếu</TableHead>
                        <TableHead className="text-xs font-bold text-foreground">Tên Sách & Bản Sao</TableHead>
                        <TableHead className="text-xs font-bold text-foreground">Độc Giả</TableHead>
                        <TableHead className="text-xs font-bold text-foreground">Hạn Trả</TableHead>
                        <TableHead className="text-xs font-bold text-foreground text-center">Tình Trạng / Phí Phạt</TableHead>
                        <TableHead className="text-xs font-bold text-foreground text-right">Thao Tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {urgentReturnList.map((loan) => {
                        const dueStatus = getDueStatus(loan.due_date);
                        const isOverdue = dueStatus.isOverdue;
                        const fineAmount = loan.fine_amount || (isOverdue ? (dueStatus.diffDays || 1) * 5000 : 0);

                        return (
                          <TableRow key={loan.id} className="hover:bg-muted/40 text-xs">
                            <TableCell className="font-mono font-bold text-muted-foreground">
                              #{loan.id}
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold text-foreground">{loan.book_title}</p>
                              <code className="text-[10px] font-mono text-primary font-bold bg-primary/5 px-1 py-0.2 rounded">
                                {loan.qr_code}
                              </code>
                            </TableCell>
                            <TableCell>
                              <p className="font-semibold text-foreground">{loan.reader_name}</p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                Mã thẻ: {loan.card_number}
                                {loan.reader_phone && ` • 📞 ${loan.reader_phone}`}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span>{new Date(loan.due_date).toLocaleDateString("vi-VN")}</span>
                            </TableCell>
                            <TableCell className="text-center">
                              {isOverdue ? (
                                <Badge variant="destructive" className="text-[11px] font-semibold gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Quá hạn {dueStatus.diffDays} ngày ({fineAmount.toLocaleString("vi-VN")}đ)
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[11px] text-emerald-700 bg-emerald-50 border-emerald-300">
                                  {dueStatus.text}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                className={`h-7.5 text-xs gap-1.5 px-3 font-semibold shadow-2xs cursor-pointer ${
                                  isOverdue
                                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                }`}
                                onClick={() => handleTableReturnPrompt(loan)}
                              >
                                <ArrowRightLeft className="h-3 w-3" /> ⚡ Nhận Trả Sách
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {/* =========================================================================
          TRẠM 3: SỔ THEO DÕI LƯU THÔNG & ĐỐI SOÁT (HISTORY STATION)
          ========================================================================= */}
      {stationMode === "history" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* 4 Thẻ Thống Kê Lưu Thông Trực Quan */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border shadow-2xs bg-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Tổng Lượt Lưu Thông</p>
                  <p className="font-display text-2xl font-bold text-foreground mt-1">{history.length}</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-2xs bg-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Đang Mượn Ngoài Kho</p>
                  <p className="font-display text-2xl font-bold text-primary mt-1">{activeLoansCount}</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <BookMarked className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-2xs bg-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Quá Hạn Cần Thu Hồi</p>
                  <p className={`font-display text-2xl font-bold mt-1 ${overdueLoansCount > 0 ? "text-destructive" : "text-foreground"}`}>
                    {overdueLoansCount}
                  </p>
                </div>
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${overdueLoansCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted/60 text-muted-foreground"}`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-2xs bg-card">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Đã Hoàn Trả Vào Kho</p>
                  <p className="font-display text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{returnedLoansCount}</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sổ Lưu Thông & Toolbar */}
          <Card className="shadow-xs border overflow-hidden">
            <CardHeader className="pb-3 border-b bg-muted/20">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-base font-bold flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-primary" /> Sổ Theo Dõi Lưu Thông Toàn Thư Viện
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Nhật ký mượn - trả thời gian thực kèm mã bản sao hiện vật và đối soát cổng an ninh
                  </CardDescription>
                </div>

                {/* Filter Buttons, Search, & Security Exit Check */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSecurityScannerOpen(true)}
                    className="h-8 text-xs gap-1.5 border-primary/40 text-primary hover:bg-primary/10 shadow-2xs cursor-pointer"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Đối Soát Biên Lai Ra Cổng
                  </Button>

                  <div className="flex items-center rounded-lg border bg-background p-0.5 text-xs shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setTableFilter("all")}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        tableFilter === "all"
                          ? "bg-muted text-foreground font-semibold shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Tất cả ({history.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableFilter("borrowing")}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        tableFilter === "borrowing"
                          ? "bg-muted text-foreground font-semibold shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Đang mượn ({activeLoansCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableFilter("overdue")}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        tableFilter === "overdue"
                          ? "bg-destructive/10 text-destructive font-semibold shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Quá hạn ({overdueLoansCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTableFilter("returned")}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        tableFilter === "returned"
                          ? "bg-emerald-500/10 text-emerald-700 font-semibold shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Đã trả ({returnedLoansCount})
                    </button>
                  </div>

                  <div className="relative w-full sm:w-52">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Tìm sách, độc giả, mã thẻ..."
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                        Không tìm thấy bản ghi giao dịch nào phù hợp với bộ lọc hiện tại.
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
                                  setSelectedCopyQr({
                                    title: record.book_title,
                                    qrCode: record.qr_code,
                                    readerName: record.reader_name,
                                    type: "book"
                                  });
                                  setViewCopyQrDialog(true);
                                }}
                                className="text-[10px] text-muted-foreground hover:text-primary underline cursor-pointer"
                              >
                                Xem QR
                              </button>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono mt-0.5">
                              <span>📍 Kho:</span>
                              <span className="font-medium text-foreground">
                                {record.book_location || record.location || "Phòng 01 - Kệ 01 - Ngăn 01"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 px-4">
                            <p className="font-semibold text-foreground text-xs">{record.reader_name}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                              Thẻ: <strong className="text-foreground">{record.card_number}</strong>{" "}
                              {record.reader_phone ? `• SĐT: ${record.reader_phone}` : ""}
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
                              <Badge variant="destructive" className="ml-1 text-[8px] py-0 px-1">
                                Trễ hạn
                              </Badge>
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
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Scanner Modal */}
      {renderScannerModal()}

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
                  {(approveResvTarget.location || approveResvTarget.book_location) && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono mt-0.5">
                      <span>📍 Vị trí kệ:</span>
                      <span className="font-semibold text-foreground">{approveResvTarget.location || approveResvTarget.book_location}</span>
                    </div>
                  )}
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
                      className={`font-mono text-xs ${approveCheckError
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
                  <div className="my-1 flex items-center justify-between text-xs text-foreground bg-muted/60 px-2.5 py-1 rounded-md font-mono border">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-muted-foreground">📍 Vị trí cất sách:</span>
                      <span className="font-bold">{returnTargetLoan.book_location || returnTargetLoan.location || 'Phòng 01 - Kệ 01 - Ngăn 01'}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenMiniMap({
                        location: returnTargetLoan.book_location || returnTargetLoan.location,
                        title: returnTargetLoan.book_title,
                        cover_image: returnTargetLoan.cover_image,
                      })}
                      className="h-6 text-[10px] text-primary hover:text-primary gap-1 px-1.5 ml-2 font-semibold"
                    >
                      🗺️ Xem kệ trên bản đồ
                    </Button>
                  </div>
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

      {/* Copy / Reader Card QR Inspection Modal */}
      <Dialog open={viewCopyQrDialog} onOpenChange={setViewCopyQrDialog}>
        <DialogContent className="max-w-sm">
          {(() => {
            const isReaderCard = selectedCopyQr?.type === 'reader' ||
              selectedCopyQr?.qrCode?.startsWith('LIB-RD-') ||
              selectedCopyQr?.qrCode?.startsWith('RD-') ||
              selectedCopyQr?.title?.includes('Thẻ Thư Viện');

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display flex items-center gap-2 text-base">
                    {isReaderCard ? (
                      <>
                        <CreditCard className="h-5 w-5 text-primary" /> Mã QR Thẻ Độc Giả
                      </>
                    ) : (
                      <>
                        <QrCode className="h-5 w-5 text-primary" /> Tem QR Định Danh Bản Sao
                      </>
                    )}
                  </DialogTitle>
                  <DialogDescription className="text-xs truncate">
                    {isReaderCard
                      ? (selectedCopyQr?.readerName ? `Độc giả: ${selectedCopyQr.readerName}` : selectedCopyQr?.title)
                      : (selectedCopyQr?.title ? `Ấn phẩm: ${selectedCopyQr.title}` : '')}
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
                  <code className="px-3 py-1 bg-primary/10 text-primary rounded-full font-mono font-bold text-xs tracking-wide">
                    {selectedCopyQr?.qrCode}
                  </code>
                  <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                    {isReaderCard ? (
                      <>
                        💡 Đây là mã QR định danh thẻ thư viện của độc giả. Độc giả có thể dùng mã này trên điện thoại hoặc thẻ cứng để quét mở phiên mượn/trả sách hoặc đối soát thủ tục tại quầy.
                      </>
                    ) : (
                      <>
                        💡 Đây là tem mã QR định danh duy nhất cho cuốn sách vật lý này. Hãy đối chiếu với tem in dán trên gáy hoặc bìa sách.
                      </>
                    )}
                  </p>
                </div>
              </>
            );
          })()}
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

      {/* Mini Map Navigation Modal for Staff / Admin */}
      <LibraryMiniMapModal
        open={miniMapOpen}
        onOpenChange={setMiniMapOpen}
        location={miniMapTarget?.location}
        bookTitle={miniMapTarget?.title}
        authorName={miniMapTarget?.author}
        coverImage={miniMapTarget?.cover}
      />

      {/* Modal Duyệt Phiếu Mượn Nháp 1 Chạm Cho Thủ Thư */}
      <Dialog open={draftApprovalModalOpen} onOpenChange={setDraftApprovalModalOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          {targetDraftData && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground font-semibold">
                    Giao Dịch Mượn Gom Nhiều Cuốn
                  </Badge>
                  <code className="px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20 font-mono font-bold text-xs">
                    {targetDraftData.draft?.draft_code}
                  </code>
                </div>
                <DialogTitle className="font-display text-lg font-bold mt-1 text-foreground">
                  Phê Duyệt Phiếu Mượn Online ({targetDraftData.items?.length || 0} cuốn sách)
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Thủ thư đối soát sách độc giả mang tới bàn và bấm 1 chạm để hoàn tất xuất mượn toàn bộ ấn phẩm.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-1">
                {/* Visual notice if reader already 100% self-verified at shelf */}
                {(targetDraftData.allVerified || targetDraftData.draft?.all_verified) && (
                  <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2 font-medium">
                    <Sparkles className="h-4 w-4 text-emerald-600 shrink-0 animate-pulse" />
                    <span>⭐ <strong>MÃ XUẤT KHO 1-CHẠM:</strong> Độc giả đã tự đối soát 100% bản sao tại kệ sách. Thủ thư chỉ cần bấm <em>"Xác nhận xuất kho"</em> để hoàn tất mượn mà không cần thao tác kiểm tra lại!</span>
                  </div>
                )}

                {/* 1. Reader Identity & 4 Automatic Eligibility Checks */}
                <div className="p-4 bg-muted/30 border rounded-2xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-11 w-11 border-2 border-primary/20">
                        <AvatarFallback className="bg-primary text-primary-foreground font-bold">
                          {targetDraftData.reader?.full_name?.charAt(0) || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-bold text-sm text-foreground">{targetDraftData.reader?.full_name}</h4>
                        <p className="text-xs text-muted-foreground font-mono">
                          Mã thẻ: <strong className="text-primary">{targetDraftData.reader?.card_number}</strong> • Email: {targetDraftData.reader?.email}
                        </p>
                      </div>
                    </div>

                    {(() => {
                      const isDraftExceedingLimit = (targetDraftData.activeBorrowsCount || 0) + (targetDraftData.items?.length || 0) > (targetDraftData.maxBooks || 5);
                      const isBlocked = targetDraftData.eligibility?.canBorrow === false || isDraftExceedingLimit;

                      return (
                        <>
                          <Badge 
                            variant={!isBlocked ? "outline" : "destructive"}
                            className={`text-xs font-semibold ${!isBlocked ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" : ""}`}
                          >
                            {!isBlocked ? "✓ Đủ điều kiện mượn sách" : "⛔ Chặn mượn sách"}
                          </Badge>
                        </>
                      );
                    })()}
                  </div>

                  {/* 4 Status Badges */}
                  {(() => {
                    const isDraftExceedingLimit = (targetDraftData.activeBorrowsCount || 0) + (targetDraftData.items?.length || 0) > (targetDraftData.maxBooks || 5);
                    const isBlocked = targetDraftData.eligibility?.canBorrow === false || isDraftExceedingLimit;

                    return (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="p-2.5 bg-background rounded-xl border">
                            <span className="text-[10px] text-muted-foreground block">Tài khoản</span>
                            <strong className="text-emerald-600 font-bold">Hoạt động</strong>
                          </div>
                          <div className="p-2.5 bg-background rounded-xl border">
                            <span className="text-[10px] text-muted-foreground block">Nợ phí phạt</span>
                            <strong className={(targetDraftData.eligibility?.unpaidFines || 0) > 0 ? "text-destructive font-bold" : "text-foreground font-bold"}>
                              {(targetDraftData.eligibility?.unpaidFines || 0).toLocaleString('vi-VN')}đ
                            </strong>
                          </div>
                          <div className="p-2.5 bg-background rounded-xl border">
                            <span className="text-[10px] text-muted-foreground block">Sách quá hạn</span>
                            <strong className={(targetDraftData.eligibility?.overdueCount || 0) > 0 ? "text-destructive font-bold" : "text-foreground font-bold"}>
                              {targetDraftData.eligibility?.overdueCount || 0} cuốn
                            </strong>
                          </div>
                          <div className={`p-2.5 rounded-xl border ${isDraftExceedingLimit ? "bg-destructive/10 border-destructive/40 text-destructive" : "bg-background"}`}>
                            <span className="text-[10px] text-muted-foreground block">Hạn mức mượn</span>
                            <strong className={isDraftExceedingLimit ? "text-destructive font-bold" : "text-primary font-bold"}>
                              {targetDraftData.activeBorrowsCount || 0} + {targetDraftData.items?.length || 0} / {targetDraftData.maxBooks || 5} cuốn
                            </strong>
                            {isDraftExceedingLimit && (
                              <span className="block text-[10px] font-bold text-destructive mt-0.5">Vượt tối đa!</span>
                            )}
                          </div>
                        </div>

                        {isBlocked && (
                          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-xs text-destructive flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <div>
                              <strong className="block font-bold">Không thể phê duyệt phiếu mượn này:</strong>
                              <span>
                                {isDraftExceedingLimit
                                  ? `Vượt quá giới hạn mượn sách! Độc giả hiện đang giữ ${targetDraftData.activeBorrowsCount || 0}/${targetDraftData.maxBooks || 5} cuốn. Phiếu mượn gồm ${targetDraftData.items?.length || 0} cuốn, nếu duyệt sẽ thành ${targetDraftData.activeBorrowsCount + (targetDraftData.items?.length || 0)}/${targetDraftData.maxBooks || 5} cuốn (vượt quá hạn mức tối đa ${targetDraftData.maxBooks || 5} cuốn/độc giả). Độc giả phải trả bớt sách trước khi nhận phiếu này!`
                                  : targetDraftData.eligibility?.borrowBlockReason}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* 2. Book Items List & Physical Copy Verification (Tránh sai sót) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                    <span>Danh sách {targetDraftData.items?.length || 0} cuốn sách cần trao:</span>
                    <span className="text-[11px] text-muted-foreground">Đối soát bản sao vật lý (Tránh nhầm sách)</span>
                  </div>

                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {targetDraftData.items?.map((item: any, idx: number) => (
                      <div 
                        key={item.item_id || item.id || idx}
                        className="p-3 bg-card border rounded-xl space-y-2 text-xs shadow-2xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            {item.cover_image ? (
                              <img src={item.cover_image} alt={item.book_title} className="h-10 w-8 object-cover rounded shadow-2xs shrink-0" />
                            ) : (
                              <div className="h-10 w-8 bg-muted rounded flex items-center justify-center text-xs shrink-0">📚</div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-foreground text-sm truncate">{item.book_title}</p>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>ISBN: {item.isbn || "Chưa cập nhật"}</span>
                                <span>• Kho còn: <strong className="text-emerald-600">{item.available_copies} cuốn</strong></span>
                              </div>
                            </div>
                          </div>

                          <div 
                            onClick={() => handleOpenMiniMap({ location: item.location, title: item.book_title, cover: item.cover_image })}
                            className="flex items-center gap-1 px-2.5 py-1 bg-muted/50 border rounded-lg cursor-pointer hover:border-primary text-[11px] text-foreground font-medium shrink-0"
                            title="Xem sơ đồ vị trí lưu kho"
                          >
                            <span>📍</span>
                            <span>{item.location || "Phòng 01 - Kệ 01 - Ngăn 01"}</span>
                          </div>
                        </div>

                        {/* Physical verification state or input */}
                        {item.book_copy_id ? (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs">
                            <span className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              Độc giả đã tự đối soát bản sao tại kệ:
                            </span>
                            <Badge className="bg-emerald-600 text-white font-mono text-xs">
                              {item.copy_qr_code || `Bản sao #${item.book_copy_id}`}
                            </Badge>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                            <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1 font-medium">
                              <QrCode className="h-3.5 w-3.5 text-primary" /> Mã tem bản sao:
                            </span>
                            <Input
                              placeholder="Để trống để tự động gán bản sao sẵn sàng, hoặc quét tem QR trên tay độc giả..."
                              value={copyOverrides[item.book_id] || ""}
                              onChange={(e) => {
                                const val = e.target.value.trim();
                                setCopyOverrides(prev => ({ ...prev, [item.book_id]: val }));
                              }}
                              className="h-7 text-xs font-mono bg-background flex-1"
                            />
                            {copyOverrides[item.book_id] && (
                              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-300">
                                ✓ Đã gán tem
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Reader Notes if any */}
                {targetDraftData.draft?.notes && (
                  <div className="p-3 bg-muted/40 rounded-xl border text-xs">
                    <span className="text-muted-foreground font-medium">Ghi chú từ độc giả: </span>
                    <span className="text-foreground italic">“{targetDraftData.draft.notes}”</span>
                  </div>
                )}
              </div>

              <DialogFooter className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftApprovalModalOpen(false)}
                  disabled={isApprovingDraft}
                  className="text-xs w-full sm:w-auto"
                >
                  Đóng
                </Button>

                {(() => {
                  const isDraftExceedingLimit = (targetDraftData.activeBorrowsCount || 0) + (targetDraftData.items?.length || 0) > (targetDraftData.maxBooks || 5);
                  const isBlocked = isApprovingDraft || targetDraftData.eligibility?.canBorrow === false || isDraftExceedingLimit;

                  return (
                    <Button
                      size="sm"
                      onClick={handleConfirmApproveDraft}
                      disabled={isBlocked}
                      className={`font-bold text-xs gap-2 w-full sm:w-auto shadow-md ${
                        isBlocked
                          ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                      }`}
                    >
                      <Zap className="h-4 w-4" />
                      {isApprovingDraft
                        ? "Đang xuất kho..."
                        : isDraftExceedingLimit
                        ? `⛔ Không thể duyệt: Vượt hạn mức (${targetDraftData.activeBorrowsCount || 0} + ${targetDraftData.items?.length || 0} / ${targetDraftData.maxBooks || 5} cuốn)`
                        : `⚡ Xác Nhận Xuất Kho Toàn Bộ ${targetDraftData.items?.length || 0} Cuốn Sách (1-Chạm)`}
                    </Button>
                  );
                })()}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal 1: Reader/Librarian - Mã QR Trả Sách Gom Nhiều Cuốn */}
      {renderReturnBundleModal()}

      {/* Modal 2: Librarian - Xác Nhận Nhận Trả Hàng Loạt N Cuốn Sách (1-Quét) */}
      <Dialog open={bulkReturnModalOpen} onOpenChange={setBulkReturnModalOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          {bulkReturnData && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600 text-white font-semibold">
                    Thu Hồi Sách Hàng Loạt (1-Quét)
                  </Badge>
                  <code className="px-2 py-0.5 bg-muted rounded border font-mono font-bold text-xs">
                    {bulkReturnData.batchCode}
                  </code>
                </div>
                <DialogTitle className="font-display text-base font-bold mt-1 text-foreground flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-emerald-600" />
                  Xác Nhận Nhận Trả {bulkReturnData.books?.length || 0} Cuốn Sách Vào Kho
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Thủ thư kiểm đếm số lượng sách thực tế và bấm 1 chạm để hoàn tất thu hồi toàn bộ ấn phẩm vào kho.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-1">
                {/* 1. Reader info banner */}
                <div className="p-3.5 bg-muted/30 border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-emerald-500/20">
                      <AvatarFallback className="bg-emerald-600 text-white font-bold">
                        {bulkReturnData.reader?.fullName?.charAt(0) || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h4 className="font-bold text-sm text-foreground">{bulkReturnData.reader?.fullName}</h4>
                      <p className="text-muted-foreground font-mono text-[11px]">
                        Mã thẻ: <strong className="text-primary">{bulkReturnData.reader?.cardNumber}</strong>
                        {bulkReturnData.reader?.phone && ` • SĐT: ${bulkReturnData.reader?.phone}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-semibold">
                      Tổng nhận trả: {bulkReturnData.books?.length || 0} cuốn
                    </Badge>
                  </div>
                </div>

                {/* 2. Overdue warning if any */}
                {bulkReturnData.hasOverdue && bulkReturnData.totalFine > 0 && (
                  <div className="p-3.5 bg-destructive/10 border border-destructive/30 rounded-xl text-xs text-destructive space-y-1">
                    <div className="flex items-center gap-2 font-bold">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>CẢNH BÁO: CÓ SÁCH QUÁ HẠN CẦN THU PHÍ PHẠT</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Trong danh sách gom trả có sách đã quá hạn. Tổng tiền phạt trễ hạn cần thu là: <strong className="text-sm font-bold underline">{bulkReturnData.totalFine?.toLocaleString('vi-VN')}đ</strong> (5.000đ/ngày/cuốn).
                    </p>
                  </div>
                )}

                {/* 3. Books list */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground">
                    Danh sách các cuốn sách thu hồi vào kho:
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {bulkReturnData.books?.map((b: any, idx: number) => (
                      <div key={b.recordId || idx} className="p-3 bg-card border rounded-xl flex items-center justify-between gap-3 text-xs shadow-2xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-6 w-6 rounded-full bg-emerald-500/10 text-emerald-700 font-bold text-xs flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          {b.coverImage ? (
                            <img src={b.coverImage} alt={b.bookTitle} className="h-10 w-8 object-cover rounded shrink-0 shadow-2xs" />
                          ) : (
                            <div className="h-10 w-8 bg-muted rounded flex items-center justify-center text-xs shrink-0">📚</div>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-foreground text-xs truncate">{b.bookTitle}</p>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                              <code className="bg-muted px-1 py-0.2 rounded font-mono text-[10px] text-primary font-bold">
                                {b.qrCode}
                              </code>
                              <span>• Hạn trả: {new Date(b.dueDate).toLocaleDateString('vi-VN')}</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {b.isOverdue ? (
                            b.isFinePaid ? (
                              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]">
                                ✓ Đã nộp phạt online
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                Quá hạn {b.overdueDays} ngày ({b.fineAmount?.toLocaleString('vi-VN')}đ)
                              </Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-300 text-[10px]">
                              ✓ Đúng hạn
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter className="pt-3 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkReturnModalOpen(false)}
                  disabled={isSubmittingBulkReturn}
                  className="text-xs w-full sm:w-auto"
                >
                  Hủy bỏ
                </Button>

                <Button
                  size="sm"
                  onClick={handleExecuteBulkReturn}
                  disabled={isSubmittingBulkReturn}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 w-full sm:w-auto shadow-md cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isSubmittingBulkReturn
                    ? "Đang ghi nhận trả sách..."
                    : bulkReturnData.hasOverdue && bulkReturnData.totalFine > 0
                    ? `✓ Đã thu ${(bulkReturnData.totalFine || 0).toLocaleString('vi-VN')}đ & Nhận Trả ${bulkReturnData.books?.length || 0} Cuốn`
                    : `✓ Xác Nhận Nhận Trả Toàn Bộ ${bulkReturnData.books?.length || 0} Cuốn Vào Kho`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Cảnh báo & Đặt trước khi sách đã có người giữ chỗ 24h */}
      <Dialog open={Boolean(heldBookModalData?.open)} onOpenChange={(open) => {
        if (!open) setHeldBookModalData(null);
      }}>
        <DialogContent className="max-w-md sm:max-w-lg">
          {heldBookModalData && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive" className="font-semibold px-2.5 py-0.5 text-xs bg-red-600 hover:bg-red-700 flex items-center gap-1.5 shadow-xs">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    ĐÃ CÓ NGƯỜI GIỮ CHỖ 24H
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs border-amber-500/40 text-amber-700 dark:text-amber-300">
                    {heldBookModalData.copyQr}
                  </Badge>
                </div>
                <DialogTitle className="font-display text-lg font-bold text-foreground mt-2 flex items-center gap-2">
                  <span>⛔ Không thể quét mượn ấn phẩm này</span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Hệ thống Thư viện Thông minh phát hiện cuốn sách bạn vừa quét đang có độc giả khác đăng ký giữ chỗ hợp lệ.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3.5 py-1">
                {/* Book Card Details */}
                <div className="p-3 bg-muted/40 rounded-xl border border-border/80 flex items-center gap-3">
                  <div className="h-12 w-10 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <BookOpen className="h-5 w-5 text-amber-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-sm text-foreground truncate">
                      {heldBookModalData.bookTitle}
                    </h4>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <span>Mã bản sao quét:</span>
                      <code className="font-mono font-bold text-foreground bg-muted px-1 rounded">{heldBookModalData.copyQr}</code>
                    </p>
                  </div>
                </div>

                {/* Hold Details List */}
                <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-300/80 dark:border-amber-900/60 space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-semibold text-amber-950 dark:text-amber-200">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-amber-600" />
                      Thông tin độc giả giữ chỗ trực tuyến:
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border-amber-300">
                      {heldBookModalData.holdCount} bạn đọc đã hẹn
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    {heldBookModalData.holds?.map((h: any, idx: number) => (
                      <div key={idx} className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-amber-200/80 dark:border-amber-900/50 flex items-center justify-between text-xs shadow-2xs">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-[11px] bg-amber-100 text-amber-900 font-bold border border-amber-300">
                              {h.reader_name?.slice(0, 1) || "ĐG"}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <span className="font-bold text-foreground text-xs">{h.reader_name}</span>
                            <span className="text-[11px] text-muted-foreground ml-1.5 font-mono">
                              ({h.card_number || 'Độc giả'})
                            </span>
                          </div>
                        </div>
                        <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300 text-[10px] font-semibold">
                          Còn {Math.max(1, (h.time_left_hours !== null && h.time_left_hours !== undefined) ? h.time_left_hours : 24)}h giữ chỗ
                        </Badge>
                      </div>
                    ))}
                  </div>

                  <div className="text-[11px] text-amber-900/90 dark:text-amber-200/90 leading-relaxed pt-1 bg-amber-100/50 dark:bg-amber-950/60 p-2 rounded-lg border border-amber-200 dark:border-amber-900/40">
                    👉 <strong>Quy định thư viện:</strong> Độc giả đã đăng ký online được bảo lưu cuốn sách này trên kệ trong vòng 24 giờ. Vui lòng để lại cuốn sách này trên kệ để độc giả đã hẹn trước đến nhận theo lịch.
                  </div>
                </div>

                {/* Smart Option: 1-Click Waitlist Reservation */}
                <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 space-y-1">
                  <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Bạn muốn mượn đọc cuốn sách này?
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Bạn có thể bấm <strong>"Đặt trước sách (Xếp hàng)"</strong> ngay dưới đây. Hệ thống sẽ tự động gửi thông báo ưu tiên mượn ngay khi sách được trả hoặc khi người giữ chỗ hết hạn 24h!
                  </p>
                </div>
              </div>

              <DialogFooter className="pt-2 border-t flex flex-col sm:flex-row items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHeldBookModalData(null)}
                  className="w-full sm:w-auto text-xs"
                >
                  Đã hiểu, để lại sách trên kệ
                </Button>

                {heldBookModalData.bookId && (
                  <Button
                    size="sm"
                    onClick={handleReserveFromHeldModal}
                    disabled={isReservingFromModal}
                    className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 shadow-xs"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    {isReservingFromModal ? "Đang đăng ký xếp hàng..." : "Đặt Trước Sách (Xếp Hàng Nhận Sách)"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}

      {/* Smart Library 4.0: Exit Pass Modal */}
      <ExitPassModal
        open={exitPassModalOpen}
        onOpenChange={setExitPassModalOpen}
        passData={myExitPassData}
      />

      {/* Smart Library 4.0: Smart Book Drop 24/7 Modal */}
      <SmartBookDropModal
        open={smartBookDropOpen}
        onOpenChange={setSmartBookDropOpen}
        onSuccess={() => {
          fetchHistory();
          fetchDropBoxCount();
        }}
        myBorrowingBooks={history.filter(h => h.status === 'borrowing')}
      />

      {/* Smart Library 4.0: Security Exit Scanner Modal */}
      <SecurityExitScannerModal
        open={securityScannerOpen}
        onOpenChange={setSecurityScannerOpen}
        onSuccess={() => {
          fetchHistory();
        }}
      />

      {/* Smart Library 4.0: Book Drop Morning Audit Modal */}
      <BookDropAuditModal
        open={bookDropAuditOpen}
        onOpenChange={setBookDropAuditOpen}
        onSuccess={() => {
          fetchHistory();
          fetchDropBoxCount();
        }}
      />
    </div>
  );
}
