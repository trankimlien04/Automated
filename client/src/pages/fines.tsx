import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, AlertTriangle, CheckCircle2, QrCode, Banknote, ShieldCheck } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { VietQrModal } from "@/components/vietqr-modal";

interface Fine {
  id: number;
  amount: number;
  reason: string;
  status: "paid" | "unpaid";
  payment_method?: "cash" | "transfer";
  payment_channel?: "counter" | "online";
  transaction_ref?: string | null;
  payment_date: string | null;
  created_at: string;
  reader_name: string;
  card_number: string;
  book_title: string | null;
  book_copy_qr?: string | null;
}

export default function FinesPage() {
  const [finesList, setFinesList] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // VietQR modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedFine, setSelectedFine] = useState<Fine | null>(null);
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);

  const fetchFines = async () => {
    setLoading(true);
    try {
      const response = await api.get("/fines");
      setFinesList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải phí phạt:", error);
      toast.error("Không thể tải danh sách hóa đơn phí phạt");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFines();
  }, []);

  const openPayModal = (fine: Fine) => {
    setSelectedFine(fine);
    setQrModalOpen(true);
  };

  const handleConfirmPayment = async (method: "transfer" | "cash") => {
    if (!selectedFine) return;
    setIsSubmittingPay(true);
    try {
      const res = await api.put(`/fines/${selectedFine.id}/pay`, {
        payment_method: method,
        payment_channel: user?.role === "reader" ? "online" : "counter",
        transaction_ref: method === "transfer" ? `TXN-FINE-${selectedFine.id}-${Date.now().toString().slice(-6)}` : null
      });
      toast.success(res.data.message || "Thanh toán phí phạt thành công!");
      setQrModalOpen(false);
      setSelectedFine(null);
      fetchFines();
    } catch (error: any) {
      console.error("Lỗi khi thanh toán:", error);
      toast.error(error.response?.data?.message || "Không thể thực hiện ghi nhận thanh toán");
    } finally {
      setIsSubmittingPay(false);
    }
  };

  const totalUnpaid = finesList
    .filter((f) => f.status === "unpaid")
    .reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const totalPaid = finesList
    .filter((f) => f.status === "paid")
    .reduce((s, f) => s + (Number(f.amount) || 0), 0);
  
  const canManage = user?.role === "admin" || user?.role === "librarian";
  const isReader = user?.role === "reader";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">Cần thanh toán</Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-destructive">{totalUnpaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground font-medium">
              {isReader ? "Phí phạt bạn cần thanh toán" : "Tổng phí chưa thanh toán"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <Badge variant="outline" className="text-[10px] text-success border-success/30">Đã quyết toán</Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-success">{totalPaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground font-medium">
              {isReader ? "Đã nộp thành công" : "Đã thu thành công vào quỹ"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <Wallet className="h-5 w-5 text-primary" />
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">VietQR Napas247</Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-primary">5.000đ</p>
            <p className="text-xs text-muted-foreground font-medium">Định mức phạt / ngày trễ hạn</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="font-display">
                {isReader ? "Hóa đơn phí phạt của bạn" : "Quản lý hóa đơn phí phạt"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isReader 
                  ? "Bạn có thể tạo mã VietQR động để chuyển khoản nhanh từ ứng dụng ngân hàng, giúp kích hoạt lại quyền mượn sách."
                  : "Đa kênh thanh toán: Độc giả chuyển khoản VietQR chuẩn Napas247 hoặc nộp tiền mặt trực tiếp tại quầy lưu thông."}
              </p>
            </div>
            <Badge variant="outline" className="w-fit text-xs gap-1.5 bg-primary/5 text-primary border-primary/20 py-1 px-2.5">
              <QrCode className="h-3.5 w-3.5" /> Tạo mã VietQR Napas247
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : finesList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Không có khoản phí phạt nào trong lịch sử</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-20">Mã HD</TableHead>
                  <TableHead>Độc giả</TableHead>
                  <TableHead>Sách trễ hạn</TableHead>
                  <TableHead>Lý do</TableHead>
                  <TableHead>Số tiền</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {finesList.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">#{f.id}</TableCell>
                    <TableCell className="font-medium text-xs">
                      {f.reader_name} <span className="text-[10px] text-muted-foreground">({f.card_number})</span>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      <span className="font-medium truncate block">{f.book_title || "Thẻ phạt hệ thống"}</span>
                      {f.book_copy_qr && (
                        <code className="text-[10px] text-primary/80 font-mono font-semibold">[{f.book_copy_qr}]</code>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground max-w-[200px] truncate">{f.reason}</TableCell>
                    <TableCell className="font-semibold text-xs text-primary">{(Number(f.amount) || 0).toLocaleString("vi-VN")}đ</TableCell>
                    <TableCell>
                      {f.status === "paid" ? (
                        <div className="space-y-0.5">
                          <Badge className="bg-success/15 text-success border-success/20 text-[10px]" variant="outline">
                            Đã thanh toán
                          </Badge>
                          <span className="block text-[10px] text-muted-foreground">
                            {f.payment_method === 'transfer' ? 'Chuyển khoản VietQR' : 'Tiền mặt'}
                            {f.payment_channel === 'online' ? ' (Online)' : ' (Tại quầy)'}
                          </span>
                        </div>
                      ) : (
                        <Badge className="bg-destructive/15 text-destructive border-destructive/20 text-[10px]" variant="outline">
                          Chưa thanh toán
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.status === "unpaid" ? (
                        isReader ? (
                          <Button 
                            size="sm" 
                            className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
                            onClick={() => openPayModal(f)}
                          >
                            <QrCode className="h-3.5 w-3.5" /> Thanh toán VietQR
                          </Button>
                        ) : (
                          <Button 
                            size="sm" 
                            className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                            onClick={() => openPayModal(f)}
                          >
                            <Wallet className="h-3.5 w-3.5" /> Thu tiền / QR
                          </Button>
                        )
                      ) : (
                        <div className="text-right text-[11px] text-muted-foreground italic">
                          <span>Đã thu {f.payment_date ? new Date(f.payment_date).toLocaleDateString("vi-VN") : ""}</span>
                          {f.transaction_ref && (
                            <span className="block font-mono text-[9px] text-primary/80">{f.transaction_ref}</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* VietQR Modal */}
      {selectedFine && (
        <VietQrModal
          open={qrModalOpen}
          onOpenChange={setQrModalOpen}
          amount={Number(selectedFine.amount) || 0}
          readerName={selectedFine.reader_name}
          cardNumber={selectedFine.card_number}
          bookTitle={selectedFine.book_title || undefined}
          bookCopyQr={selectedFine.book_copy_qr || undefined}
          overdueDays={selectedFine.reason ? parseInt(selectedFine.reason.match(/(\d+)\s*ngày/)?.[1] || "1", 10) : undefined}
          transferNote={`PHAT ${selectedFine.card_number} ${selectedFine.book_copy_qr || `HD${selectedFine.id}`}`}
          allowCashOption={canManage}
          onConfirmPayment={handleConfirmPayment}
          isSubmitting={isSubmittingPay}
        />
      )}

      {ConfirmDialogComponent}
    </div>
  );
}
