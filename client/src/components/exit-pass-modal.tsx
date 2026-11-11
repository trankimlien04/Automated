import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QRCodeCanvas } from "qrcode.react";
import { FileCheck, BookOpen, Copy, Check, Printer, CheckCircle2, Calendar, UserCheck } from "lucide-react";
import { toast } from "sonner";

interface ExitPassModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passData: {
    pass_code?: string;
    passCode?: string;
    book_count?: number;
    bookCount?: number;
    items?: any[];
    items_summary?: any;
    created_at?: string;
    createdAt?: string;
    expires_at?: string;
    expiresAt?: string;
    status?: string;
    reader_name?: string;
    readerName?: string;
    card_number?: string;
    cardNumber?: string;
  } | null;
  borrowRecords?: any[];
}

export function ExitPassModal({ open, onOpenChange, passData, borrowRecords = [] }: ExitPassModalProps) {
  const [copied, setCopied] = useState(false);

  const rawPassCode = passData?.pass_code || passData?.passCode || "";
  const passCode = String(rawPassCode).replace(/^PASS-EXP-/i, "PM-BRW-");
  const rawItems = passData?.items || passData?.items_summary || [];
  const parsedItems = Array.isArray(rawItems)
    ? rawItems
    : typeof rawItems === "string"
    ? (() => { try { return JSON.parse(rawItems); } catch { return []; } })()
    : [];

  const handleCopyCode = () => {
    if (!passCode) return;
    navigator.clipboard.writeText(passCode);
    setCopied(true);
    toast.success(`Đã sao chép mã Phiếu mượn: ${passCode}`);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!passData) return null;

  // Tính Ngày mượn gốc từ thời điểm tạo phiếu (created_at) và Hạn trả chuẩn (Ngày mượn + 14 ngày)
  const rawCreatedStr = passData.created_at || passData.createdAt || "";
  const baseCreatedDate = rawCreatedStr && !isNaN(new Date(rawCreatedStr).getTime())
    ? new Date(rawCreatedStr)
    : new Date();
  const defaultBorrowDateStr = baseCreatedDate.toLocaleDateString("vi-VN");
  const defaultDueDateObj = new Date(baseCreatedDate.getTime());
  defaultDueDateObj.setDate(defaultDueDateObj.getDate() + 14);
  const defaultDueDateStr = defaultDueDateObj.toLocaleDateString("vi-VN");

  // Đồng bộ từng cuốn sách với borrow_records thực tế (nếu có) để lấy chính xác Ngày mượn & Hạn trả 14 ngày
  const items = parsedItems.map((it: any) => {
    const itemQr = it.copyQr || it.qr_code || "";
    const itemTitle = it.title || it.book_title || "";
    const matchedRec = borrowRecords.find((r: any) => {
      if (it.recordId && r.id === it.recordId) return true;
      if (itemQr && r.qr_code === itemQr) return true;
      if (itemTitle && r.book_title === itemTitle) return true;
      return false;
    });

    const resolvedBorrowDate = matchedRec?.borrow_date
      ? new Date(matchedRec.borrow_date).toLocaleDateString("vi-VN")
      : (it.borrowDate || defaultBorrowDateStr);

    const resolvedDueDate = matchedRec?.due_date
      ? new Date(matchedRec.due_date).toLocaleDateString("vi-VN")
      : (rawCreatedStr ? defaultDueDateStr : (it.dueDate || defaultDueDateStr));

    return {
      ...it,
      title: itemTitle || matchedRec?.book_title || "Ấn phẩm thư viện",
      copyQr: itemQr || matchedRec?.qr_code || "N/A",
      borrowDate: resolvedBorrowDate,
      dueDate: resolvedDueDate,
    };
  });

  const bookCount = passData?.book_count || passData?.bookCount || (items.length || 1);
  const firstItem = items[0] || {};
  const draftCode = (passData as any)?.draftCode || firstItem.draftCode || null;
  const librarianName = (passData as any)?.librarianName || firstItem.librarianName || "Thủ thư trực quầy";
  const borrowDateStr = firstItem.borrowDate || (passData as any)?.borrowDate || defaultBorrowDateStr;
  const dueDateStr = firstItem.dueDate || (rawCreatedStr ? defaultDueDateStr : ((passData as any)?.dueDate || defaultDueDateStr));
  const isUsed = passData.status === "used" || (passData as any)?.displayStatus === "used";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] w-[95vw] p-0 overflow-hidden border border-emerald-500/30 shadow-2xl rounded-2xl bg-card">
        {/* Header - Official Borrow Slip */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 px-6 py-4 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-bold tracking-wider uppercase mb-1.5 border border-white/25">
            <FileCheck className="w-3.5 h-3.5" />
            Phiếu Mượn Sách Chính Thức
          </div>
          <DialogTitle className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
            Phiếu Mượn & Đối Soát Ra Cổng
          </DialogTitle>
          <DialogDescription className="text-emerald-100 text-xs mt-0.5">
            Chứng từ xác nhận mượn sách tại quầy — dùng để đối soát mượn trả và xuất trình khi ra cổng
          </DialogDescription>
        </div>

        <div className="p-5 space-y-4">
          {/* Unified QR & Slip Info Card */}
          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            {/* Left: QR Code */}
            <div className="flex flex-col items-center shrink-0 p-2.5 bg-slate-50/70 dark:bg-slate-950 rounded-xl border border-slate-200/80 dark:border-slate-800">
              <div className="p-2 bg-white rounded-lg shadow-2xs border border-slate-100">
                <QRCodeCanvas
                  value={passCode}
                  size={132}
                  level="H"
                  includeMargin={false}
                />
              </div>
              {isUsed ? (
                <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3 text-blue-600" />
                  Đã đối soát qua cổng
                </span>
              ) : (
                <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Đã xác nhận cho mượn
                </span>
              )}
            </div>

            {/* Right: Pass Code & 14-day Borrow Metadata */}
            <div className="flex-1 min-w-0 w-full space-y-2.5">
              {/* Pass Code Box */}
              <div className="flex items-center justify-between gap-2 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/50 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Mã phiếu mượn đối soát
                  </p>
                  <p className="font-mono font-black text-sm sm:text-base text-slate-900 dark:text-slate-100 truncate">
                    {passCode}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 shrink-0 cursor-pointer"
                  onClick={handleCopyCode}
                  title="Sao chép mã Phiếu mượn"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {draftCode && (
                <div className="text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                  Chuyển từ Phiếu nháp: <span className="font-mono font-bold">{draftCode}</span>
                </div>
              )}

              {/* 2x2 Grid: Borrow Date & 14-Day Due Date */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                  <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-500" /> Ngày mượn
                  </p>
                  <p className="text-xs font-bold text-foreground mt-0.5">{borrowDateStr}</p>
                </div>
                <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40">
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-emerald-600" /> Hạn trả (14 ngày)
                  </p>
                  <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {dueDateStr}
                  </p>
                </div>
              </div>

              {/* Librarian & Count Row */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 pt-0.5">
                <span className="inline-flex items-center gap-1 truncate">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  Duyệt: <strong className="text-foreground">{librarianName}</strong>
                </span>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold shrink-0">
                  {bookCount} cuốn sách
                </Badge>
              </div>
            </div>
          </div>

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Danh sách bản sao trong phiếu ({items.length} cuốn)
                </p>
                <span className="text-[11px] text-emerald-700 font-medium">Thời hạn mượn: 14 ngày</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {items.map((it: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-muted/30 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                        <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-foreground truncate">
                          {it.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          Mã bản sao: <strong className="text-emerald-700 dark:text-emerald-400">{it.copyQr}</strong>
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        Hạn trả: {it.dueDate}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concise Guidelines Note */}
          <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-[11px] text-emerald-900 dark:text-emerald-200 leading-relaxed">
            <strong>📌 Lưu ý:</strong> Phiếu mượn chính thức được chuyển đổi từ <strong>Phiếu mượn nháp</strong> khi Thủ thư xác nhận cho mượn tại quầy (thời hạn mượn tiêu chuẩn <strong>14 ngày</strong> kể từ ngày mượn), dùng để đối soát mượn trả và xuất trình khi ra cổng nếu được hỏi.
          </div>
        </div>

        <DialogFooter className="px-5 py-3.5 bg-muted/30 border-t flex flex-row items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="text-xs gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> In Phiếu mượn
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Đóng Phiếu mượn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export default ExitPassModal;
