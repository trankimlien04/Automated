import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Flame,
  Snowflake,
  Plus,
  MapPin,
  Clock,
  Users,
  ArrowRight,
  RefreshCw,
  BookOpen,
  CheckCircle2,
  QrCode,
  ArrowRightLeft,
  Eye,
} from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface BottleneckBook {
  id: number;
  title: string;
  author_name: string;
  category_name: string;
  isbn: string;
  cover_image?: string;
  location: string;
  total_copies: number;
  available_copies: number;
  active_borrows: number;
  active_holds?: number;
  waiting_queue: number;
  historical_borrows: number;
  demand_ratio: number;
  utilization_percent: number;
  severity: "critical" | "high" | "warning";
  current_wait_days: number;
  target_wait_days: number;
  recommended_add_copies: number;
  ai_recommendation: string;
}

export interface DeadStockBook {
  id: number;
  title: string;
  author_name: string;
  category_name: string;
  isbn: string;
  cover_image?: string;
  current_location: string;
  suggested_location: string;
  is_prime_shelf: boolean;
  action_type: "relocate_storage" | "feature_display";
  total_copies: number;
  available_copies: number;
  days_since_last_borrow: number;
  months_idle: number;
  historical_borrows: number;
  ai_recommendation: string;
}

interface ForecastResponse {
  summary: {
    bottleneckCount: number;
    totalRecommendedCopies: number;
    deadStockCount: number;
    primeShelfDeadStockCount: number;
  };
  bottlenecks: BottleneckBook[];
  deadStock: DeadStockBook[];
}

