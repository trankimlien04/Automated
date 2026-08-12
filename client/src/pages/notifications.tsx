import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Info, BellRing, Mail } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

const iconMap = {
  success: { Icon: CheckCircle2, cls: "text-success bg-success/10" },
  warning: { Icon: AlertTriangle, cls: "text-warning bg-warning/15" },
  info: { Icon: Info, cls: "text-primary bg-primary/10" },
  danger: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10" },
} as const;

export default function NotificationsPage() {
  const [notiList, setNotiList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await api.get("/notifications");
      setNotiList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải thông báo:", error);
      toast.error("Không thể tải danh sách thông báo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (id: number) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotiList(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      toast.success("Đã đánh dấu thông báo đã đọc");
    } catch (error) {
      console.error("Lỗi khi cập nhật thông báo:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.put("/notifications/read-all");
      setNotiList(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success("Đã đọc tất cả thông báo");
    } catch (error) {
      console.error("Lỗi khi cập nhật tất cả thông báo:", error);
    }
  };

  const unreadCount = notiList.filter((n) => !n.is_read).length;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-display">Hộp thư thông báo</CardTitle>
            <p className="text-xs text-muted-foreground">{unreadCount} thông báo chưa đọc</p>
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead} className="text-xs">
              Đánh dấu đã đọc tất cả
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : notiList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Không có thông báo nào trong hộp thư của bạn.
            </div>
          ) : (
            notiList.map((n) => {
              const mapping = iconMap[n.type as keyof typeof iconMap] || iconMap.info;
              const { Icon, cls } = mapping;
              return (
                <div 
                  key={n.id} 
                  onClick={() => !n.is_read && handleMarkAsRead(n.id)}
                  className={`flex gap-3 rounded-lg border p-4 transition cursor-pointer hover:bg-accent/30 ${!n.is_read ? "border-primary/30 bg-primary/[0.03]" : ""}`}
                >
                  <div className={`h-10 w-10 shrink-0 rounded-md grid place-items-center ${cls}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm ${!n.is_read ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                      {!n.is_read && <Badge variant="outline" className="text-[9px] border-primary/40 text-primary px-1 py-0 h-4">Mới</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{n.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString("vi-VN")}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tùy chọn nhận</CardTitle>
          <p className="text-xs text-muted-foreground">Cài đặt kênh và loại thông báo</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {[
            { id: "remind", label: "Nhắc trả sách trước hạn", desc: "2 ngày trước hạn trả", icon: BellRing },
            { id: "overdue", label: "Cảnh báo quá hạn", desc: "Gửi ngay khi trễ", icon: AlertTriangle },
            { id: "reserve", label: "Sách đặt trước đã có", desc: "Khi sách được trả về", icon: CheckCircle2 },
            { id: "card", label: "Thẻ thư viện sắp hết hạn", desc: "7 ngày trước hết hạn", icon: Info },
          ].map((s) => (
            <div key={s.id} className="flex items-start gap-3">
              <s.icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <Label htmlFor={s.id} className="font-medium text-xs">{s.label}</Label>
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </div>
              <Switch id={s.id} defaultChecked />
            </div>
          ))}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-xs"><Mail className="h-4 w-4" /> Email thông báo</Label>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-xs"><BellRing className="h-4 w-4" /> In-app realtime</Label>
              <Switch defaultChecked />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
