import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { fines } from "@/lib/mock-data";

export const Route = createFileRoute("/fines")({ component: FinesPage });

function FinesPage() {
  const totalUnpaid = fines.filter((f) => f.status === "unpaid").reduce((s, f) => s + f.amount, 0);
  const totalPaid = fines.filter((f) => f.status === "paid").reduce((s, f) => s + f.amount, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="mt-3 font-display text-3xl font-semibold text-destructive">{totalUnpaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground">Chưa thanh toán</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <p className="mt-3 font-display text-3xl font-semibold">{totalPaid.toLocaleString("vi-VN")}đ</p>
            <p className="text-xs text-muted-foreground">Đã thu trong tháng</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <Wallet className="h-5 w-5 text-primary" />
            <p className="mt-3 font-display text-3xl font-semibold">5,000đ</p>
            <p className="text-xs text-muted-foreground">Phí phạt / ngày trễ</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Phiếu phạt</CardTitle>
          <p className="text-xs text-muted-foreground">Tự động tính theo số ngày trễ hạn</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Mã phiếu</TableHead>
                <TableHead>Độc giả</TableHead>
                <TableHead>Sách</TableHead>
                <TableHead>Số ngày trễ</TableHead>
                <TableHead>Số tiền</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.id}</TableCell>
                  <TableCell className="font-medium">{f.reader}</TableCell>
                  <TableCell>{f.book}</TableCell>
                  <TableCell><Badge variant="outline" className={f.days > 7 ? "border-destructive/30 text-destructive" : ""}>{f.days} ngày</Badge></TableCell>
                  <TableCell className="font-semibold">{f.amount.toLocaleString("vi-VN")}đ</TableCell>
                  <TableCell>
                    {f.status === "paid"
                      ? <Badge className="bg-success/15 text-success border-success/20" variant="outline">Đã thanh toán</Badge>
                      : <Badge className="bg-destructive/15 text-destructive border-destructive/20" variant="outline">Chưa thanh toán</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {f.status === "unpaid" && <Button size="sm">Ghi nhận thanh toán</Button>}
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
