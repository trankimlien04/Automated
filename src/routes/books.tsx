import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Plus, Search, QrCode, Upload, Filter, Star, Edit, Trash2 } from "lucide-react";
import { books } from "@/lib/mock-data";

export const Route = createFileRoute("/books")({ component: BooksPage });

function BooksPage() {
  const [q, setQ] = useState("");
  const filtered = books.filter((b) =>
    [b.title, b.author, b.isbn, b.category].join(" ").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, tác giả, ISBN…" className="pl-9" />
        </div>
        <Select defaultValue="all">
          <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả thể loại</SelectItem>
            <SelectItem value="literature">Văn học</SelectItem>
            <SelectItem value="science">Khoa học</SelectItem>
            <SelectItem value="tech">Công nghệ</SelectItem>
            <SelectItem value="skill">Kỹ năng</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="gap-2"><Filter className="h-4 w-4" /> Bộ lọc</Button>
        <Button variant="outline" className="gap-2"><Upload className="h-4 w-4" /> Import CSV</Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> Thêm sách</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Thêm đầu sách mới</DialogTitle>
              <DialogDescription>Điền thông tin chi tiết. Mã QR sẽ được tự động sinh sau khi lưu.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Input placeholder="Tên sách" />
              <Input placeholder="Tác giả" />
              <Input placeholder="ISBN" />
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Số bản sao" type="number" />
                <Select><SelectTrigger><SelectValue placeholder="Thể loại" /></SelectTrigger><SelectContent>
                  <SelectItem value="lit">Văn học</SelectItem><SelectItem value="sci">Khoa học</SelectItem>
                </SelectContent></Select>
              </div>
              <Button>Lưu & sinh mã QR</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((b) => (
          <Card key={b.id} className="group overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5">
            <div className="relative h-40 bg-gradient-to-br from-primary/12 via-accent/40 to-terracotta/10 grid place-items-center text-6xl">
              {b.cover}
              <Badge className="absolute top-3 left-3 bg-background/90 text-foreground border-0 shadow-sm">{b.category}</Badge>
              <div className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-md bg-background/90 shadow-sm">
                <QrCode className="h-4 w-4" />
              </div>
            </div>
            <CardContent className="p-4">
              <h3 className="font-display text-base font-semibold leading-snug line-clamp-1">{b.title}</h3>
              <p className="text-xs text-muted-foreground">{b.author}</p>
              <div className="mt-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                  <span className="font-medium">{b.rating}</span>
                </div>
                <span className={b.available > 0 ? "text-success font-medium" : "text-destructive font-medium"}>
                  {b.available > 0 ? `${b.available}/${b.total} sẵn có` : "Hết sách"}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">{b.isbn}</p>
              <div className="mt-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
                <Button size="sm" variant="outline" className="flex-1 gap-1"><Edit className="h-3 w-3" /> Sửa</Button>
                <Button size="sm" variant="ghost"><Trash2 className="h-3 w-3 text-destructive" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
