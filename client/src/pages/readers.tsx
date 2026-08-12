import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Mail, Phone, Lock, Unlock, CheckCircle } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

import { useConfirm } from "@/hooks/use-confirm";

interface User {
  id: number;
  full_name: string;
  email: string;
  role: string;
  phone?: string;
  avatar_url?: string;
  card_number?: string;
  status: "active" | "locked" | "pending";
  created_at: string;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  active: { label: "Hoạt động", cls: "bg-success/15 text-success border-success/20" },
  locked: { label: "Đã khóa", cls: "bg-destructive/15 text-destructive border-destructive/20" },
  pending: { label: "Chờ duyệt", cls: "bg-warning/15 text-warning border-warning/30" },
};

export default function ReadersPage() {
  const [readersList, setReadersList] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  const fetchReaders = async () => {
    setLoading(true);
    try {
      const response = await api.get("/users");
      // Filter ONLY readers to show in this view
      const readers = response.data.filter((u: User) => u.role === "reader");
      setReadersList(readers);
    } catch (error) {
      console.error("Lỗi khi tải độc giả:", error);
      toast.error("Không thể tải danh sách độc giả");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReaders();
  }, []);

  const handleUpdateStatus = (id: number, fullName: string, newStatus: string) => {
    const actionName = newStatus === "active" ? "mở khóa / duyệt cấp thẻ" : "khóa thẻ";
    const title = newStatus === "active" ? "Xác nhận duyệt/mở khóa thẻ" : "Xác nhận khóa thẻ";
    
    confirm({
      title: title,
      description: `Bạn có đồng ý chấp nhận ${actionName} cho độc giả "${fullName}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      variant: newStatus === "locked" ? "destructive" : "default",
      onConfirm: async () => {
        try {
          await api.put(`/users/${id}/status`, { status: newStatus });
          toast.success("Cập nhật trạng thái độc giả thành công!");
          fetchReaders();
        } catch (error) {
          console.error("Lỗi khi cập nhật trạng thái:", error);
          toast.error("Lỗi khi cập nhật trạng thái");
        }
      }
    });
  };

  const filtered = readersList.filter((u) =>
    [u.full_name, u.email, u.card_number].join(" ").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Tổng độc giả", value: readersList.length.toString(), sub: "Hồ sơ độc giả đã đăng ký" },
          { label: "Đang hoạt động", value: readersList.filter(u => u.status === 'active').length.toString(), sub: "Độc giả được mượn sách" },
          { label: "Chờ duyệt thẻ", value: readersList.filter(u => u.status === 'pending').length.toString(), sub: "Đăng ký thẻ mới" },
          { label: "Thẻ đang khóa", value: readersList.filter(u => u.status === 'locked').length.toString(), sub: "Bị khóa do quá hạn/vi phạm" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="mt-2 font-display text-3xl font-semibold">{s.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:p-5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Tìm theo tên độc giả, email, số thẻ…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Họ và tên</TableHead>
                  <TableHead>Mã số thẻ</TableHead>
                  <TableHead>Thông tin liên hệ</TableHead>
                  <TableHead>Trạng thái thẻ</TableHead>
                  <TableHead className="w-40 text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                            {r.full_name.split(" ").slice(-1)[0][0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{r.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            Đăng ký {new Date(r.created_at).toLocaleDateString("vi-VN")}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.card_number || "Chưa cấp"}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="flex items-center gap-1.5 text-xs">
                          <Mail className="h-3 w-3 text-muted-foreground" /> {r.email}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {r.phone || "Không có"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusMap[r.status]?.cls || ""}>
                        {statusMap[r.status]?.label || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {r.status === "pending" && (
                          <Button
                            size="sm"
                            className="bg-success text-success-foreground hover:bg-success/90 h-8 gap-1"
                            onClick={() => handleUpdateStatus(r.id, r.full_name, "active")}
                          >
                            <CheckCircle className="h-3.5 w-3.5" /> Duyệt cấp thẻ
                          </Button>
                        )}
                        {r.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-destructive hover:bg-destructive/10 text-destructive h-8 gap-1"
                            onClick={() => handleUpdateStatus(r.id, r.full_name, "locked")}
                          >
                            <Lock className="h-3.5 w-3.5" /> Khóa thẻ
                          </Button>
                        )}
                        {r.status === "locked" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-success hover:bg-success/10 text-success h-8 gap-1"
                            onClick={() => handleUpdateStatus(r.id, r.full_name, "active")}
                          >
                            <Unlock className="h-3.5 w-3.5" /> Mở khóa thẻ
                          </Button>
                        )}
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
