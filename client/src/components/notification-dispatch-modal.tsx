import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Send, CheckCircle2, Clock, AlertTriangle, RefreshCw,
  Sparkles, ExternalLink, ShieldCheck, Inbox, Eye
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";

interface NotificationDispatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationDispatchModal({ open, onOpenChange }: NotificationDispatchModalProps) {
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "test">("logs");

  // Test send state
  const [testEmail, setTestEmail] = useState("");
  const [testTemplate, setTestTemplate] = useState("due_reminder_t2");
  const [sendingTest, setSendingTest] = useState(false);

  // Preview state
  const [previewItem, setPreviewItem] = useState<any | null>(null);

  const fetchDispatches = async () => {
    setLoading(true);
    try {
      const res = await api.get("/notifications/dispatch-history");
      setDispatches(res.data);
    } catch (e) {
      console.error("Lỗi khi tải lịch sử gửi thông báo:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchDispatches();
    }
  }, [open]);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail.trim()) {
      toast.error("Vui lòng nhập địa chỉ email nhận thử nghiệm");
      return;
    }

    setSendingTest(true);
    try {
      const res = await api.post("/notifications/test-email", {
        targetEmail: testEmail.trim(),
        templateType: testTemplate
      });
      toast.success(res.data.message || "Đã gửi email thử nghiệm thành công!");
      fetchDispatches();
      setActiveTab("logs");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Lỗi khi gửi email thử nghiệm");
    } finally {
      setSendingTest(false);
    }
  };

  const getTemplateBadge = (type: string) => {
    switch (type) {
      case "due_reminder_t2":
        return <Badge className="bg-sky-600 text-white text-[10px]">T - 2 Ngày (Nhắc hạn)</Badge>;
      case "due_today_t0":
        return <Badge className="bg-amber-600 text-white text-[10px]">T - 0 Ngày (Hạn chót)</Badge>;
      case "overdue_warning":
        return <Badge variant="destructive" className="text-[10px]">Quá hạn & Phạt</Badge>;
      case "drop_box_receipt":
        return <Badge className="bg-indigo-600 text-white text-[10px]">Hòm trả 24/7</Badge>;
      case "exit_pass":
        return <Badge className="bg-emerald-600 text-white text-[10px]">Vé ra cửa</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{type}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden rounded-2xl shadow-2xl border-2 border-slate-700">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                Hệ Thống Cảnh Báo Nhắc Hạn Đa Kênh (Email & In-App)
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-0.5">
                Nhật ký phát hành email tự động trước hạn 2 ngày, đúng hạn và cảnh báo quá hạn tích lũy
              </DialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={activeTab === "logs" ? "default" : "outline"}
              onClick={() => setActiveTab("logs")}
              className="text-xs h-8"
            >
              Nhật ký gửi ({dispatches.length})
            </Button>
            <Button
              size="sm"
              variant={activeTab === "test" ? "default" : "outline"}
              onClick={() => setActiveTab("test")}
              className="text-xs h-8 gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              Gửi thử nghiệm
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[72vh] overflow-y-auto">
          {activeTab === "logs" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Ghi nhận <strong>{dispatches.length}</strong> lượt phát hành thông báo đa kênh gần nhất:
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={fetchDispatches}
                  disabled={loading}
                  className="h-7 text-xs text-muted-foreground"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
                  Làm mới
                </Button>
              </div>

              {dispatches.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground space-y-2">
                  <Mail className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                  <p className="text-xs font-semibold">Chưa có thông báo đa kênh nào được gửi</p>
                  <p className="text-[11px]">Bấm "Quét nghiệp vụ ngay" hoặc chuyển sang tab "Gửi thử nghiệm" để kiểm tra tính năng.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {dispatches.map((d) => (
                    <div
                      key={d.id}
                      className="p-3.5 rounded-xl border bg-card hover:bg-muted/40 transition-colors text-xs space-y-2"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {getTemplateBadge(d.template_type)}
                          <span className="font-bold text-slate-900 truncate max-w-sm">
                            {d.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {new Date(d.created_at).toLocaleString("vi-VN")}
                          </span>
                          <Badge
                            variant={d.status === "delivered" || d.status === "simulated" ? "default" : "destructive"}
                            className="text-[10px] capitalize bg-emerald-600 text-white"
                          >
                            {d.status === "simulated" ? "Đã phát (Mô phỏng)" : d.status === "delivered" ? "Đã gửi thực tế" : d.status}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-600 bg-muted/40 p-2 rounded-lg">
                        <span>
                          Người nhận: <strong>{d.recipient_email}</strong> {d.user_name ? `(${d.user_name})` : ""}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-2 text-[10px] text-indigo-600 font-semibold gap-1"
                          onClick={() => setPreviewItem(d)}
                        >
                          <Eye className="w-3 h-3" /> Xem nội dung
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Test Send Tab */
            <form onSubmit={handleSendTest} className="space-y-4 max-w-lg mx-auto py-2">
              <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-indigo-950">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  Kiểm thử kênh phát thanh tự động:
                </p>
                <p className="text-[11px] leading-relaxed">
                  Bạn có thể nhập bất kỳ địa chỉ email nào và chọn kịch bản để hệ thống tạo và phát hành template HTML đa kênh chuẩn Athenaeum Smart Library 4.0.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Địa chỉ email người nhận:</label>
                <Input
                  type="email"
                  placeholder="Ví dụ: ban-doc@gmail.com hoặc sinhvien@edu.vn..."
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="text-xs h-9"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Chọn kịch bản thông báo mẫu:</label>
                <Select value={testTemplate} onValueChange={setTestTemplate}>
                  <SelectTrigger className="text-xs h-9">
                    <SelectValue placeholder="Chọn kịch bản" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="due_reminder_t2">
                      ⏰ T - 2 Ngày: Nhắc nhở sách sắp đến hạn trả trong 48h
                    </SelectItem>
                    <SelectItem value="due_today_t0">
                      ⚠️ T - 0 Ngày: Hạn chót hoàn trả hôm nay (Hướng dẫn Hòm 24/7)
                    </SelectItem>
                    <SelectItem value="overdue_warning">
                      🚨 T + 1 Ngày: Cảnh báo quá hạn & Phát sinh phí phạt trễ hạn
                    </SelectItem>
                    <SelectItem value="drop_box_receipt">
                      📦 Hòm trả 24/7: Biên nhận tự động tiếp nhận sách ngoài giờ
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                disabled={sendingTest || !testEmail.trim()}
                className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-2 shadow-sm"
              >
                <Send className="w-4 h-4" />
                {sendingTest ? "Đang phát hành email..." : "Gửi thử nghiệm ngay"}
              </Button>
            </form>
          )}

          {/* Sub Preview Modal */}
          {previewItem && (
            <div className="p-4 rounded-xl border-2 border-indigo-300 bg-white shadow-lg space-y-2 animate-in fade-in-50">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-bold text-xs text-slate-800">
                  Xem trước nội dung: {previewItem.title}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-slate-500"
                  onClick={() => setPreviewItem(null)}
                >
                  ✕
                </Button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed font-sans">
                {previewItem.content_preview || previewItem.title}
              </p>
              <div className="text-[11px] text-muted-foreground pt-1 flex justify-between">
                <span>Người nhận: <code>{previewItem.recipient_email}</code></span>
                <span>Kênh: <strong>{previewItem.channel}</strong></span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 bg-slate-100 border-t flex sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
