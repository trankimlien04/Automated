import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Info, BellRing, Mail } from "lucide-react";
import { notifications } from "@/lib/mock-data";

export const Route = createFileRoute("/notifications")({ component: NotificationsPage });

const iconMap = {
  success: { Icon: CheckCircle2, cls: "text-success bg-success/10" },
  warning: { Icon: AlertTriangle, cls: "text-warning bg-warning/15" },
  info: { Icon: Info, cls: "text-primary bg-primary/10" },
  danger: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10" },
} as const;

function NotificationsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="font-display">Hộp thư</CardTitle>
            <p className="text-xs text-muted-foreground">2 thông báo chưa đọc</p>
          </div>
          <Button variant="ghost" size="sm">Đánh dấu đã đọc tất cả</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {notifications.map((n) => {
            const { Icon, cls } = iconMap[n.type as keyof typeof iconMap];
            return (
              <div key={n.id} className={`flex gap-3 rounded-lg border p-4 transition hover:bg-accent/30 ${n.unread ? "border-primary/30 bg-primary/[0.03]" : ""}`}>
                <div className={`h-10 w-10 shrink-0 rounded-md grid place-items-center ${cls}`}><Icon className="h-5 w-5" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{n.title}</p>
                    {n.unread && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">Mới</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{n.time}</p>
                </div>
              </div>
            );
          })}
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
                <Label htmlFor={s.id} className="font-medium">{s.label}</Label>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
              <Switch id={s.id} defaultChecked />
            </div>
          ))}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email</Label>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2"><BellRing className="h-4 w-4" /> In-app</Label>
              <Switch defaultChecked />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
