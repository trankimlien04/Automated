import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Bell, X, CheckCircle2 } from "lucide-react";
import { reservations } from "@/lib/mock-data";

export const Route = createFileRoute("/reservations")({ component: ReservationsPage });

const statusMap: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Đang đợi", cls: "bg-warning/15 text-warning border-warning/30" },
  ready: { label: "Sẵn sàng nhận", cls: "bg-success/15 text-success border-success/20" },
  expired: { label: "Hết hạn", cls: "bg-muted text-muted-foreground" },
};

function ReservationsPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <Calendar className="h-5 w-5 text-primary" />
            <p className="mt-3 font-display text-3xl font-semibold">28</p>
            <p className="text-xs text-muted-foreground">Đặt trước đang hoạt động</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Bell className="h-5 w-5 text-success" />
            <p className="mt-3 font-display text-3xl font-semibold">6</p>
            <p className="text-xs text-muted-foreground">Sẵn sàng cho độc giả nhận</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <X className="h-5 w-5 text-muted-foreground" />
            <p className="mt-3 font-display text-3xl font-semibold">3</p>
            <p className="text-xs text-muted-foreground">Hết hạn tuần này</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Danh sách đặt trước</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Mã</TableHead>
                <TableHead>Sách</TableHead>
                <TableHead>Độc giả</TableHead>
                <TableHead>Ngày đặt</TableHead>
                <TableHead>Hàng đợi</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell className="font-medium">{r.book}</TableCell>
                  <TableCell>{r.reader}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.date}</TableCell>
                  <TableCell>{r.queue === 0 ? <Badge className="bg-success">Tiếp theo</Badge> : <span className="text-sm">#{r.queue + 1}</span>}</TableCell>
                  <TableCell><Badge variant="outline" className={statusMap[r.status].cls}>{statusMap[r.status].label}</Badge></TableCell>
                  <TableCell className="text-right">
                    {r.status === "ready" && <Button size="sm" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Giao sách</Button>}
                    {r.status === "waiting" && <Button size="sm" variant="ghost">Hủy</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
