import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Sparkles, 
  BookOpen, 
  TrendingUp, 
  Star, 
  BookmarkPlus, 
  Clock, 
  Eye, 
  SlidersHorizontal, 
  RefreshCw, 
  CheckCircle2, 
  Compass, 
  Flame, 
  HeartHandshake, 
  Lightbulb, 
  Library,
  Layers,
  ChevronRight,
  Info
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";
import BookReviews from "@/components/book-reviews";

interface Book {
  id: number;
  title: string;
  author_id?: number;
  author_name?: string;
  category_id?: number;
  category_name?: string;
  publisher_name?: string;
  isbn?: string;
  published_year?: number;
  description?: string;
  cover_image?: string | null;
  total_copies: number;
  available_copies: number;
  avg_rating?: string | number;
  total_borrow_count?: number;
  total_review_count?: number;
  match_score: number;
  badge_label?: string;
  primary_reason?: string;
  match_reasons?: string[];
  is_currently_reading?: boolean;
  has_read_before?: boolean;
  is_holding?: boolean;
}

interface UserInsights {
  total_borrowed: number;
  unique_books_read: number;
  currently_reading_count: number;
  top_categories: { id: number; name: string; count: number }[];
  top_authors: { id: number; name: string; count: number }[];
  has_history: boolean;
  has_preferences: boolean;
  is_cold_start: boolean;
  reading_persona: string;
  configured_preferences?: {
    favorite_categories: number[];
    favorite_authors: number[];
    preferred_topics: string;
  };
}

interface TrendingCategory {
  id: number;
  label: string;
  borrow_count: number;
  percentage: number;
  trend_badge: string;
}

