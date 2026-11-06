import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Scan, QrCode, Search, User, BookOpen, Clock, AlertTriangle,
  CheckCircle2, ArrowRightLeft, Zap, Trash2, X, RefreshCw,
  Camera, Check, ChevronRight, FileSpreadsheet, ShieldAlert,
  CreditCard, Banknote, Sparkles, AlertCircle, ArrowUpRight, Upload, Wallet, MapPin,
  Inbox
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import api from "@/services/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Html5Qrcode } from "html5-qrcode";
import { ExitPassModal } from "@/components/exit-pass-modal";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LibraryMiniMapModal } from "@/components/library-mini-map-modal";
import { BookDropAuditModal } from "@/components/book-drop-audit-modal";

// Sound synthesis via Web Audio API for snappy tactile feedback
const playTone = (type: "beep" | "success" | "error") => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "beep") {
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "success") {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1000, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === "error") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch (e) {
    // Audio context may not be allowed before user interaction
  }
};

interface BasketItem {
  id: string; // unique key in basket
  actionType: "borrow" | "return" | "reservation" | "draft";
  bookId: number;
  bookTitle: string;
  copyQr: string;
  coverImage?: string;
  dueDate?: string;
  borrowDate?: string;
  overdueDays?: number;
  fineAmount?: number;
  reservationId?: number;
  location?: string;
  draftCode?: string;
  draftId?: number;
  borrowerName?: string;
  borrowerCardNumber?: string;
  isDropBox?: boolean;
  dropBoxAt?: string;
}

interface ScannedReader {
  id: number;
  full_name: string;
  card_number: string;
  email?: string;
  phone?: string;
  status: string;
  maxBooksAllowed?: number;
  activeBorrowCount?: number;
  canBorrow?: boolean;
  borrowBlockReason?: string | null;
  activeBorrows?: any[];
  readyReservations?: any[];
  unpaidFines?: any[];
  totalUnpaidFines?: number;
  activeDraft?: any;
  dropBoxPendingLoans?: any[];
}

interface RecentTransaction {
  id: number;
  borrow_date: string;
  status: string;
  reader_name: string;
  card_number: string;
  book_title: string;
  qr_code: string;
}

