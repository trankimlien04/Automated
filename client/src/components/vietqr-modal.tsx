import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCode, Banknote, Copy, Check, ShieldCheck, AlertCircle, RefreshCw, Building } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";

export interface BankConfig {
  bank_code: string;
  bank_name: string;
  bank_account_no: string;
  bank_account_name: string;
}

const DEFAULT_BANK: BankConfig = {
  bank_code: "TPB",
  bank_name: "TPBank (Ngân hàng Tiên Phong)",
  bank_account_no: "00000307092",
  bank_account_name: "THU VIEN ATHENAEUM"
};

interface VietQrModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: number;
  readerName?: string;
  cardNumber?: string;
  bookTitle?: string;
  bookCopyQr?: string;
  overdueDays?: number;
  transferNote: string;
  allowCashOption?: boolean;
  onConfirmPayment: (method: "transfer" | "cash") => Promise<void> | void;
  isSubmitting?: boolean;
}

export function VietQrModal({
  open,
  onOpenChange,
  amount,
  readerName,
  cardNumber,
  bookTitle,
  bookCopyQr,
  overdueDays,
  transferNote,
  allowCashOption = false,
  onConfirmPayment,
  isSubmitting = false
}: VietQrModalProps) {
  const [bankConfig, setBankConfig] = useState<BankConfig>(DEFAULT_BANK);
  const [activeTab, setActiveTab] = useState<"transfer" | "cash">("transfer");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    if (open) {
      api.get("/fines/bank-config")
        .then((res) => {
          if (res.data && res.data.bank_account_no) {
            setBankConfig(res.data);
          }
        })
        .catch(() => {
          // Use default fallback
        });
      setImgLoaded(false);
    }
  }, [open]);

  // Clean note for VietQR (alphanumeric and spaces without special accents)
  const cleanNote = transferNote.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim().slice(0, 50);

  // Dynamic VietQR generator URL (Standard VietQR format)
  const qrUrl = `https://img.vietqr.io/image/${bankConfig.bank_code}-${bankConfig.bank_account_no}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(cleanNote)}&accountName=${encodeURIComponent(bankConfig.bank_account_name)}`;

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`Đã sao chép ${fieldName}!`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg p-0 overflow-hidden border shadow-2xl">
        <DialogHeader className="p-5 pb-3 bg-gradient-to-r from-primary/10 via-primary/5 to-background border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-display flex items-center gap-2 text-primary">
              <QrCode className="h-5 w-5 text-primary" />
              Thanh Toán Phí Phạt Thư Viện
            </DialogTitle>
            <Badge variant="outline" className="border-primary/30 text-primary bg-primary/10 font-mono text-xs">
              {amount.toLocaleString("vi-VN")} đ
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {allowCashOption 
              ? "Lựa chọn phương thức thanh toán chuyển khoản VietQR tự động hoặc thu tiền mặt tại quầy." 
              : "Quét mã VietQR bằng ứng dụng ngân hàng hoặc ví điện tử bất kỳ để thanh toán nhanh."}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 pt-3 space-y-4">
          {/* Thông tin khoản phạt */}
          <div className="p-3 bg-muted/40 rounded-xl border text-xs space-y-1">
            {readerName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Độc giả:</span>
                <span className="font-semibold text-foreground">{readerName} {cardNumber ? `(${cardNumber})` : ""}</span>
              </div>
            )}
            {bookTitle && (
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground shrink-0">Sách trễ hạn:</span>
                <span className="font-medium text-foreground text-right truncate max-w-[280px]">
                  «{bookTitle}» {bookCopyQr && !bookTitle.includes(bookCopyQr) ? (
                    <code className="ml-1 text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary font-mono font-semibold rounded">
                      [{bookCopyQr}]
                    </code>
                  ) : null}
                </span>
              </div>
            )}
            {overdueDays && overdueDays > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Số ngày trễ hạn:</span>
                <span className="font-semibold text-destructive">{overdueDays} ngày</span>
              </div>
            ) : null}
            <div className="flex justify-between pt-1 border-t border-border/60">
              <span className="font-medium text-muted-foreground">Tổng tiền phạt:</span>
              <span className="font-bold text-sm text-primary">{amount.toLocaleString("vi-VN")} VNĐ</span>
            </div>
          </div>

          {allowCashOption ? (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-3">
                <TabsTrigger value="transfer" className="text-xs gap-1.5 font-semibold">
                  <QrCode className="h-3.5 w-3.5" /> Chuyển khoản VietQR
                </TabsTrigger>
                <TabsTrigger value="cash" className="text-xs gap-1.5 font-semibold">
                  <Banknote className="h-3.5 w-3.5" /> Tiền mặt tại quầy
                </TabsTrigger>
              </TabsList>

              <TabsContent value="transfer" className="space-y-3 m-0">
                <TransferView
                  qrUrl={qrUrl}
                  imgLoaded={imgLoaded}
                  setImgLoaded={setImgLoaded}
                  bankConfig={bankConfig}
                  amount={amount}
                  cleanNote={cleanNote}
                  copiedField={copiedField}
                  handleCopy={handleCopy}
                />
              </TabsContent>

              <TabsContent value="cash" className="space-y-4 m-0 py-2">
                <div className="p-5 border-2 border-dashed border-emerald-500/30 bg-emerald-500/5 rounded-xl text-center space-y-2">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
                    <Banknote className="h-6 w-6" />
                  </div>
                  <p className="font-bold text-sm text-emerald-700 dark:text-emerald-400">Thu Tiền Mặt Trực Tiếp Tại Quầy</p>
                  <p className="text-2xl font-display font-extrabold text-foreground">
                    {amount.toLocaleString("vi-VN")} <span className="text-sm font-normal text-muted-foreground">VNĐ</span>
                  </p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Thủ thư nhận tiền mặt tận tay từ độc giả. Sau khi nhận đủ tiền, bấm nút xác nhận bên dưới để hoàn tất.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <TransferView
              qrUrl={qrUrl}
              imgLoaded={imgLoaded}
              setImgLoaded={setImgLoaded}
              bankConfig={bankConfig}
              amount={amount}
              cleanNote={cleanNote}
              copiedField={copiedField}
              handleCopy={handleCopy}
            />
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Đóng / Hủy
            </Button>
            <Button
              type="button"
              size="sm"
              className={activeTab === "transfer" ? "bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" : "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"}
              onClick={() => onConfirmPayment(activeTab)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
                  Đang ghi nhận...
                </>
              ) : activeTab === "transfer" ? (
                <>
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                  {allowCashOption ? "Đã nhận chuyển khoản & Hoàn tất" : "Tôi đã chuyển khoản xong"}
                </>
              ) : (
                <>
                  <Banknote className="h-4 w-4 mr-1.5" />
                  Xác nhận đã thu đủ tiền mặt
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TransferView({
  qrUrl,
  imgLoaded,
  setImgLoaded,
  bankConfig,
  amount,
  cleanNote,
  copiedField,
  handleCopy
}: {
  qrUrl: string;
  imgLoaded: boolean;
  setImgLoaded: (val: boolean) => void;
  bankConfig: BankConfig;
  amount: number;
  cleanNote: string;
  copiedField: string | null;
  handleCopy: (text: string, name: string) => void;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-3 items-center">
      {/* Cột mã QR */}
      <div className="flex flex-col items-center justify-center p-3 border rounded-xl bg-card shadow-xs">
        <div className="relative w-48 h-48 bg-white p-2 rounded-lg border shadow-xs flex items-center justify-center overflow-hidden">
          {!imgLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/60 text-xs text-muted-foreground gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span>Đang tạo VietQR...</span>
            </div>
          )}
          <img
            src={qrUrl}
            alt="Mã VietQR thanh toán"
            className={`w-full h-full object-contain transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Quét bằng App Ngân hàng bất kỳ (VCB, MB, TCB, Momo...)
        </p>
      </div>

      {/* Cột thông tin chi tiết */}
      <div className="space-y-2 text-xs">
        <div className="p-2.5 bg-muted/50 rounded-lg border space-y-1.5">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[11px]">
            <Building className="h-3 w-3 text-primary" />
            <span>Ngân hàng thụ hưởng:</span>
          </div>
          <p className="font-semibold text-foreground">{bankConfig.bank_name}</p>

          <div className="flex items-center justify-between pt-1 border-t border-border/50">
            <div>
              <span className="text-[11px] text-muted-foreground">Số tài khoản:</span>
              <p className="font-mono font-bold text-sm text-foreground">{bankConfig.bank_account_no}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={() => handleCopy(bankConfig.bank_account_no, "Số tài khoản")}
            >
              {copiedField === "Số tài khoản" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              Sao chép
            </Button>
          </div>

          <div className="pt-1 border-t border-border/50">
            <span className="text-[11px] text-muted-foreground">Chủ tài khoản:</span>
            <p className="font-semibold uppercase text-foreground">{bankConfig.bank_account_name}</p>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-border/50">
            <div>
              <span className="text-[11px] text-muted-foreground">Nội dung chuyển khoản:</span>
              <p className="font-mono font-bold text-primary text-[11px] bg-primary/10 px-1.5 py-0.5 rounded mt-0.5">
                {cleanNote}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={() => handleCopy(cleanNote, "Nội dung")}
            >
              {copiedField === "Nội dung" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              Sao chép
            </Button>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <span>Mã VietQR đã tự động đính kèm số tiền <strong>{amount.toLocaleString("vi-VN")}đ</strong> và nội dung. Độc giả không cần gõ tay!</span>
        </div>
      </div>
    </div>
  );
}
