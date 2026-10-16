import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  User, 
  KeyRound, 
  CreditCard, 
  QrCode, 
  Shield, 
  Crown, 
  BookOpen, 
  CheckCircle2, 
  Phone, 
  Mail, 
  Calendar, 
  Sparkles,
  Award,
  Wallet,
  Clock,
  Save,
  Check,
  ArrowRight
} from "lucide-react";
import { Link } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { isValidPhone, sanitizePhoneInput, validatePhoneInput } from "@/lib/validators";

interface UserProfile {
  id: number;
  full_name: string;
  email: string;
  role: "admin" | "librarian" | "reader" | "owner";
  phone?: string;
  avatar_url?: string;
  card_number?: string;
  card_expiry?: string;
  status: "active" | "locked" | "pending";
  created_at: string;
}

const ROLE_INFO: Record<string, { label: string; badgeCls: string; cardGradient: string; icon: any; title: string }> = {
  owner: {
    label: "Chủ thư viện / Giám đốc",
    badgeCls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    cardGradient: "from-amber-600 via-amber-800 to-slate-900 text-white shadow-amber-500/10",
    icon: Crown,
    title: "Thẻ Ban Lãnh Đạo & Giám Sát Tối Cao"
  },
  admin: {
    label: "Quản trị viên (Admin)",
    badgeCls: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
    cardGradient: "from-indigo-600 via-indigo-900 to-slate-900 text-white shadow-indigo-500/10",
    icon: Shield,
    title: "Thẻ Quản Trị Hệ Thống Toàn Quyền"
  },
  librarian: {
    label: "Thủ thư chuyên trách",
    badgeCls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    cardGradient: "from-emerald-600 via-teal-900 to-slate-900 text-white shadow-emerald-500/10",
    icon: BookOpen,
    title: "Thẻ Công Vụ Nghiệp Vụ Thủ Thư"
  },
  reader: {
    label: "Độc giả thành viên",
    badgeCls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    cardGradient: "from-blue-600 via-indigo-800 to-slate-900 text-white shadow-blue-500/10",
    icon: CreditCard,
    title: "Thẻ Thư Viện Điện Tử Thông Minh"
  },
};

