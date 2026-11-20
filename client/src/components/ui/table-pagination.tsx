import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemName?: string;
  className?: string;
}

export function TablePagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemName = "mục",
  className = "",
}: TablePaginationProps) {
  if (totalCount === 0) return null;

  const validCurrentPage = Math.min(Math.max(1, currentPage), Math.max(1, totalPages));
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (validCurrentPage <= 4) {
        pages.push(1, 2, 3, 4, 5, "...", totalPages);
      } else if (validCurrentPage >= totalPages - 3) {
        pages.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, "...", validCurrentPage - 1, validCurrentPage, validCurrentPage + 1, "...", totalPages);
      }
    }
    return pages;
  };

  return (
    <div className={`flex flex-col md:flex-row items-center justify-between gap-4 p-3.5 bg-card border border-border/80 rounded-2xl shadow-xs mt-3 ${className}`}>
      {/* Phía trái: Bộ đếm số lượng & Tùy chọn số mục mỗi trang */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>
            Đang xem <strong>{startIndex + 1} - {endIndex}</strong> / <strong>{totalCount}</strong> {itemName}
          </span>
        </div>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 border-l pl-3 border-border/80">
            <span className="text-[11px] whitespace-nowrap">Hiển thị:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(val) => {
                onPageSizeChange(parseInt(val, 10));
              }}
            >
              <SelectTrigger className="h-8 w-[95px] text-xs bg-background shadow-2xs font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((opt) => (
                  <SelectItem key={opt} value={opt.toString()}>
                    {opt} / trang
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Phía phải: Cụm điều hướng số trang (Trang 1, 2, 3...) */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {/* Nút về trang đầu tiên */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={validCurrentPage === 1}
            className="h-8 w-8 p-0 text-xs hidden sm:flex border-border/80 hover:bg-muted"
            title="Về trang đầu tiên (Trang 1)"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* Nút lùi 1 trang */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(validCurrentPage - 1)}
            disabled={validCurrentPage === 1}
            className="h-8 px-2.5 text-xs gap-1 border-border/80 hover:bg-muted"
            title="Trang trước"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Trước</span>
          </Button>

          {/* Danh sách các nút số trang: 1, 2, 3... */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((pageItem, idx) => {
              if (pageItem === "...") {
                return (
                  <span
                    key={`ellipsis-${idx}`}
                    className="h-8 w-7 flex items-center justify-center text-xs text-muted-foreground select-none font-bold"
                  >
                    •••
                  </span>
                );
              }

              const pageNum = pageItem as number;
              const isActive = pageNum === validCurrentPage;

              return (
                <Button
                  key={`page-${pageNum}`}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPageChange(pageNum)}
                  className={`h-8 min-w-[32px] px-2 text-xs font-bold transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs pointer-events-none scale-105"
                      : "border-border/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40"
                  }`}
                  title={`Chuyển đến trang ${pageNum}`}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          {/* Nút tiến 1 trang */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(validCurrentPage + 1)}
            disabled={validCurrentPage === totalPages}
            className="h-8 px-2.5 text-xs gap-1 border-border/80 hover:bg-muted"
            title="Trang tiếp theo"
          >
            <span className="hidden sm:inline">Sau</span>
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Nút đến trang cuối */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={validCurrentPage === totalPages}
            className="h-8 w-8 p-0 text-xs hidden sm:flex border-border/80 hover:bg-muted"
            title={`Đến trang cuối (Trang ${totalPages})`}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

