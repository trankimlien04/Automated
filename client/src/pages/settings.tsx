import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, 
  Database, 
  Mail, 
  Palette, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Send, 
  Crown,
  History,
  Check,
  X
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm";

interface ConfigItem {
  value: string;
  description: string;
}

type ConfigMap = Record<string, ConfigItem>;

interface ConfigRequest {
  id: number;
  key_name: string;
  current_value: string;
  proposed_value: string;
  reason: string;
  requested_by: number;
  requested_by_name: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  config_description: string | null;
}

const CONFIG_LABELS: Record<string, { label: string; unit: string }> = {
  max_books_per_user: { label: "Số sách tối đa / độc giả", unit: "cuốn" },
  max_borrow_days: { label: "Thời hạn mượn mặc định", unit: "ngày" },
  fine_per_day: { label: "Phí phạt trễ hạn mỗi ngày", unit: "VNĐ / ngày" },
};

export default function SettingsPage() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ConfigMap>({});
  const [requests, setRequests] = useState<ConfigRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialogComponent } = useConfirm();

  // Propose Modal State (For Admin)
  const [proposeOpen, setProposeOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState("fine_per_day");
  const [proposedVal, setProposedVal] = useState("");
  const [proposeReason, setProposeReason] = useState("");
  const [submittingPropose, setSubmittingPropose] = useState(false);

  // Review Modal State (For Owner)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState<ConfigRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected">("approved");
  const [reviewNote, setReviewNote] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin";

  const fetchConfigs = async () => {
    try {
      const response = await api.get("/configs");
      setConfigs(response.data);
    } catch (error) {
      console.error("Lỗi khi lấy cấu hình hệ thống:", error);
    }
  };

  const fetchRequests = async () => {
    try {
      const response = await api.get("/configs/requests");
      setRequests(response.data);
    } catch (error) {
      console.error("Lỗi khi lấy danh sách đề xuất:", error);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([fetchConfigs(), fetchRequests()]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleOpenPropose = (keyName?: string) => {
    const key = keyName || "fine_per_day";
    setSelectedKey(key);
    setProposedVal(configs[key]?.value || "");
    setProposeReason("");
    setProposeOpen(true);
  };

  const handleSubmitProposal = async () => {
    if (!proposedVal || !proposeReason.trim()) {
      toast.error("Vui lòng nhập giá trị đề xuất và lý do cụ thể");
      return;
    }

    setSubmittingPropose(true);
    try {
      const res = await api.post("/configs/propose", {
        key_name: selectedKey,
        proposed_value: proposedVal,
        reason: proposeReason,
      });
      toast.success(res.data.message || "Đã gửi đề xuất tới Giám đốc!");
      setProposeOpen(false);
      loadAll();
    } catch (error: any) {
      const msg = error.response?.data?.message || "Không thể gửi đề xuất";
      toast.error(msg);
    } finally {
      setSubmittingPropose(false);
    }
  };

  const handleOpenReview = (req: ConfigRequest, action: "approved" | "rejected") => {
    setActiveRequest(req);
    setReviewAction(action);
    setReviewNote(action === "approved" ? "Đồng ý điều chỉnh quy chế này." : "");
    setReviewOpen(true);
  };

  const handleSubmitReview = async () => {
    if (!activeRequest) return;
    if (reviewAction === "rejected" && !reviewNote.trim()) {
      toast.error("Vui lòng nhập lý do từ chối để Admin nắm được thông tin");
      return;
    }

    setSubmittingReview(true);
    try {
      const res = await api.patch(`/configs/requests/${activeRequest.id}/review`, {
        action: reviewAction,
        review_note: reviewNote,
      });
      toast.success(res.data.message || "Đã xử lý đề xuất!");
      setReviewOpen(false);
      loadAll();
    } catch (error: any) {
      const msg = error.response?.data?.message || "Lỗi khi xử lý đề xuất";
      toast.error(msg);
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      {/* Banner dành riêng cho Chủ thư viện (Owner) */}
      {isOwner && (
        <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent p-4 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/20">
                <Crown className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight">Kênh Phê duyệt & Giám sát của Chủ thư viện</h2>
                  <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30 text-xs font-semibold">
                    Maker - Checker
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
                  Bạn có thẩm quyền cao nhất để phê duyệt hoặc từ chối các đề xuất thay đổi chính sách vận hành (mức phạt, hạn mượn, giới hạn sách). Mọi thay đổi đều được ghi vết kiểm toán.
                </p>
              </div>
            </div>
            {pendingRequests.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-warning/15 border border-warning/30 px-3.5 py-2 text-warning font-medium text-xs whitespace-nowrap">
                <AlertCircle className="h-4 w-4" />
                <span>Có {pendingRequests.length} đề xuất đang chờ bạn phê duyệt</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Card 1: Quy chế vận hành hiện hành */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> Quy chế vận hành Athenaeum (Hiện hành)
              </CardTitle>
              <CardDescription>Các thông số đang có hiệu lực trong toàn hệ thống</CardDescription>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => handleOpenPropose()} className="gap-1.5 shadow-sm">
                <Send className="h-3.5 w-3.5" /> Gửi đề xuất thay đổi
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(CONFIG_LABELS).map(([key, meta]) => {
                const item = configs[key];
                const hasPending = requests.some((r) => r.key_name === key && r.status === "pending");
                return (
                  <div key={key} className="rounded-lg border bg-card p-4 relative overflow-hidden flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
                        {hasPending && (
                          <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                            Có đề xuất chờ duyệt
                          </Badge>
                        )}
                      </div>
                      <div className="text-2xl font-bold tracking-tight text-foreground">
                        {key === "fine_per_day" ? Number(item?.value || 0).toLocaleString("vi-VN") : item?.value || "N/A"}{" "}
                        <span className="text-xs font-normal text-muted-foreground">{meta.unit}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{item?.description}</p>
                    </div>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 w-full text-xs h-7 text-primary hover:bg-primary/10"
                        onClick={() => handleOpenPropose(key)}
                      >
                        Đề xuất chỉnh sửa
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium text-xs">Tự động tạm khóa thẻ khi trễ &gt; 7 ngày</Label>
                  <p className="text-[10px] text-muted-foreground">Khóa cho đến khi độc giả hoàn tất thanh toán nợ phí phạt</p>
                </div>
                <Switch defaultChecked disabled={!isOwner && !isAdmin} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium text-xs">Gửi email & thông báo nhắc nhở trả sách</Label>
                  <p className="text-[10px] text-muted-foreground">Tự động kích hoạt thông báo in-app trước thời hạn 2 ngày</p>
                </div>
                <Switch defaultChecked disabled={!isOwner && !isAdmin} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Bảo mật & Phiên */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> Bảo mật & Phân quyền
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span>Cơ chế kiểm soát 2 cấp (Maker - Checker)</span>
              <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                Bật
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Thời hạn JWT Token (24h)</span>
              <Badge variant="outline">Mặc định</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Ghi nhật ký kiểm toán (Audit Trail)</span>
              <Badge variant="outline" className="bg-primary/10 text-primary">
                100% Thao tác
              </Badge>
            </div>
            <Separator />
            <div>
              <p className="font-semibold mb-1.5 text-muted-foreground">Quyền hạn tài khoản hiện tại:</p>
              <div className="rounded-md border p-2.5 bg-muted/30">
                <p className="font-semibold text-foreground">{user?.fullName}</p>
                <p className="text-muted-foreground">
                  Vai trò: <span className="text-primary font-medium">{user?.role === "owner" ? "Chủ thư viện / Giám đốc" : user?.role === "admin" ? "Quản trị viên (Admin)" : "Thủ thư"}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bảng Danh sách Đề xuất & Phê duyệt Chính sách (Maker - Checker) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <History className="h-5 w-5 text-primary" /> Hàng đợi & Lịch sử Đề xuất — Phê duyệt Cấu hình
            </CardTitle>
            <CardDescription>
              Toàn bộ lịch sử đề xuất từ Admin và quyết định phê duyệt/từ chối của Chủ thư viện
            </CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => handleOpenPropose()} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> Tạo đề xuất mới
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Chưa có đề xuất thay đổi cấu hình nào.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2.5 px-3 font-medium">Tham số</th>
                    <th className="py-2.5 px-3 font-medium">Giá trị cũ $\rightarrow$ Mới</th>
                    <th className="py-2.5 px-3 font-medium">Lý do đề xuất</th>
                    <th className="py-2.5 px-3 font-medium">Người gửi</th>
                    <th className="py-2.5 px-3 font-medium">Trạng thái</th>
                    <th className="py-2.5 px-3 font-medium">Người duyệt & Ghi chú</th>
                    {isOwner && <th className="py-2.5 px-3 font-medium text-right">Thao tác</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {requests.map((req) => (
                    <tr key={req.id} className="hover:bg-muted/40 transition-colors">
                      <td className="py-3 px-3 font-medium">
                        <div>{CONFIG_LABELS[req.key_name]?.label || req.key_name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{req.key_name}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-muted-foreground line-through mr-1.5">{req.current_value || "Mặc định"}</span>
                        $\rightarrow$
                        <span className="font-bold text-foreground ml-1.5">{req.proposed_value}</span>
                      </td>
                      <td className="py-3 px-3 max-w-[200px] truncate" title={req.reason}>
                        {req.reason}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-medium">{req.requested_by_name || "Admin"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(req.created_at).toLocaleString("vi-VN")}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {req.status === "pending" && (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 gap-1 font-medium">
                            <Clock className="h-3 w-3" /> Chờ phê duyệt
                          </Badge>
                        )}
                        {req.status === "approved" && (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30 gap-1 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Đã phê duyệt
                          </Badge>
                        )}
                        {req.status === "rejected" && (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1 font-medium">
                            <XCircle className="h-3 w-3" /> Đã từ chối
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {req.reviewed_by_name ? (
                          <div>
                            <span className="font-medium">{req.reviewed_by_name}</span>
                            {req.review_note && (
                              <p className="text-[10px] text-muted-foreground italic mt-0.5">"{req.review_note}"</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">Chưa duyệt</span>
                        )}
                      </td>
                      {isOwner && (
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {req.status === "pending" ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs bg-success/10 hover:bg-success/20 text-success border-success/30 gap-1"
                                onClick={() => handleOpenReview(req, "approved")}
                              >
                                <Check className="h-3.5 w-3.5" /> Duyệt
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs bg-destructive/10 hover:bg-destructive/20 text-destructive border-destructive/30 gap-1"
                                onClick={() => handleOpenReview(req, "rejected")}
                              >
                                <X className="h-3.5 w-3.5" /> Từ chối
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Hoàn tất</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: Gửi đề xuất (Dành cho Admin) */}
      <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Gửi đề xuất thay đổi quy chế vận hành</DialogTitle>
            <DialogDescription>
              Đề xuất sẽ được chuyển tới Chủ thư viện / Giám đốc để xem xét phê duyệt theo cơ chế Maker-Checker.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs">Tham số cần điều chỉnh</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={selectedKey}
                onChange={(e) => {
                  setSelectedKey(e.target.value);
                  setProposedVal(configs[e.target.value]?.value || "");
                }}
              >
                {Object.entries(CONFIG_LABELS).map(([k, meta]) => (
                  <option key={k} value={k}>
                    {meta.label} ({k})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-md bg-muted/40 p-2.5 text-[11px]">
              <span className="text-muted-foreground">Giá trị hiện tại đang áp dụng: </span>
              <span className="font-bold text-foreground">{configs[selectedKey]?.value || "N/A"}</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Giá trị đề xuất mới (*)</Label>
              <Input
                placeholder="Nhập giá trị mới (vd: 10000 hoặc 5)"
                value={proposedVal}
                onChange={(e) => setProposedVal(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Lý do điều chỉnh (*)</Label>
              <Textarea
                placeholder="Nêu rõ lý do cần điều chỉnh quy chế này (phục vụ Giám đốc phê duyệt)..."
                rows={3}
                value={proposeReason}
                onChange={(e) => setProposeReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProposeOpen(false)}>
              Hủy
            </Button>
            <Button size="sm" onClick={handleSubmitProposal} disabled={submittingPropose} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              {submittingPropose ? "Đang gửi..." : "Gửi tới Giám đốc"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Phê duyệt / Từ chối (Dành cho Chủ thư viện / Owner) */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg flex items-center gap-2">
              {reviewAction === "approved" ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success" /> Phê duyệt thay đổi cấu hình
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-destructive" /> Từ chối đề xuất cấu hình
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approved"
                ? "Giá trị mới sẽ ngay lập tức có hiệu lực trong toàn bộ hệ thống quản lý thư viện."
                : "Đề xuất sẽ bị bác bỏ và thông báo lý do trở lại cho Admin."}
            </DialogDescription>
          </DialogHeader>

          {activeRequest && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-lg border p-3 bg-card space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tham số:</span>
                  <span className="font-bold">{CONFIG_LABELS[activeRequest.key_name]?.label || activeRequest.key_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Điều chỉnh:</span>
                  <span>
                    <span className="line-through text-muted-foreground mr-1">{activeRequest.current_value}</span>
                    $\rightarrow$ <span className="font-bold text-primary">{activeRequest.proposed_value}</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Người đề xuất:</span>
                  <span className="font-medium">{activeRequest.requested_by_name}</span>
                </div>
                <div className="pt-1 text-[11px] border-t">
                  <span className="text-muted-foreground">Lý do: </span>
                  <span className="italic">{activeRequest.reason}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">
                  {reviewAction === "approved" ? "Ghi chú phê duyệt (Tùy chọn)" : "Lý do từ chối (*)"}
                </Label>
                <Textarea
                  placeholder={
                    reviewAction === "approved"
                      ? "Nhập ý kiến chỉ đạo hoặc phê duyệt..."
                      : "Nêu rõ lý do không đồng thuận để Admin điều chỉnh lại..."
                  }
                  rows={3}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReviewOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              variant={reviewAction === "approved" ? "default" : "destructive"}
              onClick={handleSubmitReview}
              disabled={submittingReview}
            >
              {submittingReview
                ? "Đang xử lý..."
                : reviewAction === "approved"
                ? "Xác nhận Phê duyệt"
                : "Xác nhận Từ chối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  );
}
