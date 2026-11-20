import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  QrCode, BookOpen, Clock, AlertTriangle, CheckCircle2,
  Inbox, RefreshCw, FileSpreadsheet, Sparkles, ExternalLink,
  ChevronRight, Calendar, BookmarkCheck, ArrowRight, Download,
  BookMarked, ShieldAlert, Info, Camera, Upload, Zap, X, MapPin, Copy, Scan,
  RotateCcw, Trash2, Eye, Image as ImageIcon, Search, HelpCircle
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { ExitPassModal } from "@/components/exit-pass-modal";
import { ReturnSlipModal, type ReturnSlipData } from "@/components/return-slip-modal";
import { SmartBookDropModal } from "@/components/smart-book-drop-modal";
import { LibraryMiniMapModal } from "@/components/library-mini-map-modal";
import {
  DEFAULT_READER_RULES,
  LibraryRulesDialog,
  type PublicReaderRules,
} from "@/components/library-rules-content";
import { optimizeMultiBookPickPath } from "@/lib/pick-path";
import { Link, useSearchParams } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";

interface BorrowRecord {
  id: number;
  borrow_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  renewal_count?: number;
  book_title: string;
  cover_image?: string;
  qr_code: string;
  pass_code?: string | null;
  return_slip_id?: number | null;
  return_slip_code?: string | null;
  return_condition?: "normal" | "damaged" | "lost" | string | null;
  return_condition_note?: string | null;
  location?: string;
  fine_amount?: number;
  fine_already_paid?: boolean;
  is_drop_box?: number | boolean;
  drop_box_at?: string;
  drop_box_status?: "none" | "pending_audit" | "verified_intact" | "damaged" | "missing";
  drop_box_audit_note?: string;
  drop_box_audited_at?: string;
  drop_box_audited_by_name?: string;
  drop_box_proof_image?: string;
  return_method?: "drop_box" | "counter";
}

