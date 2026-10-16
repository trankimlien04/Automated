import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Mail, Phone, Lock, Unlock, Plus, UserPlus, ShieldAlert } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import { isValidEmail, isValidPhone, sanitizePhoneInput, validateEmailInput, validatePhoneInput } from "@/lib/validators";

interface User {
  id: number;
  full_name: string;
  email: string;
  role: string;
  phone?: string;
  avatar_url?: string;
  card_number?: string;
  status: "active" | "locked" | "pending";
  created_at: string;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  active: { label: "Hoạt động", cls: "bg-success/15 text-success border-success/20" },
  locked: { label: "Đã khóa", cls: "bg-destructive/15 text-destructive border-destructive/20" },
  pending: { label: "Chờ duyệt", cls: "bg-warning/15 text-warning border-warning/30" },
};

const roleMap: Record<string, string> = {
  owner: "Chủ thư viện",
  admin: "Quản trị viên",
  librarian: "Thủ thư",
  reader: "Độc giả",
};

export default function AccountsPage() {
  const [usersList, setUsersList] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // Create account states
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState("librarian"); // Defaults to Librarian

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get("/users");
      setUsersList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải tài khoản:", error);
      toast.error("Không thể tải danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleUpdateStatus = (id: number, fullName: string, newStatus: string) => {
    const actionName = newStatus === "active" ? "mở khóa" : "khóa";
    const title = newStatus === "active" ? "Xác nhận mở khóa tài khoản" : "Xác nhận khóa tài khoản";
    
    confirm({
      title: title,
      description: `Bạn có đồng ý chấp nhận ${actionName} tài khoản của "${fullName}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      variant: newStatus === "locked" ? "destructive" : "default",
      onConfirm: async () => {
        try {
          await api.put(`/users/${id}/status`, { status: newStatus });
          toast.success("Cập nhật trạng thái tài khoản thành công!");
          fetchUsers();
        } catch (error) {
          console.error("Lỗi khi cập nhật trạng thái:", error);
          toast.error("Lỗi khi cập nhật trạng thái");
        }
      }
    });
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      toast.error("Vui lòng nhập đầy đủ các thông tin bắt buộc");
      return;
    }

    const emailErr = validateEmailInput(newEmail);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }

    const phoneErr = validatePhoneInput(newPhone, false);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }

    confirm({
      title: "Xác nhận tạo tài khoản",
      description: `Bạn có đồng ý tạo tài khoản ${roleMap[newRole]} cho "${newName}" không?`,
      confirmText: "Đồng ý",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await api.post("/users", {
            fullName: newName.trim(),
            email: newEmail.trim(),
            password: newPassword,
            role: newRole,
            phone: newPhone ? newPhone.trim() : null,
          });

          toast.success(`Tạo tài khoản ${roleMap[newRole]} thành công!`);
          setIsDialogOpen(false);
          
          // Reset form fields
          setNewName("");
          setNewEmail("");
          setNewPassword("");
          setNewPhone("");
          setNewRole("librarian");
          
          fetchUsers();
        } catch (error: any) {
          console.error("Lỗi khi tạo tài khoản:", error);
          const errMsg = error.response?.data?.message || "Lỗi khi tạo tài khoản mới";
          toast.error(errMsg);
        }
      }
    });
  };

  const filtered = usersList.filter((u) => {
    const matchesSearch = [u.full_name, u.email, u.card_number].join(" ").toLowerCase().includes(q.toLowerCase());
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Tổng số tài khoản", value: usersList.length.toString(), sub: "Toàn bộ tài khoản hệ thống" },
          { label: "Quản trị viên (Admin)", value: usersList.filter(u => u.role === 'admin').length.toString(), sub: "Tài khoản quản trị hệ thống" },
          { label: "Thủ thư (Librarian)", value: usersList.filter(u => u.role === 'librarian').length.toString(), sub: "Tài khoản thủ thư thư viện" },
          { label: "Độc giả (Reader)", value: usersList.filter(u => u.role === 'reader').length.toString(), sub: "Tài khoản người mượn sách" },
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
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
            <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center max-w-2xl">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Tìm theo tên, email, số thẻ…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Lọc theo vai trò" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả vai trò</SelectItem>
                  <SelectItem value="owner">Chủ thư viện (Owner)</SelectItem>
                  <SelectItem value="admin">Quản trị viên (Admin)</SelectItem>
                  <SelectItem value="librarian">Thủ thư (Librarian)</SelectItem>
                  <SelectItem value="reader">Độc giả (Reader)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 shrink-0">
                  <UserPlus className="h-4 w-4" /> Thêm tài khoản mặc định
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">Tạo tài khoản mới</DialogTitle>
                  <DialogDescription>
                    Tạo tài khoản mặc định cho Thủ thư để đăng nhập quản lý hoặc cấp tài khoản Độc giả trực tiếp.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateAccount} className="grid gap-3 mt-2">
                  <Input placeholder="Họ và tên" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                  <div>
                    <Input placeholder="Email đăng nhập" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                    {newEmail && !isValidEmail(newEmail) && (
                      <p className="text-[11px] text-destructive mt-1">Email không đúng định dạng (Ví dụ: user@example.com)</p>
                    )}
                  </div>
                  <Input placeholder="Mật khẩu đăng nhập mặc định" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  <div>
                    <Input 
                      placeholder="Số điện thoại (10 chữ số, VD: 0901234567)" 
                      type="tel"
                      value={newPhone} 
                      maxLength={10}
                      onChange={(e) => setNewPhone(sanitizePhoneInput(e.target.value))} 
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Chỉ nhập số, không được ghi chữ</p>
                    {newPhone && !isValidPhone(newPhone) && (
                      <p className="text-[11px] text-destructive mt-0.5">Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0</p>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="text-xs text-muted-foreground">Vai trò</label>
                    <Select value={newRole} onValueChange={setNewRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn vai trò" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Chủ thư viện / Giám đốc (Owner)</SelectItem>
                        <SelectItem value="librarian">Thủ thư (Librarian)</SelectItem>
                        <SelectItem value="reader">Độc giả (Reader)</SelectItem>
                        <SelectItem value="admin">Quản trị viên (Admin)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button type="submit" className="mt-2">Lưu tài khoản & Kích hoạt</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Tên người dùng</TableHead>
                  <TableHead>Mã số thẻ</TableHead>
                  <TableHead>Liên hệ</TableHead>
                  <TableHead>Vai trò</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-40 text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                            {r.full_name.split(" ").slice(-1)[0][0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-sm">{r.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            Tham gia {new Date(r.created_at).toLocaleDateString("vi-VN")}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.card_number || "Chưa cấp"}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="flex items-center gap-1.5 text-xs">
                          <Mail className="h-3 w-3 text-muted-foreground" /> {r.email}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" /> {r.phone || "Không có"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${
                        r.role === 'admin' ? 'border-destructive text-destructive bg-destructive/5' : 
                        r.role === 'librarian' ? 'border-primary text-primary bg-primary/5' : ''
                      }`}>
                        {roleMap[r.role] || r.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusMap[r.status]?.cls || ""}>
                        {statusMap[r.status]?.label || r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {r.id !== user?.id && r.role !== 'admin' && (
                          <>
                            {r.status === "active" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-destructive hover:bg-destructive/10 text-destructive h-8 gap-1"
                                onClick={() => handleUpdateStatus(r.id, r.full_name, "locked")}
                              >
                                <Lock className="h-3.5 w-3.5" /> Khóa
                              </Button>
                            )}
                            {r.status === "locked" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-success hover:bg-success/10 text-success h-8 gap-1"
                                onClick={() => handleUpdateStatus(r.id, r.full_name, "active")}
                              >
                                <Unlock className="h-3.5 w-3.5" /> Mở khóa
                              </Button>
                            )}
                          </>
                        )}
                        {r.role === 'admin' && r.id !== user?.id && (
                          <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                            <ShieldAlert className="h-3 w-3" /> Admin tối cao
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  );
}
