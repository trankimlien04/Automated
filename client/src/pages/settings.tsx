import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Shield, Database, Mail, Palette, Clock } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

import { useConfirm } from "@/hooks/use-confirm";

interface ConfigItem {
  value: string;
  description: string;
}

type ConfigMap = Record<string, ConfigItem>;

export default function SettingsPage() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // Local state for editing
  const [maxBooks, setMaxBooks] = useState("3");
  const [maxDays, setMaxDays] = useState("14");
  const [finePerDay, setFinePerDay] = useState("5000");

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const response = await api.get("/configs");
      const data = response.data;
      setConfigs(data);
      if (data.max_books_per_user) setMaxBooks(data.max_books_per_user.value);
      if (data.max_borrow_days) setMaxDays(data.max_borrow_days.value);
      if (data.fine_per_day) setFinePerDay(data.fine_per_day.value);
    } catch (error) {
      console.error("Lỗi khi lấy cấu hình hệ thống:", error);
      toast.error("Không thể tải cấu hình vận hành");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleSaveConfigs = () => {
    confirm({
      title: "Xác nhận lưu cấu hình",
      description: "Bạn có chắc chắn muốn lưu các thay đổi về quy chế vận hành thư viện không?",
      confirmText: "Đồng ý lưu",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.put("/configs", {
            configs: {
              max_books_per_user: maxBooks,
              max_borrow_days: maxDays,
              fine_per_day: finePerDay
            }
          });
          toast.success("Cập nhật quy chế vận hành thành công!");
          fetchConfigs();
        } catch (error) {
          console.error("Lỗi khi cập nhật cấu hình:", error);
          toast.error("Không thể lưu cấu hình mới");
        }
      }
    });
  };

  const isAdmin = user?.role === "admin";

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Quy chế mượn / trả Athenaeum
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Số sách tối đa / độc giả</Label>
              <Input 
                value={maxBooks} 
                onChange={(e) => setMaxBooks(e.target.value)} 
                disabled={!isAdmin} 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Thời hạn mượn mặc định (ngày)</Label>
              <Input 
                value={maxDays} 
                onChange={(e) => setMaxDays(e.target.value)} 
                disabled={!isAdmin} 
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Phí phạt / ngày trễ hạn (đ)</Label>
              <Input 
                value={finePerDay} 
                onChange={(e) => setFinePerDay(e.target.value)} 
                disabled={!isAdmin} 
              />
            </div>
          </div>
          {isAdmin && (
            <Button onClick={handleSaveConfigs} className="w-full mt-2">
              Lưu cấu hình quy định
            </Button>
          )}
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium text-xs">Tự động tạm khóa thẻ khi trễ &gt; 7 ngày</Label>
              <p className="text-[10px] text-muted-foreground">Khóa cho đến khi độc giả hoàn tất thanh toán nợ phí phạt</p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium text-xs">Gửi email nhắc nhở trả sách</Label>
              <p className="text-[10px] text-muted-foreground">Tự động nhắc nhở trước thời hạn 2 ngày</p>
            </div>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Bảo mật & Phiên
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Bắt buộc 2FA cho Quản lý</Label>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Thời hạn JWT Token (24h)</Label>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Ghi log nhật ký hoạt động</Label>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
          <Separator />
          <div>
            <p className="text-xs font-semibold mb-2">Trình duyệt đăng nhập</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border p-2 text-[10px]">
                <span>Chrome · Windows (Hiện tại)</span>
                <Badge variant="outline" className="text-[9px] bg-success/10 text-success">Hoạt động</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> Cổng SMTP Email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">SMTP Host</Label>
            <Input defaultValue="smtp.gmail.com" disabled={!isAdmin} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Port</Label>
              <Input defaultValue="587" disabled={!isAdmin} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bảo mật</Label>
              <Input defaultValue="TLS" disabled={!isAdmin} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email gửi</Label>
            <Input defaultValue="athenaeum.library@gmail.com" disabled={!isAdmin} />
          </div>
          {isAdmin && <Button variant="outline" className="w-full text-xs">Kiểm tra kết nối gửi thử</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" /> Sao lưu CSDL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3 text-[11px]">
            <p className="text-muted-foreground">Bản sao lưu gần nhất</p>
            <p className="font-semibold text-foreground mt-0.5">Hôm nay · 03:00 sáng</p>
          </div>
          {isAdmin && <Button className="w-full text-xs">Tải xuống file SQL backup</Button>}
          <div className="flex items-center justify-between mt-2">
            <Label className="text-xs">Sao lưu tự động hằng ngày</Label>
            <Switch defaultChecked disabled={!isAdmin} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" /> Tùy chọn hiển thị
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Chế độ tối (Dark mode)</Label>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Hiệu ứng mượt mà (Micro-animations)</Label>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
