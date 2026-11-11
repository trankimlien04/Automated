import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  BookOpen,
  Building2,
  Layers,
  Copy,
  CheckCircle2,
  ArrowRight,
  Footprints,
  DoorOpen,
  Sparkles,
  Plus,
  Minus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

export interface LibraryMiniMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: string;
  bookTitle?: string;
  authorName?: string;
  coverImage?: string;
  books?: Array<{
    id?: number;
    title?: string;
    location?: string;
    category_name?: string;
    available_copies?: number;
    total_copies?: number;
  }>;
}

export interface ParsedLibraryLocation {
  roomNum: number;
  shelfNum: number;
  rackNum: number;
  roomLabel: string;
  shelfLabel: string;
  rackLabel: string;
  raw: string;
}

export interface LibraryLayoutConfig {
  maxRoom: number;
  shelvesPerRoom: Record<number, number>;
  racksPerShelf: Record<string, number>;
}

const LAYOUT_STORAGE_KEY = "athenaeum_library_layout_v1";
const LAYOUT_EVENT_NAME = "athenaeum-layout-updated";

export const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function loadLibraryLayoutConfig(): LibraryLayoutConfig {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return { maxRoom: 3, shelvesPerRoom: {}, racksPerShelf: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      maxRoom: typeof parsed.maxRoom === "number" && parsed.maxRoom >= 3 ? parsed.maxRoom : 3,
      shelvesPerRoom: parsed.shelvesPerRoom || {},
      racksPerShelf: parsed.racksPerShelf || {},
    };
  } catch {
    return { maxRoom: 3, shelvesPerRoom: {}, racksPerShelf: {} };
  }
}

export function saveLibraryLayoutConfig(config: LibraryLayoutConfig) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(LAYOUT_EVENT_NAME, { detail: config }));
  } catch (e) {
    console.error("Failed to save library layout config", e);
  }
}

/**
 * Parse a location string like "Phòng 02 - Kệ 07 - Ngăn 06" into structured labels & numbers.
 * Supports arbitrary room, shelf, and rack numbers (no hardcoded upper limit).
 */
export function parseLibraryLocation(loc?: string): ParsedLibraryLocation {
  const defaultLoc = "Phòng 01 - Kệ 01 - Ngăn 01";
  const raw = loc && loc.trim().length > 0 ? loc.trim() : defaultLoc;
  const parts = raw.split("-").map((p) => p.trim());

  const extractNum = (str: string | undefined, fallback: number) => {
    if (!str) return fallback;
    const match = str.match(/\d+/);
    return match ? Math.max(1, parseInt(match[0], 10)) : fallback;
  };

  const roomNum = extractNum(parts[0], 1);
  const shelfNum = extractNum(parts[1], 1);
  const rackNum = extractNum(parts[2], 1);

  const roomLabel = parts[0] && parts[0].length > 0 ? parts[0] : `Phòng ${pad2(roomNum)}`;
  const shelfLabel = parts[1] && parts[1].length > 0 ? parts[1] : `Kệ ${pad2(shelfNum)}`;
  const rackLabel = parts[2] && parts[2].length > 0 ? parts[2] : `Ngăn ${pad2(rackNum)}`;

  return {
    roomNum,
    shelfNum,
    rackNum,
    roomLabel,
    shelfLabel,
    rackLabel,
    raw,
  };
}