export default function ProfilePage() {
  const { user: authUser, login } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  // Edit Profile Form State
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Change Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const response = await api.get("/users/profile/me");
      const { user, stats: userStats } = response.data;
      setProfile(user);
      setStats(userStats || {});
      setFullName(user.full_name || "");
      setPhone(user.phone || "");
      setAvatarUrl(user.avatar_url || "");
    } catch (error) {
      console.error("Lỗi khi tải thông tin cá nhân:", error);
      toast.error("Không thể tải thông tin cá nhân");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Họ và tên không được để trống");
      return;
    }

    const phoneErr = validatePhoneInput(phone, false);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }

    setSavingProfile(true);
    try {
      const response = await api.put("/users/profile/me", {
        full_name: fullName.trim(),
        phone: phone ? phone.trim() : null,
        avatar_url: avatarUrl
      });
      toast.success(response.data.message || "Cập nhật thông tin thành công!");
      
      // Update local storage auth user
      if (profile && authUser) {
        const updatedAuth = { ...authUser, fullName: fullName };
        login(localStorage.getItem("token") || "", updatedAuth);
      }
      fetchProfile();
    } catch (error: any) {
      const msg = error.response?.data?.message || "Lỗi khi cập nhật thông tin";
      toast.error(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Vui lòng điền đầy đủ các trường mật khẩu");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Xác nhận mật khẩu mới không khớp");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await api.put("/users/profile/change-password", {
        currentPassword,
        newPassword
      });
      toast.success(response.data.message || "Đổi mật khẩu thành công!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      const msg = error.response?.data?.message || "Lỗi khi đổi mật khẩu";
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Không tìm thấy thông tin tài khoản.
      </div>
    );
  }

  const roleMeta = ROLE_INFO[profile.role] || ROLE_INFO.reader;
  const RoleIcon = roleMeta.icon;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* 1. Header Banner & Smart Digital ID Card */}
      <div className="grid gap-6 lg:grid-cols-12 items-stretch">
        {/* Left: Smart Digital ID Card */}
        <div className="lg:col-span-6 flex">
          <div className={`w-full rounded-2xl bg-gradient-to-br ${roleMeta.cardGradient} p-6 md:p-8 shadow-xl relative overflow-hidden flex flex-col justify-between border border-white/15 backdrop-blur-md`}>
            {/* Background Holographic Shapes */}
            <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-white/10 blur-2xl pointer-events-none" />
            <div className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full bg-black/20 blur-2xl pointer-events-none" />

            {/* Card Header */}
            <div className="relative z-10 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
                  <RoleIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg tracking-wider text-white">ATHENAEUM</h3>
                  <p className="text-[10px] tracking-widest uppercase text-white/75">{roleMeta.title}</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-white/15 text-white border-white/30 text-[11px] font-medium backdrop-blur-md">
                {profile.status === "active" ? "ĐANG HOẠT ĐỘNG" : profile.status.toUpperCase()}
              </Badge>
            </div>

            {/* Card Chip & QR Code Section */}
            <div className="relative z-10 my-6 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                {/* Chip Mockup */}
                <div className="w-12 h-9 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 border border-amber-300 shadow-sm flex items-center justify-center overflow-hidden">
                  <div className="w-full h-[1px] bg-amber-600/40 my-1" />
                  <div className="w-[1px] h-full bg-amber-600/40 mx-1" />
                </div>
                <span className="font-mono text-xl md:text-2xl font-bold tracking-widest text-white drop-shadow-md">
                  {profile.card_number || `LIB-${profile.role.slice(0, 2).toUpperCase()}-${String(profile.id).padStart(6, '0')}`}
                </span>
              </div>

              {/* QR Code Container */}
              <div className="p-2 rounded-xl bg-white text-slate-900 shadow-lg shrink-0 flex flex-col items-center">
                <QRCodeCanvas 
                  value={profile.card_number || `LIB-${profile.role.slice(0, 2).toUpperCase()}-${String(profile.id).padStart(6, '0')}`}
                  size={76}
                  level="M"
                />
                <span className="text-[8px] font-bold text-slate-600 mt-1 uppercase tracking-tighter">Mã quét quầy</span>
              </div>
            </div>

            {/* Card Footer Details */}
            <div className="relative z-10 grid grid-cols-2 gap-2 pt-4 border-t border-white/15 text-xs text-white/90">
              <div>
                <span className="text-[10px] text-white/60 block uppercase tracking-wider">Họ và Tên</span>
                <span className="font-semibold text-sm truncate block">{profile.full_name}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-white/60 block uppercase tracking-wider">Thời hạn thẻ</span>
                <span className="font-semibold text-sm">
                  {profile.card_expiry ? new Date(profile.card_expiry).toLocaleDateString("vi-VN") : "Vô thời hạn"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quick Overview & Actor Stats */}
        <div className="lg:col-span-6 flex flex-col justify-between gap-4">
          <Card className="flex-1 border-primary/20 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" /> Thông tin chức vụ & Trạng thái
                </CardTitle>
                <Badge variant="outline" className={roleMeta.badgeCls}>
                  {roleMeta.label}
                </Badge>
              </div>
              <CardDescription>Chi tiết thẩm quyền và thông tin hệ thống của tài khoản</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" /> Email đăng nhập:
                </span>
                <span className="font-semibold text-foreground">{profile.email}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" /> Số điện thoại:
                </span>
                <span className="font-medium text-foreground">{profile.phone || "Chưa cập nhật"}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" /> Ngày tạo tài khoản:
                </span>
                <span className="text-foreground">{new Date(profile.created_at).toLocaleDateString("vi-VN")}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5" /> Quyền hạn phân quyền (RBAC):
                </span>
                <span className="font-mono text-primary font-semibold">{profile.role.toUpperCase()}</span>
              </div>
            </CardContent>
          </Card>

          {/* Actor-Specific KPI Badges */}
          <div className="grid grid-cols-2 gap-3">
            {profile.role === "reader" && (
              <>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Sách đang mượn</p>
                  <p className="text-2xl font-bold text-primary mt-1">{stats.currentlyBorrowing || 0} <span className="text-xs font-normal text-muted-foreground">cuốn</span></p>
                </Card>
                <Card className="p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground">Nợ phạt trễ hạn</p>
                    {Number(stats.unpaidFines || 0) > 0 && (
                      <Link to="/fines" className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-0.5">
                        Nộp phạt QR <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-destructive mt-1">{Number(stats.unpaidFines || 0).toLocaleString("vi-VN")} <span className="text-xs font-normal text-muted-foreground">đ</span></p>
                </Card>
              </>
            )}
            {profile.role === "librarian" && (
              <>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Giao dịch đã xử lý</p>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.totalProcessedTransactions || 0} <span className="text-xs font-normal text-muted-foreground">lượt</span></p>
                </Card>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Xử lý hôm nay</p>
                  <p className="text-2xl font-bold text-primary mt-1">{stats.todayProcessedTransactions || 0} <span className="text-xs font-normal text-muted-foreground">lượt</span></p>
                </Card>
              </>
            )}
            {profile.role === "admin" && (
              <>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Tổng tài khoản hệ thống</p>
                  <p className="text-2xl font-bold text-indigo-600 mt-1">{stats.totalUsersInSystem || 0} <span className="text-xs font-normal text-muted-foreground">user</span></p>
                </Card>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Đề xuất quy chế đã gửi</p>
                  <p className="text-2xl font-bold text-primary mt-1">{stats.proposalsSubmitted || 0} <span className="text-xs font-normal text-muted-foreground">đề xuất</span></p>
                </Card>
              </>
            )}
            {profile.role === "owner" && (
              <>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Quy chế đã phê duyệt</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">{stats.proposalsReviewed || 0} <span className="text-xs font-normal text-muted-foreground">quyết định</span></p>
                </Card>
                <Card className="p-3.5">
                  <p className="text-[11px] text-muted-foreground">Đang chờ bạn duyệt</p>
                  <p className="text-2xl font-bold text-warning mt-1">{stats.proposalsPendingReview || 0} <span className="text-xs font-normal text-muted-foreground">yêu cầu</span></p>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 2. Tabs: Edit Information & Security */}
      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md bg-card border">
          <TabsTrigger value="edit" className="gap-2 text-xs">
            <User className="h-3.5 w-3.5" /> Chỉnh sửa hồ sơ
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2 text-xs">
            <KeyRound className="h-3.5 w-3.5" /> Đổi mật khẩu & Bảo mật
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Edit Profile */}
        <TabsContent value="edit">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">Cập nhật thông tin cá nhân</CardTitle>
              <CardDescription>Thay đổi họ tên hiển thị và số điện thoại liên lạc của bạn</CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdateProfile}>
              <CardContent className="space-y-4 max-w-2xl text-xs">
                <div className="space-y-1.5">
                  <Label className="text-xs">Họ và Tên (*)</Label>
                  <Input 
                    value={fullName} 
                    onChange={(e) => setFullName(e.target.value)} 
                    placeholder="Nhập họ và tên đầy đủ"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Địa chỉ Email (Cố định theo hệ thống)</Label>
                  <Input 
                    value={profile.email} 
                    disabled 
                    className="bg-muted cursor-not-allowed opacity-75"
                  />
                  <p className="text-[11px] text-muted-foreground">Email đăng nhập gắn liền với định danh tài khoản và không thể tự thay đổi.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Số điện thoại liên lạc</Label>
                  <Input 
                    value={phone} 
                    type="tel"
                    maxLength={10}
                    onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))} 
                    placeholder="Ví dụ: 0901234567"
                  />
                  <p className="text-[11px] text-muted-foreground">Chỉ nhập số, không được ghi chữ (10 chữ số, VD: 0901234567).</p>
                  {phone && !isValidPhone(phone) && (
                    <p className="text-[11px] text-destructive">Số điện thoại phải gồm 10 chữ số, bắt đầu bằng số 0</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Mã thẻ thư viện / Mã định danh công vụ</Label>
                  <Input 
                    value={profile.card_number || "LIB-AUTOGEN"} 
                    disabled 
                    className="bg-muted cursor-not-allowed opacity-75 font-mono"
                  />
                </div>

                <Button type="submit" disabled={savingProfile} className="gap-2 mt-2">
                  <Save className="h-4 w-4" />
                  {savingProfile ? "Đang lưu..." : "Lưu thay đổi thông tin"}
                </Button>
              </CardContent>
            </form>
          </Card>
        </TabsContent>

        {/* Tab 2: Change Password */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" /> Thay đổi mật khẩu tài khoản
              </CardTitle>
              <CardDescription>Đảm bảo an toàn tài khoản bằng mật khẩu mạnh (tối thiểu 6 ký tự)</CardDescription>
            </CardHeader>
            <form onSubmit={handleChangePassword}>
              <CardContent className="space-y-4 max-w-2xl text-xs">
                <div className="space-y-1.5">
                  <Label className="text-xs">Mật khẩu hiện tại (*)</Label>
                  <Input 
                    type="password"
                    value={currentPassword} 
                    onChange={(e) => setCurrentPassword(e.target.value)} 
                    placeholder="Nhập mật khẩu bạn đang sử dụng"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Mật khẩu mới (*)</Label>
                  <Input 
                    type="password"
                    value={newPassword} 
                    onChange={(e) => setNewPassword(e.target.value)} 
                    placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Xác nhận mật khẩu mới (*)</Label>
                  <Input 
                    type="password"
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    placeholder="Nhập lại mật khẩu mới"
                    required
                  />
                </div>

                <Button type="submit" disabled={savingPassword} className="gap-2 mt-2">
                  <KeyRound className="h-4 w-4" />
                  {savingPassword ? "Đang cập nhật..." : "Xác nhận đổi mật khẩu"}
                </Button>
              </CardContent>
            </form>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
