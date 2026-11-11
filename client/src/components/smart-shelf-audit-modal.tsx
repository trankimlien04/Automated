import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QrCode,
  Camera,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  RotateCcw,
  Sparkles,
  MapPin,
  BookOpen,
  Scan,
  Compass,
  Check,
  X,
  Layers,
} from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { Html5Qrcode } from "html5-qrcode";
import { pad2, loadLibraryLayoutConfig } from "@/components/library-mini-map-modal";

export interface ShelfAuditCopyItem {
  copy_id: number;
  qr_code: string;
  copy_status: string;
  book_id: number;
  book_title: string;
  isbn?: string;
  cover_image?: string;
  author_name?: string;
  category_name?: string;
  expected_location?: string;
  actual_location?: string;
  scanned_at_location?: string;
  scanned_timestamp?: string;
  borrower_name?: string | null;
  borrower_card_number?: string | null;
  active_draft_code?: string | null;
  draft_reader_name?: string | null;
  expected_on_shelf?: boolean;
  audit_group?: "correct" | "misplaced";
  instruction?: string;
}

interface SmartShelfAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLocation?: string;
  onOpenMiniMap?: (target: { location?: string; title?: string; cover?: string; author?: string }) => void;
}

function parseLocationParts(raw?: string) {
  const str = String(raw || "Phòng 01 - Kệ 01 - Ngăn 01");
  const rMatch = str.match(/Ph[oò]ng\s*(\d+)/i);
  const sMatch = str.match(/K[eệ]\s*(\d+)/i);
  const kMatch = str.match(/Ng[aă]n\s*(\d+)/i);
  const r = rMatch ? Math.max(1, parseInt(rMatch[1], 10) || 1) : 1;
  const s = sMatch ? Math.max(1, parseInt(sMatch[1], 10) || 1) : 1;
  const k = kMatch ? Math.max(1, parseInt(kMatch[1], 10) || 1) : 1;
  return {
    room: `Phòng ${pad2(r)}`,
    shelf: `Kệ ${pad2(s)}`,
    rack: `Ngăn ${pad2(k)}`,
    roomNum: r,
    shelfNum: s,
    rackNum: k,
  };
}

