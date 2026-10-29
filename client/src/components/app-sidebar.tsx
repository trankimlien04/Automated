import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  Users,
  QrCode,
  CalendarClock,
  Wallet,
  Bell,
  Sparkles,
  BarChart3,
  Settings,
  BookMarked,
  LogOut,
  ShieldCheck,
  Tag,
  PenTool,
  Building2,
  Activity,
  User,
  Zap,
  ArrowRightLeft,
  FileSpreadsheet
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const roleMap: Record<string, string> = {
  admin: "Quản trị viên",
  librarian: "Thủ thư",
  reader: "Độc giả",
  owner: "Chủ thư viện / Giám đốc",
};

export function AppSidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { user, logout } = useAuth();
  
  const currentPath = location.pathname + location.search;
  const isActive = (url: string) => {
    if (url === "/") return pathname === "/";
    if (url.includes("?")) {
      return (
        currentPath === url ||
        (url === "/borrow?mode=checkout" && pathname === "/borrow" && !location.search)
      );
    }
    return pathname.startsWith(url);
  };

  // Dynamic items based on role grouped logically
  const overview = [
    { title: "Tổng quan", url: "/", icon: LayoutDashboard, roles: ["admin", "librarian", "reader", "owner"] },
    { title: "Hồ sơ & Thẻ cá nhân", url: "/profile", icon: User, roles: ["admin", "librarian", "reader", "owner"] },
    { title: "Thống kê & Báo cáo", url: "/reports", icon: BarChart3, roles: ["admin", "librarian", "owner"] },
    { title: "Gợi ý sách thông minh", url: "/recommendations", icon: Sparkles, roles: ["admin", "librarian", "reader", "owner"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const isReader = user?.role === "reader";
  const isOwner = user?.role === "owner";

  const catalog = [
    { 
      title: isReader ? "Danh mục Sách & Tra cứu" : "Danh mục Sách & Bản sao (QR)", 
      url: "/books", 
      icon: BookOpen, 
      roles: ["admin", "librarian", "reader", "owner"] 
    },
    { title: "Thể loại & Phân loại", url: "/categories", icon: Tag, roles: ["admin", "librarian", "owner"] },
    { title: "Tác giả", url: "/authors", icon: PenTool, roles: ["admin", "librarian", "owner"] },
    { title: "Nhà xuất bản", url: "/publishers", icon: Building2, roles: ["admin", "librarian", "owner"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const operations = [
    ...(isReader ? [
      { title: "Phiếu mượn & Biên lai", url: "/borrow", icon: QrCode, roles: ["reader"] }
    ] : [
      { title: "Quầy Xuất Mượn", url: "/borrow?mode=checkout", icon: Zap, roles: ["admin", "librarian"] },
      { title: "Quầy Nhận Trả Sách", url: "/borrow?mode=return", icon: ArrowRightLeft, roles: ["admin", "librarian"] },
      { title: "Sổ Lưu Thông & Đối Soát", url: "/borrow?mode=history", icon: FileSpreadsheet, roles: ["admin", "librarian", "owner"] },
    ]),
    { title: "Đặt trước sách", url: "/reservations", icon: CalendarClock, roles: ["admin", "librarian", "reader", "owner"] },
    { title: "Phí phạt", url: "/fines", icon: Wallet, roles: ["admin", "librarian", "reader", "owner"] },
    { title: "Thông báo", url: "/notifications", icon: Bell, roles: ["admin", "librarian", "reader", "owner"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const adminSystem = [
    { title: "Quản lý độc giả", url: "/readers", icon: Users, roles: ["admin", "librarian", "owner"] },
    { title: "Quản lý tài khoản", url: "/accounts", icon: ShieldCheck, roles: ["admin", "owner"] },
    { title: "Nhật ký hoạt động (Audit)", url: "/activity-logs", icon: Activity, roles: ["admin", "owner"] },
    { 
      title: isOwner ? "Phê duyệt Quy chế (Maker-Checker)" : "Đề xuất Quy chế & Cài đặt", 
      url: "/settings", 
      icon: Settings, 
      roles: ["admin", "owner"] 
    },
  ].filter(item => item.roles.includes(user?.role || ""));

  const renderItems = (items: any[]) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
            <Link to={item.url} className="flex items-center gap-3">
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-3 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <BookMarked className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-lg font-semibold text-foreground">Athenaeum</span>
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Thư viện thông minh</span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {overview.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Tổng quan & Báo cáo</SidebarGroupLabel>
            <SidebarGroupContent>{renderItems(overview)}</SidebarGroupContent>
          </SidebarGroup>
        )}
        {catalog.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{isReader ? "Tài nguyên Tri thức" : "Quản lý Tài nguyên"}</SidebarGroupLabel>
            <SidebarGroupContent>{renderItems(catalog)}</SidebarGroupContent>
          </SidebarGroup>
        )}
        {operations.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Nghiệp vụ Thư viện</SidebarGroupLabel>
            <SidebarGroupContent>{renderItems(operations)}</SidebarGroupContent>
          </SidebarGroup>
        )}
        {adminSystem.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Quản trị Hệ thống</SidebarGroupLabel>
            <SidebarGroupContent>{renderItems(adminSystem)}</SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <div className="m-2 rounded-lg border border-border bg-card p-3 group-data-[collapsible=icon]:hidden">
          <Link to="/profile" className="flex items-center gap-2 mb-2 hover:bg-muted/50 p-1 rounded-md transition-colors group">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-success text-primary-foreground grid place-items-center text-xs font-semibold shadow-sm">
              {user?.fullName?.split(" ").slice(-1)[0][0] || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{user?.fullName || "Người dùng"}</p>
              <p className="text-xs text-muted-foreground truncate">{roleMap[user?.role || ""] || "Độc giả"}</p>
            </div>
          </Link>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-start text-destructive hover:bg-destructive/10 h-8 gap-2 px-2"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            <span>Đăng xuất</span>
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
