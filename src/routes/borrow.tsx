import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QrCode, Camera, BookOpen, User, Clock, CheckCircle2, Scan } from "lucide-react";
import { recentTransactions } from "@/lib/mock-data";

export const Route = createFileRoute("/borrow")({ component: BorrowPage });

function BorrowPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2 overflow-hidden">
        <CardHeader>
          <CardTitle className="font-display">Quét mã QR</CardTitle>
          <p className="text-xs text-muted-foreground">Đặt mã QR sách hoặc thẻ độc giả trước camera</p>
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
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="h-16 w-16 rounded-full bg-primary/10 grid place-items-center">
                    <Camera className="h-8 w-8 text-primary" />
                  </div>
                  <p className="font-display text-lg">Đang chờ mã QR…</p>
                  <p className="max-w-xs text-xs text-muted-foreground">Đảm bảo ánh sáng đủ và mã QR nằm gọn trong khung viền.</p>
                  <Button className="gap-2 mt-2"><Scan className="h-4 w-4" /> Bật camera</Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input placeholder="Hoặc nhập mã sách thủ công (VD: B001)" />
                <Input placeholder="Mã độc giả (VD: SV2024001)" />
              </div>
              <Button size="lg" className="w-full gap-2">
                <CheckCircle2 className="h-4 w-4" /> Xác nhận mượn sách
              </Button>
            </TabsContent>
            <TabsContent value="return" className="mt-4">
              <div className="rounded-xl border bg-muted/30 p-8 text-center">
                <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 font-display text-lg">Quét mã QR trên sách để trả</p>
                <p className="mt-1 text-xs text-muted-foreground">Hệ thống sẽ tự động kiểm tra hạn và tính phạt nếu cần.</p>
                <Button className="mt-4 gap-2"><Scan className="h-4 w-4" /> Bật camera</Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Phiên làm việc</CardTitle>
          <p className="text-xs text-muted-foreground">Hôm nay · Quầy A1</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md bg-primary/10 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-primary">42</p>
              <p className="text-[10px] uppercase text-muted-foreground">Mượn</p>
            </div>
            <div className="rounded-md bg-success/10 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-success">38</p>
              <p className="text-[10px] uppercase text-muted-foreground">Trả</p>
            </div>
            <div className="rounded-md bg-warning/15 p-3 text-center">
              <p className="font-display text-2xl font-semibold text-warning">5</p>
              <p className="text-[10px] uppercase text-muted-foreground">Phạt</p>
            </div>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Gần đây</p>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentTransactions.map((t) => (
                <div key={t.id} className="flex items-start gap-3 rounded-md border p-2.5 text-sm">
                  <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${t.action === "borrow" ? "bg-primary" : t.action === "return" ? "bg-success" : "bg-destructive"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{t.book}</p>
                    <p className="truncate text-xs text-muted-foreground"><User className="inline h-3 w-3 mr-1" />{t.reader}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]"><Clock className="mr-1 h-3 w-3" />{t.time}</Badge>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