export function SmartShelfAuditModal({
  open,
  onOpenChange,
  initialLocation = "Phòng 01 - Kệ 01 - Ngăn 01",
  onOpenMiniMap,
}: SmartShelfAuditModalProps) {
  const initParts = parseLocationParts(initialLocation);
  const [selectedRoom, setSelectedRoom] = useState(initParts.room);
  const [selectedShelf, setSelectedShelf] = useState(initParts.shelf);
  const [selectedRack, setSelectedRack] = useState(initParts.rack);

  const [loadingLocation, setLoadingLocation] = useState(false);
  const [expectedOnShelfCopies, setExpectedOnShelfCopies] = useState<ShelfAuditCopyItem[]>([]);
  const [borrowedOrLockedCopies, setBorrowedOrLockedCopies] = useState<ShelfAuditCopyItem[]>([]);
  const [shelfCopyCounts, setShelfCopyCounts] = useState<Record<string, number>>({});
  const [rackCopyCounts, setRackCopyCounts] = useState<Record<string, number>>({});

  // Scanned items during this audit session
  const [scannedCorrectMap, setScannedCorrectMap] = useState<Record<string, ShelfAuditCopyItem>>({});
  const [scannedMisplacedList, setScannedMisplacedList] = useState<ShelfAuditCopyItem[]>([]);
  const [lastScannedBanner, setLastScannedBanner] = useState<{
    group: "correct" | "misplaced";
    item: ShelfAuditCopyItem;
  } | null>(null);

  const [qrInput, setQrInput] = useState("");
  const [scanningSubmit, setScanningSubmit] = useState(false);
  const [activeTab, setActiveTab] = useState<"missing" | "correct" | "misplaced">("missing");

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const lastCameraScanRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const targetLocation = `${selectedRoom} - ${selectedShelf} - ${selectedRack}`;

  // Layout options based on LibraryLayoutConfig
  const layoutConfig = useMemo(() => loadLibraryLayoutConfig(), [open]);
  const roomOptions = useMemo(() => {
    const count = Math.max(3, layoutConfig.maxRoom || 3);
    return Array.from({ length: count }, (_, i) => `Phòng ${pad2(i + 1)}`);
  }, [layoutConfig]);

  const shelfOptions = useMemo(() => {
    const rNum = parseInt(selectedRoom.replace(/\D/g, ""), 10) || 1;
    const count = Math.max(6, layoutConfig.shelvesPerRoom?.[rNum] || 6);
    return Array.from({ length: count }, (_, i) => `Kệ ${pad2(i + 1)}`);
  }, [layoutConfig, selectedRoom]);

  const rackOptions = useMemo(() => {
    const rNum = parseInt(selectedRoom.replace(/\D/g, ""), 10) || 1;
    const sNum = parseInt(selectedShelf.replace(/\D/g, ""), 10) || 1;
    const count = Math.max(5, layoutConfig.racksPerShelf?.[`${rNum}-${sNum}`] || 5);
    return Array.from({ length: count }, (_, i) => `Ngăn ${pad2(i + 1)}`);
  }, [layoutConfig, selectedRoom, selectedShelf]);

  // Sync initialLocation when modal opens
  useEffect(() => {
    if (open && initialLocation) {
      const parts = parseLocationParts(initialLocation);
      setSelectedRoom(parts.room);
      setSelectedShelf(parts.shelf);
      setSelectedRack(parts.rack);
    }
  }, [open, initialLocation]);

  // Fetch expected copies whenever targetLocation changes while modal is open
  const fetchShelfAuditLocation = async (locStr: string) => {
    setLoadingLocation(true);
    try {
      const res = await api.get("/books/shelf-audit/location", {
        params: { location: locStr },
      });
      setExpectedOnShelfCopies(res.data.expectedOnShelfCopies || []);
      setBorrowedOrLockedCopies(res.data.borrowedOrLockedCopies || []);
      setShelfCopyCounts(res.data.shelfCopyCounts || {});
      setRackCopyCounts(res.data.rackCopyCounts || {});
      // Reset session scans when switching rack
      setScannedCorrectMap({});
      setScannedMisplacedList([]);
      setLastScannedBanner(null);
      setActiveTab("missing");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể tải danh sách bản sao của ngăn kệ này");
    } finally {
      setLoadingLocation(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  useEffect(() => {
    if (open) {
      fetchShelfAuditLocation(targetLocation);
    } else {
      stopCameraScanner();
    }
  }, [open, targetLocation]);

  // Stop camera helper
  const stopCameraScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch {
        // ignore
      }
      html5QrCodeRef.current = null;
    }
    setCameraActive(false);
  };

  const toggleCameraScanner = async () => {
    if (cameraActive) {
      await stopCameraScanner();
      return;
    }
    setCameraActive(true);
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode("shelf-audit-camera-reader");
        html5QrCodeRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 150 } },
          (decodedText) => {
            const clean = decodedText.trim();
            const now = Date.now();
            if (
              clean &&
              (lastCameraScanRef.current.code !== clean || now - lastCameraScanRef.current.time > 2000)
            ) {
              lastCameraScanRef.current = { code: clean, time: now };
              handleScanCode(clean);
            }
          },
          () => {}
        );
      } catch (err) {
        console.error("Không thể bật camera:", err);
        toast.error("Không thể khởi động Camera. Bạn vẫn có thể dùng Súng bắn mã vạch hoặc nhập mã QR.");
        setCameraActive(false);
      }
    }, 150);
  };

  // Process a scanned QR code
  const handleScanCode = async (rawCode?: string) => {
    const codeToScan = (rawCode ?? qrInput).trim();
    if (!codeToScan) return;

    setScanningSubmit(true);
    try {
      const res = await api.post("/books/shelf-audit/scan", {
        qrCode: codeToScan,
        targetLocation,
      });

      const { auditGroup, item, message } = res.data;
      const key = String(item.qr_code).toUpperCase();

      if (auditGroup === "correct") {
        setScannedCorrectMap((prev) => ({
          ...prev,
          [key]: item,
        }));
        setLastScannedBanner({ group: "correct", item });
        toast.success(`✅ Đúng vị trí: "${item.book_title}" (${item.qr_code})`);
      } else {
        setScannedMisplacedList((prev) => {
          const exists = prev.some((x) => String(x.qr_code).toUpperCase() === key);
          if (exists) return prev;
          return [item, ...prev];
        });
        setLastScannedBanner({ group: "misplaced", item });
        setActiveTab("misplaced"); // Automatically switch to misplaced tab so librarian can see immediately
        toast.warning(message || `⚠️ Phát hiện sách để nhầm kệ: "${item.book_title}"`);
      }

      if (!rawCode) {
        setQrInput("");
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Không tìm thấy mã QR [${codeToScan}]`);
    } finally {
      setScanningSubmit(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Computed lists
  const correctPlacedList = useMemo(() => {
    return Object.values(scannedCorrectMap);
  }, [scannedCorrectMap]);

  const missingBooksList = useMemo(() => {
    return expectedOnShelfCopies.filter(
      (copy) => !scannedCorrectMap[String(copy.qr_code).toUpperCase()]
    );
  }, [expectedOnShelfCopies, scannedCorrectMap]);

  const handleResetAuditSession = () => {
    setScannedCorrectMap({});
    setScannedMisplacedList([]);
    setLastScannedBanner(null);
    setActiveTab("missing");
    toast.info(`Đã làm mới phiên kiểm kê tại [${targetLocation}]`);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleMarkMisplacedResolved = (qrCode: string, actualLocation?: string) => {
    const cleanTarget = String(qrCode || "").trim().toUpperCase();
    setScannedMisplacedList((prev) =>
      prev.filter((item) => String(item.qr_code || "").trim().toUpperCase() !== cleanTarget)
    );
    setLastScannedBanner((prev) =>
      prev && String(prev.item.qr_code || "").trim().toUpperCase() === cleanTarget ? null : prev
    );
    toast.success(`Đã xác nhận thu hồi bản sao [${qrCode}] để mang về [${actualLocation || "kệ gốc"}]!`);
  };

  const auditProgressPercent =
    expectedOnShelfCopies.length > 0
      ? Math.min(100, Math.round((correctPlacedList.length / expectedOnShelfCopies.length) * 100))
      : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px] w-[96vw] max-h-[90vh] flex flex-col p-0 gap-0 rounded-2xl border shadow-2xl overflow-hidden bg-background">
        {/* Clean Modern Header */}
        <DialogHeader className="px-5 py-3.5 border-b bg-card/60 shrink-0">
          <div className="flex items-center justify-between pr-6">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-600 text-white shrink-0 shadow-xs">
                <Scan className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="font-display text-base font-bold text-foreground flex items-center gap-2">
                  Kiểm Kê Kệ Sách Bằng Mã QR
                  <Badge variant="outline" className="text-[11px] font-mono border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                    📍 {targetLocation}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Quét liên tiếp mã QR các cuốn sách trên ngăn để đối chiếu đúng vị trí, nhầm kệ hoặc thất lạc.
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
          {/* Integrated Control Panel (Location Selector + QR Input in one clean card) */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-3 shadow-2xs">
            {/* Row 1: Location picker */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5 text-primary" /> Vị trí kiểm kê:
                </span>
                <Select value={selectedRoom} onValueChange={setSelectedRoom}>
                  <SelectTrigger className="h-8 text-xs font-semibold bg-background w-[110px]">
                    <SelectValue placeholder="Phòng" />
                  </SelectTrigger>
                  <SelectContent>
                    {roomOptions.map((rm) => (
                      <SelectItem key={rm} value={rm} className="text-xs font-medium">
                        🏢 {rm}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedShelf} onValueChange={setSelectedShelf}>
                  <SelectTrigger className="h-8 text-xs font-semibold bg-background min-w-[105px]">
                    <SelectValue placeholder="Kệ" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelfOptions.map((sh) => {
                      const count = shelfCopyCounts[sh];
                      return (
                        <SelectItem key={sh} value={sh} className="text-xs font-medium">
                          📚 {sh} {count !== undefined ? (count > 0 ? `(${count} cuốn)` : "• Trống") : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                <Select value={selectedRack} onValueChange={setSelectedRack}>
                  <SelectTrigger className="h-8 text-xs font-semibold bg-background min-w-[105px]">
                    <SelectValue placeholder="Ngăn" />
                  </SelectTrigger>
                  <SelectContent>
                    {rackOptions.map((rk) => {
                      const count = rackCopyCounts[rk];
                      return (
                        <SelectItem key={rk} value={rk} className="text-xs font-medium">
                          🗂️ {rk} {count !== undefined ? (count > 0 ? `(${count} cuốn)` : "• Trống") : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Tổng: <strong className="text-foreground">{expectedOnShelfCopies.length}</strong> cuốn trên kệ
                  {borrowedOrLockedCopies.length > 0 && (
                    <span className="text-muted-foreground/80"> (+{borrowedOrLockedCopies.length} đang mượn)</span>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetAuditSession}
                  className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground gap-1"
                  title="Xoá lượt quét để kiểm kê lại từ đầu"
                >
                  <RotateCcw className="h-3 w-3" /> Làm mới
                </Button>
              </div>
            </div>

            {/* Row 2: Big Scan Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleScanCode();
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Scan className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-600" />
                <Input
                  ref={inputRef}
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder="Bắn mã vạch / Nhập mã QR sách (VD: QR-BK-1-1) rồi nhấn Enter..."
                  className="pl-9 h-10 text-xs font-mono bg-background border-emerald-500/40 focus-visible:ring-emerald-500"
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={scanningSubmit || !qrInput.trim()}
                className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold gap-1.5 shrink-0"
              >
                <Check className="h-3.5 w-3.5" /> Quét Kiểm Kê
              </Button>

              <Button
                type="button"
                size="sm"
                variant={cameraActive ? "destructive" : "outline"}
                onClick={toggleCameraScanner}
                className="h-10 text-xs gap-1.5 px-3 shrink-0"
              >
                <Camera className="h-3.5 w-3.5" />
                {cameraActive ? "Tắt Camera" : "Camera"}
              </Button>
            </form>
          </div>

          {/* Camera View if active */}
          {cameraActive && (
            <div className="rounded-xl border border-emerald-500/40 bg-black/95 p-3 text-center space-y-2">
              <div id="shelf-audit-camera-reader" className="mx-auto max-w-[320px] overflow-hidden rounded-lg" />
              <p className="text-[11px] text-emerald-300 font-medium">
                📷 Hướng camera vào mã QR trên gáy sách — Hệ thống tự nhận diện liên tiếp.
              </p>
            </div>
          )}

          {/* Dynamic Feedback Banner (Only shows immediately when an item was scanned) */}
          {lastScannedBanner && (
            <div
              className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                lastScannedBanner.group === "correct"
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-amber-500/50 bg-amber-500/15"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`p-2 rounded-lg text-white shrink-0 ${
                    lastScannedBanner.group === "correct" ? "bg-emerald-600" : "bg-amber-600"
                  }`}
                >
                  {lastScannedBanner.group === "correct" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      className={`text-[10px] font-bold ${
                        lastScannedBanner.group === "correct"
                          ? "bg-emerald-600 text-white"
                          : "bg-amber-600 text-white"
                      }`}
                    >
                      {lastScannedBanner.group === "correct"
                        ? "✅ VỪA QUÉT: ĐÚNG VỊ TRÍ"
                        : "⚠️ PHÁT HIỆN SÁCH ĐỂ NHẦM KỆ!"}
                    </Badge>
                    <code className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-background border">
                      {lastScannedBanner.item.qr_code}
                    </code>
                    <span className="font-semibold text-xs text-foreground truncate">
                      {lastScannedBanner.item.book_title}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 text-foreground/80">
                    {lastScannedBanner.group === "correct" ? (
                      <span>Đã xác nhận có mặt tại <strong>{targetLocation}</strong>.</span>
                    ) : (
                      <span className="text-amber-950 dark:text-amber-200">
                        Sách này thuộc <strong>{lastScannedBanner.item.actual_location}</strong> bị để nhầm sang đây ➔{" "}
                        <strong className="underline">Hãy nhặt ra mang về đúng chỗ!</strong>
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                {lastScannedBanner.group === "misplaced" && (
                  <>
                    {onOpenMiniMap && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          onOpenMiniMap({
                            location: lastScannedBanner.item.actual_location,
                            title: lastScannedBanner.item.book_title,
                            cover: lastScannedBanner.item.cover_image,
                          })
                        }
                        className="h-7 text-xs gap-1 border-amber-600 text-amber-900 bg-background hover:bg-amber-50 font-semibold"
                      >
                        <Compass className="h-3 w-3 text-amber-600" /> Sơ đồ kệ gốc
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        handleMarkMisplacedResolved(
                          lastScannedBanner.item.qr_code,
                          lastScannedBanner.item.actual_location
                        )
                      }
                      className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                    >
                      <Check className="h-3 w-3" /> Đã nhặt mang về
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLastScannedBanner(null)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground rounded-full"
                  title="Đóng thông báo này"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Progress Bar or Empty Shelf State */}
          <div className="rounded-xl border bg-card p-3 space-y-1.5 shadow-2xs">
            {expectedOnShelfCopies.length === 0 ? (
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500"></span>
                  Trạng thái: <strong>Ngăn kệ này đang trống (0 cuốn sách)</strong>
                </span>
                <span className="text-[11px] text-muted-foreground">Kệ dự phòng trống</span>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  Tiến độ kiểm kê ngăn:{" "}
                  <strong className="text-foreground">
                    {correctPlacedList.length} / {expectedOnShelfCopies.length} cuốn
                  </strong>
                </span>
                <span className="font-bold font-mono text-emerald-600">{auditProgressPercent}%</span>
              </div>
            )}
            <Progress value={expectedOnShelfCopies.length === 0 ? 0 : auditProgressPercent} className="h-2 bg-muted" />
          </div>

          {/* Clean Segmented Tabs (3 distinct groups without cluttering the screen) */}
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
            <TabsList className="grid grid-cols-3 bg-muted/60 p-1 rounded-xl h-10">
              <TabsTrigger
                value="missing"
                className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                Cần quét / Chưa thấy ({missingBooksList.length})
              </TabsTrigger>
              <TabsTrigger
                value="correct"
                className="text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Đúng vị trí ({correctPlacedList.length})
              </TabsTrigger>
              <TabsTrigger
                value="misplaced"
                className={`text-xs font-semibold gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs ${
                  scannedMisplacedList.length > 0 ? "text-amber-700 dark:text-amber-400 font-bold" : ""
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Để nhầm kệ ({scannedMisplacedList.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB CONTENT 1: CẦN QUÉT / CHƯA THẤY */}
            {activeTab === "missing" && (
              <div className="mt-3 rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Danh sách sách phần mềm báo đang có ở ngăn này:</span>
                  <span className="font-medium">
                    {expectedOnShelfCopies.length === 0 ? "Ngăn kệ trống" : `Còn ${missingBooksList.length} cuốn chưa quét`}
                  </span>
                </div>
                <div className="p-2 divide-y max-h-72 overflow-y-auto">
                  {loadingLocation ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">Đang tải dữ liệu ngăn kệ...</div>
                  ) : expectedOnShelfCopies.length === 0 ? (
                    <div className="py-8 text-center space-y-2">
                      <div className="p-3 bg-muted rounded-full w-12 h-12 flex items-center justify-center mx-auto text-muted-foreground">
                        <Layers className="h-6 w-6 text-muted-foreground/70" />
                      </div>
                      <p className="text-xs font-bold text-foreground">
                        Ngăn kệ này hiện chưa được xếp sách (Kệ trống / 0 cuốn)
                      </p>
                      <p className="text-[11px] text-muted-foreground max-w-md mx-auto leading-relaxed">
                        Trong hệ thống thư viện, các đầu sách tại {selectedRoom} đang được xếp tập trung ở các kệ như:{" "}
                        <strong className="text-foreground">
                          {Object.entries(shelfCopyCounts)
                            .filter(([_, cnt]) => cnt > 0)
                            .map(([s, cnt]) => `${s} (${cnt} cuốn)`)
                            .join(", ") || "Kệ 01, Kệ 03, Kệ 05"}
                        </strong>.
                        <br />
                        Kệ {selectedShelf} hiện là kệ dự phòng trống để dành xếp sách mới.
                      </p>
                    </div>
                  ) : missingBooksList.length === 0 ? (
                    <div className="py-8 text-center space-y-1">
                      <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
                      <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Đã quét đầy đủ 100% sách trên ngăn kệ này!
                      </p>
                      <p className="text-[11px] text-muted-foreground">Không còn cuốn sách nào bị sót hoặc thất lạc.</p>
                    </div>
                  ) : (
                    missingBooksList.map((copy) => (
                      <div key={copy.qr_code} className="py-2.5 px-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition rounded-lg">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-6 w-6 rounded-full bg-rose-500/10 text-rose-600 text-xs font-bold flex items-center justify-center shrink-0">
                            !
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{copy.book_title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <code className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.2 rounded font-semibold">
                                {copy.qr_code}
                              </code>
                              <span className="text-[11px] text-muted-foreground truncate">• {copy.author_name}</span>
                            </div>
                          </div>
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleScanCode(copy.qr_code)}
                          className="h-7 text-[11px] px-2 text-emerald-700 hover:bg-emerald-50 shrink-0 gap-1"
                        >
                          <QrCode className="h-3 w-3" /> Xác nhận có
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: ĐÃ QUÉT ĐÚNG VỊ TRÍ */}
            {activeTab === "correct" && (
              <div className="mt-3 rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b bg-emerald-500/5 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
                  <span>Các cuốn sách đã quét và khớp đúng ngăn kệ:</span>
                  <span className="font-semibold">{correctPlacedList.length} cuốn đã có mặt</span>
                </div>
                <div className="p-2 divide-y max-h-72 overflow-y-auto">
                  {correctPlacedList.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Chưa có cuốn sách nào được quét xác nhận có mặt tại ngăn này.
                    </div>
                  ) : (
                    correctPlacedList.map((item) => (
                      <div key={item.qr_code} className="py-2.5 px-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition rounded-lg">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-6 w-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                            ✓
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{item.book_title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <code className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-1.5 py-0.2 rounded font-semibold">
                                {item.qr_code}
                              </code>
                              <span className="text-[11px] text-muted-foreground truncate">• {item.author_name}</span>
                            </div>
                          </div>
                        </div>

                        <Badge className="bg-emerald-600 text-white text-[10px] shrink-0 font-medium">
                          Có mặt trên kệ
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: SÁCH ĐỂ NHẦM KỆ */}
            {activeTab === "misplaced" && (
              <div className="mt-3 rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b bg-amber-500/10 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
                  <span>Sách thuộc kệ khác bị để nhầm sang ngăn này:</span>
                  <span className="font-semibold">{scannedMisplacedList.length} cuốn cần mang về</span>
                </div>
                <div className="p-2 divide-y max-h-72 overflow-y-auto">
                  {scannedMisplacedList.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Không có cuốn sách nào bị để nhầm tại ngăn này.
                    </div>
                  ) : (
                    scannedMisplacedList.map((item) => (
                      <div key={item.qr_code} className="py-3 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-amber-500/[0.04] rounded-lg">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-foreground">{item.book_title}</span>
                            <code className="text-[10px] font-mono bg-amber-500/20 text-amber-900 dark:text-amber-200 px-1.5 py-0.2 rounded font-bold">
                              {item.qr_code}
                            </code>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="text-muted-foreground">Nhầm tại đây</span>
                            <ArrowRight className="h-3 w-3 text-amber-600" />
                            <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold">
                              📍 Mang về: {item.actual_location}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {onOpenMiniMap && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                onOpenMiniMap({
                                  location: item.actual_location,
                                  title: item.book_title,
                                  cover: item.cover_image,
                                })
                              }
                              className="h-7 text-[11px] gap-1 border-primary/30 text-primary"
                            >
                              <Compass className="h-3 w-3" /> Bản đồ
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleMarkMisplacedResolved(item.qr_code, item.actual_location)}
                            className="h-7 text-[11px] gap-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                          >
                            <Check className="h-3 w-3" /> Đã nhặt mang về
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </Tabs>
        </div>

        {/* Clean Footer */}
        <DialogFooter className="px-5 py-3 border-t bg-muted/20 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
            <span>
              Tổng kết: <strong className="text-emerald-600">{correctPlacedList.length}</strong> đúng vị trí •{" "}
              <strong className="text-amber-600">{scannedMisplacedList.length}</strong> nhầm kệ •{" "}
              <strong className="text-rose-600">{missingBooksList.length}</strong> chưa thấy
            </span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs h-8"
          >
            Đóng cửa sổ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

