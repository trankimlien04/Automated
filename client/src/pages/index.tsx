import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, Users, ArrowRightLeft, AlertTriangle, TrendingUp, Sparkles,
  ArrowUpRight, ArrowDownRight, QrCode, Clock, BookMarked, Wallet, Award,
  Shield, BarChart3, Crown
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface DashboardData {
  stats: {
    totalBooks: number;
    totalCopies: number;
    activeReaders: number;
    currentlyBorrowing: number;
    activeReservations: number;
    overdueCount: number;
    unpaidFinesSum: number;
  };
  popularBooks: Array<{ id: number; title: string; author_name: string; borrow_count: number }>;
  borrowTrends: Array<{ month: string; count: number }>;
  recentTransactions: Array<{ id: number; borrow_date: string; status: string; reader_name: string; book_title: string }>;
  unpaidFinesList?: Array<{
    id: number;
    amount: number;
    reason: string;
    created_at: string;
    user_id: number;
    reader_name: string;
    card_number: string;
    book_title?: string;
  }>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Reader-specific states
  const [readerHistory, setReaderHistory] = useState<any[]>([]);
  const [readerFines, setReaderFines] = useState<any[]>([]);
  const [readerReservations, setReaderReservations] = useState<any[]>([]);

  const fetchLibrarianStats = async () => {
    try {
      const response = await api.get("/reports/dashboard");
      setData(response.data);
    } catch (error) {
      console.error("Lỗi khi lấy dữ liệu thống kê:", error);
      toast.error("Không thể tải thông tin thống kê hệ thống");
    } finally {
      setLoading(false);
    }
  };

  const fetchReaderData = async () => {
    try {
      const [historyRes, finesRes, resRes] = await Promise.all([
        api.get("/borrow/records"),
        api.get("/fines"),
        api.get("/reservations")
      ]);
      setReaderHistory(historyRes.data);
      setReaderFines(finesRes.data);
      setReaderReservations(resRes.data);
    } catch (error) {
      console.error("Lỗi khi tải thông tin độc giả:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin" || user?.role === "librarian" || user?.role === "owner") {
      fetchLibrarianStats();
    } else if (user?.role === "reader") {
      fetchReaderData();
    }
  }, [user]);

  const isStaffOrOwner = user?.role === "admin" || user?.role === "librarian" || user?.role === "owner";
  const isOwner = user?.role === "owner";

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Render LIBRARIAN / ADMIN / OWNER dashboard
  if (isStaffOrOwner && data) {
    const { stats, popularBooks, borrowTrends, recentTransactions } = data;
    
    return (
      <div className="space-y-6">
        {/* Hero strip */}
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary via-primary/95 to-primary/80 text-primary-foreground shadow-md">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <Badge className="bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/20 border-0">
                <Sparkles className="mr-1 h-3 w-3 animate-pulse" /> {isOwner ? "👑 Trung tâm Điều hành Giám đốc" : "Hôm nay, " + new Date().toLocaleDateString("vi-VN")}
              </Badge>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                {isOwner ? `Xin chào Giám đốc, ${user?.fullName}` : `Chào buổi sáng, ${user?.fullName}.`}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-primary-foreground/80">
                {isOwner 
                  ? `Tổng quan toàn diện: ${stats.totalCopies} cuốn sách, ${stats.activeReaders} độc giả, ${stats.currentlyBorrowing} lượt đang lưu thông và ${Number(stats.unpaidFinesSum || 0).toLocaleString("vi-VN")}đ nợ phạt cần kiểm soát.`
                  : `Hệ thống ghi nhận đang có ${stats.currentlyBorrowing} lượt mượn sách hoạt động và ${stats.overdueCount} lượt bị quá hạn cần nhắc nhở.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <>
                  <Button size="lg" variant="secondary" onClick={() => navigate("/settings")} className="gap-2 shadow-sm font-semibold">
                    <Shield className="h-4 w-4" /> Phê duyệt Quy chế
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => navigate("/reports")} className="gap-2 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-primary-foreground/30">
                    <BarChart3 className="h-4 w-4" /> Báo cáo quản trị
                  </Button>
                </>
              ) : (
                <Button size="lg" variant="secondary" onClick={() => navigate("/borrow")} className="gap-2 shadow-sm">
                  <QrCode className="h-4 w-4" /> Quét QR mượn / trả
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Tổng đầu sách", value: stats.totalBooks.toLocaleString("vi-VN"), icon: BookOpen, accent: "var(--chart-1)", sub: `${stats.totalCopies} cuốn tồn kho` },
            { label: "Độc giả hoạt động", value: stats.activeReaders.toLocaleString("vi-VN"), icon: Users, accent: "var(--chart-4)", sub: "Đã kích hoạt tài khoản" },
            { label: "Đang mượn sách", value: stats.currentlyBorrowing.toString(), icon: ArrowRightLeft, accent: "var(--chart-3)", sub: `${stats.overdueCount} trễ hạn` },
            { label: "Đặt trước chờ sách", value: stats.activeReservations.toString(), icon: Clock, accent: "var(--chart-2)", sub: "Đang xếp hàng đợi" }
          ].map((s, idx) => (
            <Card key={idx} className="relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${s.accent}, transparent)` }} />
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                  <div className="h-9 w-9 rounded-md grid place-items-center" style={{ background: `color-mix(in oklab, ${s.accent} 14%, transparent)`, color: s.accent }}>
                    <s.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 font-display text-3xl font-semibold tracking-tight">{s.value}</p>
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{s.sub}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts & Popular */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="font-display">Xu hướng giao dịch mượn sách</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Tần suất mượn sách theo các tháng gần đây</p>
              </div>
              <Badge variant="outline" className="gap-1 text-xs">
                <TrendingUp className="h-3 w-3 text-success" /> Hoạt động ổn định
              </Badge>
            </CardHeader>
            <CardContent>
              {borrowTrends.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-20">Chưa có dữ liệu thống kê biểu đồ</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={borrowTrends}>
                    <defs>
                      <linearGradient id="borrowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Area type="monotone" dataKey="count" stroke="var(--chart-1)" name="Lượt mượn" strokeWidth={2} fill="url(#borrowGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-display text-base">Phí phạt tồn đọng</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Tổng nợ: <strong className="text-destructive font-bold">{(Number(stats.unpaidFinesSum) || 0).toLocaleString("vi-VN")}đ</strong>
                  </p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigate("/fines")} 
                  className="text-xs h-7 text-primary hover:text-primary gap-1 px-2"
                >
                  Sổ phạt <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between pt-1 pb-4">
              {!data.unpaidFinesList || data.unpaidFinesList.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  <Wallet className="h-8 w-8 text-muted-foreground/30 mx-auto mb-1.5" />
                  <p>Không có khoản nợ phạt nào đang tồn đọng</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {data.unpaidFinesList.map((f) => (
                    <div 
                      key={f.id} 
                      onClick={() => navigate("/fines")}
                      className="p-2 rounded-lg border bg-muted/20 hover:bg-destructive/5 hover:border-destructive/30 transition cursor-pointer flex items-center justify-between text-xs gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate text-foreground flex items-center gap-1.5">
                          <span>{f.reader_name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">({f.card_number})</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {f.book_title ? `Sách: ${f.book_title}` : f.reason}
                        </p>
                      </div>
                      <Badge variant="destructive" className="text-[10px] font-semibold shrink-0 py-0.5">
                        {f.amount.toLocaleString("vi-VN")}đ
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              <Button 
                variant="outline" 
                size="sm" 
                className="w-full text-xs h-8 gap-1.5 mt-3 border-destructive/20 text-destructive hover:bg-destructive/10"
                onClick={() => navigate("/fines")}
              >
                <Wallet className="h-3.5 w-3.5" /> Mở Sổ Quản Lý & Thu Phí Phạt
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Popular & Recent */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="font-display">Đầu sách được mượn nhiều nhất</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Bản xếp hạng các đầu sách yêu thích của độc giả</p>
            </CardHeader>
            <CardContent>
              {popularBooks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-20">Chưa ghi nhận lượt mượn nào</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={popularBooks} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} />
                    <YAxis type="category" dataKey="title" stroke="var(--muted-foreground)" fontSize={11} width={130} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Bar dataKey="borrow_count" name="Số lượt mượn" fill="var(--chart-4)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display">Hoạt động vừa diễn ra</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/borrow")} className="text-xs">Xem chi tiết</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentTransactions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-10">Chưa có giao dịch mượn trả nào</p>
              ) : (
                recentTransactions.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-start gap-3 rounded-md border border-border/60 p-3 hover:bg-accent/30 transition">
                    <div className={`mt-0.5 h-2 w-2 rounded-full ${t.status === "borrowing" ? "bg-primary animate-pulse" : "bg-success"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{t.book_title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.reader_name}</p>
                    </div>
                    <Badge variant={t.status === "borrowing" ? "default" : "secondary"} className="text-[9px]">
                      {t.status === "borrowing" ? "Đang mượn" : "Đã trả"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Render READER / STUDENT dashboard
  const activeBorrows = readerHistory.filter(h => h.status === 'borrowing');
  const unpaidFines = readerFines.filter(f => f.status === 'unpaid');
  const activeReservationsCount = readerReservations.filter(r => r.status === 'pending' || r.status === 'ready').length;

  return (
    <div className="space-y-6">
      {/* Hero Strip for Reader */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-terracotta to-terracotta/80 text-white shadow-md">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Badge className="bg-white/15 text-white hover:bg-white/20 border-0">
              <Award className="mr-1 h-3.5 w-3.5 text-gold animate-bounce" /> Thẻ độc giả Athenaeum
            </Badge>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Chào bạn, {user?.fullName}!
            </h2>
            <p className="mt-1 max-w-xl text-sm text-white/80">
              Chúc bạn có những giờ phút đọc sách thú vị. Bạn đang có <strong>{activeBorrows.length}</strong> cuốn sách đang mượn và <strong>{unpaidFines.length}</strong> khoản phí phạt chưa đóng.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="lg" variant="secondary" onClick={() => navigate("/books")} className="gap-2 shadow-sm text-terracotta hover:text-terracotta/90 bg-white">
              <BookOpen className="h-4 w-4" /> Khám phá kho sách
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reader Stats Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Sách đang mượn", value: activeBorrows.length.toString(), icon: BookOpen, accent: "var(--chart-1)", desc: "Hãy chú ý hạn trả trên phiếu mượn" },
          { label: "Phiếu đặt trước", value: activeReservationsCount.toString(), icon: Clock, accent: "var(--chart-3)", desc: "Sách đang xếp hàng đợi bạn" },
          { label: "Hóa đơn phí phạt", value: `${unpaidFines.reduce((s, f) => s + (Number(f.amount) || 0), 0).toLocaleString("vi-VN")}đ`, icon: Wallet, accent: "var(--chart-2)", desc: `${unpaidFines.length} khoản phí quá hạn` }
        ].map((s, idx) => (
          <Card key={idx} className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${s.accent}, transparent)` }} />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                <div className="h-9 w-9 rounded-md grid place-items-center" style={{ background: `color-mix(in oklab, ${s.accent} 14%, transparent)`, color: s.accent }}>
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3 font-display text-3xl font-semibold tracking-tight">{s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-2">{s.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Borrowing Book List */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="font-display">Sách bạn đang mượn đọc</CardTitle>
            <p className="text-xs text-muted-foreground">Danh sách bản sao sách bạn đang sở hữu. Vui lòng hoàn trả đúng hạn.</p>
          </CardHeader>
          <CardContent className="p-0">
            {activeBorrows.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm flex flex-col items-center">
                <BookMarked className="h-8 w-8 text-muted mb-2 animate-bounce" />
                <p>Bạn không mượn cuốn sách nào gần đây.</p>
              </div>
            ) : (
              <div className="divide-y max-h-96 overflow-y-auto px-4 pb-4">
                {activeBorrows.map((b) => {
                  const isOverdue = new Date() > new Date(b.due_date);
                  return (
                    <div key={b.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{b.book_title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Hạn trả: <span className={isOverdue ? "text-destructive font-semibold" : "font-semibold"}>{new Date(b.due_date).toLocaleDateString("vi-VN")}</span>
                        </p>
                      </div>
                      <Badge variant={isOverdue ? "destructive" : "outline"} className="text-[10px]">
                        {isOverdue ? "Quá hạn" : "Đang mượn"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Recommendations Shortcut */}
        <Card className="bg-gradient-to-br from-primary/5 to-success/5 border border-primary/20">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" /> Gợi ý AI của bạn
            </CardTitle>
            <p className="text-xs text-muted-foreground">Gợi ý các cuốn sách hấp dẫn dựa trên thói quen đọc của bạn</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Công nghệ gợi ý thông minh Content-based của Athenaeum đã phân tích hồ sơ mượn của bạn để lọc ra các tác phẩm phù hợp nhất.
            </p>
            <Button className="w-full gap-2 mt-2" onClick={() => navigate("/recommendations")}>
              Xem gợi ý cá nhân hóa
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
