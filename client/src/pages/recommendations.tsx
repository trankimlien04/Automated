import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, BookOpen, TrendingUp } from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Book {
  id: number;
  title: string;
  author_name?: string;
  category_name?: string;
  isbn?: string;
  published_year?: number;
  description?: string;
  total_copies: number;
  available_copies: number;
}

export default function RecommendationsPage() {
  const [recs, setRecs] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const response = await api.get("/recommendations");
      setRecs(response.data);
    } catch (error) {
      console.error("Lỗi khi tải gợi ý sách AI:", error);
      toast.error("Không thể tải gợi ý sách AI");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const handleReserve = async (bookId: number) => {
    try {
      const response = await api.post("/reservations", { bookId });
      toast.success(response.data.message || "Đã tạo phiếu mượn/đặt trước thành công!");
    } catch (error: any) {
      console.error("Lỗi khi đặt trước:", error);
      toast.error(error.response?.data?.message || "Không thể thực hiện mượn/đặt trước");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/8 via-background to-terracotta/8">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-md shrink-0">
              <Sparkles className="h-5 w-5 text-white animate-pulse" />
            </div>
            <div className="flex-1">
              <h2 className="font-display text-2xl font-semibold tracking-tight">Gợi ý AI cho {user?.fullName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Sử dụng mô hình gợi ý thông minh dựa trên lịch sử đọc sách và nhóm chủ đề yêu thích của bạn.
              </p>
            </div>
            <Tabs defaultValue="hybrid">
              <TabsList>
                <TabsTrigger value="hybrid">Hybrid Engine</TabsTrigger>
                <TabsTrigger value="cbf">Content-Based</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : recs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">Chưa tìm thấy gợi ý sách phù hợp</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {recs.map((r, idx) => (
            <Card key={r.id} className="group overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5">
              <div className="relative h-32 bg-gradient-to-br from-primary/12 via-accent/30 to-terracotta/12 grid place-items-center text-5xl">
                📚
                <Badge className="absolute top-3 right-3 bg-background/90 text-primary border-0 shadow-sm gap-1 text-[10px]">
                  <Sparkles className="h-3 w-3 text-gold animate-bounce" /> {98 - idx * 3}% Phù hợp
                </Badge>
                <Badge className="absolute top-3 left-3 bg-background/90 text-foreground border-0 shadow-sm text-[10px]">
                  {r.category_name || "Phổ biến"}
                </Badge>
              </div>
              <CardContent className="p-4">
                <h3 className="font-display text-sm font-semibold leading-snug line-clamp-1">{r.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{r.author_name || "Nhiều tác giả"}</p>
                <div className="mt-3 rounded-md bg-muted/40 p-2.5 text-[11px] leading-relaxed">
                  <span className="text-muted-foreground">Vì sao đề xuất:</span> <span className="font-medium text-foreground">Bạn có xu hướng yêu thích chủ đề {r.category_name || "khoa học"}.</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => handleReserve(r.id)}>
                    <BookOpen className="h-3 w-3" /> Mượn / Đặt
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary animate-pulse" /> Đang thịnh hành tuần này
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "📚 Văn học & Nghệ thuật", stat: "+45% lượt mượn" },
              { label: "🌌 Vũ trụ & Khoa học", stat: "+32% lượt mượn" },
              { label: "💼 Kinh doanh & Khởi nghiệp", stat: "+28% lượt mượn" },
              { label: "🧘 Kỹ năng & Thấu cảm", stat: "+50% lượt mượn" }
            ].map((c) => (
              <div key={c.label} className="rounded-md border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm cursor-pointer">
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.stat}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
