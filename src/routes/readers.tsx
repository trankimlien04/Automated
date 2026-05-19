import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Mail, Phone, MoreHorizontal } from "lucide-react";
import { readers } from "@/lib/mock-data";

export const Route = createFileRoute("/readers")({ component: ReadersPage });

const statusMap: Record<string, { label: string; cls: string }> = {
  active: { label: "Hoạt động", cls: "bg-success/15 text-success border-success/20" },
  locked: { label: "Đã khóa", cls: "bg-destructive/15 text-destructive border-destructive/20" },
  pending: { label: "Chờ duyệt", cls: "bg-warning/15 text-warning border-warning/30" },
};

function ReadersPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Tổng độc giả", value: "3,265", sub: "+128 tháng này" },
          { label: "Đang mượn sách", value: "412", sub: "12.6% độc giả" },
          { label: "Chờ duyệt", value: "7", sub: "Cần xử lý" },
          { label: "Tài khoản khóa", value: "9", sub: "Vi phạm quá hạn" },
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
              <Input placeholder="Tìm theo MSSV, tên, email…" className="pl-9" />
            </div>
            <Button className="gap-2"><Plus className="h-4 w-4" /> Thêm độc giả</Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Độc giả</TableHead>
                <TableHead>Mã thẻ</TableHead>
                <TableHead>Liên hệ</TableHead>
                <TableHead>Đang mượn</TableHead>
                <TableHead>Hạn thẻ</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {readers.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9"><AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">{r.name.split(" ").slice(-1)[0][0]}</AvatarFallback></Avatar>
                      <div>
                        <p className="font-medium text-sm">{r.name}</p>
                        <p className="text-xs text-muted-foreground">Tham gia {r.since}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1.5 text-xs"><Mail className="h-3 w-3 text-muted-foreground" /> {r.email}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {r.phone}</p>
                    </div>
                  </TableCell>
                  <TableCell><span className="font-medium">{r.borrowed}</span> <span className="text-xs text-muted-foreground">cuốn</span></TableCell>
                  <TableCell className="text-sm">{r.expiry}</TableCell>
                  <TableCell><Badge variant="outline" className={statusMap[r.status].cls}>{statusMap[r.status].label}</Badge></TableCell>
                  <TableCell><Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
