import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Tag, Search, BookOpen } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { TablePagination } from "@/components/ui/table-pagination";

interface Category {
  id: number;
  name: string;
  description: string;
  book_count?: number;
}

export default function CategoriesPage() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "librarian";
  const [categories, setCategories] = useState<Category[]>([]);
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
  const [description, setDescription] = useState("");

  const fetchCategories = async (page = currentPage, query = search, limit = pageSize) => {
    setLoading(true);
    try {
      const response = await api.get(`/categories?page=${page}&limit=${limit}&search=${encodeURIComponent(query)}`);
      if (response.data && response.data.data) {
        setCategories(response.data.data);
        setTotalCount(response.data.total || 0);
        setTotalPages(response.data.totalPages || 1);
        setCurrentPage(response.data.page || 1);
      } else if (Array.isArray(response.data)) {
        setCategories(response.data);
        setTotalCount(response.data.length);
        setTotalPages(1);
      }
    } catch (error) {
      console.error("Lỗi khi tải thể loại:", error);
      toast.error("Không thể tải danh sách thể loại");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories(currentPage, search, pageSize);
  }, [currentPage, pageSize]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentPage === 1) {
      fetchCategories(1, search, pageSize);
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
    setDescription("");
    setIsEditMode(false);
    setCurrentId(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (category: Category) => {
    setName(category.name);
    setDescription(category.description || "");
    setCurrentId(category.id);
    setIsEditMode(true);
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Vui lòng nhập tên thể loại");
      return;
    }

    const actionText = isEditMode ? "cập nhật" : "thêm mới";
    confirm({
      title: `Xác nhận ${actionText} thể loại`,
      description: `Bạn có đồng ý chấp nhận ${actionText} thể loại "${name}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          if (isEditMode && currentId) {
            await api.put(`/categories/${currentId}`, { name, description });
            toast.success("Cập nhật thể loại thành công");
          } else {
            await api.post("/categories", { name, description });
            toast.success("Thêm thể loại thành công");
          }
          setIsDialogOpen(false);
          fetchCategories(currentPage, search);
        } catch (error) {
          console.error("Lỗi khi lưu thể loại:", error);
          toast.error("Có lỗi xảy ra khi lưu");
        }
      }
    });
  };

  const handleDelete = (category: Category) => {
    const bookCount = category.book_count || 0;
    if (bookCount > 0) {
      toast.error(`Thể loại «${category.name}» đang có ${bookCount} đầu sách liên kết! Vui lòng chuyển sách sang thể loại khác trước khi xóa.`);
      return;
    }

    confirm({
      title: "Xác nhận xóa thể loại",
      description: `Bạn có đồng ý chấp nhận xóa thể loại "${category.name}" không? Thao tác này không thể hoàn tác.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/categories/${category.id}`);
          toast.success("Xóa thể loại thành công");
          fetchCategories(currentPage, search);
        } catch (error: any) {
          console.error("Lỗi khi xóa thể loại:", error);
          toast.error(error.response?.data?.message || "Không thể xóa thể loại này");
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Thể loại sách</h1>
          <p className="text-muted-foreground text-xs sm:text-sm">Quản lý các danh mục và thể loại sách trong kho thư viện.</p>
        </div>
        {canManage && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenAdd} className="gap-2 shadow-xs cursor-pointer">
                <Plus className="h-4 w-4" /> Thêm thể loại mới
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="font-display">{isEditMode ? "Sửa thông tin thể loại" : "Thêm thể loại mới"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Tên thể loại *</label>
                  <Input placeholder="Ví dụ: Văn học, Khoa học & Công nghệ..." value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Mô tả chi tiết</label>
                  <Input placeholder="Mô tả tóm tắt về thể loại sách này..." value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <Tag className="h-4 w-4 text-primary" /> Danh sách Thể loại ({totalCount})
            </CardTitle>
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-sm w-full">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm thể loại..."
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
          ) : categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">Chưa tìm thấy thể loại nào phù hợp.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">ID</TableHead>
                      <TableHead>Tên Thể loại</TableHead>
                      <TableHead>Mô tả</TableHead>
                      <TableHead className="w-32 text-center">Số đầu sách</TableHead>
                      {canManage && <TableHead className="w-24 text-right">Thao tác</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categories.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-mono text-xs">#{cat.id}</TableCell>
                        <TableCell className="font-semibold text-xs text-foreground">{cat.name}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{cat.description || "—"}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="font-medium text-[11px] gap-1 bg-primary/5 text-primary border-primary/20">
                            <BookOpen className="h-3 w-3" />
                            {cat.book_count || 0} sách
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" onClick={() => handleOpenEdit(cat)} title="Sửa thể loại">
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                                onClick={() => handleDelete(cat)}
                                title={cat.book_count ? `Đang có ${cat.book_count} sách (không thể xóa)` : "Xóa thể loại"}
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
                itemName="thể loại"
              />
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
