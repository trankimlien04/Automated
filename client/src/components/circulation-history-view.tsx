import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  FileSpreadsheet, Search, RefreshCw, Download, Filter,
  BookOpen, Calendar, Clock, AlertTriangle, CheckCircle2, Inbox
} from "lucide-react";
import * as XLSX from "xlsx";
import api from "@/services/api";
import { toast } from "sonner";
import { BookDropAuditModal } from "@/components/book-drop-audit-modal";

interface Transaction {
  id: number;
  borrow_date: string;
  due_date: string;
  return_date: string | null;
  status: string;
  renewal_count?: number;
  reader_name: string;
  card_number: string;
  reader_phone?: string;
  book_title: string;
  qr_code: string;
  cover_image?: string;
  processed_by_name?: string;
  fine_already_paid?: boolean | number;
  is_drop_box?: boolean | number;
  drop_box_at?: string | null;
  drop_box_status?: string | null;
  drop_box_audit_note?: string | null;
  drop_box_audited_at?: string | null;
  drop_box_audited_by_name?: string | null;
  return_method?: "drop_box" | "counter" | null;
}

export function CirculationHistoryView() {
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "borrowing" | "overdue" | "returned" | "drop_box">("all");
  const [bookDropModalOpen, setBookDropModalOpen] = useState(false);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const res = await api.get("/borrow/records");
      if (Array.isArray(res.data)) {
        setHistory(res.data);
      }
    } catch (e) {
      toast.error("Không thể tải sổ lưu thông mượn trả");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const getDueStatus = (dueDateStr: string, status: string, fineAlreadyPaid?: boolean | number, isDropBox?: boolean | number, dropBoxStatus?: string | null) => {
    if (status === "returned_drop_box" || (isDropBox && dropBoxStatus === "pending_audit")) {
      return { isOverdue: false, label: "Hòm 24/7 (Chờ kiểm kê)", color: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-400/50 font-bold" };
    }
    if (status === "returned") {
      if (isDropBox) {
        return { isOverdue: false, label: "Đã trả (Hòm 24/7)", color: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30 font-semibold" };
      }
      return { isOverdue: false, label: "Đã trả tại quầy", color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDateStr);
    due.setHours(0, 0, 0, 0);
    const diff = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diff < 0) {
      if (fineAlreadyPaid) {
        return { isOverdue: true, label: `Quá hạn (Đã nộp phạt)`, color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-medium" };
      }
      return { isOverdue: true, label: `Quá hạn ${Math.abs(diff)} ngày`, color: "bg-destructive/15 text-destructive border-destructive/30" };
    }
    if (diff === 0) {
      return { isOverdue: false, label: "Đến hạn hôm nay", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    }
    return { isOverdue: false, label: `Còn ${diff} ngày`, color: "bg-sky-500/10 text-sky-600 border-sky-500/30" };
  };

  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const matchSearch =
        !searchTerm.trim() ||
        item.book_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.reader_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.card_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.qr_code?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchSearch) return false;

      const dueInfo = getDueStatus(item.due_date, item.status, item.fine_already_paid, item.is_drop_box, item.drop_box_status);
      if (statusFilter === "borrowing") return item.status === "borrowing" && !dueInfo.isOverdue;
      if (statusFilter === "overdue") return item.status === "borrowing" && dueInfo.isOverdue;
      if (statusFilter === "returned") return item.status === "returned" && !item.is_drop_box;
      if (statusFilter === "drop_box") return Boolean(item.is_drop_box || item.status === "returned_drop_box");
      return true;
    });
  }, [history, searchTerm, statusFilter]);

  const handleExportExcel = () => {
    if (filteredHistory.length === 0) {
      toast.warning("Không có dữ liệu để xuất file Excel!");
      return;
    }
    const exportData = filteredHistory.map((item, idx) => ({
      STT: idx + 1,
      "Tên sách": item.book_title,
      "Mã bản sao QR": item.qr_code,
      "Độc giả": item.reader_name,
      "Mã thẻ": item.card_number,
      "SĐT": item.reader_phone || "—",
      "Ngày mượn": new Date(item.borrow_date).toLocaleDateString("vi-VN"),
      "Hạn trả": new Date(item.due_date).toLocaleDateString("vi-VN"),
      "Ngày trả thực tế": item.return_date ? new Date(item.return_date).toLocaleDateString("vi-VN") : "Chưa trả",
      "Hình thức trả": item.is_drop_box || item.status === "returned_drop_box" ? "Hòm trả sách 24/7" : item.status === "returned" ? "Tại quầy" : "Chưa trả",
      "Trạng thái đối soát hòm": item.drop_box_status === "pending_audit" ? "Chờ kiểm kê" : item.drop_box_status === "verified_intact" ? "Đã kiểm nhận nguyên vẹn" : item.drop_box_status === "damaged" ? "Hư hại" : "—",
      "Thời điểm thả hòm": item.drop_box_at ? new Date(item.drop_box_at).toLocaleString("vi-VN") : "—",
      "Trạng thái": item.status === "borrowing" ? "Đang mượn" : item.status === "returned_drop_box" ? "Thả hòm (Chờ kiểm kê)" : "Đã trả",
      "Số lần gia hạn": item.renewal_count || 0
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SoLuuThong");
    XLSX.writeFile(wb, `So_Luu_Thong_Muon_Tra_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Đã xuất sổ lưu thông ra file Excel!");
  };

  const pendingDropBoxCount = history.filter(h => h.status === "returned_drop_box" || (h.is_drop_box && h.drop_box_status === "pending_audit")).length;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <Card className="border-border shadow-xs">
        <CardHeader className="py-4 px-5 border-b border-border/60">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span>Sổ Lưu Thông & Đối Soát Mượn Trả</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Toàn bộ nhật ký các giao dịch lưu thông tài liệu trong thư viện với phân loại kênh trả Tại Quầy hoặc Hòm 24/7.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBookDropModalOpen(true)}
                className={`h-8 text-xs font-semibold gap-1.5 border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40 cursor-pointer shadow-2xs ${pendingDropBoxCount > 0 ? "bg-sky-50/80 animate-pulse" : ""}`}
                title="Mở giao diện kiểm kê đối soát sách trả ngoài giờ"
              >
                <Inbox className="h-3.5 w-3.5 text-sky-600" />
                <span>Kiểm Kê Hòm 24/7 {pendingDropBoxCount > 0 ? `(${pendingDropBoxCount})` : ""}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                className="h-8 text-xs font-semibold gap-1.5 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-emerald-600" />
                <span>Xuất Excel</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={fetchRecords}
                disabled={loading}
                className="h-8 w-8 p-0"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* Search & Filter Strip */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm tên sách, tên bạn đọc, mã thẻ, mã bản sao..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs px-2.5"
              >
                Tất cả ({history.length})
              </Button>
              <Button
                variant={statusFilter === "borrowing" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("borrowing")}
                className="h-7 text-xs px-2.5"
              >
                Đang mượn ({history.filter(h => h.status === "borrowing" && !getDueStatus(h.due_date, h.status).isOverdue).length})
              </Button>
              <Button
                variant={statusFilter === "overdue" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("overdue")}
                className="h-7 text-xs px-2.5 text-destructive"
              >
                Quá hạn ({history.filter(h => h.status === "borrowing" && getDueStatus(h.due_date, h.status).isOverdue).length})
              </Button>
              <Button
                variant={statusFilter === "returned" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("returned")}
                className="h-7 text-xs px-2.5 text-emerald-600"
              >
                Tại quầy ({history.filter(h => h.status === "returned" && !h.is_drop_box).length})
              </Button>
              <Button
                variant={statusFilter === "drop_box" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("drop_box")}
                className="h-7 text-xs px-2.5 border-sky-400 text-sky-700 dark:text-sky-300 font-semibold gap-1"
              >
                <Inbox className="h-3 w-3" /> Hòm 24/7 ({history.filter(h => h.is_drop_box || h.status === "returned_drop_box").length})
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Ấn phẩm & Bản sao</TableHead>
                  <TableHead className="text-xs">Độc giả</TableHead>
                  <TableHead className="text-xs">Ngày mượn</TableHead>
                  <TableHead className="text-xs">Hạn trả</TableHead>
                  <TableHead className="text-xs">Hình thức & Kênh trả</TableHead>
                  <TableHead className="text-xs text-right">Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-xs text-muted-foreground">
                      Không tìm thấy giao dịch lưu thông nào phù hợp.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredHistory.map((item) => {
                    const dueInfo = getDueStatus(item.due_date, item.status, item.fine_already_paid, item.is_drop_box, item.drop_box_status);
                    const isDropBox = Boolean(item.is_drop_box || item.status === "returned_drop_box");

                    return (
                      <TableRow key={item.id} className="hover:bg-muted/10 transition-colors">
                        <TableCell className="py-2.5">
                          <p className="font-semibold text-xs text-foreground max-w-[280px] truncate">{item.book_title}</p>
                          <p className="text-[11px] font-mono text-muted-foreground">{item.qr_code}</p>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <p className="font-medium text-xs text-foreground">{item.reader_name}</p>
                          <p className="text-[11px] font-mono text-primary">{item.card_number}</p>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                          {new Date(item.borrow_date).toLocaleDateString("vi-VN")}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          <span className="font-medium text-foreground">{new Date(item.due_date).toLocaleDateString("vi-VN")}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          {isDropBox ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 text-[10px] font-bold gap-1 py-0 px-1.5">
                                <Inbox className="h-2.5 w-2.5" /> Hòm trả 24/7
                              </Badge>
                              {item.drop_box_at && (
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  Thả: {new Date(item.drop_box_at).toLocaleString("vi-VN")}
                                </p>
                              )}
                              {item.drop_box_audit_note && (
                                <p className="text-[10px] text-muted-foreground italic truncate max-w-[150px]">
                                  "{item.drop_box_audit_note}"
                                </p>
                              )}
                            </div>
                          ) : item.status === "returned" ? (
                            <div className="space-y-0.5">
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px] font-semibold py-0 px-1.5">
                                🏢 Tại quầy
                              </Badge>
                              <p className="text-[10px] text-muted-foreground">
                                {item.return_date ? new Date(item.return_date).toLocaleDateString("vi-VN") : "—"}
                              </p>
                              {item.processed_by_name && (
                                <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                  Thủ thư: {item.processed_by_name}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <Badge variant="outline" className={`text-[10px] font-semibold py-0.5 px-2 ${dueInfo.color}`}>
                            {dueInfo.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Book Drop Audit Modal for Librarians */}
      <BookDropAuditModal
        open={bookDropModalOpen}
        onOpenChange={setBookDropModalOpen}
        onSuccess={fetchRecords}
      />
    </div>
  );
}
export default CirculationHistoryView;

