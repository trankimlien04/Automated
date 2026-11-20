import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Crown,
  Eye,
  FileSpreadsheet,
  History,
  Layers,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  User,
  XCircle,
  Ban,
} from "lucide-react";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type RequestType = "create" | "import" | "restock" | "delete" | "update_sensitive";
type RequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "completed";

interface BookRequestApproval {
  id: number;
  request_id: number;
  reviewer_id: number;
  reviewer_name: string | null;
  reviewer_role: string | null;
  decision: "approved" | "rejected" | "cancelled" | "completed";
  note: string | null;
  created_at: string;
}

interface BookRequestItem {
  id: number;
  request_code: string;
  request_type: RequestType;
  status: RequestStatus;
  title: string;
  reason: string | null;
  requested_by: number;
  requested_by_name: string | null;
  requested_by_email: string | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  completed_at: string | null;
  created_at: string;
  book_id: number | null;
  quantity: number;
  location: string | null;
  book_title: string | null;
  book_isbn: string | null;
  book_current_location: string | null;
  book_total_copies: number | null;
  book_available_copies: number | null;
  payload: Record<string, any> | null;
  before: Record<string, any> | null;
  approvals: BookRequestApproval[];
}

interface SummaryCounts {
  pending: number;
  completed: number;
  rejected: number;
  cancelled: number;
  total: number;
}

const TYPE_META: Record<RequestType, { label: string; colorClass: string; icon: typeof PackagePlus }> = {
  create: {
    label: "Thêm đầu sách + bản sao",
    colorClass: "border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/10",
    icon: BookOpen,
  },
  import: {
    label: "Nhập kho Excel",
    colorClass: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
    icon: FileSpreadsheet,
  },
  restock: {
    label: "Nhập bổ sung bản sao",
    colorClass: "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10",
    icon: PackagePlus,
  },
  delete: {
    label: "Đề xuất thanh lý (Xóa mềm)",
    colorClass: "border-destructive/40 text-destructive bg-destructive/10",
    icon: Trash2,
  },
  update_sensitive: {
    label: "Đổi định danh (ISBN)",
    colorClass: "border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-500/10",
    icon: ShieldCheck,
  },
};

