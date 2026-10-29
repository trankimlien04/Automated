import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  BellRing,
  Mail,
  Trash2,
  CheckCheck,
  Send,
  RefreshCw,
  Search,
  BookOpen,
  BookmarkCheck,
  CreditCard,
  Megaphone,
  Clock,
  ShieldAlert,
  Sparkles,
  ArrowRight,
  X
} from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/use-confirm";
import { NotificationDispatchModal } from "@/components/notification-dispatch-modal";

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const navigate = useNavigate();
  const [notiList, setNotiList] = useState<Notification[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "borrow" | "reservation" | "fine" | "system">("all");
  const [searchFilter, setSearchFilter] = useState("");

  // Broadcast Modal state
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastType, setBroadcastType] = useState("info");
  const [broadcastAudience, setBroadcastAudience] = useState("all");
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [scanningReminders, setScanningReminders] = useState(false);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await api.get("/notifications");
      setNotiList(response.data);
    } catch (error) {
      console.error("Lỗi khi tải thông báo:", error);
      toast.error("Không thể tải danh sách thông báo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAsRead = async (id: number) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotiList(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (error) {
      console.error("Lỗi khi cập nhật thông báo:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.put("/notifications/read-all");
      setNotiList(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success("Đã đánh dấu đọc tất cả thông báo");
    } catch (error) {
      console.error("Lỗi khi cập nhật tất cả thông báo:", error);
      toast.error("Thao tác thất bại");
    }
  };

  const handleDeleteNotification = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    confirm({
      title: "Xác nhận xóa thông báo này?",
      description: "Thông báo này sẽ bị xóa khỏi hộp thư của bạn và không thể phục hồi.",
      confirmText: "Xóa thông báo",
      cancelText: "Hủy bỏ",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete(`/notifications/${id}`);
          setNotiList(prev => prev.filter(n => n.id !== id));
          setSelectedIds(prev => prev.filter(itemId => itemId !== id));
          toast.success("Đã xóa thông báo thành công");
        } catch (error) {
          console.error("Lỗi khi xóa thông báo:", error);
          toast.error("Không thể xóa thông báo");
        }
      },
    });
  };

  const handleClearRead = async () => {
    try {
      await api.delete("/notifications/clear-read");
      setNotiList(prev => prev.filter(n => !n.is_read));
      setSelectedIds(prev => prev.filter(id => {
        const item = notiList.find(n => n.id === id);
        return item && !item.is_read;
      }));
      toast.success("Đã dọn dẹp các thông báo đã đọc");
    } catch (error) {
      console.error("Lỗi khi dọn thông báo:", error);
      toast.error("Không thể dọn thông báo");
    }
  };

  // Batch Selection Handlers
  const handleToggleSelect = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBatchMarkAsRead = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    try {
      await api.put("/notifications/batch-read", { ids: selectedIds });
      setNotiList(prev => prev.map(n => selectedIds.includes(n.id) ? { ...n, is_read: true } : n));
      setSelectedIds([]); // Trở về trạng thái ban đầu sau khi đánh dấu đọc xong
      toast.success(`Đã đánh dấu đã đọc ${count} thông báo`);
    } catch (error) {
      console.error("Lỗi khi đánh dấu đọc nhiều thông báo:", error);
      toast.error("Thao tác thất bại");
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    confirm({
      title: `Xác nhận xóa ${count} thông báo đã chọn?`,
      description: "Các thông báo đã chọn này sẽ bị xóa khỏi hộp thư của bạn và không thể phục hồi.",
      confirmText: "Xóa thông báo",
      cancelText: "Hủy bỏ",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete("/notifications/batch-delete", { data: { ids: selectedIds } });
          setNotiList(prev => prev.filter(n => !selectedIds.includes(n.id)));
          setSelectedIds([]);
          toast.success(`Đã xóa thành công ${count} thông báo`);
        } catch (error) {
          console.error("Lỗi khi xóa nhiều thông báo:", error);
          toast.error("Không thể xóa các thông báo đã chọn");
        }
      },
    });
  };

  const handleDeleteAll = () => {
    if (notiList.length === 0) return;
    confirm({
      title: "Xác nhận xóa TẤT CẢ thông báo?",
      description: `Hành động này sẽ xóa toàn bộ ${notiList.length} thông báo trong hộp thư của bạn và không thể hoàn tác.`,
      confirmText: "Xóa tất cả",
      cancelText: "Hủy",
      variant: "destructive",
      onConfirm: async () => {
        try {
          await api.delete("/notifications/delete-all");
          setNotiList([]);
          setSelectedIds([]);
          toast.success("Đã xóa toàn bộ thông báo thành công");
        } catch (error) {
          console.error("Lỗi khi xóa tất cả thông báo:", error);
          toast.error("Không thể xóa tất cả thông báo");
        }
      },
    });
  };

  const handleTriggerReminders = async () => {
    setScanningReminders(true);
    try {
      const res = await api.post("/notifications/trigger-reminders");
      toast.success(res.data.message || "Đã quét và kích hoạt thông báo nghiệp vụ thành công!");
      fetchNotifications();
    } catch (error) {
      console.error("Lỗi khi quét nghiệp vụ:", error);
      toast.error("Không thể kích hoạt quét nghiệp vụ");
    } finally {
      setScanningReminders(false);
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      toast.error("Vui lòng nhập đầy đủ tiêu đề và nội dung thông báo");
      return;
    }

    setSendingBroadcast(true);
    try {
      const res = await api.post("/notifications/broadcast", {
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        type: broadcastType,
        audience: broadcastAudience,
      });

      toast.success(res.data.message || "Đã gửi thông báo thành công!");
      setIsBroadcastOpen(false);
      setBroadcastTitle("");
      setBroadcastMessage("");
      fetchNotifications();
    } catch (error) {
      console.error("Lỗi khi gửi thông báo:", error);
      toast.error("Không thể phát thông báo hệ thống");
    } finally {
      setSendingBroadcast(false);
    }
  };

  // Helper to categorize each notification by business domain
  const getNotificationDetails = (noti: Notification) => {
    const title = (noti.title || "").toLowerCase();
    const msg = (noti.message || "").toLowerCase();
    const fullText = `${title} ${msg}`;

    // 1. Khóa tài khoản / Phí phạt & Cảnh báo trễ hạn
    if (
      title.includes("khóa") ||
      msg.includes("bị khóa") ||
      msg.includes("khóa tự động") ||
      title.includes("phạt") ||
      fullText.includes("phí phạt") ||
      fullText.includes("tiền phạt") ||
      fullText.includes("nộp phạt") ||
      title.includes("quá hạn") ||
      (title.includes("cảnh báo") && fullText.includes("quá hạn"))
    ) {
      if (title.includes("khóa") || msg.includes("bị khóa") || msg.includes("khóa tự động")) {
        return {
          category: "fine",
          badge: "Khóa tài khoản",
          badgeCls: "bg-destructive/10 text-destructive border-destructive/20",
          Icon: ShieldAlert,
          iconBg: "bg-destructive/10 text-destructive",
        };
      }
      return {
        category: "fine",
        badge: "Phí phạt & Quá hạn",
        badgeCls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        Icon: AlertTriangle,
        iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
    }

    // 2. Gia hạn mượn sách
    if (title.includes("gia hạn") || fullText.includes("gia hạn mượn sách") || fullText.includes("đã được gia hạn")) {
      return {
        category: "borrow",
        badge: "Gia hạn mượn",
        badgeCls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
        Icon: Clock,
        iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      };
    }

    // 3. Đặt trước sách & Giữ chỗ & Phiếu nhận sách (Kiểm tra trước khi xét Mượn/Trả)
    if (
      title.includes("đặt trước") ||
      title.includes("giữ sách") ||
      title.includes("phiếu nhận") ||
      title.includes("sẵn sàng nhận") ||
      title.includes("đăng ký nhận") ||
      (title.includes("hủy") && fullText.includes("đặt trước")) ||
      fullText.includes("phiếu nhận sách") ||
      fullText.includes("đặt trước cuốn") ||
      fullText.includes("yêu cầu đặt trước") ||
      fullText.includes("ticket-res")
    ) {
      const isReady = title.includes("sẵn sàng") || fullText.includes("sẵn sàng nhận");
      const isCancelled = title.includes("hủy") || fullText.includes("hủy phiếu");
      return {
        category: "reservation",
        badge: isCancelled ? "Hủy đặt trước" : isReady ? "Sẵn sàng nhận sách" : "Đặt trước & Giữ sách",
        badgeCls: isCancelled
          ? "bg-muted text-muted-foreground border-border"
          : isReady
          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
          : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
        Icon: BookmarkCheck,
        iconBg: isCancelled ? "bg-muted text-muted-foreground" : "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      };
    }

    // 4. Trả sách hoàn tất (Chỉ khớp khi thực sự là sự kiện trả sách, tránh nhầm từ 'Hạn trả')
    if (
      title.includes("trả sách") ||
      title.includes("hoàn tất trả") ||
      title.includes("hoàn trả sách") ||
      fullText.includes("đã hoàn tất trả") ||
      fullText.includes("hoàn trả đúng hạn") ||
      fullText.includes("nhận trả sách")
    ) {
      return {
        category: "borrow",
        badge: "Trả sách thành công",
        badgeCls: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
        Icon: CheckCircle2,
        iconBg: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
      };
    }

    // 5. Mượn sách thực tế / Nhận sách tại quầy / Tự mượn sách qua QR
    if (
      title.includes("mượn sách") ||
      title.includes("nhận sách") ||
      title.includes("bàn giao") ||
      title.includes("trao sách") ||
      fullText.includes("tự mượn sách") ||
      fullText.includes("mượn thành công") ||
      fullText.includes("nhận thành công")
    ) {
      const isCounterHandover = title.includes("tại quầy") || fullText.includes("tại quầy");
      const badge = title.includes("nhận") 
        ? "Nhận sách tại quầy" 
        : isCounterHandover 
        ? "Mượn sách tại quầy" 
        : "Mượn sách thành công";
      return {
        category: "borrow",
        badge,
        badgeCls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        Icon: BookOpen,
        iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      };
    }

    // 6. Nhắc nhở hạn trả / thẻ sắp hết hạn
    if (
      title.includes("nhắc nhở") ||
      title.includes("sắp đến hạn") ||
      title.includes("sắp hết hạn") ||
      noti.type === "reminder"
    ) {
      return {
        category: "system",
        badge: "Nhắc nhở hạn trả",
        badgeCls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
        Icon: BellRing,
        iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      };
    }

    // 7. Thẻ thư viện & Tài khoản & Cấu hình Maker-Checker
    if (
      title.includes("thẻ thư viện") ||
      title.includes("tài khoản") ||
      title.includes("kích hoạt") ||
      title.includes("cấp thẻ") ||
      title.includes("quy chế") ||
      title.includes("cấu hình") ||
      title.includes("maker-checker")
    ) {
      return {
        category: "system",
        badge: "Thẻ & Tài khoản",
        badgeCls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
        Icon: CreditCard,
        iconBg: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      };
    }

    // Default system broadcast / info
    return {
      category: "system",
      badge: noti.type === "warning" ? "Cảnh báo" : noti.type === "reminder" ? "Nhắc nhở" : "Thông báo chung",
      badgeCls: noti.type === "warning" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-primary/10 text-primary border-primary/20",
      Icon: noti.type === "warning" ? AlertTriangle : noti.type === "reminder" ? BellRing : Megaphone,
      iconBg: noti.type === "warning" ? "bg-amber-500/10 text-amber-600" : noti.type === "reminder" ? "bg-indigo-500/10 text-indigo-600" : "bg-primary/10 text-primary"
    };
  };

  const categoryCounts = useMemo(() => {
    const counts = {
      all: notiList.length,
      unread: notiList.filter((n) => !n.is_read).length,
      borrow: 0,
      reservation: 0,
      fine: 0,
      system: 0,
    };
    notiList.forEach((n) => {
      const d = getNotificationDetails(n);
      if (d.category in counts) {
        counts[d.category as "borrow" | "reservation" | "fine" | "system"]++;
      }
    });
    return counts;
  }, [notiList]);

  const filteredList = useMemo(() => {
    return notiList.filter((n) => {
      // Tab filter
      if (activeTab === "unread" && n.is_read) return false;
      const details = getNotificationDetails(n);
      if (activeTab === "borrow" && details.category !== "borrow") return false;
      if (activeTab === "reservation" && details.category !== "reservation") return false;
      if (activeTab === "fine" && details.category !== "fine") return false;
      if (activeTab === "system" && details.category !== "system") return false;

      // Text search filter
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        const match = n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [notiList, activeTab, searchFilter]);

  const unreadCount = notiList.filter((n) => !n.is_read).length;
  const canBroadcast = user && ["admin", "librarian", "owner"].includes(user.role);

  return (
    <div className="space-y-6">
      {/* Top Banner Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight font-display">Trung tâm thông báo & Nghiệp vụ</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cập nhật toàn diện các thông báo mượn trả, đặt trước sách, phí phạt, gia hạn và phát loa hệ thống.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canBroadcast && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTriggerReminders}
                disabled={scanningReminders}
                className="text-xs gap-1.5 border-border shadow-xs hover:bg-accent cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanningReminders ? "animate-spin" : ""}`} />
                <span>Quét nhắc hạn đa kênh</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDispatchModalOpen(true)}
                className="text-xs gap-1.5 border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 shadow-xs cursor-pointer"
              >
                <Mail className="h-3.5 w-3.5 text-indigo-600" />
                <span>Nhật ký Email đa kênh</span>
              </Button>

              <Dialog open={isBroadcastOpen} onOpenChange={setIsBroadcastOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="text-xs gap-1.5 shadow-xs">
                    <Send className="h-3.5 w-3.5" />
                    <span>Phát thông báo mới</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[480px]">
                  <form onSubmit={handleSendBroadcast}>
                    <DialogHeader>
                      <DialogTitle className="font-display">Phát thông báo nghiệp vụ</DialogTitle>
                      <DialogDescription className="text-xs">
                        Gửi thông báo tới toàn thể người dùng hoặc độc giả trong hệ thống thư viện.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="audience" className="text-xs font-semibold">Đối tượng người nhận</Label>
                        <Select value={broadcastAudience} onValueChange={setBroadcastAudience}>
                          <SelectTrigger id="audience" className="text-xs">
                            <SelectValue placeholder="Chọn đối tượng" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Toàn bộ hệ thống (Tất cả tài khoản)</SelectItem>
                            <SelectItem value="readers">Tất cả Độc giả (Readers)</SelectItem>
                            <SelectItem value="librarians">Ban Quản trị & Thủ thư</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="type" className="text-xs font-semibold">Loại thông báo</Label>
                        <Select value={broadcastType} onValueChange={setBroadcastType}>
                          <SelectTrigger id="type" className="text-xs">
                            <SelectValue placeholder="Chọn loại thông báo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="info">Thông tin chung (Info)</SelectItem>
                            <SelectItem value="reminder">Nhắc nhở nghiệp vụ (Reminder)</SelectItem>
                            <SelectItem value="warning">Cảnh báo / Quy chế (Warning)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="title" className="text-xs font-semibold">Tiêu đề thông báo</Label>
                        <Input
                          id="title"
                          value={broadcastTitle}
                          onChange={(e) => setBroadcastTitle(e.target.value)}
                          placeholder="VD: Thông báo nghỉ lễ 30/4 & gia hạn mượn sách tự động"
                          className="text-xs"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="message" className="text-xs font-semibold">Nội dung chi tiết</Label>
                        <Textarea
                          id="message"
                          value={broadcastMessage}
                          onChange={(e) => setBroadcastMessage(e.target.value)}
                          placeholder="Nhập nội dung thông báo đầy đủ gửi đến người dùng..."
                          rows={4}
                          className="text-xs"
                          required
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" size="sm" onClick={() => setIsBroadcastOpen(false)} className="text-xs">
                        Hủy
                      </Button>
                      <Button type="submit" size="sm" disabled={sendingBroadcast} className="text-xs gap-1.5">
                        {sendingBroadcast ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        <span>Gửi thông báo</span>
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Notifications Box */}
        <Card className="lg:col-span-2 border-border/80 shadow-xs">
          <CardHeader className="pb-3 border-b border-border/50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="font-display text-base">Hộp thư thông báo nghiệp vụ</CardTitle>
                <CardDescription className="text-xs">
                  {unreadCount > 0 ? (
                    <span className="text-primary font-medium">{unreadCount} thông báo chưa đọc</span>
                  ) : (
                    "Bạn đã cập nhật tất cả thông báo"
                  )}
                </CardDescription>
              </div>

              {/* Search within notifications */}
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Lọc thông báo..."
                  className="h-8 pl-8 text-xs bg-muted/30"
                />
              </div>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex flex-wrap gap-1.5 pt-3">
              {[
                { id: "all", label: "Tất cả", count: categoryCounts.all },
                { id: "unread", label: "Chưa đọc", count: categoryCounts.unread },
                { id: "borrow", label: "Mượn & Trả", icon: BookOpen, count: categoryCounts.borrow },
                { id: "reservation", label: "Đặt trước", icon: BookmarkCheck, count: categoryCounts.reservation },
                { id: "fine", label: "Phí phạt & Cảnh báo", icon: AlertTriangle, count: categoryCounts.fine },
                { id: "system", label: "Thẻ & Hệ thống", icon: CreditCard, count: categoryCounts.system },
              ].map((tab) => (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`h-7 px-2.5 text-xs rounded-md ${activeTab === tab.id ? "font-semibold" : "bg-muted/60 text-muted-foreground hover:text-foreground"}`}
                >
                  {tab.icon && <tab.icon className="h-3 w-3 mr-1" />}
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${activeTab === tab.id ? "bg-primary-foreground text-primary font-bold" : "bg-muted text-muted-foreground"}`}>
                      {tab.count}
                    </span>
                  )}
                </Button>
              ))}
            </div>

            {/* Thanh Hộp Kiểm Chọn Nhiều & Thao Tác Hàng Loạt */}
            {filteredList.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t mt-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id="select-all-noti"
                    checked={filteredList.length > 0 && filteredList.every((n) => selectedIds.includes(n.id))}
                    onCheckedChange={() => {
                      const allSelected = filteredList.every((n) => selectedIds.includes(n.id));
                      if (allSelected) {
                        const set = new Set(filteredList.map((n) => n.id));
                        setSelectedIds((prev) => prev.filter((id) => !set.has(id)));
                      } else {
                        const newSelected = Array.from(new Set([...selectedIds, ...filteredList.map((n) => n.id)]));
                        setSelectedIds(newSelected);
                      }
                    }}
                  />
                  <label
                    htmlFor="select-all-noti"
                    className="text-xs font-semibold cursor-pointer select-none text-foreground flex items-center gap-1.5"
                  >
                    <span>Chọn tất cả ({filteredList.length})</span>
                  </label>
                  {selectedIds.length > 0 && (
                    <Badge variant="secondary" className="text-[11px] px-2 py-0.5 bg-primary/10 text-primary font-bold">
                      Đã chọn {selectedIds.length}
                    </Badge>
                  )}
                </div>

                {selectedIds.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBatchMarkAsRead}
                      className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      <span>Đánh dấu đã đọc ({selectedIds.length})</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleBatchDelete}
                      className="h-7 text-xs gap-1 shadow-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Xóa đã chọn ({selectedIds.length})</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds([])}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Bỏ chọn</span>
                    </Button>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground italic hidden sm:inline-block">
                    Tick chọn để đọc hoặc xóa nhiều thông báo cùng lúc
                  </span>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent className="p-4 space-y-2.5">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="text-xs">Đang tải danh sách thông báo...</p>
              </div>
            ) : filteredList.length === 0 ? (
              <div className="text-center py-16">
                <div className="h-12 w-12 rounded-full bg-muted/60 grid place-items-center mx-auto text-muted-foreground mb-3">
                  <BellRing className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-foreground">Không có thông báo nào</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  {searchFilter ? "Không tìm thấy thông báo phù hợp với từ khóa tìm kiếm." : "Mọi thông báo nghiệp vụ phát sinh sẽ được hiển thị đầy đủ tại đây."}
                </p>
              </div>
            ) : (
              filteredList.map((n) => {
                const details = getNotificationDetails(n);
                const { Icon, iconBg, badge, badgeCls } = details;
                const isSelected = selectedIds.includes(n.id);

                return (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkAsRead(n.id)}
                    className={`group relative flex items-start gap-3 rounded-xl border p-3.5 transition cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/[0.08] shadow-xs"
                        : !n.is_read 
                        ? "border-primary/30 bg-primary/[0.03] shadow-xs hover:border-primary/50 hover:bg-accent/40" 
                        : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-accent/40"
                    }`}
                  >
                    {/* Checkbox select */}
                    <div 
                      className="pt-1 shrink-0" 
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleSelect(n.id)}
                        className="data-[state=checked]:bg-primary"
                      />
                    </div>

                    {/* Status Icon */}
                    <div className={`h-9 w-9 shrink-0 rounded-lg grid place-items-center ${iconBg}`}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pr-8">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4.5 font-medium ${badgeCls}`}>
                          {badge}
                        </Badge>
                        <h4 className={`text-xs ${!n.is_read ? "font-bold text-foreground" : "font-medium text-foreground/90"}`}>
                          {n.title}
                        </h4>
                        {!n.is_read && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" title="Chưa đọc" />
                        )}
                      </div>

                      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                        {n.message}
                      </p>

                      {/* Nút thao tác nhanh theo loại thông báo */}
                      {(n.title.toLowerCase().includes("đặt trước") || n.message.toLowerCase().includes("đặt trước")) && (
                        <div className="mt-2.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/reservations");
                            }}
                            className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 font-semibold"
                          >
                            <BookmarkCheck className="h-3.5 w-3.5" />
                            <span>Mở mục Đặt trước sách</span>
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {(n.title.toLowerCase().includes("đăng ký mượn") || n.message.toLowerCase().includes("yêu cầu mượn")) && (
                        <div className="mt-2.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate("/borrow");
                            }}
                            className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 font-semibold"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            <span>Mở Sổ mượn & Thẻ QR</span>
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/80">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(n.created_at).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric"
                          })}
                        </span>
                        {!n.is_read && (
                          <span className="text-primary font-medium">• Nhấn để đánh dấu đã đọc</span>
                        )}
                      </div>
                    </div>

                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteNotification(e, n.id)}
                      className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                      title="Xóa thông báo này"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right Column: Notification Preferences & Summary */}
        <div className="space-y-6">
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Quy chuẩn nghiệp vụ</span>
              </CardTitle>
              <CardDescription className="text-xs">Các sự kiện kích hoạt gửi thông báo tự động</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3.5 text-xs">
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/40">
                <BookOpen className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Mượn & Trả sách qua QR</p>
                  <p className="text-[11px] text-muted-foreground">Tự động thông báo hạn trả khi mượn, xác nhận vào kho khi trả sách.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/40">
                <BookmarkCheck className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Hàng đợi Đặt trước sách</p>
                  <p className="text-[11px] text-muted-foreground">Báo ngay cho người đặt tiếp theo khi sách được trả về quầy.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/40">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Cảnh báo trễ hạn & Tiền phạt</p>
                  <p className="text-[11px] text-muted-foreground">Nhắc trước 2 ngày, báo nợ phí phạt và tự động khóa thẻ nếu trễ ≥7 ngày.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/40">
                <CreditCard className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Kích hoạt & Hạn thẻ thư viện</p>
                  <p className="text-[11px] text-muted-foreground">Thông báo duyệt tài khoản, cấp mã thẻ và nhắc gia hạn trước 15 ngày.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base">Cài đặt kênh thông báo</CardTitle>
              <CardDescription className="text-xs">Tùy chọn phương thức nhận thông báo cá nhân</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { id: "remind", label: "Nhắc trả sách trước hạn", desc: "Thông báo trước 2 ngày", icon: BellRing },
                { id: "overdue", label: "Cảnh báo quá hạn & Phạt", desc: "Gửi ngay khi phát sinh trễ hạn", icon: AlertTriangle },
                { id: "reserve", label: "Sách đặt trước đã có mặt", desc: "Nhận tin ngay khi sách về kho", icon: BookmarkCheck },
                { id: "card", label: "Thẻ thư viện sắp hết hạn", desc: "Cảnh báo trước 15 ngày", icon: CreditCard },
              ].map((s) => (
                <div key={s.id} className="flex items-start gap-3">
                  <s.icon className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <Label htmlFor={s.id} className="font-medium text-xs cursor-pointer">{s.label}</Label>
                    <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                  </div>
                  <Switch id={s.id} defaultChecked />
                </div>
              ))}

              <div className="border-t border-border/60 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email-channel" className="flex items-center gap-2 text-xs cursor-pointer">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>Email thông báo tự động</span>
                  </Label>
                  <Switch id="email-channel" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="inapp-channel" className="flex items-center gap-2 text-xs cursor-pointer">
                    <BellRing className="h-4 w-4 text-primary" />
                    <span>Thông báo chuông In-App (Realtime)</span>
                  </Label>
                  <Switch id="inapp-channel" defaultChecked />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {ConfirmDialogComponent}

      {/* Smart Library 4.0: Notification Dispatches & Test Email Modal */}
      <NotificationDispatchModal
        open={isDispatchModalOpen}
        onOpenChange={setIsDispatchModalOpen}
      />
    </div>
  );
}
