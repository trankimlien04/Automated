import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Building2 } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";

interface Publisher {
  id: number;
  name: string;
  address: string;
  contact_email: string;
}

export default function PublishersPage() {
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();
  
  // Form states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");

  const fetchPublishers = async () => {
    setLoading(true);
    try {
      const response = await api.get("/publishers");
      setPublishers(response.data);
    } catch (error) {
      console.error("Lỗi khi tải nhà xuất bản:", error);
      toast.error("Không thể tải danh sách nhà xuất bản");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPublishers();
  }, []);

  const resetForm = () => {
    setName("");
    setAddress("");
    setEmail("");
    setIsEditMode(false);
    setCurrentId(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (pub: Publisher) => {
    setName(pub.name);
    setAddress(pub.address || "");
    setEmail(pub.contact_email || "");
    setCurrentId(pub.id);
    setIsEditMode(true);
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Vui lòng nhập tên nhà xuất bản");
      return;
    }

    const actionText = isEditMode ? "cập nhật" : "thêm mới";
    confirm({
      title: `Xác nhận ${actionText} nhà xuất bản`,
      description: `Bạn có đồng ý chấp nhận ${actionText} nhà xuất bản "${name}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const payload = { name, address, contact_email: email };
          if (isEditMode && currentId) {
            await api.put(`/publishers/${currentId}`, payload);
            toast.success("Cập nhật nhà xuất bản thành công");
          } else {
            await api.post("/publishers", payload);
            toast.success("Thêm nhà xuất bản thành công");
          }
          setIsDialogOpen(false);
          fetchPublishers();
        } catch (error) {
          console.error("Lỗi khi lưu nhà xuất bản:", error);
          toast.error("Có lỗi xảy ra khi lưu");
        }
      }
    });
  };

  const handleDelete = (id: number, pubName: string) => {
    confirm({
      title: "Xác nhận xóa nhà xuất bản",
      description: `Bạn có đồng ý chấp nhận xóa nhà xuất bản "${pubName}" không? Các sách liên quan có thể bị ảnh hưởng.`,
      confirmText: "Đồng ý xóa",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/publishers/${id}`);
          toast.success("Xóa nhà xuất bản thành công");
          fetchPublishers();
        } catch (error) {
          console.error("Lỗi khi xóa nhà xuất bản:", error);
          toast.error("Không thể xóa nhà xuất bản này");
        }
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nhà xuất bản</h1>
          <p className="text-muted-foreground">Quản lý đối tác và các nhà xuất bản sách.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleOpenAdd} className="gap-2"><Plus className="h-4 w-4" /> Thêm nhà xuất bản</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">{isEditMode ? "Sửa nhà xuất bản" : "Thêm nhà xuất bản mới"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="grid gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tên nhà xuất bản *</label>
                <Input placeholder="Ví dụ: NXB Trẻ..." value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Địa chỉ</label>
                <Input placeholder="Nhập địa chỉ..." value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email liên hệ</label>
                <Input type="email" placeholder="example@publisher.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
            <Building2 className="h-5 w-5 text-primary" /> Danh sách Nhà xuất bản
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : publishers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Chưa có dữ liệu nhà xuất bản.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Tên NXB</TableHead>
                    <TableHead>Địa chỉ</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-24 text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {publishers.map((pub) => (
                    <TableRow key={pub.id}>
                      <TableCell className="font-medium">#{pub.id}</TableCell>
                      <TableCell>{pub.name}</TableCell>
                      <TableCell className="text-muted-foreground">{pub.address || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{pub.contact_email || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button size="icon" variant="ghost" onClick={() => handleOpenEdit(pub)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(pub.id, pub.name)}>
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
