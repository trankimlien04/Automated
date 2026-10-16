import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Download, Printer, BookOpen, CheckCircle, AlertCircle, RefreshCw, 
  DollarSign, TrendingUp, Clock, ArrowUpRight, ArrowDownLeft, Search, Filter
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, RadialBarChart, RadialBar, AreaChart, Area,
} from "recharts";
import api from "@/services/api";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ReportTransaction {
  id: number;
  action_type: "borrow" | "return";
  action_time: string;
  exact_time: string;
  formatted_datetime: string;
  user_id: number;
  reader_name: string;
  card_number: string;
  book_title: string;
  copy_code: string;
  status: string;
  due_date: string | null;
  staff_name: string;
}

interface AnalyticsData {
  period: "day" | "week" | "month" | "year";
  trendData: Array<{ label: string; borrow: number; return: number }>;
  onTimeRate: {
    percentage: number;
    onTimeCount: number;
    totalReturned: number;
  };
  topBooks: Array<{ id: number; title: string; author_name: string; borrows: number }>;
  categoryShare: Array<{ name: string; value: number }>;
  fineRevenue: Array<{ label: string; v: number }>;
  summary: {
    totalBorrows: number;
    totalReturns: number;
    totalFineAmount: number;
  };
  transactions: ReportTransaction[];
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("day");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "borrow" | "return">("all");

  const fetchAnalytics = async (selectedPeriod: "day" | "week" | "month" | "year") => {
    setLoading(true);
    try {
      const response = await api.get(`/reports/analytics?period=${selectedPeriod}`);
      setData(response.data);
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu phân tích:", error);
      toast.error("Không thể kết nối đến server để lấy báo cáo thống kê");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(period);
  }, [period]);

  const handlePeriodChange = (val: string) => {
    const p = val as "day" | "week" | "month" | "year";
    setPeriod(p);
  };

  const handlePrint = () => {
    window.print();
  };

  const filteredTransactions = useMemo(() => {
    if (!data?.transactions) return [];
    return data.transactions.filter(t => {
      const matchType = typeFilter === "all" || t.action_type === typeFilter;
      const matchSearch = !searchTerm.trim() || 
        t.reader_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.card_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.book_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.copy_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.exact_time?.includes(searchTerm);
      return matchType && matchSearch;
    });
  }, [data?.transactions, typeFilter, searchTerm]);