export function ReaderBorrowView() {
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const [profile, setProfile] = useState<any>(null);
  const [records, setRecords] = useState<BorrowRecord[]>([]);
  const [circulationStatus, setCirculationStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"borrowing" | "history" | "borrow_slips" | "return_slips" | "drop_box">("borrowing");
  
  // Modals & State
  const [searchParams] = useSearchParams();
  const [exitPassModalOpen, setExitPassModalOpen] = useState(false);
  const [myExitPassData, setMyExitPassData] = useState<any>(null);
  const [exitPassHistory, setExitPassHistory] = useState<any[]>([]);
  const [returnSlipHistory, setReturnSlipHistory] = useState<ReturnSlipData[]>([]);
  const [selectedReturnSlip, setSelectedReturnSlip] = useState<ReturnSlipData | null>(null);
  const [returnSlipModalOpen, setReturnSlipModalOpen] = useState(false);
  const [myActiveDraft, setMyActiveDraft] = useState<any>(null);
  const [smartBookDropOpen, setSmartBookDropOpen] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [qrCardModalOpen, setQrCardModalOpen] = useState(false);
  const [returnGuideOpen, setReturnGuideOpen] = useState(false);
  const [dropBoxSearch, setDropBoxSearch] = useState("");
  const [borrowSlipSearch, setBorrowSlipSearch] = useState("");
  const [returnSlipSearch, setReturnSlipSearch] = useState("");
  const [readerRules, setReaderRules] = useState<PublicReaderRules>(DEFAULT_READER_RULES);
  const [renewingId, setRenewingId] = useState<number | null>(null);
  const [previewProofImg, setPreviewProofImg] = useState<{ url: string; title: string; time?: string; statusLabel?: string; auditor?: string; note?: string } | null>(null);

  // Scanner & Mini Map States
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [simulatedQrCode, setSimulatedQrCode] = useState("");
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const [miniMapTarget, setMiniMapTarget] = useState<{ location?: string; title?: string; cover?: string }>({});
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMyData = async () => {
    try {
      setLoading(true);
      const [recordsRes, exitPassRes, profileRes, draftRes, historyRes, returnSlipsRes, circStatusRes, rulesRes] = await Promise.allSettled([
        api.get("/borrow/records"),
        api.get("/borrow/exit-passes/my-active"),
        api.get("/users/profile/me"),
        api.get("/borrow/drafts/my-active"),
        api.get("/borrow/exit-passes/my-history"),
        api.get("/borrow/return-slips/my-history"),
        api.get("/fines/circulation-status"),
        api.get("/configs/public-rules")
      ]);
      if (rulesRes.status === "fulfilled" && rulesRes.value.data) {
        setReaderRules({ ...DEFAULT_READER_RULES, ...rulesRes.value.data });
      }

      if (recordsRes.status === "fulfilled" && Array.isArray(recordsRes.value.data)) {
        const seen = new Set<number>();
        const deduped: BorrowRecord[] = [];
        for (const r of recordsRes.value.data) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            deduped.push(r);
          }
        }
        setRecords(deduped);
      }
      if (exitPassRes.status === "fulfilled" && exitPassRes.value.data) {
        const pass = exitPassRes.value.data.exitPass || (exitPassRes.value.data.pass_code ? exitPassRes.value.data : null);
        setMyExitPassData(pass);
      } else {
        setMyExitPassData(null);
      }
      if (historyRes.status === "fulfilled") {
        setExitPassHistory(historyRes.value.data || []);
      }
      if (returnSlipsRes.status === "fulfilled") {
        setReturnSlipHistory(Array.isArray(returnSlipsRes.value.data) ? returnSlipsRes.value.data : []);
      }
      if (profileRes.status === "fulfilled" && profileRes.value.data?.user) {
        setProfile(profileRes.value.data.user);
        // Sync local storage user with accurate card number
        try {
          const rawUser = localStorage.getItem("user");
          if (rawUser) {
            const parsed = JSON.parse(rawUser);
            parsed.card_number = profileRes.value.data.user.card_number;
            parsed.cardNumber = profileRes.value.data.user.card_number;
            localStorage.setItem("user", JSON.stringify(parsed));
          }
        } catch (e) {}
      }
      if (draftRes.status === "fulfilled" && draftRes.value.data?.draft) {
        setMyActiveDraft(draftRes.value.data.draft);
      } else {
        setMyActiveDraft(null);
      }
      if (circStatusRes.status === "fulfilled" && circStatusRes.value.data) {
        setCirculationStatus(circStatusRes.value.data);
      } else {
        setCirculationStatus(null);
      }
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu độc giả:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBorrowSlipCode = (passCode: string, fallbackRecord?: BorrowRecord) => {
    const normalized = String(passCode || "").replace(/^PASS-EXP-/i, "PM-BRW-");
    const matched = exitPassHistory.find(
      (ep) => String(ep.pass_code || "").replace(/^PASS-EXP-/i, "PM-BRW-") === normalized
    );
    if (matched) {
      setMyExitPassData({
        ...matched,
        reader_name: matched.reader_name || profile?.full_name || user?.full_name,
        card_number: matched.card_number || profile?.card_number || cardNumber,
        reader_phone: matched.reader_phone || profile?.phone,
        reader_status: matched.reader_status || profile?.status || "active",
      });
      setExitPassModalOpen(true);
      return;
    }
    if (fallbackRecord) {
      setMyExitPassData({
        pass_code: normalized,
        reader_name: profile?.full_name || user?.full_name,
        card_number: profile?.card_number || cardNumber,
        reader_phone: profile?.phone,
        reader_status: profile?.status || "active",
        created_at: fallbackRecord.borrow_date,
        borrowDate: new Date(fallbackRecord.borrow_date).toLocaleDateString("vi-VN"),
        dueDate: new Date(fallbackRecord.due_date).toLocaleDateString("vi-VN"),
        book_count: 1,
        items: [
          {
            title: fallbackRecord.book_title,
            copyQr: fallbackRecord.qr_code,
            borrowDate: new Date(fallbackRecord.borrow_date).toLocaleDateString("vi-VN"),
            dueDate: new Date(fallbackRecord.due_date).toLocaleDateString("vi-VN"),
          },
        ],
      });
      setExitPassModalOpen(true);
    } else {
      toast.info(`Không tìm thấy Phiếu mượn ${normalized}`);
    }
  };

  const handleOpenReturnSlipCode = async (returnCode: string) => {
    const cached = returnSlipHistory.find((s) => s.return_code === returnCode || s.returnCode === returnCode);
    if (cached) {
      setSelectedReturnSlip(cached);
      setReturnSlipModalOpen(true);
      return;
    }
    try {
      const res = await api.get(`/borrow/return-slips/${encodeURIComponent(returnCode)}`);
      if (res.data) {
        setSelectedReturnSlip(res.data);
        setReturnSlipModalOpen(true);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Không tìm thấy Phiếu trả ${returnCode}`);
    }
  };

  useEffect(() => {
    fetchMyData();
  }, []);

  // Tự động mở máy quét nếu URL có tham số scan=shelf
  useEffect(() => {
    if (searchParams.get("scan") === "shelf") {
      setIsScannerOpen(true);
    }
  }, [searchParams]);

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

  // Camera Scanner Functions
  const startCameraScanner = async () => {
    setIsCameraActive(true);
    setTimeout(async () => {
      try {
        const viewport = document.getElementById("reader-qr-reader-viewport");
        if (!viewport) return;

        if (html5QrCodeRef.current) {
          try {
            if (html5QrCodeRef.current.isScanning) {
              await html5QrCodeRef.current.stop();
            }
            html5QrCodeRef.current.clear();
          } catch (e) {}
        }

        const scanner = new Html5Qrcode("reader-qr-reader-viewport");
        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            handleProcessScannedCode(decodedText);
          },
          () => {}
        );
      } catch (err: any) {
        console.error("Camera start error:", err);
        toast.error("Không thể mở Camera. Vui lòng cấp quyền truy cập Camera hoặc nhập mã thủ công!");
        setIsCameraActive(false);
      }
    }, 150);
  };

  const stopCameraScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (e) {}
    }
    setIsCameraActive(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      const tempScanner = new Html5Qrcode("reader-temp-file-scanner");
      try {
        const decodedText = await tempScanner.scanFile(file, true);
        handleProcessScannedCode(decodedText);
      } catch (err) {
        toast.error("Không tìm thấy mã QR hợp lệ trong ảnh này");
      } finally {
        try {
          tempScanner.clear();
        } catch (e) {}
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleProcessScannedCode = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;

    await stopCameraScanner();
    setIsScannerOpen(false);

    // 1. Nếu đang có Phiếu mượn nháp, gửi mã QR cuốn sách vừa lấy tại kệ để ghi nhận bản sao vào Phiếu mượn nháp
    if (myActiveDraft) {
      try {
        const res = await api.post(`/borrow/drafts/${encodeURIComponent(myActiveDraft.draft_code)}/verify-copy`, {
          copyQr: clean
        });
        toast.success(
          res.data.message ||
            `✅ Đã quét tem sách tại kệ thành công (${clean})! Hãy mang sách và mã Phiếu mượn nháp (hoặc Thẻ độc giả) ra quầy Thủ thư!`
        );
        await fetchMyData();
        return;
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Quét tem sách tại kệ thất bại. Vui lòng kiểm tra mã QR trên sách!");
        return;
      }
    }

    // 2. Nếu chưa có Phiếu mượn nháp, quét tem sách tại kệ sẽ tự động tạo Phiếu mượn nháp và ghi nhận bản sao vừa quét
    try {
      const res = await api.post("/borrow/drafts/scan-direct", {
        copyQr: clean
      });
      toast.success(res.data.message || `Đã tạo Phiếu mượn nháp và ghi nhận bản sao (${clean}) tại kệ!`);
      await fetchMyData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Không thể nhận diện bản sao sách (${clean})`);
    }
  };

  const handleRemoveDraftItem = (itemId: number, bookTitle: string) => {
    confirm({
      title: "Xóa sách khỏi phiếu mượn?",
      description: `Bạn có chắc muốn xóa cuốn «${bookTitle}» khỏi phiếu mượn này? Suất giữ chỗ sẽ được trả lại cho kho thư viện.`,
      confirmText: "Xóa cuốn này",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/drafts/items/${itemId}`);
          toast.success(`Đã xóa cuốn «${bookTitle}» khỏi phiếu mượn`);
          await fetchMyData();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể xóa sách khỏi phiếu");
        }
      }
    });
  };

  const handleUnverifyDraftItem = async (itemId: number, bookTitle: string) => {
    try {
      await api.post(`/borrow/drafts/items/${itemId}/unverify`);
      toast.success(`Đã gỡ mã bản sao của cuốn «${bookTitle}». Bạn có thể quét lại mã bản sao khác!`);
      await fetchMyData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể hủy đối soát");
    }
  };

  const handleCancelReaderDraft = (draftId: number) => {
    confirm({
      title: "Hủy phiếu mượn online?",
      description: "Bạn có chắc muốn hủy phiếu mượn online này không? Bản sao giữ chỗ sẽ được giải phóng cho bạn đọc khác.",
      confirmText: "Hủy phiếu",
      cancelText: "Giữ lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/borrow/drafts/${draftId}`);
          toast.success("Đã hủy phiếu mượn online thành công");
          setMyActiveDraft(null);
          await fetchMyData();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể hủy phiếu mượn online");
        }
      }
    });
  };

  // Precise Card Number from database profile
  const cardNumber =
    profile?.card_number ||
    user?.cardNumber ||
    user?.card_number ||
    (user?.id ? `LIB-RD-${String(user.id).padStart(6, "0")}` : "RD-000000");

  const cardExpiry = profile?.card_expiry
    ? new Date(profile.card_expiry).toLocaleDateString("vi-VN")
    : null;

  // Function to download the QR code image
  const handleDownloadQr = () => {
    const canvas = document.getElementById("reader-card-qr-canvas") as HTMLCanvasElement;
    if (!canvas) {
      toast.error("Không tìm thấy mã QR để tải ảnh");
      return;
    }
    const pngUrl = canvas.toDataURL("image/png");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `The_Thu_Vien_${cardNumber}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    toast.success(`Đã tải ảnh mã QR thẻ thư viện (${cardNumber}) về máy!`);
  };

  // Renew handler
  const handleRenew = (id: number, title: string) => {
    confirm({
      title: "Xác nhận gia hạn mượn sách",
      description: `Bạn có muốn gia hạn thêm 07 ngày thời gian đọc cho ấn phẩm "${title}" không?`,
      confirmText: "Gia hạn ngay",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          setRenewingId(id);
          const response = await api.post("/borrow/renew", { borrowRecordId: id });
          toast.success(response.data.message || "Gia hạn mượn sách thành công thêm 7 ngày!");
          fetchMyData();
        } catch (error: any) {
          toast.error(error.response?.data?.message || "Không thể gia hạn phiếu mượn này");
        } finally {
          setRenewingId(null);
        }
      }
    });
  };

  const pendingDropBoxLoans = records.filter(
    r => r.status === "returned_drop_box" || (Boolean(r.is_drop_box) && r.drop_box_status === "pending_audit")
  );
  const allDropBoxLoans = records.filter(
    r =>
      r.status === "returned_drop_box" ||
      Boolean(r.is_drop_box) ||
      (r.drop_box_status && r.drop_box_status !== "none") ||
      r.return_method === "drop_box"
  );
  const activeLoans = records.filter(
    r => r.status === "borrowing" && !pendingDropBoxLoans.some(p => p.id === r.id)
  );
  const returnedHistory = records.filter(
    r => r.status === "returned" || r.status === "returned_drop_box" || Boolean(r.is_drop_box)
  );

  const formatDraftTimeLeft = (expiresAtStr?: string, fallbackHours?: number) => {
    if (!expiresAtStr) return fallbackHours ? `còn ${fallbackHours}h` : "còn 24h";
    const diffMs = new Date(expiresAtStr).getTime() - Date.now();
    if (diffMs <= 0) return "đã hết hạn";
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `còn ${hours}h ${minutes}p`;
    }
    return `còn ${minutes} phút`;
  };

  const getDueDetails = (dueDateStr: string, _fineAlreadyPaid?: boolean) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        isOverdue: true,
        fineAlreadyPaid: false,
        days: Math.abs(diffDays),
        label: `Quá hạn ${Math.abs(diffDays)} ngày`,
        subLabel: "Cần hoàn trả sách để mở khóa mượn",
        badgeClass: "bg-destructive/15 text-destructive border-destructive/30 font-semibold"
      };
    }
    if (diffDays === 0) {
      return {
        isOverdue: false,
        days: 0,
        label: "Đến hạn hôm nay",
        badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
      };
    }
    if (diffDays <= 3) {
      return {
        isOverdue: false,
        days: diffDays,
        label: `Còn ${diffDays} ngày`,
        badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
      };
    }
    return {
      isOverdue: false,
      days: diffDays,
      label: `Còn ${diffDays} ngày`,
      badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
    };
  };

  const overdueLoansCount = activeLoans.filter((l) => getDueDetails(l.due_date).isOverdue).length;
  const dueSoonCount = activeLoans.filter((l) => {
    const d = getDueDetails(l.due_date);
    return !d.isOverdue && d.days <= 3;
  }).length;
  const readerFullName = profile?.full_name || user?.fullName || user?.full_name || "Độc giả";
  const readerInitials = readerFullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w: string) => w[0]?.toUpperCase() || "")
    .join("") || "ĐG";
  const isCardRestricted = Boolean(
    (circulationStatus && !circulationStatus.eligibleToBorrow) ||
    profile?.status === "suspended" ||
    profile?.status === "locked"
  );

  const normalizedDropBoxQuery = dropBoxSearch.trim().toLowerCase();
  const filteredDropBoxLoans = !normalizedDropBoxQuery
    ? allDropBoxLoans
    : allDropBoxLoans.filter((d) => {
        const title = String(d.book_title || "").toLowerCase();
        const qr = String(d.qr_code || "").toLowerCase();
        const pass = String(d.pass_code || "").toLowerCase();
        const ret = String(d.return_slip_code || "").toLowerCase();
        const auditor = String(d.drop_box_audited_by_name || "").toLowerCase();
        return title.includes(normalizedDropBoxQuery) || qr.includes(normalizedDropBoxQuery) || pass.includes(normalizedDropBoxQuery) || ret.includes(normalizedDropBoxQuery) || auditor.includes(normalizedDropBoxQuery);
      });

  const normalizedReturnQuery = returnSlipSearch.trim().toLowerCase();
  const filteredReturnSlips = !normalizedReturnQuery
    ? returnSlipHistory
    : returnSlipHistory.filter((rs) => {
        const code = String(rs.return_code || rs.returnCode || "").toLowerCase();
        const librarian = String(rs.librarian_name || rs.librarianName || "").toLowerCase();
        const linked = Array.isArray(rs.borrow_slip_codes) ? rs.borrow_slip_codes.join(" ").toLowerCase() : "";
        const itemsTxt = Array.isArray(rs.items)
          ? rs.items.map((it: any) => `${it.title || it.book_title || ""} ${it.copyQr || it.qr_code || ""}`).join(" ").toLowerCase()
          : "";
        return code.includes(normalizedReturnQuery) || librarian.includes(normalizedReturnQuery) || linked.includes(normalizedReturnQuery) || itemsTxt.includes(normalizedReturnQuery);
      });
  const normalizedBorrowQuery = borrowSlipSearch.trim().toLowerCase();
  const filteredExitPasses = !normalizedBorrowQuery
    ? exitPassHistory
    : exitPassHistory.filter((ep) => {
        const code = String(ep.pass_code || ep.passCode || "").replace(/^PASS-EXP-/i, "PM-BRW-").toLowerCase();
        const itemsTxt = Array.isArray(ep.items)
          ? ep.items.map((it: any) => `${it.title || it.book_title || ""} ${it.copyQr || it.qr_code || ""}`).join(" ").toLowerCase()
          : "";
        return code.includes(normalizedBorrowQuery) || itemsTxt.includes(normalizedBorrowQuery);
      });

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Top Row: Compact Reader Profile (Left) + Minimal Circulation Summary & Utilities (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Compact Reader Profile Card (5 cols) */}
        <Card className="lg:col-span-5 border-border/80 bg-card shadow-none rounded-2xl flex flex-col justify-between">
          <CardContent className="p-4 sm:p-5 flex flex-col justify-between gap-4 h-full">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Hồ sơ độc giả
                </span>
                {isCardRestricted ? (
                  <Badge variant="outline" className="text-[11px] font-semibold border-destructive/30 bg-destructive/10 text-destructive gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                    {profile?.status === "suspended" ? "Thẻ tạm khóa" : "Hạn chế lưu thông"}
                  </Badge>
                ) : profile?.status === "active" ? (
                  <Badge variant="outline" className="text-[11px] font-semibold border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Đang hoạt động
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[11px] font-semibold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Chờ kích hoạt
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-3.5">
                <div className="h-12 w-12 rounded-2xl bg-primary text-primary-foreground font-display font-bold text-base flex items-center justify-center shrink-0">
                  {readerInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-base sm:text-lg font-bold text-foreground truncate">
                    {readerFullName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono font-semibold text-primary">{cardNumber}</span>
                    {cardExpiry && (
                      <>
                        <span>•</span>
                        <span>Hạn thẻ: {cardExpiry}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border/60 flex items-center justify-between gap-2.5">
              <div className="text-xs">
                {isCardRestricted ? (
                  <Link to="/fines" className="text-destructive font-medium hover:underline inline-flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    <span>Kiểm tra vi phạm</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>Quyền mượn hợp lệ</span>
                  </span>
                )}
              </div>

              <Button
                onClick={() => setQrCardModalOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs font-semibold gap-1.5 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer shrink-0"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>Mã QR thẻ</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right Column (7 cols): Compact Circulation Overview + Recent Slip & Utilities */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-3.5">
          {/* 3 Minimal Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <Card className="border-border/80 shadow-none rounded-2xl">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Đang mượn</span>
                  <BookOpen className="h-4 w-4 text-primary shrink-0" />
                </div>
                <p className="text-xl sm:text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                  {activeLoans.length}
                  <span className="text-xs font-normal text-muted-foreground ml-1">/ 5</span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {dueSoonCount > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">{dueSoonCount} cuốn sắp đến hạn</span>
                  ) : (
                    <span>Còn {Math.max(0, 5 - activeLoans.length)} suất</span>
                  )}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-none rounded-2xl">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Đã hoàn trả</span>
                  <BookmarkCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                </div>
                <p className="text-xl sm:text-2xl font-bold text-foreground mt-1.5 tabular-nums">
                  {returnedHistory.length}
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 font-medium">
                  Lưu thông tốt
                </p>
              </CardContent>
            </Card>

            <Card className={`col-span-2 sm:col-span-1 shadow-none rounded-2xl ${overdueLoansCount > 0 ? "border-destructive/40 bg-destructive/[0.04]" : "border-border/80"}`}>
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Quá hạn</span>
                  <AlertTriangle className={`h-4 w-4 shrink-0 ${overdueLoansCount > 0 ? "text-destructive" : "text-muted-foreground/70"}`} />
                </div>
                <p className={`text-xl sm:text-2xl font-bold mt-1.5 tabular-nums ${overdueLoansCount > 0 ? "text-destructive" : "text-foreground"}`}>
                  {overdueLoansCount}
                </p>
                <p className={`text-[11px] mt-0.5 ${overdueLoansCount > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {overdueLoansCount > 0 ? "Cần hoàn trả ngay" : "Đúng hạn"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Compact Self-Service Utilities Card */}
          <Card className="border-border/80 shadow-none rounded-2xl flex-1 flex flex-col justify-center">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Tiện ích lưu thông
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    onClick={() => {
                      setSimulatedQrCode("");
                      setIsScannerOpen(true);
                    }}
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs font-medium gap-1.5 cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5 text-primary" />
                    <span>Quét tem tại kệ</span>
                  </Button>

                  <Button
                    onClick={() => setSmartBookDropOpen(true)}
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs font-medium gap-1.5 cursor-pointer"
                  >
                    <Inbox className="h-3.5 w-3.5 text-primary" />
                    <span>Hòm trả 24/7</span>
                  </Button>

                  <Button
                    onClick={() => setReturnGuideOpen(true)}
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2.5 text-xs font-medium gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>Hướng dẫn trả</span>
                  </Button>

                  <Button
                    onClick={() => setRulesDialogOpen(true)}
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2.5 text-xs font-medium gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <BookMarked className="h-3.5 w-3.5" />
                    <span>Nội quy</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Multi-Cause Circulation Discipline Alert Banner */}
      {circulationStatus && !circulationStatus.eligibleToBorrow && (
        <Card className="border-destructive/40 bg-destructive/[0.04] shadow-none rounded-2xl">
          <CardContent className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-xs font-bold text-destructive uppercase tracking-wider">
                  Tài khoản đang tạm giới hạn quyền mượn ({circulationStatus.primaryStatus})
                </span>
                {Array.isArray(circulationStatus.restrictions) && circulationStatus.restrictions.length > 1 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {circulationStatus.restrictions.length} lý do
                  </Badge>
                )}
              </div>
              <p className="text-xs text-foreground leading-relaxed">
                {circulationStatus.blockReason || "Vui lòng kiểm tra mục Vi phạm & Kỷ luật mượn để xem chi tiết."}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {circulationStatus.isOverdue && (
                  <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive bg-background">
                    Quá hạn chưa trả: {circulationStatus.overdueCount} cuốn
                  </Badge>
                )}
                {circulationStatus.isSuspended && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300 bg-background">
                    Tạm ngưng mượn đến {circulationStatus.suspendedUntilFormatted} (còn {circulationStatus.suspensionRemainingDays} ngày)
                  </Badge>
                )}
                {circulationStatus.isPendingRemediation && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300 bg-background">
                    Chờ khắc phục: {circulationStatus.pendingRemediationCount} biên bản
                  </Badge>
                )}
              </div>
            </div>
            <Link to="/fines" className="shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10">
                Xem kỷ luật <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Active Online Draft Borrow Slip (Phiếu mượn nháp - Giữ chỗ 24h -> Quét tem sách tại kệ -> Ra quầy Thủ thư) */}
      {myActiveDraft && (() => {
        const pickPathData = optimizeMultiBookPickPath(myActiveDraft.items || []);
        const orderedDraftItems = pickPathData.orderedItems;
        return (
        <Card className={`border-2 shadow-sm overflow-hidden transition-all ${
          myActiveDraft.all_verified
            ? "border-indigo-500 bg-gradient-to-r from-indigo-500/10 via-card to-emerald-500/5"
            : "border-amber-500/50 bg-gradient-to-r from-amber-500/10 via-card to-primary/5"
        }`}>
          <CardHeader className={`pb-3 border-b ${myActiveDraft.all_verified ? "bg-indigo-500/10" : "bg-amber-500/10"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl text-white shadow-xs shrink-0 ${myActiveDraft.all_verified ? "bg-indigo-600" : "bg-amber-600"}`}>
                  {myActiveDraft.all_verified ? <CheckCircle2 className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className={`font-display text-sm sm:text-base font-bold ${myActiveDraft.all_verified ? "text-indigo-700 dark:text-indigo-300" : "text-amber-800 dark:text-amber-300"}`}>
                      {myActiveDraft.all_verified
                        ? "Phiếu Mượn Nháp (Đã Quét Sách Tại Kệ • Sẵn Sàng Ra Quầy Thủ Thư)"
                        : "Phiếu Mượn Nháp (Đã Khóa Giữ Chỗ 24h • Chờ Quét Tem Sách Tại Kệ)"}
                    </CardTitle>
                    <code className="px-2 py-0.5 bg-background rounded-md border text-xs font-mono font-bold text-primary">
                      {myActiveDraft.draft_code}
                    </code>
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold text-[11px] gap-1">
                      <Clock className="h-3 w-3 text-amber-600" /> Giữ chỗ 24h: {formatDraftTimeLeft(myActiveDraft.expires_at, myActiveDraft.time_left_hours)}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    {myActiveDraft.all_verified ? (
                      <span>
                        Bạn đã tự lấy sách và <strong>Quét Tem Sách Tại Kệ</strong> hoàn tất. Hãy mang sách ra quầy, đưa mã <strong>Phiếu mượn nháp ({myActiveDraft.draft_code})</strong> hoặc <strong>Thẻ độc giả ({cardNumber})</strong> để Thủ thư quét đối soát chuyển sang <strong>Phiếu mượn chính thức</strong>!
                      </span>
                    ) : (
                      <span>
                        Hệ thống đã khóa giữ riêng <strong>{orderedDraftItems.length || 1} suất bản sao</strong> trên kệ trong 24 giờ và <strong>tự động sắp xếp lộ trình đi lấy sách tối ưu</strong> (Phòng gần sảnh nhất → Kệ thấp đến cao → Ngăn dưới lên trên) để bạn không phải đi vòng vèo!
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive hover:bg-destructive/10 gap-1 cursor-pointer"
                  onClick={() => handleCancelReaderDraft(myActiveDraft.id)}
                >
                  <X className="h-3.5 w-3.5" /> Hủy Phiếu mượn nháp
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 space-y-3.5">
            {/* Multi-Book Pick Path Visual Strip */}
            {orderedDraftItems.length > 0 && (
              <div className="rounded-xl border border-emerald-500/35 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-indigo-500/10 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 gap-1">
                      <Sparkles className="h-3 w-3" /> Lộ Trình Đi Lấy Sách Tối Ưu (Multi-Book Pick Path)
                    </Badge>
                    <span className="text-[11px] text-muted-foreground font-medium">
                      Sắp xếp tự động: Phòng gần sảnh chính → Kệ thấp đến cao → Ngăn dưới lên trên ({pickPathData.roomsSequence.length} phòng • {pickPathData.uniqueShelvesCount} kệ)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-background border border-border font-semibold text-foreground shrink-0 shadow-2xs">
                    🏁 Sảnh chính
                  </span>
                  {orderedDraftItems.map((item: any) => {
                    const isVerified = Boolean(item.book_copy_id);
                    const loc = item._pickPath.parsedLocation;
                    return (
                      <div key={`path-${item.item_id || item.book_id || item._pickPath.stepOrder}`} className="flex items-center gap-1.5 shrink-0">
                        <ArrowRight className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <button
                          type="button"
                          onClick={() => {
                            setMiniMapTarget({ location: item.location, title: item.book_title, cover: item.cover_image });
                            setMiniMapOpen(true);
                          }}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-left transition-all cursor-pointer shadow-2xs ${
                            isVerified
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-background hover:bg-emerald-50 dark:hover:bg-emerald-950/30 border-emerald-500/40 text-foreground"
                          }`}
                          title={`Bấm để xem sơ đồ 2D đến lấy "${item.book_title}"`}
                        >
                          <span className={`h-4 w-4 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                            isVerified ? "bg-white text-indigo-700" : "bg-emerald-600 text-white"
                          }`}>
                            {isVerified ? "✓" : item._pickPath.stepOrder}
                          </span>
                          <div className="leading-tight">
                            <div className="font-bold text-[10px] whitespace-nowrap">
                              {loc.roomLabel} • {loc.shelfLabel} • {loc.rackLabel}
                            </div>
                            <div className={`text-[10px] truncate max-w-[120px] ${isVerified ? "text-indigo-100" : "text-muted-foreground"}`}>
                              {item.book_title}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  <ArrowRight className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                    💁 Quầy Thủ thư
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              {/* Status Callout */}
              {myActiveDraft.all_verified ? (
                <div className="flex flex-col items-center justify-center p-3.5 bg-indigo-500/10 rounded-xl border-2 border-indigo-500/60 shadow-2xs space-y-2 text-center">
                  <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <Badge className="bg-indigo-600 text-white font-bold text-xs px-2.5 py-0.5">
                      ✓ ĐÃ QUÉT TẠI KỆ ({myActiveDraft.verified_count || 1}/{orderedDraftItems.length || 1} CUỐN)
                    </Badge>
                    <p className="text-xs font-bold text-foreground mt-1">Bước 3: Tới Quầy Đưa Mã Nháp / Thẻ Độc Giả</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Đưa mã <strong>{myActiveDraft.draft_code}</strong> hoặc Thẻ độc giả tại quầy để Thủ thư quét đối soát chuyển sang <strong>Phiếu mượn chính thức</strong>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-3.5 bg-amber-500/10 rounded-xl border-2 border-amber-400/60 shadow-2xs space-y-2.5 text-center">
                  <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs">
                      Bước 2: Đi theo lộ trình & Quét tại kệ ({myActiveDraft.verified_count || 0}/{orderedDraftItems.length || 0})
                    </Badge>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Đi lần lượt theo <strong>Chặng #1 → #{orderedDraftItems.length}</strong> bên phải để lấy sách nhanh nhất và quét mã QR trên sách.
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setSimulatedQrCode("");
                      setIsScannerOpen(true);
                    }}
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 h-8 font-semibold shadow-xs w-full cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5" /> Quét Tem Sách Tại Kệ
                  </Button>
                </div>
              )}

              {/* Items List */}
              <div className="md:col-span-2 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <span>Thứ tự đi lấy sách tối ưu ({orderedDraftItems.length || 0} cuốn):</span>
                    <Badge variant="secondary" className="text-[10px]">
                      Đã quét tại kệ: {myActiveDraft.verified_count || 0}/{orderedDraftItems.length || 0}
                    </Badge>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] gap-1 text-emerald-700 border-emerald-400 hover:bg-emerald-50 cursor-pointer"
                    onClick={() => {
                      setSimulatedQrCode("");
                      setIsScannerOpen(true);
                    }}
                  >
                    <Camera className="h-3 w-3 text-emerald-600" /> Quét Tem Sách Tại Kệ
                  </Button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {orderedDraftItems.map((item: any, idx: number) => {
                    const isVerified = Boolean(item.book_copy_id);
                    const stepOrder = item._pickPath?.stepOrder || idx + 1;
                    return (
                      <div
                        key={item.item_id || item.id || idx}
                        className={`p-2.5 bg-background border rounded-xl flex items-center justify-between gap-2.5 text-xs shadow-2xs transition-colors ${
                          isVerified ? "border-indigo-500/40 bg-indigo-50/15 dark:bg-indigo-950/20" : "border-amber-400/50 bg-amber-50/10"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`px-1.5 h-5 rounded-md font-bold text-[10px] flex items-center justify-center shrink-0 ${
                              isVerified ? "bg-indigo-600 text-white" : "bg-emerald-600 text-white"
                            }`}
                            title={`Chặng dừng lấy sách thứ ${stepOrder}`}
                          >
                            {isVerified ? `✓ Chặng ${stepOrder}` : `Chặng ${stepOrder}`}
                          </span>
                          {item.cover_image ? (
                            <img src={item.cover_image} alt={item.book_title} className="h-9 w-7 object-cover rounded shrink-0 shadow-2xs" />
                          ) : (
                            <div className="h-9 w-7 bg-muted rounded flex items-center justify-center text-xs shrink-0">📚</div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate">{item.book_title}</p>
                            {item._pickPath?.transitionHint && (
                              <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 truncate mt-0.5">
                                {item._pickPath.transitionHint}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {isVerified ? (
                                <span className="inline-flex items-center gap-1 bg-indigo-600 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded-md whitespace-nowrap">
                                  ✓ Đã quét tại kệ: {item.copy_qr_code}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 border border-amber-400 text-amber-800 bg-amber-50 text-[10px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap">
                                  🔒 Đã khóa giữ chỗ 1 bản sao (24h) • Chờ quét tại kệ
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground font-mono truncate">ISBN: {item.isbn || "N/A"}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] sm:text-[11px] gap-1 px-2 border-primary/30 text-primary hover:bg-primary/10 font-medium cursor-pointer"
                            onClick={() => {
                              setMiniMapTarget({ location: item.location, title: item.book_title, cover: item.cover_image });
                              setMiniMapOpen(true);
                            }}
                            title="Xem sơ đồ vị trí kệ sách"
                          >
                            <MapPin className="h-3 w-3 text-primary" />
                            <span className="truncate max-w-[110px] sm:max-w-[140px]">{item.location || "Kệ sách"}</span>
                          </Button>

                          {!isVerified ? (
                            <Button
                              size="sm"
                              className="h-7 text-[10px] px-2.5 font-semibold gap-1 bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                              onClick={() => {
                                setSimulatedQrCode("");
                                setIsScannerOpen(true);
                              }}
                              title="Quét tem mã QR cuốn sách này tại kệ"
                            >
                              <Camera className="h-3 w-3" /> Quét Tem Sách Tại Kệ
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] px-2 font-medium gap-1 text-amber-700 hover:bg-amber-500/10 border-amber-300 cursor-pointer"
                              onClick={() => handleUnverifyDraftItem(item.item_id || item.id, item.book_title)}
                              title="Quét nhầm cuốn sách trên kệ? Bấm để gỡ mã và quét lại"
                            >
                              <RotateCcw className="h-3 w-3 text-amber-600" /> Quét lại
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 cursor-pointer shrink-0"
                            onClick={() => handleRemoveDraftItem(item.item_id || item.id, item.book_title)}
                            title="Xóa cuốn sách này khỏi Phiếu mượn nháp"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {/* Main Borrow Management Section */}
      <Card className="border-border/80 shadow-none rounded-2xl overflow-hidden">
        <CardHeader className="p-4 sm:px-5 sm:py-4 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base sm:text-lg font-bold">Ấn phẩm &amp; Chứng từ lưu thông</CardTitle>
              <CardDescription className="text-xs">
                Theo dõi hạn trả, gia hạn trực tuyến và tra cứu phiếu mượn / phiếu trả đối soát.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
                <TabsList className="h-auto flex-wrap p-0.5">
                  <TabsTrigger value="borrowing" className="text-xs h-7 px-2.5">
                    Đang giữ ({activeLoans.length})
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-xs h-7 px-2.5">
                    Lịch sử trả ({returnedHistory.length})
                  </TabsTrigger>
                  <TabsTrigger value="borrow_slips" className="text-xs h-7 px-2.5">
                    Phiếu mượn ({exitPassHistory.length})
                  </TabsTrigger>
                  <TabsTrigger value="return_slips" className="text-xs h-7 px-2.5">
                    Phiếu trả ({returnSlipHistory.length})
                  </TabsTrigger>
                  <TabsTrigger value="drop_box" className="text-xs h-7 px-2.5 gap-1.5">
                    <span>Hòm 24/7 ({allDropBoxLoans.length})</span>
                    {pendingDropBoxLoans.length > 0 && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title={`${pendingDropBoxLoans.length} cuốn chờ kiểm kê`} />
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={fetchMyData}
                disabled={loading}
                title="Tải lại dữ liệu"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {activeTab === "borrowing" ? (
            activeLoans.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Bạn hiện không mượn cuốn sách nào</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Khám phá kho sách và đặt trước cuốn bạn yêu thích ngay!</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                  <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                    <Link to="/books">
                      <span>Khám phá kho sách</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  {pendingDropBoxLoans.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setActiveTab("drop_box")} className="text-xs text-amber-700 hover:text-amber-800 gap-1">
                      <Inbox className="h-3.5 w-3.5" />
                      <span>{pendingDropBoxLoans.length} cuốn đang chờ kiểm kê Hòm 24/7 →</span>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {/* Thông báo gọn 1 dòng chỉ hiện khi có sách đang chờ Thủ thư kiểm kê Hòm 24/7 */}
                {pendingDropBoxLoans.length > 0 && (
                  <div className="px-4 py-2.5 bg-amber-500/[0.06] border-b border-amber-500/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                      <Inbox className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Có <strong>{pendingDropBoxLoans.length} cuốn</strong> đã thả vào Hòm trả 24/7 đang chờ Thủ thư kiểm kê (đã ngưng tính hạn trả).
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setActiveTab("drop_box")}
                      className="h-6 px-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                    >
                      Xem tại Hòm 24/7 →
                    </Button>
                  </div>
                )}

                {activeLoans.map((loan) => {
                  const dueInfo = getDueDetails(loan.due_date, loan.fine_already_paid);
                  return (
                    <div key={loan.id} className="p-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-3.5 min-w-0">
                        {loan.cover_image ? (
                          <img
                            src={loan.cover_image}
                            alt={loan.book_title}
                            className="h-14 w-10 object-cover rounded-md border border-border shrink-0"
                          />
                        ) : (
                          <div className="h-14 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-border">
                            <BookOpen className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold text-foreground text-sm leading-snug truncate">{loan.book_title}</p>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">{loan.qr_code}</span>
                            <span>•</span>
                            <span>Mượn {new Date(loan.borrow_date).toLocaleDateString("vi-VN")}</span>
                            <span>•</span>
                            <span className={`font-medium ${dueInfo.isOverdue ? "text-destructive" : "text-foreground"}`}>
                              Hạn trả: {new Date(loan.due_date).toLocaleDateString("vi-VN")}
                            </span>
                          </div>

                          {/* Specific warning if librarian reported missing from 24/7 drop box */}
                          {loan.drop_box_status === "missing" && (
                            <div className="mt-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-[11px] space-y-1">
                              <p className="font-bold flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>Cảnh báo đối soát Hòm 24/7: Thủ thư ({loan.drop_box_audited_by_name || "Trực ca"}) báo không tìm thấy sách trong hòm!</span>
                              </p>
                              <p className="text-[10px]">
                                Ghi chú: "{loan.drop_box_audit_note || "Không thấy sách khi kiểm kê"}". Vui lòng mang ảnh minh chứng đến quầy để đối chiếu.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-border/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs font-semibold px-2.5 py-0.5 ${dueInfo.badgeClass}`}>
                            {dueInfo.label}
                          </Badge>
                          {loan.pass_code && (
                            <button
                              type="button"
                              onClick={() => handleOpenBorrowSlipCode(loan.pass_code!, loan)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 font-mono text-[11px] cursor-pointer"
                              title="Xem Phiếu mượn chính thức"
                            >
                              <QrCode className="h-3 w-3" />
                              <span>Phiếu</span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSmartBookDropOpen(true)}
                            className="h-8 px-2.5 text-xs font-medium gap-1.5 cursor-pointer"
                            title="Tự hoàn trả cuốn sách này vào Hòm trả 24/7 ngoài giờ"
                          >
                            <Inbox className="h-3.5 w-3.5 text-primary" />
                            <span>Trả Hòm 24/7</span>
                          </Button>

                          {!dueInfo.isOverdue && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={renewingId === loan.id || (loan.renewal_count || 0) >= 2}
                              onClick={() => handleRenew(loan.id, loan.book_title)}
                              className="h-8 px-2.5 text-xs font-medium gap-1.5 border-primary/35 text-primary hover:bg-primary/10 cursor-pointer"
                            >
                              <RefreshCw className={`h-3.5 w-3.5 ${renewingId === loan.id ? "animate-spin" : ""}`} />
                              <span>Gia hạn</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === "history" ? (
            returnedHistory.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                Bạn chưa có lịch sử trả sách nào trong hệ thống.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs">Tên ấn phẩm</TableHead>
                      <TableHead className="text-xs">Phiếu mượn &amp; Phiếu trả</TableHead>
                      <TableHead className="text-xs">Ngày mượn</TableHead>
                      <TableHead className="text-xs">Hình thức &amp; Kênh trả</TableHead>
                      <TableHead className="text-xs text-right">Trạng thái xác nhận</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returnedHistory.map((h) => {
                      const isDropBox = h.status === "returned_drop_box" || Boolean(h.is_drop_box) || h.return_method === "drop_box";
                      const isPendingAudit = h.status === "returned_drop_box" || h.drop_box_status === "pending_audit";
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="py-2.5">
                            <p className="font-medium text-xs text-foreground max-w-[240px] truncate">{h.book_title}</p>
                            <p className="text-[11px] font-mono text-muted-foreground">{h.qr_code}</p>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex flex-col items-start gap-1">
                              {h.pass_code && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenBorrowSlipCode(h.pass_code!, h)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10px] cursor-pointer"
                                  title="Mở Phiếu mượn gốc"
                                >
                                  <QrCode className="h-2.5 w-2.5" />
                                  PM: {h.pass_code}
                                </button>
                              )}
                              {h.return_slip_code ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenReturnSlipCode(h.return_slip_code!)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30 font-mono font-bold text-[10px] cursor-pointer"
                                  title="Mở Phiếu trả sách điện tử"
                                >
                                  <QrCode className="h-2.5 w-2.5" />
                                  PT: {h.return_slip_code}
                                </button>
                              ) : isPendingAudit ? (
                                <span className="text-[10px] text-amber-600 italic">Chờ lập phiếu trả</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(h.borrow_date).toLocaleDateString("vi-VN")}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isDropBox ? (
                              <div className="flex flex-col text-[11px] space-y-0.5">
                                <span className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <Inbox className="h-3 w-3" /> Hòm trả 24/7
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  Tiếp nhận: {h.drop_box_at ? new Date(h.drop_box_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""} {h.drop_box_at ? new Date(h.drop_box_at).toLocaleDateString("vi-VN") : (h.return_date ? new Date(h.return_date).toLocaleDateString("vi-VN") : "")}
                                </span>
                                {h.drop_box_audited_at && (
                                  <span className="text-[10px] text-sky-700 dark:text-sky-400 font-mono">
                                    Xác nhận: {new Date(h.drop_box_audited_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} {new Date(h.drop_box_audited_at).toLocaleDateString("vi-VN")}
                                  </span>
                                )}
                                {h.drop_box_proof_image && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewProofImg({
                                        url: h.drop_box_proof_image!,
                                        title: h.book_title,
                                        time: h.drop_box_at ? new Date(h.drop_box_at).toLocaleString("vi-VN") : undefined,
                                        statusLabel: isPendingAudit ? "Chờ Thủ thư kiểm kê" : h.drop_box_status === "damaged" ? "Báo hư hại sách" : "Đã xác nhận nguyên vẹn",
                                        auditor: h.drop_box_audited_by_name,
                                        note: h.drop_box_audit_note
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline w-fit cursor-pointer"
                                  >
                                    <Eye className="h-2.5 w-2.5" /> Ảnh minh chứng
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col text-[11px]">
                                <span className="font-semibold text-foreground">
                                  🏢 Tại quầy thủ thư
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {h.return_date ? new Date(h.return_date).toLocaleString("vi-VN") : "—"}
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-right">
                            {isPendingAudit ? (
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[11px] font-semibold gap-1">
                                  <Clock className="h-3 w-3" /> Chờ thủ thư kiểm kê
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">Đã ngưng tính hạn trả</span>
                              </div>
                            ) : h.drop_box_status === "damaged" ? (
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[11px] font-semibold">
                                  Hỏng hóc (Đã lập biên bản)
                                </Badge>
                                {h.drop_box_audited_by_name && (
                                  <span className="text-[10px] text-muted-foreground">
                                    Thủ thư: <strong>{h.drop_box_audited_by_name}</strong>
                                    {h.drop_box_audited_at ? ` (${new Date(h.drop_box_audited_at).toLocaleDateString("vi-VN")})` : ""}
                                  </span>
                                )}
                                {h.drop_box_audit_note && (
                                  <span className="text-[10px] text-destructive italic max-w-[220px] truncate" title={h.drop_box_audit_note}>
                                    "{h.drop_box_audit_note}"
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[11px] font-semibold gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {isDropBox ? "Thủ thư đã xác nhận (Đã nhập kho)" : "Đã hoàn trả tại quầy"}
                                </Badge>
                                {isDropBox && h.drop_box_audited_by_name && (
                                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                                    Xác nhận bởi: <strong>{h.drop_box_audited_by_name}</strong>
                                    {h.drop_box_audited_at ? ` • ${new Date(h.drop_box_audited_at).toLocaleString("vi-VN")}` : ""}
                                  </span>
                                )}
                                {isDropBox && h.drop_box_audit_note && (
                                  <span className="text-[10px] text-muted-foreground italic max-w-[220px] truncate" title={h.drop_box_audit_note}>
                                    "{h.drop_box_audit_note}"
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          ) : activeTab === "borrow_slips" ? (
            /* TAB RIÊNG: PHIẾU MƯỢN SÁCH CHÍNH THỨC */
            <div className="space-y-0">
              <div className="px-4 py-3 bg-emerald-500/[0.04] border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                    Phiếu Mượn Sách Chính Thức ({filteredExitPasses.length})
                  </span>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    value={borrowSlipSearch}
                    onChange={(e) => setBorrowSlipSearch(e.target.value)}
                    placeholder="Tìm mã PM-BRW-..., tên sách, mã bản sao..."
                    className="h-8 pl-8 pr-8 text-xs bg-background"
                  />
                  {borrowSlipSearch && (
                    <button
                      type="button"
                      onClick={() => setBorrowSlipSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label="Xóa tìm kiếm phiếu mượn"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {filteredExitPasses.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {normalizedBorrowQuery
                        ? "Không tìm thấy Phiếu mượn nào khớp từ khóa"
                        : "Bạn chưa có Phiếu mượn chính thức nào được lưu"}
                    </p>
                    {!normalizedBorrowQuery && (
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-md mx-auto">
                        Khi Thủ thư quét xác nhận cho mượn sách tại quầy, Phiếu mượn chính thức kèm mã QR đối soát sẽ lưu tại đây.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-semibold">Mã Phiếu &amp; Ấn Phẩm</TableHead>
                        <TableHead className="text-xs font-semibold">Ngày Mượn</TableHead>
                        <TableHead className="text-xs font-semibold">Hạn Trả (14 Ngày)</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Số Sách</TableHead>
                        <TableHead className="text-xs font-semibold">Trạng Thái</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Thao Tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExitPasses.map((ep) => {
                        const createdDate = ep.created_at ? new Date(ep.created_at) : new Date();
                        const due14 = new Date(createdDate.getTime());
                        due14.setDate(due14.getDate() + 14);
                        const passItems = Array.isArray(ep.items) ? ep.items : [];
                        const firstItem = passItems[0] || null;
                        const matchedRec = firstItem
                          ? records.find(r =>
                              (firstItem.copyQr && r.qr_code === firstItem.copyQr) ||
                              (firstItem.title && r.book_title === firstItem.title)
                            )
                          : null;
                        const resolvedDueStr = matchedRec?.due_date
                          ? new Date(matchedRec.due_date).toLocaleDateString("vi-VN")
                          : due14.toLocaleDateString("vi-VN");
                        const normalizedCode = String(ep.pass_code || "").replace(/^PASS-EXP-/i, "PM-BRW-");
                        const previewTitles = passItems
                          .map((it: any) => it.title || it.book_title)
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(", ");

                        return (
                          <TableRow key={ep.id} className="hover:bg-muted/20">
                            <TableCell className="py-2.5">
                              <p className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                {normalizedCode}
                              </p>
                              {previewTitles && (
                                <p className="text-[11px] text-muted-foreground truncate max-w-[260px]" title={previewTitles}>
                                  {previewTitles}{passItems.length > 2 ? ` (+${passItems.length - 2})` : ""}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {createdDate.toLocaleDateString("vi-VN")}
                            </TableCell>
                            <TableCell className="text-xs font-semibold text-foreground">
                              {resolvedDueStr}
                            </TableCell>
                            <TableCell className="text-xs text-center font-bold text-foreground">
                              {ep.book_count || passItems.length || 1} cuốn
                            </TableCell>
                            <TableCell className="text-xs">
                              {ep.displayStatus === "used" ? (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 text-[11px] font-semibold gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Đã kiểm tra đối soát
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[11px] font-semibold gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Đã xác nhận
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer"
                                onClick={() => {
                                  setMyExitPassData({
                                    ...ep,
                                    reader_name: ep.reader_name || profile?.full_name || user?.full_name,
                                    card_number: ep.card_number || profile?.card_number || cardNumber,
                                    reader_phone: ep.reader_phone || profile?.phone,
                                    reader_status: ep.reader_status || profile?.status || "active",
                                  });
                                  setExitPassModalOpen(true);
                                }}
                              >
                                <QrCode className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Mở Phiếu Mượn</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : activeTab === "return_slips" ? (
            /* TAB RIÊNG: PHIẾU TRẢ SÁCH ĐIỆN TỬ */
            <div className="space-y-0">
              <div className="px-4 py-3 bg-sky-500/[0.04] border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
                  <span className="text-xs font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wider">
                    Phiếu Trả Sách Điện Tử ({filteredReturnSlips.length})
                  </span>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    value={returnSlipSearch}
                    onChange={(e) => setReturnSlipSearch(e.target.value)}
                    placeholder="Tìm mã RT-..., PM-BRW-..., tên sách..."
                    className="h-8 pl-8 pr-8 text-xs bg-background"
                  />
                  {returnSlipSearch && (
                    <button
                      type="button"
                      onClick={() => setReturnSlipSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label="Xóa tìm kiếm phiếu trả"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {filteredReturnSlips.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {normalizedReturnQuery
                        ? "Không tìm thấy Phiếu trả nào khớp từ khóa"
                        : "Bạn chưa có Phiếu trả sách điện tử nào"}
                    </p>
                    {!normalizedReturnQuery && (
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-md mx-auto">
                        Khi hoàn trả sách tại quầy hoặc được Thủ thư xác nhận Hòm 24/7, phiếu trả làm minh chứng hoàn trả sẽ lưu tại đây.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-semibold">Mã Phiếu &amp; Sách Đã Trả</TableHead>
                        <TableHead className="text-xs font-semibold">Phiếu Mượn Gốc</TableHead>
                        <TableHead className="text-xs font-semibold">Phương Thức &amp; Thời Gian</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Số Sách</TableHead>
                        <TableHead className="text-xs font-semibold">Người Xác Nhận</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Thao Tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReturnSlips.map((rs) => {
                        const isDrop = rs.return_method === "drop_box";
                        const linkedSlips = Array.isArray(rs.borrow_slip_codes) ? rs.borrow_slip_codes : [];
                        const slipItems = Array.isArray(rs.items) ? rs.items : [];
                        const previewTitles = slipItems
                          .map((it: any) => it.title || it.book_title)
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(", ");
                        return (
                          <TableRow key={rs.id || rs.return_code} className="hover:bg-muted/20">
                            <TableCell className="py-2.5">
                              <p className="font-mono text-xs font-bold text-sky-700 dark:text-sky-400">
                                {rs.return_code}
                              </p>
                              {previewTitles && (
                                <p className="text-[11px] text-muted-foreground truncate max-w-[240px]" title={previewTitles}>
                                  {previewTitles}{slipItems.length > 2 ? ` (+${slipItems.length - 2})` : ""}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex flex-wrap gap-1">
                                {linkedSlips.length > 0 ? linkedSlips.map((code) => (
                                  <button
                                    key={code}
                                    type="button"
                                    onClick={() => handleOpenBorrowSlipCode(code)}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10px] cursor-pointer"
                                    title="Mở Phiếu mượn gốc"
                                  >
                                    {code}
                                  </button>
                                )) : <span className="text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="space-y-0.5">
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                  {isDrop ? "📦 Hòm 24/7" : "🏢 Tại quầy"}
                                </Badge>
                                {isDrop && rs.drop_box_received_at && (
                                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">
                                    Tiếp nhận: {new Date(rs.drop_box_received_at).toLocaleString("vi-VN")}
                                  </p>
                                )}
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  {isDrop ? "Xác nhận: " : "Trả lúc: "}
                                  {rs.returned_at ? new Date(rs.returned_at).toLocaleString("vi-VN") : "—"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-center font-bold">
                              {rs.book_count || slipItems.length || 1} cuốn
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {rs.librarian_name || rs.librarianName || "Thủ thư trực quầy"}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs font-semibold gap-1.5 border-sky-500/40 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/30 cursor-pointer"
                                onClick={() => {
                                  setSelectedReturnSlip({
                                    ...rs,
                                    reader_name: rs.reader_name || profile?.full_name || user?.full_name,
                                    card_number: rs.card_number || profile?.card_number || cardNumber,
                                    reader_phone: rs.reader_phone || profile?.phone,
                                    reader_status: rs.reader_status || profile?.status || "active",
                                  });
                                  setReturnSlipModalOpen(true);
                                }}
                              >
                                <QrCode className="h-3.5 w-3.5 text-sky-600" />
                                <span>Mở Phiếu Trả</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : (
            /* TAB RIÊNG: HÒM TRẢ SÁCH 24/7 & KẾT QUẢ KIỂM KÊ */
            <div className="space-y-0">
              <div className="px-4 py-3 bg-emerald-500/[0.04] border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Hòm Trả Sách 24/7 &amp; Kiểm Kê ({filteredDropBoxLoans.length})
                  </span>
                  {pendingDropBoxLoans.length > 0 && (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px]">
                      {pendingDropBoxLoans.length} chờ kiểm kê
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-64">
                    <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      value={dropBoxSearch}
                      onChange={(e) => setDropBoxSearch(e.target.value)}
                      placeholder="Tìm tên sách, mã QR, thủ thư..."
                      className="h-8 pl-8 pr-8 text-xs bg-background"
                    />
                    {dropBoxSearch && (
                      <button
                        type="button"
                        onClick={() => setDropBoxSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                        aria-label="Xóa tìm kiếm hòm trả"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSmartBookDropOpen(true)}
                    className="h-8 px-2.5 text-xs font-semibold gap-1.5 cursor-pointer"
                  >
                    <Inbox className="h-3.5 w-3.5 text-primary" />
                    <span>Gửi sách vào hòm</span>
                  </Button>
                </div>
              </div>

              {filteredDropBoxLoans.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                    <Inbox className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {normalizedDropBoxQuery
                        ? "Không tìm thấy bản ghi Hòm 24/7 nào khớp từ khóa"
                        : "Bạn chưa có lượt trả sách nào qua Hòm 24/7"}
                    </p>
                    {!normalizedDropBoxQuery && (
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-md mx-auto">
                        Khi bạn tự trả sách ngoài giờ qua Hòm 24/7, thông tin ảnh minh chứng và kết quả kiểm kê của Thủ thư sẽ hiển thị rõ ràng tại đây.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs font-semibold">Ấn Phẩm &amp; Mã Bản Sao</TableHead>
                        <TableHead className="text-xs font-semibold">Tiếp Nhận Hòm 24/7</TableHead>
                        <TableHead className="text-xs font-semibold">Thủ Thư Kiểm Kê</TableHead>
                        <TableHead className="text-xs font-semibold">Trạng Thái Đối Soát</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Phiếu Trả / Minh Chứng</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDropBoxLoans.map((d) => {
                        const isPending = d.status === "returned_drop_box" || d.drop_box_status === "pending_audit";
                        const isIntact = d.drop_box_status === "verified_intact";
                        const isDamaged = d.drop_box_status === "damaged";
                        const isMissing = d.drop_box_status === "missing";
                        return (
                          <TableRow key={d.id} className="hover:bg-muted/20">
                            <TableCell className="py-2.5">
                              <p className="font-medium text-xs text-foreground max-w-[240px] truncate">{d.book_title}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] font-mono text-muted-foreground">{d.qr_code}</span>
                                {d.pass_code && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenBorrowSlipCode(d.pass_code!, d)}
                                    className="inline-flex items-center px-1.5 py-0 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono text-[10px] cursor-pointer"
                                  >
                                    {d.pass_code}
                                  </button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="space-y-0.5">
                                <p className="font-mono text-[11px] text-foreground">
                                  {d.drop_box_at ? new Date(d.drop_box_at).toLocaleString("vi-VN") : "—"}
                                </p>
                                {d.drop_box_proof_image && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewProofImg({
                                        url: d.drop_box_proof_image!,
                                        title: d.book_title,
                                        time: d.drop_box_at ? new Date(d.drop_box_at).toLocaleString("vi-VN") : undefined,
                                        statusLabel: isPending
                                          ? "Đang chờ Thủ thư kiểm kê"
                                          : isIntact
                                          ? "Đã xác nhận nguyên vẹn"
                                          : isDamaged
                                          ? "Phát hiện hư hại"
                                          : "Báo thiếu sách",
                                        auditor: d.drop_box_audited_by_name,
                                        note: d.drop_box_audit_note
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline cursor-pointer"
                                  >
                                    <Eye className="h-3 w-3" /> Xem ảnh minh chứng
                                  </button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              {isPending ? (
                                <span className="text-[11px] text-muted-foreground italic">Đang chờ trực ca kiểm kê</span>
                              ) : (
                                <div className="space-y-0.5">
                                  <p className="font-medium text-foreground">{d.drop_box_audited_by_name || "Thủ thư trực ca"}</p>
                                  {d.drop_box_audited_at && (
                                    <p className="text-[10px] text-muted-foreground font-mono">
                                      {new Date(d.drop_box_audited_at).toLocaleString("vi-VN")}
                                    </p>
                                  )}
                                  {d.drop_box_audit_note && (
                                    <p className="text-[10px] text-muted-foreground italic max-w-[200px] truncate" title={d.drop_box_audit_note}>
                                      "{d.drop_box_audit_note}"
                                    </p>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {isPending ? (
                                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold gap-1">
                                  <Clock className="h-3 w-3" /> Chờ kiểm kê
                                </Badge>
                              ) : isDamaged ? (
                                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                                  Hư hại
                                </Badge>
                              ) : isMissing ? (
                                <Badge variant="destructive" className="text-[11px] font-semibold">
                                  Thiếu sách
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Đã xác nhận
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {d.return_slip_code ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs font-semibold gap-1.5 border-sky-500/40 text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/30 cursor-pointer"
                                  onClick={() => handleOpenReturnSlipCode(d.return_slip_code!)}
                                >
                                  <QrCode className="h-3.5 w-3.5 text-sky-600" />
                                  <span>{d.return_slip_code}</span>
                                </Button>
                              ) : isPending ? (
                                <span className="text-[11px] text-amber-600 italic">Chờ lập phiếu trả</span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DIALOG: MÃ QR THẺ ĐỘC GIẢ SỐ */}
      <Dialog open={qrCardModalOpen} onOpenChange={setQrCardModalOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-base flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              <span>Thẻ Thư Viện Số</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Đưa mã QR này cho Thủ thư tại quầy hoặc máy quét để mượn và trả sách tức thì.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-3 space-y-3">
            <div className="p-3 rounded-2xl bg-white border border-border shadow-xs">
              <QRCodeCanvas
                id="reader-card-qr-canvas"
                value={cardNumber}
                size={180}
                level="H"
                includeMargin={true}
              />
            </div>

            <div className="text-center space-y-0.5">
              <p className="font-semibold text-sm text-foreground">{readerFullName}</p>
              <p className="text-xs font-mono font-bold text-primary">{cardNumber}</p>
              {cardExpiry && (
                <p className="text-[11px] text-muted-foreground">Hạn thẻ: {cardExpiry}</p>
              )}
            </div>
          </div>

          <DialogFooter className="flex-row sm:justify-between gap-2">
            <Button
              onClick={handleDownloadQr}
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Tải Ảnh QR Thẻ</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setQrCardModalOpen(false)}
              className="text-xs cursor-pointer"
            >
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: HƯỚNG DẪN HOÀN TRẢ SÁCH */}
      <Dialog open={returnGuideOpen} onOpenChange={setReturnGuideOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-base flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              <span>Hướng Dẫn Hoàn Trả Sách Vào Kho</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Bạn có thể chọn một trong hai cách dưới đây để trả sách đúng hạn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1 text-xs">
            <div className="p-3 rounded-xl border border-border/80 bg-muted/20 space-y-1">
              <p className="font-semibold text-foreground">Cách 1 — Trả trực tiếp tại Quầy Thủ thư</p>
              <p className="text-muted-foreground leading-relaxed">
                Mang sách và mở <strong>Mã QR thẻ</strong> cho Thủ thư quét xác nhận trả sách nhập kho. Hệ thống sẽ tạo ngay <strong>Phiếu trả sách điện tử</strong> làm minh chứng.
              </p>
            </div>

            <div className="p-3 rounded-xl border border-border/80 bg-muted/20 space-y-1">
              <p className="font-semibold text-foreground">Cách 2 — Tự phục vụ qua Hòm Trả Sách 24/7</p>
              <p className="text-muted-foreground leading-relaxed">
                Bấm nút <strong>Hòm trả 24/7</strong>, quét mã bản sao trên gáy sách và đính kèm ảnh chụp minh chứng khi thả sách vào hòm. Hệ thống sẽ chốt mốc thời gian trả tức thì để không bị tính trễ hạn, sau đó Thủ thư sẽ kiểm kê xác nhận nhập kho.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              size="sm"
              onClick={() => {
                setReturnGuideOpen(false);
                setSmartBookDropOpen(true);
              }}
              className="gap-1.5 text-xs cursor-pointer"
            >
              <Inbox className="h-3.5 w-3.5" />
              <span>Mở Hòm Trả 24/7</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReturnGuideOpen(false)}
              className="text-xs cursor-pointer"
            >
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG: NỘI QUY THƯ VIỆN & QUY ĐỊNH LƯU THÔNG (Đồng bộ cấu hình hệ thống) */}
      <LibraryRulesDialog
        open={rulesDialogOpen}
        onOpenChange={setRulesDialogOpen}
        rules={readerRules}
      />

      {/* Reader Shelf QR Scanner Modal */}
      <Dialog open={isScannerOpen} onOpenChange={(open) => {
        setIsScannerOpen(open);
        if (!open) stopCameraScanner();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <span>Máy Quét Tem Sách Tại Kệ</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Đưa tem mã QR dán trên gáy sách (định dạng QR-BK-...) vào khung camera hoặc nhập mã thủ công để tự động đối soát và kích hoạt phiếu mượn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!isCameraActive ? (
              <div className="flex flex-col gap-3">
                <Button onClick={startCameraScanner} className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs cursor-pointer">
                  <Camera className="h-4 w-4" /> Bật Camera / WebCam Quét Trực Tiếp
                </Button>
                <Button variant="outline" className="w-full gap-2 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Tải ảnh mã QR từ thiết bị
                </Button>
                <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileUpload} />

                {/* Helpful camera guidance on LAN / Mobile HTTP */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs space-y-1.5">
                  <p className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 text-[11px]">
                    <Sparkles className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    Mẹo quét nhanh trên điện thoại &amp; mạng LAN:
                  </p>
                  <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-1 leading-snug">
                    <li>
                      <strong>Cách tiện lợi nhất:</strong> Mở ứng dụng Chụp ảnh trên điện thoại để chụp rõ tem mã QR trên gáy sách, sau đó chọn <strong>&quot;Tải ảnh mã QR từ thiết bị&quot;</strong> để hệ thống nhận diện lập tức.
                    </li>
                    <li>
                      Nếu truy cập qua địa chỉ IP mạng LAN (HTTP) và bị trình duyệt chặn Camera: Vào <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, thêm IP thư viện để cấp quyền mở Camera trực tiếp.
                    </li>
                  </ul>
                </div>

                <div className="relative my-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase">
                    <span className="bg-background px-2 text-muted-foreground font-medium">Hoặc nhập mã quét thủ công</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Nhập mã QR gáy sách (VD: QR-BK-33-2, QR-BK-1-1)..."
                    value={simulatedQrCode}
                    onChange={(e) => setSimulatedQrCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (simulatedQrCode.trim()) {
                          handleProcessScannedCode(simulatedQrCode);
                        }
                      }
                    }}
                    className="text-xs font-mono"
                  />
                  <Button
                    onClick={() => {
                      if (simulatedQrCode.trim()) {
                        handleProcessScannedCode(simulatedQrCode);
                      } else {
                        toast.error("Vui lòng nhập mã tem QR gáy sách");
                      }
                    }}
                    size="sm"
                    className="shrink-0 font-semibold text-xs cursor-pointer"
                  >
                    Xác nhận
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div id="reader-qr-reader-viewport" className="w-full h-64 rounded-xl overflow-hidden bg-black flex items-center justify-center border-2 border-primary/50 relative"></div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] text-muted-foreground animate-pulse flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Đang hướng camera vào tem sách...
                  </span>
                  <Button variant="outline" size="sm" onClick={stopCameraScanner} className="text-xs h-7 cursor-pointer">
                    Tắt Camera
                  </Button>
                </div>
              </div>
            )}

            {/* Quản lý sách trong phiếu & xử lý khi quét lộn */}
            {myActiveDraft && myActiveDraft.items && myActiveDraft.items.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <span>Sách trong phiếu ({myActiveDraft.verified_count || 0}/{myActiveDraft.items.length}):</span>
                  </span>
                  {myActiveDraft.all_verified && (
                    <Badge className="bg-emerald-600 text-white text-[10px]">Đã đủ 100%</Badge>
                  )}
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {myActiveDraft.items.map((it: any, i: number) => {
                    const isVer = Boolean(it.book_copy_id);
                    return (
                      <div key={it.item_id || it.id || i} className="flex items-center justify-between p-2 rounded-lg bg-muted/40 text-xs gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{it.book_title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <span className="text-[10px] text-muted-foreground">{it.location || "Kệ sách"}</span>
                            {isVer ? (
                              <Badge className="bg-emerald-600 text-white text-[9px] px-1 py-0 h-3.5 font-mono">
                                ✓ {it.copy_qr_code}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-amber-700 border-amber-400 text-[9px] px-1 py-0 h-3.5">
                                Chưa quét
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                            onClick={() => handleRemoveDraftItem(it.item_id || it.id, it.book_title)}
                            title="Xóa cuốn sách này khỏi phiếu mượn"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setIsScannerOpen(false); stopCameraScanner(); }} className="w-full text-xs cursor-pointer">
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Exit Pass & Digital Receipt Modal */}
      <ExitPassModal
        open={exitPassModalOpen}
        onOpenChange={setExitPassModalOpen}
        passData={myExitPassData}
        borrowRecords={records}
      />

      {/* Electronic Return Slip Modal */}
      <ReturnSlipModal
        open={returnSlipModalOpen}
        onOpenChange={setReturnSlipModalOpen}
        slipData={selectedReturnSlip}
        onOpenBorrowSlip={(code) => {
          setReturnSlipModalOpen(false);
          handleOpenBorrowSlipCode(code);
        }}
      />

      {/* Smart Book Drop 24/7 Modal */}
      <SmartBookDropModal
        open={smartBookDropOpen}
        onOpenChange={setSmartBookDropOpen}
        onSuccess={fetchMyData}
        myBorrowingBooks={activeLoans}
      />

      {/* Library Mini Map Modal */}
      <LibraryMiniMapModal
        open={miniMapOpen}
        onOpenChange={setMiniMapOpen}
        location={miniMapTarget.location}
        bookTitle={miniMapTarget.title}
        coverImage={miniMapTarget.cover}
      />

      {/* Proof Image Preview Modal */}
      <Dialog open={Boolean(previewProofImg)} onOpenChange={(v) => !v && setPreviewProofImg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-sky-600" />
              Ảnh Minh Chứng & Trạng Thái Hòm Trả 24/7
            </DialogTitle>
            <DialogDescription className="text-xs space-y-1 pt-1">
              <span className="block">
                Ấn phẩm: <strong>{previewProofImg?.title}</strong>
                {previewProofImg?.time ? ` • Thả hòm lúc: ${previewProofImg.time}` : ""}
              </span>
              {previewProofImg?.statusLabel && (
                <span className="block">
                  Trạng thái đối soát: <strong className="text-emerald-700">{previewProofImg.statusLabel}</strong>
                  {previewProofImg.auditor ? ` (Thủ thư: ${previewProofImg.auditor})` : ""}
                </span>
              )}
              {previewProofImg?.note && (
                <span className="block italic">Ghi chú: "{previewProofImg.note}"</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {previewProofImg && (
            <div className="rounded-xl overflow-hidden border bg-slate-950 flex items-center justify-center max-h-[60vh]">
              <img
                src={previewProofImg.url}
                alt="Ảnh minh chứng thả sách"
                className="max-h-[60vh] w-auto object-contain"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewProofImg(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
export default ReaderBorrowView;
