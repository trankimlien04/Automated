import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  BookOpen,
  Clock,
  ArrowRight,
  RefreshCw,
  Wrench,
  CalendarOff
} from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface ViolationRecord {
  id: number;
  amount: number;
  reason: string;
  status: "paid" | "unpaid";
  violation_type?: "overdue" | "damaged" | "lost";
  severity?: string;
  remediation_status?: "none" | "active_overdue" | "pending_remediation" | "resolved";
  remediation_action?: string | null;
  remediation_note?: string | null;
  resolved_at?: string | null;
  resolved_by_name?: string | null;
  payment_date: string | null;
  created_at: string;
  user_id?: number;
  reader_name: string;
  card_number: string;
  user_status?: string;
  suspended_until?: string | null;
  book_title: string | null;
  book_copy_qr?: string | null;
  copy_status?: string | null;
  borrow_record_id?: number | null;
  borrow_status?: string | null;
  borrow_date?: string | null;
  due_date?: string | null;
  return_date?: string | null;
  overdue_days?: number;
}

interface CirculationStatus {
  primaryStatus: "ELIGIBLE" | "OVERDUE" | "SUSPENDED" | "PENDING_REMEDIATION" | "ACCOUNT_LOCKED";
  restrictions: string[];
  accountLocked: boolean;
  isOverdue: boolean;
  overdueCount: number;
  isSuspended: boolean;
  suspendedUntil: string | null;
  suspendedUntilFormatted: string | null;
  suspensionRemainingDays: number;
  isPendingRemediation: boolean;
  pendingRemediationCount: number;
  eligibleToBorrow: boolean;
  eligibleToReserve: boolean;
  blockReason: string | null;
  reserveBlockReason: string | null;
}

const SEVERITY_LABELS: Record<string, string> = {
  minor: "Hư hỏng nhẹ",
  moderate: "Hư hỏng vừa",
  severe: "Hư hỏng nặng",
  lost: "Mất sách",
  none: "Trễ hạn"
};

const STATUS_BADGE_MAP: Record<string, { label: string; className: string }> = {
  ELIGIBLE: {
    label: "ELIGIBLE • Đủ điều kiện mượn",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
  },
  OVERDUE: {
    label: "OVERDUE • Đang giữ sách quá hạn",
    className: "bg-destructive/15 text-destructive border-destructive/30"
  },
  SUSPENDED: {
    label: "SUSPENDED • Đang tạm ngưng mượn",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
  },
  PENDING_REMEDIATION: {
    label: "PENDING_REMEDIATION • Chờ khắc phục hiện vật",
    className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30"
  },
  ACCOUNT_LOCKED: {
    label: "ACCOUNT_LOCKED • Thẻ đang khóa quản trị",
    className: "bg-destructive/15 text-destructive border-destructive/30"
  }
};

const isPendingRemediationRecord = (r: ViolationRecord) =>
  r.remediation_status === "pending_remediation" ||
  ((r.violation_type === "damaged" || r.violation_type === "lost") && r.status === "unpaid");

const isActiveOverdueRecord = (r: ViolationRecord) =>
  !isPendingRemediationRecord(r) && (r.status === "unpaid" || r.borrow_status === "borrowing");