export function SmartCounter() {
  const { user } = useAuth();
  const [scanInput, setScanInput] = useState("");
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Desk Active State
  const [currentReader, setCurrentReader] = useState<ScannedReader | null>(null);
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Exit Pass Modal State
  const [exitPassModalOpen, setExitPassModalOpen] = useState(false);
  const [exitPassData, setExitPassData] = useState<any>(null);

  // Bank & Payment Config
  const [bankConfig, setBankConfig] = useState<any>(null);
  const [finePaidMethod, setFinePaidMethod] = useState<"cash" | "vietqr">("cash");
  const [includeOldFines, setIncludeOldFines] = useState(true);

  // Camera Dialog
  const [cameraOpen, setCameraOpen] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const cameraFileInputRef = useRef<HTMLInputElement>(null);

  // Online Draft Approval & Physical Copy Verification Modal
  const [draftApprovalModalOpen, setDraftApprovalModalOpen] = useState(false);
  const [targetDraftData, setTargetDraftData] = useState<any>(null);
  const [copyOverrides, setCopyOverrides] = useState<Record<number, string>>({});
  const [isApprovingDraft, setIsApprovingDraft] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<any[]>([]);
  const [pendingDraftsModalOpen, setPendingDraftsModalOpen] = useState(false);
  const [isRefreshingDrafts, setIsRefreshingDrafts] = useState(false);

  // Mini Map Modal for shelf location
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [miniMapTarget, setMiniMapTarget] = useState<{ location?: string; title?: string; cover?: string }>({});

  const [searchParams] = useSearchParams();
  const [bookDropModalOpen, setBookDropModalOpen] = useState(false);
  const [dropBoxPendingCount, setDropBoxPendingCount] = useState(0);
  const [isRefreshingDropBox, setIsRefreshingDropBox] = useState(false);

  // Recent 5 History Records for Quick Desk Audit
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);

  const fetchRecentHistory = async () => {
    try {
      const res = await api.get("/borrow/records");
      if (Array.isArray(res.data)) {
        setRecentTransactions(res.data.slice(0, 5));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchDropBoxCount = async () => {
    try {
      setIsRefreshingDropBox(true);
      const res = await api.get("/borrow/drop-box-items");
      if (Array.isArray(res.data)) {
        setDropBoxPendingCount(res.data.length);
      }
    } catch (e) {
      console.error("Lỗi khi tải danh sách sách trong hòm 24/7:", e);
    } finally {
      setIsRefreshingDropBox(false);
    }
  };

  const fetchPendingDrafts = async () => {
    try {
      setIsRefreshingDrafts(true);
      const res = await api.get("/borrow/drafts/pending-list");
      setPendingDrafts(res.data || []);
    } catch (e) {
      console.error("Lỗi khi tải hàng đợi phiếu mượn online:", e);
    } finally {
      setIsRefreshingDrafts(false);
    }
  };

  const handleOpenPendingDraftsModal = async () => {
    await fetchPendingDrafts();
    setPendingDraftsModalOpen(true);
  };

  const fetchBankConfig = async () => {
    try {
      const res = await api.get("/fines/bank-config");
      setBankConfig(res.data);
    } catch (e) {
      // Ignore if not configured
    }
  };

  useEffect(() => {
    if (searchParams.get("mode") === "dropbox") {
      setBookDropModalOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchRecentHistory();
    fetchBankConfig();
    fetchPendingDrafts();
    fetchDropBoxCount();

    // Auto-sync pending online drafts & drop box count every 8 seconds
    const syncInterval = setInterval(() => {
      fetchPendingDrafts();
      fetchDropBoxCount();
    }, 8000);

    // Auto-focus input on mount
    scanInputRef.current?.focus();

    return () => clearInterval(syncInterval);
  }, []);

  // Global Keyboard Shortcuts (F2: focus scan, F9: complete, Escape: clear desk)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
      } else if (e.key === "F9") {
        e.preventDefault();
        if ((basket.length > 0 || totalFinesToCollect > 0) && !isSubmitting) {
          handleCompleteSession();
        }
      } else if (e.key === "Escape") {
        if (basket.length > 0 || currentReader) {
          handleResetDesk();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [basket, currentReader, isSubmitting]);

  // Load Reader by Card Number
  const loadReaderProfile = async (cardNumber: string, autoPopulateDraft = true) => {
    try {
      const cleanCode = cardNumber.trim();
      const res = await api.get(`/borrow/reader-checkout-info/${encodeURIComponent(cleanCode)}`);
      const data = res.data;
      const readerObj = data?.reader || data?.user;
      if (data && readerObj) {
        const readerData: ScannedReader = {
          id: readerObj.id,
          full_name: readerObj.full_name,
          card_number: readerObj.card_number,
          email: readerObj.email,
          phone: readerObj.phone,
          status: readerObj.status,
          maxBooksAllowed: data.maxBooks || data.maxBooksAllowed || 5,
          activeBorrowCount: (data.activeBorrows ? data.activeBorrows.length : (data.activeBorrowCount || 0)),
          canBorrow: data.canBorrow !== false,
          borrowBlockReason: data.borrowBlockReason,
          activeBorrows: data.activeBorrows || [],
          readyReservations: data.readyReservations || [],
          unpaidFines: data.unpaidFines || [],
          totalUnpaidFines: data.totalUnpaidFines || 0,
          activeDraft: data.activeDraft || null,
          dropBoxPendingLoans: data.dropBoxPendingLoans || []
        };

        setCurrentReader(readerData);
        playTone("beep");

        // Automatically bind existing borrow items in basket to this newly scanned reader
        setBasket(prev => {
          const hasBorrowItems = prev.some(it => it.actionType === "borrow" && !it.borrowerCardNumber);
          if (hasBorrowItems) {
            return prev.map(it => {
              if (it.actionType === "borrow" && !it.borrowerCardNumber) {
                return {
                  ...it,
                  borrowerName: readerData.full_name,
                  borrowerCardNumber: readerData.card_number
                };
              }
              return it;
            });
          }
          return prev;
        });

        // Automatically load verified draft books into basket so librarian can complete in 1-click
        if (autoPopulateDraft && data.activeDraft && data.activeDraft.items && data.activeDraft.items.length > 0) {
          const verifiedItems = data.activeDraft.items.filter((it: any) => it.copy_qr_code);
          if (verifiedItems.length > 0) {
            setBasket(prev => {
              const newItems = verifiedItems
                .filter((it: any) => !prev.some(b => b.copyQr === it.copy_qr_code))
                .map((it: any) => ({
                  id: `draft-${it.copy_qr_code}`,
                  actionType: "draft" as const,
                  bookId: it.book_id,
                  bookTitle: it.book_title,
                  copyQr: it.copy_qr_code,
                  coverImage: it.cover_image,
                  location: it.location,
                  draftCode: data.activeDraft.draft_code,
                  draftId: data.activeDraft.id,
                  borrowerName: readerData.full_name,
                  borrowerCardNumber: readerData.card_number
                }));
              return [...prev, ...newItems];
            });
            toast.success(`Đã nạp hồ sơ: ${readerData.full_name} (${readerData.card_number}) kèm Phiếu Mượn Online ${data.activeDraft.draft_code}!`);
            return true;
          }
        }

        toast.success(`Đã nạp hồ sơ độc giả: ${readerData.full_name} (${readerData.card_number})`);
        return true;
      }
      return false;
    } catch (error: any) {
      playTone("error");
      toast.error(error.response?.data?.message || "Không tìm thấy hồ sơ độc giả với mã này");
      return false;
    }
  };

  // Mở hộp thoại Phê Duyệt Phiếu Mượn Online (1-Chạm) & Đối Soát Mã Tem Gáy Sách Tại Quầy
  const handleOpenDraftByCode = async (draftCode: string) => {
    try {
      const res = await api.get(`/borrow/drafts/${encodeURIComponent(draftCode)}`);
      const data = res.data;
      const isDraftOverLimit =
        (data.activeBorrowsCount ?? data.eligibility?.activeCount ?? 0) +
          (data.items?.length || data.draft?.items?.length || 0) >
        (data.maxBooks ?? data.eligibility?.maxBooks ?? 5);

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
      playTone("beep");

      if (isDraftOverLimit || data.eligibility?.canBorrow === false) {
        toast.error(
          normalizedData.eligibility?.borrowBlockReason ||
            "Cảnh báo: Độc giả đã đạt giới hạn mượn sách hoặc phiếu mượn vượt quá hạn mức tối đa!",
          { duration: 6000 }
        );
      } else {
        toast.success(`Đã tải phiếu mượn online: ${draftCode}`);
      }
    } catch (err: any) {
      playTone("error");
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
      const draftCode = targetDraftData.draft.draft_code;
      // Optimistically remove approved draft from pending queue immediately
      setPendingDrafts(prev => prev.filter(d => d.draft_code !== draftCode));

      const res = await api.post(`/borrow/drafts/${encodeURIComponent(draftCode)}/approve`, {
        copyOverrides
      });
      playTone("success");
      toast.success(res.data.message || `Đã duyệt xuất kho thành công cho độc giả ${targetDraftData.draft.reader_name}!`);

      if (res.data?.exitPass) {
        setExitPassData(res.data.exitPass);
        setExitPassModalOpen(true);
      }

      setDraftApprovalModalOpen(false);
      setTargetDraftData(null);
      setCopyOverrides({});

      fetchRecentHistory();
      await fetchPendingDrafts();

      if (currentReader) {
        await loadReaderProfile(currentReader.card_number, false);
      }
    } catch (err: any) {
      playTone("error");
      toast.error(err.response?.data?.message || "Không thể phê duyệt phiếu mượn online");
      await fetchPendingDrafts();
    } finally {
      setIsApprovingDraft(false);
    }
  };

  const handleLoadDraftToBasket = (draft: any) => {
    if (!draft || !draft.items) return;
    const itemsToAdd: BasketItem[] = [];
    draft.items.forEach((it: any) => {
      const copyQr = it.copy_qr_code || `PENDING-BK-${it.book_id}`;
      if (!basket.some(b => b.copyQr === copyQr)) {
        itemsToAdd.push({
          id: `draft-${copyQr}`,
          actionType: "draft",
          bookId: it.book_id,
          bookTitle: it.book_title,
          copyQr: copyQr,
          coverImage: it.cover_image,
          location: it.location,
          draftCode: draft.draft_code,
          draftId: draft.id,
          borrowerName: draft.reader_name || currentReader?.full_name,
          borrowerCardNumber: draft.card_number || currentReader?.card_number
        });
      }
    });
    if (itemsToAdd.length > 0) {
      setBasket(prev => [...prev, ...itemsToAdd]);
      playTone("beep");
      toast.success(`Đã nạp ${itemsToAdd.length} cuốn sách từ Phiếu Mượn Online ${draft.draft_code} vào giỏ!`);
    } else {
      toast.info("Các sách trong phiếu đã có trong giỏ giao dịch.");
    }
  };

  const handleQuickApproveDraft = async (draftCode: string) => {
    try {
      setIsSubmitting(true);
      // Optimistically remove from pending queue immediately
      setPendingDrafts(prev => prev.filter(d => d.draft_code !== draftCode));

      const res = await api.post(`/borrow/drafts/${encodeURIComponent(draftCode)}/approve`);
      playTone("success");
      toast.success(res.data.message || `Đã duyệt thành công phiếu mượn online ${draftCode}!`);
      if (res.data?.exitPass) {
        setExitPassData(res.data.exitPass);
        setExitPassModalOpen(true);
      }
      setBasket(prev => prev.filter(i => i.actionType !== "draft"));
      if (currentReader) {
        await loadReaderProfile(currentReader.card_number, false);
      }
      fetchRecentHistory();
      await fetchPendingDrafts();
    } catch (err: any) {
      playTone("error");
      toast.error(err.response?.data?.message || "Không thể phê duyệt phiếu mượn online");
      await fetchPendingDrafts();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add single active borrow item to Return Basket
  const addLoanToReturnBasket = (loan: any) => {
    if (basket.some(item => item.copyQr === loan.qr_code)) {
      toast.warning(`Ấn phẩm [${loan.qr_code}] đã có trong giỏ trả sách!`);
      return;
    }
    const overdueDays = loan.overdue_days || 0;
    // If fine is already paid, do not charge again!
    const fine = loan.fine_already_paid ? 0 : (loan.fine_amount || 0);

    const newItem: BasketItem = {
      id: `ret-${loan.qr_code}`,
      actionType: "return",
      bookId: loan.book_id || loan.bookId,
      bookTitle: loan.book_title || loan.bookTitle,
      copyQr: loan.qr_code,
      coverImage: loan.cover_image,
      borrowDate: loan.borrow_date,
      dueDate: loan.due_date,
      overdueDays: overdueDays,
      fineAmount: fine,
      location: loan.location,
      borrowerName: currentReader?.full_name || loan.reader_name,
      borrowerCardNumber: currentReader?.card_number || loan.card_number
    };

    setBasket(prev => [...prev, newItem]);
    playTone("beep");
    toast.info(`🔄 Nghiệp vụ: TRẢ SÁCH — Đã thêm vào giỏ cuốn «${newItem.bookTitle}» (${newItem.borrowerName || "bạn đọc"})`);
  };

  // Add all active borrows of current reader to Return Basket
  const handleReturnAllBorrows = () => {
    if (!currentReader?.activeBorrows || currentReader.activeBorrows.length === 0) return;
    let addedCount = 0;
    const newItems: BasketItem[] = [];

    for (const loan of currentReader.activeBorrows) {
      if (!basket.some(item => item.copyQr === loan.qr_code)) {
        const overdueDays = loan.overdue_days || 0;
        const fine = loan.fine_already_paid ? 0 : (loan.fine_amount || 0);

        newItems.push({
          id: `ret-${loan.qr_code}`,
          actionType: "return",
          bookId: loan.book_id || loan.bookId,
          bookTitle: loan.book_title || loan.bookTitle,
          copyQr: loan.qr_code,
          coverImage: loan.cover_image,
          borrowDate: loan.borrow_date,
          dueDate: loan.due_date,
          overdueDays: overdueDays,
          fineAmount: fine,
          location: loan.location,
          borrowerName: currentReader.full_name,
          borrowerCardNumber: currentReader.card_number
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      setBasket(prev => [...prev, ...newItems]);
      playTone("beep");
      toast.success(`Đã thêm ${addedCount} cuốn sách vào giỏ TRẢ SÁCH cho bạn đọc ${currentReader.full_name}!`);
    } else {
      toast.info("Tất cả sách đang mượn đã có trong giỏ trả.");
    }
  };

  // Main Unified Scan Processor
  const handleProcessCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    setIsProcessingScan(true);
    setScanInput("");

    try {
      const upperCode = code.toUpperCase();

      // 0. Check if code is a Draft Borrow Code (DRAFT-BRW-... or DRAFT-... or BRW-...)
      if (upperCode.startsWith("DRAFT-BRW-") || upperCode.startsWith("DRAFT-") || upperCode.startsWith("BRW-")) {
        await handleOpenDraftByCode(code);
        setIsProcessingScan(false);
        scanInputRef.current?.focus();
        return;
      }

      // 0b. Check if code is a Reservation ticket code (TICKET-RES-... or RESV-...)
      if (upperCode.startsWith("TICKET-RES-") || upperCode.startsWith("TICKET-") || upperCode.startsWith("RESV-") || upperCode.startsWith("RES-")) {
        const isLoaded = await loadReaderProfile(code, true);
        if (isLoaded) {
          setIsProcessingScan(false);
          scanInputRef.current?.focus();
          return;
        }
      }

      // 1. Check if the code is definitely a Reader ID or user identifier
      const isExplicitReaderCode =
        upperCode.startsWith("LIB-RD-") ||
        upperCode.startsWith("RD-") ||
        upperCode.startsWith("READER-") ||
        upperCode.startsWith("USER-") ||
        upperCode.startsWith("UID-");

      // Or if no reader is currently active and it's not a book code:
      const isPossibleReaderCode =
        !currentReader &&
        !upperCode.startsWith("QR-BK-") &&
        !upperCode.startsWith("BK-") &&
        !upperCode.startsWith("BC-") &&
        !upperCode.startsWith("LIB-BK-") &&
        !upperCode.includes("-BK-");

      if (isExplicitReaderCode || isPossibleReaderCode) {
        const isReaderLoaded = await loadReaderProfile(code);
        if (isReaderLoaded) {
          setIsProcessingScan(false);
          scanInputRef.current?.focus();
          return;
        }
        // If it was explicitly a reader format and failed, stop here
        if (isExplicitReaderCode) {
          setIsProcessingScan(false);
          scanInputRef.current?.focus();
          return;
        }
      }

      // 2. Otherwise, check if code is a Book Copy QR
      const copyRes = await api.get(`/borrow/check-copy/${encodeURIComponent(code)}`);
      const copy = copyRes.data;

      if (!copy) {
        playTone("error");
        toast.error(`Mã [${code}] không tồn tại trên hệ thống`);
        setIsProcessingScan(false);
        return;
      }

      // Check if already in basket
      if (basket.some(item => item.copyQr === copy.qr_code)) {
        playTone("error");
        toast.warning(`Ấn phẩm [${copy.qr_code}] đã có trong giỏ xử lý lượt này!`);
        setIsProcessingScan(false);
        return;
      }

      // DECISION LOGIC: DROP BOX vs RETURN vs BORROW vs RESERVATION
      if (copy.is_drop_box_pending || copy.status === "returned_drop_box") {
        const borrowerCard = copy.borrower_card_number;
        const borrowerName = copy.borrower_name;
        if (borrowerCard && (!currentReader || currentReader.card_number !== borrowerCard)) {
          await loadReaderProfile(borrowerCard, false);
        }
        playTone("beep");
        toast.info(
          `📦 Ấn phẩm «${copy.book_title}» (${copy.qr_code}) đã được thả vào Hòm trả 24/7! Đang mở hộp thoại đối soát kiểm kê...`,
          { duration: 4000 }
        );
        setBookDropModalOpen(true);
        setIsProcessingScan(false);
        scanInputRef.current?.focus();
        return;
      }

      const isCurrentlyBorrowed = copy.status === "borrowed" || Boolean(copy.active_borrow_id) || Boolean(copy.borrower_card_number);

      // ==========================================
      // PHÂN HỆ 1: NGHIỆP VỤ TRẢ SÁCH (RETURN)
      // ==========================================
      if (isCurrentlyBorrowed) {
        // Tự động tải đầy đủ thông tin bạn đọc đang mượn ấn phẩm này lên khung hồ sơ bên trái
        const borrowerCard = copy.borrower_card_number;
        const borrowerName = copy.borrower_name;

        if (borrowerCard && (!currentReader || currentReader.card_number !== borrowerCard)) {
          await loadReaderProfile(borrowerCard, false);
        }

        const overdueDays = copy.due_date
          ? Math.max(0, Math.ceil((Date.now() - new Date(copy.due_date).getTime()) / (1000 * 60 * 60 * 24)))
          : 0;
        const fineAmount = overdueDays > 0 ? overdueDays * 5000 : 0;

        const newItem: BasketItem = {
          id: `ret-${copy.qr_code}`,
          actionType: "return",
          bookId: copy.book_id,
          bookTitle: copy.book_title,
          copyQr: copy.qr_code,
          coverImage: copy.cover_image,
          borrowDate: copy.borrow_date,
          dueDate: copy.due_date,
          overdueDays,
          fineAmount,
          location: copy.location,
          borrowerName: borrowerName || currentReader?.full_name,
          borrowerCardNumber: borrowerCard || currentReader?.card_number
        };

        setBasket(prev => [...prev, newItem]);
        playTone("beep");
        toast.success(
          `🔄 Nghiệp vụ: TRẢ SÁCH — Đã nhận ấn phẩm «${copy.book_title}» từ bạn đọc ${borrowerName || "độc giả"}${borrowerCard ? ` (${borrowerCard})` : ""}!${overdueDays > 0 ? ` [Quá hạn ${overdueDays} ngày - Phạt: ${fineAmount.toLocaleString("vi-VN")} đ]` : ""}`
        );
        setIsProcessingScan(false);
        scanInputRef.current?.focus();
        return;
      }

      // ==========================================
      // PHÂN HỆ 2: NHẬN SÁCH ĐẶT TRƯỚC (RESERVATION)
      // ==========================================
      if (currentReader && currentReader.readyReservations?.some(r => r.book_id === copy.book_id)) {
        const matchedResv = currentReader.readyReservations.find(r => r.book_id === copy.book_id);
        const newItem: BasketItem = {
          id: `resv-${copy.qr_code}`,
          actionType: "reservation",
          bookId: copy.book_id,
          bookTitle: copy.book_title,
          copyQr: copy.qr_code,
          coverImage: copy.cover_image,
          reservationId: matchedResv.reservation_id,
          location: copy.location,
          borrowerName: currentReader.full_name,
          borrowerCardNumber: currentReader.card_number
        };

        setBasket(prev => [...prev, newItem]);
        playTone("beep");
        toast.success(`✨ Nghiệp vụ: NHẬN ĐẶT TRƯỚC — Đã thêm cuốn «${copy.book_title}» cho bạn đọc ${currentReader.full_name}!`);
        setIsProcessingScan(false);
        scanInputRef.current?.focus();
        return;
      }

      // ==========================================
      // PHÂN HỆ 3: NGHIỆP VỤ MƯỢN MỚI (BORROW)
      // ==========================================
      if (copy.status === "available") {
        if (!currentReader) {
          // Cho phép đưa vào giỏ trước và nhắc thủ thư quét thẻ độc giả
          const newItem: BasketItem = {
            id: `borrow-${copy.qr_code}`,
            actionType: "borrow",
            bookId: copy.book_id,
            bookTitle: copy.book_title,
            copyQr: copy.qr_code,
            coverImage: copy.cover_image,
            location: copy.location
          };
          setBasket(prev => [...prev, newItem]);
          playTone("beep");
          toast.info(
            `📖 Nghiệp vụ: MƯỢN MỚI — Đã thêm cuốn «${copy.book_title}» vào giỏ. Vui lòng quét THẺ ĐỘC GIẢ để hoàn tất cho mượn!`,
            { duration: 5000 }
          );
          setIsProcessingScan(false);
          scanInputRef.current?.focus();
          return;
        }

        if (!currentReader.canBorrow) {
          playTone("error");
          toast.error(`Độc giả không đủ điều kiện mượn: ${currentReader.borrowBlockReason || "Bị khóa hoặc nợ phạt"}`);
          setIsProcessingScan(false);
          return;
        }

        const currentBorrowCount = (currentReader.activeBorrowCount || 0) + basket.filter(i => i.actionType === "borrow" || i.actionType === "reservation" || i.actionType === "draft").length;
        const maxBooks = currentReader.maxBooksAllowed || 5;

        if (currentBorrowCount >= maxBooks) {
          playTone("error");
          toast.error(`Độc giả đã đạt giới hạn mượn tối đa (${currentBorrowCount}/${maxBooks} cuốn). Cần trả bớt sách trước!`);
          setIsProcessingScan(false);
          return;
        }

        const isDraftBook = currentReader.activeDraft?.items?.some((it: any) => it.book_id === copy.book_id);
        const actionType: "borrow" | "draft" = isDraftBook ? "draft" : "borrow";
        const draftCode = isDraftBook ? currentReader.activeDraft.draft_code : undefined;
        const draftId = isDraftBook ? currentReader.activeDraft.id : undefined;

        const newItem: BasketItem = {
          id: `${actionType}-${copy.qr_code}`,
          actionType: actionType,
          bookId: copy.book_id,
          bookTitle: copy.book_title,
          copyQr: copy.qr_code,
          coverImage: copy.cover_image,
          location: copy.location,
          draftCode,
          draftId,
          borrowerName: currentReader.full_name,
          borrowerCardNumber: currentReader.card_number
        };

        setBasket(prev => [...prev, newItem]);
        playTone("beep");
        toast.success(
          isDraftBook
            ? `⚡ Nghiệp vụ: MƯỢN ONLINE (${draftCode}) — Đã nạp cuốn «${copy.book_title}» cho bạn đọc ${currentReader.full_name}!`
            : `📖 Nghiệp vụ: MƯỢN MỚI — Đã thêm cuốn «${copy.book_title}» cho bạn đọc ${currentReader.full_name}!`
        );
        setIsProcessingScan(false);
        scanInputRef.current?.focus();
        return;
      }

      // Other statuses
      playTone("error");
      toast.error(`Bản sao sách [${copy.qr_code}] đang ở trạng thái "${copy.status}", không thể lưu thông!`);
    } catch (error: any) {
      playTone("error");
      toast.error(error.response?.data?.message || `Không thể nhận diện mã [${code}]`);
    } finally {
      setIsProcessingScan(false);
      scanInputRef.current?.focus();
    }
  };

  const handleRemoveItem = (id: string) => {
    setBasket(prev => prev.filter(item => item.id !== id));
    scanInputRef.current?.focus();
  };

  const handleResetDesk = () => {
    setCurrentReader(null);
    setBasket([]);
    setIncludeOldFines(true);
    setScanInput("");
    scanInputRef.current?.focus();
    toast.info("Đã làm mới quầy giao dịch.");
  };

  // Quick Pay Old Fines Handler
  const handleQuickPayOldFines = async () => {
    if (!currentReader || !currentReader.unpaidFines || currentReader.unpaidFines.length === 0) return;
    setIsSubmitting(true);
    try {
      let successCount = 0;
      let totalPaid = 0;
      for (const fine of currentReader.unpaidFines) {
        await api.put(`/fines/${fine.id}/pay`, {
          payment_method: finePaidMethod === "vietqr" ? "transfer" : "cash",
          payment_channel: "counter",
          transaction_ref: finePaidMethod === "vietqr" ? `TXN-CTR-${fine.id}-${Date.now().toString().slice(-6)}` : null
        });
        successCount++;
        totalPaid += (Number(fine.amount) || 0);
      }
      playTone("success");
      toast.success(`Đã thu thành công ${totalPaid.toLocaleString("vi-VN")} đ tiền phạt cho độc giả ${currentReader.full_name}!`);
      loadReaderProfile(currentReader.card_number);
      fetchRecentHistory();
    } catch (err: any) {
      playTone("error");
      toast.error(err.response?.data?.message || "Không thể thực hiện thanh toán phí phạt");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Complete Transaction Session (Batch process basket & fine settlement)
  const handleCompleteSession = async () => {
    if (basket.length === 0 && totalFinesToCollect === 0) {
      toast.warning("Chưa có ấn phẩm hoặc phí phạt nào để quyết toán!");
      return;
    }

    const borrowItems = basket.filter(i => i.actionType === "borrow");
    if (borrowItems.length > 0 && !currentReader) {
      toast.warning("Vui lòng quét Thẻ độc giả trước khi hoàn tất phiên mượn sách!");
      scanInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    let successBorrowCount = 0;
    let successReturnCount = 0;
    let paidFinesAmount = 0;
    let errors: string[] = [];

    try {
      // 0. Settle Old Fines if checked
      if (includeOldFines && currentReader?.unpaidFines && currentReader.unpaidFines.length > 0) {
        for (const fine of currentReader.unpaidFines) {
          try {
            await api.put(`/fines/${fine.id}/pay`, {
              payment_method: finePaidMethod === "vietqr" ? "transfer" : "cash",
              payment_channel: "counter",
              transaction_ref: finePaidMethod === "vietqr" ? `TXN-CTR-${fine.id}-${Date.now().toString().slice(-6)}` : null
            });
            paidFinesAmount += (Number(fine.amount) || 0);
          } catch (err: any) {
            errors.push(`Thu phạt #${fine.id}: ${err.response?.data?.message || "Lỗi xử lý"}`);
          }
        }
      }
      // 1. Process all RETURNS first (frees up slots)
      const returnItems = basket.filter(i => i.actionType === "return");
      for (const item of returnItems) {
        try {
          await api.post("/borrow/return", {
            bookQrCode: item.copyQr,
            confirmPaidFine: true,
            paymentMethod: finePaidMethod
          });
          successReturnCount++;
        } catch (err: any) {
          errors.push(`Trả cuốn "${item.bookTitle}": ${err.response?.data?.message || "Lỗi xử lý"}`);
        }
      }

      // 2. Process all RESERVATIONS fulfillment
      const resvItems = basket.filter(i => i.actionType === "reservation");
      for (const item of resvItems) {
        try {
          await api.post("/borrow/approve-reservation", {
            reservationId: item.reservationId,
            bookCopyQr: item.copyQr
          });
          successBorrowCount++;
        } catch (err: any) {
          errors.push(`Nhận đặt trước "${item.bookTitle}": ${err.response?.data?.message || "Lỗi xử lý"}`);
        }
      }

      // 2b. Process all DRAFT BORROWS (Phiếu mượn online)
      const draftItems = basket.filter(i => i.actionType === "draft");
      if (draftItems.length > 0) {
        const draftCodes = Array.from(new Set(draftItems.map(i => i.draftCode).filter(Boolean))) as string[];
        for (const dCode of draftCodes) {
          try {
            const copyOverrides: Record<number, string> = {};
            draftItems.filter(i => i.draftCode === dCode && i.copyQr && !i.copyQr.startsWith("PENDING-")).forEach(i => {
              copyOverrides[i.bookId] = i.copyQr;
            });
            const res = await api.post(`/borrow/drafts/${encodeURIComponent(dCode)}/approve`, {
              copyOverrides
            });
            successBorrowCount += (res.data?.booksCount || draftItems.filter(i => i.draftCode === dCode).length);
            if (res.data?.exitPass) {
              setExitPassData(res.data.exitPass);
              setExitPassModalOpen(true);
            }
          } catch (err: any) {
            errors.push(`Duyệt phiếu online ${dCode}: ${err.response?.data?.message || "Lỗi xử lý"}`);
          }
        }
        setPendingDrafts(prev => prev.filter(d => !draftCodes.includes(d.draft_code)));
        await fetchPendingDrafts();
      }

      // 3. Process all DIRECT BORROWS
      for (const item of borrowItems) {
        try {
          await api.post("/borrow/borrow", {
            readerCardNumber: currentReader?.card_number,
            bookQrCode: item.copyQr
          });
          successBorrowCount++;
        } catch (err: any) {
          errors.push(`Mượn cuốn "${item.bookTitle}": ${err.response?.data?.message || "Lỗi xử lý"}`);
        }
      }

      if (errors.length === 0) {
        playTone("success");
        if (basket.length === 0 && paidFinesAmount > 0) {
          toast.success(`Đã thu thành công ${paidFinesAmount.toLocaleString("vi-VN")} đ tiền phạt cho độc giả ${currentReader?.full_name}!`);
          loadReaderProfile(currentReader!.card_number);
          fetchRecentHistory();
        } else {
          toast.success(
            `Giao dịch hoàn tất! (Mượn: ${successBorrowCount} cuốn, Nhận trả: ${successReturnCount} cuốn${paidFinesAmount > 0 ? `, Thu phạt: ${paidFinesAmount.toLocaleString("vi-VN")} đ` : ""})`
          );
          handleResetDesk();
          fetchRecentHistory();
          await fetchPendingDrafts();
        }
      } else {
        playTone("error");
        toast.error(`Có lỗi xảy ra trong phiên: ${errors.join("; ")}`);
        // Refresh reader profile if reader still active
        if (currentReader) {
          loadReaderProfile(currentReader.card_number);
        }
        fetchRecentHistory();
        await fetchPendingDrafts();
      }
    } catch (e: any) {
      playTone("error");
      toast.error("Lỗi kết nối khi gửi yêu cầu xử lý giao dịch");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Camera Scanner Functions
  const startCamera = async () => {
    setCameraOpen(true);
    setTimeout(async () => {
      try {
        const scannerElement = document.getElementById("smart-counter-camera");
        if (!scannerElement) return;

        const scanner = new Html5Qrcode("smart-counter-camera");
        html5QrCodeRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            scanner.stop().then(() => {
              setCameraOpen(false);
              handleProcessCode(decodedText);
            });
          },
          () => {}
        );
      } catch (err) {
        console.error("Camera error:", err);
      }
    }, 300);
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
      } catch (e) {}
    }
    setCameraOpen(false);
  };

  const handleImageFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const scanner = new Html5Qrcode("smart-counter-temp-file");
      try {
        const decodedText = await scanner.scanFile(file, true);
        await stopCamera();
        handleProcessCode(decodedText);
      } catch (err) {
        playTone("error");
        toast.error("Không tìm thấy mã QR hợp lệ trong ảnh vừa chọn");
      } finally {
        try { scanner.clear(); } catch (e) {}
      }
    }
    if (cameraFileInputRef.current) {
      cameraFileInputRef.current.value = "";
    }
  };

  // Calculations
  const borrowCount = basket.filter(i => i.actionType === "borrow" || i.actionType === "reservation" || i.actionType === "draft").length;
  const returnCount = basket.filter(i => i.actionType === "return").length;
  const basketFines = basket.reduce((sum, item) => sum + (item.fineAmount || 0), 0);
  const oldFines = (currentReader && includeOldFines) ? (currentReader.totalUnpaidFines || 0) : 0;
  const totalFinesToCollect = basketFines + oldFines;

  // Dynamic VietQR generator string
  const bankCode = bankConfig?.bank_code || "TPB";
  const accountNo = bankConfig?.bank_account_no || bankConfig?.account_number || "00000307092";
  const accountName = bankConfig?.bank_account_name || bankConfig?.account_name || "THU VIEN ATHENAEUM";

  const vietQrUrl = totalFinesToCollect > 0
    ? `https://img.vietqr.io/image/${bankCode}-${accountNo}-compact2.png?amount=${totalFinesToCollect}&addInfo=${encodeURIComponent(`ThuPhat ${currentReader?.card_number || "DocGia"}`)}&accountName=${encodeURIComponent(accountName)}`
    : null;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      {/* 1. UNIVERSAL SCANNER COMMAND STRIP */}
      <Card className="border-primary/30 bg-gradient-to-r from-card via-primary/5 to-card shadow-xs">
        <CardContent className="p-3 sm:p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessCode(scanInput);
            }}
            className="flex flex-col sm:flex-row items-center gap-3"
          >
            <div className="relative flex-1 w-full">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-primary">
                <Scan className="h-5 w-5" />
              </div>
              <Input
                ref={scanInputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Quét mã Thẻ độc giả hoặc Tem gáy sách (cắm súng quét barcode hoặc gõ Enter)... [F2]"
                className="pl-11 pr-24 h-12 text-sm sm:text-base font-medium rounded-xl border-primary/40 focus-visible:ring-primary/30 bg-background shadow-xs"
                disabled={isProcessingScan || isSubmitting}
              />
              <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={startCamera}
                  className="h-8 px-2 text-xs font-semibold gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Mở camera quét QR"
                >
                  <Camera className="h-4 w-4 text-primary" />
                  <span className="hidden md:inline">Camera</span>
                </Button>
                <kbd className="hidden lg:inline-flex items-center px-2 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted border border-border rounded">
                  F2
                </kbd>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBookDropModalOpen(true)}
                className={`h-12 px-3.5 rounded-xl font-bold gap-2 text-xs shrink-0 cursor-pointer shadow-xs transition-colors ${
                  dropBoxPendingCount > 0
                    ? "border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 animate-pulse"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                title="Mở hộp thoại kiểm kê & đối soát Hòm trả sách 24/7 ngoài giờ"
              >
                <Inbox className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>Hòm Trả 24/7 ({dropBoxPendingCount})</span>
              </Button>

              {pendingDrafts.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenPendingDraftsModal}
                  className="h-12 px-3.5 rounded-xl font-bold gap-2 text-xs shrink-0 border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer shadow-xs animate-pulse"
                  title="Xem hàng đợi độc giả đã gửi phiếu mượn online"
                >
                  <Zap className="h-4 w-4 text-indigo-600" />
                  <span>Hàng Đợi Online ({pendingDrafts.length})</span>
                </Button>
              )}

              <Button
                type="submit"
                disabled={!scanInput.trim() || isProcessingScan}
                className="h-12 px-6 rounded-xl font-bold gap-2 text-sm shrink-0 w-full sm:w-auto shadow-xs cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                <span>Nạp Mã</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 2. ERGONOMIC 3-COLUMN WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* COLUMN 1: READER CONTEXT PANEL (3 cols) */}
        <Card className="lg:col-span-3 border-border shadow-xs flex flex-col">
          <CardHeader className="py-3 px-4 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                <span>Hồ Sơ Độc Giả</span>
              </CardTitle>
              {currentReader && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetDesk}
                  className="h-6 text-[11px] px-1.5 text-muted-foreground hover:text-destructive"
                  title="Đổi bạn đọc khác (Esc)"
                >
                  Đổi [Esc]
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-4 flex-1 flex flex-col justify-between">
            {currentReader ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-emerald-600 text-white flex items-center justify-center text-base font-bold shadow-xs shrink-0">
                    {currentReader.full_name?.split(" ").slice(-1)[0][0] || "U"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-foreground truncate">{currentReader.full_name}</p>
                    <p className="text-xs font-mono text-primary font-semibold">{currentReader.card_number}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${currentReader.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                        {currentReader.status === "active" ? "Thẻ hoạt động" : "Bị khóa"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {currentReader.phone || currentReader.email || ""}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Đang giữ:</span>
                    <span className="font-bold text-foreground">{currentReader.activeBorrowCount || 0} / {currentReader.maxBooksAllowed || 5} cuốn</span>
                  </div>
                  {currentReader.totalUnpaidFines && currentReader.totalUnpaidFines > 0 ? (
                    <div className="pt-2 border-t border-border/60 space-y-1.5">
                      <div className="flex justify-between items-center text-destructive font-semibold">
                        <span>Nợ phạt cũ:</span>
                        <span>{currentReader.totalUnpaidFines.toLocaleString("vi-VN")} đ</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={handleQuickPayOldFines}
                        disabled={isSubmitting}
                        className="w-full h-7 text-xs font-bold gap-1.5 shadow-xs cursor-pointer"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>Thu Nhanh {currentReader.totalUnpaidFines.toLocaleString("vi-VN")} đ</span>
                      </Button>
                    </div>
                  ) : null}
                </div>

                {/* Danh sách sách đang giữ & Nút trả nhanh */}
                {currentReader.activeBorrows && currentReader.activeBorrows.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-foreground flex items-center gap-1 uppercase tracking-wider">
                        <BookOpen className="h-3.5 w-3.5 text-primary" />
                        <span>Sách đang giữ ({currentReader.activeBorrows.length})</span>
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleReturnAllBorrows}
                        className="h-6 text-[11px] px-1.5 font-bold text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 cursor-pointer"
                        title="Đưa toàn bộ sách đang giữ vào giỏ để nhận trả"
                      >
                        <ArrowRightLeft className="h-3 w-3 mr-1" />
                        <span>Trả tất cả</span>
                      </Button>
                    </div>

                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {currentReader.activeBorrows.map((loan) => {
                        const inBasket = basket.some(b => b.copyQr === loan.qr_code);
                        const isOverdue = (loan.overdue_days || 0) > 0;
                        return (
                          <div
                            key={loan.id}
                            className={`p-2 rounded-lg border text-xs space-y-1.5 transition-colors ${
                              inBasket
                                ? "bg-amber-500/10 border-amber-500/30"
                                : isOverdue
                                ? loan.fine_already_paid
                                  ? "bg-emerald-500/5 border-emerald-500/20"
                                  : "bg-destructive/5 border-destructive/20"
                                : "bg-card border-border/60"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <span className="font-semibold text-foreground truncate flex-1" title={loan.book_title}>
                                {loan.book_title}
                              </span>
                              {inBasket ? (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold shrink-0">
                                  Đã vào giỏ
                                </Badge>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addLoanToReturnBasket(loan)}
                                  className="h-5 text-[10px] px-2 py-0 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 font-bold shrink-0 cursor-pointer"
                                >
                                  Trả sách
                                </Button>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                              <span>Mã: {loan.qr_code}</span>
                              {isOverdue ? (
                                loan.fine_already_paid ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    Trễ {loan.overdue_days}d (Đã nộp phạt)
                                  </span>
                                ) : (
                                  <span className="text-destructive font-semibold">
                                    Trễ {loan.overdue_days}d (Phạt: {loan.fine_amount?.toLocaleString("vi-VN")}đ)
                                  </span>
                                )
                              ) : (
                                <span>Hạn: {new Date(loan.due_date).toLocaleDateString("vi-VN")}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Phiếu mượn online của độc giả */}
                {currentReader.activeDraft && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
                        <Zap className="h-3.5 w-3.5" /> Phiếu mượn online:
                      </p>
                      <code className="text-[10px] font-mono font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-1 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                        {currentReader.activeDraft.draft_code}
                      </code>
                    </div>

                    <div className="p-2.5 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/40 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[11px] text-muted-foreground">Tiến độ đối soát:</span>
                        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${
                          currentReader.activeDraft.all_verified
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold"
                            : "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                        }`}>
                          {currentReader.activeDraft.all_verified ? "✓ Đã đối soát đủ" : `Chờ đối soát (${currentReader.activeDraft.verified_count || 0}/${currentReader.activeDraft.items?.length || 0})`}
                        </Badge>
                      </div>

                      <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                        {currentReader.activeDraft.items?.map((it: any, idx: number) => (
                          <div key={it.item_id || idx} className="text-xs p-1.5 rounded bg-background border flex items-center justify-between gap-1.5">
                            <span className="truncate font-medium flex-1">{it.book_title}</span>
                            {it.copy_qr_code ? (
                              <Badge className="bg-emerald-600 text-white text-[9px] py-0 px-1 h-3.5 font-mono shrink-0">
                                ✓ {it.copy_qr_code}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-700 border-amber-300 text-[9px] py-0 px-1 h-3.5 shrink-0">
                                Chưa quét
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col gap-1.5 pt-1">
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs font-bold gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs cursor-pointer"
                          onClick={() => handleOpenDraftByCode(currentReader.activeDraft.draft_code)}
                        >
                          <Zap className="h-3.5 w-3.5" />
                          <span>Đối Soát Sách & Duyệt 1-Chạm</span>
                        </Button>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="flex-1 h-7 text-[11px] gap-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold cursor-pointer"
                            onClick={() => handleLoadDraftToBasket(currentReader.activeDraft)}
                          >
                            <Zap className="h-3 w-3" /> Nạp vào giỏ
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-[11px] gap-1 border-emerald-500 text-emerald-700 hover:bg-emerald-50 font-semibold cursor-pointer"
                            onClick={() => handleQuickApproveDraft(currentReader.activeDraft.draft_code)}
                          >
                            <Check className="h-3 w-3" /> Duyệt nhanh
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sách đặt trước sẵn sàng nhận */}
                {currentReader.readyReservations && currentReader.readyReservations.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border/60">
                    <p className="text-[11px] font-bold text-primary flex items-center gap-1 uppercase tracking-wider">
                      <Sparkles className="h-3.5 w-3.5" /> Có {currentReader.readyReservations.length} sách đặt trước chờ lấy:
                    </p>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {currentReader.readyReservations.map(resv => (
                        <div key={resv.reservation_id} className="p-2 rounded bg-primary/5 border border-primary/20 text-xs flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{resv.book_title}</span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">Kệ: {resv.book_location || "A1"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sách độc giả đã gửi hòm trả 24/7 chờ đối soát */}
                {currentReader.dropBoxPendingLoans && currentReader.dropBoxPendingLoans.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1 uppercase tracking-wider">
                        <Inbox className="h-3.5 w-3.5" /> Đã gửi Hòm Trả 24/7 ({currentReader.dropBoxPendingLoans.length}):
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 py-0 border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950 font-bold cursor-pointer"
                        onClick={() => setBookDropModalOpen(true)}
                      >
                        Đối soát hòm
                      </Button>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                      <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                        {currentReader.dropBoxPendingLoans.map((item: any, idx: number) => (
                          <div key={item.id || idx} className="text-xs p-1.5 rounded bg-background border border-amber-200 dark:border-amber-900 flex items-center justify-between gap-1.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">{item.book_title}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">
                                {item.qr_code} • Thả lúc: {item.drop_box_at ? new Date(item.drop_box_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""} {item.drop_box_at ? new Date(item.drop_box_at).toLocaleDateString("vi-VN") : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-700 dark:text-amber-400 shrink-0 font-medium">
                              Chờ kiểm kê
                            </Badge>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] text-amber-800 dark:text-amber-300 italic">
                        * Đã ngừng tính hạn trả từ thời điểm độc giả thả vào hòm.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              basket.some(i => i.actionType === "borrow") ? (
                <div className="py-6 px-3 text-center flex flex-col items-center justify-center space-y-3 flex-1">
                  <div className="h-12 w-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-600 flex items-center justify-center animate-bounce">
                    <Scan className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                      Chờ quét Thẻ Độc Giả
                    </p>
                    <p className="text-[11px] text-muted-foreground max-w-[210px] leading-relaxed mx-auto">
                      Đang có <strong>{basket.filter(i => i.actionType === "borrow").length} ấn phẩm MƯỢN MỚI</strong> trong giỏ. Vui lòng quét thẻ bạn đọc để gắn hồ sơ và hoàn tất!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground flex flex-col items-center justify-center space-y-2 flex-1">
                  <div className="h-10 w-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <User className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-foreground">Chưa có độc giả</p>
                  <p className="text-[11px] text-muted-foreground max-w-[190px]">
                    Quét Thẻ độc giả hoặc quét Tem gáy sách để hệ thống tự động nhận diện nghiệp vụ <strong>Mượn / Trả</strong>.
                  </p>
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* COLUMN 2: ACTIVE BASKET WORKSPACE (6 cols) */}
        <Card className="lg:col-span-6 border-border shadow-xs flex flex-col">
          <CardHeader className="py-3 px-4 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                <span>Giỏ Giao Dịch Lượt Này ({basket.length} ấn phẩm)</span>
              </CardTitle>
              {basket.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBasket([])}
                  className="h-6 text-[11px] px-1.5 text-muted-foreground hover:text-destructive"
                >
                  Xóa giỏ
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0 flex-1 flex flex-col">
            {basket.length === 0 ? (
              <div className="py-10 px-4 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3 flex-1">
                {currentReader?.activeDraft ? (
                  <div className="p-5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border-2 border-indigo-400/40 text-center space-y-3 max-w-md w-full shadow-xs">
                    <div className="h-11 w-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-xs">
                      <Zap className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-2">
                        <Badge className="bg-indigo-600 text-white text-xs font-mono font-bold">
                          {currentReader.activeDraft.draft_code}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${
                          currentReader.activeDraft.all_verified
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-bold"
                            : "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
                        }`}>
                          {currentReader.activeDraft.all_verified ? "✓ Đã đối soát đủ" : `Chờ đối soát (${currentReader.activeDraft.verified_count || 0}/${currentReader.activeDraft.items?.length || 0})`}
                        </Badge>
                      </div>
                      <p className="text-sm font-bold text-foreground mt-2">
                        Độc giả có Phiếu Mượn Online ({currentReader.activeDraft.items?.length || 0} cuốn sách)
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {currentReader.activeDraft.all_verified
                          ? "Bạn đọc đã tự nhặt và đối soát tem sách tại kệ. Bấm nút bên dưới để nạp sách vào giỏ và hoàn tất mượn trong 1 giây!"
                          : "Bạn đọc đang giữ chỗ trực tuyến. Bấm để nạp sách vào giỏ mượn ngay tại quầy."}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs gap-1.5 font-bold shadow-xs cursor-pointer h-9 px-4 mx-auto"
                      onClick={() => handleLoadDraftToBasket(currentReader.activeDraft)}
                    >
                      <Zap className="h-4 w-4" /> Nạp Phiếu Mượn Vào Giỏ
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground">
                      <Scan className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Giỏ giao dịch đang trống</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Quét tem gáy sách vật lý hoặc chọn nút <strong>"Trả sách"</strong> từ hồ sơ bạn đọc để tự động xử lý.
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border flex-1 max-h-[460px] overflow-y-auto">
                {basket.map((item) => (
                  <div key={item.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {item.actionType === "borrow" && (
                        <div className="h-9 w-9 rounded-xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 shadow-2xs" title="Nghiệp vụ Mượn mới">
                          <ArrowRightLeft className="h-4 w-4" />
                        </div>
                      )}
                      {item.actionType === "draft" && (
                        <div className="h-9 w-9 rounded-xl bg-indigo-500/15 text-indigo-600 flex items-center justify-center shrink-0 shadow-2xs" title="Nghiệp vụ Mượn online">
                          <Zap className="h-4 w-4" />
                        </div>
                      )}
                      {item.actionType === "return" && (
                        <div className="h-9 w-9 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0 shadow-2xs" title="Nghiệp vụ Trả sách">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      )}
                      {item.actionType === "reservation" && (
                        <div className="h-9 w-9 rounded-xl bg-purple-500/15 text-purple-600 flex items-center justify-center shrink-0 shadow-2xs" title="Nghiệp vụ Nhận đặt trước">
                          <Sparkles className="h-4 w-4" />
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-xs sm:text-sm text-foreground truncate">{item.bookTitle}</p>
                          <Badge variant="outline" className={`text-[10px] py-0 px-2 shrink-0 font-bold uppercase tracking-wider ${
                            item.actionType === "borrow" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" :
                            item.actionType === "draft" ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40" :
                            item.actionType === "return" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40" :
                            "bg-purple-500/15 text-purple-700 border-purple-500/40"
                          }`}>
                            {item.actionType === "borrow" ? "📖 MƯỢN MỚI" :
                             item.actionType === "draft" ? "⚡ MƯỢN ONLINE" :
                             item.actionType === "return" ? "🔄 TRẢ SÁCH" : "✨ ĐẶT TRƯỚC"}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground font-mono mt-1">
                          <span>Mã bản sao: <strong className="text-foreground">{item.copyQr}</strong></span>

                          {/* Thông tin độc giả liên quan đến ấn phẩm */}
                          {(item.borrowerName || currentReader?.full_name) && (
                            <span className="text-foreground font-sans">
                              • {item.actionType === "return" ? "Bạn đọc trả:" : "Bạn đọc mượn:"} <strong className="text-primary">{item.borrowerName || currentReader?.full_name}</strong> {item.borrowerCardNumber || currentReader?.card_number ? `(${item.borrowerCardNumber || currentReader?.card_number})` : ""}
                            </span>
                          )}

                          {item.dueDate && (
                            <span>
                              • Hạn trả: <strong className="text-foreground">{new Date(item.dueDate).toLocaleDateString("vi-VN")}</strong>
                            </span>
                          )}

                          {item.overdueDays && item.overdueDays > 0 ? (
                            item.fineAmount && item.fineAmount > 0 ? (
                              <span className="text-destructive font-semibold">
                                • Quá hạn {item.overdueDays} ngày (Phạt {item.fineAmount.toLocaleString("vi-VN")} đ)
                              </span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                • Quá hạn {item.overdueDays} ngày (Đã nộp phạt)
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveItem(item.id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      title="Bỏ ấn phẩm này ra khỏi giỏ"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* COLUMN 3: SETTLEMENT & COMPLETE (3 cols) */}
        <Card className="lg:col-span-3 border-border shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="py-3 px-4 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <span>Quyết Toán & Xác Nhận</span>
              </CardTitle>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
              {/* Summary Counts */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Sách mượn mới:</span>
                  <span className="font-bold text-foreground text-sm">{borrowCount} cuốn</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Sách nhận trả lại:</span>
                  <span className="font-bold text-foreground text-sm">{returnCount} cuốn</span>
                </div>
                {basketFines > 0 && (
                  <div className="flex justify-between items-center py-1 border-b border-border/40 text-xs">
                    <span className="text-muted-foreground">Phạt trễ hạn sách trả:</span>
                    <span className="font-bold text-destructive">{basketFines.toLocaleString("vi-VN")} đ</span>
                  </div>
                )}
                {currentReader && currentReader.totalUnpaidFines && currentReader.totalUnpaidFines > 0 ? (
                  <div className="flex justify-between items-center py-1 border-b border-border/40 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer text-destructive font-medium">
                      <input
                        type="checkbox"
                        checked={includeOldFines}
                        onChange={(e) => setIncludeOldFines(e.target.checked)}
                        className="rounded border-destructive/40 text-destructive focus:ring-destructive"
                      />
                      <span>Thu kèm nợ phạt cũ:</span>
                    </label>
                    <span className={includeOldFines ? "font-bold text-destructive" : "text-muted-foreground line-through"}>
                      {currentReader.totalUnpaidFines.toLocaleString("vi-VN")} đ
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between items-center py-1 text-sm font-bold">
                  <span>Tổng tiền phạt cần thu:</span>
                  <span className={totalFinesToCollect > 0 ? "text-destructive" : "text-foreground"}>
                    {totalFinesToCollect.toLocaleString("vi-VN")} đ
                  </span>
                </div>
              </div>

              {/* Dynamic VietQR if Fines > 0 */}
              {totalFinesToCollect > 0 && (
                <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-center space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-destructive">
                    <span>Quyết Toán Phí Phạt ({totalFinesToCollect.toLocaleString("vi-VN")} đ)</span>
                    <Badge variant="destructive" className="text-[10px]">Cần thu</Badge>
                  </div>

                  {vietQrUrl ? (
                    <div className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-border shadow-2xs">
                      <img src={vietQrUrl} alt="VietQR" className="h-32 object-contain" />
                      <p className="text-[10px] text-muted-foreground mt-1">Quét mã VietQR chuyển khoản nhanh</p>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={finePaidMethod === "cash" ? "default" : "outline"}
                      onClick={() => setFinePaidMethod("cash")}
                      className="h-7 text-xs px-2.5"
                    >
                      Tiền mặt
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={finePaidMethod === "vietqr" ? "default" : "outline"}
                      onClick={() => setFinePaidMethod("vietqr")}
                      className="h-7 text-xs px-2.5"
                    >
                      Chuyển khoản QR
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </div>

          <div className="p-4 border-t border-border/60 space-y-2 bg-muted/10">
            <Button
              onClick={handleCompleteSession}
              disabled={(basket.length === 0 && totalFinesToCollect === 0) || isSubmitting}
              className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm gap-2 shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>HOÀN TẤT PHIÊN [F9]</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDesk}
              disabled={isSubmitting || (basket.length === 0 && !currentReader)}
              className="w-full h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Làm mới quầy [Esc]
            </Button>
          </div>
        </Card>
      </div>

      {/* 3. RECENT DESK TRANSACTIONS AUDIT STRIP */}
      <Card className="border-border shadow-2xs">
        <CardHeader className="py-2.5 px-4 bg-muted/10 border-b border-border/40">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              Giao Dịch Gần Nhất Tại Quầy
            </span>
            <Button variant="ghost" size="sm" onClick={fetchRecentHistory} className="h-6 text-[11px] p-1 text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableBody>
              {recentTransactions.map((tx) => (
                <TableRow key={tx.id} className="text-xs">
                  <TableCell className="py-2 font-mono text-muted-foreground">{tx.qr_code}</TableCell>
                  <TableCell className="py-2 font-medium text-foreground max-w-[200px] truncate">{tx.book_title}</TableCell>
                  <TableCell className="py-2 text-muted-foreground">{tx.reader_name} ({tx.card_number})</TableCell>
                  <TableCell className="py-2 text-muted-foreground">{new Date(tx.borrow_date).toLocaleDateString("vi-VN")}</TableCell>
                  <TableCell className="py-2 text-right">
                    <Badge variant="outline" className={`text-[10px] ${tx.status === "borrowing" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-muted text-muted-foreground"}`}>
                      {tx.status === "borrowing" ? "Đang mượn" : "Đã trả"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Camera Scanner Modal */}
      <Dialog open={cameraOpen} onOpenChange={(open) => !open && stopCamera()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              Quét Mã Qua Camera
            </DialogTitle>
            <DialogDescription className="text-xs">
              Giơ mã Thẻ độc giả hoặc Tem gáy sách vào giữa khung hình.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-2">
            <div id="smart-counter-camera" className="w-full h-64 rounded-xl overflow-hidden bg-black"></div>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => cameraFileInputRef.current?.click()}
              className="gap-1.5 text-xs font-semibold border-primary/40 text-primary hover:bg-primary/10"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Tải ảnh QR từ máy</span>
            </Button>
            <input
              type="file"
              ref={cameraFileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleImageFileUpload}
            />
            <div id="smart-counter-temp-file" className="hidden" />
            <Button variant="outline" size="sm" onClick={stopCamera}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exit Pass Modal for reader security check */}
      <ExitPassModal
        open={exitPassModalOpen}
        onOpenChange={setExitPassModalOpen}
        passData={exitPassData}
      />

      {/* DIALOG: PHÊ DUYỆT PHIẾU MƯỢN ONLINE (1-CHẠM) & ĐỐI SOÁT MÃ TEM GÁY SÁCH TẠI QUẦY */}
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
                  Phê Duyệt Phiếu Mượn Online (1-Chạm) & Đối Soát Mã Tem Gáy Sách ({targetDraftData.items?.length || 0} cuốn)
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Thủ thư đối soát bản sao sách độc giả mang tới bàn và bấm 1 chạm để hoàn tất xuất mượn toàn bộ ấn phẩm.
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

                {/* Reader Identity & Automatic Eligibility Checks */}
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
                        <Badge 
                          variant={!isBlocked ? "outline" : "destructive"}
                          className={`text-xs font-semibold ${!isBlocked ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" : ""}`}
                        >
                          {!isBlocked ? "✓ Đủ điều kiện mượn sách" : "⛔ Chặn mượn sách"}
                        </Badge>
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

                {/* Book Items List & Physical Copy Verification (Đối Soát Tem Gáy Sách) */}
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
                                <span>• Kho còn: <strong className="text-emerald-600">{item.available_copies ?? 1} cuốn</strong></span>
                              </div>
                            </div>
                          </div>

                          <div 
                            onClick={() => {
                              setMiniMapTarget({ location: item.location, title: item.book_title, cover: item.cover_image });
                              setMiniMapOpen(true);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 bg-muted/50 border rounded-lg cursor-pointer hover:border-primary text-[11px] text-foreground font-medium shrink-0"
                            title="Xem sơ đồ vị trí lưu kho"
                          >
                            <MapPin className="h-3 w-3 text-primary" />
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
                              <QrCode className="h-3.5 w-3.5 text-primary" /> Đối soát tem gáy sách:
                            </span>
                            <Input
                              placeholder="Để trống để tự động gán bản sao sẵn sàng, hoặc quét tem QR trên tay độc giả..."
                              value={copyOverrides[item.book_id] || ""}
                              onChange={(e) => {
                                const val = e.target.value.trim();
                                setCopyOverrides(prev => ({ ...prev, [item.book_id]: val }));
                              }}
                              className="h-8 text-xs font-mono bg-background flex-1"
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
                  className="text-xs w-full sm:w-auto cursor-pointer"
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

      {/* DIALOG: HÀNG ĐỢI PHIẾU MƯỢN ONLINE CHỜ TẠI QUẦY */}
      <Dialog open={pendingDraftsModalOpen} onOpenChange={setPendingDraftsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-indigo-600 text-white font-semibold">Hàng Đợi Trực Tuyến</Badge>
                <DialogTitle className="font-bold text-base">
                  Phiếu Mượn Online Đang Chờ Xuất Kho ({pendingDrafts.length})
                </DialogTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchPendingDrafts}
                disabled={isRefreshingDrafts}
                className="h-7 px-2.5 text-xs font-semibold gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                title="Lấy dữ liệu mới nhất từ máy chủ"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingDrafts ? "animate-spin text-primary" : ""}`} />
                <span>Làm mới</span>
              </Button>
            </div>
            <DialogDescription className="text-xs">
              Độc giả đã lập phiếu mượn online. Bấm "Đối Soát & Duyệt" khi độc giả tới bàn nhận sách.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {pendingDrafts.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-xs">
                Hiện không có phiếu mượn online nào đang chờ tại quầy.
              </div>
            ) : (
              pendingDrafts.map((d: any) => (
                <div key={d.id} className="p-3 rounded-xl border bg-card flex items-center justify-between gap-3 text-xs shadow-2xs hover:border-primary/40 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono font-bold text-primary">{d.draft_code}</code>
                      <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${d.all_verified ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-amber-50 text-amber-700 border-amber-300"}`}>
                        {d.all_verified ? "✓ 100% Tự đối soát" : "Chưa đủ mã"}
                      </Badge>
                    </div>
                    <p className="font-semibold text-foreground mt-0.5">{d.reader_name} ({d.card_number})</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Số lượng: <strong>{d.items_count || d.items?.length || 1} cuốn sách</strong> • Còn {d.time_left_hours ?? 24}h
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 shrink-0 cursor-pointer"
                    onClick={() => {
                      setPendingDraftsModalOpen(false);
                      handleOpenDraftByCode(d.draft_code);
                    }}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>Đối Soát & Duyệt</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Library Mini Map Modal for shelf locations */}
      <LibraryMiniMapModal
        open={miniMapOpen}
        onOpenChange={setMiniMapOpen}
        location={miniMapTarget.location}
        bookTitle={miniMapTarget.title}
        coverImage={miniMapTarget.cover}
      />

      {/* Book Drop 24/7 Audit Modal */}
      <BookDropAuditModal
        open={bookDropModalOpen}
        onOpenChange={setBookDropModalOpen}
        onSuccess={() => {
          fetchDropBoxCount();
          fetchRecentHistory();
          if (currentReader) {
            loadReaderProfile(currentReader.card_number, false);
          }
        }}
      />
    </div>
  );
}
export default SmartCounter;
