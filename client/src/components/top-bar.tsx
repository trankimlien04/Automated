import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { 
  Bell, 
  Search, 
  BookOpen, 
  User as UserIcon, 
  QrCode, 
  FileText, 
  X, 
  Loader2, 
  ArrowRight,
  Sparkles,
  BookmarkCheck,
  AlertTriangle,
  Sliders,
  ShieldAlert,
  FileCheck,
  CreditCard,
  UserCheck
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/services/api";

interface SearchResults {
  role?: string;
  books?: Array<{
    id: number;
    title: string;
    isbn?: string;
    cover_image?: string;
    author_name?: string;
    category_name?: string;
    available_copies: number;
    total_copies: number;
  }>;
  users?: Array<{
    id: number;
    full_name: string;
    email: string;
    phone?: string;
    card_number?: string;
    role: string;
    status: string;
  }>;
  copies?: Array<{
    id: number;
    qr_code: string;
    status: string;
    book_id: number;
    book_title: string;
  }>;
  borrows?: Array<{
    id: number;
    borrow_date: string;
    due_date: string;
    status: string;
    reader_name?: string;
    card_number?: string;
    book_title: string;
    qr_code: string;
  }>;
  reservations?: Array<{
    id: number;
    status: string;
    reservation_date: string;
    ticket_code: string;
    reader_name?: string;
    card_number?: string;
    book_title: string;
  }>;
  fines?: Array<{
    id: number;
    amount: number;
    reason: string;
    status: string;
    book_title?: string;
  }>;
  configs?: Array<{
    id?: number;
    key_name: string;
    value?: string;
    proposed_value?: string;
    current_value?: string;
    description?: string;
    reason?: string;
    status?: string;
    type: "config" | "proposal";
    proposer_name?: string;
  }>;
  logs?: Array<{
    id: number;
    action: string;
    details: string;
    created_at: string;
    actor_name?: string;
  }>;
}

export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults>({});
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const role = user?.role || "reader";

  // Actor-specific placeholder text
  const getSearchPlaceholder = () => {
    switch (role) {
      case "librarian":
        return "Tra cứu độc giả, mã thẻ, mã QR sách, phiếu mượn… (Ctrl+K)";
      case "admin":
        return "Tìm tài khoản, phân quyền, cấu hình quy chế, nhật ký… (Ctrl+K)";
      case "owner":
        return "Tìm đề xuất duyệt, nhân sự, kiểm toán, kho sách… (Ctrl+K)";
      case "reader":
      default:
        return "Tìm sách thư viện, phiếu mượn, mã đặt trước… (Ctrl+K)";
    }
  };

  // Fetch unread notifications count
  const fetchUnreadCount = async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      if (res.data && typeof res.data.unreadCount === "number") {
        setUnreadCount(res.data.unreadCount);
      }
    } catch {
      // Ignore background error
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 20000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search query
  useEffect(() => {
    if (!query.trim()) {
      setResults({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await api.get(`/search?q=${encodeURIComponent(query.trim())}`);
        setResults(res.data);
      } catch (err) {
        console.error("Lỗi khi tìm kiếm theo actor:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [query]);

  const handleClear = () => {
    setQuery("");
    setResults({});
    setIsOpen(false);
  };

  const handleSelectBook = (bookId: number) => {
    setIsOpen(false);
    navigate(`/books?search=${encodeURIComponent(query.trim())}`);
  };

  const handleSelectUser = (u: { id: number; role: string; card_number?: string; email: string }) => {
    setIsOpen(false);
    if (role === "admin" || role === "owner") {
      navigate(`/accounts?search=${encodeURIComponent(u.email || u.card_number || "")}`);
    } else if (role === "librarian") {
      navigate(`/readers?search=${encodeURIComponent(u.card_number || u.email || "")}`);
    } else {
      navigate("/profile");
    }
  };

  const handleSelectCopy = (qrCode: string) => {
    setIsOpen(false);
    if (["admin", "librarian"].includes(role)) {
      navigate(`/borrow?code=${encodeURIComponent(qrCode)}`);
    } else {
      navigate(`/books?search=${encodeURIComponent(qrCode)}`);
    }
  };

  const handleSelectBorrow = (borrowId: number) => {
    setIsOpen(false);
    navigate(`/borrow?ticket=${borrowId}`);
  };

  const handleSelectReservation = () => {
    setIsOpen(false);
    navigate("/reservations");
  };

  const handleSelectFine = () => {
    setIsOpen(false);
    navigate("/fines");
  };

  const handleSelectConfig = () => {
    setIsOpen(false);
    navigate("/settings");
  };

  const handleSelectLog = () => {
    setIsOpen(false);
    navigate("/activity-logs");
  };

  const handleKeyDownInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      setIsOpen(false);
      if (role === "admin") {
        navigate(`/accounts?search=${encodeURIComponent(query.trim())}`);
      } else if (role === "librarian") {
        navigate(`/borrow?search=${encodeURIComponent(query.trim())}`);
      } else {
        navigate(`/books?search=${encodeURIComponent(query.trim())}`);
      }
    }
  };

  const hasAnyResults = 
    (results.books && results.books.length > 0) || 
    (results.users && results.users.length > 0) || 
    (results.copies && results.copies.length > 0) || 
    (results.borrows && results.borrows.length > 0) ||
    (results.reservations && results.reservations.length > 0) ||
    (results.fines && results.fines.length > 0) ||
    (results.configs && results.configs.length > 0) ||
    (results.logs && results.logs.length > 0);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger />
      <div className="hidden md:block">
        <h1 className="font-display text-xl font-semibold leading-none">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Global Live Search Bar */}
        <div ref={searchContainerRef} className="relative w-64 sm:w-80 md:w-[420px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDownInput}
              placeholder={getSearchPlaceholder()}
              className="w-full pl-9 pr-8 bg-card border-border/70 hover:border-primary/50 focus-visible:ring-primary/30 h-9 text-xs"
            />
            {query && (
              <button
                onClick={handleClear}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-full"
                title="Xóa tìm kiếm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Search Result Dropdown Menu */}
          {isOpen && query.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 max-h-[480px] overflow-y-auto rounded-xl border border-border/80 bg-popover/95 p-2 shadow-2xl backdrop-blur-md z-50 animate-in fade-in-50 zoom-in-95">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Đang tra cứu dữ liệu phù hợp...</span>
                </div>
              ) : !hasAnyResults ? (
                <div className="py-8 text-center">
                  <p className="text-xs font-semibold text-foreground">Không tìm thấy kết quả phù hợp</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs mx-auto">
                    Thử tìm với từ khóa khác (tên sách, tác giả, mã thẻ, mã QR hoặc mã phiếu)
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* SÁCH & TÀI LIỆU (All roles) */}
                  {results.books && results.books.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                          <BookOpen className="h-3.5 w-3.5 text-primary" />
                          Sách & Tài liệu ({results.books.length})
                        </span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.books.map((b) => (
                          <div
                            key={b.id}
                            onClick={() => handleSelectBook(b.id)}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="h-9 w-7 shrink-0 rounded bg-muted overflow-hidden border border-border">
                                {b.cover_image ? (
                                  <img src={b.cover_image} alt={b.title} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="h-full w-full grid place-items-center bg-primary/10 text-primary text-[10px] font-bold">
                                    {b.title[0]}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{b.title}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {b.author_name || "Tác giả khác"} • {b.category_name || "Chung"}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[10px] shrink-0 ${
                                b.available_copies > 0
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "text-amber-600 border-amber-500/30"
                              }`}
                            >
                              {b.available_copies > 0 ? `Còn ${b.available_copies} cuốn` : "Hết (Đặt trước)"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SÁCH ĐỘC GIẢ ĐANG MƯỢN (READER) */}
                  {role === "reader" && results.borrows && results.borrows.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <FileText className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Sách tôi đang mượn ({results.borrows.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.borrows.map((br) => (
                          <div
                            key={br.id}
                            onClick={() => handleSelectBorrow(br.id)}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{br.book_title}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                Mã: {br.qr_code} • Hạn trả: {new Date(br.due_date).toLocaleDateString("vi-VN")}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                br.status === "borrowing"
                                  ? "text-sky-500 border-sky-500/30"
                                  : "text-emerald-500 border-emerald-500/30"
                              }`}
                            >
                              {br.status === "borrowing" ? "Đang mượn" : "Đã trả"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PHIẾU ĐẶT TRƯỚC CỦA TÔI (READER) */}
                  {role === "reader" && results.reservations && results.reservations.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <BookmarkCheck className="h-3.5 w-3.5 text-purple-500" />
                        <span>Phiếu đặt trước của tôi ({results.reservations.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.reservations.map((r) => (
                          <div
                            key={r.id}
                            onClick={handleSelectReservation}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{r.book_title}</p>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">{r.ticket_code}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                r.status === "ready"
                                  ? "bg-purple-500/10 text-purple-600 border-purple-500/30 font-semibold"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {r.status === "ready" ? "Sẵn sàng nhận" : "Đang chờ sách"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* KHOẢN PHẠT CỦA TÔI (READER) */}
                  {role === "reader" && results.fines && results.fines.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <CreditCard className="h-3.5 w-3.5 text-amber-500" />
                        <span>Khoản phạt của tôi ({results.fines.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.fines.map((f) => (
                          <div
                            key={f.id}
                            onClick={handleSelectFine}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                {Number(f.amount).toLocaleString("vi-VN")}đ • {f.book_title || "Phí vi phạm"}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">{f.reason}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                f.status === "unpaid" ? "text-destructive border-destructive/30" : "text-emerald-500 border-emerald-500/30"
                              }`}
                            >
                              {f.status === "unpaid" ? "Chưa nộp" : "Đã thanh toán"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ĐỘC GIẢ & NGƯỜI DÙNG (LIBRARIAN, ADMIN, OWNER) */}
                  {role !== "reader" && results.users && results.users.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <UserIcon className="h-3.5 w-3.5 text-sky-500" />
                        <span>{role === "librarian" ? "Độc giả thư viện" : "Tài khoản người dùng"} ({results.users.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.users.map((u) => (
                          <div
                            key={u.id}
                            onClick={() => handleSelectUser(u)}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-7 w-7 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 grid place-items-center text-xs font-bold shrink-0">
                                {u.full_name[0]}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{u.full_name}</p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {u.card_number ? `Mã thẻ: ${u.card_number}` : u.email}
                                  {u.phone ? ` • ${u.phone}` : ""}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                              {u.role}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* MÃ QR BẢN SAO (LIBRARIAN, ADMIN) */}
                  {(role === "librarian" || role === "admin") && results.copies && results.copies.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <QrCode className="h-3.5 w-3.5 text-amber-500" />
                        <span>Mã QR Bản sao ({results.copies.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.copies.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => handleSelectCopy(c.qr_code)}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-mono font-medium text-foreground truncate">{c.qr_code}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{c.book_title}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                c.status === "available"
                                  ? "text-emerald-500 border-emerald-500/30"
                                  : c.status === "borrowed"
                                  ? "text-amber-500 border-amber-500/30"
                                  : "text-destructive border-destructive/30"
                              }`}
                            >
                              {c.status === "available" ? "Sẵn sàng" : c.status === "borrowed" ? "Đang mượn" : c.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PHIẾU MƯỢN TRẢ TOÀN HỆ THỐNG (LIBRARIAN) */}
                  {role === "librarian" && results.borrows && results.borrows.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <FileText className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Phiếu mượn trả ({results.borrows.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.borrows.map((br) => (
                          <div
                            key={br.id}
                            onClick={() => handleSelectBorrow(br.id)}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                Phiếu #{br.id} • {br.book_title}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                Độc giả: {br.reader_name} • Hạn trả: {new Date(br.due_date).toLocaleDateString("vi-VN")}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                br.status === "borrowing"
                                  ? "text-sky-500 border-sky-500/30"
                                  : br.status === "returned"
                                  ? "text-emerald-500 border-emerald-500/30"
                                  : "text-destructive border-destructive/30"
                              }`}
                            >
                              {br.status === "borrowing" ? "Đang mượn" : br.status === "returned" ? "Đã trả" : "Quá hạn"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ĐỀ XUẤT CẤU HÌNH MAKER-CHECKER (ADMIN, OWNER) */}
                  {(role === "admin" || role === "owner") && results.configs && results.configs.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <Sliders className="h-3.5 w-3.5 text-indigo-500" />
                        <span>{role === "owner" ? "Đề xuất chờ duyệt" : "Cấu hình & Đề xuất"} ({results.configs.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.configs.map((c, i) => (
                          <div
                            key={i}
                            onClick={handleSelectConfig}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-mono font-medium text-foreground truncate">
                                {c.key_name} {c.proposed_value ? `-> ${c.proposed_value}` : `: ${c.value}`}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {c.reason || c.description || (c.proposer_name ? `Đề xuất bởi: ${c.proposer_name}` : "Tham số hệ thống")}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] capitalize shrink-0 ${
                                c.status === "pending"
                                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30 font-semibold"
                                  : c.status === "approved"
                                  ? "text-emerald-500 border-emerald-500/30"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {c.status === "pending" ? "Chờ duyệt" : c.status === "approved" ? "Đã duyệt" : c.type === "config" ? "Hiện hành" : c.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NHẬT KÝ KIỂM TOÁN HOẠT ĐỘNG (ADMIN, OWNER) */}
                  {(role === "admin" || role === "owner") && results.logs && results.logs.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border/50 pt-2">
                        <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                        <span>Nhật ký kiểm toán ({results.logs.length})</span>
                      </div>
                      <div className="space-y-1 mt-1">
                        {results.logs.map((l) => (
                          <div
                            key={l.id}
                            onClick={handleSelectLog}
                            className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-accent cursor-pointer transition text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">
                                [{l.action}] {l.actor_name ? `• ${l.actor_name}` : ""}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">{l.details}</p>
                            </div>
                            <span className="text-[9px] text-muted-foreground shrink-0">
                              {new Date(l.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer Button */}
                  <div className="border-t border-border/50 pt-2 px-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setIsOpen(false);
                        if (role === "admin") {
                          navigate(`/accounts?search=${encodeURIComponent(query.trim())}`);
                        } else if (role === "librarian") {
                          navigate(`/readers?search=${encodeURIComponent(query.trim())}`);
                        } else {
                          navigate(`/books?search=${encodeURIComponent(query.trim())}`);
                        }
                      }}
                      className="w-full justify-between text-xs text-primary font-medium hover:bg-primary/10 h-8"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5" />
                        Xem thêm kết quả tìm kiếm cho "{query}"
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notification Bell with Dynamic Counter */}
        <Link to="/notifications" title="Trung tâm thông báo">
          <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full hover:bg-muted">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground animate-pulse shadow-sm">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            )}
          </Button>
        </Link>

        {/* User Profile Avatar */}
        <Link to="/profile" title="Thông tin cá nhân & Thẻ định danh">
          <Button variant="ghost" size="sm" className="gap-2 px-2 h-9 border border-border/60 hover:bg-muted/80 rounded-lg">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary to-emerald-500 text-primary-foreground grid place-items-center text-[10px] font-bold">
              {user?.fullName?.split(" ").slice(-1)[0][0] || "U"}
            </div>
            <span className="text-xs font-medium max-w-[120px] truncate hidden lg:inline-block">
              {user?.fullName || "Hồ sơ"}
            </span>
          </Button>
        </Link>
      </div>
    </header>
  );
}
