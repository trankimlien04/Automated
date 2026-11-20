import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QRCodeCanvas } from "qrcode.react";
import {
  FileCheck2, BookOpen, Copy, Check, Printer, CheckCircle2, Calendar,
  UserCheck, User, Phone, CreditCard, Inbox, Store, AlertTriangle, Clock, QrCode
} from "lucide-react";
import { toast } from "sonner";
import { maskPhoneNumber, getReaderStatusMeta } from "./exit-pass-modal";

export interface ReturnSlipData {
  id?: number;
  return_code?: string;
  returnCode?: string;
  return_method?: "counter" | "drop_box" | string;
  returnMethod?: "counter" | "drop_box" | string;
  status?: string;
  book_count?: number;
  bookCount?: number;
  borrow_slip_codes?: string[];
  borrowSlipCodes?: string[];
  items?: any[];
  items_summary?: any;
  drop_box_received_at?: string | null;
  dropBoxReceivedAt?: string | null;
  returned_at?: string | null;
  returnedAt?: string | null;
  created_at?: string | null;
  reader_name?: string;
  readerName?: string;
  card_number?: string;
  cardNumber?: string;
  reader_phone?: string;
  phone?: string;
  reader_status?: string;
  librarian_name?: string;
  librarianName?: string;
  processed_by_name?: string;
  notes?: string;
}

interface ReturnSlipModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slipData: ReturnSlipData | null;
  onOpenBorrowSlip?: (slipCode: string) => void;
}

