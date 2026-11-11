import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, Users, ArrowRightLeft, AlertTriangle, TrendingUp, Sparkles,
  ArrowUpRight, ArrowDownRight, QrCode, Clock, BookMarked, Wallet, Award,
  Shield, BarChart3, Crown, RefreshCw, Activity, ShieldCheck, Zap
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { SmartDemandForecastPanel } from "@/components/smart-demand-forecast-panel";

interface DashboardData {
  stats: {
    totalBooks: number;
    totalCopies: number;
    activeReaders: number;
    currentlyBorrowing: number;
    activeReservations: number;
    overdueCount: number;
    suspendedReadersCount?: number;
    pendingRemediationCount?: number;
    unpaidFinesSum: number;
  };
  popularBooks: Array<{ id: number; title: string; author_name: string; borrow_count: number }>;
  borrowTrends: Array<{ month: string; count: number }>;
  recentTransactions: Array<{ id: number; borrow_date: string; status: string; reader_name: string; book_title: string }>;
  unpaidFinesList?: Array<{
    id: number;
    amount: number;
    reason: string;
    violation_type?: string;
    severity?: string;
    remediation_status?: string;
    created_at: string;
    user_id: number;
    reader_name: string;
    card_number: string;
    book_title?: string;
  }>;
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return "Chào buổi sáng";
  if (hour >= 11 && hour < 14) return "Chào buổi trưa";
  if (hour >= 14 && hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
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
  const [readerCirculationStatus, setReaderCirculationStatus] = useState<any>(null);
  const [renewingId, setRenewingId] = useState<number | null>(null);

  const handleQuickRenewDashboard = async (borrowRecordId: number) => {
    setRenewingId(borrowRecordId);
    try {
      const res = await api.post("/borrow/renew", { borrowRecordId });
      toast.success(res.data?.message || "Gia hạn nhanh +7 ngày thành công!");
      await fetchReaderData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể gia hạn cuốn sách này");
    } finally {
      setRenewingId(null);
    }
  };

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
      const [historyRes, finesRes, resRes, statusRes] = await Promise.all([
        api.get("/borrow/records"),
        api.get("/fines"),
        api.get("/reservations"),
        api.get("/fines/circulation-status").catch(() => null)
      ]);
      setReaderHistory(historyRes.data);
      setReaderFines(finesRes.data);
      setReaderReservations(resRes.data);
      if (statusRes?.data) {
        setReaderCirculationStatus(statusRes.data);
      }
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
                <Sparkles className="mr-1 h-3 w-3 animate-pulse" />
                {isOwner
                  ? "👑 Trung tâm Điều hành Giám đốc"
                  : user?.role === "admin"
                    ? "🛡️ Quản trị IT & An ninh Hệ thống"
                    : "📖 Nghiệp vụ Bàn Lưu thông Thủ thư"}
              </Badge>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                {isOwner
                  ? `${getTimeBasedGreeting()}, Giám đốc ${user?.fullName}`
                  : user?.role === "admin"
                    ? `${getTimeBasedGreeting()}, Quản trị viên ${user?.fullName}`
                    : `${getTimeBasedGreeting()}, Thủ thư ${user?.fullName}`}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-primary-foreground/80">
                {isOwner
                  ? `Tổng quan toàn diện: ${stats.totalCopies} cuốn sách, ${stats.activeReaders} độc giả, ${stats.currentlyBorrowing} lượt đang lưu thông, ${stats.overdueCount} quá hạn, ${stats.suspendedReadersCount || 0} thẻ tạm ngưng và ${stats.pendingRemediationCount || 0} sách chờ khắc phục.`
                  : user?.role === "admin"
                    ? `Hạ tầng IT vận hành ổn định: ${stats.totalBooks} đầu sách (${stats.totalCopies} bản sao), ${stats.activeReaders} tài khoản độc giả và toàn bộ nhật ký audit được ghi nhận an toàn.`
                    : `Bàn lưu thông hôm nay ghi nhận đang có ${stats.currentlyBorrowing} lượt mượn sách hoạt động, ${stats.overdueCount} lượt quá hạn và ${stats.pendingRemediationCount || 0} hồ sơ chờ khắc phục.`}
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
              ) : user?.role === "admin" ? (
                <>
                  <Button size="lg" variant="secondary" onClick={() => navigate("/accounts")} className="gap-2 shadow-sm font-semibold">
                    <ShieldCheck className="h-4 w-4" /> Quản lý tài khoản
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => navigate("/activity-logs")} className="gap-2 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-primary-foreground/30">
                    <Activity className="h-4 w-4" /> Nhật ký an ninh (Audit)
                  </Button>
                </>
              ) : (
                <>
                  <Button size="lg" variant="secondary" onClick={() => navigate("/borrow")} className="gap-2 shadow-sm font-semibold">
                    <Zap className="h-4 w-4" /> Quầy Đa Năng Mượn / Trả
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => navigate("/books")} className="gap-2 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 border-primary-foreground/30">
                    <BookOpen className="h-4 w-4" /> Kho Sách & Mã QR
                  </Button>
                </>
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

        {/* Dự Báo Nhu Cầu & Cảnh Báo Nhập Sách Bằng AI (Smart Restock & Demand Forecasting) */}
        <SmartDemandForecastPanel />

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
                  <CardTitle className="font-display text-base">Vi phạm & Chờ khắc phục</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Quá hạn: <strong className="text-destructive font-bold">{stats.overdueCount || 0}</strong> • Đình chỉ:{" "}
                    <strong className="text-amber-600 font-bold">{stats.suspendedReadersCount || 0}</strong> • Chờ khắc phục:{" "}
                    <strong className="text-orange-600 font-bold">{stats.pendingRemediationCount || 0}</strong>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/fines")}
                  className="text-xs h-7 text-primary hover:text-primary gap-1 px-2"
                >
                  Sổ kỷ luật <ArrowUpRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between pt-1 pb-4">
              {!data.unpaidFinesList || data.unpaidFinesList.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  <AlertTriangle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-1.5" />
                  <p>Không có hồ sơ quá hạn hoặc chờ khắc phục</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {data.unpaidFinesList.map((f) => {
                    const isPendingRem = f.remediation_status === "pending_remediation" || f.violation_type === "damaged" || f.violation_type === "lost";
                    return (
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
                        <Badge
                          variant={isPendingRem ? "outline" : "destructive"}
                          className={`text-[10px] font-semibold shrink-0 py-0.5 ${
                            isPendingRem ? "border-orange-500/40 text-orange-700 dark:text-orange-300" : ""
                          }`}
                        >
                          {isPendingRem ? "Chờ khắc phục" : "Đang quá hạn"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-8 gap-1.5 mt-3 border-destructive/20 text-destructive hover:bg-destructive/10"
                onClick={() => navigate("/fines")}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Mở Sổ Vi Phạm & Kỷ Luật Mượn
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
  const isDateOverdue = (dueDateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    return today.getTime() > due.getTime();
  };

  const getDaysDiff = (dueDateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const activeBorrows = readerHistory.filter(h => h.status === 'borrowing');
  const overdueActiveBorrows = activeBorrows.filter(b => isDateOverdue(b.due_date));
  const resolvedViolationsCount = readerFines.filter(f => f.status === 'paid').length;

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
              {getTimeBasedGreeting()}, {user?.fullName}!
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-white/85 leading-relaxed">
              Chúc bạn có những giờ phút đọc sách thú vị. Bạn đang giữ <strong>{activeBorrows.length}</strong> cuốn sách đang mượn và có{" "}
              <strong>{overdueActiveBorrows.length}</strong> cuốn sách quá hạn cần hoàn trả.
              {readerCirculationStatus && !readerCirculationStatus.eligibleToBorrow && (
                <span> {readerCirculationStatus.blockReason}.</span>
              )}
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
          {
            label: "Sách đang mượn",
            value: activeBorrows.length.toString(),
            icon: BookOpen,
            accent: "var(--chart-1)",
            desc:
              overdueActiveBorrows.length > 0
                ? `Có ${overdueActiveBorrows.length} cuốn đã quá hạn cần mang trả`
                : "Tất cả sách đang mượn đều còn trong hạn"
          },
          {
            label: "Phiếu đặt trước",
            value: activeReservationsCount.toString(),
            icon: Clock,
            accent: "var(--chart-3)",
            desc: "Sách đang xếp hàng đợi bạn"
          },
          {
            label: "Vi phạm & Kỷ luật thẻ",
            value:
              readerCirculationStatus?.eligibleToBorrow === false
                ? readerCirculationStatus.primaryStatus === "SUSPENDED"
                  ? `Tạm ngưng ${readerCirculationStatus.suspensionRemainingDays || 0} ngày`
                  : readerCirculationStatus.primaryStatus === "PENDING_REMEDIATION"
                  ? `${readerCirculationStatus.pendingRemediationCount || 0} chờ khắc phục`
                  : `${overdueActiveBorrows.length} quá hạn`
                : "Đủ điều kiện",
            icon: AlertTriangle,
            accent: "var(--chart-2)",
            desc:
              readerCirculationStatus?.eligibleToBorrow === false
                ? readerCirculationStatus.blockReason || "Quyền mượn tạm ngưng theo quy chế"
                : resolvedViolationsCount > 0
                  ? `Không còn vi phạm hiện hành (Đã xử lý ${resolvedViolationsCount} lượt trước đây)`
                  : "Không quá hạn, không tạm ngưng • Đủ điều kiện mượn sách"
          }
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
            <p className="text-xs text-muted-foreground">Danh sách bản sao sách bạn đang giữ. Vui lòng hoàn trả đúng hạn về thư viện.</p>
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
                  const isOverdue = isDateOverdue(b.due_date);
                  const diffDays = getDaysDiff(b.due_date);
                  const overdueDays = Math.max(1, Math.abs(diffDays));
                  const isDueToday = !isOverdue && diffDays === 0;
                  const isDueSoon = !isOverdue && diffDays >= 1 && diffDays <= 3;
                  const renewalCount = Number(b.renewal_count || 0);
                  const waitingRes = Number(b.waiting_reservations_count || 0);
                  const canQuickRenew = !isOverdue && renewalCount === 0 && waitingRes === 0;

                  return (
                    <div
                      key={b.id}
                      className={`py-3 px-2.5 my-1 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isOverdue
                          ? "border-destructive/40 bg-destructive/[0.04]"
                          : isDueToday
                            ? "border-amber-500/45 bg-amber-500/[0.06]"
                            : isDueSoon
                              ? "border-sky-500/35 bg-sky-500/[0.04]"
                              : "border-transparent"
                        }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm">{b.book_title}</p>
                          {b.qr_code && (
                            <code className="text-[10px] font-mono font-semibold text-primary/80 bg-primary/5 px-1.5 py-0.5 rounded border border-primary/15">
                              [{b.qr_code}]
                            </code>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Hạn trả:{" "}
                          <span
                            className={
                              isOverdue
                                ? "text-destructive font-semibold"
                                : isDueToday
                                  ? "text-amber-600 dark:text-amber-400 font-semibold"
                                  : "font-semibold"
                            }
                          >
                            {new Date(b.due_date).toLocaleDateString("vi-VN")}
                          </span>
                          {isOverdue && (
                            <span className="ml-1.5 text-[11px] text-destructive font-medium">
                              • 🔴 Quá hạn {overdueDays} ngày (Đang tạm khóa mượn mới — Hãy trả sách để mở khóa)
                            </span>
                          )}
                          {isDueToday && (
                            <span className="ml-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                              • 🟠 Đúng ngày đến hạn — Trả tại Quầy hoặc thả qua Hòm 24/7
                            </span>
                          )}
                          {isDueSoon && (
                            <span className="ml-1.5 text-[11px] text-sky-700 dark:text-sky-300 font-medium">
                              • 🔔 Còn {diffDays} ngày đến hạn {canQuickRenew ? "(Chưa có người đặt trước — Có thể gia hạn nhanh)" : ""}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {isOverdue ? (
                          <Badge
                            variant="destructive"
                            className="text-[10px] cursor-pointer"
                            onClick={() => navigate("/borrow")}
                          >
                            🔴 Quá hạn {overdueDays} ngày • Tạm khóa mượn mới
                          </Badge>
                        ) : isDueToday ? (
                          <>
                            <Badge
                              variant="outline"
                              onClick={() => navigate("/borrow")}
                              className="text-[10px] cursor-pointer bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/40 font-semibold"
                            >
                              🟠 Đến hạn hôm nay • Trả tại Quầy / Hòm 24/7
                            </Badge>
                            {canQuickRenew && (
                              <Button
                                size="sm"
                                disabled={renewingId === b.id}
                                onClick={() => handleQuickRenewDashboard(b.id)}
                                className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                              >
                                <RefreshCw className={`h-3 w-3 ${renewingId === b.id ? "animate-spin" : ""}`} />
                                <span>Gia hạn nhanh 1-Chạm (+7 ngày)</span>
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            {isDueSoon && canQuickRenew && (
                              <Button
                                size="sm"
                                disabled={renewingId === b.id}
                                onClick={() => handleQuickRenewDashboard(b.id)}
                                className="h-6 px-2.5 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs cursor-pointer"
                              >
                                <RefreshCw className={`h-3 w-3 ${renewingId === b.id ? "animate-spin" : ""}`} />
                                <span>Gia hạn nhanh 1-Chạm (+7 ngày)</span>
                              </Button>
                            )}
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${isDueSoon
                                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 font-semibold"
                                  : ""
                                }`}
                            >
                              {isDueSoon ? `🔔 Sắp đến hạn (Còn ${diffDays} ngày)` : `Đang mượn (Còn ${diffDays} ngày)`}
                            </Badge>
                          </>
                        )}
                      </div>
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