  const handleExportExcel = () => {
    if (!data) return;

    try {
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Tổng quan
      const summaryRows = [
        { "Chỉ tiêu": "Kỳ báo cáo", "Giá trị": period === "day" ? "Hôm nay" : period === "week" ? "7 ngày qua" : period === "year" ? "Năm nay" : "Tháng này" },
        { "Chỉ tiêu": "Tổng lượt mượn trong kỳ", "Giá trị": data.summary.totalBorrows },
        { "Chỉ tiêu": "Tổng lượt trả trong kỳ", "Giá trị": data.summary.totalReturns },
        { "Chỉ tiêu": "Tỷ lệ trả đúng hạn", "Giá trị": `${data.onTimeRate.percentage}% (${data.onTimeRate.onTimeCount}/${data.onTimeRate.totalReturned} lượt)` },
        { "Chỉ tiêu": "Tổng tiền phạt phát sinh (VNĐ)", "Giá trị": data.summary.totalFineAmount }
      ];
      const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Tong_Quan");

      // Sheet 2: Xu hướng mượn trả
      if (data.trendData?.length > 0) {
        const trendRows = data.trendData.map(t => ({
          "Mốc thời gian (Giờ/Ngày)": t.label,
          "Lượt mượn": t.borrow,
          "Lượt trả": t.return
        }));
        const trendSheet = XLSX.utils.json_to_sheet(trendRows);
        XLSX.utils.book_append_sheet(workbook, trendSheet, "Luu_Thong");
      }

      // Sheet 3: Danh sách giao dịch chi tiết theo giờ
      if (data.transactions?.length > 0) {
        const txRows = data.transactions.map((t, i) => ({
          "STT": i + 1,
          "Loại nghiệp vụ": t.action_type === "borrow" ? "Mượn sách" : "Trả sách",
          "Giờ thực hiện": t.exact_time,
          "Thời gian đầy đủ": t.formatted_datetime,
          "Độc giả": t.reader_name,
          "Mã thẻ độc giả": t.card_number,
          "Tên sách": t.book_title,
          "Mã bản sao QR": t.copy_code,
          "Hạn trả": t.due_date || "--",
          "Người tiếp nhận": t.staff_name
        }));
        const txSheet = XLSX.utils.json_to_sheet(txRows);
        XLSX.utils.book_append_sheet(workbook, txSheet, "Nhat_Ky_Chi_Tiet");
      }

      // Sheet 4: Top sách
      if (data.topBooks?.length > 0) {
        const bookRows = data.topBooks.map((b, i) => ({
          "Thứ hạng": i + 1,
          "Tên sách": b.title,
          "Tác giả": b.author_name,
          "Số lượt mượn": b.borrows
        }));
        const bookSheet = XLSX.utils.json_to_sheet(bookRows);
        XLSX.utils.book_append_sheet(workbook, bookSheet, "Top_Sach");
      }

      XLSX.writeFile(workbook, `Bao_Cao_Thong_Ke_${period.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Đã xuất file Excel báo cáo kèm nhật ký giao dịch theo giờ!");
    } catch (error) {
      console.error("Lỗi xuất Excel:", error);
      toast.error("Không thể xuất file Excel");
    }
  };

  const periodTitle = 
    period === "day" ? "Hôm nay" : 
    period === "week" ? "Tuần này (7 ngày qua)" : 
    period === "year" ? "Năm nay (12 tháng)" : "Tháng này";

  const gaugeData = [{
    name: "Đúng hạn",
    value: data?.onTimeRate?.percentage ?? 100,
    fill: "var(--chart-1, #2563eb)"
  }];

  return (
    <div className="space-y-6">
      {/* Header controls with Period Filter Tabs */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between bg-card p-4 rounded-2xl border shadow-xs">
        <div className="space-y-1">
          <h2 className="text-xl font-bold font-display tracking-tight flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" /> Báo Cáo Hoạt Động & Phân Tích
          </h2>
          <p className="text-xs text-muted-foreground">
            Dữ liệu thống kê thời gian thực theo khoảng thời gian đã chọn: <strong className="text-primary">{periodTitle}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={period} onValueChange={handlePeriodChange}>
            <TabsList className="grid grid-cols-4 bg-muted/80 p-1">
              <TabsTrigger value="day" className="text-xs font-semibold">Hôm nay</TabsTrigger>
              <TabsTrigger value="week" className="text-xs">Tuần</TabsTrigger>
              <TabsTrigger value="month" className="text-xs">Tháng</TabsTrigger>
              <TabsTrigger value="year" className="text-xs">Năm</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchAnalytics(period)} className="gap-1.5 text-xs h-9">
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5 text-xs h-9">
              <Printer className="h-3.5 w-3.5" /> In
            </Button>
            <Button size="sm" onClick={handleExportExcel} className="gap-1.5 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs">
              <Download className="h-3.5 w-3.5" /> Xuất Excel
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Lượt mượn ({periodTitle})</p>
              <p className="text-2xl font-bold font-display text-primary mt-1">
                {loading ? "..." : (data?.summary?.totalBorrows ?? 0)}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-emerald-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Lượt trả ({periodTitle})</p>
              <p className="text-2xl font-bold font-display text-emerald-600 mt-1">
                {loading ? "..." : (data?.summary?.totalReturns ?? 0)}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Tỷ lệ đúng hạn</p>
              <p className="text-2xl font-bold font-display text-amber-600 mt-1">
                {loading ? "..." : `${data?.onTimeRate?.percentage ?? 100}%`}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-destructive/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Doanh thu phạt</p>
              <p className="text-xl font-bold font-display text-destructive mt-1">
                {loading ? "..." : `${(data?.summary?.totalFineAmount ?? 0).toLocaleString("vi-VN")}đ`}
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts Grid */}
      {loading ? (
        <div className="flex justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Trend Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-display text-base">Xu hướng Lưu thông Mượn / Trả</CardTitle>
                    <CardDescription className="text-xs">
                      {period === "day" 
                        ? "Phân bổ chi tiết 24 giờ trong ngày (từ 00:00 đến 23:00)" 
                        : `Theo mốc thời gian (${periodTitle})`}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    {period === "day" ? "⏱️ Theo 24 Giờ" : period === "year" ? "Theo tháng" : "Theo chu kỳ"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-blue-600 inline-block"></span>
                    <span className="text-muted-foreground font-medium">Lượt mượn</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block"></span>
                    <span className="text-muted-foreground font-medium">Lượt trả</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data?.trendData || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis 
                      dataKey="label" 
                      stroke="var(--muted-foreground)" 
                      fontSize={11} 
                      interval={period === "day" ? 2 : 0}
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} 
                      formatter={(val: any, name: any) => [`${val} lượt`, name === "borrow" ? "Mượn" : "Trả"]}
                      labelFormatter={(lbl: string) => period === "day" ? `Khung giờ: ${lbl}` : `Thời gian: ${lbl}`}
                    />
                    <Line type="monotone" name="borrow" dataKey="borrow" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" name="return" dataKey="return" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* On-Time Rate Gauge */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">Tỉ lệ Độc Giả Trả Sách Đúng Hạn</CardTitle>
                <CardDescription className="text-xs">Đánh giá kỷ luật mượn sách trong kỳ</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center">
                <ResponsiveContainer width="100%" height={220}>
                  <RadialBarChart innerRadius="65%" outerRadius="100%" data={gaugeData} startAngle={180} endAngle={0}>
                    <RadialBar dataKey="value" cornerRadius={10} background={{ fill: "var(--muted)" }} />
                    <text x="50%" y="60%" textAnchor="middle" className="fill-foreground font-display" style={{ fontSize: 34, fontWeight: 700 }}>
                      {data?.onTimeRate?.percentage ?? 100}%
                    </text>
                    <text x="50%" y="75%" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 12 }}>
                      {data?.onTimeRate?.onTimeCount ?? 0} / {data?.onTimeRate?.totalReturned ?? 0} lượt trả đúng hạn
                    </text>
                  </RadialBarChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground text-center -mt-4">
                  {(data?.onTimeRate?.percentage ?? 100) >= 90 
                    ? "🎉 Tỷ lệ tuân thủ thời hạn mượn sách rất cao và ổn định." 
                    : "⚠️ Cần gửi thêm thông báo nhắc nhở các độc giả có sách sắp đến hạn."}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* DETAILED HOURLY TRANSACTIONS LOG TABLE */}
          <Card className="border shadow-xs">
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> 
                    {period === "day" ? "Nhật Ký Mượn / Trả Hôm Nay Theo Từng Giờ" : `Danh Sách Giao Dịch Mượn / Trả (${periodTitle})`}
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Hiển thị mốc thời gian chính xác theo từng giờ, phút của các lượt mượn và trả sách
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Tìm độc giả, mã thẻ, sách..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="h-8 pl-8 text-xs w-48 lg:w-64"
                    />
                  </div>

                  <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setTypeFilter("all")}
                      className={`px-2.5 py-1 rounded-md transition-all ${typeFilter === "all" ? "bg-background font-semibold shadow-xs text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Tất cả ({data?.transactions?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTypeFilter("borrow")}
                      className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${typeFilter === "borrow" ? "bg-blue-500/10 text-blue-600 font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <ArrowUpRight className="h-3 w-3" /> Mượn ({data?.transactions?.filter(t => t.action_type === 'borrow').length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTypeFilter("return")}
                      className={`px-2.5 py-1 rounded-md transition-all flex items-center gap-1 ${typeFilter === "return" ? "bg-emerald-500/10 text-emerald-600 font-semibold shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      <ArrowDownLeft className="h-3 w-3" /> Trả ({data?.transactions?.filter(t => t.action_type === 'return').length || 0})
                    </button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredTransactions.length === 0 ? (
                <div className="text-center py-12 px-4 text-muted-foreground">
                  <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm font-medium">Chưa có giao dịch mượn/trả nào được ghi nhận trong {periodTitle.toLowerCase()}</p>
                  <p className="text-xs text-muted-foreground/80 mt-1">Khi độc giả hoặc thủ thư thực hiện mượn/trả sách, dữ liệu kèm mốc giờ chính xác sẽ hiển thị tại đây.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 border-b text-muted-foreground font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Thời gian / Giờ thực hiện</th>
                        <th className="py-2.5 px-4">Nghiệp vụ</th>
                        <th className="py-2.5 px-4">Độc giả</th>
                        <th className="py-2.5 px-4">Tác phẩm & Bản sao</th>
                        <th className="py-2.5 px-4">Hạn trả</th>
                        <th className="py-2.5 px-4">Xử lý bởi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredTransactions.map((tx) => (
                        <tr key={`${tx.action_type}-${tx.id}`} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono text-[11px] font-bold bg-primary/5 text-primary border-primary/20 px-2 py-0.5">
                                🕒 {tx.exact_time}
                              </Badge>
                              {period !== "day" && (
                                <span className="text-[11px] text-muted-foreground">{tx.formatted_datetime.split(" ")[0]}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            {tx.action_type === "borrow" ? (
                              <Badge className="bg-blue-600/10 text-blue-700 hover:bg-blue-600/20 border-blue-200 gap-1 text-[11px] font-medium">
                                <ArrowUpRight className="h-3 w-3" /> Mượn sách
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/20 border-emerald-200 gap-1 text-[11px] font-medium">
                                <ArrowDownLeft className="h-3 w-3" /> Trả sách
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-foreground">{tx.reader_name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{tx.card_number || `ID: #${tx.user_id}`}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-foreground line-clamp-1">{tx.book_title}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">🏷️ {tx.copy_code || "Bản sao"}</div>
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {tx.due_date ? tx.due_date : "--"}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {tx.staff_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Books Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-display text-base">Top Sách Được Mượn Nhiều Nhất</CardTitle>
                    <CardDescription className="text-xs">Các tác phẩm có nhu cầu đọc cao nhất ({periodTitle})</CardDescription>
                  </div>
                  <Badge variant="secondary" className="text-xs">Top {data?.topBooks?.length || 0} tác phẩm</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data?.topBooks || []} margin={{ bottom: 25, top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis 
                      dataKey="title" 
                      stroke="var(--muted-foreground)" 
                      fontSize={11} 
                      angle={-15} 
                      textAnchor="end" 
                      height={50}
                      interval={0}
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} 
                      formatter={(val: any) => [`${val} lượt mượn`, "Số lượng"]}
                    />
                    <Bar dataKey="borrows" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Category Inventory Share */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">Quy Mô Kho Theo Thể Loại</CardTitle>
                <CardDescription className="text-xs">Số lượng bản sao sách phân bổ theo từng nhóm</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data?.categoryShare || []} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={11} width={100} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Fine Revenue Area Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">Tiền Phạt Phát Sinh (VNĐ)</CardTitle>
                <CardDescription className="text-xs">Số tiền phạt trễ hạn ghi nhận trong kỳ ({periodTitle})</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data?.fineRevenue || []}>
                    <defs>
                      <linearGradient id="grev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis 
                      dataKey="label" 
                      stroke="var(--muted-foreground)" 
                      fontSize={11}
                      interval={period === "day" ? 2 : 0} 
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                    <Tooltip 
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} 
                      formatter={(val: any) => [`${Number(val).toLocaleString('vi-VN')} đ`, "Tiền phạt"]}
                      labelFormatter={(lbl: string) => period === "day" ? `Khung giờ: ${lbl}` : `Thời gian: ${lbl}`}
                    />
                    <Area type="monotone" dataKey="v" stroke="#ef4444" strokeWidth={2} fill="url(#grev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