export default function RecommendationsPage() {
  const [recs, setRecs] = useState<Book[]>([]);
  const [userInsights, setUserInsights] = useState<UserInsights | null>(null);
  const [trendingCats, setTrendingCats] = useState<TrendingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeMode, setActiveMode] = useState<string>("hybrid");

  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>("all");

  // Preferences Dialog States
  const [prefDialogOpen, setPrefDialogOpen] = useState(false);
  const [allCategories, setAllCategories] = useState<{ id: number; name: string; book_count: number }[]>([]);
  const [allAuthors, setAllAuthors] = useState<{ id: number; name: string; book_count: number }[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [selectedAuthorIds, setSelectedAuthorIds] = useState<number[]>([]);
  const [preferredTopics, setPreferredTopics] = useState<string>("");
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  // Book Detail Dialog State
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedBookForDetail, setSelectedBookForDetail] = useState<Book | null>(null);

  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();

  const fetchRecommendations = async (mode = activeMode, showRefreshToast = false, catFilter = selectedCategoryFilter) => {
    if (showRefreshToast) setRefreshing(true);
    else setLoading(true);

    try {
      const catParam = catFilter && catFilter !== "all" ? `&category_id=${catFilter}` : "";
      const response = await api.get(`/recommendations?mode=${mode}&limit=12${catParam}`);
      if (response.data) {
        setRecs(response.data.recommendations || []);
        setUserInsights(response.data.user_insights || null);

        // Nếu là độc giả mới (Cold Start) và chưa cấu hình, gợi ý mở modal thiết lập sở thích
        if (response.data.user_insights?.is_cold_start && !sessionStorage.getItem("onboarding_shown")) {
          sessionStorage.setItem("onboarding_shown", "true");
          handleOpenPreferences();
        }
      }
      if (showRefreshToast) {
        toast.success("Hệ thống đã tính toán lại và làm mới danh sách gợi ý!");
      }
    } catch (error) {
      console.error("Lỗi khi tải gợi ý sách:", error);
      toast.error("Không thể tải gợi ý sách. Vui lòng thử lại sau.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCategoryFilter = (catId: string) => {
    setSelectedCategoryFilter(catId);
    fetchRecommendations(activeMode, false, catId);
  };

  const loadMetadata = async () => {
    try {
      const res = await api.get("/recommendations/preferences");
      if (res.data) {
        setAllCategories(res.data.all_categories || []);
        setAllAuthors(res.data.all_authors || []);
        const currentPrefs = res.data.preferences || {};
        setSelectedCategoryIds((currentPrefs.favorite_categories || []).map(Number));
        setSelectedAuthorIds((currentPrefs.favorite_authors || []).map(Number));
        setPreferredTopics(currentPrefs.preferred_topics || "");
      }
    } catch (e) {}
  };

  const fetchTrendingInsights = async () => {
    try {
      const response = await api.get("/recommendations/trending");
      if (response.data && response.data.trending_categories) {
        setTrendingCats(response.data.trending_categories);
      }
    } catch (error) {
      console.error("Lỗi khi tải xu hướng thư viện:", error);
    }
  };

  const handleOpenPreferences = async () => {
    try {
      const res = await api.get("/recommendations/preferences");
      if (res.data) {
        setAllCategories(res.data.all_categories || []);
        setAllAuthors(res.data.all_authors || []);
        const currentPrefs = res.data.preferences || {};
        setSelectedCategoryIds((currentPrefs.favorite_categories || []).map(Number));
        setSelectedAuthorIds((currentPrefs.favorite_authors || []).map(Number));
        setPreferredTopics(currentPrefs.preferred_topics || "");
      }
      setPrefDialogOpen(true);
    } catch (error) {
      console.error("Lỗi khi mở tùy chỉnh sở thích:", error);
      toast.error("Không thể tải danh sách thể loại và tác giả");
    }
  };

  const handleSavePreferences = async () => {
    setIsSavingPrefs(true);
    try {
      const res = await api.post("/recommendations/preferences", {
        favorite_categories: selectedCategoryIds,
        favorite_authors: selectedAuthorIds,
        preferred_topics: preferredTopics
      });
      toast.success(res.data.message || "Đã lưu hồ sơ sở thích AI thành công!");
      setPrefDialogOpen(false);
      fetchRecommendations(activeMode);
    } catch (error: any) {
      console.error("Lỗi lưu sở thích:", error);
      toast.error(error.response?.data?.message || "Lỗi khi lưu sở thích");
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const toggleCategorySelection = (catId: number) => {
    setSelectedCategoryIds(prev => 
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  const toggleAuthorSelection = (authorId: number) => {
    setSelectedAuthorIds(prev => 
      prev.includes(authorId) ? prev.filter(id => id !== authorId) : [...prev, authorId]
    );
  };

  const handleModeChange = (newMode: string) => {
    setActiveMode(newMode);
    fetchRecommendations(newMode);
  };

  // Mượn sách hoặc đặt trước
  const handleRegisterBorrow = (book: Book) => {
    const isAvailable = book.available_copies > 0;
    confirm({
      title: isAvailable 
        ? "Đăng ký mượn online (Giữ chỗ 24h trước khi đến)?" 
        : "Đặt trước cuốn sách này (Xếp hàng đợi)?",
      description: isAvailable
        ? `Bạn đang ở nhà và thích cuốn "${book.title}"?\n\n🛡️ Hệ thống sẽ TẠM GIỮ RIÊNG 1 cuốn này cho bạn trong vòng 24 giờ để người khác không mượn mất trong thời gian bạn đến thư viện.\n\n📍 Trong vòng 24h, bạn hãy đến thư viện, vào kệ lấy cuốn sách này mang ra quầy và xuất trình Thẻ độc giả QR để Thủ thư duyệt trao sách.`
        : `Đầu sách "${book.title}" hiện đã được các độc giả khác mượn hết (0 bản sao sẵn có trong kho).\n\nBạn có muốn đăng ký Đặt trước để xếp hàng không? Khi có độc giả hoàn trả sách về thư viện, hệ thống sẽ ưu tiên giữ sách 48h cho bạn và gửi thông báo hỏi bạn có muốn mượn không!`,
      confirmText: isAvailable ? "Xác nhận giữ chỗ (24h)" : "Xác nhận xếp hàng",
      cancelText: "Hủy bỏ",
      onConfirm: async () => {
        try {
          if (isAvailable) {
            const res = await api.post("/borrow/drafts", { bookIds: [book.id] });
            toast.success(res.data.message || "Đã đăng ký mượn online và tạo mã QR phiếu mượn thành công!");
          } else {
            const res = await api.post("/reservations", { bookId: book.id });
            toast.success(res.data.message || "Đã ghi nhận đặt trước vào hàng đợi!");
          }
          fetchRecommendations(activeMode);
        } catch (error: any) {
          console.error("Lỗi khi mượn/đặt trước:", error);
          toast.error(error.response?.data?.message || "Không thể thực hiện yêu cầu này");
        }
      }
    });
  };

  const getCategoryIcon = (name: string) => {
    if (name.includes("Văn học")) return "📖";
    if (name.includes("Khoa học")) return "🚀";
    if (name.includes("Kinh tế") || name.includes("Kinh doanh")) return "💼";
    if (name.includes("Kỹ năng")) return "🧘";
    if (name.includes("Lịch sử") || name.includes("Triết")) return "📜";
    if (name.includes("Thiếu nhi")) return "👶";
    return "📚";
  };

  useEffect(() => {
    fetchRecommendations();
    fetchTrendingInsights();
    loadMetadata();
  }, []);

  return (
    <div className="space-y-6">
      {/* 1. HERO HEADER: PERSONA & READING PROFILE */}
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/15 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-primary to-emerald-600 text-primary-foreground grid place-items-center shadow-md shrink-0">
                <Sparkles className="h-7 w-7 text-white animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                    Gợi ý Sách Phù Hợp cho {user?.fullName || "Bạn"}
                  </h2>
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-xs font-semibold gap-1">
                    <Compass className="h-3 w-3" />
                    {userInsights?.reading_persona || "Độc giả khám phá tri thức"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                  Hệ thống phân tích tương đồng nội dung (Content-Based Filtering) kết hợp giữa sở thích thể loại, tác giả yêu thích,
                  lịch sử mượn đọc thực tế và xu hướng cộng đồng để đề xuất các tựa sách phù hợp nhất cho bạn.
                </p>

                {/* Quick insights stats badges */}
                <div className="flex items-center gap-2 pt-2 flex-wrap text-xs">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background/80 border text-[11px] shadow-2xs font-medium">
                    <BookOpen className="h-3.5 w-3.5 text-primary" />
                    <span>Đã mượn: <strong>{userInsights?.total_borrowed || 0}</strong> lượt</span>
                  </div>
                  {userInsights?.top_categories && userInsights.top_categories.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background/80 border text-[11px] shadow-2xs font-medium">
                      <Layers className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Gu đọc: <strong>{userInsights.top_categories.slice(0, 2).map(c => c.name).join(", ")}</strong></span>
                    </div>
                  )}
                  {userInsights?.top_authors && userInsights.top_authors.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background/80 border text-[11px] shadow-2xs font-medium">
                      <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                      <span>Tác giả ruột: <strong>{userInsights.top_authors[0]?.name}</strong></span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions in Hero */}
            <div className="flex items-center gap-2.5 shrink-0 self-start lg:self-center">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-9 font-medium border-primary/30 hover:bg-primary/10 text-primary shadow-2xs"
                onClick={handleOpenPreferences}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Tùy chỉnh sở thích đọc
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={refreshing || loading}
                className="gap-1.5 text-xs h-9 shadow-2xs"
                onClick={() => fetchRecommendations(activeMode, true)}
                title="Làm mới lại kết quả gợi ý AI"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. ONBOARDING / COLD-START BANNER (Dành cho độc giả mới chưa có lịch sử mượn hoặc chưa lưu sở thích) */}
      {userInsights?.is_cold_start && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                <Lightbulb className="h-5 w-5" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-foreground">Bạn là độc giả mới hoặc chưa thiết lập sở thích?</p>
                <p className="text-muted-foreground mt-0.5">
                  Hãy chọn 2-3 thể loại hoặc tác giả bạn quan tâm để AI lập tức cá nhân hóa danh sách gợi ý chính xác nhất nhé!
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleOpenPreferences}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 shrink-0 h-8 shadow-xs"
            >
              <HeartHandshake className="h-3.5 w-3.5" /> Chọn sở thích ngay
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 3. ALGORITHM TABS & MODE SELECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
        <Tabs value={activeMode} onValueChange={handleModeChange} className="w-full sm:w-auto">
          <TabsList className="grid grid-cols-2 sm:flex sm:flex-row h-auto p-1 bg-muted/60 gap-1 rounded-xl">
            <TabsTrigger value="hybrid" className="text-xs gap-1.5 py-1.5 px-3">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Hybrid AI (Đa chiều)
            </TabsTrigger>
            <TabsTrigger value="cbf" className="text-xs gap-1.5 py-1.5 px-3">
              <Layers className="h-3.5 w-3.5 text-emerald-600" /> Thể loại & Tác giả (CBF)
            </TabsTrigger>
            <TabsTrigger value="preferences" className="text-xs gap-1.5 py-1.5 px-3">
              <SlidersHorizontal className="h-3.5 w-3.5 text-blue-600" /> Theo sở thích đã lưu
            </TabsTrigger>
            <TabsTrigger value="trending" className="text-xs gap-1.5 py-1.5 px-3">
              <Flame className="h-3.5 w-3.5 text-orange-500" /> Thịnh hành thư viện
            </TabsTrigger>
            <TabsTrigger value="top_rated" className="text-xs gap-1.5 py-1.5 px-3">
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> Đánh giá cao nhất
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <span className="text-xs text-muted-foreground shrink-0">
          Tìm thấy <strong>{recs.length}</strong> tựa sách phù hợp
        </span>
      </div>

      {/* 3.1 QUICK CATEGORY FILTER CHIPS BAR */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <Button
          variant={selectedCategoryFilter === "all" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs rounded-full px-3 gap-1 shrink-0 font-medium"
          onClick={() => handleCategoryFilter("all")}
        >
          ✨ Tất cả chủ đề
        </Button>
        {allCategories.map(cat => (
          <Button
            key={cat.id}
            variant={selectedCategoryFilter === cat.id.toString() ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs rounded-full px-3 gap-1 shrink-0 font-medium"
            onClick={() => handleCategoryFilter(cat.id.toString())}
          >
            {getCategoryIcon(cat.name)} {cat.name} <span className="opacity-75 text-[10px]">({cat.book_count})</span>
          </Button>
        ))}
      </div>

      {/* 4. RECOMMENDATION BOOK CARDS GRID */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
          <p className="text-xs text-muted-foreground animate-pulse">AI đang phân tích sở thích & tính toán điểm tương đồng...</p>
        </div>
      ) : recs.length === 0 ? (
        <div className="text-center py-16 border rounded-2xl bg-muted/20 space-y-3">
          <Library className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="font-semibold text-sm">Chưa có đầu sách phù hợp với bộ lọc hiện tại</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Bạn có thể chuyển sang chế độ <strong>Hybrid AI</strong> hoặc bấm <strong>Tùy chỉnh sở thích</strong> để mở rộng chủ đề sách gợi ý.
          </p>
          <Button size="sm" variant="outline" className="text-xs gap-1.5 mt-2" onClick={handleOpenPreferences}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Cài đặt sở thích
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {recs.map((b) => (
            <Card 
              key={b.id} 
              className="group overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-1 border flex flex-col justify-between"
            >
              <div>
                {/* Book Cover Area */}
                <div 
                  className="relative h-44 bg-gradient-to-br from-primary/10 via-accent/30 to-terracotta/10 overflow-hidden flex items-center justify-center cursor-pointer"
                  onClick={() => {
                    setSelectedBookForDetail(b);
                    setDetailDialogOpen(true);
                  }}
                  title="Bấm để xem chi tiết & tóm tắt sách"
                >
                  {b.cover_image ? (
                    <img 
                      src={b.cover_image} 
                      alt={b.title} 
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" 
                    />
                  ) : (
                    <div className="text-5xl select-none">📚</div>
                  )}

                  {/* Category tag */}
                  <Badge className="absolute top-2.5 left-2.5 bg-background/90 text-foreground border-0 shadow-xs text-[10px]">
                    {b.category_name || "Chung"}
                  </Badge>

                  {/* Match Score Badge with Gradient */}
                  <Badge 
                    className={`absolute top-2.5 right-2.5 border-0 shadow-sm text-[10px] font-bold gap-1 px-2 py-0.5 ${
                      b.match_score >= 90 
                        ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white animate-pulse" 
                        : b.match_score >= 80 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted/90 text-foreground"
                    }`}
                  >
                    <Sparkles className="h-3 w-3 text-gold" />
                    {b.match_score}% Phù hợp
                  </Badge>

                  {/* Secondary status badge at bottom of cover if reading or read */}
                  {b.badge_label && (
                    <Badge 
                      variant="outline" 
                      className="absolute bottom-2 left-2.5 bg-background/90 backdrop-blur-xs text-[10px] font-medium border-border/80 shadow-2xs"
                    >
                      {b.badge_label}
                    </Badge>
                  )}
                </div>

                {/* Book Metadata & Title */}
                <CardContent className="p-4 space-y-2.5">
                  <div>
                    <h3 
                      onClick={() => {
                        setSelectedBookForDetail(b);
                        setDetailDialogOpen(true);
                      }}
                      className="font-display text-sm font-bold leading-snug line-clamp-1 group-hover:text-primary transition-colors cursor-pointer" 
                      title={b.title}
                    >
                      {b.title}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      ✍️ {b.author_name || "Khuyết danh"}
                    </p>
                  </div>

                  {/* EXPLAINABLE AI (XAI) REASON BOX */}
                  <div 
                    className="rounded-lg bg-primary/5 hover:bg-primary/10 border border-primary/15 p-2.5 text-[11px] leading-relaxed transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedBookForDetail(b);
                      setDetailDialogOpen(true);
                    }}
                    title="Bấm để xem các căn cứ gợi ý chi tiết của AI"
                  >
                    <div className="flex items-start gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-foreground block">
                          {b.primary_reason || "Phù hợp với sở thích đọc của bạn"}
                        </span>
                        {b.match_reasons && b.match_reasons.length > 1 && (
                          <span className="text-[10px] text-muted-foreground block mt-0.5 line-clamp-1">
                            • {b.match_reasons[1]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Rating & Stock status */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t">
                    <div className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-semibold text-[11px]">
                        {b.avg_rating && parseFloat(b.avg_rating as string) > 0 
                          ? parseFloat(b.avg_rating as string).toFixed(1) 
                          : "Chưa có"}
                      </span>
                      {b.total_review_count !== undefined && b.total_review_count > 0 && (
                        <span className="text-[10px] text-muted-foreground">({b.total_review_count})</span>
                      )}
                      {b.total_borrow_count !== undefined && b.total_borrow_count > 0 && (
                        <span className="text-[10px] text-muted-foreground">• {b.total_borrow_count} lượt mượn</span>
                      )}
                    </div>
                    <span className={b.available_copies > 0 ? "text-emerald-600 font-semibold text-[11px]" : "text-destructive font-semibold text-[11px]"}>
                      {b.available_copies > 0 ? `Còn ${b.available_copies}/${b.total_copies} cuốn` : "Đã hết sách"}
                    </span>
                  </div>
                </CardContent>
              </div>

              {/* Card Action Buttons (Đồng bộ với tiêu chuẩn giao diện mượn sách) */}
              <div className="p-4 pt-0 space-y-1.5">
                <Button 
                  size="sm" 
                  variant="outline"
                  className="w-full text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 h-8 font-medium"
                  onClick={() => {
                    setSelectedBookForDetail(b);
                    setDetailDialogOpen(true);
                  }}
                >
                  <Eye className="h-3.5 w-3.5" /> Xem chi tiết
                </Button>

                {b.is_holding ? (
                  <Button 
                    size="sm" 
                    variant="outline"
                    disabled
                    className="w-full text-xs gap-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-semibold h-8 cursor-default"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> 
                    Đã giữ chỗ 24h (Chờ nhận)
                  </Button>
                ) : b.available_copies > 0 ? (
                  <Button 
                    size="sm" 
                    className="w-full text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs h-8"
                    title="Đăng ký giữ chỗ cuốn sách này trong 24 giờ trước khi đến lấy"
                    onClick={() => handleRegisterBorrow(b)}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" /> 
                    Đăng ký mượn online
                  </Button>
                ) : (
                  <Button 
                    size="sm" 
                    className="w-full text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs h-8"
                    title="Đầu sách đã hết bản sao, bấm để xếp hàng đặt trước khi có sách hoàn trả"
                    onClick={() => handleRegisterBorrow(b)}
                  >
                    <Clock className="h-3.5 w-3.5" /> 
                    Hết sách • Đặt trước
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 5. REAL LIBRARY TRENDING SECTION (Dựa trên dữ liệu mượn trả thực tế) */}
      <Card className="border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary animate-pulse" /> Đang thịnh hành trong thư viện
            </CardTitle>
            <span className="text-[11px] text-muted-foreground">Thống kê tự động từ giao dịch mượn thực tế</span>
          </div>
          <CardDescription className="text-xs">
            Các thể loại có tỷ lệ độc giả mượn đọc cao nhất trong toàn bộ hệ thống thư viện Athenaeum.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {trendingCats.length > 0 ? trendingCats.map((c) => (
              <div 
                key={c.id} 
                className="rounded-xl border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-xs cursor-pointer flex flex-col justify-between"
                onClick={() => {
                  setSelectedCategoryIds([c.id]);
                  handleModeChange("cbf");
                }}
                title={`Nhấn để xem các sách thuộc thể loại ${c.label}`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground truncate">{c.label}</p>
                    <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                      {c.trend_badge}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ghi nhận <strong>{c.borrow_count}</strong> lượt mượn đọc
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between pt-2 border-t text-[11px] text-primary font-medium">
                  <span>Khám phá sách thể loại này</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </div>
            )) : (
              [
                { label: "Văn học & Nghệ thuật", stat: "+45% lượt mượn" },
                { label: "Vũ trụ & Khoa học", stat: "+32% lượt mượn" },
                { label: "Kinh doanh & Khởi nghiệp", stat: "+28% lượt mượn" },
                { label: "Kỹ năng & Thấu cảm", stat: "+50% lượt mượn" }
              ].map((c) => (
                <div key={c.label} className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-semibold">{c.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{c.stat}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* 6. DIALOG: TÙY CHỈNH HỒ SƠ SỞ THÍCH ĐỌC (AI PREFERENCES MODAL) */}
      <Dialog open={prefDialogOpen} onOpenChange={setPrefDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-lg">
              <SlidersHorizontal className="h-5 w-5 text-primary" /> 
              {userInsights?.is_cold_start 
                ? "Chào mừng bạn! Thiết lập Sở thích Đọc Ban đầu" 
                : "Thiết lập Hồ sơ Sở thích Đọc (Reader Preferences)"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {userInsights?.is_cold_start 
                ? "Hãy chọn 1 hoặc nhiều thể loại và tác giả bạn yêu thích để hệ thống bắt đầu cá nhân hóa tủ sách riêng cho bạn." 
                : "Lựa chọn các nhóm thể loại và tác giả bạn yêu thích để hệ thống gợi ý chính xác danh mục sách phù hợp với bạn."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Category selection chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-emerald-600" /> Thể loại bạn quan tâm ({selectedCategoryIds.length} đã chọn):
                </span>
                <span className="text-[11px] text-muted-foreground">Nhấp để chọn / bỏ chọn</span>
              </div>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded-xl bg-muted/20">
                {allCategories.map(cat => {
                  const isSelected = selectedCategoryIds.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategorySelection(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 border ${
                        isSelected 
                          ? "bg-primary text-primary-foreground border-primary shadow-xs" 
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                      <span>{getCategoryIcon(cat.name)} {cat.name}</span>
                      <span className={`text-[10px] opacity-75 ${isSelected ? "text-primary-foreground" : "text-muted-foreground"}`}>
                        ({cat.book_count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Author selection chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" /> Tác giả yêu thích ({selectedAuthorIds.length} đã chọn):
                </span>
                <span className="text-[11px] text-muted-foreground">Theo dõi tác phẩm mới</span>
              </div>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded-xl bg-muted/20">
                {allAuthors.map(auth => {
                  const isSelected = selectedAuthorIds.includes(auth.id);
                  return (
                    <button
                      key={auth.id}
                      type="button"
                      onClick={() => toggleAuthorSelection(auth.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 border ${
                        isSelected 
                          ? "bg-amber-600 text-white border-amber-600 shadow-xs" 
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                      <span>{auth.name}</span>
                      <span className={`text-[10px] opacity-75 ${isSelected ? "text-white" : "text-muted-foreground"}`}>
                        ({auth.book_count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preferred Topics Keyword Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Từ khóa chủ đề cụ thể bạn quan tâm (tùy chọn):
              </label>
              <Input
                placeholder="Ví dụ: trí tuệ nhân tạo, khởi nghiệp, tâm lý học, vũ trụ, quản trị..."
                value={preferredTopics}
                onChange={(e) => setPreferredTopics(e.target.value)}
                className="text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                AI sẽ đối chiếu từ khóa này với tóm tắt nội dung các đầu sách để chấm điểm tương thích.
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => {
                setSelectedCategoryIds([]);
                setSelectedAuthorIds([]);
                setPreferredTopics("");
              }}
            >
              Đặt lại mặc định
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setPrefDialogOpen(false)}
              >
                {userInsights?.is_cold_start ? "Để sau (Xem sách thịnh hành trước)" : "Hủy"}
              </Button>
              <Button
                type="button"
                size="sm"
                className="text-xs gap-1.5 font-semibold bg-primary text-primary-foreground"
                disabled={isSavingPrefs}
                onClick={handleSavePreferences}
              >
                {isSavingPrefs ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Đang lưu...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> 
                    {userInsights?.is_cold_start ? "Bắt đầu khám phá tủ sách riêng" : "Lưu sở thích & Cập nhật gợi ý"}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 7. DIALOG: XEM CHI TIẾT SÁCH VÀ CĂN CỨ GỢI Ý CỦA AI */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedBookForDetail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-xs">
                    {selectedBookForDetail.category_name || "Tài liệu thư viện"}
                  </Badge>
                  <Badge className="bg-primary text-primary-foreground text-xs gap-1">
                    <Sparkles className="h-3 w-3 text-gold" /> {selectedBookForDetail.match_score}% Phù hợp
                  </Badge>
                  <span className={selectedBookForDetail.available_copies > 0 ? "text-emerald-600 font-semibold text-xs flex items-center gap-1" : "text-destructive font-semibold text-xs flex items-center gap-1"}>
                    <span className={`h-2 w-2 rounded-full ${selectedBookForDetail.available_copies > 0 ? "bg-emerald-500" : "bg-destructive"}`} />
                    {selectedBookForDetail.available_copies > 0 ? `Còn ${selectedBookForDetail.available_copies}/${selectedBookForDetail.total_copies} cuốn sẵn sàng` : "Tạm hết sách"}
                  </span>
                </div>
                <DialogTitle className="font-display text-xl leading-snug">
                  {selectedBookForDetail.title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Tác phẩm của tác giả <span className="font-semibold text-foreground">{selectedBookForDetail.author_name || "Khuyết danh"}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-3">
                {/* Book Cover */}
                <div className="flex flex-col items-center">
                  <div className="w-full h-52 bg-gradient-to-br from-primary/10 via-accent/20 to-terracotta/10 rounded-xl overflow-hidden border flex items-center justify-center shadow-sm">
                    {selectedBookForDetail.cover_image ? (
                      <img 
                        src={selectedBookForDetail.cover_image} 
                        alt={selectedBookForDetail.title} 
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-6xl select-none">📚</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2.5 text-xs text-muted-foreground">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="font-bold text-foreground">
                      {selectedBookForDetail.avg_rating && parseFloat(selectedBookForDetail.avg_rating as string) > 0 
                        ? `${parseFloat(selectedBookForDetail.avg_rating as string).toFixed(1)} / 5.0` 
                        : "Chưa có đánh giá"}
                    </span>
                    {selectedBookForDetail.total_review_count !== undefined && selectedBookForDetail.total_review_count > 0 && (
                      <span>({selectedBookForDetail.total_review_count} lượt)</span>
                    )}
                  </div>
                </div>

                {/* Metadata & Description */}
                <div className="md:col-span-2 space-y-3">
                  {/* AI Explainable Matching Box */}
                  <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                      <Sparkles className="h-4 w-4" />
                      <span>Vì sao AI gợi ý cuốn sách này cho bạn?</span>
                    </div>
                    <ul className="space-y-1.5 text-xs">
                      {selectedBookForDetail.match_reasons && selectedBookForDetail.match_reasons.map((reason, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-foreground/90">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-3 rounded-xl border">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">✍️ Tác giả:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.author_name || "Khuyết danh"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">🏢 Nhà xuất bản:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.publisher_name || "Chưa cập nhật"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">🔢 Mã ISBN:</span>
                      <span className="font-mono text-foreground font-semibold">{selectedBookForDetail.isbn || "Chưa có"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">📅 Năm xuất bản:</span>
                      <span className="font-semibold text-foreground">{selectedBookForDetail.published_year || "Chưa cập nhật"}</span>
                    </div>
                  </div>

                  {/* Description Box */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <Info className="h-4 w-4 text-primary" />
                      <span>Mô tả & Tóm tắt tác phẩm:</span>
                    </div>
                    <div className="bg-background border rounded-xl p-3 text-xs leading-relaxed text-muted-foreground max-h-36 overflow-y-auto">
                      {selectedBookForDetail.description ? (
                        <p className="text-foreground/90">{selectedBookForDetail.description}</p>
                      ) : (
                        <p className="italic">Chưa có đoạn văn tóm tắt chi tiết cho ấn phẩm này.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Book Reviews & Ratings Section */}
              <div className="pt-2 border-t">
                <BookReviews 
                  bookId={selectedBookForDetail.id} 
                  bookTitle={selectedBookForDetail.title}
                  onRatingUpdated={(newAvg, newCount) => {
                    setSelectedBookForDetail(prev => prev ? { ...prev, avg_rating: newAvg, total_review_count: newCount } : null);
                    setRecs(prev => prev.map(b => b.id === selectedBookForDetail.id ? { ...b, avg_rating: newAvg, total_review_count: newCount } : b));
                  }}
                />
              </div>

              {/* Dialog Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailDialogOpen(false)}
                  className="text-xs"
                >
                  Đóng
                </Button>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs"
                    onClick={() => {
                      setDetailDialogOpen(false);
                      handleRegisterBorrow(selectedBookForDetail);
                    }}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    {selectedBookForDetail.available_copies > 0 ? "Đăng ký mượn online (24h)" : "Đặt trước cuốn này"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
