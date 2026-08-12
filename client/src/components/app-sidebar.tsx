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
  Activity
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
};

export function AppSidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { user, logout } = useAuth();
  
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  // Dynamic items based on role grouped logically
  const overview = [
    { title: "Tổng quan", url: "/", icon: LayoutDashboard, roles: ["admin", "librarian", "reader"] },
    { title: "Thống kê & Báo cáo", url: "/reports", icon: BarChart3, roles: ["admin", "librarian"] },
    { title: "Gợi ý sách (AI)", url: "/recommendations", icon: Sparkles, roles: ["admin", "librarian", "reader"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const catalog = [
    { title: "Quản lý sách", url: "/books", icon: BookOpen, roles: ["admin", "librarian", "reader"] },
    { title: "Thể loại sách", url: "/categories", icon: Tag, roles: ["admin", "librarian"] },
    { title: "Tác giả", url: "/authors", icon: PenTool, roles: ["admin", "librarian"] },
    { title: "Nhà xuất bản", url: "/publishers", icon: Building2, roles: ["admin", "librarian"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const operations = [
    { title: "Mượn / Trả (QR)", url: "/borrow", icon: QrCode, roles: ["admin", "librarian", "reader"] },
    { title: "Đặt trước sách", url: "/reservations", icon: CalendarClock, roles: ["admin", "librarian", "reader"] },
    { title: "Phí phạt", url: "/fines", icon: Wallet, roles: ["admin", "librarian", "reader"] },
    { title: "Thông báo", url: "/notifications", icon: Bell, roles: ["admin", "librarian", "reader"] },
  ].filter(item => item.roles.includes(user?.role || ""));

  const adminSystem = [
    { title: "Quản lý độc giả", url: "/readers", icon: Users, roles: ["admin", "librarian"] },
    { title: "Quản lý tài khoản", url: "/accounts", icon: ShieldCheck, roles: ["admin"] },
    { title: "Nhật ký hoạt động", url: "/activity-logs", icon: Activity, roles: ["admin"] },
    { title: "Cài đặt hệ thống", url: "/settings", icon: Settings, roles: ["admin"] },
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
            <SidebarGroupLabel>Quản lý Kho sách</SidebarGroupLabel>
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
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-success text-primary-foreground grid place-items-center text-xs font-semibold">
              {user?.fullName?.split(" ").slice(-1)[0][0] || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.fullName || "Người dùng"}</p>
              <p className="text-xs text-muted-foreground truncate">{roleMap[user?.role || ""] || "Độc giả"}</p>
            </div>
          </div>
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
