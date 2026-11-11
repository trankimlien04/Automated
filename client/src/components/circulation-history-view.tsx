import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  FileSpreadsheet, Search, RefreshCw, Download, Filter,
  BookOpen, Calendar, Clock, AlertTriangle, CheckCircle2, Inbox, Image as ImageIcon, Eye, QrCode
} from "lucide-react";
import * as XLSX from "xlsx";
import api from "@/services/api";
import { toast } from "sonner";
import { BookDropAuditModal } from "@/components/book-drop-audit-modal";
import { ExitPassModal } from "@/components/exit-pass-modal";

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
  pass_code?: string | null;
  cover_image?: string;
  processed_by_name?: string;
  fine_already_paid?: boolean | number;
  is_drop_box?: boolean | number;
  drop_box_at?: string | null;
  drop_box_status?: string | null;
  drop_box_audit_note?: string | null;
  drop_box_audited_at?: string | null;
  drop_box_audited_by_name?: string | null;
  drop_box_proof_image?: string | null;
  return_method?: "drop_box" | "counter" | null;
}

export function CirculationHistoryView() {
  const [history, setHistory] = useState<Transaction[]>([]);
  const [borrowSlips, setBorrowSlips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "borrowing" | "overdue" | "returned" | "drop_box" | "slips">("all");
  const [bookDropModalOpen, setBookDropModalOpen] = useState(false);
  const [previewProofImg, setPreviewProofImg] = useState<{ url: string; title: string; reader: string; time?: string } | null>(null);
  const [selectedSlip, setSelectedSlip] = useState<any>(null);
  const [slipModalOpen, setSlipModalOpen] = useState(false);

  const formatViDate = (val?: string | null) => {
    if (!val) return "—";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val.trim())) return val.trim();
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleDateString("vi-VN");
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const [res, slipsRes] = await Promise.all([
        api.get("/borrow/records"),
        api.get("/borrow/exit-passes/active-list").catch(() => ({ data: [] }))
      ]);

      const rawRecords: Transaction[] = Array.isArray(res.data) ? res.data : [];
      const rawSlips: any[] = Array.isArray(slipsRes.data) ? slipsRes.data : [];

      // 1. Deduplicate borrow records by id (prevents duplicate rows if multiple fine records exist)
      const recordMap = new Map<number, Transaction>();
      for (const r of rawRecords) {
        if (!recordMap.has(r.id)) {
          recordMap.set(r.id, r);
        } else {
          const existing = recordMap.get(r.id)!;
          if (r.fine_already_paid && !existing.fine_already_paid) {
            recordMap.set(r.id, r);
          }
        }
      }
      const uniqueRecords = Array.from(recordMap.values());

      // Normalize existing slips
      const normalizedSlips = rawSlips.map((s: any) => ({
        ...s,
        pass_code: (s.pass_code || "").replace(/^PASS-EXP-/i, "PM-BRW-"),
        items: Array.isArray(s.items) ? s.items : []
      }));

      // 2. Link every borrow record with its Official Borrow Slip (or synthesize one by reader + borrow day)
      const synthesizedGroups = new Map<string, any>();

      const enrichedRecords = uniqueRecords.map((r) => {
        const existingCode = r.pass_code ? r.pass_code.replace(/^PASS-EXP-/i, "PM-BRW-") : null;
        if (existingCode) {
          return { ...r, pass_code: existingCode };
        }

        const matchedSlip =
          normalizedSlips.find(
            (s) =>
              s.card_number === r.card_number &&
              s.items.some((it: any) => (it.qr_code || it.copy_qr_code || it.copyQr) === r.qr_code) &&
              Math.abs(new Date(s.created_at || r.borrow_date).getTime() - new Date(r.borrow_date).getTime()) < 72 * 3600 * 1000
          ) ||
          normalizedSlips.find(
            (s) =>
              s.card_number === r.card_number &&
              s.items.some((it: any) => (it.qr_code || it.copy_qr_code || it.copyQr) === r.qr_code)
          );

        if (matchedSlip?.pass_code) {
          return { ...r, pass_code: matchedSlip.pass_code };
        }

        const dayStr = new Date(r.borrow_date).toISOString().slice(0, 10);
        const groupKey = `${r.card_number}_${dayStr}`;
        if (!synthesizedGroups.has(groupKey)) {
          const suffix = (r.card_number || "").replace(/\D/g, "").replace(/^0+/, "") || String(r.id);
          const synthCode = `PM-BRW-${String(r.id).padStart(4, "0")}-${suffix}`;
          synthesizedGroups.set(groupKey, {
            id: `synth-${r.id}`,
            pass_code: synthCode,
            reader_name: r.reader_name,
            card_number: r.card_number,
            created_at: r.borrow_date,
            borrowDate: formatViDate(r.borrow_date),
            dueDate: formatViDate(r.due_date),
            librarianName: r.processed_by_name || "Trần Thủ Thư",
            status: r.status === "returned" ? "used" : "active",
            book_count: 0,
            items: []
          });
        }
        const grp = synthesizedGroups.get(groupKey)!;
        if (!grp.items.some((it: any) => it.qr_code === r.qr_code)) {
          grp.items.push({
            title: r.book_title,
            book_title: r.book_title,
            qr_code: r.qr_code,
            copyQr: r.qr_code,
            cover_image: r.cover_image,
            borrowDate: formatViDate(r.borrow_date),
            dueDate: formatViDate(r.due_date),
            librarianName: r.processed_by_name || "Trần Thủ Thư"
          });
          grp.book_count = grp.items.length;
        }
        return { ...r, pass_code: grp.pass_code };
      });

      // Merge normalizedSlips and synthesizedGroups without duplicate pass_code
      const mergedSlipsMap = new Map<string, any>();
      for (const s of normalizedSlips) {
        if (s.pass_code) mergedSlipsMap.set(s.pass_code, s);
      }
      for (const [, s] of synthesizedGroups.entries()) {
        if (!mergedSlipsMap.has(s.pass_code)) {
          mergedSlipsMap.set(s.pass_code, s);
        }
      }
      const allSlips = Array.from(mergedSlipsMap.values()).sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );

      setHistory(enrichedRecords);
      setBorrowSlips(allSlips);
    } catch (e) {
      toast.error("Không thể tải sổ lưu thông mượn trả");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSlipByCode = async (passCode: string, fallbackItem?: Transaction) => {
    const existing = borrowSlips.find(s => s.pass_code === passCode);
    if (existing) {
      setSelectedSlip(existing);
      setSlipModalOpen(true);
      return;
    }
    if (fallbackItem) {
      const sameSlipItems = history.filter(h => h.pass_code === passCode);
      const itemsList = (sameSlipItems.length > 0 ? sameSlipItems : [fallbackItem]).map(h => ({
        title: h.book_title,
        book_title: h.book_title,
        qr_code: h.qr_code,
        copyQr: h.qr_code,
        cover_image: h.cover_image,
        borrowDate: formatViDate(h.borrow_date),
        dueDate: formatViDate(h.due_date),
        librarianName: h.processed_by_name || "Trần Thủ Thư"
      }));
      setSelectedSlip({
        pass_code: passCode,
        reader_name: fallbackItem.reader_name,
        card_number: fallbackItem.card_number,
        created_at: fallbackItem.borrow_date,
        borrowDate: formatViDate(fallbackItem.borrow_date),
        dueDate: formatViDate(fallbackItem.due_date),
        librarianName: fallbackItem.processed_by_name || "Trần Thủ Thư",
        book_count: itemsList.length,
        items: itemsList
      });
      setSlipModalOpen(true);
      return;
    }
    try {
      const res = await api.post("/borrow/exit-passes/verify", { passCode });
      if (res.data?.pass) {
        setSelectedSlip(res.data.pass);
        setSlipModalOpen(true);
      } else {
        toast.warning(res.data?.message || `Không tìm thấy Phiếu mượn [${passCode}]`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || `Không tìm thấy Phiếu mượn [${passCode}]`);
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
      return { isOverdue: true, label: `Quá hạn ${Math.abs(diff)} ngày`, color: "bg-destructive/15 text-destructive border-destructive/30 font-medium" };
    }
    if (diff === 0) {
      return { isOverdue: false, label: "Đến hạn hôm nay", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    }
    return { isOverdue: false, label: `Còn ${diff} ngày`, color: "bg-sky-500/10 text-sky-600 border-sky-500/30" };
  };

  const isItemBorrowingNormal = (item: Transaction) => {
    const dueInfo = getDueStatus(item.due_date, item.status, item.fine_already_paid, item.is_drop_box, item.drop_box_status);
    return item.status === "borrowing" && !dueInfo.isOverdue;
  };

  const isItemOverdue = (item: Transaction) => {
    const dueInfo = getDueStatus(item.due_date, item.status, item.fine_already_paid, item.is_drop_box, item.drop_box_status);
    return item.status === "borrowing" && dueInfo.isOverdue;
  };

  const isItemReturnedCounter = (item: Transaction) => {
    return item.status === "returned" && !item.is_drop_box;
  };

  const isItemDropBox = (item: Transaction) => {
    return Boolean(item.is_drop_box || item.status === "returned_drop_box");
  };

  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const q = searchTerm.toLowerCase();
      const matchSearch =
        !searchTerm.trim() ||
        item.book_title?.toLowerCase().includes(q) ||
        item.reader_name?.toLowerCase().includes(q) ||
        item.card_number?.toLowerCase().includes(q) ||
        item.qr_code?.toLowerCase().includes(q) ||
        item.pass_code?.toLowerCase().includes(q);

      if (!matchSearch) return false;

      if (statusFilter === "borrowing") return isItemBorrowingNormal(item);
      if (statusFilter === "overdue") return isItemOverdue(item);
      if (statusFilter === "returned") return isItemReturnedCounter(item);
      if (statusFilter === "drop_box") return isItemDropBox(item);
      return true;
    });
  }, [history, searchTerm, statusFilter]);

  const filteredSlips = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return borrowSlips;
    return borrowSlips.filter((s: any) =>
      s.pass_code?.toLowerCase().includes(q) ||
      s.reader_name?.toLowerCase().includes(q) ||
      s.card_number?.toLowerCase().includes(q) ||
      s.items?.some((it: any) =>
        (it.title || it.book_title || "")?.toLowerCase().includes(q) ||
        (it.qr_code || it.copy_qr_code || "")?.toLowerCase().includes(q)
      )
    );
  }, [borrowSlips, searchTerm]);

  const handleExportExcel = () => {
    if (statusFilter === "slips") {
      if (filteredSlips.length === 0) {
        toast.warning("Không có dữ liệu Phiếu mượn để xuất file Excel!");
        return;
      }
      const exportData = filteredSlips.map((slip: any, idx: number) => ({
        STT: idx + 1,
        "Mã Phiếu Mượn": slip.pass_code,
        "Độc giả": slip.reader_name,
        "Mã thẻ": slip.card_number,
        "Số cuốn": slip.book_count || slip.items?.length || 1,
        "Danh sách sách": (slip.items || []).map((it: any) => `${it.title || it.book_title} (${it.qr_code || it.copy_qr_code})`).join("; "),
        "Ngày mượn": formatViDate(slip.borrowDate || slip.created_at),
        "Hạn trả (14 ngày)": formatViDate(slip.dueDate),
        "Thủ thư xác nhận": slip.librarianName || "Trần Thủ Thư"
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "PhieuMuonDoiSoat");
      XLSX.writeFile(wb, `Phieu_Muon_Doi_Soat_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Đã xuất danh sách Phiếu mượn đối soát ra file Excel!");
      return;
    }

    if (filteredHistory.length === 0) {
      toast.warning("Không có dữ liệu để xuất file Excel!");
      return;
    }
    const exportData = filteredHistory.map((item, idx) => ({
      STT: idx + 1,
      "Mã Phiếu Mượn": item.pass_code || "—",
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
                placeholder="Tìm mã Phiếu mượn (PM-BRW-...), tên sách, bạn đọc, mã QR..."
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
                className="h-7 text-xs px-2.5 font-semibold cursor-pointer"
              >
                Tất cả ({history.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter("slips")}
                className={`h-7 text-xs px-2.5 font-semibold gap-1 cursor-pointer ${
                  statusFilter === "slips"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                    : "border-emerald-400 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
                }`}
              >
                <QrCode className="h-3 w-3" /> Phiếu mượn đối soát ({borrowSlips.length})
              </Button>
              <Button
                variant={statusFilter === "borrowing" ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("borrowing")}
                className="h-7 text-xs px-2.5 font-semibold cursor-pointer"
              >
                Đang mượn ({history.filter(isItemBorrowingNormal).length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter("overdue")}
                className={`h-7 text-xs px-2.5 font-semibold cursor-pointer ${
                  statusFilter === "overdue"
                    ? "bg-destructive hover:bg-destructive/90 text-white border-destructive"
                    : "border-destructive/40 text-destructive hover:bg-destructive/10"
                }`}
              >
                Quá hạn ({history.filter(isItemOverdue).length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter("returned")}
                className={`h-7 text-xs px-2.5 font-semibold cursor-pointer ${
                  statusFilter === "returned"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                    : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50"
                }`}
              >
                Tại quầy ({history.filter(isItemReturnedCounter).length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusFilter("drop_box")}
                className={`h-7 text-xs px-2.5 font-semibold gap-1 cursor-pointer ${
                  statusFilter === "drop_box"
                    ? "bg-sky-600 hover:bg-sky-700 text-white border-sky-600"
                    : "border-sky-400 text-sky-700 dark:text-sky-300 hover:bg-sky-50"
                }`}
              >
                <Inbox className="h-3 w-3" /> Hòm 24/7 ({history.filter(isItemDropBox).length})
              </Button>
            </div>
          </div>

          {/* Table */}
          {statusFilter === "slips" ? (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table key="table-slips">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">Mã Phiếu Mượn Chính Thức</TableHead>
                    <TableHead className="text-xs">Độc giả</TableHead>
                    <TableHead className="text-xs">Danh sách ấn phẩm & Bản sao</TableHead>
                    <TableHead className="text-xs">Ngày mượn & Hạn trả (14 ngày)</TableHead>
                    <TableHead className="text-xs">Thủ thư xác nhận</TableHead>
                    <TableHead className="text-xs text-right">Thao tác đối soát</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSlips.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-xs text-muted-foreground">
                        Không tìm thấy Phiếu mượn chính thức nào phù hợp.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSlips.map((slip: any, sIdx: number) => (
                      <TableRow key={`${slip.pass_code}-${sIdx}`} className="hover:bg-muted/10 transition-colors">
                        <TableCell className="py-2.5">
                          <code className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold text-xs">
                            {slip.pass_code}
                          </code>
                          {slip.pass_code?.startsWith("PM-BRW-") && (
                            <p className="text-[10px] text-muted-foreground font-mono mt-1">
                              Từ nháp: {slip.pass_code.replace(/^PM-BRW-/, "DRAFT-BRW-")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <p className="font-medium text-xs text-foreground">{slip.reader_name}</p>
                          <p className="text-[11px] font-mono text-primary">{slip.card_number}</p>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="space-y-1">
                            {(slip.items || []).map((it: any, idx: number) => (
                              <div key={idx} className="text-xs flex items-center gap-1.5">
                                <span className="font-semibold text-foreground truncate max-w-[220px]">
                                  {it.title || it.book_title}
                                </span>
                                <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5">
                                  {it.qr_code || it.copy_qr_code || it.copyQr}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          <p className="text-muted-foreground">
                            Mượn: <strong className="text-foreground">{formatViDate(slip.borrowDate || slip.created_at)}</strong>
                          </p>
                          <p className="text-emerald-700 dark:text-emerald-400">
                            Hạn trả: <strong>{formatViDate(slip.dueDate)}</strong>
                          </p>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          <span className="font-medium text-foreground">{slip.librarianName || "Trần Thủ Thư"}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                            onClick={() => {
                              setSelectedSlip(slip);
                              setSlipModalOpen(true);
                            }}
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            Xem Phiếu & Đối Soát
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table key={`table-${statusFilter}`}>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">Ấn phẩm & Bản sao</TableHead>
                    <TableHead className="text-xs">Phiếu mượn đối soát</TableHead>
                    <TableHead className="text-xs">Độc giả</TableHead>
                    <TableHead className="text-xs">Ngày mượn</TableHead>
                    <TableHead className="text-xs">Hạn trả</TableHead>
                    <TableHead className="text-xs">Hình thức & Kênh trả</TableHead>
                    <TableHead className="text-xs text-right">Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody key={`tbody-${statusFilter}`}>
                  {filteredHistory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-xs text-muted-foreground">
                        Không tìm thấy giao dịch lưu thông nào phù hợp.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredHistory.map((item, idx) => {
                      const dueInfo = getDueStatus(item.due_date, item.status, item.fine_already_paid, item.is_drop_box, item.drop_box_status);
                      const isDropBox = Boolean(item.is_drop_box || item.status === "returned_drop_box");

                      return (
                        <TableRow key={`${statusFilter}-${item.id}-${idx}`} className="hover:bg-muted/10 transition-colors">
                          <TableCell className="py-2.5">
                            <p className="font-semibold text-xs text-foreground max-w-[260px] truncate">{item.book_title}</p>
                            <p className="text-[11px] font-mono text-muted-foreground">{item.qr_code}</p>
                          </TableCell>
                          <TableCell className="py-2.5">
                            {item.pass_code ? (
                              <button
                                type="button"
                                onClick={() => handleOpenSlipByCode(item.pass_code!, item)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono font-bold text-[10px] cursor-pointer transition-colors"
                                title="Bấm để mở Phiếu mượn chính thức & đối soát"
                              >
                                <QrCode className="h-3 w-3" />
                                {item.pass_code}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
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
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge className="bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 text-[10px] font-bold gap-1 py-0 px-1.5">
                                    <Inbox className="h-2.5 w-2.5" /> Hòm trả 24/7
                                  </Badge>
                                  {item.drop_box_proof_image && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreviewProofImg({
                                          url: item.drop_box_proof_image!,
                                          title: item.book_title,
                                          reader: `${item.reader_name} (${item.card_number})`,
                                          time: item.drop_box_at ? new Date(item.drop_box_at).toLocaleString("vi-VN") : undefined
                                        })
                                      }
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 hover:text-sky-800 underline cursor-pointer"
                                    >
                                      <Eye className="h-2.5 w-2.5" /> Ảnh minh chứng
                                    </button>
                                  )}
                                </div>
                                {item.drop_box_at && (
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    Thả: {new Date(item.drop_box_at).toLocaleString("vi-VN")}
                                  </p>
                                )}
                                {item.drop_box_audited_by_name && (
                                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                                    ĐS bởi: {item.drop_box_audited_by_name}
                                    {item.drop_box_audited_at ? ` (${new Date(item.drop_box_audited_at).toLocaleString("vi-VN")})` : ""}
                                  </p>
                                )}
                                {item.drop_box_audit_note && (
                                  <p className="text-[10px] text-muted-foreground italic truncate max-w-[180px]" title={item.drop_box_audit_note}>
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
          )}
        </CardContent>
      </Card>

      {/* Official Borrow Slip (Phiếu Mượn & Đối Soát Ra Cổng) Modal */}
      <ExitPassModal
        open={slipModalOpen}
        onOpenChange={setSlipModalOpen}
        passData={selectedSlip}
      />

      {/* Book Drop Audit Modal for Librarians */}
      <BookDropAuditModal
        open={bookDropModalOpen}
        onOpenChange={setBookDropModalOpen}
        onSuccess={fetchRecords}
      />

      {/* Proof Image Preview Modal */}
      <Dialog open={Boolean(previewProofImg)} onOpenChange={(v) => !v && setPreviewProofImg(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-sky-600" />
              Ảnh Minh Chứng Độc Giả Thả Hòm 24/7
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ấn phẩm: <strong>{previewProofImg?.title}</strong> • Độc giả: <strong>{previewProofImg?.reader}</strong>
              {previewProofImg?.time ? ` • Lúc: ${previewProofImg.time}` : ""}
            </DialogDescription>
          </DialogHeader>
          {previewProofImg && (
            <div className="rounded-xl overflow-hidden border bg-slate-950 flex items-center justify-center max-h-[65vh]">
              <img
                src={previewProofImg.url}
                alt="Ảnh minh chứng thả sách"
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewProofImg(null)}>
              Đóng ảnh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default CirculationHistoryView;

