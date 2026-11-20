import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BookMarked,
  MailCheck,
  Clock,
  ShieldAlert,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Phone,
  QrCode,
  Inbox,
  Sparkles,
  ArrowRight,
  ScrollText,
  KeyRound,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { toast } from "sonner";
import { isValidEmail, isValidPhone, sanitizePhoneInput, validateEmailInput, validatePhoneInput } from "@/lib/validators";
import libraryAuthBg from "@/assets/library-auth-bg.jpg";
import {
  DEFAULT_READER_RULES,
  LibraryRulesDialog,
  type PublicReaderRules,
} from "@/components/library-rules-content";

function getLoginApiError(error: unknown, fallback: string) {
  const resData = (error as {
    response?: { data?: { message?: string; accountStatus?: string; cardNumber?: string | null } };
  })?.response?.data;
  return {
    message: resData?.message || fallback,
    accountStatus: resData?.accountStatus,
    cardNumber: resData?.cardNumber || null,
  };
}

const LIBRARY_HIGHLIGHTS = [
  {
    icon: QrCode,
    title: "Mượn & Trả qua mã QR",
    desc: "Cấp thẻ độc giả điện tử và định danh từng bản sao sách nhanh chóng tại quầy.",
  },
  {
    icon: Inbox,
    title: "Hòm trả sách 24/7",
    desc: "Ghi nhận trả sách ngoài giờ kèm ảnh minh chứng và chốt mốc hạn tức thời.",
  },
  {
    icon: Sparkles,
    title: "Tra cứu & Nhắc hạn thông minh",
    desc: "Tìm kiếm không dấu, đặt trước hàng đợi và thông báo nhắc hạn tự động qua email.",
  },
];

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [readerRules, setReaderRules] = useState<PublicReaderRules>(DEFAULT_READER_RULES);
  const [pendingNoticeEmail, setPendingNoticeEmail] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<{
    type: "pending" | "locked" | "error";
    message: string;
    cardNumber?: string | null;
  } | null>(null);

  // Forgot password modal state
  const [forgotDialogOpen, setForgotDialogOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotNewPass, setForgotNewPass] = useState("");
  const [forgotConfirmPass, setForgotConfirmPass] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [showForgotNewPass, setShowForgotNewPass] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .get("/configs/public-rules")
      .then((res) => {
        if (!cancelled && res.data) {
          setReaderRules({ ...DEFAULT_READER_RULES, ...res.data });
        }
      })
      .catch(() => {
        // Keep safe defaults if backend is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginNotice(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      const msg = "Vui lòng nhập đầy đủ email và mật khẩu";
      setLoginNotice({ type: "error", message: msg });
      toast.error(msg);
      return;
    }

    const emailErr = validateEmailInput(cleanEmail);
    if (emailErr) {
      setLoginNotice({ type: "error", message: emailErr });
      toast.error(emailErr);
      return;
    }

    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email: cleanEmail, password });
      const notice = response.data.accountNotice || null;
      setPendingNoticeEmail(null);
      setLoginNotice(null);
      login(response.data.token, response.data.user, notice);
      if (notice?.kind === "unlocked") {
        toast.success(`🔓 Thẻ thư viện${notice.cardNumber ? ` (${notice.cardNumber})` : ""} của bạn đã được mở khóa!`);
      } else if (notice?.kind === "approved") {
        toast.success(`✅ Tài khoản & thẻ thư viện${notice.cardNumber ? ` (${notice.cardNumber})` : ""} đã được phê duyệt!`);
      } else {
        toast.success("Đăng nhập thành công!");
      }
      navigate("/");
    } catch (error: unknown) {
      const { message, accountStatus, cardNumber } = getLoginApiError(
        error,
        "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại!"
      );
      if (accountStatus === "pending" || accountStatus === "locked") {
        setPendingNoticeEmail(null);
        setLoginNotice({ type: accountStatus, message, cardNumber });
      } else {
        setLoginNotice({
          type: "error",
          message: message || "Email hoặc mật khẩu không chính xác. Vui lòng thử lại!",
        });
      }
      toast.error(message || "Email hoặc mật khẩu không chính xác. Vui lòng thử lại!");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      toast.error("Vui lòng điền đầy đủ tên, email và mật khẩu");
      return;
    }

    const emailErr = validateEmailInput(email);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }

    const phoneErr = validatePhoneInput(phone, false);
    if (phoneErr) {
      toast.error(phoneErr);
      return;
    }

    const submittedEmail = email.trim();
    setLoading(true);
    try {
      const response = await api.post("/auth/register", {
        fullName: fullName.trim(),
        email: submittedEmail,
        password,
        phone: phone ? phone.trim() : null,
      });
      toast.success(response.data.message || "Đăng ký thành công! Hãy đợi Thủ thư/Admin duyệt.");
      setPendingNoticeEmail(submittedEmail);
      setLoginNotice(null);
      setEmail(submittedEmail);
      setPassword("");
      setFullName("");
      setPhone("");
      setActiveTab("login");
    } catch (error: unknown) {
      const { message } = getLoginApiError(error, "Đăng ký thất bại. Email có thể đã tồn tại!");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      toast.error("Vui lòng nhập địa chỉ email của bạn");
      return;
    }
    const emailErr = validateEmailInput(forgotEmail);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    setForgotLoading(true);
    try {
      const res = await api.post("/auth/forgot-password", { email: forgotEmail.trim() });
      toast.success(res.data.message || "Đã gửi mã xác thực qua email thành công!");
      setForgotStep(2);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể gửi yêu cầu quên mật khẩu");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotOtp.trim()) {
      toast.error("Vui lòng nhập mã OTP 6 số từ email");
      return;
    }
    if (!forgotNewPass || forgotNewPass.length < 6) {
      toast.error("Mật khẩu mới phải có tối thiểu 6 ký tự");
      return;
    }
    if (forgotNewPass !== forgotConfirmPass) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    setForgotLoading(true);
    try {
      const res = await api.post("/auth/reset-password", {
        email: forgotEmail.trim(),
        resetCode: forgotOtp.trim(),
        newPassword: forgotNewPass,
      });
      toast.success(res.data.message || "Đặt lại mật khẩu thành công!");
      setForgotDialogOpen(false);
      setEmail(forgotEmail.trim());
      setPassword("");
      setForgotStep(1);
      setForgotOtp("");
      setForgotNewPass("");
      setForgotConfirmPass("");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Đặt lại mật khẩu thất bại");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden flex items-center justify-center px-4 py-6 sm:px-6 lg:px-10">
      {/* Full-bleed Library Background Image + Atmospheric Emerald/Warm Scrim */}
      <div className="fixed inset-0 -z-10 overflow-hidden bg-[#132219]">
        <img
          src={libraryAuthBg}
          alt="Không gian thư viện Athenaeum"
          className="h-full w-full object-cover object-center scale-[1.02] brightness-[0.82] saturate-[1.06]"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0D2117]/88 via-[#152A20]/72 to-[#1D150D]/80" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,196,105,0.22),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(27,67,50,0.45),transparent_55%)]" />
      </div>

      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        {/* Left Editorial Library Showcase (Desktop) */}
        <div className="hidden lg:flex lg:col-span-7 flex-col justify-between text-[#FBF8F1] pr-4 xl:pr-8 space-y-7">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-200/30 bg-white/10 px-4 py-1.5 backdrop-blur-md shadow-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/25 border border-emerald-300/40 text-amber-200">
                <BookMarked className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold tracking-wide text-amber-100">
                Athenaeum • Hệ thống Thư viện Thông minh
              </span>
            </div>

            <div className="space-y-3">
              <h1 className="font-display text-4xl xl:text-[2.85rem] font-bold tracking-tight leading-[1.16] text-white drop-shadow-sm">
                Không gian tri thức số,{" "}
                <span className="text-amber-200">kết nối từng trang sách.</span>
              </h1>
              <p className="text-sm xl:text-base text-stone-200/90 max-w-xl leading-relaxed">
                Quản lý danh mục đầu sách, mượn trả qua mã QR định danh, kiểm kê hòm sách 24/7 và theo dõi lịch sử lưu thông minh bạch trên một nền tảng hiện đại.
              </p>
            </div>
          </div>

          {/* 3 Compact Feature Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {LIBRARY_HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-md transition-colors hover:bg-white/[0.12] space-y-2"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300/15 border border-amber-200/25 text-amber-200">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <h2 className="text-xs font-bold text-white tracking-wide">{item.title}</h2>
                  <p className="text-[11px] leading-relaxed text-stone-200/80">{item.desc}</p>
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/15 pt-4 flex flex-wrap items-center justify-between gap-4 text-xs text-amber-100/85">
            <p className="font-display italic text-sm text-amber-100/90">
              “Mỗi cuốn sách là một thế giới mở ra ngay khi bạn lật trang đầu tiên.”
            </p>
            <button
              type="button"
              onClick={() => setRulesDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200/35 bg-amber-300/15 hover:bg-amber-300/25 px-3.5 py-2 text-xs font-semibold text-amber-100 backdrop-blur-md transition-colors shadow-sm cursor-pointer shrink-0"
            >
              <ScrollText className="h-4 w-4 text-amber-200" />
              <span>Đọc Nội quy Thư viện (7 mục)</span>
            </button>
          </div>
        </div>

        {/* Right Auth Card */}
        <div className="lg:col-span-5 w-full max-w-[460px] mx-auto">
          {/* Mobile / Tablet Compact Brand Header */}
          <div className="flex flex-col items-center text-center mb-5 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg ring-4 ring-white/15 mb-2.5">
              <BookMarked className="h-6 w-6" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white drop-shadow">
              Athenaeum
            </h1>
            <p className="mt-0.5 text-xs text-amber-100/90">Hệ thống Thư viện thông minh</p>
            <button
              type="button"
              onClick={() => setRulesDialogOpen(true)}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-amber-200/35 bg-amber-300/15 hover:bg-amber-300/25 px-3 py-1.5 text-[11px] font-semibold text-amber-100 backdrop-blur-md transition-colors cursor-pointer"
            >
              <ScrollText className="h-3.5 w-3.5 text-amber-200" />
              <span>Đọc Nội quy Thư viện (7 mục)</span>
            </button>
          </div>

          <Card className="border border-amber-100/50 bg-[#FFFDF9]/95 dark:bg-card/95 backdrop-blur-xl shadow-[0_24px_64px_-16px_rgba(6,18,12,0.72)] rounded-2xl overflow-hidden">
            {/* Subtle Top Accent Bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-[#1B4332] via-[#2D6A4F] to-[#C89B3C]" />

            <div className="px-4 sm:px-6 pt-5 pb-1 hidden lg:flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <BookMarked className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="font-display text-lg font-bold leading-none text-foreground">Athenaeum</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Cổng Thư viện Thông minh</p>
                </div>
              </div>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                Độc giả & Nhân sự
              </span>
            </div>

            <div className="px-4 sm:px-6 pt-4">
              <Tabs
                value={activeTab}
                onValueChange={(val) => setActiveTab(val === "register" ? "register" : "login")}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2 h-10 p-1 rounded-xl bg-muted/80 border border-border/70">
                  <TabsTrigger
                    value="login"
                    className="rounded-lg text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-all cursor-pointer"
                  >
                    Đăng nhập
                  </TabsTrigger>
                  <TabsTrigger
                    value="register"
                    className="rounded-lg text-xs font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm transition-all cursor-pointer"
                  >
                    Đăng ký thẻ
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-0">
                  <CardHeader className="px-0 pt-4 pb-3">
                    <CardTitle className="font-display text-xl">Chào mừng trở lại</CardTitle>
                    <CardDescription className="text-xs">
                      Đăng nhập để tra cứu, quản lý và mượn sách thư viện
                    </CardDescription>
                  </CardHeader>

                  <form onSubmit={handleLoginSubmit}>
                    <CardContent className="px-0 space-y-3.5 pb-4">
                      {pendingNoticeEmail && (
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 dark:bg-emerald-950/30 dark:border-emerald-700 p-3 text-xs space-y-1 text-emerald-950 dark:text-emerald-100">
                          <p className="font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                            <MailCheck className="h-4 w-4 shrink-0" />
                            Đã gửi đăng ký cho {pendingNoticeEmail}
                          </p>
                          <ul className="list-disc pl-4 space-y-0.5 text-[11px] leading-relaxed text-emerald-900 dark:text-emerald-200">
                            <li>Hồ sơ của bạn đang chờ <strong>Thủ thư / Quản trị viên</strong> duyệt cấp thẻ.</li>
                            <li>Hệ thống sẽ <strong>gửi email kèm Mã thẻ</strong> tới <strong>{pendingNoticeEmail}</strong> ngay khi duyệt.</li>
                          </ul>
                        </div>
                      )}

                      {loginNotice && (
                        <div
                          className={`rounded-xl border p-3 text-xs space-y-1 transition-all animate-in fade-in slide-in-from-top-1 ${
                            loginNotice.type === "pending"
                              ? "border-amber-300 bg-amber-50/90 text-amber-950 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-100"
                              : loginNotice.type === "locked"
                              ? "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20"
                              : "border-rose-400 bg-rose-50/95 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200"
                          }`}
                        >
                          <p className="font-bold flex items-center gap-1.5">
                            {loginNotice.type === "pending" ? (
                              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                            ) : loginNotice.type === "locked" ? (
                              <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
                            ) : (
                              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                            )}
                            {loginNotice.type === "pending"
                              ? "Tài khoản đang chờ phê duyệt"
                              : loginNotice.type === "locked"
                              ? (loginNotice.cardNumber
                                  ? `Thẻ thư viện bị tạm khóa (${loginNotice.cardNumber})`
                                  : "Tài khoản bị khóa / chưa được duyệt")
                              : "Đăng nhập không thành công"}
                          </p>
                          <p className="text-[11px] leading-relaxed font-medium">{loginNotice.message}</p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="login-email" className="text-xs font-semibold">
                          Email
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="login-email"
                            type="email"
                            placeholder="name@example.com"
                            className={`pl-9 h-10 bg-background/80 transition-colors ${
                              loginNotice?.type === "error"
                                ? "border-rose-500 focus-visible:ring-rose-500/40"
                                : ""
                            }`}
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              if (loginNotice) setLoginNotice(null);
                            }}
                            required
                          />
                        </div>
                        {email && !isValidEmail(email) && (
                          <p className="text-[11px] text-destructive">
                            Email không đúng định dạng (Ví dụ: name@example.com)
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="login-password" className="text-xs font-semibold">
                          Mật khẩu
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="login-password"
                            type={showLoginPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className={`pl-9 pr-10 h-10 bg-background/80 transition-colors ${
                              loginNotice?.type === "error"
                                ? "border-rose-500 focus-visible:ring-rose-500/40"
                                : ""
                            }`}
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              if (loginNotice) setLoginNotice(null);
                            }}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword((prev) => !prev)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            aria-label={showLoginPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                          >
                            {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        {loginNotice?.type === "error" && (
                          <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1 animate-in fade-in">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>Vui lòng kiểm tra lại tài khoản hoặc mật khẩu đăng nhập</span>
                          </p>
                        )}
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setForgotEmail(email || "");
                              setForgotStep(1);
                              setForgotDialogOpen(true);
                            }}
                            className="text-xs font-semibold text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
                          >
                            Quên mật khẩu?
                          </button>
                        </div>
                      </div>
                    </CardContent>

                    <CardFooter className="px-0 pb-5 flex flex-col gap-3">
                      <Button
                        className="w-full h-10 font-semibold shadow-md shadow-primary/20 gap-1.5 cursor-pointer"
                        type="submit"
                        disabled={loading}
                      >
                        <span>{loading ? "Đang xác thực..." : "Đăng nhập vào thư viện"}</span>
                        {!loading && <ArrowRight className="h-4 w-4" />}
                      </Button>

                      <div className="w-full pt-3 border-t border-border/70 text-center space-y-2">
                        <p className="text-[11px] font-medium text-muted-foreground">Tài khoản demo nhanh:</p>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7.5 text-[11px] px-2 border-primary/35 bg-primary/5 hover:bg-primary/15 text-primary cursor-pointer"
                            onClick={() => {
                              setEmail("owner@library.com");
                              setPassword("123456");
                            }}
                          >
                            👑 Chủ thư viện
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7.5 text-[11px] px-2 hover:bg-accent/70 cursor-pointer"
                            onClick={() => {
                              setEmail("admin@library.com");
                              setPassword("admin123");
                            }}
                          >
                            🛡️ Quản trị viên
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7.5 text-[11px] px-2 hover:bg-accent/70 cursor-pointer"
                            onClick={() => {
                              setEmail("librarian@library.com");
                              setPassword("123456");
                            }}
                          >
                            📚 Thủ thư
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7.5 text-[11px] px-2 hover:bg-accent/70 cursor-pointer"
                            onClick={() => {
                              setEmail("reader@library.com");
                              setPassword("123456");
                            }}
                          >
                            📖 Độc giả
                          </Button>
                        </div>
                      </div>
                    </CardFooter>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="mt-0">
                  <CardHeader className="px-0 pt-4 pb-3">
                    <CardTitle className="font-display text-xl">Đăng ký thẻ thư viện</CardTitle>
                    <CardDescription className="text-xs">
                      Tạo tài khoản độc giả để nhận mã thẻ QR mượn sách
                    </CardDescription>
                  </CardHeader>

                  <form onSubmit={handleRegisterSubmit}>
                    <CardContent className="px-0 space-y-3 pb-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="reg-name" className="text-xs font-semibold">
                          Họ và Tên
                        </Label>
                        <div className="relative">
                          <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="reg-name"
                            type="text"
                            placeholder="Nguyễn Văn A"
                            className="pl-9 h-10 bg-background/80"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reg-email" className="text-xs font-semibold">
                          Email
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="reg-email"
                            type="email"
                            placeholder="name@example.com"
                            className="pl-9 h-10 bg-background/80"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                        {email && !isValidEmail(email) && (
                          <p className="text-[11px] text-destructive">
                            Email không đúng định dạng (Ví dụ: name@example.com)
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reg-phone" className="text-xs font-semibold">
                          Số điện thoại
                        </Label>
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="reg-phone"
                            type="tel"
                            placeholder="0901234567"
                            className="pl-9 h-10 bg-background/80"
                            value={phone}
                            maxLength={10}
                            onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
                          />
                        </div>
                        <p className="text-[10.5px] text-muted-foreground">
                          Chỉ nhập số, gồm 10 chữ số (VD: 0901234567)
                        </p>
                        {phone && !isValidPhone(phone) && (
                          <p className="text-[11px] text-destructive">
                            Số điện thoại phải gồm 10 chữ số, bắt đầu bằng số 0
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="reg-password" className="text-xs font-semibold">
                          Mật khẩu
                        </Label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="reg-password"
                            type={showRegPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className="pl-9 pr-10 h-10 bg-background/80"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword((prev) => !prev)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            aria-label={showRegPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                          >
                            {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </CardContent>

                    <CardFooter className="px-0 pb-5 flex flex-col gap-2.5">
                      <Button
                        className="w-full h-10 font-semibold shadow-md shadow-primary/20 cursor-pointer"
                        type="submit"
                        disabled={loading}
                      >
                        {loading ? "Đang tạo tài khoản..." : "Gửi yêu cầu đăng ký"}
                      </Button>
                      <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                        Hồ sơ sẽ được Thủ thư duyệt và gửi mã thẻ thư viện qua Email.{" "}
                        <button
                          type="button"
                          onClick={() => setRulesDialogOpen(true)}
                          className="font-semibold text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer"
                        >
                          Xem nội quy độc giả
                        </button>
                      </p>
                    </CardFooter>
                  </form>
                </TabsContent>
              </Tabs>
            </div>
          </Card>
        </div>
      </div>

      {/* Full-View Library Rules Modal for Readers */}
      <LibraryRulesDialog
        open={rulesDialogOpen}
        onOpenChange={setRulesDialogOpen}
        rules={readerRules}
        ctaLabel="Đăng ký thẻ thư viện"
        onCtaClick={() => setActiveTab("register")}
      />

      {/* Forgot Password / Reset Password Modal */}
      <Dialog open={forgotDialogOpen} onOpenChange={setForgotDialogOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl border bg-background shadow-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5 text-primary">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <DialogTitle className="font-display text-lg font-bold">
                {forgotStep === 1 ? "Quên mật khẩu tài khoản" : "Nhập mã OTP & Đặt mật khẩu mới"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {forgotStep === 1
                ? "Nhập email tài khoản thư viện của bạn. Chúng tôi sẽ gửi mã OTP xác thực 6 số để bạn thiết lập lại mật khẩu."
                : `Mã OTP đã được gửi tới ${forgotEmail}. Vui lòng nhập mã 6 số cùng mật khẩu mới của bạn.`}
            </DialogDescription>
          </DialogHeader>

          {forgotStep === 1 ? (
            <form onSubmit={handleSendForgotOtp} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email" className="text-xs font-semibold">
                  Địa chỉ Email đăng ký
                </Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="forgot-email"
                    type="email"
                    placeholder="name@example.com"
                    className="pl-9 h-10"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setForgotDialogOpen(false)}
                  className="text-xs cursor-pointer"
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={forgotLoading}
                  className="text-xs font-semibold gap-1.5 cursor-pointer"
                >
                  {forgotLoading ? "Đang gửi mã..." : "Gửi mã OTP qua Email"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-3.5 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="forgot-otp" className="text-xs font-semibold">
                  Mã xác thực OTP (6 chữ số)
                </Label>
                <Input
                  id="forgot-otp"
                  type="text"
                  maxLength={6}
                  placeholder="Ví dụ: 123456"
                  className="h-10 font-mono text-center text-lg tracking-widest font-bold"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="forgot-new-pass" className="text-xs font-semibold">
                  Mật khẩu mới (tối thiểu 6 ký tự)
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="forgot-new-pass"
                    type={showForgotNewPass ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-9 pr-10 h-10"
                    value={forgotNewPass}
                    onChange={(e) => setForgotNewPass(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowForgotNewPass((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showForgotNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="forgot-confirm-pass" className="text-xs font-semibold">
                  Xác nhận mật khẩu mới
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="forgot-confirm-pass"
                    type={showForgotNewPass ? "text" : "password"}
                    placeholder="••••••••"
                    className="pl-9 h-10"
                    value={forgotConfirmPass}
                    onChange={(e) => setForgotConfirmPass(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => setForgotStep(1)}
                  className="text-muted-foreground hover:text-foreground underline cursor-pointer"
                >
                  ← Gửi lại mã OTP
                </button>
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setForgotDialogOpen(false)}
                  className="text-xs cursor-pointer"
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={forgotLoading}
                  className="text-xs font-semibold gap-1.5 cursor-pointer bg-primary text-primary-foreground"
                >
                  {forgotLoading ? "Đang xử lý..." : "Đặt lại mật khẩu"}
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