function formatDateTimeVi(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} • ${d.toLocaleDateString("vi-VN")}`;
}

function getConditionMeta(condition?: string) {
  switch ((condition || "normal").toLowerCase()) {
    case "damaged":
      return {
        label: "Hư hỏng",
        statusText: "Chờ khắc phục",
        className: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "lost":
      return {
        label: "Mất sách",
        statusText: "Chờ khắc phục",
        className: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300",
      };
    default:
      return {
        label: "Bình thường",
        statusText: "Đã trả",
        className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
  }
}

export function ReturnSlipModal({ open, onOpenChange, slipData, onOpenBorrowSlip }: ReturnSlipModalProps) {
  const [copied, setCopied] = useState(false);

  if (!slipData) return null;

  const returnCode = String(slipData.return_code || slipData.returnCode || "RT-PENDING");
  const returnMethod = (slipData.return_method || slipData.returnMethod || "counter") === "drop_box" ? "drop_box" : "counter";
  const isDropBox = returnMethod === "drop_box";

  const rawItems = slipData.items || slipData.items_summary || [];
  const items = Array.isArray(rawItems)
    ? rawItems
    : typeof rawItems === "string"
    ? (() => { try { return JSON.parse(rawItems); } catch { return []; } })()
    : [];

  const rawBorrowSlips = slipData.borrow_slip_codes || slipData.borrowSlipCodes || [];
  const parsedBorrowSlips = Array.isArray(rawBorrowSlips)
    ? rawBorrowSlips
    : typeof rawBorrowSlips === "string"
    ? (() => { try { return JSON.parse(rawBorrowSlips); } catch { return []; } })()
    : [];

  const borrowSlipCodes: string[] = Array.from(
    new Set([
      ...parsedBorrowSlips,
      ...items.map((it: any) => it.borrowSlipCode || it.pass_code).filter(Boolean),
    ])
  );

  const bookCount = slipData.book_count || slipData.bookCount || items.length || 1;
  const librarianName = slipData.librarian_name || slipData.librarianName || slipData.processed_by_name || "Thủ thư trực quầy";
  const returnedAtRaw = slipData.returned_at || slipData.returnedAt || slipData.created_at;
  const dropBoxReceivedAtRaw = slipData.drop_box_received_at || slipData.dropBoxReceivedAt || items[0]?.dropBoxReceivedAt || null;

  const hasIncident = slipData.status === "partial_incident" || items.some((it: any) => it.condition && it.condition !== "normal");

  const readerName = slipData.reader_name || slipData.readerName || "Độc giả thư viện";
  const readerCardNumber = slipData.card_number || slipData.cardNumber || "Đang cập nhật";
  const readerPhoneMasked = maskPhoneNumber(slipData.reader_phone || slipData.phone);
  const readerStatusMeta = getReaderStatusMeta(slipData.reader_status);
  const readerInitials = readerName
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "DG";

  const handleCopyCode = () => {
    if (!returnCode) return;
    navigator.clipboard.writeText(returnCode);
    setCopied(true);
    toast.success(`Đã sao chép mã Phiếu trả: ${returnCode}`);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] w-[95vw] p-0 overflow-hidden border border-sky-500/30 shadow-2xl rounded-2xl bg-card max-h-[92vh] flex flex-col">
        {/* Header - Official Return Slip */}
        <div className="bg-gradient-to-r from-sky-600 via-cyan-600 to-teal-700 px-6 py-4 text-white text-center relative overflow-hidden shrink-0">
          <div className="absolute top-0 right-0 -mr-8 -mt-8 w-24 h-24 bg-white/10 rounded-full blur-xl pointer-events-none" />
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-bold tracking-wider uppercase mb-1.5 border border-white/25">
            <FileCheck2 className="w-3.5 h-3.5" />
            Phiếu Trả Sách Chính Thức
          </div>
          <DialogTitle className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
            Phiếu Trả Sách Điện Tử
          </DialogTitle>
          <DialogDescription className="text-sky-100 text-xs mt-0.5">
            Chứng từ xác nhận hoàn trả sách &amp; liên kết đối chiếu với Phiếu mượn gốc
          </DialogDescription>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Reader Verification Block */}
          <div className="rounded-2xl bg-slate-50/90 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                <User className="w-3.5 h-3.5 text-sky-600" />
                Thông tin độc giả
              </span>
              <Badge variant="outline" className={`text-[10px] font-semibold px-2 py-0.5 ${readerStatusMeta.className}`}>
                {readerStatusMeta.label}
              </Badge>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-sky-600 to-teal-600 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                  {readerInitials}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-foreground truncate">{readerName}</p>
                  <p className="text-xs font-mono font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1 mt-0.5">
                    <CreditCard className="w-3 h-3 shrink-0" />
                    <span>Mã thẻ: {readerCardNumber}</span>
                  </p>
                </div>
              </div>

              <div className="sm:text-right pl-[52px] sm:pl-0 shrink-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground flex sm:justify-end items-center gap-1">
                  <Phone className="w-3 h-3 text-slate-500" /> Số điện thoại
                </p>
                <p className="text-xs font-mono font-semibold text-foreground mt-0.5">
                  {readerPhoneMasked}
                </p>
              </div>
            </div>
          </div>

          {/* Unified QR & Return Metadata */}
          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex flex-col items-center shrink-0 p-2.5 bg-slate-50/70 dark:bg-slate-950 rounded-xl border border-slate-200/80 dark:border-slate-800">
              <div className="p-2 bg-white rounded-lg shadow-2xs border border-slate-100">
                <QRCodeCanvas
                  value={returnCode}
                  size={128}
                  level="H"
                  includeMargin={false}
                />
              </div>
              {hasIncident ? (
                <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  Đã trả (Có ghi nhận)
                </span>
              ) : (
                <span className="mt-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-bold">
                  <CheckCircle2 className="w-3 h-3 text-sky-600" />
                  Đã xác nhận trả
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0 w-full space-y-2.5">
              {/* Return Code */}
              <div className="flex items-center justify-between gap-2 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/50 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                    Mã phiếu trả điện tử
                  </p>
                  <p className="font-mono font-black text-sm sm:text-base text-slate-900 dark:text-slate-100 truncate">
                    {returnCode}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-sky-700 hover:bg-sky-100 dark:text-sky-300 shrink-0 cursor-pointer"
                  onClick={handleCopyCode}
                  title="Sao chép mã Phiếu trả"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>

              {/* Linked Original Borrow Slips */}
              <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/40 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Phiếu mượn gốc liên kết ({borrowSlipCodes.length || 1})
                </p>
                <div className="flex flex-wrap gap-1">
                  {borrowSlipCodes.length > 0 ? (
                    borrowSlipCodes.map((code) =>
                      onOpenBorrowSlip ? (
                        <button
                          key={code}
                          type="button"
                          onClick={() => onOpenBorrowSlip(code)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 font-mono font-bold text-[10px] cursor-pointer transition-colors"
                          title="Bấm để mở đối chiếu Phiếu mượn gốc"
                        >
                          <QrCode className="w-2.5 h-2.5" />
                          {code}
                        </button>
                      ) : (
                        <Badge key={code} variant="outline" className="font-mono text-[10px] bg-white dark:bg-slate-900 border-emerald-300 text-emerald-700">
                          {code}
                        </Badge>
                      )
                    )
                  ) : (
                    <span className="text-[11px] text-muted-foreground font-mono">Đang đồng bộ</span>
                  )}
                </div>
              </div>

              {/* Method + Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                  <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    {isDropBox ? <Inbox className="w-3 h-3 text-sky-600" /> : <Store className="w-3 h-3 text-emerald-600" />}
                    Phương thức trả
                  </p>
                  <p className="text-xs font-bold text-foreground mt-0.5">
                    {isDropBox ? "Hòm trả sách 24/7" : "Tại quầy thủ thư"}
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200/80 dark:border-sky-800/40">
                  <p className="text-[10px] text-sky-700 dark:text-sky-400 font-semibold flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-sky-600" />
                    {isDropBox ? "Thời điểm xác nhận" : "Ngày giờ trả thực tế"}
                  </p>
                  <p className="text-xs font-extrabold text-sky-700 dark:text-sky-300 mt-0.5">
                    {formatDateTimeVi(returnedAtRaw)}
                  </p>
                </div>
              </div>

              {isDropBox && dropBoxReceivedAtRaw && (
                <div className="p-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/40 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-amber-800 dark:text-amber-300 font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                    Tiếp nhận hòm 24/7 (Chốt hạn trả):
                  </span>
                  <span className="font-mono font-bold text-amber-900 dark:text-amber-200 shrink-0">
                    {formatDateTimeVi(dropBoxReceivedAtRaw)}
                  </span>
                </div>
              )}

              {/* Confirmer & Count */}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 pt-0.5">
                <span className="inline-flex items-center gap-1 truncate">
                  <UserCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  Người xác nhận: <strong className="text-foreground">{librarianName}</strong>
                </span>
                <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-[10px] font-bold shrink-0">
                  {bookCount} cuốn sách
                </Badge>
              </div>
            </div>
          </div>

          {/* Returned Items List */}
          {items.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Danh sách sách đã trả ({items.length} cuốn)
                </p>
                <span className="text-[11px] text-sky-700 dark:text-sky-400 font-medium">
                  Đã kiểm tra &amp; xác nhận
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {items.map((it: any, index: number) => {
                  const condMeta = getConditionMeta(it.condition);
                  const origSlip = it.borrowSlipCode || it.pass_code || null;
                  return (
                    <div
                      key={index}
                      className="flex items-start justify-between gap-3 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-muted/30 text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <BookOpen className="w-3.5 h-3.5 text-sky-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-foreground truncate">
                            {it.bookTitle || it.title || "Ấn phẩm thư viện"}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                            <span className="font-mono">
                              Mã bản sao: <strong className="text-sky-700 dark:text-sky-400">{it.copyQr || it.qrCode || "N/A"}</strong>
                            </span>
                            {origSlip && (
                              <span className="font-mono text-emerald-700 dark:text-emerald-400">
                                • PM gốc: <strong>{origSlip}</strong>
                              </span>
                            )}
                          </div>
                          {it.conditionNote && (
                            <p className="text-[10px] italic text-amber-700 dark:text-amber-300 mt-0.5">
                              Ghi chú: {it.conditionNote}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0 ${condMeta.className}`}>
                          {condMeta.label}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-medium">
                          {condMeta.statusText}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Note */}
          <div className="px-3.5 py-2.5 rounded-xl bg-sky-500/8 border border-sky-500/20 text-[11px] text-sky-900 dark:text-sky-200 leading-relaxed">
            <strong>📌 Minh chứng hoàn trả:</strong> Phiếu trả sách điện tử này liên kết trực tiếp với Phiếu mượn gốc. {isDropBox ? "Với Hòm trả 24/7, thời điểm tiếp nhận (thả hòm) dùng để chốt hạn trả và thời điểm xác nhận ghi nhận lúc Thủ thư kiểm tra sách thực tế." : "Bạn có thể mở lại Phiếu mượn gốc và Phiếu trả này trong Lịch sử giao dịch để đối chiếu bất cứ lúc nào."}
          </div>
        </div>

        <DialogFooter className="px-5 py-3.5 bg-muted/30 border-t flex flex-row items-center justify-between gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="text-xs gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> In Phiếu trả
          </Button>
          <Button
            size="sm"
            className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-5 cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Đóng Phiếu trả
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReturnSlipModal;

