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
  FileSpreadsheet,
  Inbox
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
  admin: "Quản trị viên IT",
  librarian: "Thủ thư",
  reader: "Độc giả",
  owner: "Chủ thư viện / Giám đốc",
};

interface MenuItem {
  title: string;
  url: string;
  icon: any;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

export function AppSidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { user, logout } = useAuth();
  
  const currentPath = location.pathname + location.search;
  const isActive = (url: string) => {
    if (url === "/") return pathname === "/";
    if (url.includes("?")) {
      return currentPath === url;
    }
    if (url === "/borrow") {
      return pathname === "/borrow" && !location.search;
    }
    return pathname.startsWith(url);
  };

  const role = user?.role || "reader";
  const isReader = role === "reader";
  const isLibrarian = role === "librarian";
  const isAdmin = role === "admin";
  const isOwner = role === "owner";

  // Phân bổ danh mục điều hướng tối ưu hóa tuyệt đối theo từng Actor (RBAC):
  let menuGroups: MenuGroup[] = [];

  if (isReader) {
    // 1. ĐỘC GIẢ (READER) - Không gian tự phục vụ (Self-Service)
    menuGroups = [
      {
        label: "Cá nhân & Khám phá",
        items: [
          { title: "Tổng quan", url: "/", icon: LayoutDashboard },
          { title: "Hồ sơ & Thẻ cá nhân", url: "/profile", icon: User },
          { title: "Gợi ý sách AI", url: "/recommendations", icon: Sparkles },
          { title: "Thông báo", url: "/notifications", icon: Bell },
        ],
      },
      {
        label: "Tài nguyên Tri thức",
        items: [
          { title: "Danh mục & Tra cứu Sách", url: "/books", icon: BookOpen },
        ],
      },
      {
        label: "Lưu thông Cá nhân",
        items: [
          { title: "Phiếu mượn & Thẻ đọc", url: "/borrow", icon: QrCode },
          { title: "Đặt trước sách", url: "/reservations", icon: CalendarClock },
          { title: "Vi phạm & Kỷ luật mượn", url: "/fines", icon: ShieldCheck },
        ],
      },
    ];
  } else if (isLibrarian) {
    // 2. THỦ THƯ (LIBRARIAN) - Bàn lưu thông nghiệp vụ, kho sách và quản lý thẻ độc giả
    menuGroups = [
      {
        label: "Tổng quan & Báo cáo",
        items: [
          { title: "Tổng quan Nghiệp vụ", url: "/", icon: LayoutDashboard },
          { title: "Dự báo Nhu cầu & Báo cáo", url: "/reports", icon: BarChart3 },
          { title: "Thông báo", url: "/notifications", icon: Bell },
        ],
      },
      {
        label: "Bàn Lưu Thông & Giao Dịch",
        items: [
          { title: "Quầy Đa Năng Thông Minh", url: "/borrow", icon: Zap },
          { title: "Sổ Lưu Thông & Lịch Sử", url: "/borrow?mode=history", icon: FileSpreadsheet },
          { title: "Hòm Trả Sách 24/7", url: "/borrow?mode=dropbox", icon: Inbox },
          { title: "Hàng đợi Đặt trước", url: "/reservations", icon: CalendarClock },
          { title: "Sổ Vi phạm & Khắc phục", url: "/fines", icon: ShieldCheck },
        ],
      },
      {
        label: "Quản lý Kho & Bản sao",
        items: [
          { title: "Danh mục Sách & Mã QR", url: "/books", icon: BookOpen },
          { title: "Thể loại & Phân loại", url: "/categories", icon: Tag },
          { title: "Tác giả", url: "/authors", icon: PenTool },
          { title: "Nhà xuất bản", url: "/publishers", icon: Building2 },
        ],
      },
      {
        label: "Độc giả & Thẻ thư viện",
        items: [
          { title: "Quản lý Độc giả", url: "/readers", icon: Users },
        ],
      },
    ];
  } else if (isAdmin) {
    // 3. QUẢN TRỊ VIÊN IT (ADMIN) - Vận hành kỹ thuật, phân quyền, dữ liệu nền tảng và Maker quy chế
    menuGroups = [
      {
        label: "Tổng quan Hệ thống",
        items: [
          { title: "Tổng quan Kỹ thuật", url: "/", icon: LayoutDashboard },
          { title: "Báo cáo Kỹ thuật & Thống kê", url: "/reports", icon: BarChart3 },
          { title: "Thông báo", url: "/notifications", icon: Bell },
        ],
      },
      {
        label: "Quản trị IT & An ninh",
        items: [
          { title: "Quản lý Tài khoản & Phân quyền", url: "/accounts", icon: ShieldCheck },
          { title: "Quản lý Độc giả & Dữ liệu", url: "/readers", icon: Users },
          { title: "Đề xuất Quy chế (Maker)", url: "/settings", icon: Settings },
          { title: "Nhật ký Hoạt động (Audit)", url: "/activity-logs", icon: Activity },
        ],
      },
      {
        label: "Quản trị Dữ liệu Kho",
        items: [
          { title: "Danh mục Sách & Bản sao", url: "/books", icon: BookOpen },
          { title: "Thể loại & Phân loại", url: "/categories", icon: Tag },
          { title: "Tác giả", url: "/authors", icon: PenTool },
          { title: "Nhà xuất bản", url: "/publishers", icon: Building2 },
        ],
      },
      {
        label: "Kỹ thuật Lưu thông",
        items: [
          { title: "Sổ Lưu Thông & Lịch Sử", url: "/borrow?mode=history", icon: FileSpreadsheet },
          { title: "Trạm Kiosk & Cổng An Ninh", url: "/borrow?mode=kiosk", icon: ArrowRightLeft },
        ],
      },
    ];
  } else if (isOwner) {
    // 4. CHỦ THƯ VIỆN / GIÁM ĐỐC (OWNER) - Điều hành chiến lược, phê duyệt Checker, thanh tra và tài chính
    menuGroups = [
      {
        label: "Điều hành Chiến lược",
        items: [
          { title: "Trung tâm Điều hành Giám đốc", url: "/", icon: LayoutDashboard },
          { title: "Báo cáo Phân tích & KPIs", url: "/reports", icon: BarChart3 },
          { title: "Thông báo", url: "/notifications", icon: Bell },
        ],
      },
      {
        label: "Quản trị & Giám sát Tối cao",
        items: [
          { title: "Phê duyệt Quy chế (Checker)", url: "/settings", icon: Settings },
          { title: "Giám sát Tài khoản Cán bộ", url: "/accounts", icon: ShieldCheck },
          { title: "Thanh tra Hoạt động (Audit)", url: "/activity-logs", icon: Activity },
          { title: "Giám sát Vi phạm & Kỷ luật", url: "/fines", icon: ShieldCheck },
        ],
      },
      {
        label: "Tài sản Thư viện",
        items: [
          { title: "Giám sát Kho Sách & Bản sao", url: "/books", icon: BookOpen },
          { title: "Sổ Lưu Thông & Lịch Sử Giao Dịch", url: "/borrow?mode=history", icon: FileSpreadsheet },
        ],
      },
    ];
  }

  const renderItems = (items: MenuItem[]) => (
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
        {menuGroups.map((group, idx) => (
          <SidebarGroup key={group.label || idx}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>{renderItems(group.items)}</SidebarGroupContent>
          </SidebarGroup>
        ))}
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
