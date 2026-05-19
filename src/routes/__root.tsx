import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Athenaeum — Hệ thống Thư viện Thông minh" },
      { name: "description", content: "Quản lý thư viện thông minh: mượn/trả QR, gợi ý sách AI, phân tích hành vi đọc theo thời gian thực." },
      { property: "og:title", content: "Athenaeum — Hệ thống Thư viện Thông minh" },
      { property: "og:description", content: "Quản lý mượn/trả qua QR, gợi ý sách cá nhân hóa và dashboard thống kê." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const ROUTE_META: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Tổng quan", subtitle: "Bức tranh hoạt động thư viện hôm nay" },
  "/books": { title: "Quản lý sách", subtitle: "Kho sách, mã QR, tồn kho" },
  "/readers": { title: "Quản lý độc giả", subtitle: "Thẻ thư viện và hồ sơ cá nhân" },
  "/borrow": { title: "Mượn / Trả qua QR", subtitle: "Giao dịch chỉ trong 30 giây" },
  "/reservations": { title: "Đặt trước sách", subtitle: "Hàng đợi và thông báo tự động" },
  "/fines": { title: "Phí phạt", subtitle: "Quản lý vi phạm và thanh toán" },
  "/notifications": { title: "Trung tâm thông báo", subtitle: "Email & in-app realtime" },
  "/recommendations": { title: "Gợi ý sách AI", subtitle: "Content-based + Collaborative Filtering" },
  "/reports": { title: "Thống kê & Báo cáo", subtitle: "Phân tích hành vi đọc" },
  "/settings": { title: "Cài đặt hệ thống", subtitle: "Cấu hình, người dùng, sao lưu" },
};

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = ROUTE_META[pathname] ?? { title: "Athenaeum", subtitle: "" };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <SidebarProvider>
          <div className="flex min-h-screen w-full">
            <AppSidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <TopBar title={meta.title} subtitle={meta.subtitle} />
              <main className="flex-1 p-4 md:p-6 lg:p-8">
                <Outlet />
              </main>
            </div>
          </div>
          <Toaster richColors position="top-right" />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