export function LibraryMiniMapModal({
  open,
  onOpenChange,
  location,
  bookTitle,
  authorName,
  books: externalBooks,
}: LibraryMiniMapModalProps) {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "librarian";

  const parsed = useMemo(() => parseLibraryLocation(location), [location]);

  const [fetchedBooks, setFetchedBooks] = useState<any[]>([]);
  const [activeRoomNum, setActiveRoomNum] = useState<number>(parsed.roomNum);
  const [activeShelfNum, setActiveShelfNum] = useState<number>(parsed.shelfNum);
  const [layoutConfig, setLayoutConfig] = useState<LibraryLayoutConfig>(() =>
    loadLibraryLayoutConfig()
  );

  // Sync active room & shelf whenever modal opens or target location changes
  useEffect(() => {
    if (open) {
      setActiveRoomNum(parsed.roomNum);
      setActiveShelfNum(parsed.shelfNum);
      setLayoutConfig(loadLibraryLayoutConfig());
    }
  }, [open, parsed.roomNum, parsed.shelfNum]);

  // Listen for layout config changes from anywhere in the app
  useEffect(() => {
    const handler = () => {
      setLayoutConfig(loadLibraryLayoutConfig());
    };
    window.addEventListener(LAYOUT_EVENT_NAME, handler);
    return () => window.removeEventListener(LAYOUT_EVENT_NAME, handler);
  }, []);

  // Fetch all books in the library when modal opens so the map always reflects newly added rooms/shelves/racks
  useEffect(() => {
    if (!open) return;
    if (externalBooks && externalBooks.length > 0) {
      setFetchedBooks(externalBooks);
      return;
    }
    let mounted = true;
    api
      .get("/books")
      .then((res) => {
        if (!mounted) return;
        const data = Array.isArray(res.data) ? res.data : res.data?.books || [];
        setFetchedBooks(data);
      })
      .catch(() => {
        // Fallback silently if offline
      });
    return () => {
      mounted = false;
    };
  }, [open, externalBooks]);

  const allBooks = externalBooks && externalBooks.length > 0 ? externalBooks : fetchedBooks;

  /**
   * Dynamically compute the entire library structure (Rooms -> Shelves -> Racks)
   * from:
   *  1) Librarian's configured rooms/shelves/racks (layoutConfig)
   *  2) Actual book locations in DB (allBooks)
   *  3) Current target location (parsed)
   */
  const dynamicLayout = useMemo(() => {
    let maxRoom = Math.max(3, layoutConfig.maxRoom, parsed.roomNum);
    const roomBooksMap = new Map<number, any[]>();

    allBooks.forEach((b) => {
      const p = parseLibraryLocation(b.location);
      if (p.roomNum > maxRoom) maxRoom = p.roomNum;
      const list = roomBooksMap.get(p.roomNum) || [];
      list.push({ ...b, _parsed: p });
      roomBooksMap.set(p.roomNum, list);
    });

    const rooms: Array<{
      roomNum: number;
      roomLabel: string;
      bookCount: number;
      maxShelf: number;
      minRequiredShelf: number;
      categories: string[];
    }> = [];

    for (let r = 1; r <= maxRoom; r++) {
      const rBooks = roomBooksMap.get(r) || [];
      let minReqShelf = 6;
      if (r === parsed.roomNum && parsed.shelfNum > minReqShelf) {
        minReqShelf = parsed.shelfNum;
      }
      const catSet = new Set<string>();
      rBooks.forEach((b) => {
        if (b._parsed.shelfNum > minReqShelf) {
          minReqShelf = b._parsed.shelfNum;
        }
        if (b.category_name) catSet.add(b.category_name);
      });

      const configuredShelf = layoutConfig.shelvesPerRoom[r] || 6;
      const maxShelfInRoom = Math.max(minReqShelf, configuredShelf);

      rooms.push({
        roomNum: r,
        roomLabel: `Phòng ${pad2(r)}`,
        bookCount: rBooks.length,
        maxShelf: maxShelfInRoom,
        minRequiredShelf: minReqShelf,
        categories: Array.from(catSet).slice(0, 3),
      });
    }

    const currentRoomInfo = rooms.find((rm) => rm.roomNum === activeRoomNum) || {
      roomNum: activeRoomNum,
      roomLabel: `Phòng ${pad2(activeRoomNum)}`,
      bookCount: 0,
      maxShelf: Math.max(
        6,
        layoutConfig.shelvesPerRoom[activeRoomNum] || 6,
        activeRoomNum === parsed.roomNum ? parsed.shelfNum : 6
      ),
      minRequiredShelf: 6,
      categories: [],
    };

    const currentRoomBooks = roomBooksMap.get(activeRoomNum) || [];
    const shelves: Array<{
      shelfNum: number;
      shelfLabel: string;
      bookCount: number;
      maxRack: number;
      minRequiredRack: number;
      booksOnShelf: any[];
    }> = [];

    for (let s = 1; s <= currentRoomInfo.maxShelf; s++) {
      const sBooks = currentRoomBooks.filter((b) => b._parsed.shelfNum === s);
      let minReqRack = 5;
      if (
        activeRoomNum === parsed.roomNum &&
        s === parsed.shelfNum &&
        parsed.rackNum > minReqRack
      ) {
        minReqRack = parsed.rackNum;
      }
      sBooks.forEach((b) => {
        if (b._parsed.rackNum > minReqRack) {
          minReqRack = b._parsed.rackNum;
        }
      });

      const rackKey = `${activeRoomNum}_${s}`;
      const configuredRack = layoutConfig.racksPerShelf[rackKey] || 5;
      const maxRackOnShelf = Math.max(minReqRack, configuredRack);

      shelves.push({
        shelfNum: s,
        shelfLabel: `Kệ ${pad2(s)}`,
        bookCount: sBooks.length,
        maxRack: maxRackOnShelf,
        minRequiredRack: minReqRack,
        booksOnShelf: sBooks,
      });
    }

    const currentShelfInfo = shelves.find((sh) => sh.shelfNum === activeShelfNum) || {
      shelfNum: activeShelfNum,
      shelfLabel: `Kệ ${pad2(activeShelfNum)}`,
      bookCount: 0,
      maxRack: Math.max(
        5,
        layoutConfig.racksPerShelf[`${activeRoomNum}_${activeShelfNum}`] || 5,
        activeRoomNum === parsed.roomNum && activeShelfNum === parsed.shelfNum
          ? parsed.rackNum
          : 5
      ),
      minRequiredRack: 5,
      booksOnShelf: [],
    };

    const racks: Array<{
      rackNum: number;
      rackLabel: string;
      booksInRack: any[];
    }> = [];

    for (let rk = currentShelfInfo.maxRack; rk >= 1; rk--) {
      const rkBooks = currentShelfInfo.booksOnShelf.filter((b) => b._parsed.rackNum === rk);
      racks.push({
        rackNum: rk,
        rackLabel: `Ngăn ${pad2(rk)}`,
        booksInRack: rkBooks,
      });
    }

    return {
      rooms,
      currentRoomInfo,
      shelves,
      currentShelfInfo,
      racks,
    };
  }, [allBooks, parsed, activeRoomNum, activeShelfNum, layoutConfig]);

  const isViewingTargetRoom = activeRoomNum === parsed.roomNum;
  const isViewingTargetShelf = isViewingTargetRoom && activeShelfNum === parsed.shelfNum;

  // Librarian actions directly inside Mini Map
  const handleAddRoomInMap = () => {
    const nextRoom = dynamicLayout.rooms.length + 1;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      maxRoom: nextRoom,
      shelvesPerRoom: { ...layoutConfig.shelvesPerRoom, [nextRoom]: 6 },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    setActiveRoomNum(nextRoom);
    setActiveShelfNum(1);
    toast.success(`Đã thêm Phòng ${pad2(nextRoom)} vào sơ đồ thư viện!`);
  };

  const handleRemoveRoomInMap = (roomToRemove?: number) => {
    const targetRm = roomToRemove ?? (activeRoomNum > 3 ? activeRoomNum : dynamicLayout.rooms.length);
    if (targetRm <= 3) {
      toast.error("Không thể xóa 3 phòng tiêu chuẩn mặc định (Phòng 01 - Phòng 03).");
      return;
    }
    const rmInfo = dynamicLayout.rooms.find((r) => r.roomNum === targetRm);
    if (rmInfo && rmInfo.bookCount > 0) {
      toast.error(`${rmInfo.roomLabel} đang chứa ${rmInfo.bookCount} đầu sách, không thể xóa!`);
      return;
    }
    if (targetRm === parsed.roomNum) {
      toast.error(`Không thể xóa ${ parsed.roomLabel } vì đang là phòng đích của cuốn sách đang xem!`);
      return;
    }

    const currentMax = dynamicLayout.rooms.length;
    const nextMax = Math.max(3, currentMax - 1);
    const nextShelvesPerRoom = { ...layoutConfig.shelvesPerRoom };
    delete nextShelvesPerRoom[targetRm];
    delete nextShelvesPerRoom[currentMax];

    const nextRacksPerShelf = { ...layoutConfig.racksPerShelf };
    Object.keys(nextRacksPerShelf).forEach((k) => {
      if (k.startsWith(`${targetRm}_`) || k.startsWith(`${currentMax}_`)) {
        delete nextRacksPerShelf[k];
      }
    });

    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      maxRoom: nextMax,
      shelvesPerRoom: nextShelvesPerRoom,
      racksPerShelf: nextRacksPerShelf,
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    setActiveRoomNum(parsed.roomNum <= nextMax ? parsed.roomNum : nextMax);
    setActiveShelfNum(parsed.roomNum <= nextMax ? parsed.shelfNum : 1);
    toast.info(`Đã xóa Phòng ${pad2(targetRm)} khỏi sơ đồ thư viện.`);
  };

  const handleAddShelfInRoom = () => {
    const nextShelf = dynamicLayout.currentRoomInfo.maxShelf + 1;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      shelvesPerRoom: {
        ...layoutConfig.shelvesPerRoom,
        [activeRoomNum]: nextShelf,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    setActiveShelfNum(nextShelf);
    toast.success(
      `Đã thêm Kệ ${pad2(nextShelf)} vào ${dynamicLayout.currentRoomInfo.roomLabel}!`
    );
  };

  const handleRemoveLastShelfInRoom = () => {
    const currentMax = dynamicLayout.currentRoomInfo.maxShelf;
    if (currentMax <= 1) return;
    if (currentMax <= dynamicLayout.currentRoomInfo.minRequiredShelf && currentMax <= 6) {
      toast.error("Không thể xóa kệ mặc định hoặc kệ đang chứa sách!");
      return;
    }
    const lastShelfObj = dynamicLayout.shelves.find((s) => s.shelfNum === currentMax);
    if (lastShelfObj && lastShelfObj.bookCount > 0) {
      toast.error(
        `Kệ ${pad2(currentMax)} đang có ${lastShelfObj.bookCount} đầu sách, không thể xóa!`
      );
      return;
    }
    const nextMax = currentMax - 1;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      shelvesPerRoom: {
        ...layoutConfig.shelvesPerRoom,
        [activeRoomNum]: nextMax,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    if (activeShelfNum > nextMax) setActiveShelfNum(nextMax);
    toast.info(
      `Đã thu gọn Kệ ${pad2(currentMax)} khỏi ${dynamicLayout.currentRoomInfo.roomLabel}.`
    );
  };

  const handleAddRackOnShelf = () => {
    const nextRack = dynamicLayout.currentShelfInfo.maxRack + 1;
    const key = `${activeRoomNum}_${activeShelfNum}`;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      racksPerShelf: {
        ...layoutConfig.racksPerShelf,
        [key]: nextRack,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.success(
      `Đã thêm Ngăn ${pad2(nextRack)} lên ${dynamicLayout.currentShelfInfo.shelfLabel} (${dynamicLayout.currentRoomInfo.roomLabel})!`
    );
  };

  const handleRemoveTopRackOnShelf = () => {
    const currentMax = dynamicLayout.currentShelfInfo.maxRack;
    if (currentMax <= 1) return;
    const topRackObj = dynamicLayout.racks.find((r) => r.rackNum === currentMax);
    if (topRackObj && topRackObj.booksInRack.length > 0) {
      toast.error(
        `Ngăn ${pad2(currentMax)} đang chứa ${topRackObj.booksInRack.length} đầu sách, không thể xóa!`
      );
      return;
    }
    if (currentMax <= 5) {
      toast.error("Mỗi kệ tiêu chuẩn có tối thiểu 5 ngăn (Ngăn 01 - Ngăn 05).");
      return;
    }
    const key = `${activeRoomNum}_${activeShelfNum}`;
    const nextConfig: LibraryLayoutConfig = {
      ...layoutConfig,
      racksPerShelf: {
        ...layoutConfig.racksPerShelf,
        [key]: currentMax - 1,
      },
    };
    saveLibraryLayoutConfig(nextConfig);
    setLayoutConfig(nextConfig);
    toast.info(
      `Đã xóa Ngăn ${pad2(currentMax)} trên ${dynamicLayout.currentShelfInfo.shelfLabel}.`
    );
  };

  const handleCopyLocation = () => {
    const text = `${bookTitle ? `Sách: ${bookTitle} — ` : ""}Vị trí: ${parsed.roomLabel} - ${parsed.shelfLabel} - ${parsed.rackLabel}`;
    navigator.clipboard.writeText(text);
    toast.success("Đã sao chép vị trí sách!");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border bg-background shadow-xl rounded-2xl max-h-[92vh] flex flex-col">
        {/* 1. HEADER: ĐƠN GIẢN, RÕ RÀNG */}
        <DialogHeader className="p-4 sm:p-5 border-b bg-muted/30 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-primary text-primary-foreground text-[11px] font-semibold px-2.5 py-0.5">
                  <MapPin className="h-3 w-3 mr-1" />
                  Sơ Đồ Dẫn Đường Tìm Sách
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Tự động cập nhật theo số Phòng • Kệ • Ngăn trong kho
                </span>
              </div>
              <DialogTitle className="font-display text-base sm:text-lg font-bold text-foreground truncate">
                {bookTitle || "Định vị kệ & ngăn sách trong thư viện"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                {authorName ? `Tác giả: ${authorName} • ` : ""}
                Làm theo 3 bước bên dưới để đến đúng kệ và ngăn lấy sách.
              </DialogDescription>
            </div>

            {/* Target Coordinate Pill */}
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/25 px-3 py-2 rounded-xl shrink-0 self-start sm:self-center">
              <span className="text-xs font-bold text-primary font-mono">
                📍 {parsed.roomLabel}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs font-bold text-primary font-mono">
                {parsed.shelfLabel}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-primary/70" />
              <span className="text-xs font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-md font-mono">
                {parsed.rackLabel}
              </span>
            </div>
          </div>

          {/* 3-Step Quick Guide Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 mt-3 border-t border-border/60">
            <div className="flex items-center gap-2.5 bg-background px-3 py-2 rounded-xl border text-xs">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center shrink-0 text-[11px]">
                1
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">Vào {parsed.roomLabel}</p>
                <p className="text-[11px] text-muted-foreground truncate">Từ sảnh chính / Quầy thủ thư</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-background px-3 py-2 rounded-xl border text-xs">
              <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground font-bold flex items-center justify-center shrink-0 text-[11px]">
                2
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">Tìm dãy {parsed.shelfLabel}</p>
                <p className="text-[11px] text-muted-foreground truncate">Đi theo lối đi chính trong phòng</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 bg-emerald-500/10 border-emerald-500/30 px-3 py-2 rounded-xl border text-xs">
              <span className="h-6 w-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">
                3
              </span>
              <div className="min-w-0">
                <p className="font-bold text-emerald-700 dark:text-emerald-400 truncate">
                  Lấy sách ở {parsed.rackLabel}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  Đếm từ ngăn đáy (Ngăn 01) lên
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* 2. BODY: SƠ ĐỒ MẶT BẰNG KỆ (TRÁI) & SƠ ĐỒ NGĂN TRÊN KỆ (PHẢI) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Room Selector Bar (Tự động hiển thị tất cả các Phòng hiện có + Nút Thêm Phòng cho Thủ thư) */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 p-2.5 rounded-xl border">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground px-1.5 flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Chọn phòng:
              </span>
              {dynamicLayout.rooms.map((rm) => {
                const isTarget = rm.roomNum === parsed.roomNum;
                const isSelected = rm.roomNum === activeRoomNum;
                return (
                  <button
                    key={rm.roomNum}
                    type="button"
                    onClick={() => {
                      setActiveRoomNum(rm.roomNum);
                      setActiveShelfNum(rm.roomNum === parsed.roomNum ? parsed.shelfNum : 1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer border ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-xs"
                        : isTarget
                        ? "bg-primary/10 text-primary border-primary/40 hover:bg-primary/20"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    <span>{rm.roomLabel}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isSelected
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {rm.maxShelf} kệ
                    </span>
                    {isTarget && (
                      <span className="text-[10px] bg-amber-400 text-slate-950 font-bold px-1.5 rounded">
                        ★ Đích
                      </span>
                    )}
                  </button>
                );
              })}

              {canManage && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddRoomInMap}
                    className="h-7 px-2.5 text-xs gap-1 border-dashed border-primary/50 text-primary hover:bg-primary/10 cursor-pointer"
                    title="Thủ thư: Thêm phòng mới vào sơ đồ thư viện"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Thêm Phòng
                  </Button>

                  {dynamicLayout.rooms.length > 3 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleRemoveRoomInMap(
                          activeRoomNum > 3 ? activeRoomNum : dynamicLayout.rooms.length
                        )
                      }
                      className="h-7 px-2.5 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 cursor-pointer"
                      title="Thủ thư: Xóa phòng đã thêm (khi phòng chưa có sách)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Xóa Phòng {pad2(activeRoomNum > 3 ? activeRoomNum : dynamicLayout.rooms.length)}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {(!isViewingTargetRoom || !isViewingTargetShelf) && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setActiveRoomNum(parsed.roomNum);
                  setActiveShelfNum(parsed.shelfNum);
                }}
                className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
              >
                <MapPin className="h-3 w-3" />
                Quay về vị trí sách ({parsed.roomLabel} - {parsed.shelfLabel})
              </Button>
            )}
          </div>

          {/* Main 2-Column Visual Map */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* LEFT COLUMN (7 cols): SƠ ĐỒ MẶT BẰNG PHÒNG & DÃY KỆ */}
            <div className="lg:col-span-7 rounded-2xl border bg-card p-4 flex flex-col justify-between space-y-4 shadow-2xs">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b pb-2.5 flex-wrap">
                  <div>
                    <h4 className="font-display font-bold text-sm text-foreground flex items-center gap-1.5 flex-wrap">
                      <Building2 className="h-4 w-4 text-primary" />
                      <span>
                        Sơ Đồ Mặt Bằng {dynamicLayout.currentRoomInfo.roomLabel}
                      </span>
                      {isViewingTargetRoom && (
                        <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          Phòng chứa sách cần tìm
                        </Badge>
                      )}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Tổng cộng <strong>{dynamicLayout.shelves.length} dãy kệ</strong> trong phòng này (bấm vào kệ bất kỳ để xem các ngăn).
                    </p>
                  </div>

                  {/* Nút Thêm / Bớt Kệ & Xóa Phòng trực tiếp cho Thủ thư */}
                  {canManage && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {activeRoomNum > 3 && dynamicLayout.currentRoomInfo.bookCount === 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveRoomInMap(activeRoomNum)}
                          className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 cursor-pointer gap-1"
                          title={`Xóa ${dynamicLayout.currentRoomInfo.roomLabel} khỏi sơ đồ`}
                        >
                          <Trash2 className="h-3 w-3" /> Xóa {dynamicLayout.currentRoomInfo.roomLabel}
                        </Button>
                      )}
                      {dynamicLayout.currentRoomInfo.maxShelf > 6 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleRemoveLastShelfInRoom}
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                          title="Xóa kệ trống cuối cùng"
                        >
                          <Minus className="h-3 w-3 mr-0.5" /> Bớt kệ
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddShelfInRoom}
                        className="h-7 px-2.5 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10 font-semibold cursor-pointer"
                        title="Thủ thư: Thêm dãy kệ mới vào phòng này"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Thêm Kệ ({`Kệ ${pad2(dynamicLayout.currentRoomInfo.maxShelf + 1)}`})
                      </Button>
                    </div>
                  )}
                </div>

                {/* Room Floorplan Box */}
                <div className="rounded-xl border-2 border-dashed border-border bg-muted/20 p-3.5 space-y-3 relative">
                  {/* Entrance & Librarian Counter Indicator at Top of Room */}
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/70">
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-semibold">
                      <DoorOpen className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span>Lối vào {dynamicLayout.currentRoomInfo.roomLabel}</span>
                    </div>

                    {isViewingTargetRoom && (
                      <div className="flex items-center gap-1.5 text-[11px] text-primary font-semibold bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20">
                        <Footprints className="h-3.5 w-3.5" />
                        <span>Đi thẳng đến dãy {parsed.shelfLabel}</span>
                      </div>
                    )}

                    <div className="text-[11px] text-muted-foreground bg-background px-2.5 py-1 rounded-lg border hidden sm:block">
                      🛎️ Quầy Thủ thư ở ngoài sảnh
                    </div>
                  </div>

                  {/* Central Aisle Guidance Line */}
                  <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-medium text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    <span className="px-2 py-0.5 rounded-full bg-background border text-[10px] font-mono">
                      ↓ LỐI ĐI CHÍNH GIỮA CÁC DÃY KỆ ↓
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>

                  {/* Dynamic Shelves Grid (Automatically grows when Kệ 07, Kệ 08... are added) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {dynamicLayout.shelves.map((shelf) => {
                      const isTargetShelf = isViewingTargetRoom && shelf.shelfNum === parsed.shelfNum;
                      const isSelectedShelf = shelf.shelfNum === activeShelfNum;

                      return (
                        <button
                          key={shelf.shelfNum}
                          type="button"
                          onClick={() => setActiveShelfNum(shelf.shelfNum)}
                          className={`group relative text-left p-3 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between min-h-[82px] ${
                            isTargetShelf
                              ? "border-emerald-600 bg-emerald-500/10 shadow-sm ring-2 ring-emerald-500/20"
                              : isSelectedShelf
                              ? "border-primary bg-primary/10 shadow-xs"
                              : "border-border bg-background hover:border-primary/50 hover:bg-muted/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1 w-full">
                            <span
                              className={`font-mono font-bold text-xs px-2 py-0.5 rounded-md ${
                                isTargetShelf
                                  ? "bg-emerald-600 text-white"
                                  : isSelectedShelf
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground"
                              }`}
                            >
                              {shelf.shelfLabel}
                            </span>

                            {isTargetShelf && (
                              <span className="text-[10px] font-bold bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded shadow-2xs animate-pulse">
                                🎯 Đích
                              </span>
                            )}
                          </div>

                          <div className="mt-2 space-y-0.5">
                            {isTargetShelf ? (
                              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 truncate">
                                ★ Có sách ở {parsed.rackLabel}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">
                                {shelf.maxRack} ngăn • {shelf.bookCount} đầu sách
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t text-[11px] text-muted-foreground">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-emerald-600 inline-block" />
                    <strong className="text-foreground">Kệ có sách cần tìm ({parsed.shelfLabel})</strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-primary inline-block" />
                    <span>Kệ đang xem chi tiết</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border border-border bg-background inline-block" />
                    <span>Các kệ khác trong phòng</span>
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN (5 cols): SƠ ĐỒ CÁC NGĂN TRÊN KỆ (TỰ ĐỘNG CẬP NHẬT SỐ NGĂN) */}
            <div className="lg:col-span-5 rounded-2xl border bg-card p-4 flex flex-col justify-between space-y-3 shadow-2xs">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b pb-2.5 flex-wrap">
                  <div>
                    <h4 className="font-display font-bold text-sm text-foreground flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-primary" />
                      <span>
                        Cấu Trúc Ngăn — {dynamicLayout.currentShelfInfo.shelfLabel} ({dynamicLayout.currentRoomInfo.roomLabel})
                      </span>
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Kệ này có <strong>{dynamicLayout.racks.length} ngăn</strong> (Ngăn 01 ở dưới cùng, đếm lên trên).
                    </p>
                  </div>

                  {/* Nút Thêm / Bớt Ngăn trực tiếp cho Thủ thư */}
                  {canManage && (
                    <div className="flex items-center gap-1">
                      {dynamicLayout.currentShelfInfo.maxRack > 5 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleRemoveTopRackOnShelf}
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive cursor-pointer"
                          title="Xóa ngăn trống trên cùng"
                        >
                          <Minus className="h-3 w-3 mr-0.5" /> Bớt ngăn
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddRackOnShelf}
                        className="h-7 px-2.5 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10 font-semibold cursor-pointer"
                        title="Thủ thư: Thêm tầng ngăn mới lên kệ này"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Thêm Ngăn ({`Ngăn ${pad2(dynamicLayout.currentShelfInfo.maxRack + 1)}`})
                      </Button>
                    </div>
                  )}
                </div>

                {/* Bookshelf Frame Visual */}
                <div className="rounded-xl border-2 border-amber-900/20 dark:border-amber-500/20 bg-amber-950/[0.03] dark:bg-amber-950/10 p-2.5 space-y-2 max-h-[340px] overflow-y-auto">
                  {dynamicLayout.racks.map((rack) => {
                    const isTargetRack =
                      isViewingTargetShelf && rack.rackNum === parsed.rackNum;

                    return (
                      <div
                        key={rack.rackNum}
                        className={`rounded-xl border-2 p-2.5 transition-all flex items-center justify-between gap-2.5 ${
                          isTargetRack
                            ? "border-emerald-600 bg-emerald-500/15 shadow-xs"
                            : "border-border/80 bg-background hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`h-8 w-14 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 ${
                              isTargetRack
                                ? "bg-emerald-600 text-white shadow-2xs"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {rack.rackLabel}
                          </div>

                          <div className="min-w-0">
                            {isTargetRack ? (
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                    🎯 Sách cần tìm ở ngăn này
                                  </span>
                                </div>
                                <p className="text-[11px] font-medium text-foreground truncate mt-0.5">
                                  📖 {bookTitle || "Cuốn sách bạn chọn"}
                                </p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs font-semibold text-foreground">
                                  {rack.rackLabel}{" "}
                                  <span className="text-[10px] font-normal text-muted-foreground">
                                    ({rack.rackNum === 1 ? "Ngăn dưới cùng" : `Tầng ${rack.rackNum}`})
                                  </span>
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate">
                                  {rack.booksInRack.length > 0
                                    ? `Đang xếp ${rack.booksInRack.length} đầu sách`
                                    : "Ngăn trống / Sẵn sàng xếp sách"}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Mini Book Spines Visual */}
                        <div className="shrink-0 flex items-end gap-0.5 h-7 px-2 py-1 rounded bg-muted/60 border border-border/50">
                          {isTargetRack ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-2 py-0.5 gap-1">
                              <BookOpen className="h-3 w-3" />
                              Lấy tại đây
                            </Badge>
                          ) : (
                            <div className="flex items-end gap-0.5 opacity-60">
                              <span className="w-1.5 h-4 bg-primary/60 rounded-t-2xs" />
                              <span className="w-2 h-5 bg-amber-500/60 rounded-t-2xs" />
                              <span className="w-1.5 h-3.5 bg-emerald-500/60 rounded-t-2xs" />
                              <span className="w-2 h-4 bg-indigo-500/60 rounded-t-2xs" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Auto-Update Note */}
              <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/15 text-[11px] text-muted-foreground flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  {canManage
                    ? "Thủ thư có thể bấm trực tiếp nút «+ Thêm Phòng», «+ Thêm Kệ», «+ Thêm Ngăn» ngay trên sơ đồ này hoặc tại tab Sơ đồ Phòng & Kệ."
                    : "Khi thủ thư thêm Phòng, Kệ hoặc Ngăn mới, sơ đồ dẫn đường này sẽ tự động mở rộng tương ứng."}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. FOOTER */}
        <div className="p-3.5 sm:p-4 border-t bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Vị trí chính xác:{" "}
              <strong className="text-foreground font-mono">
                {parsed.roomLabel} — {parsed.shelfLabel} — {parsed.rackLabel}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyLocation}
              className="h-8 text-xs gap-1.5 cursor-pointer"
            >
              <Copy className="h-3.5 w-3.5" />
              Sao chép vị trí
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 text-xs px-4 cursor-pointer"
            >
              Đóng sơ đồ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export default LibraryMiniMapModal;
