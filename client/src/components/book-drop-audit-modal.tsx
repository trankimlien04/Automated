import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Inbox, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  BookOpen, Clock, ShieldCheck, UserCheck, AlertOctagon, HelpCircle
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";

interface BookDropAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function BookDropAuditModal({ open, onOpenChange, onSuccess }: BookDropAuditModalProps) {
  const [dropItems, setDropItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Damage reporting sub-dialog
  const [damageDialogOpen, setDamageDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [damageNote, setDamageNote] = useState("Rách trang sách / ướt bìa");
  const [damageFee, setDamageFee] = useState("50000");
  const [submittingAction, setSubmittingAction] = useState(false);

  const fetchDropItems = async () => {
    setLoading(true);
    try {
      const res = await api.get("/borrow/drop-box-items");
      setDropItems(res.data);
    } catch (e) {
      console.error("Lỗi khi tải danh sách sách hòm 24/7:", e);
      toast.error("Không thể tải danh sách sách trong hòm 24/7");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchDropItems();
    }
  }, [open]);

  const handleAuditAction = async (recordId: number, action: "verify_intact" | "report_damaged" | "report_missing", note?: string, fee?: number) => {
    setSubmittingAction(true);
    try {
      const res = await api.post("/borrow/drop-box-audit", {
        recordId,
        action,
        auditNote: note,
        damageFee: fee
      });
      toast.success(res.data.message || "Đã hoàn tất đối soát cuốn sách!");
      fetchDropItems();
      setDamageDialogOpen(false);
      setSelectedRecord(null);
      if (onSuccess) onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Lỗi khi đối soát");
    } finally {
      setSubmittingAction(false);
    }
  };

  const filteredItems = dropItems.filter(it => {
    const q = searchTerm.toLowerCase();
    return (
      it.book_title?.toLowerCase().includes(q) ||
      it.copy_qr?.toLowerCase().includes(q) ||
      it.reader_name?.toLowerCase().includes(q) ||
      it.card_number?.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-2xl shadow-2xl border-2 border-slate-700">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 p-6 text-white flex items-center justify-between border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-sky-600/30 border border-sky-500/40 flex items-center justify-center text-sky-400">
                <Inbox className="w-7 h-7" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
                  Kiểm Kê Sách Trả Ngoài Giờ (Hòm Ngoại Tuyến)
                </DialogTitle>
                <DialogDescription className="text-slate-400 text-xs mt-0.5">
                  Thủ thư kiểm tra đối soát tình trạng thực tế sách độc giả gửi trả ngoài giờ để hoàn tất thủ tục nhập kho trên phần mềm
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-sky-300 border-sky-400/40 bg-sky-950/60 font-mono text-xs">
                {dropItems.length} cuốn chờ đối soát nhập kho
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                onClick={fetchDropItems}
                disabled={loading}
                className="h-8 w-8 text-slate-300 hover:text-white"
                title="Làm mới"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Search Input */}
            <Input
              placeholder="Tìm kiếm theo tên sách, mã bản sao (QR) hoặc tên độc giả..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs h-9"
            />

            {/* List */}
            {filteredItems.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <Inbox className="w-12 h-12 mx-auto text-slate-300 stroke-1" />
                <p className="text-sm font-semibold text-slate-700">
                  Hòm trả sách hiện đang trống!
                </p>
                <p className="text-xs">
                  Toàn bộ sách trả qua Hòm 24/7 đã được đối soát và nhập kho đầy đủ.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.record_id}
                    className="p-4 rounded-xl border bg-card hover:border-sky-300 transition-all shadow-sm space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-16 rounded-lg bg-slate-100 overflow-hidden shrink-0 border flex items-center justify-center">
                          {item.cover_image ? (
                            <img src={item.cover_image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <BookOpen className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-slate-900">
                            {item.book_title}
                          </h4>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            Mã bản sao: <strong className="text-sky-700">{item.copy_qr}</strong> • Vị trí kệ: {item.book_location}
                          </p>
                          <p className="text-xs text-slate-700 mt-1">
                            Độc giả: <strong>{item.reader_name}</strong> (Mã thẻ: <code>{item.card_number}</code>)
                          </p>
                        </div>
                      </div>

                      {/* Drop timestamp & overdue badge */}
                      <div className="text-right shrink-0 space-y-1">
                        <div className="inline-flex items-center gap-1.5 text-xs text-slate-600 font-mono">
                          <Clock className="w-3.5 h-3.5 text-sky-600" />
                          Thả hòm: {item.drop_box_at ? new Date(item.drop_box_at).toLocaleString("vi-VN") : "N/A"}
                        </div>
                        <div>
                          {item.overdueDays > 0 ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Trễ {item.overdueDays} ngày (Phạt {item.fineAmount?.toLocaleString("vi-VN")}đ)
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-600 text-white text-[10px]">
                              Đúng hạn khi thả hòm
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Note if reader wrote one */}
                    {item.drop_box_audit_note && (
                      <p className="text-[11px] p-2 rounded-lg bg-muted/60 text-muted-foreground italic">
                        📝 Ghi chú độc giả: "{item.drop_box_audit_note}"
                      </p>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs gap-1.5"
                        disabled={submittingAction}
                        onClick={() => {
                          if (confirm(`Xác nhận báo KHÔNG TÌM THẤY cuốn "${item.book_title}" trong hòm? Phiếu mượn sẽ hoàn tác về ĐANG MƯỢN để điều tra camera.`)) {
                            handleAuditAction(item.record_id, "report_missing");
                          }
                        }}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Thiếu sách trong hòm
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                        disabled={submittingAction}
                        onClick={() => {
                          setSelectedRecord(item);
                          setDamageDialogOpen(true);
                        }}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        Báo sách rách / hỏng bìa
                      </Button>

                      <Button
                        size="sm"
                        className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        disabled={submittingAction}
                        onClick={() => handleAuditAction(item.record_id, "verify_intact")}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Sách nguyên vẹn (Nhập kho)
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="p-4 bg-slate-100 border-t flex sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Đóng cửa sổ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub Dialog: Report Damage */}
      <Dialog open={damageDialogOpen} onOpenChange={setDamageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Biên Bản Hư Hỏng Sách (Hòm 24/7)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Lập biên bản vi phạm cho độc giả: {selectedRecord?.reader_name} ({selectedRecord?.book_title})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Mô tả tình trạng hư hại:</label>
              <Textarea
                value={damageNote}
                onChange={(e) => setDamageNote(e.target.value)}
                placeholder="Ví dụ: Rách bìa sau 5cm, viết vẽ bậy trang 12, ướt góc..."
                className="text-xs h-20"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700">Mức phạt bồi hoàn (VNĐ):</label>
              <Input
                type="number"
                value={damageFee}
                onChange={(e) => setDamageFee(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDamageDialogOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={submittingAction || !damageNote.trim()}
              onClick={() => {
                if (selectedRecord) {
                  handleAuditAction(selectedRecord.record_id, "report_damaged", damageNote, parseInt(damageFee, 10));
                }
              }}
            >
              {submittingAction ? "Đang lập..." : "Xác nhận phạt hư hại"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
