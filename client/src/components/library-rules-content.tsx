import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookMarked,
  UserCheck,
  BookOpen,
  Clock,
  RefreshCw,
  Inbox,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";

export interface PublicReaderRules {
  max_books_per_user: string;
  max_borrow_days: string;
  grace_days: string;
  suspension_days_per_late_day: string;
  max_suspension_days: string;
  block_reserve_when_suspended: string;
}

export const DEFAULT_READER_RULES: PublicReaderRules = {
  max_books_per_user: "5",
  max_borrow_days: "14",
  grace_days: "0",
  suspension_days_per_late_day: "1",
  max_suspension_days: "14",
  block_reserve_when_suspended: "1",
};

interface RuleSection {
  id: string;
  number: number;
  title: string;
  icon: typeof BookOpen;
  toneClass: string;
  iconColorClass: string;
  items: { label?: string; text: string }[];
}

function formatTwoDigits(value: string, fallback: string) {
  const num = Number.parseInt(String(value || fallback), 10);
  if (Number.isNaN(num)) return fallback;
  return num >= 0 && num < 10 ? `0${num}` : String(num);
}

export function buildLibraryRuleSections(rules: PublicReaderRules): RuleSection[] {
  const maxBooks = formatTwoDigits(rules.max_books_per_user, "05");
  const maxDays = formatTwoDigits(rules.max_borrow_days, "14");
  const graceDays = Number.parseInt(rules.grace_days || "0", 10) || 0;
  const suspendPerDay = Number.parseInt(rules.suspension_days_per_late_day || "1", 10) || 1;
  const maxSuspendDays = formatTwoDigits(rules.max_suspension_days, "14");
  const blockReserve = String(rules.block_reserve_when_suspended) !== "0";

  return [
    {
      id: "registration",
      number: 1,
      title: "Đăng ký tài khoản & Cấp thẻ thư viện điện tử (QR)",
      icon: UserCheck,
      toneClass: "bg-emerald-500/5 border-emerald-500/25",
      iconColorClass: "text-emerald-700 dark:text-emerald-400",
      items: [
        {
          text: "Độc giả tự đăng ký tài khoản bằng họ tên thật, email đang sử dụng và số điện thoại hợp lệ (10 chữ số).",
        },
        {
          text: "Hồ sơ được Thủ thư hoặc Quản trị viên phê duyệt; hệ thống tự động cấp Mã thẻ thư viện (LIB-RD-...) và gửi thông báo qua Email.",
        },
        {
          text: "Thẻ chưa được duyệt hoặc đang tạm khóa không thể mượn sách mới cho tới khi được kích hoạt/mở khóa.",
        },
      ],
    },
    {
      id: "borrow-limits",
      number: 2,
      title: "Hạn mức mượn sách & Thời gian lưu thông",
      icon: BookOpen,
      toneClass: "bg-primary/5 border-primary/20",
      iconColorClass: "text-primary",
      items: [
        {
          text: `Mỗi độc giả được mượn tối đa ${maxBooks} cuốn sách trong cùng một thời điểm.`,
        },
        {
          text: `Thời hạn mượn tiêu chuẩn là ${maxDays} ngày kể từ thời điểm Thủ thư hoàn tất xuất mượn tại quầy.`,
        },
      ],
    },
    {
      id: "online-hold-waitlist",
      number: 3,
      title: "Giữ chỗ Online 24h & Hàng đợi Đặt trước",
      icon: Clock,
      toneClass: "bg-sky-500/5 border-sky-500/20",
      iconColorClass: "text-sky-700 dark:text-sky-400",
      items: [
        {
          label: "Giữ chỗ sách có sẵn (24h)",
          text: "Đặt mượn online tạo Phiếu mượn nháp có hiệu lực 24 giờ; độc giả quét tem QR trên kệ và mang tới quầy xác nhận thành Phiếu mượn chính thức.",
        },
        {
          label: "Đặt trước khi hết sách (48h)",
          text: "Khi bản sao trên kệ đã hết, độc giả có thể vào hàng đợi đặt trước. Hệ thống gửi Email + chuông báo ngay khi sách về và giữ ưu tiên trong 48 giờ.",
        },
      ],
    },
    {
      id: "renewals",
      number: 4,
      title: "Chính sách gia hạn sách trực tuyến",
      icon: RefreshCw,
      toneClass: "bg-teal-500/5 border-teal-500/25",
      iconColorClass: "text-teal-700 dark:text-teal-400",
      items: [
        {
          text: "Mỗi cuốn sách được gia hạn trực tuyến tối đa 02 lần (mỗi lần gia hạn cộng thêm 07 ngày).",
        },
        {
          text: "Điều kiện hợp lệ: Sách chưa quá hạn trả và chưa có độc giả khác đang chờ trong hàng đợi đặt trước.",
        },
      ],
    },
    {
      id: "dropbox-247",
      number: 5,
      title: "Trả sách tại quầy & Hòm Trả Sách Ngoài Giờ 24/7",
      icon: Inbox,
      toneClass: "bg-indigo-500/5 border-indigo-500/20",
      iconColorClass: "text-indigo-700 dark:text-indigo-400",
      items: [
        {
          text: "Trong giờ làm việc, độc giả trả sách trực tiếp tại quầy Thủ thư để đối soát và gạch nợ ngay.",
        },
        {
          text: "Ngoài giờ hành chính hoặc ngày nghỉ, dùng Hòm trả 24/7: chọn đúng mã QR bản sao đang mượn và đính kèm ảnh chụp minh chứng tại hòm. Hệ thống chốt mốc thời gian trả ngay (ngưng tính trễ hạn) và gửi Email kết quả khi Thủ thư kiểm kê.",
        },
      ],
    },
    {
      id: "discipline",
      number: 6,
      title: "Quy chế quá hạn, tạm ngưng mượn & khắc phục (Không thu tiền)",
      icon: AlertTriangle,
      toneClass: "bg-destructive/5 border-destructive/20",
      iconColorClass: "text-destructive",
      items: [
        {
          label: "Đang giữ sách quá hạn (OVERDUE)",
          text: "Tự động khóa quyền mượn mới và đặt trước cho đến khi hoàn trả sách quá hạn về thư viện.",
        },
        {
          label: "Trả sách trễ hạn (SUSPENDED)",
          text: `Sau ${graceDays} ngày ân hạn, mỗi ngày trễ áp dụng tạm ngưng quyền mượn ${suspendPerDay} ngày (trần tối đa ${maxSuspendDays} ngày). Hết thời hạn đình chỉ, quyền mượn tự mở lại nếu không còn vi phạm khác.`,
        },
        {
          label: "Đặt trước khi đang đình chỉ",
          text: blockReserve
            ? "Trong thời gian đang tạm ngưng quyền mượn, hệ thống tạm khóa chức năng đặt trước sách mới."
            : "Độc giả vẫn có thể đăng ký xếp hàng đặt trước theo quy chế hiện hành.",
        },
        {
          label: "Hư hỏng / Mất sách (PENDING_REMEDIATION)",
          text: "Không thu tiền phạt; Thủ thư lập biên bản hiện trạng và độc giả khắc phục hoặc nộp bản sao thay thế tương đương để mở khóa thẻ.",
        },
      ],
    },
    {
      id: "preservation-exit",
      number: 7,
      title: "Bảo quản tài liệu & Lưu giữ Phiếu mượn đối soát",
      icon: ShieldAlert,
      toneClass: "bg-amber-500/5 border-amber-500/25",
      iconColorClass: "text-amber-700 dark:text-amber-400",
      items: [
        {
          text: "Không viết, vẽ, gập trang, làm rách sách hoặc bóc/làm mờ tem mã QR định danh dán trên gáy sách.",
        },
        {
          text: "Lưu giữ Phiếu mượn chính thức (mã PM-BRW-...) trên ứng dụng hoặc email làm minh chứng giao dịch hợp lệ để đối chiếu với Thủ thư khi cần thiết.",
        },
      ],
    },
  ];
}

