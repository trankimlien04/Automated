import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

import { useConfirm } from "@/hooks/use-confirm";

interface Fine {
  id: number;
  amount: number;
  reason: string;
  status: "paid" | "unpaid";
  payment_date: string | null;
  created_at: string;
  reader_name: string;
  card_number: string;
  book_title: string | null;
}

export default function FinesPage() {
  const [finesList, setFinesList] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

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

  const handlePayFine = (id: number) => {
    confirm({
      title: "Xác nhận thanh toán",
      description: "Bạn có chắc chắn muốn ghi nhận độc giả đã thanh toán hóa đơn phí phạt này?",
      confirmText: "Xác nhận thu",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.put(`/fines/${id}/pay`);
          toast.success("Ghi nhận thanh toán phí phạt thành công!");
          fetchFines();
        } catch (error: any) {
          console.error("Lỗi khi thanh toán:", error);
          toast.error(error.response?.data?.message || "Không thể thực hiện ghi nhận thanh toán");
        }
      }
    });
  };

  const totalUnpaid = finesList.filter((f) => f.status === "unpaid").reduce((s, f) => s + f.amount, 0);
  const totalPaid = finesList.filter((f) => f.status === "paid").reduce((s, f) => s + f.amount, 0);
  
  const canManage = user?.role === "admin" || user?.role === "librarian";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-destructive/30 bg-destructive/5 animate-pulse">
          <CardContent className="p-5">
            <AlertTriangle className="h-5 w-5 text-destructive animate-bounce" />
            <p className="mt-3 font-display text-3xl font-semibold text-destructive">{totalUnpaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground font-medium">Tổng phí chưa thanh toán</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <p className="mt-3 font-display text-3xl font-semibold text-success">{totalPaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground font-medium">Đã thu thành công</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Wallet className="h-5 w-5 text-primary" />
            <p className="mt-3 font-display text-3xl font-semibold text-primary">5.000đ</p>
            <p className="text-xs text-muted-foreground font-medium">Định mức phí / ngày trễ hạn</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Quản lý hóa đơn phí phạt</CardTitle>
          <p className="text-xs text-muted-foreground">Tự động tính phí dựa trên số ngày mượn trễ theo quy chế của Athenaeum</p>
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
                  {canManage && <TableHead className="text-right">Thao tác</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {finesList.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">#{f.id}</TableCell>
                    <TableCell className="font-medium text-xs">
                      {f.reader_name} <span className="text-[10px] text-muted-foreground">({f.card_number})</span>
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[180px]">{f.book_title || "Thẻ phạt hệ thống"}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground max-w-[200px] truncate">{f.reason}</TableCell>
                    <TableCell className="font-semibold text-xs text-primary">{f.amount.toLocaleString("vi-VN")}đ</TableCell>
                    <TableCell>
                      {f.status === "paid" ? (
                        <Badge className="bg-success/15 text-success border-success/20 text-[10px]" variant="outline">
                          Đã thanh toán
                        </Badge>
                      ) : (
                        <Badge className="bg-destructive/15 text-destructive border-destructive/20 text-[10px]" variant="outline">
                          Chưa thanh toán
                        </Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {f.status === "unpaid" ? (
                          <Button size="sm" className="h-7 text-xs" onClick={() => handlePayFine(f.id)}>
                            Ghi nhận thu
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Đã thu ngày {f.payment_date ? new Date(f.payment_date).toLocaleDateString("vi-VN") : ""}
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
