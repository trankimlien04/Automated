import { useState, useEffect } from "react";
import { Star, MessageSquare, Trash2, Send, CheckCircle2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Review {
  id: number;
  user_id: number;
  book_id: number;
  rating: number;
  comment?: string | null;
  created_at: string;
  user_name?: string;
  avatar_url?: string | null;
}

interface BookReviewsProps {
  bookId: number;
  bookTitle: string;
  onRatingUpdated?: (newAvg: number, totalCount: number) => void;
}

const RATING_LABELS: { [key: number]: string } = {
  1: "1★ - Rất không hài lòng",
  2: "2★ - Cần cải thiện",
  3: "3★ - Tạm ổn / Bình thường",
  4: "4★ - Rất hay & Bổ ích",
  5: "5★ - Xuất sắc, khuyên đọc!"
};

export default function BookReviews({ bookId, bookTitle, onRatingUpdated }: BookReviewsProps) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState<number>(0);
  const [totalReviews, setTotalReviews] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Form states
  const [rating, setRating] = useState<number>(5);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reviews/book/${bookId}`);
      if (res.data) {
        const reviewList: Review[] = res.data.reviews || [];
        setReviews(reviewList);
        const avg = parseFloat(res.data.avg_rating) || 0;
        const total = parseInt(res.data.total_reviews) || reviewList.length;
        setAvgRating(avg);
        setTotalReviews(total);

        // Check if current user already reviewed
        if (user) {
          const myRev = reviewList.find(r => r.user_id === user.id);
          if (myRev) {
            setHasReviewed(true);
            setRating(myRev.rating);
            setComment(myRev.comment || "");
          } else {
            setHasReviewed(false);
            setRating(5);
            setComment("");
          }
        }
      }
    } catch (error) {
      console.error("Lỗi tải đánh giá sách:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bookId) {
      fetchReviews();
    }
  }, [bookId]);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      toast.error("Vui lòng chọn số sao đánh giá (1 - 5 sao)");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post("/reviews", {
        book_id: bookId,
        rating,
        comment: comment.trim()
      });

      toast.success(res.data.message || "Đã lưu đánh giá thành công!");
      const newAvg = parseFloat(res.data.avg_rating) || rating;
      const newTotal = parseInt(res.data.total_reviews) || (hasReviewed ? totalReviews : totalReviews + 1);

      setAvgRating(newAvg);
      setTotalReviews(newTotal);
      setHasReviewed(true);

      if (onRatingUpdated) {
        onRatingUpdated(newAvg, newTotal);
      }

      fetchReviews();
    } catch (error: any) {
      console.error("Lỗi gửi đánh giá:", error);
      toast.error(error.response?.data?.message || "Không thể lưu đánh giá");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReview = async (reviewId: number) => {
    try {
      const res = await api.delete(`/reviews/${reviewId}`);
      toast.success(res.data.message || "Đã xóa đánh giá thành công");
      const newAvg = parseFloat(res.data.avg_rating) || 0;
      const newTotal = parseInt(res.data.total_reviews) || Math.max(0, totalReviews - 1);

      setAvgRating(newAvg);
      setTotalReviews(newTotal);
      setHasReviewed(false);
      setRating(5);
      setComment("");

      if (onRatingUpdated) {
        onRatingUpdated(newAvg, newTotal);
      }

      fetchReviews();
    } catch (error: any) {
      console.error("Lỗi xóa đánh giá:", error);
      toast.error(error.response?.data?.message || "Lỗi khi xóa đánh giá");
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {/* 1. RATING SUMMARY HEADER */}
      <div className="p-3.5 rounded-xl bg-muted/40 border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="text-center px-3 py-1 bg-background rounded-lg border shadow-2xs">
            <span className="font-display text-2xl font-bold text-foreground">
              {avgRating > 0 ? avgRating.toFixed(1) : "—"}
            </span>
            <span className="text-[10px] text-muted-foreground block">trên 5.0</span>
          </div>
          <div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    star <= Math.round(avgRating)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalReviews > 0 ? `Dựa trên ${totalReviews} lượt độc giả đánh giá` : "Chưa có lượt đánh giá nào"}
            </p>
          </div>
        </div>

        {hasReviewed && (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[11px] gap-1 py-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Bạn đã đánh giá cuốn này ({rating}★)
          </Badge>
        )}
      </div>

      {/* 2. FORM ĐÁNH GIÁ CỦA BẠN (DÀNH CHO ĐỘC GIẢ ĐÃ ĐĂNG NHẬP) */}
      <div className="p-4 rounded-xl border bg-card shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-xs text-foreground flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4 text-primary" />
            {hasReviewed ? "Chỉnh sửa đánh giá của bạn:" : "Đánh giá của bạn về cuốn sách:"}
          </span>
          <span className="text-[11px] font-medium text-amber-600">
            {RATING_LABELS[hoverRating || rating]}
          </span>
        </div>

        {/* Interactive Star Picker */}
        <div className="flex items-center gap-2 py-1">
          <span className="text-xs text-muted-foreground">Chọn số sao:</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                className="p-1 rounded-md transition-transform hover:scale-125 focus:outline-hidden cursor-pointer"
                title={RATING_LABELS[star]}
              >
                <Star
                  className={`h-6 w-6 transition-colors ${
                    star <= (hoverRating || rating)
                      ? "fill-amber-400 text-amber-400 drop-shadow-xs"
                      : "text-muted-foreground/30 hover:text-amber-300"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Comment textarea */}
        <Textarea
          placeholder="Viết nhận xét hoặc chia sẻ cảm nghĩ của bạn về nội dung cuốn sách này (tùy chọn)..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="text-xs resize-none"
        />

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground">
            Đánh giá của bạn sẽ giúp hệ thống AI gợi ý sách chính xác hơn cho bạn và cộng đồng!
          </span>
          <Button
            size="sm"
            onClick={handleSubmitReview}
            disabled={submitting}
            className="text-xs gap-1.5 font-semibold bg-primary text-primary-foreground h-8 shadow-xs"
          >
            <Send className="h-3.5 w-3.5" />
            {submitting ? "Đang gửi..." : hasReviewed ? "Cập nhật đánh giá" : "Gửi đánh giá"}
          </Button>
        </div>
      </div>

      {/* 3. DANH SÁCH NHẬN XÉT CỦA CỘNG ĐỒNG */}
      <div className="space-y-2.5">
        <span className="font-semibold text-xs text-foreground block">
          Nhận xét từ bạn đọc ({reviews.length}):
        </span>

        {loading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground bg-muted/10">
            Cuốn sách này chưa có nhận xét nào. Hãy là người đầu tiên để lại cảm nhận nhé!
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {reviews.map((rev) => {
              const isOwner = user?.id === rev.user_id;
              const canDelete = isOwner || user?.role === "admin" || user?.role === "librarian";

              return (
                <div key={rev.id} className="p-3 rounded-xl border bg-background text-xs space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={rev.avatar_url || ""} />
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                          {rev.user_name ? rev.user_name.charAt(0) : "U"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold text-foreground">{rev.user_name || "Độc giả ẩn danh"}</span>
                      {isOwner && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-primary border-primary/30">
                          Bạn
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`h-3 w-3 ${
                              s <= rev.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(rev.created_at).toLocaleDateString("vi-VN")}
                      </span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDeleteReview(rev.id)}
                          className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors cursor-pointer"
                          title="Xóa nhận xét này"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {rev.comment ? (
                    <p className="text-muted-foreground leading-relaxed pl-8">
                      “{rev.comment}”
                    </p>
                  ) : (
                    <p className="text-muted-foreground/60 italic text-[11px] pl-8">
                      (Độc giả chỉ chấm điểm sao, không kèm bình luận)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
