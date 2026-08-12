import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Bell, X, CheckCircle2 } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

import { useConfirm } from "@/hooks/use-confirm";

interface Reservation {
  id: number;
  reservation_date: string;
  status: "pending" | "ready" | "completed" | "cancelled";
  reader_name: string;
  card_number: string;
  book_title: string;
  book_id: number;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  pending: { label: "Đang đợi sách", cls: "bg-warning/15 text-warning border-warning/30" },
  ready: { label: "Sẵn sàng nhận", cls: "bg-success/15 text-success border-success/20 animate-pulse" },
  completed: { label: "Đã hoàn thành", cls: "bg-muted text-muted-foreground border-muted-foreground/20" },
  cancelled: { label: "Đã hủy", cls: "bg-destructive/10 text-destructive border-destructive/20" },
};

export default function ReservationsPage() {
  const [resList, setResList] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const response = await api.get("/reservations");
      setResList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải phiếu đặt trước:", error);
      toast.error("Không thể tải danh sách đặt trước");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  const handleCancel = (id: number) => {
    confirm({
      title: "Xác nhận hủy đặt trước",
      description: "Bạn có chắc chắn muốn hủy yêu cầu đặt trước đầu sách này không?",
      confirmText: "Đồng ý hủy",
      cancelText: "Trở lại",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.put(`/reservations/${id}/cancel`);
          toast.success("Đã hủy phiếu đặt trước thành công!");
          fetchReservations();
        } catch (error: any) {
          console.error("Lỗi khi hủy đặt trước:", error);
          toast.error(error.response?.data?.message || "Không thể hủy phiếu đặt trước");
        }
      }
    });
  };

  const handleComplete = (id: number) => {
    confirm({
      title: "Xác nhận giao sách",
      description: "Xác nhận đã giao sách thành công cho độc giả và hoàn thành phiếu đặt trước này?",
      confirmText: "Xác nhận",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.put(`/reservations/${id}/complete`);
          toast.success("Đã hoàn thành giao sách cho độc giả!");
          fetchReservations();
        } catch (error: any) {
          console.error("Lỗi khi giao sách:", error);
          toast.error(error.response?.data?.message || "Không thể hoàn thành phiếu đặt trước");
        }
      }
    });
  };

  const totalActive = resList.filter((r) => r.status === "pending").length;
  const totalReady = resList.filter((r) => r.status === "ready").length;
  const totalCancelled = resList.filter((r) => r.status === "cancelled").length;

  const canManage = user?.role === "admin" || user?.role === "librarian";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <Calendar className="h-5 w-5 text-primary" />
            <p className="mt-3 font-display text-3xl font-semibold">{totalActive}</p>
            <p className="text-xs text-muted-foreground font-medium">Đặt trước đang chờ sách</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Bell className="h-5 w-5 text-success animate-bounce" />
            <p className="mt-3 font-display text-3xl font-semibold text-success">{totalReady}</p>
            <p className="text-xs text-muted-foreground font-medium">Đầu sách đã sẵn sàng để nhận</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <X className="h-5 w-5 text-muted-foreground" />
            <p className="mt-3 font-display text-3xl font-semibold text-muted-foreground">{totalCancelled}</p>
            <p className="text-xs text-muted-foreground font-medium">Yêu cầu đã hủy</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Quản lý Đặt trước sách</CardTitle>
          <p className="text-xs text-muted-foreground">Theo dõi danh sách xếp hàng khi đầu sách tạm hết bản sao khả dụng</p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : resList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Không có yêu cầu đặt trước nào</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-16">Mã</TableHead>
                  <TableHead>Tên sách</TableHead>
                  <TableHead>Độc giả đặt</TableHead>
                  <TableHead>Ngày đặt trước</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resList.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                    <TableCell className="font-medium text-xs truncate max-w-[200px]">{r.book_title}</TableCell>
                    <TableCell className="text-xs">
                      {r.reader_name} <span className="text-[10px] text-muted-foreground">({r.card_number})</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.reservation_date).toLocaleDateString("vi-VN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusMap[r.status]?.cls || ""}>
                        {statusMap[r.status]?.label || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === "ready" && canManage && (
                          <Button size="sm" className="gap-1 h-7 text-xs bg-success text-success-foreground hover:bg-success/90" onClick={() => handleComplete(r.id)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Giao sách
                          </Button>
                        )}
                        {(r.status === "pending" || r.status === "ready") && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-destructive/10" onClick={() => handleCancel(r.id)}>
                            Hủy
                          </Button>
                        )}
                        {r.status === "completed" && <span className="text-xs text-muted-foreground italic">Hoàn thành</span>}
                        {r.status === "cancelled" && <span className="text-xs text-muted-foreground line-through">Đã hủy</span>}
                      </div>
                    </TableCell>
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
