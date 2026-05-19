import { Link, useRouterState } from "@tanstack/react-router";
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

const main = [
  { title: "Tổng quan", url: "/", icon: LayoutDashboard },
  { title: "Quản lý sách", url: "/books", icon: BookOpen },
  { title: "Độc giả", url: "/readers", icon: Users },
];

const operations = [
  { title: "Mượn / Trả (QR)", url: "/borrow", icon: QrCode },
  { title: "Đặt trước", url: "/reservations", icon: CalendarClock },
  { title: "Phí phạt", url: "/fines", icon: Wallet },
  { title: "Thông báo", url: "/notifications", icon: Bell },
];

const intelligence = [
  { title: "Gợi ý sách (AI)", url: "/recommendations", icon: Sparkles },
  { title: "Thống kê & Báo cáo", url: "/reports", icon: BarChart3 },
  { title: "Cài đặt", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  const renderItems = (items: typeof main) => (
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
        <SidebarGroup>
          <SidebarGroupLabel>Chính</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(main)}</SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Nghiệp vụ</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(operations)}</SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Thông minh</SidebarGroupLabel>
          <SidebarGroupContent>{renderItems(intelligence)}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="m-2 rounded-lg border border-border bg-card p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-success text-primary-foreground grid place-items-center text-xs font-semibold">
              TT
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">Trần Thủ Thư</p>
              <p className="text-xs text-muted-foreground truncate">Thủ thư chính</p>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
