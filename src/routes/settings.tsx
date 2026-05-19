import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Shield, Database, Mail, Palette, Clock } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Quy định mượn / trả</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label>Số sách tối đa / độc giả</Label><Input defaultValue="5" /></div>
            <div className="space-y-2"><Label>Thời hạn mượn (ngày)</Label><Input defaultValue="14" /></div>
            <div className="space-y-2"><Label>Số lần gia hạn</Label><Input defaultValue="1" /></div>
            <div className="space-y-2"><Label>Phí phạt / ngày (đ)</Label><Input defaultValue="5000" /></div>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div><Label className="font-medium">Tự động khóa khi trễ &gt; 7 ngày</Label><p className="text-xs text-muted-foreground">Tạm khóa cho đến khi thanh toán phí phạt</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="font-medium">Nhắc trả sách qua email</Label><p className="text-xs text-muted-foreground">Tự động gửi 2 ngày trước hạn</p></div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display flex items-center gap-2"><Shield className="h-4 w-4 text-primary" /> Bảo mật</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between"><Label>Bắt buộc 2FA cho Admin</Label><Switch defaultChecked /></div>
          <div className="flex items-center justify-between"><Label>JWT hết hạn sau 24h</Label><Switch defaultChecked /></div>
          <div className="flex items-center justify-between"><Label>Ghi log truy cập</Label><Switch defaultChecked /></div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Phiên đăng nhập đang hoạt động</p>
            <div className="space-y-2">
              {["Chrome · Windows", "Safari · iPhone"].map((s) => (
                <div key={s} className="flex items-center justify-between rounded-md border p-2.5 text-xs">
                  <span>{s}</span><Badge variant="outline">Hoạt động</Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /> SMTP Email</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1"><Label>Server</Label><Input defaultValue="smtp.gmail.com" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Port</Label><Input defaultValue="587" /></div>
            <div className="space-y-1"><Label>Bảo mật</Label><Input defaultValue="TLS" /></div>
          </div>
          <div className="space-y-1"><Label>Email gửi</Label><Input defaultValue="library@uni.edu.vn" /></div>
          <Button variant="outline" className="w-full">Gửi email thử</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display flex items-center gap-2"><Database className="h-4 w-4 text-primary" /> Sao lưu dữ liệu</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Sao lưu gần nhất</p>
            <p className="font-medium">19/05/2026 · 03:00</p>
          </div>
          <Button className="w-full">Sao lưu thủ công ngay</Button>
          <div className="flex items-center justify-between"><Label className="text-sm">Tự động hằng ngày</Label><Switch defaultChecked /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display flex items-center gap-2"><Palette className="h-4 w-4 text-primary" /> Giao diện</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between"><Label>Chế độ tối</Label><Switch /></div>
          <div className="flex items-center justify-between"><Label>Hiệu ứng chuyển động</Label><Switch defaultChecked /></div>
          <div className="flex items-center justify-between"><Label>Hiển thị mã QR cạnh sách</Label><Switch defaultChecked /></div>
        </CardContent>
      </Card>
    </div>
  );
}