export default function FinesPage() {
  const [records, setRecords] = useState<ViolationRecord[]>([]);
  const [circulationStatus, setCirculationStatus] = useState<CirculationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<"all" | "overdue" | "remediation" | "resolved">("all");

  // Resolve incident modal state (Librarian / Admin)
  const [resolveTarget, setResolveTarget] = useState<ViolationRecord | null>(null);
  const [remediationNote, setRemediationNote] = useState("");
  const [restoreCopy, setRestoreCopy] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();

  const isReader = user?.role === "reader";
  const canManageRemediation = user?.role === "admin" || user?.role === "librarian";

  const fetchData = async () => {
    setLoading(true);
    try {
      const [finesRes, statusRes] = await Promise.all([
        api.get("/fines"),
        isReader ? api.get("/fines/circulation-status").catch(() => null) : Promise.resolve(null)
      ]);
      setRecords(Array.isArray(finesRes.data) ? finesRes.data : []);
      if (statusRes?.data) {
        setCirculationStatus(statusRes.data);
      }
    } catch (error) {
      console.error("Lỗi khi tải sổ theo dõi vi phạm & kỷ luật mượn:", error);
      toast.error("Không thể tải danh sách theo dõi vi phạm & kỷ luật mượn");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isReader]);

  const activeOverdueList = useMemo(() => records.filter(isActiveOverdueRecord), [records]);
  const pendingRemediationList = useMemo(() => records.filter(isPendingRemediationRecord), [records]);
  const resolvedList = useMemo(
    () => records.filter((r) => !isActiveOverdueRecord(r) && !isPendingRemediationRecord(r)),
    [records]
  );

  const activeSuspendedReadersCount = useMemo(() => {
    const ids = new Set<number | string>();
    const now = Date.now();
    for (const r of records) {
      if (r.suspended_until && new Date(r.suspended_until).getTime() > now) {
        ids.add(r.user_id || r.card_number);
      }
    }
    return ids.size;
  }, [records]);

  const displayedRecords = useMemo(() => {
    if (filterMode === "overdue") return activeOverdueList;
    if (filterMode === "remediation") return pendingRemediationList;
    if (filterMode === "resolved") return resolvedList;
    return records;
  }, [records, activeOverdueList, pendingRemediationList, resolvedList, filterMode]);

  const handleOpenResolveModal = (record: ViolationRecord) => {
    setResolveTarget(record);
    setRemediationNote("");
    setRestoreCopy(record.copy_status === "damaged");
  };

  const handleConfirmResolve = async () => {
    if (!resolveTarget) return;
    setIsResolving(true);
    try {
      const res = await api.put(`/fines/${resolveTarget.id}/resolve`, {
        remediationNote:
          remediationNote.trim() ||
          "Thủ thư đã kiểm tra và xác nhận độc giả hoàn tất khắc phục theo quy chế.",
        restoreCopy
      });
      toast.success(res.data?.message || "Đã xác nhận khắc phục vi phạm!");
      setResolveTarget(null);
      await fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Không thể xác nhận khắc phục hồ sơ này");
    } finally {
      setIsResolving(false);
    }
  };

  const statusMeta = circulationStatus
    ? STATUS_BADGE_MAP[circulationStatus.primaryStatus] || STATUS_BADGE_MAP.ELIGIBLE
    : null;

  return (
    <div className="space-y-6">
      {/* Reader Multi-Cause Discipline Status Banner */}
      {isReader && circulationStatus && (
        <Card
          className={
            circulationStatus.eligibleToBorrow
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-destructive/30 bg-destructive/5"
          }
        >
          <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {circulationStatus.eligibleToBorrow ? (
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                )}
                <Badge variant="outline" className={`text-xs font-semibold ${statusMeta?.className || ""}`}>
                  {statusMeta?.label}
                </Badge>
                {circulationStatus.restrictions.length > 1 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {circulationStatus.restrictions.length} điều kiện hạn chế đang áp dụng đồng thời
                  </Badge>
                )}
              </div>

              <p className="text-sm font-medium text-foreground">
                {circulationStatus.eligibleToBorrow
                  ? "Thẻ của bạn hiện không có hạn chế lưu thông nào. Bạn có thể mượn mới và đặt trước sách bình thường."
                  : circulationStatus.blockReason || "Quyền mượn sách tạm thời bị giới hạn theo quy chế thư viện."}
              </p>

              {!circulationStatus.eligibleToBorrow && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {circulationStatus.isOverdue && (
                    <Badge variant="outline" className="text-[11px] border-destructive/40 text-destructive bg-background">
                      Quá hạn chưa trả: {circulationStatus.overdueCount} cuốn
                    </Badge>
                  )}
                  {circulationStatus.isSuspended && (
                    <Badge variant="outline" className="text-[11px] border-amber-500/40 text-amber-700 dark:text-amber-300 bg-background">
                      Tạm ngưng mượn đến {circulationStatus.suspendedUntilFormatted} (còn {circulationStatus.suspensionRemainingDays} ngày)
                    </Badge>
                  )}
                  {circulationStatus.isPendingRemediation && (
                    <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-700 dark:text-orange-300 bg-background">
                      Chờ khắc phục hiện vật: {circulationStatus.pendingRemediationCount} biên bản
                    </Badge>
                  )}
                </div>
              )}
            </div>

            {circulationStatus.isOverdue && (
              <Button size="sm" onClick={() => navigate("/borrow")} className="shrink-0 gap-1.5">
                <BookOpen className="h-4 w-4" />
                Trả sách ngay
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4 KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={activeOverdueList.length > 0 ? "border-destructive/30 bg-destructive/5" : ""}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <AlertTriangle className={`h-5 w-5 ${activeOverdueList.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
              <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                OVERDUE
              </Badge>
            </div>
            <p className={`mt-3 font-display text-3xl font-semibold ${activeOverdueList.length > 0 ? "text-destructive" : "text-foreground"}`}>
              {activeOverdueList.length} cuốn
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              {isReader ? "Sách đang quá hạn chưa hoàn trả" : "Sách độc giả đang giữ quá hạn chưa trả"}
            </p>
          </CardContent>
        </Card>

        <Card className={(isReader ? circulationStatus?.isSuspended : activeSuspendedReadersCount > 0) ? "border-amber-500/30 bg-amber-500/5" : ""}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <CalendarOff className={`h-5 w-5 ${(isReader ? circulationStatus?.isSuspended : activeSuspendedReadersCount > 0) ? "text-amber-600" : "text-muted-foreground"}`} />
              <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-700 dark:text-amber-300">
                SUSPENDED
              </Badge>
            </div>
            <p className="mt-3 font-display text-2xl sm:text-3xl font-semibold text-foreground">
              {isReader
                ? circulationStatus?.isSuspended
                  ? `${circulationStatus.suspensionRemainingDays} ngày`
                  : "Không"
                : `${activeSuspendedReadersCount} thẻ`}
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              {isReader
                ? circulationStatus?.isSuspended
                  ? `Tạm ngưng quyền mượn đến ${circulationStatus.suspendedUntilFormatted}`
                  : "Không trong thời gian đình chỉ trễ hạn"
                : "Độc giả đang trong thời gian tạm ngưng mượn"}
            </p>
          </CardContent>
        </Card>

        <Card className={pendingRemediationList.length > 0 ? "border-orange-500/30 bg-orange-500/5" : ""}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <Wrench className={`h-5 w-5 ${pendingRemediationList.length > 0 ? "text-orange-600" : "text-muted-foreground"}`} />
              <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-700 dark:text-orange-300">
                PENDING_REMEDIATION
              </Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-foreground">
              {pendingRemediationList.length} hồ sơ
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Biên bản hư hỏng / mất sách chờ khắc phục hiện vật
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                ELIGIBLE / Đã xử lý
              </Badge>
            </div>
            <p className="mt-3 font-display text-3xl font-semibold text-emerald-600">
              {resolvedList.length} lượt
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-1">
              Vi phạm đã hoàn trả / xác nhận khắc phục xong (không thu phí phạt)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Ledger Table */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="font-display">
                {isReader ? "Theo dõi kỷ luật mượn & lịch sử khắc phục của bạn" : "Sổ Theo Dõi Vi Phạm, Đình Chỉ & Khắc Phục Hiện Vật"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Thư viện áp dụng cơ chế kỷ luật lưu thông phi tiền tệ: Quá hạn chưa trả (OVERDUE) • Tạm ngưng quyền mượn khi trả trễ (SUSPENDED) • Biên bản khắc phục hiện vật không thu phí khi sách hỏng/mất (PENDING_REMEDIATION).
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="h-8 text-xs gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "all", label: `Tất cả (${records.length})` },
              { id: "overdue", label: `Quá hạn chưa trả (${activeOverdueList.length})` },
              { id: "remediation", label: `Chờ khắc phục hiện vật (${pendingRemediationList.length})` },
              { id: "resolved", label: `Đã xử lý (${resolvedList.length})` }
            ].map((tab) => (
              <Button
                key={tab.id}
                size="sm"
                variant={filterMode === tab.id ? "default" : "outline"}
                onClick={() => setFilterMode(tab.id as any)}
                className="h-7 text-xs"
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : displayedRecords.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-medium text-foreground">Không có hồ sơ vi phạm nào trong mục này</p>
              <p className="text-xs text-muted-foreground">Hoạt động lưu thông hiện đang tuân thủ đúng quy chế.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-16">Mã</TableHead>
                  <TableHead>Độc giả</TableHead>
                  <TableHead>Ấn phẩm & Bản sao</TableHead>
                  <TableHead>Loại vi phạm & Chi tiết</TableHead>
                  <TableHead>Tình trạng xử lý</TableHead>
                  <TableHead className="text-right">Thao tác / Kỷ luật thẻ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRecords.map((r) => {
                  const isPendingRem = isPendingRemediationRecord(r);
                  const isStillOverdue = isActiveOverdueRecord(r);
                  const readerSuspendedNow =
                    r.suspended_until && new Date(r.suspended_until).getTime() > Date.now();

                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">#{r.id}</TableCell>

                      <TableCell className="text-xs">
                        <div className="font-semibold text-foreground">{r.reader_name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{r.card_number}</div>
                        {readerSuspendedNow && (
                          <Badge
                            variant="outline"
                            className="mt-1 text-[10px] py-0 px-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300"
                          >
                            Đình chỉ đến {new Date(r.suspended_until!).toLocaleDateString("vi-VN")}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-xs max-w-[230px]">
                        <span className="font-medium truncate block" title={r.book_title || ""}>
                          {r.book_title || "Ấn phẩm thư viện"}
                        </span>
                        {r.book_copy_qr && (
                          <code className="text-[10px] text-primary/80 font-mono font-semibold">
                            [{r.book_copy_qr}]
                          </code>
                        )}
                      </TableCell>

                      <TableCell className="text-xs max-w-[290px] space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 px-1.5 ${
                              r.violation_type === "lost"
                                ? "border-destructive/40 text-destructive"
                                : r.violation_type === "damaged"
                                ? "border-orange-500/40 text-orange-700 dark:text-orange-300"
                                : "border-amber-500/40 text-amber-700 dark:text-amber-300"
                            }`}
                          >
                            {r.violation_type === "lost"
                              ? "Mất sách"
                              : r.violation_type === "damaged"
                              ? `Hư hỏng (${SEVERITY_LABELS[r.severity || "moderate"] || r.severity})`
                              : "Quá hạn trả"}
                          </Badge>
                        </div>
                        <p className="text-foreground font-medium">{r.reason}</p>
                        {r.remediation_action && (
                          <p className="text-[11px] text-orange-700 dark:text-orange-300">
                            Hướng khắc phục: {r.remediation_action}
                          </p>
                        )}
                        {r.remediation_note && (
                          <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                            Ghi chú thủ thư: {r.remediation_note}
                          </p>
                        )}
                        {r.due_date && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Hạn trả: {new Date(r.due_date).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-xs">
                        {isPendingRem ? (
                          <Badge
                            variant="outline"
                            className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30 text-[10px]"
                          >
                            Chờ khắc phục hiện vật
                          </Badge>
                        ) : isStillOverdue ? (
                          <Badge
                            variant="outline"
                            className="bg-destructive/15 text-destructive border-destructive/25 text-[10px]"
                          >
                            Đang quá hạn (Chưa trả)
                          </Badge>
                        ) : (
                          <div className="space-y-0.5">
                            <Badge
                              variant="outline"
                              className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 text-[10px]"
                            >
                              Đã khắc phục xong
                            </Badge>
                            {(r.resolved_at || r.return_date || r.payment_date) && (
                              <span className="block text-[10px] text-muted-foreground">
                                Ngày xử lý: {new Date((r.resolved_at || r.return_date || r.payment_date)!).toLocaleDateString("vi-VN")}
                              </span>
                            )}
                            {r.resolved_by_name && (
                              <span className="block text-[10px] text-muted-foreground">
                                Xác nhận: {r.resolved_by_name}
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {isStillOverdue ? (
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="destructive" className="text-[10px]">
                              OVERDUE • Khóa mượn
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 border-primary/30 text-primary hover:bg-primary/10"
                              onClick={() => navigate("/borrow")}
                            >
                              {isReader ? "Đi tới trả sách →" : "Mở Quầy nhận trả →"}
                            </Button>
                          </div>
                        ) : isPendingRem ? (
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-700 dark:text-orange-300">
                              Chặn mượn mới
                            </Badge>
                            {canManageRemediation ? (
                              <Button
                                size="sm"
                                className="h-7 text-[11px] px-2.5 gap-1 bg-orange-600 hover:bg-orange-700 text-white"
                                onClick={() => handleOpenResolveModal(r)}
                              >
                                <Wrench className="h-3 w-3" />
                                Xác nhận đã khắc phục
                              </Button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                Liên hệ Thủ thư tại quầy
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            ✓ Đã hoàn tất hồ sơ
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Librarian / Admin Remediation Confirmation Dialog */}
      <Dialog open={Boolean(resolveTarget)} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-orange-600" />
              Xác nhận hoàn tất khắc phục hiện vật
            </DialogTitle>
            <DialogDescription>
              Thư viện không thu tiền phạt. Sau khi đóng biên bản này, hệ thống sẽ kiểm tra lại toàn bộ điều kiện còn lại (quá hạn khác hoặc thời gian tạm ngưng) trước khi mở lại quyền mượn cho độc giả.
            </DialogDescription>
          </DialogHeader>

          {resolveTarget && (
            <div className="space-y-4 py-1 text-xs">
              <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
                <p>
                  <strong>Độc giả:</strong> {resolveTarget.reader_name} ({resolveTarget.card_number})
                </p>
                <p>
                  <strong>Sách:</strong> {resolveTarget.book_title}{" "}
                  {resolveTarget.book_copy_qr ? `[${resolveTarget.book_copy_qr}]` : ""}
                </p>
                <p>
                  <strong>Mức độ / Yêu cầu:</strong>{" "}
                  {SEVERITY_LABELS[resolveTarget.severity || "moderate"] || resolveTarget.severity} —{" "}
                  {resolveTarget.remediation_action || resolveTarget.reason}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remediation-note" className="text-xs font-semibold">
                  Ghi chú kết quả khắc phục
                </Label>
                <Textarea
                  id="remediation-note"
                  rows={3}
                  value={remediationNote}
                  onChange={(e) => setRemediationNote(e.target.value)}
                  placeholder="Ví dụ: Độc giả đã nộp 01 cuốn thay thế cùng nhan đề và dán lại mã QR..."
                />
              </div>

              {(resolveTarget.copy_status === "damaged" || resolveTarget.copy_status === "lost") && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
                  <Checkbox
                    id="restore-copy"
                    checked={restoreCopy}
                    onCheckedChange={(checked) => setRestoreCopy(Boolean(checked))}
                    className="mt-0.5"
                  />
                  <Label htmlFor="restore-copy" className="text-xs leading-relaxed cursor-pointer">
                    <strong>Khôi phục bản sao về trạng thái Sẵn sàng (Available)</strong>
                    <span className="block text-[11px] text-muted-foreground">
                      Tích chọn nếu sách đã được sửa xong hoặc đã thay thế bản sao tương đương để đưa trở lại kệ phục vụ.
                    </span>
                  </Label>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={isResolving}>
              Hủy
            </Button>
            <Button onClick={handleConfirmResolve} disabled={isResolving}>
              {isResolving ? "Đang xác nhận..." : "Xác nhận đã khắc phục"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
