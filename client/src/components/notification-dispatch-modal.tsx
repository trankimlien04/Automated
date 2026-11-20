import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Mail, Send, RefreshCw, Sparkles, Eye, EyeOff, X, Settings2, CheckCircle2, AlertTriangle, Trash2, PlugZap, Clock
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

export interface CronRuntimeInfo {
  active: boolean;
  schedule: string;
  cronExpression: string;
  timezone: string;
  catchUpEnabled: boolean;
  nextRunAt: string | null;
  lastRunDate: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSummary: string | null;
}

export interface SmtpStatus {
  configured: boolean;
  mode: "smtp_real" | "simulated";
  source: "database" | "env" | "none";
  host: string;
  port: number;
  secure: boolean;
  userMasked: string;
  user?: string;
  fromAddress: string;
  hasPassword: boolean;
  timezone: string;
  cron?: CronRuntimeInfo;
}

interface DispatchLogItem {
  id: number | string;
  template_type: string;
  title: string;
  content_preview?: string | null;
  recipient_email: string;
  user_name?: string | null;
  channel?: string | null;
  status: string;
  error_message?: string | null;
  created_at: string;
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  const apiErr = err as { response?: { data?: { message?: string } } };
  return apiErr?.response?.data?.message || fallback;
}

function cleanDispatchTitle(rawTitle: string): string {
  return String(rawTitle || "").replace(/^\?+\s*(?=\[)/, "");
}

interface NotificationDispatchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "logs" | "test" | "smtp";
  onSmtpUpdated?: (status: SmtpStatus) => void;
}