export default function BookRequestsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin";
  const isLibrarian = user?.role === "librarian";

  const [requests, setRequests] = useState<BookRequestItem[]>([]);
  const [summary, setSummary] = useState<SummaryCounts>({
    pending: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Inspect / Review / Cancel modal state
  const [selectedRequest, setSelectedRequest] = useState<BookRequestItem | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await api.get("/book-requests");
      setRequests(Array.isArray(res.data?.requests) ? res.data.requests : []);
      if (res.data?.summary) {
        setSummary(res.data.summary);
      }
    } catch (error: any) {
      console.error("Lỗi khi tải phiếu đề xuất kho:", error);
      toast.error(error.response?.data?.message || "Không thể tải danh sách phiếu đề xuất kho sách");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const filteredRequests = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.request_type !== typeFilter) return false;
      if (!q) return true;
      return (
        String(r.request_code || "").toLowerCase().includes(q) ||
        String(r.title || "").toLowerCase().includes(q) ||
        String(r.reason || "").toLowerCase().includes(q) ||
        String(r.requested_by_name || "").toLowerCase().includes(q) ||
        String(r.book_title || "").toLowerCase().includes(q)
      );
    });
  }, [requests, statusFilter, typeFilter, searchTerm]);

  const openInspectModal = (item: BookRequestItem, initialAction: "approved" | "rejected" | null = null) => {
    setSelectedRequest(item);
    setReviewAction(initialAction);
    setReviewNote("");
    setDetailModalOpen(true);
  };

  const handleSubmitReview = async (decision: "approved" | "rejected") => {
    if (!selectedRequest) return;
    if (decision === "rejected" && !reviewNote.trim()) {
      toast.error("Vui lòng nhập lý do từ chối để Thủ thư nắm rõ");
      return;
    }

    setReviewAction(decision);
    setSubmitting(true);
    try {
      const res = await api.patch(`/book-requests/${selectedRequest.id}/review`, {
        decision,
        review_note: reviewNote.trim(),
      });
      toast.success(res.data?.message || "Xử lý phiếu đề xuất thành công!");
      setDetailModalOpen(false);
      await fetchRequests();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể xử lý phiếu đề xuất");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (item: BookRequestItem) => {
    setSubmitting(true);
    try {
      const res = await api.patch(`/book-requests/${item.id}/cancel`, {
        reason: reviewNote.trim() || "Thủ thư chủ động thu hồi phiếu đề xuất",
      });
      toast.success(res.data?.message || `Đã hủy phiếu ${item.request_code}`);
      setDetailModalOpen(false);
      await fetchRequests();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Không thể hủy phiếu đề xuất");
    } finally {
      setSubmitting(false);
    }
  };

  const renderStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40 gap-1">
            <Clock className="h-3 w-3" /> Chờ duyệt
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 gap-1">
            <CheckCircle2 className="h-3 w-3" /> Đã thực thi
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/40 gap-1">
            <CheckCircle2 className="h-3 w-3" /> Đã phê duyệt
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" /> Đã từ chối
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="secondary" className="gap-1">
            <Ban className="h-3 w-3" /> Đã hủy
          </Badge>
        );
    }
  };

  const isSelfCreated = Boolean(selectedRequest && user && Number(selectedRequest.requested_by) === Number(user.id));

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/10 via-amber-500/5 to-emerald-500/10 shadow-xs">
        <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary text-primary-foreground gap-1">
                <ClipboardCheck className="h-3.5 w-3.5" /> Kiểm soát Kho Sách Maker–Checker
              </Badge>
              {isOwner && (
                <Badge variant="outline" className="bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/40 gap-1">
                  <Crown className="h-3.5 w-3.5" /> Quyền Checker: Chủ thư viện phê duyệt
                </Badge>
              )}
              {isAdmin && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/40 gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Quyền Admin: Giám sát (Chỉ đọc)
                </Badge>
              )}
              {isLibrarian && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 gap-1">
                  <Layers className="h-3.5 w-3.5" /> Quyền Maker: Thủ thư lập phiếu đề xuất
                </Badge>
              )}
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-foreground">
              Quản lý Phiếu Đề xuất & Phê duyệt Kho sách
            </h2>
            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
              Số lượng bản sao vật lý chỉ cập nhật trong transaction sau khi <strong>Chủ thư viện</strong> phê duyệt. Người tạo phiếu không được tự duyệt và mọi quyết định đều lưu nhật ký kèm dữ liệu Trước / Sau.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate("/books")} className="text-xs gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Mở Kho sách
            </Button>
            <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading} className="text-xs gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Phiếu chờ duyệt</p>
              <p className="text-2xl font-bold font-display text-amber-600 mt-1">{summary.pending}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Đã duyệt & Thực thi</p>
              <p className="text-2xl font-bold font-display text-emerald-600 mt-1">{summary.completed}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Đã từ chối</p>
              <p className="text-2xl font-bold font-display text-destructive mt-1">{summary.rejected}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-destructive/10 text-destructive">
              <XCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="border bg-muted/30">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Đã hủy / Tổng phiếu</p>
              <p className="text-2xl font-bold font-display text-foreground mt-1">
                {summary.cancelled} <span className="text-sm font-normal text-muted-foreground">/ {summary.total}</span>
              </p>
            </div>
            <div className="p-2.5 rounded-xl bg-background border text-muted-foreground">
              <History className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Danh sách Phiếu đề xuất nhập / sửa / thanh lý kho</CardTitle>
              <CardDescription className="text-xs">
                Hiển thị {filteredRequests.length} / {requests.length} phiếu theo bộ lọc hiện tại.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm mã phiếu, tên sách, lý do..."
                  className="pl-8 h-9 text-xs"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue placeholder="Trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Mọi trạng thái</SelectItem>
                  <SelectItem value="pending">Chờ duyệt</SelectItem>
                  <SelectItem value="completed">Đã thực thi</SelectItem>
                  <SelectItem value="rejected">Đã từ chối</SelectItem>
                  <SelectItem value="cancelled">Đã hủy</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue placeholder="Loại nghiệp vụ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả loại phiếu</SelectItem>
                  <SelectItem value="create">Thêm đầu sách + bản sao</SelectItem>
                  <SelectItem value="restock">Nhập bổ sung bản sao</SelectItem>
                  <SelectItem value="import">Nhập Excel hàng loạt</SelectItem>
                  <SelectItem value="delete">Thanh lý (Xóa mềm)</SelectItem>
                  <SelectItem value="update_sensitive">Đổi định danh ISBN</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 space-y-2 text-muted-foreground">
              <ClipboardCheck className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">Chưa có phiếu đề xuất nào khớp điều kiện lọc.</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs whitespace-nowrap">Mã phiếu</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Loại nghiệp vụ</TableHead>
                    <TableHead className="text-xs">Nội dung đề xuất & Lý do</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Người đề xuất</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Trạng thái</TableHead>
                    <TableHead className="text-xs text-right whitespace-nowrap">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((item) => {
                    const meta = TYPE_META[item.request_type] || TYPE_META.restock;
                    const TypeIcon = meta.icon;
                    const ownRequest = Boolean(user && Number(item.requested_by) === Number(user.id));

                    return (
                      <TableRow key={item.id} className="hover:bg-muted/30">
                        <TableCell className="font-mono text-xs font-semibold whitespace-nowrap">
                          <div>{item.request_code || `#${item.id}`}</div>
                          <div className="text-[10px] font-sans font-normal text-muted-foreground">
                            {new Date(item.created_at).toLocaleString("vi-VN")}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline" className={`text-[11px] gap-1 ${meta.colorClass}`}>
                            <TypeIcon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-sm">
                          <p className="text-xs font-semibold text-foreground line-clamp-1">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                            Lý do: {item.reason || "Không ghi rõ"}
                          </p>
                          {item.quantity > 0 && (
                            <span className="inline-block mt-1 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">
                              SL: {item.quantity} cuốn {item.location ? `• ${item.location}` : ""}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1.5 font-medium">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {item.requested_by_name || `#${item.requested_by}`}
                          </div>
                          {item.reviewed_by_name && (
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Duyệt: {item.reviewed_by_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="space-y-1">
                            {renderStatusBadge(item.status)}
                            {item.review_note && item.status !== "pending" && (
                              <p className="text-[10px] text-muted-foreground max-w-[180px] truncate" title={item.review_note}>
                                {item.review_note}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => openInspectModal(item, null)}
                            >
                              <Eye className="h-3 w-3" /> Chi tiết
                            </Button>

                            {isOwner && item.status === "pending" && !ownRequest && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => openInspectModal(item, "approved")}
                                >
                                  <CheckCircle2 className="h-3 w-3" /> Duyệt
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => openInspectModal(item, "rejected")}
                                >
                                  <XCircle className="h-3 w-3" /> Từ chối
                                </Button>
                              </>
                            )}

                            {isLibrarian && item.status === "pending" && ownRequest && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs gap-1 text-destructive hover:bg-destructive/10"
                                onClick={() => openInspectModal(item, null)}
                              >
                                <Ban className="h-3 w-3" /> Hủy phiếu
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail / Review Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          {selectedRequest && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <Badge variant="outline" className="font-mono text-xs">
                    {selectedRequest.request_code || `#${selectedRequest.id}`}
                  </Badge>
                  {renderStatusBadge(selectedRequest.status)}
                  <Badge variant="outline" className={TYPE_META[selectedRequest.request_type]?.colorClass}>
                    {TYPE_META[selectedRequest.request_type]?.label}
                  </Badge>
                </div>
                <DialogTitle className="font-display text-lg pt-1">{selectedRequest.title}</DialogTitle>
                <DialogDescription className="text-xs">
                  Đề xuất bởi <strong>{selectedRequest.requested_by_name}</strong> ({selectedRequest.requested_by_email}) lúc{" "}
                  {new Date(selectedRequest.created_at).toLocaleString("vi-VN")}.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-xs">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  <p className="font-semibold text-foreground">Lý do đề xuất:</p>
                  <p className="text-muted-foreground">{selectedRequest.reason || "Không có ghi chú thêm"}</p>
                </div>

                {/* Payload / Before-After comparison */}
                {selectedRequest.request_type === "import" && Array.isArray(selectedRequest.payload?.rows) ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        Chi tiết danh sách Excel ({selectedRequest.payload.rows.length} đầu sách hợp lệ • Tổng{" "}
                        {selectedRequest.quantity} bản sao):
                      </span>
                      {selectedRequest.payload?.fileName && (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          File: {selectedRequest.payload.fileName}
                        </Badge>
                      )}
                    </div>
                    <div className="max-h-56 overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0">
                          <TableRow>
                            <TableHead className="text-[11px] w-10 text-center">STT</TableHead>
                            <TableHead className="text-[11px]">Tên đầu sách</TableHead>
                            <TableHead className="text-[11px]">Tác giả</TableHead>
                            <TableHead className="text-[11px]">ISBN</TableHead>
                            <TableHead className="text-[11px]">Vị trí</TableHead>
                            <TableHead className="text-[11px] text-center">SL</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedRequest.payload.rows.map((row: Record<string, any>, idx: number) => (
                            <TableRow key={`${row.title}-${idx}`}>
                              <TableCell className="text-center font-mono text-[11px]">{idx + 1}</TableCell>
                              <TableCell className="font-medium text-[11px]">{row.title}</TableCell>
                              <TableCell className="text-[11px] text-muted-foreground">{row.author || "—"}</TableCell>
                              <TableCell className="text-[11px] font-mono">{row.isbn || "—"}</TableCell>
                              <TableCell className="text-[11px] font-mono">{row.location || "Tự động"}</TableCell>
                              <TableCell className="text-center font-semibold text-primary text-[11px]">
                                {row.total_copies}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3 bg-muted/20 space-y-1.5">
                      <p className="font-semibold text-foreground">Trạng thái / Dữ liệu Trước</p>
                      {selectedRequest.before ? (
                        <div className="space-y-1 text-[11px] text-muted-foreground">
                          <p>
                            Đầu sách: <strong className="text-foreground">{selectedRequest.before.title || selectedRequest.book_title || "—"}</strong>
                          </p>
                          <p>ISBN hiện tại: <span className="font-mono">{selectedRequest.before.isbn || "Trống"}</span></p>
                          <p>Vị trí: <span className="font-mono">{selectedRequest.before.location || "—"}</span></p>
                          <p>
                            Tồn kho trước: <strong>{selectedRequest.before.total_copies ?? 0}</strong> tổng /{" "}
                            <strong>{selectedRequest.before.available_copies ?? 0}</strong> sẵn sàng
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] italic text-muted-foreground">Chưa tồn tại trong kho (Tạo mới đầu sách).</p>
                      )}
                    </div>

                    <div className="rounded-lg border border-primary/30 p-3 bg-primary/5 space-y-1.5">
                      <p className="font-semibold text-primary flex items-center gap-1">
                        <ArrowRight className="h-3.5 w-3.5" /> Đề xuất Áp dụng Sau khi Duyệt
                      </p>
                      {selectedRequest.request_type === "delete" ? (
                        <div className="space-y-1 text-[11px] text-destructive">
                          <p className="font-semibold flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" /> Chuyển sang trạng thái: {selectedRequest.payload?.disposal_status || "disposed"}
                          </p>
                          <p className="text-muted-foreground">
                            Áp dụng xóa mềm (Soft delete): ẩn khỏi danh mục & tìm kiếm nhưng giữ nguyên lịch sử mượn trả và nhật ký kiểm tra.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1 text-[11px] text-foreground">
                          <p>
                            Đầu sách: <strong>{selectedRequest.payload?.title || selectedRequest.book_title || selectedRequest.title}</strong>
                          </p>
                          {selectedRequest.payload?.isbn !== undefined && (
                            <p>ISBN sau duyệt: <span className="font-mono font-semibold">{selectedRequest.payload.isbn || "Trống"}</span></p>
                          )}
                          {selectedRequest.location && (
                            <p>Vị trí kho: <span className="font-mono">{selectedRequest.location}</span></p>
                          )}
                          {(selectedRequest.request_type === "restock" || selectedRequest.request_type === "create") && (
                            <p>
                              Số lượng nhập kho & sinh mã QR: <strong className="text-emerald-600">+{selectedRequest.quantity} bản sao</strong>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Approval Audit History */}
                {selectedRequest.approvals.length > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5 text-primary" /> Lịch sử Phê duyệt (book_request_approvals)
                    </p>
                    <div className="space-y-1.5">
                      {selectedRequest.approvals.map((ap) => (
                        <div key={ap.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/40 px-2.5 py-1.5 text-[11px]">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] uppercase font-mono">
                              {ap.decision}
                            </Badge>
                            <span className="font-medium">{ap.reviewer_name || `#${ap.reviewer_id}`}</span>
                            {ap.note && <span className="text-muted-foreground">— {ap.note}</span>}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(ap.created_at).toLocaleString("vi-VN")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review / Cancel Input Controls */}
                {selectedRequest.status === "pending" && isOwner && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2.5">
                    {isSelfCreated ? (
                      <p className="text-destructive font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        Quy tắc chống tự duyệt: Bạn là người tạo phiếu nên không thể tự phê duyệt phiếu này.
                      </p>
                    ) : (
                      <>
                        <p className="font-semibold text-foreground">Quyết định phê duyệt của Chủ thư viện:</p>
                        <Textarea
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder="Nhập ghi chú phê duyệt hoặc lý do từ chối (bắt buộc nếu từ chối)..."
                          rows={2}
                          className="text-xs bg-background"
                        />
                      </>
                    )}
                  </div>
                )}

                {selectedRequest.status === "pending" && isLibrarian && isSelfCreated && (
                  <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                    <p className="font-semibold text-foreground">Hủy phiếu đề xuất (khi còn chờ duyệt):</p>
                    <Input
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="Nhập lý do hủy phiếu (tùy chọn)..."
                      className="text-xs"
                    />
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => setDetailModalOpen(false)} disabled={submitting} className="text-xs">
                  Đóng
                </Button>

                {selectedRequest.status === "pending" && isLibrarian && isSelfCreated && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={submitting}
                    onClick={() => handleCancelRequest(selectedRequest)}
                    className="text-xs gap-1.5"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {submitting ? "Đang hủy..." : "Xác nhận Hủy phiếu"}
                  </Button>
                )}

                {selectedRequest.status === "pending" && isOwner && !isSelfCreated && (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={submitting}
                      onClick={() => handleSubmitReview("rejected")}
                      className="text-xs gap-1.5"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {submitting && reviewAction === "rejected" ? "Đang xử lý..." : "Từ chối"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={submitting}
                      onClick={() => handleSubmitReview("approved")}
                      className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {submitting && reviewAction === "approved" ? "Đang thực thi..." : "Phê duyệt & Thực thi kho"}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
