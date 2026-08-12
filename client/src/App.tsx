import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// Import pages
import LoginPage from "./pages/login";
import Dashboard from "./pages/index";
import BooksPage from "./pages/books";
import ReadersPage from "./pages/readers";
import BorrowPage from "./pages/borrow";
import ReservationsPage from "./pages/reservations";
import FinesPage from "./pages/fines";
import NotificationsPage from "./pages/notifications";
import RecommendationsPage from "./pages/recommendations";
import ReportsPage from "./pages/reports";
import SettingsPage from "./pages/settings";
import AccountsPage from "./pages/accounts";
import CategoriesPage from "./pages/categories";
import AuthorsPage from "./pages/authors";
import PublishersPage from "./pages/publishers";
import ActivityLogsPage from "./pages/activity-logs";

const queryClient = new QueryClient();

const ROUTE_META: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Tổng quan", subtitle: "Bức tranh hoạt động thư viện hôm nay" },
  "/books": { title: "Quản lý sách", subtitle: "Kho sách, mã QR, tồn kho" },
  "/readers": { title: "Quản lý độc giả", subtitle: "Thẻ thư viện và hồ sơ cá nhân" },
  "/accounts": { title: "Quản lý tài khoản", subtitle: "Phân quyền và tài khoản mặc định hệ thống" },
  "/borrow": { title: "Mượn / Trả qua QR", subtitle: "Giao dịch chỉ trong 30 giây" },
  "/reservations": { title: "Đặt trước sách", subtitle: "Hàng đợi và thông báo tự động" },
  "/fines": { title: "Phí phạt", subtitle: "Quản lý vi phạm và thanh toán" },
  "/notifications": { title: "Trung tâm thông báo", subtitle: "Email & in-app realtime" },
  "/recommendations": { title: "Gợi ý sách AI", subtitle: "Content-based + Collaborative Filtering" },
  "/reports": { title: "Thống kê & Báo cáo", subtitle: "Phân tích hành vi đọc" },
  "/settings": { title: "Cài đặt hệ thống", subtitle: "Cấu hình, người dùng, sao lưu" },
  "/categories": { title: "Quản lý Thể loại", subtitle: "Phân loại sách trong thư viện" },
  "/authors": { title: "Quản lý Tác giả", subtitle: "Hồ sơ và thông tin tác giả" },
  "/publishers": { title: "Quản lý NXB", subtitle: "Thông tin nhà xuất bản sách" },
  "/activity-logs": { title: "Nhật ký hoạt động", subtitle: "Lịch sử thao tác hệ thống" },
};

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const meta = ROUTE_META[location.pathname] ?? { title: "Athenaeum", subtitle: "" };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <TopBar title={meta.title} subtitle={meta.subtitle} />
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
      <Toaster richColors position="top-right" />
    </SidebarProvider>
  );
}

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
}

// Protected Route wrapper with RBAC (Role-based access control)
function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { token, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // If authenticated but role is not allowed, redirect to home page
    return <Navigate to="/" replace />;
  }

  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public route */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected routes with Role-based protection */}
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/books" element={<ProtectedRoute><BooksPage /></ProtectedRoute>} />
              <Route path="/borrow" element={<ProtectedRoute><BorrowPage /></ProtectedRoute>} />
              <Route path="/reservations" element={<ProtectedRoute><ReservationsPage /></ProtectedRoute>} />
              <Route path="/fines" element={<ProtectedRoute><FinesPage /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
              <Route path="/recommendations" element={<ProtectedRoute><RecommendationsPage /></ProtectedRoute>} />
              
              {/* Readers Page - Only Librarians and Admins */}
              <Route path="/readers" element={
                <ProtectedRoute allowedRoles={["admin", "librarian"]}>
                  <ReadersPage />
                </ProtectedRoute>
              } />

              <Route path="/categories" element={
                <ProtectedRoute allowedRoles={["admin", "librarian"]}>
                  <CategoriesPage />
                </ProtectedRoute>
              } />

              <Route path="/authors" element={
                <ProtectedRoute allowedRoles={["admin", "librarian"]}>
                  <AuthorsPage />
                </ProtectedRoute>
              } />

              <Route path="/publishers" element={
                <ProtectedRoute allowedRoles={["admin", "librarian"]}>
                  <PublishersPage />
                </ProtectedRoute>
              } />

              <Route path="/activity-logs" element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <ActivityLogsPage />
                </ProtectedRoute>
              } />
              
              {/* Accounts Page - Only Admins */}
              <Route path="/accounts" element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AccountsPage />
                </ProtectedRoute>
              } />
              
              {/* Reports Page - Only Librarians and Admins */}
              <Route path="/reports" element={
                <ProtectedRoute allowedRoles={["admin", "librarian"]}>
                  <ReportsPage />
                </ProtectedRoute>
              } />
              
              {/* Settings Page - Only Admins */}
              <Route path="/settings" element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <SettingsPage />
                </ProtectedRoute>
              } />
              
              <Route path="*" element={
                <div className="flex min-h-screen items-center justify-center bg-background px-4">
                  <div className="max-w-md text-center">
                    <h1 className="text-7xl font-bold text-foreground">404</h1>
                    <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
                  </div>
                </div>
              } />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