export function NotificationDispatchModal({
  open,
  onOpenChange,
  initialTab = "logs",
  onSmtpUpdated,
}: NotificationDispatchModalProps) {
  const { user } = useAuth();
  const canManageSmtp = user?.role === "admin" || user?.role === "owner";
  const canInspectSmtp = user?.role === "admin" || user?.role === "librarian" || user?.role === "owner";

  const [dispatches, setDispatches] = useState<DispatchLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "test" | "smtp">(initialTab);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);

  // Test / direct email send state
  const [testEmail, setTestEmail] = useState("");
  const [testTemplate, setTestTemplate] = useState("due_reminder_t2");
  const [sendingTest, setSendingTest] = useState(false);

  // SMTP configuration form state
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState("false");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);

  // Preview state
  const [previewItem, setPreviewItem] = useState<DispatchLogItem | null>(null);

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

  const fetchSmtpStatus = async () => {
    if (!canInspectSmtp) return;
    try {
      const res = await api.get("/notifications/smtp-status");
      const data: SmtpStatus = res.data;
      setSmtpStatus(data);
      onSmtpUpdated?.(data);
      if (data.host) setSmtpHost(data.host);
      if (data.port) setSmtpPort(String(data.port));
      setSmtpSecure(data.secure ? "true" : "false");
      if (data.user) setSmtpUser(data.user);
      if (data.configured && data.fromAddress) setSmtpFrom(data.fromAddress);
    } catch (e) {
      console.error("Lỗi khi kiểm tra trạng thái SMTP:", e);
    }
  };

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab === "smtp" && !canManageSmtp ? "logs" : initialTab);
      fetchDispatches();
      fetchSmtpStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmail.trim()) {
      toast.error("Vui lòng nhập địa chỉ email người nhận");
      return;
    }

    setSendingTest(true);
    try {
      const res = await api.post("/notifications/test-email", {
        targetEmail: testEmail.trim(),
        templateType: testTemplate,
      });
      if (res.data?.simulated) {
        toast.warning(res.data.message);
      } else {
        toast.success(res.data.message || "Đã gửi email thực tế thành công!");
      }
      fetchDispatches();
      setActiveTab("logs");
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Gửi email SMTP thất bại"));
      fetchDispatches();
    } finally {
      setSendingTest(false);
    }
  };

  const handleVerifySmtp = async () => {
    setVerifyingSmtp(true);
    try {
      const res = await api.post("/notifications/smtp-verify");
      toast.success(res.data?.message || "Kết nối SMTP hoạt động bình thường!");
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Không thể kết nối máy chủ SMTP"));
    } finally {
      setVerifyingSmtp(false);
    }
  };

  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smtpHost.trim() || !smtpUser.trim()) {
      toast.error("Vui lòng nhập đầy đủ SMTP Host và Email tài khoản gửi");
      return;
    }
    setSavingSmtp(true);
    try {
      const res = await api.put("/notifications/smtp-config", {
        host: smtpHost.trim(),
        port: parseInt(smtpPort, 10) || 587,
        secure: smtpSecure === "true",
        user: smtpUser.trim(),
        pass: smtpPass,
        fromAddress: smtpFrom.trim(),
      });
      toast.success(res.data?.message || "Đã lưu và xác thực SMTP thực tế thành công!");
      setSmtpPass("");
      if (res.data?.smtpStatus) {
        setSmtpStatus(res.data.smtpStatus);
        onSmtpUpdated?.(res.data.smtpStatus);
      } else {
        fetchSmtpStatus();
      }
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Lưu/xác thực SMTP thất bại"));
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleResetSmtp = async () => {
    setSavingSmtp(true);
    try {
      const res = await api.delete("/notifications/smtp-config");
      toast.info(res.data?.message || "Đã gỡ cấu hình SMTP trong DB");
      setSmtpPass("");
      if (res.data?.smtpStatus) {
        setSmtpStatus(res.data.smtpStatus);
        onSmtpUpdated?.(res.data.smtpStatus);
      } else {
        fetchSmtpStatus();
      }
    } catch (error: unknown) {
      toast.error(getApiErrorMessage(error, "Không thể gỡ cấu hình SMTP"));
    } finally {
      setSavingSmtp(false);
    }
  };

  const applyPreset = (host: string, port: string, secure: string) => {
    setSmtpHost(host);
    setSmtpPort(port);
    setSmtpSecure(secure);
  };

  const getTemplateBadge = (type: string) => {
    switch (type) {
      case "due_reminder_t2":
        return <Badge className="bg-sky-600 text-white text-[10px] shrink-0">T - 2 Ngày (Nhắc hạn)</Badge>;
      case "due_today_t0":
        return <Badge className="bg-amber-600 text-white text-[10px] shrink-0">T - 0 Ngày (Hạn chót)</Badge>;
      case "overdue_warning":
        return <Badge variant="destructive" className="text-[10px] shrink-0">Quá hạn & Kỷ luật</Badge>;
      case "drop_box_receipt":
        return <Badge className="bg-indigo-600 text-white text-[10px] shrink-0">Hòm trả 24/7</Badge>;
      case "drop_box_audit_result":
        return <Badge className="bg-purple-600 text-white text-[10px] shrink-0">Đối soát Hòm 24/7</Badge>;
      case "exit_pass":
        return <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">Phiếu mượn</Badge>;
      case "account_registration":
        return <Badge className="bg-amber-600 text-white text-[10px] shrink-0">Đăng ký tài khoản</Badge>;
      case "account_approved":
        return <Badge className="bg-teal-600 text-white text-[10px] shrink-0">Duyệt tài khoản</Badge>;
      case "account_unlocked":
        return <Badge className="bg-sky-600 text-white text-[10px] shrink-0">Mở khóa thẻ</Badge>;
      case "account_locked":
        return <Badge variant="destructive" className="text-[10px] shrink-0">Khóa / Từ chối TK</Badge>;
      case "general":
        return <Badge variant="secondary" className="text-[10px] shrink-0">Thông báo chung</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px] shrink-0">{type}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    if (status === "delivered" || status === "sent") {
      return (
        <Badge className="text-[10px] shrink-0 bg-emerald-600 hover:bg-emerald-600 text-white">
          Đã gửi thực tế
        </Badge>
      );
    }
    if (status === "simulated") {
      return (
        <Badge
          variant="outline"
          className="text-[10px] shrink-0 bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700"
        >
          Đã phát (Mô phỏng)
        </Badge>
      );
    }
    if (status === "failed") {
      return (
        <Badge variant="destructive" className="text-[10px] shrink-0">
          Gửi thất bại
        </Badge>
      );
    }
    return <Badge variant="outline" className="text-[10px] shrink-0">{status}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl flex flex-col max-h-[90vh] min-w-0 p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl border border-slate-700/80 [&>button]:text-slate-300 [&>button:hover]:text-white [&>button]:top-5 [&>button]:right-5">
        {/* Header */}
        <div className="shrink-0 min-w-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6 pt-5 pb-4 text-white flex flex-col gap-3.5 border-b border-slate-800">
          {/* Row 1: Title & Icon */}
          <div className="flex items-start gap-3.5 pr-9 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-indigo-500/20 border border-indigo-400/35 flex items-center justify-center text-indigo-300 shrink-0 mt-0.5">
              <Mail className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base sm:text-lg font-bold text-white leading-snug">
                Hệ Thống Cảnh Báo Nhắc Hạn Đa Kênh (Email &amp; In-App)
              </DialogTitle>
              <DialogDescription className="text-slate-300/85 text-xs mt-1 leading-relaxed">
                Tự động quét 08:00 ({smtpStatus?.timezone || "Asia/Ho_Chi_Minh"}) nhắc trước hạn 2 ngày, đúng hạn &amp; quá hạn
              </DialogDescription>
            </div>
          </div>

          {/* Row 2: Tabs + Live Cron Schedule Pill */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-white/10 p-1 border border-white/15">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setActiveTab("logs")}
                className={`text-xs h-8 px-3 rounded-lg transition-all ${
                  activeTab === "logs"
                    ? "bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white shadow-sm font-semibold"
                    : "bg-transparent text-slate-200 hover:bg-white/15 hover:text-white"
                }`}
              >
                Nhật ký gửi ({dispatches.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setActiveTab("test")}
                className={`text-xs h-8 px-3 rounded-lg gap-1.5 transition-all ${
                  activeTab === "test"
                    ? "bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white shadow-sm font-semibold"
                    : "bg-transparent text-slate-200 hover:bg-white/15 hover:text-white"
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                Gửi email
              </Button>
              {canManageSmtp && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setActiveTab("smtp")}
                  className={`text-xs h-8 px-3 rounded-lg gap-1.5 transition-all ${
                    activeTab === "smtp"
                      ? "bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white shadow-sm font-semibold"
                      : "bg-transparent text-slate-200 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Cấu hình SMTP
                </Button>
              )}
            </div>

            {smtpStatus?.cron && (
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border ${
                  smtpStatus.cron.active
                    ? "bg-sky-500/15 border-sky-400/35 text-sky-100"
                    : "bg-slate-800/80 border-slate-600 text-slate-300"
                }`}
                title={
                  smtpStatus.cron.nextRunAt
                    ? `Lần quét tiếp theo: ${new Date(smtpStatus.cron.nextRunAt).toLocaleString("vi-VN")}`
                    : undefined
                }
              >
                <Clock className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                <span>
                  {smtpStatus.cron.active ? "Lịch tự động 08:00: Đang bật" : "Lịch tự động: Tạm dừng"}
                </span>
              </div>
            )}
          </div>

          {/* Row 3: Live SMTP + Cron telemetry banner */}
          {canInspectSmtp && smtpStatus && (
            <div
              className={`rounded-xl px-3.5 py-2.5 text-xs flex flex-col gap-1.5 border min-w-0 ${
                smtpStatus.configured
                  ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-100"
                  : "bg-amber-950/60 border-amber-500/40 text-amber-100"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {smtpStatus.configured ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span className="truncate font-medium">
                    {smtpStatus.configured
                      ? `SMTP Thực tế đang hoạt động (${smtpStatus.host}:${smtpStatus.port} • ${smtpStatus.userMasked})`
                      : "Chưa cấu hình SMTP thực tế — email hiện đang ghi nhận ở chế độ Mô phỏng."}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {smtpStatus.configured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={verifyingSmtp}
                      onClick={handleVerifySmtp}
                      className="h-7 text-[11px] bg-white/10 border-emerald-400/40 text-white hover:bg-white/20 gap-1"
                    >
                      <PlugZap className="w-3 h-3" />
                      {verifyingSmtp ? "Đang kiểm tra..." : "Kiểm tra kết nối"}
                    </Button>
                  ) : (
                    canManageSmtp &&
                    activeTab !== "smtp" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveTab("smtp")}
                        className="h-7 text-[11px] bg-amber-500/20 border-amber-400/50 text-amber-100 hover:bg-amber-500/30 gap-1"
                      >
                        <Settings2 className="w-3 h-3" />
                        Cấu hình SMTP ngay
                      </Button>
                    )
                  )}
                </div>
              </div>

              {smtpStatus.cron && (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-200/85 border-t border-white/10 pt-1.5">
                  <span>
                    • Quét tự động không cần bấm tay (kể cả tự chạy bù nếu mở máy sau 08:00)
                  </span>
                  <span className="font-mono text-[10.5px] text-slate-200">
                    {smtpStatus.cron.lastRunAt
                      ? `Quét gần nhất: ${new Date(smtpStatus.cron.lastRunAt).toLocaleString("vi-VN")}`
                      : smtpStatus.cron.nextRunAt
                        ? `Lần tới: ${new Date(smtpStatus.cron.nextRunAt).toLocaleString("vi-VN")}`
                        : "Đã kích hoạt lịch ngầm"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-4 bg-white dark:bg-slate-950">
          {activeTab === "logs" && (
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Ghi nhận <strong>{dispatches.length}</strong> lượt phát hành thông báo đa kênh gần nhất:
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={fetchDispatches}
                  disabled={loading}
                  className="h-7 px-2.5 text-xs gap-1.5 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  Làm mới
                </Button>
              </div>

              {dispatches.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground space-y-2">
                  <Mail className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                  <p className="text-xs font-semibold">Chưa có thông báo đa kênh nào được gửi</p>
                  <p className="text-[11px]">Bấm "Quét nhắc hạn đa kênh" hoặc chuyển sang tab "Gửi email" để kiểm tra.</p>
                </div>
              ) : (
                <div className="space-y-2.5 min-w-0">
                  {dispatches.map((d) => {
                    const isExpanded = previewItem?.id === d.id;
                    const displayTitle = cleanDispatchTitle(d.title);
                    return (
                      <div
                        key={d.id}
                        className={`p-3.5 rounded-xl border bg-card transition-colors text-xs space-y-2.5 min-w-0 ${
                          isExpanded
                            ? "border-indigo-400 ring-1 ring-indigo-300/50 bg-indigo-50/20 dark:bg-indigo-950/20"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        {/* Row 1: Badges + Timestamp */}
                        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            {getTemplateBadge(d.template_type)}
                            {getStatusBadge(d.status)}
                          </div>
                          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                            {new Date(d.created_at).toLocaleString("vi-VN")}
                          </span>
                        </div>

                        {/* Row 2: Full readable subject title */}
                        <p className="font-semibold text-[13px] leading-snug text-slate-900 dark:text-slate-100 break-words">
                          {displayTitle}
                        </p>

                        {/* Row 3: Recipient + Toggle preview */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/70 px-3 py-1.5 rounded-lg min-w-0">
                          <span className="truncate min-w-0 flex-1">
                            Người nhận: <strong className="text-slate-800 dark:text-slate-100">{d.recipient_email}</strong>{" "}
                            {d.user_name ? `(${d.user_name})` : ""}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 font-semibold gap-1 shrink-0"
                            onClick={() => setPreviewItem(isExpanded ? null : d)}
                          >
                            {isExpanded ? (
                              <>
                                <EyeOff className="w-3 h-3" /> Thu gọn
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3" /> Xem nội dung
                              </>
                            )}
                          </Button>
                        </div>

                        {d.status === "failed" && d.error_message && !isExpanded && (
                          <p className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2.5 py-1 break-words">
                            Lỗi SMTP: {d.error_message}
                          </p>
                        )}

                        {isExpanded && (
                          <div className="mt-1 p-3.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-slate-50/70 dark:bg-slate-900/90 text-xs space-y-2">
                            <div className="flex items-start justify-between gap-2 border-b dark:border-slate-800 pb-2">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                  Tiêu đề đầy đủ
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-slate-100 break-words mt-0.5">
                                  {displayTitle}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 shrink-0"
                                onClick={() => setPreviewItem(null)}
                                title="Đóng xem trước"
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                Nội dung thông báo
                              </p>
                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words mt-1">
                                {d.content_preview || displayTitle}
                              </p>
                            </div>
                            {d.error_message && (
                              <p className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1 break-words">
                                Lỗi: {d.error_message}
                              </p>
                            )}
                            <div className="text-[11px] text-muted-foreground pt-1 border-t dark:border-slate-800 flex flex-wrap justify-between gap-2">
                              <span>
                                Người nhận: <code className="text-slate-700 dark:text-slate-300">{d.recipient_email}</code>
                              </span>
                              <span>
                                Kênh: <strong className="uppercase">{d.channel || "email"}</strong>
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === "test" && (
            <form onSubmit={handleSendTest} className="space-y-4 max-w-lg mx-auto py-2">
              <div
                className={`p-4 rounded-xl border text-xs space-y-1 ${
                  smtpStatus?.configured
                    ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                    : "bg-amber-50/80 border-amber-200 text-amber-950"
                }`}
              >
                <p className="font-bold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  {smtpStatus?.configured
                    ? "Sẵn sàng gửi Email thực tế qua SMTP:"
                    : "Chế độ Mô phỏng (chưa bật SMTP thực tế):"}
                </p>
                <p className="text-[11px] leading-relaxed">
                  {smtpStatus?.configured
                    ? `Email HTML chuẩn Athenaeum Smart Library sẽ được chuyển phát trực tiếp tới hộp thư người nhận thông qua ${smtpStatus.host} (${smtpStatus.userMasked}).`
                    : "Do chưa có tài khoản SMTP hợp lệ, lượt gửi này sẽ chỉ lưu log mô phỏng trong hệ thống. Hãy chuyển sang tab \"Cấu hình SMTP\" để bật gửi email thật."}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Địa chỉ email người nhận:</label>
                <Input
                  type="email"
                  placeholder="Ví dụ: bandoc@gmail.com hoặc sinhvien@dau.edu.vn..."
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
                      ⏰ T - 2 Ngày: Nhắc nhở sách sắp đến hạn trả (gộp theo độc giả)
                    </SelectItem>
                    <SelectItem value="overdue_warning">
                      🚨 T + 1 Ngày: Cảnh báo quá hạn ngày đầu &amp; Quy chế kỷ luật
                    </SelectItem>
                    <SelectItem value="account_suspended">
                      ⛔ Đình chỉ quyền mượn (SUSPENDED): Thông báo chuyển trạng thái
                    </SelectItem>
                    <SelectItem value="reservation_ready">
                      🎉 Đặt trước sẵn sàng: Thông báo giữ sách ưu tiên 48h
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
                {sendingTest
                  ? "Đang chuyển phát email..."
                  : smtpStatus?.configured
                    ? "Gửi email thực tế ngay"
                    : "Gửi kiểm tra (Mô phỏng)"}
              </Button>
            </form>
          )}

          {activeTab === "smtp" && canManageSmtp && (
            <form onSubmit={handleSaveSmtp} className="space-y-4 max-w-xl mx-auto py-1">
              <div className="p-3.5 rounded-xl bg-sky-50/80 border border-sky-200 text-xs text-sky-950 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-sky-600 shrink-0" />
                  Hướng dẫn nhanh cấu hình Gmail thực tế (App Password):
                </p>
                <ol className="list-decimal pl-4 space-y-0.5 text-[11px] leading-relaxed text-sky-900">
                  <li>Vào Tài khoản Google → <strong>Bảo mật (Security)</strong> → bật <strong>Xác minh 2 bước (2-Step Verification)</strong>.</li>
                  <li>Tìm mục <strong>Mật khẩu ứng dụng (App passwords)</strong> → tạo tên mới (vd: <em>SmartLibrary</em>) để lấy mã <strong>16 ký tự</strong>.</li>
                  <li>Nhập Gmail và mã 16 ký tự vào form dưới đây rồi bấm <strong>Kiểm tra &amp; Lưu</strong> (hệ thống sẽ test kết nối SMTP thật trước khi lưu; mật khẩu được mã hóa AES-256 trong CSDL).</li>
                </ol>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-muted-foreground font-medium">Mẫu nhanh:</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyPreset("smtp.gmail.com", "587", "false")}
                >
                  Gmail TLS (587)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyPreset("smtp.gmail.com", "465", "true")}
                >
                  Gmail SSL (465)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => applyPreset("smtp.office365.com", "587", "false")}
                >
                  Outlook / Microsoft 365 (587)
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">SMTP Host</label>
                  <Input
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="text-xs h-9"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Cổng (Port) &amp; Bảo mật</label>
                  <div className="flex gap-1.5">
                    <Input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => {
                        setSmtpPort(e.target.value);
                        if (e.target.value === "465") setSmtpSecure("true");
                        if (e.target.value === "587") setSmtpSecure("false");
                      }}
                      placeholder="587"
                      className="text-xs h-9 w-20"
                      required
                    />
                    <Select value={smtpSecure} onValueChange={setSmtpSecure}>
                      <SelectTrigger className="text-xs h-9 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">STARTTLS (587)</SelectItem>
                        <SelectItem value="true">SSL/TLS (465)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Email gửi (SMTP User)</label>
                  <Input
                    type="email"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="thuvien.athenaeum@gmail.com"
                    className="text-xs h-9"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Mật khẩu ứng dụng (App Password)
                  </label>
                  <div className="relative">
                    <Input
                      type={showSmtpPass ? "text" : "password"}
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder={
                        smtpStatus?.hasPassword
                          ? "Để trống để giữ mật khẩu đã lưu, hoặc nhập mã mới"
                          : "16 ký tự Google App Password"
                      }
                      className="text-xs h-9 pr-9"
                      required={!smtpStatus?.hasPassword}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      title={showSmtpPass ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showSmtpPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Tên &amp; Email hiển thị (Tùy chọn - From)</label>
                <Input
                  value={smtpFrom}
                  onChange={(e) => setSmtpFrom(e.target.value)}
                  placeholder="Athenaeum Smart Library <thuvien@gmail.com>"
                  className="text-xs h-9"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {smtpStatus?.source === "database" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={savingSmtp}
                    onClick={handleResetSmtp}
                    className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Xóa cấu hình DB (dùng .env)
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Cron 08:00 ({smtpStatus?.timezone || "Asia/Ho_Chi_Minh"}) tự động dùng cấu hình này ngay sau khi lưu.
                  </span>
                )}

                <Button
                  type="submit"
                  disabled={savingSmtp}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-2 h-9 px-4"
                >
                  <PlugZap className="w-4 h-4" />
                  {savingSmtp ? "Đang xác thực & lưu..." : "Kiểm tra & Lưu cấu hình SMTP"}
                </Button>
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="px-6 py-3 bg-slate-50 dark:bg-slate-900/60 border-t flex flex-row items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Cron 08:00 ({smtpStatus?.timezone || "Asia/Ho_Chi_Minh"}) tự động chạy ngầm hằng ngày
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="ml-auto">
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
