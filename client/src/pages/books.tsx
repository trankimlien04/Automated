import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Plus, Search, QrCode, Filter, Star, Edit, Trash2, BookOpen, Download, CheckCircle2, BookmarkPlus, FileSpreadsheet, Upload, FileDown, AlertCircle, Info, Eye, Calendar, Building, FileText, Clock } from "lucide-react";
import * as XLSX from "xlsx";
import { useRef } from "react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { QRCodeCanvas } from "qrcode.react";

interface Book {
  id: number;
  title: string;
  author_id?: number;
  author_name?: string;
  publisher_id?: number;
  publisher_name?: string;
  category_id?: number;
  category_name?: string;
  isbn?: string;
  published_year?: number;
  description?: string;
  cover_image?: string;
  total_copies: number;
  available_copies: number;
}

export default function BooksPage() {
  const [booksList, setBooksList] = useState<Book[]>([]);
  const [q, setQ] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");
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

  // Excel Batch Import States
  const [isExcelDialogOpen, setIsExcelDialogOpen] = useState(false);
  const [excelParsedData, setExcelParsedData] = useState<any[]>([]);
  const [excelFileName, setExcelFileName] = useState("");
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [authors, setAuthors] = useState<{ id: number; name: string }[]>([]);
  const [publishers, setPublishers] = useState<{ id: number; name: string }[]>([]);

  // QR Code viewing state
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedBookForQr, setSelectedBookForQr] = useState<Book | null>(null);
  const [bookCopies, setBookCopies] = useState<any[]>([]);
  const [loadingQr, setLoadingQr] = useState(false);

  // Book Detail viewing state (Description, Metadata)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedBookForDetail, setSelectedBookForDetail] = useState<Book | null>(null);

  // Reader's active borrow requests and reservations state
  const [myBorrowRequests, setMyBorrowRequests] = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);

  const handleOpenBookDetail = (book: Book) => {
    setSelectedBookForDetail(book);
    setDetailDialogOpen(true);
  };

  // Download Sample Excel Template
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        "Tên sách": "Nhà Giả Kim",
        "Tác giả": "Paulo Coelho",
        "Thể loại": "Tiểu thuyết",
        "Nhà xuất bản": "NXB Hội Nhà Văn",
        "Mã ISBN": "978-604-1-88991-1",
        "Số lượng": 5,
        "Năm xuất bản": 2023,
        "Mô tả": "Tác phẩm kinh điển truyền cảm hứng về hành trình theo đuổi ước mơ."
      },
      {
        "Tên sách": "Nghệ Thuật Giao Tiếp Đỉnh Cao",
        "Tác giả": "Dale Carnegie",
        "Thể loại": "Kỹ năng & Phát triển",
        "Nhà xuất bản": "NXB Trẻ",
        "Mã ISBN": "978-604-1-77882-2",
        "Số lượng": 10,
        "Năm xuất bản": 2022,
        "Mô tả": "Nghệ thuật ứng xử và thu phục lòng người."
      },
      {
        "Tên sách": "Clean Code - Nghệ thuật viết mã sạch",
        "Tác giả": "Robert C. Martin",
        "Thể loại": "Khoa học & Công nghệ",
        "Nhà xuất bản": "NXB Tri Thức",
        "Mã ISBN": "978-013-2-35088-4",
        "Số lượng": 4,
        "Năm xuất bản": 2021,
        "Mô tả": "Cẩm nang hướng dẫn lập trình viên viết code sạch, dễ bảo trì."
      },
      {
        "Tên sách": "Tư Duy Nhanh Và Chậm",
        "Tác giả": "Daniel Kahneman",
        "Thể loại": "Kỹ năng & Phát triển",
        "Nhà xuất bản": "NXB Thế Giới",
        "Mã ISBN": "978-604-7-73892-0",
        "Số lượng": 6,
        "Năm xuất bản": 2020,
        "Mô tả": "Nghiên cứu về 2 hệ thống tư duy chi phối quyết định của con người."
      },
      {
        "Tên sách": "Học Sâu và Trí Tuệ Nhân Tạo",
        "Tác giả": "Ian Goodfellow",
        "Thể loại": "Khoa học & Công nghệ",
        "Nhà xuất bản": "NXB Tri Thức",
        "Mã ISBN": "978-026-2-03561-3",
        "Số lượng": 3,
        "Năm xuất bản": 2024,
        "Mô tả": "Giáo trình toàn diện về Deep Learning và Mạng nơ-ron nhân tạo."
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    // Set column widths
    worksheet["!cols"] = [
      { wch: 35 }, // Tên sách
      { wch: 20 }, // Tác giả
      { wch: 20 }, // Thể loại
      { wch: 20 }, // NXB
      { wch: 20 }, // ISBN
      { wch: 12 }, // Số lượng
      { wch: 14 }, // Năm XB
      { wch: 45 }, // Mô tả
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Mau_Nhap_Sach");
    XLSX.writeFile(workbook, "Mau_Nhap_Kho_Sach_Athenaeum.xlsx");
    toast.success("Đã tải file Excel mẫu về máy thành công!");
  };

  // Export current books list to Excel
  const handleExportToExcel = () => {
    if (filtered.length === 0) {
      toast.error("Không có dữ liệu sách để xuất file Excel");
      return;
    }

    const exportData = filtered.map((b, idx) => ({
      "STT": idx + 1,
      "Mã ID": b.id,
      "Tên đầu sách": b.title,
      "Tác giả": b.author_name || "Chưa cập nhật",
      "Thể loại": b.category_name || "Chưa cập nhật",
      "Mã ISBN": b.isbn || "Chưa cập nhật",
      "Tổng số bản sao": b.total_copies,
      "Bản sao còn sẵn": b.available_copies,
      "Mô tả": b.description || ""
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    worksheet["!cols"] = [
      { wch: 6 },
      { wch: 8 },
      { wch: 35 },
      { wch: 22 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 30 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Kho_Sach");
    XLSX.writeFile(workbook, `Danh_Sach_Kho_Sach_Athenaeum_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Đã xuất ${filtered.length} đầu sách ra file Excel thành công!`);
  };

  // Handle Excel/CSV file upload & parse
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (!rawJson || rawJson.length === 0) {
          toast.error("File Excel không có dữ liệu hoặc định dạng không đúng");
          return;
        }

        // Normalize rows
        const normalized = rawJson.map((row) => {
          const title = (row["Tên sách"] || row["Tên đầu sách"] || row["title"] || row["Title"] || row["name"] || "").toString().trim();
          const author = (row["Tác giả"] || row["author"] || row["Author"] || "").toString().trim();
          const category = (row["Thể loại"] || row["category"] || row["Category"] || "").toString().trim();
          const publisher = (row["Nhà xuất bản"] || row["NXB"] || row["publisher"] || row["Publisher"] || "").toString().trim();
          const isbn = (row["Mã ISBN"] || row["ISBN"] || row["isbn"] || "").toString().trim();
          const published_year = parseInt(row["Năm xuất bản"] || row["Năm XB"] || row["published_year"] || new Date().getFullYear(), 10) || new Date().getFullYear();
          const total_copies = parseInt(row["Số lượng"] || row["Số bản sao"] || row["total_copies"] || row["copies"] || 1, 10) || 1;
          const description = (row["Mô tả"] || row["description"] || "Sách nhập từ file Excel").toString().trim();

          return {
            title,
            author,
            category,
            publisher,
            isbn,
            published_year,
            total_copies,
            description
          };
        }).filter(item => item.title.length > 0);

        if (normalized.length === 0) {
          toast.error("Không tìm thấy dòng sách hợp lệ nào (Cần ít nhất cột 'Tên sách')");
          return;
        }

        setExcelParsedData(normalized);
        setIsExcelDialogOpen(true);
        toast.success(`Đã đọc thành công ${normalized.length} đầu sách từ file "${file.name}"`);
      } catch (err) {
        console.error("Lỗi đọc file Excel:", err);
        toast.error("Không thể đọc file Excel. Vui lòng kiểm tra định dạng file .xlsx hoặc .csv");
      } finally {
        // Reset file input value so user can pick same file again if needed
        if (e.target) e.target.value = "";
      }
    };

    reader.readAsBinaryString(file);
  };

  // Submit batch import to backend
  const handleConfirmBatchImport = async () => {
    if (excelParsedData.length === 0) {
      toast.error("Không có dữ liệu để nhập");
      return;
    }

    setIsSubmittingImport(true);
    try {
      const response = await api.post("/books/import-batch", { books: excelParsedData });
      toast.success(response.data.message || `Đã nhập thành công ${excelParsedData.length} đầu sách!`);
      setIsExcelDialogOpen(false);
      setExcelParsedData([]);
      setExcelFileName("");
      fetchBooks();
      fetchMetadata();
    } catch (error: any) {
      console.error("Lỗi nhập sách:", error);
      toast.error(error.response?.data?.message || "Lỗi khi nhập danh sách sách vào hệ thống");
    } finally {
      setIsSubmittingImport(false);
    }
  };

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const response = await api.get("/books");
      setBooksList(response.data || []);
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
      setCategories(catRes.data || []);
      setAuthors(authRes.data || []);
      setPublishers(pubRes.data || []);
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu phụ trợ:", error);
    }
  };

  const fetchUserStatus = async () => {
    try {
      const [reqRes, resvRes] = await Promise.all([
        api.get("/borrow/requests"),
        api.get("/reservations")
      ]);
      setMyBorrowRequests(reqRes.data || []);
      setMyReservations(resvRes.data || []);
    } catch (e) {
      console.error("Lỗi khi tải thông tin mượn / đặt trước:", e);
    }
  };

  useEffect(() => {
    fetchBooks();
    fetchMetadata();
    fetchUserStatus();
  }, [user]);

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
    const pngUrl = canvas.toDataURL("image/png");
    let downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = `${qrCodeStr}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    toast.success(`Đã tải ảnh mã QR (${qrCodeStr}.png) về máy`);
  };

  const handleRegisterBorrow = async (book: Book) => {
    const isAvailable = book.available_copies > 0;
    confirm({
      title: isAvailable ? "Đăng ký mượn online (Giữ chỗ 24h trước khi đến)?" : "Đặt trước cuốn sách này (Xếp hàng đợi)?",
      description: isAvailable
        ? `Bạn đang ở nhà và thích cuốn "${book.title}"?\n\n🛡️ Hệ thống sẽ TẠM GIỮ RIÊNG 1 cuốn này cho bạn trong vòng 24 giờ để người khác không mượn mất trong thời gian bạn đến thư viện.\n\n📍 Trong vòng 24h, bạn hãy đến thư viện, vào kệ lấy cuốn sách này mang ra quầy và xuất trình Thẻ độc giả QR để Thủ thư duyệt trao sách.`
        : `Đầu sách "${book.title}" hiện đã được các độc giả khác mượn hết (0 bản sao sẵn có trong kho).\n\nBạn có muốn đăng ký Đặt trước để xếp hàng không? Khi có độc giả hoàn trả sách về thư viện, hệ thống sẽ ưu tiên giữ sách 48h cho bạn và gửi thông báo hỏi bạn có muốn mượn không!`,
      confirmText: isAvailable ? "Xác nhận giữ chỗ (24h)" : "Xác nhận xếp hàng",
      cancelText: "Hủy bỏ",
      onConfirm: async () => {
        try {
          if (isAvailable) {
            const res = await api.post("/borrow/requests", { bookId: book.id });
            toast.success(res.data.message || "Đã giữ chỗ mượn sách online thành công trong 24 giờ!");
          } else {
            const res = await api.post("/reservations", { bookId: book.id });
            toast.success(res.data.message || "Đã ghi nhận đặt trước vào hàng đợi!");
          }
          fetchBooks();
          fetchUserStatus();
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Không thể thực hiện yêu cầu này");
        }
      }
    });
  };

  const handleAddBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Vui lòng nhập tên sách");
      return;
    }

    confirm({
      title: "Xác nhận thêm mới đầu sách",
      description: `Bạn có đồng ý thêm đầu sách "${newTitle}" với ${newCopies} bản sao vào hệ thống không?`,
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
      description: `Bạn có đồng ý xóa đầu sách "${bookTitle}" không? Các bản sao sách và mã QR tương ứng cũng sẽ bị xóa.`,
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

  // Filter books by search keyword and category
  const filtered = booksList.filter((b) => {
    const term = q.toLowerCase();
    const matchesQuery = !term || [b.title, b.isbn, b.author_name, b.category_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term);

    const matchesCategory =
      selectedCategoryFilter === "all" ||
      (b.category_id && b.category_id.toString() === selectedCategoryFilter) ||
      (b.category_name && b.category_name === selectedCategoryFilter);

    return matchesQuery && matchesCategory;
  });

  const canManage = user?.role === "admin" || user?.role === "librarian";

  // Summary counts
  const totalBooksCount = booksList.length;
  const totalCopiesCount = booksList.reduce((acc, b) => acc + (b.total_copies || 0), 0);
  const availableCopiesCount = booksList.reduce((acc, b) => acc + (b.available_copies || 0), 0);
  const borrowedCopiesCount = Math.max(0, totalCopiesCount - availableCopiesCount);

  return (
    <div className="space-y-6">
      {/* Top Overview Metric Cards: Sách & Bản sao QR */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tổng số đầu sách</p>
              <p className="text-2xl font-bold font-display text-primary mt-1">{loading ? "..." : totalBooksCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Tác phẩm trong thư viện</p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-blue-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tổng bản sao (Có mã QR)</p>
              <p className="text-2xl font-bold font-display text-blue-600 mt-1">{loading ? "..." : totalCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Cuốn sách vật lý trong kho</p>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600">
              <QrCode className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-emerald-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Bản sao sẵn sàng</p>
              <p className="text-2xl font-bold font-display text-emerald-600 mt-1">{loading ? "..." : availableCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Nằm trên kệ chờ mượn</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Bản sao đang cho mượn</p>
              <p className="text-2xl font-bold font-display text-amber-600 mt-1">{loading ? "..." : borrowedCopiesCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Độc giả đang giữ đọc</p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
              <Building className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Header filter controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input 
            value={q} 
            onChange={(e) => setQ(e.target.value)} 
            placeholder="Tìm theo tên sách, tác giả, thể loại, ISBN…" 
            className="pl-9 text-sm" 
          />
        </div>
        
        <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
          <SelectTrigger className="w-full md:w-52 text-xs">
            <SelectValue placeholder="Tất cả thể loại" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả thể loại</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Only Admin / Librarian can Export & Import Excel */}
        {canManage && (
          <>
            {/* Export Excel Button */}
            <Button 
              variant="outline" 
              onClick={handleExportToExcel}
              className="gap-2 shrink-0 border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/30"
              title="Xuất danh sách sách hiện tại ra file Excel"
            >
              <FileSpreadsheet className="h-4 w-4" /> Xuất Excel
            </Button>

            {/* Hidden file input for Excel upload */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
            />

            {/* Import Excel Trigger Button */}
            <Button 
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2 shrink-0 border-primary/40 text-primary hover:bg-primary/10"
              title="Tải file Excel để nhập sách hàng loạt"
            >
              <Upload className="h-4 w-4" /> Nhập file Excel
            </Button>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 shrink-0 shadow-xs">
                  <Plus className="h-4 w-4" /> Thêm sách mới
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display">Thêm đầu sách mới vào kho</DialogTitle>
                <DialogDescription className="text-xs">
                  Điền thông tin sách. Mã QR cho từng bản sao sẽ được hệ thống tự động sinh.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddBook} className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Tên đầu sách *</label>
                  <Input placeholder="Nhập tên sách..." value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required className="text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Mã ISBN</label>
                  <Input placeholder="VD: 978-604-1-15234-8" value={newIsbn} onChange={(e) => setNewIsbn(e.target.value)} className="text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Tác giả</label>
                    <Select value={selectedAuthor} onValueChange={setSelectedAuthor}>
                      <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn tác giả" /></SelectTrigger>
                      <SelectContent>
                        {authors.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Nhà xuất bản</label>
                    <Select value={selectedPublisher} onValueChange={setSelectedPublisher}>
                      <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn NXB" /></SelectTrigger>
                      <SelectContent>
                        {publishers.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Số lượng bản sao</label>
                    <Input placeholder="Số lượng" type="number" value={newCopies} onChange={(e) => setNewCopies(parseInt(e.target.value) || 1)} min={1} className="text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Thể loại</label>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="text-xs mt-1"><SelectValue placeholder="Chọn thể loại" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" className="w-full mt-2 font-semibold">Lưu & Sinh Mã QR Bản Sao</Button>
              </form>
            </DialogContent>
          </Dialog>
          </>
        )}
      </div>

      {/* Book cards grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border rounded-2xl bg-muted/20">
          <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="font-semibold text-sm">Không tìm thấy đầu sách nào phù hợp</p>
          <p className="text-xs text-muted-foreground mt-1">Hãy thử tìm kiếm với từ khóa khác hoặc bỏ bộ lọc</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((b) => (
            <Card key={b.id} className="group overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border flex flex-col justify-between">
              <div>
                {/* Book cover area */}
                <div 
                  onClick={() => handleOpenBookDetail(b)}
                  className="relative h-44 bg-gradient-to-br from-primary/10 via-accent/30 to-terracotta/10 overflow-hidden flex items-center justify-center cursor-pointer"
                  title="Nhấn để xem tóm tắt và chi tiết sách"
                >
                  {b.cover_image ? (
                    <img 
                      src={b.cover_image} 
                      alt={b.title} 
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" 
                    />
                  ) : (
                    <div className="text-5xl select-none">📚</div>
                  )}

                  <Badge className="absolute top-2.5 left-2.5 bg-background/90 text-foreground border-0 shadow-xs text-[10px]">
                    {b.category_name || "Mặc định"}
                  </Badge>

                  {canManage && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenQrDialog(b);
                      }} 
                      title="Quản lý mã QR in dán sách (Thủ thư)"
                      className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-background/90 shadow-sm transition-transform hover:scale-110 cursor-pointer text-foreground"
                    >
                      <QrCode className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <CardContent className="p-4 space-y-2.5">
                  <div>
                    <h3 
                      onClick={() => handleOpenBookDetail(b)}
                      className="font-display text-sm font-bold leading-snug line-clamp-1 group-hover:text-primary transition-colors cursor-pointer"
                      title={b.title}
                    >
                      {b.title}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      ✍️ {b.author_name || "Khuyết danh"}
                    </p>
                  </div>

                  {/* Book description preview */}
                  <div 
                    onClick={() => handleOpenBookDetail(b)}
                    className="cursor-pointer bg-muted/40 hover:bg-muted/70 p-2 rounded-lg border border-border/50 transition-colors"
                    title="Nhấn để xem đầy đủ nội dung tóm tắt"
                  >
                    <p className="text-[11px] text-muted-foreground line-clamp-2 italic leading-relaxed">
                      {b.description ? `“${b.description}”` : "Chưa có mô tả tóm tắt. Bấm để xem chi tiết."}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t">
                    <div className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-semibold text-[11px]">4.8</span>
                    </div>
                    <span className={b.available_copies > 0 ? "text-emerald-600 font-semibold text-[11px]" : "text-destructive font-semibold text-[11px]"}>
                      {b.available_copies > 0 ? `Còn ${b.available_copies}/${b.total_copies} cuốn` : "Đã hết sách"}
                    </span>
                  </div>

                  {user?.role !== "reader" && (() => {
                    const bookHoldCount = myBorrowRequests.filter(r => r.book_id === b.id && r.status === 'pending').length;
                    if (bookHoldCount <= 0) return null;
                    return (
                      <div className="pt-0.5">
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold gap-1 w-full justify-center">
                          <Clock className="h-3 w-3 text-amber-600" />
                          Có {bookHoldCount} cuốn đang giữ chỗ 24h
                        </Badge>
                      </div>
                    );
                  })()}

                  <p className="font-mono text-[10px] text-muted-foreground truncate">
                    ISBN: {b.isbn || "Chưa cập nhật"}
                  </p>
                </CardContent>
              </div>

              {/* Card action buttons */}
              <div className="p-4 pt-0 space-y-2">
                {user?.role === "reader" ? (
                  <div className="space-y-1.5">
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 h-8 font-medium"
                      onClick={() => handleOpenBookDetail(b)}
                    >
                      <Eye className="h-3.5 w-3.5" /> Xem chi tiết
                    </Button>
                    
                    {/* Kiểm tra trạng thái đã đăng ký mượn hoặc đã đặt trước */}
                    {myBorrowRequests.some(r => r.book_id === b.id && r.status === 'pending') ? (
                      <Button 
                        size="sm" 
                        variant="outline"
                        disabled
                        className="w-full text-xs gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold h-8 cursor-default"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> 
                        Đã giữ chỗ 24h (Chờ nhận)
                      </Button>
                    ) : myReservations.some(r => r.book_id === b.id && ['waiting', 'pending', 'notified', 'ready', 'accepted'].includes(r.status)) ? (
                      <Button 
                        size="sm" 
                        variant="outline"
                        disabled
                        className="w-full text-xs gap-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold h-8 cursor-default"
                      >
                        <Clock className="h-3.5 w-3.5 text-amber-600" /> 
                        Đang đặt trước sách
                      </Button>
                    ) : b.available_copies > 0 ? (
                      <Button 
                        size="sm" 
                        className="w-full text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs h-8"
                        title="Đăng ký giữ chỗ cuốn sách này trong 24 giờ trước khi đến lấy"
                        onClick={() => handleRegisterBorrow(b)}
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" /> 
                        Đăng ký mượn online
                      </Button>
                    ) : (
                      <Button 
                        size="sm" 
                        className="w-full text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs h-8 animate-in fade-in"
                        title="Đầu sách đã hết bản sao, bấm để xếp hàng đặt trước khi có sách hoàn trả"
                        onClick={() => handleRegisterBorrow(b)}
                      >
                        <Clock className="h-3.5 w-3.5" /> 
                        Hết sách • Đặt trước
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 h-8 font-medium"
                      onClick={() => handleOpenBookDetail(b)}
                    >
                      <Eye className="h-3.5 w-3.5" /> Xem chi tiết
                    </Button>
                    <Button 
                      size="sm" 
                      variant="secondary" 
                      className="w-full text-xs gap-1.5 shadow-xs h-8"
                      onClick={() => handleOpenQrDialog(b)}
                    >
                      <QrCode className="h-3.5 w-3.5" /> Quản lý mã QR bản sao
                    </Button>
                  </div>
                )}

                {canManage && (
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                    <Button size="sm" variant="ghost" className="flex-1 text-xs h-7 gap-1 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteBook(b.id, b.title)}>
                      <Trash2 className="h-3 w-3" /> Xóa đầu sách
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog for QR Codes */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" /> Mã QR Bản Sao Đầu Sách
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedBookForQr?.title} ({selectedBookForQr?.category_name || "Sách thư viện"})
            </DialogDescription>
          </DialogHeader>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-foreground">💡 Trạng thái các bản sao trong kho:</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="bg-background text-xs font-semibold">
                  Tổng: {bookCopies.length} bản sao
                </Badge>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-300 text-xs">
                  Sẵn sàng: {bookCopies.filter(c => c.status === 'available').length}
                </Badge>
                {selectedBookForQr && (() => {
                  const holds = myBorrowRequests.filter(r => r.book_id === selectedBookForQr.id && r.status === 'pending');
                  if (holds.length === 0) return null;
                  return (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-400/40 text-xs font-semibold gap-1">
                      <Clock className="h-3 w-3 text-amber-600" /> Giữ chỗ 24h: {holds.length}
                    </Badge>
                  );
                })()}
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-300 text-xs">
                  Đang mượn: {bookCopies.filter(c => c.status === 'borrowed').length}
                </Badge>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">• Mỗi bản sao sách trong kho có 1 mã QR độc lập dán trên bìa/gáy sách để phục vụ kiểm kê và mượn trả.</p>
          </div>

          {selectedBookForQr && (() => {
            const holds = myBorrowRequests.filter(r => r.book_id === selectedBookForQr.id && r.status === 'pending');
            if (holds.length === 0) return null;
            return (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs space-y-2 mt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-amber-600" /> Bạn đọc đang giữ chỗ 24h ({holds.length} yêu cầu):
                  </span>
                  <span className="text-[10px] text-muted-foreground">Kho đã tự tạm trừ {holds.length} cuốn sẵn có</span>
                </div>
                <div className="space-y-1.5">
                  {holds.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-background/90 border text-xs shadow-2xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">👤 {r.reader_name}</span>
                        <Badge variant="outline" className="font-mono text-[10px] bg-primary/5 text-primary border-primary/20">{r.card_number}</Badge>
                        {r.reader_phone && <span className="text-[10px] text-muted-foreground font-mono">📞 {r.reader_phone}</span>}
                      </div>
                      <Badge variant="outline" className="text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                        ⏱️ Còn {Math.max(1, (r.time_left_hours !== null && r.time_left_hours !== undefined) ? r.time_left_hours : 24)} giờ
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="py-2">
            {loadingQr ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : bookCopies.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Chưa có bản sao nào cho đầu sách này.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {bookCopies.map((copy: any, index: number) => {
                  const isAvailable = copy.status === "available";
                  return (
                    <div 
                      key={copy.id} 
                      className={`flex flex-col items-center p-3.5 border rounded-xl transition ${
                        isAvailable ? "bg-card border-primary/20 shadow-xs" : "bg-muted/30 border-dashed opacity-75"
                      }`}
                    >
                      <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                        Bản sao #{index + 1}
                      </div>
                      <div className="bg-white p-2 rounded-lg shadow-sm mb-2 border">
                        <QRCodeCanvas 
                          id={`qr-canvas-${copy.qr_code}`}
                          value={copy.qr_code} 
                          size={125} 
                          level={"H"}
                          includeMargin={true}
                        />
                      </div>
                      <p className="text-[10px] font-mono text-center break-all mb-2 font-semibold text-foreground">{copy.qr_code}</p>
                      
                      <Badge 
                        variant="outline" 
                        className={isAvailable ? "bg-success/10 text-success border-success/20 mb-2.5 text-[10px]" : "bg-destructive/10 text-destructive border-destructive/20 mb-2.5 text-[10px]"}
                      >
                        {isAvailable ? "✓ Sẵn sàng" : copy.status === "borrowed" ? "Đang mượn" : "Thất lạc"}
                      </Badge>

                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="w-full text-xs gap-1.5 h-8 shadow-xs" 
                        onClick={() => handleDownloadQr(copy.qr_code)}
                      >
                        <Download className="h-3.5 w-3.5" /> Tải mã in
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Preview & Confirm Import Excel */}
      <Dialog open={isExcelDialogOpen} onOpenChange={setIsExcelDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="font-display flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" /> Xem trước & Xác nhận nhập kho sách từ Excel
              </DialogTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="text-xs gap-1.5 h-8 border-emerald-500/30 text-emerald-600 hover:bg-emerald-50"
              >
                <FileDown className="h-3.5 w-3.5" /> Tải file mẫu (.xlsx)
              </Button>
            </div>
            <DialogDescription className="text-xs">
              File: <span className="font-semibold text-foreground">{excelFileName}</span> — Hệ thống tự động liên kết Tác giả, Thể loại, NXB và tự động sinh mã QR cho từng bản sao.
            </DialogDescription>
          </DialogHeader>

          {/* Quick summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-2 text-xs">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
              <span className="text-muted-foreground block text-[11px]">Tổng số đầu sách</span>
              <span className="text-lg font-bold text-primary">{excelParsedData.length}</span> đầu sách
            </div>
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
              <span className="text-muted-foreground block text-[11px]">Tổng số bản sao sách</span>
              <span className="text-lg font-bold text-emerald-600">
                {excelParsedData.reduce((acc, curr) => acc + (curr.total_copies || 1), 0)}
              </span> cuốn (có mã QR)
            </div>
            <div className="col-span-2 sm:col-span-1 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
              <span className="text-muted-foreground block text-[11px]">Trạng thái dữ liệu</span>
              <span className="text-xs font-semibold text-amber-600 flex items-center gap-1 mt-1">
                <CheckCircle2 className="h-4 w-4" /> Sẵn sàng nạp kho
              </span>
            </div>
          </div>

          {/* Table preview */}
          <div className="flex-1 overflow-y-auto border rounded-xl max-h-[320px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-muted/60 sticky top-0 border-b text-[11px] font-semibold text-muted-foreground">
                <tr>
                  <th className="p-2.5 pl-3">#</th>
                  <th className="p-2.5">Tên đầu sách</th>
                  <th className="p-2.5">Tác giả</th>
                  <th className="p-2.5">Thể loại</th>
                  <th className="p-2.5">Nhà xuất bản</th>
                  <th className="p-2.5">Mã ISBN</th>
                  <th className="p-2.5 text-center">Số bản sao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {excelParsedData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/30 transition-colors">
                    <td className="p-2.5 pl-3 font-mono text-[10px] text-muted-foreground">{idx + 1}</td>
                    <td className="p-2.5 font-medium max-w-[200px] truncate" title={item.title}>
                      {item.title}
                    </td>
                    <td className="p-2.5 text-muted-foreground max-w-[130px] truncate">{item.author || "—"}</td>
                    <td className="p-2.5">
                      <Badge variant="outline" className="text-[10px] font-normal py-0">
                        {item.category || "Chung"}
                      </Badge>
                    </td>
                    <td className="p-2.5 text-muted-foreground max-w-[130px] truncate">{item.publisher || "—"}</td>
                    <td className="p-2.5 font-mono text-[10px] text-muted-foreground">{item.isbn || "—"}</td>
                    <td className="p-2.5 text-center">
                      <span className="font-semibold text-primary">{item.total_copies || 1}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between pt-3 border-t mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmittingImport}
              className="text-xs"
            >
              Chọn file Excel khác
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsExcelDialogOpen(false)}
                disabled={isSubmittingImport}
                className="text-xs"
              >
                Hủy
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmBatchImport}
                disabled={isSubmittingImport}
                className="text-xs gap-1.5 font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isSubmittingImport ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Đang nạp dữ liệu...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Xác nhận nhập {excelParsedData.length} đầu sách
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog View Full Book Details & Description */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedBookForDetail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-xs">
                    {selectedBookForDetail.category_name || "Tài liệu thư viện"}
                  </Badge>
                  <span className={selectedBookForDetail.available_copies > 0 ? "text-emerald-600 font-semibold text-xs flex items-center gap-1" : "text-destructive font-semibold text-xs flex items-center gap-1"}>
                    <span className={`h-2 w-2 rounded-full ${selectedBookForDetail.available_copies > 0 ? "bg-emerald-500" : "bg-destructive"}`} />
                    {selectedBookForDetail.available_copies > 0 ? `Còn ${selectedBookForDetail.available_copies}/${selectedBookForDetail.total_copies} cuốn sẵn sàng` : "Tạm hết sách"}
                  </span>
                </div>
                <DialogTitle className="font-display text-xl leading-snug">
                  {selectedBookForDetail.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Tác phẩm của tác giả <span className="font-semibold text-foreground">{selectedBookForDetail.author_name || "Khuyết danh"}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-3">
                {/* Book Cover */}
                <div className="flex flex-col items-center">
                  <div className="w-full h-52 bg-gradient-to-br from-primary/10 via-accent/20 to-terracotta/10 rounded-xl overflow-hidden border flex items-center justify-center shadow-sm">
                    {selectedBookForDetail.cover_image ? (
                      <img 
                        src={selectedBookForDetail.cover_image} 
                        alt={selectedBookForDetail.title} 
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-6xl select-none">📚</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="font-bold text-foreground">4.8 / 5.0</span>
                    <span>(Độc giả đánh giá)</span>
                  </div>
                </div>

                {/* Metadata & Description */}
                <div className="md:col-span-2 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-3 rounded-xl border">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">✍️ Tác giả:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.author_name || "Khuyết danh"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">🏢 Nhà xuất bản:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.publisher_name || "Chưa cập nhật"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">🔢 Mã ISBN:</span>
                      <span className="font-mono text-foreground font-semibold">{selectedBookForDetail.isbn || "Chưa có"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">📅 Năm xuất bản:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.published_year || "Chưa cập nhật"}</span>
                    </div>
                  </div>

                  {/* Full Description Box */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <FileText className="h-4 w-4 text-primary" />
                      <span>Mô tả & Tóm tắt nội dung sách:</span>
                    </div>
                    <div className="bg-background border rounded-xl p-3.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-44 overflow-y-auto">
                      {selectedBookForDetail.description ? (
                        <p className="text-foreground/90 font-normal">
                          {selectedBookForDetail.description}
                        </p>
                      ) : (
                        <p className="italic text-muted-foreground">
                          Đầu sách này hiện chưa có đoạn văn tóm tắt chi tiết. Bạn có thể liên hệ thủ thư để biết thêm thông tin.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailDialogOpen(false)}
                  className="text-xs"
                >
                  Đóng
                </Button>

                <div className="flex gap-2">
                  {user?.role === "reader" ? (
                    <Button
                      size="sm"
                      className="text-xs gap-1.5 bg-primary text-primary-foreground font-semibold"
                      disabled={selectedBookForDetail.available_copies <= 0}
                      onClick={() => {
                        setDetailDialogOpen(false);
                        handleRegisterBorrow(selectedBookForDetail);
                      }}
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" />
                      {selectedBookForDetail.available_copies > 0 ? "Đăng ký mượn cuốn này" : "Tạm hết sách"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs gap-1.5"
                      onClick={() => {
                        setDetailDialogOpen(false);
                        handleOpenQrDialog(selectedBookForDetail);
                      }}
                    >
                      <QrCode className="h-3.5 w-3.5" /> Quản lý mã QR bản sao
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
