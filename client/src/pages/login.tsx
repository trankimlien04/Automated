import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookMarked, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";
import { toast } from "sonner";

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Vui lòng nhập đầy đủ thông tin");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email, password });
      login(response.data.token, response.data.user);
      toast.success("Đăng nhập thành công!");
      navigate("/");
    } catch (error: any) {
      const msg = error.response?.data?.message || "Đăng nhập thất bại. Vui lòng kiểm tra lại!";
      toast.error(msg);
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
    setLoading(true);
    try {
      const response = await api.post("/auth/register", { fullName, email, password, phone });
      toast.success(response.data.message || "Đăng ký thành công! Hãy đợi Admin duyệt.");
      setIsLogin(true);
    } catch (error: any) {
      const msg = error.response?.data?.message || "Đăng ký thất bại. Email có thể đã tồn tại!";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-accent/30 to-background px-4">
      {/* Background shapes */}
      <div className="absolute top-1/4 left-1/4 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-[80px]" />
      <div className="absolute bottom-1/4 right-1/4 -z-10 h-80 w-80 rounded-full bg-terracotta/800 blur-[100px] opacity-10" />

      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 mb-3">
            <BookMarked className="h-6 w-6" />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Athenaeum</h1>
          <p className="mt-1 text-sm text-muted-foreground">Hệ thống Thư viện thông minh</p>
        </div>

        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-card border">
            <TabsTrigger value="login" onClick={() => setIsLogin(true)}>Đăng nhập</TabsTrigger>
            <TabsTrigger value="register" onClick={() => setIsLogin(false)}>Đăng ký</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card className="border shadow-lg backdrop-blur-md bg-card/95">
              <CardHeader>
                <CardTitle className="font-display text-xl">Chào mừng trở lại</CardTitle>
                <CardDescription>Đăng nhập để quản lý và mượn sách thư viện</CardDescription>
              </CardHeader>
              <form onSubmit={handleLoginSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Mật khẩu</Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3">
                  <Button className="w-full" type="submit" disabled={loading}>
                    {loading ? "Đang xử lý..." : "Đăng nhập"}
                  </Button>

                  <div className="w-full pt-2 border-t text-center space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground">Tài khoản demo nhanh:</p>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-1 border-primary/40 bg-primary/5 hover:bg-primary/15 text-primary"
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
                        className="h-7 text-[10px] px-1"
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
                        className="h-7 text-[10px] px-1"
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
                        className="h-7 text-[10px] px-1"
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
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="border shadow-lg backdrop-blur-md bg-card/95">
              <CardHeader>
                <CardTitle className="font-display text-xl">Đăng ký tài khoản</CardTitle>
                <CardDescription>Đăng ký thẻ thư viện để nhận mã QR mượn sách</CardDescription>
              </CardHeader>
              <form onSubmit={handleRegisterSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">Họ và Tên</Label>
                    <Input
                      id="reg-name"
                      type="text"
                      placeholder="Nguyễn Văn A"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">Email</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone">Số điện thoại</Label>
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="0901234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Mật khẩu</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full animate-pulse" type="submit" disabled={loading}>
                    {loading ? "Đang tạo tài khoản..." : "Gửi yêu cầu đăng ký"}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
