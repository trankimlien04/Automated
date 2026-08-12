import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Camera, BookOpen, User, Clock, CheckCircle2, Scan, RefreshCw, Upload } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { Html5QrcodeScanner, Html5Qrcode } from "html5-qrcode";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuth } from "@/contexts/AuthContext";

interface Transaction {
  id: number;
  borrow_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  reader_name: string;
  card_number: string;
  book_title: string;
  qr_code: string;
}

export default function BorrowPage() {
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const { user } = useAuth();
  
  // Borrow form states
  const [borrowReaderCard, setBorrowReaderCard] = useState("");
  const [borrowBookQr, setBorrowBookQr] = useState("");
  
  // Return form states
  const [returnBookQr, setReturnBookQr] = useState("");

  // Scanner Dialogs
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scannerMode, setScannerMode] = useState<"borrow" | "return">("borrow");
  const [simulatedQrCode, setSimulatedQrCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const response = await api.get("/borrow/records");
      setHistory(response.data);
    } catch (error) {
      console.error("Lỗi khi tải lịch sử giao dịch:", error);
      toast.error("Không thể tải lịch sử giao dịch mượn trả");
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUserCard = async () => {
    if (user?.id) {
      try {
        const response = await api.get(`/users/${user.id}`);
        if (response.data && response.data.card_number) {
          setBorrowReaderCard(response.data.card_number);
        }
      } catch (error) {
        console.error("Lỗi khi tải thông tin thẻ:", error);
      }
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchCurrentUserCard();
  }, [user]);

  const processScannedText = (decodedText: string) => {
    if (scannerMode === "borrow") {
      if (decodedText.startsWith("LIB-RD-") || decodedText.startsWith("LIB-LB-") || decodedText.startsWith("LIB-AD-")) {
        setBorrowReaderCard(decodedText);
        toast.success(`Đã quét mã thẻ độc giả: ${decodedText}`);
      } else if (decodedText.startsWith("QR-BK-") || decodedText.startsWith("LIB-BK-")) {
        setBorrowBookQr(decodedText);
        toast.success(`Đã quét mã sách: ${decodedText}`);
      } else {
        // Fallback thông minh: nếu ô độc giả trống thì điền, nếu không thì điền ô sách
        if (!borrowReaderCard) {
          setBorrowReaderCard(decodedText);
          toast.success(`Đã nạp mã vào ô Số thẻ: ${decodedText}`);
        } else {
          setBorrowBookQr(decodedText);
          toast.success(`Đã nạp mã vào ô Mã Sách: ${decodedText}`);
        }
      }
    } else {
      setReturnBookQr(decodedText);
      toast.success(`Đã quét mã sách cần trả: ${decodedText}`);
    }
    setIsScannerOpen(false);
  };

  // HTML5 Camera Scanner setup
  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (isScannerOpen && isCameraActive) {
      setTimeout(() => {
        scanner = new Html5QrcodeScanner(
          "qr-reader-viewport",
          { fps: 10, qrbox: { width: 220, height: 220 } },
          false
        );

        scanner.render(
          (decodedText) => {
            processScannedText(decodedText);
            scanner?.clear();
            setIsCameraActive(false);
          },
          (error) => {
            // Ignore scan attempt errors
          }
        );
      }, 300);
    }

    return () => {
      if (scanner) {
        scanner.clear().catch(console.error);
      }
    };
  }, [isScannerOpen, isCameraActive, scannerMode, borrowReaderCard]);

  const handleBorrowSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!borrowReaderCard.trim() || !borrowBookQr.trim()) {
      toast.error("Vui lòng điền đầy đủ mã độc giả và mã sách");
      return;
    }

    confirm({
      title: "Xác nhận mượn sách",
      description: `Bạn có đồng ý chấp nhận thực hiện giao dịch mượn sách này không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const response = await api.post("/borrow/borrow", {
            readerCardNumber: borrowReaderCard,
            bookQrCode: borrowBookQr
          });

          toast.success(response.data.message || "Mượn sách thành công!");
          setBorrowBookQr("");
          fetchHistory();
        } catch (error: any) {
          console.error("Lỗi khi mượn sách:", error);
          toast.error(error.response?.data?.message || "Không thể thực hiện mượn sách");
        }
      }
    });
  };

  const handleReturnSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!returnBookQr.trim()) {
      toast.error("Vui lòng điền hoặc quét mã QR sách cần trả");
      return;
    }

    confirm({
      title: "Xác nhận trả sách",
      description: `Bạn có đồng ý chấp nhận thực hiện giao dịch trả sách này không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const response = await api.post("/borrow/return", {
            bookQrCode: returnBookQr
          });

          const { overdueDays, fineAmount } = response.data.data;
          if (fineAmount > 0) {
            toast.warning(`Sách trả trễ hạn ${overdueDays} ngày! Phí phạt phát sinh: ${fineAmount.toLocaleString('vi-VN')}đ`);
          } else {
            toast.success("Trả sách thành công!");
          }
          
          setReturnBookQr("");
          fetchHistory();
        } catch (error: any) {
          console.error("Lỗi khi trả sách:", error);
          toast.error(error.response?.data?.message || "Không thể thực hiện trả sách");
        }
      }
    });
  };

  const handleRenew = (id: number) => {
    confirm({
      title: "Xác nhận gia hạn sách",
      description: `Bạn có đồng ý chấp nhận gia hạn thêm thời gian mượn cho phiếu này không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const response = await api.post("/borrow/renew", { borrowRecordId: id });
          toast.success(response.data.message || "Gia hạn mượn sách thành công!");
          fetchHistory();
        } catch (error: any) {
          console.error("Lỗi khi gia hạn:", error);
          toast.error(error.response?.data?.message || "Không thể gia hạn phiếu mượn này");
        }
      }
    });
  };

  const openScannerModal = (mode: "borrow" | "return") => {
    setScannerMode(mode);
    setSimulatedQrCode("");
    setIsCameraActive(false);
    setIsScannerOpen(true);
  };

  const handleSimulatedScan = () => {
    if (!simulatedQrCode.trim()) {
      toast.error("Vui lòng nhập mã quét giả lập");
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
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Compute metrics for the session
  const totalBorrowedToday = history.filter(h => h.status === 'borrowing').length;
  const totalReturnedToday = history.filter(h => h.status === 'returned').length;
  
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2 overflow-hidden">
        <CardHeader>
          <CardTitle className="font-display">Quét mã QR Thao tác</CardTitle>
          <p className="text-xs text-muted-foreground">Sử dụng Camera mượn/trả sách hoặc mã QR trên thẻ độc giả</p>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="borrow">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="borrow">Mượn sách</TabsTrigger>
              <TabsTrigger value="return">Trả sách</TabsTrigger>
            </TabsList>
            
            <TabsContent value="borrow" className="mt-4 space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-background to-terracotta/5 grid place-items-center">
                <div className="absolute inset-8 rounded-lg border-2 border-primary/40" />
                <div className="absolute left-1/2 top-1/2 h-1 w-3/4 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
                <div className="flex flex-col items-center gap-3 text-center z-10">
                  <div className="h-16 w-16 rounded-full bg-primary/10 grid place-items-center">
                    <Camera className="h-8 w-8 text-primary animate-pulse" />
                  </div>
                  <p className="font-display text-lg">Hệ thống Camera QR Athenaeum</p>
                  <p className="max-w-xs text-xs text-muted-foreground">Hỗ trợ quét qua WebCam thực tế hoặc nhập giả lập</p>
                  <Button onClick={() => openScannerModal("borrow")} className="gap-2 mt-2">
                    <Scan className="h-4 w-4" /> Bật Camera / Quét QR
                  </Button>
                </div>
              </div>

              <form onSubmit={handleBorrowSubmit} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Mã độc giả (Số thẻ)</label>
                    <Input 
                      placeholder="VD: LIB-RD-123456" 
                      value={borrowReaderCard} 
                      onChange={(e) => setBorrowReaderCard(e.target.value)} 
                      required 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Mã QR Sách</label>
                    <Input 
                      placeholder="VD: QR-BOOK-101" 
                      value={borrowBookQr} 
                      onChange={(e) => setBorrowBookQr(e.target.value)} 
                      required 
                    />
                  </div>
                </div>
                <Button type="submit" size="lg" className="w-full gap-2 mt-2">
                  <CheckCircle2 className="h-4 w-4" /> Xác nhận mượn sách
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="return" className="mt-4 space-y-4">
              <div className="rounded-xl border bg-muted/30 p-8 text-center flex flex-col items-center">
                <BookOpen className="h-10 w-10 text-primary animate-bounce" />
                <p className="mt-3 font-display text-lg">Trả sách tự động qua QR</p>
                <p className="mt-1 text-xs text-muted-foreground">Quét mã QR in trên sách để hoàn thành thủ tục trả nhanh</p>
                <Button onClick={() => openScannerModal("return")} className="mt-4 gap-2">
                  <Scan className="h-4 w-4" /> Bật Camera / Quét QR Trả sách
                </Button>
              </div>

              <form onSubmit={handleReturnSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Mã QR Sách Trả</label>
                  <Input 
                    placeholder="Nhập mã QR sách cần trả..." 
                    value={returnBookQr} 
                    onChange={(e) => setReturnBookQr(e.target.value)} 
                    required 
                  />
                </div>
                <Button type="submit" size="lg" className="w-full gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Xác nhận trả sách
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Phiên làm việc</CardTitle>
          <p className="text-xs text-muted-foreground">Hôm nay · Quầy Thư Viện</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-primary/10 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-primary">{totalBorrowedToday}</p>
              <p className="text-[10px] uppercase text-muted-foreground">Đang mượn</p>
            </div>
            <div className="rounded-md bg-success/10 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-success">{totalReturnedToday}</p>
              <p className="text-[10px] uppercase text-muted-foreground">Đã trả</p>
            </div>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Giao dịch gần đây</p>
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {loading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Đang tải...</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Chưa có giao dịch nào hôm nay</p>
              ) : (
                history.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
                    <div className="flex items-start gap-2 min-w-0">
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${t.status === "borrowing" ? "bg-primary animate-ping" : "bg-success"}`} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-xs">{t.book_title}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          <User className="inline h-3 w-3 mr-1" />
                          {t.reader_name} ({t.card_number})
                        </p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          Hạn trả: {new Date(t.due_date).toLocaleDateString("vi-VN")}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className="text-[9px]">
                        <Clock className="mr-1 h-2.5 w-2.5" />
                        {t.status === "borrowing" ? "Đang mượn" : "Đã trả"}
                      </Badge>
                      {t.status === "borrowing" && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-6 text-[10px] px-2 text-primary hover:bg-primary/10"
                          onClick={() => handleRenew(t.id)}
                        >
                          <RefreshCw className="h-2.5 w-2.5 mr-1" /> Gia hạn
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scanner & Camera Dialog */}
      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Quét mã QR Code</DialogTitle>
            <DialogDescription>
              Chọn quét trực tiếp bằng WebCam thiết bị hoặc nhập mã nhanh bên dưới.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!isCameraActive ? (
              <div className="flex flex-col gap-3">
                <Button onClick={() => setIsCameraActive(true)} className="w-full gap-2">
                  <Camera className="h-4 w-4" /> Mở WebCam Camera
                </Button>
                
                <div className="relative text-center text-xs text-muted-foreground my-1">
                  <span className="bg-background px-2">Hoặc tải ảnh chứa mã QR</span>
                </div>
                <Button variant="outline" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Chọn ảnh mã QR
                </Button>
                <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleFileUpload} />

                <div className="relative text-center text-xs text-muted-foreground my-1">
                  <span className="bg-background px-2">Hoặc nhập mã tay</span>
                </div>
                <Input 
                  placeholder="VD: QR-1716104273892 hoặc mã QR sách" 
                  value={simulatedQrCode} 
                  onChange={(e) => setSimulatedQrCode(e.target.value)} 
                />
                <Button onClick={handleSimulatedScan} variant="secondary" className="w-full">Xác nhận nạp mã</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div id="qr-reader-viewport" className="w-full overflow-hidden rounded-lg border bg-black"></div>
                <Button onClick={() => setIsCameraActive(false)} variant="outline" className="w-full">Tắt Camera</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <div id="hidden-qr-reader" className="hidden"></div>
      {ConfirmDialogComponent}
    </div>
  );
}
