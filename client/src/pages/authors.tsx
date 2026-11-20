import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, PenTool, Search, BookOpen } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { TablePagination } from "@/components/ui/table-pagination";

interface Author {
  id: number;
  name: string;
  bio: string;
  book_count?: number;
}

export default function AuthorsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "librarian";
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // Search & Pagination
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  
  // Form states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  const fetchAuthors = async (page = currentPage, query = search, limit = pageSize) => {
    setLoading(true);
    try {
      const response = await api.get(`/authors?page=${page}&limit=${limit}&search=${encodeURIComponent(query)}`);
      if (response.data && response.data.data) {
        setAuthors(response.data.data);
        setTotalCount(response.data.total || 0);
        setTotalPages(response.data.totalPages || 1);
        setCurrentPage(response.data.page || 1);
      } else if (Array.isArray(response.data)) {
        setAuthors(response.data);
        setTotalCount(response.data.length);
        setTotalPages(1);
      }
    } catch (error) {
      console.error("Lỗi khi tải tác giả:", error);
      toast.error("Không thể tải danh sách tác giả");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthors(currentPage, search, pageSize);
  }, [currentPage, pageSize]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPage === 1) {
      fetchAuthors(1, search, pageSize);
    } else {
      setCurrentPage(1);
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const resetForm = () => {
    setName("");
    setBio("");
    setIsEditMode(false);
    setCurrentId(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (author: Author) => {
    setName(author.name);
    setBio(author.bio || "");
    setCurrentId(author.id);
    setIsEditMode(true);
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Vui lòng nhập tên tác giả");
      return;
    }

    const actionText = isEditMode ? "cập nhật" : "thêm mới";
    confirm({
      title: `Xác nhận ${actionText} tác giả`,
      description: `Bạn có đồng ý chấp nhận ${actionText} tác giả "${name}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          if (isEditMode && currentId) {
            await api.put(`/authors/${currentId}`, { name, bio });
            toast.success("Cập nhật tác giả thành công");
          } else {
            await api.post("/authors", { name, bio });
            toast.success("Thêm tác giả thành công");
          }
          setIsDialogOpen(false);
          fetchAuthors(currentPage, search);
        } catch (error) {
          console.error("Lỗi khi lưu tác giả:", error);
          toast.error("Có lỗi xảy ra khi lưu");
        }
      }
    });
  };

  const handleDelete = (author: Author) => {
    const bookCount = author.book_count || 0;
    if (bookCount > 0) {
      toast.error(`Tác giả «${author.name}» đang có ${bookCount} đầu sách liên kết! Vui lòng chuyển sách sang tác giả khác trước khi xóa.`);
      return;
    }

    confirm({
      title: "Xác nhận xóa tác giả",
      description: `Bạn có đồng ý chấp nhận xóa tác giả "${author.name}" không? Thao tác này không thể hoàn tác.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/authors/${author.id}`);
          toast.success("Xóa tác giả thành công");
          fetchAuthors(currentPage, search);
        } catch (error: any) {
          console.error("Lỗi khi xóa tác giả:", error);
          toast.error(error.response?.data?.message || "Không thể xóa tác giả này");
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tác giả sách</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Quản lý danh bạ các tác giả, dịch giả trong kho lưu trữ thư viện.</p>
        </div>
        {canManage && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenAdd} className="gap-2 shadow-xs cursor-pointer">
                <Plus className="h-4 w-4" /> Thêm tác giả mới
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display">{isEditMode ? "Sửa thông tin tác giả" : "Thêm tác giả mới"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Tên tác giả *</label>
                  <Input placeholder="Ví dụ: Nguyễn Nhật Ánh, Dale Carnegie..." value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Tiểu sử tóm tắt</label>
                  <Input placeholder="Tiểu sử, phong cách sáng tác..." value={bio} onChange={(e) => setBio(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="cursor-pointer">Hủy</Button>
                  <Button type="submit" className="cursor-pointer">{isEditMode ? "Cập nhật" : "Thêm mới"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <PenTool className="h-4 w-4 text-primary" /> Danh sách Tác giả ({totalCount})
            </CardTitle>
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm tên tác giả..."
                  className="pl-8 h-8 text-xs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs cursor-pointer">
                Tìm
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : authors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">Chưa tìm thấy tác giả nào phù hợp.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Họ và Tên Tác giả</TableHead>
                      <TableHead>Tiểu sử tóm tắt</TableHead>
                      <TableHead className="w-32 text-center">Số đầu sách</TableHead>
                      {canManage && <TableHead className="w-24 text-right">Thao tác</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {authors.map((author) => (
                      <TableRow key={author.id}>
                        <TableCell className="font-mono text-xs">#{author.id}</TableCell>
                        <TableCell className="font-semibold text-xs text-foreground">{author.name}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{author.bio || "—"}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="font-medium text-[11px] gap-1 bg-primary/5 text-primary border-primary/20">
                            <BookOpen className="h-3 w-3" />
                            {author.book_count || 0} sách
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" onClick={() => handleOpenEdit(author)} title="Sửa tác giả">
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                                onClick={() => handleDelete(author)}
                                title={author.book_count ? `Đang có ${author.book_count} sách (không thể xóa)` : "Xóa tác giả"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              <TablePagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                itemName="tác giả"
              />
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
