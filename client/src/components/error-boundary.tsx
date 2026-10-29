import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in component tree:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <div className="max-w-md w-full bg-card border border-destructive/30 rounded-2xl p-6 shadow-xl text-center space-y-4">
            <div className="h-14 w-14 rounded-full bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-center mx-auto">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">Đã xảy ra sự cố hiển thị</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ứng dụng gặp lỗi trong quá trình xử lý giao diện. Vui lòng thử tải lại trang hoặc quay về trang chủ.
              </p>
            </div>
            {this.state.error && (
              <div className="text-left bg-muted/60 p-3 rounded-xl border text-[11px] font-mono text-destructive/90 overflow-x-auto max-h-28">
                {this.state.error.message}
              </div>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = "/"}
                className="gap-1.5 text-xs"
              >
                <Home className="h-3.5 w-3.5" /> Trang chủ
              </Button>
              <Button
                size="sm"
                onClick={this.handleReset}
                className="gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Tải lại trang
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
