import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, PenTool } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";

interface Author {
  id: number;
  name: string;
  bio: string;
}

export default function AuthorsPage() {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();
  
  // Form states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  const fetchAuthors = async () => {
    setLoading(true);
    try {
      const response = await api.get("/authors");
      setAuthors(response.data);
    } catch (error) {
      console.error("Lỗi khi tải tác giả:", error);
      toast.error("Không thể tải danh sách tác giả");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthors();
  }, []);

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
          fetchAuthors();
        } catch (error) {
          console.error("Lỗi khi lưu tác giả:", error);
          toast.error("Có lỗi xảy ra khi lưu");
        }
      }
    });
  };

  const handleDelete = (id: number, authorName: string) => {
    confirm({
      title: "Xác nhận xóa tác giả",
      description: `Bạn có đồng ý chấp nhận xóa tác giả "${authorName}" không? các đầu sách liên quan có thể bị ảnh hưởng.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/authors/${id}`);
          toast.success("Xóa tác giả thành công");
          fetchAuthors();
        } catch (error) {
          console.error("Lỗi khi xóa tác giả:", error);
          toast.error("Không thể xóa tác giả này");
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tác giả</h1>
          <p className="text-muted-foreground">Quản lý hồ sơ các tác giả của thư viện.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd} className="gap-2"><Plus className="h-4 w-4" /> Thêm tác giả</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">{isEditMode ? "Sửa tác giả" : "Thêm tác giả mới"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên tác giả *</label>
                <Input placeholder="Ví dụ: Nguyễn Nhật Ánh..." value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tiểu sử (tùy chọn)</label>
                <Input placeholder="Thông tin ngắn về tác giả..." value={bio} onChange={(e) => setBio(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Hủy</Button>
                <Button type="submit">{isEditMode ? "Cập nhật" : "Thêm mới"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <PenTool className="h-5 w-5 text-primary" /> Danh sách Tác giả
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : authors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Chưa có dữ liệu tác giả.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Tên Tác giả</TableHead>
                    <TableHead>Tiểu sử</TableHead>
                    <TableHead className="w-24 text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {authors.map((author) => (
                    <TableRow key={author.id}>
                      <TableCell className="font-medium">#{author.id}</TableCell>
                      <TableCell>{author.name}</TableCell>
                      <TableCell className="text-muted-foreground">{author.bio || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="icon" variant="ghost" onClick={() => handleOpenEdit(author)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(author.id, author.name)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
