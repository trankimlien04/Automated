import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Flame,
  Snowflake,
  Sparkles,
  Plus,
  MapPin,
  Clock,
  Users,
  ArrowRight,
  RefreshCw,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  ArrowRightLeft,
} from "lucide-react";
import api from "@/services/api";
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
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [restockingId, setRestockingId] = useState<number | null>(null);
  const [relocatingId, setRelocatingId] = useState<number | null>(null);
  const [recentQrMap, setRecentQrMap] = useState<Record<number, string[]>>({});
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
      });
      const generated: string[] = res.data?.generatedQrCodes || [];
      setRecentQrMap((prev) => ({ ...prev, [book.id]: generated }));
      toast.success(
        res.data?.message ||
          `Đã nhập bổ sung +${book.recommended_add_copies} bản sao cho «${book.title}»!`
      );
      await fetchForecast();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể nhập bổ sung bản sao lúc này");
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
    <Card className="border-primary/25 bg-gradient-to-br from-card via-card to-primary/[0.03] shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary text-primary-foreground gap-1 text-[11px] px-2.5 py-0.5">
                <Sparkles className="h-3 w-3" /> AI Demand Forecasting & Smart Restock
              </Badge>
              <Badge variant="outline" className="text-[11px] border-amber-500/30 bg-amber-500/10 text-amber-700 font-semibold">
                🔥 {summary.bottleneckCount} đầu sách quá tải (Đề xuất nhập +{summary.totalRecommendedCopies} cuốn)
              </Badge>
              <Badge variant="outline" className="text-[11px] border-sky-500/30 bg-sky-500/10 text-sky-700 font-semibold">
                ❄️ {summary.deadStockCount} sách tồn kho lạnh (&gt; 6 tháng chưa mượn)
              </Badge>
            </div>
            <CardTitle className="font-display text-lg mt-1.5 flex items-center gap-2">
              Dự Báo Nhu Cầu & Cảnh Báo Nhập Sách / Tối Ưu Kệ Thông Minh
            </CardTitle>
            <CardDescription className="text-xs">
              Tự động phân tích tỷ lệ{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[11px]">
                (Số bản đang mượn + Số người xếp hàng đặt trước) / Số bản sao hiện có
              </code>{" "}
              để khuyến nghị nhập thêm sách quá tải hoặc luân chuyển sách tồn kho lạnh.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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
              <BookOpen className="h-3.5 w-3.5" /> Mở Kho Sách & QR
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* CỘT 1: ĐẦU SÁCH QUÁ TẢI (HIGH-DEMAND BOTTLENECKS) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 text-amber-600 grid place-items-center">
                  <Flame className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-display text-foreground flex items-center gap-1.5">
                    Đầu Sách Quá Tải (High-Demand Bottleneck)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Sách đang hết bản sao trên kệ hoặc có hàng đợi đặt trước kéo dài
                  </p>
                </div>
              </div>
              <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 border-amber-500/30 text-[10px]">
                Ưu tiên nhập kho
              </Badge>
            </div>

            {bottlenecks.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                Tất cả đầu sách hiện đều đáp ứng đủ nhu cầu, không có hàng chờ quá tải.
              </div>
            ) : (
              <div className="space-y-3">
                {bottlenecks.slice(0, 4).map((b) => {
                  const newlyGeneratedQrs = recentQrMap[b.id];
                  return (
                    <div
                      key={b.id}
                      className="rounded-xl border border-amber-500/25 bg-gradient-to-r from-amber-500/[0.05] via-background to-background p-3.5 transition hover:border-amber-500/40 shadow-2xs"
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
                              Áp lực: {b.demand_ratio}x
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {b.author_name} • <span className="font-medium text-foreground/80">{b.category_name}</span> • 📍 {b.location}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-muted text-foreground">
                            Còn {b.available_copies}/{b.total_copies} bản
                          </span>
                        </div>
                      </div>

                      {/* Thanh trạng thái mượn & hàng chờ */}
                      <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>
                            Đang mượn:{" "}
                            <strong className="text-foreground">
                              {b.active_borrows}/{b.total_copies}
                            </strong>
                            {(b.active_holds ?? 0) > 0 && (
                              <span className="text-amber-600 font-medium">
                                {" "}(+{b.active_holds} giữ chỗ)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>
                            Hàng chờ:{" "}
                            <strong className="text-amber-700">{b.waiting_queue} người</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span>
                            Chờ:{" "}
                            <strong className="text-destructive">{b.current_wait_days} ngày</strong>{" "}
                            <ArrowRight className="inline h-2.5 w-2.5" />{" "}
                            <strong className="text-emerald-600">
                              {b.target_wait_days === 0 ? "Có ngay (0d)" : `${b.target_wait_days} ngày`}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="mt-2">
                        <Progress value={b.utilization_percent} className="h-1.5" />
                      </div>

                      {/* Khuyến nghị thông minh nguyên văn theo chuẩn */}
                      <div className="mt-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2">
                        <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1 leading-relaxed">
                          <strong className="font-semibold">Khuyến nghị AI: </strong>
                          {b.ai_recommendation}
                        </div>
                      </div>

                      {newlyGeneratedQrs && newlyGeneratedQrs.length > 0 && (
                        <div className="mt-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 text-[11px] text-emerald-700 flex items-center gap-1.5 flex-wrap">
                          <QrCode className="h-3.5 w-3.5 shrink-0" />
                          <span>Đã sinh mã QR mới:</span>
                          {newlyGeneratedQrs.map((qr) => (
                            <Badge key={qr} variant="outline" className="font-mono text-[10px] bg-background">
                              {qr}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="mt-2.5 flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          Tổng lịch sử lưu thông: <strong>{b.historical_borrows} lượt mượn</strong>
                        </span>
                        <Button
                          size="sm"
                          onClick={() => handleQuickRestock(b)}
                          disabled={restockingId === b.id}
                          className="h-7 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white shadow-2xs"
                        >
                          {restockingId === b.id ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" /> Đang tạo QR...
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" /> Nhập bổ sung +{b.recommended_add_copies} bản sao (Tự sinh QR)
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* CỘT 2: SÁCH TỒN KHO LẠNH (DEAD STOCK > 6 THÁNG KHÔNG AI MƯỢN) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-sky-500/15 text-sky-600 grid place-items-center">
                  <Snowflake className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold font-display text-foreground flex items-center gap-1.5">
                    Sách Tồn Kho Lạnh (Dead Stock &gt; 6 Tháng)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    100% bản sao nằm im trên kệ &gt; 180 ngày • Gợi ý luân chuyển kệ hoặc trưng bày
                  </p>
                </div>
              </div>
              <Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/20 border-sky-500/30 text-[10px]">
                Tối ưu không gian kệ
              </Badge>
            </div>

            {deadStock.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-xs text-muted-foreground">
                Không phát hiện đầu sách tồn kho lạnh nào trên 6 tháng.
              </div>
            ) : (
              <div className="space-y-3">
                {deadStock.slice(0, 4).map((d) => {
                  const relocatedTo = relocatedDoneMap[d.id];
                  return (
                    <div
                      key={d.id}
                      className="rounded-xl border border-sky-500/25 bg-gradient-to-r from-sky-500/[0.05] via-background to-background p-3.5 transition hover:border-sky-500/40 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              onClick={() => navigate(`/books?search=${encodeURIComponent(d.title)}`)}
                              className="font-semibold text-sm text-foreground hover:text-primary cursor-pointer truncate"
                            >
                              {d.title}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 bg-sky-500/10 text-sky-700 border-sky-500/30 font-semibold"
                            >
                              ❄️ {d.days_since_last_borrow} ngày (~{d.months_idle} tháng)
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {d.author_name} • <span className="font-medium text-foreground/80">{d.category_name}</span>
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            Tồn {d.available_copies}/{d.total_copies} bản
                          </span>
                        </div>
                      </div>

                      {/* Sơ đồ dịch chuyển vị trí kệ */}
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-2 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>
                            Kệ hiện tại:{" "}
                            <strong className="text-foreground">{d.current_location}</strong>
                            {d.is_prime_shelf && (
                              <span className="ml-1 text-[10px] text-amber-600 font-semibold">
                                (Kệ mặt tiền)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-sky-700 font-semibold">
                          <ArrowRight className="h-3.5 w-3.5" />
                          <span>Đích: {d.suggested_location}</span>
                        </div>
                      </div>

                      {/* Gợi ý luân chuyển */}
                      <div className="mt-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2 text-xs text-sky-950 dark:text-sky-200 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
                        <div className="flex-1 leading-relaxed">
                          <strong className="font-semibold">Gợi ý luân chuyển: </strong>
                          {d.ai_recommendation}
                        </div>
                      </div>

                      {relocatedTo && (
                        <div className="mt-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 text-[11px] text-emerald-700 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          Đã cập nhật vị trí mới: <strong>{relocatedTo}</strong>
                        </div>
                      )}

                      <div className="mt-2.5 flex items-center justify-between gap-2 pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          0 lượt mượn trong 6 tháng qua
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleQuickRelocate(d)}
                          disabled={relocatingId === d.id}
                          className="h-7 text-xs gap-1 border-sky-500/30 text-sky-700 hover:bg-sky-500/10"
                        >
                          {relocatingId === d.id ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" /> Đang chuyển kệ...
                            </>
                          ) : (
                            <>
                              <ArrowRightLeft className="h-3 w-3" />{" "}
                              {d.is_prime_shelf
                                ? `Lùi về kệ trong (${d.suggested_location.split(" - ")[1]})`
                                : `Đưa ra kệ trưng bày (${d.suggested_location.split(" - ")[1]})`}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

