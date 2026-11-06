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
  RotateCcw, Trash2
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { ExitPassModal } from "@/components/exit-pass-modal";
import { SmartBookDropModal } from "@/components/smart-book-drop-modal";
import { LibraryMiniMapModal } from "@/components/library-mini-map-modal";
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
  return_method?: "drop_box" | "counter";
}

export function ReaderBorrowView() {
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const [profile, setProfile] = useState<any>(null);
  const [records, setRecords] = useState<BorrowRecord[]>([]);
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
      const [recordsRes, exitPassRes, profileRes, draftRes, historyRes] = await Promise.allSettled([
        api.get("/borrow/records"),
        api.get("/borrow/exit-passes/my-active"),
        api.get("/users/profile/me"),
        api.get("/borrow/drafts/my-active"),
        api.get("/borrow/exit-passes/my-history")
      ]);

      if (recordsRes.status === "fulfilled") {
        setRecords(recordsRes.value.data || []);
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

    // 1. Nếu đang có phiếu mượn online, gửi đối soát bản sao
    if (myActiveDraft) {
      try {
        const res = await api.post(`/borrow/drafts/${encodeURIComponent(myActiveDraft.draft_code)}/verify-copy`, {
          copyQr: clean
        });
        toast.success(res.data.message || `Đã đối soát thành công bản sao ${clean}!`);
        await fetchMyData();
        return;
      } catch (err: any) {
        // Thông báo lỗi rõ ràng nếu quét nhầm sách không thuộc phiếu hoặc sách bị giữ chỗ
        toast.error(err.response?.data?.message || "Đối soát sách thất bại. Vui lòng kiểm tra tem mã QR!");
        return;
      }
    }

    // 2. Thêm vào giỏ mượn tại chỗ (scan-direct)
    try {
      const res = await api.post("/borrow/drafts/scan-direct", {
        copyQr: clean
      });
      toast.success(res.data.message || `Đã thêm cuốn sách (${clean}) vào giỏ mượn online!`);
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
  const activeLoans = records.filter(
    r => r.status === "borrowing" && !pendingDropBoxLoans.some(p => p.id === r.id)
  );
  const returnedHistory = records.filter(
    r => r.status === "returned" || r.status === "returned_drop_box" || Boolean(r.is_drop_box)
  );

  // Handler to open digital receipt modal (either from active exit pass or active borrowing books)
  const handleOpenDigitalReceipt = () => {
    if (myExitPassData) {
      setExitPassModalOpen(true);
      return;
    }
    if (activeLoans.length > 0) {
      setMyExitPassData({
        pass_code: `RECEIPT-RD-${user?.id || 1}-${Date.now().toString().slice(-4)}`,
        reader_name: profile?.full_name || user?.full_name || "Bạn đọc",
        card_number: cardNumber,
        book_count: activeLoans.length,
        items: activeLoans.map(l => ({
          title: l.book_title,
          copyQr: l.qr_code,
          coverImage: l.cover_image,
          dueDate: l.due_date,
          borrowDate: l.borrow_date
        })),
        status: "active",
        expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });
      setExitPassModalOpen(true);
      return;
    }
    toast.info("Hiện bạn không có ấn phẩm nào đang mượn để xuất biên lai");
  };

  const getDueDetails = (dueDateStr: string, fineAlreadyPaid?: boolean) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      if (fineAlreadyPaid) {
        return {
          isOverdue: true,
          fineAlreadyPaid: true,
          days: Math.abs(diffDays),
          label: `Quá hạn (Đã nộp phạt)`,
          subLabel: "Chờ hoàn trả sách vào kho",
          badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold"
        };
      }
      return {
        isOverdue: true,
        fineAlreadyPaid: false,
        days: Math.abs(diffDays),
        label: `Quá hạn ${Math.abs(diffDays)} ngày`,
        subLabel: "Cần đóng phạt khi trả",
        badgeClass: "bg-destructive/15 text-destructive border-destructive/30"
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome & Digital Identity Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Digital Membership Pass (Col 1) */}
        <Card className="lg:col-span-1 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-background shadow-xs overflow-hidden flex flex-col justify-between">
          <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs border-primary/30 text-primary font-semibold">
                Thẻ Thư Viện Số
              </Badge>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {profile?.status === "active" ? "Đang hoạt động" : "Chờ kích hoạt"}
              </span>
            </div>
            <CardTitle className="text-lg font-bold text-foreground mt-1">
              {profile?.full_name || user?.fullName || "Độc giả"}
            </CardTitle>
            <CardDescription className="text-xs font-mono">
              Mã thẻ: <span className="font-bold text-primary text-sm">{cardNumber}</span>
            </CardDescription>
            {cardExpiry && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Hạn thẻ: <span className="text-foreground font-medium">{cardExpiry}</span>
              </p>
            )}
          </CardHeader>

          <CardContent className="pt-4 pb-4 flex flex-col items-center justify-center space-y-3">
            <div className="p-2.5 rounded-xl bg-white shadow-xs border border-border">
              <QRCodeCanvas
                id="reader-card-qr-canvas"
                value={cardNumber}
                size={145}
                level="H"
                includeMargin={true}
              />
            </div>
            <p className="text-[11px] text-center text-muted-foreground max-w-[220px]">
              Đưa mã này cho Thủ thư tại quầy hoặc máy quét để mượn và trả sách tức thì.
            </p>

            {/* Download QR Code Image Button */}
            <Button
              onClick={handleDownloadQr}
              variant="outline"
              size="sm"
              className="w-full max-w-[220px] gap-1.5 h-8 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 cursor-pointer shadow-2xs"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Tải Ảnh QR Thẻ</span>
            </Button>
          </CardContent>
        </Card>

        {/* Quick Summary & Quick Actions (Col 2 & 3) */}
        <div className="lg:col-span-2 flex flex-col justify-between space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Đang mượn</p>
                  <p className="text-2xl font-bold text-foreground">{activeLoans.length} <span className="text-xs font-normal text-muted-foreground">/ 5 cuốn</span></p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                  <BookmarkCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Đã trả</p>
                  <p className="text-2xl font-bold text-foreground">{returnedHistory.length} <span className="text-xs font-normal text-muted-foreground">lượt</span></p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border shadow-2xs">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                  activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && !l.fine_already_paid).length > 0
                    ? "bg-destructive/10 text-destructive"
                    : activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && l.fine_already_paid).length > 0
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-muted text-muted-foreground"
                }`}>
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Quá hạn</p>
                  <div className="flex items-baseline gap-1.5">
                    <p className={`text-2xl font-bold ${
                      activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && !l.fine_already_paid).length > 0
                        ? "text-destructive"
                        : "text-foreground"
                    }`}>
                      {activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && !l.fine_already_paid).length}
                    </p>
                    {activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && l.fine_already_paid).length > 0 && (
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        (+{activeLoans.filter(l => getDueDetails(l.due_date, l.fine_already_paid).isOverdue && l.fine_already_paid).length} đã nộp phạt)
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Utility Strip with Rules & Scanner Buttons */}
          <Card className="border-primary/20 bg-gradient-to-r from-card via-primary/5 to-card p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 text-sm">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {myExitPassData ? "Biên lai mượn số đang hoạt động" : "Biên lai mượn điện tử"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {myExitPassData ? "Dùng để xuất trình tại Cổng kiểm soát lối ra thư viện." : "Vé ra cổng an ninh sẽ tự động xuất hiện sau khi mượn sách tại quầy."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              {/* Camera Scanner Button for Shelf QR Scan */}
              <Button
                onClick={() => {
                  setSimulatedQrCode("");
                  setIsScannerOpen(true);
                }}
                size="sm"
                className="h-8 text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Quét Tem Sách Tại Kệ</span>
              </Button>

              {/* Library Rules Button */}
              <Button
                onClick={() => setRulesDialogOpen(true)}
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer shadow-2xs"
              >
                <BookMarked className="h-3.5 w-3.5 text-amber-600" />
                <span>Nội Quy Thư Viện</span>
              </Button>

              <Button
                onClick={handleOpenDigitalReceipt}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs gap-1.5 h-8 shadow-xs cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>{myExitPassData ? "Mở Vé Ra Cổng" : "Biên Lai Mượn Điện Tử"}</span>
              </Button>

              <Button
                onClick={() => setSmartBookDropOpen(true)}
                variant="outline"
                size="sm"
                className="border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-xs gap-1.5 h-8 cursor-pointer"
              >
                <Inbox className="h-3.5 w-3.5 text-sky-600" />
                <span>Hòm Trả Sách 24/7</span>
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Active or Retained Digital Exit Pass & Receipt Banner */}
      {myExitPassData && (
        <Card className={`border-2 shadow-sm overflow-hidden rounded-2xl ${
          myExitPassData.isValid
            ? "border-emerald-500 bg-gradient-to-r from-emerald-500/10 via-card to-teal-500/10"
            : "border-slate-300 dark:border-slate-700 bg-gradient-to-r from-slate-500/5 via-card to-slate-500/5"
        }`}>
          <CardHeader className={`p-4 border-b ${myExitPassData.isValid ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/40 border-border/60"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl text-white flex items-center justify-center shrink-0 shadow-xs ${
                  myExitPassData.isValid ? "bg-emerald-600 animate-pulse" : "bg-slate-600"
                }`}>
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className={`font-display text-sm sm:text-base font-bold ${
                      myExitPassData.isValid ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
                    }`}>
                      {myExitPassData.isValid
                        ? "Biên Lai Mượn Sách & Vé Ra Cổng An Ninh"
                        : "Biên Lai Mượn Sách Số Hóa (Đã Lưu Trữ)"}
                    </CardTitle>
                    <code className="px-2 py-0.5 bg-background rounded-md border text-xs font-mono font-bold">
                      {myExitPassData.pass_code || myExitPassData.passCode}
                    </code>
                    {myExitPassData.isValid ? (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold text-[11px] gap-1">
                        <Clock className="h-3 w-3 text-amber-600" /> Còn hiệu lực ra cổng {myExitPassData.minutesLeft ?? 30} phút
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 text-[11px] gap-1 font-semibold">
                        <CheckCircle2 className="h-3 w-3 text-slate-500" /> Hết hiệu lực ra cổng (Đã lưu chứng từ số)
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs mt-0.5 text-muted-foreground">
                    {myExitPassData.isValid
                      ? `Thủ thư đã duyệt xuất kho thành công ${myExitPassData.book_count || myExitPassData.bookCount || myExitPassData.items?.length || 1} cuốn sách. Xuất trình mã QR biên lai này tại Cổng kiểm soát lối ra thư viện.`
                      : `Chứng nhận điện tử cho đợt mượn ${myExitPassData.book_count || myExitPassData.bookCount || myExitPassData.items?.length || 1} cuốn sách. Bạn luôn có thể tra cứu và in lại biên lai này bất kỳ lúc nào.`}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => setExitPassModalOpen(true)}
                  className={`font-bold text-xs gap-1.5 h-9 px-3.5 shadow-xs cursor-pointer text-white ${
                    myExitPassData.isValid ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-700 hover:bg-slate-800"
                  }`}
                >
                  <QrCode className="h-4 w-4" />
                  <span>{myExitPassData.isValid ? "Mở Vé Ra Cổng & Biên Lai" : "Xem Biên Lai Lưu Trữ"}</span>
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Active Online Draft Borrow Slip (Nếu độc giả đang có phiếu giữ chỗ/mượn nháp online) */}
      {myActiveDraft && (
        <Card className={`border-2 shadow-sm overflow-hidden transition-all ${
          myActiveDraft.all_verified
            ? "border-emerald-500 bg-gradient-to-r from-emerald-500/10 via-card to-emerald-500/5"
            : "border-primary/40 bg-gradient-to-r from-primary/10 via-card to-amber-500/5"
        }`}>
          <CardHeader className={`pb-3 border-b ${myActiveDraft.all_verified ? "bg-emerald-500/10" : "bg-primary/5"}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-2 rounded-xl text-white shadow-xs shrink-0 ${myActiveDraft.all_verified ? "bg-emerald-600 animate-pulse" : "bg-primary"}`}>
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className={`font-display text-sm sm:text-base font-bold ${myActiveDraft.all_verified ? "text-emerald-700 dark:text-emerald-300" : "text-primary"}`}>
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
                      ? "🎉 Đã đối soát xong 100% sách. Chỉ cần xuất trình Thẻ Thư Viện bên trên cho Thủ thư quét để nhận sách trong 3 giây!"
                      : `Đến đúng vị trí kệ theo danh sách bên dưới và bấm "Quét Tem Sách" để tự đối soát trước khi ra quầy.`}
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
                  <X className="h-3.5 w-3.5" /> Hủy phiếu
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              {/* Status Callout */}
              {myActiveDraft.all_verified ? (
                <div className="flex flex-col items-center justify-center p-3.5 bg-emerald-500/10 rounded-xl border-2 border-emerald-500 shadow-2xs space-y-2 text-center">
                  <div className="h-10 w-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs animate-pulse">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <Badge className="bg-emerald-600 text-white font-bold text-xs px-2 py-0.5">
                      ✓ ĐÃ ĐỐI SOÁT ĐỦ {myActiveDraft.items?.length || 0} CUỐN
                    </Badge>
                    <p className="text-xs font-bold text-foreground mt-1">Sẵn Sàng Ra Quầy Nhận Sách!</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Đưa mã thẻ thư viện bên trên cho Thủ thư duyệt trong 3 giây.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-3.5 bg-amber-500/10 rounded-xl border-2 border-amber-400/50 shadow-2xs space-y-2.5 text-center">
                  <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs">
                      Đang đối soát tại kệ: {myActiveDraft.verified_count || 0}/{myActiveDraft.items?.length || 0} cuốn
                    </Badge>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Đến đúng kệ lấy sách, bấm nút bên dưới để quét mã gáy sách.
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
                    <span>Danh sách {myActiveDraft.items?.length || 0} cuốn cần lấy:</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {myActiveDraft.verified_count || 0}/{myActiveDraft.items?.length || 0} đã quét
                    </Badge>
                  </span>
                  {!myActiveDraft.all_verified && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50 cursor-pointer"
                      onClick={() => {
                        setSimulatedQrCode("");
                        setIsScannerOpen(true);
                      }}
                    >
                      <Camera className="h-3 w-3 text-emerald-600" /> Quét tại kệ
                    </Button>
                  )}
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {myActiveDraft.items?.map((item: any, idx: number) => {
                    const isVerified = Boolean(item.book_copy_id);
                    return (
                      <div
                        key={item.item_id || item.id || idx}
                        className={`p-2.5 bg-background border rounded-xl flex items-center justify-between gap-2.5 text-xs shadow-2xs transition-colors ${
                          isVerified ? "border-emerald-500/40 bg-emerald-50/15 dark:bg-emerald-950/20" : "hover:border-primary/40"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`h-5 w-5 rounded-full font-bold text-[10px] flex items-center justify-center shrink-0 ${
                            isVerified ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"
                          }`}>
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
                                <Badge className="bg-emerald-600 text-white text-[10px] py-0 px-1.5 h-4 gap-0.5 font-mono">
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
                            onClick={() => {
                              setMiniMapTarget({ location: item.location, title: item.book_title, cover: item.cover_image });
                              setMiniMapOpen(true);
                            }}
                            title="Xem sơ đồ vị trí kệ sách"
                          >
                            <MapPin className="h-3 w-3 text-primary" />
                            <span className="truncate max-w-[80px] sm:max-w-[100px]">{item.location || "Kệ sách"}</span>
                          </Button>

                          {!isVerified ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 text-[10px] px-2 font-semibold gap-1 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border border-amber-300 cursor-pointer"
                              onClick={() => {
                                setSimulatedQrCode("");
                                setIsScannerOpen(true);
                              }}
                              title="Quét tem mã QR cuốn sách này"
                            >
                              <Camera className="h-3 w-3" /> Quét
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] px-2 font-medium gap-1 text-amber-700 hover:bg-amber-500/10 border-amber-300 cursor-pointer"
                              onClick={() => handleUnverifyDraftItem(item.item_id || item.id, item.book_title)}
                              title="Quét lộn sách hoặc muốn đổi bản sao khác? Bấm để gỡ mã và quét lại"
                            >
                              <RotateCcw className="h-3 w-3 text-amber-600" /> Quét lại
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10 cursor-pointer shrink-0"
                            onClick={() => handleRemoveDraftItem(item.item_id || item.id, item.book_title)}
                            title="Xóa cuốn sách này khỏi phiếu mượn"
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
      )}

      {/* Main Borrow Management Section */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold">Danh Sách Ấn Phẩm</CardTitle>
              <CardDescription className="text-xs">
                Theo dõi tiến độ đọc, thời hạn mượn và xin gia hạn trực tuyến.
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
                    Biên lai ({exitPassHistory.length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {activeLoans.length > 0 && (
                <Button
                  onClick={handleOpenDigitalReceipt}
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer shadow-2xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Biên Lai Mượn Số</span>
                </Button>
              )}

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
            activeLoans.length === 0 && pendingDropBoxLoans.length === 0 ? (
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
                  <div className="p-4 bg-amber-500/10 border-b border-amber-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <Inbox className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-bold text-amber-900 dark:text-amber-200 text-xs sm:text-sm flex flex-wrap items-center gap-2">
                            <span>Sách đã gửi vào Hòm trả 24/7 ({pendingDropBoxLoans.length} cuốn)</span>
                            <Badge className="bg-amber-600 text-white text-[10px] py-0 px-1.5 font-normal">
                              Đang chờ Thủ thư kiểm kê
                            </Badge>
                          </p>
                          <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                            Hệ thống đã lưu lại thời điểm bạn thả sách vào hòm. Hạn trả và phí phạt (nếu có) đã ngưng tính từ thời điểm này!
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {pendingDropBoxLoans.map(p => (
                        <div key={p.id} className="p-3 rounded-xl bg-card border border-amber-300 dark:border-amber-900/60 flex items-center gap-3 shadow-2xs">
                          {p.cover_image ? (
                            <img src={p.cover_image} alt={p.book_title} className="h-12 w-9 object-cover rounded border shrink-0" />
                          ) : (
                            <div className="h-12 w-9 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                              <BookOpen className="h-4 w-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-xs text-foreground truncate">{p.book_title}</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{p.qr_code}</p>
                            <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium mt-0.5">
                              Thả hòm lúc: {p.drop_box_at ? new Date(p.drop_box_at).toLocaleString("vi-VN") : "Đang chờ đối soát"}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300 text-[10px] shrink-0">
                            Chờ kiểm kê
                          </Badge>
                        </div>
                      ))}
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
                        • <strong>Cách 2 (Tự phục vụ):</strong> Bấm <strong>"Trả qua Hòm 24/7"</strong> ở cuốn sách tương ứng hoặc thanh công cụ để tự gửi sách vào hòm ngoài giờ.
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

                          {/* Specific note if fine is already paid */}
                          {loan.fine_already_paid && (
                            <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-[11px] flex items-center gap-1.5 font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span>Đã thanh toán phí phạt trễ hạn. Bạn vui lòng trả sách tại Quầy thủ thư hoặc thả vào Hòm trả 24/7 để hoàn tất trả sách.</span>
                            </div>
                          )}
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
                      <TableHead className="text-xs text-right">Trạng thái đối soát</TableHead>
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
                              <div className="flex flex-col text-[11px]">
                                <span className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <Inbox className="h-3 w-3" /> Hòm trả 24/7
                                </span>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {h.drop_box_at ? new Date(h.drop_box_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""} {h.drop_box_at ? new Date(h.drop_box_at).toLocaleDateString("vi-VN") : (h.return_date ? new Date(h.return_date).toLocaleDateString("vi-VN") : "")}
                                </span>
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
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[11px] font-semibold gap-1">
                                <Clock className="h-3 w-3" /> Chờ thủ thư kiểm kê
                              </Badge>
                            ) : h.drop_box_status === "damaged" ? (
                              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[11px] font-semibold">
                                Hỏng hóc (Đã lập biên bản)
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[11px] font-semibold">
                                {isDropBox ? "Hòm 24/7 (Đã nhập kho)" : "Đã hoàn trả"}
                              </Badge>
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
            /* LỊCH SỬ TẤT CẢ BIÊN LAI MƯỢN ĐIỆN TỬ */
            exitPassHistory.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Bạn chưa có biên lai mượn nào được lưu</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Biên lai mượn số hóa sẽ tự động lưu lại tại đây sau mỗi đợt nhận sách tại quầy.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold">Mã Biên Lai</TableHead>
                      <TableHead className="text-xs font-semibold">Thời Gian Mượn</TableHead>
                      <TableHead className="text-xs font-semibold text-center">Số Lượng Sách</TableHead>
                      <TableHead className="text-xs font-semibold">Hiệu Lực Ra Cổng</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Chi Tiết</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exitPassHistory.map((ep) => (
                      <TableRow key={ep.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-xs font-bold text-foreground">
                          {ep.pass_code}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(ep.created_at).toLocaleString("vi-VN")}
                        </TableCell>
                        <TableCell className="text-xs text-center font-bold text-foreground">
                          {ep.book_count || ep.items?.length || 1} cuốn
                        </TableCell>
                        <TableCell className="text-xs">
                          {ep.isValid ? (
                            <Badge className="bg-emerald-600 text-white text-[11px] font-semibold gap-1">
                              <Clock className="h-3 w-3 animate-pulse" /> Còn hiệu lực ({ep.minutesLeft}p)
                            </Badge>
                          ) : ep.displayStatus === "used" ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[11px] font-semibold gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Đã qua kiểm soát
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 text-[11px] gap-1 font-medium">
                              <CheckCircle2 className="h-3 w-3 text-slate-500" /> Hết hiệu lực ra cổng (Đã lưu trữ)
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
                            <span>Mở Biên Lai</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
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
                <AlertTriangle className="h-4 w-4" /> 3. Xử lý quá hạn & Phí phạt trễ hạn
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li>Phí phạt trễ hạn: <strong>5.000 VNĐ / cuốn / ngày quá hạn</strong>.</li>
                <li>Nếu quá hạn từ <strong>07 ngày trở lên</strong>, hệ thống sẽ tự động tạm khóa thẻ thư viện cho đến khi hoàn trả đầy đủ sách và thanh toán phí phạt.</li>
              </ul>
            </div>

            {/* Rule 4 */}
            <div className="p-3.5 rounded-xl bg-sky-500/5 border border-sky-500/20 space-y-1.5">
              <p className="font-bold text-sky-700 dark:text-sky-400 flex items-center gap-1.5 text-sm">
                <Inbox className="h-4 w-4" /> 4. Trả sách ngoài giờ (Hòm trả sách 24/7)
              </p>
              <p className="text-muted-foreground leading-relaxed pl-1">
                Khi thư viện đóng cửa, độc giả có thể sử dụng tính năng <strong>Hòm Trả Sách 24/7</strong> và thả sách vào khe hòm ngoại tuyến tại cửa thư viện. Thời điểm gửi sách sẽ được ghi nhận để ngưng tính phạt trễ hạn.
              </p>
            </div>

            {/* Rule 5 */}
            <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1.5">
              <p className="font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 text-sm">
                <ShieldAlert className="h-4 w-4" /> 5. Cổng kiểm soát an ninh & Bảo quản tài liệu
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 pl-1">
                <li>Độc giả chỉ được mang sách ra khỏi thư viện khi đã có <strong>Biên lai số (Vé ra cổng / Exit Pass)</strong> hợp lệ.</li>
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
                          {isVer && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-1.5 gap-1 text-amber-700 border-amber-300 hover:bg-amber-50 cursor-pointer"
                              onClick={() => handleUnverifyDraftItem(it.item_id || it.id, it.book_title)}
                              title="Quét lộn mã? Bấm để gỡ mã bản sao và quét lại"
                            >
                              <RotateCcw className="h-2.5 w-2.5" /> Quét lại
                            </Button>
                          )}
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

      {ConfirmDialogComponent}
    </div>
  );
}
export default ReaderBorrowView;
