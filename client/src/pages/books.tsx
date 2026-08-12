import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Plus, Search, QrCode, Filter, Star, Edit, Trash2 } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

import { useConfirm } from "@/hooks/use-confirm";
import { QRCodeCanvas } from "qrcode.react";
import { Download } from "lucide-react";

interface Book {
  id: number;
  title: string;
  author_name?: string;
  category_name?: string;
  isbn?: string;
  published_year?: number;
  description?: string;
  total_copies: number;
  available_copies: number;
}

export default function BooksPage() {
  const [booksList, setBooksList] = useState<Book[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // Form states
  const [newTitle, setNewTitle] = useState("");
  const [selectedAuthor, setSelectedAuthor] = useState("");
  const [selectedPublisher, setSelectedPublisher] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [newIsbn, setNewIsbn] = useState("");
  const [newCopies, setNewCopies] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [categories, setCategories] = useState<{id: number; name: string}[]>([]);
  const [authors, setAuthors] = useState<{id: number; name: string}[]>([]);
  const [publishers, setPublishers] = useState<{id: number; name: string}[]>([]);

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const response = await api.get("/books");
      setBooksList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải sách:", error);
      toast.error("Không thể kết nối tới server để tải sách");
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    try {
      const [catRes, authRes, pubRes] = await Promise.all([
        api.get("/categories"),
        api.get("/authors"),
        api.get("/publishers")
      ]);
      setCategories(catRes.data);
      setAuthors(authRes.data);
      setPublishers(pubRes.data);
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu phụ trợ:", error);
    }
  };

  useEffect(() => {
    fetchBooks();
    fetchMetadata();
  }, []);

  // QR Code viewing state
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedBookForQr, setSelectedBookForQr] = useState<any>(null);
  const [bookCopies, setBookCopies] = useState<any[]>([]);
  const [loadingQr, setLoadingQr] = useState(false);

  const handleOpenQrDialog = async (book: Book) => {
    setSelectedBookForQr(book);
    setQrDialogOpen(true);
    setLoadingQr(true);
    try {
      const res = await api.get(`/books/${book.id}`);
      if (res.data && res.data.copies) {
        setBookCopies(res.data.copies);
      } else {
        setBookCopies([]);
      }
    } catch (error) {
      console.error("Lỗi tải bản sao:", error);
      toast.error("Không thể tải mã QR của sách");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDownloadQr = (qrCodeStr: string) => {
    const canvas = document.getElementById(`qr-canvas-${qrCodeStr}`) as HTMLCanvasElement;
    if (!canvas) return;
    const pngUrl = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
    let downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `${qrCodeStr}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const handleAddBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Vui lòng nhập tên sách");
      return;
    }

    confirm({
      title: "Xác nhận thêm mới đầu sách",
      description: `Bạn có đồng ý chấp nhận thêm đầu sách "${newTitle}" với ${newCopies} bản sao vào hệ thống không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.post("/books", {
            title: newTitle,
            author_id: selectedAuthor ? parseInt(selectedAuthor) : null,
            publisher_id: selectedPublisher ? parseInt(selectedPublisher) : null,
            category_id: selectedCategory ? parseInt(selectedCategory) : null,
            isbn: newIsbn,
            total_copies: newCopies,
            published_year: new Date().getFullYear(),
            description: "Mô tả sách thư viện",
          });

          toast.success("Thêm đầu sách mới và tạo mã QR thành công!");
          setIsDialogOpen(false);
          // Reset form
          setNewTitle("");
          setSelectedAuthor("");
          setSelectedPublisher("");
          setSelectedCategory("");
          setNewIsbn("");
          setNewCopies(1);
          fetchBooks();
        } catch (error) {
          console.error("Lỗi khi thêm sách:", error);
          toast.error("Lỗi khi thêm đầu sách mới");
        }
      }
    });
  };

  const handleDeleteBook = (id: number, bookTitle: string) => {
    confirm({
      title: "Xác nhận xóa đầu sách",
      description: `Bạn có đồng ý chấp nhận xóa đầu sách "${bookTitle}" không? Các bản sao sách và mã QR tương ứng cũng sẽ bị xóa.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/books/${id}`);
          toast.success("Xóa sách thành công");
          fetchBooks();
        } catch (error) {
          console.error("Lỗi khi xóa sách:", error);
          toast.error("Không thể xóa sách");
        }
      }
    });
  };

  const filtered = booksList.filter((b) =>
    [b.title, b.isbn].join(" ").toLowerCase().includes(q.toLowerCase())
  );

  const canManage = user?.role === "admin" || user?.role === "librarian";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, ISBN…" className="pl-9" />
        </div>
        <Select defaultValue="all">
          <SelectTrigger className="w-full md:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả thể loại</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" className="gap-2"><Filter className="h-4 w-4" /> Bộ lọc</Button>
        
        {canManage && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Thêm sách</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Thêm đầu sách mới</DialogTitle>
                <DialogDescription>Điền thông tin chi tiết. Mã QR sẽ được tự động sinh sau khi lưu.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddBook} className="grid gap-3">
                <Input placeholder="Tên sách" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
                <Input placeholder="ISBN" value={newIsbn} onChange={(e) => setNewIsbn(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Select value={selectedAuthor} onValueChange={setSelectedAuthor}>
                    <SelectTrigger><SelectValue placeholder="Chọn tác giả" /></SelectTrigger>
                    <SelectContent>
                      {authors.map(a => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedPublisher} onValueChange={setSelectedPublisher}>
                    <SelectTrigger><SelectValue placeholder="Chọn NXB" /></SelectTrigger>
                    <SelectContent>
                      {publishers.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Số bản sao" type="number" value={newCopies} onChange={(e) => setNewCopies(parseInt(e.target.value) || 1)} min={1} />
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger><SelectValue placeholder="Chọn thể loại" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit">Lưu & sinh mã QR</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((b) => (
            <Card key={b.id} className="group overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5">
              <div className="relative h-40 bg-gradient-to-br from-primary/12 via-accent/40 to-terracotta/10 grid place-items-center text-6xl">
                📚
                <Badge className="absolute top-3 left-3 bg-background/90 text-foreground border-0 shadow-sm">
                  {b.category_name || "Mặc định"}
                </Badge>
                <button onClick={() => handleOpenQrDialog(b)} className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-md bg-background/90 shadow-sm transition-transform hover:scale-110 cursor-pointer">
                  <QrCode className="h-4 w-4" />
                </button>
              </div>
              <CardContent className="p-4">
                <h3 className="font-display text-base font-semibold leading-snug line-clamp-1">{b.title}</h3>
                <p className="text-xs text-muted-foreground">{b.author_name || "Khuyết danh"}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                    <span className="font-medium">4.5</span>
                  </div>
                  <span className={b.available_copies > 0 ? "text-success font-medium" : "text-destructive font-medium"}>
                    {b.available_copies > 0 ? `${b.available_copies}/${b.total_copies} sẵn có` : "Hết sách"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{b.isbn || "Không có ISBN"}</p>
                
                {canManage && (
                  <div className="mt-3 flex gap-2 opacity-0 transition group-hover:opacity-100">
                    <Button size="sm" variant="outline" className="flex-1 gap-1"><Edit className="h-3 w-3" /> Sửa</Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteBook(b.id, b.title)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Dialog for QR Codes */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Mã QR Bản Sao Sách</DialogTitle>
            <DialogDescription>
              {selectedBookForQr?.title} - Các mã QR định danh cho từng bản sao. Bạn có thể tải mã xuống để in.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {loadingQr ? (
              <div className="flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
            ) : bookCopies.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">Không có bản sao nào cho đầu sách này.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {bookCopies.map((copy: any) => (
                  <div key={copy.id} className="flex flex-col items-center p-4 border rounded-lg bg-muted/20 hover:bg-muted/40 transition">
                    <div className="bg-white p-2 rounded-md shadow-sm mb-3">
                      <QRCodeCanvas 
                        id={`qr-canvas-${copy.qr_code}`}
                        value={copy.qr_code} 
                        size={120} 
                        level={"H"}
                        includeMargin={true}
                      />
                    </div>
                    <p className="text-[10px] font-mono text-center break-all mb-2 max-w-[120px]">{copy.qr_code}</p>
                    <Badge variant="outline" className={copy.status === "available" ? "bg-success/10 text-success border-success/20 mb-3 text-[10px]" : "bg-destructive/10 text-destructive border-destructive/20 mb-3 text-[10px]"}>
                      {copy.status === "available" ? "Sẵn sàng" : copy.status === "borrowed" ? "Đang mượn" : "Thất lạc"}
                    </Badge>
                    <Button size="sm" variant="secondary" className="w-full text-xs gap-1" onClick={() => handleDownloadQr(copy.qr_code)}>
                      <Download className="h-3 w-3" /> Tải mã
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
