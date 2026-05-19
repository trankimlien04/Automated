import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, BookOpen, TrendingUp } from "lucide-react";
import { recommendations } from "@/lib/mock-data";

export const Route = createFileRoute("/recommendations")({ component: RecommendationsPage });

function RecommendationsPage() {
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/8 via-background to-terracotta/8">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-primary text-primary-foreground grid place-items-center shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="font-display text-2xl font-semibold tracking-tight">Gợi ý cho Nguyễn Minh Anh</h2>
              <p className="mt-1 text-sm text-muted-foreground">Kết hợp <strong>Content-Based</strong> + <strong>Collaborative Filtering</strong> dựa trên 12 đầu sách đã đọc.</p>
            </div>
            <Tabs defaultValue="hybrid">
              <TabsList>
                <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
                <TabsTrigger value="cbf">Content</TabsTrigger>
                <TabsTrigger value="cf">Collaborative</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {recommendations.map((r) => (
          <Card key={r.title} className="group overflow-hidden transition hover:shadow-lg">
            <div className="relative h-32 bg-gradient-to-br from-primary/15 via-accent/40 to-terracotta/15 grid place-items-center text-5xl">
              {r.cover}
              <Badge className="absolute top-3 right-3 bg-background/90 text-primary border-0 shadow-sm gap-1">
                <Sparkles className="h-3 w-3" /> {r.match}%
              </Badge>
            </div>
            <CardContent className="p-4">
              <h3 className="font-display text-base font-semibold leading-snug line-clamp-1">{r.title}</h3>
              <p className="text-xs text-muted-foreground">{r.author}</p>
              <div className="mt-3 rounded-md bg-muted/40 p-2.5 text-xs">
                <span className="text-muted-foreground">Vì sao gợi ý:</span> <span className="font-medium">{r.reason}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="flex-1 gap-1"><BookOpen className="h-3 w-3" /> Mượn</Button>
                <Button size="sm" variant="outline" className="flex-1">Chi tiết</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Đang thịnh hành tuần này
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {["📚 Tiểu thuyết Nhật", "🌌 Vật lý lượng tử", "💼 Khởi nghiệp", "🧘 Phát triển bản thân"].map((c) => (
              <div key={c} className="rounded-md border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm cursor-pointer">
                <p className="text-2xl">{c.split(" ")[0]}</p>
                <p className="mt-2 text-sm font-medium">{c.split(" ").slice(1).join(" ")}</p>
                <p className="text-xs text-muted-foreground">+{Math.floor(Math.random() * 40 + 10)}% lượt mượn</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
