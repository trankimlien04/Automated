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
  BookMarked, ShieldAlert, Info, Camera, Upload, Check, Zap, X, MapPin, Copy, Scan,
  RotateCcw, Trash2, Eye, Image as ImageIcon
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { ExitPassModal } from "@/components/exit-pass-modal";
import { SmartBookDropModal } from "@/components/smart-book-drop-modal";
import { LibraryMiniMapModal } from "@/components/library-mini-map-modal";
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
  const [activeTab, setActiveTab] = useState<"borrowing" | "history">("borrowing");
  
  // Modals & State
  const [searchParams] = useSearchParams();
  const [exitPassModalOpen, setExitPassModalOpen] = useState(false);
  const [myExitPassData, setMyExitPassData] = useState<any>(null);
  const [exitPassHistory, setExitPassHistory] = useState<any[]>([]);
  const [myActiveDraft, setMyActiveDraft] = useState<any>(null);
  const [smartBookDropOpen, setSmartBookDropOpen] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
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
      const [recordsRes, exitPassRes, profileRes, draftRes, historyRes, circStatusRes] = await Promise.allSettled([
        api.get("/borrow/records"),
        api.get("/borrow/exit-passes/my-active"),
        api.get("/users/profile/me"),
        api.get("/borrow/drafts/my-active"),
        api.get("/borrow/exit-passes/my-history"),
        api.get("/fines/circulation-status")
      ]);

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
  const auditedDropBoxLoans = records.filter(
    r =>
      (Boolean(r.is_drop_box) || (r.drop_box_status && r.drop_box_status !== "none")) &&
      r.drop_box_status &&
      r.drop_box_status !== "none" &&
      r.drop_box_status !== "pending_audit"
  ).slice(0, 4);
  const activeLoans = records.filter(
    r => r.status === "borrowing" && !pendingDropBoxLoans.some(p => p.id === r.id)
  );
  const returnedHistory = records.filter(
    r => r.status === "returned" || r.status === "returned_drop_box" || Boolean(r.is_drop_box)
  );

  // Độc giả chỉ có Phiếu mượn chính thức đang lưu thông khi đang thực sự có sách mượn (activeLoans > 0)
  const hasActiveOfficialPass = activeLoans.length > 0 && Boolean(myExitPassData) && !myExitPassData?.isExpired;

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

  // Handler to open official borrow slip modal (from confirmed borrow slip or active borrowing books)
  const handleOpenDigitalReceipt = () => {
    if (myExitPassData) {
      setExitPassModalOpen(true);
      return;
    }
    if (activeLoans.length > 0) {
      setMyExitPassData({
        pass_code: `PM-BRW-RD-${user?.id || 1}-${Date.now().toString().slice(-4)}`,
        reader_name: profile?.full_name || user?.full_name || "Bạn đọc",
        card_number: cardNumber,
        book_count: activeLoans.length,
        items: activeLoans.map(l => ({
          title: l.book_title,
          copyQr: l.qr_code,
          coverImage: l.cover_image,
          dueDate: l.due_date ? new Date(l.due_date).toLocaleDateString("vi-VN") : undefined,
          borrowDate: l.borrow_date ? new Date(l.borrow_date).toLocaleDateString("vi-VN") : undefined
        })),
        status: "active",
        expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString()
      });
      setExitPassModalOpen(true);
      return;
    }
    toast.info("Hiện bạn chưa có Phiếu mượn chính thức nào đã được Thủ thư xác nhận");
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

  const formattedPassCode = (myExitPassData?.pass_code || myExitPassData?.passCode || "")
    .replace(/^PASS-EXP-/i, "PM-BRW-");

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Top Section: Digital Library Card (Left) + Stats & Unified Borrow Slip Hub (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Digital Membership Pass (Col 1 - 4 cols) */}
        <Card className="lg:col-span-4 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-background shadow-xs overflow-hidden flex flex-col justify-between">
          <CardHeader className="p-4 pb-3 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs border-primary/30 text-primary font-semibold">
                Thẻ Thư Viện Số
              </Badge>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {profile?.status === "active" ? "Đang hoạt động" : "Chờ kích hoạt"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-1.5">
              <CardTitle className="text-base sm:text-lg font-bold text-foreground truncate">
                {profile?.full_name || user?.fullName || "Độc giả"}
              </CardTitle>
              {cardExpiry && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  Hạn: <strong className="text-foreground font-medium">{cardExpiry}</strong>
                </span>
              )}
            </div>
            <CardDescription className="text-xs font-mono mt-0.5">
              Mã thẻ: <span className="font-bold text-primary text-sm">{cardNumber}</span>
            </CardDescription>
          </CardHeader>

          <CardContent className="p-4 flex flex-col items-center justify-center space-y-2.5 flex-1">
            <div className="p-2 rounded-xl bg-white shadow-xs border border-border">
              <QRCodeCanvas
                id="reader-card-qr-canvas"
                value={cardNumber}
                size={125}
                level="H"
                includeMargin={true}
              />
            </div>
            <p className="text-[11px] text-center text-muted-foreground max-w-[230px] leading-snug">
              Đưa mã này cho Thủ thư tại quầy hoặc máy quét để mượn và trả sách tức thì.
            </p>

            {/* Download QR Code Image Button */}
            <Button
              onClick={handleDownloadQr}
              variant="outline"
              size="sm"
              className="w-full max-w-[210px] gap-1.5 h-8 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 cursor-pointer shadow-2xs"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Tải Ảnh QR Thẻ</span>
            </Button>
          </CardContent>
        </Card>

        {/* Right Column (8 cols): 3 Stat Cards + Unified Official Borrow Slip & Quick Tools Card */}
        <div className="lg:col-span-8 flex flex-col justify-between gap-4">
          {/* 3 Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Đang mượn</p>
                    <p className="text-2xl font-bold text-foreground">
                      {activeLoans.length}{" "}
                      <span className="text-xs font-normal text-muted-foreground">/ 5 cuốn</span>
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px] font-medium">
                  Còn {Math.max(0, 5 - activeLoans.length)} suất
                </Badge>
              </CardContent>
            </Card>

            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                    <BookmarkCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Đã hoàn trả</p>
                    <p className="text-2xl font-bold text-foreground">
                      {returnedHistory.length}{" "}
                      <span className="text-xs font-normal text-muted-foreground">lượt</span>
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5">
                  Lưu thông tốt
                </Badge>
              </CardContent>
            </Card>

            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    activeLoans.filter(l => getDueDetails(l.due_date).isOverdue).length > 0
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Sách quá hạn</p>
                    <div className="flex items-baseline gap-1.5">
                      <p className={`text-2xl font-bold ${
                        activeLoans.filter(l => getDueDetails(l.due_date).isOverdue).length > 0
                          ? "text-destructive"
                          : "text-foreground"
                      }`}>
                        {activeLoans.filter(l => getDueDetails(l.due_date).isOverdue).length}
                      </p>
                    </div>
                  </div>
                </div>
                {activeLoans.filter(l => getDueDetails(l.due_date).isOverdue).length > 0 ? (
                  <Badge variant="destructive" className="text-[10px]">
                    Cần trả sách
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    Đúng hạn
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Unified Official Borrow Slip & Quick Circulation Tools Card (Fills middle + bottom cleanly) */}
          <Card className="flex-1 border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] via-card to-teal-500/[0.04] shadow-xs flex flex-col justify-between overflow-hidden rounded-2xl">
            {/* Top half: Confirmed Official Borrow Slip Status */}
            <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-3 border-b border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5">
                  <div className="h-11 w-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <FileSpreadsheet className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-sm sm:text-base font-bold text-emerald-800 dark:text-emerald-300">
                        Phiếu Mượn Chính Thức (Đối Soát & Kiểm Tra Ra Cổng)
                      </h3>
                      {hasActiveOfficialPass && (
                        <code className="px-2 py-0.5 bg-background rounded-md border border-emerald-500/30 text-xs font-mono font-bold text-foreground">
                          {formattedPassCode}
                        </code>
                      )}
                      {hasActiveOfficialPass ? (
                        myExitPassData?.displayStatus === "used" ? (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-[11px] gap-1 font-semibold">
                            <CheckCircle2 className="h-3 w-3 text-blue-600" /> Đã đối soát qua cổng
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold text-[11px] gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Đã được Thủ thư xác nhận
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-[11px] text-muted-foreground">
                          Chưa phát sinh
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {hasActiveOfficialPass
                        ? `Thủ thư đã quét xác nhận cho mượn ${myExitPassData?.book_count || myExitPassData?.bookCount || myExitPassData?.items?.length || 1} cuốn sách (chuyển đổi từ Phiếu mượn nháp). Dùng Phiếu mượn này khi cần đối soát mượn trả hoặc xuất trình khi ra cổng nếu được hỏi.`
                        : "Hiện tại bạn chưa có sách nào đang mượn lưu thông. Khi bạn hoàn tất mượn sách tại quầy Thủ thư, phiếu mượn chính thức kèm mã QR xuất trình ra cổng sẽ tự động hiển thị tại đây."}
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleOpenDigitalReceipt}
                  disabled={!hasActiveOfficialPass}
                  className={`font-bold text-xs gap-1.5 h-9 px-4 shadow-xs shrink-0 ${
                    hasActiveOfficialPass 
                      ? "cursor-pointer text-white bg-emerald-600 hover:bg-emerald-700" 
                      : "cursor-not-allowed opacity-60 text-muted-foreground bg-muted"
                  }`}
                >
                  <QrCode className="h-4 w-4" />
                  <span>Mở QR Phiếu Mượn</span>
                </Button>
              </div>

              {hasActiveOfficialPass && myExitPassData && Array.isArray(myExitPassData.items) && myExitPassData.items.length > 0 && (() => {
                const createdDate = myExitPassData.created_at ? new Date(myExitPassData.created_at) : new Date();
                const due14 = new Date(createdDate.getTime());
                due14.setDate(due14.getDate() + 14);
                const firstItem = myExitPassData.items[0];
                const matchedRec = records.find(r =>
                  (firstItem?.copyQr && r.qr_code === firstItem.copyQr) ||
                  (firstItem?.title && r.book_title === firstItem.title)
                );
                const borrowDateStr = matchedRec?.borrow_date
                  ? new Date(matchedRec.borrow_date).toLocaleDateString("vi-VN")
                  : createdDate.toLocaleDateString("vi-VN");
                const dueDateStr = matchedRec?.due_date
                  ? new Date(matchedRec.due_date).toLocaleDateString("vi-VN")
                  : due14.toLocaleDateString("vi-VN");

                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Sách trong phiếu:</span>
                      {myExitPassData.items.slice(0, 3).map((it: any, idx: number) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background border border-emerald-500/25 text-[11px] font-medium text-foreground"
                        >
                          <BookOpen className="h-3 w-3 text-emerald-600 shrink-0" />
                          <span className="truncate max-w-[160px]">{it.title || it.book_title}</span>
                          {(it.copyQr || it.qr_code) && (
                            <code className="text-[10px] font-mono font-bold text-emerald-700">({it.copyQr || it.qr_code})</code>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>Ngày mượn: <strong className="text-foreground">{borrowDateStr}</strong></span>
                      <span>Hạn trả (14 ngày): <strong className="text-emerald-700 dark:text-emerald-400">{dueDateStr}</strong></span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Bottom bar: Quick Action Tools */}
            <div className="px-4 py-3 bg-muted/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Tiện ích lưu thông tự phục vụ:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => {
                    setSimulatedQrCode("");
                    setIsScannerOpen(true);
                  }}
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-background hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer shadow-2xs"
                >
                  <Camera className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Quét Tem Sách Tại Kệ</span>
                </Button>

                <Button
                  onClick={() => setSmartBookDropOpen(true)}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-semibold gap-1.5 border-sky-400/60 text-sky-700 dark:text-sky-300 bg-background hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer shadow-2xs"
                >
                  <Inbox className="h-3.5 w-3.5 text-sky-600" />
                  <span>Hòm Trả Sách 24/7</span>
                </Button>

                <Button
                  onClick={() => setRulesDialogOpen(true)}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 bg-background hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer shadow-2xs"
                >
                  <BookMarked className="h-3.5 w-3.5 text-amber-600" />
                  <span>Nội Quy Thư Viện</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Multi-Cause Circulation Discipline Alert Banner */}
      {circulationStatus && !circulationStatus.eligibleToBorrow && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-xs">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-xs font-bold text-destructive uppercase tracking-wider">
                  Tài khoản đang tạm giới hạn quyền mượn sách ({circulationStatus.primaryStatus})
                </span>
                {Array.isArray(circulationStatus.restrictions) && circulationStatus.restrictions.length > 1 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {circulationStatus.restrictions.length} lý do đồng thời
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
                  <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-700 dark:text-orange-300 bg-background">
                    Chờ khắc phục sách hỏng/mất: {circulationStatus.pendingRemediationCount} biên bản
                  </Badge>
                )}
              </div>
            </div>
            <Link to="/fines" className="shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10">
                Xem chi tiết kỷ luật <ArrowRight className="h-3.5 w-3.5" />
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
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold">Danh Sách Ấn Phẩm & Phiếu Mượn</CardTitle>
              <CardDescription className="text-xs">
                Theo dõi tiến độ đọc, thời hạn mượn, gia hạn trực tuyến và tra cứu Phiếu mượn đối soát.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
                <TabsList className="h-8">
                  <TabsTrigger value="borrowing" className="text-xs h-7 px-3">
                    Đang giữ ({activeLoans.length}{pendingDropBoxLoans.length > 0 ? ` + ${pendingDropBoxLoans.length} chờ kiểm kê` : ""})
                  </TabsTrigger>
                  <TabsTrigger value="history" className="text-xs h-7 px-3">
                    Lịch sử đã trả ({returnedHistory.length})
                  </TabsTrigger>
                  <TabsTrigger value="receipts" className="text-xs h-7 px-3">
                    Phiếu mượn ({exitPassHistory.length})
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
            activeLoans.length === 0 && pendingDropBoxLoans.length === 0 && auditedDropBoxLoans.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Bạn hiện không mượn cuốn sách nào</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Khám phá kho sách và đặt trước cuốn bạn yêu thích ngay!</p>
                </div>
                <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs mt-2">
                  <Link to="/books">
                    <span>Khám phá kho sách</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {/* SÁCH ĐÃ THẢ VÀO HÒM 24/7 ĐANG CHỜ THỦ THƯ ĐỐI SOÁT KIỂM KÊ */}
                {pendingDropBoxLoans.length > 0 && (
                  <div className="p-3.5 bg-amber-500/10 border-b border-amber-500/30 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <Inbox className="h-3.5 w-3.5" />
                        </div>
                        <p className="font-bold text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center gap-2">
                          <span>Sách đã gửi Hòm trả 24/7 ({pendingDropBoxLoans.length} cuốn)</span>
                          <Badge className="bg-amber-600 text-white text-[10px] py-0 px-1.5 font-normal">
                            Đang chờ Thủ thư kiểm kê
                          </Badge>
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {pendingDropBoxLoans.map(p => (
                        <div key={p.id} className="p-2.5 rounded-xl bg-card border border-amber-300 dark:border-amber-900/60 flex items-center gap-2.5 shadow-2xs">
                          {p.cover_image ? (
                            <img src={p.cover_image} alt={p.book_title} className="h-10 w-8 object-cover rounded border shrink-0" />
                          ) : (
                            <div className="h-10 w-8 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                              <BookOpen className="h-4 w-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-xs text-foreground truncate">{p.book_title}</p>
                            <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                              {p.qr_code} • Thả lúc: {p.drop_box_at ? new Date(p.drop_box_at).toLocaleString("vi-VN") : "Chờ đối soát"}
                            </p>
                            {p.drop_box_proof_image && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewProofImg({
                                    url: p.drop_box_proof_image!,
                                    title: p.book_title,
                                    time: p.drop_box_at ? new Date(p.drop_box_at).toLocaleString("vi-VN") : undefined,
                                    statusLabel: "Đang chờ Thủ thư kiểm kê",
                                    note: p.drop_box_audit_note
                                  })
                                }
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline mt-0.5 cursor-pointer"
                              >
                                <Eye className="h-3 w-3" /> Xem ảnh minh chứng
                              </button>
                            )}
                          </div>
                          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300 text-[10px] shrink-0">
                            Chờ kiểm kê
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* KẾT QUẢ THỦ THƯ ĐÃ XÁC NHẬN HÒM TRẢ 24/7 (COMPACT STRIP) */}
                {auditedDropBoxLoans.length > 0 && (
                  <div className="px-4 py-3 bg-emerald-500/[0.04] border-b border-emerald-500/20 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="font-bold text-foreground text-xs">
                          Kết quả Thủ thư xác nhận Hòm trả 24/7 gần nhất
                        </span>
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 text-[10px] py-0 px-1.5 h-4">
                          {auditedDropBoxLoans.length} cuốn đã đối soát
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setActiveTab("history")}
                        className="h-6 text-[11px] text-primary hover:underline px-2 shrink-0"
                      >
                        Xem lịch sử trả →
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {auditedDropBoxLoans.slice(0, 2).map(a => {
                        const isIntact = a.drop_box_status === "verified_intact";
                        const isDamaged = a.drop_box_status === "damaged";
                        return (
                          <div
                            key={a.id}
                            className={`px-3 py-2 rounded-xl bg-card border flex items-center justify-between gap-2.5 shadow-2xs ${
                              isIntact
                                ? "border-emerald-300/80 dark:border-emerald-900/60"
                                : isDamaged
                                ? "border-amber-400 dark:border-amber-900/60"
                                : "border-destructive/50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              {a.cover_image ? (
                                <img src={a.cover_image} alt={a.book_title} className="h-9 w-7 object-cover rounded border shrink-0" />
                              ) : (
                                <div className="h-9 w-7 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                                  <BookOpen className="h-3.5 w-3.5" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-semibold text-xs text-foreground truncate">{a.book_title}</p>
                                <p className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                                  Thủ thư: <strong>{a.drop_box_audited_by_name || "Thủ thư trực ca"}</strong>
                                  {a.drop_box_audited_at ? ` • ${new Date(a.drop_box_audited_at).toLocaleDateString("vi-VN")}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {a.drop_box_proof_image && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[10px] text-sky-600 hover:text-sky-800 gap-1"
                                  onClick={() =>
                                    setPreviewProofImg({
                                      url: a.drop_box_proof_image!,
                                      title: a.book_title,
                                      time: a.drop_box_at ? new Date(a.drop_box_at).toLocaleString("vi-VN") : undefined,
                                      statusLabel: isIntact ? "Đã xác nhận nguyên vẹn" : isDamaged ? "Phát hiện hư hại" : "Báo thiếu sách",
                                      auditor: a.drop_box_audited_by_name,
                                      note: a.drop_box_audit_note
                                    })
                                  }
                                >
                                  <Eye className="h-3 w-3" /> Ảnh
                                </Button>
                              )}
                              {isIntact ? (
                                <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-1.5 h-5">
                                  ✓ Đã xác nhận
                                </Badge>
                              ) : isDamaged ? (
                                <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-50 text-[10px] py-0 px-1.5 h-5">
                                  ⚠️ Hư hại
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-5">
                                  🚨 Thiếu sách
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Notice banner on how to return books */}
                <div className="p-3.5 bg-sky-500/5 border-b border-border/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-600 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                      <Info className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-xs sm:text-sm">Hướng dẫn hoàn trả sách vào kho thư viện:</p>
                      <p className="text-muted-foreground text-[11px] leading-relaxed mt-0.5">
                        • <strong>Cách 1 (Tại Quầy):</strong> Đưa sách và Thẻ thư viện số cho Thủ thư quét nhận trả sách nhập kho.<br />
                        • <strong>Cách 2 (Tự phục vụ):</strong> Bấm <strong>"Trả qua Hòm 24/7"</strong> (bắt buộc đính kèm ảnh chụp minh chứng khi thả sách vào hòm).
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setSmartBookDropOpen(true)}
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-bold gap-1.5 border-sky-500/40 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 shrink-0 cursor-pointer shadow-2xs"
                  >
                    <Inbox className="h-3.5 w-3.5 text-sky-600" />
                    <span>Mở Hòm Trả 24/7</span>
                  </Button>
                </div>

                {activeLoans.map((loan) => {
                  const dueInfo = getDueDetails(loan.due_date, loan.fine_already_paid);
                  return (
                    <div key={loan.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-3.5 min-w-0">
                        {loan.cover_image ? (
                          <img
                            src={loan.cover_image}
                            alt={loan.book_title}
                            className="h-16 w-12 object-cover rounded-md border border-border shrink-0 shadow-2xs"
                          />
                        ) : (
                          <div className="h-16 w-12 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-border">
                            <BookOpen className="h-6 w-6" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground text-sm truncate">{loan.book_title}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            Mã bản sao: <span className="font-semibold text-foreground">{loan.qr_code}</span>
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              Mượn ngày: {new Date(loan.borrow_date).toLocaleDateString("vi-VN")}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <Clock className="h-3.5 w-3.5 text-primary" />
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

                          {/* Note if drop box return is already verified or pending audit */}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-border/60">
                        <div className="text-right">
                          <Badge variant="outline" className={`text-xs font-semibold px-2.5 py-1 ${dueInfo.badgeClass}`}>
                            {dueInfo.label}
                          </Badge>
                          {dueInfo.subLabel && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{dueInfo.subLabel}</p>
                          )}
                        </div>

                        {/* Return via 24/7 drop box button */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSmartBookDropOpen(true)}
                          className="h-8 text-xs font-semibold gap-1.5 border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer"
                          title="Tự hoàn trả cuốn sách này vào Hòm trả 24/7 ngoài giờ"
                        >
                          <Inbox className="h-3.5 w-3.5 text-sky-600" />
                          <span>Trả qua Hòm 24/7</span>
                        </Button>

                        {!dueInfo.isOverdue && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={renewingId === loan.id || (loan.renewal_count || 0) >= 2}
                            onClick={() => handleRenew(loan.id, loan.book_title)}
                            className="h-8 text-xs font-semibold gap-1.5 border-primary/40 text-primary hover:bg-primary/10 cursor-pointer"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${renewingId === loan.id ? "animate-spin" : ""}`} />
                            <span>Gia hạn 7 ngày</span>
                          </Button>
                        )}
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
                      <TableHead className="text-xs">Mã bản sao</TableHead>
                      <TableHead className="text-xs">Ngày mượn</TableHead>
                      <TableHead className="text-xs">Hình thức & Kênh trả</TableHead>
                      <TableHead className="text-xs text-right">Trạng thái Thủ thư xác nhận</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returnedHistory.map((h) => {
                      const isDropBox = h.status === "returned_drop_box" || Boolean(h.is_drop_box) || h.return_method === "drop_box";
                      const isPendingAudit = h.status === "returned_drop_box" || h.drop_box_status === "pending_audit";
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="font-medium text-xs text-foreground max-w-[240px] truncate">
                            {h.book_title}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{h.qr_code}</TableCell>
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
                                  Thả: {h.drop_box_at ? new Date(h.drop_box_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""} {h.drop_box_at ? new Date(h.drop_box_at).toLocaleDateString("vi-VN") : (h.return_date ? new Date(h.return_date).toLocaleDateString("vi-VN") : "")}
                                </span>
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
                                  {h.return_date ? new Date(h.return_date).toLocaleDateString("vi-VN") : "—"}
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
          ) : (
            /* DANH SÁCH TẤT CẢ PHIẾU MƯỢN ĐÃ XÁC NHẬN */
            exitPassHistory.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Bạn chưa có Phiếu mượn chính thức nào được lưu</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Khi Thủ thư quét xác nhận cho mượn sách tại quầy, Phiếu mượn nháp sẽ chuyển thành Phiếu mượn chính thức và lưu tại đây để đối soát & ra cổng.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold">Mã Phiếu Mượn</TableHead>
                      <TableHead className="text-xs font-semibold">Ngày Mượn (Xác Nhận)</TableHead>
                      <TableHead className="text-xs font-semibold">Hạn Trả (14 Ngày)</TableHead>
                      <TableHead className="text-xs font-semibold text-center">Số Lượng Sách</TableHead>
                      <TableHead className="text-xs font-semibold">Trạng Thái Đối Soát</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Thao Tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exitPassHistory.map((ep) => {
                      const createdDate = ep.created_at ? new Date(ep.created_at) : new Date();
                      const due14 = new Date(createdDate.getTime());
                      due14.setDate(due14.getDate() + 14);
                      const firstItem = Array.isArray(ep.items) ? ep.items[0] : null;
                      const matchedRec = firstItem
                        ? records.find(r =>
                            (firstItem.copyQr && r.qr_code === firstItem.copyQr) ||
                            (firstItem.title && r.book_title === firstItem.title)
                          )
                        : null;
                      const resolvedDueStr = matchedRec?.due_date
                        ? new Date(matchedRec.due_date).toLocaleDateString("vi-VN")
                        : due14.toLocaleDateString("vi-VN");

                      return (
                      <TableRow key={ep.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-xs font-bold text-foreground">
                          {String(ep.pass_code || "").replace(/^PASS-EXP-/i, "PM-BRW-")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {createdDate.toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          {resolvedDueStr}
                        </TableCell>
                        <TableCell className="text-xs text-center font-bold text-foreground">
                          {ep.book_count || ep.items?.length || 1} cuốn
                        </TableCell>
                        <TableCell className="text-xs">
                          {ep.displayStatus === "used" ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 text-[11px] font-semibold gap-1">
                              <CheckCircle2 className="h-3 w-3 text-blue-600" /> Đã đối soát qua cổng
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-600 text-white text-[11px] font-semibold gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Đã xác nhận cho mượn (Sẵn sàng đối soát)
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer shadow-2xs"
                            onClick={() => {
                              setMyExitPassData(ep);
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
            )
          )}
        </CardContent>
      </Card>

      {/* DIALOG: NỘI QUY THƯ VIỆN & QUY ĐỊNH LƯU THÔNG */}
      <Dialog open={rulesDialogOpen} onOpenChange={setRulesDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <BookMarked className="h-5 w-5" />
              <DialogTitle className="text-lg font-bold text-foreground">
                Nội Quy Thư Viện & Quy Định Lưu Thông Sách
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Vui lòng nắm rõ các quy chế để đảm bảo quyền lợi mượn đọc và giữ gìn tài nguyên chung.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs text-foreground">
            {/* Rule 1 */}
            <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 space-y-1.5">
              <p className="font-bold text-primary flex items-center gap-1.5 text-sm">
                <Check className="h-4 w-4" /> 1. Hạn mức mượn sách & Thời gian đọc
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li>Mỗi độc giả được mượn tối đa <strong>05 cuốn sách</strong> trong cùng một thời điểm.</li>
                <li>Thời hạn mượn tiêu chuẩn là <strong>14 ngày</strong> kể từ ngày hoàn tất thủ tục xuất mượn tại quầy.</li>
              </ul>
            </div>

            {/* Rule 2 */}
            <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
              <p className="font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                <RefreshCw className="h-4 w-4" /> 2. Chính sách gia hạn sách trực tuyến
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li>Mỗi cuốn sách được gia hạn tối đa <strong>02 lần</strong> (mỗi lần thêm <strong>07 ngày</strong>).</li>
                <li>Điều kiện gia hạn: Sách chưa quá hạn và chưa có độc giả khác đặt trước trong hàng đợi.</li>
              </ul>
            </div>

            {/* Rule 3 */}
            <div className="p-3.5 rounded-xl bg-destructive/5 border border-destructive/20 space-y-1.5">
              <p className="font-bold text-destructive flex items-center gap-1.5 text-sm">
                <AlertTriangle className="h-4 w-4" /> 3. Quy chế quá hạn, tạm ngưng mượn & khắc phục (Không thu tiền)
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li><strong>Đang giữ sách quá hạn (OVERDUE):</strong> Tự động khóa quyền mượn mới và đặt trước cho đến khi hoàn trả sách về thư viện.</li>
                <li><strong>Trả sách trễ hạn (SUSPENDED):</strong> Áp dụng thời gian tạm ngưng quyền mượn theo quy chế thư viện (cấu hình số ngày đình chỉ trên mỗi ngày trễ và mức trần tối đa). Hết thời hạn sẽ tự động mở khóa nếu không còn vi phạm khác.</li>
                <li><strong>Hư hỏng / Mất sách (PENDING_REMEDIATION):</strong> Không thu tiền phạt; Thủ thư lập biên bản hiện trạng và độc giả khắc phục hoặc nộp sách thay thế tương đương theo quy chế để được xác nhận mở khóa.</li>
              </ul>
            </div>

            {/* Rule 4 */}
            <div className="p-3.5 rounded-xl bg-sky-500/5 border border-sky-500/20 space-y-1.5">
              <p className="font-bold text-sky-700 dark:text-sky-400 flex items-center gap-1.5 text-sm">
                <Inbox className="h-4 w-4" /> 4. Trả sách ngoài giờ (Hòm trả sách 24/7)
              </p>
              <p className="text-muted-foreground leading-relaxed pl-1">
                Khi thư viện đóng cửa, độc giả có thể sử dụng tính năng <strong>Hòm Trả Sách 24/7</strong> và thả sách vào khe hòm ngoại tuyến tại cửa thư viện (bắt buộc kèm ảnh minh chứng). Thời điểm gửi sách sẽ được chốt làm mốc thời gian hoàn trả để không phát sinh thêm ngày trễ hạn.
              </p>
            </div>

            {/* Rule 5 */}
            <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1.5">
              <p className="font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 text-sm">
                <ShieldAlert className="h-4 w-4" /> 5. Đối soát Phiếu mượn khi ra cổng & Bảo quản tài liệu
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li>Khi đăng ký giữ chỗ online 24h, hệ thống khóa giữ riêng 1 bản sao và tạo <strong>Phiếu mượn nháp</strong>. Khi Thủ thư quét xác nhận cho mượn tại quầy, phiếu sẽ chuyển thành <strong>Phiếu mượn chính thức</strong> để đối soát mượn trả và xuất trình khi ra cổng nếu được hỏi.</li>
                <li>Không viết, vẽ, gập trang, làm rách hoặc bóc tem mã vạch QR định danh dán trên gáy sách.</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setRulesDialogOpen(false)} size="sm" className="font-semibold">
              Tôi đã hiểu nội quy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exit Pass Modal */}
      {exitPassModalOpen && myExitPassData && (
        <ExitPassModal
          open={exitPassModalOpen}
          onOpenChange={setExitPassModalOpen}
          passData={myExitPassData}
        />
      )}

      {/* Smart Book Drop Modal */}
      {smartBookDropOpen && (
        <SmartBookDropModal
          open={smartBookDropOpen}
          onOpenChange={setSmartBookDropOpen}
          onSuccess={fetchMyData}
          myBorrowingBooks={activeLoans.map(l => ({
            id: l.id,
            book_title: l.book_title,
            qr_code: l.qr_code,
            due_date: l.due_date
          }))}
        />
      )}

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
