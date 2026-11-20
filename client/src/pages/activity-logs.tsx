import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, User, Clock, Eye } from "lucide-react";
import api from "@/services/api";
import { toast } from "sonner";

interface ActivityLog {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  user_role: string;
  action: string;
  target_type: string;
  target_id: number;
  details: string;
  before_data?: string | null;
  after_data?: string | null;
  outcome?: string | null;
  created_at: string;
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDiffLog, setSelectedDiffLog] = useState<ActivityLog | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const response = await api.get("/activity-logs");
      setLogs(response.data);
    } catch (error) {
      console.error("Lỗi khi tải nhật ký hoạt động:", error);
      toast.error("Không thể tải danh sách nhật ký hoạt động");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const getActionBadge = (action: string) => {
    switch (action?.toUpperCase()) {
      case "BORROW":
      case "BORROW_BOOK":
      case "APPROVE_DRAFT_BORROW":
        return <Badge className="bg-primary hover:bg-primary/90">Mượn sách</Badge>;
      case "RETURN":
      case "RETURN_BOOK":
      case "DROP_BOX_RETURN":
        return <Badge className="bg-success hover:bg-success/90">Trả sách</Badge>;
      case "RENEW":
        return <Badge variant="outline" className="border-sky-500 text-sky-600">Gia hạn</Badge>;
      case "HANDOVER_RESERVATION":
        return <Badge variant="outline" className="border-emerald-500 text-emerald-600">Giao đặt trước</Badge>;
      case "DROP_BOX_AUDIT":
        return <Badge variant="outline" className="border-indigo-500 text-indigo-600">Đối soát hòm 24/7</Badge>;
      case "RECEIPT_VERIFIED":
        return <Badge variant="outline" className="border-teal-500 text-teal-600">Đối soát phiếu mượn</Badge>;
      case "REPORT_BOOK_INCIDENT":
        return <Badge variant="outline" className="border-orange-500 text-orange-600">Biên bản sự cố</Badge>;
      case "RESOLVE_VIOLATION":
        return <Badge variant="outline" className="border-emerald-500 text-emerald-700">Xác nhận khắc phục</Badge>;
      case "PROPOSE_CONFIG":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">Đề xuất quy chế</Badge>;
      case "APPROVE_CONFIG":
        return <Badge variant="outline" className="border-emerald-600 text-emerald-700">Duyệt quy chế</Badge>;
      case "REJECT_CONFIG":
        return <Badge variant="destructive">Từ chối quy chế</Badge>;
      case "CREATE_BOOK":
        return <Badge variant="outline" className="border-blue-500 text-blue-600">Biên mục đầu sách</Badge>;
      case "UPDATE_BOOK_METADATA":
        return <Badge variant="outline" className="border-amber-500 text-amber-600">Sửa thông tin sách</Badge>;
      case "MOVE_LOCATION":
        return <Badge variant="outline" className="border-cyan-500 text-cyan-600">Đổi vị trí kệ</Badge>;
      case "PROPOSE_BOOK_CREATE":
      case "PROPOSE_BOOK_RESTOCK":
      case "PROPOSE_BOOK_IMPORT":
      case "PROPOSE_BOOK_DELETE":
      case "PROPOSE_BOOK_UPDATE_SENSITIVE":
        return <Badge variant="outline" className="border-amber-500 text-amber-700 bg-amber-500/10">Lập phiếu kho</Badge>;
      case "APPROVE_BOOK_REQUEST":
        return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">Duyệt phiếu kho</Badge>;
      case "REJECT_BOOK_REQUEST":
        return <Badge variant="destructive">Từ chối phiếu kho</Badge>;
      case "CANCEL_BOOK_REQUEST":
        return <Badge variant="secondary">Hủy phiếu kho</Badge>;
      case "CREATE":
        return <Badge variant="outline" className="border-blue-500 text-blue-500">Tạo mới</Badge>;
      case "UPDATE":
      case "UPDATE_CONFIG":
      case "UPDATE_PROFILE":
        return <Badge variant="outline" className="border-amber-500 text-amber-500">Cập nhật</Badge>;
      case "DELETE":
        return <Badge variant="destructive">Xóa</Badge>;
      default:
        return <Badge variant="secondary">{action}</Badge>;
    }
  };

  const formatTargetLabel = (targetType?: string, targetId?: number) => {
    if (!targetType) return "—";
    const labels: Record<string, string> = {
      borrow_records: "Phiếu mượn",
      borrow_drafts: "Phiếu nháp",
      exit_passes: "Phiếu mượn đối soát",
      fines: "Hồ sơ vi phạm",
      config_change_requests: "Đề xuất quy chế",
      system_configs: "Quy chế hệ thống",
      reservations: "Đặt trước",
      notifications: "Thông báo",
      users: "Tài khoản",
      books: "Sách",
      book_copies: "Bản sao QR",
      book_requests: "Phiếu đề xuất kho",
      system: "Hệ thống",
    };
    const label = labels[targetType] || targetType;
    return targetId ? `${label} #${targetId}` : label;
  };

  const formatJsonPreview = (raw?: string | null) => {
    if (!raw) return "Không có";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nhật ký hoạt động hệ thống</h1>
          <p className="text-muted-foreground">Theo dõi lịch sử thao tác nghiệp vụ và vận hành hệ thống.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Nhật ký hệ thống gần đây
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Chưa có nhật ký hoạt động nào.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Người thực hiện</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Đối tượng</TableHead>
                    <TableHead>Chi tiết & Dữ liệu</TableHead>
                    <TableHead className="w-28 text-center">Kết quả</TableHead>
                    <TableHead className="w-40 text-right">Thời gian</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium">#{log.id}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium flex items-center gap-1">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {log.user_name || "Hệ thống tự động"}
                          </span>
                          {log.user_email && <span className="text-xs text-muted-foreground">{log.user_email}</span>}
                        </div>
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatTargetLabel(log.target_type, log.target_id)}
                      </TableCell>
                      <TableCell className="max-w-md text-xs text-muted-foreground leading-snug space-y-1">
                        <div>{log.details || "—"}</div>
                        {(log.before_data || log.after_data) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedDiffLog(log)}
                            className="h-6 px-2 text-[11px] gap-1"
                          >
                            <Eye className="h-3 w-3" /> Xem Trước / Sau
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {log.outcome || "success"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        <span className="flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(log.created_at).toLocaleString("vi-VN")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedDiffLog)} onOpenChange={(open) => !open && setSelectedDiffLog(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Đối chiếu Dữ liệu Trước & Sau (#{selectedDiffLog?.id})</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedDiffLog?.action} • {selectedDiffLog?.details}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1.5">
              <p className="font-semibold text-muted-foreground">Dữ liệu Trước thay đổi</p>
              <pre className="rounded-lg border bg-muted/40 p-3 text-[11px] font-mono overflow-x-auto max-h-72 whitespace-pre-wrap">
                {formatJsonPreview(selectedDiffLog?.before_data)}
              </pre>
            </div>
            <div className="space-y-1.5">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">Dữ liệu Sau thay đổi</p>
              <pre className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] font-mono overflow-x-auto max-h-72 whitespace-pre-wrap">
                {formatJsonPreview(selectedDiffLog?.after_data)}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDiffLog(null)} className="text-xs">
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
