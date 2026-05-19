import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen, Users, ArrowRightLeft, AlertTriangle, TrendingUp, Sparkles,
  ArrowUpRight, ArrowDownRight, QrCode,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import {
  stats, monthlyTrend, categoryShare, topBooks, recentTransactions,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({ component: Dashboard });

const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)"];

function StatCard({
  icon: Icon, label, value, delta, trend, accent,
}: { icon: any; label: string; value: string; delta: string; trend: "up" | "down"; accent: string }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
          <div className="h-9 w-9 rounded-md grid place-items-center" style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: accent }}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-3 font-display text-3xl font-semibold tracking-tight">{value}</p>
        <div className="mt-2 flex items-center gap-1 text-xs">
          {trend === "up" ? <ArrowUpRight className="h-3 w-3 text-success" /> : <ArrowDownRight className="h-3 w-3 text-destructive" />}
          <span className={trend === "up" ? "text-success" : "text-destructive"}>{delta}</span>
          <span className="text-muted-foreground">so với tuần trước</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Hero strip */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Badge className="bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/20 border-0">
              <Sparkles className="mr-1 h-3 w-3" /> Hôm nay, 19/05/2026
            </Badge>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Chào buổi sáng, Thủ thư.
            </h2>
            <p className="mt-1 max-w-xl text-sm text-primary-foreground/80">
              Có <strong>{stats.borrowedToday}</strong> giao dịch mượn hôm nay và <strong>{stats.overdue}</strong> phiếu quá hạn cần xử lý.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="lg" variant="secondary" className="gap-2">
              <QrCode className="h-4 w-4" /> Quét QR mượn / trả
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={BookOpen} label="Tổng đầu sách" value={stats.totalBooks.toLocaleString("vi-VN")} delta="+1.2%" trend="up" accent="var(--chart-1)" />
        <StatCard icon={Users} label="Độc giả hoạt động" value={stats.totalReaders.toLocaleString("vi-VN")} delta="+3.4%" trend="up" accent="var(--chart-4)" />
        <StatCard icon={ArrowRightLeft} label="Mượn hôm nay" value={stats.borrowedToday.toString()} delta="+8.1%" trend="up" accent="var(--chart-3)" />
        <StatCard icon={AlertTriangle} label="Quá hạn" value={stats.overdue.toString()} delta="-12%" trend="down" accent="var(--chart-2)" />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-display">Xu hướng mượn / trả 12 tháng</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Tổng hợp giao dịch theo tháng</p>
            </div>
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="h-3 w-3" /> Tăng {stats.returnRate}%
            </Badge>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="borrow" stroke="var(--chart-1)" strokeWidth={2} fill="url(#g1)" />
                <Area type="monotone" dataKey="return" stroke="var(--chart-2)" strokeWidth={2} fill="url(#g2)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Thể loại phổ biến</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Tỉ lệ lượt mượn theo thể loại</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryShare} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {categoryShare.map((_, i) => <Cell key={i} fill={chartColors[i % chartColors.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {categoryShare.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: chartColors[i] }} />
                  <span className="text-muted-foreground">{c.name}</span>
                  <span className="ml-auto font-medium">{c.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top books + transactions */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="font-display">Sách được mượn nhiều nhất</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Top 7 trong 30 ngày qua</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topBooks} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis type="category" dataKey="title" stroke="var(--muted-foreground)" fontSize={11} width={140} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Bar dataKey="borrows" fill="var(--chart-1)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display">Giao dịch gần đây</CardTitle>
            <Button variant="ghost" size="sm">Xem tất cả</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentTransactions.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-start gap-3 rounded-md border border-border/60 p-3 hover:bg-accent/30 transition">
                <div className={`mt-0.5 h-2 w-2 rounded-full ${t.action === "borrow" ? "bg-primary" : t.action === "return" ? "bg-success" : "bg-destructive"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.book}</p>
                  <p className="text-xs text-muted-foreground truncate">{t.reader} · {t.code}</p>
                </div>
                <div className="text-right">
                  <Badge variant={t.action === "borrow" ? "default" : t.action === "return" ? "secondary" : "destructive"} className="text-[10px]">
                    {t.action === "borrow" ? "Mượn" : t.action === "return" ? "Trả" : "Quá hạn"}
                  </Badge>
                  <p className="mt-1 text-[10px] text-muted-foreground">{t.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Bottom: return rate + fines */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Tỉ lệ trả đúng hạn</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <span className="font-display text-5xl font-semibold">{stats.returnRate}%</span>
              <span className="mb-2 text-xs text-success">+2.1% tháng này</span>
            </div>
            <Progress value={stats.returnRate} className="mt-4 h-2" />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="font-display text-xl font-semibold text-success">2,148</p>
                <p className="text-xs text-muted-foreground">Đúng hạn</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="font-display text-xl font-semibold text-warning">98</p>
                <p className="text-xs text-muted-foreground">Trễ ≤ 3 ngày</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="font-display text-xl font-semibold text-destructive">34</p>
                <p className="text-xs text-muted-foreground">Trễ &gt; 3 ngày</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Doanh thu phạt tháng này</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-4xl font-semibold">{stats.finesThisMonth.toLocaleString("vi-VN")}<span className="ml-1 text-base font-sans text-muted-foreground">đ</span></p>
            <p className="mt-1 text-xs text-muted-foreground">23 phiếu phạt mới, 17 đã thanh toán</p>
            <ResponsiveContainer width="100%" height={140} className="mt-3">
              <AreaChart data={monthlyTrend.slice(-6).map(m => ({ month: m.month, v: Math.round(m.borrow * 0.18 * 1000) }))}>
                <defs>
                  <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--terracotta)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--terracotta)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Area type="monotone" dataKey="v" stroke="var(--terracotta)" strokeWidth={2} fill="url(#gf)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