export function LibraryRulesSummaryBar({ rules }: { rules: PublicReaderRules }) {
  const maxBooks = formatTwoDigits(rules.max_books_per_user, "05");
  const maxDays = formatTwoDigits(rules.max_borrow_days, "14");
  const maxSuspend = formatTwoDigits(rules.max_suspension_days, "14");

  const stats = [
    { label: "Tối đa đồng thời", value: `${maxBooks} cuốn` },
    { label: "Thời hạn tiêu chuẩn", value: `${maxDays} ngày` },
    { label: "Gia hạn trực tuyến", value: "2 lần (+7 ngày)" },
    { label: "Trễ hạn không tiền phạt", value: `Đình chỉ ≤ ${maxSuspend}d` },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {stats.map((st) => (
        <div
          key={st.label}
          className="rounded-xl border border-border/80 bg-muted/45 px-2.5 py-2 text-center"
        >
          <p className="text-[10px] font-medium text-muted-foreground leading-tight">{st.label}</p>
          <p className="text-xs font-bold text-primary mt-0.5">{st.value}</p>
        </div>
      ))}
    </div>
  );
}

export function LibraryRulesList({
  rules,
  compact = false,
}: {
  rules: PublicReaderRules;
  compact?: boolean;
}) {
  const sections = useMemo(() => buildLibraryRuleSections(rules), [rules]);

  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <div
            key={section.id}
            className={`rounded-xl border ${section.toneClass} ${compact ? "p-3" : "p-3.5"} space-y-1.5`}
          >
            <p className={`font-bold flex items-center gap-1.5 ${section.iconColorClass} ${compact ? "text-xs" : "text-sm"}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span>
                {section.number}. {section.title}
              </span>
            </p>
            <ul className={`list-disc list-inside text-muted-foreground space-y-1 pl-0.5 ${compact ? "text-[11px] leading-relaxed" : "text-xs leading-relaxed"}`}>
              {section.items.map((item, idx) => (
                <li key={idx}>
                  {item.label ? (
                    <>
                      <strong className="text-foreground">{item.label}:</strong> {item.text}
                    </>
                  ) : (
                    item.text
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

interface LibraryRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: PublicReaderRules;
  ctaLabel?: string;
  onCtaClick?: () => void;
}

export function LibraryRulesDialog({
  open,
  onOpenChange,
  rules,
  ctaLabel,
  onCtaClick,
}: LibraryRulesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[88vh] p-0 overflow-hidden flex flex-col rounded-2xl border border-amber-200/60 shadow-2xl">
        <div className="bg-gradient-to-r from-[#173A2B] via-[#1F4E3A] to-[#2C624A] px-6 py-5 text-white shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <Badge className="bg-amber-300/20 text-amber-100 border border-amber-200/30 text-[10px] font-semibold">
              Athenaeum • Quy chế Độc giả
            </Badge>
            <span className="text-[11px] text-emerald-100/85 font-mono">07 Điều khoản lưu thông</span>
          </div>
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="font-display text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
              <BookMarked className="h-5 w-5 text-amber-200 shrink-0" />
              <span>Nội Quy Thư Viện Dành Cho Độc Giả</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-emerald-100/90">
              Vui lòng đọc kỹ toàn bộ quy chế cấp thẻ, hạn mức mượn trả, gia hạn, Hòm trả 24/7 và quy định bảo quản sách trước khi sử dụng dịch vụ thư viện.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5 sm:px-6 pt-4 pb-2 shrink-0 bg-card border-b">
          <LibraryRulesSummaryBar rules={rules} />
        </div>

        <div className="px-5 sm:px-6 py-4 overflow-y-auto flex-1 bg-card">
          <LibraryRulesList rules={rules} />
        </div>

        <DialogFooter className="px-5 sm:px-6 py-3.5 bg-muted/40 border-t flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            Quy định được đồng bộ trực tiếp từ cấu hình vận hành của thư viện.
          </p>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {ctaLabel && onCtaClick && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  onCtaClick();
                }}
                className="font-semibold gap-1.5 cursor-pointer"
              >
                <span>{ctaLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              type="button"
              variant={ctaLabel ? "outline" : "default"}
              size="sm"
              onClick={() => onOpenChange(false)}
              className="font-semibold cursor-pointer"
            >
              Đã hiểu nội quy
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