export function SmartDemandForecastPanel() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canExecuteWarehouseActions = user?.role === "librarian";
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [restockingId, setRestockingId] = useState<number | null>(null);
  const [relocatingId, setRelocatingId] = useState<number | null>(null);
  const [recentRequestMap, setRecentRequestMap] = useState<Record<number, string>>({});
  const [relocatedDoneMap, setRelocatedDoneMap] = useState<Record<number, string>>({});

  const fetchForecast = async () => {
    setLoading(true);
    try {
      const res = await api.get("/reports/demand-forecast");
      setData(res.data);
    } catch (error) {
      console.error("Lỗi khi tải dự báo nhu cầu AI:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchForecast();
  }, []);

  const handleQuickRestock = async (book: BottleneckBook) => {
    setRestockingId(book.id);
    try {
      const res = await api.post(`/books/${book.id}/restock`, {
        additionalCopies: book.recommended_add_copies,
        reason: `Đề xuất theo AI Demand Forecast (${book.ai_recommendation || "Nhu cầu mượn cao"})`,
      });
      const reqCode = res.data?.request?.request_code || `#${res.data?.request?.id || ""}`;
      setRecentRequestMap((prev) => ({ ...prev, [book.id]: reqCode }));
      toast.info(
        res.data?.message ||
          `Đã gửi phiếu đề xuất nhập +${book.recommended_add_copies} bản sao cho «${book.title}» chờ Chủ thư viện duyệt!`
      );
      await fetchForecast();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể gửi phiếu đề xuất nhập bổ sung bản sao");
    } finally {
      setRestockingId(null);
    }
  };

  const handleQuickRelocate = async (book: DeadStockBook) => {
    setRelocatingId(book.id);
    try {
      await api.put(`/books/${book.id}`, {
        location: book.suggested_location,
      });
      setRelocatedDoneMap((prev) => ({
        ...prev,
        [book.id]: book.suggested_location,
      }));
      toast.success(
        `Đã luân chuyển «${book.title}» từ [${book.current_location}] sang [${book.suggested_location}]!`
      );
      await fetchForecast();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể đổi vị trí kệ lúc này");
    } finally {
      setRelocatingId(null);
    }
  };

  if (loading && !data) {
    return (
      <Card className="border-primary/20 bg-card shadow-xs">
        <CardContent className="p-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          Đang phân tích tỷ lệ lưu thông, hàng đợi đặt trước & dự báo nhu cầu kho sách...
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { summary, bottlenecks, deadStock } = data;

  return (
    <Card className="border-border/80 bg-card shadow-sm overflow-hidden">
      <CardHeader className="pb-3.5 border-b bg-muted/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-display text-base sm:text-lg text-foreground">
                Tối ưu kho &amp; Nhu cầu mượn
              </CardTitle>
              {!canExecuteWarehouseActions && (
                <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground gap-1">
                  <Eye className="h-3 w-3" /> Chế độ giám sát
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Theo dõi đầu sách có hàng chờ cao và luân chuyển sách tồn kho lâu chưa phát sinh lượt mượn.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchForecast}
              disabled={loading}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Phân tích lại
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/books")}
              className="h-8 text-xs gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5" />{" "}
              {canExecuteWarehouseActions ? "Mở Kho Sách & QR" : "Xem Danh mục Sách"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-5">
        {/* Tóm tắt nhanh 2 chỉ số */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3.5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${
                  summary.bottleneckCount > 0
                    ? "bg-amber-500/12 text-amber-700"
                    : "bg-emerald-500/12 text-emerald-700"
                }`}
              >
                <Flame className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">Đầu sách quá tải</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {summary.bottleneckCount > 0
                    ? `Đề xuất nhập thêm +${summary.totalRecommendedCopies} bản`
                    : "Đang đáp ứng đủ nhu cầu mượn"}
                </p>
              </div>
            </div>
            <span
              className={`font-display text-lg font-bold tabular-nums shrink-0 ${
                summary.bottleneckCount > 0 ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {summary.bottleneckCount}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3.5 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-sky-500/12 text-sky-700 grid place-items-center shrink-0">
                <Snowflake className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground truncate">Sách tồn kho lạnh (&gt; 6 tháng)</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {summary.primeShelfDeadStockCount > 0
                    ? `${summary.primeShelfDeadStockCount} đầu sách đang ở kệ mặt tiền`
                    : "100% bản sao chưa có lượt mượn > 180 ngày"}
                </p>
              </div>
            </div>
            <span className="font-display text-lg font-bold tabular-nums text-sky-700 shrink-0">
              {summary.deadStockCount}
            </span>
          </div>
        </div>

        {/* PHẦN 1: ĐẦU SÁCH QUÁ TẢI */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-amber-600 shrink-0" />
              Đầu sách quá tải
            </h3>
            {bottlenecks.length > 0 && (
              <span className="text-[11px] text-amber-700 font-medium">
                Ưu tiên đề xuất nhập bổ sung
              </span>
            )}
          </div>

          {bottlenecks.length === 0 ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>Tất cả đầu sách hiện đáp ứng đủ nhu cầu, không có hàng chờ quá tải.</span>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {bottlenecks.slice(0, 4).map((b) => {
                const submittedReqCode = recentRequestMap[b.id];
                return (
                  <div
                    key={b.id}
                    className="rounded-xl border border-amber-500/25 bg-card p-3.5 space-y-2.5 hover:border-amber-500/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            onClick={() => navigate(`/books?search=${encodeURIComponent(b.title)}`)}
                            className="font-semibold text-sm text-foreground hover:text-primary cursor-pointer truncate"
                          >
                            {b.title}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 font-semibold ${
                              b.severity === "critical"
                                ? "bg-destructive/10 text-destructive border-destructive/30"
                                : "bg-amber-500/10 text-amber-700 border-amber-500/30"
                            }`}
                          >
                            Áp lực {b.demand_ratio}x
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {b.author_name} • {b.category_name} • {b.location}
                        </p>
                      </div>

                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-muted text-foreground shrink-0">
                        Còn {b.available_copies}/{b.total_copies}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-muted/40 px-2.5 py-2 text-[11px]">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3 text-primary shrink-0" />
                        Đang mượn:{" "}
                        <strong className="text-foreground">
                          {b.active_borrows}/{b.total_copies}
                        </strong>
                        {(b.active_holds ?? 0) > 0 && (
                          <span className="text-amber-600">(+{b.active_holds} giữ)</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3 text-amber-600 shrink-0" />
                        Hàng chờ: <strong className="text-amber-700">{b.waiting_queue}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-destructive shrink-0" />
                        Chờ: <strong className="text-destructive">{b.current_wait_days}d</strong>
                        <ArrowRight className="h-2.5 w-2.5" />
                        <strong className="text-emerald-600">
                          {b.target_wait_days === 0 ? "0d" : `${b.target_wait_days}d`}
                        </strong>
                      </span>
                    </div>

                    <Progress value={b.utilization_percent} className="h-1.5" />

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 border-l-2 border-amber-500/40 pl-2.5">
                      {b.ai_recommendation}
                    </p>

                    {submittedReqCode && (
                      <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 text-[11px] text-emerald-700 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <QrCode className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Đã gửi <strong className="font-mono">{submittedReqCode}</strong> (+{b.recommended_add_copies} bản)
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate("/book-requests")}
                          className="h-6 px-2 text-[10px] border-emerald-500/40"
                        >
                          Xem phiếu kho
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        Lịch sử: <strong className="text-foreground">{b.historical_borrows} lượt mượn</strong>
                      </span>
                      {canExecuteWarehouseActions ? (
                        <Button
                          size="sm"
                          onClick={() => handleQuickRestock(b)}
                          disabled={restockingId === b.id}
                          className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
                        >
                          {restockingId === b.id ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" /> Đang tạo phiếu...
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" /> Đề xuất nhập +{b.recommended_add_copies} bản
                            </>
                          )}
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-[11px] border-amber-500/30 text-amber-700 bg-amber-500/5">
                          Đề xuất +{b.recommended_add_copies} bản • Thủ thư xử lý
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* PHẦN 2: SÁCH TỒN KHO LẠNH */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Snowflake className="h-4 w-4 text-sky-600 shrink-0" />
              Sách tồn kho lạnh (&gt; 6 tháng chưa mượn)
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {deadStock.length > 0
                ? `Hiển thị ${Math.min(deadStock.length, 4)}/${summary.deadStockCount} đầu sách cần luân chuyển`
                : "Không có sách tồn kho lạnh"}
            </span>
          </div>

          {deadStock.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">
              Không phát hiện đầu sách tồn kho lạnh nào trên 6 tháng.
            </div>
          ) : (
            <div className="rounded-xl border divide-y bg-background overflow-hidden">
              {deadStock.slice(0, 4).map((d) => {
                const relocatedTo = relocatedDoneMap[d.id];
                const targetShelfLabel = d.suggested_location.split(" - ")[1] || d.suggested_location;
                return (
                  <div
                    key={d.id}
                    className="p-3.5 sm:px-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          onClick={() => navigate(`/books?search=${encodeURIComponent(d.title)}`)}
                          className="font-semibold text-sm text-foreground hover:text-primary cursor-pointer line-clamp-1"
                        >
                          {d.title}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 bg-sky-500/8 text-sky-700 border-sky-500/25 font-medium"
                        >
                          {d.days_since_last_borrow} ngày (~{d.months_idle} tháng)
                        </Badge>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          Tồn {d.available_copies}/{d.total_copies}
                        </span>
                      </div>

                      <p className="text-xs text-muted-foreground truncate">
                        {d.author_name} • {d.category_name} • 0 lượt mượn trong 6 tháng qua
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span>{d.current_location}</span>
                        {d.is_prime_shelf && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 font-medium">
                            Kệ mặt tiền
                          </span>
                        )}
                        <ArrowRight className="h-3 w-3 text-sky-600 shrink-0" />
                        <span className="font-medium text-sky-700">{d.suggested_location}</span>
                      </div>

                      {relocatedTo && (
                        <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[11px] text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Đã chuyển vị trí mới: <strong>{relocatedTo}</strong>
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-end gap-2">
                      {canExecuteWarehouseActions ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleQuickRelocate(d)}
                          disabled={relocatingId === d.id}
                          className="h-8 text-xs gap-1.5 border-sky-500/30 text-sky-700 hover:bg-sky-500/10 w-full sm:w-auto"
                        >
                          {relocatingId === d.id ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" /> Đang chuyển kệ...
                            </>
                          ) : (
                            <>
                              <ArrowRightLeft className="h-3.5 w-3.5" />{" "}
                              {d.is_prime_shelf
                                ? `Lùi về kệ trong (${targetShelfLabel})`
                                : `Đưa ra trưng bày (${targetShelfLabel})`}
                            </>
                          )}
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-[11px] border-sky-500/25 text-sky-700 bg-sky-500/5">
                          {d.is_prime_shelf
                            ? `Gợi ý lùi về ${targetShelfLabel}`
                            : `Gợi ý đưa ra ${targetShelfLabel}`} • Thủ thư xử lý
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

